const TARGET_TRIPLE = "x86_64-unknown-linux-gnu";
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CAPABILITY_KEYS = Object.freeze([
  "initialize",
  "openSession",
  "toolDiscovery",
  "prompt",
  "toolDenial",
  "cancellation",
  "crashRestart",
  "parentDeath",
  "cleanup",
]);
const EVIDENCE_KEYS = Object.freeze([
  "cancellation",
  "cleanup",
  "contractVersion",
  "crashRestart",
  "executableSha256",
  "initialize",
  "openSession",
  "parentDeath",
  "prompt",
  "sourceCommit",
  "status",
  "targetTriple",
  "toolDenial",
  "toolDiscovery",
]);
const FAILURE_STAGE_CODES = Object.freeze({
  "artifact-admission": "integration-artifact-admission-failed",
  "bridge-capability-open": "integration-bridge-capability-open-failed",
  "bridge-config": "integration-bridge-config-failed",
  "bridge-model-open": "integration-bridge-model-open-failed",
  "bridge-open": "integration-bridge-open-failed",
  "bridge-port-reservation": "integration-bridge-port-reservation-failed",
  "bridge-socket-listen": "integration-bridge-socket-listen-failed",
  "bridge-socket-permission": "integration-bridge-socket-permission-failed",
  "bridge-socket-state": "integration-bridge-socket-state-failed",
  cancellation: "integration-cancellation-failed",
  cleanup: "integration-cleanup-failed",
  "composition-cleanup": "integration-composition-cleanup-failed",
  "composition-open": "integration-composition-open-failed",
  crash: "integration-crash-failed",
  handshake: "integration-handshake-failed",
  initialize: "integration-initialize-failed",
  "launch-contract": "integration-launch-contract-failed",
  "parent-death": "integration-parent-death-failed",
  prompt: "integration-prompt-failed",
  restart: "integration-restart-failed",
  "runner-open": "integration-runner-open-failed",
  "runner-process-spawn": "integration-runner-process-spawn-failed",
  "runner-stdin": "integration-runner-stdin-failed",
  "runner-spawn": "integration-runner-spawn-failed",
  "runtime-network": "integration-runtime-network-failed",
  "runtime-resource": "integration-runtime-resource-failed",
  "session-open": "integration-session-open-failed",
  "tool-denial": "integration-tool-denial-failed",
  "tool-discovery": "integration-tool-discovery-failed",
});
const FAILURE_EVIDENCE_KEYS = Object.freeze(["contractVersion", "stage"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(code) {
  return Object.freeze({ ok: false, code });
}

export function validateGooseNativeIntegrationEvidence(value, binding) {
  if (!isRecord(value) || !isRecord(binding)) return invalid("invalid-integration-evidence");
  const keys = Object.keys(value).sort();
  if (
    keys.length !== EVIDENCE_KEYS.length ||
    keys.some((key, index) => key !== EVIDENCE_KEYS[index])
  ) {
    return invalid("invalid-integration-evidence");
  }
  if (
    value.contractVersion !== 1 ||
    value.status !== "verified" ||
    value.targetTriple !== TARGET_TRIPLE ||
    typeof value.sourceCommit !== "string" ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    typeof value.executableSha256 !== "string" ||
    !SHA256_PATTERN.test(value.executableSha256) ||
    CAPABILITY_KEYS.some((key) => value[key] !== true)
  ) {
    return invalid("integration-evidence-incomplete");
  }
  if (
    binding.targetTriple !== value.targetTriple ||
    binding.sourceCommit !== value.sourceCommit ||
    binding.executableSha256 !== value.executableSha256
  ) {
    return invalid("integration-artifact-mismatch");
  }
  return Object.freeze({ ok: true });
}

export function classifyGooseNativeIntegrationFailureEvidence(value) {
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

export const GOOSE_NATIVE_INTEGRATION_EVIDENCE_KEYS = EVIDENCE_KEYS;
export const GOOSE_NATIVE_INTEGRATION_CAPABILITY_KEYS = CAPABILITY_KEYS;
export const GOOSE_NATIVE_INTEGRATION_TARGET_TRIPLE = TARGET_TRIPLE;
