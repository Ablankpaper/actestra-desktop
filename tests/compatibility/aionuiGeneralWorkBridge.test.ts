// @vitest-environment node

import { describe, expect, it } from "vitest";

describe("AionUI general-work bridge contract", () => {
  it("accepts only typed submit, list, cancel, preview, and projection results", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertListRequest = compatibility.assertAionUiGeneralWorkListRequest as (
      value: unknown,
    ) => void;
    const assertCancelRequest = compatibility.assertAionUiGeneralWorkCancelRequest as (
      value: unknown,
    ) => void;
    const assertPreviewRequest = compatibility.assertAionUiGeneralWorkPreviewRequest as (
      value: unknown,
    ) => void;
    const assertResult = compatibility.assertAionUiGeneralWorkBridgeResult as (
      value: unknown,
    ) => void;
    const projection = {
      contractVersion: 1,
      taskId: "task-aionui-bridge-1",
      status: "running",
      title: "Run a bounded Actestra task.",
      canCancel: true,
      createdAt: "2026-07-30T07:00:00.000Z",
      updatedAt: "2026-07-30T07:00:00.000Z",
      artifacts: [],
    };
    const preview = {
      contractVersion: 1,
      taskId: projection.taskId,
      artifactId: "artifact-aionui-bridge-1",
      label: "Actestra result",
      mediaType: "text/markdown; charset=utf-8",
      content: "# Actestra result",
    };
    const officePreview = {
      contractVersion: 1,
      taskId: projection.taskId,
      artifactId: "artifact-aionui-office-preview-1",
      label: "Actestra Office document",
      mediaType: "application/vnd.actestra.office-document-preview+json",
      document: {
        contractVersion: 1,
        title: "Quarterly operating brief",
        owner: "Product operations",
        summary: "Record the approved launch decision.",
        sections: [{ heading: "Decision", body: "Ship the verified workflow." }],
      },
    };

    expect(compatibility.ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL).toBe("actestra:general-work:submit");
    expect(compatibility.ACTESTRA_GENERAL_WORK_LIST_CHANNEL).toBe("actestra:general-work:list");
    expect(compatibility.ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL).toBe("actestra:general-work:cancel");
    expect(compatibility.ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL).toBe(
      "actestra:general-work:preview",
    );
    expect(() =>
      assertListRequest({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        limit: 50,
      }),
    ).not.toThrow();
    expect(() =>
      assertCancelRequest({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        taskId: "task-aionui-bridge-1",
        reason: "User stopped the task.",
      }),
    ).not.toThrow();
    expect(() =>
      assertPreviewRequest({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        taskId: projection.taskId,
        artifactId: preview.artifactId,
      }),
    ).not.toThrow();
    expect(() => assertResult({ status: "ok", projection })).not.toThrow();
    expect(() => assertResult({ status: "ok", projections: [projection] })).not.toThrow();
    expect(() => assertResult({ status: "ok", preview })).not.toThrow();
    expect(() => assertResult({ status: "ok", preview: officePreview })).not.toThrow();
    expect(() =>
      assertResult({ status: "rejected", code: "persistence-unavailable" }),
    ).not.toThrow();
  });

  it("rejects authority fields, mixed result shapes, and unbounded requests", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertListRequest = compatibility.assertAionUiGeneralWorkListRequest as (
      value: unknown,
    ) => void;
    const assertCancelRequest = compatibility.assertAionUiGeneralWorkCancelRequest as (
      value: unknown,
    ) => void;
    const assertPreviewRequest = compatibility.assertAionUiGeneralWorkPreviewRequest as (
      value: unknown,
    ) => void;
    const assertResult = compatibility.assertAionUiGeneralWorkBridgeResult as (
      value: unknown,
    ) => void;

    for (const invalid of [
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        limit: 50,
        workspaceRoot: "/private/workspace",
      },
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        limit: 101,
      },
    ]) {
      expect(() => assertListRequest(invalid)).toThrow();
    }
    for (const invalid of [
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        taskId: "task-aionui-bridge-1",
        contentRef: "input-private-1",
      },
      {
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        taskId: "task-aionui-bridge-1",
        reason: "r".repeat(513),
      },
    ]) {
      expect(() => assertCancelRequest(invalid)).toThrow();
    }
    expect(() =>
      assertPreviewRequest({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-1",
        taskId: "task-aionui-bridge-1",
        artifactId: "artifact-aionui-bridge-1",
        outputRef: "tool-output-private-1",
      }),
    ).toThrow();
    expect(() =>
      assertResult({
        status: "ok",
        preview: {
          contractVersion: 1,
          taskId: "task-aionui-bridge-1",
          artifactId: "artifact-aionui-bridge-1",
          label: "Actestra result",
          mediaType: "text/markdown; charset=utf-8",
          content: "# Result",
          outputRef: "tool-output-private-1",
        },
      }),
    ).toThrow();
    expect(() =>
      assertResult({
        status: "ok",
        preview: {
          contractVersion: 1,
          taskId: "task-aionui-bridge-1",
          artifactId: "artifact-aionui-office-preview-1",
          label: "Actestra Office document",
          mediaType: "application/vnd.actestra.office-document-preview+json",
          document: {
            contractVersion: 1,
            title: "Quarterly operating brief",
            owner: "Product operations",
            summary: "Record the approved launch decision.",
            sections: [{ heading: "Decision", body: "Ship the verified workflow." }],
          },
          contentRef: "tool-output-private-1",
        },
      }),
    ).toThrow();
    expect(() =>
      assertResult({
        status: "ok",
        projection: {
          contractVersion: 1,
          taskId: "task-aionui-bridge-1",
          status: "completed",
          title: "Run a bounded Actestra task.",
          canCancel: false,
          createdAt: "2026-07-30T07:00:00.000Z",
          updatedAt: "2026-07-30T07:00:00.000Z",
          artifacts: [],
          workspaceRoot: "/private/workspace",
        },
        projections: [],
      }),
    ).toThrow();
  });
});
