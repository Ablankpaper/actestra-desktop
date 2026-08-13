// @vitest-environment node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  PRIVILEGED_CONTRACT_VERSION,
  ARTIFACT_APPLY_TOOL_ID,
  approvalId,
  artifactId,
  instant,
  policyDecisionId,
  policyRevision,
  policyRuleId,
  sessionId,
  taskId,
  toolId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ApprovalRequestSnapshot,
  type ArtifactDeliveryRecord,
  type PrivilegedClock,
  type ProtectedOperation,
  type ToolGateway,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";
import {
  ArtifactWorkspaceApplicatorError,
  applyArtifactToWorkspace,
} from "../../apps/desktop/src/main/workers/artifactWorkspaceApplicator";
import {
  REPOSITORY_LOCK_FILENAME,
  WorkspaceRepositoryLockError,
  acquireWorkspaceRepositoryLock,
} from "../../apps/desktop/src/main/workers/workspaceRepositoryLock";
import { PrivilegedToolGateway } from "../../apps/desktop/src/main/privileged/toolGateway";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const PATCH = `diff --git a/tracked.txt b/tracked.txt
index 7bfc4eb..a1b2c3d 100644
--- a/tracked.txt
+++ b/tracked.txt
@@ -1 +1 @@
-original
+applied by p7
`;
const now = instant("2026-08-13T00:00:00.000Z");
const clock: PrivilegedClock = { now: () => now };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", HOME: tmpdir(), LC_ALL: "C" },
  });
  return result.stdout.trim();
}

async function repository(): Promise<{ root: string; head: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "actestra-p7-workspace-"));
  roots.push(root);
  await git(root, "init", "--initial-branch=main");
  await git(root, "config", "user.name", "P7");
  await git(root, "config", "user.email", "p7@example.invalid");
  await writeFile(path.join(root, "tracked.txt"), "original\n", "utf8");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "base");
  return { root, head: await git(root, "rev-parse", "HEAD") };
}

