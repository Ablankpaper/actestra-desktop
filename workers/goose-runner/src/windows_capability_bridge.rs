use crate::windows_bridge::{
    decode_json_frame, encode_json_frame, exact_bridge_token, has_exact_keys, is_bridge_token,
    PendingRequests, WindowsBridgeChannel, WINDOWS_BRIDGE_CONTRACT_VERSION,
    WINDOWS_BRIDGE_MAX_PENDING_REQUESTS,
};
use goose::agents::mcp_client::McpClientTrait;
use goose::agents::ToolCallContext;
use rmcp::model::{
    CallToolResult, ContentBlock, Implementation, InitializeResult, JsonObject, ListToolsResult,
    ServerCapabilities, Tool,
};
use rmcp::ServiceError;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};
use tokio_util::sync::CancellationToken;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowsCapabilityBridgeError {
    InvalidLease,
}

impl std::fmt::Display for WindowsCapabilityBridgeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("invalid Windows capability bridge lease")
    }
}

impl std::error::Error for WindowsCapabilityBridgeError {}

struct CapabilityBridgeState {
    channel: WindowsBridgeChannel,
    pending: PendingRequests,
}

pub(crate) struct WindowsCapabilityClient {
    state: Arc<Mutex<CapabilityBridgeState>>,
    lease: String,
    session_id: Arc<OnceCell<String>>,
    info: InitializeResult,
    next_request_id: AtomicU64,
}

impl WindowsCapabilityClient {
    pub(crate) fn new(
        channel: WindowsBridgeChannel,
        lease: String,
        session_id: Arc<OnceCell<String>>,
    ) -> Result<Self, WindowsCapabilityBridgeError> {
        if !is_bridge_token(&lease, 32, 256) {
            return Err(WindowsCapabilityBridgeError::InvalidLease);
        }
        let mut capabilities = ServerCapabilities::default();
        capabilities.tools = Some(Default::default());
        Ok(Self {
            state: Arc::new(Mutex::new(CapabilityBridgeState {
                channel,
                pending: PendingRequests::new(WINDOWS_BRIDGE_MAX_PENDING_REQUESTS)
                    .expect("fixed Windows capability request capacity is valid"),
            })),
            lease,
            session_id,
            info: InitializeResult::new(capabilities).with_server_info(Implementation::new(
                "actestra-capability-proxy",
                env!("CARGO_PKG_VERSION"),
            )),
            next_request_id: AtomicU64::new(1),
        })
    }

    fn checked_session(&self, requested: &str) -> Result<String, ServiceError> {
        let session = self
            .session_id
            .get()
            .filter(|session| session.as_str() == requested)
            .filter(|session| is_bridge_token(session, 1, 256))
            .ok_or(ServiceError::TransportClosed)?;
        Ok(session.clone())
    }

    fn bind_or_check_session(&self, requested: &str) -> Result<String, ServiceError> {
        if !is_bridge_token(requested, 1, 256) {
            return Err(ServiceError::TransportClosed);
        }
        if let Some(session) = self.session_id.get() {
            return (session == requested)
                .then(|| session.clone())
                .ok_or(ServiceError::TransportClosed);
        }
        if self.session_id.set(requested.to_string()).is_err() {
            return self.checked_session(requested);
        }
        Ok(requested.to_string())
    }

    fn list_request_id(&self) -> Result<String, ServiceError> {
        self.next_request_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map(|value| format!("capability-{value}"))
            .map_err(|_| ServiceError::TransportClosed)
    }

