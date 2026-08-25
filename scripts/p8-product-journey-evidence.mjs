import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { P8_PLATFORM_MATRIX } from "./p8-platform-matrix.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const CI_RUN_PATTERN = /^[1-9][0-9]{0,19}$/u;
const MAXIMUM_EVIDENCE_BYTES = 256 * 1024;
const SUCCESS_KEYS = Object.freeze([
  "appAsarSha256",
  "ciRunId",
  "executableSha256",
  "gracefulExit",
  "journeyResultSha256",
  "journeys",
  "packages",
  "packageStructure",
  "residualProcessCount",
  "runner",
  "schemaVersion",
  "sourceCommit",
  "status",
  "targetId",
]);
const BINDING_KEYS = Object.freeze([
  "appAsarSha256",
  "ciRunId",
  "executableSha256",
  "packages",
  "runner",
  "sourceCommit",
  "targetId",
]);
const PACKAGE_KEYS = Object.freeze(["format", "sha256"]);
const RUNNER_KEYS = Object.freeze([
  "containmentEvidenceSha256",
  "executableSha256",
  "manifestSha256",
  "packaged",
]);
const JOURNEY_KEYS = Object.freeze(["id", "residualProcessCount", "status"]);
const FAILURE_KEYS = Object.freeze([
  "ciRunId",
  "code",
  "schemaVersion",
  "sourceCommit",
  "status",
  "targetId",
]);
const FAILURE_BINDING_KEYS = Object.freeze(["ciRunId", "sourceCommit", "targetId"]);

export const P8_PRODUCT_JOURNEY_IDS = Object.freeze(
  P8_PLATFORM_MATRIX.requiredJourneys
    .filter(({ requiredBatch }) => requiredBatch === "P8.2")
    .map(({ id }) => id),
);

export const P8_PRODUCT_JOURNEY_FAILURE_CODES = Object.freeze([
  "invalid-arguments",
  "unsupported-target",
  "package-missing",
  "package-structure-invalid",
  "artifact-mismatch",
  "runner-missing",
  "runner-admission-failed",
  "profile-isolation-invalid",
  "spawn-failed",
  "early-exit",
  "journey-timeout",
  "result-missing",
  "result-malformed",
  "result-oversized",
  "journey-failed",
  "non-graceful-exit",
  "process-probe-failed",
  "residual-processes",
  "cleanup-failed",
  "matrix-incomplete",
  "matrix-mismatch",
]);

const FAILURE_CODE_SET = new Set(P8_PRODUCT_JOURNEY_FAILURE_CODES);
const TARGETS = new Map(
  P8_PLATFORM_MATRIX.targets.map((target) => [
    target.id,
    Object.freeze({
      id: target.id,
      packageFormats: Object.freeze([...target.packageFormats]),
    }),
  ]),
);
const FAILURE_TARGETS = new Set([...TARGETS.keys(), "unknown"]);

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

function validCiRun(value) {
  return typeof value === "string" && CI_RUN_PATTERN.test(value);
}

function validPackages(value, target) {
  return (
    Array.isArray(value) &&
    value.length === target.packageFormats.length &&
    value.every(
      (entry, index) =>
        hasExactKeys(entry, PACKAGE_KEYS) &&
        entry.format === target.packageFormats[index] &&
        validDigest(entry.sha256),
    )
  );
}

function validRunner(value) {
  return (
    hasExactKeys(value, RUNNER_KEYS) &&
    value.packaged === true &&
    validDigest(value.manifestSha256) &&
    validDigest(value.executableSha256) &&
    validDigest(value.containmentEvidenceSha256)
  );
}

function samePackages(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every(
      (entry, index) =>
        hasExactKeys(entry, PACKAGE_KEYS) &&
        hasExactKeys(right[index], PACKAGE_KEYS) &&
        entry.format === right[index].format &&
        entry.sha256 === right[index].sha256,
    )
  );
}

function sameRunner(left, right) {
  return (
    validRunner(left) && validRunner(right) && RUNNER_KEYS.every((key) => left[key] === right[key])
  );
}

function validJourneys(value) {
  return (
    Array.isArray(value) &&
    value.length === P8_PRODUCT_JOURNEY_IDS.length &&
    value.every(
      (entry, index) =>
        hasExactKeys(entry, JOURNEY_KEYS) &&
        entry.id === P8_PRODUCT_JOURNEY_IDS[index] &&
        entry.status === "verified" &&
        entry.residualProcessCount === 0,
    )
  );
}

