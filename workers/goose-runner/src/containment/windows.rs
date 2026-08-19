#[cfg(windows)]
use super::parse_resource_limits_with;
#[cfg(windows)]
use std::env;

#[cfg(windows)]
use std::ffi::OsString;
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::io::{Read, Write};
#[cfg(windows)]
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
#[cfg(windows)]
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::{Command, Stdio};
#[cfg(windows)]
use std::sync::atomic::{AtomicU64, Ordering};
#[cfg(windows)]
use std::sync::mpsc;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use super::windows_contract::{
    admit_probe_role, bounded_probe_metadata, decode_parent_death_ready,
    decode_parent_death_request, encode_parent_death_ready, encode_parent_death_request,
    WindowsContainmentRole, WindowsParentDeathReady, WindowsProbeRequest,
    WINDOWS_PARENT_DEATH_READY_LENGTH, WINDOWS_PARENT_DEATH_REQUEST_LENGTH,
    WINDOWS_PROBE_CHILD_ARGUMENT,
};
#[cfg(any(windows, test))]
use super::windows_contract::{WindowsNetworkProbeOutcome, WindowsProbeResult};
#[cfg(any(windows, test))]
use crate::windows_supervisor::WindowsCleanupReceipt;
#[cfg(windows)]
use crate::windows_supervisor::{
    launch_windows_containment_worker, open_windows_probe_process, read_windows_probe_request,
    remove_windows_probe_profile, write_windows_probe_child_stage, write_windows_probe_result,
    ProbeHandle, WindowsContainmentFailure, WindowsProbeChildRequestFailure,
    WindowsProbeChildStage, WindowsProbeExchangeFailure,
    WINDOWS_PROBE_CHILD_REQUEST_FAILURE_EXIT_CODE, WINDOWS_PROBE_CHILD_RESULT_FAILURE_EXIT_CODE,
    WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE,
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
fn classify_windows_network_outcome(
    kind: std::io::ErrorKind,
    raw_code: Option<i32>,
) -> WindowsNetworkProbeOutcome {
    match raw_code {
        Some(10_013) => WindowsNetworkProbeOutcome::AccessDenied,
        Some(10_060) => WindowsNetworkProbeOutcome::TimedOut,
        Some(10_051 | 10_065) => WindowsNetworkProbeOutcome::Unreachable,
        Some(10_061) => WindowsNetworkProbeOutcome::Refused,
        Some(10_049) => WindowsNetworkProbeOutcome::AddressUnavailable,
        Some(10_022) => WindowsNetworkProbeOutcome::InvalidArgument,
        Some(10_043 | 10_044 | 10_045 | 10_046 | 10_047 | 10_050 | 10_091 | 10_092 | 10_093) => {
            WindowsNetworkProbeOutcome::NetworkStackUnavailable
        }
        Some(_) => WindowsNetworkProbeOutcome::Unclassified,
        None => match kind {
            std::io::ErrorKind::PermissionDenied => {
                WindowsNetworkProbeOutcome::PermissionDeniedWithoutCode
            }
            std::io::ErrorKind::TimedOut => WindowsNetworkProbeOutcome::TimedOut,
            std::io::ErrorKind::NetworkUnreachable | std::io::ErrorKind::HostUnreachable => {
                WindowsNetworkProbeOutcome::Unreachable
            }
            std::io::ErrorKind::ConnectionRefused => WindowsNetworkProbeOutcome::Refused,
            std::io::ErrorKind::AddrNotAvailable => WindowsNetworkProbeOutcome::AddressUnavailable,
            std::io::ErrorKind::InvalidInput => WindowsNetworkProbeOutcome::InvalidArgument,
            std::io::ErrorKind::NetworkDown | std::io::ErrorKind::Unsupported => {
                WindowsNetworkProbeOutcome::NetworkStackUnavailable
            }
            _ => WindowsNetworkProbeOutcome::RawCodeAbsent,
        },
    }
}

#[cfg(any(windows, test))]
fn is_closed_process_denial(raw_code: Option<i32>) -> bool {
    matches!(raw_code, Some(5 | 1_816))
}

#[cfg(any(windows, test))]
fn hostile_result_complete(result: &WindowsProbeResult) -> bool {
    result.filesystem_attempted
        && result.filesystem_denied
        && result.network_outcome.attempted()
        && result.network_outcome.denied()
        && result.process_attempted
        && result.process_denied
        && result.environment_canary_absent
        && result.excluded_handle_absent
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowsProbeFailure {
    ChildFrame,
    ChildRequestFrame,
    ChildWorkerWait,
    ChildRequestRead,
    ChildResultWrite,
    ChildEntry,
    ChildPanic,
    ChildImageLoad,
    ChildRuntimeFault,
    ChildBeforeEntry,
    ChildInputHandleStage,
    ChildRequestLengthStage,
    ChildRequestFrameStage,
    ChildRequestDecodeStage,
    ChildFilesystemStage,
    ChildNetworkStage,
    ChildProcessStage,
    ChildResultStage,
    ChildStageWrite,
    ChildUnexpectedExit,
    ChildResultFrame,
    Cleanup,
    ExcludedHandleInherited,
    ExcludedHandleAmbiguous,
    Filesystem,
    Job,
    Network,
    NetworkControl,
    NetworkConnected,
    NetworkTimedOut,
    NetworkUnreachable,
    NetworkRefused,
    NetworkAddressUnavailable,
    NetworkInvalidArgument,
    NetworkStackUnavailable,
    NetworkPermissionDeniedWithoutCode,
    NetworkRawCodeAbsent,
    NetworkUnclassified,
    ParentDeath,
    ParentDeathFrame,
    Process,
    ProfileCleanup,
    Resource,
    WorkerLaunch,
}

#[cfg(any(windows, test))]
impl WindowsProbeFailure {
    fn code(self) -> &'static str {
        match self {
            Self::ChildFrame => "windows-child-frame-invalid",
            Self::ChildRequestFrame => "windows-child-request-frame-invalid",
            Self::ChildWorkerWait => "windows-child-worker-wait-invalid",
            Self::ChildRequestRead => "windows-child-request-read-invalid",
            Self::ChildResultWrite => "windows-child-result-write-invalid",
            Self::ChildEntry => "windows-child-entry-invalid",
            Self::ChildPanic => "windows-child-panic-invalid",
            Self::ChildImageLoad => "windows-child-image-load-invalid",
            Self::ChildRuntimeFault => "windows-child-runtime-fault-invalid",
            Self::ChildBeforeEntry => "windows-child-before-entry-invalid",
            Self::ChildInputHandleStage => "windows-child-input-handle-stage-invalid",
            Self::ChildRequestLengthStage => "windows-child-request-length-stage-invalid",
            Self::ChildRequestFrameStage => "windows-child-request-frame-stage-invalid",
            Self::ChildRequestDecodeStage => "windows-child-request-decode-stage-invalid",
            Self::ChildFilesystemStage => "windows-child-filesystem-stage-invalid",
            Self::ChildNetworkStage => "windows-child-network-stage-invalid",
            Self::ChildProcessStage => "windows-child-process-stage-invalid",
            Self::ChildResultStage => "windows-child-result-stage-invalid",
            Self::ChildStageWrite => "windows-child-stage-write-invalid",
            Self::ChildUnexpectedExit => "windows-child-unexpected-exit-invalid",
            Self::ChildResultFrame => "windows-child-result-frame-invalid",
            Self::Cleanup => "windows-cleanup-incomplete",
            Self::ExcludedHandleInherited => "windows-excluded-handle-inherited",
            Self::ExcludedHandleAmbiguous => "windows-excluded-handle-ambiguous",
            Self::Filesystem => "windows-filesystem-evidence-incomplete",
            Self::Job => "windows-job-evidence-incomplete",
            Self::Network => "windows-network-evidence-incomplete",
            Self::NetworkControl => "windows-network-control-invalid",
            Self::NetworkConnected => "windows-network-connected",
            Self::NetworkTimedOut => "windows-network-timeout",
            Self::NetworkUnreachable => "windows-network-unreachable",
            Self::NetworkRefused => "windows-network-refused",
            Self::NetworkAddressUnavailable => "windows-network-address-unavailable",
            Self::NetworkInvalidArgument => "windows-network-invalid-argument",
            Self::NetworkStackUnavailable => "windows-network-stack-unavailable",
            Self::NetworkPermissionDeniedWithoutCode => {
                "windows-network-permission-denied-without-code"
            }
            Self::NetworkRawCodeAbsent => "windows-network-raw-code-absent",
            Self::NetworkUnclassified => "windows-network-unclassified",
            Self::ParentDeath => "windows-parent-death-evidence-incomplete",
            Self::ParentDeathFrame => "windows-parent-death-frame-invalid",
            Self::Process => "windows-process-evidence-incomplete",
            Self::ProfileCleanup => "windows-profile-cleanup-failed",
            Self::Resource => "windows-resource-evidence-incomplete",
            Self::WorkerLaunch => "windows-worker-launch-failed",
        }
    }
}

#[cfg(any(windows, test))]
fn classify_windows_cleanup_failure(receipt: WindowsCleanupReceipt) -> Option<WindowsProbeFailure> {
    if !receipt.profile_removed {
        return Some(WindowsProbeFailure::ProfileCleanup);
    }
    if !receipt.worker_terminal || !receipt.private_root_removed {
        return Some(WindowsProbeFailure::Cleanup);
    }
    None
}

#[cfg(any(windows, test))]
fn classify_windows_network_evidence(
    control_reachable: bool,
    no_worker_connection: bool,
    outcome: WindowsNetworkProbeOutcome,
) -> Option<WindowsProbeFailure> {
    if !control_reachable {
        return Some(WindowsProbeFailure::NetworkControl);
    }
    if !no_worker_connection || outcome == WindowsNetworkProbeOutcome::Connected {
        return Some(WindowsProbeFailure::NetworkConnected);
    }
    match outcome {
        WindowsNetworkProbeOutcome::AccessDenied | WindowsNetworkProbeOutcome::TimedOut => None,
        WindowsNetworkProbeOutcome::Unreachable => Some(WindowsProbeFailure::NetworkUnreachable),
        WindowsNetworkProbeOutcome::Refused => Some(WindowsProbeFailure::NetworkRefused),
        WindowsNetworkProbeOutcome::AddressUnavailable => {
            Some(WindowsProbeFailure::NetworkAddressUnavailable)
        }
        WindowsNetworkProbeOutcome::InvalidArgument => {
            Some(WindowsProbeFailure::NetworkInvalidArgument)
        }
        WindowsNetworkProbeOutcome::NetworkStackUnavailable => {
            Some(WindowsProbeFailure::NetworkStackUnavailable)
        }
        WindowsNetworkProbeOutcome::PermissionDeniedWithoutCode => {
            Some(WindowsProbeFailure::NetworkPermissionDeniedWithoutCode)
        }
        WindowsNetworkProbeOutcome::RawCodeAbsent => {
            Some(WindowsProbeFailure::NetworkRawCodeAbsent)
        }
        WindowsNetworkProbeOutcome::NotAttempted | WindowsNetworkProbeOutcome::Unclassified => {
            Some(WindowsProbeFailure::NetworkUnclassified)
        }
        WindowsNetworkProbeOutcome::Connected => {
            unreachable!("handled before the closed failure match")
        }
    }
}

#[cfg(windows)]
fn prove_windows_loopback_listener_reachable(listener: &TcpListener, address: &SocketAddr) -> bool {
    let control = match TcpStream::connect_timeout(address, Duration::from_secs(1)) {
        Ok(control) => control,
        Err(_) => return false,
    };
    let deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match listener.accept() {
            Ok((accepted, _)) => {
                drop(accepted);
                drop(control);
                return true;
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                thread::sleep(Duration::from_millis(5));
            }
            Err(_) => return false,
        }
    }
}

