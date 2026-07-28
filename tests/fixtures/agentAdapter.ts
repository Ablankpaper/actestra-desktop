import {
  approvalId,
  correlationId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
  type AgentApprovalDecision,
  type AgentInput,
  type AgentStartRequest,
} from "../../apps/desktop/src/core";

export const FIXTURE_AGENT_WORKSPACE_ID = workspaceId("workspace-agent");
export const FIXTURE_AGENT_TASK_ID = taskId("task-agent");
export const FIXTURE_AGENT_SESSION_ID = sessionId("session-agent-1");
export const FIXTURE_AGENT_WORKER_ID = workerId("worker-agent-1");
export const FIXTURE_AGENT_STREAM_ID = eventStreamId("stream-agent-1");
export const FIXTURE_AGENT_CORRELATION_ID = correlationId("correlation-agent");
export const FIXTURE_AGENT_REQUEST_ID = toolRequestId("request-agent-1");
export const FIXTURE_AGENT_APPROVAL_ID = approvalId("approval-agent-1");
export const FIXTURE_AGENT_START_TIME = instant("2026-07-28T08:00:00.000Z");

export function createAgentStartRequest(
  overrides: Partial<AgentStartRequest> = {},
): AgentStartRequest {
  return {
    workspaceId: FIXTURE_AGENT_WORKSPACE_ID,
    taskId: FIXTURE_AGENT_TASK_ID,
    sessionId: FIXTURE_AGENT_SESSION_ID,
    workerId: FIXTURE_AGENT_WORKER_ID,
    streamId: FIXTURE_AGENT_STREAM_ID,
    correlationId: FIXTURE_AGENT_CORRELATION_ID,
    taskState: "ready",
    startedAt: FIXTURE_AGENT_START_TIME,
    initialPrompt: "Prove the deterministic worker lifecycle.",
    ...overrides,
  };
}

export function createAgentInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    messageId: correlationId("message-agent-1"),
    content: "Continue with the next deterministic step.",
    sentAt: FIXTURE_AGENT_START_TIME,
    ...overrides,
  };
}

export function createApprovalDecision(
  decision: AgentApprovalDecision["decision"] = "approved",
  overrides: Partial<AgentApprovalDecision> = {},
): AgentApprovalDecision {
  return {
    approvalId: FIXTURE_AGENT_APPROVAL_ID,
    decision,
    decidedAt: FIXTURE_AGENT_START_TIME,
    ...overrides,
  };
}
