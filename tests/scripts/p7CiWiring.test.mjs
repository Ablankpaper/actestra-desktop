// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
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
});
