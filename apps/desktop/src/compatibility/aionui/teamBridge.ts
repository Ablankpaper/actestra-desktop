import {
  TEAM_MAX_MEMBERS,
  TEAM_MAX_NAME_BYTES,
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

export type AionUiTeamBridgeMethod = "GET" | "POST" | "PATCH" | "DELETE";
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

export type AionUiTeamBridgeRoute =
  | Readonly<{ kind: "list" }>
  | Readonly<{
      kind: "create";
      name: string;
      workspaceId: string;
      members: readonly AionUiTeamMemberInput[];
    }>
  | Readonly<{
      kind:
        | "get"
        | "remove"
        | "ensure-session"
        | "stop-session"
        | "active-lease"
        | "set-session-mode"
        | "run-state";
      teamId: string;
    }>
  | Readonly<{ kind: "add-member"; teamId: string; member: AionUiTeamMemberInput }>
  | Readonly<{ kind: "remove-member" | "attach-member"; teamId: string; slotId: string }>
  | Readonly<{ kind: "config-options"; teamId: string; conversationId: string }>
  | Readonly<{ kind: "rename-member"; teamId: string; slotId: string; name: string }>
  | Readonly<{ kind: "rename-team"; teamId: string; name: string }>
  | Readonly<{ kind: "send-message"; teamId: string; content: string }>
  | Readonly<{ kind: "send-member-message"; teamId: string; slotId: string; content: string }>
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
  readonly user_id: typeof ACTESTRA_TEAM_LOCAL_USER_ID;
  readonly name: string;
  readonly workspace: string;
  readonly workspace_mode: "isolated";
  readonly leader_assistant_id: string;
  readonly assistants: readonly NativeAionUiTeamAssistant[];
  readonly session_mode: "plan";
  readonly created_at: number;
  readonly updated_at: number;
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
  readonly active_run: NativeAionUiTeamRunEvent | null;
  readonly slot_work: readonly NativeAionUiTeamSlotWork[];
  readonly activities: readonly NativeAionUiTeamActivity[];
}

export interface NativeAionUiTeamRunAck {
  readonly enqueue_status: "accepted" | "queued" | "blocked_runtime_starting";
  readonly message_id: string;
  readonly run: NativeAionUiTeamRunEvent;
}

export interface NativeAionUiTeamConfigOptions {
  readonly config_options: readonly [];
}

export type AionUiTeamBridgeSuccessData =
  | NativeAionUiTeam
  | readonly NativeAionUiTeam[]
  | NativeAionUiTeamAssistant
  | NativeAionUiTeamRunState
  | NativeAionUiTeamRunAck
  | NativeAionUiTeamConfigOptions
  | null;

const ERROR_STATUS = Object.freeze({
  "team-invalid-request": 400,
  "team-untrusted-sender": 403,
  "team-not-found": 404,
  "team-conflict": 409,
  "team-active": 409,
  "team-execution-failed": 500,
  "team-planner-unavailable": 503,
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

function parseWorkspaceReference(value: unknown): string {
  const stableWorkspaceId = workspaceId(String(value));
  if (!/^workspace-[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/u.test(stableWorkspaceId)) {
    throw new Error("AionUI Team workspace must be an Actestra-owned reference");
  }
  return stableWorkspaceId;
}

function parseCreateBody(value: unknown): Extract<AionUiTeamBridgeRoute, { kind: "create" }> {
  if (!isRecord(value)) throw new Error("AionUI Team create body is invalid");
  assertExactKeys(value, ["name", "agents", "workspace"], "AionUI Team create body");
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
  return Object.freeze({
    kind: "create",
    name: value.name,
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
  const stableTeam = teamId(segments[2]!);
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
      assertExactKeys(request.body, ["mode"], "AionUI Team session mode");
      if (request.body.mode !== "plan")
        throw new Error("AionUI Team unsafe session mode is unavailable");
      return Object.freeze({ kind: "set-session-mode", teamId: stableTeam });
    }
    if (resource === "run-state" && request.method === "GET") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "run-state", teamId: stableTeam });
    }
    if (resource === "messages" && request.method === "POST") {
      if (!isRecord(request.body)) throw new Error("AionUI Team message body is invalid");
      assertExactKeys(request.body, ["content"], "AionUI Team message body");
      assertText(request.body.content, "AionUI Team message", MAX_MESSAGE_BYTES);
      return Object.freeze({
        kind: "send-message",
        teamId: stableTeam,
        content: request.body.content,
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
  if (resource === "agents" && segments.length >= 5) {
    const slotId = teamMemberId(segments[4]!);
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
      if (!isRecord(request.body)) throw new Error("AionUI Team member message is invalid");
      assertExactKeys(request.body, ["content"], "AionUI Team member message");
      assertText(request.body.content, "AionUI Team member message", MAX_MESSAGE_BYTES);
      return Object.freeze({
        kind: "send-member-message",
        teamId: stableTeam,
        slotId,
        content: request.body.content,
      });
    }
    if (segments[5] === "attach" && request.method === "POST") {
      assertNoBody(request.body);
      return Object.freeze({ kind: "attach-member", teamId: stableTeam, slotId });
    }
    throw new Error("AionUI Team member resource is unsupported");
  }
  if (resource === "runs" && segments.length >= 5) {
    const stableRun = teamRunId(segments[4]!);
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
      const slotId = teamMemberId(segments[6]!);
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
    !["GET", "POST", "PATCH", "DELETE"].includes(String(value.method))
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

export function assertNativeAionUiTeam(value: unknown): asserts value is NativeAionUiTeam {
  if (!isRecord(value)) throw new Error("Native AionUI Team is invalid");
  assertExactKeys(
    value,
    [
      "id",
      "user_id",
      "name",
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

function assertSuccessData(value: unknown): asserts value is AionUiTeamBridgeSuccessData {
  if (value === null) return;
  if (Array.isArray(value)) {
    value.forEach(assertNativeAionUiTeam);
    return;
  }
  if (!isRecord(value)) throw new Error("AionUI Team bridge success data is invalid");
  if (Object.hasOwn(value, "user_id")) {
    assertNativeAionUiTeam(value);
    return;
  }
  if (Object.hasOwn(value, "conversation_id") && Object.hasOwn(value, "assistant_backend")) {
    assertAssistant(value);
    return;
  }
  if (Object.hasOwn(value, "session_generation")) {
    assertExactKeys(
      value,
      ["session_generation", "active_run", "slot_work", "activities"],
      "Native AionUI Team run state",
    );
    if (value.session_generation !== null) {
      assertText(value.session_generation, "Native AionUI Team session generation", 128);
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
    if (!Array.isArray(value.config_options) || value.config_options.length !== 0) {
      throw new Error("Native AionUI Team config options are unavailable");
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
      teamId(String(payload.team_id));
      assertText(payload.team_name, "AionUI Team event name", TEAM_MAX_NAME_BYTES);
      return;
    case "team.removed":
      assertExactKeys(payload, ["team_id"], "AionUI Team removed event");
      teamId(String(payload.team_id));
      return;
    case "team.listChanged":
      assertExactKeys(payload, ["team_id", "action"], "AionUI Team list event");
      teamId(String(payload.team_id));
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
      teamId(String(payload.team_id));
      teamMemberId(String(payload.slot_id));
      return;
    case "team.agentRenamed":
      assertExactKeys(payload, ["team_id", "slot_id", "name"], "AionUI Team member renamed event");
      teamId(String(payload.team_id));
      teamMemberId(String(payload.slot_id));
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
