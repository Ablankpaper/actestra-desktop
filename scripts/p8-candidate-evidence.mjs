import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { P8_PLATFORM_MATRIX } from "./p8-platform-matrix.mjs";
import { validateP8ProductJourneyEvidence } from "./p8-product-journey-evidence.mjs";

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const CI_RUN = /^[1-9][0-9]{0,19}$/u;
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;

const ROOT_KEYS = Object.freeze([
  "ciRunId",
  "rollback",
  "schemaVersion",
  "sourceCommit",
  "status",
  "targets",
  "update",
  "version",
]);
const TARGET_KEYS = Object.freeze([
  "architecture",
  "journeyEvidenceSha256",
  "notices",
  "packages",
  "platform",
  "provenance",
  "runner",
  "runtime",
  "sbom",
  "signing",
  "targetId",
]);
const PACKAGE_KEYS = Object.freeze(["format", "sha256"]);
const RUNTIME_KEYS = Object.freeze(["appAsarSha256", "executableSha256"]);
const RUNNER_KEYS = Object.freeze([
  "containmentEvidenceSha256",
  "executableSha256",
  "manifestSha256",
]);
const SBOM_KEYS = Object.freeze(["format", "sha256", "specVersion"]);
const NOTICE_KEYS = Object.freeze(["files", "sha256"]);
const SIGNING_KEYS = Object.freeze(["identity", "notarization", "status", "verificationSha256"]);
const PROVENANCE_KEYS = Object.freeze(["builder", "ciRunId", "sourceCommit"]);
const UPDATE_KEYS = Object.freeze(["channel", "endpoint", "metadataSha256", "signingAuthority"]);
const ROLLBACK_KEYS = Object.freeze([
  "failureAction",
  "previousVersion",
  "proofSha256",
  "stateSchema",
  "strategy",
]);

const TARGETS = new Map(
  P8_PLATFORM_MATRIX.targets.map((target) => [
    target.id,
    Object.freeze({
      id: target.id,
      platform: target.electronPlatform,
      architecture: target.architecture,
      ciRunner: target.ciRunner,
      packageFormats: Object.freeze([...target.packageFormats]),
    }),
  ]),
);
const TARGET_IDS = Object.freeze([...TARGETS.keys()]);
const REQUIRED_NOTICE_FILES = Object.freeze(["THIRD_PARTY_NOTICES.md", "GOOSE-APACHE-2.0.txt"]);
const ALLOWED_UPDATE_CHANNEL = "internal-beta";
const ALLOWED_ROLLBACK_STRATEGY = "restore-previous-candidate-on-update-failure";
const ALLOWED_ROLLBACK_ACTION = "retain-state-and-require-operator-confirmation";

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
  return typeof value === "string" && SHA256.test(value);
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

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function targetShape(target, sourceCommit, ciRunId) {
  const expected = TARGETS.get(target?.targetId);
  if (!expected || !exactKeys(target, TARGET_KEYS)) return invalid("target-matrix-incomplete");
  if (
    target.platform !== expected.platform ||
    target.architecture !== expected.architecture ||
    !validDigest(target.journeyEvidenceSha256) ||
    !Array.isArray(target.packages) ||
    target.packages.length !== expected.packageFormats.length ||
    target.packages.some(
      (entry, index) =>
        !exactKeys(entry, PACKAGE_KEYS) ||
        entry.format !== expected.packageFormats[index] ||
        !validDigest(entry.sha256),
    )
  ) {
    return invalid("artifact-mismatch");
  }
  if (
    !exactKeys(target.runtime, RUNTIME_KEYS) ||
    !validDigest(target.runtime.executableSha256) ||
    !validDigest(target.runtime.appAsarSha256) ||
    !exactKeys(target.runner, RUNNER_KEYS) ||
    Object.values(target.runner).some((value) => !validDigest(value))
  ) {
    return invalid("artifact-mismatch");
  }
  if (
    !exactKeys(target.sbom, SBOM_KEYS) ||
    target.sbom.format !== "CycloneDX" ||
    target.sbom.specVersion !== "1.6" ||
    !validDigest(target.sbom.sha256)
  ) {
    return invalid("sbom-incomplete");
  }
  if (
    !exactKeys(target.provenance, PROVENANCE_KEYS) ||
    target.provenance.sourceCommit !== sourceCommit ||
    target.provenance.ciRunId !== ciRunId ||
    target.provenance.builder !== expected.ciRunner
  ) {
    return invalid("source-mismatch");
  }
  if (
    !exactKeys(target.notices, NOTICE_KEYS) ||
    !validDigest(target.notices.sha256) ||
    JSON.stringify(target.notices.files) !== JSON.stringify(REQUIRED_NOTICE_FILES)
  ) {
    return invalid("notices-incomplete");
  }
  if (
    !exactKeys(target.signing, SIGNING_KEYS) ||
    target.signing.status !== "signed" ||
    typeof target.signing.identity !== "string" ||
    target.signing.identity.length === 0 ||
    !validDigest(target.signing.verificationSha256)
  ) {
    return invalid("signing-incomplete");
  }
  if (
    expected.id === "macos-15-arm64"
      ? target.signing.notarization !== "notarized"
      : target.signing.notarization !== "not-applicable"
  ) {
    return invalid("signing-incomplete");
  }
  return Object.freeze({ ok: true });
}

