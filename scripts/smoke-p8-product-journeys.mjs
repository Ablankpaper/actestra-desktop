import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { chmod, lstat, mkdir, realpath, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  P8_PRODUCT_JOURNEY_FAILURE_CODES,
  P8_PRODUCT_JOURNEY_IDS,
  makeP8ProductJourneyFailureEvidence,
  validateP8ProductJourneyEvidence,
} from "./p8-product-journey-evidence.mjs";
import { P8_PLATFORM_MATRIX } from "./p8-platform-matrix.mjs";

export const P8_PRODUCT_JOURNEY_RESULT_FILE_NAME = "p8-product-journeys-result.json";
export const P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME = "p8-product-journeys-failure.json";
export const P8_PRODUCT_JOURNEY_RESTART_JOURNAL_FILE_NAME = "p8-product-journeys-restart.json";
export const P8_PRODUCT_JOURNEY_RESULT_MAX_BYTES = 32 * 1024;
export const P8_PRODUCT_JOURNEY_FAILURE_MAX_BYTES = 4 * 1024;
const P8_PRODUCT_JOURNEY_RESTART_JOURNAL_MAX_BYTES = 8 * 1024;
const P8_PRODUCT_JOURNEY_DIAGNOSTIC_MAX_BYTES = 4 * 1024;

const TARGETS = new Map(
  P8_PLATFORM_MATRIX.targets.map((target) => [
    target.id,
    Object.freeze({
      id: target.id,
      packageFormats: Object.freeze([...target.packageFormats]),
    }),
  ]),
);
const RESULT_KEYS = Object.freeze(["journeys", "schemaVersion", "status"]);
const JOURNEY_KEYS = Object.freeze(["id", "residualProcessCount", "status"]);
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const CI_RUN_PATTERN = /^[1-9][0-9]{0,19}$/u;
const FAILURE_CODE_SET = new Set(P8_PRODUCT_JOURNEY_FAILURE_CODES);
const RUNTIME_FAILURE_CODE_SET = new Set([
  ...P8_PRODUCT_JOURNEY_FAILURE_CODES,
  "invalid-environment",
  "privacy-redaction-failed",
  "result-write-failed",
]);
const P8_PRODUCT_JOURNEY_DIAGNOSTIC_STAGES = new Set([
  "startup-recovery",
  ...P8_PRODUCT_JOURNEY_IDS,
  "model-binding",
  "user-data",
  "runner-package",
  "runner-admission",
  "git-executable",
  "private-root",
  "runtime-startup",
  "persistence",
  "general-work",
  "coding-journey",
  "coding-artifact",
  "isolated-coding",
  "team-composition",
  "general-recovery",
  "schedule-recovery",
  "team-recovery",
]);
const P8_PRODUCT_JOURNEY_RUNTIME_DIAGNOSTIC_STAGES = new Set([
  "model-binding",
  "user-data",
  "runner-package",
  "runner-admission",
  "git-executable",
  "private-root",
  "runtime-startup",
  "persistence",
  "general-work",
  "coding-journey",
  "coding-artifact",
  "isolated-coding",
  "team-composition",
  "general-recovery",
  "schedule-recovery",
  "team-recovery",
]);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class P8ProductJourneySmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = "P8ProductJourneySmokeError";
    this.code = code;
  }
}

/**
 * Accept only the packaged app's fixed diagnostic line. Raw app output is
 * intentionally discarded so paths, provider payloads, and other private
 * values cannot cross the acceptance boundary.
 */
export function classifyP8ProductJourneyDiagnosticLine(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > P8_PRODUCT_JOURNEY_DIAGNOSTIC_MAX_BYTES
  ) {
    return undefined;
  }
  const match = /^ACTESTRA_P8_PRODUCT_JOURNEYS_FAILED (\{[^\r\n]*\})$/u.exec(value);
  if (match === null) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["code", "stage"]) ||
    parsed.code !== "journey-failed" ||
    typeof parsed.stage !== "string" ||
    !P8_PRODUCT_JOURNEY_DIAGNOSTIC_STAGES.has(parsed.stage)
  ) {
    return undefined;
  }
  return Object.freeze({ code: "journey-failed", stage: parsed.stage });
}

/**
 * Accept only the packaged app's fixed runtime-startup boundary token. This is
 * deliberately separate from the journey failure vocabulary so a startup
 * admission detail cannot be mistaken for a completed journey stage.
 */
export function classifyP8ProductJourneyRuntimeDiagnosticLine(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > P8_PRODUCT_JOURNEY_DIAGNOSTIC_MAX_BYTES
  ) {
    return undefined;
  }
  const match = /^ACTESTRA_P8_PRODUCT_JOURNEYS_RUNTIME_FAILED (\{[^\r\n]*\})$/u.exec(value);
  if (match === null) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  if (
    !hasExactKeys(parsed, ["stage"]) ||
    typeof parsed.stage !== "string" ||
    !P8_PRODUCT_JOURNEY_RUNTIME_DIAGNOSTIC_STAGES.has(parsed.stage)
  ) {
    return undefined;
  }
  return Object.freeze({ runtimeStage: parsed.stage });
}

/**
 * Read only the packaged app's private, write-once failure projection. The
 * controller never exposes raw Electron output or file contents; it returns
 * only this closed code/stage pair alongside its own outer failure code.
 */
