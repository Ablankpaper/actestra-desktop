// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashAionUiGeneralWorkConversation } from "../../apps/desktop/src/compatibility/aionui";
import {
  eventId,
  instant,
  isGeneralDraftRepairInstruction,
  taskId,
} from "../../apps/desktop/src/core";
import { createScopedNativeToolPlatform } from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import { AionUiGeneralWorkJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import {
  ActestraGeneralWorkModelError,
  type TrustedActestraGeneralWorkRuntime,
} from "../../apps/desktop/src/main/workers/actestraGeneralWorkRuntime";
import { GeneralWorkCoordinator } from "../../apps/desktop/src/main/workers/generalWorkCoordinator";
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

  it("reserves scheduled submission identities from renderer-owned General Work", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-31T07:59:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const nativeResolve = vi.fn(async () => {
      throw new Error("Renderer submission reached native-context authority");
    });
    const launchWorker = vi.fn(async () => {
      throw new Error("Renderer submission launched the reserved scheduled Worker");
    });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: { resolve: nativeResolve },
      launchWorker,
    });

    let failure: unknown;
    try {
      service.submit({
        contractVersion: 1,
        nativeConversationId: "conversation-native-schedule-reservation",
        submissionId: `schedule-aionui-${"a".repeat(64)}:run:1`,
        prompt: "Do not let renderer input reserve a scheduled task identity.",
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "task-conflict" });
    expect(nativeResolve).not.toHaveBeenCalled();
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

  it("runs a scheduled prompt from a persisted grant without rereading native context", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    const workspaceAlias = path.join(directory, "persisted-workspace");
    fs.mkdirSync(workspaceRoot);
    fs.symlinkSync(workspaceRoot, workspaceAlias, "dir");
    const clock = new DeterministicAgentClock(instant("2026-07-31T08:00:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const nativeResolve = vi.fn(async () => {
      throw new Error("A persisted schedule grant must not reread native context");
    });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: { resolve: nativeResolve },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "task-output-write-text-fixture",
            newAttemptToken: () => "attempt-aionui-scheduled-journey-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-scheduled-journey-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-scheduled-journey-1",
      submissionId: "schedule-job-1-run-1",
      prompt: "Create the bounded scheduled Actestra artifact.",
    } as const;

    const [scheduled, duplicateNative] = await Promise.all([
      service.submitFromTrustedContext(intent, {
        rootPath: workspaceAlias,
        displayName: "Persisted schedule workspace",
      }),
      service.submit(intent),
    ]);
    expect(scheduled).toMatchObject({
      status: "blocked",
      canCancel: true,
      artifacts: [],
    });
    expect(duplicateNative).toEqual(scheduled);
    expect(nativeResolve).not.toHaveBeenCalled();

    await service.waitForIdle();
    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "file",
          label: "Actestra result",
          state: "available",
        }),
      ],
    });
    const graph = await persistence.loadDomainGraph();
    await expect(persistence.getActiveWorkspaceGrant(graph.workspaces[0]!.id)).resolves.toEqual(
      expect.objectContaining({
        rootPath: fs.realpathSync(workspaceRoot),
        displayName: "Persisted schedule workspace",
      }),
    );
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "completed" })]);
    expect(graph.sessions).toEqual([expect.objectContaining({ state: "completed" })]);
    expect(graph.workers).toEqual([expect.objectContaining({ state: "stopped" })]);
    expect(graph.artifacts).toHaveLength(1);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          id: graph.artifacts[0]!.id,
        },
      },
    });
    expect(checkpoint?.events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "task.started",
        "tool.requested",
        "tool.started",
        "tool.completed",
        "artifact.created",
        "task.completed",
      ]),
    );
  });

  it("terminalizes a prepared scheduled submission before generic restart recovery can run it", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-31T08:00:15.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          throw new Error("Scheduled restart recovery must use its persisted context");
        },
      },
      launchWorker: async () => {
        throw new Error("Injected process loss after scheduled task registration");
      },
    });
    const nativeConversationId = "conversation-native-scheduled-prepared-interruption";
    const submissionId = "schedule-aionui-prepared-interruption-run-1";

    await expect(
      service.submitFromTrustedContext(
        {
          contractVersion: 1,
          nativeConversationId,
          submissionId,
          prompt: "Do not replay this interrupted scheduled submission.",
          journeyKind: "prompt-artifact",
        },
        {
          rootPath: workspaceRoot,
          displayName: "Interrupted scheduled workspace",
        },
      ),
    ).rejects.toThrow("Injected process loss");
    const preparedGraph = await persistence.loadDomainGraph();
    await persistence.replaceDomainGraph({
      ...preparedGraph,
      sessions: preparedGraph.sessions.map((session) => ({
        ...session,
        state: "starting" as const,
      })),
    });
    await expect(
      service.interruptPreparedSubmission(nativeConversationId, submissionId),
    ).rejects.toMatchObject({ code: "task-conflict" });
    await persistence.replaceDomainGraph(preparedGraph);
    await expect(
      service.interruptPreparedSubmission(nativeConversationId, submissionId),
    ).resolves.toMatchObject({ status: "failed", canCancel: false });
    const terminalGraph = await persistence.loadDomainGraph();
    vi.spyOn(persistence, "loadDomainGraph").mockResolvedValueOnce({
      ...terminalGraph,
      workers: terminalGraph.workers.map((worker) => ({
        ...worker,
        adapterKind: "corrupt-general-worker-adapter" as typeof worker.adapterKind,
      })),
    });
    await expect(
      service.interruptPreparedSubmission(nativeConversationId, submissionId),
    ).rejects.toThrow("identities conflict");
    await expect(service.recoverPrepared()).resolves.toEqual({
      attempted: 0,
      started: 0,
      failed: 0,
    });

    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(graph.sessions).toEqual([expect.objectContaining({ state: "cancelled" })]);
    expect(graph.workers).toEqual([expect.objectContaining({ state: "stopped" })]);
    expect(await persistence.listPreparedAionUiGeneralWorkJourneyLinks(100)).toEqual([]);
  });

  it("reports terminal finalization failure to the scheduled caller", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-31T08:00:30.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const replaceDomainGraph = vi
      .spyOn(persistence, "replaceDomainGraph")
      .mockRejectedValue(new Error("Injected terminal finalization failure"));
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          throw new Error("A scheduled grant must not reread native context");
        },
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "task-output-write-text-fixture",
            newAttemptToken: () => "attempt-aionui-scheduled-finalization-failure",
            newToolRequestId: () => requestId,
          })
        ).adapter,
    });

    const projection = await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-scheduled-finalization-failure",
        submissionId: "schedule-job-finalization-failure-run-1",
        prompt: "Expose the failed terminal persistence barrier.",
      },
      {
        rootPath: workspaceRoot,
        displayName: "Scheduled finalization failure workspace",
      },
    );
    expect(projection).toMatchObject({ status: "blocked" });

    await vi.waitFor(() => {
      expect(replaceDomainGraph).toHaveBeenCalled();
    });
    await expect(
      service.waitForIdle(taskId(`task-aionui-${"f".repeat(64)}`)),
    ).resolves.toBeUndefined();
    await expect(service.waitForIdle(projection.taskId)).rejects.toThrow(
      "Injected terminal finalization failure",
    );
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "ready" })]);
    expect(checkpoint).toMatchObject({
      phase: "terminal-pending",
      attempt: {
        state: "completed",
        taskState: "completed",
      },
    });
  });

  it("rejects a filesystem root from a persisted grant without rereading native context", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const clock = new DeterministicAgentClock(instant("2026-07-31T08:01:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const nativeResolve = vi.fn(async () => {
      throw new Error("A persisted schedule grant must not reread native context");
    });
    const launchWorker = vi.fn(async () => {
      throw new Error("A filesystem-root persisted grant must not launch a Worker");
    });
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: { resolve: nativeResolve },
      launchWorker,
    });

    await expect(
      service.submitFromTrustedContext(
        {
          contractVersion: 1,
          nativeConversationId: "conversation-native-scheduled-root-1",
          submissionId: "schedule-job-root-1-run-1",
          prompt: "Reject the unsafe scheduled workspace.",
        },
        {
          rootPath: path.parse(process.cwd()).root,
          displayName: "Unsafe persisted schedule workspace",
        },
      ),
    ).rejects.toThrow(/workspace root/u);
    expect(nativeResolve).not.toHaveBeenCalled();
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

  it("creates a local research brief from one main-owned source", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Alpha evidence\nBeta evidence\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-research.txt"), sourceText);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:47:30.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI local research workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId, readRequestId }) => {
        expect(journeyKind).toBe("local-research-artifact");
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "local-research-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-local-research-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(`event-aionui-local-research-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-local-research-1",
      submissionId: "submission-native-local-research-1",
      prompt: "Compare the approved local source notes.",
      journeyKind: "local-research-artifact",
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
          label: "Actestra local research brief",
          state: "available",
        },
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the local research journey artifact");
    }
    const outputPath = path.join(
      workspaceRoot,
      ".actestra",
      "task-output",
      completed.taskId,
      "research.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toBe(
      "# Actestra local research brief\n\n" +
        "Instruction: Compare the approved local source notes.\n\n" +
        "## Evidence notes\n\n" +
        "- Alpha evidence\n" +
        "- Beta evidence\n",
    );
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra local research brief",
      mediaType: "text/markdown; charset=utf-8",
      content: expect.stringContaining("## Evidence notes"),
    });

    const links = await persistence.listAionUiGeneralWorkJourneyLinks(
      hashAionUiGeneralWorkConversation(intent.nativeConversationId),
      10,
    );
    expect(links).toEqual([
      expect.objectContaining({
        taskId: completed.taskId,
        journeyKind: "local-research-artifact",
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

  it("prepares writing from the persisted brief without placeholder tool input authority", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:30.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-writing-prepared-1",
      submissionId: "submission-native-writing-prepared-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
        "Point: Close with the bounded next step.",
      ].join("\n"),
    } as const;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI writing workspace",
        }),
      },
      launchWorker: async ({ journeyKind }) => {
        expect(journeyKind).toBe("writing-artifact");
        throw new Error("fixture restart before writing Worker launch");
      },
    });

    await expect(service.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(persistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({
        journeyKind: "writing-artifact",
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph).toMatchObject({
      tasks: [{ state: "ready" }],
      sessions: [{ state: "created" }],
      workers: [{ state: "created" }],
      artifacts: [],
    });
  });

  it("persists the active attempt before releasing the Main model effect", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-07T05:00:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const effectOrder: string[] = [];
    const persistGeneralWorkCheckpoint = persistence.persistGeneralWorkCheckpoint.bind(persistence);
    vi.spyOn(persistence, "persistGeneralWorkCheckpoint").mockImplementation(async (checkpoint) => {
      effectOrder.push(`checkpoint:${checkpoint.phase}`);
      return persistGeneralWorkCheckpoint(checkpoint);
    });
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () => {
      effectOrder.push("model:invoke");
      return Object.freeze({
        content: JSON.stringify({
          status: "completed",
          markdown: "# Main model draft\n\nReady for Team review.\n",
        }),
      });
    });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI model writing workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("writing-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-model-writing-barrier",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-model-writing-barrier-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });

    await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-model-writing-barrier",
        submissionId: "submission-native-model-writing-barrier",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Main-owned model barrier",
          "Audience: Actestra Team",
          "Purpose: Prove persistence before the model effect.",
          "Point: Keep the provider behind the durable checkpoint.",
        ].join("\n"),
      },
      {
        rootPath: workspaceRoot,
        displayName: "AionUI model writing workspace",
      },
    );
    await service.waitForIdle();

    expect(invoke).toHaveBeenCalledOnce();
    const firstActiveCheckpoint = effectOrder.indexOf("checkpoint:active");
    const modelEffect = effectOrder.indexOf("model:invoke");
    expect(firstActiveCheckpoint).toBeGreaterThanOrEqual(0);
    expect(modelEffect).toBeGreaterThan(firstActiveCheckpoint);
  });

  it("terminalizes a live General journey when its Main-owned CPU budget is exceeded", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-15T14:30:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              content: JSON.stringify({
                status: "completed",
                markdown: "# Too late\n\nThis result crossed the CPU boundary.\n",
              }),
            });
          }, 1_200);
        }),
    );
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI resource-bound workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            resourceObservation: () => ({
              cpuSeconds: 31,
              privateMemoryBytes: 4_096,
            }),
            newAttemptToken: () => "attempt-aionui-resource-budget",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-resource-budget-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });
    const nativeConversationId = "conversation-native-resource-budget";

    await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-native-resource-budget",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Resource boundary",
          "Audience: Reliability review",
          "Purpose: Prove the General CPU terminal path.",
          "Point: Preserve resource-specific failure evidence.",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI resource-bound workspace" },
    );
    await service.waitForIdle();

    await expect(service.list(nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        status: "failed",
        canCancel: false,
        incidentCode: "worker-resource-cpu-exceeded",
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "failed",
        incident: {
          code: "worker-resource-cpu-exceeded",
          resource: {
            workerKind: "general",
            resourceKind: "cpu",
            observed: 31,
            limit: 30,
          },
        },
      },
    });
  });

  it("turns one model-authored draft into a document Artifact the user can preview", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T07:30:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const draft = "# Verified launch note\n\nThe approved sequence ships this quarter.\n";
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () =>
      Object.freeze({ content: JSON.stringify({ status: "completed", markdown: draft }) }),
    );
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI model writing success workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-model-writing-success",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-model-writing-success-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });
    const nativeConversationId = "conversation-native-model-writing-success";

    await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-native-model-writing-success",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Verified launch note",
          "Audience: Product leadership",
          "Purpose: Record the approved launch sequence.",
          "Point: State the verified customer outcome.",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI model writing success workspace" },
    );
    await service.waitForIdle();

    // Spec F1: a text-only brief the model can answer needs exactly one call and no repair.
    expect(invoke).toHaveBeenCalledOnce();
    const [completed] = await service.list(nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra writing draft",
          state: "available",
        }),
      ],
    });
    if (completed?.artifacts[0] === undefined) {
      throw new Error("Expected the model-authored writing journey artifact");
    }
    // The bytes on disk are the model's own, so nothing rewrote the draft on its way through.
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "draft.md"),
        "utf8",
      ),
    ).toBe(draft);
    await expect(
      service.preview(nativeConversationId, completed.taskId, completed.artifacts[0].artifactId),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed.taskId,
      artifactId: completed.artifacts[0].artifactId,
      label: "Actestra writing draft",
      mediaType: "text/markdown; charset=utf-8",
      content: draft,
    });
    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "completed" })]);
    expect(graph.artifacts).toEqual([
      expect.objectContaining({
        id: completed.artifacts[0].artifactId,
        taskId: completed.taskId,
        state: "available",
      }),
    ]);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: { state: "completed", taskState: "completed", disposed: true },
      artifactBinding: { artifact: { kind: "document", label: "Actestra writing draft" } },
    });
    // Success changes nothing about privacy: the prose reaches the Artifact, never the event stream.
    expect(JSON.stringify(checkpoint?.events)).not.toContain("The approved sequence ships");
  });

  it("writes no Artifact at all when the model keeps returning a placeholder draft", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T05:30:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () =>
      Object.freeze({
        content: JSON.stringify({
          status: "completed",
          markdown: "# Quarterly brief\n\nRevenue: [TBD]\n",
        }),
      }),
    );
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI placeholder draft workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-placeholder-draft",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-placeholder-draft-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });

    const submitted = await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-placeholder-draft",
        submissionId: "submission-native-placeholder-draft",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Quarterly brief",
          "Audience: Product leadership",
          "Purpose: Record the approved revenue outcome.",
          "Point: State the verified revenue figure.",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI placeholder draft workspace" },
    );
    await service.waitForIdle();

    // Spec C bounds the repair at one, so a second placeholder ends the attempt rather than looping.
    expect(invoke).toHaveBeenCalledTimes(2);
    // Spec F3: a draft written around a gap must never reach the user as finished work.
    await expect(service.list("conversation-native-placeholder-draft")).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "failed",
        incidentCode: "general-instruction-noncompliant",
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph.artifacts).toEqual([]);
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".actestra", "task-output", submitted.taskId)),
    ).toBe(false);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "general-instruction-noncompliant" }),
        }),
      ]),
    );
    // The rejected prose must not survive in durable evidence either.
    expect(JSON.stringify(checkpoint?.events)).not.toContain("TBD");
  });

  it("carries general-input-required through every layer without spending a model call", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T05:00:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>();
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI input required workspace",
        }),
      },
      launchWorker: async ({ requestId, requirements }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            requirements,
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-input-required",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-input-required-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });

    await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-input-required",
        submissionId: "submission-native-input-required",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Release notes summary",
          "Audience: Release reviewers",
          "Purpose: Summarize the repository README for the release notes",
          "Point: Summarize README.md",
        ].join("\n"),
        requirements: {
          contractVersion: 1,
          capabilities: ["text-generation"],
          contextReferences: ["none"],
          inputRequirements: ["file-reference"],
          completionCriteria: "json-envelope",
        },
      },
      { rootPath: workspaceRoot, displayName: "AionUI input required workspace" },
    );
    await service.waitForIdle();

    await expect(
      persistence.listAionUiGeneralWorkJourneyLinks(
        hashAionUiGeneralWorkConversation("conversation-native-input-required"),
        10,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        requirements: {
          contractVersion: 1,
          capabilities: ["text-generation"],
          contextReferences: ["none"],
          inputRequirements: ["file-reference"],
          completionCriteria: "json-envelope",
        },
      }),
    ]);

    // Spec A: an unmet requirement must cost no provider call.
    expect(invoke).not.toHaveBeenCalled();

    // Spec F5: the task waits for material the user can supply, so it is blocked and retryable, not
    // failed. The projection must name the blocking reason rather than a generic worker failure.
    await expect(service.list("conversation-native-input-required")).resolves.toEqual([
      expect.objectContaining({
        status: "blocked",
        incidentCode: "general-input-required",
        artifacts: [],
      }),
    ]);
    // The durable Task record carries that state, so a restart reports it without replaying events.
    const blockedGraph = await persistence.loadDomainGraph();
    expect(blockedGraph.tasks[0]).toMatchObject({ state: "blocked" });

    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    // A refusal is Worker-reported, so its code lives in the terminal Task event rather than in
    // `incident`, which the supervisor reserves for faults it observes itself.
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: { state: "failed", taskState: "failed" },
    });
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "general-input-required" }),
        }),
      ]),
    );
    // No half-written draft may survive a blocked admission.
    expect(graph.artifacts).toEqual([]);

    // Spec F: a restarted process must re-derive the same blocking reason from durable state alone,
    // without relaunching a Worker or spending the model call admission already refused.
    const restarted = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          throw new Error("recovery must not replay native workspace context");
        },
      },
      launchWorker: async () => {
        throw new Error("recovery must not relaunch a refused journey");
      },
    });
    // A finalized refusal is not prepared work, so recovery must find nothing left to run.
    await expect(restarted.recoverPrepared()).resolves.toEqual({
      attempted: 0,
      started: 0,
      failed: 0,
    });
    // The durable Task record carries the blocking reason, so the restarted projection reports the
    // same actionable state without consulting the attempt's own terminal outcome.
    await expect(restarted.list("conversation-native-input-required")).resolves.toEqual([
      expect.objectContaining({
        status: "blocked",
        canCancel: true,
        incidentCode: "general-input-required",
        artifacts: [],
      }),
    ]);
    expect(invoke).not.toHaveBeenCalled();

    // Spec F5 advertises a cancel on a blocked task, so it must be honoured after a restart, when no
    // live Worker remains to signal. The durable attempt evidence stays exactly as the Worker left it.
    await expect(
      restarted.cancel("conversation-native-input-required", graph.tasks[0]!.id),
    ).resolves.toMatchObject({
      status: "cancelled",
      canCancel: false,
      incidentCode: "general-input-required",
    });
    const cancelledGraph = await persistence.loadDomainGraph();
    expect(cancelledGraph.tasks[0]).toMatchObject({
      state: "cancelled",
      activeSessionId: undefined,
    });
    await expect(
      persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id),
    ).resolves.toStrictEqual(checkpoint);
  });

  it("reports general-capability-mismatch as failed rather than asking for text that cannot help", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T06:00:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>();
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI capability mismatch workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            // The Planner recorded an ability General v1 does not have at all.
            requirements: {
              contractVersion: 1,
              capabilities: ["network-fetch"],
              contextReferences: ["none"],
              inputRequirements: ["none"],
              completionCriteria: "json-envelope",
            },
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-capability-mismatch",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-capability-mismatch-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });

    const submitted = await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-capability-mismatch",
        submissionId: "submission-native-capability-mismatch",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Upstream changelog rewrite",
          "Audience: Release reviewers",
          "Purpose: Rewrite the published upstream changelog",
          "Point: Fetch the changelog and restate it",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI capability mismatch workspace" },
    );
    await service.waitForIdle();

    // Spec A: admission runs before any model turn, so an unmet capability costs no provider call.
    expect(invoke).not.toHaveBeenCalled();
    // Spec D keeps this code apart from `general-input-required` on purpose: no text the user pastes in
    // grants General the authority it lacks, so the surface must not offer a retry that cannot work.
    // That makes the task failed and uncancellable rather than blocked and waiting.
    expect(submitted).toMatchObject({
      status: "failed",
      canCancel: false,
      incidentCode: "general-capability-mismatch",
      artifacts: [],
    });
    await expect(service.list("conversation-native-capability-mismatch")).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "failed",
        incidentCode: "general-capability-mismatch",
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(graph.artifacts).toEqual([]);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "general-capability-mismatch" }),
        }),
      ]),
    );
    // Spec F7: a refused capability is a content-authority verdict, never a lifecycle fault.
    expect(JSON.stringify(checkpoint?.events)).not.toContain("invalid-state");
  });

  it("spends one repair on a malformed reply, then reports general-output-invalid without quoting it", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T06:30:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const malformed = "Sure! Here is your draft: SENTINEL-MALFORMED-MAIN-BODY";
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () =>
      Object.freeze({ content: malformed }),
    );
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI malformed draft workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-malformed-draft",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-malformed-draft-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });

    const submitted = await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-malformed-draft",
        submissionId: "submission-native-malformed-draft",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Launch note",
          "Audience: Product leadership",
          "Purpose: Record the approved launch sequence.",
          "Point: State the verified customer outcome.",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI malformed draft workspace" },
    );
    await service.waitForIdle();

    // Spec C: exactly one repair, granted by Main because the prompt is the instruction the contract
    // itself builds. A third call would mean the Worker could spend provider calls of its own accord.
    expect(invoke).toHaveBeenCalledTimes(2);
    const repairPrompt = invoke.mock.calls[1]?.[0].prompt ?? "";
    expect(isGeneralDraftRepairInstruction(repairPrompt)).toBe(true);
    // The retry names the broken rule and nothing else: echoing the reply back invites a repeat of it.
    expect(repairPrompt).not.toContain("SENTINEL-MALFORMED-MAIN-BODY");

    // Spec F4: a malformed shape keeps its own output-contract code instead of borrowing the
    // placeholder verdict or collapsing into the lifecycle code `invalid-state`.
    expect(submitted).toMatchObject({ status: "running" });
    await expect(service.list("conversation-native-malformed-draft")).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "failed",
        canCancel: false,
        incidentCode: "general-output-invalid",
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(graph.artifacts).toEqual([]);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".actestra", "task-output", submitted.taskId)),
    ).toBe(false);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "general-output-invalid" }),
        }),
      ]),
    );
    const serializedEvents = JSON.stringify(checkpoint?.events);
    expect(serializedEvents).not.toContain("invalid-state");
    // Neither the rejected reply nor a draft built around it may survive in durable evidence.
    expect(serializedEvents).not.toContain("SENTINEL-MALFORMED-MAIN-BODY");
  });

  it("blocks on a model-reported missing input after one real call instead of failing the task", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T06:45:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    // Admission passes here: the recorded requirements are text-only. Only the model, holding the
    // prompt, can see that the material it names was never actually supplied.
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () =>
      Object.freeze({
        content: JSON.stringify({
          status: "needs-input",
          missing_inputs: ["The Q3 revenue figures the brief refers to"],
          message: "Paste the revenue table and I can write the section.",
        }),
      }),
    );
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI model-reported input workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            requirements: {
              contractVersion: 1,
              capabilities: ["text-generation"],
              contextReferences: ["inline-text"],
              inputRequirements: ["bounded-text"],
              completionCriteria: "json-envelope",
            },
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-model-needs-input",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-model-needs-input-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });

    const submitted = await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-model-needs-input",
        submissionId: "submission-native-model-needs-input",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Quarterly revenue note",
          "Audience: Finance leadership",
          "Purpose: Record the approved quarterly result.",
          "Point: State the Q3 revenue figures.",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI model-reported input workspace" },
    );
    await service.waitForIdle();

    // A well-formed needs-input reply satisfies the contract, so it earns no repair: the model was
    // right the first time and asking again would spend a call to be told the same thing.
    expect(invoke).toHaveBeenCalledTimes(1);

    // Spec F5: this route reaches the same actionable state as a refused admission, though it arrives
    // by a different road — the model was called and reported the gap itself. The user can still fix
    // it by supplying the text, so the task waits rather than failing.
    await expect(service.list("conversation-native-model-needs-input")).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "blocked",
        canCancel: true,
        incidentCode: "general-input-required",
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "blocked" })]);
    // Spec F3: a reply that names what is missing must never leave a draft written around the gap.
    expect(graph.artifacts).toEqual([]);
    expect(
      fs.existsSync(path.join(workspaceRoot, ".actestra", "task-output", submitted.taskId)),
    ).toBe(false);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "general-input-required" }),
        }),
      ]),
    );
    // What the model said it needs must reach the user, or the blocked state is not actionable.
    const failure = checkpoint?.events.find((event) => event.type === "task.failed");
    expect(failure?.type === "task.failed" ? failure.payload.message : "").toContain(
      "The Q3 revenue figures the brief refers to",
    );
    const serializedEvents = JSON.stringify(checkpoint?.events);
    // Spec F6/F7: a missing input is neither a provider outage nor a lifecycle fault.
    expect(serializedEvents).not.toContain("invalid-state");
    expect(serializedEvents).not.toContain("model-unavailable");
    expect(serializedEvents).not.toContain("general-output-invalid");
  });

  it("keeps a provider outage separate from a content or input verdict all the way to the projection", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-11T07:00:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    // The runtime classifies the failure structurally, so no message text decides the code.
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () => {
      throw new ActestraGeneralWorkModelError(
        "model-unavailable",
        "General Work model response is unavailable",
      );
    });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI model outage workspace",
        }),
      },
      launchWorker: async ({ requestId }) =>
        (
          await openTestGeneralWorker(clock, {
            executionMode: "model-writing-artifact",
            modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
            newAttemptToken: () => "attempt-aionui-model-outage",
            newToolRequestId: () => requestId,
            newEventId: () => eventId(`event-aionui-model-outage-${String(++workerEventSequence)}`),
          })
        ).adapter,
    });

    const submitted = await service.submitFromTrustedContext(
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-model-outage",
        submissionId: "submission-native-model-outage",
        journeyKind: "writing-artifact",
        prompt: [
          "Title: Launch note",
          "Audience: Product leadership",
          "Purpose: Record the approved launch sequence.",
          "Point: State the verified customer outcome.",
        ].join("\n"),
      },
      { rootPath: workspaceRoot, displayName: "AionUI model outage workspace" },
    );
    await service.waitForIdle();

    // Spec F6: the provider codes stay their own vocabulary. An outage is not a malformed reply, and
    // above all it is not an input request — reporting it as one would ask the user for text that was
    // never the problem, while a content code would blame a model that never answered.
    await expect(service.list("conversation-native-model-outage")).resolves.toEqual([
      expect.objectContaining({
        taskId: submitted.taskId,
        status: "failed",
        canCancel: false,
        incidentCode: "model-unavailable",
        artifacts: [],
      }),
    ]);
    // An unreachable model is not a retryable wait, so the task must not advertise the blocked state
    // spec F5 reserves for material the user can actually supply.
    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(graph.artifacts).toEqual([]);
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "task.failed",
          payload: expect.objectContaining({ errorCode: "model-unavailable" }),
        }),
      ]),
    );
    const serializedEvents = JSON.stringify(checkpoint?.events);
    // Spec F7: a provider outage is not a lifecycle fault either.
    expect(serializedEvents).not.toContain("invalid-state");
    expect(serializedEvents).not.toContain("general-input-required");
    expect(serializedEvents).not.toContain("general-output-invalid");
  });

  it("persists the Worker-authored draft before creating a document Artifact and Preview", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:40.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI writing workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("writing-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "writing-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-writing-1",
            newToolRequestId: () => requestId,
            newEventId: () => eventId(`event-aionui-writing-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-writing-1",
      submissionId: "submission-native-writing-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Quarterly launch note",
        "Audience: Product leadership",
        "Purpose: Explain the approved launch sequence.",
        "Point: Start with the verified customer outcome.",
        "Point: Close with the bounded next step.",
      ].join("\n"),
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      title: "Quarterly launch note",
      canCancel: true,
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra writing draft",
          state: "available",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the completed writing journey");
    }
    const expectedDraft =
      "# Quarterly launch note\n\n" +
      "Audience: Product leadership\n\n" +
      "Explain the approved launch sequence.\n\n" +
      "Start with the verified customer outcome.\n\n" +
      "Close with the bounded next step.\n";
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "draft.md"),
        "utf8",
      ),
    ).toBe(expectedDraft);
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed.taskId,
      artifactId: completed.artifacts[0].artifactId,
      label: "Actestra writing draft",
      mediaType: "text/markdown; charset=utf-8",
      content: expectedDraft,
    });
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        taskState: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          kind: "document",
          label: "Actestra writing draft",
        },
      },
    });
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(1);
    expect(JSON.stringify(checkpoint?.events)).not.toContain("draft.md");
    expect(JSON.stringify(checkpoint?.events)).not.toContain("# Quarterly launch note");
  });

  it("persists the Worker-authored Office model before creating a DOCX and bounded Preview", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:48:50.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI Office document workspace",
        }),
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("office-document-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "office-document-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-office-document-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-office-document-${String(++workerEventSequence)}`),
          })
        ).adapter;
      },
    });
    const document = {
      contractVersion: 1,
      title: "Quarterly operating brief",
      owner: "Product operations",
      summary: "Record the approved launch decision in a portable Word document.",
      sections: [
        { heading: "Decision", body: "Ship the verified desktop workflow." },
        { heading: "Evidence", body: "Include the exact acceptance boundary." },
      ],
    } as const;
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-office-document-1",
      submissionId: "submission-native-office-document-1",
      journeyKind: "office-document-artifact",
      prompt: [
        `Document: ${document.title}`,
        `Owner: ${document.owner}`,
        `Summary: ${document.summary}`,
        ...document.sections.map(({ heading, body }) => `Section: ${heading} | ${body}`),
      ].join("\n"),
    } as const;

    await expect(service.submit(intent)).resolves.toMatchObject({
      status: "blocked",
      title: document.title,
      canCancel: true,
    });
    await service.waitForIdle();

    const [completed] = await service.list(intent.nativeConversationId);
    expect(completed).toMatchObject({
      status: "completed",
      canCancel: false,
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra Office document",
          state: "available",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the completed Office-document journey");
    }
    const output = fs.readFileSync(
      path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "brief.docx"),
    );
    expect(output.subarray(0, 2).toString("ascii")).toBe("PK");
    await expect(
      service.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toEqual({
      contractVersion: 1,
      taskId: completed.taskId,
      artifactId: completed.artifacts[0].artifactId,
      label: "Actestra Office document",
      mediaType: "application/vnd.actestra.office-document-preview+json",
      document,
    });
    const graph = await persistence.loadDomainGraph();
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        taskState: "completed",
        disposed: true,
      },
      artifactBinding: {
        artifact: {
          kind: "document",
          label: "Actestra Office document",
        },
      },
    });
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(1);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const privateValue of [
      document.owner,
      document.summary,
      ...document.sections.flatMap(({ heading, body }) => [heading, body]),
    ]) {
      expect(serializedEvents).not.toContain(privateValue);
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
        incident: {
          code: "content-too-large",
        },
      },
    });
    await expect(persistence.listRecentAgentAttemptEvidence(1)).resolves.toMatchObject([
      {
        state: "failed",
        taskState: "failed",
        incident: {
          code: "content-too-large",
        },
      },
    ]);
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

  it("reopens persistence and recovers a prepared local-research journey without native replay", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const sourceText = "Restart alpha evidence\nRestart beta evidence\n";
    fs.writeFileSync(path.join(workspaceRoot, "actestra-research.txt"), sourceText);
    const firstPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(firstPersistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:58:00.000Z"));
    const firstNativeTools = createScopedNativeToolPlatform({
      persistence: firstPersistence,
      clock,
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-local-research-restart-1",
      submissionId: "submission-native-local-research-restart-1",
      prompt: "Recover the approved local source notes into a research brief.",
      journeyKind: "local-research-artifact",
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence: firstPersistence,
      nativeTools: firstNativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI local research restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before local research Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(firstPersistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({
        journeyKind: "local-research-artifact",
      }),
    ]);
    await firstPersistence.close();
    persistenceClients.splice(persistenceClients.indexOf(firstPersistence), 1);

    const reopenedPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopenedPersistence);
    const reopenedNativeTools = createScopedNativeToolPlatform({
      persistence: reopenedPersistence,
      clock,
    });
    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence: reopenedPersistence,
      nativeTools: reopenedNativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("local research recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId, readRequestId }) => {
        expect(journeyKind).toBe("local-research-artifact");
        const requestIds = [readRequestId, requestId];
        let requestIndex = 0;
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "local-research-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-local-research-restart-1",
            newToolRequestId: () => requestIds[requestIndex++]!,
            newEventId: () =>
              eventId(`event-aionui-local-research-restart-${String(++workerEventSequence)}`),
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
      artifacts: [
        expect.objectContaining({
          kind: "file",
          label: "Actestra local research brief",
          state: "available",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the recovered local research journey");
    }
    const outputPath = path.join(
      workspaceRoot,
      ".actestra",
      "task-output",
      completed.taskId,
      "research.md",
    );
    expect(fs.readFileSync(outputPath, "utf8")).toContain("- Restart alpha evidence");
    await expect(
      recovered.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra local research brief",
      content: expect.stringContaining("- Restart beta evidence"),
    });
    const graph = await reopenedPersistence.loadDomainGraph();
    const checkpoint = await reopenedPersistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "completed",
        disposed: true,
      },
    });
    expect(checkpoint?.events.filter(({ type }) => type === "tool.requested")).toHaveLength(2);
    const serializedEvents = JSON.stringify(checkpoint?.events);
    for (const sourceLine of sourceText.split(/\r?\n/u).filter((line) => line.length > 0)) {
      expect(serializedEvents).not.toContain(sourceLine);
    }
  });

  it("reopens persistence and recovers a prepared writing journey from its owned brief", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const firstPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(firstPersistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:58:30.000Z"));
    const firstNativeTools = createScopedNativeToolPlatform({
      persistence: firstPersistence,
      clock,
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-writing-restart-1",
      submissionId: "submission-native-writing-restart-1",
      journeyKind: "writing-artifact",
      prompt: [
        "Title: Restart-safe launch note",
        "Audience: Product leadership",
        "Purpose: Explain the verified release sequence.",
        "Point: Preserve the approved opening.",
        "Point: End with the bounded next step.",
      ].join("\n"),
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence: firstPersistence,
      nativeTools: firstNativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI writing restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before writing Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(firstPersistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({ journeyKind: "writing-artifact" }),
    ]);
    await firstPersistence.close();
    persistenceClients.splice(persistenceClients.indexOf(firstPersistence), 1);

    const reopenedPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopenedPersistence);
    const reopenedNativeTools = createScopedNativeToolPlatform({
      persistence: reopenedPersistence,
      clock,
    });
    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence: reopenedPersistence,
      nativeTools: reopenedNativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("writing recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("writing-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "writing-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-writing-restart-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-writing-restart-${String(++workerEventSequence)}`),
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
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra writing draft",
        }),
      ],
    });
    if (completed === undefined) {
      throw new Error("Expected the recovered writing journey");
    }
    expect(
      fs.readFileSync(
        path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "draft.md"),
        "utf8",
      ),
    ).toContain("# Restart-safe launch note");
  });

  it("reopens persistence and recovers a prepared Office-document journey from its owned brief", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const firstPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(firstPersistence);
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:59:00.000Z"));
    const firstNativeTools = createScopedNativeToolPlatform({
      persistence: firstPersistence,
      clock,
    });
    const document = {
      contractVersion: 1,
      title: "Restart-safe operating brief",
      owner: "Product operations",
      summary: "Record the verified Office recovery sequence.",
      sections: [
        { heading: "Recovery", body: "Resume from the persisted brief." },
        { heading: "Boundary", body: "Keep document authority in Actestra Core." },
      ],
    } as const;
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-office-restart-1",
      submissionId: "submission-native-office-restart-1",
      journeyKind: "office-document-artifact",
      prompt: [
        `Document: ${document.title}`,
        `Owner: ${document.owner}`,
        `Summary: ${document.summary}`,
        ...document.sections.map(({ heading, body }) => `Section: ${heading} | ${body}`),
      ].join("\n"),
    } as const;
    const interrupted = new AionUiGeneralWorkJourneyService({
      persistence: firstPersistence,
      nativeTools: firstNativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI Office restart workspace",
        }),
      },
      launchWorker: async () => {
        throw new Error("fixture restart before Office Worker launch");
      },
    });

    await expect(interrupted.submit(intent)).rejects.toThrow(/fixture restart/u);
    await expect(firstPersistence.listPreparedAionUiGeneralWorkJourneyLinks(10)).resolves.toEqual([
      expect.objectContaining({ journeyKind: "office-document-artifact" }),
    ]);
    await firstPersistence.close();
    persistenceClients.splice(persistenceClients.indexOf(firstPersistence), 1);

    const reopenedPersistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopenedPersistence);
    const reopenedNativeTools = createScopedNativeToolPlatform({
      persistence: reopenedPersistence,
      clock,
    });
    let nativeContextReplayCount = 0;
    let workerEventSequence = 0;
    const recovered = new AionUiGeneralWorkJourneyService({
      persistence: reopenedPersistence,
      nativeTools: reopenedNativeTools,
      clock,
      nativeContext: {
        resolve: async () => {
          nativeContextReplayCount += 1;
          throw new Error("Office recovery must not replay native workspace context");
        },
      },
      launchWorker: async ({ journeyKind, requestId }) => {
        expect(journeyKind).toBe("office-document-artifact");
        return (
          await openTestGeneralWorker(clock, {
            executionMode: "office-document-artifact-fixture",
            newAttemptToken: () => "attempt-aionui-office-restart-1",
            newToolRequestId: () => requestId,
            newEventId: () =>
              eventId(`event-aionui-office-restart-${String(++workerEventSequence)}`),
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
      artifacts: [
        expect.objectContaining({
          kind: "document",
          label: "Actestra Office document",
        }),
      ],
    });
    if (completed === undefined || completed.artifacts[0] === undefined) {
      throw new Error("Expected the recovered Office-document journey");
    }
    const packageBytes = fs.readFileSync(
      path.join(workspaceRoot, ".actestra", "task-output", completed.taskId, "brief.docx"),
    );
    expect(packageBytes.subarray(0, 2).toString("ascii")).toBe("PK");
    await expect(
      recovered.preview(
        intent.nativeConversationId,
        completed.taskId,
        completed.artifacts[0].artifactId,
      ),
    ).resolves.toMatchObject({
      label: "Actestra Office document",
      mediaType: "application/vnd.actestra.office-document-preview+json",
      document,
    });
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

  it("terminalizes an unreplaced Worker process crash and preserves it after restart", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "actestra-aionui-journey-service-test-"),
    );
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    const clock = new DeterministicAgentClock(instant("2026-08-01T00:30:00.000Z"));
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    let workerEventSequence = 0;
    let transport: LoopbackGeneralWorkerTransport | undefined;
    const service = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools,
      clock,
      nativeContext: {
        resolve: async () => ({
          rootPath: fs.realpathSync(workspaceRoot),
          displayName: "AionUI Worker crash workspace",
        }),
      },
      launchWorker: async () => {
        const opened = await openTestGeneralWorker(clock, {
          executionMode: "hold",
          newAttemptToken: () => "attempt-aionui-worker-process-crash",
          newEventId: () =>
            eventId(`event-aionui-worker-process-crash-${String(++workerEventSequence)}`),
        });
        transport = opened.transport;
        return opened.adapter;
      },
    });
    const intent = {
      contractVersion: 1,
      nativeConversationId: "conversation-native-worker-process-crash",
      submissionId: "submission-native-worker-process-crash",
      prompt: "Hold until the external Worker process is terminated.",
    } as const;

    const running = await service.submit(intent);
    expect(running).toMatchObject({ status: "running", canCancel: true, artifacts: [] });
    const activeTransport = transport;
    if (activeTransport === undefined) {
      throw new Error("Worker crash fixture did not launch its transport");
    }
    activeTransport.crash(9);
    await service.waitForIdle();

    await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        taskId: running.taskId,
        status: "failed",
        canCancel: false,
        incidentCode: "worker-process-exit",
        artifacts: [],
      }),
    ]);
    const graph = await persistence.loadDomainGraph();
    expect(graph).toMatchObject({
      tasks: [{ state: "failed", activeSessionId: undefined }],
      sessions: [{ state: "failed" }],
      workers: [{ state: "crashed" }],
      artifacts: [],
    });
    const checkpoint = await persistence.getGeneralWorkCheckpoint(graph.sessions[0]!.id);
    expect(checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "crashed",
        taskState: "failed",
        disposed: true,
        incident: { code: "worker-process-exit" },
      },
    });
    expect(checkpoint?.events.map(({ type }) => type)).toEqual([
      "task.started",
      "agent.message",
      "task.updated",
      "worker.failed",
      "task.failed",
    ]);
    await expect(persistence.listRecentAgentAttemptEvidence(10)).resolves.toEqual([
      expect.objectContaining({
        taskId: running.taskId,
        state: "crashed",
        incident: { code: "worker-process-exit", occurredAt: expect.any(String) },
      }),
    ]);

    await persistence.close();
    const reopened = (await openTestPersistenceUtility(directory)).client;
    persistenceClients.push(reopened);
    const recovery = new GeneralWorkCoordinator({ persistence: reopened, clock });
    await expect(recovery.recover()).resolves.toEqual([]);
    const launchAfterRestart = vi.fn(async () => {
      throw new Error("A finalized Worker crash must not relaunch after restart");
    });
    const restarted = new AionUiGeneralWorkJourneyService({
      persistence: reopened,
      nativeTools: createScopedNativeToolPlatform({ persistence: reopened, clock }),
      clock,
      nativeContext: {
        resolve: async () => {
          throw new Error("Worker crash recovery must not replay native context");
        },
      },
      launchWorker: launchAfterRestart,
    });
    await expect(restarted.recoverPrepared()).resolves.toEqual({
      attempted: 0,
      started: 0,
      failed: 0,
    });
    await expect(restarted.list(intent.nativeConversationId)).resolves.toEqual([
      expect.objectContaining({
        taskId: running.taskId,
        status: "failed",
        canCancel: false,
        incidentCode: "worker-process-exit",
        artifacts: [],
      }),
    ]);
    expect(launchAfterRestart).not.toHaveBeenCalled();
  });
});
