import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import {
  assertAionUiApprovalAuthorityLimit,
  assertAionUiApprovalDecisionRecord,
  AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
  assertAionUiGeneralWorkLink,
  assertAionUiGeneralWorkRegistration,
  AIONUI_SCHEDULE_MAX_JOBS,
  AionUiScheduledGeneralWorkError,
  assertAionUiScheduleClaimInput,
  assertAionUiScheduleCompletionInput,
  assertAionUiScheduleDeleteInput,
  assertAionUiScheduleJob,
  assertAionUiScheduleJobId,
  assertAionUiScheduleListInput,
  assertAionUiSchedulePersistenceUpdateInput,
  assertAionUiScheduleRecoveryInput,
  assertAionUiScheduleRegistration,
  assertAionUiShadowEvidence,
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
  type AionUiGeneralWorkLink,
  type AionUiGeneralWorkRegistration,
  type AionUiApprovalAuthoritySummary,
  type AionUiApprovalDecisionRecord,
  type AionUiShadowEvidence,
  type AionUiShadowEvidenceSummary,
  type AppendAionUiShadowEvidenceResult,
  type NormalizedAionUiApprovalDecision,
  type ReserveAionUiApprovalDecisionResult,
  type RegisterAionUiGeneralWorkJourneyResult,
  type StoredAionUiShadowEvidence,
} from "../../compatibility/aionui";
import {
  CoreContractError,
  MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS,
  PersistenceError,
  WorkloadContentError,
  advanceCoreEventStreamState,
  approvalId,
  artifactId,
  assertAgentAttemptEvidence,
  assertAppendPrivilegedAuditInput,
  assertAuditRecord,
  assertContentReferenceMetadata,
  assertCoreEvent,
  assertDomainGraph,
  assertGeneralWorkCheckpoint,
  assertGeneralWorkCheckpointTransition,
  assertIdempotentCoreEventDelivery,
  assertResolveContentReferenceInput,
  assertStoreContentReferenceInput,
  assertWorkspaceGrant,
  auditRecordId,
  compareInstants,
  createCoreEventStreamState,
  eventStreamId,
  instant,
  replayCoreEvents,
  sessionId,
  taskId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workloadContentByteLength,
  workspaceGrantId,
  workspaceId,
  type ActestraPersistencePort,
  type ApprovalState,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type AuditRecord,
  type ArtifactKind,
  type ArtifactState,
  type ContentReferenceKind,
  type ContentReferenceMetadata,
  type ContentReferenceOwner,
  type CoreEvent,
  type CoreEventCursor,
  type CoreEventStreamState,
  type DomainGraph,
  type EventStreamId,
  type GeneralWorkCheckpoint,
  type PersistGeneralWorkCheckpointResult,
  type PersistContentReferenceResult,
  type PersistEvidenceResult,
  type PersistEventResult,
  type PersistWorkspaceGrantResult,
  type PrivilegedAuditSummary,
  type ResolveContentReferenceInput,
  type ResolvedContentReference,
  type SessionState,
  type StoreContentReferenceInput,
  type TaskState,
  type WorkerState,
  type WorkspaceGrant,
  type WorkspaceState,
} from "../../core";
import { migrateSqliteDatabase } from "./sqliteMigrations";

export const CORE_DATABASE_FILENAME = "actestra.sqlite3";
const STATE_DIRECTORY = "state";
const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const CORE_EVENT_COLUMNS = `
  event_id, stream_id, sequence, occurred_at, workspace_id, task_id,
  session_id, worker_id, type, redaction, envelope_json
`;
const PRIVILEGED_AUDIT_COLUMNS = `
  sequence, record_id, occurred_at, request_id, workspace_id, task_id,
  session_id, worker_id, tool_id, action, resource_kind, event_type,
  redaction, record_json
`;
const AGENT_ATTEMPT_EVIDENCE_COLUMNS = `
  sequence, session_id, workspace_id, task_id, worker_id, stream_id, state,
  last_core_event_sequence, incident_code, redaction, evidence_json
`;
const AIONUI_SHADOW_EVIDENCE_COLUMNS = `
  sequence, evidence_id, captured_at, source, domain, native_identity_hash,
  native_revision_hash, redaction, evidence_json
`;
const AIONUI_APPROVAL_DECISION_COLUMNS = `
  decision_id, native_conversation_id, native_call_id, native_message_id,
  native_path, request_hash, decision, always_allow, delivery_state,
  attempt_count, created_at, updated_at, last_attempt_at, delivered_at,
  last_error_code, delivery_body_json, record_json
`;
const WORKSPACE_GRANT_COLUMNS = `
  grant_id, contract_version, workspace_id, root_path, display_name, state,
  created_at, updated_at, grant_json
`;
const CONTENT_REFERENCE_COLUMNS = `
  reference, contract_version, kind, workspace_id, task_id, session_id,
  worker_id, request_id, grant_id, classification, media_type, byte_length,
  sha256, created_at, expires_at, consumed_at, metadata_json, content_blob
`;
const GENERAL_WORK_CHECKPOINT_COLUMNS = `
  session_id, contract_version, phase, revision, workspace_id, task_id,
  worker_id, stream_id, created_at, updated_at, checkpoint_json
`;
const AIONUI_GENERAL_WORK_JOURNEY_COLUMNS = `
  task_id, contract_version, conversation_hash, journey_kind, created_at
`;
const AIONUI_SCHEDULE_JOB_COLUMNS = `
  job_id, contract_version, conversation_hash, native_conversation_id,
  native_conversation_title, workspace_id, workspace_grant_id, name,
  description, prompt, schedule_kind, schedule_value, schedule_time_zone,
  schedule_description, enabled, next_run_at_ms, last_run_at_ms, last_status,
  last_incident_code, active_claim, active_claimed_at_ms, run_sequence,
  run_count, retry_count, max_retries, queue_enabled, created_at_ms,
  updated_at_ms, deleted_at_ms, job_json
`;

type SqliteRow = Record<string, unknown>;

function requiredString(row: SqliteRow, field: string): string {
  const value = row[field];

  if (typeof value !== "string") {
    throw new PersistenceError(
      "corrupt-database",
      `Actestra database field ${field} must be a string`,
    );
  }

  return value;
}

function optionalString(row: SqliteRow, field: string): string | undefined {
  const value = row[field];

  if (value === null) {
    return undefined;
  }

  return requiredString(row, field);
}

function requiredNumber(row: SqliteRow, field: string): number {
  const value = row[field];

  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PersistenceError(
      "corrupt-database",
      `Actestra database field ${field} must be a safe integer`,
    );
  }

  return value;
}

function optionalNumber(row: SqliteRow, field: string): number | undefined {
  const value = row[field];
  if (value === null) {
    return undefined;
  }
  return requiredNumber(row, field);
}

function requiredBlob(row: SqliteRow, field: string): Uint8Array {
  const value = row[field];
  if (!(value instanceof Uint8Array)) {
    throw new PersistenceError(
      "corrupt-database",
      `Actestra database field ${field} must be a byte array`,
    );
  }
  return value;
}

function asRows(rows: readonly unknown[]): readonly SqliteRow[] {
  return rows.map((row) => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new PersistenceError("corrupt-database", "Actestra database returned an invalid row");
    }

    return row as SqliteRow;
  });
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function assertPrivateDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, {
    recursive: true,
    mode: 0o700,
  });
  const state = fs.lstatSync(directoryPath);

  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new PersistenceError(
      "corrupt-database",
      "Actestra persistence state path must be a real directory",
    );
  }

  fs.chmodSync(directoryPath, 0o700);
}

function assertDatabaseFile(databasePath: string): void {
  const state = fs.lstatSync(databasePath);

  if (!state.isFile() || state.isSymbolicLink()) {
    throw new PersistenceError("corrupt-database", "Actestra database path must be a regular file");
  }

  fs.chmodSync(databasePath, 0o600);
}

