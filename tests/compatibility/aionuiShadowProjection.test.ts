// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  AionUiShadowProjectionError,
  assertAionUiNativeObservation,
  assertAionUiShadowEvidence,
  collectAionUiHttpObservations,
  collectAionUiWebSocketObservations,
  projectAionUiObservation,
  type AionUiNativeObservation,
} from "../../apps/desktop/src/compatibility/aionui";
import { assertCoreEventStream, assertDomainGraph } from "../../apps/desktop/src/core";

const OBSERVED_AT = Date.parse("2026-07-29T03:00:00.000Z");

describe("AionUi F2 native observation collection", () => {
  it("extracts bounded conversation metadata without retaining content or credentials", () => {
    const [observation] = collectAionUiHttpObservations({
      method: "POST",
      path: "/api/conversations",
      observedAtMs: OBSERVED_AT,
      response: {
        id: "conversation-native-1",
        type: "acp",
        name: "Private user title",
        desc: "Private user description",
        created_at: OBSERVED_AT - 1_000,
        modified_at: OBSERVED_AT,
        status: "running",
        runtime: {
          state: "waiting_confirmation",
          secret: "runtime-secret",
        },
        extra: {
          workspace: "/Users/private/customer-project",
          backend: "codex",
          context: "Private prompt",
        },
        model: {
          id: "provider-private",
          api_key: "sk-must-not-project",
        },
      },
    });

    expect(observation).toEqual({
      contractVersion: 1,
      kind: "conversation",
      nativeId: "conversation-native-1",
      observedAtMs: OBSERVED_AT,
      conversationId: "conversation-native-1",
      conversationType: "acp",
      status: "running",
      runtimeState: "waiting_confirmation",
      workspaceKey: "/Users/private/customer-project",
      providerKey: "provider-private",
      createdAtMs: OBSERVED_AT - 1_000,
      updatedAtMs: OBSERVED_AT,
    });
    expect(JSON.stringify(observation)).not.toContain("Private user title");
    expect(JSON.stringify(observation)).not.toContain("Private prompt");
    expect(JSON.stringify(observation)).not.toContain("sk-must-not-project");
  });

  it("collects all seven declared native metadata domains", () => {
    const observations: AionUiNativeObservation[] = [];
    observations.push(
      ...collectAionUiHttpObservations({
        method: "GET",
        path: "/api/conversations",
        observedAtMs: OBSERVED_AT,
        response: {
          items: [
            {
              id: "conversation-1",
              type: "acp",
              status: "pending",
              created_at: OBSERVED_AT,
              modified_at: OBSERVED_AT,
              extra: {},
            },
          ],
        },
      }),
      ...collectAionUiHttpObservations({
        method: "GET",
        path: "/api/providers",
        observedAtMs: OBSERVED_AT,
        response: [{ id: "provider-1", platform: "openai", enabled: true }],
      }),
      ...collectAionUiHttpObservations({
        method: "GET",
        path: "/api/conversations/conversation-1/workspace?path=.",
        observedAtMs: OBSERVED_AT,
        response: [{ name: "secret-file.md", type: "file" }],
      }),
      ...collectAionUiHttpObservations({
        method: "GET",
        path: "/api/conversations/conversation-1/confirmations",
        observedAtMs: OBSERVED_AT,
        response: [
          {
            id: "approval-1",
            description: "Run a private command",
          },
        ],
      }),
      ...collectAionUiHttpObservations({
        method: "GET",
        path: "/api/conversations/conversation-1/artifacts",
        observedAtMs: OBSERVED_AT,
        response: [
          {
            id: "artifact-1",
            conversation_id: "conversation-1",
            kind: "skill_suggest",
            status: "active",
            payload: {
              skill_content: "private artifact content",
            },
          },
        ],
      }),
      ...collectAionUiWebSocketObservations({
        eventName: "turn.completed",
        observedAtMs: OBSERVED_AT,
        payload: {
          session_id: "conversation-1",
          turn_id: "turn-1",
          status: "finished",
          state: "ai_waiting_input",
          runtime: {
            state: "idle",
            turn_id: "turn-1",
          },
          last_message: {
            content: "private response",
          },
        },
      }),
    );

    expect(new Set(observations.map(({ kind }) => kind))).toEqual(
      new Set(["approval", "artifact", "conversation", "provider", "runtime", "task", "workspace"]),
    );
    expect(JSON.stringify(observations)).not.toContain("secret-file.md");
    expect(JSON.stringify(observations)).not.toContain("private artifact content");
    expect(JSON.stringify(observations)).not.toContain("private response");
    expect(JSON.stringify(observations)).not.toContain("Run a private command");
  });

  it("records the complete bounded workspace entry count without retaining entry content", () => {
    const response = Array.from({ length: 75 }, (_, index) => ({
      name: `private-${index}.txt`,
      type: "file",
    }));
    const [observation] = collectAionUiHttpObservations({
      method: "GET",
      path: "/api/conversations/conversation-1/workspace",
      observedAtMs: OBSERVED_AT,
      response,
    });

    expect(observation).toMatchObject({
      kind: "workspace",
      entryCount: 75,
    });
    expect(JSON.stringify(observation)).not.toContain("private-0.txt");
  });

  it("does not fabricate a failed runtime from an empty failure kind", () => {
    expect(
      collectAionUiHttpObservations({
        method: "GET",
        path: "/api/conversations/conversation-1/active-lease",
        observedAtMs: OBSERVED_AT,
        response: {
          runtime: {
            failure_kind: "",
          },
        },
      }),
    ).toEqual([]);
  });

  it("preserves explicit failed and cancelled turn completion statuses", () => {
    const [failed] = collectAionUiWebSocketObservations({
      eventName: "turn.completed",
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: "conversation-1",
        turn_id: "turn-failed",
        status: "failed",
        state: "unknown",
      },
    });
    const [cancelled] = collectAionUiWebSocketObservations({
      eventName: "turn.completed",
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: "conversation-1",
        turn_id: "turn-cancelled",
        status: "cancelled",
        state: "unknown",
      },
    });
    const [failedState] = collectAionUiWebSocketObservations({
      eventName: "turn.completed",
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: "conversation-1",
        turn_id: "turn-failed-state",
        state: "failed",
      },
    });
    const [cancelledState] = collectAionUiWebSocketObservations({
      eventName: "turn.completed",
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: "conversation-1",
        turn_id: "turn-cancelled-state",
        state: "canceled",
      },
    });

    expect(failed).toMatchObject({ kind: "task", status: "failed" });
    expect(cancelled).toMatchObject({ kind: "task", status: "cancelled" });
    expect(failedState).toMatchObject({ kind: "task", status: "failed" });
    expect(cancelledState).toMatchObject({ kind: "task", status: "cancelled" });
  });

  it("ignores malformed and unrelated responses instead of changing native behavior", () => {
    expect(
      collectAionUiHttpObservations({
        method: "GET",
        path: "/api/settings/client",
        observedAtMs: OBSERVED_AT,
        response: {
          api_key: "must-not-observe",
        },
      }),
    ).toEqual([]);
    expect(
      collectAionUiHttpObservations({
        method: "GET",
        path: "not a valid URL\u0000",
        observedAtMs: OBSERVED_AT,
        response: null,
      }),
    ).toEqual([]);
  });
});

