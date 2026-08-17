import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const directory = await mkdtemp(path.join("/tmp", "actestra-goose-lifecycle-"));
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
      ACTESTRA_GOOSE_CPU_SECONDS: "120",
      ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES: "1073741824",
    });
  });

  it("adds only the five fixed Linux bridge fields to the closed runner environment", () => {
    const root = "/tmp/actestra-goose-environment-fixture";
    const bridgeDirectory = path.join(root, "bridge");
    const environment = createGooseRunnerEnvironment(
      root,
      {
        baseUrl: "http://127.0.0.1:43124/v1",
        modelId: "actestra-loopback-model",
        attemptLease: "model-lease-0123456789abcdef0123456789abcdef",
      },
      {
        capabilitySocketPath: path.join(bridgeDirectory, "capability.sock"),
        modelSocketPath: path.join(bridgeDirectory, "model.sock"),
        capabilityPort: 43_123,
        modelPort: 43_124,
        workspaceRoot: "/tmp/actestra-workspace",
      },
    );

    expect(environment).toMatchObject({
      ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET: path.join(bridgeDirectory, "capability.sock"),
      ACTESTRA_GOOSE_LINUX_MODEL_SOCKET: path.join(bridgeDirectory, "model.sock"),
      ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT: "43123",
      ACTESTRA_GOOSE_LINUX_MODEL_PORT: "43124",
      ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT: "/tmp/actestra-workspace",
    });
    expect(
      Object.keys(environment).filter((key) => key.startsWith("ACTESTRA_GOOSE_LINUX_")),
    ).toEqual([
      "ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET",
      "ACTESTRA_GOOSE_LINUX_MODEL_SOCKET",
      "ACTESTRA_GOOSE_LINUX_CAPABILITY_PORT",
      "ACTESTRA_GOOSE_LINUX_MODEL_PORT",
      "ACTESTRA_GOOSE_LINUX_WORKSPACE_ROOT",
    ]);
  });

  it.skipIf(process.platform !== "darwin")(
    "binds the sandbox and closed environment to exact MCP and model loopback ports",
    async () => {
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "prepares the private-root bridge before transport and shares one idempotent close",
    async () => {
      const fixture = await createLifecycleFixture();
      const events: string[] = [];
      const transport = new LoopbackGooseAcpTransport();
      let preparedRoot:
        | {
            readonly root: string;
            readonly bridgeDirectory: string;
            readonly executablePath: string;
            readonly workingDirectory: string;
          }
        | undefined;
      const bridgeClose = vi.fn(async () => {
        events.push("bridge:close");
      });

      const opened = await openGooseRunnerHandshake({
        artifact: fixture.artifact,
        privateRootParent: fixture.privateRootParent,
        prepareBridge: async (root) => {
          preparedRoot = root;
          events.push("bridge:prepare");
          return Object.freeze({
            capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
            modelBinding: Object.freeze({
              baseUrl: "http://127.0.0.1:43124/v1",
              modelId: "actestra-loopback-model",
              attemptLease: "model-lease-0123456789abcdef0123456789abcdef",
            }),
            capabilitySocketPath: path.join(root.bridgeDirectory, "capability.sock"),
            modelSocketPath: path.join(root.bridgeDirectory, "model.sock"),
            close: bridgeClose,
          });
        },
        transportFactory: (options) => {
          events.push("transport");
          expect(preparedRoot?.bridgeDirectory).toBe(path.join(preparedRoot?.root ?? "", "bridge"));
          expect(options.networkPolicy).toEqual({
            kind: "loopback-session",
            host: "127.0.0.1",
            capabilityProxyPort: 43_123,
            modelProxyPort: 43_124,
          });
          return transport;
        },
      });

      expect(events).toEqual(["bridge:prepare", "transport"]);
      expect(preparedRoot).toBeDefined();
      expect(await readdir(preparedRoot!.bridgeDirectory)).toEqual([]);

      const firstClose = opened.close();
      const secondClose = opened.close();
      expect(secondClose).toBe(firstClose);
      await firstClose;
      expect(bridgeClose).toHaveBeenCalledTimes(1);
      expect(events).toEqual(["bridge:prepare", "transport", "bridge:close"]);
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "closes a prepared bridge and removes the root when transport startup fails",
    async () => {
      const fixture = await createLifecycleFixture();
      const bridgeClose = vi.fn(async () => undefined);
      const transportFailure = new Error("injected transport startup failure");

      await expect(
        openGooseRunnerHandshake({
          artifact: fixture.artifact,
          privateRootParent: fixture.privateRootParent,
          prepareBridge: async (root) =>
            Object.freeze({
              capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
              modelBinding: Object.freeze({
                baseUrl: "http://127.0.0.1:43124/v1",
                modelId: "actestra-loopback-model",
                attemptLease: "model-lease-0123456789abcdef0123456789abcdef",
              }),
              capabilitySocketPath: path.join(root.bridgeDirectory, "capability.sock"),
              modelSocketPath: path.join(root.bridgeDirectory, "model.sock"),
              close: bridgeClose,
            }),
          transportFactory: () => {
            throw transportFailure;
          },
        }),
      ).rejects.toMatchObject({ code: "spawn-failed" });

      expect(bridgeClose).toHaveBeenCalledTimes(1);
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "rejects a prepared bridge whose sockets escape the prepared root",
    async () => {
      const fixture = await createLifecycleFixture();
      const bridgeClose = vi.fn(async () => undefined);
      const transportFactory = vi.fn(() => new LoopbackGooseAcpTransport());

      await expect(
        openGooseRunnerHandshake({
          artifact: fixture.artifact,
          privateRootParent: fixture.privateRootParent,
          prepareBridge: async (root) =>
            Object.freeze({
              capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
              modelBinding: Object.freeze({
                baseUrl: "http://127.0.0.1:43124/v1",
                modelId: "actestra-loopback-model",
                attemptLease: "model-lease-0123456789abcdef0123456789abcdef",
              }),
              capabilitySocketPath: path.join(root.root, "escape.sock"),
              modelSocketPath: path.join(root.bridgeDirectory, "model.sock"),
              close: bridgeClose,
            }),
          transportFactory,
        }),
      ).rejects.toMatchObject({ code: "invalid-options" });

      expect(transportFactory).not.toHaveBeenCalled();
      expect(bridgeClose).toHaveBeenCalledTimes(1);
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
    },
  );

  it.each(["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"])(
    "rejects a matching %s build before creating a private root or transport",
    async (targetTriple) => {
      const fixture = await createLifecycleFixture();
      const transportFactory = vi.fn(() => new LoopbackGooseAcpTransport());
      const prepareBridge = vi.fn(async () => {
        throw new Error("bridge factory must not run before runtime admission");
      });

      await expect(
        openGooseRunnerHandshake({
          artifact: {
            ...fixture.artifact,
            targetTriple,
          },
          privateRootParent: fixture.privateRootParent,
          prepareBridge,
          transportFactory,
        }),
      ).rejects.toMatchObject({
        name: "GooseRunnerProcessError",
        code: "network-policy-unavailable",
      });

      expect(transportFactory).not.toHaveBeenCalled();
      expect(prepareBridge).not.toHaveBeenCalled();
      expect(await readdir(fixture.privateRootParent)).toEqual([]);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "removes the private root after a version rejection without touching a repository",
    async () => {
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
          "ACTESTRA_GOOSE_CPU_SECONDS",
          "ACTESTRA_GOOSE_ADDRESS_SPACE_BYTES",
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "still removes the private root when handshake transport cleanup fails",
    async () => {
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "removes a partially prepared root when staged bytes fail verification",
    async () => {
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "stages immutable executable bytes and cleans up after a successful close",
    async () => {
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "removes the private root when close reports a transport failure",
    async () => {
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "removes the private root when ACP session setup fails",
    async () => {
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
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "still removes the private root when failed session cleanup reports a transport error",
    async () => {
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
    },
  );
});
