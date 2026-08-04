import {
  AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT,
  AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
  assertAionUiApprovalAuthorityLimit,
  assertAionUiApprovalDecisionRecord,
  assertAionUiGeneralWorkLink,
  assertAionUiGeneralWorkRegistration,
  assertAionUiScheduleClaimInput,
  assertAionUiScheduleClaimResult,
  assertAionUiScheduleCompletionInput,
  assertAionUiScheduleCompletionResult,
  assertAionUiScheduleDeleteInput,
  assertAionUiScheduleJob,
  assertAionUiScheduleJobId,
  assertAionUiScheduleJobList,
  assertAionUiScheduleListInput,
  assertAionUiScheduleMutationResult,
  assertAionUiSchedulePersistenceUpdateInput,
  assertAionUiScheduleRecoveryInput,
  assertAionUiScheduleRegistration,
  assertAionUiScheduleRegistrationResult,
  assertAionUiShadowEvidence,
  assertNormalizedAionUiApprovalDecision,
  type AionUiApprovalAuthoritySummary,
  type AionUiApprovalDecisionRecord,
  type AionUiGeneralWorkLink,
  type AionUiGeneralWorkRegistration,
  type AionUiScheduleClaimInput,
  type AionUiScheduleClaimResult,
  type AionUiScheduleCompletionInput,
  type AionUiScheduleCompletionResult,
  type AionUiScheduleDeleteInput,
  type AionUiScheduleJob,
  type AionUiScheduleListInput,
  type AionUiScheduleMutationResult,
  type AionUiSchedulePersistenceUpdateInput,
  type AionUiScheduleRecoveryInput,
  type AionUiScheduleRegistration,
  type AionUiScheduleRegistrationResult,
  type RegisterAionUiGeneralWorkJourneyResult,
  type AionUiShadowEvidence,
  type AionUiShadowEvidenceSummary,
  type AppendAionUiShadowEvidenceResult,
  type NormalizedAionUiApprovalDecision,
  type ReserveAionUiApprovalDecisionResult,
  type StoredAionUiShadowEvidence,
} from "../compatibility/aionui";
import {
  CORE_CONTRACT_ERROR_CODES,
  PERSISTENCE_ERROR_CODES,
  assertAgentAttemptEvidence,
  assertAdmittedTeamPlan,
  assertAppendPrivilegedAuditInput,
  assertAuditRecord,
  assertCoreEvent,
  assertCoreEventCursor,
  assertCoreEventStream,
  assertDomainGraph,
  assertGeneralWorkCheckpoint,
  assertPersistContentReferenceResult,
  assertPersistAdmittedTeamPlanResult,
  assertPersistWorkspaceGrantResult,
  assertResolveContentReferenceInput,
  assertResolvedContentReference,
  assertStoreContentReferenceInput,
  assertWorkspaceGrant,
  correlationId,
  eventStreamId,
  instant,
  sessionId,
  teamPlanId,
  workspaceId,
  type AdmittedTeamPlan,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type AuditRecord,
  type CoreContractErrorCode,
  type CoreEvent,
  type CoreEventCursor,
  type DomainGraph,
  type EventStreamId,
  type GeneralWorkCheckpoint,
  type PersistGeneralWorkCheckpointResult,
  type PersistContentReferenceResult,
  type PersistAdmittedTeamPlanResult,
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
  type SessionId,
  type TeamPlanId,
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
  readonly "append-aionui-shadow-evidence": {
    readonly request: {
      readonly evidence: AionUiShadowEvidence;
    };
    readonly result: AppendAionUiShadowEvidenceResult;
  };
  readonly "list-aionui-shadow-evidence": {
    readonly request: {
      readonly limit: number;
    };
    readonly result: readonly StoredAionUiShadowEvidence[];
  };
  readonly "summarize-aionui-shadow-evidence": {
    readonly request: Record<string, never>;
    readonly result: AionUiShadowEvidenceSummary;
  };
  readonly "reserve-aionui-approval-decision": {
    readonly request: {
      readonly decision: NormalizedAionUiApprovalDecision;
      readonly now: string;
    };
    readonly result: ReserveAionUiApprovalDecisionResult;
  };
  readonly "begin-aionui-approval-delivery": {
    readonly request: {
      readonly decisionId: string;
      readonly now: string;
    };
    readonly result: AionUiApprovalDecisionRecord;
  };
  readonly "mark-aionui-approval-delivered": {
    readonly request: {
      readonly decisionId: string;
      readonly now: string;
    };
    readonly result: AionUiApprovalDecisionRecord;
  };
  readonly "mark-aionui-approval-delivery-failed": {
    readonly request: {
      readonly decisionId: string;
      readonly errorCode: string;
      readonly now: string;
    };
    readonly result: AionUiApprovalDecisionRecord;
  };
  readonly "get-aionui-approval-decision": {
    readonly request: {
      readonly decisionId: string;
    };
    readonly result: AionUiApprovalDecisionRecord | null;
  };
  readonly "list-pending-aionui-approval-decisions": {
    readonly request: {
      readonly limit: number;
    };
    readonly result: readonly AionUiApprovalDecisionRecord[];
  };
  readonly "summarize-aionui-approval-authority": {
    readonly request: Record<string, never>;
    readonly result: AionUiApprovalAuthoritySummary;
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
  readonly "persist-general-work-checkpoint": {
    readonly request: {
      readonly checkpoint: GeneralWorkCheckpoint;
    };
    readonly result: PersistGeneralWorkCheckpointResult;
  };
  readonly "get-general-work-checkpoint": {
    readonly request: {
      readonly sessionId: SessionId;
    };
    readonly result: GeneralWorkCheckpoint | null;
  };
  readonly "list-recoverable-general-work-checkpoints": {
    readonly request: {
      readonly limit: number;
    };
    readonly result: readonly GeneralWorkCheckpoint[];
  };
  readonly "persist-admitted-team-plan": {
    readonly request: {
      readonly plan: AdmittedTeamPlan;
    };
    readonly result: PersistAdmittedTeamPlanResult;
  };
  readonly "get-admitted-team-plan": {
    readonly request: {
      readonly planId: TeamPlanId;
    };
    readonly result: AdmittedTeamPlan | null;
  };
  readonly "list-aionui-general-work-links": {
    readonly request: {
      readonly conversationHash: string;
      readonly limit: number;
    };
    readonly result: readonly AionUiGeneralWorkLink[];
  };
  readonly "list-prepared-aionui-general-work-links": {
    readonly request: {
      readonly limit: number;
    };
    readonly result: readonly AionUiGeneralWorkLink[];
  };
  readonly "register-aionui-general-work": {
    readonly request: {
      readonly registration: AionUiGeneralWorkRegistration;
    };
    readonly result: RegisterAionUiGeneralWorkJourneyResult;
  };
  readonly "register-aionui-schedule": {
    readonly request: {
      readonly registration: AionUiScheduleRegistration;
    };
    readonly result: AionUiScheduleRegistrationResult;
  };
  readonly "list-aionui-schedules": {
    readonly request: {
      readonly input: AionUiScheduleListInput;
    };
    readonly result: readonly AionUiScheduleJob[];
  };
  readonly "get-aionui-schedule": {
    readonly request: {
      readonly jobId: string;
    };
    readonly result: AionUiScheduleJob | null;
  };
  readonly "update-aionui-schedule": {
    readonly request: {
      readonly input: AionUiSchedulePersistenceUpdateInput;
    };
    readonly result: AionUiScheduleMutationResult;
  };
  readonly "delete-aionui-schedule": {
    readonly request: {
      readonly input: AionUiScheduleDeleteInput;
    };
    readonly result: AionUiScheduleMutationResult;
  };
  readonly "claim-aionui-schedule-run": {
    readonly request: {
      readonly input: AionUiScheduleClaimInput;
    };
    readonly result: AionUiScheduleClaimResult;
  };
  readonly "complete-aionui-schedule-run": {
    readonly request: {
      readonly input: AionUiScheduleCompletionInput;
    };
    readonly result: AionUiScheduleCompletionResult;
  };
  readonly "recover-aionui-schedule-runs": {
    readonly request: {
      readonly input: AionUiScheduleRecoveryInput;
    };
    readonly result: readonly AionUiScheduleJob[];
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
  "append-aionui-shadow-evidence",
  "list-aionui-shadow-evidence",
  "summarize-aionui-shadow-evidence",
  "reserve-aionui-approval-decision",
  "begin-aionui-approval-delivery",
  "mark-aionui-approval-delivered",
  "mark-aionui-approval-delivery-failed",
  "get-aionui-approval-decision",
  "list-pending-aionui-approval-decisions",
  "summarize-aionui-approval-authority",
  "persist-workspace-grant",
  "get-active-workspace-grant",
  "store-content-reference",
  "resolve-content-reference",
  "persist-general-work-checkpoint",
  "get-general-work-checkpoint",
  "list-recoverable-general-work-checkpoints",
  "persist-admitted-team-plan",
  "get-admitted-team-plan",
  "list-aionui-general-work-links",
  "list-prepared-aionui-general-work-links",
  "register-aionui-general-work",
  "register-aionui-schedule",
  "list-aionui-schedules",
  "get-aionui-schedule",
  "update-aionui-schedule",
  "delete-aionui-schedule",
  "claim-aionui-schedule-run",
  "complete-aionui-schedule-run",
  "recover-aionui-schedule-runs",
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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
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

function assertAionUiIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    value.trim() !== value ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new PersistenceUtilityProtocolError(`${label} is invalid`);
  }
}

function assertCanonicalInstant(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new PersistenceUtilityProtocolError(`${label} must be a canonical instant`);
  }
  try {
    instant(value);
  } catch {
    throw new PersistenceUtilityProtocolError(`${label} must be a canonical instant`);
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

function assertGaplessSummary(value: unknown, label: string): void {
  assertRecord(value, label);
  assertExactKeys(value, ["recordCount", "lastSequence"], label);
  if (
    !Number.isSafeInteger(value.recordCount) ||
    (value.recordCount as number) < 0 ||
    !Number.isSafeInteger(value.lastSequence) ||
    value.lastSequence !== value.recordCount
  ) {
    throw new PersistenceUtilityProtocolError(`${label} is invalid`);
  }
}

function assertShadowAppendResult(value: unknown): void {
  assertRecord(value, "AionUi shadow append result");
  assertExactKeys(value, ["status", "sequence"], "AionUi shadow append result");
  if (
    (value.status !== "appended" && value.status !== "duplicate") ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 1
  ) {
    throw new PersistenceUtilityProtocolError("AionUi shadow append result is invalid");
  }
}

function assertStoredShadowEvidence(value: unknown): void {
  assertRecord(value, "Stored AionUi shadow evidence");
  assertExactKeys(value, ["sequence", "evidence"], "Stored AionUi shadow evidence");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    throw new PersistenceUtilityProtocolError("Stored AionUi shadow sequence is invalid");
  }
  assertAionUiShadowEvidence(value.evidence);
}

function assertApprovalReserveResult(value: unknown): void {
  assertRecord(value, "AionUi approval reserve result");
  assertExactKeys(value, ["status", "record"], "AionUi approval reserve result");
  if (value.status !== "created" && value.status !== "duplicate") {
    throw new PersistenceUtilityProtocolError("AionUi approval reserve status is invalid");
  }
  assertAionUiApprovalDecisionRecord(value.record);
}

function assertApprovalSummary(value: unknown): void {
  assertRecord(value, "AionUi approval summary");
  assertExactKeys(
    value,
    ["recordCount", "pendingCount", "deliveredCount"],
    "AionUi approval summary",
  );
  if (
    !Number.isSafeInteger(value.recordCount) ||
    (value.recordCount as number) < 0 ||
    !Number.isSafeInteger(value.pendingCount) ||
    (value.pendingCount as number) < 0 ||
    !Number.isSafeInteger(value.deliveredCount) ||
    (value.deliveredCount as number) < 0 ||
    value.recordCount !== (value.pendingCount as number) + (value.deliveredCount as number)
  ) {
    throw new PersistenceUtilityProtocolError("AionUi approval summary is invalid");
  }
}

function assertAionUiGeneralWorkRegistrationResult(value: unknown): void {
  assertRecord(value, "AionUI general-work registration result");
  assertExactKeys(value, ["status", "link"], "AionUI general-work registration result");
  if (value.status !== "stored" && value.status !== "duplicate") {
    throw new PersistenceUtilityProtocolError("AionUI general-work registration status is invalid");
  }
  assertAionUiGeneralWorkLink(value.link);
}

function assertScheduleProtocolValue(assertion: () => void, label: string): void {
  try {
    assertion();
  } catch (error) {
    throw new PersistenceUtilityProtocolError(`${label} is invalid`, { cause: error });
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

function assertBoundedLimit(value: unknown, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new PersistenceUtilityProtocolError(`${label} is invalid`);
  }
}

function assertApprovalIdentityPayload(
  payload: unknown,
  operation: string,
  includeNow: boolean,
): asserts payload is Record<string, unknown> {
  assertRecord(payload, `${operation} request`);
  assertExactKeys(
    payload,
    includeNow ? ["decisionId", "now"] : ["decisionId"],
    `${operation} request`,
  );
  assertAionUiIdentifier(payload.decisionId, `${operation} decisionId`);
  if (includeNow) {
    assertCanonicalInstant(payload.now, `${operation} now`);
  }
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
    case "summarize-aionui-shadow-evidence":
    case "summarize-aionui-approval-authority":
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
      assertBoundedLimit(payload.limit, 50, "list-agent-attempt-evidence limit");
      return;
    case "append-aionui-shadow-evidence":
      assertRecord(payload, "append-aionui-shadow-evidence request");
      assertExactKeys(payload, ["evidence"], "append-aionui-shadow-evidence request");
      assertAionUiShadowEvidence(payload.evidence);
      return;
    case "list-aionui-shadow-evidence":
      assertRecord(payload, "list-aionui-shadow-evidence request");
      assertExactKeys(payload, ["limit"], "list-aionui-shadow-evidence request");
      assertBoundedLimit(payload.limit, 50, "list-aionui-shadow-evidence limit");
      return;
    case "reserve-aionui-approval-decision":
      assertRecord(payload, "reserve-aionui-approval-decision request");
      assertExactKeys(payload, ["decision", "now"], "reserve-aionui-approval-decision request");
      assertNormalizedAionUiApprovalDecision(payload.decision);
      assertCanonicalInstant(payload.now, "reserve-aionui-approval-decision now");
      return;
    case "begin-aionui-approval-delivery":
    case "mark-aionui-approval-delivered":
      assertApprovalIdentityPayload(payload, request.operation, true);
      return;
    case "mark-aionui-approval-delivery-failed":
      assertRecord(payload, "mark-aionui-approval-delivery-failed request");
      assertExactKeys(
        payload,
        ["decisionId", "errorCode", "now"],
        "mark-aionui-approval-delivery-failed request",
      );
      assertAionUiIdentifier(payload.decisionId, "mark-aionui-approval-delivery-failed decisionId");
      if (
        typeof payload.errorCode !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(payload.errorCode)
      ) {
        throw new PersistenceUtilityProtocolError(
          "mark-aionui-approval-delivery-failed errorCode is invalid",
        );
      }
      assertCanonicalInstant(payload.now, "mark-aionui-approval-delivery-failed now");
      return;
    case "get-aionui-approval-decision":
      assertApprovalIdentityPayload(payload, request.operation, false);
      return;
    case "list-pending-aionui-approval-decisions":
      assertRecord(payload, "list-pending-aionui-approval-decisions request");
      assertExactKeys(payload, ["limit"], "list-pending-aionui-approval-decisions request");
      try {
        assertAionUiApprovalAuthorityLimit(payload.limit as number);
      } catch {
        throw new PersistenceUtilityProtocolError(
          "list-pending-aionui-approval-decisions limit is invalid",
        );
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
    case "persist-general-work-checkpoint":
      assertRecord(payload, "persist-general-work-checkpoint request");
      assertExactKeys(payload, ["checkpoint"], "persist-general-work-checkpoint request");
      assertGeneralWorkCheckpoint(payload.checkpoint);
      return;
    case "get-general-work-checkpoint":
      assertRecord(payload, "get-general-work-checkpoint request");
      assertExactKeys(payload, ["sessionId"], "get-general-work-checkpoint request");
      if (typeof payload.sessionId !== "string") {
        throw new PersistenceUtilityProtocolError(
          "get-general-work-checkpoint sessionId is invalid",
        );
      }
      sessionId(payload.sessionId);
      return;
    case "list-recoverable-general-work-checkpoints":
      assertRecord(payload, "list-recoverable-general-work-checkpoints request");
      assertExactKeys(payload, ["limit"], "list-recoverable-general-work-checkpoints request");
      assertBoundedLimit(payload.limit, 100, "list-recoverable-general-work-checkpoints limit");
      return;
    case "persist-admitted-team-plan":
      assertRecord(payload, "persist-admitted-team-plan request");
      assertExactKeys(payload, ["plan"], "persist-admitted-team-plan request");
      assertAdmittedTeamPlan(payload.plan);
      return;
    case "get-admitted-team-plan":
      assertRecord(payload, "get-admitted-team-plan request");
      assertExactKeys(payload, ["planId"], "get-admitted-team-plan request");
      if (typeof payload.planId !== "string") {
        throw new PersistenceUtilityProtocolError("get-admitted-team-plan planId is invalid");
      }
      teamPlanId(payload.planId);
      return;
    case "list-aionui-general-work-links":
      assertRecord(payload, "list-aionui-general-work-links request");
      assertExactKeys(
        payload,
        ["conversationHash", "limit"],
        "list-aionui-general-work-links request",
      );
      if (
        typeof payload.conversationHash !== "string" ||
        !/^[a-f0-9]{64}$/u.test(payload.conversationHash)
      ) {
        throw new PersistenceUtilityProtocolError(
          "list-aionui-general-work-links conversationHash is invalid",
        );
      }
      assertBoundedLimit(
        payload.limit,
        AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
        "list-aionui-general-work-links limit",
      );
      return;
    case "list-prepared-aionui-general-work-links":
      assertRecord(payload, "list-prepared-aionui-general-work-links request");
      assertExactKeys(payload, ["limit"], "list-prepared-aionui-general-work-links request");
      assertBoundedLimit(
        payload.limit,
        AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
        "list-prepared-aionui-general-work-links limit",
      );
      return;
    case "register-aionui-general-work":
      assertRecord(payload, "register-aionui-general-work request");
      assertExactKeys(payload, ["registration"], "register-aionui-general-work request");
      assertAionUiGeneralWorkRegistration(payload.registration);
      return;
    case "register-aionui-schedule":
      assertRecord(payload, "register-aionui-schedule request");
      assertExactKeys(payload, ["registration"], "register-aionui-schedule request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleRegistration(payload.registration),
        "register-aionui-schedule registration",
      );
      return;
    case "list-aionui-schedules":
      assertRecord(payload, "list-aionui-schedules request");
      assertExactKeys(payload, ["input"], "list-aionui-schedules request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleListInput(payload.input),
        "list-aionui-schedules input",
      );
      return;
    case "get-aionui-schedule":
      assertRecord(payload, "get-aionui-schedule request");
      assertExactKeys(payload, ["jobId"], "get-aionui-schedule request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleJobId(payload.jobId),
        "get-aionui-schedule jobId",
      );
      return;
    case "update-aionui-schedule":
      assertRecord(payload, "update-aionui-schedule request");
      assertExactKeys(payload, ["input"], "update-aionui-schedule request");
      assertScheduleProtocolValue(
        () => assertAionUiSchedulePersistenceUpdateInput(payload.input),
        "update-aionui-schedule input",
      );
      return;
    case "delete-aionui-schedule":
      assertRecord(payload, "delete-aionui-schedule request");
      assertExactKeys(payload, ["input"], "delete-aionui-schedule request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleDeleteInput(payload.input),
        "delete-aionui-schedule input",
      );
      return;
    case "claim-aionui-schedule-run":
      assertRecord(payload, "claim-aionui-schedule-run request");
      assertExactKeys(payload, ["input"], "claim-aionui-schedule-run request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleClaimInput(payload.input),
        "claim-aionui-schedule-run input",
      );
      return;
    case "complete-aionui-schedule-run":
      assertRecord(payload, "complete-aionui-schedule-run request");
      assertExactKeys(payload, ["input"], "complete-aionui-schedule-run request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleCompletionInput(payload.input),
        "complete-aionui-schedule-run input",
      );
      return;
    case "recover-aionui-schedule-runs":
      assertRecord(payload, "recover-aionui-schedule-runs request");
      assertExactKeys(payload, ["input"], "recover-aionui-schedule-runs request");
      assertScheduleProtocolValue(
        () => assertAionUiScheduleRecoveryInput(payload.input),
        "recover-aionui-schedule-runs input",
      );
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
      assertGaplessSummary(result, "Privileged audit summary");
      return;
    case "list-agent-attempt-evidence":
      if (!Array.isArray(result) || result.length > 50) {
        throw new PersistenceUtilityProtocolError("list-agent-attempt-evidence result is invalid");
      }
      result.forEach(assertAgentAttemptEvidence);
      return;
    case "append-aionui-shadow-evidence":
      assertShadowAppendResult(result);
      return;
    case "list-aionui-shadow-evidence":
      if (!Array.isArray(result) || result.length > 50) {
        throw new PersistenceUtilityProtocolError("list-aionui-shadow-evidence result is invalid");
      }
      result.forEach(assertStoredShadowEvidence);
      return;
    case "summarize-aionui-shadow-evidence":
      assertGaplessSummary(result, "AionUi shadow evidence summary");
      return;
    case "reserve-aionui-approval-decision":
      assertApprovalReserveResult(result);
      return;
    case "begin-aionui-approval-delivery":
    case "mark-aionui-approval-delivered":
    case "mark-aionui-approval-delivery-failed":
      assertAionUiApprovalDecisionRecord(result);
      return;
    case "get-aionui-approval-decision":
      if (result !== null) {
        assertAionUiApprovalDecisionRecord(result);
      }
      return;
    case "list-pending-aionui-approval-decisions":
      if (!Array.isArray(result) || result.length > AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT) {
        throw new PersistenceUtilityProtocolError(
          "list-pending-aionui-approval-decisions result is invalid",
        );
      }
      result.forEach(assertAionUiApprovalDecisionRecord);
      return;
    case "summarize-aionui-approval-authority":
      assertApprovalSummary(result);
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
    case "persist-general-work-checkpoint":
      assertRecord(result, "persist-general-work-checkpoint result");
      assertExactKeys(result, ["status", "checkpoint"], "persist-general-work-checkpoint result");
      if (
        result.status !== "stored" &&
        result.status !== "updated" &&
        result.status !== "duplicate"
      ) {
        throw new PersistenceUtilityProtocolError(
          "persist-general-work-checkpoint status is invalid",
        );
      }
      assertGeneralWorkCheckpoint(result.checkpoint);
      return;
    case "get-general-work-checkpoint":
      if (result !== null) {
        assertGeneralWorkCheckpoint(result);
      }
      return;
    case "list-recoverable-general-work-checkpoints":
      if (!Array.isArray(result) || result.length > 100) {
        throw new PersistenceUtilityProtocolError(
          "list-recoverable-general-work-checkpoints result is invalid",
        );
      }
      result.forEach(assertGeneralWorkCheckpoint);
      return;
    case "persist-admitted-team-plan":
      assertPersistAdmittedTeamPlanResult(result);
      return;
    case "get-admitted-team-plan":
      if (result !== null) {
        assertAdmittedTeamPlan(result);
      }
      return;
    case "list-aionui-general-work-links":
      if (
        !Array.isArray(result) ||
        result.length > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
      ) {
        throw new PersistenceUtilityProtocolError(
          "list-aionui-general-work-links result is invalid",
        );
      }
      result.forEach(assertAionUiGeneralWorkLink);
      return;
    case "list-prepared-aionui-general-work-links":
      if (
        !Array.isArray(result) ||
        result.length > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
      ) {
        throw new PersistenceUtilityProtocolError(
          "list-prepared-aionui-general-work-links result is invalid",
        );
      }
      result.forEach(assertAionUiGeneralWorkLink);
      return;
    case "register-aionui-general-work":
      assertAionUiGeneralWorkRegistrationResult(result);
      return;
    case "register-aionui-schedule":
      assertScheduleProtocolValue(
        () => assertAionUiScheduleRegistrationResult(result),
        "register-aionui-schedule result",
      );
      return;
    case "list-aionui-schedules":
    case "recover-aionui-schedule-runs":
      assertScheduleProtocolValue(() => assertAionUiScheduleJobList(result), `${operation} result`);
      return;
    case "get-aionui-schedule":
      if (result !== null) {
        assertScheduleProtocolValue(
          () => assertAionUiScheduleJob(result),
          "get-aionui-schedule result",
        );
      }
      return;
    case "update-aionui-schedule":
    case "delete-aionui-schedule":
      assertScheduleProtocolValue(
        () => assertAionUiScheduleMutationResult(result),
        `${operation} result`,
      );
      return;
    case "claim-aionui-schedule-run":
      assertScheduleProtocolValue(
        () => assertAionUiScheduleClaimResult(result),
        "claim-aionui-schedule-run result",
      );
      return;
    case "complete-aionui-schedule-run":
      assertScheduleProtocolValue(
        () => assertAionUiScheduleCompletionResult(result),
        "complete-aionui-schedule-run result",
      );
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
