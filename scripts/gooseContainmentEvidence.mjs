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
 * Reduce native probe stderr to one fixed process/resource-stage code. Raw stderr is
 * never returned because it may contain platform-owned paths or diagnostics.
 */
export function classifyGooseContainmentProbeStderr(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_PROBE_DIAGNOSTIC_BYTES) {
    return undefined;
  }
  const matches = [
    ...value.matchAll(
      /^Goose (?:process-tree|resource) probe failed at bounded stage ((?:process|resource)-[a-z-]+)$/gmu,
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
