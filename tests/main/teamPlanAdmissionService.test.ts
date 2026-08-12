import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  normalizeTeamPlanCandidate,
  type AdmittedTeamPlan,
  type PersistAdmittedTeamPlanResult,
  type TeamPlanCandidate,
} from "../../apps/desktop/src/core";
import { TeamPlanAdmissionService } from "../../apps/desktop/src/main/orchestration/teamPlanAdmissionService";
import { TeamPlannerSidecarProcessError } from "../../apps/desktop/src/main/orchestration/teamPlannerSidecarProcess";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const servicePath = path.join(
  repositoryRoot,
  "apps/desktop/src/main/orchestration/teamPlanAdmissionService.ts",
);

const REQUEST = {
  protocolVersion: 1,
  correlationId: "correlation-main-team-plan",
  planVersion: 1,
  goal: "Coordinate one bounded General and coding result.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [],
  limits: {
    maxNodes: 3,
    maxDepth: 2,
    maxConcurrency: 2,
    maxTotalAttempts: 3,
  },
} as const;

const CANDIDATE = {
  protocolVersion: 1,
  correlationId: REQUEST.correlationId,
  planVersion: 1,
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
} as const;
const NORMALIZED_CANDIDATE = normalizeTeamPlanCandidate(CANDIDATE);

type PlannerPort = {
  propose(request: unknown, signal: AbortSignal): Promise<TeamPlanCandidate>;
};

type PersistencePort = {
  persistAdmittedTeamPlan(plan: AdmittedTeamPlan): Promise<PersistAdmittedTeamPlanResult>;
};

type AdmissionService = {
  propose(
    request: unknown,
    signal?: AbortSignal,
  ): Promise<{
    readonly planId: string;
    readonly nodes: readonly { readonly candidateKey: string; readonly taskId: string }[];
  }>;
};

function createService(
  planner: PlannerPort,
  persistence: PersistencePort = {
    persistAdmittedTeamPlan: async (plan) => ({ status: "stored", plan }),
  },
): AdmissionService {
  const Service = TeamPlanAdmissionService as unknown as new (options: {
    readonly planner: PlannerPort;
    readonly persistence: PersistencePort;
  }) => AdmissionService;
  return new Service({ planner, persistence });
}

