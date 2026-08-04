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
const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-p4-smoke-"));
const markerPrefix = "ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_READY ";
const workerActiveMarkerPrefix = "ACTESTRA_AIONUI_GENERAL_WORKER_ACTIVE ";
const failureMarker = "ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_FAILED ";
const windowReadyMarker = "[Actestra] Main window created";
const rendererReadyMarker = "[AionUi] Renderer did-finish-load";
const rendererProviderReadyMarker = "ACTESTRA_RENDERER_PROVIDER_SMOKE_READY";
const backendRuntimeReadyMarker = "startup: managed runtime background preparation completed";
const rendererProviderFailureMarker = "ACTESTRA_RENDERER_PROVIDER_SMOKE_FAILED ";
const maximumOutputBytes = 2 * 1_024 * 1_024;
const startupTimeoutMs = 60_000;
const expectedPersistenceSchemaVersion = 15;
const schedulePrompt = "/actestra Produce the scheduled Actestra artifact.";
const scheduleRunNowName = "Schedule smoke run-now";
const scheduleMissedName = "Schedule smoke missed";
const scheduleInterruptedName = "Schedule smoke interrupted";
const scheduleInterruptedClaim = "schedule-smoke-interrupted-claim";
const scheduleNativeConversationId = "conversation-aionui-smoke";
const maximumRepresentativeFileBytes = 64 * 1_024;
const toolFailurePrivateMarker = "Packaged private oversized tool-failure source";
let succeeded = false;

function fail(message) {
  throw new Error(message);
}

function requireFile(filePath, label) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    fail(`${label} is missing at ${filePath}`);
  }
}

function verifyDocxPackage(filePath) {
  const signature = fs.readFileSync(filePath).subarray(0, 2).toString("ascii");
  if (signature !== "PK") {
    fail("Recovered Office artifact is not a ZIP/OOXML package");
  }
  const listing = spawnSync("unzip", ["-Z1", filePath], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 1_024 * 1_024,
  });
  if (listing.status !== 0) {
    fail("Recovered Office artifact could not be inspected as ZIP/OOXML");
  }
  const entries = new Set(listing.stdout.split(/\r?\n/u).filter(Boolean));
  for (const entry of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
    if (!entries.has(entry)) {
      fail(`Recovered Office artifact is missing ${entry}`);
    }
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

function describeChildOutcome(outcome) {
  return outcome.kind === "error"
    ? `spawn-error=${outcome.error.message}`
    : `code=${String(outcome.code)}, signal=${String(outcome.signal)}`;
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

function descendantProcesses(rootPid) {
  const snapshot = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (snapshot.status !== 0) {
    fail("Could not inspect the packaged target-app process tree");
  }
  const rows = snapshot.stdout
    .split(/\r?\n/u)
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({
      pid: Number.parseInt(match[1], 10),
      parentPid: Number.parseInt(match[2], 10),
      command: match[3],
    }));
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.parentPid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => row.pid !== rootPid && descendants.has(row.pid));
}

