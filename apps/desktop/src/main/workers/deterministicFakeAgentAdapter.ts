import {
  AGENT_ADAPTER_PROTOCOL_VERSION,
  AgentAdapterError,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  advanceCoreEventStreamState,
  approvalId,
  assertAgentApprovalDecision,
  assertAgentInput,
  assertAgentSignal,
  assertAgentStartRequest,
  assertAgentToolResult,
  createCoreEventStreamState,
  eventId,
  instant,
  sessionId,
  toolRequestId,
  type AgentAdapter,
  type AgentApprovalDecision,
  type AgentCapabilities,
  type AgentClock,
  type AgentInput,
  type AgentSignal,
  type AgentSignalHandler,
  type AgentStartRequest,
  type AgentToolResult,
  type ApprovalId,
  type CoreEvent,
  type CoreEventStreamState,
  type CoreEventType,
  type EventId,
  type EventPayloadByType,
  type Instant,
  type SessionId,
  type TaskState,
  type ToolRequestId,
  type UnsubscribeAgentSignals,
} from "../../core";

export class DeterministicAgentClock implements AgentClock {
  private currentTimeMs: number;

  constructor(initialTime: Instant) {
    instant(initialTime);
    this.currentTimeMs = Date.parse(initialTime);
  }

  now(): Instant {
    return instant(new Date(this.currentTimeMs).toISOString());
  }

  advance(milliseconds: number): Instant {
    if (
      !Number.isSafeInteger(milliseconds) ||
      milliseconds < 0 ||
      this.currentTimeMs + milliseconds > 8_640_000_000_000_000
    ) {
      throw new AgentAdapterError(
        "invalid-request",
        "Deterministic clock advancement must be a non-negative safe duration",
      );
    }

    this.currentTimeMs += milliseconds;
    return this.now();
  }
}

export type DeterministicFakeStep =
  | {
      readonly type: "heartbeat";
    }
  | {
      readonly type: "message";
      readonly content: string;
      readonly role?: "assistant" | "system";
    }
  | {
      readonly type: "approval";
      readonly requestId: ToolRequestId;
      readonly approvalId: ApprovalId;
      readonly action: string;
      readonly expiresAt?: Instant;
    }
  | {
      readonly type: "tool";
      readonly requestId: ToolRequestId;
      readonly toolName: string;
      readonly summary: string;
    }
  | {
      readonly type: "complete";
    }
  | {
      readonly type: "fail";
      readonly errorCode: string;
      readonly message: string;
    }
  | {
      readonly type: "crash";
      readonly errorCode: string;
      readonly message: string;
      readonly retryable: boolean;
    };

export interface DeterministicFakePlan {
  readonly startMode?: "ready" | "silent";
  readonly acknowledgeCancellation?: boolean;
  readonly steps: readonly DeterministicFakeStep[];
}

type FakeAttemptState =
  | "starting"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "crashed";

interface PendingFakeApproval {
  readonly requestId: ToolRequestId;
  readonly approvalId: ApprovalId;
}

interface PendingFakeTool {
  readonly requestId: ToolRequestId;
}

interface FakeAttempt {
  readonly request: AgentStartRequest;
  readonly plan: DeterministicFakePlan;
  state: FakeAttemptState;
  controlSequence: number;
  nextStepIndex: number;
  coreState: CoreEventStreamState;
  readonly eventIds: Set<EventId>;
  pendingApproval?: PendingFakeApproval;
  pendingTool?: PendingFakeTool;
  disposed: boolean;
}

const CAPABILITIES = Object.freeze({
  protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
  adapterKind: "deterministic-fake",
  capabilities: Object.freeze([
    "messages",
    "approvals",
    "cancellation",
    "heartbeats",
    "tool-results",
  ] as const),
  maxConcurrentSessions: 64,
  heartbeatIntervalMs: 1_000,
}) satisfies AgentCapabilities;

function clonePlan(plan: DeterministicFakePlan): DeterministicFakePlan {
  return Object.freeze({
    startMode: plan.startMode ?? "ready",
    acknowledgeCancellation: plan.acknowledgeCancellation ?? true,
    steps: Object.freeze(plan.steps.map((step) => Object.freeze({ ...step }))),
  });
}

function planRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentAdapterError("invalid-request", `${label} must be an object`);
  }

  return value as Record<string, unknown>;
}

function exactPlanKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpected !== undefined) {
    throw new AgentAdapterError(
      "invalid-request",
      `${label} contains unsupported field ${unexpected}`,
    );
  }
}

function planString(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new AgentAdapterError("invalid-request", `${label} must be a string`);
  }

  return value;
}

function assertDeterministicFakeStep(value: unknown, index: number): void {
  const label = `Deterministic fake plan step ${index}`;
  const step = planRecord(value, label);
  const type = planString(step.type, `${label}.type`);

  switch (type) {
    case "heartbeat":
    case "complete":
      exactPlanKeys(step, ["type"], label);
      return;
    case "message":
      exactPlanKeys(step, ["type", "content", "role"], label);
      planString(step.content, `${label}.content`, true);
      if (step.role !== undefined && step.role !== "assistant" && step.role !== "system") {
        throw new AgentAdapterError("invalid-request", `${label}.role must be assistant or system`);
      }
      return;
    case "approval":
      exactPlanKeys(step, ["type", "requestId", "approvalId", "action", "expiresAt"], label);
      toolRequestId(planString(step.requestId, `${label}.requestId`));
      approvalId(planString(step.approvalId, `${label}.approvalId`));
      planString(step.action, `${label}.action`);
      if (step.expiresAt !== undefined) {
        instant(planString(step.expiresAt, `${label}.expiresAt`));
      }
      return;
    case "tool":
      exactPlanKeys(step, ["type", "requestId", "toolName", "summary"], label);
      toolRequestId(planString(step.requestId, `${label}.requestId`));
      planString(step.toolName, `${label}.toolName`);
      planString(step.summary, `${label}.summary`);
      return;
    case "fail":
      exactPlanKeys(step, ["type", "errorCode", "message"], label);
      planString(step.errorCode, `${label}.errorCode`);
      planString(step.message, `${label}.message`, true);
      return;
    case "crash":
      exactPlanKeys(step, ["type", "errorCode", "message", "retryable"], label);
      planString(step.errorCode, `${label}.errorCode`);
      planString(step.message, `${label}.message`, true);
      if (typeof step.retryable !== "boolean") {
        throw new AgentAdapterError("invalid-request", `${label}.retryable must be boolean`);
      }
      return;
    default:
      throw new AgentAdapterError("invalid-request", `${label}.type ${type} is unsupported`);
  }
}

function assertDeterministicFakePlan(value: unknown): asserts value is DeterministicFakePlan {
  const plan = planRecord(value, "Deterministic fake plan");
  exactPlanKeys(plan, ["startMode", "acknowledgeCancellation", "steps"], "Deterministic fake plan");

  if (plan.startMode !== undefined && plan.startMode !== "ready" && plan.startMode !== "silent") {
    throw new AgentAdapterError(
      "invalid-request",
      "Deterministic fake plan.startMode must be ready or silent",
    );
  }

  if (
    plan.acknowledgeCancellation !== undefined &&
    typeof plan.acknowledgeCancellation !== "boolean"
  ) {
    throw new AgentAdapterError(
      "invalid-request",
      "Deterministic fake plan.acknowledgeCancellation must be boolean",
    );
  }

  if (!Array.isArray(plan.steps)) {
    throw new AgentAdapterError(
      "invalid-request",
      "Deterministic fake plan.steps must be an array",
    );
  }

  plan.steps.forEach(assertDeterministicFakeStep);
}

export class DeterministicFakeAgentAdapter implements AgentAdapter {
  private readonly plans = new Map<SessionId, DeterministicFakePlan>();
  private readonly attempts = new Map<SessionId, FakeAttempt>();
  private readonly subscribers = new Map<SessionId, Set<AgentSignalHandler>>();

  constructor(private readonly clock: AgentClock) {}

  async capabilities(): Promise<AgentCapabilities> {
    return CAPABILITIES;
  }

  registerPlan(session: SessionId, plan: DeterministicFakePlan): void {
    sessionId(session);
    try {
      assertDeterministicFakePlan(plan);
    } catch (error) {
      if (error instanceof AgentAdapterError) {
        throw error;
      }
      throw new AgentAdapterError(
        "invalid-request",
        "Deterministic fake plan contains an invalid protocol value",
        { cause: error },
      );
    }

    if (this.plans.has(session) || this.attempts.has(session)) {
      throw new AgentAdapterError(
        "duplicate-session",
        `A deterministic plan already exists for session ${session}`,
      );
    }

    this.plans.set(session, clonePlan(plan));
  }

