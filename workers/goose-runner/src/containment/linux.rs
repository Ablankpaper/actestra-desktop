use std::env;
use std::ffi::CString;
use std::fs::{remove_dir_all, write};
use std::net::TcpListener;
use std::os::fd::AsRawFd;
use std::os::fd::RawFd;
use std::os::raw::c_void;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

const LANDLOCK_CREATE_RULESET_SYSCALL: libc::c_long = 444;
const LANDLOCK_ADD_RULE_SYSCALL: libc::c_long = 445;
const LANDLOCK_RESTRICT_SELF_SYSCALL: libc::c_long = 446;
const LANDLOCK_CREATE_RULESET_VERSION: libc::c_ulong = 1;
const LANDLOCK_RULE_TYPE_PATH_BENEATH: u32 = 1;
const LANDLOCK_ACCESS_FS_EXECUTE: u64 = 1 << 0;
const LANDLOCK_ACCESS_FS_WRITE_FILE: u64 = 1 << 1;
const LANDLOCK_ACCESS_FS_READ_FILE: u64 = 1 << 2;
const LANDLOCK_ACCESS_FS_READ_DIR: u64 = 1 << 3;
const LANDLOCK_ACCESS_FS_REMOVE_DIR: u64 = 1 << 4;
const LANDLOCK_ACCESS_FS_REMOVE_FILE: u64 = 1 << 5;
const LANDLOCK_ACCESS_FS_MAKE_CHAR: u64 = 1 << 6;
const LANDLOCK_ACCESS_FS_MAKE_DIR: u64 = 1 << 7;
const LANDLOCK_ACCESS_FS_MAKE_REG: u64 = 1 << 8;
const LANDLOCK_ACCESS_FS_MAKE_SOCK: u64 = 1 << 9;
const LANDLOCK_ACCESS_FS_MAKE_FIFO: u64 = 1 << 10;
const LANDLOCK_ACCESS_FS_MAKE_BLOCK: u64 = 1 << 11;
const LANDLOCK_ACCESS_FS_MAKE_SYM: u64 = 1 << 12;
const LANDLOCK_ACCESS_FS_REFER: u64 = 1 << 13;
const LANDLOCK_ACCESS_FS_TRUNCATE: u64 = 1 << 14;
const PR_SET_NO_NEW_PRIVS: libc::c_int = 38;
const PR_SET_SECCOMP: libc::c_int = 22;
const SECCOMP_MODE_FILTER: libc::c_ulong = 2;
const BPF_LD: u16 = 0x00;
const BPF_W: u16 = 0x00;
const BPF_ABS: u16 = 0x20;
const BPF_JMP: u16 = 0x05;
const BPF_JEQ: u16 = 0x10;
const BPF_JSET: u16 = 0x40;
const BPF_ALU: u16 = 0x04;
const BPF_AND: u16 = 0x50;
const BPF_K: u16 = 0x00;
const BPF_RET_K: u16 = 0x06;
const SECCOMP_RET_ERRNO: u32 = 0x0005_0000;
const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
const SECCOMP_RET_KILL_PROCESS: u32 = 0x8000_0000;
const AUDIT_ARCH_X86_64: u32 = 0xc000_003e;
const X32_SYSCALL_BIT: u32 = 0x4000_0000;
const SECCOMP_DATA_NR_OFFSET: u32 = 0;
const SECCOMP_DATA_ARCH_OFFSET: u32 = 4;
const SECCOMP_DATA_ARG0_OFFSET: u32 = 16;
const REQUIRED_THREAD_CLONE_FLAGS: u32 =
    (libc::CLONE_THREAD | libc::CLONE_SIGHAND | libc::CLONE_VM) as u32;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessProbeFailure {
    SeccompUnavailable,
    ThreadUnavailable,
    CreationNotDenied,
    ExecNotDenied,
    CleanupFailed,
}

fn process_probe_failure_code(failure: ProcessProbeFailure) -> &'static str {
    match failure {
        ProcessProbeFailure::SeccompUnavailable => "process-seccomp-unavailable",
        ProcessProbeFailure::ThreadUnavailable => "process-thread-unavailable",
        ProcessProbeFailure::CreationNotDenied => "process-creation-not-denied",
        ProcessProbeFailure::ExecNotDenied => "process-exec-not-denied",
        ProcessProbeFailure::CleanupFailed => "process-probe-cleanup-failed",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResourceProbeFailure {
    RlimitUnavailable,
    RlimitMismatch,
    RlimitWideningNotDenied,
    CleanupFailed,
}

fn resource_probe_failure_code(failure: ResourceProbeFailure) -> &'static str {
    match failure {
        ResourceProbeFailure::RlimitUnavailable => "resource-rlimit-unavailable",
        ResourceProbeFailure::RlimitMismatch => "resource-rlimit-mismatch",
        ResourceProbeFailure::RlimitWideningNotDenied => "resource-rlimit-widening-not-denied",
        ResourceProbeFailure::CleanupFailed => "resource-probe-cleanup-failed",
    }
}

