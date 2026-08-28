import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import sourceContract from "../../shared/gooseRunnerSource.json";
import type { GooseContainmentEvidence } from "./gooseRunnerContainment";
import { resolveGooseRunnerBuildTargetByTriple } from "./gooseRunnerTarget";

export const GOOSE_RUNNER_MANIFEST_FILE = "actestra-goose-runner.manifest.json" as const;
export const GOOSE_RUNNER_PACKAGE_DIRECTORY = "actestra-goose-runner" as const;
export const GOOSE_RUNNER_PACKAGE_ATTESTATION_FILE = "actestra-goose-runner-package.json" as const;

const LOCKFILE_NAME = "Cargo.lock";
const LICENSE_FILE_NAME = "GOOSE-APACHE-2.0.txt";
const SBOM_FILE_NAME = "actestra-goose-runner.cdx.json";
const AUDIT_FILE_NAME = "actestra-goose-runner.audit.json";
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_LOCKFILE_BYTES = 16 * 1024 * 1024;
const MAX_LICENSE_BYTES = 128 * 1024;
const MAX_SBOM_BYTES = 64 * 1024 * 1024;
const MAX_AUDIT_BYTES = 16 * 1024 * 1024;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const MAX_PACKAGE_ATTESTATION_BYTES = 64 * 1024;

const PACKAGE_ARTIFACT_METADATA_FILES = Object.freeze([
  "GOOSE-APACHE-2.0.txt",
  "Cargo.lock",
  "actestra-goose-runner.audit.json",
  "actestra-goose-runner.cdx.json",
  GOOSE_RUNNER_MANIFEST_FILE,
] as const);
export type GooseRunnerArtifactErrorCode =
  | "missing-artifact"
  | "invalid-manifest"
  | "incompatible-artifact"
  | "digest-mismatch"
  | "invalid-sbom"
  | "unsafe-audit";

export class GooseRunnerArtifactError extends Error {
  constructor(
    readonly code: GooseRunnerArtifactErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseRunnerArtifactError";
  }
}

export interface AdmitGooseRunnerArtifactOptions {
  readonly trustedManifestSha256: string;
  readonly expectedTargetTriple: string;
}

export interface AdmittedGooseRunnerArtifact {
  readonly directory: string;
  readonly executablePath: string;
  readonly executableSha256: string;
  readonly executableSize: number;
  readonly targetTriple: string;
  /** Exact Actestra source commit recorded by the artifact provenance. */
  readonly sourceCommit?: string;
  readonly gooseCommit: typeof sourceContract.goose.runtimeCommit;
  readonly gooseVersion: typeof sourceContract.goose.version;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  /** Present only after Main has admitted the fixed Ubuntu package layout. */
  readonly linuxInstall?: Readonly<GooseRunnerLinuxInstallAttestation>;
  /** Present only when the artifact carries a validated native probe record. */
  readonly containment?: GooseContainmentEvidence;
}

export interface GooseRunnerPackageAttestation {
  readonly contractVersion: 1;
  readonly targetTriple: string;
  readonly sourceCommit: string;
  readonly runnerManifestSha256: string;
  readonly executableSha256: string;
  readonly executableFile: string;
  readonly runnerDirectory: typeof GOOSE_RUNNER_PACKAGE_DIRECTORY;
  readonly files: readonly string[];
}

export interface AdmittedGooseRunnerPackage {
  readonly resourcesPath: string;
  readonly runnerDirectory: string;
  readonly attestationPath: string;
  readonly sourceCommit: string;
  readonly runnerAdmission: Readonly<{
    readonly directory: string;
    readonly trustedManifestSha256: string;
    readonly expectedTargetTriple: string;
  }>;
  readonly attestation: GooseRunnerPackageAttestation;
  readonly artifact: AdmittedGooseRunnerArtifact;
}

export interface AdmitGooseRunnerPackageOptions {
  readonly expectedTargetTriple: string;
  readonly expectedSourceCommit?: string;
  readonly admitRunnerArtifact?: (
    directory: string,
    options: AdmitGooseRunnerArtifactOptions,
  ) => Promise<AdmittedGooseRunnerArtifact>;
}

export interface GooseRunnerLinuxInstallAttestation {
  readonly contractVersion: 1;
  readonly resourcesPath: "/opt/Actestra/resources";
  readonly executablePath: "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner";
  readonly runnerManifestSha256: string;
  readonly executableSha256: string;
  readonly profileSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GooseRunnerArtifactError("invalid-manifest", `${label} must be an object`);
  }
  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  optional: readonly string[] = [],
): void {
  const expectedSet = new Set([...expected, ...optional]);
  const actual = Object.keys(value);
  if (
    actual.length < expected.length ||
    actual.length > expected.length + optional.length ||
    actual.some((key) => !expectedSet.has(key)) ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      `${label} keys do not match the artifact contract`,
    );
  }
}

