import {
  approvalId,
  artifactId,
  canRetryArtifactDelivery,
  type ActestraPersistencePort,
  type AgentClock,
  type ArtifactId,
  type ArtifactWorkspaceOperationsPort,
  type UserApprovalDecision,
} from "../../core";
import { ArtifactDeliveryService } from "../workers/artifactDeliveryService";
import { AionUiCodingJourneyServiceError } from "./aionuiCodingJourneyService";

/** The Main-owned Artifact half of the coding bridge, independent of any model Worker runtime. */
export interface AionUiCodingArtifactPort {
  viewArtifact(artifactIdValue: string): Promise<{
    readonly baseCommit: string;
    readonly changedFileCount: number;
    readonly patchPreview: string;
  }>;
  downloadArtifact(artifactIdValue: string): Promise<{
    readonly fileName: string;
    readonly content: string;
  }>;
  applyArtifact(artifactIdValue: string): Promise<{ readonly approvalId: string }>;
  resolveArtifactApply(approvalIdValue: string, decision: UserApprovalDecision): Promise<void>;
}

export interface AionUiCodingArtifactServiceOptions {
  readonly persistence: ActestraPersistencePort & ArtifactWorkspaceOperationsPort;
  readonly clock: AgentClock;
  /** Internal seam for the Main-owned delivery authority; production constructs the real service. */
  readonly deliveryService?: Pick<
    ArtifactDeliveryService,
    "inFlightApply" | "requestApply" | "resolveApply" | "recoverInterruptedApplies"
  >;
}

/**
 * Keeps Team Artifact actions available when no static coding model runtime is configured.
 * Artifact delivery is persisted Main authority, so it must not depend on Goose admission or on a
 * particular Team's replaceable Worker runtime.
 */
export class AionUiCodingArtifactService implements AionUiCodingArtifactPort {
  private readonly artifactApplyAborts = new Map<ArtifactId, AbortController>();
  private artifactDeliveryService: AionUiCodingArtifactServiceOptions["deliveryService"];

  constructor(private readonly config: AionUiCodingArtifactServiceOptions) {}

  async viewArtifact(artifactIdValue: string): Promise<{
    readonly baseCommit: string;
    readonly changedFileCount: number;
    readonly patchPreview: string;
  }> {
    const stableArtifactId = artifactId(artifactIdValue);
    const preview = await this.config.persistence.getArtifactPatchPreview(stableArtifactId);
    const delivery = await this.config.persistence.getArtifactDelivery(stableArtifactId);
    if (delivery === null) {
      throw new AionUiCodingJourneyServiceError(
        "artifact-not-found",
        "Artifact delivery record not found",
      );
    }
    return {
      baseCommit: delivery.baseCommit,
      changedFileCount: delivery.changedFileCount,
      patchPreview: preview,
    };
  }

  async downloadArtifact(artifactIdValue: string): Promise<{
    readonly fileName: string;
    readonly content: string;
  }> {
    const stableArtifactId = artifactId(artifactIdValue);
    const content = await this.config.persistence.getArtifactPatchContent(stableArtifactId);
    const graph = await this.config.persistence.loadDomainGraph();
    const artifact = graph.artifacts.find(({ id }) => id === stableArtifactId);
    if (artifact === undefined) {
      throw new AionUiCodingJourneyServiceError("artifact-not-found", "Artifact not found");
    }
    return {
      fileName: `${artifact.label.replace(/[^a-zA-Z0-9-]/g, "-")}.patch`,
      content,
    };
  }

  async applyArtifact(artifactIdValue: string): Promise<{ readonly approvalId: string }> {
    const stableArtifactId = artifactId(artifactIdValue);
    const deliveryService = this.#deliveryService();
    const inFlight = deliveryService.inFlightApply(stableArtifactId);
    if (inFlight !== undefined) {
      return Object.freeze({ approvalId: inFlight.approvalId });
    }
    await this.recoverArtifactDeliveries();
    const delivery = await this.config.persistence.getArtifactDelivery(stableArtifactId);
    if (delivery === null) {
      throw new AionUiCodingJourneyServiceError(
        "artifact-not-found",
        "Artifact delivery record not found",
      );
    }
    if (!canRetryArtifactDelivery(delivery.state)) {
      throw new AionUiCodingJourneyServiceError(
        "delivery-conflict",
        `Artifact delivery is ${delivery.state}, not retryable`,
      );
    }
    const destinationWorkspaceId = delivery.destinationWorkspaceId ?? delivery.workspaceId;
    const grant = await this.config.persistence.getActiveWorkspaceGrant(destinationWorkspaceId);
    if (grant === null) {
      throw new AionUiCodingJourneyServiceError(
        "workspace-unavailable",
        "No active workspace grant found for artifact",
      );
    }
    const request = await deliveryService.requestApply({
      artifactId: stableArtifactId,
      destinationGrant: grant,
      signal: this.#applyAbort(stableArtifactId).signal,
    });
    request.completion.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[AionUiCodingArtifactService] Apply completion failed: ${message}`, error);
    });
    return Object.freeze({ approvalId: request.approvalId });
  }

  async resolveArtifactApply(
    approvalIdValue: string,
    decision: UserApprovalDecision,
  ): Promise<void> {
    await this.#deliveryService().resolveApply(approvalId(approvalIdValue), decision);
  }

  async recoverArtifactDeliveries(): Promise<void> {
    await this.#deliveryService().recoverInterruptedApplies();
  }

  async close(): Promise<void> {
    for (const controller of this.artifactApplyAborts.values()) controller.abort();
    this.artifactApplyAborts.clear();
  }

  #deliveryService(): NonNullable<AionUiCodingArtifactServiceOptions["deliveryService"]> {
    this.artifactDeliveryService ??=
      this.config.deliveryService ??
      new ArtifactDeliveryService({
        persistence: this.config.persistence,
        clock: this.config.clock,
      });
    return this.artifactDeliveryService;
  }

  #applyAbort(artifactIdValue: ArtifactId): AbortController {
    const existing = this.artifactApplyAborts.get(artifactIdValue);
    if (existing !== undefined && !existing.signal.aborted) return existing;
    const controller = new AbortController();
    this.artifactApplyAborts.set(artifactIdValue, controller);
    return controller;
  }
}