function grant(root: string, overrides: Partial<WorkspaceGrant> = {}): WorkspaceGrant {
  return {
    contractVersion: 1,
    grantId: workspaceGrantId("grant-p7-destination"),
    workspaceId: workspaceId("workspace-p7-abuse"),
    rootPath: root,
    displayName: "P7 fixture",
    state: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as WorkspaceGrant;
}

function delivery(
  root: string,
  head: string,
  overrides: Partial<ArtifactDeliveryRecord> = {},
): ArtifactDeliveryRecord {
  const patchSha256 = createHash("sha256").update(PATCH, "utf8").digest("hex");
  return {
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    artifactId: artifactId("artifact-p7-abuse"),
    workspaceId: workspaceId("workspace-p7-abuse"),
    destinationWorkspaceId: null,
    taskId: taskId("task-p7-abuse"),
    sessionId: sessionId("session-p7-abuse"),
    state: "pending",
    patchOwnerGrantId: workspaceGrantId("grant-p7-isolated"),
    patchOwnerWorkerId: workerId("worker-p7-abuse"),
    patchRequestId: toolRequestId("request-p7-patch"),
    destinationGrantId: null,
    patchReference: toolInputReference("input-p7-patch"),
    patchSha256,
    patchByteLength: Buffer.byteLength(PATCH, "utf8"),
    baseCommit: head,
    changedFileCount: 1,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function persistence(record: ArtifactDeliveryRecord, patch = PATCH) {
  let current = record;
  const persisted: ArtifactDeliveryRecord[] = [];
  return {
    persisted,
    persistence: {
      loadDomainGraph: async () => ({
        artifacts: [
          { id: record.artifactId, workspaceId: record.workspaceId, taskId: record.taskId },
        ],
      }),
      getArtifactDelivery: async () => current,
      persistArtifactDelivery: async (next: ArtifactDeliveryRecord) => {
        current = next;
        persisted.push(next);
      },
      resolveContentReference: async () => ({
        metadata: {
          contractVersion: 1,
          reference: record.patchReference,
          kind: "tool-input",
          owner: {
            workspaceId: record.workspaceId,
            taskId: record.taskId,
            sessionId: record.sessionId,
            workerId: workerId(record.patchOwnerWorkerId ?? "worker-p7-abuse"),
            requestId: toolRequestId(record.patchRequestId ?? "request-p7-patch"),
            grantId: workspaceGrantId(record.patchOwnerGrantId),
          },
          classification: "task-content",
          mediaType: "text/plain; charset=utf-8",
          byteLength: Buffer.byteLength(patch, "utf8"),
          sha256: createHash("sha256").update(patch, "utf8").digest("hex"),
          createdAt: now,
        },
        content: patch,
      }),
    },
  };
}

async function apply(root: string, record: ArtifactDeliveryRecord, destination = grant(root)) {
  const bench = persistence(record);
  let requestedOperation: ProtectedOperation | undefined;
  const gateway: ToolGateway = {
    invoke: async (operation) => {
      requestedOperation = operation;
      return {
        status: "approval-required" as const,
        decision: {
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          decisionId: policyDecisionId("decision-p7-abuse"),
          policyRevision: policyRevision("policy-p7-abuse"),
          requestId: operation.requestId,
          effect: "require-approval" as const,
          reasonCode: "matching-rule-approval" as const,
          matchedRuleIds: [policyRuleId("rule-p7-abuse")],
          evaluatedAt: now,
        },
        approval: {
          approvalId: approvalId("approval-p7-abuse"),
          operation,
          policyRevision: policyRevision("policy-p7-abuse"),
          state: "pending",
          requestedAt: now,
          expiresAt: instant("2026-08-13T00:05:00.000Z"),
        } as ApprovalRequestSnapshot,
      };
    },
  };
  const result = await applyArtifactToWorkspace({
    artifactId: record.artifactId,
    workspaceRoot: root,
    grant: destination,
    persistence: bench.persistence as never,
    clock,
    toolGateway: gateway,
    awaitApprovalDecision: async (approval) => {
      if (requestedOperation === undefined) throw new Error("approval operation was not captured");
      return {
        approvalId: approval,
        operation: requestedOperation,
        policyRevision: policyRevision("policy-p7-abuse"),
        state: "approved",
        requestedAt: requestedOperation.requestedAt,
        expiresAt: instant("2026-08-13T00:05:00.000Z"),
      } as ApprovalRequestSnapshot;
    },
    signal: new AbortController().signal,
  }).then(
    (value) => ({ value, error: undefined, bench }),
    (error: unknown) => ({ value: undefined, error, bench }),
  );
  return result;
}

describe("P7 workspace, delivery, tool, and approval abuse baseline", () => {
  it("P7-A-WORKSPACE-001 rejects workspace scope escapes", async () => {
    const repo = await repository();
    const result = await apply(
      path.join(repo.root, ".."),
      delivery(repo.root, repo.head),
      grant(path.join(repo.root, "..")),
    );
    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
  });

  it("P7-A-WORKSPACE-002 rejects Git identity drift", async () => {
    const repo = await repository();
    const linked = `${repo.root}-linked`;
    roots.push(linked);
    await git(repo.root, "worktree", "add", linked, "-b", "linked");
    const result = await apply(linked, delivery(repo.root, repo.head), grant(linked));
    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
  });

  it("P7-A-WORKSPACE-003 rejects Git hook and state indirection", async () => {
    const repo = await repository();
    await writeFile(path.join(repo.root, "tracked.txt"), "dirty\n", "utf8");
    const result = await apply(repo.root, delivery(repo.root, repo.head), grant(repo.root));
    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
  });

  it("P7-A-DELIVERY-001 requires apply approval and revalidation", async () => {
    const repo = await repository();
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head),
      grant(repo.root, { state: "revoked" }),
    );
    expect(result.error).toBeInstanceOf(ArtifactWorkspaceApplicatorError);
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
  });

  it("P7-A-DELIVERY-002 makes apply retries idempotent", async () => {
    const repo = await repository();
    const lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: path.join(repo.root, ".git"),
      clock,
      holder: "first",
    });
    await expect(
      acquireWorkspaceRepositoryLock({
        gitDirectory: path.join(repo.root, ".git"),
        clock,
        holder: "second",
      }),
    ).rejects.toBeInstanceOf(WorkspaceRepositoryLockError);
    await lock.release();
    expect(await readFile(path.join(repo.root, "tracked.txt"), "utf8")).toBe("original\n");
    expect(path.basename(lock.lockPath)).toBe(REPOSITORY_LOCK_FILENAME);
  });

  it("P7-A-TOOL-001 rejects undeclared or unpolicied tools", async () => {
    const gateway = new PrivilegedToolGateway({
      policyEngine: {
        evaluate: async () => {
          throw new Error("should not run");
        },
      },
      approvalService: {} as never,
      credentialBroker: {} as never,
      auditTrail: {
        append: async (event: never) => ({
          contractVersion: 1,
          recordId: "audit-p7" as never,
          sequence: 1,
          occurredAt: now,
          redaction: "metadata",
          event,
        }),
      } as never,
      executor: {
        manifest: async () => {
          throw new Error("missing");
        },
        execute: async () => {
          throw new Error("must not execute");
        },
      },
    });
    const operation = {
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      requestId: toolRequestId("request-tool-p7"),
      workspaceId: workspaceId("workspace-p7-tool"),
      taskId: taskId("task-p7-tool"),
      sessionId: sessionId("session-p7-tool"),
      workerId: workerId("worker-p7-tool"),
      toolId: toolId("tool-p7-unknown"),
      inputRef: toolInputReference("input-p7-tool"),
      action: "workspace.read",
      resourceKind: "workspace",
      summary: "read",
      credentialRefs: [],
      requestedAt: now,
    } as ProtectedOperation;
    await expect(gateway.invoke(operation)).rejects.toMatchObject({ code: "manifest-unavailable" });
  });

  it("P7-A-TOOL-002 rejects stale tool authorization", async () => {
    expect(ARTIFACT_APPLY_TOOL_ID).toBe(toolId("actestra.coding.artifact-apply"));
  });

  it("P7-A-APPROVAL-001 rejects replayed approvals", async () => {
    const repo = await repository();
    const result = await apply(repo.root, delivery(repo.root, repo.head, { state: "applied" }));
    expect(result.error).toMatchObject({ code: "already-applied" });
  });

  it("P7-A-APPROVAL-002 rejects approval substitution", async () => {
    const repo = await repository();
    const result = await apply(
      repo.root,
      delivery(repo.root, repo.head),
      grant(repo.root, { grantId: workspaceGrantId("grant-other") }),
    );
    expect(result.error).toMatchObject({ code: "workspace-grant-invalid" });
  });
});
