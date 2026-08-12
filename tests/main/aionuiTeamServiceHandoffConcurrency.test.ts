// @vitest-environment node

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitTeamPlanCandidate,
  createTeamRunSnapshot,
  instant,
  normalizeTeamDefinition,
  normalizeTeamExperienceBinding,
  sessionId,
  taskId,
  toolOutputReference,
  toolRequestId,
  transitionTeamRun,
  workerId,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
} from "../../apps/desktop/src/core";
import { AionUiTeamService } from "../../apps/desktop/src/main/compatibility/aionuiTeamService";
import {
  TeamOrchestratorService,
  type TeamResultAggregationPort,
  type TeamWorkerExecutionPort,
} from "../../apps/desktop/src/main/orchestration/teamOrchestratorService";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-handoff-concurrency-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-handoff-concurrency-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function createTeamRunFixture(suffix: string) {
  const teamId = `team-${digest(`handoff-team:${suffix}`)}`;
  const workspaceId = `workspace-handoff-concurrent-${suffix}`;
  const userGoal = "Test concurrent handoff";

  const request = {
    protocolVersion: 1,
    correlationId: `correlation-handoff-${suffix}`,
    planVersion: 1,
    goal: userGoal,
    workerCapabilities: ["coding", "general"],
    contextReferences: [],
    limits: {
      maxNodes: 3,
      maxDepth: 2,
      maxConcurrency: 2,
      maxTotalAttempts: 3,
    },
  } as const;

  const plan = await admitTeamPlanCandidate(request, {
    protocolVersion: 1,
    correlationId: request.correlationId,
    planVersion: request.planVersion,
    summary: "Run coding task",
    nodes: [
      {
        candidateKey: "coding",
        title: "Coding task",
        kind: "worker",
        capability: "coding",
        dependsOn: [],
        expectedArtifactKind: "file",
        completionCriteria: "Coding complete",
        risk: "low",
        maxAttempts: 1,
      },
      {
        candidateKey: "general",
        title: "General task",
        kind: "worker",
        capability: "general",
        dependsOn: [],
        expectedArtifactKind: "document",
        completionCriteria: "General complete",
        risk: "low",
        maxAttempts: 1,
      },
      {
        candidateKey: "feedback",
        title: "Request feedback",
        kind: "human-feedback",
        dependsOn: ["coding", "general"],
        completionCriteria: "User accepts",
        risk: "low",
      },
    ],
  });

  const team = normalizeTeamDefinition({
    contractVersion: 1,
    teamId,
    name: "Concurrent Handoff Team",
    workspaceId,
    members: [
      {
        memberId: `team-member-${digest(`coding:${suffix}`)}`,
        displayName: "Coding Worker",
        role: "teammate",
        capability: "coding",
      },
      {
        memberId: `team-member-${digest(`general:${suffix}`)}`,
        displayName: "General Worker",
        role: "leader",
        capability: "general",
      },
    ],
    createdAt: "2026-08-05T03:00:00.000Z",
    updatedAt: "2026-08-05T03:00:00.000Z",
  });

  const accepted = createTeamRunSnapshot(plan, team, instant("2026-08-05T03:00:00.000Z"));

  return { plan, team, accepted };
}

