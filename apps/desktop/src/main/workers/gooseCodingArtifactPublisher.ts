import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CODING_ARTIFACT_PUBLISH_TOOL_ID,
  ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
  PRIVILEGED_CONTRACT_VERSION,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  approvalActorId,
  artifactId,
  assertApprovalRequestSnapshot,
  assertPersistContentReferenceResult,
  assertResolvedContentReference,
  assertStoreContentReferenceInput,
  instant,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  type ActestraPersistencePort,
  type ApprovalActorId,
  type ApprovalRequestSnapshot,
  type ApprovalService,
  type Artifact,
  type ContentReferenceMetadata,
  type ContentReferenceOwner,
  type PrivilegedClock,
  type ProtectedOperation,
  type SessionId,
  type TaskId,
  type ToolGateway,
  type UserApprovalDecision,
  type WorkerId,
  type WorkspaceId,
  type WorkspaceGrant,
} from "../../core";
import {
  captureIsolatedCodingPatch,
  type IsolatedCodingPatchSnapshot,
} from "./isolatedCodingPatch";
import { GooseCodingEvidenceCoordinator } from "./gooseCodingEvidenceCoordinator";
import {
  WorkerStorageBudgetError,
  assertWorkerOutputWithinBudget,
  assertWorkerPrivateStorageWithinBudget,
  type WorkerStorageBudgetErrorCode,
} from "./workerStorageBudget";

export type GooseCodingArtifactPublisherErrorCode =
  | "invalid-config"
  | "invalid-decision"
  | "persistence-failed"
  | "gateway-failed"
  | WorkerStorageBudgetErrorCode;

export class GooseCodingArtifactPublisherError extends Error {
  constructor(
    readonly code: GooseCodingArtifactPublisherErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseCodingArtifactPublisherError";
  }
}

export interface GooseCodingPublishSnapshot {
  readonly baseCommit: string;
  readonly patchByteLength: number;
  readonly patchSha256: string;
}

export interface GooseCodingPublishDecisionRequest {
  readonly approval: ApprovalRequestSnapshot;
  readonly snapshot: GooseCodingPublishSnapshot;
  readonly signal: AbortSignal;
}

export interface GooseCodingPublishDecision {
  readonly decision: Exclude<UserApprovalDecision, "cancelled">;
  readonly actorId: ApprovalActorId;
}

export type GooseCodingPublishDecisionHandler = (
  request: GooseCodingPublishDecisionRequest,
) => Promise<GooseCodingPublishDecision>;

export interface GooseCodingPublishOptions {
  readonly decisionHandler: GooseCodingPublishDecisionHandler;
}

export interface GooseCodingPublishedArtifactResult {
  readonly status: "published";
  readonly baseCommit: string;
  readonly artifact: Artifact;
  readonly output: ContentReferenceMetadata;
}

export interface GooseCodingDeniedPublishResult {
  readonly status: "denied";
  readonly approval: ApprovalRequestSnapshot;
}

/** A reviewed read-only attempt: the isolated worktree is unchanged, so there is nothing to approve. */
export interface GooseCodingUnchangedPublishResult {
  readonly status: "unchanged";
  readonly baseCommit: string;
}

export type GooseCodingPublishResult =
  | GooseCodingPublishedArtifactResult
  | GooseCodingDeniedPublishResult
  | GooseCodingUnchangedPublishResult;

export interface CreateGooseCodingArtifactPublisherOptions {
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly grant: WorkspaceGrant;
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly destinationWorkspaceId?: WorkspaceId;
  readonly toolGateway: ToolGateway;
  readonly approvalService: ApprovalService;
  readonly evidence: GooseCodingEvidenceCoordinator;
}

export interface GooseCodingArtifactPublisher {
  publish(
    options: GooseCodingPublishOptions,
    signal: AbortSignal,
  ): Promise<GooseCodingPublishResult>;
}

function digestFor(
  config: CreateGooseCodingArtifactPublisherOptions,
  snapshot: IsolatedCodingPatchSnapshot,
): string {
  return createHash("sha256")
    .update(
      [
        "actestra-coding-publish-v1",
        config.grant.workspaceId,
        config.taskId,
        config.sessionId,
        config.workerId,
        config.grant.grantId,
        snapshot.baseCommit,
        snapshot.patchSha256,
      ].join("\u0000"),
    )
    .digest("hex");
}

