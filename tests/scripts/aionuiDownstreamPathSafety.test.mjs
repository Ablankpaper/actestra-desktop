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

  it("declares the preserved coding journey over the schema-14 team-plan boundary", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const overlay = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json"), "utf8"),
    );

    expect(overlay.phase).toBe("P5-preserved-aionui-coding-journey");
    expect(overlay.migration.strategy).toContain("schema v14");
    expect(overlay.migration.strategy).toContain("schemas v1-v13");
    expect(overlay.migration.strategy).toContain("team_plans");
    expect(overlay.migration.rollback).toContain("schema v14");
    expect(overlay.migration.rollback).toContain("patch 0013");
    expect(overlay.migration.rollback).toContain("patch 0012");
    expect(overlay.patches.at(-1)?.path).toBe("patches/0013-actestra-goose-native-agent.mjs");
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
        "tests/unit/actestra/codingJourneyNativeWiring.test.ts",
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
      ]),
    );
    expect(overlay.invariantFiles).toContain("packages/desktop/src/common/adapter/ipcBridge.ts");
  });
});