const CONTAINMENT_KEYS = [
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
  "targetTriple",
] as const;

function parseContainmentEvidence(
  value: unknown,
  binding: Readonly<{
    readonly targetTriple: string;
    readonly sourceCommit: string;
    readonly executableSha256: string;
  }>,
): GooseContainmentEvidence {
  if (!isRecord(value)) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose containment evidence is not an object",
    );
  }
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== CONTAINMENT_KEYS.length ||
    actualKeys.some((key) => !CONTAINMENT_KEYS.includes(key as (typeof CONTAINMENT_KEYS)[number]))
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose containment evidence keys are unsupported",
    );
  }
  if (
    value.contractVersion !== 1 ||
    typeof value.targetTriple !== "string" ||
    typeof value.sourceCommit !== "string" ||
    typeof value.probeSha256 !== "string" ||
    typeof value.executableSha256 !== "string" ||
    value.targetTriple !== binding.targetTriple ||
    value.sourceCommit !== binding.sourceCommit ||
    value.executableSha256 !== binding.executableSha256 ||
    !SHA256_PATTERN.test(value.probeSha256) ||
    !SHA256_PATTERN.test(value.executableSha256) ||
    !COMMIT_PATTERN.test(value.sourceCommit) ||
    value.filesystem !== true ||
    value.network !== true ||
    value.processTree !== true ||
    value.resources !== true ||
    value.parentDeath !== true ||
    value.cleanup !== true
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose containment evidence is not bound to a complete native proof",
    );
  }
  return Object.freeze({
    contractVersion: 1,
    targetTriple: value.targetTriple as string,
    sourceCommit: value.sourceCommit as string,
    probeSha256: value.probeSha256 as string,
    executableSha256: value.executableSha256 as string,
    filesystem: true,
    network: true,
    processTree: true,
    resources: true,
    parentDeath: true,
    cleanup: true,
  });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GooseRunnerArtifactError("invalid-manifest", `${label} must be a non-empty string`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, label);
  if (!SHA256_PATTERN.test(digest)) {
    throw new GooseRunnerArtifactError("invalid-manifest", `${label} must be a SHA-256 digest`);
  }
  return digest;
}

function requireCommit(value: unknown, label: string): string {
  const commit = requireString(value, label);
  if (!COMMIT_PATTERN.test(commit)) {
    throw new GooseRunnerArtifactError("invalid-manifest", `${label} must be a full Git commit`);
  }
  return commit;
}

function requireExactJson(value: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      `${label} differs from the admitted source contract`,
    );
  }
}

function validateBuildToolEvidence(
  value: unknown,
  expected: Readonly<{ version: string; commit: string }>,
  buildToolHost: string,
  toolName: "cargo-auditable" | "cargo-audit",
  label: string,
): void {
  const evidence = requireRecord(value, label);
  requireExactKeys(evidence, ["version", "commit", "archiveSha256", "executableSha256"], label);
  const assetContracts = sourceContract.buildToolAssets as Readonly<
    Record<string, readonly { name: string; sha256: string }[]>
  >;
  const asset = assetContracts[buildToolHost]?.find((item) => item.name === toolName);
  if (
    evidence.version !== expected.version ||
    evidence.commit !== expected.commit ||
    evidence.archiveSha256 !== asset?.sha256
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      `${label} differs from the admitted target source contract`,
    );
  }
  requireSha256(evidence.executableSha256, `${label} executable SHA-256`);
}

async function readRegularFile(
  filePath: string,
  maximumBytes: number,
  label: string,
): Promise<Buffer> {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch (error) {
    throw new GooseRunnerArtifactError("missing-artifact", `${label} is missing`, { cause: error });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximumBytes) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      `${label} must be a bounded regular file and cannot be a symbolic link`,
    );
  }
  return readFile(filePath);
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return digest.digest("hex");
}

function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(buffer: Buffer, label: string): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new GooseRunnerArtifactError("invalid-manifest", `${label} is not valid JSON`, {
      cause: error,
    });
  }
}

function resolveMaterial(
  directory: string,
  file: unknown,
  expected: string,
  label: string,
): string {
  if (file !== expected || path.basename(expected) !== expected) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      `${label} must use the fixed ${expected} artifact name`,
    );
  }
  return path.join(directory, expected);
}

