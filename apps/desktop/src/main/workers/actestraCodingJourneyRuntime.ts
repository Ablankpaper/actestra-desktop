import { constants as fsConstants } from "node:fs";
import { access, chmod, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ActestraMainModelInvoker } from "../model/actestraMainModelBroker";
import type { AionUiCodingRunnerAdmission } from "../compatibility/aionuiCodingAgentService";
import type { IsolatedCodingProcessDefinition } from "../privileged/isolatedCodingToolPlatform";
import {
  admitGooseRunnerArtifact,
  admitGooseRunnerPackage,
  type AdmittedGooseRunnerArtifact,
  type AdmittedGooseRunnerPackage,
} from "./gooseRunnerArtifact";
import {
  admitInstalledGooseRunnerLinuxPackage,
  type AdmittedGooseRunnerLinuxPackage,
} from "./gooseRunnerLinuxPackage";
import { resolveGooseRunnerRuntimeTarget } from "./gooseRunnerTarget";
import { GIT_EXECUTABLE } from "./workspaceGitBinding";

const MODEL_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TARGET_TRIPLE_PATTERN = /^[A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+$/;

const COMMANDS: Readonly<Record<string, IsolatedCodingProcessDefinition>> = Object.freeze({
  "git.status": Object.freeze({
    executablePath: GIT_EXECUTABLE,
    args: Object.freeze(["status", "--short", "--branch"]),
  }),
});

const TESTS: Readonly<Record<string, IsolatedCodingProcessDefinition>> = Object.freeze({
  "git.diff-check": Object.freeze({
    executablePath: GIT_EXECUTABLE,
    args: Object.freeze(["diff", "--check"]),
  }),
});

export interface ActestraCodingModelBinding {
  readonly modelId: string;
  readonly invokeModel: ActestraMainModelInvoker;
}

export interface TrustedActestraCodingJourneyRuntime {
  readonly runnerAdmission: AionUiCodingRunnerAdmission;
  readonly admittedArtifact: AdmittedGooseRunnerArtifact;
  readonly packagedRunnerPackage?: AdmittedGooseRunnerPackage;
  readonly linuxPackage?: AdmittedGooseRunnerLinuxPackage;
  readonly revalidateArtifact?: () => Promise<AdmittedGooseRunnerArtifact>;
  readonly privateRootParent: string;
  readonly modelId: string;
  readonly modelInvoker: ActestraMainModelInvoker;
  readonly commands: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
}

export interface StartTrustedActestraCodingJourneyRuntimeOptions {
  readonly userDataPath: string;
  readonly runnerAdmission: AionUiCodingRunnerAdmission | null;
  readonly linuxPackageResourcesPath?: string;
  readonly packagedResourcesPath?: string;
  readonly modelBinding: ActestraCodingModelBinding | null;
  /** Fixed, non-sensitive startup boundary used by packaged acceptance diagnostics. */
  readonly onFailure?: (stage: ActestraCodingJourneyRuntimeFailureStage) => void;
}

export type ActestraCodingJourneyRuntimeFailureStage =
  | "model-binding"
  | "user-data"
  | "runner-package"
  | "runner-admission"
  | "git-executable"
  | "private-root"
  | "runtime-startup";

export interface ActestraCodingJourneyRuntimeDependencies {
  readonly admitRunnerArtifact: typeof admitGooseRunnerArtifact;
  readonly admitPackagedRunnerPackage?: typeof admitGooseRunnerPackage;
  readonly admitLinuxPackage?: typeof admitInstalledGooseRunnerLinuxPackage;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
}

const DEFAULT_DEPENDENCIES: ActestraCodingJourneyRuntimeDependencies = Object.freeze({
  admitRunnerArtifact: admitGooseRunnerArtifact,
  admitPackagedRunnerPackage: admitGooseRunnerPackage,
  admitLinuxPackage: admitInstalledGooseRunnerLinuxPackage,
  platform: process.platform,
  architecture: process.arch,
});

function nodeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function ownDataProperty(value: object, key: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function snapshotModelBinding(
  value: ActestraCodingModelBinding | null,
): Readonly<ActestraCodingModelBinding> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== "string" || !["modelId", "invokeModel"].includes(key))
  ) {
    return null;
  }
  const modelId = ownDataProperty(value, "modelId");
  const invokeModel = ownDataProperty(value, "invokeModel");
  if (
    typeof modelId !== "string" ||
    modelId.length < 1 ||
    modelId.length > 256 ||
    !MODEL_ID_PATTERN.test(modelId) ||
    typeof invokeModel !== "function"
  ) {
    return null;
  }
  return Object.freeze({ modelId, invokeModel: invokeModel as ActestraMainModelInvoker });
}

