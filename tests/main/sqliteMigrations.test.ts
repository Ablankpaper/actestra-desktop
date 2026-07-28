// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceError } from "../../apps/desktop/src/core";
import {
  ACTESTRA_SQLITE_APPLICATION_ID,
  CORE_SQLITE_MIGRATIONS,
  CURRENT_CORE_SCHEMA_VERSION,
  migrateSqliteDatabase,
  type SqliteMigration,
} from "../../apps/desktop/src/main/persistence/sqliteMigrations";

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
      appliedVersions: [1, 2, 3],
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
    ]);
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

    expect(migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT)).toEqual({
      fromVersion: 2,
      toVersion: 3,
      appliedVersions: [3],
    });
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
