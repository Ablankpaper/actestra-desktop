#[cfg(any(windows, test))]
pub(crate) const WINDOWS_PROBE_CHILD_ARGUMENT: &str = "--actestra-windows-containment-child-v1";
#[cfg(any(windows, test))]
pub(crate) const WINDOWS_PROBE_PARENT_ARGUMENT: &str = "--actestra-windows-containment-parent-v1";

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsContainmentRole {
    Child,
    IntermediateParent,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowsProbeResult {
    pub(crate) filesystem_attempted: bool,
    pub(crate) filesystem_denied: bool,
    pub(crate) network_attempted: bool,
    pub(crate) network_denied: bool,
    pub(crate) process_attempted: bool,
    pub(crate) process_denied: bool,
    pub(crate) environment_canary_absent: bool,
    pub(crate) excluded_handle_absent: bool,
}

#[cfg(any(windows, test))]
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WindowsProbeRequest {
    outside_read_path: String,
    outside_write_path: String,
    loopback_port: u16,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowsParentDeathReady {
    pub(crate) worker_process_id: u32,
}

const WINDOWS_PROBE_REQUEST_MAGIC: [u8; 4] = *b"AGWQ";
const WINDOWS_PROBE_REQUEST_VERSION: u8 = 1;
const WINDOWS_PROBE_REQUEST_HEADER_LENGTH: usize = 20;
const WINDOWS_PROBE_REQUEST_MAX_PATH_BYTES: usize = 2_048;
pub(crate) const WINDOWS_PROBE_REQUEST_MAX_FRAME_BYTES: usize =
    WINDOWS_PROBE_REQUEST_HEADER_LENGTH + 2 * WINDOWS_PROBE_REQUEST_MAX_PATH_BYTES;

const WINDOWS_PROBE_FRAME_MAGIC: [u8; 4] = *b"AGWP";
const WINDOWS_PROBE_FRAME_VERSION: u8 = 1;
pub(crate) const WINDOWS_PROBE_RESULT_FRAME_LENGTH: usize = 8;
const WINDOWS_PARENT_DEATH_REQUEST_MAGIC: [u8; 4] = *b"AGPD";
const WINDOWS_PARENT_DEATH_READY_MAGIC: [u8; 4] = *b"AGPR";
const WINDOWS_PARENT_DEATH_FRAME_VERSION: u8 = 1;
pub(crate) const WINDOWS_PARENT_DEATH_REQUEST_LENGTH: usize = 38;
pub(crate) const WINDOWS_PARENT_DEATH_READY_LENGTH: usize = 12;

pub(crate) fn encode_parent_death_request(
    attempt_id: &str,
) -> Result<[u8; WINDOWS_PARENT_DEATH_REQUEST_LENGTH], ()> {
    if attempt_id.len() != 32
        || !attempt_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(());
    }
    let mut frame = [0_u8; WINDOWS_PARENT_DEATH_REQUEST_LENGTH];
    frame[..4].copy_from_slice(&WINDOWS_PARENT_DEATH_REQUEST_MAGIC);
    frame[4] = WINDOWS_PARENT_DEATH_FRAME_VERSION;
    frame[6..].copy_from_slice(attempt_id.as_bytes());
    Ok(frame)
}

pub(crate) fn decode_parent_death_request(bytes: &[u8]) -> Result<&str, ()> {
    if bytes.len() != WINDOWS_PARENT_DEATH_REQUEST_LENGTH
        || bytes[..4] != WINDOWS_PARENT_DEATH_REQUEST_MAGIC
        || bytes[4] != WINDOWS_PARENT_DEATH_FRAME_VERSION
        || bytes[5] != 0
    {
        return Err(());
    }
    let attempt_id = std::str::from_utf8(&bytes[6..]).map_err(|_| ())?;
    encode_parent_death_request(attempt_id)?;
    Ok(attempt_id)
}

pub(crate) fn encode_parent_death_ready(
    ready: WindowsParentDeathReady,
) -> [u8; WINDOWS_PARENT_DEATH_READY_LENGTH] {
    let mut frame = [0_u8; WINDOWS_PARENT_DEATH_READY_LENGTH];
    frame[..4].copy_from_slice(&WINDOWS_PARENT_DEATH_READY_MAGIC);
    frame[4] = WINDOWS_PARENT_DEATH_FRAME_VERSION;
    frame[5] = 1;
    frame[8..].copy_from_slice(&ready.worker_process_id.to_le_bytes());
    frame
}

pub(crate) fn decode_parent_death_ready(bytes: &[u8]) -> Result<WindowsParentDeathReady, ()> {
    if bytes.len() != WINDOWS_PARENT_DEATH_READY_LENGTH
        || bytes[..4] != WINDOWS_PARENT_DEATH_READY_MAGIC
        || bytes[4] != WINDOWS_PARENT_DEATH_FRAME_VERSION
        || bytes[5] != 1
        || bytes[6..8] != [0, 0]
    {
        return Err(());
    }
    let worker_process_id = u32::from_le_bytes(bytes[8..].try_into().map_err(|_| ())?);
    if worker_process_id == 0 {
        return Err(());
    }
    Ok(WindowsParentDeathReady { worker_process_id })
}

impl WindowsProbeRequest {
    pub(crate) fn new(
        outside_read_path: String,
        outside_write_path: String,
        loopback_port: u16,
    ) -> Result<Self, ()> {
        if !is_bounded_probe_path(&outside_read_path)
            || !is_bounded_probe_path(&outside_write_path)
            || loopback_port == 0
        {
            return Err(());
        }
        Ok(Self {
            outside_read_path,
            outside_write_path,
            loopback_port,
        })
    }

    #[cfg(windows)]
    pub(crate) fn outside_read_path(&self) -> &str {
        &self.outside_read_path
    }

    #[cfg(windows)]
    pub(crate) fn outside_write_path(&self) -> &str {
        &self.outside_write_path
    }

    #[cfg(windows)]
    pub(crate) fn loopback_port(&self) -> u16 {
        self.loopback_port
    }
}

fn is_bounded_probe_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= WINDOWS_PROBE_REQUEST_MAX_PATH_BYTES
        && !value.chars().any(char::is_control)
}

