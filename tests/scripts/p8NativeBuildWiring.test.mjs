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
});
