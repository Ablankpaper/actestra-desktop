pub(crate) const WINDOWS_SETUP_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
pub(crate) const WINDOWS_RESOURCE_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";

// Worker exit codes for structured startup failure diagnosis
#[cfg(any(windows, test))]
const EXIT_CONTROL_FRAME_INVALID: i32 = 101;
#[cfg(any(windows, test))]
const EXIT_BOUNDARY_VERIFICATION_FAILED: i32 = 102;
#[cfg(any(windows, test))]
const EXIT_RUNTIME_CREATION_FAILED: i32 = 103;
#[cfg(any(windows, test))]
const EXIT_CAPABILITY_BRIDGE_FAILED: i32 = 108;
#[cfg(any(windows, test))]
const EXIT_MODEL_BRIDGE_FAILED: i32 = 113;
#[cfg(any(windows, test))]
const EXIT_STATE_DIRECTORY_FAILED: i32 = 114;
#[cfg(any(windows, test))]
const EXIT_READY_SIGNAL_FAILED: i32 = 115;
#[cfg(any(windows, test))]
const EXIT_ACP_HANDSHAKE_FAILED: i32 = 116;

#[cfg(windows)]
use crate::containment::windows_contract::{
    decode_request_frame, decode_result, encode_request_frame, encode_result, WindowsProbeRequest,
    WindowsProbeResult, WINDOWS_PROBE_REQUEST_MAX_FRAME_BYTES, WINDOWS_PROBE_RESULT_FRAME_LENGTH,
};
#[cfg(any(windows, test))]
use crate::containment::windows_contract::{
    WINDOWS_PROBE_CHILD_ARGUMENT, WINDOWS_PROBE_PARENT_ARGUMENT,
};
#[cfg(windows)]
use crate::windows_capability_bridge::WindowsCapabilityClient;
#[cfg(windows)]
use crate::windows_model_bridge::WindowsModelProvider;
#[cfg(windows)]
const WINDOWS_WORKER_READY_MARKER: &[u8] = b"ACTESTRA_GOOSE_WINDOWS_WORKER_READY\n";
#[cfg(any(windows, test))]
const WINDOWS_RUNTIME_FAILURE_CODES: [&str; 18] = [
    "windows-control-channel-invalid",
    "windows-ready-channel-invalid",
    "windows-capability-channel-invalid",
    "windows-model-channel-invalid",
    "windows-acp-relay-failed",
    "windows-capability-relay-failed",
    "windows-model-relay-failed",
    "windows-worker-runtime-failed",
    "windows-runtime-timeout",
    "windows-runtime-cleanup-failed",
    "windows-worker-control-frame-invalid",
    "windows-worker-boundary-verification-failed",
    "windows-worker-runtime-creation-failed",
    "windows-worker-capability-bridge-failed",
    "windows-worker-model-bridge-failed",
    "windows-worker-state-directory-failed",
    "windows-worker-ready-signal-failed",
    "windows-worker-acp-handshake-failed",
];

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowsRuntimeEvent {
    ParentLiveness(Result<(), ()>),
    WorkerExit(Result<u32, ()>),
    Timeout,
    AcpRelay(Result<(), ()>),
    CapabilityRelay(Result<(), ()>),
    ModelRelay(Result<(), ()>),
}

#[cfg(any(windows, test))]
fn classify_runtime_event(event: WindowsRuntimeEvent) -> Result<(), &'static str> {
    match event {
        WindowsRuntimeEvent::ParentLiveness(Ok(())) | WindowsRuntimeEvent::WorkerExit(Ok(0)) => {
            Ok(())
        }
        WindowsRuntimeEvent::Timeout => Err("windows-runtime-timeout"),
        WindowsRuntimeEvent::AcpRelay(_) => Err("windows-acp-relay-failed"),
        WindowsRuntimeEvent::CapabilityRelay(_) => Err("windows-capability-relay-failed"),
        WindowsRuntimeEvent::ModelRelay(_) => Err("windows-model-relay-failed"),
        WindowsRuntimeEvent::WorkerExit(Ok(exit_code)) => {
            Err(classify_worker_startup_exit(exit_code).runtime_code())
        }
        WindowsRuntimeEvent::ParentLiveness(Err(())) | WindowsRuntimeEvent::WorkerExit(Err(())) => {
            Err("windows-worker-runtime-failed")
        }
    }
}

#[cfg(any(windows, test))]
fn runtime_diagnostic_codes(
    runtime_result: Result<(), &'static str>,
    cleanup_complete: bool,
) -> [Option<&'static str>; 2] {
    let primary = runtime_result.err().map(|code| {
        if WINDOWS_RUNTIME_FAILURE_CODES.contains(&code) {
            code
        } else {
            "windows-worker-runtime-failed"
        }
    });
    let cleanup = (!cleanup_complete).then_some("windows-runtime-cleanup-failed");
    [primary, cleanup]
}

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::mem::{size_of, size_of_val, zeroed};
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::ptr::{null, null_mut};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{
    CloseHandle, CompareObjectHandles, DuplicateHandle, GetHandleInformation, GetLastError,
    LocalFree, SetHandleInformation, DUPLICATE_SAME_ACCESS, ERROR_BROKEN_PIPE,
    ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE,
    WAIT_OBJECT_0, WAIT_TIMEOUT,
};
#[cfg(windows)]
use windows_sys::Win32::Security::Authorization::{
    GetEffectiveRightsFromAclW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
    EXPLICIT_ACCESS_W, NO_MULTIPLE_TRUSTEE, SET_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID,
    TRUSTEE_IS_USER, TRUSTEE_W,
};
#[cfg(windows)]
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
#[cfg(windows)]
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
#[cfg(windows)]
use windows_sys::Win32::Security::{
    EqualSid, FreeSid, GetTokenInformation, TokenIsAppContainer, TokenUser, ACL,
    DACL_SECURITY_INFORMATION, NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID, SECURITY_CAPABILITIES,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT, TOKEN_QUERY, TOKEN_USER,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    ReadFile, WriteFile, DELETE, FILE_ADD_FILE, FILE_ADD_SUBDIRECTORY, FILE_DELETE_CHILD,
    FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES,
    FILE_READ_EA, FILE_TRAVERSE, FILE_WRITE_ATTRIBUTES, FILE_WRITE_EA, READ_CONTROL, SYNCHRONIZE,
    WRITE_DAC, WRITE_OWNER,
};
#[cfg(windows)]
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
    JobObjectBasicAccountingInformation, JobObjectBasicUIRestrictions,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_BASIC_UI_RESTRICTIONS,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_JOB_MEMORY,
    JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_UILIMIT_DESKTOP,
    JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
    JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD,
    JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS, JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
};
#[cfg(windows)]
use windows_sys::Win32::System::Pipes::CreatePipe;
#[cfg(windows)]
use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    CreateEventW, CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
    GetExitCodeProcess, GetProcessId, InitializeProcThreadAttributeList, OpenProcess,
    OpenProcessToken, ResumeThread, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_SYNCHRONIZE, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

#[cfg(windows)]
const WINDOWS_JOB_LIMIT_FLAGS: u32 = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
    | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
    | JOB_OBJECT_LIMIT_JOB_MEMORY
    | JOB_OBJECT_LIMIT_JOB_TIME;
#[cfg(windows)]
const WINDOWS_JOB_UI_RESTRICTIONS: u32 = JOB_OBJECT_UILIMIT_READCLIPBOARD
    | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
    | JOB_OBJECT_UILIMIT_DESKTOP
    | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
    | JOB_OBJECT_UILIMIT_GLOBALATOMS
    | JOB_OBJECT_UILIMIT_HANDLES
    | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
    | JOB_OBJECT_UILIMIT_EXITWINDOWS;
#[cfg(windows)]
const WINDOWS_JOB_ACTIVE_PROCESS_LIMIT: u32 = 1;
#[cfg(windows)]
const WINDOWS_JOB_MEMORY_LIMIT_BYTES: usize = 1_073_741_824;
#[cfg(windows)]
const WINDOWS_JOB_USER_TIME_100NS: i64 = 120 * 10_000_000;
#[cfg(windows)]
const STATE_ROOT_ACCESS_MASK: u32 =
    FILE_TRAVERSE | FILE_READ_ATTRIBUTES | FILE_READ_EA | READ_CONTROL | SYNCHRONIZE;
#[cfg(windows)]
const STATE_DIRECTORY_ACCESS_MASK: u32 =
    FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;
#[cfg(windows)]
const STATE_FORBIDDEN_ACCESS_MASK: u32 = WRITE_DAC | WRITE_OWNER;
#[cfg(windows)]
const STATE_ROOT_FORBIDDEN_ACCESS_MASK: u32 = STATE_FORBIDDEN_ACCESS_MASK
    | FILE_ADD_FILE
    | FILE_ADD_SUBDIRECTORY
    | FILE_DELETE_CHILD
    | FILE_WRITE_ATTRIBUTES
    | FILE_WRITE_EA
    | DELETE;
#[cfg(any(windows, test))]
const WINDOWS_WORKER_MODE_ARGUMENT: &str = "--actestra-windows-worker-v1";
#[cfg(all(test, windows))]
const WINDOWS_ANONYMOUS_PIPE_TEST_CHILD_ARGUMENT: &str =
    "windows_supervisor::windows_native_tests::appcontainer_anonymous_pipe_client_child";
#[cfg(any(windows, test))]
const WINDOWS_WORKER_PROGRAM_NAME: &str = "actestra-goose-runner.exe";
#[cfg(any(windows, test))]
const WINDOWS_DIRECTORY_MAX_U16: usize = 32_767;
#[cfg(any(windows, test))]
const WINDOWS_ERROR_INVALID_HANDLE_CODE: u32 = 6;
pub(crate) const WINDOWS_PROBE_CHILD_REQUEST_FAILURE_EXIT_CODE: i32 = 81;
#[cfg(any(windows, test))]
pub(crate) const WINDOWS_PROBE_CHILD_RESULT_FAILURE_EXIT_CODE: i32 = 82;
#[cfg(any(windows, test))]
pub(crate) const WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE: i32 = 83;

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsProbeChildStage {
    Entry,
    InputHandleReady,
    RequestLengthRead,
    RequestFrameRead,
    RequestDecoded,
    FilesystemComplete,
    NetworkComplete,
    ProcessComplete,
    ResultWritten,
}

#[cfg(any(windows, test))]
impl WindowsProbeChildStage {
    fn marker(self) -> u8 {
        match self {
            Self::Entry => 0xa1,
            Self::InputHandleReady => 0xa2,
            Self::RequestLengthRead => 0xa3,
            Self::RequestFrameRead => 0xa4,
            Self::RequestDecoded => 0xa5,
            Self::FilesystemComplete => 0xa6,
            Self::NetworkComplete => 0xa7,
            Self::ProcessComplete => 0xa8,
            Self::ResultWritten => 0xa9,
        }
    }
}

#[cfg(any(windows, test))]
const WINDOWS_PROBE_CHILD_STAGES: [WindowsProbeChildStage; 9] = [
    WindowsProbeChildStage::Entry,
    WindowsProbeChildStage::InputHandleReady,
    WindowsProbeChildStage::RequestLengthRead,
    WindowsProbeChildStage::RequestFrameRead,
    WindowsProbeChildStage::RequestDecoded,
    WindowsProbeChildStage::FilesystemComplete,
    WindowsProbeChildStage::NetworkComplete,
    WindowsProbeChildStage::ProcessComplete,
    WindowsProbeChildStage::ResultWritten,
];

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DiagnosticEnvironmentKind {
    SystemRootWindir,
    SystemRootWindirComSpec,
}

#[cfg(any(windows, test))]
fn build_minimal_windows_environment_block(windows_directory: &[u16]) -> Result<Vec<u16>, ()> {
    const SYSTEM_ROOT_PREFIX: &str = "SystemRoot=";

    if windows_directory.is_empty() || windows_directory.contains(&0) {
        return Err(());
    }
    let prefix: Vec<u16> = SYSTEM_ROOT_PREFIX.encode_utf16().collect();
    let environment_length = prefix
        .len()
        .checked_add(windows_directory.len())
        .and_then(|length| length.checked_add(2))
        .filter(|length| *length <= WINDOWS_DIRECTORY_MAX_U16)
        .ok_or(())?;
    let mut environment = Vec::with_capacity(environment_length);
    environment.extend(prefix);
    environment.extend_from_slice(windows_directory);
    environment.extend([0, 0]);
    Ok(environment)
}

#[cfg(any(windows, test))]
fn build_command_line_for_argument(argument: &str) -> Result<Vec<u16>, ()> {
    let admitted = matches!(
        argument,
        WINDOWS_WORKER_MODE_ARGUMENT | WINDOWS_PROBE_CHILD_ARGUMENT | WINDOWS_PROBE_PARENT_ARGUMENT
    );
    #[cfg(all(test, windows))]
    let admitted = admitted || argument == WINDOWS_ANONYMOUS_PIPE_TEST_CHILD_ARGUMENT;
    if !admitted {
        return Err(());
    }
    Ok(format!("{WINDOWS_WORKER_PROGRAM_NAME} {argument}\0")
        .encode_utf16()
        .collect())
}

#[cfg(any(windows, test))]
fn build_worker_command_line() -> Vec<u16> {
    build_command_line_for_argument(WINDOWS_WORKER_MODE_ARGUMENT)
        .expect("the production Windows worker argument must be accepted")
}

#[cfg(any(windows, test))]
fn worker_pipe_handle_contract_is_closed(
    worker_handles: [u64; 9],
    parent_handles: [u64; 9],
    worker_inheritable: [bool; 9],
    parent_inheritable: [bool; 9],
) -> bool {
    let handles = worker_handles
        .into_iter()
        .chain(parent_handles)
        .collect::<Vec<_>>();
    handles.iter().enumerate().all(|(index, handle)| {
        *handle != 0 && *handle != u64::MAX && !handles[..index].contains(handle)
    }) && worker_inheritable.into_iter().all(|value| value)
        && parent_inheritable.into_iter().all(|value| !value)
}

#[cfg(windows)]
fn build_worker_command_line_with_handles(
    control_read: HANDLE,
    ready_write: HANDLE,
    capability_read: HANDLE,
    capability_write: HANDLE,
    model_read: HANDLE,
    model_write: HANDLE,
) -> Result<Vec<u16>, ()> {
    let handles = [
        control_read,
        ready_write,
        capability_read,
        capability_write,
        model_read,
        model_write,
    ];
    if handles
        .iter()
        .any(|handle| handle.is_null() || *handle == INVALID_HANDLE_VALUE)
        || handles
            .iter()
            .enumerate()
            .any(|(index, handle)| handles[..index].contains(handle))
    {
        return Err(());
    }
    let values = handles.map(|handle| handle as usize as u64);
    if values.iter().any(|value| *value == 0 || *value == u64::MAX) {
        return Err(());
    }
    Ok(format!(
        "{WINDOWS_WORKER_PROGRAM_NAME} {WINDOWS_WORKER_MODE_ARGUMENT} {} {} {} {} {} {}\0",
        values[0], values[1], values[2], values[3], values[4], values[5]
    )
    .encode_utf16()
    .collect())
}

#[cfg(test)]
fn build_diagnostic_windows_environment_block(
    windows_directory: &[u16],
    kind: DiagnosticEnvironmentKind,
) -> Result<Vec<u16>, ()> {
    if windows_directory.is_empty() || windows_directory.contains(&0) {
        return Err(());
    }

    let system_root_prefix: Vec<u16> = "SystemRoot=".encode_utf16().collect();
    let windir_prefix: Vec<u16> = "WINDIR=".encode_utf16().collect();
    let comspec_prefix: Vec<u16> = "ComSpec=".encode_utf16().collect();
    let comspec_suffix: Vec<u16> = r"\System32\cmd.exe".encode_utf16().collect();
    let mut environment = Vec::new();

    if kind == DiagnosticEnvironmentKind::SystemRootWindirComSpec {
        environment.extend(comspec_prefix);
        environment.extend_from_slice(windows_directory);
        environment.extend(comspec_suffix);
        environment.push(0);
    }
    environment.extend(system_root_prefix);
    environment.extend_from_slice(windows_directory);
    environment.push(0);
    environment.extend(windir_prefix);
    environment.extend_from_slice(windows_directory);
    environment.extend([0, 0]);

    if environment.len() > WINDOWS_DIRECTORY_MAX_U16 {
        return Err(());
    }
    Ok(environment)
}

#[cfg(windows)]
fn trusted_windows_directory() -> Result<Vec<u16>, ()> {
    const INITIAL_CAPACITY: usize = 260;

    let mut buffer = vec![0_u16; INITIAL_CAPACITY];
    loop {
        let buffer_length = u32::try_from(buffer.len()).map_err(|_| ())?;
        // SAFETY: buffer is writable for buffer_length UTF-16 code units. The function returns
        // either the copied length without its terminator or the required capacity.
        let copied = unsafe { GetWindowsDirectoryW(buffer.as_mut_ptr(), buffer_length) } as usize;
        if copied == 0 {
            return Err(());
        }
        if copied < buffer.len() {
            buffer.truncate(copied);
            return Ok(buffer);
        }
        let required_capacity = copied
            .checked_add(1)
            .filter(|capacity| *capacity <= WINDOWS_DIRECTORY_MAX_U16)
            .ok_or(())?;
        buffer.resize(required_capacity, 0);
    }
}

