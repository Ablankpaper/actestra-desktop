import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { CODING_TOOL_IDS } from "../../apps/desktop/src/core";
import { openGooseMcpSessionComposition } from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import { admitGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";

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
  it("admits the exact artifact, discovers authenticated MCP tools, and leaves no private root", async () => {
    const artifact = await admitGooseRunnerArtifact(artifactDirectory!, {
      expectedTargetTriple: targetTriple!,
      trustedManifestSha256: trustedManifestSha256!,
    });
    const privateRootParent = await mkdtemp(path.join(os.tmpdir(), "actestra-real-goose-"));
    const workspaceDirectory = await mkdtemp(path.join(os.tmpdir(), "actestra-real-workspace-"));
    fixtureDirectories.push(privateRootParent, workspaceDirectory);

    const opened = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent,
      workspaceDirectory,
      modelId: "actestra-loopback-integration",
      commandIds: Object.freeze(["format-check"]),
      testIds: Object.freeze(["focused-tests"]),
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    expect(opened.info).toMatchObject({
      protocolVersion: 1,
      agentName: "goose",
      agentVersion: "1.45.0",
    });
    expect(opened.session).toMatchObject({
      setupNotificationKinds: expect.arrayContaining(["available_commands_update"]),
    });
    expect(opened.session.sessionId).toEqual(expect.any(String));
    expect([...opened.toolNames].sort()).toEqual(
      CODING_TOOL_IDS.map((toolId) => `actestra-capability-proxy__${toolId}`).sort(),
    );
    expect(await readdir(privateRootParent)).toHaveLength(1);

    await opened.close();
    expect(await readdir(privateRootParent)).toEqual([]);
  });
});