/// Carries the parent-verified excluded-handle verdict. The raw handle value never crosses this
/// boundary: the supervisor proves absence against the Worker handle table before the Worker is
/// resumed, and the contained child only echoes the resulting boolean into its result frame.
pub(crate) fn encode_request_frame(
    request: &WindowsProbeRequest,
    excluded_handle_absent: bool,
) -> Result<Vec<u8>, ()> {
    let read_path = request.outside_read_path.as_bytes();
    let write_path = request.outside_write_path.as_bytes();
    let read_length = u16::try_from(read_path.len()).map_err(|_| ())?;
    let write_length = u16::try_from(write_path.len()).map_err(|_| ())?;
    let frame_length = WINDOWS_PROBE_REQUEST_HEADER_LENGTH
        .checked_add(read_path.len())
        .and_then(|length| length.checked_add(write_path.len()))
        .filter(|length| *length <= WINDOWS_PROBE_REQUEST_MAX_FRAME_BYTES)
        .ok_or(())?;
    let mut frame = Vec::with_capacity(frame_length);
    frame.extend_from_slice(&WINDOWS_PROBE_REQUEST_MAGIC);
    frame.push(WINDOWS_PROBE_REQUEST_VERSION);
    frame.push(0);
    frame.extend_from_slice(&request.loopback_port.to_le_bytes());
    frame.push(u8::from(excluded_handle_absent));
    frame.extend_from_slice(&[0; 7]);
    frame.extend_from_slice(&read_length.to_le_bytes());
    frame.extend_from_slice(&write_length.to_le_bytes());
    frame.extend_from_slice(read_path);
    frame.extend_from_slice(write_path);
    Ok(frame)
}

pub(crate) fn decode_request_frame(bytes: &[u8]) -> Result<(WindowsProbeRequest, bool), ()> {
    if bytes.len() < WINDOWS_PROBE_REQUEST_HEADER_LENGTH
        || bytes.len() > WINDOWS_PROBE_REQUEST_MAX_FRAME_BYTES
        || bytes[..4] != WINDOWS_PROBE_REQUEST_MAGIC
        || bytes[4] != WINDOWS_PROBE_REQUEST_VERSION
        || bytes[5] != 0
    {
        return Err(());
    }
    let loopback_port = u16::from_le_bytes(bytes[6..8].try_into().map_err(|_| ())?);
    let excluded_handle_absent = match bytes[8] {
        0 => false,
        1 => true,
        _ => return Err(()),
    };
    if bytes[9..16] != [0; 7] {
        return Err(());
    }
    let read_length = u16::from_le_bytes(bytes[16..18].try_into().map_err(|_| ())?) as usize;
    let write_length = u16::from_le_bytes(bytes[18..20].try_into().map_err(|_| ())?) as usize;
    let expected_length = WINDOWS_PROBE_REQUEST_HEADER_LENGTH
        .checked_add(read_length)
        .and_then(|length| length.checked_add(write_length))
        .filter(|length| *length == bytes.len())
        .ok_or(())?;
    let read_end = WINDOWS_PROBE_REQUEST_HEADER_LENGTH
        .checked_add(read_length)
        .filter(|end| *end <= expected_length)
        .ok_or(())?;
    let outside_read_path =
        std::str::from_utf8(&bytes[WINDOWS_PROBE_REQUEST_HEADER_LENGTH..read_end])
            .map_err(|_| ())?
            .to_string();
    let outside_write_path = std::str::from_utf8(&bytes[read_end..expected_length])
        .map_err(|_| ())?
        .to_string();
    let request = WindowsProbeRequest::new(outside_read_path, outside_write_path, loopback_port)?;
    Ok((request, excluded_handle_absent))
}

