#[cfg(target_os = "linux")]
use std::fs::File;
#[cfg(target_os = "linux")]
use std::io::Read;

#[cfg(target_os = "linux")]
pub(crate) const BOOTSTRAP_ARGUMENT: &str = "--actestra-linux-bootstrap-check";
#[cfg(target_os = "linux")]
pub(crate) const BOOTSTRAP_OK: &str = "ACTESTRA_GOOSE_LINUX_BOOTSTRAP_OK";
#[cfg(target_os = "linux")]
pub(crate) const BOOTSTRAP_FAILED: &str = "ACTESTRA_GOOSE_LINUX_BOOTSTRAP_FAILED";
pub(crate) const GOOSE_EXECUTABLE_PATH: &str =
    "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner";

const APPARMOR_PROFILE: &str = "Actestra-Goose-Runner (unconfined)";
#[cfg(target_os = "linux")]
const MAX_HOST_STATE_BYTES: u64 = 256;

fn is_exact_line(value: &str, expected: &str) -> bool {
    value == expected || value.strip_suffix('\n') == Some(expected)
}

pub(crate) fn verify_bootstrap_inputs(
    executable_path: &str,
    apparmor_profile: &str,
    apparmor_enabled: &str,
    restricted_user_namespaces: &str,
) -> Result<(), ()> {
    if executable_path != GOOSE_EXECUTABLE_PATH
        || !is_exact_line(apparmor_profile, APPARMOR_PROFILE)
        || !is_exact_line(apparmor_enabled, "Y")
        || !is_exact_line(restricted_user_namespaces, "1")
    {
        return Err(());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn read_bounded(file_path: &str) -> Result<String, ()> {
    let mut bytes = Vec::new();
    File::open(file_path)
        .map_err(|_| ())?
        .take(MAX_HOST_STATE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > MAX_HOST_STATE_BYTES {
        return Err(());
    }
    String::from_utf8(bytes).map_err(|_| ())
}

#[cfg(target_os = "linux")]
pub(crate) fn verify_current_linux_bootstrap() -> Result<(), ()> {
    let executable = std::fs::canonicalize("/proc/self/exe")
        .map_err(|_| ())?
        .into_os_string()
        .into_string()
        .map_err(|_| ())?;
    verify_bootstrap_inputs(
        &executable,
        &read_bounded("/proc/self/attr/current")?,
        &read_bounded("/sys/module/apparmor/parameters/enabled")?,
        &read_bounded("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_one_optional_terminal_line_feed_only() {
        assert!(is_exact_line("Y", "Y"));
        assert!(is_exact_line("Y\n", "Y"));
        assert!(!is_exact_line("Y\n\n", "Y"));
        assert!(!is_exact_line("Y\r\n", "Y"));
    }
}