#[repr(C)]
struct LandlockRulesetAttr {
    handled_access_fs: u64,
}

#[repr(C)]
struct LandlockPathBeneathAttr {
    allowed_access: u64,
    parent_fd: RawFd,
}

#[repr(C)]
struct SockFilter {
    code: u16,
    jump_true: u8,
    jump_false: u8,
    value: u32,
}

#[repr(C)]
struct SockFilterProgram {
    length: u16,
    filter: *mut SockFilter,
}

fn has_landlock_syscall() -> bool {
    let result = unsafe {
        libc::syscall(
            LANDLOCK_CREATE_RULESET_SYSCALL,
            std::ptr::null::<c_void>(),
            0_u32,
            LANDLOCK_CREATE_RULESET_VERSION,
        )
    };
    landlock_available_from_result(result)
}

fn landlock_available_from_result(result: libc::c_long) -> bool {
    result >= LANDLOCK_CREATE_RULESET_VERSION as libc::c_long
}

fn landlock_abi() -> Result<u32, &'static str> {
    let result = unsafe {
        libc::syscall(
            LANDLOCK_CREATE_RULESET_SYSCALL,
            std::ptr::null::<c_void>(),
            0_u32,
            LANDLOCK_CREATE_RULESET_VERSION,
        )
    };
    if result < LANDLOCK_CREATE_RULESET_VERSION as libc::c_long {
        return Err("landlock-abi");
    }
    u32::try_from(result).map_err(|_| "landlock-abi-overflow")
}

fn setup_user_and_mount_namespace() -> Result<(), &'static str> {
    let uid = unsafe { libc::getuid() };
    let gid = unsafe { libc::getgid() };
    if unsafe { libc::unshare(libc::CLONE_NEWUSER) } != 0 {
        return Err("user-namespace");
    }
    if Path::new("/proc/self/setgroups").exists() {
        write("/proc/self/setgroups", b"deny").map_err(|_| "setgroups")?;
    }
    write("/proc/self/uid_map", format!("0 {uid} 1")).map_err(|_| "uid-map")?;
    write("/proc/self/gid_map", format!("0 {gid} 1")).map_err(|_| "gid-map")?;
    if unsafe { libc::unshare(libc::CLONE_NEWNS) } != 0 {
        return Err("mount-namespace");
    }
    let root = CString::new("/").map_err(|_| "mount-path")?;
    if unsafe {
        libc::mount(
            std::ptr::null(),
            root.as_ptr(),
            std::ptr::null(),
            (libc::MS_REC | libc::MS_PRIVATE) as libc::c_ulong,
            std::ptr::null(),
        )
    } != 0
    {
        return Err("mount-private");
    }
    Ok(())
}

fn open_directory(path: &Path) -> Result<RawFd, &'static str> {
    let bytes = path.as_os_str().as_bytes();
    let path = CString::new(bytes).map_err(|_| "path-nul")?;
    let fd = unsafe {
        libc::open(
            path.as_ptr(),
            libc::O_PATH | libc::O_CLOEXEC | libc::O_DIRECTORY,
        )
    };
    if fd < 0 {
        return Err("open-root");
    }
    Ok(fd)
}

fn add_landlock_path_rule(
    ruleset_fd: RawFd,
    parent_fd: RawFd,
    allowed_access: u64,
) -> Result<(), &'static str> {
    let rule = LandlockPathBeneathAttr {
        allowed_access,
        parent_fd,
    };
    let result = unsafe {
        libc::syscall(
            LANDLOCK_ADD_RULE_SYSCALL,
            ruleset_fd,
            LANDLOCK_RULE_TYPE_PATH_BENEATH,
            &rule as *const LandlockPathBeneathAttr,
            0_u32,
        )
    };
    if result != 0 {
        return Err("landlock-add-rule");
    }
    Ok(())
}

