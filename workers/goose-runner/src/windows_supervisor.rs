pub(crate) const WINDOWS_SETUP_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
pub(crate) const WINDOWS_RESOURCE_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";
#[cfg(windows)]
const WINDOWS_WORKER_READY_MARKER: &[u8] = b"ACTESTRA_GOOSE_WINDOWS_WORKER_READY\n";

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::mem::{size_of, size_of_val, zeroed};
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::ptr::{null, null_mut};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, SetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT,
    INVALID_HANDLE_VALUE,
};
#[cfg(windows)]
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
#[cfg(windows)]
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
#[cfg(windows)]
use windows_sys::Win32::Security::{
    EqualSid, FreeSid, GetTokenInformation, TokenIsAppContainer, PSID, SECURITY_CAPABILITIES,
    TOKEN_QUERY,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
#[cfg(windows)]
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JobObjectBasicUIRestrictions,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
    JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD,
    JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS, JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
};
#[cfg(windows)]
use windows_sys::Win32::System::Pipes::CreatePipe;
#[cfg(windows)]
use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
    InitializeProcThreadAttributeList, OpenProcessToken, ResumeThread, TerminateProcess,
    UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
    CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION,
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    STARTF_USESTDHANDLES, STARTUPINFOEXW,
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
#[cfg(any(windows, test))]
const WINDOWS_WORKER_MODE_ARGUMENT: &str = "--actestra-windows-worker-v1";
#[cfg(any(windows, test))]
const WINDOWS_WORKER_PROGRAM_NAME: &str = "actestra-goose-runner.exe";
#[cfg(any(windows, test))]
const WINDOWS_DIRECTORY_MAX_U16: usize = 32_767;

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
fn build_worker_command_line() -> Vec<u16> {
    format!("{WINDOWS_WORKER_PROGRAM_NAME} {WINDOWS_WORKER_MODE_ARGUMENT}\0")
        .encode_utf16()
        .collect()
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
            Self::CreateProcess(CreateProcessFailureReason::NotSupported) => Some(50),
            Self::CreateProcess(CreateProcessFailureReason::InvalidParameter) => Some(87),
            Self::CreateProcess(CreateProcessFailureReason::ElevationRequired) => Some(740),
            Self::CreateProcess(CreateProcessFailureReason::PrivilegeNotHeld) => Some(1314),
            Self::CreateProcess(CreateProcessFailureReason::Other(win32_code)) => Some(win32_code),
            _ => None,
        }
    }
}

pub(crate) struct WindowsPipeNames {
    pub(crate) capability: String,
    pub(crate) model: String,
}

