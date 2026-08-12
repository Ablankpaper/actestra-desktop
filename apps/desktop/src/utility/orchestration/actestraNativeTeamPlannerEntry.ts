import { createInterface } from "node:readline";
import {
  aggregateActestraNativeTeamArtifacts,
  ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE,
  createActestraNativeTeamPlanCandidate,
} from "../../main/orchestration/actestraNativeTeamPlanner";
import {
  TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
  normalizeTeamPlannerSidecarRequest,
  normalizeTeamPlannerSidecarResponse,
} from "../../shared/teamPlannerSidecarProtocol";

const ready = Object.freeze({
  protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
  type: "ready" as const,
  role: "planner" as const,
  engine: ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE,
});

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function requestIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = (value as { requestId?: unknown }).requestId;
  return typeof candidate === "string" ? candidate : null;
}

function errorResponse(
  requestId: string,
  code: "invalid-request" | "planner-failed" | "cancelled",
) {
  return Object.freeze({
    protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
    type: "response" as const,
    requestId,
    status: "error" as const,
    code,
  });
}

async function serve(): Promise<void> {
  write(ready);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (line.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      process.exitCode = 1;
      break;
    }
    let request;
    try {
      request = normalizeTeamPlannerSidecarRequest(raw);
    } catch {
      const requestId = requestIdOf(raw);
      if (requestId !== null) write(errorResponse(requestId, "invalid-request"));
      continue;
    }
    try {
      const result =
        request.operation === "propose"
          ? createActestraNativeTeamPlanCandidate(request.payload)
          : aggregateActestraNativeTeamArtifacts(request.payload);
      const response = normalizeTeamPlannerSidecarResponse(
        {
          protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
          type: "response",
          requestId: request.requestId,
          status: "ok",
          result,
        },
        request,
      );
      write(response);
    } catch {
      write(errorResponse(request.requestId, "planner-failed"));
    }
  }
  input.close();
}

void serve().catch(() => {
  process.exitCode = 1;
});
