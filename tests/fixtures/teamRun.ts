import { createHash } from "node:crypto";
import {
  admitTeamPlanCandidate,
  createTeamRunSnapshot,
  instant,
  normalizeTeamDefinition,
} from "../../apps/desktop/src/core";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function createTeamRunFixture(suffix = "fixture") {
  const request = {
    protocolVersion: 1,
    correlationId: `correlation-team-run-${suffix}`,
    planVersion: 1,
    goal: "Coordinate bounded General and coding work before explicit workflow feedback.",
    workerCapabilities: ["general", "coding"],
    contextReferences: [],
    limits: {
      maxNodes: 3,
      maxDepth: 2,
      maxConcurrency: 2,
      maxTotalAttempts: 3,
    },
  } as const;
  const plan = await admitTeamPlanCandidate(request, {
    protocolVersion: 1,
    correlationId: request.correlationId,
    planVersion: request.planVersion,
    summary: "Run bounded General and coding work in parallel, then request feedback.",
    nodes: [
      {
        candidateKey: "general",
        title: "Prepare the bounded brief",
        kind: "worker",
        capability: "general",
        dependsOn: [],
        expectedArtifactKind: "document",
        completionCriteria: "One bounded brief is available.",
        risk: "low",
        maxAttempts: 1,
      },
      {
        candidateKey: "coding",
        title: "Prepare the bounded patch",
        kind: "worker",
        capability: "coding",
        dependsOn: [],
        expectedArtifactKind: "file",
        completionCriteria: "One reviewed patch is available.",
        risk: "medium",
        maxAttempts: 1,
      },
      {
        candidateKey: "feedback",
        title: "Request user feedback",
        kind: "human-feedback",
        dependsOn: ["general", "coding"],
        completionCriteria: "The user accepts or rejects the bounded result.",
        risk: "medium",
      },
    ],
  });
  const team = normalizeTeamDefinition({
    contractVersion: 1,
    teamId: `team-${digest(`team:${suffix}`)}`,
    name: `Bounded mixed team ${suffix}`,
    workspaceId: `workspace-team-run-${suffix}`,
    members: [
      {
        memberId: `team-member-${digest(`general:${suffix}`)}`,
        role: "leader",
        capability: "general",
        displayName: "General lead",
      },
      {
        memberId: `team-member-${digest(`coding:${suffix}`)}`,
        role: "teammate",
        capability: "coding",
        displayName: "Goose coding worker",
      },
    ],
    createdAt: "2026-08-04T01:00:00.000Z",
    updatedAt: "2026-08-04T01:00:00.000Z",
  });
  const accepted = createTeamRunSnapshot(plan, team, instant("2026-08-04T01:00:01.000Z"));
  return { request, plan, team, accepted } as const;
}
