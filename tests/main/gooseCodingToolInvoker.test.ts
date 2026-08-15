import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CODING_FILE_READ_TOOL_ID,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  instant,
  sessionId,
  taskId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ContentReferenceOwner,
  type StoreContentReferenceInput,
} from "../../apps/desktop/src/core";
import { createGooseCodingToolInvoker } from "../../apps/desktop/src/main/workers/gooseCodingToolInvoker";

const now = instant("2026-08-15T00:00:00.000Z");

function metadata(input: StoreContentReferenceInput) {
  return Object.freeze({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: input.reference,
    kind: input.kind,
    owner: input.owner,
    classification: input.classification,
    mediaType: input.mediaType,
    byteLength: Buffer.byteLength(input.content, "utf8"),
    sha256: createHash("sha256").update(input.content, "utf8").digest("hex"),
    createdAt: input.createdAt,
  });
}

describe("Goose coding tool output budget", () => {
  it("fails the tool call when normalized output exceeds the Worker output budget", async () => {
    const ids = {
      workspaceId: workspaceId("workspace-goose-output-budget"),
      taskId: taskId("task-goose-output-budget"),
      sessionId: sessionId("session-goose-output-budget"),
      workerId: workerId("worker-goose-output-budget"),
      requestId: toolRequestId("request-goose-output-budget"),
      inputRef: toolInputReference("input-goose-output-budget"),
      outputRef: toolOutputReference("output-goose-output-budget"),
      grantId: workspaceGrantId("grant-goose-output-budget"),
    };
    const owner: ContentReferenceOwner = Object.freeze({
      workspaceId: ids.workspaceId,
      taskId: ids.taskId,
      sessionId: ids.sessionId,
      workerId: ids.workerId,
      requestId: ids.requestId,
      grantId: ids.grantId,
    });
    const oversizedOutput = JSON.stringify({
      contractVersion: 1,
      type: "file-read",
      relativePath: "answer.txt",
      content: "x".repeat(256 * 1024),
    });
    const recordFailed = vi.fn(async () => undefined);
    const invokeTool = createGooseCodingToolInvoker({
      persistence: {
        async storeContentReference(input: StoreContentReferenceInput) {
          return Object.freeze({ status: "stored" as const, metadata: metadata(input) });
        },
        async resolveContentReference() {
          return Object.freeze({
            metadata: Object.freeze({
              contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
              reference: ids.outputRef,
              kind: "tool-output" as const,
              owner,
              classification: "task-content" as const,
              mediaType: "text/plain; charset=utf-8" as const,
              byteLength: Buffer.byteLength(oversizedOutput, "utf8"),
              sha256: createHash("sha256").update(oversizedOutput, "utf8").digest("hex"),
              createdAt: now,
            }),
            content: oversizedOutput,
          });
        },
      } as never,
      clock: { now: () => now },
      session: {
        grant: Object.freeze({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          grantId: ids.grantId,
          workspaceId: ids.workspaceId,
          rootPath: path.join("/tmp", "actestra-output-budget-worktree"),
          displayName: "output budget worktree",
          state: "active" as const,
          createdAt: now,
          updatedAt: now,
        }),
        worktreeRoot: path.join("/tmp", "actestra-output-budget-worktree"),
        toolGateway: {
          async invoke() {
            return Object.freeze({
              status: "executed" as const,
              result: Object.freeze({ outputRef: ids.outputRef }),
            });
          },
        },
      } as never,
      taskId: ids.taskId,
      sessionId: ids.sessionId,
      workerId: ids.workerId,
      evidenceRecorder: {
        recordRequested: vi.fn(async () => undefined),
        recordApprovalRequired: vi.fn(async () => undefined),
        recordApprovalResolved: vi.fn(async () => undefined),
        recordCompleted: vi.fn(async () => undefined),
        recordFailed,
      },
      newToolRequestId: () => ids.requestId,
      newToolInputReference: () => ids.inputRef,
    });

    await expect(
      invokeTool({
        sessionId: "goose-session-output-budget",
        toolCallRequestId: "tool-call-output-budget",
        toolId: CODING_FILE_READ_TOOL_ID,
        input: Object.freeze({ contractVersion: 1, relativePath: "answer.txt" }),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      name: "GooseCodingToolInvokerError",
      code: "persistence-failed",
    });
    expect(recordFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: "worker-resource-output-exceeded",
        mayHaveExecuted: true,
      }),
    );
  });
});
