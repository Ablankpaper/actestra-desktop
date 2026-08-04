import {
  approvalId,
  artifactId,
  compareInstants,
  instant,
  taskId,
  type ArtifactState,
  type TaskState,
} from "../../core";
import { assertAionUiNativeConversationId } from "./generalWorkJourney";

export const AIONUI_CODING_JOURNEY_CONTRACT_VERSION = 1 as const;
export const AIONUI_CODING_JOURNEY_MAX_PROMPT_BYTES = 16 * 1_024;
export const AIONUI_CODING_JOURNEY_MAX_PROJECTIONS = 50;

export const ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL = "actestra:coding-journey:submit" as const;
export const ACTESTRA_CODING_JOURNEY_LIST_CHANNEL = "actestra:coding-journey:list" as const;
export const ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL = "actestra:coding-journey:cancel" as const;
export const ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL =
  "actestra:coding-journey:approval-decision" as const;
export const ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL =
  "actestra:coding-journey:publish-decision" as const;

const SUBMIT_KEYS = ["contractVersion", "nativeConversationId", "submissionId", "prompt"] as const;
const LIST_KEYS = ["contractVersion", "nativeConversationId", "limit"] as const;
const CANCEL_KEYS = ["contractVersion", "nativeConversationId", "taskId", "reason"] as const;
const DECISION_KEYS = [
  "contractVersion",
  "nativeConversationId",
  "taskId",
  "approvalId",
  "decision",
] as const;
const PROJECTION_KEYS = [
  "contractVersion",
  "taskId",
  "status",
  "stage",
  "title",
  "canCancel",
  "createdAt",
  "updatedAt",
  "messages",
  "tools",
  "approval",
  "incidentCode",
  "artifacts",
] as const;
const MESSAGE_KEYS = ["messageId", "text"] as const;
const TOOL_KEYS = ["toolCallId", "title", "kind", "status", "surface", "content"] as const;
const CONTENT_KEYS = ["type", "text", "path", "oldText", "newText", "terminalId"] as const;
const TOOL_APPROVAL_KEYS = [
  "kind",
  "approvalId",
  "toolCallId",
  "title",
  "operationKind",
  "summary",
] as const;
const PUBLISH_APPROVAL_KEYS = [...TOOL_APPROVAL_KEYS, "snapshot"] as const;
const SNAPSHOT_KEYS = ["baseCommit", "patchByteLength", "patchSha256"] as const;
const ARTIFACT_KEYS = ["artifactId", "label", "state"] as const;

const TASK_STATES: readonly TaskState[] = [
  "draft",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];
const ARTIFACT_STATES: readonly ArtifactState[] = ["available", "superseded"];
const CANCELLABLE_TASK_STATES: readonly TaskState[] = ["running", "blocked"];
const STAGES = [
  "opening",
  "working",
  "approval-required",
  "review",
  "publish-approval-required",
  "published",
  "cancelled",
  "failed",
] as const;
const TOOL_KINDS = ["read", "edit", "execute"] as const;
const TOOL_STATUSES = ["pending", "in_progress", "completed", "failed"] as const;
const TOOL_SURFACES = ["tool", "terminal", "diff", "test"] as const;
const OPERATION_KINDS = ["read", "edit", "execute"] as const;
const DECISIONS = ["approved", "denied"] as const;
const REJECTION_CODES = [
  "invalid-request",
  "agent-unavailable",
  "workspace-unavailable",
  "task-not-owned",
  "task-conflict",
  "approval-not-pending",
  "persistence-unavailable",
  "execution-failed",
] as const;

export type AionUiCodingJourneyStage = (typeof STAGES)[number];
export type AionUiCodingJourneyToolKind = (typeof TOOL_KINDS)[number];
export type AionUiCodingJourneyToolStatus = (typeof TOOL_STATUSES)[number];
export type AionUiCodingJourneyToolSurface = (typeof TOOL_SURFACES)[number];
export type AionUiCodingJourneyDecision = (typeof DECISIONS)[number];
export type AionUiCodingJourneyRejectionCode = (typeof REJECTION_CODES)[number];

export interface AionUiCodingJourneySubmitRequest {
  readonly contractVersion: typeof AIONUI_CODING_JOURNEY_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly submissionId: string;
  readonly prompt: string;
}