function validateUpdate(update) {
  if (!exactKeys(update, UPDATE_KEYS)) return invalid("update-trust-incomplete");
  if (
    update.channel !== ALLOWED_UPDATE_CHANNEL ||
    typeof update.endpoint !== "string" ||
    !/^https:\/\/[^/\s]+(?:\/[^\s]*)?$/u.test(update.endpoint) ||
    !validDigest(update.metadataSha256) ||
    typeof update.signingAuthority !== "string" ||
    update.signingAuthority.length === 0
  ) {
    return invalid("update-trust-incomplete");
  }
  return Object.freeze({ ok: true });
}

function validateRollback(rollback, version) {
  if (!exactKeys(rollback, ROLLBACK_KEYS)) return invalid("rollback-invalid");
  if (
    !VERSION.test(rollback.previousVersion) ||
    rollback.previousVersion === version ||
    rollback.stateSchema !== 23 ||
    rollback.strategy !== ALLOWED_ROLLBACK_STRATEGY ||
    rollback.failureAction !== ALLOWED_ROLLBACK_ACTION ||
    !validDigest(rollback.proofSha256)
  ) {
    return invalid("rollback-invalid");
  }
  return Object.freeze({ ok: true });
}

export function validateP8CandidateManifest(value) {
  if (!exactKeys(value, ROOT_KEYS)) return invalid("candidate-malformed");
  if (
    value.schemaVersion !== 1 ||
    value.status !== "verified" ||
    !validCommit(value.sourceCommit) ||
    !validCiRun(value.ciRunId) ||
    !VERSION.test(value.version)
  ) {
    return invalid("candidate-malformed");
  }
  if (!Array.isArray(value.targets) || value.targets.length !== TARGET_IDS.length) {
    return invalid("target-matrix-incomplete");
  }
  const seen = new Set();
  for (const target of value.targets) {
    if (seen.has(target?.targetId)) return invalid("target-matrix-incomplete");
    seen.add(target?.targetId);
    const result = targetShape(target, value.sourceCommit, value.ciRunId);
    if (!result.ok) return result;
  }
  if (TARGET_IDS.some((targetId) => !seen.has(targetId)))
    return invalid("target-matrix-incomplete");
  const update = validateUpdate(value.update);
  if (!update.ok) return update;
  return validateRollback(value.rollback, value.version);
}

export function validateP8CandidateMatrix(value) {
  if (!isRecord(value) || value.status !== "verified") return invalid("candidate-incomplete");
  const result = validateP8CandidateManifest(value);
  return result.ok ? Object.freeze({ ok: true }) : invalid("candidate-incomplete");
}

