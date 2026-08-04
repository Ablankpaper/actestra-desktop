import { describe, expect, it, vi } from "vitest";
import {
  approvalId,
  artifactId,
  auditRecordId,
  instant,
  taskId,
  teamAttemptId,
  workspaceId,
  type ArtifactKind,
  type DomainGraph,
  type TeamWorkerCapability,
} from "../../apps/desktop/src/core";
import {
  TeamJourneyWorkerRouter,
  deriveTeamJourneyBinding,
} from "../../apps/desktop/src/main/orchestration/teamJourneyWorkerRouter";
import type {
  TeamWorkerExecutionInput,
  TeamWorkerExecutionObserver,
} from "../../apps/desktop/src/main/orchestration/teamOrchestratorService";
import { createTeamRunFixture } from "../fixtures/teamRun";

const OCCURRED_AT = instant("2026-08-05T00:00:00.000Z");

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((release) => {
    resolve = release;
  });
  return { promise, resolve } as const;
}

function completedGraph(
  workerTaskId: ReturnType<typeof taskId>,
  expectedKind: ArtifactKind,
): DomainGraph {
  const stableWorkspaceId = workspaceId("workspace-team-router-authority");
  return {
    workspaces: [
      {
        id: stableWorkspaceId,
        name: "Team router authority",
        state: "active",
        createdAt: OCCURRED_AT,
        updatedAt: OCCURRED_AT,
      },
    ],
    tasks: [
      {
        id: workerTaskId,
        workspaceId: stableWorkspaceId,
        title: "Persisted Team journey",
        state: "completed",
        createdAt: OCCURRED_AT,
        updatedAt: OCCURRED_AT,
      },
    ],
    sessions: [],
    workers: [],
    approvals: [],
    artifacts: [
      {
        id: artifactId(`artifact-team-router-${expectedKind}`),
        workspaceId: stableWorkspaceId,
        taskId: workerTaskId,
        kind: expectedKind,
        label: "Persisted Team journey result",
        state: "available",
        createdAt: OCCURRED_AT,
        updatedAt: OCCURRED_AT,
      },
    ],
  };
}

function generalProjection(
  workerTaskId: ReturnType<typeof taskId>,
  status: "running" | "completed",
) {
  return {
    contractVersion: 1,
    taskId: workerTaskId,
    status,
    title: "Bounded General Team work",
    summary: status === "completed" ? "The bounded General work completed." : undefined,
    canCancel: status === "running",
    createdAt: OCCURRED_AT,
    updatedAt: OCCURRED_AT,
    artifacts:
      status === "completed"
        ? [
            {
              artifactId: artifactId("artifact-team-router-document"),
              kind: "document" as const,
              label: "Persisted Team journey result",
              state: "available" as const,
            },
          ]
        : [],
  } as const;
}

function codingProjection(
  workerTaskId: ReturnType<typeof taskId>,
  status: "running" | "completed" | "cancelled",
) {
  return {
    contractVersion: 1,
    taskId: workerTaskId,
    status,
    stage:
      status === "completed"
        ? ("published" as const)
        : status === "cancelled"
          ? ("cancelled" as const)
          : ("working" as const),
    title: "Bounded coding Team work",
    canCancel: status === "running",
    createdAt: OCCURRED_AT,
    updatedAt: OCCURRED_AT,
    messages: [],
    tools: [],
    artifacts:
      status === "completed"
        ? [
            {
              artifactId: artifactId("artifact-team-router-file"),
              label: "Persisted Team journey result",
              state: "available" as const,
            },
          ]
        : [],
  } as const;
}

