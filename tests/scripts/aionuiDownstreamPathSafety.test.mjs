// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  materializeAionUiDownstream,
  resolveContainedPath,
} from "../../scripts/materialize-aionui-downstream.mjs";

describe("AionUi downstream path safety", () => {
  it("rejects absolute and traversing overlay paths", () => {
    const root = path.join(os.tmpdir(), "actestra-path-root");

    expect(() => resolveContainedPath(root, "../escape", "test path")).toThrow(
      /escapes its declared root/u,
    );
    expect(() => resolveContainedPath(root, path.join(root, "absolute"), "test path")).toThrow(
      /relative path/u,
    );
    expect(resolveContainedPath(root, "nested/file.txt", "test path")).toBe(
      path.join(root, "nested", "file.txt"),
    );
  });

  it("refuses to remove a generated tree outside the repository-owned directory", () => {
    const outside = path.join(os.tmpdir(), "aionui-v2.1.41");

    expect(() =>
      materializeAionUiDownstream({
        outputRoot: outside,
      }),
    ).toThrow(/Downstream output/u);
  });

  it("declares the AionUI-native Team journey over the separate schema-14 and schema-15 authorities", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const overlay = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json"), "utf8"),
    );

    expect(overlay.phase).toBe("P6-aionui-native-team-work");
    expect(overlay.migration.strategy).toContain("schema v14");
    expect(overlay.migration.strategy).toContain("schemas v1-v13");
    expect(overlay.migration.strategy).toContain("team_plans");
    expect(overlay.migration.strategy).toContain("schema v15");
    expect(overlay.migration.strategy).toContain("team_definitions");
    expect(overlay.migration.strategy).toContain("team_runs");
    expect(overlay.migration.strategy).toContain("team_run_revisions");
    expect(overlay.migration.strategy).toContain("schema v17");
    expect(overlay.migration.strategy).toContain("standard_team_message_deliveries");
    expect(overlay.migration.rollback).toContain("schema v14");
    expect(overlay.migration.rollback).toContain("schema v15");
    expect(overlay.migration.rollback).toContain("schema v17");
    expect(overlay.migration.rollback).toContain("patch 0014");
    expect(overlay.migration.rollback).toContain("patch 0013");
    expect(overlay.migration.rollback).toContain("patch 0012");
    expect(
      overlay.patches.find((patch) => patch.path === "patches/0014-actestra-team-work.mjs"),
    ).toMatchObject({
      path: "patches/0014-actestra-team-work.mjs",
      classification: expect.arrayContaining(["R1", "R2"]),
      domains: expect.arrayContaining([
        "AionUI Team provider",
        "Team creation and group chat",
        "Team plan and Worker explainability",
        "Team controls and Artifact aggregation",
        "Team restart recovery",
      ]),
    });
    expect(
      overlay.patches.find(
        (patch) => patch.path === "patches/0015-actestra-macos-build-hardening.mjs",
      ),
    ).toMatchObject({
      path: "patches/0015-actestra-macos-build-hardening.mjs",
      classification: ["R0"],
      domains: expect.arrayContaining([
        "macOS distributable retry classification",
        "packaged .app completeness",
      ]),
    });
    expect(
      overlay.patches.find(
        (patch) => patch.path === "patches/0016-actestra-provider-credential-and-capability.mjs",
      ),
    ).toMatchObject({
      path: "patches/0016-actestra-provider-credential-and-capability.mjs",
      classification: expect.arrayContaining(["R1"]),
      domains: expect.arrayContaining([
        "Provider credential confidentiality in the Renderer",
        "Provider response cache suppression",
        "Provider capability declaration",
      ]),
    });
    expect(
      overlay.patches.find(
        (patch) => patch.path === "patches/0018-actestra-webview-service-boundary.mjs",
      ),
    ).toMatchObject({
      path: "patches/0018-actestra-webview-service-boundary.mjs",
      classification: expect.arrayContaining(["R1"]),
      domains: expect.arrayContaining([
        "exact local WebView service and port allowlist",
        "URL Preview unavailable guidance",
        "Extension Settings unavailable guidance",
        "retained OfficeCLI local preview",
      ]),
    });
    expect(overlay.uiContract.layoutChangesAllowed).toBe(true);
    expect(overlay.uiContract.featureEntryRemovalAllowed).toBe(false);
    expect(overlay.expectedChangedFiles).toEqual(
      expect.arrayContaining([
        "packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts",
        "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
        "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
        "packages/desktop/src/actestra/main/workers/isolatedCodingMainService.ts",
        "packages/desktop/src/actestra/main/workers/isolatedCodingWorktree.ts",
        "packages/desktop/src/actestra/main/privileged/isolatedCodingToolExecutor.ts",
        "packages/desktop/src/actestra/main/privileged/isolatedCodingToolPlatform.ts",
        "tests/unit/actestra/isolatedCodingMainComposition.test.ts",
        "packages/desktop/src/actestra/compatibility/aionui/codingAgent.ts",
        "packages/desktop/src/actestra/compatibility/aionui/codingJourney.ts",
        "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyService.ts",
        "packages/desktop/src/actestra/main/compatibility/aionuiCodingArtifactService.ts",
        "tests/unit/actestra/codingJourneyNativeWiring.test.ts",
        "packages/desktop/src/actestra/core/teamRun.ts",
        "packages/desktop/src/actestra/compatibility/aionui/teamBridge.ts",
        "packages/desktop/src/actestra/main/compatibility/aionuiTeamBridgeService.ts",
        "packages/desktop/src/actestra/main/compatibility/aionuiTeamService.ts",
        "packages/desktop/src/actestra/main/orchestration/teamPlanAdmissionService.ts",
        "packages/desktop/src/actestra/main/orchestration/teamOrchestratorService.ts",
        "packages/desktop/src/actestra/main/orchestration/teamJourneyWorkerRouter.ts",
        "packages/desktop/src/actestra/main/orchestration/actestraNativeTeamPlanner.ts",
        "packages/desktop/src/actestra/main/orchestration/actestraNativeTeamPlannerProcess.ts",
        "packages/desktop/src/actestra/main/orchestration/teamPlannerSidecarProcess.ts",
        "packages/desktop/src/actestra/utility/orchestration/actestraNativeTeamPlannerEntry.ts",
        "packages/desktop/src/actestra/main/privileged/approvalAuditEvidence.ts",
        "packages/desktop/src/actestra/shared/teamPlannerSidecarProtocol.ts",
        "packages/desktop/src/common/adapter/actestraTeamClient.ts",
        "packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx",
        "packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx",
        "packages/desktop/src/renderer/pages/team/TeamPage.tsx",
        "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx",
        "packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts",
        "tests/unit/actestra/teamNativeWiring.test.ts",
        "tests/unit/renderer/team/ActestraTeamWorkspace.dom.test.tsx",
      ]),
    );
    expect(overlay.sourceCopies).toEqual(
      expect.arrayContaining([
        {
          source: "apps/desktop/src/main/workers/isolatedCodingMainService.ts",
          destination: "packages/desktop/src/actestra/main/workers/isolatedCodingMainService.ts",
        },
        {
          source: "apps/desktop/src/main/workers/isolatedCodingWorktree.ts",
          destination: "packages/desktop/src/actestra/main/workers/isolatedCodingWorktree.ts",
        },
        {
          source: "apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts",
          destination:
            "packages/desktop/src/actestra/main/privileged/isolatedCodingToolExecutor.ts",
        },
        {
          source: "apps/desktop/src/main/privileged/isolatedCodingToolPlatform.ts",
          destination:
            "packages/desktop/src/actestra/main/privileged/isolatedCodingToolPlatform.ts",
        },
        {
          source: "apps/desktop/src/compatibility/aionui/codingJourney.ts",
          destination: "packages/desktop/src/actestra/compatibility/aionui/codingJourney.ts",
        },
        {
          source: "apps/desktop/src/main/compatibility/aionuiCodingJourneyService.ts",
          destination:
            "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyService.ts",
        },
        {
          source: "apps/desktop/src/main/compatibility/aionuiCodingArtifactService.ts",
          destination:
            "packages/desktop/src/actestra/main/compatibility/aionuiCodingArtifactService.ts",
        },
        {
          source: "apps/desktop/src/core/teamRun.ts",
          destination: "packages/desktop/src/actestra/core/teamRun.ts",
        },
        {
          source: "apps/desktop/src/compatibility/aionui/teamBridge.ts",
          destination: "packages/desktop/src/actestra/compatibility/aionui/teamBridge.ts",
        },
        {
          source: "apps/desktop/src/main/compatibility/aionuiTeamBridgeService.ts",
          destination:
            "packages/desktop/src/actestra/main/compatibility/aionuiTeamBridgeService.ts",
        },
        {
          source: "apps/desktop/src/main/compatibility/aionuiTeamService.ts",
          destination: "packages/desktop/src/actestra/main/compatibility/aionuiTeamService.ts",
        },
        {
          source: "apps/desktop/src/main/orchestration/teamPlanAdmissionService.ts",
          destination:
            "packages/desktop/src/actestra/main/orchestration/teamPlanAdmissionService.ts",
        },
        {
          source: "apps/desktop/src/main/orchestration/teamOrchestratorService.ts",
          destination:
            "packages/desktop/src/actestra/main/orchestration/teamOrchestratorService.ts",
        },
        {
          source: "apps/desktop/src/main/orchestration/teamJourneyWorkerRouter.ts",
          destination:
            "packages/desktop/src/actestra/main/orchestration/teamJourneyWorkerRouter.ts",
        },
        {
          source: "apps/desktop/src/main/orchestration/actestraNativeTeamPlanner.ts",
          destination:
            "packages/desktop/src/actestra/main/orchestration/actestraNativeTeamPlanner.ts",
        },
        {
          source: "apps/desktop/src/main/orchestration/actestraNativeTeamPlannerProcess.ts",
          destination:
            "packages/desktop/src/actestra/main/orchestration/actestraNativeTeamPlannerProcess.ts",
        },
        {
          source: "apps/desktop/src/main/orchestration/teamPlannerSidecarProcess.ts",
          destination:
            "packages/desktop/src/actestra/main/orchestration/teamPlannerSidecarProcess.ts",
        },
        {
          source: "apps/desktop/src/main/privileged/approvalAuditEvidence.ts",
          destination: "packages/desktop/src/actestra/main/privileged/approvalAuditEvidence.ts",
        },
        {
          source: "apps/desktop/src/shared/teamPlannerSidecarProtocol.ts",
          destination: "packages/desktop/src/actestra/shared/teamPlannerSidecarProtocol.ts",
        },
        {
          source: "apps/desktop/src/shared/webviewPolicy.ts",
          destination: "packages/desktop/src/actestra/shared/webviewPolicy.ts",
        },
        {
          source: "apps/desktop/src/utility/orchestration/actestraNativeTeamPlannerEntry.ts",
          destination:
            "packages/desktop/src/actestra/utility/orchestration/actestraNativeTeamPlannerEntry.ts",
        },
      ]),
    );
    for (const destination of [
      "packages/desktop/src/actestra/main/orchestration/localClaudeProductRuntime.ts",
      "packages/desktop/src/actestra/main/orchestration/supervisedLocalAgentProvider.ts",
      "packages/desktop/src/actestra/main/orchestration/supervisedLocalAgentRuntime.ts",
    ]) {
      expect(overlay.sourceCopies).not.toContainEqual(expect.objectContaining({ destination }));
      expect(overlay.expectedChangedFiles).not.toContain(destination);
    }
    expect(JSON.stringify(overlay.sourceCopies)).not.toContain("tests/fixtures");
    expect(JSON.stringify(overlay.sourceCopies)).not.toContain("localAgentCli");
    expect(JSON.stringify(overlay.sourceCopies)).not.toContain("teamPlannerSidecar.mjs");
    expect(overlay.invariantFiles).toContain("packages/desktop/src/common/adapter/ipcBridge.ts");
    const checker = fs.readFileSync(
      path.join(repositoryRoot, "scripts/check-aionui-downstream.mjs"),
      "utf8",
    );
    expect(checker).toContain('"data?.activities"');
    expect(checker).toContain('"restores durable user and Worker activity"');
  });
});