export async function parseP8ProductJourneyFailureFile(userData) {
  if (typeof userData !== "string" || !path.isAbsolute(userData)) return undefined;
  const failurePath = path.join(userData, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME);
  let metadata;
  try {
    metadata = await lstat(failurePath);
  } catch {
    return undefined;
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size === 0 ||
    metadata.size > P8_PRODUCT_JOURNEY_FAILURE_MAX_BYTES ||
    (process.platform !== "win32" && (metadata.mode & 0o777) !== 0o600)
  ) {
    return undefined;
  }
  let contents;
  let value;
  try {
    contents = await readFile(failurePath, "utf8");
    value = JSON.parse(contents);
  } catch {
    return undefined;
  }
  if (
    !hasExactKeys(value, ["code", "stage"]) ||
    typeof value.code !== "string" ||
    !RUNTIME_FAILURE_CODE_SET.has(value.code) ||
    typeof value.stage !== "string" ||
    !P8_PRODUCT_JOURNEY_DIAGNOSTIC_STAGES.has(value.stage) ||
    contents !== `${JSON.stringify(value)}\n`
  ) {
    return undefined;
  }
  return Object.freeze({ code: value.code, stage: value.stage });
}

function observeP8ProductJourneyDiagnostics(stream, onDiagnostic) {
  if (stream === null || typeof stream?.on !== "function") return;
  let pending = "";
  stream.on("data", (chunk) => {
    if (typeof chunk !== "string" && !Buffer.isBuffer(chunk)) return;
    pending += chunk.toString("utf8");
    if (Buffer.byteLength(pending, "utf8") > P8_PRODUCT_JOURNEY_DIAGNOSTIC_MAX_BYTES) {
      pending = pending.slice(-P8_PRODUCT_JOURNEY_DIAGNOSTIC_MAX_BYTES);
    }
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const diagnostic = classifyP8ProductJourneyDiagnosticLine(line);
      if (diagnostic !== undefined) {
        onDiagnostic(diagnostic);
        continue;
      }
      const runtimeDiagnostic = classifyP8ProductJourneyRuntimeDiagnosticLine(line);
      if (runtimeDiagnostic !== undefined) onDiagnostic(runtimeDiagnostic);
    }
  });
}

function smokeFailure(code) {
  throw new P8ProductJourneySmokeError(code);
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

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function requireCanonicalDirectory(directory, code) {
  let metadata;
  let canonical;
  try {
    [metadata, canonical] = await Promise.all([lstat(directory), realpath(directory)]);
  } catch {
    smokeFailure(code);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== directory) {
    smokeFailure(code);
  }
  return canonical;
}

async function requireRegularFile(filePath, code) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch {
    smokeFailure(code);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) smokeFailure(code);
  return filePath;
}

