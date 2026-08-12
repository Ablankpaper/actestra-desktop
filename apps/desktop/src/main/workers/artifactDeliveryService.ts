import {
  approvalActorId,
  ArtifactWorkspaceApplicatorError,
  assertApprovalRequestSnapshot,
  classifyArtifactDeliveryRecovery,
  recoverArtifactDeliveryRecord,
  type ArtifactDeliveryRecord,
  type ArtifactDeliveryRecoveryAction,
  type ActestraPersistencePort,
  type ApprovalId,
  type ApprovalRequestSnapshot,
  type ApprovalService,
  type ArtifactId,
  type ArtifactWorkspaceOperationsPort,
  type PrivilegedClock,
  type ToolGateway,
  type UserApprovalDecision,
  type WorkspaceGrant,
} from "../../core";
import {
  createArtifactDeliveryPlatform,
  type ArtifactDeliveryPlatform,
} from "../privileged/artifactDeliveryPlatform";
import {
  applyArtifactToWorkspace,
  type ArtifactWorkspaceApplyResult,
} from "./artifactWorkspaceApplicator";

/** Who resolved an apply decision. Only a real user decision may authorize a workspace write. */
export const ARTIFACT_APPLY_ACTOR = approvalActorId("actor-user-artifact-apply");

/** Per-task bound for the startup recovery sweep, so a large profile cannot stall the scan. */
export const ARTIFACT_DELIVERY_RECOVERY_SCAN_LIMIT = 100;

export interface ArtifactDeliveryServiceConfig {
  readonly persistence: ActestraPersistencePort & ArtifactWorkspaceOperationsPort;
  readonly clock: PrivilegedClock;
  /** Overridable so a test can inject deterministic identifiers and settle decisions itself. */
  readonly platform?: ArtifactDeliveryPlatform;
}

/** A started apply, waiting on the user. The write has not happened and may never happen. */
export interface ArtifactApplyRequest {
  readonly artifactId: ArtifactId;
  readonly approvalId: ApprovalId;
  /** Resolves once the decision is settled and any authorized write has finished. */
  readonly completion: Promise<ArtifactWorkspaceApplyResult>;
}

interface PendingApply {
  readonly artifactId: ArtifactId;
  readonly settle: (snapshot: ApprovalRequestSnapshot) => void;
  readonly fail: (error: Error) => void;
}

interface InFlightApply {
  readonly request: ArtifactApplyRequest;
  readonly completion: Promise<unknown>;
}

/**
 * Main's own authority for applying a reviewed patch to the user's repository.
 *
 * It exists because obtaining a Tool Gateway used to require opening an isolated coding session, and
 * that opens a fresh worktree and rebinds the passed grant to it — so the approval would name a
 * throwaway copy while the write landed in the user's own repository. This service composes the
 * privileged services directly instead, and never opens a worktree.
 *
 * Goose cannot reach it: the only effect it admits is `artifact.apply`, and only a user decision
 * releases it.
 */
export class ArtifactDeliveryService {
  private readonly platform: ArtifactDeliveryPlatform;
  /** Approvals awaiting a user decision, keyed by approval so a decision routes to one attempt. */
  private readonly pending = new Map<ApprovalId, PendingApply>();
  /** One active apply per Artifact, including the interval after approval and before persistence. */
  private readonly inFlight = new Map<ArtifactId, InFlightApply>();
  /** Covers the small race before the first request has obtained its approval id. */
  private readonly starting = new Map<ArtifactId, Promise<ArtifactApplyRequest>>();

  constructor(private readonly config: ArtifactDeliveryServiceConfig) {
    this.platform =
      config.platform ??
      createArtifactDeliveryPlatform({
        persistence: config.persistence,
        clock: config.clock,
      });
  }

  get approvalService(): ApprovalService {
    return this.platform.approvalService;
  }

  get toolGateway(): ToolGateway {
    return this.platform.toolGateway;
  }

