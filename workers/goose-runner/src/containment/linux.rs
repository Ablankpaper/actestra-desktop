use std::env;
use std::ffi::CString;
use std::fs::{create_dir, read_to_string, remove_dir, remove_dir_all, write};
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
const CGROUP_V2_ROOT: &str = "/sys/fs/cgroup";
const CGROUP_CPU_CONTROLLER: &str = "cpu";
const CGROUP_MEMORY_CONTROLLER: &str = "memory";
const CGROUP_PIDS_CONTROLLER: &str = "pids";
const CGROUP2_SUPER_MAGIC: u64 = 0x6367_7270;
// This is a probe-only supplemental rate cap. The fixed 120 CPU-second
// contract remains enforced by RLIMIT_CPU; cpu.max has no cumulative-seconds
// semantic and is never treated as a replacement for that limit.
const CGROUP_PROBE_CPU_MAX: &str = "100000 100000";

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
    CgroupV2Unavailable,
    CgroupPathInvalid,
    CgroupControllerUnavailable,
    CgroupControllerNotDelegated,
    CgroupCreateFailed,
    CgroupAttachFailed,
    CgroupBaselineInvalid,
    CgroupLimitFailed,
    CgroupFilesystemBoundaryUnavailable,
    CgroupWideningNotDenied,
    ProcessCountNotEnforced,
    CgroupWaitFailed,
    CgroupCleanupFailed,
}

