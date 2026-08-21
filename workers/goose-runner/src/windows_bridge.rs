use crate::windows_control::parse_strict_json;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub(crate) const WINDOWS_BRIDGE_CONTRACT_VERSION: u64 = 1;
pub(crate) const WINDOWS_BRIDGE_MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const WINDOWS_BRIDGE_MAX_PENDING_REQUESTS: usize = 128;

pub(crate) trait WindowsBridgeStream: AsyncRead + AsyncWrite + Unpin + Send {}

impl<T> WindowsBridgeStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}

pub(crate) struct WindowsBridgeChannel {
    stream: Box<dyn WindowsBridgeStream>,
}

impl WindowsBridgeChannel {
    pub(crate) fn new<T>(stream: T) -> Self
    where
        T: WindowsBridgeStream + 'static,
    {
        Self {
            stream: Box::new(stream),
        }
    }

    #[cfg(windows)]
    pub(crate) fn from_raw_handle(
        handle: windows_sys::Win32::Foundation::HANDLE,
    ) -> Result<Self, ()> {
        use std::os::windows::io::{FromRawHandle, RawHandle};
        if handle.is_null() || handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return Err(());
        }
        // SAFETY: the caller transfers sole ownership of this live handle to the File wrapper.
        let file = unsafe { std::fs::File::from_raw_handle(handle as RawHandle) };
        Ok(Self::new(tokio::fs::File::from_std(file)))
    }

    #[cfg(windows)]
    pub(crate) fn from_overlapped_raw_handle(
        handle: windows_sys::Win32::Foundation::HANDLE,
    ) -> Result<Self, ()> {
        use std::os::windows::io::RawHandle;
        use tokio::net::windows::named_pipe::NamedPipeClient;
        if handle.is_null() || handle == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return Err(());
        }
        // SAFETY: Node creates fd 5/fd 6 as inherited named-pipe client handles with
        // FILE_FLAG_OVERLAPPED and the caller transfers sole ownership of the duplicate.
        let pipe =
            unsafe { NamedPipeClient::from_raw_handle(handle as RawHandle) }.map_err(|_| ())?;
        Ok(Self::new(pipe))
    }

    #[cfg(windows)]
    pub(crate) fn from_raw_handle_pair(
        read_handle: windows_sys::Win32::Foundation::HANDLE,
        write_handle: windows_sys::Win32::Foundation::HANDLE,
    ) -> Result<Self, ()> {
        use std::os::windows::io::{FromRawHandle, RawHandle};
        use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE};

        fn valid(handle: HANDLE) -> bool {
            !handle.is_null() && handle != INVALID_HANDLE_VALUE
        }

        if !valid(read_handle) || !valid(write_handle) || read_handle == write_handle {
            return Err(());
        }
        // SAFETY: the caller transfers sole ownership of both live, distinct endpoints. The
        // resulting joined stream reads from the inbound anonymous pipe and writes to the
        // outbound anonymous pipe while preserving the existing framed bridge contract.
        let reader = unsafe { std::fs::File::from_raw_handle(read_handle as RawHandle) };
        let writer = unsafe { std::fs::File::from_raw_handle(write_handle as RawHandle) };
        Ok(Self::new(tokio::io::join(
            tokio::fs::File::from_std(reader),
            tokio::fs::File::from_std(writer),
        )))
    }

    #[cfg(test)]
    pub(crate) fn from_duplex(stream: tokio::io::DuplexStream) -> Self {
        Self::new(stream)
    }

    pub(crate) async fn write_frame(&mut self, frame: &[u8]) -> Result<(), ()> {
        decode_json_frame(frame)?;
        self.stream.write_all(frame).await.map_err(|_| ())?;
        self.stream.flush().await.map_err(|_| ())
    }

    pub(crate) async fn read_frame(&mut self) -> Result<Vec<u8>, ()> {
        let mut length_bytes = [0_u8; 4];
        self.stream
            .read_exact(&mut length_bytes)
            .await
            .map_err(|_| ())?;
        let payload_length = u32::from_le_bytes(length_bytes) as usize;
        if payload_length == 0 || payload_length > WINDOWS_BRIDGE_MAX_FRAME_BYTES {
            return Err(());
        }
        let mut payload = vec![0_u8; payload_length];
        self.stream.read_exact(&mut payload).await.map_err(|_| ())?;
        let mut frame = Vec::with_capacity(payload_length + 4);
        frame.extend_from_slice(&length_bytes);
        frame.extend_from_slice(&payload);
        decode_json_frame(&frame)?;
        Ok(frame)
    }

    #[cfg(windows)]
    pub(crate) async fn copy_to(self, destination: Self) -> Result<(), ()> {
        let mut source = self.stream;
        let mut destination = destination.stream;
        tokio::io::copy(&mut source, &mut destination)
            .await
            .map(|_| ())
            .map_err(|_| ())
    }

    pub(crate) async fn relay_framed_bidirectional(self, other: Self) -> Result<(), ()> {
        let (left_reader, left_writer) = tokio::io::split(self.stream);
        let (right_reader, right_writer) = tokio::io::split(other.stream);
        tokio::select! {
            result = relay_framed_direction(left_reader, right_writer, None) => result,
            result = relay_framed_direction(right_reader, left_writer, None) => result,
        }
    }

    pub(crate) async fn relay_capability_framed_bidirectional(
        self,
        other: Self,
        reporter: Arc<dyn Fn(&'static str) + Send + Sync>,
    ) -> Result<(), ()> {
        let (main_reader, main_writer) = tokio::io::split(self.stream);
        let (worker_reader, worker_writer) = tokio::io::split(other.stream);
        tokio::select! {
            result = relay_framed_direction(
                main_reader,
                worker_writer,
                Some(RelayProgress {
                    reporter: reporter.clone(),
                    read_stage: "windows-capability-supervisor-response-read",
                    forwarded_stage: "windows-capability-supervisor-response-forwarded",
                }),
            ) => result,
            result = relay_framed_direction(
                worker_reader,
                main_writer,
                Some(RelayProgress {
                    reporter,
                    read_stage: "windows-capability-supervisor-request-read",
                    forwarded_stage: "windows-capability-supervisor-request-forwarded",
                }),
            ) => result,
        }
    }

    #[cfg(windows)]
    pub(crate) async fn read_once(&mut self, target: &mut [u8]) -> Result<usize, ()> {
        self.stream.read(target).await.map_err(|_| ())
    }
}