  /**
   * Runs the apply up to the approval and returns as soon as one is pending, so no caller blocks on a
   * human. The returned `completion` carries the rest of the ten-step path.
   */
  async requestApply(input: {
    readonly artifactId: ArtifactId;
    readonly destinationGrant: WorkspaceGrant;
    readonly signal: AbortSignal;
  }): Promise<ArtifactApplyRequest> {
    const existing = this.inFlight.get(input.artifactId);
    if (existing !== undefined) {
      return existing.request;
    }
    const starting = this.starting.get(input.artifactId);
    if (starting !== undefined) {
      return starting;
    }
    const operation = this.#startApply(input);
    this.starting.set(input.artifactId, operation);
    void operation.then(
      (request) => {
        if (this.starting.get(input.artifactId) !== operation) return;
        this.starting.delete(input.artifactId);
        const tracked: InFlightApply = Object.freeze({
          request,
          completion: request.completion,
        });
        this.inFlight.set(input.artifactId, tracked);
        void request.completion.then(
          () => {
            if (this.inFlight.get(input.artifactId) === tracked) {
              this.inFlight.delete(input.artifactId);
            }
          },
          () => {
            if (this.inFlight.get(input.artifactId) === tracked) {
              this.inFlight.delete(input.artifactId);
            }
          },
        );
      },
      () => {
        if (this.starting.get(input.artifactId) === operation) {
          this.starting.delete(input.artifactId);
        }
      },
    );
    return operation;
  }

  /** Returns the same approval for a concurrent UI retry, never creates a second apply. */
  inFlightApply(artifactIdValue: ArtifactId): ArtifactApplyRequest | undefined {
    return this.inFlight.get(artifactIdValue)?.request;
  }

