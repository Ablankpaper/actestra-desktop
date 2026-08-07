// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  ACTESTRA_TEAM_EVENT_CHANNEL,
  ACTESTRA_TEAM_REQUEST_CHANNEL,
  type AionUiTeamBridgeSuccessData,
  type AionUiTeamBridgeRoute,
  type AionUiTeamEvent,
  type NativeAionUiTeam,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  AionUiTeamBridgePortError,
  AionUiTeamBridgeService,
  registerAionUiTeamBridgeIpc,
  type AionUiTeamBridgeIpcEvent,
  type AionUiTeamBridgeIpcMain,
  type AionUiTeamBridgePort,
  type AionUiTeamBridgeWebContents,
} from "../../apps/desktop/src/main/compatibility/aionuiTeamBridgeService";

type IpcHandler = (event: AionUiTeamBridgeIpcEvent, ...args: unknown[]) => unknown;

class FakeIpcMain implements AionUiTeamBridgeIpcMain {
  readonly handlers = new Map<string, IpcHandler>();

  handle(channel: string, listener: IpcHandler): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, event: AionUiTeamBridgeIpcEvent, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`Missing handler ${channel}`);
    return handler(event, ...args);
  }
}

const teamId = `team-${"a".repeat(64)}`;
const leaderId = `team-member-${"b".repeat(64)}`;
const codingId = `team-member-${"c".repeat(64)}`;
const workspaceId = "workspace-team-bridge-service";

const team = Object.freeze({
  id: teamId,
  experience: "orchestrated",
  user_id: "actestra-local-user",
  name: "Actestra delivery Team",
  description: "Coordinate one bounded General and Goose delivery.",
  workspace: workspaceId,
  workspace_mode: "isolated",
  leader_assistant_id: leaderId,
  assistants: Object.freeze([
    Object.freeze({
      slot_id: leaderId,
      conversation_id: `actestra-team-conversation-${"d".repeat(64)}`,
      role: "leader",
      assistant_backend: "general",
      assistant_name: "General lead",
      status: "idle",
      assistant_id: "actestra-general-worker",
      model: "default",
      pending_confirmations: 0,
    }),
    Object.freeze({
      slot_id: codingId,
      conversation_id: `actestra-team-conversation-${"e".repeat(64)}`,
      role: "teammate",
      assistant_backend: "goose",
      assistant_name: "Goose coding worker",
      status: "idle",
      assistant_id: "actestra-goose-worker",
      model: "default",
      pending_confirmations: 0,
    }),
  ]),
  session_mode: "plan",
  created_at: 1_785_883_200_000,
  updated_at: 1_785_883_201_000,
}) satisfies NativeAionUiTeam;

function teamPort() {
  const handlers = new Set<(event: AionUiTeamEvent) => void>();
  return {
    dispatch: vi.fn(async (route: AionUiTeamBridgeRoute): Promise<AionUiTeamBridgeSuccessData> => {
      if (route.kind === "list") return [team];
      if (route.kind === "list-workspaces") {
        return {
          workspace_options: [{ workspace_id: workspaceId, display_name: "Launch workspace" }],
        };
      }
      if (route.kind === "run-state") {
        return {
          session_generation: null,
          submission: {
            availability: "unavailable",
            blocked_reason: "planner-unavailable",
            next_action: "restart-after-planner-admission",
            authority_source: "actestra-main-runtime",
          },
          active_run: null,
          slot_work: [],
          activities: [],
        } as const;
      }
      return team;
    }),
    subscribe: vi.fn((handler: (event: AionUiTeamEvent) => void) => {
      handlers.add(handler);
      return (): void => {
        handlers.delete(handler);
      };
    }),
    emit(event: AionUiTeamEvent): void {
      for (const handler of handlers) handler(event);
    },
  } satisfies AionUiTeamBridgePort & {
    emit(event: AionUiTeamEvent): void;
  };
}

const listRequest = Object.freeze({
  contractVersion: 1,
  method: "GET",
  path: "/api/teams?user_id=actestra-local-user",
  body: undefined,
});

