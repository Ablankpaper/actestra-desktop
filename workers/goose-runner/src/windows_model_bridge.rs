use crate::windows_bridge::{
    decode_json_frame, encode_json_frame, exact_bridge_token, has_exact_keys, is_bridge_token,
    PendingRequests, WindowsBridgeChannel, WINDOWS_BRIDGE_CONTRACT_VERSION,
    WINDOWS_BRIDGE_MAX_PENDING_REQUESTS,
};
use goose_providers::base::{stream_from_single_message, MessageStream, Provider};
use goose_providers::conversation::message::{Message, MessageContentBlock};
use goose_providers::conversation::token_usage::{ProviderUsage, Usage};
use goose_providers::errors::ProviderError;
use goose_providers::model::ModelConfig;
use rmcp::model::{CallToolRequestParams, Role, Tool};
use serde_json::{json, Map, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, OnceCell};

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowsModelBridgeError {
    InvalidLease,
    InvalidModelId,
}

impl std::fmt::Display for WindowsModelBridgeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidLease => "invalid Windows model bridge lease",
            Self::InvalidModelId => "invalid Windows model bridge model id",
        })
    }
}

impl std::error::Error for WindowsModelBridgeError {}

struct ModelBridgeState {
    channel: WindowsBridgeChannel,
    pending: PendingRequests,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModelClientProgress {
    RequestWritten,
    ResponseDecoded,
}

fn model_client_progress_code(stage: ModelClientProgress) -> &'static str {
    match stage {
        ModelClientProgress::RequestWritten => "windows-model-worker-request-written",
        ModelClientProgress::ResponseDecoded => "windows-model-worker-response-decoded",
    }
}

fn report_model_client_progress(stage: ModelClientProgress) {
    eprintln!(
        "Goose windows model progress at bounded stage {}",
        model_client_progress_code(stage)
    );
}

pub(crate) struct WindowsModelProvider {
    state: Arc<Mutex<ModelBridgeState>>,
    lease: String,
    session_id: Arc<OnceCell<String>>,
    model_id: String,
    next_request_id: AtomicU64,
}

impl WindowsModelProvider {
    pub(crate) fn new(
        channel: WindowsBridgeChannel,
        lease: String,
        session_id: Arc<OnceCell<String>>,
        model_id: String,
    ) -> Result<Self, WindowsModelBridgeError> {
        if !is_bridge_token(&lease, 32, 256) {
            return Err(WindowsModelBridgeError::InvalidLease);
        }
        if model_id.is_empty() || model_id.len() > 256 || model_id.chars().any(char::is_control) {
            return Err(WindowsModelBridgeError::InvalidModelId);
        }
        Ok(Self {
            state: Arc::new(Mutex::new(ModelBridgeState {
                channel,
                pending: PendingRequests::new(WINDOWS_BRIDGE_MAX_PENDING_REQUESTS)
                    .expect("fixed Windows model request capacity is valid"),
            })),
            lease,
            session_id,
            model_id,
            next_request_id: AtomicU64::new(1),
        })
    }

    fn session_id(&self) -> Result<&str, ProviderError> {
        let session_id = self
            .session_id
            .get()
            .map(String::as_str)
            .ok_or_else(model_bridge_unavailable)?;
        if !is_bridge_token(session_id, 1, 256) {
            return Err(model_bridge_unavailable());
        }
        Ok(session_id)
    }

