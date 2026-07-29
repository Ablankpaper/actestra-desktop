import {
  AionUiShadowProjectionError,
  projectAionUiObservation,
  type AionUiShadowPersistencePort,
  type StoredAionUiShadowEvidence,
} from "../../compatibility/aionui";

export type AionUiShadowObservationResult =
  | {
      readonly status: "appended" | "duplicate";
      readonly evidenceId: string;
      readonly sequence: number;
    }
  | {
      readonly status: "rejected";
      readonly code: "invalid-observation" | "persistence-unavailable" | "projection-failed";
    };

export class AionUiShadowProjectionService {
  constructor(private readonly persistence: AionUiShadowPersistencePort) {}

  async observe(value: unknown): Promise<AionUiShadowObservationResult> {
    try {
      const evidence = projectAionUiObservation(value);
      const result = await this.persistence.appendAionUiShadowEvidence(evidence);
      return Object.freeze({
        status: result.status,
        evidenceId: evidence.evidenceId,
        sequence: result.sequence,
      });
    } catch (error) {
      if (error instanceof AionUiShadowProjectionError) {
        return Object.freeze({
          status: "rejected",
          code: error.code === "invalid-observation" ? "invalid-observation" : "projection-failed",
        });
      }
      return Object.freeze({
        status: "rejected",
        code: "persistence-unavailable",
      });
    }
  }

  async recent(limit = 50): Promise<readonly StoredAionUiShadowEvidence[]> {
    return this.persistence.listRecentAionUiShadowEvidence(limit);
  }
}
