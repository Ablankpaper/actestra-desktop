import {
  AIONUI_GENERAL_WORK_MAX_PROMPT_BYTES,
  assertAionUiNativeConversationId,
  parseAionUiGeneralWorkCommand,
} from "./generalWorkJourney";
import {
  ACTESTRA_GENERAL_WORKER_AGENT_TYPE,
  AIONUI_SCHEDULE_MAX_JOBS,
  assertAionUiScheduleJobId,
  calculateAionUiScheduleNextRun,
  type AionUiSchedule,
  type AionUiScheduleLastStatus,
  type NativeAionUiCronJob,
} from "./scheduledGeneralWork";

export const AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION = 1 as const;
export const ACTESTRA_SCHEDULE_REQUEST_CHANNEL = "actestra:schedule-request-v1" as const;
export const ACTESTRA_SCHEDULE_EVENT_CHANNEL = "actestra:schedule-event-v1" as const;

const MAX_BRIDGE_PATH_BYTES = 4 * 1024;
const MAX_BRIDGE_MESSAGE_BYTES = 512;
const MAX_NAME_BYTES = 256;
const MAX_DESCRIPTION_BYTES = 2 * 1024;
const MAX_SCHEDULE_DESCRIPTION_BYTES = 512;
const MAX_CRON_EXPRESSION_BYTES = 256;
const MAX_TIME_ZONE_BYTES = 128;
const MAX_CONVERSATION_TITLE_BYTES = 256;
const MAX_INCIDENT_CODE_BYTES = 128;
const MAX_SKILL_CONTENT_BYTES = 16 * 1024;

