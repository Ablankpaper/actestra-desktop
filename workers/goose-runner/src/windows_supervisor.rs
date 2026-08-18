pub(crate) const WINDOWS_SETUP_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
pub(crate) const WINDOWS_RESOURCE_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";

#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::mem::{size_of, zeroed};
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::ptr::{null, null_mut};
#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
#[cfg(windows)]
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
#[cfg(windows)]
use windows_sys::Win32::Security::{EqualSid, FreeSid, PSID, SECURITY_CAPABILITIES};
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
use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
#[cfg(windows)]
use windows_sys::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList, ResumeThread,
    TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW,
    CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
    PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTUPINFOEXW,
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
const WINDOWS_WORKER_MODE_ARGUMENT: &str = "--actestra-windows-worker-v1";
#[cfg(any(windows, test))]
const WINDOWS_DIRECTORY_MAX_U16: usize = 32_767;

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

#[cfg(windows)]
fn trusted_windows_environment_block() -> Result<Vec<u16>, ()> {
    let windows_directory = trusted_windows_directory()?;
    build_minimal_windows_environment_block(&windows_directory)
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
        let command_line = format!("\"{executable_text}\" {WINDOWS_WORKER_MODE_ARGUMENT}");
        let mut command_line_wide: Vec<u16> = command_line
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let security_capabilities = profile.security_capabilities();
        let mut attribute_list = ProcThreadAttributeList::create(2)
            .map_err(|()| WorkerLaunchFailureStage::AttributeListInit)?;
        attribute_list
            .update(
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                (&raw const security_capabilities).cast::<c_void>(),
                size_of::<SECURITY_CAPABILITIES>(),
            )
            .map_err(|()| WorkerLaunchFailureStage::SecurityCapabilitiesAttribute)?;
        attribute_list
            .update(
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                inherited_handles.as_ptr().cast::<c_void>(),
                std::mem::size_of_val(inherited_handles),
            )
            .map_err(|()| WorkerLaunchFailureStage::HandleListAttribute)?;

        // SAFETY: zero is the documented initialization for both Win32 structures.
        let mut startup: STARTUPINFOEXW = unsafe { zeroed() };
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = attribute_list.pointer;
        // SAFETY: zero is the documented initialization and CreateProcessW fills every handle.
        let mut process_information: PROCESS_INFORMATION = unsafe { zeroed() };
        let environment = trusted_windows_environment_block()
            .map_err(|()| WorkerLaunchFailureStage::InputValidation)?;
        let flags = CREATE_SUSPENDED
            | EXTENDED_STARTUPINFO_PRESENT
            | CREATE_UNICODE_ENVIRONMENT
            | CREATE_NO_WINDOW;
        // SAFETY: all pointers remain valid through the call, the command line is writable,
        // inherited handles are explicitly allowlisted, and the extended startup list has the
        // exact AppContainer and handle attributes configured above.
        if unsafe {
            CreateProcessW(
                executable_wide.as_ptr(),
                command_line_wide.as_mut_ptr(),
                null(),
                null(),
                1,
                flags,
                environment.as_ptr().cast::<c_void>(),
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

pub(crate) fn run_supervisor() -> i32 {
    eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
    1
}

pub(crate) fn run_worker() -> i32 {
    eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
    1
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
    use std::mem::size_of;
    use std::path::PathBuf;
    use std::ptr::null;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::System::JobObjects::{
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
        JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS,
        JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES,
        JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
        JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    };
    use windows_sys::Win32::System::Threading::CreateEventW;

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
    fn assigns_the_suspended_appcontainer_worker_before_resuming_it() {
        let attempt_id = unique_attempt_id();
        let profile = AppContainerProfile::create(&attempt_id)
            .expect("a unique AppContainer profile must be created");
        let job = JobObject::create().expect("the Windows Job Object must be configured");
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 1,
        };
        // SAFETY: attributes is valid for the call and the returned event is wrapped immediately.
        let event = TestHandle(unsafe { CreateEventW(&raw mut attributes, 1, 0, null()) });
        assert!(!event.0.is_null());
        let command = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\cmd.exe"));
        let current_directory = command
            .parent()
            .expect("the command executable must have an explicit parent directory");

        let worker = job
            .launch_suspended_worker(&profile, &command, current_directory, &[event.0])
            .unwrap_or_else(|failure| {
                let stage = failure.code();
                let reason = failure.reason_code();
                if let Some(win32_code) = failure.unclassified_win32_code() {
                    panic!(
                        "worker launch failed at stage={stage} reason={reason} win32_code={win32_code}"
                    );
                }
                panic!("worker launch failed at stage={stage} reason={reason}");
            });

        assert!(worker.was_assigned_before_resume());
        assert!(worker.was_resumed_from_one_suspend());
        assert!(!worker.process_handle().is_null());
    }
}
