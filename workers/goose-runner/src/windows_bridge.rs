use crate::windows_control::parse_strict_json;
use serde_json::{Map, Value};
use std::collections::HashSet;
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
}