#[cfg(windows)]
fn classify_windows_launch_failure(failure: WindowsContainmentFailure) -> WindowsProbeFailure {
    match failure {
        WindowsContainmentFailure::Profile | WindowsContainmentFailure::Job => {
            WindowsProbeFailure::Job
        }
        WindowsContainmentFailure::Pipes | WindowsContainmentFailure::WorkerLaunch => {
            WindowsProbeFailure::WorkerLaunch
        }
        WindowsContainmentFailure::ExcludedHandleInherited => {
            WindowsProbeFailure::ExcludedHandleInherited
        }
        WindowsContainmentFailure::ExcludedHandleAmbiguous => {
            WindowsProbeFailure::ExcludedHandleAmbiguous
        }
    }
}

#[cfg(windows)]
fn remove_private_root(path: &Path) -> bool {
    if !path.exists() {
        return true;
    }
    fs::remove_dir_all(path).is_ok() && !path.exists()
}

#[cfg(windows)]
struct PrivateRootCleanupGuard {
    path: PathBuf,
    removed: bool,
}

#[cfg(windows)]
impl PrivateRootCleanupGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            removed: false,
        }
    }

    fn mark_removed(&mut self) {
        self.removed = true;
    }

    fn remove_now(&mut self) -> bool {
        let removed = remove_private_root(&self.path);
        if removed {
            self.mark_removed();
        }
        removed
    }
}

