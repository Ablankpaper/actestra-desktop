// @vitest-environment node

import { chmodSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  startTrustedActestraCodingJourneyRuntime,
  type ActestraCodingModelBinding,
} from "../../apps/desktop/src/main/workers/actestraCodingJourneyRuntime";

const { chmodMock } = vi.hoisted(() => ({
  chmodMock: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, chmod: chmodMock };
});

const artifact = Object.freeze({
  directory: "/tmp/actestra-goose-artifact",
  executablePath: "/tmp/actestra-goose-artifact/actestra-goose-runner",
  executableSha256: "a".repeat(64),
  executableSize: 1,
  targetTriple: "aarch64-apple-darwin",
  gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseVersion: "1.45.0",
  manifestPath: "/tmp/actestra-goose-artifact/actestra-goose-runner.manifest.json",
  manifestSha256: "b".repeat(64),
}) satisfies AdmittedGooseRunnerArtifact;

const runnerAdmission = Object.freeze({
  directory: artifact.directory,
  trustedManifestSha256: artifact.manifestSha256,
  expectedTargetTriple: artifact.targetTriple,
});

const modelBinding = Object.freeze({
  modelId: "actestra.test.model",
  invokeModel: vi.fn(),
}) satisfies ActestraCodingModelBinding;

const roots: string[] = [];

beforeEach(() => {
  chmodMock.mockClear();
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Windows packaged coding journey private-root preparation", () => {
  it("accepts a canonical directory without relying on Unix mode bits", async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "actestra-windows-root-")));
    roots.push(root);
    const userDataPath = root;
    const privateRoot = path.join(userDataPath, "goose-private");
    await mkdir(privateRoot);
    chmodSync(privateRoot, 0o755);

    const onFailure = vi.fn();
    const runtime = await startTrustedActestraCodingJourneyRuntime(
      { userDataPath, runnerAdmission, modelBinding, onFailure },
      {
        admitRunnerArtifact: async () => artifact,
        platform: "win32",
        architecture: "x64",
      },
    );

    expect(runtime).not.toBeNull();
    expect(runtime!.privateRootParent).toBe(privateRoot);
    expect(chmodMock).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});
