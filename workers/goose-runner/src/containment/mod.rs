use std::path::Path;

#[cfg(unix)]
pub(crate) mod unix;
#[cfg(windows)]
mod windows;

pub(crate) const CPU_LIMIT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_CPU_SECONDS";
pub(crate) const ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY: &str = "ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES";
pub(crate) const CPU_LIMIT_SECONDS: u64 = 120;
pub(crate) const ADDRESS_SPACE_LIMIT_BYTES: u64 = 1_073_741_824;
pub(crate) const RESOURCE_LIMIT_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ContainmentNetwork {
    DenyAll,
}

pub(crate) struct ContainmentConfig {
    pub(crate) private_root: String,
    pub(crate) workspace_root: Option<String>,
    pub(crate) network: ContainmentNetwork,
    pub(crate) cpu_seconds: u64,
    pub(crate) address_space_bytes: u64,
    pub(crate) parent_liveness: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct NativeResourceLimits {
    pub(crate) cpu_seconds: u64,
    pub(crate) address_space_bytes: u64,
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
    if parsed != expected {
        return Err(());
    }
    Ok(parsed)
}

pub(crate) fn parse_resource_limits_with<F>(
    mut read_environment: F,
) -> Result<NativeResourceLimits, ()>
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

#[cfg(unix)]
pub(crate) use unix::{apply_resource_limits, apply_resource_limits_with, watch_parent_liveness};
#[cfg(windows)]
pub(crate) use windows::{apply_resource_limits, watch_parent_liveness};

pub(crate) fn assert_containment_config(config: &ContainmentConfig) -> Result<(), ()> {
    if !is_private_path(&config.private_root)
        || config
            .workspace_root
            .as_deref()
            .is_some_and(|path| !is_private_path(path))
        || !matches!(config.network, ContainmentNetwork::DenyAll)
        || config.cpu_seconds != 120
        || config.address_space_bytes != 1_073_741_824
        || !config.parent_liveness
    {
        return Err(());
    }
    Ok(())
}

fn is_private_path(value: &str) -> bool {
    let path = Path::new(value);
    path.is_absolute()
        && path.parent().is_some()
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}
