// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  instant,
  normalizeArtifactDeliveryRecord,
  taskId,
  type ArtifactDeliveryRecord,
  type PrivilegedClock,
} from "../../apps/desktop/src/core";
import {
  ArtifactDeliveryService,
  type ArtifactDeliveryServiceConfig,
} from "../../apps/desktop/src/main/workers/artifactDeliveryService";

const TASK_A = taskId("task-recovery-a");
const TASK_B = taskId("task-recovery-b");
const RECOVERED_AT = "2026-08-11T03:00:00.000Z";

// Overrides are loose because `normalizeArtifactDeliveryRecord` is the runtime authority on shape:
// the fixture hands it plain strings and lets it brand and reject exactly as production input does.
function delivery(
  overrides: Record<string, unknown> & { readonly artifactId: string },
): ArtifactDeliveryRecord {
  return normalizeArtifactDeliveryRecord({
    contractVersion: 2,
    workspaceId: "workspace-recovery",
    destinationWorkspaceId: null,
    taskId: TASK_A,
    sessionId: "session-recovery",
    state: "pending",
    patchOwnerGrantId: "grant-isolated-recovery",
    patchOwnerWorkerId: "worker-recovery",
    patchRequestId: "request-coding-publish-recovery",
    destinationGrantId: null,
    patchReference: "reference-recovery-patch",
    patchSha256: "c".repeat(64),
    patchByteLength: 256,
    baseCommit: "d".repeat(40),
    changedFileCount: 2,
    approvalId: null,
    verifiedHead: null,
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-08-11T02:00:00.000Z",
    updatedAt: "2026-08-11T02:00:00.000Z",
    ...overrides,
  });
}

function service(deliveries: readonly ArtifactDeliveryRecord[]): {
  readonly instance: ArtifactDeliveryService;
  readonly persisted: ArtifactDeliveryRecord[];
  readonly scannedLimits: number[];
} {
  const persisted: ArtifactDeliveryRecord[] = [];
  const scannedLimits: number[] = [];
  const persistence = {
    loadDomainGraph: async () => ({ tasks: [{ id: TASK_A }, { id: TASK_B }] }),
    listArtifactDeliveriesForTask: async (task: string, limit: number) => {
      scannedLimits.push(limit);
      return deliveries.filter((record) => record.taskId === task);
    },
    persistArtifactDelivery: async (next: ArtifactDeliveryRecord) => {
      persisted.push(next);
      return { status: "stored" as const, delivery: next };
    },
  };
  const clock: PrivilegedClock = { now: () => instant(RECOVERED_AT) };
  const instance = new ArtifactDeliveryService({
    persistence: persistence as unknown as ArtifactDeliveryServiceConfig["persistence"],
    clock,
    // The recovery sweep never reaches the gateway, so the platform is only present to satisfy
    // construction. If a sweep ever tried to apply, this would throw rather than write.
    platform: {
      get approvalService(): never {
        throw new Error("recovery must not touch the approval service");
      },
      get toolGateway(): never {
        throw new Error("recovery must not touch the tool gateway");
      },
    } as unknown as NonNullable<ArtifactDeliveryServiceConfig["platform"]>,
  });
  return { instance, persisted, scannedLimits };
}

describe("ArtifactDeliveryService.recoverInterruptedApplies", () => {
  it("settles nothing when no attempt was interrupted", async () => {
    const { instance, persisted } = service([
      delivery({ artifactId: "artifact-pending" }),
      delivery({
        artifactId: "artifact-applied",
        state: "applied",
        destinationGrantId: "grant-destination-recovery",
        approvalId: "approval-recovery-applied",
        verifiedHead: "d".repeat(40),
      }),
    ]);

    await expect(instance.recoverInterruptedApplies()).resolves.toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("cancels an interrupted attempt that never obtained an approval", async () => {
    const { instance, persisted } = service([
      delivery({
        artifactId: "artifact-no-approval",
        state: "applying",
        destinationGrantId: "grant-destination-recovery",
      }),
    ]);

    const recovered = await instance.recoverInterruptedApplies();

    expect(recovered).toEqual([{ artifactId: "artifact-no-approval", action: "cancel" }]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      state: "cancelled",
      failureCode: null,
      updatedAt: RECOVERED_AT,
    });
  });

  it("fails an interrupted attempt closed once an approval existed", async () => {
    const { instance, persisted } = service([
      delivery({
        artifactId: "artifact-with-approval",
        taskId: TASK_B,
        state: "applying",
        destinationGrantId: "grant-destination-recovery",
        approvalId: "approval-recovery-outstanding",
      }),
    ]);

    const recovered = await instance.recoverInterruptedApplies();

    expect(recovered).toEqual([{ artifactId: "artifact-with-approval", action: "fail-closed" }]);
    // The patch is retained and no re-apply is attempted: whether the write landed is unprovable.
    expect(persisted[0]).toMatchObject({
      state: "failed",
      failureCode: "apply-failed",
      patchReference: "reference-recovery-patch",
      verifiedHead: null,
    });
  });

  it("sweeps every task in the graph under a bounded per-task limit", async () => {
    const { instance, persisted, scannedLimits } = service([
      delivery({
        artifactId: "artifact-task-a",
        state: "applying",
        destinationGrantId: "grant-destination-recovery",
      }),
      delivery({
        artifactId: "artifact-task-b",
        taskId: TASK_B,
        state: "applying",
        destinationGrantId: "grant-destination-recovery",
        approvalId: "approval-recovery-b",
      }),
    ]);

    const recovered = await instance.recoverInterruptedApplies();

    expect(recovered.map((entry) => entry.artifactId)).toEqual([
      "artifact-task-a",
      "artifact-task-b",
    ]);
    expect(persisted).toHaveLength(2);
    expect(scannedLimits).toEqual([100, 100]);
  });
});
