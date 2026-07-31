// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AionUiGeneralWorkIntent,
  AionUiGeneralWorkProjection,
} from "../../apps/desktop/src/compatibility/aionui";
import { instant, taskId, workspaceGrantId } from "../../apps/desktop/src/core";
import {
  AionUiScheduleService,
  SystemAionUiScheduleClock,
  SystemAionUiScheduleTimers,
} from "../../apps/desktop/src/main/compatibility/aionuiScheduleService";
import type { AionUiGeneralWorkNativeContext } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkNativeContext";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";

const testDirectories: string[] = [];
const persistences: Array<ReturnType<typeof openSqliteCorePersistence>> = [];

class FakeScheduleClock {
  constructor(private currentMs: number) {}

  nowMs(): number {
    return this.currentMs;
  }

  set(nowMs: number): void {
    this.currentMs = nowMs;
  }
}

class FakeScheduleTimers {
  private readonly entries = new Map<
    string,
    {
      readonly handle: object;
      readonly atMs: number;
      readonly callback: () => Promise<void>;
    }
  >();

  schedule(jobId: string, atMs: number, callback: () => Promise<void>): object {
    const handle = Object.freeze({ jobId, atMs });
    this.entries.set(jobId, { handle, atMs, callback });
    return handle;
  }

  cancel(handle: object): void {
    for (const [jobId, entry] of this.entries) {
      if (entry.handle === handle) {
        this.entries.delete(jobId);
      }
    }
  }

  pending(): readonly { readonly jobId: string; readonly atMs: number }[] {
    return [...this.entries].map(([jobId, { atMs }]) => ({ jobId, atMs }));
  }

  async fire(jobId: string): Promise<void> {
    const entry = this.entries.get(jobId);
    if (entry === undefined) {
      throw new Error(`No pending schedule timer for ${jobId}`);
    }
    this.entries.delete(jobId);
    await entry.callback();
  }
}

class FakeScheduleJourney {
  private sequence = 0;
  private released = true;
  private idle: Promise<void> = Promise.resolve();
  private releaseIdle: (() => void) | undefined;
  private readonly projections = new Map<string, AionUiGeneralWorkProjection>();

  constructor(
    private readonly clock: FakeScheduleClock,
    private readonly terminalStatus: "completed" | "failed" | "cancelled" = "completed",
    private readonly terminalIncidentCode?: string,
  ) {}

  readonly submitFromTrustedContext = vi.fn(
    async (
      intent: AionUiGeneralWorkIntent,
      _context: AionUiGeneralWorkNativeContext,
    ): Promise<AionUiGeneralWorkProjection> => {
      const now = instant(new Date(this.clock.nowMs()).toISOString());
      const projection = Object.freeze({
        contractVersion: 1 as const,
        taskId: taskId(`task-schedule-service-${String(++this.sequence)}`),
        status: "blocked" as const,
        title: intent.prompt,
        canCancel: true,
        createdAt: now,
        updatedAt: now,
        artifacts: Object.freeze([]),
      });
      this.projections.set(intent.nativeConversationId, projection);
      return projection;
    },
  );

  readonly waitForIdle = vi.fn(async (): Promise<void> => {
    await this.idle;
    this.released = true;
  });

  readonly list = vi.fn(
    async (nativeConversationId: string): Promise<readonly AionUiGeneralWorkProjection[]> => {
      const projection = this.projections.get(nativeConversationId);
      if (projection === undefined) {
        return Object.freeze([]);
      }
      return Object.freeze([
        this.released
          ? Object.freeze({
              ...projection,
              status: this.terminalStatus,
              ...(this.terminalIncidentCode === undefined
                ? {}
                : { incidentCode: this.terminalIncidentCode }),
              canCancel: false,
              updatedAt: instant(new Date(this.clock.nowMs()).toISOString()),
            })
          : projection,
      ]);
    },
  );

  readonly close = vi.fn(async (): Promise<void> => {});

