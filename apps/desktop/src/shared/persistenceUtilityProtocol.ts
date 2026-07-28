import {
  CORE_CONTRACT_ERROR_CODES,
  PERSISTENCE_ERROR_CODES,
  assertAgentAttemptEvidence,
  assertAppendPrivilegedAuditInput,
  assertAuditRecord,
  assertCoreEvent,
  assertCoreEventCursor,
  assertCoreEventStream,
  assertDomainGraph,
  assertPersistContentReferenceResult,
  assertPersistWorkspaceGrantResult,
  assertResolveContentReferenceInput,
  assertResolvedContentReference,
  assertStoreContentReferenceInput,
  assertWorkspaceGrant,
  correlationId,
  eventStreamId,
  workspaceId,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type AuditRecord,
  type CoreContractErrorCode,
  type CoreEvent,
  type CoreEventCursor,
  type DomainGraph,
  type EventStreamId,
  type PersistContentReferenceResult,
  type PersistEvidenceResult,
  type PersistEventResult,
  type PersistenceErrorCode,
  type PersistWorkspaceGrantResult,
  type PrivilegedAuditSummary,
  type ResolveContentReferenceInput,
  type ResolvedContentReference,
  type StoreContentReferenceInput,
  type WorkspaceGrant,
  type WorkspaceId,
} from "../core";

export const PERSISTENCE_UTILITY_PROTOCOL_VERSION = 1 as const;
export const PERSISTENCE_UTILITY_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;

export interface PersistenceUtilityOperationMap {
  readonly open: {
    readonly request: {
      readonly userDataPath: string;
    };
    readonly result: {
      readonly schemaVersion: number;
    };
  };
  readonly "load-domain-graph": {
    readonly request: Record<string, never>;
    readonly result: DomainGraph;
  };
  readonly "replace-domain-graph": {
    readonly request: {
      readonly graph: DomainGraph;
    };
    readonly result: null;
  };
  readonly "append-event": {
    readonly request: {
      readonly event: CoreEvent;
    };
    readonly result: PersistEventResult;
  };
  readonly "replay-events": {
    readonly request: {
      readonly streamId: EventStreamId;
      readonly after: CoreEventCursor | null;
    };
    readonly result: readonly CoreEvent[];
  };
  readonly "append-privileged-audit": {
    readonly request: {
      readonly input: AppendPrivilegedAuditInput;
    };
    readonly result: AuditRecord;
  };
  readonly "append-agent-attempt-evidence": {
    readonly request: {
      readonly evidence: AgentAttemptEvidence;
    };
    readonly result: PersistEvidenceResult;
  };
  readonly "summarize-privileged-audit": {
    readonly request: Record<string, never>;
    readonly result: PrivilegedAuditSummary;
  };
  readonly "list-agent-attempt-evidence": {
    readonly request: {
      readonly limit: number;
    };
    readonly result: readonly AgentAttemptEvidence[];
  };
  readonly "persist-workspace-grant": {
    readonly request: {
      readonly grant: WorkspaceGrant;
    };
    readonly result: PersistWorkspaceGrantResult;
  };
  readonly "get-active-workspace-grant": {
    readonly request: {
      readonly workspaceId: WorkspaceId;
    };
    readonly result: WorkspaceGrant | null;
  };
  readonly "store-content-reference": {
    readonly request: {
      readonly input: StoreContentReferenceInput;
    };
    readonly result: PersistContentReferenceResult;
  };
  readonly "resolve-content-reference": {
    readonly request: {
      readonly input: ResolveContentReferenceInput;
    };
    readonly result: ResolvedContentReference;
  };
  readonly close: {
    readonly request: Record<string, never>;
    readonly result: null;
  };
}

export type PersistenceUtilityOperation = keyof PersistenceUtilityOperationMap;

export const PERSISTENCE_UTILITY_OPERATIONS = [
  "open",
  "load-domain-graph",
  "replace-domain-graph",
  "append-event",
  "replay-events",
  "append-privileged-audit",
  "append-agent-attempt-evidence",
  "summarize-privileged-audit",
  "list-agent-attempt-evidence",
  "persist-workspace-grant",
  "get-active-workspace-grant",
  "store-content-reference",
  "resolve-content-reference",
  "close",
] as const satisfies readonly (keyof PersistenceUtilityOperationMap)[];