    async fn exchange(
        &self,
        request_id: &str,
        request: CapabilityFrame,
        cancel_token: CancellationToken,
    ) -> Result<CapabilityFrame, ServiceError> {
        let encoded =
            encode_capability_frame(&request).map_err(|_| ServiceError::TransportClosed)?;
        let session_id = self
            .session_id
            .get()
            .cloned()
            .ok_or(ServiceError::TransportClosed)?;
        let mut cancellation = CapabilityRequestCancellation::new(
            self.state.clone(),
            request_id.to_string(),
            self.lease.clone(),
        );
        let mut state = self.state.lock().await;
        state
            .pending
            .begin(request_id)
            .map_err(|_| ServiceError::TransportClosed)?;
        if state.channel.write_frame(&encoded).await.is_err() {
            let _ = state.pending.cancel(request_id);
            cancellation.disarm();
            return Err(ServiceError::TransportClosed);
        }
        let read_result = tokio::select! {
            _ = cancel_token.cancelled() => {
                cancel_capability_request(&mut state, request_id, &self.lease).await;
                cancellation.disarm();
                return Err(ServiceError::Cancelled { reason: None });
            }
            result = state.channel.read_frame() => result,
        };
        let response = match read_result {
            Ok(frame) => decode_capability_frame(&frame, &self.lease, &session_id),
            Err(()) => Err(()),
        };
        let response = match response {
            Ok(response) => response,
            Err(()) => {
                cancel_capability_request(&mut state, request_id, &self.lease).await;
                cancellation.disarm();
                return Err(ServiceError::TransportClosed);
            }
        };
        let response_request_id = match &response {
            CapabilityFrame::ListResponse { request_id, .. }
            | CapabilityFrame::CallResponse { request_id, .. }
            | CapabilityFrame::Error { request_id, .. } => request_id,
            _ => {
                cancel_capability_request(&mut state, request_id, &self.lease).await;
                cancellation.disarm();
                return Err(ServiceError::TransportClosed);
            }
        };
        if response_request_id != request_id || state.pending.complete(request_id).is_err() {
            let _ = state.pending.cancel(request_id);
            cancellation.disarm();
            return Err(ServiceError::TransportClosed);
        }
        cancellation.disarm();
        match response {
            CapabilityFrame::Error { code, .. } => Err(capability_error(code)),
            response => Ok(response),
        }
    }
}

