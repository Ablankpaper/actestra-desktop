import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import {
  CoreContractError,
  PersistenceError,
  advanceCoreEventStreamState,
  approvalId,
  artifactId,
  assertAgentAttemptEvidence,
  assertAppendPrivilegedAuditInput,
  assertAuditRecord,
  assertCoreEvent,
  assertDomainGraph,
  assertIdempotentCoreEventDelivery,
  auditRecordId,
  compareInstants,
  createCoreEventStreamState,
  eventStreamId,
  instant,
  replayCoreEvents,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type ApprovalState,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type AuditRecord,
  type ArtifactKind,
  type ArtifactState,
  type CoreEvent,
  type CoreEventCursor,
  type CoreEventStreamState,
  type CorePersistencePort,
  type DomainGraph,
  type EventStreamId,
  type PersistEvidenceResult,
  type PersistEventResult,
  type PlatformEvidencePersistencePort,
  type PrivilegedAuditSummary,
  type SessionState,
  type TaskState,
  type WorkerState,
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

export interface ActestraPersistencePort
  extends CorePersistencePort, PlatformEvidencePersistencePort {}

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
