// @vitest-environment node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

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
const INTEGRATION_OUTCOMES = Object.freeze({
  initialize: true,
  openSession: true,
  toolDiscovery: true,
  prompt: true,
  toolDenial: true,
  cancellation: true,
  crashRestart: true,
  parentDeath: true,
  cleanup: true,
});
const integrationRoots = [];

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
  const status = "evidence-incomplete";
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
  const integrationRoot = await mkdtemp(path.join(os.tmpdir(), "actestra-integration-evidence-"));
  integrationRoots.push(integrationRoot);
  const integrationEvidencePath = path.join(integrationRoot, "integration-evidence.json");
  await writeFile(
    integrationEvidencePath,
    `${JSON.stringify({
      contractVersion: 1,
      targetTriple,
      sourceCommit: manifest.provenance.actestraCommit,
      executableSha256: manifest.runner.executable.sha256,
      ...INTEGRATION_OUTCOMES,
      status: "verified",
    })}\n`,
    { mode: 0o600 },
  );
  return { directory, manifest, integrationEvidencePath, integrationRoot };
}

function runBinder(fixture, options = {}) {
  const args = [binderPath, options.targetTriple ?? targetTriple, fixture.directory];
  if (options.includeIntegration !== false) {
    args.push(
      options.integrationEvidencePath ?? fixture.integrationEvidencePath,
      options.integrationRoot ?? fixture.integrationRoot,
    );
  }
  return spawnSync("node", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

afterAll(async () => {
  await Promise.all(
    integrationRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Goose containment evidence binding", () => {
  it("atomically binds verified evidence and is idempotent", async () => {
    const fixture = await createFixture();
    try {
      const first = runBinder(fixture);
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

      const second = runBinder(fixture);
      expect(second.status).toBe(0);
      expect(second.stdout).toBe("Goose containment manifest already bound\n");
      expect(second.stderr).toBe("");
      expect(await readFile(manifestPath, "utf8")).toBe(firstBytes);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("leaves the manifest untouched without authenticated integration evidence", async () => {
    const fixture = await createFixture();
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = runBinder(fixture, { includeIntegration: false });

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment integration-evidence-missing\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects integration evidence outside its caller-owned root", async () => {
    const fixture = await createFixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "actestra-outside-evidence-"));
    integrationRoots.push(outsideRoot);
    const outsidePath = path.join(outsideRoot, "integration-evidence.json");
    await writeFile(outsidePath, await readFile(fixture.integrationEvidencePath));
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = runBinder(fixture, { integrationEvidencePath: outsidePath });

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("Goose containment integration-evidence-outside-root\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["mismatched Artifact", "integration-artifact-mismatch", { sourceCommit: "d".repeat(40) }],
    ["incomplete outcome", "integration-evidence-incomplete", { cleanup: false }],
    ["unknown key", "integration-evidence-invalid", { unexpected: true }],
  ])("rejects %s integration evidence before manifest mutation", async (_label, code, mutation) => {
    const fixture = await createFixture();
    try {
      const candidate = JSON.parse(await readFile(fixture.integrationEvidencePath, "utf8"));
      await writeFile(
        fixture.integrationEvidencePath,
        `${JSON.stringify({ ...candidate, ...mutation })}\n`,
      );
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = runBinder(fixture);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe(`Goose containment ${code}\n`);
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["malformed", "integration-evidence-invalid", "{not-json"],
    ["oversized", "integration-evidence-too-large", "x".repeat(65 * 1024)],
  ])("rejects %s integration evidence with a closed code", async (_label, code, contents) => {
    const fixture = await createFixture();
    try {
      await writeFile(fixture.integrationEvidencePath, contents);
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = runBinder(fixture);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe(`Goose containment ${code}\n`);
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("rejects an already-bound manifest when its probe implementation digest drifts", async () => {
    const fixture = await createFixture();
    try {
      const first = runBinder(fixture);
      expect(first.status).toBe(0);

      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const drifted = JSON.parse(await readFile(manifestPath, "utf8"));
      drifted.containment.probeSha256 = "0".repeat(64);
      const driftedBytes = `${JSON.stringify(drifted, null, 2)}\n`;
      await writeFile(manifestPath, driftedBytes, { mode: 0o600 });

      const second = runBinder(fixture);
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
      const result = runBinder(fixture);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Goose containment process-evidence-incomplete\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it("does not reuse Linux integration evidence for an incomplete Windows probe", async () => {
    const fixture = await createFixture(INCOMPLETE_CAPABILITIES);
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = runBinder(fixture, { targetTriple: "x86_64-pc-windows-msvc" });

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("Goose containment process-evidence-incomplete\n");
      expect(await readFile(manifestPath, "utf8")).toBe(before);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["filesystem", "filesystem-evidence-incomplete"],
    ["network", "network-evidence-incomplete"],
    ["parentDeath", "parent-death-evidence-incomplete"],
    ["cleanup", "cleanup-evidence-incomplete"],
  ])("reports the bounded %s blocker without binding", async (capability, code) => {
    const fixture = await createFixture({
      ...VERIFIED_CAPABILITIES,
      [capability]: false,
    });
    try {
      const manifestPath = path.join(fixture.directory, "actestra-goose-runner.manifest.json");
      const before = await readFile(manifestPath, "utf8");
      const result = runBinder(fixture);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`Goose containment ${code}\n`);
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
      const result = runBinder(fixture);
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
      const result = runBinder(fixture);
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
      const result = runBinder(fixture);
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
      const result = runBinder(fixture);
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
