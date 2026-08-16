use super::parse_resource_limits_with;
use std::env;

pub(crate) fn apply_resource_limits() -> Result<(), ()> {
    parse_resource_limits_with(|key| env::var(key).ok())?;
    Err(())
}

pub(crate) fn watch_parent_liveness() {}
