import { assertAgentToolResult, type AgentToolResult } from "../core/agentAdapter";
import { correlationId } from "../core/domain";

export const GENERAL_WORKER_PROTOCOL_VERSION = 1 as const;
export const GENERAL_WORKER_IMPLEMENTATION_VERSION = "0.1.0" as const;
export const GENERAL_WORKER_ROLE = "general-worker" as const;
export const GENERAL_WORKER_CAPABILITIES = [
  "messages",
  "cancellation",
  "heartbeats",
  "tool-results",
] as const;
export const GENERAL_WORKER_EXECUTION_MODES = [
  "no-tool-complete",
  "hold",
  "tool-fixture",
  "workspace-read-text-fixture",
  "task-output-write-text-fixture",
] as const;
export const MAX_GENERAL_WORKER_MESSAGE_BYTES = 256 * 1024;
export const MAX_GENERAL_WORKER_PROMPT_BYTES = 64 * 1024;

export type GeneralWorkerCapability = (typeof GENERAL_WORKER_CAPABILITIES)[number];
export type GeneralWorkerExecutionMode = (typeof GENERAL_WORKER_EXECUTION_MODES)[number];
export type GeneralWorkerOperation =
  | "start"
  | "send"
  | "resolve-tool"
  | "cancel"
  | "dispose"
  | "close";
export type GeneralWorkerErrorCode =
  | "invalid-request"
  | "invalid-state"
  | "unknown-attempt"
  | "duplicate-attempt"
  | "unsupported-operation";

export interface GeneralWorkerReadyMessage {
  readonly protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly role: typeof GENERAL_WORKER_ROLE;
  readonly implementationVersion: typeof GENERAL_WORKER_IMPLEMENTATION_VERSION;
  readonly capabilities: readonly GeneralWorkerCapability[];
  readonly maxConcurrentAttempts: 1;
  readonly heartbeatIntervalMs: number;
}

interface GeneralWorkerRequestBase<Operation extends GeneralWorkerOperation> {
  readonly protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  readonly type: "request";
  readonly requestId: string;
  readonly operation: Operation;
}

export type GeneralWorkerRequest =
  | (GeneralWorkerRequestBase<"start"> & {
      readonly payload: {
        readonly attemptToken: string;
        readonly prompt: string;
        readonly entryState: "ready" | "blocked";
        readonly executionMode: GeneralWorkerExecutionMode;
      };
    })
  | (GeneralWorkerRequestBase<"send"> & {
      readonly payload: {
        readonly attemptToken: string;
        readonly content: string;
      };
    })
  | (GeneralWorkerRequestBase<"resolve-tool"> & {
      readonly payload: {
        readonly attemptToken: string;
        readonly callId: string;
        readonly result: AgentToolResult;
      };
    })
  | (GeneralWorkerRequestBase<"cancel"> & {
      readonly payload: {
        readonly attemptToken: string;
        readonly reason?: string;
      };
    })
  | (GeneralWorkerRequestBase<"dispose"> & {
      readonly payload: {
        readonly attemptToken: string;
      };
    })
  | (GeneralWorkerRequestBase<"close"> & {
      readonly payload: Record<string, never>;
    });

export type GeneralWorkerEventPayload =
  | {
      readonly type: "started";
    }
  | {
      readonly type: "heartbeat";
    }
  | {
      readonly type: "message";
      readonly role: "assistant" | "system";
      readonly content: string;
    }
  | {
      readonly type: "tool-requested";
      readonly callId: string;
      readonly toolName: string;
      readonly summary: string;
    }
  | {
      readonly type: "tool-result-accepted";
      readonly callId: string;
      readonly status: AgentToolResult["status"];
    }
  | {
      readonly type: "resumed";
    }
  | {
      readonly type: "completed";
    }
  | {
      readonly type: "failed";
      readonly errorCode: string;
      readonly message: string;
    }
  | {
      readonly type: "cancelled";
      readonly reason?: string;
    };

export interface GeneralWorkerEventMessage {
  readonly protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  readonly type: "event";
  readonly attemptToken: string;
  readonly sequence: number;
  readonly event: GeneralWorkerEventPayload;
}

export interface GeneralWorkerSuccessResponse {
  readonly protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly operation: GeneralWorkerOperation;
  readonly ok: true;
}

export interface GeneralWorkerErrorResponse {
  readonly protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly operation: GeneralWorkerOperation;
  readonly ok: false;
  readonly error: {
    readonly code: GeneralWorkerErrorCode;
    readonly message: string;
  };
}