fn resource_probe_failure_code(failure: ResourceProbeFailure) -> &'static str {
    match failure {
        ResourceProbeFailure::RlimitUnavailable => "resource-rlimit-unavailable",
        ResourceProbeFailure::CgroupV2Unavailable => "resource-cgroup-v2-unavailable",
        ResourceProbeFailure::CgroupPathInvalid => "resource-cgroup-path-invalid",
        ResourceProbeFailure::CgroupControllerUnavailable => {
            "resource-cgroup-controller-unavailable"
        }
        ResourceProbeFailure::CgroupControllerNotDelegated => {
            "resource-cgroup-controller-not-delegated"
        }
        ResourceProbeFailure::CgroupCreateFailed => "resource-cgroup-create-failed",
        ResourceProbeFailure::CgroupAttachFailed => "resource-cgroup-attach-failed",
        ResourceProbeFailure::CgroupBaselineInvalid => "resource-cgroup-baseline-invalid",
        ResourceProbeFailure::CgroupLimitFailed => "resource-cgroup-limit-failed",
        ResourceProbeFailure::CgroupFilesystemBoundaryUnavailable => {
            "resource-cgroup-filesystem-boundary-unavailable"
        }
        ResourceProbeFailure::CgroupWideningNotDenied => "resource-cgroup-widening-not-denied",
        ResourceProbeFailure::ProcessCountNotEnforced => "resource-process-count-not-enforced",
        ResourceProbeFailure::CgroupWaitFailed => "resource-cgroup-wait-failed",
        ResourceProbeFailure::CgroupCleanupFailed => "resource-cgroup-cleanup-failed",
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

fn parse_unified_cgroup_path(value: &str) -> Result<String, ResourceProbeFailure> {
    let mut unified_path = None;
    for line in value.lines() {
        let mut fields = line.splitn(3, ':');
        let hierarchy = fields.next();
        let controllers = fields.next();
        let path = fields.next();
        if hierarchy == Some("0") && controllers == Some("") {
            let path = path.ok_or(ResourceProbeFailure::CgroupPathInvalid)?;
            if !path.starts_with('/')
                || path
                    .split('/')
                    .any(|component| component == "." || component == "..")
            {
                return Err(ResourceProbeFailure::CgroupPathInvalid);
            }
            if unified_path.replace(path.to_string()).is_some() {
                return Err(ResourceProbeFailure::CgroupPathInvalid);
            }
        }
    }
    unified_path.ok_or(ResourceProbeFailure::CgroupV2Unavailable)
}

fn has_controller(value: &str, controller: &str) -> bool {
    value.split_whitespace().any(|item| item == controller)
}

fn memory_limit_from_baseline(baseline: u64) -> Result<u64, ResourceProbeFailure> {
    baseline
        .checked_add(super::ADDRESS_SPACE_LIMIT_BYTES)
        .ok_or(ResourceProbeFailure::CgroupBaselineInvalid)
}

fn is_cgroup_v2_mount(root: &Path) -> bool {
    let bytes = root.as_os_str().as_bytes();
    let Ok(path) = CString::new(bytes) else {
        return false;
    };
    let mut stats = std::mem::MaybeUninit::<libc::statfs>::zeroed();
    let result = unsafe { libc::statfs(path.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 {
        return false;
    }
    let stats = unsafe { stats.assume_init() };
    stats.f_type as u64 == CGROUP2_SUPER_MAGIC
}

fn current_cgroup_directory() -> Result<PathBuf, ResourceProbeFailure> {
    let membership = read_to_string("/proc/self/cgroup")
        .map_err(|_| ResourceProbeFailure::CgroupV2Unavailable)?;
    let relative = parse_unified_cgroup_path(&membership)?;
    let root = std::fs::canonicalize(CGROUP_V2_ROOT)
        .map_err(|_| ResourceProbeFailure::CgroupV2Unavailable)?;
    if !is_cgroup_v2_mount(&root) {
        return Err(ResourceProbeFailure::CgroupV2Unavailable);
    }
    let relative = relative.trim_start_matches('/');
    let directory = std::fs::canonicalize(root.join(relative))
        .map_err(|_| ResourceProbeFailure::CgroupPathInvalid)?;
    if !directory.starts_with(&root) {
        return Err(ResourceProbeFailure::CgroupPathInvalid);
    }
    Ok(directory)
}

fn require_delegated_controllers(directory: &Path) -> Result<(), ResourceProbeFailure> {
    let available = read_to_string(directory.join("cgroup.controllers"))
        .map_err(|_| ResourceProbeFailure::CgroupControllerUnavailable)?;
    let subtree = read_to_string(directory.join("cgroup.subtree_control"))
        .map_err(|_| ResourceProbeFailure::CgroupControllerNotDelegated)?;
    for controller in [
        CGROUP_CPU_CONTROLLER,
        CGROUP_MEMORY_CONTROLLER,
        CGROUP_PIDS_CONTROLLER,
    ] {
        if !has_controller(&available, controller) {
            return Err(ResourceProbeFailure::CgroupControllerUnavailable);
        }
        if !has_controller(&subtree, controller) {
            return Err(ResourceProbeFailure::CgroupControllerNotDelegated);
        }
    }
    Ok(())
}

fn parse_decimal_control(
    value: &str,
    failure: ResourceProbeFailure,
) -> Result<u64, ResourceProbeFailure> {
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(failure);
    }
    value.parse::<u64>().map_err(|_| failure)
}

fn write_cgroup_control(path: &Path, value: &str) -> Result<(), ResourceProbeFailure> {
    write(path, value.as_bytes()).map_err(|_| ResourceProbeFailure::CgroupLimitFailed)
}

fn terminate_and_wait(child: libc::pid_t) {
    unsafe {
        libc::kill(child, libc::SIGKILL);
        libc::waitpid(child, std::ptr::null_mut(), 0);
    }
}

fn cleanup_cgroup_probe_ownership(group: &Path, root: &Path) -> Result<(), ResourceProbeFailure> {
    let group_removed = match remove_dir(group) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => !group.exists(),
        Err(_) => false,
    };
    let root_removed = match remove_dir_all(root) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    } && !root.exists();
    if group_removed && root_removed {
        Ok(())
    } else {
        Err(ResourceProbeFailure::CgroupCleanupFailed)
    }
}

