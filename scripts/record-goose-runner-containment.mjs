import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  classifyGooseContainmentIncompleteEvidence,
  classifyGooseContainmentProbeStderr,
  GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES,
  validateGooseContainmentEvidence,
  validateGooseContainmentPrimitiveEvidence,
  validateGooseContainmentRecord,
} from "./gooseContainmentEvidence.mjs";
import { resolveGooseContainmentProbeExecutable } from "./gooseContainmentProbeExecutable.mjs";
import { validateGooseNativeIntegrationEvidence } from "./gooseNativeIntegrationEvidence.mjs";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;
const MAX_INTEGRATION_EVIDENCE_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 30_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROBE_SOURCES = Object.freeze({
  "x86_64-unknown-linux-gnu": "workers/goose-runner/src/containment/linux.rs",
  "x86_64-pc-windows-msvc": "workers/goose-runner/src/containment/windows.rs",
});

const CONTAINMENT_KEYS = Object.freeze([
  "cleanup",
  "contractVersion",
  "executableSha256",
  "filesystem",
  "network",
  "parentDeath",
  "probeSha256",
  "processTree",
  "resources",
  "sourceCommit",
  "targetTriple",
]);

const FAILURE_CODES = new Set([
  "artifact-directory-invalid",
  "artifact-directory-outside-trust-root",
  "artifact-mismatch",
  "containment-bind-failed",
  "evidence-incomplete",
  "executable-digest-invalid",
  "executable-digest-mismatch",
  "executable-invalid",
  "executable-metadata-invalid",
  "invalid-evidence",
  "integration-artifact-mismatch",
  "integration-evidence-incomplete",
  "integration-evidence-invalid",
  "integration-evidence-missing",
  "integration-evidence-outside-root",
  "integration-evidence-root-invalid",
  "integration-evidence-too-large",
  "manifest-bind-failed",
  "manifest-invalid",
  "manifest-too-large",
  "probe-failed",
  "probe-executable-path-invalid",
  "probe-executable-invalid",
  "probe-executable-metadata-invalid",
  "probe-executable-digest-mismatch",
  "rustc-unavailable",
  "source-commit-invalid",
  "target-unavailable",
  "target-unsupported",
  ...GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES,
]);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixedFailure(code) {
  const normalized =
    code === "invalid-integration-evidence" ? "integration-evidence-invalid" : code;
  const safeCode =
    typeof normalized === "string" && FAILURE_CODES.has(normalized)
      ? normalized
      : "containment-bind-failed";
  process.stderr.write(`Goose containment ${safeCode}\n`);
  process.exitCode = 2;
}

function resolveHostTarget() {
  const result = spawnSync("rustc", ["-Vv"], {
    cwd: path.join(repositoryRoot, "workers/goose-runner"),
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  if (result.status !== 0 || result.signal !== null) {
    throw new Error("rustc-unavailable");
  }
  const targetTriple = result.stdout.match(/^host: (.+)$/mu)?.[1];
  if (targetTriple === undefined) throw new Error("target-unavailable");
  return targetTriple;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("manifest-invalid");
  }
}

function requireBoundedDigest(value, pattern, code) {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(code);
  return value;
}

function containmentRecord(evidence) {
  return Object.freeze(Object.fromEntries(CONTAINMENT_KEYS.map((key) => [key, evidence[key]])));
}

async function readArtifact(artifactDirectory) {
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
  const manifest = safeJson(manifestBytes.toString("utf8"));
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("manifest-invalid");
  }
  return { manifestPath, manifest };
}

async function validateLinuxIntegrationEvidence(evidencePath, evidenceRoot, binding) {
  if (
    typeof evidencePath !== "string" ||
    typeof evidenceRoot !== "string" ||
    !path.isAbsolute(evidencePath) ||
    !path.isAbsolute(evidenceRoot)
  ) {
    throw new Error("integration-evidence-missing");
  }
  const rootStat = await lstat(evidenceRoot).catch(() => undefined);
  if (rootStat === undefined || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("integration-evidence-root-invalid");
  }
  const canonicalRoot = await realpath(evidenceRoot).catch(() => {
    throw new Error("integration-evidence-root-invalid");
  });
  const evidenceStat = await lstat(evidencePath).catch(() => undefined);
  if (evidenceStat === undefined || !evidenceStat.isFile() || evidenceStat.isSymbolicLink()) {
    throw new Error("integration-evidence-missing");
  }
  if (evidenceStat.size > MAX_INTEGRATION_EVIDENCE_BYTES) {
    throw new Error("integration-evidence-too-large");
  }
  const canonicalEvidencePath = await realpath(evidencePath).catch(() => {
    throw new Error("integration-evidence-missing");
  });
  const relativeEvidencePath = path.relative(canonicalRoot, canonicalEvidencePath);
  if (
    relativeEvidencePath.length === 0 ||
    relativeEvidencePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeEvidencePath)
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
}

