import { createHash } from "node:crypto";
import {
  AIONUI_CODING_JOURNEY_CONTRACT_VERSION,
  AIONUI_GENERAL_WORK_CONTRACT_VERSION,
  type AionUiCodingJourneyProjection,
  type AionUiCodingJourneySubmitRequest,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkProjection,
} from "../../compatibility/aionui";
import {
  TEAM_PLAN_MAX_GOAL_BYTES,
  GENERAL_V1_CONTRACT_VERSION,
  assertDomainGraph,
  eventStreamId,
  taskId,
  teamRunId,
  type ActestraPersistencePort,
  type Artifact,
  type TaskId,
  type TeamAttemptId,
  type TeamWorkerCapability,
  type WorkspaceId,
} from "../../core";
import type { AionUiGeneralWorkNativeContext } from "../compatibility/aionuiGeneralWorkNativeContext";
import { deriveAionUiCodingJourneyIdentities } from "../compatibility/aionuiCodingJourneyService";
import type {
  AionUiCodingTeamApprovalDecisionEvidence,
  AionUiCodingTeamApprovalObserver,
  AionUiCodingTeamApprovalOutcomeEvidence,
} from "../compatibility/aionuiCodingJourneyService";
import {
  deriveAionUiGeneralWorkJourneyStreamId,
  deriveAionUiGeneralWorkJourneyTaskId,
} from "../compatibility/aionuiGeneralWorkJourneyService";
import { deriveGooseCodingEvidenceIdentity } from "../workers/gooseCodingEvidenceCoordinator";
import type {
  TeamWorkerExecutionInput,
  TeamWorkerExecutionObserver,
  TeamWorkerExecutionPort,
  TeamWorkerExecutionResult,
  TeamWorkerTaskIdentityInput,
} from "./teamOrchestratorService";

const MAX_TEAM_WORKER_SUMMARY_BYTES = 4_096;

export interface TeamGeneralWorkJourneyPort {
  submitFromTrustedContext(
    intent: AionUiGeneralWorkIntent,
    nativeContext: AionUiGeneralWorkNativeContext,
  ): Promise<AionUiGeneralWorkProjection>;
  waitForIdle(taskIdValue: TaskId): Promise<void>;
  list(
    nativeConversationId: string,
    limit?: number,
  ): Promise<readonly AionUiGeneralWorkProjection[]>;
  cancel(
    nativeConversationId: string,
    taskIdValue: TaskId,
    reason?: string,
  ): Promise<AionUiGeneralWorkProjection>;
}

export interface TeamCodingJourneyPort {
  submit(intent: AionUiCodingJourneySubmitRequest): Promise<AionUiCodingJourneyProjection>;
  submitFromTrustedContext(
    intent: AionUiCodingJourneySubmitRequest,
    nativeContext: AionUiGeneralWorkNativeContext,
    destinationWorkspaceId?: WorkspaceId,
  ): Promise<AionUiCodingJourneyProjection>;
  waitForIdle(taskIdValue: TaskId): Promise<void>;
  list(
    nativeConversationId: string,
    limit?: number,
  ): Promise<readonly AionUiCodingJourneyProjection[]>;
  cancel(
    nativeConversationId: string,
    taskIdValue: TaskId,
    reason?: string,
  ): Promise<AionUiCodingJourneyProjection>;
  observeApproval?(taskIdValue: string, observer: AionUiCodingTeamApprovalObserver): () => void;
  prepareTeamApprovalDecision?(
    taskIdValue: string,
    approvalIdValue: string,
    decision: "approved" | "denied",
  ): Promise<AionUiCodingTeamApprovalDecisionEvidence>;
  commitTeamApprovalDecision?(
    taskIdValue: string,
    approvalIdValue: string,
    decision: "approved" | "denied",
    persistOutcome: (evidence: AionUiCodingTeamApprovalOutcomeEvidence) => Promise<void>,
  ): Promise<AionUiCodingJourneyProjection>;
}

export interface TeamWorkspaceContextPort {
  resolve(workspaceIdValue: WorkspaceId): Promise<AionUiGeneralWorkNativeContext>;
}

