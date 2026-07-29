import {
  AGENT_CAPABILITIES,
  AgentAdapterError,
  advanceCoreEventStreamState,
  assertAgentApprovalDecision,
  assertAgentCapabilities,
  assertAgentInput,
  assertAgentSignal,
  assertAgentStartRequest,
  assertAgentToolResult,
  createCoreEventStreamState,
  instant,
  toolRequestId,
  type AgentAdapter,
  type AgentAdapterErrorCode,
  type AgentApprovalDecision,
  type AgentCapabilities,
  type AgentCapability,
  type AgentClock,
  type AgentInput,
  type AgentSignal,
  type AgentStartRequest,
  type AgentToolResult,
  type ApprovalId,
  type CorrelationId,
  type CoreEvent,
  type CoreEventStreamState,
  type EventStreamId,
  type Instant,
  type SessionId,
  type TaskState,
  type TaskId,
  type ToolRequestId,
  type UnsubscribeAgentSignals,
  type WorkerId,
  type WorkspaceId,
} from "../../core";

export interface AgentAdapterSupervisorConfig {
  readonly expectedAdapterKind: string;
  readonly requiredCapabilities: readonly AgentCapability[];
  readonly startupTimeoutMs: number;
  readonly heartbeatTimeoutMs: number;
  readonly cancellationTimeoutMs: number;
  readonly maxRestarts: number;
}

export type AgentAttemptState =
  | "starting"
  | "running"
  | "blocked"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "crashed"
  | "timed-out"
  | "protocol-failed"
  | "disposed";

export type AgentSupervisorIncidentCode =
  | AgentAdapterErrorCode
  | "startup-timeout"
  | "heartbeat-timeout"
  | "cancellation-ack-timeout";

export interface AgentSupervisorIncident {
  readonly code: AgentSupervisorIncidentCode;
  readonly message: string;
  readonly occurredAt: Instant;
}

export interface AgentAttemptSnapshot {
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly correlationId: CorrelationId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly streamId: EventStreamId;
  readonly state: AgentAttemptState;
  readonly taskState?: TaskState;
  readonly startedAt: Instant;
  readonly lastSignalAt: Instant;
  readonly lastControlSequence: number;
  readonly lastCoreEventSequence: number;
  readonly restartCount: number;
  readonly restartedFromSessionId?: SessionId;
  readonly replacementSessionId?: SessionId;
  readonly disposed: boolean;
  readonly forcedCancellation: boolean;
  readonly incident?: AgentSupervisorIncident;
}

interface PendingApprovalReference {
  readonly requestId: ToolRequestId;
  readonly approvalId: ApprovalId;
}

interface PendingToolReference {
  readonly requestId: ToolRequestId;
}

interface PendingBlockReferences {
  readonly approval?: PendingApprovalReference;
  readonly tool?: PendingToolReference;
}

interface SupervisedAttempt {
  readonly request: AgentStartRequest;
  state: AgentAttemptState;
  coreState: CoreEventStreamState;
  readonly events: CoreEvent[];
  readonly supervisionStartedAt: Instant;
  lastSignalAt: Instant;
  lastObservedAt: Instant;
  nextControlSequence: number;
  readonly restartCount: number;
  readonly restartedFromSessionId?: SessionId;
  replacementSessionId?: SessionId;
  pendingApproval?: PendingApprovalReference;
  pendingTool?: PendingToolReference;
  cancelRequestedAt?: Instant;
  forcedCancellation: boolean;
  disposed: boolean;
  incident?: AgentSupervisorIncident;
  crashRetryable?: boolean;
  unsubscribe?: UnsubscribeAgentSignals;
}

const ACTIVE_ATTEMPT_STATES: readonly AgentAttemptState[] = [
  "starting",
  "running",
  "blocked",
  "cancelling",
];
const TERMINAL_ATTEMPT_STATES: readonly AgentAttemptState[] = [
  "completed",
  "failed",
  "cancelled",
  "crashed",
  "timed-out",
  "protocol-failed",
  "disposed",
];

function positiveSafeDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AgentAdapterError("invalid-request", `${label} must be a positive safe integer`);
  }
}

function immutableEvent(event: CoreEvent): CoreEvent {
  return Object.freeze({
    ...event,
    payload: Object.freeze({ ...event.payload }),
  }) as CoreEvent;
}

export class AgentAdapterSupervisor {
  private readonly attempts = new Map<SessionId, SupervisedAttempt>();
  private declaration?: AgentCapabilities;

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly clock: AgentClock,
    private readonly config: AgentAdapterSupervisorConfig,
  ) {
    if (
      typeof config.expectedAdapterKind !== "string" ||
      config.expectedAdapterKind.trim().length === 0
    ) {
      throw new AgentAdapterError(
        "invalid-request",
        "Supervisor expectedAdapterKind must be a non-empty string",
      );
    }

    if (
      !Array.isArray(config.requiredCapabilities) ||
      new Set(config.requiredCapabilities).size !== config.requiredCapabilities.length ||
      config.requiredCapabilities.some((capability) => !AGENT_CAPABILITIES.includes(capability))
    ) {
      throw new AgentAdapterError(
        "invalid-request",
        "Supervisor requiredCapabilities must be unique protocol capabilities",
      );
    }

    positiveSafeDuration(config.startupTimeoutMs, "Supervisor startupTimeoutMs");
    positiveSafeDuration(config.heartbeatTimeoutMs, "Supervisor heartbeatTimeoutMs");
    positiveSafeDuration(config.cancellationTimeoutMs, "Supervisor cancellationTimeoutMs");

    if (!Number.isSafeInteger(config.maxRestarts) || config.maxRestarts < 0) {
      throw new AgentAdapterError(
        "invalid-request",
        "Supervisor maxRestarts must be a non-negative safe integer",
      );
    }

    instant(clock.now());
  }

  async start(request: AgentStartRequest): Promise<AgentAttemptSnapshot> {
    assertAgentStartRequest(request);

    if (request.taskState !== "ready") {
      throw new AgentAdapterError(
        "invalid-request",
        "A first supervised attempt must enter from ready",
      );
    }

    return this.startAttempt(request, 0);
  }

  async restart(
    previousSessionId: SessionId,
    request: AgentStartRequest,
  ): Promise<AgentAttemptSnapshot> {
    const previous = this.requireAttempt(previousSessionId);
    assertAgentStartRequest(request);

    if (previous.state !== "crashed" && previous.state !== "timed-out") {
      throw new AgentAdapterError(
        "invalid-restart",
        `Session ${previousSessionId} cannot restart from ${previous.state}`,
      );
    }

    if (previous.replacementSessionId !== undefined) {
      throw new AgentAdapterError(
        "invalid-restart",
        `Session ${previousSessionId} already has replacement ${previous.replacementSessionId}`,
      );
    }

    if (previous.crashRetryable === false) {
      throw new AgentAdapterError(
        "invalid-restart",
        `Session ${previousSessionId} reported a non-retryable crash`,
      );
    }

    if (previous.restartCount >= this.config.maxRestarts) {
      throw new AgentAdapterError(
        "restart-limit",
        `Session ${previousSessionId} reached restart limit ${this.config.maxRestarts}`,
      );
    }

    if (
      request.workspaceId !== previous.request.workspaceId ||
      request.taskId !== previous.request.taskId ||
      request.correlationId !== previous.request.correlationId ||
      request.taskState !== "blocked" ||
      request.sessionId === previous.request.sessionId ||
      request.workerId === previous.request.workerId ||
      request.streamId === previous.request.streamId ||
      request.startedAt < previous.lastSignalAt
    ) {
      throw new AgentAdapterError(
        "invalid-restart",
        "A replacement must preserve workspace, task, and correlation identity, enter from blocked, use fresh attempt identities, and not move time backwards",
      );
    }

    previous.replacementSessionId = request.sessionId;
    try {
      return await this.startAttempt(request, previous.restartCount + 1, previousSessionId);
    } catch (error) {
      if (previous.replacementSessionId === request.sessionId) {
        previous.replacementSessionId = undefined;
      }
      throw error;
    }
  }

  async send(session: SessionId, input: AgentInput): Promise<void> {
    const attempt = this.requireAttempt(session);
    assertAgentInput(input);

    if (attempt.state !== "running" || attempt.disposed) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${session} cannot receive input while ${attempt.state}`,
      );
    }

    await this.runAdapterOperation(attempt, "send", this.adapter.send(session, input));
  }

  async approve(requestIdValue: ToolRequestId, decision: AgentApprovalDecision): Promise<void> {
    toolRequestId(requestIdValue);
    assertAgentApprovalDecision(decision);
    const attempt = [...this.attempts.values()].find(
      (candidate) => candidate.pendingApproval?.requestId === requestIdValue,
    );

    if (
      attempt === undefined ||
      attempt.pendingApproval === undefined ||
      attempt.state !== "blocked" ||
      attempt.pendingApproval.approvalId !== decision.approvalId
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `No blocked attempt owns approval request ${requestIdValue}`,
      );
    }

    await this.runAdapterOperation(
      attempt,
      "approve",
      this.adapter.approve(requestIdValue, decision),
    );
  }

  async resolveTool(requestIdValue: ToolRequestId, result: AgentToolResult): Promise<void> {
    toolRequestId(requestIdValue);
    assertAgentToolResult(result);
    const attempt = [...this.attempts.values()].find(
      (candidate) => candidate.pendingTool?.requestId === requestIdValue,
    );

    if (
      attempt === undefined ||
      attempt.pendingTool === undefined ||
      attempt.state !== "blocked" ||
      result.requestId !== requestIdValue
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `No tool-blocked attempt owns request ${requestIdValue}`,
      );
    }

    await this.runAdapterOperation(
      attempt,
      "resolveTool",
      this.adapter.resolveTool(requestIdValue, result),
    );
  }

  async cancel(session: SessionId, reason?: string): Promise<void> {
    const attempt = this.requireAttempt(session);

    if (reason !== undefined && typeof reason !== "string") {
      throw new AgentAdapterError("invalid-request", "Cancellation reason must be a string");
    }

    if (attempt.state === "cancelling" || TERMINAL_ATTEMPT_STATES.includes(attempt.state)) {
      return;
    }

    if (
      attempt.state !== "starting" &&
      attempt.state !== "running" &&
      attempt.state !== "blocked"
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${session} cannot cancel while ${attempt.state}`,
      );
    }

    attempt.state = "cancelling";
    attempt.cancelRequestedAt = this.now();

    try {
      await this.adapter.cancel(session, reason);
    } catch (error) {
      const wrapped = new AgentAdapterError(
        "adapter-operation-failed",
        `AgentAdapter cancel failed for session ${session}`,
        { cause: error },
      );
      this.failProtocol(attempt, wrapped);
      throw wrapped;
    }
  }

  async dispose(session: SessionId): Promise<void> {
    const attempt = this.requireAttempt(session);

    if (!TERMINAL_ATTEMPT_STATES.includes(attempt.state)) {
      attempt.state = "disposed";
    }

    await this.cleanup(attempt);
    attempt.events.splice(0);
    attempt.pendingApproval = undefined;
    attempt.pendingTool = undefined;
    this.attempts.delete(session);
  }

  async checkHealth(): Promise<void> {
    const now = this.now();
    const cleanup: Promise<void>[] = [];

    for (const attempt of this.attempts.values()) {
      if (attempt.disposed) {
        continue;
      }

      if (
        attempt.state === "starting" &&
        this.elapsed(attempt.supervisionStartedAt, now) > this.config.startupTimeoutMs
      ) {
        attempt.state = "timed-out";
        attempt.incident = this.incident(
          "startup-timeout",
          `Session ${attempt.request.sessionId} did not become ready within ${this.config.startupTimeoutMs}ms`,
          now,
        );
        cleanup.push(this.cleanup(attempt));
        continue;
      }

      if (
        (attempt.state === "running" || attempt.state === "blocked") &&
        this.elapsed(attempt.lastObservedAt, now) > this.config.heartbeatTimeoutMs
      ) {
        attempt.state = "timed-out";
        attempt.incident = this.incident(
          "heartbeat-timeout",
          `Session ${attempt.request.sessionId} was silent for more than ${this.config.heartbeatTimeoutMs}ms`,
          now,
        );
        cleanup.push(this.cleanup(attempt));
        continue;
      }

      if (
        attempt.state === "cancelling" &&
        attempt.cancelRequestedAt !== undefined &&
        this.elapsed(attempt.cancelRequestedAt, now) > this.config.cancellationTimeoutMs
      ) {
        attempt.state = "cancelled";
        attempt.forcedCancellation = true;
        attempt.incident = this.incident(
          "cancellation-ack-timeout",
          `Session ${attempt.request.sessionId} did not acknowledge cancellation within ${this.config.cancellationTimeoutMs}ms`,
          now,
        );
        cleanup.push(this.cleanup(attempt));
      }
    }

    await Promise.all(cleanup);
  }

  snapshot(session: SessionId): AgentAttemptSnapshot {
    const attempt = this.requireAttempt(session);
    return Object.freeze({
      workspaceId: attempt.request.workspaceId,
      taskId: attempt.request.taskId,
      correlationId: attempt.request.correlationId,
      sessionId: attempt.request.sessionId,
      workerId: attempt.request.workerId,
      streamId: attempt.request.streamId,
      state: attempt.state,
      taskState: attempt.coreState.taskState,
      startedAt: attempt.request.startedAt,
      lastSignalAt: attempt.lastSignalAt,
      lastControlSequence: attempt.nextControlSequence - 1,
      lastCoreEventSequence: attempt.coreState.previous?.sequence ?? 0,
      restartCount: attempt.restartCount,
      restartedFromSessionId: attempt.restartedFromSessionId,
      replacementSessionId: attempt.replacementSessionId,
      disposed: attempt.disposed,
      forcedCancellation: attempt.forcedCancellation,
      incident: attempt.incident === undefined ? undefined : Object.freeze({ ...attempt.incident }),
    });
  }

  listAttempts(): readonly AgentAttemptSnapshot[] {
    return [...this.attempts.keys()].map((session) => this.snapshot(session));
  }

  coreEvents(session: SessionId): readonly CoreEvent[] {
    return Object.freeze([...this.requireAttempt(session).events]);
  }

  activeToolRequest(session: SessionId): ToolRequestId | undefined {
    const attempt = this.requireAttempt(session);
    if (attempt.disposed || attempt.state !== "blocked" || attempt.pendingTool === undefined) {
      return undefined;
    }
    return attempt.pendingTool.requestId;
  }

  private async startAttempt(
    request: AgentStartRequest,
    restartCount: number,
    restartedFromSessionId?: SessionId,
  ): Promise<AgentAttemptSnapshot> {
    const declaration = await this.adapterDeclaration();
    this.assertFreshAttemptIdentity(request);

    const activeCount = [...this.attempts.values()].filter(
      (attempt) => ACTIVE_ATTEMPT_STATES.includes(attempt.state) && !attempt.disposed,
    ).length;
    if (activeCount >= declaration.maxConcurrentSessions) {
      throw new AgentAdapterError(
        "concurrency-limit",
        `AgentAdapter permits ${declaration.maxConcurrentSessions} concurrent sessions`,
      );
    }

    const observedAt = this.now();
    const attempt: SupervisedAttempt = {
      request: Object.freeze({ ...request }),
      state: "starting",
      coreState: createCoreEventStreamState([]),
      events: [],
      supervisionStartedAt: observedAt,
      lastSignalAt: request.startedAt,
      lastObservedAt: observedAt,
      nextControlSequence: 1,
      restartCount,
      ...(restartedFromSessionId === undefined ? {} : { restartedFromSessionId }),
      forcedCancellation: false,
      disposed: false,
    };
    this.attempts.set(request.sessionId, attempt);

    try {
      attempt.unsubscribe = this.adapter.subscribe(request.sessionId, (signal) => {
        this.receiveSignal(attempt, signal);
      });
    } catch (error) {
      this.attempts.delete(request.sessionId);
      throw new AgentAdapterError(
        "adapter-operation-failed",
        `AgentAdapter subscribe failed for session ${request.sessionId}`,
        { cause: error },
      );
    }

    try {
      await this.adapter.start(request);
    } catch (error) {
      const wrapped = new AgentAdapterError(
        "adapter-operation-failed",
        `AgentAdapter start failed for session ${request.sessionId}`,
        { cause: error },
      );
      this.failProtocol(attempt, wrapped);
      throw wrapped;
    }

    return this.snapshot(request.sessionId);
  }

  private async adapterDeclaration(): Promise<AgentCapabilities> {
    if (this.declaration !== undefined) {
      return this.declaration;
    }

    let declaration: AgentCapabilities;
    try {
      declaration = await this.adapter.capabilities();
      assertAgentCapabilities(declaration);
    } catch (error) {
      if (error instanceof AgentAdapterError) {
        throw error;
      }

      throw new AgentAdapterError(
        "adapter-operation-failed",
        "AgentAdapter capability negotiation failed",
        { cause: error },
      );
    }

    if (declaration.adapterKind !== this.config.expectedAdapterKind) {
      throw new AgentAdapterError(
        "incompatible-protocol",
        `Expected adapter kind ${this.config.expectedAdapterKind}, received ${declaration.adapterKind}`,
      );
    }

    const missing = this.config.requiredCapabilities.find(
      (capability) => !declaration.capabilities.includes(capability),
    );
    if (missing !== undefined) {
      throw new AgentAdapterError(
        "unsupported-capability",
        `AgentAdapter ${declaration.adapterKind} does not support required capability ${missing}`,
      );
    }

    if (this.config.heartbeatTimeoutMs <= declaration.heartbeatIntervalMs) {
      throw new AgentAdapterError(
        "invalid-capabilities",
        "Supervisor heartbeat timeout must exceed the declared heartbeat interval",
      );
    }

    this.declaration = Object.freeze({
      ...declaration,
      capabilities: Object.freeze([...declaration.capabilities]),
    });
    return this.declaration;
  }

  private assertFreshAttemptIdentity(request: AgentStartRequest): void {
    for (const attempt of this.attempts.values()) {
      if (
        request.sessionId === attempt.request.sessionId ||
        request.workerId === attempt.request.workerId ||
        request.streamId === attempt.request.streamId
      ) {
        throw new AgentAdapterError(
          "duplicate-session",
          "A supervised attempt cannot reuse a session, worker, or event-stream identity",
        );
      }
    }
  }

  private receiveSignal(attempt: SupervisedAttempt, value: unknown): void {
    if (attempt.disposed) {
      return;
    }

    try {
      assertAgentSignal(value);
      const signal = value;

      if (
        signal.sessionId !== attempt.request.sessionId ||
        signal.workerId !== attempt.request.workerId
      ) {
        throw new AgentAdapterError(
          "signal-identity-mismatch",
          `Signal identity does not match session ${attempt.request.sessionId}`,
        );
      }

      if (signal.sequence !== attempt.nextControlSequence) {
        throw new AgentAdapterError(
          "signal-sequence-gap",
          `Session ${attempt.request.sessionId} expected control sequence ${attempt.nextControlSequence}, received ${signal.sequence}`,
        );
      }

      if (signal.occurredAt < attempt.lastSignalAt) {
        throw new AgentAdapterError(
          "signal-time-regression",
          `Session ${attempt.request.sessionId} control time moved backwards`,
        );
      }

      attempt.nextControlSequence += 1;
      attempt.lastSignalAt = signal.occurredAt;
      attempt.lastObservedAt = this.now();
      this.applySignal(attempt, signal);
    } catch (error) {
      const wrapped =
        error instanceof AgentAdapterError
          ? error
          : new AgentAdapterError(
              "invalid-signal",
              `Session ${attempt.request.sessionId} published an invalid signal`,
              { cause: error },
            );
      this.failProtocol(attempt, wrapped);
    }
  }

  private applySignal(attempt: SupervisedAttempt, signal: AgentSignal): void {
    switch (signal.type) {
      case "ready":
        this.requireState(attempt, ["starting"], "become ready");
        attempt.state = "running";
        return;
      case "heartbeat":
        this.requireState(attempt, ["running", "blocked", "cancelling"], "publish a heartbeat");
        return;
      case "core-event":
        this.acceptCoreEvent(attempt, signal.event, signal.occurredAt);
        return;
      case "blocked":
        this.requireState(attempt, ["running"], "become blocked");
        {
          const references = this.reconcileBlockedSignal(attempt, signal);
          attempt.pendingApproval = references.approval;
          attempt.pendingTool = references.tool;
        }
        attempt.state = "blocked";
        return;
      case "resumed":
        this.requireState(attempt, ["blocked"], "resume");
        if (
          attempt.coreState.taskState !== "running" ||
          attempt.coreState.previous?.type !== "task.updated"
        ) {
          throw new AgentAdapterError(
            "invalid-signal",
            "A resumed signal requires a running task transition",
          );
        }
        attempt.pendingApproval = undefined;
        attempt.pendingTool = undefined;
        attempt.state = "running";
        return;
      case "completed":
        this.reconcileTerminal(attempt, "task.completed");
        attempt.state = "completed";
        void this.cleanup(attempt);
        return;
      case "failed": {
        const event = this.reconcileTerminal(attempt, "task.failed");
        if (
          event.payload.errorCode !== signal.errorCode ||
          event.payload.message !== signal.message
        ) {
          throw new AgentAdapterError(
            "terminal-reconciliation-failed",
            "Failed control signal does not match task.failed",
          );
        }
        attempt.state = "failed";
        void this.cleanup(attempt);
        return;
      }
      case "cancelled":
        if (this.reconcileTerminal(attempt, "task.cancelled").payload.reason !== signal.reason) {
          throw new AgentAdapterError(
            "terminal-reconciliation-failed",
            "Cancelled control signal does not match task.cancelled",
          );
        }
        attempt.state = "cancelled";
        void this.cleanup(attempt);
        return;
      case "crashed": {
        this.requireState(attempt, ["running", "blocked", "cancelling"], "report a crash");
        const event = attempt.coreState.previous;
        if (
          attempt.coreState.taskState !== "blocked" ||
          event?.type !== "worker.failed" ||
          event.payload.errorCode !== signal.errorCode ||
          event.payload.message !== signal.message ||
          event.payload.retryable !== signal.retryable
        ) {
          throw new AgentAdapterError(
            "terminal-reconciliation-failed",
            "Crashed control signal requires a matching worker.failed event on a blocked task",
          );
        }
        attempt.crashRetryable = signal.retryable;
        attempt.state = "crashed";
        void this.cleanup(attempt);
        return;
      }
      case "protocol-error":
        throw new AgentAdapterError(signal.errorCode, signal.message);
      default: {
        const unsupportedSignal: never = signal;
        throw new AgentAdapterError(
          "invalid-signal",
          `Unsupported AgentAdapter signal ${String(unsupportedSignal)}`,
        );
      }
    }
  }

  private acceptCoreEvent(attempt: SupervisedAttempt, event: CoreEvent, signalTime: Instant): void {
    this.requireState(attempt, ["running", "blocked", "cancelling"], "publish a core event");

    if (
      event.workspaceId !== attempt.request.workspaceId ||
      event.taskId !== attempt.request.taskId ||
      event.sessionId !== attempt.request.sessionId ||
      event.workerId !== attempt.request.workerId ||
      event.streamId !== attempt.request.streamId ||
      event.correlationId !== attempt.request.correlationId
    ) {
      throw new AgentAdapterError(
        "signal-identity-mismatch",
        `Core event identity does not match session ${attempt.request.sessionId}`,
      );
    }

    if (event.occurredAt > signalTime) {
      throw new AgentAdapterError(
        "signal-time-regression",
        "A core event cannot occur after its enclosing control signal",
      );
    }

    if (
      attempt.coreState.previous === undefined &&
      (event.type !== "task.started" || event.payload.from !== attempt.request.taskState)
    ) {
      throw new AgentAdapterError(
        "invalid-signal",
        `Session ${attempt.request.sessionId} must begin with task.started from ${attempt.request.taskState}`,
      );
    }

    try {
      attempt.coreState = advanceCoreEventStreamState(attempt.coreState, event);
    } catch (error) {
      throw new AgentAdapterError(
        "invalid-signal",
        `Session ${attempt.request.sessionId} published an invalid core-event stream`,
        { cause: error },
      );
    }
    attempt.events.push(immutableEvent(event));
  }

  private reconcileBlockedSignal(
    attempt: SupervisedAttempt,
    signal: Extract<AgentSignal, { type: "blocked" }>,
  ): PendingBlockReferences {
    const blockEvent = attempt.coreState.previous;
    if (
      attempt.coreState.taskState !== "blocked" ||
      blockEvent?.type !== "worker.blocked" ||
      blockEvent.payload.reason !== signal.reason ||
      blockEvent.payload.approvalId !== signal.approvalId
    ) {
      throw new AgentAdapterError(
        "invalid-signal",
        "A blocked signal must match a blocked task and its preceding worker.blocked event",
      );
    }

    if (signal.reason !== "approval") {
      if (signal.approvalId !== undefined) {
        throw new AgentAdapterError(
          "invalid-signal",
          "Only an approval block may carry an approval reference",
        );
      }
      if (signal.reason !== "tool") {
        if (signal.requestId !== undefined) {
          throw new AgentAdapterError(
            "invalid-signal",
            "Only approval or tool blocks may carry a request reference",
          );
        }
        return {};
      }

      if (signal.requestId === undefined) {
        throw new AgentAdapterError("invalid-signal", "A tool block requires a request reference");
      }
      const requestEvent = [...attempt.events]
        .reverse()
        .find(
          (event) =>
            event.type === "tool.requested" && event.payload.requestId === signal.requestId,
        );
      if (requestEvent === undefined) {
        throw new AgentAdapterError(
          "terminal-reconciliation-failed",
          "A tool block request does not match an ordered tool.requested event",
        );
      }
      const duplicate = [...this.attempts.values()].find(
        (candidate) =>
          candidate !== attempt &&
          !candidate.disposed &&
          ACTIVE_ATTEMPT_STATES.includes(candidate.state) &&
          candidate.pendingTool?.requestId === signal.requestId,
      );
      if (duplicate !== undefined) {
        throw new AgentAdapterError(
          "signal-identity-mismatch",
          "Tool request references must be unique across active supervised attempts",
        );
      }
      return { tool: { requestId: signal.requestId } };
    }

    if (signal.requestId === undefined || signal.approvalId === undefined) {
      throw new AgentAdapterError(
        "invalid-signal",
        "An approval block requires request and approval references",
      );
    }

    let requestIndex = -1;
    let approvalIndex = -1;
    for (let index = attempt.events.length - 1; index >= 0; index -= 1) {
      const event = attempt.events[index];
      if (
        approvalIndex === -1 &&
        event?.type === "approval.required" &&
        event.payload.approvalId === signal.approvalId
      ) {
        approvalIndex = index;
      }
      if (
        requestIndex === -1 &&
        event?.type === "tool.requested" &&
        event.payload.requestId === signal.requestId &&
        event.payload.approvalId === signal.approvalId
      ) {
        requestIndex = index;
      }
    }

    if (
      requestIndex === -1 ||
      approvalIndex === -1 ||
      requestIndex >= approvalIndex ||
      approvalIndex >= attempt.events.length - 1
    ) {
      throw new AgentAdapterError(
        "terminal-reconciliation-failed",
        "Approval block references do not match the ordered tool and approval events",
      );
    }

    const duplicate = [...this.attempts.values()].find(
      (candidate) =>
        candidate !== attempt &&
        !candidate.disposed &&
        ACTIVE_ATTEMPT_STATES.includes(candidate.state) &&
        (candidate.pendingApproval?.requestId === signal.requestId ||
          candidate.pendingApproval?.approvalId === signal.approvalId),
    );
    if (duplicate !== undefined) {
      throw new AgentAdapterError(
        "signal-identity-mismatch",
        "Approval references must be unique across active supervised attempts",
      );
    }

    return {
      approval: {
        requestId: signal.requestId,
        approvalId: signal.approvalId,
      },
    };
  }

  private reconcileTerminal<Type extends "task.completed" | "task.failed" | "task.cancelled">(
    attempt: SupervisedAttempt,
    type: Type,
  ): Extract<CoreEvent, { type: Type }> {
    this.requireState(attempt, ["running", "blocked", "cancelling"], `publish ${type}`);
    const event = attempt.coreState.previous;

    if (event?.type !== type) {
      throw new AgentAdapterError(
        "terminal-reconciliation-failed",
        `Terminal control signal requires preceding ${type}`,
      );
    }

    return event as Extract<CoreEvent, { type: Type }>;
  }

  private requireState(
    attempt: SupervisedAttempt,
    allowed: readonly AgentAttemptState[],
    operation: string,
  ): void {
    if (!allowed.includes(attempt.state)) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${attempt.request.sessionId} cannot ${operation} while ${attempt.state}`,
      );
    }
  }

  private requireAttempt(session: SessionId): SupervisedAttempt {
    const attempt = this.attempts.get(session);
    if (attempt === undefined) {
      throw new AgentAdapterError("unknown-session", `Unknown session ${session}`);
    }

    return attempt;
  }

  private failProtocol(attempt: SupervisedAttempt, error: AgentAdapterError): void {
    if (attempt.state === "protocol-failed") {
      return;
    }

    attempt.state = "protocol-failed";
    attempt.incident = this.incident(error.code, error.message, this.now());
    void this.cleanup(attempt);
  }

  private async cleanup(attempt: SupervisedAttempt): Promise<void> {
    if (attempt.disposed) {
      return;
    }

    attempt.disposed = true;
    attempt.pendingApproval = undefined;
    attempt.pendingTool = undefined;
    attempt.unsubscribe?.();
    attempt.unsubscribe = undefined;

    try {
      await this.adapter.dispose(attempt.request.sessionId);
    } catch {
      attempt.incident ??= this.incident(
        "adapter-operation-failed",
        `AgentAdapter dispose failed for session ${attempt.request.sessionId}`,
        this.now(),
      );
    }
  }

  private async runAdapterOperation(
    attempt: SupervisedAttempt,
    operation: string,
    pending: Promise<void>,
  ): Promise<void> {
    try {
      await pending;
    } catch (error) {
      const wrapped = new AgentAdapterError(
        "adapter-operation-failed",
        `AgentAdapter ${operation} failed for session ${attempt.request.sessionId}`,
        { cause: error },
      );
      this.failProtocol(attempt, wrapped);
      throw wrapped;
    }
  }

  private incident(
    code: AgentSupervisorIncidentCode,
    message: string,
    occurredAt: Instant,
  ): AgentSupervisorIncident {
    return Object.freeze({
      code,
      message,
      occurredAt,
    });
  }

  private now(): Instant {
    const value = this.clock.now();
    instant(value);
    return value;
  }

  private elapsed(from: Instant, to: Instant): number {
    return Date.parse(to) - Date.parse(from);
  }
}
