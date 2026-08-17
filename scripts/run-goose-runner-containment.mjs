import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES,
  validateGooseContainmentRecord,
} from "./gooseContainmentEvidence.mjs";
import { validateGooseNativeIntegrationEvidence } from "./gooseNativeIntegrationEvidence.mjs";

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const FAILURE_CODES = new Set([
  "artifact-directory-invalid",
  "artifact-directory-outside-trust-root",
  "artifact-mismatch",
  "containment-acceptance-failed",
  "containment-bind-failed",
  "evidence-incomplete",
  "integration-artifact-mismatch",
  "integration-artifact-invalid",
  "integration-evidence-incomplete",
  "integration-evidence-invalid",
  "integration-evidence-missing",
  "integration-evidence-outside-root",
  "integration-evidence-root-invalid",
  "integration-evidence-too-large",
  "integration-failed",
  "integration-target-unsupported",
  "integration-test-failed",
  "invalid-evidence",
  "manifest-invalid",
  "manifest-too-large",
  "probe-failed",
  "rustc-unavailable",
  "target-unavailable",
  "target-unsupported",
  ...GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES,
]);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerRoot = path.join(repositoryRoot, ".actestra", "goose-runner");
const PROBE_SOURCES = Object.freeze({
  "x86_64-unknown-linux-gnu": "workers/goose-runner/src/containment/linux.rs",
  "x86_64-pc-windows-msvc": "workers/goose-runner/src/containment/windows.rs",
});

function fixedFailure(code) {
  const normalized =
    code === "invalid-integration-evidence" ? "integration-evidence-invalid" : code;
  const safeCode = FAILURE_CODES.has(normalized) ? normalized : "containment-acceptance-failed";
  process.stderr.write(`Goose containment ${safeCode}\n`);
  process.exitCode = 2;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function resolveHostTarget() {
  const result = spawnSync("rustc", ["-Vv"], {
    cwd: path.join(repositoryRoot, "workers", "goose-runner"),
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    throw new Error("rustc-unavailable");
  }
  const targetTriple = result.stdout.match(/^host: (.+)$/mu)?.[1];
  if (targetTriple === undefined) throw new Error("target-unavailable");
  return targetTriple;
}

function runBoundedNodeScript(scriptName, targetTriple, artifactDirectory, extraArguments = []) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "scripts", scriptName),
      targetTriple,
      artifactDirectory,
      ...extraArguments,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
      },
      timeout: 35_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    },
  );
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    result.signal !== null ||
    Buffer.byteLength(result.stdout ?? "", "utf8") > MAX_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr ?? "", "utf8") > MAX_OUTPUT_BYTES
  ) {
    const childCode = result.stderr?.match(/^Goose containment ([a-z-]+)$/mu)?.[1];
    throw new Error(FAILURE_CODES.has(childCode) ? childCode : "containment-acceptance-failed");
  }
}

function runNativeIntegration(binding) {
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "run-goose-runner-native-integration.mjs")],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 130_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    },
  );
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    result.signal !== null ||
    Buffer.byteLength(result.stdout ?? "", "utf8") > MAX_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr ?? "", "utf8") > MAX_OUTPUT_BYTES
  ) {
    const childCode = result.stderr?.match(/^Goose native integration ([a-z-]+)$/mu)?.[1];
    throw new Error(FAILURE_CODES.has(childCode) ? childCode : "integration-failed");
  }
  let evidence;
  try {
    evidence = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("integration-evidence-invalid");
  }
  const validation = validateGooseNativeIntegrationEvidence(evidence, binding);
  if (!validation.ok) throw new Error(validation.code);
  return evidence;
}

async function readProvidedIntegrationEvidence(evidencePath, evidenceRoot, binding, onOwnedRoot) {
  if (
    typeof evidencePath !== "string" ||
    typeof evidenceRoot !== "string" ||
    !path.isAbsolute(evidencePath) ||
    !path.isAbsolute(evidenceRoot)
  ) {
    throw new Error("integration-evidence-missing");
  }
  const allowedParent = await realpath(process.env.RUNNER_TEMP ?? os.tmpdir()).catch(() => {
    throw new Error("integration-evidence-root-invalid");
  });
  const rootStat = await lstat(evidenceRoot).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("integration-evidence-root-invalid");
  }
  const canonicalRoot = await realpath(evidenceRoot).catch(() => {
    throw new Error("integration-evidence-root-invalid");
  });
  if (
    path.dirname(canonicalRoot) !== allowedParent ||
    !/^actestra-goose-integration-[A-Za-z0-9._-]+$/u.test(path.basename(canonicalRoot))
  ) {
    throw new Error("integration-evidence-root-invalid");
  }
  onOwnedRoot(canonicalRoot);
  const evidenceStat = await lstat(evidencePath).catch(() => undefined);
  if (
    evidenceStat === undefined ||
    !evidenceStat.isFile() ||
    evidenceStat.isSymbolicLink() ||
    evidenceStat.size > MAX_OUTPUT_BYTES
  ) {
    throw new Error(
      evidenceStat !== undefined && evidenceStat.size > MAX_OUTPUT_BYTES
        ? "integration-evidence-too-large"
        : "integration-evidence-missing",
    );
  }
  const canonicalEvidencePath = await realpath(evidencePath).catch(() => {
    throw new Error("integration-evidence-missing");
  });
  const relative = path.relative(canonicalRoot, canonicalEvidencePath);
  if (
    relative !== "integration-evidence.json" ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("integration-evidence-outside-root");
  }
  let evidence;
  try {
    evidence = JSON.parse((await readFile(canonicalEvidencePath)).toString("utf8"));
  } catch {
    throw new Error("integration-evidence-invalid");
  }
  const validation = validateGooseNativeIntegrationEvidence(evidence, binding);
  if (!validation.ok) throw new Error(validation.code);
  return Object.freeze({
    evidence,
    evidencePath: canonicalEvidencePath,
    evidenceRoot: canonicalRoot,
  });
}

