import { describe, expect, it } from "vitest";
import {
  AGENT_ADAPTER_PROTOCOL_VERSION,
  AgentAdapterError,
  approvalId,
  eventStreamId,
  instant,
  sessionId,
  toolRequestId,
  workerId,
  type AgentAdapter,
  type AgentApprovalDecision,
  type AgentCapabilities,
  type AgentInput,
  type AgentSignal,
  type AgentStartRequest,
  type AgentToolResult,
  type CoreEvent,
  type CoreEventType,
  type EventPayloadByType,
  type SessionId,
  type ToolRequestId,
} from "../../apps/desktop/src/core";
import {
  AgentAdapterSupervisor,
  type AgentAdapterSupervisorConfig,
} from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import {
  DeterministicAgentClock,
  DeterministicFakeAgentAdapter,
} from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import {
  createAgentStartRequest,
  createApprovalDecision,
  FIXTURE_AGENT_APPROVAL_ID,
  FIXTURE_AGENT_REQUEST_ID,
  FIXTURE_AGENT_SESSION_ID,
} from "../fixtures/agentAdapter";
import { createEvent } from "../fixtures/core";

const SUPERVISOR_CONFIG = {
  expectedAdapterKind: "deterministic-fake",
  requiredCapabilities: ["messages", "approvals", "cancellation", "heartbeats", "tool-results"],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 1,
} as const satisfies AgentAdapterSupervisorConfig;

class ManualAgentAdapter implements AgentAdapter {
  readonly disposed = new Set<SessionId>();
  private readonly handlers = new Map<SessionId, Set<(signal: AgentSignal) => void>>();

  constructor(
    private readonly declaration: AgentCapabilities = {
      protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
      adapterKind: "deterministic-fake",
      capabilities: ["messages", "approvals", "cancellation", "heartbeats", "tool-results"],
      maxConcurrentSessions: 1,
      heartbeatIntervalMs: 1_000,
    },
  ) {}

  async capabilities(): Promise<AgentCapabilities> {
    return this.declaration;
  }

  async start(_request: AgentStartRequest): Promise<void> {}

  async send(_sessionId: SessionId, _input: AgentInput): Promise<void> {}

  async approve(_requestId: ToolRequestId, _decision: AgentApprovalDecision): Promise<void> {}

  async resolveTool(_requestId: ToolRequestId, _result: AgentToolResult): Promise<void> {}

  async cancel(_sessionId: SessionId, _reason?: string): Promise<void> {}

  subscribe(session: SessionId, handler: (signal: AgentSignal) => void): () => void {
    const handlers = this.handlers.get(session) ?? new Set();
    handlers.add(handler);
    this.handlers.set(session, handlers);

    return () => handlers.delete(handler);
  }

  async dispose(session: SessionId): Promise<void> {
    this.disposed.add(session);
  }

  emit(signal: AgentSignal): void {
    for (const handler of this.handlers.get(signal.sessionId) ?? []) {
      handler(signal);
    }
  }
}

function controlSignal(
  request: AgentStartRequest,
  sequence: number,
  type: "ready" | "heartbeat" | "completed",
): AgentSignal {
  return {
    protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
    sequence,
    occurredAt: request.startedAt,
    sessionId: request.sessionId,
    workerId: request.workerId,
    type,
  };
}

function attemptEvent<Type extends CoreEventType>(
  request: AgentStartRequest,
  sequence: number,
  type: Type,
  payload: EventPayloadByType[Type],
): CoreEvent<Type> {
  return createEvent(sequence, type, payload, {
    streamId: request.streamId,
    occurredAt: request.startedAt,
    workspaceId: request.workspaceId,
    taskId: request.taskId,
    sessionId: request.sessionId,
    workerId: request.workerId,
    correlationId: request.correlationId,
  } as Partial<CoreEvent<Type>>);
}

function coreSignal(request: AgentStartRequest, sequence: number, event: CoreEvent): AgentSignal {
  return {
    protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
    sequence,
    occurredAt: request.startedAt,
    sessionId: request.sessionId,
    workerId: request.workerId,
    type: "core-event",
    event,
  };
}

