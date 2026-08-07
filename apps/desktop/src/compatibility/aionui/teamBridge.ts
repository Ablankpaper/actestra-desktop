import {
  TEAM_MAX_DESCRIPTION_BYTES,
  TEAM_MAX_MEMBERS,
  TEAM_MAX_NAME_BYTES,
  STANDARD_TEAM_MESSAGE_DELIVERY_MAX_NONCE_BYTES,
  teamExperienceId,
  teamId,
  teamMemberId,
  teamRunId,
  workspaceId,
} from "../../core";

export const AIONUI_TEAM_BRIDGE_CONTRACT_VERSION = 1 as const;
export const ACTESTRA_TEAM_REQUEST_CHANNEL = "actestra:team-request-v1" as const;
export const ACTESTRA_TEAM_EVENT_CHANNEL = "actestra:team-event-v1" as const;
export const ACTESTRA_TEAM_LOCAL_USER_ID = "actestra-local-user" as const;

const MAX_PATH_BYTES = 4 * 1024;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_REASON_BYTES = 2 * 1024;
const MAX_EXPLANATION_BYTES = 4 * 1024;
const MAX_SUMMARY_BYTES = 8 * 1024;
const MAX_CONVERSATION_BYTES = 256;
const MAX_EVENT_TEXT_BYTES = 4 * 1024;
const MAX_STANDARD_IDENTIFIER_BYTES = 256;
const MAX_MODEL_IDENTIFIER_BYTES = 256;
const MAX_TEAM_ATTACHMENTS = 32;
const REQUEST_KEYS = ["contractVersion", "method", "path", "body"] as const;
const FIXED_ASSISTANTS = ["actestra-general-worker", "actestra-goose-worker"] as const;
const CONTROL_ACTIONS = [
  "approve",
  "deny",
  "pause",
  "resume",
  "cancel",
  "retry",
  "replace",
  "handoff",
] as const;

export type AionUiTeamBridgeMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AionUiTeamCapability = "general" | "coding";
export type AionUiTeamMemberRole = "leader" | "teammate";

export interface AionUiTeamBridgeRequest {
  readonly contractVersion: typeof AIONUI_TEAM_BRIDGE_CONTRACT_VERSION;
  readonly method: AionUiTeamBridgeMethod;
  readonly path: string;
  readonly body: unknown;
}

export interface AionUiTeamMemberInput {
  readonly displayName: string;
  readonly role: AionUiTeamMemberRole;
  readonly capability: AionUiTeamCapability;
}

export interface AionUiStandardTeamMemberIntent {
  readonly displayName: string;
  readonly role: AionUiTeamMemberRole;
  readonly assistantId: string;
  readonly requestedModel: string | null;
}

export type AionUiTeamBridgeRoute =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "list-workspaces" }>
  | Readonly<{ kind: "select-workspace" }>
  | Readonly<{
      kind: "create";
      experience: "orchestrated";
      name: string;
      description: string | null;
      workspaceId: string;
      members: readonly AionUiTeamMemberInput[];
    }>
  | Readonly<{
      kind: "create-standard";
      userId: string;
      name: string;
      workspace: string;
      workspaceMode: "shared";
      members: readonly AionUiStandardTeamMemberIntent[];
    }>
  | Readonly<{
      kind: "add-standard-member";
      teamId: string;
      member: AionUiStandardTeamMemberIntent;
    }>
  | Readonly<{
      kind: "get" | "remove" | "ensure-session" | "stop-session" | "active-lease" | "run-state";
      teamId: string;
    }>
  | Readonly<{
      kind: "set-session-mode";
      teamId: string;
      conversationId: string;
      mode: string;
    }>
  | Readonly<{ kind: "add-member"; teamId: string; member: AionUiTeamMemberInput }>
  | Readonly<{ kind: "remove-member" | "attach-member"; teamId: string; slotId: string }>
  | Readonly<{ kind: "config-options"; teamId: string; conversationId: string }>
  | Readonly<{
      kind: "set-config-option";
      teamId: string;
      conversationId: string;
      optionId: string;
      value: string;
    }>
  | Readonly<{ kind: "rename-member"; teamId: string; slotId: string; name: string }>
  | Readonly<{ kind: "rename-team"; teamId: string; name: string }>
  | Readonly<{
      kind: "send-message";
      teamId: string;
      content: string;
      files: readonly string[];
      requestNonce: string;
    }>
  | Readonly<{
      kind: "send-member-message";
      teamId: string;
      slotId: string;
      content: string;
      files: readonly string[];
      requestNonce: string;
    }>
  | Readonly<{ kind: "cancel-run"; teamId: string; runId: string; reason: string }>
  | Readonly<{
      kind:
        | "cancel-node"
        | "pause-node"
        | "resume-node"
        | "retry-node"
        | "replace-node"
        | "handoff-node";
      teamId: string;
      runId: string;
      slotId: string;
      reason: string;
    }>
  | Readonly<{
      kind: "decide-approval";
      teamId: string;
      runId: string;
      slotId: string;
      decision: "approved" | "denied";
    }>
  | Readonly<{
      kind: "resolve-feedback";
      teamId: string;
      runId: string;
      decision: "approved" | "denied";
      note: string;
    }>;

export interface NativeAionUiTeamAssistant {
  readonly slot_id: string;
  readonly conversation_id: string;
  readonly role: AionUiTeamMemberRole;
  readonly assistant_backend: "general" | "goose";
  readonly assistant_name: string;
  readonly status: "pending" | "idle" | "active" | "completed" | "failed" | "dormant";
  readonly assistant_id: (typeof FIXED_ASSISTANTS)[number];
  readonly model: "default";
  readonly pending_confirmations: number;
}

export interface NativeAionUiTeam {
  readonly id: string;
  readonly experience: "orchestrated";
  readonly user_id: typeof ACTESTRA_TEAM_LOCAL_USER_ID;
  readonly name: string;
  readonly description: string | null;
  readonly workspace: string;
  readonly workspace_mode: "isolated";
  readonly leader_assistant_id: string;
  readonly assistants: readonly NativeAionUiTeamAssistant[];
  readonly session_mode: "plan";
  readonly created_at: number;
  readonly updated_at: number;
}

export interface NativeAionUiStandardTeamAssistant {
  readonly slot_id: string;
  readonly conversation_id: string;
  readonly role: AionUiTeamMemberRole;
  readonly assistant_backend: string;
  readonly assistant_name: string;
  readonly status: "pending" | "idle" | "active" | "completed" | "failed" | "dormant";
  readonly assistant_id: string;
  readonly model: string;
  readonly pending_confirmations: number;
}