export interface GeneralWorkerFatalMessage {
  readonly protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  readonly type: "fatal";
  readonly code: "invalid-message" | "fatal-error";
}

export type GeneralWorkerResponse = GeneralWorkerSuccessResponse | GeneralWorkerErrorResponse;
export type GeneralWorkerMessage =
  | GeneralWorkerReadyMessage
  | GeneralWorkerRequest
  | GeneralWorkerResponse
  | GeneralWorkerEventMessage
  | GeneralWorkerFatalMessage;

const OPERATIONS: readonly GeneralWorkerOperation[] = [
  "start",
  "send",
  "resolve-tool",
  "cancel",
  "dispose",
  "close",
];
const ERROR_CODES: readonly GeneralWorkerErrorCode[] = [
  "invalid-request",
  "invalid-state",
  "unknown-attempt",
  "duplicate-attempt",
  "unsupported-operation",
];
const EVENT_TYPES: readonly GeneralWorkerEventPayload["type"][] = [
  "started",
  "heartbeat",
  "message",
  "tool-requested",
  "tool-result-accepted",
  "resumed",
  "completed",
  "failed",
  "cancelled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new Error(`${label} contains unsupported field ${unexpected}`);
  }
}

function assertString(
  value: unknown,
  label: string,
  options: {
    readonly allowEmpty?: boolean;
    readonly maximumBytes?: number;
  } = {},
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!options.allowEmpty && value.trim().length === 0) ||
    (options.maximumBytes !== undefined &&
      new TextEncoder().encode(value).byteLength > options.maximumBytes)
  ) {
    throw new Error(`${label} must be a bounded string`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  assertString(value, label);
  try {
    correlationId(value);
  } catch {
    throw new Error(`${label} must be an opaque identifier`);
  }
}

function assertProtocolVersion(value: unknown): void {
  if (value !== GENERAL_WORKER_PROTOCOL_VERSION) {
    throw new Error(`General Worker requires protocol version ${GENERAL_WORKER_PROTOCOL_VERSION}`);
  }
}

function assertMessageSize(value: unknown): void {
  let encoded: Uint8Array;
  try {
    encoded = new TextEncoder().encode(JSON.stringify(value));
  } catch {
    throw new Error("General Worker message must be structurally serializable");
  }
  if (encoded.byteLength > MAX_GENERAL_WORKER_MESSAGE_BYTES) {
    throw new Error(`General Worker message exceeds ${MAX_GENERAL_WORKER_MESSAGE_BYTES} bytes`);
  }
}

function assertRequestBase(value: Record<string, unknown>): asserts value is Record<
  string,
  unknown
> & {
  protocolVersion: typeof GENERAL_WORKER_PROTOCOL_VERSION;
  type: "request";
  requestId: string;
  operation: GeneralWorkerOperation;
  payload: Record<string, unknown>;
} {
  assertExactKeys(
    value,
    ["protocolVersion", "type", "requestId", "operation", "payload"],
    "General Worker request",
  );
  assertProtocolVersion(value.protocolVersion);
  if (value.type !== "request") {
    throw new Error("General Worker request.type must be request");
  }
  assertIdentifier(value.requestId, "General Worker request.requestId");
  if (
    typeof value.operation !== "string" ||
    !OPERATIONS.includes(value.operation as GeneralWorkerOperation)
  ) {
    throw new Error("General Worker request.operation is unsupported");
  }
  assertRecord(value.payload, "General Worker request.payload");
}

export function assertGeneralWorkerRequest(value: unknown): asserts value is GeneralWorkerRequest {
  assertMessageSize(value);
  assertRecord(value, "General Worker request");
  assertRequestBase(value);

  switch (value.operation) {
    case "start":
      assertExactKeys(
        value.payload,
        ["attemptToken", "prompt", "entryState", "executionMode"],
        "General Worker start payload",
      );
      assertIdentifier(value.payload.attemptToken, "General Worker start.attemptToken");
      assertString(value.payload.prompt, "General Worker start.prompt", {
        allowEmpty: true,
        maximumBytes: MAX_GENERAL_WORKER_PROMPT_BYTES,
      });
      if (value.payload.entryState !== "ready" && value.payload.entryState !== "blocked") {
        throw new Error("General Worker start.entryState must be ready or blocked");
      }
      if (
        typeof value.payload.executionMode !== "string" ||
        !GENERAL_WORKER_EXECUTION_MODES.includes(
          value.payload.executionMode as GeneralWorkerExecutionMode,
        )
      ) {
        throw new Error("General Worker start.executionMode is unsupported");
      }
      return;
    case "send":
      assertExactKeys(value.payload, ["attemptToken", "content"], "General Worker send payload");
      assertIdentifier(value.payload.attemptToken, "General Worker send.attemptToken");
      assertString(value.payload.content, "General Worker send.content", {
        allowEmpty: true,
        maximumBytes: MAX_GENERAL_WORKER_PROMPT_BYTES,
      });
      return;
    case "resolve-tool":
      assertExactKeys(
        value.payload,
        ["attemptToken", "callId", "result"],
        "General Worker resolve-tool payload",
      );
      assertIdentifier(value.payload.attemptToken, "General Worker resolve-tool.attemptToken");
      assertIdentifier(value.payload.callId, "General Worker resolve-tool.callId");
      assertAgentToolResult(value.payload.result);
      return;
    case "cancel":
      assertExactKeys(value.payload, ["attemptToken", "reason"], "General Worker cancel payload");
      assertIdentifier(value.payload.attemptToken, "General Worker cancel.attemptToken");
      if (value.payload.reason !== undefined) {
        assertString(value.payload.reason, "General Worker cancel.reason", {
          allowEmpty: true,
          maximumBytes: 4 * 1024,
        });
      }
      return;
    case "dispose":
      assertExactKeys(value.payload, ["attemptToken"], "General Worker dispose payload");
      assertIdentifier(value.payload.attemptToken, "General Worker dispose.attemptToken");
      return;
    case "close":
      assertExactKeys(value.payload, [], "General Worker close payload");
      return;
  }
}

function assertEventPayload(value: unknown): asserts value is GeneralWorkerEventPayload {
  assertRecord(value, "General Worker event payload");
  if (
    typeof value.type !== "string" ||
    !EVENT_TYPES.includes(value.type as GeneralWorkerEventPayload["type"])
  ) {
    throw new Error("General Worker event payload.type is unsupported");
  }

  switch (value.type) {
    case "started":
    case "heartbeat":
    case "resumed":
    case "completed":
      assertExactKeys(value, ["type"], `General Worker ${value.type} event`);
      return;
    case "message":
      assertExactKeys(value, ["type", "role", "content"], "General Worker message event");
      if (value.role !== "assistant" && value.role !== "system") {
        throw new Error("General Worker message event.role is unsupported");
      }
      assertString(value.content, "General Worker message event.content", {
        allowEmpty: true,
        maximumBytes: MAX_GENERAL_WORKER_PROMPT_BYTES,
      });
      return;
    case "tool-requested":
      assertExactKeys(
        value,
        ["type", "callId", "toolName", "summary"],
        "General Worker tool-requested event",
      );
      assertIdentifier(value.callId, "General Worker tool-requested.callId");
      assertString(value.toolName, "General Worker tool-requested.toolName", {
        maximumBytes: 256,
      });
      assertString(value.summary, "General Worker tool-requested.summary", {
        maximumBytes: 4 * 1024,
      });
      return;
    case "tool-result-accepted":
      assertExactKeys(
        value,
        ["type", "callId", "status"],
        "General Worker tool-result-accepted event",
      );
      assertIdentifier(value.callId, "General Worker tool-result-accepted.callId");
      if (
        value.status !== "succeeded" &&
        value.status !== "failed" &&
        value.status !== "cancelled"
      ) {
        throw new Error("General Worker tool-result-accepted.status is unsupported");
      }
      return;
    case "failed":
      assertExactKeys(value, ["type", "errorCode", "message"], "General Worker failed event");
      assertString(value.errorCode, "General Worker failed.errorCode", {
        maximumBytes: 128,
      });
      assertString(value.message, "General Worker failed.message", {
        allowEmpty: true,
        maximumBytes: 4 * 1024,
      });
      return;
    case "cancelled":
      assertExactKeys(value, ["type", "reason"], "General Worker cancelled event");
      if (value.reason !== undefined) {
        assertString(value.reason, "General Worker cancelled.reason", {
          allowEmpty: true,
          maximumBytes: 4 * 1024,
        });
      }
      return;
  }
}

function assertReady(value: Record<string, unknown>): void {
  assertExactKeys(
    value,
    [
      "protocolVersion",
      "type",
      "role",
      "implementationVersion",
      "capabilities",
      "maxConcurrentAttempts",
      "heartbeatIntervalMs",
    ],
    "General Worker ready message",
  );
  assertProtocolVersion(value.protocolVersion);
  if (
    value.type !== "ready" ||
    value.role !== GENERAL_WORKER_ROLE ||
    value.implementationVersion !== GENERAL_WORKER_IMPLEMENTATION_VERSION
  ) {
    throw new Error("General Worker ready identity is incompatible");
  }
  const capabilities = value.capabilities;
  if (
    !Array.isArray(capabilities) ||
    capabilities.length !== GENERAL_WORKER_CAPABILITIES.length ||
    new Set(capabilities).size !== capabilities.length ||
    GENERAL_WORKER_CAPABILITIES.some((capability) => !capabilities.includes(capability))
  ) {
    throw new Error("General Worker ready capabilities are incompatible");
  }
  if (value.maxConcurrentAttempts !== 1) {
    throw new Error("General Worker must declare one concurrent attempt");
  }
  if (
    !Number.isSafeInteger(value.heartbeatIntervalMs) ||
    (value.heartbeatIntervalMs as number) < 1
  ) {
    throw new Error("General Worker heartbeat interval is invalid");
  }
}

function assertResponse(value: Record<string, unknown>): void {
  assertProtocolVersion(value.protocolVersion);
  assertIdentifier(value.requestId, "General Worker response.requestId");
  if (
    typeof value.operation !== "string" ||
    !OPERATIONS.includes(value.operation as GeneralWorkerOperation)
  ) {
    throw new Error("General Worker response.operation is unsupported");
  }
  if (value.ok === true) {
    assertExactKeys(
      value,
      ["protocolVersion", "type", "requestId", "operation", "ok"],
      "General Worker success response",
    );
    return;
  }
  if (value.ok !== false) {
    throw new Error("General Worker response.ok must be boolean");
  }
  assertExactKeys(
    value,
    ["protocolVersion", "type", "requestId", "operation", "ok", "error"],
    "General Worker error response",
  );
  assertRecord(value.error, "General Worker response.error");
  assertExactKeys(value.error, ["code", "message"], "General Worker response.error");
  if (
    typeof value.error.code !== "string" ||
    !ERROR_CODES.includes(value.error.code as GeneralWorkerErrorCode)
  ) {
    throw new Error("General Worker response.error.code is unsupported");
  }
  assertString(value.error.message, "General Worker response.error.message", {
    allowEmpty: true,
    maximumBytes: 4 * 1024,
  });
}

export function assertGeneralWorkerMessage(value: unknown): asserts value is GeneralWorkerMessage {
  assertMessageSize(value);
  assertRecord(value, "General Worker message");
  if (value.type === "request") {
    assertGeneralWorkerRequest(value);
    return;
  }
  if (value.type === "ready") {
    assertReady(value);
    return;
  }
  if (value.type === "response") {
    assertResponse(value);
    return;
  }
  if (value.type === "event") {
    assertExactKeys(
      value,
      ["protocolVersion", "type", "attemptToken", "sequence", "event"],
      "General Worker event message",
    );
    assertProtocolVersion(value.protocolVersion);
    assertIdentifier(value.attemptToken, "General Worker event.attemptToken");
    if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
      throw new Error("General Worker event.sequence must be a positive integer");
    }
    assertEventPayload(value.event);
    return;
  }
  if (value.type === "fatal") {
    assertExactKeys(value, ["protocolVersion", "type", "code"], "General Worker fatal message");
    assertProtocolVersion(value.protocolVersion);
    if (value.code !== "invalid-message" && value.code !== "fatal-error") {
      throw new Error("General Worker fatal code is unsupported");
    }
    return;
  }
  throw new Error("General Worker message.type is unsupported");
}

export function createGeneralWorkerReadyMessage(): GeneralWorkerReadyMessage {
  return Object.freeze({
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "ready",
    role: GENERAL_WORKER_ROLE,
    implementationVersion: GENERAL_WORKER_IMPLEMENTATION_VERSION,
    capabilities: Object.freeze([...GENERAL_WORKER_CAPABILITIES]),
    maxConcurrentAttempts: 1,
    heartbeatIntervalMs: 1_000,
  });
}

export function createGeneralWorkerFatalMessage(
  code: GeneralWorkerFatalMessage["code"],
): GeneralWorkerFatalMessage {
  return Object.freeze({
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "fatal",
    code,
  });
}
