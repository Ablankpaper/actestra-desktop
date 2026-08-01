import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { admitGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { openGooseRunnerHandshake } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";

const artifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
const trustedManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
const fixtureDirectories: string[] = [];
const targetTriple =
  process.platform === "darwin" && process.arch === "arm64"
    ? "aarch64-apple-darwin"
    : process.platform === "darwin" && process.arch === "x64"
      ? "x86_64-apple-darwin"
      : undefined;

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe.skipIf(
  artifactDirectory === undefined ||
    trustedManifestSha256 === undefined ||
    targetTriple === undefined,
)("real Goose runner handshake", () => {
  it("admits the exact artifact, initializes over sandboxed stdio, and leaves no private root", async () => {
    const artifact = await admitGooseRunnerArtifact(artifactDirectory!, {
      expectedTargetTriple: targetTriple!,
      trustedManifestSha256: trustedManifestSha256!,
    });
    const privateRootParent = await mkdtemp(path.join(os.tmpdir(), "actestra-real-goose-"));
    fixtureDirectories.push(privateRootParent);

    const opened = await openGooseRunnerHandshake({
      artifact,
      privateRootParent,
      handshakeTimeoutMs: 20_000,
    });
    expect(opened.info).toMatchObject({
      protocolVersion: 1,
      agentName: "goose",
      agentVersion: "1.45.0",
    });
    expect(await readdir(privateRootParent)).toHaveLength(1);

    await opened.close();
    expect(await readdir(privateRootParent)).toEqual([]);
  });
});