describe("AionUi F2 P3 shadow projection", () => {
  it("maps native identity deterministically and persists no raw identity or workspace path", () => {
    const [firstObservation] = collectAionUiHttpObservations({
      method: "GET",
      path: "/api/conversations/conversation-native-1",
      observedAtMs: OBSERVED_AT,
      response: {
        id: "conversation-native-1",
        type: "acp",
        status: "running",
        created_at: OBSERVED_AT - 5_000,
        modified_at: OBSERVED_AT,
        extra: {
          workspace: "/Users/private/customer-project",
          backend: "codex-private-provider",
        },
      },
    });
    const [replayedObservation] = collectAionUiHttpObservations({
      method: "GET",
      path: "/api/conversations/conversation-native-1",
      observedAtMs: OBSERVED_AT + 10_000,
      response: {
        id: "conversation-native-1",
        type: "acp",
        status: "running",
        created_at: OBSERVED_AT - 5_000,
        modified_at: OBSERVED_AT,
        extra: {
          workspace: "/Users/private/customer-project",
          backend: "codex-private-provider",
        },
      },
    });

    const first = projectAionUiObservation(firstObservation);
    const replayed = projectAionUiObservation(replayedObservation);
    assertDomainGraph(first.graph);
    assertCoreEventStream(first.events);
    expect(replayed).toEqual(first);
    expect(first.evidenceId).toMatch(/^aionui-shadow-evidence-[a-f0-9]{32}$/u);
    expect(first.graph.tasks[0]?.state).toBe("running");
    expect(first.graph.sessions[0]?.state).toBe("running");
    expect(first.graph.workers[0]?.state).toBe("busy");

    const encoded = JSON.stringify(first);
    expect(encoded).not.toContain("conversation-native-1");
    expect(encoded).not.toContain("/Users/private/customer-project");
    expect(encoded).not.toContain("codex-private-provider");
  });

  it("produces an ordered P3 event stream for one completed native turn", () => {
    const [task] = collectAionUiWebSocketObservations({
      eventName: "turn.completed",
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: "conversation-1",
        turn_id: "turn-1",
        status: "finished",
        state: "ai_waiting_input",
        runtime: {
          state: "idle",
          turn_id: "turn-1",
        },
      },
    });
    const evidence = projectAionUiObservation(task);

    expect(evidence.domain).toBe("task");
    expect(evidence.events.map(({ sequence, type }) => ({ sequence, type }))).toEqual([
      {
        sequence: 1,
        type: "task.started",
      },
      {
        sequence: 2,
        type: "task.completed",
      },
    ]);
    assertCoreEventStream(evidence.events);
  });

  it("uses a canonical revision independent of capture time and property order", () => {
    const first = projectAionUiObservation({
      contractVersion: 1,
      kind: "provider",
      nativeId: "provider-1",
      observedAtMs: OBSERVED_AT,
      providerId: "provider-1",
      available: true,
      platform: "openai",
    });
    const replayed = projectAionUiObservation({
      platform: "openai",
      available: true,
      providerId: "provider-1",
      observedAtMs: OBSERVED_AT + 10_000,
      nativeId: "provider-1",
      kind: "provider",
      contractVersion: 1,
    });

    expect(replayed.nativeRevisionHash).toBe(first.nativeRevisionHash);
    expect(replayed.evidenceId).toBe(first.evidenceId);
    expect(replayed.capturedAt).not.toBe(first.capturedAt);
  });

  it("requires normalized millisecond timestamps at the projection boundary", () => {
    expect(() =>
      assertAionUiNativeObservation({
        contractVersion: 1,
        kind: "conversation",
        nativeId: "conversation-1",
        observedAtMs: OBSERVED_AT,
        conversationId: "conversation-1",
        conversationType: "acp",
        status: "running",
        createdAtMs: 1_700_000_000,
      }),
    ).toThrow(/normalized millisecond timestamp/u);
  });

  it("normalizes delegated core validation failures to invalid evidence", () => {
    const evidence = projectAionUiObservation({
      contractVersion: 1,
      kind: "provider",
      nativeId: "provider-1",
      observedAtMs: OBSERVED_AT,
      providerId: "provider-1",
      available: true,
    });
    const invalid = {
      ...evidence,
      graph: {
        ...evidence.graph,
        workspaces: [],
      },
    };

    try {
      assertAionUiShadowEvidence(invalid);
      throw new Error("Expected invalid shadow evidence");
    } catch (error) {
      expect(error).toBeInstanceOf(AionUiShadowProjectionError);
      expect(error).toMatchObject({ code: "invalid-evidence" });
    }
  });

  it("rejects undeclared fields before projection", () => {
    const observation = {
      contractVersion: 1,
      kind: "provider",
      nativeId: "provider-1",
      observedAtMs: OBSERVED_AT,
      providerId: "provider-1",
      available: true,
      apiKey: "forbidden",
    };

    expect(() => assertAionUiNativeObservation(observation)).toThrow(/undeclared field apiKey/u);
    expect(() => projectAionUiObservation(observation)).toThrow(AionUiShadowProjectionError);
  });
});