export function buildP8CandidateManifest(input) {
  if (!isRecord(input)) throw new Error("candidate-malformed");
  const sourceCommit = input.sourceCommit;
  const ciRunId = input.ciRunId;
  const normalized = {
    schemaVersion: 1,
    status: "verified",
    sourceCommit,
    ciRunId,
    version: input.version,
    targets: input.targets,
    update: input.update,
    rollback: input.rollback,
  };
  const candidate = freeze(normalized);
  if (!validCommit(sourceCommit) || !validCiRun(ciRunId)) {
    throw new Error("candidate-malformed");
  }
  const validation = validateP8CandidateManifest(candidate);
  if (!validation.ok) {
    if (input.targets?.some((target) => target?.signing?.status !== "signed")) {
      return freeze({ ...normalized, status: "evidence-incomplete" });
    }
    throw new Error(validation.code);
  }
  return candidate;
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function requireFile(filePath, code = "candidate-file-invalid") {
  if (
    typeof filePath !== "string" ||
    !path.isAbsolute(filePath) ||
    !fs.lstatSync(filePath, { throwIfNoEntry: false })?.isFile()
  ) {
    throw new Error(code);
  }
  return path.resolve(filePath);
}

function hashFileSet(entries) {
  const digest = crypto.createHash("sha256");
  for (const entry of entries) {
    const filePath = requireFile(entry.path);
    const bytes = fs.readFileSync(filePath);
    digest.update(entry.name);
    digest.update("\0");
    digest.update(String(bytes.byteLength));
    digest.update("\0");
    digest.update(bytes);
  }
  return digest.digest("hex");
}

function readJsonFile(filePath) {
  const contents = fs.readFileSync(requireFile(filePath), "utf8");
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error("candidate-file-invalid");
  }
}

function packageEntries(target, descriptor) {
  const expected = target?.id !== undefined ? target : TARGETS.get(target?.targetId);
  if (!isRecord(descriptor.packages)) throw new Error("artifact-mismatch");
  return expected.packageFormats.map((format) => ({
    format,
    path: requireFile(descriptor.packages[format], "artifact-mismatch"),
  }));
}

function assembleTargetEvidence(target, descriptor, sourceCommit, ciRunId) {
  const expected = target?.id !== undefined ? target : TARGETS.get(target?.targetId);
  if (!expected || !isRecord(descriptor)) throw new Error("target-matrix-incomplete");
  const journeyPath = requireFile(descriptor.journeyEvidencePath, "journey-evidence-incomplete");
  const journeyEvidence = readJsonFile(journeyPath);
  const journeyBinding = {
    targetId: expected.id,
    sourceCommit,
    ciRunId,
    packages: journeyEvidence.packages,
    executableSha256: journeyEvidence.executableSha256,
    appAsarSha256: journeyEvidence.appAsarSha256,
    runner: journeyEvidence.runner,
  };
  const journeyValidation = validateP8ProductJourneyEvidence(journeyEvidence, journeyBinding);
  if (!journeyValidation.ok) throw new Error("journey-evidence-incomplete");
  const packages = packageEntries(expected, descriptor);
  const runtime = {
    executableSha256: sha256File(
      requireFile(descriptor.runtimeExecutablePath, "artifact-mismatch"),
    ),
    appAsarSha256: sha256File(requireFile(descriptor.appAsarPath, "artifact-mismatch")),
  };
  if (
    runtime.executableSha256 !== journeyEvidence.executableSha256 ||
    runtime.appAsarSha256 !== journeyEvidence.appAsarSha256
  ) {
    throw new Error("artifact-mismatch");
  }
  const runnerManifestPath = requireFile(
    descriptor.runnerManifestPath,
    "runner-evidence-incomplete",
  );
  const runnerExecutablePath = requireFile(
    descriptor.runnerExecutablePath,
    "runner-evidence-incomplete",
  );
  const runnerContainmentPath = requireFile(
    descriptor.runnerContainmentEvidencePath,
    "runner-evidence-incomplete",
  );
  const runnerManifest = readJsonFile(runnerManifestPath);
  const runnerContainment = readJsonFile(runnerContainmentPath);
  const runner = {
    manifestSha256: sha256File(runnerManifestPath),
    executableSha256: sha256File(runnerExecutablePath),
    containmentEvidenceSha256: sha256File(runnerContainmentPath),
  };
  if (
    runner.manifestSha256 !== journeyEvidence.runner.manifestSha256 ||
    runner.executableSha256 !== journeyEvidence.runner.executableSha256 ||
    runner.containmentEvidenceSha256 !== journeyEvidence.runner.containmentEvidenceSha256 ||
    runnerManifest?.provenance?.actestraCommit !== sourceCommit ||
    runnerManifest?.runner?.targetTriple === undefined ||
    runnerManifest?.runner?.executable?.sha256 !== runner.executableSha256 ||
    runnerContainment?.status !== "verified" ||
    runnerContainment?.sourceCommit !== sourceCommit ||
    runnerContainment?.executableSha256 !== runner.executableSha256
  ) {
    throw new Error("runner-evidence-incomplete");
  }
  const sbomPath = requireFile(descriptor.sbomPath, "sbom-incomplete");
  const sbom = readJsonFile(sbomPath);
  if (!isRecord(sbom) || (sbom.bomFormat !== "CycloneDX" && sbom.metadata?.tools === undefined)) {
    throw new Error("sbom-incomplete");
  }
  const noticeEntries = Array.isArray(descriptor.noticePaths)
    ? descriptor.noticePaths.map((noticePath) => ({
        name: path.basename(noticePath),
        path: noticePath,
      }))
    : [];
  if (noticeEntries.length !== REQUIRED_NOTICE_FILES.length) throw new Error("notices-incomplete");
  const noticeNames = noticeEntries.map(({ name }) => name);
  if (JSON.stringify(noticeNames) !== JSON.stringify(REQUIRED_NOTICE_FILES)) {
    throw new Error("notices-incomplete");
  }
  const signing = isRecord(descriptor.signing) ? descriptor.signing : {};
  const verificationPath = requireFile(signing.verificationPath, "signing-incomplete");
  const notarization = expected.id === "macos-15-arm64" ? "notarized" : "not-applicable";
  if (
    signing.status !== "signed" ||
    typeof signing.identity !== "string" ||
    signing.identity.length === 0 ||
    signing.notarization !== notarization
  ) {
    throw new Error("signing-incomplete");
  }
  return {
    targetId: expected.id,
    platform: expected.platform,
    architecture: expected.architecture,
    packages: packages.map(({ format, path: packagePath }) => ({
      format,
      sha256: sha256File(packagePath),
    })),
    runtime,
    journeyEvidenceSha256: sha256File(journeyPath),
    runner,
    sbom: { format: "CycloneDX", specVersion: "1.6", sha256: sha256File(sbomPath) },
    provenance: { sourceCommit, ciRunId, builder: expected.ciRunner },
    notices: { sha256: hashFileSet(noticeEntries), files: REQUIRED_NOTICE_FILES },
    signing: {
      status: signing.status,
      identity: signing.identity,
      notarization,
      verificationSha256: sha256File(verificationPath),
    },
  };
}

