use crate::windows_control::parse_strict_json;
use serde_json::{json, Map, Value};

pub(crate) const WINDOWS_BRIDGE_MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

const REQUEST_KEYS: [&str; 5] = [
    "contractVersion",
    "invocation",
    "kind",
    "lease",
    "requestId",
];
const RESPONSE_COMPLETION_KEYS: [&str; 4] = ["completion", "contractVersion", "kind", "requestId"];
const RESPONSE_ERROR_KEYS: [&str; 4] = ["contractVersion", "error", "kind", "requestId"];
const CANCEL_KEYS: [&str; 4] = ["contractVersion", "kind", "lease", "requestId"];
const INVOCATION_KEYS: [&str; 5] = ["messages", "purpose", "responseMode", "sessionId", "tools"];
const MODEL_ERROR_CODES: [&str; 5] = [
    "cancelled",
    "model-completion-refused",
    "model-request-rejected",
    "model-timeout",
    "model-unavailable",
];

#[derive(Clone, PartialEq)]
pub(crate) enum WindowsBridgeFrame {
    CompletionRequest {
        request_id: String,
        lease: String,
        invocation: Value,
    },
    CompletionResponse {
        request_id: String,
        completion: Value,
    },
    ErrorResponse {
        request_id: String,
        error: String,
    },
    Cancel {
        request_id: String,
        lease: String,
    },
}

impl WindowsBridgeFrame {
    fn evidence_kind(&self) -> &'static str {
        match self {
            Self::CompletionRequest { .. } => "completion-request",
            Self::CompletionResponse { .. } => "completion-response",
            Self::ErrorResponse { .. } => "error-response",
            Self::Cancel { .. } => "cancel",
        }
    }
}

fn has_exact_keys(object: &Map<String, Value>, keys: &[&str]) -> bool {
    object.len() == keys.len() && object.keys().all(|key| keys.contains(&key.as_str()))
}

fn exact_token(
    object: &Map<String, Value>,
    key: &str,
    min: usize,
    max: usize,
) -> Result<String, ()> {
    let value = object.get(key).and_then(Value::as_str).ok_or(())?;
    if !(min..=max).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))
    {
        return Err(());
    }
    Ok(value.to_string())
}

fn validate_invocation(value: &Value) -> Result<Value, ()> {
    let object = value.as_object().ok_or(())?;
    if !has_exact_keys(object, &INVOCATION_KEYS)
        || object.get("purpose").and_then(Value::as_str) != Some("coding")
        || object.get("responseMode").and_then(Value::as_str) != Some("text-or-tool-call")
    {
        return Err(());
    }
    let session_id = object.get("sessionId").and_then(Value::as_str).ok_or(())?;
    let messages = object.get("messages").and_then(Value::as_array).ok_or(())?;
    let tools = object.get("tools").and_then(Value::as_array).ok_or(())?;
    if session_id.is_empty()
        || session_id.len() > 256
        || session_id.chars().any(char::is_control)
        || messages.len() > 512
        || tools.len() > 256
        || messages.iter().any(|message| !message.is_object())
        || tools.iter().any(|tool| !tool.is_object())
    {
        return Err(());
    }
    Ok(value.clone())
}

fn project_bridge_value(value: Value) -> Result<WindowsBridgeFrame, ()> {
    let object = value.as_object().ok_or(())?;
    if object.get("contractVersion").and_then(Value::as_u64) != Some(1) {
        return Err(());
    }
    let kind = object.get("kind").and_then(Value::as_str).ok_or(())?;
    let request_id = exact_token(object, "requestId", 1, 128)?;
    if kind == "cancel" {
        if !has_exact_keys(object, &CANCEL_KEYS) {
            return Err(());
        }
        return Ok(WindowsBridgeFrame::Cancel {
            request_id,
            lease: exact_token(object, "lease", 32, 256)?,
        });
    }
    if kind != "completion" {
        return Err(());
    }
    if object.contains_key("invocation") {
        if !has_exact_keys(object, &REQUEST_KEYS) {
            return Err(());
        }
        return Ok(WindowsBridgeFrame::CompletionRequest {
            request_id,
            lease: exact_token(object, "lease", 32, 256)?,
            invocation: validate_invocation(object.get("invocation").ok_or(())?)?,
        });
    }
    if object.contains_key("completion") {
        if !has_exact_keys(object, &RESPONSE_COMPLETION_KEYS) {
            return Err(());
        }
        let completion = object
            .get("completion")
            .filter(|value| value.is_object())
            .ok_or(())?;
        return Ok(WindowsBridgeFrame::CompletionResponse {
            request_id,
            completion: completion.clone(),
        });
    }
    if !has_exact_keys(object, &RESPONSE_ERROR_KEYS) {
        return Err(());
    }
    let error = object.get("error").and_then(Value::as_str).ok_or(())?;
    if !MODEL_ERROR_CODES.contains(&error) {
        return Err(());
    }
    Ok(WindowsBridgeFrame::ErrorResponse {
        request_id,
        error: error.to_string(),
    })
}

