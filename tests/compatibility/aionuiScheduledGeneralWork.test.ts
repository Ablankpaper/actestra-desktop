import { describe, expect, it } from "vitest";
import { workspaceId, workspaceGrantId } from "../../apps/desktop/src/core";
import { ACTESTRA_GENERAL_WORKER_AGENT_TYPE } from "../../apps/desktop/src/compatibility/aionui/scheduleContract";
import {
  AIONUI_SCHEDULE_CONTRACT_VERSION,
  AionUiScheduledGeneralWorkError,
  assertAionUiScheduleCreateInput,
  assertAionUiScheduleJob,
  assertAionUiScheduleUpdateInput,
  calculateAionUiScheduleNextRun,
  deriveAionUiScheduleIdentity,
  toNativeCronJob,
  type AionUiScheduleCreateInput,
  type AionUiScheduleJob,
} from "../../apps/desktop/src/compatibility/aionui/scheduledGeneralWork";

const NOW_MS = Date.parse("2026-07-31T00:00:00.000Z");

function createInput(
  overrides: Partial<AionUiScheduleCreateInput> = {},
): AionUiScheduleCreateInput {
  return {
    name: "Daily Actestra summary",
    description: "Create the bounded artifact for the existing conversation.",
    schedule: {
      kind: "cron",
      expr: "0 9 * * *",
      tz: "Asia/Shanghai",
      description: "Every day at 09:00",
    },
    prompt: "/actestra Produce the scheduled Actestra artifact.",
    conversation_id: "conversation-native-schedule-1",
    conversation_title: "Scheduled Actestra work",
    created_by: "user",
    execution_mode: "existing",
    queue_enabled: false,
    ...overrides,
  };
}

function createJob(overrides: Partial<AionUiScheduleJob> = {}): AionUiScheduleJob {
  const input = createInput();
  const identity = deriveAionUiScheduleIdentity(input);
  return {
    contractVersion: AIONUI_SCHEDULE_CONTRACT_VERSION,
    id: identity.id,
    conversationHash: identity.conversationHash,
    nativeConversationId: input.conversation_id,
    nativeConversationTitle: input.conversation_title,
    workspaceId: workspaceId("workspace-aionui-schedule-1"),
    workspaceGrantId: workspaceGrantId("grant-aionui-schedule-1"),
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    schedule: input.schedule,
    enabled: true,
    nextRunAtMs: Date.parse("2026-08-01T01:00:00.000Z"),
    runSequence: 0,
    runCount: 0,
    retryCount: 0,
    maxRetries: 0,
    queueEnabled: false,
    createdAtMs: NOW_MS,
    updatedAtMs: NOW_MS,
    ...overrides,
  };
}

