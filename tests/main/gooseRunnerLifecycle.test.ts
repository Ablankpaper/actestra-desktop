import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  createGooseRunnerEnvironment,
  openGooseRunnerHandshake,
  type GooseAcpSpawnOptions,
} from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import { EXPECTED_GOOSE_INITIALIZE_RESULT, LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

const fixtureDirectories: string[] = [];
const fixtureTargetTriple = process.arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";

class FailingCloseGooseAcpTransport extends LoopbackGooseAcpTransport {
  override async close(): Promise<void> {
    await super.close();
    throw new Error("injected transport close failure");
  }
}

async function createLifecycleFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-lifecycle-"));
  fixtureDirectories.push(directory);
  const artifactDirectory = path.join(directory, "artifact");
  const privateRootParent = path.join(directory, "attempts");
  const repository = path.join(directory, "repository");
  await Promise.all([mkdir(artifactDirectory), mkdir(privateRootParent), mkdir(repository)]);
  const executablePath = path.join(artifactDirectory, "actestra-goose-runner");
  const executable = Buffer.from("fixture-goose-runner", "utf8");
  await writeFile(executablePath, executable);
  await chmod(executablePath, 0o755);
  const artifact: AdmittedGooseRunnerArtifact = {
    directory: artifactDirectory,
    executablePath,
    executableSha256: createHash("sha256").update(executable).digest("hex"),
    executableSize: executable.byteLength,
    targetTriple: fixtureTargetTriple,
    gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
    gooseVersion: "1.45.0",
    manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
    manifestSha256: "1".repeat(64),
  };
  const sentinelPath = path.join(repository, "sentinel.txt");
  await writeFile(sentinelPath, "original checkout must remain unchanged");
  return { artifact, privateRootParent, repository, sentinelPath };
}

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Goose runner private lifecycle", () => {
  it("uses a closed environment without inheriting credentials or user configuration", () => {
    const root = path.resolve(os.tmpdir(), "actestra-goose-environment-fixture");
    expect(createGooseRunnerEnvironment(root)).toEqual({
      GOOSE_PATH_ROOT: root,
      GOOSE_TELEMETRY_OFF: "1",
      GOOSE_DISABLE_KEYRING: "1",
      GOOSE_DISABLE_SESSION_NAMING: "true",
      HOME: path.join(root, "home"),
      TMPDIR: path.join(root, "tmp"),
      TMP: path.join(root, "tmp"),
      TEMP: path.join(root, "tmp"),
      TZ: "UTC",
      OTEL_SDK_DISABLED: "true",
      OTEL_TRACES_EXPORTER: "none",
      OTEL_METRICS_EXPORTER: "none",
      OTEL_LOGS_EXPORTER: "none",
    });
  });

  it("binds the sandbox and closed environment to exact MCP and model loopback ports", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new LoopbackGooseAcpTransport();
    let spawnOptions: GooseAcpSpawnOptions | undefined;
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
      modelBinding: {
        baseUrl: "http://127.0.0.1:43124/v1",
        modelId: "actestra-loopback-model",
        attemptLease: "model-lease-0123456789abcdef0123456789abcdef",
      },
      transportFactory: (options) => {
        spawnOptions = options;
        return transport;
      },
    });

    expect(spawnOptions?.networkPolicy).toEqual({
      kind: "loopback-session",
      host: "127.0.0.1",
      capabilityProxyPort: 43_123,
      modelProxyPort: 43_124,
    });
    expect(spawnOptions?.environment).toMatchObject({
      GOOSE_PROVIDER: "openai",
      GOOSE_MODEL: "actestra-loopback-model",
      OPENAI_BASE_URL: "http://127.0.0.1:43124/v1",
      OPENAI_API_KEY: "model-lease-0123456789abcdef0123456789abcdef",
      NO_PROXY: "127.0.0.1,localhost",
    });
    await expect(
      opened.openSession({
        workspaceDirectory: fixture.repository,
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toMatchObject({ sessionId: "goose-session-1" });

    await opened.close();
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("rejects a runner built for another host before creating a private root", async () => {
    const fixture = await createLifecycleFixture();

    await expect(
      openGooseRunnerHandshake({
        artifact: {
          ...fixture.artifact,
          targetTriple:
            fixtureTargetTriple === "aarch64-apple-darwin"
              ? "x86_64-apple-darwin"
              : "aarch64-apple-darwin",
        },
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => new LoopbackGooseAcpTransport(),
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "network-policy-unavailable",
    });

    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("removes the private root after a version rejection without touching a repository", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new LoopbackGooseAcpTransport({
      initializeResult: {
        ...EXPECTED_GOOSE_INITIALIZE_RESULT,
        agentInfo: { name: "goose", version: "1.44.0" },
      },
    });
    let spawnOptions: GooseAcpSpawnOptions | undefined;

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        transportFactory: (options) => {
          spawnOptions = options;
          return transport;
        },
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpHandshakeError",
      code: "unsupported-version",
    });

    expect(transport.sentLines.map((line) => JSON.parse(line).method)).toEqual(["initialize"]);
    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
    expect(await readFile(fixture.sentinelPath, "utf8")).toBe(
      "original checkout must remain unchanged",
    );
    expect(spawnOptions?.networkPolicy).toBe("deny-all");
    expect(spawnOptions?.workingDirectory.startsWith(fixture.privateRootParent)).toBe(true);
    expect(spawnOptions?.workingDirectory.startsWith(fixture.repository)).toBe(false);
    expect(Object.keys(spawnOptions?.environment ?? {}).sort()).toEqual(
      [
        "GOOSE_DISABLE_KEYRING",
        "GOOSE_DISABLE_SESSION_NAMING",
        "GOOSE_PATH_ROOT",
        "GOOSE_TELEMETRY_OFF",
        "HOME",
        "OTEL_LOGS_EXPORTER",
        "OTEL_METRICS_EXPORTER",
        "OTEL_SDK_DISABLED",
        "OTEL_TRACES_EXPORTER",
        "TEMP",
        "TMP",
        "TMPDIR",
        "TZ",
      ].sort(),
    );
  });

  it("still removes the private root when handshake transport cleanup fails", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new FailingCloseGooseAcpTransport({
      initializeResult: {
        ...EXPECTED_GOOSE_INITIALIZE_RESULT,
        agentInfo: { name: "goose", version: "1.44.0" },
      },
    });

    await expect(
      openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        transportFactory: () => transport,
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "cleanup-failed",
    });

    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("removes a partially prepared root when staged bytes fail verification", async () => {
    const fixture = await createLifecycleFixture();

    await expect(
      openGooseRunnerHandshake({
        artifact: {
          ...fixture.artifact,
          executableSha256: "f".repeat(64),
        },
        privateRootParent: fixture.privateRootParent,
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "artifact-mismatch",
    });

    expect(await readdir(fixture.privateRootParent)).toEqual([]);
    expect(await readFile(fixture.sentinelPath, "utf8")).toBe(
      "original checkout must remain unchanged",
    );
  });

  it("stages immutable executable bytes and cleans up after a successful close", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new LoopbackGooseAcpTransport();
    let spawnOptions: GooseAcpSpawnOptions | undefined;
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      transportFactory: (options) => {
        spawnOptions = options;
        return transport;
      },
    });

    expect(await readFile(spawnOptions!.executablePath, "utf8")).toBe("fixture-goose-runner");
    expect(opened.privateRoot.startsWith(fixture.privateRootParent)).toBe(true);
    await expect(
      opened.openSession({
        workspaceDirectory: fixture.repository,
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toEqual({
      sessionId: "goose-session-1",
      setupNotificationKinds: ["available_commands_update"],
    });
    await opened.close();
    await opened.close();
    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("removes the private root when close reports a transport failure", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new FailingCloseGooseAcpTransport();
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      transportFactory: () => transport,
    });

    await expect(opened.close()).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "cleanup-failed",
    });

    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
  });

  it("removes the private root when ACP session setup fails", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new LoopbackGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "setup-session",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [],
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: request.id,
          result: { sessionId: "response-session" },
        },
      ],
    });
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      transportFactory: () => transport,
    });

    await expect(
      opened.openSession({
        workspaceDirectory: fixture.repository,
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "invalid-session-message",
    });

    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
    expect(await readFile(fixture.sentinelPath, "utf8")).toBe(
      "original checkout must remain unchanged",
    );
    await opened.close();
    expect(transport.closeCount).toBe(1);
  });

  it("still removes the private root when failed session cleanup reports a transport error", async () => {
    const fixture = await createLifecycleFixture();
    const transport = new FailingCloseGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32_603, message: "Internal error" },
        },
      ],
    });
    const opened = await openGooseRunnerHandshake({
      artifact: fixture.artifact,
      privateRootParent: fixture.privateRootParent,
      transportFactory: () => transport,
    });

    await expect(
      opened.openSession({
        workspaceDirectory: fixture.repository,
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerProcessError",
      code: "cleanup-failed",
    });

    expect(transport.closeCount).toBe(1);
    expect(await readdir(fixture.privateRootParent)).toEqual([]);
    expect(await readFile(fixture.sentinelPath, "utf8")).toBe(
      "original checkout must remain unchanged",
    );
  });
});