export interface NativeAionUiStandardTeam {
  readonly id: string;
  readonly experience: "standard";
  readonly user_id: string;
  readonly name: string;
  readonly workspace: string;
  readonly workspace_mode: "shared" | "isolated";
  readonly leader_assistant_id: string;
  readonly assistants: readonly NativeAionUiStandardTeamAssistant[];
  readonly session_mode?: string;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface NativeAionUiStandardTeamMemberAck {
  readonly experience: "standard";
  readonly assistant: NativeAionUiStandardTeamAssistant;
}

export interface NativeAionUiTeamWorkspaceOption {
  readonly workspace_id: string;
  readonly display_name: string;
}

export interface NativeAionUiTeamWorkspaceOptions {
  readonly workspace_options: readonly NativeAionUiTeamWorkspaceOption[];
}

export interface NativeAionUiTeamSlotWork {
  readonly slot_id: string;
  readonly role: "lead" | "teammate";
  readonly state: "idle" | "queued" | "starting" | "running" | "paused" | "blocked";
  readonly queued_foreground_count: number;
  readonly queued_background_count: number;
  readonly active_turn_id: string | null;
  readonly active_turn_started_at_ms: number | null;
  readonly active_turn_elapsed_ms: number | null;
  readonly active_turn_slow: boolean | null;
  readonly active_turn_slow_threshold_ms: number | null;
  readonly blocked_reason: string | null;
  readonly team_run_id: string | null;
}

export interface NativeAionUiTeamArtifactReference {
  readonly artifact_id: string;
  readonly kind: "file" | "document" | "dataset" | "directory" | "other";
  readonly label: string;
}

export interface NativeAionUiTeamNodeView {
  readonly action_id: string;
  readonly slot_id: string;
  readonly title: string;
  readonly capability: "general" | "coding" | "feedback";
  readonly state:
    | "queued"
    | "ready"
    | "running"
    | "blocked"
    | "paused"
    | "handoff-required"
    | "completed"
    | "failed"
    | "cancelled";
  readonly depends_on_action_ids: readonly string[];
  readonly blocked_reason: string | null;
  readonly blocked_explanation: string | null;
  readonly current_executor: "General Worker" | "Goose" | "User" | "None";
  readonly next_actions: readonly (typeof CONTROL_ACTIONS)[number][];
  readonly artifacts: readonly NativeAionUiTeamArtifactReference[];
}

export interface NativeAionUiTeamRunEvent {
  readonly team_id: string;
  readonly team_run_id: string;
  readonly source: "user_message" | "system_lifecycle";
  readonly has_user_intervention: boolean;
  readonly target_slot_id: string;
  readonly target_role: "lead" | "teammate";
  readonly status: "accepted" | "running" | "cancelling" | "completed" | "cancelled" | "failed";
  readonly queued_intent_count: number;
  readonly starting_batch_count: number;
  readonly running_batch_count: number;
  readonly active_enqueue_lease_count: number;
  readonly slot_work: readonly NativeAionUiTeamSlotWork[];
  readonly actestra: Readonly<{
    authority: "Actestra Core";
    authority_source: "schema-15-team-run";
    revision: number;
    status_explanation: string;
    nodes: readonly NativeAionUiTeamNodeView[];
    result: Readonly<{
      summary: string;
      artifacts: readonly NativeAionUiTeamArtifactReference[];
    }> | null;
  }>;
}

export interface NativeAionUiTeamActivity {
  readonly id: string;
  readonly author: "You" | "General Worker" | "Goose";
  readonly content: string;
  readonly tone: "user" | "worker";
  readonly occurred_at: number;
}

export interface NativeAionUiTeamRunState {
  readonly session_generation: string | null;
  readonly submission: Readonly<{
    readonly availability: "available" | "unavailable";
    readonly blocked_reason: "planner-unavailable" | "worker-runtime-unavailable" | null;
    readonly next_action:
      | "submit-task"
      | "restart-after-planner-admission"
      | "configure-worker-runtime";
    readonly authority_source: "actestra-main-runtime";
  }>;
  readonly active_run: NativeAionUiTeamRunEvent | null;
  readonly slot_work: readonly NativeAionUiTeamSlotWork[];
  readonly activities: readonly NativeAionUiTeamActivity[];
}

export interface NativeAionUiTeamRunAck {
  readonly enqueue_status: "accepted" | "queued" | "blocked_runtime_starting";
  readonly message_id: string;
  readonly run: NativeAionUiTeamRunEvent;
}

export interface NativeAionUiStandardTeamRunEvent {
  readonly team_id: string;
  readonly team_run_id: string;
  readonly source: "user_message" | "system_lifecycle";
  readonly has_user_intervention: boolean;
  readonly target_slot_id: string;
  readonly target_role: "lead" | "teammate";
  readonly status: "accepted" | "running" | "cancelling" | "completed" | "cancelled" | "failed";
  readonly queued_intent_count: number;
  readonly starting_batch_count: number;
  readonly running_batch_count: number;
  readonly active_enqueue_lease_count: number;
  readonly slot_work: readonly NativeAionUiTeamSlotWork[];
}

export interface NativeAionUiStandardTeamRunAck {
  readonly experience: "standard";
  readonly enqueue_status: "accepted" | "queued" | "blocked_runtime_starting";
  readonly message_id: string;
  readonly run: NativeAionUiStandardTeamRunEvent;
}

export interface NativeAionUiStandardTeamRunState {
  readonly experience: "standard";
  readonly session_generation: string | null;
  readonly active_run: NativeAionUiStandardTeamRunEvent | null;
  readonly slot_work: readonly NativeAionUiTeamSlotWork[];
}

export interface NativeAionUiTeamConfigOptions {
  readonly config_options: readonly NativeAionUiTeamConfigOption[];
}

export interface NativeAionUiTeamConfigOptionChoice {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}

export interface NativeAionUiTeamConfigOption {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly type: "select";
  readonly current_value: string | null;
  readonly options: readonly NativeAionUiTeamConfigOptionChoice[];
}

export type AionUiTeamBridgeSuccessData =
  | NativeAionUiTeam
  | NativeAionUiStandardTeam
  | NativeAionUiStandardTeamMemberAck
  | readonly (NativeAionUiTeam | NativeAionUiStandardTeam)[]
  | NativeAionUiTeamWorkspaceOption
  | NativeAionUiTeamWorkspaceOptions
  | NativeAionUiTeamAssistant
  | NativeAionUiTeamRunState
  | NativeAionUiTeamRunAck
  | NativeAionUiStandardTeamRunAck
  | NativeAionUiStandardTeamRunState
  | NativeAionUiTeamConfigOptions
  | null;

const ERROR_STATUS = Object.freeze({
  "team-invalid-request": 400,
  "team-untrusted-sender": 403,
  "team-not-found": 404,
  "team-conflict": 409,
  "team-active": 409,
  "team-model-unavailable": 409,
  "team-execution-failed": 500,
  "team-planner-unavailable": 503,
  "team-worker-runtime-unavailable": 503,
  "team-unavailable": 503,
} as const);

export type AionUiTeamBridgeErrorCode = keyof typeof ERROR_STATUS;
export type AionUiTeamBridgeErrorStatus = (typeof ERROR_STATUS)[AionUiTeamBridgeErrorCode];

export type AionUiTeamBridgeResponse =
  | Readonly<{ contractVersion: 1; status: 200; data: AionUiTeamBridgeSuccessData }>
  | Readonly<{
      contractVersion: 1;
      status: AionUiTeamBridgeErrorStatus;
      code: AionUiTeamBridgeErrorCode;
      message: string;
    }>;

export type AionUiTeamEvent =
  | Readonly<{ type: "team.created"; payload: Readonly<{ team_id: string; team_name: string }> }>
  | Readonly<{ type: "team.removed"; payload: Readonly<{ team_id: string }> }>
  | Readonly<{ type: "team.renamed"; payload: Readonly<{ team_id: string; team_name: string }> }>
  | Readonly<{
      type: "team.listChanged";
      payload: Readonly<{
        team_id: string;
        action: "created" | "removed" | "renamed" | "agent_added" | "agent_removed";
      }>;
    }>
  | Readonly<{
      type: "team.agentSpawned";
      payload: Readonly<{ team_id: string; assistant: NativeAionUiTeamAssistant }>;
    }>
  | Readonly<{ type: "team.agentRemoved"; payload: Readonly<{ team_id: string; slot_id: string }> }>
  | Readonly<{
      type: "team.agentRenamed";
      payload: Readonly<{ team_id: string; slot_id: string; name: string }>;
    }>
  | Readonly<{
      type: "team.teammateMessage";
      payload: Readonly<{
        conversation_id: string;
        content: string;
        from_slot_id: string;
        from_name: string;
      }>;
    }>
  | Readonly<{
      type:
        | "team.runAccepted"
        | "team.runStarted"
        | "team.runUpdated"
        | "team.runCompleted"
        | "team.runCancelled"
        | "team.runFailed";
      payload: NativeAionUiTeamRunEvent;
    }>
  | Readonly<{
      type: "team.slotWorkChanged";
      payload: Readonly<{ team_id: string; slot_work: NativeAionUiTeamSlotWork }>;
    }>;

export type AionUiTeamEventHandler = (event: AionUiTeamEvent) => void;

export interface AionUiTeamBridgeApi {
  request(request: AionUiTeamBridgeRequest): Promise<AionUiTeamBridgeResponse>;
  onEvent(handler: AionUiTeamEventHandler): () => void;
}

declare global {
  interface Window {
    actestraTeam?: AionUiTeamBridgeApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} has an invalid shape`);
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function assertText(
  value: unknown,
  label: string,
  maximumBytes: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    hasControlCharacter(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertModelIdentifier(value: unknown, label: string): asserts value is string {
  assertText(value, label, MAX_MODEL_IDENTIFIER_BYTES);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
}

function assertCounter(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} is invalid`);
}

function decodeCanonicalSegment(value: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    throw new Error(`${label} is malformed`, { cause: error });
  }
  if (
    encodeURIComponent(decoded) !== value ||
    decoded === "." ||
    decoded === ".." ||
    decoded.includes("/") ||
    decoded.includes("\\")
  ) {
    throw new Error(`${label} is invalid`);
  }
  return decoded;
}

function parsePath(value: unknown): {
  readonly segments: readonly string[];
  readonly query?: string;
} {
  assertText(value, "AionUI Team bridge path", MAX_PATH_BYTES);
  if (!value.startsWith("/") || value.includes("#") || value.includes("\\"))
    throw new Error("AionUI Team bridge path is invalid");
  const queryIndex = value.indexOf("?");
  const pathname = queryIndex < 0 ? value : value.slice(0, queryIndex);
  const query = queryIndex < 0 ? undefined : value.slice(queryIndex + 1);
  if (pathname.includes("//") || pathname.endsWith("/") || query === "")
    throw new Error("AionUI Team bridge path is invalid");
  return {
    segments: Object.freeze(
      pathname
        .split("/")
        .slice(1)
        .map((segment) => decodeCanonicalSegment(segment, "AionUI Team path segment")),
    ),
    ...(query === undefined ? {} : { query }),
  };
}

