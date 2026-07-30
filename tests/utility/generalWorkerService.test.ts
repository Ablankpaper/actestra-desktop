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
      { type: "event", sequence: 1, event: { type: "started" } },
      { type: "event", sequence: 2, event: { type: "message" } },
      { type: "event", sequence: 3, event: { type: "completed" } },
      { type: "response", operation: "start", ok: true },
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
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "tool-requested",
          callId: "general-worker-tool-call",
        },
      },
      { type: "response", operation: "start", ok: true },
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
      {
        type: "event",
        sequence: 3,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 4, event: { type: "resumed" } },
      { type: "event", sequence: 5, event: { type: "completed" } },
      { type: "response", ok: true },
    ]);
  });

  it("reads workspace text, processes it privately, then requests one create-only artifact", async () => {
    const service = new GeneralWorkerService();
    const started = await service.handle(
      request("start", {
        attemptToken: "attempt-file-journey",
        prompt: "Turn the reserved workspace text into a reviewable Markdown artifact.",
        entryState: "ready",
        executionMode: "workspace-read-then-task-output-write-fixture",
      }),
    );
    expect(started).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "tool-requested",
          callId: "general-worker-workspace-read-text-call",
          toolName: "actestra.workspace.read-text",
        },
      },
      { type: "response", operation: "start", ok: true },
    ]);

    const readResolved = await service.handle(
      request("resolve-tool", {
        attemptToken: "attempt-file-journey",
        callId: "general-worker-workspace-read-text-call",
        result: {
          requestId: toolRequestId("tool-request-file-read"),
          status: "succeeded",
          startedAt: instant("2026-07-30T01:00:00.000Z"),
          completedAt: instant("2026-07-30T01:00:01.000Z"),
          outputRef: toolOutputReference("tool-output-file-read"),
        },
      }),
    );
    expect(readResolved).toMatchObject([
      {
        type: "event",
        sequence: 3,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 4, event: { type: "resumed" } },
      { type: "response", operation: "resolve-tool", ok: true },
    ]);
    expect(readResolved).not.toEqual(
      expect.arrayContaining([{ type: "event", event: { type: "completed" } }]),
    );

    const processed = await service.handle(
      request("send", {
        attemptToken: "attempt-file-journey",
        content: "Alpha\nBeta\n",
      }),
    );
    expect(processed).toMatchObject([
      { type: "event", sequence: 5, event: { type: "heartbeat" } },
      {
        type: "event",
        sequence: 6,
        event: {
          type: "message",
          role: "assistant",
          content: "Processed 11 bytes from the reserved workspace text.",
        },
      },
      {
        type: "event",
        sequence: 7,
        event: {
          type: "tool-requested",
          callId: "general-worker-task-output-write-text-call",
          toolName: "actestra.task-output.write-text",
          input: {
            contractVersion: 1,
            relativePath: "result.md",
            mediaType: "text/markdown; charset=utf-8",
            content:
              "# Actestra file result\n\n" +
              "Instruction: Turn the reserved workspace text into a reviewable Markdown artifact.\n\n" +
              "Source text:\n\nAlpha\nBeta\n",
          },
        },
      },
      { type: "response", operation: "send", ok: true },
    ]);

    const written = await service.handle(
      request("resolve-tool", {
        attemptToken: "attempt-file-journey",
        callId: "general-worker-task-output-write-text-call",
        result: {
          requestId: toolRequestId("tool-request-file-write"),
          status: "succeeded",
          startedAt: instant("2026-07-30T01:00:02.000Z"),
          completedAt: instant("2026-07-30T01:00:03.000Z"),
          outputRef: toolOutputReference("tool-output-file-write"),
        },
      }),
    );
    expect(written).toMatchObject([
      {
        type: "event",
        sequence: 8,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 9, event: { type: "resumed" } },
      { type: "event", sequence: 10, event: { type: "completed" } },
      { type: "response", operation: "resolve-tool", ok: true },
    ]);
  });

  it("turns one bounded local research source into a private research artifact input", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-local-research";
    const prompt = "Compare the approved local source notes.";
    const started = await service.handle({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "request",
      requestId: "request-local-research-start",
      operation: "start",
      payload: {
        attemptToken,
        prompt,
        entryState: "ready",
        executionMode: "local-research-artifact-fixture",
      },
    });
    expect(started).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "tool-requested",
          callId: "general-worker-workspace-read-text-call",
          toolName: "actestra.workspace.read-text",
          summary: "Read the bounded local research source.",
        },
      },
      { type: "response", operation: "start", ok: true },
    ]);

    const readResolved = await service.handle(
      request("resolve-tool", {
        attemptToken,
        callId: "general-worker-workspace-read-text-call",
        result: {
          requestId: toolRequestId("tool-request-local-research-read"),
          status: "succeeded",
          startedAt: instant("2026-07-30T01:00:00.000Z"),
          completedAt: instant("2026-07-30T01:00:01.000Z"),
          outputRef: toolOutputReference("tool-output-local-research-read"),
        },
      }),
    );
    expect(readResolved).toMatchObject([
      {
        type: "event",
        sequence: 3,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 4, event: { type: "resumed" } },
      { type: "response", operation: "resolve-tool", ok: true },
    ]);

    const processed = await service.handle(
      request("send", {
        attemptToken,
        content: "Alpha evidence\nBeta evidence\n",
      }),
    );
    expect(processed).toMatchObject([
      { type: "event", sequence: 5, event: { type: "heartbeat" } },
      {
        type: "event",
        sequence: 6,
        event: {
          type: "message",
          role: "assistant",
          content: "Prepared a local research brief from 29 bytes and 2 evidence notes.",
        },
      },
      {
        type: "event",
        sequence: 7,
        event: {
          type: "tool-requested",
          callId: "general-worker-task-output-write-text-call",
          toolName: "actestra.task-output.write-text",
          summary: "Create the bounded local research brief.",
          input: {
            contractVersion: 1,
            relativePath: "research.md",
            mediaType: "text/markdown; charset=utf-8",
            content:
              "# Actestra local research brief\n\n" +
              `Instruction: ${prompt}\n\n` +
              "## Evidence notes\n\n" +
              "- Alpha evidence\n" +
              "- Beta evidence\n",
          },
        },
      },
      { type: "response", operation: "send", ok: true },
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
      {
        type: "event",
        sequence: 2,
        event: { type: "cancelled", reason: "User cancelled" },
      },
      { type: "response", ok: true },
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
