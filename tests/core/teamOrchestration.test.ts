import { describe, expect, it } from "vitest";
import * as core from "../../apps/desktop/src/core";

const REQUEST = {
  protocolVersion: 1,
  correlationId: "correlation-team-plan-primary",
  planVersion: 1,
  goal: "Prepare and verify one bounded Actestra feature.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [
    {
      referenceId: "context-product-brief",
      classification: "internal",
    },
  ],
  limits: {
    maxNodes: 5,
    maxDepth: 4,
    maxConcurrency: 2,
    maxTotalAttempts: 6,
  },
} as const;

const CANDIDATE = {
  protocolVersion: 1,
  correlationId: REQUEST.correlationId,
  planVersion: REQUEST.planVersion,
  summary: "Research, implement in parallel with checks, request feedback, then aggregate.",
  nodes: [
    {
      candidateKey: "research",
      title: "Prepare bounded implementation context",
      kind: "worker",
      capability: "general",
      dependsOn: [],
      expectedArtifactKind: "document",
      completionCriteria: "One bounded implementation brief is available.",
      risk: "low",
      maxAttempts: 1,
    },
    {
      candidateKey: "implementation",
      title: "Implement the isolated feature",
      kind: "worker",
      capability: "coding",
      dependsOn: ["research"],
      expectedArtifactKind: "file",
      completionCriteria: "The focused implementation and diff are available.",
      risk: "medium",
      maxAttempts: 2,
    },
    {
      candidateKey: "checks",
      title: "Review acceptance conditions",
      kind: "worker",
      capability: "general",
      dependsOn: ["research"],
      expectedArtifactKind: "document",
      completionCriteria: "The acceptance checklist is complete.",
      risk: "low",
      maxAttempts: 1,
    },
    {
      candidateKey: "feedback",
      title: "Request bounded user feedback",
      kind: "human-feedback",
      dependsOn: ["implementation", "checks"],
      completionCriteria: "The user accepts or rejects the proposed result.",
      risk: "medium",
    },
    {
      candidateKey: "aggregate",
      title: "Aggregate accepted results",
      kind: "worker",
      capability: "general",
      dependsOn: ["feedback"],
      expectedArtifactKind: "document",
      completionCriteria: "One final bounded result references completed outputs.",
      risk: "low",
      maxAttempts: 1,
    },
  ],
} as const;

async function expectAdmissionError(
  request: unknown,
  candidate: unknown,
  code: string,
): Promise<void> {
  await expect(core.admitTeamPlanCandidate(request, candidate)).rejects.toMatchObject({
    name: "TeamPlanAdmissionError",
    code,
  });
}

