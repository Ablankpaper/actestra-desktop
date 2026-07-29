import { randomUUID } from "node:crypto";
import {
  AGENT_ADAPTER_PROTOCOL_VERSION,
  AgentAdapterError,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  advanceCoreEventStreamState,
  assertAgentInput,
  assertAgentSignal,
  assertAgentStartRequest,
  assertAgentToolResult,
  createCoreEventStreamState,
  eventId,
  instant,
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
import {
  GENERAL_WORKER_CAPABILITIES,
  GENERAL_WORKER_PROTOCOL_VERSION,
  assertGeneralWorkerMessage,
  assertGeneralWorkerRequest,
  type GeneralWorkerEventMessage,
  type GeneralWorkerExecutionMode,
  type GeneralWorkerOperation,
  type GeneralWorkerRequest,
  type GeneralWorkerResponse,
} from "../../shared/generalWorkerProtocol";

export type GeneralWorkerProcessErrorCode =
  | "startup-timeout"
  | "request-timeout"
  | "unavailable"
  | "invalid-message"
  | "operation-failed";

export class GeneralWorkerProcessError extends Error {
  constructor(
    readonly code: GeneralWorkerProcessErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeneralWorkerProcessError";
  }
}

export interface GeneralWorkerProcessTransport {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: () => void): () => void;
  onExit(listener: (code: number) => void): () => void;
  kill(): boolean;
}

export interface GeneralWorkerProcessAdapterOptions {
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly executionMode?: GeneralWorkerExecutionMode;
  readonly newAttemptToken?: () => string;
  readonly newToolRequestId?: () => ToolRequestId;
  readonly newEventId?: () => EventId;
}

interface PendingRequest {
  readonly operation: GeneralWorkerOperation;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface PendingToolCall {
  readonly callId: string;
  readonly requestId: ToolRequestId;
  resolution?: AgentToolResult;
}

interface ProcessAttempt {
  readonly request: AgentStartRequest;
  readonly attemptToken: string;
  nextWireSequence: number;
  nextControlSequence: number;
  coreState: CoreEventStreamState;
  readonly eventIds: Set<EventId>;
  pendingTool?: PendingToolCall;
  acceptedToolResult?: AgentToolResult;
  terminal: boolean;
  disposed: boolean;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const ADAPTER_KIND = "actestra.general-worker";

const CAPABILITIES = Object.freeze({
  protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
  adapterKind: ADAPTER_KIND,
  capabilities: Object.freeze([...GENERAL_WORKER_CAPABILITIES]),
  maxConcurrentSessions: 1,
  heartbeatIntervalMs: 1_000,
}) satisfies AgentCapabilities;

function defaultAttemptToken(): string {
  return `worker-attempt-${randomUUID()}`;
}

function defaultToolRequestId(): ToolRequestId {
  return toolRequestId(`tool-request-${randomUUID()}`);
}

function defaultEventId(): EventId {
  return eventId(`event-${randomUUID()}`);
}

function assertPositiveDuration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new GeneralWorkerProcessError(
      "operation-failed",
      `${label} must be a positive safe integer`,
    );
  }
}

export class GeneralWorkerProcessAdapter implements AgentAdapter {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Map<SessionId, Set<AgentSignalHandler>>();
  private readonly attempts = new Map<SessionId, ProcessAttempt>();
  private readonly attemptsByToken = new Map<string, ProcessAttempt>();
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly executionMode: GeneralWorkerExecutionMode;
  private readonly newAttemptToken: () => string;
  private readonly newToolRequestId: () => ToolRequestId;
  private readonly newEventId: () => EventId;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeError: () => void;
  private readonly unsubscribeExit: () => void;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly startup: Promise<void>;
  private resolveStartup!: () => void;
  private rejectStartup!: (error: Error) => void;
  private receivedReady = false;
  private connected = false;
  private failed = false;
  private closing = false;
  private closed = false;
  private listenersCleaned = false;
  private closePromise: Promise<void> | null = null;

