import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
  type AdmitGooseRunnerArtifactOptions,
} from "../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  resolveGooseRunnerBuildTargetByTriple,
  type GooseRunnerBuildTarget,
} from "../apps/desktop/src/main/workers/gooseRunnerTarget";
import { GOOSE_RUNNER_MANIFEST_FILE } from "../apps/desktop/src/main/workers/gooseRunnerArtifact";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GOOSE_PACKAGE_RUNNER_DIRECTORY = "actestra-goose-runner" as const;
export const GOOSE_PACKAGE_ATTESTATION_FILE = "actestra-goose-runner-package.json" as const;
export const GOOSE_PACKAGE_RESOURCE_DIRECTORY = "resources" as const;

const ARTIFACT_METADATA_FILES = Object.freeze([
  "GOOSE-APACHE-2.0.txt",
  "Cargo.lock",
  "actestra-goose-runner.audit.json",
  "actestra-goose-runner.cdx.json",
  "actestra-goose-runner.manifest.json",
] as const);

export interface StageAionuiGoosePackageOptions {
  readonly materializedRoot: string;
  readonly artifactDirectory: string;
  readonly targetTriple: string;
  readonly trustedManifestSha256: string;
  readonly expectedSourceCommit?: string;
  readonly admitRunnerArtifact?: (
    directory: string,
    options: AdmitGooseRunnerArtifactOptions,
  ) => Promise<AdmittedGooseRunnerArtifact>;
}

export interface StageAionuiGoosePackageResult {
  readonly target: GooseRunnerBuildTarget;
  readonly runnerDirectory: string;
  readonly attestationPath: string;
  readonly files: readonly string[];
}

export interface GoosePackageAttestationFile {
  readonly contractVersion: 1;
  readonly targetTriple: string;
  readonly sourceCommit: string;
  readonly runnerManifestSha256: string;
  readonly executableSha256: string;
  readonly executableFile: string;
  readonly runnerDirectory: typeof GOOSE_PACKAGE_RUNNER_DIRECTORY;
  readonly files: readonly string[];
}

function artifactFiles(executableFile: string): readonly string[] {
  return Object.freeze([
    "GOOSE-APACHE-2.0.txt",
    "Cargo.lock",
    executableFile,
    "actestra-goose-runner.audit.json",
    "actestra-goose-runner.cdx.json",
    "actestra-goose-runner.manifest.json",
  ]);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

interface RootPathApi {
  readonly basename: (path: string) => string;
  readonly isAbsolute: (path: string) => boolean;
  readonly normalize: (path: string) => string;
  readonly resolve: (path: string) => string;
}

export function isMaterializedRootPath(root: string, pathApi: RootPathApi = path): boolean {
  const normalized = pathApi.normalize(root);
  const resolved = pathApi.resolve(root);
  return (
    pathApi.isAbsolute(root) &&
    resolved === normalized &&
    pathApi.basename(normalized) === "aionui-v2.1.41"
  );
}

function assertMaterializedRoot(root: string): void {
  if (!isMaterializedRootPath(root)) {
    throw new Error("Goose package staging requires the materialized aionui-v2.1.41 root");
  }
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  const metadata = await lstat(filePath).catch(() => undefined);
  if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
}

async function assertExactArtifactDirectory(
  directory: string,
  executableFile: string,
): Promise<void> {
  const expectedFiles = new Set([...ARTIFACT_METADATA_FILES, executableFile]);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new Error("Goose Artifact directory is unavailable");
  });
  if (
    entries.length !== expectedFiles.size ||
    entries.some(
      (entry) => entry.isSymbolicLink() || !entry.isFile() || !expectedFiles.has(entry.name),
    )
  ) {
    throw new Error("Goose Artifact must contain exactly six regular files");
  }
  await Promise.all(
    [...expectedFiles].map((file) =>
      assertRegularFile(path.join(directory, file), `Artifact ${file}`),
    ),
  );
}

function assertTarget(targetTriple: string): GooseRunnerBuildTarget {
  const target = resolveGooseRunnerBuildTargetByTriple(targetTriple);
  if (target === undefined || !["darwin", "win32", "linux"].includes(target.platform)) {
    throw new Error("Goose package target is not an accepted native target");
  }
  return target;
}

