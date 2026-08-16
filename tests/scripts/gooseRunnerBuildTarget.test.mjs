// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const buildScriptPath = path.join(repositoryRoot, "scripts/build-goose-runner.mjs");

describe("Goose runner native build script", () => {
  it("derives the tool names, runner executable, target triple, and PATH from the shared host contract", () => {
    const source = fs.readFileSync(buildScriptPath, "utf8");

    expect(source).toContain('from "./install-goose-runner-tools.mjs"');
    expect(source).toContain(
      "resolveGooseRunnerToolInstallContract(process.platform, process.arch)",
    );
    expect(source).toContain("buildTarget.targetTriple");
    expect(source).toContain("buildTarget.executableFile");
    expect(source).toContain("asset.executableFile");
    expect(source).toContain("path.delimiter");
    expect(source).not.toContain('path.join(toolDirectory, "cargo-audit")');
    expect(source).not.toContain('path.join(toolDirectory, "cargo-auditable")');
    expect(source).not.toContain('`${toolDirectory}:${process.env.PATH ?? ""}`');
    expect(source).not.toContain('process.platform === "win32" ? "actestra-goose-runner.exe"');
  });
});
