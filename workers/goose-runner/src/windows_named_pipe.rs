const WINDOWS_PIPE_PREFIX: &str = r"\\.\pipe\LOCAL\Actestra.Goose.";
const WINDOWS_PIPE_ATTEMPT_ID_LENGTH: usize = 32;
#[cfg(windows)]
const WINDOWS_PIPE_BUFFER_BYTES: u32 = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsPipeEndpoint {
    Capability,
    Model,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsNamedPipeError {
    InvalidName,
    #[cfg(windows)]
    InvalidIdentity,
    #[cfg(windows)]
    SecurityPolicyUnavailable,
    #[cfg(windows)]
    EndpointUnavailable,
}

pub(crate) fn validate_pipe_name(name: &str) -> Result<WindowsPipeEndpoint, WindowsNamedPipeError> {
    let remainder = name
        .strip_prefix(WINDOWS_PIPE_PREFIX)
        .ok_or(WindowsNamedPipeError::InvalidName)?;
    let (attempt_id, endpoint) = if let Some(attempt_id) = remainder.strip_suffix(".capability") {
        (attempt_id, WindowsPipeEndpoint::Capability)
    } else if let Some(attempt_id) = remainder.strip_suffix(".model") {
        (attempt_id, WindowsPipeEndpoint::Model)
    } else {
        return Err(WindowsNamedPipeError::InvalidName);
    };
    if attempt_id.len() != WINDOWS_PIPE_ATTEMPT_ID_LENGTH
        || !attempt_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(WindowsNamedPipeError::InvalidName);
    }
    Ok(endpoint)
}

#[cfg(windows)]
use crate::windows_bridge::WindowsBridgeChannel;
#[cfg(windows)]
use std::ffi::c_void;
#[cfg(windows)]
use std::mem::size_of;
#[cfg(windows)]
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeServer, PipeMode, ServerOptions};
#[cfg(windows)]
use windows_sys::Win32::Security::{
    AddAccessAllowedAce, AddMandatoryAce, CreateWellKnownSid, EqualSid, GetAce, GetLengthSid,
    InitializeAcl, InitializeSecurityDescriptor, IsValidSid, SetSecurityDescriptorDacl,
    SetSecurityDescriptorSacl, WinLowLabelSid, ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, PSID,
    SECURITY_ATTRIBUTES, SECURITY_DESCRIPTOR, SECURITY_MAX_SID_SIZE, SYSTEM_MANDATORY_LABEL_ACE,
};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{FILE_GENERIC_READ, FILE_GENERIC_WRITE};
#[cfg(windows)]
use windows_sys::Win32::System::SystemServices::{
    ACCESS_ALLOWED_ACE_TYPE, SECURITY_DESCRIPTOR_REVISION, SYSTEM_MANDATORY_LABEL_ACE_TYPE,
    SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
};

#[cfg(windows)]
const WINDOWS_PIPE_ACCESS_MASK: u32 = FILE_GENERIC_READ | FILE_GENERIC_WRITE;

#[cfg(windows)]
struct PipeSecurityDescriptor {
    acl: Vec<u32>,
    sacl: Vec<u32>,
    low_integrity_sid: Vec<usize>,
    descriptor: Box<SECURITY_DESCRIPTOR>,
}

