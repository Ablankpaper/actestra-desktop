use super::{parse_resource_limits_with, NativeResourceLimits};
use std::env;
use std::io::Read;
use std::os::fd::FromRawFd;

pub(crate) fn apply_resource_limits_with<F>(
    limits: NativeResourceLimits,
    launch_baseline_bytes: u64,
    mut set_limit: F,
) -> Result<(), ()>
where
    F: FnMut(i32, u64, u64) -> libc::c_int,
{
    let address_space_cap = launch_baseline_bytes
        .checked_add(limits.address_space_bytes)
        .filter(|value| *value <= libc::rlim_t::MAX as u64)
        .ok_or(())?;
    if set_limit(
        libc::RLIMIT_CPU as i32,
        limits.cpu_seconds,
        limits.cpu_seconds,
    ) != 0
    {
        return Err(());
    }
    if set_limit(libc::RLIMIT_AS as i32, address_space_cap, address_space_cap) != 0 {
        return Err(());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
pub(crate) fn current_virtual_size_bytes() -> Result<u64, ()> {
    let mut info = std::mem::MaybeUninit::<libc::mach_task_basic_info_data_t>::uninit();
    let mut count = libc::MACH_TASK_BASIC_INFO_COUNT;
    let status = unsafe {
        libc::task_info(
            libc::mach_task_self(),
            libc::MACH_TASK_BASIC_INFO,
            info.as_mut_ptr().cast::<libc::integer_t>(),
            &mut count,
        )
    };
    if status != libc::KERN_SUCCESS || count != libc::MACH_TASK_BASIC_INFO_COUNT {
        return Err(());
    }
    let info = unsafe { info.assume_init() };
    Ok(info.virtual_size as u64)
}

#[cfg(target_os = "linux")]
pub(crate) fn virtual_size_bytes_from_statm(statm: &str, page_size: i64) -> Result<u64, ()> {
    if page_size <= 0 {
        return Err(());
    }
    let pages = statm.split_whitespace().next().ok_or(())?;
    if pages.is_empty() || !pages.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    let pages = pages.parse::<u64>().map_err(|_| ())?;
    if pages == 0 {
        return Err(());
    }
    pages.checked_mul(page_size as u64).ok_or(())
}

#[cfg(target_os = "linux")]
pub(crate) fn current_virtual_size_bytes() -> Result<u64, ()> {
    let statm = std::fs::read_to_string("/proc/self/statm").map_err(|_| ())?;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    virtual_size_bytes_from_statm(&statm, page_size)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn current_virtual_size_bytes() -> Result<u64, ()> {
    Err(())
}

pub(crate) fn apply_resource_limits() -> Result<(), ()> {
    let limits = parse_resource_limits_with(|key| env::var(key).ok())?;
    let launch_baseline_bytes = current_virtual_size_bytes()?;
    apply_resource_limits_with(limits, launch_baseline_bytes, |resource, soft, hard| {
        let limit = libc::rlimit {
            rlim_cur: soft as libc::rlim_t,
            rlim_max: hard as libc::rlim_t,
        };
        unsafe { libc::setrlimit(resource as _, &limit) }
    })
}

pub(crate) fn watch_parent_liveness() {
    let Ok(raw_fd) = env::var("ACTESTRA_PARENT_LIVENESS_FD") else {
        return;
    };
    let Ok(raw_fd) = raw_fd.parse::<i32>() else {
        return;
    };
    let process_id = unsafe { libc::getpid() };
    let mut process_group = unsafe { libc::getpgrp() };
    if process_group != process_id {
        if unsafe { libc::setpgid(0, process_id) } != 0 {
            eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: could not establish process group");
            std::process::exit(1);
        }
        process_group = unsafe { libc::getpgrp() };
    }
    if process_group != process_id {
        eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: runner is not its process-group leader");
        std::process::exit(1);
    }
    std::thread::spawn(move || {
        // SAFETY: fd 3 is opened by Main as the read end of a CLOEXEC pipe.
        let mut pipe = unsafe { std::fs::File::from_raw_fd(raw_fd) };
        let mut byte = [0_u8; 1];
        loop {
            match pipe.read(&mut byte) {
                Ok(0) => {
                    unsafe {
                        libc::signal(libc::SIGTERM, libc::SIG_IGN);
                        libc::kill(-process_group, libc::SIGTERM);
                    }
                    std::process::exit(0);
                }
                Ok(_) => {}
                Err(_) => return,
            }
        }
    });
}