pub(crate) fn encode_bridge_frame(value: &Value) -> Result<Vec<u8>, ()> {
    project_bridge_value(value.clone())?;
    let payload = serde_json::to_vec(value).map_err(|_| ())?;
    if payload.is_empty() || payload.len() > WINDOWS_BRIDGE_MAX_FRAME_BYTES {
        return Err(());
    }
    let payload_length = u32::try_from(payload.len()).map_err(|_| ())?;
    let mut frame = Vec::with_capacity(payload.len() + 4);
    frame.extend_from_slice(&payload_length.to_le_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub(crate) fn parse_bridge_frame(frame: &[u8]) -> Result<WindowsBridgeFrame, ()> {
    let length_bytes: [u8; 4] = frame.get(..4).ok_or(())?.try_into().map_err(|_| ())?;
    let payload_length = u32::from_le_bytes(length_bytes) as usize;
    if payload_length == 0
        || payload_length > WINDOWS_BRIDGE_MAX_FRAME_BYTES
        || frame.len() != payload_length + 4
    {
        return Err(());
    }
    project_bridge_value(parse_strict_json(&frame[4..])?)
}

pub(crate) fn redacted_bridge_evidence(frame: &WindowsBridgeFrame) -> Value {
    json!({
        "contractVersion": 1,
        "kind": frame.evidence_kind(),
        "status": "accepted",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn exact_request() -> serde_json::Value {
        json!({
            "contractVersion": 1,
            "invocation": {
                "messages": [{"content": "sensitive prompt", "role": "user"}],
                "purpose": "coding",
                "responseMode": "text-or-tool-call",
                "sessionId": "session-1",
                "tools": []
            },
            "kind": "completion",
            "lease": "lease_0123456789abcdef0123456789abcdef",
            "requestId": "request-1"
        })
    }

    #[test]
    fn round_trips_one_bounded_length_prefixed_model_request() {
        let encoded = encode_bridge_frame(&exact_request()).unwrap();
        let parsed = parse_bridge_frame(&encoded).unwrap();
        assert!(matches!(
            parsed,
            WindowsBridgeFrame::CompletionRequest { .. }
        ));

        let advertised = u32::from_le_bytes(encoded[..4].try_into().unwrap()) as usize;
        assert_eq!(advertised, encoded.len() - 4);
        assert!(advertised <= WINDOWS_BRIDGE_MAX_FRAME_BYTES);
    }

    #[test]
    fn rejects_oversized_mismatched_and_unknown_bridge_frames() {
        let oversized = ((WINDOWS_BRIDGE_MAX_FRAME_BYTES + 1) as u32)
            .to_le_bytes()
            .to_vec();
        assert!(parse_bridge_frame(&oversized).is_err());

        let mut mismatched = 8_u32.to_le_bytes().to_vec();
        mismatched.extend_from_slice(b"{}");
        assert!(parse_bridge_frame(&mismatched).is_err());

        let duplicate_payload = br#"{"contractVersion":1,"kind":"cancel","kind":"completion","lease":"lease_0123456789abcdef0123456789abcdef","requestId":"request-1"}"#;
        let mut duplicate = (duplicate_payload.len() as u32).to_le_bytes().to_vec();
        duplicate.extend_from_slice(duplicate_payload);
        assert!(parse_bridge_frame(&duplicate).is_err());

        let mut unknown = exact_request();
        unknown
            .as_object_mut()
            .unwrap()
            .insert("destination".to_string(), json!("forbidden-destination"));
        assert!(encode_bridge_frame(&unknown).is_err());
    }

    #[test]
    fn redacts_bridge_evidence_before_serialization() {
        let encoded = encode_bridge_frame(&exact_request()).unwrap();
        let parsed = parse_bridge_frame(&encoded).unwrap();
        let evidence = redacted_bridge_evidence(&parsed);
        let serialized = serde_json::to_string(&evidence).unwrap();

        assert!(serialized.contains("completion"));
        for forbidden in [
            "sensitive prompt",
            "lease_0123456789abcdef0123456789abcdef",
            "session-1",
            "request-1",
            "pipe",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }
}
