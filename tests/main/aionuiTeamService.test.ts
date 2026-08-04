// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  instant,
  normalizeTeamPlannerRequest,
  taskId,
  type Instant,
  type TeamPlanCandidate,
} from "../../apps/desktop/src/core";
import type {
  AionUiTeamBridgeRoute,
  AionUiTeamEvent,
  NativeAionUiTeam,
  NativeAionUiTeamRunAck,
  NativeAionUiTeamRunState,
} from "../../apps/desktop/src/compatibility/aionui";
import { AionUiTeamService } from "../../apps/desktop/src/main/compatibility/aionuiTeamService";
import {
  TeamOrchestratorService,
  type TeamResultAggregationPort,
  type TeamWorkerExecutionResult,
  type TeamWorkerExecutionPort,
} from "../../apps/desktop/src/main/orchestration/teamOrchestratorService";
import { TeamPlanAdmissionService } from "../../apps/desktop/src/main/orchestration/teamPlanAdmissionService";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-team-service-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
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
  name: "Actestra delivery Team",
  workspaceId: "workspace-aionui-team-service",
  members: Object.freeze([
    Object.freeze({ displayName: "General lead", role: "leader", capability: "general" }),
    Object.freeze({ displayName: "Goose coding worker", role: "teammate", capability: "coding" }),
  ]),
}) satisfies AionUiTeamBridgeRoute;

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
});