function validateSbom(value: unknown): number {
  const sbom = requireRecord(value, "Goose runner SBOM");
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || sbom.version !== 1) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM must be CycloneDX 1.6 version 1",
    );
  }
  const metadata = requireRecord(sbom.metadata, "Goose runner SBOM metadata");
  const component = requireRecord(metadata.component, "Goose runner SBOM root component");
  const rootReference = requireString(
    component["bom-ref"],
    "Goose runner SBOM root component bom-ref",
  );
  if (
    component.type !== "application" ||
    component.name !== sourceContract.runner.name ||
    component.version !== sourceContract.runner.version
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM root component is incompatible",
    );
  }
  if (!Array.isArray(sbom.components) || !Array.isArray(sbom.dependencies)) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM must include components and dependency relationships",
    );
  }
  const componentRecords = sbom.components.map((candidate, index) =>
    requireRecord(candidate, `Goose runner SBOM component ${index}`),
  );
  const componentReferences = componentRecords.map((candidate, index) =>
    requireString(candidate["bom-ref"], `Goose runner SBOM component ${index} bom-ref`),
  );
  const allReferences = new Set([rootReference, ...componentReferences]);
  if (
    componentRecords.length < 1 ||
    allReferences.size !== componentRecords.length + 1 ||
    sbom.dependencies.length !== allReferences.size
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM component and dependency references are incomplete or duplicated",
    );
  }
  const dependencyReferences = new Set<string>();
  for (const [index, candidate] of sbom.dependencies.entries()) {
    const dependency = requireRecord(candidate, `Goose runner SBOM dependency ${index}`);
    requireExactKeys(dependency, ["ref", "dependsOn"], `Goose runner SBOM dependency ${index}`);
    const reference = requireString(dependency.ref, `Goose runner SBOM dependency ${index} ref`);
    if (
      dependencyReferences.has(reference) ||
      !allReferences.has(reference) ||
      !Array.isArray(dependency.dependsOn) ||
      dependency.dependsOn.some(
        (dependencyReference) =>
          typeof dependencyReference !== "string" || !allReferences.has(dependencyReference),
      )
    ) {
      throw new GooseRunnerArtifactError(
        "invalid-sbom",
        "Goose runner SBOM dependency graph contains an unknown or duplicate reference",
      );
    }
    dependencyReferences.add(reference);
  }
  if (dependencyReferences.size !== allReferences.size) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM dependency graph omits a component reference",
    );
  }
  const goose = componentRecords.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate.name === "goose" &&
      candidate.version === sourceContract.goose.version,
  );
  if (
    !isRecord(goose) ||
    typeof goose.purl !== "string" ||
    !goose.purl.includes(sourceContract.goose.runtimeCommit)
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM does not bind the exact Goose source commit",
    );
  }
  return componentRecords.length;
}

function requirePositiveCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new GooseRunnerArtifactError("unsafe-audit", `${label} must be a positive count`);
  }
  return value as number;
}

function validateRsaDisposition(value: unknown, expectedSource: string, label: string): void {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      `${label} vulnerability disposition is incomplete`,
    );
  }
  const disposition = requireRecord(value[0], `${label} RSA disposition`);
  requireExactKeys(
    disposition,
    ["id", "package", "disposition", "proof", "source"],
    `${label} RSA disposition`,
  );
  const packageValue = requireRecord(disposition.package, `${label} RSA package`);
  requireExactKeys(packageValue, ["name", "version"], `${label} RSA package`);
  if (
    disposition.id !== "RUSTSEC-2023-0071" ||
    packageValue.name !== "rsa" ||
    packageValue.version !== "0.9.10" ||
    disposition.disposition !== "metadata-only-not-compiled" ||
    disposition.proof !== "cargo-tree-all-targets-no-path" ||
    disposition.source !== expectedSource
  ) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      `${label} is not the reviewed metadata-only RSA disposition`,
    );
  }
}

