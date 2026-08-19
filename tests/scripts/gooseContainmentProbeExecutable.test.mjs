// @vitest-environment node

import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  LINUX_INSTALLED_GOOSE_EXECUTABLE_PATH,
  resolveGooseContainmentProbeExecutable,
} from "../../scripts/gooseContainmentProbeExecutable.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Goose containment probe executable selection", () => {
  it("keeps the artifact executable for non-packaged probes", async () => {
    expect(LINUX_INSTALLED_GOOSE_EXECUTABLE_PATH).toBe(
      "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
    );
    await expect(
      resolveGooseContainmentProbeExecutable({
        targetTriple: "x86_64-unknown-linux-gnu",
        artifactExecutablePath: "/trusted/artifact/actestra-goose-runner",
        artifactExecutableSha256: "a".repeat(64),
        artifactExecutableSize: 1,
      }),
    ).resolves.toBe("/trusted/artifact/actestra-goose-runner");
  });

  it("accepts the exact installed executable when its bytes and ownership match", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "actestra-probe-executable-"));
    const executablePath = path.join(root, "runner");
    const bytes = Buffer.from("runner-bytes\n", "utf8");
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    try {
      await writeFile(executablePath, bytes, { mode: 0o555 });
      await chmod(executablePath, 0o555);
      const canonicalExecutablePath = await realpath(executablePath);
      await expect(
        resolveGooseContainmentProbeExecutable({
          targetTriple: "x86_64-unknown-linux-gnu",
          artifactExecutablePath: "/trusted/artifact/actestra-goose-runner",
          artifactExecutableSha256: sha256(bytes),
          artifactExecutableSize: bytes.byteLength,
          requestedExecutablePath: canonicalExecutablePath,
          expectedLinuxExecutablePath: canonicalExecutablePath,
          expectedOwnerUid: uid,
        }),
      ).resolves.toBe(canonicalExecutablePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a non-fixed installed path without exposing the path", async () => {
    await expect(
      resolveGooseContainmentProbeExecutable({
        targetTriple: "x86_64-unknown-linux-gnu",
        artifactExecutablePath: "/trusted/artifact/actestra-goose-runner",
        artifactExecutableSha256: "a".repeat(64),
        artifactExecutableSize: 1,
        requestedExecutablePath: "/tmp/private-runner",
      }),
    ).rejects.toThrow("probe-executable-path-invalid");
  });

  it("rejects symlinked installed files before resolving them", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "actestra-probe-executable-"));
    const targetPath = path.join(root, "target");
    const linkPath = path.join(root, "link");
    try {
      await writeFile(targetPath, "runner\n", { mode: 0o555 });
      await symlink(targetPath, linkPath);
      await expect(
        resolveGooseContainmentProbeExecutable({
          targetTriple: "x86_64-unknown-linux-gnu",
          artifactExecutablePath: "/trusted/artifact/actestra-goose-runner",
          artifactExecutableSha256: sha256(await readFile(targetPath)),
          artifactExecutableSize: 7,
          requestedExecutablePath: linkPath,
          expectedLinuxExecutablePath: linkPath,
        }),
      ).rejects.toThrow("probe-executable-invalid");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
