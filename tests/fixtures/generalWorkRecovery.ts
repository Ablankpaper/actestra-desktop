import {
  GENERAL_WORK_RECOVERY_CONTRACT_VERSION,
  TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
  artifactId,
  correlationId,
  instant,
  toolInputReference,
  toolRequestId,
  workspaceGrantId,
  type GeneralWorkCheckpoint,
} from "../../apps/desktop/src/core";
import {
  FIXTURE_SESSION_ID,
  FIXTURE_STREAM_ID,
  FIXTURE_TASK_ID,
  FIXTURE_WORKER_ID,
  FIXTURE_WORKSPACE_ID,
  createEvent,
  createStartedEvent,
} from "./core";

export const FIXTURE_GENERAL_WORK_REQUEST_ID = toolRequestId("request-general-work");
export const FIXTURE_GENERAL_WORK_INPUT_REF = toolInputReference("input-general-work");

export function createGeneralWorkCheckpoint(): GeneralWorkCheckpoint {
  const events = [
    createStartedEvent(),
    createEvent(2, "tool.requested", {
      requestId: FIXTURE_GENERAL_WORK_REQUEST_ID,
      toolName: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      summary: "Create one durable output.",
    }),
    createEvent(3, "task.updated", {
      from: "running",
      to: "blocked",
      reason: "Tool result required",
    }),
    createEvent(4, "worker.blocked", {
      reason: "tool",
    }),
  ] as const;
  return {
    contractVersion: GENERAL_WORK_RECOVERY_CONTRACT_VERSION,
    phase: "active",
    revision: 1,
    attempt: {
      workspaceId: FIXTURE_WORKSPACE_ID,
      taskId: FIXTURE_TASK_ID,
      correlationId: correlationId("correlation-primary"),
      sessionId: FIXTURE_SESSION_ID,
      workerId: FIXTURE_WORKER_ID,
      streamId: FIXTURE_STREAM_ID,
      state: "blocked",
      taskState: "blocked",
      startedAt: instant("2026-07-28T06:00:00.000Z"),
      lastSignalAt: instant("2026-07-28T06:00:04.000Z"),
      lastControlSequence: 6,
      lastCoreEventSequence: 4,
      restartCount: 0,
      disposed: false,
      forcedCancellation: false,
    },
    events,
    tool: {
      requestId: FIXTURE_GENERAL_WORK_REQUEST_ID,
      toolId: TASK_OUTPUT_WRITE_TEXT_TOOL_ID,
      inputRef: FIXTURE_GENERAL_WORK_INPUT_REF,
      state: "in-flight",
      startedAt: instant("2026-07-28T06:00:04.000Z"),
      mayHaveExecuted: true,
    },
    artifactIntent: {
      artifactId: artifactId("artifact-general-work"),
      kind: "file",
      label: "General-work output",
      grantId: workspaceGrantId("grant-general-work"),
    },
    createdAt: instant("2026-07-28T06:00:00.000Z"),
    updatedAt: instant("2026-07-28T06:00:04.000Z"),
  };
}
