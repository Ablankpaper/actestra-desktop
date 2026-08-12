import {
  CoreContractError,
  approvalId,
  artifactId,
  compareInstants,
  instant,
  sessionId,
  taskId,
  workspaceId,
  type ApprovalId,
  type ArtifactDeliveryState,
  type ArtifactId,
  type Instant,
  type SessionId,
  type TaskId,
  type WorkspaceId,
} from "./domain";

export const ARTIFACT_DELIVERY_CONTRACT_VERSION = 2 as const;

/**
 * Applying a patch Artifact to the original workspace is a distinct protected effect from
 * publishing it: `publish.execute` only saves an Artifact, while this writes the user's repository.
 */
export const ARTIFACT_DELIVERY_TOOL_ID = "actestra.coding.artifact-apply" as const;

export const ARTIFACT_DELIVERY_STATES = [
  "pending",
  "applying",
  "applied",
  "conflict",
  "failed",
  "cancelled",
] as const satisfies readonly ArtifactDeliveryState[];

/** Closed set of fail-closed reasons; the original workspace is never partially written. */
export const ARTIFACT_DELIVERY_FAILURE_CODES = [
  "artifact-ownership-mismatch",
  "patch-unavailable",
  "patch-digest-mismatch",
  "workspace-grant-invalid",
  "workspace-dirty",
  "head-drift",
  "patch-conflict",
  "apply-failed",
  "lock-unavailable",
] as const;

export type ArtifactDeliveryFailureCode = (typeof ARTIFACT_DELIVERY_FAILURE_CODES)[number];

const ARTIFACT_DELIVERY_MAX_MESSAGE_BYTES = 1024;
const ARTIFACT_DELIVERY_MAX_REFERENCE_BYTES = 512;
const ARTIFACT_DELIVERY_MAX_GRANT_BYTES = 256;

const ARTIFACT_DELIVERY_RECORD_KEYS = [
  "contractVersion",
  "artifactId",
  "workspaceId",
  "destinationWorkspaceId",
  "taskId",
  "sessionId",
  "state",
  "patchOwnerGrantId",
  "patchOwnerWorkerId",
  "patchRequestId",
  "destinationGrantId",
  "patchReference",
  "patchSha256",
  "patchByteLength",
  "baseCommit",
  "changedFileCount",
  "approvalId",
  "verifiedHead",
  "failureCode",
  "failureMessage",
  "createdAt",
  "updatedAt",
] as const;

/**
 * Durable delivery authority for one patch Artifact. It carries a persisted content reference
 * rather than patch text or a worktree path, because the isolated coding worktree is usually
 * already removed by the time the user approves applying the patch.
 */
