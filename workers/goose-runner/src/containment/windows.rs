#[cfg(windows)]
use super::parse_resource_limits_with;
#[cfg(windows)]
use std::env;

#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::io::{Read, Write};
#[cfg(windows)]
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::sync::mpsc;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(any(windows, test))]
use super::windows_contract::WindowsProbeResult;
#[cfg(windows)]
use super::windows_contract::{
    admit_probe_role, bounded_probe_metadata, decode_parent_death_ready,
    decode_parent_death_request, encode_parent_death_ready, encode_parent_death_request,
    WindowsContainmentRole, WindowsParentDeathReady, WindowsProbeRequest,
    WINDOWS_PARENT_DEATH_READY_LENGTH, WINDOWS_PARENT_DEATH_REQUEST_LENGTH,
    WINDOWS_PROBE_CHILD_ARGUMENT,
};
#[cfg(windows)]
use crate::windows_supervisor::{
    launch_windows_containment_worker, open_windows_probe_process, read_windows_probe_request,
    remove_windows_probe_profile, write_windows_probe_result, ProbeHandle, WindowsCleanupReceipt,
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
            Some(run_probe_intermediate_parent())
        }
        Ok(None) => None,
        Err(()) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            Some(1)
        }
    }
}

#[cfg(windows)]
fn run_probe_intermediate_parent() -> i32 {
    let mut request = [0_u8; WINDOWS_PARENT_DEATH_REQUEST_LENGTH];
    if std::io::stdin().read_exact(&mut request).is_err() {
        eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
        return 1;
    }
    let attempt_id = match decode_parent_death_request(&request) {
        Ok(attempt_id) => attempt_id.to_string(),
        Err(()) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    };
    let executable = match env::current_exe() {
        Ok(executable) => executable,
        Err(_) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    };
    let Some(current_directory) = executable.parent() else {
        eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
        return 1;
    };
    let excluded_handle = match ProbeHandle::create() {
        Ok(handle) => handle,
        Err(()) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    };
    let launch = match launch_windows_containment_worker(
        &attempt_id,
        &executable,
        current_directory,
        WINDOWS_PROBE_CHILD_ARGUMENT,
        &excluded_handle,
    ) {
        Ok(launch) => launch,
        Err(_) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    };
    let worker_process_id = match launch.worker_process_id() {
        Ok(process_id) => process_id,
        Err(()) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    };
    let ready = encode_parent_death_ready(WindowsParentDeathReady { worker_process_id });
    {
        let stdout = std::io::stdout();
        let mut output = stdout.lock();
        if output.write_all(&ready).is_err() || output.flush().is_err() {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return 1;
        }
    }

    let _launch = launch;
    let _excluded_handle = excluded_handle;
    loop {
        thread::park();
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
    parent_death: bool,
    cleanup: bool,
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
fn run_windows_parent_death_probe() -> (bool, WindowsCleanupReceipt) {
    let attempt_id = unique_probe_attempt_id();
    let private_root = env::temp_dir().join(format!("actestra-goose-parent-death-{attempt_id}"));
    let local_app_data = private_root.join("local-app-data");
    if fs::create_dir_all(&local_app_data).is_err() {
        return (
            false,
            WindowsCleanupReceipt {
                worker_terminal: false,
                profile_removed: false,
                private_root_removed: false,
            },
        );
    }
    let executable = match env::current_exe() {
        Ok(executable) => executable,
        Err(_) => {
            return incomplete_parent_death_cleanup(&attempt_id, &private_root, false);
        }
    };
    let mut intermediate = match Command::new(executable)
        .arg(super::windows_contract::WINDOWS_PROBE_PARENT_ARGUMENT)
        .env("ACTESTRA_GOOSE_CONTAINMENT_PROBE", "1")
        .env("LOCALAPPDATA", &local_app_data)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(intermediate) => intermediate,
        Err(_) => {
            return incomplete_parent_death_cleanup(&attempt_id, &private_root, false);
        }
    };
    let request = match encode_parent_death_request(&attempt_id) {
        Ok(request) => request,
        Err(()) => {
            let _ = intermediate.kill();
            let _ = intermediate.wait();
            return incomplete_parent_death_cleanup(&attempt_id, &private_root, false);
        }
    };
    let request_written = intermediate
        .stdin
        .take()
        .is_some_and(|mut input| input.write_all(&request).is_ok());
    let output = intermediate.stdout.take();
    if !request_written {
        let _ = intermediate.kill();
        let _ = intermediate.wait();
        return incomplete_parent_death_cleanup(&attempt_id, &private_root, false);
    }
    let Some(mut output) = output else {
        let _ = intermediate.kill();
        let _ = intermediate.wait();
        return incomplete_parent_death_cleanup(&attempt_id, &private_root, false);
    };

    let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
    let ready_reader = thread::spawn(move || {
        let mut frame = [0_u8; WINDOWS_PARENT_DEATH_READY_LENGTH];
        let result = output
            .read_exact(&mut frame)
            .map(|()| frame)
            .map_err(|_| ());
        let _ = ready_sender.send(result);
    });
    let ready = ready_receiver
        .recv_timeout(Duration::from_secs(10))
        .ok()
        .and_then(Result::ok)
        .and_then(|frame| decode_parent_death_ready(&frame).ok());
    let observer = ready.and_then(|value| open_windows_probe_process(value.worker_process_id).ok());
    let worker_was_running = observer
        .as_ref()
        .is_some_and(|process| process.is_running());

    let intermediate_killed = intermediate.kill().is_ok();
    let intermediate_terminal = intermediate.wait().is_ok();
    let worker_terminal = observer
        .as_ref()
        .is_some_and(|process| process.wait_for_exit(5_000));
    let _ = ready_reader.join();
    let profile_removed = remove_windows_probe_profile(&attempt_id).is_ok();
    let private_root_removed = fs::remove_dir_all(&private_root).is_ok() && !private_root.exists();
    let receipt = WindowsCleanupReceipt {
        worker_terminal,
        profile_removed,
        private_root_removed,
    };
    (
        worker_was_running && intermediate_killed && intermediate_terminal && worker_terminal,
        receipt,
    )
}

#[cfg(windows)]
fn incomplete_parent_death_cleanup(
    attempt_id: &str,
    private_root: &Path,
    worker_terminal: bool,
) -> (bool, WindowsCleanupReceipt) {
    let profile_removed = remove_windows_probe_profile(attempt_id).is_ok();
    let private_root_removed = fs::remove_dir_all(private_root).is_ok() && !private_root.exists();
    (
        false,
        WindowsCleanupReceipt {
            worker_terminal,
            profile_removed,
            private_root_removed,
        },
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
    let mut evidence = WindowsHostileEvidence {
        filesystem: result.filesystem_attempted && result.filesystem_denied && outside_unchanged,
        network: result.network_attempted && result.network_denied && no_connection,
        process_tree: result.process_attempted
            && result.process_denied
            && observation.single_active_process,
        resources: observation.app_container
            && observation.assigned_before_resume
            && observation.resumed_once
            && observation.exact_job_limits,
        parent_death: false,
        cleanup: false,
    };
    drop(excluded_handle);
    drop(listener);
    let hostile_cleanup = launch.cleanup(&probe_root);
    if !hostile_result_complete(&result) {
        return Err(());
    }
    let (parent_death, parent_cleanup) = run_windows_parent_death_probe();
    evidence.parent_death = parent_death;
    evidence.cleanup = hostile_cleanup.complete() && parent_cleanup.complete();
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
        "parentDeath": evidence.as_ref().is_some_and(|value| value.parent_death),
        "cleanup": evidence.as_ref().is_some_and(|value| value.cleanup),
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
