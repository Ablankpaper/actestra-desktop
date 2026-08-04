import {
  compareInstants,
  approvalId,
  artifactId,
  instant,
  taskId,
  workspaceId,
  type ApprovalId,
  type ArtifactId,
  type ArtifactKind,
  type Instant,
  type TaskId,
  type WorkspaceId,
} from "./domain";
import {
  normalizeAdmittedTeamPlan,
  teamPlanId,
  type AdmittedTeamPlan,
  type TeamPlanId,
  type TeamPlanNodeId,
  type TeamPlanRisk,
  type TeamPlannerLimits,
  type TeamWorkerCapability,
} from "./teamOrchestration";
import { auditRecordId, type AuditRecordId } from "./privilegedServices";

declare const teamRunValueBrand: unique symbol;

type TeamRunBrandedString<Brand extends string> = string & {
  readonly [teamRunValueBrand]: Brand;
};

export type TeamId = TeamRunBrandedString<"TeamId">;
export type TeamMemberId = TeamRunBrandedString<"TeamMemberId">;
export type TeamRunId = TeamRunBrandedString<"TeamRunId">;
export type TeamAttemptId = TeamRunBrandedString<"TeamAttemptId">;

export const TEAM_RUN_CONTRACT_VERSION = 1 as const;
export const TEAM_MIN_MEMBERS = 2;
export const TEAM_MAX_MEMBERS = 5;
export const TEAM_MAX_NAME_BYTES = 256;
export const TEAM_MAX_DISPLAY_NAME_BYTES = 256;
export const TEAM_PERSISTENCE_MAX_RECORDS = 100;

export type TeamMemberRole = "leader" | "teammate";
export type TeamRunStatus =
  | "accepted"
  | "running"
  | "paused"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";
export type TeamNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "approval-blocked"
  | "paused"
  | "handoff-required"
  | "completed"
  | "failed"
  | "cancelled";
export type TeamAttemptStatus =
  | "running"
  | "blocked"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "replaced"
  | "handed-off"
  | "interrupted";
export type TeamNodeBlockedReason =
  | "dependency"
  | "human-feedback"
  | "protected-approval"
  | "attempt-failed"
  | "cancelled"
  | "paused"
  | "handoff"
  | "interrupted";

export type TeamRunContractErrorCode =
  | "invalid-record"
  | "invalid-transition"
  | "missing-capability"
  | "stale-attempt"
  | "attempt-limit";

export class TeamRunContractError extends Error {
  constructor(
    readonly code: TeamRunContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamRunContractError";
  }
}

export interface TeamMember {
  readonly memberId: TeamMemberId;
  readonly role: TeamMemberRole;
  readonly capability: TeamWorkerCapability;
  readonly displayName: string;
}

