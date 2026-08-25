// @vitest-environment node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_DELIVERY_CONTRACT_VERSION,
  PRIVILEGED_CONTRACT_VERSION,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  approvalId,
  artifactId,
  artifactPatchOwner,
  instant,
  sessionId,
  taskId,
  toolInputReference,
  workerId,
  workspaceGrantId,
  workspaceId,
  type ApprovalRequestSnapshot,
  type ArtifactDeliveryRecord,
  type PrivilegedClock,
  type ToolGateway,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";
import { projectArtifactDelivery } from "../../apps/desktop/src/compatibility/aionui/codingJourney";
import { GENERAL_WORKER_ADAPTER_KIND } from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import { applyArtifactToWorkspace } from "../../apps/desktop/src/main/workers/artifactWorkspaceApplicator";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const run = promisify(execFile);

const ARTIFACT = artifactId("artifact-delivery-cross-layer");
const WORKSPACE = workspaceId("workspace-delivery-cross-layer");
const TASK = taskId("task-delivery-cross-layer");
const SESSION = sessionId("session-delivery-cross-layer");
const WORKER = workerId("worker-delivery-cross-layer");
const APPROVAL = approvalId("approval-delivery-cross-layer");
const PATCH_OWNER_GRANT = "grant-isolated-worktree-cross-layer";
const DESTINATION_GRANT = "grant-original-workspace-cross-layer";
const PATCH_REFERENCE = "tool-input-patch-cross-layer";
const PATCH_REQUEST = "request-coding-publish-cross-layer";
const CREATED_AT = instant("2026-08-11T08:00:00.000Z");

const PATCH = `diff --git a/tracked.txt b/tracked.txt
index 7bfc4eb..a1b2c3d 100644
--- a/tracked.txt
+++ b/tracked.txt
@@ -1 +1 @@
-original
+applied by actestra
`;

const roots: string[] = [];
const clients: Array<Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"]> = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close().catch(() => undefined);
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

/** Advances monotonically, because the delivery contract refuses an update that precedes its record. */
function clock(): PrivilegedClock {
  let tick = 1;
  return {
    now: () => instant(new Date(Date.parse(CREATED_AT) + tick++ * 1_000).toISOString()),
  };
}

async function createRepository(): Promise<{ readonly root: string; readonly head: string }> {
  // Canonicalized because macOS resolves the temp directory through /private, and a real grant always
  // names the canonical root Git itself reports.
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "actestra-delivery-cross-layer-")));
  roots.push(root);
  const git = (...args: string[]): Promise<unknown> => run("/usr/bin/git", ["-C", root, ...args]);
  await git("init", "--initial-branch=main");
  await git("config", "user.email", "proof@actestra.test");
  await git("config", "user.name", "Actestra Proof");
  await writeFile(path.join(root, "tracked.txt"), "original\n", "utf8");
  await git("add", ".");
  await git("commit", "--no-gpg-sign", "-m", "base");
  const { stdout } = await run("/usr/bin/git", ["-C", root, "rev-parse", "HEAD"]);
  return { root, head: stdout.trim() };
}

