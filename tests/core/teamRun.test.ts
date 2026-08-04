import { beforeAll, describe, expect, it } from "vitest";
import * as core from "../../apps/desktop/src/core";
import type { AdmittedTeamPlan } from "../../apps/desktop/src/core";

const REQUEST = {
  protocolVersion: 1,
  correlationId: "correlation-team-run-core",
  planVersion: 1,
  goal: "Coordinate one bounded General and coding result with explicit feedback.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [],
  limits: {
    maxNodes: 5,
    maxDepth: 4,
    maxConcurrency: 2,
    maxTotalAttempts: 6,
  },
} as const;

const CANDIDATE = {
  protocolVersion: 1,
  correlationId: REQUEST.correlationId,
  planVersion: REQUEST.planVersion,
  summary: "Prepare context and checks, implement, request feedback, then aggregate.",
  nodes: [
    {
      candidateKey: "research",
      title: "Prepare bounded context",
      kind: "worker",
      capability: "general",
      dependsOn: [],
      expectedArtifactKind: "document",
      completionCriteria: "One bounded context document is available.",
      risk: "low",
      maxAttempts: 1,
    },
    {
      candidateKey: "implementation",
      title: "Implement in isolation",
      kind: "worker",
      capability: "coding",
      dependsOn: ["research"],
      expectedArtifactKind: "file",
      completionCriteria: "One reviewed patch Artifact is available.",
      risk: "medium",
      maxAttempts: 2,
    },
    {
      candidateKey: "checks",
      title: "Review acceptance conditions",
      kind: "worker",
      capability: "general",
      dependsOn: [],
      expectedArtifactKind: "document",
      completionCriteria: "One acceptance document is available.",
      risk: "low",
      maxAttempts: 1,
    },
    {
      candidateKey: "feedback",
      title: "Request bounded feedback",
      kind: "human-feedback",
      dependsOn: ["implementation", "checks"],
      completionCriteria: "The user accepts or rejects the bounded result.",
      risk: "medium",
    },
    {
      candidateKey: "aggregate",
      title: "Aggregate accepted results",
      kind: "worker",
      capability: "general",
      dependsOn: ["feedback"],
      expectedArtifactKind: "document",
      completionCriteria: "One final result references completed Artifacts.",
      risk: "low",
      maxAttempts: 1,
    },
  ],
} as const;

