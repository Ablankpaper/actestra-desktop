import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { realpath } from "node:fs/promises";
import { parse } from "node:path";
import {
  AIONUI_SCHEDULE_CONTRACT_VERSION,
  AIONUI_SCHEDULE_MAX_JOBS,
  assertAionUiScheduleCreateInput,
  assertAionUiScheduleUpdateInput,
  calculateAionUiScheduleNextRun,
  deriveAionUiScheduleIdentity,
  hashAionUiGeneralWorkConversation,
  parseAionUiGeneralWorkCommand,
  toNativeCronJob,
  type AionUiScheduleJob,
  type AionUiScheduleCreateInput,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkProjection,
  type AionUiScheduleEvent,
  type AionUiScheduleEventHandler,
  type NativeAionUiCronJob,
} from "../../compatibility/aionui";
import {
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  PersistenceError,
  instant,
  workspaceGrantId,
  workspaceId,
  type ActestraPersistencePort,
} from "../../core";
import type {
  AionUiGeneralWorkNativeContext,
  AionUiGeneralWorkNativeContextPort,
} from "./aionuiGeneralWorkNativeContext";

export interface AionUiScheduleClock {
  nowMs(): number;
}

export class SystemAionUiScheduleClock implements AionUiScheduleClock {
  nowMs(): number {
    return Date.now();
  }
}

export type AionUiScheduleTimerHandle = object;

export interface AionUiScheduleTimerPort {
  schedule(jobId: string, atMs: number, callback: () => Promise<void>): AionUiScheduleTimerHandle;
  cancel(handle: AionUiScheduleTimerHandle): void;
}

const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

interface SystemAionUiScheduleTimerEntry {
  cancelled: boolean;
  timeout: ReturnType<typeof setTimeout> | undefined;
}

export class SystemAionUiScheduleTimers implements AionUiScheduleTimerPort {
  private readonly entries = new WeakMap<
    AionUiScheduleTimerHandle,
    SystemAionUiScheduleTimerEntry
  >();

  constructor(private readonly clock: AionUiScheduleClock = new SystemAionUiScheduleClock()) {}

  schedule(_jobId: string, atMs: number, callback: () => Promise<void>): AionUiScheduleTimerHandle {
    const handle = Object.freeze({});
    const entry: SystemAionUiScheduleTimerEntry = {
      cancelled: false,
      timeout: undefined,
    };
    this.entries.set(handle, entry);

    const arm = (): void => {
      if (entry.cancelled) {
        return;
      }
      const remainingMs = Math.max(0, atMs - this.clock.nowMs());
      entry.timeout = setTimeout(
        (): void => {
          entry.timeout = undefined;
          if (entry.cancelled) {
            return;
          }
          if (this.clock.nowMs() < atMs) {
            arm();
            return;
          }
          this.entries.delete(handle);
          void Promise.resolve()
            .then(callback)
            .catch((): undefined => undefined);
        },
        Math.min(remainingMs, MAX_NODE_TIMER_DELAY_MS),
      );
    };
    arm();
    return handle;
  }

  cancel(handle: AionUiScheduleTimerHandle): void {
    const entry = this.entries.get(handle);
    if (entry === undefined) {
      return;
    }
    entry.cancelled = true;
    if (entry.timeout !== undefined) {
      clearTimeout(entry.timeout);
      entry.timeout = undefined;
    }
    this.entries.delete(handle);
  }
}

export interface AionUiScheduleJourneyPort {
  submitFromTrustedContext(
    intent: AionUiGeneralWorkIntent,
    context: AionUiGeneralWorkNativeContext,
  ): Promise<AionUiGeneralWorkProjection>;
  list(nativeConversationId: string): Promise<readonly AionUiGeneralWorkProjection[]>;
  waitForIdle(): Promise<void>;
  close(reason?: string): Promise<void>;
}

export interface AionUiScheduleServiceConfig {
  readonly persistence: ActestraPersistencePort;
  readonly nativeContext: AionUiGeneralWorkNativeContextPort;
  readonly journey: AionUiScheduleJourneyPort;
  readonly clock: AionUiScheduleClock;
  readonly timers: AionUiScheduleTimerPort;
  readonly newClaimId?: () => string;
}

