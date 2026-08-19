use crate::windows_bridge::{
    decode_json_frame, encode_json_frame, exact_bridge_token, has_exact_keys, is_bridge_token,
    WINDOWS_BRIDGE_CONTRACT_VERSION,
};
use serde_json::{json, Map, Value};

const COMPLETION_REQUEST_KEYS: [&str; 6] = [
    "contractVersion",
    "invocation",
    "kind",
    "lease",
    "requestId",
    "sessionId",
];
const COMPLETION_RESPONSE_KEYS: [&str; 4] = ["completion", "contractVersion", "kind", "requestId"];
const ERROR_KEYS: [&str; 4] = ["code", "contractVersion", "kind", "requestId"];
const CANCEL_KEYS: [&str; 4] = ["contractVersion", "kind", "lease", "requestId"];
const INVOCATION_KEYS: [&str; 5] = ["messages", "purpose", "responseMode", "sessionId", "tools"];
const MAX_MESSAGES: usize = 512;
const MAX_TOOLS: usize = 128;
const MAX_TEXT_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ModelBridgeErrorCode {
    Cancelled,
    ModelCompletionRefused,
    ModelRequestRejected,
    ModelTimeout,
    ModelUnavailable,
}

impl ModelBridgeErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::ModelCompletionRefused => "model-completion-refused",
            Self::ModelRequestRejected => "model-request-rejected",
            Self::ModelTimeout => "model-timeout",
            Self::ModelUnavailable => "model-unavailable",
        }
    }

    fn parse(value: &str) -> Result<Self, ()> {
        match value {
            "cancelled" => Ok(Self::Cancelled),
            "model-completion-refused" => Ok(Self::ModelCompletionRefused),
            "model-request-rejected" => Ok(Self::ModelRequestRejected),
            "model-timeout" => Ok(Self::ModelTimeout),
            "model-unavailable" => Ok(Self::ModelUnavailable),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum ModelFrame {
    CompletionRequest {
        request_id: String,
        lease: String,
        session_id: String,
        invocation: Value,
    },
    CompletionResponse {
        request_id: String,
        completion: Value,
    },
    Error {
        request_id: String,
        code: ModelBridgeErrorCode,
    },
    Cancel {
        request_id: String,
        lease: String,
    },
}

pub(crate) fn encode_model_frame(frame: &ModelFrame) -> Result<Vec<u8>, ()> {
    let value = match frame {
        ModelFrame::CompletionRequest {
            request_id,
            lease,
            session_id,
            invocation,
        } => json!({
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "invocation": invocation,
            "kind": "completion-request",
            "lease": lease,
            "requestId": request_id,
            "sessionId": session_id,
        }),
        ModelFrame::CompletionResponse {
            request_id,
            completion,
        } => json!({
            "completion": completion,
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "completion-response",
            "requestId": request_id,
        }),
        ModelFrame::Error { request_id, code } => json!({
            "code": code.as_str(),
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "model-error",
            "requestId": request_id,
        }),
        ModelFrame::Cancel { request_id, lease } => json!({
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "cancel",
            "lease": lease,
            "requestId": request_id,
        }),
    };
    encode_model_frame_value(&value)
}

pub(crate) fn encode_model_frame_value(value: &Value) -> Result<Vec<u8>, ()> {
    project_model_value(value.clone(), None, None)?;
    encode_json_frame(value)
}

pub(crate) fn decode_model_frame(
    frame: &[u8],
    expected_lease: &str,
    expected_session: &str,
) -> Result<ModelFrame, ()> {
    project_model_value(
        decode_json_frame(frame)?,
        Some(expected_lease),
        Some(expected_session),
    )
}

fn project_model_value(
    value: Value,
    expected_lease: Option<&str>,
    expected_session: Option<&str>,
) -> Result<ModelFrame, ()> {
    let object = value.as_object().ok_or(())?;
    if object.get("contractVersion").and_then(Value::as_u64)
        != Some(WINDOWS_BRIDGE_CONTRACT_VERSION)
    {
        return Err(());
    }
    let kind = object.get("kind").and_then(Value::as_str).ok_or(())?;
    let request_id = exact_bridge_token(object, "requestId", 1, 128)?;
    match kind {
        "completion-request" => {
            if !has_exact_keys(object, &COMPLETION_REQUEST_KEYS) {
                return Err(());
            }
            let lease = exact_bridge_token(object, "lease", 32, 256)?;
            let session_id = exact_bridge_token(object, "sessionId", 1, 256)?;
            if expected_lease.is_some_and(|expected| expected != lease)
                || expected_session.is_some_and(|expected| expected != session_id)
            {
                return Err(());
            }
            let invocation = validate_invocation(object.get("invocation").ok_or(())?, &session_id)?;
            Ok(ModelFrame::CompletionRequest {
                request_id,
                lease,
                session_id,
                invocation,
            })
        }
        "completion-response" => {
            if !has_exact_keys(object, &COMPLETION_RESPONSE_KEYS) {
                return Err(());
            }
            Ok(ModelFrame::CompletionResponse {
                request_id,
                completion: validate_completion(object.get("completion").ok_or(())?)?,
            })
        }
        "model-error" => {
            if !has_exact_keys(object, &ERROR_KEYS) {
                return Err(());
            }
            Ok(ModelFrame::Error {
                request_id,
                code: ModelBridgeErrorCode::parse(
                    object.get("code").and_then(Value::as_str).ok_or(())?,
                )?,
            })
        }
        "cancel" => {
            if !has_exact_keys(object, &CANCEL_KEYS) {
                return Err(());
            }
            let lease = exact_bridge_token(object, "lease", 32, 256)?;
            if expected_lease.is_some_and(|expected| expected != lease) {
                return Err(());
            }
            Ok(ModelFrame::Cancel { request_id, lease })
        }
        _ => Err(()),
    }
}

fn validate_invocation(value: &Value, envelope_session: &str) -> Result<Value, ()> {
    let object = value.as_object().ok_or(())?;
    if !has_exact_keys(object, &INVOCATION_KEYS)
        || object.get("purpose").and_then(Value::as_str) != Some("coding")
        || object.get("responseMode").and_then(Value::as_str) != Some("text-or-tool-call")
        || object.get("sessionId").and_then(Value::as_str) != Some(envelope_session)
    {
        return Err(());
    }
    let messages = object.get("messages").and_then(Value::as_array).ok_or(())?;
    let tools = object.get("tools").and_then(Value::as_array).ok_or(())?;
    if messages.is_empty()
        || messages.len() > MAX_MESSAGES
        || tools.len() > MAX_TOOLS
        || messages
            .iter()
            .any(|message| validate_message(message).is_err())
        || tools.iter().any(|tool| validate_tool(tool).is_err())
    {
        return Err(());
    }
    let mut names = HashSet::new();
    for tool in tools {
        let name = tool
            .as_object()
            .and_then(|tool| tool.get("name"))
            .and_then(Value::as_str)
            .ok_or(())?;
        if !names.insert(name) {
            return Err(());
        }
    }
    Ok(value.clone())
}

use std::collections::HashSet;

fn validate_message(value: &Value) -> Result<(), ()> {
    let object = value.as_object().ok_or(())?;
    let role = object.get("role").and_then(Value::as_str).ok_or(())?;
    match role {
        "system" | "user" => validate_content_message(object),
        "assistant" if object.contains_key("content") => validate_content_message(object),
        "assistant" => {
            if !has_exact_keys(object, &["role", "toolCalls"]) {
                return Err(());
            }
            let calls = object
                .get("toolCalls")
                .and_then(Value::as_array)
                .ok_or(())?;
            if calls.len() != 1 {
                return Err(());
            }
            validate_tool_call(&calls[0])
        }
        "tool" => {
            if !has_exact_keys(object, &["callId", "content", "role"])
                || !is_bridge_token(
                    object.get("callId").and_then(Value::as_str).ok_or(())?,
                    1,
                    128,
                )
            {
                return Err(());
            }
            validate_bounded_text(object.get("content").and_then(Value::as_str).ok_or(())?)
        }
        _ => Err(()),
    }
}

fn validate_content_message(object: &Map<String, Value>) -> Result<(), ()> {
    if !has_exact_keys(object, &["content", "role"]) {
        return Err(());
    }
    validate_bounded_text(object.get("content").and_then(Value::as_str).ok_or(())?)
}

fn validate_tool_call(value: &Value) -> Result<(), ()> {
    let object = value.as_object().ok_or(())?;
    if !has_exact_keys(object, &["arguments", "callId", "name"])
        || !is_bridge_token(
            object.get("callId").and_then(Value::as_str).ok_or(())?,
            1,
            128,
        )
        || !is_bridge_token(
            object.get("name").and_then(Value::as_str).ok_or(())?,
            1,
            256,
        )
        || !object.get("arguments").is_some_and(Value::is_object)
    {
        return Err(());
    }
    Ok(())
}

fn validate_tool(value: &Value) -> Result<(), ()> {
    let object = value.as_object().ok_or(())?;
    let keys = if object.contains_key("description") {
        &["description", "inputSchema", "name"][..]
    } else {
        &["inputSchema", "name"][..]
    };
    if !has_exact_keys(object, keys)
        || !is_bridge_token(
            object.get("name").and_then(Value::as_str).ok_or(())?,
            1,
            256,
        )
        || !object.get("inputSchema").is_some_and(Value::is_object)
    {
        return Err(());
    }
    if let Some(description) = object.get("description") {
        validate_bounded_text(description.as_str().ok_or(())?)?;
    }
    Ok(())
}

fn validate_completion(value: &Value) -> Result<Value, ()> {
    let object = value.as_object().ok_or(())?;
    match object.get("type").and_then(Value::as_str) {
        Some("message") => {
            if !has_exact_keys(object, &["text", "type", "usage"]) {
                return Err(());
            }
            validate_bounded_text(object.get("text").and_then(Value::as_str).ok_or(())?)?;
        }
        Some("tool-call") => {
            if !has_exact_keys(object, &["arguments", "callId", "name", "type", "usage"])
                || !is_bridge_token(
                    object.get("callId").and_then(Value::as_str).ok_or(())?,
                    1,
                    128,
                )
                || !is_bridge_token(
                    object.get("name").and_then(Value::as_str).ok_or(())?,
                    1,
                    256,
                )
                || !object.get("arguments").is_some_and(Value::is_object)
            {
                return Err(());
            }
        }
        _ => return Err(()),
    }
    validate_usage(object.get("usage").ok_or(())?)?;
    Ok(value.clone())
}

fn validate_usage(value: &Value) -> Result<(), ()> {
    let object = value.as_object().ok_or(())?;
    if !has_exact_keys(object, &["completionTokens", "promptTokens"]) {
        return Err(());
    }
    let completion = object
        .get("completionTokens")
        .and_then(Value::as_u64)
        .ok_or(())?;
    let prompt = object
        .get("promptTokens")
        .and_then(Value::as_u64)
        .ok_or(())?;
    completion.checked_add(prompt).ok_or(())?;
    Ok(())
}

fn validate_bounded_text(value: &str) -> Result<(), ()> {
    if value.contains('\0') || value.len() > MAX_TEXT_BYTES {
        return Err(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const LEASE: &str = "lease_0123456789abcdef0123456789abcdef";
    const SESSION: &str = "session-1";

    fn invocation() -> Value {
        json!({
            "messages": [{"content": "bounded prompt", "role": "user"}],
            "purpose": "coding",
            "responseMode": "text-or-tool-call",
            "sessionId": SESSION,
            "tools": []
        })
    }

    fn request() -> ModelFrame {
        ModelFrame::CompletionRequest {
            request_id: "request-1".to_string(),
            lease: LEASE.to_string(),
            session_id: SESSION.to_string(),
            invocation: invocation(),
        }
    }

    fn raw_frame(payload: &[u8]) -> Vec<u8> {
        let mut frame = (payload.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(payload);
        frame
    }

    #[test]
    fn round_trips_the_exact_model_frame_vocabulary() {
        for frame in [
            request(),
            ModelFrame::CompletionResponse {
                request_id: "request-1".to_string(),
                completion: json!({
                    "text": "bounded answer",
                    "type": "message",
                    "usage": {"completionTokens": 2, "promptTokens": 3}
                }),
            },
            ModelFrame::Error {
                request_id: "request-1".to_string(),
                code: ModelBridgeErrorCode::ModelUnavailable,
            },
            ModelFrame::Cancel {
                request_id: "request-1".to_string(),
                lease: LEASE.to_string(),
            },
        ] {
            let encoded = encode_model_frame(&frame).unwrap();
            assert_eq!(decode_model_frame(&encoded, LEASE, SESSION).unwrap(), frame);
        }
    }

    #[test]
    fn rejects_invalid_length_duplicate_unknown_and_cross_pipe_frames() {
        assert!(decode_model_frame(&0_u32.to_le_bytes(), LEASE, SESSION).is_err());
        assert!(decode_model_frame(
            &((crate::windows_bridge::WINDOWS_BRIDGE_MAX_FRAME_BYTES + 1) as u32).to_le_bytes(),
            LEASE,
            SESSION,
        )
        .is_err());

        let mut trailing = encode_model_frame(&request()).unwrap();
        trailing.push(0);
        assert!(decode_model_frame(&trailing, LEASE, SESSION).is_err());

        let duplicate = br#"{"contractVersion":1,"kind":"cancel","kind":"completion-request","lease":"lease_0123456789abcdef0123456789abcdef","requestId":"request-1"}"#;
        assert!(decode_model_frame(&raw_frame(duplicate), LEASE, SESSION).is_err());

        for invalid in [
            json!({
                "contractVersion": 1,
                "invocation": invocation(),
                "kind": "completion-request",
                "lease": LEASE,
                "requestId": "request-1",
                "sessionId": SESSION,
                "unexpected": true
            }),
            json!({
                "contractVersion": 1,
                "kind": "unknown",
                "lease": LEASE,
                "requestId": "request-1"
            }),
            json!({
                "contractVersion": 1,
                "kind": "list-request",
                "lease": LEASE,
                "requestId": "request-1",
                "sessionId": SESSION
            }),
        ] {
            assert!(encode_model_frame_value(&invalid).is_err());
        }
    }

    #[test]
    fn rejects_invalid_identity_lease_and_session() {
        let encoded = encode_model_frame(&request()).unwrap();
        assert!(
            decode_model_frame(&encoded, "lease_wrong_0123456789abcdef0123456789", SESSION)
                .is_err()
        );
        assert!(decode_model_frame(&encoded, LEASE, "session-2").is_err());

        let mut invalid = request();
        if let ModelFrame::CompletionRequest { request_id, .. } = &mut invalid {
            *request_id = "request with spaces".to_string();
        }
        assert!(encode_model_frame(&invalid).is_err());
    }

    #[test]
    fn rejects_unsupported_roles_and_model_limits() {
        let mut unsupported_role = invocation();
        unsupported_role["messages"] = json!([{"content": "x", "role": "developer"}]);
        assert!(encode_completion_request(unsupported_role).is_err());

        let mut too_many_messages = invocation();
        too_many_messages["messages"] = Value::Array(
            (0..513)
                .map(|_| json!({"content": "x", "role": "user"}))
                .collect(),
        );
        assert!(encode_completion_request(too_many_messages).is_err());

        let mut too_many_tools = invocation();
        too_many_tools["tools"] = Value::Array(
            (0..129)
                .map(|index| json!({"inputSchema": {}, "name": format!("tool-{index}")}))
                .collect(),
        );
        assert!(encode_completion_request(too_many_tools).is_err());

        let mut multiple_tool_calls = invocation();
        multiple_tool_calls["messages"] = json!([{
            "role": "assistant",
            "toolCalls": [
                {"arguments": {}, "callId": "call-1", "name": "tool-1"},
                {"arguments": {}, "callId": "call-2", "name": "tool-2"}
            ]
        }]);
        assert!(encode_completion_request(multiple_tool_calls).is_err());
    }

    fn encode_completion_request(invocation: Value) -> Result<Vec<u8>, ()> {
        encode_model_frame(&ModelFrame::CompletionRequest {
            request_id: "request-1".to_string(),
            lease: LEASE.to_string(),
            session_id: SESSION.to_string(),
            invocation,
        })
    }
}
