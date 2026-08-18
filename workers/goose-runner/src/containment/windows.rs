use super::parse_resource_limits_with;
use std::env;

#[cfg(windows)]
use crate::windows_supervisor::{launch_windows_containment_worker, ProbeHandle};

pub(crate) fn apply_resource_limits() -> Result<(), ()> {
    parse_resource_limits_with(|key| env::var(key).ok())?;
    Err(())
}

pub(crate) fn watch_parent_liveness() {}

pub(crate) fn run_windows_containment_probe() -> String {
    String::from(
        r#"{"contractVersion":1,"targetTriple":"x86_64-pc-windows-msvc","sourceCommit":"","probeSha256":"","executableSha256":"","filesystem":false,"network":false,"processTree":false,"resources":false,"parentDeath":false,"cleanup":false,"status":"unsupported-platform"}"#,
    )
}
