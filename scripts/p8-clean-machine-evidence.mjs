import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { P8_PLATFORM_MATRIX } from "./p8-platform-matrix.mjs";

const DIGEST = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const CI_RUN = /^[1-9][0-9]{0,19}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;
const MAX_BYTES = 128 * 1024;

const TARGETS = new Map(
  P8_PLATFORM_MATRIX.targets.map((target) => [
    target.id,
    Object.freeze({
      id: target.id,
      acceptanceEnvironment: target.acceptanceEnvironment,
      architecture: target.architecture,
    }),
  ]),
);

export const P8_CLEAN_MACHINE_JOURNEY_IDS = Object.freeze(
  P8_PLATFORM_MATRIX.requiredJourneys
    .filter(({ requiredBatch }) => requiredBatch === "P8.4")
    .map(({ id }) => id),
);

const JOURNEY_CHECKS = Object.freeze({
  "clean-install": Object.freeze([
    "candidateDigestVerified",
    "noPriorActestraProfile",
    "installerAccepted",
    "installedVersionMatches",
    "freshProfileCreated",
    "applicationLaunched",
    "cleanupVerified",
  ]),
  "upgrade-state-continuity": Object.freeze([
    "predecessorInstalled",
    "stateSchemaCompatible",
    "artifactVisibleBeforeUpgrade",
    "candidateInstalled",
    "artifactVisibleAfterUpgrade",
    "restartRecoveredState",
    "cleanupVerified",
  ]),
  "rollback-after-update-failure": Object.freeze([
    "updateFailureInjected",
    "partialUpdateRejected",
    "previousVersionRestored",
    "stateRetained",
    "operatorConfirmationRequired",
    "cleanupVerified",
  ]),
  "uninstall-data-choice": Object.freeze([
    "applicationRemoved",
    "dataChoicePresented",
    "retainedDataProved",
    "removedDataProved",
    "noResidualProcess",
    "cleanupVerified",
  ]),
  "real-provider-acceptance": Object.freeze([
    "realProviderMode",
    "credentialRedactionVerified",
    "messageRoundTripVerified",
    "artifactResultVerified",
    "restartRecoveredState",
    "cleanupVerified",
  ]),
});

const ROOT_KEYS = Object.freeze([
  "candidateManifestSha256",
  "candidateVersion",
  "ciRunId",
  "environment",
  "issueIntake",
  "journeys",
  "runbook",
  "schemaVersion",
  "sourceCommit",
  "status",
  "targetId",
]);
const ENVIRONMENT_KEYS = Object.freeze([
  "acceptanceEnvironment",
  "architecture",
  "cleanMachine",
  "os",
  "osVersion",
]);
const JOURNEY_KEYS = Object.freeze(["checks", "evidenceSha256", "id", "providerMode", "status"]);
const RUNBOOK_KEYS = Object.freeze(["channel", "redacted", "revision", "status"]);
const ISSUE_INTAKE_KEYS = Object.freeze(["channel", "endpoint", "redacted", "revision", "status"]);
const FORBIDDEN_KEY =
  /(?:^|[._-])(?:credential|secret|token|password|api[_-]?key|private[_-]?key|prompt|completion|patch|path|home|workspace|profile|user[_-]?data)(?:$|[._-])/iu;
const FORBIDDEN_VALUE =
  /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|sk-[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]|api[_-]?key\s*[:=]|password\s*[:=])/iu;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function validDigest(value) {
  return typeof value === "string" && DIGEST.test(value);
}

function validCommit(value) {
  return typeof value === "string" && COMMIT.test(value);
}

function validCiRun(value) {
  return typeof value === "string" && CI_RUN.test(value);
}

function invalid(code) {
  return Object.freeze({ ok: false, code });
}

function scanForSecrets(value) {
  if (typeof value === "string") return FORBIDDEN_VALUE.test(value);
  if (Array.isArray(value)) return value.some(scanForSecrets);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_KEY.test(key) || scanForSecrets(child),
  );
}

function validChecks(checks, journeyId) {
  const expected = JOURNEY_CHECKS[journeyId];
  return (
    expected !== undefined &&
    exactKeys(checks, expected) &&
    expected.every((key) => checks[key] === true)
  );
}

