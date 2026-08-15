// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

describe("P7 CI wiring", () => {
  it("runs the real parent-death attack only after the Goose artifact is admitted", () => {
    const aggregate = read("scripts/run-p7-abuse-cases.mjs");
    const gooseRunnerSelector = read("scripts/test-goose-runner.mjs");
    const vitestConfig = read("vitest.config.ts");
    const selfContainedAttacks = read("tests/security/mcpWorkerProcessAbuse.test.ts");
    const parentDeathPath = path.join(
      repositoryRoot,
      "tests/security/gooseRunnerParentDeathAbuse.integration.ts",
    );

    expect(selfContainedAttacks).not.toContain(
      "P7-A-PROCESS-002 terminates a real Goose runner when its supervisor dies",
    );
    expect(fs.existsSync(parentDeathPath)).toBe(true);
    expect(parentDeathPath.endsWith(".integration.ts")).toBe(true);
    expect(fs.readFileSync(parentDeathPath, "utf8")).toContain(
      "P7-A-PROCESS-002 terminates a real Goose runner when its supervisor dies",
    );
    expect(gooseRunnerSelector).toContain(
      '"tests/security/gooseRunnerParentDeathAbuse.integration.ts"',
    );
    expect(aggregate).not.toContain("gooseRunnerParentDeathAbuse.integration.ts");
    expect(vitestConfig).toContain("ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR");
    expect(vitestConfig).toContain("ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256");
    expect(vitestConfig).toContain("gooseRunnerParentDeathAbuse.integration.ts");
  });

  it("uploads the admitted Goose artifact only from main with bounded storage", () => {
    const workflow = read(".github/workflows/ci.yml");
    const uploadStep = workflow.match(
      /- name: Preserve Goose runner admission artifact[\s\S]*?(?=\n\s{6}- name:|\n  macos:)/u,
    )?.[0];

    expect(uploadStep).toBeDefined();
    expect(uploadStep).toContain(
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(uploadStep).toContain("retention-days: 3");
    expect(uploadStep).toContain("compression-level: 6");
  });

  it("registers package trust as a Bun gate with caller-provided output evidence", () => {
    const scripts = readJson("package.json").scripts;
    expect(scripts["verify:p7-package"]).toBe("bun scripts/p7-packaged-trust.mjs");
    expect(scripts["p7:package-output-digest"]).toBe("bun scripts/p7-package-output-digest.mjs");
    const trust = read("scripts/p7-packaged-trust.mjs");
    expect(trust).toContain("ACTESTRA_AIONUI_PACKAGED_OUTPUT_SHA256");
    expect(trust).not.toContain("sha256(fs.readFileSync(manifestPath))");
  });

  it("runs package trust in the macOS job with independently supplied roots", () => {
    const workflow = read(".github/workflows/ci.yml");
    const macosJob = workflow.slice(workflow.indexOf("\n  macos:"));
    const buildIndex = macosJob.indexOf("bun run --cwd .actestra/aionui-v2.1.41 dist:mac");
    const runnerBuildIndex = macosJob.indexOf("bun run goose:runner:build");
    const digestIndex = macosJob.indexOf("bun scripts/p7-package-output-digest.mjs");
    const trustIndex = macosJob.indexOf("bun run verify:p7-package");
    expect(runnerBuildIndex).toBeGreaterThan(buildIndex);
    expect(digestIndex).toBeGreaterThan(buildIndex);
    expect(trustIndex).toBeGreaterThan(digestIndex);
    expect(macosJob).toContain("bun run goose:runner:tools");
    expect(macosJob).toContain("ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256");
    expect(macosJob).toContain("ACTESTRA_AIONUI_PACKAGED_OUTPUT_SHA256");
  });

  it("keeps the packaged smoke set bound to every catalog case requiring Layer 4", () => {
    const smoke = read("scripts/smoke-p7-security.mjs");
    const rendererSmoke = read("apps/desktop/src/main/security/p7SecuritySmoke.ts");
    const catalog = read("tests/security/abuseCaseCatalog.ts");
    expect(smoke).not.toContain('const packagedCaseIds = ["P7-A-RENDERER-002"];');
    expect(rendererSmoke).toContain('"P7-A-CREDENTIAL-001"');
    expect(rendererSmoke).toContain('"P7-A-ARTIFACT-001"');
    expect(catalog).toContain("requiredLayers");
    expect(smoke).toContain("requiredLayers");
  });

  it("passes the independently computed runner trust root into packaged smoke", () => {
    const workflow = read(".github/workflows/ci.yml");
    const smokeStep = workflow.match(
      /- name: Smoke packaged P7 security boundaries from clean profiles[\s\S]*?(?=\n\s{6}- name:|\n  [a-z]+:|$)/u,
    )?.[0];
    expect(smokeStep).toBeDefined();
    expect(smokeStep).toContain(
      "ACTESTRA_P7_SECURITY_SMOKE_RUNNER_ARTIFACT_DIRECTORY: ${{ github.workspace }}/.actestra/goose-runner/aarch64-apple-darwin",
    );
    expect(smokeStep).toContain(
      "ACTESTRA_P7_SECURITY_SMOKE_RUNNER_MANIFEST_SHA256: ${{ steps.p7-trust-roots.outputs.manifest_sha256 }}",
    );
  });
});
