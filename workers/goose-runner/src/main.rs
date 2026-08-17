use std::env;
mod containment;
#[cfg(any(target_os = "linux", all(unix, test)))]
mod linux_runtime;
#[cfg(all(unix, test))]
use containment::apply_resource_limits_with;
#[cfg(target_os = "linux")]
use containment::install_process_creation_filter;
use containment::RESOURCE_LIMIT_FAILURE_MARKER;
#[cfg(unix)]
use containment::{apply_resource_limits, watch_parent_liveness};
#[cfg(windows)]
use containment::{apply_resource_limits, watch_parent_liveness};
#[cfg(test)]
use containment::{
    parse_resource_limits_with, NativeResourceLimits, ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY,
    CPU_LIMIT_ENVIRONMENT_KEY,
};
#[cfg(all(test, target_os = "macos"))]
use containment::{ADDRESS_SPACE_LIMIT_BYTES, CPU_LIMIT_SECONDS};

#[cfg(target_os = "linux")]
const LINUX_NETWORK_POLICY_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
#[cfg(target_os = "linux")]
const LINUX_ASYNC_RUNTIME_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_ASYNC_RUNTIME_SETUP_FAILED";
#[cfg(target_os = "linux")]
const LINUX_ACP_SERVER_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_ACP_SERVER_FAILED";
#[cfg(target_os = "linux")]
const LINUX_RELAY_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_LINUX_RELAY_STOPPED";
#[cfg(target_os = "linux")]
const LINUX_RUNTIME_ENVIRONMENT_KEYS: [&str; 5] = [
    "ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET",
    "ACTESTRA_GOOSE_LINUX_MODEL_SOCKET",
    "ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT",
    "ACTESTRA_GOOSE_LINUX_MODEL_PORT",
    "ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT",
];

#[cfg(target_os = "linux")]
fn prepare_linux_runtime() -> Result<
    (
        linux_runtime::LinuxBridgeEnvironment,
        linux_runtime::LinuxRelayListeners,
    ),
    &'static str,
> {
    if LINUX_RUNTIME_ENVIRONMENT_KEYS != linux_runtime::LINUX_RUNTIME_ENVIRONMENT_KEYS {
        return Err(LINUX_NETWORK_POLICY_FAILURE_MARKER);
    }
    if containment::PR_SET_PDEATHSIG != 1 {
        return Err(LINUX_NETWORK_POLICY_FAILURE_MARKER);
    }
    let environment = linux_runtime::LinuxBridgeEnvironment::from_environment()
        .map_err(|_| LINUX_NETWORK_POLICY_FAILURE_MARKER)?;
    containment::set_parent_death_signal().map_err(|_| LINUX_NETWORK_POLICY_FAILURE_MARKER)?;
    apply_resource_limits().map_err(|_| RESOURCE_LIMIT_FAILURE_MARKER)?;
    let private_root = environment
        .private_root()
        .map_err(|_| LINUX_NETWORK_POLICY_FAILURE_MARKER)?;
    containment::prepare_linux_filesystem_containment(&private_root, &environment.workspace_root)
        .map_err(|_| LINUX_NETWORK_POLICY_FAILURE_MARKER)?;
    install_process_creation_filter().map_err(|_| LINUX_NETWORK_POLICY_FAILURE_MARKER)?;
    let listeners = linux_runtime::bind_loopback_listeners(&environment)
        .map_err(|_| LINUX_NETWORK_POLICY_FAILURE_MARKER)?;
    Ok((environment, listeners))
}