function assertNoBody(value: unknown): void {
  if (value !== undefined) throw new Error("AionUI Team bridge route does not accept a body");
}

function parseListQuery(value: string | undefined): void {
  if (value === undefined) throw new Error("AionUI Team list requires the fixed local user");
  const fields = value.split("&");
  if (fields.length !== 1) throw new Error("AionUI Team list query is ambiguous");
  const [rawKey, rawValue, extra] = fields[0]!.split("=");
  if (extra !== undefined || rawKey === undefined || rawValue === undefined)
    throw new Error("AionUI Team list query is invalid");
  if (
    decodeCanonicalSegment(rawKey, "AionUI Team list key") !== "user_id" ||
    decodeCanonicalSegment(rawValue, "AionUI Team list user") !== ACTESTRA_TEAM_LOCAL_USER_ID
  ) {
    throw new Error("AionUI Team list user is invalid");
  }
}

function parseMember(value: unknown): AionUiTeamMemberInput {
  if (!isRecord(value)) throw new Error("AionUI Team member input is invalid");
  assertExactKeys(value, ["name", "role", "assistant_id", "model"], "AionUI Team member input");
  assertText(value.name, "AionUI Team member name", TEAM_MAX_NAME_BYTES);
  if (value.role !== "lead" && value.role !== "teammate")
    throw new Error("AionUI Team member role is invalid");
  if (!FIXED_ASSISTANTS.includes(value.assistant_id as (typeof FIXED_ASSISTANTS)[number]))
    throw new Error("AionUI Team member assistant is not admitted");
  if (value.model !== "default") throw new Error("AionUI Team renderer cannot select a model");
  return Object.freeze({
    displayName: value.name,
    role: value.role === "lead" ? "leader" : "teammate",
    capability: value.assistant_id === "actestra-general-worker" ? "general" : "coding",
  });
}

function parseStandardMember(value: unknown): AionUiStandardTeamMemberIntent {
  if (!isRecord(value)) throw new Error("AionUI standard Team member intent is invalid");
  assertExactKeys(
    value,
    ["name", "role", "assistant_id", "requested_model"],
    "AionUI standard Team member intent",
  );
  assertText(value.name, "AionUI standard Team member name", TEAM_MAX_NAME_BYTES);
  assertText(
    value.assistant_id,
    "AionUI standard Team assistant selection",
    MAX_STANDARD_IDENTIFIER_BYTES,
  );
  if (value.role !== "lead" && value.role !== "teammate") {
    throw new Error("AionUI standard Team member role is invalid");
  }
  const rawRequestedModel = value.requested_model;
  let requestedModel: string | null;
  if (rawRequestedModel === null) {
    requestedModel = null;
  } else {
    assertText(
      rawRequestedModel,
      "AionUI standard Team requested model",
      MAX_MODEL_IDENTIFIER_BYTES,
    );
    requestedModel = rawRequestedModel;
  }
  return Object.freeze({
    displayName: value.name,
    role: value.role === "lead" ? "leader" : "teammate",
    assistantId: value.assistant_id,
    requestedModel,
  });
}

