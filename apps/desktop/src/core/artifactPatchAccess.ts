import { toolRequestId, workerId, type ArtifactId, type SessionId } from "./domain";
import type { PrivilegedClock } from "./privilegedServices";
import { toolInputReference } from "./privilegedServices";
import type { ArtifactDeliveryRecord } from "./artifactDelivery";
import {
  assertResolvedContentReference,
  workspaceGrantId,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  type ResolveContentReferenceInput,
  type ResolvedContentReference,
} from "./workloadContent";

export const ARTIFACT_PATCH_PREVIEW_MAXIMUM_BYTES = 8192 as const;

/**
 * Closed list so process boundaries can validate an applicator code instead of trusting the sender.
 * The union is derived from it, keeping the two in step by construction.
 */
export const ARTIFACT_WORKSPACE_APPLICATOR_ERROR_CODES = [
  "invalid-options",
  "artifact-not-found",
  "delivery-not-found",
  "patch-unavailable",
  "patch-digest-mismatch",
  "workspace-grant-invalid",
  "workspace-dirty",
  "head-drift",
  "patch-conflict",
  "apply-failed",
  "lock-unavailable",
  /** The delivery is terminal: applying again would double-write the user's repository. */
  "already-applied",
  /** Another attempt holds this delivery, or a crashed one left it unsettled. */
  "apply-in-progress",
  "approval-failed",
] as const;

export type ArtifactWorkspaceApplicatorErrorCode =
  (typeof ARTIFACT_WORKSPACE_APPLICATOR_ERROR_CODES)[number];

export class ArtifactWorkspaceApplicatorError extends Error {
  constructor(
    readonly code: ArtifactWorkspaceApplicatorErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtifactWorkspaceApplicatorError";
  }
}

/**
 * Narrow read-only port for patch access. Deliberately excludes workspace
 * mutation so the persistence utility process never links Git execution.
 */
export interface ArtifactPatchAccessPort {
  getArtifactDelivery(artifactId: ArtifactId): Promise<ArtifactDeliveryRecord | null>;
  resolveContentReference(input: ResolveContentReferenceInput): Promise<ResolvedContentReference>;
}

async function requireDelivery(
  artifactId: ArtifactId,
  persistence: ArtifactPatchAccessPort,
): Promise<ArtifactDeliveryRecord> {
  const delivery = await persistence.getArtifactDelivery(artifactId);
  if (delivery === null) {
    throw new ArtifactWorkspaceApplicatorError(
      "delivery-not-found",
      "Artifact delivery record not found",
    );
  }
  return delivery;
}

/**
 * Rebuilds the exact owner the patch was stored under. Persistence compares content ownership field
 * by field and resolves the named worker against the publishing session's own worker, so every field
 * here has to come from the durable record rather than from a constant or from the calling operation.
 */
export function artifactPatchOwner(delivery: ArtifactDeliveryRecord): {
  readonly workspaceId: ArtifactDeliveryRecord["workspaceId"];
  readonly taskId: ArtifactDeliveryRecord["taskId"];
  readonly sessionId: SessionId;
  readonly workerId: ReturnType<typeof workerId>;
  readonly requestId: ReturnType<typeof toolRequestId>;
  readonly grantId: ReturnType<typeof workspaceGrantId>;
} {
  if (
    delivery.sessionId === null ||
    delivery.patchOwnerWorkerId === null ||
    delivery.patchRequestId === null
  ) {
    throw new ArtifactWorkspaceApplicatorError(
      "patch-unavailable",
      "Artifact delivery does not record the authority its patch was stored under",
    );
  }
  return Object.freeze({
    workspaceId: delivery.workspaceId,
    taskId: delivery.taskId,
    sessionId: delivery.sessionId,
    workerId: workerId(delivery.patchOwnerWorkerId),
    requestId: toolRequestId(delivery.patchRequestId),
    // The patch was stored under the isolated worktree authority that produced it, so reading it back
    // must name that same owner. The destination grant never owned this content.
    grantId: workspaceGrantId(delivery.patchOwnerGrantId),
  });
}

async function resolvePatchContent(
  delivery: ArtifactDeliveryRecord,
  persistence: ArtifactPatchAccessPort,
  clock: PrivilegedClock,
  failureMessage: string,
): Promise<string> {
  try {
    const resolved = await persistence.resolveContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: toolInputReference(delivery.patchReference),
      kind: "tool-input",
      // Preview, download, and apply all read the one stored patch, so they name one owner. Deriving a
      // per-operation request id here would refuse every read but the one that happened to match.
      owner: artifactPatchOwner(delivery),
      resolvedAt: clock.now(),
      consume: false,
    });
    assertResolvedContentReference(resolved);
    return resolved.content;
  } catch (error) {
    throw new ArtifactWorkspaceApplicatorError("patch-unavailable", failureMessage, {
      cause: error,
    });
  }
}

/**
 * Resolves the persisted patch for an apply attempt. The isolated worktree is
 * normally removed by this point, so content always comes from the persisted
 * reference rather than the worktree.
 */
export async function resolveArtifactPatchForApply(
  delivery: ArtifactDeliveryRecord,
  persistence: ArtifactPatchAccessPort,
  clock: PrivilegedClock,
): Promise<string> {
  return resolvePatchContent(delivery, persistence, clock, "Patch content could not be resolved");
}

/** Bounded preview projection safe to hand to the Renderer. */
export async function generateArtifactPatchPreview(
  artifactId: ArtifactId,
  persistence: ArtifactPatchAccessPort,
  clock: PrivilegedClock,
): Promise<string> {
  const delivery = await requireDelivery(artifactId, persistence);
  const content = await resolvePatchContent(
    delivery,
    persistence,
    clock,
    "Patch content could not be resolved for preview",
  );
  return content.slice(0, ARTIFACT_PATCH_PREVIEW_MAXIMUM_BYTES);
}

export async function getArtifactPatchContent(
  artifactId: ArtifactId,
  persistence: ArtifactPatchAccessPort,
  clock: PrivilegedClock,
): Promise<string> {
  const delivery = await requireDelivery(artifactId, persistence);
  return resolvePatchContent(
    delivery,
    persistence,
    clock,
    "Patch content could not be resolved for download",
  );
}