export interface AionUiCodingJourneyListRequest {
  readonly contractVersion: typeof AIONUI_CODING_JOURNEY_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly limit?: number;
}

export interface AionUiCodingJourneyCancelRequest {
  readonly contractVersion: typeof AIONUI_CODING_JOURNEY_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly taskId: ReturnType<typeof taskId>;
  readonly reason?: string;
}

interface AionUiCodingJourneyDecisionRequest {
  readonly contractVersion: typeof AIONUI_CODING_JOURNEY_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly taskId: ReturnType<typeof taskId>;
  readonly approvalId: ReturnType<typeof approvalId>;
  readonly decision: AionUiCodingJourneyDecision;
}

export type AionUiCodingJourneyApprovalDecisionRequest = AionUiCodingJourneyDecisionRequest;
export type AionUiCodingJourneyPublishDecisionRequest = AionUiCodingJourneyDecisionRequest;

export interface AionUiCodingJourneyMessageProjection {
  readonly messageId: string;
  readonly text: string;
}

export type AionUiCodingJourneyToolContent =
  | Readonly<{ type: "content"; text: string }>
  | Readonly<{
      type: "diff";
      path: string;
      oldText?: string | null;
      newText: string;
    }>
  | Readonly<{ type: "terminal"; terminalId: string }>;

export interface AionUiCodingJourneyToolProjection {
  readonly toolCallId: string;
  readonly title: string;
  readonly kind: AionUiCodingJourneyToolKind;
  readonly status: AionUiCodingJourneyToolStatus;
  readonly surface: AionUiCodingJourneyToolSurface;
  readonly content: readonly AionUiCodingJourneyToolContent[];
}

interface AionUiCodingJourneyApprovalProjectionBase {
  readonly approvalId: ReturnType<typeof approvalId>;
  readonly toolCallId: string;
  readonly title: string;
  readonly operationKind: (typeof OPERATION_KINDS)[number];
  readonly summary: string;
}

export interface AionUiCodingJourneyToolApprovalProjection extends AionUiCodingJourneyApprovalProjectionBase {
  readonly kind: "tool";
}

export interface AionUiCodingJourneyPublishSnapshot {
  readonly baseCommit: string;
  readonly patchByteLength: number;
  readonly patchSha256: string;
}

export interface AionUiCodingJourneyPublishApprovalProjection extends AionUiCodingJourneyApprovalProjectionBase {
  readonly kind: "publish";
  readonly snapshot: AionUiCodingJourneyPublishSnapshot;
}

export type AionUiCodingJourneyApprovalProjection =
  | AionUiCodingJourneyToolApprovalProjection
  | AionUiCodingJourneyPublishApprovalProjection;

export interface AionUiCodingJourneyArtifactProjection {
  readonly artifactId: ReturnType<typeof artifactId>;
  readonly label: string;
  readonly state: ArtifactState;
}

export interface AionUiCodingJourneyProjection {
  readonly contractVersion: typeof AIONUI_CODING_JOURNEY_CONTRACT_VERSION;
  readonly taskId: ReturnType<typeof taskId>;
  readonly status: TaskState;
  readonly stage: AionUiCodingJourneyStage;
  readonly title: string;
  readonly canCancel: boolean;
  readonly createdAt: ReturnType<typeof instant>;
  readonly updatedAt: ReturnType<typeof instant>;
  readonly messages: readonly AionUiCodingJourneyMessageProjection[];
  readonly tools: readonly AionUiCodingJourneyToolProjection[];
  readonly approval?: AionUiCodingJourneyApprovalProjection;
  readonly incidentCode?: string;
  readonly artifacts: readonly AionUiCodingJourneyArtifactProjection[];
}

export type AionUiCodingJourneyBridgeResult =
  | Readonly<{ status: "ok"; projection: AionUiCodingJourneyProjection }>
  | Readonly<{ status: "ok"; projections: readonly AionUiCodingJourneyProjection[] }>
  | Readonly<{ status: "rejected"; code: AionUiCodingJourneyRejectionCode }>;

