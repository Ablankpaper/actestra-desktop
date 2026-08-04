import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  GENERAL_WORK_RECOVERY_CONTRACT_VERSION,
  MAX_GENERAL_WORK_CHECKPOINT_EVENTS,
  MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS,
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  WORKSPACE_READ_TEXT_TOOL_ID,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  AgentAdapterError,
  GeneralWorkRecoveryError,
  advanceCoreEventStreamState,
  artifactId,
  assertAgentToolResult,
  assertGeneralWorkCheckpoint,
  compareInstants,
  createCoreEventStreamState,
  createGeneralWorkEventStreamState,
  eventId,
  instant,
  toolId,
  type ActestraPersistencePort,
  type AgentClock,
  type AgentToolResult,
  type Artifact,
  type CoreEvent,
  type CoreEventType,
  type DomainGraph,
  type EventId,
  type EventPayloadByType,
  type GeneralWorkArtifactBinding,
  type GeneralWorkArtifactIntent,
  type GeneralWorkAttemptRecord,
  type GeneralWorkCheckpoint,
  type GeneralWorkEventBaseline,
  type GeneralWorkTerminalAttemptState,
  type GeneralWorkToolCheckpoint,
  type Instant,
  type Session,
  type SessionId,
  type SessionState,
  type Task,
  type TaskState,
  type ToolRequestId,
  type Worker,
  type WorkerState,
} from "../../core";
import type { ScopedNativeToolPlatform } from "../privileged/scopedNativeToolPlatform";
import { withPersistenceMutationBarrier } from "../persistence/persistenceMutationBarrier";
import { AgentAdapterSupervisor, type AgentAttemptSnapshot } from "./agentAdapterSupervisor";
import { createAgentAttemptEvidence } from "./agentAttemptEvidenceCoordinator";
import {
  ScopedNativeToolCoordinator,
  type ScopedNativeToolInvocation,
  type ScopedNativeToolResolutionContext,
} from "./scopedNativeToolCoordinator";

export interface GeneralWorkArtifactRequest {
  readonly artifactId: ReturnType<typeof artifactId>;
  readonly kind: GeneralWorkArtifactIntent["kind"];
  readonly label: string;
}

export interface GeneralWorkToolInvocation {
  readonly invocation: ScopedNativeToolInvocation;
  readonly artifact?: GeneralWorkArtifactRequest;
}

export interface GeneralWorkFinalization {
  readonly sessionId: SessionId;
  readonly checkpoint: GeneralWorkCheckpoint;
  readonly eventStatuses: readonly ("appended" | "duplicate")[];
  readonly evidenceStatus: "appended" | "duplicate";
  readonly artifactId?: ReturnType<typeof artifactId>;
}

export interface GeneralWorkRecoveryResult extends GeneralWorkFinalization {
  readonly recoveredFrom: "active" | "terminal-pending";
}

export interface GeneralWorkCoordinatorConfig {
  readonly persistence: ActestraPersistencePort;
  readonly clock: AgentClock;
  readonly newEventId?: () => EventId;
  readonly supervisor?: AgentAdapterSupervisor;
  readonly nativeTools?: ScopedNativeToolPlatform;
  readonly unreplacedCrashDisposition?: "blocked" | "failed";
}

function createsTaskOutputArtifact(tool: ReturnType<typeof toolId>): boolean {
  return (
    tool === TASK_OUTPUT_WRITE_TEXT_TOOL_ID || tool === TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID
  );
}

function defaultEventId(): EventId {
  return eventId(`event-general-work-${randomUUID()}`);
}

function immutableAttempt(snapshot: AgentAttemptSnapshot): GeneralWorkAttemptRecord {
  return Object.freeze({
    workspaceId: snapshot.workspaceId,
    taskId: snapshot.taskId,
    correlationId: snapshot.correlationId,
    sessionId: snapshot.sessionId,
    workerId: snapshot.workerId,
    streamId: snapshot.streamId,
    state: snapshot.state as GeneralWorkAttemptRecord["state"],
    ...(snapshot.taskState === undefined ? {} : { taskState: snapshot.taskState }),
    startedAt: snapshot.startedAt,
    lastSignalAt: snapshot.lastSignalAt,
    lastControlSequence: snapshot.lastControlSequence,
    lastCoreEventSequence: snapshot.lastCoreEventSequence,
    restartCount: snapshot.restartCount,
    ...(snapshot.restartedFromSessionId === undefined
      ? {}
      : { restartedFromSessionId: snapshot.restartedFromSessionId }),
    ...(snapshot.replacementSessionId === undefined
      ? {}
      : { replacementSessionId: snapshot.replacementSessionId }),
    disposed: snapshot.disposed,
    forcedCancellation: snapshot.forcedCancellation,
    ...(snapshot.incident === undefined
      ? {}
      : {
          incident: Object.freeze({
            code: snapshot.incident.code,
            occurredAt: snapshot.incident.occurredAt,
          }),
        }),
  });
}

function terminalAttemptWithToolIncident(
  snapshot: AgentAttemptSnapshot,
  checkpoint: GeneralWorkCheckpoint,
  events: readonly CoreEvent[],
): GeneralWorkAttemptRecord {
  const attempt = immutableAttempt(snapshot);
  if (attempt.state !== "failed" || checkpoint.tool?.state !== "failed") {
    return attempt;
  }

  const terminalEvent = events.at(-1);
  if (
    terminalEvent?.type !== "task.failed" ||
    terminalEvent.payload.errorCode !== checkpoint.tool.errorCode
  ) {
    throw new GeneralWorkRecoveryError(
      "event-mismatch",
      "A failed General Work tool requires matching terminal Task evidence",
    );
  }
  if (attempt.incident !== undefined) {
    return attempt;
  }
  return Object.freeze({
    ...attempt,
    incident: Object.freeze({
      code: checkpoint.tool.errorCode,
      occurredAt: terminalEvent.occurredAt,
    }),
  });
}

