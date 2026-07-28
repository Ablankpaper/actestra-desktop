import { describe, expect, it } from "vitest";
import {
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  assertAgentAttemptEvidence,
  correlationId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type AgentAttemptEvidence,
} from "../../apps/desktop/src/core";

function createEvidence(overrides: Partial<AgentAttemptEvidence> = {}): AgentAttemptEvidence {
  return {
    contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
    redaction: "metadata",
    workspaceId: workspaceId("workspace-platform"),
    taskId: taskId("task-platform"),
    correlationId: correlationId("correlation-platform"),
    sessionId: sessionId("session-platform"),
    workerId: workerId("worker-platform"),
    streamId: eventStreamId("stream-platform"),
    state: "completed",
    taskState: "completed",
    startedAt: instant("2026-07-28T09:00:00.000Z"),
    lastSignalAt: instant("2026-07-28T09:00:01.000Z"),
    lastControlSequence: 3,
    lastCoreEventSequence: 2,
    restartCount: 0,
    disposed: true,
    forcedCancellation: false,
    ...overrides,
  };
}

describe("platform evidence contract", () => {
  it("accepts closed metadata-only terminal attempt evidence", () => {
    const evidence = createEvidence({
      state: "timed-out",
      taskState: "running",
      incident: {
        code: "heartbeat-timeout",
        occurredAt: instant("2026-07-28T09:00:02.000Z"),
      },
    });

    expect(() => assertAgentAttemptEvidence(evidence)).not.toThrow();
  });

  it("rejects active attempts and arbitrary incident messages", () => {
    expect(() =>
      assertAgentAttemptEvidence({
        ...createEvidence(),
        state: "running",
      }),
    ).toThrow(/terminal/i);
    expect(() =>
      assertAgentAttemptEvidence({
        ...createEvidence(),
        incident: {
          code: "worker-failed",
          occurredAt: instant("2026-07-28T09:00:02.000Z"),
          message: "must not persist",
        },
      }),
    ).toThrow(/unsupported field message/i);
  });

  it("rejects unsupported fields and inconsistent restart evidence", () => {
    expect(() =>
      assertAgentAttemptEvidence({
        ...createEvidence(),
        prompt: "not metadata",
      }),
    ).toThrow(/unsupported field prompt/i);
    expect(() =>
      assertAgentAttemptEvidence({
        ...createEvidence(),
        restartCount: 1,
      }),
    ).toThrow(/restart/i);
  });
});