fn landlock_restrict_self(ruleset_fd: RawFd) -> Result<(), &'static str> {
    if unsafe { libc::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err("no-new-privs");
    }
    let result = unsafe { libc::syscall(LANDLOCK_RESTRICT_SELF_SYSCALL, ruleset_fd, 0_u32) };
    if result != 0 {
        return Err("landlock-restrict");
    }
    Ok(())
}

fn prepare_linux_filesystem_containment_with_failure(
    private_root: &Path,
    workspace_root: &Path,
) -> Result<(), &'static str> {
    setup_user_and_mount_namespace()?;
    let abi = landlock_abi()?;
    // REFER is required to prevent rename/link escapes. Kernels without ABI 2
    // cannot express the required closed filesystem contract.
    if abi < 2 {
        return Err("landlock-abi-too-old");
    }
    let mut handled_access = LANDLOCK_ACCESS_FS_EXECUTE
        | LANDLOCK_ACCESS_FS_WRITE_FILE
        | LANDLOCK_ACCESS_FS_READ_FILE
        | LANDLOCK_ACCESS_FS_READ_DIR
        | LANDLOCK_ACCESS_FS_REMOVE_DIR
        | LANDLOCK_ACCESS_FS_REMOVE_FILE
        | LANDLOCK_ACCESS_FS_MAKE_CHAR
        | LANDLOCK_ACCESS_FS_MAKE_DIR
        | LANDLOCK_ACCESS_FS_MAKE_REG
        | LANDLOCK_ACCESS_FS_MAKE_SOCK
        | LANDLOCK_ACCESS_FS_MAKE_FIFO
        | LANDLOCK_ACCESS_FS_MAKE_BLOCK
        | LANDLOCK_ACCESS_FS_MAKE_SYM
        | LANDLOCK_ACCESS_FS_REFER;
    if abi >= 3 {
        handled_access |= LANDLOCK_ACCESS_FS_TRUNCATE;
    }
    let ruleset = LandlockRulesetAttr {
        handled_access_fs: handled_access,
    };
    let ruleset_fd = unsafe {
        libc::syscall(
            LANDLOCK_CREATE_RULESET_SYSCALL,
            &ruleset as *const LandlockRulesetAttr,
            std::mem::size_of::<LandlockRulesetAttr>(),
            0_u32,
        )
    };
    if ruleset_fd < 0 {
        return Err("landlock-ruleset");
    }
    let private_fd = open_directory(private_root);
    let workspace_fd = open_directory(workspace_root);
    let result = match (private_fd, workspace_fd) {
        (Ok(private_fd), Ok(workspace_fd)) => {
            let private_access = handled_access;
            let workspace_access = LANDLOCK_ACCESS_FS_EXECUTE
                | LANDLOCK_ACCESS_FS_READ_FILE
                | LANDLOCK_ACCESS_FS_READ_DIR;
            let result = add_landlock_path_rule(ruleset_fd as RawFd, private_fd, private_access)
                .and_then(|_| {
                    add_landlock_path_rule(ruleset_fd as RawFd, workspace_fd, workspace_access)
                })
                .and_then(|_| landlock_restrict_self(ruleset_fd as RawFd));
            unsafe {
                libc::close(private_fd);
                libc::close(workspace_fd);
            }
            result
        }
        (private_fd, workspace_fd) => {
            if let Ok(fd) = private_fd {
                unsafe { libc::close(fd) };
            }
            if let Ok(fd) = workspace_fd {
                unsafe { libc::close(fd) };
            }
            Err("open-root")
        }
    };
    unsafe {
        libc::close(ruleset_fd as RawFd);
    }
    result
}