describe("Actestra team-plan admission", () => {
  it("exports one closed planner protocol and admission API", () => {
    expect(core).toHaveProperty("TEAM_PLANNER_PROTOCOL_VERSION", 1);
    expect(core).toHaveProperty("normalizeTeamPlannerRequest");
    expect(core).toHaveProperty("admitTeamPlanCandidate");
    expect(typeof Reflect.get(core, "normalizeTeamPlannerRequest")).toBe("function");
    expect(typeof Reflect.get(core, "admitTeamPlanCandidate")).toBe("function");
  });

  it("normalizes and deeply freezes the closed planner request", () => {
    const request = core.normalizeTeamPlannerRequest(REQUEST);

    expect(request).toEqual(REQUEST);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.workerCapabilities)).toBe(true);
    expect(Object.isFrozen(request.contextReferences)).toBe(true);
    expect(request.contextReferences.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(request.limits)).toBe(true);
  });

  it("maps one bounded candidate into deterministic Actestra-owned identities", async () => {
    const admit = core.admitTeamPlanCandidate as unknown as (
      request: unknown,
      candidate: unknown,
    ) => Promise<{
      readonly protocolVersion: number;
      readonly planId: string;
      readonly correlationId: string;
      readonly version: number;
      readonly goal: string;
      readonly summary: string;
      readonly nodes: readonly {
        readonly nodeId: string;
        readonly taskId: string;
        readonly candidateKey: string;
        readonly dependsOn: readonly string[];
      }[];
    }>;

    const plan = await admit(REQUEST, CANDIDATE);
    const replay = await admit(REQUEST, CANDIDATE);

    expect(plan).toEqual(replay);
    expect(plan).toMatchObject({
      protocolVersion: 1,
      correlationId: REQUEST.correlationId,
      version: 1,
      goal: REQUEST.goal,
      summary: CANDIDATE.summary,
    });
    expect(plan.planId).toMatch(/^team-plan-[a-f0-9]{64}$/u);
    expect(plan.nodes.map(({ candidateKey }) => candidateKey)).toEqual([
      "research",
      "checks",
      "implementation",
      "feedback",
      "aggregate",
    ]);
    expect(new Set(plan.nodes.map(({ nodeId }) => nodeId)).size).toBe(5);
    expect(new Set(plan.nodes.map(({ taskId }) => taskId)).size).toBe(5);
    expect(plan.nodes.every(({ nodeId }) => /^team-node-[a-f0-9]{64}$/u.test(nodeId))).toBe(true);
    expect(plan.nodes.every(({ taskId }) => /^task-team-[a-f0-9]{64}$/u.test(taskId))).toBe(true);

    const byKey = new Map(plan.nodes.map((node) => [node.candidateKey, node]));
    expect(byKey.get("implementation")?.dependsOn).toEqual([byKey.get("research")?.nodeId]);
    expect(byKey.get("feedback")?.dependsOn).toEqual([
      byKey.get("checks")?.nodeId,
      byKey.get("implementation")?.nodeId,
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.nodes)).toBe(true);
    expect(
      plan.nodes.every((node) => Object.isFrozen(node) && Object.isFrozen(node.dependsOn)),
    ).toBe(true);
  });

  it("revalidates and freezes persisted plans while rejecting expansion and graph drift", async () => {
    const plan = await core.admitTeamPlanCandidate(REQUEST, CANDIDATE);
    const serialized = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    const restored = core.normalizeAdmittedTeamPlan(serialized);

    expect(restored).toEqual(plan);
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(restored.nodes)).toBe(true);

    expect(() => core.normalizeAdmittedTeamPlan({ ...serialized, scheduler: "external" })).toThrow(
      expect.objectContaining({ code: "invalid-candidate" }),
    );
    const reordered = structuredClone(serialized) as { nodes: unknown[] };
    [reordered.nodes[1], reordered.nodes[2]] = [reordered.nodes[2], reordered.nodes[1]];
    expect(() => core.normalizeAdmittedTeamPlan(reordered)).toThrow(
      expect.objectContaining({ code: "invalid-dependency" }),
    );
    const missingDependency = structuredClone(serialized) as {
      nodes: Array<{ dependsOn: string[] }>;
    };
    missingDependency.nodes[3]!.dependsOn = [`team-node-${"f".repeat(64)}`];
    expect(() => core.normalizeAdmittedTeamPlan(missingDependency)).toThrow(
      expect.objectContaining({ code: "invalid-dependency" }),
    );
    const reorderedDependencies = structuredClone(serialized) as {
      nodes: Array<{ dependsOn: string[] }>;
    };
    reorderedDependencies.nodes[3]!.dependsOn.reverse();
    expect(() => core.normalizeAdmittedTeamPlan(reorderedDependencies)).toThrow(
      expect.objectContaining({ code: "invalid-dependency" }),
    );
  });

  it.each([
    [
      "request credential",
      { ...REQUEST, credential: "must-not-cross" },
      CANDIDATE,
      "invalid-request",
    ],
    [
      "context content",
      {
        ...REQUEST,
        contextReferences: [
          {
            ...REQUEST.contextReferences[0],
            content: "private source bytes must not cross",
          },
        ],
      },
      CANDIDATE,
      "invalid-request",
    ],
    [
      "candidate Task identity",
      REQUEST,
      { ...CANDIDATE, taskId: "task-sidecar-owned" },
      "invalid-candidate",
    ],
    [
      "worker shell authority",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node, index) =>
          index === 0 ? { ...node, shell: "/bin/zsh" } : node,
        ),
      },
      "invalid-candidate",
    ],
    [
      "mismatched correlation",
      REQUEST,
      { ...CANDIDATE, correlationId: "correlation-sidecar-substitution" },
      "candidate-mismatch",
    ],
    ["mismatched version", REQUEST, { ...CANDIDATE, planVersion: 2 }, "candidate-mismatch"],
    [
      "duplicate worker capabilities",
      { ...REQUEST, workerCapabilities: ["general", "coding", "general"] },
      CANDIDATE,
      "invalid-request",
    ],
    [
      "duplicate context references",
      {
        ...REQUEST,
        contextReferences: [REQUEST.contextReferences[0], REQUEST.contextReferences[0]],
      },
      CANDIDATE,
      "invalid-request",
    ],
    [
      "request control characters",
      { ...REQUEST, goal: "Prepare\u0000untrusted authority." },
      CANDIDATE,
      "invalid-request",
    ],
    [
      "non-round-trippable candidate text",
      REQUEST,
      { ...CANDIDATE, summary: "Invalid surrogate: \ud800" },
      "invalid-candidate",
    ],
    [
      "oversized candidate text",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node, index) =>
          index === 0 ? { ...node, title: "t".repeat(core.TEAM_PLAN_MAX_TITLE_BYTES + 1) } : node,
        ),
      },
      "invalid-candidate",
    ],
  ])("rejects %s", async (_label, request, candidate, code) => {
    await expectAdmissionError(request, candidate, code);
  });

  it.each([
    [
      "more nodes than the admitted envelope",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: [
          ...CANDIDATE.nodes,
          {
            candidateKey: "extra",
            title: "Unbounded extra work",
            kind: "worker",
            capability: "general",
            dependsOn: ["aggregate"],
            expectedArtifactKind: "document",
            completionCriteria: "An extra result exists.",
            risk: "low",
            maxAttempts: 1,
          },
        ],
      },
      "limit-exceeded",
    ],
    [
      "a graph deeper than four nodes",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node) =>
          node.candidateKey === "checks"
            ? { ...node, dependsOn: ["implementation"] }
            : node.candidateKey === "feedback"
              ? { ...node, dependsOn: ["checks"] }
              : node,
        ),
      },
      "limit-exceeded",
    ],
    [
      "a layer wider than the concurrency budget",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node) =>
          node.candidateKey === "feedback"
            ? { ...node, dependsOn: ["research"] }
            : node.candidateKey === "aggregate"
              ? { ...node, dependsOn: ["implementation", "checks", "feedback"] }
              : node,
        ),
      },
      "limit-exceeded",
    ],
    [
      "a cross-depth ready frontier wider than the concurrency budget",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node) =>
          node.candidateKey === "checks"
            ? { ...node, dependsOn: [] }
            : node.candidateKey === "feedback"
              ? { ...node, dependsOn: ["research"] }
              : node,
        ),
      },
      "limit-exceeded",
    ],
    [
      "worker attempts beyond the total budget",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node) =>
          node.candidateKey === "implementation"
            ? { ...node, maxAttempts: 3 }
            : node.candidateKey === "aggregate"
              ? { ...node, maxAttempts: 2 }
              : node,
        ),
      },
      "limit-exceeded",
    ],
    [
      "a capability omitted by the Actestra manifest",
      { ...REQUEST, workerCapabilities: ["general"] },
      CANDIDATE,
      "unsupported-capability",
    ],
    [
      "a candidate without human feedback",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes
          .filter((node) => node.candidateKey !== "feedback")
          .map((node) =>
            node.candidateKey === "aggregate"
              ? { ...node, dependsOn: ["implementation", "checks"] }
              : node,
          ),
      },
      "required-node-missing",
    ],
    [
      "a candidate without a parallel branch",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes
          .filter((node) => node.candidateKey !== "checks")
          .map((node) =>
            node.candidateKey === "feedback" ? { ...node, dependsOn: ["implementation"] } : node,
          ),
      },
      "required-node-missing",
    ],
    [
      "a duplicate dependency edge",
      REQUEST,
      {
        ...CANDIDATE,
        nodes: CANDIDATE.nodes.map((node) =>
          node.candidateKey === "implementation"
            ? { ...node, dependsOn: ["research", "research"] }
            : node,
        ),
      },
      "invalid-dependency",
    ],
    [
      "request limits outside the first P6 envelope",
      { ...REQUEST, limits: { ...REQUEST.limits, maxNodes: 6 } },
      CANDIDATE,
      "invalid-request",
    ],
  ])("rejects %s", async (_label, request, candidate, code) => {
    await expectAdmissionError(request, candidate, code);
  });
});