const REQUEST_KEYS = ["contractVersion", "method", "path", "body"] as const;
const CREATE_BODY_KEYS = [
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
const UPDATE_BODY_KEYS = [
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
  "id",
  "name",
  "description",
  "enabled",
  "schedule",
  "target",
  "metadata",
  "state",
] as const;
const TARGET_KEYS = ["payload", "execution_mode"] as const;
const PAYLOAD_KEYS = ["kind", "text"] as const;
const METADATA_KEYS = [
  "conversation_id",
  "conversation_title",
  "agent_type",
  "created_by",
  "created_at",
  "updated_at",
  "agent_config",
] as const;
const AGENT_CONFIG_KEYS = ["name", "is_preset"] as const;
const STATE_KEYS = [
  "next_run_at_ms",
  "last_run_at_ms",
  "last_status",
  "last_error",
  "run_count",
  "retry_count",
  "max_retries",
  "queue_enabled",
] as const;

export type AionUiScheduleBridgeMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface AionUiScheduleBridgeRequest {
  readonly contractVersion: typeof AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION;
  readonly method: AionUiScheduleBridgeMethod;
  readonly path: string;
  readonly body: unknown;
}

export type AionUiScheduleBridgeRoute =
  | Readonly<{ kind: "list"; nativeConversationId?: string }>
  | Readonly<{ kind: "get"; jobId: string }>
  | Readonly<{ kind: "create"; body: Record<string, unknown> }>
  | Readonly<{ kind: "update"; jobId: string; body: Record<string, unknown> }>
  | Readonly<{ kind: "remove"; jobId: string }>
  | Readonly<{ kind: "run"; jobId: string }>
  | Readonly<{ kind: "history"; jobId: string }>
  | Readonly<{ kind: "skill"; jobId: string }>;

export interface NativeAionUiScheduleConversation {
  readonly id: string;
  readonly name: string;
  readonly extra: Readonly<{ cron_job_id: string }>;
  readonly created_at: number;
  readonly updated_at: number;
}

export type AionUiScheduleBridgeSuccessData =
  | NativeAionUiCronJob
  | readonly NativeAionUiCronJob[]
  | null
  | Readonly<{ conversation_id: string }>
  | readonly NativeAionUiScheduleConversation[];

const ERROR_STATUS = Object.freeze({
  "schedule-invalid-request": 400,
  "schedule-untrusted-sender": 403,
  "schedule-not-found": 404,
  "schedule-active": 409,
  "schedule-busy": 409,
  "schedule-conflict": 409,
  "schedule-expired": 410,
  "schedule-execution-failed": 500,
  "schedule-skill-unsupported": 501,
  "schedule-unavailable": 503,
} as const);

export type AionUiScheduleBridgeErrorCode = keyof typeof ERROR_STATUS;
export type AionUiScheduleBridgeErrorStatus = (typeof ERROR_STATUS)[AionUiScheduleBridgeErrorCode];

export type AionUiScheduleBridgeResponse =
  | Readonly<{
      contractVersion: typeof AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION;
      status: 200;
      data: AionUiScheduleBridgeSuccessData;
    }>
  | Readonly<{
      contractVersion: typeof AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION;
      status: AionUiScheduleBridgeErrorStatus;
      code: AionUiScheduleBridgeErrorCode;
      message: string;
    }>;

export type AionUiScheduleEvent =
  | Readonly<{ type: "cron.job-created"; payload: NativeAionUiCronJob }>
  | Readonly<{ type: "cron.job-updated"; payload: NativeAionUiCronJob }>
  | Readonly<{ type: "cron.job-removed"; payload: Readonly<{ job_id: string }> }>
  | Readonly<{
      type: "cron.job-executed";
      payload: Readonly<{
        job_id: string;
        status: AionUiScheduleLastStatus;
        error?: string;
      }>;
    }>;

export type AionUiScheduleEventHandler = (event: AionUiScheduleEvent) => void;

export interface AionUiScheduleBridgeApi {
  request(request: AionUiScheduleBridgeRequest): Promise<AionUiScheduleBridgeResponse>;
  onEvent(handler: AionUiScheduleEventHandler): () => void;
}

declare global {
  interface Window {
    actestraSchedule?: AionUiScheduleBridgeApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new Error(`${label} contains unsupported field ${unexpected}`);
  }
}

function assertRequiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) {
    throw new Error(`${label} is missing field ${missing}`);
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function assertBoundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.trim() !== value ||
    new TextEncoder().encode(value).byteLength > maximumBytes ||
    hasControlCharacter(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertOptionalBoundedText(
  value: unknown,
  label: string,
  maximumBytes: number,
): asserts value is string | undefined {
  if (value !== undefined) assertBoundedText(value, label, maximumBytes);
}

function assertSafeTimestamp(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
}

function assertCounter(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
}

function decodeComponent(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    throw new Error(`${label} is malformed`, { cause: error });
  }
}

function parsePath(value: string): { pathname: string; query: string | undefined } {
  assertBoundedText(value, "AionUI schedule bridge path", MAX_BRIDGE_PATH_BYTES);
  if (!value.startsWith("/") || value.includes("#") || value.includes("\\")) {
    throw new Error("AionUI schedule bridge path is invalid");
  }
  const queryIndex = value.indexOf("?");
  const pathname = queryIndex === -1 ? value : value.slice(0, queryIndex);
  const query = queryIndex === -1 ? undefined : value.slice(queryIndex + 1);
  if (pathname.includes("//") || pathname.endsWith("/") || query === "") {
    throw new Error("AionUI schedule bridge path is invalid");
  }
  for (const rawSegment of pathname.split("/")) {
    if (rawSegment.length === 0) continue;
    const segment = decodeComponent(rawSegment, "AionUI schedule bridge path segment");
    if (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\")) {
      throw new Error("AionUI schedule bridge path traversal is invalid");
    }
  }
  return { pathname, query };
}

function parseConversationQuery(query: string): string {
  const fields = query.split("&");
  if (fields.length !== 1) {
    throw new Error("AionUI schedule bridge query is ambiguous");
  }
  const equalsIndex = fields[0]!.indexOf("=");
  if (equalsIndex <= 0 || fields[0]!.indexOf("=", equalsIndex + 1) !== -1) {
    throw new Error("AionUI schedule bridge query is invalid");
  }
  const rawKey = fields[0]!.slice(0, equalsIndex);
  const rawConversationId = fields[0]!.slice(equalsIndex + 1);
  const key = decodeComponent(rawKey, "AionUI schedule query key");
  const conversationId = decodeComponent(rawConversationId, "AionUI schedule conversation query");
  if (
    key !== "conversation_id" ||
    rawKey !== encodeURIComponent(key) ||
    rawConversationId !== encodeURIComponent(conversationId)
  ) {
    throw new Error("AionUI schedule bridge query is unsupported");
  }
  assertAionUiNativeConversationId(conversationId);
  return conversationId;
}

function assertNoBody(body: unknown): void {
  if (body !== undefined) throw new Error("AionUI schedule bridge route does not accept a body");
}

function assertJobPathSegment(rawJobId: string): string {
  const jobId = decodeComponent(rawJobId, "AionUI schedule job identity");
  if (jobId !== rawJobId) {
    throw new Error("AionUI schedule job identity must use its canonical path form");
  }
  assertAionUiScheduleJobId(jobId);
  return jobId;
}

function parseRoute(request: AionUiScheduleBridgeRequest): AionUiScheduleBridgeRoute {
  const { pathname, query } = parsePath(request.path);
  const segments = pathname.split("/").slice(1);
  if (segments[0] !== "api" || segments[1] !== "cron" || segments[2] !== "jobs") {
    throw new Error("AionUI schedule bridge route is unsupported");
  }
  if (segments.length === 3) {
    if (request.method === "GET") {
      assertNoBody(request.body);
      return Object.freeze({
        kind: "list" as const,
        ...(query === undefined ? {} : { nativeConversationId: parseConversationQuery(query) }),
      });
    }
    if (query !== undefined) throw new Error("AionUI schedule bridge write query is unsupported");
    if (request.method === "POST" && isRecord(request.body)) {
      assertExactKeys(request.body, CREATE_BODY_KEYS, "AionUI schedule create body");
      assertRequiredKeys(
        request.body,
        ["name", "schedule", "prompt", "conversation_id", "created_by", "execution_mode"],
        "AionUI schedule create body",
      );
      return Object.freeze({ kind: "create" as const, body: request.body });
    }
    throw new Error("AionUI schedule bridge collection method is unsupported");
  }
  if (query !== undefined || segments.length < 4) {
    throw new Error("AionUI schedule bridge item route is invalid");
  }
  const jobId = assertJobPathSegment(segments[3]!);
  if (segments.length === 4) {
    if (request.method === "GET") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "get" as const, jobId });
    }
    if (request.method === "PUT" && isRecord(request.body)) {
      assertExactKeys(request.body, UPDATE_BODY_KEYS, "AionUI schedule update body");
      if (Object.keys(request.body).length === 0) {
        throw new Error("AionUI schedule update body must not be empty");
      }
      return Object.freeze({ kind: "update" as const, jobId, body: request.body });
    }
    if (request.method === "DELETE") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "remove" as const, jobId });
    }
    throw new Error("AionUI schedule bridge item method is unsupported");
  }
  if (segments.length !== 5) throw new Error("AionUI schedule bridge route is unsupported");
  if (segments[4] === "run" && request.method === "POST") {
    if (!isRecord(request.body)) throw new Error("AionUI schedule run body is invalid");
    assertExactKeys(request.body, ["job_id"], "AionUI schedule run body");
    assertRequiredKeys(request.body, ["job_id"], "AionUI schedule run body");
    if (request.body.job_id !== jobId) throw new Error("AionUI schedule run identity is invalid");
    return Object.freeze({ kind: "run" as const, jobId });
  }
  if (segments[4] === "conversations" && request.method === "GET") {
    assertNoBody(request.body);
    return Object.freeze({ kind: "history" as const, jobId });
  }
  if (segments[4] === "skill" && ["GET", "POST", "DELETE"].includes(request.method)) {
    if (request.method === "POST") {
      if (!isRecord(request.body)) throw new Error("AionUI schedule Skill body is invalid");
      assertExactKeys(request.body, ["content"], "AionUI schedule Skill body");
      assertRequiredKeys(request.body, ["content"], "AionUI schedule Skill body");
      assertBoundedText(
        request.body.content,
        "AionUI schedule Skill content",
        MAX_SKILL_CONTENT_BYTES,
      );
    } else {
      assertNoBody(request.body);
    }
    return Object.freeze({ kind: "skill" as const, jobId });
  }
  throw new Error("AionUI schedule bridge route is unsupported");
}