fn run_cgroup_v2_resource_probe() -> Result<(), ResourceProbeFailure> {
    let current = current_cgroup_directory()?;
    require_delegated_controllers(&current)?;
    let group = current.join(format!("actestra-goose-probe-{}", unsafe {
        libc::getpid()
    }));
    create_dir(&group).map_err(|_| ResourceProbeFailure::CgroupCreateFailed)?;
    let root = env::temp_dir().join(format!("actestra-goose-cgroup-{}", unsafe {
        libc::getpid()
    }));
    let private_root = root.join("private");
    let workspace_root = root.join("workspace");

    let mut pipe_fds = [0; 2];
    if unsafe { libc::pipe(pipe_fds.as_mut_ptr()) } != 0 {
        return cleanup_cgroup_probe_ownership(&group, &root)
            .and(Err(ResourceProbeFailure::CgroupCreateFailed));
    }
    if std::fs::create_dir_all(&private_root).is_err()
        || std::fs::create_dir_all(&workspace_root).is_err()
    {
        unsafe {
            libc::close(pipe_fds[0]);
            libc::close(pipe_fds[1]);
        }
        return cleanup_cgroup_probe_ownership(&group, &root)
            .and(Err(ResourceProbeFailure::CgroupCreateFailed));
    }

    let child = unsafe { libc::fork() };
    if child < 0 {
        unsafe {
            libc::close(pipe_fds[0]);
            libc::close(pipe_fds[1]);
        }
        return cleanup_cgroup_probe_ownership(&group, &root)
            .and(Err(ResourceProbeFailure::CgroupCreateFailed));
    }
    if child == 0 {
        unsafe { libc::close(pipe_fds[1]) };
        let mut ready = [0_u8; 1];
        let read_result = unsafe {
            libc::read(
                pipe_fds[0],
                ready.as_mut_ptr().cast::<c_void>(),
                ready.len(),
            )
        };
        unsafe { libc::close(pipe_fds[0]) };
        if read_result != 1 {
            unsafe { libc::_exit(20) };
        }
        if prepare_linux_filesystem_containment_with_failure(&private_root, &workspace_root)
            .is_err()
        {
            unsafe { libc::_exit(21) };
        }
        let widening_denied = write(group.join("cpu.max"), b"max 100000").is_err()
            && write(group.join("memory.max"), b"max").is_err()
            && write(group.join("pids.max"), b"max").is_err();
        if !widening_denied {
            unsafe { libc::_exit(22) };
        }
        let fork_result = unsafe { libc::fork() };
        let fork_errno = std::io::Error::last_os_error().raw_os_error();
        if fork_result >= 0 {
            if fork_result == 0 {
                unsafe { libc::_exit(23) };
            }
            terminate_and_wait(fork_result);
            unsafe { libc::_exit(24) };
        }
        if fork_errno != Some(libc::EAGAIN) {
            unsafe { libc::_exit(24) };
        }
        unsafe { libc::_exit(0) };
    }

    unsafe { libc::close(pipe_fds[0]) };
    let mut failure = None;
    if write(group.join("cgroup.procs"), child.to_string().as_bytes()).is_err() {
        failure = Some(ResourceProbeFailure::CgroupAttachFailed);
    }
    let pids_current = if failure.is_none() {
        read_to_string(group.join("pids.current"))
            .ok()
            .and_then(|value| {
                parse_decimal_control(value.trim(), ResourceProbeFailure::CgroupBaselineInvalid)
                    .ok()
            })
    } else {
        None
    };
    let memory_current = if failure.is_none() {
        read_to_string(group.join("memory.current"))
            .ok()
            .and_then(|value| {
                parse_decimal_control(value.trim(), ResourceProbeFailure::CgroupBaselineInvalid)
                    .ok()
            })
    } else {
        None
    };
    let memory_limit = memory_current.and_then(|value| memory_limit_from_baseline(value).ok());
    if failure.is_none() && (pids_current.is_none() || memory_current.is_none()) {
        failure = Some(ResourceProbeFailure::CgroupBaselineInvalid);
    }
    if failure.is_none() && pids_current == Some(0) {
        failure = Some(ResourceProbeFailure::CgroupBaselineInvalid);
    }
    if failure.is_none() && memory_limit.is_none() {
        failure = Some(ResourceProbeFailure::CgroupBaselineInvalid);
    }
    if failure.is_none() {
        let pids_limit = pids_current.unwrap_or_default().to_string();
        if write_cgroup_control(&group.join("cpu.max"), CGROUP_PROBE_CPU_MAX).is_err()
            || write_cgroup_control(
                &group.join("memory.max"),
                &memory_limit.unwrap_or_default().to_string(),
            )
            .is_err()
            || write_cgroup_control(&group.join("pids.max"), &pids_limit).is_err()
        {
            failure = Some(ResourceProbeFailure::CgroupLimitFailed);
        }
    }
    if failure.is_none() {
        let cpu_max = read_to_string(group.join("cpu.max")).ok();
        let memory_max = read_to_string(group.join("memory.max")).ok();
        let pids_max = read_to_string(group.join("pids.max")).ok();
        if cpu_max.as_deref().map(str::trim) != Some(CGROUP_PROBE_CPU_MAX)
            || memory_max.as_deref().and_then(|value| {
                parse_decimal_control(value.trim(), ResourceProbeFailure::CgroupLimitFailed).ok()
            }) != memory_limit
            || pids_max.as_deref().and_then(|value| {
                parse_decimal_control(value.trim(), ResourceProbeFailure::CgroupLimitFailed).ok()
            }) != pids_current
        {
            failure = Some(ResourceProbeFailure::CgroupLimitFailed);
        }
    }
    if failure.is_none() {
        let ready = [1_u8];
        if unsafe { libc::write(pipe_fds[1], ready.as_ptr().cast::<c_void>(), ready.len()) } != 1 {
            failure = Some(ResourceProbeFailure::CgroupWaitFailed);
        }
    }
    unsafe { libc::close(pipe_fds[1]) };
    let mut status = 0;
    let waited = unsafe { libc::waitpid(child, &mut status, 0) } == child;
    if !waited {
        terminate_and_wait(child);
        failure = Some(ResourceProbeFailure::CgroupWaitFailed);
    } else if failure.is_none() {
        let exit_code = if libc::WIFEXITED(status) {
            libc::WEXITSTATUS(status)
        } else {
            -1
        };
        failure = match exit_code {
            0 => None,
            21 => Some(ResourceProbeFailure::CgroupFilesystemBoundaryUnavailable),
            22 => Some(ResourceProbeFailure::CgroupWideningNotDenied),
            23 | 24 => Some(ResourceProbeFailure::ProcessCountNotEnforced),
            _ => Some(ResourceProbeFailure::CgroupWaitFailed),
        };
    }
    cleanup_cgroup_probe_ownership(&group, &root)?;
    failure.map_or(Ok(()), Err)
}

