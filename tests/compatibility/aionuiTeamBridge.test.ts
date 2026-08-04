// @vitest-environment node

import { describe, expect, it } from "vitest";

const teamId = `team-${"a".repeat(64)}`;
const runId = `team-run-${"b".repeat(64)}`;
const generalSlotId = `team-member-${"c".repeat(64)}`;
const codingSlotId = `team-member-${"d".repeat(64)}`;
const workspaceId = "workspace-team-ui-contract";

const createBody = Object.freeze({
  name: "Actestra delivery team",
  workspace: workspaceId,
  agents: Object.freeze([
    Object.freeze({
      name: "General lead",
      role: "lead",
      assistant_id: "actestra-general-worker",
      model: "default",
    }),
    Object.freeze({
      name: "Goose coding worker",
      role: "teammate",
      assistant_id: "actestra-goose-worker",
      model: "default",
    }),
  ]),
});

const nativeTeam = Object.freeze({
  id: teamId,
  user_id: "actestra-local-user",
  name: createBody.name,
  workspace: workspaceId,
  workspace_mode: "isolated",
  leader_assistant_id: generalSlotId,
  assistants: Object.freeze([
    Object.freeze({
      slot_id: generalSlotId,
      conversation_id: `actestra-team-conversation-${"e".repeat(64)}`,
      role: "leader",
      assistant_backend: "general",
      assistant_name: "General lead",
      status: "idle",
      assistant_id: "actestra-general-worker",
      model: "default",
      pending_confirmations: 0,
    }),
    Object.freeze({
      slot_id: codingSlotId,
      conversation_id: `actestra-team-conversation-${"f".repeat(64)}`,
      role: "teammate",
      assistant_backend: "goose",
      assistant_name: "Goose coding worker",
      status: "active",
      assistant_id: "actestra-goose-worker",
      model: "default",
      pending_confirmations: 1,
    }),
  ]),
  session_mode: "plan",
  created_at: 1_785_883_200_000,
  updated_at: 1_785_883_201_000,
});

const slotWork = Object.freeze([
  Object.freeze({
    slot_id: generalSlotId,
    role: "lead",
    state: "idle",
    queued_foreground_count: 0,
    queued_background_count: 0,
    active_turn_id: null,
    active_turn_started_at_ms: null,
    active_turn_elapsed_ms: null,
    active_turn_slow: null,
    active_turn_slow_threshold_ms: null,
    blocked_reason: null,
    team_run_id: runId,
  }),
  Object.freeze({
    slot_id: codingSlotId,
    role: "teammate",
    state: "blocked",
    queued_foreground_count: 0,
    queued_background_count: 0,
    active_turn_id: `team-turn-${"1".repeat(64)}`,
    active_turn_started_at_ms: 1_785_883_201_000,
    active_turn_elapsed_ms: 1_000,
    active_turn_slow: false,
    active_turn_slow_threshold_ms: 30_000,
    blocked_reason: "protected_approval",
    team_run_id: runId,
  }),
]);

const runEvent = Object.freeze({
  team_id: teamId,
  team_run_id: runId,
  source: "user_message",
  has_user_intervention: true,
  target_slot_id: generalSlotId,
  target_role: "lead",
  status: "running",
  queued_intent_count: 0,
  starting_batch_count: 0,
  running_batch_count: 1,
  active_enqueue_lease_count: 1,
  slot_work: slotWork,
  actestra: Object.freeze({
    authority: "Actestra Core",
    authority_source: "schema-15-team-run",
    revision: 4,
    status_explanation: "Goose is waiting for a protected-operation decision.",
    nodes: Object.freeze([
      Object.freeze({
        action_id: `team-action-${"2".repeat(64)}`,
        slot_id: codingSlotId,
        title: "Prepare the bounded patch",
        capability: "coding",
        state: "blocked",
        depends_on_action_ids: Object.freeze([]),
        blocked_reason: "protected-approval",
        blocked_explanation: "A protected repository write needs your decision.",
        current_executor: "Goose",
        next_actions: Object.freeze(["approve", "deny", "cancel"]),
        artifacts: Object.freeze([]),
      }),
    ]),
    result: null,
  }),
});

