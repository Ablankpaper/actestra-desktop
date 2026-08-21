import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GOOSE_WORKER_RESOURCE_PROFILE } from "../../apps/desktop/src/core/workerResourceBudget";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  GOOSE_NATIVE_NETWORK_POLICY_FAILURE_MARKER,
  GOOSE_NATIVE_RESOURCE_LIMIT_FAILURE_MARKER,
  GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES,
  GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES,
  GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES,
  GOOSE_WINDOWS_MODEL_PROGRESS_STAGES,
  GooseRunnerProcessError,
  assertGooseAcpSpawnOptions,
  createGooseWindowsCapabilityProgressMatcher,
  createGooseWindowsModelProgressMatcher,
  createGooseRunnerEnvironment,
  createGooseRunnerSetupFailureMatcher,
  createGooseRunnerResourceFailureMatcher,
  openGooseRunnerHandshake,
  type GooseAcpSpawnOptions,
} from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import {
  createGooseWindowsCapabilityProgress,
  createGooseWindowsModelProgress,
} from "../../apps/desktop/src/main/workers/gooseSessionTransport";
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
    executableAuthority: "attempt-private",
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

class NativeNetworkFailureTransport extends LoopbackGooseAcpTransport {
  override sendLine(): void {
    queueMicrotask(() => {
      this.emitError(
        new GooseRunnerProcessError(
          "network-policy-unavailable",
          "Goose native network policy is unavailable",
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

  it("requires the exact immutable Windows supervisor contract before spawn", () => {
    const root = path.resolve(os.tmpdir(), "actestra-goose-windows-options");
    const attemptLease = "lease_0123456789abcdef0123456789abcdef";
    const modelAttemptLease = "model_0123456789abcdef0123456789abcdef";
    const windows = Object.freeze({
      supervisorMode: "--actestra-windows-supervisor-v1" as const,
      attemptLease,
      modelAttemptLease,
      attemptId: "0123456789abcdef0123456789abcdef",
      executableSha256: "a".repeat(64),
      modelId: "test-model",
      targetTriple: "x86_64-pc-windows-msvc" as const,
    });
    const exact = Object.freeze({
      ...exactSpawnOptions(root),
      executableAuthority: "windows-supervisor" as const,
      windows,
    });

    expect(() => assertGooseAcpSpawnOptions(exact)).not.toThrow();
    for (const invalid of [
      Object.freeze({ ...exact, windows: undefined }),
      Object.freeze({
        ...exact,
        networkPolicy: Object.freeze({
          kind: "loopback-session" as const,
          host: "127.0.0.1" as const,
          capabilityProxyPort: 41_001,
          modelProxyPort: 41_002,
        }),
      }),
      Object.freeze({ ...exact, windows: { ...windows } }),
      Object.freeze({
        ...exact,
        windows: Object.freeze({ ...windows, modelAttemptLease: attemptLease }),
      }),
      Object.freeze({
        ...exact,
        environment: Object.freeze({ ...exact.environment, OPENAI_API_KEY: attemptLease }),
      }),
      Object.freeze({
        ...exact,
        environment: Object.freeze({ ...exact.environment, OPENAI_API_KEY: modelAttemptLease }),
      }),
    ]) {
      expect(() => assertGooseAcpSpawnOptions(invalid)).toThrowError(
        expect.objectContaining({
          name: "GooseRunnerProcessError",
          code: "network-policy-unavailable",
        }),
      );
    }
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

  it("maps the Linux bridge setup marker to network-policy-unavailable, never spawn-failed", () => {
    const matcher = createGooseRunnerSetupFailureMatcher();
    const split = Math.floor(GOOSE_NATIVE_NETWORK_POLICY_FAILURE_MARKER.length / 2);

    expect(
      matcher.push(
        Buffer.from(`ignored:${GOOSE_NATIVE_NETWORK_POLICY_FAILURE_MARKER.slice(0, split)}`),
      ),
    ).toBeUndefined();
    const code = matcher.push(
      Buffer.from(`${GOOSE_NATIVE_NETWORK_POLICY_FAILURE_MARKER.slice(split)}:ignored`),
    );
    expect(code).toBe("network-policy-unavailable");
    expect(code).not.toBe("spawn-failed");
    expect(Object.keys(matcher)).toEqual(["push"]);
  });

  it.each([
    ["ACTESTRA_GOOSE_ASYNC_RUNTIME_SETUP_FAILED", "runner-runtime"],
    ["ACTESTRA_GOOSE_ACP_SERVER_FAILED", "runner-acp"],
    ["ACTESTRA_GOOSE_LINUX_RELAY_STOPPED", "runner-relay"],
    ["ACTESTRA_GOOSE_RUNNER_PANICKED", "runner-panic"],
  ])("maps the fixed %s marker without retaining stderr", (marker, expected) => {
    const matcher = createGooseRunnerSetupFailureMatcher();
    const split = Math.floor(marker.length / 2);

    expect(matcher.push(Buffer.from(`ignored:${marker.slice(0, split)}`))).toBeUndefined();
    expect(matcher.push(Buffer.from(`${marker.slice(split)}:ignored`))).toBe(expected);
    expect(Object.keys(matcher)).toEqual(["push"]);
  });

  it("extracts only the eight bounded Windows capability progress stages across stderr chunks", () => {
    const progress = createGooseWindowsCapabilityProgress();
    const matcher = createGooseWindowsCapabilityProgressMatcher();
    const marker = (stage: string): string =>
      `Goose windows capability progress at bounded stage ${stage}`;

    expect(
      matcher.push(
        Buffer.from(`ignored:${marker(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[0]).slice(0, 31)}`),
      ),
    ).toEqual([]);
    for (const stage of matcher.push(
      Buffer.from(
        `${marker(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[0]).slice(31)}\n` +
          `${marker(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[3])}\nC:\\private\\ignored`,
      ),
    )) {
      progress.record(stage);
    }
    progress.record(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[0]);

    expect(progress.snapshot()).toEqual([
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[0],
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[3],
    ]);
    expect(Object.isFrozen(progress.snapshot())).toBe(true);
    expect(JSON.stringify(progress.snapshot())).not.toContain("private");
    expect(Object.keys(matcher)).toEqual(["push"]);
    expect(Object.keys(progress)).toEqual(["record", "snapshot"]);
  });

  it("extracts only the ten bounded Windows model progress stages across stderr chunks", () => {
    const progress = createGooseWindowsModelProgress();
    const matcher = createGooseWindowsModelProgressMatcher();
    const marker = (stage: string): string =>
      `Goose windows model progress at bounded stage ${stage}`;

    expect(
      matcher.push(
        Buffer.from(`ignored:${marker(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[0]).slice(0, 27)}`),
      ),
    ).toEqual([]);
    for (const stage of matcher.push(
      Buffer.from(
        `${marker(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[0]).slice(27)}\n` +
          `${marker(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[6])}\nC:\\private\\ignored`,
      ),
    )) {
      progress.record(stage);
    }

    expect(progress.snapshot()).toEqual([
      GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[0],
      GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[6],
    ]);
    expect(matcher.push(Buffer.from("windows-model-unbounded-private-stage"))).toEqual([]);
  });

  it("extracts bounded tool-call progress and Main invocation failure stages", () => {
    const matcher = createGooseWindowsCapabilityProgressMatcher();
    const marker = (stage: string): string =>
      `Goose windows capability progress at bounded stage ${stage}`;
    const observed = matcher.push(
      Buffer.from(
        `${marker(GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[0])}\n` +
          `${marker(GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES[0])}\n`,
      ),
    );
    expect(observed).toEqual([
      GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[0],
      GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES[0],
    ]);
    expect(JSON.stringify(observed)).not.toContain("private");
  });

  it.each([
    "windows-control-channel-invalid",
    "windows-ready-channel-invalid",
    "windows-capability-channel-invalid",
    "windows-model-channel-invalid",
    "windows-acp-relay-failed",
    "windows-capability-relay-failed",
    "windows-model-relay-failed",
    "windows-worker-runtime-failed",
    "windows-runtime-timeout",
    "windows-runtime-cleanup-failed",
  ])("maps the closed Windows stage %s without retaining stderr", (stage) => {
    const matcher = createGooseRunnerSetupFailureMatcher();
    const marker = `Goose windows containment failed at bounded stage ${stage}`;
    const split = Math.floor(marker.length / 2);

    expect(matcher.push(Buffer.from(marker.slice(0, split)))).toBeUndefined();
    expect(matcher.push(Buffer.from(marker.slice(split)))).toBe(stage);
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

  it("preserves native bridge setup failure as the closed network incident code", async () => {
    const fixture = await createRunnerFixture();

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => new NativeNetworkFailureTransport(),
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "network-policy-unavailable",
    });
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });
});
