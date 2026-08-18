import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GOOSE_WORKER_RESOURCE_PROFILE } from "../../apps/desktop/src/core/workerResourceBudget";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import * as gooseRunnerProcess from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import {
  createGooseRunnerEnvironment,
  createNodeGooseAcpTransport,
  encodeWindowsSupervisorControlFrame,
  openGooseRunnerHandshake,
  resolveGooseAcpLaunchCommand,
  type GooseAcpSpawnOptions,
} from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import { LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

const fixtureDirectories: string[] = [];
const WINDOWS_TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const SOURCE_COMMIT = "a".repeat(40);
const PROBE_SHA256 = "b".repeat(64);

function fixtureTempDirectory(prefix: string): string {
  // Unix-domain socket paths are bounded to 103 bytes by the production
  // bridge validator. Keep macOS fixtures short while retaining a native
  // Windows temp root (where /tmp is not a usable filesystem path). GitHub's
  // checkout path is long enough to invalidate the fixture socket, so prefer
  // its dedicated short runner temp root when available.
  const windowsRoot = process.env.RUNNER_TEMP;
  const root =
    process.platform === "win32"
      ? windowsRoot !== undefined && path.isAbsolute(windowsRoot)
        ? windowsRoot
        : os.tmpdir()
      : "/tmp";
  return path.join(root, prefix);
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readFile(filePath).catch((): undefined => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("fixture process did not write its launch evidence");
}

async function createWindowsArtifact(options: { readonly containment?: boolean } = {}): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly workspaceDirectory: string;
}> {
  const directory = await mkdtemp(fixtureTempDirectory("actestra-goose-windows-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  const workspaceDirectory = path.join(directory, "workspace");
  await Promise.all([
    mkdir(artifactDirectory),
    mkdir(privateRootParent),
    mkdir(workspaceDirectory),
  ]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner.exe");
  const executable = Buffer.from("fixture-windows-goose-runner", "utf8");
  await writeFile(executablePath, executable);
  await chmod(executablePath, 0o755);
  const executableSha256 = createHash("sha256").update(executable).digest("hex");
  const artifact = {
    directory: artifactDirectory,
    executablePath,
    executableSha256,
    executableSize: executable.byteLength,
    targetTriple: WINDOWS_TARGET_TRIPLE,
    sourceCommit: SOURCE_COMMIT,
    gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
    gooseVersion: "1.45.0",
    manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
    manifestSha256: "1".repeat(64),
    ...(options.containment === true
      ? {
          containment: Object.freeze({
            contractVersion: 1,
            targetTriple: WINDOWS_TARGET_TRIPLE,
            sourceCommit: SOURCE_COMMIT,
            probeSha256: PROBE_SHA256,
            executableSha256,
            filesystem: true,
            network: true,
            processTree: true,
            resources: true,
            parentDeath: true,
            cleanup: true,
          }),
        }
      : {}),
  } satisfies AdmittedGooseRunnerArtifact;
  return { artifact: Object.freeze(artifact), privateRootParent, workspaceDirectory };
}

afterEach(async () => {
  await Promise.all(
    fixtureDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Windows Goose runner bridge contract", () => {
  it("encodes the one-shot Windows control contract only in a bounded length-prefixed frame", () => {
    const encode = (
      gooseRunnerProcess as unknown as {
        readonly encodeWindowsSupervisorControlFrame?: (
          options: GooseAcpSpawnOptions,
        ) => Uint8Array;
      }
    ).encodeWindowsSupervisorControlFrame;
    expect(typeof encode).toBe("function");
    if (encode === undefined) return;

    const privateRoot = path.resolve("/tmp/actestra-goose-windows-control");
    const options: GooseAcpSpawnOptions = Object.freeze({
      executablePath: path.join(privateRoot, "bin", "actestra-goose-runner.exe"),
      executableAuthority: "windows-supervisor",
      workingDirectory: path.join(privateRoot, "work"),
      workspaceDirectory: path.resolve("/tmp/actestra-goose-windows-workspace"),
      environment: createGooseRunnerEnvironment(privateRoot),
      resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
      networkPolicy: "deny-all",
      windows: Object.freeze({
        supervisorMode: "--actestra-windows-supervisor-v1",
        capabilityPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability`,
        modelPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model`,
        attemptLease: "lease_0123456789abcdef0123456789abcdef",
        attemptId: "0123456789abcdef0123456789abcdef",
        executableSha256: "a".repeat(64),
        modelId: "test-model",
        targetTriple: WINDOWS_TARGET_TRIPLE,
      }),
    });

    const frame = Buffer.from(encode(options));
    const payloadLength = frame.readUInt32LE(0);
    expect(payloadLength).toBe(frame.byteLength - 4);
    expect(payloadLength).toBeLessThanOrEqual(32 * 1024);
    const payload = JSON.parse(frame.subarray(4).toString("utf8"));
    expect(Object.keys(payload).sort()).toEqual([
      "attemptId",
      "attemptLease",
      "contractVersion",
      "executableSha256",
      "modelId",
      "privateRoot",
      "resourceBudget",
      "targetTriple",
      "worktreeRoot",
    ]);
    expect(payload).toMatchObject({
      attemptId: options.windows?.attemptId,
      attemptLease: options.windows?.attemptLease,
      contractVersion: 1,
      executableSha256: options.windows?.executableSha256,
      modelId: options.windows?.modelId,
      privateRoot,
      resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
      targetTriple: WINDOWS_TARGET_TRIPLE,
      worktreeRoot: options.workspaceDirectory,
    });
    expect(frame.toString("utf8")).not.toContain(options.windows?.capabilityPipeName);
    expect(frame.toString("utf8")).not.toContain(options.windows?.modelPipeName);
  });

  it("resolves only the admitted executable with the fixed Windows supervisor argument", () => {
    const privateRoot = path.resolve("/tmp/actestra-goose-windows-launch");
    const options: GooseAcpSpawnOptions = Object.freeze({
      executablePath: path.join(privateRoot, "bin", "actestra-goose-runner.exe"),
      executableAuthority: "windows-supervisor",
      workingDirectory: path.join(privateRoot, "work"),
      workspaceDirectory: path.resolve("/tmp/actestra-goose-windows-workspace"),
      environment: createGooseRunnerEnvironment(privateRoot),
      resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
      networkPolicy: "deny-all",
      windows: Object.freeze({
        supervisorMode: "--actestra-windows-supervisor-v1",
        capabilityPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability`,
        modelPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model`,
        attemptLease: "lease_0123456789abcdef0123456789abcdef",
        attemptId: "0123456789abcdef0123456789abcdef",
        executableSha256: "a".repeat(64),
        modelId: "test-model",
        targetTriple: WINDOWS_TARGET_TRIPLE,
      }),
    });

    expect(
      resolveGooseAcpLaunchCommand(options, { platform: "win32", architecture: "x64" }),
    ).toEqual({
      command: options.executablePath,
      arguments: ["--actestra-windows-supervisor-v1"],
    });
  });

  it.skipIf(process.platform === "win32")(
    "writes the bounded control frame to a dedicated inherited channel and keeps parent liveness separate",
    async () => {
      const privateRoot = await mkdtemp(fixtureTempDirectory("actestra-goose-windows-spawn-"));
      fixtureDirectories.push(privateRoot);
      const binDirectory = path.join(privateRoot, "bin");
      const workingDirectory = path.join(privateRoot, "work");
      const workspaceDirectory = path.join(privateRoot, "workspace");
      await Promise.all([mkdir(binDirectory), mkdir(workingDirectory), mkdir(workspaceDirectory)]);
      const executablePath = path.join(binDirectory, "actestra-goose-runner.exe");
      const controlPath = path.join(workingDirectory, "control-frame.bin");
      const launchEvidencePath = path.join(workingDirectory, "launch-evidence.txt");
      await writeFile(
        executablePath,
        [
          "#!/bin/sh",
          "set -eu",
          'cat <&3 > "control-frame.bin"',
          'if [ "${ACTESTRA_ENVIRONMENT_CANARY+x}" = x ]; then canary=present; else canary=absent; fi',
          "if [ -e /dev/fd/4 ]; then liveness=present; else liveness=missing; fi",
          'printf "%s|%s|%s|%s\\n" "$1" "${ACTESTRA_WINDOWS_CONTROL_FD:-missing}" "$canary" "$liveness" > "launch-evidence.txt"',
          "cat >/dev/null",
        ].join("\n"),
      );
      await chmod(executablePath, 0o700);
      const options: GooseAcpSpawnOptions = Object.freeze({
        executablePath,
        executableAuthority: "windows-supervisor",
        workingDirectory,
        workspaceDirectory,
        environment: createGooseRunnerEnvironment(privateRoot),
        resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
        networkPolicy: "deny-all",
        windows: Object.freeze({
          supervisorMode: "--actestra-windows-supervisor-v1",
          capabilityPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability`,
          modelPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model`,
          attemptLease: "lease_0123456789abcdef0123456789abcdef",
          attemptId: "0123456789abcdef0123456789abcdef",
          executableSha256: "a".repeat(64),
          modelId: "test-model",
          targetTriple: WINDOWS_TARGET_TRIPLE,
        }),
      });
      const previousCanary = process.env.ACTESTRA_ENVIRONMENT_CANARY;
      process.env.ACTESTRA_ENVIRONMENT_CANARY = "parent-canary-must-not-cross";
      const transport = createNodeGooseAcpTransport(options, {
        platform: "win32",
        architecture: "x64",
      });
      try {
        const [controlFrame, launchEvidence] = await Promise.all([
          waitForFile(controlPath),
          waitForFile(launchEvidencePath),
        ]);
        expect(controlFrame).toEqual(Buffer.from(encodeWindowsSupervisorControlFrame(options)));
        expect(launchEvidence.toString("utf8").trim()).toBe(
          "--actestra-windows-supervisor-v1|missing|absent|present",
        );
      } finally {
        if (previousCanary === undefined) {
          delete process.env.ACTESTRA_ENVIRONMENT_CANARY;
        } else {
          process.env.ACTESTRA_ENVIRONMENT_CANARY = previousCanary;
        }
        await transport.close().catch(() => undefined);
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "reaches the fail-closed post-spawn marker through the real emitted Windows artifact",
    async () => {
      const sourceExecutable = path.resolve(
        ".actestra",
        "goose-runner",
        WINDOWS_TARGET_TRIPLE,
        "actestra-goose-runner.exe",
      );
      const privateRoot = await mkdtemp(
        path.join(process.env.RUNNER_TEMP ?? process.cwd(), "actestra-goose-windows-native-"),
      );
      fixtureDirectories.push(privateRoot);
      const binDirectory = path.join(privateRoot, "bin");
      const workingDirectory = path.join(privateRoot, "work");
      const workspaceDirectory = path.join(privateRoot, "workspace");
      await Promise.all([mkdir(binDirectory), mkdir(workingDirectory), mkdir(workspaceDirectory)]);
      const executablePath = path.join(binDirectory, "actestra-goose-runner.exe");
      await copyFile(sourceExecutable, executablePath);
      const executableSha256 = createHash("sha256")
        .update(await readFile(executablePath))
        .digest("hex");
      const options: GooseAcpSpawnOptions = Object.freeze({
        executablePath,
        executableAuthority: "windows-supervisor",
        workingDirectory,
        workspaceDirectory,
        environment: createGooseRunnerEnvironment(privateRoot),
        resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
        networkPolicy: "deny-all",
        windows: Object.freeze({
          supervisorMode: "--actestra-windows-supervisor-v1",
          capabilityPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability`,
          modelPipeName: String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model`,
          attemptLease: "lease_0123456789abcdef0123456789abcdef",
          attemptId: "0123456789abcdef0123456789abcdef",
          executableSha256,
          modelId: "test-model",
          targetTriple: WINDOWS_TARGET_TRIPLE,
        }),
      });

      const previousCanary = process.env.ACTESTRA_ENVIRONMENT_CANARY;
      process.env.ACTESTRA_ENVIRONMENT_CANARY = "parent-canary-must-not-cross";
      const transport = createNodeGooseAcpTransport(options, {
        platform: "win32",
        architecture: "x64",
      });
      try {
        const outcome = await new Promise<{
          readonly error: Error;
          readonly exitCode: number | null;
          readonly signal: string | null;
        }>((resolve, reject) => {
          let failure: Error | undefined;
          let exitObserved = false;
          let exitCode: number | null = null;
          let signal: string | null = null;
          const timeout = setTimeout(
            () => reject(new Error("Windows supervisor spawn probe timed out")),
            15_000,
          );
          timeout.unref();
          const resolveWhenComplete = (): void => {
            if (failure === undefined || !exitObserved) return;
            clearTimeout(timeout);
            resolve({ error: failure, exitCode, signal });
          };
          transport.onError((error) => {
            failure ??= error;
            resolveWhenComplete();
          });
          transport.onExit((code, exitSignal) => {
            exitObserved = true;
            exitCode = code;
            signal = exitSignal;
            resolveWhenComplete();
            if (failure === undefined) {
              setTimeout(() => {
                clearTimeout(timeout);
                reject(new Error("Windows supervisor exited without a classified marker"));
              }, 50).unref();
            }
          });
        });
        const classification =
          outcome.error instanceof gooseRunnerProcess.GooseRunnerProcessError
            ? outcome.error.code
            : "unclassified";
        console.info(
          `WINDOWS_SUPERVISOR_ARTIFACT_DIAGNOSTIC classification=${classification} exit_code=${outcome.exitCode ?? "null"} signal=${outcome.signal === null ? "none" : "present"}`,
        );
        expect(outcome.error).toMatchObject({
          name: "GooseRunnerProcessError",
          code: "worker-resource-enforcement-unavailable",
        });
      } finally {
        if (previousCanary === undefined) {
          delete process.env.ACTESTRA_ENVIRONMENT_CANARY;
        } else {
          process.env.ACTESTRA_ENVIRONMENT_CANARY = previousCanary;
        }
        await transport.close().catch(() => undefined);
      }
    },
    30_000,
  );

  it("rejects a Windows artifact without exact containment evidence before transport creation", async () => {
    const fixture = await createWindowsArtifact();
    const transportFactory = vi.fn(() => new LoopbackGooseAcpTransport());

    await expect(
      openGooseRunnerHandshake(
        {
          artifact: fixture.artifact,
          privateRootParent: fixture.privateRootParent,
          workspaceDirectory: fixture.workspaceDirectory,
          capabilityProxyUrl: "http://127.0.0.1:41001/mcp",
          modelBinding: {
            baseUrl: "http://127.0.0.1:41002/v1",
            modelId: "test-model",
            attemptLease: "a".repeat(32),
          },
          transportFactory,
        },
        { platform: "win32", architecture: "x64" },
      ),
    ).rejects.toMatchObject({
      code: "network-policy-unavailable",
      message: "The admitted Goose artifact lacks exact native containment evidence",
    });
    expect(transportFactory).not.toHaveBeenCalled();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("rejects direct loopback on Windows even with verified containment evidence", async () => {
    const fixture = await createWindowsArtifact({ containment: true });
    const transportFactory = vi.fn(() => new LoopbackGooseAcpTransport());

    await expect(
      openGooseRunnerHandshake(
        {
          artifact: fixture.artifact,
          privateRootParent: fixture.privateRootParent,
          workspaceDirectory: fixture.workspaceDirectory,
          capabilityProxyUrl: "http://127.0.0.1:41001/mcp",
          modelBinding: {
            baseUrl: "http://127.0.0.1:41002/v1",
            modelId: "test-model",
            attemptLease: "b".repeat(32),
          },
          transportFactory,
        },
        { platform: "win32", architecture: "x64" },
      ),
    ).rejects.toMatchObject({
      code: "network-policy-unavailable",
      message: "Windows Goose runtime requires the exact admitted named-pipe bridge contract",
    });
    expect(transportFactory).not.toHaveBeenCalled();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("rejects an old-style prepared bridge without Windows named-pipe metadata", async () => {
    const fixture = await createWindowsArtifact({ containment: true });
    const transportFactory = vi.fn(() => new LoopbackGooseAcpTransport());

    await expect(
      openGooseRunnerHandshake(
        {
          artifact: fixture.artifact,
          privateRootParent: fixture.privateRootParent,
          workspaceDirectory: fixture.workspaceDirectory,
          prepareBridge: async (root) =>
            Object.freeze({
              capabilityProxyUrl: "http://127.0.0.1:41001/mcp",
              modelBinding: Object.freeze({
                baseUrl: "http://127.0.0.1:41002/v1",
                modelId: "test-model",
                attemptLease: "c".repeat(32),
              }),
              capabilitySocketPath: path.join(root.bridgeDirectory, "capability.sock"),
              modelSocketPath: path.join(root.bridgeDirectory, "model.sock"),
              async close() {},
            }),
          transportFactory,
        },
        { platform: "win32", architecture: "x64" },
      ),
    ).rejects.toMatchObject({
      code: "network-policy-unavailable",
      message: "Windows Goose runtime requires the exact admitted named-pipe bridge contract",
    });
    expect(transportFactory).not.toHaveBeenCalled();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("hands the Windows supervisor only named-pipe metadata and a deny-all runner environment", async () => {
    const fixture = await createWindowsArtifact({ containment: true });
    const attemptLease = "lease_0123456789abcdef0123456789abcdef";
    const capabilityPipeName = String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.capability`;
    const modelPipeName = String.raw`\\.\pipe\LOCAL\Actestra.Goose.0123456789abcdef0123456789abcdef.model`;
    let spawnOptions: GooseAcpSpawnOptions | undefined;
    const transport = new LoopbackGooseAcpTransport();

    const opened = await openGooseRunnerHandshake(
      {
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        workspaceDirectory: fixture.workspaceDirectory,
        prepareBridge: async (root) =>
          Object.freeze({
            capabilityProxyUrl: "http://127.0.0.1:41001/mcp",
            modelBinding: Object.freeze({
              baseUrl: "http://127.0.0.1:41002/v1",
              modelId: "test-model",
              attemptLease,
            }),
            capabilitySocketPath: path.join(root.bridgeDirectory, "capability.sock"),
            modelSocketPath: path.join(root.bridgeDirectory, "model.sock"),
            windows: Object.freeze({ capabilityPipeName, modelPipeName, attemptLease }),
            async close() {},
          }),
        transportFactory: (options) => {
          spawnOptions = options;
          return transport;
        },
      },
      { platform: "win32", architecture: "x64" },
    );

    expect(spawnOptions?.executableAuthority).toBe("windows-supervisor");
    expect(spawnOptions?.networkPolicy).toBe("deny-all");
    expect(spawnOptions?.windows).toEqual({
      supervisorMode: "--actestra-windows-supervisor-v1",
      capabilityPipeName,
      modelPipeName,
      attemptLease,
      attemptId: "0123456789abcdef0123456789abcdef",
      executableSha256: fixture.artifact.executableSha256,
      modelId: "test-model",
      targetTriple: WINDOWS_TARGET_TRIPLE,
    });
    for (const forbiddenKey of [
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "GOOSE_MODEL",
      "GOOSE_PROVIDER",
      "NO_PROXY",
    ]) {
      expect(spawnOptions?.environment).not.toHaveProperty(forbiddenKey);
    }
    expect(Object.values(spawnOptions?.environment ?? {})).not.toContain(attemptLease);
    expect(Object.values(spawnOptions?.environment ?? {})).not.toContain(capabilityPipeName);
    expect(Object.values(spawnOptions?.environment ?? {})).not.toContain(modelPipeName);
    expect(spawnOptions?.environment.LOCALAPPDATA).toBe(
      path.join(opened.privateRoot, "local-app-data"),
    );
    expect(await readdir(opened.privateRoot)).toContain("local-app-data");

    await opened.close();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });
});
