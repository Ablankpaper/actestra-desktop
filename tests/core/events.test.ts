import { describe, expect, it } from "vitest";
import {
  advanceCoreEventStreamState,
  appendCoreEvent,
  assertCoreEvent,
  coreEventCursor,
  createCoreEventStreamState,
  eventId,
  eventStreamId,
  replayCoreEvents,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  toDiagnosticEvent,
  type CoreEvent,
  type CoreEventType,
  type EventPayloadByType,
} from "../../apps/desktop/src/core/events";
import {
  approvalId,
  artifactId,
  CoreContractError,
  correlationId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
} from "../../apps/desktop/src/core/domain";

const STREAM_ID = eventStreamId("stream-primary");
const WORKSPACE_ID = workspaceId("workspace-primary");
const TASK_ID = taskId("task-primary");
const SESSION_ID = sessionId("session-primary");
const WORKER_ID = workerId("worker-primary");
const CORRELATION_ID = correlationId("correlation-primary");

function event<T extends CoreEventType>(
  sequence: number,
  type: T,
  payload: EventPayloadByType[T],
  overrides: Partial<CoreEvent<T>> = {},
): CoreEvent<T> {
  return {
    schemaVersion: 1,
    eventId: eventId(`event-${sequence}`),
    streamId: STREAM_ID,
    sequence,
    occurredAt: instant(`2026-07-28T06:00:0${sequence}.000Z`),
    workspaceId: WORKSPACE_ID,
    taskId: TASK_ID,
    sessionId: SESSION_ID,
    workerId: WORKER_ID,
    correlationId: CORRELATION_ID,
    type,
    redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
    payload,
    ...overrides,
  } as CoreEvent<T>;
}

function startedEvent(): CoreEvent<"task.started"> {
  return event(1, "task.started", {
    from: "ready",
    to: "running",
  });
}

function expectContractError(operation: () => unknown, code: CoreContractError["code"]): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(CoreContractError);
    expect((error as CoreContractError).code).toBe(code);
    return;
  }

  throw new Error(`Expected CoreContractError with code ${code}`);
}

