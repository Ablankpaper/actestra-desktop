import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  classifyGooseNativeIntegrationFailureEvidence,
  validateGooseNativeIntegrationEvidence,
  GOOSE_NATIVE_INTEGRATION_TARGET_TRIPLE,
} from "./gooseNativeIntegrationEvidence.mjs";

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_FAILURE_EVIDENCE_BYTES = 1024;
const FAILURE_CODES = new Set([
  "integration-artifact-admission-failed",
  "integration-artifact-mismatch",
  "integration-artifact-invalid",
  "integration-bridge-capability-open-failed",
  "integration-bridge-config-failed",
  "integration-bridge-model-open-failed",
  "integration-bridge-open-failed",
  "integration-bridge-port-reservation-failed",
  "integration-bridge-socket-listen-failed",
  "integration-bridge-socket-permission-failed",
  "integration-bridge-socket-state-failed",
  "integration-cancellation-failed",
  "integration-cleanup-failed",
  "integration-composition-cleanup-failed",
  "integration-composition-open-failed",
  "integration-crash-failed",
  "integration-evidence-incomplete",
  "integration-evidence-invalid",
  "integration-evidence-missing",
  "integration-evidence-too-large",
  "integration-failed",
  "integration-handshake-failed",
  "integration-handshake-cleanup-failed",
  "integration-handshake-process-exit-failed",
  "integration-handshake-process-signal-failed",
  "integration-handshake-response-failed",
  "integration-handshake-timeout-failed",
  "integration-handshake-transport-failed",
  "integration-handshake-transport-process-failed",
  "integration-handshake-transport-stderr-failed",
  "integration-handshake-transport-stdin-failed",
  "integration-handshake-transport-stdout-failed",
  "integration-initialize-failed",
  "integration-launch-contract-failed",
  "integration-parent-death-failed",
  "integration-prompt-failed",
  "integration-restart-failed",
  "integration-runner-open-failed",
  "integration-runner-acp-failed",
  "integration-runner-panic-failed",
  "integration-runner-relay-failed",
  "integration-runner-runtime-failed",
  "integration-runner-process-spawn-failed",
  "integration-runner-stdin-failed",
  "integration-runner-spawn-failed",
  "integration-runtime-network-failed",
  "integration-runtime-resource-failed",
  "integration-session-open-failed",
  "integration-target-unsupported",
  "integration-test-failed",
  "integration-tool-denial-failed",
  "integration-tool-discovery-failed",
]);
const FAILURE_ALIASES = new Map([
  ["artifact-directory-invalid", "integration-artifact-invalid"],
  ["artifact-root-invalid", "integration-artifact-invalid"],
  ["evidence-directory-invalid", "integration-evidence-invalid"],
  ["invalid-integration-evidence", "integration-evidence-invalid"],
  ["manifest-invalid", "integration-artifact-invalid"],
  ["manifest-too-large", "integration-artifact-invalid"],
  ["target-unsupported", "integration-target-unsupported"],
]);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerRoot = path.join(repositoryRoot, ".actestra", "goose-runner");
const integrationTest = "tests/main/gooseRunnerLinuxNative.integration.ts";

function fail(code) {
  const normalized = FAILURE_ALIASES.get(code) ?? code;
  const safeCode = FAILURE_CODES.has(normalized) ? normalized : "integration-failed";
  process.stderr.write(`Goose native integration ${safeCode}\n`);
  process.exitCode = 2;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedEnv(evidencePath, failureEvidencePath, artifactDirectory, manifestSha256) {
  const source = process.env;
  return {
    PATH: source.PATH ?? "",
    HOME: source.HOME ?? os.tmpdir(),
    TMPDIR: source.TMPDIR ?? os.tmpdir(),
    LANG: source.LANG ?? "C",
    CI: source.CI ?? "",
    BUN_INSTALL: source.BUN_INSTALL ?? "",
    NODE_OPTIONS: source.NODE_OPTIONS ?? "",
    ACTESTRA_GOOSE_NATIVE_INTEGRATION: "1",
    ACTESTRA_GOOSE_NATIVE_INTEGRATION_EVIDENCE_PATH: evidencePath,
    ACTESTRA_GOOSE_NATIVE_INTEGRATION_FAILURE_EVIDENCE_PATH: failureEvidencePath,
    ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR: artifactDirectory,
    ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: manifestSha256,
  };
}

async function readFailureCode(failureEvidencePath) {
  const bytes = await readFile(failureEvidencePath).catch(() => undefined);
  if (bytes === undefined || bytes.byteLength > MAX_FAILURE_EVIDENCE_BYTES) {
    return "integration-test-failed";
  }
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString("utf8"));
  } catch {
    return "integration-test-failed";
  }
  return classifyGooseNativeIntegrationFailureEvidence(evidence) ?? "integration-test-failed";
}

async function readArtifactBinding(targetTriple) {
  const trustedRoot = await realpath(runnerRoot).catch(() => {
    throw new Error("artifact-root-invalid");
  });
  const artifactDirectory = await realpath(path.join(trustedRoot, targetTriple)).catch(() => {
    throw new Error("artifact-directory-invalid");
  });
  const relative = path.relative(trustedRoot, artifactDirectory);
  if (relative.length === 0 || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("artifact-directory-invalid");
  }
  const stat = await lstat(artifactDirectory).catch(() => undefined);
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("artifact-directory-invalid");
  }
  const manifestPath = path.join(artifactDirectory, "actestra-goose-runner.manifest.json");
  const manifestBytes = await readFile(manifestPath).catch(() => {
    throw new Error("manifest-invalid");
  });
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("manifest-too-large");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("manifest-invalid");
  }
  const sourceCommit = manifest?.provenance?.actestraCommit;
  const executableSha256 = manifest?.runner?.executable?.sha256;
  if (
    typeof sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(sourceCommit) ||
    typeof executableSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(executableSha256)
  ) {
    throw new Error("manifest-invalid");
  }
  return Object.freeze({
    artifactDirectory,
    manifestSha256: digest(manifestBytes),
    sourceCommit,
    executableSha256,
  });
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("target-unsupported");
  const binding = await readArtifactBinding(GOOSE_NATIVE_INTEGRATION_TARGET_TRIPLE);
  const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-native-")).catch(
    () => {
      throw new Error("evidence-directory-invalid");
    },
  );
  const evidencePath = path.join(evidenceDirectory, "integration-evidence.json");
  const failureEvidencePath = path.join(evidenceDirectory, "integration-failure.json");
  try {
    const child = spawnSync("bun", ["run", "test", "--", "--bail=1", integrationTest], {
      cwd: repositoryRoot,
      env: boundedEnv(
        evidencePath,
        failureEvidencePath,
        binding.artifactDirectory,
        binding.manifestSha256,
      ),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
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
      throw new Error("integration-evidence-missing");
    });
    if (evidenceBytes.byteLength > 64 * 1024) throw new Error("integration-evidence-too-large");
    let evidence;
    try {
      evidence = JSON.parse(evidenceBytes.toString("utf8"));
    } catch {
      throw new Error("integration-evidence-invalid");
    }
    const validation = validateGooseNativeIntegrationEvidence(evidence, {
      targetTriple: GOOSE_NATIVE_INTEGRATION_TARGET_TRIPLE,
      sourceCommit: binding.sourceCommit,
      executableSha256: binding.executableSha256,
    });
    if (!validation.ok) throw new Error(validation.code);
    process.stdout.write(`${JSON.stringify({ status: "verified", ...evidence })}\n`);
  } finally {
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : "integration-failed");
}