function configureDatabase(database: DatabaseSync): void {
  database.enableLoadExtension(false);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
  `);

  const journal = database.prepare("PRAGMA journal_mode = DELETE").get() as SqliteRow | undefined;
  if (journal === undefined || Object.values(journal)[0] !== "delete") {
    throw new PersistenceError(
      "corrupt-database",
      "Actestra database could not enter DELETE journal mode",
    );
  }
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // Preserve the original transaction error.
  }
}

function parseStoredEvent(row: SqliteRow): CoreEvent {
  const encoded = requiredString(row, "envelope_json");
  let value: unknown;

  try {
    value = JSON.parse(encoded);
  } catch (error) {
    throw new PersistenceError("corrupt-database", "A persisted core event is not valid JSON", {
      cause: error,
    });
  }

  try {
    assertCoreEvent(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "A persisted core event violates the core event contract",
      {
        cause: error,
      },
    );
  }

  if (
    requiredString(row, "event_id") !== value.eventId ||
    requiredString(row, "stream_id") !== value.streamId ||
    requiredNumber(row, "sequence") !== value.sequence ||
    requiredString(row, "occurred_at") !== value.occurredAt ||
    requiredString(row, "workspace_id") !== value.workspaceId ||
    requiredString(row, "task_id") !== value.taskId ||
    requiredString(row, "session_id") !== value.sessionId ||
    requiredString(row, "worker_id") !== value.workerId ||
    requiredString(row, "type") !== value.type ||
    requiredString(row, "redaction") !== value.redaction
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "A persisted core event projection does not match its canonical envelope",
    );
  }

  return value;
}

function parseStoredAuditRecord(row: SqliteRow): AuditRecord {
  const encoded = requiredString(row, "record_json");
  let value: unknown;

  try {
    value = JSON.parse(encoded);
    assertAuditRecord(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "A persisted privileged audit record violates its contract",
      {
        cause: error,
      },
    );
  }

  if (
    requiredNumber(row, "sequence") !== value.sequence ||
    requiredString(row, "record_id") !== value.recordId ||
    requiredString(row, "occurred_at") !== value.occurredAt ||
    requiredString(row, "request_id") !== value.event.context.requestId ||
    requiredString(row, "workspace_id") !== value.event.context.workspaceId ||
    requiredString(row, "task_id") !== value.event.context.taskId ||
    requiredString(row, "session_id") !== value.event.context.sessionId ||
    requiredString(row, "worker_id") !== value.event.context.workerId ||
    requiredString(row, "tool_id") !== value.event.context.toolId ||
    requiredString(row, "action") !== value.event.context.action ||
    requiredString(row, "resource_kind") !== value.event.context.resourceKind ||
    requiredString(row, "event_type") !== value.event.type ||
    requiredString(row, "redaction") !== value.redaction
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "A persisted privileged audit projection does not match its canonical record",
    );
  }

  return deepFreeze(value);
}

function parseStoredAgentAttemptEvidence(row: SqliteRow): AgentAttemptEvidence {
  const encoded = requiredString(row, "evidence_json");
  let value: unknown;

  try {
    value = JSON.parse(encoded);
    assertAgentAttemptEvidence(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted agent attempt evidence violates its contract",
      {
        cause: error,
      },
    );
  }

  const incidentCode = optionalString(row, "incident_code");
  if (
    requiredString(row, "session_id") !== value.sessionId ||
    requiredString(row, "workspace_id") !== value.workspaceId ||
    requiredString(row, "task_id") !== value.taskId ||
    requiredString(row, "worker_id") !== value.workerId ||
    requiredString(row, "stream_id") !== value.streamId ||
    requiredString(row, "state") !== value.state ||
    requiredNumber(row, "last_core_event_sequence") !== value.lastCoreEventSequence ||
    incidentCode !== value.incident?.code ||
    requiredString(row, "redaction") !== value.redaction
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted agent attempt projection does not match its canonical evidence",
    );
  }

  return deepFreeze(value);
}

function parseStoredGeneralWorkCheckpoint(row: SqliteRow): GeneralWorkCheckpoint {
  const encoded = requiredString(row, "checkpoint_json");
  let value: unknown;

  try {
    value = JSON.parse(encoded);
    assertGeneralWorkCheckpoint(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted general-work checkpoint violates its contract",
      { cause: error },
    );
  }

  if (
    requiredString(row, "session_id") !== value.attempt.sessionId ||
    requiredNumber(row, "contract_version") !== value.contractVersion ||
    requiredString(row, "phase") !== value.phase ||
    requiredNumber(row, "revision") !== value.revision ||
    requiredString(row, "workspace_id") !== value.attempt.workspaceId ||
    requiredString(row, "task_id") !== value.attempt.taskId ||
    requiredString(row, "worker_id") !== value.attempt.workerId ||
    requiredString(row, "stream_id") !== value.attempt.streamId ||
    requiredString(row, "created_at") !== value.createdAt ||
    requiredString(row, "updated_at") !== value.updatedAt
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted general-work checkpoint projection does not match its canonical record",
    );
  }

  return deepFreeze(value);
}

function parseStoredAionUiGeneralWorkLink(row: SqliteRow): AionUiGeneralWorkLink {
  const value: unknown = {
    contractVersion: requiredNumber(row, "contract_version"),
    conversationHash: requiredString(row, "conversation_hash"),
    taskId: requiredString(row, "task_id"),
    journeyKind: requiredString(row, "journey_kind"),
    createdAt: requiredString(row, "created_at"),
  };
  try {
    assertAionUiGeneralWorkLink(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUI general-work link violates its contract",
      { cause: error },
    );
  }
  return deepFreeze(value);
}

function parseStoredAionUiShadowEvidence(row: SqliteRow): StoredAionUiShadowEvidence {
  const encoded = requiredString(row, "evidence_json");
  let value: unknown;

  try {
    value = JSON.parse(encoded);
    assertAionUiShadowEvidence(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUi shadow evidence violates its contract",
      {
        cause: error,
      },
    );
  }

  const sequence = requiredNumber(row, "sequence");
  if (
    requiredString(row, "evidence_id") !== value.evidenceId ||
    requiredString(row, "captured_at") !== value.capturedAt ||
    requiredString(row, "source") !== value.source ||
    requiredString(row, "domain") !== value.domain ||
    requiredString(row, "native_identity_hash") !== value.nativeIdentityHash ||
    requiredString(row, "native_revision_hash") !== value.nativeRevisionHash ||
    requiredString(row, "redaction") !== value.redaction
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUi shadow projection does not match its canonical evidence",
    );
  }

  return deepFreeze({
    sequence,
    evidence: value,
  });
}

const AIONUI_CAPTURE_TIME_FIELDS = new Set([
  "capturedAt",
  "createdAt",
  "occurredAt",
  "requestedAt",
  "resolvedAt",
  "updatedAt",
]);

function withoutAionUiCaptureTimes(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutAionUiCaptureTimes);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !AIONUI_CAPTURE_TIME_FIELDS.has(key))
      .map(([key, child]) => [key, withoutAionUiCaptureTimes(child)]),
  );
}

function isSameAionUiShadowRevision(
  left: AionUiShadowEvidence,
  right: AionUiShadowEvidence,
): boolean {
  return isDeepStrictEqual(withoutAionUiCaptureTimes(left), withoutAionUiCaptureTimes(right));
}

function parseStoredAionUiApprovalDecision(row: SqliteRow): AionUiApprovalDecisionRecord {
  const encoded = requiredString(row, "record_json");
  let value: unknown;

  try {
    value = JSON.parse(encoded);
    assertAionUiApprovalDecisionRecord(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUi approval authority record violates its contract",
      {
        cause: error,
      },
    );
  }

  const deliveryBody = requiredString(row, "delivery_body_json");
  let parsedDeliveryBody: unknown;
  try {
    parsedDeliveryBody = JSON.parse(deliveryBody);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUi approval delivery body is not valid JSON",
      {
        cause: error,
      },
    );
  }

  if (
    requiredString(row, "decision_id") !== value.decisionId ||
    requiredString(row, "native_conversation_id") !== value.nativeConversationId ||
    requiredString(row, "native_call_id") !== value.nativeCallId ||
    requiredString(row, "native_message_id") !== value.nativeMessageId ||
    requiredString(row, "native_path") !== value.nativePath ||
    requiredString(row, "request_hash") !== value.requestHash ||
    requiredString(row, "decision") !== value.decision ||
    requiredNumber(row, "always_allow") !== (value.alwaysAllow ? 1 : 0) ||
    requiredString(row, "delivery_state") !== value.deliveryState ||
    requiredNumber(row, "attempt_count") !== value.attemptCount ||
    requiredString(row, "created_at") !== value.createdAt ||
    requiredString(row, "updated_at") !== value.updatedAt ||
    optionalString(row, "last_attempt_at") !== value.lastAttemptAt ||
    optionalString(row, "delivered_at") !== value.deliveredAt ||
    optionalString(row, "last_error_code") !== value.lastErrorCode ||
    !isDeepStrictEqual(parsedDeliveryBody, value.deliveryBody)
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUi approval projection does not match its canonical record",
    );
  }

  return deepFreeze(value);
}

function approvalDecisionMatches(
  record: AionUiApprovalDecisionRecord,
  decision: NormalizedAionUiApprovalDecision,
): boolean {
  return (
    record.contractVersion === decision.contractVersion &&
    record.decisionId === decision.decisionId &&
    record.nativeConversationId === decision.nativeConversationId &&
    record.nativeCallId === decision.nativeCallId &&
    record.nativeMessageId === decision.nativeMessageId &&
    record.nativePath === decision.nativePath &&
    record.requestHash === decision.requestHash &&
    record.decision === decision.decision &&
    record.alwaysAllow === decision.alwaysAllow &&
    isDeepStrictEqual(record.deliveryBody, decision.deliveryBody)
  );
}

function validatedApprovalRecord(value: unknown): AionUiApprovalDecisionRecord {
  try {
    assertAionUiApprovalDecisionRecord(value);
  } catch (error) {
    throw new PersistenceError("invalid-record", "AionUi approval authority update is invalid", {
      cause: error,
    });
  }
  return deepFreeze(value);
}

function monotonicApprovalUpdateTime(
  existing: AionUiApprovalDecisionRecord,
  now: string,
): ReturnType<typeof instant> {
  let updateTime: ReturnType<typeof instant>;
  try {
    updateTime = instant(now);
  } catch (error) {
    throw new PersistenceError("invalid-record", "AionUi approval update time is invalid", {
      cause: error,
    });
  }
  if (compareInstants(updateTime, instant(existing.updatedAt)) < 0) {
    throw new PersistenceError(
      "invalid-record",
      "AionUi approval update time cannot move backwards",
    );
  }
  return updateTime;
}

function loadApprovalDecision(
  database: DatabaseSync,
  decisionId: string,
): AionUiApprovalDecisionRecord | undefined {
  const row = database
    .prepare(
      `SELECT ${AIONUI_APPROVAL_DECISION_COLUMNS}
       FROM aionui_approval_decisions
       WHERE decision_id = ?`,
    )
    .get(decisionId) as SqliteRow | undefined;
  return row === undefined ? undefined : parseStoredAionUiApprovalDecision(row);
}

function updateApprovalDecision(
  database: DatabaseSync,
  record: AionUiApprovalDecisionRecord,
): void {
  database
    .prepare(
      `UPDATE aionui_approval_decisions
       SET delivery_state = ?,
           attempt_count = ?,
           updated_at = ?,
           last_attempt_at = ?,
           delivered_at = ?,
           last_error_code = ?,
           record_json = ?
       WHERE decision_id = ?`,
    )
    .run(
      record.deliveryState,
      record.attemptCount,
      record.updatedAt,
      record.lastAttemptAt ?? null,
      record.deliveredAt ?? null,
      record.lastErrorCode ?? null,
      JSON.stringify(record),
      record.decisionId,
    );
}

function parseStoredWorkspaceGrant(row: SqliteRow): WorkspaceGrant {
  const encoded = requiredString(row, "grant_json");
  let value: unknown;
  try {
    value = JSON.parse(encoded);
    assertWorkspaceGrant(value);
  } catch (error) {
    throw new PersistenceError("corrupt-database", "Persisted workspace grant is invalid", {
      cause: error,
    });
  }

  if (
    requiredString(row, "grant_id") !== value.grantId ||
    requiredNumber(row, "contract_version") !== value.contractVersion ||
    requiredString(row, "workspace_id") !== value.workspaceId ||
    requiredString(row, "root_path") !== value.rootPath ||
    requiredString(row, "display_name") !== value.displayName ||
    requiredString(row, "state") !== value.state ||
    requiredString(row, "created_at") !== value.createdAt ||
    requiredString(row, "updated_at") !== value.updatedAt
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted workspace grant projection does not match its canonical record",
    );
  }

  return deepFreeze(value);
}

function contentReferenceForKind(value: string, kind: ContentReferenceKind) {
  return kind === "tool-input" ? toolInputReference(value) : toolOutputReference(value);
}

function ownerFromContentRow(row: SqliteRow): ContentReferenceOwner {
  const requestIdValue = optionalString(row, "request_id");
  const grantIdValue = optionalString(row, "grant_id");
  return {
    workspaceId: workspaceId(requiredString(row, "workspace_id")),
    taskId: taskId(requiredString(row, "task_id")),
    sessionId: sessionId(requiredString(row, "session_id")),
    workerId: workerId(requiredString(row, "worker_id")),
    ...(requestIdValue === undefined ? {} : { requestId: toolRequestId(requestIdValue) }),
    ...(grantIdValue === undefined ? {} : { grantId: workspaceGrantId(grantIdValue) }),
  };
}

function parseStoredContentMetadata(row: SqliteRow): ContentReferenceMetadata {
  const encoded = requiredString(row, "metadata_json");
  let value: unknown;
  try {
    value = JSON.parse(encoded);
    assertContentReferenceMetadata(value);
  } catch (error) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted content reference metadata is invalid",
      {
        cause: error,
      },
    );
  }

  const kind = requiredString(row, "kind") as ContentReferenceKind;
  const owner = ownerFromContentRow(row);
  const expiresAt = optionalString(row, "expires_at");
  const consumedAt = optionalString(row, "consumed_at");
  if (
    requiredString(row, "reference") !== value.reference ||
    requiredNumber(row, "contract_version") !== value.contractVersion ||
    kind !== value.kind ||
    !isDeepStrictEqual(owner, value.owner) ||
    requiredString(row, "classification") !== value.classification ||
    requiredString(row, "media_type") !== value.mediaType ||
    requiredNumber(row, "byte_length") !== value.byteLength ||
    requiredString(row, "sha256") !== value.sha256 ||
    requiredString(row, "created_at") !== value.createdAt ||
    expiresAt !== value.expiresAt ||
    consumedAt !== value.consumedAt
  ) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted content reference projection does not match its canonical metadata",
    );
  }

  contentReferenceForKind(value.reference, kind);
  return deepFreeze(value);
}

function decodeStoredContent(row: SqliteRow, metadata: ContentReferenceMetadata): string {
  const bytes = requiredBlob(row, "content_blob");
  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch (error) {
    throw new PersistenceError("content-integrity", "Stored content is not valid UTF-8", {
      cause: error,
    });
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.byteLength !== metadata.byteLength ||
    workloadContentByteLength(content) !== metadata.byteLength ||
    digest !== metadata.sha256
  ) {
    throw new PersistenceError(
      "content-integrity",
      "Stored content does not match its immutable metadata",
    );
  }
  return content;
}

function assertCanonicalWorkspaceRoot(rootPath: string): void {
  if (!path.isAbsolute(rootPath) || path.normalize(rootPath) !== rootPath) {
    throw new PersistenceError(
      "invalid-record",
      "Workspace grant root must be an absolute normalized path",
    );
  }

  try {
    const state = fs.lstatSync(rootPath);
    if (!state.isDirectory() || state.isSymbolicLink() || fs.realpathSync(rootPath) !== rootPath) {
      throw new PersistenceError(
        "invalid-record",
        "Workspace grant root must be a canonical real directory",
      );
    }
  } catch (error) {
    if (error instanceof PersistenceError) {
      throw error;
    }
    throw new PersistenceError(
      "invalid-record",
      "Workspace grant root must be an accessible canonical directory",
      {
        cause: error,
      },
    );
  }
}

function normalizeWorkloadContractError(error: unknown, label: string): PersistenceError {
  if (error instanceof WorkloadContentError) {
    return new PersistenceError(
      error.code === "content-too-large" ? "content-too-large" : "invalid-record",
      `${label} is invalid`,
      {
        cause: error,
      },
    );
  }
  if (error instanceof PersistenceError) {
    return error;
  }
  return new PersistenceError("invalid-record", `${label} is invalid`, {
    cause: error,
  });
}

function immutableContentMetadata(metadata: ContentReferenceMetadata): object {
  return {
    contractVersion: metadata.contractVersion,
    reference: metadata.reference,
    kind: metadata.kind,
    owner: metadata.owner,
    classification: metadata.classification,
    mediaType: metadata.mediaType,
    byteLength: metadata.byteLength,
    sha256: metadata.sha256,
    createdAt: metadata.createdAt,
    ...(metadata.expiresAt === undefined ? {} : { expiresAt: metadata.expiresAt }),
  };
}

function contentRecord(input: StoreContentReferenceInput): {
  readonly bytes: Buffer;
  readonly metadata: ContentReferenceMetadata;
} {
  const bytes = Buffer.from(input.content, "utf8");
  const metadata = deepFreeze({
    contractVersion: input.contractVersion,
    reference: input.reference,
    kind: input.kind,
    owner: structuredClone(input.owner),
    classification: input.classification,
    mediaType: input.mediaType,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    createdAt: input.createdAt,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  } satisfies ContentReferenceMetadata);
  assertContentReferenceMetadata(metadata);
  return { bytes, metadata };
}

function storedContentMatches(
  row: SqliteRow | undefined,
  input: StoreContentReferenceInput,
): boolean {
  if (row === undefined) {
    return false;
  }
  const expected = contentRecord(input);
  const actual = parseStoredContentMetadata(row);
  return (
    isDeepStrictEqual(
      immutableContentMetadata(actual),
      immutableContentMetadata(expected.metadata),
    ) && decodeStoredContent(row, actual) === input.content
  );
}

function normalizeScheduleContractError(error: unknown, label: string): PersistenceError {
  if (error instanceof PersistenceError) {
    return error;
  }
  if (error instanceof AionUiScheduledGeneralWorkError) {
    return new PersistenceError("invalid-record", `${label} is invalid`, { cause: error });
  }
  return new PersistenceError("invalid-record", `${label} is invalid`, { cause: error });
}

function normalizedScheduleJob(value: unknown): AionUiScheduleJob {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  assertAionUiScheduleJob(normalized);
  return deepFreeze(normalized);
}

function scheduleValue(job: AionUiScheduleJob): string {
  if (job.schedule.kind === "at") {
    return String(job.schedule.atMs);
  }
  if (job.schedule.kind === "every") {
    return String(job.schedule.everyMs);
  }
  return job.schedule.expr;
}

function scheduleTimeZone(job: AionUiScheduleJob): string | undefined {
  return job.schedule.kind === "cron" ? job.schedule.tz : undefined;
}

function parseStoredAionUiScheduleJob(row: SqliteRow): AionUiScheduleJob {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredString(row, "job_json"));
    assertAionUiScheduleJob(parsed);
  } catch (error) {
    throw new PersistenceError("corrupt-database", "Persisted AionUI schedule job is invalid", {
      cause: error,
    });
  }

  const job = parsed;
  const materializedMatches =
    requiredString(row, "job_id") === job.id &&
    requiredNumber(row, "contract_version") === job.contractVersion &&
    requiredString(row, "conversation_hash") === job.conversationHash &&
    requiredString(row, "native_conversation_id") === job.nativeConversationId &&
    optionalString(row, "native_conversation_title") === job.nativeConversationTitle &&
    requiredString(row, "workspace_id") === job.workspaceId &&
    requiredString(row, "workspace_grant_id") === job.workspaceGrantId &&
    requiredString(row, "name") === job.name &&
    optionalString(row, "description") === job.description &&
    requiredString(row, "prompt") === job.prompt &&
    requiredString(row, "schedule_kind") === job.schedule.kind &&
    requiredString(row, "schedule_value") === scheduleValue(job) &&
    optionalString(row, "schedule_time_zone") === scheduleTimeZone(job) &&
    requiredString(row, "schedule_description") === job.schedule.description &&
    requiredNumber(row, "enabled") === Number(job.enabled) &&
    optionalNumber(row, "next_run_at_ms") === job.nextRunAtMs &&
    optionalNumber(row, "last_run_at_ms") === job.lastRunAtMs &&
    optionalString(row, "last_status") === job.lastStatus &&
    optionalString(row, "last_incident_code") === job.lastIncidentCode &&
    optionalString(row, "active_claim") === job.activeClaim &&
    optionalNumber(row, "active_claimed_at_ms") === job.activeClaimedAtMs &&
    requiredNumber(row, "run_sequence") === job.runSequence &&
    requiredNumber(row, "run_count") === job.runCount &&
    requiredNumber(row, "retry_count") === job.retryCount &&
    requiredNumber(row, "max_retries") === job.maxRetries &&
    requiredNumber(row, "queue_enabled") === Number(job.queueEnabled) &&
    requiredNumber(row, "created_at_ms") === job.createdAtMs &&
    requiredNumber(row, "updated_at_ms") === job.updatedAtMs &&
    optionalNumber(row, "deleted_at_ms") === job.deletedAtMs;
  if (!materializedMatches) {
    throw new PersistenceError(
      "corrupt-database",
      "Persisted AionUI schedule columns disagree with the authoritative job",
    );
  }
  return deepFreeze(job);
}

function insertAionUiScheduleJob(database: DatabaseSync, job: AionUiScheduleJob): void {
  database
    .prepare(
      `INSERT INTO aionui_schedule_jobs (
         ${AIONUI_SCHEDULE_JOB_COLUMNS}
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       )`,
    )
    .run(
      job.id,
      job.contractVersion,
      job.conversationHash,
      job.nativeConversationId,
      job.nativeConversationTitle ?? null,
      job.workspaceId,
      job.workspaceGrantId,
      job.name,
      job.description ?? null,
      job.prompt,
      job.schedule.kind,
      scheduleValue(job),
      scheduleTimeZone(job) ?? null,
      job.schedule.description,
      Number(job.enabled),
      job.nextRunAtMs ?? null,
      job.lastRunAtMs ?? null,
      job.lastStatus ?? null,
      job.lastIncidentCode ?? null,
      job.activeClaim ?? null,
      job.activeClaimedAtMs ?? null,
      job.runSequence,
      job.runCount,
      job.retryCount,
      job.maxRetries,
      Number(job.queueEnabled),
      job.createdAtMs,
      job.updatedAtMs,
      job.deletedAtMs ?? null,
      JSON.stringify(job),
    );
}

function updateAionUiScheduleJob(
  database: DatabaseSync,
  job: AionUiScheduleJob,
  predicate = "",
  predicateValues: readonly (string | number | null)[] = [],
): number {
  const values: (string | number | null)[] = [
    job.nativeConversationTitle ?? null,
    job.name,
    job.description ?? null,
    job.prompt,
    job.schedule.kind,
    scheduleValue(job),
    scheduleTimeZone(job) ?? null,
    job.schedule.description,
    Number(job.enabled),
    job.nextRunAtMs ?? null,
    job.lastRunAtMs ?? null,
    job.lastStatus ?? null,
    job.lastIncidentCode ?? null,
    job.activeClaim ?? null,
    job.activeClaimedAtMs ?? null,
    job.runSequence,
    job.runCount,
    job.retryCount,
    job.maxRetries,
    Number(job.queueEnabled),
    job.createdAtMs,
    job.updatedAtMs,
    job.deletedAtMs ?? null,
    JSON.stringify(job),
    job.id,
    ...predicateValues,
  ];
  const result = database
    .prepare(
      `UPDATE aionui_schedule_jobs
       SET native_conversation_title = ?, name = ?, description = ?, prompt = ?,
           schedule_kind = ?, schedule_value = ?, schedule_time_zone = ?,
           schedule_description = ?, enabled = ?, next_run_at_ms = ?,
           last_run_at_ms = ?, last_status = ?, last_incident_code = ?,
           active_claim = ?, active_claimed_at_ms = ?, run_sequence = ?,
           run_count = ?, retry_count = ?, max_retries = ?, queue_enabled = ?,
           created_at_ms = ?, updated_at_ms = ?, deleted_at_ms = ?, job_json = ?
       WHERE job_id = ? ${predicate}`,
    )
    .run(...values);
  return Number(result.changes);
}

function loadAionUiScheduleJob(
  database: DatabaseSync,
  jobIdValue: string,
  includeDeleted = false,
): AionUiScheduleJob | undefined {
  const row = database
    .prepare(
      `SELECT ${AIONUI_SCHEDULE_JOB_COLUMNS}
       FROM aionui_schedule_jobs
       WHERE job_id = ? ${includeDeleted ? "" : "AND deleted_at_ms IS NULL"}`,
    )
    .get(jobIdValue) as SqliteRow | undefined;
  return row === undefined ? undefined : parseStoredAionUiScheduleJob(row);
}

function assertScheduleMutationTime(
  mutationTime: number,
  existing: AionUiScheduleJob,
  label: string,
): void {
  if (mutationTime < existing.updatedAtMs) {
    throw new PersistenceError("invalid-record", `${label} cannot predate schedule state`);
  }
}

function insertWorkspaceGrant(database: DatabaseSync, grant: WorkspaceGrant): void {
  database
    .prepare(
      `INSERT INTO workspace_grants (
         grant_id, contract_version, workspace_id, root_path, display_name,
         state, created_at, updated_at, grant_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      grant.grantId,
      grant.contractVersion,
      grant.workspaceId,
      grant.rootPath,
      grant.displayName,
      grant.state,
      grant.createdAt,
      grant.updatedAt,
      JSON.stringify(grant),
    );
}