async function executionInput(
  router: TeamJourneyWorkerRouter,
  capability: TeamWorkerCapability,
): Promise<TeamWorkerExecutionInput> {
  const { accepted } = await createTeamRunFixture(`router-${capability}`);
  const node = accepted.nodes.find(
    (candidate) => candidate.kind === "worker" && candidate.capability === capability,
  );
  if (node?.kind !== "worker") throw new Error("Missing Team router Worker fixture node");
  const attemptNumber = 1;
  const workerTaskId = router.taskIdFor({
    runId: accepted.runId,
    nodeId: node.nodeId,
    attemptNumber,
    capability,
  });
  return Object.freeze({
    runId: accepted.runId,
    runRevision: 3,
    planId: accepted.planId,
    teamId: accepted.teamId,
    workspaceId: workspaceId(`workspace-team-router-${capability}`),
    nodeId: node.nodeId,
    taskId: node.taskId,
    workerTaskId,
    attemptId: teamAttemptId(`team-attempt-${node.nodeId.slice("team-node-".length)}-1`),
    attemptNumber,
    candidateKey: node.candidateKey,
    title: node.title,
    capability,
    completionCriteria: node.completionCriteria,
    expectedArtifactKind: node.expectedArtifactKind,
  });
}

describe("TeamJourneyWorkerRouter", () => {
  it("routes General work through trusted context and re-reads the persisted Artifact", async () => {
    let workerTaskId = taskId("task-team-router-unresolved-general");
    const submitFromTrustedContext = vi.fn(async () => generalProjection(workerTaskId, "running"));
    const waitForIdle = vi.fn(async () => undefined);
    const list = vi.fn(async () => [generalProjection(workerTaskId, "completed")]);
    const codingSubmit = vi.fn();
    const resolveWorkspace = vi.fn(async () => ({
      rootPath: "/private/tmp/actestra-team-router-general",
      displayName: "Actestra Team workspace",
    }));
    const persistence = {
      loadDomainGraph: vi.fn(async () => completedGraph(workerTaskId, "document")),
    };
    const router = new TeamJourneyWorkerRouter({
      persistence,
      workspaceContext: { resolve: resolveWorkspace },
      general: {
        submitFromTrustedContext,
        waitForIdle,
        list,
        cancel: vi.fn(),
      },
      coding: {
        submit: codingSubmit,
        waitForIdle: vi.fn(),
        list: vi.fn(),
        cancel: vi.fn(),
      },
    });
    const input = await executionInput(router, "general");
    workerTaskId = input.workerTaskId;
    const binding = deriveTeamJourneyBinding(input);

    await expect(router.execute(input, new AbortController().signal)).resolves.toEqual({
      status: "completed",
      summary: "The bounded General work completed.",
      artifacts: [
        {
          artifactId: "artifact-team-router-document",
          taskId: workerTaskId,
          kind: "document",
        },
      ],
    });
    expect(submitFromTrustedContext).toHaveBeenCalledWith(
      {
        contractVersion: 1,
        nativeConversationId: binding.nativeConversationId,
        submissionId: binding.submissionId,
        prompt: expect.stringContaining(input.completionCriteria),
        journeyKind: "writing-artifact",
      },
      {
        rootPath: "/private/tmp/actestra-team-router-general",
        displayName: "Actestra Team workspace",
      },
    );
    expect(resolveWorkspace).toHaveBeenCalledWith(input.workspaceId);
    expect(waitForIdle).toHaveBeenCalledWith(workerTaskId);
    expect(list).toHaveBeenCalledWith(binding.nativeConversationId);
    expect(codingSubmit).not.toHaveBeenCalled();
  });

  it("routes coding through the isolated journey without scheduler-supplied authority", async () => {
    let workerTaskId = taskId("task-team-router-unresolved-coding");
    const submit = vi.fn(async (_intent: unknown) => codingProjection(workerTaskId, "running"));
    const waitForIdle = vi.fn(async () => undefined);
    const list = vi.fn(async () => [codingProjection(workerTaskId, "completed")]);
    const generalSubmit = vi.fn();
    const persistence = {
      loadDomainGraph: vi.fn(async () => completedGraph(workerTaskId, "file")),
    };
    const router = new TeamJourneyWorkerRouter({
      persistence,
      workspaceContext: { resolve: vi.fn() },
      general: {
        submitFromTrustedContext: generalSubmit,
        waitForIdle: vi.fn(),
        list: vi.fn(),
        cancel: vi.fn(),
      },
      coding: {
        submit,
        waitForIdle,
        list,
        cancel: vi.fn(),
      },
    });
    const input = await executionInput(router, "coding");
    workerTaskId = input.workerTaskId;
    const binding = deriveTeamJourneyBinding(input);

    await expect(router.execute(input, new AbortController().signal)).resolves.toMatchObject({
      status: "completed",
      artifacts: [{ artifactId: "artifact-team-router-file", taskId: workerTaskId, kind: "file" }],
    });
    expect(submit).toHaveBeenCalledWith({
      contractVersion: 1,
      nativeConversationId: binding.nativeConversationId,
      submissionId: binding.submissionId,
      prompt: expect.stringContaining(input.completionCriteria),
    });
    const submittedIntent = submit.mock.calls[0]?.[0];
    if (typeof submittedIntent !== "object" || submittedIntent === null) {
      throw new Error("Coding router did not submit one bounded intent");
    }
    expect(Object.keys(submittedIntent).sort()).toEqual([
      "contractVersion",
      "nativeConversationId",
      "prompt",
      "submissionId",
    ]);
    expect(waitForIdle).toHaveBeenCalledWith(workerTaskId);
    expect(list).toHaveBeenCalledWith(binding.nativeConversationId);
    expect(generalSubmit).not.toHaveBeenCalled();
  });

  it("forwards exact real coding Approval evidence and holds release behind Core outcome persistence", async () => {
    let workerTaskId = taskId("task-team-router-unresolved-approval");
    const idle = deferred();
    let approvalHandler:
      | ((evidence: {
          approvalId: ReturnType<typeof approvalId>;
          policyAuditRecordId: ReturnType<typeof auditRecordId>;
          requestAuditRecordId: ReturnType<typeof auditRecordId>;
          reason: string;
        }) => void | Promise<void>)
      | undefined;
    const stopObserving = vi.fn();
    const observeApproval = vi.fn((_taskId, handler) => {
      approvalHandler = handler;
      return stopObserving;
    });
    const prepareTeamApprovalDecision = vi.fn(async () =>
      Object.freeze({
        decisionAuditRecordId: auditRecordId("audit-team-router-decision"),
      }),
    );
    const commitTeamApprovalDecision = vi.fn(
      async (_taskId, _approvalId, _decision, persistOutcome) => {
        await persistOutcome({
          outcomeAuditRecordId: auditRecordId("audit-team-router-outcome"),
        });
        return codingProjection(workerTaskId, "running");
      },
    );
    const coding = {
      submit: vi.fn(async (_intent: unknown) => codingProjection(workerTaskId, "running")),
      waitForIdle: vi.fn(async () => idle.promise),
      list: vi.fn(async () => [codingProjection(workerTaskId, "completed")]),
      cancel: vi.fn(),
      observeApproval,
      prepareTeamApprovalDecision,
      commitTeamApprovalDecision,
    };
    const router = new TeamJourneyWorkerRouter({
      persistence: {
        loadDomainGraph: vi.fn(async () => completedGraph(workerTaskId, "file")),
      },
      workspaceContext: { resolve: vi.fn() },
      general: {
        submitFromTrustedContext: vi.fn(),
        waitForIdle: vi.fn(),
        list: vi.fn(),
        cancel: vi.fn(),
      },
      coding,
    });
    const input = await executionInput(router, "coding");
    workerTaskId = input.workerTaskId;
    const approvalRequired = vi.fn(async () => undefined);
    const observer: TeamWorkerExecutionObserver = Object.freeze({ approvalRequired });
    const execution = router.execute(input, new AbortController().signal, observer);
    await vi.waitFor(() =>
      expect(observeApproval).toHaveBeenCalledWith(workerTaskId, expect.any(Function)),
    );

    const stableApprovalId = approvalId("approval-team-router-protected");
    await approvalHandler!({
      approvalId: stableApprovalId,
      policyAuditRecordId: auditRecordId("audit-team-router-policy"),
      requestAuditRecordId: auditRecordId("audit-team-router-request"),
      reason: "The coding operation requires protected approval.",
    });
    expect(approvalRequired).toHaveBeenCalledWith({
      runId: input.runId,
      nodeId: input.nodeId,
      attemptId: input.attemptId,
      approvalId: stableApprovalId,
      policyAuditRecordId: "audit-team-router-policy",
      requestAuditRecordId: "audit-team-router-request",
      reason: "The coding operation requires protected approval.",
    });

    await expect(
      router.prepareApprovalDecision(input.attemptId, stableApprovalId, "approved"),
    ).resolves.toEqual({ decisionAuditRecordId: "audit-team-router-decision" });
    const persistOutcome = vi.fn(async () => undefined);
    await router.commitApprovalDecision(
      input.attemptId,
      stableApprovalId,
      "approved",
      persistOutcome,
    );
    expect(prepareTeamApprovalDecision).toHaveBeenCalledWith(
      workerTaskId,
      stableApprovalId,
      "approved",
    );
    expect(commitTeamApprovalDecision).toHaveBeenCalledWith(
      workerTaskId,
      stableApprovalId,
      "approved",
      persistOutcome,
    );
    expect(persistOutcome).toHaveBeenCalledWith({
      outcomeAuditRecordId: "audit-team-router-outcome",
    });

    idle.resolve();
    await expect(execution).resolves.toMatchObject({ status: "completed" });
    expect(stopObserving).toHaveBeenCalledTimes(1);
  });

  it("holds a completed journey at the persisted pause boundary until resume", async () => {
    let workerTaskId = taskId("task-team-router-unresolved-pause");
    const idle = deferred();
    const general = {
      submitFromTrustedContext: vi.fn(async () => generalProjection(workerTaskId, "running")),
      waitForIdle: vi.fn(async () => idle.promise),
      list: vi.fn(async () => [generalProjection(workerTaskId, "completed")]),
      cancel: vi.fn(),
    };
    const router = new TeamJourneyWorkerRouter({
      persistence: {
        loadDomainGraph: vi.fn(async () => completedGraph(workerTaskId, "document")),
      },
      workspaceContext: {
        resolve: vi.fn(async () => ({
          rootPath: "/private/tmp/actestra-team-router-pause",
          displayName: "Paused Actestra Team workspace",
        })),
      },
      general,
      coding: {
        submit: vi.fn(),
        waitForIdle: vi.fn(),
        list: vi.fn(),
        cancel: vi.fn(),
      },
    });
    const input = await executionInput(router, "general");
    workerTaskId = input.workerTaskId;
    let settled = false;
    const execution = router.execute(input, new AbortController().signal).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(general.submitFromTrustedContext).toHaveBeenCalledTimes(1));

    await router.pause(input.attemptId, "Pause before accepting the completed journey result.");
    idle.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    await router.resume(input.attemptId);
    await expect(execution).resolves.toMatchObject({ status: "completed" });
  });

  it("cancels the exact active coding journey without exposing coding authority", async () => {
    let workerTaskId = taskId("task-team-router-unresolved-cancel");
    const idle = deferred();
    const cancel = vi.fn(async () => codingProjection(workerTaskId, "cancelled"));
    const coding = {
      submit: vi.fn(async (_intent: unknown) => codingProjection(workerTaskId, "running")),
      waitForIdle: vi.fn(async () => idle.promise),
      list: vi.fn(async () => [codingProjection(workerTaskId, "completed")]),
      cancel,
    };
    const router = new TeamJourneyWorkerRouter({
      persistence: { loadDomainGraph: vi.fn() },
      workspaceContext: { resolve: vi.fn() },
      general: {
        submitFromTrustedContext: vi.fn(),
        waitForIdle: vi.fn(),
        list: vi.fn(),
        cancel: vi.fn(),
      },
      coding,
    });
    const input = await executionInput(router, "coding");
    workerTaskId = input.workerTaskId;
    const binding = deriveTeamJourneyBinding(input);
    const controller = new AbortController();
    const execution = router.execute(input, controller.signal);
    await vi.waitFor(() => expect(coding.submit).toHaveBeenCalledTimes(1));

    controller.abort();
    await router.cancel(input.attemptId, "Cancel the bounded coding Team node.");
    idle.resolve();

    await expect(execution).rejects.toMatchObject({
      name: "TeamJourneyWorkerRouterError",
      code: "journey-failed",
    });
    expect(cancel).toHaveBeenCalledWith(
      binding.nativeConversationId,
      workerTaskId,
      "Cancel the bounded coding Team node.",
    );
  });
});