  async start(request: AgentStartRequest): Promise<void> {
    assertAgentStartRequest(request);

    if (this.clock.now() < request.startedAt) {
      throw new AgentAdapterError(
        "invalid-request",
        `Session ${request.sessionId} cannot start before its immutable start time`,
      );
    }

    if (this.attempts.has(request.sessionId)) {
      throw new AgentAdapterError(
        "duplicate-session",
        `Session ${request.sessionId} has already started`,
      );
    }

    const plan = this.plans.get(request.sessionId);
    if (plan === undefined) {
      throw new AgentAdapterError(
        "invalid-request",
        `No deterministic plan is registered for session ${request.sessionId}`,
      );
    }

    const attempt: FakeAttempt = {
      request: Object.freeze({ ...request }),
      plan,
      state: "starting",
      controlSequence: 0,
      nextStepIndex: 0,
      coreState: createCoreEventStreamState([]),
      eventIds: new Set(),
      disposed: false,
    };
    this.attempts.set(request.sessionId, attempt);

    if (plan.startMode !== "silent") {
      attempt.state = "running";
      this.emitSignal(attempt, { type: "ready" });
      this.emitCoreEvent(attempt, "task.started", {
        from: request.taskState,
        to: "running",
      });
    }
  }

  async appendAuthoritativeArtifactEvent(
    session: SessionId,
    event: CoreEvent<"artifact.created" | "artifact.updated">,
  ): Promise<void> {
    sessionId(session);
    const attempt = this.activeAttempt(session, "accept an artifact event");
    if (
      (event.type !== "artifact.created" && event.type !== "artifact.updated") ||
      event.workspaceId !== attempt.request.workspaceId ||
      event.taskId !== attempt.request.taskId ||
      event.sessionId !== attempt.request.sessionId ||
      event.workerId !== attempt.request.workerId ||
      event.streamId !== attempt.request.streamId ||
      event.correlationId !== attempt.request.correlationId
    ) {
      throw new AgentAdapterError(
        "signal-identity-mismatch",
        `Artifact event identity does not match session ${session}`,
      );
    }
    if (attempt.eventIds.has(event.eventId)) {
      throw new AgentAdapterError(
        "invalid-signal",
        "Authoritative artifact event reuses a deterministic event identifier",
      );
    }
    try {
      attempt.coreState = advanceCoreEventStreamState(attempt.coreState, event);
    } catch (error) {
      throw new AgentAdapterError(
        "invalid-signal",
        "Authoritative artifact event conflicts with the deterministic stream",
        { cause: error },
      );
    }
    attempt.eventIds.add(event.eventId);
    this.emitSignal(attempt, {
      type: "core-event",
      event,
    });
  }