export type PersistenceUtilityRequest<
  Operation extends PersistenceUtilityOperation = PersistenceUtilityOperation,
> = {
  readonly [Current in Operation]: {
    readonly protocolVersion: typeof PERSISTENCE_UTILITY_PROTOCOL_VERSION;
    readonly type: "request";
    readonly requestId: string;
    readonly operation: Current;
    readonly payload: PersistenceUtilityOperationMap[Current]["request"];
  };
}[Operation];

export type PersistenceUtilityErrorData =
  | {
      readonly domain: "persistence";
      readonly code: PersistenceErrorCode;
      readonly message: string;
    }
  | {
      readonly domain: "core-contract";
      readonly code: CoreContractErrorCode;
      readonly message: string;
    }
  | {
      readonly domain: "utility";
      readonly code: "already-open" | "not-open" | "operation-failed";
      readonly message: string;
    };

export type PersistenceUtilitySuccessResponse<
  Operation extends PersistenceUtilityOperation = PersistenceUtilityOperation,
> = {
  readonly [Current in Operation]: {
    readonly protocolVersion: typeof PERSISTENCE_UTILITY_PROTOCOL_VERSION;
    readonly type: "response";
    readonly requestId: string;
    readonly operation: Current;
    readonly status: "ok";
    readonly result: PersistenceUtilityOperationMap[Current]["result"];
  };
}[Operation];

export interface PersistenceUtilityErrorResponse {
  readonly protocolVersion: typeof PERSISTENCE_UTILITY_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly operation: PersistenceUtilityOperation;
  readonly status: "error";
  readonly error: PersistenceUtilityErrorData;
}

export interface PersistenceUtilityReadyMessage {
  readonly protocolVersion: typeof PERSISTENCE_UTILITY_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly role: "persistence";
}

export interface PersistenceUtilityFatalMessage {
  readonly protocolVersion: typeof PERSISTENCE_UTILITY_PROTOCOL_VERSION;
  readonly type: "fatal";
  readonly role: "persistence";
  readonly code: "invalid-request" | "fatal-error";
  readonly message: string;
}

export type PersistenceUtilityResponse =
  | PersistenceUtilitySuccessResponse
  | PersistenceUtilityErrorResponse;

export type PersistenceUtilityMessage =
  | PersistenceUtilityRequest
  | PersistenceUtilityResponse
  | PersistenceUtilityReadyMessage
  | PersistenceUtilityFatalMessage;

export class PersistenceUtilityProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceUtilityProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PersistenceUtilityProtocolError(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpected !== undefined) {
    throw new PersistenceUtilityProtocolError(`${label} contains unsupported field ${unexpected}`);
  }
  const missing = keys.find((key) => !(key in value));
  if (missing !== undefined) {
    throw new PersistenceUtilityProtocolError(`${label} is missing field ${missing}`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new PersistenceUtilityProtocolError(`${label} must be an identifier`);
  }
  try {
    correlationId(value);
  } catch {
    throw new PersistenceUtilityProtocolError(`${label} is invalid`);
  }
}

function assertEmptyPayload(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(value, [], label);
}

function assertStatusResult(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(value, ["status"], label);
  if (value.status !== "appended" && value.status !== "duplicate") {
    throw new PersistenceUtilityProtocolError(`${label}.status is unsupported`);
  }
}

function assertPositiveSchemaVersion(value: unknown): void {
  assertRecord(value, "Persistence utility open result");
  assertExactKeys(value, ["schemaVersion"], "Persistence utility open result");
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    throw new PersistenceUtilityProtocolError(
      "Persistence utility open result.schemaVersion is invalid",
    );
  }
}

function assertAuditSummary(value: unknown): void {
  assertRecord(value, "Privileged audit summary");
  assertExactKeys(value, ["recordCount", "lastSequence"], "Privileged audit summary");
  if (
    !Number.isSafeInteger(value.recordCount) ||
    (value.recordCount as number) < 0 ||
    !Number.isSafeInteger(value.lastSequence) ||
    value.lastSequence !== value.recordCount
  ) {
    throw new PersistenceUtilityProtocolError("Privileged audit summary is invalid");
  }
}

