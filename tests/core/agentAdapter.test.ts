import { describe, expect, it } from "vitest";
import {
  AGENT_ADAPTER_PROTOCOL_VERSION,
  AgentAdapterError,
  assertAgentCapabilities,
  assertAgentSignal,
  assertAgentStartRequest,
  assertAgentToolResult,
  instant,
  toolOutputReference,
  toolRequestId,
  type AgentAdapterErrorCode,
  type AgentCapabilities,
} from "../../apps/desktop/src/core";
import {
  createAgentStartRequest,
  FIXTURE_AGENT_SESSION_ID,
  FIXTURE_AGENT_START_TIME,
  FIXTURE_AGENT_WORKER_ID,
} from "../fixtures/agentAdapter";

const CAPABILITIES = {
  protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
  adapterKind: "deterministic-fake",
  capabilities: ["messages", "approvals", "cancellation", "heartbeats", "tool-results"],
  maxConcurrentSessions: 1,
  heartbeatIntervalMs: 1_000,
} as const satisfies AgentCapabilities;

function expectAdapterError(operation: () => unknown, code: AgentAdapterErrorCode): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentAdapterError);
    expect((error as AgentAdapterError).code).toBe(code);
    return;
  }

  throw new Error(`Expected AgentAdapterError with code ${code}`);
}

describe("AgentAdapter protocol contract", () => {
  it("accepts one exact, closed capability declaration", () => {
    expect(() => assertAgentCapabilities(CAPABILITIES)).not.toThrow();

    expectAdapterError(
      () =>
        assertAgentCapabilities({
          ...CAPABILITIES,
          protocolVersion: 1,
        }),
      "incompatible-protocol",
    );

    expectAdapterError(
      () =>
        assertAgentCapabilities({
          ...CAPABILITIES,
          protocolVersion: "1",
        }),
      "invalid-capabilities",
    );

    expectAdapterError(
      () =>
        assertAgentCapabilities({
          ...CAPABILITIES,
          capabilities: [...CAPABILITIES.capabilities, "shell"],
        }),
      "unsupported-capability",
    );

    expectAdapterError(
      () =>
        assertAgentCapabilities({
          ...CAPABILITIES,
          capabilities: ["messages", "messages"],
        }),
      "invalid-capabilities",
    );
  });

  it("validates immutable start identity and rejects extra authority fields", () => {
    expect(() => assertAgentStartRequest(createAgentStartRequest())).not.toThrow();

    expectAdapterError(
      () =>
        assertAgentStartRequest({
          ...createAgentStartRequest(),
          credential: "must-not-cross-the-adapter-boundary",
        }),
      "invalid-request",
    );

    expectAdapterError(
      () =>
        assertAgentStartRequest({
          ...createAgentStartRequest(),
          taskState: "running",
        }),
      "invalid-request",
    );
  });

  it("accepts only versioned, gap-candidate control signals with known shapes", () => {
    expect(() =>
      assertAgentSignal({
        protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
        sequence: 1,
        occurredAt: FIXTURE_AGENT_START_TIME,
        sessionId: FIXTURE_AGENT_SESSION_ID,
        workerId: FIXTURE_AGENT_WORKER_ID,
        type: "ready",
      }),
    ).not.toThrow();

    expectAdapterError(
      () =>
        assertAgentSignal({
          protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
          sequence: 1,
          occurredAt: FIXTURE_AGENT_START_TIME,
          sessionId: FIXTURE_AGENT_SESSION_ID,
          workerId: FIXTURE_AGENT_WORKER_ID,
          type: "telemetry",
        }),
      "invalid-signal",
    );

    expectAdapterError(
      () =>
        assertAgentSignal({
          protocolVersion: "1",
          sequence: 1,
          occurredAt: FIXTURE_AGENT_START_TIME,
          sessionId: FIXTURE_AGENT_SESSION_ID,
          workerId: FIXTURE_AGENT_WORKER_ID,
          type: "ready",
        }),
      "invalid-signal",
    );

    expectAdapterError(
      () =>
        assertAgentSignal({
          protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
          sequence: 0,
          occurredAt: FIXTURE_AGENT_START_TIME,
          sessionId: FIXTURE_AGENT_SESSION_ID,
          workerId: FIXTURE_AGENT_WORKER_ID,
          type: "heartbeat",
        }),
      "invalid-signal",
    );

    expect(() =>
      assertAgentSignal({
        protocolVersion: AGENT_ADAPTER_PROTOCOL_VERSION,
        sequence: 2,
        occurredAt: FIXTURE_AGENT_START_TIME,
        sessionId: FIXTURE_AGENT_SESSION_ID,
        workerId: FIXTURE_AGENT_WORKER_ID,
        type: "protocol-error",
        errorCode: "signal-time-regression",
        message: "Worker timestamps moved backwards.",
      }),
    ).not.toThrow();
  });

  it("accepts only bounded typed tool results with monotonic timestamps", () => {
    const result = {
      requestId: toolRequestId("tool-result-request"),
      status: "succeeded",
      startedAt: instant("2026-07-30T01:00:00.000Z"),
      completedAt: instant("2026-07-30T01:00:01.000Z"),
      outputRef: toolOutputReference("tool-result-output"),
      summary: "Created one output reference.",
    } as const;
    expect(() => assertAgentToolResult(result)).not.toThrow();
    expectAdapterError(
      () =>
        assertAgentToolResult({
          ...result,
          completedAt: instant("2026-07-30T00:59:59.000Z"),
        }),
      "invalid-request",
    );
    expectAdapterError(
      () =>
        assertAgentToolResult({
          ...result,
          rawContent: "must-not-cross",
        }),
      "invalid-request",
    );
  });
});