export interface NativeAionUiScheduleConversation {
  readonly id: string;
  readonly name: string;
  readonly extra: Readonly<{ cron_job_id: string }>;
  readonly created_at: number;
  readonly updated_at: number;
}

export class AionUiScheduleServiceError extends Error {
  constructor(
    readonly code:
      | "schedule-not-found"
      | "schedule-active"
      | "schedule-busy"
      | "schedule-expired"
      | "schedule-execution-failed"
      | "schedule-closed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiScheduleServiceError";
  }
}

const MAX_SCHEDULE_WORKSPACE_DISPLAY_NAME_BYTES = 128;

function boundedWorkspaceDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  let result = "";
  let byteLength = 0;
  for (const character of normalized) {
    const characterBytes = new TextEncoder().encode(character).byteLength;
    if (byteLength + characterBytes > MAX_SCHEDULE_WORKSPACE_DISPLAY_NAME_BYTES) {
      break;
    }
    result += character;
    byteLength += characterBytes;
  }
  if (result.length === 0) {
    throw new Error("AionUI schedule context has no bounded workspace name");
  }
  return result;
}

async function canonicalScheduleContext(
  context: AionUiGeneralWorkNativeContext,
): Promise<AionUiGeneralWorkNativeContext> {
  if (
    typeof context.rootPath !== "string" ||
    context.rootPath.length === 0 ||
    context.rootPath.trim() !== context.rootPath ||
    typeof context.displayName !== "string"
  ) {
    throw new Error("AionUI schedule context has no bounded workspace authority");
  }
  const rootPath = await realpath(context.rootPath);
  if (rootPath === parse(rootPath).root) {
    throw new Error("AionUI schedule workspace root must not be the filesystem root");
  }
  return Object.freeze({
    rootPath,
    displayName: boundedWorkspaceDisplayName(context.displayName),
  });
}

function sameCreatePayload(job: AionUiScheduleJob, input: AionUiScheduleCreateInput): boolean {
  return (
    job.conversationHash === hashAionUiGeneralWorkConversation(input.conversation_id) &&
    job.nativeConversationId === input.conversation_id &&
    job.nativeConversationTitle === input.conversation_title &&
    job.name === input.name &&
    job.description === input.description &&
    job.prompt === input.prompt &&
    isDeepStrictEqual(job.schedule, input.schedule)
  );
}

export class AionUiScheduleService {
  private readonly scheduledTimers = new Map<string, AionUiScheduleTimerHandle>();
  private readonly eventHandlers = new Set<AionUiScheduleEventHandler>();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private readonly activeRuns = new Map<string, Promise<void>>();
  private closed = false;
  private closeOperation: Promise<void> | undefined;

  constructor(private readonly config: AionUiScheduleServiceConfig) {}

  subscribe(handler: AionUiScheduleEventHandler): () => void {
    this.assertOpen();
    this.eventHandlers.add(handler);
    let subscribed = true;
    return (): void => {
      if (subscribed) {
        subscribed = false;
        this.eventHandlers.delete(handler);
      }
    };
  }