struct RelayProgress {
    reporter: Arc<dyn Fn(&'static str) + Send + Sync>,
    read_stage: &'static str,
    forwarded_stage: &'static str,
}

async fn relay_framed_direction<R, W>(
    mut source: R,
    mut destination: W,
    progress: Option<RelayProgress>,
) -> Result<(), ()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut read_reported = false;
    let mut forwarded_reported = false;
    loop {
        let mut length_bytes = [0_u8; 4];
        if source.read(&mut length_bytes[..1]).await.map_err(|_| ())? == 0 {
            return Ok(());
        }
        source
            .read_exact(&mut length_bytes[1..])
            .await
            .map_err(|_| ())?;
        let payload_length = u32::from_le_bytes(length_bytes) as usize;
        if payload_length == 0 || payload_length > WINDOWS_BRIDGE_MAX_FRAME_BYTES {
            return Err(());
        }
        let mut payload = vec![0_u8; payload_length];
        source.read_exact(&mut payload).await.map_err(|_| ())?;
        if !read_reported {
            if let Some(progress) = &progress {
                (progress.reporter)(progress.read_stage);
                read_reported = true;
            }
        }
        destination.write_all(&length_bytes).await.map_err(|_| ())?;
        destination.write_all(&payload).await.map_err(|_| ())?;
        destination.flush().await.map_err(|_| ())?;
        if !forwarded_reported {
            if let Some(progress) = &progress {
                (progress.reporter)(progress.forwarded_stage);
                forwarded_reported = true;
            }
        }
    }
}

#[derive(Debug)]
pub(crate) struct PendingRequests {
    ids: HashSet<String>,
    maximum: usize,
}

impl PendingRequests {
    pub(crate) fn new(maximum: usize) -> Result<Self, ()> {
        if maximum == 0 || maximum > WINDOWS_BRIDGE_MAX_PENDING_REQUESTS {
            return Err(());
        }
        Ok(Self {
            ids: HashSet::new(),
            maximum,
        })
    }

