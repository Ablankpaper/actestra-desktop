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
  "fixture-filesystem": "windows-runtime-fixture-filesystem-failed",
  "fixture-git-init": "windows-runtime-fixture-git-init-failed",
  "fixture-git-config": "windows-runtime-fixture-git-config-failed",
  "fixture-git-commit": "windows-runtime-fixture-git-commit-failed",
  "fixture-persistence-open": "windows-runtime-fixture-persistence-open-failed",
  "fixture-domain-state": "windows-runtime-fixture-domain-state-failed",
  "fixture-baseline": "windows-runtime-fixture-baseline-failed",
  "coding-session-open": "windows-runtime-coding-session-open-failed",
  "coding-session-open-invalid-options": "windows-runtime-coding-session-invalid-options-failed",
  "coding-session-open-repository-invalid":
    "windows-runtime-coding-session-repository-invalid-failed",
  "coding-session-open-repository-config-denied":
    "windows-runtime-coding-session-repository-config-denied-failed",
  "coding-session-open-worktree-create-failed":
    "windows-runtime-coding-session-worktree-create-failed",
  "coding-session-open-cleanup-failed": "windows-runtime-coding-session-cleanup-failed",
  "coding-session-open-persistence-failed": "windows-runtime-coding-session-persistence-failed",
  "composition-open": "windows-runtime-composition-open-failed",
  "runner-open": "windows-runtime-runner-open-failed",
  "runtime-network": "windows-runtime-network-policy-failed",
  "runtime-resource": "windows-runtime-resource-enforcement-failed",
  "launch-contract": "windows-runtime-launch-contract-failed",
  "runner-process-spawn": "windows-runtime-runner-process-spawn-failed",
  "runner-stdin": "windows-runtime-runner-stdin-failed",
  "runner-runtime": "windows-runtime-runner-runtime-failed",
  "runner-acp": "windows-runtime-runner-acp-failed",
  "runner-relay": "windows-runtime-runner-relay-failed",
  "runner-panic": "windows-runtime-runner-panic-failed",
  "windows-control-channel-invalid": "windows-runtime-supervisor-control-channel-invalid-failed",
  "windows-ready-channel-invalid": "windows-runtime-supervisor-ready-channel-invalid-failed",
  "windows-capability-channel-invalid":
    "windows-runtime-supervisor-capability-channel-invalid-failed",
  "windows-model-channel-invalid": "windows-runtime-supervisor-model-channel-invalid-failed",
  "windows-acp-relay-failed": "windows-runtime-supervisor-acp-relay-failed",
  "windows-capability-relay-failed": "windows-runtime-supervisor-capability-relay-failed",
  "windows-model-relay-failed": "windows-runtime-supervisor-model-relay-failed",
  "windows-worker-runtime-failed": "windows-runtime-supervisor-worker-runtime-failed",
  "windows-runtime-timeout": "windows-runtime-supervisor-timeout-failed",
  "windows-runtime-cleanup-failed": "windows-runtime-supervisor-cleanup-failed",
  "windows-state-directory-layout-failed": "windows-runtime-state-directory-layout-failed",
  "windows-state-directory-root-metadata-failed":
    "windows-runtime-state-directory-root-metadata-failed",
  "windows-state-directory-root-canonicalize-failed":
    "windows-runtime-state-directory-root-canonicalize-failed",
  "windows-state-directory-data-metadata-failed":
    "windows-runtime-state-directory-data-metadata-failed",
  "windows-state-directory-data-create-failed":
    "windows-runtime-state-directory-data-create-failed",
  "windows-state-directory-data-canonicalize-failed":
    "windows-runtime-state-directory-data-canonicalize-failed",
  "windows-state-directory-config-metadata-failed":
    "windows-runtime-state-directory-config-metadata-failed",
  "windows-state-directory-config-create-failed":
    "windows-runtime-state-directory-config-create-failed",
  "windows-state-directory-config-canonicalize-failed":
    "windows-runtime-state-directory-config-canonicalize-failed",
  "windows-state-directory-traversal-shape-invalid":
    "windows-runtime-state-directory-traversal-shape-invalid",
  "windows-state-directory-ancestor-access-failed":
    "windows-runtime-state-directory-ancestor-access-failed",
  "windows-state-directory-root-access-failed":
    "windows-runtime-state-directory-root-access-failed",
  "windows-state-directory-child-access-failed":
    "windows-runtime-state-directory-child-access-failed",
  "windows-state-directory-integrity-label-failed":
    "windows-runtime-state-directory-integrity-label-failed",
  "windows-worker-control-frame-invalid": "windows-runtime-worker-control-frame-invalid-failed",
  "windows-worker-boundary-verification-failed":
    "windows-runtime-worker-boundary-verification-failed",
  "windows-worker-runtime-creation-failed": "windows-runtime-worker-runtime-creation-failed",
  "windows-worker-capability-bridge-failed": "windows-runtime-worker-capability-bridge-failed",
  "windows-worker-model-bridge-failed": "windows-runtime-worker-model-bridge-failed",
  "windows-worker-state-directory-failed": "windows-runtime-worker-state-directory-failed",
  "windows-worker-ready-signal-failed": "windows-runtime-worker-ready-signal-failed",
  "windows-worker-acp-handshake-failed": "windows-runtime-worker-acp-handshake-failed",
  "test-child-spawn": "windows-runtime-test-child-spawn-failed",
  "test-child-timeout": "windows-runtime-test-child-timeout-failed",
  "test-child-signal": "windows-runtime-test-child-signal-failed",
  "test-collection-empty": "windows-runtime-test-collection-empty-failed",
  "test-module-load": "windows-runtime-test-module-load-failed",
  "test-assertion": "windows-runtime-test-assertion-failed",
  "test-child-exited": "windows-runtime-test-child-exited-failed",
  "test-output-too-large": "windows-runtime-test-output-too-large-failed",
  "test-stage-unknown": "windows-runtime-test-stage-unknown-failed",
  "test-failure-evidence-missing": "windows-runtime-test-failure-evidence-missing-failed",
  "test-failure-evidence-invalid": "windows-runtime-test-failure-evidence-invalid-failed",
  "test-failure-evidence-too-large": "windows-runtime-test-failure-evidence-too-large-failed",
  "handshake-process-exit": "windows-runtime-handshake-process-exit-failed",
  "handshake-process-signal": "windows-runtime-handshake-process-signal-failed",
  "handshake-timeout": "windows-runtime-handshake-timeout-failed",
  "handshake-transport": "windows-runtime-handshake-transport-failed",
  "handshake-response": "windows-runtime-handshake-response-failed",
  "session-open": "windows-runtime-session-open-failed",
  "session-timeout": "windows-runtime-session-timeout-failed",
  "session-process-exit": "windows-runtime-session-process-exit-failed",
  "session-transport": "windows-runtime-session-transport-failed",
  "tool-discovery": "windows-runtime-tool-discovery-failed",
  "composition-cleanup": "windows-runtime-composition-cleanup-failed",
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
const CODING_SESSION_OPEN_ERROR_CODES = new Set([
  "invalid-options",
  "repository-invalid",
  "repository-config-denied",
  "worktree-create-failed",
  "cleanup-failed",
]);
const WINDOWS_SUPERVISOR_FAILURE_STAGES = Object.freeze([
  "windows-control-channel-invalid",
  "windows-ready-channel-invalid",
  "windows-capability-channel-invalid",
  "windows-model-channel-invalid",
  "windows-acp-relay-failed",
  "windows-capability-relay-failed",
  "windows-model-relay-failed",
  "windows-worker-runtime-failed",
  "windows-runtime-timeout",
  "windows-runtime-cleanup-failed",
  "windows-state-directory-layout-failed",
  "windows-state-directory-root-metadata-failed",
  "windows-state-directory-root-canonicalize-failed",
  "windows-state-directory-data-metadata-failed",
  "windows-state-directory-data-create-failed",
  "windows-state-directory-data-canonicalize-failed",
  "windows-state-directory-config-metadata-failed",
  "windows-state-directory-config-create-failed",
  "windows-state-directory-config-canonicalize-failed",
  "windows-state-directory-traversal-shape-invalid",
  "windows-state-directory-ancestor-access-failed",
  "windows-state-directory-root-access-failed",
  "windows-state-directory-child-access-failed",
  "windows-state-directory-integrity-label-failed",
]);
const WINDOWS_WORKER_STARTUP_STAGES = Object.freeze([
  "windows-worker-control-frame-invalid",
  "windows-worker-boundary-verification-failed",
  "windows-worker-runtime-creation-failed",
  "windows-worker-capability-bridge-failed",
  "windows-worker-model-bridge-failed",
  "windows-worker-state-directory-failed",
  "windows-worker-ready-signal-failed",
  "windows-worker-acp-handshake-failed",
]);
const WINDOWS_OPEN_FAILURE_STAGES = Object.freeze([
  "artifact-admission",
  "artifact-binding-incomplete",
  "runtime-network",
  "runtime-resource",
  "launch-contract",
  "runner-process-spawn",
  "runner-open",
  "runner-stdin",
  "runner-runtime",
  "runner-acp",
  "runner-relay",
  "runner-panic",
  ...WINDOWS_SUPERVISOR_FAILURE_STAGES,
  ...WINDOWS_WORKER_STARTUP_STAGES,
  "handshake-process-exit",
  "handshake-process-signal",
  "handshake-timeout",
  "handshake-transport",
  "handshake-response",
  "session-open",
  "session-timeout",
  "session-process-exit",
  "session-transport",
  "tool-discovery",
  "composition-cleanup",
  "composition-open",
]);
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;

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

