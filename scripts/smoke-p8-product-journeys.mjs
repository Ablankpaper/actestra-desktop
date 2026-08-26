import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
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
export const P8_PRODUCT_JOURNEY_RESULT_MAX_BYTES = 32 * 1024;

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
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class P8ProductJourneySmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = "P8ProductJourneySmokeError";
    this.code = code;
  }
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
    return Object.freeze({ executable, appAsar, launchPath: executable });
  }
  await requireRegularFile(resolved, "package-structure-invalid");
  const appAsar = path.join(path.dirname(resolved), "resources", "app.asar");
  await requireRegularFile(appAsar, "package-structure-invalid");
  return Object.freeze({ executable: resolved, appAsar, launchPath: resolved });
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
  };
  for (const directory of [directories.userData, directories.home, directories.temp]) {
    const child = await lstat(directory).catch(() => undefined);
    if (child?.isSymbolicLink()) smokeFailure("profile-isolation-invalid");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const canonical = await requireCanonicalDirectory(directory, "profile-isolation-invalid");
    if (!isInside(root, canonical)) smokeFailure("profile-isolation-invalid");
    if (process.platform !== "win32") await chmod(canonical, 0o700);
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
      parsed.packages.push({ format: value.slice(0, separator), path: value.slice(separator + 1) });
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
  let ownsIsolation = false;
  let child;
  let outcomePromise;
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
    const environment = {
      ...process.env,
      ACTESTRA_E2E_TEST: "1",
      ACTESTRA_DISABLE_AUTO_UPDATE: "1",
      ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE: "1",
      ACTESTRA_USER_DATA_DIR: isolation.userData,
      ACTESTRA_E2E_ISOLATION_ROOT: isolation.isolationRoot,
      ACTESTRA_E2E_HOME_DIR: isolation.home,
      ACTESTRA_E2E_TEMP_DIR: isolation.temp,
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
    const snapshotProcessTree = options.snapshotProcessTree ?? defaultSnapshotProcessTree;
    const initialSnapshot = snapshotProcessTree(child.pid);
    if (!initialSnapshot?.ok) smokeFailure("process-probe-failed");
    const observedPids = new Set(initialSnapshot.pids);
    child.stdout?.resume?.();
    child.stderr?.resume?.();

    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 10 * 60_000;
    let journeyResult;
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

    const runner = Object.freeze({ packaged: true, ...options.runner });
    const packageBindings = packages.map(({ format, sha256 }) => ({ format, sha256 }));
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
    return Object.freeze({ evidence: buildFailure(options, code) });
  } finally {
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
  fs.mkdirSync(path.dirname(path.resolve(options.evidencePath)), { recursive: true });
  fs.writeFileSync(path.resolve(options.evidencePath), `${JSON.stringify(result.evidence)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify(result.evidence)}\n`);
  if (result.evidence.status !== "verified") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
