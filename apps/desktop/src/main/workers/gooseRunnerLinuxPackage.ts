import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  GOOSE_LINUX_ADMISSION_RECORD_FILE,
  GOOSE_LINUX_ARTIFACT_DIRECTORY,
  GOOSE_LINUX_EXECUTABLE_PATH,
  GOOSE_LINUX_INSTALL_ROOT,
  GOOSE_LINUX_PROFILE_FILE,
  GOOSE_LINUX_RESOURCES_PATH,
  GOOSE_LINUX_TARGET_TRIPLE,
  parseGooseRunnerLinuxPackageAdmission,
  type GooseRunnerLinuxPackageAdmission,
} from "../../shared/gooseRunnerLinuxPackage";
import {
  GOOSE_RUNNER_MANIFEST_FILE,
  admitGooseRunnerArtifact,
  type AdmitGooseRunnerArtifactOptions,
  type AdmittedGooseRunnerArtifact,
} from "./gooseRunnerArtifact";

export const GOOSE_LINUX_BOOTSTRAP_OK_MARKER = "ACTESTRA_GOOSE_LINUX_BOOTSTRAP_OK" as const;

const MAX_ADMISSION_RECORD_BYTES = 64 * 1024;
const MAX_BOOTSTRAP_OUTPUT_BYTES = 256;
const BOOTSTRAP_TIMEOUT_MS = 5_000;
const ARTIFACT_FILES = Object.freeze([
  GOOSE_RUNNER_MANIFEST_FILE,
  "actestra-goose-runner",
  "actestra-goose-runner.cdx.json",
  "actestra-goose-runner.audit.json",
  "Cargo.lock",
  "GOOSE-APACHE-2.0.txt",
] as const);

export interface LinuxPackagePathMetadata {
  readonly canonicalPath: string;
  readonly kind: "directory" | "file";
  readonly mode: number;
  readonly size: number;
  readonly uid: number;
}

export interface GooseRunnerLinuxPackageAdmissionDependencies {
  readonly lstat: (filePath: string) => Promise<LinuxPackagePathMetadata>;
  readonly readFile: (filePath: string) => Promise<Uint8Array>;
  readonly sha256File: (filePath: string) => Promise<string>;
  readonly admitRunnerArtifact: (
    directory: string,
    options: AdmitGooseRunnerArtifactOptions,
  ) => Promise<AdmittedGooseRunnerArtifact>;
  readonly runBootstrapCheck: (executablePath: string) => Promise<boolean>;
}

export interface AdmittedGooseRunnerLinuxPackage {
  readonly resourcesPath: typeof GOOSE_LINUX_RESOURCES_PATH;
  readonly profilePath: string;
  readonly recordPath: string;
  readonly runnerAdmission: Readonly<{
    readonly directory: typeof GOOSE_LINUX_ARTIFACT_DIRECTORY;
    readonly trustedManifestSha256: string;
    readonly expectedTargetTriple: typeof GOOSE_LINUX_TARGET_TRIPLE;
  }>;
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly record: Readonly<GooseRunnerLinuxPackageAdmission>;
  readonly executablePath: typeof GOOSE_LINUX_EXECUTABLE_PATH;
  readonly bootstrapMarker: typeof GOOSE_LINUX_BOOTSTRAP_OK_MARKER;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function defaultLstat(filePath: string): Promise<LinuxPackagePathMetadata> {
  const metadata = await lstat(filePath);
  const kind = metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : undefined;
  if (kind === undefined) {
    throw new Error("unsupported package file type");
  }
  return Object.freeze({
    canonicalPath: await realpath(filePath),
    kind,
    mode: metadata.mode & 0o7777,
    size: metadata.size,
    uid: metadata.uid,
  });
}

async function defaultReadFile(filePath: string): Promise<Uint8Array> {
  return readFile(filePath);
}

async function defaultSha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

function appendBounded(
  current: string,
  chunk: Uint8Array,
): { readonly value: string; readonly exceeded: boolean } {
  const next = Buffer.concat([Buffer.from(current, "utf8"), Buffer.from(chunk)]);
  if (next.byteLength > MAX_BOOTSTRAP_OUTPUT_BYTES) {
    return Object.freeze({ value: "", exceeded: true });
  }
  return Object.freeze({ value: next.toString("utf8"), exceeded: false });
}

async function defaultRunBootstrapCheck(executablePath: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(executablePath, ["--actestra-linux-bootstrap-check"], {
        cwd: "/",
        env: Object.freeze({
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
          LANG: "C",
        }),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish(false);
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may have exited between the timeout and kill attempt.
      }
      finish(false);
    }, BOOTSTRAP_TIMEOUT_MS);
    const clear = (): void => clearTimeout(timer);
    child.stdout.on("data", (chunk: Uint8Array) => {
      const next = appendBounded(stdout, chunk);
      stdout = next.value;
      if (next.exceeded) {
        clear();
        try {
          child.kill("SIGKILL");
        } catch {
          // The close event still completes the bounded probe.
        }
        finish(false);
      }
    });
    child.stderr.on("data", (chunk: Uint8Array) => {
      const next = appendBounded(stderr, chunk);
      stderr = next.value;
      if (next.exceeded) {
        clear();
        try {
          child.kill("SIGKILL");
        } catch {
          // The close event still completes the bounded probe.
        }
        finish(false);
      }
    });
    child.once("error", () => {
      clear();
      finish(false);
    });
    child.once("close", (code, signal) => {
      clear();
      finish(
        code === 0 &&
          signal === null &&
          stderr.length === 0 &&
          (stdout === `${GOOSE_LINUX_BOOTSTRAP_OK_MARKER}\n` ||
            stdout === GOOSE_LINUX_BOOTSTRAP_OK_MARKER),
      );
    });
  });
}

