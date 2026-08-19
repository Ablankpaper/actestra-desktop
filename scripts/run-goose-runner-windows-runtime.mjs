import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  GOOSE_WINDOWS_ARTIFACT_ADMISSION_FAILURE_CODES,
  classifyGooseWindowsArtifactAdmissionFailure,
  classifyGooseWindowsRuntimeFailureEvidence,
  validateGooseWindowsRuntimeEvidence,
} from "./gooseWindowsRuntimeEvidence.mjs";

const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FAILURE_EVIDENCE_BYTES = 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const CONTAINMENT_KEYS = Object.freeze(
  ["executableSha256", "manifestSha256", "probeSha256", "status", "targetTriple"].sort(),
);
const FAILURE_CODES = new Set([
  ...GOOSE_WINDOWS_ARTIFACT_ADMISSION_FAILURE_CODES,
  "windows-runtime-artifact-admission-failed",
  "windows-runtime-artifact-mismatch",
  "windows-runtime-containment-evidence-invalid",
  "windows-runtime-composition-open-failed",
  "windows-runtime-read-tool-failed",
  "windows-runtime-approved-write-tool-failed",
  "windows-runtime-cancellation-failed",
  "windows-runtime-parent-death-failed",
  "windows-runtime-evidence-invalid",
  "windows-runtime-evidence-missing",
  "windows-runtime-evidence-too-large",
  "windows-runtime-test-failed",
  "windows-runtime-target-unsupported",
]);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = path.join(repositoryRoot, ".actestra", "goose-runner", TARGET_TRIPLE);
const manifestPath = path.join(artifactDirectory, "actestra-goose-runner.manifest.json");
const sourceContractPath = path.join(
  repositoryRoot,
  "apps",
  "desktop",
  "src",
  "shared",
  "gooseRunnerSource.json",
);
const integrationTest = "tests/main/gooseRunnerWindowsNative.integration.ts";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code) {
  const safeCode = FAILURE_CODES.has(code) ? code : "windows-runtime-test-failed";
  process.stderr.write(`Goose Windows runtime ${safeCode}\n`);
  process.exitCode = 2;
}

function exactKeys(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function boundedSystemEnvironment() {
  const source = process.env;
  return Object.fromEntries(
    [
      "APPDATA",
      "BUN_INSTALL",
      "CI",
      "ComSpec",
      "LOCALAPPDATA",
      "PATH",
      "PROGRAMDATA",
      "RUNNER_TEMP",
      "SystemRoot",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "WINDIR",
    ]
      .filter((key) => typeof source[key] === "string")
      .map((key) => [key, source[key]]),
  );
}

function runBounded(command, args, env = boundedSystemEnvironment()) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 210_000,
    maxBuffer: MAX_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function parseSingleJsonLine(value, code) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error(code);
  }
  const line = value.trim();
  if (line.length === 0 || line.includes("\n") || line.includes("\r")) throw new Error(code);
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(code);
  }
}

async function readFailureCode(failureEvidencePath) {
  const bytes = await readFile(failureEvidencePath).catch(() => undefined);
  if (bytes === undefined || bytes.byteLength > MAX_FAILURE_EVIDENCE_BYTES) {
    return "windows-runtime-test-failed";
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
  } catch {
    return "windows-runtime-test-failed";
  }
  return classifyGooseWindowsRuntimeFailureEvidence(evidence) ?? "windows-runtime-test-failed";
}

function currentHead() {
  const result = runBounded("git", ["rev-parse", "HEAD"]);
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    throw new Error("windows-runtime-artifact-mismatch");
  }
  const head = result.stdout.trim();
  if (!COMMIT_PATTERN.test(head)) throw new Error("windows-runtime-artifact-mismatch");
  return head;
}

function admitExactArtifact(expectedManifestSha256) {
  const result = runBounded("bun", ["run", "goose:runner:admit-build"]);
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    result.signal !== null ||
    Buffer.byteLength(result.stdout ?? "", "utf8") > MAX_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr ?? "", "utf8") > MAX_OUTPUT_BYTES
  ) {
    throw new Error(
      classifyGooseWindowsArtifactAdmissionFailure(result.stderr) ??
        "windows-runtime-artifact-admission-failed",
    );
  }
  const admitted = parseSingleJsonLine(result.stdout, "windows-runtime-artifact-admission-failed");
  if (
    admitted?.targetTriple !== TARGET_TRIPLE ||
    admitted?.manifestSha256 !== expectedManifestSha256 ||
    typeof admitted?.executableSha256 !== "string" ||
    !SHA256_PATTERN.test(admitted.executableSha256)
  ) {
    throw new Error("windows-runtime-artifact-mismatch");
  }
  return Object.freeze({ executableSha256: admitted.executableSha256 });
}

