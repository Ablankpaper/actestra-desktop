import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const entryPath = path.join(
  root,
  "apps/desktop/src/utility/orchestration/actestraNativeTeamPlannerEntry.ts",
);
const downstreamPatchPath = path.join(
  root,
  "downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs",
);
const manifestHelperPath = path.join(
  root,
  "apps/desktop/src/main/orchestration/actestraNativeTeamPlannerManifest.cjs",
);

describe("Actestra native planner pre-execution boundary", () => {
  it("keeps the production entry stdio-only", () => {
    const source = fs.readFileSync(entryPath, "utf8");
    for (const forbidden of [
      "node:fs",
      "node:net",
      "node:http",
      "node:https",
      "node:child_process",
      "fetch(",
      "process.env.",
      "GEMINI_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    expect(source).toContain("process.stdin");
    expect(source).toContain("process.stdout");
  });

  it("generates and revalidates a manifest over the final planner bundle", () => {
    const patch = fs.readFileSync(downstreamPatchPath, "utf8");
    const helper = fs.readFileSync(manifestHelperPath, "utf8");

    expect(patch).toContain("actestra-team-planner.manifest.json");
    expect(patch).toContain("out/main/actestra-team-planner.js");
    expect(patch).toContain("verifyActestraTeamPlannerManifest");
    expect(patch).toContain("writeActestraTeamPlannerManifest");
    expect(helper).toContain("actestra-native-team-planner");
    expect(helper).toContain("1.0.0");
    expect(helper).toContain('createHash("sha256")');
    expect(helper).toContain("renameSync");
  });
});
