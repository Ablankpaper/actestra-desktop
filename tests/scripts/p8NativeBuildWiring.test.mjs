// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("P8 native Goose build wiring", () => {
  it("registers a build-only emitted-artifact verifier at the production admission boundary", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    const verifierPath = path.join(repositoryRoot, "scripts/admit-goose-runner-build.ts");

    expect(scripts["goose:runner:admit-build"]).toBe("bun scripts/admit-goose-runner-build.ts");
    expect(fs.existsSync(verifierPath)).toBe(true);
    if (!fs.existsSync(verifierPath)) return;

    const verifier = fs.readFileSync(verifierPath, "utf8");
    expect(verifier).toContain("admitGooseRunnerArtifact");
    expect(verifier).toContain("resolveGooseRunnerBuildTarget");
    expect(verifier).not.toContain("gooseRunnerProcess");
    expect(verifier).not.toContain("openGooseRunnerHandshake");
  });

  it("materializes the shared target boundary as an exact Actestra-owned source copy", () => {
    const overlay = JSON.parse(read("downstream/aionui-v2.1.41/overlay.json"));
    const source = "apps/desktop/src/main/workers/gooseRunnerTarget.ts";
    const destination = "packages/desktop/src/actestra/main/workers/gooseRunnerTarget.ts";
    const checker = read("scripts/check-aionui-downstream.mjs");
    const artifactAdmission = read("apps/desktop/src/main/workers/gooseRunnerArtifact.ts");
    const runtimeProcess = read("apps/desktop/src/main/workers/gooseRunnerProcess.ts");

    expect(overlay.sourceCopies).toContainEqual({ source, destination });
    expect(overlay.expectedChangedFiles).toContain(destination);
    expect(checker).toContain(destination);
    expect(artifactAdmission).toContain('from "./gooseRunnerTarget"');
    expect(runtimeProcess).toContain('from "./gooseRunnerTarget"');
  });
});
