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

const WINDOWS_PROBE_FRAME_MAGIC: [u8; 4] = *b"AGWP";
const WINDOWS_PROBE_FRAME_VERSION: u8 = 1;
const WINDOWS_PROBE_FRAME_LENGTH: usize = 8;

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

pub(crate) fn encode_result(result: WindowsProbeResult) -> [u8; WINDOWS_PROBE_FRAME_LENGTH] {
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
    if bytes.len() != WINDOWS_PROBE_FRAME_LENGTH
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
        bounded_probe_metadata, decode_result, encode_result, parse_role, WindowsContainmentRole,
        WindowsProbeResult, WINDOWS_PROBE_CHILD_ARGUMENT, WINDOWS_PROBE_PARENT_ARGUMENT,
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
