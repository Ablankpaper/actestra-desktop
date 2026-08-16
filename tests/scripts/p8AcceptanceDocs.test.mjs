// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("P8.1 acceptance documentation", () => {
  it("indexes accepted ADR-0030 and the human platform matrix", () => {
    const adrPath =
      "docs/architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md";
    const productPath = "docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md";
    expect(fs.existsSync(path.join(root, adrPath))).toBe(true);
    expect(fs.existsSync(path.join(root, productPath))).toBe(true);
    if (![adrPath, productPath].every((entry) => fs.existsSync(path.join(root, entry)))) return;
    const adr = read(adrPath);
    const product = read(productPath);
    expect(adr).toContain("# ADR-0030:");
    expect(adr).toContain("- Status: Accepted");
    expect(read("docs/architecture/decisions/README.md")).toContain(
      "[0030](0030-p8-cross-platform-internal-beta-acceptance.md)",
    );
    expect(read("docs/README.md")).toContain("product/P8_CROSS_PLATFORM_INTERNAL_BETA.md");
    for (const id of ["macos-15-arm64", "windows-11-x64", "ubuntu-24.04-x64"]) {
      expect(adr + product).toContain(id);
    }
    for (const value of ["General", "Goose", "Team", "approval", "recovery", "privacy"]) {
      expect(product).toContain(value);
    }
    expect(adr).toContain("unsupported-platform");
    expect(adr).toContain("does not modify `foundation/`");
    expect(product).toContain("Completing P8.1 does not prove a Windows or Linux build");
    expect(product).toContain("P8.2");
    expect(product).toContain("P8.3");
    expect(product).toContain("P8.4");
  });
});