fn run_filesystem_probe() -> bool {
    let root = env::temp_dir().join(format!("actestra-goose-containment-{}", unsafe {
        libc::getpid()
    }));
    let private_root = root.join("private");
    let workspace_root = root.join("workspace");
    if std::fs::create_dir_all(&private_root).is_err()
        || std::fs::create_dir_all(&workspace_root).is_err()
        || std::fs::write(workspace_root.join("input.txt"), b"workspace").is_err()
    {
        let _ = std::fs::remove_dir_all(&root);
        return false;
    }
    let child = unsafe { libc::fork() };
    if child < 0 {
        let _ = std::fs::remove_dir_all(&root);
        return false;
    }
    if child == 0 {
        if let Err(reason) =
            prepare_linux_filesystem_containment_with_failure(&private_root, &workspace_root)
        {
            unsafe { libc::_exit(10 + filesystem_failure_code(reason)) };
        }
        let success = std::fs::write(private_root.join("inside.txt"), b"private").is_ok()
            && std::fs::read(private_root.join("inside.txt"))
                .map(|bytes| bytes == b"private")
                .unwrap_or(false)
            && std::fs::read(workspace_root.join("input.txt"))
                .map(|bytes| bytes == b"workspace")
                .unwrap_or(false)
            && std::fs::read("/etc/passwd").is_err()
            && std::fs::write(workspace_root.join("forbidden.txt"), b"blocked").is_err()
            && std::fs::write(root.join("outside-root.txt"), b"blocked").is_err()
            && std::os::unix::fs::symlink("/etc/passwd", private_root.join("escape")).is_ok()
            && std::fs::read(private_root.join("escape")).is_err();
        unsafe { libc::_exit(if success { 0 } else { 1 }) };
    }
    let mut status = 0;
    let waited = unsafe { libc::waitpid(child, &mut status, 0) } == child;
    let exit_code = if waited && libc::WIFEXITED(status) {
        libc::WEXITSTATUS(status)
    } else {
        -1
    };
    if env::var("ACTESTRA_GOOSE_CONTAINMENT_DEBUG").as_deref() == Ok("1") && exit_code != 0 {
        eprintln!("Goose filesystem probe failed at bounded stage {exit_code}");
    }
    let success = exit_code == 0;
    let cleaned = std::fs::remove_dir_all(&root).is_ok() && !root.exists();
    success && cleaned
}

fn filesystem_failure_code(reason: &str) -> i32 {
    match reason {
        "user-namespace" => 1,
        "setgroups" => 2,
        "uid-map" => 3,
        "gid-map" => 4,
        "mount-namespace" => 5,
        "mount-path" => 6,
        "mount-private" => 7,
        "landlock-abi" => 8,
        "landlock-abi-overflow" => 9,
        "landlock-abi-too-old" => 10,
        "ruleset" | "landlock-ruleset" => 11,
        "open-root" => 12,
        "landlock-add-rule" => 13,
        "no-new-privs" => 14,
        "landlock-restrict" => 15,
        "path-nul" => 16,
        "seccomp-install-permission" => 17,
        "seccomp-install-invalid" => 18,
        "seccomp-install-pointer" => 19,
        "seccomp-install-unavailable" => 20,
        _ => 99,
    }
}

fn bpf_statement(code: u16, value: u32) -> SockFilter {
    SockFilter {
        code,
        jump_true: 0,
        jump_false: 0,
        value,
    }
}

fn bpf_jump(code: u16, value: u32, jump_true: u8, jump_false: u8) -> SockFilter {
    SockFilter {
        code,
        jump_true,
        jump_false,
        value,
    }
}

fn process_creation_filter() -> Vec<SockFilter> {
    vec![
        bpf_statement(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARCH_OFFSET),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
        bpf_statement(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
        bpf_statement(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_NR_OFFSET),
        bpf_jump(BPF_JMP | BPF_JSET | BPF_K, X32_SYSCALL_BIT, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_clone as u32, 0, 5),
        bpf_statement(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARG0_OFFSET),
        bpf_statement(BPF_ALU | BPF_AND | BPF_K, REQUIRED_THREAD_CLONE_FLAGS),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, REQUIRED_THREAD_CLONE_FLAGS, 1, 0),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ALLOW),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_clone3 as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::ENOSYS as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_fork as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_vfork as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_execve as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_execveat as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ALLOW),
    ]
}

pub(crate) fn install_process_creation_filter() -> Result<(), &'static str> {
    if unsafe { libc::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } != 0 {
        return Err("seccomp-no-new-privs");
    }
    let mut filter = process_creation_filter();
    let length = u16::try_from(filter.len()).map_err(|_| "seccomp-filter-too-large")?;
    let mut program = SockFilterProgram {
        length,
        filter: filter.as_mut_ptr(),
    };
    if unsafe {
        libc::prctl(
            PR_SET_SECCOMP,
            SECCOMP_MODE_FILTER,
            &mut program as *mut SockFilterProgram,
            0,
            0,
        )
    } != 0
    {
        return Err(match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::EPERM) => "seccomp-install-permission",
            Some(libc::EINVAL) => "seccomp-install-invalid",
            Some(libc::EFAULT) => "seccomp-install-pointer",
            Some(libc::ENOSYS) => "seccomp-install-unavailable",
            _ => "seccomp-install",
        });
    }
    Ok(())
}

