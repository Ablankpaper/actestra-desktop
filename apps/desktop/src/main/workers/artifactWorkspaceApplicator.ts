import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  instant,
  type ActestraPersistencePort,
  type ApprovalRequestSnapshot,
  type ArtifactId,
  type PrivilegedClock,
  type ProtectedOperation,
  type ToolGateway,
  type WorkspaceGrant,
  ArtifactWorkspaceApplicatorError,
  resolveArtifactPatchForApply,
  PRIVILEGED_CONTRACT_VERSION,
  toolRequestId,
  toolInputReference,
  ARTIFACT_APPLY_TOOL_ID,
  sessionId,
  workerId,
  normalizeArtifactDeliveryRecord,
  buildArtifactApplyApprovalSummary,
  ARTIFACT_DELIVERY_FAILURE_CODES,
  type ApprovalId,
  type ArtifactDeliveryFailureCode,
  type ArtifactDeliveryRecord,
  type ArtifactDeliveryState,
} from "../../core";
import {
  CLOSED_GIT_CONFIG_ARGUMENTS,
  GIT_EXECUTABLE,
  GIT_TIMEOUT_MS,
  assertPrimaryWorkspaceGitDirectory,
  assertWorkspaceGitBindingUnchanged,
  execWorkspaceGit,
  resolveWorkspaceGitBinding,
  workspaceGitEnvironment,
  type WorkspaceGitBinding,
} from "./workspaceGitBinding";
import {
  requireClosedRepositoryConfiguration,
  withRepositoryConfigurationLocks,
} from "./isolatedCodingWorktree";
import {
  acquireWorkspaceRepositoryLock,
  type WorkspaceRepositoryLock,
} from "./workspaceRepositoryLock";

export {
  ArtifactWorkspaceApplicatorError,
  generateArtifactPatchPreview,
  getArtifactPatchContent,
  type ArtifactWorkspaceApplicatorErrorCode,
} from "../../core";

export interface ArtifactWorkspaceApplyOptions {
  readonly artifactId: ArtifactId;
  /**
   * Candidate destination root. Its Git directory is never accepted from the caller: it is resolved
   * from this path through `git rev-parse`, so a wrong or forged Git directory cannot be supplied.
   */
  readonly workspaceRoot: string;
  readonly grant: WorkspaceGrant;
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly toolGateway: ToolGateway;
  /**
   * Awaits the user's decision on an apply approval. Injected instead of an `ApprovalService`,
   * because the applicator must not be able to resolve the approval it is itself waiting on. Main
   * resumes a decision delivered through the UI; a test can settle one without a timer.
   */
  readonly awaitApprovalDecision: (
    approval: ApprovalId,
    signal: AbortSignal,
  ) => Promise<ApprovalRequestSnapshot>;
  readonly signal: AbortSignal;
}

export interface ArtifactWorkspaceApplyResult {
  /**
   * The destination HEAD verified immediately after the patch was written. This round applies the
   * patch to the working tree without committing, so it equals the base commit rather than naming a
   * new commit that contains the change.
   */
  readonly verifiedHead: string;
}

async function runGit(
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
  ...args: readonly string[]
): Promise<string> {
  try {
    return await execWorkspaceGit(workspaceRoot, environment, ...args);
  } catch (error) {
    throw new ArtifactWorkspaceApplicatorError(
      "apply-failed",
      "Git operation failed during artifact apply",
      { cause: error },
    );
  }
}

/**
 * Reports user workspace changes while excluding only General's bounded, Actestra-owned output.
 * The pathspec deliberately does not exclude the whole `.actestra` tree: unrelated files there are
 * still user workspace dirt and must keep the apply fail-closed.
 */
