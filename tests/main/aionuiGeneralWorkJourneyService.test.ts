// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashAionUiGeneralWorkConversation } from "../../apps/desktop/src/compatibility/aionui";
import { eventId, instant } from "../../apps/desktop/src/core";
import { createScopedNativeToolPlatform } from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import { AionUiGeneralWorkJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { MAX_GENERAL_WORKER_SEND_CONTENT_BYTES } from "../../apps/desktop/src/shared/generalWorkerProtocol";
import type { LoopbackGeneralWorkerTransport } from "../fixtures/generalWorker";
import { openTestGeneralWorker } from "../fixtures/generalWorker";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const testDirectories: string[] = [];
const persistenceClients: Array<Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"]> =
  [];

afterEach(async () => {
  for (const persistence of persistenceClients.splice(0)) {
    await persistence.close().catch(() => undefined);
  }
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AionUiGeneralWorkJourneyService", () => {
  it("rejects a filesystem-root workspace before registering or launching a Worker", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:44:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const launchWorker = vi.fn(async () => {
      throw new Error("A filesystem-root workspace must not launch a Worker");
    });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: path.parse(process.cwd()).root,
          displayName: "Unsafe root workspace",
        }),
      },
      launchWorker,
    });

    await expect(
      service.submit({
        contractVersion: 1,
        nativeConversationId: "conversation-native-root-workspace",
        submissionId: "submission-native-root-workspace",
        prompt: "Do not grant access to the filesystem root.",
      }),
    ).rejects.toThrow(/workspace root/u);
    expect(launchWorker).not.toHaveBeenCalled();
    await expect(persistence.loadDomainGraph()).resolves.toEqual({
      workspaces: [],
      tasks: [],
      sessions: [],
      workers: [],
      approvals: [],
      artifacts: [],
    });
  });

  it("persists one real Worker attempt and deduplicates the native submission", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:45:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let launchCount = 0;
    let workerEventSequence = 0;
    let transport: LoopbackGeneralWorkerTransport | undefined;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI preserved workspace",
        }),
      },
      launchWorker: async ({ requestId }) => {
        launchCount += 1;
        const opened = await openTestGeneralWorker(clock, {
          executionMode: "task-output-write-text-fixture",
          newAttemptToken: () => "attempt-aionui-journey-1",
          newToolRequestId: () => requestId,
          newEventId: () => eventId(`event-aionui-journey-worker-${String(++workerEventSequence)}`),
        });
        opened.transport.deliverMessagesOnSeparateTurns();
        transport = opened.transport;
        return opened.adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-journey-1",
      submissionId: "submission-native-journey-1",
      prompt: "Summarize the bounded Actestra task.",
    } as const;

    const [first, duplicate] = await Promise.all([service.submit(intent), service.submit(intent)]);

    expect(first).toEqual({
      contractVersion: 1,
      taskId: expect.stringMatching(/^task-aionui-/u),
      status: "blocked",
      title: intent.prompt,
      canCancel: true,
      createdAt: "2026-07-30T06:45:00.000Z",
      updatedAt: "2026-07-30T06:45:00.000Z",
      artifacts: [],
    });
    expect(duplicate).toEqual(first);
    expect(launchCount).toBe(1);

    await service.waitForIdle();
    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toEqual({
      ...first,
      status: "completed",
      summary: "Actestra created 1 task artifact.",
      canCancel: false,
      artifacts: [
        {
          artifactId: expect.stringMatching(/^artifact-aionui-/u),
          kind: "file",
          label: "Actestra result",
          state: "available",
        },
      ],
    });
    expect(transport?.killCount).toBe(1);

    const links = await persistence.listAionUiGeneralWorkJourneyLinks(
      hashAionUiGeneralWorkConversation(intent.nativeConversationId),
      10,
    );
    expect(links).toHaveLength(1);
    expect(links[0]?.taskId).toBe(completed?.taskId);

    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([
      expect.objectContaining({
        id: first.taskId,
        state: "completed",
        activeSessionId: undefined,
      }),
    ]);
    expect(graph.sessions).toEqual([expect.objectContaining({ state: "completed" })]);
    expect(graph.workers).toEqual([expect.objectContaining({ state: "stopped" })]);
    expect(graph.artifacts).toEqual([
      expect.objectContaining({
        id: completed!.artifacts[0]!.artifactId,
        taskId: completed!.taskId,
        state: "available",
      }),
    ]);
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed!.taskId, "result.md"),
        "utf8",
      ),
    ).toContain(intent.prompt);
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed!.taskId,
      artifactId: completed!.artifacts[0]!.artifactId,
      label: "Actestra result",
      mediaType: "text/markdown; charset=utf-8",
      content: expect.stringContaining(intent.prompt),
    });
    await expect(
      service.preview(
        "conversation-native-other",
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).rejects.toMatchObject({
      code: "task-not-owned",
    });

    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        taskId: first.taskId,
        state: "completed",
        taskState: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          id: completed!.artifacts[0]!.artifactId,
        },
      },
    });
    expect(checkpoint?.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "task.started",
        "tool.requested",
        "artifact.created",
        "tool.started",
        "tool.completed",
        "task.completed",
      ]),
    );
    if (checkpoint === null) {
      throw new Error("Expected the completed journey checkpoint");
    }
    const checkpointSpy = vi.spyOn(persistence, "getGeneralWorkCheckpoint").mockResolvedValue(
      Object.freeze({
        ...checkpoint,
        phase: "terminal-pending",
      }),
    );
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).rejects.toMatchObject({
      code: "task-conflict",
    });
    checkpointSpy.mockRestore();

    const graphSpy = vi.spyOn(persistence, "loadDomainGraph").mockResolvedValue({
      ...graph,
      artifacts: graph.artifacts.map((artifact) => ({
        ...artifact,
        label: "Tampered projection label",
      })),
    });
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed!.taskId,
        completed!.artifacts[0]!.artifactId,
      ),
    ).rejects.toMatchObject({
      code: "task-conflict",
    });
    graphSpy.mockRestore();
  });

  it("reads the reserved workspace file privately and previews its create-only artifact", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Private representative workspace source.\nSecond line.\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), sourceText);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:47:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI representative file workspace",
        }),
      },
      launchWorker: async ({ requestId, readRequestId }) => {
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-representative-file-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(`event-aionui-representative-file-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-representative-file-1",
      submissionId: "submission-native-representative-file-1",
      prompt: "Turn the reserved workspace text into a reviewable Markdown artifact.",
      journeyKind: "workspace-file-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
      artifacts: [],
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        {
          kind: "file",
          label: "Actestra file result",
          state: "available",
        },
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the representative file journey artifact");
    }
    const outputPath = path.join(
      workspaceRoot,
      ".actestra",
      "task-output",
      completed.taskId,
      "result.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toContain(sourceText);
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra file result",
      mediaType: "text/markdown; charset=utf-8",
      content: expect.stringContaining(sourceText),
    });

    const links = await persistence.listAionUiGeneralWorkJourneyLinks(
      hashAionUiGeneralWorkConversation(intent.nativeConversationId),
      10,
    );
    expect(links).toEqual([
      expect.objectContaining({
        taskId: completed.taskId,
        journeyKind: "workspace-file-artifact",
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const sourceLine of sourceText.split(/\r?\n/u).filter((line) => line.length > 0)) {
      expect(serializedEvents).not.toContain(sourceLine);
    }
  });

  it("fails an oversized representative file before Worker transport without leaking content", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "x".repeat(MAX_GENERAL_WORKER_SEND_CONTENT_BYTES + 1);
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), sourceText);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI oversized representative file workspace",
        }),
      },
      launchWorker: async ({ requestId, readRequestId }) => {
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-representative-file-oversized",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(
                `event-aionui-representative-file-oversized-${String(++workerEventSequence)}`,
              ),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-representative-file-oversized",
      submissionId: "submission-native-representative-file-oversized",
      prompt: "Process only a file that fits the bounded Worker transport.",
      journeyKind: "workspace-file-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
    });
    await service.waitForIdle();

    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        incidentCode: "content-too-large",
        canCancel: false,
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      tool: {
        state: "failed",
        errorCode: "content-too-large",
        mayHaveExecuted: false,
      },
      attempt: {
        state: "failed",
        taskState: "failed",
      },
    });
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({ errorCode: "content-too-large" }),
        }),
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "content-too-large" }),
        }),
      ]),
    );
    expect(checkpoint?.events.some(({ type }) => type === "task.cancelled")).toBe(false);
    expect(JSON.stringify(checkpoint?.events)).not.toContain(sourceText.slice(0, 1_024));
  });

  it("fails a file journey against its active read request when the grant is revoked", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(
      path.join(workspaceRoot, "actestra-input.txt"),
      "Authorized only before launch",
    );
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:49:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI revoked file workspace",
        }),
      },
      launchWorker: async ({ requestId, readRequestId }) => {
        const graph = await persistence.loadDomainGraph();
        const grant = await persistence.getActiveWorkspaceGrant(graph.tasks[0]!.workspaceId);
        if (grant === null) {
          throw new Error("Expected the registered file-journey grant");
        }
        await persistence.persistWorkspaceGrant({
          ...grant,
          state: "revoked",
          updatedAt: clock.now(),
        });
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-representative-file-revoked",
            newToolRequestId: () => requestIds[requestIndex++]!,
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-representative-file-revoked",
      submissionId: "submission-native-representative-file-revoked",
      prompt: "Fail closed when the prepared workspace grant is no longer active.",
      journeyKind: "workspace-file-artifact",
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      canCancel: true,
    });
    await service.waitForIdle();

    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        incidentCode: "workspace-grant-unavailable",
        canCancel: false,
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "failed",
        taskState: "failed",
      },
    });
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "workspace-grant-unavailable" }),
        }),
      ]),
    );
  });

  it("cancels only the active task owned by the native conversation", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:50:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let transport: LoopbackGeneralWorkerTransport | undefined;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI cancellation workspace",
        }),
      },
      launchWorker: async () => {
        const opened = await openTestGeneralWorker(clock, {
          executionMode: "hold",
          newAttemptToken: () => "attempt-aionui-cancel-1",
        });
        transport = opened.transport;
        return opened.adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-cancel-1",
      submissionId: "submission-native-cancel-1",
      prompt: "Keep this bounded task active until it is cancelled.",
    } as const;
    const running = await service.submit(intent);

    await expect(
      service.cancel("conversation-native-other", running.taskId, "User stopped the task."),
    ).rejects.toThrow(/does not own/u);
    const cancelled = await service.cancel(
      intent.nativeConversationId,
      running.taskId,
      "User stopped the task.",
    );

    expect(cancelled).toMatchObject({
      taskId: running.taskId,
      status: "cancelled",
      canCancel: false,
    });
    expect(transport?.killCount).toBe(1);
    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([cancelled]);

    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([
      expect.objectContaining({
        id: running.taskId,
        state: "cancelled",
        activeSessionId: undefined,
      }),
    ]);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "cancelled",
        taskState: "cancelled",
        disposed: true,
      },
    });
    expect(checkpoint?.events.map(({ type }) => type)).toContain("task.cancelled");
  });

  it("resumes an atomically prepared journey after restart without native path replay", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:55:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-restart-1",
      submissionId: "submission-native-restart-1",
      prompt: "Create a restart-safe bounded artifact.",
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(persistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toHaveLength(
      1,
    );

    const preparedGraph = await persistence.loadDomainGraph();
    await persistence.replaceDomainGraph({
      ...preparedGraph,
      workers: preparedGraph.workers.map((worker) => ({
        ...worker,
        adapterKind: "unknown.general-worker.v99",
      })),
    });
    let incompatibleLaunchCount = 0;
    const incompatible = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          throw new Error("recovery must not replay native workspace context");
        },
      },
      launchWorker: async () => {
        incompatibleLaunchCount += 1;
        throw new Error("an incompatible prepared Worker must not launch");
      },
    });
    await expect(incompatible.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 0,
      failed: 1,
    });
    expect(incompatibleLaunchCount).toBe(0);
    await expect(incompatible.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "ready",
        canCancel: false,
      }),
    ]);
    await persistence.replaceDomainGraph(preparedGraph);

    let nativeContextReplayCount = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "task-output-write-text-fixture",
            newAttemptToken: () => "attempt-aionui-restart-1",
            newToolRequestId: () => requestId,
          })
        ).adapter,
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    await expect(recovered.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "completed",
        canCancel: false,
        artifacts: [expect.objectContaining({ label: "Actestra result" })],
      }),
    ]);
  });

  it("recovers a prepared file journey from its durable kind through both scoped tools", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Private restart-safe file journey source.\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), sourceText);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:57:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-file-restart-1",
      submissionId: "submission-native-file-restart-1",
      prompt: "Recover the reserved workspace file into a Markdown artifact.",
      journeyKind: "workspace-file-artifact",
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI file restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before file Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(persistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({
        journeyKind: "workspace-file-artifact",
      }),
    ]);

    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("file recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId, readRequestId }) => {
        expect(journeyKind).toBe("workspace-file-artifact");
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "workspace-read-then-task-output-write-fixture",
            newAttemptToken: () => "attempt-aionui-file-restart-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () => eventId(`event-aionui-file-restart-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });

    await expect(recovered.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 1,
      failed: 0,
    });
    await recovered.waitForIdle();
    expect(nativeContextReplayCount).toBe(0);
    const [completed] = await recovered.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [expect.objectContaining({ label: "Actestra file result" })],
    });
    if (completed === undefined) {
      throw new Error("Expected the recovered file journey");
    }
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "result.md"),
        "utf8",
      ),
    ).toContain(sourceText);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
  });

  it("surfaces grant denial and create-only conflicts as terminal evidence", async () => {
    for (const scenario of ["grant-denied", "artifact-conflict"] as const) {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
      );
      testDirectories.push(directory);
      const workspaceRoot = path.join(directory, "workspace");
      fs.mkdirSync(workspaceRoot);
      const persistence = (await openTestPersistenceUtility(directory)).client;
      persistenceClients.push(persistence);
      const clock = new DeterministicAgentClock(instant("2026-07-30T07:00:00.000Z"));
      const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
      let transport: LoopbackGeneralWorkerTransport | undefined;
      const service = new AionUiGeneralWorkJourneyService({
        persistence,
        nativeTools,
        clock,
        nativeContext: {
          resolve: async () => ({
            rootPath: fs.realpathSync(workspaceRoot),
            displayName: `AionUI ${scenario} workspace`,
          }),
        },
        launchWorker: async ({ requestId }) => {
          const graph = await persistence.loadDomainGraph();
          const task = graph.tasks[0]!;
          if (scenario === "grant-denied") {
            const grant = await persistence.getActiveWorkspaceGrant(task.workspaceId);
            if (grant === null) {
              throw new Error("fixture grant is missing");
            }
            await persistence.persistWorkspaceGrant({
              ...grant,
              state: "revoked",
              updatedAt: clock.now(),
            });
          } else {
            const outputDirectory = path.join(workspaceRoot, ".actestra", "task-output", task.id);
            fs.mkdirSync(outputDirectory, { recursive: true });
            fs.writeFileSync(path.join(outputDirectory, "result.md"), "conflicting output");
          }
          const opened = await openTestGeneralWorker(clock, {
            executionMode: "task-output-write-text-fixture",
            newAttemptToken: () => `attempt-aionui-${scenario}`,
            newToolRequestId: () => requestId,
          });
          transport = opened.transport;
          return opened.adapter;
        },
      });
      const intent = {
        contractVersion: 1,
        nativeConversationId: `conversation-native-${scenario}`,
        submissionId: `submission-native-${scenario}`,
        prompt: `Exercise the ${scenario} terminal path.`,
      } as const;

      const blocked = await service.submit(intent);
      expect(blocked).toMatchObject({ status: "blocked", canCancel: true });
      await service.waitForIdle();
      await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
        expect.objectContaining({
          taskId: blocked.taskId,
          status: "failed",
          canCancel: false,
          incidentCode: expect.any(String),
          artifacts: [],
        }),
      ]);
      expect(transport?.killCount).toBe(1);
    }
  });
});
