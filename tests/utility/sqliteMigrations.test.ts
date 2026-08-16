// @vitest-environment node

import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceError } from "../../apps/desktop/src/core";
import {
  ACTESTRA_SQLITE_APPLICATION_ID,
  CORE_SQLITE_MIGRATIONS,
  CURRENT_CORE_SCHEMA_VERSION,
  migrateSqliteDatabase,
  type SqliteMigration,
} from "../../apps/desktop/src/utility/persistence/sqliteMigrations";

const databases: DatabaseSync[] = [];
const APPLIED_AT = "2026-07-28T08:00:00.000Z";

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:", {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  databases.push(database);
  return database;
}

function pragmaNumber(database: DatabaseSync, name: string): number {
  const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
  const value = Object.values(row)[0];

  if (typeof value !== "number") {
    throw new Error(`Expected numeric PRAGMA ${name}`);
  }

  return value;
}

function expectPersistenceError(operation: () => unknown, code: PersistenceError["code"]): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(PersistenceError);
    expect((error as PersistenceError).code).toBe(code);
    return;
  }

  throw new Error(`Expected PersistenceError with code ${code}`);
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe("Actestra SQLite migrations", () => {
  it("creates a fresh owned database at the current schema", () => {
    const database = createDatabase();

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT)).toEqual({
      fromVersion: 0,
      toVersion: CURRENT_CORE_SCHEMA_VERSION,
      appliedVersions: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
      ],
    });
    expect(pragmaNumber(database, "application_id")).toBe(ACTESTRA_SQLITE_APPLICATION_ID);
    expect(pragmaNumber(database, "user_version")).toBe(CURRENT_CORE_SCHEMA_VERSION);
    expect(
      database
        .prepare("SELECT version, name FROM actestra_schema_migrations ORDER BY version")
        .all(),
    ).toEqual([
      {
        version: 1,
        name: "domain-graph",
      },
      {
        version: 2,
        name: "ordered-core-events",
      },
      {
        version: 3,
        name: "platform-evidence",
      },
      {
        version: 4,
        name: "aionui-shadow-evidence",
      },
      {
        version: 5,
        name: "aionui-approval-authority",
      },
      {
        version: 6,
        name: "workload-content-and-grants",
      },
      {
        version: 7,
        name: "general-work-recovery-checkpoints",
      },
      {
        version: 8,
        name: "aionui-general-work-journeys",
      },
      {
        version: 9,
        name: "aionui-general-work-kinds",
      },
      {
        version: 10,
        name: "aionui-local-research-kind",
      },
      {
        version: 11,
        name: "aionui-writing-kind",
      },
      {
        version: 12,
        name: "aionui-office-document-kind",
      },
      {
        version: 13,
        name: "aionui-scheduled-general-work",
      },
      {
        version: 14,
        name: "team-plan-authority",
      },
      {
        version: 15,
        name: "team-run-authority",
      },
      {
        version: 16,
        name: "team-experience-authority",
      },
      {
        version: 17,
        name: "standard-team-message-delivery-authority",
      },
      {
        version: 18,
        name: "artifact-workspace-delivery",
      },
      {
        version: 19,
        name: "artifact-delivery-split-authority",
      },
      {
        version: 20,
        name: "artifact-delivery-patch-owner-identity",
      },
      {
        version: 21,
        name: "aionui-general-work-requirements",
      },
      {
        version: 22,
        name: "artifact-delivery-destination-workspace",
      },
      {
        version: 23,
        name: "privileged-audit-integrity-and-retention",
      },
    ]);
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'team_plans'")
        .get(),
    ).toEqual({ name: "team_plans" });
  });

  it("performs a real 1 -> 2 migration without losing version 1 data", () => {
    const database = createDatabase();

    migrateSqliteDatabase(database, [CORE_SQLITE_MIGRATIONS[0]], APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("workspace-preserved", "Preserved workspace", "active", APPLIED_AT, APPLIED_AT);

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 2), APPLIED_AT)).toEqual(
      {
        fromVersion: 1,
        toVersion: 2,
        appliedVersions: [2],
      },
    );
    expect(
      database.prepare("SELECT name FROM workspaces WHERE id = ?").get("workspace-preserved"),
    ).toEqual({
      name: "Preserved workspace",
    });
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get("core_events"),
    ).toEqual({
      name: "core_events",
    });
  });

  it("performs a real 2 -> 3 migration without replacing earlier tables", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 2), APPLIED_AT);

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 3), APPLIED_AT)).toEqual(
      {
        fromVersion: 2,
        toVersion: 3,
        appliedVersions: [3],
      },
    );
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN (
             'core_events',
             'privileged_audit_records',
             'agent_attempt_evidence'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "agent_attempt_evidence" },
      { name: "core_events" },
      { name: "privileged_audit_records" },
    ]);
  });

  it("performs a real 3 -> 4 migration without changing authoritative P3 tables", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 3), APPLIED_AT);

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 4), APPLIED_AT)).toEqual(
      {
        fromVersion: 3,
        toVersion: 4,
        appliedVersions: [4],
      },
    );
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN (
             'workspaces',
             'core_events',
             'privileged_audit_records',
             'aionui_shadow_evidence'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "aionui_shadow_evidence" },
      { name: "core_events" },
      { name: "privileged_audit_records" },
      { name: "workspaces" },
    ]);
  });

  it("performs a real 4 -> 5 migration without changing F2 shadow evidence", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 4), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO aionui_shadow_evidence (
           sequence, evidence_id, captured_at, source, domain,
           native_identity_hash, native_revision_hash, redaction, evidence_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        "shadow-preserved",
        APPLIED_AT,
        "aionui-v2.1.41",
        "provider",
        "identity-hash",
        "revision-hash",
        "metadata-only",
        "{}",
      );

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 5), APPLIED_AT)).toEqual(
      {
        fromVersion: 4,
        toVersion: 5,
        appliedVersions: [5],
      },
    );
    expect(database.prepare("SELECT evidence_id FROM aionui_shadow_evidence").all()).toEqual([
      { evidence_id: "shadow-preserved" },
    ]);
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name = 'aionui_approval_decisions'`,
        )
        .get(),
    ).toEqual({
      name: "aionui_approval_decisions",
    });
  });

  it("performs a real 5 -> 6 migration without changing approval authority", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 5), APPLIED_AT);
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
        "decision-preserved",
        "conversation-preserved",
        "call-preserved",
        "message-preserved",
        "confirm",
        "a".repeat(64),
        "approved",
        0,
        "pending-delivery",
        0,
        APPLIED_AT,
        APPLIED_AT,
        null,
        null,
        null,
        "{}",
        "{}",
      );

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 6), APPLIED_AT)).toEqual(
      {
        fromVersion: 5,
        toVersion: 6,
        appliedVersions: [6],
      },
    );
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN ('workspace_grants', 'content_references')
           ORDER BY name`,
        )
        .all(),
    ).toEqual([{ name: "content_references" }, { name: "workspace_grants" }]);
    expect(
      database
        .prepare("SELECT decision_id FROM aionui_approval_decisions WHERE decision_id = ?")
        .get("decision-preserved"),
    ).toEqual({
      decision_id: "decision-preserved",
    });
  });

  it("performs a real 6 -> 12 migration without changing content ownership", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 6), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO content_references (
           reference, contract_version, kind, workspace_id, task_id, session_id,
           worker_id, request_id, grant_id, classification, media_type,
           byte_length, sha256, created_at, expires_at, consumed_at,
           metadata_json, content_blob
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      )
      .run(
        "preserved-content-reference",
        1,
        "tool-output",
        "workspace-preserved-content",
        "task-preserved-content",
        "session-preserved-content",
        "worker-preserved-content",
        "request-preserved-content",
        "grant-preserved-content",
        "task-content",
        "text/plain; charset=utf-8",
        3,
        "a".repeat(64),
        APPLIED_AT,
        "{}",
        Buffer.from("old"),
      );

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 12), APPLIED_AT),
    ).toEqual({
      fromVersion: 6,
      toVersion: 12,
      appliedVersions: [7, 8, 9, 10, 11, 12],
    });
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN (
             'workspace_grants',
             'content_references',
             'general_work_checkpoints',
             'aionui_general_work_journeys'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "aionui_general_work_journeys" },
      { name: "content_references" },
      { name: "general_work_checkpoints" },
      { name: "workspace_grants" },
    ]);
    expect(
      database
        .prepare(
          `SELECT reference, media_type, hex(content_blob) AS content_hex
           FROM content_references
           WHERE reference = ?`,
        )
        .get("preserved-content-reference"),
    ).toEqual({
      reference: "preserved-content-reference",
      media_type: "text/plain; charset=utf-8",
      content_hex: "6F6C64",
    });

    const preview = Buffer.from('{"contractVersion":1}');
    expect(() =>
      database
        .prepare(
          `INSERT INTO content_references (
             reference, contract_version, kind, workspace_id, task_id, session_id,
             worker_id, request_id, grant_id, classification, media_type,
             byte_length, sha256, created_at, expires_at, consumed_at,
             metadata_json, content_blob
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          "office-preview-reference",
          1,
          "tool-output",
          "workspace-office-preview",
          "task-office-preview",
          "session-office-preview",
          "worker-office-preview",
          "request-office-preview",
          "grant-office-preview",
          "task-content",
          "application/vnd.actestra.office-document-preview+json",
          preview.byteLength,
          "b".repeat(64),
          APPLIED_AT,
          "{}",
          preview,
        ),
    ).not.toThrow();
  });

  it("migrates schema 8 journeys to the prompt-artifact kind", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 8), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("workspace-kind-migration", "Migration workspace", "active", APPLIED_AT, APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workers (id, workspace_id, adapter_kind, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "worker-kind-migration",
        "workspace-kind-migration",
        "actestra.general-worker",
        "created",
        APPLIED_AT,
        APPLIED_AT,
      );
    database
      .prepare(
        `INSERT INTO tasks (
           id, workspace_id, title, state, active_session_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        "task-kind-migration",
        "workspace-kind-migration",
        "Preserved prompt journey",
        "ready",
        APPLIED_AT,
        APPLIED_AT,
      );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run("task-kind-migration", 1, "a".repeat(64), APPLIED_AT);

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 9), APPLIED_AT)).toEqual(
      {
        fromVersion: 8,
        toVersion: 9,
        appliedVersions: [9],
      },
    );
    expect(
      database
        .prepare(
          `SELECT task_id, journey_kind
           FROM aionui_general_work_journeys`,
        )
        .all(),
    ).toEqual([
      {
        task_id: "task-kind-migration",
        journey_kind: "prompt-artifact",
      },
    ]);
  });

  it("expands schema 9 with only the declared local-research journey kind", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 9), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("workspace-research-migration", "Research workspace", "active", APPLIED_AT, APPLIED_AT);
    const insertTask = database.prepare(
      `INSERT INTO tasks (
         id, workspace_id, title, state, active_session_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    );
    insertTask.run(
      "task-existing-file-kind",
      "workspace-research-migration",
      "Existing file journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("task-existing-file-kind", 1, "b".repeat(64), "workspace-file-artifact", APPLIED_AT);

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 10), APPLIED_AT),
    ).toEqual({
      fromVersion: 9,
      toVersion: 10,
      appliedVersions: [10],
    });
    expect(
      database
        .prepare(
          `SELECT task_id, journey_kind
           FROM aionui_general_work_journeys`,
        )
        .all(),
    ).toEqual([
      {
        task_id: "task-existing-file-kind",
        journey_kind: "workspace-file-artifact",
      },
    ]);

    insertTask.run(
      "task-local-research-kind",
      "workspace-research-migration",
      "Local research journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("task-local-research-kind", 1, "c".repeat(64), "local-research-artifact", APPLIED_AT);
    insertTask.run(
      "task-invalid-research-kind",
      "workspace-research-migration",
      "Invalid research journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO aionui_general_work_journeys (
             task_id, contract_version, conversation_hash, journey_kind, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "task-invalid-research-kind",
          1,
          "d".repeat(64),
          "network-research-artifact",
          APPLIED_AT,
        ),
    ).toThrow();
  });

  it("expands schema 10 with only the declared writing journey kind", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 10), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("workspace-writing-migration", "Writing workspace", "active", APPLIED_AT, APPLIED_AT);
    const insertTask = database.prepare(
      `INSERT INTO tasks (
         id, workspace_id, title, state, active_session_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    );
    insertTask.run(
      "task-existing-research-kind",
      "workspace-writing-migration",
      "Existing research journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("task-existing-research-kind", 1, "e".repeat(64), "local-research-artifact", APPLIED_AT);

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 11), APPLIED_AT),
    ).toEqual({
      fromVersion: 10,
      toVersion: 11,
      appliedVersions: [11],
    });
    expect(
      database
        .prepare(
          `SELECT task_id, journey_kind
           FROM aionui_general_work_journeys`,
        )
        .all(),
    ).toEqual([
      {
        task_id: "task-existing-research-kind",
        journey_kind: "local-research-artifact",
      },
    ]);

    insertTask.run(
      "task-writing-kind",
      "workspace-writing-migration",
      "Writing journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("task-writing-kind", 1, "f".repeat(64), "writing-artifact", APPLIED_AT);
    insertTask.run(
      "task-invalid-writing-kind",
      "workspace-writing-migration",
      "Invalid writing journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO aionui_general_work_journeys (
             task_id, contract_version, conversation_hash, journey_kind, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("task-invalid-writing-kind", 1, "0".repeat(64), "office-artifact", APPLIED_AT),
    ).toThrow();
  });

  it("expands schema 11 with only the declared Office-document journey kind", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 11), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("workspace-office-migration", "Office workspace", "active", APPLIED_AT, APPLIED_AT);
    const insertTask = database.prepare(
      `INSERT INTO tasks (
         id, workspace_id, title, state, active_session_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    );
    insertTask.run(
      "task-existing-writing-kind",
      "workspace-office-migration",
      "Existing writing journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("task-existing-writing-kind", 1, "1".repeat(64), "writing-artifact", APPLIED_AT);

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 12), APPLIED_AT),
    ).toEqual({
      fromVersion: 11,
      toVersion: 12,
      appliedVersions: [12],
    });
    expect(
      database
        .prepare(
          `SELECT task_id, journey_kind
           FROM aionui_general_work_journeys`,
        )
        .all(),
    ).toEqual([
      {
        task_id: "task-existing-writing-kind",
        journey_kind: "writing-artifact",
      },
    ]);

    insertTask.run(
      "task-office-document-kind",
      "workspace-office-migration",
      "Office-document journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run("task-office-document-kind", 1, "2".repeat(64), "office-document-artifact", APPLIED_AT);
    insertTask.run(
      "task-invalid-office-kind",
      "workspace-office-migration",
      "Invalid Office journey",
      "ready",
      APPLIED_AT,
      APPLIED_AT,
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO aionui_general_work_journeys (
             task_id, contract_version, conversation_hash, journey_kind, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run("task-invalid-office-kind", 1, "3".repeat(64), "presentation-artifact", APPLIED_AT),
    ).toThrow();
  });

  it("adds schema 13 schedule authority without changing schema 12 Office rows", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 12), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO workspaces (id, name, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("workspace-schedule-migration", "Schedule workspace", "active", APPLIED_AT, APPLIED_AT);
    database
      .prepare(
        `INSERT INTO tasks (
           id, workspace_id, title, state, active_session_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        "task-office-before-schedule",
        "workspace-schedule-migration",
        "Office before schedule",
        "ready",
        APPLIED_AT,
        APPLIED_AT,
      );
    database
      .prepare(
        `INSERT INTO aionui_general_work_journeys (
           task_id, contract_version, conversation_hash, journey_kind, created_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "task-office-before-schedule",
        1,
        "4".repeat(64),
        "office-document-artifact",
        APPLIED_AT,
      );

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 13), APPLIED_AT),
    ).toEqual({
      fromVersion: 12,
      toVersion: 13,
      appliedVersions: [13],
    });
    expect(
      database
        .prepare(
          `SELECT task_id, journey_kind
           FROM aionui_general_work_journeys
           WHERE task_id = ?`,
        )
        .get("task-office-before-schedule"),
    ).toEqual({
      task_id: "task-office-before-schedule",
      journey_kind: "office-document-artifact",
    });
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name = 'aionui_schedule_jobs'`,
        )
        .get(),
    ).toEqual({ name: "aionui_schedule_jobs" });
    expect(
      database
        .prepare("SELECT name FROM pragma_table_info('aionui_schedule_jobs') ORDER BY cid")
        .all()
        .map((row) => (row as { name: string }).name),
    ).toEqual([
      "job_id",
      "contract_version",
      "conversation_hash",
      "native_conversation_id",
      "native_conversation_title",
      "workspace_id",
      "workspace_grant_id",
      "name",
      "description",
      "prompt",
      "schedule_kind",
      "schedule_value",
      "schedule_time_zone",
      "schedule_description",
      "enabled",
      "next_run_at_ms",
      "last_run_at_ms",
      "last_status",
      "last_incident_code",
      "active_claim",
      "active_claimed_at_ms",
      "run_sequence",
      "run_count",
      "retry_count",
      "max_retries",
      "queue_enabled",
      "created_at_ms",
      "updated_at_ms",
      "deleted_at_ms",
      "job_json",
    ]);
  });

  it("adds schema 14 team-plan authority without changing the schema 13 schedule table", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 13), APPLIED_AT);
    const scheduleSchema = database
      .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get("aionui_schedule_jobs");

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 14), APPLIED_AT),
    ).toEqual({
      fromVersion: 13,
      toVersion: 14,
      appliedVersions: [14],
    });
    expect(
      database
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get("aionui_schedule_jobs"),
    ).toEqual(scheduleSchema);
    expect(
      database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get("team_plans"),
    ).toEqual({ name: "team_plans" });
  });

  it("adds schema 15 Team definitions, current heads, and append-only revisions without changing schema 14 plans", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 14), APPLIED_AT);
    const planId = `team-plan-${"a".repeat(64)}`;
    const planJson = JSON.stringify({
      protocolVersion: 1,
      planId,
      correlationId: "correlation-schema-14-preserved",
      version: 1,
      goal: "Preserve the canonical admitted plan while adding Team run durability.",
      summary: "One schema 14 plan remains byte-identical.",
      limits: { maxNodes: 3, maxDepth: 2, maxConcurrency: 2, maxTotalAttempts: 3 },
      nodes: [],
    });
    const digest = createHash("sha256").update(planJson).digest("hex");
    database
      .prepare(
        `INSERT INTO team_plans (
           plan_id, protocol_version, correlation_id, plan_version, node_count,
           record_sha256, plan_json
         ) VALUES (?, 1, ?, 1, 3, ?, ?)`,
      )
      .run(planId, "correlation-schema-14-preserved", digest, planJson);

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 15), APPLIED_AT),
    ).toEqual({
      fromVersion: 14,
      toVersion: 15,
      appliedVersions: [15],
    });
    expect(
      database
        .prepare("SELECT plan_id, record_sha256, plan_json FROM team_plans WHERE plan_id = ?")
        .get(planId),
    ).toEqual({ plan_id: planId, record_sha256: digest, plan_json: planJson });
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN ('team_definitions', 'team_runs', 'team_run_revisions')
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "team_definitions" },
      { name: "team_run_revisions" },
      { name: "team_runs" },
    ]);
  });

  it("adds schema 16 Team experience authority without guessing existing Team types", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 15), APPLIED_AT);

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 16), APPLIED_AT),
    ).toEqual({
      fromVersion: 15,
      toVersion: 16,
      appliedVersions: [16],
    });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'team_experience_bindings'",
        )
        .get(),
    ).toEqual({ name: "team_experience_bindings" });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM team_experience_bindings").get(),
    ).toEqual({
      count: 0,
    });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'team_definitions'",
        )
        .get(),
    ).toEqual({ name: "team_definitions" });
  });

  it("adds schema 17 metadata-only standard Team message delivery authority", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 16), APPLIED_AT);

    expect(
      migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 17), APPLIED_AT),
    ).toEqual({
      fromVersion: 16,
      toVersion: 17,
      appliedVersions: [17],
    });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'standard_team_message_deliveries'",
        )
        .get(),
    ).toEqual({ name: "standard_team_message_deliveries" });
    const columns = database
      .prepare("PRAGMA table_info(standard_team_message_deliveries)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual([
      "delivery_id",
      "contract_version",
      "client_request_nonce",
      "request_sha256",
      "team_id",
      "target_slot_id",
      "state",
      "provider_enqueue_status",
      "provider_message_id",
      "provider_run_id",
      "created_at",
      "updated_at",
      "delivery_json",
    ]);
    expect(columns).not.toContain("content");
    expect(columns).not.toContain("files");
  });

  it("adds schema 18 artifact workspace delivery state that survives restart", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 17), APPLIED_AT);

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT)).toEqual({
      fromVersion: 17,
      toVersion: 23,
      appliedVersions: [18, 19, 20, 21, 22, 23],
    });
    const columns = database
      .prepare("PRAGMA table_info(artifact_deliveries)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual([
      "artifact_id",
      "contract_version",
      "workspace_id",
      "task_id",
      "session_id",
      "state",
      "patch_owner_grant_id",
      "destination_grant_id",
      "patch_reference",
      "patch_sha256",
      "patch_byte_length",
      "base_commit",
      "changed_file_count",
      "approval_id",
      "verified_head",
      "failure_code",
      "failure_message",
      "created_at",
      "updated_at",
      // Schema 20: the authority the patch was stored under, so a later read names it instead of
      // guessing a constant that could never validate.
      "patch_owner_worker_id",
      "patch_request_id",
      "destination_workspace_id",
    ]);
    // The delivery row references stored patch content, never a worktree path or patch body.
    expect(columns).not.toContain("patch");
    expect(columns).not.toContain("patch_content");
    expect(columns).not.toContain("worktree_root");
  });

  it("keeps artifact delivery terminal evidence consistent at schema 18", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 19), APPLIED_AT);
    database.exec(`
      INSERT INTO workspaces (id, name, state, created_at, updated_at)
        VALUES ('workspace-1', 'Workspace', 'active', '${APPLIED_AT}', '${APPLIED_AT}');
      INSERT INTO tasks (id, workspace_id, title, state, created_at, updated_at)
        VALUES ('task-1', 'workspace-1', 'Task', 'running', '${APPLIED_AT}', '${APPLIED_AT}');
      INSERT INTO artifacts (id, workspace_id, task_id, kind, label, state, created_at, updated_at)
        VALUES ('artifact-1', 'workspace-1', 'task-1', 'file', 'Actestra coding patch', 'available', '${APPLIED_AT}', '${APPLIED_AT}');
    `);
    const insert = (columns: string, values: string) =>
      database.exec(
        `INSERT INTO artifact_deliveries (artifact_id, contract_version, workspace_id, task_id, state, patch_owner_grant_id, patch_reference, patch_sha256, patch_byte_length, base_commit, changed_file_count, created_at, updated_at${columns})
         VALUES ('artifact-1', 2, 'workspace-1', 'task-1', ${values}, 'grant-1', 'tool-output:patch', '${"a".repeat(64)}', 12, '${"b".repeat(40)}', 1, '${APPLIED_AT}', '${APPLIED_AT}'${columns === "" ? "" : ""})`,
      );

    // applied requires the resulting commit; pending must not carry one
    expect(() => insert("", "'applied'")).toThrow();
    expect(() =>
      database.exec(
        `INSERT INTO artifact_deliveries (artifact_id, contract_version, workspace_id, task_id, state, patch_owner_grant_id, patch_reference, patch_sha256, patch_byte_length, base_commit, changed_file_count, created_at, updated_at, verified_head)
         VALUES ('artifact-1', 2, 'workspace-1', 'task-1', 'pending', 'grant-1', 'tool-output:patch', '${"a".repeat(64)}', 12, '${"b".repeat(40)}', 1, '${APPLIED_AT}', '${APPLIED_AT}', '${"c".repeat(40)}')`,
      ),
    ).toThrow();
    // conflict/failed require a bounded failure code
    expect(() => insert("", "'conflict'")).toThrow();
    // pending is a legal resting state and survives as-is
    insert("", "'pending'");
    expect(database.prepare("SELECT state, verified_head FROM artifact_deliveries").get()).toEqual({
      state: "pending",
      verified_head: null,
    });
  });

  it("adds schema 23 privileged-audit integrity and singleton retention state", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 22), APPLIED_AT);
    database
      .prepare(
        `INSERT INTO privileged_audit_records (
           sequence, record_id, occurred_at, request_id, workspace_id, task_id,
           session_id, worker_id, tool_id, action, resource_kind, event_type,
           redaction, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        1,
        "audit-schema-22",
        APPLIED_AT,
        "request-schema-22",
        "workspace-schema-22",
        "task-schema-22",
        "session-schema-22",
        "worker-schema-22",
        "tool-schema-22",
        "workspace.read",
        "workspace",
        "tool.completed",
        "metadata",
        JSON.stringify({ legacy: true }),
      );

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT)).toEqual({
      fromVersion: 22,
      toVersion: 23,
      appliedVersions: [23],
    });
    expect(
      database
        .prepare(
          `SELECT name
           FROM sqlite_schema
           WHERE type = 'table' AND name IN (
             'privileged_audit_integrity',
             'privileged_audit_retention_state'
           )
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "privileged_audit_integrity" },
      { name: "privileged_audit_retention_state" },
    ]);
    expect(
      database.prepare("SELECT * FROM privileged_audit_retention_state WHERE singleton = 1").get(),
    ).toEqual({
      singleton: 1,
      contract_version: 1,
      policy_version: 1,
      max_age_days: 90,
      max_record_count: 100_000,
      pruned_record_count: 0,
      anchor_sequence: 0,
      anchor_sha256: "4eab5dc1aa1804c942a382c85b6c77673f44b46cae57082957c1ffc0a9af61c1",
      last_sequence: 1,
      chain_head_sha256: "4eab5dc1aa1804c942a382c85b6c77673f44b46cae57082957c1ffc0a9af61c1",
      last_maintained_at: "1970-01-01T00:00:00.000Z",
    });
    expect(database.prepare("SELECT record_id FROM privileged_audit_records").all()).toEqual([
      { record_id: "audit-schema-22" },
    ]);
  });

  it("rejects a future schema without changing its version", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT);
    database.exec(`PRAGMA user_version = ${CURRENT_CORE_SCHEMA_VERSION + 1}`);

    expectPersistenceError(
      () => migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT),
      "future-schema",
    );
    expect(pragmaNumber(database, "user_version")).toBe(CURRENT_CORE_SCHEMA_VERSION + 1);
  });

  it("rejects foreign and populated unowned databases without adopting them", () => {
    const foreign = createDatabase();
    foreign.exec("PRAGMA application_id = 42");
    expectPersistenceError(
      () => migrateSqliteDatabase(foreign, CORE_SQLITE_MIGRATIONS, APPLIED_AT),
      "foreign-database",
    );
    expect(pragmaNumber(foreign, "application_id")).toBe(42);

    const populated = createDatabase();
    populated.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY) STRICT");
    expectPersistenceError(
      () => migrateSqliteDatabase(populated, CORE_SQLITE_MIGRATIONS, APPLIED_AT),
      "unowned-database",
    );
    expect(pragmaNumber(populated, "application_id")).toBe(0);
    expect(pragmaNumber(populated, "user_version")).toBe(0);
  });

  it("rolls back a failed migration including schema and history changes", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, [CORE_SQLITE_MIGRATIONS[0]], APPLIED_AT);
    const failingMigration: SqliteMigration = {
      version: 2,
      name: "intentionally-failing",
      sql: `
        CREATE TABLE must_rollback (id INTEGER PRIMARY KEY) STRICT;
        INSERT INTO table_that_does_not_exist (id) VALUES (1);
      `,
    };

    expect(() =>
      migrateSqliteDatabase(database, [CORE_SQLITE_MIGRATIONS[0], failingMigration], APPLIED_AT),
    ).toThrow(/migration 2/i);
    expect(pragmaNumber(database, "user_version")).toBe(1);
    expect(
      database.prepare("SELECT name FROM sqlite_schema WHERE name = 'must_rollback'").get(),
    ).toBeUndefined();
    expect(
      database.prepare("SELECT version FROM actestra_schema_migrations ORDER BY version").all(),
    ).toEqual([{ version: 1 }]);
  });

  it("rejects migration-history tampering and registry gaps", () => {
    const database = createDatabase();
    migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT);
    database
      .prepare("UPDATE actestra_schema_migrations SET checksum = ? WHERE version = ?")
      .run("tampered", 1);

    expectPersistenceError(
      () => migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT),
      "migration-history",
    );
    expectPersistenceError(
      () => migrateSqliteDatabase(createDatabase(), [CORE_SQLITE_MIGRATIONS[1]], APPLIED_AT),
      "migration-registry",
    );
  });
});