    pub(crate) fn begin(&mut self, request_id: &str) -> Result<(), ()> {
        if !is_bridge_token(request_id, 1, 128)
            || self.ids.len() >= self.maximum
            || !self.ids.insert(request_id.to_string())
        {
            return Err(());
        }
        Ok(())
    }

    pub(crate) fn complete(&mut self, request_id: &str) -> Result<(), ()> {
        self.remove(request_id)
    }

    pub(crate) fn cancel(&mut self, request_id: &str) -> Result<(), ()> {
        self.remove(request_id)
    }

    fn remove(&mut self, request_id: &str) -> Result<(), ()> {
        if !is_bridge_token(request_id, 1, 128) || !self.ids.remove(request_id) {
            return Err(());
        }
        Ok(())
    }
}

pub(crate) fn has_exact_keys(object: &Map<String, Value>, keys: &[&str]) -> bool {
    object.len() == keys.len() && object.keys().all(|key| keys.contains(&key.as_str()))
}

pub(crate) fn is_bridge_token(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))
}

pub(crate) fn exact_bridge_token(
    object: &Map<String, Value>,
    key: &str,
    minimum: usize,
    maximum: usize,
) -> Result<String, ()> {
    let value = object.get(key).and_then(Value::as_str).ok_or(())?;
    if !is_bridge_token(value, minimum, maximum) {
        return Err(());
    }
    Ok(value.to_string())
}

