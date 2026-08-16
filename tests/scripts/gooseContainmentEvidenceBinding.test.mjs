// @vitest-environment node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const binderPath = path.join(repositoryRoot, "scripts/record-goose-runner-containment.mjs");
const targetTriple = "x86_64-unknown-linux-gnu";
const VERIFIED_CAPABILITIES = Object.freeze({
  cleanup: true,
  filesystem: true,
  network: true,
  parentDeath: true,
  processTree: true,
  resources: true,
});
const INCOMPLETE_CAPABILITIES = Object.freeze({
  cleanup: false,
  filesystem: false,
  network: false,
  parentDeath: false,
  processTree: false,
  resources: false,
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function currentCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}

async function createFixture(
  capabilities = VERIFIED_CAPABILITIES,
  parent = path.join(repositoryRoot, ".actestra", "goose-runner"),
  executableFile = "probe",
  probeSha256,
  probeStderr,
) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "containment-test-"));
  const probeDigestExpression = probeSha256 ?? "$ACTESTRA_GOOSE_PROBE_SHA256";
  const diagnostic =
    probeStderr === undefined ? "" : `printf '%b' ${JSON.stringify(probeStderr)} >&2\n`;
  const status = Object.values(capabilities).every((value) => value === true)
    ? "verified"
    : "evidence-incomplete";
  const executable = `#!/bin/sh\n${diagnostic}printf '{"contractVersion":1,"targetTriple":"%s","sourceCommit":"%s","probeSha256":"%s","executableSha256":"%s","filesystem":${String(capabilities.filesystem)},"network":${String(capabilities.network)},"processTree":${String(capabilities.processTree)},"resources":${String(capabilities.resources)},"parentDeath":${String(capabilities.parentDeath)},"cleanup":${String(capabilities.cleanup)},"status":"${status}"}' "$ACTESTRA_GOOSE_TARGET_TRIPLE" "$ACTESTRA_GOOSE_SOURCE_COMMIT" "${probeDigestExpression}" "$ACTESTRA_GOOSE_EXECUTABLE_SHA256"\n`;
  const executableBytes = Buffer.from(executable, "utf8");
  await writeFile(path.join(directory, "probe"), executableBytes, { mode: 0o700 });
  await chmod(path.join(directory, "probe"), 0o700);
  const manifest = {
    runner: {
      executable: {
        file: executableFile,
        sha256: sha256(executableBytes),
        size: executableBytes.byteLength,
      },
    },
    provenance: { actestraCommit: currentCommit() },
  };
  await writeFile(
    path.join(directory, "actestra-goose-runner.manifest.json"),
    `${JSON.stringify(manifest)}\n`,
    { mode: 0o600 },
  );
  return { directory, manifest };
}

describe("Goose containment evidence binding", () => {
  it("atomically binds verified evidence and is idempotent", async () => {
    const fixture = await createFixture();
    try {
      const first = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(first.status).toBe(0);
      expect(first.stdout).toBe("Goose containment manifest bound\n");
      expect(first.stderr).toBe("");
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const firstBytes = await readFile(manifestPath, "utf8");
      const bound = JSON.parse(firstBytes);
      expect(bound.containment).toEqual({
        cleanup: true,
        contractVersion: 1,
        executableSha256: fixture.manifest.runner.executable.sha256,
        filesystem: true,
        network: true,
        parentDeath: true,
        probeSha256: expect.any(String),
        processTree: true,
        resources: true,
        sourceCommit: fixture.manifest.provenance.actestraCommit,
        targetTriple,
      });
      expect(bound.containment).not.toHaveProperty("status");

      const second = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(second.status).toBe(0);
      expect(second.stdout).toBe("Goose containment manifest already bound\n");
      expect(second.stderr).toBe("");
      expect(await readFile(manifestPath, "utf8")).toBe(firstBytes);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects an already-bound manifest when its probe implementation digest drifts", async () => {
    const fixture = await createFixture();
    try {
      const first = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(first.status).toBe(0);

      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const drifted = JSON.parse(await readFile(manifestPath, "utf8"));
      drifted.containment.probeSha256 = "0".repeat(64);
      const driftedBytes = `${JSON.stringify(drifted, null, 2)}\n`;
      await writeFile(manifestPath, driftedBytes, { mode: 0o600 });

      const second = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(second.status).toBe(2);
      expect(second.stdout).toBe("");
      expect(second.stderr).toBe("Goose containment artifact-mismatch\n");
      expect(await readFile(manifestPath, "utf8")).toBe(driftedBytes);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("leaves the manifest untouched when the native probe is incomplete", async () => {
    const fixture = await createFixture(INCOMPLETE_CAPABILITIES);
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment process-evidence-incomplete\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("reports bounded remaining evidence when process and resources pass without binding", async () => {
    const fixture = await createFixture({
      ...INCOMPLETE_CAPABILITIES,
      processTree: true,
      resources: true,
    });
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment remaining-evidence-incomplete\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("reports only a closed native resource blocker and drops raw probe stderr", async () => {
    const fixture = await createFixture(
      INCOMPLETE_CAPABILITIES,
      undefined,
      "probe",
      undefined,
      "/Users/private/secret\nGoose resource probe failed at bounded stage resource-rlimit-mismatch\n",
    );
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment resource-rlimit-mismatch\n");
      expect(result.stderr).not.toContain("/Users/private/secret");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("leaves the manifest untouched when the probe implementation digest drifts", async () => {
    const fixture = await createFixture(VERIFIED_CAPABILITIES, undefined, "probe", "0".repeat(64));
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment artifact-mismatch\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects an artifact directory outside the owned runner root without mutation", async () => {
    const fixture = await createFixture(VERIFIED_CAPABILITIES, os.tmpdir());
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment artifact-directory-outside-trust-root\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("redacts unexpected filesystem errors instead of echoing their path", async () => {
    const fixture = await createFixture();
    const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
    try {
      await chmod(manifestPath, 0o000);
      const result = spawnSync("node", [binderPath, targetTriple, fixture.directory], {
        cwd: repositoryRoot,
        encoding: "utf8",
      });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment containment-bind-failed\n");
      expect(result.stderr).not.toContain(fixture.directory);
    } finally {
      await chmod(manifestPath, 0o600).catch(() => undefined);
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