function snapshotRunnerAdmission(
  value: AionUiCodingRunnerAdmission | null,
): Readonly<AionUiCodingRunnerAdmission> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !["directory", "trustedManifestSha256", "expectedTargetTriple"].includes(key),
    )
  ) {
    return null;
  }
  const directory = ownDataProperty(value, "directory");
  const trustedManifestSha256 = ownDataProperty(value, "trustedManifestSha256");
  const expectedTargetTriple = ownDataProperty(value, "expectedTargetTriple");
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    path.resolve(directory) !== directory ||
    path.parse(directory).root === directory ||
    typeof trustedManifestSha256 !== "string" ||
    !SHA256_PATTERN.test(trustedManifestSha256) ||
    typeof expectedTargetTriple !== "string" ||
    expectedTargetTriple.length > 128 ||
    !TARGET_TRIPLE_PATTERN.test(expectedTargetTriple)
  ) {
    return null;
  }
  return Object.freeze({ directory, trustedManifestSha256, expectedTargetTriple });
}

export function resolveTrustedActestraCodingRunnerAdmission(
  environment: NodeJS.ProcessEnv,
): Readonly<AionUiCodingRunnerAdmission> | null {
  const directory = environment.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY?.trim();
  const trustedManifestSha256 = environment.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256?.trim();
  const expectedTargetTriple = environment.ACTESTRA_GOOSE_RUNNER_TARGET_TRIPLE?.trim();
  if (!directory || !trustedManifestSha256 || !expectedTargetTriple) return null;
  return snapshotRunnerAdmission({ directory, trustedManifestSha256, expectedTargetTriple });
}

async function canonicalUserDataPath(value: string): Promise<string | null> {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value
  ) {
    return null;
  }
  const [metadata, canonical] = await Promise.all([lstat(value), realpath(value)]);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== value) return null;
  return canonical;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function ensurePrivateRoot(userDataPath: string): Promise<string | null> {
  const requested = path.join(userDataPath, "goose-private");
  if (!isInside(userDataPath, requested)) return null;
  try {
    await mkdir(requested, { mode: 0o700 });
  } catch (error) {
    if (nodeErrorCode(error) !== "EEXIST") throw error;
  }
  const [metadata, canonical] = await Promise.all([lstat(requested), realpath(requested)]);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    canonical !== requested ||
    !isInside(userDataPath, canonical)
  ) {
    return null;
  }
  await chmod(canonical, 0o700);
  const secured = await lstat(canonical);
  if (secured.isSymbolicLink() || !secured.isDirectory() || (secured.mode & 0o777) !== 0o700) {
    return null;
  }
  return canonical;
}

async function hasCanonicalGitExecutable(): Promise<boolean> {
  const [metadata, canonical] = await Promise.all([
    lstat(GIT_EXECUTABLE),
    realpath(GIT_EXECUTABLE),
    access(GIT_EXECUTABLE, fsConstants.X_OK),
  ]);
  return metadata.isFile() && !metadata.isSymbolicLink() && canonical === GIT_EXECUTABLE;
}

function artifactMatchesAdmission(
  artifact: AdmittedGooseRunnerArtifact,
  admission: AionUiCodingRunnerAdmission,
): boolean {
  return (
    typeof artifact === "object" &&
    artifact !== null &&
    artifact.manifestSha256 === admission.trustedManifestSha256 &&
    artifact.targetTriple === admission.expectedTargetTriple
  );
}

