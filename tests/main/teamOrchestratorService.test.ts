import { describe, expect, it, vi } from "vitest";
import {
  approvalId,
  artifactId,
  auditRecordId,
  instant,
  normalizeTeamDefinition,
  normalizeTeamRunSnapshot,
  teamPlanId,
  teamRunId,
  taskId,
  type AdmittedTeamPlan,
  type Instant,
  type TeamDefinition,
  type TeamId,
  type TeamAttemptId,
  type TeamPlanId,
  type TeamRunId,
  type TeamRunSnapshot,
} from "../../apps/desktop/src/core";
import {
  TeamOrchestratorService,
  type TeamOrchestratorPersistencePort,
  type TeamResultAggregationPort,
  type TeamWorkerExecutionInput,
  type TeamWorkerExecutionObserver,
  type TeamWorkerExecutionPort,
  type TeamWorkerExecutionResult,
  type TeamWorkerTaskIdentityInput,
} from "../../apps/desktop/src/main/orchestration/teamOrchestratorService";
import type {
  TeamPlannerAggregatePayload,
  TeamPlannerAggregateResult,
} from "../../apps/desktop/src/shared/teamPlannerSidecarProtocol";
import { createTeamRunFixture } from "../fixtures/teamRun";

type LogEntry =
  | { readonly type: "persist-team"; readonly teamId: TeamId }
  | { readonly type: "persist-run"; readonly runId: TeamRunId; readonly revision: number }
  | { readonly type: "execute"; readonly candidateKey: string; readonly revision: number }
  | { readonly type: "aggregate"; readonly revision: number }
  | { readonly type: "pause-worker"; readonly attemptId: TeamAttemptId }
  | { readonly type: "resume-worker"; readonly attemptId: TeamAttemptId }
  | { readonly type: "prepare-approval"; readonly attemptId: TeamAttemptId }
  | { readonly type: "commit-approval"; readonly attemptId: TeamAttemptId }
  | { readonly type: "release-approval"; readonly attemptId: TeamAttemptId }
  | { readonly type: "cancel-worker"; readonly attemptId: TeamAttemptId };

class MemoryTeamOrchestratorPersistence implements TeamOrchestratorPersistencePort {
  readonly teams = new Map<TeamId, TeamDefinition>();
  readonly runs = new Map<TeamRunId, TeamRunSnapshot>();
  readonly plans = new Map<TeamPlanId, AdmittedTeamPlan>();

  constructor(
    plan: AdmittedTeamPlan,
    private readonly log: LogEntry[],
  ) {
    this.plans.set(plan.planId, plan);
  }

  async persistTeamDefinition(team: TeamDefinition) {
    this.log.push({ type: "persist-team", teamId: team.teamId });
    const existing = this.teams.get(team.teamId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(team)) {
      throw new Error("conflicting Team fixture");
    }
    this.teams.set(team.teamId, team);
    return { status: existing === undefined ? ("stored" as const) : ("duplicate" as const), team };
  }

  async getTeamDefinition(teamId: TeamId) {
    return this.teams.get(teamId) ?? null;
  }

  async listTeamDefinitions(limit: number) {
    return [...this.teams.values()].slice(0, limit);
  }

  async persistTeamRunSnapshot(snapshotValue: TeamRunSnapshot) {
    const snapshot = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
    const existing = this.runs.get(snapshot.runId);
    if (existing !== undefined && snapshot.revision < existing.revision) {
      throw new Error("stale Team run fixture");
    }
    this.log.push({ type: "persist-run", runId: snapshot.runId, revision: snapshot.revision });
    this.runs.set(snapshot.runId, snapshot);
    return {
      status:
        existing !== undefined && existing.revision === snapshot.revision
          ? ("duplicate" as const)
          : ("stored" as const),
      snapshot,
    };
  }

  async getTeamRunSnapshot(runId: TeamRunId) {
    return this.runs.get(runId) ?? null;
  }

  async listRecoverableTeamRuns(limit: number) {
    return [...this.runs.values()]
      .filter(({ status }) => status !== "completed" && status !== "cancelled")
      .slice(0, limit);
  }

  async getAdmittedTeamPlan(planId: TeamPlanId) {
    return this.plans.get(planId) ?? null;
  }

  logRevisions(runId: TeamRunId): number[] {
    return this.log.flatMap((entry) =>
      entry.type === "persist-run" && entry.runId === runId ? [entry.revision] : [],
    );
  }
}

