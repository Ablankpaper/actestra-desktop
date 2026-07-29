import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PersistenceError } from "../../core";

export const ACTESTRA_SQLITE_APPLICATION_ID = 1_095_980_114;
export const CURRENT_CORE_SCHEMA_VERSION = 5;

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface SqliteMigrationResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedVersions: readonly number[];
}

export const CORE_SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "domain-graph",
    sql: `
      CREATE TABLE actestra_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        adapter_kind TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('created', 'starting', 'ready', 'busy', 'stopping', 'stopped', 'crashed')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('draft', 'ready', 'running', 'blocked', 'completed', 'failed', 'cancelled')
        ),
        active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (
          state IN ('created', 'starting', 'running', 'blocked', 'completed', 'failed', 'cancelled')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('pending', 'approved', 'denied', 'expired', 'cancelled')
        ),
        requested_at TEXT NOT NULL,
        expires_at TEXT,
        resolved_at TEXT
      ) STRICT;

      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'document', 'dataset', 'directory', 'other')),
        label TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('available', 'superseded')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sessions_task_id_idx ON sessions(task_id);
      CREATE INDEX approvals_task_id_idx ON approvals(task_id);
      CREATE INDEX artifacts_task_id_idx ON artifacts(task_id);
    `,
  },
  {
    version: 2,
    name: "ordered-core-events",
    sql: `
      CREATE TABLE core_events (
        event_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        occurred_at TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        type TEXT NOT NULL,
        redaction TEXT NOT NULL CHECK (
          redaction IN ('metadata', 'workspace-content', 'sensitive-reference')
        ),
        envelope_json TEXT NOT NULL,
        UNIQUE (stream_id, sequence)
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: "platform-evidence",
    sql: `
      CREATE TABLE privileged_audit_records (
        sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
        record_id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        request_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        event_type TEXT NOT NULL,
        redaction TEXT NOT NULL CHECK (redaction = 'metadata'),
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX privileged_audit_request_idx
        ON privileged_audit_records(request_id, sequence);

      CREATE TABLE agent_attempt_evidence (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'completed',
            'failed',
            'cancelled',
            'crashed',
            'timed-out',
            'protocol-failed'
          )
        ),
        last_core_event_sequence INTEGER NOT NULL CHECK (last_core_event_sequence >= 0),
        incident_code TEXT,
        redaction TEXT NOT NULL CHECK (redaction = 'metadata'),
        evidence_json TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "aionui-shadow-evidence",
    sql: `
      CREATE TABLE aionui_shadow_evidence (
        sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
        evidence_id TEXT NOT NULL UNIQUE,
        captured_at TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source = 'aionui-v2.1.41'),
        domain TEXT NOT NULL CHECK (
          domain IN (
            'conversation',
            'task',
            'provider',
            'workspace',
            'approval',
            'artifact',
            'runtime'
          )
        ),
        native_identity_hash TEXT NOT NULL,
        native_revision_hash TEXT NOT NULL,
        redaction TEXT NOT NULL CHECK (redaction = 'metadata-only'),
        evidence_json TEXT NOT NULL,
        UNIQUE (domain, native_identity_hash, native_revision_hash)
      ) STRICT;

      CREATE INDEX aionui_shadow_domain_sequence_idx
        ON aionui_shadow_evidence(domain, sequence);
    `,
  },
  {
    version: 5,
    name: "aionui-approval-authority",
    sql: `
      CREATE TABLE aionui_approval_decisions (
        decision_id TEXT PRIMARY KEY,
        native_conversation_id TEXT NOT NULL,
        native_call_id TEXT NOT NULL,
        native_message_id TEXT NOT NULL,
        native_path TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (
          decision IN ('approved', 'denied', 'cancelled', 'selected')
        ),
        always_allow INTEGER NOT NULL CHECK (always_allow IN (0, 1)),
        delivery_state TEXT NOT NULL CHECK (
          delivery_state IN ('pending-delivery', 'delivered')
        ),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_attempt_at TEXT,
        delivered_at TEXT,
        last_error_code TEXT,
        delivery_body_json TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE (native_conversation_id, native_call_id)
      ) STRICT;

      CREATE INDEX aionui_approval_delivery_state_idx
        ON aionui_approval_decisions(delivery_state, created_at);
    `,
  },
] as const;

interface MigrationHistoryRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

function pragmaNumber(database: DatabaseSync, name: "application_id" | "user_version"): number {
  const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PersistenceError("corrupt-database", `SQLite PRAGMA ${name} is invalid`);
  }

  return value;
}

function userTableNames(database: DatabaseSync): readonly string[] {
  return database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map((row) => {
      const name = (row as Record<string, unknown>).name;
      if (typeof name !== "string") {
        throw new PersistenceError("corrupt-database", "SQLite schema contains an invalid name");
      }
      return name;
    });
}

function migrationChecksum(migration: SqliteMigration): string {
  return createHash("sha256")
    .update(`${migration.version}\n${migration.name}\n${migration.sql}`)
    .digest("hex");
}

function validateRegistry(migrations: readonly SqliteMigration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;

    if (
      migration.version !== expectedVersion ||
      !Number.isSafeInteger(migration.version) ||
      migration.name.trim().length === 0 ||
      migration.sql.trim().length === 0
    ) {
      throw new PersistenceError(
        "migration-registry",
        `SQLite migration registry must contain contiguous immutable versions; expected ${expectedVersion}`,
      );
    }
  }
}

