import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  P8_FRESH_PROFILE_FAILURE_CODES,
  P8_FRESH_PROFILE_TARGETS,
  makeP8FreshProfileFailureEvidence,
} from "./p8-fresh-profile-evidence.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const P8_FRESH_PROFILE_MARKER_PREFIX = "ACTESTRA_P8_FRESH_PROFILE_READY ";
export const P8_FRESH_PROFILE_FAILURE_MARKER_PREFIX = "ACTESTRA_P8_FRESH_PROFILE_FAILED ";
export const P8_FRESH_PROFILE_RESULT_FILE_NAME = "p8-fresh-profile-result.json";
export const P8_FRESH_PROFILE_MAX_OUTPUT_BYTES = 256 * 1024;
export const P8_FRESH_PROFILE_RESULT_MAX_BYTES = 4 * 1024;
export const P8_FRESH_PROFILE_STARTUP_TIMEOUT_MS = 60_000;
export const P8_FRESH_PROFILE_CLEANUP_TIMEOUT_MS = 10_000;
const MARKER_KEYS = Object.freeze(["providerCount", "providerUiState", "providerUiTextPresent"]);
const FAILURE_CODE_SET = new Set(P8_FRESH_PROFILE_FAILURE_CODES);
const RUNNING_STAGE_CODES = Object.freeze({
  "bootstrap-isolation": "startup-timeout-bootstrap-isolation",
  "bootstrap-user-data": "startup-timeout-bootstrap-user-data",
  "bootstrap-complete": "startup-timeout-bootstrap-complete",
  "app-ready": "startup-timeout-app-ready",
  "initialize-start": "startup-timeout-initialize",
  "initialize-complete": "startup-timeout-initialize-complete",
  "backend-start": "startup-timeout-backend",
  "backend-ready": "startup-timeout-backend-ready",
  "window-created": "startup-timeout-window",
  "renderer-loaded": "startup-timeout-renderer",
  "renderer-probe-started": "probe-timeout",
});

class P8FreshProfileSmokeError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