/**
 * Classify a failed Windows integration child using bounded metadata and fixed
 * output signatures. Raw child output is never returned or persisted here.
 */
export function classifyGooseWindowsRuntimeChildFailure(value) {
  if (!isRecord(value)) return FAILURE_STAGE_CODES["test-child-exited"];
  const failureStage = typeof value.failureStage === "string" ? value.failureStage : undefined;
  if (failureStage !== undefined) {
    const stageCode = classifyGooseWindowsRuntimeFailureEvidence({
      contractVersion: 1,
      stage: failureStage,
    });
    return stageCode ?? FAILURE_STAGE_CODES["test-stage-unknown"];
  }

  const stdout = typeof value.stdout === "string" ? value.stdout : "";
  const stderr = typeof value.stderr === "string" ? value.stderr : "";
  if (
    Buffer.byteLength(stdout, "utf8") > MAX_CHILD_OUTPUT_BYTES ||
    Buffer.byteLength(stderr, "utf8") > MAX_CHILD_OUTPUT_BYTES
  ) {
    return FAILURE_STAGE_CODES["test-output-too-large"];
  }
  if (value.errorCode === "ETIMEDOUT") return FAILURE_STAGE_CODES["test-child-timeout"];
  if (value.signal !== undefined && value.signal !== null) {
    return FAILURE_STAGE_CODES["test-child-signal"];
  }
  if (typeof value.errorCode === "string") return FAILURE_STAGE_CODES["test-child-spawn"];

  const output = `${stdout}\n${stderr}`;
  if (output.includes("No test files found")) {
    return FAILURE_STAGE_CODES["test-collection-empty"];
  }
  if (/Failed to load|Transform failed|Cannot find module|SyntaxError/u.test(output)) {
    return FAILURE_STAGE_CODES["test-module-load"];
  }
  if (/Test Files.*failed|Tests.*failed|^\s*FAIL\s/msu.test(output)) {
    return FAILURE_STAGE_CODES["test-assertion"];
  }
  return FAILURE_STAGE_CODES["test-child-exited"];
}

