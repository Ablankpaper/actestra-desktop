import { describe, expect, it } from "vitest";
import {
  AGENT_ADAPTER_PROTOCOL_VERSION,
  AgentAdapterError,
  assertAgentCapabilities,
  assertAgentSignal,
  assertAgentStartRequest,
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
  capabilities: ["messages", "approvals", "cancellation", "heartbeats"],
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
          protocolVersion: 2,
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
  });
});
