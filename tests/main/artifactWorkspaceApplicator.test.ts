import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  PRIVILEGED_CONTRACT_VERSION,
  approvalId,
  auditRecordId,
  artifactId,
  authorizationGrantId,
  instant,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  sessionId,
  taskId,
  workspaceGrantId,
  workspaceId,
  type ApprovalRequestSnapshot,
  type ArtifactDeliveryRecord,
  type ArtifactId,
  type PrivilegedClock,
  type ToolGateway,
  type WorkspaceGrant,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
} from "../../apps/desktop/src/core";
import { InMemoryApprovalService } from "../../apps/desktop/src/main/privileged/inMemoryApprovalService";
import { InMemoryAuditTrail } from "../../apps/desktop/src/main/privileged/inMemoryAuditTrail";
import {
  ArtifactDeliveryService,
  type ArtifactDeliveryServiceConfig,
} from "../../apps/desktop/src/main/workers/artifactDeliveryService";
import {
  ArtifactWorkspaceApplicatorError,
  applyArtifactToWorkspace,
} from "../../apps/desktop/src/main/workers/artifactWorkspaceApplicator";

const run = promisify(execFile);

const ARTIFACT = artifactId("artifact-apply-proof");
const WORKSPACE = workspaceId("workspace-apply-proof");
const TASK = taskId("task-apply-proof");
const APPROVAL = approvalId("approval-apply-proof");
const PATCH_OWNER_GRANT = "grant-isolated-worktree";
const DESTINATION_GRANT = "grant-original-workspace";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

/** A real repository, because every fail-closed claim here is about what Git actually reports. */
async function createRepository(): Promise<{ root: string; head: string }> {
  // Canonicalized because macOS resolves the temp directory through /private, and a real workspace
  // grant always names the canonical root that Git itself reports.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "actestra-apply-")));
  roots.push(root);
  const git = (...args: string[]): Promise<unknown> => run("/usr/bin/git", ["-C", root, ...args]);
  await git("init", "--initial-branch=main");
  await git("config", "user.email", "proof@actestra.test");
  await git("config", "user.name", "Actestra Proof");
  await writeFile(path.join(root, "tracked.txt"), "original\n", "utf8");
  // A second tracked file, so a patch can be proven to touch neither file when one hunk fails.
  await writeFile(path.join(root, "second.txt"), "second\n", "utf8");
  await git("add", ".");
  await git("commit", "--no-gpg-sign", "-m", "base");
  const { stdout } = await run("/usr/bin/git", ["-C", root, "rev-parse", "HEAD"]);
  return { root, head: stdout.trim() };
}

const PATCH = `diff --git a/tracked.txt b/tracked.txt
index 7bfc4eb..a1b2c3d 100644
--- a/tracked.txt
+++ b/tracked.txt
@@ -1 +1 @@
-original
+applied by actestra
`;

const CREATED_AT = instant("2026-08-11T00:00:00.000Z");

/**
 * Advances monotonically from after `CREATED_AT`, because the delivery contract rejects an update
 * that appears to precede the record it updates.
 */
function clock(): PrivilegedClock {
  let tick = 1;
  return {
    now: () => instant(new Date(Date.parse(CREATED_AT) + tick++ * 1_000).toISOString()),
  };
}

class MutableClock implements PrivilegedClock {
  constructor(private current = instant("2026-08-11T00:01:00.000Z")) {}

  now() {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = instant(new Date(Date.parse(this.current) + milliseconds).toISOString());
  }
}

function delivery(overrides: Partial<ArtifactDeliveryRecord> = {}): ArtifactDeliveryRecord {
  return {
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    artifactId: ARTIFACT,
    workspaceId: WORKSPACE,
    destinationWorkspaceId: null,
    taskId: TASK,
    sessionId: sessionId("session-apply-proof"),
    state: "pending",
    patchOwnerGrantId: PATCH_OWNER_GRANT,
    patchOwnerWorkerId: "worker-apply-proof",
    patchRequestId: "request-coding-publish-proof",
    destinationGrantId: null,
    patchReference: "tool-input-patch",
    patchSha256: createHash("sha256").update(PATCH, "utf8").digest("hex"),
    patchByteLength: Buffer.byteLength(PATCH, "utf8"),
    baseCommit: "0".repeat(40),
    changedFileCount: 1,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    createdAt: instant("2026-08-11T00:00:00.000Z"),
    updatedAt: instant("2026-08-11T00:00:00.000Z"),
    ...overrides,
  };
}

