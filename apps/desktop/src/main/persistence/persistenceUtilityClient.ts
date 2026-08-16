import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AionUiApprovalAuthoritySummary,
  AionUiApprovalDecisionRecord,
  AionUiGeneralWorkLink,
  AionUiGeneralWorkRegistration,
  AionUiScheduleClaimInput,
  AionUiScheduleClaimResult,
  AionUiScheduleCompletionInput,
  AionUiScheduleCompletionResult,
  AionUiScheduleDeleteInput,
  AionUiScheduleJob,
  AionUiScheduleListInput,
  AionUiScheduleMutationResult,
  AionUiSchedulePersistenceUpdateInput,
  AionUiScheduleRecoveryInput,
  AionUiScheduleRegistration,
  AionUiScheduleRegistrationResult,
  AionUiShadowEvidence,
  AionUiShadowEvidenceSummary,
  AppendAionUiShadowEvidenceResult,
  NormalizedAionUiApprovalDecision,
  ReserveAionUiApprovalDecisionResult,
  RegisterAionUiGeneralWorkJourneyResult,
  StoredAionUiShadowEvidence,
} from "../../compatibility/aionui";
import {
  CoreContractError,
  PersistenceError,
  normalizeAdmittedTeamPlan,
  normalizeTeamDefinition,
  normalizeTeamExperienceBinding,
  normalizeStandardTeamMessageDelivery,
  normalizeArtifactDeliveryRecord,
  normalizeTeamRunSnapshot,
  type ActestraPersistencePort,
  type AdmittedTeamPlan,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type AuditRecord,
  type CoreEvent,
  type CoreEventCursor,
  type DomainGraph,
  type EventStreamId,
  type GeneralWorkCheckpoint,
  type Instant,
  type PersistGeneralWorkCheckpointResult,
  type PersistContentReferenceResult,
  type PersistAdmittedTeamPlanResult,
  type PersistTeamDefinitionResult,
  type PersistTeamExperienceBindingResult,
  type PersistStandardTeamMessageDeliveryResult,
  type PersistArtifactDeliveryResult,
  type ArtifactDeliveryRecord,
  type ArtifactId,
  type ArtifactWorkspaceOperationsPort,
  type TaskId,
  type PersistTeamRunSnapshotResult,
  type RemoveTeamDefinitionResult,
  type ReplaceTeamDefinitionResult,
  type PersistEvidenceResult,
  type PersistEventResult,
  type PersistWorkspaceGrantResult,
  type PrivilegedAuditRetentionState,
  type PrivilegedAuditSummary,
  type ResolveContentReferenceInput,
  type ResolvedContentReference,
  type StoreContentReferenceInput,
  type WorkspaceGrant,
  type WorkspaceId,
  type SessionId,
  type TeamPlanId,
  type TeamDefinition,
  type TeamExperienceBinding,
  type StandardTeamMessageDelivery,
  type TeamId,
  type TeamRunId,
  type TeamRunSnapshot,
} from "../../core";
import {
  PERSISTENCE_UTILITY_PROTOCOL_VERSION,
  assertPersistenceUtilityMessage,
  assertPersistenceUtilityRequest,
  type PersistenceUtilityErrorData,
  type PersistenceUtilityMessage,
  type PersistenceUtilityOperation,
  type PersistenceUtilityOperationMap,
  type PersistenceUtilityRequest,
  type PersistenceUtilityResponse,
} from "../../shared/persistenceUtilityProtocol";

export type PersistenceUtilityErrorCode =
  | "startup-timeout"
  | "request-timeout"
  | "unavailable"
  | "invalid-message"
  | "operation-failed";

export class PersistenceUtilityError extends Error {
  constructor(
    readonly code: PersistenceUtilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PersistenceUtilityError";
  }
}

export interface PersistenceUtilityTransport {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: () => void): () => void;
  onExit(listener: (code: number) => void): () => void;
  kill(): boolean;
}

