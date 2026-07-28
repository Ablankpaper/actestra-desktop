import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import {
  CoreContractError,
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
const WORKSPACE_GRANT_COLUMNS = `
  grant_id, contract_version, workspace_id, root_path, display_name, state,
  created_at, updated_at, grant_json
`;
const CONTENT_REFERENCE_COLUMNS = `
  reference, contract_version, kind, workspace_id, task_id, session_id,
  worker_id, request_id, grant_id, classification, media_type, byte_length,
  sha256, created_at, expires_at, consumed_at, metadata_json, content_blob
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

  async getActiveWorkspaceGrant(workspaceIdValue: ReturnType<typeof workspaceId>) {
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