export interface TeamDefinition {
  readonly contractVersion: typeof TEAM_RUN_CONTRACT_VERSION;
  readonly teamId: TeamId;
  readonly name: string;
  readonly workspaceId: WorkspaceId;
  readonly members: readonly TeamMember[];
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface TeamArtifactReference {
  readonly artifactId: ArtifactId;
  readonly taskId: TaskId;
  readonly kind: ArtifactKind;
}

export interface TeamRunAttempt {
  readonly attemptId: TeamAttemptId;
  readonly attemptNumber: number;
  readonly workerTaskId: TaskId;
  readonly status: TeamAttemptStatus;
  readonly startedAt: Instant;
  readonly updatedAt: Instant;
  readonly approvalId?: ApprovalId;
  readonly incidentCode?: string;
}

export interface TeamProtectedApprovalReference {
  readonly approvalId: ApprovalId;
  readonly policyAuditRecordId: AuditRecordId;
  readonly requestAuditRecordId: AuditRecordId;
  readonly decision: "approved" | "denied" | null;
  readonly decisionAuditRecordId: AuditRecordId | null;
  readonly outcomeAuditRecordId: AuditRecordId | null;
}

export interface TeamWorkflowFeedback {
  readonly decision: "approved" | "denied";
  readonly note: string;
  readonly resolvedAt: Instant;
}

interface TeamRunNodeBase {
  readonly nodeId: TeamPlanNodeId;
  readonly taskId: TaskId;
  readonly candidateKey: string;
  readonly title: string;
  readonly dependsOn: readonly TeamPlanNodeId[];
  readonly completionCriteria: string;
  readonly risk: TeamPlanRisk;
  readonly status: TeamNodeStatus;
  readonly blockedReason: TeamNodeBlockedReason | null;
  readonly blockedExplanation: string | null;
  readonly protectedApproval: TeamProtectedApprovalReference | null;
  readonly workflowFeedback: TeamWorkflowFeedback | null;
  readonly summary: string | null;
  readonly attempts: readonly TeamRunAttempt[];
  readonly artifacts: readonly TeamArtifactReference[];
}

export interface TeamRunWorkerNode extends TeamRunNodeBase {
  readonly kind: "worker";
  readonly capability: TeamWorkerCapability;
  readonly expectedArtifactKind: ArtifactKind;
  readonly maxAttempts: number;
}

export interface TeamRunHumanFeedbackNode extends TeamRunNodeBase {
  readonly kind: "human-feedback";
}

export type TeamRunNode = TeamRunWorkerNode | TeamRunHumanFeedbackNode;

export interface TeamRunResult {
  readonly summary: string;
  readonly artifacts: readonly TeamArtifactReference[];
}

export interface TeamRunSnapshot {
  readonly contractVersion: typeof TEAM_RUN_CONTRACT_VERSION;
  readonly runId: TeamRunId;
  readonly teamId: TeamId;
  readonly planId: TeamPlanId;
  readonly revision: number;
  readonly status: TeamRunStatus;
  readonly limits: TeamPlannerLimits;
  readonly nodes: readonly TeamRunNode[];
  readonly result: TeamRunResult | null;
  readonly statusExplanation: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface PersistTeamDefinitionResult {
  readonly status: "stored" | "duplicate";
  readonly team: TeamDefinition;
}

export interface ReplaceTeamDefinitionResult {
  readonly status: "stored" | "duplicate";
  readonly team: TeamDefinition;
}

export interface RemoveTeamDefinitionResult {
  readonly status: "removed" | "duplicate";
  readonly teamId: TeamId;
}

export interface PersistTeamRunSnapshotResult {
  readonly status: "stored" | "duplicate";
  readonly snapshot: TeamRunSnapshot;
}

export interface TeamRunPersistencePort {
  persistTeamDefinition(team: TeamDefinition): Promise<PersistTeamDefinitionResult>;
  getTeamDefinition(teamId: TeamId): Promise<TeamDefinition | null>;
  listTeamDefinitions(limit: number): Promise<readonly TeamDefinition[]>;
  replaceTeamDefinition(
    expected: TeamDefinition,
    replacement: TeamDefinition,
  ): Promise<ReplaceTeamDefinitionResult>;
  removeTeamDefinition(
    expected: TeamDefinition,
    removedAt: Instant,
  ): Promise<RemoveTeamDefinitionResult>;
  persistTeamRunSnapshot(snapshot: TeamRunSnapshot): Promise<PersistTeamRunSnapshotResult>;
  getTeamRunSnapshot(runId: TeamRunId): Promise<TeamRunSnapshot | null>;
  listRecoverableTeamRuns(limit: number): Promise<readonly TeamRunSnapshot[]>;
  listTeamRunsForTeam(teamId: TeamId, limit: number): Promise<readonly TeamRunSnapshot[]>;
}

export type TeamRunCommand =
  | { readonly type: "start-run"; readonly occurredAt: Instant }
  | {
      readonly type: "start-node";
      readonly nodeId: TeamPlanNodeId;
      readonly workerTaskId: TaskId;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "block-node";
      readonly nodeId: TeamPlanNodeId;
      readonly attemptId: TeamAttemptId;
      readonly approvalId: ApprovalId;
      readonly policyAuditRecordId: AuditRecordId;
      readonly requestAuditRecordId: AuditRecordId;
      readonly reason: string;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "request-node-approval-decision";
      readonly nodeId: TeamPlanNodeId;
      readonly approvalId: ApprovalId;
      readonly decision: "approved" | "denied";
      readonly decisionAuditRecordId: AuditRecordId;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "resolve-node-approval";
      readonly nodeId: TeamPlanNodeId;
      readonly approvalId: ApprovalId;
      readonly outcomeAuditRecordId: AuditRecordId;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "complete-node";
      readonly nodeId: TeamPlanNodeId;
      readonly attemptId: TeamAttemptId;
      readonly artifacts: readonly TeamArtifactReference[];
      readonly summary: string;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "fail-node";
      readonly nodeId: TeamPlanNodeId;
      readonly attemptId: TeamAttemptId;
      readonly incidentCode: string;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "resolve-human-feedback";
      readonly nodeId: TeamPlanNodeId;
      readonly decision: "approved" | "denied";
      readonly note: string;
      readonly occurredAt: Instant;
    }
  | {
      readonly type:
        | "pause-node"
        | "resume-node"
        | "retry-node"
        | "replace-node"
        | "request-handoff"
        | "cancel-node";
      readonly nodeId: TeamPlanNodeId;
      readonly reason: string;
      readonly occurredAt: Instant;
    }
  | {
      readonly type: "complete-handoff";
      readonly nodeId: TeamPlanNodeId;
      readonly artifacts: readonly TeamArtifactReference[];
      readonly summary: string;
      readonly occurredAt: Instant;
    }
  | { readonly type: "cancel-run"; readonly reason: string; readonly occurredAt: Instant }
  | {
      readonly type: "complete-aggregation";
      readonly result: TeamRunResult;
      readonly occurredAt: Instant;
    };

const TEAM_DEFINITION_KEYS = [
  "contractVersion",
  "teamId",
  "name",
  "workspaceId",
  "members",
  "createdAt",
  "updatedAt",
] as const;
const TEAM_MEMBER_KEYS = ["memberId", "role", "capability", "displayName"] as const;
const TEAM_RUN_KEYS = [
  "contractVersion",
  "runId",
  "teamId",
  "planId",
  "revision",
  "status",
  "limits",
  "nodes",
  "result",
  "statusExplanation",
  "createdAt",
  "updatedAt",
] as const;
const TEAM_RUN_WORKER_NODE_KEYS = [
  "nodeId",
  "taskId",
  "candidateKey",
  "title",
  "kind",
  "capability",
  "dependsOn",
  "expectedArtifactKind",
  "completionCriteria",
  "risk",
  "maxAttempts",
  "status",
  "blockedReason",
  "blockedExplanation",
  "protectedApproval",
  "workflowFeedback",
  "summary",
  "attempts",
  "artifacts",
] as const;
const TEAM_RUN_HUMAN_NODE_KEYS = [
  "nodeId",
  "taskId",
  "candidateKey",
  "title",
  "kind",
  "dependsOn",
  "completionCriteria",
  "risk",
  "status",
  "blockedReason",
  "blockedExplanation",
  "protectedApproval",
  "workflowFeedback",
  "summary",
  "attempts",
  "artifacts",
] as const;
const TEAM_RUN_STATUSES: readonly TeamRunStatus[] = [
  "accepted",
  "running",
  "paused",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];
const TEAM_RUN_LIMIT_KEYS = ["maxNodes", "maxDepth", "maxConcurrency", "maxTotalAttempts"] as const;
const TEAM_ATTEMPT_KEYS = [
  "attemptId",
  "attemptNumber",
  "workerTaskId",
  "status",
  "startedAt",
  "updatedAt",
  "approvalId",
  "incidentCode",
] as const;
const TEAM_ARTIFACT_REFERENCE_KEYS = ["artifactId", "taskId", "kind"] as const;
const TEAM_RUN_RESULT_KEYS = ["summary", "artifacts"] as const;
const TEAM_NODE_STATUSES: readonly TeamNodeStatus[] = [
  "pending",
  "ready",
  "running",
  "approval-blocked",
  "paused",
  "handoff-required",
  "completed",
  "failed",
  "cancelled",
];
const TEAM_ATTEMPT_STATUSES: readonly TeamAttemptStatus[] = [
  "running",
  "blocked",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "replaced",
  "handed-off",
  "interrupted",
];
const TEAM_NODE_BLOCKED_REASONS: readonly TeamNodeBlockedReason[] = [
  "dependency",
  "human-feedback",
  "protected-approval",
  "attempt-failed",
  "cancelled",
  "paused",
  "handoff",
  "interrupted",
];
const TEAM_PROTECTED_APPROVAL_KEYS = [
  "approvalId",
  "policyAuditRecordId",
  "requestAuditRecordId",
  "decision",
  "decisionAuditRecordId",
  "outcomeAuditRecordId",
] as const;
const TEAM_WORKFLOW_FEEDBACK_KEYS = ["decision", "note", "resolvedAt"] as const;
const TEAM_WORKER_CAPABILITIES: readonly TeamWorkerCapability[] = ["general", "coding"];
const TEAM_MEMBER_ROLES: readonly TeamMemberRole[] = ["leader", "teammate"];
const TEAM_PLAN_RISKS: readonly TeamPlanRisk[] = ["low", "medium", "high"];
const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "file",
  "document",
  "dataset",
  "directory",
  "other",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function requireText(value: unknown, field: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    containsControlCharacter(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      `${field} must be normalized, unpadded, control-free bounded text`,
    );
  }
  return value;
}

function requireDigestIdentifier(value: unknown, prefix: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.length !== prefix.length + 64 ||
    !value.startsWith(prefix) ||
    !/^[a-f0-9]{64}$/u.test(value.slice(prefix.length))
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      `${field} must be an Actestra-owned digest identifier`,
    );
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TeamRunContractError("invalid-record", `${field} must be a positive integer`);
  }
  return value as number;
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function teamId(value: string): TeamId {
  return requireDigestIdentifier(value, "team-", "Team id") as TeamId;
}

export function teamMemberId(value: string): TeamMemberId {
  return requireDigestIdentifier(value, "team-member-", "Team member id") as TeamMemberId;
}

export function teamRunId(value: string): TeamRunId {
  return requireDigestIdentifier(value, "team-run-", "Team run id") as TeamRunId;
}

export function teamAttemptId(value: string): TeamAttemptId {
  const match = /^team-attempt-([a-f0-9]{64})-([1-9][0-9]*)$/u.exec(value);
  if (match === null || !Number.isSafeInteger(Number(match[2]))) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team attempt id must be an Actestra-owned node and attempt identity",
    );
  }
  return value as TeamAttemptId;
}

function teamPlanNodeId(value: unknown): TeamPlanNodeId {
  return requireDigestIdentifier(value, "team-node-", "Team node id") as TeamPlanNodeId;
}

export function normalizeTeamDefinition(value: unknown): TeamDefinition {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TEAM_DEFINITION_KEYS) ||
    value.contractVersion !== TEAM_RUN_CONTRACT_VERSION ||
    !Array.isArray(value.members) ||
    value.members.length < TEAM_MIN_MEMBERS ||
    value.members.length > TEAM_MAX_MEMBERS
  ) {
    throw new TeamRunContractError("invalid-record", "Team definition is invalid");
  }
  const members = value.members.map((member): TeamMember => {
    if (
      !isRecord(member) ||
      !hasExactKeys(member, TEAM_MEMBER_KEYS) ||
      !TEAM_MEMBER_ROLES.includes(member.role as TeamMemberRole) ||
      !TEAM_WORKER_CAPABILITIES.includes(member.capability as TeamWorkerCapability)
    ) {
      throw new TeamRunContractError("invalid-record", "Team member is invalid");
    }
    return Object.freeze({
      memberId: teamMemberId(String(member.memberId)),
      role: member.role as TeamMemberRole,
      capability: member.capability as TeamWorkerCapability,
      displayName: requireText(
        member.displayName,
        "Team member display name",
        TEAM_MAX_DISPLAY_NAME_BYTES,
      ),
    });
  });
  if (
    new Set(members.map(({ memberId }) => memberId)).size !== members.length ||
    members.filter(({ role }) => role === "leader").length !== 1 ||
    new Set(members.map(({ capability }) => capability)).size !== TEAM_WORKER_CAPABILITIES.length
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      "The first Team envelope requires one leader and one General and coding member",
    );
  }
  const createdAt = instant(String(value.createdAt));
  const updatedAt = instant(String(value.updatedAt));
  if (compareInstants(updatedAt, createdAt) < 0) {
    throw new TeamRunContractError("invalid-record", "Team update cannot precede creation");
  }
  return deepFreeze({
    contractVersion: TEAM_RUN_CONTRACT_VERSION,
    teamId: teamId(String(value.teamId)),
    name: requireText(value.name, "Team name", TEAM_MAX_NAME_BYTES),
    workspaceId: workspaceId(String(value.workspaceId)),
    members,
    createdAt,
    updatedAt,
  });
}