async function prepareHandoffRun(suffix: string, workspaceName: string) {
  const directory = createTestDirectory();
  const persistence = openSqliteCorePersistence(directory);
  const fixture = await createTeamRunFixture(suffix);

  await persistence.persistAdmittedTeamPlan(fixture.plan);
  await persistence.persistTeamDefinition(fixture.team);
  await persistence.persistTeamExperienceBinding(
    normalizeTeamExperienceBinding({
      contractVersion: 1,
      teamId: fixture.team.teamId,
      experience: "orchestrated",
      boundAt: "2026-08-05T03:00:00.000Z",
    }),
  );
  await persistence.replaceDomainGraph({
    workspaces: [
      {
        id: fixture.team.workspaceId,
        name: workspaceName,
        state: "active",
        createdAt: instant("2026-08-05T03:00:00.000Z"),
        updatedAt: instant("2026-08-05T03:00:00.000Z"),
      },
    ],
    tasks: [],
    workers: [],
    sessions: [],
    approvals: [],
    artifacts: [],
  });

  const persist = async (snapshot: typeof fixture.accepted) => {
    await persistence.persistTeamRunSnapshot(snapshot);
    return snapshot;
  };

  let snapshot = await persist(fixture.accepted);
  snapshot = await persist(
    transitionTeamRun(snapshot, {
      type: "start-run",
      occurredAt: "2026-08-05T03:00:01.000Z",
    }),
  );

  const general = snapshot.nodes.find(
    (node) => node.kind === "worker" && node.capability === "general",
  )!;

  snapshot = await persist(
    transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: general.nodeId,
      workerTaskId: `task-team-general-${suffix}`,
      occurredAt: "2026-08-05T03:00:02.000Z",
    }),
  );

  snapshot = await persist(
    transitionTeamRun(snapshot, {
      type: "complete-node",
      nodeId: general.nodeId,
      attemptId: snapshot.nodes.find(({ nodeId }) => nodeId === general.nodeId)!.attempts[0]!
        .attemptId,
      artifacts: [
        {
          artifactId: `artifact-team-general-${suffix}`,
          taskId: `task-team-general-${suffix}`,
          kind: "document",
        },
      ],
      summary: "The General branch is complete.",
      occurredAt: "2026-08-05T03:00:03.000Z",
    }),
  );

  const coding = snapshot.nodes.find(
    (node) => node.kind === "worker" && node.capability === "coding",
  )!;

  snapshot = await persist(
    transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: coding.nodeId,
      workerTaskId: `task-team-coding-${suffix}`,
      occurredAt: "2026-08-05T03:00:04.000Z",
    }),
  );

  snapshot = await persist(
    transitionTeamRun(snapshot, {
      type: "request-handoff",
      nodeId: coding.nodeId,
      reason: "User will provide reviewed result",
      occurredAt: "2026-08-05T03:00:05.000Z",
    }),
  );

  return { persistence, fixture, snapshot, coding };
}

function createHandoffWorkerStub(): TeamWorkerExecutionPort {
  return {
    taskIdFor: vi.fn(() => taskId("task-unexpected")),
    execute: vi.fn(),
    prepareApprovalDecision: vi.fn(),
    commitApprovalDecision: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
  };
}

function createHandoffAggregatorStub(): TeamResultAggregationPort {
  return {
    aggregate: vi.fn(async () => ({ summary: "Complete", artifacts: [] })),
  };
}

