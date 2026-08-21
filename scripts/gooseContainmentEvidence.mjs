const EVIDENCE_KEYS = Object.freeze([
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
  "status",
  "targetTriple",
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CAPABILITY_KEYS = Object.freeze([
  "filesystem",
  "network",
  "processTree",
  "resources",
  "parentDeath",
  "cleanup",
]);
const CONTAINMENT_RECORD_KEYS = Object.freeze(EVIDENCE_KEYS.filter((key) => key !== "status"));
const MAX_PROBE_DIAGNOSTIC_BYTES = 64 * 1024;
export const GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES = Object.freeze([
  "cleanup-evidence-incomplete",
  "filesystem-evidence-incomplete",
  "network-evidence-incomplete",
  "parent-death-evidence-incomplete",
  "parent-death-descriptor-setup-failed",
  "parent-death-first-fork-failed",
  "parent-death-intermediate-exit-failed",
  "parent-death-intermediate-exit-timeout",
  "parent-death-observation-read-failed",
  "parent-death-observation-timeout",
  "parent-death-pid-read-failed",
  "parent-death-pid-transfer-failed",
  "parent-death-pipe-setup-failed",
  "parent-death-readiness-failed",
  "parent-death-readiness-pipe-failed",
  "parent-death-second-fork-failed",
  "parent-death-signal-setup-failed",
  "process-creation-not-denied",
  "process-evidence-incomplete",
  "process-exec-not-denied",
  "process-probe-cleanup-failed",
  "process-seccomp-unavailable",
  "process-thread-unavailable",
  "resource-probe-cleanup-failed",
  "resource-evidence-incomplete",
  "resource-rlimit-mismatch",
  "resource-rlimit-unavailable",
  "resource-rlimit-widening-not-denied",
  "remaining-evidence-incomplete",
  "windows-child-frame-invalid",
  "windows-child-request-frame-invalid",
  "windows-child-worker-wait-invalid",
  "windows-child-request-read-invalid",
  "windows-child-result-write-invalid",
  "windows-child-entry-invalid",
  "windows-child-panic-invalid",
  "windows-child-image-load-invalid",
  "windows-child-runtime-fault-invalid",
  "windows-child-before-entry-invalid",
  "windows-child-input-handle-stage-invalid",
  "windows-child-request-length-stage-invalid",
  "windows-child-request-frame-stage-invalid",
  "windows-child-request-decode-stage-invalid",
  "windows-child-filesystem-stage-invalid",
  "windows-child-network-stage-invalid",
  "windows-child-process-stage-invalid",
  "windows-child-result-stage-invalid",
  "windows-child-stage-write-invalid",
  "windows-child-unexpected-exit-invalid",
  "windows-child-result-frame-invalid",
  "windows-cleanup-incomplete",
  "windows-excluded-handle-inherited",
  "windows-excluded-handle-ambiguous",
  "windows-filesystem-evidence-incomplete",
  "windows-job-evidence-incomplete",
  "windows-network-evidence-incomplete",
  "windows-network-control-invalid",
  "windows-network-connected",
  "windows-network-timeout",
  "windows-network-unreachable",
  "windows-network-refused",
  "windows-network-address-unavailable",
  "windows-network-invalid-argument",
  "windows-network-stack-unavailable",
  "windows-network-permission-denied-without-code",
  "windows-network-raw-code-absent",
  "windows-network-unclassified",
  "windows-parent-death-evidence-incomplete",
  "windows-parent-death-frame-invalid",
  "windows-process-evidence-incomplete",
  "windows-profile-cleanup-failed",
  "windows-resource-evidence-incomplete",
  "windows-worker-launch-failed",
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
  "windows-worker-control-frame-invalid",
  "windows-worker-boundary-verification-failed",
  "windows-worker-runtime-creation-failed",
  "windows-worker-capability-bridge-failed",
  "windows-worker-model-bridge-failed",
  "windows-worker-state-directory-failed",
  "windows-worker-ready-signal-failed",
  "windows-worker-acp-handshake-failed",
]);
const PROBE_DIAGNOSTIC_CODES = new Set(GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function invalid(code) {
  return Object.freeze({ ok: false, code });
}

/**
 * Reduce native probe stderr to one fixed native-stage code. Raw stderr is
 * never returned because it may contain platform-owned paths or diagnostics.
 */
export function classifyGooseContainmentProbeStderr(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PROBE_DIAGNOSTIC_BYTES) {
    return undefined;
  }
  const windowsMatch = value.match(
    /^Goose windows containment failed at bounded stage (windows-[a-z-]+)\r?\n?$/u,
  );
  if (windowsMatch !== null) {
    return PROBE_DIAGNOSTIC_CODES.has(windowsMatch[1]) ? windowsMatch[1] : undefined;
  }
  const matches = [
    ...value.matchAll(
      /^Goose (?:parent-death|process-tree|resource) probe failed at bounded stage ((?:parent-death|process|resource)-[a-z-]+)$/gmu,
    ),
  ];
  if (matches.length !== 1 || !PROBE_DIAGNOSTIC_CODES.has(matches[0][1])) {
    return undefined;
  }
  return matches[0][1];
}

/**
 * Classify a schema-valid but deliberately incomplete probe without treating
 * any measured stage as full containment admission. The caller must still
 * keep the non-zero incomplete outcome and leave the artifact unbound.
 */
export function classifyGooseContainmentIncompleteEvidence(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, EVIDENCE_KEYS) ||
    value.status !== "evidence-incomplete" ||
    CAPABILITY_KEYS.some((key) => typeof value[key] !== "boolean")
  ) {
    return undefined;
  }
  if (value.processTree !== true) return "process-evidence-incomplete";
  if (value.resources !== true) return "resource-evidence-incomplete";
  if (value.filesystem !== true) return "filesystem-evidence-incomplete";
  if (value.network !== true) return "network-evidence-incomplete";
  if (value.parentDeath !== true) return "parent-death-evidence-incomplete";
  if (value.cleanup !== true) return "cleanup-evidence-incomplete";
  return "remaining-evidence-incomplete";
}