async function readArtifactBinding(targetTriple) {
  const ownedRoot = await realpath(runnerRoot).catch(() => {
    throw new Error("artifact-directory-outside-trust-root");
  });
  const artifactDirectory = await realpath(path.join(ownedRoot, targetTriple)).catch(() => {
    throw new Error("artifact-directory-invalid");
  });
  const relative = path.relative(ownedRoot, artifactDirectory);
  if (relative.length === 0 || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("artifact-directory-outside-trust-root");
  }
  const directoryStat = await lstat(artifactDirectory).catch(() => undefined);
  if (
    directoryStat === undefined ||
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink()
  ) {
    throw new Error("artifact-directory-invalid");
  }
  const manifestPath = path.join(artifactDirectory, "actestra-goose-runner.manifest.json");
  const manifestStat = await lstat(manifestPath).catch(() => undefined);
  if (manifestStat === undefined || !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("manifest-invalid");
  }
  const manifestBytes = await readFile(manifestPath);
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
    !COMMIT_PATTERN.test(sourceCommit) ||
    typeof executableSha256 !== "string" ||
    !SHA256_PATTERN.test(executableSha256)
  ) {
    throw new Error("invalid-evidence");
  }
  return Object.freeze({ artifactDirectory, targetTriple, sourceCommit, executableSha256 });
}

async function readVerifiedArtifact(targetTriple) {
  const ownedRoot = await realpath(runnerRoot).catch(() => {
    throw new Error("artifact-directory-outside-trust-root");
  });
  const artifactDirectory = await realpath(path.join(ownedRoot, targetTriple)).catch(() => {
    throw new Error("artifact-directory-invalid");
  });
  const relative = path.relative(ownedRoot, artifactDirectory);
  if (relative.length === 0 || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("artifact-directory-outside-trust-root");
  }
  const directoryStat = await lstat(artifactDirectory).catch(() => undefined);
  if (
    directoryStat === undefined ||
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink()
  ) {
    throw new Error("artifact-directory-invalid");
  }
  const manifestPath = path.join(artifactDirectory, "actestra-goose-runner.manifest.json");
  const manifestStat = await lstat(manifestPath).catch(() => undefined);
  if (manifestStat === undefined || !manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error("manifest-invalid");
  }
  const manifestBytes = await readFile(manifestPath);
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("manifest-too-large");
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("manifest-invalid");
  }
  const containment = manifest?.containment;
  const executableSha256 = manifest?.runner?.executable?.sha256;
  if (typeof executableSha256 !== "string" || !SHA256_PATTERN.test(executableSha256)) {
    throw new Error("invalid-evidence");
  }
  const probeSourceRelativePath = PROBE_SOURCES[targetTriple];
  if (probeSourceRelativePath === undefined) throw new Error("target-unsupported");
  const currentProbeSha256 = digest(
    await readFile(path.join(repositoryRoot, probeSourceRelativePath)),
  );
  const validation = validateGooseContainmentRecord(containment, {
    targetTriple,
    sourceCommit: manifest?.provenance?.actestraCommit,
    executableSha256,
    probeSha256: currentProbeSha256,
  });
  if (!validation.ok) throw new Error(validation.code);
  return Object.freeze({
    targetTriple,
    manifestSha256: digest(manifestBytes),
    executableSha256,
    probeSha256: containment.probeSha256,
  });
}

async function main() {
  const targetTriple = resolveHostTarget();
  if (targetTriple !== "x86_64-unknown-linux-gnu" && targetTriple !== "x86_64-pc-windows-msvc") {
    throw new Error("target-unsupported");
  }
  const binding = await readArtifactBinding(targetTriple);
  const providedEvidencePath = process.argv[2];
  const providedEvidenceRoot = process.argv[3];
  if ((providedEvidencePath === undefined) !== (providedEvidenceRoot === undefined)) {
    throw new Error("integration-evidence-missing");
  }
  if (targetTriple !== "x86_64-unknown-linux-gnu" && providedEvidencePath !== undefined) {
    throw new Error("integration-target-unsupported");
  }
  let evidenceRoot;
  try {
    const binderArguments = [];
    if (targetTriple === "x86_64-unknown-linux-gnu") {
      let integrationEvidencePath;
      if (providedEvidencePath !== undefined && providedEvidenceRoot !== undefined) {
        const provided = await readProvidedIntegrationEvidence(
          providedEvidencePath,
          providedEvidenceRoot,
          binding,
          (ownedRoot) => {
            evidenceRoot = ownedRoot;
          },
        );
        integrationEvidencePath = provided.evidencePath;
      } else {
        const integrationEvidence = runNativeIntegration(binding);
        evidenceRoot = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-composite-"));
        integrationEvidencePath = path.join(evidenceRoot, "integration-evidence.json");
        await writeFile(integrationEvidencePath, `${JSON.stringify(integrationEvidence)}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      }
      binderArguments.push(integrationEvidencePath, evidenceRoot);
    }
    runBoundedNodeScript(
      "record-goose-runner-containment.mjs",
      targetTriple,
      binding.artifactDirectory,
      binderArguments,
    );
    runBoundedNodeScript(
      "test-goose-runner-containment.mjs",
      targetTriple,
      binding.artifactDirectory,
    );
    const evidence = await readVerifiedArtifact(targetTriple);
    process.stdout.write(`${JSON.stringify({ status: "verified", ...evidence })}\n`);
  } finally {
    if (evidenceRoot !== undefined) {
      await rm(evidenceRoot, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  fixedFailure(error instanceof Error ? error.message : undefined);
}
