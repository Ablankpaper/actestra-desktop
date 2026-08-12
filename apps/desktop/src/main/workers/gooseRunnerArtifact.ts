import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import sourceContract from "../../shared/gooseRunnerSource.json";

export const GOOSE_RUNNER_MANIFEST_FILE = "actestra-goose-runner.manifest.json" as const;

const EXECUTABLE_BASENAMES = new Set(["actestra-goose-runner", "actestra-goose-runner.exe"]);
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
const BUILD_TOOL_HOST_BY_TARGET: Readonly<Record<string, string>> = Object.freeze({
  "aarch64-apple-darwin": "darwin-arm64",
  "x86_64-apple-darwin": "darwin-x64",
});

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
  readonly gooseCommit: typeof sourceContract.goose.commit;
  readonly gooseVersion: typeof sourceContract.goose.version;
  readonly manifestPath: string;
  readonly manifestSha256: string;
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
): void {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expectedSet.has(key)) ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      `${label} keys do not match the artifact contract`,
    );
  }
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
  targetTriple: string,
  toolName: "cargo-auditable" | "cargo-audit",
  label: string,
): void {
  const evidence = requireRecord(value, label);
  requireExactKeys(evidence, ["version", "commit", "archiveSha256", "executableSha256"], label);
  const host = BUILD_TOOL_HOST_BY_TARGET[targetTriple];
  const assetContracts = sourceContract.buildToolAssets as Readonly<
    Record<string, readonly { name: string; sha256: string }[]>
  >;
  const asset =
    host === undefined ? undefined : assetContracts[host]?.find((item) => item.name === toolName);
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
    !goose.purl.includes(sourceContract.goose.commit)
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

function validateAudit(value: unknown, targetTriple: string): number {
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
    targetTriple,
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
  const exactSource = `git+https://github.com/aaif-goose/goose?rev=${sourceContract.goose.commit}#${sourceContract.goose.commit}`;
  if (
    !lockfile.includes(exactSource) ||
    !/name = "event-listener"\nversion = "5\.4\.2"/.test(lockfile) ||
    /name = "event-listener"\nversion = "5\.4\.1"/.test(lockfile) ||
    !/name = "lru"\nversion = "0\.18\.2"/.test(lockfile) ||
    /name = "lru"\nversion = "0\.18\.1"/.test(lockfile) ||
    /name = "quick-xml"\nversion = "(?:0\.36\.2|0\.37\.5)"/.test(lockfile)
  ) {
    throw new GooseRunnerArtifactError(
      "incompatible-artifact",
      "Goose runner lock does not satisfy the exact source and dependency floor",
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

  requireExactJson(manifest.goose, sourceContract.goose, "Goose source and feature pin");
  requireExactJson(manifest.acp, sourceContract.acp, "Goose ACP pin");

  const executable = requireRecord(runner.executable, "Goose runner executable");
  requireExactKeys(executable, ["file", "sha256", "size"], "Goose runner executable");
  const executableFile = requireString(executable.file, "Goose runner executable file");
  if (!EXECUTABLE_BASENAMES.has(executableFile)) {
    throw new GooseRunnerArtifactError(
      "invalid-manifest",
      "Goose runner executable must use its fixed platform basename",
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
    targetTriple,
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

  return Object.freeze({
    directory,
    executablePath,
    executableSha256,
    executableSize: executableStat.size,
    targetTriple,
    gooseCommit: sourceContract.goose.commit,
    gooseVersion: sourceContract.goose.version,
    manifestPath,
    manifestSha256: sha256Buffer(manifestBuffer),
  });
}
