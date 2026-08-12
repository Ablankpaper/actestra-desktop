// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST,
  verifyActestraTeamPlannerManifest,
  writeActestraTeamPlannerManifest,
} = require("../../apps/desktop/src/main/orchestration/actestraNativeTeamPlannerManifest.cjs");
const downstreamPatchPath = path.resolve(
  import.meta.dirname,
  "../../downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs",
);

let projectRoot = "";
let entryPath = "";

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-planner-manifest-"));
  const mainOutput = path.join(projectRoot, "out/main");
  fs.mkdirSync(mainOutput, { recursive: true });
  entryPath = path.join(mainOutput, "actestra-team-planner.js");
  fs.writeFileSync(entryPath, "process.stdout.write('planner');\n");
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe("Actestra native Team planner build manifest", () => {
  it("registers final-bundle manifest writing for production builds", () => {
    const downstreamPatch = fs.readFileSync(downstreamPatchPath, "utf8");

    expect(downstreamPatch).toContain("function buildActestraTeamPlannerManifestPlugin()");
    expect(downstreamPatch).toContain("buildActestraTeamPlannerManifestPlugin(),");
    expect(downstreamPatch).not.toMatch(
      /isDevelopment[^\n]*buildActestraTeamPlannerManifestPlugin/u,
    );
    expect(downstreamPatch).toContain("...(isDevelopment ? [buildMcpServersPlugin()] : [])");
  });

  it("atomically binds the exact final bundle and engine identity", () => {
    const manifestPath = writeActestraTeamPlannerManifest(projectRoot);
    const manifest = verifyActestraTeamPlannerManifest(projectRoot);

    expect(path.basename(manifestPath)).toBe(ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      engine: { name: "actestra-native-team-planner", version: "1.0.0" },
      entry: { fileName: "actestra-team-planner.js", size: fs.statSync(entryPath).size },
    });
    expect(manifest.entry.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      fs.readdirSync(path.dirname(manifestPath)).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("fails closed after final bundle tampering", () => {
    writeActestraTeamPlannerManifest(projectRoot);
    fs.appendFileSync(entryPath, "// tampered\n");

    expect(() => verifyActestraTeamPlannerManifest(projectRoot)).toThrow(
      /does not match the final bundle/u,
    );
  });

  it("rejects widened manifest fields", () => {
    const manifestPath = writeActestraTeamPlannerManifest(projectRoot);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.entry.executable = "/tmp/other";
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(() => verifyActestraTeamPlannerManifest(projectRoot)).toThrow(
      /does not match the final bundle/u,
    );
  });
});