#[cfg(all(test, windows))]
fn trusted_diagnostic_windows_environment_block(
    kind: DiagnosticEnvironmentKind,
) -> Result<Vec<u16>, ()> {
    let windows_directory = trusted_windows_directory()?;
    build_diagnostic_windows_environment_block(&windows_directory, kind)
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkerLaunchVariant {
    Production,
    #[cfg(test)]
    FullInherit,
    #[cfg(test)]
    FullSystemRootWindir,
    #[cfg(test)]
    FullSystemRootWindirComSpec,
    #[cfg(test)]
    SecurityOnlyInherit,
    #[cfg(test)]
    HandleListOnlyInherit,
    #[cfg(test)]
    PlainInherit,
}

#[cfg(windows)]
impl WorkerLaunchVariant {
    fn uses_security_capabilities(self) -> bool {
        match self {
            Self::Production => true,
            #[cfg(test)]
            Self::FullInherit
            | Self::FullSystemRootWindir
            | Self::FullSystemRootWindirComSpec
            | Self::SecurityOnlyInherit => true,
            #[cfg(test)]
            Self::HandleListOnlyInherit | Self::PlainInherit => false,
        }
    }

    fn uses_handle_list(self) -> bool {
        match self {
            Self::Production => true,
            #[cfg(test)]
            Self::FullInherit
            | Self::FullSystemRootWindir
            | Self::FullSystemRootWindirComSpec
            | Self::HandleListOnlyInherit => true,
            #[cfg(test)]
            Self::SecurityOnlyInherit | Self::PlainInherit => false,
        }
    }

    fn environment(self) -> Result<Option<Vec<u16>>, ()> {
        match self {
            // Production inherits the supervisor environment, which Main has already cleaned.
            // Sparse hand-built environment blocks fail AppContainer process initialization.
            Self::Production => Ok(None),
            #[cfg(test)]
            Self::FullInherit
            | Self::SecurityOnlyInherit
            | Self::HandleListOnlyInherit
            | Self::PlainInherit => Ok(None),
            #[cfg(test)]
            Self::FullSystemRootWindir => trusted_diagnostic_windows_environment_block(
                DiagnosticEnvironmentKind::SystemRootWindir,
            )
            .map(Some),
            #[cfg(test)]
            Self::FullSystemRootWindirComSpec => trusted_diagnostic_windows_environment_block(
                DiagnosticEnvironmentKind::SystemRootWindirComSpec,
            )
            .map(Some),
        }
    }

    #[cfg(test)]
    fn label(self) -> &'static str {
        match self {
            Self::Production => "full-system-root",
            Self::FullInherit => "full-inherit",
            Self::FullSystemRootWindir => "full-system-root-windir",
            Self::FullSystemRootWindirComSpec => "full-system-root-windir-comspec",
            Self::SecurityOnlyInherit => "security-only-inherit",
            Self::HandleListOnlyInherit => "handle-list-only-inherit",
            Self::PlainInherit => "plain-inherit",
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CreateProcessFailureReason {
    FileNotFound,
    PathNotFound,
    AccessDenied,
    InvalidHandle,
    BadEnvironment,
    EnvironmentVariableNotFound,
    NotSupported,
    InvalidParameter,
    ElevationRequired,
    PrivilegeNotHeld,
    Other(u32),
}

#[cfg(any(windows, test))]
impl CreateProcessFailureReason {
    fn classify(win32_code: u32) -> Self {
        match win32_code {
            2 => Self::FileNotFound,
            3 => Self::PathNotFound,
            5 => Self::AccessDenied,
            6 => Self::InvalidHandle,
            10 => Self::BadEnvironment,
            203 => Self::EnvironmentVariableNotFound,
            50 => Self::NotSupported,
            87 => Self::InvalidParameter,
            740 => Self::ElevationRequired,
            1314 => Self::PrivilegeNotHeld,
            _ => Self::Other(win32_code),
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::FileNotFound => "file-not-found",
            Self::PathNotFound => "path-not-found",
            Self::AccessDenied => "access-denied",
            Self::InvalidHandle => "invalid-handle",
            Self::BadEnvironment => "bad-environment",
            Self::EnvironmentVariableNotFound => "environment-variable-not-found",
            Self::NotSupported => "not-supported",
            Self::InvalidParameter => "invalid-parameter",
            Self::ElevationRequired => "elevation-required",
            Self::PrivilegeNotHeld => "privilege-not-held",
            Self::Other(_) => "other",
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkerLaunchFailureStage {
    InputValidation,
    AttributeListInit,
    SecurityCapabilitiesAttribute,
    HandleListAttribute,
    CreateProcess(CreateProcessFailureReason),
    AssignJob,
    QueryJobMembership,
    ExcludedHandleInherited,
    ExcludedHandleAmbiguous,
    ResumeThread,
}

#[cfg(any(windows, test))]
impl WorkerLaunchFailureStage {
    fn code(self) -> &'static str {
        match self {
            Self::InputValidation => "input-validation",
            Self::AttributeListInit => "attribute-list-init",
            Self::SecurityCapabilitiesAttribute => "security-capabilities-attribute",
            Self::HandleListAttribute => "handle-list-attribute",
            Self::CreateProcess(_) => "create-process",
            Self::AssignJob => "assign-job",
            Self::QueryJobMembership => "query-job-membership",
            Self::ExcludedHandleInherited => "excluded-handle-inherited",
            Self::ExcludedHandleAmbiguous => "excluded-handle-ambiguous",
            Self::ResumeThread => "resume-thread",
        }
    }

    fn reason_code(self) -> &'static str {
        match self {
            Self::CreateProcess(reason) => reason.code(),
            _ => "none",
        }
    }

    fn unclassified_win32_code(self) -> Option<u32> {
        match self {
            Self::CreateProcess(CreateProcessFailureReason::Other(win32_code)) => Some(win32_code),
            _ => None,
        }
    }

    #[cfg(windows)]
    fn win32_code(self) -> Option<u32> {
        match self {
            Self::CreateProcess(CreateProcessFailureReason::FileNotFound) => Some(2),
            Self::CreateProcess(CreateProcessFailureReason::PathNotFound) => Some(3),
            Self::CreateProcess(CreateProcessFailureReason::AccessDenied) => Some(5),
            Self::CreateProcess(CreateProcessFailureReason::InvalidHandle) => Some(6),
            Self::CreateProcess(CreateProcessFailureReason::BadEnvironment) => Some(10),
            Self::CreateProcess(CreateProcessFailureReason::EnvironmentVariableNotFound) => {
                Some(203)
            }
            Self::CreateProcess(CreateProcessFailureReason::NotSupported) => Some(50),
            Self::CreateProcess(CreateProcessFailureReason::InvalidParameter) => Some(87),
            Self::CreateProcess(CreateProcessFailureReason::ElevationRequired) => Some(740),
            Self::CreateProcess(CreateProcessFailureReason::PrivilegeNotHeld) => Some(1314),
            Self::CreateProcess(CreateProcessFailureReason::Other(win32_code)) => Some(win32_code),
            _ => None,
        }
    }

    fn diagnostic_exit_code(self) -> i32 {
        match self {
            Self::InputValidation => 20,
            Self::AttributeListInit => 21,
            Self::SecurityCapabilitiesAttribute => 22,
            Self::HandleListAttribute => 23,
            Self::CreateProcess(CreateProcessFailureReason::FileNotFound) => 30,
            Self::CreateProcess(CreateProcessFailureReason::PathNotFound) => 31,
            Self::CreateProcess(CreateProcessFailureReason::AccessDenied) => 32,
            Self::CreateProcess(CreateProcessFailureReason::InvalidHandle) => 33,
            Self::CreateProcess(CreateProcessFailureReason::BadEnvironment) => 34,
            Self::CreateProcess(CreateProcessFailureReason::EnvironmentVariableNotFound) => 35,
            Self::CreateProcess(CreateProcessFailureReason::NotSupported) => 36,
            Self::CreateProcess(CreateProcessFailureReason::InvalidParameter) => 37,
            Self::CreateProcess(CreateProcessFailureReason::ElevationRequired) => 38,
            Self::CreateProcess(CreateProcessFailureReason::PrivilegeNotHeld) => 39,
            Self::CreateProcess(CreateProcessFailureReason::Other(_)) => 40,
            Self::AssignJob => 41,
            Self::QueryJobMembership => 42,
            Self::ExcludedHandleInherited => 44,
            Self::ExcludedHandleAmbiguous => 45,
            Self::ResumeThread => 43,
        }
    }
}

/// Exit protocol owned only by the synthetic AppContainer anonymous-pipe child used by the native
/// regression test. These values deliberately do not overlap the production Worker's `101..=116`
/// startup protocol, so a libtest panic or a test-stage failure cannot be misreported as a
/// production control-frame failure.
#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AnonymousPipeTestChildFailure {
    Runtime,
    Channel,
    StateDirectory,
    RootWriteAllowed,
    FrameEncode,
    FrameWrite,
    FrameRead,
    FrameMismatch,
    Panic,
    UnexpectedExit,
}

#[cfg(test)]
impl AnonymousPipeTestChildFailure {
    fn exit_code(self) -> i32 {
        match self {
            Self::Runtime => 201,
            Self::Channel => 202,
            Self::StateDirectory => 208,
            Self::RootWriteAllowed => 209,
            Self::FrameEncode => 203,
            Self::FrameWrite => 204,
            Self::FrameRead => 205,
            Self::FrameMismatch => 206,
            Self::Panic | Self::UnexpectedExit => 207,
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::Runtime => "test-child-runtime-failed",
            Self::Channel => "test-child-channel-invalid",
            Self::StateDirectory => "test-child-state-directory-failed",
            Self::RootWriteAllowed => "test-child-root-write-allowed",
            Self::FrameEncode => "test-child-frame-encode-failed",
            Self::FrameWrite => "test-child-frame-write-failed",
            Self::FrameRead => "test-child-frame-read-failed",
            Self::FrameMismatch => "test-child-frame-mismatch",
            Self::Panic => "test-child-panic",
            Self::UnexpectedExit => "test-child-unexpected-exit",
        }
    }
}

#[cfg(test)]
fn classify_anonymous_pipe_test_child_exit(exit_code: u32) -> AnonymousPipeTestChildFailure {
    match exit_code {
        201 => AnonymousPipeTestChildFailure::Runtime,
        202 => AnonymousPipeTestChildFailure::Channel,
        208 => AnonymousPipeTestChildFailure::StateDirectory,
        209 => AnonymousPipeTestChildFailure::RootWriteAllowed,
        203 => AnonymousPipeTestChildFailure::FrameEncode,
        204 => AnonymousPipeTestChildFailure::FrameWrite,
        205 => AnonymousPipeTestChildFailure::FrameRead,
        206 => AnonymousPipeTestChildFailure::FrameMismatch,
        // Rust's libtest harness reserves 101 for a test panic.
        101 => AnonymousPipeTestChildFailure::Panic,
        _ => AnonymousPipeTestChildFailure::UnexpectedExit,
    }
}

/// Worker startup stage a worker exit code identifies, so a worker that dies
/// before connecting is attributed to the stage it died in rather than being
/// collapsed into one opaque runtime failure.
#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WorkerStartupFailure {
    ControlFrame,
    BoundaryVerification,
    RuntimeCreation,
    CapabilityBridge,
    ModelBridge,
    StateDirectory,
    ReadySignal,
    AcpHandshake,
    Unknown,
}

#[cfg(any(windows, test))]
fn classify_worker_startup_exit(exit_code: u32) -> WorkerStartupFailure {
    match exit_code {
        101 => WorkerStartupFailure::ControlFrame,
        102 => WorkerStartupFailure::BoundaryVerification,
        103 => WorkerStartupFailure::RuntimeCreation,
        108 => WorkerStartupFailure::CapabilityBridge,
        113 => WorkerStartupFailure::ModelBridge,
        114 => WorkerStartupFailure::StateDirectory,
        115 => WorkerStartupFailure::ReadySignal,
        116 => WorkerStartupFailure::AcpHandshake,
        _ => WorkerStartupFailure::Unknown,
    }
}

#[cfg(any(windows, test))]
impl WorkerStartupFailure {
    fn diagnostic_exit_code(self) -> i32 {
        match self {
            Self::ControlFrame => 47,
            Self::BoundaryVerification => 48,
            Self::RuntimeCreation => 49,
            Self::CapabilityBridge => 54,
            Self::ModelBridge => 59,
            Self::StateDirectory => 60,
            Self::ReadySignal => 61,
            Self::AcpHandshake => 62,
            Self::Unknown => 46,
        }
    }

    fn runtime_code(self) -> &'static str {
        match self {
            Self::ControlFrame => "windows-worker-control-frame-invalid",
            Self::BoundaryVerification => "windows-worker-boundary-verification-failed",
            Self::RuntimeCreation => "windows-worker-runtime-creation-failed",
            Self::CapabilityBridge => "windows-worker-capability-bridge-failed",
            Self::ModelBridge => "windows-worker-model-bridge-failed",
            Self::StateDirectory => "windows-worker-state-directory-failed",
            Self::ReadySignal => "windows-worker-ready-signal-failed",
            Self::AcpHandshake => "windows-worker-acp-handshake-failed",
            Self::Unknown => "windows-worker-runtime-failed",
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SupervisorFailureStage {
    ControlFrame,
    Profile,
    Job,
    Pipes,
    CurrentExecutable,
    WorkerLaunch(WorkerLaunchFailureStage),
    ControlSerialization,
    ControlWrite,
    WorkerReady,
    CapabilityChannel,
    ModelChannel,
    WorkerRuntime,
    WorkerStartup(WorkerStartupFailure),
}

#[cfg(any(windows, test))]
impl SupervisorFailureStage {
    fn diagnostic_exit_code(self) -> i32 {
        match self {
            Self::ControlFrame => 10,
            Self::Profile => 11,
            Self::Job => 12,
            Self::Pipes => 13,
            Self::CurrentExecutable => 14,
            Self::WorkerLaunch(stage) => stage.diagnostic_exit_code(),
            Self::ControlSerialization => 15,
            Self::ControlWrite => 16,
            Self::WorkerReady => 17,
            Self::CapabilityChannel => 18,
            Self::ModelChannel => 19,
            Self::WorkerRuntime => 46,
            Self::WorkerStartup(failure) => failure.diagnostic_exit_code(),
        }
    }
}

#[cfg(any(windows, test))]
fn runtime_code_for_supervisor_failure(stage: SupervisorFailureStage) -> Option<&'static str> {
    match stage {
        SupervisorFailureStage::ControlFrame
        | SupervisorFailureStage::ControlSerialization
        | SupervisorFailureStage::ControlWrite => Some("windows-control-channel-invalid"),
        SupervisorFailureStage::WorkerReady => Some("windows-ready-channel-invalid"),
        SupervisorFailureStage::CapabilityChannel => Some("windows-capability-channel-invalid"),
        SupervisorFailureStage::ModelChannel => Some("windows-model-channel-invalid"),
        SupervisorFailureStage::WorkerRuntime => Some("windows-worker-runtime-failed"),
        SupervisorFailureStage::WorkerStartup(failure) => Some(failure.runtime_code()),
        _ => None,
    }
}

#[cfg(windows)]
fn report_supervisor_failure(stage: SupervisorFailureStage, fallback_marker: &str) -> i32 {
    if let Some(code) = runtime_code_for_supervisor_failure(stage) {
        eprintln!("Goose windows containment failed at bounded stage {code}");
    } else {
        eprintln!("{fallback_marker}");
    }
    stage.diagnostic_exit_code()
}

fn is_exact_attempt_id(attempt_id: &str) -> bool {
    attempt_id.len() == 32
        && attempt_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(windows)]
pub(crate) fn remove_windows_probe_profile(attempt_id: &str) -> Result<(), ()> {
    if !is_exact_attempt_id(attempt_id) {
        return Err(());
    }
    let name: Vec<u16> = format!("Actestra.Goose.{attempt_id}\0")
        .encode_utf16()
        .collect();
    // SAFETY: name is an exact, locally derived, NUL-terminated profile identifier.
    if unsafe { DeleteAppContainerProfile(name.as_ptr()) } < 0 {
        return Err(());
    }
    Ok(())
}

#[cfg(windows)]
struct AppContainerProfile {
    name: String,
    wide_name: Vec<u16>,
    sid: PSID,
    removed: bool,
}

#[cfg(windows)]
impl AppContainerProfile {
    fn create(attempt_id: &str) -> Result<Self, ()> {
        if !is_exact_attempt_id(attempt_id) {
            return Err(());
        }

        let name = format!("Actestra.Goose.{attempt_id}");
        let wide_name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let mut created_sid: PSID = null_mut();
        // SAFETY: all strings are NUL-terminated, the capabilities pointer is null with a zero
        // count, and created_sid is an out pointer owned by this function on success.
        let create_result = unsafe {
            CreateAppContainerProfile(
                wide_name.as_ptr(),
                wide_name.as_ptr(),
                wide_name.as_ptr(),
                null(),
                0,
                &mut created_sid,
            )
        };
        if create_result < 0 || created_sid.is_null() {
            if create_result >= 0 {
                // SAFETY: this exact profile was created above and no external name is used.
                unsafe { DeleteAppContainerProfile(wide_name.as_ptr()) };
            }
            return Err(());
        }

        let mut derived_sid: PSID = null_mut();
        // SAFETY: wide_name remains NUL-terminated and derived_sid is an out pointer.
        let derive_result = unsafe {
            DeriveAppContainerSidFromAppContainerName(wide_name.as_ptr(), &mut derived_sid)
        };
        // SAFETY: created_sid came from CreateAppContainerProfile on the successful path.
        let matching_sid = derive_result >= 0
            && !derived_sid.is_null()
            && unsafe { EqualSid(created_sid, derived_sid) } != 0;
        // SAFETY: created_sid is owned by this function and is no longer needed.
        unsafe { FreeSid(created_sid) };
        if !matching_sid {
            if !derived_sid.is_null() {
                // SAFETY: derived_sid came from DeriveAppContainerSidFromAppContainerName.
                unsafe { FreeSid(derived_sid) };
            }
            // SAFETY: this exact profile was created above and no external name is used.
            unsafe { DeleteAppContainerProfile(wide_name.as_ptr()) };
            return Err(());
        }

        Ok(Self {
            name,
            wide_name,
            sid: derived_sid,
            removed: false,
        })
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn security_capabilities(&self) -> SECURITY_CAPABILITIES {
        SECURITY_CAPABILITIES {
            AppContainerSid: self.sid,
            Capabilities: null_mut(),
            CapabilityCount: 0,
            Reserved: 0,
        }
    }

    fn sid(&self) -> PSID {
        self.sid
    }

    fn remove(&mut self) -> Result<(), ()> {
        if self.removed {
            return Ok(());
        }
        // SAFETY: wide_name is the exact NUL-terminated profile name created by this owner.
        if unsafe { DeleteAppContainerProfile(self.wide_name.as_ptr()) } < 0 {
            return Err(());
        }
        self.removed = true;
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for AppContainerProfile {
    fn drop(&mut self) {
        // SAFETY: both resources are exact values created and retained by this instance. Drop is
        // only a backstop; admitting cleanup uses the observable remove() result above.
        unsafe {
            if !self.removed {
                DeleteAppContainerProfile(self.wide_name.as_ptr());
            }
            FreeSid(self.sid);
        }
    }
}

#[cfg(windows)]
struct JobObject {
    handle: HANDLE,
}

#[cfg(windows)]
struct JobObjectQuery {
    extended: JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    ui: JOBOBJECT_BASIC_UI_RESTRICTIONS,
}

#[cfg(windows)]
impl JobObjectQuery {
    fn is_exact(&self) -> bool {
        self.extended.BasicLimitInformation.LimitFlags == WINDOWS_JOB_LIMIT_FLAGS
            && self.extended.BasicLimitInformation.ActiveProcessLimit
                == WINDOWS_JOB_ACTIVE_PROCESS_LIMIT
            && self.extended.BasicLimitInformation.PerJobUserTimeLimit
                == WINDOWS_JOB_USER_TIME_100NS
            && self.extended.JobMemoryLimit == WINDOWS_JOB_MEMORY_LIMIT_BYTES
            && self.ui.UIRestrictionsClass == WINDOWS_JOB_UI_RESTRICTIONS
    }
}

#[cfg(windows)]
struct ProcThreadAttributeList {
    _storage: Vec<usize>,
    pointer: *mut c_void,
}

#[cfg(windows)]
impl ProcThreadAttributeList {
    fn create(attribute_count: u32) -> Result<Self, ()> {
        let mut required_bytes = 0_usize;
        // SAFETY: the documented sizing call uses a null list and fills required_bytes.
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), attribute_count, 0, &mut required_bytes)
        };
        if required_bytes == 0 {
            return Err(());
        }
        let word_count = required_bytes.div_ceil(size_of::<usize>());
        let mut storage = vec![0_usize; word_count];
        let pointer = storage.as_mut_ptr().cast::<c_void>();
        // SAFETY: storage is suitably aligned and holds at least required_bytes for the list.
        if unsafe {
            InitializeProcThreadAttributeList(pointer, attribute_count, 0, &mut required_bytes)
        } == 0
        {
            return Err(());
        }
        Ok(Self {
            _storage: storage,
            pointer,
        })
    }

    fn update(&mut self, attribute: u32, value: *const c_void, bytes: usize) -> Result<(), ()> {
        if value.is_null() || bytes == 0 {
            return Err(());
        }
        // SAFETY: pointer owns an initialized list and the caller keeps value alive through
        // CreateProcessW. No previous-value buffer is requested.
        if unsafe {
            UpdateProcThreadAttribute(
                self.pointer,
                0,
                attribute as usize,
                value,
                bytes,
                null_mut(),
                null(),
            )
        } == 0
        {
            return Err(());
        }
        Ok(())
    }
}

#[cfg(windows)]
impl Drop for ProcThreadAttributeList {
    fn drop(&mut self) {
        // SAFETY: pointer was initialized successfully and remains backed by _storage.
        unsafe { DeleteProcThreadAttributeList(self.pointer) };
    }
}

#[cfg(windows)]
struct WorkerProcess {
    process: HANDLE,
    thread: HANDLE,
    assigned_before_resume: bool,
    resumed_from_one_suspend: bool,
}

#[cfg(windows)]
impl WorkerProcess {
    fn process_handle(&self) -> HANDLE {
        self.process
    }

    fn process_id(&self) -> Result<u32, ()> {
        // SAFETY: process is a live process handle owned by this wrapper.
        let process_id = unsafe { GetProcessId(self.process) };
        if process_id == 0 {
            return Err(());
        }
        Ok(process_id)
    }

    fn was_assigned_before_resume(&self) -> bool {
        self.assigned_before_resume
    }

    fn was_resumed_from_one_suspend(&self) -> bool {
        self.resumed_from_one_suspend
    }

    fn wait_for_exit(&self, timeout_ms: u32) -> Result<u32, ()> {
        // SAFETY: process is a live synchronization/query handle owned by this wrapper.
        if unsafe { WaitForSingleObject(self.process, timeout_ms) } != WAIT_OBJECT_0 {
            return Err(());
        }
        let mut exit_code = 0_u32;
        // SAFETY: process is signaled and exit_code is a valid out pointer.
        if unsafe { GetExitCodeProcess(self.process, &mut exit_code) } == 0 {
            return Err(());
        }
        Ok(exit_code)
    }
}

#[cfg(windows)]
impl Drop for WorkerProcess {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns both handles. Termination is idempotent for an already
        // exited process; the bounded wait avoids leaving a process behind during unwinding.
        unsafe {
            TerminateProcess(self.process, 1);
            WaitForSingleObject(self.process, 5_000);
            CloseHandle(self.thread);
            CloseHandle(self.process);
        }
    }
}

#[cfg(windows)]
pub(crate) struct ProbeHandle {
    handle: HANDLE,
}

#[cfg(windows)]
impl ProbeHandle {
    pub(crate) fn create() -> Result<Self, ()> {
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        // SAFETY: attributes is initialized, the event has no name, and the returned handle is
        // immediately owned by ProbeHandle.
        let handle = unsafe { CreateEventW(&raw mut attributes, 1, 0, null()) };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(());
        }
        Ok(Self { handle })
    }

    fn encoded_value(&self) -> Result<u64, ()> {
        let value = self.handle as usize as u64;
        if value == 0 || value == u64::MAX {
            return Err(());
        }
        Ok(value)
    }
}

#[cfg(windows)]
impl Drop for ProbeHandle {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns the event handle created by ProbeHandle::create.
        unsafe { CloseHandle(self.handle) };
    }
}