pub(crate) fn parse_role(arguments: &[String]) -> Result<Option<WindowsContainmentRole>, ()> {
    match arguments {
        [_program] => Ok(None),
        [_program, value] if value == WINDOWS_PROBE_CHILD_ARGUMENT => {
            Ok(Some(WindowsContainmentRole::Child))
        }
        [_program, value] if value == WINDOWS_PROBE_PARENT_ARGUMENT => {
            Ok(Some(WindowsContainmentRole::IntermediateParent))
        }
        _ => Err(()),
    }
}

pub(crate) fn admit_probe_role(
    arguments: &[String],
    probe_marker: Option<&str>,
) -> Result<Option<WindowsContainmentRole>, ()> {
    match parse_role(arguments)? {
        Some(role) if probe_marker == Some("1") => Ok(Some(role)),
        Some(_) => Err(()),
        None => Ok(None),
    }
}

pub(crate) fn encode_result(result: WindowsProbeResult) -> [u8; WINDOWS_PROBE_RESULT_FRAME_LENGTH] {
    let flags = u8::from(result.filesystem_attempted)
        | (u8::from(result.filesystem_denied) << 1)
        | (u8::from(result.network_attempted) << 2)
        | (u8::from(result.network_denied) << 3)
        | (u8::from(result.process_attempted) << 4)
        | (u8::from(result.process_denied) << 5)
        | (u8::from(result.environment_canary_absent) << 6)
        | (u8::from(result.excluded_handle_absent) << 7);
    [
        WINDOWS_PROBE_FRAME_MAGIC[0],
        WINDOWS_PROBE_FRAME_MAGIC[1],
        WINDOWS_PROBE_FRAME_MAGIC[2],
        WINDOWS_PROBE_FRAME_MAGIC[3],
        WINDOWS_PROBE_FRAME_VERSION,
        flags,
        0,
        0,
    ]
}

pub(crate) fn decode_result(bytes: &[u8]) -> Result<WindowsProbeResult, ()> {
    if bytes.len() != WINDOWS_PROBE_RESULT_FRAME_LENGTH
        || bytes[..4] != WINDOWS_PROBE_FRAME_MAGIC
        || bytes[4] != WINDOWS_PROBE_FRAME_VERSION
        || bytes[6..] != [0, 0]
    {
        return Err(());
    }
    let flags = bytes[5];
    Ok(WindowsProbeResult {
        filesystem_attempted: flags & (1 << 0) != 0,
        filesystem_denied: flags & (1 << 1) != 0,
        network_attempted: flags & (1 << 2) != 0,
        network_denied: flags & (1 << 3) != 0,
        process_attempted: flags & (1 << 4) != 0,
        process_denied: flags & (1 << 5) != 0,
        environment_canary_absent: flags & (1 << 6) != 0,
        excluded_handle_absent: flags & (1 << 7) != 0,
    })
}

