// @vitest-environment node

import { describe, expect, it } from "vitest";

const teamId = `team-${"a".repeat(64)}`;
const standardTeamId = "019fd371-7aa5-7f81-8a71-e3169de4946a";
const runId = `team-run-${"b".repeat(64)}`;
const generalSlotId = `team-member-${"c".repeat(64)}`;
const codingSlotId = `team-member-${"d".repeat(64)}`;
const workspaceId = "workspace-team-ui-contract";

const createBody = Object.freeze({
  experience: "orchestrated",
  name: "Actestra delivery team",
  description: "Coordinate one bounded General and Goose delivery.",
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

const standardCreateBody = Object.freeze({
  experience: "standard",
  user_id: "system_default_user",
  name: "Native CLI Team",
  workspace: "/private/tmp/actestra-standard-team",
  workspace_mode: "shared",
  agents: Object.freeze([
    Object.freeze({
      name: "Gemini lead",
      role: "lead",
      assistant_id: "assistant-gemini",
      requested_model: "gemini-3.1-pro-high",
    }),
    Object.freeze({
      name: "Codex teammate",
      role: "teammate",
      assistant_id: "assistant-codex",
      requested_model: null,
    }),
  ]),
});

const nativeTeam = Object.freeze({
  id: teamId,
  experience: "orchestrated",
  user_id: "actestra-local-user",
  name: createBody.name,
  description: createBody.description,
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
  it("parses standard Team creation as a bounded selection intent without renderer authority", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;
    const assertResponse = compatibility.assertAionUiTeamBridgeResponse as (value: unknown) => void;
    const request = {
      contractVersion: 1,
      method: "POST",
      path: "/api/teams",
      body: standardCreateBody,
    };

    expect(parse(request)).toEqual({
      kind: "create-standard",
      userId: "system_default_user",
      name: "Native CLI Team",
      workspace: "/private/tmp/actestra-standard-team",
      workspaceMode: "shared",
      members: [
        {
          displayName: "Gemini lead",
          role: "leader",
          assistantId: "assistant-gemini",
          requestedModel: "gemini-3.1-pro-high",
        },
        {
          displayName: "Codex teammate",
          role: "teammate",
          assistantId: "assistant-codex",
          requestedModel: null,
        },
      ],
    });
    expect(() =>
      parse({
        ...request,
        body: { ...standardCreateBody, team_id: "renderer-owned-team" },
      }),
    ).toThrow();
    expect(() =>
      parse({
        ...request,
        body: { ...standardCreateBody, user_id: "renderer-selected-user" },
      }),
    ).toThrow();
    expect(() =>
      parse({
        ...request,
        body: {
          ...standardCreateBody,
          agents: [{ ...standardCreateBody.agents[0], model: "renderer-authoritative-model" }],
        },
      }),
    ).toThrow();

    const responseWithoutSessionMode = {
      id: "native-team-1",
      experience: "standard",
      user_id: "system_default_user",
      name: "Native CLI Team",
      workspace: "/private/tmp/actestra-standard-team",
      workspace_mode: "shared",
      leader_assistant_id: "native-slot-gemini",
      assistants: [
        {
          slot_id: "native-slot-gemini",
          conversation_id: "native-conversation-gemini",
          role: "leader",
          assistant_backend: "gemini",
          assistant_name: "Gemini lead",
          status: "pending",
          assistant_id: "assistant-gemini",
          model: "gemini-3.1-pro-preview",
          pending_confirmations: 0,
        },
      ],
      created_at: 1_785_883_200_000,
      updated_at: 1_785_883_200_000,
    };
    const response = { contractVersion: 1, status: 200, data: responseWithoutSessionMode };

    expect(() => assertResponse(response)).not.toThrow();
    expect(() =>
      assertResponse({ ...response, data: { ...response.data, session_mode: "plan" } }),
    ).not.toThrow();
    expect(() =>
      assertResponse({ ...response, data: { ...response.data, session_mode: "" } }),
    ).toThrow();
    expect(() =>
      assertResponse({ ...response, data: { ...response.data, renderer_owned: true } }),
    ).toThrow();
  });

  it("parses standard Team add-member as a bounded selection intent for a native Team identity", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;
    const request = {
      contractVersion: 1,
      method: "POST",
      path: "/api/teams/native-team-1/agents",
      body: {
        experience: "standard",
        assistant: {
          name: "Gemini teammate",
          role: "teammate",
          assistant_id: "assistant-gemini",
          requested_model: "gemini-3.1-pro-high",
        },
      },
    };

    expect(parse(request)).toEqual({
      kind: "add-standard-member",
      teamId: "native-team-1",
      member: {
        displayName: "Gemini teammate",
        role: "teammate",
        assistantId: "assistant-gemini",
        requestedModel: "gemini-3.1-pro-high",
      },
    });
    expect(() =>
      parse({
        ...request,
        body: {
          ...request.body,
          assistant: { ...request.body.assistant, model: "renderer-authoritative-model" },
        },
      }),
    ).toThrow();
  });

  it("admits only a bounded Main-projected standard Team runtime model catalog", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertResponse = compatibility.assertAionUiTeamBridgeResponse as (value: unknown) => void;
    const response = {
      contractVersion: 1,
      status: 200,
      data: {
        config_options: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            current_value: "auto-gemini-3",
            options: [
              {
                value: "auto-gemini-3",
                name: "Auto (Gemini 3)",
                description: "Let Gemini CLI select an admitted Gemini 3 model.",
              },
            ],
          },
        ],
      },
    };

    expect(() => assertResponse(response)).not.toThrow();
    expect(() =>
      assertResponse({
        ...response,
        data: {
          config_options: [
            {
              ...response.data.config_options[0],
              current_value: "removed-model",
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      assertResponse({
        ...response,
        data: {
          config_options: [
            {
              ...response.data.config_options[0],
              options: [
                ...response.data.config_options[0].options,
                { value: "https://outside.example/model", name: "External model" },
              ],
            },
          ],
        },
      }),
    ).toThrow();
  });

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
        request: {
          contractVersion: 1,
          method: "GET",
          path: "/api/teams/workspace-options",
          body: undefined,
        },
        expected: { kind: "list-workspaces" },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: "/api/teams/workspace-options/select",
          body: undefined,
        },
        expected: { kind: "select-workspace" },
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
          method: "PUT",
          path: `/api/teams/${standardTeamId}/conversations/${encodeURIComponent(
            "native-conversation-gemini",
          )}/config-options/model`,
          body: { value: "gemini-3.1-pro-preview" },
        },
        expected: {
          kind: "set-config-option",
          teamId: standardTeamId,
          conversationId: "native-conversation-gemini",
          optionId: "model",
          value: "gemini-3.1-pro-preview",
        },
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
          body: {
            conversation_id: "actestra-team-conversation-general",
            mode: "plan",
          },
        },
        expected: {
          kind: "set-session-mode",
          teamId,
          conversationId: "actestra-team-conversation-general",
          mode: "plan",
        },
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
          body: {
            content: "Prepare the release brief and matching code change.",
            request_nonce: `team-request-${"1".repeat(64)}`,
          },
        },
        expected: { kind: "send-message", teamId },
      },
      {
        request: {
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${teamId}/agents/${codingSlotId}/messages`,
          body: {
            content: "Explain the current blocked operation.",
            request_nonce: `team-request-${"2".repeat(64)}`,
          },
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

  it("parses a standard Team UUID as a bounded experience identity for item routes", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;

    expect(
      parse({
        contractVersion: 1,
        method: "GET",
        path: `/api/teams/${standardTeamId}`,
        body: undefined,
      }),
    ).toEqual({ kind: "get", teamId: standardTeamId });
    expect(
      parse({
        contractVersion: 1,
        method: "DELETE",
        path: `/api/teams/${standardTeamId}`,
        body: undefined,
      }),
    ).toEqual({ kind: "remove", teamId: standardTeamId });
    expect(
      parse({
        contractVersion: 1,
        method: "PATCH",
        path: `/api/teams/${standardTeamId}/name`,
        body: { name: "Renamed standard Team" },
      }),
    ).toEqual({ kind: "rename-team", teamId: standardTeamId, name: "Renamed standard Team" });
    const standardSlotId = "native-slot-claude";
    expect(
      parse({
        contractVersion: 1,
        method: "DELETE",
        path: `/api/teams/${standardTeamId}/agents/${standardSlotId}`,
        body: undefined,
      }),
    ).toEqual({ kind: "remove-member", teamId: standardTeamId, slotId: standardSlotId });
    expect(
      parse({
        contractVersion: 1,
        method: "PATCH",
        path: `/api/teams/${standardTeamId}/agents/${standardSlotId}/name`,
        body: { name: "Claude reviewer" },
      }),
    ).toEqual({
      kind: "rename-member",
      teamId: standardTeamId,
      slotId: standardSlotId,
      name: "Claude reviewer",
    });
    expect(() =>
      parse({
        contractVersion: 1,
        method: "GET",
        path: "/api/teams/%0A",
        body: undefined,
      }),
    ).toThrow();
    expect(() =>
      parse({
        contractVersion: 1,
        method: "DELETE",
        path: `/api/teams/${standardTeamId}/agents/native-slot-%0A`,
        body: undefined,
      }),
    ).toThrow();
  });

  it("parses bounded standard Team attachment intents without accepting extra authority fields", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;

    expect(
      parse({
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${standardTeamId}/messages`,
        body: {
          content: "Review these selected workspace files.",
          files: ["/private/tmp/actestra-standard-team/README.md", "docs/PROJECT_STATUS.md"],
          request_nonce: `team-request-${"3".repeat(64)}`,
        },
      }),
    ).toEqual({
      kind: "send-message",
      teamId: standardTeamId,
      content: "Review these selected workspace files.",
      files: ["/private/tmp/actestra-standard-team/README.md", "docs/PROJECT_STATUS.md"],
      requestNonce: `team-request-${"3".repeat(64)}`,
    });
    expect(() =>
      parse({
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${standardTeamId}/messages`,
        body: {
          content: "Review this file.",
          files: ["README.md"],
          request_nonce: `team-request-${"4".repeat(64)}`,
          workspace: "/private/tmp/actestra-standard-team",
        },
      }),
    ).toThrow();
  });

  it("parses bounded provider-owned standard Team run controls without renderer inference", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;

    expect(
      parse({
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${standardTeamId}/runs/native-run-1/agents/native-slot-claude/pause`,
        body: { reason: "user_stop" },
      }),
    ).toEqual({
      kind: "pause-node",
      teamId: standardTeamId,
      runId: "native-run-1",
      slotId: "native-slot-claude",
      reason: "user_stop",
    });
    expect(() =>
      parse({
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${standardTeamId}/runs/%2e%2e/agents/native-slot-claude/pause`,
        body: { reason: "user_stop" },
      }),
    ).toThrow();
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

  it("requires one bounded client nonce for standard Team message effect idempotency", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const parse = compatibility.parseAionUiTeamBridgeRequest as (value: unknown) => unknown;
    const requestNonce = `team-request-${"8".repeat(64)}`;

    expect(
      parse({
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${standardTeamId}/messages`,
        body: { content: "Review this workspace.", files: [], request_nonce: requestNonce },
      }),
    ).toMatchObject({ kind: "send-message", requestNonce });
    expect(
      parse({
        contractVersion: 1,
        method: "POST",
        path: `/api/teams/${standardTeamId}/agents/native-slot-claude/messages`,
        body: { content: "Review this file.", request_nonce: requestNonce },
      }),
    ).toMatchObject({ kind: "send-member-message", requestNonce });
    for (const body of [
      { content: "Missing nonce.", files: [] },
      { content: "Padded nonce.", files: [], request_nonce: ` ${requestNonce}` },
      { content: "Oversized nonce.", files: [], request_nonce: "x".repeat(129) },
    ]) {
      expect(() =>
        parse({
          contractVersion: 1,
          method: "POST",
          path: `/api/teams/${standardTeamId}/messages`,
          body,
        }),
      ).toThrow();
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
          submission: {
            availability: "available",
            blocked_reason: null,
            next_action: "submit-task",
            authority_source: "actestra-main-runtime",
          },
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
      { type: "team.removed", payload: { team_id: standardTeamId } },
      { type: "team.listChanged", payload: { team_id: standardTeamId, action: "removed" } },
      {
        type: "team.agentRenamed",
        payload: {
          team_id: standardTeamId,
          slot_id: "native-slot-claude",
          name: "Claude reviewer",
        },
      },
      {
        type: "team.agentRemoved",
        payload: { team_id: standardTeamId, slot_id: "native-slot-claude" },
      },
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

  it("validates a bounded provider-owned standard Team run acknowledgement without schema-15 identities", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertResponse = compatibility.assertAionUiTeamBridgeResponse as (value: unknown) => void;
    const acknowledgement = {
      experience: "standard",
      enqueue_status: "accepted",
      message_id: "native-message-1",
      run: {
        team_id: standardTeamId,
        team_run_id: "native-run-1",
        source: "user_message",
        has_user_intervention: false,
        target_slot_id: "native-slot-claude",
        target_role: "lead",
        status: "accepted",
        queued_intent_count: 0,
        starting_batch_count: 1,
        running_batch_count: 0,
        active_enqueue_lease_count: 1,
        slot_work: [],
      },
    };

    expect(() =>
      assertResponse({ contractVersion: 1, status: 200, data: acknowledgement }),
    ).not.toThrow();
    expect(() =>
      assertResponse({
        contractVersion: 1,
        status: 200,
        data: { ...acknowledgement, run: { ...acknowledgement.run, team_id: "../foreign" } },
      }),
    ).toThrow();
    expect(() =>
      assertResponse({
        contractVersion: 1,
        status: 200,
        data: { ...acknowledgement, private_runtime: "/tmp/runtime" },
      }),
    ).toThrow();
  });

  it("validates a bounded provider-owned standard Team run-state projection", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertResponse = compatibility.assertAionUiTeamBridgeResponse as (value: unknown) => void;
    const state = {
      experience: "standard",
      session_generation: "native-session-1",
      active_run: null,
      slot_work: [],
    };

    expect(() => assertResponse({ contractVersion: 1, status: 200, data: state })).not.toThrow();
    expect(() =>
      assertResponse({
        contractVersion: 1,
        status: 200,
        data: { ...state, credential: "private" },
      }),
    ).toThrow();
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
        body: { ...createBody, description: 42 },
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
        status: 200,
        data: {
          session_generation: null,
          submission: {
            availability: "available",
            blocked_reason: "planner-unavailable",
            next_action: "restart-after-planner-admission",
            authority_source: "actestra-main-runtime",
          },
          active_run: null,
          slot_work: [],
          activities: [],
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