    fn request_id(&self) -> Result<String, ProviderError> {
        self.next_request_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
                value.checked_add(1)
            })
            .map(|value| format!("model-{value}"))
            .map_err(|_| model_bridge_unavailable())
    }

    async fn complete(
        &self,
        invocation: Value,
        declared_tools: &[Tool],
    ) -> Result<(Message, ProviderUsage), ProviderError> {
        let session_id = self.session_id()?.to_string();
        let request_id = self.request_id()?;
        let request = encode_model_frame(&ModelFrame::CompletionRequest {
            request_id: request_id.clone(),
            lease: self.lease.clone(),
            session_id: session_id.clone(),
            invocation,
        })
        .map_err(|_| model_request_rejected())?;

        let mut cancellation = ModelRequestCancellation::new(
            self.state.clone(),
            request_id.clone(),
            self.lease.clone(),
        );
        let mut state = self.state.lock().await;
        state
            .pending
            .begin(&request_id)
            .map_err(|_| model_bridge_unavailable())?;
        if state.channel.write_frame(&request).await.is_err() {
            let _ = state.pending.cancel(&request_id);
            cancellation.disarm();
            return Err(model_bridge_unavailable());
        }
        report_model_client_progress(ModelClientProgress::RequestWritten);
        let response = match state.channel.read_frame().await {
            Ok(frame) => decode_model_frame(&frame, &self.lease, &session_id),
            Err(()) => Err(()),
        };
        let response = match response {
            Ok(response) => {
                report_model_client_progress(ModelClientProgress::ResponseDecoded);
                response
            }
            Err(()) => {
                cancel_model_request(&mut state, &request_id, &self.lease).await;
                cancellation.disarm();
                return Err(model_bridge_unavailable());
            }
        };
        let response_request_id = match &response {
            ModelFrame::CompletionResponse { request_id, .. }
            | ModelFrame::Error { request_id, .. } => request_id,
            _ => {
                cancel_model_request(&mut state, &request_id, &self.lease).await;
                cancellation.disarm();
                return Err(model_bridge_unavailable());
            }
        };
        if response_request_id != &request_id || state.pending.complete(&request_id).is_err() {
            let _ = state.pending.cancel(&request_id);
            cancellation.disarm();
            return Err(model_bridge_unavailable());
        }
        cancellation.disarm();

        match response {
            ModelFrame::CompletionResponse { completion, .. } => {
                completion_to_goose(completion, &self.model_id, declared_tools)
            }
            ModelFrame::Error { code, .. } => Err(model_error(code)),
            _ => Err(model_bridge_unavailable()),
        }
    }
}

#[async_trait::async_trait]
impl Provider for WindowsModelProvider {
    fn get_name(&self) -> &str {
        "actestra"
    }

    async fn stream(
        &self,
        model_config: &ModelConfig,
        system: &str,
        messages: &[Message],
        tools: &[Tool],
    ) -> Result<MessageStream, ProviderError> {
        if model_config.model_name != self.model_id {
            return Err(model_request_rejected());
        }
        let session_id = self.session_id()?;
        let invocation = project_invocation(session_id, system, messages, tools)?;
        let (message, usage) = self.complete(invocation, tools).await?;
        Ok(stream_from_single_message(message, usage))
    }
}

struct ModelRequestCancellation {
    state: Arc<Mutex<ModelBridgeState>>,
    request_id: String,
    lease: String,
    armed: bool,
}

impl ModelRequestCancellation {
    fn new(state: Arc<Mutex<ModelBridgeState>>, request_id: String, lease: String) -> Self {
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

impl Drop for ModelRequestCancellation {
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
            cancel_model_request(&mut state, &request_id, &lease).await;
        });
    }
}

async fn cancel_model_request(state: &mut ModelBridgeState, request_id: &str, lease: &str) {
    if state.pending.cancel(request_id).is_ok() {
        if let Ok(frame) = encode_model_frame(&ModelFrame::Cancel {
            request_id: request_id.to_string(),
            lease: lease.to_string(),
        }) {
            let _ = state.channel.write_frame(&frame).await;
        }
    }
}

fn project_invocation(
    session_id: &str,
    system: &str,
    messages: &[Message],
    tools: &[Tool],
) -> Result<Value, ProviderError> {
    let mut projected_messages = vec![json!({"content": system, "role": "system"})];
    for message in messages {
        project_message(message, &mut projected_messages)?;
    }
    let projected_tools = tools
        .iter()
        .map(project_tool)
        .collect::<Result<Vec<_>, _>>()?;
    let invocation = json!({
        "messages": projected_messages,
        "purpose": "coding",
        "responseMode": "text-or-tool-call",
        "sessionId": session_id,
        "tools": projected_tools,
    });
    validate_invocation(&invocation, session_id).map_err(|_| model_request_rejected())?;
    Ok(invocation)
}

