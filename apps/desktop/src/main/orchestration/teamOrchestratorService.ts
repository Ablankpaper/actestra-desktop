import { createHash } from "node:crypto";
import {
  compareInstants,
  createTeamRunSnapshot,
  instant,
  normalizeAdmittedTeamPlan,
  normalizeTeamDefinition,
  normalizeTeamRunSnapshot,
  recoverTeamRunSnapshot,
  taskId,
  teamPlanId,
  teamRunId,
  transitionTeamRun,
  type AdmittedTeamPlan,
  type ApprovalId,
  type Instant,
  type TaskId,
  type TeamArtifactReference,
  type TeamAttemptId,
  type TeamDefinition,
  type TeamPlanId,
  type TeamPlanNodeId,
  type TeamRunPersistencePort,
  type TeamRunSnapshot,
  type TeamWorkerCapability,
  type WorkspaceId,
} from "../../core";
import type { AuditRecordId } from "../../core/privilegedServices";
import {
  normalizeTeamPlannerSidecarRequest,
  normalizeTeamPlannerSidecarResponse,
  type TeamPlannerAggregatePayload,
  type TeamPlannerAggregateResult,
} from "../../shared/teamPlannerSidecarProtocol";

export interface TeamOrchestratorPersistencePort extends TeamRunPersistencePort {
  getAdmittedTeamPlan(planId: TeamPlanId): Promise<AdmittedTeamPlan | null>;
}

export interface TeamWorkerExecutionInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly runRevision: number;
  readonly planId: TeamPlanId;
  readonly teamId: TeamDefinition["teamId"];
  readonly workspaceId: WorkspaceId;
  readonly nodeId: TeamPlanNodeId;
  readonly taskId: TaskId;
  readonly workerTaskId: TaskId;
  readonly attemptId: TeamAttemptId;
  readonly candidateKey: string;
  readonly title: string;
  readonly capability: TeamWorkerCapability;
  readonly completionCriteria: string;
  readonly expectedArtifactKind: TeamArtifactReference["kind"];
}

export type TeamWorkerExecutionResult =
  | {
      readonly status: "completed";
      readonly summary: string;
      readonly artifacts: readonly TeamArtifactReference[];
    }
  | {
      readonly status: "failed";
      readonly incidentCode: string;
    };

export interface TeamWorkerExecutionPort {
  execute(input: TeamWorkerExecutionInput, signal: AbortSignal): Promise<TeamWorkerExecutionResult>;
  pause(attemptId: TeamAttemptId, reason: string): Promise<void>;
  resume(attemptId: TeamAttemptId): Promise<void>;
  cancel(attemptId: TeamAttemptId, reason: string): Promise<void>;
}

export interface TeamResultAggregationPort {
  aggregate(
    input: TeamPlannerAggregatePayload,
    signal: AbortSignal,
  ): Promise<TeamPlannerAggregateResult>;
}

export type TeamRunSnapshotHandler = (snapshot: TeamRunSnapshot) => void;

export type TeamOrchestratorServiceErrorCode =
  | "invalid-request"
  | "not-found"
  | "persistence-failed"
  | "worker-failed"
  | "aggregation-failed"
  | "closed";

export class TeamOrchestratorServiceError extends Error {
  constructor(
    readonly code: TeamOrchestratorServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamOrchestratorServiceError";
  }
}

export interface TeamOrchestratorServiceOptions {
  readonly persistence: TeamOrchestratorPersistencePort;
  readonly worker: TeamWorkerExecutionPort;
  readonly aggregator: TeamResultAggregationPort;
  readonly now: () => Instant;
}

export interface CreateTeamRunInput {
  readonly team: TeamDefinition;
  readonly planId: TeamPlanId;
  readonly occurredAt: Instant;
}

export interface ResolveTeamFeedbackInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly nodeId: TeamPlanNodeId;
  readonly decision: "approved" | "denied";
  readonly note: string;
  readonly occurredAt: Instant;
}

export interface TeamNodeControlInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly nodeId: TeamPlanNodeId;
  readonly reason: string;
  readonly occurredAt: Instant;
}

export interface BlockTeamNodeForApprovalInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly nodeId: TeamPlanNodeId;
  readonly attemptId: TeamAttemptId;
  readonly approvalId: ApprovalId;
  readonly policyAuditRecordId: AuditRecordId;
  readonly requestAuditRecordId: AuditRecordId;
  readonly reason: string;
  readonly occurredAt: Instant;
}

export interface DecideTeamNodeApprovalInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly nodeId: TeamPlanNodeId;
  readonly approvalId: ApprovalId;
  readonly decision: "approved" | "denied";
  readonly decisionAuditRecordId: AuditRecordId;
  readonly outcomeAuditRecordId: AuditRecordId;
  readonly occurredAt: Instant;
}

export interface CompleteTeamHandoffInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly nodeId: TeamPlanNodeId;
  readonly artifacts: readonly TeamArtifactReference[];
  readonly summary: string;
  readonly occurredAt: Instant;
}

export interface CancelTeamRunInput {
  readonly runId: ReturnType<typeof teamRunId>;
  readonly reason: string;
  readonly occurredAt: Instant;
}

interface ActiveWorker {
  readonly input: TeamWorkerExecutionInput;
  readonly controller: AbortController;
}

function serviceError(
  code: TeamOrchestratorServiceErrorCode,
  message: string,
): TeamOrchestratorServiceError {
  return new TeamOrchestratorServiceError(code, message);
}

function snapshotsMatch(left: TeamRunSnapshot, right: TeamRunSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deterministicWorkerTaskId(
  runIdValue: ReturnType<typeof teamRunId>,
  nodeId: TeamPlanNodeId,
  attemptNumber: number,
): TaskId {
  const digest = createHash("sha256")
    .update(`${runIdValue}\u0000${nodeId}\u0000${String(attemptNumber)}`)
    .digest("hex");
  return taskId(`task-team-worker-${digest}`);
}

export class TeamOrchestratorService {
  readonly #persistence: TeamOrchestratorPersistencePort;
  readonly #worker: TeamWorkerExecutionPort;
  readonly #aggregator: TeamResultAggregationPort;
  readonly #now: () => Instant;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #activeWorkers = new Map<string, Map<TeamPlanNodeId, ActiveWorker>>();
  readonly #background = new Map<string, Set<Promise<void>>>();
  readonly #aggregationControllers = new Map<string, AbortController>();
  readonly #subscribers = new Set<TeamRunSnapshotHandler>();
  #closed = false;

  constructor(options: TeamOrchestratorServiceOptions) {
    if (typeof options.now !== "function") {
      throw serviceError("invalid-request", "Team orchestrator clock is required");
    }
    this.#persistence = options.persistence;
    this.#worker = options.worker;
    this.#aggregator = options.aggregator;
    this.#now = options.now;
    instant(this.#now());
  }

  async create(input: CreateTeamRunInput): Promise<TeamRunSnapshot> {
    this.#assertOpen();
    const team = normalizeTeamDefinition(JSON.parse(JSON.stringify(input.team)));
    const stablePlanId = teamPlanId(input.planId);
    const occurredAt = instant(input.occurredAt);
    const planValue = await this.#persistence.getAdmittedTeamPlan(stablePlanId);
    if (planValue === null) {
      throw serviceError("not-found", "The admitted Team plan was not found");
    }
    const plan = normalizeAdmittedTeamPlan(JSON.parse(JSON.stringify(planValue)));
    await this.#persistence.persistTeamDefinition(team);
    const snapshot = createTeamRunSnapshot(plan, team, occurredAt);
    return this.#persistSnapshot(snapshot);
  }

  async start(runIdValue: ReturnType<typeof teamRunId>, occurredAtValue: Instant) {
    const stableRunId = teamRunId(runIdValue);
    return this.#mutate(stableRunId, async () => {
      let snapshot = await this.#requireRun(stableRunId);
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "start-run",
          occurredAt: instant(occurredAtValue),
        }),
      );
      return this.#scheduleReadyWorkers(snapshot);
    });
  }

  async get(runIdValue: ReturnType<typeof teamRunId>): Promise<TeamRunSnapshot> {
    this.#assertOpen();
    return this.#requireRun(teamRunId(runIdValue));
  }

  subscribe(handler: TeamRunSnapshotHandler): () => void {
    this.#assertOpen();
    if (typeof handler !== "function") {
      throw serviceError("invalid-request", "Team run snapshot handler is required");
    }
    this.#subscribers.add(handler);
    return () => {
      this.#subscribers.delete(handler);
    };
  }

  async resolveFeedback(input: ResolveTeamFeedbackInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      let snapshot = await this.#requireRun(stableRunId);
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "resolve-human-feedback",
          nodeId: input.nodeId,
          decision: input.decision,
          note: input.note,
          occurredAt: instant(input.occurredAt),
        }),
      );
      snapshot = await this.#scheduleReadyWorkers(snapshot);
      return this.#aggregateIfReady(snapshot);
    });
  }

  async pause(input: TeamNodeControlInput): Promise<TeamRunSnapshot> {
    return this.#controlActiveWorker(input, "pause-node", async ({ input: workerInput }) => {
      await this.#worker.pause(workerInput.attemptId, input.reason);
    });
  }

  async resume(input: TeamNodeControlInput): Promise<TeamRunSnapshot> {
    return this.#controlActiveWorker(input, "resume-node", async ({ input: workerInput }) => {
      await this.#worker.resume(workerInput.attemptId);
    });
  }

  async blockForApproval(input: BlockTeamNodeForApprovalInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const active = this.#requireActiveWorker(stableRunId, input.nodeId);
      if (active.input.attemptId !== input.attemptId) {
        throw serviceError("invalid-request", "The Team approval block uses a stale attempt");
      }
      const snapshot = await this.#requireRun(stableRunId);
      return this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "block-node",
          nodeId: input.nodeId,
          attemptId: input.attemptId,
          approvalId: input.approvalId,
          policyAuditRecordId: input.policyAuditRecordId,
          requestAuditRecordId: input.requestAuditRecordId,
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
    });
  }

  async decideApproval(input: DecideTeamNodeApprovalInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const active = this.#requireActiveWorker(stableRunId, input.nodeId);
      let snapshot = await this.#requireRun(stableRunId);
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "resolve-node-approval",
          nodeId: input.nodeId,
          approvalId: input.approvalId,
          decision: input.decision,
          decisionAuditRecordId: input.decisionAuditRecordId,
          outcomeAuditRecordId: input.outcomeAuditRecordId,
          occurredAt: instant(input.occurredAt),
        }),
      );
      try {
        if (input.decision === "approved") {
          await this.#worker.resume(active.input.attemptId);
        } else {
          active.controller.abort();
          await this.#worker.cancel(active.input.attemptId, "The protected operation was denied");
          this.#activeWorkersFor(stableRunId).delete(input.nodeId);
        }
      } catch {
        throw serviceError("worker-failed", "The Team Worker approval control failed");
      }
      return snapshot;
    });
  }

  async retry(input: TeamNodeControlInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      let snapshot = await this.#requireRun(stableRunId);
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "retry-node",
          nodeId: input.nodeId,
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
      return this.#scheduleReadyWorkers(snapshot);
    });
  }

  async replace(input: TeamNodeControlInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const active = this.#requireActiveWorker(stableRunId, input.nodeId);
      let snapshot = await this.#requireRun(stableRunId);
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "replace-node",
          nodeId: input.nodeId,
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
      active.controller.abort();
      try {
        await this.#worker.cancel(active.input.attemptId, input.reason);
      } catch {
        throw serviceError("worker-failed", "The replaced Team Worker could not be cancelled");
      }
      this.#activeWorkersFor(stableRunId).delete(input.nodeId);
      return this.#scheduleReadyWorkers(snapshot);
    });
  }

  async requestHandoff(input: TeamNodeControlInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const active = this.#requireActiveWorker(stableRunId, input.nodeId);
      const snapshot = await this.#persistSnapshot(
        transitionTeamRun(await this.#requireRun(stableRunId), {
          type: "request-handoff",
          nodeId: input.nodeId,
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
      active.controller.abort();
      try {
        await this.#worker.cancel(active.input.attemptId, input.reason);
      } catch {
        throw serviceError("worker-failed", "The handed-off Team Worker could not be cancelled");
      }
      this.#activeWorkersFor(stableRunId).delete(input.nodeId);
      return snapshot;
    });
  }

  async completeHandoff(input: CompleteTeamHandoffInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      let snapshot = await this.#requireRun(stableRunId);
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "complete-handoff",
          nodeId: input.nodeId,
          artifacts: input.artifacts,
          summary: input.summary,
          occurredAt: instant(input.occurredAt),
        }),
      );
      snapshot = await this.#scheduleReadyWorkers(snapshot);
      return this.#aggregateIfReady(snapshot);
    });
  }

  async cancelNode(input: TeamNodeControlInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const active = this.#requireActiveWorker(stableRunId, input.nodeId);
      const snapshot = await this.#persistSnapshot(
        transitionTeamRun(await this.#requireRun(stableRunId), {
          type: "cancel-node",
          nodeId: input.nodeId,
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
      active.controller.abort();
      try {
        await this.#worker.cancel(active.input.attemptId, input.reason);
      } catch {
        throw serviceError("worker-failed", "The cancelled Team Worker cleanup failed");
      }
      this.#activeWorkersFor(stableRunId).delete(input.nodeId);
      return snapshot;
    });
  }

  async cancelRun(input: CancelTeamRunInput): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const snapshot = await this.#persistSnapshot(
        transitionTeamRun(await this.#requireRun(stableRunId), {
          type: "cancel-run",
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
      this.#aggregationControllers.get(stableRunId)?.abort();
      this.#aggregationControllers.delete(stableRunId);
      const workers = [...this.#activeWorkersFor(stableRunId).values()];
      for (const { controller } of workers) controller.abort();
      const cleanup = await Promise.allSettled(
        workers.map(({ input: workerInput }) =>
          this.#worker.cancel(workerInput.attemptId, input.reason),
        ),
      );
      this.#activeWorkersFor(stableRunId).clear();
      if (cleanup.some(({ status }) => status === "rejected")) {
        throw serviceError("worker-failed", "One or more Team Worker cleanups failed");
      }
      return snapshot;
    });
  }

  async recover(recoveredAtValue: Instant): Promise<readonly TeamRunSnapshot[]> {
    this.#assertOpen();
    const recoveredAt = instant(recoveredAtValue);
    const recoverable = await this.#persistence.listRecoverableTeamRuns(100);
    const recovered: TeamRunSnapshot[] = [];
    for (const snapshotValue of recoverable) {
      const snapshot = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
      const next = recoverTeamRunSnapshot(snapshot, recoveredAt);
      recovered.push(snapshotsMatch(snapshot, next) ? snapshot : await this.#persistSnapshot(next));
    }
    return Object.freeze(recovered);
  }

  async waitForIdle(runIdValue: ReturnType<typeof teamRunId>): Promise<void> {
    const stableRunId = teamRunId(runIdValue);
    for (;;) {
      const pending = [...(this.#background.get(stableRunId) ?? [])];
      const lock = this.#locks.get(stableRunId);
      if (pending.length === 0 && lock === undefined) return;
      await Promise.allSettled([...(lock === undefined ? [] : [lock]), ...pending]);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#subscribers.clear();
    for (const controller of this.#aggregationControllers.values()) controller.abort();
    this.#aggregationControllers.clear();
    const cancellations: Promise<void>[] = [];
    for (const workers of this.#activeWorkers.values()) {
      for (const { input, controller } of workers.values()) {
        controller.abort();
        cancellations.push(
          this.#worker.cancel(input.attemptId, "The Team orchestrator closed").catch(() => {}),
        );
      }
      workers.clear();
    }
    await Promise.all(cancellations);
  }

  #mutate<Result>(
    runIdValue: ReturnType<typeof teamRunId>,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    this.#assertOpen();
    const stableRunId = teamRunId(runIdValue);
    const previous = this.#locks.get(stableRunId) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(async () => {
        this.#assertOpen();
        return operation();
      });
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.#locks.set(stableRunId, tail);
    void tail.finally(() => {
      if (this.#locks.get(stableRunId) === tail) this.#locks.delete(stableRunId);
    });
    return current;
  }

  async #requireRun(runIdValue: ReturnType<typeof teamRunId>): Promise<TeamRunSnapshot> {
    const snapshotValue = await this.#persistence.getTeamRunSnapshot(runIdValue);
    if (snapshotValue === null) {
      throw serviceError("not-found", "The Team run was not found");
    }
    return normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
  }

  async #persistSnapshot(snapshotValue: TeamRunSnapshot): Promise<TeamRunSnapshot> {
    const snapshot = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
    const result = await this.#persistence.persistTeamRunSnapshot(snapshot);
    const persisted = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(result.snapshot)));
    if (!snapshotsMatch(snapshot, persisted)) {
      throw serviceError("persistence-failed", "Team run persistence substituted the snapshot");
    }
    for (const handler of this.#subscribers) {
      try {
        handler(persisted);
      } catch {
        // Snapshot observers cannot change persisted Team authority or effect ordering.
      }
    }
    return persisted;
  }

  async #scheduleReadyWorkers(snapshotValue: TeamRunSnapshot): Promise<TeamRunSnapshot> {
    let snapshot = snapshotValue;
    const teamValue = await this.#persistence.getTeamDefinition(snapshot.teamId);
    if (teamValue === null) {
      throw serviceError("not-found", "The Team definition was not found");
    }
    const team = normalizeTeamDefinition(JSON.parse(JSON.stringify(teamValue)));
    const active = this.#activeWorkersFor(snapshot.runId);
    while (active.size < snapshot.limits.maxConcurrency) {
      const node = snapshot.nodes.find(
        (candidate) =>
          candidate.kind === "worker" &&
          candidate.status === "ready" &&
          !active.has(candidate.nodeId),
      );
      if (node === undefined || node.kind !== "worker") break;
      const workerTaskId = deterministicWorkerTaskId(
        snapshot.runId,
        node.nodeId,
        node.attempts.length + 1,
      );
      snapshot = await this.#persistSnapshot(
        transitionTeamRun(snapshot, {
          type: "start-node",
          nodeId: node.nodeId,
          workerTaskId,
          occurredAt: this.#nextInstant(snapshot.updatedAt),
        }),
      );
      const startedNode = snapshot.nodes.find(({ nodeId }) => nodeId === node.nodeId);
      const attempt = startedNode?.attempts.at(-1);
      if (startedNode?.kind !== "worker" || attempt === undefined) {
        throw serviceError("persistence-failed", "Persisted Team Worker start is invalid");
      }
      const input: TeamWorkerExecutionInput = Object.freeze({
        runId: snapshot.runId,
        runRevision: snapshot.revision,
        planId: snapshot.planId,
        teamId: snapshot.teamId,
        workspaceId: team.workspaceId,
        nodeId: startedNode.nodeId,
        taskId: startedNode.taskId,
        workerTaskId: attempt.workerTaskId,
        attemptId: attempt.attemptId,
        candidateKey: startedNode.candidateKey,
        title: startedNode.title,
        capability: startedNode.capability,
        completionCriteria: startedNode.completionCriteria,
        expectedArtifactKind: startedNode.expectedArtifactKind,
      });
      const controller = new AbortController();
      active.set(startedNode.nodeId, { input, controller });
      this.#launchWorker(input, controller);
    }
    return snapshot;
  }

  #launchWorker(input: TeamWorkerExecutionInput, controller: AbortController): void {
    let execution: Promise<TeamWorkerExecutionResult>;
    try {
      execution = this.#worker.execute(input, controller.signal);
    } catch {
      execution = Promise.reject(new Error("Team Worker launch failed"));
    }
    const settled = execution.then(
      async (result) => {
        if (this.#closed || controller.signal.aborted) return;
        await this.#mutate(input.runId, async () => {
          await this.#settleWorker(input, result);
        });
      },
      async () => {
        if (this.#closed || controller.signal.aborted) return;
        await this.#mutate(input.runId, async () => {
          await this.#settleWorker(input, {
            status: "failed",
            incidentCode: "worker-execution-failed",
          });
        });
      },
    );
    this.#trackBackground(input.runId, settled);
  }

  async #settleWorker(
    input: TeamWorkerExecutionInput,
    result: TeamWorkerExecutionResult,
  ): Promise<void> {
    const active = this.#activeWorkersFor(input.runId);
    const retained = active.get(input.nodeId);
    if (retained?.input.attemptId !== input.attemptId) return;
    active.delete(input.nodeId);
    let snapshot = await this.#requireRun(input.runId);
    snapshot = await this.#persistSnapshot(
      result.status === "completed"
        ? transitionTeamRun(snapshot, {
            type: "complete-node",
            nodeId: input.nodeId,
            attemptId: input.attemptId,
            artifacts: result.artifacts,
            summary: result.summary,
            occurredAt: this.#nextInstant(snapshot.updatedAt),
          })
        : transitionTeamRun(snapshot, {
            type: "fail-node",
            nodeId: input.nodeId,
            attemptId: input.attemptId,
            incidentCode: result.incidentCode,
            occurredAt: this.#nextInstant(snapshot.updatedAt),
          }),
    );
    snapshot = await this.#scheduleReadyWorkers(snapshot);
    await this.#aggregateIfReady(snapshot);
  }

  async #aggregateIfReady(snapshotValue: TeamRunSnapshot): Promise<TeamRunSnapshot> {
    if (
      snapshotValue.result !== null ||
      snapshotValue.status === "completed" ||
      snapshotValue.status === "cancelled" ||
      !snapshotValue.nodes.every(({ status }) => status === "completed")
    ) {
      return snapshotValue;
    }
    const planValue = await this.#persistence.getAdmittedTeamPlan(snapshotValue.planId);
    if (planValue === null) {
      throw serviceError("not-found", "The admitted Team plan was not found");
    }
    const plan = normalizeAdmittedTeamPlan(JSON.parse(JSON.stringify(planValue)));
    const request = normalizeTeamPlannerSidecarRequest({
      protocolVersion: 1,
      type: "request",
      requestId: `team-aggregate-${String(snapshotValue.revision)}`,
      operation: "aggregate",
      payload: {
        correlationId: plan.correlationId,
        planId: snapshotValue.planId,
        runId: snapshotValue.runId,
        revision: snapshotValue.revision,
        artifacts: snapshotValue.nodes.flatMap(({ artifacts }) => artifacts),
      },
    });
    if (request.operation !== "aggregate") {
      throw serviceError("aggregation-failed", "Team aggregation request is invalid");
    }
    const controller = new AbortController();
    this.#aggregationControllers.set(snapshotValue.runId, controller);
    let proposed: TeamPlannerAggregateResult;
    try {
      proposed = await this.#aggregator.aggregate(request.payload, controller.signal);
    } catch {
      throw serviceError("aggregation-failed", "Team result aggregation failed");
    } finally {
      this.#aggregationControllers.delete(snapshotValue.runId);
    }
    const response = normalizeTeamPlannerSidecarResponse(
      {
        protocolVersion: 1,
        type: "response",
        requestId: request.requestId,
        status: "ok",
        result: proposed,
      },
      request,
    );
    if (response.status !== "ok" || request.operation !== "aggregate") {
      throw serviceError("aggregation-failed", "Team result aggregation failed");
    }
    return this.#persistSnapshot(
      transitionTeamRun(snapshotValue, {
        type: "complete-aggregation",
        result: response.result as TeamPlannerAggregateResult,
        occurredAt: this.#nextInstant(snapshotValue.updatedAt),
      }),
    );
  }

  #activeWorkersFor(runIdValue: ReturnType<typeof teamRunId>) {
    let active = this.#activeWorkers.get(runIdValue);
    if (active === undefined) {
      active = new Map();
      this.#activeWorkers.set(runIdValue, active);
    }
    return active;
  }

  #requireActiveWorker(
    runIdValue: ReturnType<typeof teamRunId>,
    nodeId: TeamPlanNodeId,
  ): ActiveWorker {
    const active = this.#activeWorkersFor(runIdValue).get(nodeId);
    if (active === undefined) {
      throw serviceError("worker-failed", "The Team Worker attempt is not active");
    }
    return active;
  }

  #controlActiveWorker(
    input: TeamNodeControlInput,
    type: "pause-node" | "resume-node",
    effect: (active: ActiveWorker) => Promise<void>,
  ): Promise<TeamRunSnapshot> {
    const stableRunId = teamRunId(input.runId);
    return this.#mutate(stableRunId, async () => {
      const active = this.#requireActiveWorker(stableRunId, input.nodeId);
      const snapshot = await this.#persistSnapshot(
        transitionTeamRun(await this.#requireRun(stableRunId), {
          type,
          nodeId: input.nodeId,
          reason: input.reason,
          occurredAt: instant(input.occurredAt),
        }),
      );
      try {
        await effect(active);
      } catch {
        throw serviceError("worker-failed", "The Team Worker control failed");
      }
      return snapshot;
    });
  }

  #trackBackground(runIdValue: ReturnType<typeof teamRunId>, promise: Promise<void>): void {
    let background = this.#background.get(runIdValue);
    if (background === undefined) {
      background = new Set();
      this.#background.set(runIdValue, background);
    }
    const tracked = promise
      .catch(() => {})
      .finally(() => {
        background?.delete(tracked);
        if (background?.size === 0) this.#background.delete(runIdValue);
      });
    background.add(tracked);
  }

  #nextInstant(previous: Instant): Instant {
    const candidate = instant(this.#now());
    return compareInstants(candidate, previous) < 0 ? previous : candidate;
  }

  #assertOpen(): void {
    if (this.#closed) throw serviceError("closed", "The Team orchestrator is closed");
  }
}