async function copyArtifactFiles(
  artifact: AdmittedGooseRunnerArtifact,
  destination: string,
  executableFile: string,
): Promise<void> {
  await assertExactArtifactDirectory(artifact.directory, path.basename(artifact.executablePath));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true, mode: 0o755 });
  const sourceExecutable = path.basename(artifact.executablePath);
  const files = artifactFiles(executableFile);
  for (const file of files) {
    const destinationPath = path.join(destination, file);
    await copyFile(
      path.join(artifact.directory, file === executableFile ? sourceExecutable : file),
      destinationPath,
    );
    await chmod(destinationPath, file === executableFile ? 0o555 : 0o644);
  }
}

function packageAttestation(
  target: GooseRunnerBuildTarget,
  artifact: AdmittedGooseRunnerArtifact,
): GoosePackageAttestationFile {
  if (artifact.sourceCommit === undefined) {
    throw new Error("Goose Artifact provenance does not contain an Actestra source commit");
  }
  return Object.freeze({
    contractVersion: 1,
    targetTriple: target.targetTriple,
    sourceCommit: artifact.sourceCommit,
    runnerManifestSha256: artifact.manifestSha256,
    executableSha256: artifact.executableSha256,
    executableFile: target.executableFile,
    runnerDirectory: GOOSE_PACKAGE_RUNNER_DIRECTORY,
    files: Object.freeze(
      artifactFiles(target.executableFile).map(
        (file) => `${GOOSE_PACKAGE_RUNNER_DIRECTORY}/${file}`,
      ),
    ),
  });
}

export async function stageAionuiGoosePackage(
  options: StageAionuiGoosePackageOptions,
): Promise<StageAionuiGoosePackageResult> {
  assertMaterializedRoot(options.materializedRoot);
  const target = assertTarget(options.targetTriple);
  const admitted = await (options.admitRunnerArtifact ?? admitGooseRunnerArtifact)(
    options.artifactDirectory,
    {
      expectedTargetTriple: target.targetTriple,
      trustedManifestSha256: options.trustedManifestSha256,
    },
  );
  if (admitted.targetTriple !== target.targetTriple) {
    throw new Error("Goose Artifact target does not match the package target");
  }
  if (
    options.expectedSourceCommit !== undefined &&
    admitted.sourceCommit !== options.expectedSourceCommit
  ) {
    throw new Error("Goose Artifact source commit does not match the package source");
  }

  const resourcesDirectory = path.join(options.materializedRoot, GOOSE_PACKAGE_RESOURCE_DIRECTORY);
  const runnerDirectory = path.join(resourcesDirectory, GOOSE_PACKAGE_RUNNER_DIRECTORY);
  const attestationPath = path.join(resourcesDirectory, GOOSE_PACKAGE_ATTESTATION_FILE);
  await mkdir(resourcesDirectory, { recursive: true, mode: 0o755 });
  await copyArtifactFiles(admitted, runnerDirectory, target.executableFile);
  const attestation = packageAttestation(target, admitted);
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
  });
  return Object.freeze({
    target,
    runnerDirectory,
    attestationPath,
    files: Object.freeze([
      ...artifactFiles(target.executableFile).map(
        (file) => `${GOOSE_PACKAGE_RUNNER_DIRECTORY}/${file}`,
      ),
      GOOSE_PACKAGE_ATTESTATION_FILE,
    ]),
  });
}

function argumentValue(argv: readonly string[], name: string, fallback?: string): string {
  const index = argv.indexOf(name);
  if (index === -1) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} requires a value`);
  }
  const value = argv[index + 1];
  if (value === undefined || value.length === 0) throw new Error(`${name} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const targetTriple = argumentValue(argv, "--target-triple");
  const artifactDirectory = argumentValue(
    argv,
    "--artifact-directory",
    path.join(repositoryRoot, ".actestra", "goose-runner", targetTriple),
  );
  const materializedRoot = argumentValue(
    argv,
    "--materialized-root",
    path.join(repositoryRoot, ".actestra", "aionui-v2.1.41"),
  );
  const manifestPath = path.join(artifactDirectory, GOOSE_RUNNER_MANIFEST_FILE);
  const trustedManifestSha256 = argumentValue(
    argv,
    "--trusted-manifest-sha256",
    sha256(await readFile(manifestPath)),
  );
  const expectedSourceCommit = process.env.GITHUB_SHA?.trim() || undefined;
  const result = await stageAionuiGoosePackage({
    materializedRoot,
    artifactDirectory,
    targetTriple,
    trustedManifestSha256,
    expectedSourceCommit,
  });
  process.stdout.write(
    `${JSON.stringify({ status: "staged", targetTriple, files: result.files })}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