describe("Actestra Team run authority", () => {
  let plan: AdmittedTeamPlan;

  beforeAll(async () => {
    plan = await core.admitTeamPlanCandidate(REQUEST, CANDIDATE);
  });

  function createTeam() {
    return core.normalizeTeamDefinition({
      contractVersion: 1,
      teamId: `team-${"a".repeat(64)}`,
      name: "Bounded mixed team",
      workspaceId: "workspace-team-run-core",
      members: [
        {
          memberId: `team-member-${"b".repeat(64)}`,
          role: "leader",
          capability: "general",
          displayName: "General lead",
        },
        {
          memberId: `team-member-${"c".repeat(64)}`,
          role: "teammate",
          capability: "coding",
          displayName: "Goose coding worker",
        },
      ],
      createdAt: "2026-08-04T01:00:00.000Z",
      updatedAt: "2026-08-04T01:00:00.000Z",
    });
  }

  function startRun() {
    return core.transitionTeamRun(
      core.createTeamRunSnapshot(plan, createTeam(), core.instant("2026-08-04T01:00:01.000Z")),
      {
        type: "start-run",
        occurredAt: core.instant("2026-08-04T01:00:02.000Z"),
      },
    );
  }

  function completeWorker(
    snapshot: ReturnType<typeof startRun>,
    candidateKey: string,
    workerSuffix: string,
    startedAt: string,
    completedAt: string,
  ) {
    const node = snapshot.nodes.find((candidate) => candidate.candidateKey === candidateKey)!;
    if (node.kind !== "worker") throw new Error("Expected a worker node");
    const workerTaskId = core.taskId(`task-team-worker-${workerSuffix}`);
    const running = core.transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: node.nodeId,
      workerTaskId,
      occurredAt: core.instant(startedAt),
    });
    const attempt = running.nodes
      .find((candidate) => candidate.nodeId === node.nodeId)!
      .attempts.at(-1)!;
    return core.transitionTeamRun(running, {
      type: "complete-node",
      nodeId: node.nodeId,
      attemptId: attempt.attemptId,
      artifacts: [
        {
          artifactId: core.artifactId(`artifact-team-${workerSuffix}`),
          taskId: workerTaskId,
          kind: node.expectedArtifactKind,
        },
      ],
      summary: `${node.title} completed with one owned Artifact.`,
      occurredAt: core.instant(completedAt),
    });
  }

  function createFeedbackBlockedRun() {
    let snapshot = startRun();
    snapshot = completeWorker(
      snapshot,
      "research",
      "research-feedback",
      "2026-08-04T01:00:03.000Z",
      "2026-08-04T01:00:04.000Z",
    );
    snapshot = completeWorker(
      snapshot,
      "checks",
      "checks-feedback",
      "2026-08-04T01:00:05.000Z",
      "2026-08-04T01:00:06.000Z",
    );
    return completeWorker(
      snapshot,
      "implementation",
      "implementation-feedback",
      "2026-08-04T01:00:07.000Z",
      "2026-08-04T01:00:08.000Z",
    );
  }

  it("creates one deterministic durable run without attempts", () => {
    const team = createTeam();
    const run = core.createTeamRunSnapshot(plan, team, core.instant("2026-08-04T01:00:01.000Z"));
    const replay = core.createTeamRunSnapshot(plan, team, core.instant("2026-08-04T01:00:01.000Z"));

    expect(run).toEqual(replay);
    expect(run).toMatchObject({
      contractVersion: 1,
      teamId: team.teamId,
      planId: plan.planId,
      revision: 1,
      status: "accepted",
      createdAt: "2026-08-04T01:00:01.000Z",
      updatedAt: "2026-08-04T01:00:01.000Z",
    });
    expect(run.runId).toMatch(/^team-run-[a-f0-9]{64}$/u);
    expect(run.nodes.map(({ candidateKey }) => candidateKey)).toEqual([
      "checks",
      "research",
      "implementation",
      "feedback",
      "aggregate",
    ]);
    expect(
      run.nodes.every(({ status, attempts }) => status === "pending" && attempts.length === 0),
    ).toBe(true);
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.nodes)).toBe(true);
    expect(run.nodes.every((node) => Object.isFrozen(node) && Object.isFrozen(node.attempts))).toBe(
      true,
    );
  });

  it("retains an admitted node-count ceiling above the actual canonical graph", async () => {
    const boundedPlan = await core.admitTeamPlanCandidate(
      {
        ...REQUEST,
        correlationId: "correlation-team-run-node-ceiling",
      },
      {
        protocolVersion: 1,
        correlationId: "correlation-team-run-node-ceiling",
        planVersion: 1,
        summary: "Run two parallel Workers before bounded workflow feedback.",
        nodes: [
          CANDIDATE.nodes[0],
          {
            ...CANDIDATE.nodes[1],
            dependsOn: [],
          },
          {
            ...CANDIDATE.nodes[3],
            dependsOn: ["research", "implementation"],
          },
        ],
      },
    );

    const run = core.createTeamRunSnapshot(
      boundedPlan,
      createTeam(),
      core.instant("2026-08-04T01:00:01.000Z"),
    );
    expect(run.nodes).toHaveLength(3);
    expect(run.limits.maxNodes).toBe(5);
  });

  it("opens only dependency-ready nodes when a persisted run starts", () => {
    const accepted = core.createTeamRunSnapshot(
      plan,
      createTeam(),
      core.instant("2026-08-04T01:00:01.000Z"),
    );
    const started = core.transitionTeamRun(accepted, {
      type: "start-run",
      occurredAt: core.instant("2026-08-04T01:00:02.000Z"),
    });

    expect(started).toMatchObject({
      revision: 2,
      status: "running",
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    expect(
      started.nodes
        .filter(({ status }) => status === "ready")
        .map(({ candidateKey }) => candidateKey),
    ).toEqual(["checks", "research"]);
    expect(
      started.nodes
        .filter(({ status }) => status === "pending")
        .map(({ candidateKey }) => candidateKey),
    ).toEqual(["implementation", "feedback", "aggregate"]);
    expect(accepted.status).toBe("accepted");
    expect(accepted.revision).toBe(1);
  });

  it("starts dependency-ready workers as bounded immutable attempts", () => {
    const started = startRun();
    const checks = started.nodes.find(({ candidateKey }) => candidateKey === "checks")!;
    const research = started.nodes.find(({ candidateKey }) => candidateKey === "research")!;
    const checksRunning = core.transitionTeamRun(started, {
      type: "start-node",
      nodeId: checks.nodeId,
      workerTaskId: core.taskId("task-team-worker-checks-1"),
      occurredAt: core.instant("2026-08-04T01:00:03.000Z"),
    });
    const bothRunning = core.transitionTeamRun(checksRunning, {
      type: "start-node",
      nodeId: research.nodeId,
      workerTaskId: core.taskId("task-team-worker-research-1"),
      occurredAt: core.instant("2026-08-04T01:00:04.000Z"),
    });

    expect(bothRunning.revision).toBe(4);
    expect(bothRunning.nodes.filter(({ status }) => status === "running")).toHaveLength(2);
    const runningChecks = bothRunning.nodes.find(({ candidateKey }) => candidateKey === "checks")!;
    expect(runningChecks.attempts).toEqual([
      {
        attemptId: expect.stringMatching(/^team-attempt-[a-f0-9]{64}-1$/u),
        attemptNumber: 1,
        workerTaskId: "task-team-worker-checks-1",
        status: "running",
        startedAt: "2026-08-04T01:00:03.000Z",
        updatedAt: "2026-08-04T01:00:03.000Z",
      },
    ]);
    expect(started.nodes.find(({ candidateKey }) => candidateKey === "checks")?.attempts).toEqual(
      [],
    );
  });

  it("requires the expected Artifact kind before opening dependent work", () => {
    const started = startRun();
    const research = started.nodes.find(({ candidateKey }) => candidateKey === "research")!;
    const workerTaskId = core.taskId("task-team-worker-research-1");
    const running = core.transitionTeamRun(started, {
      type: "start-node",
      nodeId: research.nodeId,
      workerTaskId,
      occurredAt: core.instant("2026-08-04T01:00:03.000Z"),
    });
    const runningResearch = running.nodes.find(({ candidateKey }) => candidateKey === "research")!;
    const attemptId = runningResearch.attempts[0]!.attemptId;

    expect(() =>
      core.transitionTeamRun(running, {
        type: "complete-node",
        nodeId: research.nodeId,
        attemptId,
        artifacts: [
          {
            artifactId: core.artifactId("artifact-team-research-wrong-kind"),
            taskId: workerTaskId,
            kind: "file",
          },
        ],
        summary: "The bounded research result is complete.",
        occurredAt: core.instant("2026-08-04T01:00:04.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-transition" }));

    const completed = core.transitionTeamRun(running, {
      type: "complete-node",
      nodeId: research.nodeId,
      attemptId,
      artifacts: [
        {
          artifactId: core.artifactId("artifact-team-research"),
          taskId: workerTaskId,
          kind: "document",
        },
      ],
      summary: "The bounded research result is complete.",
      occurredAt: core.instant("2026-08-04T01:00:04.000Z"),
    });

    expect(completed.nodes.find(({ candidateKey }) => candidateKey === "research")).toMatchObject({
      status: "completed",
      artifacts: [{ artifactId: "artifact-team-research", kind: "document" }],
      attempts: [{ attemptId, status: "completed" }],
    });
    expect(
      completed.nodes.find(({ candidateKey }) => candidateKey === "implementation")?.status,
    ).toBe("ready");
    expect(completed.nodes.find(({ candidateKey }) => candidateKey === "feedback")?.status).toBe(
      "pending",
    );
    expect(running.nodes.find(({ candidateKey }) => candidateKey === "research")?.status).toBe(
      "running",
    );
  });

  it("keeps workflow human feedback distinct from protected-operation approval", () => {
    const blocked = createFeedbackBlockedRun();
    const feedback = blocked.nodes.find(({ candidateKey }) => candidateKey === "feedback")!;

    expect(feedback).toMatchObject({
      kind: "human-feedback",
      status: "approval-blocked",
      blockedReason: "human-feedback",
      blockedExplanation: "Waiting for bounded workflow feedback.",
      protectedApproval: null,
      workflowFeedback: null,
    });
    expect(() =>
      core.transitionTeamRun(blocked, {
        type: "resolve-node-approval",
        nodeId: feedback.nodeId,
        approvalId: core.approvalId("approval-team-wrong-authority"),
        decision: "approved",
        decisionAuditRecordId: core.auditRecordId("audit-team-wrong-decision"),
        outcomeAuditRecordId: core.auditRecordId("audit-team-wrong-outcome"),
        occurredAt: core.instant("2026-08-04T01:00:09.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-transition" }));

    const approved = core.transitionTeamRun(blocked, {
      type: "resolve-human-feedback",
      nodeId: feedback.nodeId,
      decision: "approved",
      note: "The bounded Team result is accepted.",
      occurredAt: core.instant("2026-08-04T01:00:09.000Z"),
    });

    expect(approved.nodes.find(({ candidateKey }) => candidateKey === "feedback")).toMatchObject({
      status: "completed",
      blockedReason: null,
      protectedApproval: null,
      workflowFeedback: {
        decision: "approved",
        note: "The bounded Team result is accepted.",
        resolvedAt: "2026-08-04T01:00:09.000Z",
      },
    });
    expect(approved.nodes.find(({ candidateKey }) => candidateKey === "aggregate")?.status).toBe(
      "ready",
    );
  });

  it("resumes a protected operation only from persisted policy, Approval, and audit references", () => {
    const started = startRun();
    const checks = started.nodes.find(({ candidateKey }) => candidateKey === "checks")!;
    const running = core.transitionTeamRun(started, {
      type: "start-node",
      nodeId: checks.nodeId,
      workerTaskId: core.taskId("task-team-worker-protected-approval"),
      occurredAt: core.instant("2026-08-04T01:00:03.000Z"),
    });
    const attempt = running.nodes.find(({ nodeId }) => nodeId === checks.nodeId)!.attempts.at(-1)!;
    const approvalId = core.approvalId("approval-team-protected-operation");
    const blocked = core.transitionTeamRun(running, {
      type: "block-node",
      nodeId: checks.nodeId,
      attemptId: attempt.attemptId,
      approvalId,
      policyAuditRecordId: core.auditRecordId("audit-team-protected-policy"),
      requestAuditRecordId: core.auditRecordId("audit-team-protected-request"),
      reason: "Waiting for the protected operation decision.",
      occurredAt: core.instant("2026-08-04T01:00:04.000Z"),
    });

    expect(blocked.nodes.find(({ nodeId }) => nodeId === checks.nodeId)).toMatchObject({
      status: "approval-blocked",
      blockedReason: "protected-approval",
      blockedExplanation: "Waiting for the protected operation decision.",
      attempts: [{ attemptId: attempt.attemptId, status: "blocked" }],
      protectedApproval: {
        approvalId,
        policyAuditRecordId: "audit-team-protected-policy",
        requestAuditRecordId: "audit-team-protected-request",
        decision: null,
        decisionAuditRecordId: null,
        outcomeAuditRecordId: null,
      },
      workflowFeedback: null,
    });
    expect(() =>
      core.transitionTeamRun(blocked, {
        type: "resolve-human-feedback",
        nodeId: checks.nodeId,
        decision: "approved",
        note: "This must not satisfy protected approval.",
        occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-transition" }));
    expect(() =>
      core.transitionTeamRun(blocked, {
        type: "resolve-node-approval",
        nodeId: checks.nodeId,
        approvalId,
        decision: "approved",
        occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-transition" }));

    const decisionRecorded = core.transitionTeamRun(blocked, {
      type: "request-node-approval-decision",
      nodeId: checks.nodeId,
      approvalId,
      decision: "approved",
      decisionAuditRecordId: core.auditRecordId("audit-team-protected-decision"),
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });

    expect(decisionRecorded.nodes.find(({ nodeId }) => nodeId === checks.nodeId)).toMatchObject({
      status: "approval-blocked",
      blockedReason: "protected-approval",
      attempts: [{ attemptId: attempt.attemptId, status: "blocked" }],
      protectedApproval: {
        approvalId,
        decision: "approved",
        decisionAuditRecordId: "audit-team-protected-decision",
        outcomeAuditRecordId: null,
      },
    });

    const approved = core.transitionTeamRun(decisionRecorded, {
      type: "resolve-node-approval",
      nodeId: checks.nodeId,
      approvalId,
      outcomeAuditRecordId: core.auditRecordId("audit-team-protected-outcome"),
      occurredAt: core.instant("2026-08-04T01:00:06.000Z"),
    });

    expect(approved.nodes.find(({ nodeId }) => nodeId === checks.nodeId)).toMatchObject({
      status: "running",
      blockedReason: null,
      attempts: [{ attemptId: attempt.attemptId, status: "running" }],
      protectedApproval: {
        approvalId,
        decision: "approved",
        decisionAuditRecordId: "audit-team-protected-decision",
        outcomeAuditRecordId: "audit-team-protected-outcome",
      },
    });
  });

  it("pauses and resumes only the active immutable Worker attempt", () => {
    const started = startRun();
    const checks = started.nodes.find(({ candidateKey }) => candidateKey === "checks")!;
    const running = core.transitionTeamRun(started, {
      type: "start-node",
      nodeId: checks.nodeId,
      workerTaskId: core.taskId("task-team-worker-pause"),
      occurredAt: core.instant("2026-08-04T01:00:03.000Z"),
    });
    const paused = core.transitionTeamRun(running, {
      type: "pause-node",
      nodeId: checks.nodeId,
      reason: "The user paused this bounded slot.",
      occurredAt: core.instant("2026-08-04T01:00:04.000Z"),
    });

    expect(paused.nodes.find(({ nodeId }) => nodeId === checks.nodeId)).toMatchObject({
      status: "paused",
      blockedReason: "paused",
      blockedExplanation: "The user paused this bounded slot.",
      attempts: [{ status: "paused" }],
    });
    const resumed = core.transitionTeamRun(paused, {
      type: "resume-node",
      nodeId: checks.nodeId,
      reason: "The user resumed this bounded slot.",
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });
    expect(resumed.nodes.find(({ nodeId }) => nodeId === checks.nodeId)).toMatchObject({
      status: "running",
      blockedReason: null,
      blockedExplanation: null,
      attempts: [{ status: "running" }],
    });
    expect(running.nodes.find(({ nodeId }) => nodeId === checks.nodeId)?.status).toBe("running");
  });

  it("retries a failed node with a new attempt identity inside both budgets", () => {
    let snapshot = startRun();
    snapshot = completeWorker(
      snapshot,
      "research",
      "research-retry",
      "2026-08-04T01:00:03.000Z",
      "2026-08-04T01:00:04.000Z",
    );
    const implementation = snapshot.nodes.find(
      ({ candidateKey }) => candidateKey === "implementation",
    )!;
    const firstRunning = core.transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: implementation.nodeId,
      workerTaskId: core.taskId("task-team-worker-retry-1"),
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });
    const firstAttempt = firstRunning.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)!
      .attempts[0]!;
    const failed = core.transitionTeamRun(firstRunning, {
      type: "fail-node",
      nodeId: implementation.nodeId,
      attemptId: firstAttempt.attemptId,
      incidentCode: "focused-test-failed",
      occurredAt: core.instant("2026-08-04T01:00:06.000Z"),
    });
    expect(failed.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)).toMatchObject({
      status: "failed",
      blockedReason: "attempt-failed",
      attempts: [{ status: "failed", incidentCode: "focused-test-failed" }],
    });

    const ready = core.transitionTeamRun(failed, {
      type: "retry-node",
      nodeId: implementation.nodeId,
      reason: "Retry after reviewing the bounded failure.",
      occurredAt: core.instant("2026-08-04T01:00:07.000Z"),
    });
    const secondRunning = core.transitionTeamRun(ready, {
      type: "start-node",
      nodeId: implementation.nodeId,
      workerTaskId: core.taskId("task-team-worker-retry-2"),
      occurredAt: core.instant("2026-08-04T01:00:08.000Z"),
    });
    const attempts = secondRunning.nodes.find(
      ({ nodeId }) => nodeId === implementation.nodeId,
    )!.attempts;
    expect(attempts).toMatchObject([
      { attemptNumber: 1, attemptId: firstAttempt.attemptId, status: "failed" },
      { attemptNumber: 2, status: "running", workerTaskId: "task-team-worker-retry-2" },
    ]);
    expect(attempts[1]!.attemptId).not.toBe(firstAttempt.attemptId);

    const exhausted = core.transitionTeamRun(secondRunning, {
      type: "fail-node",
      nodeId: implementation.nodeId,
      attemptId: attempts[1]!.attemptId,
      incidentCode: "second-focused-test-failed",
      occurredAt: core.instant("2026-08-04T01:00:09.000Z"),
    });
    expect(() =>
      core.transitionTeamRun(exhausted, {
        type: "retry-node",
        nodeId: implementation.nodeId,
        reason: "A third attempt exceeds the admitted node budget.",
        occurredAt: core.instant("2026-08-04T01:00:10.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "attempt-limit" }));
  });

  it("cancels one active node and replays its bounded retry transition", () => {
    let snapshot = startRun();
    snapshot = completeWorker(
      snapshot,
      "research",
      "research-child-cancel",
      "2026-08-04T01:00:03.000Z",
      "2026-08-04T01:00:04.000Z",
    );
    const implementation = snapshot.nodes.find(
      ({ candidateKey }) => candidateKey === "implementation",
    )!;
    const running = core.transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: implementation.nodeId,
      workerTaskId: core.taskId("task-team-worker-child-cancel-1"),
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });
    const cancelled = core.transitionTeamRun(running, {
      type: "cancel-node",
      nodeId: implementation.nodeId,
      reason: "Cancel only this bounded coding node.",
      occurredAt: core.instant("2026-08-04T01:00:06.000Z"),
    });

    expect(cancelled.status).toBe("running");
    expect(cancelled.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)).toMatchObject({
      status: "cancelled",
      blockedReason: "cancelled",
      blockedExplanation: "Cancel only this bounded coding node.",
      attempts: [{ status: "cancelled" }],
    });
    expect(() => core.assertTeamRunRevisionTransition(running, cancelled)).not.toThrow();

    const ready = core.transitionTeamRun(cancelled, {
      type: "retry-node",
      nodeId: implementation.nodeId,
      reason: "Retry the explicitly cancelled coding node.",
      occurredAt: core.instant("2026-08-04T01:00:07.000Z"),
    });
    expect(ready.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)).toMatchObject({
      status: "ready",
      blockedReason: null,
      attempts: [{ status: "cancelled" }],
    });
    expect(() => core.assertTeamRunRevisionTransition(cancelled, ready)).not.toThrow();

    const restarted = core.transitionTeamRun(ready, {
      type: "start-node",
      nodeId: implementation.nodeId,
      workerTaskId: core.taskId("task-team-worker-child-cancel-2"),
      occurredAt: core.instant("2026-08-04T01:00:08.000Z"),
    });
    expect(
      restarted.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)?.attempts,
    ).toMatchObject([
      { attemptNumber: 1, status: "cancelled" },
      { attemptNumber: 2, status: "running" },
    ]);
  });

  it("replaces an active Worker and supports a bounded manual handoff", () => {
    let snapshot = startRun();
    snapshot = completeWorker(
      snapshot,
      "research",
      "research-replace",
      "2026-08-04T01:00:03.000Z",
      "2026-08-04T01:00:04.000Z",
    );
    const implementation = snapshot.nodes.find(
      ({ candidateKey }) => candidateKey === "implementation",
    )!;
    const running = core.transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: implementation.nodeId,
      workerTaskId: core.taskId("task-team-worker-replaced"),
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });
    const replaced = core.transitionTeamRun(running, {
      type: "replace-node",
      nodeId: implementation.nodeId,
      reason: "Replace the bounded Worker after a recoverable stall.",
      occurredAt: core.instant("2026-08-04T01:00:06.000Z"),
    });
    expect(replaced.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)).toMatchObject({
      status: "ready",
      attempts: [{ status: "replaced" }],
    });
    const replacementRunning = core.transitionTeamRun(replaced, {
      type: "start-node",
      nodeId: implementation.nodeId,
      workerTaskId: core.taskId("task-team-worker-replacement"),
      occurredAt: core.instant("2026-08-04T01:00:07.000Z"),
    });
    const handoffRequired = core.transitionTeamRun(replacementRunning, {
      type: "request-handoff",
      nodeId: implementation.nodeId,
      reason: "Manual review must finish this bounded node.",
      occurredAt: core.instant("2026-08-04T01:00:08.000Z"),
    });
    expect(
      handoffRequired.nodes.find(({ nodeId }) => nodeId === implementation.nodeId),
    ).toMatchObject({
      status: "handoff-required",
      blockedReason: "handoff",
      blockedExplanation: "Manual review must finish this bounded node.",
      attempts: [{ status: "replaced" }, { status: "handed-off" }],
    });

    const completed = core.transitionTeamRun(handoffRequired, {
      type: "complete-handoff",
      nodeId: implementation.nodeId,
      artifacts: [
        {
          artifactId: core.artifactId("artifact-team-manual-handoff"),
          taskId: implementation.taskId,
          kind: "file",
        },
      ],
      summary: "The user supplied the reviewed handoff Artifact.",
      occurredAt: core.instant("2026-08-04T01:00:09.000Z"),
    });
    expect(completed.nodes.find(({ nodeId }) => nodeId === implementation.nodeId)).toMatchObject({
      status: "completed",
      blockedReason: null,
      artifacts: [{ artifactId: "artifact-team-manual-handoff", taskId: implementation.taskId }],
    });
  });

  it("cancels the whole Team without changing completed evidence", () => {
    let snapshot = startRun();
    snapshot = completeWorker(
      snapshot,
      "research",
      "research-cancel",
      "2026-08-04T01:00:03.000Z",
      "2026-08-04T01:00:04.000Z",
    );
    const checks = snapshot.nodes.find(({ candidateKey }) => candidateKey === "checks")!;
    const running = core.transitionTeamRun(snapshot, {
      type: "start-node",
      nodeId: checks.nodeId,
      workerTaskId: core.taskId("task-team-worker-cancel"),
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });
    const cancelled = core.transitionTeamRun(running, {
      type: "cancel-run",
      reason: "The user cancelled the complete Team run.",
      occurredAt: core.instant("2026-08-04T01:00:06.000Z"),
    });

    expect(cancelled).toMatchObject({
      status: "cancelled",
      statusExplanation: "The user cancelled the complete Team run.",
    });
    expect(cancelled.nodes.find(({ candidateKey }) => candidateKey === "research")?.status).toBe(
      "completed",
    );
    expect(cancelled.nodes.find(({ candidateKey }) => candidateKey === "checks")).toMatchObject({
      status: "cancelled",
      attempts: [{ status: "cancelled" }],
    });
    expect(cancelled.nodes.filter(({ status }) => status === "cancelled")).toHaveLength(4);
    expect(running.status).toBe("running");
  });

  it("recovers interrupted Worker attempts deterministically without relaunching them", () => {
    const started = startRun();
    const checks = started.nodes.find(({ candidateKey }) => candidateKey === "checks")!;
    const research = started.nodes.find(({ candidateKey }) => candidateKey === "research")!;
    let active = core.transitionTeamRun(started, {
      type: "start-node",
      nodeId: checks.nodeId,
      workerTaskId: core.taskId("task-team-worker-recover-checks"),
      occurredAt: core.instant("2026-08-04T01:00:03.000Z"),
    });
    active = core.transitionTeamRun(active, {
      type: "start-node",
      nodeId: research.nodeId,
      workerTaskId: core.taskId("task-team-worker-recover-research"),
      occurredAt: core.instant("2026-08-04T01:00:04.000Z"),
    });
    active = core.transitionTeamRun(active, {
      type: "pause-node",
      nodeId: research.nodeId,
      reason: "Paused when the desktop stopped.",
      occurredAt: core.instant("2026-08-04T01:00:05.000Z"),
    });

    const recovered = core.recoverTeamRunSnapshot(active, core.instant("2026-08-04T01:01:00.000Z"));
    expect(recovered.revision).toBe(active.revision + 1);
    expect(recovered.status).toBe("blocked");
    expect(
      recovered.nodes
        .filter(({ candidateKey }) => candidateKey === "checks" || candidateKey === "research")
        .map(({ status, blockedReason, attempts }) => ({
          status,
          blockedReason,
          attemptStatus: attempts.at(-1)?.status,
          incidentCode: attempts.at(-1)?.incidentCode,
        })),
    ).toEqual([
      {
        status: "failed",
        blockedReason: "interrupted",
        attemptStatus: "interrupted",
        incidentCode: "interrupted",
      },
      {
        status: "failed",
        blockedReason: "interrupted",
        attemptStatus: "interrupted",
        incidentCode: "interrupted",
      },
    ]);
    expect(
      core.recoverTeamRunSnapshot(recovered, core.instant("2026-08-04T01:02:00.000Z")),
    ).toEqual(recovered);
  });

  it("completes the run only after reference-only result aggregation", () => {
    let snapshot = createFeedbackBlockedRun();
    const feedback = snapshot.nodes.find(({ candidateKey }) => candidateKey === "feedback")!;
    snapshot = core.transitionTeamRun(snapshot, {
      type: "resolve-human-feedback",
      nodeId: feedback.nodeId,
      decision: "approved",
      note: "The bounded Team result is accepted.",
      occurredAt: core.instant("2026-08-04T01:00:09.000Z"),
    });
    snapshot = completeWorker(
      snapshot,
      "aggregate",
      "aggregate-result",
      "2026-08-04T01:00:10.000Z",
      "2026-08-04T01:00:11.000Z",
    );
    expect(snapshot.status).toBe("blocked");
    expect(snapshot.result).toBeNull();
    const references = snapshot.nodes.flatMap(({ artifacts }) => artifacts);
    expect(() =>
      core.transitionTeamRun(snapshot, {
        type: "complete-aggregation",
        result: {
          summary: "A substituted result must not enter Team authority.",
          artifacts: [
            {
              artifactId: core.artifactId("artifact-team-substituted"),
              taskId: core.taskId("task-team-substituted"),
              kind: "document",
            },
          ],
        },
        occurredAt: core.instant("2026-08-04T01:00:12.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "invalid-transition" }));

    const completed = core.transitionTeamRun(snapshot, {
      type: "complete-aggregation",
      result: {
        summary: "The final Team result references every completed Worker Artifact.",
        artifacts: references,
      },
      occurredAt: core.instant("2026-08-04T01:00:12.000Z"),
    });
    expect(completed).toMatchObject({
      status: "completed",
      statusExplanation: null,
      result: {
        summary: "The final Team result references every completed Worker Artifact.",
        artifacts: references,
      },
    });
    expect(snapshot.result).toBeNull();
  });
});