interface PendingWorker {
  readonly input: TeamWorkerExecutionInput;
  readonly signal: AbortSignal;
  readonly observer?: TeamWorkerExecutionObserver;
  readonly resolve: (result: TeamWorkerExecutionResult) => void;
  readonly reject: (error: Error) => void;
}

class ControlledWorker implements TeamWorkerExecutionPort {
  readonly pending = new Map<string, PendingWorker>();
  failCancellation = false;
  readonly taskIdFor = vi.fn((input: TeamWorkerTaskIdentityInput) =>
    taskId(
      `task-team-worker-${input.nodeId.slice("team-node-".length)}-${String(input.attemptNumber)}`,
    ),
  );
  readonly execute = vi.fn(
    (
      input: TeamWorkerExecutionInput,
      signal: AbortSignal,
      observer?: TeamWorkerExecutionObserver,
    ) => {
      this.log.push({
        type: "execute",
        candidateKey: input.candidateKey,
        revision: input.runRevision,
      });
      return new Promise<TeamWorkerExecutionResult>((resolve, reject) => {
        this.pending.set(input.candidateKey, { input, signal, observer, resolve, reject });
      });
    },
  );
  readonly prepareApprovalDecision = vi.fn(async (attemptId: TeamAttemptId) => {
    this.log.push({ type: "prepare-approval", attemptId });
    return Object.freeze({
      decisionAuditRecordId: auditRecordId("audit-team-orchestrator-decision"),
    });
  });
  readonly commitApprovalDecision = vi.fn(async (attemptId, _approvalId, _decision, persist) => {
    this.log.push({ type: "commit-approval", attemptId });
    await persist({
      outcomeAuditRecordId: auditRecordId("audit-team-orchestrator-outcome"),
    });
    this.log.push({ type: "release-approval", attemptId });
  });
  readonly pause = vi.fn(async (attemptId: TeamAttemptId) => {
    this.log.push({ type: "pause-worker", attemptId });
  });
  readonly resume = vi.fn(async (attemptId: TeamAttemptId) => {
    this.log.push({ type: "resume-worker", attemptId });
  });
  readonly cancel = vi.fn(async (attemptId: TeamAttemptId) => {
    this.log.push({ type: "cancel-worker", attemptId });
    if (this.failCancellation) throw new Error("fixture cancellation failed");
  });

  constructor(private readonly log: LogEntry[]) {}

  async requireApproval(candidateKey: string): Promise<void> {
    const pending = this.pending.get(candidateKey);
    if (pending?.observer === undefined) {
      throw new Error(`Missing Approval observer for Worker ${candidateKey}`);
    }
    await pending.observer.approvalRequired({
      runId: pending.input.runId,
      nodeId: pending.input.nodeId,
      attemptId: pending.input.attemptId,
      approvalId: approvalId("approval-team-orchestrator-protected"),
      policyAuditRecordId: auditRecordId("audit-team-orchestrator-policy"),
      requestAuditRecordId: auditRecordId("audit-team-orchestrator-request"),
      reason: "Waiting for the protected operation decision.",
    });
  }

  complete(candidateKey: string): void {
    const pending = this.pending.get(candidateKey);
    if (pending === undefined) throw new Error(`Missing pending Worker ${candidateKey}`);
    this.pending.delete(candidateKey);
    pending.resolve({
      status: "completed",
      summary: `${candidateKey} completed its bounded work.`,
      artifacts: [
        {
          artifactId: artifactId(`artifact-team-${candidateKey}`),
          taskId: pending.input.workerTaskId,
          kind: pending.input.expectedArtifactKind,
        },
      ],
    });
  }

  fail(candidateKey: string, incidentCode = "bounded-worker-failed"): void {
    const pending = this.pending.get(candidateKey);
    if (pending === undefined) throw new Error(`Missing pending Worker ${candidateKey}`);
    this.pending.delete(candidateKey);
    pending.resolve({ status: "failed", incidentCode });
  }

  reject(candidateKey: string, error: Error): void {
    const pending = this.pending.get(candidateKey);
    if (pending === undefined) throw new Error(`Missing pending Worker ${candidateKey}`);
    this.pending.delete(candidateKey);
    pending.reject(error);
  }
}

class ReferenceOnlyAggregator implements TeamResultAggregationPort {
  readonly aggregate = vi.fn(
    async (input: TeamPlannerAggregatePayload): Promise<TeamPlannerAggregateResult> => {
      this.log.push({ type: "aggregate", revision: input.revision });
      return {
        summary: "The bounded Team Artifact references are complete.",
        artifacts: input.artifacts,
      };
    },
  );

