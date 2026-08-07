// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  artifactId,
  instant,
  normalizeTeamExperienceBinding,
  normalizeTeamPlannerRequest,
  taskId,
  teamRunId,
  workspaceGrantId,
  workspaceId,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  type Instant,
  type TeamPlanCandidate,
} from "../../apps/desktop/src/core";
import type {
  AionUiTeamBridgeRoute,
  AionUiTeamEvent,
  NativeAionUiTeam,
  NativeAionUiTeamRunAck,
  NativeAionUiTeamRunState,
  NativeAionUiTeamWorkspaceOption,
} from "../../apps/desktop/src/compatibility/aionui";
import * as AionUiTeamServices from "../../apps/desktop/src/main/compatibility/aionuiTeamService";
import { AionUiTeamBridgeService } from "../../apps/desktop/src/main/compatibility/aionuiTeamBridgeService";
import type {
  AionUiStandardTeamCreationPort,
  AionUiTeamOrchestratorPort,
} from "../../apps/desktop/src/main/compatibility/aionuiTeamService";
import {
  TeamOrchestratorService,
  type TeamResultAggregationPort,
  type TeamWorkerExecutionResult,
  type TeamWorkerExecutionPort,
} from "../../apps/desktop/src/main/orchestration/teamOrchestratorService";
import { TeamPlanAdmissionService } from "../../apps/desktop/src/main/orchestration/teamPlanAdmissionService";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { createTeamRunFixture } from "../fixtures/teamRun";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-team-service-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-team-service-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function clock() {
  let offset = 0;
  return (): Instant => {
    const value = new Date(Date.UTC(2026, 7, 5, 2, 0, offset)).toISOString();
    offset += 1;
    return instant(value);
  };
}

const createRoute = Object.freeze({
  kind: "create",
  experience: "orchestrated",
  name: "Actestra delivery Team",
  description: "Coordinate a bounded release brief and coding change.",
  workspaceId: "workspace-aionui-team-service",
  members: Object.freeze([
    Object.freeze({ displayName: "General lead", role: "leader", capability: "general" }),
    Object.freeze({ displayName: "Goose coding worker", role: "teammate", capability: "coding" }),
  ]),
}) satisfies AionUiTeamBridgeRoute;

const { AionUiTeamService } = AionUiTeamServices;

type StandardTeamBackend = Readonly<{
  getAssistant: (assistantId: string) => Promise<unknown>;
  listManagedAgents: () => Promise<unknown>;
  discoverAssistantModelCatalog?: (assistantId: string) => Promise<unknown>;
  listTeams?: () => Promise<unknown>;
  getTeam?: (teamId: string) => Promise<unknown>;
  createTeam: (body: unknown) => Promise<unknown>;
  renameTeam?: (teamId: string, name: string) => Promise<unknown>;
  removeTeam?: (teamId: string) => Promise<unknown>;
  addTeamMember?: (teamId: string, body: unknown) => Promise<unknown>;
  renameTeamMember?: (teamId: string, slotId: string, name: string) => Promise<unknown>;
  removeTeamMember?: (teamId: string, slotId: string) => Promise<unknown>;
  setTeamSessionMode?: (teamId: string, mode: string) => Promise<unknown>;
  ensureTeamSession?: (teamId: string) => Promise<unknown>;
  stopTeamSession?: (teamId: string) => Promise<unknown>;
  renewTeamActiveLease?: (teamId: string) => Promise<unknown>;
  sendTeamMessage?: (teamId: string, body: unknown) => Promise<unknown>;
  sendTeamMemberMessage?: (teamId: string, slotId: string, body: unknown) => Promise<unknown>;
  getTeamRunState?: (teamId: string) => Promise<unknown>;
  pauseTeamMemberWork?: (
    teamId: string,
    runId: string,
    slotId: string,
    body: unknown,
  ) => Promise<unknown>;
  cancelTeamMemberWork?: (
    teamId: string,
    runId: string,
    slotId: string,
    body: unknown,
  ) => Promise<unknown>;
  cancelTeamRun?: (teamId: string, runId: string, body: unknown) => Promise<unknown>;
  attachTeamMember?: (teamId: string, slotId: string) => Promise<unknown>;
  reconcileConfigOptions?: (teamId: string, conversationId: string) => Promise<unknown>;
  setConfigOption?: (
    teamId: string,
    conversationId: string,
    optionId: string,
    value: string,
  ) => Promise<unknown>;
  close?: () => Promise<void>;
}>;

type StandardTeamCreationService = AionUiStandardTeamCreationPort;

type StandardTeamCreationServiceConstructor = new (options: {
  backend: StandardTeamBackend;
}) => StandardTeamCreationService;

type StandardTeamLoopbackBackendConstructor = new () => StandardTeamBackend;

type StandardTeamProbeProcessGuard = Readonly<{
  capture: (conversationId: string) => Promise<unknown>;
  cleanup: (snapshot: unknown) => Promise<void>;
}>;

type GuardedStandardTeamLoopbackBackendConstructor = new (options: {
  probeProcessGuard: StandardTeamProbeProcessGuard;
}) => StandardTeamBackend;

type ProbeProcessGuard = Readonly<{
  capture: (conversationId: string) => Promise<unknown>;
  cleanup: (snapshot: unknown) => Promise<void>;
}>;

type ProbeProcessGuardConstructor = new (options: {
  dataDirectory: string;
  terminationGraceMs?: number;
}) => ProbeProcessGuard;

function standardTeamServiceConstructor(): StandardTeamCreationServiceConstructor {
  const candidate = (AionUiTeamServices as Record<string, unknown>)[
    "AionUiStandardTeamCreationService"
  ];
  expect(candidate).toBeTypeOf("function");
  return candidate as StandardTeamCreationServiceConstructor;
}

function standardTeamLoopbackBackendConstructor(): StandardTeamLoopbackBackendConstructor {
  const candidate = (AionUiTeamServices as Record<string, unknown>)[
    "LoopbackAionUiStandardTeamBackend"
  ];
  expect(candidate).toBeTypeOf("function");
  return candidate as StandardTeamLoopbackBackendConstructor;
}

function guardedStandardTeamLoopbackBackendConstructor(): GuardedStandardTeamLoopbackBackendConstructor {
  return standardTeamLoopbackBackendConstructor() as GuardedStandardTeamLoopbackBackendConstructor;
}

function newStandardTeamLoopbackBackend(
  Backend: StandardTeamLoopbackBackendConstructor,
): StandardTeamBackend {
  const GuardedBackend = Backend as GuardedStandardTeamLoopbackBackendConstructor;
  return new GuardedBackend({
    probeProcessGuard: {
      capture: async (conversationId) =>
        Object.freeze({ conversationId, processes: Object.freeze([]) }),
      cleanup: async () => {},
    },
  });
}

function withSafeSessionInitialization(backend: StandardTeamBackend): StandardTeamBackend {
  let created: unknown;
  const sessionModes = new Map<string, string>();
  const observeMode = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const team = value as Record<string, unknown>;
    const id = typeof team.id === "string" ? team.id : null;
    const mode = id === null ? undefined : sessionModes.get(id);
    return mode === undefined ? value : { ...team, session_mode: mode };
  };
  return {
    ...backend,
    createTeam: async (body) => {
      created = await backend.createTeam(body);
      return created;
    },
    getTeam: async (teamId) =>
      observeMode(backend.getTeam === undefined ? created : await backend.getTeam(teamId)),
    setTeamSessionMode: async (teamId, mode) => {
      const result = await backend.setTeamSessionMode?.(teamId, mode);
      sessionModes.set(teamId, mode);
      return result ?? null;
    },
    ...(backend.listTeams === undefined
      ? {}
      : {
          listTeams: async () => {
            const teams = await backend.listTeams!();
            return Array.isArray(teams) ? teams.map(observeMode) : teams;
          },
        }),
  };
}