function assertErrorData(value: unknown): asserts value is PersistenceUtilityErrorData {
  assertRecord(value, "Persistence utility error");
  assertExactKeys(value, ["domain", "code", "message"], "Persistence utility error");
  if (
    typeof value.message !== "string" ||
    value.message.length === 0 ||
    value.message.length > 512
  ) {
    throw new PersistenceUtilityProtocolError("Persistence utility error.message is invalid");
  }
  if (value.domain === "persistence") {
    if (
      typeof value.code !== "string" ||
      !PERSISTENCE_ERROR_CODES.includes(value.code as PersistenceErrorCode)
    ) {
      throw new PersistenceUtilityProtocolError("Persistence utility error.code is invalid");
    }
    return;
  }
  if (value.domain === "core-contract") {
    if (
      typeof value.code !== "string" ||
      !CORE_CONTRACT_ERROR_CODES.includes(value.code as CoreContractErrorCode)
    ) {
      throw new PersistenceUtilityProtocolError("Persistence utility error.code is invalid");
    }
    return;
  }
  if (
    value.domain !== "utility" ||
    (value.code !== "already-open" &&
      value.code !== "not-open" &&
      value.code !== "operation-failed")
  ) {
    throw new PersistenceUtilityProtocolError("Persistence utility error domain is invalid");
  }
}

function assertMessageBound(value: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new PersistenceUtilityProtocolError("Persistence utility message is not serializable");
  }
  if (
    typeof encoded !== "string" ||
    new TextEncoder().encode(encoded).byteLength > PERSISTENCE_UTILITY_MAX_MESSAGE_BYTES
  ) {
    throw new PersistenceUtilityProtocolError("Persistence utility message exceeds its bound");
  }
}

function assertOperation(value: unknown): asserts value is PersistenceUtilityOperation {
  if (
    typeof value !== "string" ||
    !PERSISTENCE_UTILITY_OPERATIONS.includes(value as PersistenceUtilityOperation)
  ) {
    throw new PersistenceUtilityProtocolError("Persistence utility operation is unsupported");
  }
}

function assertNeverOperation(operation: never): never {
  throw new PersistenceUtilityProtocolError(
    `Persistence utility operation has no validator: ${String(operation)}`,
  );
}