  constructor(private readonly log: LogEntry[]) {}
}

function advancingClock(start = Date.parse("2026-08-04T02:00:00.000Z")): () => Instant {
  let milliseconds = start;
  return () => {
    milliseconds += 1_000;
    return instant(new Date(milliseconds).toISOString());
  };
}

async function setup(
  suffix: string,
  attemptOptions: Parameters<typeof createTeamRunFixture>[1] = {},
) {
  const fixture = await createTeamRunFixture(suffix, attemptOptions);
  const log: LogEntry[] = [];
  const persistence = new MemoryTeamOrchestratorPersistence(fixture.plan, log);
  const worker = new ControlledWorker(log);
  const aggregator = new ReferenceOnlyAggregator(log);
  const service = new TeamOrchestratorService({
    persistence,
    worker,
    aggregator,
    now: advancingClock(),
  });
  const accepted = await service.create({
    team: normalizeTeamDefinition(JSON.parse(JSON.stringify(fixture.team))),
    planId: teamPlanId(fixture.plan.planId),
    occurredAt: instant("2026-08-04T01:30:00.000Z"),
  });
  return { ...fixture, accepted, log, persistence, worker, aggregator, service };
}

async function feedbackNode(service: TeamOrchestratorService, runId: TeamRunId) {
  const snapshot = await service.get(runId);
  return snapshot.nodes.find(({ candidateKey }) => candidateKey === "feedback")!;
}

