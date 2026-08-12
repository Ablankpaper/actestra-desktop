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
  approvalActorId,
  instant,
  policyRevision,
  sessionId,
  taskId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type DomainGraph,
  type Artifact,
  type ApprovalRequestSnapshot,
  type ContentReferenceMetadata,
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
import { deriveGooseCodingEvidenceIdentity } from "../../apps/desktop/src/main/workers/gooseCodingEvidenceCoordinator";
import { captureIsolatedCodingPatch } from "../../apps/desktop/src/main/workers/isolatedCodingPatch";
import { GooseMcpSessionCompositionError } from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import type {
  GooseMcpSessionComposition,
  OpenGooseMcpSessionCompositionOptions,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import {
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { GooseLoopbackModelInvocation } from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
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

const REAL_GOOSE_ARTIFACT_DIRECTORY = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
const REAL_GOOSE_MANIFEST_SHA256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
const REAL_GOOSE_TARGET_TRIPLE =
  process.platform === "darwin" && process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : process.platform === "darwin" && process.arch === "x64"
      ? "x86_64-apple-darwin"
      : undefined;

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
    const approvalDecisionHandler = async () =>
      Object.freeze({
        decision: "approved" as const,
        actorId: approvalActorId("local-user"),
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
      approvalDecisionHandler,
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
      approvalDecisionHandler,
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

  it("persists normalized task and session evidence before returning a Goose prompt", async () => {
    let fixture!: MainServiceFixture;
    let graphObservedAtGooseClose: DomainGraph | undefined;
    fixture = await openFixture("goose-durable-prompt", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-durable-prompt"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-durable-prompt",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({
              stopReason: "end_turn" as const,
              usage: Object.freeze({
                totalTokens: 9,
                inputTokens: 5,
                outputTokens: 4,
              }),
              updates: Object.freeze([
                Object.freeze({
                  type: "session_info_update" as const,
                  title: "Disposable Goose title",
                }),
                Object.freeze({
                  type: "agent_message_chunk" as const,
                  messageId: "goose-private-message",
                  text: "Review the isolated coding result.",
                }),
              ]),
            });
          },
          async close() {
            graphObservedAtGooseClose = await fixture.persistence.loadDomainGraph();
          },
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-durable-prompt"),
      displayName: "P5.2 durable Goose prompt evidence",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main durable result",
          usage: Object.freeze({ promptTokens: 5, completionTokens: 4 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    const started = await fixture.persistence.replayEvents(opened.streamId);
    expect(started).toMatchObject([
      {
        sequence: 1,
        type: "task.started",
        payload: { from: "ready", to: "running" },
      },
    ]);
    expect(started[0]).toMatchObject({
      workspaceId: fixture.ids.workspaceId,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      streamId: opened.streamId,
      correlationId: opened.correlationId,
    });

    const prompt = await opened.prompt({ text: "Complete the isolated coding task." });

    expect(prompt.stopReason).toBe("end_turn");
    const reviewEvents = await fixture.persistence.replayEvents(opened.streamId);
    expect(reviewEvents.map((event) => event.type)).toEqual([
      "task.started",
      "agent.message",
      "task.updated",
    ]);
    expect(reviewEvents[1]).toMatchObject({
      sequence: 2,
      type: "agent.message",
      payload: {
        role: "assistant",
        content: "Review the isolated coding result.",
      },
    });
    expect(reviewEvents[2]).toMatchObject({
      sequence: 3,
      type: "task.updated",
      payload: {
        from: "running",
        to: "blocked",
        reason: "coding-review-required:end_turn",
      },
    });
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked", activeSessionId: fixture.ids.sessionId }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "ready" }],
    });

    const worktreeRoot = opened.worktreeRoot;
    await opened.close();

    expect(graphObservedAtGooseClose).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "cancelled" }],
      sessions: [{ id: fixture.ids.sessionId, state: "cancelled" }],
      workers: [{ id: fixture.ids.workerId, state: "stopping" }],
    });
    const cancelledEvents = await fixture.persistence.replayEvents(opened.streamId);
    expect(cancelledEvents.map((event) => event.type)).toEqual([
      "task.started",
      "agent.message",
      "task.updated",
      "task.cancelled",
    ]);
    expect(cancelledEvents.at(-1)).toMatchObject({
      sequence: 4,
      payload: { from: "blocked", to: "cancelled", reason: "coding-session-closed" },
    });
    const cancelledGraph = await fixture.persistence.loadDomainGraph();
    expect(cancelledGraph).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "cancelled" }],
      sessions: [{ id: fixture.ids.sessionId, state: "cancelled" }],
      workers: [{ id: fixture.ids.workerId, state: "stopped" }],
    });
    expect(cancelledGraph.tasks[0]?.activeSessionId).toBeUndefined();
    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  }, 15_000);

  it("admits the human decision hold through the closed Tool Gateway invoker composition", async () => {
    let fixture!: MainServiceFixture;
    let invokerHoldObserved = false;
    fixture = await openFixture("goose-human-decision-hold", {
      createToolInvoker(options) {
        invokerHoldObserved = typeof options.holdHumanDecision === "function";
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-human-decision-hold"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-human-decision-hold",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({
              stopReason: "end_turn" as const,
              updates: Object.freeze([]),
            });
          },
          async close() {},
        });
      },
    });

    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-human-decision-hold"),
      displayName: "P5.2 human decision hold composition",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main hold result",
          usage: Object.freeze({ promptTokens: 5, completionTokens: 4 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      holdHumanDecision: () => () => {},
    });

    expect(invokerHoldObserved).toBe(true);
    expect(opened.session.sessionId).toBe("goose-desktop-main-human-decision-hold");

    await opened.close();
  }, 15_000);

  it("publishes one approved coding patch as an Actestra Artifact before cleanup", async () => {
    let fixture!: MainServiceFixture;
    let graphObservedAtGooseClose: DomainGraph | undefined;
    let publishSnapshot:
      | {
          readonly baseCommit: string;
          readonly patchByteLength: number;
          readonly patchSha256: string;
        }
      | undefined;
    let publishDecisionCalls = 0;
    fixture = await openFixture("goose-publish-artifact", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-publish-artifact"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-publish-artifact",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {
            graphObservedAtGooseClose = await fixture.persistence.loadDomainGraph();
          },
        });
      },
    });
    const baseCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-publish-artifact"),
      displayName: "P5.2 approved coding Artifact publish",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main publish result",
          usage: Object.freeze({ promptTokens: 3, completionTokens: 2 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    fs.writeFileSync(path.join(opened.worktreeRoot, "answer.txt"), "staged\n", "utf8");
    await runGit(opened.worktreeRoot, "add", "--", "answer.txt");
    fs.writeFileSync(path.join(opened.worktreeRoot, "answer.txt"), "after\n", "utf8");
    fs.writeFileSync(
      path.join(opened.worktreeRoot, "new-note.txt"),
      "new artifact input\n",
      "utf8",
    );
    await opened.prompt({ text: "Prepare the isolated coding change for review." });

    const publish = Reflect.get(opened, "publish");
    expect(publish).toBeTypeOf("function");
    const publishOptions = {
      async decisionHandler(request: {
        readonly approval: ApprovalRequestSnapshot;
        readonly snapshot: {
          readonly baseCommit: string;
          readonly patchByteLength: number;
          readonly patchSha256: string;
        };
        readonly signal: AbortSignal;
      }) {
        publishDecisionCalls += 1;
        expect(Object.keys(request).sort()).toEqual(["approval", "signal", "snapshot"]);
        expect(request.approval).toMatchObject({
          state: "pending",
          operation: {
            workspaceId: fixture.ids.workspaceId,
            taskId: fixture.ids.taskId,
            sessionId: fixture.ids.sessionId,
            workerId: fixture.ids.workerId,
            toolId: "actestra.coding.artifact.publish",
            action: "publish.execute",
            resourceKind: "repository",
          },
        });
        expect(request.signal.aborted).toBe(false);
        expect(request.snapshot).toMatchObject({ baseCommit });
        expect(request.snapshot).not.toHaveProperty("patch");
        expect(await runGit(opened.worktreeRoot, "diff", "--cached", "--name-only")).toBe(
          "answer.txt",
        );
        publishSnapshot = request.snapshot;
        return Object.freeze({
          decision: "approved" as const,
          actorId: approvalActorId("local-publish-reviewer"),
        });
      },
    };
    const result = await (
      publish as (options: {
        readonly decisionHandler: (request: {
          readonly approval: ApprovalRequestSnapshot;
          readonly snapshot: {
            readonly baseCommit: string;
            readonly patchByteLength: number;
            readonly patchSha256: string;
          };
          readonly signal: AbortSignal;
        }) => Promise<{
          readonly decision: "approved" | "denied";
          readonly actorId: ReturnType<typeof approvalActorId>;
        }>;
      }) => Promise<{
        readonly status: "published";
        readonly baseCommit: string;
        readonly artifact: Artifact;
        readonly output: ContentReferenceMetadata;
      }>
    )(publishOptions);

    expect(result).toMatchObject({
      status: "published",
      baseCommit,
      artifact: {
        workspaceId: fixture.ids.workspaceId,
        taskId: fixture.ids.taskId,
        sessionId: fixture.ids.sessionId,
        kind: "file",
        label: "Actestra coding patch",
        state: "available",
      },
      output: {
        kind: "tool-output",
        classification: "task-content",
        mediaType: "text/plain; charset=utf-8",
      },
    });
    expect(result.artifact.id).toMatch(/^artifact-coding-[a-f0-9]{64}$/u);
    expect(result.output.reference).toMatch(/^coding-publish-output-[a-f0-9]{64}$/u);
    expect(result.output.owner).toMatchObject({
      workspaceId: fixture.ids.workspaceId,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      grantId: opened.grant.grantId,
    });
    expect(result.output.sha256).toBe(publishSnapshot?.patchSha256);
    expect(result.output.byteLength).toBe(publishSnapshot?.patchByteLength);
    const publishedContent = await fixture.persistence.resolveContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: toolOutputReference(result.output.reference),
      kind: "tool-output",
      owner: result.output.owner,
      resolvedAt: fixture.clock.now(),
      consume: false,
    });
    expect(publishedContent.content).toContain("diff --git a/answer.txt b/answer.txt");
    expect(publishedContent.content).toContain("-before");
    expect(publishedContent.content).toContain("+after");
    expect(publishedContent.content).toContain("diff --git a/new-note.txt b/new-note.txt");
    expect(publishedContent.content).toContain("+new artifact input");

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "task.updated",
      "task.updated",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
      "approval.resolved",
      "task.updated",
      "tool.started",
      "tool.completed",
      "artifact.created",
      "task.completed",
    ]);
    expect(events.at(-2)).toMatchObject({
      type: "artifact.created",
      payload: {
        artifactId: result.artifact.id,
        kind: "file",
        label: "Actestra coding patch",
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "task.completed",
      payload: { from: "running", to: "completed" },
    });
    expect(graphObservedAtGooseClose).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "completed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "completed" }],
      workers: [{ id: fixture.ids.workerId, state: "stopping" }],
      artifacts: [{ id: result.artifact.id, state: "available" }],
    });
    const graphAfterPublish = await fixture.persistence.loadDomainGraph();
    expect(graphAfterPublish).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "completed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "completed" }],
      workers: [{ id: fixture.ids.workerId, state: "stopped" }],
      artifacts: [result.artifact],
    });
    expect(graphAfterPublish.tasks[0]?.activeSessionId).toBeUndefined();
    await expect(fs.promises.stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
    // The Artifact is publishable evidence only: workspace delivery is a separate, durable
    // authority that starts out pending and carries no apply approval yet.
    const delivery = await fixture.persistence.getArtifactDelivery(result.artifact.id);
    expect(delivery).toMatchObject({
      contractVersion: 2,
      artifactId: result.artifact.id,
      workspaceId: fixture.ids.workspaceId,
      destinationWorkspaceId: null,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      state: "pending",
      patchOwnerGrantId: opened.grant.grantId,
      destinationGrantId: null,
      patchSha256: publishSnapshot?.patchSha256,
      patchByteLength: publishSnapshot?.patchByteLength,
      baseCommit,
      changedFileCount: 2,
      approvalId: null,
      verifiedHead: null,
      failureCode: null,
      failureMessage: null,
    });
    // Apply must be able to read the patch after the isolated worktree is gone, so the
    // delivery authority points at persisted content rather than a worktree path.
    expect(delivery?.patchReference).toMatch(/^coding-publish-patch-[a-f0-9]{64}$/u);
    const deliveryPatch = await fixture.persistence.resolveContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: toolInputReference(delivery?.patchReference ?? ""),
      kind: "tool-input",
      owner: result.output.owner,
      resolvedAt: fixture.clock.now(),
      consume: false,
    });
    expect(deliveryPatch.content).toBe(publishedContent.content);
    expect(await fixture.persistence.listArtifactDeliveriesForTask(fixture.ids.taskId, 10)).toEqual(
      [delivery],
    );

    const replayed = await opened.publish(publishOptions);
    expect(replayed).toEqual(result);
    expect(publishDecisionCalls).toBe(1);
    await opened.close();
    expect(
      (await fixture.persistence.replayEvents(opened.streamId)).map(({ type }) => type),
    ).not.toContain("task.cancelled");
  }, 15_000);

  it("rejects executable Git configuration while capturing a publish patch", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-publish-config-denied", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-publish-config-denied"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-publish-config-denied",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-publish-config-denied"),
      displayName: "P5.2 rejected coding Artifact filter configuration",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main publish configuration denial",
          usage: Object.freeze({ promptTokens: 2, completionTokens: 2 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    fs.writeFileSync(path.join(opened.worktreeRoot, "answer.txt"), "filtered\n", "utf8");
    await runGit(
      opened.worktreeRoot,
      "config",
      "--local",
      "filter.actestra-publish.process",
      "/usr/bin/false",
    );
    try {
      await expect(
        captureIsolatedCodingPatch({
          worktreeRoot: opened.worktreeRoot,
          gitDirectory: opened.gitDirectory,
          gitCommonDirectory: opened.gitCommonDirectory,
        }),
      ).rejects.toMatchObject({
        name: "IsolatedCodingPatchError",
        code: "repository-config-denied",
      });
    } finally {
      await runGit(
        opened.worktreeRoot,
        "config",
        "--local",
        "--unset-all",
        "filter.actestra-publish.process",
      );
    }
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    await opened.close();
  }, 15_000);

  it("keeps the reviewed worktree blocked when the user denies Artifact publish", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-publish-denied", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-publish-denied"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-publish-denied",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-publish-denied"),
      displayName: "P5.2 denied coding Artifact publish",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main publish denial",
          usage: Object.freeze({ promptTokens: 2, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    fs.writeFileSync(path.join(opened.worktreeRoot, "answer.txt"), "denied\n", "utf8");
    await opened.prompt({ text: "Prepare a change that will not be published." });

    const result = await opened.publish({
      async decisionHandler() {
        return Object.freeze({
          decision: "denied" as const,
          actorId: approvalActorId("local-publish-reviewer"),
        });
      },
    });

    expect(result).toMatchObject({ status: "denied", approval: { state: "denied" } });
    const reviewedGraph = await fixture.persistence.loadDomainGraph();
    expect(reviewedGraph).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked" }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "ready" }],
      artifacts: [],
    });
    expect(fs.existsSync(opened.worktreeRoot)).toBe(true);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toMatchObject({ state: "active", rootPath: opened.worktreeRoot });
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.slice(-2).map(({ type }) => type)).toEqual(["tool.failed", "task.updated"]);
    expect(events.at(-1)).toMatchObject({
      payload: {
        from: "running",
        to: "blocked",
        reason: "coding-publish-denied",
      },
    });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");

    await opened.close();
    await expect(fs.promises.stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("completes a read-only coding review without an Artifact or a publish approval", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-publish-unchanged", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-publish-unchanged"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-publish-unchanged",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-publish-unchanged"),
      displayName: "P5.2 read-only coding review",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main read-only review",
          usage: Object.freeze({ promptTokens: 2, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    await opened.prompt({ text: "Explain the fixture without changing any file." });

    const decisionHandler = vi.fn();
    const result = await opened.publish({ decisionHandler });

    expect(result).toMatchObject({ status: "unchanged" });
    expect(decisionHandler).not.toHaveBeenCalled();
    const reviewedGraph = await fixture.persistence.loadDomainGraph();
    expect(reviewedGraph).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "completed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "completed" }],
      artifacts: [],
    });
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.at(-1)).toMatchObject({
      type: "task.completed",
      payload: { from: "blocked", to: "completed" },
    });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  }, 15_000);

  it("rejects a worktree change after approval and returns to blocked review", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-publish-snapshot-drift", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-publish-snapshot-drift"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-publish-snapshot-drift",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-publish-snapshot-drift"),
      displayName: "P5.2 drifted coding Artifact publish",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main publish snapshot drift",
          usage: Object.freeze({ promptTokens: 2, completionTokens: 2 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    const changedFile = path.join(opened.worktreeRoot, "answer.txt");
    fs.writeFileSync(changedFile, "first reviewed change\n", "utf8");
    await opened.prompt({ text: "Prepare one reviewed change." });

    await expect(
      opened.publish({
        async decisionHandler() {
          fs.writeFileSync(changedFile, "changed after approval snapshot\n", "utf8");
          return Object.freeze({
            decision: "approved" as const,
            actorId: approvalActorId("local-publish-reviewer"),
          });
        },
      }),
    ).rejects.toMatchObject({
      name: "GooseCodingArtifactPublisherError",
      code: "gateway-failed",
    });
    const graphAfterDrift = await fixture.persistence.loadDomainGraph();
    expect(graphAfterDrift).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked" }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "ready" }],
      artifacts: [],
    });
    expect(fs.existsSync(opened.worktreeRoot)).toBe(true);
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.slice(-2).map(({ type }) => type)).toEqual(["tool.failed", "task.updated"]);
    expect(events.at(-1)).toMatchObject({
      payload: {
        from: "running",
        to: "blocked",
        reason: "coding-publish-snapshot-changed",
      },
    });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");

    await opened.close();
    await expect(fs.promises.stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("recovers a committed publish output when its persistence response is lost", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-publish-output-response-loss", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(
            fixture.root,
            "goose-private",
            "attempt-publish-output-response-loss",
          ),
          session: Object.freeze({
            sessionId: "goose-desktop-main-publish-output-response-loss",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-publish-output-response-loss"),
      displayName: "P5.2 response-loss coding Artifact publish",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main publish response loss",
          usage: Object.freeze({ promptTokens: 2, completionTokens: 2 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    fs.writeFileSync(path.join(opened.worktreeRoot, "answer.txt"), "response lost\n", "utf8");
    await opened.prompt({ text: "Prepare a response-loss-safe coding patch." });
    const storeContentReference = fixture.persistence.storeContentReference.bind(
      fixture.persistence,
    );
    let publishOutputStores = 0;
    vi.spyOn(fixture.persistence, "storeContentReference").mockImplementation(async (input) => {
      const result = await storeContentReference(input);
      if (input.kind === "tool-output" && input.reference.startsWith("coding-publish-output-")) {
        publishOutputStores += 1;
        throw new Error("Injected committed publish-output response loss");
      }
      return result;
    });

    const result = await opened.publish({
      async decisionHandler() {
        return Object.freeze({
          decision: "approved" as const,
          actorId: approvalActorId("local-publish-reviewer"),
        });
      },
    });

    expect(result.status).toBe("published");
    expect(publishOutputStores).toBe(1);
    const graphAfterPublish = await fixture.persistence.loadDomainGraph();
    expect(graphAfterPublish.artifacts).toHaveLength(1);
    expect(graphAfterPublish.tasks[0]?.state).toBe("completed");
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.filter(({ type }) => type === "artifact.created")).toHaveLength(1);
    expect(events.filter(({ type }) => type === "task.completed")).toHaveLength(1);
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
  }, 15_000);

  it("persists approval and tool evidence before an approved result returns to Goose", async () => {
    let fixture!: MainServiceFixture;
    let opened!: Awaited<ReturnType<IsolatedCodingMainService["openGoose"]>>;
    let evidenceAtApproval: Awaited<ReturnType<PersistenceUtilityClient["replayEvents"]>> = [];
    let graphAtApproval: DomainGraph | undefined;
    fixture = await openFixture("goose-durable-approval", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker({
          ...options,
          newToolRequestId: () => toolRequestId("request-coding-main-durable-approval"),
          newToolInputReference: () => toolInputReference("input-coding-main-durable-approval"),
        });
      },
      async openGooseSession(options) {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-durable-approval"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-durable-approval",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            const result = await options.toolInvoker({
              sessionId: "goose-desktop-main-durable-approval",
              toolCallRequestId: "goose-private-tool-call",
              toolId: CODING_FILE_WRITE_TOOL_ID,
              input: Object.freeze({
                contractVersion: 1,
                relativePath: "answer.txt",
                content: "after durable approval\n",
              }),
              signal: new AbortController().signal,
            });
            expect(result).toEqual({
              isError: false,
              content: JSON.stringify({
                contractVersion: 1,
                type: "file-written",
                relativePath: "answer.txt",
                byteLength: Buffer.byteLength("after durable approval\n", "utf8"),
              }),
            });
            return Object.freeze({
              stopReason: "end_turn" as const,
              updates: Object.freeze([
                Object.freeze({
                  type: "agent_message_chunk" as const,
                  text: "The approved isolated change is ready for review.",
                }),
              ]),
            });
          },
          async close() {},
        });
      },
    });
    const actorId = approvalActorId("local-user");
    opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-durable-approval"),
      displayName: "P5.2 durable Goose approval evidence",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main durable approval result",
          usage: Object.freeze({ promptTokens: 5, completionTokens: 4 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      async approvalDecisionHandler() {
        evidenceAtApproval = await fixture.persistence.replayEvents(opened.streamId);
        graphAtApproval = await fixture.persistence.loadDomainGraph();
        expect(fs.readFileSync(path.join(opened.worktreeRoot, "answer.txt"), "utf8")).toBe(
          "before\n",
        );
        return Object.freeze({ decision: "approved" as const, actorId });
      },
    });
    const resolveApproval = opened.approvalService.resolve.bind(opened.approvalService);
    let resolutionResponseLost = false;
    vi.spyOn(opened.approvalService, "resolve").mockImplementation(async (...args) => {
      const result = await resolveApproval(...args);
      if (!resolutionResponseLost) {
        resolutionResponseLost = true;
        throw new Error("injected approved-resolution response loss after commit");
      }
      return result;
    });
    const appendEvent = fixture.persistence.appendEvent.bind(fixture.persistence);
    let completionResponseLost = false;
    vi.spyOn(fixture.persistence, "appendEvent").mockImplementation(async (event) => {
      const result = await appendEvent(event);
      if (event.type === "tool.completed" && !completionResponseLost) {
        completionResponseLost = true;
        throw new Error("injected tool-completion response loss after commit");
      }
      return result;
    });
    const invokeTool = opened.toolGateway.invoke.bind(opened.toolGateway);
    let gatewayInvocations = 0;
    vi.spyOn(opened.toolGateway, "invoke").mockImplementation(async (...args) => {
      gatewayInvocations += 1;
      return invokeTool(...args);
    });

    await opened.prompt({ text: "Write the approved isolated change." });

    expect(evidenceAtApproval.map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
    ]);
    expect(evidenceAtApproval[1]).toMatchObject({
      type: "tool.requested",
      payload: {
        requestId: "request-coding-main-durable-approval",
        toolName: CODING_FILE_WRITE_TOOL_ID,
      },
    });
    expect(graphAtApproval).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked" }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "busy" }],
      approvals: [
        {
          taskId: fixture.ids.taskId,
          sessionId: fixture.ids.sessionId,
          state: "pending",
        },
      ],
    });

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
      "approval.resolved",
      "task.updated",
      "tool.started",
      "tool.completed",
      "agent.message",
      "task.updated",
    ]);
    expect(events[5]).toMatchObject({
      type: "approval.resolved",
      payload: { decision: "approved" },
    });
    expect(events[7]).toMatchObject({
      type: "tool.started",
      payload: { requestId: "request-coding-main-durable-approval" },
    });
    expect(events[8]).toMatchObject({
      type: "tool.completed",
      payload: { requestId: "request-coding-main-durable-approval" },
    });
    expect(JSON.stringify(events)).not.toContain("after durable approval");
    const graph = await fixture.persistence.loadDomainGraph();
    expect(graph).toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked" }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "ready" }],
      approvals: [{ state: "approved", resolvedAt: fixture.clock.now() }],
    });
    expect(fs.readFileSync(path.join(opened.worktreeRoot, "answer.txt"), "utf8")).toBe(
      "after durable approval\n",
    );
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
    expect(gatewayInvocations).toBe(2);

    await opened.close();
  }, 15_000);

  it("persists a denied tool outcome without executing the isolated write", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-denial", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker({
          ...options,
          newToolRequestId: () => toolRequestId("request-coding-main-durable-denial"),
          newToolInputReference: () => toolInputReference("input-coding-main-durable-denial"),
        });
      },
      async openGooseSession(options) {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-durable-denial"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-durable-denial",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            const result = await options.toolInvoker({
              sessionId: "goose-desktop-main-durable-denial",
              toolCallRequestId: "goose-private-denied-tool-call",
              toolId: CODING_FILE_WRITE_TOOL_ID,
              input: Object.freeze({
                contractVersion: 1,
                relativePath: "answer.txt",
                content: "must remain denied\n",
              }),
              signal: new AbortController().signal,
            });
            expect(result).toEqual({
              isError: true,
              content: JSON.stringify({ contractVersion: 1, type: "approval-denied" }),
            });
            return Object.freeze({
              stopReason: "end_turn" as const,
              updates: Object.freeze([
                Object.freeze({
                  type: "agent_message_chunk" as const,
                  text: "The requested isolated change was denied.",
                }),
              ]),
            });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-durable-denial"),
      displayName: "P5.2 durable Goose denial evidence",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main denial result",
          usage: Object.freeze({ promptTokens: 5, completionTokens: 4 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      async approvalDecisionHandler() {
        return Object.freeze({
          decision: "denied" as const,
          actorId: approvalActorId("local-user"),
        });
      },
    });

    await opened.prompt({ text: "Attempt the denied isolated change." });

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
      "approval.resolved",
      "task.updated",
      "tool.failed",
      "agent.message",
      "task.updated",
    ]);
    expect(events[7]).toMatchObject({
      payload: {
        requestId: "request-coding-main-durable-denial",
        errorCode: "approval-denied",
        mayHaveExecuted: false,
      },
    });
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked" }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "ready" }],
      approvals: [{ state: "denied" }],
    });
    expect(fs.readFileSync(path.join(opened.worktreeRoot, "answer.txt"), "utf8")).toBe("before\n");
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(JSON.stringify(events)).not.toContain("must remain denied");

    await opened.close();
  }, 15_000);

  it("cancels an unresolved coding approval before terminal session cleanup", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-approval-cancel", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker({
          ...options,
          newToolRequestId: () => toolRequestId("request-coding-main-durable-approval-cancel"),
          newToolInputReference: () =>
            toolInputReference("input-coding-main-durable-approval-cancel"),
        });
      },
      async openGooseSession(options) {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-approval-cancel"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-approval-cancel",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            const result = await options.toolInvoker({
              sessionId: "goose-desktop-main-approval-cancel",
              toolCallRequestId: "goose-private-approval-cancel-tool-call",
              toolId: CODING_FILE_WRITE_TOOL_ID,
              input: Object.freeze({
                contractVersion: 1,
                relativePath: "answer.txt",
                content: "must remain unapproved\n",
              }),
              signal: new AbortController().signal,
            });
            expect(result).toEqual({
              isError: true,
              content: JSON.stringify({ contractVersion: 1, type: "approval-required" }),
            });
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-durable-approval-cancel"),
      displayName: "P5.2 durable Goose approval cancellation",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused approval cancellation result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    await opened.prompt({ text: "Request a write that remains pending." });
    const pendingGraph = await fixture.persistence.loadDomainGraph();
    const approval = pendingGraph.approvals[0];
    expect(approval).toMatchObject({ state: "pending" });
    await opened.close();

    await expect(opened.approvalService.get(approval!.id)).resolves.toMatchObject({
      state: "cancelled",
      resolvedBy: "actestra-coding-session-close",
    });
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
      "approval.resolved",
      "tool.failed",
      "task.cancelled",
    ]);
    expect(events[5]).toMatchObject({
      payload: { approvalId: approval!.id, decision: "cancelled" },
    });
    expect(events[6]).toMatchObject({
      payload: {
        requestId: "request-coding-main-durable-approval-cancel",
        errorCode: "approval-cancelled",
        mayHaveExecuted: false,
      },
    });
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "cancelled" }],
      sessions: [{ id: fixture.ids.sessionId, state: "cancelled" }],
      workers: [{ id: fixture.ids.workerId, state: "stopped" }],
      approvals: [{ id: approval!.id, state: "cancelled" }],
    });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  }, 15_000);

  it("settles a pending approval before a cancelled Goose prompt becomes terminal", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-prompt-cancel", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker({
          ...options,
          newToolRequestId: () => toolRequestId("request-coding-main-prompt-cancel"),
          newToolInputReference: () => toolInputReference("input-coding-main-prompt-cancel"),
        });
      },
      async openGooseSession(options) {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-prompt-cancel"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-prompt-cancel",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            await options.toolInvoker({
              sessionId: "goose-desktop-main-prompt-cancel",
              toolCallRequestId: "goose-private-prompt-cancel",
              toolId: CODING_FILE_WRITE_TOOL_ID,
              input: Object.freeze({
                contractVersion: 1,
                relativePath: "answer.txt",
                content: "must remain cancelled\n",
              }),
              signal: new AbortController().signal,
            });
            return Object.freeze({ stopReason: "cancelled" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-prompt-cancel"),
      displayName: "P5.2 durable cancelled prompt evidence",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused cancelled prompt result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    await expect(
      opened.prompt({ text: "Cancel with one pending approval." }),
    ).resolves.toMatchObject({ stopReason: "cancelled" });

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
      "approval.resolved",
      "tool.failed",
      "task.cancelled",
    ]);
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "cancelled" }],
      sessions: [{ id: fixture.ids.sessionId, state: "cancelled" }],
      workers: [{ id: fixture.ids.workerId, state: "stopping" }],
      approvals: [{ state: "cancelled" }],
    });
    await expect(opened.close()).resolves.toBeUndefined();
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      workers: [{ id: fixture.ids.workerId, state: "stopped" }],
    });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
  }, 15_000);

  it("retries a lost approval-cancellation acknowledgement without duplicating evidence", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-approval-cancel-loss", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker({
          ...options,
          newToolRequestId: () => toolRequestId("request-coding-main-approval-cancel-loss"),
          newToolInputReference: () => toolInputReference("input-coding-main-approval-cancel-loss"),
        });
      },
      async openGooseSession(options) {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-approval-cancel-loss"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-approval-cancel-loss",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            await options.toolInvoker({
              sessionId: "goose-desktop-main-approval-cancel-loss",
              toolCallRequestId: "goose-private-approval-cancel-loss",
              toolId: CODING_FILE_WRITE_TOOL_ID,
              input: Object.freeze({
                contractVersion: 1,
                relativePath: "answer.txt",
                content: "must remain unapproved\n",
              }),
              signal: new AbortController().signal,
            });
            return Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-approval-cancel-loss"),
      displayName: "P5.2 durable approval cancellation response loss",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused cancellation response-loss result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    await opened.prompt({ text: "Leave one approval pending." });
    const resolveApproval = opened.approvalService.resolve.bind(opened.approvalService);
    let responseLost = false;
    vi.spyOn(opened.approvalService, "resolve").mockImplementation(async (...args) => {
      const result = await resolveApproval(...args);
      if (!responseLost) {
        responseLost = true;
        throw new Error("injected approval cancellation response loss after commit");
      }
      return result;
    });

    await expect(fixture.service.close()).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });
    expect(fs.existsSync(opened.worktreeRoot)).toBe(true);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.not.toBeNull();
    await expect(fixture.service.close()).resolves.toBeUndefined();

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.filter((event) => event.type === "approval.resolved")).toHaveLength(1);
    expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "task.cancelled")).toHaveLength(1);
    await expect(fs.promises.stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("recovers a lost event acknowledgement without invoking the Goose prompt twice", async () => {
    let fixture!: MainServiceFixture;
    let promptInvocations = 0;
    fixture = await openFixture("goose-durable-response-loss", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-response-loss"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-response-loss",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            promptInvocations += 1;
            return Object.freeze({
              stopReason: "end_turn" as const,
              updates: Object.freeze([
                Object.freeze({
                  type: "agent_message_chunk" as const,
                  text: "Durable response-loss evidence.",
                }),
              ]),
            });
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-durable-response-loss"),
      displayName: "P5.2 durable Goose response-loss evidence",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "desktop-main response-loss result",
          usage: Object.freeze({ promptTokens: 5, completionTokens: 4 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    const appendEvent = fixture.persistence.appendEvent.bind(fixture.persistence);
    let responseLost = false;
    vi.spyOn(fixture.persistence, "appendEvent").mockImplementation(async (event) => {
      const result = await appendEvent(event);
      if (event.type === "agent.message" && !responseLost) {
        responseLost = true;
        throw new Error("injected append-event response loss after commit");
      }
      return result;
    });
    const replaceDomainGraph = fixture.persistence.replaceDomainGraph.bind(fixture.persistence);
    let projectionResponseLost = false;
    vi.spyOn(fixture.persistence, "replaceDomainGraph").mockImplementation(async (next) => {
      await replaceDomainGraph(next);
      if (next.tasks[0]?.state === "blocked" && !projectionResponseLost) {
        projectionResponseLost = true;
        throw new Error("injected projection response loss after commit");
      }
    });
    const promptOptions = Object.freeze({ text: "Return durable evidence once." });

    await expect(opened.prompt(promptOptions)).resolves.toMatchObject({ stopReason: "end_turn" });
    await expect(opened.prompt(promptOptions)).resolves.toMatchObject({ stopReason: "end_turn" });

    expect(promptInvocations).toBe(1);
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "agent.message",
      "task.updated",
    ]);
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "blocked" }],
      sessions: [{ id: fixture.ids.sessionId, state: "blocked" }],
      workers: [{ id: fixture.ids.workerId, state: "ready" }],
    });

    await opened.close();
  }, 15_000);

  it("persists sanitized terminal evidence before exposing a Goose prompt failure", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-prompt-failure", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-prompt-failure"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-prompt-failure",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            throw new Error("private Goose provider failure detail");
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-durable-prompt-failure"),
      displayName: "P5.2 durable Goose prompt failure evidence",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused prompt failure result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    await expect(opened.prompt({ text: "Fail with durable evidence." })).rejects.toThrow(
      "private Goose provider failure detail",
    );

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        errorCode: "goose-prompt-failed",
        message: "The isolated Goose prompt failed before review evidence was available.",
        retryable: false,
      },
    });
    expect(events[2]).toMatchObject({
      payload: {
        from: "running",
        to: "failed",
        errorCode: "goose-prompt-failed",
        message: "The isolated Goose prompt failed before review evidence was available.",
      },
    });
    expect(JSON.stringify(events)).not.toContain("private Goose provider failure detail");
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "failed" }],
      workers: [{ id: fixture.ids.workerId, state: "crashed" }],
    });

    await opened.close();
  }, 15_000);

  it("fails a refused-completion prompt with its own incident code and refuses to publish", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-model-completion-refused", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-completion-refused"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-completion-refused",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          // The composition layer detects the refusal and rejects the turn, so
          // the session surface reproduces only that rejection here.
          async prompt() {
            throw new GooseMcpSessionCompositionError(
              "model-completion-refused",
              "Actestra refused every model completion in this Goose prompt turn",
            );
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-completion-refused"),
      displayName: "P6 refused model completion terminal state",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused refused completion result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    await expect(opened.prompt({ text: "Read the README and summarize it." })).rejects.toThrow(
      "Actestra refused every model completion",
    );

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    for (const index of [1, 2]) {
      expect(events[index]).toMatchObject({
        payload: {
          errorCode: "model-completion-refused",
          message:
            "Actestra refused every model completion for this prompt, so no reviewable coding result exists.",
        },
      });
    }
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "failed" }],
      workers: [{ id: fixture.ids.workerId, state: "crashed" }],
    });

    // A refused prompt must never reach `unchanged`/`published`: publish is
    // gated on completed prompt review evidence that failPrompt never wrote.
    await expect(
      opened.publish({
        decisionHandler: async () =>
          Object.freeze({
            decision: "approved" as const,
            actorId: approvalActorId("actor-coding-completion-refused"),
          }),
      }),
    ).rejects.toThrow(/requires completed prompt review evidence/i);

    await opened.close();
  }, 15_000);

  it("records a malformed inference request under its own incident code", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-model-request-rejected", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-request-rejected"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-request-rejected",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            throw new GooseMcpSessionCompositionError(
              "model-request-rejected",
              "Actestra could not read any inference request in this Goose prompt turn",
            );
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-request-rejected"),
      displayName: "P6 malformed inference request terminal state",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused rejected request result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });

    await expect(opened.prompt({ text: "Read the README and summarize it." })).rejects.toThrow(
      "Actestra could not read any inference request",
    );

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    for (const index of [1, 2]) {
      expect(events[index]).toMatchObject({
        payload: {
          errorCode: "model-request-rejected",
          message:
            "Actestra could not read any inference request for this prompt, so no reviewable coding result exists.",
        },
      });
    }
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
    });

    await opened.close();
  }, 15_000);

  it("recovers lost prompt-failure evidence without invoking Goose twice", async () => {
    let fixture!: MainServiceFixture;
    let promptInvocations = 0;
    fixture = await openFixture("goose-durable-prompt-failure-loss", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-prompt-failure-loss"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-prompt-failure-loss",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            promptInvocations += 1;
            throw new Error("private prompt failure retained for retry");
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-prompt-failure-loss"),
      displayName: "P5.2 prompt failure evidence response loss",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused prompt failure response-loss result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
    });
    const appendEvent = fixture.persistence.appendEvent.bind(fixture.persistence);
    let responseLost = false;
    vi.spyOn(fixture.persistence, "appendEvent").mockImplementation(async (event) => {
      const result = await appendEvent(event);
      if (event.type === "worker.failed" && !responseLost) {
        responseLost = true;
        throw new Error("injected prompt failure evidence response loss after commit");
      }
      return result;
    });
    const promptOptions = Object.freeze({ text: "Fail once and persist terminal evidence." });

    await expect(opened.prompt(promptOptions)).rejects.toThrow(
      "private prompt failure retained for retry",
    );
    await expect(opened.prompt(promptOptions)).rejects.toThrow(
      "private prompt failure retained for retry",
    );

    expect(promptInvocations).toBe(1);
    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "failed" }],
      workers: [{ id: fixture.ids.workerId, state: "crashed" }],
    });
    await opened.close();
  }, 15_000);

  it("cancels a pending approval before persisting terminal prompt-failure evidence", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-approval-handler-failure", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker({
          ...options,
          newToolRequestId: () => toolRequestId("request-coding-main-handler-failure"),
          newToolInputReference: () => toolInputReference("input-coding-main-handler-failure"),
        });
      },
      async openGooseSession(options) {
        return Object.freeze({
          info: GOOSE_INFO,
          privateRoot: path.join(fixture.root, "goose-private", "attempt-handler-failure"),
          session: Object.freeze({
            sessionId: "goose-desktop-main-handler-failure",
            setupNotificationKinds: Object.freeze([]),
          }),
          toolNames: Object.freeze([]),
          async prompt() {
            await options.toolInvoker({
              sessionId: "goose-desktop-main-handler-failure",
              toolCallRequestId: "goose-private-handler-failure",
              toolId: CODING_FILE_WRITE_TOOL_ID,
              input: Object.freeze({
                contractVersion: 1,
                relativePath: "answer.txt",
                content: "must not survive handler failure\n",
              }),
              signal: new AbortController().signal,
            });
            throw new Error("unreachable after failed approval handler");
          },
          async close() {},
        });
      },
    });
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-handler-failure"),
      displayName: "P5.2 durable approval handler failure",
      commands: {},
      tests: {},
      artifact: GOOSE_ARTIFACT,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-desktop-main-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused handler failure result",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      async approvalDecisionHandler() {
        throw new Error("private approval handler failure detail");
      },
    });

    await expect(opened.prompt({ text: "Fail the pending approval handler." })).rejects.toThrow(
      "Goose coding approval could not be resolved inside the Tool Gateway",
    );

    const events = await fixture.persistence.replayEvents(opened.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "approval.required",
      "task.updated",
      "worker.blocked",
      "approval.resolved",
      "tool.failed",
      "worker.failed",
      "task.failed",
    ]);
    expect(events[5]).toMatchObject({ payload: { decision: "cancelled" } });
    expect(events[6]).toMatchObject({
      payload: { errorCode: "approval-cancelled", mayHaveExecuted: false },
    });
    expect(JSON.stringify(events)).not.toContain("private approval handler failure detail");
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "failed" }],
      workers: [{ id: fixture.ids.workerId, state: "crashed" }],
      approvals: [{ state: "cancelled" }],
    });
    await expect(opened.close()).resolves.toBeUndefined();
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
  }, 15_000);

  it("persists sanitized terminal evidence before a Goose opening failure is cleaned up", async () => {
    const privateOpeningFailure = new Error("private Goose opening failure detail");
    let worktreeRoot = "";
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-durable-opening-failure", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession(options) {
        worktreeRoot = options.workspaceDirectory;
        throw privateOpeningFailure;
      },
    });
    const identity = deriveGooseCodingEvidenceIdentity(fixture.ids);
    const appendEvent = fixture.persistence.appendEvent.bind(fixture.persistence);
    let failureEvidencePrecedesCleanup = false;
    vi.spyOn(fixture.persistence, "appendEvent").mockImplementation(async (event) => {
      if (event.type === "worker.failed") {
        failureEvidencePrecedesCleanup =
          fs.existsSync(worktreeRoot) &&
          (await fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId)) !== null;
      }
      return appendEvent(event);
    });

    await expect(
      fixture.service.openGoose({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-goose-durable-opening-failure"),
        displayName: "P5.2 durable Goose opening failure evidence",
        commands: {},
        tests: {},
        artifact: GOOSE_ARTIFACT,
        privateRootParent: path.join(fixture.root, "goose-private"),
        modelId: "actestra-desktop-main-model",
        modelInvoker: async () =>
          Object.freeze({
            type: "message" as const,
            text: "unused opening failure result",
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          }),
        taskId: fixture.ids.taskId,
        sessionId: fixture.ids.sessionId,
        workerId: fixture.ids.workerId,
      }),
    ).rejects.toThrow("Desktop-main Goose coding session failed to open");

    expect(failureEvidencePrecedesCleanup).toBe(true);
    const events = await fixture.persistence.replayEvents(identity.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    expect(events[1]).toMatchObject({
      payload: {
        errorCode: "goose-session-open-failed",
        message: "The isolated Goose session failed before coding became available.",
        retryable: false,
      },
    });
    expect(events[2]).toMatchObject({
      payload: {
        from: "running",
        to: "failed",
        errorCode: "goose-session-open-failed",
        message: "The isolated Goose session failed before coding became available.",
      },
    });
    expect(JSON.stringify(events)).not.toContain("private Goose opening failure detail");
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "failed" }],
      workers: [{ id: fixture.ids.workerId, state: "crashed" }],
    });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  }, 15_000);

  it("retries a failed opening-evidence write during service shutdown", async () => {
    let fixture!: MainServiceFixture;
    fixture = await openFixture("goose-opening-evidence-retry", {
      createToolInvoker(options) {
        return createGooseCodingToolInvoker(options);
      },
      async openGooseSession() {
        throw new Error("private Goose opening failure for evidence retry");
      },
    });
    const identity = deriveGooseCodingEvidenceIdentity(fixture.ids);
    const appendEvent = fixture.persistence.appendEvent.bind(fixture.persistence);
    let evidenceWriteRejected = false;
    vi.spyOn(fixture.persistence, "appendEvent").mockImplementation(async (event) => {
      if (event.type === "worker.failed" && !evidenceWriteRejected) {
        evidenceWriteRejected = true;
        throw new Error("injected opening failure evidence write rejection");
      }
      return appendEvent(event);
    });

    await expect(
      fixture.service.openGoose({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-goose-opening-evidence-retry"),
        displayName: "P5.2 opening failure evidence retry",
        commands: {},
        tests: {},
        artifact: GOOSE_ARTIFACT,
        privateRootParent: path.join(fixture.root, "goose-private"),
        modelId: "actestra-desktop-main-model",
        modelInvoker: async () =>
          Object.freeze({
            type: "message" as const,
            text: "unused opening evidence retry result",
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          }),
        taskId: fixture.ids.taskId,
        sessionId: fixture.ids.sessionId,
        workerId: fixture.ids.workerId,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });

    await fixture.service.close();

    const events = await fixture.persistence.replayEvents(identity.streamId);
    expect(events.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    await expect(fixture.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ id: fixture.ids.taskId, state: "failed" }],
      sessions: [{ id: fixture.ids.sessionId, state: "failed" }],
      workers: [{ id: fixture.ids.workerId, state: "crashed" }],
    });
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

  it("continues one MCP file write only after the main-owned approval is persisted", async () => {
    const fixture = await openFixture("goose-mcp-approved");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-mcp-approved"),
      displayName: "P5.2 Goose MCP approved worktree",
      commands: {},
      tests: {},
    });
    let approvalRequest:
      | Readonly<{
          approval: ApprovalRequestSnapshot;
          sessionId: string;
          toolCallRequestId: string;
          signal: AbortSignal;
        }>
      | undefined;
    const actorId = approvalActorId("local-user");
    const invokeTool = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      newToolRequestId: () => toolRequestId("request-coding-main-goose-mcp-approved"),
      newToolInputReference: () => toolInputReference("input-coding-main-goose-mcp-approved"),
      async approvalDecisionHandler(request) {
        approvalRequest = request;
        expect(fs.readFileSync(path.join(session.worktreeRoot, "answer.txt"), "utf8")).toBe(
          "before\n",
        );
        return Object.freeze({ decision: "approved" as const, actorId });
      },
    });

    const result = await invokeTool({
      sessionId: "goose-session-approved",
      toolCallRequestId: "model-tool-call-approved",
      toolId: CODING_FILE_WRITE_TOOL_ID,
      input: Object.freeze({
        contractVersion: 1,
        relativePath: "answer.txt",
        content: "after approval\n",
      }),
      signal: new AbortController().signal,
    });

    expect(approvalRequest).toMatchObject({
      sessionId: "goose-session-approved",
      toolCallRequestId: "model-tool-call-approved",
      approval: {
        state: "pending",
        operation: {
          requestId: "request-coding-main-goose-mcp-approved",
          inputRef: "input-coding-main-goose-mcp-approved",
          toolId: CODING_FILE_WRITE_TOOL_ID,
        },
      },
    });
    expect(result).toEqual({
      isError: false,
      content: JSON.stringify({
        contractVersion: 1,
        type: "file-written",
        relativePath: "answer.txt",
        byteLength: Buffer.byteLength("after approval\n", "utf8"),
      }),
    });
    const approval = await session.approvalService.get(approvalRequest!.approval.approvalId);
    expect(approval).toMatchObject({
      state: "approved",
      resolvedBy: actorId,
      consumedAt: fixture.clock.now(),
    });
    await expect(fixture.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 7,
      lastSequence: 7,
    });
    expect(fs.readFileSync(path.join(session.worktreeRoot, "answer.txt"), "utf8")).toBe(
      "after approval\n",
    );
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  });

  it("fails closed when approval resolution returns a different policy snapshot", async () => {
    const fixture = await openFixture("goose-mcp-approval-mismatch");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-mcp-approval-mismatch"),
      displayName: "P5.2 Goose MCP approval mismatch worktree",
      commands: {},
      tests: {},
    });
    const resolveApproval = session.approvalService.resolve.bind(session.approvalService);
    vi.spyOn(session.approvalService, "resolve").mockImplementationOnce(
      async (approvalId, decision, actorId) => {
        const resolved = await resolveApproval(approvalId, decision, actorId);
        return Object.freeze({
          ...resolved,
          policyRevision: policyRevision("policy-p5-isolated-coding-mismatched"),
        });
      },
    );
    const actorId = approvalActorId("local-user");
    const invokeTool = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      newToolRequestId: () => toolRequestId("request-coding-main-goose-mcp-approval-mismatch"),
      newToolInputReference: () =>
        toolInputReference("input-coding-main-goose-mcp-approval-mismatch"),
      async approvalDecisionHandler() {
        return Object.freeze({ decision: "approved" as const, actorId });
      },
    });

    await expect(
      invokeTool({
        sessionId: "goose-session-approval-mismatch",
        toolCallRequestId: "model-tool-call-approval-mismatch",
        toolId: CODING_FILE_WRITE_TOOL_ID,
        input: Object.freeze({
          contractVersion: 1,
          relativePath: "answer.txt",
          content: "must not be written\n",
        }),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "GooseCodingToolInvokerError",
      code: "invalid-config",
    });
    expect(fs.readFileSync(path.join(session.worktreeRoot, "answer.txt"), "utf8")).toBe("before\n");
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  });

  it("projects a persisted denial back to Goose without executing the MCP file write", async () => {
    const fixture = await openFixture("goose-mcp-denied");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-mcp-denied"),
      displayName: "P5.2 Goose MCP denied worktree",
      commands: {},
      tests: {},
    });
    let approvalRequest: ApprovalRequestSnapshot | undefined;
    const actorId = approvalActorId("local-user");
    const invokeTool = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      newToolRequestId: () => toolRequestId("request-coding-main-goose-mcp-denied"),
      newToolInputReference: () => toolInputReference("input-coding-main-goose-mcp-denied"),
      async approvalDecisionHandler(request) {
        approvalRequest = request.approval;
        return Object.freeze({ decision: "denied" as const, actorId });
      },
    });

    const result = await invokeTool({
      sessionId: "goose-session-denied",
      toolCallRequestId: "model-tool-call-denied",
      toolId: CODING_FILE_WRITE_TOOL_ID,
      input: Object.freeze({
        contractVersion: 1,
        relativePath: "answer.txt",
        content: "must not be written\n",
      }),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      isError: true,
      content: JSON.stringify({ contractVersion: 1, type: "approval-denied" }),
    });
    const approval = await session.approvalService.get(approvalRequest!.approvalId);
    expect(approval).toMatchObject({
      state: "denied",
      resolvedBy: actorId,
    });
    expect(approval).not.toHaveProperty("consumedAt");
    await expect(fixture.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    expect(fs.readFileSync(path.join(session.worktreeRoot, "answer.txt"), "utf8")).toBe("before\n");
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  });

  it("aborts an unresolved main-owned approval decision without executing the MCP file write", async () => {
    const fixture = await openFixture("goose-mcp-approval-abort");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-goose-mcp-approval-abort"),
      displayName: "P5.2 Goose MCP approval abort worktree",
      commands: {},
      tests: {},
    });
    const decisionStarted = deferred<void>();
    const invokeTool = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      newToolRequestId: () => toolRequestId("request-coding-main-goose-mcp-approval-abort"),
      newToolInputReference: () => toolInputReference("input-coding-main-goose-mcp-approval-abort"),
      async approvalDecisionHandler() {
        decisionStarted.resolve();
        return new Promise<never>(() => undefined);
      },
    });
    const controller = new AbortController();
    let invocationOutcome:
      | Readonly<{ status: "fulfilled"; value: unknown }>
      | Readonly<{ status: "rejected"; reason: unknown }>
      | undefined;
    void invokeTool({
      sessionId: "goose-session-approval-abort",
      toolCallRequestId: "model-tool-call-approval-abort",
      toolId: CODING_FILE_WRITE_TOOL_ID,
      input: Object.freeze({
        contractVersion: 1,
        relativePath: "answer.txt",
        content: "must not be written\n",
      }),
      signal: controller.signal,
    }).then(
      (value) => {
        invocationOutcome = Object.freeze({ status: "fulfilled", value });
      },
      (reason: unknown) => {
        invocationOutcome = Object.freeze({ status: "rejected", reason });
      },
    );
    await decisionStarted.promise;

    controller.abort("approval-request-cancelled");
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(invocationOutcome).toMatchObject({
      status: "rejected",
      reason: { name: "GooseCodingToolInvokerError", code: "gateway-failed" },
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

describe.skipIf(
  REAL_GOOSE_ARTIFACT_DIRECTORY === undefined ||
    REAL_GOOSE_MANIFEST_SHA256 === undefined ||
    REAL_GOOSE_TARGET_TRIPLE === undefined,
)("P5.2 real Goose desktop-main approval outcomes", () => {
  it("continues the real Goose prompt after the main-owned approval is consumed", async () => {
    const artifact = await admitGooseRunnerArtifact(REAL_GOOSE_ARTIFACT_DIRECTORY!, {
      expectedTargetTriple: REAL_GOOSE_TARGET_TRIPLE!,
      trustedManifestSha256: REAL_GOOSE_MANIFEST_SHA256!,
    });
    const fixture = await openFixture("real-goose-approved");
    const privateRootParent = path.join(fixture.root, "goose-private");
    fs.mkdirSync(privateRootParent, { mode: 0o700 });
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const actorId = approvalActorId("local-user");
    let approvalRequest: ApprovalRequestSnapshot | undefined;
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-real-goose-approved"),
      displayName: "P5.2 real Goose approved worktree",
      commands: {
        "format-check": Object.freeze({ executablePath: "/usr/bin/true", args: [] }),
      },
      tests: {
        "focused-tests": Object.freeze({ executablePath: "/usr/bin/true", args: [] }),
      },
      artifact,
      privateRootParent,
      modelId: "actestra-loopback-approval-integration",
      async modelInvoker(invocation) {
        modelInvocations.push(invocation);
        if (modelInvocations.length === 1) {
          return Object.freeze({
            type: "tool-call" as const,
            callId: "call-actestra-approved-1",
            name: `actestra-capability-proxy__${CODING_FILE_WRITE_TOOL_ID}`,
            arguments: Object.freeze({
              contractVersion: 1,
              relativePath: "answer.txt",
              content: "real Goose approved\n",
            }),
            usage: Object.freeze({ promptTokens: 31, completionTokens: 7 }),
          });
        }
        if (modelInvocations.length === 2) {
          return Object.freeze({
            type: "message" as const,
            text: "approved integration final answer",
            usage: Object.freeze({ promptTokens: 47, completionTokens: 4 }),
          });
        }
        throw new Error("Goose exceeded the admitted approved integration exchange");
      },
      async approvalDecisionHandler(request) {
        approvalRequest = request.approval;
        return Object.freeze({ decision: "approved" as const, actorId });
      },
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    try {
      const prompt = await opened.prompt({
        text: "Write answer.txt through the approved Actestra capability.",
        timeoutMs: 30_000,
      });

      expect(prompt.stopReason).toBe("end_turn");
      expect(prompt.updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_call" }),
          expect.objectContaining({ type: "tool_call_update", status: "completed" }),
          expect.objectContaining({
            type: "agent_message_chunk",
            text: "approved integration final answer",
          }),
        ]),
      );
      expect(modelInvocations[1]!.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            toolCalls: expect.arrayContaining([
              expect.objectContaining({ callId: "call-actestra-approved-1" }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            callId: "call-actestra-approved-1",
            content: expect.stringContaining("file-written"),
          }),
        ]),
      );
      const approval = await opened.approvalService.get(approvalRequest!.approvalId);
      expect(approval).toMatchObject({ state: "approved", resolvedBy: actorId });
      expect(approval).toHaveProperty("consumedAt");
      await expect(fixture.persistence.summarizePrivilegedAudit()).resolves.toEqual({
        recordCount: 7,
        lastSequence: 7,
      });
      expect(fs.readFileSync(path.join(opened.worktreeRoot, "answer.txt"), "utf8")).toBe(
        "real Goose approved\n",
      );
      expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    } finally {
      await opened.close();
    }
  }, 60_000);

  it("projects a main-owned denial through the real Goose prompt without executing", async () => {
    const artifact = await admitGooseRunnerArtifact(REAL_GOOSE_ARTIFACT_DIRECTORY!, {
      expectedTargetTriple: REAL_GOOSE_TARGET_TRIPLE!,
      trustedManifestSha256: REAL_GOOSE_MANIFEST_SHA256!,
    });
    const fixture = await openFixture("real-goose-denied");
    const privateRootParent = path.join(fixture.root, "goose-private");
    fs.mkdirSync(privateRootParent, { mode: 0o700 });
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const actorId = approvalActorId("local-user");
    let approvalRequest: ApprovalRequestSnapshot | undefined;
    const opened = await fixture.service.openGoose({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-real-goose-denied"),
      displayName: "P5.2 real Goose denied worktree",
      commands: {
        "format-check": Object.freeze({ executablePath: "/usr/bin/true", args: [] }),
      },
      tests: {
        "focused-tests": Object.freeze({ executablePath: "/usr/bin/true", args: [] }),
      },
      artifact,
      privateRootParent,
      modelId: "actestra-loopback-denial-integration",
      async modelInvoker(invocation) {
        modelInvocations.push(invocation);
        if (modelInvocations.length === 1) {
          return Object.freeze({
            type: "tool-call" as const,
            callId: "call-actestra-denied-1",
            name: `actestra-capability-proxy__${CODING_FILE_WRITE_TOOL_ID}`,
            arguments: Object.freeze({
              contractVersion: 1,
              relativePath: "answer.txt",
              content: "must not be written\n",
            }),
            usage: Object.freeze({ promptTokens: 31, completionTokens: 7 }),
          });
        }
        if (modelInvocations.length === 2) {
          return Object.freeze({
            type: "message" as const,
            text: "denied integration final answer",
            usage: Object.freeze({ promptTokens: 47, completionTokens: 4 }),
          });
        }
        throw new Error("Goose exceeded the admitted denied integration exchange");
      },
      async approvalDecisionHandler(request) {
        approvalRequest = request.approval;
        return Object.freeze({ decision: "denied" as const, actorId });
      },
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    try {
      const prompt = await opened.prompt({
        text: "Attempt answer.txt through the Actestra capability and respect denial.",
        timeoutMs: 30_000,
      });

      expect(prompt.stopReason).toBe("end_turn");
      expect(prompt.updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_call" }),
          expect.objectContaining({ type: "tool_call_update", status: "failed" }),
          expect.objectContaining({
            type: "agent_message_chunk",
            text: "denied integration final answer",
          }),
        ]),
      );
      expect(modelInvocations[1]!.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            toolCalls: expect.arrayContaining([
              expect.objectContaining({ callId: "call-actestra-denied-1" }),
            ]),
          }),
          expect.objectContaining({
            role: "tool",
            callId: "call-actestra-denied-1",
            content: expect.stringContaining("approval-denied"),
          }),
        ]),
      );
      const approval = await opened.approvalService.get(approvalRequest!.approvalId);
      expect(approval).toMatchObject({ state: "denied", resolvedBy: actorId });
      expect(approval).not.toHaveProperty("consumedAt");
      await expect(fixture.persistence.summarizePrivilegedAudit()).resolves.toEqual({
        recordCount: 3,
        lastSequence: 3,
      });
      expect(fs.readFileSync(path.join(opened.worktreeRoot, "answer.txt"), "utf8")).toBe(
        "before\n",
      );
      expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    } finally {
      await opened.close();
    }
  }, 60_000);
});