function maximumInstant(...values: readonly Instant[]): Instant {
  return values.reduce((latest, value) => (compareInstants(value, latest) > 0 ? value : latest));
}

function taskStateForAttempt(attempt: GeneralWorkAttemptRecord): TaskState {
  switch (attempt.state as GeneralWorkTerminalAttemptState) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "crashed":
      return attempt.taskState === "failed" ? "failed" : "blocked";
    case "failed":
    case "timed-out":
    case "protocol-failed":
      return "failed";
  }
}

function sessionStateForAttempt(state: GeneralWorkTerminalAttemptState): SessionState {
  switch (state) {
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "crashed":
    case "failed":
    case "timed-out":
    case "protocol-failed":
      return "failed";
  }
}

function workerStateForAttempt(state: GeneralWorkTerminalAttemptState): WorkerState {
  return state === "crashed" || state === "timed-out" || state === "protocol-failed"
    ? "crashed"
    : "stopped";
}

function updateTask(task: Task, attempt: GeneralWorkAttemptRecord, updatedAt: Instant): Task {
  const state = taskStateForAttempt(attempt);
  return Object.freeze({
    ...task,
    state,
    ...(state === "blocked"
      ? { activeSessionId: attempt.replacementSessionId ?? attempt.sessionId }
      : { activeSessionId: undefined }),
    updatedAt: maximumInstant(task.updatedAt, updatedAt),
  });
}

function updateSession(
  session: Session,
  attempt: GeneralWorkAttemptRecord,
  updatedAt: Instant,
): Session {
  return Object.freeze({
    ...session,
    state: sessionStateForAttempt(attempt.state as GeneralWorkTerminalAttemptState),
    updatedAt: maximumInstant(session.updatedAt, updatedAt),
  });
}

function updateWorker(
  worker: Worker,
  attempt: GeneralWorkAttemptRecord,
  updatedAt: Instant,
): Worker {
  return Object.freeze({
    ...worker,
    state: workerStateForAttempt(attempt.state as GeneralWorkTerminalAttemptState),
    updatedAt: maximumInstant(worker.updatedAt, updatedAt),
  });
}

export class GeneralWorkCoordinator {
  private readonly newEventId: () => EventId;
  private readonly scopedTools?: ScopedNativeToolCoordinator;