pub(crate) fn encode_json_frame(value: &Value) -> Result<Vec<u8>, ()> {
    let payload = serde_json::to_vec(value).map_err(|_| ())?;
    if payload.is_empty() || payload.len() > WINDOWS_BRIDGE_MAX_FRAME_BYTES {
        return Err(());
    }
    let payload_length = u32::try_from(payload.len()).map_err(|_| ())?;
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&payload_length.to_le_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub(crate) fn decode_json_frame(frame: &[u8]) -> Result<Value, ()> {
    let length_bytes: [u8; 4] = frame.get(..4).ok_or(())?.try_into().map_err(|_| ())?;
    let payload_length = u32::from_le_bytes(length_bytes) as usize;
    if payload_length == 0
        || payload_length > WINDOWS_BRIDGE_MAX_FRAME_BYTES
        || frame.len() != payload_length + 4
    {
        return Err(());
    }
    parse_strict_json(&frame[4..])
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tracks_only_bounded_unique_pending_requests() {
        assert!(PendingRequests::new(0).is_err());
        assert!(PendingRequests::new(WINDOWS_BRIDGE_MAX_PENDING_REQUESTS + 1).is_err());

        let mut pending = PendingRequests::new(2).unwrap();
        pending.begin("request-1").unwrap();
        assert!(pending.begin("request-1").is_err());
        pending.begin("request-2").unwrap();
        assert!(pending.begin("request-3").is_err());

        pending.complete("request-1").unwrap();
        assert!(pending.complete("request-1").is_err());
        pending.cancel("request-2").unwrap();
        assert!(pending.cancel("request-2").is_err());
        assert!(pending.complete("unknown").is_err());
    }

    #[tokio::test]
    async fn channel_transfers_only_one_bounded_strict_json_frame() {
        let (worker, main) = tokio::io::duplex(4096);
        let mut worker = WindowsBridgeChannel::from_duplex(worker);
        let mut main = WindowsBridgeChannel::from_duplex(main);
        let frame = encode_json_frame(&json!({"contractVersion": 1, "kind": "test"})).unwrap();

        worker.write_frame(&frame).await.unwrap();
        assert_eq!(main.read_frame().await.unwrap(), frame);
    }

    #[tokio::test]
    async fn framed_relay_forwards_both_directions_and_rejects_oversize() {
        let (main_side, relay_main) = tokio::io::duplex(4096);
        let (worker_side, relay_worker) = tokio::io::duplex(4096);
        let mut main_side = WindowsBridgeChannel::from_duplex(main_side);
        let mut worker_side = WindowsBridgeChannel::from_duplex(worker_side);
        let relay = tokio::spawn(
            WindowsBridgeChannel::from_duplex(relay_main)
                .relay_framed_bidirectional(WindowsBridgeChannel::from_duplex(relay_worker)),
        );
        let request = encode_json_frame(&json!({"contractVersion": 1, "kind": "request"})).unwrap();
        main_side.write_frame(&request).await.unwrap();
        assert_eq!(worker_side.read_frame().await.unwrap(), request);
        let response =
            encode_json_frame(&json!({"contractVersion": 1, "kind": "response"})).unwrap();
        worker_side.write_frame(&response).await.unwrap();
        assert_eq!(main_side.read_frame().await.unwrap(), response);
        drop((main_side, worker_side));
        assert!(relay.await.unwrap().is_ok());

        let (mut attacker, relay_main) = tokio::io::duplex(16);
        let (_worker, relay_worker) = tokio::io::duplex(16);
        let relay = tokio::spawn(
            WindowsBridgeChannel::from_duplex(relay_main)
                .relay_framed_bidirectional(WindowsBridgeChannel::from_duplex(relay_worker)),
        );
        attacker
            .write_all(&((WINDOWS_BRIDGE_MAX_FRAME_BYTES + 1) as u32).to_le_bytes())
            .await
            .unwrap();
        assert!(relay.await.unwrap().is_err());
    }

    #[tokio::test]
    async fn capability_relay_reports_request_and_response_boundaries_in_order() {
        let (main_side, relay_main) = tokio::io::duplex(4096);
        let (worker_side, relay_worker) = tokio::io::duplex(4096);
        let mut main_side = WindowsBridgeChannel::from_duplex(main_side);
        let mut worker_side = WindowsBridgeChannel::from_duplex(worker_side);
        let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let reporter_observed = observed.clone();
        let reporter: std::sync::Arc<dyn Fn(&'static str) + Send + Sync> =
            std::sync::Arc::new(move |stage| reporter_observed.lock().unwrap().push(stage));
        let relay = tokio::spawn(
            WindowsBridgeChannel::from_duplex(relay_main).relay_capability_framed_bidirectional(
                WindowsBridgeChannel::from_duplex(relay_worker),
                reporter,
            ),
        );

        let request = encode_json_frame(&json!({"contractVersion": 1, "kind": "request"})).unwrap();
        worker_side.write_frame(&request).await.unwrap();
        assert_eq!(main_side.read_frame().await.unwrap(), request);
        let response =
            encode_json_frame(&json!({"contractVersion": 1, "kind": "response"})).unwrap();
        main_side.write_frame(&response).await.unwrap();
        assert_eq!(worker_side.read_frame().await.unwrap(), response);
        let later_request =
            encode_json_frame(&json!({"contractVersion": 1, "kind": "later-request"})).unwrap();
        worker_side.write_frame(&later_request).await.unwrap();
        assert_eq!(main_side.read_frame().await.unwrap(), later_request);
        let later_response =
            encode_json_frame(&json!({"contractVersion": 1, "kind": "later-response"})).unwrap();
        main_side.write_frame(&later_response).await.unwrap();
        assert_eq!(worker_side.read_frame().await.unwrap(), later_response);
        drop((main_side, worker_side));
        assert!(relay.await.unwrap().is_ok());
        assert_eq!(
            *observed.lock().unwrap(),
            vec![
                "windows-capability-supervisor-request-read",
                "windows-capability-supervisor-request-forwarded",
                "windows-capability-supervisor-response-read",
                "windows-capability-supervisor-response-forwarded",
            ]
        );
    }

    #[tokio::test]
    async fn framed_relay_accepts_partial_headers_and_ends_on_disconnect() {
        let (mut sender, relay_left) = tokio::io::duplex(4096);
        let (relay_right, mut receiver) = tokio::io::duplex(4096);
        let relay = tokio::spawn(
            WindowsBridgeChannel::from_duplex(relay_left)
                .relay_framed_bidirectional(WindowsBridgeChannel::from_duplex(relay_right)),
        );
        let frame = encode_json_frame(&json!({"kind": "partial"})).unwrap();
        sender.write_all(&frame[..1]).await.unwrap();
        sender.write_all(&frame[1..3]).await.unwrap();
        sender.write_all(&frame[3..]).await.unwrap();
        drop(sender);
        let mut forwarded = vec![0_u8; frame.len()];
        receiver.read_exact(&mut forwarded).await.unwrap();
        assert_eq!(forwarded, frame);
        assert!(relay.await.unwrap().is_ok());
    }
}
