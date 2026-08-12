import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  approvalId,
  artifactId,
  correlationId,
  normalizeArtifactDeliveryRecord,
  eventId,
  eventStreamId,
  instant,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type ArtifactDeliveryRecord,
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

export const FIXTURE_ARTIFACT_ID = artifactId("artifact-primary");
/** The isolated worktree grant the patch was produced under. */
export const FIXTURE_PATCH_OWNER_GRANT_ID = "grant-isolated-worktree-primary";
/** The original workspace grant a patch is applied into; never the patch owner. */
export const FIXTURE_DESTINATION_GRANT_ID = "grant-original-workspace-primary";

export function createArtifactDeliveryRecord(
  overrides: Partial<ArtifactDeliveryRecord> = {},
): ArtifactDeliveryRecord {
  return normalizeArtifactDeliveryRecord({
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    artifactId: FIXTURE_ARTIFACT_ID,
    workspaceId: FIXTURE_WORKSPACE_ID,
    destinationWorkspaceId: null,
    taskId: FIXTURE_TASK_ID,
    sessionId: FIXTURE_SESSION_ID,
    state: "pending",
    patchOwnerGrantId: FIXTURE_PATCH_OWNER_GRANT_ID,
    // The publishing session's own worker and request, because reading the patch back has to name the
    // exact authority it was stored under.
    patchOwnerWorkerId: FIXTURE_WORKER_ID,
    patchRequestId: "request-coding-publish-primary",
    destinationGrantId: null,
    patchReference: "coding-publish-output-primary",
    patchSha256: "a".repeat(64),
    patchByteLength: 128,
    baseCommit: "b".repeat(40),
    changedFileCount: 2,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...overrides,
  });
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