function parseWorkspaceReference(value: unknown): string {
  const stableWorkspaceId = workspaceId(String(value));
  if (!/^workspace-[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/u.test(stableWorkspaceId)) {
    throw new Error("AionUI Team workspace must be an Actestra-owned reference");
  }
  return stableWorkspaceId;
}

function parseCreateBody(
  value: unknown,
): Extract<AionUiTeamBridgeRoute, { kind: "create" | "create-standard" }> {
  if (!isRecord(value)) throw new Error("AionUI Team create body is invalid");
  if (value.experience === "standard") {
    assertExactKeys(
      value,
      ["experience", "user_id", "name", "workspace", "workspace_mode", "agents"],
      "AionUI standard Team create body",
    );
    assertText(value.user_id, "AionUI standard Team user", MAX_STANDARD_IDENTIFIER_BYTES);
    if (value.user_id !== "system_default_user") {
      throw new Error("AionUI standard Team user is not Main-owned");
    }
    assertText(value.name, "AionUI standard Team name", TEAM_MAX_NAME_BYTES);
    assertText(value.workspace, "AionUI standard Team workspace selection", MAX_PATH_BYTES, true);
    if (value.workspace_mode !== "shared") {
      throw new Error("AionUI standard Team workspace mode is invalid");
    }
    if (
      !Array.isArray(value.agents) ||
      value.agents.length < 1 ||
      value.agents.length > TEAM_MAX_MEMBERS
    ) {
      throw new Error("AionUI standard Team members are invalid");
    }
    const members = Object.freeze(value.agents.map(parseStandardMember));
    if (members.filter(({ role }) => role === "leader").length !== 1) {
      throw new Error("AionUI standard Team requires exactly one leader");
    }
    return Object.freeze({
      kind: "create-standard",
      userId: value.user_id,
      name: value.name,
      workspace: value.workspace,
      workspaceMode: "shared",
      members,
    });
  }
  assertExactKeys(
    value,
    Object.hasOwn(value, "description")
      ? ["experience", "name", "description", "agents", "workspace"]
      : ["experience", "name", "agents", "workspace"],
    "AionUI Team create body",
  );
  if (value.experience !== "orchestrated") {
    throw new Error("AionUI Team create experience is invalid");
  }
  assertText(value.name, "AionUI Team name", TEAM_MAX_NAME_BYTES);
  if (
    !Array.isArray(value.agents) ||
    value.agents.length < 2 ||
    value.agents.length > TEAM_MAX_MEMBERS
  )
    throw new Error("AionUI Team members are invalid");
  const members = Object.freeze(value.agents.map(parseMember));
  if (
    members.filter(({ role }) => role === "leader").length !== 1 ||
    !members.some(({ capability }) => capability === "general") ||
    !members.some(({ capability }) => capability === "coding")
  ) {
    throw new Error("AionUI Team requires one leader and General plus Goose capabilities");
  }
  const description =
    value.description === undefined || value.description === null ? null : value.description;
  if (description !== null) {
    assertText(description, "AionUI Team description", TEAM_MAX_DESCRIPTION_BYTES);
  }
  return Object.freeze({
    kind: "create",
    experience: "orchestrated",
    name: value.name,
    description,
    workspaceId: parseWorkspaceReference(value.workspace),
    members,
  });
}

function parseNameBody(value: unknown): string {
  if (!isRecord(value)) throw new Error("AionUI Team rename body is invalid");
  assertExactKeys(value, ["name"], "AionUI Team rename body");
  assertText(value.name, "AionUI Team name", TEAM_MAX_NAME_BYTES);
  return value.name;
}

function parseReasonBody(value: unknown): string {
  if (!isRecord(value)) throw new Error("AionUI Team control body is invalid");
  assertExactKeys(value, ["reason"], "AionUI Team control body");
  assertText(value.reason, "AionUI Team control reason", MAX_REASON_BYTES);
  return value.reason;
}

function parseMessageBody(
  value: unknown,
  label: string,
): Readonly<{ content: string; files: readonly string[]; requestNonce: string }> {
  if (!isRecord(value)) throw new Error(`${label} is invalid`);
  const hasFiles = Object.hasOwn(value, "files");
  assertExactKeys(
    value,
    hasFiles ? ["content", "files", "request_nonce"] : ["content", "request_nonce"],
    label,
  );
  assertText(value.content, label, MAX_MESSAGE_BYTES);
  assertText(
    value.request_nonce,
    `${label} request nonce`,
    STANDARD_TEAM_MESSAGE_DELIVERY_MAX_NONCE_BYTES,
  );
  if (!hasFiles) {
    return Object.freeze({
      content: value.content,
      files: Object.freeze([]),
      requestNonce: value.request_nonce,
    });
  }
  if (!Array.isArray(value.files) || value.files.length > MAX_TEAM_ATTACHMENTS) {
    throw new Error(`${label} attachments are invalid`);
  }
  const files = Object.freeze(
    value.files.map((file) => {
      assertText(file, `${label} attachment`, MAX_PATH_BYTES);
      return file;
    }),
  );
  return Object.freeze({ content: value.content, files, requestNonce: value.request_nonce });
}

function parseConfigOptionBody(value: unknown): string {
  if (!isRecord(value)) throw new Error("AionUI Team config option body is invalid");
  assertExactKeys(value, ["value"], "AionUI Team config option body");
  assertText(value.value, "AionUI Team config option value", MAX_MODEL_IDENTIFIER_BYTES);
  return value.value;
}

function parseDecision(value: unknown): "approved" | "denied" {
  if (value !== "approved" && value !== "denied")
    throw new Error("AionUI Team decision is invalid");
  return value;
}

function parseRoute(request: AionUiTeamBridgeRequest): AionUiTeamBridgeRoute {
  const { segments, query } = parsePath(request.path);
  if (segments[0] !== "api" || segments[1] !== "teams")
    throw new Error("AionUI Team bridge route is unsupported");
  if (segments.length === 2) {
    if (request.method === "GET") {
      assertNoBody(request.body);
      parseListQuery(query);
      return Object.freeze({ kind: "list" });
    }
    if (request.method === "POST" && query === undefined) return parseCreateBody(request.body);
    throw new Error("AionUI Team collection route is unsupported");
  }
  if (query !== undefined || segments.length < 3)
    throw new Error("AionUI Team item route is invalid");
  if (segments.length === 3 && segments[2] === "workspace-options") {
    assertNoBody(request.body);
    if (request.method === "GET") return Object.freeze({ kind: "list-workspaces" });
    throw new Error("AionUI Team workspace route is unsupported");
  }
  if (segments.length === 4 && segments[2] === "workspace-options" && segments[3] === "select") {
    assertNoBody(request.body);
    if (request.method === "POST") return Object.freeze({ kind: "select-workspace" });
    throw new Error("AionUI Team workspace selection route is unsupported");
  }
  if (
    segments.length === 4 &&
    segments[3] === "agents" &&
    request.method === "POST" &&
    isRecord(request.body) &&
    request.body.experience === "standard"
  ) {
    assertText(segments[2], "AionUI standard Team identity", MAX_STANDARD_IDENTIFIER_BYTES);
    assertExactKeys(
      request.body,
      ["experience", "assistant"],
      "AionUI standard Team add-member body",
    );
    const member = parseStandardMember(request.body.assistant);
    if (member.role !== "teammate") {
      throw new Error("AionUI standard Team add-member role is invalid");
    }
    return Object.freeze({
      kind: "add-standard-member",
      teamId: segments[2],
      member,
    });
  }
  const stableTeam = teamExperienceId(segments[2]!);
  if (segments.length === 3) {
    assertNoBody(request.body);
    if (request.method === "GET") return Object.freeze({ kind: "get", teamId: stableTeam });
    if (request.method === "DELETE") return Object.freeze({ kind: "remove", teamId: stableTeam });
    throw new Error("AionUI Team item method is unsupported");
  }
  const resource = segments[3]!;
  if (segments.length === 4) {
    if (resource === "session") {
      assertNoBody(request.body);
      if (request.method === "POST")
        return Object.freeze({ kind: "ensure-session", teamId: stableTeam });
      if (request.method === "DELETE")
        return Object.freeze({ kind: "stop-session", teamId: stableTeam });
    }
    if (resource === "active-lease" && request.method === "POST") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "active-lease", teamId: stableTeam });
    }
    if (resource === "name" && request.method === "PATCH")
      return Object.freeze({
        kind: "rename-team",
        teamId: stableTeam,
        name: parseNameBody(request.body),
      });
    if (resource === "session-mode" && request.method === "POST") {
      if (!isRecord(request.body)) throw new Error("AionUI Team session mode is invalid");
      assertExactKeys(request.body, ["conversation_id", "mode"], "AionUI Team session mode");
      assertText(
        request.body.conversation_id,
        "AionUI Team session mode source",
        MAX_STANDARD_IDENTIFIER_BYTES,
      );
      assertModelIdentifier(request.body.mode, "AionUI Team session mode value");
      return Object.freeze({
        kind: "set-session-mode",
        teamId: stableTeam,
        conversationId: request.body.conversation_id,
        mode: request.body.mode,
      });
    }
    if (resource === "run-state" && request.method === "GET") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "run-state", teamId: stableTeam });
    }
    if (resource === "messages" && request.method === "POST") {
      const message = parseMessageBody(request.body, "AionUI Team message body");
      return Object.freeze({
        kind: "send-message",
        teamId: stableTeam,
        content: message.content,
        files: message.files,
        requestNonce: message.requestNonce,
      });
    }
    if (resource === "agents" && request.method === "POST") {
      if (!isRecord(request.body)) throw new Error("AionUI Team add-member body is invalid");
      assertExactKeys(request.body, ["assistant"], "AionUI Team add-member body");
      return Object.freeze({
        kind: "add-member",
        teamId: stableTeam,
        member: parseMember(request.body.assistant),
      });
    }
    throw new Error("AionUI Team item resource is unsupported");
  }
  if (resource === "conversations" && segments.length === 6 && segments[5] === "config-options") {
    if (request.method !== "GET") throw new Error("AionUI Team config route is unsupported");
    assertNoBody(request.body);
    const conversationId = segments[4]!;
    assertText(conversationId, "AionUI Team conversation identity", MAX_CONVERSATION_BYTES);
    return Object.freeze({ kind: "config-options", teamId: stableTeam, conversationId });
  }
  if (
    resource === "conversations" &&
    segments.length === 7 &&
    segments[5] === "config-options" &&
    request.method === "PUT"
  ) {
    assertText(segments[4]!, "AionUI Team conversation identity", MAX_CONVERSATION_BYTES);
    assertText(segments[6]!, "AionUI Team config option identity", MAX_STANDARD_IDENTIFIER_BYTES);
    return Object.freeze({
      kind: "set-config-option",
      teamId: stableTeam,
      conversationId: segments[4]!,
      optionId: segments[6]!,
      value: parseConfigOptionBody(request.body),
    });
  }
  if (resource === "agents" && segments.length >= 5) {
    const slotId = segments[4]!;
    assertText(slotId, "AionUI Team member identity", MAX_STANDARD_IDENTIFIER_BYTES);
    if (segments.length === 5) {
      if (request.method === "DELETE") {
        assertNoBody(request.body);
        return Object.freeze({ kind: "remove-member", teamId: stableTeam, slotId });
      }
      throw new Error("AionUI Team member route is unsupported");
    }
    if (segments.length !== 6) throw new Error("AionUI Team member route is unsupported");
    if (segments[5] === "name" && request.method === "PATCH")
      return Object.freeze({
        kind: "rename-member",
        teamId: stableTeam,
        slotId,
        name: parseNameBody(request.body),
      });
    if (segments[5] === "messages" && request.method === "POST") {
      const message = parseMessageBody(request.body, "AionUI Team member message");
      return Object.freeze({
        kind: "send-member-message",
        teamId: stableTeam,
        slotId,
        content: message.content,
        files: message.files,
        requestNonce: message.requestNonce,
      });
    }
    if (segments[5] === "attach" && request.method === "POST") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "attach-member", teamId: stableTeam, slotId });
    }
    throw new Error("AionUI Team member resource is unsupported");
  }
  if (resource === "runs" && segments.length >= 5) {
    const stableRun = segments[4]!;
    assertStandardProviderIdentity(stableRun, "AionUI Team run identity");
    if (segments.length === 6 && segments[5] === "cancel" && request.method === "POST")
      return Object.freeze({
        kind: "cancel-run",
        teamId: stableTeam,
        runId: stableRun,
        reason: parseReasonBody(request.body),
      });
    if (segments.length === 6 && segments[5] === "feedback" && request.method === "POST") {
      if (!isRecord(request.body)) throw new Error("AionUI Team feedback body is invalid");
      assertExactKeys(request.body, ["decision", "note"], "AionUI Team feedback body");
      assertText(request.body.note, "AionUI Team feedback note", MAX_REASON_BYTES);
      return Object.freeze({
        kind: "resolve-feedback",
        teamId: stableTeam,
        runId: stableRun,
        decision: parseDecision(request.body.decision),
        note: request.body.note,
      });
    }
    if (segments.length === 8 && segments[5] === "agents" && request.method === "POST") {
      const slotId = segments[6]!;
      assertStandardProviderIdentity(slotId, "AionUI Team run member identity");
      const action = segments[7]!;
      if (action === "approval") {
        if (!isRecord(request.body)) throw new Error("AionUI Team Approval body is invalid");
        assertExactKeys(request.body, ["decision"], "AionUI Team Approval body");
        return Object.freeze({
          kind: "decide-approval",
          teamId: stableTeam,
          runId: stableRun,
          slotId,
          decision: parseDecision(request.body.decision),
        });
      }
      const kinds = {
        cancel: "cancel-node",
        pause: "pause-node",
        resume: "resume-node",
        retry: "retry-node",
        replace: "replace-node",
        handoff: "handoff-node",
      } as const;
      const kind = kinds[action as keyof typeof kinds];
      if (kind !== undefined)
        return Object.freeze({
          kind,
          teamId: stableTeam,
          runId: stableRun,
          slotId,
          reason: parseReasonBody(request.body),
        });
    }
    throw new Error("AionUI Team run route is unsupported");
  }
  throw new Error("AionUI Team bridge route is unsupported");
}