describe("TeamOrchestratorService", () => {
  it("persists every run transition before launch", async () => {
    const { accepted, log, service, worker } = await setup("persist-before-launch");
    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));

    expect(worker.execute).toHaveBeenCalledTimes(2);
    const launchEntries = log
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.type === "execute");
    expect(launchEntries).toHaveLength(2);
    for (const { entry, index } of launchEntries) {
      if (entry.type !== "execute") throw new Error("Expected a Team Worker launch entry");
      expect(log.slice(0, index)).toContainEqual({
        type: "persist-run",
        runId: accepted.runId,
        revision: entry.revision,
      });
    }
    await service.close();
  });

  it("emits only persisted frozen snapshots and stops after unsubscribe", async () => {
    const { accepted, persistence, service, worker } = await setup("persist-before-emit");
    const observed: Array<{ readonly revision: number; readonly persisted: boolean }> = [];
    const unsubscribe = service.subscribe((snapshot) => {
      observed.push({
        revision: snapshot.revision,
        persisted: persistence.runs.get(snapshot.runId)?.revision === snapshot.revision,
      });
      expect(Object.isFrozen(snapshot)).toBe(true);
    });

    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));
    expect(observed.map(({ revision }) => revision)).toEqual([2, 3, 4]);
    expect(observed.every(({ persisted }) => persisted)).toBe(true);

    unsubscribe();
    const general = worker.pending.get("general")!.input;
    await service.pause({
      runId: accepted.runId,
      nodeId: general.nodeId,
      reason: "Pause after removing the subscriber.",
      occurredAt: instant("2026-08-04T02:10:00.000Z"),
    });
    expect(observed.map(({ revision }) => revision)).toEqual([2, 3, 4]);
    await service.close();
  });

  it("closes every active Worker and rejects later service use", async () => {
    const { accepted, service, worker } = await setup("close-active-workers");
    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));
    const active = [...worker.pending.values()];

    await service.close();

    expect(active).toHaveLength(2);
    expect(active.every(({ signal }) => signal.aborted)).toBe(true);
    for (const { input } of active) {
      expect(worker.cancel).toHaveBeenCalledWith(input.attemptId, "The Team orchestrator closed");
    }
    await expect(service.get(accepted.runId)).rejects.toMatchObject({
      name: "TeamOrchestratorServiceError",
      code: "closed",
    });
    expect(() => service.subscribe(() => undefined)).toThrow(
      expect.objectContaining({ code: "closed" }),
    );
  });

  it("reports close cancellation failures after attempting every active Worker", async () => {
    const { accepted, service, worker } = await setup("close-worker-failure");
    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));
    const active = [...worker.pending.values()];
    worker.failCancellation = true;

    await expect(service.close()).rejects.toMatchObject({
      name: "TeamOrchestratorServiceError",
      code: "worker-failed",
      cause: expect.any(AggregateError),
    });

    expect(active).toHaveLength(2);
    expect(active.every(({ signal }) => signal.aborted)).toBe(true);
    expect(worker.cancel).toHaveBeenCalledTimes(active.length);
    for (const { input } of active) {
      expect(worker.cancel).toHaveBeenCalledWith(input.attemptId, "The Team orchestrator closed");
    }
  });

  it("launches two dependency-free Workers in parallel within the admitted limit", async () => {
    const { accepted, plan, service, worker } = await setup("parallel");
    const started = await service.start(
      teamRunId(accepted.runId),
      instant("2026-08-04T01:31:00.000Z"),
    );

    expect(worker.execute).toHaveBeenCalledTimes(2);
    expect([...worker.pending.keys()].sort()).toEqual(["coding", "general"]);
    for (const { input } of worker.pending.values()) {
      expect(input).toMatchObject({ goal: plan.goal });
    }
    expect(started.nodes.filter(({ status }) => status === "running")).toHaveLength(2);
    expect(started.limits.maxConcurrency).toBe(2);
    await service.close();
  });

  it("forwards the admitted General requirements instead of replacing them with text-only defaults", async () => {
    const requirements = {
      contractVersion: 1,
      capabilities: ["workspace-read"],
      contextReferences: ["workspace-file"],
      inputRequirements: ["file-reference"],
      completionCriteria: "json-envelope",
    } as const;
    const { accepted, service, worker } = await setup("general-requirements", {
      generalRequirements: requirements,
    });

    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));

    expect(worker.pending.get("general")?.input.requirements).toEqual(requirements);
    expect(worker.pending.get("coding")?.input.requirements).toBeUndefined();
    await service.close();
  });

  it("keeps dependent feedback closed until both Worker Artifacts persist", async () => {
    const { accepted, service, worker } = await setup("dependency");
    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));

    worker.complete("general");
    await vi.waitFor(async () => {
      expect((await feedbackNode(service, accepted.runId)).status).toBe("pending");
    });
    worker.complete("coding");
    await vi.waitFor(async () => {
      expect(await feedbackNode(service, accepted.runId)).toMatchObject({
        status: "approval-blocked",
        blockedReason: "human-feedback",
      });
    });
    await service.close();
  });

  it("aggregates only persisted Artifact references after every node completes", async () => {
    const { accepted, aggregator, log, service, worker } = await setup("aggregation");
    await service.start(accepted.runId, instant("2026-08-04T01:31:00.000Z"));
    worker.complete("general");
    worker.complete("coding");
    await vi.waitFor(async () => {
      expect((await feedbackNode(service, accepted.runId)).status).toBe("approval-blocked");
    });

    const feedback = await feedbackNode(service, accepted.runId);
    await service.resolveFeedback({
      runId: accepted.runId,
      nodeId: feedback.nodeId,
      decision: "approved",
      note: "The bounded mixed result is accepted.",
      occurredAt: instant("2026-08-04T02:10:00.000Z"),
    });
    await service.waitForIdle(accepted.runId);

    expect(aggregator.aggregate).toHaveBeenCalledTimes(1);
    const aggregateInput = aggregator.aggregate.mock.calls[0]![0];
    expect(Object.keys(aggregateInput)).toEqual([
      "correlationId",
      "planId",
      "runId",
      "revision",
      "artifacts",
    ]);
    expect(JSON.stringify(aggregateInput)).not.toContain("bounded mixed result is accepted");
    const completed = await service.get(accepted.runId);
    expect(completed).toMatchObject({
      status: "completed",
      result: { summary: "The bounded Team Artifact references are complete." },
    });
    expect(completed.result?.artifacts).toEqual(aggregateInput.artifacts);
    const aggregationIndex = log.findIndex(({ type }) => type === "aggregate");
    expect(log.slice(0, aggregationIndex)).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: aggregateInput.revision,
    });
    await service.close();
  });

  it("persists protected approval and pause decisions before Worker control effects", async () => {
    const { accepted, log, service, worker } = await setup("approval-pause");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const general = worker.pending.get("general")!.input;

    await service.pause({
      runId: accepted.runId,
      nodeId: general.nodeId,
      reason: "The user paused the bounded General slot.",
      occurredAt: instant("2026-08-04T02:12:00.000Z"),
    });
    const pauseIndex = log.findIndex(({ type }) => type === "pause-worker");
    const paused = await service.get(accepted.runId);
    expect(log.slice(0, pauseIndex)).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: paused.revision,
    });
    expect(paused.nodes.find(({ nodeId }) => nodeId === general.nodeId)?.status).toBe("paused");

    await service.resume({
      runId: accepted.runId,
      nodeId: general.nodeId,
      reason: "The user resumed the bounded General slot.",
      occurredAt: instant("2026-08-04T02:13:00.000Z"),
    });
    const resumeIndex = log.findIndex(({ type }) => type === "resume-worker");
    const resumed = await service.get(accepted.runId);
    expect(log.slice(0, resumeIndex)).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: resumed.revision,
    });

    await worker.requireApproval("general");
    const blocked = await service.get(accepted.runId);
    expect(blocked.nodes.find(({ nodeId }) => nodeId === general.nodeId)).toMatchObject({
      status: "approval-blocked",
      protectedApproval: {
        approvalId: "approval-team-orchestrator-protected",
        policyAuditRecordId: "audit-team-orchestrator-policy",
        requestAuditRecordId: "audit-team-orchestrator-request",
      },
    });
    worker.resume.mockClear();
    const beforeDecisionLogLength = log.length;
    const approved = await service.decideApproval({
      runId: accepted.runId,
      nodeId: general.nodeId,
      approvalId: approvalId("approval-team-orchestrator-protected"),
      decision: "approved",
      occurredAt: instant("2026-08-04T02:15:00.000Z"),
    });
    expect(worker.prepareApprovalDecision).toHaveBeenCalledWith(
      general.attemptId,
      approvalId("approval-team-orchestrator-protected"),
      "approved",
    );
    expect(worker.commitApprovalDecision).toHaveBeenCalledWith(
      general.attemptId,
      approvalId("approval-team-orchestrator-protected"),
      "approved",
      expect.any(Function),
    );
    expect(worker.resume).not.toHaveBeenCalled();
    const decisionLog = log.slice(beforeDecisionLogLength);
    expect(decisionLog).toEqual([
      { type: "prepare-approval", attemptId: general.attemptId },
      {
        type: "persist-run",
        runId: accepted.runId,
        revision: approved.revision - 1,
      },
      { type: "commit-approval", attemptId: general.attemptId },
      {
        type: "persist-run",
        runId: accepted.runId,
        revision: approved.revision,
      },
      { type: "release-approval", attemptId: general.attemptId },
    ]);
    expect(approved.nodes.find(({ nodeId }) => nodeId === general.nodeId)).toMatchObject({
      status: "running",
      protectedApproval: {
        decision: "approved",
        decisionAuditRecordId: "audit-team-orchestrator-decision",
        outcomeAuditRecordId: "audit-team-orchestrator-outcome",
      },
    });
    expect(log).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: blocked.revision,
    });
    await service.close();
  });

  it("persists a denied protected Approval outcome before cancelling its Worker", async () => {
    const { accepted, aggregator, log, service, worker } = await setup("approval-denied");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const general = worker.pending.get("general")!.input;
    const generalExecution = worker.pending.get("general")!;

    await worker.requireApproval("general");
    const blocked = await service.get(accepted.runId);
    expect(blocked.nodes.find(({ nodeId }) => nodeId === general.nodeId)).toMatchObject({
      status: "approval-blocked",
      protectedApproval: {
        approvalId: "approval-team-orchestrator-protected",
        decision: null,
        decisionAuditRecordId: null,
        outcomeAuditRecordId: null,
      },
    });

    const beforeDecisionLogLength = log.length;
    const denied = await service.decideApproval({
      runId: accepted.runId,
      nodeId: general.nodeId,
      approvalId: approvalId("approval-team-orchestrator-protected"),
      decision: "denied",
      occurredAt: instant("2026-08-04T02:15:00.000Z"),
    });

    expect(denied.nodes.find(({ nodeId }) => nodeId === general.nodeId)).toMatchObject({
      status: "failed",
      blockedReason: "attempt-failed",
      blockedExplanation: "The protected operation was denied.",
      attempts: [expect.objectContaining({ attemptId: general.attemptId, status: "failed" })],
      protectedApproval: {
        approvalId: "approval-team-orchestrator-protected",
        decision: "denied",
        decisionAuditRecordId: "audit-team-orchestrator-decision",
        outcomeAuditRecordId: "audit-team-orchestrator-outcome",
      },
    });
    expect(generalExecution.signal.aborted).toBe(true);
    expect(worker.prepareApprovalDecision).toHaveBeenCalledWith(
      general.attemptId,
      approvalId("approval-team-orchestrator-protected"),
      "denied",
    );
    expect(worker.commitApprovalDecision).toHaveBeenCalledWith(
      general.attemptId,
      approvalId("approval-team-orchestrator-protected"),
      "denied",
      expect.any(Function),
    );
    expect(worker.cancel).toHaveBeenCalledWith(
      general.attemptId,
      "The protected operation was denied",
    );
    expect(worker.execute).toHaveBeenCalledTimes(2);
    expect(aggregator.aggregate).not.toHaveBeenCalled();

    const decisionLog = log.slice(beforeDecisionLogLength);
    const cancelIndex = decisionLog.findIndex(({ type }) => type === "cancel-worker");
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(decisionLog.slice(0, cancelIndex)).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: denied.revision,
    });
    expect(decisionLog.slice(0, cancelIndex)).toEqual([
      { type: "prepare-approval", attemptId: general.attemptId },
      {
        type: "persist-run",
        runId: accepted.runId,
        revision: denied.revision - 1,
      },
      { type: "commit-approval", attemptId: general.attemptId },
      {
        type: "persist-run",
        runId: accepted.runId,
        revision: denied.revision,
      },
      { type: "release-approval", attemptId: general.attemptId },
    ]);

    await service.close();
  });

  it("retries a failed Worker with a new deterministic attempt", async () => {
    const { accepted, service, worker } = await setup("retry", {
      generalMaxAttempts: 2,
    });
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const first = worker.pending.get("general")!.input;
    worker.fail("general", "bounded-first-attempt-failed");
    await vi.waitFor(async () => {
      expect(
        (await service.get(accepted.runId)).nodes.find(({ nodeId }) => nodeId === first.nodeId)
          ?.status,
      ).toBe("failed");
    });

    const retried = await service.retry({
      runId: accepted.runId,
      nodeId: first.nodeId,
      reason: "Retry after reviewing the bounded failure.",
      occurredAt: instant("2026-08-04T02:20:00.000Z"),
    });
    const replacement = worker.pending.get("general")!.input;
    expect(replacement.attemptId).not.toBe(first.attemptId);
    expect(retried.nodes.find(({ nodeId }) => nodeId === first.nodeId)?.attempts).toHaveLength(2);
    await service.close();
  });

  it("reports the specific rejection cause instead of one generic Worker incident", async () => {
    const { accepted, service, worker } = await setup("rejection-cause");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const failing = worker.pending.get("coding")!.input;
    worker.reject(
      "coding",
      Object.assign(new Error("bounded prompt deadline elapsed"), {
        code: "worker-runtime-unavailable",
        cause: Object.assign(new Error("no ACP activity"), { code: "prompt-timeout" }),
      }),
    );

    await vi.waitFor(async () => {
      expect(
        (await service.get(accepted.runId)).nodes.find(({ nodeId }) => nodeId === failing.nodeId)
          ?.status,
      ).toBe("failed");
    });
    const node = (await service.get(accepted.runId)).nodes.find(
      ({ nodeId }) => nodeId === failing.nodeId,
    );
    expect(node?.attempts.at(-1)?.incidentCode).toBe("prompt-timeout");
    expect(node?.blockedExplanation).toContain("prompt-timeout");
    await service.close();
  });

  it("persists a model failure received while paused and refuses a stale resume without rewriting it", async () => {
    const { accepted, service, worker } = await setup("paused-model-failure");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const general = worker.pending.get("general")!.input;
    await service.pause({
      runId: accepted.runId,
      nodeId: general.nodeId,
      reason: "Pause while the General provider is running.",
      occurredAt: instant("2026-08-04T02:12:00.000Z"),
    });

    worker.reject(
      "general",
      Object.assign(new Error("The configured provider is temporarily unavailable"), {
        code: "model-unavailable",
      }),
    );
    await vi.waitFor(async () => {
      expect(
        (await service.get(accepted.runId)).nodes.find(({ nodeId }) => nodeId === general.nodeId)
          ?.status,
      ).toBe("failed");
    });
    const failed = await service.get(accepted.runId);
    const failedGeneral = failed.nodes.find(({ nodeId }) => nodeId === general.nodeId);
    expect(failedGeneral).toMatchObject({
      status: "failed",
      blockedReason: "attempt-failed",
    });
    expect(failedGeneral?.attempts.at(-1)).toMatchObject({
      status: "failed",
      incidentCode: "model-unavailable",
    });

    await expect(
      service.resume({
        runId: accepted.runId,
        nodeId: general.nodeId,
        reason: "Do not revive a terminal provider failure.",
        occurredAt: instant("2026-08-04T02:13:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "worker-failed" });
    const afterRejectedResume = await service.get(accepted.runId);
    expect(afterRejectedResume.revision).toBe(failed.revision);
    expect(
      afterRejectedResume.nodes.find(({ nodeId }) => nodeId === general.nodeId)?.attempts.at(-1),
    ).toMatchObject({
      status: "failed",
      incidentCode: "model-unavailable",
    });
    await service.close();
  });

  it("keeps a General admission refusal legible instead of collapsing it to worker-execution-failed", async () => {
    const { accepted, service, worker } = await setup("rejection-admission");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const failing = worker.pending.get("coding")!.input;
    // Spec D: a refusal raised before any model turn must still name the reason the user can act on.
    worker.reject(
      "coding",
      Object.assign(new Error("the supervised Team journey failed"), {
        code: "journey-failed",
        cause: Object.assign(new Error("General could not start"), {
          code: "general-input-required",
        }),
      }),
    );

    await vi.waitFor(async () => {
      expect(
        (await service.get(accepted.runId)).nodes.find(({ nodeId }) => nodeId === failing.nodeId)
          ?.status,
      ).toBe("failed");
    });
    const node = (await service.get(accepted.runId)).nodes.find(
      ({ nodeId }) => nodeId === failing.nodeId,
    );
    expect(node?.attempts.at(-1)?.incidentCode).toBe("general-input-required");
    expect(node?.attempts.at(-1)?.incidentCode).not.toBe("invalid-state");
    expect(node?.blockedExplanation).toContain("general-input-required");
    await service.close();
  });

  it("falls back to the generic incident when a rejection carries no admitted code", async () => {
    const { accepted, service, worker } = await setup("rejection-unknown");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const failing = worker.pending.get("coding")!.input;
    worker.reject("coding", new Error("/private/tmp/secret-path denied for provider-secret"));

    await vi.waitFor(async () => {
      expect(
        (await service.get(accepted.runId)).nodes.find(({ nodeId }) => nodeId === failing.nodeId)
          ?.status,
      ).toBe("failed");
    });
    const node = (await service.get(accepted.runId)).nodes.find(
      ({ nodeId }) => nodeId === failing.nodeId,
    );
    expect(node?.attempts.at(-1)?.incidentCode).toBe("worker-execution-failed");
    expect(node?.blockedExplanation).not.toContain("secret-path");
    await service.close();
  });

  it("persists replacement and handoff before cancelling the active Worker", async () => {
    const { accepted, log, service, worker } = await setup("replace-handoff", {
      codingMaxAttempts: 2,
    });
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const first = worker.pending.get("coding")!.input;
    const replaced = await service.replace({
      runId: accepted.runId,
      nodeId: first.nodeId,
      reason: "Replace the bounded coding Worker.",
      occurredAt: instant("2026-08-04T02:20:00.000Z"),
    });
    const firstCancelIndex = log.findIndex(
      (entry) => entry.type === "cancel-worker" && entry.attemptId === first.attemptId,
    );
    expect(log.slice(0, firstCancelIndex)).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: replaced.revision - 1,
    });
    const replacement = worker.pending.get("coding")!.input;
    expect(replacement.attemptId).not.toBe(first.attemptId);

    const handoff = await service.requestHandoff({
      runId: accepted.runId,
      nodeId: replacement.nodeId,
      reason: "Manual review must finish the bounded coding node.",
      occurredAt: instant("2026-08-04T02:21:00.000Z"),
    });
    expect(handoff.nodes.find(({ nodeId }) => nodeId === replacement.nodeId)).toMatchObject({
      status: "handoff-required",
      blockedReason: "handoff",
    });
    expect(worker.cancel).toHaveBeenCalledWith(
      replacement.attemptId,
      "Manual review must finish the bounded coding node.",
    );

    const completed = await service.completeHandoff({
      runId: accepted.runId,
      nodeId: replacement.nodeId,
      artifacts: [
        {
          artifactId: artifactId("artifact-team-manual-coding-handoff"),
          taskId: taskId(replacement.taskId),
          kind: replacement.expectedArtifactKind,
        },
      ],
      summary: "The reviewed manual coding handoff is complete.",
      occurredAt: instant("2026-08-04T02:22:00.000Z"),
    });
    expect(completed.nodes.find(({ nodeId }) => nodeId === replacement.nodeId)?.status).toBe(
      "completed",
    );
    await service.close();
  });

  it("cancels one child or the whole Team only after durable state changes", async () => {
    const { accepted, log, service, worker } = await setup("cancel");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const general = worker.pending.get("general")!.input;
    const coding = worker.pending.get("coding")!.input;
    const childCancelled = await service.cancelNode({
      runId: accepted.runId,
      nodeId: general.nodeId,
      reason: "Cancel only the bounded General child.",
      occurredAt: instant("2026-08-04T02:20:00.000Z"),
    });
    const childCancelIndex = log.findIndex(
      (entry) => entry.type === "cancel-worker" && entry.attemptId === general.attemptId,
    );
    expect(log.slice(0, childCancelIndex)).toContainEqual({
      type: "persist-run",
      runId: accepted.runId,
      revision: childCancelled.revision,
    });
    expect(childCancelled.nodes.find(({ nodeId }) => nodeId === general.nodeId)).toMatchObject({
      status: "cancelled",
      blockedReason: "cancelled",
    });
    expect(childCancelled.nodes.find(({ nodeId }) => nodeId === coding.nodeId)?.status).toBe(
      "running",
    );

    const wholeCancelled = await service.cancelRun({
      runId: accepted.runId,
      reason: "Cancel the complete bounded Team.",
      occurredAt: instant("2026-08-04T02:21:00.000Z"),
    });
    expect(wholeCancelled.status).toBe("cancelled");
    expect(worker.cancel).toHaveBeenCalledWith(
      coding.attemptId,
      "Cancel the complete bounded Team.",
    );
    await service.close();
  });

  it("serializes concurrent controls and rejects the stale second command", async () => {
    const { accepted, persistence, service, worker } = await setup("serialized-controls");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const general = worker.pending.get("general")!.input;
    const results = await Promise.allSettled([
      service.pause({
        runId: accepted.runId,
        nodeId: general.nodeId,
        reason: "First pause wins.",
        occurredAt: instant("2026-08-04T02:20:00.000Z"),
      }),
      service.pause({
        runId: accepted.runId,
        nodeId: general.nodeId,
        reason: "Second pause is stale.",
        occurredAt: instant("2026-08-04T02:20:01.000Z"),
      }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    const persistedRevisions = persistence.logRevisions(accepted.runId);
    expect(new Set(persistedRevisions).size).toBe(persistedRevisions.length);
    await service.close();
  });

  it("recovers running and paused attempts as interrupted without relaunch", async () => {
    const original = await setup("recovery");
    await original.service.start(original.accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    const general = original.worker.pending.get("general")!.input;
    await original.service.pause({
      runId: original.accepted.runId,
      nodeId: general.nodeId,
      reason: "Paused when the desktop stopped.",
      occurredAt: instant("2026-08-04T02:20:00.000Z"),
    });

    const recoveredWorker = new ControlledWorker(original.log);
    const recoveredService = new TeamOrchestratorService({
      persistence: original.persistence,
      worker: recoveredWorker,
      aggregator: original.aggregator,
      now: advancingClock(Date.parse("2026-08-04T03:00:00.000Z")),
    });
    const recovered = await recoveredService.recover(instant("2026-08-04T03:01:00.000Z"));
    expect(recovered).toHaveLength(1);
    expect(
      recovered[0]!.nodes
        .filter(({ candidateKey }) => candidateKey === "general" || candidateKey === "coding")
        .map(({ status, blockedReason, attempts }) => ({
          status,
          blockedReason,
          attemptStatus: attempts.at(-1)?.status,
        })),
    ).toEqual([
      { status: "failed", blockedReason: "interrupted", attemptStatus: "interrupted" },
      { status: "failed", blockedReason: "interrupted", attemptStatus: "interrupted" },
    ]);
    expect(recoveredWorker.execute).not.toHaveBeenCalled();
    await original.service.close();
    await recoveredService.close();
  });

  it("keeps a persisted whole-Team cancellation when cleanup reports failure", async () => {
    const { accepted, service, worker } = await setup("cleanup-failure");
    await service.start(accepted.runId, instant("2026-08-04T02:11:00.000Z"));
    worker.failCancellation = true;
    await expect(
      service.cancelRun({
        runId: accepted.runId,
        reason: "Cancel despite cleanup failure.",
        occurredAt: instant("2026-08-04T02:20:00.000Z"),
      }),
    ).rejects.toMatchObject({
      name: "TeamOrchestratorServiceError",
      code: "worker-failed",
    });
    expect((await service.get(accepted.runId)).status).toBe("cancelled");
    expect(worker.cancel).toHaveBeenCalledTimes(2);
    await service.close().catch(() => {});
  });
});
