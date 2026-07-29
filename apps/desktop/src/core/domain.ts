declare const coreValueBrand: unique symbol;

type BrandedString<Brand extends string> = string & {
  readonly [coreValueBrand]: Brand;
};

export type WorkspaceId = BrandedString<"WorkspaceId">;
export type TaskId = BrandedString<"TaskId">;
export type SessionId = BrandedString<"SessionId">;
export type WorkerId = BrandedString<"WorkerId">;
export type ApprovalId = BrandedString<"ApprovalId">;
export type ArtifactId = BrandedString<"ArtifactId">;
export type CorrelationId = BrandedString<"CorrelationId">;
export type ToolRequestId = BrandedString<"ToolRequestId">;
export type Instant = BrandedString<"Instant">;

export const CORE_CONTRACT_ERROR_CODES = [
  "invalid-identifier",
  "invalid-timestamp",
  "invalid-transition",
  "invalid-record",
  "duplicate-id",
  "missing-reference",
  "cross-workspace-reference",
  "invalid-reference",
  "invalid-event",
  "invalid-event-redaction",
  "event-id-conflict",
  "event-sequence-gap",
  "event-sequence-conflict",
  "event-time-regression",
  "event-identity-mismatch",
  "event-state-mismatch",
  "event-after-terminal",
  "invalid-event-cursor",
] as const;

export type CoreContractErrorCode = (typeof CORE_CONTRACT_ERROR_CODES)[number];

export class CoreContractError extends Error {
  constructor(
    readonly code: CoreContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreContractError";
  }
}

const MAX_IDENTIFIER_LENGTH = 128;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function opaqueIdentifier<Identifier extends string>(value: unknown, kind: string): Identifier {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    throw new CoreContractError(
      "invalid-identifier",
      `${kind} must be a non-empty, unpadded, control-free identifier of at most ${MAX_IDENTIFIER_LENGTH} characters`,
    );
  }

  return value as Identifier;
}

export function workspaceId(value: string): WorkspaceId {
  return opaqueIdentifier<WorkspaceId>(value, "WorkspaceId");
}

export function taskId(value: string): TaskId {
  return opaqueIdentifier<TaskId>(value, "TaskId");
}

export function sessionId(value: string): SessionId {
  return opaqueIdentifier<SessionId>(value, "SessionId");
}

export function workerId(value: string): WorkerId {
  return opaqueIdentifier<WorkerId>(value, "WorkerId");
}

export function approvalId(value: string): ApprovalId {
  return opaqueIdentifier<ApprovalId>(value, "ApprovalId");
}

export function artifactId(value: string): ArtifactId {
  return opaqueIdentifier<ArtifactId>(value, "ArtifactId");
}

export function correlationId(value: string): CorrelationId {
  return opaqueIdentifier<CorrelationId>(value, "CorrelationId");
}

export function toolRequestId(value: string): ToolRequestId {
  return opaqueIdentifier<ToolRequestId>(value, "ToolRequestId");
}

export function instant(value: string): Instant {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CoreContractError(
      "invalid-timestamp",
      "Instant must use the canonical UTC ISO-8601 form produced by Date.toISOString()",
    );
  }

  return value as Instant;
}

export function compareInstants(left: Instant, right: Instant): -1 | 0 | 1 {
  instant(left);
  instant(right);
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  return leftMilliseconds === rightMilliseconds ? 0 : leftMilliseconds < rightMilliseconds ? -1 : 1;
}

export type WorkspaceState = "active" | "archived";
export type TaskState =
  | "draft"
  | "ready"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type SessionState =
  | "created"
  | "starting"
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkerState =
  | "created"
  | "starting"
  | "ready"
  | "busy"
  | "stopping"
  | "stopped"
  | "crashed";
export type ApprovalState = "pending" | "approved" | "denied" | "expired" | "cancelled";
export type ArtifactKind = "file" | "document" | "dataset" | "directory" | "other";
export type ArtifactState = "available" | "superseded";

