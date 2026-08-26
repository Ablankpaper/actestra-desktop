// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function job(workflow, id) {
  const start = workflow.indexOf(`\n  ${id}:`);
  if (start < 0) return "";
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n  [A-Za-z0-9_-]+:\n/u);
  return workflow.slice(start, end < 0 ? workflow.length : start + 1 + end);
}

describe("P8.3 candidate CI wiring", () => {
  it("registers the candidate checker and exact-input builder commands", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts["p8:candidate:check"]).toBe("node scripts/p8-candidate-evidence.mjs");
    expect(scripts["p8:candidate:create"]).toBe("node scripts/create-p8-candidate.mjs");
  });

  it("uploads package bytes and journey evidence only as bounded candidate inputs", () => {
    const workflow = read(".github/workflows/ci.yml");
    for (const target of ["macos-15-arm64", "windows-11-x64", "ubuntu-24.04-x64"]) {
      expect(workflow).toContain(`p8-candidate-input-${target}-${"${{ github.sha }}"}`);
      expect(workflow).toContain(`p8-product-journeys-${target}.json`);
    }
    expect(workflow).toContain(
      "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
    );
    expect(workflow).toContain("retention-days: 3");
    expect(workflow).toContain("compression-level: 0");
    for (const forbidden of [
      "ACTESTRA_P8_CANDIDATE_SIGNING_PRIVATE_KEY",
      "CSC_LINK",
      "APPLE_ID_PASSWORD",
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
  });

  it("assembles one exact-source candidate and keeps unavailable signing incomplete", () => {
    const workflow = read(".github/workflows/ci.yml");
    const candidate = job(workflow, "p8-candidate");
    expect(candidate).not.toBe("");
    expect(candidate).toContain("needs:");
    expect(candidate).toContain("electron-package-windows");
    expect(candidate).toContain("goose-containment-linux");
    expect(candidate).toContain("macos");
    expect(candidate).toContain("p8:candidate:create");
    expect(candidate).toContain("p8:candidate:check");
    expect(candidate).toContain("candidate-manifest.json");
    expect(candidate).toContain("candidate-incomplete");
    expect(candidate).toContain("github.sha");
    expect(candidate).toContain("github.run_id");
  });
});