fn syscall_errno(result: libc::c_long, expected: i32) -> bool {
    result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(expected)
}

fn wait_for_child_exit(child: libc::pid_t) -> Option<i32> {
    let mut status = 0;
    loop {
        let waited = unsafe { libc::waitpid(child, &mut status, 0) };
        if waited == child {
            return libc::WIFEXITED(status).then(|| libc::WEXITSTATUS(status));
        }
        if waited < 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
            continue;
        }
        unsafe {
            libc::kill(child, libc::SIGKILL);
            libc::waitpid(child, std::ptr::null_mut(), 0);
        }
        return None;
    }
}

fn finish_creation_probe(result: libc::c_long) -> bool {
    if result == 0 {
        unsafe { libc::_exit(80) };
    }
    if result > 0 {
        let _ = wait_for_child_exit(result as libc::pid_t);
        return false;
    }
    syscall_errno(result, libc::EPERM)
}

fn run_process_tree_probe() -> bool {
    let child = unsafe { libc::fork() };
    if child < 0 {
        return false;
    }
    if child == 0 {
        if install_process_creation_filter().is_err() {
            unsafe { libc::_exit(20) };
        }
        if std::thread::spawn(|| 7_u8).join() != Ok(7_u8) {
            unsafe { libc::_exit(21) };
        }

        let clone_result = unsafe { libc::syscall(libc::SYS_clone, libc::SIGCHLD, 0, 0, 0, 0) };
        if !finish_creation_probe(clone_result)
            || !finish_creation_probe(unsafe { libc::syscall(libc::SYS_fork) })
            || !finish_creation_probe(unsafe { libc::syscall(libc::SYS_vfork) })
            || !syscall_errno(
                unsafe { libc::syscall(libc::SYS_clone3, std::ptr::null::<c_void>(), 0) },
                libc::ENOSYS,
            )
        {
            unsafe { libc::_exit(22) };
        }

        let executable = match CString::new("/bin/false") {
            Ok(value) => value,
            Err(_) => unsafe { libc::_exit(23) },
        };
        let argv = [executable.as_ptr(), std::ptr::null()];
        let envp = [std::ptr::null::<libc::c_char>()];
        let execve = unsafe {
            libc::syscall(
                libc::SYS_execve,
                executable.as_ptr(),
                argv.as_ptr(),
                envp.as_ptr(),
            )
        };
        if !syscall_errno(execve, libc::EPERM) {
            unsafe { libc::_exit(23) };
        }
        let execveat = unsafe {
            libc::syscall(
                libc::SYS_execveat,
                libc::AT_FDCWD,
                executable.as_ptr(),
                argv.as_ptr(),
                envp.as_ptr(),
                0,
            )
        };
        if !syscall_errno(execveat, libc::EPERM) {
            unsafe { libc::_exit(23) };
        }
        unsafe { libc::_exit(0) };
    }
    let failure = match wait_for_child_exit(child) {
        Some(0) => None,
        Some(20) => Some(ProcessProbeFailure::SeccompUnavailable),
        Some(21) => Some(ProcessProbeFailure::ThreadUnavailable),
        Some(22 | 80) => Some(ProcessProbeFailure::CreationNotDenied),
        Some(1 | 23) => Some(ProcessProbeFailure::ExecNotDenied),
        _ => Some(ProcessProbeFailure::CleanupFailed),
    };
    if let Some(failure) = failure {
        if env::var("ACTESTRA_GOOSE_CONTAINMENT_DEBUG").as_deref() == Ok("1") {
            eprintln!(
                "Goose process-tree probe failed at bounded stage {}",
                process_probe_failure_code(failure)
            );
        }
        return false;
    }
    true
}

fn connect_ipv4(address: [u8; 4], port: u16) -> bool {
    let socket = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    if socket < 0 {
        return false;
    }
    let timeout = libc::timeval {
        tv_sec: 0,
        tv_usec: 250_000,
    };
    let timeout_result = unsafe {
        libc::setsockopt(
            socket,
            libc::SOL_SOCKET,
            libc::SO_SNDTIMEO,
            (&timeout as *const libc::timeval).cast::<c_void>(),
            std::mem::size_of::<libc::timeval>() as libc::socklen_t,
        )
    };
    let sockaddr = libc::sockaddr_in {
        sin_family: libc::AF_INET as libc::sa_family_t,
        sin_port: port.to_be(),
        sin_addr: libc::in_addr {
            s_addr: u32::from_ne_bytes(address),
        },
        sin_zero: [0; 8],
    };
    let connected = timeout_result == 0
        && unsafe {
            libc::connect(
                socket,
                (&sockaddr as *const libc::sockaddr_in).cast::<libc::sockaddr>(),
                std::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t,
            )
        } == 0;
    unsafe { libc::close(socket) };
    connected
}