fn is_exact_attempt_id(attempt_id: &str) -> bool {
    attempt_id.len() == 32
        && attempt_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn derive_pipe_names(attempt_id: &str) -> Result<WindowsPipeNames, ()> {
    if !is_exact_attempt_id(attempt_id) {
        return Err(());
    }
    let prefix = r"\\.\pipe\LOCAL\Actestra.Goose.";
    Ok(WindowsPipeNames {
        capability: format!("{prefix}{attempt_id}.capability"),
        model: format!("{prefix}{attempt_id}.model"),
    })
}

#[cfg(windows)]
struct AppContainerProfile {
    name: String,
    wide_name: Vec<u16>,
    sid: PSID,
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
}

#[cfg(windows)]
impl Drop for AppContainerProfile {
    fn drop(&mut self) {
        // SAFETY: both resources are exact values created and retained by this instance.
        unsafe {
            DeleteAppContainerProfile(self.wide_name.as_ptr());
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

    fn was_assigned_before_resume(&self) -> bool {
        self.assigned_before_resume
    }

    fn was_resumed_from_one_suspend(&self) -> bool {
        self.resumed_from_one_suspend
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
        let mut command_line_wide = build_worker_command_line();

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
        };
        if !created {
            for handle in [
                worker_stdin,
                supervisor_stdin,
                supervisor_stdout,
                worker_stdout,
                supervisor_stderr,
                worker_stderr,
            ] {
                if !handle.is_null() {
                    unsafe { CloseHandle(handle) };
                }
            }
            return Err(());
        }
        for handle in [supervisor_stdin, supervisor_stdout, supervisor_stderr] {
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
                ] {
                    if !owned.is_null() {
                        unsafe { CloseHandle(owned) };
                    }
                }
                return Err(());
            }
        }
        Ok(Self {
            supervisor_stdin,
            supervisor_stdout,
            supervisor_stderr,
            worker_stdin,
            worker_stdout,
            worker_stderr,
        })
    }

    fn inherited_handles(&self) -> [HANDLE; 3] {
        [self.worker_stdin, self.worker_stdout, self.worker_stderr]
    }

    fn stdio(&self) -> [HANDLE; 3] {
        self.inherited_handles()
    }

    fn close_worker_endpoints(&mut self) {
        for handle in [
            &mut self.worker_stdin,
            &mut self.worker_stdout,
            &mut self.worker_stderr,
        ] {
            if !handle.is_null() {
                unsafe { CloseHandle(*handle) };
                *handle = null_mut();
            }
        }
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
        ] {
            if !handle.is_null() {
                unsafe { CloseHandle(*handle) };
                *handle = null_mut();
            }
        }
    }
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
                eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
                return 1;
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
    #[cfg(windows)]
    {
        let input = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
        let output = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
        let control = match read_control_frame_from_handle(input) {
            Ok(control) => control,
            Err(()) => {
                eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
                return 1;
            }
        };
        if !verify_worker_boundary() {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
        }
        if write_all_handle(output, WINDOWS_WORKER_READY_MARKER).is_err() {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
        }
        let _ = control;
        0
    }
    #[cfg(not(windows))]
    {
        eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
        1
    }
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
    let profile = match AppContainerProfile::create(&control.attempt_id) {
        Ok(profile) => profile,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
        }
    };
    let job = match JobObject::create() {
        Ok(job) => job,
        Err(()) => {
            eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
            return 1;
        }
    };
    let mut pipes = match WorkerPipeSet::create() {
        Ok(pipes) => pipes,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
        }
    };
    let executable = match std::env::current_exe() {
        Ok(executable) => executable,
        Err(_) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
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
        Err(_) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
        }
    };
    pipes.close_worker_endpoints();
    let payload = match crate::windows_control::serialize_control_message(&control) {
        Ok(payload) => payload,
        Err(()) => {
            eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
            return 1;
        }
    };
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    frame.extend_from_slice(&payload);
    if write_all_handle(pipes.supervisor_stdin, &frame).is_err() {
        eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
        return 1;
    }
    unsafe { CloseHandle(pipes.supervisor_stdin) };
    pipes.supervisor_stdin = null_mut();
    let mut marker = vec![0_u8; WINDOWS_WORKER_READY_MARKER.len()];
    let worker_ready = read_exact_handle(pipes.supervisor_stdout, &mut marker).is_ok()
        && marker == WINDOWS_WORKER_READY_MARKER;
    if !worker_ready {
        eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
        return 1;
    }
    eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
    let _ = worker;
    1
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_exact_attempt_scoped_pipe_names_without_private_text() {
        let names = derive_pipe_names("0123456789abcdef0123456789abcdef").unwrap();
        assert!(names
            .capability
            .starts_with(r"\\.\pipe\LOCAL\Actestra.Goose."));
        assert!(names.model.starts_with(r"\\.\pipe\LOCAL\Actestra.Goose."));
        assert!(names.capability.ends_with(".capability"));
        assert!(names.model.ends_with(".model"));
        assert_ne!(names.capability, names.model);
        for forbidden in ["C:", "prompt", "model text", "lease"] {
            assert!(!names.capability.contains(forbidden));
            assert!(!names.model.contains(forbidden));
        }
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
            assert!(derive_pipe_names(value).is_err());
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
                "resume-thread",
            ]
        );
        assert_eq!(
            stages.map(WorkerLaunchFailureStage::reason_code),
            ["none", "none", "none", "none", "other", "none", "none", "none"]
        );
        assert_eq!(
            stages.map(WorkerLaunchFailureStage::unclassified_win32_code),
            [None, None, None, None, Some(u32::MAX), None, None, None]
        );
        for code in stages.map(WorkerLaunchFailureStage::code) {
            assert!(code
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-'));
        }
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
}

#[cfg(all(test, windows))]
mod windows_native_tests {
    use super::*;
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

    struct TestHandle(HANDLE);

    impl Drop for TestHandle {
        fn drop(&mut self) {
            // SAFETY: the test wrapper owns the event handle created below.
            unsafe { CloseHandle(self.0) };
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
}
