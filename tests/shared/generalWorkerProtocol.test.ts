import { describe, expect, it } from "vitest";
import { instant, toolOutputReference, toolRequestId } from "../../apps/desktop/src/core";
import {
  GENERAL_WORKER_PROTOCOL_VERSION,
  MAX_GENERAL_WORKER_PROMPT_BYTES,
  assertGeneralWorkerMessage,
  assertGeneralWorkerRequest,
  createGeneralWorkerReadyMessage,
} from "../../apps/desktop/src/shared/generalWorkerProtocol";

function startRequest() {
  return {
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "request",
    requestId: "worker-request-1",
    operation: "start",
    payload: {
      attemptToken: "attempt-1",
      prompt: "Complete the deterministic no-tool fixture.",
      entryState: "ready",
      executionMode: "no-tool-complete",
    },
  } as const;
}

describe("General Worker process protocol", () => {
  it("accepts the exact version, identity, and closed capability manifest", () => {
    expect(() => assertGeneralWorkerMessage(createGeneralWorkerReadyMessage())).not.toThrow();
    expect(() =>
      assertGeneralWorkerMessage({
        ...createGeneralWorkerReadyMessage(),
        protocolVersion: 2,
      }),
    ).toThrow(/protocol version 1/);
    expect(() =>
      assertGeneralWorkerMessage({
        ...createGeneralWorkerReadyMessage(),
        capabilities: ["messages", "cancellation", "heartbeats", "shell"],
      }),
    ).toThrow(/capabilities/);
  });

  it("rejects undeclared authority fields and oversized prompts", () => {
    expect(() => assertGeneralWorkerRequest(startRequest())).not.toThrow();
    expect(() =>
      assertGeneralWorkerRequest({
        ...startRequest(),
        payload: {
          ...startRequest().payload,
          workspaceRoot: "/private/workspace",
        },
      }),
    ).toThrow(/workspaceRoot/);
    expect(() =>
      assertGeneralWorkerRequest({
        ...startRequest(),
        payload: {
          ...startRequest().payload,
          prompt: "x".repeat(MAX_GENERAL_WORKER_PROMPT_BYTES + 1),
        },
      }),
    ).toThrow(/bounded string/);
  });

  it("validates typed tool results with opaque output references only", () => {
    expect(() =>
      assertGeneralWorkerRequest({
        protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
        type: "request",
        requestId: "worker-request-tool",
        operation: "resolve-tool",
        payload: {
          attemptToken: "attempt-tool",
          callId: "call-tool",
          result: {
            requestId: toolRequestId("tool-request-1"),
            status: "succeeded",
            startedAt: instant("2026-07-30T01:00:00.000Z"),
            completedAt: instant("2026-07-30T01:00:01.000Z"),
            outputRef: toolOutputReference("tool-output-1"),
            summary: "Created one bounded output.",
          },
        },
      }),
    ).not.toThrow();

    expect(() =>
      assertGeneralWorkerRequest({
        protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
        type: "request",
        requestId: "worker-request-tool",
        operation: "resolve-tool",
        payload: {
          attemptToken: "attempt-tool",
          callId: "call-tool",
          result: {
            requestId: toolRequestId("tool-request-1"),
            status: "succeeded",
            startedAt: instant("2026-07-30T01:00:00.000Z"),
            completedAt: instant("2026-07-30T01:00:01.000Z"),
            outputRef: toolOutputReference("tool-output-1"),
            content: "raw content must not cross",
          },
        },
      }),
    ).toThrow(/content/);
  });

  it("accepts gap-candidate worker events but rejects unknown event shapes", () => {
    expect(() =>
      assertGeneralWorkerMessage({
        protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
        type: "event",
        attemptToken: "attempt-1",
        sequence: 1,
        event: {
          type: "started",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertGeneralWorkerMessage({
        protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
        type: "event",
        attemptToken: "attempt-1",
        sequence: 1,
        event: {
          type: "shell",
          command: "whoami",
        },
      }),
    ).toThrow(/unsupported/);
  });
});