function validateAudit(value: unknown, targetTriple: string, buildToolHost: string): number {
  const audit = requireRecord(value, "Goose runner audit report");
  requireExactKeys(
    audit,
    ["contractVersion", "cargoAudit", "advisoryDatabase", "reachability", "binary", "lock"],
    "Goose runner audit report",
  );
  if (audit.contractVersion !== 1) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "Goose runner audit contract is unsupported",
    );
  }
  validateBuildToolEvidence(
    audit.cargoAudit,
    sourceContract.buildTools.cargoAudit,
    buildToolHost,
    "cargo-audit",
    "Goose runner cargo-audit pin",
  );
  const database = requireRecord(audit.advisoryDatabase, "Goose advisory database evidence");
  requireExactKeys(
    database,
    ["commit", "fetchedAt", "checkedAt"],
    "Goose advisory database evidence",
  );
  requireCommit(database.commit, "Goose advisory database commit");
  const fetchedAt = requireString(database.fetchedAt, "Goose advisory database fetchedAt");
  const checkedAt = requireString(database.checkedAt, "Goose advisory database checkedAt");
  const fetchedTime = new Date(fetchedAt).getTime();
  const checkedTime = new Date(checkedAt).getTime();
  if (
    !Number.isFinite(fetchedTime) ||
    !Number.isFinite(checkedTime) ||
    new Date(fetchedTime).toISOString() !== fetchedAt ||
    new Date(checkedTime).toISOString() !== checkedAt ||
    fetchedTime > checkedTime + 5 * 60 * 1000 ||
    checkedTime - fetchedTime > 7 * 24 * 60 * 60 * 1000
  ) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "Goose advisory database fetch and scan timestamps are invalid or stale",
    );
  }

  const reachability = requireRecord(audit.reachability, "Goose reachability evidence");
  requireExactKeys(
    reachability,
    [
      "targetTriple",
      "activeDependencyCount",
      "cargoTreeDependencyCount",
      "compilerArtifactPackageCount",
      "cargoTreeAllTargets",
      "compilerArtifactsAbsent",
    ],
    "Goose reachability evidence",
  );
  const activeDependencyCount = requirePositiveCount(
    reachability.activeDependencyCount,
    "Goose active dependency count",
  );
  const cargoTreeDependencyCount = requirePositiveCount(
    reachability.cargoTreeDependencyCount,
    "Goose cargo-tree dependency count",
  );
  const compilerArtifactPackageCount = requirePositiveCount(
    reachability.compilerArtifactPackageCount,
    "Goose compiler-artifact package count",
  );
  const tree = requireRecord(
    reachability.cargoTreeAllTargets,
    "Goose all-target cargo-tree evidence",
  );
  requireExactKeys(tree, ["rsa", "sqlxMysql"], "Goose all-target cargo-tree evidence");
  if (
    reachability.targetTriple !== targetTriple ||
    cargoTreeDependencyCount !== activeDependencyCount ||
    compilerArtifactPackageCount < activeDependencyCount ||
    tree.rsa !== "no-path" ||
    tree.sqlxMysql !== "no-path" ||
    JSON.stringify(reachability.compilerArtifactsAbsent) !== JSON.stringify(["rsa", "sqlx-mysql"])
  ) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "Goose RSA reachability evidence is incomplete",
    );
  }

  const binary = requireRecord(audit.binary, "Goose binary audit");
  requireExactKeys(
    binary,
    ["auditableDependencyCount", "vulnerabilities", "unsound"],
    "Goose binary audit",
  );
  const auditableDependencyCount = requirePositiveCount(
    binary.auditableDependencyCount,
    "Goose auditable dependency count",
  );
  if (auditableDependencyCount < activeDependencyCount) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "Goose auditable metadata omitted an active dependency",
    );
  }
  validateRsaDisposition(binary.vulnerabilities, "cargo-audit-bin", "Goose binary audit");
  if (!Array.isArray(binary.unsound) || binary.unsound.length !== 0) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "The compiled Goose runner contains an unsound dependency",
    );
  }

  const lock = requireRecord(audit.lock, "Goose lock audit");
  requireExactKeys(
    lock,
    ["dependencyCount", "vulnerabilities", "unsound", "unmaintained", "yanked"],
    "Goose lock audit",
  );
  const lockDependencyCount = requirePositiveCount(
    lock.dependencyCount,
    "Goose lock dependency count",
  );
  if (lockDependencyCount < auditableDependencyCount) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "Goose lock dependency count is smaller than its auditable metadata",
    );
  }
  if (!Array.isArray(lock.unsound) || lock.unsound.length !== 0) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "The Goose runner lock contains an unresolved unsound dependency",
    );
  }
  if (!Array.isArray(lock.unmaintained)) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "The Goose runner lock must record unmaintained warnings separately",
    );
  }
  validateRsaDisposition(lock.vulnerabilities, "cargo-audit-lock", "Goose lock audit");
  const yanked = requireRecord(lock.yanked, "Goose yanked-package audit");
  requireExactKeys(yanked, ["complete", "packages"], "Goose yanked-package audit");
  if (yanked.complete !== true || !Array.isArray(yanked.packages) || yanked.packages.length !== 0) {
    throw new GooseRunnerArtifactError(
      "unsafe-audit",
      "The Goose runner yanked-package audit is incomplete or non-empty",
    );
  }
  return activeDependencyCount;
}

