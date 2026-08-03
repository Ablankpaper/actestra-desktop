import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  GooseMcpSessionCompositionError,
  openGooseMcpSessionComposition,
  type GooseMcpSessionCompositionDependencies,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import type {
  GooseAcpSession,
  GooseAcpSessionOptions,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";

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

describe("Goose MCP session composition", () => {
  it("owns one generated attempt lease across the MCP and ACP boundaries", async () => {
    let serverLease: string | undefined;
    let sessionLease: string | undefined;
    const dependencies: GooseMcpSessionCompositionDependencies = {
      async startCapabilityServer(options) {
        serverLease = options.attemptLease;
        return Object.freeze({
          url: "http://127.0.0.1:43123/mcp",
          async waitForToolsList() {},
          async close() {},
        });
      },
      async openRunnerHandshake() {
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
          async close() {},
        });
      },
    };

    const opened = await openGooseMcpSessionComposition(
      {
        artifact,
        privateRootParent: path.resolve("/tmp/actestra-goose-attempts"),
        workspaceDirectory: path.resolve("/tmp/actestra-worktree"),
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );

    expect(serverLease).toBeDefined();
    expect(sessionLease).toBe(serverLease);
    expect(serverLease).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opened).not.toHaveProperty("attemptLease");
    await opened.close();
  });

  it("aggregates cleanup failures after attempting Worker then MCP exactly once", async () => {
    const events: string[] = [];
    const runnerFailure = new Error("injected runner close failure");
    const serverFailure = new Error("injected MCP close failure");
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
      async openRunnerHandshake() {
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
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
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    );

    const firstClose = opened.close();
    const secondClose = opened.close();
    expect(secondClose).toBe(firstClose);
    const failure = await firstClose.catch((error: unknown) => error);

    expect(events).toEqual(["runner:close", "mcp:close"]);
    expect(failure).toMatchObject({
      name: "GooseMcpSessionCompositionError",
      code: "cleanup-failed",
    });
    if (!(failure instanceof GooseMcpSessionCompositionError)) {
      throw new Error("Expected a Goose MCP session composition cleanup error");
    }
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toEqual([runnerFailure, serverFailure]);
  });

  it("closes Worker then MCP when ACP session creation fails", async () => {
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
      async openRunnerHandshake() {
        events.push("runner:open");
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            events.push("runner:session/new");
            throw sessionFailure;
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
        commandIds: Object.freeze(["git.status"]),
        testIds: Object.freeze(["test.unit"]),
      },
      dependencies,
    ).catch((error: unknown) => error);

    expect(failure).toBe(sessionFailure);
    expect(events).toEqual([
      "mcp:start",
      "runner:open",
      "runner:session/new",
      "runner:close",
      "mcp:close",
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
      async openRunnerHandshake() {
        return Object.freeze({
          info: runnerInfo,
          privateRoot: "/tmp/actestra-goose-attempt",
          async openSession() {
            return runnerSession;
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
});
