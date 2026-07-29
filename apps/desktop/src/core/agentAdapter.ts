import {
  approvalId,
  compareInstants,
  correlationId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
  type ApprovalId,
  type CorrelationId,
  type Instant,
  type SessionId,
  type TaskId,
  type ToolRequestId,
  type WorkerId,
  type WorkspaceId,
} from "./domain";
import { assertCoreEvent, eventStreamId, type CoreEvent, type EventStreamId } from "./events";
import { toolOutputReference, type ToolOutputReference } from "./privilegedServices";

export const AGENT_ADAPTER_PROTOCOL_VERSION = 2 as const;

export const AGENT_CAPABILITIES = [
  "messages",
  "approvals",
  "cancellation",
  "heartbeats",
  "tool-results",
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

export type AgentAdapterErrorCode =
  | "invalid-capabilities"
  | "incompatible-protocol"
  | "unsupported-capability"
  | "invalid-request"
  | "unknown-session"
  | "duplicate-session"
  | "invalid-state"
  | "invalid-signal"
  | "signal-sequence-gap"
  | "signal-time-regression"
  | "signal-identity-mismatch"
  | "terminal-reconciliation-failed"
  | "concurrency-limit"
  | "adapter-operation-failed"
  | "invalid-restart"
  | "restart-limit";

export class AgentAdapterError extends Error {
  constructor(
    readonly code: AgentAdapterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentAdapterError";
  }
}

export interface AgentCapabilities {
  readonly protocolVersion: typeof AGENT_ADAPTER_PROTOCOL_VERSION;
  readonly adapterKind: string;
  readonly capabilities: readonly AgentCapability[];
  readonly maxConcurrentSessions: number;
  readonly heartbeatIntervalMs: number;
}

export interface AgentStartRequest {
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly streamId: EventStreamId;
  readonly correlationId: CorrelationId;
  readonly taskState: "ready" | "blocked";
  readonly startedAt: Instant;
  readonly initialPrompt: string;
}

export interface AgentInput {
  readonly messageId: CorrelationId;
  readonly content: string;
  readonly sentAt: Instant;
}

export type AgentApprovalDecisionKind = "approved" | "denied" | "expired" | "cancelled";

export interface AgentApprovalDecision {
  readonly approvalId: ApprovalId;
  readonly decision: AgentApprovalDecisionKind;
  readonly decidedAt: Instant;
}

interface AgentToolResultBase {
  readonly requestId: ToolRequestId;
  readonly startedAt: Instant;
  readonly completedAt: Instant;
}

export type AgentToolResult =
  | (AgentToolResultBase & {
      readonly status: "succeeded";
      readonly outputRef?: ToolOutputReference;
      readonly summary?: string;
    })
  | (AgentToolResultBase & {
      readonly status: "failed";
      readonly errorCode: string;
      readonly message: string;
      readonly mayHaveExecuted: boolean;
    })
  | (AgentToolResultBase & {
      readonly status: "cancelled";
      readonly reason?: string;
    });

interface AgentSignalBase {
  readonly protocolVersion: typeof AGENT_ADAPTER_PROTOCOL_VERSION;
  readonly sequence: number;
  readonly occurredAt: Instant;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
}

export type AgentBlockedReason = "approval" | "tool" | "dependency" | "other";

export type AgentSignal =
  | (AgentSignalBase & {
      readonly type: "ready";
    })
  | (AgentSignalBase & {
      readonly type: "heartbeat";
    })
  | (AgentSignalBase & {
      readonly type: "core-event";
      readonly event: CoreEvent;
    })
  | (AgentSignalBase & {
      readonly type: "blocked";
      readonly reason: AgentBlockedReason;
      readonly requestId?: ToolRequestId;
      readonly approvalId?: ApprovalId;
    })
  | (AgentSignalBase & {
      readonly type: "resumed";
    })
  | (AgentSignalBase & {
      readonly type: "completed";
    })
  | (AgentSignalBase & {
      readonly type: "failed";
      readonly errorCode: string;
      readonly message: string;
    })
  | (AgentSignalBase & {
      readonly type: "cancelled";
      readonly reason?: string;
    })
  | (AgentSignalBase & {
      readonly type: "crashed";
      readonly errorCode: string;
      readonly message: string;
      readonly retryable: boolean;
    })
  | (AgentSignalBase & {
      readonly type: "protocol-error";
      readonly errorCode:
        | "incompatible-protocol"
        | "invalid-signal"
        | "signal-identity-mismatch"
        | "signal-sequence-gap"
        | "signal-time-regression";
      readonly message: string;
    });

export type AgentSignalHandler = (signal: AgentSignal) => void;
export type UnsubscribeAgentSignals = () => void;

export interface AgentAdapter {
  capabilities(): Promise<AgentCapabilities>;
  start(request: AgentStartRequest): Promise<void>;
  appendAuthoritativeArtifactEvent(
    sessionId: SessionId,
    event: CoreEvent<"artifact.created" | "artifact.updated">,
  ): Promise<void>;
  send(sessionId: SessionId, input: AgentInput): Promise<void>;
  approve(requestId: ToolRequestId, decision: AgentApprovalDecision): Promise<void>;
  resolveTool(requestId: ToolRequestId, result: AgentToolResult): Promise<void>;
  cancel(sessionId: SessionId, reason?: string): Promise<void>;
  subscribe(sessionId: SessionId, handler: AgentSignalHandler): UnsubscribeAgentSignals;
  dispose(sessionId: SessionId): Promise<void>;
}

export interface AgentClock {
  now(): Instant;
}

const SIGNAL_TYPES = [
  "ready",
  "heartbeat",
  "core-event",
  "blocked",
  "resumed",
  "completed",
  "failed",
  "cancelled",
  "crashed",
  "protocol-error",
] as const;
const APPROVAL_DECISIONS: readonly AgentApprovalDecisionKind[] = [
  "approved",
  "denied",
  "expired",
  "cancelled",
];
const BLOCK_REASONS: readonly AgentBlockedReason[] = ["approval", "tool", "dependency", "other"];
const SIGNAL_BASE_KEYS = [
  "protocolVersion",
  "sequence",
  "occurredAt",
  "sessionId",
  "workerId",
  "type",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  code: AgentAdapterErrorCode,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AgentAdapterError(code, `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  code: AgentAdapterErrorCode,
  label: string,
): void {
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));

  if (unexpectedKey !== undefined) {
    throw new AgentAdapterError(code, `${label} contains unsupported field ${unexpectedKey}`);
  }
}

function assertString(
  value: unknown,
  code: AgentAdapterErrorCode,
  label: string,
  allowEmpty = false,
): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new AgentAdapterError(code, `${label} must be a string`);
  }
}

function validateBrandedString(
  value: unknown,
  label: string,
  factory: (candidate: string) => unknown,
  code: AgentAdapterErrorCode,
): void {
  assertString(value, code, label);

  try {
    factory(value);
  } catch (error) {
    throw new AgentAdapterError(code, `${label} is invalid`, { cause: error });
  }
}

function validateInstant(value: unknown, label: string, code: AgentAdapterErrorCode): void {
  validateBrandedString(value, label, instant, code);
}

function validateProtocolVersion(
  value: unknown,
  label: string,
  fallbackCode: AgentAdapterErrorCode,
): void {
  if (typeof value !== "number") {
    throw new AgentAdapterError(fallbackCode, `${label} protocolVersion must be numeric`);
  }

  if (value !== AGENT_ADAPTER_PROTOCOL_VERSION) {
    throw new AgentAdapterError(
      "incompatible-protocol",
      `${label} requires protocol version ${AGENT_ADAPTER_PROTOCOL_VERSION}, received ${String(value)}`,
    );
  }
}

export function assertAgentCapabilities(value: unknown): asserts value is AgentCapabilities {
  assertRecord(value, "invalid-capabilities", "Agent capabilities");
  assertExactKeys(
    value,
    [
      "protocolVersion",
      "adapterKind",
      "capabilities",
      "maxConcurrentSessions",
      "heartbeatIntervalMs",
    ],
    "invalid-capabilities",
    "Agent capabilities",
  );
  validateProtocolVersion(value.protocolVersion, "Agent capabilities", "invalid-capabilities");
  assertString(value.adapterKind, "invalid-capabilities", "Agent capabilities.adapterKind");

  if (
    value.adapterKind.length > 64 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value.adapterKind)
  ) {
    throw new AgentAdapterError(
      "invalid-capabilities",
      "Agent capabilities.adapterKind must be a lowercase dotted identifier of at most 64 characters",
    );
  }

  if (!Array.isArray(value.capabilities)) {
    throw new AgentAdapterError(
      "invalid-capabilities",
      "Agent capabilities.capabilities must be an array",
    );
  }

  for (const capability of value.capabilities) {
    if (
      typeof capability !== "string" ||
      !AGENT_CAPABILITIES.includes(capability as AgentCapability)
    ) {
      throw new AgentAdapterError(
        "unsupported-capability",
        `Unsupported AgentAdapter capability ${String(capability)}`,
      );
    }
  }

  if (new Set(value.capabilities).size !== value.capabilities.length) {
    throw new AgentAdapterError(
      "invalid-capabilities",
      "Agent capabilities cannot contain duplicates",
    );
  }

  if (
    typeof value.maxConcurrentSessions !== "number" ||
    !Number.isSafeInteger(value.maxConcurrentSessions) ||
    value.maxConcurrentSessions < 1
  ) {
    throw new AgentAdapterError(
      "invalid-capabilities",
      "Agent capabilities.maxConcurrentSessions must be a positive safe integer",
    );
  }

  if (
    typeof value.heartbeatIntervalMs !== "number" ||
    !Number.isSafeInteger(value.heartbeatIntervalMs) ||
    value.heartbeatIntervalMs < 1
  ) {
    throw new AgentAdapterError(
      "invalid-capabilities",
      "Agent capabilities.heartbeatIntervalMs must be a positive safe integer",
    );
  }
}

export function assertAgentStartRequest(value: unknown): asserts value is AgentStartRequest {
  assertRecord(value, "invalid-request", "Agent start request");
  assertExactKeys(
    value,
    [
      "workspaceId",
      "taskId",
      "sessionId",
      "workerId",
      "streamId",
      "correlationId",
      "taskState",
      "startedAt",
      "initialPrompt",
    ],
    "invalid-request",
    "Agent start request",
  );

  validateBrandedString(
    value.workspaceId,
    "Agent start request.workspaceId",
    workspaceId,
    "invalid-request",
  );
  validateBrandedString(value.taskId, "Agent start request.taskId", taskId, "invalid-request");
  validateBrandedString(
    value.sessionId,
    "Agent start request.sessionId",
    sessionId,
    "invalid-request",
  );
  validateBrandedString(
    value.workerId,
    "Agent start request.workerId",
    workerId,
    "invalid-request",
  );
  validateBrandedString(
    value.streamId,
    "Agent start request.streamId",
    eventStreamId,
    "invalid-request",
  );
  validateBrandedString(
    value.correlationId,
    "Agent start request.correlationId",
    correlationId,
    "invalid-request",
  );

  if (value.taskState !== "ready" && value.taskState !== "blocked") {
    throw new AgentAdapterError(
      "invalid-request",
      "Agent start request.taskState must be ready or blocked",
    );
  }

  validateInstant(value.startedAt, "Agent start request.startedAt", "invalid-request");
  assertString(value.initialPrompt, "invalid-request", "Agent start request.initialPrompt", true);
}

export function assertAgentInput(value: unknown): asserts value is AgentInput {
  assertRecord(value, "invalid-request", "Agent input");
  assertExactKeys(value, ["messageId", "content", "sentAt"], "invalid-request", "Agent input");
  validateBrandedString(value.messageId, "Agent input.messageId", correlationId, "invalid-request");
  assertString(value.content, "invalid-request", "Agent input.content", true);
  validateInstant(value.sentAt, "Agent input.sentAt", "invalid-request");
}

export function assertAgentApprovalDecision(
  value: unknown,
): asserts value is AgentApprovalDecision {
  assertRecord(value, "invalid-request", "Agent approval decision");
  assertExactKeys(
    value,
    ["approvalId", "decision", "decidedAt"],
    "invalid-request",
    "Agent approval decision",
  );
  validateBrandedString(
    value.approvalId,
    "Agent approval decision.approvalId",
    approvalId,
    "invalid-request",
  );

  if (
    typeof value.decision !== "string" ||
    !APPROVAL_DECISIONS.includes(value.decision as AgentApprovalDecisionKind)
  ) {
    throw new AgentAdapterError(
      "invalid-request",
      "Agent approval decision.decision must be approved, denied, expired, or cancelled",
    );
  }

  validateInstant(value.decidedAt, "Agent approval decision.decidedAt", "invalid-request");
}

export function assertAgentToolResult(value: unknown): asserts value is AgentToolResult {
  assertRecord(value, "invalid-request", "Agent tool result");
  validateBrandedString(
    value.requestId,
    "Agent tool result.requestId",
    toolRequestId,
    "invalid-request",
  );
  validateInstant(value.startedAt, "Agent tool result.startedAt", "invalid-request");
  validateInstant(value.completedAt, "Agent tool result.completedAt", "invalid-request");
  if (compareInstants(value.completedAt as Instant, value.startedAt as Instant) < 0) {
    throw new AgentAdapterError(
      "invalid-request",
      "Agent tool result.completedAt cannot predate startedAt",
    );
  }

  switch (value.status) {
    case "succeeded":
      assertExactKeys(
        value,
        ["requestId", "status", "startedAt", "completedAt", "outputRef", "summary"],
        "invalid-request",
        "Agent succeeded tool result",
      );
      if (value.outputRef !== undefined) {
        validateBrandedString(
          value.outputRef,
          "Agent tool result.outputRef",
          toolOutputReference,
          "invalid-request",
        );
      }
      if (value.summary !== undefined) {
        assertString(value.summary, "invalid-request", "Agent tool result.summary", true);
      }
      return;
    case "failed":
      assertExactKeys(
        value,
        [
          "requestId",
          "status",
          "startedAt",
          "completedAt",
          "errorCode",
          "message",
          "mayHaveExecuted",
        ],
        "invalid-request",
        "Agent failed tool result",
      );
      assertString(value.errorCode, "invalid-request", "Agent tool result.errorCode");
      assertString(value.message, "invalid-request", "Agent tool result.message", true);
      if (typeof value.mayHaveExecuted !== "boolean") {
        throw new AgentAdapterError(
          "invalid-request",
          "Agent failed tool result.mayHaveExecuted must be boolean",
        );
      }
      return;
    case "cancelled":
      assertExactKeys(
        value,
        ["requestId", "status", "startedAt", "completedAt", "reason"],
        "invalid-request",
        "Agent cancelled tool result",
      );
      if (value.reason !== undefined) {
        assertString(value.reason, "invalid-request", "Agent tool result.reason", true);
      }
      return;
    default:
      throw new AgentAdapterError(
        "invalid-request",
        "Agent tool result.status must be succeeded, failed, or cancelled",
      );
  }
}

function assertSignalBase(value: Record<string, unknown>): void {
  validateProtocolVersion(value.protocolVersion, "Agent signal", "invalid-signal");

  if (
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1
  ) {
    throw new AgentAdapterError(
      "invalid-signal",
      "Agent signal.sequence must be a positive safe integer",
    );
  }

  validateInstant(value.occurredAt, "Agent signal.occurredAt", "invalid-signal");
  validateBrandedString(value.sessionId, "Agent signal.sessionId", sessionId, "invalid-signal");
  validateBrandedString(value.workerId, "Agent signal.workerId", workerId, "invalid-signal");
}

function assertSignalErrorFields(value: Record<string, unknown>, includeRetryable: boolean): void {
  assertString(value.errorCode, "invalid-signal", "Agent signal.errorCode");
  assertString(value.message, "invalid-signal", "Agent signal.message", true);

  if (includeRetryable && typeof value.retryable !== "boolean") {
    throw new AgentAdapterError("invalid-signal", "Agent signal.retryable must be boolean");
  }
}

export function assertAgentSignal(value: unknown): asserts value is AgentSignal {
  assertRecord(value, "invalid-signal", "Agent signal");

  if (
    typeof value.type !== "string" ||
    !SIGNAL_TYPES.includes(value.type as (typeof SIGNAL_TYPES)[number])
  ) {
    throw new AgentAdapterError(
      "invalid-signal",
      `Unknown AgentAdapter signal type ${String(value.type)}`,
    );
  }

  assertSignalBase(value);

  switch (value.type) {
    case "ready":
    case "heartbeat":
    case "resumed":
    case "completed":
      assertExactKeys(value, SIGNAL_BASE_KEYS, "invalid-signal", `Agent ${value.type} signal`);
      return;
    case "core-event":
      assertExactKeys(
        value,
        [...SIGNAL_BASE_KEYS, "event"],
        "invalid-signal",
        "Agent core-event signal",
      );
      try {
        assertCoreEvent(value.event);
      } catch (error) {
        throw new AgentAdapterError(
          "invalid-signal",
          "Agent core-event signal contains an invalid core event",
          { cause: error },
        );
      }
      return;
    case "blocked":
      assertExactKeys(
        value,
        [...SIGNAL_BASE_KEYS, "reason", "requestId", "approvalId"],
        "invalid-signal",
        "Agent blocked signal",
      );
      if (
        typeof value.reason !== "string" ||
        !BLOCK_REASONS.includes(value.reason as AgentBlockedReason)
      ) {
        throw new AgentAdapterError("invalid-signal", "Agent blocked signal.reason must be known");
      }
      if (value.requestId !== undefined) {
        validateBrandedString(
          value.requestId,
          "Agent blocked signal.requestId",
          toolRequestId,
          "invalid-signal",
        );
      }
      if (value.approvalId !== undefined) {
        validateBrandedString(
          value.approvalId,
          "Agent blocked signal.approvalId",
          approvalId,
          "invalid-signal",
        );
      }
      return;
    case "failed":
      assertExactKeys(
        value,
        [...SIGNAL_BASE_KEYS, "errorCode", "message"],
        "invalid-signal",
        "Agent failed signal",
      );
      assertSignalErrorFields(value, false);
      return;
    case "cancelled":
      assertExactKeys(
        value,
        [...SIGNAL_BASE_KEYS, "reason"],
        "invalid-signal",
        "Agent cancelled signal",
      );
      if (value.reason !== undefined) {
        assertString(value.reason, "invalid-signal", "Agent cancelled signal.reason", true);
      }
      return;
    case "crashed":
      assertExactKeys(
        value,
        [...SIGNAL_BASE_KEYS, "errorCode", "message", "retryable"],
        "invalid-signal",
        "Agent crashed signal",
      );
      assertSignalErrorFields(value, true);
      return;
    case "protocol-error":
      assertExactKeys(
        value,
        [...SIGNAL_BASE_KEYS, "errorCode", "message"],
        "invalid-signal",
        "Agent protocol-error signal",
      );
      if (
        value.errorCode !== "incompatible-protocol" &&
        value.errorCode !== "invalid-signal" &&
        value.errorCode !== "signal-identity-mismatch" &&
        value.errorCode !== "signal-sequence-gap" &&
        value.errorCode !== "signal-time-regression"
      ) {
        throw new AgentAdapterError(
          "invalid-signal",
          "Agent protocol-error signal.errorCode is unsupported",
        );
      }
      assertString(value.message, "invalid-signal", "Agent protocol-error signal.message", true);
      return;
  }
}