  async create(value: unknown): Promise<NativeAionUiCronJob> {
    this.assertOpen();
    const nowMs = this.config.clock.nowMs();
    assertAionUiScheduleCreateInput(value, nowMs);
    const input = Object.freeze({ ...value });
    const identity = deriveAionUiScheduleIdentity(input);
    return this.serialize(identity.id, async () => {
      const existing = await this.config.persistence.getAionUiSchedule(identity.id);
      if (existing !== null) {
        if (!sameCreatePayload(existing, input)) {
          throw new PersistenceError(
            "schedule-conflict",
            "AionUI schedule identity conflicts with durable authority",
          );
        }
        await this.reconcileTimer(existing, nowMs);
        return toNativeCronJob((await this.config.persistence.getAionUiSchedule(identity.id))!);
      }

      const nativeContext = await canonicalScheduleContext(
        await this.config.nativeContext.resolve(input.conversation_id),
      );
      const digest = identity.id.slice("schedule-aionui-".length);
      const scheduleWorkspaceId = workspaceId(`workspace-aionui-schedule-${digest}`);
      const scheduleGrantId = workspaceGrantId(`grant-aionui-schedule-${digest}`);
      const createdAt = instant(new Date(nowMs).toISOString());
      const nextRunAtMs = calculateAionUiScheduleNextRun(input.schedule, nowMs);
      const result = await this.config.persistence.registerAionUiSchedule({
        job: Object.freeze({
          contractVersion: AIONUI_SCHEDULE_CONTRACT_VERSION,
          id: identity.id,
          conversationHash: identity.conversationHash,
          nativeConversationId: input.conversation_id,
          ...(input.conversation_title === undefined
            ? {}
            : { nativeConversationTitle: input.conversation_title }),
          workspaceId: scheduleWorkspaceId,
          workspaceGrantId: scheduleGrantId,
          name: input.name,
          ...(input.description === undefined ? {} : { description: input.description }),
          prompt: input.prompt,
          schedule: input.schedule,
          enabled: true,
          ...(nextRunAtMs === undefined ? {} : { nextRunAtMs }),
          runSequence: 0,
          runCount: 0,
          retryCount: 0,
          maxRetries: 0,
          queueEnabled: false,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        }),
        workspace: Object.freeze({
          id: scheduleWorkspaceId,
          name: nativeContext.displayName,
          state: "active" as const,
          createdAt,
          updatedAt: createdAt,
        }),
        workspaceGrant: Object.freeze({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          grantId: scheduleGrantId,
          workspaceId: scheduleWorkspaceId,
          rootPath: nativeContext.rootPath,
          displayName: nativeContext.displayName,
          state: "active" as const,
          createdAt,
          updatedAt: createdAt,
        }),
      });
      const projection = toNativeCronJob(result.job);
      if (result.status === "stored") {
        if (result.job.nextRunAtMs !== undefined) {
          this.scheduleTimer(result.job.id, result.job.nextRunAtMs);
        }
        this.emit(Object.freeze({ type: "cron.job-created", payload: projection }));
      }
      return projection;
    });
  }

  async list(nativeConversationId?: string): Promise<readonly NativeAionUiCronJob[]> {
    this.assertOpen();
    const jobs = await this.config.persistence.listAionUiSchedules({
      limit: AIONUI_SCHEDULE_MAX_JOBS,
      ...(nativeConversationId === undefined
        ? {}
        : { conversationHash: hashAionUiGeneralWorkConversation(nativeConversationId) }),
    });
    return Object.freeze(jobs.map(toNativeCronJob));
  }

  async get(jobId: string): Promise<NativeAionUiCronJob | null> {
    this.assertOpen();
    const job = await this.config.persistence.getAionUiSchedule(jobId);
    return job === null ? null : toNativeCronJob(job);
  }