export function classifyGooseWindowsCodingSessionOpenError(error) {
  const pending = [error];
  const visited = new Set();
  let openFailed = false;
  while (pending.length > 0) {
    const current = pending.shift();
    if (!isRecord(current) || visited.has(current)) continue;
    visited.add(current);
    if (typeof current.code === "string") {
      if (CODING_SESSION_OPEN_ERROR_CODES.has(current.code)) {
        return `coding-session-open-${current.code}`;
      }
      if (current.code === "open-failed") openFailed = true;
    }
    if (Object.hasOwn(current, "cause")) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return openFailed ? "coding-session-open-persistence-failed" : "coding-session-open";
}

export function classifyGooseWindowsOpeningFailure(error) {
  const pending = [error];
  const visited = new Set();
  let fallback = "composition-open";
  while (pending.length > 0) {
    const current = pending.shift();
    if (!isRecord(current) || visited.has(current)) continue;
    visited.add(current);
    const name = typeof current.name === "string" ? current.name : "";
    const code = typeof current.code === "string" ? current.code : "";
    const message = typeof current.message === "string" ? current.message : "";
    if (name === "GooseRunnerProcessError") {
      if (code === "artifact-mismatch") return "artifact-admission";
      if (code === "network-policy-unavailable") return "runtime-network";
      if (code === "worker-resource-enforcement-unavailable") return "runtime-resource";
      if (code === "invalid-options") return "launch-contract";
      if (code === "cleanup-failed") return "composition-cleanup";
      if (WINDOWS_SUPERVISOR_FAILURE_STAGES.includes(code)) return code;
      if (WINDOWS_WORKER_STARTUP_STAGES.includes(code)) return code;
      if (code === "spawn-failed") {
        if (message === "Failed to launch Goose ACP process") return "runner-process-spawn";
        if (message === "Goose stdin is not writable") return "runner-stdin";
        if (message === "Goose async runtime failed") return "runner-runtime";
        if (message === "Goose ACP server failed") return "runner-acp";
        if (message === "Goose Linux relay stopped") return "runner-relay";
        if (message === "Goose runner panicked") return "runner-panic";
        if (message === "Goose handshake launch failed") fallback = "runner-open";
        else return "runner-process-spawn";
      }
    } else if (name === "GooseAcpHandshakeError") {
      if (code === "process-exit") return "handshake-process-exit";
      if (code === "process-signal") return "handshake-process-signal";
      if (code === "startup-timeout") return "handshake-timeout";
      if (code === "transport-error") fallback = "handshake-transport";
      else return "handshake-response";
    } else if (name === "GooseAcpSessionError") {
      if (code === "session-timeout") return "session-timeout";
      if (code === "session-process-exit") return "session-process-exit";
      if (code === "session-transport-error") return "session-transport";
      if (code.startsWith("tool-discovery")) return "tool-discovery";
      return "session-open";
    } else if (name === "GooseMcpSessionCompositionError") {
      if (code === "cleanup-failed") return "composition-cleanup";
      if (code === "tool-discovery-mismatch") return "tool-discovery";
    } else if (code === "network-policy-unavailable") {
      return "runtime-network";
    }
    if (Object.hasOwn(current, "cause")) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  return WINDOWS_OPEN_FAILURE_STAGES.includes(fallback) ? fallback : "composition-open";
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
export const GOOSE_WINDOWS_RUNTIME_STAGE_FAILURE_CODES = Object.freeze(
  Object.values(FAILURE_STAGE_CODES),
);
export const GOOSE_WINDOWS_ARTIFACT_ADMISSION_FAILURE_CODES = Object.freeze(
  Object.values(ARTIFACT_ADMISSION_FAILURE_CODES),
);
export const GOOSE_WINDOWS_RUNTIME_TARGET_TRIPLE = TARGET_TRIPLE;
