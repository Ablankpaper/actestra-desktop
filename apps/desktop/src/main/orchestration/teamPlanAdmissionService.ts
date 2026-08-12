import {
  admitTeamPlanCandidate,
  normalizeTeamPlannerRequest,
  TeamPlanAdmissionError,
  type AdmittedTeamPlan,
  type TeamPlanCandidate,
  type TeamPlanPersistencePort,
  type TeamPlannerRequest,
} from "../../core";
import { TeamPlannerSidecarProcessError } from "./teamPlannerSidecarProcess";

export interface TeamPlannerPort {
  propose(request: TeamPlannerRequest, signal: AbortSignal): Promise<TeamPlanCandidate>;
}

export type TeamPlanAdmissionServiceErrorCode =
  | "planner-failed"
  | "planner-invalid"
  | "planner-timeout"
  | "cancelled";

export class TeamPlanAdmissionServiceError extends Error {
  constructor(
    readonly code: TeamPlanAdmissionServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamPlanAdmissionServiceError";
  }
}

export interface TeamPlanAdmissionServiceOptions {
  readonly planner: TeamPlannerPort;
  readonly persistence: Pick<TeamPlanPersistencePort, "persistAdmittedTeamPlan">;
}

function cancelledError(): TeamPlanAdmissionServiceError {
  return new TeamPlanAdmissionServiceError(
    "cancelled",
    "The supervised team planner request was cancelled",
  );
}

function plannerInvalidError(): TeamPlanAdmissionServiceError {
  return new TeamPlanAdmissionServiceError(
    "planner-invalid",
    "The supervised team planner returned an invalid candidate",
  );
}

function plannerTimeoutError(): TeamPlanAdmissionServiceError {
  return new TeamPlanAdmissionServiceError(
    "planner-timeout",
    "The supervised team planner timed out",
  );
}

function plannerFailure(error: unknown): TeamPlanAdmissionServiceError {
  if (error instanceof TeamPlannerSidecarProcessError) {
    if (error.code === "cancelled") return cancelledError();
    if (error.code === "startup-timeout" || error.code === "request-timeout") {
      return plannerTimeoutError();
    }
    if (error.code === "protocol-failed") return plannerInvalidError();
  }
  return new TeamPlanAdmissionServiceError(
    "planner-failed",
    "The supervised team planner could not produce a candidate",
  );
}

export class TeamPlanAdmissionService {
  readonly #planner: TeamPlannerPort;
  readonly #persistence: Pick<TeamPlanPersistencePort, "persistAdmittedTeamPlan">;

  constructor(options: TeamPlanAdmissionServiceOptions) {
    this.#planner = options.planner;
    this.#persistence = options.persistence;
  }

  async propose(requestValue: unknown, signal?: AbortSignal): Promise<AdmittedTeamPlan> {
    const request = normalizeTeamPlannerRequest(requestValue);
    const plannerSignal = signal ?? new AbortController().signal;
    if (plannerSignal.aborted) {
      throw cancelledError();
    }

    let candidate: TeamPlanCandidate;
    try {
      candidate = await this.#planner.propose(request, plannerSignal);
    } catch (error) {
      if (plannerSignal.aborted) {
        throw cancelledError();
      }
      throw plannerFailure(error);
    }

    if (plannerSignal.aborted) {
      throw cancelledError();
    }
    let plan: AdmittedTeamPlan;
    try {
      plan = await admitTeamPlanCandidate(request, candidate);
    } catch (error) {
      if (plannerSignal.aborted) throw cancelledError();
      if (error instanceof TeamPlanAdmissionError) throw plannerInvalidError();
      throw error;
    }
    if (plannerSignal.aborted) {
      throw cancelledError();
    }
    await this.#persistence.persistAdmittedTeamPlan(plan);
    return plan;
  }
}
