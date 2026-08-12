import { describe, expect, it } from "vitest";
import * as core from "../../apps/desktop/src/core";
import type { ArtifactDeliveryRecord } from "../../apps/desktop/src/core";

const PATCH_SHA = "a".repeat(64);
const BASE_COMMIT = "b".repeat(40);
const VERIFIED_HEAD = BASE_COMMIT;
const PATCH_OWNER_GRANT = "grant-isolated-worktree-1";
const DESTINATION_GRANT = "grant-original-workspace-1";

const PENDING = {
  contractVersion: 2,
  artifactId: "artifact-coding-1",
  workspaceId: "workspace-1",
  destinationWorkspaceId: null,
  taskId: "task-1",
  sessionId: "session-1",
  state: "pending",
  patchOwnerGrantId: PATCH_OWNER_GRANT,
  patchOwnerWorkerId: "worker-aionui-coding-1",
  patchRequestId: "request-coding-publish-1",
  destinationGrantId: null,
  patchReference: "coding-publish-patch-1",
  patchSha256: PATCH_SHA,
  patchByteLength: 512,
  baseCommit: BASE_COMMIT,
  changedFileCount: 3,
  approvalId: null,
  verifiedHead: null,
  failureCode: null,
  failureMessage: null,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
} as const;

const APPLIED = {
  ...PENDING,
  state: "applied",
  destinationGrantId: DESTINATION_GRANT,
  approvalId: "approval-1",
  verifiedHead: VERIFIED_HEAD,
  updatedAt: "2026-08-11T00:05:00.000Z",
} as const;

function reject(record: unknown, because: string): void {
  expect(() => core.normalizeArtifactDeliveryRecord(record), because).toThrowError(
    core.CoreContractError,
  );
}