describe("Actestra-owned scheduled General Work contract", () => {
  it("accepts only an existing-conversation prompt-artifact create input", () => {
    expect(() => assertAionUiScheduleCreateInput(createInput(), NOW_MS)).not.toThrow();

    for (const rejected of [
      { ...createInput(), created_by: "agent" },
      { ...createInput(), execution_mode: "new_conversation" },
      { ...createInput(), prompt: "/actestra file private.txt" },
      { ...createInput(), prompt: "/actestra research competitors" },
      { ...createInput(), prompt: "/actestra write a launch brief" },
      { ...createInput(), prompt: "/actestra office a launch brief" },
      { ...createInput(), queue_enabled: true },
      { ...createInput(), agent_config: { name: "renderer-agent", workspace: "/tmp/private" } },
      { ...createInput(), workspace: "/tmp/private" },
      { ...createInput(), provider: "renderer-provider" },
      { ...createInput(), credential: "renderer-secret" },
    ]) {
      expect(() => assertAionUiScheduleCreateInput(rejected, NOW_MS)).toThrow(
        AionUiScheduledGeneralWorkError,
      );
    }
  });

  it("rejects unknown fields, control characters, and invalid string bounds", () => {
    for (const rejected of [
      { ...createInput(), unexpected: true },
      { ...createInput(), name: "unsafe\nname" },
      { ...createInput(), name: "界".repeat(86) },
      { ...createInput(), description: "d".repeat(2 * 1024 + 1) },
      { ...createInput(), prompt: `/actestra ${"p".repeat(16 * 1024)}` },
      { ...createInput(), conversation_id: "c".repeat(257) },
      {
        ...createInput(),
        schedule: { kind: "cron", expr: "* * * * *", description: "d".repeat(513) },
      },
    ]) {
      expect(() => assertAionUiScheduleCreateInput(rejected, NOW_MS)).toThrow(
        AionUiScheduledGeneralWorkError,
      );
    }
  });

  it("validates at, every, manual, cron, and time-zone bounds", () => {
    const tenYearsLater = Date.UTC(2036, 6, 31, 0, 0, 0, 0);
    for (const schedule of [
      { kind: "at", atMs: NOW_MS + 1, description: "once" },
      { kind: "at", atMs: tenYearsLater, description: "ten years" },
      { kind: "every", everyMs: 60_000, description: "minute" },
      { kind: "every", everyMs: 31_536_000_000, description: "year" },
      { kind: "cron", expr: "", description: "manual" },
      { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai", description: "daily" },
    ] as const) {
      expect(() =>
        assertAionUiScheduleCreateInput(createInput({ schedule }), NOW_MS),
      ).not.toThrow();
    }

    for (const schedule of [
      { kind: "at", atMs: NOW_MS, description: "past" },
      { kind: "at", atMs: tenYearsLater + 1, description: "too far" },
      { kind: "every", everyMs: 59_999, description: "too short" },
      { kind: "every", everyMs: 31_536_000_001, description: "too long" },
      { kind: "cron", expr: "* * * *", description: "four fields" },
      { kind: "cron", expr: "* * * * * *", description: "six fields" },
      { kind: "cron", expr: "61 * * * *", description: "invalid minute" },
      { kind: "cron", expr: "0 9 * * *", tz: "Not/AZone", description: "bad zone" },
    ]) {
      expect(() =>
        assertAionUiScheduleCreateInput(createInput({ schedule } as never), NOW_MS),
      ).toThrow(AionUiScheduledGeneralWorkError);
    }
  });

  it("calculates occurrences strictly after the reference instant", () => {
    expect(
      calculateAionUiScheduleNextRun({ kind: "at", atMs: NOW_MS + 1, description: "once" }, NOW_MS),
    ).toBe(NOW_MS + 1);
    expect(
      calculateAionUiScheduleNextRun({ kind: "at", atMs: NOW_MS, description: "past" }, NOW_MS),
    ).toBeUndefined();
    expect(
      calculateAionUiScheduleNextRun(
        { kind: "every", everyMs: 60_000, description: "minute" },
        1_000,
      ),
    ).toBe(61_000);
    expect(
      calculateAionUiScheduleNextRun({ kind: "cron", expr: "", description: "manual" }, NOW_MS),
    ).toBeUndefined();
    expect(
      calculateAionUiScheduleNextRun(
        {
          kind: "cron",
          expr: "0 9 * * *",
          tz: "Asia/Shanghai",
          description: "daily",
        },
        Date.parse("2026-07-31T01:00:00.000Z"),
      ),
    ).toBe(Date.parse("2026-08-01T01:00:00.000Z"));
  });

  it("derives a stable identity from canonical bounded content", () => {
    const first = deriveAionUiScheduleIdentity(createInput());
    const duplicate = deriveAionUiScheduleIdentity(createInput());
    const changed = deriveAionUiScheduleIdentity(
      createInput({ prompt: "/actestra Produce a different scheduled artifact." }),
    );

    expect(first).toEqual(duplicate);
    expect(first.id).toMatch(/^schedule-aionui-[a-f0-9]{64}$/u);
    expect(first.conversationHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(changed.id).not.toBe(first.id);
    expect(changed.conversationHash).toBe(first.conversationHash);
  });

  it("accepts only immutable-authority update fields and fixed policy values", () => {
    expect(() =>
      assertAionUiScheduleUpdateInput(
        {
          name: "Updated schedule",
          enabled: false,
          schedule: { kind: "cron", expr: "", description: "manual" },
          message: "/actestra Produce the updated scheduled artifact.",
          execution_mode: "existing",
          conversation_title: "Updated title",
          max_retries: 0,
          queue_enabled: false,
        },
        NOW_MS,
      ),
    ).not.toThrow();

    for (const rejected of [
      { conversation_id: "other" },
      { execution_mode: "new_conversation" },
      { max_retries: 1 },
      { queue_enabled: true },
      { agent_config: { name: "other" } },
      { message: "/actestra office changed" },
      { unexpected: true },
      {},
    ]) {
      expect(() => assertAionUiScheduleUpdateInput(rejected, NOW_MS)).toThrow(
        AionUiScheduledGeneralWorkError,
      );
    }
  });

  it("validates durable records and exposes only the native compatibility projection", () => {
    const job = createJob({
      lastRunAtMs: NOW_MS,
      lastStatus: "error",
      lastIncidentCode: "worker-failed",
      activeClaim: "claim-private-1",
      activeClaimedAtMs: NOW_MS,
      runSequence: 2,
      runCount: 1,
    });
    expect(() => assertAionUiScheduleJob(job)).not.toThrow();

    const projected = toNativeCronJob(job);
    expect(projected).toEqual({
      id: job.id,
      name: job.name,
      description: job.description,
      enabled: true,
      schedule: job.schedule,
      target: {
        payload: { kind: "message", text: job.prompt },
        execution_mode: "existing",
      },
      metadata: {
        conversation_id: job.nativeConversationId,
        conversation_title: job.nativeConversationTitle,
        agent_type: ACTESTRA_GENERAL_WORKER_AGENT_TYPE,
        created_by: "user",
        created_at: job.createdAtMs,
        updated_at: job.updatedAtMs,
        agent_config: {
          name: "Actestra General Worker",
          is_preset: true,
        },
      },
      state: {
        next_run_at_ms: job.nextRunAtMs,
        last_run_at_ms: job.lastRunAtMs,
        last_status: "error",
        last_error: "worker-failed",
        run_count: 1,
        retry_count: 0,
        max_retries: 0,
        queue_enabled: false,
      },
    });
    const encoded = JSON.stringify(projected);
    for (const forbidden of [
      "workspaceId",
      "workspaceGrantId",
      "activeClaim",
      "runSequence",
      "rootPath",
      "credential",
      "cli_path",
      "model_id",
      "provider_id",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("rejects inconsistent claim pairs and counter or terminal bounds", () => {
    for (const rejected of [
      createJob({ activeClaim: "claim-without-time" }),
      createJob({ activeClaimedAtMs: NOW_MS }),
      createJob({ runCount: 2, runSequence: 1 }),
      createJob({ retryCount: 1 as 0 }),
      createJob({ queueEnabled: true as false }),
      createJob({ lastIncidentCode: "x".repeat(129) }),
      createJob({ updatedAtMs: NOW_MS - 1 }),
      createJob({ conversationHash: "b".repeat(64) }),
    ]) {
      expect(() => assertAionUiScheduleJob(rejected)).toThrow(AionUiScheduledGeneralWorkError);
    }
  });
});
