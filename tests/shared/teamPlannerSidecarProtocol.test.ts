import { describe, expect, it } from "vitest";
import {
  MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES,
  normalizeTeamPlannerSidecarReady,
  normalizeTeamPlannerSidecarRequest,
  normalizeTeamPlannerSidecarResponse,
} from "../../apps/desktop/src/shared/teamPlannerSidecarProtocol";

const PLAN_REQUEST = {
  protocolVersion: 1,
  correlationId: "correlation-sidecar-plan",
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

const PLAN_CANDIDATE = {
  protocolVersion: 1,
  correlationId: PLAN_REQUEST.correlationId,
  planVersion: PLAN_REQUEST.planVersion,
  summary: "Run General and coding work in parallel, then request feedback.",
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

const ARTIFACTS = [
  {
    artifactId: "artifact-general-result",
    taskId: "task-general-result",
    kind: "document",
  },
  {
    artifactId: "artifact-coding-result",
    taskId: "task-coding-result",
    kind: "file",
  },
] as const;

describe("Team planner sidecar protocol", () => {
  it("accepts only the exact versioned planner ready handshake", () => {
    const ready = normalizeTeamPlannerSidecarReady({
      protocolVersion: 1,
      type: "ready",
      role: "planner",
      engine: { name: "actestra-deterministic-fixture", version: "1.0.0" },
    });

    expect(ready).toEqual({
      protocolVersion: 1,
      type: "ready",
      role: "planner",
      engine: { name: "actestra-deterministic-fixture", version: "1.0.0" },
    });
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.engine)).toBe(true);

    for (const invalid of [
      { ...ready, protocolVersion: 2 },
      { ...ready, role: "worker" },
      { ...ready, processId: 123 },
      { ...ready, engine: { ...ready.engine, path: "/private/runtime" } },
      { ...ready, engine: { name: "planner\ud800", version: "1.0.0" } },
    ]) {
      expect(() => normalizeTeamPlannerSidecarReady(invalid)).toThrow();
    }
  });

  it("normalizes a closed propose request and its typed candidate result", () => {
    const request = normalizeTeamPlannerSidecarRequest({
      protocolVersion: 1,
      type: "request",
      requestId: "planner-request-propose-1",
      operation: "propose",
      payload: PLAN_REQUEST,
    });

    expect(request).toEqual({
      protocolVersion: 1,
      type: "request",
      requestId: "planner-request-propose-1",
      operation: "propose",
      payload: PLAN_REQUEST,
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.payload)).toBe(true);

    const response = normalizeTeamPlannerSidecarResponse(
      {
        protocolVersion: 1,
        type: "response",
        requestId: request.requestId,
        status: "ok",
        result: PLAN_CANDIDATE,
      },
      request,
    );
    expect(response).toMatchObject({ status: "ok", result: PLAN_CANDIDATE });
    expect(Object.isFrozen(response)).toBe(true);

    expect(() =>
      normalizeTeamPlannerSidecarRequest({
        ...request,
        payload: { ...PLAN_REQUEST, credential: "must-not-cross" },
      }),
    ).toThrow();
    expect(() =>
      normalizeTeamPlannerSidecarResponse(
        {
          protocolVersion: 1,
          type: "response",
          requestId: request.requestId,
          status: "ok",
          result: { ...PLAN_CANDIDATE, correlationId: "substituted-correlation" },
        },
        request,
      ),
    ).toThrow();
  });

  it("keeps aggregate input and output reference-only", () => {
    const request = normalizeTeamPlannerSidecarRequest({
      protocolVersion: 1,
      type: "request",
      requestId: "planner-request-aggregate-1",
      operation: "aggregate",
      payload: {
        correlationId: PLAN_REQUEST.correlationId,
        planId: `team-plan-${"a".repeat(64)}`,
        runId: `team-run-${"b".repeat(64)}`,
        revision: 9,
        artifacts: ARTIFACTS,
      },
    });

    expect(request.operation).toBe("aggregate");
    expect(request.payload).toEqual({
      correlationId: PLAN_REQUEST.correlationId,
      planId: `team-plan-${"a".repeat(64)}`,
      runId: `team-run-${"b".repeat(64)}`,
      revision: 9,
      artifacts: ARTIFACTS,
    });

    const response = normalizeTeamPlannerSidecarResponse(
      {
        protocolVersion: 1,
        type: "response",
        requestId: request.requestId,
        status: "ok",
        result: {
          summary: "The bounded General and coding Artifact references are ready.",
          artifacts: ARTIFACTS,
        },
      },
      request,
    );
    expect(response).toMatchObject({
      status: "ok",
      result: { artifacts: ARTIFACTS },
    });

    for (const extra of [
      { rawContent: "private output" },
      { workspacePath: "/private/workspace" },
      { credential: "secret" },
      { tools: ["shell"] },
      { process: { signal: "SIGKILL" } },
    ]) {
      expect(() =>
        normalizeTeamPlannerSidecarRequest({
          ...request,
          payload: { ...request.payload, ...extra },
        }),
      ).toThrow();
    }

    expect(() =>
      normalizeTeamPlannerSidecarResponse(
        {
          protocolVersion: 1,
          type: "response",
          requestId: request.requestId,
          status: "ok",
          result: {
            summary: "Substituted reference.",
            artifacts: [{ ...ARTIFACTS[0], artifactId: "artifact-substituted" }],
          },
        },
        request,
      ),
    ).toThrow();
  });

  it("rejects unsupported operations, unbounded frames, and response identity drift", () => {
    const request = normalizeTeamPlannerSidecarRequest({
      protocolVersion: 1,
      type: "request",
      requestId: "planner-request-propose-2",
      operation: "propose",
      payload: PLAN_REQUEST,
    });

    expect(() => normalizeTeamPlannerSidecarRequest({ ...request, operation: "shell" })).toThrow();
    expect(() =>
      normalizeTeamPlannerSidecarRequest({ ...request, requestId: "../planner" }),
    ).toThrow();
    expect(() =>
      normalizeTeamPlannerSidecarRequest({
        ...request,
        payload: {
          ...PLAN_REQUEST,
          goal: "x".repeat(MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES),
        },
      }),
    ).toThrow();
    expect(() =>
      normalizeTeamPlannerSidecarResponse(
        {
          protocolVersion: 1,
          type: "response",
          requestId: "another-request",
          status: "error",
          code: "planner-failed",
        },
        request,
      ),
    ).toThrow();
    expect(() =>
      normalizeTeamPlannerSidecarResponse(
        {
          protocolVersion: 1,
          type: "response",
          requestId: request.requestId,
          status: "error",
          code: "planner-failed",
          message: "private traceback",
        },
        request,
      ),
    ).toThrow();
  });
});