#[cfg(windows)]
pub(crate) struct WindowsContainmentLaunch {
    profile: AppContainerProfile,
    job: JobObject,
    worker: WorkerProcess,
    pipes: WorkerPipeSet,
    excluded_handle_absent: bool,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsProbeExchangeFailure {
    RequestFrame,
    WorkerWait,
    WorkerRequest,
    WorkerResult,
    WorkerEntry,
    WorkerPanic,
    WorkerImageLoad,
    WorkerRuntimeFault,
    WorkerBeforeEntry,
    WorkerInputHandleStage,
    WorkerRequestLengthStage,
    WorkerRequestFrameStage,
    WorkerRequestDecodeStage,
    WorkerFilesystemStage,
    WorkerNetworkStage,
    WorkerProcessStage,
    WorkerResultStage,
    WorkerStageWrite,
    WorkerUnexpectedExit,
    ResultFrame,
}

#[cfg(any(windows, test))]
fn classify_windows_probe_child_exit(exit_code: u32) -> WindowsProbeExchangeFailure {
    match exit_code {
        value if value == WINDOWS_PROBE_CHILD_REQUEST_FAILURE_EXIT_CODE as u32 => {
            WindowsProbeExchangeFailure::WorkerRequest
        }
        value if value == WINDOWS_PROBE_CHILD_RESULT_FAILURE_EXIT_CODE as u32 => {
            WindowsProbeExchangeFailure::WorkerResult
        }
        value if value == WINDOWS_PROBE_CHILD_STAGE_FAILURE_EXIT_CODE as u32 => {
            WindowsProbeExchangeFailure::WorkerStageWrite
        }
        1 => WindowsProbeExchangeFailure::WorkerEntry,
        101 => WindowsProbeExchangeFailure::WorkerPanic,
        0xc000_0022 | 0xc000_007b | 0xc000_0135 | 0xc000_0142 => {
            WindowsProbeExchangeFailure::WorkerImageLoad
        }
        0xc000_0005 | 0xc000_0409 => WindowsProbeExchangeFailure::WorkerRuntimeFault,
        _ => WindowsProbeExchangeFailure::WorkerUnexpectedExit,
    }
}

#[cfg(any(windows, test))]
fn classify_windows_probe_child_exit_with_transcript(
    exit_code: u32,
    transcript: &[u8],
) -> WindowsProbeExchangeFailure {
    let direct = classify_windows_probe_child_exit(exit_code);
    if direct != WindowsProbeExchangeFailure::WorkerUnexpectedExit {
        return direct;
    }
    if transcript.len() > WINDOWS_PROBE_CHILD_STAGES.len()
        || !transcript
            .iter()
            .enumerate()
            .all(|(index, marker)| *marker == WINDOWS_PROBE_CHILD_STAGES[index].marker())
    {
        return WindowsProbeExchangeFailure::WorkerUnexpectedExit;
    }
    match transcript.last().copied() {
        None => WindowsProbeExchangeFailure::WorkerBeforeEntry,
        Some(marker) if marker == WindowsProbeChildStage::Entry.marker() => {
            WindowsProbeExchangeFailure::WorkerInputHandleStage
        }
        Some(marker) if marker == WindowsProbeChildStage::InputHandleReady.marker() => {
            WindowsProbeExchangeFailure::WorkerRequestLengthStage
        }
        Some(marker) if marker == WindowsProbeChildStage::RequestLengthRead.marker() => {
            WindowsProbeExchangeFailure::WorkerRequestFrameStage
        }
        Some(marker) if marker == WindowsProbeChildStage::RequestFrameRead.marker() => {
            WindowsProbeExchangeFailure::WorkerRequestDecodeStage
        }
        Some(marker) if marker == WindowsProbeChildStage::RequestDecoded.marker() => {
            WindowsProbeExchangeFailure::WorkerFilesystemStage
        }
        Some(marker) if marker == WindowsProbeChildStage::FilesystemComplete.marker() => {
            WindowsProbeExchangeFailure::WorkerNetworkStage
        }
        Some(marker) if marker == WindowsProbeChildStage::NetworkComplete.marker() => {
            WindowsProbeExchangeFailure::WorkerProcessStage
        }
        Some(marker) if marker == WindowsProbeChildStage::ProcessComplete.marker() => {
            WindowsProbeExchangeFailure::WorkerResultStage
        }
        Some(_) => WindowsProbeExchangeFailure::WorkerUnexpectedExit,
    }
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowsContainmentObservation {
    pub(crate) app_container: bool,
    pub(crate) assigned_before_resume: bool,
    pub(crate) excluded_handle_absent: bool,
    pub(crate) resumed_once: bool,
    pub(crate) exact_job_limits: bool,
    pub(crate) single_active_process: bool,
}

#[cfg(any(windows, test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowsCleanupReceipt {
    pub(crate) worker_terminal: bool,
    pub(crate) profile_removed: bool,
    pub(crate) private_root_removed: bool,
}

#[cfg(any(windows, test))]
impl WindowsCleanupReceipt {
    pub(crate) fn complete(self) -> bool {
        self.worker_terminal && self.profile_removed && self.private_root_removed
    }
}

#[cfg(windows)]
pub(crate) struct WindowsProbeProcess {
    handle: HANDLE,
}

#[cfg(windows)]
impl WindowsProbeProcess {
    pub(crate) fn is_running(&self) -> bool {
        // SAFETY: handle is a live synchronization handle owned by this wrapper.
        (unsafe { WaitForSingleObject(self.handle, 0) }) == WAIT_TIMEOUT
    }

    pub(crate) fn wait_for_exit(&self, timeout_ms: u32) -> bool {
        // SAFETY: handle is a live synchronization handle owned by this wrapper.
        (unsafe { WaitForSingleObject(self.handle, timeout_ms) }) == WAIT_OBJECT_0
    }
}

#[cfg(windows)]
impl Drop for WindowsProbeProcess {
    fn drop(&mut self) {
        // SAFETY: this wrapper owns the process handle opened below.
        unsafe { CloseHandle(self.handle) };
    }
}

#[cfg(windows)]
pub(crate) fn open_windows_probe_process(process_id: u32) -> Result<WindowsProbeProcess, ()> {
    if process_id == 0 {
        return Err(());
    }
    // SAFETY: the requested access is synchronization/query-only, inheritance is disabled, and
    // the returned handle is immediately owned by WindowsProbeProcess.
    let handle = unsafe {
        OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            process_id,
        )
    };
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(());
    }
    Ok(WindowsProbeProcess { handle })
}

#[cfg(windows)]
impl WindowsContainmentLaunch {
    pub(crate) fn observation(&self) -> Result<WindowsContainmentObservation, ()> {
        let mut token: HANDLE = null_mut();
        // SAFETY: the Worker process handle is live while this owner exists and token is an out
        // pointer closed before the function returns.
        if unsafe { OpenProcessToken(self.worker.process_handle(), TOKEN_QUERY, &mut token) } == 0
            || token.is_null()
        {
            return Err(());
        }
        let mut is_app_container = 0_u32;
        let mut return_length = 0_u32;
        // SAFETY: token is live and the output buffer exactly matches TokenIsAppContainer.
        let queried = unsafe {
            GetTokenInformation(
                token,
                TokenIsAppContainer,
                (&raw mut is_app_container).cast::<c_void>(),
                size_of::<u32>() as u32,
                &mut return_length,
            )
        } != 0;
        // SAFETY: token was opened above and is not retained.
        unsafe { CloseHandle(token) };
        if !queried {
            return Err(());
        }
        Ok(WindowsContainmentObservation {
            app_container: is_app_container == 1,
            assigned_before_resume: self.worker.was_assigned_before_resume()
                && self.job.contains_process(self.worker.process_handle())?,
            excluded_handle_absent: self.excluded_handle_absent,
            resumed_once: self.worker.was_resumed_from_one_suspend(),
            exact_job_limits: self.job.query_back()?.is_exact(),
            single_active_process: self.job.active_process_count()? == 1,
        })
    }

    pub(crate) fn exchange_probe_request(
        &mut self,
        request: &WindowsProbeRequest,
    ) -> Result<WindowsProbeResult, WindowsProbeExchangeFailure> {
        let frame = encode_request_frame(request, self.excluded_handle_absent)
            .map_err(|_| WindowsProbeExchangeFailure::RequestFrame)?;
        let frame_length =
            u32::try_from(frame.len()).map_err(|_| WindowsProbeExchangeFailure::RequestFrame)?;
        write_all_handle(self.pipes.supervisor_stdin, &frame_length.to_le_bytes())
            .map_err(|_| WindowsProbeExchangeFailure::RequestFrame)?;
        write_all_handle(self.pipes.supervisor_stdin, &frame)
            .map_err(|_| WindowsProbeExchangeFailure::RequestFrame)?;
        self.pipes.close_supervisor_stdin();
        let exit_code = self
            .worker
            .wait_for_exit(10_000)
            .map_err(|_| WindowsProbeExchangeFailure::WorkerWait)?;
        if exit_code != 0 {
            let transcript =
                read_windows_probe_child_stage_transcript(self.pipes.supervisor_stderr)
                    .unwrap_or_default();
            return Err(classify_windows_probe_child_exit_with_transcript(
                exit_code,
                &transcript,
            ));
        }
        let mut result = [0_u8; WINDOWS_PROBE_RESULT_FRAME_LENGTH];
        read_exact_handle(self.pipes.supervisor_stdout, &mut result)
            .map_err(|_| WindowsProbeExchangeFailure::ResultFrame)?;
        decode_result(&result).map_err(|_| WindowsProbeExchangeFailure::ResultFrame)
    }

    pub(crate) fn worker_process_id(&self) -> Result<u32, ()> {
        self.worker.process_id()
    }

    pub(crate) fn cleanup(mut self, private_root: &Path) -> WindowsCleanupReceipt {
        let terminated = self.job.terminate_for_cleanup().is_ok();
        let worker_terminal = terminated && self.worker.wait_for_exit(5_000).is_ok();
        let profile_removed = self.profile.remove().is_ok();
        drop(self);
        let private_root_removed = private_root.exists()
            && std::fs::remove_dir_all(private_root).is_ok()
            && !private_root.exists();
        WindowsCleanupReceipt {
            worker_terminal,
            profile_removed,
            private_root_removed,
        }
    }

    pub(crate) fn retained_profile_name(&self) -> &str {
        self.profile.name()
    }

    pub(crate) fn retained_parent_pipe_count(&self) -> usize {
        [
            self.pipes.supervisor_stdin,
            self.pipes.supervisor_stdout,
            self.pipes.supervisor_stderr,
        ]
        .iter()
        .filter(|handle| !handle.is_null() && **handle != INVALID_HANDLE_VALUE)
        .count()
    }
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsContainmentFailure {
    Profile,
    Job,
    Pipes,
    WorkerLaunch,
    ExcludedHandleInherited,
    ExcludedHandleAmbiguous,
}

#[cfg(windows)]
impl JobObject {
    fn create() -> Result<Self, ()> {
        // SAFETY: a null security descriptor and name create a private, non-inheritable Job
        // Object. The returned handle is owned by the RAII wrapper below.
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err(());
        }
        let job = Self { handle };
        job.configure()?;
        if !job.query_back()?.is_exact() {
            return Err(());
        }
        Ok(job)
    }