  async send(session: SessionId, input: AgentInput): Promise<void> {
    sessionId(session);
    assertAgentInput(input);
    const attempt = this.activeAttempt(session, "send input");

    if (attempt.state !== "running") {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${session} cannot receive input while ${attempt.state}`,
      );
    }

    this.emitCoreEvent(attempt, "agent.message", {
      role: "assistant",
      content: `Echo: ${input.content}`,
    });
  }

  async approve(requestIdValue: ToolRequestId, decision: AgentApprovalDecision): Promise<void> {
    toolRequestId(requestIdValue);
    assertAgentApprovalDecision(decision);
    const attempt = [...this.attempts.values()].find(
      (candidate) => !candidate.disposed && candidate.pendingApproval?.requestId === requestIdValue,
    );

    if (attempt === undefined || attempt.pendingApproval === undefined) {
      throw new AgentAdapterError(
        "invalid-state",
        `No pending approval references request ${requestIdValue}`,
      );
    }

    if (attempt.state !== "blocked" || decision.approvalId !== attempt.pendingApproval.approvalId) {
      throw new AgentAdapterError(
        "invalid-state",
        `Approval decision does not match blocked request ${requestIdValue}`,
      );
    }

    this.emitCoreEvent(attempt, "approval.resolved", {
      approvalId: decision.approvalId,
      decision: decision.decision,
    });

    if (decision.decision === "approved") {
      this.emitCoreEvent(attempt, "task.updated", {
        from: "blocked",
        to: "running",
        reason: "Approval granted",
      });
      attempt.pendingApproval = undefined;
      attempt.state = "running";
      this.emitSignal(attempt, { type: "resumed" });
      return;
    }

    attempt.pendingApproval = undefined;

    if (decision.decision === "cancelled") {
      const reason = "Approval cancelled";
      this.emitCoreEvent(attempt, "task.cancelled", {
        from: "blocked",
        to: "cancelled",
        reason,
      });
      attempt.state = "cancelled";
      this.emitSignal(attempt, {
        type: "cancelled",
        reason,
      });
      return;
    }

    const errorCode = decision.decision === "denied" ? "approval-denied" : "approval-expired";
    const message =
      decision.decision === "denied"
        ? "The referenced approval was denied."
        : "The referenced approval expired.";
    this.emitCoreEvent(attempt, "task.failed", {
      from: "blocked",
      to: "failed",
      errorCode,
      message,
    });
    attempt.state = "failed";
    this.emitSignal(attempt, {
      type: "failed",
      errorCode,
      message,
    });
  }

  async resolveTool(requestIdValue: ToolRequestId, result: AgentToolResult): Promise<void> {
    toolRequestId(requestIdValue);
    assertAgentToolResult(result);
    const attempt = [...this.attempts.values()].find(
      (candidate) => !candidate.disposed && candidate.pendingTool?.requestId === requestIdValue,
    );

    if (
      attempt === undefined ||
      attempt.pendingTool === undefined ||
      attempt.state !== "blocked" ||
      result.requestId !== requestIdValue
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `No pending deterministic tool references request ${requestIdValue}`,
      );
    }

    this.emitCoreEvent(attempt, "tool.started", {
      requestId: requestIdValue,
    });
    attempt.pendingTool = undefined;

    if (result.status === "succeeded") {
      this.emitCoreEvent(attempt, "tool.completed", {
        requestId: requestIdValue,
        ...(result.summary === undefined ? {} : { summary: result.summary }),
      });
      this.emitCoreEvent(attempt, "task.updated", {
        from: "blocked",
        to: "running",
        reason: "Tool result received",
      });
      attempt.state = "running";
      this.emitSignal(attempt, { type: "resumed" });
      return;
    }

    if (result.status === "failed") {
      this.emitCoreEvent(attempt, "tool.failed", {
        requestId: requestIdValue,
        errorCode: result.errorCode,
        message: result.message,
        mayHaveExecuted: result.mayHaveExecuted,
      });
      this.emitCoreEvent(attempt, "task.failed", {
        from: "blocked",
        to: "failed",
        errorCode: result.errorCode,
        message: result.message,
      });
      attempt.state = "failed";
      this.emitSignal(attempt, {
        type: "failed",
        errorCode: result.errorCode,
        message: result.message,
      });
      return;
    }

    const reason = result.reason ?? "Tool execution cancelled";
    this.emitCoreEvent(attempt, "tool.failed", {
      requestId: requestIdValue,
      errorCode: "tool-cancelled",
      message: reason,
      mayHaveExecuted: false,
    });
    this.emitCoreEvent(attempt, "task.cancelled", {
      from: "blocked",
      to: "cancelled",
      reason,
    });
    attempt.state = "cancelled";
    this.emitSignal(attempt, {
      type: "cancelled",
      reason,
    });
  }

  async cancel(session: SessionId, reason?: string): Promise<void> {
    sessionId(session);
    const attempt = this.attempts.get(session);

    if (attempt === undefined) {
      throw new AgentAdapterError("unknown-session", `Unknown session ${session}`);
    }

    if (
      attempt.disposed ||
      attempt.state === "completed" ||
      attempt.state === "failed" ||
      attempt.state === "cancelled" ||
      attempt.state === "crashed"
    ) {
      return;
    }

    if (attempt.plan.acknowledgeCancellation === false) {
      return;
    }

    const from = attempt.coreState.taskState;
    if (from !== "running" && from !== "blocked") {
      return;
    }

    this.emitCoreEvent(attempt, "task.cancelled", {
      from,
      to: "cancelled",
      ...(reason === undefined ? {} : { reason }),
    });
    attempt.pendingApproval = undefined;
    attempt.pendingTool = undefined;
    attempt.state = "cancelled";
    this.emitSignal(attempt, {
      type: "cancelled",
      ...(reason === undefined ? {} : { reason }),
    });
  }

  subscribe(session: SessionId, handler: AgentSignalHandler): UnsubscribeAgentSignals {
    sessionId(session);
    const handlers = this.subscribers.get(session) ?? new Set<AgentSignalHandler>();
    handlers.add(handler);
    this.subscribers.set(session, handlers);
    let subscribed = true;

    return () => {
      if (!subscribed) {
        return;
      }

      subscribed = false;
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscribers.delete(session);
      }
    };
  }

  async dispose(session: SessionId): Promise<void> {
    sessionId(session);
    const attempt = this.attempts.get(session);
    if (attempt !== undefined) {
      attempt.pendingApproval = undefined;
      attempt.pendingTool = undefined;
      attempt.disposed = true;
    }
  }

  async advance(session: SessionId): Promise<void> {
    sessionId(session);
    const attempt = this.activeAttempt(session, "advance its deterministic plan");
    const step = attempt.plan.steps[attempt.nextStepIndex];

    if (step === undefined) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${session} has no deterministic step to advance`,
      );
    }

