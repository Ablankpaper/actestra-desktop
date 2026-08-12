// @vitest-environment node

import { describe, expect, it } from "vitest";

describe("AionUI preserved coding-journey bridge contract", () => {
  it("accepts only the fixed submit, list, cancel, approval, publish, and projection shapes", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertSubmit = compatibility.assertAionUiCodingJourneySubmitRequest as (
      value: unknown,
    ) => void;
    const assertList = compatibility.assertAionUiCodingJourneyListRequest as (
      value: unknown,
    ) => void;
    const assertCancel = compatibility.assertAionUiCodingJourneyCancelRequest as (
      value: unknown,
    ) => void;
    const assertApprovalDecision =
      compatibility.assertAionUiCodingJourneyApprovalDecisionRequest as (value: unknown) => void;
    const assertPublishDecision = compatibility.assertAionUiCodingJourneyPublishDecisionRequest as (
      value: unknown,
    ) => void;
    const assertProjection = compatibility.assertAionUiCodingJourneyProjection as (
      value: unknown,
    ) => void;
    const assertResult = compatibility.assertAionUiCodingJourneyBridgeResult as (
      value: unknown,
    ) => void;

    expect(compatibility.ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL).toBe(
      "actestra:coding-journey:submit",
    );
    expect(compatibility.ACTESTRA_CODING_JOURNEY_LIST_CHANNEL).toBe("actestra:coding-journey:list");
    expect(compatibility.ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL).toBe(
      "actestra:coding-journey:cancel",
    );
    expect(compatibility.ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL).toBe(
      "actestra:coding-journey:approval-decision",
    );
    expect(compatibility.ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL).toBe(
      "actestra:coding-journey:publish-decision",
    );

    const nativeConversationId = "native-coding-conversation";
    const taskId = `task-aionui-coding-${"a".repeat(64)}`;
    const approvalId = `approval-coding-${"b".repeat(64)}`;
    expect(() =>
      assertSubmit({
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-coding-1",
        prompt: "Update the fixture and run the focused test.",
      }),
    ).not.toThrow();
    expect(() => assertList({ contractVersion: 1, nativeConversationId, limit: 20 })).not.toThrow();
    expect(() =>
      assertCancel({
        contractVersion: 1,
        nativeConversationId,
        taskId,
        reason: "Stopped from the retained ACP SendBox.",
      }),
    ).not.toThrow();
    for (const [assertDecision, decision] of [
      [assertApprovalDecision, "approved"],
      [assertPublishDecision, "denied"],
    ] as const) {
      expect(() =>
        assertDecision({
          contractVersion: 1,
          nativeConversationId,
          taskId,
          approvalId,
          decision,
        }),
      ).not.toThrow();
    }

    const projection = {
      contractVersion: 1,
      taskId,
      status: "blocked",
      stage: "publish-approval-required",
      title: "Update the fixture and run the focused test.",
      canCancel: true,
      createdAt: "2026-08-04T06:00:00.000Z",
      updatedAt: "2026-08-04T06:00:01.000Z",
      messages: [
        {
          messageId: "assistant-coding-1",
          text: "The fixture was updated and the focused test passed.",
        },
      ],
      tools: [
        {
          toolCallId: "tool-coding-1",
          title: "Edit fixture",
          kind: "edit",
          status: "completed",
          surface: "diff",
          content: [
            {
              type: "diff",
              path: "src/fixture.ts",
              oldText: "export const value = 1;\n",
              newText: "export const value = 2;\n",
            },
          ],
        },
        {
          toolCallId: "tool-coding-2",
          title: "Run focused test",
          kind: "execute",
          status: "completed",
          surface: "test",
          content: [{ type: "content", text: "1 test passed" }],
        },
      ],
      approval: {
        kind: "publish",
        approvalId,
        toolCallId: "publish-coding-1",
        title: "Save Actestra coding patch",
        operationKind: "execute",
        summary: "Register the approved isolated patch as an Actestra Artifact.",
        snapshot: {
          baseCommit: "c".repeat(40),
          patchByteLength: 123,
          patchSha256: "d".repeat(64),
        },
      },
      artifacts: [],
    } as const;
    expect(() => assertProjection(projection)).not.toThrow();
    expect(() => assertResult({ status: "ok", projection })).not.toThrow();
    expect(() => assertResult({ status: "ok", projections: [projection] })).not.toThrow();
    expect(() =>
      assertResult({
        status: "ok",
        artifactView: {
          baseCommit: "c".repeat(40),
          changedFileCount: 1,
          patchPreview: "diff --git a/fixture.ts b/fixture.ts",
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertResult({
        status: "ok",
        artifactDownload: {
          fileName: "fixture-change.patch",
          content: "diff --git a/fixture.ts b/fixture.ts",
        },
      }),
    ).not.toThrow();
    expect(() => assertResult({ status: "ok", artifactApply: { approvalId } })).not.toThrow();
    expect(() => assertResult({ status: "ok" })).not.toThrow();
    expect(() => assertResult({ status: "rejected", code: "approval-not-pending" })).not.toThrow();
  });

  it("rejects renderer-supplied paths, model/runtime authority, and malformed projections", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertSubmit = compatibility.assertAionUiCodingJourneySubmitRequest as (
      value: unknown,
    ) => void;
    const assertDecision = compatibility.assertAionUiCodingJourneyApprovalDecisionRequest as (
      value: unknown,
    ) => void;
    const assertProjection = compatibility.assertAionUiCodingJourneyProjection as (
      value: unknown,
    ) => void;

    for (const invalid of [
      {
        contractVersion: 1,
        nativeConversationId: "conversation-1",
        submissionId: "submission-1",
        prompt: "Edit the fixture.",
        repositoryRoot: "/private/repository",
      },
      {
        contractVersion: 1,
        nativeConversationId: "conversation-1",
        submissionId: "submission-1",
        prompt: "Edit the fixture.",
        modelId: "renderer-model",
      },
      {
        contractVersion: 1,
        nativeConversationId: "conversation-1",
        submissionId: "submission-1",
        prompt: "Edit the fixture.",
        runnerPath: "/private/runner",
      },
    ]) {
      expect(() => assertSubmit(invalid)).toThrow();
    }

    expect(() =>
      assertDecision({
        contractVersion: 1,
        nativeConversationId: "conversation-1",
        taskId: `task-aionui-coding-${"a".repeat(64)}`,
        approvalId: `approval-coding-${"b".repeat(64)}`,
        decision: "approved",
        actorId: "renderer-user",
      }),
    ).toThrow();

    expect(() =>
      assertProjection({
        contractVersion: 1,
        taskId: `task-aionui-coding-${"a".repeat(64)}`,
        status: "running",
        stage: "working",
        title: "Edit fixture",
        canCancel: true,
        createdAt: "2026-08-04T06:00:00.000Z",
        updatedAt: "2026-08-04T06:00:00.000Z",
        messages: [],
        tools: [],
        artifacts: [],
        worktreeRoot: "/private/worktree",
      }),
    ).toThrow();
  });
});