function validateLockfile(lockfile: string): void {
  const exactSource = `git+${sourceContract.goose.runtimeRepository}?rev=${sourceContract.goose.runtimeCommit}#${sourceContract.goose.runtimeCommit}`;
  const goosePackageSources = [
    ...lockfile.matchAll(
      /name = "(?:goose|goose-acp-macros|goose-download-manager|goose-provider-types|goose-providers|goose-sdk-types)"\nversion = "[^"]+"\nsource = "([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  const chacha20Versions = [...lockfile.matchAll(/name = "chacha20"\nversion = "([^"]+)"/g)].map(
    (match) => match[1],
  );
  if (
    goosePackageSources.length < 1 ||
    goosePackageSources.some((source) => source !== exactSource) ||
    !/name = "event-listener"\nversion = "5\.4\.2"/.test(lockfile) ||
    /name = "event-listener"\nversion = "5\.4\.1"/.test(lockfile) ||
    !/name = "lru"\nversion = "0\.18\.2"/.test(lockfile) ||
    /name = "lru"\nversion = "0\.18\.1"/.test(lockfile) ||
    /name = "quick-xml"\nversion = "(?:0\.36\.2|0\.37\.5)"/.test(lockfile) ||
    chacha20Versions.length !== 1 ||
    chacha20Versions[0] !== "0.10.2"
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner lock does not satisfy the exact source and dependency floors",
    );
  }
}

export async function admitGooseRunnerArtifact(
  artifactDirectory: string,
  options: AdmitGooseRunnerArtifactOptions,
): Promise<AdmittedGooseRunnerArtifact> {
  const requestedDirectory = path.resolve(artifactDirectory);
  let directoryStat;
  try {
    directoryStat = await lstat(requestedDirectory);
  } catch (error) {
    throw new GooseRunnerArtifactError("missing-artifact", "Goose artifact directory is missing", {
      cause: error,
    });
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose artifact directory must be a real directory and cannot be a symbolic link",
    );
  }
  const directory = await realpath(requestedDirectory).catch((error: unknown) => {
    throw new GooseRunnerArtifactError("missing-artifact", "Goose artifact directory is missing", {
      cause: error,
    });
  });

  const manifestPath = path.join(directory, GOOSE_RUNNER_MANIFEST_FILE);
  const manifestBuffer = await readRegularFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    "Goose runner manifest",
  );
  const trustedManifestSha256 = requireSha256(
    options.trustedManifestSha256,
    "Trusted Goose runner manifest SHA-256",
  );
  if (sha256Buffer(manifestBuffer) !== trustedManifestSha256) {
    throw new GooseRunnerArtifactError(
      "digest-mismatch",
      "Goose runner manifest is outside the caller trust root",
    );
  }
  const manifest = requireRecord(
    parseJson(manifestBuffer, "Goose runner manifest"),
    "Goose runner manifest",
  );
  requireExactKeys(
    manifest,
    ["contractVersion", "runner", "goose", "acp", "build", "materials", "provenance"],
    "Goose runner manifest",
    ["containment"],
  );
  if (manifest.contractVersion !== 1) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner manifest contract is unsupported",
    );
  }

  const runner = requireRecord(manifest.runner, "Goose runner identity");
  requireExactKeys(
    runner,
    ["name", "version", "targetTriple", "executable"],
    "Goose runner identity",
  );
  if (
    runner.name !== sourceContract.runner.name ||
    runner.version !== sourceContract.runner.version
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner identity is unsupported",
    );
  }
  const targetTriple = requireString(runner.targetTriple, "Goose runner target triple");
  if (targetTriple !== options.expectedTargetTriple) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      `Goose runner target ${targetTriple} does not match ${options.expectedTargetTriple}`,
    );
  }
  const buildTarget = resolveGooseRunnerBuildTargetByTriple(targetTriple);
  if (buildTarget === undefined) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner target is outside the admitted native build matrix",
    );
  }

  requireExactJson(manifest.goose, sourceContract.goose, "Goose source and feature pin");
  requireExactJson(manifest.acp, sourceContract.acp, "Goose ACP pin");

  const executable = requireRecord(runner.executable, "Goose runner executable");
  requireExactKeys(executable, ["file", "sha256", "size"], "Goose runner executable");
  const executableFile = requireString(executable.file, "Goose runner executable file");
  if (executableFile !== buildTarget.executableFile) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner executable does not match the admitted target contract",
    );
  }
  const expectedFiles = new Set([
    GOOSE_RUNNER_MANIFEST_FILE,
    executableFile,
    LOCKFILE_NAME,
    LICENSE_FILE_NAME,
    SBOM_FILE_NAME,
    AUDIT_FILE_NAME,
  ]);
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  if (
    directoryEntries.length !== expectedFiles.size ||
    directoryEntries.some((entry) => !entry.isFile() || !expectedFiles.has(entry.name))
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose runner artifact contains an unexpected, missing, or non-regular entry",
    );
  }
  const executablePath = path.join(directory, executableFile);
  const executableStat = await lstat(executablePath).catch((error: unknown) => {
    throw new GooseRunnerArtifactError("missing-artifact", "Goose runner executable is missing", {
      cause: error,
    });
  });
  if (
    !executableStat.isFile() ||
    executableStat.isSymbolicLink() ||
    executableStat.size < 1 ||
    executableStat.size > MAX_EXECUTABLE_BYTES ||
    !Number.isSafeInteger(executable.size) ||
    (executable.size as number) < 1
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose runner executable metadata is invalid",
    );
  }
  if (executable.size !== executableStat.size) {
    throw new GooseRunnerArtifactError(
      "digest-mismatch",
      "Goose runner executable size does not match its manifest",
    );
  }
  if (process.platform !== "win32") {
    await access(executablePath, fsConstants.X_OK).catch((error: unknown) => {
      throw new GooseRunnerArtifactError(
        "invalid-manifest",
        "Goose runner executable is not executable",
        { cause: error },
      );
    });
  }
  const executableSha256 = requireSha256(executable.sha256, "Goose runner executable SHA-256");
  if ((await sha256File(executablePath)) !== executableSha256) {
    throw new GooseRunnerArtifactError(
      "digest-mismatch",
      "Goose runner executable digest does not match its manifest",
    );
  }

  const build = requireRecord(manifest.build, "Goose runner build evidence");
  requireExactKeys(
    build,
    ["rustToolchain", "profile", "cargoAuditable", "lockfile", "sourceTreeSha256"],
    "Goose runner build evidence",
  );
  requireExactJson(build.rustToolchain, sourceContract.rust, "Goose runner Rust toolchain");
  validateBuildToolEvidence(
    build.cargoAuditable,
    sourceContract.buildTools.cargoAuditable,
    buildTarget.buildToolHost,
    "cargo-auditable",
    "Goose runner cargo-auditable pin",
  );
  if (build.profile !== "release") {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner must be a release build",
    );
  }
  requireSha256(build.sourceTreeSha256, "Goose runner source tree SHA-256");

  const lock = requireRecord(build.lockfile, "Goose runner lockfile evidence");
  requireExactKeys(lock, ["file", "sha256"], "Goose runner lockfile evidence");
  const lockPath = resolveMaterial(directory, lock.file, LOCKFILE_NAME, "Goose runner lockfile");
  const lockBuffer = await readRegularFile(lockPath, MAX_LOCKFILE_BYTES, "Goose runner lockfile");
  if (sha256Buffer(lockBuffer) !== requireSha256(lock.sha256, "Goose runner lockfile SHA-256")) {
    throw new GooseRunnerArtifactError("digest-mismatch", "Goose runner lockfile digest differs");
  }
  validateLockfile(lockBuffer.toString("utf8"));

  const materials = requireRecord(manifest.materials, "Goose runner materials");
  requireExactKeys(materials, ["license", "sbom", "audit"], "Goose runner materials");

  const license = requireRecord(materials.license, "Goose runner license material");
  requireExactKeys(license, ["file", "spdx", "sha256"], "Goose runner license material");
  if (license.spdx !== sourceContract.license.spdx) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner license is unsupported",
    );
  }
  const licensePath = resolveMaterial(directory, license.file, LICENSE_FILE_NAME, "Goose license");
  const licenseBuffer = await readRegularFile(licensePath, MAX_LICENSE_BYTES, "Goose license");
  const licenseSha256 = requireSha256(license.sha256, "Goose license SHA-256");
  if (
    licenseSha256 !== sourceContract.license.sha256 ||
    sha256Buffer(licenseBuffer) !== licenseSha256
  ) {
    throw new GooseRunnerArtifactError("digest-mismatch", "Goose license payload differs");
  }

  const sbom = requireRecord(materials.sbom, "Goose runner SBOM material");
  requireExactKeys(sbom, ["file", "format", "specVersion", "sha256"], "Goose runner SBOM material");
  if (sbom.format !== "CycloneDX" || sbom.specVersion !== "1.6") {
    throw new GooseRunnerArtifactError("invalid-sbom", "Goose runner SBOM metadata is unsupported");
  }
  const sbomPath = resolveMaterial(directory, sbom.file, SBOM_FILE_NAME, "Goose runner SBOM");
  const sbomBuffer = await readRegularFile(sbomPath, MAX_SBOM_BYTES, "Goose runner SBOM");
  if (sha256Buffer(sbomBuffer) !== requireSha256(sbom.sha256, "Goose runner SBOM SHA-256")) {
    throw new GooseRunnerArtifactError("digest-mismatch", "Goose runner SBOM digest differs");
  }
  const sbomComponentCount = validateSbom(parseJson(sbomBuffer, "Goose runner SBOM"));

  const audit = requireRecord(materials.audit, "Goose runner audit material");
  requireExactKeys(audit, ["file", "sha256"], "Goose runner audit material");
  const auditPath = resolveMaterial(directory, audit.file, AUDIT_FILE_NAME, "Goose runner audit");
  const auditBuffer = await readRegularFile(auditPath, MAX_AUDIT_BYTES, "Goose runner audit");
  if (sha256Buffer(auditBuffer) !== requireSha256(audit.sha256, "Goose runner audit SHA-256")) {
    throw new GooseRunnerArtifactError("digest-mismatch", "Goose runner audit digest differs");
  }
  const auditedActiveDependencyCount = validateAudit(
    parseJson(auditBuffer, "Goose runner audit"),
    targetTriple,
    buildTarget.buildToolHost,
  );
  if (sbomComponentCount !== auditedActiveDependencyCount) {
    throw new GooseRunnerArtifactError(
      "invalid-sbom",
      "Goose runner SBOM component count differs from the audited Cargo target graph",
    );
  }

  const provenance = requireRecord(manifest.provenance, "Goose runner provenance");
  requireExactKeys(
    provenance,
    ["actestraCommit", "dirty", "builder", "builtAt", "command"],
    "Goose runner provenance",
  );
  requireCommit(provenance.actestraCommit, "Goose runner Actestra commit");
  if (
    typeof provenance.dirty !== "boolean" ||
    !["local", "github-actions"].includes(String(provenance.builder)) ||
    provenance.command !==
      "cargo auditable build --locked --release --message-format=json-render-diagnostics"
  ) {
    throw new GooseRunnerArtifactError("invalid-manifest", "Goose runner provenance is invalid");
  }
  const builtAt = requireString(provenance.builtAt, "Goose runner build timestamp");
  const builtTime = new Date(builtAt).getTime();
  if (!Number.isFinite(builtTime) || new Date(builtTime).toISOString() !== builtAt) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose runner build timestamp is invalid",
    );
  }

  const containment = Object.hasOwn(manifest, "containment")
    ? parseContainmentEvidence(manifest.containment, {
        targetTriple,
        sourceCommit: provenance.actestraCommit as string,
        executableSha256,
      })
    : undefined;

  return Object.freeze({
    directory,
    executablePath,
    executableSha256,
    executableSize: executableStat.size,
    targetTriple,
    sourceCommit: provenance.actestraCommit as string,
    gooseCommit: sourceContract.goose.runtimeCommit,
    gooseVersion: sourceContract.goose.version,
    manifestPath,
    manifestSha256: sha256Buffer(manifestBuffer),
    ...(containment === undefined ? {} : { containment }),
  });
}

function packagePathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function canonicalPackageResourceRoot(resourcesPath: string): Promise<string> {
  if (
    typeof resourcesPath !== "string" ||
    !path.isAbsolute(resourcesPath) ||
    path.resolve(resourcesPath) !== resourcesPath ||
    path.parse(resourcesPath).root === resourcesPath
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose package resources path must be an absolute non-root path",
    );
  }
  const metadata = await lstat(resourcesPath).catch((error: unknown) => {
    throw new GooseRunnerArtifactError(
      "missing-artifact",
      "Goose package resources directory is missing",
      { cause: error },
    );
  });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose package resources directory must be a real directory",
    );
  }
  const canonical = await realpath(resourcesPath).catch((error: unknown) => {
    throw new GooseRunnerArtifactError(
      "missing-artifact",
      "Goose package resources directory is missing",
      { cause: error },
    );
  });
  if (canonical !== resourcesPath) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose package resources directory cannot resolve through a symlink",
    );
  }
  return canonical;
}

async function canonicalPackageChild(
  resourcesPath: string,
  childName: string,
  kind: "directory" | "file",
): Promise<string> {
  const candidate = path.join(resourcesPath, childName);
  if (!packagePathIsInside(resourcesPath, candidate)) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose package child escapes the resources directory",
    );
  }
  const metadata = await lstat(candidate).catch((error: unknown) => {
    throw new GooseRunnerArtifactError("missing-artifact", "Goose package child is missing", {
      cause: error,
    });
  });
  if (
    metadata.isSymbolicLink() ||
    (kind === "directory" ? !metadata.isDirectory() : !metadata.isFile())
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose package child has an invalid filesystem type",
    );
  }
  const canonical = await realpath(candidate).catch((error: unknown) => {
    throw new GooseRunnerArtifactError("missing-artifact", "Goose package child is missing", {
      cause: error,
    });
  });
  if (canonical !== candidate || !packagePathIsInside(resourcesPath, canonical)) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose package child resolves outside the resources directory",
    );
  }
  return canonical;
}