fn project_message(message: &Message, output: &mut Vec<Value>) -> Result<(), ProviderError> {
    let role = match message.role {
        Role::User => "user",
        Role::Assistant => "assistant",
    };
    for content in &message.content {
        match content {
            MessageContentBlock::Text(text) => {
                output.push(json!({"content": text.text, "role": role}));
            }
            MessageContentBlock::ToolRequest(request) if role == "assistant" => {
                let call = request
                    .tool_call
                    .as_ref()
                    .map_err(|_| model_request_rejected())?;
                output.push(json!({
                    "role": "assistant",
                    "toolCalls": [{
                        "arguments": call.arguments.clone().unwrap_or_default(),
                        "callId": request.id,
                        "name": call.name,
                    }]
                }));
            }
            MessageContentBlock::ToolResponse(response) => {
                let result = response
                    .tool_result
                    .as_ref()
                    .map_err(|_| model_request_rejected())?;
                let text = result
                    .content
                    .iter()
                    .map(|content| {
                        content
                            .as_text()
                            .map(|text| text.text.as_str())
                            .ok_or_else(model_request_rejected)
                    })
                    .collect::<Result<Vec<_>, _>>()?
                    .join("\n");
                output.push(json!({
                    "callId": response.id,
                    "content": text,
                    "role": "tool"
                }));
            }
            _ => return Err(model_request_rejected()),
        }
    }
    Ok(())
}

fn project_tool(tool: &Tool) -> Result<Value, ProviderError> {
    let mut projected = Map::new();
    projected.insert("name".to_string(), Value::String(tool.name.to_string()));
    projected.insert(
        "inputSchema".to_string(),
        Value::Object((*tool.input_schema).clone()),
    );
    if let Some(description) = &tool.description {
        projected.insert(
            "description".to_string(),
            Value::String(description.to_string()),
        );
    }
    let projected = Value::Object(projected);
    validate_tool(&projected).map_err(|_| model_request_rejected())?;
    Ok(projected)
}

fn completion_to_goose(
    completion: Value,
    model_id: &str,
    declared_tools: &[Tool],
) -> Result<(Message, ProviderUsage), ProviderError> {
    let object = completion
        .as_object()
        .ok_or_else(model_bridge_unavailable)?;
    let prompt_tokens = usage_i32(object, "promptTokens")?;
    let completion_tokens = usage_i32(object, "completionTokens")?;
    let usage = ProviderUsage::new(
        model_id.to_string(),
        Usage::new(Some(prompt_tokens), Some(completion_tokens), None),
    );
    match object.get("type").and_then(Value::as_str) {
        Some("message") => Ok((
            Message::assistant().with_text(
                object
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(model_bridge_unavailable)?,
            ),
            usage,
        )),
        Some("tool-call") => {
            let name = object
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(model_bridge_unavailable)?;
            if !declared_tools.iter().any(|tool| tool.name == name) {
                return Err(model_completion_refused());
            }
            let call_id = object
                .get("callId")
                .and_then(Value::as_str)
                .ok_or_else(model_bridge_unavailable)?;
            let arguments = object
                .get("arguments")
                .and_then(Value::as_object)
                .cloned()
                .ok_or_else(model_bridge_unavailable)?;
            Ok((
                Message::assistant().with_tool_request(
                    call_id,
                    Ok(CallToolRequestParams::new(name.to_string()).with_arguments(arguments)),
                ),
                usage,
            ))
        }
        _ => Err(model_bridge_unavailable()),
    }
}

fn usage_i32(object: &Map<String, Value>, key: &str) -> Result<i32, ProviderError> {
    let usage = object
        .get("usage")
        .and_then(Value::as_object)
        .and_then(|usage| usage.get(key))
        .and_then(Value::as_u64)
        .ok_or_else(model_bridge_unavailable)?;
    i32::try_from(usage).map_err(|_| model_bridge_unavailable())
}

fn model_bridge_unavailable() -> ProviderError {
    ProviderError::NetworkError("Actestra model bridge unavailable".to_string())
}

fn model_request_rejected() -> ProviderError {
    ProviderError::RequestFailed("Actestra model request rejected".to_string())
}

fn model_completion_refused() -> ProviderError {
    ProviderError::Refusal {
        details: "Actestra model completion refused".to_string(),
        category: Some("model-completion-refused".to_string()),
    }
}

