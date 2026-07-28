import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronExecutable = require("electron");
const electronPackage = require(
  path.join(repositoryRoot, "node_modules", "electron", "package.json"),
);
const probePrefix = path.join(os.tmpdir(), "actestra-electron-sqlite-probe-");
const probeRoot = fs.mkdtempSync(probePrefix);
const databasePath = path.join(probeRoot, "runtime.sqlite3");
const outputMarker = "ACTESTRA_ELECTRON_SQLITE_PROBE ";

if (!probeRoot.startsWith(probePrefix)) {
  throw new Error(`Unexpected probe directory: ${probeRoot}`);
}

const EXPECTED_ELECTRON_VERSION = electronPackage.version;
const EXPECTED_NODE_VERSION = "22.21.1";
const EXPECTED_SQLITE_VERSION = "3.50.4";

const probeSource = String.raw`
const { DatabaseSync } = require("node:sqlite");

function pragmaValue(database, name) {
  const row = database.prepare("PRAGMA " + name).get();
  return Object.values(row)[0];
}

function rejects(operation) {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
}

const database = new DatabaseSync(process.env.ACTESTRA_SQLITE_PROBE_PATH, {
  allowExtension: false,
  enableDoubleQuotedStringLiterals: false,
  enableForeignKeyConstraints: true,
});

try {
  database.enableLoadExtension(false);
  database.exec([
    "PRAGMA trusted_schema = OFF",
    "PRAGMA synchronous = FULL",
    "PRAGMA busy_timeout = 5000",
  ].join(";"));
  const journalMode = pragmaValue(database, "journal_mode = DELETE");

  database.exec([
    "CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT",
    "CREATE TABLE child (" +
      "id INTEGER PRIMARY KEY, " +
      "parent_id INTEGER NOT NULL REFERENCES parent(id)" +
    ") STRICT",
    "CREATE TABLE rollback_probe (value TEXT NOT NULL) STRICT",
  ].join(";"));

  const foreignKeyRejected = rejects(() => {
    database.prepare("INSERT INTO child (id, parent_id) VALUES (?, ?)").run(1, 404);
  });
  const strictTypeRejected = rejects(() => {
    database.prepare("INSERT INTO parent (id) VALUES (?)").run("not-an-integer");
  });
  const doubleQuotedLiteralRejected = rejects(() => {
    database.prepare('SELECT "not-a-column"').get();
  });

  database.exec("BEGIN IMMEDIATE");
  database.prepare("INSERT INTO rollback_probe (value) VALUES (?)").run("must disappear");
  database.exec("ROLLBACK");

  const rollbackCount = database.prepare(
    "SELECT COUNT(*) AS count FROM rollback_probe",
  ).get().count;
  const result = {
    electron: process.versions.electron,
    node: process.versions.node,
    sqlite: database.prepare("SELECT sqlite_version() AS version").get().version,
    journalMode,
    foreignKeys: pragmaValue(database, "foreign_keys"),
    trustedSchema: pragmaValue(database, "trusted_schema"),
    synchronous: pragmaValue(database, "synchronous"),
    busyTimeout: pragmaValue(database, "busy_timeout"),
    quickCheck: pragmaValue(database, "quick_check"),
    foreignKeyRejected,
    strictTypeRejected,
    doubleQuotedLiteralRejected,
    rollbackCount,
  };
  console.log(${JSON.stringify(outputMarker)} + JSON.stringify(result));
} finally {
  database.close();
}
`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const result = spawnSync(electronExecutable, ["-e", probeSource], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ACTESTRA_SQLITE_PROBE_PATH: databasePath,
      ELECTRON_RUN_AS_NODE: "1",
    },
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  assert(result.error === undefined, `Electron SQLite probe could not start: ${result.error}`);
  assert(
    result.status === 0,
    `Electron SQLite probe exited with ${String(result.status)}:\n${result.stdout ?? ""}`,
  );

  const resultLine = result.stdout?.split(/\r?\n/).find((line) => line.startsWith(outputMarker));
  assert(resultLine !== undefined, "Electron SQLite probe did not emit its result marker");
  const probe = JSON.parse(resultLine.slice(outputMarker.length));

  assert(
    probe.electron === EXPECTED_ELECTRON_VERSION,
    `Expected Electron ${EXPECTED_ELECTRON_VERSION}, received ${String(probe.electron)}`,
  );
  assert(
    probe.node === EXPECTED_NODE_VERSION,
    `Expected embedded Node.js ${EXPECTED_NODE_VERSION}, received ${String(probe.node)}`,
  );
  assert(
    probe.sqlite === EXPECTED_SQLITE_VERSION,
    `Expected embedded SQLite ${EXPECTED_SQLITE_VERSION}, received ${String(probe.sqlite)}`,
  );
  assert(probe.journalMode === "delete", "SQLite must use DELETE journal mode");
  assert(probe.foreignKeys === 1, "SQLite foreign-key enforcement must be enabled");
  assert(probe.trustedSchema === 0, "SQLite trusted_schema must be disabled");
  assert(probe.synchronous === 2, "SQLite synchronous mode must be FULL");
  assert(probe.busyTimeout === 5_000, "SQLite busy timeout must be bounded at 5000 ms");
  assert(probe.quickCheck === "ok", "SQLite quick_check must pass");
  assert(probe.foreignKeyRejected === true, "SQLite must reject foreign-key violations");
  assert(probe.strictTypeRejected === true, "SQLite STRICT tables must reject invalid types");
  assert(
    probe.doubleQuotedLiteralRejected === true,
    "SQLite must reject double-quoted string literals",
  );
  assert(probe.rollbackCount === 0, "SQLite rollback must remove uncommitted writes");

  console.info(
    `Electron SQLite probe passed (Electron ${probe.electron}; Node.js ${probe.node}; SQLite ${probe.sqlite}; DELETE/FULL).`,
  );
} finally {
  fs.rmSync(probeRoot, {
    recursive: true,
    force: true,
  });
}