function assertRequestPayload(request: PersistenceUtilityRequest): void {
  const payload: unknown = request.payload;
  switch (request.operation) {
    case "open":
      assertRecord(payload, "Persistence utility open request");
      assertExactKeys(payload, ["userDataPath"], "Persistence utility open request");
      if (
        typeof payload.userDataPath !== "string" ||
        payload.userDataPath.length === 0 ||
        payload.userDataPath.length > 4096 ||
        payload.userDataPath.includes("\0")
      ) {
        throw new PersistenceUtilityProtocolError(
          "Persistence utility open request.userDataPath is invalid",
        );
      }
      return;
    case "load-domain-graph":
    case "summarize-privileged-audit":
    case "close":
      assertEmptyPayload(payload, `${request.operation} request`);
      return;
    case "replace-domain-graph":
      assertRecord(payload, "replace-domain-graph request");
      assertExactKeys(payload, ["graph"], "replace-domain-graph request");
      assertDomainGraph(payload.graph as DomainGraph);
      return;
    case "append-event":
      assertRecord(payload, "append-event request");
      assertExactKeys(payload, ["event"], "append-event request");
      assertCoreEvent(payload.event);
      return;
    case "replay-events":
      assertRecord(payload, "replay-events request");
      assertExactKeys(payload, ["streamId", "after"], "replay-events request");
      if (typeof payload.streamId !== "string") {
        throw new PersistenceUtilityProtocolError("replay-events streamId is invalid");
      }
      eventStreamId(payload.streamId);
      if (payload.after !== null) {
        assertCoreEventCursor(payload.after);
      }
      return;
    case "append-privileged-audit":
      assertRecord(payload, "append-privileged-audit request");
      assertExactKeys(payload, ["input"], "append-privileged-audit request");
      assertAppendPrivilegedAuditInput(payload.input);
      return;
    case "append-agent-attempt-evidence":
      assertRecord(payload, "append-agent-attempt-evidence request");
      assertExactKeys(payload, ["evidence"], "append-agent-attempt-evidence request");
      assertAgentAttemptEvidence(payload.evidence);
      return;
    case "list-agent-attempt-evidence":
      assertRecord(payload, "list-agent-attempt-evidence request");
      assertExactKeys(payload, ["limit"], "list-agent-attempt-evidence request");
      if (
        !Number.isSafeInteger(payload.limit) ||
        (payload.limit as number) < 1 ||
        (payload.limit as number) > 50
      ) {
        throw new PersistenceUtilityProtocolError("list-agent-attempt-evidence limit is invalid");
      }
      return;
    case "persist-workspace-grant":
      assertRecord(payload, "persist-workspace-grant request");
      assertExactKeys(payload, ["grant"], "persist-workspace-grant request");
      assertWorkspaceGrant(payload.grant);
      return;
    case "get-active-workspace-grant":
      assertRecord(payload, "get-active-workspace-grant request");
      assertExactKeys(payload, ["workspaceId"], "get-active-workspace-grant request");
      if (typeof payload.workspaceId !== "string") {
        throw new PersistenceUtilityProtocolError(
          "get-active-workspace-grant workspaceId is invalid",
        );
      }
      workspaceId(payload.workspaceId);
      return;
    case "store-content-reference":
      assertRecord(payload, "store-content-reference request");
      assertExactKeys(payload, ["input"], "store-content-reference request");
      assertStoreContentReferenceInput(payload.input);
      return;
    case "resolve-content-reference":
      assertRecord(payload, "resolve-content-reference request");
      assertExactKeys(payload, ["input"], "resolve-content-reference request");
      assertResolveContentReferenceInput(payload.input);
      return;
    default:
      assertNeverOperation(request);
  }
}

function assertSuccessResult(operation: PersistenceUtilityOperation, result: unknown): void {
  switch (operation) {
    case "open":
      assertPositiveSchemaVersion(result);
      return;
    case "load-domain-graph":
      assertDomainGraph(result as DomainGraph);
      return;
    case "replace-domain-graph":
    case "close":
      if (result !== null) {
        throw new PersistenceUtilityProtocolError(`${operation} result must be null`);
      }
      return;
    case "append-event":
    case "append-agent-attempt-evidence":
      assertStatusResult(result, `${operation} result`);
      return;
    case "replay-events":
      if (!Array.isArray(result)) {
        throw new PersistenceUtilityProtocolError("replay-events result must be an array");
      }
      assertCoreEventStream(result);
      return;
    case "append-privileged-audit":
      assertAuditRecord(result);
      return;
    case "summarize-privileged-audit":
      assertAuditSummary(result);
      return;
    case "list-agent-attempt-evidence":
      if (!Array.isArray(result) || result.length > 50) {
        throw new PersistenceUtilityProtocolError("list-agent-attempt-evidence result is invalid");
      }
      result.forEach(assertAgentAttemptEvidence);
      return;
    case "persist-workspace-grant":
      assertPersistWorkspaceGrantResult(result);
      return;
    case "get-active-workspace-grant":
      if (result !== null) {
        assertWorkspaceGrant(result);
      }
      return;
    case "store-content-reference":
      assertPersistContentReferenceResult(result);
      return;
    case "resolve-content-reference":
      assertResolvedContentReference(result);
      return;
    default:
      assertNeverOperation(operation);
  }
}

export function assertPersistenceUtilityRequest(
  value: unknown,
): asserts value is PersistenceUtilityRequest {
  assertMessageBound(value);
  assertRecord(value, "Persistence utility request");
  assertExactKeys(
    value,
    ["protocolVersion", "type", "requestId", "operation", "payload"],
    "Persistence utility request",
  );
  if (value.protocolVersion !== PERSISTENCE_UTILITY_PROTOCOL_VERSION || value.type !== "request") {
    throw new PersistenceUtilityProtocolError("Persistence utility request envelope is invalid");
  }
  assertIdentifier(value.requestId, "Persistence utility request.requestId");
  assertOperation(value.operation);
  assertRequestPayload(value as PersistenceUtilityRequest);
}