function validateEvidenceShape(value) {
  if (!hasExactKeys(value, SUCCESS_KEYS)) return invalid("invalid-evidence");
  const target = typeof value.targetId === "string" ? TARGETS.get(value.targetId) : undefined;
  if (
    target === undefined ||
    value.schemaVersion !== 1 ||
    value.status !== "verified" ||
    !validCommit(value.sourceCommit) ||
    !validCiRun(value.ciRunId) ||
    !validPackages(value.packages, target) ||
    !validDigest(value.executableSha256) ||
    !validDigest(value.appAsarSha256) ||
    !validRunner(value.runner) ||
    !validDigest(value.journeyResultSha256) ||
    value.packageStructure !== true ||
    value.gracefulExit !== true ||
    value.residualProcessCount !== 0 ||
    !validJourneys(value.journeys)
  ) {
    return invalid("invalid-evidence");
  }
  return Object.freeze({ ok: true });
}

/**
 * Validate one exact success record against independently computed artifact
 * bindings. Rejected values, paths, output, and credentials are never returned.
 */
export function validateP8ProductJourneyEvidence(value, binding) {
  const shape = validateEvidenceShape(value);
  if (!shape.ok || !hasExactKeys(binding, BINDING_KEYS)) return invalid("invalid-evidence");
  if (
    binding.targetId !== value.targetId ||
    binding.sourceCommit !== value.sourceCommit ||
    binding.ciRunId !== value.ciRunId ||
    !samePackages(binding.packages, value.packages) ||
    binding.executableSha256 !== value.executableSha256 ||
    binding.appAsarSha256 !== value.appAsarSha256 ||
    !sameRunner(binding.runner, value.runner)
  ) {
    return invalid("artifact-mismatch");
  }
  return Object.freeze({ ok: true });
}

export function validateP8ProductJourneyFailureEvidence(value, binding) {
  if (!hasExactKeys(value, FAILURE_KEYS) || !hasExactKeys(binding, FAILURE_BINDING_KEYS)) {
    return invalid("invalid-failure");
  }
  if (
    value.schemaVersion !== 1 ||
    value.status !== "failed" ||
    !FAILURE_TARGETS.has(value.targetId) ||
    !validCommit(value.sourceCommit) ||
    !validCiRun(value.ciRunId) ||
    !FAILURE_CODE_SET.has(value.code) ||
    binding.targetId !== value.targetId ||
    binding.sourceCommit !== value.sourceCommit ||
    binding.ciRunId !== value.ciRunId ||
    (value.targetId === "unknown" &&
      value.code !== "invalid-arguments" &&
      value.code !== "unsupported-target")
  ) {
    return invalid("invalid-failure");
  }
  return Object.freeze({ ok: true });
}

export function makeP8ProductJourneyFailureEvidence(targetId, sourceCommit, ciRunId, code) {
  const value = {
    schemaVersion: 1,
    status: "failed",
    targetId,
    sourceCommit,
    ciRunId,
    code,
  };
  if (!validateP8ProductJourneyFailureEvidence(value, { targetId, sourceCommit, ciRunId }).ok) {
    throw new Error("Cannot create an unbounded P8.2 product-journey failure record");
  }
  return Object.freeze(value);
}

/** Validate the closed three-target, 27-row P8.2 matrix. */
export function validateP8ProductJourneyMatrix(records) {
  if (!Array.isArray(records) || records.length !== TARGETS.size) {
    return invalid("matrix-incomplete");
  }
  const targets = new Set();
  const rows = new Set();
  let sourceCommit;
  let ciRunId;
  for (const record of records) {
    const shape = validateEvidenceShape(record);
    if (!shape.ok) return invalid("matrix-incomplete");
    if (targets.has(record.targetId)) return invalid("matrix-mismatch");
    targets.add(record.targetId);
    sourceCommit ??= record.sourceCommit;
    ciRunId ??= record.ciRunId;
    if (record.sourceCommit !== sourceCommit || record.ciRunId !== ciRunId) {
      return invalid("matrix-mismatch");
    }
    for (const journey of record.journeys) {
      const key = `${record.targetId}:${journey.id}`;
      if (rows.has(key)) return invalid("matrix-mismatch");
      rows.add(key);
    }
  }
  if (
    [...TARGETS.keys()].some((targetId) => !targets.has(targetId)) ||
    rows.size !== TARGETS.size * P8_PRODUCT_JOURNEY_IDS.length
  ) {
    return invalid("matrix-incomplete");
  }
  return Object.freeze({ ok: true });
}

function readBoundedEvidence(filePath) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAXIMUM_EVIDENCE_BYTES) {
    throw new Error("invalid-evidence-file");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const files = process.argv.slice(2);
  if (files.length !== TARGETS.size) {
    console.error("P8.2 product journey matrix failed: matrix-incomplete");
    process.exitCode = 1;
    return;
  }
  try {
    const result = validateP8ProductJourneyMatrix(files.map(readBoundedEvidence));
    if (!result.ok) {
      console.error(`P8.2 product journey matrix failed: ${result.code}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `P8.2 product journey matrix verified: ${TARGETS.size * P8_PRODUCT_JOURNEY_IDS.length} rows`,
    );
  } catch {
    console.error("P8.2 product journey matrix failed: invalid-evidence-file");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
