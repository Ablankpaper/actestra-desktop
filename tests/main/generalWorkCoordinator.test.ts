// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  MAX_GENERAL_WORK_CHECKPOINT_EVENTS,
  artifactId,
  correlationId,
  eventId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type AgentStartRequest,
  type CoreEvent,
  type DomainGraph,
  type GeneralWorkAttemptRecord,
  type GeneralWorkCheckpoint,
} from "../../apps/desktop/src/core";
import { createScopedNativeToolPlatform } from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import { AgentAdapterSupervisor } from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import {
  DeterministicAgentClock,
  DeterministicFakeAgentAdapter,
} from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { GeneralWorkCoordinator } from "../../apps/desktop/src/main/workers/generalWorkCoordinator";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  type GeneralWorkerProcessAdapter,
} from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import { openTestGeneralWorker } from "../fixtures/generalWorker";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";
import { createDomainGraph, createEvent } from "../fixtures/core";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";

const STARTED_AT = instant("2026-07-30T06:00:00.000Z");
const testDirectories: string[] = [];

interface Harness {
  readonly directory: string;
  readonly workspaceRoot: string;
  readonly clock: DeterministicAgentClock;
  readonly request: AgentStartRequest;
  readonly requestId: ReturnType<typeof toolRequestId>;
  readonly inputRef: ReturnType<typeof toolInputReference>;
  readonly persistence: Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"];
  readonly adapter: GeneralWorkerProcessAdapter;
  readonly supervisor: AgentAdapterSupervisor;
  readonly coordinator: GeneralWorkCoordinator;
}

const harnesses: Harness[] = [];

