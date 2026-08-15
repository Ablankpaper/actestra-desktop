import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GOOSE_WORKER_RESOURCE_PROFILE } from "../../apps/desktop/src/core/workerResourceBudget";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER,
  GooseRunnerProcessError,
  assertGooseAcpSpawnOptions,
  createGooseRunnerEnvironment,
  createGooseRunnerResourceFailureMatcher,
  openGooseRunnerHandshake,
  type GooseAcpSpawnOptions,
} from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import { createGooseRunnerSandboxLaunch } from "../../apps/desktop/src/main/workers/gooseRunnerSandbox";
import { LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

const fixtureDirectories: string[] = [];
const fixtureTargetTriple = process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";

async function createRunnerFixture(): Promise<{
  readonly artifact: AdmittedGooseRunnerArtifact;
  readonly privateRootParent: string;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-resource-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const executable = Buffer.from("fixture-goose-runner", "utf8");
  await writeFile(executablePath, executable);
  await chmod(executablePath, 0o755);
  return {
    artifact: {
      directory: artifactDirectory,
      executablePath,
      executableSha256: createHash("sha256").update(executable).digest("hex"),
      executableSize: executable.byteLength,
      targetTriple: fixtureTargetTriple,
      gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
      gooseVersion: "1.45.0",
      manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
      manifestSha256: "1".repeat(64),
    },
    privateRootParent,
  };
}

function exactSpawnOptions(root: string): GooseAcpSpawnOptions {
  return Object.freeze({
    executablePath: path.join(root, "bin", "actestra-goose-runner"),
    workingDirectory: path.join(root, "work"),
    environment: createGooseRunnerEnvironment(root),
    networkPolicy: "deny-all",
    resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
  });
}

class NativeLimitFailureTransport extends LoopbackGooseAcpTransport {
  override sendLine(): void {
    queueMicrotask(() => {
      this.emitError(
        new GooseRunnerProcessError(
          "worker-resource-enforcement-unavailable",
          "Goose native resource enforcement is unavailable",
        ),
      );
    });
  }
}

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Goose runner native resource boundary", () => {
  it("carries the immutable fixed Goose budget and exact native limit environment", async () => {
    const fixture = await createRunnerFixture();
    let spawnOptions: GooseAcpSpawnOptions | undefined;
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      transportFactory: (options) => {
        spawnOptions = options;
        return new LoopbackGooseAcpTransport();
      },
    });

    expect(spawnOptions?.resourceBudget).toEqual(GOOSE_WORKER_RESOURCE_PROFILE);
    expect(Object.isFrozen(spawnOptions?.resourceBudget)).toBe(true);
    expect(spawnOptions?.environment).toMatchObject({
      ACTESTRA_GOOSE_CPU_SECONDS: "120",
      ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES: "1073741824",
    });
    expect(() => assertGooseAcpSpawnOptions(spawnOptions)).not.toThrow();

    await opened.close();
  });

  it("rejects missing, mutable, or widened limits before a process can spawn", () => {
    const root = path.resolve(os.tmpdir(), "actestra-goose-resource-options");
    const exact = exactSpawnOptions(root);
    expect(() => assertGooseAcpSpawnOptions(exact)).not.toThrow();

    expect(() =>
      assertGooseAcpSpawnOptions({
        ...exact,
        resourceBudget: { ...GOOSE_WORKER_RESOURCE_PROFILE },
      }),
    ).toThrowError(
      expect.objectContaining({ name: "GooseRunnerProcessError", code: "invalid-options" }),
    );

    expect(() =>
      assertGooseAcpSpawnOptions({
        ...exact,
        resourceBudget: Object.freeze({
          ...GOOSE_WORKER_RESOURCE_PROFILE,
          maxCpuSeconds: GOOSE_WORKER_RESOURCE_PROFILE.maxCpuSeconds + 1,
        }),
      }),
    ).toThrowError(
      expect.objectContaining({ name: "GooseRunnerProcessError", code: "invalid-options" }),
    );

    const { ACTESTRA_GOOSE_CPU_SECONDS: _removed, ...missingCpuEnvironment } = exact.environment;
    expect(() =>
      assertGooseAcpSpawnOptions(
        Object.freeze({
          ...exact,
          environment: Object.freeze(missingCpuEnvironment),
        }),
      ),
    ).toThrowError(
      expect.objectContaining({
        name: "GooseRunnerProcessError",
        code: "worker-resource-enforcement-unavailable",
      }),
    );
  });

  it("denies process fork and arbitrary exec while retaining only admitted launch and ports", () => {
    const root = path.resolve(os.tmpdir(), "actestra-goose-resource-sandbox");
    const executablePath = path.join(root, "bin", "actestra-goose-runner");
    const launch = createGooseRunnerSandboxLaunch({
      executablePath,
      privateRoot: root,
      networkPorts: [43_123, 43_124],
    });

    expect(launch.profile).toContain("(deny process-fork)");
    expect(launch.profile).toContain("(deny process-exec)");
    expect(launch.profile).toContain(`(allow process-exec (literal "${executablePath}"))`);
    expect(launch.profile).toContain('(allow network-outbound (remote ip "localhost:43123"))');
    expect(launch.profile).toContain('(allow network-outbound (remote ip "localhost:43124"))');
    expect(launch.profile).not.toContain("(allow process-fork)");
  });

  it("detects the stable native failure marker across stderr chunks without retaining stderr", () => {
    const matcher = createGooseRunnerResourceFailureMatcher();
    const split = Math.floor(GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER.length / 2);

    expect(
      matcher.push(
        Buffer.from(`ignored:${GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER.slice(0, split)}`),
      ),
    ).toBe(false);
    expect(
      matcher.push(
        Buffer.from(`${GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER.slice(split)}:ignored`),
      ),
    ).toBe(true);
    expect(Object.keys(matcher)).toEqual(["push"]);
  });

  it("preserves native limit setup failure as the closed resource incident code", async () => {
    const fixture = await createRunnerFixture();

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => new NativeLimitFailureTransport(),
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "worker-resource-enforcement-unavailable",
    });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });
});