    fn configure(&self) -> Result<(), ()> {
        // SAFETY: both zeroed structures are valid initialization states for these plain Win32
        // structs and every enabled field is filled before the kernel reads it.
        let mut extended: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        extended.BasicLimitInformation.LimitFlags = WINDOWS_JOB_LIMIT_FLAGS;
        extended.BasicLimitInformation.ActiveProcessLimit = WINDOWS_JOB_ACTIVE_PROCESS_LIMIT;
        extended.BasicLimitInformation.PerJobUserTimeLimit = WINDOWS_JOB_USER_TIME_100NS;
        extended.JobMemoryLimit = WINDOWS_JOB_MEMORY_LIMIT_BYTES;
        // SAFETY: self.handle is a live Job Object and the pointer/size exactly match the
        // requested information class for the duration of the call.
        if unsafe {
            SetInformationJobObject(
                self.handle,
                JobObjectExtendedLimitInformation,
                (&raw const extended).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
        {
            return Err(());
        }

        let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
            UIRestrictionsClass: WINDOWS_JOB_UI_RESTRICTIONS,
        };
        // SAFETY: the pointer/size exactly match JobObjectBasicUIRestrictions.
        if unsafe {
            SetInformationJobObject(
                self.handle,
                JobObjectBasicUIRestrictions,
                (&raw const ui).cast::<c_void>(),
                size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
            )
        } == 0
        {
            return Err(());
        }
        Ok(())
    }

    fn active_process_count(&self) -> Result<u32, ()> {
        // SAFETY: zero is the documented initialization for this plain Win32 structure.
        let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { zeroed() };
        // SAFETY: self.handle is a live Job Object and the buffer exactly matches the requested
        // information class.
        if unsafe {
            QueryInformationJobObject(
                self.handle,
                JobObjectBasicAccountingInformation,
                (&raw mut accounting).cast::<c_void>(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(());
        }
        Ok(accounting.ActiveProcesses)
    }

    fn terminate_for_cleanup(&self) -> Result<(), ()> {
        // SAFETY: self.handle is the exact owned Job Object. This operation is used only for
        // explicit cleanup and is never counted as parent-death evidence.
        if unsafe { TerminateJobObject(self.handle, 1) } == 0 {
            return Err(());
        }
        Ok(())
    }

    fn query_back(&self) -> Result<JobObjectQuery, ()> {
        // SAFETY: zero is a valid initial state and the kernel fills exactly the declared size.
        let mut extended: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        // SAFETY: self.handle is live and the output pointer/size match the information class.
        if unsafe {
            QueryInformationJobObject(
                self.handle,
                JobObjectExtendedLimitInformation,
                (&raw mut extended).cast::<c_void>(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(());
        }

        // SAFETY: zero is a valid initial state and the kernel fills exactly the declared size.
        let mut ui: JOBOBJECT_BASIC_UI_RESTRICTIONS = unsafe { zeroed() };
        // SAFETY: self.handle is live and the output pointer/size match the information class.
        if unsafe {
            QueryInformationJobObject(
                self.handle,
                JobObjectBasicUIRestrictions,
                (&raw mut ui).cast::<c_void>(),
                size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
                null_mut(),
            )
        } == 0
        {
            return Err(());
        }
        Ok(JobObjectQuery { extended, ui })
    }

    fn contains_process(&self, process: HANDLE) -> Result<bool, ()> {
        if process.is_null() || process == INVALID_HANDLE_VALUE {
            return Err(());
        }
        let mut result = 0;
        // SAFETY: both handles are live and result is a valid BOOL out pointer.
        if unsafe { IsProcessInJob(process, self.handle, &mut result) } == 0 {
            return Err(());
        }
        Ok(result != 0)
    }

    fn launch_suspended_worker(
        &self,
        profile: &AppContainerProfile,
        executable: &Path,
        current_directory: &Path,
        inherited_handles: &[HANDLE],
    ) -> Result<WorkerProcess, WorkerLaunchFailureStage> {
        self.launch_suspended_worker_with_variant(
            profile,
            executable,
            current_directory,
            inherited_handles,
            WorkerLaunchVariant::Production,
        )
    }

    fn launch_suspended_worker_with_variant(
        &self,
        profile: &AppContainerProfile,
        executable: &Path,
        current_directory: &Path,
        inherited_handles: &[HANDLE],
        variant: WorkerLaunchVariant,
    ) -> Result<WorkerProcess, WorkerLaunchFailureStage> {
        self.launch_suspended_worker_with_variant_and_stdio(
            profile,
            executable,
            current_directory,
            inherited_handles,
            None,
            variant,
        )
    }

    #[cfg(windows)]
    fn launch_suspended_worker_with_stdio(
        &self,
        profile: &AppContainerProfile,
        executable: &Path,
        current_directory: &Path,
        inherited_handles: &[HANDLE],
        stdio: [HANDLE; 3],
    ) -> Result<WorkerProcess, WorkerLaunchFailureStage> {
        self.launch_suspended_worker_with_variant_and_stdio(
            profile,
            executable,
            current_directory,
            inherited_handles,
            Some(stdio),
            WorkerLaunchVariant::Production,
        )
    }

    fn launch_suspended_worker_with_variant_and_stdio(
        &self,
        profile: &AppContainerProfile,
        executable: &Path,
        current_directory: &Path,
        inherited_handles: &[HANDLE],
        stdio: Option<[HANDLE; 3]>,
        variant: WorkerLaunchVariant,
    ) -> Result<WorkerProcess, WorkerLaunchFailureStage> {
        self.launch_suspended_worker_with_variant_and_stdio_and_argument(
            profile,
            executable,
            current_directory,
            inherited_handles,
            stdio,
            variant,
            WINDOWS_WORKER_MODE_ARGUMENT,
            None,
        )
    }

    #[cfg(windows)]
    fn launch_suspended_worker_with_variant_and_stdio_and_argument(
        &self,
        profile: &AppContainerProfile,
        executable: &Path,
        current_directory: &Path,
        inherited_handles: &[HANDLE],
        stdio: Option<[HANDLE; 3]>,
        variant: WorkerLaunchVariant,
        command_argument: &str,
        excluded_handle: Option<HANDLE>,
    ) -> Result<WorkerProcess, WorkerLaunchFailureStage> {
        if excluded_handle.is_some_and(|handle| handle.is_null() || handle == INVALID_HANDLE_VALUE)
            || excluded_handle.is_some_and(|handle| inherited_handles.contains(&handle))
        {
            return Err(WorkerLaunchFailureStage::InputValidation);
        }
        if inherited_handles.is_empty()
            || inherited_handles.iter().any(|handle| {
                handle.is_null()
                    || *handle == INVALID_HANDLE_VALUE
                    || inherited_handles
                        .iter()
                        .filter(|other| *other == handle)
                        .count()
                        != 1
            })
        {
            return Err(WorkerLaunchFailureStage::InputValidation);
        }

        let current_directory_text = current_directory
            .to_str()
            .ok_or(WorkerLaunchFailureStage::InputValidation)?;
        if !current_directory.is_absolute()
            || current_directory_text.is_empty()
            || current_directory_text.contains(['\0', '"'])
        {
            return Err(WorkerLaunchFailureStage::InputValidation);
        }
        let current_directory_wide: Vec<u16> = current_directory_text
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let executable_text = executable
            .to_str()
            .ok_or(WorkerLaunchFailureStage::InputValidation)?;
        if !executable.is_absolute()
            || executable_text.is_empty()
            || executable_text.contains(['\0', '"'])
        {
            return Err(WorkerLaunchFailureStage::InputValidation);
        }
        let executable_wide: Vec<u16> = executable_text
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // lpApplicationName keeps image resolution bound to the admitted absolute executable.
        // argv[0] is a fixed non-secret basename so WindowsMode still receives the mode at argv[1].
        let mut command_line_wide =
            if command_argument == WINDOWS_WORKER_MODE_ARGUMENT && inherited_handles.len() == 9 {
                build_worker_command_line_with_handles(
                    inherited_handles[3],
                    inherited_handles[4],
                    inherited_handles[5],
                    inherited_handles[6],
                    inherited_handles[7],
                    inherited_handles[8],
                )
            } else {
                build_command_line_for_argument(command_argument)
            }
            .map_err(|()| WorkerLaunchFailureStage::InputValidation)?;

        let security_capabilities = profile.security_capabilities();
        let attribute_count =
            u32::from(variant.uses_security_capabilities()) + u32::from(variant.uses_handle_list());
        let mut attribute_list = if attribute_count == 0 {
            None
        } else {
            Some(
                ProcThreadAttributeList::create(attribute_count)
                    .map_err(|()| WorkerLaunchFailureStage::AttributeListInit)?,
            )
        };
        if variant.uses_security_capabilities() {
            attribute_list
                .as_mut()
                .ok_or(WorkerLaunchFailureStage::AttributeListInit)?
                .update(
                    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                    (&raw const security_capabilities).cast::<c_void>(),
                    size_of::<SECURITY_CAPABILITIES>(),
                )
                .map_err(|()| WorkerLaunchFailureStage::SecurityCapabilitiesAttribute)?;
        }
        if variant.uses_handle_list() {
            attribute_list
                .as_mut()
                .ok_or(WorkerLaunchFailureStage::AttributeListInit)?
                .update(
                    PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    inherited_handles.as_ptr().cast::<c_void>(),
                    std::mem::size_of_val(inherited_handles),
                )
                .map_err(|()| WorkerLaunchFailureStage::HandleListAttribute)?;
        }

        // SAFETY: zero is the documented initialization for both Win32 structures.
        let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
        startup.StartupInfo.cb = if attribute_list.is_some() {
            size_of::<STARTUPINFOEXW>() as u32
        } else {
            size_of_val(&startup.StartupInfo) as u32
        };
        startup.lpAttributeList = attribute_list
            .as_ref()
            .map_or(null_mut(), |list| list.pointer);
        if let Some([stdin, stdout, stderr]) = stdio {
            if [stdin, stdout, stderr]
                .iter()
                .any(|handle| handle.is_null() || *handle == INVALID_HANDLE_VALUE)
            {
                return Err(WorkerLaunchFailureStage::InputValidation);
            }
            startup.StartupInfo.dwFlags |= STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = stdin;
            startup.StartupInfo.hStdOutput = stdout;
            startup.StartupInfo.hStdError = stderr;
        }
        // SAFETY: zero is the documented initialization and CreateProcessW fills every handle.
        let mut process_information: PROCESS_INFORMATION = unsafe { zeroed() };
        let environment = variant
            .environment()
            .map_err(|()| WorkerLaunchFailureStage::InputValidation)?;
        let environment_pointer = environment
            .as_ref()
            .map_or(null(), |block| block.as_ptr().cast::<c_void>());
        let mut flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;
        if attribute_list.is_some() {
            flags |= EXTENDED_STARTUPINFO_PRESENT;
        }
        // SAFETY: all pointers remain valid through the call, the command line is writable,
        // the production variant explicitly allowlists inherited handles, and test-only variants
        // change one launch boundary at a time without entering a production mode.
        if unsafe {
            CreateProcessW(
                executable_wide.as_ptr(),
                command_line_wide.as_mut_ptr(),
                null(),
                null(),
                i32::from(variant.uses_handle_list()),
                flags,
                environment_pointer,
                current_directory_wide.as_ptr(),
                &startup.StartupInfo,
                &mut process_information,
            )
        } == 0
        {
            // SAFETY: this immediately captures the error from the failed CreateProcessW call.
            let reason = CreateProcessFailureReason::classify(unsafe { GetLastError() });
            return Err(WorkerLaunchFailureStage::CreateProcess(reason));
        }

        let mut worker = WorkerProcess {
            process: process_information.hProcess,
            thread: process_information.hThread,
            assigned_before_resume: false,
            resumed_from_one_suspend: false,
        };
        // SAFETY: both handles are live; the process was created suspended and has not run.
        if unsafe { AssignProcessToJobObject(self.handle, worker.process) } == 0 {
            return Err(WorkerLaunchFailureStage::AssignJob);
        }
        let assigned = self
            .contains_process(worker.process)
            .map_err(|()| WorkerLaunchFailureStage::QueryJobMembership)?;
        if !assigned {
            return Err(WorkerLaunchFailureStage::QueryJobMembership);
        }
        worker.assigned_before_resume = true;
        // The Worker is still suspended, so its handle table holds exactly what CreateProcessW
        // inherited and nothing the Worker could have opened for itself. Proving absence here is
        // therefore race free and keeps the excluded value inside the supervisor.
        if let Some(handle) = excluded_handle {
            match excluded_probe_handle_absence_in_worker(
                worker.process,
                handle as usize as u64,
                handle,
            ) {
                Some(true) => {}
                Some(false) => return Err(WorkerLaunchFailureStage::ExcludedHandleInherited),
                None => return Err(WorkerLaunchFailureStage::ExcludedHandleAmbiguous),
            }
        }
        // SAFETY: thread is the suspended primary thread returned by CreateProcessW.
        let previous_suspend_count = unsafe { ResumeThread(worker.thread) };
        if previous_suspend_count != 1 {
            return Err(WorkerLaunchFailureStage::ResumeThread);
        }
        worker.resumed_from_one_suspend = true;
        Ok(worker)
    }
}

#[cfg(windows)]
impl Drop for JobObject {
    fn drop(&mut self) {
        // SAFETY: the handle is owned by this instance. Termination is the bounded cleanup
        // backstop; CloseHandle also enforces kill-on-close for any remaining member.
        unsafe {
            TerminateJobObject(self.handle, 1);
            CloseHandle(self.handle);
        }
    }
}

#[cfg(windows)]
struct WorkerPipeSet {
    supervisor_stdin: HANDLE,
    supervisor_stdout: HANDLE,
    supervisor_stderr: HANDLE,
    worker_stdin: HANDLE,
    worker_stdout: HANDLE,
    worker_stderr: HANDLE,
    supervisor_control_write: HANDLE,
    worker_control_read: HANDLE,
    supervisor_ready_read: HANDLE,
    worker_ready_write: HANDLE,
    supervisor_capability_read: HANDLE,
    supervisor_capability_write: HANDLE,
    worker_capability_read: HANDLE,
    worker_capability_write: HANDLE,
    supervisor_model_read: HANDLE,
    supervisor_model_write: HANDLE,
    worker_model_read: HANDLE,
    worker_model_write: HANDLE,
}

#[cfg(windows)]
impl WorkerPipeSet {
    fn create() -> Result<Self, ()> {
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        let mut worker_stdin = null_mut();
        let mut supervisor_stdin = null_mut();
        let mut supervisor_stdout = null_mut();
        let mut worker_stdout = null_mut();
        let mut supervisor_stderr = null_mut();
        let mut worker_stderr = null_mut();
        let mut supervisor_control_write = null_mut();
        let mut worker_control_read = null_mut();
        let mut supervisor_ready_read = null_mut();
        let mut worker_ready_write = null_mut();
        let mut supervisor_capability_read = null_mut();
        let mut supervisor_capability_write = null_mut();
        let mut worker_capability_read = null_mut();
        let mut worker_capability_write = null_mut();
        let mut supervisor_model_read = null_mut();
        let mut supervisor_model_write = null_mut();
        let mut worker_model_read = null_mut();
        let mut worker_model_write = null_mut();
        let created = unsafe {
            CreatePipe(
                &mut worker_stdin,
                &mut supervisor_stdin,
                &raw mut attributes,
                0,
            ) != 0
                && CreatePipe(
                    &mut supervisor_stdout,
                    &mut worker_stdout,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut supervisor_stderr,
                    &mut worker_stderr,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut worker_control_read,
                    &mut supervisor_control_write,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut supervisor_ready_read,
                    &mut worker_ready_write,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut worker_capability_read,
                    &mut supervisor_capability_write,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut supervisor_capability_read,
                    &mut worker_capability_write,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut worker_model_read,
                    &mut supervisor_model_write,
                    &raw mut attributes,
                    0,
                ) != 0
                && CreatePipe(
                    &mut supervisor_model_read,
                    &mut worker_model_write,
                    &raw mut attributes,
                    0,
                ) != 0
        };
        if !created {
            for handle in [
                worker_stdin,
                supervisor_stdin,
                supervisor_stdout,
                worker_stdout,
                supervisor_stderr,
                worker_stderr,
                supervisor_control_write,
                worker_control_read,
                supervisor_ready_read,
                worker_ready_write,
                supervisor_capability_read,
                supervisor_capability_write,
                worker_capability_read,
                worker_capability_write,
                supervisor_model_read,
                supervisor_model_write,
                worker_model_read,
                worker_model_write,
            ] {
                if !handle.is_null() {
                    unsafe { CloseHandle(handle) };
                }
            }
            return Err(());
        }
        for handle in [
            supervisor_stdin,
            supervisor_stdout,
            supervisor_stderr,
            supervisor_control_write,
            supervisor_ready_read,
            supervisor_capability_read,
            supervisor_capability_write,
            supervisor_model_read,
            supervisor_model_write,
        ] {
            // SAFETY: each handle is a live parent-side pipe endpoint. Clearing only the inherit
            // bit keeps it private while the child-side endpoints remain explicitly allowlisted.
            if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0) } == 0 {
                for owned in [
                    worker_stdin,
                    supervisor_stdin,
                    supervisor_stdout,
                    worker_stdout,
                    supervisor_stderr,
                    worker_stderr,
                    supervisor_control_write,
                    worker_control_read,
                    supervisor_ready_read,
                    worker_ready_write,
                    supervisor_capability_read,
                    supervisor_capability_write,
                    worker_capability_read,
                    worker_capability_write,
                    supervisor_model_read,
                    supervisor_model_write,
                    worker_model_read,
                    worker_model_write,
                ] {
                    if !owned.is_null() {
                        unsafe { CloseHandle(owned) };
                    }
                }
                return Err(());
            }
        }
        let pipes = Self {
            supervisor_stdin,
            supervisor_stdout,
            supervisor_stderr,
            worker_stdin,
            worker_stdout,
            worker_stderr,
            supervisor_control_write,
            worker_control_read,
            supervisor_ready_read,
            worker_ready_write,
            supervisor_capability_read,
            supervisor_capability_write,
            worker_capability_read,
            worker_capability_write,
            supervisor_model_read,
            supervisor_model_write,
            worker_model_read,
            worker_model_write,
        };
        if !pipes.handle_contract_is_closed() {
            return Err(());
        }
        Ok(pipes)
    }

    fn inherited_handles(&self) -> [HANDLE; 9] {
        [
            self.worker_stdin,
            self.worker_stdout,
            self.worker_stderr,
            self.worker_control_read,
            self.worker_ready_write,
            self.worker_capability_read,
            self.worker_capability_write,
            self.worker_model_read,
            self.worker_model_write,
        ]
    }

    fn parent_handles(&self) -> [HANDLE; 9] {
        [
            self.supervisor_stdin,
            self.supervisor_stdout,
            self.supervisor_stderr,
            self.supervisor_control_write,
            self.supervisor_ready_read,
            self.supervisor_capability_read,
            self.supervisor_capability_write,
            self.supervisor_model_read,
            self.supervisor_model_write,
        ]
    }

    fn handle_contract_is_closed(&self) -> bool {
        fn inheritance_flags(handles: [HANDLE; 9]) -> Option<[bool; 9]> {
            let mut result = [false; 9];
            for (index, handle) in handles.into_iter().enumerate() {
                let mut flags = 0_u32;
                // SAFETY: every handle came from a successful CreatePipe call and remains owned by
                // this pipe set. GetHandleInformation reads only its inheritance flags.
                if unsafe { GetHandleInformation(handle, &mut flags) } == 0 {
                    return None;
                }
                result[index] = flags & HANDLE_FLAG_INHERIT != 0;
            }
            Some(result)
        }

        let worker = self.inherited_handles();
        let parent = self.parent_handles();
        let Some(worker_inheritable) = inheritance_flags(worker) else {
            return false;
        };
        let Some(parent_inheritable) = inheritance_flags(parent) else {
            return false;
        };
        worker_pipe_handle_contract_is_closed(
            worker.map(|handle| handle as usize as u64),
            parent.map(|handle| handle as usize as u64),
            worker_inheritable,
            parent_inheritable,
        )
    }

    fn probe_inherited_handles(&self) -> [HANDLE; 3] {
        [self.worker_stdin, self.worker_stdout, self.worker_stderr]
    }

    fn stdio(&self) -> [HANDLE; 3] {
        [self.worker_stdin, self.worker_stdout, self.worker_stderr]
    }

    fn close_worker_endpoints(&mut self) {
        for handle in [
            &mut self.worker_stdin,
            &mut self.worker_stdout,
            &mut self.worker_stderr,
            &mut self.worker_control_read,
            &mut self.worker_ready_write,
            &mut self.worker_capability_read,
            &mut self.worker_capability_write,
            &mut self.worker_model_read,
            &mut self.worker_model_write,
        ] {
            if !handle.is_null() {
                unsafe { CloseHandle(*handle) };
                *handle = null_mut();
            }
        }
    }

    fn close_supervisor_stdin(&mut self) {
        if !self.supervisor_stdin.is_null() {
            // SAFETY: this endpoint is owned by the pipe set and is closed only once here.
            unsafe { CloseHandle(self.supervisor_stdin) };
            self.supervisor_stdin = null_mut();
        }
    }

    fn take_worker_stdin(&mut self) -> Result<HANDLE, ()> {
        let handle = self.supervisor_stdin;
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(());
        }
        self.supervisor_stdin = null_mut();
        Ok(handle)
    }

    fn take_worker_stdout(&mut self) -> Result<HANDLE, ()> {
        let handle = self.supervisor_stdout;
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(());
        }
        self.supervisor_stdout = null_mut();
        Ok(handle)
    }

    fn take_capability_worker_channel(
        &mut self,
    ) -> Result<crate::windows_bridge::WindowsBridgeChannel, ()> {
        let read = self.supervisor_capability_read;
        let write = self.supervisor_capability_write;
        if read.is_null()
            || read == INVALID_HANDLE_VALUE
            || write.is_null()
            || write == INVALID_HANDLE_VALUE
            || read == write
        {
            return Err(());
        }
        self.supervisor_capability_read = null_mut();
        self.supervisor_capability_write = null_mut();
        crate::windows_bridge::WindowsBridgeChannel::from_raw_handle_pair(read, write)
    }

    fn take_model_worker_channel(
        &mut self,
    ) -> Result<crate::windows_bridge::WindowsBridgeChannel, ()> {
        let read = self.supervisor_model_read;
        let write = self.supervisor_model_write;
        if read.is_null()
            || read == INVALID_HANDLE_VALUE
            || write.is_null()
            || write == INVALID_HANDLE_VALUE
            || read == write
        {
            return Err(());
        }
        self.supervisor_model_read = null_mut();
        self.supervisor_model_write = null_mut();
        crate::windows_bridge::WindowsBridgeChannel::from_raw_handle_pair(read, write)
    }
}

#[cfg(windows)]
impl Drop for WorkerPipeSet {
    fn drop(&mut self) {
        for handle in [
            &mut self.supervisor_stdin,
            &mut self.supervisor_stdout,
            &mut self.supervisor_stderr,
            &mut self.worker_stdin,
            &mut self.worker_stdout,
            &mut self.worker_stderr,
            &mut self.supervisor_control_write,
            &mut self.worker_control_read,
            &mut self.supervisor_ready_read,
            &mut self.worker_ready_write,
            &mut self.supervisor_capability_read,
            &mut self.supervisor_capability_write,
            &mut self.worker_capability_read,
            &mut self.worker_capability_write,
            &mut self.supervisor_model_read,
            &mut self.supervisor_model_write,
            &mut self.worker_model_read,
            &mut self.worker_model_write,
        ] {
            if !handle.is_null() {
                unsafe { CloseHandle(*handle) };
                *handle = null_mut();
            }
        }
    }
}

#[cfg(windows)]
pub(crate) fn launch_windows_containment_worker(
    attempt_id: &str,
    executable: &Path,
    current_directory: &Path,
    child_argument: &str,
    excluded_handle: &ProbeHandle,
) -> Result<WindowsContainmentLaunch, WindowsContainmentFailure> {
    if child_argument != WINDOWS_PROBE_CHILD_ARGUMENT || excluded_handle.handle.is_null() {
        return Err(WindowsContainmentFailure::WorkerLaunch);
    }
    let profile =
        AppContainerProfile::create(attempt_id).map_err(|()| WindowsContainmentFailure::Profile)?;
    let job = JobObject::create().map_err(|()| WindowsContainmentFailure::Job)?;
    let mut pipes = WorkerPipeSet::create().map_err(|()| WindowsContainmentFailure::Pipes)?;
    excluded_handle
        .encoded_value()
        .map_err(|()| WindowsContainmentFailure::WorkerLaunch)?;
    let inherited_handles = pipes.probe_inherited_handles();
    if inherited_handles
        .iter()
        .any(|handle| *handle == excluded_handle.handle)
    {
        return Err(WindowsContainmentFailure::WorkerLaunch);
    }
    let worker = job
        .launch_suspended_worker_with_variant_and_stdio_and_argument(
            &profile,
            executable,
            current_directory,
            &inherited_handles,
            Some(pipes.stdio()),
            WorkerLaunchVariant::Production,
            child_argument,
            Some(excluded_handle.handle),
        )
        .map_err(|stage| match stage {
            WorkerLaunchFailureStage::ExcludedHandleInherited => {
                WindowsContainmentFailure::ExcludedHandleInherited
            }
            WorkerLaunchFailureStage::ExcludedHandleAmbiguous => {
                WindowsContainmentFailure::ExcludedHandleAmbiguous
            }
            _ => WindowsContainmentFailure::WorkerLaunch,
        })?;
    pipes.close_worker_endpoints();
    Ok(WindowsContainmentLaunch {
        profile,
        job,
        worker,
        pipes,
        // Reaching this point is the proof: the launch fails closed unless the supervisor observed
        // ERROR_INVALID_HANDLE for the excluded value in the suspended Worker handle table.
        excluded_handle_absent: true,
    })
}

#[cfg(windows)]
fn write_all_handle(handle: HANDLE, bytes: &[u8]) -> Result<(), ()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let remaining = bytes.len() - offset;
        let write_length = u32::try_from(remaining).map_err(|_| ())?;
        let mut written = 0_u32;
        // SAFETY: handle is owned by the caller and bytes remain alive for the synchronous call.
        if unsafe {
            WriteFile(
                handle,
                bytes[offset..].as_ptr().cast(),
                write_length,
                &mut written,
                null_mut(),
            )
        } == 0
            || written == 0
        {
            return Err(());
        }
        offset += written as usize;
    }
    Ok(())
}

#[cfg(windows)]
fn read_exact_handle(handle: HANDLE, bytes: &mut [u8]) -> Result<(), ()> {
    let mut offset = 0;
    while offset < bytes.len() {
        let remaining = u32::try_from(bytes.len() - offset).map_err(|_| ())?;
        let mut read = 0_u32;
        // SAFETY: handle is owned by the caller and the target is writable for the bounded call.
        if unsafe {
            ReadFile(
                handle,
                bytes[offset..].as_mut_ptr().cast(),
                remaining,
                &mut read,
                null_mut(),
            )
        } == 0
            || read == 0
        {
            return Err(());
        }
        offset += read as usize;
    }
    Ok(())
}

#[cfg(windows)]
fn handle_from_fd(fd: i32) -> Result<HANDLE, ()> {
    if fd < 0 {
        return Err(());
    }
    // SAFETY: _get_osfhandle only reads the CRT descriptor table and returns its owned OS handle.
    let raw = unsafe { libc::get_osfhandle(fd) };
    if raw == -1 {
        return Err(());
    }
    let source = raw as usize as HANDLE;
    if source.is_null() || source == INVALID_HANDLE_VALUE {
        return Err(());
    }
    let mut duplicate = null_mut();
    if unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            source,
            GetCurrentProcess(),
            &mut duplicate,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        )
    } == 0
        || duplicate.is_null()
        || duplicate == INVALID_HANDLE_VALUE
    {
        return Err(());
    }
    Ok(duplicate)
}

#[cfg(windows)]
async fn wait_for_parent_liveness() -> Result<(), ()> {
    let handle = handle_from_fd(4)?;
    let mut channel = crate::windows_bridge::WindowsBridgeChannel::from_raw_handle(handle)?;
    let mut byte = [0_u8; 1];
    match channel.read_once(&mut byte).await? {
        0 => Ok(()),
        _ => Err(()),
    }
}