function domainGraph(request: AgentStartRequest): DomainGraph {
  return {
    workspaces: [
      {
        id: request.workspaceId,
        name: "General-work recovery workspace",
        state: "active",
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    tasks: [
      {
        id: request.taskId,
        workspaceId: request.workspaceId,
        title: "Create a recoverable artifact",
        state: "running",
        activeSessionId: request.sessionId,
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    sessions: [
      {
        id: request.sessionId,
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        workerId: request.workerId,
        state: "running",
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    workers: [
      {
        id: request.workerId,
        workspaceId: request.workspaceId,
        adapterKind: GENERAL_WORKER_ADAPTER_KIND,
        state: "busy",
        createdAt: request.startedAt,
        updatedAt: request.startedAt,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

async function openHarness(suffix: string): Promise<Harness> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-general-work-test-"));
  testDirectories.push(directory);
  const workspaceRoot = path.join(directory, "workspace");
  fs.mkdirSync(workspaceRoot);
  const clock = new DeterministicAgentClock(STARTED_AT);
  const request: AgentStartRequest = {
    workspaceId: workspaceId(`workspace-recovery-${suffix}`),
    taskId: taskId(`task-recovery-${suffix}`),
    sessionId: sessionId(`session-recovery-${suffix}`),
    workerId: workerId(`worker-recovery-${suffix}`),
    streamId: eventStreamId(`stream-recovery-${suffix}`),
    correlationId: correlationId(`correlation-recovery-${suffix}`),
    taskState: "ready",
    startedAt: clock.now(),
    initialPrompt: "Create one output through the scoped native tool.",
  };
  const requestId = toolRequestId(`request-recovery-${suffix}`);
  const inputRef = toolInputReference(`input-recovery-${suffix}`);
  const persistence = (await openTestPersistenceUtility(directory)).client;
  await persistence.replaceDomainGraph(domainGraph(request));
  const grant = {
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    grantId: workspaceGrantId(`grant-recovery-${suffix}`),
    workspaceId: request.workspaceId,
    rootPath: fs.realpathSync(workspaceRoot),
    displayName: "General-work fixture",
    state: "active",
    createdAt: clock.now(),
    updatedAt: clock.now(),
  } as const;
  await persistence.persistWorkspaceGrant(grant);
  await persistence.storeContentReference({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: inputRef,
    kind: "tool-input",
    owner: {
      workspaceId: request.workspaceId,
      taskId: request.taskId,
      sessionId: request.sessionId,
      workerId: request.workerId,
      requestId,
      grantId: grant.grantId,
    },
    classification: "task-content",
    mediaType: "text/plain; charset=utf-8",
    content: JSON.stringify({
      contractVersion: 1,
      relativePath: "result.txt",
      mediaType: "text/plain; charset=utf-8",
      content: `durable output ${suffix}`,
    }),
    createdAt: clock.now(),
  });
  let workerEventSequence = 0;
  const { adapter } = await openTestGeneralWorker(clock, {
    executionMode: "task-output-write-text-fixture",
    newAttemptToken: () => `attempt-recovery-${suffix}`,
    newToolRequestId: () => requestId,
    newEventId: () => eventId(`event-worker-recovery-${suffix}-${String(++workerEventSequence)}`),
  });
  const supervisor = new AgentAdapterSupervisor(adapter, clock, {
    expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
    requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
    startupTimeoutMs: 2_000,
    heartbeatTimeoutMs: 3_000,
    cancellationTimeoutMs: 1_000,
    maxRestarts: 1,
  });
  const nativeTools = createScopedNativeToolPlatform({
    persistence,
    clock,
  });
  let recoveryEventSequence = 0;
  const coordinator = new GeneralWorkCoordinator({
    persistence,
    clock,
    supervisor,
    nativeTools,
    newEventId: () => eventId(`event-core-recovery-${suffix}-${String(++recoveryEventSequence)}`),
  });
  await supervisor.start(request);
  expect(supervisor.snapshot(request.sessionId)).toMatchObject({
    state: "blocked",
    taskState: "blocked",
  });
  const harness = {
    directory,
    workspaceRoot,
    clock,
    request,
    requestId,
    inputRef,
    persistence,
    adapter,
    supervisor,
    coordinator,
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.adapter.close().catch(() => undefined);
    await harness.persistence.close().catch(() => undefined);
  }
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-general-work-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("GeneralWorkCoordinator", () => {
  it("checkpoints a workspace read before the same Worker creates its file artifact", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-general-work-test-"));
    testDirectories.push(directory);
    const workspaceRoot = path.join(directory, "workspace");
    fs.mkdirSync(workspaceRoot);
    fs.writeFileSync(path.join(workspaceRoot, "actestra-input.txt"), "Private workspace source\n");
    const clock = new DeterministicAgentClock(STARTED_AT);
    const request: AgentStartRequest = {
      workspaceId: workspaceId("workspace-sequential-file"),
      taskId: taskId("task-sequential-file"),
      sessionId: sessionId("session-sequential-file"),
      workerId: workerId("worker-sequential-file"),
      streamId: eventStreamId("stream-sequential-file"),
      correlationId: correlationId("correlation-sequential-file"),
      taskState: "ready",
      startedAt: clock.now(),
      initialPrompt: "Process the reserved workspace text.",
    };
    const readRequestId = toolRequestId("request-sequential-file-read");
    const writeRequestId = toolRequestId("request-sequential-file-write");
    const readInputRef = toolInputReference("input-sequential-file-read");
    const writeInputRef = toolInputReference("input-sequential-file-write");
    const persistence = (await openTestPersistenceUtility(directory)).client;
    await persistence.replaceDomainGraph(domainGraph(request));
    const grant = {
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: workspaceGrantId("grant-sequential-file"),
      workspaceId: request.workspaceId,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Sequential file fixture",
      state: "active",
      createdAt: clock.now(),
      updatedAt: clock.now(),
    } as const;
    await persistence.persistWorkspaceGrant(grant);
    await persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: readInputRef,
      kind: "tool-input",
      owner: {
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        sessionId: request.sessionId,
        workerId: request.workerId,
        requestId: readRequestId,
        grantId: grant.grantId,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: JSON.stringify({
        contractVersion: 1,
        relativePath: "actestra-input.txt",
      }),
      createdAt: clock.now(),
    });
    const toolRequestIds = [readRequestId, writeRequestId];
    let toolRequestIndex = 0;
    let workerEventSequence = 0;
    const { adapter } = await openTestGeneralWorker(clock, {
      executionMode: "workspace-read-then-task-output-write-fixture",
      newAttemptToken: () => "attempt-sequential-file",
      newToolRequestId: () => toolRequestIds[toolRequestIndex++]!,
      newEventId: () => eventId(`event-sequential-file-${String(++workerEventSequence)}`),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, clock, {
      expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
      requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      startupTimeoutMs: 2_000,
      heartbeatTimeoutMs: 3_000,
      cancellationTimeoutMs: 1_000,
      maxRestarts: 1,
    });
    const coordinator = new GeneralWorkCoordinator({
      persistence,
      clock,
      supervisor,
      nativeTools: createScopedNativeToolPlatform({ persistence, clock }),
    });
    await supervisor.start(request);
    await coordinator.checkpointAttempt(request.sessionId);

    const read = await coordinator.invokeScopedToolStep({
      invocation: {
        sessionId: request.sessionId,
        requestId: readRequestId,
        inputRef: readInputRef,
      },
    });
    expect(read.result).toMatchObject({
      requestId: readRequestId,
      status: "succeeded",
    });
    expect(supervisor.snapshot(request.sessionId).state).toBe("running");
    if (read.result.status !== "succeeded" || read.result.outputRef === undefined) {
      throw new Error("Expected the sequential workspace read to return an output reference");
    }
    const source = await persistence.resolveContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: read.result.outputRef,
      kind: "tool-output",
      owner: {
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        sessionId: request.sessionId,
        workerId: request.workerId,
        requestId: readRequestId,
        grantId: grant.grantId,
      },
      resolvedAt: clock.now(),
      consume: false,
    });
    await supervisor.send(request.sessionId, {
      messageId: correlationId("message-sequential-file-source"),
      content: source.content,
      sentAt: clock.now(),
    });
    const privateWriteInput = adapter.activeToolInput(writeRequestId);
    expect(privateWriteInput?.content).toContain("Private workspace source");
    expect(JSON.stringify(supervisor.coreEvents(request.sessionId))).not.toContain(
      "Private workspace source",
    );
    await persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: writeInputRef,
      kind: "tool-input",
      owner: {
        workspaceId: request.workspaceId,
        taskId: request.taskId,
        sessionId: request.sessionId,
        workerId: request.workerId,
        requestId: writeRequestId,
        grantId: grant.grantId,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: JSON.stringify(privateWriteInput),
      createdAt: clock.now(),
    });

    const written = await coordinator.invokeScopedTool({
      invocation: {
        sessionId: request.sessionId,
        requestId: writeRequestId,
        inputRef: writeInputRef,
      },
      artifact: {
        artifactId: artifactId("artifact-sequential-file"),
        kind: "file",
        label: "Actestra file result",
      },
    });
    expect(written.finalization.checkpoint).toMatchObject({
      phase: "finalized",
      attempt: { state: "completed", taskState: "completed" },
      tool: {
        requestId: writeRequestId,
        state: "succeeded",
      },
      artifactBinding: {
        artifact: {
          id: artifactId("artifact-sequential-file"),
        },
      },
    });
    expect(
      written.finalization.checkpoint.events.filter((event) => event.type === "tool.requested"),
    ).toHaveLength(2);
    await adapter.close();
    await persistence.close();
  });

  it("persists an evicted event prefix before advancing the recovery window", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-general-work-test-"));
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    const checkpoint = createGeneralWorkCheckpoint();
    await persistence.replaceDomainGraph(createDomainGraph());
    const events = [
      ...checkpoint.events,
      ...Array.from({ length: 130 - checkpoint.events.length }, (_, index) =>
        createEvent(index + checkpoint.events.length + 1, "agent.message", {
          role: "assistant",
          content: `Progress ${String(index + 1)}`,
        }),
      ),
    ];
    const coordinator = new GeneralWorkCoordinator({
      persistence,
      clock: new DeterministicAgentClock(instant("2026-07-30T06:02:10.000Z")),
    });
    const persistActive = (
      coordinator as unknown as {
        persistActive(
          snapshot: GeneralWorkAttemptRecord,
          currentEvents: readonly CoreEvent[],
        ): Promise<GeneralWorkCheckpoint>;
      }
    ).persistActive.bind(coordinator);

    const durable = await persistActive(
      {
        ...checkpoint.attempt,
        lastCoreEventSequence: 130,
      },
      events,
    );

    expect(durable.eventBaseline).toMatchObject({
      sequence: 2,
      taskState: "running",
    });
    expect(durable.events).toHaveLength(MAX_GENERAL_WORK_CHECKPOINT_EVENTS);
    await expect(persistence.replayEvents(checkpoint.attempt.streamId)).resolves.toMatchObject([
      { sequence: 1 },
      { sequence: 2 },
    ]);
    await persistence.close();
  });

  it("crosses the persist-before-release barrier with an owned artifact", async () => {
    const harness = await openHarness("success");
    const artifact = artifactId("artifact-recovery-success");
    const grant = await harness.persistence.getActiveWorkspaceGrant(harness.request.workspaceId);
    expect(grant).not.toBeNull();
    const completed = await harness.coordinator.invokeScopedTool({
      invocation: {
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef: harness.inputRef,
      },
      artifact: {
        artifactId: artifact,
        kind: "file",
        label: "Recovered output",
      },
    });

    expect(completed.result).toMatchObject({
      status: "succeeded",
    });
    expect(completed.finalization).toMatchObject({
      sessionId: harness.request.sessionId,
      artifactId: artifact,
      checkpoint: {
        phase: "finalized",
        artifactIntent: {
          grantId: grant!.grantId,
        },
        artifactBinding: {
          owner: {
            grantId: grant!.grantId,
          },
        },
      },
    });
    expect(harness.supervisor.listAttempts()).toEqual([]);
    const graph = await harness.persistence.loadDomainGraph();
    expect(graph.tasks).toMatchObject([{ state: "completed", activeSessionId: undefined }]);
    expect(graph.sessions).toMatchObject([{ state: "completed" }]);
    expect(graph.workers).toMatchObject([{ state: "stopped" }]);
    expect(graph.artifacts).toMatchObject([
      {
        id: artifact,
        taskId: harness.request.taskId,
        sessionId: harness.request.sessionId,
        state: "available",
      },
    ]);
    const events = await harness.persistence.replayEvents(harness.request.streamId);
    expect(events.map(({ type }) => type)).toEqual([
      "task.started",
      "tool.requested",
      "task.updated",
      "worker.blocked",
      "artifact.created",
      "tool.started",
      "tool.completed",
      "task.updated",
      "task.completed",
    ]);
    await expect(harness.persistence.listRecentAgentAttemptEvidence(1)).resolves.toMatchObject([
      {
        sessionId: harness.request.sessionId,
        state: "completed",
        lastCoreEventSequence: 9,
      },
    ]);

    const replay = vi.spyOn(harness.persistence, "replayEvents").mockResolvedValueOnce([]);
    const verifyCheckpointHistory = (
      harness.coordinator as unknown as {
        verifyCheckpointHistory(checkpoint: GeneralWorkCheckpoint): Promise<void>;
      }
    ).verifyCheckpointHistory.bind(harness.coordinator);
    await expect(
      verifyCheckpointHistory({
        ...completed.finalization.checkpoint,
        events: completed.finalization.checkpoint.events.filter(
          (event) => event.type !== "artifact.created",
        ),
      }),
    ).rejects.toMatchObject({
      code: "artifact-mismatch",
    });
    replay.mockRestore();
  });

  it("rejects a non-file task-output intent before privileged execution", async () => {
    const harness = await openHarness("non-file-artifact");
    await expect(
      harness.coordinator.invokeScopedTool({
        invocation: {
          sessionId: harness.request.sessionId,
          requestId: harness.requestId,
          inputRef: harness.inputRef,
        },
        artifact: {
          artifactId: artifactId("artifact-recovery-non-file"),
          kind: "directory",
          label: "Invalid output kind",
        },
      }),
    ).rejects.toMatchObject({
      code: "artifact-mismatch",
    });
    await expect(
      harness.persistence.getGeneralWorkCheckpoint(harness.request.sessionId),
    ).resolves.toBeNull();
    expect(
      fs.existsSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "result.txt",
        ),
      ),
    ).toBe(false);
  });

  it("retries a persisted tool result without executing the create-only output twice", async () => {
    const harness = await openHarness("retained-result");
    const artifact = artifactId("artifact-recovery-retained-result");
    const appendArtifact = vi.spyOn(harness.supervisor, "appendAuthoritativeArtifactEvent");
    appendArtifact.mockRejectedValueOnce(new Error("Injected artifact projection interruption"));
    const invocation = {
      invocation: {
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef: harness.inputRef,
      },
      artifact: {
        artifactId: artifact,
        kind: "file" as const,
        label: "Retained output",
      },
    };

    await expect(harness.coordinator.invokeScopedTool(invocation)).rejects.toThrow(
      "Injected artifact projection interruption",
    );
    await expect(
      harness.persistence.getGeneralWorkCheckpoint(harness.request.sessionId),
    ).resolves.toMatchObject({
      phase: "active",
      tool: {
        state: "succeeded",
      },
      artifactBinding: {
        artifact: {
          id: artifact,
        },
      },
    });
    await expect(harness.coordinator.invokeScopedTool(invocation)).resolves.toMatchObject({
      result: {
        status: "succeeded",
      },
      finalization: {
        checkpoint: {
          phase: "finalized",
        },
      },
    });
    expect(appendArtifact).toHaveBeenCalledTimes(2);
    await expect(harness.persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    expect(
      fs.readFileSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "result.txt",
        ),
        "utf8",
      ),
    ).toBe("durable output retained-result");
  });

  it("recovers an application-interrupted active attempt with explicit failure", async () => {
    const harness = await openHarness("app-restart");
    await harness.coordinator.checkpointAttempt(harness.request.sessionId);
    await harness.adapter.close();
    await harness.persistence.close();

    const reopened = (await openTestPersistenceUtility(harness.directory)).client;
    const recovery = new GeneralWorkCoordinator({
      persistence: reopened,
      clock: harness.clock,
      newEventId: (() => {
        let sequence = 0;
        return () => eventId(`event-app-restart-${String(++sequence)}`);
      })(),
    });
    await expect(recovery.recover()).resolves.toMatchObject([
      {
        recoveredFrom: "active",
        sessionId: harness.request.sessionId,
        checkpoint: {
          phase: "finalized",
          attempt: {
            state: "failed",
            taskState: "failed",
            incident: {
              code: "application-restart",
            },
          },
        },
      },
    ]);
    await expect(reopened.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ state: "failed", activeSessionId: undefined }],
      sessions: [{ state: "failed" }],
      workers: [{ state: "stopped" }],
      artifacts: [],
    });
    const events = await reopened.replayEvents(harness.request.streamId);
    expect(events.slice(-2).map(({ type }) => type)).toEqual(["worker.failed", "task.failed"]);
    await reopened.close();
  });

  it("records an interrupted create-only tool as explicitly may-have-executed", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-general-work-test-"));
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    const checkpoint = createGeneralWorkCheckpoint();
    await persistence.replaceDomainGraph(createDomainGraph());
    await persistence.persistGeneralWorkCheckpoint(checkpoint);
    const recovery = new GeneralWorkCoordinator({
      persistence,
      clock: new DeterministicAgentClock(instant("2026-07-30T06:10:00.000Z")),
      newEventId: (() => {
        let sequence = 0;
        return () => eventId(`event-ambiguous-recovery-${String(++sequence)}`);
      })(),
    });

    await expect(recovery.recover()).resolves.toMatchObject([
      {
        recoveredFrom: "active",
        checkpoint: {
          phase: "finalized",
          tool: {
            state: "in-flight",
            mayHaveExecuted: true,
          },
        },
      },
    ]);
    const events = await persistence.replayEvents(checkpoint.attempt.streamId);
    expect(events.find(({ type }) => type === "tool.failed")).toMatchObject({
      payload: {
        errorCode: "application-restart",
        mayHaveExecuted: true,
      },
    });
    await persistence.close();
  });

  it("fails closed when a checkpoint baseline is absent from authoritative events", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-general-work-test-"));
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    const active = createGeneralWorkCheckpoint();
    await persistence.replaceDomainGraph(createDomainGraph());
    await persistence.persistGeneralWorkCheckpoint({
      ...active,
      eventBaseline: {
        sequence: 2,
        event: active.events[1]!,
        taskState: "running",
      },
      events: active.events.slice(2),
    });
    const recovery = new GeneralWorkCoordinator({
      persistence,
      clock: new DeterministicAgentClock(instant("2026-07-30T06:12:00.000Z")),
      newEventId: (() => {
        let sequence = 0;
        return () => eventId(`event-missing-baseline-${String(++sequence)}`);
      })(),
    });

    await expect(recovery.recover()).rejects.toMatchObject({
      code: "event-mismatch",
    });
    await expect(
      persistence.getGeneralWorkCheckpoint(active.attempt.sessionId),
    ).resolves.toMatchObject({
      phase: "terminal-pending",
    });
    await expect(persistence.replayEvents(active.attempt.streamId)).resolves.toEqual([]);
    await persistence.close();
  });

  it("durably cancels before mutation without creating an artifact", async () => {
    const harness = await openHarness("cancelled");
    const controller = new AbortController();
    controller.abort("User cancelled the recoverable output");
    const completed = await harness.coordinator.invokeScopedTool({
      invocation: {
        sessionId: harness.request.sessionId,
        requestId: harness.requestId,
        inputRef: harness.inputRef,
        signal: controller.signal,
      },
      artifact: {
        artifactId: artifactId("artifact-recovery-cancelled"),
        kind: "file",
        label: "Cancelled output",
      },
    });

    expect(completed.result).toMatchObject({
      status: "cancelled",
      reason: "User cancelled the recoverable output",
    });
    expect(completed.finalization.checkpoint).toMatchObject({
      phase: "finalized",
      attempt: {
        state: "cancelled",
        taskState: "cancelled",
      },
    });
    expect(completed.finalization.checkpoint.artifactBinding).toBeUndefined();
    await expect(harness.persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ state: "cancelled", activeSessionId: undefined }],
      sessions: [{ state: "cancelled" }],
      artifacts: [],
    });
    const events = await harness.persistence.replayEvents(harness.request.streamId);
    expect(events.find(({ type }) => type === "tool.failed")).toMatchObject({
      payload: {
        errorCode: "tool-cancelled",
        mayHaveExecuted: false,
      },
    });
    expect(
      fs.existsSync(
        path.join(
          harness.workspaceRoot,
          ".actestra",
          "task-output",
          harness.request.taskId,
          "result.txt",
        ),
      ),
    ).toBe(false);
  });

  it("persists a crashed attempt before continuing with fresh replacement identities", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-general-work-test-"));
    testDirectories.push(directory);
    const persistence = (await openTestPersistenceUtility(directory)).client;
    const clock = new DeterministicAgentClock(instant("2026-07-30T06:20:00.000Z"));
    const first: AgentStartRequest = {
      workspaceId: workspaceId("workspace-recovery-restart"),
      taskId: taskId("task-recovery-restart"),
      sessionId: sessionId("session-recovery-restart-1"),
      workerId: workerId("worker-recovery-restart-1"),
      streamId: eventStreamId("stream-recovery-restart-1"),
      correlationId: correlationId("correlation-recovery-restart"),
      taskState: "ready",
      startedAt: clock.now(),
      initialPrompt: "Crash once, then continue with fresh identities.",
    };
    await persistence.replaceDomainGraph(domainGraph(first));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, {
      expectedAdapterKind: "deterministic-fake",
      requiredCapabilities: ["messages", "approvals", "cancellation", "heartbeats", "tool-results"],
      startupTimeoutMs: 2_000,
      heartbeatTimeoutMs: 3_000,
      cancellationTimeoutMs: 1_000,
      maxRestarts: 1,
    });
    const nativeTools = createScopedNativeToolPlatform({ persistence, clock });
    const coordinator = new GeneralWorkCoordinator({
      persistence,
      clock,
      supervisor,
      nativeTools,
    });
    adapter.registerPlan(first.sessionId, {
      steps: [
        {
          type: "crash",
          errorCode: "worker-crashed",
          message: "Injected retryable crash.",
          retryable: true,
        },
      ],
    });
    await supervisor.start(first);
    await coordinator.checkpointAttempt(first.sessionId);
    await adapter.advance(first.sessionId);
    expect(supervisor.snapshot(first.sessionId)).toMatchObject({
      state: "crashed",
      taskState: "blocked",
    });

    const replacement: AgentStartRequest = {
      ...first,
      sessionId: sessionId("session-recovery-restart-2"),
      workerId: workerId("worker-recovery-restart-2"),
      streamId: eventStreamId("stream-recovery-restart-2"),
      taskState: "blocked",
      startedAt: clock.now(),
    };
    const graphAfterCrash = await persistence.loadDomainGraph();
    await persistence.replaceDomainGraph({
      ...graphAfterCrash,
      tasks: graphAfterCrash.tasks.map((task) => ({
        ...task,
        state: "blocked",
        activeSessionId: replacement.sessionId,
      })),
      workers: [
        ...graphAfterCrash.workers,
        {
          id: replacement.workerId,
          workspaceId: replacement.workspaceId,
          adapterKind: "deterministic-fake",
          state: "ready",
          createdAt: clock.now(),
          updatedAt: clock.now(),
        },
      ],
      sessions: [
        ...graphAfterCrash.sessions,
        {
          id: replacement.sessionId,
          workspaceId: replacement.workspaceId,
          taskId: replacement.taskId,
          workerId: replacement.workerId,
          state: "created",
          createdAt: clock.now(),
          updatedAt: clock.now(),
        },
      ],
    });
    adapter.registerPlan(replacement.sessionId, {
      steps: [{ type: "complete" }],
    });
    await supervisor.restart(first.sessionId, replacement);
    await coordinator.finalizeAttempt(first.sessionId);
    await expect(persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ state: "blocked", activeSessionId: replacement.sessionId }],
      sessions: [{ state: "failed" }, { state: "created" }],
      workers: [{ state: "crashed" }, { state: "ready" }],
    });

    await coordinator.checkpointAttempt(replacement.sessionId);
    await adapter.advance(replacement.sessionId);
    await coordinator.finalizeAttempt(replacement.sessionId);
    await expect(persistence.listRecentAgentAttemptEvidence(2)).resolves.toMatchObject([
      {
        sessionId: replacement.sessionId,
        state: "completed",
        restartedFromSessionId: first.sessionId,
      },
      {
        sessionId: first.sessionId,
        state: "crashed",
        replacementSessionId: replacement.sessionId,
      },
    ]);
    await expect(persistence.loadDomainGraph()).resolves.toMatchObject({
      tasks: [{ state: "completed", activeSessionId: undefined }],
      sessions: [{ state: "failed" }, { state: "completed" }],
      workers: [{ state: "crashed" }, { state: "stopped" }],
    });
    await persistence.close();
  });

  it("retries a terminal checkpoint after an injected persistence failure", async () => {
    const harness = await openHarness("persistence-retry");
    const appendEvent = harness.persistence.appendEvent.bind(harness.persistence);
    let injected = false;
    harness.persistence.appendEvent = async (event) => {
      if (!injected) {
        injected = true;
        throw new Error("Injected append failure");
      }
      return appendEvent(event);
    };
    await expect(
      harness.coordinator.invokeScopedTool({
        invocation: {
          sessionId: harness.request.sessionId,
          requestId: harness.requestId,
          inputRef: harness.inputRef,
        },
        artifact: {
          artifactId: artifactId("artifact-recovery-persistence"),
          kind: "file",
          label: "Persistence retry output",
        },
      }),
    ).rejects.toThrow("Injected append failure");
    await expect(
      harness.persistence.getGeneralWorkCheckpoint(harness.request.sessionId),
    ).resolves.toMatchObject({
      phase: "terminal-pending",
    });
    harness.persistence.appendEvent = appendEvent;
    await harness.adapter.close();
    await harness.persistence.close();

    const reopened = (await openTestPersistenceUtility(harness.directory)).client;
    const recovery = new GeneralWorkCoordinator({
      persistence: reopened,
      clock: harness.clock,
    });
    await expect(recovery.recover()).resolves.toMatchObject([
      {
        recoveredFrom: "terminal-pending",
        checkpoint: {
          phase: "finalized",
        },
      },
    ]);
    await expect(reopened.replayEvents(harness.request.streamId)).resolves.toHaveLength(9);
    await expect(reopened.listRecentAgentAttemptEvidence(1)).resolves.toHaveLength(1);
    await reopened.close();
  });

  it("fails closed on artifact identity conflict without releasing the checkpoint", async () => {
    const harness = await openHarness("artifact-conflict");
    const conflictingId = artifactId("artifact-recovery-conflict");
    const graph = await harness.persistence.loadDomainGraph();
    await harness.persistence.replaceDomainGraph({
      ...graph,
      artifacts: [
        {
          id: conflictingId,
          workspaceId: harness.request.workspaceId,
          taskId: harness.request.taskId,
          sessionId: harness.request.sessionId,
          kind: "file",
          label: "Pre-existing artifact",
          state: "available",
          createdAt: harness.clock.now(),
          updatedAt: harness.clock.now(),
        },
      ],
    });

    await expect(
      harness.coordinator.invokeScopedTool({
        invocation: {
          sessionId: harness.request.sessionId,
          requestId: harness.requestId,
          inputRef: harness.inputRef,
        },
        artifact: {
          artifactId: conflictingId,
          kind: "file",
          label: "Conflicting artifact",
        },
      }),
    ).rejects.toMatchObject({
      code: "artifact-mismatch",
    });
    await expect(
      harness.persistence.getGeneralWorkCheckpoint(harness.request.sessionId),
    ).resolves.toMatchObject({
      phase: "terminal-pending",
    });
    await expect(harness.persistence.listRecentAgentAttemptEvidence(1)).resolves.toEqual([]);
    expect(harness.supervisor.listAttempts()).toHaveLength(1);
  });
});
