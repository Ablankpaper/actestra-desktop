import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { CODING_FILE_READ_TOOL_ID, CODING_TOOL_IDS } from "../../apps/desktop/src/core";
import { openGooseMcpSessionComposition } from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import { admitGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type {
  GooseMcpToolCall,
  GooseMcpToolInvoker,
} from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";
import type {
  GooseLoopbackModelInvocation,
  GooseLoopbackModelInvoker,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";

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
    const toolCalls: GooseMcpToolCall[] = [];
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const toolInvoker: GooseMcpToolInvoker = async (call) => {
      toolCalls.push(call);
      return Object.freeze({
        isError: false,
        content: JSON.stringify({
          contractVersion: 1,
          type: "integration-result",
          text: "integration tool result",
        }),
      });
    };
    const modelInvoker: GooseLoopbackModelInvoker = async (invocation) => {
      modelInvocations.push(invocation);
      if (modelInvocations.length === 1) {
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-actestra-integration-1",
          name: `actestra-capability-proxy__${CODING_FILE_READ_TOOL_ID}`,
          arguments: Object.freeze({ contractVersion: 1, relativePath: "README.md" }),
          usage: Object.freeze({ promptTokens: 31, completionTokens: 7 }),
        });
      }
      if (modelInvocations.length === 2) {
        return Object.freeze({
          type: "message" as const,
          text: "integration final answer",
          usage: Object.freeze({ promptTokens: 47, completionTokens: 4 }),
        });
      }
      throw new Error("Goose exceeded the admitted two-round integration exchange");
    };

    const opened = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent,
      workspaceDirectory,
      modelId: "actestra-loopback-integration",
      modelInvoker,
      toolInvoker,
      commandIds: Object.freeze(["format-check"]),
      testIds: Object.freeze(["focused-tests"]),
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    try {
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

      const prompt = await opened.prompt({
        text: "Read README.md through the admitted Actestra tool and return its result.",
        timeoutMs: 30_000,
      });
      expect(prompt.stopReason).toBe("end_turn");
      expect(prompt.usage).toEqual({
        totalTokens: 51,
        inputTokens: 47,
        outputTokens: 4,
      });
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({
        sessionId: opened.session.sessionId,
        toolId: CODING_FILE_READ_TOOL_ID,
        input: { contractVersion: 1, relativePath: "README.md" },
      });
      expect(modelInvocations).toHaveLength(2);
      expect(modelInvocations[0]!.sessionId).toBe(opened.session.sessionId);
      expect(JSON.stringify(modelInvocations[1]!.request)).toContain("integration tool result");
      expect(prompt.updates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_call" }),
          expect.objectContaining({ type: "tool_call_update", status: "completed" }),
          expect.objectContaining({
            type: "agent_message_chunk",
            text: "integration final answer",
          }),
        ]),
      );
    } finally {
      await opened.close();
    }
    expect(await readdir(privateRootParent)).toEqual([]);
  }, 60_000);
});