fn run_rlimit_resource_probe() -> bool {
    let child = unsafe { libc::fork() };
    if child < 0 {
        return false;
    }
    if child == 0 {
        env::set_var(
            "ACTESTRA_GOOSE_CPU_SECONDS",
            super::CPU_LIMIT_SECONDS.to_string(),
        );
        env::set_var(
            "ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES",
            super::ADDRESS_SPACE_LIMIT_BYTES.to_string(),
        );
        if super::unix::apply_resource_limits().is_err() {
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
        let valid = unsafe {
            libc::getrlimit(libc::RLIMIT_CPU, &mut cpu) == 0
                && libc::getrlimit(libc::RLIMIT_AS, &mut address_space) == 0
                && cpu.rlim_cur == super::CPU_LIMIT_SECONDS
                && cpu.rlim_max == super::CPU_LIMIT_SECONDS
                && address_space.rlim_cur == address_space.rlim_max
                && address_space.rlim_cur > super::ADDRESS_SPACE_LIMIT_BYTES
        };
        unsafe { libc::_exit(if valid { 0 } else { 21 }) };
    }
    let mut status = 0;
    (unsafe { libc::waitpid(child, &mut status, 0) }) == child
        && libc::WIFEXITED(status)
        && libc::WEXITSTATUS(status) == 0
}

fn run_resource_probe() -> bool {
    if !run_rlimit_resource_probe() {
        if env::var("ACTESTRA_GOOSE_CONTAINMENT_DEBUG").as_deref() == Ok("1") {
            eprintln!(
                "Goose resource probe failed at bounded stage {}",
                resource_probe_failure_code(ResourceProbeFailure::RlimitUnavailable)
            );
        }
        return false;
    }
    if let Err(failure) = run_cgroup_v2_resource_probe() {
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
        filesystem_available && complete,
        network_namespace_available && complete,
        process_tree_available && complete,
        resources_available && complete,
        parent_death_available && complete,
        cleanup && complete,
        if complete { "verified" } else { "evidence-incomplete" },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        bounded_hex, bounded_target, landlock_available_from_result, memory_limit_from_baseline,
        parse_decimal_control, parse_unified_cgroup_path, process_creation_filter,
        resource_probe_failure_code, run_cleanup_probe, run_parent_death_probe,
        run_process_tree_probe, run_resource_probe, ResourceProbeFailure, AUDIT_ARCH_X86_64,
        BPF_ALU, BPF_AND, BPF_JEQ, BPF_JMP, BPF_JSET, BPF_K, BPF_RET_K,
        REQUIRED_THREAD_CLONE_FLAGS, SECCOMP_DATA_ARCH_OFFSET, SECCOMP_RET_ALLOW,
        SECCOMP_RET_ERRNO, SECCOMP_RET_KILL_PROCESS, X32_SYSCALL_BIT,
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
    fn parses_only_one_safe_unified_cgroup_membership() {
        assert_eq!(
            parse_unified_cgroup_path("11:cpu:/legacy\n0::/user.slice/actestra"),
            Ok("/user.slice/actestra".to_string())
        );
        for value in [
            "11:cpu:/legacy",
            "0:cpu:/wrong",
            "0::relative",
            "0::/../escape",
            "0::/safe\n0::/duplicate",
        ] {
            assert!(parse_unified_cgroup_path(value).is_err());
        }
    }

    #[test]
    fn keeps_the_memory_allowance_arithmetic_checked() {
        assert_eq!(
            memory_limit_from_baseline(0).unwrap(),
            super::super::ADDRESS_SPACE_LIMIT_BYTES
        );
        assert!(memory_limit_from_baseline(u64::MAX).is_err());
        assert!(parse_decimal_control("1", ResourceProbeFailure::CgroupBaselineInvalid).is_ok());
        assert!(parse_decimal_control("", ResourceProbeFailure::CgroupBaselineInvalid).is_err());
        assert!(parse_decimal_control("1.0", ResourceProbeFailure::CgroupBaselineInvalid).is_err());
    }

    #[test]
    fn resource_failure_diagnostics_are_closed_and_redacted() {
        for failure in [
            ResourceProbeFailure::RlimitUnavailable,
            ResourceProbeFailure::CgroupV2Unavailable,
            ResourceProbeFailure::CgroupControllerNotDelegated,
            ResourceProbeFailure::CgroupWideningNotDenied,
            ResourceProbeFailure::ProcessCountNotEnforced,
            ResourceProbeFailure::CgroupCleanupFailed,
        ] {
            let code = resource_probe_failure_code(failure);
            assert!(code.starts_with("resource-"));
            assert!(!code.contains('/'));
            assert!(!code.contains(' '));
        }
    }
}