function smokeFailure(code, message) {
  throw new P8FreshProfileSmokeError(code, message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function appendOutput(current, chunk) {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") <= P8_FRESH_PROFILE_MAX_OUTPUT_BYTES) return next;
  return next.slice(-P8_FRESH_PROFILE_MAX_OUTPUT_BYTES);
}

/** Parse only the bounded E2E marker; all other child output is discarded. */
export function parseP8FreshProfileMarker(output) {
  if (typeof output !== "string") return Object.freeze({ ok: false, code: "marker-missing" });
  const signals = output.split(/\r?\n/u).flatMap((line) => {
    const markerIndex = line.indexOf(P8_FRESH_PROFILE_MARKER_PREFIX);
    if (markerIndex !== -1) {
      return [
        { kind: "ready", value: line.slice(markerIndex + P8_FRESH_PROFILE_MARKER_PREFIX.length) },
      ];
    }
    const failureIndex = line.indexOf(P8_FRESH_PROFILE_FAILURE_MARKER_PREFIX);
    return failureIndex === -1
      ? []
      : [
          {
            kind: "failed",
            value: line.slice(failureIndex + P8_FRESH_PROFILE_FAILURE_MARKER_PREFIX.length).trim(),
          },
        ];
  });
  if (signals.length === 0) return Object.freeze({ ok: false, code: "marker-missing" });
  if (signals.length > 1) return Object.freeze({ ok: false, code: "marker-duplicate" });
  const signal = signals[0];
  if (signal.kind === "failed") {
    return FAILURE_CODE_SET.has(signal.value)
      ? Object.freeze({ ok: false, code: signal.value })
      : Object.freeze({ ok: false, code: "marker-malformed" });
  }
  const payload = signal.value;
  let value;
  try {
    value = JSON.parse(payload);
  } catch {
    return Object.freeze({ ok: false, code: "marker-malformed" });
  }
  if (
    !hasExactKeys(value, MARKER_KEYS) ||
    !Number.isInteger(value.providerCount) ||
    value.providerCount < 0 ||
    typeof value.providerUiState !== "string" ||
    value.providerUiState.length === 0 ||
    typeof value.providerUiTextPresent !== "boolean"
  ) {
    return Object.freeze({ ok: false, code: "marker-malformed" });
  }
  if (value.providerCount !== 0) {
    return Object.freeze({ ok: false, code: "provider-projection-nonempty" });
  }
  if (value.providerUiState !== "provider-unavailable" || value.providerUiTextPresent !== true) {
    return Object.freeze({ ok: false, code: "provider-ui-state-missing" });
  }
  return Object.freeze({ ok: true, value: Object.freeze({ ...value }) });
}

/** Parse the optional Main-owned result file used when packaged GUI stdio is unavailable. */
export function parseP8FreshProfileResultFile(userData) {
  if (typeof userData !== "string" || userData.length === 0) {
    return Object.freeze({ ok: false, code: "marker-missing" });
  }
  const resultPath = path.join(userData, P8_FRESH_PROFILE_RESULT_FILE_NAME);
  let stat;
  try {
    stat = fs.lstatSync(resultPath, { throwIfNoEntry: false });
  } catch {
    return Object.freeze({ ok: false, code: "marker-malformed" });
  }
  if (stat === undefined) return Object.freeze({ ok: false, code: "marker-missing" });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > P8_FRESH_PROFILE_RESULT_MAX_BYTES) {
    return Object.freeze({ ok: false, code: "marker-malformed" });
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch {
    return Object.freeze({ ok: false, code: "marker-malformed" });
  }
  if (
    hasExactKeys(value, ["status", "providerCount", "providerUiState", "providerUiTextPresent"]) &&
    value.status === "verified" &&
    value.providerCount === 0 &&
    value.providerUiState === "provider-unavailable" &&
    value.providerUiTextPresent === true
  ) {
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        providerCount: 0,
        providerUiState: "provider-unavailable",
        providerUiTextPresent: true,
      }),
    });
  }
  if (
    hasExactKeys(value, ["status", "code"]) &&
    value.status === "failed" &&
    FAILURE_CODE_SET.has(value.code)
  ) {
    return Object.freeze({ ok: false, code: value.code });
  }
  if (
    hasExactKeys(value, ["status", "stage"]) &&
    value.status === "running" &&
    typeof value.stage === "string" &&
    Object.hasOwn(RUNNING_STAGE_CODES, value.stage)
  ) {
    return Object.freeze({
      ok: false,
      code: RUNNING_STAGE_CODES[value.stage],
      running: true,
    });
  }
  return Object.freeze({ ok: false, code: "marker-malformed" });
}

export function classifyP8FreshProfileRunningStage(stage) {
  return RUNNING_STAGE_CODES[stage] ?? "startup-timeout-before-app-ready";
}

function canonicalDirectory(value, label) {
  const state = fs.lstatSync(value, { throwIfNoEntry: false });
  if (state === undefined || !state.isDirectory() || state.isSymbolicLink()) {
    smokeFailure("profile-isolation-invalid", `${label} is not a real isolation directory`);
  }
  return fs.realpathSync.native(value);
}

function assertContained(candidate, root, label) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    smokeFailure("profile-isolation-invalid", `${label} escapes isolation root`);
  }
}

/** Create and validate the three E2E directories under one real root. */
export function resolveP8FreshProfileIsolation(isolationRoot) {
  if (!path.isAbsolute(isolationRoot)) {
    smokeFailure("profile-isolation-invalid", "isolation root must be absolute");
  }
  fs.mkdirSync(isolationRoot, { recursive: true, mode: 0o700 });
  const root = canonicalDirectory(isolationRoot, "isolation root");
  const directories = {
    isolationRoot: root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
  };
  for (const [label, directory] of Object.entries(directories).slice(1)) {
    const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink()) {
      smokeFailure("profile-isolation-invalid", `${label} isolation path is a symbolic link`);
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const canonical = canonicalDirectory(directory, label);
    assertContained(canonical, root, label);
    if (process.platform !== "win32") fs.chmodSync(directory, 0o700);
  }
  return Object.freeze(directories);
}

function assertRegularFile(filePath, label, code = "package-structure-invalid") {
  const state = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (state === undefined || !state.isFile() || state.isSymbolicLink()) {
    smokeFailure(code, `${label} is missing or not a regular file`);
  }
}