export function assertAionUiTeamBridgeRequest(
  value: unknown,
): asserts value is AionUiTeamBridgeRequest {
  if (!isRecord(value)) throw new Error("AionUI Team bridge request must be an object");
  assertExactKeys(value, REQUEST_KEYS, "AionUI Team bridge request");
  if (
    value.contractVersion !== AIONUI_TEAM_BRIDGE_CONTRACT_VERSION ||
    !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(String(value.method))
  )
    throw new Error("AionUI Team bridge request is incompatible");
  parseRoute(value as unknown as AionUiTeamBridgeRequest);
}

export function parseAionUiTeamBridgeRequest(value: unknown): AionUiTeamBridgeRoute {
  assertAionUiTeamBridgeRequest(value);
  return parseRoute(value);
}

function assertAssistant(value: unknown): asserts value is NativeAionUiTeamAssistant {
  if (!isRecord(value)) throw new Error("Native AionUI Team assistant is invalid");
  assertExactKeys(
    value,
    [
      "slot_id",
      "conversation_id",
      "role",
      "assistant_backend",
      "assistant_name",
      "status",
      "assistant_id",
      "model",
      "pending_confirmations",
    ],
    "Native AionUI Team assistant",
  );
  teamMemberId(String(value.slot_id));
  assertText(value.conversation_id, "Native AionUI Team conversation", MAX_CONVERSATION_BYTES);
  if (
    !["leader", "teammate"].includes(String(value.role)) ||
    !["general", "goose"].includes(String(value.assistant_backend)) ||
    !["pending", "idle", "active", "completed", "failed", "dormant"].includes(
      String(value.status),
    ) ||
    !FIXED_ASSISTANTS.includes(value.assistant_id as (typeof FIXED_ASSISTANTS)[number]) ||
    value.model !== "default"
  ) {
    throw new Error("Native AionUI Team assistant fields are invalid");
  }
  assertText(value.assistant_name, "Native AionUI Team assistant name", TEAM_MAX_NAME_BYTES);
  assertCounter(value.pending_confirmations, "Native AionUI Team pending confirmations");
}

function assertStandardAssistant(
  value: unknown,
): asserts value is NativeAionUiStandardTeamAssistant {
  if (!isRecord(value)) throw new Error("Native AionUI standard Team assistant is invalid");
  assertExactKeys(
    value,
    [
      "slot_id",
      "conversation_id",
      "role",
      "assistant_backend",
      "assistant_name",
      "status",
      "assistant_id",
      "model",
      "pending_confirmations",
    ],
    "Native AionUI standard Team assistant",
  );
  assertText(value.slot_id, "Native AionUI standard Team slot", MAX_STANDARD_IDENTIFIER_BYTES);
  assertText(
    value.conversation_id,
    "Native AionUI standard Team conversation",
    MAX_CONVERSATION_BYTES,
  );
  assertText(value.assistant_backend, "Native AionUI standard Team runtime", 128);
  assertText(
    value.assistant_name,
    "Native AionUI standard Team assistant name",
    TEAM_MAX_NAME_BYTES,
  );
  assertText(
    value.assistant_id,
    "Native AionUI standard Team assistant identity",
    MAX_STANDARD_IDENTIFIER_BYTES,
  );
  assertText(value.model, "Native AionUI standard Team model", MAX_MODEL_IDENTIFIER_BYTES);
  if (
    !["leader", "teammate"].includes(String(value.role)) ||
    !["pending", "idle", "active", "completed", "failed", "dormant"].includes(String(value.status))
  ) {
    throw new Error("Native AionUI standard Team assistant fields are invalid");
  }
  assertCounter(value.pending_confirmations, "Native AionUI standard Team permissions");
}

export function assertNativeAionUiStandardTeam(
  value: unknown,
): asserts value is NativeAionUiStandardTeam {
  if (!isRecord(value)) throw new Error("Native AionUI standard Team is invalid");
  const requiredKeys = [
    "id",
    "experience",
    "user_id",
    "name",
    "workspace",
    "workspace_mode",
    "leader_assistant_id",
    "assistants",
    "created_at",
    "updated_at",
  ] as const;
  const allowedKeys = new Set<string>([...requiredKeys, "session_mode"]);
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw new Error("Native AionUI standard Team has an invalid shape");
  }
  assertText(value.id, "Native AionUI standard Team identity", MAX_STANDARD_IDENTIFIER_BYTES);
  assertText(value.user_id, "Native AionUI standard Team user", MAX_STANDARD_IDENTIFIER_BYTES);
  assertText(value.name, "Native AionUI standard Team name", TEAM_MAX_NAME_BYTES);
  assertText(value.workspace, "Native AionUI standard Team workspace", MAX_PATH_BYTES, true);
  assertText(
    value.leader_assistant_id,
    "Native AionUI standard Team leader",
    MAX_STANDARD_IDENTIFIER_BYTES,
  );
  if (Object.hasOwn(value, "session_mode")) {
    assertText(value.session_mode, "Native AionUI standard Team session mode", 128);
  }
  if (
    value.experience !== "standard" ||
    (value.workspace_mode !== "shared" && value.workspace_mode !== "isolated") ||
    !Array.isArray(value.assistants) ||
    value.assistants.length < 1 ||
    value.assistants.length > TEAM_MAX_MEMBERS
  ) {
    throw new Error("Native AionUI standard Team authority is invalid");
  }
  value.assistants.forEach(assertStandardAssistant);
  const leaders = value.assistants.filter(({ role }) => role === "leader");
  if (leaders.length !== 1 || leaders[0]!.slot_id !== value.leader_assistant_id) {
    throw new Error("Native AionUI standard Team leader is invalid");
  }
  assertCounter(value.created_at, "Native AionUI standard Team created instant");
  assertCounter(value.updated_at, "Native AionUI standard Team updated instant");
  if (value.updated_at < value.created_at) {
    throw new Error("Native AionUI standard Team time order is invalid");
  }
}

export function assertNativeAionUiTeam(value: unknown): asserts value is NativeAionUiTeam {
  if (!isRecord(value)) throw new Error("Native AionUI Team is invalid");
  assertExactKeys(
    value,
    [
      "id",
      "experience",
      "user_id",
      "name",
      "description",
      "workspace",
      "workspace_mode",
      "leader_assistant_id",
      "assistants",
      "session_mode",
      "created_at",
      "updated_at",
    ],
    "Native AionUI Team",
  );
  teamId(String(value.id));
  if (
    value.experience !== "orchestrated" ||
    value.user_id !== ACTESTRA_TEAM_LOCAL_USER_ID ||
    value.workspace_mode !== "isolated" ||
    value.session_mode !== "plan" ||
    !Array.isArray(value.assistants) ||
    value.assistants.length < 2 ||
    value.assistants.length > TEAM_MAX_MEMBERS
  ) {
    throw new Error("Native AionUI Team authority is invalid");
  }
  assertText(value.name, "Native AionUI Team name", TEAM_MAX_NAME_BYTES);
  if (value.description !== null) {
    assertText(value.description, "Native AionUI Team description", TEAM_MAX_DESCRIPTION_BYTES);
  }
  parseWorkspaceReference(value.workspace);
  teamMemberId(String(value.leader_assistant_id));
  value.assistants.forEach(assertAssistant);
  if (
    value.assistants.filter(({ role }) => role === "leader").length !== 1 ||
    !value.assistants.some(({ slot_id }) => slot_id === value.leader_assistant_id)
  ) {
    throw new Error("Native AionUI Team leader is invalid");
  }
  assertCounter(value.created_at, "Native AionUI Team created instant");
  assertCounter(value.updated_at, "Native AionUI Team updated instant");
  if (value.updated_at < value.created_at)
    throw new Error("Native AionUI Team time order is invalid");
}

const SLOT_BLOCKED_REASONS = [
  "runtime_starting",
  "runtime_failed",
  "removing",
  "session_stopped",
  "dependency",
  "human_feedback",
  "protected_approval",
  "attempt_failed",
  "cancelled",
  "paused",
  "handoff",
  "interrupted",
] as const;

function assertOptionalCounter(value: unknown, label: string): asserts value is number | null {
  if (value !== null) assertCounter(value, label);
}

function assertStandardProviderIdentity(value: unknown, label: string): asserts value is string {
  assertText(value, label, MAX_STANDARD_IDENTIFIER_BYTES);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
}

