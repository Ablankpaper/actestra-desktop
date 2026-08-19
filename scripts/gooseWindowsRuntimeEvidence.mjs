const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_ARTIFACT_ADMISSION_OUTPUT_BYTES = 64 * 1024;
const FAILURE_STAGE_CODES = Object.freeze({
  "artifact-admission": "windows-runtime-artifact-admission-failed",
  "artifact-admission-missing-artifact": "windows-runtime-artifact-admission-missing-artifact",
  "artifact-admission-invalid-manifest": "windows-runtime-artifact-admission-invalid-manifest",
  "artifact-admission-incompatible-artifact":
    "windows-runtime-artifact-admission-incompatible-artifact",
  "artifact-admission-digest-mismatch": "windows-runtime-artifact-admission-digest-mismatch",
  "artifact-admission-invalid-sbom": "windows-runtime-artifact-admission-invalid-sbom",
  "artifact-admission-unsafe-audit": "windows-runtime-artifact-admission-unsafe-audit",
  "artifact-admission-unexpected": "windows-runtime-artifact-admission-rejected",
  "artifact-binding-incomplete": "windows-runtime-artifact-binding-invalid",
  "fixture-setup": "windows-runtime-fixture-setup-failed",
  "composition-open": "windows-runtime-composition-open-failed",
  "read-tool": "windows-runtime-read-tool-failed",
  "approved-write-tool": "windows-runtime-approved-write-tool-failed",
  cancellation: "windows-runtime-cancellation-failed",
  "parent-death": "windows-runtime-parent-death-failed",
});
const ARTIFACT_ADMISSION_FAILURE_CODES = Object.freeze({
  "missing-artifact": "windows-runtime-artifact-admission-missing-artifact",
  "invalid-manifest": "windows-runtime-artifact-admission-invalid-manifest",
  "incompatible-artifact": "windows-runtime-artifact-admission-incompatible-artifact",
  "digest-mismatch": "windows-runtime-artifact-admission-digest-mismatch",
  "invalid-sbom": "windows-runtime-artifact-admission-invalid-sbom",
  "unsafe-audit": "windows-runtime-artifact-admission-unsafe-audit",
  "unsupported-build-host": "windows-runtime-artifact-admission-unsupported-build-host",
  "invalid-build-manifest": "windows-runtime-artifact-admission-invalid-build-manifest",
  "build-artifact-unavailable": "windows-runtime-artifact-admission-build-unavailable",
});
const BOOLEAN_OUTCOMES = Object.freeze([
  "acpInitialized",
  "mcpFreeSessionCreated",
  "readToolCompleted",
  "approvedWriteToolCompleted",
  "cancellationObserved",
  "parentDeathCleanupObserved",
  "credentialCanaryAbsent",
  "environmentCanaryAbsent",
  "directNetworkDenied",
  "originalWorkspaceUnchanged",
]);
const BINDING_KEYS = Object.freeze([
  "targetTriple",
  "sourceCommit",
  "gooseBaseCommit",
  "gooseRuntimeCommit",
  "goosePatchSha256",
  "manifestSha256",
  "executableSha256",
  "containmentEvidenceSha256",
]);
const EVIDENCE_KEYS = Object.freeze(
  [
    "schemaVersion",
    "status",
    ...BINDING_KEYS,
    ...BOOLEAN_OUTCOMES,
    "exactToolCount",
    "residualProcessCount",
  ].sort(),
);
const FAILURE_EVIDENCE_KEYS = Object.freeze(["contractVersion", "stage"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(code) {
  return Object.freeze({ ok: false, code });
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

export function validateGooseWindowsRuntimeEvidence(value, binding) {
  if (!isRecord(value) || !isRecord(binding) || !hasExactKeys(value, EVIDENCE_KEYS)) {
    return invalid("invalid-windows-runtime-evidence");
  }
  if (
    value.schemaVersion !== 1 ||
    value.status !== "verified" ||
    value.targetTriple !== TARGET_TRIPLE ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    !COMMIT_PATTERN.test(value.gooseBaseCommit) ||
    !COMMIT_PATTERN.test(value.gooseRuntimeCommit) ||
    !SHA256_PATTERN.test(value.goosePatchSha256) ||
    !SHA256_PATTERN.test(value.manifestSha256) ||
    !SHA256_PATTERN.test(value.executableSha256) ||
    !SHA256_PATTERN.test(value.containmentEvidenceSha256) ||
    BOOLEAN_OUTCOMES.some((key) => value[key] !== true) ||
    value.exactToolCount !== 6 ||
    value.residualProcessCount !== 0
  ) {
    return invalid("invalid-windows-runtime-evidence");
  }
  if (BINDING_KEYS.some((key) => !Object.hasOwn(binding, key) || binding[key] !== value[key])) {
    return invalid("windows-runtime-artifact-mismatch");
  }
  return Object.freeze({ ok: true });
}

export function classifyGooseWindowsRuntimeFailureEvidence(value) {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== FAILURE_EVIDENCE_KEYS.length ||
    keys.some((key, index) => key !== FAILURE_EVIDENCE_KEYS[index]) ||
    value.contractVersion !== 1 ||
    typeof value.stage !== "string"
  ) {
    return undefined;
  }
  return Object.hasOwn(FAILURE_STAGE_CODES, value.stage)
    ? FAILURE_STAGE_CODES[value.stage]
    : undefined;
}

export function classifyGooseWindowsArtifactAdmissionFailure(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_ARTIFACT_ADMISSION_OUTPUT_BYTES
  ) {
    return undefined;
  }
  const jsonLines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"));
  if (jsonLines.length !== 1) return undefined;
  let failure;
  try {
    failure = JSON.parse(jsonLines[0]);
  } catch {
    return undefined;
  }
  if (
    !isRecord(failure) ||
    !hasExactKeys(failure, ["code", "status"]) ||
    failure.status !== "failed" ||
    typeof failure.code !== "string"
  ) {
    return undefined;
  }
  return Object.hasOwn(ARTIFACT_ADMISSION_FAILURE_CODES, failure.code)
    ? ARTIFACT_ADMISSION_FAILURE_CODES[failure.code]
    : undefined;
}

export function classifyGooseWindowsArtifactAdmissionExecution(value) {
  if (!isRecord(value)) return "windows-runtime-artifact-admission-process-failed";
  const { errorCode, status, signal, stdoutBytes, stderrBytes, stderr } = value;
  if (errorCode === "ETIMEDOUT") return "windows-runtime-artifact-admission-timeout";
  if (
    !Number.isSafeInteger(stdoutBytes) ||
    stdoutBytes < 0 ||
    !Number.isSafeInteger(stderrBytes) ||
    stderrBytes < 0
  ) {
    return "windows-runtime-artifact-admission-process-failed";
  }
  if (
    stdoutBytes > MAX_ARTIFACT_ADMISSION_OUTPUT_BYTES ||
    stderrBytes > MAX_ARTIFACT_ADMISSION_OUTPUT_BYTES
  ) {
    return "windows-runtime-artifact-admission-output-too-large";
  }
  if (errorCode !== undefined || signal !== null) {
    return "windows-runtime-artifact-admission-process-failed";
  }
  if (status === 0) return undefined;
  if (!Number.isSafeInteger(status)) {
    return "windows-runtime-artifact-admission-process-failed";
  }
  return (
    classifyGooseWindowsArtifactAdmissionFailure(stderr) ??
    "windows-runtime-artifact-admission-rejected"
  );
}

export const GOOSE_WINDOWS_RUNTIME_EVIDENCE_KEYS = EVIDENCE_KEYS;
export const GOOSE_WINDOWS_ARTIFACT_ADMISSION_FAILURE_CODES = Object.freeze(
  Object.values(ARTIFACT_ADMISSION_FAILURE_CODES),
);
export const GOOSE_WINDOWS_RUNTIME_TARGET_TRIPLE = TARGET_TRIPLE;