async function bindContainment() {
  const targetTriple = process.argv[2] ?? resolveHostTarget();
  const sourceRelativePath = PROBE_SOURCES[targetTriple];
  if (sourceRelativePath === undefined) throw new Error("target-unsupported");
  const requestedArtifactDirectory = path.resolve(
    process.argv[3] ?? path.join(repositoryRoot, ".actestra", "goose-runner", targetTriple),
  );
  const ownedRunnerRoot = await realpath(
    path.join(repositoryRoot, ".actestra", "goose-runner"),
  ).catch(() => {
    throw new Error("artifact-directory-outside-trust-root");
  });
  const artifactDirectory = await realpath(requestedArtifactDirectory).catch(() => {
    throw new Error("artifact-directory-invalid");
  });
  const relativeArtifactDirectory = path.relative(ownedRunnerRoot, artifactDirectory);
  if (
    relativeArtifactDirectory.length === 0 ||
    relativeArtifactDirectory.startsWith(".." + path.sep) ||
    path.isAbsolute(relativeArtifactDirectory)
  ) {
    throw new Error("artifact-directory-outside-trust-root");
  }
  const { manifestPath, manifest } = await readArtifact(artifactDirectory);
  const executableFile = manifest.runner?.executable?.file;
  const executableSha256 = requireBoundedDigest(
    manifest.runner?.executable?.sha256,
    SHA256_PATTERN,
    "executable-digest-invalid",
  );
  const executableSize = manifest.runner?.executable?.size;
  const sourceCommit = requireBoundedDigest(
    manifest.provenance?.actestraCommit,
    COMMIT_PATTERN,
    "source-commit-invalid",
  );
  if (
    typeof executableFile !== "string" ||
    path.basename(executableFile) !== executableFile ||
    !Number.isSafeInteger(executableSize) ||
    executableSize < 1
  ) {
    throw new Error("executable-metadata-invalid");
  }
  const executablePath = path.join(artifactDirectory, executableFile);
  const executableStat = await lstat(executablePath).catch(() => undefined);
  if (
    executableStat === undefined ||
    !executableStat.isFile() ||
    executableStat.isSymbolicLink() ||
    executableStat.size !== executableSize
  ) {
    throw new Error("executable-invalid");
  }
  const actualExecutableSha256 = digest(await readFile(executablePath));
  if (actualExecutableSha256 !== executableSha256) throw new Error("executable-digest-mismatch");

  const probeExecutablePath = await resolveGooseContainmentProbeExecutable({
    targetTriple,
    artifactExecutablePath: executablePath,
    artifactExecutableSha256: executableSha256,
    artifactExecutableSize: executableSize,
    requestedExecutablePath: process.argv[6],
  });

  const probeSource = await readFile(path.join(repositoryRoot, sourceRelativePath));
  const probeSha256 = digest(probeSource);

  if (targetTriple === "x86_64-unknown-linux-gnu") {
    await validateLinuxIntegrationEvidence(process.argv[4], process.argv[5], {
      targetTriple,
      sourceCommit,
      executableSha256,
    });
  }

  const existing = manifest.containment;
  if (existing !== undefined) {
    const validation = validateGooseContainmentRecord(existing, {
      targetTriple,
      sourceCommit,
      executableSha256,
      probeSha256,
    });
    if (!validation.ok) {
      fixedFailure(validation.code);
      return;
    }
    process.stdout.write("Goose containment manifest already bound\n");
    return;
  }

  const result = spawnSync(probeExecutablePath, [], {
    cwd: artifactDirectory,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      ACTESTRA_GOOSE_CONTAINMENT_PROBE: "1",
      ACTESTRA_GOOSE_CONTAINMENT_DEBUG: "1",
      ACTESTRA_GOOSE_TARGET_TRIPLE: targetTriple,
      ACTESTRA_GOOSE_SOURCE_COMMIT: sourceCommit,
      ACTESTRA_GOOSE_PROBE_SHA256: probeSha256,
      ACTESTRA_GOOSE_EXECUTABLE_SHA256: executableSha256,
    },
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: MAX_PROBE_OUTPUT_BYTES,
  });
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    result.signal !== null ||
    Buffer.byteLength(result.stdout ?? "", "utf8") > MAX_PROBE_OUTPUT_BYTES ||
    Buffer.byteLength(result.stderr ?? "", "utf8") > MAX_PROBE_OUTPUT_BYTES
  ) {
    fixedFailure(classifyGooseContainmentProbeStderr(result.stderr) ?? "probe-failed");
    return;
  }
  let evidence;
  try {
    evidence = JSON.parse(result.stdout.trim());
  } catch {
    fixedFailure("invalid-evidence");
    return;
  }
  const validation =
    targetTriple === "x86_64-unknown-linux-gnu"
      ? validateGooseContainmentPrimitiveEvidence(evidence, {
          targetTriple,
          sourceCommit,
          executableSha256,
          probeSha256,
        })
      : validateGooseContainmentEvidence(evidence, {
          targetTriple,
          sourceCommit,
          executableSha256,
          probeSha256,
        });
  if (!validation.ok) {
    const diagnostic =
      classifyGooseContainmentProbeStderr(result.stderr) ??
      (validation.code === "evidence-incomplete"
        ? classifyGooseContainmentIncompleteEvidence(evidence)
        : undefined) ??
      validation.code;
    fixedFailure(diagnostic);
    return;
  }

  const nextManifest = { ...manifest, containment: containmentRecord(evidence) };
  const nextBytes = `${JSON.stringify(nextManifest, null, 2)}\n`;
  if (Buffer.byteLength(nextBytes, "utf8") > MAX_MANIFEST_BYTES) {
    fixedFailure("manifest-too-large");
    return;
  }
  const temporaryPath = path.join(
    artifactDirectory,
    `.actestra-goose-runner.manifest.${process.pid}.tmp`,
  );
  try {
    await writeFile(temporaryPath, nextBytes, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, manifestPath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error("manifest-bind-failed");
  }
  process.stdout.write("Goose containment manifest bound\n");
}

try {
  await bindContainment();
} catch (error) {
  fixedFailure(error instanceof Error ? error.message : undefined);
}