async function sha256File(filePath, code = "package-missing") {
  await requireRegularFile(filePath, code);
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function resolveP8ProductJourneyRuntime(targetId, runtimePath) {
  if (!TARGETS.has(targetId) || typeof runtimePath !== "string" || runtimePath.length === 0) {
    smokeFailure(TARGETS.has(targetId) ? "package-structure-invalid" : "unsupported-target");
  }
  const resolved = path.resolve(runtimePath);
  if (targetId === "macos-15-arm64") {
    await requireCanonicalDirectory(resolved, "package-structure-invalid");
    const executable = path.join(resolved, "Contents", "MacOS", "Actestra");
    const appAsar = path.join(resolved, "Contents", "Resources", "app.asar");
    await Promise.all([
      requireRegularFile(executable, "package-structure-invalid"),
      requireRegularFile(appAsar, "package-structure-invalid"),
    ]);
    return Object.freeze({
      executable,
      appAsar,
      launchPath: executable,
      resourcesPath: path.join(resolved, "Contents", "Resources"),
    });
  }
  await requireRegularFile(resolved, "package-structure-invalid");
  const appAsar = path.join(path.dirname(resolved), "resources", "app.asar");
  await requireRegularFile(appAsar, "package-structure-invalid");
  return Object.freeze({
    executable: resolved,
    appAsar,
    launchPath: resolved,
    resourcesPath: path.join(path.dirname(resolved), "resources"),
  });
}

export async function normalizeP8ProductJourneyPackages(targetId, packages) {
  const target = TARGETS.get(targetId);
  if (target === undefined) smokeFailure("unsupported-target");
  if (!Array.isArray(packages) || packages.length !== target.packageFormats.length) {
    smokeFailure("package-structure-invalid");
  }
  const result = [];
  for (const [index, entry] of packages.entries()) {
    if (
      !hasExactKeys(entry, ["format", "path"]) ||
      entry.format !== target.packageFormats[index] ||
      typeof entry.path !== "string" ||
      entry.path.length === 0
    ) {
      smokeFailure("package-structure-invalid");
    }
    const packagePath = path.resolve(entry.path);
    result.push(
      Object.freeze({
        format: entry.format,
        path: packagePath,
        sha256: await sha256File(packagePath),
      }),
    );
  }
  return Object.freeze(result);
}

export async function resolveP8ProductJourneyIsolation(isolationRoot) {
  if (typeof isolationRoot !== "string" || !path.isAbsolute(isolationRoot)) {
    smokeFailure("profile-isolation-invalid");
  }
  const resolved = path.resolve(isolationRoot);
  const existing = await lstat(resolved).catch(() => undefined);
  if (existing?.isSymbolicLink()) smokeFailure("profile-isolation-invalid");
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const root = await requireCanonicalDirectory(resolved, "profile-isolation-invalid");
  const directories = {
    isolationRoot: root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
    workspace: path.join(root, "workspace"),
  };
  for (const directory of [
    directories.userData,
    directories.home,
    directories.temp,
    directories.workspace,
  ]) {
    const child = await lstat(directory).catch(() => undefined);
    if (child?.isSymbolicLink()) smokeFailure("profile-isolation-invalid");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const canonical = await requireCanonicalDirectory(directory, "profile-isolation-invalid");
    if (!isInside(root, canonical)) smokeFailure("profile-isolation-invalid");
    if (process.platform !== "win32") await chmod(canonical, 0o700);
  }
  try {
    const gitDirectory = path.join(directories.workspace, ".git");
    if (!fs.existsSync(gitDirectory)) {
      execFileSync("git", ["init", "--quiet", directories.workspace], {
        stdio: "ignore",
        timeout: 10_000,
      });
      execFileSync("git", ["-C", directories.workspace, "config", "user.name", "Actestra P8"], {
        stdio: "ignore",
        timeout: 5_000,
      });
      execFileSync(
        "git",
        ["-C", directories.workspace, "config", "user.email", "p8-acceptance@invalid.local"],
        { stdio: "ignore", timeout: 5_000 },
      );
      fs.writeFileSync(
        path.join(directories.workspace, "README.md"),
        "# Actestra P8.2 isolated acceptance workspace\n",
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      execFileSync("git", ["-C", directories.workspace, "add", "README.md"], {
        stdio: "ignore",
        timeout: 5_000,
      });
      execFileSync(
        "git",
        ["-C", directories.workspace, "commit", "--quiet", "-m", "Initialize P8.2 workspace"],
        { stdio: "ignore", timeout: 10_000 },
      );
    } else {
      execFileSync("git", ["-C", directories.workspace, "rev-parse", "--verify", "HEAD"], {
        stdio: "ignore",
        timeout: 5_000,
      });
      execFileSync("git", ["-C", directories.workspace, "diff", "--quiet", "HEAD", "--"], {
        stdio: "ignore",
        timeout: 5_000,
      });
    }
  } catch {
    smokeFailure("profile-isolation-invalid");
  }
  return Object.freeze(directories);
}

function validJourneyResult(value) {
  return (
    hasExactKeys(value, RESULT_KEYS) &&
    value.schemaVersion === 1 &&
    value.status === "verified" &&
    Array.isArray(value.journeys) &&
    value.journeys.length === P8_PRODUCT_JOURNEY_IDS.length &&
    value.journeys.every(
      (journey, index) =>
        hasExactKeys(journey, JOURNEY_KEYS) &&
        journey.id === P8_PRODUCT_JOURNEY_IDS[index] &&
        journey.status === "verified" &&
        journey.residualProcessCount === 0,
    )
  );
}

export async function parseP8ProductJourneyResultFile(userData) {
  const resultPath = path.join(userData, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME);
  let metadata;
  try {
    metadata = await lstat(resultPath);
  } catch {
    smokeFailure("result-missing");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) smokeFailure("result-malformed");
  if (metadata.size === 0 || metadata.size > P8_PRODUCT_JOURNEY_RESULT_MAX_BYTES) {
    smokeFailure("result-oversized");
  }
  let contents;
  let value;
  try {
    contents = await readFile(resultPath, "utf8");
    value = JSON.parse(contents);
  } catch {
    smokeFailure("result-malformed");
  }
  if (!validJourneyResult(value) || contents !== `${JSON.stringify(value)}\n`) {
    smokeFailure("result-malformed");
  }
  return Object.freeze({
    ...value,
    journeys: Object.freeze(value.journeys.map((journey) => Object.freeze({ ...journey }))),
  });
}

function validP8ProductJourneyRestartJournal(value) {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["journey", "phase", "restartCount", "schemaVersion"]) &&
    value.schemaVersion === 1 &&
    value.journey === "crash-restart-recovery" &&
    ((value.phase === "active-checkpoint" && value.restartCount === 0) ||
      (value.phase === "recovered" && value.restartCount === 1))
  );
}

async function parseP8ProductJourneyRestartJournalFile(journalPath) {
  let contents;
  try {
    const metadata = await lstat(journalPath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size > P8_PRODUCT_JOURNEY_RESTART_JOURNAL_MAX_BYTES
    ) {
      smokeFailure("journey-failed");
    }
    contents = await readFile(journalPath, "utf8");
  } catch (error) {
    if (error instanceof P8ProductJourneySmokeError) throw error;
    smokeFailure("journey-failed");
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    smokeFailure("journey-failed");
  }
  if (!validP8ProductJourneyRestartJournal(parsed)) smokeFailure("journey-failed");
  return Object.freeze({
    schemaVersion: 1,
    journey: "crash-restart-recovery",
    phase: parsed.phase,
    restartCount: parsed.restartCount,
  });
}

async function terminateObservedP8ProductJourneyProcesses(
  pids,
  snapshotProcessTree,
  rootPid,
  cleanupTimeoutMs,
) {
  const unique = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (unique.length === 0) return;
  let live = snapshotProcessTree(rootPid, unique);
  if (!live?.ok) smokeFailure("process-probe-failed");
  const livePids = new Set(live.pids);
  for (const pid of unique) {
    if (!livePids.has(pid)) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          timeout: 10_000,
        });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // A child can exit between the bounded probe and signal.
    }
  }
  const deadline = Date.now() + cleanupTimeoutMs;
  while (Date.now() < deadline) {
    live = snapshotProcessTree(rootPid, unique);
    if (!live?.ok) smokeFailure("process-probe-failed");
    if (live.pids.length === 0) return;
    await delay(Math.min(25, cleanupTimeoutMs));
  }
  smokeFailure("residual-processes");
}