export function assertAionUiScheduleBridgeRequest(
  value: unknown,
): asserts value is AionUiScheduleBridgeRequest {
  if (!isRecord(value)) throw new Error("AionUI schedule bridge request must be an object");
  assertExactKeys(value, REQUEST_KEYS, "AionUI schedule bridge request");
  assertRequiredKeys(value, REQUEST_KEYS, "AionUI schedule bridge request");
  if (
    value.contractVersion !== AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION ||
    !["GET", "POST", "PUT", "DELETE"].includes(value.method as string) ||
    typeof value.path !== "string"
  ) {
    throw new Error("AionUI schedule bridge request envelope is invalid");
  }
  parseRoute(value as unknown as AionUiScheduleBridgeRequest);
}

export function parseAionUiScheduleBridgeRequest(value: unknown): AionUiScheduleBridgeRoute {
  assertAionUiScheduleBridgeRequest(value);
  return parseRoute(value);
}

function assertSchedule(value: unknown): asserts value is AionUiSchedule {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error("Native AionUI schedule is invalid");
  }
  if (value.kind === "at") {
    assertExactKeys(value, ["kind", "atMs", "description"], "Native AionUI at schedule");
    assertSafeTimestamp(value.atMs, "Native AionUI at schedule instant");
  } else if (value.kind === "every") {
    assertExactKeys(value, ["kind", "everyMs", "description"], "Native AionUI every schedule");
    if (
      typeof value.everyMs !== "number" ||
      !Number.isSafeInteger(value.everyMs) ||
      value.everyMs < 60_000 ||
      value.everyMs > 31_536_000_000
    ) {
      throw new Error("Native AionUI every schedule interval is invalid");
    }
  } else if (value.kind === "cron") {
    assertExactKeys(value, ["kind", "expr", "tz", "description"], "Native AionUI cron schedule");
    assertBoundedText(value.expr, "Native AionUI cron expression", MAX_CRON_EXPRESSION_BYTES, true);
    assertOptionalBoundedText(value.tz, "Native AionUI cron time zone", MAX_TIME_ZONE_BYTES);
  } else {
    throw new Error("Native AionUI schedule kind is unsupported");
  }
  assertBoundedText(
    value.description,
    "Native AionUI schedule description",
    MAX_SCHEDULE_DESCRIPTION_BYTES,
  );
  calculateAionUiScheduleNextRun(
    value as unknown as AionUiSchedule,
    value.kind === "at" && typeof value.atMs === "number" ? value.atMs : Date.now(),
  );
}