function grant(root: string, overrides: Partial<WorkspaceGrant> = {}): WorkspaceGrant {
  return {
    grantId: DESTINATION_GRANT,
    workspaceId: WORKSPACE,
    rootPath: root,
    state: "active",
    ...overrides,
  } as WorkspaceGrant;
}

interface Harness {
  readonly persisted: ArtifactDeliveryRecord[];
  /** The operation the gateway was asked to authorize, so a decision can echo it back verbatim. */
  readonly requestedOperation: () => unknown;
  readonly gateway: ToolGateway;
  readonly persistence: Parameters<typeof applyArtifactToWorkspace>[0]["persistence"];
}

function harness(record: ArtifactDeliveryRecord, patch = PATCH): Harness {
  const persisted: ArtifactDeliveryRecord[] = [];
  let current = record;
  const persistence = {
    loadDomainGraph: async () => ({
      artifacts: [{ id: ARTIFACT, workspaceId: WORKSPACE, taskId: TASK, label: "patch" }],
    }),
    getArtifactDelivery: async () => current,
    persistArtifactDelivery: async (next: ArtifactDeliveryRecord) => {
      persisted.push(next);
      current = next;
    },
    // The applicator asserts the full resolved-reference contract, so the double has to satisfy it
    // rather than hand back a shape that would degrade every failure into `patch-unavailable`.
    resolveContentReference: async (input: { readonly owner: unknown }) => ({
      metadata: {
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: record.patchReference,
        kind: "tool-input",
        owner: input.owner,
        classification: "task-content",
        mediaType: "text/plain; charset=utf-8",
        byteLength: Buffer.byteLength(patch, "utf8"),
        sha256: createHash("sha256").update(patch, "utf8").digest("hex"),
        createdAt: instant("2026-08-11T00:00:00.000Z"),
      },
      content: patch,
    }),
  };
  let requested: unknown;
  const gateway = {
    invoke: async (operation: unknown) => {
      requested = operation;
      return {
        status: "approval-required" as const,
        decision: { effect: "require-approval" },
        approval: { approvalId: APPROVAL, operation },
      };
    },
  };
  return {
    persisted,
    requestedOperation: () => requested,
    gateway: gateway as unknown as ToolGateway,
    persistence: persistence as unknown as Harness["persistence"],
  };
}

function approved(operation: unknown, state = "approved"): ApprovalRequestSnapshot {
  return {
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    approvalId: APPROVAL,
    operation,
    state,
  } as unknown as ApprovalRequestSnapshot;
}

async function apply(options: {
  readonly root: string;
  readonly record: ArtifactDeliveryRecord;
  readonly decision?: (operation: unknown) => ApprovalRequestSnapshot;
  readonly patch?: string;
  readonly destination?: WorkspaceGrant;
  readonly artifact?: ArtifactId;
}): Promise<{
  result?: { verifiedHead: string };
  error?: unknown;
  persisted: ArtifactDeliveryRecord[];
}> {
  const bench = harness(options.record, options.patch);
  try {
    const result = await applyArtifactToWorkspace({
      artifactId: options.artifact ?? ARTIFACT,
      workspaceRoot: options.root,
      grant: options.destination ?? grant(options.root),
      persistence: bench.persistence,
      clock: clock(),
      toolGateway: bench.gateway,
      awaitApprovalDecision: async () =>
        (options.decision ?? ((operation: unknown) => approved(operation)))(
          bench.requestedOperation(),
        ),
      signal: new AbortController().signal,
    });
    return { result, persisted: bench.persisted };
  } catch (error) {
    return { error, persisted: bench.persisted };
  }
}

