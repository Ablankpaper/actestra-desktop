// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  approvalId,
  artifactId,
  instant,
  workspaceGrantId,
  workspaceId,
  type ApprovalRequestSnapshot,
} from "../../apps/desktop/src/core";
import { AionUiCodingArtifactService } from "../../apps/desktop/src/main/compatibility/aionuiCodingArtifactService";

const ARTIFACT = artifactId("artifact-team-independent-port");
const APPROVAL = approvalId("approval-team-independent-port");
const WORKSPACE = workspaceId("workspace-team-independent-port");
const BASE_COMMIT = "a".repeat(40);

describe("AionUiCodingArtifactService", () => {
  it("owns view, download, approval, recovery, and close without a coding model runtime", async () => {
    let applySignal: AbortSignal | undefined;
    const requestApply = vi.fn(async (input: { readonly signal: AbortSignal }) => {
      applySignal = input.signal;
      const completion = new Promise<never>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("apply closed")), {
          once: true,
        });
      });
      return Object.freeze({ artifactId: ARTIFACT, approvalId: APPROVAL, completion });
    });
    const deliveryService = {
      inFlightApply: vi.fn(() => undefined),
      requestApply,
      resolveApply: vi.fn(
        async () =>
          ({ approvalId: APPROVAL, state: "approved" }) as unknown as ApprovalRequestSnapshot,
      ),
      recoverInterruptedApplies: vi.fn(async () => []),
    };
    const persistence = {
      getArtifactPatchPreview: vi.fn(async () => "diff --git a/a.txt b/a.txt"),
      getArtifactPatchContent: vi.fn(async () => "diff --git a/a.txt b/a.txt\n"),
      getArtifactDelivery: vi.fn(async () => ({
        artifactId: ARTIFACT,
        workspaceId: WORKSPACE,
        state: "pending",
        baseCommit: BASE_COMMIT,
        changedFileCount: 1,
      })),
      loadDomainGraph: vi.fn(async () => ({
        artifacts: [{ id: ARTIFACT, label: "Team result" }],
      })),
      getActiveWorkspaceGrant: vi.fn(async () => ({
        grantId: workspaceGrantId("grant-team-independent-port"),
        workspaceId: WORKSPACE,
        rootPath: "/private/tmp/actestra-team-independent-port",
        state: "active",
      })),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = new AionUiCodingArtifactService({
      persistence: persistence as never,
      clock: { now: () => instant("2026-08-12T00:00:00.000Z") },
      deliveryService,
    });

    await expect(service.viewArtifact(ARTIFACT)).resolves.toEqual({
      baseCommit: BASE_COMMIT,
      changedFileCount: 1,
      patchPreview: "diff --git a/a.txt b/a.txt",
    });
    await expect(service.downloadArtifact(ARTIFACT)).resolves.toEqual({
      fileName: "Team-result.patch",
      content: "diff --git a/a.txt b/a.txt\n",
    });
    await expect(service.applyArtifact(ARTIFACT)).resolves.toEqual({ approvalId: APPROVAL });
    expect(deliveryService.recoverInterruptedApplies).toHaveBeenCalledTimes(1);
    await expect(service.resolveArtifactApply(APPROVAL, "approved")).resolves.toBeUndefined();
    expect(deliveryService.resolveApply).toHaveBeenCalledWith(APPROVAL, "approved");

    await service.close();
    expect(applySignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    consoleError.mockRestore();
  });

  it("looks up the original destination workspace, not the isolated Artifact workspace", async () => {
    const isolatedWorkspace = workspaceId("workspace-isolated-artifact");
    const destinationWorkspace = workspaceId("workspace-original-destination");
    const getActiveWorkspaceGrant = vi.fn(async (workspace: string) =>
      workspace === destinationWorkspace
        ? {
            grantId: workspaceGrantId("grant-original-destination"),
            workspaceId: destinationWorkspace,
            rootPath: "/private/tmp/actestra-original-destination",
            state: "active" as const,
          }
        : null,
    );
    const requestApply = vi.fn(async () =>
      Object.freeze({
        artifactId: ARTIFACT,
        approvalId: APPROVAL,
        completion: Promise.resolve({ verifiedHead: BASE_COMMIT }),
      }),
    );
    const service = new AionUiCodingArtifactService({
      persistence: {
        getArtifactPatchPreview: vi.fn(async () => "diff --git a/a.txt b/a.txt"),
        getArtifactPatchContent: vi.fn(async () => "diff --git a/a.txt b/a.txt\n"),
        getArtifactDelivery: vi.fn(async () => ({
          artifactId: ARTIFACT,
          workspaceId: isolatedWorkspace,
          destinationWorkspaceId: destinationWorkspace,
          state: "pending",
          baseCommit: BASE_COMMIT,
          changedFileCount: 1,
        })),
        loadDomainGraph: vi.fn(async () => ({
          artifacts: [{ id: ARTIFACT, label: "Team result" }],
        })),
        getActiveWorkspaceGrant,
      } as never,
      clock: { now: () => instant("2026-08-12T00:00:00.000Z") },
      deliveryService: {
        inFlightApply: vi.fn(() => undefined),
        requestApply,
        resolveApply: vi.fn(),
        recoverInterruptedApplies: vi.fn(async () => []),
      },
    });

    await expect(service.applyArtifact(ARTIFACT)).resolves.toEqual({ approvalId: APPROVAL });
    expect(getActiveWorkspaceGrant).toHaveBeenCalledWith(destinationWorkspace);
    expect(requestApply).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationGrant: expect.objectContaining({ workspaceId: destinationWorkspace }),
      }),
    );
  });
});