export interface AionUiCodingJourneyBridgeApi {
  submit(request: AionUiCodingJourneySubmitRequest): Promise<AionUiCodingJourneyBridgeResult>;
  list(request: AionUiCodingJourneyListRequest): Promise<AionUiCodingJourneyBridgeResult>;
  cancel(request: AionUiCodingJourneyCancelRequest): Promise<AionUiCodingJourneyBridgeResult>;
  decideApproval(
    request: AionUiCodingJourneyApprovalDecisionRequest,
  ): Promise<AionUiCodingJourneyBridgeResult>;
  decidePublish(
    request: AionUiCodingJourneyPublishDecisionRequest,
  ): Promise<AionUiCodingJourneyBridgeResult>;
}

declare global {
  interface Window {
    actestraCodingJourney?: AionUiCodingJourneyBridgeApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.every((key) => allowed.includes(key)) &&
    allowed
      .filter(
        (key) =>
          key !== "limit" && key !== "reason" && key !== "approval" && key !== "incidentCode",
      )
      .every((key) => Object.hasOwn(value, key))
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasForbiddenControl(value: string, allowLayout = false): boolean {
  return [...value].some((character) => {
    const point = character.codePointAt(0);
    if (point === undefined) return false;
    if (allowLayout && (point === 9 || point === 10 || point === 13)) return false;
    return point <= 31 || (point >= 127 && point <= 159);
  });
}

function boundedIdentifier(value: unknown, maximum = 256): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.trim() !== value ||
    hasForbiddenControl(value)
  ) {
    throw new Error("AionUI coding-journey identifier is invalid");
  }
}

function boundedText(
  value: unknown,
  maximumBytes: number,
  allowLayout = true,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    byteLength(value) > maximumBytes ||
    hasForbiddenControl(value, allowLayout)
  ) {
    throw new Error("AionUI coding-journey text is invalid");
  }
}

function exactVersionedRequest(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.contractVersion !== AIONUI_CODING_JOURNEY_CONTRACT_VERSION
  ) {
    throw new Error("AionUI coding-journey request is invalid");
  }
  assertAionUiNativeConversationId(value.nativeConversationId);
}

export function assertAionUiCodingJourneySubmitRequest(
  value: unknown,
): asserts value is AionUiCodingJourneySubmitRequest {
  exactVersionedRequest(value, SUBMIT_KEYS);
  boundedIdentifier(value.submissionId, 128);
  boundedText(value.prompt, AIONUI_CODING_JOURNEY_MAX_PROMPT_BYTES);
}

export function assertAionUiCodingJourneyListRequest(
  value: unknown,
): asserts value is AionUiCodingJourneyListRequest {
  exactVersionedRequest(value, LIST_KEYS);
  if (
    value.limit !== undefined &&
    (!Number.isSafeInteger(value.limit) ||
      (value.limit as number) < 1 ||
      (value.limit as number) > AIONUI_CODING_JOURNEY_MAX_PROJECTIONS)
  ) {
    throw new Error("AionUI coding-journey list limit is invalid");
  }
}

export function assertAionUiCodingJourneyCancelRequest(
  value: unknown,
): asserts value is AionUiCodingJourneyCancelRequest {
  exactVersionedRequest(value, CANCEL_KEYS);
  taskId(value.taskId as string);
  if (value.reason !== undefined) boundedText(value.reason, 512, false);
}

function assertDecisionRequest(
  value: unknown,
): asserts value is AionUiCodingJourneyDecisionRequest {
  exactVersionedRequest(value, DECISION_KEYS);
  taskId(value.taskId as string);
  approvalId(value.approvalId as string);
  if (!DECISIONS.includes(value.decision as AionUiCodingJourneyDecision)) {
    throw new Error("AionUI coding-journey decision is invalid");
  }
}

export function assertAionUiCodingJourneyApprovalDecisionRequest(
  value: unknown,
): asserts value is AionUiCodingJourneyApprovalDecisionRequest {
  assertDecisionRequest(value);
}

export function assertAionUiCodingJourneyPublishDecisionRequest(
  value: unknown,
): asserts value is AionUiCodingJourneyPublishDecisionRequest {
  assertDecisionRequest(value);
}

