// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AionUiCodingJourneyProjection } from "../../apps/desktop/src/compatibility/aionui";
import { instant, taskId } from "../../apps/desktop/src/core";
import { AionUiCodingJourneyServiceError } from "../../apps/desktop/src/main/compatibility/aionuiCodingJourneyService";

const servicePath = path.resolve(
  import.meta.dirname,
  "../../apps/desktop/src/main/compatibility/aionuiCodingJourneyBridgeService.ts",
);
const projection = Object.freeze({
  contractVersion: 1,
  taskId: taskId(`task-aionui-coding-${"a".repeat(64)}`),
  status: "running",
  stage: "working",
  title: "Update the fixture.",
  canCancel: true,
  createdAt: instant("2026-08-04T07:10:00.000Z"),
  updatedAt: instant("2026-08-04T07:10:00.000Z"),
  messages: Object.freeze([]),
  tools: Object.freeze([]),
  artifacts: Object.freeze([]),
}) satisfies AionUiCodingJourneyProjection;

describe("AionUiCodingJourneyBridgeService", () => {
  it("validates the five closed renderer intents and revalidates bounded projections", async () => {
    expect(fs.existsSync(servicePath)).toBe(true);
    if (!fs.existsSync(servicePath)) return;
    const { AionUiCodingJourneyBridgeService } =
      await import("../../apps/desktop/src/main/compatibility/aionuiCodingJourneyBridgeService");
    const journey = {
      submit: vi.fn(async () => projection),
      list: vi.fn(async () => [projection]),
      cancel: vi.fn(async () => ({
        ...projection,
        status: "cancelled" as const,
        stage: "cancelled" as const,
        canCancel: false,
      })),
      decideApproval: vi.fn(async () => projection),
      decidePublish: vi.fn(async () => projection),
    };
    const bridge = new AionUiCodingJourneyBridgeService(journey);
    const nativeConversationId = "native-coding-bridge-conversation";
    const approvalId = `approval-coding-${"b".repeat(64)}`;

    await expect(
      bridge.submit({
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-coding-bridge-1",
        prompt: "Update the fixture.",
      }),
    ).resolves.toEqual({ status: "ok", projection });
    await expect(
      bridge.list({ contractVersion: 1, nativeConversationId, limit: 20 }),
    ).resolves.toEqual({ status: "ok", projections: [projection] });
    await expect(
      bridge.cancel({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        reason: "Stopped from ACP SendBox.",
      }),
    ).resolves.toMatchObject({
      status: "ok",
      projection: { status: "cancelled", stage: "cancelled" },
    });
    await expect(
      bridge.decideApproval({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId,
        decision: "approved",
      }),
    ).resolves.toEqual({ status: "ok", projection });
    await expect(
      bridge.decidePublish({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId,
        decision: "denied",
      }),
    ).resolves.toEqual({ status: "ok", projection });

    await expect(
      bridge.submit({
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-coding-bridge-2",
        prompt: "Do not accept renderer authority.",
        repositoryRoot: "/private/repository",
      }),
    ).resolves.toEqual({ status: "rejected", code: "invalid-request" });
    await expect(
      bridge.decideApproval({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId,
        decision: "approved",
        actorId: "renderer-actor",
      }),
    ).resolves.toEqual({ status: "rejected", code: "invalid-request" });
    expect(journey.submit).toHaveBeenCalledTimes(1);
    expect(journey.decideApproval).toHaveBeenCalledTimes(1);
  });

  it("maps internal failures to fixed codes without returning private details", async () => {
    expect(fs.existsSync(servicePath)).toBe(true);
    if (!fs.existsSync(servicePath)) return;
    const { AionUiCodingJourneyBridgeService } =
      await import("../../apps/desktop/src/main/compatibility/aionuiCodingJourneyBridgeService");
    const failedJourney = {
      submit: vi.fn(async () => {
        throw new AionUiCodingJourneyServiceError("agent-unavailable", "private runner path");
      }),
      list: vi.fn(async () => {
        const error = new Error("private database path");
        error.name = "PersistenceUtilityError";
        throw error;
      }),
      cancel: vi.fn(async () => {
        throw new AionUiCodingJourneyServiceError("task-not-owned", "private conversation hash");
      }),
      decideApproval: vi.fn(async () => {
        throw new AionUiCodingJourneyServiceError(
          "approval-not-pending",
          "private approval snapshot",
        );
      }),
      decidePublish: vi.fn(async () => {
        throw new Error("private patch digest");
      }),
    };
    const bridge = new AionUiCodingJourneyBridgeService(failedJourney);
    const nativeConversationId = "native-coding-bridge-failure";
    const approvalId = `approval-coding-${"c".repeat(64)}`;

    const results = await Promise.all([
      bridge.submit({
        contractVersion: 1,
        nativeConversationId,
        submissionId: "submission-coding-bridge-failure",
        prompt: "Fail closed.",
      }),
      bridge.list({ contractVersion: 1, nativeConversationId, limit: 20 }),
      bridge.cancel({ contractVersion: 1, nativeConversationId, taskId: projection.taskId }),
      bridge.decideApproval({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId,
        decision: "approved",
      }),
      bridge.decidePublish({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId,
        decision: "approved",
      }),
    ]);
    expect(results).toEqual([
      { status: "rejected", code: "agent-unavailable" },
      { status: "rejected", code: "persistence-unavailable" },
      { status: "rejected", code: "task-not-owned" },
      { status: "rejected", code: "approval-not-pending" },
      { status: "rejected", code: "execution-failed" },
    ]);
    expect(JSON.stringify(results)).not.toMatch(/private|runner|database|digest/u);
  });
});
