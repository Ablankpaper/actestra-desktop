import path from "node:path";
import {
  CoreContractError,
  PersistenceError,
  instant,
  type ActestraPersistencePort,
} from "../../core";
import {
  assertPersistenceUtilityMessage,
  assertPersistenceUtilityRequest,
  createPersistenceUtilityErrorResponse,
  createPersistenceUtilitySuccessResponse,
  type PersistenceUtilityErrorData,
  type PersistenceUtilityRequest,
  type PersistenceUtilityResponse,
} from "../../shared/persistenceUtilityProtocol";
import { openSqliteCorePersistence } from "./sqliteCorePersistence";
import { CURRENT_CORE_SCHEMA_VERSION } from "./sqliteMigrations";

type OpenPersistence = (userDataPath: string) => ActestraPersistencePort;

class PersistenceUtilityServiceError extends Error {
  constructor(
    readonly code: "already-open" | "not-open",
    message: string,
  ) {
    super(message);
    this.name = "PersistenceUtilityServiceError";
  }
}

function boundedMessage(message: string): string {
  const trimmed = message.trim();
  return (trimmed.length === 0 ? "Persistence utility operation failed" : trimmed).slice(0, 512);
}

function errorData(error: unknown): PersistenceUtilityErrorData {
  if (error instanceof PersistenceError) {
    return {
      domain: "persistence",
      code: error.code,
      message: boundedMessage(error.message),
    };
  }
  if (error instanceof CoreContractError) {
    return {
      domain: "core-contract",
      code: error.code,
      message: boundedMessage(error.message),
    };
  }
  if (error instanceof PersistenceUtilityServiceError) {
    return {
      domain: "utility",
      code: error.code,
      message: boundedMessage(error.message),
    };
  }
  return {
    domain: "utility",
    code: "operation-failed",
    message: "Persistence utility operation failed",
  };
}

export class PersistenceUtilityService {
  private persistence: ActestraPersistencePort | null = null;

  constructor(private readonly openPersistence: OpenPersistence = openSqliteCorePersistence) {}

  async shutdown(): Promise<void> {
    const persistence = this.persistence;
    this.persistence = null;
    await persistence?.close();
  }

  async handle(value: unknown): Promise<PersistenceUtilityResponse> {
    assertPersistenceUtilityRequest(value);
    try {
      const result = await this.dispatch(value);
      const response = createPersistenceUtilitySuccessResponse(value, result as never);
      assertPersistenceUtilityMessage(response);
      return response;
    } catch (error) {
      const response = createPersistenceUtilityErrorResponse(value, errorData(error));
      assertPersistenceUtilityMessage(response);
      return response;
    }
  }

  private requirePersistence(): ActestraPersistencePort {
    if (this.persistence === null) {
      throw new PersistenceUtilityServiceError("not-open", "Persistence utility is not open");
    }
    return this.persistence;
  }