export interface Workspace {
  readonly id: WorkspaceId;
  readonly name: string;
  readonly state: WorkspaceState;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface Task {
  readonly id: TaskId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly state: TaskState;
  readonly activeSessionId?: SessionId;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface Session {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly workerId: WorkerId;
  readonly state: SessionState;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface Worker {
  readonly id: WorkerId;
  readonly workspaceId: WorkspaceId;
  readonly adapterKind: string;
  readonly state: WorkerState;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface Approval {
  readonly id: ApprovalId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly action: string;
  readonly state: ApprovalState;
  readonly requestedAt: Instant;
  readonly expiresAt?: Instant;
  readonly resolvedAt?: Instant;
}

export interface Artifact {
  readonly id: ArtifactId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId?: SessionId;
  readonly kind: ArtifactKind;
  readonly label: string;
  readonly state: ArtifactState;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface DomainGraph {
  readonly workspaces: readonly Workspace[];
  readonly tasks: readonly Task[];
  readonly sessions: readonly Session[];
  readonly workers: readonly Worker[];
  readonly approvals: readonly Approval[];
  readonly artifacts: readonly Artifact[];
}

const WORKSPACE_TRANSITIONS = {
  active: ["archived"],
  archived: [],
} as const satisfies Record<WorkspaceState, readonly WorkspaceState[]>;

const TASK_TRANSITIONS = {
  draft: ["ready", "cancelled"],
  ready: ["running", "failed", "cancelled"],
  running: ["blocked", "completed", "failed", "cancelled"],
  blocked: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<TaskState, readonly TaskState[]>;

const SESSION_TRANSITIONS = {
  created: ["starting", "cancelled"],
  starting: ["running", "failed", "cancelled"],
  running: ["blocked", "completed", "failed", "cancelled"],
  blocked: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<SessionState, readonly SessionState[]>;

const WORKER_TRANSITIONS = {
  created: ["starting", "stopped"],
  starting: ["ready", "stopping", "crashed"],
  ready: ["busy", "stopping", "crashed"],
  busy: ["ready", "stopping", "crashed"],
  stopping: ["stopped", "crashed"],
  stopped: [],
  crashed: [],
} as const satisfies Record<WorkerState, readonly WorkerState[]>;

const APPROVAL_TRANSITIONS = {
  pending: ["approved", "denied", "expired", "cancelled"],
  approved: [],
  denied: [],
  expired: [],
  cancelled: [],
} as const satisfies Record<ApprovalState, readonly ApprovalState[]>;

function assertTransition<State extends string>(
  kind: string,
  transitions: Record<State, readonly State[]>,
  from: State,
  to: State,
): void {
  const allowedTransitions = transitions[from];

  if (allowedTransitions === undefined || !allowedTransitions.includes(to)) {
    throw new CoreContractError(
      "invalid-transition",
      `${kind} cannot transition from ${from} to ${to}`,
    );
  }
}

export function assertWorkspaceTransition(from: WorkspaceState, to: WorkspaceState): void {
  assertTransition("Workspace", WORKSPACE_TRANSITIONS, from, to);
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  assertTransition("Task", TASK_TRANSITIONS, from, to);
}

export function assertSessionTransition(from: SessionState, to: SessionState): void {
  assertTransition("Session", SESSION_TRANSITIONS, from, to);
}

export function assertWorkerTransition(from: WorkerState, to: WorkerState): void {
  assertTransition("Worker", WORKER_TRANSITIONS, from, to);
}

export function assertApprovalTransition(from: ApprovalState, to: ApprovalState): void {
  assertTransition("Approval", APPROVAL_TRANSITIONS, from, to);
}

export function isTerminalTaskState(state: TaskState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function isTerminalSessionState(state: SessionState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function isTerminalWorkerState(state: WorkerState): boolean {
  return state === "stopped" || state === "crashed";
}

export function isTerminalApprovalState(state: ApprovalState): boolean {
  return state !== "pending";
}

function assertMeaningfulText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || containsControlCharacter(value)) {
    throw new CoreContractError(
      "invalid-record",
      `${field} must contain non-control, non-whitespace text`,
    );
  }
}

function assertKnownValue<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  field: string,
): asserts value is Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    throw new CoreContractError("invalid-record", `${field} must be one of: ${allowed.join(", ")}`);
  }
}

function assertChronology(createdAt: Instant, updatedAt: Instant, kind: string): void {
  instant(createdAt);
  instant(updatedAt);

  if (compareInstants(updatedAt, createdAt) < 0) {
    throw new CoreContractError("invalid-record", `${kind} updatedAt cannot precede createdAt`);
  }
}

function indexRecords<RecordType extends { readonly id: string }>(
  records: readonly RecordType[],
  kind: string,
): Map<string, RecordType> {
  const index = new Map<string, RecordType>();

  for (const record of records) {
    opaqueIdentifier(record.id, `${kind}Id`);

    if (index.has(record.id)) {
      throw new CoreContractError("duplicate-id", `${kind} id ${record.id} is duplicated`);
    }

    index.set(record.id, record);
  }

  return index;
}

function requireReference<RecordType extends { readonly workspaceId: WorkspaceId }>(
  index: ReadonlyMap<string, RecordType>,
  id: string,
  referencedKind: string,
  ownerKind: string,
  ownerId: string,
  workspace: WorkspaceId,
): RecordType {
  const referenced = index.get(id);

  if (referenced === undefined) {
    throw new CoreContractError(
      "missing-reference",
      `${ownerKind} ${ownerId} references missing ${referencedKind} ${id}`,
    );
  }

  if (referenced.workspaceId !== workspace) {
    throw new CoreContractError(
      "cross-workspace-reference",
      `${ownerKind} ${ownerId} and ${referencedKind} ${id} belong to different workspaces`,
    );
  }

  return referenced;
}

function requireWorkspace(
  workspaces: ReadonlyMap<string, Workspace>,
  workspace: WorkspaceId,
  ownerKind: string,
  ownerId: string,
): Workspace {
  const referenced = workspaces.get(workspace);

  if (referenced === undefined) {
    throw new CoreContractError(
      "missing-reference",
      `${ownerKind} ${ownerId} references missing Workspace ${workspace}`,
    );
  }

  return referenced;
}
export function assertDomainGraph(graph: DomainGraph): void {
  const workspaces = indexRecords(graph.workspaces, "Workspace");
  const tasks = indexRecords(graph.tasks, "Task");
  const sessions = indexRecords(graph.sessions, "Session");
  const workers = indexRecords(graph.workers, "Worker");
  const approvals = indexRecords(graph.approvals, "Approval");
  const artifacts = indexRecords(graph.artifacts, "Artifact");

  for (const workspace of workspaces.values()) {
    assertMeaningfulText(workspace.name, "Workspace.name");
    assertKnownValue(workspace.state, ["active", "archived"], "Workspace.state");
    assertChronology(workspace.createdAt, workspace.updatedAt, `Workspace ${workspace.id}`);
  }

  for (const task of tasks.values()) {
    requireWorkspace(workspaces, task.workspaceId, "Task", task.id);
    assertMeaningfulText(task.title, "Task.title");
    assertKnownValue(
      task.state,
      ["draft", "ready", "running", "blocked", "completed", "failed", "cancelled"],
      "Task.state",
    );
    assertChronology(task.createdAt, task.updatedAt, `Task ${task.id}`);

    if (task.activeSessionId !== undefined) {
      const session = requireReference(
        sessions,
        task.activeSessionId,
        "Session",
        "Task",
        task.id,
        task.workspaceId,
      );

      if (session.taskId !== task.id) {
        throw new CoreContractError(
          "invalid-reference",
          `Task ${task.id} active session ${session.id} belongs to Task ${session.taskId}`,
        );
      }
    }
  }

  for (const worker of workers.values()) {
    requireWorkspace(workspaces, worker.workspaceId, "Worker", worker.id);
    assertMeaningfulText(worker.adapterKind, "Worker.adapterKind");
    assertKnownValue(
      worker.state,
      ["created", "starting", "ready", "busy", "stopping", "stopped", "crashed"],
      "Worker.state",
    );
    assertChronology(worker.createdAt, worker.updatedAt, `Worker ${worker.id}`);
  }

  for (const session of sessions.values()) {
    requireWorkspace(workspaces, session.workspaceId, "Session", session.id);
    requireReference(tasks, session.taskId, "Task", "Session", session.id, session.workspaceId);
    requireReference(
      workers,
      session.workerId,
      "Worker",
      "Session",
      session.id,
      session.workspaceId,
    );
    assertKnownValue(
      session.state,
      ["created", "starting", "running", "blocked", "completed", "failed", "cancelled"],
      "Session.state",
    );

    assertChronology(session.createdAt, session.updatedAt, `Session ${session.id}`);
  }

  for (const approval of approvals.values()) {
    requireWorkspace(workspaces, approval.workspaceId, "Approval", approval.id);
    requireReference(tasks, approval.taskId, "Task", "Approval", approval.id, approval.workspaceId);
    const session = requireReference(
      sessions,
      approval.sessionId,
      "Session",
      "Approval",
      approval.id,
      approval.workspaceId,
    );

    if (session.taskId !== approval.taskId) {
      throw new CoreContractError(
        "invalid-reference",
        `Approval ${approval.id} session and task references do not match`,
      );
    }

    assertMeaningfulText(approval.action, "Approval.action");
    assertKnownValue(
      approval.state,
      ["pending", "approved", "denied", "expired", "cancelled"],
      "Approval.state",
    );
    instant(approval.requestedAt);

    if (approval.expiresAt !== undefined) {
      instant(approval.expiresAt);

      if (compareInstants(approval.expiresAt, approval.requestedAt) < 0) {
        throw new CoreContractError(
          "invalid-record",
          `Approval ${approval.id} expires before it was requested`,
        );
      }
    }

    if (approval.resolvedAt !== undefined) {
      instant(approval.resolvedAt);

      if (compareInstants(approval.resolvedAt, approval.requestedAt) < 0) {
        throw new CoreContractError(
          "invalid-record",
          `Approval ${approval.id} resolves before it was requested`,
        );
      }
    }

    if (isTerminalApprovalState(approval.state) !== (approval.resolvedAt !== undefined)) {
      throw new CoreContractError(
        "invalid-record",
        `Approval ${approval.id} must have exactly one terminal state and resolution timestamp`,
      );
    }
  }

  for (const artifact of artifacts.values()) {
    requireWorkspace(workspaces, artifact.workspaceId, "Artifact", artifact.id);
    requireReference(tasks, artifact.taskId, "Task", "Artifact", artifact.id, artifact.workspaceId);

    if (artifact.sessionId !== undefined) {
      const session = requireReference(
        sessions,
        artifact.sessionId,
        "Session",
        "Artifact",
        artifact.id,
        artifact.workspaceId,
      );

      if (session.taskId !== artifact.taskId) {
        throw new CoreContractError(
          "invalid-reference",
          `Artifact ${artifact.id} session and task references do not match`,
        );
      }
    }

    assertMeaningfulText(artifact.label, "Artifact.label");
    assertKnownValue(
      artifact.kind,
      ["file", "document", "dataset", "directory", "other"],
      "Artifact.kind",
    );
    assertKnownValue(artifact.state, ["available", "superseded"], "Artifact.state");
    assertChronology(artifact.createdAt, artifact.updatedAt, `Artifact ${artifact.id}`);
  }
}
