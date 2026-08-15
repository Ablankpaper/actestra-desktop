use std::env;
use std::io::Read;
use std::os::unix::io::FromRawFd;

const CPU_LIMIT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_CPU_SECONDS";
const ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES";
const CPU_LIMIT_SECONDS: u64 = 120;
const ADDRESS_SPACE_LIMIT_BYTES: u64 = 1_073_741_824;
const RESOURCE_LIMIT_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";

#[derive(Clone, Copy)]
struct NativeResourceLimits {
    cpu_seconds: u64,
    address_space_bytes: u64,
}

fn parse_exact_limit<F>(read_environment: &mut F, key: &str, expected: u64) -> Result<u64, ()>
where
    F: FnMut(&str) -> Option<String>,
{
    let value = read_environment(key).ok_or(())?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(());
    }
    let parsed = value.parse::<u64>().map_err(|_| ())?;
    if parsed != expected || parsed > libc::rlim_t::MAX as u64 {
        return Err(());
    }
    Ok(parsed)
}

fn parse_resource_limits_with<F>(mut read_environment: F) -> Result<NativeResourceLimits, ()>
where
    F: FnMut(&str) -> Option<String>,
{
    Ok(NativeResourceLimits {
        cpu_seconds: parse_exact_limit(
            &mut read_environment,
            CPU_LIMIT_ENVIRONMENT_KEY,
            CPU_LIMIT_SECONDS,
        )?,
        address_space_bytes: parse_exact_limit(
            &mut read_environment,
            ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY,
            ADDRESS_SPACE_LIMIT_BYTES,
        )?,
    })
}

fn apply_resource_limits_with<F>(limits: NativeResourceLimits, mut set_limit: F) -> Result<(), ()>
where
    F: FnMut(i32, u64, u64) -> libc::c_int,
{
    if set_limit(
        libc::RLIMIT_CPU as i32,
        limits.cpu_seconds,
        limits.cpu_seconds,
    ) != 0
    {
        return Err(());
    }
    if set_limit(
        libc::RLIMIT_AS as i32,
        limits.address_space_bytes,
        limits.address_space_bytes,
    ) != 0
    {
        return Err(());
    }
    Ok(())
}

fn apply_resource_limits() -> Result<(), ()> {
    let limits = parse_resource_limits_with(|key| env::var(key).ok())?;
    apply_resource_limits_with(limits, |resource, soft, hard| {
        let limit = libc::rlimit {
            rlim_cur: soft as libc::rlim_t,
            rlim_max: hard as libc::rlim_t,
        };
        unsafe { libc::setrlimit(resource as _, &limit) }
    })
}

fn watch_parent_liveness() {
    let Ok(raw_fd) = env::var("ACTESTRA_PARENT_LIVENESS_FD") else {
        return;
    };
    let Ok(raw_fd) = raw_fd.parse::<i32>() else {
        return;
    };
    let process_id = unsafe { libc::getpid() };
    // sandbox-exec normally preserves the detached process group, but make
    // that ownership explicit before accepting the liveness channel. This
    // prevents a parent-death cleanup from ever signalling the supervisor's
    // group if a launcher changes its process-group semantics.
    let mut process_group = unsafe { libc::getpgrp() };
    // A detached macOS child is commonly already a session/process-group
    // leader. Calling setpgid on that session leader returns EPERM even
    // though the desired isolation is already in place. Only establish a
    // group when the launcher has not done so for us.
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
        // SAFETY: fd 3 is opened by Main as the read end of a CLOEXEC pipe and
        // remains owned by this runner until the supervisor disappears.
        let mut pipe = unsafe { std::fs::File::from_raw_fd(raw_fd) };
        let mut byte = [0_u8; 1];
        loop {
            match pipe.read(&mut byte) {
                Ok(0) => {
                    // The runner is the process-group leader. Terminate the
                    // complete group before exiting so descendants cannot be
                    // orphaned when Main dies unexpectedly.
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

fn main() {
    if apply_resource_limits().is_err() {
        eprintln!("{RESOURCE_LIMIT_FAILURE_MARKER}");
        std::process::exit(1);
    }
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: could not create async runtime");
            std::process::exit(1);
        }
    };
    runtime.block_on(async {
        watch_parent_liveness();
        if let Err(error) = goose::acp::server::run(Vec::new(), false).await {
            eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: {error:#}");
            std::process::exit(1);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn exact_environment() -> HashMap<&'static str, String> {
        HashMap::from([
            (CPU_LIMIT_ENVIRONMENT_KEY, "120".to_string()),
            (
                ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY,
                "1073741824".to_string(),
            ),
        ])
    }

    #[test]
    fn parses_only_the_fixed_native_resource_profile() {
        let environment = exact_environment();
        let limits = parse_resource_limits_with(|key| environment.get(key).cloned()).unwrap();

        assert_eq!(limits.cpu_seconds, 120);
        assert_eq!(limits.address_space_bytes, 1_073_741_824);
    }

    #[test]
    fn rejects_missing_invalid_zero_widened_and_overflowing_limits() {
        for value in [
            None,
            Some(""),
            Some("0"),
            Some("121"),
            Some("-1"),
            Some("1.5"),
            Some("18446744073709551616"),
        ] {
            let mut environment = exact_environment();
            match value {
                Some(value) => {
                    environment.insert(CPU_LIMIT_ENVIRONMENT_KEY, value.to_string());
                }
                None => {
                    environment.remove(CPU_LIMIT_ENVIRONMENT_KEY);
                }
            }
            assert!(parse_resource_limits_with(|key| environment.get(key).cloned()).is_err());
        }

        for value in [
            None,
            Some(""),
            Some("0"),
            Some("1073741825"),
            Some("-1"),
            Some("1.5"),
            Some("18446744073709551616"),
        ] {
            let mut environment = exact_environment();
            match value {
                Some(value) => {
                    environment.insert(ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY, value.to_string());
                }
                None => {
                    environment.remove(ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY);
                }
            }
            assert!(parse_resource_limits_with(|key| environment.get(key).cloned()).is_err());
        }
    }

    #[test]
    fn applies_cpu_and_address_space_as_equal_soft_and_hard_limits() {
        let limits = NativeResourceLimits {
            cpu_seconds: 120,
            address_space_bytes: 1_073_741_824,
        };
        let mut calls = Vec::new();

        apply_resource_limits_with(limits, |resource, soft, hard| {
            calls.push((resource, soft, hard));
            0
        })
        .unwrap();

        assert_eq!(
            calls,
            vec![
                (libc::RLIMIT_CPU as i32, 120, 120),
                (libc::RLIMIT_AS as i32, 1_073_741_824, 1_073_741_824,),
            ]
        );
    }

    #[test]
    fn fails_closed_when_either_native_limit_cannot_be_applied() {
        let limits = NativeResourceLimits {
            cpu_seconds: 120,
            address_space_bytes: 1_073_741_824,
        };
        assert!(apply_resource_limits_with(limits, |_resource, _soft, _hard| -1).is_err());

        let mut call_count = 0;
        assert!(
            apply_resource_limits_with(limits, |_resource, _soft, _hard| {
                call_count += 1;
                if call_count == 1 {
                    0
                } else {
                    -1
                }
            })
            .is_err()
        );
    }
}