export function assertTeamDefinition(value: unknown): asserts value is TeamDefinition {
  normalizeTeamDefinition(value);
}

function parseArtifactReference(value: unknown): TeamArtifactReference {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TEAM_ARTIFACT_REFERENCE_KEYS) ||
    !ARTIFACT_KINDS.includes(value.kind as ArtifactKind)
  ) {
    throw new TeamRunContractError("invalid-record", "Team Artifact reference is invalid");
  }
  return Object.freeze({
    artifactId: artifactId(String(value.artifactId)),
    taskId: taskId(String(value.taskId)),
    kind: value.kind as ArtifactKind,
  });
}

function artifactReferenceKey(reference: TeamArtifactReference): string {
  return `${reference.artifactId}\u0000${reference.taskId}\u0000${reference.kind}`;
}

function parseTeamRunResult(value: unknown): TeamRunResult | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TEAM_RUN_RESULT_KEYS) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new TeamRunContractError("invalid-record", "Team run result is invalid");
  }
  const artifacts = value.artifacts.map(parseArtifactReference);
  if (
    artifacts.length === 0 ||
    new Set(artifacts.map(artifactReferenceKey)).size !== artifacts.length
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team run result must contain unique Artifact references",
    );
  }
  return Object.freeze({
    summary: requireText(value.summary, "Team run result summary", 4_096),
    artifacts: Object.freeze(artifacts),
  });
}

function parseRunAttempt(value: unknown, nodeId: TeamPlanNodeId): TeamRunAttempt {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, TEAM_ATTEMPT_KEYS) ||
    !TEAM_ATTEMPT_KEYS.filter((key) => key !== "approvalId" && key !== "incidentCode").every(
      (key) => Object.hasOwn(value, key),
    ) ||
    !TEAM_ATTEMPT_STATUSES.includes(value.status as TeamAttemptStatus)
  ) {
    throw new TeamRunContractError("invalid-record", "Team run attempt is invalid");
  }
  const attemptNumber = requirePositiveInteger(value.attemptNumber, "Team attempt number");
  const stableAttemptId = teamAttemptId(String(value.attemptId));
  const expectedAttemptId = `team-attempt-${nodeId.slice("team-node-".length)}-${String(
    attemptNumber,
  )}`;
  if (stableAttemptId !== expectedAttemptId) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team attempt identity does not match its authoritative node",
    );
  }
  const startedAt = instant(String(value.startedAt));
  const updatedAt = instant(String(value.updatedAt));
  if (compareInstants(updatedAt, startedAt) < 0) {
    throw new TeamRunContractError("invalid-record", "Team attempt update cannot precede start");
  }
  const stable = {
    attemptId: stableAttemptId,
    attemptNumber,
    workerTaskId: taskId(String(value.workerTaskId)),
    status: value.status as TeamAttemptStatus,
    startedAt,
    updatedAt,
    ...(value.approvalId === undefined ? {} : { approvalId: approvalId(String(value.approvalId)) }),
    ...(value.incidentCode === undefined
      ? {}
      : { incidentCode: requireText(value.incidentCode, "Team attempt incident", 128) }),
  };
  return Object.freeze(stable);
}

function parseProtectedApproval(value: unknown): TeamProtectedApprovalReference | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TEAM_PROTECTED_APPROVAL_KEYS) ||
    (value.decision !== null && value.decision !== "approved" && value.decision !== "denied") ||
    (value.decision === null
      ? value.decisionAuditRecordId !== null || value.outcomeAuditRecordId !== null
      : value.decisionAuditRecordId === null)
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team protected Approval reference is invalid",
    );
  }
  return Object.freeze({
    approvalId: approvalId(String(value.approvalId)),
    policyAuditRecordId: auditRecordId(String(value.policyAuditRecordId)),
    requestAuditRecordId: auditRecordId(String(value.requestAuditRecordId)),
    decision: value.decision as "approved" | "denied" | null,
    decisionAuditRecordId:
      value.decisionAuditRecordId === null
        ? null
        : auditRecordId(String(value.decisionAuditRecordId)),
    outcomeAuditRecordId:
      value.outcomeAuditRecordId === null
        ? null
        : auditRecordId(String(value.outcomeAuditRecordId)),
  });
}

function parseWorkflowFeedback(value: unknown): TeamWorkflowFeedback | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TEAM_WORKFLOW_FEEDBACK_KEYS) ||
    (value.decision !== "approved" && value.decision !== "denied")
  ) {
    throw new TeamRunContractError("invalid-record", "Team workflow feedback is invalid");
  }
  return Object.freeze({
    decision: value.decision,
    note: requireText(value.note, "Team workflow feedback note", 2_048),
    resolvedAt: instant(String(value.resolvedAt)),
  });
}

function parseRunNode(value: unknown): TeamRunNode {
  if (
    !isRecord(value) ||
    !Array.isArray(value.dependsOn) ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.artifacts)
  ) {
    throw new TeamRunContractError("invalid-record", "Team run node is invalid");
  }
  const expectedKeys =
    value.kind === "worker" ? TEAM_RUN_WORKER_NODE_KEYS : TEAM_RUN_HUMAN_NODE_KEYS;
  if (!hasExactKeys(value, expectedKeys)) {
    throw new TeamRunContractError("invalid-record", "Team run node contains an unknown field");
  }
  if (
    !TEAM_NODE_STATUSES.includes(value.status as TeamNodeStatus) ||
    !TEAM_PLAN_RISKS.includes(value.risk as TeamPlanRisk)
  ) {
    throw new TeamRunContractError("invalid-record", "Team run node state is invalid");
  }
  const stableNodeId = teamPlanNodeId(value.nodeId);
  const attempts = value.attempts.map((attempt) => parseRunAttempt(attempt, stableNodeId));
  if (
    attempts.some((attempt, index) => attempt.attemptNumber !== index + 1) ||
    new Set(attempts.map(({ workerTaskId }) => workerTaskId)).size !== attempts.length
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team run attempts must be contiguous and use immutable Worker Task identities",
    );
  }
  const artifacts = value.artifacts.map(parseArtifactReference);
  if (new Set(artifacts.map(({ artifactId }) => artifactId)).size !== artifacts.length) {
    throw new TeamRunContractError("invalid-record", "Team Artifact references must be unique");
  }
  const blockedReason =
    value.blockedReason === null
      ? null
      : TEAM_NODE_BLOCKED_REASONS.includes(value.blockedReason as TeamNodeBlockedReason)
        ? (value.blockedReason as TeamNodeBlockedReason)
        : undefined;
  if (blockedReason === undefined) {
    throw new TeamRunContractError("invalid-record", "Team node blocked reason is invalid");
  }
  const blockedExplanation =
    value.blockedExplanation === null
      ? null
      : requireText(value.blockedExplanation, "Team node blocked explanation", 1_024);
  if ((blockedReason === null) !== (blockedExplanation === null)) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team node blocked reason and explanation must change together",
    );
  }
  const protectedApproval = parseProtectedApproval(value.protectedApproval);
  const workflowFeedback = parseWorkflowFeedback(value.workflowFeedback);
  const summary =
    value.summary === null ? null : requireText(value.summary, "Team node summary", 4_096);
  const base = {
    nodeId: stableNodeId,
    taskId: taskId(String(value.taskId)),
    candidateKey: requireText(value.candidateKey, "Team candidate key", 128),
    title: requireText(value.title, "Team node title", 256),
    dependsOn: Object.freeze(value.dependsOn.map(teamPlanNodeId)),
    completionCriteria: requireText(value.completionCriteria, "Team completion criteria", 2_048),
    risk: value.risk as TeamPlanRisk,
    status: value.status as TeamNodeStatus,
    blockedReason,
    blockedExplanation,
    protectedApproval,
    workflowFeedback,
    summary,
    attempts: Object.freeze(attempts),
    artifacts: Object.freeze(artifacts),
  } as const;
  if (value.kind === "human-feedback") {
    if (protectedApproval !== null || attempts.length !== 0 || artifacts.length !== 0) {
      throw new TeamRunContractError(
        "invalid-record",
        "Workflow feedback cannot contain Worker or protected Approval authority",
      );
    }
    return Object.freeze({ ...base, kind: "human-feedback" });
  }
  if (
    value.kind !== "worker" ||
    !TEAM_WORKER_CAPABILITIES.includes(value.capability as TeamWorkerCapability) ||
    !ARTIFACT_KINDS.includes(value.expectedArtifactKind as ArtifactKind)
  ) {
    throw new TeamRunContractError("invalid-record", "Team run worker node is invalid");
  }
  if (workflowFeedback !== null) {
    throw new TeamRunContractError(
      "invalid-record",
      "Worker nodes cannot contain workflow feedback authority",
    );
  }
  return Object.freeze({
    ...base,
    kind: "worker",
    capability: value.capability as TeamWorkerCapability,
    expectedArtifactKind: value.expectedArtifactKind as ArtifactKind,
    maxAttempts: requirePositiveInteger(value.maxAttempts, "Team node maximum attempts"),
  });
}

