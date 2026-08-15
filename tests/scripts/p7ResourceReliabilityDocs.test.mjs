// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const incidentCodes = [
  "worker-resource-cpu-exceeded",
  "worker-resource-memory-exceeded",
  "worker-resource-output-exceeded",
  "worker-resource-timeout",
  "worker-resource-storage-exceeded",
  "worker-process-tree-violated",
  "worker-resource-enforcement-unavailable",
];

describe("P7.2 resource reliability documentation", () => {
  it("indexes accepted ADR-0028 from both documentation entry points", () => {
    const adr = read(
      "docs/architecture/decisions/0028-p7-worker-resource-and-process-reliability.md",
    );
    expect(adr).toContain("# ADR-0028:");
    expect(adr).toContain("- Status: Accepted");
    expect(read("docs/architecture/decisions/README.md")).toContain(
      "[0028](0028-p7-worker-resource-and-process-reliability.md)",
    );
    expect(read("docs/README.md")).toContain(
      "architecture/decisions/0028-p7-worker-resource-and-process-reliability.md",
    );
  });

  it("records the fixed profiles, closed incident vocabulary, and scheme A non-goals", () => {
    const adr = read(
      "docs/architecture/decisions/0028-p7-worker-resource-and-process-reliability.md",
    );
    for (const code of incidentCodes) expect(adr).toContain(code);
    for (const value of [
      "10 minutes",
      "30 CPU seconds",
      "512 MiB",
      "30 minutes",
      "120 CPU seconds",
      "1 GiB",
      "64 MiB",
    ]) {
      expect(adr).toContain(value);
    }
    expect(adr).toContain("General Worker and Goose Worker only");
    expect(adr).toContain("Planner sidecar");
    expect(adr).toContain("SQLite persistence utility");
    expect(adr).toContain("Renderer");
    expect(adr).toContain("Windows and Linux");
    expect(adr).toContain("Rollback");
  });

  it("updates current architecture and roadmap without claiming packaged or CI closure", () => {
    const overview = read("docs/architecture/SYSTEM_OVERVIEW.md");
    const roadmap = read("docs/roadmap/DEVELOPMENT_SEQUENCE.md");
    expect(overview).not.toContain("Exact-head CI and merge evidence for this parent remain open");
    expect(overview).toContain("P7.1 development integration gate is accepted on `main`");
    expect(overview).toContain("P7.2 Worker resource/process reliability");
    for (const code of incidentCodes) expect(overview).toContain(code);
    expect(roadmap).toContain("### P7.2 local implementation gate");
    expect(roadmap).toContain("General Worker and Goose Worker only");
    expect(roadmap).toContain("Packaged hostile-process acceptance remains open");
    expect(roadmap).toContain("P7.3 and P7.4 remain separate");
  });

  it("separates verified local evidence from every unverified delivery layer", () => {
    const status = read("docs/PROJECT_STATUS.md");
    expect(status).toContain("### 2026-08-16 P7.2 local implementation gate");
    expect(status).toContain("implementation/test parent `e4a81ff");
    expect(status).toContain("5 test files and 32 tests pass");
    expect(status).toContain("downstream `package` compilation exits 0");
    expect(status).toContain("Packaged `.app` hostile smoke: not yet verified");
    expect(status).toContain("Exact-head pull-request CI: not yet verified");
    expect(status).toContain("Merge and merged-main CI: not yet verified");
    expect(status).toContain("Release, deployment, and user acceptance: not claimed");
  });
});
