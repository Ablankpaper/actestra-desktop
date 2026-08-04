// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  PRIVILEGED_CONTRACT_VERSION,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  instant,
  sessionId,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type DomainGraph,
  type ProtectedOperation,
} from "../../apps/desktop/src/core";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import {
  createIsolatedCodingMainService,
  type IsolatedCodingMainServiceDependencies,
  type IsolatedCodingMainService,
} from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import { createGooseCodingToolInvoker } from "../../apps/desktop/src/main/workers/gooseCodingToolInvoker";
import type {
  GooseMcpSessionComposition,
  OpenGooseMcpSessionCompositionOptions,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { PersistenceUtilityClient } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";

const execFileAsync = promisify(execFile);
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: os.tmpdir(),
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

const GOOSE_ARTIFACT = Object.freeze({
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

const GOOSE_INFO = Object.freeze({
  protocolVersion: 1,
  agentName: "goose",
  agentVersion: "1.45.0",
  loadSession: true,
  prompt: Object.freeze({ image: true, audio: false, embeddedContext: true }),
  mcp: Object.freeze({ http: true, sse: false, acp: false }),
  session: Object.freeze({ list: true, close: true }),
} as const);

interface MainServiceFixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly managedRoot: string;
  readonly sourceFile: string;
  readonly persistence: PersistenceUtilityClient;
  readonly clock: DeterministicAgentClock;
  readonly service: IsolatedCodingMainService;
  readonly ids: {
    readonly workspaceId: ReturnType<typeof workspaceId>;
    readonly taskId: ReturnType<typeof taskId>;
    readonly sessionId: ReturnType<typeof sessionId>;
    readonly workerId: ReturnType<typeof workerId>;
  };
}

const fixtures: MainServiceFixture[] = [];

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function runGit(repositoryRoot: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
  return result.stdout.trim();
}

function graph(ids: MainServiceFixture["ids"], now: ReturnType<typeof instant>): DomainGraph {
  return {
    workspaces: [
      {
        id: ids.workspaceId,
        name: "P5.2 desktop-main fixture",
        state: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [
      {
        id: ids.taskId,
        workspaceId: ids.workspaceId,
        title: "Compose isolated coding in desktop main",
        state: "running",
        activeSessionId: ids.sessionId,
        createdAt: now,
        updatedAt: now,
      },
    ],
    workers: [
      {
        id: ids.workerId,
        workspaceId: ids.workspaceId,
        adapterKind: "goose",
        state: "busy",
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessions: [
      {
        id: ids.sessionId,
        workspaceId: ids.workspaceId,
        taskId: ids.taskId,
        workerId: ids.workerId,
        state: "running",
        createdAt: now,
        updatedAt: now,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

async function openFixture(
  suffix: string,
  dependencies?: IsolatedCodingMainServiceDependencies,
): Promise<MainServiceFixture> {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "actestra-coding-main-service-test-")),
  );
  const repositoryRoot = path.join(root, "source");
  const managedRoot = path.join(root, "product-state", "coding-worktrees");
  fs.mkdirSync(repositoryRoot);
  await runGit(repositoryRoot, "init", "--initial-branch=main");
  await runGit(repositoryRoot, "config", "user.name", "Actestra Test");
  await runGit(repositoryRoot, "config", "user.email", "actestra-test@example.invalid");
  const sourceFile = path.join(repositoryRoot, "answer.txt");
  fs.writeFileSync(sourceFile, "before\n", "utf8");
  await runGit(repositoryRoot, "add", ".");
  await runGit(repositoryRoot, "commit", "-m", "fixture");

  const { client: persistence } = await openTestPersistenceUtility(
    path.join(root, "product-state"),
  );
  const clock = new DeterministicAgentClock(instant("2026-08-03T12:00:00.000Z"));
  const ids = {
    workspaceId: workspaceId(`workspace-coding-main-${suffix}`),
    taskId: taskId(`task-coding-main-${suffix}`),
    sessionId: sessionId(`session-coding-main-${suffix}`),
    workerId: workerId(`worker-coding-main-${suffix}`),
  };
  await persistence.replaceDomainGraph(graph(ids, clock.now()));
  const service = createIsolatedCodingMainService(
    {
      persistence,
      clock,
      managedRoot,
    },
    dependencies,
  );
  const fixture = {
    root,
    repositoryRoot,
    managedRoot,
    sourceFile,
    persistence,
    clock,
    service,
    ids,
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) {
    await fixture.service.close().catch((): undefined => undefined);
    await fixture.persistence.close().catch((): undefined => undefined);
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

describe("P5.2 desktop-main isolated coding composition", () => {
  it("owns the Goose session over the exact isolated coding worktree lifecycle", async () => {
    let fixture!: MainServiceFixture;
    let invokerOptions:
      | Parameters<IsolatedCodingMainServiceDependencies["createToolInvoker"]>[0]
      | undefined;
    let compositionOptions: OpenGooseMcpSessionCompositionOptions | undefined;
    const events: string[] = [];
    const toolInvoker = async () =>
      Object.freeze({
        isError: false,
        content: JSON.stringify({ contractVersion: 1, type: "desktop-main-test" }),
      });
    fixture = await openFixture("goose-lifecycle", {
      createToolInvoker(options) {
        invokerOptions = options;
        return toolInvoker;
      },
      async openGooseSession(options) {
        compositionOptions = options;
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-1"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-session",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn", updates: Object.freeze([]) });
          },
          async close() {
            events.push("goose:close");
            await expect(
              fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
            ).resolves.not.toBeNull();
            expect(fs.existsSync(options.workspaceDirectory)).toBe(true);
          },
        });
      },
    });
    const modelInvoker = async () =>
      Object.freeze({
        type: "message" as const,
        text: "desktop-main model result",
        usage: Object.freeze({ promptTokens: 4, completionTokens: 2 }),
      });

    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-lifecycle"),
      displayName: "P5.2 desktop-main Goose lifecycle",
      commands: {
        "git.status": Object.freeze({ executablePath: "/usr/bin/git", args: ["status"] }),
      },
      tests: {
        "test.unit": Object.freeze({ executablePath: "/usr/bin/true", args: [] }),
      },
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    expect(invokerOptions).toMatchObject({
      persistence: fixture.persistence,
      clock: fixture.clock,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    expect(invokerOptions?.session.worktreeRoot).toBe(opened.worktreeRoot);
    expect(compositionOptions).toMatchObject({
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      workspaceDirectory: opened.worktreeRoot,
      modelId: "actestra-desktop-main-model",
      modelInvoker,
      toolInvoker,
      commandIds: ["git.status"],
      testIds: ["test.unit"],
    });
    expect(opened.session.sessionId).toBe("goose-desktop-main-session");

    const worktreeRoot = opened.worktreeRoot;
    await fixture.service.close();

    expect(events).toEqual(["goose:close"]);
    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
  }, 15_000);

  it("waits for a Goose opening and closes it when desktop-main shutdown wins", async () => {
    let fixture!: MainServiceFixture;
    const compositionStarted = deferred<OpenGooseMcpSessionCompositionOptions>();
    const releaseComposition = deferred<GooseMcpSessionComposition>();
    const events: string[] = [];
    let grantActiveAtGooseClose = false;
    let worktreePresentAtGooseClose = false;
    fixture = await openFixture("goose-open-close-race", {
      createToolInvoker() {
        return async () =>
          Object.freeze({
            isError: false,
            content: JSON.stringify({ contractVersion: 1, type: "desktop-main-race" }),
          });
      },
      openGooseSession(options) {
        compositionStarted.resolve(options);
        return releaseComposition.promise;
      },
    });
    const modelInvoker = async () =>
      Object.freeze({
        type: "message" as const,
        text: "desktop-main race result",
        usage: Object.freeze({ promptTokens: 4, completionTokens: 2 }),
      });

    const opening = fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-open-close-race"),
      displayName: "P5.2 desktop-main Goose open-close race",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    const compositionOptions = await compositionStarted.promise;
    let closeSettled = false;
    const closing = fixture.service.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const settledBeforeComposition = closeSettled;

    releaseComposition.resolve(
      Object.freeze({
        info: GOOSE_INFO,
        privateRoot: path.join(fixture.root, "goose-private", "attempt-race"),
        session: Object.freeze({
          sessionId: "goose-desktop-main-race",
          setupNotificationKinds: Object.freeze([]),
        }),
        toolNames: Object.freeze([]),
        async prompt() {
          return Object.freeze({ stopReason: "end_turn", updates: Object.freeze([]) });
        },
        async close() {
          events.push("goose:close");
          grantActiveAtGooseClose =
            (await fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId)) !== null;
          worktreePresentAtGooseClose = fs.existsSync(compositionOptions.workspaceDirectory);
        },
      }),
    );
    const openingOutcome = await opening.then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    if (openingOutcome.status === "fulfilled") {
      await openingOutcome.value.close();
    }
    await closing;

    expect(settledBeforeComposition).toBe(false);
    expect(openingOutcome).toMatchObject({
      status: "rejected",
      reason: { name: "IsolatedCodingMainServiceError", code: "closed" },
    });
    expect(events).toEqual(["goose:close"]);
    expect(grantActiveAtGooseClose).toBe(true);
    expect(worktreePresentAtGooseClose).toBe(true);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  }, 15_000);

  it("aggregates Goose and worktree cleanup failures in lifecycle order and retries", async () => {
    let fixture!: MainServiceFixture;
    const events: string[] = [];
    const gooseFailure = new Error("injected Goose cleanup failure");
    const grantFailure = new Error("injected grant cleanup failure");
    let gooseCloseAttempts = 0;
    fixture = await openFixture("goose-cleanup-retry", {
      createToolInvoker() {
        return async () =>
          Object.freeze({
            isError: false,
            content: JSON.stringify({ contractVersion: 1, type: "desktop-main-cleanup" }),
          });
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-cleanup"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-cleanup",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn", updates: Object.freeze([]) });
          },
          async close() {
            gooseCloseAttempts += 1;
            events.push(`goose:close:${gooseCloseAttempts}`);
            if (gooseCloseAttempts === 1) {
              throw gooseFailure;
            }
          },
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-cleanup-retry"),
      displayName: "P5.2 desktop-main Goose cleanup retry",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main cleanup result",
          usage: Object.freeze({ promptTokens: 4, completionTokens: 2 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async () => {
        events.push("grant:revoke:1");
        throw grantFailure;
      })
      .mockImplementation(async (grant) => {
        events.push("grant:revoke:2");
        return persistWorkspaceGrant(grant);
      });

    const failure = await opened.close().catch((error: unknown) => error);

    expect(events).toEqual(["goose:close:1", "grant:revoke:1"]);
    expect(failure).toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });
    if (!(failure instanceof Error)) {
      throw new Error("Expected a desktop-main Goose cleanup error");
    }
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toHaveLength(2);
    expect((failure.cause as AggregateError).errors[0]).toBe(gooseFailure);
    expect((failure.cause as AggregateError).errors[1]).toMatchObject({
      name: "IsolatedCodingToolLifecycleError",
      code: "cleanup-failed",
    });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.not.toBeNull();
    expect(fs.existsSync(opened.worktreeRoot)).toBe(true);

    await opened.close();

    expect(events).toEqual(["goose:close:1", "grant:revoke:1", "goose:close:2", "grant:revoke:2"]);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("retains Goose opening and worktree cleanup failures for shutdown retry", async () => {
    const gooseOpeningFailure = new Error("injected Goose opening failure");
    const grantCleanupFailure = new Error("injected failed-opening grant cleanup");
    const events: string[] = [];
    const fixture = await openFixture("goose-opening-cleanup-retry", {
      createToolInvoker() {
        return async () =>
          Object.freeze({
            isError: false,
            content: JSON.stringify({ contractVersion: 1, type: "desktop-main-opening" }),
          });
      },
      async openGooseSession() {
        events.push("goose:open");
        throw gooseOpeningFailure;
      },
    });
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    let rejectedRevocation = false;
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant").mockImplementation(async (grant) => {
      if (grant.state === "revoked" && !rejectedRevocation) {
        rejectedRevocation = true;
        events.push("grant:revoke:1");
        throw grantCleanupFailure;
      }
      if (grant.state === "revoked") {
        events.push("grant:revoke:2");
      }
      return persistWorkspaceGrant(grant);
    });

    const failure = await fixture.service
      .openGoose({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-goose-opening-cleanup-retry"),
        displayName: "P5.2 desktop-main Goose opening cleanup retry",
        commands: {},
        tests: {},
        artifact: GOOSE_ARTIFACT,
        privateRootParent: path.join(fixture.root, "goose-private"),
        modelId: "actestra-desktop-main-model",
        modelInvoker: async () =>
          Object.freeze({
            type: "message" as const,
            text: "desktop-main opening result",
            usage: Object.freeze({ promptTokens: 4, completionTokens: 2 }),
          }),
        taskId: fixture.ids.taskId,
        sessionId: fixture.ids.sessionId,
        workerId: fixture.ids.workerId,
      })
      .catch((error: unknown) => error);

    expect(events).toEqual(["goose:open", "grant:revoke:1"]);
    expect(failure).toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });
    if (!(failure instanceof Error)) {
      throw new Error("Expected a desktop-main Goose opening cleanup error");
    }
    expect(failure.cause).toBeInstanceOf(AggregateError);
    expect((failure.cause as AggregateError).errors).toHaveLength(2);
    expect((failure.cause as AggregateError).errors[0]).toBe(gooseOpeningFailure);
    expect((failure.cause as AggregateError).errors[1]).toMatchObject({
      name: "IsolatedCodingToolLifecycleError",
      code: "cleanup-failed",
    });
    const activeGrant = await fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId);
    expect(activeGrant).not.toBeNull();
    expect(fs.existsSync(activeGrant!.rootPath)).toBe(true);

    await fixture.service.close();

    expect(events).toEqual(["goose:open", "grant:revoke:1", "grant:revoke:2"]);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(activeGrant!.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("routes one MCP file read through the durable Tool Gateway owner", async () => {
    const fixture = await openFixture("goose-mcp-read");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-mcp-read"),
      displayName: "P5.2 Goose MCP read worktree",
      commands: {},
      tests: {},
    });
    const invokeTool = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      newToolRequestId: () => toolRequestId("request-coding-main-goose-mcp-read"),
      newToolInputReference: () => toolInputReference("input-coding-main-goose-mcp-read"),
    });

    const result = await invokeTool({
      sessionId: "goose-session-1",
      toolCallRequestId: "model-tool-call-1",
      toolId: CODING_FILE_READ_TOOL_ID,
      input: Object.freeze({ contractVersion: 1, relativePath: "answer.txt" }),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      isError: false,
      content: JSON.stringify({
        contractVersion: 1,
        type: "file-read",
        relativePath: "answer.txt",
        content: "before\n",
      }),
    });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  }, 15_000);

  it("does not execute an MCP file write before main-owned approval", async () => {
    const fixture = await openFixture("goose-mcp-approval");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-mcp-approval"),
      displayName: "P5.2 Goose MCP approval worktree",
      commands: {},
      tests: {},
    });
    const invokeTool = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      newToolRequestId: () => toolRequestId("request-coding-main-goose-mcp-approval"),
      newToolInputReference: () => toolInputReference("input-coding-main-goose-mcp-approval"),
    });

    const result = await invokeTool({
      sessionId: "goose-session-approval",
      toolCallRequestId: "model-tool-call-approval",
      toolId: CODING_FILE_WRITE_TOOL_ID,
      input: Object.freeze({
        contractVersion: 1,
        relativePath: "answer.txt",
        content: "after\n",
      }),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      isError: true,
      content: JSON.stringify({ contractVersion: 1, type: "approval-required" }),
    });
    expect(fs.readFileSync(path.join(session.worktreeRoot, "answer.txt"), "utf8")).toBe("before\n");
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  });

  it("persists one exact worktree grant before exposing the closed Tool Gateway", async () => {
    const fixture = await openFixture("open");
    const grantId = workspaceGrantId("grant-coding-main-open");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId,
      displayName: "P5.2 desktop-main worktree",
      commands: {},
      tests: {},
    });

    expect(
      fs
        .realpathSync(session.worktreeRoot)
        .startsWith(`${fs.realpathSync(fixture.managedRoot)}${path.sep}`),
    ).toBe(true);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toEqual(session.grant);

    const operation = {
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      requestId: toolRequestId("request-coding-main-read"),
      workspaceId: fixture.ids.workspaceId,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      toolId: CODING_FILE_READ_TOOL_ID,
      inputRef: toolInputReference("input-coding-main-read"),
      action: "workspace.read",
      resourceKind: "repository",
      summary: "Read answer.txt from the isolated worktree",
      credentialRefs: [],
      requestedAt: fixture.clock.now(),
    } as const satisfies ProtectedOperation;
    await fixture.persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: operation.inputRef,
      kind: "tool-input",
      owner: {
        workspaceId: operation.workspaceId,
        taskId: operation.taskId,
        sessionId: operation.sessionId,
        workerId: operation.workerId,
        requestId: operation.requestId,
        grantId,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: JSON.stringify({ contractVersion: 1, relativePath: "answer.txt" }),
      createdAt: fixture.clock.now(),
    });

    const result = await session.toolGateway.invoke(operation);
    expect(result).toMatchObject({ status: "executed" });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");

    const worktreeRoot = session.worktreeRoot;
    await session.close();
    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
  });

  it.skipIf(process.platform === "win32")(
    "repairs a pre-existing managed root to private POSIX permissions before opening",
    async () => {
      const fixture = await openFixture("managed-root-mode");
      fs.mkdirSync(fixture.managedRoot, { mode: 0o755 });
      fs.chmodSync(fixture.managedRoot, 0o755);

      const session = await fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-managed-root-mode"),
        displayName: "P5.2 private managed root",
        commands: {},
        tests: {},
      });

      expect(fs.statSync(fixture.managedRoot).mode & 0o777).toBe(0o700);
      await session.close();
    },
  );

  it("closes every active worktree before the desktop-main service becomes unavailable", async () => {
    const fixture = await openFixture("shutdown");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-shutdown"),
      displayName: "P5.2 shutdown worktree",
      commands: {},
      tests: {},
    });
    const worktreeRoot = session.worktreeRoot;

    await fixture.service.close();

    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-after-close"),
        displayName: "must not open",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "closed",
    });
  });

  it("revokes an ambiguously committed grant before removing a failed opening", async () => {
    const fixture = await openFixture("response-loss");
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant").mockImplementationOnce(async (grant) => {
      await persistWorkspaceGrant(grant);
      throw new Error("active grant response lost after commit");
    });

    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-response-loss"),
        displayName: "P5.2 response-loss worktree",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "open-failed",
    });

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  });

  it("waits for an in-flight opening before desktop-main shutdown completes", async () => {
    const fixture = await openFixture("open-close-race");
    const activePersistStarted = deferred<void>();
    const releaseActivePersist = deferred<void>();
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant").mockImplementationOnce(async (grant) => {
      activePersistStarted.resolve();
      await releaseActivePersist.promise;
      return persistWorkspaceGrant(grant);
    });

    const opening = fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-open-close-race"),
      displayName: "P5.2 open-close race worktree",
      commands: {},
      tests: {},
    });
    await activePersistStarted.promise;
    let closeSettled = false;
    const closing = fixture.service.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(closeSettled).toBe(false);

    releaseActivePersist.resolve();
    await expect(opening).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "closed",
    });
    await closing;

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  });

  it("retains a failed opening until grant revocation and worktree cleanup can retry", async () => {
    const fixture = await openFixture("cleanup-retry");
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => {
        await persistWorkspaceGrant(grant);
        throw new Error("active grant response lost after commit");
      })
      .mockRejectedValueOnce(new Error("revocation persistence unavailable"))
      .mockImplementation(persistWorkspaceGrant);

    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-cleanup-retry"),
        displayName: "P5.2 cleanup-retry worktree",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });
    const activeGrant = await fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId);
    expect(activeGrant).not.toBeNull();
    await expect(fs.promises.stat(activeGrant!.rootPath)).resolves.toMatchObject({});

    await fixture.service.close();

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(activeGrant!.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("attempts active session cleanup when a retained failed opening still cannot close", async () => {
    const fixture = await openFixture("all-settled-close");
    const failedOpeningIds = {
      workspaceId: workspaceId("workspace-coding-main-failed-opening"),
      taskId: taskId("task-coding-main-failed-opening"),
      sessionId: sessionId("session-coding-main-failed-opening"),
      workerId: workerId("worker-coding-main-failed-opening"),
    };
    const activeGraph = await fixture.persistence.loadDomainGraph();
    const failedOpeningGraph = graph(failedOpeningIds, fixture.clock.now());
    await fixture.persistence.replaceDomainGraph({
      workspaces: [...activeGraph.workspaces, ...failedOpeningGraph.workspaces],
      tasks: [...activeGraph.tasks, ...failedOpeningGraph.tasks],
      workers: [...activeGraph.workers, ...failedOpeningGraph.workers],
      sessions: [...activeGraph.sessions, ...failedOpeningGraph.sessions],
      approvals: [],
      artifacts: [],
    });

    const activeSession = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-active-session"),
      displayName: "P5.2 active session cleanup",
      commands: {},
      tests: {},
    });
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => {
        await persistWorkspaceGrant(grant);
        throw new Error("failed opening active grant response lost after commit");
      })
      .mockRejectedValueOnce(new Error("failed opening initial revocation unavailable"))
      .mockRejectedValueOnce(new Error("failed opening shutdown revocation unavailable"))
      .mockImplementation(persistWorkspaceGrant);

    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: failedOpeningIds.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-failed-opening"),
        displayName: "P5.2 retained failed opening",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });
    const failedOpeningGrant = await fixture.persistence.getActiveWorkspaceGrant(
      failedOpeningIds.workspaceId,
    );
    expect(failedOpeningGrant).not.toBeNull();

    await expect(fixture.service.close()).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(activeSession.worktreeRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.promises.stat(failedOpeningGrant!.rootPath)).resolves.toMatchObject({});

    await fixture.service.close();

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(failedOpeningIds.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(failedOpeningGrant!.rootPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps a raced managed session owned when its first shutdown cleanup fails", async () => {
    const fixture = await openFixture("managed-close-retry");
    const activePersistStarted = deferred<void>();
    const releaseActivePersist = deferred<void>();
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => {
        activePersistStarted.resolve();
        await releaseActivePersist.promise;
        return persistWorkspaceGrant(grant);
      })
      .mockRejectedValueOnce(new Error("first managed revocation unavailable"))
      .mockImplementation(persistWorkspaceGrant);

    const opening = fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-managed-close-retry"),
      displayName: "P5.2 managed close retry worktree",
      commands: {},
      tests: {},
    });
    await activePersistStarted.promise;
    const closing = fixture.service.close();
    releaseActivePersist.resolve();

    await expect(opening).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
    });
    await closing;

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  });
});
