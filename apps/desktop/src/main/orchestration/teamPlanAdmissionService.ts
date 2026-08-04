import {
  admitTeamPlanCandidate,
  normalizeTeamPlannerRequest,
  type AdmittedTeamPlan,
  type TeamPlanPersistencePort,
  type TeamPlannerRequest,
} from "../../core";

export interface TeamPlannerPort {
  propose(request: TeamPlannerRequest, signal: AbortSignal): Promise<unknown>;
}

export type TeamPlanAdmissionServiceErrorCode = "planner-failed" | "cancelled";

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

    let candidate: unknown;
    try {
      candidate = await this.#planner.propose(request, plannerSignal);
    } catch {
      if (plannerSignal.aborted) {
        throw cancelledError();
      }
      throw new TeamPlanAdmissionServiceError(
        "planner-failed",
        "The supervised team planner could not produce a candidate",
      );
    }

    if (plannerSignal.aborted) {
      throw cancelledError();
    }
    const plan = await admitTeamPlanCandidate(request, candidate);
    if (plannerSignal.aborted) {
      throw cancelledError();
    }
    await this.#persistence.persistAdmittedTeamPlan(plan);
    return plan;
  }
}
