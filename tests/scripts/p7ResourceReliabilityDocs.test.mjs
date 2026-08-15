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

  it("records accepted integration without widening scheme A", () => {
    const overview = read("docs/architecture/SYSTEM_OVERVIEW.md");
    const roadmap = read("docs/roadmap/DEVELOPMENT_SEQUENCE.md");
    expect(overview).not.toContain("Exact-head CI and merge evidence for this parent remain open");
    expect(overview).toContain("P7.1 development integration gate is accepted on `main`");
    expect(overview).toContain("P7.2 Worker resource/process reliability");
    for (const code of incidentCodes) expect(overview).toContain(code);
    expect(overview).toContain("P7.2 Worker resource/process reliability is accepted on `main`");
    expect(overview).toContain("31901651415");
    expect(roadmap).toContain("### P7.2 development integration gate (2026-08-16)");
    expect(roadmap).toContain("General Worker and Goose Worker only");
    expect(roadmap).toContain("31900510574");
    expect(roadmap).toContain("31901651415");
    expect(roadmap).not.toContain("Packaged hostile-process acceptance remains open");
    expect(roadmap).toContain("P7.3 and P7.4");
    expect(roadmap).toContain("remain separate and are not started by this slice");
  });

  it("separates integrated evidence from local provenance and later gates", () => {
    const status = read("docs/PROJECT_STATUS.md");
    expect(status).toContain("### 2026-08-16 P7.2 development integration gate accepted on main");
    expect(status).toContain("[#58](https://github.com/Ablankpaper/actestra-desktop/pull/58)");
    expect(status).toContain("`69dde6adfd44188eec475a55ae02cbab893103b4`");
    expect(status).toContain("`31900510574`");
    expect(status).toContain("`dc904b7b9cf7d0c64c563bcc732547f0ff27ce13`");
    expect(status).toContain("`31901651415`");
    expect(status).toContain(
      "### 2026-08-16 P7.2 pre-merge local implementation gate (superseded)",
    );
    expect(status).toContain("Focused\nresource/reliability tests pass (`9` files, `60` tests)");
    expect(status).toContain("smoke:p7-security` exited 0 with all 7 required cases");
    expect(status).toContain("smoke:p7-2-resource-reliability` exited 0 with all 5 hostile cases");
    expect(status).toContain("This closes the macOS arm64 P7.2 development integration gate");
    expect(status).toContain("does not claim P7.3, P7.4, P8, Windows/Linux enforcement");
    expect(status).toContain(
      "formal signing/notarization, release, deployment, or final user acceptance",
    );
  });
});