#[async_trait::async_trait]
impl McpClientTrait for WindowsCapabilityClient {
    async fn list_tools(
        &self,
        session_id: &str,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, ServiceError> {
        if next_cursor.is_some() {
            return Err(ServiceError::TransportClosed);
        }
        let session_id = self.bind_or_check_session(session_id)?;
        let request_id = self.list_request_id()?;
        let response = self
            .exchange(
                &request_id,
                CapabilityFrame::ListRequest {
                    request_id: request_id.clone(),
                    lease: self.lease.clone(),
                    session_id,
                },
                cancel_token,
            )
            .await?;
        let CapabilityFrame::ListResponse { tools, .. } = response else {
            return Err(ServiceError::TransportClosed);
        };
        let tools = tools
            .into_iter()
            .map(serde_json::from_value::<Tool>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ServiceError::TransportClosed)?;
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        ctx: &ToolCallContext,
        name: &str,
        arguments: Option<JsonObject>,
        cancel_token: CancellationToken,
    ) -> Result<CallToolResult, ServiceError> {
        let session_id = self.checked_session(&ctx.session_id)?;
        let request_id = ctx
            .tool_call_request_id
            .as_deref()
            .filter(|request_id| is_bridge_token(request_id, 1, 128))
            .ok_or(ServiceError::TransportClosed)?
            .to_string();
        if !TOOL_NAMES.contains(&name) {
            return Err(ServiceError::TransportClosed);
        }
        let response = self
            .exchange(
                &request_id,
                CapabilityFrame::CallRequest {
                    request_id: request_id.clone(),
                    lease: self.lease.clone(),
                    session_id,
                    tool_name: name.to_string(),
                    arguments: Value::Object(arguments.unwrap_or_default()),
                },
                cancel_token,
            )
            .await?;
        let CapabilityFrame::CallResponse {
            is_error, content, ..
        } = response
        else {
            return Err(ServiceError::TransportClosed);
        };
        let content = vec![ContentBlock::text(content)];
        Ok(if is_error {
            CallToolResult::error(content)
        } else {
            CallToolResult::success(content)
        })
    }

    fn get_info(&self) -> Option<&InitializeResult> {
        Some(&self.info)
    }
}

struct CapabilityRequestCancellation {
    state: Arc<Mutex<CapabilityBridgeState>>,
    request_id: String,
    lease: String,
    armed: bool,
}

impl CapabilityRequestCancellation {
    fn new(state: Arc<Mutex<CapabilityBridgeState>>, request_id: String, lease: String) -> Self {
        Self {
            state,
            request_id,
            lease,
            armed: true,
        }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for CapabilityRequestCancellation {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let state = self.state.clone();
        let request_id = self.request_id.clone();
        let lease = self.lease.clone();
        runtime.spawn(async move {
            let mut state = state.lock().await;
            cancel_capability_request(&mut state, &request_id, &lease).await;
        });
    }
}

async fn cancel_capability_request(
    state: &mut CapabilityBridgeState,
    request_id: &str,
    lease: &str,
) {
    if state.pending.cancel(request_id).is_ok() {
        if let Ok(frame) = encode_capability_frame(&CapabilityFrame::Cancel {
            request_id: request_id.to_string(),
            lease: lease.to_string(),
        }) {
            let _ = state.channel.write_frame(&frame).await;
        }
    }
}

fn capability_error(code: CapabilityBridgeErrorCode) -> ServiceError {
    match code {
        CapabilityBridgeErrorCode::Cancelled => ServiceError::Cancelled { reason: None },
        CapabilityBridgeErrorCode::CapabilityRequestRejected
        | CapabilityBridgeErrorCode::CapabilityTimeout
        | CapabilityBridgeErrorCode::CapabilityUnavailable
        | CapabilityBridgeErrorCode::ToolExecutionFailed => ServiceError::TransportClosed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use goose::agents::mcp_client::McpClientTrait;
    use goose::agents::ToolCallContext;
    use rmcp::model::JsonObject;
    use rmcp::ServiceError;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::sync::OnceCell;
    use tokio_util::sync::CancellationToken;

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

    fn capability_client(worker: tokio::io::DuplexStream) -> WindowsCapabilityClient {
        let session = Arc::new(OnceCell::new());
        session.set(SESSION.to_string()).unwrap();
        WindowsCapabilityClient::new(
            crate::windows_bridge::WindowsBridgeChannel::from_duplex(worker),
            LEASE.to_string(),
            session,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn windows_capability_bridge_discovers_exactly_six_tools_through_the_real_trait() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let client = capability_client(worker);
        let main = tokio::spawn(async move {
            let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
            let request =
                decode_capability_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
            let CapabilityFrame::ListRequest { request_id, .. } = request else {
                panic!("expected list request");
            };
            main.write_frame(
                &encode_capability_frame(&CapabilityFrame::ListResponse {
                    request_id,
                    tools: tool_definitions(),
                })
                .unwrap(),
            )
            .await
            .unwrap();
        });

        let listed = McpClientTrait::list_tools(&client, SESSION, None, CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(
            listed
                .tools
                .iter()
                .map(|tool| tool.name.as_ref())
                .collect::<Vec<_>>(),
            TOOL_NAMES
        );
        let info = McpClientTrait::get_info(&client).unwrap();
        assert_eq!(info.server_info.name, "actestra-capability-proxy");
        assert!(info.capabilities.tools.is_some());
        assert!(info.capabilities.resources.is_none());
        assert!(info.capabilities.prompts.is_none());
        main.await.unwrap();
    }

    #[tokio::test]
    async fn windows_capability_bridge_binds_the_runtime_session_on_first_tool_discovery() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let session = Arc::new(OnceCell::new());
        let client = WindowsCapabilityClient::new(
            crate::windows_bridge::WindowsBridgeChannel::from_duplex(worker),
            LEASE.to_string(),
            session.clone(),
        )
        .unwrap();
        let main = tokio::spawn(async move {
            let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
            let request =
                decode_capability_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
            let CapabilityFrame::ListRequest { request_id, .. } = request else {
                panic!("expected list request");
            };
            main.write_frame(
                &encode_capability_frame(&CapabilityFrame::ListResponse {
                    request_id,
                    tools: tool_definitions(),
                })
                .unwrap(),
            )
            .await
            .unwrap();
        });

        let listed = McpClientTrait::list_tools(&client, SESSION, None, CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(listed.tools.len(), TOOL_NAMES.len());
        assert_eq!(session.get().map(String::as_str), Some(SESSION));
        main.await.unwrap();
    }

    #[tokio::test]
    async fn windows_capability_bridge_calls_one_tool_with_the_goose_request_id() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let client = capability_client(worker);
        let main = tokio::spawn(async move {
            let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
            let request =
                decode_capability_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
            let CapabilityFrame::CallRequest {
                request_id,
                tool_name,
                arguments,
                ..
            } = request
            else {
                panic!("expected call request");
            };
            assert_eq!(request_id, "call-1");
            assert_eq!(tool_name, TOOL_NAMES[0]);
            assert_eq!(arguments["relativePath"], json!("README.md"));
            main.write_frame(
                &encode_capability_frame(&CapabilityFrame::CallResponse {
                    request_id,
                    is_error: false,
                    content: "bounded tool result".to_string(),
                })
                .unwrap(),
            )
            .await
            .unwrap();
        });

        let mut arguments = JsonObject::new();
        arguments.insert("relativePath".to_string(), json!("README.md"));
        let result = McpClientTrait::call_tool(
            &client,
            &ToolCallContext::new(SESSION.to_string(), None, Some("call-1".to_string())),
            TOOL_NAMES[0],
            Some(arguments),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(result.is_error, Some(false));
        assert_eq!(
            result.content[0].as_text().unwrap().text,
            "bounded tool result"
        );
        main.await.unwrap();
    }

    #[tokio::test]
    async fn windows_capability_bridge_sends_cancel_when_the_token_wins() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let client = Arc::new(capability_client(worker));
        let cancel_token = CancellationToken::new();
        let worker_task = {
            let client = client.clone();
            let cancel_token = cancel_token.clone();
            tokio::spawn(async move {
                McpClientTrait::call_tool(
                    client.as_ref(),
                    &ToolCallContext::new(SESSION.to_string(), None, Some("call-2".to_string())),
                    TOOL_NAMES[0],
                    None,
                    cancel_token,
                )
                .await
            })
        };
        let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
        main.read_frame().await.unwrap();
        cancel_token.cancel();
        let cancel =
            decode_capability_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
        assert_eq!(
            cancel,
            CapabilityFrame::Cancel {
                request_id: "call-2".to_string(),
                lease: LEASE.to_string()
            }
        );
        assert!(matches!(
            worker_task.await.unwrap(),
            Err(ServiceError::Cancelled { .. })
        ));
    }

    #[tokio::test]
    async fn windows_capability_bridge_fails_closed_and_rejects_non_tool_surfaces() {
        for malformed in [true, false] {
            let (worker, main) = tokio::io::duplex(64 * 1024);
            let client = capability_client(worker);
            let main = tokio::spawn(async move {
                let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
                main.read_frame().await.unwrap();
                if malformed {
                    main.write_frame(
                        &crate::windows_bridge::encode_json_frame(&json!({
                            "contractVersion": 1,
                            "kind": "malformed-capability-response"
                        }))
                        .unwrap(),
                    )
                    .await
                    .unwrap();
                }
            });
            let error =
                McpClientTrait::list_tools(&client, SESSION, None, CancellationToken::new())
                    .await
                    .unwrap_err();
            assert!(matches!(error, ServiceError::TransportClosed));
            assert!(!error.to_string().contains("malformed-capability-response"));
            main.await.unwrap();
        }

        let (worker, _main) = tokio::io::duplex(64 * 1024);
        let client = capability_client(worker);
        assert!(matches!(
            McpClientTrait::list_resources(&client, SESSION, None, CancellationToken::new()).await,
            Err(ServiceError::TransportClosed)
        ));
        assert!(matches!(
            McpClientTrait::list_prompts(&client, SESSION, None, CancellationToken::new()).await,
            Err(ServiceError::TransportClosed)
        ));
    }
}