describe("AgentAdapterSupervisor", () => {
  it("fails closed when required capabilities are missing", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new ManualAgentAdapter({
      protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
      adapterKind: "deterministic-fake",
      capabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      maxConcurrentSessions: 1,
      heartbeatIntervalMs: 1_000,
    });
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);

    await expect(supervisor.start(createAgentStartRequest())).rejects.toMatchObject({
      name: "AgentAdapterError",
      code: "unsupported-capability",
    });
    expect(supervisor.listAttempts()).toEqual([]);
  });

  it("times out a silent startup and disposes the attempt", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      startMode: "silent",
      steps: [],
    });
    await supervisor.start(createAgentStartRequest());
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("starting");

    clock.advance(SUPERVISOR_CONFIG.startupTimeoutMs + 1);
    await supervisor.checkHealth();

    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state: "timed-out",
      disposed: true,
      incident: {
        code: "startup-timeout",
      },
    });
    expect(adapter.isDisposed(FIXTURE_AGENT_SESSION_ID)).toBe(true);
  });

  it("times out heartbeat silence and restarts with a fresh immutable attempt", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    const replacementSessionId = sessionId("session-agent-2");
    const competingSessionId = sessionId("session-agent-competing");

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, { steps: [] });
    await supervisor.start(createAgentStartRequest());
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("running");

    clock.advance(SUPERVISOR_CONFIG.heartbeatTimeoutMs + 1);
    await supervisor.checkHealth();
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("timed-out");

    adapter.registerPlan(replacementSessionId, { steps: [] });
    adapter.registerPlan(competingSessionId, { steps: [] });
    const replacement = createAgentStartRequest({
      sessionId: replacementSessionId,
      workerId: workerId("worker-agent-2"),
      streamId: eventStreamId("stream-agent-2"),
      taskState: "blocked",
      startedAt: clock.now(),
    });
    const pendingReplacement = supervisor.restart(FIXTURE_AGENT_SESSION_ID, replacement);
    await expect(
      supervisor.restart(
        FIXTURE_AGENT_SESSION_ID,
        createAgentStartRequest({
          sessionId: competingSessionId,
          workerId: workerId("worker-agent-competing"),
          streamId: eventStreamId("stream-agent-competing"),
          taskState: "blocked",
          startedAt: clock.now(),
        }),
      ),
    ).rejects.toMatchObject({
      code: "invalid-restart",
    });
    await pendingReplacement;

    expect(supervisor.snapshot(replacementSessionId)).toMatchObject({
      state: "running",
      restartCount: 1,
      restartedFromSessionId: FIXTURE_AGENT_SESSION_ID,
    });
    expect(supervisor.coreEvents(replacementSessionId)[0]).toMatchObject({
      type: "task.started",
      payload: {
        from: "blocked",
        to: "running",
      },
    });
    await expect(supervisor.restart(FIXTURE_AGENT_SESSION_ID, replacement)).rejects.toMatchObject({
      code: "invalid-restart",
    });
  });

  it("uses observed heartbeats to extend liveness without trusting real timers", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [{ type: "heartbeat" }],
    });
    await supervisor.start(createAgentStartRequest());

    clock.advance(SUPERVISOR_CONFIG.heartbeatTimeoutMs - 1);
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);
    clock.advance(SUPERVISOR_CONFIG.heartbeatTimeoutMs - 1);
    await supervisor.checkHealth();
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("running");

    clock.advance(2);
    await supervisor.checkHealth();
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).incident?.code).toBe("heartbeat-timeout");
  });

  it("bounds crash recovery and preserves the crashed stream as blocked", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    const replacementSessionId = sessionId("session-crash-2");

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [
        {
          type: "crash",
          errorCode: "worker-lost",
          message: "The deterministic worker disappeared.",
          retryable: true,
        },
      ],
    });
    await supervisor.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state: "crashed",
      taskState: "blocked",
      disposed: true,
    });
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map(({ type }) => type)).toEqual([
      "task.started",
      "task.updated",
      "worker.failed",
    ]);

    adapter.registerPlan(replacementSessionId, {
      steps: [
        {
          type: "crash",
          errorCode: "worker-lost-again",
          message: "The replacement disappeared.",
          retryable: true,
        },
      ],
    });
    await supervisor.restart(
      FIXTURE_AGENT_SESSION_ID,
      createAgentStartRequest({
        sessionId: replacementSessionId,
        workerId: workerId("worker-crash-2"),
        streamId: eventStreamId("stream-crash-2"),
        taskState: "blocked",
        startedAt: clock.now(),
      }),
    );
    await adapter.advance(replacementSessionId);

    await expect(
      supervisor.restart(
        replacementSessionId,
        createAgentStartRequest({
          sessionId: sessionId("session-crash-3"),
          workerId: workerId("worker-crash-3"),
          streamId: eventStreamId("stream-crash-3"),
          taskState: "blocked",
          startedAt: clock.now(),
        }),
      ),
    ).rejects.toMatchObject({
      name: "AgentAdapterError",
      code: "restart-limit",
    });
  });

  it("routes an approval reference back to the blocked attempt and resumes it", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [
        {
          type: "approval",
          requestId: FIXTURE_AGENT_REQUEST_ID,
          approvalId: FIXTURE_AGENT_APPROVAL_ID,
          action: "Reference a protected write without executing it",
        },
      ],
    });
    await supervisor.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("blocked");

    await supervisor.approve(FIXTURE_AGENT_REQUEST_ID, createApprovalDecision("approved"));

    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state: "running",
      taskState: "running",
    });
    expect(
      supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).some(({ type }) => type === "tool.started"),
    ).toBe(false);
  });

  it("force-disposes cancellation silence without rewriting it as a worker event", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      acknowledgeCancellation: false,
      steps: [],
    });
    await supervisor.start(createAgentStartRequest());
    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "User stopped the attempt");
    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "Duplicate cancellation");
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("cancelling");

    clock.advance(SUPERVISOR_CONFIG.cancellationTimeoutMs + 1);
    await supervisor.checkHealth();

    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state: "cancelled",
      forcedCancellation: true,
      disposed: true,
      incident: {
        code: "cancellation-ack-timeout",
      },
    });
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map(({ type }) => type)).toEqual([
      "task.started",
    ]);
  });

  it("reconciles an acknowledged cancellation exactly once", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, { steps: [] });
    await supervisor.start(createAgentStartRequest());
    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "User stopped the attempt");
    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "Duplicate cancellation");

    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state: "cancelled",
      forcedCancellation: false,
      disposed: true,
    });
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map(({ type }) => type)).toEqual([
      "task.started",
      "task.cancelled",
    ]);

    await supervisor.dispose(FIXTURE_AGENT_SESSION_ID);
    expect(supervisor.listAttempts()).toEqual([]);
    expect(() => supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID)).toThrowError(AgentAdapterError);
  });

  it("fails a malformed control sequence and immutable identity drift closed", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new ManualAgentAdapter();
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    const request = createAgentStartRequest();

    await supervisor.start(request);
    adapter.emit(controlSignal(request, 1, "ready"));
    adapter.emit(controlSignal(request, 3, "heartbeat"));

    expect(supervisor.snapshot(request.sessionId)).toMatchObject({
      state: "protocol-failed",
      disposed: true,
      incident: {
        code: "signal-sequence-gap",
      },
    });
    expect(adapter.disposed.has(request.sessionId)).toBe(true);

    const identityRequest = createAgentStartRequest({
      sessionId: sessionId("session-identity"),
      workerId: workerId("worker-identity"),
      streamId: eventStreamId("stream-identity"),
    });
    const identityAdapter = new ManualAgentAdapter();
    const identitySupervisor = new AgentAdapterSupervisor(
      identityAdapter,
      clock,
      SUPERVISOR_CONFIG,
    );
    await identitySupervisor.start(identityRequest);
    identityAdapter.emit({
      ...controlSignal(identityRequest, 1, "ready"),
      workerId: workerId("worker-impostor"),
    });

    expect(identitySupervisor.snapshot(identityRequest.sessionId).incident?.code).toBe(
      "signal-identity-mismatch",
    );
  });

  it("requires a matching terminal core event before terminal control", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new ManualAgentAdapter();
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    const request = createAgentStartRequest();

    await supervisor.start(request);
    adapter.emit(controlSignal(request, 1, "ready"));
    adapter.emit(controlSignal(request, 2, "completed"));

    expect(supervisor.snapshot(request.sessionId)).toMatchObject({
      state: "protocol-failed",
      incident: {
        code: "terminal-reconciliation-failed",
      },
    });
    expect(() => supervisor.snapshot(sessionId("unknown-session"))).toThrowError(AgentAdapterError);
  });

  it("rejects an approval block whose control references drift from its core events", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new ManualAgentAdapter();
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    const request = createAgentStartRequest();
    const expectedApprovalId = approvalId("approval-reference");
    const expectedRequestId = toolRequestId("request-reference");

    await supervisor.start(request);
    adapter.emit(controlSignal(request, 1, "ready"));
    adapter.emit(
      coreSignal(
        request,
        2,
        attemptEvent(request, 1, "task.started", {
          from: "ready",
          to: "running",
        }),
      ),
    );
    adapter.emit(
      coreSignal(
        request,
        3,
        attemptEvent(request, 2, "tool.requested", {
          requestId: expectedRequestId,
          toolName: "deterministic.reference",
          summary: "Reference a protected write",
          approvalId: expectedApprovalId,
        }),
      ),
    );
    adapter.emit(
      coreSignal(
        request,
        4,
        attemptEvent(request, 3, "approval.required", {
          approvalId: expectedApprovalId,
          action: "Reference a protected write",
        }),
      ),
    );
    adapter.emit(
      coreSignal(
        request,
        5,
        attemptEvent(request, 4, "task.updated", {
          from: "running",
          to: "blocked",
          reason: "Approval required",
        }),
      ),
    );
    adapter.emit(
      coreSignal(
        request,
        6,
        attemptEvent(request, 5, "worker.blocked", {
          reason: "approval",
          approvalId: expectedApprovalId,
        }),
      ),
    );
    adapter.emit({
      protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
      sequence: 7,
      occurredAt: request.startedAt,
      sessionId: request.sessionId,
      workerId: request.workerId,
      type: "blocked",
      reason: "approval",
      requestId: toolRequestId("request-impostor"),
      approvalId: expectedApprovalId,
    });

    expect(supervisor.snapshot(request.sessionId)).toMatchObject({
      state: "protocol-failed",
      incident: {
        code: "terminal-reconciliation-failed",
      },
    });
  });
});