export interface TeamJourneyWorkerRouterOptions {
  readonly persistence: Pick<ActestraPersistencePort, "loadDomainGraph">;
  readonly workspaceContext: TeamWorkspaceContextPort;
  readonly general: TeamGeneralWorkJourneyPort;
  readonly coding: TeamCodingJourneyPort;
}

export interface TeamJourneyBinding {
  readonly nativeConversationId: string;
  readonly submissionId: string;
}

export type TeamJourneyWorkerRouterErrorCode =
  | "invalid-input"
  | "identity-mismatch"
  | "unsupported-capability"
  | "journey-failed"
  | "artifact-mismatch"
  | "attempt-not-active";

export class TeamJourneyWorkerRouterError extends Error {
  constructor(
    readonly code: TeamJourneyWorkerRouterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TeamJourneyWorkerRouterError";
  }
}

interface TeamJourneyPauseGate {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

interface ActiveTeamJourney {
  readonly capability: TeamWorkerCapability;
  readonly nativeConversationId: string;
  readonly workerTaskId: TaskId;
  pauseGate?: TeamJourneyPauseGate;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedText(value: string, maximumBytes: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  let result = "";
  let bytes = 0;
  for (const character of normalized) {
    const nextBytes = new TextEncoder().encode(character).byteLength;
    if (bytes + nextBytes > maximumBytes) break;
    result += character;
    bytes += nextBytes;
  }
  return result;
}

function requireAttemptNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TeamJourneyWorkerRouterError(
      "invalid-input",
      "Team journey attempt number is invalid",
    );
  }
  return value;
}

export function deriveTeamJourneyBinding(
  input: Pick<TeamWorkerTaskIdentityInput, "runId" | "nodeId" | "attemptNumber" | "capability">,
): TeamJourneyBinding {
  const stableRunId = teamRunId(input.runId);
  if (!/^team-node-[a-f0-9]{64}$/u.test(input.nodeId)) {
    throw new TeamJourneyWorkerRouterError(
      "invalid-input",
      "Team journey node identity is invalid",
    );
  }
  if (input.capability !== "general" && input.capability !== "coding") {
    throw new TeamJourneyWorkerRouterError(
      "unsupported-capability",
      "Team journey Worker capability is unavailable",
    );
  }
  const attemptNumber = requireAttemptNumber(input.attemptNumber);
  return Object.freeze({
    nativeConversationId: `actestra-team-${digest(stableRunId)}`,
    submissionId: `team-${input.capability}-${digest(
      `${input.nodeId}\u0000${String(attemptNumber)}`,
    )}`,
  });
}

/**
 * Resolves the durable event stream that holds a Team node attempt's own
 * `agent.message` replies, so callers can surface the Worker's real answer
 * without projecting the operational Worker summary.
 */
export function deriveTeamJourneyReplyStreamId(
  input: Pick<TeamWorkerTaskIdentityInput, "runId" | "nodeId" | "attemptNumber" | "capability">,
): ReturnType<typeof eventStreamId> {
  const binding = deriveTeamJourneyBinding(input);
  if (input.capability === "general") {
    return deriveAionUiGeneralWorkJourneyStreamId(
      binding.nativeConversationId,
      binding.submissionId,
    );
  }
  const identities = deriveAionUiCodingJourneyIdentities(
    binding.nativeConversationId,
    binding.submissionId,
  );
  return deriveGooseCodingEvidenceIdentity({
    workspaceId: identities.workspaceId,
    taskId: identities.taskId,
    sessionId: identities.sessionId,
    workerId: identities.workerId,
  }).streamId;
}

function generalIntent(input: TeamWorkerExecutionInput, binding: TeamJourneyBinding) {
  if (input.expectedArtifactKind !== "document") {
    throw new TeamJourneyWorkerRouterError(
      "unsupported-capability",
      "General Team work currently requires a document Artifact",
    );
  }
  const title = boundedText(input.title, 256);
  const goal = boundedText(input.goal, 1_900);
  const prompt = [
    `Title: ${title}`,
    "Audience: Actestra Team",
    "Purpose: Write a concise reviewable summary from the complete inline source text below.",
    `Point: Inline source text (provided and complete): ${goal}`,
    "Point: Use only this inline text. It is not a file reference and must not be fetched.",
    "Point: Do not ask for a file or additional source material.",
  ].join("\n");
  return Object.freeze({
    contractVersion: AIONUI_GENERAL_WORK_CONTRACT_VERSION,
    nativeConversationId: binding.nativeConversationId,
    submissionId: binding.submissionId,
    prompt,
    journeyKind: "writing-artifact" as const,
    requirements:
      input.requirements ??
      Object.freeze({
        contractVersion: GENERAL_V1_CONTRACT_VERSION,
        capabilities: Object.freeze(["text-generation"] as const),
        contextReferences: Object.freeze(["inline-text"] as const),
        inputRequirements: Object.freeze(["bounded-text"] as const),
        completionCriteria: "json-envelope" as const,
      }),
  });
}