#[cfg(windows)]
async fn wait_for_worker_exit_handle(handle: HANDLE) -> Result<u32, ()> {
    loop {
        match unsafe { WaitForSingleObject(handle, 0) } {
            WAIT_OBJECT_0 => {
                let mut exit_code = 0_u32;
                if unsafe { GetExitCodeProcess(handle, &mut exit_code) } == 0 {
                    return Err(());
                }
                return Ok(exit_code);
            }
            WAIT_TIMEOUT => {}
            _ => return Err(()),
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

#[cfg(windows)]
fn cleanup_runtime(
    job: &JobObject,
    worker: &WorkerProcess,
    profile: &mut AppContainerProfile,
) -> bool {
    let job_terminated = job.terminate_for_cleanup().is_ok();
    let worker_terminal = worker.wait_for_exit(5_000).is_ok();
    let profile_removed = profile.remove().is_ok();
    job_terminated && worker_terminal && profile_removed
}

#[cfg(windows)]
fn read_windows_probe_child_stage_transcript(handle: HANDLE) -> Result<Vec<u8>, ()> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(());
    }
    let mut transcript = Vec::with_capacity(WINDOWS_PROBE_CHILD_STAGES.len());
    loop {
        let mut marker = 0_u8;
        let mut read = 0_u32;
        // SAFETY: handle is the retained parent-side stderr pipe and marker is writable for one
        // byte. The child has already terminated, so the read either drains one marker or reaches
        // the closed pipe without waiting on an active writer.
        if unsafe { ReadFile(handle, (&raw mut marker).cast(), 1, &mut read, null_mut()) } == 0 {
            // SAFETY: this immediately captures the error from the failed ReadFile call.
            return if unsafe { GetLastError() } == ERROR_BROKEN_PIPE {
                Ok(transcript)
            } else {
                Err(())
            };
        }
        if read != 1 || transcript.len() == WINDOWS_PROBE_CHILD_STAGES.len() {
            return Err(());
        }
        transcript.push(marker);
    }
}

/// Decides the excluded-handle verdict from one parent-side `DuplicateHandle` attempt against the
/// Worker handle table. A successful duplicate proves that the numeric slot is occupied; only an
/// object-identity match proves that the deliberately excluded handle survived into the Worker.
/// An identity mismatch or exact `ERROR_INVALID_HANDLE` proves the excluded object is absent.
/// Every other Win32 error is ambiguous and stays fail closed.
#[cfg(any(windows, test))]
fn excluded_handle_absence_from_duplicate_attempt(
    duplicate_succeeded: bool,
    last_error: u32,
    identity_matched: bool,
) -> Option<bool> {
    match (duplicate_succeeded, last_error, identity_matched) {
        (true, _, true) => Some(false),
        (true, _, false) => Some(true),
        (false, WINDOWS_ERROR_INVALID_HANDLE_CODE, _) => Some(true),
        (false, _, _) => None,
    }
}

/// Queries the Worker handle table from the supervisor. Inherited handles keep their numeric value
/// in the child, so the excluded value is the exact slot to interrogate. The contained Worker never
/// touches the value: an AppContainer process under
/// `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION` is terminated by the raised
/// `STATUS_INVALID_HANDLE` before it can report anything. When `DuplicateHandle` succeeds,
/// `CompareObjectHandles` confirms the duplicate refers to the same kernel object, preventing
/// false-positive failures when an unrelated handle coincidentally occupies that numeric slot.
#[cfg(windows)]
fn excluded_probe_handle_absence_in_worker(
    worker_process: HANDLE,
    excluded_handle_value: u64,
    excluded_handle_original: HANDLE,
) -> Option<bool> {
    if worker_process.is_null() || worker_process == INVALID_HANDLE_VALUE {
        return None;
    }
    let value = usize::try_from(excluded_handle_value).ok()?;
    let source = value as HANDLE;
    if source.is_null() || source == INVALID_HANDLE_VALUE {
        return None;
    }
    if excluded_handle_original.is_null() || excluded_handle_original == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut duplicate: HANDLE = null_mut();
    // SAFETY: worker_process is the live CreateProcessW handle owned by WorkerProcess and carries
    // PROCESS_DUP_HANDLE. source is interpreted only inside the Worker handle table, duplicate is a
    // valid out pointer, and the request is a non-inheritable read of the existing access mask.
    let duplicate_succeeded = unsafe {
        DuplicateHandle(
            worker_process,
            source,
            GetCurrentProcess(),
            &mut duplicate,
            0,
            0,
            DUPLICATE_SAME_ACCESS,
        )
    } != 0;
    let last_error = if duplicate_succeeded {
        0
    } else {
        // SAFETY: this immediately captures the error from the failed DuplicateHandle call.
        unsafe { GetLastError() }
    };
    let identity_matched =
        if duplicate_succeeded && !duplicate.is_null() && duplicate != INVALID_HANDLE_VALUE {
            // SAFETY: both handles are live. CompareObjectHandles compares kernel object identity.
            unsafe { CompareObjectHandles(excluded_handle_original, duplicate) != 0 }
        } else {
            false
        };
    if duplicate_succeeded && !duplicate.is_null() && duplicate != INVALID_HANDLE_VALUE {
        // SAFETY: the duplicate is owned by this process and is not retained beyond the verdict.
        unsafe { CloseHandle(duplicate) };
    }
    excluded_handle_absence_from_duplicate_attempt(
        duplicate_succeeded,
        last_error,
        identity_matched,
    )
}

#[cfg(windows)]
pub(crate) enum WindowsProbeChildRequestFailure {
    Request,
    StageWrite,
}

#[cfg(windows)]
pub(crate) fn read_windows_probe_request(
) -> Result<(WindowsProbeRequest, bool), WindowsProbeChildRequestFailure> {
    // SAFETY: the probe role is launched with one exact inherited standard-input pipe.
    let input = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    if input.is_null() || input == INVALID_HANDLE_VALUE {
        return Err(WindowsProbeChildRequestFailure::Request);
    }
    write_windows_probe_child_stage(WindowsProbeChildStage::InputHandleReady)
        .map_err(|()| WindowsProbeChildRequestFailure::StageWrite)?;
    let mut length_bytes = [0_u8; 4];
    read_exact_handle(input, &mut length_bytes)
        .map_err(|()| WindowsProbeChildRequestFailure::Request)?;
    write_windows_probe_child_stage(WindowsProbeChildStage::RequestLengthRead)
        .map_err(|()| WindowsProbeChildRequestFailure::StageWrite)?;
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length == 0 || length > WINDOWS_PROBE_REQUEST_MAX_FRAME_BYTES {
        return Err(WindowsProbeChildRequestFailure::Request);
    }
    let mut frame = vec![0_u8; length];
    read_exact_handle(input, &mut frame).map_err(|()| WindowsProbeChildRequestFailure::Request)?;
    write_windows_probe_child_stage(WindowsProbeChildStage::RequestFrameRead)
        .map_err(|()| WindowsProbeChildRequestFailure::StageWrite)?;
    // The supervisor already proved absence against this Worker handle table before resuming it.
    // The child only echoes that verdict; it never receives or operates on the excluded value.
    let (request, excluded_handle_absent) =
        decode_request_frame(&frame).map_err(|()| WindowsProbeChildRequestFailure::Request)?;
    write_windows_probe_child_stage(WindowsProbeChildStage::RequestDecoded)
        .map_err(|()| WindowsProbeChildRequestFailure::StageWrite)?;
    Ok((request, excluded_handle_absent))
}

#[cfg(windows)]
pub(crate) fn write_windows_probe_result(result: WindowsProbeResult) -> Result<(), ()> {
    // SAFETY: the probe role is launched with one exact inherited standard-output pipe.
    let output = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    write_all_handle(output, &encode_result(result))
}

#[cfg(windows)]
pub(crate) fn write_windows_probe_child_stage(stage: WindowsProbeChildStage) -> Result<(), ()> {
    // SAFETY: the probe role is launched with one exact inherited standard-error pipe.
    let error = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    write_all_handle(error, &[stage.marker()])
}

#[cfg(windows)]
fn read_control_frame_from_handle(
    handle: HANDLE,
) -> Result<crate::windows_control::WindowsControlMessage, ()> {
    use crate::windows_control::{parse_control_frame, WINDOWS_CONTROL_MAX_BYTES};
    let mut header = [0_u8; 4];
    read_exact_handle(handle, &mut header)?;
    let payload_length = u32::from_le_bytes(header) as usize;
    if payload_length == 0 || payload_length > WINDOWS_CONTROL_MAX_BYTES {
        return Err(());
    }
    let mut frame = Vec::with_capacity(payload_length + 4);
    frame.extend_from_slice(&header);
    frame.resize(payload_length + 4, 0);
    read_exact_handle(handle, &mut frame[4..])?;
    parse_control_frame(&frame)
}

pub(crate) fn run_supervisor() -> i32 {
    #[cfg(windows)]
    {
        let control = match read_control_frame_from_fd(3) {
            Ok(control) => control,
            Err(()) => {
                return report_supervisor_failure(
                    SupervisorFailureStage::ControlFrame,
                    WINDOWS_SETUP_FAILURE_MARKER,
                );
            }
        };
        return launch_controlled_worker(control);
    }
    #[cfg(not(windows))]
    {
        eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
        1
    }
}

pub(crate) fn run_worker() -> i32 {
    run_worker_with_arguments(&[])
}

pub(crate) fn run_worker_with_arguments(_arguments: &[String]) -> i32 {
    #[cfg(windows)]
    {
        let mut startup = WorkerStartupStateMachine::new();
        let (
            control_value,
            ready_value,
            capability_read_value,
            capability_write_value,
            model_read_value,
            model_write_value,
        ) = match crate::windows_control::parse_worker_handle_arguments(_arguments) {
            Ok(Some(values)) => values,
            _ => {
                eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
                return EXIT_CONTROL_FRAME_INVALID;
            }
        };
        let control_handle = control_value as usize as HANDLE;
        let control_result = read_control_frame_from_handle(control_handle);
        unsafe { CloseHandle(control_handle) };
        let control = match control_result {
            Ok(control) => control,
            Err(()) => {
                eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
                return EXIT_CONTROL_FRAME_INVALID;
            }
        };
        if startup
            .advance(WorkerStartupStage::ControlValidated)
            .is_err()
        {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return EXIT_CONTROL_FRAME_INVALID;
        }
        if !verify_worker_boundary() {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return EXIT_BOUNDARY_VERIFICATION_FAILED;
        }
        if startup
            .advance(WorkerStartupStage::BoundaryVerified)
            .is_err()
        {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return EXIT_BOUNDARY_VERIFICATION_FAILED;
        }
        let bridge_runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(_) => {
                eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
                return EXIT_RUNTIME_CREATION_FAILED;
            }
        };
        let ready_handle = ready_value as usize as HANDLE;
        let result = bridge_runtime.block_on(async {
            let capability_channel =
                crate::windows_bridge::WindowsBridgeChannel::from_raw_handle_pair(
                    capability_read_value as usize as HANDLE,
                    capability_write_value as usize as HANDLE,
                )
                .map_err(|_| EXIT_CAPABILITY_BRIDGE_FAILED)?;
            startup
                .advance(WorkerStartupStage::CapabilityConnected)
                .map_err(|_| EXIT_CAPABILITY_BRIDGE_FAILED)?;
            let model_channel = crate::windows_bridge::WindowsBridgeChannel::from_raw_handle_pair(
                model_read_value as usize as HANDLE,
                model_write_value as usize as HANDLE,
            )
            .map_err(|_| EXIT_MODEL_BRIDGE_FAILED)?;
            startup
                .advance(WorkerStartupStage::ModelConnected)
                .map_err(|_| EXIT_MODEL_BRIDGE_FAILED)?;

            let session_id = std::sync::Arc::new(tokio::sync::OnceCell::new());
            let capability_client = WindowsCapabilityClient::new(
                capability_channel,
                control.attempt_lease.clone(),
                session_id.clone(),
            )
            .map_err(|_| EXIT_CAPABILITY_BRIDGE_FAILED)?;
            let model_provider = WindowsModelProvider::new(
                model_channel,
                control.model_attempt_lease.clone(),
                session_id,
                control.model_id.clone(),
            )
            .map_err(|_| EXIT_MODEL_BRIDGE_FAILED)?;
            let (data_dir, config_dir) = prepare_goose_state_directories(&control.private_root)
                .map_err(|_| EXIT_STATE_DIRECTORY_FAILED)?;
            let adapter = goose::acp::server::AcpRuntimeAdapter {
                provider_id: "actestra".to_string(),
                model_config: goose_providers::model::ModelConfig::new(&control.model_id),
                provider: std::sync::Arc::new(model_provider),
                extension_name: "actestra-capability-proxy".to_string(),
                extension_config: goose::agents::ExtensionConfig::Builtin {
                    name: "actestra-capability-proxy".to_string(),
                    description: "Actestra capability proxy".to_string(),
                    display_name: None,
                    timeout: None,
                    bundled: Some(true),
                    available_tools: Vec::new(),
                },
                extension_client: std::sync::Arc::new(capability_client),
                data_dir,
                config_dir,
            };
            startup
                .advance(WorkerStartupStage::AdaptersConstructed)
                .map_err(|_| EXIT_MODEL_BRIDGE_FAILED)?;
            let ready_result = write_all_handle(ready_handle, WINDOWS_WORKER_READY_MARKER);
            unsafe { CloseHandle(ready_handle) };
            if ready_result.is_err() {
                return Err(EXIT_READY_SIGNAL_FAILED);
            }
            startup
                .advance(WorkerStartupStage::ReadyWritten)
                .map_err(|_| EXIT_READY_SIGNAL_FAILED)?;
            startup
                .advance(WorkerStartupStage::AcpServing)
                .map_err(|_| EXIT_ACP_HANDSHAKE_FAILED)?;
            goose::acp::server::run_with_runtime_adapter(adapter)
                .await
                .map_err(|_| EXIT_ACP_HANDSHAKE_FAILED)
        });
        match result {
            Ok(()) => 0,
            Err(code) => {
                eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
                code
            }
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
        1
    }
}

fn prepare_goose_state_directories(
    private_root: &str,
) -> Result<(std::path::PathBuf, std::path::PathBuf), ()> {
    let root = std::path::Path::new(private_root);
    if !root.is_absolute() {
        return Err(());
    }
    let root_metadata = std::fs::symlink_metadata(root).map_err(|_| ())?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(());
    }
    let canonical_root = std::fs::canonicalize(root).map_err(|_| ())?;
    let data_dir = root.join("goose-data");
    let config_dir = root.join("goose-config");
    for directory in [&data_dir, &config_dir] {
        match std::fs::symlink_metadata(directory) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::fs::create_dir(directory).map_err(|_| ())?;
            }
            Err(_) => return Err(()),
        }
        let canonical_directory = std::fs::canonicalize(directory).map_err(|_| ())?;
        if canonical_directory.parent() != Some(canonical_root.as_path()) {
            return Err(());
        }
    }
    Ok((data_dir, config_dir))
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Result<Vec<u16>, ()> {
    let mut value: Vec<u16> = path.as_os_str().encode_wide().collect();
    if value.is_empty() || value.iter().any(|unit| *unit == 0) {
        return Err(());
    }
    value.push(0);
    Ok(value)
}

#[cfg(windows)]
fn exact_sid_trustee(sid: PSID) -> Result<TRUSTEE_W, ()> {
    if sid.is_null() {
        return Err(());
    }
    Ok(TRUSTEE_W {
        pMultipleTrustee: null_mut(),
        MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_USER,
        ptstrName: sid.cast(),
    })
}

#[cfg(windows)]
fn exact_sid_effective_rights(path: &Path, sid: PSID) -> Result<u32, ()> {
    let wide = wide_path(path)?;
    let trustee = exact_sid_trustee(sid)?;
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: wide is a NUL-terminated existing filesystem path. Only the DACL and owning
    // descriptor are requested; descriptor is released with LocalFree below.
    let read_result = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if read_result != ERROR_SUCCESS || descriptor.is_null() || dacl.is_null() {
        if !descriptor.is_null() {
            // SAFETY: descriptor was allocated by GetNamedSecurityInfoW.
            unsafe { LocalFree(descriptor) };
        }
        return Err(());
    }
    let mut rights = 0_u32;
    // SAFETY: dacl remains owned by descriptor for this call and trustee contains the exact live
    // AppContainer SID retained by AppContainerProfile.
    let rights_result = unsafe { GetEffectiveRightsFromAclW(dacl, &trustee, &mut rights) };
    // SAFETY: descriptor was allocated by GetNamedSecurityInfoW and is no longer needed.
    unsafe { LocalFree(descriptor) };
    if rights_result != ERROR_SUCCESS {
        return Err(());
    }
    Ok(rights)
}

#[cfg(windows)]
fn grant_exact_appcontainer_directory_access(
    path: &Path,
    sid: PSID,
    access_mask: u32,
    forbidden_mask: u32,
    inheritance: u32,
) -> Result<(), ()> {
    let wide = wide_path(path)?;
    let trustee = exact_sid_trustee(sid)?;
    let mut current_dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: wide is a NUL-terminated existing directory. descriptor owns current_dacl and is
    // released after SetEntriesInAclW has copied the existing ACL.
    let read_result = unsafe {
        GetNamedSecurityInfoW(
            wide.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut current_dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if read_result != ERROR_SUCCESS || descriptor.is_null() || current_dacl.is_null() {
        if !descriptor.is_null() {
            // SAFETY: descriptor was allocated by GetNamedSecurityInfoW.
            unsafe { LocalFree(descriptor) };
        }
        return Err(());
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: access_mask,
        grfAccessMode: SET_ACCESS,
        grfInheritance: inheritance,
        Trustee: trustee,
    };
    let mut updated_dacl: *mut ACL = null_mut();
    // SAFETY: entry refers to the retained exact SID, current_dacl is valid for descriptor's
    // lifetime, and updated_dacl is an out pointer released with LocalFree.
    let merge_result = unsafe { SetEntriesInAclW(1, &entry, current_dacl, &mut updated_dacl) };
    // SAFETY: descriptor was allocated by GetNamedSecurityInfoW and current_dacl is no longer used.
    unsafe { LocalFree(descriptor) };
    if merge_result != ERROR_SUCCESS || updated_dacl.is_null() {
        if !updated_dacl.is_null() {
            // SAFETY: updated_dacl was allocated by SetEntriesInAclW.
            unsafe { LocalFree(updated_dacl.cast()) };
        }
        return Err(());
    }
    // SAFETY: wide is the same bounded directory path and updated_dacl is a valid ACL containing
    // the exact AppContainer SID entry plus the existing owner/system entries.
    let write_result = unsafe {
        SetNamedSecurityInfoW(
            wide.as_ptr() as *mut u16,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            updated_dacl,
            null_mut(),
        )
    };
    // SAFETY: updated_dacl was allocated by SetEntriesInAclW and is no longer used.
    unsafe { LocalFree(updated_dacl.cast()) };
    if write_result != ERROR_SUCCESS {
        return Err(());
    }
    let effective = exact_sid_effective_rights(path, sid)?;
    if effective & access_mask != access_mask || effective & forbidden_mask != 0 {
        return Err(());
    }
    Ok(())
}

#[cfg(windows)]
fn prepare_appcontainer_goose_state_directories(private_root: &str, sid: PSID) -> Result<(), ()> {
    let root = Path::new(private_root);
    let (data_dir, config_dir) = prepare_goose_state_directories(private_root)?;
    grant_exact_appcontainer_directory_access(
        root,
        sid,
        STATE_ROOT_ACCESS_MASK,
        STATE_ROOT_FORBIDDEN_ACCESS_MASK,
        NO_INHERITANCE,
    )?;
    for directory in [&data_dir, &config_dir] {
        grant_exact_appcontainer_directory_access(
            directory,
            sid,
            STATE_DIRECTORY_ACCESS_MASK,
            STATE_FORBIDDEN_ACCESS_MASK,
            SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        )?;
    }
    Ok(())
}

#[cfg(windows)]
fn verify_worker_boundary() -> bool {
    if std::env::var_os("ACTESTRA_ENVIRONMENT_CANARY").is_some() {
        return false;
    }
    for forbidden in [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "GOOSE_PROVIDER",
        "GOOSE_MODEL",
        "OPENAI_BASE_URL",
        "NO_PROXY",
    ] {
        if std::env::var_os(forbidden).is_some() {
            return false;
        }
    }
    let input = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    let output = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    let error = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    if [input, output, error]
        .iter()
        .any(|handle| handle.is_null() || *handle == INVALID_HANDLE_VALUE)
    {
        return false;
    }
    let mut is_in_job = 0;
    // SAFETY: the current-process pseudo handle is valid and a null Job handle asks whether the
    // process belongs to any Job Object.
    if unsafe { IsProcessInJob(GetCurrentProcess(), null_mut(), &mut is_in_job) } == 0 {
        return false;
    }
    if is_in_job == 0 {
        return false;
    }
    let mut token: HANDLE = null_mut();
    // SAFETY: the current-process pseudo handle is valid and token is an out pointer.
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0
        || token.is_null()
    {
        return false;
    }
    let mut is_app_container = 0_u32;
    let mut return_length = 0_u32;
    // SAFETY: token is live, output storage and information class are exact.
    let queried = unsafe {
        GetTokenInformation(
            token,
            TokenIsAppContainer,
            (&raw mut is_app_container).cast(),
            size_of::<u32>() as u32,
            &mut return_length,
        )
    } != 0;
    // SAFETY: token was opened above and is no longer needed.
    unsafe { CloseHandle(token) };
    queried && is_app_container == 1
}

#[cfg(windows)]
fn launch_controlled_worker(control: crate::windows_control::WindowsControlMessage) -> i32 {
    let mut profile = match AppContainerProfile::create(&control.attempt_id) {
        Ok(profile) => profile,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::Profile.diagnostic_exit_code();
        }
    };
    if prepare_appcontainer_goose_state_directories(&control.private_root, profile.sid()).is_err() {
        return report_supervisor_failure(
            SupervisorFailureStage::WorkerStartup(WorkerStartupFailure::StateDirectory),
            WINDOWS_SETUP_FAILURE_MARKER,
        );
    }
    let bridge_runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            return report_supervisor_failure(
                SupervisorFailureStage::CapabilityChannel,
                WINDOWS_SETUP_FAILURE_MARKER,
            );
        }
    };
    let job = match JobObject::create() {
        Ok(job) => job,
        Err(()) => {
            eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
            return SupervisorFailureStage::Job.diagnostic_exit_code();
        }
    };
    let mut pipes = match WorkerPipeSet::create() {
        Ok(pipes) => pipes,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::Pipes.diagnostic_exit_code();
        }
    };
    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(_) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::CurrentExecutable.diagnostic_exit_code();
        }
    };
    let current_directory = std::path::PathBuf::from(&control.private_root).join("work");
    let inherited_handles = pipes.inherited_handles();
    let worker = match job.launch_suspended_worker_with_stdio(
        &profile,
        &executable,
        &current_directory,
        &inherited_handles,
        pipes.stdio(),
    ) {
        Ok(worker) => worker,
        Err(failure) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::WorkerLaunch(failure).diagnostic_exit_code();
        }
    };
    pipes.close_worker_endpoints();
    let payload = match crate::windows_control::serialize_control_message(&control) {
        Ok(payload) => payload,
        Err(()) => {
            return report_supervisor_failure(
                SupervisorFailureStage::ControlSerialization,
                WINDOWS_SETUP_FAILURE_MARKER,
            );
        }
    };
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&payload);
    if write_all_handle(pipes.supervisor_control_write, &frame).is_err() {
        return report_supervisor_failure(
            SupervisorFailureStage::ControlWrite,
            WINDOWS_SETUP_FAILURE_MARKER,
        );
    }
    unsafe { CloseHandle(pipes.supervisor_control_write) };
    pipes.supervisor_control_write = null_mut();
    let capability_worker = match pipes.take_capability_worker_channel() {
        Ok(channel) => channel,
        Err(()) => {
            return report_supervisor_failure(
                SupervisorFailureStage::CapabilityChannel,
                WINDOWS_SETUP_FAILURE_MARKER,
            );
        }
    };
    let model_worker = match pipes.take_model_worker_channel() {
        Ok(channel) => channel,
        Err(()) => {
            return report_supervisor_failure(
                SupervisorFailureStage::ModelChannel,
                WINDOWS_SETUP_FAILURE_MARKER,
            );
        }
    };
    // The Worker receives only the four explicitly allowlisted anonymous-pipe endpoints and writes
    // ready after constructing both framed clients. No namespace lookup or additional authority is
    // required across the AppContainer boundary.
    let mut marker = vec![0_u8; WINDOWS_WORKER_READY_MARKER.len()];
    let worker_ready = read_exact_handle(pipes.supervisor_ready_read, &mut marker).is_ok()
        && marker == WINDOWS_WORKER_READY_MARKER;
    if !worker_ready {
        let mut exit_code = 0_u32;
        let worker_exited =
            unsafe { GetExitCodeProcess(worker.process, &mut exit_code) } != 0 && exit_code != 259; // STILL_ACTIVE
        if worker_exited {
            let failure = classify_worker_startup_exit(exit_code);
            return report_supervisor_failure(
                SupervisorFailureStage::WorkerStartup(failure),
                WINDOWS_SETUP_FAILURE_MARKER,
            );
        }
        return report_supervisor_failure(
            SupervisorFailureStage::WorkerReady,
            WINDOWS_SETUP_FAILURE_MARKER,
        );
    }
    let worker_stdin = match pipes.take_worker_stdin() {
        Ok(handle) => handle,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::Pipes.diagnostic_exit_code();
        }
    };
    let worker_stdout = match pipes.take_worker_stdout() {
        Ok(handle) => handle,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::Pipes.diagnostic_exit_code();
        }
    };
    let acp_input =
        handle_from_fd(0).and_then(crate::windows_bridge::WindowsBridgeChannel::from_raw_handle);
    let acp_output =
        handle_from_fd(1).and_then(crate::windows_bridge::WindowsBridgeChannel::from_raw_handle);
    let capability_main =
        handle_from_fd(5).and_then(crate::windows_bridge::WindowsBridgeChannel::from_raw_handle);
    let model_main =
        handle_from_fd(6).and_then(crate::windows_bridge::WindowsBridgeChannel::from_raw_handle);
    let worker_stdin = crate::windows_bridge::WindowsBridgeChannel::from_raw_handle(worker_stdin);
    let worker_stdout = crate::windows_bridge::WindowsBridgeChannel::from_raw_handle(worker_stdout);
    let (acp_input, acp_output, capability_main, model_main, worker_stdin, worker_stdout) = match (
        acp_input,
        acp_output,
        capability_main,
        model_main,
        worker_stdin,
        worker_stdout,
    ) {
        (Ok(a), Ok(b), Ok(c), Ok(d), Ok(e), Ok(f)) => (a, b, c, d, e, f),
        _ => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return SupervisorFailureStage::Pipes.diagnostic_exit_code();
        }
    };
    let worker_process_handle = worker.process_handle();
    let runtime_timeout_ms = control.resource_budget.max_active_duration_ms;
    let relay_result = bridge_runtime.block_on(async move {
        let acp_in = acp_input.copy_to(worker_stdin);
        let acp_out = worker_stdout.copy_to(acp_output);
        let capability = capability_main.relay_framed_bidirectional(capability_worker);
        let model = model_main.relay_framed_bidirectional(model_worker);
        tokio::select! {
            result = wait_for_parent_liveness() => {
                classify_runtime_event(WindowsRuntimeEvent::ParentLiveness(result))
            },
            result = wait_for_worker_exit_handle(worker_process_handle) => {
                classify_runtime_event(WindowsRuntimeEvent::WorkerExit(result))
            },
            _ = tokio::time::sleep(std::time::Duration::from_millis(runtime_timeout_ms)) => {
                classify_runtime_event(WindowsRuntimeEvent::Timeout)
            },
            result = acp_in => classify_runtime_event(WindowsRuntimeEvent::AcpRelay(result)),
            result = acp_out => classify_runtime_event(WindowsRuntimeEvent::AcpRelay(result)),
            result = capability => {
                classify_runtime_event(WindowsRuntimeEvent::CapabilityRelay(result))
            },
            result = model => classify_runtime_event(WindowsRuntimeEvent::ModelRelay(result)),
        }
    });
    let cleanup_complete = cleanup_runtime(&job, &worker, &mut profile);
    let diagnostic_codes = runtime_diagnostic_codes(relay_result, cleanup_complete);
    drop((worker, pipes, profile, bridge_runtime));
    for code in diagnostic_codes.into_iter().flatten() {
        if WINDOWS_RUNTIME_FAILURE_CODES.contains(&code) {
            eprintln!("Goose windows containment failed at bounded stage {code}");
        }
    }
    if diagnostic_codes == [None, None] {
        0
    } else {
        1
    }
}