fn run_network_isolation_probe() -> bool {
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(listener) => listener,
        Err(_) => return false,
    };
    let local_port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(_) => return false,
    };
    let child = unsafe { libc::fork() };
    if child < 0 {
        return false;
    }
    if child == 0 {
        // The inherited listener belongs to the parent namespace. It is closed
        // before entering the isolated namespace so it cannot become a bridge.
        unsafe { libc::close(listener.as_raw_fd()) };
        let flags = (libc::CLONE_NEWUSER | libc::CLONE_NEWNET) as libc::c_int;
        if unsafe { libc::unshare(flags) } != 0 {
            unsafe { libc::_exit(10) };
        }
        let unrelated_localhost = connect_ipv4([127, 0, 0, 1], local_port);
        let external_dns = connect_ipv4([8, 8, 8, 8], 53);
        let external_http = connect_ipv4([1, 1, 1, 1], 80);
        unsafe {
            libc::_exit(if !unrelated_localhost && !external_dns && !external_http {
                0
            } else {
                11
            });
        }
    }
    let mut status = 0;
    (unsafe { libc::waitpid(child, &mut status, 0) }) == child
        && libc::WIFEXITED(status)
        && libc::WEXITSTATUS(status) == 0
}

fn hard_limit_cannot_be_raised(resource: libc::__rlimit_resource_t, limit: libc::rlimit) -> bool {
    let Some(raised_max) = limit.rlim_max.checked_add(1) else {
        return false;
    };
    let raised = libc::rlimit {
        rlim_cur: limit.rlim_cur,
        rlim_max: raised_max,
    };
    (unsafe { libc::setrlimit(resource, &raised) }) != 0
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn run_rlimit_resource_probe() -> Result<(), ResourceProbeFailure> {
    let child = unsafe { libc::fork() };
    if child < 0 {
        return Err(ResourceProbeFailure::CleanupFailed);
    }
    if child == 0 {
        env::set_var(
            super::CPU_LIMIT_ENVIRONMENT_KEY,
            super::CPU_LIMIT_SECONDS.to_string(),
        );
        env::set_var(
            super::ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY,
            super::ADDRESS_SPACE_LIMIT_BYTES.to_string(),
        );
        let limits = match super::parse_resource_limits_with(|key| env::var(key).ok()) {
            Ok(value) => value,
            Err(()) => unsafe { libc::_exit(20) },
        };
        let baseline = match super::unix::current_virtual_size_bytes() {
            Ok(value) => value,
            Err(()) => unsafe { libc::_exit(20) },
        };
        let expected_address_space = match baseline.checked_add(super::ADDRESS_SPACE_LIMIT_BYTES) {
            Some(value) => value,
            None => unsafe { libc::_exit(20) },
        };
        if super::unix::apply_resource_limits_with(limits, baseline, |resource, soft, hard| {
            let limit = libc::rlimit {
                rlim_cur: soft as libc::rlim_t,
                rlim_max: hard as libc::rlim_t,
            };
            unsafe { libc::setrlimit(resource as _, &limit) }
        })
        .is_err()
        {
            unsafe { libc::_exit(20) };
        }
        let mut cpu = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        let mut address_space = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        let read_exact = unsafe {
            libc::getrlimit(libc::RLIMIT_CPU, &mut cpu) == 0
                && libc::getrlimit(libc::RLIMIT_AS, &mut address_space) == 0
                && cpu.rlim_cur == super::CPU_LIMIT_SECONDS
                && cpu.rlim_max == super::CPU_LIMIT_SECONDS
                && address_space.rlim_cur == expected_address_space
                && address_space.rlim_max == expected_address_space
        };
        if !read_exact {
            unsafe { libc::_exit(21) };
        }
        if !hard_limit_cannot_be_raised(libc::RLIMIT_CPU, cpu)
            || !hard_limit_cannot_be_raised(libc::RLIMIT_AS, address_space)
        {
            unsafe { libc::_exit(22) };
        }
        unsafe { libc::_exit(0) };
    }
    match wait_for_child_exit(child) {
        Some(0) => Ok(()),
        Some(20) => Err(ResourceProbeFailure::RlimitUnavailable),
        Some(21) => Err(ResourceProbeFailure::RlimitMismatch),
        Some(22) => Err(ResourceProbeFailure::RlimitWideningNotDenied),
        _ => Err(ResourceProbeFailure::CleanupFailed),
    }
}

fn run_resource_probe() -> bool {
    if let Err(failure) = run_rlimit_resource_probe() {
        if env::var("ACTESTRA_GOOSE_CONTAINMENT_DEBUG").as_deref() == Ok("1") {
            eprintln!(
                "Goose resource probe failed at bounded stage {}",
                resource_probe_failure_code(failure)
            );
        }
        return false;
    }
    true
}

fn run_parent_death_probe() -> bool {
    let mut pipe_fds = [0; 2];
    if unsafe { libc::pipe(pipe_fds.as_mut_ptr()) } != 0 {
        return false;
    }
    let child = unsafe { libc::fork() };
    if child < 0 {
        unsafe {
            libc::close(pipe_fds[0]);
            libc::close(pipe_fds[1]);
        }
        return false;
    }
    if child == 0 {
        unsafe { libc::close(pipe_fds[1]) };
        env::set_var("ACTESTRA_PARENT_LIVENESS_FD", pipe_fds[0].to_string());
        super::unix::watch_parent_liveness();
        thread::sleep(Duration::from_secs(2));
        unsafe { libc::_exit(30) };
    }
    unsafe {
        libc::close(pipe_fds[0]);
        libc::close(pipe_fds[1]);
    }
    for _ in 0..200 {
        let mut status = 0;
        let waited = unsafe { libc::waitpid(child, &mut status, libc::WNOHANG) };
        if waited == child {
            return libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0;
        }
        if waited < 0 {
            return false;
        }
        thread::sleep(Duration::from_millis(10));
    }
    unsafe {
        libc::kill(child, libc::SIGKILL);
        libc::waitpid(child, std::ptr::null_mut(), 0);
    }
    false
}

fn run_cleanup_probe() -> bool {
    let directory = PathBuf::from(env::temp_dir())
        .join(format!("actestra-goose-probe-{}", unsafe {
            libc::getpid()
        }));
    if std::fs::create_dir_all(directory.join("nested/deeper")).is_err()
        || std::fs::write(directory.join("nested/deeper/output"), b"bounded").is_err()
    {
        let _ = remove_dir_all(&directory);
        return false;
    }
    if remove_dir_all(&directory).is_err() || directory.exists() {
        let _ = remove_dir_all(&directory);
        return false;
    }
    matches!(remove_dir_all(&directory), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
}

fn is_hex(value: &str, expected_length: usize) -> bool {
    value.len() == expected_length
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn bounded_target(value: Option<String>) -> String {
    value
        .filter(|candidate| {
            !candidate.is_empty()
                && candidate.len() <= 128
                && candidate
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
        .unwrap_or_default()
}

fn bounded_hex(value: Option<String>, expected_length: usize) -> String {
    value
        .filter(|candidate| is_hex(candidate, expected_length))
        .unwrap_or_default()
}

pub(crate) fn run_linux_containment_probe() -> String {
    let target_triple = bounded_target(env::var("ACTESTRA_GOOSE_TARGET_TRIPLE").ok());
    let source_commit = bounded_hex(env::var("ACTESTRA_GOOSE_SOURCE_COMMIT").ok(), 40);
    let probe_sha256 = bounded_hex(env::var("ACTESTRA_GOOSE_PROBE_SHA256").ok(), 64);
    let executable_sha256 = bounded_hex(env::var("ACTESTRA_GOOSE_EXECUTABLE_SHA256").ok(), 64);
    let filesystem_available = has_landlock_syscall() && run_filesystem_probe();
    let network_namespace_available = run_network_isolation_probe();
    let process_tree_available = run_process_tree_probe();
    let resources_available = run_resource_probe();
    let parent_death_available = run_parent_death_probe();
    let cleanup = run_cleanup_probe();
    let complete = false;
    format!(
        "{{\"contractVersion\":1,\"targetTriple\":\"{}\",\"sourceCommit\":\"{}\",\"probeSha256\":\"{}\",\"executableSha256\":\"{}\",\"filesystem\":{},\"network\":{},\"processTree\":{},\"resources\":{},\"parentDeath\":{},\"cleanup\":{},\"status\":\"{}\"}}",
        target_triple,
        source_commit,
        probe_sha256,
        executable_sha256,
        filesystem_available,
        network_namespace_available,
        process_tree_available,
        resources_available,
        parent_death_available,
        cleanup,
        if complete { "verified" } else { "evidence-incomplete" },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_hex, bounded_target, landlock_available_from_result, process_creation_filter,
        resource_probe_failure_code, run_cleanup_probe, run_parent_death_probe,
        run_process_tree_probe, run_resource_probe, ResourceProbeFailure, AUDIT_ARCH_X86_64,
        BPF_ALU, BPF_AND, BPF_JEQ, BPF_JMP, BPF_JSET, BPF_K, REQUIRED_THREAD_CLONE_FLAGS,
        SECCOMP_DATA_ARCH_OFFSET, SECCOMP_RET_ALLOW, SECCOMP_RET_ERRNO, SECCOMP_RET_KILL_PROCESS,
        X32_SYSCALL_BIT,
    };

    #[test]
    fn landlock_requires_a_positive_abi_result() {
        assert!(landlock_available_from_result(1));
        assert!(landlock_available_from_result(2));
        assert!(!landlock_available_from_result(0));
        assert!(!landlock_available_from_result(-1));
        assert!(!landlock_available_from_result(-13));
    }

    #[test]
    fn probe_metadata_accepts_only_bounded_safe_values() {
        assert_eq!(
            bounded_target(Some("x86_64-unknown-linux-gnu".to_string())),
            "x86_64-unknown-linux-gnu"
        );
        assert_eq!(bounded_target(Some("/private/path".to_string())), "");
        assert_eq!(bounded_target(Some("quoted\"value".to_string())), "");
        assert_eq!(bounded_hex(Some("a".repeat(40)), 40), "a".repeat(40));
        assert_eq!(bounded_hex(Some("A".repeat(40)), 40), "");
        assert_eq!(bounded_hex(Some("not-a-digest".to_string()), 64), "");
    }

    #[test]
    fn process_filter_guards_architecture_x32_and_thread_clone_flags() {
        let filter = process_creation_filter();
        assert_eq!(filter.len(), 23);
        assert_eq!(filter[0].value, SECCOMP_DATA_ARCH_OFFSET);
        assert_eq!(filter[1].value, AUDIT_ARCH_X86_64);
        assert_eq!(filter[2].value, SECCOMP_RET_KILL_PROCESS);
        assert_eq!(filter[4].code, BPF_JMP | BPF_JSET | BPF_K);
        assert_eq!(filter[4].value, X32_SYSCALL_BIT);
        assert_eq!(filter[8].code, BPF_ALU | BPF_AND | BPF_K);
        assert_eq!(filter[8].value, REQUIRED_THREAD_CLONE_FLAGS);
        assert_eq!(filter[13].value, SECCOMP_RET_ERRNO | libc::ENOSYS as u32);
        for index in [10, 15, 17, 19, 21] {
            assert_eq!(filter[index].value, SECCOMP_RET_ERRNO | libc::EPERM as u32);
        }
        assert_eq!(filter[22].value, SECCOMP_RET_ALLOW);
    }

    #[test]
    fn native_process_tree_stage_is_a_hostile_probe() {
        assert!(run_process_tree_probe());
    }

    #[test]
    fn native_resource_stage_is_a_hostile_probe() {
        assert!(run_resource_probe());
    }

    #[test]
    fn native_parent_death_stage_is_a_hostile_probe() {
        assert!(run_parent_death_probe());
    }

    #[test]
    fn native_cleanup_stage_is_a_hostile_probe() {
        assert!(run_cleanup_probe());
    }

    #[test]
    fn resource_failure_diagnostics_are_closed_and_redacted() {
        let expected = [
            (
                ResourceProbeFailure::RlimitUnavailable,
                "resource-rlimit-unavailable",
            ),
            (
                ResourceProbeFailure::RlimitMismatch,
                "resource-rlimit-mismatch",
            ),
            (
                ResourceProbeFailure::RlimitWideningNotDenied,
                "resource-rlimit-widening-not-denied",
            ),
            (
                ResourceProbeFailure::CleanupFailed,
                "resource-probe-cleanup-failed",
            ),
        ];
        for (failure, code) in expected {
            assert_eq!(resource_probe_failure_code(failure), code);
            assert!(!code.contains('/'));
            assert!(!code.contains(' '));
        }
    }
}