export function normalizeTeamRunSnapshot(value: unknown): TeamRunSnapshot {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, TEAM_RUN_KEYS) ||
    value.contractVersion !== TEAM_RUN_CONTRACT_VERSION ||
    !Array.isArray(value.nodes) ||
    !isRecord(value.limits) ||
    !hasExactKeys(value.limits, TEAM_RUN_LIMIT_KEYS) ||
    !TEAM_RUN_STATUSES.includes(value.status as TeamRunStatus)
  ) {
    throw new TeamRunContractError("invalid-record", "Team run snapshot is invalid");
  }
  const nodes = value.nodes.map(parseRunNode);
  const nodeIds = new Set(nodes.map(({ nodeId }) => nodeId));
  if (nodeIds.size !== nodes.length) {
    throw new TeamRunContractError("invalid-record", "Team run node identities must be unique");
  }
  const seen = new Set<TeamPlanNodeId>();
  for (const node of nodes) {
    if (node.dependsOn.some((dependency) => !seen.has(dependency))) {
      throw new TeamRunContractError(
        "invalid-record",
        "Team run dependencies must reference earlier canonical nodes",
      );
    }
    seen.add(node.nodeId);
  }
  const createdAt = instant(String(value.createdAt));
  const updatedAt = instant(String(value.updatedAt));
  if (compareInstants(updatedAt, createdAt) < 0) {
    throw new TeamRunContractError("invalid-record", "Team run update cannot precede creation");
  }
  const limits = Object.freeze({
    maxNodes: requirePositiveInteger(value.limits.maxNodes, "Team maximum nodes"),
    maxDepth: requirePositiveInteger(value.limits.maxDepth, "Team maximum depth"),
    maxConcurrency: requirePositiveInteger(value.limits.maxConcurrency, "Team maximum concurrency"),
    maxTotalAttempts: requirePositiveInteger(
      value.limits.maxTotalAttempts,
      "Team maximum attempts",
    ),
  });
  if (
    nodes.length > limits.maxNodes ||
    limits.maxConcurrency > 2 ||
    nodes.reduce((count, node) => count + node.attempts.length, 0) > limits.maxTotalAttempts
  ) {
    throw new TeamRunContractError("invalid-record", "Team run limits do not match its state");
  }
  const result = parseTeamRunResult(value.result);
  const status = value.status as TeamRunStatus;
  const statusExplanation =
    value.statusExplanation === null
      ? null
      : requireText(value.statusExplanation, "Team run status explanation", 2_048);
  const nodeArtifacts = nodes.flatMap(({ artifacts }) => artifacts);
  const resultArtifactKeys = result?.artifacts.map(artifactReferenceKey) ?? [];
  const nodeArtifactKeys = nodeArtifacts.map(artifactReferenceKey);
  if (
    (status === "completed") !== (result !== null) ||
    (result !== null &&
      (nodes.some(({ status: nodeStatus }) => nodeStatus !== "completed") ||
        resultArtifactKeys.length !== nodeArtifactKeys.length ||
        resultArtifactKeys.some((key) => !nodeArtifactKeys.includes(key)))) ||
    (status === "cancelled" && statusExplanation === null) ||
    (status === "completed" && statusExplanation !== null)
  ) {
    throw new TeamRunContractError(
      "invalid-record",
      "Team run result and explanation do not match its authoritative status",
    );
  }
  return deepFreeze({
    contractVersion: TEAM_RUN_CONTRACT_VERSION,
    runId: teamRunId(String(value.runId)),
    teamId: teamId(String(value.teamId)),
    planId: teamPlanId(String(value.planId)),
    revision: requirePositiveInteger(value.revision, "Team run revision"),
    status,
    limits,
    nodes,
    result,
    statusExplanation,
    createdAt,
    updatedAt,
  });
}

export function assertTeamRunSnapshot(value: unknown): asserts value is TeamRunSnapshot {
  normalizeTeamRunSnapshot(value);
}

export function assertPersistTeamDefinitionResult(
  value: unknown,
): asserts value is PersistTeamDefinitionResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "team"]) ||
    (value.status !== "stored" && value.status !== "duplicate")
  ) {
    throw new TeamRunContractError("invalid-record", "Persisted Team definition result is invalid");
  }
  assertTeamDefinition(value.team);
}

export function assertReplaceTeamDefinitionResult(
  value: unknown,
): asserts value is ReplaceTeamDefinitionResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "team"]) ||
    (value.status !== "stored" && value.status !== "duplicate")
  ) {
    throw new TeamRunContractError("invalid-record", "Replaced Team definition result is invalid");
  }
  assertTeamDefinition(value.team);
}

export function assertRemoveTeamDefinitionResult(
  value: unknown,
): asserts value is RemoveTeamDefinitionResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "teamId"]) ||
    (value.status !== "removed" && value.status !== "duplicate")
  ) {
    throw new TeamRunContractError("invalid-record", "Removed Team definition result is invalid");
  }
  teamId(String(value.teamId));
}

export function assertPersistTeamRunSnapshotResult(
  value: unknown,
): asserts value is PersistTeamRunSnapshotResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["status", "snapshot"]) ||
    (value.status !== "stored" && value.status !== "duplicate")
  ) {
    throw new TeamRunContractError("invalid-record", "Persisted Team run result is invalid");
  }
  assertTeamRunSnapshot(value.snapshot);
}

export function createTeamRunSnapshot(
  planValue: AdmittedTeamPlan,
  teamValue: TeamDefinition,
  createdAtValue: Instant,
): TeamRunSnapshot {
  const plan = normalizeAdmittedTeamPlan(JSON.parse(JSON.stringify(planValue)));
  const team = normalizeTeamDefinition(JSON.parse(JSON.stringify(teamValue)));
  const capabilities = new Set(team.members.map(({ capability }) => capability));
  if (plan.nodes.some((node) => node.kind === "worker" && !capabilities.has(node.capability))) {
    throw new TeamRunContractError(
      "missing-capability",
      "The Team does not provide every admitted worker capability",
    );
  }
  const createdAt = instant(createdAtValue);
  const digest = plan.planId.slice("team-plan-".length);
  return normalizeTeamRunSnapshot({
    contractVersion: TEAM_RUN_CONTRACT_VERSION,
    runId: teamRunId(`team-run-${digest}`),
    teamId: team.teamId,
    planId: plan.planId,
    revision: 1,
    status: "accepted",
    limits: plan.limits,
    nodes: plan.nodes.map((node) => {
      const base = {
        nodeId: node.nodeId,
        taskId: node.taskId,
        candidateKey: node.candidateKey,
        title: node.title,
        dependsOn: node.dependsOn,
        completionCriteria: node.completionCriteria,
        risk: node.risk,
        status: "pending",
        blockedReason: "dependency",
        blockedExplanation: "Waiting for admitted dependencies.",
        protectedApproval: null,
        workflowFeedback: null,
        summary: null,
        attempts: [],
        artifacts: [],
      } as const;
      return node.kind === "human-feedback"
        ? { ...base, kind: "human-feedback" }
        : {
            ...base,
            kind: "worker",
            capability: node.capability,
            expectedArtifactKind: node.expectedArtifactKind,
            maxAttempts: node.maxAttempts,
          };
    }),
    result: null,
    statusExplanation: null,
    createdAt,
    updatedAt: createdAt,
  });
}