function normalizeDecision(value: unknown): GooseCodingPublishDecision {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, "decision") ||
    !Object.hasOwn(value, "actorId")
  ) {
    throw new GooseCodingArtifactPublisherError(
      "invalid-decision",
      "Coding Artifact publish decision is invalid",
    );
  }
  const decision = Reflect.get(value, "decision");
  const actor = Reflect.get(value, "actorId");
  if ((decision !== "approved" && decision !== "denied") || typeof actor !== "string") {
    throw new GooseCodingArtifactPublisherError(
      "invalid-decision",
      "Coding Artifact publish decision is invalid",
    );
  }
  try {
    return Object.freeze({ decision, actorId: approvalActorId(actor) });
  } catch (error) {
    throw new GooseCodingArtifactPublisherError(
      "invalid-decision",
      "Coding Artifact publish actor is invalid",
      { cause: error },
    );
  }
}

async function awaitDecision(
  handler: GooseCodingPublishDecisionHandler,
  request: GooseCodingPublishDecisionRequest,
): Promise<GooseCodingPublishDecision> {
  if (request.signal.aborted) {
    throw new GooseCodingArtifactPublisherError(
      "invalid-decision",
      "Coding Artifact publish was cancelled before user confirmation",
    );
  }
  let rejectOnAbort!: (error: GooseCodingArtifactPublisherError) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = (): void => {
    rejectOnAbort(
      new GooseCodingArtifactPublisherError(
        "invalid-decision",
        "Coding Artifact publish was cancelled before user confirmation",
      ),
    );
  };
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    return normalizeDecision(
      await Promise.race([Promise.resolve().then(() => handler(request)), aborted]),
    );
  } finally {
    request.signal.removeEventListener("abort", onAbort);
  }
}

function matchesResolution(
  resolved: ApprovalRequestSnapshot,
  pending: ApprovalRequestSnapshot,
  operation: ProtectedOperation,
  decision: GooseCodingPublishDecision,
): boolean {
  try {
    assertApprovalRequestSnapshot(resolved);
  } catch {
    return false;
  }
  return (
    resolved.approvalId === pending.approvalId &&
    resolved.policyRevision === pending.policyRevision &&
    resolved.requestedAt === pending.requestedAt &&
    resolved.expiresAt === pending.expiresAt &&
    resolved.state === decision.decision &&
    resolved.resolvedBy === decision.actorId &&
    isDeepStrictEqual(resolved.operation, operation)
  );
}

function publicSnapshot(snapshot: IsolatedCodingPatchSnapshot): GooseCodingPublishSnapshot {
  return Object.freeze({
    baseCommit: snapshot.baseCommit,
    patchByteLength: snapshot.patchByteLength,
    patchSha256: snapshot.patchSha256,
  });
}

async function assertPublishStorageBudget(
  config: CreateGooseCodingArtifactPublisherOptions,
): Promise<void> {
  try {
    await assertWorkerPrivateStorageWithinBudget(path.dirname(config.worktreeRoot));
  } catch (error) {
    if (error instanceof WorkerStorageBudgetError) {
      const message = "The isolated Coding Worker exceeded its private storage boundary.";
      await config.evidence.failPrompt({ errorCode: error.code, message });
      throw new GooseCodingArtifactPublisherError(
        error.code,
        "Coding Artifact publish exceeded the Worker storage budget",
        { cause: error },
      );
    }
    throw new GooseCodingArtifactPublisherError(
      "gateway-failed",
      "Coding Artifact publish exceeded the Worker storage budget",
      { cause: error },
    );
  }
}

async function assertPublishOutputBudget(
  config: CreateGooseCodingArtifactPublisherOptions,
  content: string,
): Promise<void> {
  try {
    assertWorkerOutputWithinBudget(content);
  } catch (error) {
    if (error instanceof WorkerStorageBudgetError) {
      const message = "The isolated Coding Worker exceeded its output boundary.";
      await config.evidence.failPrompt({ errorCode: error.code, message });
      throw new GooseCodingArtifactPublisherError(
        error.code,
        "Coding Artifact publish exceeded the Worker output budget",
        { cause: error },
      );
    }
    throw new GooseCodingArtifactPublisherError(
      "gateway-failed",
      "Coding Artifact publish exceeded the Worker output budget",
      { cause: error },
    );
  }
}

