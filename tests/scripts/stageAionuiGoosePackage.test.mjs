// @vitest-environment node

import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const stageScriptPath = path.join(repositoryRoot, "scripts/stage-aionui-goose-package.ts");

describe("cross-platform Goose package staging paths", () => {
  it("accepts an absolute Windows root whose separators were mixed by CI interpolation", async () => {
    const stage = await import(pathToFileURL(stageScriptPath).href);
    const mixedWindowsRoot = "D:\\a\\actestra-desktop\\actestra-desktop/.actestra/aionui-v2.1.41";

    expect(stage.isMaterializedRootPath(mixedWindowsRoot, path.win32)).toBe(true);
  });

  it("still rejects relative roots and roots with the wrong final directory", async () => {
    const stage = await import(pathToFileURL(stageScriptPath).href);

    expect(stage.isMaterializedRootPath(".actestra/aionui-v2.1.41", path.posix)).toBe(false);
    expect(stage.isMaterializedRootPath("D:\\a\\actestra-desktop\\other", path.win32)).toBe(false);
  });
});
