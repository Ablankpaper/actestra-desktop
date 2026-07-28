import { describe, expect, it } from "vitest";
import {
  approvalId,
  artifactId,
  assertApprovalTransition,
  assertDomainGraph,
  assertSessionTransition,
  assertTaskTransition,
  assertWorkerTransition,
  CoreContractError,
  instant,
  isTerminalTaskState,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type DomainGraph,
} from "../../apps/desktop/src/core/domain";

const CREATED_AT = instant("2026-07-28T06:00:00.000Z");
const UPDATED_AT = instant("2026-07-28T06:05:00.000Z");

function validDomainGraph(): DomainGraph {
  const primaryWorkspaceId = workspaceId("workspace-primary");
  const primaryTaskId = taskId("task-primary");
  const primaryWorkerId = workerId("worker-primary");
  const primarySessionId = sessionId("session-primary");

  return {
    workspaces: [
      {
        id: primaryWorkspaceId,
        name: "Primary workspace",
        state: "active",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    tasks: [
      {
        id: primaryTaskId,
        workspaceId: primaryWorkspaceId,
        title: "Prove the core contracts",
        state: "running",
        activeSessionId: primarySessionId,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    workers: [
      {
        id: primaryWorkerId,
        workspaceId: primaryWorkspaceId,
        adapterKind: "deterministic-fake",
        state: "busy",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    sessions: [
      {
        id: primarySessionId,
        workspaceId: primaryWorkspaceId,
        taskId: primaryTaskId,
        workerId: primaryWorkerId,
        state: "running",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
    approvals: [
      {
        id: approvalId("approval-primary"),
        workspaceId: primaryWorkspaceId,
        taskId: primaryTaskId,
        sessionId: primarySessionId,
        action: "Write a task artifact",
        state: "pending",
        requestedAt: CREATED_AT,
        expiresAt: instant("2026-07-28T07:00:00.000Z"),
      },
    ],
    artifacts: [
      {
        id: artifactId("artifact-primary"),
        workspaceId: primaryWorkspaceId,
        taskId: primaryTaskId,
        sessionId: primarySessionId,
        kind: "file",
        label: "Core contract report",
        state: "available",
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
    ],
  };
}

function expectContractError(operation: () => void, code: CoreContractError["code"]): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(CoreContractError);
    expect((error as CoreContractError).code).toBe(code);
    return;
  }

  throw new Error(`Expected CoreContractError with code ${code}`);
}

describe("Actestra core domain", () => {
  it("accepts a coherent graph with explicit workspace ownership", () => {
    expect(() => assertDomainGraph(validDomainGraph())).not.toThrow();
  });

  it("allows historical sessions alongside one explicitly active session", () => {
    const graph = validDomainGraph();

    expect(() =>
      assertDomainGraph({
        ...graph,
        sessions: [
          ...graph.sessions,
          {
            ...graph.sessions[0],
            id: sessionId("session-historical"),
            state: "completed",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects blank, padded, and control-character identifiers", () => {
    expectContractError(() => workspaceId(""), "invalid-identifier");
    expectContractError(() => taskId(" task-primary"), "invalid-identifier");
    expectContractError(() => sessionId("session\nprimary"), "invalid-identifier");
  });

  it("accepts lifecycle transitions and rejects terminal or same-state rewrites", () => {
    expect(() => assertTaskTransition("ready", "running")).not.toThrow();
    expect(() => assertTaskTransition("running", "blocked")).not.toThrow();
    expect(() => assertTaskTransition("blocked", "completed")).not.toThrow();
    expect(() => assertSessionTransition("starting", "running")).not.toThrow();
    expect(() => assertWorkerTransition("ready", "busy")).not.toThrow();
    expect(() => assertApprovalTransition("pending", "approved")).not.toThrow();

    expectContractError(() => assertTaskTransition("completed", "running"), "invalid-transition");
    expectContractError(() => assertSessionTransition("running", "running"), "invalid-transition");
    expectContractError(() => assertWorkerTransition("crashed", "starting"), "invalid-transition");
    expectContractError(() => assertApprovalTransition("denied", "approved"), "invalid-transition");
    expectContractError(
      () => assertTaskTransition("unknown-state" as never, "running"),
      "invalid-transition",
    );
    expect(isTerminalTaskState("completed")).toBe(true);
    expect(isTerminalTaskState("running")).toBe(false);
  });

  it("rejects session, approval, and artifact references across workspaces", () => {
    const graph = validDomainGraph();
    const foreignWorkspaceId = workspaceId("workspace-foreign");

    const crossWorkspaceGraph: DomainGraph = {
      ...graph,
      workspaces: [
        ...graph.workspaces,
        {
          id: foreignWorkspaceId,
          name: "Foreign workspace",
          state: "active",
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      ],
      sessions: graph.sessions.map((session) => ({
        ...session,
        workspaceId: foreignWorkspaceId,
      })),
    };

    expectContractError(() => assertDomainGraph(crossWorkspaceGraph), "cross-workspace-reference");
  });

  it("rejects missing references and mismatched active sessions", () => {
    const graph = validDomainGraph();

    expectContractError(
      () =>
        assertDomainGraph({
          ...graph,
          workers: [],
        }),
      "missing-reference",
    );

    expectContractError(
      () =>
        assertDomainGraph({
          ...graph,
          tasks: graph.tasks.map((task) => ({
            ...task,
            activeSessionId: sessionId("session-missing"),
          })),
        }),
      "missing-reference",
    );
  });

  it("requires terminal approvals to have one resolution timestamp", () => {
    const graph = validDomainGraph();

    expectContractError(
      () =>
        assertDomainGraph({
          ...graph,
          approvals: graph.approvals.map((approval) => ({
            ...approval,
            state: "approved",
          })),
        }),
      "invalid-record",
    );

    expectContractError(
      () =>
        assertDomainGraph({
          ...graph,
          approvals: graph.approvals.map((approval) => ({
            ...approval,
            resolvedAt: UPDATED_AT,
          })),
        }),
      "invalid-record",
    );
  });

  it("rejects timestamps that move backwards", () => {
    const graph = validDomainGraph();

    expectContractError(
      () =>
        assertDomainGraph({
          ...graph,
          tasks: graph.tasks.map((task) => ({
            ...task,
            updatedAt: instant("2026-07-28T05:59:59.999Z"),
          })),
        }),
      "invalid-record",
    );
  });

  it("fails closed on an unknown persisted lifecycle state", () => {
    const graph = validDomainGraph();

    expectContractError(
      () =>
        assertDomainGraph({
          ...graph,
          tasks: graph.tasks.map((task) => ({
            ...task,
            state: "unknown-state",
          })),
        } as unknown as DomainGraph),
      "invalid-record",
    );
  });
});