/**
 * Run the crash/restart journey as two real packaged launches. The first
 * launch must leave a private active-checkpoint journal and terminate
 * abnormally; only then may this controller start the single recovery launch.
 */
export async function runP8ProductJourneyCrashRestartRecovery(options) {
  if (
    !isRecord(options) ||
    typeof options.launchPath !== "string" ||
    typeof options.userDataPath !== "string" ||
    typeof options.resultPath !== "string" ||
    typeof options.restartJournalPath !== "string" ||
    !isRecord(options.environment)
  ) {
    smokeFailure("invalid-arguments");
  }
  const spawnChild =
    options.spawnChild ??
    ((executable, arguments_, spawnOptions) => spawn(executable, arguments_, spawnOptions));
  const snapshotProcessTree = options.snapshotProcessTree ?? defaultSnapshotProcessTree;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? 10_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 10 * 60_000 ||
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs < 100 ||
    cleanupTimeoutMs > 10_000
  ) {
    smokeFailure("invalid-arguments");
  }

  async function launchPhase(phase) {
    let child;
    let outcomePromise;
    try {
      child = spawnChild(options.launchPath, [], {
        cwd: repositoryRoot,
        env: {
          ...options.environment,
          ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE: phase,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (!child || !Number.isInteger(child.pid) || child.pid <= 0) smokeFailure("spawn-failed");
      outcomePromise = childOutcome(child);
      observeP8ProductJourneyDiagnostics(child.stderr, options.onDiagnostic);
      observeP8ProductJourneyDiagnostics(child.stdout, options.onDiagnostic);
      child.stdout?.resume?.();
      child.stderr?.resume?.();
      const initial = snapshotProcessTree(child.pid);
      if (!initial?.ok) smokeFailure("process-probe-failed");
      const observed = new Set(initial.pids);
      return { child, outcomePromise, observed };
    } catch (error) {
      if (child && outcomePromise)
        await terminateChild(child, outcomePromise).catch(() => undefined);
      throw error;
    }
  }

  async function cleanupPhase(phase) {
    if (!phase?.child || !phase?.outcomePromise) return;
    await terminateChild(phase.child, phase.outcomePromise).catch(() => undefined);
    if (phase.observed?.size > 0) {
      await terminateObservedP8ProductJourneyProcesses(
        phase.observed,
        snapshotProcessTree,
        phase.child.pid,
        cleanupTimeoutMs,
      ).catch(() => undefined);
    }
  }

  let first;
  let second;
  try {
    const failurePath = path.join(options.userDataPath, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME);
    fs.rmSync(options.restartJournalPath, { force: true });
    fs.rmSync(options.resultPath, { force: true });
    fs.rmSync(failurePath, { force: true });
    first = await launchPhase("prepare");
    let firstJournal;
    let firstOutcome;
    const firstDeadline = Date.now() + timeoutMs;
    while (Date.now() < firstDeadline) {
      const snapshot = snapshotProcessTree(first.child.pid, [...first.observed]);
      if (!snapshot?.ok) smokeFailure("process-probe-failed");
      for (const pid of snapshot.pids) first.observed.add(pid);
      try {
        firstJournal = await parseP8ProductJourneyRestartJournalFile(options.restartJournalPath);
      } catch (error) {
        if (!(error instanceof P8ProductJourneySmokeError) || error.code !== "journey-failed") {
          throw error;
        }
      }
      firstOutcome = await Promise.race([first.outcomePromise, delay(25).then(() => undefined)]);
      if (firstOutcome !== undefined) break;
    }
    if (firstOutcome === undefined) {
      await terminateChild(first.child, first.outcomePromise);
      smokeFailure("journey-timeout");
    }
    if (firstOutcome.kind !== "exit" || firstOutcome.code !== 86 || firstOutcome.signal !== null) {
      smokeFailure("journey-failed");
    }
    if (firstJournal === undefined) {
      firstJournal = await parseP8ProductJourneyRestartJournalFile(options.restartJournalPath);
    }
    if (firstJournal.phase !== "active-checkpoint" || firstJournal.restartCount !== 0) {
      smokeFailure("journey-failed");
    }
    await terminateObservedP8ProductJourneyProcesses(
      first.observed,
      snapshotProcessTree,
      first.child.pid,
      cleanupTimeoutMs,
    );

    fs.rmSync(failurePath, { force: true });
    second = await launchPhase("recover");
    let secondJournal;
    let secondResult;
    let secondOutcome;
    const secondDeadline = Date.now() + timeoutMs;
    while (Date.now() < secondDeadline) {
      const snapshot = snapshotProcessTree(second.child.pid, [...second.observed]);
      if (!snapshot?.ok) smokeFailure("process-probe-failed");
      for (const pid of snapshot.pids) second.observed.add(pid);
      try {
        secondJournal = await parseP8ProductJourneyRestartJournalFile(options.restartJournalPath);
        if (secondJournal.phase !== "recovered") secondJournal = undefined;
      } catch (error) {
        if (!(error instanceof P8ProductJourneySmokeError) || error.code !== "journey-failed") {
          throw error;
        }
      }
      try {
        secondResult = await parseP8ProductJourneyResultFile(options.userDataPath);
      } catch (error) {
        if (!(error instanceof P8ProductJourneySmokeError) || error.code !== "result-missing") {
          throw error;
        }
      }
      secondOutcome = await Promise.race([second.outcomePromise, delay(25).then(() => undefined)]);
      if (secondResult !== undefined || secondOutcome !== undefined) break;
    }
    if (secondOutcome === undefined) {
      await terminateChild(second.child, second.outcomePromise);
      smokeFailure("journey-timeout");
    }
    if (
      secondOutcome.kind !== "exit" ||
      secondOutcome.code !== 0 ||
      secondOutcome.signal !== null
    ) {
      smokeFailure("non-graceful-exit");
    }
    if (secondResult === undefined)
      secondResult = await parseP8ProductJourneyResultFile(options.userDataPath);
    if (secondJournal === undefined)
      secondJournal = await parseP8ProductJourneyRestartJournalFile(options.restartJournalPath);
    if (secondJournal.phase !== "recovered" || secondJournal.restartCount !== 1)
      smokeFailure("journey-failed");
    const final = snapshotProcessTree(second.child.pid, [...second.observed]);
    if (!final?.ok) smokeFailure("process-probe-failed");
    if (final.pids.length > 0) {
      await terminateObservedP8ProductJourneyProcesses(
        second.observed,
        snapshotProcessTree,
        second.child.pid,
        cleanupTimeoutMs,
      );
    }
    return Object.freeze({
      restartCount: 1,
      journal: secondJournal,
      result: secondResult,
    });
  } catch (error) {
    await cleanupPhase(second);
    await cleanupPhase(first);
    throw error;
  }
}

export function parseP8ProductJourneyArguments(argv) {
  if (!Array.isArray(argv)) throw new Error("invalid-arguments");
  const parsed = { packages: [] };
  const seen = new Set();
  const simpleArguments = Object.freeze({
    "--target": "targetId",
    "--runtime": "runtimePath",
    "--source-commit": "sourceCommit",
    "--ci-run-id": "ciRunId",
    "--evidence": "evidencePath",
  });
  const runnerArguments = Object.freeze({
    "--runner-manifest": "manifestSha256",
    "--runner-executable": "executableSha256",
    "--runner-containment": "containmentEvidenceSha256",
  });
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--package") {
      if (typeof value !== "string") throw new Error("invalid-arguments");
      const separator = value.indexOf("=");
      if (separator < 1 || separator === value.length - 1) throw new Error("invalid-arguments");
      parsed.packages.push({
        format: value.slice(0, separator),
        path: value.slice(separator + 1),
      });
      index += 1;
      continue;
    }
    const simpleKey = simpleArguments[argument];
    const runnerKey = runnerArguments[argument];
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      (simpleKey === undefined && runnerKey === undefined) ||
      seen.has(argument)
    ) {
      throw new Error("invalid-arguments");
    }
    seen.add(argument);
    if (simpleKey !== undefined) parsed[simpleKey] = value;
    if (runnerKey !== undefined) {
      parsed.runner ??= {};
      parsed.runner[runnerKey] = value;
    }
    index += 1;
  }
  if (
    !parsed.targetId ||
    !parsed.runtimePath ||
    !parsed.sourceCommit ||
    !parsed.ciRunId ||
    !parsed.evidencePath ||
    !isRecord(parsed.runner) ||
    !DIGEST_PATTERN.test(parsed.runner.manifestSha256 ?? "") ||
    !DIGEST_PATTERN.test(parsed.runner.executableSha256 ?? "") ||
    !DIGEST_PATTERN.test(parsed.runner.containmentEvidenceSha256 ?? "")
  ) {
    throw new Error("invalid-arguments");
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function childOutcome(child) {
  return new Promise((resolve) => {
    child.once("error", () => resolve({ kind: "error" }));
    child.once("close", (code, signal) => resolve({ kind: "exit", code, signal }));
  });
}

async function terminateChild(child, outcomePromise) {
  const existing = await Promise.race([outcomePromise, delay(1).then(() => undefined)]);
  if (existing !== undefined) return existing;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        timeout: 10_000,
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // The process may have exited between the bounded outcome check and kill.
  }
  return Promise.race([outcomePromise, delay(2_000).then(() => undefined)]);
}