#[cfg(windows)]
impl Drop for PrivateRootCleanupGuard {
    fn drop(&mut self) {
        if !self.removed {
            let _ = remove_private_root(&self.path);
        }
    }
}

#[cfg(windows)]
struct LocalAppDataGuard {
    previous: Option<OsString>,
}

#[cfg(windows)]
impl LocalAppDataGuard {
    fn replace(value: &Path) -> Self {
        let previous = env::var_os("LOCALAPPDATA");
        env::set_var("LOCALAPPDATA", value);
        Self { previous }
    }
}

#[cfg(windows)]
impl Drop for LocalAppDataGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.take() {
            env::set_var("LOCALAPPDATA", previous);
        } else {
            env::remove_var("LOCALAPPDATA");
        }
    }
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
    if write_windows_probe_child_stage(WindowsProbeChildStage::Entry).is_err() {
        return WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE;
    }
    let (request, excluded_handle_absent) = match read_windows_probe_request() {
        Ok(request) => request,
        Err(WindowsProbeChildRequestFailure::Request) => {
            eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
            return WINDOWS_PROBE_CHILD_REQUEST_FAILURE_EXIT_CODE;
        }
        Err(WindowsProbeChildRequestFailure::StageWrite) => {
            return WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE;
        }
    };
    let mut mark_stage = |stage| write_windows_probe_child_stage(stage).is_ok();
    let result =
        match execute_windows_hostile_probe(&request, excluded_handle_absent, &mut mark_stage) {
            Ok(result) => result,
            Err(()) => return WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE,
        };
    if write_windows_probe_result(result).is_err() {
        eprintln!("{WINDOWS_CONTAINMENT_ROLE_FAILURE_MARKER}");
        return WINDOWS_PROBE_CHILD_RESULT_FAILURE_EXIT_CODE;
    }
    if write_windows_probe_child_stage(WindowsProbeChildStage::ResultWritten).is_err() {
        return WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE;
    }
    0
}

