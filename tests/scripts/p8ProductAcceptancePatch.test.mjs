// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const patchPath = path.join(
  repositoryRoot,
  "downstream/aionui-v2.1.41/patches/0023-actestra-product-acceptance-fixes.mjs",
);

describe("P8 product acceptance downstream patch", () => {
  it("declares the five user-visible remediation boundaries", () => {
    const patch = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, "utf8") : "";
    expect(patch).toContain("stream-terminal");
    expect(patch).toContain("optimistic-user");
    expect(patch).toContain("textOnly");
    expect(patch).toContain("team-invalid-request");
    expect(patch).toContain("attempt-failed");
    expect(patch).toContain("chat.history.refresh");
    expect(patch).toContain("generalInputRequired");
    expect(patch).toContain("generalCapabilityMismatch");
    expect(patch).toContain("generalOutputInvalid");
    expect(patch).toContain("generalInstructionNoncompliant");
  });
});
