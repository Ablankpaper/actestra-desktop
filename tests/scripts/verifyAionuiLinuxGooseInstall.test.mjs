// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyAionuiLinuxGooseInstall } from "../../scripts/verify-aionui-linux-goose-install.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

describe("installed Ubuntu Goose package verifier", () => {
  it("is registered as the package-admission gate", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
    );

    expect(packageJson.scripts["goose:runner:admit-package:linux"]).toBe(
      "bun scripts/verify-aionui-linux-goose-install.ts",
    );
  });

  it("returns only bound digests after successful Main-owned admission", async () => {
    await expect(
      verifyAionuiLinuxGooseInstall(async () => ({
        ok: true,
        value: {
          artifact: {
            targetTriple: "x86_64-unknown-linux-gnu",
            manifestSha256: "a".repeat(64),
            executableSha256: "b".repeat(64),
          },
          record: { profileSha256: "c".repeat(64) },
        },
      })),
    ).resolves.toEqual({
      status: "verified",
      targetTriple: "x86_64-unknown-linux-gnu",
      runnerManifestSha256: "a".repeat(64),
      executableSha256: "b".repeat(64),
      profileSha256: "c".repeat(64),
    });
  });

  it("returns the closed rejection code without retaining diagnostics", async () => {
    const value = await verifyAionuiLinuxGooseInstall(async () => ({
      ok: false,
      code: "linux-package-path-metadata-invalid",
      diagnostic: "/private/path must not cross this boundary",
    }));

    expect(value).toEqual({
      status: "failed",
      code: "linux-package-path-metadata-invalid",
    });
    expect(JSON.stringify(value)).not.toContain("/private/path");
  });
});
