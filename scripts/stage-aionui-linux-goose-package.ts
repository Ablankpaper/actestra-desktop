import { createHash } from "node:crypto";
import { copyFile, chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  GOOSE_LINUX_ADMISSION_RECORD_FILE,
  GOOSE_LINUX_PROFILE_NAME,
  GOOSE_LINUX_TARGET_TRIPLE,
  GOOSE_LINUX_EXECUTABLE_PATH,
} from "../apps/desktop/src/shared/gooseRunnerLinuxPackage.ts";
import {
  GOOSE_RUNNER_MANIFEST_FILE,
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
  type AdmitGooseRunnerArtifactOptions,
} from "../apps/desktop/src/main/workers/gooseRunnerArtifact.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MATERIALIZED_ROOT = path.join(repositoryRoot, ".actestra", "aionui-v2.1.41");
const DEFAULT_ARTIFACT_DIRECTORY = path.join(
  repositoryRoot,
  ".actestra",
  "goose-runner",
  GOOSE_LINUX_TARGET_TRIPLE,
);
const PROFILE_SOURCE = path.join(
  repositoryRoot,
  "apps",
  "desktop",
  "resources",
  "linux",
  "actestra-apparmor-profile",
);
const ARTIFACT_FILES = Object.freeze([
  "GOOSE-APACHE-2.0.txt",
  "Cargo.lock",
  "actestra-goose-runner",
  "actestra-goose-runner.audit.json",
  "actestra-goose-runner.cdx.json",
  GOOSE_RUNNER_MANIFEST_FILE,
]);

export interface StageAionuiLinuxGoosePackageOptions {
  readonly materializedRoot: string;
  readonly artifactDirectory: string;
  readonly profilePath: string;
  readonly trustedManifestSha256: string;
  readonly admitRunnerArtifact?: (
    directory: string,
    options: AdmitGooseRunnerArtifactOptions,
  ) => Promise<AdmittedGooseRunnerArtifact>;
}

export interface StageAionuiLinuxGoosePackageResult {
  readonly files: readonly string[];
  readonly recordPath: string;
  readonly runnerDirectory: string;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

function assertMaterializedRoot(root: string): void {
  const resolved = path.resolve(root);
  if (!path.isAbsolute(root) || resolved !== root || path.basename(root) !== "aionui-v2.1.41") {
    throw new Error("Linux Goose package staging requires the materialized aionui-v2.1.41 root");
  }
}

async function assertRegularFile(filePath: string, label: string): Promise<void> {
  const metadata = await lstat(filePath).catch(() => undefined);
  if (metadata === undefined || !metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Linux Goose ${label} must be a regular file`);
  }
}

async function assertExactArtifactDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new Error("Linux Goose Artifact directory is unavailable");
  });
  if (
    entries.length !== ARTIFACT_FILES.length ||
    entries.some(
      (entry) => entry.isSymbolicLink() || !entry.isFile() || !ARTIFACT_FILES.includes(entry.name),
    )
  ) {
    throw new Error("Linux Goose Artifact must contain exactly six regular files");
  }
  await Promise.all(
    ARTIFACT_FILES.map((file) => assertRegularFile(path.join(directory, file), `Artifact ${file}`)),
  );
}

async function copyExactArtifactFiles(
  artifact: AdmittedGooseRunnerArtifact,
  destination: string,
): Promise<void> {
  await assertExactArtifactDirectory(artifact.directory);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true, mode: 0o755 });
  await Promise.all(
    ARTIFACT_FILES.map(async (file) => {
      const target = path.join(destination, file);
      await copyFile(path.join(artifact.directory, file), target);
      await chmod(target, 0o644);
    }),
  );
  // The DEB owns this file as root, but Goose must execute it as the ordinary
  // desktop user. Keep every write bit clear while granting execute/read to
  // non-root users; the Main admission check still requires UID 0 and a
  // canonical, non-writable package tree.
  await chmod(path.join(destination, "actestra-goose-runner"), 0o555);
}

export async function stageAionuiLinuxGoosePackage(
  options: StageAionuiLinuxGoosePackageOptions,
): Promise<StageAionuiLinuxGoosePackageResult> {
  assertMaterializedRoot(options.materializedRoot);
  await assertRegularFile(options.profilePath, "AppArmor profile");
  const admitted = await (options.admitRunnerArtifact ?? admitGooseRunnerArtifact)(
    options.artifactDirectory,
    {
      expectedTargetTriple: GOOSE_LINUX_TARGET_TRIPLE,
      trustedManifestSha256: options.trustedManifestSha256,
    },
  );
  if (admitted.targetTriple !== GOOSE_LINUX_TARGET_TRIPLE) {
    throw new Error("Linux Goose Artifact target does not match Ubuntu x64");
  }

  const resourcesDirectory = path.join(options.materializedRoot, "resources");
  const runnerDirectory = path.join(resourcesDirectory, "actestra-goose-runner");
  const recordPath = path.join(resourcesDirectory, GOOSE_LINUX_ADMISSION_RECORD_FILE);
  const materializedProfilePath = path.join(resourcesDirectory, "actestra-apparmor-profile");
  await mkdir(resourcesDirectory, { recursive: true, mode: 0o755 });
  await copyFile(options.profilePath, materializedProfilePath);
  await chmod(materializedProfilePath, 0o644);
  await copyExactArtifactFiles(admitted, runnerDirectory);
  const record = Object.freeze({
    contractVersion: 1 as const,
    targetTriple: admitted.targetTriple,
    runnerManifestSha256: admitted.manifestSha256,
    executableSha256: admitted.executableSha256,
    profileSha256: await sha256File(materializedProfilePath),
    profileName: GOOSE_LINUX_PROFILE_NAME,
    executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
  });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  return Object.freeze({
    files: Object.freeze([
      ...ARTIFACT_FILES.map((file) => `actestra-goose-runner/${file}`),
      GOOSE_LINUX_ADMISSION_RECORD_FILE,
    ]),
    recordPath,
    runnerDirectory,
  });
}

function argumentValue(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  return index === -1
    ? fallback
    : (argv[index + 1] ??
        (() => {
          throw new Error(`${name} requires a value`);
        })());
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const materializedRoot = argumentValue(argv, "--materialized-root", DEFAULT_MATERIALIZED_ROOT);
  const artifactDirectory = argumentValue(argv, "--artifact-directory", DEFAULT_ARTIFACT_DIRECTORY);
  const profilePath = argumentValue(argv, "--profile", PROFILE_SOURCE);
  const manifestPath = path.join(artifactDirectory, GOOSE_RUNNER_MANIFEST_FILE);
  const trustedManifestSha256 =
    process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256?.trim() ??
    sha256(await readFile(manifestPath));
  const result = await stageAionuiLinuxGoosePackage({
    materializedRoot,
    artifactDirectory,
    profilePath,
    trustedManifestSha256,
  });
  process.stdout.write(`${JSON.stringify({ status: "staged", files: result.files })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