pub(crate) fn bounded_probe_metadata(value: Option<String>, max_length: usize) -> String {
    value
        .filter(|candidate| {
            !candidate.is_empty()
                && candidate.len() <= max_length
                && candidate
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        admit_probe_role, bounded_probe_metadata, decode_parent_death_ready,
        decode_parent_death_request, decode_request_frame, decode_result,
        encode_parent_death_ready, encode_parent_death_request, encode_request_frame,
        encode_result, parse_role, WindowsContainmentRole, WindowsParentDeathReady,
        WindowsProbeRequest, WindowsProbeResult, WINDOWS_PROBE_CHILD_ARGUMENT,
        WINDOWS_PROBE_PARENT_ARGUMENT,
    };

    fn argv(arguments: &[&str]) -> Vec<String> {
        arguments.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn parses_only_exact_probe_roles() {
        assert_eq!(
            parse_role(&argv(&["runner.exe", WINDOWS_PROBE_CHILD_ARGUMENT])).unwrap(),
            Some(WindowsContainmentRole::Child)
        );
        assert_eq!(
            parse_role(&argv(&["runner.exe", WINDOWS_PROBE_PARENT_ARGUMENT])).unwrap(),
            Some(WindowsContainmentRole::IntermediateParent)
        );
        assert_eq!(parse_role(&argv(&["runner.exe"])).unwrap(), None);
        assert!(parse_role(&argv(&["runner.exe", "--unknown"])).is_err());
        assert!(parse_role(&argv(&[
            "runner.exe",
            WINDOWS_PROBE_CHILD_ARGUMENT,
            WINDOWS_PROBE_CHILD_ARGUMENT,
        ]))
        .is_err());
    }

    #[test]
    fn admits_probe_roles_only_under_the_exact_probe_marker() {
        let child = argv(&["runner.exe", WINDOWS_PROBE_CHILD_ARGUMENT]);
        assert_eq!(
            admit_probe_role(&child, Some("1")).unwrap(),
            Some(WindowsContainmentRole::Child)
        );
        assert!(admit_probe_role(&child, None).is_err());
        assert!(admit_probe_role(&child, Some("true")).is_err());
        assert_eq!(
            admit_probe_role(&argv(&["runner.exe"]), None).unwrap(),
            None
        );
    }

    #[test]
    fn encodes_and_decodes_one_exact_fixed_result_frame() {
        let result = WindowsProbeResult {
            filesystem_attempted: true,
            filesystem_denied: true,
            network_attempted: true,
            network_denied: false,
            process_attempted: true,
            process_denied: true,
            environment_canary_absent: true,
            excluded_handle_absent: true,
        };
        assert_eq!(decode_result(&encode_result(result)).unwrap(), result);
        assert!(decode_result(&[0; 8]).is_err());
        let mut encoded = encode_result(result).to_vec();
        encoded.push(0);
        assert!(decode_result(&encoded).is_err());
        encoded = encode_result(result).to_vec();
        encoded[7] = 1;
        assert!(decode_result(&encoded).is_err());
    }

    #[test]
    fn encodes_and_decodes_one_bounded_internal_request_frame() {
        let request = WindowsProbeRequest::new(
            r"C:\probe\outside-input.txt".to_string(),
            r"C:\probe\outside-output.txt".to_string(),
            49_152,
        )
        .unwrap();
        let frame = encode_request_frame(&request, true).unwrap();
        let (decoded, excluded_handle_absent) = decode_request_frame(&frame).unwrap();

        assert_eq!(decoded, request);
        assert!(excluded_handle_absent);
        let mut trailing = frame.clone();
        trailing.push(0);
        assert!(decode_request_frame(&trailing).is_err());
        let mut reserved = frame;
        reserved[5] = 1;
        assert!(decode_request_frame(&reserved).is_err());
        let mut invalid_boolean = encode_request_frame(&request, false).unwrap();
        invalid_boolean[8] = 2;
        assert!(decode_request_frame(&invalid_boolean).is_err());
        let mut nonzero_padding = encode_request_frame(&request, false).unwrap();
        nonzero_padding[9] = 1;
        assert!(decode_request_frame(&nonzero_padding).is_err());
    }

    #[test]
    fn rejects_unbounded_or_ambiguous_internal_request_values() {
        assert!(WindowsProbeRequest::new("".to_string(), "C:\\out".to_string(), 1).is_err());
        assert!(
            WindowsProbeRequest::new("C:\\in".to_string(), "C:\\out\0hidden".to_string(), 1,)
                .is_err()
        );
        assert!(WindowsProbeRequest::new(
            format!("C:\\\\{}", "x".repeat(2_048)),
            "C:\\out".to_string(),
            1,
        )
        .is_err());
        assert!(WindowsProbeRequest::new("C:\\in".to_string(), "C:\\out".to_string(), 0).is_err());
    }

    #[test]
    fn round_trips_fixed_parent_death_request_and_ready_frames() {
        let attempt_id = "0123456789abcdef0123456789abcdef";
        let request = encode_parent_death_request(attempt_id).unwrap();
        assert_eq!(decode_parent_death_request(&request).unwrap(), attempt_id);

        let ready = WindowsParentDeathReady {
            worker_process_id: 4_242,
        };
        assert_eq!(
            decode_parent_death_ready(&encode_parent_death_ready(ready)).unwrap(),
            ready
        );
    }

    #[test]
    fn rejects_ambiguous_parent_death_frames() {
        assert!(encode_parent_death_request("short").is_err());
        let mut request = encode_parent_death_request("0123456789abcdef0123456789abcdef")
            .unwrap()
            .to_vec();
        request.push(0);
        assert!(decode_parent_death_request(&request).is_err());
        assert!(decode_parent_death_ready(&[0; 12]).is_err());
        assert!(
            decode_parent_death_ready(&encode_parent_death_ready(WindowsParentDeathReady {
                worker_process_id: 0,
            }))
            .is_err()
        );
    }

    #[test]
    fn bounds_probe_metadata_to_safe_target_and_digest_values() {
        assert_eq!(
            bounded_probe_metadata(Some("x86_64-pc-windows-msvc".to_string()), 32),
            "x86_64-pc-windows-msvc"
        );
        assert_eq!(
            bounded_probe_metadata(Some("../outside".to_string()), 32),
            ""
        );
        assert_eq!(bounded_probe_metadata(Some("x".repeat(33)), 32), "");
        assert_eq!(bounded_probe_metadata(None, 32), "");
    }
}