const DEFAULT_DEPENDENCIES: GooseRunnerLinuxPackageAdmissionDependencies = Object.freeze({
  lstat: defaultLstat,
  readFile: defaultReadFile,
  sha256File: defaultSha256File,
  admitRunnerArtifact: admitGooseRunnerArtifact,
  runBootstrapCheck: defaultRunBootstrapCheck,
});

function requiredPackagePaths(resourcesPath: string): readonly string[] {
  const runnerDirectory = path.join(resourcesPath, "actestra-goose-runner");
  return Object.freeze([
    "/opt",
    GOOSE_LINUX_INSTALL_ROOT,
    resourcesPath,
    runnerDirectory,
    path.join(resourcesPath, GOOSE_LINUX_PROFILE_FILE),
    path.join(resourcesPath, GOOSE_LINUX_ADMISSION_RECORD_FILE),
    ...ARTIFACT_FILES.map((file) => path.join(runnerDirectory, file)),
  ]);
}

async function assertRootOwnedCanonicalPath(
  dependencies: GooseRunnerLinuxPackageAdmissionDependencies,
  filePath: string,
  kind: LinuxPackagePathMetadata["kind"],
  requireExecutable: boolean,
): Promise<boolean> {
  let metadata: LinuxPackagePathMetadata;
  try {
    metadata = await dependencies.lstat(filePath);
  } catch {
    return false;
  }
  if (
    metadata.canonicalPath !== filePath ||
    metadata.kind !== kind ||
    metadata.uid !== 0 ||
    !Number.isSafeInteger(metadata.mode) ||
    (metadata.mode & 0o7022) !== 0 ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0
  ) {
    return false;
  }
  return !requireExecutable || (metadata.mode & 0o100) !== 0;
}

async function readAdmissionRecord(
  dependencies: GooseRunnerLinuxPackageAdmissionDependencies,
  recordPath: string,
): Promise<Readonly<GooseRunnerLinuxPackageAdmission> | null> {
  let bytes: Uint8Array;
  try {
    const metadata = await dependencies.lstat(recordPath);
    if (metadata.size > MAX_ADMISSION_RECORD_BYTES) return null;
    bytes = await dependencies.readFile(recordPath);
  } catch {
    return null;
  }
  if (bytes.byteLength > MAX_ADMISSION_RECORD_BYTES) return null;
  try {
    return parseGooseRunnerLinuxPackageAdmission(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch {
    return null;
  }
}

export async function admitInstalledGooseRunnerLinuxPackage(
  resourcesPath: string,
  dependencies: GooseRunnerLinuxPackageAdmissionDependencies = DEFAULT_DEPENDENCIES,
): Promise<Readonly<AdmittedGooseRunnerLinuxPackage> | null> {
  if (resourcesPath !== GOOSE_LINUX_RESOURCES_PATH) return null;
  try {
    const runnerDirectory = GOOSE_LINUX_ARTIFACT_DIRECTORY;
    const profilePath = path.join(resourcesPath, GOOSE_LINUX_PROFILE_FILE);
    const recordPath = path.join(resourcesPath, GOOSE_LINUX_ADMISSION_RECORD_FILE);
    const paths = requiredPackagePaths(resourcesPath);
    for (const [index, filePath] of paths.entries()) {
      const isDirectory = index < 4;
      const executable = filePath === GOOSE_LINUX_EXECUTABLE_PATH;
      if (
        !(await assertRootOwnedCanonicalPath(
          dependencies,
          filePath,
          isDirectory ? "directory" : "file",
          executable,
        ))
      ) {
        return null;
      }
    }
    const record = await readAdmissionRecord(dependencies, recordPath);
    if (record === null) return null;
    if (
      record.executablePath !== GOOSE_LINUX_EXECUTABLE_PATH ||
      record.targetTriple !== GOOSE_LINUX_TARGET_TRIPLE ||
      (await dependencies.sha256File(profilePath)) !== record.profileSha256
    ) {
      return null;
    }
    const artifact = await dependencies.admitRunnerArtifact(runnerDirectory, {
      trustedManifestSha256: record.runnerManifestSha256,
      expectedTargetTriple: record.targetTriple,
    });
    const manifestPath = path.join(runnerDirectory, GOOSE_RUNNER_MANIFEST_FILE);
    const executablePath = GOOSE_LINUX_EXECUTABLE_PATH;
    if (
      artifact.directory !== runnerDirectory ||
      artifact.executablePath !== executablePath ||
      artifact.targetTriple !== record.targetTriple ||
      artifact.manifestSha256 !== record.runnerManifestSha256 ||
      artifact.executableSha256 !== record.executableSha256 ||
      (await dependencies.sha256File(manifestPath)) !== record.runnerManifestSha256 ||
      (await dependencies.sha256File(executablePath)) !== record.executableSha256
    ) {
      return null;
    }
    if (!(await dependencies.runBootstrapCheck(executablePath))) return null;
    return Object.freeze({
      resourcesPath: GOOSE_LINUX_RESOURCES_PATH,
      profilePath,
      recordPath,
      runnerAdmission: Object.freeze({
        directory: runnerDirectory,
        trustedManifestSha256: record.runnerManifestSha256,
        expectedTargetTriple: record.targetTriple,
      }),
      artifact,
      record,
      executablePath,
      bootstrapMarker: GOOSE_LINUX_BOOTSTRAP_OK_MARKER,
    });
  } catch {
    return null;
  }
}