function unixProcessRows() {
  const output = execFileSync("ps", ["-axo", "pid=,ppid="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return output
    .split(/\r?\n/u)
    .map((line) => /^\s*(\d+)\s+(\d+)\s*$/u.exec(line))
    .filter(Boolean)
    .map((match) => ({ pid: Number(match[1]), parentPid: Number(match[2]) }));
}

function windowsProcessRows() {
  const script =
    "$rows = Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress; Write-Output $rows";
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", timeout: 10_000 },
  );
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((row) => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
  }));
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

function defaultSnapshotProcessTree(rootPid, observedPids = []) {
  try {
    const rows = process.platform === "win32" ? windowsProcessRows() : unixProcessRows();
    const livePids = new Set(rows.map(({ pid }) => pid));
    return Object.freeze({
      ok: true,
      pids: Object.freeze([
        ...new Set([
          ...descendantPids(rows, rootPid),
          ...observedPids.filter((pid) => livePids.has(pid)),
        ]),
      ]),
    });
  } catch {
    return Object.freeze({ ok: false });
  }
}

function nonLoopbackIpv4Address() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && address.internal === false) return address.address;
    }
  }
  throw new Error("p7-hostile-listener-unavailable");
}

function p7GeneralProbeSource(mode) {
  const workload =
    mode === "cpu"
      ? `function consumeCpu() {
  if (!running) return;
  const until = Date.now() + 20;
  let value = 1;
  while (Date.now() < until) value = Math.imul(value + 1, 2654435761);
  cpuSink = value;
  setImmediate(consumeCpu);
}`
      : `function consumeMemory() {
  if (!running) return;
  allocations.push(Buffer.alloc(16 * 1024 * 1024, 1));
  resourceTimer = setTimeout(consumeMemory, 35);
}`;
  const starter = mode === "cpu" ? "consumeCpu();" : "consumeMemory();";
  return `const parentPort = process.parentPort;
if (!parentPort) process.exit(40);
let attemptToken;
let sequence = 0;
let running = false;
let resourceTimer;
let cpuSink = 0;
const allocations = [];
function response(request) {
  parentPort.postMessage({ protocolVersion: 2, type: 'response', requestId: request.requestId,
    operation: request.operation, ok: true });
}
function event(value) {
  sequence += 1;
  parentPort.postMessage({ protocolVersion: 2, type: 'event', attemptToken, sequence, event: value });
}
${workload}
function stopWorkload() {
  running = false;
  if (resourceTimer) clearTimeout(resourceTimer);
}
parentPort.on('message', ({ data: request }) => {
  if (!request || request.protocolVersion !== 2 || request.type !== 'request') process.exit(41);
  if (request.operation === 'start') {
    attemptToken = request.payload.attemptToken;
    response(request);
    event({ type: 'started' });
    running = true;
    setTimeout(() => { ${starter} }, 250);
    return;
  }
  if (request.operation === 'cancel') {
    stopWorkload();
    response(request);
    event({ type: 'cancelled', reason: 'bounded probe cancellation' });
    return;
  }
  if (request.operation === 'dispose') {
    stopWorkload();
    response(request);
    return;
  }
  if (request.operation === 'close') {
    stopWorkload();
    response(request);
    setImmediate(() => process.exit(0));
    return;
  }
  response(request);
});
parentPort.postMessage({
  protocolVersion: 2,
  type: 'ready',
  role: 'general-worker',
  implementationVersion: '0.2.0',
  capabilities: ['messages', 'cancellation', 'heartbeats', 'tool-results', 'model-requests'],
  maxConcurrentAttempts: 1,
  heartbeatIntervalMs: 1000,
});
`;
}