  private constructor(
    private readonly transport: GeneralWorkerProcessTransport,
    private readonly clock: AgentClock,
    options: GeneralWorkerProcessAdapterOptions,
  ) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.executionMode = options.executionMode ?? "no-tool-complete";
    this.newAttemptToken = options.newAttemptToken ?? defaultAttemptToken;
    this.newToolRequestId = options.newToolRequestId ?? defaultToolRequestId;
    this.newEventId = options.newEventId ?? defaultEventId;
    assertPositiveDuration(this.startupTimeoutMs, "General Worker startup timeout");
    assertPositiveDuration(this.requestTimeoutMs, "General Worker request timeout");
    instant(this.clock.now());

    this.startup = new Promise<void>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });
    this.unsubscribeMessage = this.transport.onMessage((message) => {
      this.handleMessage(message);
    });
    this.unsubscribeError = this.transport.onError(() => {
      this.fail(
        new GeneralWorkerProcessError(
          "unavailable",
          "General Worker process reported a fatal error",
        ),
      );
    });
    this.unsubscribeExit = this.transport.onExit((code) => {
      this.handleExit(code);
    });
  }

  static async connect(
    transport: GeneralWorkerProcessTransport,
    clock: AgentClock,
    options: GeneralWorkerProcessAdapterOptions = {},
  ): Promise<GeneralWorkerProcessAdapter> {
    const adapter = new GeneralWorkerProcessAdapter(transport, clock, options);
    adapter.startupTimer = setTimeout(() => {
      adapter.fail(
        new GeneralWorkerProcessError(
          "startup-timeout",
          "General Worker process did not negotiate in time",
        ),
      );
    }, adapter.startupTimeoutMs);
    try {
      await adapter.startup;
      return adapter;
    } finally {
      adapter.clearStartupTimer();
    }
  }

  async capabilities(): Promise<AgentCapabilities> {
    this.assertAvailable();
    return CAPABILITIES;
  }

  async start(request: AgentStartRequest): Promise<void> {
    this.assertAvailable();
    assertAgentStartRequest(request);
    if (this.attempts.size > 0) {
      throw new AgentAdapterError(
        "concurrency-limit",
        "The General Worker process accepts one immutable attempt",
      );
    }
    if (this.clock.now() < request.startedAt) {
      throw new AgentAdapterError(
        "invalid-request",
        "A General Worker attempt cannot start before its immutable start time",
      );
    }

    const attemptToken = this.newAttemptToken();
    const attempt: ProcessAttempt = {
      request: Object.freeze({ ...request }),
      attemptToken,
      nextWireSequence: 1,
      nextControlSequence: 1,
      coreState: createCoreEventStreamState([]),
      eventIds: new Set(),
      terminal: false,
      disposed: false,
    };
    if (this.attemptsByToken.has(attemptToken)) {
      throw new AgentAdapterError(
        "duplicate-session",
        "General Worker attempt token factory returned a duplicate",
      );
    }
    this.attempts.set(request.sessionId, attempt);
    this.attemptsByToken.set(attemptToken, attempt);

    try {
      await this.invoke("start", {
        attemptToken,
        prompt: request.initialPrompt,
        entryState: request.taskState,
        executionMode: this.executionMode,
      });
    } catch (error) {
      this.attempts.delete(request.sessionId);
      this.attemptsByToken.delete(attemptToken);
      throw error;
    }
  }

  async appendAuthoritativeArtifactEvent(
    session: SessionId,
    event: CoreEvent<"artifact.created" | "artifact.updated">,
  ): Promise<void> {
    this.assertAvailable();
    const attempt = this.requireAttempt(session);
    if (
      attempt.terminal ||
      attempt.disposed ||
      (event.type !== "artifact.created" && event.type !== "artifact.updated") ||
      event.workspaceId !== attempt.request.workspaceId ||
      event.taskId !== attempt.request.taskId ||
      event.sessionId !== attempt.request.sessionId ||
      event.workerId !== attempt.request.workerId ||
      event.streamId !== attempt.request.streamId ||
      event.correlationId !== attempt.request.correlationId ||
      attempt.eventIds.has(event.eventId)
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `General Worker session ${session} cannot accept the artifact event`,
      );
    }
    try {
      attempt.coreState = advanceCoreEventStreamState(attempt.coreState, event);
    } catch (error) {
      throw new AgentAdapterError(
        "invalid-signal",
        "Authoritative artifact event conflicts with the General Worker stream",
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
    this.assertAvailable();
    assertAgentInput(input);
    const attempt = this.requireAttempt(session);
    if (attempt.terminal || attempt.disposed) {
      throw new AgentAdapterError(
        "invalid-state",
        `General Worker session ${session} cannot receive input`,
      );
    }
    await this.invoke("send", {
      attemptToken: attempt.attemptToken,
      content: input.content,
    });
  }

  async approve(_requestId: ToolRequestId, _decision: AgentApprovalDecision): Promise<void> {
    throw new AgentAdapterError(
      "unsupported-capability",
      "The deterministic General Worker does not request approvals",
    );
  }

  async resolveTool(requestIdValue: ToolRequestId, result: AgentToolResult): Promise<void> {
    this.assertAvailable();
    toolRequestId(requestIdValue);
    assertAgentToolResult(result);
    const attempt = [...this.attempts.values()].find(
      (candidate) => candidate.pendingTool?.requestId === requestIdValue,
    );
    if (
      attempt === undefined ||
      attempt.pendingTool === undefined ||
      attempt.terminal ||
      attempt.disposed ||
      result.requestId !== requestIdValue ||
      attempt.pendingTool.resolution !== undefined
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `General Worker has no unresolved tool request ${requestIdValue}`,
      );
    }

    const frozenResult = Object.freeze({ ...result }) as AgentToolResult;
    attempt.pendingTool.resolution = frozenResult;
    try {
      await this.invoke("resolve-tool", {
        attemptToken: attempt.attemptToken,
        callId: attempt.pendingTool.callId,
        result: frozenResult,
      });
    } catch (error) {
      if (attempt.pendingTool?.resolution === frozenResult) {
        attempt.pendingTool.resolution = undefined;
      }
      throw error;
    }
  }

  async cancel(session: SessionId, reason?: string): Promise<void> {
    this.assertAvailable();
    if (reason !== undefined && typeof reason !== "string") {
      throw new AgentAdapterError("invalid-request", "Cancellation reason must be a string");
    }
    const attempt = this.requireAttempt(session);
    if (attempt.terminal || attempt.disposed) {
      return;
    }
    await this.invoke("cancel", {
      attemptToken: attempt.attemptToken,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  subscribe(session: SessionId, handler: AgentSignalHandler): UnsubscribeAgentSignals {
    if (typeof handler !== "function") {
      throw new AgentAdapterError("invalid-request", "Agent signal handler must be a function");
    }
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
    const attempt = this.attempts.get(session);
    if (attempt === undefined || attempt.disposed) {
      return;
    }
    attempt.disposed = true;
    attempt.pendingTool = undefined;
    if (!this.failed && !this.closed) {
      await this.invoke("dispose", {
        attemptToken: attempt.attemptToken,
      }).catch((): undefined => undefined);
    }
    this.attempts.delete(session);
    this.attemptsByToken.delete(attempt.attemptToken);
    if (this.attempts.size === 0) {
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }
    this.closePromise = this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closing = true;
    if (!this.failed) {
      await this.invoke("close", {}).catch((): undefined => undefined);
    }
    this.closed = true;
    this.rejectPending(
      new GeneralWorkerProcessError("unavailable", "General Worker process is closed"),
    );
    this.cleanupListeners();
    this.transport.kill();
  }

  private invoke<Operation extends GeneralWorkerOperation>(
    operation: Operation,
    payload: Extract<GeneralWorkerRequest, { operation: Operation }>["payload"],
  ): Promise<void> {
    this.assertAvailable();
    const requestId = `worker-request-${randomUUID()}`;
    const request = {
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "request",
      requestId,
      operation,
      payload,
    } as Extract<GeneralWorkerRequest, { operation: Operation }>;
    assertGeneralWorkerRequest(request);

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new GeneralWorkerProcessError(
          "request-timeout",
          `General Worker ${operation} request timed out`,
        );
        reject(error);
        this.fail(error);
      }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        operation,
        resolve,
        reject,
        timeout,
      });
      try {
        this.transport.postMessage(request);
      } catch {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        const error = new GeneralWorkerProcessError(
          "unavailable",
          "General Worker request could not be sent",
        );
        reject(error);
        this.fail(error);
      }
    });
  }

  private handleMessage(value: unknown): void {
    if (this.closed || this.failed) {
      return;
    }
    try {
      assertGeneralWorkerMessage(value);
      const message = value;
      switch (message.type) {
        case "ready":
          this.handleReady();
          return;
        case "response":
          this.handleResponse(message);
          return;
        case "event":
          this.handleEvent(message);
          return;
        case "fatal":
          throw new GeneralWorkerProcessError(
            "invalid-message",
            `General Worker reported ${message.code}`,
          );
        case "request":
          throw new GeneralWorkerProcessError(
            "invalid-message",
            "General Worker cannot send requests to main",
          );
      }
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new GeneralWorkerProcessError(
              "invalid-message",
              "General Worker sent an invalid message",
            ),
      );
    }
  }

  private handleReady(): void {
    if (this.receivedReady || this.connected) {
      throw new GeneralWorkerProcessError(
        "invalid-message",
        "General Worker sent an unexpected ready message",
      );
    }
    this.receivedReady = true;
    this.connected = true;
    this.clearStartupTimer();
    this.resolveStartup();
  }

  private handleResponse(message: GeneralWorkerResponse): void {
    if (!this.connected) {
      throw new GeneralWorkerProcessError(
        "invalid-message",
        "General Worker responded before capability negotiation",
      );
    }
    const pending = this.pending.get(message.requestId);
    if (pending === undefined || pending.operation !== message.operation) {
      throw new GeneralWorkerProcessError(
        "invalid-message",
        "General Worker response correlation is invalid",
      );
    }
    this.pending.delete(message.requestId);
    clearTimeout(pending.timeout);
    if (message.ok === false) {
      pending.reject(
        new AgentAdapterError(
          message.error.code === "duplicate-attempt"
            ? "duplicate-session"
            : message.error.code === "unknown-attempt"
              ? "unknown-session"
              : message.error.code === "invalid-request"
                ? "invalid-request"
                : "invalid-state",
          message.error.message,
        ),
      );
      return;
    }
    pending.resolve();
  }

  private handleEvent(message: GeneralWorkerEventMessage): void {
    if (!this.connected) {
      throw new GeneralWorkerProcessError(
        "invalid-message",
        "General Worker emitted an event before negotiation",
      );
    }
    const attempt = this.attemptsByToken.get(message.attemptToken);
    if (attempt === undefined || attempt.disposed) {
      this.emitProtocolFailure(
        "signal-identity-mismatch",
        "General Worker emitted a stale or unknown attempt token",
      );
      return;
    }
    if (message.sequence !== attempt.nextWireSequence) {
      this.emitProtocolError(
        attempt,
        "signal-sequence-gap",
        `General Worker expected wire sequence ${attempt.nextWireSequence}, received ${message.sequence}`,
      );
      this.fail(
        new GeneralWorkerProcessError("invalid-message", "General Worker wire sequence is invalid"),
      );
      return;
    }
    attempt.nextWireSequence += 1;
    this.applyWorkerEvent(attempt, message);
  }

  private applyWorkerEvent(attempt: ProcessAttempt, message: GeneralWorkerEventMessage): void {
    const event = message.event;
    switch (event.type) {
      case "started":
        if (attempt.coreState.previous !== undefined || attempt.terminal) {
          return this.protocolStateFailure(attempt, "General Worker started twice");
        }
        this.emitSignal(attempt, { type: "ready" });
        this.emitCoreEvent(attempt, "task.started", {
          from: attempt.request.taskState,
          to: "running",
        });
        return;
      case "heartbeat":
        this.requireActiveTask(attempt);
        this.emitSignal(attempt, { type: "heartbeat" });
        return;
      case "message":
        this.requireTaskState(attempt, "running");
        this.emitCoreEvent(attempt, "agent.message", {
          role: event.role,
          content: event.content,
        });
        return;
      case "tool-requested": {
        this.requireTaskState(attempt, "running");
        if (attempt.pendingTool !== undefined) {
          return this.protocolStateFailure(
            attempt,
            "General Worker requested a second unresolved tool",
          );
        }
        const requestIdValue = this.newToolRequestId();
        toolRequestId(requestIdValue);
        attempt.pendingTool = {
          callId: event.callId,
          requestId: requestIdValue,
        };
        this.emitCoreEvent(attempt, "tool.requested", {
          requestId: requestIdValue,
          toolName: event.toolName,
          summary: event.summary,
        });
        this.emitCoreEvent(attempt, "task.updated", {
          from: "running",
          to: "blocked",
          reason: "Tool result required",
        });
        this.emitCoreEvent(attempt, "worker.blocked", {
          reason: "tool",
        });
        this.emitSignal(attempt, {
          type: "blocked",
          reason: "tool",
          requestId: requestIdValue,
        });
        return;
      }
      case "tool-result-accepted": {
        const pendingTool = attempt.pendingTool;
        if (
          pendingTool === undefined ||
          pendingTool.callId !== event.callId ||
          pendingTool.resolution === undefined ||
          pendingTool.resolution.status !== event.status
        ) {
          return this.protocolStateFailure(
            attempt,
            "General Worker accepted an uncorrelated tool result",
          );
        }
        const result = pendingTool.resolution;
        this.emitCoreEvent(attempt, "tool.started", {
          requestId: pendingTool.requestId,
        });
        if (result.status === "succeeded") {
          this.emitCoreEvent(attempt, "tool.completed", {
            requestId: pendingTool.requestId,
            ...(result.summary === undefined ? {} : { summary: result.summary }),
          });
        } else if (result.status === "failed") {
          this.emitCoreEvent(attempt, "tool.failed", {
            requestId: pendingTool.requestId,
            errorCode: result.errorCode,
            message: result.message,
            mayHaveExecuted: result.mayHaveExecuted,
          });
        } else {
          this.emitCoreEvent(attempt, "tool.failed", {
            requestId: pendingTool.requestId,
            errorCode: "tool-cancelled",
            message: result.reason ?? "Tool execution cancelled",
            mayHaveExecuted: false,
          });
        }
        attempt.acceptedToolResult = result;
        attempt.pendingTool = undefined;
        return;
      }
      case "resumed":
        if (attempt.acceptedToolResult?.status !== "succeeded") {
          return this.protocolStateFailure(
            attempt,
            "General Worker resumed without a successful tool result",
          );
        }
        this.requireTaskState(attempt, "blocked");
        this.emitCoreEvent(attempt, "task.updated", {
          from: "blocked",
          to: "running",
          reason: "Tool result accepted",
        });
        attempt.acceptedToolResult = undefined;
        this.emitSignal(attempt, { type: "resumed" });
        return;
      case "completed":
        this.requireTaskState(attempt, "running");
        this.emitCoreEvent(attempt, "task.completed", {
          from: "running",
          to: "completed",
        });
        attempt.terminal = true;
        this.emitSignal(attempt, { type: "completed" });
        return;
      case "failed": {
        const taskState = this.requireActiveTask(attempt);
        const accepted = attempt.acceptedToolResult;
        if (
          accepted !== undefined &&
          accepted.status === "failed" &&
          (accepted.errorCode !== event.errorCode || accepted.message !== event.message)
        ) {
          return this.protocolStateFailure(
            attempt,
            "General Worker failure conflicts with the accepted tool result",
          );
        }
        this.emitCoreEvent(attempt, "task.failed", {
          from: taskState,
          to: "failed",
          errorCode: event.errorCode,
          message: event.message,
        });
        attempt.acceptedToolResult = undefined;
        attempt.terminal = true;
        this.emitSignal(attempt, {
          type: "failed",
          errorCode: event.errorCode,
          message: event.message,
        });
        return;
      }
      case "cancelled": {
        const taskState = this.requireActiveTask(attempt);
        const accepted = attempt.acceptedToolResult;
        if (accepted !== undefined && accepted.status !== "cancelled") {
          return this.protocolStateFailure(
            attempt,
            "General Worker cancellation conflicts with the accepted tool result",
          );
        }
        const reason =
          accepted?.status === "cancelled" ? (accepted.reason ?? event.reason) : event.reason;
        this.emitCoreEvent(attempt, "task.cancelled", {
          from: taskState,
          to: "cancelled",
          ...(reason === undefined ? {} : { reason }),
        });
        attempt.acceptedToolResult = undefined;
        attempt.terminal = true;
        this.emitSignal(attempt, {
          type: "cancelled",
          ...(reason === undefined ? {} : { reason }),
        });
        return;
      }
    }
  }

  private emitCoreEvent<Type extends CoreEventType>(
    attempt: ProcessAttempt,
    type: Type,
    payload: EventPayloadByType[Type],
  ): CoreEvent<Type> {
    const occurredAt = this.now();
    const generatedEventId = this.newEventId();
    if (attempt.eventIds.has(generatedEventId)) {
      throw new GeneralWorkerProcessError(
        "operation-failed",
        "General Worker event identifier factory returned a duplicate",
      );
    }
    const event = {
      schemaVersion: 1,
      eventId: generatedEventId,
      streamId: attempt.request.streamId,
      sequence: (attempt.coreState.previous?.sequence ?? 0) + 1,
      occurredAt,
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
    attempt: ProcessAttempt,
    signal:
      | { readonly type: "ready" }
      | { readonly type: "heartbeat" }
      | { readonly type: "core-event"; readonly event: CoreEvent }
      | {
          readonly type: "blocked";
          readonly reason: "tool";
          readonly requestId: ToolRequestId;
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
    const value = {
      protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
      sequence: attempt.nextControlSequence,
      occurredAt: this.now(),
      sessionId: attempt.request.sessionId,
      workerId: attempt.request.workerId,
      ...signal,
    } as AgentSignal;
    assertAgentSignal(value);
    attempt.nextControlSequence += 1;
    for (const handler of Array.from(this.subscribers.get(attempt.request.sessionId) ?? [])) {
      try {
        handler(value);
      } catch {
        // A subscriber fault must not corrupt protocol state or starve peers.
      }
    }
  }

  private protocolStateFailure(attempt: ProcessAttempt, message: string): void {
    this.emitProtocolError(attempt, "invalid-signal", message);
    this.fail(new GeneralWorkerProcessError("invalid-message", message));
  }

  private emitProtocolFailure(
    code:
      | "incompatible-protocol"
      | "invalid-signal"
      | "signal-identity-mismatch"
      | "signal-sequence-gap",
    message: string,
  ): void {
    for (const attempt of this.attempts.values()) {
      if (!attempt.terminal && !attempt.disposed) {
        this.emitProtocolError(attempt, code, message);
      }
    }
    this.fail(new GeneralWorkerProcessError("invalid-message", message));
  }

  private emitProtocolError(
    attempt: ProcessAttempt,
    code:
      | "incompatible-protocol"
      | "invalid-signal"
      | "signal-identity-mismatch"
      | "signal-sequence-gap",
    message: string,
  ): void {
    if (attempt.terminal || attempt.disposed) {
      return;
    }
    attempt.terminal = true;
    this.emitSignal(attempt, {
      type: "protocol-error",
      errorCode: code,
      message,
    });
  }

  private handleExit(code: number): void {
    if (this.closed) {
      return;
    }
    if (this.closing) {
      for (const [requestId, pending] of this.pending) {
        if (pending.operation === "close") {
          clearTimeout(pending.timeout);
          this.pending.delete(requestId);
          pending.resolve();
        }
      }
      this.closed = true;
      this.cleanupListeners();
      return;
    }
    if (!this.failed) {
      for (const attempt of this.attempts.values()) {
        if (attempt.terminal || attempt.disposed) {
          continue;
        }
        const state = attempt.coreState.taskState;
        if (state === "running") {
          this.emitCoreEvent(attempt, "task.updated", {
            from: "running",
            to: "blocked",
            reason: "General Worker process exited",
          });
        }
        if (attempt.coreState.taskState === "blocked") {
          this.emitCoreEvent(attempt, "worker.failed", {
            errorCode: "worker-process-exit",
            message: "The General Worker process exited unexpectedly.",
            retryable: true,
          });
          attempt.terminal = true;
          this.emitSignal(attempt, {
            type: "crashed",
            errorCode: "worker-process-exit",
            message: "The General Worker process exited unexpectedly.",
            retryable: true,
          });
        } else {
          this.emitProtocolError(
            attempt,
            "invalid-signal",
            "General Worker exited before establishing an active task",
          );
        }
      }
    }
    this.fail(
      new GeneralWorkerProcessError(
        "unavailable",
        `General Worker process exited with code ${code}`,
      ),
      false,
    );
  }

  private fail(error: Error, kill = true): void {
    if (this.failed || this.closed) {
      return;
    }
    this.failed = true;
    this.clearStartupTimer();
    if (!this.receivedReady) {
      this.rejectStartup(error);
    } else {
      for (const attempt of this.attempts.values()) {
        if (!attempt.terminal && !attempt.disposed) {
          this.emitProtocolError(
            attempt,
            "invalid-signal",
            "General Worker process protocol became unavailable",
          );
        }
      }
    }
    this.rejectPending(error);
    this.cleanupListeners();
    if (kill) {
      this.transport.kill();
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cleanupListeners(): void {
    if (this.listenersCleaned) {
      return;
    }
    this.listenersCleaned = true;
    this.unsubscribeMessage();
    this.unsubscribeError();
    this.unsubscribeExit();
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private assertAvailable(): void {
    if (!this.connected || this.failed || this.closed) {
      throw new GeneralWorkerProcessError("unavailable", "General Worker process is unavailable");
    }
  }

  private requireAttempt(session: SessionId): ProcessAttempt {
    const attempt = this.attempts.get(session);
    if (attempt === undefined) {
      throw new AgentAdapterError("unknown-session", `Unknown General Worker session ${session}`);
    }
    return attempt;
  }

  private requireActiveTask(attempt: ProcessAttempt): Extract<TaskState, "running" | "blocked"> {
    const state = attempt.coreState.taskState;
    if (state !== "running" && state !== "blocked") {
      throw new GeneralWorkerProcessError(
        "invalid-message",
        "General Worker event requires an active task",
      );
    }
    return state;
  }

  private requireTaskState(
    attempt: ProcessAttempt,
    expected: Extract<TaskState, "running" | "blocked">,
  ): void {
    if (attempt.coreState.taskState !== expected) {
      throw new GeneralWorkerProcessError(
        "invalid-message",
        `General Worker event requires task state ${expected}`,
      );
    }
  }

  private now(): Instant {
    const value = this.clock.now();
    instant(value);
    return value;
  }
}

export { ADAPTER_KIND as GENERAL_WORKER_ADAPTER_KIND };
