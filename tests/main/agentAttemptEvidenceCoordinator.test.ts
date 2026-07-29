import { describe, expect, it } from "vitest";
import {
  AgentAdapterError,
  type AgentAttemptEvidence,
  type CoreEvent,
  type PersistEventResult,
} from "../../apps/desktop/src/core";
import { AgentAdapterSupervisor } from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import { AgentAttemptEvidenceCoordinator } from "../../apps/desktop/src/main/workers/agentAttemptEvidenceCoordinator";
import {
  DeterministicAgentClock,
  DeterministicFakeAgentAdapter,
} from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { createAgentStartRequest, FIXTURE_AGENT_SESSION_ID } from "../fixtures/agentAdapter";
import { PRIVILEGED_TIME } from "../fixtures/privilegedServices";

const SUPERVISOR_CONFIG = {
  expectedAdapterKind: "deterministic-fake",
  requiredCapabilities: ["messages", "approvals", "cancellation", "heartbeats", "tool-results"],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 1,
} as const;

class RecordingEvidenceStore {
  readonly order: string[] = [];
  readonly events: CoreEvent[] = [];
  readonly attempts: AgentAttemptEvidence[] = [];
  failAttempt = false;

  async appendEvent(event: CoreEvent): Promise<PersistEventResult> {
    this.order.push(`event:${String(event.sequence)}`);
    const duplicate = this.events.some((candidate) => candidate.eventId === event.eventId);
    if (!duplicate) {
      this.events.push(event);
    }
    return {
      status: duplicate ? "duplicate" : "appended",
    };
  }

  async appendAgentAttemptEvidence(evidence: AgentAttemptEvidence) {
    this.order.push("attempt");
    if (this.failAttempt) {
      throw new Error("evidence unavailable");
    }
    const duplicate = this.attempts.some((candidate) => candidate.sessionId === evidence.sessionId);
    if (!duplicate) {
      this.attempts.push(evidence);
    }
    return {
      status: duplicate ? ("duplicate" as const) : ("appended" as const),
    };
  }
}

function createHarness() {
  const clock = new DeterministicAgentClock(PRIVILEGED_TIME);
  const adapter = new DeterministicFakeAgentAdapter(clock);
  const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
  const store = new RecordingEvidenceStore();
  const coordinator = new AgentAttemptEvidenceCoordinator({
    supervisor,
    corePersistence: store,
    evidencePersistence: store,
  });
  return {
    adapter,
    supervisor,
    store,
    coordinator,
  };
}

describe("terminal agent attempt evidence release", () => {
  it("persists events then metadata evidence before releasing supervisor memory", async () => {
    const { adapter, supervisor, store, coordinator } = createHarness();
    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [{ type: "complete" }],
    });
    await supervisor.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    await expect(coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID)).resolves.toMatchObject({
      evidence: {
        state: "completed",
        redaction: "metadata",
        lastCoreEventSequence: 2,
      },
      evidenceResult: {
        status: "appended",
      },
    });
    expect(store.order).toEqual(["event:1", "event:2", "attempt"]);
    expect(JSON.stringify(store.attempts)).not.toContain("message");
    expect(supervisor.listAttempts()).toEqual([]);
  });

  it("retains terminal memory when evidence fails and permits an idempotent retry", async () => {
    const { adapter, supervisor, store, coordinator } = createHarness();
    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [{ type: "complete" }],
    });
    await supervisor.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);
    store.failAttempt = true;

    await expect(coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID)).rejects.toThrow(
      "evidence unavailable",
    );
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("completed");
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID)).toHaveLength(2);

    store.failAttempt = false;
    await expect(coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID)).resolves.toMatchObject({
      eventResults: [{ status: "duplicate" }, { status: "duplicate" }],
    });
    expect(supervisor.listAttempts()).toEqual([]);
  });

  it("coalesces concurrent releases for the same terminal attempt", async () => {
    const { adapter, supervisor, store, coordinator } = createHarness();
    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [{ type: "complete" }],
    });
    await supervisor.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    const [first, second] = await Promise.all([
      coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID),
      coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID),
    ]);

    expect(first).toBe(second);
    expect(store.order).toEqual(["event:1", "event:2", "attempt"]);
    expect(supervisor.listAttempts()).toEqual([]);
  });

  it("rejects release while an attempt is active", async () => {
    const { adapter, supervisor, coordinator } = createHarness();
    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [],
    });
    await supervisor.start(createAgentStartRequest());

    await expect(coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID)).rejects.toBeInstanceOf(
      AgentAdapterError,
    );
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("running");
  });
});
