// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface OverlayPatch {
  readonly path: string;
  readonly classification: readonly string[];
  readonly domains: readonly string[];
}

interface OverlaySourceCopy {
  readonly source: string;
  readonly destination: string;
}

interface DownstreamOverlay {
  readonly phase: string;
  readonly patches: readonly OverlayPatch[];
  readonly sourceCopies: readonly OverlaySourceCopy[];
  readonly expectedChangedFiles: readonly string[];
}

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const overlayPath = path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json");

describe("P5.2 native AionUI desktop-main composition", () => {
  it("declares the R1 main-only service patch and every required source copy", () => {
    const overlay = JSON.parse(fs.readFileSync(overlayPath, "utf8")) as DownstreamOverlay;
    expect(overlay.phase).toBe("P5-isolated-coding-main-composition");
    expect(overlay.patches).toContainEqual(
      expect.objectContaining({
        path: "patches/0012-actestra-isolated-coding-main.mjs",
        classification: ["R1"],
        domains: expect.arrayContaining([
          "isolated coding worktree lifecycle",
          "closed coding Tool Gateway composition",
        ]),
      }),
    );

    const copies = new Map(
      overlay.sourceCopies.map((copy) => [copy.source, copy.destination] as const),
    );
    expect(copies.get("apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts")).toBe(
      "packages/desktop/src/actestra/main/privileged/isolatedCodingToolExecutor.ts",
    );
    expect(copies.get("apps/desktop/src/main/privileged/isolatedCodingToolPlatform.ts")).toBe(
      "packages/desktop/src/actestra/main/privileged/isolatedCodingToolPlatform.ts",
    );
    expect(copies.get("apps/desktop/src/main/workers/isolatedCodingMainService.ts")).toBe(
      "packages/desktop/src/actestra/main/workers/isolatedCodingMainService.ts",
    );
    expect(copies.get("apps/desktop/src/main/workers/isolatedCodingWorktree.ts")).toBe(
      "packages/desktop/src/actestra/main/workers/isolatedCodingWorktree.ts",
    );

    for (const destination of copies.values()) {
      if (destination.includes("isolatedCoding")) {
        expect(overlay.expectedChangedFiles).toContain(destination);
      }
    }
  });

  it("composes and closes the service inside the native main persistence owner", () => {
    const patchPath = path.join(
      path.dirname(overlayPath),
      "patches/0012-actestra-isolated-coding-main.mjs",
    );
    const source = fs.readFileSync(patchPath, "utf8");
    expect(source).toContain("createIsolatedCodingMainService");
    expect(source).toContain("getActestraIsolatedCodingMainService");
    expect(source).toContain("path.join(userDataPath, 'coding-worktrees')");
    expect(source).toContain(`  let isolatedCodingCloseFailed = false;
  let isolatedCodingCloseError: unknown;
  try {
    await activeIsolatedCoding?.close();
    isolatedCodingMainService = null;
  } catch (error) {
    isolatedCodingCloseFailed = true;
    isolatedCodingCloseError = error;
  }
  await activeSchedule?.close().catch((): undefined => undefined);
  await activeGeneralWork?.close().catch((): undefined => undefined);
  if (isolatedCodingCloseFailed) {
    throw isolatedCodingCloseError;
  }
  persistence = null;`);
  });
});
