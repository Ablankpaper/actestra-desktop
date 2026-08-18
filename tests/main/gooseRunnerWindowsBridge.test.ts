import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { openGooseRunnerHandshake } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import { LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

const fixtureDirectories: string[] = [];
const WINDOWS_TARGET_TRIPLE = "x86_64-pc-windows-msvc";
const SOURCE_COMMIT = "a".repeat(40);
const PROBE_SHA256 = "b".repeat(64);

async function createWindowsArtifact(options: { readonly containment?: boolean } = {}): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
  readonly workspaceDirectory: string;
}> {
  const directory = await mkdtemp(path.join("/tmp", "actestra-goose-windows-"));
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
});
