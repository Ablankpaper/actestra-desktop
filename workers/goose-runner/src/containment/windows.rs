#[cfg(windows)]
use super::parse_resource_limits_with;
#[cfg(windows)]
use std::env;

#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(any(windows, test))]
use super::windows_contract::WindowsProbeResult;
#[cfg(windows)]
use super::windows_contract::{
    admit_probe_role, bounded_probe_metadata, WindowsContainmentRole, WindowsProbeRequest,
    WINDOWS_PROBE_CHILD_ARGUMENT,
};
#[cfg(windows)]
use crate::windows_supervisor::{
    launch_windows_containment_worker, read_windows_probe_request, write_windows_probe_result,
    ProbeHandle,
};

#[cfg(windows)]
const WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_WINDOWS_CONTAINMENT_ROLE_FAILED";

#[cfg(windows)]
pub(crate) fn apply_resource_limits() -> Result<(), ()> {
    parse_resource_limits_with(|key| env::var(key).ok())?;
    Err(())
}

#[cfg(windows)]
pub(crate) fn watch_parent_liveness() {}

#[cfg(any(windows, test))]
fn is_closed_filesystem_denial(kind: std::io::ErrorKind, raw_code: Option<i32>) -> bool {
    kind == std::io::ErrorKind::PermissionDenied || raw_code == Some(5)
}

#[cfg(any(windows, test))]
fn is_closed_network_denial(raw_code: Option<i32>) -> bool {
    raw_code == Some(10_013)
}

#[cfg(any(windows, test))]
fn is_closed_process_denial(raw_code: Option<i32>) -> bool {
    matches!(raw_code, Some(5 | 1_816))
}

#[cfg(any(windows, test))]
fn hostile_result_complete(result: &WindowsProbeResult) -> bool {
    result.filesystem_attempted
        && result.filesystem_denied
        && result.network_attempted
        && result.network_denied
        && result.process_attempted
        && result.process_denied
        && result.environment_canary_absent
        && result.excluded_handle_absent
}

#[cfg(windows)]
pub(crate) fn dispatch_windows_containment_role(arguments: &[String]) -> Option<i32> {
    match admit_probe_role(arguments, Some("1")) {
        Ok(Some(WindowsContainmentRole::Child)) => Some(run_probe_child()),
        Ok(Some(WindowsContainmentRole::IntermediateParent)) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            Some(1)
        }
        Ok(None) => None,
        Err(()) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            Some(1)
        }
    }
}

#[cfg(windows)]
fn run_probe_child() -> i32 {
    let (request, excluded_handle_absent) = match read_windows_probe_request() {
        Ok(request) => request,
        Err(()) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    };
    let result = execute_windows_hostile_probe(&request, excluded_handle_absent);
    if write_windows_probe_result(result).is_err() {
        eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
        return 1;
    }
    0
}

#[cfg(windows)]
fn execute_windows_hostile_probe(
    request: &WindowsProbeRequest,
    excluded_handle_absent: bool,
) -> WindowsProbeResult {
    let read_path = Path::new(request.outside_read_path());
    let write_path = Path::new(request.outside_write_path());
    if !read_path.is_absolute() || !write_path.is_absolute() {
        return incomplete_hostile_result(excluded_handle_absent);
    }

    let read_denied = match fs::read(read_path) {
        Ok(_) => false,
        Err(error) => is_closed_filesystem_denial(error.kind(), error.raw_os_error()),
    };
    let write_denied = match fs::write(write_path, b"forbidden") {
        Ok(()) => false,
        Err(error) => is_closed_filesystem_denial(error.kind(), error.raw_os_error()),
    };

    let address = SocketAddr::V4(SocketAddrV4::new(
        Ipv4Addr::LOCALHOST,
        request.loopback_port(),
    ));
    let network_denied = match TcpStream::connect_timeout(&address, Duration::from_secs(2)) {
        Ok(stream) => {
            drop(stream);
            false
        }
        Err(error) => is_closed_network_denial(error.raw_os_error()),
    };

    let process_denied = match env::current_exe().and_then(|executable| {
        Command::new(executable)
            .arg(WINDOWS_PROBE_CHILD_ARGUMENT)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    }) {
        Ok(mut child) => {
            let _ = child.kill();
            let _ = child.wait();
            false
        }
        Err(error) => is_closed_process_denial(error.raw_os_error()),
    };

    WindowsProbeResult {
        filesystem_attempted: true,
        filesystem_denied: read_denied && write_denied,
        network_attempted: true,
        network_denied,
        process_attempted: true,
        process_denied,
        environment_canary_absent: env::var_os("ACTESTRA_ENVIRONMENT_CANARY").is_none(),
        excluded_handle_absent,
    }
}

#[cfg(windows)]
fn incomplete_hostile_result(excluded_handle_absent: bool) -> WindowsProbeResult {
    WindowsProbeResult {
        filesystem_attempted: false,
        filesystem_denied: false,
        network_attempted: false,
        network_denied: false,
        process_attempted: false,
        process_denied: false,
        environment_canary_absent: env::var_os("ACTESTRA_ENVIRONMENT_CANARY").is_none(),
        excluded_handle_absent,
    }
}

#[cfg(windows)]
struct WindowsHostileEvidence {
    filesystem: bool,
    network: bool,
    process_tree: bool,
    resources: bool,
}