  async #startApply(input: {
    readonly artifactId: ArtifactId;
    readonly destinationGrant: WorkspaceGrant;
    readonly signal: AbortSignal;
  }): Promise<ArtifactApplyRequest> {
    let publishApproval!: (approval: ApprovalId) => void;
    let failRequest!: (error: Error) => void;
    const requested = new Promise<ApprovalId>((resolve, reject) => {
      publishApproval = resolve;
      failRequest = reject;
    });

    const completion = applyArtifactToWorkspace({
      artifactId: input.artifactId,
      workspaceRoot: input.destinationGrant.rootPath,
      grant: input.destinationGrant,
      persistence: this.config.persistence,
      clock: this.config.clock,
      toolGateway: this.platform.toolGateway,
      awaitApprovalDecision: (approval, signal) => {
        publishApproval(approval);
        return this.#awaitDecision(input.artifactId, approval, signal);
      },
      signal: input.signal,
    });

    // A failure before the approval exists must reject the request rather than strand the caller.
    completion.catch((error: unknown) => {
      failRequest(error instanceof Error ? error : new Error(String(error)));
    });

    const approvalId = await requested;
    return Object.freeze({ artifactId: input.artifactId, approvalId, completion });
  }

  /**
   * Records the user's decision. Resolving through the real `ApprovalService` keeps the audited
   * approval the single source of truth: the applicator re-reads the snapshot it produces and refuses
   * anything that does not match the operation it requested.
   */
  async resolveApply(
    approval: ApprovalId,
    decision: UserApprovalDecision,
  ): Promise<ApprovalRequestSnapshot> {
    const waiting = this.pending.get(approval);
    if (waiting === undefined) {
      throw new ArtifactWorkspaceApplicatorError(
        "approval-failed",
        "No artifact apply is waiting on this approval",
      );
    }
    try {
      const snapshot = await this.platform.approvalService.resolve(
        approval,
        decision,
        ARTIFACT_APPLY_ACTOR,
      );
      assertApprovalRequestSnapshot(snapshot);
      waiting.settle(snapshot);
      await this.#awaitApplyCompletion(waiting.artifactId);
      return snapshot;
    } catch (error) {
      // Expiry is fail-closed, but the approval service has already made it terminal. Deliver that
      // durable decision to the applicator so it can persist `cancelled` instead of waiting forever.
      const snapshot = await this.platform.approvalService.get(approval);
      if (snapshot !== undefined) {
        assertApprovalRequestSnapshot(snapshot);
        if (snapshot.state !== "pending") {
          waiting.settle(snapshot);
          await this.#awaitApplyCompletion(waiting.artifactId);
        }
      }
      throw error;
    }
  }

  async #awaitApplyCompletion(artifact: ArtifactId): Promise<void> {
    const completion = this.inFlight.get(artifact)?.completion;
    if (completion !== undefined) {
      await completion.catch(() => undefined);
    }
  }

  /**
   * Settles deliveries left `applying` by a crash, and must run before any new apply is admitted.
   *
   * Nothing is resumed. The process that owned the lock and the pending decision is gone, so an
   * interrupted attempt is classified and closed: released to `cancelled` when it never obtained an
   * approval, failed closed when it had one and the write cannot be proven either way. The Artifact
   * and its patch are retained in both cases, so the user can deliberately apply again.
   */
  async recoverInterruptedApplies(): Promise<
    readonly {
      readonly artifactId: ArtifactId;
      readonly action: ArtifactDeliveryRecoveryAction["action"];
    }[]
  > {
    // Deliveries are reachable per task, so the tasks in the graph bound the sweep. There is no
    // all-deliveries read to add, and none is wanted: recovery stays inside the same task scope the
    // rest of the delivery surface is authorized against.
    const graph = await this.config.persistence.loadDomainGraph();
    const deliveries: ArtifactDeliveryRecord[] = [];
    for (const task of graph.tasks) {
      const forTask = await this.config.persistence.listArtifactDeliveriesForTask(
        task.id,
        ARTIFACT_DELIVERY_RECOVERY_SCAN_LIMIT,
      );
      deliveries.push(...forTask);
    }
    const recovered: {
      readonly artifactId: ArtifactId;
      readonly action: ArtifactDeliveryRecoveryAction["action"];
    }[] = [];
    for (const delivery of deliveries) {
      // A record this process is actively applying is not interrupted, so it is never rewritten.
      if (this.#isAwaitingDecision(delivery.artifactId)) {
        continue;
      }
      const action = classifyArtifactDeliveryRecovery(delivery).action;
      const settled = recoverArtifactDeliveryRecord(delivery, this.config.clock.now());
      if (settled === null) {
        continue;
      }
      await this.config.persistence.persistArtifactDelivery(settled);
      recovered.push(Object.freeze({ artifactId: delivery.artifactId, action }));
    }
    return Object.freeze(recovered);
  }

  #isAwaitingDecision(artifact: ArtifactId): boolean {
    for (const waiting of this.pending.values()) {
      if (waiting.artifactId === artifact) {
        return true;
      }
    }
    return false;
  }

  /** Pending approvals, so a restart or a UI reconnect can re-project what is still waiting. */
  pendingApprovals(): readonly {
    readonly artifactId: ArtifactId;
    readonly approvalId: ApprovalId;
  }[] {
    return Object.freeze(
      [...this.pending.entries()].map(([approvalId, waiting]) =>
        Object.freeze({ artifactId: waiting.artifactId, approvalId }),
      ),
    );
  }

  #awaitDecision(
    artifactId: ArtifactId,
    approval: ApprovalId,
    signal: AbortSignal,
  ): Promise<ApprovalRequestSnapshot> {
    if (this.pending.has(approval)) {
      return Promise.reject(
        new ArtifactWorkspaceApplicatorError(
          "approval-failed",
          "This apply approval is already awaiting a decision",
        ),
      );
    }
    if (signal.aborted) {
      return Promise.reject(
        new ArtifactWorkspaceApplicatorError(
          "approval-failed",
          "The artifact apply was cancelled before an approval was projected",
        ),
      );
    }
    let settle!: (snapshot: ApprovalRequestSnapshot) => void;
    let fail!: (error: Error) => void;
    const decided = new Promise<ApprovalRequestSnapshot>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    const onAbort = (): void => {
      fail(
        new ArtifactWorkspaceApplicatorError(
          "approval-failed",
          "The artifact apply was cancelled before a decision",
        ),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    this.pending.set(approval, Object.freeze({ artifactId, settle, fail }));
    return decided.finally(() => {
      signal.removeEventListener("abort", onAbort);
      this.pending.delete(approval);
    });
  }
}
