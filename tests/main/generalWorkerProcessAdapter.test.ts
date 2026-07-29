import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventId,
  instant,
  toolOutputReference,
  toolRequestId,
  type AgentCapabilities,
  type EventId,
} from "../../apps/desktop/src/core";
import {
  AgentAdapterSupervisor,
  type AgentAdapterSupervisorConfig,
} from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  GeneralWorkerProcessAdapter,
} from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { GENERAL_WORKER_PROTOCOL_VERSION } from "../../apps/desktop/src/shared/generalWorkerProtocol";
import { createAgentStartRequest, FIXTURE_AGENT_SESSION_ID } from "../fixtures/agentAdapter";
import { LoopbackGeneralWorkerTransport, openTestGeneralWorker } from "../fixtures/generalWorker";

const SUPERVISOR_CONFIG = {
  expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
  requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 0,
} as const satisfies AgentAdapterSupervisorConfig;

function clock(): DeterministicAgentClock {
  return new DeterministicAgentClock(instant("2026-07-30T02:00:00.000Z"));
}

function deterministicEventIds(): () => EventId {
  let sequence = 0;
  return () => {
    sequence += 1;
    return eventId(`general-worker-event-${sequence}`);
  };
}

async function settledSnapshot(
  supervisor: AgentAdapterSupervisor,
  state: "completed" | "cancelled" | "crashed" | "protocol-failed",
) {
  await vi.waitFor(() => {
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state,
      disposed: true,
    });
  });
  return supervisor.snapshot(FIXTURE_AGENT_SESSION_ID);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("General Worker process AgentAdapter v2", () => {
  it("negotiates exact capabilities and completes one no-tool process journey", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "no-tool-complete",
      newAttemptToken: () => "general-worker-attempt",
      newEventId: deterministicEventIds(),
    });
    const capabilities = await adapter.capabilities();
    expect(capabilities).toEqual({
      protocolVersion: 2,
      adapterKind: GENERAL_WORKER_ADAPTER_KIND,
      capabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      maxConcurrentSessions: 1,
      heartbeatIntervalMs: 1_000,
    } satisfies AgentCapabilities);
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);

    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    await settledSnapshot(supervisor, "completed");
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "agent.message",
      "task.completed",
    ]);
    await adapter.close();
    expect(transport.killCount).toBeGreaterThanOrEqual(1);
  });

  it("maps one typed tool result without giving the worker raw content", async () => {
    const agentClock = clock();
    const requestIdValue = toolRequestId("general-worker-tool-request");
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "tool-fixture",
      newAttemptToken: () => "general-worker-tool-attempt",
      newToolRequestId: () => requestIdValue,
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("blocked");
    expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBe(requestIdValue);
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "task.updated",
      "worker.blocked",
    ]);

    agentClock.advance(10);
    await supervisor.resolveTool(requestIdValue, {
      requestId: requestIdValue,
      status: "succeeded",
      startedAt: agentClock.now(),
      completedAt: agentClock.now(),
      outputRef: toolOutputReference("general-worker-tool-output"),
      summary: "Created one bounded output reference.",
    });
    await settledSnapshot(supervisor, "completed");
    expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBeUndefined();
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "task.updated",
      "worker.blocked",
      "tool.started",
      "tool.completed",
      "task.updated",
      "task.completed",
    ]);
  });

  it("acknowledges cancellation through the real process protocol", async () => {
    const agentClock = clock();
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-cancel-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("running");
    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "User stopped the task");
    await settledSnapshot(supervisor, "cancelled");
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).at(-1)).toMatchObject({
      type: "task.cancelled",
      payload: { reason: "User stopped the task" },
    });
  });

  it("isolates a throwing signal subscriber and continues peer delivery", async () => {
    const agentClock = clock();
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-subscriber-attempt",
      newEventId: deterministicEventIds(),
    });
    const peerSignals: string[] = [];
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, () => {
      throw new Error("Subscriber fixture failed");
    });
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => {
      peerSignals.push(signal.type);
    });

    await adapter.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    await vi.waitFor(() => {
      expect(peerSignals).toEqual(["ready", "core-event"]);
    });
    await adapter.close();
  });

  it("treats an exit during the close handshake as expected cleanup", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-close-attempt",
      newEventId: deterministicEventIds(),
    });
    const signals: string[] = [];
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => {
      signals.push(signal.type);
    });
    await adapter.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    await vi.waitFor(() => {
      expect(signals).toEqual(["ready", "core-event"]);
    });

    transport.dropNextResponse();
    const closing = adapter.close();
    transport.crash(0);
    await expect(closing).resolves.toBeUndefined();
    expect(signals).toEqual(["ready", "core-event"]);
  });

  it("maps an unexpected process exit to a retryable worker crash", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-crash-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    transport.crash(9);
    const snapshot = await settledSnapshot(supervisor, "crashed");
    expect(snapshot.incident).toBeUndefined();
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "task.updated",
      "worker.failed",
    ]);
  });

  it("fails closed on stale attempt identity and wire sequence gaps", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-sequence-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "stale-attempt",
      sequence: 2,
      event: { type: "heartbeat" },
    });
    const stale = await settledSnapshot(supervisor, "protocol-failed");
    expect(stale.incident?.code).toBe("signal-identity-mismatch");

    const secondClock = clock();
    const opened = await openTestGeneralWorker(secondClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-gap-attempt",
      newEventId: deterministicEventIds(),
    });
    const secondSupervisor = new AgentAdapterSupervisor(
      opened.adapter,
      secondClock,
      SUPERVISOR_CONFIG,
    );
    await secondSupervisor.start(createAgentStartRequest({ startedAt: secondClock.now() }));
    opened.transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "general-worker-gap-attempt",
      sequence: 3,
      event: { type: "heartbeat" },
    });
    const gap = await settledSnapshot(secondSupervisor, "protocol-failed");
    expect(gap.incident?.code).toBe("signal-sequence-gap");
  });

  it("fails closed on a malformed active-process message", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-malformed-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "general-worker-malformed-attempt",
      sequence: 2,
      event: {
        type: "shell",
        command: "whoami",
      },
    });
    const snapshot = await settledSnapshot(supervisor, "protocol-failed");
    expect(snapshot.incident?.code).toBe("invalid-signal");
    expect(transport.killCount).toBeGreaterThanOrEqual(1);
  });

  it("times out an unacknowledged process request and cleans up", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      requestTimeoutMs: 10,
      executionMode: "hold",
      newAttemptToken: () => "general-worker-timeout-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    vi.useFakeTimers();
    transport.dropNextResponse();
    const starting = supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    const rejection = expect(starting).rejects.toMatchObject({
      name: "AgentAdapterError",
      code: "adapter-operation-failed",
    });
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    await vi.waitFor(() => {
      expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
        state: "protocol-failed",
        disposed: true,
      });
    });
    expect(transport.killCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects incompatible startup and times out missing negotiation", async () => {
    const incompatible = new LoopbackGeneralWorkerTransport();
    const incompatibleConnection = GeneralWorkerProcessAdapter.connect(incompatible, clock());
    incompatible.start({
      protocolVersion: 2,
      type: "ready",
      role: "general-worker",
      implementationVersion: "0.1.0",
      capabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      maxConcurrentAttempts: 1,
      heartbeatIntervalMs: 1_000,
    });
    await expect(incompatibleConnection).rejects.toMatchObject({
      message: expect.stringMatching(/protocol version 1/),
    });

    vi.useFakeTimers();
    const silent = new LoopbackGeneralWorkerTransport();
    const timedOut = GeneralWorkerProcessAdapter.connect(silent, clock(), {
      startupTimeoutMs: 10,
    });
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({
      name: "GeneralWorkerProcessError",
      code: "startup-timeout",
    });
    await vi.advanceTimersByTimeAsync(11);
    await timeoutExpectation;
    expect(silent.killCount).toBeGreaterThanOrEqual(1);
  });
});