async function createDurableDeliveryFixture(options: {
  readonly directory: string;
  readonly root: string;
  readonly baseCommit: string;
}): Promise<{
  readonly persistence: Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"];
  readonly destination: WorkspaceGrant;
}> {
  const persistence = (await openTestPersistenceUtility(options.directory)).client;
  clients.push(persistence);

  await persistence.replaceDomainGraph({
    workspaces: [
      {
        id: WORKSPACE,
        name: "Cross-layer delivery workspace",
        state: "active",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    tasks: [
      {
        id: TASK,
        workspaceId: WORKSPACE,
        title: "Apply a reviewed patch to the original workspace",
        state: "completed",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    sessions: [
      {
        id: SESSION,
        workspaceId: WORKSPACE,
        taskId: TASK,
        workerId: WORKER,
        state: "completed",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    workers: [
      {
        id: WORKER,
        workspaceId: WORKSPACE,
        adapterKind: GENERAL_WORKER_ADAPTER_KIND,
        state: "stopped",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    approvals: [],
    artifacts: [
      {
        id: ARTIFACT,
        taskId: TASK,
        workspaceId: WORKSPACE,
        sessionId: SESSION,
        kind: "file",
        label: "Reviewed patch",
        state: "available",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
  });

  const patchOwner: WorkspaceGrant = {
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    grantId: workspaceGrantId(PATCH_OWNER_GRANT),
    workspaceId: WORKSPACE,
    rootPath: options.root,
    displayName: "Cross-layer isolated worktree",
    state: "active",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await persistence.persistWorkspaceGrant(patchOwner);
  const record = {
    contractVersion: ARTIFACT_DELIVERY_CONTRACT_VERSION,
    artifactId: ARTIFACT,
    workspaceId: WORKSPACE,
    destinationWorkspaceId: null,
    taskId: TASK,
    sessionId: SESSION,
    state: "pending",
    patchOwnerGrantId: PATCH_OWNER_GRANT,
    patchOwnerWorkerId: WORKER,
    patchRequestId: PATCH_REQUEST,
    destinationGrantId: null,
    patchReference: PATCH_REFERENCE,
    patchSha256: createHash("sha256").update(PATCH, "utf8").digest("hex"),
    patchByteLength: Buffer.byteLength(PATCH, "utf8"),
    baseCommit: options.baseCommit,
    changedFileCount: 1,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  } as const satisfies ArtifactDeliveryRecord;
  await persistence.storeContentReference({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: toolInputReference(PATCH_REFERENCE),
    kind: "tool-input",
    owner: artifactPatchOwner(record),
    classification: "task-content",
    mediaType: "text/plain; charset=utf-8",
    content: PATCH,
    createdAt: CREATED_AT,
  });
  await persistence.persistWorkspaceGrant({
    ...patchOwner,
    state: "revoked",
    updatedAt: instant("2026-08-11T08:00:01.000Z"),
  });
  const destination: WorkspaceGrant = {
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    grantId: workspaceGrantId(DESTINATION_GRANT),
    workspaceId: WORKSPACE,
    rootPath: options.root,
    displayName: "Cross-layer destination",
    state: "active",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
  await persistence.persistWorkspaceGrant(destination);
  await persistence.persistArtifactDelivery(record);

  return { persistence, destination };
}

function approvingGateway(): {
  readonly gateway: ToolGateway;
  readonly decide: () => ApprovalRequestSnapshot;
} {
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
    gateway: gateway as unknown as ToolGateway,
    decide: () =>
      ({
        contractVersion: PRIVILEGED_CONTRACT_VERSION,
        approvalId: APPROVAL,
        operation: requested,
        state: "approved",
      }) as unknown as ApprovalRequestSnapshot,
  };
}

describe("Artifact delivery cross-layer integration", () => {
  it("carries one approved apply from the Artifact through Git, SQLite, and the projection", async () => {
    const { root, head } = await createRepository();
    const directory = await mkdtemp(path.join(tmpdir(), "actestra-delivery-cross-layer-store-"));
    roots.push(directory);
    const { persistence, destination } = await createDurableDeliveryFixture({
      directory,
      root,
      baseCommit: head,
    });
    const now = clock();

    const { gateway, decide } = approvingGateway();
    const applied = await applyArtifactToWorkspace({
      artifactId: ARTIFACT,
      workspaceRoot: root,
      grant: destination,
      persistence,
      clock: now,
      toolGateway: gateway,
      awaitApprovalDecision: async () => decide(),
      signal: new AbortController().signal,
    });

    // Git layer: the user's own checkout carries the patched bytes, and `git apply` created no commit,
    // so the verified head is still the base the patch was reviewed against.
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("applied by actestra\n");
    expect(applied.verifiedHead).toBe(head);
    const { stdout: headAfter } = await run("/usr/bin/git", ["-C", root, "rev-parse", "HEAD"]);
    expect(headAfter.trim()).toBe(head);

    // Persistence layer: the terminal record survives in real SQLite, naming both authorities apart
    // and the approval the write was gated on.
    const durable = await persistence.getArtifactDelivery(ARTIFACT);
    expect(durable).toMatchObject({
      state: "applied",
      patchOwnerGrantId: PATCH_OWNER_GRANT,
      destinationGrantId: DESTINATION_GRANT,
      approvalId: APPROVAL,
      verifiedHead: head,
      failureCode: null,
    });

    // Projection layer: the Renderer learns the state and the reviewed scope, and no path, content
    // reference, or patch text crosses with it.
    const projection = projectArtifactDelivery(durable!);
    expect(projection).toEqual({
      deliveryState: "applied",
      baseCommit: head,
      changedFileCount: 1,
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(PATCH_REFERENCE);
    expect(serialized).not.toContain("applied by actestra");
    expect(serialized).not.toContain(PATCH_OWNER_GRANT);

    // A second apply of the same delivery is refused, so a retried click cannot double-write.
    await expect(
      applyArtifactToWorkspace({
        artifactId: ARTIFACT,
        workspaceRoot: root,
        grant: destination,
        persistence,
        clock: now,
        toolGateway: approvingGateway().gateway,
        awaitApprovalDecision: async () => decide(),
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "already-applied" });
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("applied by actestra\n");
  });

  for (const scenario of [
    {
      failureCode: "workspace-dirty" as const,
      baseCommit: (head: string) => head,
      arrange: async (root: string) => {
        await writeFile(path.join(root, "tracked.txt"), "user work in progress\n", "utf8");
      },
      expectedBytes: "user work in progress\n",
    },
    {
      failureCode: "head-drift" as const,
      baseCommit: () => "1".repeat(40),
      arrange: async () => {},
      expectedBytes: "original\n",
    },
  ]) {
    it(`persists ${scenario.failureCode} across SQLite close/reopen and projects the exact failure`, async () => {
      const { root, head } = await createRepository();
      const directory = await mkdtemp(path.join(tmpdir(), "actestra-delivery-failure-store-"));
      roots.push(directory);
      const { persistence, destination } = await createDurableDeliveryFixture({
        directory,
        root,
        baseCommit: scenario.baseCommit(head),
      });
      await scenario.arrange(root);
      const { gateway, decide } = approvingGateway();

      await expect(
        applyArtifactToWorkspace({
          artifactId: ARTIFACT,
          workspaceRoot: root,
          grant: destination,
          persistence,
          clock: clock(),
          toolGateway: gateway,
          awaitApprovalDecision: async () => decide(),
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: scenario.failureCode });
      expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe(scenario.expectedBytes);

      await persistence.close();
      const reopened = (await openTestPersistenceUtility(directory)).client;
      clients.push(reopened);
      const durable = await reopened.getArtifactDelivery(ARTIFACT);
      expect(durable).toMatchObject({
        state: "failed",
        destinationGrantId: DESTINATION_GRANT,
        approvalId: null,
        verifiedHead: null,
        failureCode: scenario.failureCode,
      });
      expect(await reopened.listArtifactDeliveriesForTask(TASK, 10)).toEqual([durable]);

      expect(projectArtifactDelivery(durable!)).toEqual({
        deliveryState: "failed",
        baseCommit: scenario.baseCommit(head),
        changedFileCount: 1,
        failureCode: scenario.failureCode,
      });
    });
  }
});
