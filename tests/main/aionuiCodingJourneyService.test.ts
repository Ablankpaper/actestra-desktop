// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashAionUiGeneralWorkConversation } from "../../apps/desktop/src/compatibility/aionui";
import {
  CODING_FILE_WRITE_TOOL_ID,
  CODING_ARTIFACT_PUBLISH_TOOL_ID,
  CODING_TEST_TOOL_ID,
  PRIVILEGED_CONTRACT_VERSION,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  approvalId,
  artifactId,
  auditRecordId,
  eventId,
  instant,
  policyRevision,
  toolInputReference,
  toolRequestId,
  type ApprovalRequestSnapshot,
  type CoreEvent,
} from "../../apps/desktop/src/core";
import {
  AionUiCodingJourneyService,
  AionUiCodingJourneyServiceError,
  deriveAionUiCodingJourneyIdentities,
} from "../../apps/desktop/src/main/compatibility/aionuiCodingJourneyService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { deriveGooseCodingEvidenceIdentity } from "../../apps/desktop/src/main/workers/gooseCodingEvidenceCoordinator";
import { createIsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import type {
  GooseCodingMainSession,
  IsolatedCodingMainService,
  OpenGooseCodingMainSessionOptions,
} from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  GIT_EXECUTABLE,
  workspaceGitEnvironment,
} from "../../apps/desktop/src/main/workers/workspaceGitBinding";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const execFileAsync = promisify(execFile);
const testDirectories: string[] = [];
const persistenceClients: Array<Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"]> =
  [];

const artifact = Object.freeze({
  directory: "/private/tmp/actestra-goose-runner",
  executablePath: "/private/tmp/actestra-goose-runner/actestra-goose-runner",
  executableSha256: "a".repeat(64),
  executableSize: 1,
  targetTriple: "aarch64-apple-darwin",
  gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseVersion: "1.45.0",
  manifestPath: "/private/tmp/actestra-goose-runner/actestra-goose-runner.manifest.json",
  manifestSha256: "b".repeat(64),
}) satisfies AdmittedGooseRunnerArtifact;

async function runGit(repositoryRoot: string, ...arguments_: readonly string[]): Promise<string> {
  const result = await execFileAsync(GIT_EXECUTABLE, ["-C", repositoryRoot, ...arguments_], {
    encoding: "utf8",
    env: workspaceGitEnvironment(repositoryRoot),
  });
  return result.stdout.trim();
}

async function createRepositoryFixture(): Promise<{
  readonly root: string;
  readonly repositoryRoot: string;
  readonly repositoryAlias: string;
}> {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-coding-journey-test-")),
  );
  testDirectories.push(root);
  const repositoryRoot = path.join(root, "source");
  const repositoryAlias = path.join(root, "native-workspace");
  fs.mkdirSync(repositoryRoot);
  await runGit(repositoryRoot, "init", "--initial-branch=main");
  await runGit(repositoryRoot, "config", "user.name", "Actestra Test");
  await runGit(repositoryRoot, "config", "user.email", "actestra-test@example.invalid");
  fs.writeFileSync(path.join(repositoryRoot, "answer.txt"), "before\n", "utf8");
  await runGit(repositoryRoot, "add", "answer.txt");
  await runGit(repositoryRoot, "commit", "-m", "fixture");
  fs.symlinkSync(repositoryRoot, repositoryAlias, "dir");
  return { root, repositoryRoot, repositoryAlias };
}

