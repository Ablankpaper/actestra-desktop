import { createHash } from "node:crypto";
import { Cron } from "croner";
import {
  assertDomainGraph,
  assertWorkspaceGrant,
  workspaceGrantId,
  workspaceId,
  type Workspace,
  type WorkspaceGrant,
  type WorkspaceGrantId,
  type WorkspaceId,
} from "../../core";
import {
  AIONUI_GENERAL_WORK_MAX_PROMPT_BYTES,
  assertAionUiNativeConversationId,
  parseAionUiGeneralWorkCommand,
} from "./generalWorkJourney";
import { hashAionUiGeneralWorkConversation } from "./generalWorkIdentity";

export const AIONUI_SCHEDULE_CONTRACT_VERSION = 1 as const;
export const AIONUI_SCHEDULE_MAX_JOBS = 100;
export const ACTESTRA_GENERAL_WORKER_AGENT_TYPE = "actestra-general-worker" as const;

const MAX_NAME_BYTES = 256;
const MAX_DESCRIPTION_BYTES = 2 * 1024;
const MAX_SCHEDULE_DESCRIPTION_BYTES = 512;
const MAX_CRON_EXPRESSION_BYTES = 256;
const MAX_TIME_ZONE_BYTES = 128;
const MAX_INCIDENT_CODE_BYTES = 128;
const MAX_CONVERSATION_TITLE_BYTES = 256;
const MAX_CLAIM_BYTES = 128;
const MIN_EVERY_MS = 60_000;
const MAX_EVERY_MS = 31_536_000_000;

const CREATE_KEYS = [
  "name",
  "description",
  "schedule",
  "prompt",
  "conversation_id",
  "conversation_title",
  "created_by",
  "execution_mode",
  "queue_enabled",
] as const;
const UPDATE_KEYS = [
  "name",
  "description",
  "enabled",
  "schedule",
  "message",
  "execution_mode",
  "conversation_title",
  "max_retries",
  "queue_enabled",
] as const;
const JOB_KEYS = [
  "contractVersion",
  "id",
  "conversationHash",
  "nativeConversationId",
  "nativeConversationTitle",
  "workspaceId",
  "workspaceGrantId",
  "name",
  "description",
  "prompt",
  "schedule",
  "enabled",
  "nextRunAtMs",
  "lastRunAtMs",
  "lastStatus",
  "lastIncidentCode",
  "activeClaim",
  "activeClaimedAtMs",
  "runSequence",
  "runCount",
  "retryCount",
  "maxRetries",
  "queueEnabled",
  "createdAtMs",
  "updatedAtMs",
  "deletedAtMs",
] as const;
const REGISTRATION_KEYS = ["job", "workspace", "workspaceGrant"] as const;
const LIST_KEYS = ["limit", "conversationHash"] as const;
const PERSISTENCE_UPDATE_KEYS = [
  "jobId",
  "updatedAtMs",
  "nativeConversationTitle",
  "name",
  "description",
  "prompt",
  "schedule",
  "enabled",
  "nextRunAtMs",
  "lastRunAtMs",
  "lastStatus",
  "lastIncidentCode",
] as const;
const DELETE_KEYS = ["jobId", "deletedAtMs"] as const;
const CLAIM_KEYS = ["jobId", "claim", "claimedAtMs"] as const;
const COMPLETION_KEYS = [
  "jobId",
  "claim",
  "completedAtMs",
  "status",
  "lastIncidentCode",
  "nextRunAtMs",
  "enabled",
] as const;
const RECOVERY_KEYS = ["recoveredAtMs"] as const;

export type AionUiSchedule =
  | {
      readonly kind: "at";
      readonly atMs: number;
      readonly description: string;
    }
  | {
      readonly kind: "every";
      readonly everyMs: number;
      readonly description: string;
    }
  | {
      readonly kind: "cron";
      readonly expr: string;
      readonly tz?: string;
      readonly description: string;
    };

export interface AionUiScheduleCreateInput {
  readonly name: string;
  readonly description?: string;
  readonly schedule: AionUiSchedule;
  readonly prompt: string;
  readonly conversation_id: string;
  readonly conversation_title?: string;
  readonly created_by: "user";
  readonly execution_mode: "existing";
  readonly queue_enabled?: false;
}

export interface AionUiScheduleUpdateInput {
  readonly name?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly schedule?: AionUiSchedule;
  readonly message?: string;
  readonly execution_mode?: "existing";
  readonly conversation_title?: string;
  readonly max_retries?: 0;
  readonly queue_enabled?: false;
}

