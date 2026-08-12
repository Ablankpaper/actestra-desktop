import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateActestraNativeTeamArtifacts,
  createActestraNativeTeamPlanCandidate,
} from "../../apps/desktop/src/main/orchestration/actestraNativeTeamPlanner";

const root = process.cwd();
const productionPlanner = path.join(
  root,
  "apps/desktop/src/main/orchestration/actestraNativeTeamPlanner.ts",
);
const productionEntry = path.join(
  root,
  "apps/desktop/src/utility/orchestration/actestraNativeTeamPlannerEntry.ts",
);
const downstreamPatch = path.join(
  root,
  "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs",
);

const request = {
  protocolVersion: 1,
  correlationId: "correlation-native-planner",
  planVersion: 1,
  goal: "Coordinate one bounded General and coding result.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [],
  limits: { maxNodes: 3, maxDepth: 2, maxConcurrency: 2, maxTotalAttempts: 3 },
} as const;

const aggregate = {
  correlationId: request.correlationId,
  planId: `team-plan-${"a".repeat(64)}`,
  runId: `team-run-${"b".repeat(64)}`,
  revision: 1,
  artifacts: [
    { artifactId: "artifact-general-result", taskId: "task-general-result", kind: "document" },
    { artifactId: "artifact-coding-result", taskId: "task-coding-result", kind: "file" },
  ],
} as const;

describe("Actestra native Team planner production identity", () => {
  it("has a separate production planner source and utility entry", () => {
    expect(fs.existsSync(productionPlanner)).toBe(true);
    expect(fs.existsSync(productionEntry)).toBe(true);
  });

  it("declares the exact engine and never aliases test or local-agent sources", () => {
    const source = fs.readFileSync(productionPlanner, "utf8");
    const entry = fs.readFileSync(productionEntry, "utf8");
    expect(source).toContain("actestra-native-team-planner");
    expect(source).toContain("1.0.0");
    expect(source).not.toContain("tests/fixtures");
    expect(source).not.toContain("localAgentCli");
    expect(entry).not.toContain("teamPlannerSidecar.mjs");
    expect(entry).not.toContain("supervisedLocalAgentProvider");
  });

  it("has a declared downstream planner entry without restoring the legacy shell", () => {
    const patch = fs.readFileSync(downstreamPatch, "utf8");
    expect(patch).toContain("actestra-team-planner");
    expect(patch).toContain("actestraNativeTeamPlannerEntry.ts");
    expect(patch).toContain("'actestra-team-planner': resolve(");
    expect(patch).not.toContain("Work, orchestrated.");
    expect(patch).not.toContain("apps/desktop/src/renderer/App.tsx");
  });

  it("returns the fixed parallel General/Goose graph and is deterministic", () => {
    const first = createActestraNativeTeamPlanCandidate(request);
    const second = createActestraNativeTeamPlanCandidate(request);
    expect(first).toEqual(second);
    expect(first.nodes.map(({ candidateKey }) => candidateKey)).toEqual([
      "general-work",
      "isolated-coding",
      "human-feedback",
    ]);
    expect(first.nodes[0]).toMatchObject({ kind: "worker", capability: "general", dependsOn: [] });
    expect(first.nodes[1]).toMatchObject({ kind: "worker", capability: "coding", dependsOn: [] });
    expect(first.nodes[2]).toMatchObject({
      kind: "human-feedback",
      dependsOn: ["general-work", "isolated-coding"],
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.nodes)).toBe(true);
  });

  it("fails closed when the request cannot support the first P6 graph", () => {
    expect(() =>
      createActestraNativeTeamPlanCandidate({ ...request, workerCapabilities: ["general"] }),
    ).toThrow(/requires General and coding capabilities/);
    expect(() =>
      createActestraNativeTeamPlanCandidate({
        ...request,
        limits: { ...request.limits, maxConcurrency: 1 },
      }),
    ).toThrow();
  });

  it("aggregates only the exact bounded Artifact references", () => {
    expect(aggregateActestraNativeTeamArtifacts(aggregate)).toEqual({
      summary: "Actestra aggregated 2 bounded Artifact references for the Team result.",
      artifacts: aggregate.artifacts,
    });
  });
});
