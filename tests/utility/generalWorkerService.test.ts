import { describe, expect, it } from "vitest";
import { instant, toolOutputReference, toolRequestId } from "../../apps/desktop/src/core";
import {
  GENERAL_WORKER_PROTOCOL_VERSION,
  type GeneralWorkerRequest,
} from "../../apps/desktop/src/shared/generalWorkerProtocol";
import { GeneralWorkerService } from "../../apps/desktop/src/utility/worker/generalWorkerService";

function request<Operation extends GeneralWorkerRequest["operation"]>(
  operation: Operation,
  payload: Extract<GeneralWorkerRequest, { operation: Operation }>["payload"],
): Extract<GeneralWorkerRequest, { operation: Operation }> {
  return {
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "request",
    requestId: `request-${operation}`,
    operation,
    payload,
  } as Extract<GeneralWorkerRequest, { operation: Operation }>;
}

describe("General Worker utility service", () => {
  it("completes the deterministic no-tool journey with gapless worker events", async () => {
    const service = new GeneralWorkerService();
    const messages = await service.handle(
      request("start", {
        attemptToken: "attempt-no-tool",
        prompt: "Complete without tools.",
        entryState: "ready",
        executionMode: "no-tool-complete",
      }),
    );

    expect(messages).toMatchObject([
      { type: "response", operation: "start", ok: true },
      { type: "event", sequence: 1, event: { type: "started" } },
      { type: "event", sequence: 2, event: { type: "message" } },
      { type: "event", sequence: 3, event: { type: "completed" } },
    ]);
  });

  it("accepts one correlated typed tool result and then completes", async () => {
    const service = new GeneralWorkerService();
    const started = await service.handle(
      request("start", {
        attemptToken: "attempt-tool",
        prompt: "Exercise the typed tool-result protocol.",
        entryState: "ready",
        executionMode: "tool-fixture",
      }),
    );
    expect(started).toMatchObject([
      { type: "response", ok: true },
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "tool-requested",
          callId: "general-worker-tool-call",
        },
      },
    ]);

    const resolved = await service.handle(
      request("resolve-tool", {
        attemptToken: "attempt-tool",
        callId: "general-worker-tool-call",
        result: {
          requestId: toolRequestId("tool-request-service"),
          status: "succeeded",
          startedAt: instant("2026-07-30T01:00:00.000Z"),
          completedAt: instant("2026-07-30T01:00:01.000Z"),
          outputRef: toolOutputReference("tool-output-service"),
        },
      }),
    );
    expect(resolved).toMatchObject([
      { type: "response", ok: true },
      {
        type: "event",
        sequence: 3,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 4, event: { type: "resumed" } },
      { type: "event", sequence: 5, event: { type: "completed" } },
    ]);
  });

  it("acknowledges cancellation and rejects stale attempt tokens", async () => {
    const service = new GeneralWorkerService();
    await service.handle(
      request("start", {
        attemptToken: "attempt-hold",
        prompt: "Wait for cancellation.",
        entryState: "ready",
        executionMode: "hold",
      }),
    );
    await expect(
      service.handle(
        request("cancel", {
          attemptToken: "attempt-hold",
          reason: "User cancelled",
        }),
      ),
    ).resolves.toMatchObject([
      { type: "response", ok: true },
      {
        type: "event",
        sequence: 2,
        event: { type: "cancelled", reason: "User cancelled" },
      },
    ]);
    await expect(
      service.handle(
        request("send", {
          attemptToken: "attempt-unknown",
          content: "stale",
        }),
      ),
    ).resolves.toMatchObject([
      {
        type: "response",
        ok: false,
        error: { code: "unknown-attempt" },
      },
    ]);
  });

  it("never reuses a utility process for a second attempt", async () => {
    const service = new GeneralWorkerService();
    await service.handle(
      request("start", {
        attemptToken: "attempt-first",
        prompt: "Hold the one process-owned attempt.",
        entryState: "ready",
        executionMode: "hold",
      }),
    );
    await service.handle(
      request("dispose", {
        attemptToken: "attempt-first",
      }),
    );

    await expect(
      service.handle(
        request("start", {
          attemptToken: "attempt-second",
          prompt: "A fresh attempt needs a fresh process.",
          entryState: "ready",
          executionMode: "hold",
        }),
      ),
    ).resolves.toMatchObject([
      {
        type: "response",
        ok: false,
        error: { code: "duplicate-attempt" },
      },
    ]);
  });

  it("rejects malformed messages instead of returning a partial response", async () => {
    const service = new GeneralWorkerService();
    await expect(
      service.handle({
        ...request("start", {
          attemptToken: "attempt-malformed",
          prompt: "No",
          entryState: "ready",
          executionMode: "hold",
        }),
        shell: "whoami",
      }),
    ).rejects.toThrow(/shell/);
  });
});