export function assertPersistenceUtilityMessage(
  value: unknown,
): asserts value is PersistenceUtilityMessage {
  assertMessageBound(value);
  assertRecord(value, "Persistence utility message");
  if (value.protocolVersion !== PERSISTENCE_UTILITY_PROTOCOL_VERSION) {
    throw new PersistenceUtilityProtocolError(
      "Persistence utility message protocol version is incompatible",
    );
  }

  if (value.type === "ready") {
    assertExactKeys(value, ["protocolVersion", "type", "role"], "Persistence utility ready");
    if (value.role !== "persistence") {
      throw new PersistenceUtilityProtocolError("Persistence utility ready role is invalid");
    }
    return;
  }
  if (value.type === "fatal") {
    assertExactKeys(
      value,
      ["protocolVersion", "type", "role", "code", "message"],
      "Persistence utility fatal message",
    );
    if (
      value.role !== "persistence" ||
      (value.code !== "invalid-request" && value.code !== "fatal-error") ||
      typeof value.message !== "string" ||
      value.message.length === 0 ||
      value.message.length > 512
    ) {
      throw new PersistenceUtilityProtocolError("Persistence utility fatal message is invalid");
    }
    return;
  }
  if (value.type === "request") {
    assertPersistenceUtilityRequest(value);
    return;
  }
  if (value.type !== "response") {
    throw new PersistenceUtilityProtocolError("Persistence utility message type is unsupported");
  }

  assertIdentifier(value.requestId, "Persistence utility response.requestId");
  assertOperation(value.operation);
  if (value.status === "ok") {
    assertExactKeys(
      value,
      ["protocolVersion", "type", "requestId", "operation", "status", "result"],
      "Persistence utility success response",
    );
    assertSuccessResult(value.operation, value.result);
    return;
  }
  if (value.status === "error") {
    assertExactKeys(
      value,
      ["protocolVersion", "type", "requestId", "operation", "status", "error"],
      "Persistence utility error response",
    );
    assertErrorData(value.error);
    return;
  }
  throw new PersistenceUtilityProtocolError("Persistence utility response status is invalid");
}

export function createPersistenceUtilityReadyMessage(): PersistenceUtilityReadyMessage {
  return Object.freeze({
    protocolVersion: PERSISTENCE_UTILITY_PROTOCOL_VERSION,
    type: "ready",
    role: "persistence",
  });
}

export function createPersistenceUtilityFatalMessage(
  code: PersistenceUtilityFatalMessage["code"],
): PersistenceUtilityFatalMessage {
  return Object.freeze({
    protocolVersion: PERSISTENCE_UTILITY_PROTOCOL_VERSION,
    type: "fatal",
    role: "persistence",
    code,
    message:
      code === "invalid-request"
        ? "Persistence utility rejected an invalid request"
        : "Persistence utility encountered a fatal error",
  });
}

export function createPersistenceUtilitySuccessResponse<
  Operation extends PersistenceUtilityOperation,
>(
  request: PersistenceUtilityRequest<Operation>,
  result: PersistenceUtilityOperationMap[Operation]["result"],
): PersistenceUtilitySuccessResponse<Operation> {
  return {
    protocolVersion: PERSISTENCE_UTILITY_PROTOCOL_VERSION,
    type: "response",
    requestId: request.requestId,
    operation: request.operation,
    status: "ok",
    result,
  } as PersistenceUtilitySuccessResponse<Operation>;
}

export function createPersistenceUtilityErrorResponse(
  request: PersistenceUtilityRequest,
  error: PersistenceUtilityErrorData,
): PersistenceUtilityErrorResponse {
  return {
    protocolVersion: PERSISTENCE_UTILITY_PROTOCOL_VERSION,
    type: "response",
    requestId: request.requestId,
    operation: request.operation,
    status: "error",
    error,
  };
}
