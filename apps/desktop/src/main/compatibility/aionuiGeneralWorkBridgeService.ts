import {
  assertAionUiGeneralWorkBridgeResult,
  assertAionUiGeneralWorkCancelRequest,
  assertAionUiGeneralWorkIntent,
  assertAionUiGeneralWorkListRequest,
  assertAionUiGeneralWorkPreviewRequest,
  type AionUiGeneralWorkArtifactPreview,
  type AionUiGeneralWorkBridgeResult,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkProjection,
} from "../../compatibility/aionui";
import { PersistenceError } from "../../core";
import { AionUiGeneralWorkJourneyServiceError } from "./aionuiGeneralWorkJourneyService";

export interface AionUiGeneralWorkJourneyPort {
  submit(value: AionUiGeneralWorkIntent): Promise<AionUiGeneralWorkProjection>;
  list(
    nativeConversationId: string,
    limit?: number,
  ): Promise<readonly AionUiGeneralWorkProjection[]>;
  cancel(
    nativeConversationId: string,
    taskId: string,
    reason?: string,
  ): Promise<AionUiGeneralWorkProjection>;
  preview(
    nativeConversationId: string,
    taskId: string,
    artifactId: string,
  ): Promise<AionUiGeneralWorkArtifactPreview>;
}

const rejected = (
  code: Extract<AionUiGeneralWorkBridgeResult, { status: "rejected" }>["code"],
): AionUiGeneralWorkBridgeResult => Object.freeze({ status: "rejected", code });

function executionFailure(error: unknown): AionUiGeneralWorkBridgeResult {
  if (error instanceof AionUiGeneralWorkJourneyServiceError) {
    return rejected(error.code === "task-not-owned" ? "task-not-owned" : error.code);
  }
  if (error instanceof PersistenceError) {
    return rejected(
      error.code === "content-conflict" ||
        error.code === "general-work-conflict" ||
        error.code === "general-work-journey-conflict"
        ? "task-conflict"
        : "persistence-unavailable",
    );
  }
  if (
    error instanceof Error &&
    (error.name === "PersistenceUtilityError" || error.name === "PersistenceError")
  ) {
    return rejected("persistence-unavailable");
  }
  return rejected("execution-failed");
}

function validatedResult(value: AionUiGeneralWorkBridgeResult): AionUiGeneralWorkBridgeResult {
  assertAionUiGeneralWorkBridgeResult(value);
  return value;
}

export class AionUiGeneralWorkBridgeService {
  constructor(private readonly journey: AionUiGeneralWorkJourneyPort) {}

  async submit(value: unknown): Promise<AionUiGeneralWorkBridgeResult> {
    try {
      assertAionUiGeneralWorkIntent(value);
    } catch {
      return rejected("invalid-request");
    }
    try {
      return validatedResult(
        Object.freeze({
          status: "ok",
          projection: await this.journey.submit(value),
        }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }

  async list(value: unknown): Promise<AionUiGeneralWorkBridgeResult> {
    try {
      assertAionUiGeneralWorkListRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    try {
      return validatedResult(
        Object.freeze({
          status: "ok",
          projections: await this.journey.list(value.nativeConversationId, value.limit),
        }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }

  async cancel(value: unknown): Promise<AionUiGeneralWorkBridgeResult> {
    try {
      assertAionUiGeneralWorkCancelRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    try {
      return validatedResult(
        Object.freeze({
          status: "ok",
          projection: await this.journey.cancel(
            value.nativeConversationId,
            value.taskId,
            value.reason,
          ),
        }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }

  async preview(value: unknown): Promise<AionUiGeneralWorkBridgeResult> {
    try {
      assertAionUiGeneralWorkPreviewRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    try {
      return validatedResult(
        Object.freeze({
          status: "ok",
          preview: await this.journey.preview(
            value.nativeConversationId,
            value.taskId,
            value.artifactId,
          ),
        }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }
}
