// @vitest-environment node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const stageScriptPath = path.join(repositoryRoot, "scripts/stage-aionui-linux-goose-package.ts");
const overlayPath = path.join(repositoryRoot, "downstream/aionui-v2.1.41/overlay.json");
const fixtures = [];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "actestra-linux-package-stage-"));
  fixtures.push(root);
  const artifactDirectory = path.join(root, "artifact");
  const materializedRoot = path.join(root, "aionui-v2.1.41");
  const profilePath = path.join(root, "profile");
  await mkdir(artifactDirectory, { recursive: true });
  await mkdir(path.join(materializedRoot, "packages/desktop/resources"), { recursive: true });
  const files = {
    executable: Buffer.from("runner-bytes"),
    manifest: Buffer.from("manifest-bytes"),
    sbom: Buffer.from("sbom-bytes"),
    audit: Buffer.from("audit-bytes"),
    lock: Buffer.from("lock-bytes"),
    license: Buffer.from("license-bytes"),
  };
  await Promise.all([
    writeFile(path.join(artifactDirectory, "actestra-goose-runner"), files.executable),
    writeFile(path.join(artifactDirectory, "actestra-goose-runner.manifest.json"), files.manifest),
    writeFile(path.join(artifactDirectory, "actestra-goose-runner.cdx.json"), files.sbom),
    writeFile(path.join(artifactDirectory, "actestra-goose-runner.audit.json"), files.audit),
    writeFile(path.join(artifactDirectory, "Cargo.lock"), files.lock),
    writeFile(path.join(artifactDirectory, "GOOSE-APACHE-2.0.txt"), files.license),
    writeFile(profilePath, "profile bytes\n"),
  ]);
  await chmod(path.join(artifactDirectory, "actestra-goose-runner"), 0o500);
  const admitted = Object.freeze({
    directory: artifactDirectory,
    executablePath: path.join(artifactDirectory, "actestra-goose-runner"),
    executableSha256: digest(files.executable),
    executableSize: files.executable.byteLength,
    targetTriple: "x86_64-unknown-linux-gnu",
    gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
    gooseVersion: "1.45.0",
    manifestPath: path.join(artifactDirectory, "actestra-goose-runner.manifest.json"),
    manifestSha256: digest(files.manifest),
  });
  return { root, artifactDirectory, materializedRoot, profilePath, admitted, files };
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Ubuntu Goose package staging", () => {
  it("copies exactly the admitted six-file Artifact and emits a sibling record", async () => {
    expect(existsSync(stageScriptPath)).toBe(true);
    if (!existsSync(stageScriptPath)) return;
    const stage = await import(pathToFileURL(stageScriptPath).href);
    const fixtureValue = await fixture();
    const result = await stage.stageAionuiLinuxGoosePackage({
      artifactDirectory: fixtureValue.artifactDirectory,
      materializedRoot: fixtureValue.materializedRoot,
      profilePath: fixtureValue.profilePath,
      trustedManifestSha256: fixtureValue.admitted.manifestSha256,
      admitRunnerArtifact: vi.fn(async () => fixtureValue.admitted),
    });

    expect(result.files).toEqual([
      "actestra-goose-runner/GOOSE-APACHE-2.0.txt",
      "actestra-goose-runner/Cargo.lock",
      "actestra-goose-runner/actestra-goose-runner",
      "actestra-goose-runner/actestra-goose-runner.audit.json",
      "actestra-goose-runner/actestra-goose-runner.cdx.json",
      "actestra-goose-runner/actestra-goose-runner.manifest.json",
      "actestra-goose-runner-admission.json",
    ]);
    const record = JSON.parse(
      await readFile(
        path.join(fixtureValue.materializedRoot, "resources/actestra-goose-runner-admission.json"),
        "utf8",
      ),
    );
    expect(record).toEqual({
      contractVersion: 1,
      targetTriple: "x86_64-unknown-linux-gnu",
      runnerManifestSha256: fixtureValue.admitted.manifestSha256,
      executableSha256: fixtureValue.admitted.executableSha256,
      profileSha256: digest(Buffer.from("profile bytes\n")),
      profileName: "Actestra-Goose-Runner",
      executablePath: "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
    });
    expect(result.runnerDirectory).toBe(
      path.join(fixtureValue.materializedRoot, "resources/actestra-goose-runner"),
    );
    expect(await readdir(path.join(fixtureValue.materializedRoot, "resources"))).toEqual([
      "actestra-apparmor-profile",
      "actestra-goose-runner",
      "actestra-goose-runner-admission.json",
    ]);
    const stagedExecutable = await lstat(
      path.join(result.runnerDirectory, "actestra-goose-runner"),
    );
    expect(stagedExecutable.mode & 0o111).toBe(0o111);
    expect(stagedExecutable.mode & 0o022).toBe(0);
  });

  it("rejects a symlinked or unexpected Artifact entry before staging", async () => {
    expect(existsSync(stageScriptPath)).toBe(true);
    if (!existsSync(stageScriptPath)) return;
    const stage = await import(pathToFileURL(stageScriptPath).href);
    const fixtureValue = await fixture();
    await symlink(
      path.join(fixtureValue.artifactDirectory, "Cargo.lock"),
      path.join(fixtureValue.artifactDirectory, "unexpected"),
    );
    await expect(
      stage.stageAionuiLinuxGoosePackage({
        artifactDirectory: fixtureValue.artifactDirectory,
        materializedRoot: fixtureValue.materializedRoot,
        profilePath: fixtureValue.profilePath,
        trustedManifestSha256: fixtureValue.admitted.manifestSha256,
        admitRunnerArtifact: vi.fn(async () => fixtureValue.admitted),
      }),
    ).rejects.toThrow(/six-file|artifact|regular|unexpected/u);
  });

  it("registers the profile and package resources in downstream patch metadata", async () => {
    const overlay = JSON.parse(await readFile(overlayPath, "utf8"));
    const patch = overlay.patches.find(
      (entry) => entry.path === "patches/0021-actestra-ubuntu-apparmor-bootstrap.mjs",
    );
    expect(patch).toMatchObject({ classification: ["R1"] });
    expect(overlay.assetCopies).toContainEqual(
      expect.objectContaining({
        source: "apps/desktop/resources/linux/actestra-apparmor-profile",
      }),
    );
    expect(overlay.expectedChangedFiles).toContain("packages/desktop/electron-builder.yml");
  });
});