#[cfg(windows)]
fn execute_windows_hostile_probe(
    request: &WindowsProbeRequest,
    excluded_handle_absent: bool,
    mark_stage: &mut impl FnMut(WindowsProbeChildStage) -> bool,
) -> Result<WindowsProbeResult, ()> {
    let read_path = Path::new(request.outside_read_path());
    let write_path = Path::new(request.outside_write_path());
    if !read_path.is_absolute() || !write_path.is_absolute() {
        return Ok(incomplete_hostile_result(excluded_handle_absent));
    }

    let read_denied = match fs::read(read_path) {
        Ok(_) => false,
        Err(error) => is_closed_filesystem_denial(error.kind(), error.raw_os_error()),
    };
    let write_denied = match fs::write(write_path, b"forbidden") {
        Ok(()) => false,
        Err(error) => is_closed_filesystem_denial(error.kind(), error.raw_os_error()),
    };
    if !mark_stage(WindowsProbeChildStage::FilesystemComplete) {
        return Err(());
    }

    let address = SocketAddr::V4(SocketAddrV4::new(
        Ipv4Addr::LOCALHOST,
        request.loopback_port(),
    ));
    let network_outcome = match TcpStream::connect_timeout(&address, Duration::from_secs(2)) {
        Ok(stream) => {
            drop(stream);
            WindowsNetworkProbeOutcome::Connected
        }
        Err(error) => classify_windows_network_outcome(error.kind(), error.raw_os_error()),
    };
    if !mark_stage(WindowsProbeChildStage::NetworkComplete) {
        return Err(());
    }

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
    if !mark_stage(WindowsProbeChildStage::ProcessComplete) {
        return Err(());
    }

    Ok(WindowsProbeResult {
        filesystem_attempted: true,
        filesystem_denied: read_denied && write_denied,
        network_outcome,
        process_attempted: true,
        process_denied,
        environment_canary_absent: env::var_os("ACTESTRA_ENVIRONMENT_CANARY").is_none(),
        excluded_handle_absent,
    })
}