#[cfg(windows)]
fn unique_probe_attempt_id() -> String {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let sequence = u128::from(SEQUENCE.fetch_add(1, Ordering::Relaxed));
    format!(
        "{:032x}",
        elapsed ^ sequence ^ u128::from(std::process::id())
    )
}

#[cfg(windows)]
fn collect_windows_hostile_evidence() -> Result<WindowsHostileEvidence, ()> {
    if env::var_os("ACTESTRA_ENVIRONMENT_CANARY").is_some() {
        return Err(());
    }
    let attempt_id = unique_probe_attempt_id();
    let probe_root = env::temp_dir().join(format!("actestra-goose-containment-{attempt_id}"));
    let local_app_data = probe_root.join("local-app-data");
    let outside_root = probe_root.join("outside");
    fs::create_dir_all(&local_app_data).map_err(|_| ())?;
    fs::create_dir_all(&outside_root).map_err(|_| ())?;
    env::set_var("LOCALAPPDATA", &local_app_data);

    let outside_input = outside_root.join("input.txt");
    let outside_output = outside_root.join("output.txt");
    let outside_bytes = b"outside-sentinel";
    fs::write(&outside_input, outside_bytes).map_err(|_| ())?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|_| ())?;
    let port = listener.local_addr().map_err(|_| ())?.port();
    listener.set_nonblocking(true).map_err(|_| ())?;

    let executable = env::current_exe().map_err(|_| ())?;
    let current_directory = executable.parent().ok_or(())?;
    let request = WindowsProbeRequest::new(
        outside_input.to_str().ok_or(())?.to_string(),
        outside_output.to_str().ok_or(())?.to_string(),
        port,
    )?;
    let excluded_handle = ProbeHandle::create()?;
    let mut launch = launch_windows_containment_worker(
        &attempt_id,
        &executable,
        current_directory,
        WINDOWS_PROBE_CHILD_ARGUMENT,
        &excluded_handle,
    )
    .map_err(|_| ())?;
    let observation = launch.observation()?;
    let result = launch.exchange_probe_request(&request)?;

    let outside_unchanged =
        fs::read(&outside_input).map_err(|_| ())? == outside_bytes && !outside_output.exists();
    let no_connection = match listener.accept() {
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => true,
        Ok((stream, _)) => {
            drop(stream);
            false
        }
        Err(_) => false,
    };
    let evidence = WindowsHostileEvidence {
        filesystem: result.filesystem_attempted && result.filesystem_denied && outside_unchanged,
        network: result.network_attempted && result.network_denied && no_connection,
        process_tree: result.process_attempted
            && result.process_denied
            && observation.single_active_process,
        resources: observation.app_container
            && observation.assigned_before_resume
            && observation.resumed_once
            && observation.exact_job_limits,
    };
    drop(launch);
    drop(excluded_handle);
    drop(listener);
    fs::remove_dir_all(&probe_root).map_err(|_| ())?;
    if !hostile_result_complete(&result) {
        return Err(());
    }
    Ok(evidence)
}

#[cfg(windows)]
pub(crate) fn run_windows_containment_probe() -> String {
    let evidence = collect_windows_hostile_evidence().ok();
    serde_json::json!({
        "contractVersion": 1,
        "targetTriple": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_TARGET_TRIPLE").ok(), 128),
        "sourceCommit": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_SOURCE_COMMIT").ok(), 40),
        "probeSha256": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_PROBE_SHA256").ok(), 64),
        "executableSha256": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_EXECUTABLE_SHA256").ok(), 64),
        "filesystem": evidence.as_ref().is_some_and(|value| value.filesystem),
        "network": evidence.as_ref().is_some_and(|value| value.network),
        "processTree": evidence.as_ref().is_some_and(|value| value.process_tree),
        "resources": evidence.as_ref().is_some_and(|value| value.resources),
        "parentDeath": false,
        "cleanup": false,
        "status": "evidence-incomplete",
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        hostile_result_complete, is_closed_filesystem_denial, is_closed_network_denial,
        is_closed_process_denial, WindowsProbeResult,
    };
    use std::io::ErrorKind;

    #[test]
    fn accepts_only_closed_native_denial_classes() {
        assert!(is_closed_filesystem_denial(
            ErrorKind::PermissionDenied,
            None
        ));
        assert!(is_closed_filesystem_denial(ErrorKind::Other, Some(5)));
        assert!(!is_closed_filesystem_denial(ErrorKind::NotFound, Some(2)));
        assert!(is_closed_network_denial(Some(10_013)));
        assert!(!is_closed_network_denial(Some(10_061)));
        assert!(is_closed_process_denial(Some(5)));
        assert!(is_closed_process_denial(Some(1_816)));
        assert!(!is_closed_process_denial(Some(2)));
    }

    #[test]
    fn requires_every_hostile_attempt_and_denial() {
        let mut result = WindowsProbeResult {
            filesystem_attempted: true,
            filesystem_denied: true,
            network_attempted: true,
            network_denied: true,
            process_attempted: true,
            process_denied: true,
            environment_canary_absent: true,
            excluded_handle_absent: true,
        };
        assert!(hostile_result_complete(&result));
        result.process_attempted = false;
        assert!(!hostile_result_complete(&result));
    }
}