function assertStandardSlotWork(value: unknown): asserts value is NativeAionUiTeamSlotWork {
  if (!isRecord(value)) throw new Error("Native AionUI standard Team slot work is invalid");
  assertExactKeys(
    value,
    [
      "slot_id",
      "role",
      "state",
      "queued_foreground_count",
      "queued_background_count",
      "active_turn_id",
      "active_turn_started_at_ms",
      "active_turn_elapsed_ms",
      "active_turn_slow",
      "active_turn_slow_threshold_ms",
      "blocked_reason",
      "team_run_id",
    ],
    "Native AionUI standard Team slot work",
  );
  assertStandardProviderIdentity(value.slot_id, "Native AionUI standard Team slot");
  if (
    !["lead", "teammate"].includes(String(value.role)) ||
    !["idle", "queued", "starting", "running", "paused", "blocked"].includes(String(value.state)) ||
    (value.active_turn_slow !== null && typeof value.active_turn_slow !== "boolean")
  ) {
    throw new Error("Native AionUI standard Team slot work fields are invalid");
  }
  assertCounter(value.queued_foreground_count, "Native AionUI standard Team foreground queue");
  assertCounter(value.queued_background_count, "Native AionUI standard Team background queue");
  if (value.active_turn_id !== null) {
    assertStandardProviderIdentity(value.active_turn_id, "Native AionUI standard Team turn");
  }
  assertOptionalCounter(value.active_turn_started_at_ms, "Native AionUI standard Team turn start");
  assertOptionalCounter(value.active_turn_elapsed_ms, "Native AionUI standard Team turn elapsed");
  assertOptionalCounter(
    value.active_turn_slow_threshold_ms,
    "Native AionUI standard Team slow threshold",
  );
  if (
    value.blocked_reason !== null &&
    !["runtime_starting", "runtime_failed", "removing", "session_stopped"].includes(
      String(value.blocked_reason),
    )
  ) {
    throw new Error("Native AionUI standard Team blocked reason is invalid");
  }
  if (value.team_run_id !== null) {
    assertStandardProviderIdentity(value.team_run_id, "Native AionUI standard Team run");
  }
}

export function assertNativeAionUiStandardTeamRunEvent(
  value: unknown,
): asserts value is NativeAionUiStandardTeamRunEvent {
  if (!isRecord(value)) throw new Error("Native AionUI standard Team run event is invalid");
  assertExactKeys(
    value,
    [
      "team_id",
      "team_run_id",
      "source",
      "has_user_intervention",
      "target_slot_id",
      "target_role",
      "status",
      "queued_intent_count",
      "starting_batch_count",
      "running_batch_count",
      "active_enqueue_lease_count",
      "slot_work",
    ],
    "Native AionUI standard Team run event",
  );
  teamExperienceId(String(value.team_id));
  assertStandardProviderIdentity(value.team_id, "Native AionUI standard Team identity");
  assertStandardProviderIdentity(value.team_run_id, "Native AionUI standard Team run");
  assertStandardProviderIdentity(value.target_slot_id, "Native AionUI standard Team target slot");
  if (
    !["user_message", "system_lifecycle"].includes(String(value.source)) ||
    typeof value.has_user_intervention !== "boolean" ||
    !["lead", "teammate"].includes(String(value.target_role)) ||
    !["accepted", "running", "cancelling", "completed", "cancelled", "failed"].includes(
      String(value.status),
    ) ||
    !Array.isArray(value.slot_work)
  ) {
    throw new Error("Native AionUI standard Team run fields are invalid");
  }
  for (const field of [
    "queued_intent_count",
    "starting_batch_count",
    "running_batch_count",
    "active_enqueue_lease_count",
  ] as const) {
    assertCounter(value[field], `Native AionUI standard Team run ${field}`);
  }
  value.slot_work.forEach(assertStandardSlotWork);
}

function assertSlotWork(value: unknown): asserts value is NativeAionUiTeamSlotWork {
  if (!isRecord(value)) throw new Error("Native AionUI Team slot work is invalid");
  assertExactKeys(
    value,
    [
      "slot_id",
      "role",
      "state",
      "queued_foreground_count",
      "queued_background_count",
      "active_turn_id",
      "active_turn_started_at_ms",
      "active_turn_elapsed_ms",
      "active_turn_slow",
      "active_turn_slow_threshold_ms",
      "blocked_reason",
      "team_run_id",
    ],
    "Native AionUI Team slot work",
  );
  teamMemberId(String(value.slot_id));
  if (
    !["lead", "teammate"].includes(String(value.role)) ||
    !["idle", "queued", "starting", "running", "paused", "blocked"].includes(String(value.state)) ||
    (value.active_turn_slow !== null && typeof value.active_turn_slow !== "boolean")
  ) {
    throw new Error("Native AionUI Team slot work fields are invalid");
  }
  assertCounter(value.queued_foreground_count, "Native AionUI Team foreground queue");
  assertCounter(value.queued_background_count, "Native AionUI Team background queue");
  if (value.active_turn_id !== null) {
    assertText(value.active_turn_id, "Native AionUI Team turn", 128);
  }
  assertOptionalCounter(value.active_turn_started_at_ms, "Native AionUI Team turn start");
  assertOptionalCounter(value.active_turn_elapsed_ms, "Native AionUI Team turn elapsed");
  assertOptionalCounter(value.active_turn_slow_threshold_ms, "Native AionUI Team slow threshold");
  if (
    value.blocked_reason !== null &&
    !SLOT_BLOCKED_REASONS.includes(value.blocked_reason as (typeof SLOT_BLOCKED_REASONS)[number])
  ) {
    throw new Error("Native AionUI Team blocked reason is invalid");
  }
  if (value.team_run_id !== null) teamRunId(String(value.team_run_id));
}

function assertArtifact(value: unknown): asserts value is NativeAionUiTeamArtifactReference {
  if (!isRecord(value)) throw new Error("Native AionUI Team Artifact is invalid");
  assertExactKeys(value, ["artifact_id", "kind", "label"], "Native AionUI Team Artifact");
  assertText(value.artifact_id, "Native AionUI Team Artifact identity", 256);
  if (!["file", "document", "dataset", "directory", "other"].includes(String(value.kind))) {
    throw new Error("Native AionUI Team Artifact kind is invalid");
  }
  assertText(value.label, "Native AionUI Team Artifact label", TEAM_MAX_NAME_BYTES);
}

const NODE_BLOCKED_REASONS = [
  "dependency",
  "human-feedback",
  "protected-approval",
  "attempt-failed",
  "cancelled",
  "paused",
  "handoff",
  "interrupted",
] as const;

function assertNodeView(value: unknown): asserts value is NativeAionUiTeamNodeView {
  if (!isRecord(value)) throw new Error("Native AionUI Team node view is invalid");
  assertExactKeys(
    value,
    [
      "action_id",
      "slot_id",
      "title",
      "capability",
      "state",
      "depends_on_action_ids",
      "blocked_reason",
      "blocked_explanation",
      "current_executor",
      "next_actions",
      "artifacts",
    ],
    "Native AionUI Team node view",
  );
  if (typeof value.action_id !== "string" || !/^team-action-[a-f0-9]{64}$/u.test(value.action_id)) {
    throw new Error("Native AionUI Team action identity is invalid");
  }
  teamMemberId(String(value.slot_id));
  assertText(value.title, "Native AionUI Team node title", TEAM_MAX_NAME_BYTES);
  if (
    !["general", "coding", "feedback"].includes(String(value.capability)) ||
    ![
      "queued",
      "ready",
      "running",
      "blocked",
      "paused",
      "handoff-required",
      "completed",
      "failed",
      "cancelled",
    ].includes(String(value.state)) ||
    !["General Worker", "Goose", "User", "None"].includes(String(value.current_executor)) ||
    !Array.isArray(value.depends_on_action_ids) ||
    !Array.isArray(value.next_actions) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new Error("Native AionUI Team node fields are invalid");
  }
  value.depends_on_action_ids.forEach((candidate) => {
    if (typeof candidate !== "string" || !/^team-action-[a-f0-9]{64}$/u.test(candidate)) {
      throw new Error("Native AionUI Team dependency action is invalid");
    }
  });
  if (
    value.blocked_reason !== null &&
    !NODE_BLOCKED_REASONS.includes(value.blocked_reason as (typeof NODE_BLOCKED_REASONS)[number])
  ) {
    throw new Error("Native AionUI Team node blocked reason is invalid");
  }
  if (value.blocked_explanation !== null) {
    assertText(
      value.blocked_explanation,
      "Native AionUI Team blocked explanation",
      MAX_EXPLANATION_BYTES,
    );
  }
  value.next_actions.forEach((action) => {
    if (!CONTROL_ACTIONS.includes(action as (typeof CONTROL_ACTIONS)[number])) {
      throw new Error("Native AionUI Team next action is invalid");
    }
  });
  value.artifacts.forEach(assertArtifact);
}

