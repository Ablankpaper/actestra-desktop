use crate::windows_bridge::{
    decode_json_frame, encode_json_frame, exact_bridge_token, has_exact_keys, is_bridge_token,
    WINDOWS_BRIDGE_CONTRACT_VERSION,
};
use serde_json::{json, Value};
use std::collections::HashSet;

const LIST_REQUEST_KEYS: [&str; 5] = ["contractVersion", "kind", "lease", "requestId", "sessionId"];
const LIST_RESPONSE_KEYS: [&str; 4] = ["contractVersion", "kind", "requestId", "tools"];
const CALL_REQUEST_KEYS: [&str; 7] = [
    "arguments",
    "contractVersion",
    "kind",
    "lease",
    "requestId",
    "sessionId",
    "toolName",
];
const CALL_RESPONSE_KEYS: [&str; 5] =
    ["content", "contractVersion", "isError", "kind", "requestId"];
const ERROR_KEYS: [&str; 4] = ["code", "contractVersion", "kind", "requestId"];
const CANCEL_KEYS: [&str; 4] = ["contractVersion", "kind", "lease", "requestId"];
const MAX_TOOL_RESULT_BYTES: usize = 256 * 1024;
const TOOL_NAMES: [&str; 6] = [
    "actestra.coding.file.read-text",
    "actestra.coding.file.write-text",
    "actestra.coding.terminal.run",
    "actestra.coding.git.inspect",
    "actestra.coding.diff.inspect",
    "actestra.coding.test.run",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CapabilityBridgeErrorCode {
    Cancelled,
    CapabilityRequestRejected,
    CapabilityTimeout,
    CapabilityUnavailable,
    ToolExecutionFailed,
}

impl CapabilityBridgeErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::CapabilityRequestRejected => "capability-request-rejected",
            Self::CapabilityTimeout => "capability-timeout",
            Self::CapabilityUnavailable => "capability-unavailable",
            Self::ToolExecutionFailed => "tool-execution-failed",
        }
    }

    fn parse(value: &str) -> Result<Self, ()> {
        match value {
            "cancelled" => Ok(Self::Cancelled),
            "capability-request-rejected" => Ok(Self::CapabilityRequestRejected),
            "capability-timeout" => Ok(Self::CapabilityTimeout),
            "capability-unavailable" => Ok(Self::CapabilityUnavailable),
            "tool-execution-failed" => Ok(Self::ToolExecutionFailed),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CapabilityFrame {
    ListRequest {
        request_id: String,
        lease: String,
        session_id: String,
    },
    ListResponse {
        request_id: String,
        tools: Vec<Value>,
    },
    CallRequest {
        request_id: String,
        lease: String,
        session_id: String,
        tool_name: String,
        arguments: Value,
    },
    CallResponse {
        request_id: String,
        is_error: bool,
        content: String,
    },
    Cancel {
        request_id: String,
        lease: String,
    },
    Error {
        request_id: String,
        code: CapabilityBridgeErrorCode,
    },
}

pub(crate) fn encode_capability_frame(frame: &CapabilityFrame) -> Result<Vec<u8>, ()> {
    let value = match frame {
        CapabilityFrame::ListRequest {
            request_id,
            lease,
            session_id,
        } => json!({
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "list-request",
            "lease": lease,
            "requestId": request_id,
            "sessionId": session_id,
        }),
        CapabilityFrame::ListResponse { request_id, tools } => json!({
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "list-response",
            "requestId": request_id,
            "tools": tools,
        }),
        CapabilityFrame::CallRequest {
            request_id,
            lease,
            session_id,
            tool_name,
            arguments,
        } => json!({
            "arguments": arguments,
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "call-request",
            "lease": lease,
            "requestId": request_id,
            "sessionId": session_id,
            "toolName": tool_name,
        }),
        CapabilityFrame::CallResponse {
            request_id,
            is_error,
            content,
        } => json!({
            "content": content,
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "isError": is_error,
            "kind": "call-response",
            "requestId": request_id,
        }),
        CapabilityFrame::Cancel { request_id, lease } => json!({
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "cancel",
            "lease": lease,
            "requestId": request_id,
        }),
        CapabilityFrame::Error { request_id, code } => json!({
            "code": code.as_str(),
            "contractVersion": WINDOWS_BRIDGE_CONTRACT_VERSION,
            "kind": "capability-error",
            "requestId": request_id,
        }),
    };
    encode_capability_frame_value(&value)
}

pub(crate) fn encode_capability_frame_value(value: &Value) -> Result<Vec<u8>, ()> {
    project_capability_value(value.clone(), None, None)?;
    encode_json_frame(value)
}

pub(crate) fn decode_capability_frame(
    frame: &[u8],
    expected_lease: &str,
    expected_session: &str,
) -> Result<CapabilityFrame, ()> {
    project_capability_value(
        decode_json_frame(frame)?,
        Some(expected_lease),
        Some(expected_session),
    )
}

fn project_capability_value(
    value: Value,
    expected_lease: Option<&str>,
    expected_session: Option<&str>,
) -> Result<CapabilityFrame, ()> {
    let object = value.as_object().ok_or(())?;
    if object.get("contractVersion").and_then(Value::as_u64)
        != Some(WINDOWS_BRIDGE_CONTRACT_VERSION)
    {
        return Err(());
    }
    let kind = object.get("kind").and_then(Value::as_str).ok_or(())?;
    let request_id = exact_bridge_token(object, "requestId", 1, 128)?;
    match kind {
        "list-request" => {
            if !has_exact_keys(object, &LIST_REQUEST_KEYS) {
                return Err(());
            }
            let (lease, session_id) =
                validate_request_scope(object, expected_lease, expected_session)?;
            Ok(CapabilityFrame::ListRequest {
                request_id,
                lease,
                session_id,
            })
        }
        "list-response" => {
            if !has_exact_keys(object, &LIST_RESPONSE_KEYS) {
                return Err(());
            }
            Ok(CapabilityFrame::ListResponse {
                request_id,
                tools: validate_tools(object.get("tools").ok_or(())?)?,
            })
        }
        "call-request" => {
            if !has_exact_keys(object, &CALL_REQUEST_KEYS) {
                return Err(());
            }
            let (lease, session_id) =
                validate_request_scope(object, expected_lease, expected_session)?;
            let tool_name = object.get("toolName").and_then(Value::as_str).ok_or(())?;
            if !TOOL_NAMES.contains(&tool_name) {
                return Err(());
            }
            let arguments = object
                .get("arguments")
                .filter(|value| value.is_object())
                .ok_or(())?;
            Ok(CapabilityFrame::CallRequest {
                request_id,
                lease,
                session_id,
                tool_name: tool_name.to_string(),
                arguments: arguments.clone(),
            })
        }
        "call-response" => {
            if !has_exact_keys(object, &CALL_RESPONSE_KEYS) {
                return Err(());
            }
            let content = object.get("content").and_then(Value::as_str).ok_or(())?;
            if content.contains('\0') || content.len() > MAX_TOOL_RESULT_BYTES {
                return Err(());
            }
            Ok(CapabilityFrame::CallResponse {
                request_id,
                is_error: object.get("isError").and_then(Value::as_bool).ok_or(())?,
                content: content.to_string(),
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
            Ok(CapabilityFrame::Cancel { request_id, lease })
        }
        "capability-error" => {
            if !has_exact_keys(object, &ERROR_KEYS) {
                return Err(());
            }
            Ok(CapabilityFrame::Error {
                request_id,
                code: CapabilityBridgeErrorCode::parse(
                    object.get("code").and_then(Value::as_str).ok_or(())?,
                )?,
            })
        }
        _ => Err(()),
    }
}

fn validate_request_scope(
    object: &serde_json::Map<String, Value>,
    expected_lease: Option<&str>,
    expected_session: Option<&str>,
) -> Result<(String, String), ()> {
    let lease = exact_bridge_token(object, "lease", 32, 256)?;
    let session_id = exact_bridge_token(object, "sessionId", 1, 256)?;
    if expected_lease.is_some_and(|expected| expected != lease)
        || expected_session.is_some_and(|expected| expected != session_id)
    {
        return Err(());
    }
    Ok((lease, session_id))
}

fn validate_tools(value: &Value) -> Result<Vec<Value>, ()> {
    let tools = value.as_array().ok_or(())?;
    if tools.len() != TOOL_NAMES.len() {
        return Err(());
    }
    let mut names = HashSet::new();
    for tool in tools {
        let object = tool.as_object().ok_or(())?;
        let keys = if object.contains_key("description") {
            &["description", "inputSchema", "name"][..]
        } else {
            &["inputSchema", "name"][..]
        };
        if !has_exact_keys(object, keys) || !object.get("inputSchema").is_some_and(Value::is_object)
        {
            return Err(());
        }
        let name = object.get("name").and_then(Value::as_str).ok_or(())?;
        if !is_bridge_token(name, 1, 256) || !TOOL_NAMES.contains(&name) || !names.insert(name) {
            return Err(());
        }
        if object.get("description").is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|description| description.contains('\0') || description.len() > 4096)
        }) {
            return Err(());
        }
    }
    if names.len() != TOOL_NAMES.len() {
        return Err(());
    }
    Ok(tools.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const LEASE: &str = "lease_0123456789abcdef0123456789abcdef";
    const SESSION: &str = "session-1";
    const TOOL_NAMES: [&str; 6] = [
        "actestra.coding.file.read-text",
        "actestra.coding.file.write-text",
        "actestra.coding.terminal.run",
        "actestra.coding.git.inspect",
        "actestra.coding.diff.inspect",
        "actestra.coding.test.run",
    ];

    fn tool_definitions() -> Vec<Value> {
        TOOL_NAMES
            .iter()
            .map(|name| json!({"inputSchema": {}, "name": name}))
            .collect()
    }

    fn raw_frame(payload: &[u8]) -> Vec<u8> {
        let mut frame = (payload.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(payload);
        frame
    }

    #[test]
    fn round_trips_the_exact_capability_frame_vocabulary() {
        for frame in [
            CapabilityFrame::ListRequest {
                request_id: "request-1".to_string(),
                lease: LEASE.to_string(),
                session_id: SESSION.to_string(),
            },
            CapabilityFrame::ListResponse {
                request_id: "request-1".to_string(),
                tools: tool_definitions(),
            },
            CapabilityFrame::CallRequest {
                request_id: "request-2".to_string(),
                lease: LEASE.to_string(),
                session_id: SESSION.to_string(),
                tool_name: TOOL_NAMES[0].to_string(),
                arguments: json!({"contractVersion": 1, "relativePath": "README.md"}),
            },
            CapabilityFrame::CallResponse {
                request_id: "request-2".to_string(),
                is_error: false,
                content: "bounded result".to_string(),
            },
            CapabilityFrame::Cancel {
                request_id: "request-2".to_string(),
                lease: LEASE.to_string(),
            },
            CapabilityFrame::Error {
                request_id: "request-2".to_string(),
                code: CapabilityBridgeErrorCode::CapabilityUnavailable,
            },
        ] {
            let encoded = encode_capability_frame(&frame).unwrap();
            assert_eq!(
                decode_capability_frame(&encoded, LEASE, SESSION).unwrap(),
                frame
            );
        }
    }

    #[test]
    fn rejects_unknown_duplicate_and_cross_pipe_capability_frames() {
        let duplicate = br#"{"contractVersion":1,"kind":"cancel","kind":"call-request","lease":"lease_0123456789abcdef0123456789abcdef","requestId":"request-1"}"#;
        assert!(decode_capability_frame(&raw_frame(duplicate), LEASE, SESSION).is_err());

        for invalid in [
            json!({
                "contractVersion": 1,
                "kind": "list-request",
                "lease": LEASE,
                "requestId": "request-1",
                "sessionId": SESSION,
                "unexpected": true
            }),
            json!({
                "contractVersion": 1,
                "kind": "completion-response",
                "requestId": "request-1",
                "completion": {"text": "x", "type": "message", "usage": {"completionTokens": 1, "promptTokens": 1}}
            }),
        ] {
            assert!(encode_capability_frame_value(&invalid).is_err());
        }
    }

    #[test]
    fn rejects_wrong_lease_session_and_tools_outside_the_six_ids() {
        let list = CapabilityFrame::ListRequest {
            request_id: "request-1".to_string(),
            lease: LEASE.to_string(),
            session_id: SESSION.to_string(),
        };
        let encoded = encode_capability_frame(&list).unwrap();
        assert!(decode_capability_frame(
            &encoded,
            "lease_wrong_0123456789abcdef0123456789",
            SESSION,
        )
        .is_err());
        assert!(decode_capability_frame(&encoded, LEASE, "session-2").is_err());

        let invalid_call = CapabilityFrame::CallRequest {
            request_id: "request-2".to_string(),
            lease: LEASE.to_string(),
            session_id: SESSION.to_string(),
            tool_name: "actestra.coding.artifact.publish".to_string(),
            arguments: json!({}),
        };
        assert!(encode_capability_frame(&invalid_call).is_err());

        let mut invalid_tools = tool_definitions();
        invalid_tools[5]["name"] = json!("actestra.coding.artifact.publish");
        assert!(encode_capability_frame(&CapabilityFrame::ListResponse {
            request_id: "request-1".to_string(),
            tools: invalid_tools,
        })
        .is_err());
    }
}