describe("Actestra unified core events", () => {
  it("appends one gapless session stream and replays after a verified cursor", () => {
    const first = appendCoreEvent([], startedEvent());
    const message = event(2, "agent.message", {
      role: "assistant",
      content: "The deterministic worker is running.",
    });
    const second = appendCoreEvent(first.events, message);
    const artifact = event(3, "artifact.created", {
      artifactId: artifactId("artifact-primary"),
      kind: "file",
      label: "Contract report",
    });
    const third = appendCoreEvent(second.events, artifact);

    expect(first.status).toBe("appended");
    expect(third.events.map(({ sequence, type }) => [sequence, type])).toEqual([
      [1, "task.started"],
      [2, "agent.message"],
      [3, "artifact.created"],
    ]);
    expect(replayCoreEvents(third.events, coreEventCursor(message))).toEqual([artifact]);
  });

  it("advances a prevalidated stream state without revalidating its full history", () => {
    const started = startedEvent();
    const message = event(2, "agent.message", {
      role: "assistant",
      content: "The validated stream state is reusable.",
    });
    const initial = createCoreEventStreamState([started, message]);
    const artifact = event(3, "artifact.created", {
      artifactId: artifactId("artifact-state-cache"),
      kind: "file",
      label: "State cache report",
    });

    const advanced = advanceCoreEventStreamState(initial, artifact);
    (message as { payload: { content: string } }).payload.content = "Mutated by caller";
    (artifact as { sequence: number }).sequence = 99;

    expect(initial.previous?.payload).toEqual({
      role: "assistant",
      content: "The validated stream state is reusable.",
    });
    expect(advanced.first).toEqual(started);
    expect(advanced.previous?.sequence).toBe(3);
    expect(advanced.taskState).toBe("running");
  });

  it("idempotently accepts immediate incremental redelivery and rejects conflicts", () => {
    const started = startedEvent();
    const state = createCoreEventStreamState([started]);
    const duplicate = advanceCoreEventStreamState(state, {
      ...started,
      payload: {
        from: "ready",
        to: "running",
      },
    });

    expect(duplicate).toBe(state);
    expectContractError(
      () =>
        advanceCoreEventStreamState(state, {
          ...started,
          occurredAt: instant("2026-07-28T06:00:02.000Z"),
        }),
      "event-id-conflict",
    );
  });

  it("fails closed on unknown schema versions and malformed event payloads", () => {
    expectContractError(
      () =>
        assertCoreEvent({
          ...startedEvent(),
          schemaVersion: 2,
        }),
      "invalid-event",
    );

    expectContractError(
      () =>
        assertCoreEvent({
          ...startedEvent(),
          payload: {
            from: "ready",
          },
        }),
      "invalid-event",
    );

    expectContractError(
      () =>
        assertCoreEvent({
          ...startedEvent(),
          payload: {
            from: "ready",
            to: "running",
            unexpectedCredentialField: "not-allowed",
          },
        }),
      "invalid-event",
    );
  });

  it("deduplicates an identical event id but rejects a conflicting reuse", () => {
    const started = startedEvent();
    const first = appendCoreEvent([], started);

    const duplicate = appendCoreEvent(first.events, {
      ...started,
      payload: {
        from: "ready",
        to: "running",
      },
    });
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.events).toBe(first.events);

    expectContractError(
      () =>
        appendCoreEvent(first.events, {
          ...started,
          payload: {
            from: "draft",
            to: "running",
          },
        } as unknown as CoreEvent<"task.started">),
      "event-id-conflict",
    );
  });

  it("rejects gaps, duplicate sequences, and timestamp regression", () => {
    const first = appendCoreEvent([], startedEvent());

    expectContractError(
      () =>
        appendCoreEvent(
          first.events,
          event(3, "agent.message", {
            role: "assistant",
            content: "Skipped sequence two.",
          }),
        ),
      "event-sequence-gap",
    );

    expectContractError(
      () =>
        appendCoreEvent(
          first.events,
          event(
            1,
            "agent.message",
            {
              role: "assistant",
              content: "Reused sequence one.",
            },
            {
              eventId: eventId("event-other"),
            },
          ),
        ),
      "event-sequence-conflict",
    );

    expectContractError(
      () =>
        appendCoreEvent(
          first.events,
          event(
            2,
            "agent.message",
            {
              role: "assistant",
              content: "Older timestamp.",
            },
            {
              occurredAt: instant("2026-07-28T05:59:59.000Z"),
            },
          ),
        ),
      "event-time-regression",
    );
  });

  it("rejects identity drift inside one event stream", () => {
    const first = appendCoreEvent([], startedEvent());

    expectContractError(
      () =>
        appendCoreEvent(
          first.events,
          event(
            2,
            "approval.required",
            {
              approvalId: approvalId("approval-primary"),
              action: "Write a file",
            },
            {
              workspaceId: workspaceId("workspace-foreign"),
            },
          ),
        ),
      "event-identity-mismatch",
    );
  });

  it("enforces task transition coherence and stops after a terminal event", () => {
    const first = appendCoreEvent([], startedEvent());

    expectContractError(
      () =>
        appendCoreEvent(
          first.events,
          event(2, "task.updated", {
            from: "blocked",
            to: "running",
            reason: "Mismatched current state",
          }),
        ),
      "event-state-mismatch",
    );

    const completed = event(2, "task.completed", {
      from: "running",
      to: "completed",
    });
    const terminalStream = appendCoreEvent(first.events, completed);

    expectContractError(
      () =>
        appendCoreEvent(
          terminalStream.events,
          event(3, "tool.requested", {
            requestId: toolRequestId("tool-request-late"),
            toolName: "filesystem.write",
            summary: "Must not run after completion",
          }),
        ),
      "event-after-terminal",
    );
  });

  it("rejects a replay cursor that does not match the canonical stream", () => {
    const first = appendCoreEvent([], startedEvent());

    expectContractError(
      () =>
        replayCoreEvents(first.events, {
          streamId: STREAM_ID,
          sequence: 1,
          eventId: eventId("event-foreign"),
        }),
      "invalid-event-cursor",
    );
  });

  it("prevents diagnostic exports from downgrading content classifications", () => {
    const started = startedEvent();
    const message = event(2, "agent.message", {
      role: "assistant",
      content: "Workspace content remains private.",
    });

    expect(toDiagnosticEvent(started).payload).toEqual({
      from: "ready",
      to: "running",
    });
    expect(toDiagnosticEvent(message).payload).toEqual({
      redacted: true,
      classification: "workspace-content",
    });

    expectContractError(
      () =>
        appendCoreEvent(
          [started],
          event(
            2,
            "agent.message",
            {
              role: "assistant",
              content: "Incorrectly classified content.",
            },
            {
              redaction: "metadata",
            } as unknown as Partial<CoreEvent<"agent.message">>,
          ),
        ),
      "invalid-event-redaction",
    );
  });
});