async function readBinding() {
  const requested = path.resolve(artifactDirectory);
  const canonical = await realpath(requested).catch(() => {
    throw new Error("windows-runtime-artifact-admission-failed");
  });
  if (canonical !== requested) throw new Error("windows-runtime-artifact-mismatch");
  const manifestStat = await lstat(manifestPath).catch(() => undefined);
  if (
    manifestStat === undefined ||
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    manifestStat.size < 1 ||
    manifestStat.size > MAX_MANIFEST_BYTES
  ) {
    throw new Error("windows-runtime-artifact-admission-failed");
  }
  const [manifestBytes, sourceContractBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(sourceContractPath),
  ]);
  let manifest;
  let sourceContract;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    sourceContract = JSON.parse(sourceContractBytes.toString("utf8"));
  } catch {
    throw new Error("windows-runtime-artifact-admission-failed");
  }
  const sourceCommit = manifest?.provenance?.actestraCommit;
  const executableSha256 = manifest?.runner?.executable?.sha256;
  const binding = Object.freeze({
    targetTriple: TARGET_TRIPLE,
    sourceCommit,
    gooseBaseCommit: sourceContract?.goose?.baseCommit,
    gooseRuntimeCommit: sourceContract?.goose?.runtimeCommit,
    goosePatchSha256: sourceContract?.goose?.patchSetSha256,
    manifestSha256: digest(manifestBytes),
    executableSha256,
  });
  if (
    !COMMIT_PATTERN.test(binding.sourceCommit ?? "") ||
    !COMMIT_PATTERN.test(binding.gooseBaseCommit ?? "") ||
    !COMMIT_PATTERN.test(binding.gooseRuntimeCommit ?? "") ||
    !SHA256_PATTERN.test(binding.goosePatchSha256 ?? "") ||
    !SHA256_PATTERN.test(binding.manifestSha256) ||
    !SHA256_PATTERN.test(binding.executableSha256 ?? "") ||
    binding.sourceCommit !== currentHead()
  ) {
    throw new Error("windows-runtime-artifact-mismatch");
  }
  return binding;
}

async function readContainmentEvidence(binding) {
  const requestedPath = process.env.ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_PATH;
  if (typeof requestedPath !== "string" || !path.isAbsolute(requestedPath)) {
    throw new Error("windows-runtime-containment-evidence-invalid");
  }
  const stat = await lstat(requestedPath).catch(() => undefined);
  if (
    stat === undefined ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > MAX_OUTPUT_BYTES
  ) {
    throw new Error("windows-runtime-containment-evidence-invalid");
  }
  const canonical = await realpath(requestedPath).catch(() => {
    throw new Error("windows-runtime-containment-evidence-invalid");
  });
  if (
    path.dirname(canonical) !== repositoryRoot ||
    path.basename(canonical) !== "containment-evidence.json"
  ) {
    throw new Error("windows-runtime-containment-evidence-invalid");
  }
  const bytes = await readFile(canonical);
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("windows-runtime-containment-evidence-invalid");
  }
  if (
    !exactKeys(evidence, CONTAINMENT_KEYS) ||
    evidence.status !== "verified" ||
    evidence.targetTriple !== TARGET_TRIPLE ||
    evidence.manifestSha256 !== binding.manifestSha256 ||
    evidence.executableSha256 !== binding.executableSha256 ||
    !SHA256_PATTERN.test(evidence.probeSha256)
  ) {
    throw new Error("windows-runtime-containment-evidence-invalid");
  }
  return digest(bytes);
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("windows-runtime-target-unsupported");
  }
  const binding = await readBinding();
  const expectedManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
  if (
    typeof expectedManifestSha256 !== "string" ||
    !SHA256_PATTERN.test(expectedManifestSha256) ||
    expectedManifestSha256 !== binding.manifestSha256
  ) {
    throw new Error("windows-runtime-artifact-mismatch");
  }
  const admittedBefore = admitExactArtifact(expectedManifestSha256);
  if (admittedBefore.executableSha256 !== binding.executableSha256) {
    throw new Error("windows-runtime-artifact-mismatch");
  }
  const containmentEvidenceSha256 = await readContainmentEvidence(binding);
  const evidenceDirectory = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "actestra-goose-windows-runtime-"),
  );
  const evidencePath = path.join(evidenceDirectory, "windows-runtime-evidence.json");
  const failureEvidencePath = path.join(evidenceDirectory, "windows-runtime-failure.json");
  try {
    const child = runBounded("bun", ["run", "test", "--", "--bail=1", integrationTest], {
      ...boundedSystemEnvironment(),
      ACTESTRA_ENVIRONMENT_CANARY: "environment-canary-must-not-cross",
      ANTHROPIC_API_KEY: "credential-canary-must-not-cross",
      OPENAI_API_KEY: "credential-canary-must-not-cross",
      AWS_SECRET_ACCESS_KEY: "credential-canary-must-not-cross",
      ACTESTRA_GOOSE_WINDOWS_RUNTIME_INTEGRATION: "1",
      ACTESTRA_GOOSE_WINDOWS_RUNTIME_EVIDENCE_PATH: evidencePath,
      ACTESTRA_GOOSE_WINDOWS_RUNTIME_FAILURE_EVIDENCE_PATH: failureEvidencePath,
      ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR: artifactDirectory,
      ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: binding.manifestSha256,
      ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_SHA256: containmentEvidenceSha256,
    });
    if (
      child.error !== undefined ||
      child.status !== 0 ||
      child.signal !== null ||
      Buffer.byteLength(child.stdout ?? "", "utf8") > MAX_OUTPUT_BYTES ||
      Buffer.byteLength(child.stderr ?? "", "utf8") > MAX_OUTPUT_BYTES
    ) {
      throw new Error(await readFailureCode(failureEvidencePath));
    }
    const evidenceBytes = await readFile(evidencePath).catch(() => {
      throw new Error("windows-runtime-evidence-missing");
    });
    if (evidenceBytes.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error("windows-runtime-evidence-too-large");
    }
    let evidence;
    try {
      evidence = JSON.parse(evidenceBytes.toString("utf8"));
    } catch {
      throw new Error("windows-runtime-evidence-invalid");
    }
    const validation = validateGooseWindowsRuntimeEvidence(evidence, {
      ...binding,
      containmentEvidenceSha256,
    });
    if (!validation.ok) {
      throw new Error(
        validation.code === "windows-runtime-artifact-mismatch"
          ? validation.code
          : "windows-runtime-evidence-invalid",
      );
    }
    const admittedAfter = admitExactArtifact(expectedManifestSha256);
    if (admittedAfter.executableSha256 !== binding.executableSha256) {
      throw new Error("windows-runtime-artifact-mismatch");
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } finally {
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : "windows-runtime-test-failed");
}