function sha256File(filePath, code = "package-missing") {
  assertRegularFile(filePath, "artifact", code);
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function resolveRuntimeDetails(targetId, runtimePath) {
  const target = P8_FRESH_PROFILE_TARGETS[targetId];
  if (target === undefined) smokeFailure("unsupported-target");
  const resolved = path.resolve(runtimePath);
  if (targetId === "macos-15-arm64") {
    const executable = path.join(resolved, "Contents", "MacOS", "Actestra");
    const appAsar = path.join(resolved, "Contents", "Resources", "app.asar");
    const state = fs.lstatSync(resolved, { throwIfNoEntry: false });
    if (state === undefined || !state.isDirectory() || state.isSymbolicLink()) {
      smokeFailure("package-structure-invalid");
    }
    assertRegularFile(executable, "macOS executable");
    assertRegularFile(appAsar, "macOS app.asar");
    return Object.freeze({ executable, appAsar, launchPath: executable });
  }
  assertRegularFile(resolved, "packaged executable");
  const appAsar = path.join(path.dirname(resolved), "resources", "app.asar");
  assertRegularFile(appAsar, "packaged app.asar");
  return Object.freeze({ executable: resolved, appAsar, launchPath: resolved });
}

function normalizePackages(targetId, packages) {
  const expected = P8_FRESH_PROFILE_TARGETS[targetId]?.packageFormats;
  if (!Array.isArray(packages) || expected === undefined || packages.length !== expected.length) {
    smokeFailure("package-structure-invalid");
  }
  return Object.freeze(
    packages.map((entry, index) => {
      if (!isRecord(entry) || entry.format !== expected[index] || typeof entry.path !== "string") {
        smokeFailure("package-structure-invalid");
      }
      return Object.freeze({
        format: entry.format,
        path: path.resolve(entry.path),
        sha256: sha256File(entry.path, "package-missing"),
      });
    }),
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function childOutcome(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ kind: "error", error }));
    child.once("close", (code, signal) => resolve({ kind: "exit", code, signal }));
  });
}

async function terminateChild(child, outcomePromise) {
  const existing = await Promise.race([outcomePromise, delay(1).then(() => undefined)]);
  if (existing !== undefined) return existing;
  try {
    child.kill("SIGTERM");
  } catch {
    return { kind: "exit", code: null, signal: "SIGTERM" };
  }
  return Promise.race([
    outcomePromise,
    delay(2_000).then(() => ({ kind: "exit", code: null, signal: "SIGTERM" })),
  ]);
}

function unixProcessRows() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8", timeout: 5_000 });
  return output
    .split(/\r?\n/u)
    .map((line) => /^\s*(\d+)\s+(\d+)\s*$/u.exec(line))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]) }));
}

function descendantPids(rows, rootPid) {
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
  return [...descendants].filter((pid) => pid !== rootPid);
}

function windowsProcessRows() {
  const script =
    "$rows = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress; Write-Output $rows";
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
  }));
}

function defaultSnapshotProcessTree(rootPid, observedPids = []) {
  try {
    const rows = process.platform === "win32" ? windowsProcessRows() : unixProcessRows();
    const livePids = new Set(rows.map(({ pid }) => pid));
    return {
      ok: true,
      pids: [
        ...new Set([
          ...descendantPids(rows, rootPid),
          ...observedPids.filter((pid) => livePids.has(pid)),
        ]),
      ],
    };
  } catch {
    return { ok: false };
  }
}

function readProfileAndSchema(userData) {
  const manifestPath = path.join(userData, "actestra-profile.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, code: "profile-manifest-invalid" };
  }
  if (
    !hasExactKeys(manifest, ["layoutVersion", "product"]) ||
    manifest.product !== "Actestra" ||
    manifest.layoutVersion !== 1
  ) {
    return { ok: false, code: "profile-manifest-invalid" };
  }
  const databasePath = path.join(userData, "state", "actestra.sqlite3");
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("PRAGMA user_version").get();
    if (row?.user_version !== 23) return { ok: false, code: "sqlite-schema-invalid" };
  } catch {
    return { ok: false, code: "sqlite-schema-invalid" };
  } finally {
    database?.close();
  }
  return { ok: true };
}

