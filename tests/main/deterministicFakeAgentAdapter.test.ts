import { describe, expect, it } from "vitest";
import {
  approvalId,
  eventStreamId,
  instant,
  sessionId,
  toolRequestId,
  workerId,
  type AgentApprovalDecisionKind,
  type AgentSignal,
  type CoreEvent,
} from "../../apps/desktop/src/core";
import {
  DeterministicAgentClock,
  DeterministicFakeAgentAdapter,
} from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import {
  createAgentInput,
  createAgentStartRequest,
  createApprovalDecision,
  FIXTURE_AGENT_APPROVAL_ID,
  FIXTURE_AGENT_REQUEST_ID,
  FIXTURE_AGENT_SESSION_ID,
} from "../fixtures/agentAdapter";

function coreEvents(signals: readonly AgentSignal[]): readonly CoreEvent[] {
  return signals
    .filter((signal): signal is Extract<AgentSignal, { type: "core-event" }> => {
      return signal.type === "core-event";
    })
    .map(({ event }) => event);
}

describe("deterministic fake AgentAdapter", () => {
  it("publishes a deterministic ready, message, heartbeat, and completion lifecycle", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const signals: AgentSignal[] = [];

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [{ type: "heartbeat" }, { type: "complete" }],
    });
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => signals.push(signal));

    await adapter.start(createAgentStartRequest());
    await adapter.send(FIXTURE_AGENT_SESSION_ID, createAgentInput());
    clock.advance(1_000);
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);
    clock.advance(1_000);
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    expect(signals.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(signals.map(({ type }) => type)).toEqual([
      "ready",
      "core-event",
      "core-event",
      "heartbeat",
      "core-event",
      "completed",
    ]);
    expect(coreEvents(signals).map(({ sequence, type }) => [sequence, type])).toEqual([
      [1, "task.started"],
      [2, "agent.message"],
      [3, "task.completed"],
    ]);
    expect(coreEvents(signals)[1]?.payload).toEqual({
      role: "assistant",
      content: "Echo: Continue with the next deterministic step.",
    });
  });

  it.each([
    ["approved", "resumed", "task.updated"],
    ["denied", "failed", "task.failed"],
    ["expired", "failed", "task.failed"],
    ["cancelled", "cancelled", "task.cancelled"],
  ] as const)(
    "reconciles an %s approval decision without executing the referenced tool",
    async (decision, terminalSignal, terminalEvent) => {
      const suffix = decision;
      const testSessionId = sessionId(`session-approval-${suffix}`);
      const requestId = toolRequestId(`request-approval-${suffix}`);
      const testApprovalId = approvalId(`approval-${suffix}`);
      const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
      const adapter = new DeterministicFakeAgentAdapter(clock);
      const signals: AgentSignal[] = [];

      adapter.registerPlan(testSessionId, {
        steps: [
          {
            type: "approval",
            requestId,
            approvalId: testApprovalId,
            action: "Reference a protected write without performing it",
          },
        ],
      });
      adapter.subscribe(testSessionId, (signal) => signals.push(signal));
      await adapter.start(
        createAgentStartRequest({
          sessionId: testSessionId,
          workerId: workerId(`worker-approval-${suffix}`),
          streamId: eventStreamId(`stream-approval-${suffix}`),
        }),
      );
      await adapter.advance(testSessionId);
      await adapter.approve(
        requestId,
        createApprovalDecision(decision as AgentApprovalDecisionKind, {
          approvalId: testApprovalId,
        }),
      );

      const events = coreEvents(signals);
      expect(events.slice(1, 5).map(({ type }) => type)).toEqual([
        "tool.requested",
        "approval.required",
        "task.updated",
        "worker.blocked",
      ]);
      expect(signals.some(({ type }) => type === "blocked")).toBe(true);
      expect(signals.at(-1)?.type).toBe(terminalSignal);
      expect(events.at(-1)?.type).toBe(terminalEvent);
      expect(events.some(({ type }) => type === "tool.started")).toBe(false);
    },
  );

  it("acknowledges cancellation once and keeps dispose outcome-neutral", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const signals: AgentSignal[] = [];

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, { steps: [] });
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => signals.push(signal));
    await adapter.start(createAgentStartRequest());
    await adapter.cancel(FIXTURE_AGENT_SESSION_ID, "User stopped the attempt");
    await adapter.cancel(FIXTURE_AGENT_SESSION_ID, "Duplicate cancellation");
    await adapter.dispose(FIXTURE_AGENT_SESSION_ID);

    expect(coreEvents(signals).map(({ type }) => type)).toEqual(["task.started", "task.cancelled"]);
    expect(signals.filter(({ type }) => type === "cancelled")).toHaveLength(1);
    expect(signals.at(-1)?.type).toBe("cancelled");
    expect(adapter.isDisposed(FIXTURE_AGENT_SESSION_ID)).toBe(true);
  });

  it("does not consume a planned step when the current lifecycle state rejects it", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const signals: AgentSignal[] = [];

    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [
        {
          type: "approval",
          requestId: FIXTURE_AGENT_REQUEST_ID,
          approvalId: FIXTURE_AGENT_APPROVAL_ID,
          action: "Wait for a decision before completion",
        },
        { type: "complete" },
      ],
    });
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => signals.push(signal));
    await adapter.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    await expect(adapter.advance(FIXTURE_AGENT_SESSION_ID)).rejects.toMatchObject({
      code: "invalid-state",
    });
    await adapter.approve(FIXTURE_AGENT_REQUEST_ID, createApprovalDecision("approved"));
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    expect(signals.at(-1)?.type).toBe("completed");
  });

  it("closes a crash attempt in blocked state without fabricating task failure", async () => {
    const clock = new DeterministicAgentClock(instant("2026-07-28T08:00:00.000Z"));
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const signals: AgentSignal[] = [];

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
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => signals.push(signal));
    await adapter.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    expect(coreEvents(signals).map(({ type }) => type)).toEqual([
      "task.started",
      "task.updated",
      "worker.failed",
    ]);
    expect(coreEvents(signals)[1]?.payload).toMatchObject({
      from: "running",
      to: "blocked",
    });
    expect(signals.at(-1)?.type).toBe("crashed");
    expect(coreEvents(signals).some(({ type }) => type === "task.failed")).toBe(false);
  });
});