  async update(jobId: string, value: unknown): Promise<NativeAionUiCronJob> {
    this.assertOpen();
    const nowMs = this.config.clock.nowMs();
    assertAionUiScheduleUpdateInput(value, nowMs);
    const input = Object.freeze({ ...value });
    return this.serialize(jobId, async () => {
      const existing = await this.requireJob(jobId);
      const nextSchedule = input.schedule ?? existing.schedule;
      const nextEnabled = input.enabled ?? existing.enabled;
      const recalculatesTimer = input.schedule !== undefined || input.enabled !== undefined;
      const nextRunAtMs = !recalculatesTimer
        ? existing.nextRunAtMs
        : nextEnabled
          ? calculateAionUiScheduleNextRun(nextSchedule, nowMs)
          : undefined;
      if (
        recalculatesTimer &&
        nextEnabled &&
        nextSchedule.kind === "at" &&
        nextRunAtMs === undefined
      ) {
        throw new AionUiScheduleServiceError(
          "schedule-expired",
          "The one-time Actestra schedule has no future occurrence",
        );
      }
      const result = await this.config.persistence.updateAionUiSchedule({
        jobId,
        updatedAtMs: nowMs,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.conversation_title === undefined
          ? {}
          : { nativeConversationTitle: input.conversation_title }),
        ...(input.message === undefined ? {} : { prompt: input.message }),
        ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(recalculatesTimer ? { nextRunAtMs: nextRunAtMs ?? null } : {}),
      });
      if (result.status === "not-found") {
        throw new AionUiScheduleServiceError(
          "schedule-not-found",
          "The requested Actestra schedule does not exist",
        );
      }
      const updated = result.job;
      await this.reconcileTimer(updated, nowMs);
      const stable = await this.requireJob(jobId);
      const projection = toNativeCronJob(stable);
      this.emit(Object.freeze({ type: "cron.job-updated", payload: projection }));
      return projection;
    });
  }

  async remove(jobId: string): Promise<void> {
    this.assertOpen();
    const deletedAtMs = this.config.clock.nowMs();
    await this.serialize(jobId, async () => {
      const result = await this.config.persistence.deleteAionUiSchedule({ jobId, deletedAtMs });
      if (result.status === "not-found") {
        throw new AionUiScheduleServiceError(
          "schedule-not-found",
          "The requested Actestra schedule does not exist",
        );
      }
      if (result.status === "active-claim") {
        throw new AionUiScheduleServiceError(
          "schedule-active",
          "An active scheduled run must reach a terminal state before deletion",
        );
      }
      this.clearTimer(jobId);
      this.emit(
        Object.freeze({
          type: "cron.job-removed",
          payload: Object.freeze({ job_id: jobId }),
        }),
      );
    });
  }

  async history(jobId: string): Promise<readonly NativeAionUiScheduleConversation[]> {
    this.assertOpen();
    const job = await this.requireJob(jobId);
    if (job.runCount === 0 || job.lastRunAtMs === undefined) {
      return Object.freeze([]);
    }
    return Object.freeze([
      Object.freeze({
        id: job.nativeConversationId,
        name: job.nativeConversationTitle ?? job.name,
        extra: Object.freeze({ cron_job_id: job.id }),
        created_at: job.createdAtMs,
        updated_at: job.lastRunAtMs,
      }),
    ]);
  }

  async runNow(jobId: string): Promise<Readonly<{ conversation_id: string }>> {
    this.assertOpen();
    const claimed = await this.claimAndStart(jobId, false);
    return Object.freeze({ conversation_id: claimed.nativeConversationId });
  }

  async waitForIdle(): Promise<void> {
    while (this.activeRuns.size > 0) {
      await Promise.allSettled(this.activeRuns.values());
    }
  }

  async close(reason = "schedule-service-closed"): Promise<void> {
    if (this.closeOperation !== undefined) {
      return this.closeOperation;
    }
    this.closed = true;
    this.clearAllTimers();
    this.closeOperation = (async (): Promise<void> => {
      let closeError: unknown;
      try {
        try {
          await this.config.journey.close(reason);
        } catch (error) {
          closeError = error;
        }
        await this.waitForIdle();
        if (closeError !== undefined) {
          throw closeError;
        }
      } finally {
        this.clearAllTimers();
        this.eventHandlers.clear();
      }
    })();
    return this.closeOperation;
  }

  async recover(): Promise<void> {
    this.assertOpen();
    const recoveredAtMs = this.config.clock.nowMs();
    this.clearAllTimers();
    const interrupted = await this.config.persistence.recoverAionUiScheduleRuns({ recoveredAtMs });
    for (const job of interrupted) {
      this.emit(
        Object.freeze({
          type: "cron.job-executed",
          payload: Object.freeze({
            job_id: job.id,
            status: "error",
            error: "interrupted",
          }),
        }),
      );
    }
    const jobs = await this.config.persistence.listAionUiSchedules({
      limit: AIONUI_SCHEDULE_MAX_JOBS,
    });
    for (const job of jobs) {
      await this.reconcileTimer(job, recoveredAtMs);
    }
  }

  async resume(): Promise<void> {
    this.assertOpen();
    const resumedAtMs = this.config.clock.nowMs();
    this.clearAllTimers();
    const jobs = await this.config.persistence.listAionUiSchedules({
      limit: AIONUI_SCHEDULE_MAX_JOBS,
    });
    for (const job of jobs) {
      await this.reconcileTimer(job, resumedAtMs);
    }
  }

  private async reconcileTimer(job: AionUiScheduleJob, nowMs: number): Promise<void> {
    this.clearTimer(job.id);
    if (!job.enabled || job.activeClaim !== undefined) {
      return;
    }
    if (job.schedule.kind === "cron" && job.schedule.expr.length === 0) {
      return;
    }
    if (job.nextRunAtMs !== undefined && job.nextRunAtMs > nowMs) {
      this.scheduleTimer(job.id, job.nextRunAtMs);
      return;
    }

    const nextRunAtMs = calculateAionUiScheduleNextRun(job.schedule, nowMs);
    const missed = job.nextRunAtMs !== undefined && job.nextRunAtMs <= nowMs;
    const updated = await this.config.persistence.updateAionUiSchedule({
      jobId: job.id,
      updatedAtMs: nowMs,
      enabled: nextRunAtMs !== undefined,
      nextRunAtMs: nextRunAtMs ?? null,
      ...(missed
        ? {
            lastRunAtMs: nowMs,
            lastStatus: "missed" as const,
            lastIncidentCode: "missed-occurrence",
          }
        : {}),
    });
    if (updated.status === "updated") {
      if (missed) {
        this.emit(
          Object.freeze({
            type: "cron.job-executed",
            payload: Object.freeze({
              job_id: updated.job.id,
              status: "missed",
              error: "missed-occurrence",
            }),
          }),
        );
      }
      if (updated.job.nextRunAtMs !== undefined) {
        this.scheduleTimer(updated.job.id, updated.job.nextRunAtMs);
      }
    }
  }

  private scheduleTimer(jobId: string, atMs: number): void {
    if (this.closed) {
      return;
    }
    const existing = this.scheduledTimers.get(jobId);
    if (existing !== undefined) {
      this.config.timers.cancel(existing);
    }
    let handle!: AionUiScheduleTimerHandle;
    handle = this.config.timers.schedule(jobId, atMs, async (): Promise<void> => {
      if (this.scheduledTimers.get(jobId) === handle) {
        this.scheduledTimers.delete(jobId);
      }
      await this.claimAndStart(jobId, true).catch((): undefined => undefined);
    });
    this.scheduledTimers.set(jobId, handle);
  }

  private clearTimer(jobId: string): void {
    const handle = this.scheduledTimers.get(jobId);
    if (handle !== undefined) {
      this.config.timers.cancel(handle);
      this.scheduledTimers.delete(jobId);
    }
  }

  private clearAllTimers(): void {
    for (const jobId of this.scheduledTimers.keys()) {
      this.clearTimer(jobId);
    }
  }

  private emit(event: AionUiScheduleEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Renderer-compatible event observers cannot change schedule authority.
      }
    }
  }

  private async requireJob(jobId: string): Promise<AionUiScheduleJob> {
    const job = await this.config.persistence.getAionUiSchedule(jobId);
    if (job === null) {
      throw new AionUiScheduleServiceError(
        "schedule-not-found",
        "The requested Actestra schedule does not exist",
      );
    }
    return job;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AionUiScheduleServiceError(
        "schedule-closed",
        "The Actestra schedule service is closed",
      );
    }
  }

  private async claimAndStart(jobId: string, automatic: boolean): Promise<AionUiScheduleJob> {
    return this.serialize(jobId, async () => {
      this.assertOpen();
      const job = await this.requireJob(jobId);
      const claimedAtMs = this.config.clock.nowMs();
      if (
        automatic &&
        (!job.enabled || job.nextRunAtMs === undefined || job.nextRunAtMs > claimedAtMs)
      ) {
        throw new AionUiScheduleServiceError(
          "schedule-execution-failed",
          "The scheduled occurrence is no longer runnable",
        );
      }
      const claim = this.config.newClaimId?.() ?? `schedule-claim-${randomUUID()}`;
      const result = await this.config.persistence.claimAionUiScheduleRun({
        jobId,
        claim,
        claimedAtMs,
      });
      if (result.status === "not-found") {
        throw new AionUiScheduleServiceError(
          "schedule-not-found",
          "The requested Actestra schedule does not exist",
        );
      }
      if (result.status === "busy") {
        throw new AionUiScheduleServiceError(
          "schedule-busy",
          "The requested Actestra schedule already has an active run",
        );
      }
      this.clearTimer(jobId);
      this.trackRun(result.job, claim);
      return result.job;
    });
  }

  private trackRun(job: AionUiScheduleJob, claim: string): void {
    let operation!: Promise<void>;
    operation = this.executeClaimedRun(job, claim).finally(() => {
      if (this.activeRuns.get(job.id) === operation) {
        this.activeRuns.delete(job.id);
      }
    });
    this.activeRuns.set(job.id, operation);
    void operation.catch((): undefined => undefined);
  }

  private async executeClaimedRun(job: AionUiScheduleJob, claim: string): Promise<void> {
    const grant = await this.config.persistence.getActiveWorkspaceGrant(job.workspaceId);
    if (grant === null) {
      await this.completeClaim(job, claim, "error", "workspace-grant-unavailable");
      return;
    }
    if (grant.grantId !== job.workspaceGrantId || grant.workspaceId !== job.workspaceId) {
      await this.completeClaim(job, claim, "error", "workspace-grant-mismatch");
      return;
    }
    const parsed = parseAionUiGeneralWorkCommand(job.prompt);
    if (parsed === null || parsed.journeyKind !== "prompt-artifact" || parsed.prompt.length === 0) {
      await this.completeClaim(job, claim, "error", "schedule-prompt-invalid");
      return;
    }

    let status: "ok" | "error" | "skipped";
    let incidentCode: string | undefined;
    try {
      const initial = await this.config.journey.submitFromTrustedContext(
        Object.freeze({
          contractVersion: 1 as const,
          nativeConversationId: job.nativeConversationId,
          submissionId: `${job.id}:run:${String(job.runSequence)}`,
          prompt: parsed.prompt,
          journeyKind: "prompt-artifact" as const,
        }),
        Object.freeze({
          rootPath: grant.rootPath,
          displayName: grant.displayName,
        }),
      );
      let terminal = initial;
      if (!this.isTerminalProjection(terminal)) {
        await this.config.journey.waitForIdle();
        const projections = await this.config.journey.list(job.nativeConversationId);
        terminal = projections.find((candidate) => candidate.taskId === initial.taskId) ?? initial;
      }
      if (terminal.status === "completed") {
        status = "ok";
      } else if (terminal.status === "cancelled") {
        status = "skipped";
        incidentCode = terminal.incidentCode ?? "cancelled";
      } else {
        status = "error";
        incidentCode = terminal.incidentCode ?? "general-work-failed";
      }
    } catch {
      status = "error";
      incidentCode = "journey-unavailable";
    }
    await this.completeClaim(job, claim, status, incidentCode);
  }

  private isTerminalProjection(projection: AionUiGeneralWorkProjection): boolean {
    return (
      projection.status === "completed" ||
      projection.status === "failed" ||
      projection.status === "cancelled"
    );
  }

  private async completeClaim(
    claimedJob: AionUiScheduleJob,
    claim: string,
    status: "ok" | "error" | "skipped",
    lastIncidentCode?: string,
  ): Promise<void> {
    const completedAtMs = this.config.clock.nowMs();
    const current = await this.requireJob(claimedJob.id);
    const enabled = current.schedule.kind === "at" ? false : current.enabled;
    const nextRunAtMs = enabled
      ? calculateAionUiScheduleNextRun(current.schedule, completedAtMs)
      : undefined;
    const result = await this.config.persistence.completeAionUiScheduleRun({
      jobId: current.id,
      claim,
      completedAtMs,
      status,
      ...(lastIncidentCode === undefined ? {} : { lastIncidentCode }),
      ...(nextRunAtMs === undefined ? {} : { nextRunAtMs }),
      enabled,
    });
    if (result.status !== "completed") {
      throw new AionUiScheduleServiceError(
        "schedule-execution-failed",
        "Actestra could not persist the scheduled run terminal state",
      );
    }
    if (result.job.nextRunAtMs !== undefined) {
      this.scheduleTimer(result.job.id, result.job.nextRunAtMs);
    }
    this.emit(
      Object.freeze({
        type: "cron.job-executed",
        payload: Object.freeze({
          job_id: result.job.id,
          status,
          ...(lastIncidentCode === undefined ? {} : { error: lastIncidentCode }),
        }),
      }),
    );
  }

  private serialize<Result>(jobId: string, work: () => Promise<Result>): Promise<Result> {
    const prior = this.mutations.get(jobId);
    const ready = prior?.then(
      (): void => {},
      (): void => {},
    );
    const operation = (ready ?? Promise.resolve()).then(work).finally(() => {
      if (this.mutations.get(jobId) === operation) {
        this.mutations.delete(jobId);
      }
    });
    this.mutations.set(jobId, operation);
    return operation;
  }
}
