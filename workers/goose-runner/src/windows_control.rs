use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Number, Value};
use std::fmt;

pub(crate) const WINDOWS_CONTROL_MAX_BYTES: usize = 32 * 1024;

const CONTROL_KEYS: [&str; 10] = [
    "attemptId",
    "attemptLease",
    "contractVersion",
    "executableSha256",
    "modelAttemptLease",
    "modelId",
    "privateRoot",
    "resourceBudget",
    "targetTriple",
    "worktreeRoot",
];
const RESOURCE_BUDGET_KEYS: [&str; 6] = [
    "maxActiveDurationMs",
    "maxChildProcesses",
    "maxCpuSeconds",
    "maxOutputBytes",
    "maxPrivateMemoryBytes",
    "maxPrivateStorageBytes",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowsMode {
    Supervisor,
    Worker,
}

impl WindowsMode {
    pub(crate) fn parse(arguments: &[String]) -> Result<Option<Self>, ()> {
        let modes = arguments.get(1..).ok_or(())?;
        match modes {
            [] => Ok(None),
            [mode] if mode == "--actestra-windows-supervisor-v1" => Ok(Some(Self::Supervisor)),
            [mode, control, ready]
                if mode == "--actestra-windows-worker-v1"
                    && parse_worker_handle_pair(control, ready).is_some() =>
            {
                Ok(Some(Self::Worker))
            }
            _ => Err(()),
        }
    }
}

pub(crate) fn parse_worker_handle_arguments(
    arguments: &[String],
) -> Result<Option<(u64, u64)>, ()> {
    let modes = arguments.get(1..).ok_or(())?;
    match modes {
        [mode, control, ready] if mode == "--actestra-windows-worker-v1" => {
            Ok(Some(parse_worker_handle_pair(control, ready).ok_or(())?))
        }
        _ => Ok(None),
    }
}

fn parse_worker_handle_pair(control: &str, ready: &str) -> Option<(u64, u64)> {
    let control = parse_worker_handle_value(control)?;
    let ready = parse_worker_handle_value(ready)?;
    (control != ready).then_some((control, ready))
}

fn parse_worker_handle_value(value: &str) -> Option<u64> {
    // Worker handle arguments use one bounded decimal representation: no sign, whitespace,
    // prefix, sentinel, or platform-dependent pointer text is admitted.
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let parsed = value.parse::<u64>().ok()?;
    (parsed != 0 && parsed != u64::MAX).then_some(parsed)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WindowsResourceBudget {
    pub(crate) max_active_duration_ms: u64,
    pub(crate) max_child_processes: u64,
    pub(crate) max_cpu_seconds: u64,
    pub(crate) max_output_bytes: u64,
    pub(crate) max_private_memory_bytes: u64,
    pub(crate) max_private_storage_bytes: u64,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct WindowsControlMessage {
    pub(crate) attempt_id: String,
    pub(crate) attempt_lease: String,
    pub(crate) executable_sha256: String,
    pub(crate) model_attempt_lease: String,
    pub(crate) model_id: String,
    pub(crate) private_root: String,
    pub(crate) resource_budget: WindowsResourceBudget,
    pub(crate) target_triple: String,
    pub(crate) worktree_root: String,
}

struct StrictJson(Value);

impl<'de> Deserialize<'de> for StrictJson {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(StrictJsonVisitor)
    }
}

struct StrictJsonVisitor;

impl<'de> Visitor<'de> for StrictJsonVisitor {
    type Value = StrictJson;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a JSON value without duplicate object keys")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E> {
        Ok(StrictJson(Value::Bool(value)))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E> {
        Ok(StrictJson(Value::Number(Number::from(value))))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E> {
        Ok(StrictJson(Value::Number(Number::from(value))))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        Number::from_f64(value)
            .map(Value::Number)
            .map(StrictJson)
            .ok_or_else(|| E::custom("non-finite JSON number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: de::Error,
    {
        self.visit_string(value.to_string())
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E> {
        Ok(StrictJson(Value::String(value)))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJson(Value::Null))
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(StrictJson(Value::Null))
    }

    fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element::<StrictJson>()? {
            values.push(value.0);
        }
        Ok(StrictJson(Value::Array(values)))
    }

    fn visit_map<A>(self, mut object: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut values = Map::new();
        while let Some(key) = object.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(de::Error::custom("duplicate JSON object key"));
            }
            let value = object.next_value::<StrictJson>()?;
            values.insert(key, value.0);
        }
        Ok(StrictJson(Value::Object(values)))
    }
}

pub(crate) fn parse_strict_json(input: &[u8]) -> Result<Value, ()> {
    let mut deserializer = serde_json::Deserializer::from_slice(input);
    let value = StrictJson::deserialize(&mut deserializer).map_err(|_| ())?;
    deserializer.end().map_err(|_| ())?;
    Ok(value.0)
}

fn has_exact_keys(object: &Map<String, Value>, keys: &[&str]) -> bool {
    object.len() == keys.len() && object.keys().all(|key| keys.contains(&key.as_str()))
}

fn exact_string(object: &Map<String, Value>, key: &str, max_bytes: usize) -> Result<String, ()> {
    let value = object.get(key).and_then(Value::as_str).ok_or(())?;
    if value.is_empty() || value.contains('\0') || value.len() > max_bytes {
        return Err(());
    }
    Ok(value.to_string())
}

fn is_lower_hex(value: &str, bytes: usize) -> bool {
    value.len() == bytes
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn is_opaque_token(value: &str) -> bool {
    (32..=256).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))
}

fn is_windows_drive_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() <= 3
        || bytes.len() > 4096
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'\\'
        || value.contains('/')
        || value.contains('\0')
    {
        return false;
    }
    value.split('\\').skip(1).all(|component| {
        !component.is_empty()
            && component != "."
            && component != ".."
            && !component.contains(':')
            && !component.ends_with([' ', '.'])
    })
}

fn parse_resource_budget(value: &Value) -> Result<WindowsResourceBudget, ()> {
    let object = value.as_object().ok_or(())?;
    if !has_exact_keys(object, &RESOURCE_BUDGET_KEYS) {
        return Err(());
    }
    let budget = WindowsResourceBudget {
        max_active_duration_ms: object
            .get("maxActiveDurationMs")
            .and_then(Value::as_u64)
            .ok_or(())?,
        max_child_processes: object
            .get("maxChildProcesses")
            .and_then(Value::as_u64)
            .ok_or(())?,
        max_cpu_seconds: object
            .get("maxCpuSeconds")
            .and_then(Value::as_u64)
            .ok_or(())?,
        max_output_bytes: object
            .get("maxOutputBytes")
            .and_then(Value::as_u64)
            .ok_or(())?,
        max_private_memory_bytes: object
            .get("maxPrivateMemoryBytes")
            .and_then(Value::as_u64)
            .ok_or(())?,
        max_private_storage_bytes: object
            .get("maxPrivateStorageBytes")
            .and_then(Value::as_u64)
            .ok_or(())?,
    };
    if budget
        != (WindowsResourceBudget {
            max_active_duration_ms: 1_800_000,
            max_child_processes: 0,
            max_cpu_seconds: 120,
            max_output_bytes: 262_144,
            max_private_memory_bytes: 1_073_741_824,
            max_private_storage_bytes: 536_870_912,
        })
    {
        return Err(());
    }
    Ok(budget)
}

pub(crate) fn parse_control_message(input: &[u8]) -> Result<WindowsControlMessage, ()> {
    if input.is_empty() || input.len() > WINDOWS_CONTROL_MAX_BYTES {
        return Err(());
    }
    let value = parse_strict_json(input)?;
    let object = value.as_object().ok_or(())?;
    if !has_exact_keys(object, &CONTROL_KEYS)
        || object.get("contractVersion").and_then(Value::as_u64) != Some(1)
    {
        return Err(());
    }
    let attempt_id = exact_string(object, "attemptId", 32)?;
    let attempt_lease = exact_string(object, "attemptLease", 256)?;
    let executable_sha256 = exact_string(object, "executableSha256", 64)?;
    let model_attempt_lease = exact_string(object, "modelAttemptLease", 256)?;
    let model_id = exact_string(object, "modelId", 256)?;
    let private_root = exact_string(object, "privateRoot", 4096)?;
    let target_triple = exact_string(object, "targetTriple", 64)?;
    let worktree_root = exact_string(object, "worktreeRoot", 4096)?;
    if !is_lower_hex(&attempt_id, 32)
        || !is_opaque_token(&attempt_lease)
        || !is_lower_hex(&executable_sha256, 64)
        || !is_opaque_token(&model_attempt_lease)
        || model_attempt_lease == attempt_lease
        || model_id.chars().any(char::is_control)
        || !is_windows_drive_path(&private_root)
        || target_triple != "x86_64-pc-windows-msvc"
        || !is_windows_drive_path(&worktree_root)
        || private_root.eq_ignore_ascii_case(&worktree_root)
    {
        return Err(());
    }
    Ok(WindowsControlMessage {
        attempt_id,
        attempt_lease,
        executable_sha256,
        model_attempt_lease,
        model_id,
        private_root,
        resource_budget: parse_resource_budget(object.get("resourceBudget").ok_or(())?)?,
        target_triple,
        worktree_root,
    })
}

pub(crate) fn parse_control_frame(input: &[u8]) -> Result<WindowsControlMessage, ()> {
    let length_bytes: [u8; 4] = input.get(..4).ok_or(())?.try_into().map_err(|_| ())?;
    let payload_length = u32::from_le_bytes(length_bytes) as usize;
    if payload_length == 0
        || payload_length > WINDOWS_CONTROL_MAX_BYTES
        || input.len() != payload_length + 4
    {
        return Err(());
    }
    parse_control_message(&input[4..])
}

pub(crate) fn serialize_control_message(message: &WindowsControlMessage) -> Result<Vec<u8>, ()> {
    let value = json!({
        "attemptId": message.attempt_id,
        "attemptLease": message.attempt_lease,
        "contractVersion": 1,
        "executableSha256": message.executable_sha256,
        "modelAttemptLease": message.model_attempt_lease,
        "modelId": message.model_id,
        "privateRoot": message.private_root,
        "resourceBudget": {
            "maxActiveDurationMs": message.resource_budget.max_active_duration_ms,
            "maxChildProcesses": message.resource_budget.max_child_processes,
            "maxCpuSeconds": message.resource_budget.max_cpu_seconds,
            "maxOutputBytes": message.resource_budget.max_output_bytes,
            "maxPrivateMemoryBytes": message.resource_budget.max_private_memory_bytes,
            "maxPrivateStorageBytes": message.resource_budget.max_private_storage_bytes,
        },
        "targetTriple": message.target_triple,
        "worktreeRoot": message.worktree_root,
    });
    let serialized = serde_json::to_vec(&value).map_err(|_| ())?;
    if serialized.len() > WINDOWS_CONTROL_MAX_BYTES {
        return Err(());
    }
    if parse_control_message(&serialized)? != *message {
        return Err(());
    }
    Ok(serialized)
}

pub(crate) fn redacted_control_evidence(message: &WindowsControlMessage) -> Value {
    json!({
        "contractVersion": 1,
        "executableSha256": message.executable_sha256,
        "resourceProfile": "goose-fixed-v1",
        "status": "accepted",
        "targetTriple": message.target_triple,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn exact_control_message() -> Vec<u8> {
        serde_json::to_vec(&json!({
            "attemptId": "0123456789abcdef0123456789abcdef",
            "attemptLease": "lease_0123456789abcdef0123456789abcdef",
            "contractVersion": 1,
            "executableSha256": "a".repeat(64),
            "modelAttemptLease": "model_0123456789abcdef0123456789abcdef",
            "modelId": "test-model",
            "privateRoot": "C:\\Actestra\\attempts\\one",
            "resourceBudget": {
                "maxActiveDurationMs": 1_800_000,
                "maxChildProcesses": 0,
                "maxCpuSeconds": 120,
                "maxOutputBytes": 262_144,
                "maxPrivateMemoryBytes": 1_073_741_824,
                "maxPrivateStorageBytes": 536_870_912
            },
            "targetTriple": "x86_64-pc-windows-msvc",
            "worktreeRoot": "D:\\worktrees\\one"
        }))
        .unwrap()
    }

    #[test]
    fn accepts_only_exact_windows_modes() {
        let supervisor = vec![
            "actestra-goose-runner.exe".to_string(),
            "--actestra-windows-supervisor-v1".to_string(),
        ];
        let worker = vec![
            "actestra-goose-runner.exe".to_string(),
            "--actestra-windows-worker-v1".to_string(),
            "100".to_string(),
            "101".to_string(),
        ];
        assert_eq!(
            WindowsMode::parse(&supervisor).unwrap(),
            Some(WindowsMode::Supervisor)
        );
        assert_eq!(
            WindowsMode::parse(&worker).unwrap(),
            Some(WindowsMode::Worker)
        );
        assert_eq!(
            parse_worker_handle_arguments(&worker).unwrap(),
            Some((100, 101))
        );
        assert_eq!(
            WindowsMode::parse(&["actestra-goose-runner.exe".to_string()]).unwrap(),
            None
        );
        for rejected in [
            vec![
                "actestra-goose-runner.exe".to_string(),
                "--unknown".to_string(),
            ],
            vec![
                "actestra-goose-runner.exe".to_string(),
                "--actestra-windows-supervisor-v1".to_string(),
                "--actestra-windows-supervisor-v1".to_string(),
            ],
            vec![
                "actestra-goose-runner.exe".to_string(),
                "--actestra-windows-supervisor-v1".to_string(),
                "--actestra-windows-worker-v1".to_string(),
            ],
            vec![
                "actestra-goose-runner.exe".to_string(),
                "--actestra-windows-worker-v1".to_string(),
                "0".to_string(),
                "101".to_string(),
            ],
            vec![
                "actestra-goose-runner.exe".to_string(),
                "--actestra-windows-worker-v1".to_string(),
                "101".to_string(),
                "101".to_string(),
            ],
        ] {
            assert!(WindowsMode::parse(&rejected).is_err());
        }
        let repeated_worker_handle = vec![
            "actestra-goose-runner.exe".to_string(),
            "--actestra-windows-worker-v1".to_string(),
            "101".to_string(),
            "101".to_string(),
        ];
        assert!(parse_worker_handle_arguments(&repeated_worker_handle).is_err());
    }

    #[test]
    fn parses_only_the_bounded_exact_control_contract() {
        let parsed = parse_control_message(&exact_control_message()).unwrap();
        assert_eq!(parsed.attempt_id, "0123456789abcdef0123456789abcdef");
        assert_eq!(
            parsed.model_attempt_lease,
            "model_0123456789abcdef0123456789abcdef"
        );
        assert_ne!(parsed.model_attempt_lease, parsed.attempt_lease);
        assert_eq!(parsed.resource_budget.max_cpu_seconds, 120);
        assert!(
            parse_control_message(&serialize_control_message(&parsed).unwrap()).unwrap() == parsed
        );

        assert!(parse_control_message(&vec![b'a'; WINDOWS_CONTROL_MAX_BYTES + 1]).is_err());

        let mut unknown = serde_json::from_slice::<serde_json::Value>(&exact_control_message())
            .unwrap()
            .as_object()
            .unwrap()
            .clone();
        unknown.insert("unexpected".to_string(), json!(true));
        assert!(parse_control_message(&serde_json::to_vec(&unknown).unwrap()).is_err());
        assert!(parse_control_message(
            br#"{"attemptId":"0123456789abcdef0123456789abcdef","attemptId":"fedcba9876543210fedcba9876543210"}"#
        )
        .is_err());
    }

    #[test]
    fn redacts_control_evidence_before_serialization() {
        let parsed = parse_control_message(&exact_control_message()).unwrap();
        let evidence = redacted_control_evidence(&parsed);
        let serialized = serde_json::to_string(&evidence).unwrap();

        assert!(serialized.contains("x86_64-pc-windows-msvc"));
        for forbidden in [
            "C:\\Actestra",
            "D:\\worktrees",
            "lease_0123456789abcdef0123456789abcdef",
            "model_0123456789abcdef0123456789abcdef",
            "test-model",
            "pipe",
            "prompt",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn refuses_to_serialize_an_invalid_internal_control_message() {
        let mut parsed = parse_control_message(&exact_control_message()).unwrap();
        parsed.model_id = "invalid\0model".to_string();
        assert!(serialize_control_message(&parsed).is_err());
    }

    #[test]
    fn accepts_only_one_exact_length_prefixed_control_frame() {
        let payload = exact_control_message();
        let mut frame = (payload.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(&payload);
        assert!(parse_control_frame(&frame).unwrap() == parse_control_message(&payload).unwrap());

        let mut trailing = frame.clone();
        trailing.push(0);
        assert!(parse_control_frame(&trailing).is_err());
        assert!(parse_control_frame(&frame[..frame.len() - 1]).is_err());
        assert!(parse_control_frame(&0_u32.to_le_bytes()).is_err());
        assert!(
            parse_control_frame(&((WINDOWS_CONTROL_MAX_BYTES + 1) as u32).to_le_bytes()).is_err()
        );
    }
}