export interface PersistenceUtilityClientOptions {
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly operation: PersistenceUtilityOperation;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function responseError(error: PersistenceUtilityErrorData): Error {
  if (error.domain === "persistence") {
    return new PersistenceError(error.code, error.message);
  }
  if (error.domain === "core-contract") {
    return new CoreContractError(error.code, error.message);
  }
  return new PersistenceUtilityError("operation-failed", error.message);
}

export class PersistenceUtilityClient
  implements ActestraPersistencePort, ArtifactWorkspaceOperationsPort
{
  private readonly pending = new Map<string, PendingRequest>();
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeError: () => void;
  private readonly unsubscribeExit: () => void;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveStartup!: () => void;
  private rejectStartup!: (error: Error) => void;
  private readonly startup: Promise<void>;
  private receivedReady = false;
  private connected = false;
  private closed = false;
  private failed = false;
  private futureError: Error | null = null;
  private _schemaVersion = 0;

  private constructor(
    private readonly transport: PersistenceUtilityTransport,
    private readonly userDataPath: string,
    options: PersistenceUtilityClientOptions,
  ) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.startupTimeoutMs) ||
      this.startupTimeoutMs < 1 ||
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1
    ) {
      throw new PersistenceUtilityError(
        "operation-failed",
        "Persistence utility timeouts must be positive integers",
      );
    }

    this.startup = new Promise<void>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });
    this.unsubscribeMessage = transport.onMessage((message) => {
      this.handleMessage(message);
    });
    this.unsubscribeError = transport.onError(() => {
      if (!this.closed) {
        this.fail(
          new PersistenceUtilityError("unavailable", "Persistence utility reported a fatal error"),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }
    });
    this.unsubscribeExit = transport.onExit(() => {
      if (!this.closed) {
        this.fail(
          new PersistenceUtilityError("unavailable", "Persistence utility exited"),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }
    });
  }

  static async connect(
    transport: PersistenceUtilityTransport,
    userDataPath: string,
    options: PersistenceUtilityClientOptions = {},
  ): Promise<PersistenceUtilityClient> {
    const client = new PersistenceUtilityClient(transport, userDataPath, options);
    client.startupTimer = setTimeout(() => {
      client.fail(
        new PersistenceUtilityError(
          "startup-timeout",
          "Persistence utility did not become ready in time",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
    }, client.startupTimeoutMs);
    try {
      await client.startup;
      return client;
    } finally {
      client.clearStartupTimer();
    }
  }

  get schemaVersion(): number {
    return this._schemaVersion;
  }

  async loadDomainGraph(): Promise<DomainGraph> {
    return this.invoke("load-domain-graph", {});
  }

  async replaceDomainGraph(graph: DomainGraph): Promise<void> {
    await this.invoke("replace-domain-graph", { graph });
  }

  async appendEvent(event: CoreEvent): Promise<PersistEventResult> {
    return this.invoke("append-event", { event });
  }

  async replayEvents(
    streamId: EventStreamId,
    after?: CoreEventCursor,
  ): Promise<readonly CoreEvent[]> {
    return this.invoke("replay-events", {
      streamId,
      after: after ?? null,
    });
  }

  async appendPrivilegedAudit(input: AppendPrivilegedAuditInput): Promise<AuditRecord> {
    return this.invoke("append-privileged-audit", { input });
  }

  async appendAgentAttemptEvidence(evidence: AgentAttemptEvidence): Promise<PersistEvidenceResult> {
    return this.invoke("append-agent-attempt-evidence", { evidence });
  }

  async maintainPrivilegedAudit(now: Instant): Promise<PrivilegedAuditRetentionState> {
    return this.invoke("maintain-privileged-audit", { now });
  }

  async listRecentPrivilegedAudit(limit: number): Promise<readonly AuditRecord[]> {
    return this.invoke("list-privileged-audit", { limit });
  }

  async readPrivilegedAuditRetentionState(): Promise<PrivilegedAuditRetentionState> {
    return this.invoke("read-privileged-audit-retention-state", {});
  }

  async summarizePrivilegedAudit(): Promise<PrivilegedAuditSummary> {
    return this.invoke("summarize-privileged-audit", {});
  }

  async listRecentAgentAttemptEvidence(limit: number): Promise<readonly AgentAttemptEvidence[]> {
    return this.invoke("list-agent-attempt-evidence", { limit });
  }

  async appendAionUiShadowEvidence(
    evidence: AionUiShadowEvidence,
  ): Promise<AppendAionUiShadowEvidenceResult> {
    return this.invoke("append-aionui-shadow-evidence", { evidence });
  }

  async listRecentAionUiShadowEvidence(
    limit: number,
  ): Promise<readonly StoredAionUiShadowEvidence[]> {
    return this.invoke("list-aionui-shadow-evidence", { limit });
  }

  async summarizeAionUiShadowEvidence(): Promise<AionUiShadowEvidenceSummary> {
    return this.invoke("summarize-aionui-shadow-evidence", {});
  }

  async reserveAionUiApprovalDecision(
    decision: NormalizedAionUiApprovalDecision,
    now: string,
  ): Promise<ReserveAionUiApprovalDecisionResult> {
    return this.invoke("reserve-aionui-approval-decision", { decision, now });
  }

  async beginAionUiApprovalDelivery(
    decisionId: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord> {
    return this.invoke("begin-aionui-approval-delivery", { decisionId, now });
  }

  async markAionUiApprovalDelivered(
    decisionId: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord> {
    return this.invoke("mark-aionui-approval-delivered", { decisionId, now });
  }

  async markAionUiApprovalDeliveryFailed(
    decisionId: string,
    errorCode: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord> {
    return this.invoke("mark-aionui-approval-delivery-failed", {
      decisionId,
      errorCode,
      now,
    });
  }

  async getAionUiApprovalDecision(
    decisionId: string,
  ): Promise<AionUiApprovalDecisionRecord | undefined> {
    return (await this.invoke("get-aionui-approval-decision", { decisionId })) ?? undefined;
  }

  async listPendingAionUiApprovalDecisions(
    limit: number,
  ): Promise<readonly AionUiApprovalDecisionRecord[]> {
    return this.invoke("list-pending-aionui-approval-decisions", { limit });
  }

  async summarizeAionUiApprovalAuthority(): Promise<AionUiApprovalAuthoritySummary> {
    return this.invoke("summarize-aionui-approval-authority", {});
  }

  async persistWorkspaceGrant(grant: WorkspaceGrant): Promise<PersistWorkspaceGrantResult> {
    return this.invoke("persist-workspace-grant", { grant });
  }

  async getActiveWorkspaceGrant(workspaceId: WorkspaceId): Promise<WorkspaceGrant | null> {
    return this.invoke("get-active-workspace-grant", { workspaceId });
  }

  async storeContentReference(
    input: StoreContentReferenceInput,
  ): Promise<PersistContentReferenceResult> {
    return this.invoke("store-content-reference", { input });
  }

  async resolveContentReference(
    input: ResolveContentReferenceInput,
  ): Promise<ResolvedContentReference> {
    return this.invoke("resolve-content-reference", { input });
  }

  async persistGeneralWorkCheckpoint(
    checkpoint: GeneralWorkCheckpoint,
  ): Promise<PersistGeneralWorkCheckpointResult> {
    return this.invoke("persist-general-work-checkpoint", { checkpoint });
  }

  async getGeneralWorkCheckpoint(session: SessionId): Promise<GeneralWorkCheckpoint | null> {
    return this.invoke("get-general-work-checkpoint", { sessionId: session });
  }

  async listRecoverableGeneralWorkCheckpoints(
    limit: number,
  ): Promise<readonly GeneralWorkCheckpoint[]> {
    return this.invoke("list-recoverable-general-work-checkpoints", { limit });
  }

  async persistAdmittedTeamPlan(plan: AdmittedTeamPlan): Promise<PersistAdmittedTeamPlanResult> {
    const result = await this.invoke("persist-admitted-team-plan", { plan });
    const stablePlan = this.normalizeTeamPlanResponse(result.plan);
    if (!isDeepStrictEqual(stablePlan, plan)) {
      throw this.failInvalidMessage("Persistence utility returned substituted team-plan bytes");
    }
    return Object.freeze({ status: result.status, plan: stablePlan });
  }

  async getAdmittedTeamPlan(planId: TeamPlanId): Promise<AdmittedTeamPlan | null> {
    const plan = await this.invoke("get-admitted-team-plan", { planId });
    if (plan === null) {
      return null;
    }
    const stablePlan = this.normalizeTeamPlanResponse(plan);
    if (stablePlan.planId !== planId) {
      throw this.failInvalidMessage("Persistence utility substituted a team-plan lookup identity");
    }
    return stablePlan;
  }

  async persistTeamExperienceBinding(
    binding: TeamExperienceBinding,
  ): Promise<PersistTeamExperienceBindingResult> {
    const result = await this.invoke("persist-team-experience-binding", { binding });
    const stableBinding = this.normalizeTeamExperienceBindingResponse(result.binding);
    if (
      stableBinding.teamId !== binding.teamId ||
      stableBinding.experience !== binding.experience ||
      (result.status === "stored" && !isDeepStrictEqual(stableBinding, binding))
    ) {
      throw this.failInvalidMessage(
        "Persistence utility returned substituted Team experience binding bytes",
      );
    }
    return Object.freeze({ status: result.status, binding: stableBinding });
  }

  async getTeamExperienceBinding(teamId: string): Promise<TeamExperienceBinding | null> {
    const binding = await this.invoke("get-team-experience-binding", { teamId });
    if (binding === null) return null;
    const stableBinding = this.normalizeTeamExperienceBindingResponse(binding);
    if (stableBinding.teamId !== teamId) {
      throw this.failInvalidMessage(
        "Persistence utility substituted a Team experience lookup identity",
      );
    }
    return stableBinding;
  }

  async persistStandardTeamMessageDelivery(
    delivery: StandardTeamMessageDelivery,
  ): Promise<PersistStandardTeamMessageDeliveryResult> {
    const result = await this.invoke("persist-standard-team-message-delivery", { delivery });
    const stableDelivery = this.normalizeStandardTeamMessageDeliveryResponse(result.delivery);
    if (!isDeepStrictEqual(stableDelivery, delivery)) {
      throw this.failInvalidMessage(
        "Persistence utility returned substituted Standard Team message delivery bytes",
      );
    }
    return Object.freeze({ status: result.status, delivery: stableDelivery });
  }

  async getStandardTeamMessageDelivery(
    deliveryId: string,
  ): Promise<StandardTeamMessageDelivery | null> {
    const delivery = await this.invoke("get-standard-team-message-delivery", { deliveryId });
    if (delivery === null) return null;
    const stableDelivery = this.normalizeStandardTeamMessageDeliveryResponse(delivery);
    if (stableDelivery.deliveryId !== deliveryId) {
      throw this.failInvalidMessage(
        "Persistence utility substituted a Standard Team message delivery lookup identity",
      );
    }
    return stableDelivery;
  }

  async listUnresolvedStandardTeamMessageDeliveries(
    limit: number,
  ): Promise<readonly StandardTeamMessageDelivery[]> {
    const deliveries = await this.invoke("list-unresolved-standard-team-message-deliveries", {
      limit,
    });
    const stableDeliveries = deliveries.map((delivery) =>
      this.normalizeStandardTeamMessageDeliveryResponse(delivery),
    );
    if (stableDeliveries.length > limit) {
      throw this.failInvalidMessage(
        "Persistence utility returned more unresolved Standard Team message deliveries than requested",
      );
    }
    if (
      stableDeliveries.some(
        ({ state }) => state !== "pending-effect" && state !== "effect-uncertain",
      )
    ) {
      throw this.failInvalidMessage(
        "Persistence utility returned a resolved Standard Team message delivery as unresolved",
      );
    }
    if (
      new Set(stableDeliveries.map(({ deliveryId }) => deliveryId)).size !== stableDeliveries.length
    ) {
      throw this.failInvalidMessage(
        "Persistence utility returned duplicate Standard Team message deliveries",
      );
    }
    return Object.freeze(stableDeliveries);
  }

  async persistArtifactDelivery(
    delivery: ArtifactDeliveryRecord,
  ): Promise<PersistArtifactDeliveryResult> {
    const result = await this.invoke("persist-artifact-delivery", { delivery });
    const stableDelivery = this.normalizeArtifactDeliveryResponse(result.delivery);
    if (!isDeepStrictEqual(stableDelivery, delivery)) {
      throw this.failInvalidMessage(
        "Persistence utility returned substituted Artifact delivery evidence",
      );
    }
    return Object.freeze({ status: result.status, delivery: stableDelivery });
  }

  async getArtifactDelivery(artifact: ArtifactId): Promise<ArtifactDeliveryRecord | null> {
    const delivery = await this.invoke("get-artifact-delivery", { artifactId: artifact });
    if (delivery === null) return null;
    const stableDelivery = this.normalizeArtifactDeliveryResponse(delivery);
    if (stableDelivery.artifactId !== artifact) {
      throw this.failInvalidMessage(
        "Persistence utility substituted an Artifact delivery lookup identity",
      );
    }
    return stableDelivery;
  }

  async listArtifactDeliveriesForTask(
    task: TaskId,
    limit: number,
  ): Promise<readonly ArtifactDeliveryRecord[]> {
    const deliveries = await this.invoke("list-artifact-deliveries-for-task", {
      taskId: task,
      limit,
    });
    const stableDeliveries = deliveries.map((delivery) =>
      this.normalizeArtifactDeliveryResponse(delivery),
    );
    if (stableDeliveries.length > limit) {
      throw this.failInvalidMessage(
        "Persistence utility returned more Artifact deliveries than requested",
      );
    }
    if (stableDeliveries.some((delivery) => delivery.taskId !== task)) {
      throw this.failInvalidMessage(
        "Persistence utility returned an Artifact delivery for another Task",
      );
    }
    if (
      new Set(stableDeliveries.map(({ artifactId: id }) => id)).size !== stableDeliveries.length
    ) {
      throw this.failInvalidMessage("Persistence utility returned duplicate Artifact deliveries");
    }
    return Object.freeze(stableDeliveries);
  }

  async getArtifactPatchPreview(artifact: ArtifactId): Promise<string> {
    return this.invoke("get-artifact-patch-preview", { artifactId: artifact });
  }

  async getArtifactPatchContent(artifact: ArtifactId): Promise<string> {
    return this.invoke("get-artifact-patch-content", { artifactId: artifact });
  }

  async applyArtifactToWorkspace(
    _artifact: ArtifactId,
    _workspaceRoot: string,
  ): Promise<{ readonly verifiedHead: string }> {
    // This operation cannot delegate to utility process - it requires Main process capabilities
    throw new PersistenceUtilityError(
      "operation-failed",
      "applyArtifactToWorkspace must be called through the service layer with full context",
    );
  }

  async persistTeamDefinition(team: TeamDefinition): Promise<PersistTeamDefinitionResult> {
    const result = await this.invoke("persist-team-definition", { team });
    const stableTeam = this.normalizeTeamDefinitionResponse(result.team);
    if (!isDeepStrictEqual(stableTeam, team)) {
      throw this.failInvalidMessage(
        "Persistence utility returned substituted Team definition bytes",
      );
    }
    return Object.freeze({ status: result.status, team: stableTeam });
  }

  async getTeamDefinition(teamId: TeamId): Promise<TeamDefinition | null> {
    const team = await this.invoke("get-team-definition", { teamId });
    if (team === null) return null;
    const stableTeam = this.normalizeTeamDefinitionResponse(team);
    if (stableTeam.teamId !== teamId) {
      throw this.failInvalidMessage(
        "Persistence utility substituted a Team definition lookup identity",
      );
    }
    return stableTeam;
  }

  async listTeamDefinitions(limit: number): Promise<readonly TeamDefinition[]> {
    const teams = (await this.invoke("list-team-definitions", { limit })).map((team) =>
      this.normalizeTeamDefinitionResponse(team),
    );
    if (new Set(teams.map(({ teamId }) => teamId)).size !== teams.length) {
      throw this.failInvalidMessage("Persistence utility returned duplicate Team definitions");
    }
    return Object.freeze(teams);
  }

  async replaceTeamDefinition(
    expected: TeamDefinition,
    replacement: TeamDefinition,
  ): Promise<ReplaceTeamDefinitionResult> {
    const result = await this.invoke("replace-team-definition", { expected, replacement });
    const stableTeam = this.normalizeTeamDefinitionResponse(result.team);
    if (!isDeepStrictEqual(stableTeam, replacement)) {
      throw this.failInvalidMessage(
        "Persistence utility returned substituted Team replacement bytes",
      );
    }
    return Object.freeze({ status: result.status, team: stableTeam });
  }

  async removeTeamDefinition(
    expected: TeamDefinition,
    removedAt: Instant,
  ): Promise<RemoveTeamDefinitionResult> {
    const result = await this.invoke("remove-team-definition", { expected, removedAt });
    if (result.teamId !== expected.teamId) {
      throw this.failInvalidMessage(
        "Persistence utility substituted a removed Team definition identity",
      );
    }
    return Object.freeze({ status: result.status, teamId: result.teamId });
  }

  async persistTeamRunSnapshot(snapshot: TeamRunSnapshot): Promise<PersistTeamRunSnapshotResult> {
    const result = await this.invoke("persist-team-run-snapshot", { snapshot });
    const stableSnapshot = this.normalizeTeamRunResponse(result.snapshot);
    if (!isDeepStrictEqual(stableSnapshot, snapshot)) {
      throw this.failInvalidMessage("Persistence utility returned substituted Team run bytes");
    }
    return Object.freeze({ status: result.status, snapshot: stableSnapshot });
  }

  async getTeamRunSnapshot(runId: TeamRunId): Promise<TeamRunSnapshot | null> {
    const snapshot = await this.invoke("get-team-run-snapshot", { runId });
    if (snapshot === null) return null;
    const stableSnapshot = this.normalizeTeamRunResponse(snapshot);
    if (stableSnapshot.runId !== runId) {
      throw this.failInvalidMessage("Persistence utility substituted a Team run lookup identity");
    }
    return stableSnapshot;
  }

  async listRecoverableTeamRuns(limit: number): Promise<readonly TeamRunSnapshot[]> {
    const snapshots = (await this.invoke("list-recoverable-team-runs", { limit })).map((snapshot) =>
      this.normalizeTeamRunResponse(snapshot),
    );
    if (
      new Set(snapshots.map(({ runId }) => runId)).size !== snapshots.length ||
      snapshots.some(({ status }) => ["completed", "failed", "cancelled"].includes(status))
    ) {
      throw this.failInvalidMessage("Persistence utility returned invalid recoverable Team runs");
    }
    return Object.freeze(snapshots);
  }

  async listTeamRunsForTeam(teamId: TeamId, limit: number): Promise<readonly TeamRunSnapshot[]> {
    const snapshots = (await this.invoke("list-team-runs-for-team", { teamId, limit })).map(
      (snapshot) => this.normalizeTeamRunResponse(snapshot),
    );
    if (
      new Set(snapshots.map(({ runId }) => runId)).size !== snapshots.length ||
      snapshots.some((snapshot) => snapshot.teamId !== teamId)
    ) {
      throw this.failInvalidMessage("Persistence utility returned invalid Team run heads");
    }
    return Object.freeze(snapshots);
  }

  async registerAionUiGeneralWorkJourney(
    registration: AionUiGeneralWorkRegistration,
  ): Promise<RegisterAionUiGeneralWorkJourneyResult> {
    return this.invoke("register-aionui-general-work", { registration });
  }

  async listAionUiGeneralWorkJourneyLinks(
    conversationHash: string,
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]> {
    return this.invoke("list-aionui-general-work-links", { conversationHash, limit });
  }

  async listPreparedAionUiGeneralWorkJourneyLinks(
    limit: number,
  ): Promise<readonly AionUiGeneralWorkLink[]> {
    return this.invoke("list-prepared-aionui-general-work-links", { limit });
  }

  async registerAionUiSchedule(
    registration: AionUiScheduleRegistration,
  ): Promise<AionUiScheduleRegistrationResult> {
    return this.invoke("register-aionui-schedule", { registration });
  }

  async listAionUiSchedules(input: AionUiScheduleListInput): Promise<readonly AionUiScheduleJob[]> {
    return this.invoke("list-aionui-schedules", { input });
  }

  async getAionUiSchedule(jobId: string): Promise<AionUiScheduleJob | null> {
    return this.invoke("get-aionui-schedule", { jobId });
  }

  async updateAionUiSchedule(
    input: AionUiSchedulePersistenceUpdateInput,
  ): Promise<AionUiScheduleMutationResult> {
    return this.invoke("update-aionui-schedule", { input });
  }

  async deleteAionUiSchedule(
    input: AionUiScheduleDeleteInput,
  ): Promise<AionUiScheduleMutationResult> {
    return this.invoke("delete-aionui-schedule", { input });
  }

  async claimAionUiScheduleRun(
    input: AionUiScheduleClaimInput,
  ): Promise<AionUiScheduleClaimResult> {
    return this.invoke("claim-aionui-schedule-run", { input });
  }

  async completeAionUiScheduleRun(
    input: AionUiScheduleCompletionInput,
  ): Promise<AionUiScheduleCompletionResult> {
    return this.invoke("complete-aionui-schedule-run", { input });
  }

  async recoverAionUiScheduleRuns(
    input: AionUiScheduleRecoveryInput,
  ): Promise<readonly AionUiScheduleJob[]> {
    return this.invoke("recover-aionui-schedule-runs", { input });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.failed) {
      this.closed = true;
      this.cleanup();
      this.transport.kill();
      return;
    }

    try {
      await this.invoke("close", {});
    } finally {
      this.closed = true;
      this.cleanup();
      this.transport.kill();
    }
  }

  private async invoke<Operation extends PersistenceUtilityOperation>(
    operation: Operation,
    payload: PersistenceUtilityOperationMap[Operation]["request"],
  ): Promise<PersistenceUtilityOperationMap[Operation]["result"]> {
    this.assertAvailable();
    return this.sendRequest(operation, payload);
  }

  private sendRequest<Operation extends PersistenceUtilityOperation>(
    operation: Operation,
    payload: PersistenceUtilityOperationMap[Operation]["request"],
  ): Promise<PersistenceUtilityOperationMap[Operation]["result"]> {
    const requestId = `persistence-${randomUUID()}`;
    const request: PersistenceUtilityRequest<Operation> = {
      protocolVersion: PERSISTENCE_UTILITY_PROTOCOL_VERSION,
      type: "request",
      requestId,
      operation,
      payload,
    } as PersistenceUtilityRequest<Operation>;
    assertPersistenceUtilityRequest(request);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const timeoutError = new PersistenceUtilityError(
          "request-timeout",
          `Persistence utility ${operation} request timed out`,
        );
        this.fail(
          timeoutError,
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        operation,
        resolve: (value) => {
          resolve(value as PersistenceUtilityOperationMap[Operation]["result"]);
        },
        reject,
        timeout,
      });

      try {
        this.transport.postMessage(request);
      } catch {
        this.fail(
          new PersistenceUtilityError(
            "unavailable",
            "Persistence utility request could not be sent",
          ),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }
    });
  }

  private handleMessage(value: unknown): void {
    if (this.closed || this.failed) {
      return;
    }

    try {
      assertPersistenceUtilityMessage(value);
    } catch {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility sent an invalid message",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    const message: PersistenceUtilityMessage = value;
    if (message.type === "ready") {
      if (this.receivedReady || this.connected) {
        this.fail(
          new PersistenceUtilityError(
            "invalid-message",
            "Persistence utility sent an unexpected ready message",
          ),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
        return;
      }
      this.receivedReady = true;
      void this.sendRequest("open", {
        userDataPath: this.userDataPath,
      }).then(
        (result) => {
          if (this.failed || this.closed) {
            return;
          }
          this._schemaVersion = result.schemaVersion;
          this.connected = true;
          this.clearStartupTimer();
          this.resolveStartup();
        },
        (error: Error) => {
          this.fail(
            error,
            new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
          );
        },
      );
      return;
    }
    if (message.type === "fatal") {
      this.fail(
        new PersistenceUtilityError(
          message.code === "invalid-request" ? "invalid-message" : "unavailable",
          message.message,
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }
    if (message.type === "request") {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility cannot send requests to main",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    this.handleResponse(message);
  }

  private handleResponse(response: PersistenceUtilityResponse): void {
    const pending = this.pending.get(response.requestId);
    if (pending === undefined || pending.operation !== response.operation) {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility response correlation is invalid",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    if (
      response.status === "ok" &&
      response.operation === "resolve-content-reference" &&
      createHash("sha256").update(response.result.content, "utf8").digest("hex") !==
        response.result.metadata.sha256
    ) {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility content digest is invalid",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.requestId);
    if (response.status === "error") {
      pending.reject(responseError(response.error));
      return;
    }
    pending.resolve(response.result);
  }

  private assertAvailable(): void {
    if (this.closed) {
      throw new PersistenceUtilityError("unavailable", "Persistence utility client is closed");
    }
    if (this.failed || !this.connected) {
      throw (
        this.futureError ??
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable")
      );
    }
  }

  private failInvalidMessage(message: string): PersistenceUtilityError {
    const error = new PersistenceUtilityError("invalid-message", message);
    this.fail(
      error,
      new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
    );
    return error;
  }

  private normalizeTeamPlanResponse(value: unknown): AdmittedTeamPlan {
    try {
      return normalizeAdmittedTeamPlan(value);
    } catch {
      throw this.failInvalidMessage("Persistence utility returned an invalid team plan");
    }
  }

  private normalizeTeamDefinitionResponse(value: unknown): TeamDefinition {
    try {
      return normalizeTeamDefinition(value);
    } catch {
      throw this.failInvalidMessage("Persistence utility returned an invalid Team definition");
    }
  }

  private normalizeTeamExperienceBindingResponse(value: unknown): TeamExperienceBinding {
    try {
      return normalizeTeamExperienceBinding(value);
    } catch {
      throw this.failInvalidMessage(
        "Persistence utility returned an invalid Team experience binding",
      );
    }
  }

  private normalizeStandardTeamMessageDeliveryResponse(
    value: unknown,
  ): StandardTeamMessageDelivery {
    try {
      return normalizeStandardTeamMessageDelivery(value);
    } catch {
      throw this.failInvalidMessage(
        "Persistence utility returned an invalid Standard Team message delivery",
      );
    }
  }

  private normalizeArtifactDeliveryResponse(value: unknown): ArtifactDeliveryRecord {
    try {
      return normalizeArtifactDeliveryRecord(value);
    } catch {
      throw this.failInvalidMessage("Persistence utility returned an invalid Artifact delivery");
    }
  }

  private normalizeTeamRunResponse(value: unknown): TeamRunSnapshot {
    try {
      return normalizeTeamRunSnapshot(value);
    } catch {
      throw this.failInvalidMessage("Persistence utility returned an invalid Team run snapshot");
    }
  }

  private fail(error: Error, futureError: Error): void {
    if (this.failed || this.closed) {
      return;
    }
    this.failed = true;
    this.futureError = futureError;
    this.clearStartupTimer();
    this.rejectStartup(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.cleanup();
    this.transport.kill();
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private cleanup(): void {
    this.clearStartupTimer();
    this.unsubscribeMessage();
    this.unsubscribeError();
    this.unsubscribeExit();
  }
}
