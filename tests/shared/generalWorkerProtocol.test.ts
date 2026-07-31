import { describe, expect, it } from "vitest";
import {
  TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
  instant,
  toolOutputReference,
  toolRequestId,
} from "../../apps/desktop/src/core";
import {
  GENERAL_WORKER_PROTOCOL_VERSION,
  MAX_GENERAL_WORKER_MESSAGE_BYTES,
  MAX_GENERAL_WORKER_PRIVATE_TOOL_INPUT_BYTES,
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

function privateWriteInputWithSerializedBytes(targetBytes: number) {
  const input = {
    contractVersion: 1,
    relativePath: "result.md",
    mediaType: "text/markdown; charset=utf-8",
    content: "",
  } as const;
  const fixedBytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (targetBytes < fixedBytes) {
    throw new Error("Private Worker input target is smaller than its fixed envelope");
  }
  return {
    ...input,
    content: "x".repeat(targetBytes - fixedBytes),
  };
}

function privateWriteEvent(input: ReturnType<typeof privateWriteInputWithSerializedBytes>) {
  return {
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "event",
    attemptToken: "attempt-file-journey",
    sequence: 7,
    event: {
      type: "tool-requested",
      callId: "call-file-write",
      toolName: "actestra.task-output.write-text",
      summary: "Create the processed workspace-file artifact.",
      input,
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

  it("admits the closed writing-artifact execution mode", () => {
    expect(() =>
      assertGeneralWorkerRequest({
        ...startRequest(),
        payload: {
          ...startRequest().payload,
          prompt: [
            "Title: Quarterly launch note",
            "Audience: Product leadership",
            "Purpose: Explain the approved launch sequence.",
            "Point: Start with the verified customer outcome.",
          ].join("\n"),
          executionMode: "writing-artifact-fixture",
        },
      }),
    ).not.toThrow();
  });

  it("admits the closed Office-document execution mode", () => {
    expect(() =>
      assertGeneralWorkerRequest({
        ...startRequest(),
        payload: {
          ...startRequest().payload,
          prompt: [
            "Document: Quarterly operating brief",
            "Owner: Product operations",
            "Summary: Record the approved launch decision in a portable Word document.",
            "Section: Decision | Ship the verified desktop workflow.",
          ].join("\n"),
          executionMode: "office-document-artifact-fixture",
        },
      }),
    ).not.toThrow();
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

  it("admits only a bounded private task-output input on the matching Worker tool event", () => {
    const event = {
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "attempt-file-journey",
      sequence: 7,
      event: {
        type: "tool-requested",
        callId: "call-file-write",
        toolName: "actestra.task-output.write-text",
        summary: "Create the processed workspace-file artifact.",
        input: {
          contractVersion: 1,
          relativePath: "result.md",
          mediaType: "text/markdown; charset=utf-8",
          content: "# Actestra file result\n\nbounded output\n",
        },
      },
    } as const;

    expect(() => assertGeneralWorkerMessage(event)).not.toThrow();
    expect(() =>
      assertGeneralWorkerMessage({
        ...event,
        event: {
          ...event.event,
          toolName: "actestra.workspace.read-text",
        },
      }),
    ).toThrow(/input|write-text/u);
    expect(() =>
      assertGeneralWorkerMessage({
        ...event,
        event: {
          ...event.event,
          input: {
            ...event.event.input,
            relativePath: "../outside.md",
          },
        },
      }),
    ).toThrow(/path|input/u);
  });

  it("admits one bounded private Office-document model on its matching Worker tool event", () => {
    const event = {
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "attempt-office-journey",
      sequence: 3,
      event: {
        type: "tool-requested",
        callId: "call-office-write",
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
            ],
          },
        },
      },
    } as const;

    expect(() => assertGeneralWorkerMessage(event)).not.toThrow();
  });

  it("accepts a 128 KiB private tool input while retaining overall message headroom", () => {
    const input = privateWriteInputWithSerializedBytes(MAX_GENERAL_WORKER_PRIVATE_TOOL_INPUT_BYTES);
    const event = privateWriteEvent(input);

    expect(new TextEncoder().encode(JSON.stringify(input))).toHaveLength(
      MAX_GENERAL_WORKER_PRIVATE_TOOL_INPUT_BYTES,
    );
    expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThan(
      MAX_GENERAL_WORKER_MESSAGE_BYTES,
    );
    expect(() => assertGeneralWorkerMessage(event)).not.toThrow();
  });

  it("rejects a private tool input one byte above 128 KiB before the message limit", () => {
    const input = privateWriteInputWithSerializedBytes(
      MAX_GENERAL_WORKER_PRIVATE_TOOL_INPUT_BYTES + 1,
    );
    const event = privateWriteEvent(input);

    expect(new TextEncoder().encode(JSON.stringify(input))).toHaveLength(
      MAX_GENERAL_WORKER_PRIVATE_TOOL_INPUT_BYTES + 1,
    );
    expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThan(
      MAX_GENERAL_WORKER_MESSAGE_BYTES,
    );
    expect(() => assertGeneralWorkerMessage(event)).toThrow(/private tool input|131072/u);
  });
});