#[cfg(windows)]
fn read_control_frame_from_fd(
    fd: i32,
) -> Result<crate::windows_control::WindowsControlMessage, ()> {
    use crate::windows_control::{parse_control_frame, WINDOWS_CONTROL_MAX_BYTES};

    fn read_exact_fd(fd: i32, target: &mut [u8]) -> Result<(), ()> {
        let mut offset = 0;
        while offset < target.len() {
            // SAFETY: target points to writable memory for the requested bounded byte count.
            let result = unsafe {
                libc::read(
                    fd,
                    target[offset..].as_mut_ptr().cast(),
                    (target.len() - offset) as u32,
                )
            };
            if result <= 0 {
                return Err(());
            }
            offset += result as usize;
        }
        Ok(())
    }

    let mut header = [0_u8; 4];
    read_exact_fd(fd, &mut header)?;
    let payload_length = u32::from_le_bytes(header) as usize;
    if payload_length == 0 || payload_length > WINDOWS_CONTROL_MAX_BYTES {
        return Err(());
    }
    let mut frame = Vec::with_capacity(payload_length + 4);
    frame.extend_from_slice(&header);
    frame.resize(payload_length + 4, 0);
    read_exact_fd(fd, &mut frame[4..])?;
    let mut trailing = [0_u8; 1];
    // A one-shot contract must be closed by Main; accepting a second frame would permit replay.
    // SAFETY: trailing points to writable memory for one byte.
    let result = unsafe { libc::read(fd, trailing.as_mut_ptr().cast(), 1) };
    if result != 0 {
        return Err(());
    }
    parse_control_frame(&frame)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorkerStartupStage {
    ControlValidated,
    BoundaryVerified,
    CapabilityConnected,
    ModelConnected,
    AdaptersConstructed,
    ReadyWritten,
    AcpServing,
}

const WORKER_STARTUP_ORDER: [WorkerStartupStage; 7] = [
    WorkerStartupStage::ControlValidated,
    WorkerStartupStage::BoundaryVerified,
    WorkerStartupStage::CapabilityConnected,
    WorkerStartupStage::ModelConnected,
    WorkerStartupStage::AdaptersConstructed,
    WorkerStartupStage::ReadyWritten,
    WorkerStartupStage::AcpServing,
];

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct WorkerStartupStateMachine {
    observed: Vec<WorkerStartupStage>,
}

impl WorkerStartupStateMachine {
    pub(crate) fn new() -> Self {
        Self {
            observed: Vec::new(),
        }
    }

    pub(crate) fn advance(&mut self, stage: WorkerStartupStage) -> Result<(), ()> {
        if WORKER_STARTUP_ORDER.get(self.observed.len()).copied() != Some(stage) {
            return Err(());
        }
        self.observed.push(stage);
        Ok(())
    }

    pub(crate) fn observed(&self) -> &[WorkerStartupStage] {
        &self.observed
    }
}

#[cfg(test)]
fn simulate_worker_startup(
    fail_at: Option<WorkerStartupStage>,
) -> Result<Vec<WorkerStartupStage>, WorkerStartupStage> {
    let mut state = WorkerStartupStateMachine::new();
    for stage in WORKER_STARTUP_ORDER {
        state.advance(stage).expect("the startup order is valid");
        if fail_at == Some(stage) {
            return Err(stage);
        }
    }
    Ok(state.observed().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_exactly_nine_unique_inheritable_worker_handles_and_private_parent_ends() {
        let worker = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        let parent = [10, 11, 12, 13, 14, 15, 16, 17, 18];
        assert!(worker_pipe_handle_contract_is_closed(
            worker, parent, [true; 9], [false; 9]
        ));

        let mut duplicate_worker = worker;
        duplicate_worker[8] = duplicate_worker[0];
        assert!(!worker_pipe_handle_contract_is_closed(
            duplicate_worker,
            parent,
            [true; 9],
            [false; 9]
        ));

        let mut colliding_parent = parent;
        colliding_parent[5] = worker[5];
        assert!(!worker_pipe_handle_contract_is_closed(
            worker,
            colliding_parent,
            [true; 9],
            [false; 9]
        ));

        let mut non_inheritable_worker = [true; 9];
        non_inheritable_worker[5] = false;
        assert!(!worker_pipe_handle_contract_is_closed(
            worker,
            parent,
            non_inheritable_worker,
            [false; 9]
        ));

        let mut inheritable_parent = [false; 9];
        inheritable_parent[7] = true;
        assert!(!worker_pipe_handle_contract_is_closed(
            worker,
            parent,
            [true; 9],
            inheritable_parent
        ));
    }

    #[test]
    fn cleanup_receipt_requires_every_observable_cleanup_stage() {
        let mut receipt = WindowsCleanupReceipt {
            worker_terminal: true,
            profile_removed: true,
            private_root_removed: true,
        };
        assert!(receipt.complete());
        receipt.profile_removed = false;
        assert!(!receipt.complete());
    }

    #[test]
    fn creates_only_private_goose_state_directories() {
        let root = test_private_root("directories");
        let (data_dir, config_dir) = prepare_goose_state_directories(root.to_str().unwrap())
            .expect("private Goose directories should be created");
        assert_eq!(data_dir.parent(), Some(root.as_path()));
        assert_eq!(config_dir.parent(), Some(root.as_path()));
        assert!(data_dir.is_dir());
        assert!(config_dir.is_dir());

        std::fs::remove_dir_all(&data_dir).unwrap();
        std::fs::create_dir(&data_dir).unwrap();
        assert!(prepare_goose_state_directories(root.to_str().unwrap()).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_private_goose_state_directories() {
        let root = test_private_root("symlink");
        let outside = test_private_root("outside");
        std::os::unix::fs::symlink(&outside, root.join("goose-data")).unwrap();
        assert!(prepare_goose_state_directories(root.to_str().unwrap()).is_err());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(outside).unwrap();
    }

    fn test_private_root(label: &str) -> std::path::PathBuf {
        let unique = format!(
            "actestra-goose-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        std::fs::create_dir(&root).unwrap();
        root
    }

    #[test]
    fn windows_worker_runtime_startup_order_is_fixed() {
        assert_eq!(
            simulate_worker_startup(None).unwrap(),
            vec![
                WorkerStartupStage::ControlValidated,
                WorkerStartupStage::BoundaryVerified,
                WorkerStartupStage::CapabilityConnected,
                WorkerStartupStage::ModelConnected,
                WorkerStartupStage::AdaptersConstructed,
                WorkerStartupStage::ReadyWritten,
                WorkerStartupStage::AcpServing,
            ]
        );
    }

    #[test]
    fn windows_worker_runtime_startup_failure_stops_before_later_stages() {
        let expected = [
            WorkerStartupStage::ControlValidated,
            WorkerStartupStage::BoundaryVerified,
            WorkerStartupStage::CapabilityConnected,
            WorkerStartupStage::ModelConnected,
            WorkerStartupStage::AdaptersConstructed,
            WorkerStartupStage::ReadyWritten,
            WorkerStartupStage::AcpServing,
        ];

        for (index, stage) in expected.into_iter().enumerate() {
            let error = simulate_worker_startup(Some(stage)).unwrap_err();
            assert_eq!(error, stage);
            let mut state = WorkerStartupStateMachine::new();
            for expected_stage in expected.into_iter().take(index + 1) {
                state.advance(expected_stage).unwrap();
            }
            assert_eq!(state.observed(), &expected[..index + 1]);
        }
    }

    #[test]
    fn windows_worker_runtime_startup_state_machine_rejects_skips_and_replays() {
        let mut state = WorkerStartupStateMachine::new();
        assert!(state.advance(WorkerStartupStage::BoundaryVerified).is_err());
        assert!(state.advance(WorkerStartupStage::ControlValidated).is_ok());
        assert!(state.advance(WorkerStartupStage::ControlValidated).is_err());
        assert!(state.advance(WorkerStartupStage::BoundaryVerified).is_ok());
    }

    #[tokio::test]
    async fn windows_worker_runtime_initializes_an_mcp_free_adapted_acp_session() {
        use crate::windows_capability_bridge::{
            decode_capability_frame, encode_capability_frame, CapabilityFrame,
            WindowsCapabilityClient,
        };
        use crate::windows_model_bridge::WindowsModelProvider;
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

        const LEASE: &str = "lease_0123456789abcdef0123456789abcdef";
        const MODEL: &str = "actestra-fixed-model";
        const TOOLS: [&str; 6] = [
            "actestra.coding.file.read-text",
            "actestra.coding.file.write-text",
            "actestra.coding.terminal.run",
            "actestra.coding.git.inspect",
            "actestra.coding.diff.inspect",
            "actestra.coding.test.run",
        ];

        let root = test_private_root("acp-runtime");
        let workspace = root.join("work");
        std::fs::create_dir(&workspace).unwrap();
        let (data_dir, config_dir) =
            prepare_goose_state_directories(root.to_str().unwrap()).unwrap();
        let session_id = std::sync::Arc::new(tokio::sync::OnceCell::new());
        let (capability_worker, capability_main) = tokio::io::duplex(64 * 1024);
        let capability_client = WindowsCapabilityClient::new(
            crate::windows_bridge::WindowsBridgeChannel::from_duplex(capability_worker),
            LEASE.to_string(),
            session_id.clone(),
        )
        .unwrap();
        let (model_worker, _model_main) = tokio::io::duplex(64 * 1024);
        let model_provider = WindowsModelProvider::new(
            crate::windows_bridge::WindowsBridgeChannel::from_duplex(model_worker),
            LEASE.to_string(),
            session_id.clone(),
            MODEL.to_string(),
        )
        .unwrap();
        let adapter = goose::acp::server::AcpRuntimeAdapter {
            provider_id: "actestra".to_string(),
            model_config: goose_providers::model::ModelConfig::new(MODEL),
            provider: std::sync::Arc::new(model_provider),
            extension_name: "actestra-capability-proxy".to_string(),
            extension_config: goose::agents::ExtensionConfig::Builtin {
                name: "actestra-capability-proxy".to_string(),
                description: "Actestra capability proxy".to_string(),
                display_name: None,
                timeout: None,
                bundled: Some(true),
                available_tools: Vec::new(),
            },
            extension_client: std::sync::Arc::new(capability_client),
            data_dir: data_dir.clone(),
            config_dir: config_dir.clone(),
        };
        let server = goose::acp::server_factory::AcpServer::new_with_runtime_adapter(
            goose::acp::server_factory::AcpServerFactoryConfig {
                builtins: Vec::new(),
                data_dir,
                config_dir,
                goose_platform: goose::agents::GoosePlatform::GooseCli,
                additional_source_roots: Vec::new(),
                enable_scheduler: false,
            },
            adapter,
        );
        let agent = server.create_agent().await.unwrap();
        let (server_stream, client_stream) = tokio::io::duplex(256 * 1024);
        let (server_read, server_write) = tokio::io::split(server_stream);
        let serve_task = tokio::spawn(goose::acp::server::serve(
            agent,
            server_read.compat(),
            server_write.compat_write(),
        ));
        let (client_read, mut client_write) = tokio::io::split(client_stream);
        let mut client_read = tokio::io::BufReader::new(client_read);

        async fn send(
            writer: &mut tokio::io::WriteHalf<tokio::io::DuplexStream>,
            value: serde_json::Value,
        ) {
            let mut line = serde_json::to_vec(&value).unwrap();
            line.push(b'\n');
            writer.write_all(&line).await.unwrap();
        }

        async fn response(
            reader: &mut tokio::io::BufReader<tokio::io::ReadHalf<tokio::io::DuplexStream>>,
            expected_id: &str,
        ) -> serde_json::Value {
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                assert!(!line.is_empty(), "ACP transport closed before the response");
                let message: serde_json::Value = serde_json::from_str(&line).unwrap();
                if message.get("id").and_then(serde_json::Value::as_str) == Some(expected_id) {
                    return message;
                }
            }
        }

        send(
            &mut client_write,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": "initialize-1",
                "method": "initialize",
                "params": {
                    "protocolVersion": 1,
                    "clientCapabilities": {},
                    "clientInfo": {"name": "actestra-test", "version": "1"}
                }
            }),
        )
        .await;
        let initialized = response(&mut client_read, "initialize-1").await;
        assert_eq!(initialized["result"]["agentInfo"]["name"], "goose");

        send(
            &mut client_write,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": "session-1",
                "method": "session/new",
                "params": {"cwd": workspace, "mcpServers": []}
            }),
        )
        .await;
        let opened = response(&mut client_read, "session-1").await;
        let acp_session = opened["result"]["sessionId"]
            .as_str()
            .expect("adapted session id")
            .to_string();
        assert!(session_id.get().is_none());

        let capability_task = tokio::spawn(async move {
            let mut main =
                crate::windows_bridge::WindowsBridgeChannel::from_duplex(capability_main);
            let request =
                decode_capability_frame(&main.read_frame().await.unwrap(), LEASE, &acp_session)
                    .unwrap();
            let CapabilityFrame::ListRequest { request_id, .. } = request else {
                panic!("expected injected extension list request");
            };
            let tools = TOOLS
                .iter()
                .map(|name| serde_json::json!({"inputSchema": {}, "name": name}))
                .collect();
            main.write_frame(
                &encode_capability_frame(&CapabilityFrame::ListResponse { request_id, tools })
                    .unwrap(),
            )
            .await
            .unwrap();
            acp_session
        });
        send(
            &mut client_write,
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": "tools-1",
                "method": "_goose/unstable/tools/list",
                "params": {
                    "sessionId": opened["result"]["sessionId"],
                    "extensionName": "actestra-capability-proxy"
                }
            }),
        )
        .await;
        let discovered = response(&mut client_read, "tools-1").await;
        let names = discovered["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), TOOLS.len());
        assert!(names
            .iter()
            .all(|name| name.starts_with("actestra-capability-proxy__actestra.coding.")));
        let bound_session = capability_task.await.unwrap();
        assert_eq!(session_id.get(), Some(&bound_session));

        drop(client_write);
        serve_task.abort();
        let _ = serve_task.await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn production_variant_inherits_supervisor_environment() {
        // A None environment makes CreateProcessW receive nullptr, so the Worker inherits
        // the supervisor environment that Main already reduced to its closed whitelist.
        // A hand-built sparse block fails AppContainer initialization with
        // ERROR_ENVVAR_NOT_FOUND instead.
        assert_eq!(WorkerLaunchVariant::Production.environment(), Ok(None));
    }

    #[test]
    fn rejects_non_exact_attempt_identifiers() {
        for value in [
            "",
            "0123456789abcdef",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdeg",
            "0123456789abcdef0123456789abcdef0",
        ] {
            assert!(!is_exact_attempt_id(value));
        }
    }

    #[test]
    fn builds_a_fixed_worker_command_line_with_a_real_program_slot() {
        let command_line = build_worker_command_line();
        let expected: Vec<u16> = "actestra-goose-runner.exe --actestra-windows-worker-v1\0"
            .encode_utf16()
            .collect();

        assert_eq!(command_line, expected);
    }

    #[test]
    fn builds_only_the_double_nul_terminated_system_root_environment_entry() {
        let windows_directory: Vec<u16> = r"C:\Windows".encode_utf16().collect();
        let environment = build_minimal_windows_environment_block(&windows_directory)
            .expect("one trusted Windows directory must produce an environment block");
        let expected: Vec<u16> = "SystemRoot=C:\\Windows\0\0".encode_utf16().collect();

        assert_eq!(environment, expected);
        assert!(build_minimal_windows_environment_block(&[]).is_err());
        assert!(build_minimal_windows_environment_block(&[b'C' as u16, 0]).is_err());
    }

    #[test]
    fn builds_exact_diagnostic_environment_variants_from_one_trusted_directory() {
        let windows_directory: Vec<u16> = r"C:\Windows".encode_utf16().collect();
        let system_root_windir = build_diagnostic_windows_environment_block(
            &windows_directory,
            DiagnosticEnvironmentKind::SystemRootWindir,
        )
        .expect("the two-entry diagnostic environment must be bounded and valid");
        let expected_system_root_windir: Vec<u16> =
            "SystemRoot=C:\\Windows\0WINDIR=C:\\Windows\0\0"
                .encode_utf16()
                .collect();
        assert_eq!(system_root_windir, expected_system_root_windir);

        let with_comspec = build_diagnostic_windows_environment_block(
            &windows_directory,
            DiagnosticEnvironmentKind::SystemRootWindirComSpec,
        )
        .expect("the three-entry diagnostic environment must be bounded and valid");
        let expected_with_comspec: Vec<u16> = concat!(
            "ComSpec=C:\\Windows\\System32\\cmd.exe\0",
            "SystemRoot=C:\\Windows\0",
            "WINDIR=C:\\Windows\0\0"
        )
        .encode_utf16()
        .collect();
        assert_eq!(with_comspec, expected_with_comspec);
    }

    #[test]
    fn keeps_both_windows_modes_fail_closed_until_native_setup_exists() {
        assert_eq!(run_supervisor(), 1);
        assert_eq!(run_worker(), 1);
    }

    #[test]
    fn keeps_worker_launch_failure_stages_closed_and_sanitized() {
        let stages = [
            WorkerLaunchFailureStage::InputValidation,
            WorkerLaunchFailureStage::AttributeListInit,
            WorkerLaunchFailureStage::SecurityCapabilitiesAttribute,
            WorkerLaunchFailureStage::HandleListAttribute,
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::Other(u32::MAX)),
            WorkerLaunchFailureStage::AssignJob,
            WorkerLaunchFailureStage::QueryJobMembership,
            WorkerLaunchFailureStage::ExcludedHandleInherited,
            WorkerLaunchFailureStage::ExcludedHandleAmbiguous,
            WorkerLaunchFailureStage::ResumeThread,
        ];
        assert_eq!(
            stages.map(WorkerLaunchFailureStage::code),
            [
                "input-validation",
                "attribute-list-init",
                "security-capabilities-attribute",
                "handle-list-attribute",
                "create-process",
                "assign-job",
                "query-job-membership",
                "excluded-handle-inherited",
                "excluded-handle-ambiguous",
                "resume-thread",
            ]
        );
        assert_eq!(
            stages.map(WorkerLaunchFailureStage::reason_code),
            ["none", "none", "none", "none", "other", "none", "none", "none", "none", "none",]
        );
        assert_eq!(
            stages.map(WorkerLaunchFailureStage::unclassified_win32_code),
            [
                None,
                None,
                None,
                None,
                Some(u32::MAX),
                None,
                None,
                None,
                None,
                None,
            ]
        );
        let mut exit_codes = stages
            .map(WorkerLaunchFailureStage::diagnostic_exit_code)
            .to_vec();
        let total = exit_codes.len();
        exit_codes.sort_unstable();
        exit_codes.dedup();
        assert_eq!(exit_codes.len(), total);
        for code in stages.map(WorkerLaunchFailureStage::code) {
            assert!(code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
        }
    }

    #[test]
    fn keeps_runtime_failure_codes_closed_and_sanitized() {
        assert_eq!(WINDOWS_RUNTIME_FAILURE_CODES.len(), 18);
        let mut unique = WINDOWS_RUNTIME_FAILURE_CODES.to_vec();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), WINDOWS_RUNTIME_FAILURE_CODES.len());
        for code in WINDOWS_RUNTIME_FAILURE_CODES {
            assert!(code.starts_with("windows-"));
            assert!(code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
            assert!(!code.contains(['/', '\\', ' ', ':']));
        }
    }

    #[test]
    fn maps_each_worker_startup_exit_code_to_a_distinct_closed_runtime_code() {
        let expected = [
            (
                EXIT_CONTROL_FRAME_INVALID,
                "windows-worker-control-frame-invalid",
            ),
            (
                EXIT_BOUNDARY_VERIFICATION_FAILED,
                "windows-worker-boundary-verification-failed",
            ),
            (
                EXIT_RUNTIME_CREATION_FAILED,
                "windows-worker-runtime-creation-failed",
            ),
            (
                EXIT_CAPABILITY_BRIDGE_FAILED,
                "windows-worker-capability-bridge-failed",
            ),
            (
                EXIT_MODEL_BRIDGE_FAILED,
                "windows-worker-model-bridge-failed",
            ),
            (
                EXIT_STATE_DIRECTORY_FAILED,
                "windows-worker-state-directory-failed",
            ),
            (
                EXIT_READY_SIGNAL_FAILED,
                "windows-worker-ready-signal-failed",
            ),
            (
                EXIT_ACP_HANDSHAKE_FAILED,
                "windows-worker-acp-handshake-failed",
            ),
        ];

        let mut diagnostics = Vec::new();
        for (exit_code, runtime_code) in expected {
            let failure = classify_worker_startup_exit(exit_code as u32);
            assert_eq!(failure.runtime_code(), runtime_code);
            assert!(WINDOWS_RUNTIME_FAILURE_CODES.contains(&runtime_code));
            assert_eq!(
                runtime_code_for_supervisor_failure(SupervisorFailureStage::WorkerStartup(failure)),
                Some(runtime_code)
            );
            assert_eq!(
                runtime_diagnostic_codes(
                    classify_runtime_event(WindowsRuntimeEvent::WorkerExit(Ok(exit_code as u32))),
                    true
                ),
                [Some(runtime_code), None]
            );
            diagnostics.push(failure.diagnostic_exit_code());
        }

        diagnostics.sort_unstable();
        diagnostics.dedup();
        assert_eq!(diagnostics.len(), expected.len());

        let unknown = classify_worker_startup_exit(1);
        assert_eq!(unknown.runtime_code(), "windows-worker-runtime-failed");
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::WorkerExit(Ok(0))),
            Ok(())
        );
    }

    #[test]
    fn keeps_the_synthetic_anonymous_pipe_child_protocol_separate_from_production_worker_exits() {
        let expected = [
            (201, "test-child-runtime-failed"),
            (202, "test-child-channel-invalid"),
            (203, "test-child-frame-encode-failed"),
            (204, "test-child-frame-write-failed"),
            (205, "test-child-frame-read-failed"),
            (206, "test-child-frame-mismatch"),
        ];

        for (exit_code, code) in expected {
            let failure = classify_anonymous_pipe_test_child_exit(exit_code);
            assert_eq!(failure.code(), code);
            assert_eq!(failure.exit_code(), exit_code as i32);
            assert!(!(101..=116).contains(&exit_code));
            assert!(code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
        }
        assert_eq!(
            classify_anonymous_pipe_test_child_exit(101).code(),
            "test-child-panic"
        );
        assert_eq!(
            classify_anonymous_pipe_test_child_exit(u32::MAX).code(),
            "test-child-unexpected-exit"
        );
        assert_eq!(
            classify_anonymous_pipe_test_child_exit(202).code(),
            "test-child-channel-invalid"
        );

        let closed_parent_stages = [
            "test-supervisor-frame-read-failed",
            "test-supervisor-frame-mismatch",
            "test-supervisor-frame-write-failed",
            "test-child-wait-failed",
        ];
        for stage in closed_parent_stages {
            assert!(stage.starts_with("test-"));
            assert!(stage
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
            assert!(!stage.contains(['/', '\\', ' ', ':']));
        }
    }

    #[test]
    fn maps_runtime_setup_failures_to_reachable_closed_diagnostics() {
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::ControlFrame),
            Some("windows-control-channel-invalid")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::ControlSerialization),
            Some("windows-control-channel-invalid")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::ControlWrite),
            Some("windows-control-channel-invalid")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::WorkerReady),
            Some("windows-ready-channel-invalid")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::CapabilityChannel),
            Some("windows-capability-channel-invalid")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::ModelChannel),
            Some("windows-model-channel-invalid")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::WorkerRuntime),
            Some("windows-worker-runtime-failed")
        );
        assert_eq!(
            runtime_code_for_supervisor_failure(SupervisorFailureStage::Job),
            None
        );
    }

    #[test]
    fn classifies_runtime_completion_without_misreporting_orderly_shutdown() {
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::ParentLiveness(Ok(()))),
            Ok(())
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::ParentLiveness(Err(()))),
            Err("windows-worker-runtime-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::WorkerExit(Ok(0))),
            Ok(())
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::WorkerExit(Ok(1))),
            Err("windows-worker-runtime-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::WorkerExit(Err(()))),
            Err("windows-worker-runtime-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::Timeout),
            Err("windows-runtime-timeout")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::AcpRelay(Err(()))),
            Err("windows-acp-relay-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::AcpRelay(Ok(()))),
            Err("windows-acp-relay-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::CapabilityRelay(Err(()))),
            Err("windows-capability-relay-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::CapabilityRelay(Ok(()))),
            Err("windows-capability-relay-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::ModelRelay(Err(()))),
            Err("windows-model-relay-failed")
        );
        assert_eq!(
            classify_runtime_event(WindowsRuntimeEvent::ModelRelay(Ok(()))),
            Err("windows-model-relay-failed")
        );
    }

    #[test]
    fn retains_primary_runtime_failure_and_reports_cleanup_separately() {
        assert_eq!(
            runtime_diagnostic_codes(Err("windows-model-relay-failed"), false),
            [
                Some("windows-model-relay-failed"),
                Some("windows-runtime-cleanup-failed")
            ]
        );
        assert_eq!(
            runtime_diagnostic_codes(Ok(()), false),
            [None, Some("windows-runtime-cleanup-failed")]
        );
        assert_eq!(runtime_diagnostic_codes(Ok(()), true), [None, None]);
        assert_eq!(
            runtime_diagnostic_codes(Err("untrusted runtime detail"), true),
            [Some("windows-worker-runtime-failed"), None]
        );
    }

    #[test]
    fn classifies_create_process_failures_without_raw_error_output() {
        let classifications = [
            (2, CreateProcessFailureReason::FileNotFound),
            (3, CreateProcessFailureReason::PathNotFound),
            (5, CreateProcessFailureReason::AccessDenied),
            (6, CreateProcessFailureReason::InvalidHandle),
            (10, CreateProcessFailureReason::BadEnvironment),
            (50, CreateProcessFailureReason::NotSupported),
            (87, CreateProcessFailureReason::InvalidParameter),
            (203, CreateProcessFailureReason::EnvironmentVariableNotFound),
            (740, CreateProcessFailureReason::ElevationRequired),
            (1314, CreateProcessFailureReason::PrivilegeNotHeld),
            (u32::MAX, CreateProcessFailureReason::Other(u32::MAX)),
        ];
        for (win32_code, expected) in classifications {
            let reason = CreateProcessFailureReason::classify(win32_code);
            assert_eq!(reason, expected);
            assert!(reason
                .code()
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
        }
    }

    #[test]
    fn maps_worker_launch_failures_to_closed_supervisor_exit_codes() {
        let failures = [
            WorkerLaunchFailureStage::InputValidation,
            WorkerLaunchFailureStage::AttributeListInit,
            WorkerLaunchFailureStage::SecurityCapabilitiesAttribute,
            WorkerLaunchFailureStage::HandleListAttribute,
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::FileNotFound),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::PathNotFound),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::AccessDenied),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::InvalidHandle),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::BadEnvironment),
            WorkerLaunchFailureStage::CreateProcess(
                CreateProcessFailureReason::EnvironmentVariableNotFound,
            ),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::NotSupported),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::InvalidParameter),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::ElevationRequired),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::PrivilegeNotHeld),
            WorkerLaunchFailureStage::CreateProcess(CreateProcessFailureReason::Other(u32::MAX)),
            WorkerLaunchFailureStage::AssignJob,
            WorkerLaunchFailureStage::QueryJobMembership,
            WorkerLaunchFailureStage::ResumeThread,
        ];

        assert_eq!(
            failures.map(WorkerLaunchFailureStage::diagnostic_exit_code),
            [20, 21, 22, 23, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,]
        );
    }

    #[test]
    fn maps_supervisor_setup_stages_to_closed_exit_codes() {
        let stages = [
            SupervisorFailureStage::ControlFrame,
            SupervisorFailureStage::Profile,
            SupervisorFailureStage::Job,
            SupervisorFailureStage::Pipes,
            SupervisorFailureStage::CurrentExecutable,
            SupervisorFailureStage::WorkerLaunch(WorkerLaunchFailureStage::CreateProcess(
                CreateProcessFailureReason::AccessDenied,
            )),
            SupervisorFailureStage::ControlSerialization,
            SupervisorFailureStage::ControlWrite,
            SupervisorFailureStage::WorkerReady,
            SupervisorFailureStage::CapabilityChannel,
            SupervisorFailureStage::ModelChannel,
            SupervisorFailureStage::WorkerRuntime,
        ];
        assert_eq!(
            stages.map(SupervisorFailureStage::diagnostic_exit_code),
            [10, 11, 12, 13, 14, 32, 15, 16, 17, 18, 19, 46]
        );
    }

    #[test]
    fn classifies_probe_child_exit_codes_without_exposing_raw_status() {
        let _transport_failures = [
            WindowsProbeExchangeFailure::RequestFrame,
            WindowsProbeExchangeFailure::WorkerWait,
            WindowsProbeExchangeFailure::ResultFrame,
        ];
        assert_eq!(
            classify_windows_probe_child_exit(WINDOWS_PROBE_CHILD_REQUEST_FAILURE_EXIT_CODE as u32,),
            WindowsProbeExchangeFailure::WorkerRequest
        );
        assert_eq!(
            classify_windows_probe_child_exit(WINDOWS_PROBE_CHILD_RESULT_FAILURE_EXIT_CODE as u32),
            WindowsProbeExchangeFailure::WorkerResult
        );
        assert_eq!(
            classify_windows_probe_child_exit(1),
            WindowsProbeExchangeFailure::WorkerEntry
        );
        assert_eq!(
            classify_windows_probe_child_exit(101),
            WindowsProbeExchangeFailure::WorkerPanic
        );
        for exit_code in [0xc000_0022, 0xc000_007b, 0xc000_0135, 0xc000_0142] {
            assert_eq!(
                classify_windows_probe_child_exit(exit_code),
                WindowsProbeExchangeFailure::WorkerImageLoad
            );
        }
        for exit_code in [0xc000_0005, 0xc000_0409] {
            assert_eq!(
                classify_windows_probe_child_exit(exit_code),
                WindowsProbeExchangeFailure::WorkerRuntimeFault
            );
        }
        assert_eq!(
            classify_windows_probe_child_exit(u32::MAX),
            WindowsProbeExchangeFailure::WorkerUnexpectedExit
        );
    }

    #[test]
    fn classifies_unexpected_probe_child_exits_by_the_last_closed_stage() {
        let stages = [
            WindowsProbeChildStage::Entry,
            WindowsProbeChildStage::InputHandleReady,
            WindowsProbeChildStage::RequestLengthRead,
            WindowsProbeChildStage::RequestFrameRead,
            WindowsProbeChildStage::RequestDecoded,
            WindowsProbeChildStage::FilesystemComplete,
            WindowsProbeChildStage::NetworkComplete,
            WindowsProbeChildStage::ProcessComplete,
            WindowsProbeChildStage::ResultWritten,
        ];
        assert_eq!(
            stages.map(WindowsProbeChildStage::marker),
            [0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9]
        );

        for (length, expected) in [
            (0, WindowsProbeExchangeFailure::WorkerBeforeEntry),
            (1, WindowsProbeExchangeFailure::WorkerInputHandleStage),
            (2, WindowsProbeExchangeFailure::WorkerRequestLengthStage),
            (3, WindowsProbeExchangeFailure::WorkerRequestFrameStage),
            (4, WindowsProbeExchangeFailure::WorkerRequestDecodeStage),
            (5, WindowsProbeExchangeFailure::WorkerFilesystemStage),
            (6, WindowsProbeExchangeFailure::WorkerNetworkStage),
            (7, WindowsProbeExchangeFailure::WorkerProcessStage),
            (8, WindowsProbeExchangeFailure::WorkerResultStage),
            (9, WindowsProbeExchangeFailure::WorkerUnexpectedExit),
        ] {
            let transcript: Vec<u8> = stages[..length]
                .iter()
                .map(|stage| stage.marker())
                .collect();
            assert_eq!(
                classify_windows_probe_child_exit_with_transcript(u32::MAX, &transcript),
                expected
            );
        }

        for invalid in [
            vec![0xa2],
            vec![0xa1, 0xa3],
            vec![0xa1, 0xa2, 0xa2],
            vec![0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa],
        ] {
            assert_eq!(
                classify_windows_probe_child_exit_with_transcript(u32::MAX, &invalid),
                WindowsProbeExchangeFailure::WorkerUnexpectedExit
            );
        }
    }

    #[test]
    fn proves_excluded_handle_absence_from_parent_side_duplicate_and_identity_checks() {
        assert_eq!(
            excluded_handle_absence_from_duplicate_attempt(
                false,
                WINDOWS_ERROR_INVALID_HANDLE_CODE,
                false
            ),
            Some(true),
        );
        assert_eq!(
            excluded_handle_absence_from_duplicate_attempt(true, 0, true),
            Some(false),
        );
        assert_eq!(
            excluded_handle_absence_from_duplicate_attempt(true, 0, false),
            Some(true),
        );
        assert_eq!(
            excluded_handle_absence_from_duplicate_attempt(false, 5, false),
            None,
        );
    }
}

