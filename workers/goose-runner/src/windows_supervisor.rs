pub(crate) const WINDOWS_SETUP_FAILURE_MARKER: &str = "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
pub(crate) const WINDOWS_RESOURCE_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";

pub(crate) struct WindowsPipeNames {
    pub(crate) capability: String,
    pub(crate) model: String,
}

pub(crate) fn derive_pipe_names(attempt_id: &str) -> Result<WindowsPipeNames, ()> {
    if attempt_id.len() != 32
        || !attempt_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(());
    }
    let prefix = r"\\.\pipe\LOCAL\Actestra.Goose.";
    Ok(WindowsPipeNames {
        capability: format!("{prefix}{attempt_id}.capability"),
        model: format!("{prefix}{attempt_id}.model"),
    })
}

pub(crate) fn run_supervisor() -> i32 {
    eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
    1
}

pub(crate) fn run_worker() -> i32 {
    eprintln!("{WINDOWS_RESOURCE_FAILURE_MARKER}");
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_exact_attempt_scoped_pipe_names_without_private_text() {
        let names = derive_pipe_names("0123456789abcdef0123456789abcdef").unwrap();
        assert!(names
            .capability
            .starts_with(r"\\.\pipe\LOCAL\Actestra.Goose."));
        assert!(names.model.starts_with(r"\\.\pipe\LOCAL\Actestra.Goose."));
        assert!(names.capability.ends_with(".capability"));
        assert!(names.model.ends_with(".model"));
        assert_ne!(names.capability, names.model);
        for forbidden in ["C:", "prompt", "model text", "lease"] {
            assert!(!names.capability.contains(forbidden));
            assert!(!names.model.contains(forbidden));
        }
    }

    #[test]
    fn rejects_non_exact_attempt_identifiers() {
        for value in [
            "",
            "0123456789abcdef",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdeg",
            "0123456789abcdef0123456789abcdef0",
        ] {
            assert!(derive_pipe_names(value).is_err());
        }
    }

    #[test]
    fn keeps_both_windows_modes_fail_closed_until_native_setup_exists() {
        assert_eq!(run_supervisor(), 1);
        assert_eq!(run_worker(), 1);
    }
}