export interface ArtifactDeliveryRecord {
  readonly contractVersion: typeof ARTIFACT_DELIVERY_CONTRACT_VERSION;
  readonly artifactId: ArtifactId;
  readonly workspaceId: WorkspaceId;
  /** Original user workspace that receives the patch; distinct from the isolated Artifact workspace. */
  readonly destinationWorkspaceId: WorkspaceId | null;
  readonly taskId: TaskId;
  readonly sessionId: SessionId | null;
  readonly state: ArtifactDeliveryState;
  /** Authority that owned the isolated worktree the patch was produced in and is read back from. */
  readonly patchOwnerGrantId: string;
  /**
   * Worker that owned the publishing session. The persisted patch is readable only by its exact
   * stored owner, and persistence resolves that owner against the session's own worker, so this
   * cannot be a constant. `null` means the identity was never recorded and the patch is unreadable.
   */
  readonly patchOwnerWorkerId: string | null;
  /**
   * Tool request the patch was stored under. Content ownership is compared field by field, so a read
   * that names a different request is refused even when every other authority matches.
   */
  readonly patchRequestId: string | null;
  /**
   * Authority for the original workspace this patch is written into. It is a different grant from
   * {@link patchOwnerGrantId} and is only known once the user chooses a destination to apply into.
   */
  readonly destinationGrantId: string | null;
  readonly patchReference: string;
  readonly patchSha256: string;
  readonly patchByteLength: number;
  readonly baseCommit: string;
  readonly changedFileCount: number;
  readonly approvalId: ApprovalId | null;
  /**
   * The destination HEAD verified immediately before and after the patch was written. `git apply`
   * writes the working tree without committing, so this never implies Actestra created a commit.
   */
  readonly verifiedHead: string | null;
  readonly failureCode: ArtifactDeliveryFailureCode | null;
  readonly failureMessage: string | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface PersistArtifactDeliveryResult {
  readonly status: "stored" | "duplicate";
  readonly delivery: ArtifactDeliveryRecord;
}

export interface ArtifactDeliveryPersistencePort {
  persistArtifactDelivery(delivery: ArtifactDeliveryRecord): Promise<PersistArtifactDeliveryResult>;
  getArtifactDelivery(artifactId: ArtifactId): Promise<ArtifactDeliveryRecord | null>;
  listArtifactDeliveriesForTask(
    taskId: TaskId,
    limit: number,
  ): Promise<readonly ArtifactDeliveryRecord[]>;
}

export interface ArtifactWorkspaceOperationsPort {
  getArtifactPatchPreview(artifactId: ArtifactId): Promise<string>;
  getArtifactPatchContent(artifactId: ArtifactId): Promise<string>;
  /**
   * Writes a reviewed patch into the destination working tree. The Git directory is never a
   * parameter: it is resolved from `workspaceRoot` by Git itself, so no caller can name one.
   */
  applyArtifactToWorkspace(
    artifactId: ArtifactId,
    workspaceRoot: string,
  ): Promise<{ readonly verifiedHead: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
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
    throw new CoreContractError(
      "invalid-record",
      `${field} must be normalized, unpadded, control-free bounded text`,
    );
  }
  return value;
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new CoreContractError("invalid-record", `${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

// Both SHA-1 and SHA-256 object formats are accepted, because the admitted workspace
// repository chooses the format and an abbreviated name would not pin a commit.
function requireCommit(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) {
    throw new CoreContractError("invalid-record", `${field} must be a full Git object name`);
  }
  return value;
}

function requireCount(value: unknown, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new CoreContractError(
      "invalid-record",
      `${field} must be an integer of at least ${minimum}`,
    );
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

export function normalizeArtifactDeliveryRecord(value: unknown): ArtifactDeliveryRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ARTIFACT_DELIVERY_RECORD_KEYS) ||
    value.contractVersion !== ARTIFACT_DELIVERY_CONTRACT_VERSION ||
    !ARTIFACT_DELIVERY_STATES.includes(value.state as ArtifactDeliveryState)
  ) {
    throw new CoreContractError("invalid-record", "Artifact delivery record is invalid");
  }
  const state = value.state as ArtifactDeliveryState;
  const failureCode =
    value.failureCode === null
      ? null
      : ARTIFACT_DELIVERY_FAILURE_CODES.includes(value.failureCode as ArtifactDeliveryFailureCode)
        ? (value.failureCode as ArtifactDeliveryFailureCode)
        : (() => {
            throw new CoreContractError(
              "invalid-record",
              "Artifact delivery failure code is invalid",
            );
          })();
  const failureMessage =
    value.failureMessage === null
      ? null
      : requireText(
          value.failureMessage,
          "Artifact delivery failure message",
          ARTIFACT_DELIVERY_MAX_MESSAGE_BYTES,
        );
  const verifiedHead =
    value.verifiedHead === null
      ? null
      : requireCommit(value.verifiedHead, "Artifact delivery verified head");
  if (state === "applied" && verifiedHead === null) {
    throw new CoreContractError(
      "invalid-record",
      "An applied Artifact delivery requires the destination head it was verified against",
    );
  }
  if (state !== "applied" && verifiedHead !== null) {
    throw new CoreContractError(
      "invalid-record",
      "Only an applied Artifact delivery can carry a verified destination head",
    );
  }
  const destinationGrantId =
    value.destinationGrantId === null
      ? null
      : requireText(
          value.destinationGrantId,
          "Artifact delivery destination grant id",
          ARTIFACT_DELIVERY_MAX_GRANT_BYTES,
        );
  if (state === "applied" && destinationGrantId === null) {
    throw new CoreContractError(
      "invalid-record",
      "An applied Artifact delivery requires the destination workspace authority it wrote into",
    );
  }
  if (state === "pending" && destinationGrantId !== null) {
    throw new CoreContractError(
      "invalid-record",
      "A pending Artifact delivery has no destination workspace authority yet",
    );
  }
  const destinationWorkspaceId =
    value.destinationWorkspaceId === null
      ? null
      : workspaceId(String(value.destinationWorkspaceId));
  // The isolated worktree that produced the patch is never the workspace it is written into. Letting
  // one grant serve both roles would erase the boundary the second approval exists to protect.
  if (destinationGrantId !== null && destinationGrantId === value.patchOwnerGrantId) {
    throw new CoreContractError(
      "invalid-record",
      "An Artifact delivery destination must differ from the isolated patch owner authority",
    );
  }
  if ((state === "conflict" || state === "failed") !== (failureCode !== null)) {
    throw new CoreContractError(
      "invalid-record",
      "Exactly the conflict and failed Artifact delivery states carry a failure code",
    );
  }
  if (failureMessage !== null && failureCode === null) {
    throw new CoreContractError(
      "invalid-record",
      "An Artifact delivery failure message requires a failure code",
    );
  }
  if (state === "pending" && value.approvalId !== null) {
    throw new CoreContractError(
      "invalid-record",
      "A pending Artifact delivery has no apply approval yet",
    );
  }
  if (state === "applied" && value.approvalId === null) {
    throw new CoreContractError(
      "invalid-record",
      "An applied Artifact delivery requires its own apply approval",
    );
  }
  const createdAt = instant(String(value.createdAt));
  const updatedAt = instant(String(value.updatedAt));
  if (compareInstants(updatedAt, createdAt) < 0) {
    throw new CoreContractError(
      "invalid-record",
      "Artifact delivery update cannot precede creation",
    );
  }
  return deepFreeze({
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    artifactId: artifactId(String(value.artifactId)),
    workspaceId: workspaceId(String(value.workspaceId)),
    destinationWorkspaceId,
    taskId: taskId(String(value.taskId)),
    sessionId: value.sessionId === null ? null : sessionId(String(value.sessionId)),
    state,
    patchOwnerGrantId: requireText(
      value.patchOwnerGrantId,
      "Artifact delivery patch owner grant id",
      ARTIFACT_DELIVERY_MAX_GRANT_BYTES,
    ),
    patchOwnerWorkerId:
      value.patchOwnerWorkerId === null
        ? null
        : requireText(
            value.patchOwnerWorkerId,
            "Artifact delivery patch owner worker id",
            ARTIFACT_DELIVERY_MAX_GRANT_BYTES,
          ),
    patchRequestId:
      value.patchRequestId === null
        ? null
        : requireText(
            value.patchRequestId,
            "Artifact delivery patch request id",
            ARTIFACT_DELIVERY_MAX_REFERENCE_BYTES,
          ),
    destinationGrantId,
    patchReference: requireText(
      value.patchReference,
      "Artifact delivery patch reference",
      ARTIFACT_DELIVERY_MAX_REFERENCE_BYTES,
    ),
    patchSha256: requireSha256(value.patchSha256, "Artifact delivery patch digest"),
    patchByteLength: requireCount(value.patchByteLength, "Artifact delivery patch byte length", 1),
    baseCommit: requireCommit(value.baseCommit, "Artifact delivery base commit"),
    changedFileCount: requireCount(
      value.changedFileCount,
      "Artifact delivery changed file count",
      0,
    ),
    approvalId: value.approvalId === null ? null : approvalId(String(value.approvalId)),
    verifiedHead,
    failureCode,
    failureMessage,
    createdAt,
    updatedAt,
  });
}

export function assertArtifactDeliveryRecord(
  value: unknown,
): asserts value is ArtifactDeliveryRecord {
  normalizeArtifactDeliveryRecord(value);
}

/**
 * A delivery attempt may be retried from a terminal non-applied state, but an applied delivery is
 * final: re-applying the same patch would either conflict or silently double-write.
 */
export function canRetryArtifactDelivery(state: ArtifactDeliveryState): boolean {
  return state === "pending" || state === "conflict" || state === "failed" || state === "cancelled";
}

/**
 * The apply approval must never read like the publish approval. Publishing only stores a patch as an
 * Artifact; applying writes into the user's own repository. The two are separate one-shot approvals,
 * so the copy states the destination, the base commit and the irreversible effect explicitly.
 */
export function buildArtifactApplyApprovalSummary(
  delivery: Pick<ArtifactDeliveryRecord, "changedFileCount" | "baseCommit">,
): string {
  const fileLabel = delivery.changedFileCount === 1 ? "file" : "files";
  const shortBase = delivery.baseCommit.slice(0, 12);
  return (
    `Apply the saved coding patch to the original workspace: ` +
    `${String(delivery.changedFileCount)} ${fileLabel} will be written into your repository ` +
    `at base commit ${shortBase}. This modifies the original workspace and is not the same as ` +
    `saving the patch as an Artifact.`
  );
}

export function isArtifactDeliveryTransitionLegal(
  from: ArtifactDeliveryState,
  to: ArtifactDeliveryState,
): boolean {
  if (from === "pending") {
    return to === "applying" || to === "cancelled";
  }
  if (from === "applying") {
    // `applying → applying` refines an attempt already in flight: it is how the approval this
    // attempt is blocked on becomes durable before the decision is awaited. Patch identity and the
    // destination grant are immutable by then, so a refinement cannot retarget the write.
    return (
      to === "applying" ||
      to === "applied" ||
      to === "conflict" ||
      to === "failed" ||
      to === "cancelled"
    );
  }
  if (from === "applied") {
    return false;
  }
  return to === "applying";
}

/**
 * What a restart must do with a delivery left `applying` by a crash.
 *
 * An interrupted attempt cannot be resumed: the process that held the repository lock and owned the
 * approval decision is gone, so nothing in this process can prove whether the write happened. The
 * recovery is therefore a classification, never a continuation.
 */
export type ArtifactDeliveryRecoveryAction =
  /** No attempt was interrupted; the record already names a settled outcome. */
  | Readonly<{ readonly action: "none" }>
  /**
   * The attempt died before any user decision existed, so no write was ever authorized. It is
   * released to `cancelled`, the retryable terminal state, and the Artifact is retained.
   */
  | Readonly<{ readonly action: "cancel"; readonly reason: string }>
  /**
   * An approval existed when the process died, so a write may or may not have landed. The attempt is
   * failed closed rather than retried: replaying `git apply` over a tree that already carries the
   * patch would conflict, and assuming it did not would risk a second write.
   */
  | Readonly<{
      readonly action: "fail-closed";
      readonly failureCode: ArtifactDeliveryFailureCode;
      readonly reason: string;
    }>;

/**
 * Classify a delivery record found at startup.
 *
 * Only `applying` records are interrupted attempts. The approval ID is the discriminator, because the
 * applicator persists it before awaiting the decision: absent means the crash preceded any authority
 * to write, present means it did not.
 */
export function classifyArtifactDeliveryRecovery(
  delivery: ArtifactDeliveryRecord,
): ArtifactDeliveryRecoveryAction {
  if (delivery.state !== "applying") {
    return Object.freeze({ action: "none" as const });
  }
  if (delivery.approvalId === null) {
    return Object.freeze({
      action: "cancel" as const,
      reason:
        "The apply attempt ended before an approval was created, so no workspace write was authorized",
    });
  }
  return Object.freeze({
    action: "fail-closed" as const,
    failureCode: "apply-failed" as const,
    reason:
      "The apply attempt ended while an approval was outstanding, so whether the workspace was written cannot be proven; the patch is retained and must be applied again deliberately",
  });
}

/**
 * The record a restart should persist for an interrupted attempt, or `null` when nothing is owed.
 *
 * The patch identity, base commit and destination are carried through unchanged so a recovered
 * failure still explains which repository the attempt was aimed at.
 */
export function recoverArtifactDeliveryRecord(
  delivery: ArtifactDeliveryRecord,
  updatedAt: Instant,
): ArtifactDeliveryRecord | null {
  const recovery = classifyArtifactDeliveryRecovery(delivery);
  if (recovery.action === "none") {
    return null;
  }
  if (recovery.action === "cancel") {
    return normalizeArtifactDeliveryRecord({
      ...delivery,
      state: "cancelled",
      failureCode: null,
      failureMessage: null,
      updatedAt,
    });
  }
  return normalizeArtifactDeliveryRecord({
    ...delivery,
    state: "failed",
    failureCode: recovery.failureCode,
    failureMessage: recovery.reason,
    updatedAt,
  });
}