async function workspaceStatus(
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<string> {
  return runGit(
    workspaceRoot,
    environment,
    "status",
    "--porcelain",
    "--",
    ".",
    ":(exclude).actestra/task-output",
  );
}

export async function applyArtifactToWorkspace(
  options: ArtifactWorkspaceApplyOptions,
): Promise<ArtifactWorkspaceApplyResult> {
  // Step 1: Verify artifact and delivery exist
  const graph = await options.persistence.loadDomainGraph();
  const artifact = graph.artifacts.find(({ id }) => id === options.artifactId);
  if (artifact === undefined) {
    throw new ArtifactWorkspaceApplicatorError(
      "artifact-not-found",
      "Artifact not found in domain graph",
    );
  }

  const delivery = await options.persistence.getArtifactDelivery(options.artifactId);
  if (delivery === null) {
    throw new ArtifactWorkspaceApplicatorError(
      "delivery-not-found",
      "Artifact delivery record not found",
    );
  }

  // Step 2: Verify artifact ownership. The destination grant must admit the original workspace, and
  // it is never the isolated worktree grant that produced the patch.
  if (
    artifact.workspaceId !== delivery.workspaceId ||
    (delivery.destinationWorkspaceId !== null &&
      delivery.destinationWorkspaceId !== options.grant.workspaceId) ||
    artifact.taskId !== delivery.taskId
  ) {
    throw new ArtifactWorkspaceApplicatorError("artifact-not-found", "Artifact ownership mismatch");
  }
  if (options.grant.grantId === delivery.patchOwnerGrantId) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "The isolated worktree grant cannot authorize writing the original workspace",
    );
  }
  if (options.grant.state !== "active" || options.grant.rootPath !== options.workspaceRoot) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Destination grant does not admit the workspace root being written",
    );
  }
  if (
    delivery.destinationGrantId !== null &&
    delivery.destinationGrantId !== options.grant.grantId
  ) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Delivery is already bound to a different destination grant",
    );
  }

  // An applied delivery is terminal. Re-applying the same patch would either conflict or silently
  // double-write the user's repository, so the attempt is refused before any Git command runs.
  if (delivery.state === "applied") {
    throw new ArtifactWorkspaceApplicatorError(
      "already-applied",
      "Artifact delivery has already been applied to the workspace",
    );
  }
  // A delivery left `applying` by a crash is not resumable here: the durable record cannot say
  // whether the write had already begun. Recovery has to settle it before a new attempt starts.
  if (delivery.state === "applying") {
    throw new ArtifactWorkspaceApplicatorError(
      "apply-in-progress",
      "Artifact delivery already has an apply attempt in flight",
    );
  }

  // Step 3: Resolve patch from the persisted reference. The isolated worktree
  // is normally already removed, so content never comes from it.
  const patchContent = await resolveArtifactPatchForApply(
    delivery,
    options.persistence,
    options.clock,
  );

  // Step 4: Verify patch digest
  const patchSha256 = createHash("sha256").update(patchContent, "utf8").digest("hex");
  const patchByteLength = Buffer.byteLength(patchContent, "utf8");
  if (patchSha256 !== delivery.patchSha256 || patchByteLength !== delivery.patchByteLength) {
    throw new ArtifactWorkspaceApplicatorError(
      "patch-digest-mismatch",
      "Patch content digest does not match delivery record",
    );
  }

  // Step 5: Resolve the canonical Git binding of the destination. Git itself has to report the
  // working tree and its Git directory; a path that merely resolves proves nothing about either.
  let binding: WorkspaceGitBinding;
  try {
    binding = await resolveWorkspaceGitBinding(options.workspaceRoot);
  } catch (error) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Destination workspace is not a verifiable Git working tree",
      { cause: error },
    );
  }
  if (binding.workspaceRoot !== options.workspaceRoot) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Destination workspace root is not its own Git top level",
    );
  }
  // Writing the original checkout is the whole point of this step, so a linked worktree destination
  // means the caller passed the isolated copy instead of the repository the user admitted.
  if (binding.isLinkedWorktree) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Destination workspace must be the original checkout, not a linked worktree",
    );
  }
  try {
    await assertPrimaryWorkspaceGitDirectory(binding);
  } catch (error) {
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Destination workspace Git metadata is not the primary checkout directory",
      { cause: error },
    );
  }

  const environment = workspaceGitEnvironment(binding.workspaceRoot);

  // Pre-approval repository checks happen before the normal `applying` record exists. A fail-closed
  // refusal at this boundary still has a durable cause: otherwise the UI/database would retain
  // `pending` and lose the distinction between "not attempted" and "workspace was unsafe".
  const persistPreflightFailure = async (
    error: ArtifactWorkspaceApplicatorError,
  ): Promise<void> => {
    if (error.code !== "workspace-dirty" && error.code !== "head-drift") return;
    const failedDelivery = normalizeArtifactDeliveryRecord({
      ...delivery,
      state: "failed",
      destinationGrantId: options.grant.grantId,
      approvalId: null,
      verifiedHead: null,
      failureCode: error.code,
      failureMessage: error.message,
      updatedAt: options.clock.now(),
    });
    await options.persistence.persistArtifactDelivery(failedDelivery);
  };

  try {
    await withRepositoryConfigurationLocks(
      binding.gitCommonDirectory,
      binding.gitDirectory,
      async () => {
        await requireClosedRepositoryConfiguration(options.workspaceRoot, environment);

        // Step 6: Check HEAD matches base commit
        const currentHead = (
          await runGit(options.workspaceRoot, environment, "rev-parse", "--verify", "HEAD^{commit}")
        ).trim();
        if (currentHead !== delivery.baseCommit) {
          throw new ArtifactWorkspaceApplicatorError(
            "head-drift",
            "Workspace HEAD has moved since patch was created",
          );
        }

        // Step 7: Check workspace is clean
        const statusOutput = await workspaceStatus(options.workspaceRoot, environment);
        if (statusOutput.trim().length > 0) {
          throw new ArtifactWorkspaceApplicatorError(
            "workspace-dirty",
            "Workspace has uncommitted changes",
          );
        }

        // Step 8: Dry-run patch apply
        const { spawn } = await import("node:child_process");
        const dryRun = spawn(
          GIT_EXECUTABLE,
          ["-C", options.workspaceRoot, ...CLOSED_GIT_CONFIG_ARGUMENTS, "apply", "--check"],
          {
            env: environment,
            timeout: GIT_TIMEOUT_MS,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        dryRun.stdin.write(patchContent);
        dryRun.stdin.end();
        await new Promise<void>((resolve, reject) => {
          dryRun.on("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new ArtifactWorkspaceApplicatorError(
                  "patch-conflict",
                  "Patch dry-run failed - conflicts detected",
                ),
              );
            }
          });
          dryRun.on("error", reject);
        });
      },
    );
  } catch (error) {
    if (error instanceof ArtifactWorkspaceApplicatorError) {
      await persistPreflightFailure(error);
      throw error;
    }
    throw new ArtifactWorkspaceApplicatorError(
      "workspace-grant-invalid",
      "Destination repository configuration is not safe for artifact apply",
      { cause: error },
    );
  }

  // Step 9: Request approval
  // An approval is one-shot, so every retry needs a fresh request identity. Artifact, task,
  // workspace and patch identity remain explicit in the operation and delivery record; a UUID keeps
  // this identifier bounded even when the Artifact identifier already uses its full allowed length.
  const requestId = toolRequestId(`request-artifact-apply-${randomUUID()}`);
  const inputRef = toolInputReference(`artifact-apply-input-${options.artifactId}`);
  const requestedAt = options.clock.now();
  instant(requestedAt);

  const operation = Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    requestId,
    workspaceId: options.grant.workspaceId,
    taskId: delivery.taskId,
    sessionId: delivery.sessionId ?? sessionId("session-artifact-applicator"),
    workerId: workerId("worker-artifact-applicator"),
    toolId: ARTIFACT_APPLY_TOOL_ID,
    inputRef,
    action: "artifact.apply",
    resourceKind: "repository",
    summary: buildArtifactApplyApprovalSummary(delivery),
    credentialRefs: Object.freeze([]),
    requestedAt,
  } satisfies ProtectedOperation);

  // Update delivery state to "applying"
  const applyingDelivery = normalizeArtifactDeliveryRecord({
    ...delivery,
    state: "applying",
    destinationGrantId: options.grant.grantId,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    updatedAt: options.clock.now(),
  });
  await options.persistence.persistArtifactDelivery(applyingDelivery);

  // Every outcome after the destination is bound keeps naming the workspace the attempt targeted, so
  // a retained Artifact can still be explained against the repository it was aimed at.
  const persistOutcome = async (outcome: {
    readonly state: ArtifactDeliveryState;
    readonly approvalId?: ApprovalId;
    readonly failureCode?: ArtifactDeliveryFailureCode;
    readonly failureMessage?: string;
  }): Promise<void> => {
    const record = normalizeArtifactDeliveryRecord({
      ...applyingDelivery,
      state: outcome.state,
      destinationGrantId: options.grant.grantId,
      approvalId: outcome.approvalId ?? applyingDelivery.approvalId,
      failureCode: outcome.failureCode ?? null,
      failureMessage: outcome.failureMessage ?? null,
      updatedAt: options.clock.now(),
    });
    await options.persistence.persistArtifactDelivery(record);
  };

  // An attempt that never reached a user decision ends `cancelled` rather than reverting to
  // `pending`: an in-flight attempt cannot legally un-attempt itself, and `cancelled` is the
  // retryable terminal state, so the next attempt still starts cleanly. No failure code is
  // recorded, because nothing about the delivery itself failed.
  const cancelUnattempted = async (): Promise<void> => {
    await persistOutcome({ state: "cancelled" });
  };

  let gatewayResult;
  try {
    gatewayResult = await options.toolGateway.invoke(operation, undefined, {
      signal: options.signal,
    });
  } catch (error) {
    // No approval was ever created, so no write was ever authorized.
    await cancelUnattempted();
    throw new ArtifactWorkspaceApplicatorError(
      "approval-failed",
      "Artifact apply approval could not be created",
      { cause: error },
    );
  }

  if (gatewayResult.status !== "approval-required") {
    // The gateway did not gate the write behind a user decision, so no write may proceed.
    await cancelUnattempted();
    throw new ArtifactWorkspaceApplicatorError(
      "approval-failed",
      "Artifact apply must require user approval",
    );
  }

  const approvalId = gatewayResult.approval.approvalId;

  // The approval is durably named before the decision is awaited, so a crash while waiting leaves a
  // record that says which approval this attempt is blocked on rather than an unattributable state.
  await persistOutcome({ state: "applying", approvalId });

  // Wait for the user's decision. The waiter is injected, so no wall-clock read happens here.
  let resolvedApproval: ApprovalRequestSnapshot;
  try {
    resolvedApproval = await options.awaitApprovalDecision(approvalId, options.signal);
    if (
      resolvedApproval.approvalId !== approvalId ||
      resolvedApproval.state === "pending" ||
      !isDeepStrictEqual(resolvedApproval.operation, operation)
    ) {
      throw new Error("Apply approval decision did not match the requested operation");
    }
  } catch (error) {
    // Cancelled by timeout or abort. No write was attempted, so no failure code is recorded.
    await persistOutcome({ state: "cancelled" });
    throw new ArtifactWorkspaceApplicatorError(
      "approval-failed",
      "Artifact apply approval decision failed",
      { cause: error },
    );
  }

  if (resolvedApproval.state !== "approved") {
    // The user declined the write, which is a normal outcome rather than a delivery failure. The
    // decided approval is recorded so the refusal stays attributable after a restart.
    await persistOutcome({ state: "cancelled", approvalId });
    throw new ArtifactWorkspaceApplicatorError(
      "approval-failed",
      `Artifact apply was ${resolvedApproval.state} by user`,
    );
  }

  // Step 10: Take the repository lock before re-verifying, so no other attempt can move HEAD or
  // dirty the tree between the checks below and the write they authorize.
  let lock: WorkspaceRepositoryLock;
  try {
    lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: binding.gitDirectory,
      clock: options.clock,
      holder: `artifact-apply:${options.artifactId}`,
    });
  } catch (error) {
    await persistOutcome({
      state: "failed",
      approvalId,
      failureCode: "lock-unavailable",
      failureMessage: "The repository was locked by another apply attempt",
    });
    throw new ArtifactWorkspaceApplicatorError(
      "lock-unavailable",
      "Repository apply lock is unavailable",
      { cause: error },
    );
  }

  try {
    return await applyUnderLock(applyingDelivery);
  } finally {
    await lock.release();
  }

  // Everything that touches the working tree runs inside the lock, so the post-approval checks and
  // the write they authorize cannot be separated by another attempt. The delivery is passed in
  // because a hoisted declaration cannot see the null check that proved it present.
  async function applyUnderLock(
    delivery: ArtifactDeliveryRecord,
  ): Promise<ArtifactWorkspaceApplyResult> {
    try {
      return await withRepositoryConfigurationLocks(
        binding.gitCommonDirectory,
        binding.gitDirectory,
        async () => {
          try {
            await requireClosedRepositoryConfiguration(options.workspaceRoot, environment);
          } catch (error) {
            await persistOutcome({
              state: "failed",
              approvalId,
              failureCode: "workspace-grant-invalid",
              failureMessage: "Repository configuration changed after approval",
            });
            throw new ArtifactWorkspaceApplicatorError(
              "workspace-grant-invalid",
              "Repository configuration is not safe after approval",
              { cause: error },
            );
          }
          return applyWithClosedRepositoryConfiguration(delivery);
        },
      );
    } catch (error) {
      if (error instanceof ArtifactWorkspaceApplicatorError) {
        throw error;
      }
      await persistOutcome({
        state: "failed",
        approvalId,
        failureCode: "workspace-grant-invalid",
        failureMessage: "Repository configuration could not be locked after approval",
      });
      throw new ArtifactWorkspaceApplicatorError(
        "workspace-grant-invalid",
        "Repository configuration could not be locked after approval",
        { cause: error },
      );
    }
  }

  async function applyWithClosedRepositoryConfiguration(
    delivery: ArtifactDeliveryRecord,
  ): Promise<ArtifactWorkspaceApplyResult> {
    // The binding is checked again because the approved path is one the user can move, relink or
    // replace while the approval is pending.
    try {
      await assertWorkspaceGitBindingUnchanged(binding);
      await assertPrimaryWorkspaceGitDirectory(binding);
    } catch (error) {
      await persistOutcome({
        state: "failed",
        approvalId,
        failureCode: "workspace-grant-invalid",
        failureMessage: "Workspace Git binding changed after approval",
      });
      throw new ArtifactWorkspaceApplicatorError(
        "workspace-grant-invalid",
        "Workspace Git binding changed between approval and apply",
        { cause: error },
      );
    }

    const finalHead = (
      await runGit(options.workspaceRoot, environment, "rev-parse", "--verify", "HEAD^{commit}")
    ).trim();
    if (finalHead !== delivery.baseCommit) {
      await persistOutcome({
        state: "failed",
        approvalId,
        failureCode: "head-drift",
        failureMessage: "Workspace HEAD moved after approval",
      });
      throw new ArtifactWorkspaceApplicatorError(
        "head-drift",
        "Workspace HEAD moved between approval and apply",
      );
    }

    const finalStatus = await workspaceStatus(options.workspaceRoot, environment);
    if (finalStatus.trim().length > 0) {
      await persistOutcome({
        state: "failed",
        approvalId,
        failureCode: "workspace-dirty",
        failureMessage: "Workspace became dirty after approval",
      });
      throw new ArtifactWorkspaceApplicatorError(
        "workspace-dirty",
        "Workspace has uncommitted changes after approval",
      );
    }

    // Apply patch
    try {
      const { spawn } = await import("node:child_process");
      const apply = spawn(
        GIT_EXECUTABLE,
        ["-C", options.workspaceRoot, ...CLOSED_GIT_CONFIG_ARGUMENTS, "apply"],
        {
          env: environment,
          timeout: GIT_TIMEOUT_MS,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      apply.stdin.write(patchContent);
      apply.stdin.end();
      await new Promise<void>((resolve, reject) => {
        apply.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new ArtifactWorkspaceApplicatorError(
                "apply-failed",
                "Patch apply failed after approval",
              ),
            );
          }
        });
        apply.on("error", reject);
      });
    } catch (error) {
      // The applicator error set is wider than the durable failure set, so an unmapped code degrades to
      // apply-failed rather than being cast into a record the delivery contract would reject.
      const failureCode: ArtifactDeliveryFailureCode =
        error instanceof ArtifactWorkspaceApplicatorError &&
        ARTIFACT_DELIVERY_FAILURE_CODES.includes(error.code as ArtifactDeliveryFailureCode)
          ? (error.code as ArtifactDeliveryFailureCode)
          : "apply-failed";
      await persistOutcome({
        state: "failed",
        approvalId,
        failureCode,
        failureMessage: error instanceof Error ? error.message : "Patch apply failed",
      });
      if (error instanceof ArtifactWorkspaceApplicatorError) {
        throw error;
      }
      throw new ArtifactWorkspaceApplicatorError(
        "apply-failed",
        "Patch apply failed after approval",
        { cause: error },
      );
    }

    // The patch is written to the working tree and left uncommitted, so HEAD is expected to still be
    // the base commit. Recording it names the destination state the write was verified against.
    const verifiedHead = (
      await runGit(options.workspaceRoot, environment, "rev-parse", "--verify", "HEAD^{commit}")
    ).trim();

    const appliedDelivery = normalizeArtifactDeliveryRecord({
      ...delivery,
      state: "applied",
      destinationGrantId: options.grant.grantId,
      approvalId,
      verifiedHead,
      updatedAt: options.clock.now(),
    });
    await options.persistence.persistArtifactDelivery(appliedDelivery);

    return Object.freeze({
      verifiedHead,
    });
  }
}
