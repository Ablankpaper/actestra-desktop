import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODING_TOOL_IDS } from "../../apps/desktop/src/core";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  GooseMcpSessionCompositionError,
  openGooseMcpSessionComposition,
  type GooseMcpSessionCompositionDependencies,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import type {
  GooseAcpSession,
  GooseAcpSessionOptions,
  GooseAcpToolDiscoveryOptions,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";
import type { GooseMcpToolInvoker } from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";

const artifact = Object.freeze({
  directory: "/tmp/actestra-goose-artifact",
  executablePath: "/tmp/actestra-goose-artifact/actestra-goose-runner",
  executableSha256: "1".repeat(64),
  executableSize: 1,
  targetTriple: "aarch64-apple-darwin",
  gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseVersion: "1.45.0",
  manifestPath: "/tmp/actestra-goose-artifact/actestra-goose-runner.manifest.json",
  manifestSha256: "2".repeat(64),
} satisfies AdmittedGooseRunnerArtifact);

const runnerInfo = Object.freeze({
  protocolVersion: 1,
  agentName: "goose",
  agentVersion: "1.45.0",
  loadSession: true,
  prompt: Object.freeze({ image: true, audio: false, embeddedContext: true }),
  mcp: Object.freeze({ http: true, sse: false, acp: false }),
  session: Object.freeze({ list: true, close: true }),
} as const);

const runnerSession = Object.freeze({
  sessionId: "goose-session-1",
  setupNotificationKinds: Object.freeze(["available_commands_update"] as const),
} satisfies GooseAcpSession);

const runnerDiscovery = Object.freeze({
  toolNames: Object.freeze(CODING_TOOL_IDS.map((toolId) => `actestra-capability-proxy__${toolId}`)),
});

const toolInvoker: GooseMcpToolInvoker = async () =>
  Object.freeze({
    isError: false,
    content: JSON.stringify({ contractVersion: 1, type: "composition-test-result" }),
  });

describe("Goose MCP session composition", () => {
  it("owns separate generated leases across model, MCP, and ACP boundaries", async () => {
    let serverLease: string | undefined;
    let sessionLease: string | undefined;
    let modelLease: string | undefined;
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer(options) {
        serverLease = options.attemptLease;
        expect(options.workspaceDirectory).toBe(path.resolve("/tmp/actestra-worktree"));
        expect(options.invokeTool).toBe(toolInvoker);
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {},
        });
      },
      async startModelServer(options) {
        modelLease = options.attemptLease;
        expect(options.modelId).toBe("actestra-caller-model");
        return Object.freeze({
          baseUrl: "http://127.0.0.1:43124/v1",
          async close() {},
        });
      },
      async openRunnerHandshake(options) {
        expect(options).toHaveProperty("capabilityProxyUrl", "http://127.0.0.1:43123/mcp");
        expect(options.modelBinding).toEqual({
          baseUrl: "http://127.0.0.1:43124/v1",
          modelId: "actestra-caller-model",
          attemptLease: modelLease,
        });
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession(options: GooseAcpSessionOptions) {
            sessionLease = options.attemptLease;
            expect(options).toMatchObject({
              workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
              capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
            });
            return runnerSession;
          },
          async discoverTools(options: GooseAcpToolDiscoveryOptions) {
            expect(options).toEqual({
              sessionId: "goose-session-1",
              extensionName: "actestra-capability-proxy",
            });
            return runnerDiscovery;
          },
          async close() {},
        });
      },
    };

    const opened = await openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );

    expect(serverLease).toBeDefined();
    expect(sessionLease).toBe(serverLease);
    expect(serverLease).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(modelLease).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(modelLease).not.toBe(serverLease);
    expect(opened.toolNames).toEqual(runnerDiscovery.toolNames);
    expect(opened).not.toHaveProperty("attemptLease");
    await opened.close();
  });

  it("aggregates cleanup failures after attempting Worker, MCP, then model exactly once", async () => {
    const events: string[] = [];
    const runnerFailure = new Error("injected runner close failure");
    const serverFailure = new Error("injected MCP close failure");
    const modelFailure = new Error("injected model close failure");
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {
            events.push("mcp:close");
            throw serverFailure;
          },
        });
      },
      async startModelServer() {
        return Object.freeze({
          baseUrl: "http://127.0.0.1:43124/v1",
          async close() {
            events.push("model:close");
            throw modelFailure;
          },
        });
      },
      async openRunnerHandshake() {
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            return runnerDiscovery;
          },
          async close() {
            events.push("runner:close");
            throw runnerFailure;
          },
        });
      },
    };
    const opened = await openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );

    const firstClose = opened.close();
    const secondClose = opened.close();
    expect(secondClose).toBe(firstClose);
    const failure = await firstClose.catch((error: unknown) => error);

    expect(events).toEqual(["runner:close", "mcp:close", "model:close"]);
    expect(failure).toMatchObject({
      name: "GooseMcpSessionCompositionError",
      code: "cleanup-failed",
    });
    if (!(failure instanceof GooseMcpSessionCompositionError)) {
      throw new Error("Expected a Goose MCP session composition cleanup error");
    }
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toEqual([
      runnerFailure,
      serverFailure,
      modelFailure,
    ]);
  });

  it("closes Worker, MCP, then model when ACP session creation fails", async () => {
    const events: string[] = [];
    const sessionFailure = new Error("injected session/new failure");
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        events.push("mcp:start");
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {
            events.push("mcp:close");
          },
        });
      },
      async startModelServer() {
        events.push("model:start");
        return Object.freeze({
          baseUrl: "http://127.0.0.1:43124/v1",
          async close() {
            events.push("model:close");
          },
        });
      },
      async openRunnerHandshake() {
        events.push("runner:open");
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            events.push("runner:session/new");
            throw sessionFailure;
          },
          async discoverTools() {
            throw new Error("tool discovery must not start after session/new failure");
          },
          async close() {
            events.push("runner:close");
          },
        });
      },
    };

    const failure = await openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    ).catch((error: unknown) => error);

    expect(failure).toBe(sessionFailure);
    expect(events).toEqual([
      "mcp:start",
      "model:start",
      "runner:open",
      "runner:session/new",
      "runner:close",
      "mcp:close",
      "model:close",
    ]);
  });

  it("does not return before the authenticated MCP tool list is accepted", async () => {
    let releaseToolList!: () => void;
    const toolListAccepted = new Promise<void>((resolve) => {
      releaseToolList = resolve;
    });
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          waitForToolsList: () => toolListAccepted,
          async close() {},
        });
      },
      async startModelServer() {
        return Object.freeze({
          baseUrl: "http://127.0.0.1:43124/v1",
          async close() {},
        });
      },
      async openRunnerHandshake() {
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            return runnerDiscovery;
          },
          async close() {},
        });
      },
    };

    const opening = openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );
    let settled = false;
    void opening.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    releaseToolList();
    const opened = await opening;
    await opened.close();
  });

  it("does not return before pinned Goose acknowledges explicit tool discovery", async () => {
    let releaseDiscovery!: () => void;
    const discoveryAccepted = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {},
        });
      },
      async startModelServer() {
        return Object.freeze({
          baseUrl: "http://127.0.0.1:43124/v1",
          async close() {},
        });
      },
      async openRunnerHandshake() {
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            await discoveryAccepted;
            return runnerDiscovery;
          },
          async close() {},
        });
      },
    };

    const opening = openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );
    let settled = false;
    void opening.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(settled).toBe(false);
    releaseDiscovery();
    const opened = await opening;
    expect(opened.toolNames).toEqual(runnerDiscovery.toolNames);
    await opened.close();
  });

  it("fails closed and cleans every boundary when Goose does not return the exact tool set", async () => {
    const events: string[] = [];
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {
            events.push("mcp:close");
          },
        });
      },
      async startModelServer() {
        return Object.freeze({
          baseUrl: "http://127.0.0.1:43124/v1",
          async close() {
            events.push("model:close");
          },
        });
      },
      async openRunnerHandshake() {
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            return Object.freeze({
              toolNames: Object.freeze([runnerDiscovery.toolNames[0]!]),
            });
          },
          async close() {
            events.push("runner:close");
          },
        });
      },
    };

    await expect(
      openGooseMcpSessionComposition(
        {
          artifact,
          privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
          workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
          modelId: "actestra-caller-model",
          toolInvoker,
          commandIds: Object.freeze(["git.status"]),
          testIds: Object.freeze(["test.unit"]),
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      name: "GooseMcpSessionCompositionError",
      code: "tool-discovery-mismatch",
    });
    expect(events).toEqual(["runner:close", "mcp:close", "model:close"]);
  });
});