  constructor(private readonly config: GeneralWorkCoordinatorConfig) {
    this.newEventId = config.newEventId ?? defaultEventId;
    if ((config.supervisor === undefined) !== (config.nativeTools === undefined)) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "Live general-work coordination requires both a supervisor and native tools",
      );
    }
    if (config.supervisor !== undefined && config.nativeTools !== undefined) {
      this.scopedTools = new ScopedNativeToolCoordinator(
        config.supervisor,
        config.nativeTools.toolGateway,
        config.clock,
        (context) => this.stageToolResolution(context),
      );
    }
  }

  async checkpointAttempt(session: SessionId): Promise<GeneralWorkCheckpoint> {
    const supervisor = this.requireSupervisor();
    const snapshot = supervisor.snapshot(session);
    if (snapshot.disposed) {
      throw new AgentAdapterError("invalid-state", `Session ${session} is already terminal`);
    }
    return this.persistActive(snapshot, supervisor.coreEvents(session));
  }

  async invokeScopedTool(request: GeneralWorkToolInvocation): Promise<{
    readonly result: AgentToolResult;
    readonly finalization: GeneralWorkFinalization;
  }> {
    const { result } = await this.invokeScopedToolStep(request);
    const supervisor = this.requireSupervisor();
    await supervisor.awaitCleanup(request.invocation.sessionId);
    const finalization = await this.finalizeAttempt(request.invocation.sessionId);
    return Object.freeze({ result, finalization });
  }

  async invokeScopedToolStep(request: GeneralWorkToolInvocation): Promise<{
    readonly result: AgentToolResult;
    readonly checkpoint: GeneralWorkCheckpoint;
  }> {
    const supervisor = this.requireSupervisor();
    const scopedTools = this.requireScopedTools();
    const snapshot = supervisor.snapshot(request.invocation.sessionId);
    const requested = supervisor
      .coreEvents(request.invocation.sessionId)
      .filter(
        (event) =>
          event.type === "tool.requested" &&
          event.payload.requestId === request.invocation.requestId,
      );
    if (requested.length !== 1 || requested[0]?.type !== "tool.requested") {
      throw new GeneralWorkRecoveryError(
        "event-mismatch",
        "General-work tool invocation has no unique request event",
      );
    }
    const requestedTool = toolId(requested[0].payload.toolName);
    if (createsTaskOutputArtifact(requestedTool) !== (request.artifact !== undefined)) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "Task-output writes require exactly one authoritative artifact intent",
      );
    }
    if (
      request.artifact !== undefined &&
      requestedTool === TASK_OUTPUT_WRITE_TEXT_TOOL_ID &&
      request.artifact.kind !== "file" &&
      request.artifact.kind !== "document"
    ) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "The task-output text tool can create only file or document artifacts",
      );
    }
    if (
      request.artifact !== undefined &&
      requestedTool === TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID &&
      request.artifact.kind !== "document"
    ) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "The Office-document tool can create only document artifacts",
      );
    }
    const existing = await this.config.persistence.getGeneralWorkCheckpoint(
      request.invocation.sessionId,
    );
    const artifactGrantId =
      request.artifact === undefined
        ? undefined
        : (existing?.artifactIntent?.grantId ??
          (await this.requireActiveWorkspaceGrantId(snapshot.workspaceId)));
    const startedAt = this.now();
    const tool = Object.freeze({
      requestId: request.invocation.requestId,
      toolId: requestedTool,
      inputRef: request.invocation.inputRef,
      startedAt,
      mayHaveExecuted: createsTaskOutputArtifact(requestedTool),
      state: "in-flight",
    }) satisfies GeneralWorkToolCheckpoint;
    const artifactIntent =
      request.artifact === undefined
        ? undefined
        : Object.freeze({
            artifactId: request.artifact.artifactId,
            kind: request.artifact.kind,
            label: request.artifact.label,
            grantId: artifactGrantId!,
          });
    if (existing?.tool === undefined) {
      await this.persistActive(
        snapshot,
        supervisor.coreEvents(request.invocation.sessionId),
        tool,
        artifactIntent,
      );
    } else if (
      existing.phase === "active" &&
      existing.tool.state === "succeeded" &&
      existing.tool.toolId === WORKSPACE_READ_TEXT_TOOL_ID &&
      tool.toolId === TASK_OUTPUT_WRITE_TEXT_TOOL_ID &&
      existing.artifactIntent === undefined &&
      existing.artifactBinding === undefined &&
      artifactIntent !== undefined
    ) {
      const currentEvents = supervisor.coreEvents(request.invocation.sessionId);
      const readCompleted = currentEvents.find(
        (event) =>
          event.type === "tool.completed" && event.payload.requestId === existing.tool?.requestId,
      );
      const writeRequested = currentEvents.find(
        (event) => event.type === "tool.requested" && event.payload.requestId === tool.requestId,
      );
      if (
        readCompleted === undefined ||
        writeRequested === undefined ||
        readCompleted.sequence >= writeRequested.sequence
      ) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "Sequential file output requires a completed workspace read before its write request",
        );
      }
      await this.persistActive(snapshot, currentEvents, tool, artifactIntent);
    } else {
      if (
        existing.phase !== "active" ||
        existing.tool.requestId !== tool.requestId ||
        existing.tool.toolId !== tool.toolId ||
        existing.tool.inputRef !== tool.inputRef ||
        !isDeepStrictEqual(existing.artifactIntent, artifactIntent)
      ) {
        throw new GeneralWorkRecoveryError(
          "invalid-transition",
          "A retried general-work tool must match its durable intent",
        );
      }
      if (!scopedTools.hasRetainedResult(tool.requestId)) {
        throw new GeneralWorkRecoveryError(
          "invalid-transition",
          "A durable in-flight tool cannot execute again without its retained terminal result",
        );
      }
    }

    const result = await scopedTools.invoke(request.invocation);
    const checkpoint = await this.requireCheckpoint(request.invocation.sessionId);
    return Object.freeze({ result, checkpoint });
  }

  cancelTool(request: ToolRequestId, reason?: string): boolean {
    return this.requireScopedTools().cancel(request, reason);
  }

  async finalizeAttempt(session: SessionId): Promise<GeneralWorkFinalization> {
    const supervisor = this.requireSupervisor();
    const snapshot = await supervisor.awaitCleanup(session);
    const existing = await this.requireCheckpoint(session);
    if (existing.phase === "finalized") {
      await supervisor.dispose(session);
      return Object.freeze({
        sessionId: session,
        checkpoint: existing,
        eventStatuses: Object.freeze([]),
        evidenceStatus: "duplicate",
        ...(existing.artifactBinding === undefined
          ? {}
          : { artifactId: existing.artifactBinding.artifact.id }),
      });
    }
    const terminal = this.terminalAttempt(snapshot, existing, supervisor.coreEvents(session));
    const pending = await this.persistTerminal(existing, terminal.attempt, terminal.events);
    return this.settle(pending, supervisor);
  }

  private terminalAttempt(
    snapshot: AgentAttemptSnapshot,
    checkpoint: GeneralWorkCheckpoint,
    events: readonly CoreEvent[],
  ): {
    readonly attempt: GeneralWorkAttemptRecord;
    readonly events: readonly CoreEvent[];
  } {
    const attempt = terminalAttemptWithToolIncident(snapshot, checkpoint, events);
    if (
      this.config.unreplacedCrashDisposition !== "failed" ||
      attempt.state !== "crashed" ||
      attempt.replacementSessionId !== undefined
    ) {
      return Object.freeze({ attempt, events });
    }
    const workerFailure = events
      .filter((event): event is CoreEvent<"worker.failed"> => event.type === "worker.failed")
      .at(-1);
    if (attempt.taskState !== "blocked" || workerFailure === undefined) {
      throw new GeneralWorkRecoveryError(
        "event-mismatch",
        "An unreplaced Worker crash requires blocked Task and worker-failure evidence",
      );
    }
    const taskFailure = this.eventFor(
      { attempt, eventBaseline: checkpoint.eventBaseline, events },
      "task.failed",
      {
        from: "blocked",
        to: "failed",
        errorCode: workerFailure.payload.errorCode,
        message: "The General Worker process exited without a replacement attempt.",
      },
    );
    return Object.freeze({
      attempt: Object.freeze({
        ...attempt,
        taskState: "failed",
        lastCoreEventSequence: taskFailure.sequence,
        ...(attempt.incident === undefined
          ? {
              incident: Object.freeze({
                code: workerFailure.payload.errorCode,
                occurredAt: workerFailure.occurredAt,
              }),
            }
          : {}),
      }),
      events: Object.freeze([...events, taskFailure]),
    });
  }

  async recover(): Promise<readonly GeneralWorkRecoveryResult[]> {
    if (this.config.supervisor !== undefined || this.config.nativeTools !== undefined) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "Startup recovery must run before live supervisors are attached",
      );
    }
    const results: GeneralWorkRecoveryResult[] = [];
    const recoveredSessions = new Set<SessionId>();
    while (true) {
      const checkpoints = await this.config.persistence.listRecoverableGeneralWorkCheckpoints(
        MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS,
      );
      if (checkpoints.length === 0) {
        break;
      }
      for (const checkpoint of checkpoints) {
        if (checkpoint.phase === "finalized") {
          throw new GeneralWorkRecoveryError(
            "invalid-transition",
            "Recoverable checkpoint query returned finalized state",
          );
        }
        if (recoveredSessions.has(checkpoint.attempt.sessionId)) {
          throw new GeneralWorkRecoveryError(
            "invalid-transition",
            "General-work recovery made no durable progress",
          );
        }
        if (recoveredSessions.size >= MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS) {
          throw new GeneralWorkRecoveryError(
            "invalid-transition",
            `General-work startup recovery exceeds ${MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS} checkpoints`,
          );
        }
        recoveredSessions.add(checkpoint.attempt.sessionId);
        const recoveredFrom = checkpoint.phase;
        const pending =
          checkpoint.phase === "active"
            ? await this.interruptActiveCheckpoint(checkpoint)
            : checkpoint;
        const finalization = await this.settle(pending);
        results.push(
          Object.freeze({
            ...finalization,
            recoveredFrom,
          }),
        );
      }
    }
    return Object.freeze(results);
  }

  private async stageToolResolution(context: ScopedNativeToolResolutionContext): Promise<void> {
    assertAgentToolResult(context.result);
    const supervisor = this.requireSupervisor();
    const existing = await this.requireCheckpoint(context.invocation.sessionId);
    if (
      existing.phase !== "active" ||
      existing.tool === undefined ||
      existing.tool.requestId !== context.invocation.requestId ||
      existing.tool.toolId !== context.toolName
    ) {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        "General-work tool result does not match its durable in-flight checkpoint",
      );
    }
    if (existing.tool.state !== "in-flight") {
      await this.resumePersistedToolResolution(existing, context, supervisor);
      return;
    }
    const tool = this.completedTool(existing.tool, context.result);
    let binding: GeneralWorkArtifactBinding | undefined;
    let artifactEvent: CoreEvent<"artifact.created"> | undefined;
    if (existing.artifactIntent !== undefined && context.result.status === "succeeded") {
      if (context.result.outputRef === undefined) {
        throw new GeneralWorkRecoveryError(
          "artifact-mismatch",
          "An authoritative artifact requires one successful output reference",
        );
      }
      const owner = Object.freeze({
        workspaceId: existing.attempt.workspaceId,
        taskId: existing.attempt.taskId,
        sessionId: existing.attempt.sessionId,
        workerId: existing.attempt.workerId,
        requestId: context.invocation.requestId,
        grantId: existing.artifactIntent.grantId,
      });
      const resolved = await this.config.persistence.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: context.result.outputRef,
        kind: "tool-output",
        owner,
        resolvedAt: this.now(),
        consume: false,
      });
      if (resolved.metadata.classification !== "task-content") {
        throw new GeneralWorkRecoveryError(
          "artifact-mismatch",
          "A task artifact must bind task-owned output content",
        );
      }
      const createdAt = this.now();
      const artifact = Object.freeze({
        id: existing.artifactIntent.artifactId,
        workspaceId: existing.attempt.workspaceId,
        taskId: existing.attempt.taskId,
        sessionId: existing.attempt.sessionId,
        kind: existing.artifactIntent.kind,
        label: existing.artifactIntent.label,
        state: "available",
        createdAt,
        updatedAt: createdAt,
      }) satisfies Artifact;
      binding = Object.freeze({
        artifact,
        outputRef: context.result.outputRef,
        owner,
      });
    }

    const currentEvents = supervisor.coreEvents(context.invocation.sessionId);
    if (binding !== undefined) {
      artifactEvent = this.eventFor({ ...existing, events: currentEvents }, "artifact.created", {
        artifactId: binding.artifact.id,
        kind: binding.artifact.kind,
        label: binding.artifact.label,
      });
    }
    const events =
      artifactEvent === undefined
        ? currentEvents
        : Object.freeze([...currentEvents, artifactEvent]);
    const snapshot = supervisor.snapshot(context.invocation.sessionId);
    const state = createCoreEventStreamState(events);
    const attempt = Object.freeze({
      ...immutableAttempt(snapshot),
      taskState: state.taskState,
      lastCoreEventSequence: state.previous?.sequence ?? 0,
    });
    await this.persistActive(attempt, events, tool, existing.artifactIntent, binding);
    if (artifactEvent !== undefined) {
      await supervisor.appendAuthoritativeArtifactEvent(
        context.invocation.sessionId,
        artifactEvent,
      );
    }
  }

  private async resumePersistedToolResolution(
    checkpoint: GeneralWorkCheckpoint,
    context: ScopedNativeToolResolutionContext,
    supervisor: AgentAdapterSupervisor,
  ): Promise<void> {
    const tool = checkpoint.tool;
    if (tool === undefined || tool.state === "in-flight") {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        "A retained tool result requires one durable terminal tool checkpoint",
      );
    }
    const expected = this.completedTool(
      {
        requestId: tool.requestId,
        toolId: tool.toolId,
        inputRef: tool.inputRef,
        startedAt: tool.startedAt,
        mayHaveExecuted: tool.mayHaveExecuted,
        state: "in-flight",
      },
      context.result,
    );
    if (!isDeepStrictEqual(tool, expected)) {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        "Retained tool result conflicts with its durable checkpoint",
      );
    }
    if (checkpoint.artifactBinding === undefined) {
      if (checkpoint.artifactIntent !== undefined && context.result.status === "succeeded") {
        throw new GeneralWorkRecoveryError(
          "artifact-mismatch",
          "A retained successful task output is missing its durable artifact binding",
        );
      }
      return;
    }
    const artifactEvents = checkpoint.events.filter(
      (event): event is CoreEvent<"artifact.created"> =>
        event.type === "artifact.created" &&
        event.payload.artifactId === checkpoint.artifactBinding?.artifact.id,
    );
    if (artifactEvents.length !== 1) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "A retained artifact binding requires one durable artifact event",
      );
    }
    const artifactEvent = artifactEvents[0];
    if (
      artifactEvent !== undefined &&
      !supervisor
        .coreEvents(context.invocation.sessionId)
        .some((event) => event.eventId === artifactEvent.eventId)
    ) {
      await supervisor.appendAuthoritativeArtifactEvent(
        context.invocation.sessionId,
        artifactEvent,
      );
    }
  }

  private completedTool(
    inFlight: Extract<GeneralWorkToolCheckpoint, { state: "in-flight" }>,
    result: AgentToolResult,
  ): GeneralWorkToolCheckpoint {
    if (result.requestId !== inFlight.requestId) {
      throw new GeneralWorkRecoveryError(
        "identity-mismatch",
        "General-work tool result changed request identity",
      );
    }
    if (result.status === "succeeded") {
      if (result.outputRef === undefined) {
        throw new GeneralWorkRecoveryError(
          "invalid-contract",
          "Scoped native tool success requires an output reference",
        );
      }
      return Object.freeze({
        ...inFlight,
        state: "succeeded",
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        outputRef: result.outputRef,
        mayHaveExecuted: true,
        ...(result.summary === undefined ? {} : { summary: result.summary }),
      });
    }
    if (result.status === "failed") {
      return Object.freeze({
        ...inFlight,
        state: "failed",
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        errorCode: result.errorCode,
        message: result.message,
        mayHaveExecuted: result.mayHaveExecuted,
      });
    }
    return Object.freeze({
      ...inFlight,
      state: "cancelled",
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      mayHaveExecuted: false,
      ...(result.reason === undefined ? {} : { reason: result.reason }),
    });
  }

  private async persistActive(
    snapshot: AgentAttemptSnapshot | GeneralWorkAttemptRecord,
    events: readonly CoreEvent[],
    tool?: GeneralWorkToolCheckpoint,
    artifactIntent?: GeneralWorkArtifactIntent,
    artifactBinding?: GeneralWorkArtifactBinding,
  ): Promise<GeneralWorkCheckpoint> {
    if (events.length === 0) {
      throw new GeneralWorkRecoveryError(
        "event-mismatch",
        "General-work recovery begins only after task.started is observable",
      );
    }
    const existing = await this.config.persistence.getGeneralWorkCheckpoint(snapshot.sessionId);
    if (existing?.phase !== undefined && existing.phase !== "active") {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        `Session ${snapshot.sessionId} is already ${existing.phase}`,
      );
    }
    const now = this.now();
    const eventWindow = await this.prepareEventWindow(existing, events);
    const updatedAt =
      existing === null
        ? maximumInstant(now, events.at(-1)?.occurredAt ?? now)
        : maximumInstant(now, existing.updatedAt, events.at(-1)?.occurredAt ?? now);
    const checkpoint = Object.freeze({
      contractVersion: GENERAL_WORK_RECOVERY_CONTRACT_VERSION,
      phase: "active",
      revision: (existing?.revision ?? 0) + 1,
      attempt: Object.freeze({ ...snapshot }),
      ...(eventWindow.eventBaseline === undefined
        ? {}
        : { eventBaseline: eventWindow.eventBaseline }),
      events: eventWindow.events,
      ...((tool ?? existing?.tool) === undefined ? {} : { tool: tool ?? existing?.tool }),
      ...((artifactIntent ?? existing?.artifactIntent) === undefined
        ? {}
        : { artifactIntent: artifactIntent ?? existing?.artifactIntent }),
      ...((artifactBinding ?? existing?.artifactBinding) === undefined
        ? {}
        : { artifactBinding: artifactBinding ?? existing?.artifactBinding }),
      createdAt: existing?.createdAt ?? snapshot.startedAt,
      updatedAt,
    }) as GeneralWorkCheckpoint;
    assertGeneralWorkCheckpoint(checkpoint);
    return (await this.config.persistence.persistGeneralWorkCheckpoint(checkpoint)).checkpoint;
  }

  private async persistTerminal(
    existing: GeneralWorkCheckpoint,
    attempt: GeneralWorkAttemptRecord,
    events: readonly CoreEvent[],
  ): Promise<GeneralWorkCheckpoint> {
    const now = this.now();
    const eventWindow = await this.prepareEventWindow(existing, events);
    const checkpoint = Object.freeze({
      ...existing,
      phase: "terminal-pending",
      revision: existing.revision + 1,
      attempt,
      ...(eventWindow.eventBaseline === undefined
        ? { eventBaseline: undefined }
        : { eventBaseline: eventWindow.eventBaseline }),
      events: eventWindow.events,
      updatedAt: maximumInstant(now, existing.updatedAt, events.at(-1)?.occurredAt ?? now),
    }) satisfies GeneralWorkCheckpoint;
    assertGeneralWorkCheckpoint(checkpoint);
    return (await this.config.persistence.persistGeneralWorkCheckpoint(checkpoint)).checkpoint;
  }

  private async interruptActiveCheckpoint(
    checkpoint: GeneralWorkCheckpoint,
  ): Promise<GeneralWorkCheckpoint> {
    const events = [...checkpoint.events];
    let state = createGeneralWorkEventStreamState(checkpoint.eventBaseline, events);
    const append = <Type extends CoreEventType>(
      type: Type,
      payload: EventPayloadByType[Type],
    ): void => {
      const event = this.eventFor(
        { ...checkpoint, events, attempt: { ...checkpoint.attempt, taskState: state.taskState } },
        type,
        payload,
      );
      state = advanceCoreEventStreamState(state, event);
      events.push(event as CoreEvent);
    };
    const tool = checkpoint.tool;
    if (tool !== undefined) {
      append("tool.started", { requestId: tool.requestId });
      if (tool.state === "succeeded") {
        append("tool.completed", {
          requestId: tool.requestId,
          ...(tool.summary === undefined ? {} : { summary: tool.summary }),
        });
        if (state.taskState === "blocked") {
          append("task.updated", {
            from: "blocked",
            to: "running",
            reason: "Recovered committed tool outcome",
          });
        }
      } else if (tool.state === "failed") {
        append("tool.failed", {
          requestId: tool.requestId,
          errorCode: tool.errorCode,
          message: tool.message,
          mayHaveExecuted: tool.mayHaveExecuted,
        });
      } else if (tool.state === "cancelled") {
        append("tool.failed", {
          requestId: tool.requestId,
          errorCode: "tool-cancelled",
          message: tool.reason ?? "Tool execution cancelled",
          mayHaveExecuted: false,
        });
        append("task.cancelled", {
          from: state.taskState as "running" | "blocked",
          to: "cancelled",
          ...(tool.reason === undefined ? {} : { reason: tool.reason }),
        });
      } else {
        append("tool.failed", {
          requestId: tool.requestId,
          errorCode: "application-restart",
          message: "Tool outcome was interrupted by application restart.",
          mayHaveExecuted: tool.mayHaveExecuted,
        });
      }
    }

    const cancelled = events.at(-1)?.type === "task.cancelled";
    if (!cancelled) {
      append("worker.failed", {
        errorCode: "application-restart",
        message: "The active worker was interrupted by application restart.",
        retryable: true,
      });
      append("task.failed", {
        from: state.taskState as "running" | "blocked",
        to: "failed",
        errorCode: "application-restart",
        message: "The attempt requires a new session after application restart.",
      });
    }
    const occurredAt = this.now();
    const attempt = Object.freeze({
      ...checkpoint.attempt,
      state: cancelled ? "cancelled" : "failed",
      taskState: cancelled ? "cancelled" : "failed",
      lastCoreEventSequence: state.previous?.sequence ?? 0,
      disposed: true,
      incident: Object.freeze({
        code: "application-restart",
        occurredAt,
      }),
    }) satisfies GeneralWorkAttemptRecord;
    return this.persistTerminal(checkpoint, attempt, events);
  }

  private async settle(
    checkpoint: GeneralWorkCheckpoint,
    supervisor?: AgentAdapterSupervisor,
  ): Promise<GeneralWorkFinalization> {
    if (checkpoint.phase !== "terminal-pending") {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        "Only terminal-pending checkpoints can cross the release barrier",
      );
    }
    return withPersistenceMutationBarrier(this.config.persistence, async () => {
      const durable = await this.requireCheckpoint(checkpoint.attempt.sessionId);
      if (durable.phase === "finalized") {
        await supervisor?.dispose(durable.attempt.sessionId);
        if (durable.tool !== undefined) {
          this.scopedTools?.releaseRetainedResult(durable.tool.requestId);
        }
        return Object.freeze({
          sessionId: durable.attempt.sessionId,
          checkpoint: durable,
          eventStatuses: Object.freeze([]),
          evidenceStatus: "duplicate",
          ...(durable.artifactBinding === undefined
            ? {}
            : { artifactId: durable.artifactBinding.artifact.id }),
        });
      }
      if (durable.phase !== "terminal-pending") {
        throw new GeneralWorkRecoveryError(
          "invalid-transition",
          "The durable general-work checkpoint is not ready for terminal release",
        );
      }
      return this.settleUnderBarrier(durable, supervisor);
    });
  }

  private async settleUnderBarrier(
    checkpoint: GeneralWorkCheckpoint,
    supervisor?: AgentAdapterSupervisor,
  ): Promise<GeneralWorkFinalization> {
    await this.verifyCheckpointHistory(checkpoint);
    if (checkpoint.artifactBinding !== undefined) {
      const resolved = await this.config.persistence.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: checkpoint.artifactBinding.outputRef,
        kind: "tool-output",
        owner: checkpoint.artifactBinding.owner,
        resolvedAt: this.now(),
        consume: false,
      });
      if (resolved.metadata.classification !== "task-content") {
        throw new GeneralWorkRecoveryError(
          "artifact-mismatch",
          "Recovered artifact content is not task-owned",
        );
      }
    }
    await this.reconcileDomainGraph(checkpoint);
    const eventStatuses: ("appended" | "duplicate")[] = [];
    for (const event of checkpoint.events) {
      eventStatuses.push((await this.config.persistence.appendEvent(event)).status);
    }
    const evidence = createAgentAttemptEvidence(checkpoint.attempt);
    if (evidence.contractVersion !== PLATFORM_EVIDENCE_CONTRACT_VERSION) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "Terminal evidence contract changed during recovery",
      );
    }
    const evidenceStatus = (await this.config.persistence.appendAgentAttemptEvidence(evidence))
      .status;
    const now = this.now();
    const finalized = Object.freeze({
      ...checkpoint,
      phase: "finalized",
      revision: checkpoint.revision + 1,
      updatedAt: maximumInstant(now, checkpoint.updatedAt),
    }) satisfies GeneralWorkCheckpoint;
    const durable = (await this.config.persistence.persistGeneralWorkCheckpoint(finalized))
      .checkpoint;
    await supervisor?.dispose(checkpoint.attempt.sessionId);
    if (checkpoint.tool !== undefined) {
      this.scopedTools?.releaseRetainedResult(checkpoint.tool.requestId);
    }
    return Object.freeze({
      sessionId: checkpoint.attempt.sessionId,
      checkpoint: durable,
      eventStatuses: Object.freeze(eventStatuses),
      evidenceStatus,
      ...(checkpoint.artifactBinding === undefined
        ? {}
        : { artifactId: checkpoint.artifactBinding.artifact.id }),
    });
  }

  private async reconcileDomainGraph(checkpoint: GeneralWorkCheckpoint): Promise<void> {
    const graph = await this.config.persistence.loadDomainGraph();
    const task = graph.tasks.find((candidate) => candidate.id === checkpoint.attempt.taskId);
    const session = graph.sessions.find(
      (candidate) => candidate.id === checkpoint.attempt.sessionId,
    );
    const worker = graph.workers.find((candidate) => candidate.id === checkpoint.attempt.workerId);
    if (
      task === undefined ||
      session === undefined ||
      worker === undefined ||
      task.workspaceId !== checkpoint.attempt.workspaceId ||
      session.workspaceId !== checkpoint.attempt.workspaceId ||
      session.taskId !== checkpoint.attempt.taskId ||
      session.workerId !== checkpoint.attempt.workerId ||
      worker.workspaceId !== checkpoint.attempt.workspaceId
    ) {
      throw new GeneralWorkRecoveryError(
        "identity-mismatch",
        "General-work checkpoint does not match the authoritative domain graph",
      );
    }
    const artifact = checkpoint.artifactBinding?.artifact;
    const conflictingArtifact =
      artifact === undefined
        ? undefined
        : graph.artifacts.find(
            (candidate) => candidate.id === artifact.id && !isDeepStrictEqual(candidate, artifact),
          );
    if (conflictingArtifact !== undefined) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        `Artifact ${artifact?.id} conflicts with authoritative metadata`,
      );
    }
    const updatedAt = checkpoint.updatedAt;
    const next: DomainGraph = {
      ...graph,
      tasks: graph.tasks.map((candidate) =>
        candidate.id === task.id ? updateTask(candidate, checkpoint.attempt, updatedAt) : candidate,
      ),
      sessions: graph.sessions.map((candidate) =>
        candidate.id === session.id
          ? updateSession(candidate, checkpoint.attempt, updatedAt)
          : candidate,
      ),
      workers: graph.workers.map((candidate) =>
        candidate.id === worker.id
          ? updateWorker(candidate, checkpoint.attempt, updatedAt)
          : candidate,
      ),
      artifacts:
        artifact === undefined || graph.artifacts.some((candidate) => candidate.id === artifact.id)
          ? graph.artifacts
          : [...graph.artifacts, artifact],
    };
    await this.config.persistence.replaceDomainGraph(next);
  }

  private async verifyCheckpointHistory(checkpoint: GeneralWorkCheckpoint): Promise<void> {
    const committed = await this.config.persistence.replayEvents(checkpoint.attempt.streamId);
    const lastCheckpointSequence = checkpoint.attempt.lastCoreEventSequence;
    const retainedBySequence = new Map(checkpoint.events.map((event) => [event.sequence, event]));
    for (const event of committed) {
      if (event.sequence > lastCheckpointSequence) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "Authoritative event persistence is ahead of the terminal checkpoint",
        );
      }
      const retained = retainedBySequence.get(event.sequence);
      if (
        event.sequence > (checkpoint.eventBaseline?.sequence ?? 0) &&
        (retained === undefined || !isDeepStrictEqual(retained, event))
      ) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The terminal checkpoint conflicts with authoritative event persistence",
        );
      }
    }

    const baseline = checkpoint.eventBaseline;
    if (baseline !== undefined) {
      const prefix = committed.filter((event) => event.sequence <= baseline.sequence);
      const event = prefix.at(-1);
      if (event === undefined || !isDeepStrictEqual(event, baseline.event)) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The general-work event baseline is absent from authoritative event persistence",
        );
      }
      const state = createCoreEventStreamState(prefix);
      if (
        state.previous?.sequence !== baseline.sequence ||
        state.taskState !== baseline.taskState
      ) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The general-work event baseline conflicts with authoritative event projection",
        );
      }
    } else {
      for (const event of committed) {
        const retained = retainedBySequence.get(event.sequence);
        if (retained === undefined || !isDeepStrictEqual(retained, event)) {
          throw new GeneralWorkRecoveryError(
            "event-mismatch",
            "The terminal checkpoint does not own its committed event prefix",
          );
        }
      }
    }

    const combinedByEventId = new Map<string, CoreEvent>();
    const combinedBySequence = new Map<number, CoreEvent>();
    for (const event of [...committed, ...checkpoint.events]) {
      const sameId = combinedByEventId.get(event.eventId);
      const sameSequence = combinedBySequence.get(event.sequence);
      if (
        (sameId !== undefined && !isDeepStrictEqual(sameId, event)) ||
        (sameSequence !== undefined && !isDeepStrictEqual(sameSequence, event))
      ) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The terminal checkpoint reuses an authoritative event identity",
        );
      }
      combinedByEventId.set(event.eventId, event);
      combinedBySequence.set(event.sequence, event);
    }
    const artifactEvents = [...combinedByEventId.values()].filter(
      (event): event is CoreEvent<"artifact.created"> | CoreEvent<"artifact.updated"> =>
        event.type === "artifact.created" || event.type === "artifact.updated",
    );
    const binding = checkpoint.artifactBinding;
    if (binding === undefined) {
      if (artifactEvents.length > 0) {
        throw new GeneralWorkRecoveryError(
          "artifact-mismatch",
          "An authoritative artifact event requires a durable artifact binding",
        );
      }
      return;
    }
    if (
      artifactEvents.length !== 1 ||
      artifactEvents[0]?.type !== "artifact.created" ||
      artifactEvents[0]?.payload.artifactId !== binding.artifact.id ||
      artifactEvents[0]?.payload.kind !== binding.artifact.kind ||
      artifactEvents[0]?.payload.label !== binding.artifact.label
    ) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "The durable artifact binding has no exact authoritative event",
      );
    }
  }

  private eventFor<Type extends CoreEventType>(
    checkpoint: Pick<GeneralWorkCheckpoint, "attempt" | "eventBaseline" | "events">,
    type: Type,
    payload: EventPayloadByType[Type],
  ): CoreEvent<Type> {
    const previous = checkpoint.events.at(-1) ?? checkpoint.eventBaseline?.event;
    const occurredAt =
      previous === undefined ? this.now() : maximumInstant(this.now(), previous.occurredAt);
    return Object.freeze({
      schemaVersion: 1,
      eventId: this.newEventId(),
      streamId: checkpoint.attempt.streamId,
      sequence: (previous?.sequence ?? 0) + 1,
      occurredAt,
      workspaceId: checkpoint.attempt.workspaceId,
      taskId: checkpoint.attempt.taskId,
      sessionId: checkpoint.attempt.sessionId,
      workerId: checkpoint.attempt.workerId,
      correlationId: checkpoint.attempt.correlationId,
      type,
      redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
      payload,
    }) as CoreEvent<Type>;
  }

  private async requireCheckpoint(session: SessionId): Promise<GeneralWorkCheckpoint> {
    const checkpoint = await this.config.persistence.getGeneralWorkCheckpoint(session);
    if (checkpoint === null) {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        `Session ${session} has no durable general-work checkpoint`,
      );
    }
    return checkpoint;
  }

  private async prepareEventWindow(
    existing: GeneralWorkCheckpoint | null,
    events: readonly CoreEvent[],
  ): Promise<{
    readonly eventBaseline?: GeneralWorkEventBaseline;
    readonly events: readonly CoreEvent[];
  }> {
    const existingBaselineSequence = existing?.eventBaseline?.sequence ?? 0;
    const startsAtSequenceOne = events[0]?.sequence === 1;
    const sourceBaseline = startsAtSequenceOne ? undefined : existing?.eventBaseline;
    if (!startsAtSequenceOne && sourceBaseline === undefined) {
      throw new GeneralWorkRecoveryError(
        "event-mismatch",
        "A retained general-work event window requires its durable baseline",
      );
    }
    const completeState = createGeneralWorkEventStreamState(sourceBaseline, events);
    const lastSequence = completeState.previous?.sequence ?? sourceBaseline?.sequence ?? 0;

    if (startsAtSequenceOne && existing?.eventBaseline !== undefined) {
      const priorBaselineEvents = events.filter(
        (event) => event.sequence <= existing.eventBaseline!.sequence,
      );
      const priorBaselineState = createGeneralWorkEventStreamState(undefined, priorBaselineEvents);
      const matchingEvent = priorBaselineEvents.at(-1);
      if (
        matchingEvent === undefined ||
        !isDeepStrictEqual(matchingEvent, existing.eventBaseline.event) ||
        priorBaselineState.taskState !== existing.eventBaseline.taskState
      ) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The live event stream conflicts with its durable general-work baseline",
        );
      }
    }

    const targetBaselineSequence = Math.max(
      existingBaselineSequence,
      lastSequence - MAX_GENERAL_WORK_CHECKPOINT_EVENTS,
    );
    let eventBaseline = existing?.eventBaseline;
    if (targetBaselineSequence > existingBaselineSequence) {
      const newlyDurablePrefix = events.filter(
        (event) =>
          event.sequence > existingBaselineSequence && event.sequence <= targetBaselineSequence,
      );
      const baselineEvent = newlyDurablePrefix.at(-1);
      if (baselineEvent?.sequence !== targetBaselineSequence) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The general-work event window cannot establish a contiguous baseline",
        );
      }
      const baselineState = createGeneralWorkEventStreamState(
        sourceBaseline,
        events.filter((event) => event.sequence <= targetBaselineSequence),
      );
      if (baselineState.taskState === undefined) {
        throw new GeneralWorkRecoveryError(
          "event-mismatch",
          "The general-work event baseline has no projected task state",
        );
      }
      for (const event of newlyDurablePrefix) {
        await this.config.persistence.appendEvent(event);
      }
      eventBaseline = Object.freeze({
        sequence: targetBaselineSequence,
        event: Object.freeze({ ...baselineEvent }),
        taskState: baselineState.taskState,
      });
    }

    const retained = events
      .filter((event) => event.sequence > targetBaselineSequence)
      .map((event) => Object.freeze({ ...event }));
    return Object.freeze({
      ...(eventBaseline === undefined ? {} : { eventBaseline }),
      events: Object.freeze(retained),
    });
  }

  private requireSupervisor(): AgentAdapterSupervisor {
    if (this.config.supervisor === undefined) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "General-work live coordination has no supervisor",
      );
    }
    return this.config.supervisor;
  }

  private requireScopedTools(): ScopedNativeToolCoordinator {
    if (this.scopedTools === undefined) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "General-work live coordination has no scoped tool gateway",
      );
    }
    return this.scopedTools;
  }

  private async requireActiveWorkspaceGrantId(
    workspace: GeneralWorkAttemptRecord["workspaceId"],
  ): Promise<GeneralWorkArtifactIntent["grantId"]> {
    const grant = await this.config.persistence.getActiveWorkspaceGrant(workspace);
    if (grant === null) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "The artifact workspace grant is unavailable before tool execution",
      );
    }
    return grant.grantId;
  }

  private now(): Instant {
    const value = this.config.clock.now();
    instant(value);
    return value;
  }
}
