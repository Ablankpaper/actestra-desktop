// @vitest-environment node

import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitGooseRunnerPackage,
  type AdmittedGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";

const roots: string[] = [];
const sourceCommit = "c".repeat(40);
const PACKAGE_RUNNER_DIRECTORY = "actestra-goose-runner";
const PACKAGE_ATTESTATION_FILE = "actestra-goose-runner-package.json";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function packageFixture(targetTriple = "aarch64-apple-darwin") {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "actestra-goose-package-")));
  roots.push(root);
  const resourcesPath = path.join(root, "Resources");
  const runnerDirectory = path.join(resourcesPath, PACKAGE_RUNNER_DIRECTORY);
  await mkdir(runnerDirectory, { recursive: true, mode: 0o755 });
  const executableFile =
    targetTriple === "x86_64-pc-windows-msvc"
      ? "actestra-goose-runner.exe"
      : "actestra-goose-runner";
  const executableBytes = Buffer.from("runner-bytes");
  const manifestBytes = Buffer.from("manifest-bytes");
  const files = [
    "GOOSE-APACHE-2.0.txt",
    "Cargo.lock",
    executableFile,
    "actestra-goose-runner.audit.json",
    "actestra-goose-runner.cdx.json",
    "actestra-goose-runner.manifest.json",
  ];
  for (const file of files) {
    const contents =
      file === executableFile
        ? executableBytes
        : file === "actestra-goose-runner.manifest.json"
          ? manifestBytes
          : Buffer.from(file);
    await writeFile(path.join(runnerDirectory, file), contents, {
      mode: file === executableFile ? 0o555 : 0o644,
    });
  }
  if (process.platform !== "win32") {
    await chmod(path.join(runnerDirectory, executableFile), 0o555);
  }
  const attestation = {
    contractVersion: 1,
    targetTriple,
    sourceCommit,
    runnerManifestSha256: sha256(manifestBytes),
    executableSha256: sha256(executableBytes),
    executableFile,
    runnerDirectory: PACKAGE_RUNNER_DIRECTORY,
    files: files.map((file) => `${PACKAGE_RUNNER_DIRECTORY}/${file}`),
  };
  await writeFile(
    path.join(resourcesPath, PACKAGE_ATTESTATION_FILE),
    `${JSON.stringify(attestation)}\n`,
    { mode: 0o644 },
  );
  const canonicalRunnerDirectory = await realpath(runnerDirectory);
  const artifact = Object.freeze({
    directory: canonicalRunnerDirectory,
    executablePath: path.join(canonicalRunnerDirectory, executableFile),
    executableSha256: sha256(executableBytes),
    executableSize: executableBytes.byteLength,
    targetTriple,
    sourceCommit,
    gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
    gooseVersion: "1.45.0",
    manifestPath: path.join(canonicalRunnerDirectory, "actestra-goose-runner.manifest.json"),
    manifestSha256: sha256(manifestBytes),
  }) satisfies AdmittedGooseRunnerArtifact;
  return { resourcesPath, runnerDirectory: canonicalRunnerDirectory, artifact, attestation };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("packaged Goose runner admission", () => {
  it("re-admits the exact runner package from Electron resources and binds its attestation", async () => {
    const fixture = await packageFixture();
    const admitRunnerArtifact = vi.fn(async () => fixture.artifact);

    const admitted = await admitGooseRunnerPackage(fixture.resourcesPath, {
      expectedTargetTriple: "aarch64-apple-darwin",
      admitRunnerArtifact,
    });

    expect(admitRunnerArtifact).toHaveBeenCalledWith(fixture.runnerDirectory, {
      trustedManifestSha256: fixture.attestation.runnerManifestSha256,
      expectedTargetTriple: "aarch64-apple-darwin",
    });
    expect(admitted.resourcesPath).toBe(fixture.resourcesPath);
    expect(admitted.runnerDirectory).toBe(fixture.runnerDirectory);
    expect(admitted.sourceCommit).toBe(sourceCommit);
    expect(admitted.artifact).toBe(fixture.artifact);
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it("rejects a package-root symlink and executable digest drift before admission", async () => {
    const fixture = await packageFixture();
    const admitRunnerArtifact = vi.fn(async () => fixture.artifact);
    const linkedResources = `${fixture.resourcesPath}-link`;
    await symlink(fixture.resourcesPath, linkedResources);
    roots.push(linkedResources);

    await expect(
      admitGooseRunnerPackage(linkedResources, {
        expectedTargetTriple: "aarch64-apple-darwin",
        admitRunnerArtifact,
      }),
    ).rejects.toThrow();
    expect(admitRunnerArtifact).not.toHaveBeenCalled();

    const executablePath = path.join(fixture.runnerDirectory, "actestra-goose-runner");
    await chmod(executablePath, 0o755);
    await writeFile(
      executablePath,
      await readFile(executablePath).then((bytes) => Buffer.concat([bytes, Buffer.from("drift")])),
      { mode: 0o555 },
    );
    await expect(
      admitGooseRunnerPackage(fixture.resourcesPath, {
        expectedTargetTriple: "aarch64-apple-darwin",
        admitRunnerArtifact,
      }),
    ).rejects.toThrow();
    expect(admitRunnerArtifact).not.toHaveBeenCalled();
  });
});