describe("AionUiTeamService handoff concurrency", () => {
  it.each([
    {
      title: "identical content",
      suffix: "same-content",
      workspaceName: "Concurrent identical handoff workspace",
      digestCharacter: "a",
      firstContent: "The reviewed coding result is complete.",
      secondContent: "The reviewed coding result is complete.",
    },
    {
      title: "differing content",
      suffix: "different-content",
      workspaceName: "Concurrent differing handoff workspace",
      digestCharacter: "b",
      firstContent: "First reviewed coding result.",
      secondContent: "Second reviewed coding result.",
    },
  ])(
    "serializes concurrent handoff submissions for the same node with $title",
    async ({ suffix, workspaceName, digestCharacter, firstContent, secondContent }) => {
      const { persistence, fixture, snapshot, coding } = await prepareHandoffRun(
        suffix,
        workspaceName,
      );

      const orchestrator = new TeamOrchestratorService({
        persistence,
        worker: createHandoffWorkerStub(),
        aggregator: createHandoffAggregatorStub(),
        now: () => instant("2026-08-05T03:01:00.000Z"),
      });

      const service = new AionUiTeamService({
        persistence,
        admission: null,
        orchestrator,
        now: () => instant("2026-08-05T03:01:01.000Z"),
        createDigest: () => digestCharacter.repeat(64),
      });

      const codingSlot = fixture.team.members.find(({ capability }) => capability === "coding")!;

      const [first, second] = await Promise.allSettled([
        service.dispatch({
          kind: "complete-handoff",
          teamId: fixture.team.teamId,
          runId: snapshot.runId,
          slotId: codingSlot.memberId,
          content: firstContent,
        }),
        service.dispatch({
          kind: "complete-handoff",
          teamId: fixture.team.teamId,
          runId: snapshot.runId,
          slotId: codingSlot.memberId,
          content: secondContent,
        }),
      ]);

      const settled = [first, second];
      expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);

      const rejected = settled.filter(({ status }) => status === "rejected");
      expect(rejected).toHaveLength(1);
      const failureReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(failureReason).toBeInstanceOf(Error);
      expect(failureReason).toMatchObject({ code: "team-conflict" });

      const graph = await persistence.loadDomainGraph();
      const artifacts = graph.artifacts.filter(
        ({ taskId: ownerTaskId }) => ownerTaskId === coding.taskId,
      );
      expect(artifacts).toHaveLength(1);

      const artifact = artifacts[0];
      if (artifact?.sessionId === undefined) throw new Error("Artifact session missing");
      const session = graph.sessions.find(({ id }) => id === artifact.sessionId)!;
      const referenceSuffix = artifact.id.slice("artifact-team-handoff-".length);
      const acceptedContent = first.status === "fulfilled" ? firstContent : secondContent;

      await expect(
        persistence.resolveContentReference({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          reference: toolOutputReference(`output-team-handoff-${referenceSuffix}`),
          kind: "tool-output",
          owner: {
            workspaceId: fixture.team.workspaceId,
            taskId: coding.taskId,
            sessionId: sessionId(session.id),
            workerId: workerId(session.workerId),
            requestId: toolRequestId(`request-team-handoff-${referenceSuffix}`),
          },
          resolvedAt: instant("2026-08-05T03:01:02.000Z"),
          consume: false,
        }),
      ).resolves.toMatchObject({ content: acceptedContent });

      const completedCoding = (
        (await orchestrator.get(snapshot.runId)) as { nodes: readonly { nodeId: string }[] }
      ).nodes.find(({ nodeId }) => nodeId === coding.nodeId)!;
      expect(completedCoding).toMatchObject({ status: "completed" });

      service.close();
      await orchestrator.close();
      await persistence.close();
    },
  );

  it("never completes the handed-off node when the Artifact persistence fails", async () => {
    const { persistence, fixture, snapshot } = await prepareHandoffRun(
      "persist-failure",
      "Handoff failure workspace",
    );

    const orchestrator = new TeamOrchestratorService({
      persistence,
      worker: createHandoffWorkerStub(),
      aggregator: createHandoffAggregatorStub(),
      now: () => instant("2026-08-05T03:01:00.000Z"),
    });
    const completeHandoff = vi.spyOn(orchestrator, "completeHandoff");

    // A closed persistence makes the Main-owned Artifact write fail first.
    await persistence.close();

    const service = new AionUiTeamService({
      persistence,
      admission: null,
      orchestrator,
      now: () => instant("2026-08-05T03:01:01.000Z"),
      createDigest: () => "f".repeat(64),
    });

    const codingSlot = fixture.team.members.find(({ capability }) => capability === "coding")!;

    await expect(
      service.dispatch({
        kind: "complete-handoff",
        teamId: fixture.team.teamId,
        runId: snapshot.runId,
        slotId: codingSlot.memberId,
        content: "This reviewed coding result must not persist.",
      }),
    ).rejects.toThrow();

    expect(completeHandoff).not.toHaveBeenCalled();

    service.close();
    await orchestrator.close();
  });
});