export function assertNativeAionUiTeamRunEvent(
  value: unknown,
): asserts value is NativeAionUiTeamRunEvent {
  if (!isRecord(value)) throw new Error("Native AionUI Team run event is invalid");
  assertExactKeys(
    value,
    [
      "team_id",
      "team_run_id",
      "source",
      "has_user_intervention",
      "target_slot_id",
      "target_role",
      "status",
      "queued_intent_count",
      "starting_batch_count",
      "running_batch_count",
      "active_enqueue_lease_count",
      "slot_work",
      "actestra",
    ],
    "Native AionUI Team run event",
  );
  teamId(String(value.team_id));
  teamRunId(String(value.team_run_id));
  teamMemberId(String(value.target_slot_id));
  if (
    !["user_message", "system_lifecycle"].includes(String(value.source)) ||
    typeof value.has_user_intervention !== "boolean" ||
    !["lead", "teammate"].includes(String(value.target_role)) ||
    !["accepted", "running", "cancelling", "completed", "cancelled", "failed"].includes(
      String(value.status),
    ) ||
    !Array.isArray(value.slot_work) ||
    !isRecord(value.actestra)
  ) {
    throw new Error("Native AionUI Team run fields are invalid");
  }
  for (const field of [
    "queued_intent_count",
    "starting_batch_count",
    "running_batch_count",
    "active_enqueue_lease_count",
  ] as const) {
    assertCounter(value[field], `Native AionUI Team run ${field}`);
  }
  value.slot_work.forEach(assertSlotWork);
  assertExactKeys(
    value.actestra,
    ["authority", "authority_source", "revision", "status_explanation", "nodes", "result"],
    "Native AionUI Actestra Team projection",
  );
  if (
    value.actestra.authority !== "Actestra Core" ||
    value.actestra.authority_source !== "schema-15-team-run" ||
    !Array.isArray(value.actestra.nodes)
  ) {
    throw new Error("Native AionUI Team authority projection is invalid");
  }
  assertCounter(value.actestra.revision, "Native AionUI Team revision");
  if ((value.actestra.revision as number) < 1) {
    throw new Error("Native AionUI Team revision is invalid");
  }
  assertText(
    value.actestra.status_explanation,
    "Native AionUI Team status explanation",
    MAX_EXPLANATION_BYTES,
    true,
  );
  value.actestra.nodes.forEach(assertNodeView);
  if (value.actestra.result !== null) {
    if (!isRecord(value.actestra.result)) throw new Error("Native AionUI Team result is invalid");
    assertExactKeys(value.actestra.result, ["summary", "artifacts"], "Native AionUI Team result");
    assertText(
      value.actestra.result.summary,
      "Native AionUI Team result summary",
      MAX_SUMMARY_BYTES,
    );
    if (!Array.isArray(value.actestra.result.artifacts)) {
      throw new Error("Native AionUI Team result Artifacts are invalid");
    }
    value.actestra.result.artifacts.forEach(assertArtifact);
  }
}

function assertWorkspaceOption(value: unknown): asserts value is NativeAionUiTeamWorkspaceOption {
  if (!isRecord(value)) throw new Error("Native AionUI Team workspace option is invalid");
  assertExactKeys(value, ["workspace_id", "display_name"], "Native AionUI Team workspace option");
  workspaceId(String(value.workspace_id));
  assertText(value.display_name, "Native AionUI Team workspace label", TEAM_MAX_NAME_BYTES);
}

function assertSuccessData(value: unknown): asserts value is AionUiTeamBridgeSuccessData {
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach((team) => {
      if (!isRecord(team)) throw new Error("Native AionUI Team list item is invalid");
      if (team.experience === "standard") {
        assertNativeAionUiStandardTeam(team);
      } else if (team.experience === "orchestrated") {
        assertNativeAionUiTeam(team);
      } else {
        throw new Error("Native AionUI Team list experience is invalid");
      }
    });
    return;
  }
  if (!isRecord(value)) throw new Error("AionUI Team bridge success data is invalid");
  if (Object.hasOwn(value, "user_id")) {
    if (value.experience === "standard") {
      assertNativeAionUiStandardTeam(value);
    } else if (value.experience === "orchestrated") {
      assertNativeAionUiTeam(value);
    } else {
      throw new Error("Native AionUI Team experience is invalid");
    }
    return;
  }
  if (value.experience === "standard" && Object.hasOwn(value, "assistant")) {
    assertExactKeys(value, ["experience", "assistant"], "Native AionUI standard Team member ack");
    assertStandardAssistant(value.assistant);
    return;
  }
  if (value.experience === "standard" && Object.hasOwn(value, "enqueue_status")) {
    assertExactKeys(
      value,
      ["experience", "enqueue_status", "message_id", "run"],
      "Native AionUI standard Team run acknowledgement",
    );
    if (
      !["accepted", "queued", "blocked_runtime_starting"].includes(String(value.enqueue_status))
    ) {
      throw new Error("Native AionUI standard Team enqueue status is invalid");
    }
    assertStandardProviderIdentity(
      value.message_id,
      "Native AionUI standard Team message identity",
    );
    assertNativeAionUiStandardTeamRunEvent(value.run);
    return;
  }
  if (value.experience === "standard" && Object.hasOwn(value, "session_generation")) {
    assertExactKeys(
      value,
      ["experience", "session_generation", "active_run", "slot_work"],
      "Native AionUI standard Team run state",
    );
    if (value.session_generation !== null) {
      assertStandardProviderIdentity(
        value.session_generation,
        "Native AionUI standard Team session generation",
      );
    }
    if (value.active_run !== null) assertNativeAionUiStandardTeamRunEvent(value.active_run);
    if (!Array.isArray(value.slot_work)) {
      throw new Error("Native AionUI standard Team slot state is invalid");
    }
    value.slot_work.forEach(assertStandardSlotWork);
    return;
  }
  if (Object.hasOwn(value, "workspace_options")) {
    assertExactKeys(value, ["workspace_options"], "Native AionUI Team workspace options");
    if (!Array.isArray(value.workspace_options)) {
      throw new Error("Native AionUI Team workspace options are invalid");
    }
    value.workspace_options.forEach(assertWorkspaceOption);
    return;
  }
  if (Object.hasOwn(value, "workspace_id")) {
    assertWorkspaceOption(value);
    return;
  }
  if (Object.hasOwn(value, "conversation_id") && Object.hasOwn(value, "assistant_backend")) {
    assertAssistant(value);
    return;
  }
  if (Object.hasOwn(value, "session_generation")) {
    assertExactKeys(
      value,
      ["session_generation", "submission", "active_run", "slot_work", "activities"],
      "Native AionUI Team run state",
    );
    if (value.session_generation !== null) {
      assertText(value.session_generation, "Native AionUI Team session generation", 128);
    }
    if (!isRecord(value.submission)) {
      throw new Error("Native AionUI Team submission availability is invalid");
    }
    assertExactKeys(
      value.submission,
      ["availability", "blocked_reason", "next_action", "authority_source"],
      "Native AionUI Team submission availability",
    );
    if (
      !["available", "unavailable"].includes(String(value.submission.availability)) ||
      !["planner-unavailable", "worker-runtime-unavailable", null].includes(
        value.submission.blocked_reason as never,
      ) ||
      !["submit-task", "restart-after-planner-admission", "configure-worker-runtime"].includes(
        String(value.submission.next_action),
      ) ||
      value.submission.authority_source !== "actestra-main-runtime"
    ) {
      throw new Error("Native AionUI Team submission availability is invalid");
    }
    if (
      (value.submission.availability === "available" && value.submission.blocked_reason !== null) ||
      (value.submission.availability === "unavailable" &&
        !["planner-unavailable", "worker-runtime-unavailable"].includes(
          value.submission.blocked_reason as never,
        )) ||
      (value.submission.availability === "available" &&
        value.submission.next_action !== "submit-task") ||
      (value.submission.availability === "unavailable" &&
        !["restart-after-planner-admission", "configure-worker-runtime"].includes(
          value.submission.next_action as never,
        ))
    ) {
      throw new Error("Native AionUI Team submission availability is inconsistent");
    }
    if (value.active_run !== null) assertNativeAionUiTeamRunEvent(value.active_run);
    if (!Array.isArray(value.slot_work))
      throw new Error("Native AionUI Team slot state is invalid");
    value.slot_work.forEach(assertSlotWork);
    if (!Array.isArray(value.activities) || value.activities.length > 6) {
      throw new Error("Native AionUI Team activity is invalid");
    }
    value.activities.forEach((activity) => {
      if (!isRecord(activity)) throw new Error("Native AionUI Team activity is invalid");
      assertExactKeys(
        activity,
        ["id", "author", "content", "tone", "occurred_at"],
        "Native AionUI Team activity",
      );
      if (
        typeof activity.id !== "string" ||
        !/^team-(?:message|activity)-[a-f0-9]{64}$/u.test(activity.id) ||
        !["You", "General Worker", "Goose"].includes(String(activity.author)) ||
        !["user", "worker"].includes(String(activity.tone)) ||
        (activity.tone === "user" && activity.author !== "You") ||
        (activity.tone === "worker" && activity.author === "You")
      ) {
        throw new Error("Native AionUI Team activity fields are invalid");
      }
      assertText(activity.content, "Native AionUI Team activity content", MAX_MESSAGE_BYTES);
      assertCounter(activity.occurred_at, "Native AionUI Team activity instant");
    });
    return;
  }
  if (Object.hasOwn(value, "enqueue_status")) {
    assertExactKeys(
      value,
      ["enqueue_status", "message_id", "run"],
      "Native AionUI Team run acknowledgement",
    );
    if (
      !["accepted", "queued", "blocked_runtime_starting"].includes(String(value.enqueue_status)) ||
      typeof value.message_id !== "string" ||
      !/^team-message-[a-f0-9]{64}$/u.test(value.message_id)
    ) {
      throw new Error("Native AionUI Team run acknowledgement is invalid");
    }
    assertNativeAionUiTeamRunEvent(value.run);
    return;
  }
  if (Object.hasOwn(value, "config_options")) {
    assertExactKeys(value, ["config_options"], "Native AionUI Team config options");
    if (!Array.isArray(value.config_options) || value.config_options.length > 16) {
      throw new Error("Native AionUI Team config options are invalid");
    }
    let modelCount = 0;
    for (const option of value.config_options) {
      if (!isRecord(option)) throw new Error("Native AionUI Team config option is invalid");
      assertExactKeys(
        option,
        ["id", "name", "category", "type", "current_value", "options"],
        "Native AionUI Team config option",
      );
      assertText(option.id, "Native AionUI Team config option identity", 128);
      assertText(option.name, "Native AionUI Team config option name", 256);
      assertText(option.category, "Native AionUI Team config option category", 128);
      if (
        option.type !== "select" ||
        !Array.isArray(option.options) ||
        option.options.length > 128
      ) {
        throw new Error("Native AionUI Team config option fields are invalid");
      }
      const currentValue = option.current_value;
      let stableCurrentValue: string | null = null;
      if (currentValue !== null) {
        assertModelIdentifier(currentValue, "Native AionUI Team config current value");
        stableCurrentValue = currentValue;
      }
      const choices = new Set<string>();
      for (const choice of option.options) {
        if (!isRecord(choice)) throw new Error("Native AionUI Team config choice is invalid");
        const expectedKeys = Object.hasOwn(choice, "description")
          ? ["value", "name", "description"]
          : ["value", "name"];
        assertExactKeys(choice, expectedKeys, "Native AionUI Team config choice");
        assertModelIdentifier(choice.value, "Native AionUI Team config choice identity");
        assertText(choice.name, "Native AionUI Team config choice name", 256);
        if (Object.hasOwn(choice, "description")) {
          assertText(choice.description, "Native AionUI Team config choice description", 1_024);
        }
        if (choices.has(choice.value)) {
          throw new Error("Native AionUI Team config choices are ambiguous");
        }
        choices.add(choice.value);
      }
      if (stableCurrentValue !== null && !choices.has(stableCurrentValue)) {
        throw new Error("Native AionUI Team config current value is not admitted");
      }
      if (option.category === "model" || option.id === "model") {
        modelCount += 1;
        if (stableCurrentValue === null || choices.size === 0) {
          throw new Error("Native AionUI Team model config is unavailable");
        }
      }
    }
    if (modelCount > 1) {
      throw new Error("Native AionUI Team model config is ambiguous");
    }
    return;
  }
  throw new Error("AionUI Team bridge success data is unsupported");
}