function teamRunSnapshotsMatch(left: TeamRunSnapshot, right: TeamRunSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function assertInitialTeamRunSnapshot(
  planValue: AdmittedTeamPlan,
  teamValue: TeamDefinition,
  snapshotValue: TeamRunSnapshot,
): void {
  const snapshot = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
  const expected = createTeamRunSnapshot(planValue, teamValue, snapshot.createdAt);
  if (!teamRunSnapshotsMatch(snapshot, expected)) {
    throw new TeamRunContractError(
      "invalid-transition",
      "The initial Team run must be derived from its canonical admitted plan and Team",
    );
  }
}

function appendNodeRevisionCandidates(
  candidates: unknown[],
  node: TeamRunNode,
  occurredAt: Instant,
): void {
  const attempt = node.attempts.at(-1);
  if (node.kind === "human-feedback") {
    if (node.workflowFeedback !== null) {
      candidates.push({
        type: "resolve-human-feedback",
        nodeId: node.nodeId,
        decision: node.workflowFeedback.decision,
        note: node.workflowFeedback.note,
        occurredAt,
      });
    }
    return;
  }

  if (attempt !== undefined) {
    candidates.push({
      type: "start-node",
      nodeId: node.nodeId,
      workerTaskId: attempt.workerTaskId,
      occurredAt,
    });
    if (node.summary !== null && node.artifacts.length > 0) {
      candidates.push({
        type: "complete-node",
        nodeId: node.nodeId,
        attemptId: attempt.attemptId,
        artifacts: node.artifacts,
        summary: node.summary,
        occurredAt,
      });
    }
    if (attempt.incidentCode !== undefined) {
      candidates.push({
        type: "fail-node",
        nodeId: node.nodeId,
        attemptId: attempt.attemptId,
        incidentCode: attempt.incidentCode,
        occurredAt,
      });
    }
  }

  const approval = node.protectedApproval;
  if (attempt !== undefined && approval !== null) {
    if (node.blockedExplanation !== null) {
      candidates.push({
        type: "block-node",
        nodeId: node.nodeId,
        attemptId: attempt.attemptId,
        approvalId: approval.approvalId,
        policyAuditRecordId: approval.policyAuditRecordId,
        requestAuditRecordId: approval.requestAuditRecordId,
        reason: node.blockedExplanation,
        occurredAt,
      });
    }
    if (approval.decision !== null && approval.decisionAuditRecordId !== null) {
      candidates.push({
        type: "request-node-approval-decision",
        nodeId: node.nodeId,
        approvalId: approval.approvalId,
        decision: approval.decision,
        decisionAuditRecordId: approval.decisionAuditRecordId,
        occurredAt,
      });
      if (approval.outcomeAuditRecordId !== null) {
        candidates.push({
          type: "resolve-node-approval",
          nodeId: node.nodeId,
          approvalId: approval.approvalId,
          outcomeAuditRecordId: approval.outcomeAuditRecordId,
          occurredAt,
        });
      }
    }
  }

  const retainedReason = node.blockedExplanation ?? "Validate the persisted Core transition.";
  for (const type of ["pause-node", "resume-node", "retry-node", "replace-node"] as const) {
    candidates.push({ type, nodeId: node.nodeId, reason: retainedReason, occurredAt });
  }
  if (node.blockedExplanation !== null) {
    candidates.push({
      type: "request-handoff",
      nodeId: node.nodeId,
      reason: node.blockedExplanation,
      occurredAt,
    });
  }
  if (node.status === "cancelled" && node.blockedReason === "cancelled") {
    candidates.push({
      type: "cancel-node",
      nodeId: node.nodeId,
      reason: node.blockedExplanation ?? "The bounded Worker node was cancelled.",
      occurredAt,
    });
  }
  if (node.summary !== null && node.artifacts.length > 0) {
    candidates.push({
      type: "complete-handoff",
      nodeId: node.nodeId,
      artifacts: node.artifacts,
      summary: node.summary,
      occurredAt,
    });
  }
}

export function assertTeamRunRevisionTransition(
  previousValue: TeamRunSnapshot,
  nextValue: TeamRunSnapshot,
): void {
  const previous = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(previousValue)));
  const next = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(nextValue)));
  if (next.revision !== previous.revision + 1) {
    throw new TeamRunContractError(
      "invalid-transition",
      "A Team run revision must advance exactly once",
    );
  }

  const candidates: unknown[] = [{ type: "start-run", occurredAt: next.updatedAt }];
  if (next.statusExplanation !== null) {
    candidates.push({
      type: "cancel-run",
      reason: next.statusExplanation,
      occurredAt: next.updatedAt,
    });
  }
  if (next.result !== null) {
    candidates.push({
      type: "complete-aggregation",
      result: next.result,
      occurredAt: next.updatedAt,
    });
  }
  for (const node of next.nodes) {
    appendNodeRevisionCandidates(candidates, node, next.updatedAt);
  }

  for (const command of candidates) {
    try {
      if (teamRunSnapshotsMatch(transitionTeamRun(previous, command), next)) return;
    } catch (error) {
      if (!(error instanceof TeamRunContractError)) throw error;
    }
  }
  try {
    if (teamRunSnapshotsMatch(recoverTeamRunSnapshot(previous, next.updatedAt), next)) return;
  } catch (error) {
    if (!(error instanceof TeamRunContractError)) throw error;
  }
  throw new TeamRunContractError(
    "invalid-transition",
    "The Team run revision was not produced by one allowed Core transition",
  );
}

function commandTime(command: Record<string, unknown>, snapshot: TeamRunSnapshot): Instant {
  const occurredAt = instant(String(command.occurredAt));
  if (compareInstants(occurredAt, snapshot.updatedAt) < 0) {
    throw new TeamRunContractError("invalid-transition", "Team run time cannot move backwards");
  }
  return occurredAt;
}

function requireRunNode(snapshot: TeamRunSnapshot, nodeIdValue: unknown): TeamRunNode {
  const stableNodeId = teamPlanNodeId(nodeIdValue);
  const node = snapshot.nodes.find(({ nodeId }) => nodeId === stableNodeId);
  if (node === undefined) {
    throw new TeamRunContractError("invalid-transition", "Team run does not own the node");
  }
  return node;
}

function withNode(
  snapshot: TeamRunSnapshot,
  node: TeamRunNode,
  occurredAt: Instant,
  status: TeamRunStatus = snapshot.status,
): TeamRunSnapshot {
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status,
    nodes: snapshot.nodes.map((candidate) => (candidate.nodeId === node.nodeId ? node : candidate)),
    updatedAt: occurredAt,
  });
}

function openSatisfiedDependencies(nodes: readonly TeamRunNode[]): readonly TeamRunNode[] {
  const completed = new Set(
    nodes.filter(({ status }) => status === "completed").map(({ nodeId }) => nodeId),
  );
  return nodes.map((node) => {
    if (
      node.status !== "pending" ||
      !node.dependsOn.every((dependency) => completed.has(dependency))
    ) {
      return node;
    }
    return Object.freeze({
      ...node,
      status: node.kind === "human-feedback" ? "approval-blocked" : "ready",
      blockedReason: node.kind === "human-feedback" ? "human-feedback" : null,
      blockedExplanation:
        node.kind === "human-feedback" ? "Waiting for bounded workflow feedback." : null,
    });
  });
}

function deriveRunStatus(nodes: readonly TeamRunNode[]): TeamRunStatus {
  if (nodes.some(({ status }) => status === "running" || status === "ready")) return "running";
  if (nodes.every(({ status }) => status === "completed")) return "blocked";
  if (
    nodes.some(
      ({ status }) =>
        status === "approval-blocked" ||
        status === "handoff-required" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "paused",
    )
  ) {
    return "blocked";
  }
  return "running";
}

function startRun(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  if (!hasExactKeys(command, ["type", "occurredAt"]) || snapshot.status !== "accepted") {
    throw new TeamRunContractError("invalid-transition", "Only an accepted Team run can start");
  }
  const occurredAt = commandTime(command, snapshot);
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: "running",
    nodes: openSatisfiedDependencies(snapshot.nodes),
    updatedAt: occurredAt,
  });
}

function startNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  if (
    !hasExactKeys(command, ["type", "nodeId", "workerTaskId", "occurredAt"]) ||
    snapshot.status !== "running"
  ) {
    throw new TeamRunContractError("invalid-transition", "Team worker start is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  if (node.kind !== "worker" || node.status !== "ready") {
    throw new TeamRunContractError("invalid-transition", "Only a ready worker node can start");
  }
  const activeAttempts = snapshot.nodes
    .flatMap(({ attempts }) => attempts)
    .filter(({ status }) => status === "running" || status === "paused").length;
  const totalAttempts = snapshot.nodes.reduce(
    (count, candidate) => count + candidate.attempts.length,
    0,
  );
  if (
    activeAttempts >= snapshot.limits.maxConcurrency ||
    totalAttempts >= snapshot.limits.maxTotalAttempts ||
    node.attempts.length >= node.maxAttempts
  ) {
    throw new TeamRunContractError("attempt-limit", "Team worker attempt budget is exhausted");
  }
  const attemptNumber = node.attempts.length + 1;
  const attempt = Object.freeze({
    attemptId: teamAttemptId(
      `team-attempt-${node.nodeId.slice("team-node-".length)}-${String(attemptNumber)}`,
    ),
    attemptNumber,
    workerTaskId: taskId(String(command.workerTaskId)),
    status: "running" as const,
    startedAt: occurredAt,
    updatedAt: occurredAt,
  });
  return withNode(
    snapshot,
    Object.freeze({
      ...node,
      status: "running",
      blockedReason: null,
      blockedExplanation: null,
      attempts: Object.freeze([...node.attempts, attempt]),
    }),
    occurredAt,
  );
}

