import {
  compareInstants,
  correlationId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
  type Instant,
  type SessionId,
  type TaskId,
  type ToolRequestId,
  type WorkerId,
  type WorkspaceId,
} from "./domain";
import {
  toolInputReference,
  toolOutputReference,
  type ToolInputReference,
  type ToolOutputReference,
} from "./privilegedServices";

declare const workloadValueBrand: unique symbol;

type BrandedWorkloadString<Brand extends string> = string & {
  readonly [workloadValueBrand]: Brand;
};

export type WorkspaceGrantId = BrandedWorkloadString<"WorkspaceGrantId">;
export type ContentReference = ToolInputReference | ToolOutputReference;

export const WORKLOAD_PERSISTENCE_CONTRACT_VERSION = 1 as const;
export const MAX_WORKLOAD_CONTENT_BYTES = 1024 * 1024;
export const OFFICE_DOCUMENT_PREVIEW_MEDIA_TYPE =
  "application/vnd.actestra.office-document-preview+json" as const;
export const WORKSPACE_GRANT_STATES = ["active", "revoked"] as const;
export const CONTENT_REFERENCE_KINDS = ["tool-input", "tool-output"] as const;
export const WORKLOAD_CONTENT_CLASSIFICATIONS = ["workspace-content", "task-content"] as const;
export const WORKLOAD_CONTENT_MEDIA_TYPES = [
  "text/plain; charset=utf-8",
  "text/markdown; charset=utf-8",
  OFFICE_DOCUMENT_PREVIEW_MEDIA_TYPE,
] as const;

export type WorkspaceGrantState = (typeof WORKSPACE_GRANT_STATES)[number];
export type ContentReferenceKind = (typeof CONTENT_REFERENCE_KINDS)[number];
export type WorkloadContentClassification = (typeof WORKLOAD_CONTENT_CLASSIFICATIONS)[number];
export type WorkloadContentMediaType = (typeof WORKLOAD_CONTENT_MEDIA_TYPES)[number];
export type WorkloadContentErrorCode = "invalid-contract" | "invalid-content" | "content-too-large";

export class WorkloadContentError extends Error {
  constructor(
    readonly code: WorkloadContentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkloadContentError";
  }
}

