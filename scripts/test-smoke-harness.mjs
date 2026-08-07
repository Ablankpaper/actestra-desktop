import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = path.join(repositoryRoot, "scripts", "smoke-packaged-app.mjs");
const generalWorkSmokeScript = path.join(
  repositoryRoot,
  "scripts",
  "smoke-aionui-general-work.mjs",
);
const scheduledGeneralWorkPatch = path.join(
  repositoryRoot,
  "downstream",
  "aionui-v2.1.41",
  "patches",
  "0011-actestra-scheduled-general-work.mjs",
);
const packagedVerificationScript = path.join(repositoryRoot, "scripts", "verify-packaged-app.mjs");
const ciWorkflow = path.join(repositoryRoot, ".github", "workflows", "ci.yml");
const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-smoke-harness-"));

function createAppBundle(name, executableSource, mode = 0o700) {
  const appBundle = path.join(harnessRoot, `${name}.app`);
  const executableDirectory = path.join(appBundle, "Contents", "MacOS");
  const executable = path.join(executableDirectory, "Actestra");
  fs.mkdirSync(executableDirectory, { recursive: true });
  fs.writeFileSync(executable, executableSource, { mode });
  return appBundle;
}

function runSmoke(appBundle) {
  return spawnSync(process.execPath, [smokeScript, appBundle], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const packagedSmokeSource = fs.readFileSync(smokeScript, "utf8");
  assert(
    packagedSmokeSource.includes("const expectedPersistenceSchemaVersion = 17;"),
    "Packaged shell smoke must validate the current schema 17 database",
  );

  const generalWorkSmokeSource = fs.readFileSync(generalWorkSmokeScript, "utf8");
  assert(
    generalWorkSmokeSource.includes("const startupTimeoutMs = 60_000;"),
    "General Work target-app smoke must keep a bounded one-minute startup deadline",
  );
  assert(
    generalWorkSmokeSource.includes("const expectedPersistenceSchemaVersion = 17;"),
    "General Work target-app smoke must validate the current schema 17 database",
  );
  assert(
    generalWorkSmokeSource.includes('"actestra-input.txt"') &&
      generalWorkSmokeSource.includes("workspace-file-artifact"),
    "General Work target-app restart smoke must exercise the representative workspace-file journey",
  );
  assert(
    generalWorkSmokeSource.includes('"prepare-tool-failure"') &&
      generalWorkSmokeSource.includes('"recover-tool-failure"') &&
      generalWorkSmokeSource.includes('"content-too-large"') &&
      generalWorkSmokeSource.includes('"tool.failed"') &&
      generalWorkSmokeSource.includes('"task.failed"') &&
      generalWorkSmokeSource.includes("general_work_checkpoints") &&
      generalWorkSmokeSource.includes("privileged_audit_records") &&
      generalWorkSmokeSource.includes("mayHaveExecuted") &&
      generalWorkSmokeSource.includes("toolFailurePrivateMarker"),
    "General Work target-app smoke must prove a private representative tool failure and stable restart projection",
  );
  assert(
    generalWorkSmokeSource.includes('"prepare-worker-crash"') &&
      generalWorkSmokeSource.includes('"recover-worker-crash"') &&
      generalWorkSmokeSource.includes('"ACTESTRA_UTILITY_ROLE=general-worker"') &&
      generalWorkSmokeSource.includes('"eww"') &&
      !generalWorkSmokeSource.includes('command.includes("Actestra General Worker")') &&
      generalWorkSmokeSource.includes(
        '"startup: managed runtime background preparation completed"',
      ) &&
      generalWorkSmokeSource.includes("output.includes(backendRuntimeReadyMarker)") &&
      /scenario === "prepare-worker-crash" &&\s+workerPid === undefined &&\s+targetAppIsReady\(output\)/u.test(
        generalWorkSmokeSource,
      ) &&
      generalWorkSmokeSource.includes('process.kill(workerPid, "SIGKILL")') &&
      generalWorkSmokeSource.includes("describeChildOutcome(outcome)") &&
      generalWorkSmokeSource.includes("signal=${String(outcome.signal)}") &&
      generalWorkSmokeSource.includes('"worker-process-exit"') &&
      generalWorkSmokeSource.includes('workers[0]?.state !== "crashed"') &&
      generalWorkSmokeSource.includes('checkpoint.attempt?.state !== "crashed"') &&
      generalWorkSmokeSource.includes('checkpoint.attempt?.taskState !== "failed"') &&
      generalWorkSmokeSource.includes('"task.updated", "worker.failed", "task.failed"') &&
      generalWorkSmokeSource.includes("agent_attempt_evidence") &&
      generalWorkSmokeSource.includes('output.includes("ACTESTRA_GENERAL_WORKER_READY")') &&
      generalWorkSmokeSource.includes("P4 representative-failure smoke passed"),
    "General Work target-app smoke must kill the packaged Worker process and prove stable Core-owned crash recovery",
  );
  assert(
    generalWorkSmokeSource.includes(
      "const canonicalWorkspacePath = fs.realpathSync(workspacePath);",
    ) &&
      generalWorkSmokeSource.includes("grants[0]?.root_path !== canonicalWorkspacePath") &&
      generalWorkSmokeSource.includes("output.includes(canonicalWorkspacePath)") &&
      generalWorkSmokeSource.includes("canonicalWorkspacePath,\n      workspacePath,"),
    "General Work tool-failure smoke must compare and redact the canonical workspace path",
  );
  assert(
    generalWorkSmokeSource.includes('"actestra-research.txt"') &&
      generalWorkSmokeSource.includes("local-research-artifact") &&
      generalWorkSmokeSource.includes('"research.md"'),
    "General Work target-app smoke must exercise the bounded local-research journey",
  );
  assert(
    generalWorkSmokeSource.includes('"prepare-writing-restart"') &&
      generalWorkSmokeSource.includes('"recover-writing-restart"') &&
      generalWorkSmokeSource.includes("writing-artifact") &&
      generalWorkSmokeSource.includes('"draft.md"') &&
      generalWorkSmokeSource.includes('artifactKind: "document"'),
    "General Work target-app smoke must recover the bounded writing journey as a document",
  );
  assert(
    generalWorkSmokeSource.includes('"prepare-office-restart"') &&
      generalWorkSmokeSource.includes('"recover-office-restart"') &&
      generalWorkSmokeSource.includes("office-document-artifact") &&
      generalWorkSmokeSource.includes('"brief.docx"') &&
      generalWorkSmokeSource.includes('"[Content_Types].xml"') &&
      generalWorkSmokeSource.includes('artifactLabel: "Actestra Office document"'),
    "General Work target-app smoke must recover a real bounded Office document",
  );
  assert(
    generalWorkSmokeSource.includes('"prepare-schedule-restart"') &&
      generalWorkSmokeSource.includes('"recover-schedule-restart"') &&
      generalWorkSmokeSource.includes("aionui_schedule_jobs") &&
      generalWorkSmokeSource.includes("Schedule smoke run-now") &&
      generalWorkSmokeSource.includes("next_run_at_ms") &&
      generalWorkSmokeSource.includes("active_claim") &&
      generalWorkSmokeSource.includes("last_incident_code") &&
      generalWorkSmokeSource.includes("missed-occurrence") &&
      generalWorkSmokeSource.includes("interrupted") &&
      generalWorkSmokeSource.includes("schedule-smoke-interrupted-claim") &&
      generalWorkSmokeSource.includes("schedule-skill-unsupported") &&
      generalWorkSmokeSource.includes("ACTESTRA_RENDERER_PROVIDER_SMOKE_READY") &&
      generalWorkSmokeSource.includes("schema-${expectedPersistenceSchemaVersion}"),
    "General Work target-app smoke must prove current-schema scheduling and one renderer provider request",
  );

  const scheduledGeneralWorkPatchSource = fs.readFileSync(scheduledGeneralWorkPatch, "utf8");
  assert(
    scheduledGeneralWorkPatchSource.includes("const port = window.__backendPort;") &&
      scheduledGeneralWorkPatchSource.includes(
        "!Number.isSafeInteger(port) || port < 1 || port > 65_535",
      ) &&
      !scheduledGeneralWorkPatchSource.includes("backendPortDeadline") &&
      !scheduledGeneralWorkPatchSource.includes(
        "await new Promise((resolve) => setTimeout(resolve, 25));",
      ),
    "Schedule target-app provider probe must fail immediately when the sandboxed preload is unavailable",
  );

  const packagedVerificationSource = fs.readFileSync(packagedVerificationScript, "utf8");
  assert(
    packagedVerificationSource.includes("node_modules/croner/LICENSE") &&
      packagedVerificationSource.includes("actestra:schedule-request-v1") &&
      packagedVerificationSource.includes("schedule-skill-unsupported") &&
      packagedVerificationSource.includes("/api/cron/internal/system-resume"),
    "Packaged verification must prove Croner attribution and the Actestra schedule provider boundary",
  );
  assert(
    packagedVerificationSource.includes('extractArchiveText("out/preload/index.js")') &&
      packagedVerificationSource.includes('new Set(["electron"])') &&
      packagedVerificationSource.includes("sandboxed preload imports unsupported module"),
    "Packaged verification must reject dependencies unavailable to Electron's sandboxed preload",
  );
  assert(
    packagedVerificationSource.includes('"out/main/actestra-persistence-utility.js"') &&
      packagedVerificationSource.includes('"out/main/actestra-general-worker.js"') &&
      packagedVerificationSource.includes(
        "packagedPersistenceGraph.includes(requiredScheduleMarker)",
      ),
    "Packaged verification must inspect the emitted isolated utility entry graphs",
  );
  assert(
    packagedVerificationSource.includes("fs.createReadStream(archivePath)") &&
      !packagedVerificationSource.includes('execFileSync("/usr/bin/strings"'),
    "Packaged verification must scan large archives without a fixed child-process output buffer",
  );
  assert(
    packagedVerificationSource.includes(
      "packaged main graph does not prove that telemetry is disabled",
    ) && !packagedVerificationSource.includes('{ label: "Sentry"'),
    "Packaged verification must prove disabled telemetry without rejecting retained Sentry source",
  );
  assert(
    packagedVerificationSource.includes(
      "packaged main graph does not prove that upstream services are isolated",
    ) &&
      packagedVerificationSource.includes(
        "packaged main graph does not prove that updates are isolated",
      ) &&
      !packagedVerificationSource.includes('{ label: "iofficeai"') &&
      !packagedVerificationSource.includes('{ label: "static.aionui.com"') &&
      !packagedVerificationSource.includes("undeclared AionUi identity appears"),
    "Packaged verification must prove F1 isolation without rejecting retained compatibility source",
  );
  assert(
    packagedVerificationSource.includes(
      "packaged renderer script-src permits unsafe inline execution",
    ) &&
      packagedVerificationSource.includes("packaged renderer CSP is missing base-uri 'none'") &&
      packagedVerificationSource.includes('"http://127.0.0.1:*"') &&
      packagedVerificationSource.includes('"ws://127.0.0.1:*"') &&
      packagedVerificationSource.includes("unexpected packaged renderer connect-src"),
    "Packaged verification must retain only the exact loopback renderer connection boundary",
  );

  const ciWorkflowSource = fs.readFileSync(ciWorkflow, "utf8");
  const materializedPackageStep = `      - name: Build local materialized AionUi app bundle
        working-directory: .actestra/aionui-v2.1.41
        run: bun run dist:mac -- --arm64 --dir --skip-vite`;
  assert(
    ciWorkflowSource.includes(materializedPackageStep) &&
      ciWorkflowSource.includes(
        "bun run verify:package -- .actestra/aionui-v2.1.41/out/mac-arm64/Actestra.app",
      ) &&
      ciWorkflowSource.includes("bun run smoke:aionui-general-work") &&
      !ciWorkflowSource.includes("run: bun run dist:dir"),
    "CI must package, verify, and smoke the materialized native AionUi application",
  );

  const earlyExit = runSmoke(createAppBundle("early-exit", "#!/bin/sh\nexit 7\n"));
  assert(earlyExit.status === 1, "early exit must fail the smoke check");
  assert(
    combinedOutput(earlyExit).includes("exit code 7"),
    "early exit failure must report its exit code",
  );

  const spawnError = runSmoke(createAppBundle("spawn-error", "#!/bin/sh\nexit 0\n", 0o600));
  assert(spawnError.status === 1, "spawn errors must fail the smoke check");
  assert(
    combinedOutput(spawnError).includes("spawn error"),
    "spawn errors must be reported explicitly",
  );

  const ignoresSigtermSource = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
fs.mkdirSync(process.env.ACTESTRA_USER_DATA_DIR, { recursive: true });
fs.writeFileSync(
  path.join(process.env.ACTESTRA_USER_DATA_DIR, "data-layout.json"),
  JSON.stringify({ product: "Actestra", layoutVersion: 1 }),
);
const stateDirectory = path.join(process.env.ACTESTRA_USER_DATA_DIR, "state");
fs.mkdirSync(stateDirectory, { recursive: true });
const database = new DatabaseSync(path.join(stateDirectory, "actestra.sqlite3"));
database.exec(\`
  CREATE TABLE workspace_grants (id TEXT PRIMARY KEY) STRICT;
  CREATE TABLE content_references (id TEXT PRIMARY KEY) STRICT;
  PRAGMA user_version = 17;
\`);
database.close();
console.log("ACTESTRA_PERSISTENCE_UTILITY_READY");
console.log("ACTESTRA_GENERAL_WORKER_READY");
console.log("ACTESTRA_READY");
console.log("ACTESTRA_WINDOW_READY");
console.log("ACTESTRA_RENDERER_READY");
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`;
  const forcedTermination = runSmoke(createAppBundle("ignores-sigterm", ignoresSigtermSource));
  assert(forcedTermination.status === 0, "SIGKILL fallback must complete the smoke check");
  assert(
    combinedOutput(forcedTermination).includes("Packaged smoke passed"),
    "SIGKILL fallback must preserve the successful validation result",
  );

  console.info(
    "Smoke harness passed: early exit, spawn error, and SIGKILL fallback are deterministic.",
  );
} finally {
  fs.rmSync(harnessRoot, { recursive: true, force: true });
}