function assertRelativePath(value: unknown): asserts value is string {
  boundedText(value, 8 * 1_024, false);
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.split(/[\\/]/u).some((part) => part === "..")
  ) {
    throw new Error("AionUI coding-journey diff path is invalid");
  }
}

function assertToolContent(value: unknown): asserts value is AionUiCodingJourneyToolContent {
  if (!isRecord(value) || !hasOnlyKeys(value, CONTENT_KEYS) || !Object.hasOwn(value, "type")) {
    throw new Error("AionUI coding-journey tool content is invalid");
  }
  if (value.type === "content") {
    if (Object.keys(value).some((key) => !["type", "text"].includes(key))) {
      throw new Error("AionUI coding-journey text content is invalid");
    }
    boundedText(value.text, 1024 * 1024);
    return;
  }
  if (value.type === "terminal") {
    if (Object.keys(value).some((key) => !["type", "terminalId"].includes(key))) {
      throw new Error("AionUI coding-journey terminal content is invalid");
    }
    boundedIdentifier(value.terminalId);
    return;
  }
  if (value.type === "diff") {
    if (Object.keys(value).some((key) => !["type", "path", "oldText", "newText"].includes(key))) {
      throw new Error("AionUI coding-journey diff content is invalid");
    }
    assertRelativePath(value.path);
    if (value.oldText !== undefined && value.oldText !== null) {
      if (typeof value.oldText !== "string" || byteLength(value.oldText) > 1024 * 1024) {
        throw new Error("AionUI coding-journey old diff text is invalid");
      }
    }
    if (typeof value.newText !== "string" || byteLength(value.newText) > 1024 * 1024) {
      throw new Error("AionUI coding-journey new diff text is invalid");
    }
    return;
  }
  throw new Error("AionUI coding-journey tool content type is invalid");
}

function assertTool(value: unknown): asserts value is AionUiCodingJourneyToolProjection {
  if (!isRecord(value) || !hasExactKeys(value, TOOL_KEYS) || !Array.isArray(value.content)) {
    throw new Error("AionUI coding-journey tool projection is invalid");
  }
  boundedIdentifier(value.toolCallId);
  boundedText(value.title, 512);
  if (
    !TOOL_KINDS.includes(value.kind as AionUiCodingJourneyToolKind) ||
    !TOOL_STATUSES.includes(value.status as AionUiCodingJourneyToolStatus) ||
    !TOOL_SURFACES.includes(value.surface as AionUiCodingJourneyToolSurface) ||
    value.content.length > 64
  ) {
    throw new Error("AionUI coding-journey tool projection metadata is invalid");
  }
  value.content.forEach(assertToolContent);
}

function assertApproval(value: unknown): asserts value is AionUiCodingJourneyApprovalProjection {
  if (!isRecord(value)) {
    throw new Error("AionUI coding-journey approval projection is invalid");
  }
  const expected = value.kind === "publish" ? PUBLISH_APPROVAL_KEYS : TOOL_APPROVAL_KEYS;
  if (!hasExactKeys(value, expected)) {
    throw new Error("AionUI coding-journey approval projection is invalid");
  }
  approvalId(value.approvalId as string);
  boundedIdentifier(value.toolCallId);
  boundedText(value.title, 512);
  boundedText(value.summary, 4 * 1_024);
  if (
    (value.kind !== "tool" && value.kind !== "publish") ||
    !OPERATION_KINDS.includes(value.operationKind as (typeof OPERATION_KINDS)[number])
  ) {
    throw new Error("AionUI coding-journey approval metadata is invalid");
  }
  if (value.kind === "publish") {
    const snapshot = value.snapshot;
    if (
      !isRecord(snapshot) ||
      !hasExactKeys(snapshot, SNAPSHOT_KEYS) ||
      typeof snapshot.baseCommit !== "string" ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(snapshot.baseCommit) ||
      !Number.isSafeInteger(snapshot.patchByteLength) ||
      (snapshot.patchByteLength as number) < 1 ||
      (snapshot.patchByteLength as number) > 1024 * 1024 ||
      typeof snapshot.patchSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(snapshot.patchSha256)
    ) {
      throw new Error("AionUI coding-journey publish snapshot is invalid");
    }
  }
}