export function assertAionUiTeamBridgeResponse(
  value: unknown,
): asserts value is AionUiTeamBridgeResponse {
  if (!isRecord(value) || value.contractVersion !== AIONUI_TEAM_BRIDGE_CONTRACT_VERSION) {
    throw new Error("AionUI Team bridge response is incompatible");
  }
  if (value.status === 200) {
    assertExactKeys(
      value,
      ["contractVersion", "status", "data"],
      "AionUI Team bridge success response",
    );
    assertSuccessData(value.data);
    return;
  }
  assertExactKeys(
    value,
    ["contractVersion", "status", "code", "message"],
    "AionUI Team bridge error response",
  );
  if (
    typeof value.code !== "string" ||
    !Object.hasOwn(ERROR_STATUS, value.code) ||
    value.status !== ERROR_STATUS[value.code as AionUiTeamBridgeErrorCode]
  ) {
    throw new Error("AionUI Team bridge error status is invalid");
  }
  assertText(value.message, "AionUI Team bridge error message", 512);
}

export function assertAionUiTeamEvent(value: unknown): asserts value is AionUiTeamEvent {
  if (!isRecord(value)) throw new Error("AionUI Team event is invalid");
  assertExactKeys(value, ["type", "payload"], "AionUI Team event");
  if (!isRecord(value.payload)) throw new Error("AionUI Team event payload is invalid");
  const payload = value.payload;
  switch (value.type) {
    case "team.created":
    case "team.renamed":
      assertExactKeys(payload, ["team_id", "team_name"], "AionUI Team identity event");
      assertText(payload.team_id, "AionUI Team event identity", MAX_STANDARD_IDENTIFIER_BYTES);
      assertText(payload.team_name, "AionUI Team event name", TEAM_MAX_NAME_BYTES);
      return;
    case "team.removed":
      assertExactKeys(payload, ["team_id"], "AionUI Team removed event");
      assertText(payload.team_id, "AionUI Team event identity", MAX_STANDARD_IDENTIFIER_BYTES);
      return;
    case "team.listChanged":
      assertExactKeys(payload, ["team_id", "action"], "AionUI Team list event");
      assertText(payload.team_id, "AionUI Team event identity", MAX_STANDARD_IDENTIFIER_BYTES);
      if (
        !["created", "removed", "renamed", "agent_added", "agent_removed"].includes(
          String(payload.action),
        )
      ) {
        throw new Error("AionUI Team list action is invalid");
      }
      return;
    case "team.agentSpawned":
      assertExactKeys(payload, ["team_id", "assistant"], "AionUI Team member spawned event");
      teamId(String(payload.team_id));
      assertAssistant(payload.assistant);
      return;
    case "team.agentRemoved":
      assertExactKeys(payload, ["team_id", "slot_id"], "AionUI Team member removed event");
      assertText(payload.team_id, "AionUI Team event identity", MAX_STANDARD_IDENTIFIER_BYTES);
      assertText(
        payload.slot_id,
        "AionUI Team member event identity",
        MAX_STANDARD_IDENTIFIER_BYTES,
      );
      return;
    case "team.agentRenamed":
      assertExactKeys(payload, ["team_id", "slot_id", "name"], "AionUI Team member renamed event");
      assertText(payload.team_id, "AionUI Team event identity", MAX_STANDARD_IDENTIFIER_BYTES);
      assertText(
        payload.slot_id,
        "AionUI Team member event identity",
        MAX_STANDARD_IDENTIFIER_BYTES,
      );
      assertText(payload.name, "AionUI Team member event name", TEAM_MAX_NAME_BYTES);
      return;
    case "team.teammateMessage":
      assertExactKeys(
        payload,
        ["conversation_id", "content", "from_slot_id", "from_name"],
        "AionUI Team message event",
      );
      assertText(
        payload.conversation_id,
        "AionUI Team message conversation",
        MAX_CONVERSATION_BYTES,
      );
      assertText(payload.content, "AionUI Team message content", MAX_EVENT_TEXT_BYTES);
      teamMemberId(String(payload.from_slot_id));
      assertText(payload.from_name, "AionUI Team message author", TEAM_MAX_NAME_BYTES);
      return;
    case "team.runAccepted":
    case "team.runStarted":
    case "team.runUpdated":
    case "team.runCompleted":
    case "team.runCancelled":
    case "team.runFailed":
      assertNativeAionUiTeamRunEvent(payload);
      return;
    case "team.slotWorkChanged":
      assertExactKeys(payload, ["team_id", "slot_work"], "AionUI Team slot event");
      teamId(String(payload.team_id));
      assertSlotWork(payload.slot_work);
      return;
    default:
      throw new Error("AionUI Team event type is unsupported");
  }
}
