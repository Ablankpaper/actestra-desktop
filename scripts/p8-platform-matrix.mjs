const rootKeys = [
  "contractVersion",
  "evidenceStates",
  "nonClaims",
  "phase",
  "requiredEvidence",
  "requiredJourneys",
  "securityPassState",
  "targets",
];
const targetKeys = [
  "acceptanceEnvironment",
  "architecture",
  "ciRunner",
  "electronPlatform",
  "id",
  "packageFormats",
];
const obligationKeys = ["id", "requiredBatch"];

const expectedTargets = [
  ["macos-15-arm64", "macos-15", "macOS 15 arm64", "darwin", "arm64", ["dmg", "zip"]],
  ["windows-11-x64", "windows-2025", "Windows 11 24H2 x64", "win32", "x64", ["nsis"]],
  ["ubuntu-24.04-x64", "ubuntu-24.04", "Ubuntu 24.04 LTS x64", "linux", "x64", ["deb"]],
].map(([id, ciRunner, acceptanceEnvironment, electronPlatform, architecture, packageFormats]) => ({
  id,
  ciRunner,
  acceptanceEnvironment,
  electronPlatform,
  architecture,
  packageFormats,
}));

const expectedJourneys = [
  ["fresh-profile-launch", "P8.2"],
  ["general-artifact", "P8.2"],
  ["goose-isolated-patch", "P8.2"],
  ["workspace-apply-approval", "P8.2"],
  ["general-goose-team", "P8.2"],
  ["cancellation-no-orphan", "P8.2"],
  ["crash-restart-recovery", "P8.2"],
  ["privacy-redaction", "P8.2"],
  ["p7-platform-obligations", "P8.2"],
  ["clean-install", "P8.4"],
  ["upgrade-state-continuity", "P8.4"],
  ["rollback-after-update-failure", "P8.4"],
  ["uninstall-data-choice", "P8.4"],
  ["real-provider-acceptance", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

const expectedEvidence = [
  ["native-package-runtime", "P8.2"],
  ["platform-security-boundaries", "P8.2"],
  ["candidate-digest-sbom-provenance", "P8.3"],
  ["signing-notarization", "P8.3"],
  ["update-metadata-rollback", "P8.3"],
  ["clean-machine-lifecycle", "P8.4"],
  ["internal-beta-runbook-issue-intake", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

const evidenceStates = [
  "verified",
  "failed",
  "unsupported-platform",
  "evidence-incomplete",
  "test-harness-invalid",
];
const nonClaims = [
  "cross-platform-runtime-implemented",
  "formal-signing",
  "notarization",
  "candidate",
  "release",
  "deployment",
  "distribution",
  "user-acceptance",
];

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value, keys) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function same(value, expected) {
  try {
    return JSON.stringify(value) === JSON.stringify(expected);
  } catch {
    return false;
  }
}

function recordId(value) {
  return isRecord(value) && typeof value.id === "string" ? value.id : "invalid";
}

export const P8_PLATFORM_MATRIX = freeze({
  contractVersion: 1,
  phase: "P8",
  targets: expectedTargets,
  requiredJourneys: expectedJourneys,
  requiredEvidence: expectedEvidence,
  evidenceStates,
  securityPassState: "denied-safe",
  nonClaims,
});

export function validateP8PlatformMatrix(value) {
  const reasons = [];
  const targets = Array.isArray(value?.targets) ? value.targets : [];
  const journeys = Array.isArray(value?.requiredJourneys) ? value.requiredJourneys : [];
  const evidence = Array.isArray(value?.requiredEvidence) ? value.requiredEvidence : [];

  if (!sameKeys(value, rootKeys)) reasons.push("root-keys");
  if (value?.contractVersion !== 1) reasons.push("contract-version");
  if (value?.phase !== "P8") reasons.push("phase");
  if (targets.length !== expectedTargets.length) reasons.push("target-count");
  if (
    !same(
      targets.map(recordId),
      expectedTargets.map(({ id }) => id),
    )
  )
    reasons.push("target-ids");
  for (const target of targets) {
    const id = recordId(target);
    if (!sameKeys(target, targetKeys)) reasons.push(`target-keys:${id}`);
    const expected = expectedTargets.find((entry) => entry.id === id);
    if (!expected || !same(target, expected)) reasons.push(`target-values:${id}`);
    if (isRecord(target) && target.ciRunner === target.acceptanceEnvironment) {
      reasons.push(`target-builder-acceptance-conflated:${id}`);
    }
  }
  if (journeys.length !== expectedJourneys.length) reasons.push("journey-count");
  if (!same(journeys, expectedJourneys)) reasons.push("journeys");
  for (const journey of journeys) {
    if (!sameKeys(journey, obligationKeys)) reasons.push(`journey-keys:${recordId(journey)}`);
  }
  if (evidence.length !== expectedEvidence.length) reasons.push("evidence-count");
  if (!same(evidence, expectedEvidence)) reasons.push("evidence");
  for (const item of evidence) {
    if (!sameKeys(item, obligationKeys)) reasons.push(`evidence-keys:${recordId(item)}`);
  }
  if (!same(value?.evidenceStates, evidenceStates)) reasons.push("evidence-states");
  if (value?.securityPassState !== "denied-safe") reasons.push("security-pass-state");
  if (!same(value?.nonClaims, nonClaims)) reasons.push("non-claims");

  return Object.freeze([...new Set(reasons)]);
}