async function prepareP8P7SmokeEnvironment(isolation, runtime, runner) {
  const root = isolation.isolationRoot;
  const hostReadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p8-p7-host-read-"));
  const hostReadProbe = path.join(hostReadRoot, "protected-host-read.txt");
  fs.writeFileSync(hostReadProbe, "P8 protected host read\n", { mode: 0o600 });

  const security = {
    sentinel: path.join(root, "p7-security-sentinel.txt"),
    evidence: path.join(root, "p7-security-evidence.json"),
  };
  fs.writeFileSync(security.sentinel, "P8 protected sentinel\n", {
    mode: 0o600,
  });

  const resources = {
    evidence: path.join(root, "p7-resource-evidence.json"),
    generalCpuProbe: path.join(root, "p7-general-cpu.cjs"),
    generalMemoryProbe: path.join(root, "p7-general-memory.cjs"),
    gooseForkProbe: path.join(root, "p7-goose-fork.pl"),
    goosePrivateRoot: path.join(root, "p7-goose-private"),
  };
  fs.mkdirSync(resources.goosePrivateRoot, { recursive: true, mode: 0o700 });
  fs.writeFileSync(resources.generalCpuProbe, p7GeneralProbeSource("cpu"), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.writeFileSync(resources.generalMemoryProbe, p7GeneralProbeSource("memory"), {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.writeFileSync(
    resources.gooseForkProbe,
    `use strict; use warnings;\nmy ($result) = @ARGV;\nmy $child = fork();\nif (!defined($child)) {\n  open(my $fh, '>', $result) or exit 3;\n  print $fh 'fork-denied';\n  close($fh) or exit 3;\n  exit 0;\n}\nexit 9;\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const diagnostic = {
    report: path.join(root, "p7-diagnostic-report.json"),
    evidence: path.join(root, "p7-diagnostic-evidence.json"),
  };
  const hostileAddress = nonLoopbackIpv4Address();
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Length": "0" });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("p7-hostile-listener-unavailable");
  }

  return Object.freeze({
    environment: Object.freeze({
      ACTESTRA_P7_SECURITY_SMOKE: "1",
      ACTESTRA_P7_SECURITY_SMOKE_SENTINEL: security.sentinel,
      ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE: isolation.workspace,
      ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE: security.evidence,
      ACTESTRA_P7_SECURITY_SMOKE_HOST_READ_PROBE: hostReadProbe,
      ACTESTRA_P7_SECURITY_SMOKE_TARGET: `http://${hostileAddress}:${address.port}/p8-p7-denied`,
      ACTESTRA_P7_SECURITY_SMOKE_RUNNER_ARTIFACT_DIRECTORY: path.join(
        runtime.resourcesPath,
        "actestra-goose-runner",
      ),
      ACTESTRA_P7_SECURITY_SMOKE_RUNNER_MANIFEST_SHA256: runner.manifestSha256,
      ACTESTRA_P7_RESOURCE_RELIABILITY_SMOKE: "1",
      ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE: resources.evidence,
      ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE: resources.generalCpuProbe,
      ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE: resources.generalMemoryProbe,
      ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE: resources.gooseForkProbe,
      ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT: resources.goosePrivateRoot,
      ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE: "1",
      ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT: diagnostic.report,
      ACTESTRA_P7_DIAGNOSTIC_AUDIT_EVIDENCE: diagnostic.evidence,
    }),
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
      fs.rmSync(hostReadRoot, { recursive: true, force: true });
    },
  });
}

