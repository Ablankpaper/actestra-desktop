import {
  TEAM_PLAN_MAX_CONCURRENCY,
  TEAM_PLAN_MAX_DEPTH,
  TEAM_PLAN_MAX_NODE_ATTEMPTS,
  TEAM_PLAN_MAX_TOTAL_ATTEMPTS,
  DEFAULT_GENERAL_REQUIREMENTS,
  TeamPlanAdmissionError,
  normalizeTeamPlannerRequest,
  type TeamPlanCandidate,
  type TeamPlannerRequest,
} from "../../core";
import {
  normalizeTeamPlannerSidecarRequest,
  type TeamPlannerAggregatePayload,
  type TeamPlannerAggregateResult,
} from "../../shared/teamPlannerSidecarProtocol";

export const ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE = Object.freeze({
  name: "actestra-native-team-planner",
  version: "1.0.0",
} as const);

const GENERAL_NODE_KEY = "general-work";
const CODING_NODE_KEY = "isolated-coding";
const FEEDBACK_NODE_KEY = "human-feedback";

function requireNativePlannerRequest(value: unknown): TeamPlannerRequest {
  const request = normalizeTeamPlannerRequest(value);
  if (
    !request.workerCapabilities.includes("general") ||
    !request.workerCapabilities.includes("coding")
  ) {
    throw new TeamPlanAdmissionError(
      "required-node-missing",
      "The Actestra native planner requires General and coding capabilities",
    );
  }
  if (
    request.limits.maxNodes < 3 ||
    request.limits.maxDepth < 2 ||
    request.limits.maxConcurrency < 2 ||
    request.limits.maxTotalAttempts < 2
  ) {
    throw new TeamPlanAdmissionError(
      "limit-exceeded",
      "The Actestra native planner requires the first P6 bounded envelope",
    );
  }
  return request;
}

function workerNode(
  candidateKey: string,
  capability: "general" | "coding",
  title: string,
  completionCriteria: string,
  expectedArtifactKind: "document" | "file",
  requirements?: TeamPlannerRequest["generalRequirements"],
) {
  return Object.freeze({
    candidateKey,
    title,
    kind: "worker" as const,
    capability,
    dependsOn: Object.freeze([] as string[]),
    expectedArtifactKind,
    completionCriteria,
    risk: capability === "coding" ? ("high" as const) : ("medium" as const),
    maxAttempts: Math.min(2, TEAM_PLAN_MAX_NODE_ATTEMPTS),
    ...(capability === "general"
      ? { requirements: requirements ?? DEFAULT_GENERAL_REQUIREMENTS }
      : {}),
  });
}

export function createActestraNativeTeamPlanCandidate(value: unknown): TeamPlanCandidate {
  const request = requireNativePlannerRequest(value);
  const candidate = Object.freeze({
    protocolVersion: request.protocolVersion,
    correlationId: request.correlationId,
    planVersion: request.planVersion,
    summary: "General and Goose work in parallel, followed by human feedback.",
    nodes: Object.freeze([
      workerNode(
        GENERAL_NODE_KEY,
        "general",
        "Prepare the General Work result",
        "General completes the bounded task and records its Actestra-owned Artifact reference.",
        "document",
        request.generalRequirements,
      ),
      workerNode(
        CODING_NODE_KEY,
        "coding",
        "Implement the isolated coding result",
        "Goose completes the isolated coding task and records its approved Artifact reference.",
        "file",
      ),
      Object.freeze({
        candidateKey: FEEDBACK_NODE_KEY,
        title: "Review the combined Team result",
        kind: "human-feedback" as const,
        dependsOn: Object.freeze([GENERAL_NODE_KEY, CODING_NODE_KEY]),
        completionCriteria: "A person reviews both Worker outcomes before Team aggregation.",
        risk: "medium" as const,
      }),
    ]),
  });
  return candidate;
}

function aggregatePayload(value: unknown): TeamPlannerAggregatePayload {
  const request = normalizeTeamPlannerSidecarRequest({
    protocolVersion: 1,
    type: "request",
    requestId: "native-aggregate",
    operation: "aggregate",
    payload: value,
  });
  if (request.operation !== "aggregate") {
    throw new TeamPlanAdmissionError(
      "invalid-request",
      "Native planner aggregate operation is invalid",
    );
  }
  return request.payload;
}

export function aggregateActestraNativeTeamArtifacts(value: unknown): TeamPlannerAggregateResult {
  const payload = aggregatePayload(value);
  return Object.freeze({
    summary: `Actestra aggregated ${String(payload.artifacts.length)} bounded Artifact references for the Team result.`,
    artifacts: Object.freeze(payload.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
  });
}

export function nativePlannerLimits(): Readonly<{
  readonly maxDepth: number;
  readonly maxConcurrency: number;
  readonly maxTotalAttempts: number;
}> {
  return Object.freeze({
    maxDepth: TEAM_PLAN_MAX_DEPTH,
    maxConcurrency: TEAM_PLAN_MAX_CONCURRENCY,
    maxTotalAttempts: TEAM_PLAN_MAX_TOTAL_ATTEMPTS,
  });
}
