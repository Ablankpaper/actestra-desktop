use std::env;
use std::fs::{create_dir, remove_dir};
use std::os::raw::c_void;
use std::path::PathBuf;

const LANDLOCK_CREATE_RULESET_SYSCALL: libc::c_long = 444;
const LANDLOCK_CREATE_RULESET_VERSION: libc::c_ulong = 1;
const PR_SET_NO_NEW_PRIVS: libc::c_int = 38;
const PR_SET_SECCOMP: libc::c_int = 22;
const SECCOMP_MODE_FILTER: libc::c_ulong = 2;
const BPF_RET_K: u16 = 0x06;
const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;

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

fn can_install_seccomp_filter() -> bool {
    let child = unsafe { libc::fork() };
    if child < 0 {
        return false;
    }
    if child == 0 {
        let no_new_privs = unsafe { libc::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) } == 0;
        let mut filter = SockFilter {
            code: BPF_RET_K,
            jump_true: 0,
            jump_false: 0,
            value: SECCOMP_RET_ALLOW,
        };
        let mut program = SockFilterProgram {
            length: 1,
            filter: &mut filter,
        };
        let installed = no_new_privs
            && unsafe {
                libc::prctl(
                    PR_SET_SECCOMP,
                    SECCOMP_MODE_FILTER,
                    &mut program as *mut SockFilterProgram,
                    0,
                    0,
                )
            } == 0;
        unsafe { libc::_exit(if installed { 0 } else { 1 }) };
    }
    let mut status = 0;
    (unsafe { libc::waitpid(child, &mut status, 0) }) == child
        && libc::WIFEXITED(status)
        && libc::WEXITSTATUS(status) == 0
}

fn can_create_network_namespace() -> bool {
    let child = unsafe { libc::fork() };
    if child < 0 {
        return false;
    }
    if child == 0 {
        let flags = (libc::CLONE_NEWUSER | libc::CLONE_NEWNET) as libc::c_int;
        let result = unsafe { libc::unshare(flags) };
        unsafe { libc::_exit(if result == 0 { 0 } else { 1 }) };
    }
    let mut status = 0;
    (unsafe { libc::waitpid(child, &mut status, 0) }) == child
        && libc::WIFEXITED(status)
        && libc::WEXITSTATUS(status) == 0
}

fn can_cleanup_owned_directory() -> bool {
    let directory = PathBuf::from(env::temp_dir())
        .join(format!("actestra-goose-probe-{}", unsafe {
            libc::getpid()
        }));
    create_dir(&directory).is_ok() && remove_dir(&directory).is_ok()
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
    let landlock_available = has_landlock_syscall();
    let network_namespace_available = can_create_network_namespace();
    let seccomp_available = can_install_seccomp_filter();
    let cleanup = can_cleanup_owned_directory();
    let complete = false;
    format!(
        "{{\"contractVersion\":1,\"targetTriple\":\"{}\",\"sourceCommit\":\"{}\",\"probeSha256\":\"{}\",\"executableSha256\":\"{}\",\"filesystem\":{},\"network\":{},\"processTree\":{},\"resources\":{},\"parentDeath\":{},\"cleanup\":{},\"status\":\"{}\"}}",
        target_triple,
        source_commit,
        probe_sha256,
        executable_sha256,
        landlock_available && complete,
        network_namespace_available && complete,
        seccomp_available && complete,
        false,
        false,
        cleanup && complete,
        if complete { "verified" } else { "evidence-incomplete" },
    )
}

#[cfg(test)]
mod tests {
    use super::{bounded_hex, bounded_target, landlock_available_from_result};

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
}
