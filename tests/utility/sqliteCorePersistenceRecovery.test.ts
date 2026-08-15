// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceError } from "../../apps/desktop/src/core";
import {
  CORE_DATABASE_FILENAME,
  CORE_DATABASE_MIGRATION_BACKUP_DIRECTORY,
  CORE_DATABASE_MIGRATION_RECOVERY_MANIFEST_FILENAME,
  openMigratedSqliteDatabase,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  ACTESTRA_SQLITE_APPLICATION_ID,
  CORE_SQLITE_MIGRATIONS,
  type SqliteMigration,
} from "../../apps/desktop/src/utility/persistence/sqliteMigrations";

const APPLIED_AT = "2026-08-16T08:00:00.000Z";
const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p7-3-persistence-"));
  testDirectories.push(directory);
  return directory;
}

function databaseValue(database: DatabaseSync, pragma: "application_id" | "user_version"): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown>;
  const value = Object.values(row)[0];
  if (typeof value !== "number") {
    throw new Error(`Expected numeric PRAGMA ${pragma}`);
  }
  return value;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createVersionOneDatabase(userDataPath: string): string {
  const databasePath = resolveCoreDatabasePath(userDataPath);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
  const database = openMigratedSqliteDatabase(databasePath, {
    migrations: [CORE_SQLITE_MIGRATIONS[0]],
    appliedAt: APPLIED_AT,
  });
  database
    .prepare(
      `INSERT INTO workspaces (id, name, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run("workspace-p7-3", "P7.3 recovery workspace", "active", APPLIED_AT, APPLIED_AT);
  database.close();
  return databasePath;
}

function expectVersionOneWorkspace(databasePath: string): void {
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    expect(databaseValue(database, "application_id")).toBe(ACTESTRA_SQLITE_APPLICATION_ID);
    expect(databaseValue(database, "user_version")).toBe(1);
    expect(
      database.prepare("SELECT name FROM workspaces WHERE id = ?").get("workspace-p7-3"),
    ).toEqual({ name: "P7.3 recovery workspace" });
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-p7-3-persistence-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Actestra SQLite P7.3 migration recovery", () => {
  it("restores the pre-migration database when an upgrade fails after the backup point", () => {
    const userDataPath = createTestDirectory();
    const databasePath = createVersionOneDatabase(userDataPath);
    const failingMigration: SqliteMigration = {
      version: 2,
      name: "p7-3-intentional-failure",
      sql: `
        CREATE TABLE migration_side_effect (id INTEGER PRIMARY KEY) STRICT;
        INSERT INTO missing_table_for_p7_3 (id) VALUES (1);
      `,
    };

    expect(() =>
      openMigratedSqliteDatabase(databasePath, {
        migrations: [CORE_SQLITE_MIGRATIONS[0], failingMigration],
        appliedAt: APPLIED_AT,
      }),
    ).toThrow(PersistenceError);

    expectVersionOneWorkspace(databasePath);
    const database = new DatabaseSync(databasePath);
    try {
      expect(
        database
          .prepare("SELECT name FROM sqlite_schema WHERE name = 'migration_side_effect'")
          .get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
    expect(
      fs.existsSync(
        path.join(path.dirname(databasePath), CORE_DATABASE_MIGRATION_RECOVERY_MANIFEST_FILENAME),
      ),
    ).toBe(false);
  });

  it("recovers a corrupted database from a pending pre-migration backup left by a crash", () => {
    const userDataPath = createTestDirectory();
    const databasePath = createVersionOneDatabase(userDataPath);
    const stateDirectory = path.dirname(databasePath);
    const backupDirectory = path.join(stateDirectory, CORE_DATABASE_MIGRATION_BACKUP_DIRECTORY);
    const backupBasename = `${CORE_DATABASE_FILENAME}.manual-p7-3-backup.sqlite3`;
    const backupPath = path.join(backupDirectory, backupBasename);
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    fs.copyFileSync(databasePath, backupPath);
    fs.writeFileSync(
      path.join(stateDirectory, CORE_DATABASE_MIGRATION_RECOVERY_MANIFEST_FILENAME),
      JSON.stringify({
        schemaVersion: 1,
        databaseBasename: CORE_DATABASE_FILENAME,
        backupRelativePath: `${CORE_DATABASE_MIGRATION_BACKUP_DIRECTORY}/${backupBasename}`,
        backupSha256: sha256(backupPath),
        fromVersion: 1,
        toVersion: 2,
        createdAt: APPLIED_AT,
      }),
    );
    fs.writeFileSync(databasePath, "not a sqlite database after simulated crash");

    const recovered = openMigratedSqliteDatabase(databasePath, {
      migrations: [CORE_SQLITE_MIGRATIONS[0]],
      appliedAt: APPLIED_AT,
    });
    recovered.close();

    expectVersionOneWorkspace(databasePath);
    expect(
      fs.existsSync(path.join(stateDirectory, CORE_DATABASE_MIGRATION_RECOVERY_MANIFEST_FILENAME)),
    ).toBe(false);
  });

  it("fails closed when a pending pre-migration backup fails integrity", () => {
    const userDataPath = createTestDirectory();
    const databasePath = createVersionOneDatabase(userDataPath);
    const stateDirectory = path.dirname(databasePath);
    const backupDirectory = path.join(stateDirectory, CORE_DATABASE_MIGRATION_BACKUP_DIRECTORY);
    const backupBasename = `${CORE_DATABASE_FILENAME}.tampered-p7-3-backup.sqlite3`;
    const backupPath = path.join(backupDirectory, backupBasename);
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    fs.copyFileSync(databasePath, backupPath);
    fs.writeFileSync(
      path.join(stateDirectory, CORE_DATABASE_MIGRATION_RECOVERY_MANIFEST_FILENAME),
      JSON.stringify({
        schemaVersion: 1,
        databaseBasename: CORE_DATABASE_FILENAME,
        backupRelativePath: `${CORE_DATABASE_MIGRATION_BACKUP_DIRECTORY}/${backupBasename}`,
        backupSha256: sha256(backupPath),
        fromVersion: 1,
        toVersion: 2,
        createdAt: APPLIED_AT,
      }),
    );
    fs.writeFileSync(backupPath, "tampered backup");
    fs.writeFileSync(databasePath, "not a sqlite database after simulated crash");

    expect(() =>
      openMigratedSqliteDatabase(databasePath, {
        migrations: [CORE_SQLITE_MIGRATIONS[0]],
        appliedAt: APPLIED_AT,
      }),
    ).toThrow(expect.objectContaining({ code: "corrupt-database" }));
    expect(
      fs.existsSync(path.join(stateDirectory, CORE_DATABASE_MIGRATION_RECOVERY_MANIFEST_FILENAME)),
    ).toBe(true);
  });
});