  private async dispatch(request: PersistenceUtilityRequest): Promise<unknown> {
    if (request.operation === "open") {
      if (this.persistence !== null) {
        throw new PersistenceUtilityServiceError(
          "already-open",
          "Persistence utility is already open",
        );
      }
      if (!path.isAbsolute(request.payload.userDataPath)) {
        throw new PersistenceError(
          "invalid-record",
          "Persistence utility user data path must be absolute",
        );
      }
      this.persistence = this.openPersistence(request.payload.userDataPath);
      return {
        schemaVersion: CURRENT_CORE_SCHEMA_VERSION,
      };
    }

    const persistence = this.requirePersistence();
    switch (request.operation) {
      case "load-domain-graph":
        return persistence.loadDomainGraph();
      case "replace-domain-graph":
        await persistence.replaceDomainGraph(request.payload.graph);
        return null;
      case "append-event":
        return persistence.appendEvent(request.payload.event);
      case "replay-events":
        return persistence.replayEvents(
          request.payload.streamId,
          request.payload.after ?? undefined,
        );
      case "append-privileged-audit":
        return persistence.appendPrivilegedAudit(request.payload.input);
      case "append-agent-attempt-evidence":
        return persistence.appendAgentAttemptEvidence(request.payload.evidence);
      case "summarize-privileged-audit":
        return persistence.summarizePrivilegedAudit();
      case "list-agent-attempt-evidence":
        return persistence.listRecentAgentAttemptEvidence(request.payload.limit);
      case "append-aionui-shadow-evidence":
        return persistence.appendAionUiShadowEvidence(request.payload.evidence);
      case "list-aionui-shadow-evidence":
        return persistence.listRecentAionUiShadowEvidence(request.payload.limit);
      case "summarize-aionui-shadow-evidence":
        return persistence.summarizeAionUiShadowEvidence();
      case "reserve-aionui-approval-decision":
        return persistence.reserveAionUiApprovalDecision(
          request.payload.decision,
          request.payload.now,
        );
      case "begin-aionui-approval-delivery":
        return persistence.beginAionUiApprovalDelivery(
          request.payload.decisionId,
          request.payload.now,
        );
      case "mark-aionui-approval-delivered":
        return persistence.markAionUiApprovalDelivered(
          request.payload.decisionId,
          request.payload.now,
        );
      case "mark-aionui-approval-delivery-failed":
        return persistence.markAionUiApprovalDeliveryFailed(
          request.payload.decisionId,
          request.payload.errorCode,
          request.payload.now,
        );
      case "get-aionui-approval-decision":
        return (await persistence.getAionUiApprovalDecision(request.payload.decisionId)) ?? null;
      case "list-pending-aionui-approval-decisions":
        return persistence.listPendingAionUiApprovalDecisions(request.payload.limit);
      case "summarize-aionui-approval-authority":
        return persistence.summarizeAionUiApprovalAuthority();
      case "persist-workspace-grant":
        return persistence.persistWorkspaceGrant(request.payload.grant);
      case "get-active-workspace-grant":
        return persistence.getActiveWorkspaceGrant(request.payload.workspaceId);
      case "store-content-reference":
        return persistence.storeContentReference(request.payload.input);
      case "resolve-content-reference":
        return persistence.resolveContentReference(request.payload.input);
      case "persist-general-work-checkpoint":
        return persistence.persistGeneralWorkCheckpoint(request.payload.checkpoint);
      case "get-general-work-checkpoint":
        return persistence.getGeneralWorkCheckpoint(request.payload.sessionId);
      case "list-recoverable-general-work-checkpoints":
        return persistence.listRecoverableGeneralWorkCheckpoints(request.payload.limit);
      case "persist-admitted-team-plan":
        return persistence.persistAdmittedTeamPlan(request.payload.plan);
      case "get-admitted-team-plan":
        return persistence.getAdmittedTeamPlan(request.payload.planId);
      case "persist-team-definition":
        return persistence.persistTeamDefinition(request.payload.team);
      case "get-team-definition":
        return persistence.getTeamDefinition(request.payload.teamId);
      case "list-team-definitions":
        return persistence.listTeamDefinitions(request.payload.limit);
      case "replace-team-definition":
        return persistence.replaceTeamDefinition(
          request.payload.expected,
          request.payload.replacement,
        );
      case "remove-team-definition":
        return persistence.removeTeamDefinition(
          request.payload.expected,
          instant(request.payload.removedAt),
        );
      case "persist-team-run-snapshot":
        return persistence.persistTeamRunSnapshot(request.payload.snapshot);
      case "get-team-run-snapshot":
        return persistence.getTeamRunSnapshot(request.payload.runId);
      case "list-recoverable-team-runs":
        return persistence.listRecoverableTeamRuns(request.payload.limit);
      case "list-team-runs-for-team":
        return persistence.listTeamRunsForTeam(request.payload.teamId, request.payload.limit);
      case "register-aionui-general-work":
        return persistence.registerAionUiGeneralWorkJourney(request.payload.registration);
      case "list-aionui-general-work-links":
        return persistence.listAionUiGeneralWorkJourneyLinks(
          request.payload.conversationHash,
          request.payload.limit,
        );
      case "list-prepared-aionui-general-work-links":
        return persistence.listPreparedAionUiGeneralWorkJourneyLinks(request.payload.limit);
      case "register-aionui-schedule":
        return persistence.registerAionUiSchedule(request.payload.registration);
      case "list-aionui-schedules":
        return persistence.listAionUiSchedules(request.payload.input);
      case "get-aionui-schedule":
        return persistence.getAionUiSchedule(request.payload.jobId);
      case "update-aionui-schedule":
        return persistence.updateAionUiSchedule(request.payload.input);
      case "delete-aionui-schedule":
        return persistence.deleteAionUiSchedule(request.payload.input);
      case "claim-aionui-schedule-run":
        return persistence.claimAionUiScheduleRun(request.payload.input);
      case "complete-aionui-schedule-run":
        return persistence.completeAionUiScheduleRun(request.payload.input);
      case "recover-aionui-schedule-runs":
        return persistence.recoverAionUiScheduleRuns(request.payload.input);
      case "close":
        await this.shutdown();
        return null;
    }
  }
}