function buildSuccessEvidence({
  targetId,
  sourceCommit,
  packages,
  runtime,
  marker,
  residualProcessCount,
}) {
  return Object.freeze({
    schemaVersion: 1,
    status: "verified",
    targetId,
    sourceCommit,
    packages: packages.map(({ format, sha256 }) => ({ format, sha256 })),
    executableSha256: sha256File(runtime.executable),
    appAsarSha256: sha256File(runtime.appAsar),
    packageStructure: true,
    mainReady: true,
    rendererReady: true,
    providerIpc: true,
    directProviderFetchDenied: true,
    profileManifest: true,
    sqliteSchemaVersion: 23,
    providerCount: marker.providerCount,
    providerUiState: marker.providerUiState,
    providerUiTextPresent: marker.providerUiTextPresent,
    gracefulExit: true,
    residualProcessCount,
  });
}

function validCommit(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

/**
 * Launch one packaged target with an isolated profile. All failures are
 * reduced to the closed evidence record; no child output is returned.
 */
export async function runP8FreshProfileSmoke(options) {
  let isolation;
  let child;
  let outcomePromise;
  try {
    if (!isRecord(options) || typeof options.targetId !== "string") {
      smokeFailure("invalid-arguments");
    }
    if (P8_FRESH_PROFILE_TARGETS[options.targetId] === undefined) {
      smokeFailure("unsupported-target");
    }
    if (!validCommit(options.sourceCommit) || typeof options.runtimePath !== "string") {
      smokeFailure("invalid-arguments");
    }
    const runtime = resolveRuntimeDetails(options.targetId, options.runtimePath);
    const packages = normalizePackages(options.targetId, options.packages);
    const root =
      options.isolationRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-fresh-"));
    isolation = resolveP8FreshProfileIsolation(path.resolve(root));
    const environment = {
      ...process.env,
      ACTESTRA_E2E_TEST: "1",
      ACTESTRA_DISABLE_AUTO_UPDATE: "1",
      ACTESTRA_P8_FRESH_PROFILE_SMOKE: "1",
      ACTESTRA_USER_DATA_DIR: isolation.userData,
      ACTESTRA_E2E_ISOLATION_ROOT: isolation.isolationRoot,
      ACTESTRA_E2E_HOME_DIR: isolation.home,
      ACTESTRA_E2E_TEMP_DIR: isolation.temp,
      HOME: isolation.home,
      USERPROFILE: isolation.home,
      TMPDIR: isolation.temp,
      TMP: isolation.temp,
      TEMP: isolation.temp,
    };
    const spawnChild =
      options.spawnChild ??
      ((executable, args, spawnOptions) => spawn(executable, args, spawnOptions));
    child = spawnChild(runtime.launchPath, [], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!child || !Number.isInteger(child.pid) || child.pid <= 0) {
      smokeFailure("spawn-failed");
    }
    outcomePromise = childOutcome(child);
    const snapshotProcessTree = options.snapshotProcessTree ?? defaultSnapshotProcessTree;
    const initialSnapshot = snapshotProcessTree(child.pid);
    if (!initialSnapshot?.ok) smokeFailure("process-probe-failed");
    const observedPids = new Set(initialSnapshot.pids);
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output = appendOutput(output, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output = appendOutput(output, chunk);
    });

    const readSignal = () => {
      const fileSignal = parseP8FreshProfileResultFile(isolation.userData);
      if (fileSignal.ok || (fileSignal.code !== "marker-missing" && !fileSignal.running)) {
        return fileSignal;
      }
      const outputSignal = parseP8FreshProfileMarker(output);
      return outputSignal.code === "marker-missing" ? fileSignal : outputSignal;
    };
    const timeoutMs = options.timeoutMs ?? P8_FRESH_PROFILE_STARTUP_TIMEOUT_MS;
    const startedAt = Date.now();
    let markerResult;
    while (Date.now() - startedAt < timeoutMs) {
      const runtimeSnapshot = snapshotProcessTree(child.pid, [...observedPids]);
      if (!runtimeSnapshot?.ok) smokeFailure("process-probe-failed");
      for (const pid of runtimeSnapshot.pids) observedPids.add(pid);
      markerResult = readSignal();
      if (markerResult.ok || (markerResult.code !== "marker-missing" && !markerResult.running))
        break;
      const outcome = await Promise.race([outcomePromise, delay(25).then(() => undefined)]);
      if (outcome !== undefined) {
        markerResult = readSignal();
        if (markerResult.ok || (markerResult.code !== "marker-missing" && !markerResult.running))
          break;
        if (markerResult.running) smokeFailure(markerResult.code);
        smokeFailure(outcome.kind === "error" ? "spawn-failed" : "early-exit");
      }
    }
    markerResult ??= readSignal();
    if (!markerResult.ok) {
      if (markerResult.running) smokeFailure(markerResult.code);
      if (markerResult.code === "marker-missing") {
        smokeFailure("startup-timeout-before-app-ready");
      }
      smokeFailure(markerResult.code);
    }

    const outcome = await Promise.race([
      outcomePromise,
      delay(options.cleanupTimeoutMs ?? P8_FRESH_PROFILE_CLEANUP_TIMEOUT_MS).then(() => undefined),
    ]);
    if (outcome === undefined) {
      await terminateChild(child, outcomePromise);
      smokeFailure("non-graceful-exit");
    }
    if (outcome.kind === "error" || outcome.code !== 0 || outcome.signal !== null) {
      smokeFailure("non-graceful-exit");
    }

    const finalSnapshot = snapshotProcessTree(child.pid, [...observedPids]);
    if (!finalSnapshot?.ok) smokeFailure("process-probe-failed");
    if (finalSnapshot.pids.length > 0) smokeFailure("residual-processes");
    const durable = readProfileAndSchema(isolation.userData);
    if (!durable.ok) smokeFailure(durable.code);
    const evidence = buildSuccessEvidence({
      targetId: options.targetId,
      sourceCommit: options.sourceCommit,
      packages,
      runtime,
      marker: markerResult.value,
      residualProcessCount: 0,
    });
    return Object.freeze({
      evidence,
      binding: Object.freeze({
        targetId: options.targetId,
        sourceCommit: options.sourceCommit,
        packages,
        executableSha256: evidence.executableSha256,
        appAsarSha256: evidence.appAsarSha256,
      }),
    });
  } catch (error) {
    if (child && outcomePromise) await terminateChild(child, outcomePromise).catch(() => undefined);
    const targetId = options?.targetId;
    const sourceCommit = options?.sourceCommit;
    const code = error instanceof P8FreshProfileSmokeError ? error.code : "early-exit";
    const safeCode = FAILURE_CODE_SET.has(code) ? code : "early-exit";
    const boundedTarget =
      typeof targetId === "string" && P8_FRESH_PROFILE_TARGETS[targetId] !== undefined
        ? targetId
        : "unknown";
    const boundedCommit = validCommit(sourceCommit) ? sourceCommit : "0".repeat(40);
    const boundedCode =
      boundedTarget === "unknown"
        ? typeof targetId === "string"
          ? "unsupported-target"
          : "invalid-arguments"
        : safeCode;
    return Object.freeze({
      evidence: makeP8FreshProfileFailureEvidence(boundedTarget, boundedCommit, boundedCode),
    });
  } finally {
    if (isolation && options?.retainIsolation !== true) {
      fs.rmSync(isolation.isolationRoot, { recursive: true, force: true });
    }
  }
}