function packageAttestationFiles(executableFile: string): readonly string[] {
  return Object.freeze(
    [
      PACKAGE_ARTIFACT_METADATA_FILES[0],
      PACKAGE_ARTIFACT_METADATA_FILES[1],
      executableFile,
      PACKAGE_ARTIFACT_METADATA_FILES[2],
      PACKAGE_ARTIFACT_METADATA_FILES[3],
      PACKAGE_ARTIFACT_METADATA_FILES[4],
    ].map((file) => `${GOOSE_RUNNER_PACKAGE_DIRECTORY}/${file}`),
  );
}

function parseGooseRunnerPackageAttestation(
  value: unknown,
  expectedTargetTriple: string,
): GooseRunnerPackageAttestation {
  const attestation = requireRecord(value, "Goose runner package attestation");
  const keys = [
    "contractVersion",
    "targetTriple",
    "sourceCommit",
    "runnerManifestSha256",
    "executableSha256",
    "executableFile",
    "runnerDirectory",
    "files",
  ] as const;
  requireExactKeys(attestation, [...keys], "Goose runner package attestation");
  const target = resolveGooseRunnerBuildTargetByTriple(expectedTargetTriple);
  if (
    target === undefined ||
    attestation.contractVersion !== 1 ||
    attestation.targetTriple !== expectedTargetTriple ||
    attestation.runnerDirectory !== GOOSE_RUNNER_PACKAGE_DIRECTORY ||
    attestation.executableFile !== target.executableFile
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner package attestation target is incompatible",
    );
  }
  const sourceCommit = requireCommit(
    attestation.sourceCommit,
    "Goose runner package source commit",
  );
  const runnerManifestSha256 = requireSha256(
    attestation.runnerManifestSha256,
    "Goose runner package manifest SHA-256",
  );
  const executableSha256 = requireSha256(
    attestation.executableSha256,
    "Goose runner package executable SHA-256",
  );
  const expectedFiles = packageAttestationFiles(target.executableFile);
  if (
    !Array.isArray(attestation.files) ||
    attestation.files.length !== expectedFiles.length ||
    attestation.files.some((file, index) => file !== expectedFiles[index])
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose runner package file attestation is not exact",
    );
  }
  return Object.freeze({
    contractVersion: 1,
    targetTriple: expectedTargetTriple,
    sourceCommit,
    runnerManifestSha256,
    executableSha256,
    executableFile: target.executableFile,
    runnerDirectory: GOOSE_RUNNER_PACKAGE_DIRECTORY,
    files: expectedFiles,
  });
}