  hold(): () => void {
    this.released = false;
    this.idle = new Promise<void>((resolve) => {
      this.releaseIdle = resolve;
    });
    return (): void => {
      this.releaseIdle?.();
      this.releaseIdle = undefined;
    };
  }
}

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "actestra-aionui-schedule-service-test-"),
  );
  testDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  vi.useRealTimers();
  for (const persistence of persistences.splice(0)) {
    await persistence.close().catch(() => undefined);
  }
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-schedule-service-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AionUiScheduleService", () => {
  it("segments a production timer beyond the Node maximum delay", async () => {
    vi.useFakeTimers();
    const startedAtMs = Date.parse("2026-07-31T09:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const clock = new SystemAionUiScheduleClock();
    const timers = new SystemAionUiScheduleTimers(clock);
    const callback = vi.fn(async (): Promise<void> => {});
    const maximumNodeDelayMs = 2_147_483_647;
    const targetAtMs = startedAtMs + maximumNodeDelayMs + 5_000;

    timers.schedule("schedule-system-timer", targetAtMs, callback);
    await vi.advanceTimersByTimeAsync(maximumNodeDelayMs);

    expect(callback).not.toHaveBeenCalled();
    expect(clock.nowMs()).toBe(startedAtMs + maximumNodeDelayMs);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("creates one canonical schedule authority and projects only the native cron DTO", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const workspaceRoot = path.join(directory, "workspace");
    const workspaceAlias = path.join(directory, "workspace-alias");
    fs.mkdirSync(workspaceRoot);
    fs.symlinkSync(workspaceRoot, workspaceAlias, "dir");
    const nowMs = Date.parse("2026-07-31T09:00:00.000Z");
    const timers = new FakeScheduleTimers();
    const nativeResolve = vi.fn(async () => ({
      rootPath: workspaceAlias,
      displayName: "Persisted native schedule workspace",
    }));
    const service = new AionUiScheduleService({
      persistence,
      clock: new FakeScheduleClock(nowMs),
      timers,
      nativeContext: { resolve: nativeResolve },
      journey: {
        submitFromTrustedContext: vi.fn(),
        list: vi.fn(),
        waitForIdle: vi.fn(),
        close: vi.fn(),
      },
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));
    const input = {
      name: "Daily Actestra result",
      description: "Bounded existing conversation schedule",
      schedule: {
        kind: "every" as const,
        everyMs: 60_000,
        description: "Every minute",
      },
      prompt: "/actestra Produce the scheduled Actestra artifact.",
      conversation_id: "conversation-native-schedule-create-1",
      conversation_title: "Native schedule conversation",
      created_by: "user" as const,
      execution_mode: "existing" as const,
      queue_enabled: false as const,
    };

    const created = await service.create(input);
    const duplicate = await service.create(input);

    expect(duplicate).toEqual(created);
    expect(nativeResolve).toHaveBeenCalledTimes(1);
    expect(nativeResolve).toHaveBeenCalledWith(input.conversation_id);
    expect(created).toMatchObject({
      name: input.name,
      enabled: true,
      target: {
        payload: { kind: "message", text: input.prompt },
        execution_mode: "existing",
      },
      metadata: {
        conversation_id: input.conversation_id,
        conversation_title: input.conversation_title,
        agent_type: "actestra-general-worker",
        created_by: "user",
        agent_config: {
          name: "Actestra General Worker",
          is_preset: true,
        },
      },
      state: {
        next_run_at_ms: nowMs + 60_000,
        run_count: 0,
        retry_count: 0,
        max_retries: 0,
        queue_enabled: false,
      },
    });
    const serializedProjection = JSON.stringify(created);
    expect(serializedProjection).not.toContain(workspaceRoot);
    expect(serializedProjection).not.toContain("grant-");
    const stored = await persistence.getAionUiSchedule(created.id);
    expect(stored).not.toBeNull();
    const grant = await persistence.getActiveWorkspaceGrant(stored!.workspaceId);
    expect(grant).toMatchObject({
      grantId: stored!.workspaceGrantId,
      rootPath: fs.realpathSync(workspaceRoot),
      displayName: "Persisted native schedule workspace",
      state: "active",
    });
    await expect(service.list(input.conversation_id)).resolves.toEqual([created]);
    await expect(service.get(created.id)).resolves.toEqual(created);
    expect(timers.pending()).toEqual([{ jobId: created.id, atMs: nowMs + 60_000 }]);
    expect(events).toEqual([{ type: "cron.job-created", payload: created }]);
  });

  it("rejects a native context rooted at the filesystem boundary", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const nowMs = Date.parse("2026-07-31T09:00:00.000Z");
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock: new FakeScheduleClock(nowMs),
      timers,
      nativeContext: {
        resolve: vi.fn(async () => ({
          rootPath: path.parse(directory).root,
          displayName: "Filesystem root",
        })),
      },
      journey: {
        submitFromTrustedContext: vi.fn(),
        list: vi.fn(),
        waitForIdle: vi.fn(),
        close: vi.fn(),
      },
    });

    await expect(
      service.create({
        name: "Rejected root schedule",
        schedule: {
          kind: "every",
          everyMs: 60_000,
          description: "Every minute",
        },
        prompt: "/actestra Produce a bounded artifact.",
        conversation_id: "conversation-native-schedule-root",
        created_by: "user",
        execution_mode: "existing",
        queue_enabled: false,
      }),
    ).rejects.toThrow("filesystem root");
    await expect(persistence.listAionUiSchedules({ limit: 100 })).resolves.toEqual([]);
    expect(timers.pending()).toEqual([]);
  });

  it("recovers exactly one main-owned timer for a future enabled job", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("future", directory);
    await persistence.registerAionUiSchedule(registration);
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock: new FakeScheduleClock(registration.job.createdAtMs),
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Startup recovery must not reread native context");
        }),
      },
      journey: {
        submitFromTrustedContext: vi.fn(),
        list: vi.fn(),
        waitForIdle: vi.fn(),
        close: vi.fn(),
      },
    });
    await service.recover();

    expect(timers.pending()).toEqual([
      {
        jobId: registration.job.id,
        atMs: registration.job.nextRunAtMs,
      },
    ]);
  });

  it("updates, pauses, resumes, and removes only future schedule state", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("mutations", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Existing schedule mutations must not reread native context");
        }),
      },
      journey: {
        submitFromTrustedContext: vi.fn(),
        list: vi.fn(),
        waitForIdle: vi.fn(),
        close: vi.fn(),
      },
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));
    await service.recover();

    const paused = await service.update(registration.job.id, {
      name: "Paused Actestra schedule",
      enabled: false,
    });
    expect(paused).toMatchObject({
      name: "Paused Actestra schedule",
      enabled: false,
      state: { run_count: 0 },
    });
    expect(paused.state).not.toHaveProperty("next_run_at_ms");
    expect(timers.pending()).toEqual([]);

    const resumed = await service.update(registration.job.id, {
      enabled: true,
      schedule: {
        kind: "every",
        everyMs: 120_000,
        description: "Every two minutes",
      },
      message: "/actestra Produce the revised scheduled artifact.",
      execution_mode: "existing",
      max_retries: 0,
      queue_enabled: false,
    });
    expect(resumed).toMatchObject({
      enabled: true,
      schedule: { kind: "every", everyMs: 120_000 },
      target: {
        payload: { text: "/actestra Produce the revised scheduled artifact." },
        execution_mode: "existing",
      },
      state: { next_run_at_ms: registration.job.createdAtMs + 120_000 },
    });
    expect(timers.pending()).toEqual([
      { jobId: registration.job.id, atMs: registration.job.createdAtMs + 120_000 },
    ]);
    await expect(service.history(registration.job.id)).resolves.toEqual([]);

    await service.remove(registration.job.id);

    await expect(service.get(registration.job.id)).resolves.toBeNull();
    expect(timers.pending()).toEqual([]);
    expect(events).toEqual([
      { type: "cron.job-updated", payload: paused },
      { type: "cron.job-updated", payload: resumed },
      { type: "cron.job-removed", payload: { job_id: registration.job.id } },
    ]);
  });

  it("runs a manual job through its persisted grant and stores the General Work terminal state", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const base = createAionUiScheduleRegistration("run-now", directory);
    const registration = {
      ...base,
      job: {
        ...base.job,
        schedule: {
          kind: "cron" as const,
          expr: "",
          description: "Run manually",
        },
        nextRunAtMs: undefined,
      },
    };
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Run Now must use the persisted schedule grant");
        }),
      },
      journey,
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    await expect(service.runNow(registration.job.id)).resolves.toEqual({
      conversation_id: registration.job.nativeConversationId,
    });
    await service.waitForIdle();

    expect(journey.submitFromTrustedContext).toHaveBeenCalledWith(
      {
        contractVersion: 1,
        nativeConversationId: registration.job.nativeConversationId,
        submissionId: `${registration.job.id}:run:1`,
        prompt: "Produce scheduled artifact run-now.",
        journeyKind: "prompt-artifact",
      },
      {
        rootPath: registration.workspaceGrant.rootPath,
        displayName: registration.workspaceGrant.displayName,
      },
    );
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      enabled: true,
      lastRunAtMs: clock.nowMs(),
      lastStatus: "ok",
      runSequence: 1,
      runCount: 1,
    });
    const completed = await persistence.getAionUiSchedule(registration.job.id);
    expect(completed).not.toHaveProperty("nextRunAtMs");
    expect(completed).not.toHaveProperty("activeClaim");
    await expect(service.history(registration.job.id)).resolves.toEqual([
      {
        id: registration.job.nativeConversationId,
        name: registration.job.nativeConversationTitle,
        extra: { cron_job_id: registration.job.id },
        created_at: registration.job.createdAtMs,
        updated_at: clock.nowMs(),
      },
    ]);
    expect(events).toEqual([
      {
        type: "cron.job-executed",
        payload: { job_id: registration.job.id, status: "ok" },
      },
    ]);
    expect(timers.pending()).toEqual([]);
  });

  it.each([
    {
      terminalStatus: "failed" as const,
      incidentCode: "worker-crashed",
      scheduleStatus: "error" as const,
    },
    {
      terminalStatus: "cancelled" as const,
      incidentCode: "user-cancelled",
      scheduleStatus: "skipped" as const,
    },
  ])(
    "maps a $terminalStatus General Work terminal state into schedule authority",
    async ({ terminalStatus, incidentCode, scheduleStatus }) => {
      const directory = createTestDirectory();
      const persistence = openSqliteCorePersistence(directory);
      persistences.push(persistence);
      const registration = createAionUiScheduleRegistration(
        `terminal-${terminalStatus}`,
        directory,
      );
      await persistence.registerAionUiSchedule(registration);
      const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
      const journey = new FakeScheduleJourney(clock, terminalStatus, incidentCode);
      const service = new AionUiScheduleService({
        persistence,
        clock,
        timers: new FakeScheduleTimers(),
        nativeContext: {
          resolve: vi.fn(async () => {
            throw new Error("Scheduled runs must use persisted grants");
          }),
        },
        journey,
      });
      const events: unknown[] = [];
      service.subscribe((event) => events.push(event));

      await service.runNow(registration.job.id);
      await service.waitForIdle();

      await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
        lastRunAtMs: clock.nowMs(),
        lastStatus: scheduleStatus,
        lastIncidentCode: incidentCode,
        runSequence: 1,
        runCount: 1,
      });
      expect(events).toEqual([
        {
          type: "cron.job-executed",
          payload: {
            job_id: registration.job.id,
            status: scheduleStatus,
            error: incidentCode,
          },
        },
      ]);
    },
  );

  it("refuses a duplicate claim while the first scheduled run is active", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("duplicate-claim", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const journey = new FakeScheduleJourney(clock);
    const release = journey.hold();
    let claimSequence = 0;
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Scheduled runs must not reread native context");
        }),
      },
      journey,
      newClaimId: () => `claim-schedule-service-${String(++claimSequence)}`,
    });

    await service.runNow(registration.job.id);
    await expect(service.runNow(registration.job.id)).rejects.toMatchObject({
      code: "schedule-busy",
    });
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      activeClaim: "claim-schedule-service-1",
      runSequence: 1,
      runCount: 0,
    });

    release();
    await service.waitForIdle();
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      lastStatus: "ok",
      runSequence: 1,
      runCount: 1,
    });
    expect(journey.submitFromTrustedContext).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["revoked", "workspace-grant-unavailable"],
    ["mismatched", "workspace-grant-mismatch"],
  ] as const)(
    "fails closed before the journey when the persisted grant is %s",
    async (mode, code) => {
      const directory = createTestDirectory();
      const persistence = openSqliteCorePersistence(directory);
      persistences.push(persistence);
      const registration = createAionUiScheduleRegistration(`grant-${mode}`, directory);
      await persistence.registerAionUiSchedule(registration);
      const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
      if (mode === "revoked") {
        await persistence.persistWorkspaceGrant({
          ...registration.workspaceGrant,
          state: "revoked",
          updatedAt: instant(new Date(clock.nowMs()).toISOString()),
        });
      } else {
        vi.spyOn(persistence, "getActiveWorkspaceGrant").mockResolvedValue({
          ...registration.workspaceGrant,
          grantId: workspaceGrantId("grant-schedule-service-mismatch"),
        });
      }
      const journey = new FakeScheduleJourney(clock);
      const service = new AionUiScheduleService({
        persistence,
        clock,
        timers: new FakeScheduleTimers(),
        nativeContext: {
          resolve: vi.fn(async () => {
            throw new Error("Scheduled runs must not reread native context");
          }),
        },
        journey,
      });

      await service.runNow(registration.job.id);
      await service.waitForIdle();

      expect(journey.submitFromTrustedContext).not.toHaveBeenCalled();
      await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
        lastStatus: "error",
        lastIncidentCode: code,
        runSequence: 1,
        runCount: 1,
      });
    },
  );

  it("skips missed work, terminalizes stale claims, and leaves disabled or manual jobs idle", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const missed = createAionUiScheduleRegistration("missed", directory);
    const future = createAionUiScheduleRegistration("later", directory);
    const disabled = createAionUiScheduleRegistration("disabled", directory);
    const interrupted = createAionUiScheduleRegistration("interrupted", directory);
    const manualBase = createAionUiScheduleRegistration("manual", directory);
    const manual = {
      ...manualBase,
      job: {
        ...manualBase.job,
        schedule: {
          kind: "cron" as const,
          expr: "",
          description: "Run manually",
        },
        nextRunAtMs: undefined,
      },
    };
    for (const registration of [missed, future, disabled, interrupted, manual]) {
      await persistence.registerAionUiSchedule(registration);
    }
    const recoveredAtMs = missed.job.createdAtMs + 120_000;
    await persistence.updateAionUiSchedule({
      jobId: future.job.id,
      updatedAtMs: future.job.createdAtMs + 1,
      nextRunAtMs: recoveredAtMs + 60_000,
    });
    await persistence.updateAionUiSchedule({
      jobId: disabled.job.id,
      updatedAtMs: disabled.job.createdAtMs + 1,
      enabled: false,
      nextRunAtMs: null,
    });
    await persistence.claimAionUiScheduleRun({
      jobId: interrupted.job.id,
      claim: "claim-before-restart",
      claimedAtMs: interrupted.job.createdAtMs + 30_000,
    });
    const timers = new FakeScheduleTimers();
    const nativeResolve = vi.fn(async () => {
      throw new Error("Schedule recovery must use persisted grants");
    });
    const service = new AionUiScheduleService({
      persistence,
      clock: new FakeScheduleClock(recoveredAtMs),
      timers,
      nativeContext: { resolve: nativeResolve },
      journey: {
        submitFromTrustedContext: vi.fn(),
        list: vi.fn(),
        waitForIdle: vi.fn(),
        close: vi.fn(),
      },
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    await service.recover();

    await expect(persistence.getAionUiSchedule(missed.job.id)).resolves.toMatchObject({
      lastRunAtMs: recoveredAtMs,
      lastStatus: "missed",
      lastIncidentCode: "missed-occurrence",
      nextRunAtMs: recoveredAtMs + 60_000,
      runCount: 0,
    });
    const recoveredInterrupted = await persistence.getAionUiSchedule(interrupted.job.id);
    expect(recoveredInterrupted).toMatchObject({
      lastRunAtMs: recoveredAtMs,
      lastStatus: "error",
      lastIncidentCode: "interrupted",
      nextRunAtMs: recoveredAtMs + 60_000,
      runSequence: 1,
      runCount: 1,
    });
    expect(recoveredInterrupted).not.toHaveProperty("activeClaim");
    expect(recoveredInterrupted).not.toHaveProperty("activeClaimedAtMs");
    expect(timers.pending()).toHaveLength(3);
    expect(timers.pending()).toEqual(
      expect.arrayContaining([
        { jobId: missed.job.id, atMs: recoveredAtMs + 60_000 },
        { jobId: future.job.id, atMs: recoveredAtMs + 60_000 },
        { jobId: interrupted.job.id, atMs: recoveredAtMs + 60_000 },
      ]),
    );
    expect(timers.pending()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: disabled.job.id }),
        expect.objectContaining({ jobId: manual.job.id }),
      ]),
    );
    expect(nativeResolve).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "cron.job-executed",
        payload: {
          job_id: interrupted.job.id,
          status: "error",
          error: "interrupted",
        },
      },
      {
        type: "cron.job-executed",
        payload: {
          job_id: missed.job.id,
          status: "missed",
          error: "missed-occurrence",
        },
      },
    ]);
  });

  it("fires an automatic one-time occurrence and disables it after terminal completion", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const base = createAionUiScheduleRegistration("automatic-at", directory);
    const dueAtMs = base.job.createdAtMs + 60_000;
    const registration = {
      ...base,
      job: {
        ...base.job,
        schedule: {
          kind: "at" as const,
          atMs: dueAtMs,
          description: "Run once",
        },
        nextRunAtMs: dueAtMs,
      },
    };
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Automatic runs must use the persisted schedule grant");
        }),
      },
      journey,
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));
    await service.recover();
    clock.set(dueAtMs);

    await timers.fire(registration.job.id);
    await service.waitForIdle();

    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      enabled: false,
      lastRunAtMs: dueAtMs,
      lastStatus: "ok",
      runSequence: 1,
      runCount: 1,
    });
    const completed = await persistence.getAionUiSchedule(registration.job.id);
    expect(completed).not.toHaveProperty("nextRunAtMs");
    expect(timers.pending()).toEqual([]);
    expect(journey.submitFromTrustedContext).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        type: "cron.job-executed",
        payload: { job_id: registration.job.id, status: "ok" },
      },
    ]);
  });

  it("does not retry terminal persistence as a second claim completion", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("terminal-persistence", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const completeClaim = vi
      .spyOn(persistence, "completeAionUiScheduleRun")
      .mockImplementation(async () => ({
        status: "claim-mismatch",
        job: (await persistence.getAionUiSchedule(registration.job.id))!,
      }));
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Scheduled runs must use persisted grants");
        }),
      },
      journey: new FakeScheduleJourney(clock),
    });

    await service.runNow(registration.job.id);
    await service.waitForIdle();

    expect(completeClaim).toHaveBeenCalledTimes(1);
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      activeClaim: expect.any(String),
      runSequence: 1,
      runCount: 0,
    });
  });

  it.each([
    {
      label: "every",
      schedule: {
        kind: "every" as const,
        everyMs: 60_000,
        description: "Every minute",
      },
      completionOffsetMs: 90_000,
      expectedNextOffsetMs: 150_000,
    },
    {
      label: "cron",
      schedule: {
        kind: "cron" as const,
        expr: "* * * * *",
        tz: "UTC",
        description: "Every minute",
      },
      completionOffsetMs: 90_000,
      expectedNextOffsetMs: 120_000,
    },
  ])("advances a $label schedule strictly after its completion instant", async (scenario) => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const base = createAionUiScheduleRegistration(`advance-${scenario.label}`, directory);
    const dueAtMs = base.job.createdAtMs + 60_000;
    const registration = {
      ...base,
      job: {
        ...base.job,
        schedule: scenario.schedule,
        nextRunAtMs: dueAtMs,
      },
    };
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const release = journey.hold();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Automatic runs must use persisted grants");
        }),
      },
      journey,
    });
    await service.recover();
    clock.set(dueAtMs);
    await timers.fire(registration.job.id);
    clock.set(registration.job.createdAtMs + scenario.completionOffsetMs);

    release();
    await service.waitForIdle();

    const expectedNextRunAtMs = registration.job.createdAtMs + scenario.expectedNextOffsetMs;
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      lastRunAtMs: clock.nowMs(),
      nextRunAtMs: expectedNextRunAtMs,
      lastStatus: "ok",
      runCount: 1,
    });
    expect(expectedNextRunAtMs).toBeGreaterThan(clock.nowMs());
    expect(timers.pending()).toEqual([{ jobId: registration.job.id, atMs: expectedNextRunAtMs }]);
  });

  it("closes timers and the journey before rejecting later schedule operations", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("close", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const release = journey.hold();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Closing a schedule must not reread native context");
        }),
      },
      journey,
    });
    await service.recover();
    expect(timers.pending()).toHaveLength(1);
    await service.runNow(registration.job.id);

    let closed = false;
    const closing = service.close("application-shutdown").then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(journey.close).toHaveBeenCalledWith("application-shutdown"));
    expect(closed).toBe(false);
    expect(timers.pending()).toEqual([]);

    release();
    await closing;

    expect(timers.pending()).toEqual([]);
    await expect(service.runNow(registration.job.id)).rejects.toMatchObject({
      code: "schedule-closed",
    });
    await expect(service.list()).rejects.toMatchObject({ code: "schedule-closed" });
    await expect(service.get(registration.job.id)).rejects.toMatchObject({
      code: "schedule-closed",
    });
    await expect(service.create({})).rejects.toMatchObject({ code: "schedule-closed" });
    await expect(service.update(registration.job.id, {})).rejects.toMatchObject({
      code: "schedule-closed",
    });
    await expect(service.remove(registration.job.id)).rejects.toMatchObject({
      code: "schedule-closed",
    });
    await expect(service.history(registration.job.id)).rejects.toMatchObject({
      code: "schedule-closed",
    });
    expect(() => service.subscribe(() => undefined)).toThrowError(
      expect.objectContaining({ code: "schedule-closed" }),
    );
  });

  it("still awaits an active run when the journey close request fails", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("close-failure", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const journey = new FakeScheduleJourney(clock);
    const release = journey.hold();
    journey.close.mockRejectedValueOnce(new Error("journey close failed"));
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Closing a schedule must not reread native context");
        }),
      },
      journey,
    });
    await service.runNow(registration.job.id);

    let outcome: "pending" | "resolved" | "rejected" = "pending";
    const closing = service.close("application-shutdown").then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      },
    );
    await vi.waitFor(() => expect(journey.close).toHaveBeenCalledTimes(1));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(outcome).toBe("pending");

    release();
    await closing;
    expect(outcome).toBe("rejected");
  });

  it("does not claim an automatic occurrence queued as the service closes", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("close-timer-race", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Automatic runs must use persisted grants");
        }),
      },
      journey,
    });
    await service.recover();
    clock.set(registration.job.nextRunAtMs!);

    const firing = timers.fire(registration.job.id);
    await service.close("application-shutdown");
    await firing;
    await service.waitForIdle();

    expect(journey.submitFromTrustedContext).not.toHaveBeenCalled();
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      runSequence: 0,
      runCount: 0,
    });
    const stable = await persistence.getAionUiSchedule(registration.job.id);
    expect(stable).not.toHaveProperty("activeClaim");
  });

  it("skips an occurrence missed during sleep when main resumes", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("resume-missed", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Schedule resume must use persisted grants");
        }),
      },
      journey,
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));
    await service.recover();
    clock.set(registration.job.createdAtMs + 120_000);

    await service.resume();

    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      lastRunAtMs: clock.nowMs(),
      lastStatus: "missed",
      lastIncidentCode: "missed-occurrence",
      nextRunAtMs: clock.nowMs() + 60_000,
      runCount: 0,
    });
    expect(timers.pending()).toEqual([
      { jobId: registration.job.id, atMs: clock.nowMs() + 60_000 },
    ]);
    expect(journey.submitFromTrustedContext).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "cron.job-executed",
        payload: {
          job_id: registration.job.id,
          status: "missed",
          error: "missed-occurrence",
        },
      },
    ]);
  });
});
