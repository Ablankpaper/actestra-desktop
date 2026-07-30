// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { PersistenceError, artifactId, instant, taskId } from "../../apps/desktop/src/core";
import type {
  AionUiGeneralWorkArtifactPreview,
  AionUiGeneralWorkProjection,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  AionUiGeneralWorkBridgeService,
  type AionUiGeneralWorkJourneyPort,
} from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkBridgeService";
import { AionUiGeneralWorkJourneyServiceError } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService";

const projection = {
  contractVersion: 1,
  taskId: taskId("task-aionui-bridge-service-1"),
  status: "running",
  title: "Run a bounded Actestra task.",
  canCancel: true,
  createdAt: instant("2026-07-30T07:05:00.000Z"),
  updatedAt: instant("2026-07-30T07:05:00.000Z"),
  artifacts: [],
} as const satisfies AionUiGeneralWorkProjection;
const preview = {
  contractVersion: 1,
  taskId: projection.taskId,
  artifactId: artifactId("artifact-aionui-bridge-service-1"),
  label: "Actestra result",
  mediaType: "text/markdown; charset=utf-8",
  content: "# Actestra result",
} as const satisfies AionUiGeneralWorkArtifactPreview;

function createJourney(
  overrides: Partial<AionUiGeneralWorkJourneyPort> = {},
): AionUiGeneralWorkJourneyPort {
  return {
    submit: vi.fn(async () => projection),
    list: vi.fn(async () => [projection]),
    cancel: vi.fn(async () => ({
      ...projection,
      status: "cancelled" as const,
      canCancel: false,
    })),
    preview: vi.fn(async () => preview),
    ...overrides,
  };
}

describe("AionUiGeneralWorkBridgeService", () => {
  it("revalidates typed requests and redacted results", async () => {
    const journey = createJourney();
    const bridge = new AionUiGeneralWorkBridgeService(journey);

    await expect(
      bridge.submit({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        submissionId: "submission-native-bridge-service-1",
        prompt: "Run a bounded Actestra task.",
      }),
    ).resolves.toEqual({ status: "ok", projection });
    await expect(
      bridge.list({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        limit: 50,
      }),
    ).resolves.toEqual({ status: "ok", projections: [projection] });
    await expect(
      bridge.cancel({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        taskId: projection.taskId,
      }),
    ).resolves.toMatchObject({
      status: "ok",
      projection: { status: "cancelled", canCancel: false },
    });
    await expect(
      bridge.preview({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        taskId: projection.taskId,
        artifactId: preview.artifactId,
      }),
    ).resolves.toEqual({
      status: "ok",
      preview,
    });

    await expect(
      bridge.list({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        limit: 50,
        workspaceRoot: "/private/workspace",
      }),
    ).resolves.toEqual({ status: "rejected", code: "invalid-request" });
    expect(journey.list).toHaveBeenCalledTimes(1);
  });

  it("returns fixed error codes without leaking internal messages", async () => {
    const notOwned = new AionUiGeneralWorkBridgeService(
      createJourney({
        cancel: vi.fn(async () => {
          throw new AionUiGeneralWorkJourneyServiceError(
            "task-not-owned",
            "private native identity detail",
          );
        }),
      }),
    );
    const conflict = new AionUiGeneralWorkBridgeService(
      createJourney({
        submit: vi.fn(async () => {
          throw new PersistenceError("content-conflict", "private content digest detail");
        }),
      }),
    );
    const unavailable = new AionUiGeneralWorkBridgeService(
      createJourney({
        list: vi.fn(async () => {
          throw new PersistenceError("closed", "private database path");
        }),
      }),
    );

    await expect(
      notOwned.cancel({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        taskId: projection.taskId,
      }),
    ).resolves.toEqual({ status: "rejected", code: "task-not-owned" });
    await expect(
      conflict.submit({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        submissionId: "submission-native-bridge-service-1",
        prompt: "Run a bounded Actestra task.",
      }),
    ).resolves.toEqual({ status: "rejected", code: "task-conflict" });
    await expect(
      unavailable.list({
        contractVersion: 1,
        nativeConversationId: "conversation-native-bridge-service-1",
        limit: 50,
      }),
    ).resolves.toEqual({ status: "rejected", code: "persistence-unavailable" });
  });
});