function processHasEnvironmentEntry(pid, entry) {
  const snapshot = spawnSync("ps", ["eww", "-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return snapshot.status === 0 && snapshot.stdout.split(/\s+/u).includes(entry);
}

function generalWorkerProcesses(rootPid) {
  return descendantProcesses(rootPid).filter(
    ({ pid, command }) =>
      command.includes("--utility-sub-type=node.mojom.NodeService") &&
      processHasEnvironmentEntry(pid, "ACTESTRA_UTILITY_ROLE=general-worker"),
  );
}

function targetAppIsReady(output) {
  return (
    output.includes(windowReadyMarker) &&
    output.includes(rendererReadyMarker) &&
    output.includes(rendererProviderReadyMarker) &&
    output.includes(backendRuntimeReadyMarker)
  );
}

async function runScenario(scenario, profilePath, workspacePath, packagedExecutable) {
  fs.mkdirSync(profilePath, { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  const canonicalWorkspacePath = fs.realpathSync(workspacePath);
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
  let workerPid;
  child.stdout.on("data", (chunk) => {
    output = appendOutput(output, chunk);
  });
  child.stderr.on("data", (chunk) => {
    output = appendOutput(output, chunk);
  });

  const startedAt = Date.now();
  let summary;
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (output.includes(failureMarker) || output.includes(rendererProviderFailureMarker)) {
      await terminate(child, outcomePromise);
      fail(`${scenario} emitted a failure marker\n${output}`);
    }
    if (scenario === "recover-worker-crash" && output.includes("ACTESTRA_GENERAL_WORKER_READY")) {
      await terminate(child, outcomePromise);
      fail("recover-worker-crash launched the generic General Worker probe");
    }
    if (
      scenario === "prepare-worker-crash" &&
      workerPid === undefined &&
      targetAppIsReady(output)
    ) {
      const activeMarkerIndex = output.indexOf(workerActiveMarkerPrefix);
      if (activeMarkerIndex !== -1) {
        const markerLine = output
          .slice(activeMarkerIndex + workerActiveMarkerPrefix.length)
          .split(/\r?\n/u)[0];
        let activeEvidence;
        try {
          activeEvidence = JSON.parse(markerLine);
        } catch {
          await terminate(child, outcomePromise);
          fail("prepare-worker-crash emitted invalid active Worker evidence");
        }
        if (typeof activeEvidence.taskId !== "string" || activeEvidence.taskId.length === 0) {
          await terminate(child, outcomePromise);
          fail("prepare-worker-crash emitted no active Task identity");
        }
        const workers = generalWorkerProcesses(child.pid);
        if (workers.length > 1) {
          await terminate(child, outcomePromise);
          fail("prepare-worker-crash found more than one active General Worker process");
        }
        if (workers[0] !== undefined) {
          workerPid = workers[0].pid;
          process.kill(workerPid, "SIGKILL");
        }
      }
    }
    const markerIndex = output.indexOf(markerPrefix);
    if (
      markerIndex !== -1 &&
      output.includes(windowReadyMarker) &&
      output.includes(rendererReadyMarker) &&
      output.includes(rendererProviderReadyMarker)
    ) {
      const markerLine = output.slice(markerIndex + markerPrefix.length).split(/\r?\n/u)[0];
      try {
        summary = JSON.parse(markerLine);
      } catch {
        await terminate(child, outcomePromise);
        fail(`${scenario} emitted invalid smoke evidence`);
      }
      if (scenario === "prepare-worker-crash" && workerPid === undefined) {
        await terminate(child, outcomePromise);
        fail("prepare-worker-crash reached terminal readiness without terminating its Worker");
      }
      if (scenario === "recover-worker-crash" && generalWorkerProcesses(child.pid).length !== 0) {
        await terminate(child, outcomePromise);
        fail("recover-worker-crash relaunched a finalized General Worker attempt");
      }
      break;
    }
    const outcome = await Promise.race([outcomePromise, delay(100)]);
    if (outcome !== undefined) {
      fail(
        `${scenario} exited before target-app readiness (${describeChildOutcome(outcome)})\n${output}`,
      );
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
  if (
    (scenario === "prepare-tool-failure" || scenario === "recover-tool-failure") &&
    (output.includes(toolFailurePrivateMarker) ||
      output.includes(canonicalWorkspacePath) ||
      output.includes(workspacePath))
  ) {
    fail(`${scenario} leaked private workspace data into target-app output`);
  }
  return summary;
}

function databaseValue(database, sql) {
  const row = database.prepare(sql).get();
  return row === undefined ? undefined : Object.values(row)[0];
}

function verifyPreparedProfile(profilePath, expected) {
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    if (databaseValue(database, "PRAGMA user_version") !== expectedPersistenceSchemaVersion) {
      fail(`prepare-restart did not create schema version ${expectedPersistenceSchemaVersion}`);
    }
    if (
      databaseValue(database, "SELECT COUNT(*) FROM aionui_general_work_journeys") !== 1 ||
      databaseValue(
        database,
        `SELECT COUNT(*) FROM aionui_general_work_journeys WHERE journey_kind = '${expected.journeyKind}'`,
      ) !== 1 ||
      databaseValue(database, "SELECT COUNT(*) FROM tasks WHERE state = 'ready'") !== 1 ||
      databaseValue(database, "SELECT COUNT(*) FROM general_work_checkpoints") !== 0 ||
      databaseValue(database, "SELECT COUNT(*) FROM content_references") !==
        expected.contentReferenceCount
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
      databaseValue(database, "PRAGMA user_version") !== expectedPersistenceSchemaVersion ||
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
      (expected.artifactLabel !== undefined &&
        databaseValue(
          database,
          `SELECT COUNT(*) FROM artifacts WHERE label = '${expected.artifactLabel}'`,
        ) !== 1) ||
      (expected.artifactKind !== undefined &&
        databaseValue(
          database,
          `SELECT COUNT(*) FROM artifacts WHERE kind = '${expected.artifactKind}'`,
        ) !== 1) ||
      (expected.contentReferenceCount !== undefined &&
        databaseValue(database, "SELECT COUNT(*) FROM content_references") !==
          expected.contentReferenceCount) ||
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

function verifyToolFailureProfile(profilePath, workspacePath) {
  const canonicalWorkspacePath = fs.realpathSync(workspacePath);
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const journeys = database
      .prepare(
        `SELECT task_id, contract_version, conversation_hash, journey_kind, created_at
         FROM aionui_general_work_journeys
         ORDER BY task_id`,
      )
      .all();
    const workspaces = database
      .prepare(
        `SELECT id, name, state, created_at, updated_at
         FROM workspaces
         ORDER BY id`,
      )
      .all();
    const tasks = database
      .prepare(
        `SELECT id, workspace_id, title, state, active_session_id, created_at, updated_at
         FROM tasks
         ORDER BY id`,
      )
      .all();
    const sessions = database
      .prepare(
        `SELECT id, workspace_id, task_id, worker_id, state, created_at, updated_at
         FROM sessions
         ORDER BY id`,
      )
      .all();
    const workers = database
      .prepare(
        `SELECT id, workspace_id, adapter_kind, state, created_at, updated_at
         FROM workers
         ORDER BY id`,
      )
      .all();
    const attempts = database
      .prepare(
        `SELECT session_id, workspace_id, task_id, worker_id, stream_id, state,
                last_core_event_sequence, incident_code, redaction, evidence_json
         FROM agent_attempt_evidence
         ORDER BY session_id`,
      )
      .all();
    const checkpoints = database
      .prepare(
        `SELECT session_id, contract_version, phase, revision, workspace_id,
                task_id, worker_id, stream_id, created_at, updated_at, checkpoint_json
         FROM general_work_checkpoints
         ORDER BY session_id`,
      )
      .all();
    const events = database
      .prepare(
        `SELECT event_id, stream_id, sequence, occurred_at, workspace_id, task_id,
                session_id, worker_id, type, redaction, envelope_json
         FROM core_events
         ORDER BY stream_id, sequence`,
      )
      .all();
    const audits = database
      .prepare(
        `SELECT sequence, record_id, occurred_at, request_id, workspace_id, task_id,
                session_id, worker_id, tool_id, action, resource_kind, event_type,
                redaction, record_json
         FROM privileged_audit_records
         ORDER BY sequence`,
      )
      .all();
    const references = database
      .prepare(
        `SELECT reference, contract_version, kind, workspace_id, task_id, session_id,
                worker_id, request_id, grant_id, classification, media_type, byte_length,
                sha256, created_at, expires_at, consumed_at, metadata_json
         FROM content_references
         ORDER BY reference`,
      )
      .all();
    const grants = database
      .prepare(
        `SELECT grant_id, contract_version, workspace_id, root_path, display_name, state,
                created_at, updated_at, grant_json
         FROM workspace_grants
         ORDER BY grant_id`,
      )
      .all();
    const approvals = database.prepare("SELECT * FROM approvals ORDER BY id").all();
    const artifacts = database.prepare("SELECT * FROM artifacts ORDER BY id").all();

    if (
      databaseValue(database, "PRAGMA user_version") !== expectedPersistenceSchemaVersion ||
      journeys.length !== 1 ||
      journeys[0]?.journey_kind !== "workspace-file-artifact" ||
      workspaces.length !== 1 ||
      workspaces[0]?.state !== "active" ||
      tasks.length !== 1 ||
      tasks[0]?.state !== "failed" ||
      sessions.length !== 1 ||
      sessions[0]?.state !== "failed" ||
      workers.length !== 1 ||
      workers[0]?.state !== "stopped" ||
      attempts.length !== 1 ||
      attempts[0]?.state !== "failed" ||
      attempts[0]?.incident_code !== "content-too-large" ||
      checkpoints.length !== 1 ||
      checkpoints[0]?.phase !== "finalized" ||
      grants.length !== 1 ||
      grants[0]?.state !== "active" ||
      grants[0]?.root_path !== canonicalWorkspacePath ||
      references.length !== 2 ||
      approvals.length !== 0 ||
      artifacts.length !== 0 ||
      journeys[0]?.task_id !== tasks[0]?.id ||
      tasks[0]?.workspace_id !== workspaces[0]?.id ||
      sessions[0]?.workspace_id !== workspaces[0]?.id ||
      sessions[0]?.task_id !== tasks[0]?.id ||
      sessions[0]?.worker_id !== workers[0]?.id ||
      workers[0]?.workspace_id !== workspaces[0]?.id ||
      attempts[0]?.workspace_id !== workspaces[0]?.id ||
      attempts[0]?.task_id !== tasks[0]?.id ||
      attempts[0]?.session_id !== sessions[0]?.id ||
      attempts[0]?.worker_id !== workers[0]?.id ||
      checkpoints[0]?.workspace_id !== workspaces[0]?.id ||
      checkpoints[0]?.task_id !== tasks[0]?.id ||
      checkpoints[0]?.session_id !== sessions[0]?.id ||
      checkpoints[0]?.worker_id !== workers[0]?.id ||
      checkpoints[0]?.stream_id !== attempts[0]?.stream_id ||
      grants[0]?.workspace_id !== workspaces[0]?.id ||
      events.some(
        (event) =>
          event.workspace_id !== workspaces[0]?.id ||
          event.task_id !== tasks[0]?.id ||
          event.session_id !== sessions[0]?.id ||
          event.worker_id !== workers[0]?.id ||
          event.stream_id !== attempts[0]?.stream_id,
      ) ||
      audits.some(
        (audit) =>
          audit.workspace_id !== workspaces[0]?.id ||
          audit.task_id !== tasks[0]?.id ||
          audit.session_id !== sessions[0]?.id ||
          audit.worker_id !== workers[0]?.id,
      ) ||
      references.some(
        (reference) =>
          reference.workspace_id !== workspaces[0]?.id ||
          reference.task_id !== tasks[0]?.id ||
          reference.session_id !== sessions[0]?.id ||
          reference.worker_id !== workers[0]?.id ||
          reference.grant_id !== grants[0]?.grant_id,
      ) ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) {
      fail("tool-failure profile does not contain exact Core-owned terminal authority");
    }

    const checkpoint = JSON.parse(checkpoints[0].checkpoint_json);
    if (
      checkpoint.phase !== "finalized" ||
      checkpoint.tool?.state !== "failed" ||
      checkpoint.tool?.errorCode !== "content-too-large" ||
      checkpoint.tool?.mayHaveExecuted !== false ||
      checkpoint.attempt?.state !== "failed" ||
      checkpoint.attempt?.taskState !== "failed" ||
      checkpoint.attempt?.incident?.code !== "content-too-large" ||
      checkpoint.attempt?.disposed !== true
    ) {
      fail("tool-failure checkpoint lost the exact fail-closed terminal result");
    }

    const toolFailureEvents = events.filter(({ type }) => type === "tool.failed");
    const taskFailureEvents = events.filter(({ type }) => type === "task.failed");
    const toolFailureEvent =
      toolFailureEvents.length === 1 ? JSON.parse(toolFailureEvents[0].envelope_json) : undefined;
    const taskFailureEvent =
      taskFailureEvents.length === 1 ? JSON.parse(taskFailureEvents[0].envelope_json) : undefined;
    if (
      toolFailureEvent?.payload?.errorCode !== "content-too-large" ||
      toolFailureEvent?.payload?.mayHaveExecuted !== false ||
      taskFailureEvent?.payload?.errorCode !== "content-too-large" ||
      events.some(({ type }) =>
        ["tool.completed", "task.completed", "task.cancelled", "artifact.created"].includes(type),
      )
    ) {
      fail("tool-failure normalized Core events are not exact");
    }

    const expectedAuditTypes = ["policy.evaluated", "tool.started", "tool.failed"];
    const auditEvents = audits.map(({ record_json: recordJson }) => JSON.parse(recordJson).event);
    const policyAudit = auditEvents.find(({ type }) => type === "policy.evaluated");
    const toolFailureAudit = auditEvents.find(({ type }) => type === "tool.failed");
    if (
      JSON.stringify(audits.map(({ event_type: eventType }) => eventType)) !==
        JSON.stringify(expectedAuditTypes) ||
      policyAudit?.decision !== "allow" ||
      !policyAudit?.matchedRuleIds?.includes("rule-gw-p4-4-workspace-read-text") ||
      toolFailureAudit?.errorCode !== "content-too-large" ||
      toolFailureAudit?.mayHaveExecuted !== false
    ) {
      fail("tool-failure policy and metadata audit evidence are not exact");
    }

    const normalizedEvidence = `${events.map(({ envelope_json: value }) => value).join("\n")}\n${audits
      .map(({ record_json: value }) => value)
      .join("\n")}`;
    for (const fragment of [
      canonicalWorkspacePath,
      workspacePath,
      "actestra-input.txt",
      toolFailurePrivateMarker,
      ...references.map(({ reference }) => reference),
    ]) {
      if (normalizedEvidence.includes(fragment)) {
        fail("tool-failure private workspace data leaked into events or metadata audit");
      }
    }

    const taskId = journeys[0].task_id;
    if (
      typeof taskId !== "string" ||
      taskId.length === 0 ||
      fs.statSync(path.join(workspacePath, ".actestra", "task-output", taskId, "result.md"), {
        throwIfNoEntry: false,
      }) !== undefined
    ) {
      fail("tool-failure journey created an unexpected task output");
    }

    return Object.freeze({
      taskId,
      authoritySnapshot: JSON.stringify({
        journeys,
        workspaces,
        tasks,
        sessions,
        workers,
        attempts,
        checkpoints,
        events,
        audits,
        references,
        grants,
        approvals,
        artifacts,
      }),
    });
  } finally {
    database.close();
  }
}

function verifyWorkerCrashProfile(profilePath, workspacePath) {
  const canonicalWorkspacePath = fs.realpathSync(workspacePath);
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const journeys = database
      .prepare(
        `SELECT task_id, contract_version, conversation_hash, journey_kind, created_at
         FROM aionui_general_work_journeys
         ORDER BY task_id`,
      )
      .all();
    const workspaces = database
      .prepare(
        `SELECT id, name, state, created_at, updated_at
         FROM workspaces
         ORDER BY id`,
      )
      .all();
    const tasks = database
      .prepare(
        `SELECT id, workspace_id, title, state, active_session_id, created_at, updated_at
         FROM tasks
         ORDER BY id`,
      )
      .all();
    const sessions = database
      .prepare(
        `SELECT id, workspace_id, task_id, worker_id, state, created_at, updated_at
         FROM sessions
         ORDER BY id`,
      )
      .all();
    const workers = database
      .prepare(
        `SELECT id, workspace_id, adapter_kind, state, created_at, updated_at
         FROM workers
         ORDER BY id`,
      )
      .all();
    const attempts = database
      .prepare(
        `SELECT session_id, workspace_id, task_id, worker_id, stream_id, state,
                last_core_event_sequence, incident_code, redaction, evidence_json
         FROM agent_attempt_evidence
         ORDER BY session_id`,
      )
      .all();
    const checkpoints = database
      .prepare(
        `SELECT session_id, contract_version, phase, revision, workspace_id,
                task_id, worker_id, stream_id, created_at, updated_at, checkpoint_json
         FROM general_work_checkpoints
         ORDER BY session_id`,
      )
      .all();
    const events = database
      .prepare(
        `SELECT event_id, stream_id, sequence, occurred_at, workspace_id, task_id,
                session_id, worker_id, type, redaction, envelope_json
         FROM core_events
         ORDER BY stream_id, sequence`,
      )
      .all();
    const references = database
      .prepare(
        `SELECT reference, contract_version, kind, workspace_id, task_id, session_id,
                worker_id, request_id, grant_id, classification, media_type, byte_length,
                sha256, created_at, expires_at, consumed_at, metadata_json
         FROM content_references
         ORDER BY reference`,
      )
      .all();
    const grants = database
      .prepare(
        `SELECT grant_id, contract_version, workspace_id, root_path, display_name, state,
                created_at, updated_at, grant_json
         FROM workspace_grants
         ORDER BY grant_id`,
      )
      .all();
    const approvals = database.prepare("SELECT * FROM approvals ORDER BY id").all();
    const artifacts = database.prepare("SELECT * FROM artifacts ORDER BY id").all();
    const audits = database
      .prepare("SELECT * FROM privileged_audit_records ORDER BY sequence")
      .all();

    if (
      databaseValue(database, "PRAGMA user_version") !== expectedPersistenceSchemaVersion ||
      journeys.length !== 1 ||
      journeys[0]?.journey_kind !== "prompt-artifact" ||
      workspaces.length !== 1 ||
      workspaces[0]?.state !== "active" ||
      tasks.length !== 1 ||
      tasks[0]?.state !== "failed" ||
      tasks[0]?.active_session_id !== null ||
      sessions.length !== 1 ||
      sessions[0]?.state !== "failed" ||
      workers.length !== 1 ||
      workers[0]?.state !== "crashed" ||
      workers[0]?.adapter_kind !== "actestra.general-worker" ||
      attempts.length !== 1 ||
      attempts[0]?.state !== "crashed" ||
      attempts[0]?.incident_code !== "worker-process-exit" ||
      checkpoints.length !== 1 ||
      checkpoints[0]?.phase !== "finalized" ||
      grants.length !== 1 ||
      grants[0]?.state !== "active" ||
      grants[0]?.root_path !== canonicalWorkspacePath ||
      references.length !== 2 ||
      approvals.length !== 0 ||
      artifacts.length !== 0 ||
      audits.length !== 0 ||
      journeys[0]?.task_id !== tasks[0]?.id ||
      tasks[0]?.workspace_id !== workspaces[0]?.id ||
      sessions[0]?.workspace_id !== workspaces[0]?.id ||
      sessions[0]?.task_id !== tasks[0]?.id ||
      sessions[0]?.worker_id !== workers[0]?.id ||
      workers[0]?.workspace_id !== workspaces[0]?.id ||
      attempts[0]?.workspace_id !== workspaces[0]?.id ||
      attempts[0]?.task_id !== tasks[0]?.id ||
      attempts[0]?.session_id !== sessions[0]?.id ||
      attempts[0]?.worker_id !== workers[0]?.id ||
      attempts[0]?.last_core_event_sequence !== events.length ||
      checkpoints[0]?.workspace_id !== workspaces[0]?.id ||
      checkpoints[0]?.task_id !== tasks[0]?.id ||
      checkpoints[0]?.session_id !== sessions[0]?.id ||
      checkpoints[0]?.worker_id !== workers[0]?.id ||
      checkpoints[0]?.stream_id !== attempts[0]?.stream_id ||
      grants[0]?.workspace_id !== workspaces[0]?.id ||
      references.some(
        (reference) =>
          reference.workspace_id !== workspaces[0]?.id ||
          reference.task_id !== tasks[0]?.id ||
          reference.session_id !== sessions[0]?.id ||
          reference.worker_id !== workers[0]?.id ||
          reference.grant_id !== grants[0]?.grant_id,
      ) ||
      events.some(
        (event) =>
          event.workspace_id !== workspaces[0]?.id ||
          event.task_id !== tasks[0]?.id ||
          event.session_id !== sessions[0]?.id ||
          event.worker_id !== workers[0]?.id ||
          event.stream_id !== attempts[0]?.stream_id,
      ) ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) {
      fail("Worker-crash profile does not contain exact Core-owned terminal authority");
    }

    const checkpoint = JSON.parse(checkpoints[0].checkpoint_json);
    const evidence = JSON.parse(attempts[0].evidence_json);
    if (
      checkpoint.phase !== "finalized" ||
      checkpoint.tool !== undefined ||
      checkpoint.artifactBinding !== undefined ||
      checkpoint.attempt?.state !== "crashed" ||
      checkpoint.attempt?.taskState !== "failed" ||
      checkpoint.attempt?.incident?.code !== "worker-process-exit" ||
      checkpoint.attempt?.replacementSessionId !== undefined ||
      checkpoint.attempt?.restartCount !== 0 ||
      checkpoint.attempt?.disposed !== true ||
      evidence.state !== "crashed" ||
      evidence.taskState !== "failed" ||
      evidence.incident?.code !== "worker-process-exit" ||
      evidence.replacementSessionId !== undefined ||
      evidence.restartCount !== 0 ||
      evidence.disposed !== true
    ) {
      fail("Worker-crash checkpoint or Attempt evidence lost its exact terminal result");
    }

    const eventTypes = events.map(({ type }) => type);
    const terminalEventTypes = ["task.updated", "worker.failed", "task.failed"];
    const workerFailure = JSON.parse(events.at(-2).envelope_json);
    const taskFailure = JSON.parse(events.at(-1).envelope_json);
    if (
      eventTypes[0] !== "task.started" ||
      eventTypes.slice(1, -3).some((type) => type !== "agent.message") ||
      JSON.stringify(eventTypes.slice(-3)) !== JSON.stringify(terminalEventTypes) ||
      JSON.stringify(checkpoint.events.map(({ type }) => type)) !== JSON.stringify(eventTypes) ||
      workerFailure.payload?.errorCode !== "worker-process-exit" ||
      workerFailure.payload?.retryable !== true ||
      taskFailure.payload?.from !== "blocked" ||
      taskFailure.payload?.to !== "failed" ||
      taskFailure.payload?.errorCode !== "worker-process-exit" ||
      eventTypes.some((type) => type.startsWith("tool.") || type.startsWith("artifact."))
    ) {
      fail("Worker-crash normalized Core event order or payload is not exact");
    }

    const normalizedEvidence = `${events
      .map(({ envelope_json: value }) => value)
      .join("\n")}\n${attempts[0].evidence_json}`;
    for (const fragment of [
      canonicalWorkspacePath,
      workspacePath,
      ...references.map(({ reference }) => reference),
    ]) {
      if (normalizedEvidence.includes(fragment)) {
        fail("Worker-crash private workspace data leaked into normalized evidence");
      }
    }

    const taskId = journeys[0].task_id;
    if (
      typeof taskId !== "string" ||
      taskId.length === 0 ||
      fs.statSync(path.join(workspacePath, ".actestra", "task-output"), {
        throwIfNoEntry: false,
      }) !== undefined
    ) {
      fail("Worker-crash journey created an unexpected task output");
    }

    return Object.freeze({
      taskId,
      authoritySnapshot: JSON.stringify({
        journeys,
        workspaces,
        tasks,
        sessions,
        workers,
        attempts,
        checkpoints,
        events,
        references,
        grants,
        approvals,
        artifacts,
        audits,
      }),
    });
  } finally {
    database.close();
  }
}

function verifyPreparedScheduleProfile(profilePath) {
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const claimedRows = database
      .prepare(
        `SELECT name, active_claim
         FROM aionui_schedule_jobs
         WHERE active_claim IS NOT NULL`,
      )
      .all();
    if (
      databaseValue(database, "PRAGMA user_version") !== expectedPersistenceSchemaVersion ||
      databaseValue(database, "SELECT COUNT(*) FROM aionui_schedule_jobs") !== 3 ||
      databaseValue(database, "SELECT COUNT(*) FROM tasks") !== 0 ||
      databaseValue(database, "SELECT COUNT(*) FROM aionui_general_work_journeys") !== 0 ||
      databaseValue(database, "SELECT COUNT(*) FROM general_work_checkpoints") !== 0 ||
      databaseValue(database, "SELECT COUNT(*) FROM agent_attempt_evidence") !== 0 ||
      databaseValue(database, "SELECT COUNT(*) FROM artifacts") !== 0 ||
      claimedRows.length !== 1 ||
      claimedRows[0]?.name !== scheduleInterruptedName ||
      claimedRows[0]?.active_claim !== scheduleInterruptedClaim ||
      database.prepare("PRAGMA foreign_key_check").all().length !== 0
    ) {
      fail(
        `prepare-schedule-restart did not leave exact schema version ${expectedPersistenceSchemaVersion} schedule authority`,
      );
    }
    const missed = database
      .prepare(
        `SELECT next_run_at_ms
         FROM aionui_schedule_jobs
         WHERE name = ?`,
      )
      .get(scheduleMissedName);
    if (
      missed === undefined ||
      typeof missed.next_run_at_ms !== "number" ||
      !Number.isSafeInteger(missed.next_run_at_ms) ||
      missed.next_run_at_ms < 0
    ) {
      fail("prepare-schedule-restart has no exact missed occurrence deadline");
    }
    return missed.next_run_at_ms;
  } finally {
    database.close();
  }
}

async function waitUntilScheduleOccurrenceIsMissed(nextRunAtMs) {
  const waitMilliseconds = nextRunAtMs - Date.now() + 250;
  if (waitMilliseconds > 10_000) {
    fail("prepare-schedule-restart produced an unexpectedly distant missed occurrence");
  }
  if (waitMilliseconds > 0) {
    await delay(waitMilliseconds);
  }
  if (Date.now() <= nextRunAtMs) {
    await delay(nextRunAtMs - Date.now() + 1);
  }
}

function verifyTerminalScheduleProfile(profilePath, workspacePath) {
  const taskId = verifyTerminalProfile(profilePath, {
    state: "completed",
    eventType: "task.completed",
    artifactCount: 1,
    journeyKind: "prompt-artifact",
  });
  const database = new DatabaseSync(path.join(profilePath, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const rows = database
      .prepare(
        `SELECT name, last_status, last_incident_code, run_count, active_claim
         FROM aionui_schedule_jobs
         ORDER BY name`,
      )
      .all();
    const expected = new Map([
      [scheduleRunNowName, { status: "ok", incidentCode: null, runCount: 1 }],
      [scheduleMissedName, { status: "missed", incidentCode: "missed-occurrence", runCount: 0 }],
      [scheduleInterruptedName, { status: "error", incidentCode: "interrupted", runCount: 1 }],
    ]);
    if (
      rows.length !== expected.size ||
      databaseValue(database, "SELECT COUNT(*) FROM tasks") !== 1 ||
      databaseValue(database, "SELECT COUNT(*) FROM agent_attempt_evidence") !== 1 ||
      rows.some((row) => {
        const state = expected.get(row.name);
        return (
          state === undefined ||
          row.last_status !== state.status ||
          row.last_incident_code !== state.incidentCode ||
          row.run_count !== state.runCount ||
          row.active_claim !== null
        );
      })
    ) {
      fail("recover-schedule-restart did not persist exact run-now, missed, and interrupted state");
    }

    for (const fragment of [
      workspacePath,
      schedulePrompt,
      scheduleNativeConversationId,
      scheduleInterruptedClaim,
    ]) {
      const leakedCoreEventCount = database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM core_events
           WHERE instr(envelope_json, ?) > 0`,
        )
        .get(fragment).count;
      const leakedAuditCount = database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM privileged_audit_records
           WHERE instr(record_json, ?) > 0`,
        )
        .get(fragment).count;
      if (leakedCoreEventCount !== 0 || leakedAuditCount !== 0) {
        fail("Scheduled workload authority leaked into Core events or metadata audit");
      }
    }
    return taskId;
  } finally {
    database.close();
  }
}

try {
  if (process.platform !== "darwin") {
    fail("P4 schedule target-app smoke currently requires the macOS internal-test lane");
  }
  requireFile(builtMain, "Materialized production main entry");
  const packagedApp = findPackagedApp();
  const packagedExecutable = path.join(packagedApp, "Contents", "MacOS", "Actestra");
  requireFile(packagedExecutable, "Packaged Actestra executable");
  findPackagedAionCore(packagedApp);

  const scheduleProfile = path.join(smokeRoot, "schedule-restart-profile");
  const scheduleWorkspace = path.join(smokeRoot, "schedule-restart-workspace");
  const schedulePrepared = await runScenario(
    "prepare-schedule-restart",
    scheduleProfile,
    scheduleWorkspace,
    packagedExecutable,
  );
  if (
    schedulePrepared.status !== "prepared" ||
    schedulePrepared.taskCount !== 0 ||
    schedulePrepared.artifactCount !== 0 ||
    schedulePrepared.scheduleCount !== 3 ||
    schedulePrepared.missedCount !== 0 ||
    schedulePrepared.interruptedCount !== 0 ||
    schedulePrepared.skillUnsupported !== false
  ) {
    fail("prepare-schedule-restart returned the wrong durable schedule evidence");
  }
  const missedNextRunAtMs = verifyPreparedScheduleProfile(scheduleProfile);
  await waitUntilScheduleOccurrenceIsMissed(missedNextRunAtMs);

  const scheduleRecovered = await runScenario(
    "recover-schedule-restart",
    scheduleProfile,
    scheduleWorkspace,
    packagedExecutable,
  );
  if (
    scheduleRecovered.status !== "completed" ||
    scheduleRecovered.taskCount !== 1 ||
    scheduleRecovered.artifactCount !== 1 ||
    scheduleRecovered.scheduleCount !== 3 ||
    scheduleRecovered.missedCount !== 1 ||
    scheduleRecovered.interruptedCount !== 1 ||
    scheduleRecovered.skillUnsupported !== true
  ) {
    fail(
      "recover-schedule-restart returned the wrong terminal schedule or schedule-skill-unsupported evidence",
    );
  }
  const scheduleTaskId = verifyTerminalScheduleProfile(scheduleProfile, scheduleWorkspace);
  requireFile(
    path.join(scheduleWorkspace, ".actestra", "task-output", scheduleTaskId, "result.md"),
    "Recovered scheduled General Work artifact",
  );

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
  verifyPreparedProfile(restartProfile, {
    journeyKind: "workspace-file-artifact",
    contentReferenceCount: 2,
  });
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

  const toolFailureProfile = path.join(smokeRoot, "tool-failure-profile");
  const toolFailureWorkspace = path.join(smokeRoot, "tool-failure-workspace");
  const toolFailureSource = `${toolFailurePrivateMarker}\n${"x".repeat(
    maximumRepresentativeFileBytes,
  )}`;
  if (Buffer.byteLength(toolFailureSource, "utf8") <= maximumRepresentativeFileBytes) {
    fail("tool-failure fixture did not exceed the representative file transport bound");
  }
  fs.mkdirSync(toolFailureWorkspace, { recursive: true });
  fs.writeFileSync(
    path.join(toolFailureWorkspace, "actestra-input.txt"),
    toolFailureSource,
    "utf8",
  );
  const toolFailure = await runScenario(
    "prepare-tool-failure",
    toolFailureProfile,
    toolFailureWorkspace,
    packagedExecutable,
  );
  if (
    toolFailure.status !== "failed" ||
    toolFailure.taskCount !== 1 ||
    toolFailure.artifactCount !== 0
  ) {
    fail("prepare-tool-failure returned the wrong terminal evidence");
  }
  const toolFailureBeforeRestart = verifyToolFailureProfile(
    toolFailureProfile,
    toolFailureWorkspace,
  );
  const recoveredToolFailure = await runScenario(
    "recover-tool-failure",
    toolFailureProfile,
    toolFailureWorkspace,
    packagedExecutable,
  );
  if (
    recoveredToolFailure.status !== "failed" ||
    recoveredToolFailure.taskCount !== 1 ||
    recoveredToolFailure.artifactCount !== 0
  ) {
    fail("recover-tool-failure returned the wrong persisted terminal evidence");
  }
  const toolFailureAfterRestart = verifyToolFailureProfile(
    toolFailureProfile,
    toolFailureWorkspace,
  );
  if (
    toolFailureAfterRestart.taskId !== toolFailureBeforeRestart.taskId ||
    toolFailureAfterRestart.authoritySnapshot !== toolFailureBeforeRestart.authoritySnapshot
  ) {
    fail("recover-tool-failure changed terminal authority or re-executed the Worker");
  }

  const workerCrashProfile = path.join(smokeRoot, "worker-crash-profile");
  const workerCrashWorkspace = path.join(smokeRoot, "worker-crash-workspace");
  const workerCrash = await runScenario(
    "prepare-worker-crash",
    workerCrashProfile,
    workerCrashWorkspace,
    packagedExecutable,
  );
  if (
    workerCrash.status !== "failed" ||
    workerCrash.taskCount !== 1 ||
    workerCrash.artifactCount !== 0
  ) {
    fail("prepare-worker-crash returned the wrong terminal evidence");
  }
  const workerCrashBeforeRestart = verifyWorkerCrashProfile(
    workerCrashProfile,
    workerCrashWorkspace,
  );
  const recoveredWorkerCrash = await runScenario(
    "recover-worker-crash",
    workerCrashProfile,
    workerCrashWorkspace,
    packagedExecutable,
  );
  if (
    recoveredWorkerCrash.status !== "failed" ||
    recoveredWorkerCrash.taskCount !== 1 ||
    recoveredWorkerCrash.artifactCount !== 0
  ) {
    fail("recover-worker-crash returned the wrong persisted terminal evidence");
  }
  const workerCrashAfterRestart = verifyWorkerCrashProfile(
    workerCrashProfile,
    workerCrashWorkspace,
  );
  if (
    workerCrashAfterRestart.taskId !== workerCrashBeforeRestart.taskId ||
    workerCrashAfterRestart.authoritySnapshot !== workerCrashBeforeRestart.authoritySnapshot
  ) {
    fail("recover-worker-crash changed terminal authority or relaunched the Worker");
  }

  const writingProfile = path.join(smokeRoot, "writing-restart-profile");
  const writingWorkspace = path.join(smokeRoot, "writing-restart-workspace");
  const writingPrepared = await runScenario(
    "prepare-writing-restart",
    writingProfile,
    writingWorkspace,
    packagedExecutable,
  );
  if (writingPrepared.status !== "prepared") {
    fail("prepare-writing-restart returned the wrong status");
  }
  verifyPreparedProfile(writingProfile, {
    journeyKind: "writing-artifact",
    contentReferenceCount: 1,
  });
  const writingRecovered = await runScenario(
    "recover-writing-restart",
    writingProfile,
    writingWorkspace,
    packagedExecutable,
  );
  if (writingRecovered.status !== "completed" || writingRecovered.artifactCount !== 1) {
    fail("recover-writing-restart returned the wrong terminal evidence");
  }
  const writingTaskId = verifyTerminalProfile(writingProfile, {
    state: "completed",
    eventType: "task.completed",
    artifactCount: 1,
    artifactLabel: "Actestra writing draft",
    artifactKind: "document",
    contentReferenceCount: 3,
    journeyKind: "writing-artifact",
  });
  const writingOutput = path.join(
    writingWorkspace,
    ".actestra",
    "task-output",
    writingTaskId,
    "draft.md",
  );
  requireFile(writingOutput, "Recovered writing draft");
  const writingContents = fs.readFileSync(writingOutput, "utf8");
  const expectedWritingFragments = [
    "# Packaged restart-safe launch note",
    "Audience: Product leadership",
    "Explain the verified packaged release sequence.",
    "Start with the approved customer outcome.",
    "Close with the bounded next step.",
  ];
  if (expectedWritingFragments.some((fragment) => !writingContents.includes(fragment))) {
    fail("Recovered writing draft does not contain the structured brief");
  }
  const writingDatabase = new DatabaseSync(path.join(writingProfile, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const privateWritingFragments = ["draft.md", "# Packaged restart-safe launch note"];
    const leakedCoreEventCount = writingDatabase
      .prepare(
        `SELECT COUNT(*) AS count
         FROM core_events
         WHERE instr(envelope_json, ?) > 0 OR instr(envelope_json, ?) > 0`,
      )
      .get(...privateWritingFragments).count;
    const leakedAuditCount = writingDatabase
      .prepare(
        `SELECT COUNT(*) AS count
         FROM privileged_audit_records
         WHERE instr(record_json, ?) > 0 OR instr(record_json, ?) > 0`,
      )
      .get(...privateWritingFragments).count;
    if (leakedCoreEventCount !== 0 || leakedAuditCount !== 0) {
      fail("Private writing input leaked into normalized Core events or metadata audit");
    }
  } finally {
    writingDatabase.close();
  }

  const officeProfile = path.join(smokeRoot, "office-restart-profile");
  const officeWorkspace = path.join(smokeRoot, "office-restart-workspace");
  const officePrepared = await runScenario(
    "prepare-office-restart",
    officeProfile,
    officeWorkspace,
    packagedExecutable,
  );
  if (officePrepared.status !== "prepared") {
    fail("prepare-office-restart returned the wrong status");
  }
  verifyPreparedProfile(officeProfile, {
    journeyKind: "office-document-artifact",
    contentReferenceCount: 1,
  });
  const officeRecovered = await runScenario(
    "recover-office-restart",
    officeProfile,
    officeWorkspace,
    packagedExecutable,
  );
  if (officeRecovered.status !== "completed" || officeRecovered.artifactCount !== 1) {
    fail("recover-office-restart returned the wrong terminal evidence");
  }
  const officeTaskId = verifyTerminalProfile(officeProfile, {
    state: "completed",
    eventType: "task.completed",
    artifactCount: 1,
    artifactLabel: "Actestra Office document",
    artifactKind: "document",
    contentReferenceCount: 3,
    journeyKind: "office-document-artifact",
  });
  const officeOutput = path.join(
    officeWorkspace,
    ".actestra",
    "task-output",
    officeTaskId,
    "brief.docx",
  );
  requireFile(officeOutput, "Recovered Office document");
  verifyDocxPackage(officeOutput);
  const officeDatabase = new DatabaseSync(path.join(officeProfile, "state", "actestra.sqlite3"), {
    readOnly: true,
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
  try {
    const privateOfficeFragments = [
      "Product operations",
      "Record the exact Office package acceptance boundary.",
      "Ship the verified desktop workflow.",
      "Retain exact Core and Preview evidence.",
      "brief.docx",
    ];
    for (const fragment of privateOfficeFragments) {
      const leakedCoreEventCount = officeDatabase
        .prepare(
          `SELECT COUNT(*) AS count
           FROM core_events
           WHERE instr(envelope_json, ?) > 0`,
        )
        .get(fragment).count;
      const leakedAuditCount = officeDatabase
        .prepare(
          `SELECT COUNT(*) AS count
           FROM privileged_audit_records
           WHERE instr(record_json, ?) > 0`,
        )
        .get(fragment).count;
      if (leakedCoreEventCount !== 0 || leakedAuditCount !== 0) {
        fail("Private Office model or output path leaked into Core events or metadata audit");
      }
    }
  } finally {
    officeDatabase.close();
  }

  const researchProfile = path.join(smokeRoot, "local-research-profile");
  const researchWorkspace = path.join(smokeRoot, "local-research-workspace");
  const researchSourceLines = ["Packaged alpha evidence", "Packaged beta evidence"];
  fs.mkdirSync(researchWorkspace, { recursive: true });
  fs.writeFileSync(
    path.join(researchWorkspace, "actestra-research.txt"),
    `${researchSourceLines.join("\n")}\n`,
    "utf8",
  );
  const research = await runScenario(
    "local-research",
    researchProfile,
    researchWorkspace,
    packagedExecutable,
  );
  if (research.status !== "completed" || research.artifactCount !== 1) {
    fail("local-research returned the wrong terminal evidence");
  }
  const researchTaskId = verifyTerminalProfile(researchProfile, {
    state: "completed",
    eventType: "task.completed",
    artifactCount: 1,
    artifactLabel: "Actestra local research brief",
    journeyKind: "local-research-artifact",
  });
  const researchOutput = path.join(
    researchWorkspace,
    ".actestra",
    "task-output",
    researchTaskId,
    "research.md",
  );
  requireFile(researchOutput, "Local research Markdown artifact");
  const researchContents = fs.readFileSync(researchOutput, "utf8");
  if (
    !researchContents.includes("# Actestra local research brief") ||
    !researchContents.includes("Instruction: Compare the approved local source notes.") ||
    researchSourceLines.some((line) => !researchContents.includes(`- ${line}`))
  ) {
    fail("Local research Markdown artifact does not contain the bounded research brief");
  }
  const researchDatabase = new DatabaseSync(
    path.join(researchProfile, "state", "actestra.sqlite3"),
    {
      readOnly: true,
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
    },
  );
  try {
    const leakedCoreEventCount = researchDatabase
      .prepare(
        `SELECT COUNT(*) AS count
         FROM core_events
         WHERE instr(envelope_json, ?) > 0 OR instr(envelope_json, ?) > 0`,
      )
      .get(...researchSourceLines).count;
    if (leakedCoreEventCount !== 0) {
      fail("Local research source text leaked into normalized Core events");
    }
  } finally {
    researchDatabase.close();
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
    `Packaged target-app P4 representative-failure smoke passed: schema-${expectedPersistenceSchemaVersion} run-now, missed and interrupted recovery, representative workspace-file, exact content-too-large failure and stable restart projection, externally killed Worker and stable crash recovery, writing and Office restart recovery, real DOCX and owned Word Preview, local research, workspace-grant denial, cancellation, finalized checkpoints, events, artifacts, privacy, and terminal evidence are exact.`,
  );
} catch (error) {
  console.error(
    `Target-app P4 representative-failure smoke failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error(`Isolated smoke root retained for inspection: ${smokeRoot}`);
  process.exitCode = 1;
} finally {
  if (succeeded) {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}