fn model_error(code: ModelBridgeErrorCode) -> ProviderError {
    match code {
        ModelBridgeErrorCode::Cancelled => {
            ProviderError::RequestFailed("Actestra model request cancelled".to_string())
        }
        ModelBridgeErrorCode::ModelCompletionRefused => model_completion_refused(),
        ModelBridgeErrorCode::ModelRequestRejected => model_request_rejected(),
        ModelBridgeErrorCode::ModelTimeout => {
            ProviderError::NetworkError("Actestra model bridge timed out".to_string())
        }
        ModelBridgeErrorCode::ModelUnavailable => model_bridge_unavailable(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::StreamExt;
    use goose_providers::base::Provider;
    use goose_providers::conversation::message::{Message, MessageContentBlock};
    use goose_providers::model::ModelConfig;
    use rmcp::model::{JsonObject, Tool};
    use serde_json::{json, Value};
    use std::sync::Arc;
    use tokio::sync::OnceCell;

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

    fn model_provider(worker: tokio::io::DuplexStream) -> WindowsModelProvider {
        let session = Arc::new(OnceCell::new());
        session.set(SESSION.to_string()).unwrap();
        WindowsModelProvider::new(
            crate::windows_bridge::WindowsBridgeChannel::from_duplex(worker),
            LEASE.to_string(),
            session,
            "actestra-fixed-model".to_string(),
        )
        .unwrap()
    }

    #[test]
    fn model_provider_progress_vocabulary_is_fixed_and_bounded() {
        assert_eq!(
            model_client_progress_code(ModelClientProgress::RequestWritten),
            "windows-model-worker-request-written"
        );
        assert_eq!(
            model_client_progress_code(ModelClientProgress::ResponseDecoded),
            "windows-model-worker-response-decoded"
        );
    }

    async fn next_stream_item(
        mut stream: goose_providers::base::MessageStream,
    ) -> (
        Option<Message>,
        Option<goose_providers::conversation::token_usage::ProviderUsage>,
    ) {
        stream.next().await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn windows_model_bridge_streams_one_text_completion_through_the_real_provider_trait() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let provider = model_provider(worker);
        let main = tokio::spawn(async move {
            let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
            let request =
                decode_model_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
            let ModelFrame::CompletionRequest {
                request_id,
                invocation,
                ..
            } = request
            else {
                panic!("expected completion request");
            };
            assert_eq!(
                invocation,
                json!({
                    "messages": [
                        {"content": "bounded system", "role": "system"},
                        {"content": "bounded prompt", "role": "user"}
                    ],
                    "purpose": "coding",
                    "responseMode": "text-or-tool-call",
                    "sessionId": SESSION,
                    "tools": []
                })
            );
            main.write_frame(
                &encode_model_frame(&ModelFrame::CompletionResponse {
                    request_id,
                    completion: json!({
                        "text": "bounded answer",
                        "type": "message",
                        "usage": {"completionTokens": 2, "promptTokens": 3}
                    }),
                })
                .unwrap(),
            )
            .await
            .unwrap();
        });

        let stream = Provider::stream(
            &provider,
            &ModelConfig::new("actestra-fixed-model"),
            "bounded system",
            &[Message::user().with_text("bounded prompt")],
            &[],
        )
        .await
        .unwrap();
        let (message, usage) = next_stream_item(stream).await;
        let message = message.unwrap();
        assert_eq!(message.role, rmcp::model::Role::Assistant);
        assert_eq!(message.content.len(), 1);
        assert_eq!(message.content[0].as_text(), Some("bounded answer"));
        let usage = usage.unwrap();
        assert_eq!(usage.model, "actestra-fixed-model");
        assert_eq!(usage.usage.input_tokens, Some(3));
        assert_eq!(usage.usage.output_tokens, Some(2));
        main.await.unwrap();
    }

    #[tokio::test]
    async fn windows_model_bridge_streams_one_declared_tool_call() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let provider = model_provider(worker);
        let main = tokio::spawn(async move {
            let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
            let request =
                decode_model_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
            let ModelFrame::CompletionRequest {
                request_id,
                invocation,
                ..
            } = request
            else {
                panic!("expected completion request");
            };
            assert_eq!(
                invocation["tools"],
                json!([{
                    "description": "Read one bounded text file",
                    "inputSchema": {"type": "object"},
                    "name": "actestra.coding.file.read-text"
                }])
            );
            main.write_frame(
                &encode_model_frame(&ModelFrame::CompletionResponse {
                    request_id,
                    completion: json!({
                        "arguments": {"contractVersion": 1, "relativePath": "README.md"},
                        "callId": "call-1",
                        "name": "actestra.coding.file.read-text",
                        "type": "tool-call",
                        "usage": {"completionTokens": 4, "promptTokens": 7}
                    }),
                })
                .unwrap(),
            )
            .await
            .unwrap();
        });

        let mut schema = JsonObject::new();
        schema.insert("type".to_string(), json!("object"));
        let tools = [Tool::new(
            "actestra.coding.file.read-text",
            "Read one bounded text file",
            schema,
        )];
        let stream = Provider::stream(
            &provider,
            &ModelConfig::new("actestra-fixed-model"),
            "bounded system",
            &[Message::user().with_text("read the file")],
            &tools,
        )
        .await
        .unwrap();
        let (message, usage) = next_stream_item(stream).await;
        let message = message.unwrap();
        assert_eq!(message.content.len(), 1);
        let MessageContentBlock::ToolRequest(tool_request) = &message.content[0] else {
            panic!("expected tool request");
        };
        assert_eq!(tool_request.id, "call-1");
        let call = tool_request.tool_call.as_ref().unwrap();
        assert_eq!(call.name, "actestra.coding.file.read-text");
        assert_eq!(
            call.arguments.as_ref().unwrap().get("relativePath"),
            Some(&json!("README.md"))
        );
        assert_eq!(usage.unwrap().usage.total_tokens, Some(11));
        main.await.unwrap();
    }

    #[tokio::test]
    async fn windows_model_bridge_sends_cancel_when_the_provider_future_is_dropped() {
        let (worker, main) = tokio::io::duplex(64 * 1024);
        let provider = Arc::new(model_provider(worker));
        let worker_task = {
            let provider = provider.clone();
            tokio::spawn(async move {
                Provider::stream(
                    provider.as_ref(),
                    &ModelConfig::new("actestra-fixed-model"),
                    "bounded system",
                    &[Message::user().with_text("bounded prompt")],
                    &[],
                )
                .await
            })
        };
        let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
        let request =
            decode_model_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
        let ModelFrame::CompletionRequest { request_id, .. } = request else {
            panic!("expected completion request");
        };
        worker_task.abort();
        assert!(matches!(worker_task.await, Err(error) if error.is_cancelled()));
        let cancel = decode_model_frame(&main.read_frame().await.unwrap(), LEASE, SESSION).unwrap();
        assert_eq!(
            cancel,
            ModelFrame::Cancel {
                request_id,
                lease: LEASE.to_string()
            }
        );
    }

    #[tokio::test]
    async fn windows_model_bridge_fails_closed_on_a_malformed_or_disconnected_response() {
        for malformed in [true, false] {
            let (worker, main) = tokio::io::duplex(64 * 1024);
            let provider = model_provider(worker);
            let main = tokio::spawn(async move {
                let mut main = crate::windows_bridge::WindowsBridgeChannel::from_duplex(main);
                main.read_frame().await.unwrap();
                if malformed {
                    main.write_frame(
                        &crate::windows_bridge::encode_json_frame(&json!({
                            "contractVersion": 1,
                            "kind": "unknown-response"
                        }))
                        .unwrap(),
                    )
                    .await
                    .unwrap();
                }
            });
            let result = Provider::stream(
                &provider,
                &ModelConfig::new("actestra-fixed-model"),
                "bounded system",
                &[Message::user().with_text("bounded prompt")],
                &[],
            )
            .await;
            let error = match result {
                Err(error) => error,
                Ok(_) => panic!("malformed or disconnected response must fail closed"),
            };
            assert_eq!(
                error,
                goose_providers::errors::ProviderError::NetworkError(
                    "Actestra model bridge unavailable".to_string()
                )
            );
            assert!(!error.to_string().contains("unknown-response"));
            main.await.unwrap();
        }
    }
}