export function assertNativeAionUiCronJob(value: unknown): asserts value is NativeAionUiCronJob {
  if (!isRecord(value)) throw new Error("Native AionUI cron job must be an object");
  assertExactKeys(value, JOB_KEYS, "Native AionUI cron job");
  assertRequiredKeys(
    value,
    ["id", "name", "enabled", "schedule", "target", "metadata", "state"],
    "Native AionUI cron job",
  );
  assertAionUiScheduleJobId(value.id);
  assertBoundedText(value.name, "Native AionUI cron job name", MAX_NAME_BYTES);
  assertOptionalBoundedText(
    value.description,
    "Native AionUI cron job description",
    MAX_DESCRIPTION_BYTES,
  );
  if (typeof value.enabled !== "boolean")
    throw new Error("Native AionUI cron enabled state is invalid");
  assertSchedule(value.schedule);

  if (!isRecord(value.target)) throw new Error("Native AionUI cron target is invalid");
  assertExactKeys(value.target, TARGET_KEYS, "Native AionUI cron target");
  assertRequiredKeys(value.target, TARGET_KEYS, "Native AionUI cron target");
  if (value.target.execution_mode !== "existing" || !isRecord(value.target.payload)) {
    throw new Error("Native AionUI cron target is invalid");
  }
  assertExactKeys(value.target.payload, PAYLOAD_KEYS, "Native AionUI cron payload");
  assertRequiredKeys(value.target.payload, PAYLOAD_KEYS, "Native AionUI cron payload");
  assertBoundedText(
    value.target.payload.text,
    "Native AionUI cron prompt",
    AIONUI_GENERAL_WORK_MAX_PROMPT_BYTES,
  );
  const parsed = parseAionUiGeneralWorkCommand(value.target.payload.text);
  if (parsed === null || parsed.journeyKind !== "prompt-artifact" || parsed.prompt.length === 0) {
    throw new Error("Native AionUI cron prompt is invalid");
  }
  if (value.target.payload.kind !== "message")
    throw new Error("Native AionUI cron payload is invalid");

  if (!isRecord(value.metadata)) throw new Error("Native AionUI cron metadata is invalid");
  assertExactKeys(value.metadata, METADATA_KEYS, "Native AionUI cron metadata");
  assertRequiredKeys(
    value.metadata,
    ["conversation_id", "agent_type", "created_by", "created_at", "updated_at", "agent_config"],
    "Native AionUI cron metadata",
  );
  assertAionUiNativeConversationId(value.metadata.conversation_id);
  assertOptionalBoundedText(
    value.metadata.conversation_title,
    "Native AionUI conversation title",
    MAX_CONVERSATION_TITLE_BYTES,
  );
  if (
    value.metadata.agent_type !== ACTESTRA_GENERAL_WORKER_AGENT_TYPE ||
    value.metadata.created_by !== "user"
  ) {
    throw new Error("Native AionUI cron agent authority is invalid");
  }
  assertSafeTimestamp(value.metadata.created_at, "Native AionUI cron created instant");
  assertSafeTimestamp(value.metadata.updated_at, "Native AionUI cron updated instant");
  if (
    value.metadata.updated_at < value.metadata.created_at ||
    !isRecord(value.metadata.agent_config)
  ) {
    throw new Error("Native AionUI cron metadata is inconsistent");
  }
  assertExactKeys(
    value.metadata.agent_config,
    AGENT_CONFIG_KEYS,
    "Native AionUI cron agent config",
  );
  assertRequiredKeys(
    value.metadata.agent_config,
    AGENT_CONFIG_KEYS,
    "Native AionUI cron agent config",
  );
  if (
    value.metadata.agent_config.name !== "Actestra General Worker" ||
    value.metadata.agent_config.is_preset !== true
  ) {
    throw new Error("Native AionUI cron agent config is invalid");
  }

  if (!isRecord(value.state)) throw new Error("Native AionUI cron state is invalid");
  assertExactKeys(value.state, STATE_KEYS, "Native AionUI cron state");
  assertRequiredKeys(
    value.state,
    ["run_count", "retry_count", "max_retries", "queue_enabled"],
    "Native AionUI cron state",
  );
  if (value.state.next_run_at_ms !== undefined) {
    assertSafeTimestamp(value.state.next_run_at_ms, "Native AionUI cron next instant");
  }
  if (value.state.last_run_at_ms !== undefined) {
    assertSafeTimestamp(value.state.last_run_at_ms, "Native AionUI cron last instant");
  }
  if (
    value.state.last_status !== undefined &&
    !["ok", "error", "skipped", "missed"].includes(value.state.last_status as string)
  ) {
    throw new Error("Native AionUI cron terminal status is invalid");
  }
  assertOptionalBoundedText(
    value.state.last_error,
    "Native AionUI cron incident",
    MAX_INCIDENT_CODE_BYTES,
  );
  assertCounter(value.state.run_count, "Native AionUI cron run count");
  if (
    value.state.retry_count !== 0 ||
    value.state.max_retries !== 0 ||
    value.state.queue_enabled !== false
  ) {
    throw new Error("Native AionUI cron retry or queue authority is invalid");
  }
}