export function createGooseCodingArtifactPublisher(
  config: CreateGooseCodingArtifactPublisherOptions,
): GooseCodingArtifactPublisher {
  let publishPromise: Promise<GooseCodingPublishResult> | undefined;
  return Object.freeze({
    publish(
      options: GooseCodingPublishOptions,
      signal: AbortSignal,
    ): Promise<GooseCodingPublishResult> {
      if (
        typeof options !== "object" ||
        options === null ||
        Reflect.ownKeys(options).length !== 1 ||
        typeof options.decisionHandler !== "function" ||
        typeof signal !== "object" ||
        signal === null ||
        typeof signal.aborted !== "boolean"
      ) {
        return Promise.reject(
          new GooseCodingArtifactPublisherError(
            "invalid-config",
            "Coding Artifact publisher requires one main-owned decision handler",
          ),
        );
      }
      publishPromise ??= (async () => {
        await assertPublishStorageBudget(config);
        const snapshot = await captureIsolatedCodingPatch({
          worktreeRoot: config.worktreeRoot,
          gitDirectory: config.gitDirectory,
          gitCommonDirectory: config.gitCommonDirectory,
        });
        await assertPublishStorageBudget(config);
        if (snapshot.patchByteLength === 0) {
          await config.evidence.completeReadOnlyReview();
          return Object.freeze({ status: "unchanged", baseCommit: snapshot.baseCommit });
        }
        await assertPublishOutputBudget(config, snapshot.patch);
        const digest = digestFor(config, snapshot);
        const requestId = toolRequestId(`request-coding-publish-${digest}`);
        const inputRef = toolInputReference(`coding-publish-input-${digest}`);
        const patchRef = toolInputReference(`coding-publish-patch-${digest}`);
        const outputRef = toolOutputReference(`coding-publish-output-${digest}`);
        const requestedAt = config.clock.now();
        instant(requestedAt);
        const operation = Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          requestId,
          workspaceId: config.grant.workspaceId,
          taskId: config.taskId,
          sessionId: config.sessionId,
          workerId: config.workerId,
          toolId: CODING_ARTIFACT_PUBLISH_TOOL_ID,
          inputRef,
          action: "publish.execute",
          resourceKind: "repository",
          summary:
            "Save the reviewed isolated coding patch as an Actestra Artifact. This does not modify the original workspace.",
          credentialRefs: Object.freeze([]),
          requestedAt,
        } satisfies ProtectedOperation);
        const owner = Object.freeze({
          workspaceId: operation.workspaceId,
          taskId: operation.taskId,
          sessionId: operation.sessionId,
          workerId: operation.workerId,
          requestId: operation.requestId,
          grantId: config.grant.grantId,
        } satisfies ContentReferenceOwner);
        const serializedInput = JSON.stringify({
          contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
          baseCommit: snapshot.baseCommit,
          patchReference: patchRef,
          patchByteLength: snapshot.patchByteLength,
          patchSha256: snapshot.patchSha256,
          outputReference: outputRef,
        });
        const patchStoreInput = Object.freeze({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          reference: patchRef,
          kind: "tool-input" as const,
          owner,
          classification: "task-content" as const,
          mediaType: "text/plain; charset=utf-8" as const,
          content: snapshot.patch,
          createdAt: requestedAt,
        });
        const storeInput = Object.freeze({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          reference: inputRef,
          kind: "tool-input" as const,
          owner,
          classification: "task-content" as const,
          mediaType: "text/plain; charset=utf-8" as const,
          content: serializedInput,
          createdAt: requestedAt,
        });
        assertStoreContentReferenceInput(patchStoreInput);
        assertStoreContentReferenceInput(storeInput);
        let storedPatch;
        let stored;
        try {
          storedPatch = await config.persistence.storeContentReference(patchStoreInput);
          assertPersistContentReferenceResult(storedPatch);
          stored = await config.persistence.storeContentReference(storeInput);
          assertPersistContentReferenceResult(stored);
        } catch (error) {
          throw new GooseCodingArtifactPublisherError(
            "persistence-failed",
            "Coding Artifact publish input could not be persisted",
            { cause: error },
          );
        }
        if (
          storedPatch.metadata.reference !== patchRef ||
          storedPatch.metadata.kind !== "tool-input" ||
          !isDeepStrictEqual(storedPatch.metadata.owner, owner) ||
          storedPatch.metadata.byteLength !== snapshot.patchByteLength ||
          storedPatch.metadata.sha256 !== snapshot.patchSha256 ||
          stored.metadata.reference !== inputRef ||
          stored.metadata.kind !== "tool-input" ||
          !isDeepStrictEqual(stored.metadata.owner, owner) ||
          stored.metadata.byteLength !== Buffer.byteLength(serializedInput, "utf8")
        ) {
          throw new GooseCodingArtifactPublisherError(
            "persistence-failed",
            "Coding Artifact publish input persistence returned mismatched evidence",
          );
        }
        await config.evidence.beginPublish(operation);
        let gatewayResult;
        try {
          gatewayResult = await config.toolGateway.invoke(operation, undefined, { signal });
        } catch (error) {
          throw new GooseCodingArtifactPublisherError(
            "gateway-failed",
            "Coding Artifact publish approval could not be created",
            { cause: error },
          );
        }
        if (gatewayResult.status !== "approval-required") {
          throw new GooseCodingArtifactPublisherError(
            "gateway-failed",
            "Coding Artifact publish must require one-shot user approval",
          );
        }
        const pending = gatewayResult.approval;
        await config.evidence.recordApprovalRequired(operation, pending);
        const decision = await awaitDecision(
          options.decisionHandler,
          Object.freeze({ approval: pending, snapshot: publicSnapshot(snapshot), signal }),
        );
        let resolved: ApprovalRequestSnapshot;
        try {
          resolved = await config.approvalService.resolve(
            pending.approvalId,
            decision.decision,
            decision.actorId,
          );
        } catch (error) {
          const committed = await config.approvalService.get(pending.approvalId);
          if (
            committed === undefined ||
            !matchesResolution(committed, pending, operation, decision)
          ) {
            throw error;
          }
          resolved = committed;
        }
        if (!matchesResolution(resolved, pending, operation, decision)) {
          throw new GooseCodingArtifactPublisherError(
            "invalid-decision",
            "Coding Artifact publish approval resolution returned mismatched evidence",
          );
        }
        await config.evidence.recordApprovalResolved(operation, resolved);
        if (decision.decision === "denied") {
          await config.evidence.completeDeniedPublish(operation);
          return Object.freeze({ status: "denied", approval: resolved });
        }
        await assertPublishStorageBudget(config);
        const approvedSnapshot = await captureIsolatedCodingPatch({
          worktreeRoot: config.worktreeRoot,
          gitDirectory: config.gitDirectory,
          gitCommonDirectory: config.gitCommonDirectory,
        });
        await assertPublishStorageBudget(config);
        await assertPublishOutputBudget(config, approvedSnapshot.patch);
        if (!isDeepStrictEqual(approvedSnapshot, snapshot)) {
          await config.evidence.completeInvalidatedPublish(operation);
          throw new GooseCodingArtifactPublisherError(
            "gateway-failed",
            "Coding worktree changed after the publish approval snapshot",
          );
        }
        try {
          gatewayResult = await config.toolGateway.invoke(operation, resolved.approvalId, {
            signal,
          });
        } catch (error) {
          throw new GooseCodingArtifactPublisherError(
            "gateway-failed",
            "Approved coding Artifact publish failed inside the Tool Gateway",
            { cause: error },
          );
        }
        if (gatewayResult.status !== "executed" || gatewayResult.result.outputRef !== outputRef) {
          throw new GooseCodingArtifactPublisherError(
            "gateway-failed",
            "Approved coding Artifact publish returned mismatched output evidence",
          );
        }
        const resolvedOutput = await config.persistence.resolveContentReference({
          contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
          reference: outputRef,
          kind: "tool-output",
          owner,
          resolvedAt: config.clock.now(),
          consume: false,
        });
        assertResolvedContentReference(resolvedOutput);
        if (
          resolvedOutput.content !== snapshot.patch ||
          resolvedOutput.metadata.reference !== outputRef ||
          !isDeepStrictEqual(resolvedOutput.metadata.owner, owner) ||
          resolvedOutput.metadata.sha256 !== snapshot.patchSha256 ||
          resolvedOutput.metadata.byteLength !== snapshot.patchByteLength
        ) {
          throw new GooseCodingArtifactPublisherError(
            "persistence-failed",
            "Coding Artifact publish output could not be verified",
          );
        }
        const now = config.clock.now();
        instant(now);
        const artifact = Object.freeze({
          id: artifactId(`artifact-coding-${digest}`),
          workspaceId: config.grant.workspaceId,
          taskId: config.taskId,
          sessionId: config.sessionId,
          kind: "file",
          label: "Actestra coding patch",
          state: "available",
          createdAt: now,
          updatedAt: now,
        } satisfies Artifact);
        await config.evidence.completePublishedArtifact(operation, artifact, {
          patchOwnerGrantId: config.grant.grantId,
          destinationWorkspaceId: config.destinationWorkspaceId ?? null,
          // The owner verified above is the only authority that can read this patch back, so the
          // delivery carries it rather than letting a later read guess at a constant.
          patchOwnerWorkerId: owner.workerId,
          patchRequestId: owner.requestId,
          patchReference: patchRef,
          patchSha256: snapshot.patchSha256,
          patchByteLength: snapshot.patchByteLength,
          baseCommit: snapshot.baseCommit,
          changedFileCount: snapshot.changedFileCount,
        });
        return Object.freeze({
          status: "published",
          baseCommit: snapshot.baseCommit,
          artifact,
          output: Object.freeze({ ...resolvedOutput.metadata, owner: Object.freeze({ ...owner }) }),
        });
      })().catch((error: unknown) => {
        publishPromise = undefined;
        throw error;
      });
      return publishPromise;
    },
  });
}