/**
 * Validate the bounded output of the native containment probe.
 *
 * The return value intentionally contains only a closed reason code. It never
 * includes probe fields, paths, environment values, or digests, because this
 * helper is also used at the process/evidence boundary.
 */
export function validateGooseContainmentEvidence(value, binding) {
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS) || !isRecord(binding)) {
    return invalid("invalid-evidence");
  }
  if (
    value.status === "unsupported-platform" &&
    CAPABILITY_KEYS.every((key) => value[key] === false)
  ) {
    return invalid("evidence-incomplete");
  }
  if (
    typeof value.contractVersion !== "number" ||
    value.contractVersion !== 1 ||
    typeof value.targetTriple !== "string" ||
    !TARGET_PATTERN.test(value.targetTriple) ||
    typeof value.sourceCommit !== "string" ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    typeof value.probeSha256 !== "string" ||
    !SHA256_PATTERN.test(value.probeSha256) ||
    typeof value.executableSha256 !== "string" ||
    !SHA256_PATTERN.test(value.executableSha256) ||
    (value.status !== "verified" && value.status !== "evidence-incomplete") ||
    CAPABILITY_KEYS.some((key) => typeof value[key] !== "boolean")
  ) {
    return invalid("invalid-evidence");
  }

  if (value.status !== "verified" || CAPABILITY_KEYS.some((key) => value[key] !== true)) {
    return invalid("evidence-incomplete");
  }

  if (
    binding.targetTriple !== value.targetTriple ||
    binding.sourceCommit !== value.sourceCommit ||
    binding.executableSha256 !== value.executableSha256 ||
    (binding.probeSha256 !== undefined && binding.probeSha256 !== value.probeSha256)
  ) {
    return invalid("artifact-mismatch");
  }

  return Object.freeze({ ok: true });
}

/**
 * Validate the raw primitive stage used only by the Linux composite gate.
 * The native probe deliberately remains evidence-incomplete; all six measured
 * primitives must nevertheless be true and bound to the exact Artifact.
 */
export function validateGooseContainmentPrimitiveEvidence(value, binding) {
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS) || !isRecord(binding)) {
    return invalid("invalid-evidence");
  }
  if (
    value.contractVersion !== 1 ||
    typeof value.targetTriple !== "string" ||
    !TARGET_PATTERN.test(value.targetTriple) ||
    typeof value.sourceCommit !== "string" ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    typeof value.probeSha256 !== "string" ||
    !SHA256_PATTERN.test(value.probeSha256) ||
    typeof value.executableSha256 !== "string" ||
    !SHA256_PATTERN.test(value.executableSha256) ||
    CAPABILITY_KEYS.some((key) => typeof value[key] !== "boolean")
  ) {
    return invalid("invalid-evidence");
  }
  if (
    value.status !== "evidence-incomplete" ||
    CAPABILITY_KEYS.some((key) => value[key] !== true)
  ) {
    return invalid("evidence-incomplete");
  }
  if (
    binding.targetTriple !== value.targetTriple ||
    binding.sourceCommit !== value.sourceCommit ||
    binding.executableSha256 !== value.executableSha256 ||
    (binding.probeSha256 !== undefined && binding.probeSha256 !== value.probeSha256)
  ) {
    return invalid("artifact-mismatch");
  }
  return Object.freeze({ ok: true });
}

/**
 * Validate the status-free record persisted in an admitted runner manifest.
 * Probe output carries a status field; the durable manifest deliberately does
 * not, so the two shapes must not be conflated at the write/restart boundary.
 */
export function validateGooseContainmentRecord(value, binding) {
  if (!isRecord(value) || !hasExactKeys(value, CONTAINMENT_RECORD_KEYS)) {
    return invalid("invalid-evidence");
  }
  return validateGooseContainmentEvidence({ ...value, status: "verified" }, binding);
}

export const GOOSE_CONTAINMENT_EVIDENCE_KEYS = EVIDENCE_KEYS;
export const GOOSE_CONTAINMENT_RECORD_KEYS = CONTAINMENT_RECORD_KEYS;