function probeProcessGuardConstructor(): ProbeProcessGuardConstructor {
  const candidate = (AionUiTeamServices as Record<string, unknown>)["AionCoreProbeProcessGuard"];
  expect(candidate).toBeTypeOf("function");
  return candidate as ProbeProcessGuardConstructor;
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function processGroupIsAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

async function waitForCondition(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for process postcondition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function terminateProcess(child: ChildProcess | null): void {
  if (child?.pid === undefined || !processIsAlive(child.pid)) return;
  child.kill("SIGKILL");
}

function backendResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function standardCreateIntent(requestedModel: string | null = null) {
  return Object.freeze({
    kind: "create-standard",
    userId: "system_default_user",
    name: "Native CLI Team",
    workspace: "/private/tmp/actestra-standard-team",
    workspaceMode: "shared",
    members: Object.freeze([
      Object.freeze({
        displayName: "Gemini lead",
        role: "leader",
        assistantId: "assistant-gemini",
        requestedModel,
      }),
    ]),
  });
}

function geminiAssistant(defaultModel: string) {
  return {
    id: "assistant-gemini",
    team_selectable: true,
    engine: {
      agent_id: "agent-gemini",
      agent: { type: "acp", source: "builtin", acp_backend: "gemini" },
    },
    defaults: { model: { mode: "fixed", value: defaultModel } },
    preferences: { last_model_id: defaultModel },
  };
}

function geminiManagedAgent(currentModel: string, availableModels: readonly string[]) {
  return {
    id: "agent-gemini",
    backend: "gemini",
    installed: true,
    enabled: true,
    status: "online",
    config_options: [
      {
        id: "model",
        category: "model",
        type: "select",
        current_value: currentModel,
        options: availableModels.map((value) => ({ value, name: value })),
      },
    ],
  };
}

function persistedStandardTeam(model: string) {
  return {
    id: "native-team-1",
    user_id: "system_default_user",
    name: "Native CLI Team",
    workspace: "/private/tmp/actestra-standard-team",
    workspace_mode: "shared",
    leader_assistant_id: "native-slot-gemini",
    assistants: [
      {
        slot_id: "native-slot-gemini",
        conversation_id: "native-conversation-gemini",
        role: "lead",
        assistant_backend: "gemini",
        assistant_name: "Gemini lead",
        status: "pending",
        assistant_id: "assistant-gemini",
        model,
        pending_confirmations: 0,
      },
    ],
    session_mode: "plan",
    created_at: 1_785_883_200_000,
    updated_at: 1_785_883_200_000,
  };
}

function persistedAionCoreStandardTeam(model: string) {
  const {
    user_id: _userId,
    workspace_mode: _workspaceMode,
    session_mode: _sessionMode,
    ...team
  } = persistedStandardTeam(model);
  return team;
}

function persistedStandardAssistant(model: string) {
  return {
    slot_id: "native-slot-gemini-teammate",
    conversation_id: "native-conversation-gemini-teammate",
    role: "teammate",
    assistant_backend: "gemini",
    assistant_name: "Gemini teammate",
    status: "pending",
    assistant_id: "assistant-gemini",
    model,
    pending_confirmations: 0,
  };
}

function requireNativeTeam(value: unknown): NativeAionUiTeam {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    throw new Error("Expected one native Team");
  }
  return value as NativeAionUiTeam;
}

function candidateFor(value: unknown): TeamPlanCandidate {
  const request = normalizeTeamPlannerRequest(value);
  return {
    protocolVersion: 1,
    correlationId: request.correlationId,
    planVersion: request.planVersion,
    summary: "Run General and Goose work in parallel, then request human feedback.",
    nodes: [
      {
        candidateKey: "general",
        title: "Prepare the bounded brief",
        kind: "worker",
        capability: "general",
        dependsOn: [],
        expectedArtifactKind: "document",
        completionCriteria: "One bounded brief is available.",
        risk: "low",
        maxAttempts: 1,
      },
      {
        candidateKey: "coding",
        title: "Prepare the bounded patch",
        kind: "worker",
        capability: "coding",
        dependsOn: [],
        expectedArtifactKind: "file",
        completionCriteria: "One bounded patch is available.",
        risk: "medium",
        maxAttempts: 1,
      },
      {
        candidateKey: "feedback",
        title: "Request user feedback",
        kind: "human-feedback",
        dependsOn: ["general", "coding"],
        completionCriteria: "The user accepts or rejects the result.",
        risk: "medium",
      },
    ],
  };
}

describe("AionUiTeamService", () => {
  it("fails closed when a loopback model-catalog backend has no probe process guard", () => {
    const Backend = standardTeamLoopbackBackendConstructor();

    expect(() => new Backend()).toThrow("process guard is required");
  });

  it("uses the current Main AionCore loopback port and only fixed standard-Team routes", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutRequests = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((delay) => nativeTimeout(delay));
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (url.endsWith("/api/assistants/assistant%2Fgemini")) {
        return backendResponse({ id: "assistant/gemini" });
      }
      if (url.endsWith("/api/agents/management")) {
        return backendResponse([{ id: "agent-gemini" }]);
      }
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        return backendResponse({
          id: "probe-conversation-gemini",
          assistant: { id: "assistant/gemini" },
          extra: { is_temporary_workspace: true, is_health_check: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-gemini/runtime/ensure")) {
        return backendResponse({
          config_options: geminiManagedAgent("gemini-3.1-pro-high", ["auto-gemini-3"])
            .config_options,
        });
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-gemini") &&
        init?.method === "DELETE"
      ) {
        return backendResponse(null);
      }
      if (url.endsWith("/api/teams")) {
        return backendResponse({ id: "native-team-1" });
      }
      if (url.endsWith("/api/teams/native-team-1/agents")) {
        return backendResponse(persistedStandardAssistant("gemini-3.1-pro-preview"));
      }
      if (url.endsWith("/api/teams/native-team-1/session-mode")) {
        expect(init?.body).toBe(JSON.stringify({ mode: "default" }));
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/teams/native-team-1/session")) {
        expect(init?.body).toBeUndefined();
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/teams/native-team-1/active-lease")) {
        expect(init?.body).toBeUndefined();
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/teams/native-team-1/runs/native-run-1/cancel")) {
        expect(init?.body).toBe(JSON.stringify({ reason: "Stop now." }));
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected standard Team loopback URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = standardTeamLoopbackBackendConstructor();
    const backend = newStandardTeamLoopbackBackend(Backend);

    await expect(backend.getAssistant("assistant/gemini")).resolves.toEqual({
      id: "assistant/gemini",
    });
    await expect(backend.listManagedAgents()).resolves.toEqual([{ id: "agent-gemini" }]);
    await expect(
      backend.discoverAssistantModelCatalog?.("assistant/gemini"),
    ).resolves.toMatchObject({
      config_options: geminiManagedAgent("gemini-3.1-pro-high", ["auto-gemini-3"]).config_options,
    });
    await expect(backend.createTeam({ name: "Native CLI Team" })).resolves.toEqual({
      id: "native-team-1",
    });
    await expect(
      backend.addTeamMember?.("native-team-1", { assistant: { name: "Gemini teammate" } }),
    ).resolves.toEqual(persistedStandardAssistant("gemini-3.1-pro-preview"));
    await expect(backend.setTeamSessionMode?.("native-team-1", "default")).resolves.toBeUndefined();
    await expect(backend.ensureTeamSession?.("native-team-1")).resolves.toBeUndefined();
    await expect(backend.stopTeamSession?.("native-team-1")).resolves.toBeUndefined();
    await expect(backend.renewTeamActiveLease?.("native-team-1")).resolves.toBeUndefined();
    await expect(
      backend.cancelTeamRun?.("native-team-1", "native-run-1", { reason: "Stop now." }),
    ).resolves.toBeUndefined();

    expect(fetchRequest.mock.calls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:43123/api/assistants/assistant%2Fgemini",
      "http://127.0.0.1:43123/api/agents/management",
      "http://127.0.0.1:43123/api/conversations",
      "http://127.0.0.1:43123/api/conversations/probe-conversation-gemini/runtime/ensure",
      "http://127.0.0.1:43123/api/conversations/probe-conversation-gemini",
      "http://127.0.0.1:43123/api/teams",
      "http://127.0.0.1:43123/api/teams/native-team-1/agents",
      "http://127.0.0.1:43123/api/teams/native-team-1/session-mode",
      "http://127.0.0.1:43123/api/teams/native-team-1/session",
      "http://127.0.0.1:43123/api/teams/native-team-1/session",
      "http://127.0.0.1:43123/api/teams/native-team-1/active-lease",
      "http://127.0.0.1:43123/api/teams/native-team-1/runs/native-run-1/cancel",
    ]);
    expect(fetchRequest.mock.calls.map(([, init]) => init?.method)).toEqual([
      "GET",
      "GET",
      "POST",
      "POST",
      "DELETE",
      "POST",
      "POST",
      "POST",
      "POST",
      "DELETE",
      "POST",
      "POST",
    ]);
    expect(fetchRequest.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        name: "Actestra Team model catalog probe",
        assistant: { id: "assistant/gemini" },
        extra: { is_health_check: true },
      }),
    );
    expect(fetchRequest.mock.calls[5]?.[1]?.body).toBe(JSON.stringify({ name: "Native CLI Team" }));
    expect(timeoutRequests.mock.calls.map(([delay]) => delay)).toEqual([
      10_000, 10_000, 10_000, 45_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
      10_000,
    ]);
    timeoutRequests.mockRestore();
  });

  it("accepts successful void responses for standard-Team mutation routes", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const fetchRequest = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = standardTeamLoopbackBackendConstructor();
    const backend = newStandardTeamLoopbackBackend(Backend);

    await expect(backend.renameTeam?.("native-team-1", "Renamed Team")).resolves.toBeUndefined();
    await expect(backend.removeTeam?.("native-team-1")).resolves.toBeUndefined();
    await expect(
      backend.renameTeamMember?.("native-team-1", "slot-1", "Renamed member"),
    ).resolves.toBeUndefined();
    await expect(backend.removeTeamMember?.("native-team-1", "slot-1")).resolves.toBeUndefined();
    await expect(backend.attachTeamMember?.("native-team-1", "slot-1")).resolves.toBeUndefined();
    await expect(
      backend.pauseTeamMemberWork?.("native-team-1", "run-1", "slot-1", { reason: "pause" }),
    ).resolves.toBeUndefined();
    await expect(
      backend.cancelTeamMemberWork?.("native-team-1", "run-1", "slot-1", { reason: "cancel" }),
    ).resolves.toBeUndefined();
    expect(fetchRequest).toHaveBeenCalledTimes(7);
  });

  it("requires JSON for standard-Team read responses", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("not-json", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );
    const Backend = standardTeamLoopbackBackendConstructor();

    await expect(newStandardTeamLoopbackBackend(Backend).listManagedAgents()).rejects.toMatchObject(
      { code: "team-model-unavailable" },
    );
  });

  it("fails closed and cleans the probe when AionCore drops the hidden health-check marker", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        return backendResponse({
          id: "probe-conversation-visible",
          assistant: { id: "assistant-gemini" },
          extra: { is_temporary_workspace: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-visible/runtime/ensure")) {
        return backendResponse({
          config_options: geminiManagedAgent("gemini-3.1-pro-high", ["auto-gemini-3"])
            .config_options,
        });
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-visible") &&
        init?.method === "DELETE"
      ) {
        return backendResponse(null);
      }
      throw new Error(`Unexpected visible probe URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const probeProcessGuard = {
      capture: vi.fn(async (conversationId: string) =>
        Object.freeze({ conversationId, processes: Object.freeze([]) }),
      ),
      cleanup: vi.fn(async () => {}),
    };
    const Backend = guardedStandardTeamLoopbackBackendConstructor();
    const backend = new Backend({ probeProcessGuard });

    await expect(backend.discoverAssistantModelCatalog?.("assistant-gemini")).rejects.toMatchObject(
      { code: "team-model-unavailable" },
    );
    expect(fetchRequest.mock.calls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:43123/api/conversations",
      "http://127.0.0.1:43123/api/conversations/probe-conversation-visible",
    ]);
    expect(probeProcessGuard.capture).toHaveBeenCalledWith("probe-conversation-visible");
    expect(probeProcessGuard.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans the temporary AionCore catalog conversation when runtime discovery fails", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        return backendResponse({
          id: "probe-conversation-failed",
          assistant: { id: "assistant-gemini" },
          extra: { is_temporary_workspace: true, is_health_check: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-failed/runtime/ensure")) {
        return backendResponse({ private: "must not escape" }, 503);
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-failed") &&
        init?.method === "DELETE"
      ) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected failed discovery URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = standardTeamLoopbackBackendConstructor();
    const backend = newStandardTeamLoopbackBackend(Backend);

    expect(backend.discoverAssistantModelCatalog).toBeTypeOf("function");
    await expect(backend.discoverAssistantModelCatalog?.("assistant-gemini")).rejects.toMatchObject(
      { code: "team-model-unavailable" },
    );
    expect(fetchRequest.mock.calls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:43123/api/conversations",
      "http://127.0.0.1:43123/api/conversations/probe-conversation-failed/runtime/ensure",
      "http://127.0.0.1:43123/api/conversations/probe-conversation-failed",
    ]);
  });

  it("captures probe process ownership before DELETE and cleans the frozen snapshot afterward", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const operations: string[] = [];
    const ownedSnapshot = Object.freeze({
      conversationId: "probe-conversation-failed",
      processes: Object.freeze([Object.freeze({ pid: 68_830, processGroupId: 68_830 })]),
    });
    const probeProcessGuard = {
      capture: vi.fn(async (conversationId: string) => {
        operations.push(`capture:${conversationId}`);
        return ownedSnapshot;
      }),
      cleanup: vi.fn(async (snapshot: unknown) => {
        expect(snapshot).toBe(ownedSnapshot);
        operations.push("cleanup");
      }),
    };
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        operations.push("create");
        return backendResponse({
          id: "probe-conversation-failed",
          assistant: { id: "assistant-gemini" },
          extra: { is_temporary_workspace: true, is_health_check: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-failed/runtime/ensure")) {
        operations.push("ensure");
        return backendResponse({ private: "must not escape" }, 503);
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-failed") &&
        init?.method === "DELETE"
      ) {
        operations.push("delete");
        return backendResponse(null);
      }
      throw new Error(`Unexpected guarded discovery URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = guardedStandardTeamLoopbackBackendConstructor();
    const backend = new Backend({ probeProcessGuard });

    await expect(backend.discoverAssistantModelCatalog?.("assistant-gemini")).rejects.toMatchObject(
      { code: "team-model-unavailable" },
    );
    expect(operations).toEqual([
      "create",
      "ensure",
      "capture:probe-conversation-failed",
      "delete",
      "cleanup",
    ]);
    expect(probeProcessGuard.capture).toHaveBeenCalledOnce();
    expect(probeProcessGuard.cleanup).toHaveBeenCalledOnce();
  });

  it("deletes and cleans an owned probe after the bounded runtime discovery timeout", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const operations: string[] = [];
    const ownedSnapshot = Object.freeze({
      conversationId: "probe-conversation-timeout",
      processes: Object.freeze([Object.freeze({ pid: 68_835, processGroupId: 68_835 })]),
    });
    const probeProcessGuard = {
      capture: vi.fn(async (conversationId: string) => {
        operations.push(`capture:${conversationId}`);
        return ownedSnapshot;
      }),
      cleanup: vi.fn(async (snapshot: unknown) => {
        expect(snapshot).toBe(ownedSnapshot);
        operations.push("cleanup");
      }),
    };
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutRequests = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((delay) =>
        delay === 45_000
          ? AbortSignal.abort(new DOMException("timed out", "TimeoutError"))
          : nativeTimeout(delay),
      );
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        operations.push("create");
        return backendResponse({
          id: "probe-conversation-timeout",
          assistant: { id: "assistant-gemini" },
          extra: { is_temporary_workspace: true, is_health_check: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-timeout/runtime/ensure")) {
        operations.push("ensure-timeout");
        expect(init?.signal?.aborted).toBe(true);
        throw new DOMException("timed out", "TimeoutError");
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-timeout") &&
        init?.method === "DELETE"
      ) {
        operations.push("delete");
        return backendResponse(null);
      }
      throw new Error(`Unexpected timed-out discovery URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = guardedStandardTeamLoopbackBackendConstructor();
    const backend = new Backend({ probeProcessGuard });

    await expect(backend.discoverAssistantModelCatalog?.("assistant-gemini")).rejects.toMatchObject(
      { code: "team-model-unavailable" },
    );
    expect(operations).toEqual([
      "create",
      "ensure-timeout",
      "capture:probe-conversation-timeout",
      "delete",
      "cleanup",
    ]);
    expect(timeoutRequests).toHaveBeenCalledWith(45_000);
    timeoutRequests.mockRestore();
  });

  it("preserves AionCore registry ownership when the probe snapshot cannot be captured", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const operations: string[] = [];
    const probeProcessGuard = {
      capture: vi.fn(async () => {
        operations.push("capture-failed");
        throw new Error("registry unavailable");
      }),
      cleanup: vi.fn(),
    };
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        operations.push("create");
        return backendResponse({
          id: "probe-conversation-unowned",
          assistant: { id: "assistant-gemini" },
          extra: { is_temporary_workspace: true, is_health_check: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-unowned/runtime/ensure")) {
        operations.push("ensure");
        return backendResponse({ private: "must not escape" }, 503);
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-unowned") &&
        init?.method === "DELETE"
      ) {
        operations.push("delete");
        return backendResponse(null);
      }
      throw new Error(`Unexpected unowned discovery URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = guardedStandardTeamLoopbackBackendConstructor();
    const backend = new Backend({ probeProcessGuard });

    await expect(backend.discoverAssistantModelCatalog?.("assistant-gemini")).rejects.toMatchObject(
      { code: "team-model-unavailable" },
    );
    expect(operations).toEqual(["create", "ensure", "capture-failed"]);
    expect(probeProcessGuard.cleanup).not.toHaveBeenCalled();
  });

  it("kills a captured probe process group after its wrapper exits and DELETE removes the registry entry", async () => {
    if (process.platform === "win32") return;
    const dataDirectory = createTestDirectory();
    const runtimeDirectory = path.join(dataDirectory, "runtime");
    const registryPath = path.join(runtimeDirectory, "agent-process-registry.json");
    const probePidPath = path.join(dataDirectory, "probe-pids.json");
    fs.mkdirSync(runtimeDirectory, { recursive: true });

    let probeProcessGroupId: number | null = null;
    let probeChildId: number | null = null;
    let unrelated: ChildProcess | null = null;
    try {
      const wrapperScript = String.raw`
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
          stdio: 'ignore',
        });
        fs.writeFileSync(process.argv[1], JSON.stringify({ wrapperPid: process.pid, childPid: child.pid }));
        child.unref();
        setTimeout(() => process.exit(0), 25);
      `;
      const wrapper = spawn(process.execPath, ["-e", wrapperScript, probePidPath], {
        detached: true,
        stdio: "ignore",
      });
      if (wrapper.pid === undefined) throw new Error("Probe wrapper did not expose its PID");
      probeProcessGroupId = wrapper.pid;
      wrapper.unref();

      await waitForCondition(() => fs.existsSync(probePidPath));
      const recorded = JSON.parse(fs.readFileSync(probePidPath, "utf8")) as {
        wrapperPid: number;
        childPid: number;
      };
      expect(recorded.wrapperPid).toBe(probeProcessGroupId);
      probeChildId = recorded.childPid;
      await waitForCondition(
        () =>
          !processIsAlive(recorded.wrapperPid) &&
          processIsAlive(recorded.childPid) &&
          processGroupIsAlive(recorded.wrapperPid),
      );

      unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      if (unrelated.pid === undefined) throw new Error("Unrelated process did not expose its PID");
      const unrelatedPid = unrelated.pid;
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 1,
          processes: [
            {
              pid: recorded.wrapperPid,
              process_group_id: recorded.wrapperPid,
              conversation_id: "probe-conversation-gemini",
              agent_type: "acp",
              backend: "gemini",
              registered_at_ms: 1,
            },
            {
              pid: unrelatedPid,
              conversation_id: "unrelated-conversation",
              agent_type: "acp",
              backend: "codex",
              registered_at_ms: 2,
            },
          ],
        }),
        "utf8",
      );

      const Guard = probeProcessGuardConstructor();
      const guard = new Guard({ dataDirectory, terminationGraceMs: 50 });
      const snapshot = await guard.capture("probe-conversation-gemini");
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 1,
          processes: [
            {
              pid: unrelatedPid,
              conversation_id: "unrelated-conversation",
              agent_type: "acp",
              backend: "codex",
              registered_at_ms: 2,
            },
          ],
        }),
        "utf8",
      );

      await guard.cleanup(snapshot);

      await waitForCondition(() => !processGroupIsAlive(recorded.wrapperPid));
      expect(processIsAlive(recorded.childPid)).toBe(false);
      expect(processIsAlive(unrelatedPid)).toBe(true);
    } finally {
      if (probeProcessGroupId !== null && processGroupIsAlive(probeProcessGroupId)) {
        process.kill(-probeProcessGroupId, "SIGKILL");
      }
      if (probeChildId !== null && processIsAlive(probeChildId)) {
        process.kill(probeChildId, "SIGKILL");
      }
      terminateProcess(unrelated);
    }
  }, 10_000);

  it("refuses to signal a probe process group whose membership changes after capture", async () => {
    if (process.platform === "win32") return;
    const dataDirectory = createTestDirectory();
    const runtimeDirectory = path.join(dataDirectory, "runtime");
    const registryPath = path.join(runtimeDirectory, "agent-process-registry.json");
    const wrapperReadyPath = path.join(dataDirectory, "probe-wrapper.json");
    const spawnTriggerPath = path.join(dataDirectory, "spawn-child");
    const childReadyPath = path.join(dataDirectory, "probe-child.json");
    fs.mkdirSync(runtimeDirectory, { recursive: true });

    let probeProcessGroupId: number | null = null;
    let probeChildId: number | null = null;
    const originalKill = process.kill.bind(process);
    try {
      const wrapperScript = String.raw`
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        let spawned = false;
        fs.writeFileSync(process.argv[1], JSON.stringify({ wrapperPid: process.pid }));
        setInterval(() => {
          if (spawned || !fs.existsSync(process.argv[2])) return;
          spawned = true;
          const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
          fs.writeFileSync(process.argv[3], JSON.stringify({ childPid: child.pid }));
        }, 10);
      `;
      const wrapper = spawn(
        process.execPath,
        ["-e", wrapperScript, wrapperReadyPath, spawnTriggerPath, childReadyPath],
        { detached: true, stdio: "ignore" },
      );
      if (wrapper.pid === undefined) throw new Error("Probe wrapper did not expose its PID");
      probeProcessGroupId = wrapper.pid;
      wrapper.unref();

      await waitForCondition(() => fs.existsSync(wrapperReadyPath));
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 1,
          processes: [
            {
              pid: probeProcessGroupId,
              process_group_id: probeProcessGroupId,
              conversation_id: "probe-conversation-membership-drift",
              agent_type: "acp",
              backend: "gemini",
              registered_at_ms: 1,
            },
          ],
        }),
        "utf8",
      );

      const Guard = probeProcessGuardConstructor();
      const guard = new Guard({ dataDirectory, terminationGraceMs: 50 });
      const snapshot = await guard.capture("probe-conversation-membership-drift");

      fs.writeFileSync(spawnTriggerPath, "spawn", "utf8");
      await waitForCondition(() => fs.existsSync(childReadyPath));
      probeChildId = (JSON.parse(fs.readFileSync(childReadyPath, "utf8")) as { childPid: number })
        .childPid;
      await waitForCondition(() => processIsAlive(probeChildId as number));

      const destructiveSignals: Array<
        Readonly<{ processId: number; signal: string | number | undefined }>
      > = [];
      vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          destructiveSignals.push({ processId, signal });
          return true;
        }
        return originalKill(processId, signal);
      }) as typeof process.kill);

      await expect(guard.cleanup(snapshot)).rejects.toMatchObject({
        code: "team-model-unavailable",
      });
      expect(destructiveSignals).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      if (probeProcessGroupId !== null && processGroupIsAlive(probeProcessGroupId)) {
        originalKill(-probeProcessGroupId, "SIGKILL");
      }
      if (probeChildId !== null && processIsAlive(probeChildId)) {
        originalKill(probeChildId, "SIGKILL");
      }
    }
  }, 10_000);

  it("rejects unsupported Windows probe cleanup before creating a conversation", async () => {
    const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      vi.stubGlobal("__backendPort", 43_123);
      const fetchRequest = vi.fn(async () => {
        throw new Error("The backend must not create a probe conversation");
      });
      vi.stubGlobal("fetch", fetchRequest);
      const Guard = probeProcessGuardConstructor();
      const guard = new Guard({ dataDirectory: createTestDirectory() });
      const Backend = guardedStandardTeamLoopbackBackendConstructor();
      const backend = new Backend({ probeProcessGuard: guard });

      await expect(
        backend.discoverAssistantModelCatalog?.("assistant-gemini"),
      ).rejects.toMatchObject({ code: "team-model-unavailable" });
      expect(fetchRequest).not.toHaveBeenCalled();
    } finally {
      platform.mockRestore();
    }
  });

  it("directly removes a reparented probe child when group signaling is denied after its leader exits", async () => {
    if (process.platform === "win32") return;
    const dataDirectory = createTestDirectory();
    const runtimeDirectory = path.join(dataDirectory, "runtime");
    const registryPath = path.join(runtimeDirectory, "agent-process-registry.json");
    const probePidPath = path.join(dataDirectory, "probe-pids.json");
    fs.mkdirSync(runtimeDirectory, { recursive: true });

    let probeProcessGroupId: number | null = null;
    let probeChildId: number | null = null;
    const originalKill = process.kill.bind(process);
    try {
      const wrapperScript = String.raw`
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
          stdio: 'ignore',
        });
        fs.writeFileSync(process.argv[1], JSON.stringify({ wrapperPid: process.pid, childPid: child.pid }));
        child.unref();
        setTimeout(() => process.exit(0), 25);
      `;
      const wrapper = spawn(process.execPath, ["-e", wrapperScript, probePidPath], {
        detached: true,
        stdio: "ignore",
      });
      if (wrapper.pid === undefined) throw new Error("Probe wrapper did not expose its PID");
      probeProcessGroupId = wrapper.pid;
      wrapper.unref();

      await waitForCondition(() => fs.existsSync(probePidPath));
      const recorded = JSON.parse(fs.readFileSync(probePidPath, "utf8")) as {
        wrapperPid: number;
        childPid: number;
      };
      probeChildId = recorded.childPid;
      await waitForCondition(
        () =>
          !processIsAlive(recorded.wrapperPid) &&
          processIsAlive(recorded.childPid) &&
          processGroupIsAlive(recorded.wrapperPid),
      );
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: 1,
          processes: [
            {
              pid: recorded.wrapperPid,
              process_group_id: recorded.wrapperPid,
              conversation_id: "probe-conversation-gemini-eperm",
              agent_type: "acp",
              backend: "gemini",
              registered_at_ms: 1,
            },
          ],
        }),
        "utf8",
      );

      const Guard = probeProcessGuardConstructor();
      const guard = new Guard({ dataDirectory, terminationGraceMs: 50 });
      const snapshot = await guard.capture("probe-conversation-gemini-eperm");
      const groupSignals: Array<string | number | undefined> = [];
      vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
        if (processId === -recorded.wrapperPid) {
          groupSignals.push(signal);
          throw Object.assign(new Error("process group signal denied after leader exit"), {
            code: "EPERM",
          });
        }
        return originalKill(processId, signal);
      }) as typeof process.kill);

      await expect(guard.cleanup(snapshot)).resolves.toBeUndefined();

      expect(groupSignals.length).toBeGreaterThan(0);
      await waitForCondition(() => !processIsAlive(recorded.childPid));
    } finally {
      vi.restoreAllMocks();
      if (probeProcessGroupId !== null && processGroupIsAlive(probeProcessGroupId)) {
        originalKill(-probeProcessGroupId, "SIGKILL");
      }
      if (probeChildId !== null && processIsAlive(probeChildId)) {
        originalKill(probeChildId, "SIGKILL");
      }
    }
  }, 10_000);

  it("aborts an in-flight probe on teardown and still deletes then cleans its owned process group", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const operations: string[] = [];
    const ownedSnapshot = Object.freeze({
      conversationId: "probe-conversation-teardown",
      processes: Object.freeze([Object.freeze({ pid: 68_840, processGroupId: 68_840 })]),
    });
    const probeProcessGuard = {
      capture: vi.fn(async (conversationId: string) => {
        operations.push(`capture:${conversationId}`);
        return ownedSnapshot;
      }),
      cleanup: vi.fn(async (snapshot: unknown) => {
        expect(snapshot).toBe(ownedSnapshot);
        operations.push("cleanup");
      }),
    };
    let resolveEnsureStarted!: () => void;
    const ensureStarted = new Promise<void>((resolve) => {
      resolveEnsureStarted = resolve;
    });
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/conversations") && init?.method === "POST") {
        operations.push("create");
        return backendResponse({
          id: "probe-conversation-teardown",
          assistant: { id: "assistant-gemini" },
          extra: { is_temporary_workspace: true, is_health_check: true },
        });
      }
      if (url.endsWith("/api/conversations/probe-conversation-teardown/runtime/ensure")) {
        operations.push("ensure");
        resolveEnsureStarted();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
        });
      }
      if (
        url.endsWith("/api/conversations/probe-conversation-teardown") &&
        init?.method === "DELETE"
      ) {
        operations.push("delete");
        return backendResponse(null);
      }
      throw new Error(`Unexpected teardown discovery URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = guardedStandardTeamLoopbackBackendConstructor();
    const backend = new Backend({ probeProcessGuard });
    expect(backend.close).toBeTypeOf("function");

    const discovery = backend.discoverAssistantModelCatalog?.("assistant-gemini");
    await ensureStarted;
    await backend.close?.();

    await expect(discovery).rejects.toMatchObject({ code: "team-model-unavailable" });
    expect(operations).toEqual([
      "create",
      "ensure",
      "capture:probe-conversation-teardown",
      "delete",
      "cleanup",
    ]);
  });

  it("fails closed before fetch when the Main AionCore loopback port is absent or invalid", async () => {
    vi.stubGlobal("__backendPort", "https://outside.example");
    const fetchRequest = vi.fn();
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = standardTeamLoopbackBackendConstructor();

    await expect(newStandardTeamLoopbackBackend(Backend).listManagedAgents()).rejects.toMatchObject(
      {
        code: "team-model-unavailable",
      },
    );
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("reconciles a stale runtime snapshot to AionCore's persisted admitted Team model", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const staleConfigOptions = {
      config_options: [
        {
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          current_value: "gemini-3.1-pro-high",
          options: [
            { value: "auto-gemini-3", name: "Auto (Gemini 3)" },
            { value: "gemini-2.5-pro", name: "gemini-2.5-pro" },
          ],
        },
      ],
    };
    const observedConfigOptions = {
      config_options: [{ ...staleConfigOptions.config_options[0], current_value: "auto-gemini-3" }],
    };
    const fetchRequest = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/teams/native-team-1")) {
        return backendResponse(persistedStandardTeam("auto-gemini-3"));
      }
      if (url.endsWith("/api/conversations/native-conversation-gemini")) {
        return backendResponse({
          id: "native-conversation-gemini",
          extra: { current_model_id: "auto-gemini-3" },
        });
      }
      if (
        url.endsWith(
          "/api/teams/native-team-1/conversations/native-conversation-gemini/config-options",
        )
      ) {
        return backendResponse(staleConfigOptions);
      }
      if (url.endsWith("/api/conversations/native-conversation-gemini/config-options/model")) {
        expect(init?.method).toBe("PUT");
        expect(init?.body).toBe(JSON.stringify({ value: "auto-gemini-3" }));
        return backendResponse({ confirmation: "observed", ...observedConfigOptions });
      }
      throw new Error(`Unexpected standard Team model reconciliation URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = standardTeamLoopbackBackendConstructor();

    await expect(
      newStandardTeamLoopbackBackend(Backend).reconcileConfigOptions?.(
        "native-team-1",
        "native-conversation-gemini",
      ),
    ).resolves.toEqual(observedConfigOptions);
    expect(fetchRequest.mock.calls.map(([input]) => String(input))).toEqual([
      "http://127.0.0.1:43123/api/teams/native-team-1",
      "http://127.0.0.1:43123/api/conversations/native-conversation-gemini",
      "http://127.0.0.1:43123/api/teams/native-team-1/conversations/native-conversation-gemini/config-options",
      "http://127.0.0.1:43123/api/conversations/native-conversation-gemini/config-options/model",
    ]);
  });

  it("fails closed when AionCore persistence names a model outside its runtime catalog", async () => {
    vi.stubGlobal("__backendPort", 43_123);
    const fetchRequest = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/teams/native-team-1")) {
        return backendResponse(persistedStandardTeam("gemini-removed"));
      }
      if (url.endsWith("/api/conversations/native-conversation-gemini")) {
        return backendResponse({
          id: "native-conversation-gemini",
          extra: { current_model_id: "gemini-removed" },
        });
      }
      if (
        url.endsWith(
          "/api/teams/native-team-1/conversations/native-conversation-gemini/config-options",
        )
      ) {
        return backendResponse({
          config_options: [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              current_value: "gemini-3.1-pro-high",
              options: [{ value: "auto-gemini-3", name: "Auto (Gemini 3)" }],
            },
          ],
        });
      }
      throw new Error(`Unexpected standard Team fail-closed URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchRequest);
    const Backend = standardTeamLoopbackBackendConstructor();

    await expect(
      newStandardTeamLoopbackBackend(Backend).reconcileConfigOptions?.(
        "native-team-1",
        "native-conversation-gemini",
      ),
    ).rejects.toMatchObject({ code: "team-model-unavailable" });
    expect(fetchRequest).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["oversized", new Response(JSON.stringify({ data: "x".repeat(70_000) }))],
    ["invalid JSON", new Response("not-json")],
    ["upstream failure", backendResponse({ private: "must not escape" }, 503)],
  ])("bounds %s AionCore model-catalog failures", async (_label, response) => {
    vi.stubGlobal("__backendPort", 43_123);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    const Backend = standardTeamLoopbackBackendConstructor();

    await expect(newStandardTeamLoopbackBackend(Backend).listManagedAgents()).rejects.toMatchObject(
      {
        code: "team-model-unavailable",
      },
    );
  });

  it("validates stale standard-Team models against AionCore and persists its explicit current model", async () => {
    const createTeam = vi.fn(async (body: unknown) => {
      const model = (body as { agents?: readonly Readonly<{ model?: string }>[] }).agents?.[0]
        ?.model;
      return persistedStandardTeam(model ?? "missing");
    });
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("gemini-3.1-pro-preview", [
            "gemini-3.1-pro-preview",
            "gemini-2.5-pro",
          ]),
        ]),
        createTeam,
      }),
    });

    await expect(service.create(standardCreateIntent())).resolves.toMatchObject({
      experience: "standard",
      assistants: [{ model: "gemini-3.1-pro-preview" }],
    });
    expect(createTeam).toHaveBeenCalledWith({
      name: "Native CLI Team",
      workspace: "/private/tmp/actestra-standard-team",
      agents: [
        {
          name: "Gemini lead",
          role: "lead",
          assistant_id: "assistant-gemini",
          model: "gemini-3.1-pro-preview",
        },
      ],
    });
  });

  it("loads standard-Team config through the Main-owned AionCore reconciliation boundary", async () => {
    const configOptions = Object.freeze({
      config_options: Object.freeze([
        Object.freeze({
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          current_value: "auto-gemini-3",
          options: Object.freeze([
            Object.freeze({ value: "auto-gemini-3", name: "Auto (Gemini 3)" }),
          ]),
        }),
      ]),
    });
    const reconcileConfigOptions = vi.fn(async () => configOptions);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        reconcileConfigOptions,
      },
    });

    await expect(
      service.loadConfigOptions("native-team-1", "native-conversation-gemini"),
    ).resolves.toBe(configOptions);
    expect(reconcileConfigOptions).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-gemini",
    );
  });

  it("discovers AionCore's runtime catalog before persisting a fresh Gemini Team model", async () => {
    const createTeam = vi.fn(async (body: unknown) => {
      const model = (body as { agents?: readonly Readonly<{ model?: string }>[] }).agents?.[0]
        ?.model;
      return persistedStandardTeam(model ?? "missing");
    });
    const discoverAssistantModelCatalog = vi.fn(async () => ({
      config_options: geminiManagedAgent("gemini-3.1-pro-high", [
        "auto-gemini-3",
        "gemini-3.1-pro-preview-customtools",
      ]).config_options,
    }));
    const Service = standardTeamServiceConstructor();
    const backend = withSafeSessionInitialization({
      getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
      listManagedAgents: vi.fn(async () => [
        {
          id: "agent-gemini",
          backend: "gemini",
          agent_type: "acp",
          installed: true,
          enabled: true,
          status: "unchecked",
        },
      ]),
      discoverAssistantModelCatalog,
      createTeam,
    });
    const service = new Service({
      backend,
    });

    await expect(service.create(standardCreateIntent())).resolves.toMatchObject({
      experience: "standard",
      assistants: [{ model: "auto-gemini-3" }],
    });
    expect(discoverAssistantModelCatalog).toHaveBeenCalledWith("assistant-gemini");
    expect(createTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: [expect.objectContaining({ model: "auto-gemini-3" })],
      }),
    );
  });

  it("removes a newly persisted Team when its model postcondition differs from AionCore admission", async () => {
    const removeTeam = vi.fn(async () => null);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("auto-gemini-3", ["auto-gemini-3"]),
        ]),
        createTeam: vi.fn(async () => persistedStandardTeam("gemini-removed")),
        removeTeam,
      }),
    });

    await expect(service.create(standardCreateIntent())).rejects.toMatchObject({
      code: "team-conflict",
    });
    expect(removeTeam).toHaveBeenCalledWith("native-team-1");
  });

  it("projects the acknowledged safe mode when AionCore omits session_mode from the Team read model", async () => {
    const stored = persistedAionCoreStandardTeam("auto-gemini-3");
    const setTeamSessionMode = vi.fn(async () => null);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(async () => geminiAssistant("auto-gemini-3")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("auto-gemini-3", ["auto-gemini-3"]),
        ]),
        createTeam: vi.fn(async () => stored),
        getTeam: vi.fn(async () => stored),
        setTeamSessionMode,
      },
    });

    const created = await service.create(standardCreateIntent());

    expect(created).toMatchObject({
      id: "native-team-1",
      experience: "standard",
      user_id: "system_default_user",
      workspace_mode: "shared",
      assistants: [{ model: "auto-gemini-3" }],
    });
    expect(created).toHaveProperty("session_mode", "default");
    expect(setTeamSessionMode).toHaveBeenCalledWith("native-team-1", "default");
  });

  it("removes a new Team when AionCore explicitly reports an unsafe session mode", async () => {
    const created = persistedAionCoreStandardTeam("auto-gemini-3");
    const removeTeam = vi.fn(async () => null);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(async () => geminiAssistant("auto-gemini-3")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("auto-gemini-3", ["auto-gemini-3"]),
        ]),
        createTeam: vi.fn(async () => created),
        getTeam: vi.fn(async () => ({ ...created, session_mode: "bypassPermissions" })),
        setTeamSessionMode: vi.fn(async () => null),
        removeTeam,
      },
    });

    await expect(service.create(standardCreateIntent())).rejects.toMatchObject({
      code: "team-conflict",
    });
    expect(removeTeam).toHaveBeenCalledWith("native-team-1");
  });

  it("admits only a leader-selected safe mode shared by every standard Team member", async () => {
    let stored = {
      ...persistedStandardTeam("claude-sonnet"),
      session_mode: "plan",
      assistants: [
        {
          ...persistedStandardTeam("claude-sonnet").assistants[0],
          assistant_backend: "claude",
          conversation_id: "native-conversation-claude",
          model: "claude-sonnet",
        },
        {
          ...persistedStandardAssistant("gpt-5"),
          assistant_backend: "codex",
          conversation_id: "native-conversation-codex",
          model: "gpt-5",
        },
      ],
    };
    const currentModes = new Map<string, string>([
      ["native-conversation-claude", "plan"],
      ["native-conversation-codex", "read-only"],
    ]);
    const modeOptions = (conversationId: string) => ({
      config_options: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          current_value: currentModes.get(conversationId),
          options: conversationId.endsWith("codex")
            ? [
                { value: "read-only", name: "Read only" },
                { value: "auto", name: "Ask before effects" },
                { value: "agent-full-access", name: "Full access" },
              ]
            : [
                { value: "default", name: "Ask before effects" },
                { value: "plan", name: "Plan" },
                { value: "bypassPermissions", name: "Bypass permissions" },
              ],
        },
      ],
    });
    const setConfigOption = vi.fn(
      async (_teamId: string, conversationId: string, _optionId: string, value: string) => {
        currentModes.set(conversationId, value);
        return modeOptions(conversationId);
      },
    );
    const setTeamSessionMode = vi.fn(async (_teamId: string, mode: string) => {
      stored = { ...stored, session_mode: mode };
      return null;
    });
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        reconcileConfigOptions: vi.fn(async (_teamId, conversationId) =>
          modeOptions(conversationId),
        ),
        setConfigOption,
        setTeamSessionMode,
      },
    });

    await expect(
      service.setSessionMode("native-team-1", "native-conversation-claude", "default"),
    ).resolves.toMatchObject({ session_mode: "default" });
    expect(setConfigOption).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-claude",
      "mode",
      "default",
    );
    expect(setConfigOption).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-codex",
      "mode",
      "auto",
    );
    expect(setTeamSessionMode).toHaveBeenCalledWith("native-team-1", "default");

    setConfigOption.mockClear();
    setTeamSessionMode.mockClear();
    await expect(
      service.setSessionMode("native-team-1", "native-conversation-claude", "bypassPermissions"),
    ).rejects.toMatchObject({ code: "team-model-unavailable" });
    expect(setConfigOption).not.toHaveBeenCalled();
    expect(setTeamSessionMode).not.toHaveBeenCalled();
  });

  it("projects a verified safe mode when the AionCore Team read model omits session_mode", async () => {
    const stored = persistedAionCoreStandardTeam("default");
    const setTeamSessionMode = vi.fn(async () => null);
    let currentMode = "plan";
    const modeOptions = () => ({
      config_options: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          current_value: currentMode,
          options: [
            { value: "default", name: "Ask before effects" },
            { value: "plan", name: "Plan" },
            { value: "bypassPermissions", name: "Bypass permissions" },
          ],
        },
      ],
    });
    const setConfigOption = vi.fn(async (_teamId, _conversationId, _optionId, value) => {
      currentMode = value;
      return modeOptions();
    });
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        reconcileConfigOptions: vi.fn(async () => modeOptions()),
        setConfigOption,
        setTeamSessionMode,
      },
    });

    await expect(
      service.setSessionMode("native-team-1", "native-conversation-gemini", "default"),
    ).resolves.toMatchObject({ session_mode: "default" });
    expect(setTeamSessionMode).toHaveBeenCalledWith("native-team-1", "default");
    expect(setConfigOption).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-gemini",
      "mode",
      "default",
    );
  });

  it.each([undefined, "bypassPermissions"])(
    "normalizes a %s standard Team seed before warmup and verifies every member afterward",
    async (seededMode) => {
      let stored = {
        ...persistedStandardTeam("claude-sonnet"),
        ...(seededMode === undefined ? {} : { session_mode: seededMode }),
        assistants: [
          {
            ...persistedStandardTeam("claude-sonnet").assistants[0],
            assistant_backend: "claude",
            conversation_id: "native-conversation-claude",
            model: "claude-sonnet",
          },
          {
            ...persistedStandardAssistant("gpt-5"),
            assistant_backend: "codex",
            conversation_id: "native-conversation-codex",
            model: "gpt-5",
          },
        ],
      };
      if (seededMode === undefined) delete (stored as { session_mode?: string }).session_mode;
      const currentModes = new Map<string, string>([
        ["native-conversation-claude", "bypassPermissions"],
        ["native-conversation-codex", "agent-full-access"],
      ]);
      let warmed = false;
      const effects: string[] = [];
      const modeOptions = (conversationId: string) => ({
        config_options: [
          {
            id: "mode",
            name: "Mode",
            category: "mode",
            type: "select",
            current_value: currentModes.get(conversationId),
            options: conversationId.endsWith("codex")
              ? [
                  { value: "auto", name: "Ask before effects" },
                  { value: "agent-full-access", name: "Full access" },
                ]
              : [
                  { value: "default", name: "Ask before effects" },
                  { value: "bypassPermissions", name: "Bypass permissions" },
                ],
          },
        ],
      });
      const setTeamSessionMode = vi.fn(async (_teamId: string, mode: string) => {
        effects.push(`seed:${mode}`);
        stored = { ...stored, session_mode: mode };
        return null;
      });
      const ensureTeamSession = vi.fn(async () => {
        expect(stored.session_mode).toBe("default");
        effects.push("warmup");
        warmed = true;
        return null;
      });
      const setConfigOption = vi.fn(
        async (_teamId: string, conversationId: string, _optionId: string, mode: string) => {
          expect(warmed).toBe(true);
          effects.push(`${conversationId}:${mode}`);
          currentModes.set(conversationId, mode);
          return modeOptions(conversationId);
        },
      );
      const Service = standardTeamServiceConstructor();
      const service = new Service({
        backend: {
          getAssistant: vi.fn(),
          listManagedAgents: vi.fn(),
          createTeam: vi.fn(),
          getTeam: vi.fn(async () => stored),
          setTeamSessionMode,
          ensureTeamSession,
          stopTeamSession: vi.fn(async () => null),
          reconcileConfigOptions: vi.fn(async (_teamId, conversationId) => {
            expect(warmed).toBe(true);
            return modeOptions(conversationId);
          }),
          setConfigOption,
        },
      });

      await expect(service.ensureSession("native-team-1")).resolves.toMatchObject({
        session_mode: "default",
      });
      expect(effects[0]).toBe("seed:default");
      expect(effects[1]).toBe("warmup");
      expect(setConfigOption).toHaveBeenCalledWith(
        "native-team-1",
        "native-conversation-claude",
        "mode",
        "default",
      );
      expect(setConfigOption).toHaveBeenCalledWith(
        "native-team-1",
        "native-conversation-codex",
        "mode",
        "auto",
      );
      expect(currentModes).toEqual(
        new Map([
          ["native-conversation-claude", "default"],
          ["native-conversation-codex", "auto"],
        ]),
      );
    },
  );

  it("warms an AionCore Team whose read model omits session_mode after the safe seed", async () => {
    const stored = persistedAionCoreStandardTeam("default");
    let warmed = false;
    let currentMode = "bypassPermissions";
    const modeOptions = () => ({
      config_options: [
        {
          id: "mode",
          name: "Mode",
          category: "mode",
          type: "select",
          current_value: currentMode,
          options: [
            { value: "default", name: "Ask before effects" },
            { value: "bypassPermissions", name: "Bypass permissions" },
          ],
        },
      ],
    });
    const ensureTeamSession = vi.fn(async () => {
      warmed = true;
      return null;
    });
    const setConfigOption = vi.fn(async (_teamId, _conversationId, _optionId, value) => {
      expect(warmed).toBe(true);
      currentMode = value;
      return modeOptions();
    });
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        setTeamSessionMode: vi.fn(async () => null),
        ensureTeamSession,
        stopTeamSession: vi.fn(async () => null),
        reconcileConfigOptions: vi.fn(async () => modeOptions()),
        setConfigOption,
      },
    });

    await expect(service.ensureSession("native-team-1")).resolves.toMatchObject({
      session_mode: "default",
    });
    expect(ensureTeamSession).toHaveBeenCalledOnce();
    expect(setConfigOption).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-gemini",
      "mode",
      "default",
    );
  });

  it("stops a partially warmed standard Team when safe member-mode verification fails", async () => {
    let stored = { ...persistedStandardTeam("claude-sonnet"), session_mode: "default" };
    const ensureTeamSession = vi.fn(async () => null);
    const stopTeamSession = vi.fn(async () => null);
    const setTeamSessionMode = vi.fn(async (_teamId: string, mode: string) => {
      stored = { ...stored, session_mode: mode };
      return null;
    });
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        setTeamSessionMode,
        ensureTeamSession,
        stopTeamSession,
        reconcileConfigOptions: vi.fn(async () => ({
          config_options: [
            {
              id: "mode",
              name: "Mode",
              category: "mode",
              type: "select",
              current_value: "bypassPermissions",
              options: [{ value: "bypassPermissions", name: "Bypass permissions" }],
            },
          ],
        })),
        setConfigOption: vi.fn(),
      },
    });

    await expect(service.ensureSession("native-team-1")).rejects.toMatchObject({
      code: "team-model-unavailable",
    });
    expect(ensureTeamSession).toHaveBeenCalledOnce();
    expect(stopTeamSession).toHaveBeenCalledWith("native-team-1");
  });

  it("routes standard Team warmup through its durable provider instead of orchestrated run state", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:45:00.000Z",
      }),
    );
    const ensureSession = vi.fn(async () => ({
      ...persistedStandardTeam("claude-sonnet"),
      experience: "standard" as const,
    }));
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { ensureSession },
      now: clock(),
      createDigest: () => "c".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch({ kind: "ensure-session", teamId: "native-team-1" }),
    ).resolves.toMatchObject({ id: "native-team-1", experience: "standard" });
    expect(ensureSession).toHaveBeenCalledWith("native-team-1");

    service.close();
    await persistence.close();
  });

  it("persists a standard Team leader message before effect and replays its observed acknowledgement", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:46:00.000Z",
      }),
    );
    const acknowledgement = Object.freeze({
      experience: "standard" as const,
      enqueue_status: "accepted" as const,
      message_id: "native-message-1",
      run: Object.freeze({
        team_id: "native-team-1",
        team_run_id: "native-run-1",
        source: "user_message" as const,
        has_user_intervention: false,
        target_slot_id: "native-slot-gemini",
        target_role: "lead" as const,
        status: "accepted" as const,
        queued_intent_count: 0,
        starting_batch_count: 1,
        running_batch_count: 0,
        active_enqueue_lease_count: 1,
        slot_work: Object.freeze([]),
      }),
    });
    const sendMessage = vi.fn(async () => acknowledgement);
    const prepareMessageEffect = vi.fn(async () => sendMessage);
    const getRunState = vi.fn(async () => ({
      experience: "standard" as const,
      session_generation: "native-session-1",
      active_run: acknowledgement.run,
      slot_work: Object.freeze([]),
    }));
    const persistDelivery = vi.spyOn(persistence, "persistStandardTeamMessageDelivery");
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { prepareMessageEffect, getRunState },
      now: clock(),
      createDigest: () => "c".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    const route = {
      kind: "send-message",
      teamId: "native-team-1",
      content: "Review the selected workspace.",
      files: Object.freeze([]),
      requestNonce: `team-request-${"1".repeat(64)}`,
    } as unknown as AionUiTeamBridgeRoute;
    await expect(service.dispatch(route)).resolves.toEqual(acknowledgement);
    await expect(service.dispatch(route)).resolves.toEqual(acknowledgement);
    expect(prepareMessageEffect).toHaveBeenCalledWith(
      "native-team-1",
      "Review the selected workspace.",
      Object.freeze([]),
    );
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(prepareMessageEffect).toHaveBeenCalledOnce();
    expect(getRunState).toHaveBeenCalledOnce();
    expect(persistDelivery).toHaveBeenCalledTimes(2);
    expect(persistDelivery.mock.calls[0]?.[0]).toMatchObject({
      clientRequestNonce: `team-request-${"1".repeat(64)}`,
      requestSha256: createHash("sha256")
        .update(JSON.stringify(["native-team-1", null, "Review the selected workspace.", []]))
        .digest("hex"),
      teamId: "native-team-1",
      targetSlotId: null,
      state: "pending-effect",
      providerMessageId: null,
      providerRunId: null,
    });
    expect(persistDelivery.mock.calls[1]?.[0]).toMatchObject({
      state: "effect-observed",
      providerMessageId: "native-message-1",
      providerRunId: "native-run-1",
    });
    expect(prepareMessageEffect.mock.invocationCallOrder[0]).toBeLessThan(
      persistDelivery.mock.invocationCallOrder[0]!,
    );
    expect(persistDelivery.mock.invocationCallOrder[0]).toBeLessThan(
      sendMessage.mock.invocationCallOrder[0]!,
    );
    expect(sendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      persistDelivery.mock.invocationCallOrder[1]!,
    );
    const deliveryId = `standard-team-delivery-${createHash("sha256")
      .update(`native-team-1\u0000\u0000team-request-${"1".repeat(64)}`)
      .digest("hex")}`;
    await expect(persistence.getStandardTeamMessageDelivery(deliveryId)).resolves.toMatchObject({
      state: "effect-observed",
      providerMessageId: "native-message-1",
      providerRunId: "native-run-1",
    });

    service.close();
    await persistence.close();
  });

  it("rejects a missing standard Team member before reserving delivery", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const stored = persistedStandardTeam("claude-sonnet");
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:46:30.000Z",
      }),
    );
    const sendTeamMemberMessage = vi.fn();
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        sendTeamMemberMessage,
        getTeamRunState: vi.fn(),
      },
    });
    const persistDelivery = vi.spyOn(persistence, "persistStandardTeamMessageDelivery");
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "7".repeat(64),
    });

    await expect(
      service.dispatch({
        kind: "send-member-message",
        teamId: stored.id,
        slotId: "native-slot-missing",
        content: "Do not reserve this invalid delivery.",
        files: Object.freeze([]),
        requestNonce: `team-request-${"7".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "team-not-found" });
    expect(sendTeamMemberMessage).not.toHaveBeenCalled();
    expect(persistDelivery).not.toHaveBeenCalled();
    await expect(persistence.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([]);

    service.close();
    await persistence.close();
  });

  it("rejects a missing standard Team before reserving delivery", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-missing",
        experience: "standard",
        boundAt: "2026-08-06T02:46:31.000Z",
      }),
    );
    const sendTeamMessage = vi.fn();
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => null),
        sendTeamMessage,
        getTeamRunState: vi.fn(),
      },
    });
    const persistDelivery = vi.spyOn(persistence, "persistStandardTeamMessageDelivery");
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "6".repeat(64),
    });

    await expect(
      service.dispatch({
        kind: "send-message",
        teamId: "native-team-missing",
        content: "Do not reserve this missing Team delivery.",
        files: Object.freeze([]),
        requestNonce: `team-request-${"6".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(sendTeamMessage).not.toHaveBeenCalled();
    expect(persistDelivery).not.toHaveBeenCalled();
    await expect(persistence.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([]);

    service.close();
    await persistence.close();
  });

  it("rejects an out-of-workspace standard Team attachment before reserving delivery", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const workspace = createTestDirectory();
    const outsideDirectory = createTestDirectory();
    const outsideFile = path.join(outsideDirectory, "outside.txt");
    fs.writeFileSync(outsideFile, "outside authoritative workspace", "utf8");
    const stored = { ...persistedStandardTeam("claude-sonnet"), workspace };
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:46:32.000Z",
      }),
    );
    const sendTeamMessage = vi.fn();
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        sendTeamMessage,
        getTeamRunState: vi.fn(),
      },
    });
    const persistDelivery = vi.spyOn(persistence, "persistStandardTeamMessageDelivery");
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "5".repeat(64),
    });

    await expect(
      service.dispatch({
        kind: "send-message",
        teamId: stored.id,
        content: "Do not reserve this out-of-workspace attachment.",
        files: Object.freeze([outsideFile]),
        requestNonce: `team-request-${"5".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(sendTeamMessage).not.toHaveBeenCalled();
    expect(persistDelivery).not.toHaveBeenCalled();
    await expect(persistence.listUnresolvedStandardTeamMessageDeliveries(100)).resolves.toEqual([]);

    service.close();
    await persistence.close();
  });

  it("persists a queued provider enqueue status and replays the same status for a duplicate nonce", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-queued-replay",
        experience: "standard",
        boundAt: "2026-08-06T02:46:00.000Z",
      }),
    );
    const acknowledgement = Object.freeze({
      experience: "standard" as const,
      enqueue_status: "queued" as const,
      message_id: "native-message-queued",
      run: Object.freeze({
        team_id: "native-team-queued-replay",
        team_run_id: "native-run-queued",
        source: "user_message" as const,
        has_user_intervention: false,
        target_slot_id: "native-slot-gemini",
        target_role: "lead" as const,
        status: "accepted" as const,
        queued_intent_count: 1,
        starting_batch_count: 0,
        running_batch_count: 0,
        active_enqueue_lease_count: 1,
        slot_work: Object.freeze([]),
      }),
    });
    const sendMessage = vi.fn(async () => acknowledgement);
    const prepareMessageEffect = vi.fn(async () => sendMessage);
    const getRunState = vi.fn(async () => ({
      experience: "standard" as const,
      session_generation: "native-session-queued",
      active_run: acknowledgement.run,
      slot_work: Object.freeze([]),
    }));
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { prepareMessageEffect, getRunState },
      now: clock(),
      createDigest: () => "8".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    const route = {
      kind: "send-message",
      teamId: "native-team-queued-replay",
      content: "Queue this message exactly once.",
      files: Object.freeze([]),
      requestNonce: `team-request-${"q".repeat(64)}`,
    } as unknown as AionUiTeamBridgeRoute;

    await expect(service.dispatch(route)).resolves.toEqual(acknowledgement);
    await expect(service.dispatch(route)).resolves.toEqual(acknowledgement);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(prepareMessageEffect).toHaveBeenCalledOnce();
    const deliveryId = `standard-team-delivery-${createHash("sha256")
      .update(`native-team-queued-replay\u0000\u0000team-request-${"q".repeat(64)}`)
      .digest("hex")}`;
    await expect(persistence.getStandardTeamMessageDelivery(deliveryId)).resolves.toMatchObject({
      state: "effect-observed",
      providerEnqueueStatus: "queued",
    });

    service.close();
    await persistence.close();
  });

  it("marks an ambiguous standard Team provider failure uncertain and blocks the same effect retry", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-uncertain",
        experience: "standard",
        boundAt: "2026-08-06T02:46:00.000Z",
      }),
    );
    const sendMessage = vi.fn(async () => {
      throw new Error("provider response lost");
    });
    const prepareMessageEffect = vi.fn(async () => sendMessage);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { prepareMessageEffect },
      now: clock(),
      createDigest: () => "c".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);
    const route = {
      kind: "send-message",
      teamId: "native-team-uncertain",
      content: "Do not execute this message twice.",
      files: Object.freeze([]),
      requestNonce: `team-request-${"2".repeat(64)}`,
    } as unknown as AionUiTeamBridgeRoute;

    await expect(service.dispatch(route)).rejects.toMatchObject({
      code: "team-execution-failed",
    });
    await expect(service.dispatch(route)).rejects.toMatchObject({ code: "team-conflict" });
    expect(sendMessage).toHaveBeenCalledOnce();
    const deliveryId = `standard-team-delivery-${createHash("sha256")
      .update(`native-team-uncertain\u0000\u0000team-request-${"2".repeat(64)}`)
      .digest("hex")}`;
    await expect(persistence.getStandardTeamMessageDelivery(deliveryId)).resolves.toMatchObject({
      state: "effect-uncertain",
      providerMessageId: null,
      providerRunId: null,
    });

    service.close();
    await persistence.close();
  });

  it("reconciles a restart-interrupted standard Team message to uncertain before bridge registration", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistStandardTeamMessageDelivery({
      contractVersion: 1,
      deliveryId: `standard-team-delivery-${"3".repeat(64)}`,
      clientRequestNonce: `team-request-${"4".repeat(64)}`,
      requestSha256: "5".repeat(64),
      teamId: "native-team-recovery",
      targetSlotId: null,
      state: "pending-effect",
      providerEnqueueStatus: null,
      providerMessageId: null,
      providerRunId: null,
      createdAt: instant("2026-08-05T01:00:00.000Z"),
      updatedAt: instant("2026-08-05T01:00:00.000Z"),
    });
    const sendMessage = vi.fn();
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { sendMessage },
      now: clock(),
      createDigest: () => "c".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);
    const recover = (
      service as unknown as { recoverStandardTeamMessageDeliveries: () => Promise<number> }
    ).recoverStandardTeamMessageDeliveries;

    expect(recover).toBeTypeOf("function");
    await expect(recover.call(service)).resolves.toBe(1);
    await expect(
      persistence.getStandardTeamMessageDelivery(`standard-team-delivery-${"3".repeat(64)}`),
    ).resolves.toMatchObject({ state: "effect-uncertain" });
    expect(sendMessage).not.toHaveBeenCalled();

    service.close();
    await persistence.close();
  });

  it("routes a standard Team member message through its durable provider identity", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:47:00.000Z",
      }),
    );
    const acknowledgement = Object.freeze({
      experience: "standard" as const,
      enqueue_status: "accepted" as const,
      message_id: "native-message-member",
      run: Object.freeze({
        team_id: "native-team-1",
        team_run_id: "native-run-member",
        source: "user_message" as const,
        has_user_intervention: true,
        target_slot_id: "native-slot-gemini",
        target_role: "teammate" as const,
        status: "accepted" as const,
        queued_intent_count: 0,
        starting_batch_count: 1,
        running_batch_count: 0,
        active_enqueue_lease_count: 1,
        slot_work: Object.freeze([]),
      }),
    });
    const sendMemberMessage = vi.fn(async () => acknowledgement);
    const prepareMemberMessageEffect = vi.fn(async () => sendMemberMessage);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { prepareMemberMessageEffect },
      now: clock(),
      createDigest: () => "d".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch({
        kind: "send-member-message",
        teamId: "native-team-1",
        slotId: "native-slot-gemini",
        content: "Inspect this focused issue.",
        files: Object.freeze([]),
        requestNonce: `team-request-${"6".repeat(64)}`,
      }),
    ).resolves.toEqual(acknowledgement);
    expect(prepareMemberMessageEffect).toHaveBeenCalledWith(
      "native-team-1",
      "native-slot-gemini",
      "Inspect this focused issue.",
      Object.freeze([]),
    );
    expect(sendMemberMessage).toHaveBeenCalledOnce();

    service.close();
    await persistence.close();
  });

  it("routes standard Team run-state reads through its durable provider", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:48:00.000Z",
      }),
    );
    const state = Object.freeze({
      experience: "standard" as const,
      session_generation: "native-session-1",
      active_run: null,
      slot_work: Object.freeze([]),
    });
    const getRunState = vi.fn(async () => state);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { getRunState },
      now: clock(),
      createDigest: () => "e".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(service.dispatch({ kind: "run-state", teamId: "native-team-1" })).resolves.toEqual(
      state,
    );
    expect(getRunState).toHaveBeenCalledWith("native-team-1");

    service.close();
    await persistence.close();
  });

  it("routes standard Team active lease renewal through its durable provider", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:48:30.000Z",
      }),
    );
    const renewActiveLease = vi.fn(async () => undefined);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { renewActiveLease },
      now: clock(),
      createDigest: () => "e".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch({ kind: "active-lease", teamId: "native-team-1" }),
    ).resolves.toBeNull();
    expect(renewActiveLease).toHaveBeenCalledWith("native-team-1");

    service.close();
    await persistence.close();
  });

  it("keeps orchestrated Team active lease renewal inside Actestra Core", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const renewActiveLease = vi.fn(async () => undefined);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { renewActiveLease },
      now: clock(),
      createDigest: () => "7".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);
    const created = requireNativeTeam(await service.dispatch(createRoute));

    await expect(
      service.dispatch({ kind: "active-lease", teamId: created.id }),
    ).resolves.toMatchObject({
      submission: {
        availability: "unavailable",
        blocked_reason: "planner-unavailable",
        authority_source: "actestra-main-runtime",
      },
    });
    expect(renewActiveLease).not.toHaveBeenCalled();

    service.close();
    await persistence.close();
  });

  it("routes standard Team pause through its durable provider-owned run identity", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:49:00.000Z",
      }),
    );
    const state = Object.freeze({
      experience: "standard" as const,
      session_generation: "native-session-1",
      active_run: null,
      slot_work: Object.freeze([]),
    });
    const pauseMemberWork = vi.fn(async () => state);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { pauseMemberWork },
      now: clock(),
      createDigest: () => "f".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch({
        kind: "pause-node",
        teamId: "native-team-1",
        runId: "native-run-1",
        slotId: "native-slot-gemini",
        reason: "user_stop",
      }),
    ).resolves.toEqual(state);
    expect(pauseMemberWork).toHaveBeenCalledWith(
      "native-team-1",
      "native-run-1",
      "native-slot-gemini",
      "user_stop",
    );

    service.close();
    await persistence.close();
  });

  it("routes standard Team member attach through its durable provider", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: "native-team-1",
        experience: "standard",
        boundAt: "2026-08-06T02:50:00.000Z",
      }),
    );
    const team = {
      ...persistedStandardTeam("claude-sonnet"),
      experience: "standard" as const,
    };
    const attachMember = vi.fn(async () => team);
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { attachMember },
      now: clock(),
      createDigest: () => "1".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch({
        kind: "attach-member",
        teamId: "native-team-1",
        slotId: "native-slot-gemini",
      }),
    ).resolves.toEqual(team);
    expect(attachMember).toHaveBeenCalledWith("native-team-1", "native-slot-gemini");

    service.close();
    await persistence.close();
  });

  it("acknowledges a standard Team leader message only after observing the same provider run", async () => {
    const stored = persistedStandardTeam("claude-sonnet");
    const run = Object.freeze({
      team_id: stored.id,
      team_run_id: "native-run-1",
      source: "user_message",
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead",
      status: "accepted",
      queued_intent_count: 0,
      starting_batch_count: 1,
      running_batch_count: 0,
      active_enqueue_lease_count: 1,
      slot_work: Object.freeze([]),
    });
    const sendTeamMessage = vi.fn(async () => ({
      enqueue_status: "accepted",
      message_id: "native-message-1",
      run,
    }));
    const getTeamRunState = vi.fn(async () => ({
      session_generation: "native-session-1",
      active_run: run,
      slot_work: [],
    }));
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        sendTeamMessage,
        getTeamRunState,
      },
    });

    await expect(
      service.sendMessage(stored.id, "Review the selected workspace.", []),
    ).resolves.toEqual({
      experience: "standard",
      enqueue_status: "accepted",
      message_id: "native-message-1",
      run,
    });
    expect(sendTeamMessage).toHaveBeenCalledWith(stored.id, {
      content: "Review the selected workspace.",
      files: [],
    });
    expect(getTeamRunState).toHaveBeenCalledWith(stored.id);
  });

  it("routes whole-run cancellation through Standard Team authority and observes termination", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const stored = persistedStandardTeam("claude-sonnet");
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:49:00.000Z",
      }),
    );
    const activeRun = Object.freeze({
      team_id: stored.id,
      team_run_id: "native-run-current",
      source: "user_message" as const,
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead" as const,
      status: "running" as const,
      queued_intent_count: 0,
      starting_batch_count: 0,
      running_batch_count: 1,
      active_enqueue_lease_count: 0,
      slot_work: Object.freeze([]),
    });
    const before = Object.freeze({
      session_generation: "native-session-current",
      active_run: activeRun,
      slot_work: Object.freeze([]),
    });
    const after = Object.freeze({
      session_generation: "native-session-current",
      active_run: null,
      slot_work: Object.freeze([]),
    });
    const getTeamRunState = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const cancelTeamRun = vi.fn(async () => undefined);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        getTeamRunState,
        cancelTeamRun,
      },
    });
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "e".repeat(64),
    });

    await expect(
      service.dispatch({
        kind: "cancel-run",
        teamId: stored.id,
        runId: "native-run-current",
        reason: "Stop the native Team run.",
      }),
    ).resolves.toMatchObject({ experience: "standard", active_run: null });
    expect(cancelTeamRun).toHaveBeenCalledWith(stored.id, "native-run-current", {
      reason: "Stop the native Team run.",
    });
    expect(getTeamRunState).toHaveBeenCalledTimes(2);

    service.close();
    await persistence.close();
  });

  it("routes Standard Team session stop and rejects a stale whole-run target before effect", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const stored = persistedStandardTeam("claude-sonnet");
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:50:00.000Z",
      }),
    );
    const activeRun = Object.freeze({
      team_id: stored.id,
      team_run_id: "native-run-current",
      source: "user_message" as const,
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead" as const,
      status: "running" as const,
      queued_intent_count: 0,
      starting_batch_count: 0,
      running_batch_count: 1,
      active_enqueue_lease_count: 0,
      slot_work: Object.freeze([]),
    });
    const runningState = Object.freeze({
      session_generation: "native-session-current",
      active_run: activeRun,
      slot_work: Object.freeze([]),
    });
    const stoppedState = Object.freeze({
      session_generation: "native-session-current",
      active_run: null,
      slot_work: Object.freeze([]),
    });
    const getTeamRunState = vi
      .fn()
      .mockResolvedValueOnce(runningState)
      .mockResolvedValueOnce(stoppedState);
    const stopTeamSession = vi.fn(async () => undefined);
    const cancelTeamRun = vi.fn(async () => undefined);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        getTeamRunState,
        stopTeamSession,
        cancelTeamRun,
      },
    });
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "f".repeat(64),
    });

    await expect(
      service.dispatch({
        kind: "cancel-run",
        teamId: stored.id,
        runId: "native-run-stale",
        reason: "stale",
      }),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(cancelTeamRun).not.toHaveBeenCalled();
    await expect(
      service.dispatch({ kind: "stop-session", teamId: stored.id }),
    ).resolves.toMatchObject({ experience: "standard", active_run: null });
    expect(stopTeamSession).toHaveBeenCalledWith(stored.id);

    service.close();
    await persistence.close();
  });

  it("rejects stale standard Team member control before the provider effect", async () => {
    const stored = persistedStandardTeam("claude-sonnet");
    const slotWork = Object.freeze({
      slot_id: stored.leader_assistant_id,
      role: "lead" as const,
      state: "running" as const,
      queued_foreground_count: 0,
      queued_background_count: 0,
      active_turn_id: "native-turn-current",
      active_turn_started_at_ms: 1_785_883_200_000,
      active_turn_elapsed_ms: 10_000,
      active_turn_slow: false,
      active_turn_slow_threshold_ms: 30_000,
      blocked_reason: null,
      team_run_id: "native-run-current",
    });
    const activeRun = Object.freeze({
      team_id: stored.id,
      team_run_id: "native-run-current",
      source: "user_message" as const,
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead" as const,
      status: "running" as const,
      queued_intent_count: 0,
      starting_batch_count: 0,
      running_batch_count: 1,
      active_enqueue_lease_count: 0,
      slot_work: Object.freeze([slotWork]),
    });
    const getTeamRunState = vi.fn(async () => ({
      session_generation: "native-session-current",
      active_run: activeRun,
      slot_work: Object.freeze([slotWork]),
    }));
    const pauseTeamMemberWork = vi.fn(async () => undefined);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        getTeamRunState,
        pauseTeamMemberWork,
      },
    });

    await expect(
      service.pauseMemberWork(
        stored.id,
        "native-run-stale",
        stored.leader_assistant_id,
        "user_stop",
      ),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(pauseTeamMemberWork).not.toHaveBeenCalled();
    expect(getTeamRunState).toHaveBeenCalledOnce();
  });

  it("rejects terminal standard Team member control before the provider effect", async () => {
    const stored = persistedStandardTeam("claude-sonnet");
    const slotWork = Object.freeze({
      slot_id: stored.leader_assistant_id,
      role: "lead" as const,
      state: "idle" as const,
      queued_foreground_count: 0,
      queued_background_count: 0,
      active_turn_id: null,
      active_turn_started_at_ms: null,
      active_turn_elapsed_ms: null,
      active_turn_slow: null,
      active_turn_slow_threshold_ms: null,
      blocked_reason: null,
      team_run_id: "native-run-completed",
    });
    const activeRun = Object.freeze({
      team_id: stored.id,
      team_run_id: "native-run-completed",
      source: "user_message" as const,
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead" as const,
      status: "completed" as const,
      queued_intent_count: 0,
      starting_batch_count: 0,
      running_batch_count: 0,
      active_enqueue_lease_count: 0,
      slot_work: Object.freeze([slotWork]),
    });
    const getTeamRunState = vi.fn(async () => ({
      session_generation: "native-session-current",
      active_run: activeRun,
      slot_work: Object.freeze([slotWork]),
    }));
    const cancelTeamMemberWork = vi.fn(async () => undefined);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        getTeamRunState,
        cancelTeamMemberWork,
      },
    });

    await expect(
      service.cancelMemberWork(
        stored.id,
        "native-run-completed",
        stored.leader_assistant_id,
        "user_stop",
      ),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(cancelTeamMemberWork).not.toHaveBeenCalled();
    expect(getTeamRunState).toHaveBeenCalledOnce();
  });

  it("controls the current standard Team member between authoritative projections", async () => {
    const stored = persistedStandardTeam("claude-sonnet");
    const runningWork = Object.freeze({
      slot_id: stored.leader_assistant_id,
      role: "lead" as const,
      state: "running" as const,
      queued_foreground_count: 0,
      queued_background_count: 0,
      active_turn_id: "native-turn-current",
      active_turn_started_at_ms: 1_785_883_200_000,
      active_turn_elapsed_ms: 10_000,
      active_turn_slow: false,
      active_turn_slow_threshold_ms: 30_000,
      blocked_reason: null,
      team_run_id: "native-run-current",
    });
    const pausedWork = Object.freeze({
      ...runningWork,
      state: "paused" as const,
      active_turn_id: null,
      active_turn_started_at_ms: null,
      active_turn_elapsed_ms: null,
      active_turn_slow: null,
      active_turn_slow_threshold_ms: null,
    });
    const runningRun = Object.freeze({
      team_id: stored.id,
      team_run_id: "native-run-current",
      source: "user_message" as const,
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead" as const,
      status: "running" as const,
      queued_intent_count: 0,
      starting_batch_count: 0,
      running_batch_count: 1,
      active_enqueue_lease_count: 0,
      slot_work: Object.freeze([runningWork]),
    });
    const before = Object.freeze({
      session_generation: "native-session-current",
      active_run: runningRun,
      slot_work: Object.freeze([runningWork]),
    });
    const after = Object.freeze({
      session_generation: "native-session-current",
      active_run: Object.freeze({ ...runningRun, slot_work: Object.freeze([pausedWork]) }),
      slot_work: Object.freeze([pausedWork]),
    });
    const getTeamRunState = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const pauseTeamMemberWork = vi.fn(async () => undefined);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        getTeamRunState,
        pauseTeamMemberWork,
      },
    });

    await expect(
      service.pauseMemberWork(
        stored.id,
        "native-run-current",
        stored.leader_assistant_id,
        "user_stop",
      ),
    ).resolves.toMatchObject({
      experience: "standard",
      active_run: { team_run_id: "native-run-current" },
      slot_work: [{ slot_id: stored.leader_assistant_id, state: "paused" }],
    });
    expect(getTeamRunState).toHaveBeenCalledTimes(2);
    expect(pauseTeamMemberWork).toHaveBeenCalledWith(
      stored.id,
      "native-run-current",
      stored.leader_assistant_id,
      { reason: "user_stop" },
    );
    expect(getTeamRunState.mock.invocationCallOrder[0]).toBeLessThan(
      pauseTeamMemberWork.mock.invocationCallOrder[0]!,
    );
    expect(pauseTeamMemberWork.mock.invocationCallOrder[0]).toBeLessThan(
      getTeamRunState.mock.invocationCallOrder[1]!,
    );
  });

  it("forwards only canonical attachments contained by the observed standard Team workspace", async () => {
    const root = createTestDirectory();
    const workspace = path.join(root, "workspace");
    const admittedFile = path.join(workspace, "brief.txt");
    const outsideFile = path.join(root, "outside.txt");
    fs.mkdirSync(workspace);
    fs.writeFileSync(admittedFile, "bounded input");
    fs.writeFileSync(outsideFile, "outside input");
    const stored = { ...persistedStandardTeam("claude-sonnet"), workspace };
    const run = {
      team_id: stored.id,
      team_run_id: "native-run-attachment",
      source: "user_message",
      has_user_intervention: false,
      target_slot_id: stored.leader_assistant_id,
      target_role: "lead",
      status: "accepted",
      queued_intent_count: 0,
      starting_batch_count: 1,
      running_batch_count: 0,
      active_enqueue_lease_count: 1,
      slot_work: [],
    };
    const sendTeamMessage = vi.fn(async () => ({
      enqueue_status: "accepted",
      message_id: "native-message-attachment",
      run,
    }));
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => stored),
        sendTeamMessage,
        getTeamRunState: vi.fn(async () => ({ active_run: run, slot_work: [] })),
      },
    });

    await expect(
      service.sendMessage(stored.id, "Review the attached brief.", ["brief.txt"]),
    ).resolves.toMatchObject({ experience: "standard", message_id: "native-message-attachment" });
    expect(sendTeamMessage).toHaveBeenCalledWith(stored.id, {
      content: "Review the attached brief.",
      files: [fs.realpathSync(admittedFile)],
    });

    await expect(
      service.sendMessage(stored.id, "Do not read outside the workspace.", [outsideFile]),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(sendTeamMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects direct standard Team mode writes before the generic config effect", async () => {
    const setConfigOption = vi.fn();
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        setConfigOption,
      },
    });

    await expect(
      service.setConfigOption(
        "native-team-1",
        "native-conversation-claude",
        "mode",
        "bypassPermissions",
      ),
    ).rejects.toMatchObject({ code: "team-model-unavailable" });
    expect(setConfigOption).not.toHaveBeenCalled();
  });

  it("restores the minimal Claude Team list projection emitted by real AionCore", async () => {
    const persisted = {
      id: "019fd36c-609c-72a2-a19c-287438184d2d",
      name: "E2E Standard provider authority",
      workspace: "/private/tmp/aionui-e2e-userdata/runtime/conversations/claude-temp-adf6c7a6",
      assistants: [
        {
          slot_id: "019fd36c-609c-72a2-a19c-288bdd27698c",
          assistant_name: "Claude Code",
          name: "Claude Code",
          role: "lead",
          conversation_id: "adf6c7a6",
          assistant_backend: "claude",
          backend: "claude",
          icon: "/api/assets/logos/ai-major/claude.svg",
          model: "default",
          assistant_id: "bare:2d23ff1c",
          pending_confirmations: 0,
        },
      ],
      leader_assistant_id: "019fd36c-609c-72a2-a19c-288bdd27698c",
      created_at: 1_785_958_523_036,
      updated_at: 1_785_958_523_036,
    };
    const Service = standardTeamServiceConstructor();
    const standardTeamCreation = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams: vi.fn(async () => [persisted]),
        createTeam: vi.fn(),
      },
    });

    await expect(standardTeamCreation.list()).resolves.toMatchObject([
      {
        id: persisted.id,
        experience: "standard",
        user_id: "system_default_user",
        workspace_mode: "shared",
        assistants: [
          {
            role: "leader",
            status: "idle",
            assistant_id: "bare:2d23ff1c",
          },
        ],
      },
    ]);

    const persistence = openSqliteCorePersistence(createTestDirectory());
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "6".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(service.dispatch({ kind: "list" })).resolves.toMatchObject([
      { id: persisted.id, experience: "standard" },
    ]);
    await expect(
      new AionUiTeamBridgeService(service).handle({
        contractVersion: 1,
        method: "GET",
        path: "/api/teams?user_id=actestra-local-user",
        body: undefined,
      }),
    ).resolves.toMatchObject({
      status: 200,
      data: [{ id: persisted.id, experience: "standard" }],
    });

    service.close();
    await persistence.close();
  });

  it("accepts AionCore's authoritative auto workspace when none was selected", async () => {
    const createTeam = vi.fn(async () => ({
      ...persistedAionCoreStandardTeam("auto-gemini-3"),
      workspace: "/private/tmp/actestra-auto-team-workspace",
    }));
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("auto-gemini-3")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("auto-gemini-3", ["auto-gemini-3"]),
        ]),
        createTeam,
      }),
    });

    const created = await service.create({ ...standardCreateIntent(), workspace: "" });

    expect(createTeam).toHaveBeenCalledWith(expect.objectContaining({ workspace: "" }));
    expect(created.workspace).toBe("/private/tmp/actestra-auto-team-workspace");
  });

  it("rejects an AionCore Team projection substituted for the requested identity", async () => {
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        getTeam: vi.fn(async () => ({
          ...persistedStandardTeam("gemini-3.1-pro-preview"),
          id: "native-team-substituted",
        })),
      },
    });

    await expect(service.get("native-team-expected")).rejects.toMatchObject({
      code: "team-conflict",
    });
  });

  it("compensates the created Team when AionCore substitutes its postcondition identity", async () => {
    const created = persistedStandardTeam("gemini-3.1-pro-preview");
    const removeTeam = vi.fn(async () => undefined);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-preview")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("gemini-3.1-pro-preview", ["gemini-3.1-pro-preview"]),
        ]),
        createTeam: vi.fn(async () => created),
        getTeam: vi.fn(async () => ({
          ...created,
          id: "native-team-substituted",
          session_mode: "default",
        })),
        setTeamSessionMode: vi.fn(async () => undefined),
        removeTeam,
      },
    });

    await expect(service.create(standardCreateIntent())).rejects.toMatchObject({
      code: "team-conflict",
    });
    expect(removeTeam).toHaveBeenCalledWith(created.id);
  });

  it("fails closed when AionCore runtime discovery still exposes no Gemini model catalog", async () => {
    const createTeam = vi.fn();
    const discoverAssistantModelCatalog = vi.fn(async () => ({ config_options: [] }));
    const Service = standardTeamServiceConstructor();
    const backend = {
      getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
      listManagedAgents: vi.fn(async () => [
        {
          id: "agent-gemini",
          backend: "gemini",
          agent_type: "acp",
          installed: true,
          enabled: true,
          status: "unchecked",
        },
      ]),
      discoverAssistantModelCatalog,
      createTeam,
    };
    const service = new Service({ backend });

    await expect(service.create(standardCreateIntent())).rejects.toMatchObject({
      code: "team-model-unavailable",
    });
    expect(discoverAssistantModelCatalog).toHaveBeenCalledWith("assistant-gemini");
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("shares one authoritative AionCore discovery when a fresh Team selects the same runtime twice", async () => {
    const createTeam = vi.fn(async () => {
      throw new Error("stop after model admission");
    });
    const discoverAssistantModelCatalog = vi.fn(async () => ({
      config_options: geminiManagedAgent("gemini-3.1-pro-high", ["auto-gemini-3"]).config_options,
    }));
    const Service = standardTeamServiceConstructor();
    const backend = {
      getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
      listManagedAgents: vi.fn(async () => [
        {
          id: "agent-gemini",
          backend: "gemini",
          agent_type: "acp",
          installed: true,
          enabled: true,
          status: "unchecked",
        },
      ]),
      discoverAssistantModelCatalog,
      createTeam,
    };
    const original = standardCreateIntent();
    const service = new Service({ backend });

    await expect(
      service.create({
        ...original,
        members: [
          original.members[0],
          { ...original.members[0], displayName: "Gemini teammate", role: "teammate" },
        ],
      }),
    ).rejects.toThrow("stop after model admission");
    expect(discoverAssistantModelCatalog).toHaveBeenCalledTimes(1);
    expect(createTeam).toHaveBeenCalledTimes(1);
  });

  it("falls back from Gemini's stale current model to the explicit admitted auto model", async () => {
    const createTeam = vi.fn(async (body: unknown) => {
      const model = (body as { agents?: readonly Readonly<{ model?: string }>[] }).agents?.[0]
        ?.model;
      return persistedStandardTeam(model ?? "missing");
    });
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          {
            id: "agent-gemini",
            backend: "gemini",
            agent_type: "acp",
            installed: true,
            enabled: true,
            status: "online",
            available_models: {
              current_model_id: "gemini-3.1-pro-high",
              available_models: [
                { id: "auto-gemini-3", label: "Auto (Gemini 3)" },
                {
                  id: "gemini-3.1-pro-preview-customtools",
                  label: "gemini-3.1-pro-preview",
                },
              ],
            },
          },
        ]),
        createTeam,
      }),
    });

    await expect(service.create(standardCreateIntent())).resolves.toMatchObject({
      assistants: [{ model: "auto-gemini-3" }],
    });
    expect(createTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: [expect.objectContaining({ model: "auto-gemini-3" })],
      }),
    );
  });

  it("fails closed when Renderer requests an uncatalogued model from a fresh runtime", async () => {
    const createTeam = vi.fn();
    const discoverAssistantModelCatalog = vi.fn(async () => ({
      config_options: geminiManagedAgent("gemini-3.1-pro-high", ["auto-gemini-3"]).config_options,
    }));
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          {
            id: "agent-gemini",
            backend: "gemini",
            agent_type: "acp",
            installed: true,
            enabled: true,
            status: "online",
          },
        ]),
        discoverAssistantModelCatalog,
        createTeam,
      }),
    });

    await expect(service.create(standardCreateIntent("gemini-3.1-pro-high"))).rejects.toMatchObject(
      {
        code: "team-model-unavailable",
      },
    );
    expect(discoverAssistantModelCatalog).toHaveBeenCalledWith("assistant-gemini");
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("preserves an explicitly selected standard-Team model only when AionCore still admits it", async () => {
    const createTeam = vi.fn(async () => persistedStandardTeam("gemini-2.5-pro"));
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("gemini-3.1-pro-preview", [
            "gemini-3.1-pro-preview",
            "gemini-2.5-pro",
          ]),
        ]),
        createTeam,
      }),
    });

    await expect(service.create(standardCreateIntent("gemini-2.5-pro"))).resolves.toMatchObject({
      assistants: [{ model: "gemini-2.5-pro" }],
    });
    expect(createTeam).toHaveBeenCalledWith(
      expect.objectContaining({ agents: [expect.objectContaining({ model: "gemini-2.5-pro" })] }),
    );
  });

  it("validates standard Team add-member against the same Main-owned model catalog", async () => {
    const addTeamMember = vi.fn(async () => persistedStandardAssistant("gemini-3.1-pro-preview"));
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("gemini-3.1-pro-preview", ["gemini-3.1-pro-preview"]),
        ]),
        createTeam: vi.fn(),
        addTeamMember,
      },
    });

    await expect(
      service.addMember({
        kind: "add-standard-member",
        teamId: "native-team-1",
        member: {
          displayName: "Gemini teammate",
          role: "teammate",
          assistantId: "assistant-gemini",
          requestedModel: null,
        },
      }),
    ).resolves.toEqual({
      experience: "standard",
      assistant: persistedStandardAssistant("gemini-3.1-pro-preview"),
    });
    expect(addTeamMember).toHaveBeenCalledWith("native-team-1", {
      assistant: {
        name: "Gemini teammate",
        role: "teammate",
        assistant_id: "assistant-gemini",
        model: "gemini-3.1-pro-preview",
      },
    });
  });

  it.each([
    ["missing directory", []],
    ["unknown current model", [geminiManagedAgent("gemini-unknown", ["gemini-2.5-pro"])]],
  ])("fails closed before standard-Team persistence for %s", async (_label, catalog) => {
    const createTeam = vi.fn();
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => catalog),
        createTeam,
      }),
    });

    await expect(service.create(standardCreateIntent())).rejects.toMatchObject({
      code: "team-model-unavailable",
    });
    expect(createTeam).not.toHaveBeenCalled();
  });

  it("rejects an ungranted renderer Standard Team workspace before the provider effect", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const create = vi.fn(async () => persistedStandardTeam("gemini-3.1-pro-preview"));
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { create },
      now: clock(),
      createDigest: () => "7".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch(standardCreateIntent() as AionUiTeamBridgeRoute),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(create).not.toHaveBeenCalled();

    service.close();
    await persistence.close();
  });

  it("persists standard Team experience before response and restores list/get from Main authority", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    const workspaceRoot = fs.realpathSync(directory);
    const createIntent = Object.freeze({ ...standardCreateIntent(), workspace: workspaceRoot });
    const persistedTeam = {
      ...persistedStandardTeam("gemini-3.1-pro-preview"),
      workspace: workspaceRoot,
    };
    const standardWorkspaceId = workspaceId("workspace-standard-team-create");
    const grantedAt = instant("2026-08-06T02:20:00.000Z");
    await persistence.replaceDomainGraph({
      workspaces: [
        {
          id: standardWorkspaceId,
          name: "Standard Team workspace",
          state: "active",
          createdAt: grantedAt,
          updatedAt: grantedAt,
        },
      ],
      tasks: [],
      workers: [],
      sessions: [],
      approvals: [],
      artifacts: [],
    });
    await persistence.persistWorkspaceGrant({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: workspaceGrantId("grant-standard-team-create"),
      workspaceId: standardWorkspaceId,
      rootPath: workspaceRoot,
      displayName: "Standard Team workspace",
      state: "active",
      createdAt: grantedAt,
      updatedAt: grantedAt,
    });
    const createTeam = vi.fn(async () => persistedTeam);
    const listTeams = vi.fn(async () => [persistedTeam]);
    const getTeam = vi.fn(async () => persistedTeam);
    const configOptions = Object.freeze({
      config_options: Object.freeze([
        Object.freeze({
          id: "model",
          name: "Model",
          category: "model",
          type: "select",
          current_value: "gemini-3.1-pro-preview",
          options: Object.freeze([
            Object.freeze({
              value: "gemini-3.1-pro-preview",
              name: "gemini-3.1-pro-preview",
            }),
          ]),
        }),
      ]),
    });
    const reconcileConfigOptions = vi.fn(async () => configOptions);
    const setConfigOption = vi.fn(async () => configOptions);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: withSafeSessionInitialization({
        getAssistant: vi.fn(async () => geminiAssistant("gemini-3.1-pro-high")),
        listManagedAgents: vi.fn(async () => [
          geminiManagedAgent("gemini-3.1-pro-preview", ["gemini-3.1-pro-preview"]),
        ]),
        listTeams,
        getTeam,
        createTeam,
        reconcileConfigOptions,
        setConfigOption,
      }),
    });
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "7".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(service.dispatch(createIntent as AionUiTeamBridgeRoute)).resolves.toMatchObject({
      id: "native-team-1",
      experience: "standard",
      assistants: [{ model: "gemini-3.1-pro-preview" }],
    });
    await expect(persistence.getTeamExperienceBinding("native-team-1")).resolves.toMatchObject({
      teamId: "native-team-1",
      experience: "standard",
    });
    await expect(service.dispatch({ kind: "list" })).resolves.toMatchObject([
      { id: "native-team-1", experience: "standard" },
    ]);
    await expect(service.dispatch({ kind: "get", teamId: "native-team-1" })).resolves.toMatchObject(
      {
        id: "native-team-1",
        experience: "standard",
      },
    );
    await expect(
      service.dispatch({
        kind: "config-options",
        teamId: "native-team-1",
        conversationId: "native-conversation-gemini",
      }),
    ).resolves.toBe(configOptions);
    expect(reconcileConfigOptions).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-gemini",
    );
    await expect(
      service.dispatch({
        kind: "set-config-option",
        teamId: "native-team-1",
        conversationId: "native-conversation-gemini",
        optionId: "model",
        value: "gemini-3.1-pro-preview",
      }),
    ).resolves.toBe(configOptions);
    expect(setConfigOption).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-gemini",
      "model",
      "gemini-3.1-pro-preview",
    );
    expect(createTeam).toHaveBeenCalledOnce();
    expect(listTeams).toHaveBeenCalledOnce();
    expect(getTeam).toHaveBeenCalledTimes(2);

    service.close();
    await persistence.close();
  });

  it("sets a standard Team config option through the backend and requires its observed postcondition", async () => {
    const before = Object.freeze({
      config_options: Object.freeze([
        Object.freeze({
          id: "model",
          name: "Model",
          category: "model",
          type: "select" as const,
          current_value: "gemini-3.1-pro-preview",
          options: Object.freeze([
            Object.freeze({ value: "gemini-3.1-pro-preview", name: "Gemini preview" }),
            Object.freeze({ value: "gemini-3.1-pro-high", name: "Gemini high" }),
          ]),
        }),
      ]),
    });
    const observed = Object.freeze({
      config_options: Object.freeze([
        Object.freeze({
          ...before.config_options[0],
          current_value: "gemini-3.1-pro-high",
        }),
      ]),
    });
    const setConfigOption = vi.fn(async () => observed);
    const Service = standardTeamServiceConstructor();
    const service = new Service({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        createTeam: vi.fn(),
        setConfigOption,
      },
    });

    await expect(
      service.setConfigOption(
        "native-team-1",
        "native-conversation-gemini",
        "model",
        "gemini-3.1-pro-high",
      ),
    ).resolves.toBe(observed);
    expect(setConfigOption).toHaveBeenCalledWith(
      "native-team-1",
      "native-conversation-gemini",
      "model",
      "gemini-3.1-pro-high",
    );
  });

  it("routes a standard Team rename through Main and requires the observed AionCore projection", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    let stored = persistedStandardTeam("gemini-3.1-pro-preview");
    const renameTeam = vi.fn(async (_teamId: string, name: string) => {
      stored = { ...stored, name, updated_at: stored.updated_at + 1 };
      return null;
    });
    const getTeam = vi.fn(async () => stored);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams: vi.fn(async () => [stored]),
        getTeam,
        createTeam: vi.fn(),
        renameTeam,
        removeTeam: vi.fn(),
      },
    });
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:30:00.000Z",
      }),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "8".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(
      service.dispatch({ kind: "rename-team", teamId: stored.id, name: "Renamed native Team" }),
    ).resolves.toMatchObject({
      id: stored.id,
      experience: "standard",
      name: "Renamed native Team",
    });
    expect(renameTeam).toHaveBeenCalledWith(stored.id, "Renamed native Team");
    expect(getTeam).toHaveBeenCalledWith(stored.id);

    service.close();
    await persistence.close();
  });

  it("rejects a standard Team deletion until AionCore projects the Team as absent", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const stored = persistedStandardTeam("gemini-3.1-pro-preview");
    const listTeams = vi.fn(async () => [stored]);
    const removeTeam = vi.fn(async () => null);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams,
        getTeam: vi.fn(async () => stored),
        createTeam: vi.fn(),
        removeTeam,
      },
    });
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:31:00.000Z",
      }),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "8".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(service.dispatch({ kind: "remove", teamId: stored.id })).rejects.toMatchObject({
      code: "team-conflict",
    });
    expect(removeTeam).toHaveBeenCalledWith(stored.id);
    expect(listTeams).toHaveBeenCalledOnce();

    service.close();
    await persistence.close();
  });

  it("acknowledges a standard Team deletion only after absence and emits Main-owned events", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    let stored: ReturnType<typeof persistedStandardTeam> | null =
      persistedStandardTeam("gemini-3.1-pro-preview");
    const listTeams = vi.fn(async () => (stored === null ? [] : [stored]));
    const removeTeam = vi.fn(async () => {
      stored = null;
      return null;
    });
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams,
        getTeam: vi.fn(),
        createTeam: vi.fn(),
        removeTeam,
      },
    });
    const standardTeamId = persistedStandardTeam("gemini-3.1-pro-preview").id;
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: standardTeamId,
        experience: "standard",
        boundAt: "2026-08-06T02:32:00.000Z",
      }),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "8".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);
    const events: AionUiTeamEvent[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));

    await expect(service.dispatch({ kind: "remove", teamId: standardTeamId })).resolves.toBeNull();
    expect(removeTeam).toHaveBeenCalledWith(standardTeamId);
    expect(listTeams).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { type: "team.removed", payload: { team_id: standardTeamId } },
      { type: "team.listChanged", payload: { team_id: standardTeamId, action: "removed" } },
    ]);

    unsubscribe();
    service.close();
    await persistence.close();
  });

  it("routes standard member rename through Main and acknowledges only the observed name", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    let stored = persistedStandardTeam("gemini-3.1-pro-preview");
    let applyMutation = false;
    const renameTeamMember = vi.fn(async (_teamId: string, slotId: string, name: string) => {
      if (applyMutation) {
        stored = {
          ...stored,
          assistants: stored.assistants.map((assistant) =>
            assistant.slot_id === slotId ? { ...assistant, assistant_name: name } : assistant,
          ),
          updated_at: stored.updated_at + 1,
        };
      }
      return null;
    });
    const getTeam = vi.fn(async () => stored);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams: vi.fn(async () => [stored]),
        getTeam,
        createTeam: vi.fn(),
        removeTeam: vi.fn(),
        renameTeamMember,
      },
    });
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:33:00.000Z",
      }),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "8".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);
    const events: AionUiTeamEvent[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    const slotId = stored.assistants[0]!.slot_id;

    await expect(
      service.dispatch({ kind: "rename-member", teamId: stored.id, slotId, name: "CLI lead" }),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(events).toEqual([]);

    applyMutation = true;
    await expect(
      service.dispatch({ kind: "rename-member", teamId: stored.id, slotId, name: "CLI lead" }),
    ).resolves.toMatchObject({
      experience: "standard",
      assistants: [expect.objectContaining({ slot_id: slotId, assistant_name: "CLI lead" })],
    });
    expect(renameTeamMember).toHaveBeenCalledWith(stored.id, slotId, "CLI lead");
    expect(getTeam).toHaveBeenCalledWith(stored.id);
    expect(events).toEqual([
      {
        type: "team.agentRenamed",
        payload: { team_id: stored.id, slot_id: slotId, name: "CLI lead" },
      },
    ]);

    unsubscribe();
    service.close();
    await persistence.close();
  });

  it("routes standard member removal through Main and acknowledges only observed absence", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const initial = persistedStandardTeam("gemini-3.1-pro-preview");
    let stored = {
      ...initial,
      assistants: [...initial.assistants, persistedStandardAssistant("gemini-3.1-pro-preview")],
    };
    let applyMutation = false;
    const removeTeamMember = vi.fn(async (_teamId: string, slotId: string) => {
      if (applyMutation) {
        stored = {
          ...stored,
          assistants: stored.assistants.filter((assistant) => assistant.slot_id !== slotId),
          updated_at: stored.updated_at + 1,
        };
      }
      return null;
    });
    const getTeam = vi.fn(async () => stored);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams: vi.fn(async () => [stored]),
        getTeam,
        createTeam: vi.fn(),
        removeTeam: vi.fn(),
        removeTeamMember,
      },
    });
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: stored.id,
        experience: "standard",
        boundAt: "2026-08-06T02:34:00.000Z",
      }),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "8".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);
    const events: AionUiTeamEvent[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    const slotId = stored.assistants[1]!.slot_id;

    await expect(
      service.dispatch({ kind: "remove-member", teamId: stored.id, slotId }),
    ).rejects.toMatchObject({ code: "team-conflict" });
    expect(events).toEqual([]);

    applyMutation = true;
    await expect(
      service.dispatch({ kind: "remove-member", teamId: stored.id, slotId }),
    ).resolves.toBeNull();
    expect(removeTeamMember).toHaveBeenCalledWith(stored.id, slotId);
    expect(getTeam).toHaveBeenCalledWith(stored.id);
    expect(events).toEqual([
      { type: "team.agentRemoved", payload: { team_id: stored.id, slot_id: slotId } },
      { type: "team.listChanged", payload: { team_id: stored.id, action: "agent_removed" } },
    ]);

    unsubscribe();
    service.close();
    await persistence.close();
  });

  it("writes a standard Team config option only for an admitted conversation and observed value", async () => {
    const Backend = guardedStandardTeamLoopbackBackendConstructor();
    const requestLog: Array<{ method: string; url: string; body: unknown }> = [];
    vi.stubGlobal("__backendPort", 43_123);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        let body: unknown;
        if (typeof init?.body === "string") body = JSON.parse(init.body);
        requestLog.push({ method, url, body });
        if (url.endsWith("/api/teams/native-team-1")) {
          return backendResponse({
            assistants: [{ conversation_id: "native-conversation-gemini" }],
          });
        }
        if (url.endsWith("/api/conversations/native-conversation-gemini")) {
          return backendResponse({
            id: "native-conversation-gemini",
            extra: { current_model_id: "gemini-3.1-pro-preview" },
          });
        }
        if (
          url.endsWith(
            "/api/teams/native-team-1/conversations/native-conversation-gemini/config-options",
          )
        ) {
          return backendResponse({
            config_options: [
              {
                id: "model",
                name: "Model",
                category: "model",
                type: "select",
                current_value: "gemini-3.1-pro-preview",
                options: [
                  { value: "gemini-3.1-pro-preview", name: "Gemini preview" },
                  { value: "gemini-3.1-pro-high", name: "Gemini high" },
                ],
              },
            ],
          });
        }
        if (
          method === "PUT" &&
          url.endsWith("/api/conversations/native-conversation-gemini/config-options/model")
        ) {
          expect(body).toEqual({ value: "gemini-3.1-pro-high" });
          return backendResponse({
            confirmation: "observed",
            config_options: [
              {
                id: "model",
                name: "Model",
                category: "model",
                type: "select",
                current_value: "gemini-3.1-pro-high",
                options: [
                  { value: "gemini-3.1-pro-preview", name: "Gemini preview" },
                  { value: "gemini-3.1-pro-high", name: "Gemini high" },
                ],
              },
            ],
          });
        }
        throw new Error(`Unexpected standard Team config request ${method} ${url}`);
      }),
    );
    const backend = new Backend({
      probeProcessGuard: {
        capture: async (conversationId) =>
          Object.freeze({ conversationId, processes: Object.freeze([]) }),
        cleanup: async () => {},
      },
    });

    await expect(
      backend.setConfigOption!(
        "native-team-1",
        "native-conversation-gemini",
        "model",
        "gemini-3.1-pro-high",
      ),
    ).resolves.toMatchObject({
      config_options: [expect.objectContaining({ current_value: "gemini-3.1-pro-high" })],
    });
    expect(
      requestLog.some(
        ({ method, url }) => method === "PUT" && url.includes("config-options/model"),
      ),
    ).toBe(true);
  });

  it("does not reinterpret an orchestrated persistence failure as a standard Team", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const digestTeamId = `team-${"8".repeat(64)}`;
    const getStandard = vi.fn(async () => ({
      ...persistedStandardTeam("gemini-3.1-pro-preview"),
      id: digestTeamId,
    }));
    vi.spyOn(persistence, "getTeamDefinition").mockRejectedValue(
      new Error("schema-15 Team definition is corrupt"),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation: { get: getStandard },
      now: clock(),
      createDigest: () => "9".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(service.dispatch({ kind: "get", teamId: digestTeamId })).rejects.toMatchObject({
      code: "team-execution-failed",
      message: "Team operation failed",
    });
    expect(getStandard).not.toHaveBeenCalled();

    service.close();
    await persistence.close();
  });

  it("binds legacy AionCore and schema-15 Teams once and restores both types after restart", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    const standard = persistedStandardTeam("gemini-3.1-pro-preview");
    const { team: orchestrated } = await createTeamRunFixture("experience-binding-migration");
    await persistence.persistTeamDefinition(orchestrated);
    const StandardService = standardTeamServiceConstructor();
    const standardTeamCreation = new StandardService({
      backend: {
        getAssistant: vi.fn(),
        listManagedAgents: vi.fn(),
        listTeams: vi.fn(async () => [persistedAionCoreStandardTeam("gemini-3.1-pro-preview")]),
        createTeam: vi.fn(),
      },
    });
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      standardTeamCreation,
      now: clock(),
      createDigest: () => "a".repeat(64),
    } as unknown as ConstructorParameters<typeof AionUiTeamService>[0]);

    await expect(service.dispatch({ kind: "list" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: standard.id, experience: "standard" }),
        expect.objectContaining({ id: orchestrated.teamId, experience: "orchestrated" }),
      ]),
    );
    service.close();
    await persistence.close();

    const reopened = openSqliteCorePersistence(directory);
    await expect(reopened.getTeamExperienceBinding(standard.id)).resolves.toMatchObject({
      teamId: standard.id,
      experience: "standard",
    });
    await expect(reopened.getTeamExperienceBinding(orchestrated.teamId)).resolves.toMatchObject({
      teamId: orchestrated.teamId,
      experience: "orchestrated",
    });
    await reopened.close();
  });

  it("fails closed when a schema-15 Team identity was already bound as standard", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const { team } = await createTeamRunFixture("experience-binding-conflict");
    await persistence.persistTeamDefinition(team);
    await persistence.persistTeamExperienceBinding(
      normalizeTeamExperienceBinding({
        contractVersion: 1,
        teamId: team.teamId,
        experience: "standard",
        boundAt: "2026-08-06T02:15:00.000Z",
      }),
    );
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      now: clock(),
      createDigest: () => "b".repeat(64),
    });

    await expect(service.dispatch({ kind: "list" })).rejects.toMatchObject({
      code: "team-conflict",
    });

    service.close();
    await persistence.close();
  });

  it.each(["add-member", "decide-approval", "resolve-feedback"] as const)(
    "rejects orchestrated %s before reading or mutating a Team durably bound as standard",
    async (kind) => {
      const persistence = openSqliteCorePersistence(createTestDirectory());
      const { team, accepted } = await createTeamRunFixture(`experience-guard-${kind}`);
      await persistence.persistTeamDefinition(team);
      await persistence.persistTeamExperienceBinding(
        normalizeTeamExperienceBinding({
          contractVersion: 1,
          teamId: team.teamId,
          experience: "standard",
          boundAt: "2026-08-06T02:16:00.000Z",
        }),
      );
      const getRun = vi.fn(async () => accepted);
      const cancelRun = vi.fn(async () => accepted);
      const orchestrator = {
        create: vi.fn(async () => accepted),
        start: vi.fn(async () => accepted),
        get: getRun,
        subscribe: vi.fn(() => () => {}),
        resolveFeedback: vi.fn(async () => accepted),
        pause: vi.fn(async () => accepted),
        resume: vi.fn(async () => accepted),
        decideApproval: vi.fn(async () => accepted),
        retry: vi.fn(async () => accepted),
        replace: vi.fn(async () => accepted),
        requestHandoff: vi.fn(async () => accepted),
        cancelNode: vi.fn(async () => accepted),
        cancelRun,
      } satisfies AionUiTeamOrchestratorPort;
      const service = new AionUiTeamService({
        persistence,
        admission: null,
        orchestrator,
        now: clock(),
        createDigest: () => "c".repeat(64),
      });
      const route: AionUiTeamBridgeRoute =
        kind === "add-member"
          ? {
              kind,
              teamId: team.teamId,
              member: {
                displayName: "Unexpected General member",
                role: "teammate",
                capability: "general",
              },
            }
          : kind === "decide-approval"
            ? {
                kind,
                teamId: team.teamId,
                runId: accepted.runId,
                slotId: team.members[0]!.memberId,
                decision: "approved",
              }
            : {
                kind,
                teamId: team.teamId,
                runId: accepted.runId,
                decision: "approved",
                note: "Must not cross the durable experience boundary.",
              };

      await expect(service.dispatch(route)).rejects.toMatchObject({ code: "team-conflict" });
      expect(getRun).not.toHaveBeenCalled();
      expect(cancelRun).not.toHaveBeenCalled();
      await expect(persistence.getTeamDefinition(team.teamId)).resolves.toEqual(team);

      service.close();
      await persistence.close();
    },
  );

  it("persists native Team CRUD and member edits through schema-15 CAS authority", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      now: clock(),
      createDigest: () => "1".repeat(64),
    });

    const created = requireNativeTeam(await service.dispatch(createRoute));
    expect(created).toMatchObject({
      id: `team-${"1".repeat(64)}`,
      experience: "orchestrated",
      description: createRoute.description,
      workspace: createRoute.workspaceId,
      workspace_mode: "isolated",
      session_mode: "plan",
    });
    expect(created.assistants.map(({ assistant_id }) => assistant_id)).toEqual([
      "actestra-general-worker",
      "actestra-goose-worker",
    ]);
    await expect(service.dispatch({ kind: "list" })).resolves.toEqual([created]);

    const renamed = requireNativeTeam(
      await service.dispatch({ kind: "rename-team", teamId: created.id, name: "Release Team" }),
    );
    expect(renamed.name).toBe("Release Team");
    const added = await service.dispatch({
      kind: "add-member",
      teamId: created.id,
      member: { displayName: "General researcher", role: "teammate", capability: "general" },
    });
    expect(added).toMatchObject({
      assistant_backend: "general",
      assistant_name: "General researcher",
    });
    const expanded = requireNativeTeam(await service.dispatch({ kind: "get", teamId: created.id }));
    expect(expanded.assistants).toHaveLength(3);
    await service.dispatch({
      kind: "remove-member",
      teamId: created.id,
      slotId: expanded.assistants[2]!.slot_id,
    });
    await expect(service.dispatch({ kind: "remove", teamId: created.id })).resolves.toBeNull();
    await expect(service.dispatch({ kind: "list" })).resolves.toEqual([]);

    service.close();
    await persistence.close();
  });

  it("projects planner submission availability before accepting a Team task intent", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      now: clock(),
      createDigest: () => "d".repeat(64),
    });
    const created = requireNativeTeam(await service.dispatch(createRoute));

    await expect(
      service.dispatch({ kind: "run-state", teamId: created.id }),
    ).resolves.toMatchObject({
      submission: {
        availability: "unavailable",
        blocked_reason: "planner-unavailable",
        next_action: "restart-after-planner-admission",
        authority_source: "actestra-main-runtime",
      },
    });
    await expect(
      service.dispatch({
        kind: "send-message",
        teamId: created.id,
        content: "Do not accept this intent without an admitted planner.",
        files: [],
        requestNonce: `team-request-${"7".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "team-planner-unavailable" });
    await expect(persistence.listTeamRunsForTeam(created.id as never, 100)).resolves.toEqual([]);

    service.close();
    await persistence.close();
  });

  it("projects worker runtime unavailability after planner admission", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const admission = {
      propose: vi.fn(async () => {
        throw new Error("The planner must not be called for a read-only readiness projection");
      }),
    };
    const service = new AionUiTeamService({
      persistence,
      admission,
      orchestrator: null,
      now: clock(),
      createDigest: () => "c".repeat(64),
    });
    const created = requireNativeTeam(await service.dispatch(createRoute));

    await expect(
      service.dispatch({ kind: "run-state", teamId: created.id }),
    ).resolves.toMatchObject({
      submission: {
        availability: "unavailable",
        blocked_reason: "worker-runtime-unavailable",
        next_action: "configure-worker-runtime",
        authority_source: "actestra-main-runtime",
      },
    });
    await expect(
      service.dispatch({
        kind: "send-message",
        teamId: created.id,
        content: "Do not start Workers until both runtimes are configured.",
        files: [],
        requestNonce: `team-request-${"6".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "team-worker-runtime-unavailable" });
    expect(admission.propose).not.toHaveBeenCalled();
    await expect(persistence.listTeamRunsForTeam(created.id as never, 100)).resolves.toEqual([]);

    service.close();
    await persistence.close();
  });

  it("lists only active Actestra-owned workspace grants without exposing paths", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    const activeWorkspaceId = workspaceId("workspace-team-active");
    const archivedWorkspaceId = workspaceId("workspace-team-archived");
    const occurredAt = instant("2026-08-05T02:00:00.000Z");
    await persistence.replaceDomainGraph({
      workspaces: [
        {
          id: activeWorkspaceId,
          name: "Launch workspace",
          state: "active",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
        {
          id: archivedWorkspaceId,
          name: "Archived workspace",
          state: "archived",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      ],
      tasks: [],
      workers: [],
      sessions: [],
      approvals: [],
      artifacts: [],
    });
    await persistence.persistWorkspaceGrant({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: workspaceGrantId("grant-team-active"),
      workspaceId: activeWorkspaceId,
      rootPath: fs.realpathSync(directory),
      displayName: "Launch workspace",
      state: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      now: clock(),
      createDigest: () => "9".repeat(64),
    });

    const options = await service.dispatch({ kind: "list-workspaces" });

    expect(options).toEqual({
      workspace_options: [{ workspace_id: activeWorkspaceId, display_name: "Launch workspace" }],
    });
    expect(JSON.stringify(options)).not.toContain(directory);
    expect(JSON.stringify(options)).not.toContain(archivedWorkspaceId);

    service.close();
    await persistence.close();
  });

  it("selects and persists a Workspace grant in Main while projecting no renderer path", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    const select = vi.fn(async () => ({
      rootPath: fs.realpathSync(directory),
      displayName: "Approved Team workspace",
    }));
    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator: null,
      workspaceSelection: { select },
      now: clock(),
      createDigest: () => "8".repeat(64),
    });

    const selected = (await service.dispatch({
      kind: "select-workspace",
    })) as NativeAionUiTeamWorkspaceOption;

    expect(select).toHaveBeenCalledOnce();
    expect(selected).toEqual({
      workspace_id: expect.stringMatching(/^workspace-team-/u),
      display_name: "Approved Team workspace",
    });
    expect(JSON.stringify(selected)).not.toContain(directory);
    await expect(service.dispatch({ kind: "list-workspaces" })).resolves.toEqual({
      workspace_options: [selected],
    });
    const graph = await persistence.loadDomainGraph();
    expect(graph.workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: selected.workspace_id, state: "active" }),
      ]),
    );
    const grant = await persistence.getActiveWorkspaceGrant(workspaceId(selected.workspace_id));
    expect(grant).toMatchObject({
      workspaceId: selected.workspace_id,
      rootPath: fs.realpathSync(directory),
      displayName: "Approved Team workspace",
      state: "active",
    });

    service.close();
    await persistence.close();
  });

  it("admits, starts, explains, controls, and cancels a real persisted Team run", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const now = clock();
    const planner = { propose: vi.fn(async (request: unknown) => candidateFor(request)) };
    const admission = new TeamPlanAdmissionService({ planner, persistence });
    const executions: Array<{ signal: AbortSignal; capability: string }> = [];
    const worker: TeamWorkerExecutionPort = {
      taskIdFor: ({ nodeId, attemptNumber }) =>
        taskId(`task-team-ui-${nodeId.slice(-12)}-${String(attemptNumber)}`),
      execute: vi.fn((input, signal): Promise<TeamWorkerExecutionResult> => {
        executions.push({ signal, capability: input.capability });
        return new Promise<TeamWorkerExecutionResult>(() => {});
      }),
      prepareApprovalDecision: vi.fn(),
      commitApprovalDecision: vi.fn(),
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    };
    const aggregator: TeamResultAggregationPort = {
      aggregate: vi.fn(async () => ({ summary: "Unused", artifacts: [] })),
    };
    const orchestrator = new TeamOrchestratorService({ persistence, worker, aggregator, now });
    const service = new AionUiTeamService({
      persistence,
      admission,
      orchestrator,
      now,
      createDigest: () => "2".repeat(64),
    });
    const events: AionUiTeamEvent[] = [];
    const unsubscribe = service.subscribe((event) => events.push(event));
    const created = requireNativeTeam(await service.dispatch(createRoute));

    const acknowledgement = (await service.dispatch({
      kind: "send-message",
      teamId: created.id,
      content: "Prepare a bounded release brief and matching code change.",
      files: [],
      requestNonce: `team-request-${"a".repeat(64)}`,
    })) as NativeAionUiTeamRunAck;
    expect(acknowledgement).toMatchObject({
      enqueue_status: "accepted",
      run: {
        team_id: created.id,
        status: "running",
        actestra: { authority: "Actestra Core", authority_source: "schema-15-team-run" },
      },
    });
    expect(planner.propose).toHaveBeenCalledOnce();
    expect(executions.map(({ capability }) => capability).sort()).toEqual(["coding", "general"]);
    expect(
      acknowledgement.run.actestra.nodes.map(({ current_executor }) => current_executor),
    ).toEqual(expect.arrayContaining(["General Worker", "Goose", "User"]));

    const state = (await service.dispatch({
      kind: "run-state",
      teamId: created.id,
    })) as NativeAionUiTeamRunState;
    expect(state.session_generation).toContain("schema-15-revision-");
    const coding = created.assistants.find(
      ({ assistant_backend }) => assistant_backend === "goose",
    )!;
    await service.dispatch({
      kind: "pause-node",
      teamId: created.id,
      runId: acknowledgement.run.team_run_id,
      slotId: coding.slot_id,
      reason: "Pause before a protected operation.",
    });
    expect(worker.pause).toHaveBeenCalledOnce();

    const cancelled = (await service.dispatch({
      kind: "cancel-run",
      teamId: created.id,
      runId: acknowledgement.run.team_run_id,
      reason: "Stop the whole Team.",
    })) as NativeAionUiTeamRunState;
    expect(cancelled.active_run?.status).toBe("cancelled");
    expect(worker.cancel).toHaveBeenCalledTimes(2);
    expect(executions.every(({ signal }) => signal.aborted)).toBe(true);
    expect(events.some(({ type }) => type === "team.runAccepted")).toBe(true);
    expect(events.some(({ type }) => type === "team.runCancelled")).toBe(true);

    unsubscribe();
    service.close();
    await orchestrator.close();
    await persistence.close();
  });

  it("rebuilds durable Team chat activity from admitted-plan and run-revision authority", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    const now = clock();
    const planner = { propose: vi.fn(async (request: unknown) => candidateFor(request)) };
    const admission = new TeamPlanAdmissionService({ planner, persistence });
    const worker: TeamWorkerExecutionPort = {
      taskIdFor: ({ nodeId, attemptNumber }) =>
        taskId(`task-team-chat-${nodeId.slice(-12)}-${String(attemptNumber)}`),
      execute: vi.fn(
        async (input): Promise<TeamWorkerExecutionResult> => ({
          status: "completed",
          summary: `${input.capability} private output at /private/worker-root.`,
          artifacts: [
            {
              artifactId: artifactId(`artifact-team-chat-${input.capability}`),
              taskId: input.workerTaskId,
              kind: input.expectedArtifactKind,
            },
          ],
        }),
      ),
      prepareApprovalDecision: vi.fn(),
      commitApprovalDecision: vi.fn(),
      pause: vi.fn(async () => {}),
      resume: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    };
    const aggregator: TeamResultAggregationPort = {
      aggregate: vi.fn(async () => ({ summary: "Unused", artifacts: [] })),
    };
    const orchestrator = new TeamOrchestratorService({ persistence, worker, aggregator, now });
    const service = new AionUiTeamService({
      persistence,
      admission,
      orchestrator,
      now,
      createDigest: () => "3".repeat(64),
    });
    const created = requireNativeTeam(await service.dispatch(createRoute));
    const goal = "Prepare a durable Team brief and matching isolated code change.";
    const acknowledgement = (await service.dispatch({
      kind: "send-message",
      teamId: created.id,
      content: goal,
      files: [],
      requestNonce: `team-request-${"b".repeat(64)}`,
    })) as NativeAionUiTeamRunAck;
    await orchestrator.waitForIdle(teamRunId(acknowledgement.run.team_run_id));

    service.close();
    await orchestrator.close();
    await persistence.close();

    const reopenedPersistence = openSqliteCorePersistence(directory);
    const reopened = new AionUiTeamService({
      persistence: reopenedPersistence,
      admission: null,
      orchestrator: null,
      now: clock(),
      createDigest: () => "4".repeat(64),
    });
    const recovered = (await reopened.dispatch({
      kind: "run-state",
      teamId: created.id,
    })) as NativeAionUiTeamRunState;

    const activities = (recovered as unknown as { readonly activities?: readonly unknown[] })
      .activities;
    expect(activities).toBeDefined();
    expect(activities?.[0]).toMatchObject({
      id: acknowledgement.message_id,
      author: "You",
      content: goal,
      tone: "user",
    });
    expect(activities?.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          author: "General Worker",
          content: "Prepare the bounded brief completed with 1 durable Artifact reference.",
          tone: "worker",
        }),
        expect.objectContaining({
          author: "Goose",
          content: "Prepare the bounded patch completed with 1 durable Artifact reference.",
          tone: "worker",
        }),
      ]),
    );
    expect(JSON.stringify(recovered)).not.toContain("/private/");

    reopened.close();
    await reopenedPersistence.close();
  });
});
