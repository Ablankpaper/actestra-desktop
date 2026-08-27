// @vitest-environment node

import { mkdtemp, readdir, realpath, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GooseLoopbackModelInvoker } from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { AdmittedGooseRunnerLinuxPackage } from "../../apps/desktop/src/main/workers/gooseRunnerLinuxPackage";
import {
  resolveTrustedActestraCodingRunnerAdmission,
  startTrustedActestraCodingJourneyRuntime,
  type ActestraCodingJourneyRuntimeDependencies,
  type ActestraCodingModelBinding,
} from "../../apps/desktop/src/main/workers/actestraCodingJourneyRuntime";
import type { AdmittedGooseRunnerPackage } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { GIT_EXECUTABLE } from "../../apps/desktop/src/main/workers/workspaceGitBinding";
import {
  GOOSE_LINUX_ADMISSION_RECORD_FILE,
  GOOSE_LINUX_ARTIFACT_DIRECTORY,
  GOOSE_LINUX_EXECUTABLE_PATH,
  GOOSE_LINUX_PROFILE_FILE,
  GOOSE_LINUX_RESOURCES_PATH,
  GOOSE_LINUX_TARGET_TRIPLE,
} from "../../apps/desktop/src/shared/gooseRunnerLinuxPackage";

const roots: string[] = [];
const realArtifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
const realManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
const realTargetTriple =
  process.platform === "darwin" && process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : process.platform === "darwin" && process.arch === "x64"
      ? "x86_64-apple-darwin"
      : undefined;

const artifact = Object.freeze({
  directory: "/private/tmp/actestra-goose-runner",
  executablePath: "/private/tmp/actestra-goose-runner/actestra-goose-runner",
  executableSha256: "a".repeat(64),
  executableSize: 1,
  targetTriple: "aarch64-apple-darwin",
  gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseVersion: "1.45.0",
  manifestPath: "/private/tmp/actestra-goose-runner/actestra-goose-runner.manifest.json",
  manifestSha256: "b".repeat(64),
}) satisfies AdmittedGooseRunnerArtifact;

const runnerAdmission = Object.freeze({
  directory: artifact.directory,
  trustedManifestSha256: artifact.manifestSha256,
  expectedTargetTriple: artifact.targetTriple,
});

const invokeModel: GooseLoopbackModelInvoker = async () =>
  Object.freeze({
    type: "message" as const,
    text: "admitted model response",
    usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
  });

const modelBinding = Object.freeze({
  modelId: "actestra.test.model",
  invokeModel,
}) satisfies ActestraCodingModelBinding;

const linuxArtifact = Object.freeze({
  ...artifact,
  directory: GOOSE_LINUX_ARTIFACT_DIRECTORY,
  executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
  targetTriple: GOOSE_LINUX_TARGET_TRIPLE,
  manifestPath: `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.manifest.json`,
  linuxInstall: Object.freeze({
    contractVersion: 1 as const,
    resourcesPath: GOOSE_LINUX_RESOURCES_PATH,
    executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
    runnerManifestSha256: artifact.manifestSha256,
    executableSha256: artifact.executableSha256,
    profileSha256: "c".repeat(64),
  }),
}) satisfies AdmittedGooseRunnerArtifact;

const linuxPackage = Object.freeze({
  resourcesPath: GOOSE_LINUX_RESOURCES_PATH,
  profilePath: `${GOOSE_LINUX_RESOURCES_PATH}/${GOOSE_LINUX_PROFILE_FILE}`,
  recordPath: `${GOOSE_LINUX_RESOURCES_PATH}/${GOOSE_LINUX_ADMISSION_RECORD_FILE}`,
  runnerAdmission: Object.freeze({
    directory: GOOSE_LINUX_ARTIFACT_DIRECTORY,
    trustedManifestSha256: linuxArtifact.manifestSha256,
    expectedTargetTriple: GOOSE_LINUX_TARGET_TRIPLE,
  }),
  artifact: linuxArtifact,
  record: Object.freeze({
    contractVersion: 1 as const,
    targetTriple: GOOSE_LINUX_TARGET_TRIPLE,
    runnerManifestSha256: linuxArtifact.manifestSha256,
    executableSha256: linuxArtifact.executableSha256,
    profileSha256: "c".repeat(64),
    profileName: "Actestra-Goose-Runner" as const,
    executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
  }),
  executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
  bootstrapMarker: "ACTESTRA_GOOSE_LINUX_BOOTSTRAP_OK" as const,
}) satisfies AdmittedGooseRunnerLinuxPackage;

function dependencies(
  admitRunnerArtifact: ActestraCodingJourneyRuntimeDependencies["admitRunnerArtifact"],
): ActestraCodingJourneyRuntimeDependencies {
  return { admitRunnerArtifact };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function profileRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "actestra-coding-runtime-")));
  roots.push(root);
  return root;
}