export type AionUiScheduleLastStatus = "ok" | "error" | "skipped" | "missed";

export interface AionUiScheduleJob {
  readonly contractVersion: typeof AIONUI_SCHEDULE_CONTRACT_VERSION;
  readonly id: string;
  readonly conversationHash: string;
  readonly nativeConversationId: string;
  readonly nativeConversationTitle?: string;
  readonly workspaceId: WorkspaceId;
  readonly workspaceGrantId: WorkspaceGrantId;
  readonly name: string;
  readonly description?: string;
  readonly prompt: string;
  readonly schedule: AionUiSchedule;
  readonly enabled: boolean;
  readonly nextRunAtMs?: number;
  readonly lastRunAtMs?: number;
  readonly lastStatus?: AionUiScheduleLastStatus;
  readonly lastIncidentCode?: string;
  readonly activeClaim?: string;
  readonly activeClaimedAtMs?: number;
  readonly runSequence: number;
  readonly runCount: number;
  readonly retryCount: 0;
  readonly maxRetries: 0;
  readonly queueEnabled: false;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly deletedAtMs?: number;
}

export interface AionUiScheduleRegistration {
  readonly job: AionUiScheduleJob;
  readonly workspace: Workspace;
  readonly workspaceGrant: WorkspaceGrant;
}

export interface AionUiScheduleListInput {
  readonly limit: number;
  readonly conversationHash?: string;
}

export interface AionUiSchedulePersistenceUpdateInput {
  readonly jobId: string;
  readonly updatedAtMs: number;
  readonly nativeConversationTitle?: string | null;
  readonly name?: string;
  readonly description?: string | null;
  readonly prompt?: string;
  readonly schedule?: AionUiSchedule;
  readonly enabled?: boolean;
  readonly nextRunAtMs?: number | null;
  readonly lastRunAtMs?: number | null;
  readonly lastStatus?: AionUiScheduleLastStatus | null;
  readonly lastIncidentCode?: string | null;
}

export interface AionUiScheduleDeleteInput {
  readonly jobId: string;
  readonly deletedAtMs: number;
}

export interface AionUiScheduleClaimInput {
  readonly jobId: string;
  readonly claim: string;
  readonly claimedAtMs: number;
}

export interface AionUiScheduleCompletionInput {
  readonly jobId: string;
  readonly claim: string;
  readonly completedAtMs: number;
  readonly status: AionUiScheduleLastStatus;
  readonly lastIncidentCode?: string;
  readonly nextRunAtMs?: number;
  readonly enabled?: boolean;
}

export interface AionUiScheduleRecoveryInput {
  readonly recoveredAtMs: number;
}

export type AionUiScheduleRegistrationResult = Readonly<{
  status: "stored" | "duplicate";
  job: AionUiScheduleJob;
}>;

export type AionUiScheduleMutationResult =
  | Readonly<{
      status: "updated" | "deleted" | "active-claim";
      job: AionUiScheduleJob;
    }>
  | Readonly<{
      status: "not-found";
    }>;

export type AionUiScheduleClaimResult =
  | Readonly<{
      status: "claimed" | "busy";
      job: AionUiScheduleJob;
    }>
  | Readonly<{
      status: "not-found";
    }>;

export type AionUiScheduleCompletionResult =
  | Readonly<{
      status: "completed" | "claim-mismatch";
      job: AionUiScheduleJob;
    }>
  | Readonly<{
      status: "not-found";
    }>;

export interface AionUiScheduledGeneralWorkPersistencePort {
  registerAionUiSchedule(
    registration: AionUiScheduleRegistration,
  ): Promise<AionUiScheduleRegistrationResult>;
  listAionUiSchedules(input: AionUiScheduleListInput): Promise<readonly AionUiScheduleJob[]>;
  getAionUiSchedule(jobId: string): Promise<AionUiScheduleJob | null>;
  updateAionUiSchedule(
    input: AionUiSchedulePersistenceUpdateInput,
  ): Promise<AionUiScheduleMutationResult>;
  deleteAionUiSchedule(input: AionUiScheduleDeleteInput): Promise<AionUiScheduleMutationResult>;
  claimAionUiScheduleRun(input: AionUiScheduleClaimInput): Promise<AionUiScheduleClaimResult>;
  completeAionUiScheduleRun(
    input: AionUiScheduleCompletionInput,
  ): Promise<AionUiScheduleCompletionResult>;
  recoverAionUiScheduleRuns(
    input: AionUiScheduleRecoveryInput,
  ): Promise<readonly AionUiScheduleJob[]>;
}