export async function admitGooseRunnerPackage(
  resourcesPath: string,
  options: AdmitGooseRunnerPackageOptions,
): Promise<AdmittedGooseRunnerPackage> {
  const canonicalResourcesPath = await canonicalPackageResourceRoot(resourcesPath);
  const target = resolveGooseRunnerBuildTargetByTriple(options.expectedTargetTriple);
  if (target === undefined) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner package target is outside the admitted native build matrix",
    );
  }
  const runnerDirectory = await canonicalPackageChild(
    canonicalResourcesPath,
    GOOSE_RUNNER_PACKAGE_DIRECTORY,
    "directory",
  );
  const attestationPath = await canonicalPackageChild(
    canonicalResourcesPath,
    GOOSE_RUNNER_PACKAGE_ATTESTATION_FILE,
    "file",
  );
  const attestationBuffer = await readRegularFile(
    attestationPath,
    MAX_PACKAGE_ATTESTATION_BYTES,
    "Goose runner package attestation",
  );
  const attestation = parseGooseRunnerPackageAttestation(
    parseJson(attestationBuffer, "Goose runner package attestation"),
    target.targetTriple,
  );
  if (
    options.expectedSourceCommit !== undefined &&
    attestation.sourceCommit !==
      requireCommit(options.expectedSourceCommit, "Expected Actestra source commit")
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner package source commit is not bound to the expected source",
    );
  }

  const expectedFiles = new Set([...PACKAGE_ARTIFACT_METADATA_FILES, target.executableFile]);
  const entries = await readdir(runnerDirectory, { withFileTypes: true });
  if (
    entries.length !== expectedFiles.size ||
    entries.some(
      (entry) => entry.isSymbolicLink() || !entry.isFile() || !expectedFiles.has(entry.name),
    )
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose runner package contains an unexpected or missing file",
    );
  }
  const executablePath = path.join(runnerDirectory, target.executableFile);
  const manifestPath = path.join(runnerDirectory, GOOSE_RUNNER_MANIFEST_FILE);
  const executableBytes = await readRegularFile(
    executablePath,
    MAX_EXECUTABLE_BYTES,
    "Goose runner package executable",
  );
  const manifestBytes = await readRegularFile(
    manifestPath,
    MAX_MANIFEST_BYTES,
    "Goose runner package manifest",
  );
  if (
    sha256Buffer(executableBytes) !== attestation.executableSha256 ||
    sha256Buffer(manifestBytes) !== attestation.runnerManifestSha256
  ) {
    throw new GooseRunnerArtifactError(
      "digest-mismatch",
      "Goose runner package bytes differ from the package attestation",
    );
  }

  const admittedArtifact = await (options.admitRunnerArtifact ?? admitGooseRunnerArtifact)(
    runnerDirectory,
    {
      trustedManifestSha256: attestation.runnerManifestSha256,
      expectedTargetTriple: target.targetTriple,
    },
  );
  if (
    admittedArtifact.directory !== runnerDirectory ||
    admittedArtifact.executablePath !== executablePath ||
    admittedArtifact.targetTriple !== target.targetTriple ||
    admittedArtifact.sourceCommit !== attestation.sourceCommit ||
    admittedArtifact.executableSha256 !== attestation.executableSha256 ||
    admittedArtifact.manifestSha256 !== attestation.runnerManifestSha256
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Re-admitted Goose runner package is not bound to its package attestation",
    );
  }
  const runnerAdmission = Object.freeze({
    directory: runnerDirectory,
    trustedManifestSha256: attestation.runnerManifestSha256,
    expectedTargetTriple: target.targetTriple,
  });
  return Object.freeze({
    resourcesPath: canonicalResourcesPath,
    runnerDirectory,
    attestationPath,
    sourceCommit: attestation.sourceCommit,
    runnerAdmission,
    attestation,
    artifact: admittedArtifact,
  });
}
