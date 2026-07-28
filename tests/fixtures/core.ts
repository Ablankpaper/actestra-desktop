import {
  approvalId,
  artifactId,
  correlationId,
  eventId,
  eventStreamId,
  instant,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type CoreEvent,
  type CoreEventType,
  type DomainGraph,
  type EventPayloadByType,
} from "../../apps/desktop/src/core";

export const FIXTURE_WORKSPACE_ID = workspaceId("workspace-primary");
export const FIXTURE_TASK_ID = taskId("task-primary");
export const FIXTURE_WORKER_ID = workerId("worker-primary");
export const FIXTURE_SESSION_ID = sessionId("session-primary");
export const FIXTURE_STREAM_ID = eventStreamId("stream-primary");

const CREATED_AT = instant("2026-07-28T06:00:00.000Z");
const UPDATED_AT = instant("2026-07-28T06:05:00.000Z");
const EVENT_BASE_TIME = Date.parse("2026-07-28T06:00:00.000Z");

export function createDomainGraph(): DomainGraph {
  return {
    workspaces: [
      {
        id: FIXTURE_WORKSPACE_ID,
        name: "Primary workspace",
        state: "active",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    tasks: [
      {
        id: FIXTURE_TASK_ID,
        workspaceId: FIXTURE_WORKSPACE_ID,
        title: "Prove durable persistence",
        state: "running",
        activeSessionId: FIXTURE_SESSION_ID,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    workers: [
      {
        id: FIXTURE_WORKER_ID,
        workspaceId: FIXTURE_WORKSPACE_ID,
        adapterKind: "deterministic-fake",
        state: "busy",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    sessions: [
      {
        id: FIXTURE_SESSION_ID,
        workspaceId: FIXTURE_WORKSPACE_ID,
        taskId: FIXTURE_TASK_ID,
        workerId: FIXTURE_WORKER_ID,
        state: "running",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    approvals: [
      {
        id: approvalId("approval-primary"),
        workspaceId: FIXTURE_WORKSPACE_ID,
        taskId: FIXTURE_TASK_ID,
        sessionId: FIXTURE_SESSION_ID,
        action: "Write a task artifact",
        state: "pending",
        requestedAt: CREATED_AT,
        expiresAt: instant("2026-07-28T07:00:00.000Z"),
      },
    ],
    artifacts: [
      {
        id: artifactId("artifact-primary"),
        workspaceId: FIXTURE_WORKSPACE_ID,
        taskId: FIXTURE_TASK_ID,
        sessionId: FIXTURE_SESSION_ID,
        kind: "file",
        label: "Persistence report",
        state: "available",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
  };
}

export function createEvent<Type extends CoreEventType>(
  sequence: number,
  type: Type,
  payload: EventPayloadByType[Type],
  overrides: Partial<CoreEvent<Type>> = {},
): CoreEvent<Type> {
  return {
    schemaVersion: 1,
    eventId: eventId(`event-${sequence}`),
    streamId: FIXTURE_STREAM_ID,
    sequence,
    occurredAt: instant(new Date(EVENT_BASE_TIME + sequence * 1_000).toISOString()),
    workspaceId: FIXTURE_WORKSPACE_ID,
    taskId: FIXTURE_TASK_ID,
    sessionId: FIXTURE_SESSION_ID,
    workerId: FIXTURE_WORKER_ID,
    correlationId: correlationId("correlation-primary"),
    type,
    redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
    payload,
    ...overrides,
  } as CoreEvent<Type>;
}

export function createStartedEvent(
  overrides: Partial<CoreEvent<"task.started">> = {},
): CoreEvent<"task.started"> {
  return createEvent(
    1,
    "task.started",
    {
      from: "ready",
      to: "running",
    },
    overrides,
  );
}