export async function startTrustedActestraCodingJourneyRuntime(
  options: StartTrustedActestraCodingJourneyRuntimeOptions,
  dependencies: ActestraCodingJourneyRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<TrustedActestraCodingJourneyRuntime | null> {
  const fail = (stage: ActestraCodingJourneyRuntimeFailureStage): null => {
    try {
      options.onFailure?.(stage);
    } catch {
      // Diagnostics are advisory and must never change the fail-closed result.
    }
    return null;
  };
  try {
    const modelBinding = snapshotModelBinding(options.modelBinding);
    if (modelBinding === null) return fail("model-binding");
    const userDataPath = await canonicalUserDataPath(options.userDataPath);
    if (userDataPath === null) return fail("user-data");
    let runnerAdmission: Readonly<AionUiCodingRunnerAdmission> | null;
    let admittedArtifact: AdmittedGooseRunnerArtifact;
    let packagedRunnerPackage: Readonly<AdmittedGooseRunnerPackage> | undefined;
    let linuxPackage: Readonly<AdmittedGooseRunnerLinuxPackage> | undefined;
    let revalidateArtifact: (() => Promise<AdmittedGooseRunnerArtifact>) | undefined;
    const platform = dependencies.platform ?? process.platform;
    const architecture = dependencies.architecture ?? process.arch;
    if (platform === "linux") {
      if (typeof options.linuxPackageResourcesPath !== "string") return fail("runner-package");
      const admitLinuxPackage =
        dependencies.admitLinuxPackage ?? admitInstalledGooseRunnerLinuxPackage;
      const linuxPackageResourcesPath = options.linuxPackageResourcesPath;
      let admittedLinuxPackage: AdmittedGooseRunnerLinuxPackage | null;
      try {
        admittedLinuxPackage = await admitLinuxPackage(linuxPackageResourcesPath);
      } catch {
        return fail("runner-package");
      }
      if (admittedLinuxPackage === null) return fail("runner-package");
      linuxPackage = admittedLinuxPackage;
      runnerAdmission = snapshotRunnerAdmission(linuxPackage.runnerAdmission);
      if (runnerAdmission === null) return fail("runner-admission");
      admittedArtifact = linuxPackage.artifact;
      revalidateArtifact = async (): Promise<AdmittedGooseRunnerArtifact> => {
        const refreshed = await admitLinuxPackage(linuxPackageResourcesPath);
        if (refreshed === null) {
          throw new Error("The packaged Linux Goose runner is no longer admitted");
        }
        return refreshed.artifact;
      };
    } else if (typeof options.packagedResourcesPath === "string") {
      const target = resolveGooseRunnerRuntimeTarget(platform, architecture);
      if (target === undefined) return fail("runner-package");
      const admitPackagedRunnerPackage =
        dependencies.admitPackagedRunnerPackage ?? admitGooseRunnerPackage;
      const packagedResourcesPath = options.packagedResourcesPath;
      try {
        packagedRunnerPackage = await admitPackagedRunnerPackage(packagedResourcesPath, {
          expectedTargetTriple: target.targetTriple,
        });
      } catch {
        return fail("runner-package");
      }
      runnerAdmission = snapshotRunnerAdmission(packagedRunnerPackage.runnerAdmission);
      if (runnerAdmission === null) return fail("runner-admission");
      admittedArtifact = packagedRunnerPackage.artifact;
      if (!artifactMatchesAdmission(admittedArtifact, runnerAdmission)) {
        return fail("runner-admission");
      }
      revalidateArtifact = async (): Promise<AdmittedGooseRunnerArtifact> => {
        const refreshed = await admitPackagedRunnerPackage(packagedResourcesPath, {
          expectedTargetTriple: target.targetTriple,
        });
        return refreshed.artifact;
      };
    } else {
      runnerAdmission = snapshotRunnerAdmission(options.runnerAdmission);
      if (runnerAdmission === null) return fail("runner-admission");
      try {
        admittedArtifact = await dependencies.admitRunnerArtifact(runnerAdmission.directory, {
          trustedManifestSha256: runnerAdmission.trustedManifestSha256,
          expectedTargetTriple: runnerAdmission.expectedTargetTriple,
        });
      } catch {
        return fail("runner-admission");
      }
      if (!artifactMatchesAdmission(admittedArtifact, runnerAdmission)) {
        return fail("runner-admission");
      }
    }
    if (runnerAdmission === null) return fail("runner-admission");
    try {
      if (!(await hasCanonicalGitExecutable())) return fail("git-executable");
    } catch {
      return fail("git-executable");
    }
    let privateRootParent: string | null;
    try {
      privateRootParent = await ensurePrivateRoot(userDataPath);
    } catch {
      return fail("private-root");
    }
    if (privateRootParent === null) return fail("private-root");
    return Object.freeze({
      runnerAdmission,
      admittedArtifact,
      ...(packagedRunnerPackage === undefined ? {} : { packagedRunnerPackage }),
      ...(linuxPackage === undefined ? {} : { linuxPackage }),
      ...(revalidateArtifact === undefined ? {} : { revalidateArtifact }),
      privateRootParent,
      modelId: modelBinding.modelId,
      modelInvoker: modelBinding.invokeModel,
      commands: COMMANDS,
      tests: TESTS,
    });
  } catch {
    return fail("runtime-startup");
  }
}
