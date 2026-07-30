import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const materializedRoot = path.resolve(
  process.argv[2] ?? path.join(repositoryRoot, ".actestra", "aionui-v2.1.41"),
);
const builtMain = path.join(materializedRoot, "out", "main", "index.js");
const materializedPackage = JSON.parse(
  fs.readFileSync(path.join(materializedRoot, "package.json"), "utf8"),
);
const expectedAionCoreVersion =
  typeof materializedPackage.aioncoreVersion === "string"
    ? materializedPackage.aioncoreVersion.replace(/^v/u, "")
    : "";
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-p4.6-smoke-"));
const markerPrefix = "ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_READY ";
const failureMarker = "ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_FAILED ";
const windowReadyMarker = "[Actestra] Main window created";
const rendererReadyMarker = "[AionUi] Renderer did-finish-load";
const maximumOutputBytes = 2 * 1_024 * 1_024;
const startupTimeoutMs = 60_000;
let succeeded = false;

function fail(message) {
  throw new Error(message);
}

function requireFile(filePath, label) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} is missing at ${filePath}`);
  }
}

function findPackagedApp() {
  const candidates = [
    path.join(materializedRoot, "out", `mac-${process.arch}`, "Actestra.app"),
    path.join(materializedRoot, "out", "mac", "Actestra.app"),
  ];
  const candidate = candidates.find((value) =>
    fs.statSync(value, { throwIfNoEntry: false })?.isDirectory(),
  );
  if (candidate === undefined) {
    fail(`packaged Actestra.app is unavailable; expected one of ${candidates.join(", ")}`);
  }
  const appAsar = path.join(candidate, "Contents", "Resources", "app.asar");
  requireFile(appAsar, "Packaged Actestra app.asar");
  const builtMainState = fs.statSync(builtMain, { throwIfNoEntry: false });
  if (builtMainState === undefined || fs.statSync(appAsar).mtimeMs < builtMainState.mtimeMs) {
    fail("packaged Actestra.app is older than the current production build");
  }
  return candidate;
}

function findPackagedAionCore(packagedApp) {
  const candidate = path.join(
    packagedApp,
    "Contents",
    "Resources",
    "bundled-aioncore",
    `${process.platform}-${process.arch}`,
    "aioncore",
  );
  requireFile(candidate, "Packaged exact AionCore runtime");
  const version = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (
    expectedAionCoreVersion.length === 0 ||
    version.status !== 0 ||
    version.stdout.trim() !== `aioncore ${expectedAionCoreVersion}`
  ) {
    fail(
      `AionCore runtime does not match the materialized pin v${expectedAionCoreVersion || "unknown"}`,
    );
  }
  return candidate;
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function childOutcome(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ kind: "error", error }));
    child.once("exit", (code, signal) => resolve({ kind: "exit", code, signal }));
  });
}

function appendOutput(current, chunk) {
  const next = current + chunk.toString();
  return Buffer.byteLength(next) <= maximumOutputBytes
    ? next
    : next.slice(next.length - maximumOutputBytes);
}

async function terminate(child, outcomePromise) {
  const alreadyExited = await Promise.race([outcomePromise, delay(1)]);
  if (alreadyExited !== undefined) return alreadyExited;
  child.kill("SIGTERM");
  const graceful = await Promise.race([outcomePromise, delay(10_000)]);
  if (graceful !== undefined) return graceful;
  child.kill("SIGKILL");
  return outcomePromise;
}

function processStillOwnsProfile(profilePath) {
  const snapshot = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return snapshot.status === 0 && snapshot.stdout.includes(profilePath);
}

async function runScenario(scenario, profilePath, workspacePath, packagedExecutable) {
  fs.mkdirSync(profilePath, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  let output = "";
  const child = spawn(packagedExecutable, [], {
    cwd: materializedRoot,
    env: {
      ...process.env,
      ACTESTRA_E2E_TEST: "1",
      ACTESTRA_DISABLE_AUTO_UPDATE: "1",
      ACTESTRA_USER_DATA_DIR: profilePath,
      ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO: scenario,
      ACTESTRA_GENERAL_WORK_SMOKE_WORKSPACE: workspacePath,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outcomePromise = childOutcome(child);
  child.stdout.on("data", (chunk) => {
    output = appendOutput(output, chunk);
  });
  child.stderr.on("data", (chunk) => {
    output = appendOutput(output, chunk);
  });

  const startedAt = Date.now();
  let summary;
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (output.includes(failureMarker)) {
      await terminate(child, outcomePromise);
      fail(`${scenario} emitted a failure marker\n${output}`);
    }
    const markerIndex = output.indexOf(markerPrefix);
    if (
      markerIndex !== -1 &&
      output.includes(windowReadyMarker) &&
      output.includes(rendererReadyMarker)
    ) {
      const markerLine = output.slice(markerIndex + markerPrefix.length).split(/\r?\n/u)[0];
      try {
        summary = JSON.parse(markerLine);
      } catch {
        await terminate(child, outcomePromise);
        fail(`${scenario} emitted invalid smoke evidence`);
      }
      break;
    }
    const outcome = await Promise.race([outcomePromise, delay(100)]);
    if (outcome !== undefined) {
      fail(`${scenario} exited before target-app readiness\n${output}`);
    }
  }
  if (summary === undefined) {
    await terminate(child, outcomePromise);
    fail(`${scenario} timed out before target-app smoke readiness\n${output}`);
  }

  const outcome = await terminate(child, outcomePromise);
  if (outcome.kind === "error") {
    fail(`${scenario} could not terminate cleanly: ${outcome.error.message}`);
  }
  if (
    outcome.signal === "SIGKILL" ||
    (outcome.signal !== null && outcome.signal !== "SIGTERM") ||
    (outcome.code !== null && outcome.code !== 0)
  ) {
    fail(
      `${scenario} terminated unexpectedly (code=${String(outcome.code)}, signal=${String(outcome.signal)})`,
    );
  }
  await delay(500);
  if (processStillOwnsProfile(profilePath)) {
    fail(`${scenario} left a process that still owns its isolated profile`);
  }
  return summary;
}

function databaseValue(database, sql) {
  const row = database.prepare(sql).get();
  return row === undefined ? undefined : Object.values(row)[0];
}

function verifyPreparedProfile(profilePath) {
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    if (databaseValue(database, "PRAGMA user_version") !== 9) {
      fail("prepare-restart did not create schema version 9");
    }
    if (
      databaseValue(database, "SELECT COUNT(*) FROM aionui_general_work_journeys") !== 1 ||
      databaseValue(
        database,
        "SELECT COUNT(*) FROM aionui_general_work_journeys WHERE journey_kind = 'workspace-file-artifact'",
      ) !== 1 ||
      databaseValue(database, "SELECT COUNT(*) FROM tasks WHERE state = 'ready'") !== 1 ||
      databaseValue(database, "SELECT COUNT(*) FROM general_work_checkpoints") !== 0
    ) {
      fail("prepare-restart did not leave exactly one authoritative prepared task");
    }
  } finally {
    database.close();
  }
}

function verifyTerminalProfile(profilePath, expected) {
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const eventCount = databaseValue(
      database,
      `SELECT COUNT(*) FROM core_events WHERE type = '${expected.eventType}'`,
    );
    if (
      databaseValue(database, "PRAGMA user_version") !== 9 ||
      databaseValue(database, "SELECT COUNT(*) FROM aionui_general_work_journeys") !== 1 ||
      databaseValue(
        database,
        `SELECT COUNT(*) FROM aionui_general_work_journeys WHERE journey_kind = '${expected.journeyKind}'`,
      ) !== 1 ||
      databaseValue(database, `SELECT COUNT(*) FROM tasks WHERE state = '${expected.state}'`) !==
        1 ||
      databaseValue(
        database,
        "SELECT COUNT(*) FROM general_work_checkpoints WHERE phase = 'finalized'",
      ) !== 1 ||
      databaseValue(
        database,
        "SELECT COUNT(*) FROM general_work_checkpoints WHERE phase != 'finalized'",
      ) !== 0 ||
      databaseValue(
        database,
        `SELECT COUNT(*) FROM agent_attempt_evidence WHERE state = '${expected.state}'`,
      ) !== 1 ||
      databaseValue(database, "SELECT COUNT(*) FROM artifacts") !== expected.artifactCount ||
      eventCount !== 1 ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) {
      fail(`terminal profile does not contain exact ${expected.state} authority evidence`);
    }
    const taskId = databaseValue(database, "SELECT task_id FROM aionui_general_work_journeys");
    if (typeof taskId !== "string" || taskId.length === 0) {
      fail("terminal profile has no exact General Work task identity");
    }
    return taskId;
  } finally {
    database.close();
  }
}

try {
  if (process.platform !== "darwin") {
    fail("GW-P4.6 target-app smoke currently requires the macOS internal-test lane");
  }
  requireFile(builtMain, "Materialized production main entry");
  const packagedApp = findPackagedApp();
  const packagedExecutable = path.join(packagedApp, "Contents", "MacOS", "Actestra");
  requireFile(packagedExecutable, "Packaged Actestra executable");
  findPackagedAionCore(packagedApp);

  const restartProfile = path.join(smokeRoot, "restart-profile");
  const restartWorkspace = path.join(smokeRoot, "restart-workspace");
  const restartSourceText = "Packaged representative workspace-file source.\n";
  fs.mkdirSync(restartWorkspace, { recursive: true });
  fs.writeFileSync(path.join(restartWorkspace, "actestra-input.txt"), restartSourceText, "utf8");
  const prepared = await runScenario(
    "prepare-restart",
    restartProfile,
    restartWorkspace,
    packagedExecutable,
  );
  if (prepared.status !== "prepared") {
    fail("prepare-restart returned the wrong status");
  }
  verifyPreparedProfile(restartProfile);
  const recovered = await runScenario(
    "recover-restart",
    restartProfile,
    restartWorkspace,
    packagedExecutable,
  );
  if (recovered.status !== "completed" || recovered.artifactCount !== 1) {
    fail("recover-restart returned the wrong terminal evidence");
  }
  const recoveredTaskId = verifyTerminalProfile(restartProfile, {
    state: "completed",
    eventType: "task.completed",
    artifactCount: 1,
    journeyKind: "workspace-file-artifact",
  });
  const recoveredOutput = path.join(
    restartWorkspace,
    ".actestra",
    "task-output",
    recoveredTaskId,
    "result.md",
  );
  requireFile(recoveredOutput, "Recovered representative file artifact");
  if (!fs.readFileSync(recoveredOutput, "utf8").includes(restartSourceText)) {
    fail("Recovered representative file artifact does not contain the owned source");
  }

  for (const scenario of ["denial", "cancellation"]) {
    const profilePath = path.join(smokeRoot, `${scenario}-profile`);
    const workspacePath = path.join(smokeRoot, `${scenario}-workspace`);
    const summary = await runScenario(scenario, profilePath, workspacePath, packagedExecutable);
    const expected =
      scenario === "denial"
        ? {
            state: "failed",
            eventType: "task.failed",
            artifactCount: 0,
            journeyKind: "prompt-artifact",
          }
        : {
            state: "cancelled",
            eventType: "task.cancelled",
            artifactCount: 0,
            journeyKind: "prompt-artifact",
          };
    if (summary.status !== expected.state) {
      fail(`${scenario} returned the wrong terminal status`);
    }
    verifyTerminalProfile(profilePath, expected);
  }

  succeeded = true;
  console.info(
    "Packaged target-app GW-P4.6 smoke passed: representative workspace-file restart recovery, workspace-grant denial, cancellation, finalized checkpoints, events, artifacts, and terminal evidence are exact.",
  );
} catch (error) {
  console.error(
    `Target-app GW-P4.6 smoke failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(`Isolated smoke root retained for inspection: ${smokeRoot}`);
  process.exitCode = 1;
} finally {
  if (succeeded) {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}