function parseArguments(argv) {
  const parsed = { packages: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--target" ||
      argument === "--runtime" ||
      argument === "--source-commit" ||
      argument === "--evidence"
    ) {
      const value = argv[++index];
      if (!value) throw new Error("invalid-arguments");
      parsed[
        {
          "--target": "targetId",
          "--runtime": "runtimePath",
          "--source-commit": "sourceCommit",
          "--evidence": "evidencePath",
        }[argument]
      ] = value;
      continue;
    }
    if (argument === "--package") {
      const value = argv[++index];
      const separator = value?.indexOf("=");
      if (!value || separator < 1) throw new Error("invalid-arguments");
      parsed.packages.push({ format: value.slice(0, separator), path: value.slice(separator + 1) });
      continue;
    }
    throw new Error("invalid-arguments");
  }
  return parsed;
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch {
    process.exitCode = 1;
    return;
  }
  const result = await runP8FreshProfileSmoke(parsed);
  if (parsed.evidencePath) {
    fs.mkdirSync(path.dirname(path.resolve(parsed.evidencePath)), { recursive: true });
    fs.writeFileSync(path.resolve(parsed.evidencePath), `${JSON.stringify(result.evidence)}\n`, {
      mode: 0o600,
    });
  }
  process.stdout.write(`${JSON.stringify(result.evidence)}\n`);
  if (result.evidence.status !== "verified") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
