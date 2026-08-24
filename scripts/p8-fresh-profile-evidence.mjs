import { P8_PLATFORM_MATRIX } from "./p8-platform-matrix.mjs";

const SUCCESS_KEYS = Object.freeze([
  "appAsarSha256",
  "directProviderFetchDenied",
  "executableSha256",
  "gracefulExit",
  "mainReady",
  "packageStructure",
  "packages",
  "profileManifest",
  "providerCount",
  "providerIpc",
  "providerUiState",
  "providerUiTextPresent",
  "rendererReady",
  "residualProcessCount",
  "schemaVersion",
  "sourceCommit",
  "sqliteSchemaVersion",
  "status",
  "targetId",
]);

const FAILURE_KEYS = Object.freeze(["code", "schemaVersion", "sourceCommit", "status", "targetId"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const TARGET_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/u;
const PACKAGE_FORMAT_PATTERN = /^[a-z0-9][a-z0-9-]{0,15}$/u;

export const P8_FRESH_PROFILE_SUCCESS_KEYS = SUCCESS_KEYS;
export const P8_FRESH_PROFILE_FAILURE_KEYS = FAILURE_KEYS;

export const P8_FRESH_PROFILE_FAILURE_CODES = Object.freeze([
  "invalid-arguments",
  "unsupported-target",
  "package-missing",
  "package-structure-invalid",
  "artifact-mismatch",
  "profile-isolation-invalid",
  "spawn-failed",
  "early-exit",
  "startup-timeout",
  "startup-timeout-before-app-ready",
  "startup-timeout-bootstrap-isolation",
  "startup-timeout-bootstrap-home",
  "startup-timeout-bootstrap-temp",
  "startup-timeout-bootstrap-app-data",
  "startup-timeout-bootstrap-name",
  "startup-timeout-bootstrap-directories",
  "startup-timeout-bootstrap-user-data",
  "startup-timeout-bootstrap-session-data",
  "startup-timeout-bootstrap-logs",
  "startup-timeout-bootstrap-crash-dumps",
  "startup-timeout-bootstrap-complete",
  "startup-timeout-app-ready",
  "startup-timeout-initialize",
  "startup-timeout-initialize-complete",
  "startup-timeout-backend",
  "startup-timeout-backend-ready",
  "startup-timeout-window",
  "startup-timeout-renderer",
  "probe-timeout",
  "marker-missing",
  "marker-malformed",
  "marker-duplicate",
  "backend-port-unavailable",
  "direct-provider-fetch-not-denied",
  "provider-ipc-unavailable",
  "provider-projection-nonempty",
  "provider-ui-state-missing",
  "provider-ui-route-missing",
  "provider-ui-header-missing",
  "provider-ui-empty-state-missing",
  "provider-ui-text-missing",
  "provider-ui-evidence-invalid",
  "profile-manifest-invalid",
  "sqlite-schema-invalid",
  "non-graceful-exit",
  "process-probe-failed",
  "residual-processes",
]);

const FAILURE_CODE_SET = new Set(P8_FRESH_PROFILE_FAILURE_CODES);

const TARGETS = new Map(
  P8_PLATFORM_MATRIX.targets.map((target) => [
    target.id,
    Object.freeze({ id: target.id, packageFormats: Object.freeze([...target.packageFormats]) }),
  ]),
);
const FAILURE_TARGETS = new Set([...TARGETS.keys(), "unknown"]);

export const P8_FRESH_PROFILE_TARGETS = Object.freeze(
  Object.fromEntries([...TARGETS].map(([id, target]) => [id, target])),
);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function invalid(code) {
  return Object.freeze({ ok: false, code });
}

function validDigest(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function validCommit(value) {
  return typeof value === "string" && COMMIT_PATTERN.test(value);
}

function expectedTarget(targetId) {
  return typeof targetId === "string" ? TARGETS.get(targetId) : undefined;
}

function packagesMatch(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
    return false;
  }
  return actual.every(
    (entry, index) =>
      isRecord(entry) &&
      hasExactKeys(entry, ["format", "sha256"]) &&
      entry.format === expected[index].format &&
      entry.sha256 === expected[index].sha256,
  );
}

function bindingPackages(binding) {
  if (!Array.isArray(binding?.packages)) return undefined;
  return binding.packages.map((entry) => {
    if (!isRecord(entry)) return undefined;
    return { format: entry.format, sha256: entry.sha256 };
  });
}

/**
 * Validate the exact, success-only P8.2d record. The result intentionally
 * contains no rejected input, paths, process output, or credentials.
 */
export function validateP8FreshProfileEvidence(value, binding) {
  if (!hasExactKeys(value, SUCCESS_KEYS) || !isRecord(binding)) {
    return invalid("invalid-evidence");
  }
  const target = expectedTarget(value.targetId);
  if (
    target === undefined ||
    !TARGET_PATTERN.test(value.targetId) ||
    value.schemaVersion !== 1 ||
    value.status !== "verified" ||
    !validCommit(value.sourceCommit) ||
    !Array.isArray(value.packages) ||
    value.packages.length !== target.packageFormats.length ||
    value.packages.some(
      (entry, index) =>
        !isRecord(entry) ||
        !hasExactKeys(entry, ["format", "sha256"]) ||
        typeof entry.format !== "string" ||
        !PACKAGE_FORMAT_PATTERN.test(entry.format) ||
        entry.format !== target.packageFormats[index] ||
        !validDigest(entry.sha256),
    ) ||
    !validDigest(value.executableSha256) ||
    !validDigest(value.appAsarSha256) ||
    value.packageStructure !== true ||
    value.mainReady !== true ||
    value.rendererReady !== true ||
    value.providerIpc !== true ||
    value.directProviderFetchDenied !== true ||
    value.profileManifest !== true ||
    value.sqliteSchemaVersion !== 23 ||
    value.providerCount !== 0 ||
    value.providerUiState !== "provider-unavailable" ||
    value.providerUiTextPresent !== true ||
    value.gracefulExit !== true ||
    value.residualProcessCount !== 0
  ) {
    return invalid("invalid-evidence");
  }

  if (
    binding.targetId !== value.targetId ||
    binding.sourceCommit !== value.sourceCommit ||
    !packagesMatch(value.packages, bindingPackages(binding)) ||
    binding.executableSha256 !== value.executableSha256 ||
    binding.appAsarSha256 !== value.appAsarSha256
  ) {
    return invalid("artifact-mismatch");
  }

  return Object.freeze({ ok: true });
}

/** Validate the separate bounded failure record. */
export function validateP8FreshProfileFailureEvidence(value, binding) {
  if (!hasExactKeys(value, FAILURE_KEYS) || !isRecord(binding)) {
    return invalid("invalid-failure");
  }
  if (
    value.schemaVersion !== 1 ||
    value.status !== "failed" ||
    !FAILURE_TARGETS.has(value.targetId) ||
    !validCommit(value.sourceCommit) ||
    !FAILURE_CODE_SET.has(value.code) ||
    (value.targetId === "unknown" &&
      value.code !== "invalid-arguments" &&
      value.code !== "unsupported-target") ||
    binding.targetId !== value.targetId ||
    binding.sourceCommit !== value.sourceCommit
  ) {
    return invalid("invalid-failure");
  }
  return Object.freeze({ ok: true });
}

export function makeP8FreshProfileFailureEvidence(targetId, sourceCommit, code) {
  if (
    !FAILURE_TARGETS.has(targetId) ||
    !validCommit(sourceCommit) ||
    !FAILURE_CODE_SET.has(code) ||
    (targetId === "unknown" && code !== "invalid-arguments" && code !== "unsupported-target")
  ) {
    throw new Error("Cannot create an unbounded P8.2d failure record");
  }
  return Object.freeze({
    schemaVersion: 1,
    status: "failed",
    targetId,
    sourceCommit,
    code,
  });
}