describe("Artifact workspace delivery contract", () => {
  it("separates applying a patch from publishing one", () => {
    expect(core.ARTIFACT_DELIVERY_TOOL_ID).toBe("actestra.coding.artifact-apply");
    expect(core.ARTIFACT_DELIVERY_TOOL_ID).not.toBe(core.CODING_ARTIFACT_PUBLISH_TOOL_ID);
  });

  it("normalizes a pending delivery that carries a patch reference rather than patch content", () => {
    const delivery: ArtifactDeliveryRecord = core.normalizeArtifactDeliveryRecord(PENDING);

    expect(delivery.state).toBe("pending");
    expect(delivery.patchReference).toBe("coding-publish-patch-1");
    expect(delivery.patchSha256).toBe(PATCH_SHA);
    expect(Object.isFrozen(delivery)).toBe(true);
    // The durable record never carries patch text or an isolated worktree path.
    expect(Object.keys(delivery)).not.toContain("patch");
    expect(Object.keys(delivery)).not.toContain("worktreeRoot");
  });

  it("requires an apply approval and a verified destination head before a delivery counts as applied", () => {
    reject({ ...APPLIED, verifiedHead: null }, "applied without a verified destination head");
    reject({ ...APPLIED, approvalId: null }, "applied without its own apply approval");
    reject({ ...PENDING, verifiedHead: VERIFIED_HEAD }, "pending cannot carry a verified head");
    reject({ ...PENDING, approvalId: "approval-1" }, "pending has no apply approval yet");

    const applied = core.normalizeArtifactDeliveryRecord(APPLIED);
    expect(applied.verifiedHead).toBe(VERIFIED_HEAD);
    expect(applied.approvalId).toBe("approval-1");
    // `git apply` writes the working tree without committing, so the verified head is still the
    // base commit. The record must never be read as Actestra having created a commit.
    expect(applied.verifiedHead).toBe(applied.baseCommit);
  });

  it("keeps the isolated patch owner and the destination workspace as two distinct authorities", () => {
    reject(
      { ...PENDING, destinationGrantId: DESTINATION_GRANT },
      "pending has no destination authority yet",
    );
    reject(
      { ...APPLIED, destinationGrantId: null },
      "applied without the destination authority it wrote into",
    );
    reject(
      { ...APPLIED, destinationGrantId: PATCH_OWNER_GRANT },
      "the isolated worktree grant cannot also be the destination",
    );
    reject(
      { ...PENDING, state: "applying", destinationGrantId: "x".repeat(257) },
      "unbounded destination grant",
    );

    const applying = core.normalizeArtifactDeliveryRecord({
      ...PENDING,
      state: "applying",
      destinationGrantId: DESTINATION_GRANT,
    });
    expect(applying.patchOwnerGrantId).toBe(PATCH_OWNER_GRANT);
    expect(applying.destinationGrantId).toBe(DESTINATION_GRANT);
    expect(applying.destinationGrantId).not.toBe(applying.patchOwnerGrantId);
  });

  it("keeps fail-closed outcomes explainable with a closed failure code", () => {
    reject({ ...PENDING, state: "conflict" }, "conflict without a failure code");
    reject({ ...PENDING, state: "failed" }, "failed without a failure code");
    reject({ ...PENDING, failureCode: "workspace-dirty" }, "pending cannot carry a failure code");
    reject({ ...PENDING, state: "failed", failureCode: "disk-full" }, "undeclared failure code");
    reject(
      { ...PENDING, failureMessage: "workspace has local edits" },
      "message without a failure code",
    );

    for (const failureCode of core.ARTIFACT_DELIVERY_FAILURE_CODES) {
      const failed = core.normalizeArtifactDeliveryRecord({
        ...PENDING,
        state: "failed",
        failureCode,
        failureMessage: "The original workspace was left unchanged.",
      });
      expect(failed.failureCode).toBe(failureCode);
      expect(failed.verifiedHead).toBeNull();
    }
    expect(core.ARTIFACT_DELIVERY_FAILURE_CODES).toContain("workspace-dirty");
    expect(core.ARTIFACT_DELIVERY_FAILURE_CODES).toContain("head-drift");
    expect(core.ARTIFACT_DELIVERY_FAILURE_CODES).toContain("patch-conflict");
  });

  it("rejects unbounded, undeclared, or malformed delivery evidence", () => {
    reject({ ...PENDING, contractVersion: 1 }, "superseded contract version");
    reject({ ...PENDING, contractVersion: 3 }, "unknown contract version");
    reject({ ...PENDING, state: "delivered" }, "undeclared state");
    reject({ ...PENDING, extra: true }, "undeclared key");
    reject({ ...PENDING, patchSha256: "A".repeat(64) }, "uppercase digest");
    reject({ ...PENDING, patchSha256: "abc" }, "short digest");
    reject({ ...PENDING, baseCommit: "b".repeat(7) }, "abbreviated base commit");
    reject({ ...PENDING, patchByteLength: 0 }, "empty patch");
    reject({ ...PENDING, changedFileCount: -1 }, "negative file count");
    reject({ ...PENDING, patchReference: "x".repeat(513) }, "unbounded patch reference");
    reject(
      {
        ...PENDING,
        state: "failed",
        failureCode: "apply-failed",
        failureMessage: "x".repeat(1025),
      },
      "unbounded failure message",
    );
    reject({ ...PENDING, updatedAt: "2026-08-10T23:59:59.000Z" }, "update preceding creation");
  });

  it("keeps an applied delivery final and lets fail-closed outcomes be retried", () => {
    expect(core.isArtifactDeliveryTransitionLegal("pending", "applying")).toBe(true);
    expect(core.isArtifactDeliveryTransitionLegal("applying", "applied")).toBe(true);
    expect(core.isArtifactDeliveryTransitionLegal("applying", "conflict")).toBe(true);
    expect(core.isArtifactDeliveryTransitionLegal("pending", "applied")).toBe(false);
    expect(core.isArtifactDeliveryTransitionLegal("applied", "applying")).toBe(false);
    expect(core.isArtifactDeliveryTransitionLegal("conflict", "applying")).toBe(true);
    // An in-flight attempt may be refined so the approval it waits on becomes durable.
    expect(core.isArtifactDeliveryTransitionLegal("applying", "applying")).toBe(true);
    expect(core.isArtifactDeliveryTransitionLegal("applying", "pending")).toBe(false);

    expect(core.canRetryArtifactDelivery("conflict")).toBe(true);
    expect(core.canRetryArtifactDelivery("failed")).toBe(true);
    expect(core.canRetryArtifactDelivery("cancelled")).toBe(true);
    expect(core.canRetryArtifactDelivery("applied")).toBe(false);
    expect(core.canRetryArtifactDelivery("pending")).toBe(true);
  });

  it("states the apply approval as a workspace write, distinct from saving the Artifact", () => {
    const summary = core.buildArtifactApplyApprovalSummary(PENDING);

    expect(summary).toContain("original workspace");
    expect(summary).toContain("3 files");
    expect(summary).toContain(BASE_COMMIT.slice(0, 12));
    expect(summary).toContain("modifies the original workspace");
    expect(summary).toContain("not the same as");

    // The publish approval says it does NOT modify the workspace; the apply approval must never
    // reuse that reassurance, otherwise the two one-shot approvals read identically.
    expect(summary).not.toContain("does not modify the original workspace");
    expect(summary).not.toContain("Save the reviewed isolated coding patch");

    expect(core.buildArtifactApplyApprovalSummary({ ...PENDING, changedFileCount: 1 })).toContain(
      "1 file will be written",
    );
  });

  describe("restart recovery", () => {
    const RECOVERED_AT = "2026-08-11T01:00:00.000Z";
    const APPLYING_BEFORE_APPROVAL = core.normalizeArtifactDeliveryRecord({
      ...PENDING,
      state: "applying",
      destinationGrantId: DESTINATION_GRANT,
      updatedAt: "2026-08-11T00:01:00.000Z",
    });
    const APPLYING_WITH_APPROVAL = core.normalizeArtifactDeliveryRecord({
      ...APPLYING_BEFORE_APPROVAL,
      approvalId: "approval-1",
    });

    it("leaves every settled state untouched", () => {
      for (const state of ["pending", "applied", "cancelled"] as const) {
        const record =
          state === "pending"
            ? core.normalizeArtifactDeliveryRecord(PENDING)
            : state === "applied"
              ? core.normalizeArtifactDeliveryRecord(APPLIED)
              : core.normalizeArtifactDeliveryRecord({
                  ...PENDING,
                  state: "cancelled",
                  destinationGrantId: DESTINATION_GRANT,
                });

        expect(core.classifyArtifactDeliveryRecovery(record)).toMatchObject({ action: "none" });
        expect(core.recoverArtifactDeliveryRecord(record, core.instant(RECOVERED_AT))).toBeNull();
      }
    });

    it("cancels an attempt that died before any approval existed", () => {
      const action = core.classifyArtifactDeliveryRecovery(APPLYING_BEFORE_APPROVAL);
      expect(action).toMatchObject({ action: "cancel" });

      const recovered = core.recoverArtifactDeliveryRecord(
        APPLYING_BEFORE_APPROVAL,
        core.instant(RECOVERED_AT),
      );
      // No approval ever existed, so no write was authorized and nothing failed: `cancelled` is the
      // retryable terminal state and carries no failure code.
      expect(recovered).toMatchObject({
        state: "cancelled",
        failureCode: null,
        failureMessage: null,
        updatedAt: RECOVERED_AT,
      });
      expect(recovered?.patchSha256).toBe(PATCH_SHA);
      expect(recovered?.baseCommit).toBe(BASE_COMMIT);
    });

    it("fails an attempt that held an approval closed, never silently retrying it", () => {
      const action = core.classifyArtifactDeliveryRecovery(APPLYING_WITH_APPROVAL);
      expect(action).toMatchObject({ action: "fail-closed", failureCode: "apply-failed" });

      const recovered = core.recoverArtifactDeliveryRecord(
        APPLYING_WITH_APPROVAL,
        core.instant(RECOVERED_AT),
      );
      // A write may have landed. Recovery must not claim it did or did not, and must not re-apply.
      expect(recovered).toMatchObject({
        state: "failed",
        failureCode: "apply-failed",
        approvalId: "approval-1",
        destinationGrantId: DESTINATION_GRANT,
      });
      expect(recovered?.failureMessage).toContain("cannot be proven");
      // The patch survives the failure, so the user can apply again deliberately.
      expect(recovered?.patchReference).toBe(PENDING.patchReference);
      expect(recovered?.verifiedHead).toBeNull();
    });

    it("only ever produces a legal transition out of applying", () => {
      for (const record of [APPLYING_BEFORE_APPROVAL, APPLYING_WITH_APPROVAL]) {
        const recovered = core.recoverArtifactDeliveryRecord(record, core.instant(RECOVERED_AT));
        expect(recovered).not.toBeNull();
        expect(
          core.isArtifactDeliveryTransitionLegal(record.state, recovered?.state ?? "applying"),
        ).toBe(true);
      }
    });
  });
});