function assertConversation(value: unknown): asserts value is NativeAionUiScheduleConversation {
  if (!isRecord(value)) throw new Error("Native AionUI schedule history entry is invalid");
  assertExactKeys(
    value,
    ["id", "name", "extra", "created_at", "updated_at"],
    "Native AionUI schedule history entry",
  );
  assertRequiredKeys(
    value,
    ["id", "name", "extra", "created_at", "updated_at"],
    "Native AionUI schedule history entry",
  );
  assertAionUiNativeConversationId(value.id);
  assertBoundedText(
    value.name,
    "Native AionUI schedule history name",
    MAX_CONVERSATION_TITLE_BYTES,
  );
  if (!isRecord(value.extra)) throw new Error("Native AionUI schedule history metadata is invalid");
  assertExactKeys(value.extra, ["cron_job_id"], "Native AionUI schedule history metadata");
  assertRequiredKeys(value.extra, ["cron_job_id"], "Native AionUI schedule history metadata");
  assertAionUiScheduleJobId(value.extra.cron_job_id);
  assertSafeTimestamp(value.created_at, "Native AionUI schedule history created instant");
  assertSafeTimestamp(value.updated_at, "Native AionUI schedule history updated instant");
  if (value.updated_at < value.created_at)
    throw new Error("Native AionUI schedule history is inconsistent");
}