#[cfg(windows)]
fn incomplete_hostile_result(excluded_handle_absent: bool) -> WindowsProbeResult {
    WindowsProbeResult {
        filesystem_attempted: false,
        filesystem_denied: false,
        network_outcome: WindowsNetworkProbeOutcome::NotAttempted,
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
struct WindowsParentDeathOutcome {
    result: Result<(), WindowsProbeFailure>,
    cleanup: WindowsCleanupReceipt,
}

#[cfg(windows)]
fn parent_death_setup_failure(
    failure: WindowsProbeFailure,
    private_root: &mut PrivateRootCleanupGuard,
) -> WindowsParentDeathOutcome {
    WindowsParentDeathOutcome {
        result: Err(failure),
        cleanup: WindowsCleanupReceipt {
            worker_terminal: true,
            profile_removed: true,
            private_root_removed: private_root.remove_now(),
        },
    }
}

#[cfg(windows)]
fn stop_intermediate_before_worker_launch(
    intermediate: &mut std::process::Child,
    private_root: &mut PrivateRootCleanupGuard,
    failure: WindowsProbeFailure,
) -> WindowsParentDeathOutcome {
    let _ = intermediate.kill();
    let intermediate_terminal = intermediate.wait().is_ok();
    WindowsParentDeathOutcome {
        result: Err(failure),
        cleanup: WindowsCleanupReceipt {
            worker_terminal: intermediate_terminal,
            profile_removed: true,
            private_root_removed: private_root.remove_now(),
        },
    }
}

#[cfg(windows)]
fn run_windows_parent_death_probe() -> WindowsParentDeathOutcome {
    let attempt_id = unique_probe_attempt_id();
    let private_root = env::temp_dir().join(format!("actestra-goose-parent-death-{attempt_id}"));
    let mut private_root_cleanup = PrivateRootCleanupGuard::new(private_root.clone());
    let local_app_data = private_root.join("local-app-data");
    if fs::create_dir_all(&local_app_data).is_err() {
        return parent_death_setup_failure(
            WindowsProbeFailure::WorkerLaunch,
            &mut private_root_cleanup,
        );
    }
    let executable = match env::current_exe() {
        Ok(executable) => executable,
        Err(_) => {
            return parent_death_setup_failure(
                WindowsProbeFailure::WorkerLaunch,
                &mut private_root_cleanup,
            );
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
            return parent_death_setup_failure(
                WindowsProbeFailure::WorkerLaunch,
                &mut private_root_cleanup,
            );
        }
    };
    let request = match encode_parent_death_request(&attempt_id) {
        Ok(request) => request,
        Err(()) => {
            return stop_intermediate_before_worker_launch(
                &mut intermediate,
                &mut private_root_cleanup,
                WindowsProbeFailure::ParentDeathFrame,
            );
        }
    };
    let request_written = intermediate
        .stdin
        .take()
        .is_some_and(|mut input| input.write_all(&request).is_ok());
    let output = intermediate.stdout.take();
    if !request_written {
        return stop_intermediate_before_worker_launch(
            &mut intermediate,
            &mut private_root_cleanup,
            WindowsProbeFailure::ParentDeathFrame,
        );
    }
    let Some(mut output) = output else {
        let _ = intermediate.kill();
        let _ = intermediate.wait();
        let profile_removed = remove_windows_probe_profile(&attempt_id).is_ok();
        return WindowsParentDeathOutcome {
            result: Err(WindowsProbeFailure::ParentDeathFrame),
            cleanup: WindowsCleanupReceipt {
                worker_terminal: false,
                profile_removed,
                private_root_removed: private_root_cleanup.remove_now(),
            },
        };
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
    let ready_reader_complete = ready_reader.join().is_ok();
    let profile_removed = remove_windows_probe_profile(&attempt_id).is_ok();
    let cleanup = WindowsCleanupReceipt {
        worker_terminal: worker_terminal && intermediate_terminal,
        profile_removed,
        private_root_removed: private_root_cleanup.remove_now(),
    };
    let result = if ready.is_none() || !ready_reader_complete {
        Err(WindowsProbeFailure::ParentDeathFrame)
    } else if worker_was_running && intermediate_killed && intermediate_terminal && worker_terminal
    {
        Ok(())
    } else {
        Err(WindowsProbeFailure::ParentDeath)
    };
    WindowsParentDeathOutcome { result, cleanup }
}

#[cfg(windows)]
fn collect_windows_hostile_evidence() -> Result<WindowsHostileEvidence, WindowsProbeFailure> {
    if env::var_os("ACTESTRA_ENVIRONMENT_CANARY").is_some() {
        return Err(WindowsProbeFailure::Job);
    }
    let attempt_id = unique_probe_attempt_id();
    let probe_root = env::temp_dir().join(format!("actestra-goose-containment-{attempt_id}"));
    let mut private_root_cleanup = PrivateRootCleanupGuard::new(probe_root.clone());
    let local_app_data = probe_root.join("local-app-data");
    let outside_root = probe_root.join("outside");
    fs::create_dir_all(&local_app_data).map_err(|_| WindowsProbeFailure::WorkerLaunch)?;
    fs::create_dir_all(&outside_root).map_err(|_| WindowsProbeFailure::WorkerLaunch)?;
    let _local_app_data = LocalAppDataGuard::replace(&local_app_data);

    let outside_input = outside_root.join("input.txt");
    let outside_output = outside_root.join("output.txt");
    let outside_bytes = b"outside-sentinel";
    fs::write(&outside_input, outside_bytes).map_err(|_| WindowsProbeFailure::WorkerLaunch)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|_| WindowsProbeFailure::WorkerLaunch)?;
    let port = listener
        .local_addr()
        .map_err(|_| WindowsProbeFailure::WorkerLaunch)?
        .port();
    listener
        .set_nonblocking(true)
        .map_err(|_| WindowsProbeFailure::WorkerLaunch)?;
    let loopback_address = listener
        .local_addr()
        .map_err(|_| WindowsProbeFailure::NetworkControl)?;
    if !prove_windows_loopback_listener_reachable(&listener, &loopback_address) {
        return Err(WindowsProbeFailure::NetworkControl);
    }

    let executable = env::current_exe().map_err(|_| WindowsProbeFailure::WorkerLaunch)?;
    let current_directory = executable
        .parent()
        .ok_or(WindowsProbeFailure::WorkerLaunch)?;
    let request = WindowsProbeRequest::new(
        outside_input
            .to_str()
            .ok_or(WindowsProbeFailure::ChildFrame)?
            .to_string(),
        outside_output
            .to_str()
            .ok_or(WindowsProbeFailure::ChildFrame)?
            .to_string(),
        port,
    )
    .map_err(|()| WindowsProbeFailure::ChildFrame)?;
    let excluded_handle = ProbeHandle::create().map_err(|()| WindowsProbeFailure::Job)?;
    let mut launch = match launch_windows_containment_worker(
        &attempt_id,
        &executable,
        current_directory,
        WINDOWS_PROBE_CHILD_ARGUMENT,
        &excluded_handle,
    ) {
        Ok(launch) => launch,
        Err(failure) => {
            let _ = remove_windows_probe_profile(&attempt_id);
            return Err(classify_windows_launch_failure(failure));
        }
    };

    let hostile_result = (|| {
        let observation = launch
            .observation()
            .map_err(|()| WindowsProbeFailure::Job)?;
        let result = launch
            .exchange_probe_request(&request)
            .map_err(|failure| match failure {
                WindowsProbeExchangeFailure::RequestFrame => WindowsProbeFailure::ChildRequestFrame,
                WindowsProbeExchangeFailure::WorkerWait => WindowsProbeFailure::ChildWorkerWait,
                WindowsProbeExchangeFailure::WorkerRequest => WindowsProbeFailure::ChildRequestRead,
                WindowsProbeExchangeFailure::WorkerResult => WindowsProbeFailure::ChildResultWrite,
                WindowsProbeExchangeFailure::WorkerEntry => WindowsProbeFailure::ChildEntry,
                WindowsProbeExchangeFailure::WorkerPanic => WindowsProbeFailure::ChildPanic,
                WindowsProbeExchangeFailure::WorkerImageLoad => WindowsProbeFailure::ChildImageLoad,
                WindowsProbeExchangeFailure::WorkerRuntimeFault => {
                    WindowsProbeFailure::ChildRuntimeFault
                }
                WindowsProbeExchangeFailure::WorkerBeforeEntry => {
                    WindowsProbeFailure::ChildBeforeEntry
                }
                WindowsProbeExchangeFailure::WorkerInputHandleStage => {
                    WindowsProbeFailure::ChildInputHandleStage
                }
                WindowsProbeExchangeFailure::WorkerRequestLengthStage => {
                    WindowsProbeFailure::ChildRequestLengthStage
                }
                WindowsProbeExchangeFailure::WorkerRequestFrameStage => {
                    WindowsProbeFailure::ChildRequestFrameStage
                }
                WindowsProbeExchangeFailure::WorkerRequestDecodeStage => {
                    WindowsProbeFailure::ChildRequestDecodeStage
                }
                WindowsProbeExchangeFailure::WorkerFilesystemStage => {
                    WindowsProbeFailure::ChildFilesystemStage
                }
                WindowsProbeExchangeFailure::WorkerNetworkStage => {
                    WindowsProbeFailure::ChildNetworkStage
                }
                WindowsProbeExchangeFailure::WorkerProcessStage => {
                    WindowsProbeFailure::ChildProcessStage
                }
                WindowsProbeExchangeFailure::WorkerResultStage => {
                    WindowsProbeFailure::ChildResultStage
                }
                WindowsProbeExchangeFailure::WorkerStageWrite => {
                    WindowsProbeFailure::ChildStageWrite
                }
                WindowsProbeExchangeFailure::WorkerUnexpectedExit => {
                    WindowsProbeFailure::ChildUnexpectedExit
                }
                WindowsProbeExchangeFailure::ResultFrame => WindowsProbeFailure::ChildResultFrame,
            })?;
        let outside_unchanged =
            fs::read(&outside_input).map_err(|_| WindowsProbeFailure::Filesystem)? == outside_bytes
                && !outside_output.exists();
        let no_connection = match listener.accept() {
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => true,
            Ok((stream, _)) => {
                drop(stream);
                false
            }
            Err(_) => return Err(WindowsProbeFailure::Network),
        };
        Ok((observation, result, outside_unchanged, no_connection))
    })();

    drop(excluded_handle);
    drop(listener);
    let hostile_cleanup = launch.cleanup(&probe_root);
    if hostile_cleanup.private_root_removed {
        private_root_cleanup.mark_removed();
    }
    if let Some(failure) = classify_windows_cleanup_failure(hostile_cleanup) {
        return Err(failure);
    }
    let (observation, result, outside_unchanged, no_connection) = hostile_result?;
    if !result.environment_canary_absent
        || !result.excluded_handle_absent
        || !observation.app_container
        || !observation.assigned_before_resume
        || !observation.excluded_handle_absent
        || !observation.resumed_once
    {
        return Err(WindowsProbeFailure::Job);
    }
    if !observation.exact_job_limits {
        return Err(WindowsProbeFailure::Resource);
    }
    if !result.filesystem_attempted || !result.filesystem_denied || !outside_unchanged {
        return Err(WindowsProbeFailure::Filesystem);
    }
    if let Some(failure) =
        classify_windows_network_evidence(true, no_connection, result.network_outcome)
    {
        return Err(failure);
    }
    if !result.process_attempted || !result.process_denied || !observation.single_active_process {
        return Err(WindowsProbeFailure::Process);
    }
    if !hostile_result_complete(&result) {
        return Err(WindowsProbeFailure::Job);
    }

    let parent_death = run_windows_parent_death_probe();
    if let Some(failure) = classify_windows_cleanup_failure(parent_death.cleanup) {
        return Err(failure);
    }
    parent_death.result?;
    Ok(WindowsHostileEvidence {
        filesystem: true,
        network: true,
        process_tree: true,
        resources: true,
        parent_death: true,
        cleanup: true,
    })
}

#[cfg(windows)]
pub(crate) fn run_windows_containment_probe() -> String {
    let evidence = match collect_windows_hostile_evidence() {
        Ok(evidence) => Some(evidence),
        Err(failure) => {
            eprintln!(
                "Goose windows containment failed at bounded stage {}",
                failure.code()
            );
            None
        }
    };
    let filesystem = evidence.as_ref().is_some_and(|value| value.filesystem);
    let network = evidence.as_ref().is_some_and(|value| value.network);
    let process_tree = evidence.as_ref().is_some_and(|value| value.process_tree);
    let resources = evidence.as_ref().is_some_and(|value| value.resources);
    let parent_death = evidence.as_ref().is_some_and(|value| value.parent_death);
    let cleanup = evidence.as_ref().is_some_and(|value| value.cleanup);
    let complete = filesystem && network && process_tree && resources && parent_death && cleanup;
    let status = if complete {
        "verified"
    } else {
        "evidence-incomplete"
    };
    serde_json::json!({
        "contractVersion": 1,
        "targetTriple": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_TARGET_TRIPLE").ok(), 128),
        "sourceCommit": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_SOURCE_COMMIT").ok(), 40),
        "probeSha256": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_PROBE_SHA256").ok(), 64),
        "executableSha256": bounded_probe_metadata(env::var("ACTESTRA_GOOSE_EXECUTABLE_SHA256").ok(), 64),
        "filesystem": filesystem,
        "network": network,
        "processTree": process_tree,
        "resources": resources,
        "parentDeath": parent_death,
        "cleanup": cleanup,
        "status": status,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        classify_windows_cleanup_failure, classify_windows_network_evidence,
        classify_windows_network_outcome, hostile_result_complete, is_closed_filesystem_denial,
        is_closed_process_denial, WindowsNetworkProbeOutcome, WindowsProbeFailure,
        WindowsProbeResult,
    };
    use crate::windows_supervisor::WindowsCleanupReceipt;
    use std::io::ErrorKind;

    #[test]
    fn accepts_only_closed_native_denial_classes() {
        assert!(is_closed_filesystem_denial(
            ErrorKind::PermissionDenied,
            None
        ));
        assert!(is_closed_filesystem_denial(ErrorKind::Other, Some(5)));
        assert!(!is_closed_filesystem_denial(ErrorKind::NotFound, Some(2)));
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::PermissionDenied, Some(10_013)),
            WindowsNetworkProbeOutcome::AccessDenied,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::TimedOut, Some(10_060)),
            WindowsNetworkProbeOutcome::TimedOut,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::NetworkUnreachable, Some(10_051)),
            WindowsNetworkProbeOutcome::Unreachable,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::HostUnreachable, Some(10_065)),
            WindowsNetworkProbeOutcome::Unreachable,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::ConnectionRefused, Some(10_061)),
            WindowsNetworkProbeOutcome::Refused,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::AddrNotAvailable, Some(10_049)),
            WindowsNetworkProbeOutcome::AddressUnavailable,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::InvalidInput, Some(10_022)),
            WindowsNetworkProbeOutcome::InvalidArgument,
        );
        for raw_code in [
            10_043, 10_044, 10_045, 10_046, 10_047, 10_050, 10_091, 10_092, 10_093,
        ] {
            assert_eq!(
                classify_windows_network_outcome(ErrorKind::Other, Some(raw_code)),
                WindowsNetworkProbeOutcome::NetworkStackUnavailable,
            );
        }
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::PermissionDenied, None),
            WindowsNetworkProbeOutcome::PermissionDeniedWithoutCode,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::TimedOut, None),
            WindowsNetworkProbeOutcome::TimedOut,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::Other, None),
            WindowsNetworkProbeOutcome::RawCodeAbsent,
        );
        assert_eq!(
            classify_windows_network_outcome(ErrorKind::Other, Some(5)),
            WindowsNetworkProbeOutcome::Unclassified,
        );
        assert!(is_closed_process_denial(Some(5)));
        assert!(is_closed_process_denial(Some(1_816)));
        assert!(!is_closed_process_denial(Some(2)));
    }

    #[test]
    fn requires_every_hostile_attempt_and_denial() {
        let mut result = WindowsProbeResult {
            filesystem_attempted: true,
            filesystem_denied: true,
            network_outcome: WindowsNetworkProbeOutcome::AccessDenied,
            process_attempted: true,
            process_denied: true,
            environment_canary_absent: true,
            excluded_handle_absent: true,
        };
        assert!(hostile_result_complete(&result));
        result.process_attempted = false;
        assert!(!hostile_result_complete(&result));
    }

    #[test]
    fn accepts_timeout_only_with_a_reachable_control_and_no_worker_connection() {
        assert_eq!(
            classify_windows_network_evidence(true, true, WindowsNetworkProbeOutcome::TimedOut,),
            None,
        );
        assert_eq!(
            classify_windows_network_evidence(false, true, WindowsNetworkProbeOutcome::TimedOut,),
            Some(WindowsProbeFailure::NetworkControl),
        );
        assert_eq!(
            classify_windows_network_evidence(true, false, WindowsNetworkProbeOutcome::TimedOut,),
            Some(WindowsProbeFailure::NetworkConnected),
        );
        assert_eq!(
            classify_windows_network_evidence(true, true, WindowsNetworkProbeOutcome::AccessDenied,),
            None,
        );
        assert_eq!(
            classify_windows_network_evidence(true, true, WindowsNetworkProbeOutcome::Unclassified,),
            Some(WindowsProbeFailure::NetworkUnclassified),
        );
    }

    #[test]
    fn maps_only_closed_windows_probe_failure_codes() {
        for (failure, code) in [
            (
                WindowsProbeFailure::ChildFrame,
                "windows-child-frame-invalid",
            ),
            (
                WindowsProbeFailure::ChildRequestFrame,
                "windows-child-request-frame-invalid",
            ),
            (
                WindowsProbeFailure::ChildWorkerWait,
                "windows-child-worker-wait-invalid",
            ),
            (
                WindowsProbeFailure::ChildRequestRead,
                "windows-child-request-read-invalid",
            ),
            (
                WindowsProbeFailure::ChildResultWrite,
                "windows-child-result-write-invalid",
            ),
            (
                WindowsProbeFailure::ChildEntry,
                "windows-child-entry-invalid",
            ),
            (
                WindowsProbeFailure::ChildPanic,
                "windows-child-panic-invalid",
            ),
            (
                WindowsProbeFailure::ChildImageLoad,
                "windows-child-image-load-invalid",
            ),
            (
                WindowsProbeFailure::ChildRuntimeFault,
                "windows-child-runtime-fault-invalid",
            ),
            (
                WindowsProbeFailure::ChildBeforeEntry,
                "windows-child-before-entry-invalid",
            ),
            (
                WindowsProbeFailure::ChildInputHandleStage,
                "windows-child-input-handle-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildRequestLengthStage,
                "windows-child-request-length-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildRequestFrameStage,
                "windows-child-request-frame-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildRequestDecodeStage,
                "windows-child-request-decode-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildFilesystemStage,
                "windows-child-filesystem-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildNetworkStage,
                "windows-child-network-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildProcessStage,
                "windows-child-process-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildResultStage,
                "windows-child-result-stage-invalid",
            ),
            (
                WindowsProbeFailure::ChildStageWrite,
                "windows-child-stage-write-invalid",
            ),
            (
                WindowsProbeFailure::ChildUnexpectedExit,
                "windows-child-unexpected-exit-invalid",
            ),
            (
                WindowsProbeFailure::ChildResultFrame,
                "windows-child-result-frame-invalid",
            ),
            (WindowsProbeFailure::Cleanup, "windows-cleanup-incomplete"),
            (
                WindowsProbeFailure::ExcludedHandleInherited,
                "windows-excluded-handle-inherited",
            ),
            (
                WindowsProbeFailure::ExcludedHandleAmbiguous,
                "windows-excluded-handle-ambiguous",
            ),
            (
                WindowsProbeFailure::Filesystem,
                "windows-filesystem-evidence-incomplete",
            ),
            (WindowsProbeFailure::Job, "windows-job-evidence-incomplete"),
            (
                WindowsProbeFailure::Network,
                "windows-network-evidence-incomplete",
            ),
            (
                WindowsProbeFailure::NetworkControl,
                "windows-network-control-invalid",
            ),
            (
                WindowsProbeFailure::NetworkConnected,
                "windows-network-connected",
            ),
            (
                WindowsProbeFailure::NetworkTimedOut,
                "windows-network-timeout",
            ),
            (
                WindowsProbeFailure::NetworkUnreachable,
                "windows-network-unreachable",
            ),
            (
                WindowsProbeFailure::NetworkRefused,
                "windows-network-refused",
            ),
            (
                WindowsProbeFailure::NetworkAddressUnavailable,
                "windows-network-address-unavailable",
            ),
            (
                WindowsProbeFailure::NetworkInvalidArgument,
                "windows-network-invalid-argument",
            ),
            (
                WindowsProbeFailure::NetworkStackUnavailable,
                "windows-network-stack-unavailable",
            ),
            (
                WindowsProbeFailure::NetworkPermissionDeniedWithoutCode,
                "windows-network-permission-denied-without-code",
            ),
            (
                WindowsProbeFailure::NetworkRawCodeAbsent,
                "windows-network-raw-code-absent",
            ),
            (
                WindowsProbeFailure::NetworkUnclassified,
                "windows-network-unclassified",
            ),
            (
                WindowsProbeFailure::ParentDeath,
                "windows-parent-death-evidence-incomplete",
            ),
            (
                WindowsProbeFailure::ParentDeathFrame,
                "windows-parent-death-frame-invalid",
            ),
            (
                WindowsProbeFailure::Process,
                "windows-process-evidence-incomplete",
            ),
            (
                WindowsProbeFailure::ProfileCleanup,
                "windows-profile-cleanup-failed",
            ),
            (
                WindowsProbeFailure::Resource,
                "windows-resource-evidence-incomplete",
            ),
            (
                WindowsProbeFailure::WorkerLaunch,
                "windows-worker-launch-failed",
            ),
        ] {
            assert_eq!(failure.code(), code);
        }
    }

    #[test]
    fn classifies_profile_cleanup_separately_from_other_cleanup_failures() {
        let complete = WindowsCleanupReceipt {
            worker_terminal: true,
            profile_removed: true,
            private_root_removed: true,
        };
        assert_eq!(classify_windows_cleanup_failure(complete), None);

        for (receipt, expected) in [
            (
                WindowsCleanupReceipt {
                    profile_removed: false,
                    ..complete
                },
                WindowsProbeFailure::ProfileCleanup,
            ),
            (
                WindowsCleanupReceipt {
                    worker_terminal: false,
                    ..complete
                },
                WindowsProbeFailure::Cleanup,
            ),
            (
                WindowsCleanupReceipt {
                    private_root_removed: false,
                    ..complete
                },
                WindowsProbeFailure::Cleanup,
            ),
        ] {
            assert_eq!(classify_windows_cleanup_failure(receipt), Some(expected));
        }
    }
}