function codingIntent(input: TeamWorkerExecutionInput, binding: TeamJourneyBinding) {
  if (input.expectedArtifactKind !== "file") {
    throw new TeamJourneyWorkerRouterError(
      "unsupported-capability",
      "Coding Team work currently requires a file Artifact",
    );
  }
  const goal = boundedText(input.goal, TEAM_PLAN_MAX_GOAL_BYTES);
  return Object.freeze({
    contractVersion: AIONUI_CODING_JOURNEY_CONTRACT_VERSION,
    nativeConversationId: binding.nativeConversationId,
    submissionId: binding.submissionId,
    prompt: [
      `Goal: ${goal}`,
      `Node: ${boundedText(input.title, 512)}`,
      `Completion: ${boundedText(input.completionCriteria, 8_192)}`,
      "",
      "IMPORTANT: You are working in an isolated Git worktree. Your file modifications will be captured as a patch Artifact for review. The original authorized workspace will NOT be automatically modified. Do not claim that files have been written to the original workspace.",
    ].join("\n\n"),
  });
}

function artifactReferences(
  graphArtifacts: readonly Artifact[],
  workerTaskId: TaskId,
  expectedKind: Artifact["kind"],
  admitReadOnlyCompletion: boolean,
): readonly Readonly<{ artifactId: Artifact["id"]; taskId: TaskId; kind: Artifact["kind"] }>[] {
  const artifacts = graphArtifacts.filter(
    (artifact) => artifact.taskId === workerTaskId && artifact.state === "available",
  );
  if (
    (artifacts.length === 0 && !admitReadOnlyCompletion) ||
    (artifacts.length > 0 && !artifacts.some(({ kind }) => kind === expectedKind))
  ) {
    throw new TeamJourneyWorkerRouterError(
      "artifact-mismatch",
      "Team journey has no persisted Artifact of the admitted kind",
    );
  }
  return Object.freeze(
    artifacts.map(({ id, taskId: ownerTaskId, kind }) =>
      Object.freeze({ artifactId: id, taskId: ownerTaskId, kind }),
    ),
  );
}

/** Mirrors the incident-code shape the orchestrator accepts, so a preserved code is never dropped. */
const JOURNEY_INCIDENT_CODE_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;

/**
 * Carries a journey's own reason for not completing as a cause the orchestrator's incident walk reads.
 *
 * A journey that stopped because General was never given the material it needs is a different outcome
 * from one that broke, and the Team surface can only say which happened if the code survives this
 * layer. The router's own codes are a closed union, so the reason travels as a cause instead: the
 * incident walk descends the chain and keeps the deepest code it finds, which is this one.
 */
function journeyIncidentCause(projection: unknown): ErrorOptions | undefined {
  if (typeof projection !== "object" || projection === null) return undefined;
  const code: unknown = (projection as { readonly incidentCode?: unknown }).incidentCode;
  if (typeof code !== "string" || !JOURNEY_INCIDENT_CODE_PATTERN.test(code)) return undefined;
  return Object.freeze({ cause: Object.freeze({ code }) });
}

export class TeamJourneyWorkerRouter implements TeamWorkerExecutionPort {
  readonly #active = new Map<TeamAttemptId, ActiveTeamJourney>();

  constructor(private readonly options: TeamJourneyWorkerRouterOptions) {}

  taskIdFor(input: TeamWorkerTaskIdentityInput): TaskId {
    const binding = deriveTeamJourneyBinding(input);
    return input.capability === "general"
      ? deriveAionUiGeneralWorkJourneyTaskId(binding.nativeConversationId, binding.submissionId)
      : deriveAionUiCodingJourneyIdentities(binding.nativeConversationId, binding.submissionId)
          .taskId;
  }