function assertSuccessData(value: unknown): asserts value is AionUiScheduleBridgeSuccessData {
  if (value === null) return;
  if (Array.isArray(value)) {
    if (value.length > AIONUI_SCHEDULE_MAX_JOBS)
      throw new Error("AionUI schedule result list is too large");
    if (value.length === 0) return;
    if (isRecord(value[0]) && Object.hasOwn(value[0], "schedule")) {
      value.forEach(assertNativeAionUiCronJob);
      return;
    }
    value.forEach(assertConversation);
    return;
  }
  if (!isRecord(value)) throw new Error("AionUI schedule success data is invalid");
  if (Object.hasOwn(value, "conversation_id")) {
    assertExactKeys(value, ["conversation_id"], "AionUI schedule run result");
    assertRequiredKeys(value, ["conversation_id"], "AionUI schedule run result");
    assertAionUiNativeConversationId(value.conversation_id);
    return;
  }
  assertNativeAionUiCronJob(value);
}

export function assertAionUiScheduleBridgeResponse(
  value: unknown,
): asserts value is AionUiScheduleBridgeResponse {
  if (!isRecord(value)) throw new Error("AionUI schedule bridge response must be an object");
  if (value.contractVersion !== AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION) {
    throw new Error("AionUI schedule bridge response version is invalid");
  }
  if (value.status === 200) {
    assertExactKeys(
      value,
      ["contractVersion", "status", "data"],
      "AionUI schedule success response",
    );
    assertRequiredKeys(
      value,
      ["contractVersion", "status", "data"],
      "AionUI schedule success response",
    );
    assertSuccessData(value.data);
    return;
  }
  assertExactKeys(
    value,
    ["contractVersion", "status", "code", "message"],
    "AionUI schedule error response",
  );
  assertRequiredKeys(
    value,
    ["contractVersion", "status", "code", "message"],
    "AionUI schedule error response",
  );
  if (
    typeof value.code !== "string" ||
    !Object.hasOwn(ERROR_STATUS, value.code) ||
    value.status !== ERROR_STATUS[value.code as AionUiScheduleBridgeErrorCode]
  ) {
    throw new Error("AionUI schedule bridge error status is invalid");
  }
  assertBoundedText(
    value.message,
    "AionUI schedule bridge error message",
    MAX_BRIDGE_MESSAGE_BYTES,
  );
}

export function assertAionUiScheduleEvent(value: unknown): asserts value is AionUiScheduleEvent {
  if (!isRecord(value) || typeof value.type !== "string" || !isRecord(value.payload)) {
    throw new Error("AionUI schedule event must be an object");
  }
  assertExactKeys(value, ["type", "payload"], "AionUI schedule event");
  assertRequiredKeys(value, ["type", "payload"], "AionUI schedule event");
  if (value.type === "cron.job-created" || value.type === "cron.job-updated") {
    assertNativeAionUiCronJob(value.payload);
    return;
  }
  if (value.type === "cron.job-removed") {
    assertExactKeys(value.payload, ["job_id"], "AionUI schedule removed event");
    assertRequiredKeys(value.payload, ["job_id"], "AionUI schedule removed event");
    assertAionUiScheduleJobId(value.payload.job_id);
    return;
  }
  if (value.type === "cron.job-executed") {
    assertExactKeys(value.payload, ["job_id", "status", "error"], "AionUI schedule executed event");
    assertRequiredKeys(value.payload, ["job_id", "status"], "AionUI schedule executed event");
    assertAionUiScheduleJobId(value.payload.job_id);
    if (!["ok", "error", "skipped", "missed"].includes(value.payload.status as string)) {
      throw new Error("AionUI schedule executed status is invalid");
    }
    assertOptionalBoundedText(
      value.payload.error,
      "AionUI schedule executed incident",
      MAX_INCIDENT_CODE_BYTES,
    );
    return;
  }
  throw new Error("AionUI schedule event type is unsupported");
}