function validateJourney(journey) {
  if (!exactKeys(journey, JOURNEY_KEYS) || !JOURNEY_CHECKS[journey.id]) {
    return invalid("journey-incomplete");
  }
  if (
    journey.status !== "verified" ||
    !validDigest(journey.evidenceSha256) ||
    !validChecks(journey.checks, journey.id) ||
    (journey.id === "real-provider-acceptance"
      ? journey.providerMode !== "real"
      : journey.providerMode !== "none")
  ) {
    return invalid("journey-incomplete");
  }
  return Object.freeze({ ok: true });
}

function validateEnvironment(environment, target) {
  return (
    exactKeys(environment, ENVIRONMENT_KEYS) &&
    environment.acceptanceEnvironment === target.acceptanceEnvironment &&
    environment.architecture === target.architecture &&
    environment.cleanMachine === true &&
    typeof environment.os === "string" &&
    environment.os.length > 0 &&
    typeof environment.osVersion === "string" &&
    environment.osVersion.length > 0
  );
}

function validateRunbook(runbook) {
  return (
    exactKeys(runbook, RUNBOOK_KEYS) &&
    runbook.status === "verified" &&
    runbook.channel === "internal-beta" &&
    typeof runbook.revision === "string" &&
    /^[0-9a-f]{7,40}$/u.test(runbook.revision) &&
    runbook.redacted === true
  );
}

function validateIssueIntake(issueIntake) {
  return (
    exactKeys(issueIntake, ISSUE_INTAKE_KEYS) &&
    issueIntake.status === "verified" &&
    issueIntake.channel === "github-issues" &&
    typeof issueIntake.endpoint === "string" &&
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues$/u.test(issueIntake.endpoint) &&
    typeof issueIntake.revision === "string" &&
    /^[0-9a-f]{7,40}$/u.test(issueIntake.revision) &&
    issueIntake.redacted === true
  );
}

function validateEvidenceShape(value) {
  if (!exactKeys(value, ROOT_KEYS)) return invalid("evidence-malformed");
  const target = TARGETS.get(value.targetId);
  if (
    target === undefined ||
    value.schemaVersion !== 1 ||
    value.status !== "verified" ||
    !validCommit(value.sourceCommit) ||
    !validCiRun(value.ciRunId) ||
    !VERSION.test(value.candidateVersion) ||
    !validDigest(value.candidateManifestSha256) ||
    !validateEnvironment(value.environment, target) ||
    !validateRunbook(value.runbook) ||
    !validateIssueIntake(value.issueIntake) ||
    !Array.isArray(value.journeys) ||
    value.journeys.length !== P8_CLEAN_MACHINE_JOURNEY_IDS.length
  ) {
    return invalid("evidence-incomplete");
  }
  const seen = new Set();
  for (const [index, journey] of value.journeys.entries()) {
    if (seen.has(journey?.id) || journey?.id !== P8_CLEAN_MACHINE_JOURNEY_IDS[index]) {
      return invalid("evidence-incomplete");
    }
    seen.add(journey.id);
    const result = validateJourney(journey);
    if (!result.ok) return result;
  }
  if (scanForSecrets(value)) return invalid("privacy-leak");
  return Object.freeze({ ok: true });
}

const BINDING_KEYS = Object.freeze([
  "acceptanceEnvironment",
  "architecture",
  "candidateManifestSha256",
  "candidateVersion",
  "ciRunId",
  "sourceCommit",
  "targetId",
]);

/** Validate clean-machine evidence against the exact candidate and target. */
export function validateP8CleanMachineEvidence(value, binding) {
  const shape = validateEvidenceShape(value);
  if (!shape.ok || !exactKeys(binding, BINDING_KEYS))
    return shape.ok ? invalid("binding-invalid") : shape;
  const target = TARGETS.get(value.targetId);
  if (
    binding.targetId !== value.targetId ||
    binding.sourceCommit !== value.sourceCommit ||
    binding.ciRunId !== value.ciRunId ||
    binding.candidateVersion !== value.candidateVersion ||
    binding.candidateManifestSha256 !== value.candidateManifestSha256 ||
    binding.acceptanceEnvironment !== target.acceptanceEnvironment ||
    binding.architecture !== target.architecture
  ) {
    return invalid("binding-mismatch");
  }
  return Object.freeze({ ok: true });
}