afterEach(async () => {
  for (const persistence of persistenceClients.splice(0)) {
    await persistence.close().catch(() => undefined);
  }
  for (const directory of testDirectories.splice(0)) {
    if (
      !directory.startsWith(
        path.join(fs.realpathSync(os.tmpdir()), "actestra-aionui-coding-journey-test-"),
      )
    ) {
      throw new Error(`Refusing to remove unexpected test directory ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AionUiCodingJourneyService", () => {
  it("registers fixed Actestra identities before opening Goose on the canonical native Git root", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-08-04T06:00:00.000Z"));
    let settlePrompt!: (value: {
      readonly stopReason: "cancelled";
      readonly updates: readonly [];
    }) => void;
    const promptResult = new Promise<{
      readonly stopReason: "cancelled";
      readonly updates: readonly [];
    }>((resolve) => {
      settlePrompt = resolve;
    });
    const prompt = vi.fn(() => promptResult);
    const closeGoose = vi.fn(async () => undefined);
    const openGooseSession = vi.fn(async () =>
      Object.freeze({
        info: Object.freeze({
          protocolVersion: 1 as const,
          agentName: "goose" as const,
          agentVersion: "1.45.0" as const,
          loadSession: true as const,
          prompt: Object.freeze({
            image: true as const,
            audio: false as const,
            embeddedContext: true as const,
          }),
          mcp: Object.freeze({ http: true as const, sse: false as const, acp: false as const }),
          session: Object.freeze({ list: true as const, close: true as const }),
        }),
        privateRoot: path.join(fixture.root, "goose-private", "attempt"),
        session: Object.freeze({
          sessionId: "goose-aionui-coding-journey",
          setupNotificationKinds: Object.freeze([]),
        }),
        toolNames: Object.freeze([]),
        prompt,
        close: closeGoose,
      }),
    );
    const mainService = createIsolatedCodingMainService(
      {
        persistence,
        clock,
        managedRoot: path.join(fixture.root, "coding-worktrees"),
      },
      {
        createToolInvoker: vi.fn(() => async () => {
          throw new Error("The background prompt must not call a tool in this test");
        }),
        openGooseSession,
      },
    );
    const requireAdmittedArtifact = vi.fn(async () => artifact);
    const nativeResolve = vi.fn(async () => ({
      rootPath: fixture.repositoryAlias,
      displayName: "Native coding workspace",
    }));
    const modelInvoker = vi.fn(async () =>
      Object.freeze({
        type: "message" as const,
        text: "fixture model response",
        usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
      }),
    );
    const service = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: { resolve: nativeResolve },
      codingAgent: { requireAdmittedArtifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker,
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-conversation";
    const submissionId = "submission-coding-1";
    const projection = await service.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId,
      prompt: "Update the fixture and run the focused test.",
    });

    const conversationHash = hashAionUiGeneralWorkConversation(nativeConversationId);
    expect(projection.taskId).toMatch(/^task-aionui-coding-[a-f0-9]{64}$/u);
    expect(projection).toMatchObject({
      status: "running",
      stage: "working",
      title: "Update the fixture and run the focused test.",
      canCancel: true,
      messages: [],
      tools: [],
      artifacts: [],
    });
    const digest = projection.taskId.slice("task-aionui-coding-".length);
    await expect(persistence.loadDomainGraph()).resolves.toEqual({
      workspaces: [
        expect.objectContaining({
          id: `workspace-aionui-coding-${conversationHash}`,
          name: "Native coding workspace",
          state: "active",
        }),
      ],
      tasks: [
        expect.objectContaining({
          id: `task-aionui-coding-${digest}`,
          workspaceId: `workspace-aionui-coding-${conversationHash}`,
          state: "running",
          activeSessionId: `session-aionui-coding-${digest}`,
        }),
      ],
      sessions: [
        expect.objectContaining({
          id: `session-aionui-coding-${digest}`,
          workerId: `worker-aionui-coding-${digest}`,
          state: "running",
        }),
      ],
      workers: [
        expect.objectContaining({
          id: `worker-aionui-coding-${digest}`,
          adapterKind: "goose",
          state: "busy",
        }),
      ],
      approvals: [],
      artifacts: [],
    });
    expect(nativeResolve).toHaveBeenCalledWith(nativeConversationId);
    expect(requireAdmittedArtifact).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith({
      text: "Update the fixture and run the focused test.",
      humanDecisionGate: {
        hold: expect.any(Function),
        subscribe: expect.any(Function),
      },
    });
    expect(mainService.managedRoot).toBe(path.join(fixture.root, "coding-worktrees"));
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");

    settlePrompt({ stopReason: "cancelled", updates: [] });
    await service.waitForIdle(projection.taskId);
    await service.close();
    expect(closeGoose).toHaveBeenCalledTimes(1);
  });

  it("does not let aggregate idle cleanup consume a publisher failure before its owner", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const failure = new Error("publisher-failed");
    let rejectPublish!: (reason?: unknown) => void;
    const publishResult = new Promise<never>((_resolve, reject) => {
      rejectPublish = reject;
    });
    const openGoose = vi.fn(
      async () =>
        Object.freeze({
          prompt: vi.fn(async () =>
            Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) }),
          ),
          publish: vi.fn(() => publishResult),
          close: vi.fn(async () => undefined),
        }) as unknown as GooseCodingMainSession,
    );
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock: new DeterministicAgentClock(instant("2026-08-04T06:05:00.000Z")),
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native coding failure workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-failure-conversation";
    const submitted = await service.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId: "submission-coding-failure-1",
      prompt: "Run the failing isolated coding attempt.",
    });

    const aggregateWait = service.waitForIdle();
    const taskWait = service.waitForIdle(submitted.taskId);
    rejectPublish(failure);
    const [aggregateOutcome, taskOutcome] = await Promise.all([
      aggregateWait.then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ),
      taskWait.then(
        () => ({ status: "fulfilled" as const }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ),
    ]);

    expect(taskOutcome).toMatchObject({ status: "rejected", reason: failure });
    expect(aggregateOutcome).toMatchObject({ status: "fulfilled" });
    await service.close();
  });

  it("retains a publish-close failure so service shutdown can retry the session", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const closeFailure = new Error("publish-close-failed");
    let closeAttempts = 0;
    const openGoose = vi.fn(
      async () =>
        Object.freeze({
          prompt: vi.fn(async () =>
            Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) }),
          ),
          publish: vi.fn(async () => Object.freeze({ status: "published" as const })),
          close: vi.fn(async () => {
            closeAttempts += 1;
            if (closeAttempts < 3) throw closeFailure;
          }),
        }) as unknown as GooseCodingMainSession,
    );
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock: new DeterministicAgentClock(instant("2026-08-04T06:06:00.000Z")),
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native coding close-failure workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const submitted = await service.submit({
      contractVersion: 1,
      nativeConversationId: "native-coding-close-failure-conversation",
      submissionId: "submission-coding-close-failure-1",
      prompt: "Publish and close the isolated coding attempt.",
    });

    await expect(service.waitForIdle(submitted.taskId)).rejects.toBe(closeFailure);
    await service.close();
    expect(closeAttempts).toBe(3);
  });

  it("serializes shutdown with the completion close after publish", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    let releaseClose!: () => void;
    const closeReleased = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let closeStarted!: () => void;
    const closeObserved = new Promise<void>((resolve) => {
      closeStarted = resolve;
    });
    let closeAttempts = 0;
    const openGoose = vi.fn(
      async () =>
        Object.freeze({
          prompt: vi.fn(async () =>
            Object.freeze({ stopReason: "end_turn" as const, updates: Object.freeze([]) }),
          ),
          publish: vi.fn(async () => Object.freeze({ status: "published" as const })),
          close: vi.fn(async () => {
            closeAttempts += 1;
            closeStarted();
            await closeReleased;
          }),
        }) as unknown as GooseCodingMainSession,
    );
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock: new DeterministicAgentClock(instant("2026-08-04T06:07:00.000Z")),
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native coding close-race workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    await service.submit({
      contractVersion: 1,
      nativeConversationId: "native-coding-close-race-conversation",
      submissionId: "submission-coding-close-race-1",
      prompt: "Publish while shutdown begins.",
    });

    await closeObserved;
    const shutdown = service.close();
    await Promise.resolve();
    expect(closeAttempts).toBe(1);
    releaseClose();
    await shutdown;
    expect(closeAttempts).toBe(1);
  });

  it("rejects a workspace that is not a Git root and names which remedy applies", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const nestedRoot = path.join(fixture.repositoryRoot, "nested");
    fs.mkdirSync(nestedRoot);
    const cases = [
      { rootPath: fixture.root, expected: /is not a Git repository$/u },
      { rootPath: nestedRoot, expected: /is a subdirectory of one$/u },
    ] as const;

    for (const [index, { rootPath, expected }] of cases.entries()) {
      const nativeResolve = vi.fn(async () => ({
        rootPath,
        displayName: "Native coding workspace",
      }));
      const service = new AionUiCodingJourneyService({
        persistence,
        clock: new DeterministicAgentClock(instant("2026-08-04T06:00:00.000Z")),
        nativeContext: { resolve: nativeResolve },
        codingAgent: { requireAdmittedArtifact: vi.fn(async () => artifact) },
        getMainService: () => null,
        privateRootParent: path.join(fixture.root, "goose-private"),
        modelId: "actestra-fixture-model",
        modelInvoker: vi.fn(async () =>
          Object.freeze({
            type: "message" as const,
            text: "fixture model response",
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          }),
        ),
        commands: {},
        tests: {},
      });

      const rejection = await service
        .submit({
          contractVersion: 1,
          nativeConversationId: `native-coding-conversation-${String(index)}`,
          submissionId: `submission-coding-workspace-${String(index)}`,
          prompt: "Update the fixture and run the focused test.",
        })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(rejection).toBeInstanceOf(AionUiCodingJourneyServiceError);
      const failure = rejection as AionUiCodingJourneyServiceError;
      expect(failure.code).toBe("workspace-unavailable");
      expect(failure.message).toMatch(expected);
      expect(failure.message).not.toContain(rootPath);
      await expect(persistence.loadDomainGraph()).resolves.toEqual({
        workspaces: [],
        tasks: [],
        sessions: [],
        workers: [],
        approvals: [],
        artifacts: [],
      });
      await service.close();
    }
  });

  it("holds a Team tool approval until real audit outcome is persisted before Goose resumes", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-08-04T06:10:00.000Z"));
    let receivedDecision:
      | Readonly<{ decision: "approved" | "denied"; actorId: string }>
      | undefined;
    let pendingApproval: ApprovalRequestSnapshot | undefined;
    const order: string[] = [];
    const openGoose = vi.fn(async (options: OpenGooseCodingMainSessionOptions) => {
      const prompt = vi.fn(async () => {
        const requestedAt = clock.now();
        const requestId = toolRequestId(`request-aionui-coding-${"c".repeat(64)}`);
        const operation = Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          requestId,
          workspaceId: options.workspaceId,
          taskId: options.taskId,
          sessionId: options.sessionId,
          workerId: options.workerId,
          toolId: CODING_FILE_WRITE_TOOL_ID,
          inputRef: toolInputReference(`input-aionui-coding-${"d".repeat(64)}`),
          action: "workspace.modify" as const,
          resourceKind: "repository" as const,
          summary: "Edit the isolated fixture file",
          credentialRefs: Object.freeze([]),
          requestedAt,
        });
        pendingApproval = Object.freeze({
          approvalId: approvalId(`approval-coding-${"e".repeat(64)}`),
          policyRevision: policyRevision("policy-isolated-coding-v1"),
          operation,
          state: "pending" as const,
          requestedAt,
          expiresAt: instant("2026-08-04T06:20:00.000Z"),
        });
        const graph = await persistence.loadDomainGraph();
        await persistence.replaceDomainGraph({
          ...graph,
          tasks: graph.tasks.map((task) =>
            task.id === options.taskId ? { ...task, state: "blocked" as const } : task,
          ),
          sessions: graph.sessions.map((session) =>
            session.id === options.sessionId ? { ...session, state: "blocked" as const } : session,
          ),
          approvals: [
            ...graph.approvals,
            {
              id: pendingApproval.approvalId,
              workspaceId: options.workspaceId,
              taskId: options.taskId,
              sessionId: options.sessionId,
              action: operation.action,
              state: "pending" as const,
              requestedAt,
              expiresAt: pendingApproval.expiresAt,
            },
          ],
        });
        if (options.approvalDecisionHandler === undefined) {
          throw new Error("The retained coding journey did not install its approval handler");
        }
        receivedDecision = await options.approvalDecisionHandler({
          approval: pendingApproval,
          sessionId: "goose-native-approval",
          toolCallRequestId: "tool-call-native-approval",
          signal: new AbortController().signal,
        });
        order.push("goose-resumed");
        const decidedGraph = await persistence.loadDomainGraph();
        await persistence.replaceDomainGraph({
          ...decidedGraph,
          tasks: decidedGraph.tasks.map((task) =>
            task.id === options.taskId
              ? { ...task, state: "cancelled" as const, activeSessionId: undefined }
              : task,
          ),
          sessions: decidedGraph.sessions.map((session) =>
            session.id === options.sessionId
              ? { ...session, state: "cancelled" as const }
              : session,
          ),
          workers: decidedGraph.workers.map((worker) =>
            worker.id === options.workerId ? { ...worker, state: "stopped" as const } : worker,
          ),
          approvals: decidedGraph.approvals.map((approval) =>
            approval.id === pendingApproval!.approvalId
              ? { ...approval, state: receivedDecision!.decision, resolvedAt: clock.now() }
              : approval,
          ),
        });
        return Object.freeze({ stopReason: "cancelled" as const, updates: Object.freeze([]) });
      });
      const approvalService = Object.freeze({
        authorize: vi.fn(),
        get: vi.fn(async () => undefined),
        resolve: vi.fn(async (_approvalId, decision, actorId) => {
          order.push("approval-resolved");
          return Object.freeze({
            ...pendingApproval!,
            state: decision,
            resolvedAt: clock.now(),
            resolvedBy: actorId,
          });
        }),
      });
      const approvalAuditEvidence = Object.freeze({
        pending: vi.fn(() =>
          Object.freeze({
            policyAuditRecordId: auditRecordId("audit-team-coding-policy"),
            requestAuditRecordId: auditRecordId("audit-team-coding-request"),
          }),
        ),
        recordDecision: vi.fn(async () => {
          order.push("decision-audited");
          return auditRecordId("audit-team-coding-decision");
        }),
        resolution: vi.fn(() => auditRecordId("audit-team-coding-outcome")),
      });
      return Object.freeze({
        prompt,
        publish: vi.fn(),
        close: vi.fn(async () => undefined),
        approvalService,
        approvalAuditEvidence,
      }) as unknown as GooseCodingMainSession;
    });
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native approval workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message",
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-approval-conversation";
    const submissionId = "submission-coding-approval-1";
    const expectedTaskId = deriveAionUiCodingJourneyIdentities(
      nativeConversationId,
      submissionId,
    ).taskId;
    const approvalObserved = vi.fn(async () => {
      order.push("team-block-persisted");
    });
    const stopObserving = service.observeApproval(expectedTaskId, approvalObserved);
    const submitted = await service.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId,
      prompt: "Edit the isolated fixture file.",
    });

    await vi.waitFor(async () => {
      const [projection] = await service.list(nativeConversationId);
      expect(projection).toMatchObject({
        taskId: submitted.taskId,
        status: "blocked",
        stage: "approval-required",
        approval: {
          kind: "tool",
          approvalId: pendingApproval?.approvalId,
          toolCallId: "tool-call-native-approval",
          operationKind: "edit",
          summary: "Edit the isolated fixture file",
        },
      });
    });
    expect(approvalObserved).toHaveBeenCalledWith({
      approvalId: pendingApproval!.approvalId,
      policyAuditRecordId: "audit-team-coding-policy",
      requestAuditRecordId: "audit-team-coding-request",
      reason: "Edit the isolated fixture file",
    });
    await expect(
      service.decideApproval(
        "different-native-conversation",
        submitted.taskId,
        pendingApproval!.approvalId,
        "approved",
      ),
    ).rejects.toMatchObject({ code: "task-not-owned" });
    await expect(
      service.prepareTeamApprovalDecision(
        submitted.taskId,
        pendingApproval!.approvalId,
        "approved",
      ),
    ).resolves.toEqual({ decisionAuditRecordId: "audit-team-coding-decision" });
    expect(receivedDecision).toBeUndefined();
    await service.commitTeamApprovalDecision(
      submitted.taskId,
      pendingApproval!.approvalId,
      "approved",
      async ({ outcomeAuditRecordId }) => {
        expect(outcomeAuditRecordId).toBe("audit-team-coding-outcome");
        order.push("team-outcome-persisted");
      },
    );
    await service.waitForIdle(submitted.taskId);

    expect(receivedDecision).toEqual({
      decision: "approved",
      actorId: "actestra-team-owner",
    });
    expect(order).toEqual([
      "team-block-persisted",
      "decision-audited",
      "approval-resolved",
      "team-outcome-persisted",
      "goose-resumed",
    ]);
    stopObserving();
    expect(openGoose).toHaveBeenCalledTimes(1);
    const [cancelled] = await service.list(nativeConversationId);
    expect(cancelled).toEqual(
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "cancelled",
        stage: "cancelled",
      }),
    );
    expect(cancelled).not.toHaveProperty("approval");
  });

  it("projects native ACP updates and pauses automatic publish on the exact patch snapshot", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-08-04T06:30:00.000Z"));
    let publishDecision: Readonly<{ decision: "approved" | "denied"; actorId: string }> | undefined;
    let publishApproval: ApprovalRequestSnapshot | undefined;
    const snapshot = Object.freeze({
      baseCommit: "1".repeat(40),
      patchByteLength: 321,
      patchSha256: "2".repeat(64),
    });
    const closeGoose = vi.fn(async () => undefined);
    const openGoose = vi.fn(async (options: OpenGooseCodingMainSessionOptions) => {
      const prompt = vi.fn(async () => {
        const graph = await persistence.loadDomainGraph();
        await persistence.replaceDomainGraph({
          ...graph,
          tasks: graph.tasks.map((task) =>
            task.id === options.taskId ? { ...task, state: "blocked" as const } : task,
          ),
          sessions: graph.sessions.map((session) =>
            session.id === options.sessionId ? { ...session, state: "blocked" as const } : session,
          ),
          workers: graph.workers.map((worker) =>
            worker.id === options.workerId ? { ...worker, state: "ready" as const } : worker,
          ),
        });
        return Object.freeze({
          stopReason: "end_turn" as const,
          updates: Object.freeze([
            Object.freeze({
              type: "agent_message_chunk" as const,
              messageId: "assistant-native-coding-1",
              text: "The fixture was updated and its focused test passed.",
            }),
            Object.freeze({
              type: "tool_call" as const,
              toolCallId: "tool-native-edit-1",
              title: "Edit answer.txt",
              kind: "edit" as const,
              status: "in_progress" as const,
              content: Object.freeze([
                Object.freeze({
                  type: "diff" as const,
                  path: "answer.txt",
                  oldText: "before\n",
                  newText: "after\n",
                }),
              ]),
            }),
            Object.freeze({
              type: "tool_call_update" as const,
              toolCallId: "tool-native-edit-1",
              status: "completed" as const,
            }),
            Object.freeze({
              type: "tool_call" as const,
              toolCallId: "tool-native-test-1",
              title: "Run focused test",
              kind: "execute" as const,
              status: "completed" as const,
              content: Object.freeze([
                Object.freeze({
                  type: "content" as const,
                  content: Object.freeze({ type: "text" as const, text: "1 test passed" }),
                }),
              ]),
            }),
          ]),
        });
      });
      const publish = vi.fn(async (publishOptions) => {
        const requestedAt = clock.now();
        const operation = Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          requestId: toolRequestId(`request-coding-publish-${"3".repeat(64)}`),
          workspaceId: options.workspaceId,
          taskId: options.taskId,
          sessionId: options.sessionId,
          workerId: options.workerId,
          toolId: CODING_ARTIFACT_PUBLISH_TOOL_ID,
          inputRef: toolInputReference(`input-coding-publish-${"4".repeat(64)}`),
          action: "publish.execute" as const,
          resourceKind: "repository" as const,
          summary:
            "Save the reviewed isolated coding patch as an Actestra Artifact. This does not modify the original workspace.",
          credentialRefs: Object.freeze([]),
          requestedAt,
        });
        const pendingPublishApproval = Object.freeze({
          approvalId: approvalId(`approval-coding-${"5".repeat(64)}`),
          policyRevision: policyRevision("policy-isolated-coding-v1"),
          operation,
          state: "pending" as const,
          requestedAt,
          expiresAt: instant("2026-08-04T06:40:00.000Z"),
        });
        publishApproval = pendingPublishApproval;
        const graph = await persistence.loadDomainGraph();
        await persistence.replaceDomainGraph({
          ...graph,
          approvals: [
            ...graph.approvals,
            {
              id: pendingPublishApproval.approvalId,
              workspaceId: options.workspaceId,
              taskId: options.taskId,
              sessionId: options.sessionId,
              action: operation.action,
              state: "pending" as const,
              requestedAt,
              expiresAt: pendingPublishApproval.expiresAt,
            },
          ],
        });
        publishDecision = await publishOptions.decisionHandler({
          approval: pendingPublishApproval,
          snapshot,
          signal: new AbortController().signal,
        });
        const artifact = Object.freeze({
          id: artifactId(`artifact-coding-${"6".repeat(64)}`),
          workspaceId: options.workspaceId,
          taskId: options.taskId,
          sessionId: options.sessionId,
          kind: "file" as const,
          label: "Actestra coding patch",
          state: "available" as const,
          createdAt: clock.now(),
          updatedAt: clock.now(),
        });
        const decidedGraph = await persistence.loadDomainGraph();
        await persistence.replaceDomainGraph({
          ...decidedGraph,
          tasks: decidedGraph.tasks.map((task) =>
            task.id === options.taskId
              ? { ...task, state: "completed" as const, activeSessionId: undefined }
              : task,
          ),
          sessions: decidedGraph.sessions.map((session) =>
            session.id === options.sessionId
              ? { ...session, state: "completed" as const }
              : session,
          ),
          workers: decidedGraph.workers.map((worker) =>
            worker.id === options.workerId ? { ...worker, state: "stopped" as const } : worker,
          ),
          approvals: decidedGraph.approvals.map((approval) =>
            approval.id === publishApproval!.approvalId
              ? { ...approval, state: publishDecision!.decision, resolvedAt: clock.now() }
              : approval,
          ),
          artifacts: [...decidedGraph.artifacts, artifact],
        });
        return Object.freeze({
          status: "published" as const,
          baseCommit: snapshot.baseCommit,
          artifact,
          output: Object.freeze({}),
        });
      });
      return Object.freeze({
        prompt,
        publish,
        close: closeGoose,
      }) as unknown as GooseCodingMainSession;
    });
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native publish workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message",
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-publish-conversation";
    const submitted = await service.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId: "submission-coding-publish-1",
      prompt: "Update the fixture and run the focused test.",
    });

    await vi.waitFor(async () => {
      const [projection] = await service.list(nativeConversationId);
      expect(projection).toMatchObject({
        taskId: submitted.taskId,
        status: "blocked",
        stage: "publish-approval-required",
        messages: [
          {
            messageId: "assistant-native-coding-1",
            text: "The fixture was updated and its focused test passed.",
          },
        ],
        tools: expect.arrayContaining([
          expect.objectContaining({
            toolCallId: "tool-native-edit-1",
            status: "completed",
            surface: "diff",
          }),
          expect.objectContaining({
            toolCallId: "tool-native-test-1",
            status: "completed",
            surface: "test",
          }),
        ]),
        approval: {
          kind: "publish",
          approvalId: publishApproval?.approvalId,
          snapshot,
        },
      });
    });
    await expect(
      service.decidePublish(
        nativeConversationId,
        submitted.taskId,
        approvalId(`approval-coding-${"7".repeat(64)}`),
        "approved",
      ),
    ).rejects.toMatchObject({ code: "approval-not-pending" });
    await service.decidePublish(
      nativeConversationId,
      submitted.taskId,
      publishApproval!.approvalId,
      "approved",
    );
    await service.waitForIdle(submitted.taskId);

    expect(publishDecision).toEqual({
      decision: "approved",
      actorId: "actestra-aionui-coding-user",
    });
    expect(closeGoose).toHaveBeenCalledTimes(1);
    await expect(service.list(nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "completed",
        stage: "published",
        artifacts: [
          expect.objectContaining({
            artifactId: `artifact-coding-${"6".repeat(64)}`,
            label: "Actestra coding patch",
          }),
        ],
      }),
    ]);
  });

  it("terminalizes the registered Task when Goose opening fails before evidence starts", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-08-04T06:35:00.000Z"));
    const openGoose = vi.fn(async () => {
      throw new Error("injected pre-evidence Goose opening failure");
    });
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native failed-opening workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message" as const,
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-failed-opening";

    await expect(
      service.submit({
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-coding-failed-opening",
        prompt: "Fail before Goose evidence starts.",
      }),
    ).rejects.toMatchObject({ code: "execution-failed" });

    expect(openGoose).toHaveBeenCalledTimes(1);
    await expect(service.list(nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        stage: "failed",
        canCancel: false,
      }),
    ]);
    await expect(persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ state: "failed", activeSessionId: undefined }],
      sessions: [{ state: "failed" }],
      workers: [{ state: "crashed" }],
    });
    expect(fs.readFileSync(path.join(fixture.repositoryRoot, "answer.txt"), "utf8")).toBe(
      "before\n",
    );
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
    await service.close();
  });

  it("cancels only an active coding Task owned by the retained conversation", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-08-04T06:50:00.000Z"));
    let settlePrompt!: (value: {
      readonly stopReason: "cancelled";
      readonly updates: readonly [];
    }) => void;
    const promptResult = new Promise<{
      readonly stopReason: "cancelled";
      readonly updates: readonly [];
    }>((resolve) => {
      settlePrompt = resolve;
    });
    let closePromise: Promise<void> | undefined;
    let closeCount = 0;
    const openGoose = vi.fn(async (options: OpenGooseCodingMainSessionOptions) => {
      const close = vi.fn(() => {
        closePromise ??= (async () => {
          closeCount += 1;
          const graph = await persistence.loadDomainGraph();
          await persistence.replaceDomainGraph({
            ...graph,
            tasks: graph.tasks.map((task) =>
              task.id === options.taskId
                ? { ...task, state: "cancelled" as const, activeSessionId: undefined }
                : task,
            ),
            sessions: graph.sessions.map((session) =>
              session.id === options.sessionId
                ? { ...session, state: "cancelled" as const }
                : session,
            ),
            workers: graph.workers.map((worker) =>
              worker.id === options.workerId ? { ...worker, state: "stopped" as const } : worker,
            ),
          });
          settlePrompt({ stopReason: "cancelled", updates: [] });
        })();
        return closePromise;
      });
      return Object.freeze({
        prompt: vi.fn(() => promptResult),
        publish: vi.fn(),
        close,
      }) as unknown as GooseCodingMainSession;
    });
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Native cancellation workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message",
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-cancel-conversation";
    const submitted = await service.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId: "submission-coding-cancel-1",
      prompt: "Cancel this isolated coding task.",
    });

    await expect(
      service.cancel("different-native-conversation", submitted.taskId, "Wrong owner"),
    ).rejects.toMatchObject({ code: "task-not-owned" });
    await expect(
      service.cancel(nativeConversationId, submitted.taskId, "Stopped from ACP SendBox."),
    ).resolves.toMatchObject({
      taskId: submitted.taskId,
      status: "cancelled",
      stage: "cancelled",
      canCancel: false,
    });
    await service.waitForIdle(submitted.taskId);
    await expect(
      service.cancel(nativeConversationId, submitted.taskId, "Already stopped"),
    ).resolves.toMatchObject({ status: "cancelled", canCancel: false });
    expect(closeCount).toBe(1);
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");
  });

  it("rebuilds assistant and tool review surfaces from durable Actestra events", async () => {
    const fixture = await createRepositoryFixture();
    const persistence = (await openTestPersistenceUtility(fixture.root)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-08-04T07:00:00.000Z"));
    let settlePrompt!: (value: {
      readonly stopReason: "cancelled";
      readonly updates: readonly [];
    }) => void;
    const promptResult = new Promise<{
      readonly stopReason: "cancelled";
      readonly updates: readonly [];
    }>((resolve) => {
      settlePrompt = resolve;
    });
    let closePromise: Promise<void> | undefined;
    const openGoose = vi.fn(async (options: OpenGooseCodingMainSessionOptions) => {
      const close = vi.fn(() => {
        closePromise ??= (async () => {
          const graph = await persistence.loadDomainGraph();
          await persistence.replaceDomainGraph({
            ...graph,
            tasks: graph.tasks.map((task) =>
              task.id === options.taskId
                ? { ...task, state: "cancelled" as const, activeSessionId: undefined }
                : task,
            ),
            sessions: graph.sessions.map((session) =>
              session.id === options.sessionId
                ? { ...session, state: "cancelled" as const }
                : session,
            ),
            workers: graph.workers.map((worker) =>
              worker.id === options.workerId ? { ...worker, state: "stopped" as const } : worker,
            ),
          });
          settlePrompt({ stopReason: "cancelled", updates: [] });
        })();
        return closePromise;
      });
      return Object.freeze({
        prompt: vi.fn(() => promptResult),
        publish: vi.fn(),
        close,
      }) as unknown as GooseCodingMainSession;
    });
    const mainService = Object.freeze({
      managedRoot: path.join(fixture.root, "coding-worktrees"),
      open: vi.fn(),
      openGoose,
      close: vi.fn(async () => undefined),
    }) as unknown as IsolatedCodingMainService;
    const service = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fixture.repositoryRoot,
          displayName: "Durable projection workspace",
        }),
      },
      codingAgent: { requireAdmittedArtifact: async () => artifact },
      getMainService: () => mainService,
      privateRootParent: path.join(fixture.root, "goose-private"),
      modelId: "actestra-fixture-model",
      modelInvoker: async () =>
        Object.freeze({
          type: "message",
          text: "unused",
          usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
        }),
      commands: {},
      tests: {},
    });
    const nativeConversationId = "native-coding-durable-projection";
    const submitted = await service.submit({
      contractVersion: 1,
      nativeConversationId,
      submissionId: "submission-coding-durable-projection-1",
      prompt: "Run the focused test and summarize it.",
    });
    const graph = await persistence.loadDomainGraph();
    const task = graph.tasks[0]!;
    const session = graph.sessions[0]!;
    const worker = graph.workers[0]!;
    const identity = deriveGooseCodingEvidenceIdentity({
      workspaceId: task.workspaceId,
      taskId: task.id,
      sessionId: session.id,
      workerId: worker.id,
    });
    const testRequestId = toolRequestId(`request-aionui-coding-${"8".repeat(64)}`);
    const eventTypes = [
      ["task.started", { from: "ready", to: "running" }],
      ["agent.message", { role: "assistant", content: "The durable focused test passed." }],
      [
        "tool.requested",
        {
          requestId: testRequestId,
          toolName: CODING_TEST_TOOL_ID,
          summary: "Run focused test",
        },
      ],
      ["tool.started", { requestId: testRequestId }],
      ["tool.completed", { requestId: testRequestId, summary: "1 test passed" }],
      [
        "task.updated",
        { from: "running", to: "blocked", reason: "coding-review-required:end_turn" },
      ],
    ] as const;
    let priorEventId: ReturnType<typeof eventId> | undefined;
    for (const [index, [type, payload]] of eventTypes.entries()) {
      const currentEventId = eventId(`event-aionui-coding-durable-${String(index + 1)}`);
      const event = Object.freeze({
        schemaVersion: 1 as const,
        eventId: currentEventId,
        streamId: identity.streamId,
        sequence: index + 1,
        occurredAt: instant(`2026-08-04T07:00:0${String(index)}.000Z`),
        workspaceId: task.workspaceId,
        taskId: task.id,
        sessionId: session.id,
        workerId: worker.id,
        correlationId: identity.correlationId,
        ...(priorEventId === undefined ? {} : { causationId: priorEventId }),
        type,
        redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
        payload,
      }) as CoreEvent;
      await persistence.appendEvent(event);
      priorEventId = currentEventId;
    }
    await persistence.replaceDomainGraph({
      ...graph,
      tasks: graph.tasks.map((candidate) =>
        candidate.id === task.id ? { ...candidate, state: "blocked" as const } : candidate,
      ),
      sessions: graph.sessions.map((candidate) =>
        candidate.id === session.id ? { ...candidate, state: "blocked" as const } : candidate,
      ),
      workers: graph.workers.map((candidate) =>
        candidate.id === worker.id ? { ...candidate, state: "ready" as const } : candidate,
      ),
    });

    const forbiddenAuthority = vi.fn(() => {
      throw new Error("Durable list projection must not reopen native or Worker authority");
    });
    const restartedService = new AionUiCodingJourneyService({
      persistence,
      clock,
      nativeContext: { resolve: forbiddenAuthority },
      codingAgent: { requireAdmittedArtifact: forbiddenAuthority },
      getMainService: forbiddenAuthority,
      privateRootParent: path.join(fixture.root, "unused-goose-private"),
      modelId: "unused-model",
      modelInvoker: forbiddenAuthority,
      commands: {},
      tests: {},
    });
    await expect(restartedService.list(nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "blocked",
        stage: "review",
        messages: [expect.objectContaining({ text: "The durable focused test passed." })],
        tools: [
          expect.objectContaining({
            toolCallId: testRequestId,
            title: "Run focused test",
            status: "completed",
            surface: "test",
            content: [{ type: "content", text: "1 test passed" }],
          }),
        ],
      }),
    ]);
    expect(forbiddenAuthority).not.toHaveBeenCalled();

    await service.cancel(nativeConversationId, submitted.taskId, "End durable projection test");
    await service.waitForIdle(submitted.taskId);
  });
});