describe("TeamPlanAdmissionService", () => {
  it("exists behind the desktop-main orchestration boundary", () => {
    expect(fs.existsSync(servicePath)).toBe(true);
  });

  it("sends only a normalized request and admits the returned candidate in Core", async () => {
    const planner = {
      propose: vi.fn(async (request: unknown, signal: AbortSignal) => {
        expect(request).toEqual(REQUEST);
        expect(Object.isFrozen(request)).toBe(true);
        const record = request as typeof REQUEST;
        expect(Object.isFrozen(record.workerCapabilities)).toBe(true);
        expect(Object.isFrozen(record.contextReferences)).toBe(true);
        expect(Object.isFrozen(record.limits)).toBe(true);
        expect(signal.aborted).toBe(false);
        return NORMALIZED_CANDIDATE;
      }),
    };
    const plan = await createService(planner).propose(REQUEST);

    expect(planner.propose).toHaveBeenCalledTimes(1);
    expect(plan.planId).toMatch(/^team-plan-[a-f0-9]{64}$/u);
    expect(plan.nodes.map(({ candidateKey }) => candidateKey)).toEqual([
      "coding",
      "general",
      "feedback",
    ]);
    expect(plan.nodes.every(({ taskId }) => /^task-team-[a-f0-9]{64}$/u.test(taskId))).toBe(true);
  });

  it("returns an admitted plan only after durable persistence completes", async () => {
    let releasePersistence: (() => void) | undefined;
    const persistenceGate = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const persistence = {
      persistAdmittedTeamPlan: vi.fn(async (plan: AdmittedTeamPlan) => {
        await persistenceGate;
        return { status: "stored" as const, plan };
      }),
    };
    const proposal = createService(
      { propose: vi.fn(async () => NORMALIZED_CANDIDATE) },
      persistence,
    ).propose(REQUEST);

    await vi.waitFor(() => {
      expect(persistence.persistAdmittedTeamPlan).toHaveBeenCalledTimes(1);
    });
    let returned = false;
    void proposal.then(() => {
      returned = true;
    });
    await Promise.resolve();
    expect(returned).toBe(false);

    releasePersistence?.();
    await expect(proposal).resolves.toMatchObject({
      correlationId: REQUEST.correlationId,
      version: REQUEST.planVersion,
    });
  });

  it("rejects an expanded request before the planner receives it", async () => {
    const planner = { propose: vi.fn(async () => NORMALIZED_CANDIDATE) };
    await expect(
      createService(planner).propose({ ...REQUEST, credential: "must-not-cross" }),
    ).rejects.toMatchObject({ name: "TeamPlanAdmissionError", code: "invalid-request" });
    expect(planner.propose).not.toHaveBeenCalled();
  });

  it("maps planner failure and pre-call cancellation without leaking sidecar details", async () => {
    const planner = {
      propose: vi.fn(async () => {
        throw new Error("private sidecar traceback");
      }),
    };
    const service = createService(planner);
    await expect(service.propose(REQUEST)).rejects.toMatchObject({
      name: "TeamPlanAdmissionServiceError",
      code: "planner-failed",
      message: "The supervised team planner could not produce a candidate",
    });

    const controller = new AbortController();
    controller.abort();
    planner.propose.mockClear();
    await expect(service.propose(REQUEST, controller.signal)).rejects.toMatchObject({
      name: "TeamPlanAdmissionServiceError",
      code: "cancelled",
    });
    expect(planner.propose).not.toHaveBeenCalled();
  });

  it("classifies supervised planner timeout and protocol failures without leaking details", async () => {
    for (const code of ["startup-timeout", "request-timeout"] as const) {
      const planner = {
        propose: vi.fn(async () => {
          throw new TeamPlannerSidecarProcessError(code, "private sidecar path and timing");
        }),
      };
      await expect(createService(planner).propose(REQUEST)).rejects.toMatchObject({
        name: "TeamPlanAdmissionServiceError",
        code: "planner-timeout",
        message: "The supervised team planner timed out",
      });
    }

    const planner = {
      propose: vi.fn(async () => {
        throw new TeamPlannerSidecarProcessError(
          "protocol-failed",
          "private malformed planner frame",
        );
      }),
    };
    await expect(createService(planner).propose(REQUEST)).rejects.toMatchObject({
      name: "TeamPlanAdmissionServiceError",
      code: "planner-invalid",
      message: "The supervised team planner returned an invalid candidate",
    });
  });

  it("rejects a candidate returned after cancellation", async () => {
    let resolveCandidate: ((candidate: TeamPlanCandidate) => void) | undefined;
    const planner = {
      propose: vi.fn(
        async () =>
          new Promise<TeamPlanCandidate>((resolve) => {
            resolveCandidate = resolve;
          }),
      ),
    };
    const controller = new AbortController();
    const proposal = createService(planner).propose(REQUEST, controller.signal);

    controller.abort();
    resolveCandidate?.(NORMALIZED_CANDIDATE);

    await expect(proposal).rejects.toMatchObject({
      name: "TeamPlanAdmissionServiceError",
      code: "cancelled",
    });
  });

  it("maps Core candidate admission failures to one bounded planner-invalid error", async () => {
    const planner = {
      propose: vi.fn(
        async () =>
          ({
            ...NORMALIZED_CANDIDATE,
            correlationId: "candidate-substitution",
          }) as unknown as TeamPlanCandidate,
      ),
    };

    await expect(createService(planner).propose(REQUEST)).rejects.toMatchObject({
      name: "TeamPlanAdmissionServiceError",
      code: "planner-invalid",
      message: "The supervised team planner returned an invalid candidate",
    });
  });
});