function stageMatches(
  status: TaskState,
  stage: AionUiCodingJourneyStage,
  approval: unknown,
): boolean {
  if (stage === "published") return status === "completed" && approval === undefined;
  if (stage === "cancelled") return status === "cancelled" && approval === undefined;
  if (stage === "failed") return status === "failed" && approval === undefined;
  if (stage === "review") return status === "blocked" && approval === undefined;
  if (stage === "publish-approval-required") {
    return status === "blocked" && isRecord(approval) && approval.kind === "publish";
  }
  if (stage === "approval-required") {
    return (
      (status === "running" || status === "blocked") &&
      isRecord(approval) &&
      approval.kind === "tool"
    );
  }
  return status === "running" && approval === undefined;
}

export function assertAionUiCodingJourneyProjection(
  value: unknown,
): asserts value is AionUiCodingJourneyProjection {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, PROJECTION_KEYS) ||
    value.contractVersion !== AIONUI_CODING_JOURNEY_CONTRACT_VERSION ||
    typeof value.status !== "string" ||
    !TASK_STATES.includes(value.status as TaskState) ||
    typeof value.stage !== "string" ||
    !STAGES.includes(value.stage as AionUiCodingJourneyStage) ||
    typeof value.canCancel !== "boolean" ||
    !Array.isArray(value.messages) ||
    value.messages.length > 100 ||
    !Array.isArray(value.tools) ||
    value.tools.length > 100 ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 20
  ) {
    throw new Error("AionUI coding-journey projection is invalid");
  }
  taskId(value.taskId as string);
  boundedText(value.title, 512);
  const createdAt = instant(value.createdAt as string);
  const updatedAt = instant(value.updatedAt as string);
  if (
    compareInstants(updatedAt, createdAt) < 0 ||
    value.canCancel !== CANCELLABLE_TASK_STATES.includes(value.status as TaskState) ||
    !stageMatches(
      value.status as TaskState,
      value.stage as AionUiCodingJourneyStage,
      value.approval,
    )
  ) {
    throw new Error("AionUI coding-journey lifecycle projection is inconsistent");
  }
  for (const message of value.messages) {
    if (!isRecord(message) || !hasExactKeys(message, MESSAGE_KEYS)) {
      throw new Error("AionUI coding-journey message projection is invalid");
    }
    boundedIdentifier(message.messageId);
    boundedText(message.text, 1024 * 1024);
  }
  value.tools.forEach(assertTool);
  if (value.approval !== undefined) assertApproval(value.approval);
  if (
    value.incidentCode !== undefined &&
    (typeof value.incidentCode !== "string" ||
      !/^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u.test(value.incidentCode))
  ) {
    throw new Error("AionUI coding-journey incident code is invalid");
  }
  for (const artifact of value.artifacts) {
    if (
      !isRecord(artifact) ||
      !hasExactKeys(artifact, ARTIFACT_KEYS) ||
      typeof artifact.state !== "string" ||
      !ARTIFACT_STATES.includes(artifact.state as ArtifactState)
    ) {
      throw new Error("AionUI coding-journey Artifact projection is invalid");
    }
    artifactId(artifact.artifactId as string);
    boundedText(artifact.label, 512);
  }
}

export function assertAionUiCodingJourneyBridgeResult(
  value: unknown,
): asserts value is AionUiCodingJourneyBridgeResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("AionUI coding-journey bridge result is invalid");
  }
  if (value.status === "rejected") {
    if (
      !hasExactKeys(value, ["status", "code"]) ||
      !REJECTION_CODES.includes(value.code as AionUiCodingJourneyRejectionCode)
    ) {
      throw new Error("AionUI coding-journey rejection is invalid");
    }
    return;
  }
  if (value.status !== "ok") {
    throw new Error("AionUI coding-journey bridge result status is invalid");
  }
  if (hasExactKeys(value, ["status", "projection"])) {
    assertAionUiCodingJourneyProjection(value.projection);
    return;
  }
  if (
    hasExactKeys(value, ["status", "projections"]) &&
    Array.isArray(value.projections) &&
    value.projections.length <= AIONUI_CODING_JOURNEY_MAX_PROJECTIONS
  ) {
    value.projections.forEach(assertAionUiCodingJourneyProjection);
    return;
  }
  throw new Error("AionUI coding-journey success result is invalid");
}
