import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CODING_TOOL_IDS } from "../../apps/desktop/src/core";
import { GooseAuthenticatedBridgeProtocolError } from "../../apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { GooseRunnerProcessError } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import {
  GooseMcpSessionCompositionError,
  classifyGooseWindowsCapabilityCallProgressFailure,
  classifyGooseWindowsCapabilityProgressFailure,
  openGooseMcpSessionComposition,
  type GooseMcpSessionCompositionDependencies,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import {
  GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES,
  GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES,
  createGooseWindowsCapabilityProgress,
} from "../../apps/desktop/src/main/workers/gooseSessionTransport";
import type {
  GooseAcpPromptOptions,
  GooseAcpPromptResult,
  GooseAcpSession,
  GooseAcpSessionOptions,
  GooseAcpToolDiscoveryOptions,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";
import type { GooseMcpToolInvoker } from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";
import {
  startGooseLoopbackModelServer,
  type GooseLoopbackModelInvoker,
  type GooseLoopbackModelServer,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";

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

/**
 * A loopback model server double. `refused`/`served` mimic the real counters so
 * a composition can be driven through the refused-inference path.
 */
function modelServerDouble(
  overrides: Partial<GooseLoopbackModelServer> = {},
): GooseLoopbackModelServer {
  return Object.freeze({
    baseUrl: "http://127.0.0.1:43124/v1",
    bindSession() {},
    refusedInferenceCount: 0,
    rejectedRequestCount: 0,
    servedInferenceCount: 1,
    async close() {},
    ...overrides,
  });
}

const toolInvoker: GooseMcpToolInvoker = async () =>
  Object.freeze({
    isError: false,
    content: JSON.stringify({ contractVersion: 1, type: "composition-test-result" }),
  });
const modelInvoker: GooseLoopbackModelInvoker = async () =>
  Object.freeze({
    type: "message",
    text: "composition model result",
    usage: Object.freeze({ promptTokens: 8, completionTokens: 2 }),
  });
const runnerPromptResult = Object.freeze({
  stopReason: "end_turn",
  updates: Object.freeze([
    Object.freeze({
      type: "agent_message_chunk",
      messageId: "message-actestra-1",
      text: "composition model result",
    }),
  ]),
}) satisfies GooseAcpPromptResult;

describe("Goose MCP session composition", () => {
  it("maps the first missing Windows capability round-trip stage to a distinct closed failure", () => {
    const expected = [
      "windows-capability-worker-request-write-failed",
      "windows-capability-supervisor-request-read-failed",
      "windows-capability-supervisor-request-forward-failed",
      "windows-capability-main-request-decode-failed",
      "windows-capability-main-response-write-failed",
      "windows-capability-supervisor-response-read-failed",
      "windows-capability-supervisor-response-forward-failed",
      "windows-capability-worker-response-decode-failed",
    ];

    expect(
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES.map((_, index) =>
        classifyGooseWindowsCapabilityProgressFailure(
          GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES.slice(0, index),
        ),
      ),
    ).toEqual(expected);
    expect(
      classifyGooseWindowsCapabilityProgressFailure(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES),
    ).toBeUndefined();
    expect(new Set(expected).size).toBe(8);
  });

  it("maps the first missing Windows tool-call round-trip stage to a distinct closed failure", () => {
    expect(
      GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES.map((_, index) =>
        classifyGooseWindowsCapabilityCallProgressFailure(
          GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES.slice(0, index),
        ),
      ),
    ).toEqual([
      "windows-capability-call-worker-request-write-failed",
      "windows-capability-call-supervisor-request-read-failed",
      "windows-capability-call-supervisor-request-forward-failed",
      "windows-capability-call-main-request-decode-failed",
      "windows-capability-call-main-tool-invocation-start-failed",
      "windows-capability-call-main-tool-invocation-complete-failed",
      "windows-capability-call-main-response-write-failed",
      "windows-capability-call-supervisor-response-read-failed",
      "windows-capability-call-supervisor-response-forward-failed",
      "windows-capability-call-worker-response-decode-failed",
    ]);
    expect(
      classifyGooseWindowsCapabilityCallProgressFailure([
        ...GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES.slice(0, 5),
        "windows-capability-call-main-tool-invocation-failed",
      ]),
    ).toBe("windows-capability-call-main-tool-invocation-failed");
  });

  it("turns a Windows tool-discovery timeout into the first missing capability stage", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...originalPlatform, value: "win32" });
    const capabilityProgress = createGooseWindowsCapabilityProgress();
    const timeout = new GooseAuthenticatedBridgeProtocolError(
      "Windows capability tools/list timed out",
    );
    const capabilityHost = Object.freeze({
      bindSession() {},
      async waitForToolsList() {
        throw timeout;
      },
      async close() {},
    });
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        throw new Error("Windows must not start loopback capability server");
      },
      async startModelServer() {
        throw new Error("Windows must not start loopback model server");
      },
      startWindowsCapabilityHost: () => capabilityHost,
      startWindowsModelHost: () => modelServerDouble(),
      async openRunnerHandshake(options) {
        const bridge = await options.prepareBridge!({
          root: "/tmp/actestra-goose-attempt",
          bridgeDirectory: "/tmp/actestra-goose-attempt/bridge",
          executablePath: "/tmp/actestra-goose-attempt/bin/runner.exe",
          workingDirectory: "/tmp/actestra-goose-attempt/work",
        });
        bridge.attachWindowsChannels?.({
          capability: {} as never,
          model: {} as never,
          capabilityProgress,
        });
        for (const stage of GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES.slice(0, 3)) {
          capabilityProgress.record(stage);
        }
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            return new Promise<never>(() => undefined);
          },
          async prompt() {
            return runnerPromptResult;
          },
          async close() {
            await bridge.close();
          },
        });
      },
    };

    try {
      await expect(
        openGooseMcpSessionComposition(
          {
            artifact: Object.freeze({ ...artifact, targetTriple: "x86_64-pc-windows-msvc" }),
            privateRootParent: "/tmp/actestra-goose-attempts",
            workspaceDirectory: "/tmp/actestra-worktree",
            modelId: "actestra-caller-model",
            modelInvoker,
            toolInvoker,
            commandIds: [],
            testIds: [],
          },
          dependencies,
        ),
      ).rejects.toMatchObject({
        name: "GooseMcpSessionCompositionError",
        code: "windows-capability-main-request-decode-failed",
        cause: timeout,
      });
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("does not replace an unrelated Windows runtime failure with capability progress", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...originalPlatform, value: "win32" });
    const capabilityProgress = createGooseWindowsCapabilityProgress();
    const runtimeFailure = new GooseRunnerProcessError(
      "windows-model-relay-failed",
      "Windows model relay stopped",
    );
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        throw new Error("Windows must not start loopback capability server");
      },
      async startModelServer() {
        throw new Error("Windows must not start loopback model server");
      },
      startWindowsCapabilityHost: () =>
        Object.freeze({
          bindSession() {},
          async waitForToolsList() {},
          async close() {},
        }),
      startWindowsModelHost: () => modelServerDouble(),
      async openRunnerHandshake(options) {
        const bridge = await options.prepareBridge!({
          root: "/tmp/actestra-goose-attempt",
          bridgeDirectory: "/tmp/actestra-goose-attempt/bridge",
          executablePath: "/tmp/actestra-goose-attempt/bin/runner.exe",
          workingDirectory: "/tmp/actestra-goose-attempt/work",
        });
        bridge.attachWindowsChannels?.({
          capability: {} as never,
          model: {} as never,
          capabilityProgress,
        });
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            throw runtimeFailure;
          },
          async prompt() {
            return runnerPromptResult;
          },
          async close() {
            await bridge.close();
          },
        });
      },
    };

    try {
      await expect(
        openGooseMcpSessionComposition(
          {
            artifact: Object.freeze({ ...artifact, targetTriple: "x86_64-pc-windows-msvc" }),
            privateRootParent: "/tmp/actestra-goose-attempts",
            workspaceDirectory: "/tmp/actestra-worktree",
            modelId: "actestra-caller-model",
            modelInvoker,
            toolInvoker,
            commandIds: [],
            testIds: [],
          },
          dependencies,
        ),
      ).rejects.toBe(runtimeFailure);
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("preserves a prompt transport failure as the first missing Windows tool-call stage", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...originalPlatform, value: "win32" });
    const capabilityProgress = createGooseWindowsCapabilityProgress();
    const promptFailure = new Error("bounded prompt transport failure");
    const capabilityHost = Object.freeze({
      bindSession() {},
      async waitForToolsList() {},
      async close() {},
    });
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        throw new Error("Windows must not start loopback capability server");
      },
      async startModelServer() {
        throw new Error("Windows must not start loopback model server");
      },
      startWindowsCapabilityHost: () => capabilityHost,
      startWindowsModelHost: () => modelServerDouble(),
      async openRunnerHandshake(options) {
        const bridge = await options.prepareBridge!({
          root: "/tmp/actestra-goose-attempt",
          bridgeDirectory: "/tmp/actestra-goose-attempt/bridge",
          executablePath: "/tmp/actestra-goose-attempt/bin/runner.exe",
          workingDirectory: "/tmp/actestra-goose-attempt/work",
        });
        bridge.attachWindowsChannels?.({
          capability: {} as never,
          model: {} as never,
          capabilityProgress,
        });
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            return runnerDiscovery;
          },
          async prompt() {
            throw promptFailure;
          },
          async close() {
            await bridge.close();
          },
        });
      },
    };
    try {
      const opened = await openGooseMcpSessionComposition(
        {
          artifact: Object.freeze({ ...artifact, targetTriple: "x86_64-pc-windows-msvc" }),
          privateRootParent: "/tmp/actestra-goose-attempts",
          workspaceDirectory: "/tmp/actestra-worktree",
          modelId: "actestra-caller-model",
          modelInvoker,
          toolInvoker,
          commandIds: [],
          testIds: [],
        },
        dependencies,
      );
      capabilityProgress.record(GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[0]);
      await expect(opened.prompt({ text: "Read answer.txt" })).rejects.toMatchObject({
        code: "windows-capability-call-supervisor-request-read-failed",
        cause: promptFailure,
      });
      await opened.close();
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("composes Windows authenticated hosts through an injected MCP-free ACP session", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...originalPlatform, value: "win32" });
    const events: string[] = [];
    let attached = false;
    let capabilityHostLease: string | undefined;
    let modelHostLease: string | undefined;
    const modelHost = modelServerDouble({
      bindSession(sessionId: string) {
        events.push(`model:bind:${sessionId}`);
      },
    });
    const capabilityHost = Object.freeze({
      bindSession(sessionId: string) {
        events.push(`capability:bind:${sessionId}`);
      },
      async waitForToolsList() {
        events.push("capability:tools");
      },
      async close() {
        events.push("capability:close");
      },
    });
    const dependencies: GooseMcpSessionCompositionDependencies = {
      startCapabilityServer: async () => {
        throw new Error("Windows must not start loopback capability server");
      },
      startModelServer: async () => {
        throw new Error("Windows must not start loopback model server");
      },
      startWindowsCapabilityHost: (options) => {
        capabilityHostLease = options.attemptLease;
        return capabilityHost;
      },
      startWindowsModelHost: (options) => {
        modelHostLease = options.attemptLease;
        return modelHost;
      },
      async openRunnerHandshake(options) {
        const bridge = await options.prepareBridge!(
          Object.freeze({
            root: "/tmp/actestra-goose-attempt",
            bridgeDirectory: "/tmp/actestra-goose-attempt/bridge",
            executablePath: "/tmp/actestra-goose-attempt/bin/runner.exe",
            workingDirectory: "/tmp/actestra-goose-attempt/work",
          }),
        );
        bridge.attachWindowsChannels?.({
          capability: {} as never,
          model: {} as never,
          capabilityProgress: createGooseWindowsCapabilityProgress(),
        });
        expect(capabilityHostLease).toBeDefined();
        expect(modelHostLease).toBeDefined();
        expect(modelHostLease).not.toBe(capabilityHostLease);
        expect(bridge.windows).toMatchObject({
          attemptLease: capabilityHostLease,
          modelAttemptLease: modelHostLease,
        });
        attached = true;
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession(sessionOptions: GooseAcpSessionOptions) {
            expect(sessionOptions).toEqual({
              transport: "injected",
              workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
            });
            return runnerSession;
          },
          async discoverTools() {
            return runnerDiscovery;
          },
          async prompt() {
            return runnerPromptResult;
          },
          async close() {
            events.push("runner:close");
            await bridge.close();
          },
        });
      },
    };
    try {
      const opened = await openGooseMcpSessionComposition(
        {
          artifact: Object.freeze({ ...artifact, targetTriple: "x86_64-pc-windows-msvc" }),
          privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
          workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
          modelId: "actestra-caller-model",
          modelInvoker,
          toolInvoker,
          commandIds: Object.freeze(["git.status"]),
          testIds: Object.freeze(["test.unit"]),
        },
        dependencies,
      );
      expect(attached).toBe(true);
      expect(opened.toolNames).toEqual(runnerDiscovery.toolNames);
      expect(events).toEqual([
        "model:bind:goose-session-1",
        "capability:bind:goose-session-1",
        "capability:tools",
      ]);
      await opened.close();
      expect(events).toContain("runner:close");
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("owns separate generated leases across model, MCP, and ACP boundaries", async () => {
    let serverLease: string | undefined;
    let sessionLease: string | undefined;
    let modelLease: string | undefined;
    let boundModelSessionId: string | undefined;
    let promptOptions: GooseAcpPromptOptions | undefined;
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
        expect(options.invokeModel).toBe(modelInvoker);
        return modelServerDouble({
          bindSession(sessionId: string) {
            boundModelSessionId = sessionId;
          },
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
            sessionLease = (
              options as Extract<GooseAcpSessionOptions, { readonly transport?: "mcp-http" }>
            ).attemptLease;
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
          async prompt(options: GooseAcpPromptOptions) {
            promptOptions = options;
            return runnerPromptResult;
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
        modelInvoker,
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
    expect(boundModelSessionId).toBe("goose-session-1");
    expect(opened.toolNames).toEqual(runnerDiscovery.toolNames);
    expect(opened).not.toHaveProperty("attemptLease");
    await expect(opened.prompt({ text: "Return the bounded result." })).resolves.toBe(
      runnerPromptResult,
    );
    expect(promptOptions).toEqual({
      sessionId: "goose-session-1",
      text: "Return the bounded result.",
    });
    await opened.close();
  });

  it("starts both Linux bridge servers inside the prepared root before transport creation", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...originalPlatform, value: "linux" });
    const events: string[] = [];
    let capabilitySocketPath: string | undefined;
    let modelSocketPath: string | undefined;
    const capabilityClose = vi.fn(async () => {
      events.push("mcp:close");
    });
    const modelClose = vi.fn(async () => {
      events.push("model:close");
    });
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer(options) {
        events.push("mcp:start");
        capabilitySocketPath = options.socketPath;
        return Object.freeze({
          url: `http://127.0.0.1:${String(options.loopbackPort)}/mcp`,
          async waitForToolsList() {},
          close: capabilityClose,
        });
      },
      async startModelServer(options) {
        events.push("model:start");
        modelSocketPath = options.socketPath;
        return modelServerDouble({
          baseUrl: `http://127.0.0.1:${String(options.loopbackPort)}/v1`,
          close: modelClose,
        });
      },
      async openRunnerHandshake(options) {
        events.push("runner:open");
        expect(options).not.toHaveProperty("capabilityProxyUrl");
        expect(options).not.toHaveProperty("modelBinding");
        expect(options.prepareBridge).toBeTypeOf("function");
        const privateRoot = "/tmp/actestra-goose-attempt";
        const bridge = await options.prepareBridge!(
          Object.freeze({
            root: privateRoot,
            bridgeDirectory: path.join(privateRoot, "bridge"),
            executablePath: path.join(privateRoot, "bin", "actestra-goose-runner"),
            workingDirectory: path.join(privateRoot, "work"),
          }),
        );
        events.push("transport:create");
        expect(bridge.capabilitySocketPath).toBe(capabilitySocketPath);
        expect(bridge.modelSocketPath).toBe(modelSocketPath);
        let closePromise: Promise<void> | undefined;
        return Object.freeze({
          info: runnerInfo,
          privateRoot,
          async openSession() {
            return runnerSession;
          },
          async discoverTools() {
            return runnerDiscovery;
          },
          async prompt() {
            return runnerPromptResult;
          },
          close(): Promise<void> {
            closePromise ??= bridge.close();
            return closePromise;
          },
        });
      },
    };

    try {
      const opened = await openGooseMcpSessionComposition(
        {
          artifact,
          privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
          workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
          modelId: "actestra-caller-model",
          modelInvoker,
          toolInvoker,
          commandIds: Object.freeze(["git.status"]),
          testIds: Object.freeze(["test.unit"]),
        },
        dependencies,
      );

      expect(events).toEqual(["runner:open", "mcp:start", "model:start", "transport:create"]);
      expect(path.dirname(capabilitySocketPath!)).toBe("/tmp/actestra-goose-attempt/bridge");
      expect(path.dirname(modelSocketPath!)).toBe("/tmp/actestra-goose-attempt/bridge");
      expect(capabilitySocketPath).not.toBe(modelSocketPath);
      await opened.close();
      expect(capabilityClose).toHaveBeenCalledTimes(1);
      expect(modelClose).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("rejects and closes Linux bridge servers whose synthetic ports do not match", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...originalPlatform, value: "linux" });
    const capabilityClose = vi.fn(async () => undefined);
    const modelClose = vi.fn(async () => undefined);
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer(options) {
        const mismatchedPort = options.loopbackPort === 65_535 ? 65_534 : options.loopbackPort! + 1;
        return Object.freeze({
          url: `http://127.0.0.1:${String(mismatchedPort)}/mcp`,
          async waitForToolsList() {},
          close: capabilityClose,
        });
      },
      async startModelServer(options) {
        return modelServerDouble({
          baseUrl: `http://127.0.0.1:${String(options.loopbackPort)}/v1`,
          close: modelClose,
        });
      },
      async openRunnerHandshake(options) {
        await options.prepareBridge!(
          Object.freeze({
            root: "/tmp/actestra-goose-attempt",
            bridgeDirectory: "/tmp/actestra-goose-attempt/bridge",
            executablePath: "/tmp/actestra-goose-attempt/bin/actestra-goose-runner",
            workingDirectory: "/tmp/actestra-goose-attempt/work",
          }),
        );
        throw new Error("mismatched bridge must fail before transport creation");
      },
    };

    try {
      await expect(
        openGooseMcpSessionComposition(
          {
            artifact,
            privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
            workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
            modelId: "actestra-caller-model",
            modelInvoker,
            toolInvoker,
            commandIds: Object.freeze(["git.status"]),
            testIds: Object.freeze(["test.unit"]),
          },
          dependencies,
        ),
      ).rejects.toMatchObject({
        name: "GooseRunnerProcessError",
        code: "invalid-options",
      });
      expect(capabilityClose).toHaveBeenCalledTimes(1);
      expect(modelClose).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(process, "platform", originalPlatform);
    }
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
        return modelServerDouble({
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
          async prompt() {
            return runnerPromptResult;
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
        modelInvoker,
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
        return modelServerDouble({
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
          async prompt() {
            throw new Error("prompt must not start after session/new failure");
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
        modelInvoker,
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
        return modelServerDouble();
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
          async prompt() {
            return runnerPromptResult;
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
        modelInvoker,
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
        return modelServerDouble();
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
          async prompt() {
            return runnerPromptResult;
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
        modelInvoker,
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
        return modelServerDouble({
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
          async prompt() {
            return runnerPromptResult;
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
          modelInvoker,
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

  // Cross-layer regression. The layered tests each cover one hop, so this one
  // drives a real loopback server over real HTTP: the broker refuses, Goose
  // receives a content-free 400 and reports an ordinary `end_turn`, and the
  // composition must still fail the turn instead of letting it publish as an
  // unchanged read-only attempt.
  it("fails the turn when a real loopback 400 leaves an end_turn with no served completion", async () => {
    const openServers: GooseLoopbackModelServer[] = [];
    let promptedText: string | undefined;
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {},
        });
      },
      async startModelServer(options) {
        const server = await startGooseLoopbackModelServer({
          modelId: options.modelId,
          attemptLease: options.attemptLease,
          async invokeModel() {
            throw new Error("AionCore model completion is unavailable");
          },
        });
        openServers.push(server);
        return server;
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
          // The real runner is replaced by an exact transcript of what it does
          // with a refused turn: it calls the loopback endpoint, gets the 400,
          // and reports a normal assistant turn.
          async prompt(options: GooseAcpPromptOptions) {
            promptedText = options.text;
            const server = openServers[0]!;
            const response = await fetch(`${server.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${modelLease!}`,
                "agent-session-id": runnerSession.sessionId,
              },
              body: JSON.stringify({
                model: "actestra-caller-model",
                messages: [{ role: "user", content: options.text }],
                stream: true,
              }),
            });
            expect(response.status).toBe(400);
            expect(await response.text()).toBe("");
            return runnerPromptResult;
          },
          async close() {},
        });
      },
    };

    let modelLease: string | undefined;
    const wrapped: GooseMcpSessionCompositionDependencies = {
      ...dependencies,
      async startModelServer(options) {
        modelLease = options.attemptLease;
        return dependencies.startModelServer(options);
      },
    };

    const composition = await openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        modelInvoker,
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      wrapped,
    );

    try {
      await expect(composition.prompt({ text: "Read the README." })).rejects.toMatchObject({
        name: "GooseMcpSessionCompositionError",
        code: "model-completion-refused",
      });
      expect(promptedText).toBe("Read the README.");
      const server = openServers[0]!;
      expect(server.refusedInferenceCount).toBe(1);
      expect(server.rejectedRequestCount).toBe(0);
      expect(server.servedInferenceCount).toBe(0);
    } finally {
      await composition.close();
    }
  }, 15_000);

  // A request Goose malformed fails the same turn, but attributing it to a
  // model refusal would send the next repair at the wrong layer.
  it("separates a malformed request from a model refusal", async () => {
    const openServers: GooseLoopbackModelServer[] = [];
    let modelLease: string | undefined;
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer() {
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {},
        });
      },
      async startModelServer(options) {
        modelLease = options.attemptLease;
        const server = await startGooseLoopbackModelServer({
          modelId: options.modelId,
          attemptLease: options.attemptLease,
          invokeModel: modelInvoker,
        });
        openServers.push(server);
        return server;
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
          async prompt() {
            const server = openServers[0]!;
            const response = await fetch(`${server.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${modelLease!}`,
                "agent-session-id": runnerSession.sessionId,
              },
              body: "{ this is not valid json",
            });
            expect(response.status).toBe(400);
            return runnerPromptResult;
          },
          async close() {},
        });
      },
    };

    const composition = await openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        modelId: "actestra-caller-model",
        modelInvoker,
        toolInvoker,
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );

    try {
      await expect(composition.prompt({ text: "Read the README." })).rejects.toMatchObject({
        name: "GooseMcpSessionCompositionError",
        code: "model-request-rejected",
      });
      const server = openServers[0]!;
      expect(server.rejectedRequestCount).toBe(1);
      expect(server.refusedInferenceCount).toBe(0);
      expect(server.servedInferenceCount).toBe(0);
    } finally {
      await composition.close();
    }
  }, 15_000);
});