    switch (step.type) {
      case "heartbeat":
        if (attempt.state !== "running" && attempt.state !== "blocked") {
          throw new AgentAdapterError(
            "invalid-state",
            `Session ${session} cannot heartbeat while ${attempt.state}`,
          );
        }
        this.emitSignal(attempt, { type: "heartbeat" });
        break;
      case "message":
        if (attempt.state !== "running") {
          throw new AgentAdapterError(
            "invalid-state",
            `Session ${session} cannot publish a message while ${attempt.state}`,
          );
        }
        this.emitCoreEvent(attempt, "agent.message", {
          role: step.role ?? "assistant",
          content: step.content,
        });
        break;
      case "approval":
        this.requireAttemptState(attempt, "running", "request approval");
        this.emitCoreEvent(attempt, "tool.requested", {
          requestId: step.requestId,
          toolName: "deterministic.reference",
          summary: step.action,
          approvalId: step.approvalId,
        });
        this.emitCoreEvent(attempt, "approval.required", {
          approvalId: step.approvalId,
          action: step.action,
          ...(step.expiresAt === undefined ? {} : { expiresAt: step.expiresAt }),
        });
        this.emitCoreEvent(attempt, "task.updated", {
          from: "running",
          to: "blocked",
          reason: "Approval required",
        });
        this.emitCoreEvent(attempt, "worker.blocked", {
          reason: "approval",
          approvalId: step.approvalId,
        });
        attempt.pendingApproval = {
          requestId: step.requestId,
          approvalId: step.approvalId,
        };
        attempt.state = "blocked";
        this.emitSignal(attempt, {
          type: "blocked",
          reason: "approval",
          requestId: step.requestId,
          approvalId: step.approvalId,
        });
        break;
      case "tool":
        this.requireAttemptState(attempt, "running", "request a tool");
        this.emitCoreEvent(attempt, "tool.requested", {
          requestId: step.requestId,
          toolName: step.toolName,
          summary: step.summary,
        });
        this.emitCoreEvent(attempt, "task.updated", {
          from: "running",
          to: "blocked",
          reason: "Tool result required",
        });
        this.emitCoreEvent(attempt, "worker.blocked", {
          reason: "tool",
        });
        attempt.pendingTool = {
          requestId: step.requestId,
        };
        attempt.state = "blocked";
        this.emitSignal(attempt, {
          type: "blocked",
          reason: "tool",
          requestId: step.requestId,
        });
        break;
      case "complete":
        this.requireAttemptState(attempt, "running", "complete");
        this.emitCoreEvent(attempt, "task.completed", {
          from: "running",
          to: "completed",
        });
        attempt.state = "completed";
        this.emitSignal(attempt, { type: "completed" });
        break;
      case "fail": {
        const from = this.activeTaskState(attempt);
        this.emitCoreEvent(attempt, "task.failed", {
          from,
          to: "failed",
          errorCode: step.errorCode,
          message: step.message,
        });
        attempt.pendingApproval = undefined;
        attempt.pendingTool = undefined;
        attempt.state = "failed";
        this.emitSignal(attempt, {
          type: "failed",
          errorCode: step.errorCode,
          message: step.message,
        });
        break;
      }
      case "crash":
        if (attempt.state === "running") {
          this.emitCoreEvent(attempt, "task.updated", {
            from: "running",
            to: "blocked",
            reason: "Worker crashed",
          });
          attempt.state = "blocked";
        } else {
          this.requireAttemptState(attempt, "blocked", "crash");
        }
        this.emitCoreEvent(attempt, "worker.failed", {
          errorCode: step.errorCode,
          message: step.message,
          retryable: step.retryable,
        });
        attempt.pendingApproval = undefined;
        attempt.pendingTool = undefined;
        attempt.state = "crashed";
        this.emitSignal(attempt, {
          type: "crashed",
          errorCode: step.errorCode,
          message: step.message,
          retryable: step.retryable,
        });
        break;
      default: {
        const unsupportedStep: never = step;
        throw new AgentAdapterError(
          "invalid-request",
          `Unsupported deterministic step ${String(unsupportedStep)}`,
        );
      }
    }