function completeNode(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  if (
    !hasExactKeys(command, ["type", "nodeId", "attemptId", "artifacts", "summary", "occurredAt"]) ||
    !Array.isArray(command.artifacts)
  ) {
    throw new TeamRunContractError("invalid-transition", "Team worker completion is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  if (node.kind !== "worker" || node.status !== "running") {
    throw new TeamRunContractError("invalid-transition", "Only a running worker node can complete");
  }
  requireText(command.summary, "Team worker summary", 4_096);
  const attempt = node.attempts.at(-1);
  const stableAttemptId = teamAttemptId(String(command.attemptId));
  if (
    attempt === undefined ||
    attempt.attemptId !== stableAttemptId ||
    attempt.status !== "running"
  ) {
    throw new TeamRunContractError("stale-attempt", "Team worker completion uses a stale attempt");
  }
  const artifacts = command.artifacts.map(parseArtifactReference);
  if (
    artifacts.length === 0 ||
    !artifacts.some(({ kind }) => kind === node.expectedArtifactKind) ||
    artifacts.some(({ taskId: ownerTaskId }) => ownerTaskId !== attempt.workerTaskId) ||
    new Set(artifacts.map(({ artifactId: stableArtifactId }) => stableArtifactId)).size !==
      artifacts.length
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Team worker completion lacks its expected owned Artifact",
    );
  }
  const completedAttempt = Object.freeze({
    ...attempt,
    status: "completed" as const,
    updatedAt: occurredAt,
  });
  const completedNode = Object.freeze({
    ...node,
    status: "completed" as const,
    blockedReason: null,
    blockedExplanation: null,
    summary: requireText(command.summary, "Team worker summary", 4_096),
    attempts: Object.freeze(
      node.attempts.map((candidate) =>
        candidate.attemptId === completedAttempt.attemptId ? completedAttempt : candidate,
      ),
    ),
    artifacts: Object.freeze(artifacts),
  });
  const nodes = openSatisfiedDependencies(
    snapshot.nodes.map((candidate) =>
      candidate.nodeId === completedNode.nodeId ? completedNode : candidate,
    ),
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function blockNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  if (
    !hasExactKeys(command, [
      "type",
      "nodeId",
      "attemptId",
      "approvalId",
      "policyAuditRecordId",
      "requestAuditRecordId",
      "reason",
      "occurredAt",
    ])
  ) {
    throw new TeamRunContractError("invalid-transition", "Protected Approval block is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  const stableAttemptId = teamAttemptId(String(command.attemptId));
  const attempt = node.attempts.at(-1);
  if (
    node.kind !== "worker" ||
    node.status !== "running" ||
    attempt === undefined ||
    attempt.attemptId !== stableAttemptId ||
    attempt.status !== "running"
  ) {
    throw new TeamRunContractError(
      "stale-attempt",
      "Only the active Worker attempt can wait for protected Approval",
    );
  }
  const stableApprovalId = approvalId(String(command.approvalId));
  const blockedAttempt = Object.freeze({
    ...attempt,
    status: "blocked" as const,
    updatedAt: occurredAt,
    approvalId: stableApprovalId,
  });
  const blockedNode = Object.freeze({
    ...node,
    status: "approval-blocked" as const,
    blockedReason: "protected-approval" as const,
    blockedExplanation: requireText(command.reason, "Protected Approval reason", 1_024),
    protectedApproval: Object.freeze({
      approvalId: stableApprovalId,
      policyAuditRecordId: auditRecordId(String(command.policyAuditRecordId)),
      requestAuditRecordId: auditRecordId(String(command.requestAuditRecordId)),
      decision: null,
      decisionAuditRecordId: null,
      outcomeAuditRecordId: null,
    }),
    attempts: Object.freeze(
      node.attempts.map((candidate) =>
        candidate.attemptId === blockedAttempt.attemptId ? blockedAttempt : candidate,
      ),
    ),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === blockedNode.nodeId ? blockedNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function requestNodeApprovalDecision(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  if (
    !hasExactKeys(command, [
      "type",
      "nodeId",
      "approvalId",
      "decision",
      "decisionAuditRecordId",
      "occurredAt",
    ]) ||
    (command.decision !== "approved" && command.decision !== "denied")
  ) {
    throw new TeamRunContractError("invalid-transition", "Protected Approval decision is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  const reference = node.protectedApproval;
  const stableApprovalId = approvalId(String(command.approvalId));
  const attempt = node.attempts.at(-1);
  if (
    node.kind !== "worker" ||
    node.status !== "approval-blocked" ||
    node.blockedReason !== "protected-approval" ||
    reference === null ||
    reference.approvalId !== stableApprovalId ||
    reference.decision !== null ||
    attempt?.status !== "blocked" ||
    attempt.approvalId !== stableApprovalId
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Protected Approval decision does not match an active blocked Worker",
    );
  }
  const decision = command.decision;
  const nextNode = Object.freeze({
    ...node,
    protectedApproval: Object.freeze({
      ...reference,
      decision,
      decisionAuditRecordId: auditRecordId(String(command.decisionAuditRecordId)),
    }),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === nextNode.nodeId ? nextNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function resolveNodeApproval(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  if (
    !hasExactKeys(command, ["type", "nodeId", "approvalId", "outcomeAuditRecordId", "occurredAt"])
  ) {
    throw new TeamRunContractError("invalid-transition", "Protected Approval outcome is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  const reference = node.protectedApproval;
  const stableApprovalId = approvalId(String(command.approvalId));
  const attempt = node.attempts.at(-1);
  if (
    node.kind !== "worker" ||
    node.status !== "approval-blocked" ||
    node.blockedReason !== "protected-approval" ||
    reference === null ||
    reference.approvalId !== stableApprovalId ||
    reference.decision === null ||
    reference.decisionAuditRecordId === null ||
    reference.outcomeAuditRecordId !== null ||
    attempt?.status !== "blocked" ||
    attempt.approvalId !== stableApprovalId
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Protected Approval outcome does not match a recorded decision",
    );
  }
  const decision = reference.decision;
  const nextAttempt = Object.freeze({
    ...attempt,
    status: decision === "approved" ? ("running" as const) : ("failed" as const),
    updatedAt: occurredAt,
  });
  const nextNode = Object.freeze({
    ...node,
    status: decision === "approved" ? ("running" as const) : ("failed" as const),
    blockedReason: decision === "approved" ? null : ("attempt-failed" as const),
    blockedExplanation: decision === "approved" ? null : "The protected operation was denied.",
    protectedApproval: Object.freeze({
      ...reference,
      outcomeAuditRecordId: auditRecordId(String(command.outcomeAuditRecordId)),
    }),
    attempts: Object.freeze(
      node.attempts.map((candidate) =>
        candidate.attemptId === nextAttempt.attemptId ? nextAttempt : candidate,
      ),
    ),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === nextNode.nodeId ? nextNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function resolveHumanFeedback(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  if (
    !hasExactKeys(command, ["type", "nodeId", "decision", "note", "occurredAt"]) ||
    (command.decision !== "approved" && command.decision !== "denied")
  ) {
    throw new TeamRunContractError("invalid-transition", "Workflow feedback decision is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  if (
    node.kind !== "human-feedback" ||
    node.status !== "approval-blocked" ||
    node.blockedReason !== "human-feedback" ||
    node.protectedApproval !== null ||
    node.workflowFeedback !== null
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Workflow feedback does not match an active human-feedback node",
    );
  }
  const decision = command.decision;
  const nextNode = Object.freeze({
    ...node,
    status: decision === "approved" ? ("completed" as const) : ("failed" as const),
    blockedReason: decision === "approved" ? null : ("attempt-failed" as const),
    blockedExplanation: decision === "approved" ? null : "The workflow feedback was denied.",
    workflowFeedback: Object.freeze({
      decision,
      note: requireText(command.note, "Workflow feedback note", 2_048),
      resolvedAt: occurredAt,
    }),
    summary: requireText(command.note, "Workflow feedback note", 2_048),
  });
  const nodes = openSatisfiedDependencies(
    snapshot.nodes.map((candidate) =>
      candidate.nodeId === nextNode.nodeId ? nextNode : candidate,
    ),
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function requireReasonCommand(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): { readonly node: TeamRunNode; readonly reason: string; readonly occurredAt: Instant } {
  if (!hasExactKeys(command, ["type", "nodeId", "reason", "occurredAt"])) {
    throw new TeamRunContractError("invalid-transition", "Team node control command is invalid");
  }
  return {
    node: requireRunNode(snapshot, command.nodeId),
    reason: requireText(command.reason, "Team node control reason", 1_024),
    occurredAt: commandTime(command, snapshot),
  };
}

function requireLatestWorkerAttempt(
  node: TeamRunNode,
  statuses: readonly TeamAttemptStatus[],
  message: string,
): TeamRunAttempt {
  const attempt = node.attempts.at(-1);
  if (node.kind !== "worker" || attempt === undefined || !statuses.includes(attempt.status)) {
    throw new TeamRunContractError("invalid-transition", message);
  }
  return attempt;
}

function replaceAttempt(
  node: TeamRunWorkerNode,
  attempt: TeamRunAttempt,
): readonly TeamRunAttempt[] {
  return Object.freeze(
    node.attempts.map((candidate) =>
      candidate.attemptId === attempt.attemptId ? attempt : candidate,
    ),
  );
}

function requireAnotherAttemptBudget(snapshot: TeamRunSnapshot, node: TeamRunWorkerNode): void {
  const totalAttempts = snapshot.nodes.reduce(
    (count, candidate) => count + candidate.attempts.length,
    0,
  );
  if (
    node.attempts.length >= node.maxAttempts ||
    totalAttempts >= snapshot.limits.maxTotalAttempts
  ) {
    throw new TeamRunContractError("attempt-limit", "Team worker attempt budget is exhausted");
  }
}

function pauseNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  const { node, reason, occurredAt } = requireReasonCommand(snapshot, command);
  const attempt = requireLatestWorkerAttempt(
    node,
    ["running"],
    "Only an active Worker attempt can pause",
  );
  if (node.kind !== "worker" || node.status !== "running") {
    throw new TeamRunContractError("invalid-transition", "Only a running Worker node can pause");
  }
  const pausedAttempt = Object.freeze({
    ...attempt,
    status: "paused" as const,
    updatedAt: occurredAt,
  });
  return withNode(
    snapshot,
    Object.freeze({
      ...node,
      status: "paused",
      blockedReason: "paused",
      blockedExplanation: reason,
      attempts: replaceAttempt(node, pausedAttempt),
    }),
    occurredAt,
    deriveRunStatus(
      snapshot.nodes.map((candidate) =>
        candidate.nodeId === node.nodeId ? { ...node, status: "paused" } : candidate,
      ),
    ),
  );
}

function resumeNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  const { node, occurredAt } = requireReasonCommand(snapshot, command);
  const attempt = requireLatestWorkerAttempt(
    node,
    ["paused"],
    "Only a paused Worker attempt can resume",
  );
  if (node.kind !== "worker" || node.status !== "paused") {
    throw new TeamRunContractError("invalid-transition", "Only a paused Worker node can resume");
  }
  const resumedAttempt = Object.freeze({
    ...attempt,
    status: "running" as const,
    updatedAt: occurredAt,
  });
  const resumedNode = Object.freeze({
    ...node,
    status: "running" as const,
    blockedReason: null,
    blockedExplanation: null,
    attempts: replaceAttempt(node, resumedAttempt),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === resumedNode.nodeId ? resumedNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function failNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  if (!hasExactKeys(command, ["type", "nodeId", "attemptId", "incidentCode", "occurredAt"])) {
    throw new TeamRunContractError("invalid-transition", "Team Worker failure is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  const attempt = requireLatestWorkerAttempt(
    node,
    ["running", "blocked", "paused"],
    "Only an active Worker attempt can fail",
  );
  const stableAttemptId = teamAttemptId(String(command.attemptId));
  if (
    node.kind !== "worker" ||
    attempt.attemptId !== stableAttemptId ||
    !["running", "approval-blocked", "paused"].includes(node.status)
  ) {
    throw new TeamRunContractError("stale-attempt", "Team Worker failure uses a stale attempt");
  }
  const incidentCode = requireText(command.incidentCode, "Team Worker incident", 128);
  const failedAttempt = Object.freeze({
    ...attempt,
    status: "failed" as const,
    updatedAt: occurredAt,
    incidentCode,
  });
  const failedNode = Object.freeze({
    ...node,
    status: "failed" as const,
    blockedReason: "attempt-failed" as const,
    blockedExplanation: "The bounded Worker attempt failed.",
    attempts: replaceAttempt(node, failedAttempt),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === failedNode.nodeId ? failedNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function retryNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  const { node, occurredAt } = requireReasonCommand(snapshot, command);
  if (node.kind !== "worker" || (node.status !== "failed" && node.status !== "cancelled")) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Only a failed or cancelled Worker node can retry",
    );
  }
  const attempt = node.attempts.at(-1);
  if (
    attempt === undefined ||
    (attempt.status !== "failed" &&
      attempt.status !== "interrupted" &&
      attempt.status !== "cancelled")
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "The failed node has no retryable attempt",
    );
  }
  requireAnotherAttemptBudget(snapshot, node);
  const readyNode = Object.freeze({
    ...node,
    status: "ready" as const,
    blockedReason: null,
    blockedExplanation: null,
    protectedApproval: null,
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === readyNode.nodeId ? readyNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function cancelNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  const { node, reason, occurredAt } = requireReasonCommand(snapshot, command);
  const attempt = requireLatestWorkerAttempt(
    node,
    ["running", "blocked", "paused"],
    "Only an active Worker attempt can be cancelled",
  );
  if (node.kind !== "worker" || !["running", "approval-blocked", "paused"].includes(node.status)) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Only an active Worker node can be cancelled",
    );
  }
  const cancelledAttempt = Object.freeze({
    ...attempt,
    status: "cancelled" as const,
    updatedAt: occurredAt,
  });
  const cancelledNode = Object.freeze({
    ...node,
    status: "cancelled" as const,
    blockedReason: "cancelled" as const,
    blockedExplanation: reason,
    attempts: replaceAttempt(node, cancelledAttempt),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === cancelledNode.nodeId ? cancelledNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function replaceNode(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  const { node, occurredAt } = requireReasonCommand(snapshot, command);
  const attempt = requireLatestWorkerAttempt(
    node,
    ["running", "blocked", "paused"],
    "Only an active Worker attempt can be replaced",
  );
  if (node.kind !== "worker" || !["running", "approval-blocked", "paused"].includes(node.status)) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Only an active Worker node can be replaced",
    );
  }
  requireAnotherAttemptBudget(snapshot, node);
  const replacedAttempt = Object.freeze({
    ...attempt,
    status: "replaced" as const,
    updatedAt: occurredAt,
  });
  const readyNode = Object.freeze({
    ...node,
    status: "ready" as const,
    blockedReason: null,
    blockedExplanation: null,
    protectedApproval: null,
    attempts: replaceAttempt(node, replacedAttempt),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === readyNode.nodeId ? readyNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function requestHandoff(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  const { node, reason, occurredAt } = requireReasonCommand(snapshot, command);
  const attempt = requireLatestWorkerAttempt(
    node,
    ["running", "blocked", "paused"],
    "Only an active Worker attempt can request handoff",
  );
  if (node.kind !== "worker" || !["running", "approval-blocked", "paused"].includes(node.status)) {
    throw new TeamRunContractError("invalid-transition", "Only an active Worker node can hand off");
  }
  const handedOffAttempt = Object.freeze({
    ...attempt,
    status: "handed-off" as const,
    updatedAt: occurredAt,
  });
  const handedOffNode = Object.freeze({
    ...node,
    status: "handoff-required" as const,
    blockedReason: "handoff" as const,
    blockedExplanation: reason,
    protectedApproval: null,
    attempts: replaceAttempt(node, handedOffAttempt),
  });
  const nodes = snapshot.nodes.map((candidate) =>
    candidate.nodeId === handedOffNode.nodeId ? handedOffNode : candidate,
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function completeHandoff(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  if (
    !hasExactKeys(command, ["type", "nodeId", "artifacts", "summary", "occurredAt"]) ||
    !Array.isArray(command.artifacts)
  ) {
    throw new TeamRunContractError("invalid-transition", "Team handoff completion is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const node = requireRunNode(snapshot, command.nodeId);
  if (node.kind !== "worker" || node.status !== "handoff-required") {
    throw new TeamRunContractError(
      "invalid-transition",
      "Only a handoff-required Worker node can complete",
    );
  }
  const artifacts = command.artifacts.map(parseArtifactReference);
  if (
    artifacts.length === 0 ||
    !artifacts.some(({ kind }) => kind === node.expectedArtifactKind) ||
    artifacts.some(({ taskId: ownerTaskId }) => ownerTaskId !== node.taskId) ||
    new Set(artifacts.map(artifactReferenceKey)).size !== artifacts.length
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Team handoff lacks its expected orchestration-owned Artifact",
    );
  }
  const completedNode = Object.freeze({
    ...node,
    status: "completed" as const,
    blockedReason: null,
    blockedExplanation: null,
    summary: requireText(command.summary, "Team handoff summary", 4_096),
    artifacts: Object.freeze(artifacts),
  });
  const nodes = openSatisfiedDependencies(
    snapshot.nodes.map((candidate) =>
      candidate.nodeId === completedNode.nodeId ? completedNode : candidate,
    ),
  );
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: occurredAt,
  });
}

function cancelRun(snapshot: TeamRunSnapshot, command: Record<string, unknown>): TeamRunSnapshot {
  if (!hasExactKeys(command, ["type", "reason", "occurredAt"])) {
    throw new TeamRunContractError("invalid-transition", "Team run cancellation is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const reason = requireText(command.reason, "Team run cancellation reason", 2_048);
  const nodes = snapshot.nodes.map((node): TeamRunNode => {
    if (node.status === "completed") return node;
    if (node.kind === "human-feedback") {
      return Object.freeze({
        ...node,
        status: "cancelled",
        blockedReason: null,
        blockedExplanation: null,
      });
    }
    return Object.freeze({
      ...node,
      status: "cancelled",
      blockedReason: null,
      blockedExplanation: null,
      attempts: Object.freeze(
        node.attempts.map((attempt) =>
          ["running", "blocked", "paused"].includes(attempt.status)
            ? Object.freeze({ ...attempt, status: "cancelled" as const, updatedAt: occurredAt })
            : attempt,
        ),
      ),
    });
  });
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: "cancelled",
    nodes,
    result: null,
    statusExplanation: reason,
    updatedAt: occurredAt,
  });
}

function completeAggregation(
  snapshot: TeamRunSnapshot,
  command: Record<string, unknown>,
): TeamRunSnapshot {
  if (!hasExactKeys(command, ["type", "result", "occurredAt"])) {
    throw new TeamRunContractError("invalid-transition", "Team result aggregation is invalid");
  }
  const occurredAt = commandTime(command, snapshot);
  const result = parseTeamRunResult(command.result);
  const nodeArtifacts = snapshot.nodes.flatMap(({ artifacts }) => artifacts);
  const expectedKeys = nodeArtifacts.map(artifactReferenceKey);
  const resultKeys = result?.artifacts.map(artifactReferenceKey) ?? [];
  if (
    snapshot.status !== "blocked" ||
    snapshot.result !== null ||
    snapshot.nodes.some(({ status }) => status !== "completed") ||
    result === null ||
    resultKeys.length !== expectedKeys.length ||
    resultKeys.some((key) => !expectedKeys.includes(key))
  ) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Team aggregation must reference every completed Worker Artifact exactly once",
    );
  }
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: "completed",
    result,
    statusExplanation: null,
    updatedAt: occurredAt,
  });
}

export function recoverTeamRunSnapshot(
  snapshotValue: TeamRunSnapshot,
  recoveredAtValue: Instant,
): TeamRunSnapshot {
  const snapshot = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
  if (["completed", "failed", "cancelled"].includes(snapshot.status)) return snapshot;
  const recoveredAt = instant(recoveredAtValue);
  if (compareInstants(recoveredAt, snapshot.updatedAt) < 0) {
    throw new TeamRunContractError(
      "invalid-transition",
      "Team recovery time cannot move backwards",
    );
  }
  let interrupted = false;
  const nodes = snapshot.nodes.map((node): TeamRunNode => {
    if (node.kind !== "worker") return node;
    const attempt = node.attempts.at(-1);
    if (attempt === undefined || !["running", "blocked", "paused"].includes(attempt.status)) {
      return node;
    }
    interrupted = true;
    const interruptedAttempt = Object.freeze({
      ...attempt,
      status: "interrupted" as const,
      updatedAt: recoveredAt,
      incidentCode: "interrupted",
    });
    return Object.freeze({
      ...node,
      status: "failed",
      blockedReason: "interrupted",
      blockedExplanation: "The Worker attempt was interrupted during deterministic recovery.",
      attempts: replaceAttempt(node, interruptedAttempt),
    });
  });
  if (!interrupted) return snapshot;
  return normalizeTeamRunSnapshot({
    ...snapshot,
    revision: snapshot.revision + 1,
    status: deriveRunStatus(nodes),
    nodes,
    updatedAt: recoveredAt,
  });
}

export function transitionTeamRun(
  snapshotValue: TeamRunSnapshot,
  command: unknown,
): TeamRunSnapshot {
  const snapshot = normalizeTeamRunSnapshot(JSON.parse(JSON.stringify(snapshotValue)));
  if (!isRecord(command) || typeof command.type !== "string") {
    throw new TeamRunContractError("invalid-transition", "Team run command is invalid");
  }
  if (["completed", "failed", "cancelled"].includes(snapshot.status)) {
    throw new TeamRunContractError("invalid-transition", "A terminal Team run cannot transition");
  }
  switch (command.type) {
    case "start-run":
      return startRun(snapshot, command);
    case "start-node":
      return startNode(snapshot, command);
    case "complete-node":
      return completeNode(snapshot, command);
    case "block-node":
      return blockNode(snapshot, command);
    case "request-node-approval-decision":
      return requestNodeApprovalDecision(snapshot, command);
    case "resolve-node-approval":
      return resolveNodeApproval(snapshot, command);
    case "resolve-human-feedback":
      return resolveHumanFeedback(snapshot, command);
    case "pause-node":
      return pauseNode(snapshot, command);
    case "resume-node":
      return resumeNode(snapshot, command);
    case "fail-node":
      return failNode(snapshot, command);
    case "retry-node":
      return retryNode(snapshot, command);
    case "replace-node":
      return replaceNode(snapshot, command);
    case "request-handoff":
      return requestHandoff(snapshot, command);
    case "cancel-node":
      return cancelNode(snapshot, command);
    case "complete-handoff":
      return completeHandoff(snapshot, command);
    case "cancel-run":
      return cancelRun(snapshot, command);
    case "complete-aggregation":
      return completeAggregation(snapshot, command);
    default:
      throw new TeamRunContractError("invalid-transition", "Team run command is unsupported");
  }
}