describe("applyArtifactToWorkspace", () => {
  it("writes the patch into the original workspace only after the user approves", async () => {
    const repository = await createRepository();
    const { result, error, persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
    });

    expect(error).toBeUndefined();
    expect(result?.verifiedHead).toBe(repository.head);
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe(
      "applied by actestra\n",
    );
    // `git apply` writes the working tree without committing, so the verified head is the base.
    const applied = persisted.at(-1);
    expect(applied?.state).toBe("applied");
    expect(applied?.verifiedHead).toBe(repository.head);
    expect(applied?.destinationGrantId).toBe(DESTINATION_GRANT);
    expect(applied?.approvalId).toBe(APPROVAL);
    expect(applied?.failureCode).toBeNull();
  });

  it("records the approval it is blocked on before awaiting the decision", async () => {
    const repository = await createRepository();
    const { persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
    });

    const applying = persisted.filter(({ state }) => state === "applying");
    expect(applying).toHaveLength(2);
    expect(applying[0]?.approvalId).toBeNull();
    // A crash while waiting still leaves a record naming which approval this attempt awaits.
    expect(applying[1]?.approvalId).toBe(APPROVAL);
  });

  it("settles an expired approval so the delivery cannot remain applying forever", async () => {
    const repository = await createRepository();
    const bench = harness(delivery({ baseCommit: repository.head }));
    const now = new MutableClock();
    let auditSequence = 0;
    let approvalSequence = 0;
    const auditTrail = new InMemoryAuditTrail(now, () =>
      auditRecordId(`audit-artifact-expiry-${String(++auditSequence)}`),
    );
    const approvalService = new InMemoryApprovalService({
      clock: now,
      auditTrail,
      ttlMs: 1_000,
      newApprovalId: () => approvalId(`approval-artifact-expiry-${String(++approvalSequence)}`),
      newGrantId: () => authorizationGrantId("authorization-artifact-expiry"),
    });
    let decisionSequence = 0;
    const gateway = {
      invoke: async (operation: Parameters<ToolGateway["invoke"]>[0]) => {
        const decision = {
          decisionId: policyDecisionId(
            `policy-decision-artifact-expiry-${String(++decisionSequence)}`,
          ),
          policyRevision: policyRevision("policy-artifact-expiry-v1"),
          requestId: operation.requestId,
          effect: "require-approval" as const,
          reasonCode: "matching-rule-approval" as const,
          matchedRuleIds: [policyRuleId("rule-artifact-expiry")],
          evaluatedAt: now.now(),
        };
        const authorization = await approvalService.authorize(operation, decision);
        if (authorization.status !== "approval-required") {
          throw new Error("Expected the real approval service to require approval");
        }
        return {
          status: "approval-required" as const,
          decision,
          approval: authorization.approval,
        };
      },
    };
    const service = new ArtifactDeliveryService({
      persistence: bench.persistence as ArtifactDeliveryServiceConfig["persistence"],
      clock: now,
      platform: {
        approvalService,
        toolGateway: gateway as ToolGateway,
      } as never,
    });
    const request = await service.requestApply({
      artifactId: ARTIFACT,
      destinationGrant: grant(repository.root),
      signal: new AbortController().signal,
    });
    const completion = request.completion.then(
      () => ({ status: "resolved" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );

    now.advance(1_000);
    await expect(service.resolveApply(request.approvalId, "approved")).rejects.toMatchObject({
      code: "approval-expired",
    });

    const outcome = await Promise.race([
      completion,
      new Promise<{ readonly status: "pending" }>((resolve) =>
        setTimeout(() => resolve({ status: "pending" }), 50),
      ),
    ]);
    expect(outcome.status).toBe("rejected");
    expect(bench.persisted.at(-1)).toMatchObject({
      state: "cancelled",
      approvalId: request.approvalId,
    });
    expect(service.pendingApprovals()).toEqual([]);
    expect(service.inFlightApply(ARTIFACT)).toBeUndefined();
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");

    const retryController = new AbortController();
    now.advance(1);
    const retry = await service.requestApply({
      artifactId: ARTIFACT,
      destinationGrant: grant(repository.root),
      signal: retryController.signal,
    });
    expect(retry.approvalId).not.toBe(request.approvalId);
    await expect(approvalService.get(retry.approvalId)).resolves.toMatchObject({
      state: "pending",
    });
    retryController.abort();
    await expect(retry.completion).rejects.toMatchObject({ code: "approval-failed" });
  });

  it("leaves the workspace untouched when the user denies the apply", async () => {
    const repository = await createRepository();
    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
      decision: (operation) => approved(operation, "denied"),
    });

    expect(error).toBeInstanceOf(ArtifactWorkspaceApplicatorError);
    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("approval-failed");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    const last = persisted.at(-1);
    expect(last?.state).toBe("cancelled");
    expect(last?.approvalId).toBe(APPROVAL);
  });

  it("refuses a dirty workspace without stashing or overwriting the user's work", async () => {
    const repository = await createRepository();
    await writeFile(path.join(repository.root, "tracked.txt"), "user work in progress\n", "utf8");

    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-dirty");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe(
      "user work in progress\n",
    );
    // The refusal happens before the destination is bound, so nothing is persisted at all.
    expect(persisted).toHaveLength(0);
  });

  it("does not treat Actestra-owned task output as user workspace dirt", async () => {
    const repository = await createRepository();
    const taskOutput = path.join(
      repository.root,
      ".actestra",
      "task-output",
      "task-general-proof",
      "draft.md",
    );
    await mkdir(path.dirname(taskOutput), { recursive: true });
    await writeFile(taskOutput, "General output owned by Actestra\n", "utf8");

    const { result, error } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
    });

    expect(error).toBeUndefined();
    expect(result?.verifiedHead).toBe(repository.head);
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe(
      "applied by actestra\n",
    );
    expect(await readFile(taskOutput, "utf8")).toBe("General output owned by Actestra\n");
  });

  it("still refuses unrelated untracked files inside the Actestra metadata root", async () => {
    const repository = await createRepository();
    const unrelated = path.join(repository.root, ".actestra", "user-note.txt");
    await mkdir(path.dirname(unrelated), { recursive: true });
    await writeFile(unrelated, "user-owned work\n", "utf8");

    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-dirty");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(persisted).toHaveLength(0);
  });

  it("refuses when HEAD has moved since the patch was produced", async () => {
    const repository = await createRepository();
    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: "1".repeat(40) }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("head-drift");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(persisted).toHaveLength(0);
  });

  it("refuses a conflicting patch at dry-run, before any approval is requested", async () => {
    const repository = await createRepository();
    const conflicting = PATCH.replace("-original", "-something else entirely");
    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({
        baseCommit: repository.head,
        patchSha256: createHash("sha256").update(conflicting, "utf8").digest("hex"),
        patchByteLength: Buffer.byteLength(conflicting, "utf8"),
      }),
      patch: conflicting,
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("patch-conflict");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(persisted).toHaveLength(0);
  });

  it("writes no file at all when one file in a multi-file patch conflicts", async () => {
    const repository = await createRepository();
    // The first hunk applies cleanly and the second cannot. A partial write would leave
    // tracked.txt modified, which is the failure mode this proof exists to rule out.
    const partial = `${PATCH}diff --git a/second.txt b/second.txt
index 9c2a7f1..b3c4d5e 100644
--- a/second.txt
+++ b/second.txt
@@ -1 +1 @@
-not what is on disk
+partially applied
`;
    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({
        baseCommit: repository.head,
        patchSha256: createHash("sha256").update(partial, "utf8").digest("hex"),
        patchByteLength: Buffer.byteLength(partial, "utf8"),
        changedFileCount: 2,
      }),
      patch: partial,
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("patch-conflict");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(await readFile(path.join(repository.root, "second.txt"), "utf8")).toBe("second\n");
    expect(persisted).toHaveLength(0);
  });

  it("refuses patch content that does not match the recorded digest", async () => {
    const repository = await createRepository();
    const { error } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head, patchSha256: "f".repeat(64) }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("patch-digest-mismatch");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
  });

  it("refuses the isolated worktree grant as the destination authority", async () => {
    const repository = await createRepository();
    const { error } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
      destination: grant(repository.root, { grantId: workspaceGrantId(PATCH_OWNER_GRANT) }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-grant-invalid");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
  });

  it("refuses a revoked destination grant", async () => {
    const repository = await createRepository();
    const { error } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
      destination: grant(repository.root, { state: "revoked" } as Partial<WorkspaceGrant>),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-grant-invalid");
  });

  it("refuses a destination bound to a different grant than the delivery already names", async () => {
    const repository = await createRepository();
    const { error } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head, destinationGrantId: "grant-somewhere-else" }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-grant-invalid");
  });

  it("refuses a linked worktree destination, so the original checkout is the only target", async () => {
    const repository = await createRepository();
    const linked = path.join(path.dirname(repository.root), `${path.basename(repository.root)}-wt`);
    roots.push(linked);
    await run("/usr/bin/git", ["-C", repository.root, "worktree", "add", linked, "-b", "isolated"]);

    const { error } = await apply({
      root: linked,
      record: delivery({ baseCommit: repository.head }),
      destination: grant(linked),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-grant-invalid");
    expect(await readFile(path.join(linked, "tracked.txt"), "utf8")).toBe("original\n");
  });

  // A subdirectory resolves cleanly and is genuinely inside the repository, so path canonicalization
  // alone accepts it. Only Git can report that it is not the top level the grant admitted.
  it("refuses a subdirectory of the repository, which realpath alone would accept", async () => {
    const repository = await createRepository();
    const nested = path.join(repository.root, "nested");
    await mkdir(nested, { recursive: true });

    const { error } = await apply({
      root: nested,
      record: delivery({ baseCommit: repository.head }),
      destination: grant(nested),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-grant-invalid");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
  });

  it("refuses a destination that is not a Git working tree", async () => {
    const plain = await mkdtemp(path.join(tmpdir(), "actestra-plain-"));
    roots.push(plain);
    const { error } = await apply({
      root: plain,
      record: delivery(),
      destination: grant(plain),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("workspace-grant-invalid");
  });

  it("refuses a second write once the delivery is applied", async () => {
    const repository = await createRepository();
    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({
        baseCommit: repository.head,
        state: "applied",
        destinationGrantId: DESTINATION_GRANT,
        approvalId: APPROVAL,
        verifiedHead: repository.head,
      }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("already-applied");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(persisted).toHaveLength(0);
  });

  it("refuses an attempt while another is still in flight", async () => {
    const repository = await createRepository();
    const { error } = await apply({
      root: repository.root,
      record: delivery({
        baseCommit: repository.head,
        state: "applying",
        destinationGrantId: DESTINATION_GRANT,
        approvalId: APPROVAL,
      }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("apply-in-progress");
  });

  it("refuses a decision snapshot that does not match the requested operation", async () => {
    const repository = await createRepository();
    const { error, persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
      decision: () => approved({ tampered: true }),
    });

    expect((error as ArtifactWorkspaceApplicatorError).code).toBe("approval-failed");
    expect(await readFile(path.join(repository.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(persisted.at(-1)?.state).toBe("cancelled");
  });

  it("keeps the artifact and stays retryable after a failure", async () => {
    const repository = await createRepository();
    const { persisted } = await apply({
      root: repository.root,
      record: delivery({ baseCommit: repository.head }),
      decision: (operation) => approved(operation, "expired"),
    });

    // A cancelled delivery is terminal but retryable, and no failure code is invented for a
    // decision that never authorized a write.
    const last = persisted.at(-1);
    expect(last?.state).toBe("cancelled");
    expect(last?.patchReference).toBe("tool-input-patch");
    expect(last?.failureCode).toBeNull();
  });
});
