import {
  assertAionUiCodingJourneyApprovalDecisionRequest,
  assertAionUiCodingJourneyBridgeResult,
  assertAionUiCodingJourneyCancelRequest,
  assertAionUiCodingJourneyListRequest,
  assertAionUiCodingJourneyPublishDecisionRequest,
  assertAionUiCodingJourneySubmitRequest,
  type AionUiCodingJourneyApprovalDecisionRequest,
  type AionUiCodingJourneyBridgeResult,
  type AionUiCodingJourneyCancelRequest,
  type AionUiCodingJourneyListRequest,
  type AionUiCodingJourneyProjection,
  type AionUiCodingJourneyPublishDecisionRequest,
  type AionUiCodingJourneySubmitRequest,
} from "../../compatibility/aionui";
import { PersistenceError } from "../../core";
import { AionUiCodingJourneyServiceError } from "./aionuiCodingJourneyService";

export interface AionUiCodingJourneyPort {
  submit(value: AionUiCodingJourneySubmitRequest): Promise<AionUiCodingJourneyProjection>;
  list(
    nativeConversationId: string,
    limit?: number,
  ): Promise<readonly AionUiCodingJourneyProjection[]>;
  cancel(
    nativeConversationId: string,
    taskId: string,
    reason?: string,
  ): Promise<AionUiCodingJourneyProjection>;
  decideApproval(
    nativeConversationId: string,
    taskId: string,
    approvalId: string,
    decision: "approved" | "denied",
  ): Promise<AionUiCodingJourneyProjection>;
  decidePublish(
    nativeConversationId: string,
    taskId: string,
    approvalId: string,
    decision: "approved" | "denied",
  ): Promise<AionUiCodingJourneyProjection>;
}

type RejectionCode = Extract<AionUiCodingJourneyBridgeResult, { status: "rejected" }>["code"];

function rejected(code: RejectionCode): AionUiCodingJourneyBridgeResult {
  return Object.freeze({ status: "rejected", code });
}

function executionFailure(error: unknown): AionUiCodingJourneyBridgeResult {
  if (error instanceof AionUiCodingJourneyServiceError) {
    return rejected(error.code);
  }
  if (error instanceof PersistenceError) {
    return rejected(
      error.code === "content-conflict" ||
        error.code === "workspace-grant-conflict" ||
        error.code === "evidence-conflict"
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

function validatedResult(value: AionUiCodingJourneyBridgeResult): AionUiCodingJourneyBridgeResult {
  assertAionUiCodingJourneyBridgeResult(value);
  return value;
}

export class AionUiCodingJourneyBridgeService {
  constructor(private readonly journey: AionUiCodingJourneyPort) {}

  async submit(value: unknown): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      assertAionUiCodingJourneySubmitRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    try {
      return validatedResult(
        Object.freeze({ status: "ok", projection: await this.journey.submit(value) }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }

  async list(value: unknown): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      assertAionUiCodingJourneyListRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    return this.listValidated(value);
  }

  async cancel(value: unknown): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      assertAionUiCodingJourneyCancelRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    return this.cancelValidated(value);
  }

  async decideApproval(value: unknown): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      assertAionUiCodingJourneyApprovalDecisionRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    return this.decideApprovalValidated(value);
  }

  async decidePublish(value: unknown): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      assertAionUiCodingJourneyPublishDecisionRequest(value);
    } catch {
      return rejected("invalid-request");
    }
    return this.decidePublishValidated(value);
  }

  private async listValidated(
    value: AionUiCodingJourneyListRequest,
  ): Promise<AionUiCodingJourneyBridgeResult> {
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

  private async cancelValidated(
    value: AionUiCodingJourneyCancelRequest,
  ): Promise<AionUiCodingJourneyBridgeResult> {
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

  private async decideApprovalValidated(
    value: AionUiCodingJourneyApprovalDecisionRequest,
  ): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      return validatedResult(
        Object.freeze({
          status: "ok",
          projection: await this.journey.decideApproval(
            value.nativeConversationId,
            value.taskId,
            value.approvalId,
            value.decision,
          ),
        }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }

  private async decidePublishValidated(
    value: AionUiCodingJourneyPublishDecisionRequest,
  ): Promise<AionUiCodingJourneyBridgeResult> {
    try {
      return validatedResult(
        Object.freeze({
          status: "ok",
          projection: await this.journey.decidePublish(
            value.nativeConversationId,
            value.taskId,
            value.approvalId,
            value.decision,
          ),
        }),
      );
    } catch (error) {
      return executionFailure(error);
    }
  }
}