    attempt.nextStepIndex += 1;
  }

  isDisposed(session: SessionId): boolean {
    return this.attempts.get(session)?.disposed ?? false;
  }

  private activeAttempt(session: SessionId, operation: string): FakeAttempt {
    const attempt = this.attempts.get(session);

    if (attempt === undefined) {
      throw new AgentAdapterError("unknown-session", `Unknown session ${session}`);
    }

    if (attempt.disposed) {
      throw new AgentAdapterError(
        "invalid-state",
        `Disposed session ${session} cannot ${operation}`,
      );
    }

    return attempt;
  }

  private requireAttemptState(
    attempt: FakeAttempt,
    expected: FakeAttemptState,
    operation: string,
  ): void {
    if (attempt.state !== expected) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${attempt.request.sessionId} cannot ${operation} while ${attempt.state}`,
      );
    }
  }

  private activeTaskState(attempt: FakeAttempt): Extract<TaskState, "running" | "blocked"> {
    const state = attempt.coreState.taskState;
    if (state !== "running" && state !== "blocked") {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${attempt.request.sessionId} has no active task state`,
      );
    }

    return state;
  }

  private emitCoreEvent<Type extends CoreEventType>(
    attempt: FakeAttempt,
    type: Type,
    payload: EventPayloadByType[Type],
  ): CoreEvent<Type> {
    const sequence = (attempt.coreState.previous?.sequence ?? 0) + 1;
    const generatedEventId = eventId(`${attempt.request.sessionId}:event:${sequence}`);
    if (attempt.eventIds.has(generatedEventId)) {
      throw new AgentAdapterError(
        "invalid-signal",
        "Deterministic event identifier was already accepted",
      );
    }
    const event = {
      schemaVersion: 1,
      eventId: generatedEventId,
      streamId: attempt.request.streamId,
      sequence,
      occurredAt: this.clock.now(),
      workspaceId: attempt.request.workspaceId,
      taskId: attempt.request.taskId,
      sessionId: attempt.request.sessionId,
      workerId: attempt.request.workerId,
      correlationId: attempt.request.correlationId,
      type,
      redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
      payload,
    } as CoreEvent<Type>;

    attempt.coreState = advanceCoreEventStreamState(attempt.coreState, event);
    attempt.eventIds.add(generatedEventId);
    this.emitSignal(attempt, {
      type: "core-event",
      event: event as CoreEvent,
    });
    return event;
  }

  private emitSignal(
    attempt: FakeAttempt,
    signal:
      | { readonly type: "ready" }
      | { readonly type: "heartbeat" }
      | { readonly type: "core-event"; readonly event: CoreEvent }
      | {
          readonly type: "blocked";
          readonly reason: "approval" | "tool" | "dependency" | "other";
          readonly requestId?: ToolRequestId;
          readonly approvalId?: ApprovalId;
        }
      | { readonly type: "resumed" }
      | { readonly type: "completed" }
      | {
          readonly type: "failed";
          readonly errorCode: string;
          readonly message: string;
        }
      | { readonly type: "cancelled"; readonly reason?: string }
      | {
          readonly type: "crashed";
          readonly errorCode: string;
          readonly message: string;
          readonly retryable: boolean;
        }
      | {
          readonly type: "protocol-error";
          readonly errorCode:
            | "incompatible-protocol"
            | "invalid-signal"
            | "signal-identity-mismatch"
            | "signal-sequence-gap";
          readonly message: string;
        },
  ): void {
    attempt.controlSequence += 1;
    const value = {
      protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
      sequence: attempt.controlSequence,
      occurredAt: this.clock.now(),
      sessionId: attempt.request.sessionId,
      workerId: attempt.request.workerId,
      ...signal,
    } as AgentSignal;
    assertAgentSignal(value);

    for (const handler of Array.from(this.subscribers.get(attempt.request.sessionId) ?? [])) {
      handler(value);
    }
  }
}