describe("trusted Actestra coding journey runtime startup", () => {
  it.runIf(
    realArtifactDirectory !== undefined &&
      realManifestSha256 !== undefined &&
      realTargetTriple !== undefined,
  )("admits the real Goose artifact through the startup factory", async () => {
    const userDataPath = await profileRoot();
    const runtime = await startTrustedActestraCodingJourneyRuntime({
      userDataPath,
      runnerAdmission: {
        directory: realArtifactDirectory!,
        trustedManifestSha256: realManifestSha256!,
        expectedTargetTriple: realTargetTriple!,
      },
      modelBinding,
    });

    expect(runtime).not.toBeNull();
    expect(runtime!.admittedArtifact.directory).toBe(await realpath(realArtifactDirectory!));
    expect(runtime!.admittedArtifact.manifestSha256).toBe(realManifestSha256);
    expect(runtime!.admittedArtifact.targetTriple).toBe(realTargetTriple);
  });

  it("resolves only a complete Main-owned runner trust root from process configuration", () => {
    expect(resolveTrustedActestraCodingRunnerAdmission({})).toBeNull();
    expect(
      resolveTrustedActestraCodingRunnerAdmission({
        ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY: ` ${artifact.directory} `,
        ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: ` ${artifact.manifestSha256} `,
        ACTESTRA_GOOSE_RUNNER_TARGET_TRIPLE: ` ${artifact.targetTriple} `,
      }),
    ).toEqual(runnerAdmission);
    expect(
      Object.isFrozen(
        resolveTrustedActestraCodingRunnerAdmission({
          ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY: artifact.directory,
          ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: artifact.manifestSha256,
          ACTESTRA_GOOSE_RUNNER_TARGET_TRIPLE: artifact.targetTriple,
        }),
      ),
    ).toBe(true);
  });

  it("fails closed before runner admission when the Main-owned model binding is absent", async () => {
    const userDataPath = await profileRoot();
    const admitRunnerArtifact = vi.fn(async () => artifact);

    await expect(
      startTrustedActestraCodingJourneyRuntime(
        { userDataPath, runnerAdmission, modelBinding: null },
        dependencies(admitRunnerArtifact),
      ),
    ).resolves.toBeNull();
    expect(admitRunnerArtifact).not.toHaveBeenCalled();
  });

  it("admits the runner and returns a frozen private root plus fixed real Git registries", async () => {
    const userDataPath = await profileRoot();
    const admitRunnerArtifact = vi.fn(async () => artifact);

    const runtime = await startTrustedActestraCodingJourneyRuntime(
      { userDataPath, runnerAdmission, modelBinding },
      dependencies(admitRunnerArtifact),
    );

    expect(runtime).not.toBeNull();
    expect(admitRunnerArtifact).toHaveBeenCalledOnce();
    expect(admitRunnerArtifact).toHaveBeenCalledWith(artifact.directory, {
      trustedManifestSha256: artifact.manifestSha256,
      expectedTargetTriple: artifact.targetTriple,
    });
    expect(runtime!.admittedArtifact).toBe(artifact);
    expect(runtime!.modelId).toBe(modelBinding.modelId);
    expect(runtime!.modelInvoker).toBe(invokeModel);
    expect(runtime!.privateRootParent).toBe(path.join(userDataPath, "goose-private"));
    expect(await realpath(runtime!.privateRootParent)).toBe(runtime!.privateRootParent);
    expect((await stat(runtime!.privateRootParent)).mode & 0o777).toBe(0o700);
    expect(runtime!.privateRootParent.startsWith(`${userDataPath}${path.sep}`)).toBe(true);

    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime!.commands)).toBe(true);
    expect(Object.isFrozen(runtime!.tests)).toBe(true);
    expect(runtime!.commands).toEqual({
      "git.status": Object.freeze({
        executablePath: GIT_EXECUTABLE,
        args: ["status", "--short", "--branch"],
      }),
    });
    expect(runtime!.tests).toEqual({
      "git.diff-check": Object.freeze({
        executablePath: GIT_EXECUTABLE,
        args: ["diff", "--check"],
      }),
    });
    expect(Object.isFrozen(runtime!.commands["git.status"])).toBe(true);
    expect(Object.isFrozen(runtime!.commands["git.status"]!.args)).toBe(true);
  });

  it("uses only the Electron-owned fixed Linux package and ignores environment runner admission", async () => {
    const userDataPath = await profileRoot();
    const admitRunnerArtifact = vi.fn(async () => artifact);
    const admitLinuxPackage = vi.fn(async () => linuxPackage);

    const runtime = await startTrustedActestraCodingJourneyRuntime(
      {
        userDataPath,
        runnerAdmission,
        linuxPackageResourcesPath: GOOSE_LINUX_RESOURCES_PATH,
        modelBinding,
      },
      {
        admitRunnerArtifact,
        admitLinuxPackage,
        platform: "linux",
      },
    );

    expect(runtime).not.toBeNull();
    expect(admitLinuxPackage).toHaveBeenCalledWith(GOOSE_LINUX_RESOURCES_PATH);
    expect(admitRunnerArtifact).not.toHaveBeenCalled();
    expect(runtime!.linuxPackage).toBe(linuxPackage);
    expect(runtime!.runnerAdmission.directory).toBe(GOOSE_LINUX_ARTIFACT_DIRECTORY);
    expect(runtime!.revalidateArtifact).toBeTypeOf("function");
    await expect(runtime!.revalidateArtifact!()).resolves.toBe(linuxArtifact);
    expect(admitLinuxPackage).toHaveBeenCalledTimes(2);
  });

  it("uses the Electron-owned packaged resources on Darwin and ignores environment runner admission", async () => {
    const userDataPath = await profileRoot();
    const packagedResourcesPath = path.join(userDataPath, "Resources");
    const packageSourceCommit = "c".repeat(40);
    const attestation = Object.freeze({
      contractVersion: 1 as const,
      targetTriple: artifact.targetTriple,
      sourceCommit: packageSourceCommit,
      runnerManifestSha256: artifact.manifestSha256,
      executableSha256: artifact.executableSha256,
      executableFile: "actestra-goose-runner",
      runnerDirectory: "actestra-goose-runner" as const,
      files: Object.freeze([
        "actestra-goose-runner/GOOSE-APACHE-2.0.txt",
        "actestra-goose-runner/Cargo.lock",
        "actestra-goose-runner/actestra-goose-runner",
        "actestra-goose-runner/actestra-goose-runner.audit.json",
        "actestra-goose-runner/actestra-goose-runner.cdx.json",
        "actestra-goose-runner/actestra-goose-runner.manifest.json",
      ]),
    });
    const packaged = Object.freeze({
      resourcesPath: packagedResourcesPath,
      runnerDirectory: artifact.directory,
      attestationPath: path.join(packagedResourcesPath, "actestra-goose-runner-package.json"),
      sourceCommit: packageSourceCommit,
      runnerAdmission,
      attestation,
      artifact,
    }) satisfies AdmittedGooseRunnerPackage;
    const admitPackagedRunnerPackage = vi.fn(async () => packaged);
    const admitRunnerArtifact = vi.fn(async () => artifact);

    const runtime = await startTrustedActestraCodingJourneyRuntime(
      {
        userDataPath,
        runnerAdmission,
        packagedResourcesPath,
        modelBinding,
      },
      {
        admitRunnerArtifact,
        admitPackagedRunnerPackage,
        platform: "darwin",
        architecture: "arm64",
      },
    );

    expect(runtime).not.toBeNull();
    expect(admitPackagedRunnerPackage).toHaveBeenCalledWith(packagedResourcesPath, {
      expectedTargetTriple: "aarch64-apple-darwin",
    });
    expect(admitRunnerArtifact).not.toHaveBeenCalled();
    expect(runtime!.admittedArtifact).toBe(artifact);
    expect(runtime!.runnerAdmission).toEqual(runnerAdmission);
    expect(runtime!.revalidateArtifact).toBeTypeOf("function");
    await expect(runtime!.revalidateArtifact!()).resolves.toBe(artifact);
    expect(admitPackagedRunnerPackage).toHaveBeenCalledTimes(2);
  });

  it("fails before creating goose-private when the fixed Linux package is unavailable", async () => {
    const userDataPath = await profileRoot();
    const admitLinuxPackage = vi.fn(async () => null);
    const onFailure = vi.fn();

    await expect(
      startTrustedActestraCodingJourneyRuntime(
        {
          userDataPath,
          runnerAdmission,
          linuxPackageResourcesPath: GOOSE_LINUX_RESOURCES_PATH,
          modelBinding,
          onFailure,
        },
        {
          admitRunnerArtifact: vi.fn(async () => artifact),
          admitLinuxPackage,
          platform: "linux",
        },
      ),
    ).resolves.toBeNull();
    expect(await readdir(userDataPath)).not.toContain("goose-private");
    expect(onFailure).toHaveBeenCalledWith("runner-package");
  });

  it("fails closed for symlinked profiles, malformed model bindings, and runner admission failures", async () => {
    const target = await profileRoot();
    const link = path.join(path.dirname(target), "actestra-coding-runtime-link");
    await symlink(target, link);
    roots.push(link);
    const admitRunnerArtifact = vi.fn(async () => artifact);

    await expect(
      startTrustedActestraCodingJourneyRuntime(
        {
          userDataPath: link,
          runnerAdmission,
          modelBinding,
        },
        dependencies(admitRunnerArtifact),
      ),
    ).resolves.toBeNull();
    expect(admitRunnerArtifact).not.toHaveBeenCalled();

    await expect(
      startTrustedActestraCodingJourneyRuntime(
        {
          userDataPath: target,
          runnerAdmission,
          modelBinding: { modelId: "", invokeModel } as ActestraCodingModelBinding,
        },
        dependencies(admitRunnerArtifact),
      ),
    ).resolves.toBeNull();
    expect(admitRunnerArtifact).not.toHaveBeenCalled();

    const failedAdmission = vi.fn(async () => {
      throw new Error("runner admission failed");
    });
    await expect(
      startTrustedActestraCodingJourneyRuntime(
        { userDataPath: target, runnerAdmission, modelBinding },
        dependencies(failedAdmission),
      ),
    ).resolves.toBeNull();
  });
});
