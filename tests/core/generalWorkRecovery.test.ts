import { describe, expect, it } from "vitest";
import {
  MAX_GENERAL_WORK_CHECKPOINT_EVENTS,
  GeneralWorkRecoveryError,
  assertGeneralWorkCheckpoint,
  assertGeneralWorkCheckpointTransition,
  artifactId,
  eventId,
  instant,
  sessionId,
  toolOutputReference,
  workspaceGrantId,
} from "../../apps/desktop/src/core";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";
import { createEvent } from "../fixtures/core";

describe("general-work recovery contract", () => {
  it("accepts a bounded active attempt and one monotonic terminal transition", () => {
    const active = createGeneralWorkCheckpoint();
    expect(() => assertGeneralWorkCheckpoint(active)).not.toThrow();
    const terminal = {
      ...active,
      phase: "terminal-pending",
      revision: 2,
      attempt: {
        ...active.attempt,
        state: "failed",
        taskState: "failed",
        lastCoreEventSequence: 6,
        disposed: true,
        incident: {
          code: "application-restart",
          occurredAt: instant("2026-07-28T06:00:06.000Z"),
        },
      },
      events: [
        ...active.events,
        createEvent(5, "worker.failed", {
          errorCode: "application-restart",
          message: "Worker interrupted.",
          retryable: true,
        }),
        createEvent(6, "task.failed", {
          from: "blocked",
          to: "failed",
          errorCode: "application-restart",
          message: "Fresh identities required.",
        }),
      ],
      updatedAt: instant("2026-07-28T06:00:06.000Z"),
    } as const;

    expect(() => assertGeneralWorkCheckpoint(terminal)).not.toThrow();
    expect(() => assertGeneralWorkCheckpointTransition(active, terminal)).not.toThrow();
  });

  it("accepts only bounded resource incident metadata in a terminal checkpoint", () => {
    const active = createGeneralWorkCheckpoint();
    const resource = {
      workerKind: "general",
      attemptId: active.attempt.sessionId,
      code: "worker-resource-cpu-exceeded",
      resourceKind: "cpu",
      observed: 31,
      limit: 30,
      termination: "requested",
    } as const;
    const terminal = {
      ...active,
      phase: "terminal-pending",
      revision: 2,
      attempt: {
        ...active.attempt,
        state: "failed",
        taskState: "failed",
        lastCoreEventSequence: 6,
        disposed: true,
        incident: {
          code: resource.code,
          occurredAt: instant("2026-07-28T06:00:06.000Z"),
          resource,
        },
      },
      events: [
        ...active.events,
        createEvent(5, "worker.failed", {
          errorCode: resource.code,
          message: "The Worker exceeded a resource boundary.",
          retryable: false,
        }),
        createEvent(6, "task.failed", {
          from: "blocked",
          to: "failed",
          errorCode: resource.code,
          message: "The Worker exceeded a resource boundary.",
        }),
      ],
      updatedAt: instant("2026-07-28T06:00:06.000Z"),
    } as const;

    expect(() => assertGeneralWorkCheckpoint(terminal)).not.toThrow();
    expect(() =>
      assertGeneralWorkCheckpoint({
        ...terminal,
        attempt: {
          ...terminal.attempt,
          incident: {
            ...terminal.attempt.incident,
            resource: {
              ...resource,
              path: "/private/workspace",
            },
          },
        },
      }),
    ).toThrow(GeneralWorkRecoveryError);
  });

  it("rejects identity reuse, skipped revisions, and active disposed records", () => {
    const active = createGeneralWorkCheckpoint();
    for (const invalid of [
      {
        ...active,
        attempt: {
          ...active.attempt,
          sessionId: sessionId("session-changed"),
        },
      },
      {
        ...active,
        attempt: {
          ...active.attempt,
          disposed: true,
        },
      },
    ]) {
      expect(() => assertGeneralWorkCheckpoint(invalid)).toThrow(GeneralWorkRecoveryError);
    }
    expect(() =>
      assertGeneralWorkCheckpointTransition(active, {
        ...active,
        revision: 3,
      }),
    ).toThrow(GeneralWorkRecoveryError);
  });

  it("keeps durable events, attempt progress, and tool ambiguity append-only", () => {
    const active = createGeneralWorkCheckpoint();
    const rewrites = [
      {
        ...active,
        revision: 2,
        events: active.events.map((event, index) =>
          index === 0
            ? {
                ...event,
                eventId: eventId("event-rewritten"),
              }
            : event,
        ),
      },
      {
        ...active,
        revision: 2,
        attempt: {
          ...active.attempt,
          lastControlSequence: active.attempt.lastControlSequence - 1,
        },
      },
      {
        ...active,
        revision: 2,
        tool: {
          requestId: active.tool!.requestId,
          toolId: active.tool!.toolId,
          inputRef: active.tool!.inputRef,
          state: "in-flight" as const,
          startedAt: active.tool!.startedAt,
          mayHaveExecuted: false,
        },
      },
    ];

    for (const rewrite of rewrites) {
      expect(() => assertGeneralWorkCheckpoint(rewrite)).not.toThrow();
      expect(() => assertGeneralWorkCheckpointTransition(active, rewrite)).toThrow(
        GeneralWorkRecoveryError,
      );
    }
  });

  it("allows a live cancellation to resolve conservative pre-execution ambiguity", () => {
    const active = createGeneralWorkCheckpoint();
    const cancelled = {
      ...active,
      revision: 2,
      tool: {
        requestId: active.tool!.requestId,
        toolId: active.tool!.toolId,
        inputRef: active.tool!.inputRef,
        state: "cancelled" as const,
        startedAt: active.tool!.startedAt,
        completedAt: instant("2026-07-28T06:00:05.000Z"),
        mayHaveExecuted: false,
        reason: "Cancelled before filesystem mutation",
      },
      updatedAt: instant("2026-07-28T06:00:05.000Z"),
    };

    expect(() => assertGeneralWorkCheckpoint(cancelled)).not.toThrow();
    expect(() => assertGeneralWorkCheckpointTransition(active, cancelled)).not.toThrow();
  });

  it("requires a successful task-output intent to retain its exact artifact binding", () => {
    const active = createGeneralWorkCheckpoint();
    const artifactIntent = {
      artifactId: artifactId("artifact-general-work-contract"),
      kind: "file" as const,
      label: "Contract output",
      grantId: workspaceGrantId("grant-general-work-contract"),
    };
    const inFlight = {
      ...active,
      artifactIntent,
    };
    expect(() => assertGeneralWorkCheckpoint(inFlight)).not.toThrow();

    expect(() =>
      assertGeneralWorkCheckpoint({
        ...inFlight,
        tool: {
          ...active.tool!,
          state: "succeeded",
          completedAt: instant("2026-07-28T06:00:05.000Z"),
          outputRef: toolOutputReference("output-general-work-contract"),
          mayHaveExecuted: true,
        },
      }),
    ).toThrow(GeneralWorkRecoveryError);
  });

  it("advances a verified baseline while retaining a bounded immutable event window", () => {
    const active = createGeneralWorkCheckpoint();
    const events = [
      ...active.events,
      ...Array.from({ length: 130 - active.events.length }, (_, index) =>
        createEvent(index + active.events.length + 1, "agent.message", {
          role: "assistant",
          content: `Progress ${String(index + 1)}`,
        }),
      ),
    ];
    const retained = events.slice(-MAX_GENERAL_WORK_CHECKPOINT_EVENTS);
    const compacted = {
      ...active,
      revision: 2,
      attempt: {
        ...active.attempt,
        lastCoreEventSequence: 130,
      },
      eventBaseline: {
        sequence: 2,
        event: events[1]!,
        taskState: "running" as const,
      },
      events: retained,
      updatedAt: instant("2026-07-28T06:02:10.000Z"),
    };

    expect(retained).toHaveLength(MAX_GENERAL_WORK_CHECKPOINT_EVENTS);
    expect(() => assertGeneralWorkCheckpoint(compacted)).not.toThrow();
    expect(() => assertGeneralWorkCheckpointTransition(active, compacted)).not.toThrow();
    expect(() =>
      assertGeneralWorkCheckpointTransition(active, {
        ...compacted,
        eventBaseline: {
          sequence: 5,
          event: events[4]!,
          taskState: "blocked",
        },
        events: events.slice(5),
      }),
    ).toThrow(GeneralWorkRecoveryError);
  });
});