function validRunnerBinding(value) {
  return (
    hasExactKeys(value, ["containmentEvidenceSha256", "executableSha256", "manifestSha256"]) &&
    DIGEST_PATTERN.test(value.manifestSha256) &&
    DIGEST_PATTERN.test(value.executableSha256) &&
    DIGEST_PATTERN.test(value.containmentEvidenceSha256)
  );
}

function buildFailure(options, code) {
  const targetId = TARGETS.has(options?.targetId) ? options.targetId : "unknown";
  const sourceCommit = COMMIT_PATTERN.test(options?.sourceCommit ?? "")
    ? options.sourceCommit
    : "0".repeat(40);
  const ciRunId = CI_RUN_PATTERN.test(options?.ciRunId ?? "") ? options.ciRunId : "1";
  const safeCode = FAILURE_CODE_SET.has(code) ? code : "early-exit";
  const boundedCode =
    targetId === "unknown"
      ? typeof options?.targetId === "string"
        ? "unsupported-target"
        : "invalid-arguments"
      : safeCode;
  return makeP8ProductJourneyFailureEvidence(targetId, sourceCommit, ciRunId, boundedCode);
}

/**
 * Launch one native package and bind the Main-owned nine-journey result to the
 * exact package, runner, source, CI run, and zero-residual process outcome.
 */