function insertContentReference(
  database: DatabaseSync,
  input: StoreContentReferenceInput,
  record = contentRecord(input),
): void {
  const { bytes, metadata } = record;
  database
    .prepare(
      `INSERT INTO content_references (
         reference, contract_version, kind, workspace_id, task_id, session_id,
         worker_id, request_id, grant_id, classification, media_type,
         byte_length, sha256, created_at, expires_at, consumed_at,
         metadata_json, content_blob
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      metadata.reference,
      metadata.contractVersion,
      metadata.kind,
      metadata.owner.workspaceId,
      metadata.owner.taskId,
      metadata.owner.sessionId,
      metadata.owner.workerId,
      metadata.owner.requestId ?? null,
      metadata.owner.grantId ?? null,
      metadata.classification,
      metadata.mediaType,
      metadata.byteLength,
      metadata.sha256,
      metadata.createdAt,
      metadata.expiresAt ?? null,
      JSON.stringify(metadata),
      bytes,
    );
}

function verifyNoForeignKeyViolations(database: DatabaseSync): void {
  const violations = database.prepare("PRAGMA foreign_key_check").all();

  if (violations.length > 0) {
    throw new PersistenceError(
      "corrupt-database",
      `Actestra transaction introduced ${violations.length} foreign-key violation(s)`,
    );
  }
}

export function resolveCoreDatabasePath(userDataPath: string): string {
  return path.join(userDataPath, STATE_DIRECTORY, CORE_DATABASE_FILENAME);
}

class SqliteCorePersistence implements ActestraPersistencePort {
  private database: DatabaseSync | null;
  private readonly streamStates = new Map<EventStreamId, CoreEventStreamState>();

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  private requireDatabase(): DatabaseSync {
    if (this.database === null) {
      throw new PersistenceError("closed", "Actestra core persistence is closed");
    }

    return this.database;
  }

  private loadEventStream(database: DatabaseSync, streamId: EventStreamId): readonly CoreEvent[] {
    const rows = asRows(
      database
        .prepare(
          `SELECT ${CORE_EVENT_COLUMNS}
           FROM core_events
           WHERE stream_id = ?
           ORDER BY sequence`,
        )
        .all(streamId),
    );
    return rows.map(parseStoredEvent);
  }

  private loadEventStreamState(
    database: DatabaseSync,
    streamId: EventStreamId,
  ): CoreEventStreamState {
    const cached = this.streamStates.get(streamId);
    if (cached !== undefined) {
      return cached;
    }

    const state = createCoreEventStreamState(this.loadEventStream(database, streamId));
    this.streamStates.set(streamId, state);
    return state;
  }

  async loadDomainGraph(): Promise<DomainGraph> {
    const database = this.requireDatabase();
    const graph: DomainGraph = {
      workspaces: asRows(
        database
          .prepare(
            `SELECT id, name, state, created_at, updated_at
             FROM workspaces
             ORDER BY id`,
          )
          .all(),
      ).map((row) => ({
        id: workspaceId(requiredString(row, "id")),
        name: requiredString(row, "name"),
        state: requiredString(row, "state") as WorkspaceState,
        createdAt: instant(requiredString(row, "created_at")),
        updatedAt: instant(requiredString(row, "updated_at")),
      })),
      tasks: asRows(
        database
          .prepare(
            `SELECT id, workspace_id, title, state, active_session_id, created_at, updated_at
             FROM tasks
             ORDER BY id`,
          )
          .all(),
      ).map((row) => ({
        id: taskId(requiredString(row, "id")),
        workspaceId: workspaceId(requiredString(row, "workspace_id")),
        title: requiredString(row, "title"),
        state: requiredString(row, "state") as TaskState,
        activeSessionId:
          optionalString(row, "active_session_id") === undefined
            ? undefined
            : sessionId(requiredString(row, "active_session_id")),
        createdAt: instant(requiredString(row, "created_at")),
        updatedAt: instant(requiredString(row, "updated_at")),
      })),
      workers: asRows(
        database
          .prepare(
            `SELECT id, workspace_id, adapter_kind, state, created_at, updated_at
             FROM workers
             ORDER BY id`,
          )
          .all(),
      ).map((row) => ({
        id: workerId(requiredString(row, "id")),
        workspaceId: workspaceId(requiredString(row, "workspace_id")),
        adapterKind: requiredString(row, "adapter_kind"),
        state: requiredString(row, "state") as WorkerState,
        createdAt: instant(requiredString(row, "created_at")),
        updatedAt: instant(requiredString(row, "updated_at")),
      })),
      sessions: asRows(
        database
          .prepare(
            `SELECT id, workspace_id, task_id, worker_id, state, created_at, updated_at
             FROM sessions
             ORDER BY id`,
          )
          .all(),
      ).map((row) => ({
        id: sessionId(requiredString(row, "id")),
        workspaceId: workspaceId(requiredString(row, "workspace_id")),
        taskId: taskId(requiredString(row, "task_id")),
        workerId: workerId(requiredString(row, "worker_id")),
        state: requiredString(row, "state") as SessionState,
        createdAt: instant(requiredString(row, "created_at")),
        updatedAt: instant(requiredString(row, "updated_at")),
      })),
      approvals: asRows(
        database
          .prepare(
            `SELECT id, workspace_id, task_id, session_id, action, state,
                    requested_at, expires_at, resolved_at
             FROM approvals
             ORDER BY id`,
          )
          .all(),
      ).map((row) => ({
        id: approvalId(requiredString(row, "id")),
        workspaceId: workspaceId(requiredString(row, "workspace_id")),
        taskId: taskId(requiredString(row, "task_id")),
        sessionId: sessionId(requiredString(row, "session_id")),
        action: requiredString(row, "action"),
        state: requiredString(row, "state") as ApprovalState,
        requestedAt: instant(requiredString(row, "requested_at")),
        expiresAt:
          optionalString(row, "expires_at") === undefined
            ? undefined
            : instant(requiredString(row, "expires_at")),
        resolvedAt:
          optionalString(row, "resolved_at") === undefined
            ? undefined
            : instant(requiredString(row, "resolved_at")),
      })),
      artifacts: asRows(
        database
          .prepare(
            `SELECT id, workspace_id, task_id, session_id, kind, label, state,
                    created_at, updated_at
             FROM artifacts
             ORDER BY id`,
          )
          .all(),
      ).map((row) => ({
        id: artifactId(requiredString(row, "id")),
        workspaceId: workspaceId(requiredString(row, "workspace_id")),
        taskId: taskId(requiredString(row, "task_id")),
        sessionId:
          optionalString(row, "session_id") === undefined
            ? undefined
            : sessionId(requiredString(row, "session_id")),
        kind: requiredString(row, "kind") as ArtifactKind,
        label: requiredString(row, "label"),
        state: requiredString(row, "state") as ArtifactState,
        createdAt: instant(requiredString(row, "created_at")),
        updatedAt: instant(requiredString(row, "updated_at")),
      })),
    };

    try {
      assertDomainGraph(graph);
    } catch (error) {
      throw new PersistenceError(
        "corrupt-database",
        "Persisted Actestra domain records do not form a valid graph",
        {
          cause: error,
        },
      );
    }

    return graph;
  }

  async replaceDomainGraph(graph: DomainGraph): Promise<void> {
    const database = this.requireDatabase();
    assertDomainGraph(graph);
    database.exec("BEGIN IMMEDIATE");
    database.exec("PRAGMA defer_foreign_keys = ON");

    try {
      database.exec(`
        DELETE FROM approvals;
        DELETE FROM artifacts;
        DELETE FROM sessions;
        DELETE FROM tasks;
        DELETE FROM workers;
        DELETE FROM workspaces;
      `);

      const insertWorkspace = database.prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const workspace of graph.workspaces) {
        insertWorkspace.run(
          workspace.id,
          workspace.name,
          workspace.state,
          workspace.createdAt,
          workspace.updatedAt,
        );
      }

      const insertWorker = database.prepare(
        `INSERT INTO workers (
           id, workspace_id, adapter_kind, state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const worker of graph.workers) {
        insertWorker.run(
          worker.id,
          worker.workspaceId,
          worker.adapterKind,
          worker.state,
          worker.createdAt,
          worker.updatedAt,
        );
      }

      const insertTask = database.prepare(
        `INSERT INTO tasks (
           id, workspace_id, title, state, active_session_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      );
      for (const task of graph.tasks) {
        insertTask.run(
          task.id,
          task.workspaceId,
          task.title,
          task.state,
          task.createdAt,
          task.updatedAt,
        );
      }

      const insertSession = database.prepare(
        `INSERT INTO sessions (
           id, workspace_id, task_id, worker_id, state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const session of graph.sessions) {
        insertSession.run(
          session.id,
          session.workspaceId,
          session.taskId,
          session.workerId,
          session.state,
          session.createdAt,
          session.updatedAt,
        );
      }

      const setActiveSession = database.prepare(
        "UPDATE tasks SET active_session_id = ? WHERE id = ?",
      );
      for (const task of graph.tasks) {
        if (task.activeSessionId !== undefined) {
          setActiveSession.run(task.activeSessionId, task.id);
        }
      }

      const insertApproval = database.prepare(
        `INSERT INTO approvals (
           id, workspace_id, task_id, session_id, action, state,
           requested_at, expires_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const approval of graph.approvals) {
        insertApproval.run(
          approval.id,
          approval.workspaceId,
          approval.taskId,
          approval.sessionId,
          approval.action,
          approval.state,
          approval.requestedAt,
          approval.expiresAt ?? null,
          approval.resolvedAt ?? null,
        );
      }

      const insertArtifact = database.prepare(
        `INSERT INTO artifacts (
           id, workspace_id, task_id, session_id, kind, label, state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const artifact of graph.artifacts) {
        insertArtifact.run(
          artifact.id,
          artifact.workspaceId,
          artifact.taskId,
          artifact.sessionId ?? null,
          artifact.kind,
          artifact.label,
          artifact.state,
          artifact.createdAt,
          artifact.updatedAt,
        );
      }

      database.exec(`
        DELETE FROM aionui_general_work_journeys
        WHERE task_id NOT IN (SELECT id FROM tasks);
      `);
      verifyNoForeignKeyViolations(database);
      database.exec("COMMIT");
      this.streamStates.clear();
    } catch (error) {
      rollback(database);

      if (error instanceof CoreContractError || error instanceof PersistenceError) {
        throw error;
      }

      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not atomically replace the persisted domain graph",
        {
          cause: error,
        },
      );
    }
  }

  async appendEvent(event: CoreEvent): Promise<PersistEventResult> {
    const database = this.requireDatabase();
    assertCoreEvent(event);
    database.exec("BEGIN IMMEDIATE");

    try {
      const existingRow = database
        .prepare(`SELECT ${CORE_EVENT_COLUMNS} FROM core_events WHERE event_id = ?`)
        .get(event.eventId) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existing = parseStoredEvent(existingRow);
        assertIdempotentCoreEventDelivery(existing, event);
        database.exec("COMMIT");
        return {
          status: "duplicate",
        };
      }

      const identity = database
        .prepare(
          `SELECT
             sessions.workspace_id,
             sessions.task_id,
             sessions.worker_id,
             tasks.workspace_id AS task_workspace_id,
             workers.workspace_id AS worker_workspace_id
           FROM sessions
           JOIN tasks ON tasks.id = sessions.task_id
           JOIN workers ON workers.id = sessions.worker_id
           JOIN workspaces ON workspaces.id = sessions.workspace_id
           WHERE sessions.id = ?`,
        )
        .get(event.sessionId) as SqliteRow | undefined;

      if (
        identity === undefined ||
        requiredString(identity, "workspace_id") !== event.workspaceId ||
        requiredString(identity, "task_id") !== event.taskId ||
        requiredString(identity, "worker_id") !== event.workerId ||
        requiredString(identity, "task_workspace_id") !== event.workspaceId ||
        requiredString(identity, "worker_workspace_id") !== event.workspaceId
      ) {
        throw new PersistenceError(
          "domain-reference",
          "Core event identity does not match the current Actestra domain graph",
        );
      }

      const nextState = advanceCoreEventStreamState(
        this.loadEventStreamState(database, event.streamId),
        event,
      );
      database
        .prepare(
          `INSERT INTO core_events (
             event_id, stream_id, sequence, occurred_at, workspace_id, task_id,
             session_id, worker_id, type, redaction, envelope_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.eventId,
          event.streamId,
          event.sequence,
          event.occurredAt,
          event.workspaceId,
          event.taskId,
          event.sessionId,
          event.workerId,
          event.type,
          event.redaction,
          JSON.stringify(event),
        );

      database.exec("COMMIT");
      this.streamStates.set(event.streamId, nextState);
      return {
        status: "appended",
      };
    } catch (error) {
      rollback(database);

      if (error instanceof CoreContractError || error instanceof PersistenceError) {
        throw error;
      }

      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not atomically append the core event",
        {
          cause: error,
        },
      );
    }
  }

  async replayEvents(
    streamId: EventStreamId,
    after?: CoreEventCursor,
  ): Promise<readonly CoreEvent[]> {
    const database = this.requireDatabase();
    eventStreamId(streamId);
    const events = this.loadEventStream(database, streamId);
    const replay = replayCoreEvents(events, after);
    this.streamStates.set(streamId, createCoreEventStreamState(events));
    return replay;
  }

  async appendPrivilegedAudit(input: AppendPrivilegedAuditInput): Promise<AuditRecord> {
    const database = this.requireDatabase();
    try {
      assertAppendPrivilegedAuditInput(input);
    } catch (error) {
      throw new PersistenceError("invalid-record", "Privileged audit append is invalid", {
        cause: error,
      });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(
          `SELECT ${PRIVILEGED_AUDIT_COLUMNS}
           FROM privileged_audit_records
           WHERE record_id = ?`,
        )
        .get(input.recordId) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existing = parseStoredAuditRecord(existingRow);
        if (
          existing.occurredAt === input.occurredAt &&
          isDeepStrictEqual(existing.event, input.event)
        ) {
          database.exec("COMMIT");
          return existing;
        }
        throw new PersistenceError(
          "evidence-conflict",
          "Privileged audit record identifier conflicts with durable evidence",
        );
      }

      const summary = database
        .prepare(
          `SELECT COUNT(*) AS record_count, COALESCE(MAX(sequence), 0) AS last_sequence
           FROM privileged_audit_records`,
        )
        .get() as SqliteRow;
      const recordCount = requiredNumber(summary, "record_count");
      const lastSequence = requiredNumber(summary, "last_sequence");
      if (recordCount !== lastSequence || lastSequence >= Number.MAX_SAFE_INTEGER) {
        throw new PersistenceError("corrupt-database", "Privileged audit sequence is not gapless");
      }

      const previous = database
        .prepare(
          `SELECT ${PRIVILEGED_AUDIT_COLUMNS}
           FROM privileged_audit_records
           ORDER BY sequence DESC
           LIMIT 1`,
        )
        .get() as SqliteRow | undefined;
      if (
        previous !== undefined &&
        compareInstants(input.occurredAt, instant(requiredString(previous, "occurred_at"))) < 0
      ) {
        throw new PersistenceError("invalid-record", "Privileged audit time cannot move backwards");
      }

      const record = deepFreeze({
        contractVersion: 1,
        recordId: auditRecordId(input.recordId),
        sequence: lastSequence + 1,
        occurredAt: instant(input.occurredAt),
        redaction: "metadata",
        event: structuredClone(input.event),
      } satisfies AuditRecord);
      assertAuditRecord(record);
      database
        .prepare(
          `INSERT INTO privileged_audit_records (
             sequence, record_id, occurred_at, request_id, workspace_id, task_id,
             session_id, worker_id, tool_id, action, resource_kind, event_type,
             redaction, record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.sequence,
          record.recordId,
          record.occurredAt,
          record.event.context.requestId,
          record.event.context.workspaceId,
          record.event.context.taskId,
          record.event.context.sessionId,
          record.event.context.workerId,
          record.event.context.toolId,
          record.event.context.action,
          record.event.context.resourceKind,
          record.event.type,
          record.redaction,
          JSON.stringify(record),
        );
      database.exec("COMMIT");
      return record;
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not append privileged audit evidence",
        {
          cause: error,
        },
      );
    }
  }

  async appendAgentAttemptEvidence(evidence: AgentAttemptEvidence): Promise<PersistEvidenceResult> {
    const database = this.requireDatabase();
    let encodedEvidence: string;
    let stableEvidence: AgentAttemptEvidence;
    try {
      assertAgentAttemptEvidence(evidence);
      encodedEvidence = JSON.stringify(evidence);
      const normalizedEvidence: unknown = JSON.parse(encodedEvidence);
      assertAgentAttemptEvidence(normalizedEvidence);
      stableEvidence = deepFreeze(normalizedEvidence);
    } catch (error) {
      throw new PersistenceError("invalid-record", "Agent attempt evidence is invalid", {
        cause: error,
      });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(
          `SELECT ${AGENT_ATTEMPT_EVIDENCE_COLUMNS}
           FROM agent_attempt_evidence
           WHERE session_id = ?`,
        )
        .get(stableEvidence.sessionId) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existing = parseStoredAgentAttemptEvidence(existingRow);
        if (isDeepStrictEqual(existing, stableEvidence)) {
          database.exec("COMMIT");
          return {
            status: "duplicate",
          };
        }
        throw new PersistenceError(
          "evidence-conflict",
          "Agent attempt session conflicts with immutable durable evidence",
        );
      }
      database
        .prepare(
          `INSERT INTO agent_attempt_evidence (
             session_id, workspace_id, task_id, worker_id, stream_id, state,
             last_core_event_sequence, incident_code, redaction, evidence_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          stableEvidence.sessionId,
          stableEvidence.workspaceId,
          stableEvidence.taskId,
          stableEvidence.workerId,
          stableEvidence.streamId,
          stableEvidence.state,
          stableEvidence.lastCoreEventSequence,
          stableEvidence.incident?.code ?? null,
          stableEvidence.redaction,
          encodedEvidence,
        );
      database.exec("COMMIT");
      return {
        status: "appended",
      };
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not append agent attempt evidence",
        {
          cause: error,
        },
      );
    }
  }

  async summarizePrivilegedAudit(): Promise<PrivilegedAuditSummary> {
    const database = this.requireDatabase();
    const row = database
      .prepare(
        `SELECT COUNT(*) AS record_count, COALESCE(MAX(sequence), 0) AS last_sequence
         FROM privileged_audit_records`,
      )
      .get() as SqliteRow;
    const summary = Object.freeze({
      recordCount: requiredNumber(row, "record_count"),
      lastSequence: requiredNumber(row, "last_sequence"),
    });
    if (summary.recordCount !== summary.lastSequence) {
      throw new PersistenceError("corrupt-database", "Privileged audit sequence is not gapless");
    }
    return summary;
  }

  async listRecentAgentAttemptEvidence(limit: number): Promise<readonly AgentAttemptEvidence[]> {
    const database = this.requireDatabase();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new PersistenceError(
        "invalid-record",
        "Agent attempt evidence limit must be between 1 and 50",
      );
    }

    const rows = asRows(
      database
        .prepare(
          `SELECT ${AGENT_ATTEMPT_EVIDENCE_COLUMNS}
           FROM agent_attempt_evidence
           ORDER BY sequence DESC
           LIMIT ?`,
        )
        .all(limit),
    );
    return Object.freeze(rows.map(parseStoredAgentAttemptEvidence));
  }

  async persistGeneralWorkCheckpoint(
    checkpoint: GeneralWorkCheckpoint,
  ): Promise<PersistGeneralWorkCheckpointResult> {
    const database = this.requireDatabase();
    let stableCheckpoint: GeneralWorkCheckpoint;
    try {
      assertGeneralWorkCheckpoint(checkpoint);
      const normalized: unknown = JSON.parse(JSON.stringify(checkpoint));
      assertGeneralWorkCheckpoint(normalized);
      stableCheckpoint = deepFreeze(normalized);
    } catch (error) {
      throw new PersistenceError("invalid-record", "General-work checkpoint is invalid", {
        cause: error,
      });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(
          `SELECT ${GENERAL_WORK_CHECKPOINT_COLUMNS}
           FROM general_work_checkpoints
           WHERE session_id = ?`,
        )
        .get(stableCheckpoint.attempt.sessionId) as SqliteRow | undefined;
      if (existingRow === undefined) {
        if (stableCheckpoint.revision !== 1 || stableCheckpoint.phase !== "active") {
          throw new PersistenceError(
            "general-work-conflict",
            "A new general-work checkpoint must begin at active revision 1",
          );
        }
        const recoverableSummary = database
          .prepare(
            `SELECT COUNT(*) AS record_count
             FROM general_work_checkpoints
             WHERE phase != 'finalized'`,
          )
          .get() as SqliteRow;
        if (
          requiredNumber(recoverableSummary, "record_count") >=
          MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS
        ) {
          throw new PersistenceError(
            "general-work-conflict",
            `Actestra permits at most ${MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS} recoverable general-work checkpoints`,
          );
        }
        database
          .prepare(
            `INSERT INTO general_work_checkpoints (
               session_id, contract_version, phase, revision, workspace_id,
               task_id, worker_id, stream_id, created_at, updated_at,
               checkpoint_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            stableCheckpoint.attempt.sessionId,
            stableCheckpoint.contractVersion,
            stableCheckpoint.phase,
            stableCheckpoint.revision,
            stableCheckpoint.attempt.workspaceId,
            stableCheckpoint.attempt.taskId,
            stableCheckpoint.attempt.workerId,
            stableCheckpoint.attempt.streamId,
            stableCheckpoint.createdAt,
            stableCheckpoint.updatedAt,
            JSON.stringify(stableCheckpoint),
          );
        database.exec("COMMIT");
        return deepFreeze({
          status: "stored",
          checkpoint: stableCheckpoint,
        });
      }

      const existing = parseStoredGeneralWorkCheckpoint(existingRow);
      if (isDeepStrictEqual(existing, stableCheckpoint)) {
        database.exec("COMMIT");
        return deepFreeze({
          status: "duplicate",
          checkpoint: existing,
        });
      }
      try {
        assertGeneralWorkCheckpointTransition(existing, stableCheckpoint);
      } catch (error) {
        throw new PersistenceError(
          "general-work-conflict",
          "General-work checkpoint update conflicts with durable state",
          { cause: error },
        );
      }
      const update = database
        .prepare(
          `UPDATE general_work_checkpoints
           SET phase = ?, revision = ?, updated_at = ?, checkpoint_json = ?
           WHERE session_id = ? AND revision = ?`,
        )
        .run(
          stableCheckpoint.phase,
          stableCheckpoint.revision,
          stableCheckpoint.updatedAt,
          JSON.stringify(stableCheckpoint),
          stableCheckpoint.attempt.sessionId,
          existing.revision,
        );
      if (update.changes !== 1) {
        throw new PersistenceError(
          "general-work-conflict",
          "General-work checkpoint revision changed concurrently",
        );
      }
      database.exec("COMMIT");
      return deepFreeze({
        status: "updated",
        checkpoint: stableCheckpoint,
      });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not persist the general-work checkpoint",
        { cause: error },
      );
    }
  }

  async getGeneralWorkCheckpoint(
    session: ReturnType<typeof sessionId>,
  ): Promise<GeneralWorkCheckpoint | null> {
    const database = this.requireDatabase();
    try {
      sessionId(session);
    } catch (error) {
      throw new PersistenceError("invalid-record", "General-work checkpoint lookup is invalid", {
        cause: error,
      });
    }
    const row = database
      .prepare(
        `SELECT ${GENERAL_WORK_CHECKPOINT_COLUMNS}
         FROM general_work_checkpoints
         WHERE session_id = ?`,
      )
      .get(session) as SqliteRow | undefined;
    return row === undefined ? null : parseStoredGeneralWorkCheckpoint(row);
  }

  async listRecoverableGeneralWorkCheckpoints(
    limit: number,
  ): Promise<readonly GeneralWorkCheckpoint[]> {
    const database = this.requireDatabase();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new PersistenceError(
        "invalid-record",
        "Recoverable general-work checkpoint limit must be between 1 and 100",
      );
    }
    const rows = asRows(
      database
        .prepare(
          `SELECT ${GENERAL_WORK_CHECKPOINT_COLUMNS}
           FROM general_work_checkpoints
           WHERE phase != 'finalized'
           ORDER BY updated_at, session_id
           LIMIT ?`,
        )
        .all(limit),
    );
    return Object.freeze(rows.map(parseStoredGeneralWorkCheckpoint));
  }

  async registerAionUiGeneralWorkJourney(
    registration: AionUiGeneralWorkRegistration,
  ): Promise<RegisterAionUiGeneralWorkJourneyResult> {
    const database = this.requireDatabase();
    let stable: AionUiGeneralWorkRegistration;
    try {
      assertAionUiGeneralWorkRegistration(registration);
      const normalized: unknown = JSON.parse(JSON.stringify(registration));
      assertAionUiGeneralWorkRegistration(normalized);
      stable = deepFreeze(normalized);
    } catch (error) {
      throw new PersistenceError("invalid-record", "AionUI general-work registration is invalid", {
        cause: error,
      });
    }
    const initialInputReference =
      "toolInputReference" in stable
        ? stable.toolInputReference
        : "readInputReference" in stable
          ? stable.readInputReference
          : undefined;

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(
          `SELECT ${AIONUI_GENERAL_WORK_JOURNEY_COLUMNS}
           FROM aionui_general_work_journeys
           WHERE task_id = ?`,
        )
        .get(stable.link.taskId) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existing = parseStoredAionUiGeneralWorkLink(existingRow);
        const workspaceRow = database
          .prepare("SELECT name, created_at FROM workspaces WHERE id = ?")
          .get(stable.workspace.id) as SqliteRow | undefined;
        const taskRow = database
          .prepare("SELECT workspace_id, title, created_at FROM tasks WHERE id = ?")
          .get(stable.task.id) as SqliteRow | undefined;
        const sessionRow = database
          .prepare(
            `SELECT workspace_id, task_id, worker_id, created_at
             FROM sessions
             WHERE id = ?`,
          )
          .get(stable.session.id) as SqliteRow | undefined;
        const workerRow = database
          .prepare("SELECT workspace_id, adapter_kind, created_at FROM workers WHERE id = ?")
          .get(stable.worker.id) as SqliteRow | undefined;
        const grantRow = database
          .prepare(`SELECT ${WORKSPACE_GRANT_COLUMNS} FROM workspace_grants WHERE grant_id = ?`)
          .get(stable.workspaceGrant.grantId) as SqliteRow | undefined;
        const promptRow = database
          .prepare(
            `SELECT ${CONTENT_REFERENCE_COLUMNS}
             FROM content_references
             WHERE reference = ?`,
          )
          .get(stable.promptReference.reference) as SqliteRow | undefined;
        const initialInputRow =
          initialInputReference === undefined
            ? undefined
            : (database
                .prepare(
                  `SELECT ${CONTENT_REFERENCE_COLUMNS}
                   FROM content_references
                   WHERE reference = ?`,
                )
                .get(initialInputReference.reference) as SqliteRow | undefined);
        const grant = grantRow === undefined ? undefined : parseStoredWorkspaceGrant(grantRow);
        const recordsMatch =
          isDeepStrictEqual(existing, stable.link) &&
          workspaceRow !== undefined &&
          requiredString(workspaceRow, "name") === stable.workspace.name &&
          requiredString(workspaceRow, "created_at") === stable.workspace.createdAt &&
          taskRow !== undefined &&
          requiredString(taskRow, "workspace_id") === stable.task.workspaceId &&
          requiredString(taskRow, "title") === stable.task.title &&
          requiredString(taskRow, "created_at") === stable.task.createdAt &&
          sessionRow !== undefined &&
          requiredString(sessionRow, "workspace_id") === stable.session.workspaceId &&
          requiredString(sessionRow, "task_id") === stable.session.taskId &&
          requiredString(sessionRow, "worker_id") === stable.session.workerId &&
          requiredString(sessionRow, "created_at") === stable.session.createdAt &&
          workerRow !== undefined &&
          requiredString(workerRow, "workspace_id") === stable.worker.workspaceId &&
          requiredString(workerRow, "adapter_kind") === stable.worker.adapterKind &&
          requiredString(workerRow, "created_at") === stable.worker.createdAt &&
          grant !== undefined &&
          grant.contractVersion === stable.workspaceGrant.contractVersion &&
          grant.grantId === stable.workspaceGrant.grantId &&
          grant.workspaceId === stable.workspaceGrant.workspaceId &&
          grant.rootPath === stable.workspaceGrant.rootPath &&
          grant.displayName === stable.workspaceGrant.displayName &&
          grant.createdAt === stable.workspaceGrant.createdAt &&
          storedContentMatches(promptRow, stable.promptReference) &&
          (initialInputReference === undefined ||
            storedContentMatches(initialInputRow, initialInputReference));
        if (!recordsMatch) {
          throw new PersistenceError(
            "general-work-journey-conflict",
            "AionUI general-work registration conflicts with durable state",
          );
        }
        database.exec("COMMIT");
        return deepFreeze({ status: "duplicate", link: existing });
      }

      const collisions = [
        ["workspaces", stable.workspace.id],
        ["tasks", stable.task.id],
        ["sessions", stable.session.id],
        ["workers", stable.worker.id],
      ] as const;
      for (const [table, identifier] of collisions) {
        const collision = database.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(identifier);
        if (collision !== undefined) {
          throw new PersistenceError(
            "general-work-journey-conflict",
            "AionUI general-work registration reuses an authoritative identity",
          );
        }
      }
      if (
        database
          .prepare("SELECT grant_id FROM workspace_grants WHERE grant_id = ?")
          .get(stable.workspaceGrant.grantId) !== undefined ||
        database
          .prepare("SELECT reference FROM content_references WHERE reference = ?")
          .get(stable.promptReference.reference) !== undefined ||
        (initialInputReference !== undefined &&
          database
            .prepare("SELECT reference FROM content_references WHERE reference = ?")
            .get(initialInputReference.reference) !== undefined)
      ) {
        throw new PersistenceError(
          "general-work-journey-conflict",
          "AionUI general-work registration reuses grant or content authority",
        );
      }
      const conversationCountRow = database
        .prepare(
          `SELECT COUNT(*) AS journey_count
           FROM aionui_general_work_journeys
           WHERE conversation_hash = ?`,
        )
        .get(stable.link.conversationHash) as SqliteRow;
      if (
        requiredNumber(conversationCountRow, "journey_count") >=
        AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
      ) {
        throw new PersistenceError(
          "general-work-journey-conflict",
          "AionUI general-work conversation reached its durable journey limit",
        );
      }

      database
        .prepare(
          `INSERT INTO workspaces (id, name, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          stable.workspace.id,
          stable.workspace.name,
          stable.workspace.state,
          stable.workspace.createdAt,
          stable.workspace.updatedAt,
        );
      assertCanonicalWorkspaceRoot(stable.workspaceGrant.rootPath);
      insertWorkspaceGrant(database, stable.workspaceGrant);
      database
        .prepare(
          `INSERT INTO workers (
             id, workspace_id, adapter_kind, state, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          stable.worker.id,
          stable.worker.workspaceId,
          stable.worker.adapterKind,
          stable.worker.state,
          stable.worker.createdAt,
          stable.worker.updatedAt,
        );
      database
        .prepare(
          `INSERT INTO tasks (
             id, workspace_id, title, state, active_session_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          stable.task.id,
          stable.task.workspaceId,
          stable.task.title,
          stable.task.state,
          stable.task.createdAt,
          stable.task.updatedAt,
        );
      database
        .prepare(
          `INSERT INTO sessions (
             id, workspace_id, task_id, worker_id, state, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          stable.session.id,
          stable.session.workspaceId,
          stable.session.taskId,
          stable.session.workerId,
          stable.session.state,
          stable.session.createdAt,
          stable.session.updatedAt,
        );
      database
        .prepare("UPDATE tasks SET active_session_id = ? WHERE id = ?")
        .run(stable.session.id, stable.task.id);
      insertContentReference(database, stable.promptReference);
      if (initialInputReference !== undefined) {
        insertContentReference(database, initialInputReference);
      }
      database
        .prepare(
          `INSERT INTO aionui_general_work_journeys (
             task_id, contract_version, conversation_hash, journey_kind, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          stable.link.taskId,
          stable.link.contractVersion,
          stable.link.conversationHash,
          stable.link.journeyKind,
          stable.link.createdAt,
        );
      verifyNoForeignKeyViolations(database);
      database.exec("COMMIT");
      return deepFreeze({ status: "stored", link: stable.link });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not register the AionUI general-work journey",
        { cause: error },
      );
    }
  }

  async listAionUiGeneralWorkJourneyLinks(
    conversationHash: string,
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]> {
    const database = this.requireDatabase();
    if (
      !/^[a-f0-9]{64}$/u.test(conversationHash) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
    ) {
      throw new PersistenceError(
        "invalid-record",
        "AionUI general-work lookup requires a SHA-256 identity and a limit from 1 to 100",
      );
    }
    const rows = asRows(
      database
        .prepare(
          `SELECT ${AIONUI_GENERAL_WORK_JOURNEY_COLUMNS}
           FROM aionui_general_work_journeys
           WHERE conversation_hash = ?
           ORDER BY created_at, task_id
           LIMIT ?`,
        )
        .all(conversationHash, limit),
    );
    return Object.freeze(rows.map(parseStoredAionUiGeneralWorkLink));
  }

  async listPreparedAionUiGeneralWorkJourneyLinks(
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]> {
    const database = this.requireDatabase();
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
    ) {
      throw new PersistenceError(
        "invalid-record",
        "Prepared AionUI general-work lookup requires a limit from 1 to 100",
      );
    }
    const rows = asRows(
      database
        .prepare(
          `SELECT
             journeys.task_id,
             journeys.contract_version,
             journeys.conversation_hash,
             journeys.journey_kind,
             journeys.created_at
           FROM aionui_general_work_journeys AS journeys
           JOIN tasks ON tasks.id = journeys.task_id
           JOIN sessions ON sessions.id = tasks.active_session_id
           LEFT JOIN general_work_checkpoints
             ON general_work_checkpoints.session_id = sessions.id
           WHERE tasks.state = 'ready'
             AND sessions.state = 'created'
             AND general_work_checkpoints.session_id IS NULL
           ORDER BY journeys.created_at, journeys.task_id
           LIMIT ?`,
        )
        .all(limit),
    );
    return Object.freeze(rows.map(parseStoredAionUiGeneralWorkLink));
  }

  async registerAionUiSchedule(
    registration: AionUiScheduleRegistration,
  ): Promise<AionUiScheduleRegistrationResult> {
    const database = this.requireDatabase();
    let stable: AionUiScheduleRegistration;
    try {
      assertAionUiScheduleRegistration(registration);
      const normalized: unknown = JSON.parse(JSON.stringify(registration));
      assertAionUiScheduleRegistration(normalized);
      stable = deepFreeze(normalized);
      assertCanonicalWorkspaceRoot(stable.workspaceGrant.rootPath);
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule registration");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadAionUiScheduleJob(database, stable.job.id, true);
      if (existing !== undefined) {
        const workspaceRow = database
          .prepare(
            `SELECT id, name, state, created_at, updated_at
             FROM workspaces
             WHERE id = ?`,
          )
          .get(stable.workspace.id) as SqliteRow | undefined;
        const grantRow = database
          .prepare(`SELECT ${WORKSPACE_GRANT_COLUMNS} FROM workspace_grants WHERE grant_id = ?`)
          .get(stable.workspaceGrant.grantId) as SqliteRow | undefined;
        const grant = grantRow === undefined ? undefined : parseStoredWorkspaceGrant(grantRow);
        const recordsMatch =
          isDeepStrictEqual(existing, stable.job) &&
          workspaceRow !== undefined &&
          requiredString(workspaceRow, "id") === stable.workspace.id &&
          requiredString(workspaceRow, "name") === stable.workspace.name &&
          requiredString(workspaceRow, "state") === stable.workspace.state &&
          requiredString(workspaceRow, "created_at") === stable.workspace.createdAt &&
          requiredString(workspaceRow, "updated_at") === stable.workspace.updatedAt &&
          grant !== undefined &&
          isDeepStrictEqual(grant, stable.workspaceGrant);
        if (!recordsMatch) {
          throw new PersistenceError(
            "schedule-conflict",
            "AionUI schedule identity conflicts with durable authority",
          );
        }
        database.exec("COMMIT");
        return deepFreeze({ status: "duplicate", job: existing });
      }

      const countRow = database
        .prepare(
          `SELECT COUNT(*) AS schedule_count
           FROM aionui_schedule_jobs
           WHERE deleted_at_ms IS NULL`,
        )
        .get() as SqliteRow;
      if (requiredNumber(countRow, "schedule_count") >= AIONUI_SCHEDULE_MAX_JOBS) {
        throw new PersistenceError(
          "schedule-limit",
          "Actestra reached the bounded non-deleted schedule limit",
        );
      }

      const workspaceCollision = database
        .prepare("SELECT id FROM workspaces WHERE id = ?")
        .get(stable.workspace.id);
      const grantCollision = database
        .prepare("SELECT grant_id FROM workspace_grants WHERE grant_id = ?")
        .get(stable.workspaceGrant.grantId);
      if (workspaceCollision !== undefined || grantCollision !== undefined) {
        throw new PersistenceError(
          "schedule-conflict",
          "AionUI schedule registration reuses Workspace or grant authority",
        );
      }

      database
        .prepare(
          `INSERT INTO workspaces (id, name, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          stable.workspace.id,
          stable.workspace.name,
          stable.workspace.state,
          stable.workspace.createdAt,
          stable.workspace.updatedAt,
        );
      insertWorkspaceGrant(database, stable.workspaceGrant);
      insertAionUiScheduleJob(database, stable.job);
      verifyNoForeignKeyViolations(database);
      database.exec("COMMIT");
      return deepFreeze({ status: "stored", job: stable.job });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not register the AionUI schedule",
        { cause: error },
      );
    }
  }

  async listAionUiSchedules(input: AionUiScheduleListInput): Promise<readonly AionUiScheduleJob[]> {
    const database = this.requireDatabase();
    let stable: AionUiScheduleListInput;
    try {
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertAionUiScheduleListInput(normalized);
      stable = normalized;
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule list input");
    }
    const rows = asRows(
      stable.conversationHash === undefined
        ? database
            .prepare(
              `SELECT ${AIONUI_SCHEDULE_JOB_COLUMNS}
               FROM aionui_schedule_jobs
               WHERE deleted_at_ms IS NULL
               ORDER BY created_at_ms, job_id
               LIMIT ?`,
            )
            .all(stable.limit)
        : database
            .prepare(
              `SELECT ${AIONUI_SCHEDULE_JOB_COLUMNS}
               FROM aionui_schedule_jobs
               WHERE deleted_at_ms IS NULL AND conversation_hash = ?
               ORDER BY created_at_ms, job_id
               LIMIT ?`,
            )
            .all(stable.conversationHash, stable.limit),
    );
    return Object.freeze(rows.map(parseStoredAionUiScheduleJob));
  }

  async getAionUiSchedule(jobIdValue: string): Promise<AionUiScheduleJob | null> {
    const database = this.requireDatabase();
    try {
      assertAionUiScheduleJobId(jobIdValue);
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule lookup");
    }
    return loadAionUiScheduleJob(database, jobIdValue) ?? null;
  }

  async updateAionUiSchedule(
    input: AionUiSchedulePersistenceUpdateInput,
  ): Promise<AionUiScheduleMutationResult> {
    const database = this.requireDatabase();
    let stable: AionUiSchedulePersistenceUpdateInput;
    try {
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertAionUiSchedulePersistenceUpdateInput(normalized);
      stable = normalized;
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule update");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadAionUiScheduleJob(database, stable.jobId);
      if (existing === undefined) {
        database.exec("COMMIT");
        return Object.freeze({ status: "not-found" });
      }
      assertScheduleMutationTime(stable.updatedAtMs, existing, "Schedule update");
      const updated = normalizedScheduleJob({
        ...existing,
        nativeConversationTitle: Object.hasOwn(stable, "nativeConversationTitle")
          ? (stable.nativeConversationTitle ?? undefined)
          : existing.nativeConversationTitle,
        name: stable.name ?? existing.name,
        description: Object.hasOwn(stable, "description")
          ? (stable.description ?? undefined)
          : existing.description,
        prompt: stable.prompt ?? existing.prompt,
        schedule: stable.schedule ?? existing.schedule,
        enabled: stable.enabled ?? existing.enabled,
        nextRunAtMs: Object.hasOwn(stable, "nextRunAtMs")
          ? (stable.nextRunAtMs ?? undefined)
          : existing.nextRunAtMs,
        lastRunAtMs: Object.hasOwn(stable, "lastRunAtMs")
          ? (stable.lastRunAtMs ?? undefined)
          : existing.lastRunAtMs,
        lastStatus: Object.hasOwn(stable, "lastStatus")
          ? (stable.lastStatus ?? undefined)
          : existing.lastStatus,
        lastIncidentCode: Object.hasOwn(stable, "lastIncidentCode")
          ? (stable.lastIncidentCode ?? undefined)
          : existing.lastIncidentCode,
        updatedAtMs: stable.updatedAtMs,
      });
      if (
        updateAionUiScheduleJob(
          database,
          updated,
          "AND deleted_at_ms IS NULL AND updated_at_ms = ?",
          [existing.updatedAtMs],
        ) !== 1
      ) {
        throw new PersistenceError("schedule-conflict", "AionUI schedule update lost its state");
      }
      database.exec("COMMIT");
      return deepFreeze({ status: "updated", job: updated });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not update the AionUI schedule",
        { cause: error },
      );
    }
  }

  async deleteAionUiSchedule(
    input: AionUiScheduleDeleteInput,
  ): Promise<AionUiScheduleMutationResult> {
    const database = this.requireDatabase();
    let stable: AionUiScheduleDeleteInput;
    try {
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertAionUiScheduleDeleteInput(normalized);
      stable = normalized;
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule deletion");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadAionUiScheduleJob(database, stable.jobId);
      if (existing === undefined) {
        database.exec("COMMIT");
        return Object.freeze({ status: "not-found" });
      }
      if (existing.activeClaim !== undefined) {
        database.exec("COMMIT");
        return deepFreeze({ status: "active-claim", job: existing });
      }
      assertScheduleMutationTime(stable.deletedAtMs, existing, "Schedule deletion");
      const deleted = normalizedScheduleJob({
        ...existing,
        enabled: false,
        nextRunAtMs: undefined,
        updatedAtMs: stable.deletedAtMs,
        deletedAtMs: stable.deletedAtMs,
      });
      if (
        updateAionUiScheduleJob(
          database,
          deleted,
          "AND deleted_at_ms IS NULL AND active_claim IS NULL AND updated_at_ms = ?",
          [existing.updatedAtMs],
        ) !== 1
      ) {
        throw new PersistenceError("schedule-conflict", "AionUI schedule deletion lost its state");
      }
      database.exec("COMMIT");
      return deepFreeze({ status: "deleted", job: deleted });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not delete the AionUI schedule",
        { cause: error },
      );
    }
  }

  async claimAionUiScheduleRun(
    input: AionUiScheduleClaimInput,
  ): Promise<AionUiScheduleClaimResult> {
    const database = this.requireDatabase();
    let stable: AionUiScheduleClaimInput;
    try {
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertAionUiScheduleClaimInput(normalized);
      stable = normalized;
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule claim");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadAionUiScheduleJob(database, stable.jobId);
      if (existing === undefined) {
        database.exec("COMMIT");
        return Object.freeze({ status: "not-found" });
      }
      if (existing.activeClaim !== undefined) {
        database.exec("COMMIT");
        return deepFreeze({ status: "busy", job: existing });
      }
      assertScheduleMutationTime(stable.claimedAtMs, existing, "Schedule claim");
      const claimed = normalizedScheduleJob({
        ...existing,
        nextRunAtMs: undefined,
        activeClaim: stable.claim,
        activeClaimedAtMs: stable.claimedAtMs,
        runSequence: existing.runSequence + 1,
        updatedAtMs: stable.claimedAtMs,
      });
      if (
        updateAionUiScheduleJob(
          database,
          claimed,
          "AND deleted_at_ms IS NULL AND active_claim IS NULL AND updated_at_ms = ?",
          [existing.updatedAtMs],
        ) !== 1
      ) {
        throw new PersistenceError("schedule-conflict", "AionUI schedule claim lost its state");
      }
      database.exec("COMMIT");
      return deepFreeze({
        status: "claimed",
        job: claimed,
      });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not claim the AionUI schedule run",
        { cause: error },
      );
    }
  }

  async completeAionUiScheduleRun(
    input: AionUiScheduleCompletionInput,
  ): Promise<AionUiScheduleCompletionResult> {
    const database = this.requireDatabase();
    let stable: AionUiScheduleCompletionInput;
    try {
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertAionUiScheduleCompletionInput(normalized);
      stable = normalized;
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule completion");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadAionUiScheduleJob(database, stable.jobId);
      if (existing === undefined) {
        database.exec("COMMIT");
        return Object.freeze({ status: "not-found" });
      }
      if (existing.activeClaim !== stable.claim || existing.activeClaimedAtMs === undefined) {
        database.exec("COMMIT");
        return deepFreeze({ status: "claim-mismatch", job: existing });
      }
      assertScheduleMutationTime(stable.completedAtMs, existing, "Schedule completion");
      if (stable.completedAtMs < existing.activeClaimedAtMs) {
        throw new PersistenceError(
          "invalid-record",
          "Schedule completion cannot predate its active claim",
        );
      }
      const completed = normalizedScheduleJob({
        ...existing,
        enabled: stable.enabled ?? existing.enabled,
        nextRunAtMs: stable.nextRunAtMs ?? undefined,
        lastRunAtMs: stable.completedAtMs,
        lastStatus: stable.status,
        lastIncidentCode: stable.lastIncidentCode,
        activeClaim: undefined,
        activeClaimedAtMs: undefined,
        runCount: existing.runCount + 1,
        updatedAtMs: stable.completedAtMs,
      });
      if (
        updateAionUiScheduleJob(
          database,
          completed,
          `AND deleted_at_ms IS NULL AND active_claim = ?
           AND active_claimed_at_ms = ? AND updated_at_ms = ?`,
          [existing.activeClaim, existing.activeClaimedAtMs, existing.updatedAtMs],
        ) !== 1
      ) {
        throw new PersistenceError(
          "schedule-conflict",
          "AionUI schedule completion lost its active claim",
        );
      }
      database.exec("COMMIT");
      return deepFreeze({
        status: "completed",
        job: completed,
      });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not complete the AionUI schedule run",
        { cause: error },
      );
    }
  }

  async recoverAionUiScheduleRuns(
    input: AionUiScheduleRecoveryInput,
  ): Promise<readonly AionUiScheduleJob[]> {
    const database = this.requireDatabase();
    let stable: AionUiScheduleRecoveryInput;
    try {
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertAionUiScheduleRecoveryInput(normalized);
      stable = normalized;
    } catch (error) {
      throw normalizeScheduleContractError(error, "AionUI schedule recovery");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const activeJobs = asRows(
        database
          .prepare(
            `SELECT ${AIONUI_SCHEDULE_JOB_COLUMNS}
             FROM aionui_schedule_jobs
             WHERE deleted_at_ms IS NULL AND active_claim IS NOT NULL
             ORDER BY active_claimed_at_ms, job_id
             LIMIT ?`,
          )
          .all(AIONUI_SCHEDULE_MAX_JOBS),
      ).map(parseStoredAionUiScheduleJob);
      for (const existing of activeJobs) {
        assertScheduleMutationTime(stable.recoveredAtMs, existing, "Schedule recovery");
        if (
          existing.activeClaim === undefined ||
          existing.activeClaimedAtMs === undefined ||
          stable.recoveredAtMs < existing.activeClaimedAtMs
        ) {
          throw new PersistenceError(
            "corrupt-database",
            "Recoverable AionUI schedule claim is inconsistent",
          );
        }
      }

      const recovered = activeJobs.map((existing) => {
        const terminal = normalizedScheduleJob({
          ...existing,
          lastRunAtMs: stable.recoveredAtMs,
          lastStatus: "error",
          lastIncidentCode: "interrupted",
          activeClaim: undefined,
          activeClaimedAtMs: undefined,
          runCount: existing.runCount + 1,
          updatedAtMs: stable.recoveredAtMs,
        });
        if (
          updateAionUiScheduleJob(
            database,
            terminal,
            `AND deleted_at_ms IS NULL AND active_claim = ?
             AND active_claimed_at_ms = ? AND updated_at_ms = ?`,
            [
              existing.activeClaim ?? null,
              existing.activeClaimedAtMs ?? null,
              existing.updatedAtMs,
            ],
          ) !== 1
        ) {
          throw new PersistenceError(
            "schedule-conflict",
            "AionUI schedule recovery lost its active claim",
          );
        }
        return terminal;
      });
      database.exec("COMMIT");
      return Object.freeze(recovered);
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not recover interrupted AionUI schedule runs",
        { cause: error },
      );
    }
  }

  async appendAionUiShadowEvidence(
    evidence: AionUiShadowEvidence,
  ): Promise<AppendAionUiShadowEvidenceResult> {
    const database = this.requireDatabase();
    let encodedEvidence: string;
    let stableEvidence: AionUiShadowEvidence;
    try {
      assertAionUiShadowEvidence(evidence);
      encodedEvidence = JSON.stringify(evidence);
      const normalizedEvidence: unknown = JSON.parse(encodedEvidence);
      assertAionUiShadowEvidence(normalizedEvidence);
      stableEvidence = deepFreeze(normalizedEvidence);
    } catch (error) {
      throw new PersistenceError("invalid-record", "AionUi shadow evidence is invalid", {
        cause: error,
      });
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(
          `SELECT ${AIONUI_SHADOW_EVIDENCE_COLUMNS}
           FROM aionui_shadow_evidence
           WHERE evidence_id = ?`,
        )
        .get(stableEvidence.evidenceId) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existing = parseStoredAionUiShadowEvidence(existingRow);
        if (isSameAionUiShadowRevision(existing.evidence, stableEvidence)) {
          database.exec("COMMIT");
          return {
            status: "duplicate",
            sequence: existing.sequence,
          };
        }
        throw new PersistenceError(
          "evidence-conflict",
          "AionUi shadow evidence identifier conflicts with durable evidence",
        );
      }

      const conflictingRevisionRow = database
        .prepare(
          `SELECT ${AIONUI_SHADOW_EVIDENCE_COLUMNS}
           FROM aionui_shadow_evidence
           WHERE domain = ?
             AND native_identity_hash = ?
             AND native_revision_hash = ?`,
        )
        .get(
          stableEvidence.domain,
          stableEvidence.nativeIdentityHash,
          stableEvidence.nativeRevisionHash,
        ) as SqliteRow | undefined;
      if (conflictingRevisionRow !== undefined) {
        parseStoredAionUiShadowEvidence(conflictingRevisionRow);
        throw new PersistenceError(
          "evidence-conflict",
          "AionUi shadow native revision conflicts with a durable identifier",
        );
      }

      const summary = database
        .prepare(
          `SELECT COUNT(*) AS record_count, COALESCE(MAX(sequence), 0) AS last_sequence
           FROM aionui_shadow_evidence`,
        )
        .get() as SqliteRow;
      const recordCount = requiredNumber(summary, "record_count");
      const lastSequence = requiredNumber(summary, "last_sequence");
      if (recordCount !== lastSequence || lastSequence >= Number.MAX_SAFE_INTEGER) {
        throw new PersistenceError(
          "corrupt-database",
          "AionUi shadow evidence sequence is not gapless",
        );
      }

      const sequence = lastSequence + 1;
      database
        .prepare(
          `INSERT INTO aionui_shadow_evidence (
             sequence, evidence_id, captured_at, source, domain,
             native_identity_hash, native_revision_hash, redaction, evidence_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sequence,
          stableEvidence.evidenceId,
          stableEvidence.capturedAt,
          stableEvidence.source,
          stableEvidence.domain,
          stableEvidence.nativeIdentityHash,
          stableEvidence.nativeRevisionHash,
          stableEvidence.redaction,
          encodedEvidence,
        );
      database.exec("COMMIT");
      return {
        status: "appended",
        sequence,
      };
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not append AionUi shadow evidence",
        {
          cause: error,
        },
      );
    }
  }

  async listRecentAionUiShadowEvidence(
    limit: number,
  ): Promise<readonly StoredAionUiShadowEvidence[]> {
    const database = this.requireDatabase();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new PersistenceError(
        "invalid-record",
        "AionUi shadow evidence limit must be between 1 and 50",
      );
    }
    const rows = asRows(
      database
        .prepare(
          `SELECT ${AIONUI_SHADOW_EVIDENCE_COLUMNS}
           FROM aionui_shadow_evidence
           ORDER BY sequence DESC
           LIMIT ?`,
        )
        .all(limit),
    );
    return Object.freeze(rows.map(parseStoredAionUiShadowEvidence));
  }

  async summarizeAionUiShadowEvidence(): Promise<AionUiShadowEvidenceSummary> {
    const database = this.requireDatabase();
    const row = database
      .prepare(
        `SELECT COUNT(*) AS record_count, COALESCE(MAX(sequence), 0) AS last_sequence
         FROM aionui_shadow_evidence`,
      )
      .get() as SqliteRow;
    const summary = Object.freeze({
      recordCount: requiredNumber(row, "record_count"),
      lastSequence: requiredNumber(row, "last_sequence"),
    });
    if (summary.recordCount !== summary.lastSequence) {
      throw new PersistenceError(
        "corrupt-database",
        "AionUi shadow evidence sequence is not gapless",
      );
    }
    return summary;
  }

  async reserveAionUiApprovalDecision(
    decision: NormalizedAionUiApprovalDecision,
    now: string,
  ): Promise<ReserveAionUiApprovalDecisionResult> {
    const database = this.requireDatabase();
    const candidate = validatedApprovalRecord({
      ...decision,
      deliveryState: "pending-delivery",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadApprovalDecision(database, candidate.decisionId);
      if (existing !== undefined) {
        if (!approvalDecisionMatches(existing, decision)) {
          throw new PersistenceError(
            "evidence-conflict",
            "AionUi approval identifier conflicts with an immutable decision",
          );
        }
        database.exec("COMMIT");
        return {
          status: "duplicate",
          record: existing,
        };
      }

      const identityRow = database
        .prepare(
          `SELECT ${AIONUI_APPROVAL_DECISION_COLUMNS}
           FROM aionui_approval_decisions
           WHERE native_conversation_id = ? AND native_call_id = ?`,
        )
        .get(candidate.nativeConversationId, candidate.nativeCallId) as SqliteRow | undefined;
      if (identityRow !== undefined) {
        throw new PersistenceError(
          "evidence-conflict",
          "AionUi approval identity conflicts with an immutable decision",
        );
      }

      database
        .prepare(
          `INSERT INTO aionui_approval_decisions (
             decision_id, native_conversation_id, native_call_id, native_message_id,
             native_path, request_hash, decision, always_allow, delivery_state,
             attempt_count, created_at, updated_at, last_attempt_at, delivered_at,
             last_error_code, delivery_body_json, record_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          candidate.decisionId,
          candidate.nativeConversationId,
          candidate.nativeCallId,
          candidate.nativeMessageId,
          candidate.nativePath,
          candidate.requestHash,
          candidate.decision,
          candidate.alwaysAllow ? 1 : 0,
          candidate.deliveryState,
          candidate.attemptCount,
          candidate.createdAt,
          candidate.updatedAt,
          null,
          null,
          null,
          JSON.stringify(candidate.deliveryBody),
          JSON.stringify(candidate),
        );
      database.exec("COMMIT");
      return {
        status: "created",
        record: candidate,
      };
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not reserve the AionUi approval decision",
        {
          cause: error,
        },
      );
    }
  }

  async beginAionUiApprovalDelivery(
    decisionId: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord> {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadApprovalDecision(database, decisionId);
      if (existing === undefined) {
        throw new PersistenceError("invalid-record", "AionUi approval decision was not found");
      }
      if (existing.deliveryState === "delivered") {
        database.exec("COMMIT");
        return existing;
      }
      if (existing.attemptCount >= Number.MAX_SAFE_INTEGER) {
        throw new PersistenceError(
          "invalid-record",
          "AionUi approval delivery attempt count is exhausted",
        );
      }
      const updateTime = monotonicApprovalUpdateTime(existing, now);
      const updated = validatedApprovalRecord({
        ...existing,
        attemptCount: existing.attemptCount + 1,
        updatedAt: updateTime,
        lastAttemptAt: updateTime,
        lastErrorCode: undefined,
      });
      updateApprovalDecision(database, updated);
      database.exec("COMMIT");
      return updated;
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not begin AionUi approval delivery",
        {
          cause: error,
        },
      );
    }
  }

  async markAionUiApprovalDelivered(
    decisionId: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord> {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadApprovalDecision(database, decisionId);
      if (existing === undefined) {
        throw new PersistenceError("invalid-record", "AionUi approval decision was not found");
      }
      if (existing.deliveryState === "delivered") {
        database.exec("COMMIT");
        return existing;
      }
      const updateTime = monotonicApprovalUpdateTime(existing, now);
      const updated = validatedApprovalRecord({
        ...existing,
        deliveryState: "delivered",
        updatedAt: updateTime,
        deliveredAt: updateTime,
        lastErrorCode: undefined,
      });
      updateApprovalDecision(database, updated);
      database.exec("COMMIT");
      return updated;
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not complete AionUi approval delivery",
        {
          cause: error,
        },
      );
    }
  }

  async markAionUiApprovalDeliveryFailed(
    decisionId: string,
    errorCode: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord> {
    const database = this.requireDatabase();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = loadApprovalDecision(database, decisionId);
      if (existing === undefined) {
        throw new PersistenceError("invalid-record", "AionUi approval decision was not found");
      }
      if (existing.deliveryState === "delivered") {
        throw new PersistenceError(
          "evidence-conflict",
          "A delivered AionUi approval cannot be marked failed",
        );
      }
      const updateTime = monotonicApprovalUpdateTime(existing, now);
      const updated = validatedApprovalRecord({
        ...existing,
        updatedAt: updateTime,
        lastErrorCode: errorCode,
      });
      updateApprovalDecision(database, updated);
      database.exec("COMMIT");
      return updated;
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not record the AionUi approval delivery failure",
        {
          cause: error,
        },
      );
    }
  }

  async getAionUiApprovalDecision(
    decisionId: string,
  ): Promise<AionUiApprovalDecisionRecord | undefined> {
    return loadApprovalDecision(this.requireDatabase(), decisionId);
  }

  async listPendingAionUiApprovalDecisions(
    limit: number,
  ): Promise<readonly AionUiApprovalDecisionRecord[]> {
    const database = this.requireDatabase();
    assertAionUiApprovalAuthorityLimit(limit);
    const rows = asRows(
      database
        .prepare(
          `SELECT ${AIONUI_APPROVAL_DECISION_COLUMNS}
           FROM aionui_approval_decisions
           WHERE delivery_state = 'pending-delivery'
           ORDER BY created_at, decision_id
           LIMIT ?`,
        )
        .all(limit),
    );
    return Object.freeze(rows.map(parseStoredAionUiApprovalDecision));
  }

  async summarizeAionUiApprovalAuthority(): Promise<AionUiApprovalAuthoritySummary> {
    const database = this.requireDatabase();
    const row = database
      .prepare(
        `SELECT
           COUNT(*) AS record_count,
           COALESCE(SUM(CASE WHEN delivery_state = 'pending-delivery' THEN 1 ELSE 0 END), 0)
             AS pending_count,
           COALESCE(SUM(CASE WHEN delivery_state = 'delivered' THEN 1 ELSE 0 END), 0)
             AS delivered_count
         FROM aionui_approval_decisions`,
      )
      .get() as SqliteRow;
    const summary = Object.freeze({
      recordCount: requiredNumber(row, "record_count"),
      pendingCount: requiredNumber(row, "pending_count"),
      deliveredCount: requiredNumber(row, "delivered_count"),
    });
    if (summary.recordCount !== summary.pendingCount + summary.deliveredCount) {
      throw new PersistenceError(
        "corrupt-database",
        "AionUi approval authority summary is inconsistent",
      );
    }
    return summary;
  }

  async persistWorkspaceGrant(grant: WorkspaceGrant): Promise<PersistWorkspaceGrantResult> {
    const database = this.requireDatabase();
    let stableGrant: WorkspaceGrant;
    try {
      assertWorkspaceGrant(grant);
      const normalized: unknown = JSON.parse(JSON.stringify(grant));
      assertWorkspaceGrant(normalized);
      stableGrant = deepFreeze(normalized);
    } catch (error) {
      throw normalizeWorkloadContractError(error, "Workspace grant");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(`SELECT ${WORKSPACE_GRANT_COLUMNS} FROM workspace_grants WHERE grant_id = ?`)
        .get(stableGrant.grantId) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existing = parseStoredWorkspaceGrant(existingRow);
        if (isDeepStrictEqual(existing, stableGrant)) {
          database.exec("COMMIT");
          return {
            status: "duplicate",
            grant: existing,
          };
        }

        const validRevocation =
          existing.workspaceId === stableGrant.workspaceId &&
          existing.rootPath === stableGrant.rootPath &&
          existing.displayName === stableGrant.displayName &&
          existing.createdAt === stableGrant.createdAt &&
          existing.state === "active" &&
          stableGrant.state === "revoked" &&
          compareInstants(stableGrant.updatedAt, existing.updatedAt) >= 0;
        if (!validRevocation) {
          throw new PersistenceError(
            "workspace-grant-conflict",
            "Workspace grant identifier conflicts with immutable grant evidence",
          );
        }

        database
          .prepare(
            `UPDATE workspace_grants
             SET state = ?, updated_at = ?, grant_json = ?
             WHERE grant_id = ?`,
          )
          .run(
            stableGrant.state,
            stableGrant.updatedAt,
            JSON.stringify(stableGrant),
            stableGrant.grantId,
          );
        database.exec("COMMIT");
        return {
          status: "updated",
          grant: stableGrant,
        };
      }

      const workspace = database
        .prepare("SELECT id FROM workspaces WHERE id = ?")
        .get(stableGrant.workspaceId);
      if (workspace === undefined) {
        throw new PersistenceError(
          "domain-reference",
          "Workspace grant does not reference a persisted workspace",
        );
      }
      assertCanonicalWorkspaceRoot(stableGrant.rootPath);

      if (stableGrant.state === "active") {
        const active = database
          .prepare(
            "SELECT grant_id FROM workspace_grants WHERE workspace_id = ? AND state = 'active'",
          )
          .get(stableGrant.workspaceId);
        if (active !== undefined) {
          throw new PersistenceError(
            "workspace-grant-conflict",
            "Workspace already has an active grant",
          );
        }
      }

      database
        .prepare(
          `INSERT INTO workspace_grants (
             grant_id, contract_version, workspace_id, root_path, display_name,
             state, created_at, updated_at, grant_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          stableGrant.grantId,
          stableGrant.contractVersion,
          stableGrant.workspaceId,
          stableGrant.rootPath,
          stableGrant.displayName,
          stableGrant.state,
          stableGrant.createdAt,
          stableGrant.updatedAt,
          JSON.stringify(stableGrant),
        );
      database.exec("COMMIT");
      return {
        status: "stored",
        grant: stableGrant,
      };
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not persist the workspace grant",
        {
          cause: error,
        },
      );
    }
  }

  async getActiveWorkspaceGrant(
    workspaceIdValue: ReturnType<typeof workspaceId>,
  ): Promise<WorkspaceGrant | null> {
    const database = this.requireDatabase();
    try {
      workspaceId(workspaceIdValue);
    } catch (error) {
      throw new PersistenceError("invalid-record", "Workspace grant lookup is invalid", {
        cause: error,
      });
    }

    const row = database
      .prepare(
        `SELECT ${WORKSPACE_GRANT_COLUMNS}
         FROM workspace_grants
         WHERE workspace_id = ? AND state = 'active'
           AND EXISTS (
             SELECT 1 FROM workspaces WHERE workspaces.id = workspace_grants.workspace_id
           )`,
      )
      .get(workspaceIdValue) as SqliteRow | undefined;
    return row === undefined ? null : parseStoredWorkspaceGrant(row);
  }

  async storeContentReference(
    input: StoreContentReferenceInput,
  ): Promise<PersistContentReferenceResult> {
    const database = this.requireDatabase();
    let stableInput: StoreContentReferenceInput;
    try {
      assertStoreContentReferenceInput(input);
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertStoreContentReferenceInput(normalized);
      stableInput = deepFreeze(normalized);
    } catch (error) {
      throw normalizeWorkloadContractError(error, "Content reference input");
    }

    const bytes = Buffer.from(stableInput.content, "utf8");
    const metadata = deepFreeze({
      contractVersion: stableInput.contractVersion,
      reference: stableInput.reference,
      kind: stableInput.kind,
      owner: structuredClone(stableInput.owner),
      classification: stableInput.classification,
      mediaType: stableInput.mediaType,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt: stableInput.createdAt,
      ...(stableInput.expiresAt === undefined ? {} : { expiresAt: stableInput.expiresAt }),
    } satisfies ContentReferenceMetadata);
    assertContentReferenceMetadata(metadata);

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingRow = database
        .prepare(
          `SELECT ${CONTENT_REFERENCE_COLUMNS}
           FROM content_references
           WHERE reference = ?`,
        )
        .get(stableInput.reference) as SqliteRow | undefined;
      if (existingRow !== undefined) {
        const existingMetadata = parseStoredContentMetadata(existingRow);
        const existingContent = decodeStoredContent(existingRow, existingMetadata);
        if (
          isDeepStrictEqual(
            immutableContentMetadata(existingMetadata),
            immutableContentMetadata(metadata),
          ) &&
          existingContent === stableInput.content
        ) {
          database.exec("COMMIT");
          return {
            status: "duplicate",
            metadata: existingMetadata,
          };
        }
        throw new PersistenceError(
          "content-conflict",
          "Content reference identifier conflicts with immutable content",
        );
      }

      const identity = database
        .prepare(
          `SELECT
             sessions.workspace_id,
             sessions.task_id,
             sessions.worker_id,
             tasks.workspace_id AS task_workspace_id,
             workers.workspace_id AS worker_workspace_id
           FROM sessions
           JOIN tasks ON tasks.id = sessions.task_id
           JOIN workers ON workers.id = sessions.worker_id
           JOIN workspaces ON workspaces.id = sessions.workspace_id
           WHERE sessions.id = ?`,
        )
        .get(stableInput.owner.sessionId) as SqliteRow | undefined;
      if (
        identity === undefined ||
        requiredString(identity, "workspace_id") !== stableInput.owner.workspaceId ||
        requiredString(identity, "task_id") !== stableInput.owner.taskId ||
        requiredString(identity, "worker_id") !== stableInput.owner.workerId ||
        requiredString(identity, "task_workspace_id") !== stableInput.owner.workspaceId ||
        requiredString(identity, "worker_workspace_id") !== stableInput.owner.workspaceId
      ) {
        throw new PersistenceError(
          "domain-reference",
          "Content reference owner does not match the persisted domain graph",
        );
      }

      if (stableInput.owner.grantId !== undefined) {
        const grantRow = database
          .prepare(`SELECT ${WORKSPACE_GRANT_COLUMNS} FROM workspace_grants WHERE grant_id = ?`)
          .get(stableInput.owner.grantId) as SqliteRow | undefined;
        if (grantRow === undefined) {
          throw new PersistenceError(
            "domain-reference",
            "Content reference does not match a workspace grant",
          );
        }
        const grant = parseStoredWorkspaceGrant(grantRow);
        if (grant.workspaceId !== stableInput.owner.workspaceId || grant.state !== "active") {
          throw new PersistenceError(
            "domain-reference",
            "Content reference workspace grant is not active for its owner",
          );
        }
      }

      database
        .prepare(
          `INSERT INTO content_references (
             reference, contract_version, kind, workspace_id, task_id, session_id,
             worker_id, request_id, grant_id, classification, media_type,
             byte_length, sha256, created_at, expires_at, consumed_at,
             metadata_json, content_blob
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .run(
          metadata.reference,
          metadata.contractVersion,
          metadata.kind,
          metadata.owner.workspaceId,
          metadata.owner.taskId,
          metadata.owner.sessionId,
          metadata.owner.workerId,
          metadata.owner.requestId ?? null,
          metadata.owner.grantId ?? null,
          metadata.classification,
          metadata.mediaType,
          metadata.byteLength,
          metadata.sha256,
          metadata.createdAt,
          metadata.expiresAt ?? null,
          JSON.stringify(metadata),
          bytes,
        );
      database.exec("COMMIT");
      return {
        status: "stored",
        metadata,
      };
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not store the content reference",
        {
          cause: error,
        },
      );
    }
  }

  async resolveContentReference(
    input: ResolveContentReferenceInput,
  ): Promise<ResolvedContentReference> {
    const database = this.requireDatabase();
    let stableInput: ResolveContentReferenceInput;
    try {
      assertResolveContentReferenceInput(input);
      const normalized: unknown = JSON.parse(JSON.stringify(input));
      assertResolveContentReferenceInput(normalized);
      stableInput = deepFreeze(normalized);
    } catch (error) {
      throw normalizeWorkloadContractError(error, "Content reference resolution");
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database
        .prepare(
          `SELECT ${CONTENT_REFERENCE_COLUMNS}
           FROM content_references
           WHERE reference = ?`,
        )
        .get(stableInput.reference) as SqliteRow | undefined;
      if (row === undefined) {
        throw new PersistenceError("content-not-found", "Content reference does not exist");
      }

      let metadata = parseStoredContentMetadata(row);
      const content = decodeStoredContent(row, metadata);
      if (
        metadata.kind !== stableInput.kind ||
        !isDeepStrictEqual(metadata.owner, stableInput.owner)
      ) {
        throw new PersistenceError(
          "content-ownership",
          "Content reference does not belong to the requested owner",
        );
      }
      if (
        metadata.classification === "workspace-content" &&
        database
          .prepare("SELECT 1 FROM workspaces WHERE id = ?")
          .get(metadata.owner.workspaceId) === undefined
      ) {
        throw new PersistenceError(
          "content-ownership",
          "Workspace content no longer belongs to a current Actestra workspace record",
        );
      }
      if (compareInstants(stableInput.resolvedAt, metadata.createdAt) < 0) {
        throw new PersistenceError(
          "invalid-record",
          "Content reference cannot be resolved before creation",
        );
      }
      if (
        metadata.consumedAt !== undefined &&
        compareInstants(stableInput.resolvedAt, metadata.consumedAt) < 0
      ) {
        throw new PersistenceError(
          "invalid-record",
          "Content reference resolution time cannot move backwards",
        );
      }
      if (
        metadata.expiresAt !== undefined &&
        compareInstants(stableInput.resolvedAt, metadata.expiresAt) >= 0
      ) {
        throw new PersistenceError("content-expired", "Content reference has expired");
      }

      if (stableInput.consume && metadata.consumedAt === undefined) {
        metadata = deepFreeze({
          ...metadata,
          consumedAt: stableInput.resolvedAt,
        });
        assertContentReferenceMetadata(metadata);
        database
          .prepare(
            `UPDATE content_references
             SET consumed_at = ?, metadata_json = ?
             WHERE reference = ?`,
          )
          .run(stableInput.resolvedAt, JSON.stringify(metadata), stableInput.reference);
      }

      database.exec("COMMIT");
      return deepFreeze({
        metadata,
        content,
      });
    } catch (error) {
      rollback(database);
      if (error instanceof PersistenceError) {
        throw error;
      }
      throw new PersistenceError(
        "corrupt-database",
        "Actestra could not resolve the content reference",
        {
          cause: error,
        },
      );
    }
  }

  async close(): Promise<void> {
    const database = this.database;
    if (database === null) {
      return;
    }

    this.database = null;
    this.streamStates.clear();
    database.close();
  }
}

export function openSqliteCorePersistence(userDataPath: string): ActestraPersistencePort {
  const databasePath = resolveCoreDatabasePath(userDataPath);
  assertPrivateDirectory(path.dirname(databasePath));

  if (fs.existsSync(databasePath)) {
    assertDatabaseFile(databasePath);
  }

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
    });
    assertDatabaseFile(databasePath);
    configureDatabase(database);
    migrateSqliteDatabase(database);
    return new SqliteCorePersistence(database);
  } catch (error) {
    try {
      database?.close();
    } catch {
      // Preserve the original open or migration error.
    }

    if (error instanceof PersistenceError || error instanceof CoreContractError) {
      throw error;
    }

    throw new PersistenceError(
      "corrupt-database",
      "Actestra could not open or verify its SQLite database",
      {
        cause: error,
      },
    );
  }
}
