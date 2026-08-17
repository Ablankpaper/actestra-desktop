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

  it("binds every containment implementation file into the runner source digest", () => {
    const source = fs.readFileSync(buildScriptPath, "utf8");
    for (const relativePath of [
      "apps/desktop/src/main/workers/gooseRunnerContainment.ts",
      "apps/desktop/src/main/workers/gooseRunnerProcess.ts",
      "apps/desktop/src/main/workers/gooseRunnerTarget.ts",
      "scripts/gooseContainmentEvidence.mjs",
      "scripts/record-goose-runner-containment.mjs",
      "scripts/run-goose-runner-containment.mjs",
      "scripts/test-goose-runner-containment.mjs",
      "workers/goose-runner/src/containment/mod.rs",
      "workers/goose-runner/src/containment/linux.rs",
      "workers/goose-runner/src/containment/unix.rs",
      "workers/goose-runner/src/containment/windows.rs",
      "workers/goose-runner/src/linux_bootstrap.rs",
    ]) {
      expect(source).toContain(`"${relativePath}"`);
    }
  });
});