/** Assemble a candidate from exact files; no output path or credential is retained. */
export function assembleP8Candidate(input) {
  if (!isRecord(input) || !validCommit(input.sourceCommit) || !validCiRun(input.ciRunId)) {
    throw new Error("candidate-malformed");
  }
  let targets;
  try {
    targets = TARGET_IDS.map((targetId) =>
      assembleTargetEvidence(
        TARGETS.get(targetId),
        input.targets?.find((target) => target?.targetId === targetId),
        input.sourceCommit,
        input.ciRunId,
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "signing-incomplete") {
      return freeze({
        schemaVersion: 1,
        status: "evidence-incomplete",
        sourceCommit: input.sourceCommit,
        ciRunId: input.ciRunId,
        version: input.version,
        targets: [],
        update: input.update,
        rollback: input.rollback,
      });
    }
    throw error;
  }
  return buildP8CandidateManifest({
    sourceCommit: input.sourceCommit,
    ciRunId: input.ciRunId,
    version: input.version,
    targets,
    update: input.update,
    rollback: input.rollback,
  });
}

export function readP8CandidateManifest(filePath) {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) {
    throw new Error("candidate-file-invalid");
  }
  const contents = fs.readFileSync(resolved, "utf8");
  if (!contents.endsWith("\n")) throw new Error("candidate-file-invalid");
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error("candidate-file-invalid");
  }
}

function main() {
  const file = process.argv[2];
  if (typeof file !== "string" || file.length === 0) {
    console.error("P8.3 candidate check failed: candidate-file-invalid");
    process.exitCode = 1;
    return;
  }
  try {
    const manifest = readP8CandidateManifest(file);
    const result = validateP8CandidateMatrix(manifest);
    if (!result.ok) {
      console.error(`P8.3 candidate check failed: ${result.code}`);
      process.exitCode = 1;
      return;
    }
    console.log(`P8.3 candidate verified: ${manifest.version} / ${manifest.sourceCommit}`);
  } catch {
    console.error("P8.3 candidate check failed: candidate-file-invalid");
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