function readMigrationHistory(database: DatabaseSync): readonly MigrationHistoryRow[] {
  try {
    return database
      .prepare(
        `SELECT version, name, checksum
         FROM actestra_schema_migrations
         ORDER BY version`,
      )
      .all()
      .map((row) => {
        const record = row as Record<string, unknown>;

        if (
          typeof record.version !== "number" ||
          typeof record.name !== "string" ||
          typeof record.checksum !== "string"
        ) {
          throw new PersistenceError(
            "migration-history",
            "Actestra migration history contains an invalid row",
          );
        }

        return {
          version: record.version,
          name: record.name,
          checksum: record.checksum,
        };
      });
  } catch (error) {
    if (error instanceof PersistenceError) {
      throw error;
    }

    throw new PersistenceError(
      "migration-history",
      "Actestra migration history is missing or unreadable",
      {
        cause: error,
      },
    );
  }
}

function verifyMigrationHistory(
  database: DatabaseSync,
  migrations: readonly SqliteMigration[],
  currentVersion: number,
): void {
  const history = readMigrationHistory(database);

  if (history.length !== currentVersion) {
    throw new PersistenceError(
      "migration-history",
      `Actestra schema version ${currentVersion} requires exactly ${currentVersion} history rows`,
    );
  }

  for (let index = 0; index < history.length; index += 1) {
    const recorded = history[index];
    const expected = migrations[index];

    if (
      expected === undefined ||
      recorded.version !== expected.version ||
      recorded.name !== expected.name ||
      recorded.checksum !== migrationChecksum(expected)
    ) {
      throw new PersistenceError(
        "migration-history",
        `Actestra migration history does not match registered migration ${index + 1}`,
      );
    }
  }
}

function verifyDatabaseIntegrity(database: DatabaseSync): void {
  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw new PersistenceError(
      "corrupt-database",
      `Actestra database contains ${foreignKeyViolations.length} foreign-key violation(s)`,
    );
  }

  const quickCheck = database.prepare("PRAGMA quick_check").get() as
    | Record<string, unknown>
    | undefined;
  if (quickCheck === undefined || Object.values(quickCheck)[0] !== "ok") {
    throw new PersistenceError("corrupt-database", "Actestra database failed PRAGMA quick_check");
  }
}

function rollbackMigration(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original migration error remains the authoritative failure.
  }
}

function applyMigration(
  database: DatabaseSync,
  migration: SqliteMigration,
  appliedAt: string,
): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(migration.sql);
    database
      .prepare(
        `INSERT INTO actestra_schema_migrations (version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(migration.version, migration.name, migrationChecksum(migration), appliedAt);
    database.exec(`PRAGMA application_id = ${ACTESTRA_SQLITE_APPLICATION_ID}`);
    database.exec(`PRAGMA user_version = ${migration.version}`);

    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new PersistenceError(
        "corrupt-database",
        `Actestra migration ${migration.version} introduced foreign-key violations`,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    rollbackMigration(database);
    throw new PersistenceError(
      "corrupt-database",
      `Actestra migration ${migration.version} (${migration.name}) failed`,
      {
        cause: error,
      },
    );
  }
}

export function migrateSqliteDatabase(
  database: DatabaseSync,
  migrations: readonly SqliteMigration[] = CORE_SQLITE_MIGRATIONS,
  appliedAt = new Date().toISOString(),
): SqliteMigrationResult {
  validateRegistry(migrations);

  const applicationId = pragmaNumber(database, "application_id");
  const fromVersion = pragmaNumber(database, "user_version");
  const targetVersion = migrations.at(-1)?.version ?? 0;
  const tables = userTableNames(database);

  if (applicationId !== 0 && applicationId !== ACTESTRA_SQLITE_APPLICATION_ID) {
    throw new PersistenceError(
      "foreign-database",
      `SQLite application ID ${applicationId} does not belong to Actestra`,
    );
  }

  if (applicationId === 0 && (fromVersion !== 0 || tables.length > 0)) {
    throw new PersistenceError(
      "unowned-database",
      "Actestra will not adopt a populated or versioned database without its application ID",
    );
  }

  if (applicationId === ACTESTRA_SQLITE_APPLICATION_ID && fromVersion === 0) {
    throw new PersistenceError(
      "migration-history",
      "An Actestra-owned database cannot have schema version 0",
    );
  }

  if (fromVersion > targetVersion) {
    throw new PersistenceError(
      "future-schema",
      `Actestra database schema ${fromVersion} is newer than supported schema ${targetVersion}`,
    );
  }

  if (fromVersion > 0) {
    verifyMigrationHistory(database, migrations, fromVersion);
  }

  const appliedVersions: number[] = [];
  for (const migration of migrations.slice(fromVersion)) {
    applyMigration(database, migration, appliedAt);
    appliedVersions.push(migration.version);
  }

  verifyMigrationHistory(database, migrations, targetVersion);
  verifyDatabaseIntegrity(database);

  return {
    fromVersion,
    toVersion: targetVersion,
    appliedVersions,
  };
}
