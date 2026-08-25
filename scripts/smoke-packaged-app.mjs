import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appBundle = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, "release", "mac-arm64", "Actestra.app"),
);
const executable = path.join(appBundle, "Contents", "MacOS", "Actestra");
const isolationRoot = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "actestra-smoke-")),
);
const profileDirectory = path.join(isolationRoot, "user-data");
const homeDirectory = path.join(isolationRoot, "home");
const tempDirectory = path.join(isolationRoot, "temp");
for (const directory of [profileDirectory, homeDirectory, tempDirectory]) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}
const timeoutMilliseconds = 20_000;
const expectedPersistenceSchemaVersion = 23;
const readinessMarkers = Object.freeze([
  "ACTESTRA_GENERAL_WORKER_READY",
  "[Actestra persistence] Utility ready schema=23",
  "[Actestra] Main window created",
  "[AionUi] Renderer did-finish-load",
  "ACTESTRA_RENDERER_PROVIDER_SMOKE_READY",
  "startup: managed runtime background preparation completed",
]);
let output = "";
let childOutcome = null;
let resolveChildOutcome;

if (!fs.existsSync(executable)) {
  console.error(`Packaged smoke failed: executable is missing at ${executable}`);
  process.exit(1);
}

const child = spawn(executable, [], {
  env: {
    ...process.env,
    ACTESTRA_E2E_TEST: "1",
    ACTESTRA_DISABLE_AUTO_UPDATE: "1",
    ACTESTRA_USER_DATA_DIR: profileDirectory,
    ACTESTRA_E2E_ISOLATION_ROOT: isolationRoot,
    ACTESTRA_E2E_HOME_DIR: homeDirectory,
    ACTESTRA_E2E_TEMP_DIR: tempDirectory,
    HOME: homeDirectory,
    USERPROFILE: homeDirectory,
    TMPDIR: tempDirectory,
    TMP: tempDirectory,
    TEMP: tempDirectory,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const childOutcomePromise = new Promise((resolve) => {
  resolveChildOutcome = resolve;
});

function recordChildOutcome(outcome) {
  if (childOutcome === null) {
    childOutcome = outcome;
    resolveChildOutcome(outcome);
  }
}

child.once("error", (error) => {
  recordChildOutcome({ kind: "spawn-error", error });
});
child.once("exit", (code, signal) => {
  recordChildOutcome({ kind: "exit", code, signal });
});

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function describeChildOutcome(outcome) {
  if (outcome.kind === "spawn-error") {
    return `spawn error: ${outcome.error.message}`;
  }
  if (outcome.signal) {
    return `signal ${outcome.signal}`;
  }
  return `exit code ${outcome.code}`;
}

function hasReadinessMarkers() {
  return readinessMarkers.every((marker) => output.includes(marker));
}

async function terminateChild() {
  if (childOutcome !== null) {
    return childOutcome;
  }

  child.kill("SIGTERM");
  const gracefulOutcome = await Promise.race([childOutcomePromise, delay(2_000)]);
  if (gracefulOutcome) {
    return gracefulOutcome;
  }

  child.kill("SIGKILL");
  return childOutcomePromise;
}

async function finishWithFailure(message) {
  await terminateChild();
  console.error(`Packaged smoke failed: ${message}`);
  console.error(output.trim());
  console.error(`Isolated profile retained for inspection: ${profileDirectory}`);
  process.exit(1);
}

const startedAt = Date.now();
while (Date.now() - startedAt < timeoutMilliseconds && !hasReadinessMarkers()) {
  if (childOutcome !== null) {
    await finishWithFailure(
      `Actestra stopped before readiness: ${describeChildOutcome(childOutcome)}`,
    );
  }
  await delay(100);
}

if (!hasReadinessMarkers()) {
  await finishWithFailure("ready markers were not observed before timeout");
}

if (childOutcome !== null) {
  await finishWithFailure(
    `Actestra stopped before profile validation: ${describeChildOutcome(childOutcome)}`,
  );
}

const profileEntries = fs.readdirSync(profileDirectory);
if (profileEntries.some((entry) => entry.toLowerCase().includes("aionui"))) {
  await finishWithFailure("upstream application data appeared in the isolated profile");
}

let profileManifest;
try {
  profileManifest = JSON.parse(
    fs.readFileSync(path.join(profileDirectory, "actestra-profile.json"), "utf8"),
  );
} catch {
  await finishWithFailure("Actestra profile manifest is missing or unreadable");
}
if (
  Reflect.ownKeys(profileManifest).length !== 2 ||
  profileManifest.product !== "Actestra" ||
  profileManifest.layoutVersion !== 1
) {
  await finishWithFailure("Actestra profile manifest is invalid");
}

if (childOutcome !== null) {
  await finishWithFailure(
    `Actestra stopped before manifest validation completed: ${describeChildOutcome(childOutcome)}`,
  );
}

await terminateChild();

const databasePath = path.join(profileDirectory, "state", "actestra.sqlite3");
if (!fs.existsSync(databasePath)) {
  await finishWithFailure("persistence utility did not create the owned SQLite database");
}

let database;
try {
  database = new DatabaseSync(databasePath, {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  const versionRow = database.prepare("PRAGMA user_version").get();
  if (versionRow?.user_version !== expectedPersistenceSchemaVersion) {
    await finishWithFailure(
      `persistence utility database is not at schema version ${expectedPersistenceSchemaVersion}`,
    );
  }
  const workloadTables = database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name IN ('workspace_grants', 'content_references')
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
  if (
    workloadTables.length !== 2 ||
    workloadTables[0] !== "content_references" ||
    workloadTables[1] !== "workspace_grants"
  ) {
    await finishWithFailure("persistence utility workload tables are missing");
  }
} catch {
  await finishWithFailure("persistence utility database could not be verified");
} finally {
  database?.close();
}

console.info(
  `Packaged smoke passed: Actestra reached persistence utility, General Worker, application, window, and renderer ready markers with SQLite schema ${expectedPersistenceSchemaVersion}.`,
);
console.info(`Isolated profile: ${profileDirectory}`);