/** Validate all three clean-machine records and their shared candidate key. */
export function validateP8CleanMachineMatrix(records) {
  if (!Array.isArray(records) || records.length !== TARGETS.size)
    return invalid("matrix-incomplete");
  const seen = new Set();
  let binding;
  for (const record of records) {
    if (seen.has(record?.targetId)) return invalid("matrix-mismatch");
    const target = TARGETS.get(record?.targetId);
    if (target === undefined) return invalid("matrix-incomplete");
    seen.add(record.targetId);
    const result = validateP8CleanMachineEvidence(record, {
      targetId: record.targetId,
      sourceCommit: record.sourceCommit,
      ciRunId: record.ciRunId,
      candidateVersion: record.candidateVersion,
      candidateManifestSha256: record.candidateManifestSha256,
      acceptanceEnvironment: target.acceptanceEnvironment,
      architecture: target.architecture,
    });
    if (!result.ok) return invalid("matrix-incomplete");
    binding ??= {
      targetId: record.targetId,
      sourceCommit: record.sourceCommit,
      ciRunId: record.ciRunId,
      candidateVersion: record.candidateVersion,
      candidateManifestSha256: record.candidateManifestSha256,
      acceptanceEnvironment: target.acceptanceEnvironment,
      architecture: target.architecture,
    };
    if (
      record.sourceCommit !== binding.sourceCommit ||
      record.ciRunId !== binding.ciRunId ||
      record.candidateVersion !== binding.candidateVersion ||
      record.candidateManifestSha256 !== binding.candidateManifestSha256
    ) {
      return invalid("matrix-mismatch");
    }
  }
  if ([...TARGETS.keys()].some((targetId) => !seen.has(targetId)))
    return invalid("matrix-incomplete");
  return Object.freeze({ ok: true });
}

/** Create a redacted record only after all five clean-machine journeys pass. */
export function buildP8CleanMachineEvidence(input) {
  if (!isRecord(input)) throw new Error("evidence-malformed");
  const target = TARGETS.get(input.targetId);
  const value = {
    schemaVersion: 1,
    status: "verified",
    targetId: input.targetId,
    sourceCommit: input.sourceCommit,
    ciRunId: input.ciRunId,
    candidateVersion: input.candidateVersion,
    candidateManifestSha256: input.candidateManifestSha256,
    environment: input.environment,
    journeys: input.journeys,
    runbook: input.runbook,
    issueIntake: input.issueIntake,
  };
  const result = validateP8CleanMachineEvidence(value, {
    targetId: input.targetId,
    sourceCommit: input.sourceCommit,
    ciRunId: input.ciRunId,
    candidateVersion: input.candidateVersion,
    candidateManifestSha256: input.candidateManifestSha256,
    acceptanceEnvironment: target?.acceptanceEnvironment,
    architecture: target?.architecture,
  });
  if (!result.ok) throw new Error(result.code);
  return Object.freeze(value);
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readBounded(filePath) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_BYTES) {
    throw new Error("evidence-file-invalid");
  }
  const contents = fs.readFileSync(resolved, "utf8");
  if (!contents.endsWith("\n")) throw new Error("evidence-file-invalid");
  return JSON.parse(contents);
}

function main() {
  const files = process.argv.slice(2);
  if (files.length !== TARGETS.size) {
    console.error("P8.4 clean-machine matrix failed: matrix-incomplete");
    process.exitCode = 1;
    return;
  }
  try {
    const result = validateP8CleanMachineMatrix(files.map(readBounded));
    if (!result.ok) {
      console.error(`P8.4 clean-machine matrix failed: ${result.code}`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `P8.4 clean-machine matrix verified: ${P8_CLEAN_MACHINE_JOURNEY_IDS.length} journeys x ${TARGETS.size} targets`,
    );
  } catch (error) {
    console.error(
      `P8.4 clean-machine matrix failed: ${error instanceof Error ? error.message : "evidence-file-invalid"}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