  async execute(
    input: TeamWorkerExecutionInput,
    signal: AbortSignal,
    observer?: TeamWorkerExecutionObserver,
  ): Promise<TeamWorkerExecutionResult> {
    const binding = deriveTeamJourneyBinding(input);
    const workerTaskId = taskId(input.workerTaskId);
    if (workerTaskId !== this.taskIdFor(input)) {
      throw new TeamJourneyWorkerRouterError(
        "identity-mismatch",
        "Team journey Task identity does not match the persisted attempt",
      );
    }
    if (signal.aborted) {
      throw new TeamJourneyWorkerRouterError("journey-failed", "Team journey was cancelled");
    }
    const active: ActiveTeamJourney = {
      capability: input.capability,
      nativeConversationId: binding.nativeConversationId,
      workerTaskId,
    };
    if (this.#active.has(input.attemptId)) {
      throw new TeamJourneyWorkerRouterError(
        "invalid-input",
        "Team journey attempt is already active",
      );
    }
    this.#active.set(input.attemptId, active);
    let stopObserving: (() => void) | undefined;
    try {
      if (input.capability === "coding" && observer !== undefined) {
        if (this.options.coding.observeApproval === undefined) {
          throw new TeamJourneyWorkerRouterError(
            "unsupported-capability",
            "The coding journey Approval observer is unavailable",
          );
        }
        stopObserving = this.options.coding.observeApproval(workerTaskId, (evidence) =>
          observer.approvalRequired(
            Object.freeze({
              runId: input.runId,
              nodeId: input.nodeId,
              attemptId: input.attemptId,
              approvalId: evidence.approvalId,
              policyAuditRecordId: evidence.policyAuditRecordId,
              requestAuditRecordId: evidence.requestAuditRecordId,
              reason: evidence.reason,
            }),
          ),
        );
      }
      const nativeContext = await this.options.workspaceContext.resolve(input.workspaceId);
      const initial =
        input.capability === "general"
          ? await this.options.general.submitFromTrustedContext(
              generalIntent(input, binding),
              nativeContext,
            )
          : await this.options.coding.submitFromTrustedContext(
              codingIntent(input, binding),
              nativeContext,
              input.workspaceId,
            );
      if (initial.taskId !== workerTaskId) {
        throw new TeamJourneyWorkerRouterError(
          "identity-mismatch",
          "Team journey substituted the persisted Worker Task identity",
        );
      }
      if (input.capability === "general") {
        await this.options.general.waitForIdle(workerTaskId);
      } else {
        await this.options.coding.waitForIdle(workerTaskId);
      }
      await this.#waitWhilePaused(active, signal);
      if (signal.aborted) {
        throw new TeamJourneyWorkerRouterError("journey-failed", "Team journey was cancelled");
      }
      const projections =
        input.capability === "general"
          ? await this.options.general.list(binding.nativeConversationId)
          : await this.options.coding.list(binding.nativeConversationId);
      const projection = projections.find(
        ({ taskId: candidateTaskId }) => candidateTaskId === workerTaskId,
      );
      if (projection === undefined || projection.status !== "completed") {
        throw new TeamJourneyWorkerRouterError(
          "journey-failed",
          "Team journey did not reach one persisted completed Task",
          journeyIncidentCause(projection),
        );
      }
      const graph = await this.options.persistence.loadDomainGraph();
      assertDomainGraph(graph);
      const task = graph.tasks.find(({ id }) => id === workerTaskId);
      if (task?.state !== "completed") {
        throw new TeamJourneyWorkerRouterError(
          "journey-failed",
          "Team journey completion is absent from authoritative persistence",
        );
      }
      const artifacts = artifactReferences(
        graph.artifacts,
        workerTaskId,
        input.expectedArtifactKind,
        input.capability === "coding",
      );
      const projectedArtifactIds = new Set(
        projection.artifacts.map(({ artifactId }) => artifactId),
      );
      if (
        artifacts.some(
          ({ artifactId: stableArtifactId }) => !projectedArtifactIds.has(stableArtifactId),
        )
      ) {
        throw new TeamJourneyWorkerRouterError(
          "artifact-mismatch",
          "Team journey projection omitted a persisted Artifact",
        );
      }
      const summary =
        "summary" in projection && projection.summary !== undefined
          ? projection.summary
          : "messages" in projection
            ? (projection.messages.at(-1)?.text ?? `${input.title} completed.`)
            : `${input.title} completed.`;
      return Object.freeze({
        status: "completed" as const,
        summary: boundedText(summary, MAX_TEAM_WORKER_SUMMARY_BYTES),
        artifacts,
      });
    } catch (error) {
      if (error instanceof TeamJourneyWorkerRouterError) throw error;
      throw new TeamJourneyWorkerRouterError(
        "journey-failed",
        "The supervised Team journey failed",
        { cause: error },
      );
    } finally {
      stopObserving?.();
      this.#active.delete(input.attemptId);
    }
  }

