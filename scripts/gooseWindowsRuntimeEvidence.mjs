const TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FAILURE_STAGE_CODES = Object.freeze({
  "artifact-admission": "windows-runtime-artifact-admission-failed",
  "composition-open": "windows-runtime-composition-open-failed",
  "read-tool": "windows-runtime-read-tool-failed",
  "approved-write-tool": "windows-runtime-approved-write-tool-failed",
  cancellation: "windows-runtime-cancellation-failed",
  "parent-death": "windows-runtime-parent-death-failed",
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

export const GOOSE_WINDOWS_RUNTIME_EVIDENCE_KEYS = EVIDENCE_KEYS;
export const GOOSE_WINDOWS_RUNTIME_TARGET_TRIPLE = TARGET_TRIPLE;
