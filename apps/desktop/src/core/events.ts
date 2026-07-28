import {
  approvalId,
  artifactId,
  assertTaskTransition,
  compareInstants,
  CoreContractError,
  correlationId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
  type ApprovalId,
  type ApprovalState,
  type ArtifactId,
  type ArtifactKind,
  type ArtifactState,
  type CorrelationId,
  type Instant,
  type SessionId,
  type TaskId,
  type TaskState,
  type ToolRequestId,
  type WorkerId,
  type WorkspaceId,
} from "./domain";

declare const eventValueBrand: unique symbol;
const coreEventStreamStateBrand = Symbol("ActestraCoreEventStreamState");

type BrandedEventString<Brand extends string> = string & {
  readonly [eventValueBrand]: Brand;
};

export type EventId = BrandedEventString<"EventId">;
export type EventStreamId = BrandedEventString<"EventStreamId">;

export function eventId(value: string): EventId {
  correlationId(value);
  return value as EventId;
}

export function eventStreamId(value: string): EventStreamId {
  correlationId(value);
  return value as EventStreamId;
}

export const CORE_EVENT_SCHEMA_VERSION = 1 as const;

export interface EventPayloadByType {
  readonly "task.started": {
    readonly from: "ready" | "blocked";
    readonly to: "running";
  };
  readonly "task.updated": {
    readonly from: TaskState;
    readonly to: TaskState;
    readonly reason?: string;
  };
  readonly "agent.message": {
    readonly role: "assistant" | "system";
    readonly content: string;
  };
  readonly "tool.requested": {
    readonly requestId: ToolRequestId;
    readonly toolName: string;
    readonly summary: string;
    readonly approvalId?: ApprovalId;
  };
  readonly "tool.started": {
    readonly requestId: ToolRequestId;
  };
  readonly "tool.completed": {
    readonly requestId: ToolRequestId;
    readonly summary?: string;
  };
  readonly "tool.failed": {
    readonly requestId: ToolRequestId;
    readonly errorCode: string;
    readonly message: string;
  };
  readonly "approval.required": {
    readonly approvalId: ApprovalId;
    readonly action: string;
    readonly expiresAt?: Instant;
  };
  readonly "approval.resolved": {
    readonly approvalId: ApprovalId;
    readonly decision: Exclude<ApprovalState, "pending">;
  };
  readonly "artifact.created": {
    readonly artifactId: ArtifactId;
    readonly kind: ArtifactKind;
    readonly label: string;
  };
  readonly "artifact.updated": {
    readonly artifactId: ArtifactId;
    readonly state: ArtifactState;
    readonly label: string;
  };
  readonly "worker.blocked": {
    readonly reason: "approval" | "tool" | "dependency" | "other";
    readonly approvalId?: ApprovalId;
  };
  readonly "worker.failed": {
    readonly errorCode: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly "task.completed": {
    readonly from: TaskState;
    readonly to: "completed";
  };
  readonly "task.failed": {
    readonly from: TaskState;
    readonly to: "failed";
    readonly errorCode: string;
    readonly message: string;
  };
  readonly "task.cancelled": {
    readonly from: TaskState;
    readonly to: "cancelled";
    readonly reason?: string;
  };
}

export type CoreEventType = keyof EventPayloadByType;
export type RedactionClass = "metadata" | "workspace-content" | "sensitive-reference";

export const REQUIRED_REDACTION_BY_EVENT_TYPE = {
  "task.started": "metadata",
  "task.updated": "workspace-content",
  "agent.message": "workspace-content",
  "tool.requested": "sensitive-reference",
  "tool.started": "metadata",
  "tool.completed": "workspace-content",
  "tool.failed": "workspace-content",
  "approval.required": "sensitive-reference",
  "approval.resolved": "metadata",
  "artifact.created": "workspace-content",
  "artifact.updated": "workspace-content",
  "worker.blocked": "sensitive-reference",
  "worker.failed": "workspace-content",
  "task.completed": "metadata",
  "task.failed": "workspace-content",
  "task.cancelled": "workspace-content",
} as const satisfies Record<CoreEventType, RedactionClass>;

export interface CoreEventEnvelope<Type extends CoreEventType> {
  readonly schemaVersion: typeof CORE_EVENT_SCHEMA_VERSION;
  readonly eventId: EventId;
  readonly streamId: EventStreamId;
  readonly sequence: number;
  readonly occurredAt: Instant;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly correlationId: CorrelationId;
  readonly causationId?: EventId;
  readonly type: Type;
  readonly redaction: (typeof REQUIRED_REDACTION_BY_EVENT_TYPE)[Type];
  readonly payload: EventPayloadByType[Type];
}

export type CoreEvent<Type extends CoreEventType = CoreEventType> = {
  readonly [EventType in Type]: CoreEventEnvelope<EventType>;
}[Type];

export interface CoreEventCursor {
  readonly streamId: EventStreamId;
  readonly sequence: number;
  readonly eventId: EventId;
}

export interface AppendCoreEventResult {
  readonly status: "appended" | "duplicate";
  readonly events: readonly CoreEvent[];
}

export interface CoreEventStreamState {
  readonly first?: CoreEvent;
  readonly previous?: CoreEvent;
  readonly taskState?: TaskState;
  readonly [coreEventStreamStateBrand]: true;
}

export interface RedactedDiagnosticPayload {
  readonly redacted: true;
  readonly classification: Exclude<RedactionClass, "metadata">;
}

export type DiagnosticCoreEvent = Omit<CoreEvent, "payload"> & {
  readonly payload: EventPayloadByType[CoreEventType] | RedactedDiagnosticPayload;
};

const TASK_STATES: readonly TaskState[] = [
  "draft",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];
const APPROVAL_DECISIONS: readonly Exclude<ApprovalState, "pending">[] = [
  "approved",
  "denied",
  "expired",
  "cancelled",
];
const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "file",
  "document",
  "dataset",
  "directory",
  "other",
];
const ARTIFACT_STATES: readonly ArtifactState[] = ["available", "superseded"];
const BLOCK_REASONS = ["approval", "tool", "dependency", "other"] as const;
const EVENT_TYPES = Object.keys(REQUIRED_REDACTION_BY_EVENT_TYPE) as CoreEventType[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new CoreContractError("invalid-event", `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const unexpectedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));

  if (unexpectedKey !== undefined) {
    throw new CoreContractError(
      "invalid-event",
      `${label} contains unsupported field ${unexpectedKey}`,
    );
  }
}

function assertString(value: unknown, label: string, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new CoreContractError("invalid-event", `${label} must be a string`);
  }
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined) {
    assertString(value, label, true);
  }
}

function assertTaskState(value: unknown, label: string): asserts value is TaskState {
  if (typeof value !== "string" || !TASK_STATES.includes(value as TaskState)) {
    throw new CoreContractError("invalid-event", `${label} must be a known TaskState`);
  }
}

function assertPayload(type: CoreEventType, payload: unknown): void {
  assertRecord(payload, `${type} payload`);

  switch (type) {
    case "task.started":
      assertExactKeys(payload, ["from", "to"], "task.started payload");
      if ((payload.from !== "ready" && payload.from !== "blocked") || payload.to !== "running") {
        throw new CoreContractError(
          "invalid-event",
          "task.started must transition from ready or blocked to running",
        );
      }
      return;
    case "task.updated":
      assertExactKeys(payload, ["from", "to", "reason"], "task.updated payload");
      assertTaskState(payload.from, "task.updated payload.from");
      assertTaskState(payload.to, "task.updated payload.to");
      assertOptionalString(payload.reason, "task.updated payload.reason");
      return;
    case "agent.message":
      assertExactKeys(payload, ["role", "content"], "agent.message payload");
      if (payload.role !== "assistant" && payload.role !== "system") {
        throw new CoreContractError(
          "invalid-event",
          "agent.message payload.role must be assistant or system",
        );
      }
      assertString(payload.content, "agent.message payload.content", true);
      return;
    case "tool.requested":
      assertExactKeys(
        payload,
        ["requestId", "toolName", "summary", "approvalId"],
        "tool.requested payload",
      );
      assertString(payload.requestId, "tool.requested payload.requestId");
      toolRequestId(payload.requestId);
      assertString(payload.toolName, "tool.requested payload.toolName");
      assertString(payload.summary, "tool.requested payload.summary");
      if (payload.approvalId !== undefined) {
        assertString(payload.approvalId, "tool.requested payload.approvalId");
        approvalId(payload.approvalId);
      }
      return;
    case "tool.started":
      assertExactKeys(payload, ["requestId"], "tool.started payload");
      assertString(payload.requestId, "tool.started payload.requestId");
      toolRequestId(payload.requestId);
      return;
    case "tool.completed":
      assertExactKeys(payload, ["requestId", "summary"], "tool.completed payload");
      assertString(payload.requestId, "tool.completed payload.requestId");
      toolRequestId(payload.requestId);
      assertOptionalString(payload.summary, "tool.completed payload.summary");
      return;
    case "tool.failed":
      assertExactKeys(payload, ["requestId", "errorCode", "message"], "tool.failed payload");
      assertString(payload.requestId, "tool.failed payload.requestId");
      toolRequestId(payload.requestId);
      assertString(payload.errorCode, "tool.failed payload.errorCode");
      assertString(payload.message, "tool.failed payload.message", true);
      return;
    case "approval.required":
      assertExactKeys(payload, ["approvalId", "action", "expiresAt"], "approval.required payload");
      assertString(payload.approvalId, "approval.required payload.approvalId");
      approvalId(payload.approvalId);
      assertString(payload.action, "approval.required payload.action");
      if (payload.expiresAt !== undefined) {
        assertString(payload.expiresAt, "approval.required payload.expiresAt");
        instant(payload.expiresAt);
      }
      return;
    case "approval.resolved":
      assertExactKeys(payload, ["approvalId", "decision"], "approval.resolved payload");
      assertString(payload.approvalId, "approval.resolved payload.approvalId");
      approvalId(payload.approvalId);
      if (
        typeof payload.decision !== "string" ||
        !APPROVAL_DECISIONS.includes(payload.decision as Exclude<ApprovalState, "pending">)
      ) {
        throw new CoreContractError(
          "invalid-event",
          "approval.resolved payload.decision must be terminal",
        );
      }
      return;
    case "artifact.created":
      assertExactKeys(payload, ["artifactId", "kind", "label"], "artifact.created payload");
      assertString(payload.artifactId, "artifact.created payload.artifactId");
      artifactId(payload.artifactId);
      if (
        typeof payload.kind !== "string" ||
        !ARTIFACT_KINDS.includes(payload.kind as ArtifactKind)
      ) {
        throw new CoreContractError("invalid-event", "artifact.created payload.kind must be known");
      }
      assertString(payload.label, "artifact.created payload.label");
      return;
    case "artifact.updated":
      assertExactKeys(payload, ["artifactId", "state", "label"], "artifact.updated payload");
      assertString(payload.artifactId, "artifact.updated payload.artifactId");
      artifactId(payload.artifactId);
      if (
        typeof payload.state !== "string" ||
        !ARTIFACT_STATES.includes(payload.state as ArtifactState)
      ) {
        throw new CoreContractError(
          "invalid-event",
          "artifact.updated payload.state must be known",
        );
      }
      assertString(payload.label, "artifact.updated payload.label");
      return;
    case "worker.blocked":
      assertExactKeys(payload, ["reason", "approvalId"], "worker.blocked payload");
      if (
        typeof payload.reason !== "string" ||
        !BLOCK_REASONS.includes(payload.reason as (typeof BLOCK_REASONS)[number])
      ) {
        throw new CoreContractError("invalid-event", "worker.blocked payload.reason must be known");
      }
      if (payload.approvalId !== undefined) {
        assertString(payload.approvalId, "worker.blocked payload.approvalId");
        approvalId(payload.approvalId);
      }
      return;
    case "worker.failed":
      assertExactKeys(payload, ["errorCode", "message", "retryable"], "worker.failed payload");
      assertString(payload.errorCode, "worker.failed payload.errorCode");
      assertString(payload.message, "worker.failed payload.message", true);
      if (typeof payload.retryable !== "boolean") {
        throw new CoreContractError(
          "invalid-event",
          "worker.failed payload.retryable must be boolean",
        );
      }
      return;
    case "task.completed":
      assertExactKeys(payload, ["from", "to"], "task.completed payload");
      assertTaskState(payload.from, "task.completed payload.from");
      if (payload.to !== "completed") {
        throw new CoreContractError("invalid-event", "task.completed payload.to must be completed");
      }
      return;
    case "task.failed":
      assertExactKeys(payload, ["from", "to", "errorCode", "message"], "task.failed payload");
      assertTaskState(payload.from, "task.failed payload.from");
      if (payload.to !== "failed") {
        throw new CoreContractError("invalid-event", "task.failed payload.to must be failed");
      }
      assertString(payload.errorCode, "task.failed payload.errorCode");
      assertString(payload.message, "task.failed payload.message", true);
      return;
    case "task.cancelled":
      assertExactKeys(payload, ["from", "to", "reason"], "task.cancelled payload");
      assertTaskState(payload.from, "task.cancelled payload.from");
      if (payload.to !== "cancelled") {
        throw new CoreContractError("invalid-event", "task.cancelled payload.to must be cancelled");
      }
      assertOptionalString(payload.reason, "task.cancelled payload.reason");
      return;
    default: {
      const unsupportedType: never = type;
      throw new CoreContractError(
        "invalid-event",
        `No payload validator is registered for ${String(unsupportedType)}`,
      );
    }
  }
}

export function assertCoreEvent(value: unknown): asserts value is CoreEvent {
  assertRecord(value, "Core event");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "eventId",
      "streamId",
      "sequence",
      "occurredAt",
      "workspaceId",
      "taskId",
      "sessionId",
      "workerId",
      "correlationId",
      "causationId",
      "type",
      "redaction",
      "payload",
    ],
    "Core event",
  );

  if (value.schemaVersion !== CORE_EVENT_SCHEMA_VERSION) {
    throw new CoreContractError(
      "invalid-event",
      `Unsupported core event schema version ${String(value.schemaVersion)}`,
    );
  }

  assertString(value.eventId, "Core event.eventId");
  assertString(value.streamId, "Core event.streamId");
  assertString(value.workspaceId, "Core event.workspaceId");
  assertString(value.taskId, "Core event.taskId");
  assertString(value.sessionId, "Core event.sessionId");
  assertString(value.workerId, "Core event.workerId");
  assertString(value.correlationId, "Core event.correlationId");
  assertString(value.occurredAt, "Core event.occurredAt");
  eventId(value.eventId);
  eventStreamId(value.streamId);
  workspaceId(value.workspaceId);
  taskId(value.taskId);
  sessionId(value.sessionId);
  workerId(value.workerId);
  correlationId(value.correlationId);
  instant(value.occurredAt);

  if (value.causationId !== undefined) {
    assertString(value.causationId, "Core event.causationId");
    eventId(value.causationId);
  }

  if (
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1
  ) {
    throw new CoreContractError(
      "invalid-event",
      "Core event sequence must be a positive safe integer",
    );
  }

  if (typeof value.type !== "string" || !EVENT_TYPES.includes(value.type as CoreEventType)) {
    throw new CoreContractError("invalid-event", `Unknown core event type ${String(value.type)}`);
  }

  const eventType = value.type as CoreEventType;
  if (value.redaction !== REQUIRED_REDACTION_BY_EVENT_TYPE[eventType]) {
    throw new CoreContractError(
      "invalid-event-redaction",
      `${eventType} requires ${REQUIRED_REDACTION_BY_EVENT_TYPE[eventType]} redaction`,
    );
  }

  assertPayload(eventType, value.payload);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => structurallyEqual(value, right[index]));
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left)
    .filter((key) => left[key] !== undefined)
    .sort();
  const rightKeys = Object.keys(right)
    .filter((key) => right[key] !== undefined)
    .sort();

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]),
    )
  );
}

function eventTaskState(event: CoreEvent, currentState: TaskState | undefined): TaskState {
  if (currentState === undefined) {
    if (event.type !== "task.started") {
      throw new CoreContractError(
        "event-state-mismatch",
        "The first event in a session stream must be task.started",
      );
    }

    assertTaskTransition(event.payload.from, event.payload.to);
    return "running";
  }

  if (event.type === "task.started") {
    throw new CoreContractError(
      "event-state-mismatch",
      "task.started may appear only once at the start of a session stream",
    );
  }

  if (
    event.type !== "task.updated" &&
    event.type !== "task.completed" &&
    event.type !== "task.failed" &&
    event.type !== "task.cancelled"
  ) {
    return currentState;
  }

  if (event.payload.from !== currentState) {
    throw new CoreContractError(
      "event-state-mismatch",
      `${event.type} expects Task ${event.payload.from}, but the stream is ${currentState}`,
    );
  }

  if (
    event.type === "task.updated" &&
    (event.payload.to === "completed" ||
      event.payload.to === "failed" ||
      event.payload.to === "cancelled")
  ) {
    throw new CoreContractError(
      "event-state-mismatch",
      "Terminal task transitions require their dedicated terminal event type",
    );
  }

  assertTaskTransition(event.payload.from, event.payload.to);
  return event.payload.to;
}

function isTerminalEvent(event: CoreEvent): boolean {
  return (
    event.type === "task.completed" ||
    event.type === "task.failed" ||
    event.type === "task.cancelled"
  );
}

function assertSameStreamIdentity(first: CoreEvent, next: CoreEvent): void {
  if (
    first.streamId !== next.streamId ||
    first.workspaceId !== next.workspaceId ||
    first.taskId !== next.taskId ||
    first.sessionId !== next.sessionId ||
    first.workerId !== next.workerId
  ) {
    throw new CoreContractError(
      "event-identity-mismatch",
      "One core event stream cannot change its stream, workspace, task, session, or worker identity",
    );
  }
}

interface ValidatedCoreEventStream {
  readonly first?: CoreEvent;
  readonly previous?: CoreEvent;
  readonly taskState?: TaskState;
  readonly eventsById: ReadonlyMap<EventId, CoreEvent>;
}

function immutableCoreEvent(event: CoreEvent): CoreEvent {
  return Object.freeze({
    ...event,
    payload: Object.freeze({
      ...event.payload,
    }),
  }) as CoreEvent;
}

function validateNextCoreEvent(
  first: CoreEvent | undefined,
  previous: CoreEvent | undefined,
  currentTaskState: TaskState | undefined,
  event: CoreEvent,
): TaskState {
  assertCoreEvent(event);

  if (previous === undefined) {
    if (event.sequence !== 1) {
      throw new CoreContractError(
        "event-sequence-gap",
        `A core event stream must start at sequence 1, received ${event.sequence}`,
      );
    }

    return eventTaskState(event, undefined);
  }

  if (first === undefined || currentTaskState === undefined) {
    throw new CoreContractError(
      "invalid-event",
      "Core event stream validation state is incomplete",
    );
  }

  assertSameStreamIdentity(first, event);

  if (event.sequence <= previous.sequence) {
    throw new CoreContractError(
      "event-sequence-conflict",
      `Core event sequence ${event.sequence} conflicts with committed sequence ${previous.sequence}`,
    );
  }

  if (event.sequence !== previous.sequence + 1) {
    throw new CoreContractError(
      "event-sequence-gap",
      `Expected core event sequence ${previous.sequence + 1}, received ${event.sequence}`,
    );
  }

  if (compareInstants(event.occurredAt, previous.occurredAt) < 0) {
    throw new CoreContractError(
      "event-time-regression",
      `Core event ${event.eventId} occurs before sequence ${previous.sequence}`,
    );
  }

  if (isTerminalEvent(previous)) {
    throw new CoreContractError(
      "event-after-terminal",
      `Core event ${event.eventId} cannot follow terminal event ${previous.eventId}`,
    );
  }

  return eventTaskState(event, currentTaskState);
}

function validateCoreEventStream(events: readonly CoreEvent[]): ValidatedCoreEventStream {
  let first: CoreEvent | undefined;
  let previous: CoreEvent | undefined;
  let taskState: TaskState | undefined;
  const eventsById = new Map<EventId, CoreEvent>();

  for (const event of events) {
    if (eventsById.has(event.eventId)) {
      throw new CoreContractError(
        "event-id-conflict",
        `Core event id ${event.eventId} is duplicated in the canonical stream`,
      );
    }

    taskState = validateNextCoreEvent(first, previous, taskState, event);
    first ??= event;
    previous = event;
    eventsById.set(event.eventId, event);
  }

  return {
    first,
    previous,
    taskState,
    eventsById,
  };
}

function streamState(validated: ValidatedCoreEventStream): CoreEventStreamState {
  const first = validated.first === undefined ? undefined : immutableCoreEvent(validated.first);
  const previous =
    validated.previous === undefined
      ? undefined
      : validated.previous === validated.first
        ? first
        : immutableCoreEvent(validated.previous);

  return Object.freeze({
    first,
    previous,
    taskState: validated.taskState,
    [coreEventStreamStateBrand]: true as const,
  });
}

export function assertCoreEventStream(events: readonly CoreEvent[]): void {
  validateCoreEventStream(events);
}

export function createCoreEventStreamState(events: readonly CoreEvent[]): CoreEventStreamState {
  return streamState(validateCoreEventStream(events));
}

export function advanceCoreEventStreamState(
  state: CoreEventStreamState,
  value: unknown,
): CoreEventStreamState {
  if (typeof state !== "object" || state === null || state[coreEventStreamStateBrand] !== true) {
    throw new CoreContractError(
      "invalid-event",
      "Core event stream state must be created by createCoreEventStreamState",
    );
  }

  assertCoreEvent(value);
  const taskState = validateNextCoreEvent(state.first, state.previous, state.taskState, value);
  const immutableValue = immutableCoreEvent(value);

  return Object.freeze({
    first: state.first ?? immutableValue,
    previous: immutableValue,
    taskState,
    [coreEventStreamStateBrand]: true as const,
  });
}

export function assertIdempotentCoreEventDelivery(existing: CoreEvent, value: unknown): void {
  assertCoreEvent(existing);
  assertRecord(value, "Core event");
  assertString(value.eventId, "Core event.eventId");
  eventId(value.eventId);

  if (existing.eventId !== value.eventId || !structurallyEqual(existing, value)) {
    throw new CoreContractError(
      "event-id-conflict",
      `Core event id ${value.eventId} was reused with different content`,
    );
  }
}

export function appendCoreEvent(
  events: readonly CoreEvent[],
  value: unknown,
): AppendCoreEventResult {
  const validated = validateCoreEventStream(events);
  assertRecord(value, "Core event");
  assertString(value.eventId, "Core event.eventId");
  eventId(value.eventId);

  const existing = validated.eventsById.get(value.eventId as EventId);
  if (existing !== undefined) {
    assertIdempotentCoreEventDelivery(existing, value);

    return {
      status: "duplicate",
      events,
    };
  }

  assertCoreEvent(value);
  validateNextCoreEvent(validated.first, validated.previous, validated.taskState, value);

  return {
    status: "appended",
    events: [...events, value],
  };
}

export function coreEventCursor(event: CoreEvent): CoreEventCursor {
  return {
    streamId: event.streamId,
    sequence: event.sequence,
    eventId: event.eventId,
  };
}

export function replayCoreEvents(
  events: readonly CoreEvent[],
  after?: CoreEventCursor,
): readonly CoreEvent[] {
  assertCoreEventStream(events);

  if (after === undefined) {
    return [...events];
  }

  if (
    !isRecord(after) ||
    typeof after.streamId !== "string" ||
    typeof after.eventId !== "string" ||
    typeof after.sequence !== "number"
  ) {
    throw new CoreContractError(
      "invalid-event-cursor",
      "Core event cursor must contain a stream id, sequence, and event id",
    );
  }

  eventStreamId(after.streamId);
  eventId(after.eventId);

  if (!Number.isSafeInteger(after.sequence) || after.sequence < 1) {
    throw new CoreContractError(
      "invalid-event-cursor",
      "Core event cursor sequence must be a positive safe integer",
    );
  }

  const cursorIndex = events.findIndex(
    (event) =>
      event.streamId === after.streamId &&
      event.sequence === after.sequence &&
      event.eventId === after.eventId,
  );

  if (cursorIndex === -1) {
    throw new CoreContractError(
      "invalid-event-cursor",
      "Core event cursor does not identify an event in the canonical stream",
    );
  }

  return events.slice(cursorIndex + 1);
}

export function toDiagnosticEvent(event: CoreEvent): DiagnosticCoreEvent {
  assertCoreEvent(event);

  if (event.redaction === "metadata") {
    return {
      ...event,
      payload: event.payload,
    };
  }

  return {
    ...event,
    payload: {
      redacted: true,
      classification: event.redaction,
    },
  };
}