  async prepareApprovalDecision(
    attemptId: TeamAttemptId,
    approvalIdValue: Parameters<
      NonNullable<TeamCodingJourneyPort["prepareTeamApprovalDecision"]>
    >[1],
    decision: "approved" | "denied",
  ) {
    const active = this.#requireActive(attemptId);
    if (
      active.capability !== "coding" ||
      this.options.coding.prepareTeamApprovalDecision === undefined
    ) {
      throw new TeamJourneyWorkerRouterError(
        "unsupported-capability",
        "The coding journey Approval decision boundary is unavailable",
      );
    }
    return this.options.coding.prepareTeamApprovalDecision(
      active.workerTaskId,
      approvalIdValue,
      decision,
    );
  }

  async commitApprovalDecision(
    attemptId: TeamAttemptId,
    approvalIdValue: Parameters<
      NonNullable<TeamCodingJourneyPort["commitTeamApprovalDecision"]>
    >[1],
    decision: "approved" | "denied",
    persistOutcome: Parameters<NonNullable<TeamCodingJourneyPort["commitTeamApprovalDecision"]>>[3],
  ): Promise<void> {
    const active = this.#requireActive(attemptId);
    if (
      active.capability !== "coding" ||
      this.options.coding.commitTeamApprovalDecision === undefined
    ) {
      throw new TeamJourneyWorkerRouterError(
        "unsupported-capability",
        "The coding journey Approval outcome boundary is unavailable",
      );
    }
    await this.options.coding.commitTeamApprovalDecision(
      active.workerTaskId,
      approvalIdValue,
      decision,
      persistOutcome,
    );
  }

  async pause(attemptId: TeamAttemptId, reason: string): Promise<void> {
    const active = this.#requireActive(attemptId);
    boundedText(reason, 1_024);
    if (active.pauseGate !== undefined) return;
    let resolve!: () => void;
    const promise = new Promise<void>((release) => {
      resolve = release;
    });
    active.pauseGate = Object.freeze({ promise, resolve });
  }

  async resume(attemptId: TeamAttemptId): Promise<void> {
    const active = this.#requireActive(attemptId);
    active.pauseGate?.resolve();
    active.pauseGate = undefined;
  }

  async cancel(attemptId: TeamAttemptId, reason: string): Promise<void> {
    const active = this.#requireActive(attemptId);
    if (active.capability === "general") {
      await this.options.general.cancel(active.nativeConversationId, active.workerTaskId, reason);
    } else {
      await this.options.coding.cancel(active.nativeConversationId, active.workerTaskId, reason);
    }
    active.pauseGate?.resolve();
    active.pauseGate = undefined;
  }

  async #waitWhilePaused(active: ActiveTeamJourney, signal: AbortSignal): Promise<void> {
    while (active.pauseGate !== undefined) {
      if (signal.aborted) return;
      const gate = active.pauseGate;
      await new Promise<void>((resolve) => {
        const onAbort = (): void => resolve();
        signal.addEventListener("abort", onAbort, { once: true });
        void gate.promise.finally(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      });
      if (active.pauseGate === gate) active.pauseGate = undefined;
    }
  }

  #requireActive(attemptId: TeamAttemptId): ActiveTeamJourney {
    const active = this.#active.get(attemptId);
    if (active === undefined) {
      throw new TeamJourneyWorkerRouterError(
        "attempt-not-active",
        "The Team journey attempt is not active",
      );
    }
    return active;
  }
}
