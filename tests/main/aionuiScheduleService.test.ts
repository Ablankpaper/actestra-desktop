// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AionUiGeneralWorkIntent,
  AionUiGeneralWorkProjection,
} from "../../apps/desktop/src/compatibility/aionui";
import { parseAionUiGeneralWorkCommand } from "../../apps/desktop/src/compatibility/aionui";
import { instant, taskId, workspaceGrantId } from "../../apps/desktop/src/core";
import { AionUiGeneralWorkJourneyService } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService";
import {
  AionUiScheduleService,
  SystemAionUiScheduleClock,
  SystemAionUiScheduleTimers,
} from "../../apps/desktop/src/main/compatibility/aionuiScheduleService";
import type { AionUiGeneralWorkNativeContext } from "../../apps/desktop/src/main/compatibility/aionuiGeneralWorkNativeContext";
import { createScopedNativeToolPlatform } from "../../apps/desktop/src/main/privileged/scopedNativeToolPlatform";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
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

  readonly interruptPreparedSubmission = vi.fn(
    async (): Promise<AionUiGeneralWorkProjection | null> => null,
  );

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
        interruptPreparedSubmission: vi.fn(async () => null),
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

  it("arms the durable timer when registration resolves an idempotent persistence race", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("registration-race", directory);
    vi.spyOn(persistence, "registerAionUiSchedule").mockResolvedValueOnce({
      status: "duplicate",
      job: registration.job,
    });
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock: new FakeScheduleClock(registration.job.createdAtMs),
      timers,
      nativeContext: {
        resolve: vi.fn(async () => ({
          rootPath: registration.workspaceGrant.rootPath,
          displayName: registration.workspaceGrant.displayName,
        })),
      },
      journey: new FakeScheduleJourney(new FakeScheduleClock(registration.job.createdAtMs)),
    });
    const events: unknown[] = [];
    service.subscribe((event) => events.push(event));

    await service.create({
      name: registration.job.name,
      description: registration.job.description,
      schedule: registration.job.schedule,
      prompt: registration.job.prompt,
      conversation_id: registration.job.nativeConversationId,
      conversation_title: registration.job.nativeConversationTitle,
      created_by: "user",
      execution_mode: "existing",
      queue_enabled: false,
    });

    expect(timers.pending()).toEqual([
      { jobId: registration.job.id, atMs: registration.job.nextRunAtMs },
    ]);
    expect(events).toEqual([]);
  });

  it("reads the authoritative creation time only after its per-job queue is available", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const workspaceRoot = path.join(directory, "serialized-create-workspace");
    fs.mkdirSync(workspaceRoot);
    const startedAtMs = Date.parse("2026-07-31T09:00:00.000Z");
    const clock = new FakeScheduleClock(startedAtMs);
    let releaseContext!: () => void;
    const contextGate = new Promise<void>((resolve) => {
      releaseContext = resolve;
    });
    let markContextEntered!: () => void;
    const contextEntered = new Promise<void>((resolve) => {
      markContextEntered = resolve;
    });
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          markContextEntered();
          await contextGate;
          return { rootPath: workspaceRoot, displayName: "Serialized create workspace" };
        },
      },
      journey: new FakeScheduleJourney(clock),
    });
    const input = {
      name: "Serialized schedule creation",
      schedule: {
        kind: "every" as const,
        everyMs: 60_000,
        description: "Every minute",
      },
      prompt: "/actestra Produce the serialized schedule artifact.",
      conversation_id: "conversation-native-serialized-schedule-create",
      created_by: "user" as const,
      execution_mode: "existing" as const,
      queue_enabled: false as const,
    };

    const first = service.create(input);
    await contextEntered;
    clock.set(startedAtMs + 30_000);
    const duplicate = service.create(input);
    clock.set(startedAtMs + 61_000);
    releaseContext();
    await Promise.all([first, duplicate]);

    await expect(persistence.listAionUiSchedules({ limit: 100 })).resolves.toEqual([
      expect.objectContaining({
        createdAtMs: startedAtMs,
        lastRunAtMs: startedAtMs + 61_000,
        lastStatus: "missed",
        lastIncidentCode: "missed-occurrence",
        nextRunAtMs: startedAtMs + 121_000,
      }),
    ]);
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
        interruptPreparedSubmission: vi.fn(async () => null),
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
        interruptPreparedSubmission: vi.fn(async () => null),
        waitForIdle: vi.fn(),
        close: vi.fn(),
      },
    });
    await expect(service.recover()).resolves.toBeUndefined();

    expect(timers.pending()).toEqual([
      {
        jobId: registration.job.id,
        atMs: registration.job.nextRunAtMs,
      },
    ]);
  });

  it("terminalizes an interrupted prepared scheduled task before generic recovery", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("prepared-recovery", directory);
    await persistence.registerAionUiSchedule(registration);
    const claimedAtMs = registration.job.createdAtMs + 1_000;
    const claimed = await persistence.claimAionUiScheduleRun({
      jobId: registration.job.id,
      claim: "schedule-prepared-recovery-claim",
      claimedAtMs,
    });
    if (claimed.status !== "claimed") {
      throw new Error("Schedule recovery test could not create its active claim");
    }
    const parsed = parseAionUiGeneralWorkCommand(registration.job.prompt);
    if (parsed === null) {
      throw new Error("Schedule recovery fixture has no General Work prompt");
    }
    const journeyClock = new DeterministicAgentClock(instant(new Date(claimedAtMs).toISOString()));
    const journey = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools: createScopedNativeToolPlatform({ persistence, clock: journeyClock }),
      clock: journeyClock,
      nativeContext: {
        resolve: async () => {
          throw new Error("Scheduled recovery must use the persisted grant");
        },
      },
      launchWorker: async () => {
        throw new Error("Injected crash after scheduled task registration");
      },
    });
    const submissionId = `${registration.job.id}:run:${String(claimed.job.runSequence)}`;
    await expect(
      journey.submitFromTrustedContext(
        {
          contractVersion: 1,
          nativeConversationId: registration.job.nativeConversationId,
          submissionId,
          prompt: parsed.prompt,
          journeyKind: "prompt-artifact",
        },
        {
          rootPath: registration.workspaceGrant.rootPath,
          displayName: registration.workspaceGrant.displayName,
        },
      ),
    ).rejects.toThrow("Injected crash");
    const clock = new FakeScheduleClock(claimedAtMs + 1_000);
    vi.spyOn(journey, "interruptPreparedSubmission").mockRejectedValueOnce(
      new Error("Injected prepared-schedule interruption failure"),
    );
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: async () => {
          throw new Error("Schedule recovery must not reread native context");
        },
      },
      journey,
    });

    await expect(service.recover()).resolves.toBeUndefined();

    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "failed" })]);
    expect(graph.sessions).toEqual([expect.objectContaining({ state: "cancelled" })]);
    expect(graph.workers).toEqual([expect.objectContaining({ state: "stopped" })]);
    await expect(journey.recoverPrepared()).resolves.toEqual({
      attempted: 0,
      started: 0,
      failed: 0,
    });
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      lastStatus: "error",
      lastIncidentCode: "interrupted",
      runSequence: 1,
      runCount: 1,
    });
    expect(timers.pending()).toEqual([
      {
        jobId: registration.job.id,
        atMs: clock.nowMs() + 60_000,
      },
    ]);
  });

  it("isolates a persistent prepared-schedule interruption and never replays it", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration(
      "persistent-prepared-recovery",
      directory,
    );
    await persistence.registerAionUiSchedule(registration);
    const claimedAtMs = registration.job.createdAtMs + 1_000;
    const claimed = await persistence.claimAionUiScheduleRun({
      jobId: registration.job.id,
      claim: "schedule-persistent-recovery-claim",
      claimedAtMs,
    });
    if (claimed.status !== "claimed") {
      throw new Error("Schedule recovery test could not create its active claim");
    }
    const parsed = parseAionUiGeneralWorkCommand(registration.job.prompt);
    if (parsed === null) {
      throw new Error("Schedule recovery fixture has no General Work prompt");
    }
    const journeyClock = new DeterministicAgentClock(instant(new Date(claimedAtMs).toISOString()));
    const launchWorker = vi.fn(async () => {
      throw new Error("Injected crash after scheduled task registration");
    });
    const journey = new AionUiGeneralWorkJourneyService({
      persistence,
      nativeTools: createScopedNativeToolPlatform({ persistence, clock: journeyClock }),
      clock: journeyClock,
      nativeContext: {
        resolve: async () => {
          throw new Error("Scheduled recovery must use the persisted grant");
        },
      },
      launchWorker,
    });
    const submissionId = `${registration.job.id}:run:${String(claimed.job.runSequence)}`;
    await expect(
      journey.submitFromTrustedContext(
        {
          contractVersion: 1,
          nativeConversationId: registration.job.nativeConversationId,
          submissionId,
          prompt: parsed.prompt,
          journeyKind: "prompt-artifact",
        },
        {
          rootPath: registration.workspaceGrant.rootPath,
          displayName: registration.workspaceGrant.displayName,
        },
      ),
    ).rejects.toThrow("Injected crash");
    const interrupt = vi
      .spyOn(journey, "interruptPreparedSubmission")
      .mockRejectedValue(new Error("Persistent prepared-schedule interruption failure"));
    const clock = new FakeScheduleClock(claimedAtMs + 1_000);
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: async () => {
          throw new Error("Schedule recovery must not reread native context");
        },
      },
      journey,
    });

    await expect(service.recover()).resolves.toBeUndefined();

    expect(interrupt).toHaveBeenCalledTimes(2);
    const graph = await persistence.loadDomainGraph();
    expect(graph.tasks).toEqual([expect.objectContaining({ state: "ready" })]);
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      lastStatus: "error",
      lastIncidentCode: "interrupted",
      runSequence: 1,
      runCount: 1,
    });
    expect(timers.pending()).toEqual([]);
    await expect(service.runNow(registration.job.id)).rejects.toMatchObject({
      code: "schedule-execution-failed",
    });

    await expect(journey.recoverPrepared()).resolves.toEqual({
      attempted: 1,
      started: 0,
      failed: 1,
    });
    expect(launchWorker).toHaveBeenCalledTimes(1);

    const restartedTimers = new FakeScheduleTimers();
    const restartedService = new AionUiScheduleService({
      persistence,
      clock,
      timers: restartedTimers,
      nativeContext: {
        resolve: async () => {
          throw new Error("Schedule recovery must not reread native context");
        },
      },
      journey,
    });
    await expect(restartedService.recover()).resolves.toBeUndefined();
    expect(interrupt).toHaveBeenCalledTimes(5);
    expect(restartedTimers.pending()).toEqual([]);
    await expect(restartedService.runNow(registration.job.id)).rejects.toMatchObject({
      code: "schedule-execution-failed",
    });
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
        interruptPreparedSubmission: vi.fn(async () => null),
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

  it("reads the authoritative update time only after its per-job queue is available", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("serialized-update-clock", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          throw new Error("Existing schedule updates must not reread native context");
        },
      },
      journey: new FakeScheduleJourney(clock),
    });
    const originalUpdate = persistence.updateAionUiSchedule.bind(persistence);
    let releaseFirstUpdate!: () => void;
    const firstUpdateGate = new Promise<void>((resolve) => {
      releaseFirstUpdate = resolve;
    });
    let markFirstUpdateEntered!: () => void;
    const firstUpdateEntered = new Promise<void>((resolve) => {
      markFirstUpdateEntered = resolve;
    });
    let updateCalls = 0;
    vi.spyOn(persistence, "updateAionUiSchedule").mockImplementation(async (input) => {
      updateCalls += 1;
      if (updateCalls === 1) {
        markFirstUpdateEntered();
        await firstUpdateGate;
      }
      return originalUpdate(input);
    });

    const first = service.update(registration.job.id, { name: "First serialized update" });
    await firstUpdateEntered;
    clock.set(registration.job.createdAtMs + 2_000);
    const second = service.update(registration.job.id, { description: "Queued update" });
    clock.set(registration.job.createdAtMs + 3_000);
    releaseFirstUpdate();
    await first;
    const secondResult = await second;

    expect(secondResult.metadata.updated_at).toBe(registration.job.createdAtMs + 3_000);
  });

  it("reads the authoritative deletion time only after its per-job queue is available", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("serialized-delete-clock", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          throw new Error("Existing schedule deletion must not reread native context");
        },
      },
      journey: new FakeScheduleJourney(clock),
    });
    const originalUpdate = persistence.updateAionUiSchedule.bind(persistence);
    let releaseUpdate!: () => void;
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let markUpdateEntered!: () => void;
    const updateEntered = new Promise<void>((resolve) => {
      markUpdateEntered = resolve;
    });
    vi.spyOn(persistence, "updateAionUiSchedule").mockImplementation(async (input) => {
      markUpdateEntered();
      await updateGate;
      return originalUpdate(input);
    });
    const deleteSchedule = vi.spyOn(persistence, "deleteAionUiSchedule");

    const update = service.update(registration.job.id, { name: "Mutation before deletion" });
    await updateEntered;
    clock.set(registration.job.createdAtMs + 2_000);
    const remove = service.remove(registration.job.id);
    clock.set(registration.job.createdAtMs + 3_000);
    releaseUpdate();
    await Promise.all([update, remove]);

    expect(deleteSchedule).toHaveBeenCalledWith({
      jobId: registration.job.id,
      deletedAtMs: registration.job.createdAtMs + 3_000,
    });
  });

  it("serializes resume recalculation behind an in-flight job mutation", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("serialized-resume", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.nextRunAtMs! + 1_000);
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          throw new Error("Schedule resume must not reread native context");
        },
      },
      journey: new FakeScheduleJourney(clock),
    });
    const originalUpdate = persistence.updateAionUiSchedule.bind(persistence);
    let releaseMutation!: () => void;
    const mutationGate = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    let markMutationEntered!: () => void;
    const mutationEntered = new Promise<void>((resolve) => {
      markMutationEntered = resolve;
    });
    let updateCalls = 0;
    const updateSpy = vi
      .spyOn(persistence, "updateAionUiSchedule")
      .mockImplementation(async (input) => {
        updateCalls += 1;
        if (updateCalls === 1) {
          markMutationEntered();
          await mutationGate;
        }
        return originalUpdate(input);
      });

    const mutation = service.update(registration.job.id, { name: "Serialized mutation" });
    await mutationEntered;
    const resume = service.resume();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(updateSpy).toHaveBeenCalledTimes(1);
    releaseMutation();
    await Promise.all([mutation, resume]);
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
    expect(journey.waitForIdle).toHaveBeenCalledWith(taskId("task-schedule-service-1"));
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

  it("keeps repeated runs and restart history on the same durable native conversation", async () => {
    const directory = createTestDirectory();
    const firstPersistence = openSqliteCorePersistence(directory);
    persistences.push(firstPersistence);
    const registration = createAionUiScheduleRegistration("durable-history", directory);
    await firstPersistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const firstService = new AionUiScheduleService({
      persistence: firstPersistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          throw new Error("Schedule history must use its persisted conversation");
        },
      },
      journey: new FakeScheduleJourney(clock),
    });

    await firstService.runNow(registration.job.id);
    await firstService.waitForIdle();
    clock.set(registration.job.createdAtMs + 2_000);
    await firstService.runNow(registration.job.id);
    await firstService.waitForIdle();
    await expect(firstPersistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      runSequence: 2,
      runCount: 2,
      lastRunAtMs: clock.nowMs(),
    });
    await firstPersistence.close();

    const reopened = openSqliteCorePersistence(directory);
    persistences.push(reopened);
    const reopenedService = new AionUiScheduleService({
      persistence: reopened,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          throw new Error("Schedule history must not reread native context");
        },
      },
      journey: new FakeScheduleJourney(clock),
    });
    await expect(reopenedService.history(registration.job.id)).resolves.toEqual([
      {
        id: registration.job.nativeConversationId,
        name: registration.job.nativeConversationTitle,
        extra: { cron_job_id: registration.job.id },
        created_at: registration.job.createdAtMs,
        updated_at: clock.nowMs(),
      },
    ]);
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

  it("serializes terminal completion so a concurrent pause remains authoritative", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("completion-pause-race", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const journey = new FakeScheduleJourney(clock);
    const releaseJourney = journey.hold();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers: new FakeScheduleTimers(),
      nativeContext: {
        resolve: async () => {
          throw new Error("Active scheduled runs must use persisted grants");
        },
      },
      journey,
    });
    const originalComplete = persistence.completeAionUiScheduleRun.bind(persistence);
    let markCompletionEntered!: () => void;
    const completionEntered = new Promise<void>((resolve) => {
      markCompletionEntered = resolve;
    });
    let releaseCompletion!: () => void;
    const completionGate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    vi.spyOn(persistence, "completeAionUiScheduleRun").mockImplementation(async (input) => {
      markCompletionEntered();
      await completionGate;
      return originalComplete(input);
    });

    await service.runNow(registration.job.id);
    releaseJourney();
    await completionEntered;
    const pause = service.update(registration.job.id, { enabled: false });
    let pauseSettled = false;
    const pauseSettlement = pause.finally(() => {
      pauseSettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(pauseSettled).toBe(false);
    releaseCompletion();
    await Promise.all([pause, pauseSettlement]);
    await service.waitForIdle();
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      enabled: false,
      lastStatus: "ok",
      runSequence: 1,
      runCount: 1,
    });
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
        interruptPreparedSubmission: vi.fn(async () => null),
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
    const completeRun = vi.spyOn(persistence, "completeAionUiScheduleRun");
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
    expect(completeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        nextRunAtMs: null,
        enabled: false,
      }),
    );
    expect(timers.pending()).toEqual([]);
    expect(journey.submitFromTrustedContext).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      {
        type: "cron.job-executed",
        payload: { job_id: registration.job.id, status: "ok" },
      },
    ]);
  });

  it("retains an automatic pre-claim failure instead of silently dropping the occurrence", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("automatic-claim-failure", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const failure = new Error("Injected automatic schedule claim failure");
    vi.spyOn(persistence, "claimAionUiScheduleRun").mockRejectedValueOnce(failure);
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
    await service.recover();
    clock.set(registration.job.nextRunAtMs!);

    await timers.fire(registration.job.id);

    await expect(service.waitForIdle()).rejects.toBe(failure);
    expect(journey.submitFromTrustedContext).not.toHaveBeenCalled();
    expect(timers.pending()).toEqual([]);
    await expect(persistence.getAionUiSchedule(registration.job.id)).resolves.toMatchObject({
      runSequence: 0,
      runCount: 0,
    });
    const stable = await persistence.getAionUiSchedule(registration.job.id);
    expect(stable).not.toHaveProperty("activeClaim");
  });

  it("re-arms an automatic occurrence when a stale timer fires before its due instant", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("automatic-stale-timer", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const journey = new FakeScheduleJourney(clock);
    const claim = vi.spyOn(persistence, "claimAionUiScheduleRun");
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
    await service.recover();

    await timers.fire(registration.job.id);
    await service.waitForIdle();

    expect(claim).not.toHaveBeenCalled();
    expect(journey.submitFromTrustedContext).not.toHaveBeenCalled();
    expect(timers.pending()).toEqual([
      {
        jobId: registration.job.id,
        atMs: registration.job.nextRunAtMs,
      },
    ]);
  });

  it("keeps an occurrence exactly at now runnable during an unrelated mutation", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("due-mutation", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs);
    const timers = new FakeScheduleTimers();
    const service = new AionUiScheduleService({
      persistence,
      clock,
      timers,
      nativeContext: {
        resolve: vi.fn(async () => {
          throw new Error("Schedule mutation must use persisted authority");
        }),
      },
      journey: new FakeScheduleJourney(clock),
    });
    await service.recover();
    const dueAtMs = registration.job.nextRunAtMs!;
    clock.set(dueAtMs);

    await service.update(registration.job.id, { name: "Due schedule mutation" });

    const stable = await persistence.getAionUiSchedule(registration.job.id);
    expect(stable).toMatchObject({
      name: "Due schedule mutation",
      nextRunAtMs: dueAtMs,
      runSequence: 0,
      runCount: 0,
    });
    expect(stable).not.toHaveProperty("lastStatus");
    expect(timers.pending()).toEqual([{ jobId: registration.job.id, atMs: dueAtMs }]);
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(completeClaim).toHaveBeenCalledTimes(1);
    await expect(service.waitForIdle()).rejects.toMatchObject({
      code: "schedule-execution-failed",
    });

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

  it("prioritizes the journey close failure when the active run also fails", async () => {
    const directory = createTestDirectory();
    const persistence = openSqliteCorePersistence(directory);
    persistences.push(persistence);
    const registration = createAionUiScheduleRegistration("close-double-failure", directory);
    await persistence.registerAionUiSchedule(registration);
    const clock = new FakeScheduleClock(registration.job.createdAtMs + 1_000);
    const journey = new FakeScheduleJourney(clock);
    const closeFailure = new Error("journey close failed first");
    const runFailure = new Error("active schedule run failed during close");
    journey.close.mockRejectedValueOnce(closeFailure);
    vi.spyOn(persistence, "getActiveWorkspaceGrant").mockRejectedValueOnce(runFailure);
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

    await expect(service.close("application-shutdown")).rejects.toBe(closeFailure);
    expect(journey.close).toHaveBeenCalledExactlyOnceWith("application-shutdown");
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