#[cfg(all(test, windows))]
mod windows_native_tests {
    use super::*;
    use crate::windows_control::WINDOWS_CONTROL_MAX_BYTES;
    use std::ffi::OsString;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenIsAppContainer, SECURITY_ATTRIBUTES, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::JobObjects::{
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS,
        JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES,
        JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
        JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    };
    use windows_sys::Win32::System::Threading::{CreateEventW, OpenProcessToken};

    static PROFILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn unique_attempt_id() -> String {
        let elapsed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock must be after the Unix epoch")
            .as_nanos();
        let sequence = PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed) as u128;
        format!(
            "{:032x}",
            elapsed ^ sequence ^ u128::from(std::process::id())
        )
    }

    fn windows_test_private_root(label: &str) -> std::path::PathBuf {
        let unique = format!(
            "actestra-goose-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock must be after the Unix epoch")
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        std::fs::create_dir(&root).expect("the Windows native test root must be created");
        root
    }

    struct TestHandle(HANDLE);

    impl Drop for TestHandle {
        fn drop(&mut self) {
            // SAFETY: the test wrapper owns the event handle created below.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn current_test_process_is_app_container() -> bool {
        let mut token: HANDLE = null_mut();
        // SAFETY: the current-process pseudo handle is valid and token is an out pointer.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0
            || token.is_null()
        {
            return false;
        }
        let mut is_app_container = 0_u32;
        let mut return_length = 0_u32;
        // SAFETY: token is live and the output buffer exactly matches TokenIsAppContainer.
        let queried = unsafe {
            GetTokenInformation(
                token,
                TokenIsAppContainer,
                (&raw mut is_app_container).cast::<c_void>(),
                size_of::<u32>() as u32,
                &mut return_length,
            )
        } != 0;
        // SAFETY: token was opened above and is no longer needed.
        unsafe { CloseHandle(token) };
        queried && is_app_container == 1
    }

    #[test]
    fn appcontainer_anonymous_pipe_client_child() {
        if !current_test_process_is_app_container() {
            return;
        }

        if let Err(failure) = run_appcontainer_anonymous_pipe_client_child() {
            std::process::exit(failure.exit_code());
        }
    }

    fn run_appcontainer_anonymous_pipe_client_child() -> Result<(), AnonymousPipeTestChildFailure> {
        let input = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
        let mut handle_frame = [0_u8; 16];
        read_exact_handle(input, &mut handle_frame)
            .map_err(|_| AnonymousPipeTestChildFailure::Channel)?;
        let mut root_length = [0_u8; 4];
        read_exact_handle(input, &mut root_length)
            .map_err(|_| AnonymousPipeTestChildFailure::Channel)?;
        let root_length = u32::from_le_bytes(root_length) as usize;
        if root_length == 0 || root_length > WINDOWS_CONTROL_MAX_BYTES {
            return Err(AnonymousPipeTestChildFailure::Channel);
        }
        let mut root_bytes = vec![0_u8; root_length];
        read_exact_handle(input, &mut root_bytes)
            .map_err(|_| AnonymousPipeTestChildFailure::Channel)?;
        // SAFETY: the test child owns its inherited stdin endpoint and no longer needs it after
        // receiving the two dedicated bridge handles and bounded private-root path.
        unsafe { CloseHandle(input) };
        let private_root = String::from_utf8(root_bytes)
            .map_err(|_| AnonymousPipeTestChildFailure::StateDirectory)?;
        let (data_dir, config_dir) = prepare_goose_state_directories(&private_root)
            .map_err(|_| AnonymousPipeTestChildFailure::StateDirectory)?;
        for (index, directory) in [&data_dir, &config_dir].into_iter().enumerate() {
            let probe = directory.join(format!("appcontainer-state-{index}.txt"));
            std::fs::write(&probe, b"state")
                .map_err(|_| AnonymousPipeTestChildFailure::StateDirectory)?;
            if std::fs::read(&probe).map_err(|_| AnonymousPipeTestChildFailure::StateDirectory)?
                != b"state"
            {
                return Err(AnonymousPipeTestChildFailure::StateDirectory);
            }
            std::fs::remove_file(probe)
                .map_err(|_| AnonymousPipeTestChildFailure::StateDirectory)?;
        }
        let root_probe = std::path::Path::new(&private_root).join("appcontainer-root-write.txt");
        if std::fs::write(&root_probe, b"forbidden").is_ok() {
            let _ = std::fs::remove_file(root_probe);
            return Err(AnonymousPipeTestChildFailure::RootWriteAllowed);
        }
        let capability_read = u64::from_le_bytes(
            handle_frame[..8]
                .try_into()
                .map_err(|_| AnonymousPipeTestChildFailure::Channel)?,
        ) as usize as HANDLE;
        let capability_write = u64::from_le_bytes(
            handle_frame[8..]
                .try_into()
                .map_err(|_| AnonymousPipeTestChildFailure::Channel)?,
        ) as usize as HANDLE;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| AnonymousPipeTestChildFailure::Runtime)?;
        runtime.block_on(async {
            let mut client = crate::windows_bridge::WindowsBridgeChannel::from_raw_handle_pair(
                capability_read,
                capability_write,
            )
            .map_err(|_| AnonymousPipeTestChildFailure::Channel)?;
            let frame = crate::windows_bridge::encode_json_frame(
                &serde_json::json!({"contractVersion": 1, "kind": "appcontainer-test"}),
            )
            .map_err(|_| AnonymousPipeTestChildFailure::FrameEncode)?;
            client
                .write_frame(&frame)
                .await
                .map_err(|_| AnonymousPipeTestChildFailure::FrameWrite)?;
            let observed = client
                .read_frame()
                .await
                .map_err(|_| AnonymousPipeTestChildFailure::FrameRead)?;
            if observed != frame {
                return Err(AnonymousPipeTestChildFailure::FrameMismatch);
            }
            Ok(())
        })
    }

    #[test]
    fn exact_appcontainer_exchanges_frames_over_allowlisted_inherited_pipes() {
        let attempt_id = unique_attempt_id();
        let profile = AppContainerProfile::create(&attempt_id)
            .expect("a unique AppContainer profile must be created");
        let bridge_runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("the anonymous-pipe test runtime must start");

        let job = JobObject::create().expect("the AppContainer test Job must be configured");
        let mut pipes = WorkerPipeSet::create().expect("the AppContainer test pipes must open");
        let executable = std::env::current_exe().expect("the native test executable must resolve");
        let current_directory = executable
            .parent()
            .expect("the native test executable must have an absolute parent");
        let private_root = windows_test_private_root("appcontainer-state");
        let private_root_text = private_root.to_str().expect("the test path must be UTF-8");
        prepare_appcontainer_goose_state_directories(private_root_text, profile.sid())
            .expect("the exact AppContainer SID must receive bounded state-directory access");
        let private_root_bytes = private_root_text.as_bytes();
        let capability_handle_frame = [
            (pipes.worker_capability_read as usize as u64).to_le_bytes(),
            (pipes.worker_capability_write as usize as u64).to_le_bytes(),
        ]
        .concat();
        let test_control_frame = [
            capability_handle_frame,
            (private_root_bytes.len() as u32).to_le_bytes().to_vec(),
            private_root_bytes.to_vec(),
        ]
        .concat();
        let inherited_handles = pipes.inherited_handles();
        let worker = job
            .launch_suspended_worker_with_variant_and_stdio_and_argument(
                &profile,
                &executable,
                current_directory,
                &inherited_handles,
                Some(pipes.stdio()),
                WorkerLaunchVariant::Production,
                WINDOWS_ANONYMOUS_PIPE_TEST_CHILD_ARGUMENT,
                None,
            )
            .expect("the AppContainer anonymous-pipe test child must launch");
        pipes.close_worker_endpoints();
        let supervisor_control = pipes.take_worker_stdin().expect("supervisor control");
        if write_all_handle(supervisor_control, &test_control_frame).is_err() {
            panic!(
                "the AppContainer anonymous-pipe test failed at bounded stage {}",
                "test-supervisor-control-write-failed"
            );
        }
        // SAFETY: ownership was transferred out of the pipe set and the one-shot test control is
        // complete.
        unsafe { CloseHandle(supervisor_control) };
        let mut accepted = pipes
            .take_capability_worker_channel()
            .expect("the anonymous supervisor channel must open");
        let expected = crate::windows_bridge::encode_json_frame(
            &serde_json::json!({"contractVersion": 1, "kind": "appcontainer-test"}),
        )
        .expect("the AppContainer test frame must encode");
        let observed = bridge_runtime
            .block_on(accepted.read_frame())
            .unwrap_or_else(|_| {
                panic!(
                    "the AppContainer anonymous-pipe test failed at bounded stage {}",
                    "test-supervisor-frame-read-failed"
                )
            });
        if observed != expected {
            panic!(
                "the AppContainer anonymous-pipe test failed at bounded stage {}",
                "test-supervisor-frame-mismatch"
            );
        }
        bridge_runtime
            .block_on(accepted.write_frame(&expected))
            .unwrap_or_else(|_| {
                panic!(
                    "the AppContainer anonymous-pipe test failed at bounded stage {}",
                    "test-supervisor-frame-write-failed"
                )
            });
        drop(accepted);
        match worker.wait_for_exit(5_000) {
            Ok(0) => {}
            Ok(exit_code) => {
                let failure = classify_anonymous_pipe_test_child_exit(exit_code);
                panic!(
                    "the AppContainer anonymous-pipe test failed at bounded stage {}",
                    failure.code()
                );
            }
            Err(()) => panic!(
                "the AppContainer anonymous-pipe test failed at bounded stage {}",
                "test-child-wait-failed"
            ),
        }
        std::fs::remove_dir_all(private_root)
            .expect("the AppContainer state test root must be removable after exit");
    }

    #[test]
    fn production_worker_allowlist_contains_exactly_nine_closed_pipe_endpoints() {
        let pipes = WorkerPipeSet::create().expect("the production Worker pipes must open");
        let inherited = pipes.inherited_handles();
        assert_eq!(inherited.len(), 9);
        assert_eq!(
            inherited,
            [
                pipes.worker_stdin,
                pipes.worker_stdout,
                pipes.worker_stderr,
                pipes.worker_control_read,
                pipes.worker_ready_write,
                pipes.worker_capability_read,
                pipes.worker_capability_write,
                pipes.worker_model_read,
                pipes.worker_model_write,
            ]
        );
        assert!(pipes.handle_contract_is_closed());
        for worker_handle in inherited {
            assert!(!pipes.parent_handles().contains(&worker_handle));
        }
    }

    #[test]
    fn creates_one_capability_free_profile_and_rejects_reuse() {
        let attempt_id = unique_attempt_id();
        let profile = AppContainerProfile::create(&attempt_id)
            .expect("a unique AppContainer profile must be created");

        assert_eq!(profile.name(), format!("Actestra.Goose.{attempt_id}"));
        let capabilities = profile.security_capabilities();
        assert!(!capabilities.AppContainerSid.is_null());
        assert!(capabilities.Capabilities.is_null());
        assert_eq!(capabilities.CapabilityCount, 0);
        assert_eq!(capabilities.Reserved, 0);

        assert!(AppContainerProfile::create(&attempt_id).is_err());
    }

    #[test]
    fn configures_and_queries_back_the_exact_job_limits() {
        let job = JobObject::create().expect("the Windows Job Object must be configured");
        let configured = job
            .query_back()
            .expect("the Windows Job Object limits must query back");

        let required_limits = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_JOB_MEMORY
            | JOB_OBJECT_LIMIT_JOB_TIME;
        assert_eq!(
            configured.extended.BasicLimitInformation.LimitFlags,
            required_limits
        );
        assert_eq!(
            configured.extended.BasicLimitInformation.ActiveProcessLimit,
            1
        );
        assert_eq!(configured.extended.JobMemoryLimit, 1_073_741_824);
        assert_eq!(
            configured
                .extended
                .BasicLimitInformation
                .PerJobUserTimeLimit,
            120 * 10_000_000
        );

        let required_ui_restrictions = JOB_OBJECT_UILIMIT_READCLIPBOARD
            | JOB_OBJECT_UILIMIT_WRITECLIPBOARD
            | JOB_OBJECT_UILIMIT_DESKTOP
            | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
            | JOB_OBJECT_UILIMIT_GLOBALATOMS
            | JOB_OBJECT_UILIMIT_HANDLES
            | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
            | JOB_OBJECT_UILIMIT_EXITWINDOWS;
        assert_eq!(configured.ui.UIRestrictionsClass, required_ui_restrictions);
    }

    #[test]
    fn containment_launch_reuses_the_production_worker_boundary() {
        let excluded_handle =
            ProbeHandle::create().expect("the excluded probe handle must be created");
        let windows_directory = trusted_windows_directory()
            .expect("the trusted Windows directory must be available to the native probe");
        let mut executable = PathBuf::from(OsString::from_wide(&windows_directory));
        executable.push("System32");
        executable.push("cmd.exe");
        let current_directory = executable
            .parent()
            .expect("the probe executable must have an absolute parent");
        let attempt_id = unique_attempt_id();
        let launch = launch_windows_containment_worker(
            &attempt_id,
            &executable,
            current_directory,
            WINDOWS_PROBE_CHILD_ARGUMENT,
            &excluded_handle,
        )
        .expect("the containment seam must launch through the production boundary");
        let observation = launch
            .observation()
            .expect("the containment boundary must be observable without raw handles");

        assert!(observation.app_container);
        assert!(observation.assigned_before_resume);
        assert!(observation.excluded_handle_absent);
        assert!(observation.resumed_once);
        assert!(observation.exact_job_limits);
        assert!(observation.single_active_process);
        assert_eq!(
            launch.retained_profile_name(),
            format!("Actestra.Goose.{attempt_id}")
        );
        assert_eq!(launch.retained_parent_pipe_count(), 3);
    }

    #[test]
    fn diagnoses_create_process_attribute_and_environment_boundary() {
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 1,
        };
        // SAFETY: attributes is valid for the call and the returned event is wrapped immediately.
        let event = TestHandle(unsafe { CreateEventW(&raw mut attributes, 1, 0, null()) });
        assert!(!event.0.is_null());
        let windows_directory = trusted_windows_directory()
            .expect("the trusted Windows directory must be available to the native probe");
        let mut command = PathBuf::from(OsString::from_wide(&windows_directory));
        command.push("System32");
        command.push("cmd.exe");
        let current_directory = command
            .parent()
            .expect("the command executable must have an explicit parent directory");

        let variants = [
            WorkerLaunchVariant::Production,
            WorkerLaunchVariant::FullInherit,
            WorkerLaunchVariant::FullSystemRootWindir,
            WorkerLaunchVariant::FullSystemRootWindirComSpec,
            WorkerLaunchVariant::SecurityOnlyInherit,
            WorkerLaunchVariant::HandleListOnlyInherit,
            WorkerLaunchVariant::PlainInherit,
        ];
        let mut production_succeeded = false;
        let mut plain_succeeded = false;

        for variant in variants {
            let label = variant.label();
            let attempt_id = unique_attempt_id();
            let profile = AppContainerProfile::create(&attempt_id)
                .unwrap_or_else(|()| panic!("diagnostic profile setup failed variant={label}"));
            let job = JobObject::create()
                .unwrap_or_else(|()| panic!("diagnostic job setup failed variant={label}"));
            match job.launch_suspended_worker_with_variant(
                &profile,
                &command,
                current_directory,
                &[event.0],
                variant,
            ) {
                Ok(worker) => {
                    println!(
                        "WINDOWS_LAUNCH_DIAGNOSTIC variant={label} status=success \
                         stage=none reason=none win32_code=0"
                    );
                    assert!(worker.was_assigned_before_resume());
                    assert!(worker.was_resumed_from_one_suspend());
                    assert!(!worker.process_handle().is_null());
                    if variant == WorkerLaunchVariant::Production {
                        // Verify the Production Worker token has AppContainer isolation; a plain
                        // token would indicate the security-capabilities attribute was ignored.
                        let mut token: HANDLE = null_mut();
                        // SAFETY: process_handle() is a live process handle; token receives
                        // the opened token on success and is closed below.
                        let opened = unsafe {
                            OpenProcessToken(worker.process_handle(), TOKEN_QUERY, &mut token)
                        };
                        assert!(
                            opened != 0 && !token.is_null(),
                            "must open the Worker process token for production launch"
                        );
                        let mut is_app_container: u32 = 0;
                        let mut return_length: u32 = 0;
                        // SAFETY: token is live, the output buffer holds one u32, and its size
                        // exactly matches the documented TokenIsAppContainer information class.
                        let queried = unsafe {
                            GetTokenInformation(
                                token,
                                TokenIsAppContainer,
                                (&raw mut is_app_container).cast::<c_void>(),
                                size_of::<u32>() as u32,
                                &mut return_length,
                            )
                        };
                        // SAFETY: token was opened above and is no longer needed after the query.
                        unsafe { CloseHandle(token) };
                        assert!(
                            queried != 0,
                            "must query TokenIsAppContainer from the Worker process token"
                        );
                        assert_eq!(
                            is_app_container, 1,
                            "Worker process token must have AppContainer isolation, not a plain token"
                        );
                    }
                    production_succeeded |= variant == WorkerLaunchVariant::Production;
                    plain_succeeded |= variant == WorkerLaunchVariant::PlainInherit;
                }
                Err(failure) => {
                    let stage = failure.code();
                    let reason = failure.reason_code();
                    let win32_code = failure.win32_code().unwrap_or(0);
                    println!(
                        "WINDOWS_LAUNCH_DIAGNOSTIC variant={label} status=failure \
                         stage={stage} reason={reason} win32_code={win32_code}"
                    );
                }
            }
        }

        assert!(
            plain_succeeded,
            "Windows launch diagnostic harness is invalid: plain-inherit did not succeed"
        );
        assert!(
            production_succeeded,
            "Windows production launch remains unavailable; inspect sanitized matrix output"
        );
    }

    #[test]
    fn diagnoses_the_local_appdata_requirement_for_inherited_appcontainer_environment() {
        let original_local_app_data = std::env::var_os("LOCALAPPDATA");
        assert!(
            original_local_app_data.is_some(),
            "the native Windows probe requires the host LOCALAPPDATA value"
        );

        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 1,
        };
        // SAFETY: attributes is valid for the call and the returned event is wrapped immediately.
        let event = TestHandle(unsafe { CreateEventW(&raw mut attributes, 1, 0, null()) });
        assert!(!event.0.is_null());
        let windows_directory = trusted_windows_directory()
            .expect("the trusted Windows directory must be available to the native probe");
        let mut command = PathBuf::from(OsString::from_wide(&windows_directory));
        command.push("System32");
        command.push("cmd.exe");
        let current_directory = command
            .parent()
            .expect("the command executable must have an explicit parent directory");

        let launch = || -> Result<(), WorkerLaunchFailureStage> {
            let attempt_id = unique_attempt_id();
            let profile = AppContainerProfile::create(&attempt_id)
                .expect("diagnostic AppContainer profile setup must succeed");
            let job = JobObject::create().expect("diagnostic Job Object setup must succeed");
            let result = job.launch_suspended_worker_with_variant(
                &profile,
                &command,
                current_directory,
                &[event.0],
                WorkerLaunchVariant::Production,
            );
            match result {
                Ok(worker) => {
                    assert!(worker.was_assigned_before_resume());
                    assert!(worker.was_resumed_from_one_suspend());
                    Ok(())
                }
                Err(failure) => Err(failure),
            }
        };

        // Keep the test's environment mutation scoped to this single native probe. The parent
        // process normally supplies LOCALAPPDATA; removing it isolates the variable that the
        // AppContainer environment-rewrite path resolves during CreateProcessW.
        std::env::remove_var("LOCALAPPDATA");
        let missing = launch();
        println!(
            "WINDOWS_ENVIRONMENT_DIAGNOSTIC variant=missing-localappdata status={} reason={} win32_code={}",
            if missing.is_ok() { "success" } else { "failure" },
            missing
                .as_ref()
                .err()
                .map_or("none", |failure| failure.reason_code()),
            missing
                .as_ref()
                .err()
                .and_then(|failure| failure.win32_code())
                .unwrap_or(0)
        );
        let missing_is_expected = matches!(
            missing,
            Err(WorkerLaunchFailureStage::CreateProcess(
                CreateProcessFailureReason::EnvironmentVariableNotFound
            ))
        );

        let private_local_app_data = std::env::temp_dir().join(format!(
            "actestra-goose-localappdata-{}",
            unique_attempt_id()
        ));
        std::fs::create_dir_all(&private_local_app_data)
            .expect("the diagnostic private LOCALAPPDATA directory must be creatable");
        std::env::set_var("LOCALAPPDATA", &private_local_app_data);
        let private = launch();
        println!(
            "WINDOWS_ENVIRONMENT_DIAGNOSTIC variant=private-localappdata status={} reason={} win32_code={}",
            if private.is_ok() { "success" } else { "failure" },
            private
                .as_ref()
                .err()
                .map_or("none", |failure| failure.reason_code()),
            private
                .as_ref()
                .err()
                .and_then(|failure| failure.win32_code())
                .unwrap_or(0)
        );
        let private_succeeded = private.is_ok();

        if let Some(value) = original_local_app_data {
            std::env::set_var("LOCALAPPDATA", value);
        } else {
            std::env::remove_var("LOCALAPPDATA");
        }
        let restored = launch();
        println!(
            "WINDOWS_ENVIRONMENT_DIAGNOSTIC variant=restored-localappdata status={} reason={} win32_code={}",
            if restored.is_ok() { "success" } else { "failure" },
            restored
                .as_ref()
                .err()
                .map_or("none", |failure| failure.reason_code()),
            restored
                .as_ref()
                .err()
                .and_then(|failure| failure.win32_code())
                .unwrap_or(0)
        );
        assert!(restored.is_ok());

        let _ = std::fs::remove_dir_all(private_local_app_data);
        assert!(missing_is_expected);
        assert!(
            private_succeeded,
            "a private LOCALAPPDATA value must satisfy AppContainer environment creation"
        );
        assert!(restored.is_ok());
    }

    #[test]
    fn classifies_worker_startup_exit_codes_to_distinct_failure_stages() {
        assert_eq!(
            classify_worker_startup_exit(101),
            WorkerStartupFailure::ControlFrame
        );
        assert_eq!(
            classify_worker_startup_exit(102),
            WorkerStartupFailure::BoundaryVerification
        );
        assert_eq!(
            classify_worker_startup_exit(103),
            WorkerStartupFailure::RuntimeCreation
        );
        assert_eq!(
            classify_worker_startup_exit(108),
            WorkerStartupFailure::CapabilityBridge
        );
        assert_eq!(
            classify_worker_startup_exit(113),
            WorkerStartupFailure::ModelBridge
        );
        assert_eq!(
            classify_worker_startup_exit(114),
            WorkerStartupFailure::StateDirectory
        );
        assert_eq!(
            classify_worker_startup_exit(115),
            WorkerStartupFailure::ReadySignal
        );
        assert_eq!(
            classify_worker_startup_exit(116),
            WorkerStartupFailure::AcpHandshake
        );
        assert_eq!(
            classify_worker_startup_exit(0),
            WorkerStartupFailure::Unknown
        );
        assert_eq!(
            classify_worker_startup_exit(1),
            WorkerStartupFailure::Unknown
        );
        assert_eq!(
            classify_worker_startup_exit(259),
            WorkerStartupFailure::Unknown
        );
    }

    #[test]
    fn maps_worker_startup_failures_to_distinct_runtime_codes() {
        assert_eq!(
            WorkerStartupFailure::ControlFrame.runtime_code(),
            "windows-worker-control-frame-invalid"
        );
        assert_eq!(
            WorkerStartupFailure::BoundaryVerification.runtime_code(),
            "windows-worker-boundary-verification-failed"
        );
        assert_eq!(
            WorkerStartupFailure::RuntimeCreation.runtime_code(),
            "windows-worker-runtime-creation-failed"
        );
        assert_eq!(
            WorkerStartupFailure::CapabilityBridge.runtime_code(),
            "windows-worker-capability-bridge-failed"
        );
        assert_eq!(
            WorkerStartupFailure::ModelBridge.runtime_code(),
            "windows-worker-model-bridge-failed"
        );
        assert_eq!(
            WorkerStartupFailure::StateDirectory.runtime_code(),
            "windows-worker-state-directory-failed"
        );
        assert_eq!(
            WorkerStartupFailure::ReadySignal.runtime_code(),
            "windows-worker-ready-signal-failed"
        );
        assert_eq!(
            WorkerStartupFailure::AcpHandshake.runtime_code(),
            "windows-worker-acp-handshake-failed"
        );
        assert_eq!(
            WorkerStartupFailure::Unknown.runtime_code(),
            "windows-worker-runtime-failed"
        );
    }
}