#[cfg(windows)]
impl PipeSecurityDescriptor {
    fn create(owner_sid: PSID, app_container_sid: PSID) -> Result<Self, WindowsNamedPipeError> {
        if owner_sid.is_null()
            || app_container_sid.is_null()
            || unsafe { IsValidSid(owner_sid) } == 0
            || unsafe { IsValidSid(app_container_sid) } == 0
            || unsafe { EqualSid(owner_sid, app_container_sid) } != 0
        {
            return Err(WindowsNamedPipeError::InvalidIdentity);
        }
        let owner_length = unsafe { GetLengthSid(owner_sid) } as usize;
        let app_container_length = unsafe { GetLengthSid(app_container_sid) } as usize;
        let ace_header_bytes = size_of::<ACCESS_ALLOWED_ACE>()
            .checked_sub(size_of::<u32>())
            .ok_or(WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        let acl_bytes = size_of::<ACL>()
            .checked_add(
                ace_header_bytes
                    .checked_mul(2)
                    .ok_or(WindowsNamedPipeError::SecurityPolicyUnavailable)?,
            )
            .and_then(|size| size.checked_add(owner_length))
            .and_then(|size| size.checked_add(app_container_length))
            .ok_or(WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        let acl_length = u32::try_from(acl_bytes)
            .map_err(|_| WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        let mut acl = vec![0_u32; acl_bytes.div_ceil(size_of::<u32>())];
        let acl_pointer = acl.as_mut_ptr().cast::<ACL>();
        if unsafe { InitializeAcl(acl_pointer, acl_length, ACL_REVISION) } == 0
            || unsafe {
                AddAccessAllowedAce(
                    acl_pointer,
                    ACL_REVISION,
                    WINDOWS_PIPE_ACCESS_MASK,
                    owner_sid,
                )
            } == 0
            || unsafe {
                AddAccessAllowedAce(
                    acl_pointer,
                    ACL_REVISION,
                    WINDOWS_PIPE_ACCESS_MASK,
                    app_container_sid,
                )
            } == 0
        {
            return Err(WindowsNamedPipeError::SecurityPolicyUnavailable);
        }

        let low_integrity_sid_words = (SECURITY_MAX_SID_SIZE as usize).div_ceil(size_of::<usize>());
        let mut low_integrity_sid = vec![0_usize; low_integrity_sid_words];
        let low_integrity_sid_pointer = low_integrity_sid.as_mut_ptr().cast::<c_void>();
        let mut low_integrity_sid_length = u32::try_from(
            low_integrity_sid
                .len()
                .checked_mul(size_of::<usize>())
                .ok_or(WindowsNamedPipeError::SecurityPolicyUnavailable)?,
        )
        .map_err(|_| WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        if unsafe {
            CreateWellKnownSid(
                WinLowLabelSid,
                std::ptr::null_mut(),
                low_integrity_sid_pointer,
                &mut low_integrity_sid_length,
            )
        } == 0
            || unsafe { IsValidSid(low_integrity_sid_pointer) } == 0
        {
            return Err(WindowsNamedPipeError::SecurityPolicyUnavailable);
        }
        let low_integrity_sid_length = unsafe { GetLengthSid(low_integrity_sid_pointer) } as usize;
        let mandatory_ace_header_bytes = size_of::<SYSTEM_MANDATORY_LABEL_ACE>()
            .checked_sub(size_of::<u32>())
            .ok_or(WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        let sacl_bytes = size_of::<ACL>()
            .checked_add(mandatory_ace_header_bytes)
            .and_then(|size| size.checked_add(low_integrity_sid_length))
            .ok_or(WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        let sacl_length = u32::try_from(sacl_bytes)
            .map_err(|_| WindowsNamedPipeError::SecurityPolicyUnavailable)?;
        let mut sacl = vec![0_u32; sacl_bytes.div_ceil(size_of::<u32>())];
        let sacl_pointer = sacl.as_mut_ptr().cast::<ACL>();
        if unsafe { InitializeAcl(sacl_pointer, sacl_length, ACL_REVISION) } == 0
            || unsafe {
                AddMandatoryAce(
                    sacl_pointer,
                    ACL_REVISION,
                    0,
                    SYSTEM_MANDATORY_LABEL_NO_WRITE_UP,
                    low_integrity_sid_pointer,
                )
            } == 0
        {
            return Err(WindowsNamedPipeError::SecurityPolicyUnavailable);
        }

        let mut descriptor = Box::<SECURITY_DESCRIPTOR>::default();
        if unsafe {
            InitializeSecurityDescriptor(
                descriptor.as_mut() as *mut SECURITY_DESCRIPTOR as *mut c_void,
                SECURITY_DESCRIPTOR_REVISION,
            )
        } == 0
            || unsafe {
                SetSecurityDescriptorDacl(
                    descriptor.as_mut() as *mut SECURITY_DESCRIPTOR as *mut c_void,
                    1,
                    acl_pointer,
                    0,
                )
            } == 0
            || unsafe {
                SetSecurityDescriptorSacl(
                    descriptor.as_mut() as *mut SECURITY_DESCRIPTOR as *mut c_void,
                    1,
                    sacl_pointer,
                    0,
                )
            } == 0
        {
            return Err(WindowsNamedPipeError::SecurityPolicyUnavailable);
        }
        let security = Self {
            acl,
            sacl,
            low_integrity_sid,
            descriptor,
        };
        if !security.grants_exactly(owner_sid, app_container_sid)
            || !security.labels_low_integrity()
        {
            return Err(WindowsNamedPipeError::SecurityPolicyUnavailable);
        }
        Ok(security)
    }

    fn grants_exactly(&self, owner_sid: PSID, app_container_sid: PSID) -> bool {
        let acl_pointer = self.acl.as_ptr().cast::<ACL>();
        let acl = unsafe { &*acl_pointer };
        if acl.AceCount != 2 {
            return false;
        }
        let mut owner_seen = false;
        let mut app_container_seen = false;
        for index in 0..2_u32 {
            let mut raw_ace = std::ptr::null_mut::<c_void>();
            if unsafe { GetAce(acl_pointer, index, &mut raw_ace) } == 0 || raw_ace.is_null() {
                return false;
            }
            let ace = unsafe { &*raw_ace.cast::<ACCESS_ALLOWED_ACE>() };
            if u32::from(ace.Header.AceType) != ACCESS_ALLOWED_ACE_TYPE
                || ace.Mask != WINDOWS_PIPE_ACCESS_MASK
            {
                return false;
            }
            let sid = std::ptr::addr_of!(ace.SidStart) as PSID;
            if unsafe { EqualSid(sid, owner_sid) } != 0 {
                if owner_seen {
                    return false;
                }
                owner_seen = true;
            } else if unsafe { EqualSid(sid, app_container_sid) } != 0 {
                if app_container_seen {
                    return false;
                }
                app_container_seen = true;
            } else {
                return false;
            }
        }
        owner_seen && app_container_seen
    }

    fn labels_low_integrity(&self) -> bool {
        let sacl_pointer = self.sacl.as_ptr().cast::<ACL>();
        let sacl = unsafe { &*sacl_pointer };
        if sacl.AceCount != 1 {
            return false;
        }
        let mut raw_ace = std::ptr::null_mut::<c_void>();
        if unsafe { GetAce(sacl_pointer, 0, &mut raw_ace) } == 0 || raw_ace.is_null() {
            return false;
        }
        let ace = unsafe { &*raw_ace.cast::<SYSTEM_MANDATORY_LABEL_ACE>() };
        if u32::from(ace.Header.AceType) != SYSTEM_MANDATORY_LABEL_ACE_TYPE
            || ace.Mask != SYSTEM_MANDATORY_LABEL_NO_WRITE_UP
        {
            return false;
        }
        let sid = std::ptr::addr_of!(ace.SidStart) as PSID;
        let expected = self.low_integrity_sid.as_ptr().cast_mut().cast::<c_void>();
        (unsafe { EqualSid(sid, expected) }) != 0
    }

    fn attributes(&mut self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.descriptor.as_mut() as *mut SECURITY_DESCRIPTOR
                as *mut c_void,
            bInheritHandle: 0,
        }
    }
}

#[cfg(windows)]
pub(crate) struct WindowsNamedPipeServer {
    inner: NamedPipeServer,
    security: PipeSecurityDescriptor,
}

#[cfg(windows)]
impl WindowsNamedPipeServer {
    pub(crate) fn create(
        name: &str,
        owner_sid: PSID,
        app_container_sid: PSID,
    ) -> Result<Self, WindowsNamedPipeError> {
        validate_pipe_name(name)?;
        let mut security = PipeSecurityDescriptor::create(owner_sid, app_container_sid)?;
        let mut attributes = security.attributes();
        let inner = unsafe {
            ServerOptions::new()
                .pipe_mode(PipeMode::Byte)
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .max_instances(1)
                .in_buffer_size(WINDOWS_PIPE_BUFFER_BYTES)
                .out_buffer_size(WINDOWS_PIPE_BUFFER_BYTES)
                .create_with_security_attributes_raw(
                    name,
                    std::ptr::addr_of_mut!(attributes).cast::<c_void>(),
                )
        }
        .map_err(|_| WindowsNamedPipeError::EndpointUnavailable)?;
        Ok(Self { inner, security })
    }

    fn into_pipe(self) -> NamedPipeServer {
        let Self { inner, security } = self;
        // CreateNamedPipeW copies the security descriptor into the kernel object. Drop the
        // backing descriptor before awaiting overlapped I/O so this future remains Send.
        drop(security);
        inner
    }

    pub(crate) fn accept_once(
        self,
    ) -> impl std::future::Future<Output = Result<WindowsBridgeChannel, WindowsNamedPipeError>> + Send
    {
        let inner = self.into_pipe();
        async move {
            inner
                .connect()
                .await
                .map_err(|_| WindowsNamedPipeError::EndpointUnavailable)?;
            Ok(WindowsBridgeChannel::new(inner))
        }
    }
}

#[cfg(windows)]
pub(crate) struct WindowsNamedPipeClient;

#[cfg(windows)]
impl WindowsNamedPipeClient {
    pub(crate) fn connect_once(name: &str) -> Result<WindowsBridgeChannel, WindowsNamedPipeError> {
        validate_pipe_name(name)?;
        let client = ClientOptions::new()
            .pipe_mode(PipeMode::Byte)
            .open(name)
            .map_err(|_| WindowsNamedPipeError::EndpointUnavailable)?;
        Ok(WindowsBridgeChannel::new(client))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_exact_attempt_scoped_pipe_names() {
        assert_eq!(
            validate_pipe_name(
                r"\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability",
            ),
            Ok(WindowsPipeEndpoint::Capability),
        );
        assert_eq!(
            validate_pipe_name(
                r"\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model",
            ),
            Ok(WindowsPipeEndpoint::Model),
        );

        for name in [
            r"\\server\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model",
            r"\\.\pipe\Actestra.Goose.0123456789abcdef0123456789abcdef.model",
            r"\\.\pipe\LOCAL\Actestra.Goose.0123456789ABCDEF0123456789ABCDEF.model",
            r"\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdeg.model",
            r"\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability.extra",
            r"\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.unknown",
        ] {
            assert_eq!(
                validate_pipe_name(name),
                Err(WindowsNamedPipeError::InvalidName),
            );
        }
    }

    #[cfg(windows)]
    mod native {
        use super::*;
        const ATTEMPT_ID: &str = "0123456789abcdef0123456789abcdef";
        use crate::windows_bridge::encode_json_frame;
        use crate::windows_supervisor::derive_pipe_names;
        use serde_json::json;
        use std::ffi::c_void;
        use std::mem::size_of;
        use std::ptr::{null, null_mut};
        use std::sync::atomic::{AtomicU32, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};
        use windows_sys::Win32::Foundation::{
            CloseHandle, GetLastError, ERROR_INSUFFICIENT_BUFFER, HANDLE,
        };
        use windows_sys::Win32::Security::Isolation::{
            CreateAppContainerProfile, DeleteAppContainerProfile,
        };
        use windows_sys::Win32::Security::{
            FreeSid, GetTokenInformation, TokenUser, PSID, TOKEN_QUERY, TOKEN_USER,
        };
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

        static PROFILE_SEQUENCE: AtomicU32 = AtomicU32::new(0);

        struct CurrentUserSid {
            token: HANDLE,
            storage: Vec<usize>,
            sid: PSID,
        }

        impl CurrentUserSid {
            fn open() -> Self {
                let mut token = null_mut();
                assert_ne!(
                    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) },
                    0,
                );
                let mut required = 0_u32;
                assert_eq!(
                    unsafe { GetTokenInformation(token, TokenUser, null_mut(), 0, &mut required) },
                    0,
                );
                assert_eq!(unsafe { GetLastError() }, ERROR_INSUFFICIENT_BUFFER);
                assert!(required as usize >= size_of::<TOKEN_USER>());
                let words = (required as usize).div_ceil(size_of::<usize>());
                let mut storage = vec![0_usize; words];
                assert_ne!(
                    unsafe {
                        GetTokenInformation(
                            token,
                            TokenUser,
                            storage.as_mut_ptr().cast::<c_void>(),
                            required,
                            &mut required,
                        )
                    },
                    0,
                );
                let sid = unsafe { (*storage.as_ptr().cast::<TOKEN_USER>()).User.Sid };
                assert!(!sid.is_null());
                Self {
                    token,
                    storage,
                    sid,
                }
            }
        }

        impl Drop for CurrentUserSid {
            fn drop(&mut self) {
                let _ = self.storage.len();
                unsafe { CloseHandle(self.token) };
            }
        }

        struct TestAppContainerProfile {
            name: Vec<u16>,
            sid: PSID,
        }

        impl TestAppContainerProfile {
            fn create() -> Self {
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos() as u64;
                let sequence = PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let profile_name = format!(
                    "Actestra.Goose.NamedPipeTest.{timestamp:016x}{:08x}{sequence:08x}",
                    std::process::id(),
                );
                let name: Vec<u16> = profile_name.encode_utf16().chain([0]).collect();
                let display: Vec<u16> = "Actestra Goose named pipe test\0".encode_utf16().collect();
                let mut sid = null_mut();
                let result = unsafe {
                    CreateAppContainerProfile(
                        name.as_ptr(),
                        display.as_ptr(),
                        display.as_ptr(),
                        null(),
                        0,
                        &mut sid,
                    )
                };
                assert!(result >= 0, "test AppContainer profile must be created");
                assert!(!sid.is_null());
                Self { name, sid }
            }
        }

        impl Drop for TestAppContainerProfile {
            fn drop(&mut self) {
                unsafe {
                    DeleteAppContainerProfile(self.name.as_ptr());
                    FreeSid(self.sid);
                }
            }
        }

        fn identities() -> (CurrentUserSid, TestAppContainerProfile) {
            (CurrentUserSid::open(), TestAppContainerProfile::create())
        }

        #[tokio::test]
        async fn owner_connects_and_acl_grants_only_owner_and_exact_appcontainer() {
            let (owner, profile) = identities();
            let names = derive_pipe_names(ATTEMPT_ID).unwrap();
            let server =
                WindowsNamedPipeServer::create(&names.capability, owner.sid, profile.sid).unwrap();
            assert!(server.security.grants_exactly(owner.sid, profile.sid));
            assert!(server.security.labels_low_integrity());

            let mut client = WindowsNamedPipeClient::connect_once(&names.capability).unwrap();
            let mut accepted = server.accept_once().await.unwrap();
            let frame = encode_json_frame(&json!({"contractVersion": 1, "kind": "test"})).unwrap();
            client.write_frame(&frame).await.unwrap();
            assert_eq!(accepted.read_frame().await.unwrap(), frame);
        }

        #[tokio::test]
        async fn rejects_a_second_client_for_the_same_endpoint() {
            let (owner, profile) = identities();
            let names = derive_pipe_names(ATTEMPT_ID).unwrap();
            let server =
                WindowsNamedPipeServer::create(&names.model, owner.sid, profile.sid).unwrap();
            let _first = WindowsNamedPipeClient::connect_once(&names.model).unwrap();
            assert!(WindowsNamedPipeClient::connect_once(&names.model).is_err());
            drop(server);
        }

        #[tokio::test]
        async fn rejects_a_wrong_attempt_derived_name() {
            let (owner, profile) = identities();
            let names = derive_pipe_names(ATTEMPT_ID).unwrap();
            let _server =
                WindowsNamedPipeServer::create(&names.model, owner.sid, profile.sid).unwrap();
            let wrong = derive_pipe_names("fedcba9876543210fedcba9876543210").unwrap();
            assert!(WindowsNamedPipeClient::connect_once(&wrong.model).is_err());
        }

        #[tokio::test]
        async fn rejects_reconnect_after_the_single_connection_closes() {
            let (owner, profile) = identities();
            let names = derive_pipe_names(ATTEMPT_ID).unwrap();
            let server =
                WindowsNamedPipeServer::create(&names.capability, owner.sid, profile.sid).unwrap();
            let client = WindowsNamedPipeClient::connect_once(&names.capability).unwrap();
            let accepted = server.accept_once().await.unwrap();
            drop(client);
            drop(accepted);
            assert!(WindowsNamedPipeClient::connect_once(&names.capability).is_err());
        }

        #[tokio::test]
        async fn capability_and_model_endpoints_do_not_cross() {
            let (owner, profile) = identities();
            let names = derive_pipe_names(ATTEMPT_ID).unwrap();
            let _capability =
                WindowsNamedPipeServer::create(&names.capability, owner.sid, profile.sid).unwrap();
            assert!(WindowsNamedPipeClient::connect_once(&names.model).is_err());
        }

        #[tokio::test]
        async fn cancelling_pending_accept_removes_the_endpoint() {
            let (owner, profile) = identities();
            let names = derive_pipe_names(ATTEMPT_ID).unwrap();
            let server =
                WindowsNamedPipeServer::create(&names.model, owner.sid, profile.sid).unwrap();
            let pending = tokio::spawn(server.accept_once());
            tokio::task::yield_now().await;
            pending.abort();
            assert!(pending.await.is_err());
            assert!(WindowsNamedPipeClient::connect_once(&names.model).is_err());
        }
    }
}