describe("AionUI-native Actestra Team bridge contract", () => {
  it("parses the fixed native Team CRUD, session, message, and run routes", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;

    expect(compatibility.AIONUI_TEAM_BRIDGE_CONTRACT_VERSION).toBe(1);
    expect(compatibility.ACTESTRA_TEAM_REQUEST_CHANNEL).toBe("actestra:team-request-v1");
    expect(compatibility.ACTESTRA_TEAM_EVENT_CHANNEL).toBe("actestra:team-event-v1");

    const cases = [
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: "/api/teams?user_id=actestra-local-user",
          body: undefined,
        },
        expected: { kind: "list" },
      },
      {
        request: { contractVersion: 1, method: "POST", path: "/api/teams", body: createBody },
        expected: { kind: "create", workspaceId },
      },
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: `/api/teams/${teamId}`,
          body: undefined,
        },
        expected: { kind: "get", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "DELETE",
          path: `/api/teams/${teamId}`,
          body: undefined,
        },
        expected: { kind: "remove", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/agents`,
          body: {
            assistant: {
              name: "General researcher",
              role: "teammate",
              assistant_id: "actestra-general-worker",
              model: "default",
            },
          },
        },
        expected: { kind: "add-member", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "DELETE",
          path: `/api/teams/${teamId}/agents/${codingSlotId}`,
          body: undefined,
        },
        expected: { kind: "remove-member", teamId, slotId: codingSlotId },
      },
      ...["POST", "DELETE"].map((method) => ({
        request: {
          contractVersion: 1,
          method,
          path: `/api/teams/${teamId}/session`,
          body: undefined,
        },
        expected: { kind: method === "POST" ? "ensure-session" : "stop-session", teamId },
      })),
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: `/api/teams/${teamId}/conversations/${encodeURIComponent(
            nativeTeam.assistants[0].conversation_id,
          )}/config-options`,
          body: undefined,
        },
        expected: { kind: "config-options", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/active-lease`,
          body: undefined,
        },
        expected: { kind: "active-lease", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "PATCH",
          path: `/api/teams/${teamId}/agents/${generalSlotId}/name`,
          body: { name: "Renamed General lead" },
        },
        expected: { kind: "rename-member", teamId, slotId: generalSlotId },
      },
      {
        request: {
          contractVersion: 1,
          method: "PATCH",
          path: `/api/teams/${teamId}/name`,
          body: { name: "Renamed Actestra Team" },
        },
        expected: { kind: "rename-team", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/session-mode`,
          body: { mode: "plan" },
        },
        expected: { kind: "set-session-mode", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "GET",
          path: `/api/teams/${teamId}/run-state`,
          body: undefined,
        },
        expected: { kind: "run-state", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/messages`,
          body: { content: "Prepare the release brief and matching code change." },
        },
        expected: { kind: "send-message", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/agents/${codingSlotId}/messages`,
          body: { content: "Explain the current blocked operation." },
        },
        expected: { kind: "send-member-message", teamId, slotId: codingSlotId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/agents/${codingSlotId}/attach`,
          body: undefined,
        },
        expected: { kind: "attach-member", teamId, slotId: codingSlotId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/runs/${runId}/cancel`,
          body: { reason: "Stop this Team run." },
        },
        expected: { kind: "cancel-run", teamId, runId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/runs/${runId}/agents/${codingSlotId}/cancel`,
          body: { reason: "Stop this coding slot." },
        },
        expected: { kind: "cancel-node", teamId, runId, slotId: codingSlotId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/runs/${runId}/agents/${codingSlotId}/pause`,
          body: { reason: "Pause before the protected write." },
        },
        expected: { kind: "pause-node", teamId, runId, slotId: codingSlotId },
      },
    ];

    for (const { request, expected } of cases) {
      expect(parse(request)).toMatchObject(expected);
    }
  });

  it("parses only the bounded Actestra controls needed by the visible Team journey", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;
    for (const action of ["resume", "retry", "replace", "handoff"] as const) {
      expect(
        parse({
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/runs/${runId}/agents/${codingSlotId}/${action}`,
          body: { reason: `Apply the visible ${action} control.` },
        }),
      ).toMatchObject({ kind: `${action}-node`, teamId, runId, slotId: codingSlotId });
    }
    for (const decision of ["approved", "denied"] as const) {
      expect(
        parse({
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/runs/${runId}/agents/${codingSlotId}/approval`,
          body: { decision },
        }),
      ).toMatchObject({ kind: "decide-approval", decision });
      expect(
        parse({
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/runs/${runId}/feedback`,
          body: { decision, note: "The result is understandable." },
        }),
      ).toMatchObject({ kind: "resolve-feedback", decision });
    }
  });

  it("validates native Team, run-state, event, and bounded Actestra explainability shapes", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertResponse = compatibility.assertAionUiTeamBridgeResponse as (value: unknown) => void;
    const assertEvent = compatibility.assertAionUiTeamEvent as (value: unknown) => void;

    for (const response of [
      { contractVersion: 1, status: 200, data: nativeTeam },
      { contractVersion: 1, status: 200, data: [nativeTeam] },
      { contractVersion: 1, status: 200, data: null },
      {
        contractVersion: 1,
        status: 200,
        data: {
          session_generation: "schema-15-revision-4",
          active_run: runEvent,
          slot_work: slotWork,
          activities: [
            {
              id: `team-message-${"4".repeat(64)}`,
              author: "You",
              content: "Prepare the bounded Team result.",
              tone: "user",
              occurred_at: 1_785_883_200_000,
            },
          ],
        },
      },
      {
        contractVersion: 1,
        status: 200,
        data: {
          enqueue_status: "accepted",
          message_id: `team-message-${"3".repeat(64)}`,
          run: runEvent,
        },
      },
      {
        contractVersion: 1,
        status: 503,
        code: "team-planner-unavailable",
        message: "The supervised Team planner is unavailable",
      },
    ]) {
      expect(() => assertResponse(response)).not.toThrow();
    }

    for (const event of [
      { type: "team.created", payload: { team_id: teamId, team_name: nativeTeam.name } },
      { type: "team.listChanged", payload: { team_id: teamId, action: "created" } },
      { type: "team.runAccepted", payload: runEvent },
      { type: "team.runUpdated", payload: runEvent },
      { type: "team.slotWorkChanged", payload: { team_id: teamId, slot_work: slotWork[1] } },
      {
        type: "team.teammateMessage",
        payload: {
          conversation_id: nativeTeam.assistants[0].conversation_id,
          content: "The Team run is waiting for approval.",
          from_slot_id: generalSlotId,
          from_name: "General lead",
        },
      },
    ]) {
      expect(() => assertEvent(event)).not.toThrow();
    }
  });

  it("rejects traversal, unbounded input, raw paths/files, and renderer-selected authority", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRequest = compatibility.assertAionUiTeamBridgeRequest as (value: unknown) => void;
    const assertResponse = compatibility.assertAionUiTeamBridgeResponse as (value: unknown) => void;

    const invalidRequests = [
      { contractVersion: 1, method: "GET", path: "/api/teams", body: undefined },
      { contractVersion: 1, method: "GET", path: "/api/teams/%2e%2e/private", body: undefined },
      { contractVersion: 1, method: "GET", path: "/api/teams?user_id=other-user", body: undefined },
      {
        contractVersion: 1,
        method: "POST",
        path: "/api/teams",
        body: { ...createBody, workspace: "/private/workspace" },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: "/api/teams",
        body: { ...createBody, rootPath: "/private/workspace" },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: "/api/teams",
        body: {
          ...createBody,
          agents: [
            { ...createBody.agents[0], model: "renderer-selected-model" },
            createBody.agents[1],
          ],
        },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${teamId}/messages`,
        body: { content: "Run this task.", files: ["/private/input.txt"] },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${teamId}/messages`,
        body: { content: "Run this task.", planId: `team-plan-${"4".repeat(64)}` },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${teamId}/runs/${runId}/agents/${codingSlotId}/approval`,
        body: { decision: "approved", approvalId: `approval-${"5".repeat(64)}` },
      },
      {
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${teamId}/runs/${runId}/cancel`,
        body: { reason: "x".repeat(2_049) },
      },
    ];
    for (const request of invalidRequests) {
      expect(() => assertRequest(request)).toThrow();
    }

    for (const response of [
      { contractVersion: 1, status: 200, data: { ...nativeTeam, workspace: "/private/workspace" } },
      {
        contractVersion: 1,
        status: 200,
        data: {
          ...runEvent,
          actestra: { ...runEvent.actestra, worker_id: "worker-private" },
        },
      },
      {
        contractVersion: 1,
        status: 500,
        code: "team-execution-failed",
        message: "private stack trace",
        cause: "sensitive",
      },
    ]) {
      expect(() => assertResponse(response)).toThrow();
    }
  });
});