export async function runP8ProductJourneySmoke(options) {
  let isolation;
  let p7Smoke;
  let ownsIsolation = false;
  let child;
  let outcomePromise;
  let diagnostic;
  let runtimeDiagnostic;
  const recordDiagnostic = (value) => {
    if (value !== null && typeof value === "object" && "runtimeStage" in value) {
      runtimeDiagnostic = value;
    } else {
      diagnostic = value;
    }
  };
  try {
    if (
      !isRecord(options) ||
      !TARGETS.has(options.targetId) ||
      !COMMIT_PATTERN.test(options.sourceCommit ?? "") ||
      !CI_RUN_PATTERN.test(options.ciRunId ?? "") ||
      !validRunnerBinding(options.runner)
    ) {
      smokeFailure(!TARGETS.has(options?.targetId) ? "unsupported-target" : "invalid-arguments");
    }
    const runtime = await resolveP8ProductJourneyRuntime(options.targetId, options.runtimePath);
    const packages = await normalizeP8ProductJourneyPackages(options.targetId, options.packages);
    const isolationRoot =
      options.isolationRoot ??
      (await realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), "actestra-p8-journeys-"))));
    ownsIsolation = options.isolationRoot === undefined;
    isolation = await resolveP8ProductJourneyIsolation(isolationRoot);
    const journeyTimeoutMs = options.journeyTimeoutMs ?? 300_000;
    if (
      !Number.isSafeInteger(journeyTimeoutMs) ||
      journeyTimeoutMs < 1_000 ||
      journeyTimeoutMs > 300_000
    ) {
      smokeFailure("invalid-arguments");
    }
    const environment = {
      ...process.env,
      ACTESTRA_E2E_TEST: "1",
      ACTESTRA_DISABLE_AUTO_UPDATE: "1",
      ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE: "1",
      ACTESTRA_USER_DATA_DIR: isolation.userData,
      ACTESTRA_E2E_ISOLATION_ROOT: isolation.isolationRoot,
      ACTESTRA_E2E_HOME_DIR: isolation.home,
      ACTESTRA_E2E_TEMP_DIR: isolation.temp,
      ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE: isolation.workspace,
      ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: path.join(
        isolation.userData,
        P8_PRODUCT_JOURNEY_RESULT_FILE_NAME,
      ),
      ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS: String(journeyTimeoutMs),
      ACTESTRA_P8_SOURCE_COMMIT: options.sourceCommit,
      ACTESTRA_P8_CI_RUN_ID: options.ciRunId,
      ACTESTRA_P8_GOOSE_MANIFEST_SHA256: options.runner.manifestSha256,
      ACTESTRA_P8_GOOSE_EXECUTABLE_SHA256: options.runner.executableSha256,
      ACTESTRA_P8_GOOSE_CONTAINMENT_SHA256: options.runner.containmentEvidenceSha256,
      HOME: isolation.home,
      USERPROFILE: isolation.home,
      TMPDIR: isolation.temp,
      TMP: isolation.temp,
      TEMP: isolation.temp,
    };
    p7Smoke = await prepareP8P7SmokeEnvironment(isolation, runtime, options.runner);
    Object.assign(environment, p7Smoke.environment);
    fs.rmSync(path.join(isolation.userData, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME), {
      force: true,
    });
    const snapshotProcessTree = options.snapshotProcessTree ?? defaultSnapshotProcessTree;
    let journeyResult;
    if (options.crashRestartRecovery !== false) {
      const recovered = await runP8ProductJourneyCrashRestartRecovery({
        launchPath: runtime.launchPath,
        userDataPath: isolation.userData,
        resultPath: path.join(isolation.userData, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME),
        restartJournalPath: path.join(
          isolation.userData,
          P8_PRODUCT_JOURNEY_RESTART_JOURNAL_FILE_NAME,
        ),
        environment,
        ...(options.spawnChild === undefined ? {} : { spawnChild: options.spawnChild }),
        onDiagnostic: recordDiagnostic,
        snapshotProcessTree,
        timeoutMs: options.timeoutMs ?? 10 * 60_000,
        cleanupTimeoutMs: options.cleanupTimeoutMs ?? 10_000,
      });
      journeyResult = recovered.result;
    } else {
      const spawnChild =
        options.spawnChild ??
        ((executable, arguments_, spawnOptions) => spawn(executable, arguments_, spawnOptions));
      child = spawnChild(runtime.launchPath, [], {
        cwd: repositoryRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (!child || !Number.isInteger(child.pid) || child.pid <= 0) smokeFailure("spawn-failed");
      outcomePromise = childOutcome(child);
      observeP8ProductJourneyDiagnostics(child.stderr, recordDiagnostic);
      observeP8ProductJourneyDiagnostics(child.stdout, recordDiagnostic);
      const initialSnapshot = snapshotProcessTree(child.pid);
      if (!initialSnapshot?.ok) smokeFailure("process-probe-failed");
      const observedPids = new Set(initialSnapshot.pids);
      child.stdout?.resume?.();
      child.stderr?.resume?.();

      const startedAt = Date.now();
      const timeoutMs = options.timeoutMs ?? 10 * 60_000;
      while (Date.now() - startedAt < timeoutMs) {
        const runtimeSnapshot = snapshotProcessTree(child.pid, [...observedPids]);
        if (!runtimeSnapshot?.ok) smokeFailure("process-probe-failed");
        for (const pid of runtimeSnapshot.pids) observedPids.add(pid);
        try {
          journeyResult = await parseP8ProductJourneyResultFile(isolation.userData);
          break;
        } catch (error) {
          if (!(error instanceof P8ProductJourneySmokeError) || error.code !== "result-missing") {
            throw error;
          }
        }
        const outcome = await Promise.race([outcomePromise, delay(25).then(() => undefined)]);
        if (outcome !== undefined) {
          try {
            journeyResult = await parseP8ProductJourneyResultFile(isolation.userData);
            break;
          } catch (error) {
            if (error instanceof P8ProductJourneySmokeError && error.code === "result-missing") {
              smokeFailure(outcome.kind === "error" ? "spawn-failed" : "early-exit");
            }
            throw error;
          }
        }
      }
      if (journeyResult === undefined) smokeFailure("journey-timeout");

      const outcome = await Promise.race([
        outcomePromise,
        delay(options.cleanupTimeoutMs ?? 10_000).then(() => undefined),
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
    }

    const runner = Object.freeze({ packaged: true, ...options.runner });
    const packageBindings = packages.map(({ format, sha256 }) => ({
      format,
      sha256,
    }));
    const resultPath = path.join(isolation.userData, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME);
    const evidence = Object.freeze({
      schemaVersion: 1,
      status: "verified",
      targetId: options.targetId,
      sourceCommit: options.sourceCommit,
      ciRunId: options.ciRunId,
      packages: Object.freeze(packageBindings),
      executableSha256: await sha256File(runtime.executable, "artifact-mismatch"),
      appAsarSha256: await sha256File(runtime.appAsar, "artifact-mismatch"),
      runner,
      journeyResultSha256: await sha256File(resultPath, "result-missing"),
      packageStructure: true,
      gracefulExit: true,
      residualProcessCount: 0,
      journeys: journeyResult.journeys,
    });
    const binding = Object.freeze({
      targetId: evidence.targetId,
      sourceCommit: evidence.sourceCommit,
      ciRunId: evidence.ciRunId,
      packages: packageBindings,
      executableSha256: evidence.executableSha256,
      appAsarSha256: evidence.appAsarSha256,
      runner,
    });
    const validation = validateP8ProductJourneyEvidence(evidence, binding);
    if (!validation.ok) smokeFailure(validation.code);
    return Object.freeze({ evidence, binding });
  } catch (error) {
    if (child && outcomePromise) await terminateChild(child, outcomePromise).catch(() => undefined);
    const code = error instanceof P8ProductJourneySmokeError ? error.code : "early-exit";
    if (diagnostic === undefined && isolation !== undefined) {
      diagnostic = await parseP8ProductJourneyFailureFile(isolation.userData);
    }
    if (diagnostic !== undefined) {
      process.stderr.write(
        `${JSON.stringify({
          ...diagnostic,
          ...(runtimeDiagnostic === undefined ? {} : runtimeDiagnostic),
          outerCode: code,
        })}\n`,
      );
    } else if (runtimeDiagnostic !== undefined) {
      process.stderr.write(`${JSON.stringify({ ...runtimeDiagnostic, outerCode: code })}\n`);
    }
    return Object.freeze({ evidence: buildFailure(options, code) });
  } finally {
    await p7Smoke?.close?.().catch(() => undefined);
    if (isolation && ownsIsolation && options?.retainIsolation !== true) {
      fs.rmSync(isolation.isolationRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  let options;
  try {
    options = parseP8ProductJourneyArguments(process.argv.slice(2));
  } catch {
    process.exitCode = 1;
    return;
  }
  const result = await runP8ProductJourneySmoke(options);
  fs.mkdirSync(path.dirname(path.resolve(options.evidencePath)), {
    recursive: true,
  });
  fs.writeFileSync(path.resolve(options.evidencePath), `${JSON.stringify(result.evidence)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(result.evidence)}\n`);
  if (result.evidence.status !== "verified") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
