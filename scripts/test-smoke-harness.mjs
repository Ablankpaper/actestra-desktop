import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = path.join(repositoryRoot, "scripts", "smoke-packaged-app.mjs");
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
  PRAGMA user_version = 7;
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