fn main() {
    if env::var("ACTESTRA_GOOSE_CONTAINMENT_PROBE").as_deref() == Ok("1") {
        println!("{}", containment::run_containment_probe());
        return;
    }
    #[cfg(target_os = "linux")]
    let prepared_linux_runtime = match prepare_linux_runtime() {
        Ok(prepared) => prepared,
        Err(marker) => {
            eprintln!("{marker}");
            std::process::exit(1);
        }
    };
    #[cfg(not(target_os = "linux"))]
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
            #[cfg(target_os = "linux")]
            eprintln!("{LINUX_ASYNC_RUNTIME_FAILURE_MARKER}");
            #[cfg(not(target_os = "linux"))]
            eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: could not create async runtime");
            std::process::exit(1);
        }
    };
    runtime.block_on(async {
        #[cfg(target_os = "linux")]
        {
            let (environment, listeners) = prepared_linux_runtime;
            let mut relay = match linux_runtime::LinuxRelay::start(listeners, environment) {
                Ok(relay) => relay,
                Err(_) => {
                    eprintln!("{LINUX_NETWORK_POLICY_FAILURE_MARKER}");
                    std::process::exit(1);
                }
            };
            watch_parent_liveness();
            let mut goose = std::pin::pin!(goose::acp::server::run(Vec::new(), false));
            let result = tokio::select! {
                result = &mut goose => Some(result),
                relay_result = relay.wait() => {
                    if relay_result.is_err() {
                        eprintln!("{LINUX_NETWORK_POLICY_FAILURE_MARKER}");
                    } else {
                        eprintln!("{LINUX_RELAY_FAILURE_MARKER}");
                    }
                    None
                },
            };
            relay.shutdown().await;
            match result {
                Some(Ok(())) => return,
                Some(Err(error)) => {
                    eprintln!("{LINUX_ACP_SERVER_FAILURE_MARKER}");
                    eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: {error:#}");
                    std::process::exit(1);
                }
                None => std::process::exit(1),
            }
        }
        #[cfg(not(target_os = "linux"))]
        {
            watch_parent_liveness();
            if let Err(error) = goose::acp::server::run(Vec::new(), false).await {
                eprintln!("ACTESTRA_GOOSE_RUNNER_FAILED: {error:#}");
                std::process::exit(1);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "linux")]
    use super::containment::unix::current_virtual_size_bytes;
    #[cfg(target_os = "linux")]
    use super::containment::unix::virtual_size_bytes_from_statm;
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

    #[cfg(unix)]
    #[test]
    fn applies_cpu_and_additional_address_space_as_equal_soft_and_hard_limits() {
        let limits = NativeResourceLimits {
            cpu_seconds: 120,
            address_space_bytes: 1_073_741_824,
        };
        let launch_baseline_bytes = 445_746_348_032;
        let mut calls = Vec::new();

        apply_resource_limits_with(limits, launch_baseline_bytes, |resource, soft, hard| {
            calls.push((resource, soft, hard));
            0
        })
        .unwrap();

        assert_eq!(
            calls,
            vec![
                (libc::RLIMIT_CPU as i32, 120, 120),
                (
                    libc::RLIMIT_AS as i32,
                    launch_baseline_bytes + 1_073_741_824,
                    launch_baseline_bytes + 1_073_741_824,
                ),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_an_address_space_cap_that_cannot_be_represented() {
        let limits = NativeResourceLimits {
            cpu_seconds: 120,
            address_space_bytes: 1_073_741_824,
        };
        let mut called = false;

        assert!(
            apply_resource_limits_with(limits, u64::MAX, |_resource, _soft, _hard| {
                called = true;
                0
            })
            .is_err()
        );
        assert!(!called);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn applies_native_limits_in_a_real_macos_child_process() {
        const CHILD_KEY: &str = "ACTESTRA_GOOSE_RESOURCE_LIMIT_KERNEL_CHILD";
        if env::var(CHILD_KEY).as_deref() == Ok("1") {
            if apply_resource_limits().is_err() {
                std::process::exit(91);
            }
            let mut address_space = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            if unsafe { libc::getrlimit(libc::RLIMIT_AS, &mut address_space) } != 0
                || address_space.rlim_cur <= ADDRESS_SPACE_LIMIT_BYTES as libc::rlim_t
                || address_space.rlim_cur != address_space.rlim_max
            {
                std::process::exit(92);
            }
            return;
        }

        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("tests::applies_native_limits_in_a_real_macos_child_process")
            .arg("--nocapture")
            .env(CHILD_KEY, "1")
            .env(CPU_LIMIT_ENVIRONMENT_KEY, CPU_LIMIT_SECONDS.to_string())
            .env(
                ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY,
                ADDRESS_SPACE_LIMIT_BYTES.to_string(),
            )
            .status()
            .unwrap();

        assert!(
            status.success(),
            "real macOS resource setup failed: {status}"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_a_real_linux_virtual_size_baseline() {
        assert!(current_virtual_size_bytes().unwrap() > 0);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_invalid_linux_virtual_size_inputs() {
        for value in ["", "0", "-1", "invalid", "18446744073709551616"] {
            assert!(virtual_size_bytes_from_statm(value, 4096).is_err());
        }
        assert!(virtual_size_bytes_from_statm("1", 0).is_err());
        assert!(virtual_size_bytes_from_statm(&u64::MAX.to_string(), 2).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn keeps_windows_native_resource_enforcement_unavailable() {
        assert!(apply_resource_limits().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn fails_closed_when_either_native_limit_cannot_be_applied() {
        let limits = NativeResourceLimits {
            cpu_seconds: 120,
            address_space_bytes: 1_073_741_824,
        };
        assert!(
            apply_resource_limits_with(limits, 445_746_348_032, |_resource, _soft, _hard| -1)
                .is_err()
        );

        let mut call_count = 0;
        assert!(
            apply_resource_limits_with(limits, 445_746_348_032, |_resource, _soft, _hard| {
                call_count += 1;
                if call_count == 1 {
                    0
                } else {
                    -1
                }
            },)
            .is_err()
        );
    }
}

#[cfg(test)]
mod containment_contract_tests {
    use super::containment::{assert_containment_config, ContainmentConfig, ContainmentNetwork};

    #[test]
    fn accepts_only_the_fixed_private_root_and_network_contract() {
        let config = ContainmentConfig {
            private_root: "/owned/attempt".to_string(),
            workspace_root: Some("/owned/worktree".to_string()),
            network: ContainmentNetwork::DenyAll,
            cpu_seconds: 120,
            address_space_bytes: 1_073_741_824,
            parent_liveness: true,
        };

        assert_containment_config(&config).unwrap();
    }

    #[test]
    fn rejects_widened_budget_and_missing_parent_liveness() {
        let mut config = ContainmentConfig {
            private_root: "/owned/attempt".to_string(),
            workspace_root: None,
            network: ContainmentNetwork::DenyAll,
            cpu_seconds: 121,
            address_space_bytes: 1_073_741_824,
            parent_liveness: false,
        };

        assert!(assert_containment_config(&config).is_err());
        config.cpu_seconds = 120;
        assert!(assert_containment_config(&config).is_err());
    }
}