export interface AionUiScheduleIdentity {
  readonly id: string;
  readonly conversationHash: string;
}

export interface NativeAionUiCronJob {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled: boolean;
  readonly schedule: AionUiSchedule;
  readonly target: {
    readonly payload: { readonly kind: "message"; readonly text: string };
    readonly execution_mode: "existing";
  };
  readonly metadata: {
    readonly conversation_id: string;
    readonly conversation_title?: string;
    readonly agent_type: typeof ACTESTRA_GENERAL_WORKER_AGENT_TYPE;
    readonly created_by: "user";
    readonly created_at: number;
    readonly updated_at: number;
    readonly agent_config: {
      readonly name: "Actestra General Worker";
      readonly is_preset: true;
    };
  };
  readonly state: {
    readonly next_run_at_ms?: number;
    readonly last_run_at_ms?: number;
    readonly last_status?: AionUiScheduleLastStatus;
    readonly last_error?: string;
    readonly run_count: number;
    readonly retry_count: 0;
    readonly max_retries: 0;
    readonly queue_enabled: false;
  };
}

export class AionUiScheduledGeneralWorkError extends Error {
  constructor(
    readonly code: "invalid-create" | "invalid-update" | "invalid-schedule" | "invalid-job",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiScheduledGeneralWorkError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(
  code: AionUiScheduledGeneralWorkError["code"],
  message: string,
  cause?: unknown,
): never {
  throw new AionUiScheduledGeneralWorkError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertRecord(
  value: unknown,
  label: string,
  code: AionUiScheduledGeneralWorkError["code"],
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    fail(code, `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  code: AionUiScheduledGeneralWorkError["code"],
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    fail(code, `${label} contains unsupported field ${unexpected}`);
  }
}

function containsControl(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertBoundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
  code: AionUiScheduledGeneralWorkError["code"],
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.trim() !== value ||
    byteLength(value) > maximumBytes ||
    containsControl(value)
  ) {
    fail(code, `${label} must be bounded control-free UTF-8 text`);
  }
}

function assertOptionalBoundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
  code: AionUiScheduledGeneralWorkError["code"],
): asserts value is string | undefined {
  if (value !== undefined) {
    assertBoundedText(value, label, maximumBytes, code);
  }
}

function assertSafeTimestamp(
  value: unknown,
  label: string,
  code: AionUiScheduledGeneralWorkError["code"],
): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(code, `${label} must be a non-negative safe-integer epoch millisecond`);
  }
}

function maximumAtMs(nowMs: number): number {
  const maximum = new Date(nowMs);
  maximum.setUTCFullYear(maximum.getUTCFullYear() + 10);
  return maximum.getTime();
}

function assertTimeZone(
  value: unknown,
  code: AionUiScheduledGeneralWorkError["code"],
): asserts value is string | undefined {
  if (value === undefined) {
    return;
  }
  assertBoundedText(value, "Schedule time zone", MAX_TIME_ZONE_BYTES, code);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch (error) {
    fail(code, "Schedule time zone must be an IANA time zone", error);
  }
}

function assertSchedule(
  value: unknown,
  referenceMs: number,
  code: AionUiScheduledGeneralWorkError["code"],
  requireFutureAt: boolean,
): asserts value is AionUiSchedule {
  assertRecord(value, "Schedule", code);
  assertBoundedText(
    value.description,
    "Schedule description",
    MAX_SCHEDULE_DESCRIPTION_BYTES,
    code,
    true,
  );

  if (value.kind === "at") {
    assertExactKeys(value, ["kind", "atMs", "description"], "At schedule", code);
    assertSafeTimestamp(value.atMs, "At schedule time", code);
    if ((requireFutureAt && value.atMs <= referenceMs) || value.atMs > maximumAtMs(referenceMs)) {
      fail(code, "At schedule must be future-dated by no more than ten years");
    }
    return;
  }

  if (value.kind === "every") {
    assertExactKeys(value, ["kind", "everyMs", "description"], "Every schedule", code);
    if (
      typeof value.everyMs !== "number" ||
      !Number.isSafeInteger(value.everyMs) ||
      value.everyMs < MIN_EVERY_MS ||
      value.everyMs > MAX_EVERY_MS
    ) {
      fail(code, "Every schedule interval is outside the accepted bounds");
    }
    return;
  }

  if (value.kind === "cron") {
    assertExactKeys(value, ["kind", "expr", "tz", "description"], "Cron schedule", code);
    assertBoundedText(value.expr, "Cron expression", MAX_CRON_EXPRESSION_BYTES, code, true);
    assertTimeZone(value.tz, code);
    if (value.expr.length === 0) {
      if (value.tz !== undefined) {
        fail(code, "Manual cron schedules cannot specify a time zone");
      }
      return;
    }
    if (value.expr.split(/\s+/u).length !== 5) {
      fail(code, "Cron expression must contain exactly five fields");
    }
    try {
      const cron = new Cron(value.expr, { paused: true, timezone: value.tz });
      if (cron.nextRun(new Date(referenceMs)) === null) {
        fail(code, "Cron expression has no future occurrence");
      }
      cron.stop();
    } catch (error) {
      if (error instanceof AionUiScheduledGeneralWorkError) {
        throw error;
      }
      fail(code, "Cron expression is invalid", error);
    }
    return;
  }

  fail(code, "Schedule kind is unsupported");
}

function assertPlainGeneralWorkPrompt(
  value: unknown,
  code: "invalid-create" | "invalid-update" | "invalid-job",
): asserts value is string {
  assertBoundedText(
    value,
    "Scheduled General Work prompt",
    AIONUI_GENERAL_WORK_MAX_PROMPT_BYTES,
    code,
  );
  const parsed = parseAionUiGeneralWorkCommand(value);
  if (parsed === null || parsed.journeyKind !== "prompt-artifact" || parsed.prompt.length === 0) {
    fail(code, "Scheduled General Work accepts only a plain non-empty /actestra prompt");
  }
}

export function assertAionUiScheduleCreateInput(
  value: unknown,
  nowMs: number,
): asserts value is AionUiScheduleCreateInput {
  assertSafeTimestamp(nowMs, "Schedule creation reference", "invalid-create");
  assertRecord(value, "Schedule create input", "invalid-create");
  assertExactKeys(value, CREATE_KEYS, "Schedule create input", "invalid-create");
  assertBoundedText(value.name, "Schedule name", MAX_NAME_BYTES, "invalid-create");
  assertOptionalBoundedText(
    value.description,
    "Schedule description",
    MAX_DESCRIPTION_BYTES,
    "invalid-create",
  );
  assertSchedule(value.schedule, nowMs, "invalid-create", true);
  assertPlainGeneralWorkPrompt(value.prompt, "invalid-create");
  try {
    assertAionUiNativeConversationId(value.conversation_id);
  } catch (error) {
    fail("invalid-create", "Schedule requires one bounded native conversation identity", error);
  }
  assertOptionalBoundedText(
    value.conversation_title,
    "Native conversation title",
    MAX_CONVERSATION_TITLE_BYTES,
    "invalid-create",
  );
  if (value.created_by !== "user") {
    fail("invalid-create", "Schedule must be created by the user");
  }
  if (value.execution_mode !== "existing") {
    fail("invalid-create", "Schedule must target the existing conversation");
  }
  if (value.queue_enabled !== undefined && value.queue_enabled !== false) {
    fail("invalid-create", "Schedule queueing must remain disabled");
  }
}

export function assertAionUiScheduleUpdateInput(
  value: unknown,
  nowMs: number,
): asserts value is AionUiScheduleUpdateInput {
  assertSafeTimestamp(nowMs, "Schedule update reference", "invalid-update");
  assertRecord(value, "Schedule update input", "invalid-update");
  assertExactKeys(value, UPDATE_KEYS, "Schedule update input", "invalid-update");
  if (Object.keys(value).length === 0) {
    fail("invalid-update", "Schedule update must change at least one mutable field");
  }
  if (value.name !== undefined) {
    assertBoundedText(value.name, "Schedule name", MAX_NAME_BYTES, "invalid-update");
  }
  assertOptionalBoundedText(
    value.description,
    "Schedule description",
    MAX_DESCRIPTION_BYTES,
    "invalid-update",
  );
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    fail("invalid-update", "Schedule enabled must be boolean");
  }
  if (value.schedule !== undefined) {
    assertSchedule(value.schedule, nowMs, "invalid-update", true);
  }
  if (value.message !== undefined) {
    assertPlainGeneralWorkPrompt(value.message, "invalid-update");
  }
  if (value.execution_mode !== undefined && value.execution_mode !== "existing") {
    fail("invalid-update", "Schedule execution mode is immutable");
  }
  assertOptionalBoundedText(
    value.conversation_title,
    "Native conversation title",
    MAX_CONVERSATION_TITLE_BYTES,
    "invalid-update",
  );
  if (value.max_retries !== undefined && value.max_retries !== 0) {
    fail("invalid-update", "Schedule retries must remain disabled");
  }
  if (value.queue_enabled !== undefined && value.queue_enabled !== false) {
    fail("invalid-update", "Schedule queueing must remain disabled");
  }
}

function canonicalSchedule(schedule: AionUiSchedule): Record<string, unknown> {
  if (schedule.kind === "at") {
    return { kind: schedule.kind, atMs: schedule.atMs, description: schedule.description };
  }
  if (schedule.kind === "every") {
    return { kind: schedule.kind, everyMs: schedule.everyMs, description: schedule.description };
  }
  return {
    kind: schedule.kind,
    expr: schedule.expr,
    ...(schedule.tz === undefined ? {} : { tz: schedule.tz }),
    description: schedule.description,
  };
}

export function deriveAionUiScheduleIdentity(
  input: AionUiScheduleCreateInput,
): AionUiScheduleIdentity {
  const conversationHash = hashAionUiGeneralWorkConversation(input.conversation_id);
  const canonical = JSON.stringify([
    AIONUI_SCHEDULE_CONTRACT_VERSION,
    conversationHash,
    input.name,
    input.description ?? null,
    input.prompt,
    canonicalSchedule(input.schedule),
  ]);
  const digest = createHash("sha256").update(canonical).digest("hex");
  return Object.freeze({
    id: `schedule-aionui-${digest}`,
    conversationHash,
  });
}

export function calculateAionUiScheduleNextRun(
  schedule: AionUiSchedule,
  afterMs: number,
): number | undefined {
  assertSafeTimestamp(afterMs, "Schedule calculation reference", "invalid-schedule");
  assertSchedule(schedule, afterMs, "invalid-schedule", false);
  if (schedule.kind === "at") {
    return schedule.atMs > afterMs ? schedule.atMs : undefined;
  }
  if (schedule.kind === "every") {
    const next = afterMs + schedule.everyMs;
    if (!Number.isSafeInteger(next)) {
      fail("invalid-schedule", "Every schedule next occurrence exceeds safe time bounds");
    }
    return next;
  }
  if (schedule.expr.length === 0) {
    return undefined;
  }
  try {
    const cron = new Cron(schedule.expr, { paused: true, timezone: schedule.tz });
    const next = cron.nextRun(new Date(afterMs));
    cron.stop();
    return next?.getTime();
  } catch (error) {
    fail("invalid-schedule", "Cron next occurrence cannot be calculated", error);
  }
}

function assertCounter(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("invalid-job", `${label} must be a non-negative safe integer`);
  }
}

export function assertAionUiScheduleJobId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^schedule-aionui-[a-f0-9]{64}$/u.test(value)) {
    fail("invalid-job", "Schedule job identity is invalid");
  }
}

function assertConversationHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail("invalid-job", "Schedule conversation hash is invalid");
  }
}

function assertLastStatus(
  value: unknown,
  allowNull: boolean,
): asserts value is AionUiScheduleLastStatus | null | undefined {
  if (value === undefined || (allowNull && value === null)) {
    return;
  }
  if (
    typeof value !== "string" ||
    !(ARRAY_FROM_SCHEDULE_LAST_STATUSES as readonly string[]).includes(value)
  ) {
    fail("invalid-job", "Schedule last status is unsupported");
  }
}

const ARRAY_FROM_SCHEDULE_LAST_STATUSES = ["ok", "error", "skipped", "missed"] as const;

export function assertAionUiScheduleJob(value: unknown): asserts value is AionUiScheduleJob {
  assertRecord(value, "Schedule job", "invalid-job");
  assertExactKeys(value, JOB_KEYS, "Schedule job", "invalid-job");
  if (value.contractVersion !== AIONUI_SCHEDULE_CONTRACT_VERSION) {
    fail("invalid-job", "Schedule job contract version is unsupported");
  }
  assertAionUiScheduleJobId(value.id);
  assertConversationHash(value.conversationHash);
  try {
    assertAionUiNativeConversationId(value.nativeConversationId);
    workspaceId(value.workspaceId as string);
    workspaceGrantId(value.workspaceGrantId as string);
  } catch (error) {
    fail("invalid-job", "Schedule owner identity is invalid", error);
  }
  assertOptionalBoundedText(
    value.nativeConversationTitle,
    "Native conversation title",
    MAX_CONVERSATION_TITLE_BYTES,
    "invalid-job",
  );
  assertBoundedText(value.name, "Schedule name", MAX_NAME_BYTES, "invalid-job");
  assertOptionalBoundedText(
    value.description,
    "Schedule description",
    MAX_DESCRIPTION_BYTES,
    "invalid-job",
  );
  assertPlainGeneralWorkPrompt(value.prompt, "invalid-job");
  assertSafeTimestamp(value.createdAtMs, "Schedule createdAtMs", "invalid-job");
  assertSafeTimestamp(value.updatedAtMs, "Schedule updatedAtMs", "invalid-job");
  if (value.updatedAtMs < value.createdAtMs) {
    fail("invalid-job", "Schedule updatedAtMs cannot predate createdAtMs");
  }
  assertSchedule(value.schedule, value.createdAtMs, "invalid-job", true);
  if (typeof value.enabled !== "boolean") {
    fail("invalid-job", "Schedule enabled must be boolean");
  }
  for (const [entry, label] of [
    [value.nextRunAtMs, "Schedule nextRunAtMs"],
    [value.lastRunAtMs, "Schedule lastRunAtMs"],
    [value.activeClaimedAtMs, "Schedule activeClaimedAtMs"],
  ] as const) {
    if (entry !== undefined) {
      assertSafeTimestamp(entry, label, "invalid-job");
    }
  }
  if (value.deletedAtMs !== undefined) {
    assertSafeTimestamp(value.deletedAtMs, "Schedule deletedAtMs", "invalid-job");
    if (value.deletedAtMs < value.updatedAtMs) {
      fail("invalid-job", "Schedule deletedAtMs cannot predate updatedAtMs");
    }
  }
  assertLastStatus(value.lastStatus, false);
  assertOptionalBoundedText(
    value.lastIncidentCode,
    "Schedule incident code",
    MAX_INCIDENT_CODE_BYTES,
    "invalid-job",
  );
  if (value.activeClaim !== undefined) {
    assertBoundedText(value.activeClaim, "Schedule active claim", MAX_CLAIM_BYTES, "invalid-job");
  }
  if ((value.activeClaim === undefined) !== (value.activeClaimedAtMs === undefined)) {
    fail("invalid-job", "Schedule active claim and claim time must be paired");
  }
  assertCounter(value.runSequence, "Schedule run sequence");
  assertCounter(value.runCount, "Schedule run count");
  if (value.runCount > value.runSequence) {
    fail("invalid-job", "Schedule run count cannot exceed run sequence");
  }
  if (value.retryCount !== 0 || value.maxRetries !== 0 || value.queueEnabled !== false) {
    fail("invalid-job", "Schedule retry and queue policy is fixed");
  }
}

export function assertAionUiScheduleRegistration(
  value: unknown,
): asserts value is AionUiScheduleRegistration {
  assertRecord(value, "Schedule registration", "invalid-job");
  assertExactKeys(value, REGISTRATION_KEYS, "Schedule registration", "invalid-job");
  assertAionUiScheduleJob(value.job);
  try {
    assertDomainGraph({
      workspaces: [value.workspace as Workspace],
      tasks: [],
      sessions: [],
      workers: [],
      approvals: [],
      artifacts: [],
    });
    assertWorkspaceGrant(value.workspaceGrant);
  } catch (error) {
    fail("invalid-job", "Schedule registration owner authority is invalid", error);
  }

  const workspace = value.workspace as Workspace;
  const workspaceGrant = value.workspaceGrant as WorkspaceGrant;
  if (
    workspace.state !== "active" ||
    workspace.id !== value.job.workspaceId ||
    workspaceGrant.state !== "active" ||
    workspaceGrant.workspaceId !== workspace.id ||
    workspaceGrant.grantId !== value.job.workspaceGrantId
  ) {
    fail("invalid-job", "Schedule registration owner authority does not match the job");
  }
  if (
    value.job.deletedAtMs !== undefined ||
    value.job.activeClaim !== undefined ||
    value.job.activeClaimedAtMs !== undefined ||
    value.job.runSequence !== 0 ||
    value.job.runCount !== 0
  ) {
    fail("invalid-job", "New schedule registration cannot contain prior run state");
  }
}

export function assertAionUiScheduleListInput(
  value: unknown,
): asserts value is AionUiScheduleListInput {
  assertRecord(value, "Schedule list input", "invalid-job");
  assertExactKeys(value, LIST_KEYS, "Schedule list input", "invalid-job");
  if (
    typeof value.limit !== "number" ||
    !Number.isSafeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > AIONUI_SCHEDULE_MAX_JOBS
  ) {
    fail("invalid-job", "Schedule list limit must be between 1 and 100");
  }
  if (value.conversationHash !== undefined) {
    assertConversationHash(value.conversationHash);
  }
}

function assertOptionalTimestampOrNull(value: unknown, label: string): void {
  if (value !== undefined && value !== null) {
    assertSafeTimestamp(value, label, "invalid-job");
  }
}

export function assertAionUiSchedulePersistenceUpdateInput(
  value: unknown,
): asserts value is AionUiSchedulePersistenceUpdateInput {
  assertRecord(value, "Schedule persistence update", "invalid-job");
  assertExactKeys(value, PERSISTENCE_UPDATE_KEYS, "Schedule persistence update", "invalid-job");
  assertAionUiScheduleJobId(value.jobId);
  assertSafeTimestamp(value.updatedAtMs, "Schedule persistence update time", "invalid-job");
  if (!Object.keys(value).some((key) => key !== "jobId" && key !== "updatedAtMs")) {
    fail("invalid-job", "Schedule persistence update must change a mutable field");
  }
  if (value.nativeConversationTitle !== undefined && value.nativeConversationTitle !== null) {
    assertBoundedText(
      value.nativeConversationTitle,
      "Native conversation title",
      MAX_CONVERSATION_TITLE_BYTES,
      "invalid-job",
    );
  }
  if (value.name !== undefined) {
    assertBoundedText(value.name, "Schedule name", MAX_NAME_BYTES, "invalid-job");
  }
  if (value.description !== undefined && value.description !== null) {
    assertBoundedText(
      value.description,
      "Schedule description",
      MAX_DESCRIPTION_BYTES,
      "invalid-job",
    );
  }
  if (value.prompt !== undefined) {
    assertPlainGeneralWorkPrompt(value.prompt, "invalid-job");
  }
  if (value.schedule !== undefined) {
    assertSchedule(value.schedule, value.updatedAtMs, "invalid-job", true);
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    fail("invalid-job", "Schedule persistence enabled state must be boolean");
  }
  assertOptionalTimestampOrNull(value.nextRunAtMs, "Schedule persistence next run");
  assertOptionalTimestampOrNull(value.lastRunAtMs, "Schedule persistence last run");
  assertLastStatus(value.lastStatus, true);
  if (value.lastIncidentCode !== undefined && value.lastIncidentCode !== null) {
    assertBoundedText(
      value.lastIncidentCode,
      "Schedule incident code",
      MAX_INCIDENT_CODE_BYTES,
      "invalid-job",
    );
  }
}

export function assertAionUiScheduleDeleteInput(
  value: unknown,
): asserts value is AionUiScheduleDeleteInput {
  assertRecord(value, "Schedule delete input", "invalid-job");
  assertExactKeys(value, DELETE_KEYS, "Schedule delete input", "invalid-job");
  assertAionUiScheduleJobId(value.jobId);
  assertSafeTimestamp(value.deletedAtMs, "Schedule deletion time", "invalid-job");
}

export function assertAionUiScheduleClaimInput(
  value: unknown,
): asserts value is AionUiScheduleClaimInput {
  assertRecord(value, "Schedule claim input", "invalid-job");
  assertExactKeys(value, CLAIM_KEYS, "Schedule claim input", "invalid-job");
  assertAionUiScheduleJobId(value.jobId);
  assertBoundedText(value.claim, "Schedule claim", MAX_CLAIM_BYTES, "invalid-job");
  assertSafeTimestamp(value.claimedAtMs, "Schedule claim time", "invalid-job");
}

export function assertAionUiScheduleCompletionInput(
  value: unknown,
): asserts value is AionUiScheduleCompletionInput {
  assertRecord(value, "Schedule completion input", "invalid-job");
  assertExactKeys(value, COMPLETION_KEYS, "Schedule completion input", "invalid-job");
  assertAionUiScheduleJobId(value.jobId);
  assertBoundedText(value.claim, "Schedule claim", MAX_CLAIM_BYTES, "invalid-job");
  assertSafeTimestamp(value.completedAtMs, "Schedule completion time", "invalid-job");
  assertLastStatus(value.status, false);
  if (value.lastIncidentCode !== undefined) {
    assertBoundedText(
      value.lastIncidentCode,
      "Schedule incident code",
      MAX_INCIDENT_CODE_BYTES,
      "invalid-job",
    );
  }
  if (value.nextRunAtMs !== undefined) {
    assertSafeTimestamp(value.nextRunAtMs, "Schedule next run", "invalid-job");
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    fail("invalid-job", "Schedule completion enabled state must be boolean");
  }
}

export function assertAionUiScheduleRecoveryInput(
  value: unknown,
): asserts value is AionUiScheduleRecoveryInput {
  assertRecord(value, "Schedule recovery input", "invalid-job");
  assertExactKeys(value, RECOVERY_KEYS, "Schedule recovery input", "invalid-job");
  assertSafeTimestamp(value.recoveredAtMs, "Schedule recovery time", "invalid-job");
}

export function assertAionUiScheduleJobList(
  value: unknown,
): asserts value is readonly AionUiScheduleJob[] {
  if (!Array.isArray(value) || value.length > AIONUI_SCHEDULE_MAX_JOBS) {
    fail("invalid-job", "Schedule job list is invalid");
  }
  for (const job of value) {
    assertAionUiScheduleJob(job);
  }
}

function assertResultJob(
  value: Record<string, unknown>,
  statuses: readonly string[],
  label: string,
): void {
  assertExactKeys(value, ["status", "job"], label, "invalid-job");
  if (typeof value.status !== "string" || !statuses.includes(value.status)) {
    fail("invalid-job", `${label} status is unsupported`);
  }
  assertAionUiScheduleJob(value.job);
}

export function assertAionUiScheduleRegistrationResult(
  value: unknown,
): asserts value is AionUiScheduleRegistrationResult {
  assertRecord(value, "Schedule registration result", "invalid-job");
  assertResultJob(value, ["stored", "duplicate"], "Schedule registration result");
}

export function assertAionUiScheduleMutationResult(
  value: unknown,
): asserts value is AionUiScheduleMutationResult {
  assertRecord(value, "Schedule mutation result", "invalid-job");
  if (value.status === "not-found") {
    assertExactKeys(value, ["status"], "Schedule mutation result", "invalid-job");
    return;
  }
  assertResultJob(value, ["updated", "deleted", "active-claim"], "Schedule mutation result");
}

export function assertAionUiScheduleClaimResult(
  value: unknown,
): asserts value is AionUiScheduleClaimResult {
  assertRecord(value, "Schedule claim result", "invalid-job");
  if (value.status === "not-found") {
    assertExactKeys(value, ["status"], "Schedule claim result", "invalid-job");
    return;
  }
  assertResultJob(value, ["claimed", "busy"], "Schedule claim result");
}

export function assertAionUiScheduleCompletionResult(
  value: unknown,
): asserts value is AionUiScheduleCompletionResult {
  assertRecord(value, "Schedule completion result", "invalid-job");
  if (value.status === "not-found") {
    assertExactKeys(value, ["status"], "Schedule completion result", "invalid-job");
    return;
  }
  assertResultJob(value, ["completed", "claim-mismatch"], "Schedule completion result");
}

export function toNativeCronJob(job: AionUiScheduleJob): NativeAionUiCronJob {
  assertAionUiScheduleJob(job);
  return Object.freeze({
    id: job.id,
    name: job.name,
    ...(job.description === undefined ? {} : { description: job.description }),
    enabled: job.enabled,
    schedule: job.schedule,
    target: Object.freeze({
      payload: Object.freeze({ kind: "message" as const, text: job.prompt }),
      execution_mode: "existing" as const,
    }),
    metadata: Object.freeze({
      conversation_id: job.nativeConversationId,
      ...(job.nativeConversationTitle === undefined
        ? {}
        : { conversation_title: job.nativeConversationTitle }),
      agent_type: ACTESTRA_GENERAL_WORKER_AGENT_TYPE,
      created_by: "user" as const,
      created_at: job.createdAtMs,
      updated_at: job.updatedAtMs,
      agent_config: Object.freeze({
        name: "Actestra General Worker" as const,
        is_preset: true as const,
      }),
    }),
    state: Object.freeze({
      ...(job.nextRunAtMs === undefined ? {} : { next_run_at_ms: job.nextRunAtMs }),
      ...(job.lastRunAtMs === undefined ? {} : { last_run_at_ms: job.lastRunAtMs }),
      ...(job.lastStatus === undefined ? {} : { last_status: job.lastStatus }),
      ...(job.lastIncidentCode === undefined ? {} : { last_error: job.lastIncidentCode }),
      run_count: job.runCount,
      retry_count: 0 as const,
      max_retries: 0 as const,
      queue_enabled: false as const,
    }),
  });
}