export interface WorkspaceGrant {
  readonly contractVersion: typeof WORKLOAD_PERSISTENCE_CONTRACT_VERSION;
  readonly grantId: WorkspaceGrantId;
  readonly workspaceId: WorkspaceId;
  readonly rootPath: string;
  readonly displayName: string;
  readonly state: WorkspaceGrantState;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface PersistWorkspaceGrantResult {
  readonly status: "stored" | "updated" | "duplicate";
  readonly grant: WorkspaceGrant;
}

export interface ContentReferenceOwner {
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly requestId?: ToolRequestId;
  readonly grantId?: WorkspaceGrantId;
}

export interface StoreContentReferenceInput {
  readonly contractVersion: typeof WORKLOAD_PERSISTENCE_CONTRACT_VERSION;
  readonly reference: ContentReference;
  readonly kind: ContentReferenceKind;
  readonly owner: ContentReferenceOwner;
  readonly classification: WorkloadContentClassification;
  readonly mediaType: WorkloadContentMediaType;
  readonly content: string;
  readonly createdAt: Instant;
  readonly expiresAt?: Instant;
}

export interface ContentReferenceMetadata {
  readonly contractVersion: typeof WORKLOAD_PERSISTENCE_CONTRACT_VERSION;
  readonly reference: ContentReference;
  readonly kind: ContentReferenceKind;
  readonly owner: ContentReferenceOwner;
  readonly classification: WorkloadContentClassification;
  readonly mediaType: WorkloadContentMediaType;
  readonly byteLength: number;
  readonly sha256: string;
  readonly createdAt: Instant;
  readonly expiresAt?: Instant;
  readonly consumedAt?: Instant;
}

export interface PersistContentReferenceResult {
  readonly status: "stored" | "duplicate";
  readonly metadata: ContentReferenceMetadata;
}

export interface ResolveContentReferenceInput {
  readonly contractVersion: typeof WORKLOAD_PERSISTENCE_CONTRACT_VERSION;
  readonly reference: ContentReference;
  readonly kind: ContentReferenceKind;
  readonly owner: ContentReferenceOwner;
  readonly resolvedAt: Instant;
  readonly consume: boolean;
}

export interface ResolvedContentReference {
  readonly metadata: ContentReferenceMetadata;
  readonly content: string;
}

export interface WorkloadPersistencePort {
  persistWorkspaceGrant(grant: WorkspaceGrant): Promise<PersistWorkspaceGrantResult>;
  getActiveWorkspaceGrant(workspaceId: WorkspaceId): Promise<WorkspaceGrant | null>;
  storeContentReference(input: StoreContentReferenceInput): Promise<PersistContentReferenceResult>;
  resolveContentReference(input: ResolveContentReferenceInput): Promise<ResolvedContentReference>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new WorkloadContentError("invalid-contract", `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new WorkloadContentError(
      "invalid-contract",
      `${label} contains unsupported field ${unexpected}`,
    );
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function assertBoundedString(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    throw new WorkloadContentError(
      "invalid-contract",
      `${label} must be non-empty, unpadded, control-free, and at most ${maximumLength} characters`,
    );
  }
}

function assertIdentifier(
  value: unknown,
  factory: (candidate: string) => unknown,
  label: string,
): void {
  if (typeof value !== "string") {
    throw new WorkloadContentError("invalid-contract", `${label} must be an identifier`);
  }
  try {
    factory(value);
  } catch {
    throw new WorkloadContentError("invalid-contract", `${label} is invalid`);
  }
}

function assertInstant(value: unknown, label: string): asserts value is Instant {
  assertIdentifier(value, instant, label);
}

function assertContractVersion(value: unknown, label: string): void {
  if (value !== WORKLOAD_PERSISTENCE_CONTRACT_VERSION) {
    throw new WorkloadContentError(
      "invalid-contract",
      `${label} requires contract version ${WORKLOAD_PERSISTENCE_CONTRACT_VERSION}`,
    );
  }
}

function assertReference(
  value: unknown,
  kind: ContentReferenceKind,
  label: string,
): asserts value is ContentReference {
  assertIdentifier(value, kind === "tool-input" ? toolInputReference : toolOutputReference, label);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function workloadContentByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function workspaceGrantId(value: string): WorkspaceGrantId {
  try {
    return correlationId(value) as unknown as WorkspaceGrantId;
  } catch {
    throw new WorkloadContentError("invalid-contract", "WorkspaceGrantId is invalid");
  }
}

export function assertWorkspaceGrant(value: unknown): asserts value is WorkspaceGrant {
  assertRecord(value, "Workspace grant");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "grantId",
      "workspaceId",
      "rootPath",
      "displayName",
      "state",
      "createdAt",
      "updatedAt",
    ],
    "Workspace grant",
  );
  assertContractVersion(value.contractVersion, "Workspace grant");
  assertIdentifier(value.grantId, workspaceGrantId, "Workspace grant.grantId");
  assertIdentifier(value.workspaceId, workspaceId, "Workspace grant.workspaceId");
  assertBoundedString(value.rootPath, "Workspace grant.rootPath", 4096);
  assertBoundedString(value.displayName, "Workspace grant.displayName", 128);
  if (
    typeof value.state !== "string" ||
    !WORKSPACE_GRANT_STATES.includes(value.state as WorkspaceGrantState)
  ) {
    throw new WorkloadContentError("invalid-contract", "Workspace grant.state is unsupported");
  }
  assertInstant(value.createdAt, "Workspace grant.createdAt");
  assertInstant(value.updatedAt, "Workspace grant.updatedAt");
  if (compareInstants(value.updatedAt, value.createdAt) < 0) {
    throw new WorkloadContentError(
      "invalid-contract",
      "Workspace grant.updatedAt cannot predate createdAt",
    );
  }
}

export function assertContentReferenceOwner(
  value: unknown,
): asserts value is ContentReferenceOwner {
  assertRecord(value, "Content reference owner");
  assertExactKeys(
    value,
    ["workspaceId", "taskId", "sessionId", "workerId", "requestId", "grantId"],
    "Content reference owner",
  );
  assertIdentifier(value.workspaceId, workspaceId, "Content reference owner.workspaceId");
  assertIdentifier(value.taskId, taskId, "Content reference owner.taskId");
  assertIdentifier(value.sessionId, sessionId, "Content reference owner.sessionId");
  assertIdentifier(value.workerId, workerId, "Content reference owner.workerId");
  if (value.requestId !== undefined) {
    assertIdentifier(value.requestId, toolRequestId, "Content reference owner.requestId");
  }
  if (value.grantId !== undefined) {
    assertIdentifier(value.grantId, workspaceGrantId, "Content reference owner.grantId");
  }
}

function assertContentFields(
  value: Record<string, unknown>,
  label: string,
): asserts value is Record<string, unknown> & {
  contractVersion: typeof WORKLOAD_PERSISTENCE_CONTRACT_VERSION;
  reference: ContentReference;
  kind: ContentReferenceKind;
  owner: ContentReferenceOwner;
  classification: WorkloadContentClassification;
  mediaType: WorkloadContentMediaType;
  createdAt: Instant;
  expiresAt?: Instant;
} {
  assertContractVersion(value.contractVersion, label);
  if (
    typeof value.kind !== "string" ||
    !CONTENT_REFERENCE_KINDS.includes(value.kind as ContentReferenceKind)
  ) {
    throw new WorkloadContentError("invalid-contract", `${label}.kind is unsupported`);
  }
  assertReference(value.reference, value.kind as ContentReferenceKind, `${label}.reference`);
  assertContentReferenceOwner(value.owner);
  if (
    typeof value.classification !== "string" ||
    !WORKLOAD_CONTENT_CLASSIFICATIONS.includes(
      value.classification as WorkloadContentClassification,
    )
  ) {
    throw new WorkloadContentError("invalid-contract", `${label}.classification is unsupported`);
  }
  if (
    typeof value.mediaType !== "string" ||
    !WORKLOAD_CONTENT_MEDIA_TYPES.includes(value.mediaType as WorkloadContentMediaType)
  ) {
    throw new WorkloadContentError("invalid-contract", `${label}.mediaType is unsupported`);
  }
  assertInstant(value.createdAt, `${label}.createdAt`);
  if (value.expiresAt !== undefined) {
    assertInstant(value.expiresAt, `${label}.expiresAt`);
    if (compareInstants(value.expiresAt, value.createdAt) <= 0) {
      throw new WorkloadContentError(
        "invalid-contract",
        `${label}.expiresAt must follow createdAt`,
      );
    }
  }
}

export function assertStoreContentReferenceInput(
  value: unknown,
): asserts value is StoreContentReferenceInput {
  assertRecord(value, "Content reference input");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "reference",
      "kind",
      "owner",
      "classification",
      "mediaType",
      "content",
      "createdAt",
      "expiresAt",
    ],
    "Content reference input",
  );
  assertContentFields(value, "Content reference input");
  if (typeof value.content !== "string" || hasUnpairedSurrogate(value.content)) {
    throw new WorkloadContentError(
      "invalid-content",
      "Content reference input.content must be round-trippable UTF-8 text",
    );
  }
  if (workloadContentByteLength(value.content) > MAX_WORKLOAD_CONTENT_BYTES) {
    throw new WorkloadContentError(
      "content-too-large",
      `Content reference input.content exceeds ${MAX_WORKLOAD_CONTENT_BYTES} bytes`,
    );
  }
}

export function assertResolveContentReferenceInput(
  value: unknown,
): asserts value is ResolveContentReferenceInput {
  assertRecord(value, "Content reference resolution");
  assertExactKeys(
    value,
    ["contractVersion", "reference", "kind", "owner", "resolvedAt", "consume"],
    "Content reference resolution",
  );
  assertContractVersion(value.contractVersion, "Content reference resolution");
  if (
    typeof value.kind !== "string" ||
    !CONTENT_REFERENCE_KINDS.includes(value.kind as ContentReferenceKind)
  ) {
    throw new WorkloadContentError(
      "invalid-contract",
      "Content reference resolution.kind is unsupported",
    );
  }
  assertReference(
    value.reference,
    value.kind as ContentReferenceKind,
    "Content reference resolution.reference",
  );
  assertContentReferenceOwner(value.owner);
  assertInstant(value.resolvedAt, "Content reference resolution.resolvedAt");
  if (typeof value.consume !== "boolean") {
    throw new WorkloadContentError(
      "invalid-contract",
      "Content reference resolution.consume must be boolean",
    );
  }
}

export function assertContentReferenceMetadata(
  value: unknown,
): asserts value is ContentReferenceMetadata {
  assertRecord(value, "Content reference metadata");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "reference",
      "kind",
      "owner",
      "classification",
      "mediaType",
      "byteLength",
      "sha256",
      "createdAt",
      "expiresAt",
      "consumedAt",
    ],
    "Content reference metadata",
  );
  assertContentFields(value, "Content reference metadata");
  if (
    !Number.isSafeInteger(value.byteLength) ||
    (value.byteLength as number) < 0 ||
    (value.byteLength as number) > MAX_WORKLOAD_CONTENT_BYTES
  ) {
    throw new WorkloadContentError(
      "invalid-contract",
      "Content reference metadata.byteLength is invalid",
    );
  }
  if (typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new WorkloadContentError(
      "invalid-contract",
      "Content reference metadata.sha256 is invalid",
    );
  }
  if (value.consumedAt !== undefined) {
    assertInstant(value.consumedAt, "Content reference metadata.consumedAt");
    if (compareInstants(value.consumedAt, value.createdAt) < 0) {
      throw new WorkloadContentError(
        "invalid-contract",
        "Content reference metadata.consumedAt cannot predate createdAt",
      );
    }
    if (value.expiresAt !== undefined && compareInstants(value.consumedAt, value.expiresAt) >= 0) {
      throw new WorkloadContentError(
        "invalid-contract",
        "Content reference metadata cannot be consumed after expiry",
      );
    }
  }
}

export function assertPersistWorkspaceGrantResult(
  value: unknown,
): asserts value is PersistWorkspaceGrantResult {
  assertRecord(value, "Workspace grant persistence result");
  assertExactKeys(value, ["status", "grant"], "Workspace grant persistence result");
  if (value.status !== "stored" && value.status !== "updated" && value.status !== "duplicate") {
    throw new WorkloadContentError(
      "invalid-contract",
      "Workspace grant persistence result.status is unsupported",
    );
  }
  assertWorkspaceGrant(value.grant);
}

export function assertPersistContentReferenceResult(
  value: unknown,
): asserts value is PersistContentReferenceResult {
  assertRecord(value, "Content reference persistence result");
  assertExactKeys(value, ["status", "metadata"], "Content reference persistence result");
  if (value.status !== "stored" && value.status !== "duplicate") {
    throw new WorkloadContentError(
      "invalid-contract",
      "Content reference persistence result.status is unsupported",
    );
  }
  assertContentReferenceMetadata(value.metadata);
}

export function assertResolvedContentReference(
  value: unknown,
): asserts value is ResolvedContentReference {
  assertRecord(value, "Resolved content reference");
  assertExactKeys(value, ["metadata", "content"], "Resolved content reference");
  assertContentReferenceMetadata(value.metadata);
  if (
    typeof value.content !== "string" ||
    hasUnpairedSurrogate(value.content) ||
    workloadContentByteLength(value.content) !== value.metadata.byteLength
  ) {
    throw new WorkloadContentError(
      "invalid-content",
      "Resolved content does not match its UTF-8 metadata",
    );
  }
}