describe("AionUiTeamBridgeService", () => {
  it("dispatches parsed Team creation, list, run-state, message, and control routes", async () => {
    const port = teamPort();
    const bridge = new AionUiTeamBridgeService(port);

    await expect(bridge.handle(listRequest)).resolves.toEqual({
      contractVersion: 1,
      status: 200,
      data: [team],
    });
    await bridge.handle({
      contractVersion: 1,
      method: "POST",
      path: "/api/teams",
      body: {
        experience: "orchestrated",
        name: team.name,
        description: team.description,
        workspace: workspaceId,
        agents: [
          {
            name: "General lead",
            role: "lead",
            assistant_id: "actestra-general-worker",
            model: "default",
          },
          {
            name: "Goose coding worker",
            role: "teammate",
            assistant_id: "actestra-goose-worker",
            model: "default",
          },
        ],
      },
    });
    await bridge.handle({
      contractVersion: 1,
      method: "GET",
      path: "/api/teams/workspace-options",
      body: undefined,
    });
    await expect(
      bridge.handle({
        contractVersion: 1,
        method: "GET",
        path: `/api/teams/${teamId}/run-state`,
        body: undefined,
      }),
    ).resolves.toEqual({
      contractVersion: 1,
      status: 200,
      data: {
        session_generation: null,
        submission: {
          availability: "unavailable",
          blocked_reason: "planner-unavailable",
          next_action: "restart-after-planner-admission",
          authority_source: "actestra-main-runtime",
        },
        active_run: null,
        slot_work: [],
        activities: [],
      },
    });
    await bridge.handle({
      contractVersion: 1,
      method: "POST",
      path: `/api/teams/${teamId}/messages`,
      body: {
        content: "Prepare the release brief and bounded code change.",
        request_nonce: `team-request-${"9".repeat(64)}`,
      },
    });
    const runId = `team-run-${"f".repeat(64)}`;
    await bridge.handle({
      contractVersion: 1,
      method: "POST",
      path: `/api/teams/${teamId}/runs/${runId}/agents/${codingId}/pause`,
      body: { reason: "Pause before the protected operation." },
    });

    expect(port.dispatch.mock.calls.map(([route]) => route.kind)).toEqual([
      "list",
      "create",
      "list-workspaces",
      "run-state",
      "send-message",
      "pause-node",
    ]);
    expect(port.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "pause-node",
        teamId,
        runId,
        slotId: codingId,
      }),
    );
  });

  it("maps invalid, unavailable, typed, and private failures to fixed bounded responses", async () => {
    await expect(new AionUiTeamBridgeService(null).handle(listRequest)).resolves.toEqual({
      contractVersion: 1,
      status: 503,
      code: "team-unavailable",
      message: "Actestra Team work is unavailable",
    });

    const modelUnavailable = teamPort();
    modelUnavailable.dispatch.mockRejectedValueOnce(
      new AionUiTeamBridgePortError("team-model-unavailable", "private model directory details"),
    );
    await expect(
      new AionUiTeamBridgeService(modelUnavailable).handle(listRequest),
    ).resolves.toEqual({
      contractVersion: 1,
      status: 409,
      code: "team-model-unavailable",
      message: "The selected Team model is unavailable",
    });

    const port = teamPort();
    const bridge = new AionUiTeamBridgeService(port);
    await expect(
      bridge.handle({ ...listRequest, body: { rootPath: "/private/unowned" } }),
    ).resolves.toMatchObject({ status: 400, code: "team-invalid-request" });
    expect(port.dispatch).not.toHaveBeenCalled();

    for (const [code, status] of [
      ["team-not-found", 404],
      ["team-active", 409],
      ["team-planner-unavailable", 503],
    ] as const) {
      port.dispatch.mockRejectedValueOnce(
        new AionUiTeamBridgePortError(code, "/private/worker-root must stay private"),
      );
      const response = await bridge.handle(listRequest);
      expect(response).toMatchObject({ code, status });
      expect(JSON.stringify(response)).not.toContain("/private/worker-root");
    }

    port.dispatch.mockRejectedValueOnce(new Error("credential=private-value"));
    const failed = await bridge.handle(listRequest);
    expect(failed).toEqual({
      contractVersion: 1,
      status: 500,
      code: "team-execution-failed",
      message: "The Team operation failed",
    });
    expect(JSON.stringify(failed)).not.toContain("private-value");
  });

  it("rejects invalid provider DTOs and forwards only validated Team events", async () => {
    const port = teamPort();
    port.dispatch.mockResolvedValueOnce({ ...team, workspace: "/private/unowned" });
    const bridge = new AionUiTeamBridgeService(port);
    await expect(bridge.handle(listRequest)).resolves.toMatchObject({
      status: 500,
      code: "team-execution-failed",
    });

    const received: AionUiTeamEvent[] = [];
    const unsubscribe = bridge.subscribe((event) => received.push(event));
    port.emit({ type: "team.created", payload: { team_id: teamId, team_name: team.name } });
    port.emit({
      type: "team.created",
      payload: { team_id: teamId, team_name: ` ${team.name}` },
    } as AionUiTeamEvent);
    expect(received).toEqual([
      { type: "team.created", payload: { team_id: teamId, team_name: team.name } },
    ]);
    unsubscribe();
  });

  it("registers one trusted-main-frame IPC handler and disposes event delivery", async () => {
    const port = teamPort();
    const bridge = new AionUiTeamBridgeService(port);
    const ipcMain = new FakeIpcMain();
    const mainFrame = {};
    const sent: unknown[][] = [];
    const trusted = {
      mainFrame,
      send: (...args: unknown[]) => sent.push(args),
      isDestroyed: () => false,
    } satisfies AionUiTeamBridgeWebContents;
    const event = { sender: trusted, senderFrame: mainFrame };
    const dispose = registerAionUiTeamBridgeIpc({
      ipcMain,
      trustedWebContents: () => trusted,
      bridge,
    });

    await expect(
      ipcMain.invoke(ACTESTRA_TEAM_REQUEST_CHANNEL, event, listRequest),
    ).resolves.toMatchObject({ status: 200, data: [team] });
    await expect(
      ipcMain.invoke(ACTESTRA_TEAM_REQUEST_CHANNEL, event, listRequest, "extra"),
    ).resolves.toMatchObject({ status: 400, code: "team-invalid-request" });
    await expect(
      ipcMain.invoke(
        ACTESTRA_TEAM_REQUEST_CHANNEL,
        { sender: { mainFrame: {} }, senderFrame: {} },
        listRequest,
      ),
    ).resolves.toMatchObject({ status: 403, code: "team-untrusted-sender" });

    const created = {
      type: "team.created",
      payload: { team_id: teamId, team_name: team.name },
    } as const;
    port.emit(created);
    expect(sent).toEqual([[ACTESTRA_TEAM_EVENT_CHANNEL, created]]);

    dispose();
    dispose();
    expect(ipcMain.handlers.size).toBe(0);
    port.emit({ type: "team.removed", payload: { team_id: teamId } });
    expect(sent).toHaveLength(1);
  });
});
