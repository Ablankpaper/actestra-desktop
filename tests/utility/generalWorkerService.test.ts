import { describe, expect, it } from "vitest";
import {
  TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  instant,
  toolOutputReference,
  toolRequestId,
} from "../../apps/desktop/src/core";
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

  it("does not register an attempt when the writing brief cannot be parsed", async () => {
    const service = new GeneralWorkerService();
    const rejected = await service.handle(
      request("start", {
        attemptToken: "attempt-invalid-writing-artifact",
        prompt: "Draft an unstructured document.",
        entryState: "ready",
        executionMode: "writing-artifact-fixture",
      }),
    );

    expect(rejected).toMatchObject([
      {
        type: "response",
        operation: "start",
        ok: false,
      },
    ]);

    const accepted = await service.handle(
      request("start", {
        attemptToken: "attempt-valid-writing-artifact",
        prompt: [
          "Title: Quarterly launch note",
          "Audience: Product leadership",
          "Purpose: Explain the approved launch sequence.",
          "Point: Start with the verified customer outcome.",
        ].join("\n"),
        entryState: "ready",
        executionMode: "writing-artifact-fixture",
      }),
    );

    expect(accepted).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      { type: "event", sequence: 2, event: { type: "message" } },
      { type: "event", sequence: 3, event: { type: "tool-requested" } },
      { type: "response", operation: "start", ok: true },
    ]);
  });

  it("turns the persisted writing brief into one private draft input without a workspace read", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-writing-artifact";
    const prompt = [
      "Title: Quarterly launch note",
      "Audience: Product leadership",
      "Purpose: Explain the approved launch sequence.",
      "Point: Start with the verified customer outcome.",
      "Point: Close with the bounded next step.",
    ].join("\n");
    const started = await service.handle(
      request("start", {
        attemptToken,
        prompt,
        entryState: "ready",
        executionMode: "writing-artifact-fixture",
      }),
    );

    expect(started).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "message",
          role: "assistant",
          content: "Prepared a writing draft from 2 ordered points.",
        },
      },
      {
        type: "event",
        sequence: 3,
        event: {
          type: "tool-requested",
          callId: "general-worker-task-output-write-text-call",
          toolName: "actestra.task-output.write-text",
          summary: "Create the bounded writing draft.",
          input: {
            contractVersion: 1,
            relativePath: "draft.md",
            mediaType: "text/markdown; charset=utf-8",
            content:
              "# Quarterly launch note\n\n" +
              "Audience: Product leadership\n\n" +
              "Explain the approved launch sequence.\n\n" +
              "Start with the verified customer outcome.\n\n" +
              "Close with the bounded next step.\n",
          },
        },
      },
      { type: "response", operation: "start", ok: true },
    ]);
    expect(started).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ toolName: "actestra.workspace.read-text" }),
        }),
      ]),
    );

    const written = await service.handle(
      request("resolve-tool", {
        attemptToken,
        callId: "general-worker-task-output-write-text-call",
        result: {
          requestId: toolRequestId("tool-request-writing-write"),
          status: "succeeded",
          startedAt: instant("2026-07-30T01:00:02.000Z"),
          completedAt: instant("2026-07-30T01:00:03.000Z"),
          outputRef: toolOutputReference("tool-output-writing-write"),
        },
      }),
    );
    expect(written).toMatchObject([
      {
        type: "event",
        sequence: 4,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 5, event: { type: "resumed" } },
      { type: "event", sequence: 6, event: { type: "completed" } },
      { type: "response", operation: "resolve-tool", ok: true },
    ]);
  });

  it("requests one Main-owned model completion and converts only its bounded text into a draft", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-model-writing-artifact";
    const prompt = "Write a reviewable launch note from the admitted Team task.";

    const started = await service.handle(
      request("start", {
        attemptToken,
        prompt,
        entryState: "ready",
        executionMode: "model-writing-artifact",
      }),
    );
    expect(started).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "model-requested",
          callId: "general-worker-model-writing-call",
          prompt,
        },
      },
      { type: "response", operation: "start", ok: true },
    ]);

    const resolved = await service.handle(
      request("resolve-model", {
        attemptToken,
        callId: "general-worker-model-writing-call",
        result: {
          status: "succeeded",
          // The model replies with the draft envelope; only its markdown reaches the artifact.
          content: JSON.stringify({
            status: "completed",
            markdown: "# Launch note\n\nReady for human review.\n",
          }),
        },
      }),
    );
    expect(resolved).toMatchObject([
      {
        type: "event",
        sequence: 3,
        event: {
          type: "message",
          role: "assistant",
          content: "Prepared one bounded model-authored writing draft.",
        },
      },
      {
        type: "event",
        sequence: 4,
        event: {
          type: "tool-requested",
          callId: "general-worker-task-output-write-text-call",
          toolName: "actestra.task-output.write-text",
          input: {
            contractVersion: 1,
            relativePath: "draft.md",
            mediaType: "text/markdown; charset=utf-8",
            content: "# Launch note\n\nReady for human review.\n",
          },
        },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);
  });

  it("repairs one malformed reply without quoting it back, then accepts the corrected draft", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-model-writing-repair";
    await service.handle(
      request("start", {
        attemptToken,
        prompt: "Write a reviewable launch note.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
      }),
    );

    const malformed = "Sure! Here is the draft: SENTINEL-MALFORMED-BODY";
    const repaired = await service.handle(
      request("resolve-model", {
        attemptToken,
        callId: "general-worker-model-writing-call",
        result: { status: "succeeded", content: malformed },
      }),
    );
    expect(repaired).toMatchObject([
      {
        type: "event",
        sequence: 3,
        event: {
          type: "message",
          role: "system",
          content: "The draft did not satisfy the contract (not-json). Requesting one repair.",
        },
      },
      {
        type: "event",
        sequence: 4,
        event: { type: "model-requested", callId: "general-worker-model-writing-repair-call" },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);
    // Spec C: the retry states the broken rule and nothing else. Echoing the reply back invites the
    // model to repeat it, and the reply may carry the very prose the contract just rejected.
    expect(JSON.stringify(repaired)).not.toContain("SENTINEL-MALFORMED-BODY");

    const accepted = await service.handle(
      request("resolve-model", {
        attemptToken,
        callId: "general-worker-model-writing-repair-call",
        result: {
          status: "succeeded",
          content: JSON.stringify({
            status: "completed",
            markdown: "# Launch note\n\nRepaired for human review.\n",
          }),
        },
      }),
    );
    // One repair is enough to reach the artifact, so a single malformed reply does not lose the work.
    expect(accepted).toMatchObject([
      { type: "event", sequence: 5, event: { type: "message", role: "assistant" } },
      {
        type: "event",
        sequence: 6,
        event: {
          type: "tool-requested",
          toolName: "actestra.task-output.write-text",
          input: {
            relativePath: "draft.md",
            content: "# Launch note\n\nRepaired for human review.\n",
          },
        },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);
  });

  it("spends exactly one repair on malformed JSON and then reports general-output-invalid", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-model-writing-malformed";
    await service.handle(
      request("start", {
        attemptToken,
        prompt: "Write a reviewable launch note.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
      }),
    );

    const repaired = await service.handle(
      request("resolve-model", {
        attemptToken,
        callId: "general-worker-model-writing-call",
        result: { status: "succeeded", content: "not a draft envelope at all" },
      }),
    );
    expect(repaired).toMatchObject([
      { type: "event", event: { type: "message", role: "system" } },
      {
        type: "event",
        event: { type: "model-requested", callId: "general-worker-model-writing-repair-call" },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);

    const exhausted = await service.handle(
      request("resolve-model", {
        attemptToken,
        callId: "general-worker-model-writing-repair-call",
        result: { status: "succeeded", content: "still not a draft envelope" },
      }),
    );
    // Spec F4: a malformed shape is an output-contract fault, so it keeps its own code rather than
    // borrowing the placeholder verdict or collapsing into the lifecycle code invalid-state.
    expect(exhausted).toMatchObject([
      {
        type: "event",
        sequence: 5,
        event: { type: "failed", errorCode: "general-output-invalid" },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);
    const serialized = JSON.stringify(exhausted);
    expect(serialized).not.toContain("model-requested");
    expect(serialized).not.toContain("draft.md");
    expect(serialized).not.toContain("invalid-state");
  });

  it("fails a persistent placeholder draft instead of writing one, once the repair is spent", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-model-writing-placeholder";
    await service.handle(
      request("start", {
        attemptToken,
        prompt: "Write the quarterly brief.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
      }),
    );

    const placeholderDraft = JSON.stringify({
      status: "completed",
      markdown: "# Quarterly brief\n\nRevenue: [TBD]\n",
    });
    await expect(
      service.handle(
        request("resolve-model", {
          attemptToken,
          callId: "general-worker-model-writing-call",
          result: { status: "succeeded", content: placeholderDraft },
        }),
      ),
    ).resolves.toMatchObject([
      {
        type: "event",
        event: {
          type: "message",
          content:
            "The draft did not satisfy the contract (placeholder-in-markdown). Requesting one repair.",
        },
      },
      { type: "event", event: { type: "model-requested" } },
      { type: "response", ok: true },
    ]);

    const exhausted = await service.handle(
      request("resolve-model", {
        attemptToken,
        callId: "general-worker-model-writing-repair-call",
        result: { status: "succeeded", content: placeholderDraft },
      }),
    );
    // Spec C bounds the repair at one. A draft written around a gap is the outcome this contract
    // exists to stop, so the attempt fails with the rule it broke rather than shipping the gap.
    expect(exhausted).toMatchObject([
      {
        type: "event",
        sequence: 5,
        event: { type: "failed", errorCode: "general-instruction-noncompliant" },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);
    // No second repair, and above all no artifact carrying the placeholder.
    const serialized = JSON.stringify(exhausted);
    expect(serialized).not.toContain("model-requested");
    expect(serialized).not.toContain("draft.md");
    expect(serialized).not.toContain("TBD");
  });

  it("fails closed on an unavailable or uncorrelated Main model result", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-model-failure";
    await service.handle(
      request("start", {
        attemptToken,
        prompt: "Write a bounded draft.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
      }),
    );

    await expect(
      service.handle(
        request("resolve-model", {
          attemptToken,
          callId: "wrong-model-call",
          result: {
            status: "succeeded",
            content: "must not be accepted",
          },
        }),
      ),
    ).resolves.toMatchObject([
      { type: "response", operation: "resolve-model", ok: false, error: { code: "invalid-state" } },
    ]);

    await expect(
      service.handle(
        request("resolve-model", {
          attemptToken,
          callId: "general-worker-model-writing-call",
          result: {
            status: "failed",
            errorCode: "model-unavailable",
            message: "The admitted model is unavailable.",
          },
        }),
      ),
    ).resolves.toMatchObject([
      {
        type: "event",
        sequence: 3,
        event: {
          type: "failed",
          errorCode: "model-unavailable",
          message: "The admitted model is unavailable.",
        },
      },
      { type: "response", operation: "resolve-model", ok: true },
    ]);
  });

  it("rejects ordinary input while the one bounded model request is pending", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-model-pending";
    await service.handle(
      request("start", {
        attemptToken,
        prompt: "Wait for the Main model result.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
      }),
    );

    await expect(
      service.handle(
        request("send", {
          attemptToken,
          content: "Do not interleave ordinary input.",
        }),
      ),
    ).resolves.toMatchObject([
      { type: "response", operation: "send", ok: false, error: { code: "invalid-state" } },
    ]);
  });

  it("turns the persisted Office brief into one private Word-document model without a workspace read", async () => {
    const service = new GeneralWorkerService();
    const attemptToken = "attempt-office-document-artifact";
    const prompt = [
      "Document: Quarterly operating brief",
      "Owner: Product operations",
      "Summary: Record the approved launch decision in a portable Word document.",
      "Section: Decision | Ship the verified desktop workflow.",
      "Section: Evidence | Include the exact acceptance boundary.",
    ].join("\n");
    const started = await service.handle(
      request("start", {
        attemptToken,
        prompt,
        entryState: "ready",
        executionMode: "office-document-artifact-fixture",
      }),
    );

    expect(started).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: {
          type: "message",
          role: "assistant",
          content: "Prepared a Word document with 2 structured sections.",
        },
      },
      {
        type: "event",
        sequence: 3,
        event: {
          type: "tool-requested",
          callId: "general-worker-task-output-write-office-document-call",
          toolName: TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
          summary: "Create the bounded Word document.",
          input: {
            contractVersion: 1,
            relativePath: "brief.docx",
            document: {
              contractVersion: 1,
              title: "Quarterly operating brief",
              owner: "Product operations",
              summary: "Record the approved launch decision in a portable Word document.",
              sections: [
                {
                  heading: "Decision",
                  body: "Ship the verified desktop workflow.",
                },
                {
                  heading: "Evidence",
                  body: "Include the exact acceptance boundary.",
                },
              ],
            },
          },
        },
      },
      { type: "response", operation: "start", ok: true },
    ]);
    expect(started).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({ toolName: "actestra.workspace.read-text" }),
        }),
      ]),
    );

    const written = await service.handle(
      request("resolve-tool", {
        attemptToken,
        callId: "general-worker-task-output-write-office-document-call",
        result: {
          requestId: toolRequestId("tool-request-office-write"),
          status: "succeeded",
          startedAt: instant("2026-07-30T01:00:02.000Z"),
          completedAt: instant("2026-07-30T01:00:03.000Z"),
          outputRef: toolOutputReference("tool-output-office-write"),
        },
      }),
    );
    expect(written).toMatchObject([
      {
        type: "event",
        sequence: 4,
        event: { type: "tool-result-accepted", status: "succeeded" },
      },
      { type: "event", sequence: 5, event: { type: "resumed" } },
      { type: "event", sequence: 6, event: { type: "completed" } },
      { type: "response", operation: "resolve-tool", ok: true },
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

  it("refuses a task needing a file before any model turn, so nothing invents the content", async () => {
    const service = new GeneralWorkerService();
    const events = await service.handle(
      request("start", {
        attemptToken: "attempt-input-required",
        prompt: "Summarise the README.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
        requirements: {
          contractVersion: 1,
          capabilities: ["text-generation"],
          contextReferences: ["inline-text"],
          inputRequirements: ["file-reference"],
          completionCriteria: "json-envelope",
        },
      }),
    );

    expect(events).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: { type: "failed", errorCode: "general-input-required" },
      },
      { type: "response", operation: "start", ok: true },
    ]);
    // The decisive assertion: admission ran instead of a model turn.
    expect(JSON.stringify(events)).not.toContain("model-requested");
  });

  it("reports a capability mismatch when the task needs an ability General does not have", async () => {
    const service = new GeneralWorkerService();
    const events = await service.handle(
      request("start", {
        attemptToken: "attempt-capability-mismatch",
        prompt: "Fetch the changelog and rewrite it.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
        requirements: {
          contractVersion: 1,
          capabilities: ["network-fetch"],
          contextReferences: ["inline-text"],
          inputRequirements: ["none"],
          completionCriteria: "json-envelope",
        },
      }),
    );

    expect(events).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      {
        type: "event",
        sequence: 2,
        event: { type: "failed", errorCode: "general-capability-mismatch" },
      },
      { type: "response", operation: "start", ok: true },
    ]);
    expect(JSON.stringify(events)).not.toContain("model-requested");
  });

  it("admits a text-only writing task, so admission does not block ordinary work", async () => {
    const service = new GeneralWorkerService();
    const events = await service.handle(
      request("start", {
        attemptToken: "attempt-admitted",
        prompt: "Draft a launch note from the brief below.",
        entryState: "ready",
        executionMode: "model-writing-artifact",
        requirements: {
          contractVersion: 1,
          capabilities: ["text-generation"],
          contextReferences: ["inline-text"],
          inputRequirements: ["bounded-text"],
          completionCriteria: "json-envelope",
        },
      }),
    );

    expect(events).toMatchObject([
      { type: "event", sequence: 1, event: { type: "started" } },
      { type: "event", sequence: 2, event: { type: "model-requested" } },
      { type: "response", operation: "start", ok: true },
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
