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

  it("declares the complete schema-13 scheduled-work overlay boundary", () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../..");
    const overlay = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json"), "utf8"),
    );

    expect(overlay.phase).toBe("P4-scheduled-general-work");
    expect(overlay.migration.strategy).toContain("schema v13");
    expect(overlay.migration.rollback).toContain("patch 0011");
    expect(overlay.patches.at(-1)?.path).toBe("patches/0011-actestra-scheduled-general-work.mjs");
    expect(overlay.expectedChangedFiles).toEqual(
      expect.arrayContaining([
        "packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts",
        "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
        "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
      ]),
    );
    expect(overlay.invariantFiles).toContain("packages/desktop/src/common/adapter/ipcBridge.ts");
  });
});
