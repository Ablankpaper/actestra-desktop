// @vitest-environment node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CODING_FILE_READ_TOOL_ID } from "../../apps/desktop/src/core";
import {
  GooseAcpHandshakeError,
  GooseAcpSessionError,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { admitGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type {
  GooseLoopbackModelInvocation,
  GooseLoopbackModelInvoker,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import type {
  GooseMcpToolCall,
  GooseMcpToolInvoker,
} from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";
import {
  GooseMcpSessionCompositionError,
  openGooseMcpSessionComposition,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import { GooseRunnerProcessError } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";

vi.mock("../../apps/desktop/src/main/workers/gooseRunnerTarget", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/desktop/src/main/workers/gooseRunnerTarget")>();
  return {
    ...actual,
    resolveGooseRunnerRuntimeTarget(platform: string, architecture: string) {
      return actual.resolveGooseRunnerBuildTarget(platform, architecture);
    },
  };
});

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const artifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
const trustedManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
const evidencePath = process.env.ACTESTRA_GOOSE_NATIVE_INTEGRATION_EVIDENCE_PATH;
const failureEvidencePath = process.env.ACTESTRA_GOOSE_NATIVE_INTEGRATION_FAILURE_EVIDENCE_PATH;
const nativeEnabled =
  process.platform === "linux" &&
  process.arch === "x64" &&
  process.env.ACTESTRA_GOOSE_NATIVE_INTEGRATION === "1" &&
  artifactDirectory !== undefined &&
  trustedManifestSha256 !== undefined &&
  evidencePath !== undefined &&
  failureEvidencePath !== undefined;
const fixtureRoots: string[] = [];

type NativeIntegrationFailureStage =
  | "artifact-admission"
  | "cancellation"
  | "cleanup"
  | "composition-cleanup"
  | "composition-open"
  | "crash"
  | "handshake"
  | "initialize"
  | "parent-death"
  | "prompt"
  | "restart"
  | "runner-spawn"
  | "runtime-network"
  | "runtime-resource"
  | "session-open"
  | "tool-denial"
  | "tool-discovery";

interface NativeIntegrationEvidence {
  contractVersion: 1;
  targetTriple: "x86_64-unknown-linux-gnu";
  sourceCommit: string;
  executableSha256: string;
  initialize: boolean;
  openSession: boolean;
  toolDiscovery: boolean;
  prompt: boolean;
  toolDenial: boolean;
  cancellation: boolean;
  crashRestart: boolean;
  parentDeath: boolean;
  cleanup: boolean;
  status: "verified";
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function markFailureStage(stage: NativeIntegrationFailureStage): Promise<void> {
  await writeFile(failureEvidencePath!, `${JSON.stringify({ contractVersion: 1, stage })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function classifyOpeningFailureStage(error: unknown): NativeIntegrationFailureStage {
  let current = error;
  let fallback: NativeIntegrationFailureStage = "composition-open";
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof GooseRunnerProcessError) {
      if (current.code === "artifact-mismatch") return "artifact-admission";
      if (current.code === "network-policy-unavailable") return "runtime-network";
      if (current.code === "worker-resource-enforcement-unavailable") {
        return "runtime-resource";
      }
      if (current.code === "spawn-failed") return "runner-spawn";
      if (current.code === "cleanup-failed") return "composition-cleanup";
    } else if (current instanceof GooseAcpHandshakeError) {
      fallback = "handshake";
    } else if (current instanceof GooseAcpSessionError) {
      return current.code.startsWith("tool-discovery") ? "tool-discovery" : "session-open";
    } else if (current instanceof GooseMcpSessionCompositionError) {
      if (current.code === "cleanup-failed") return "composition-cleanup";
      if (current.code === "tool-discovery-mismatch") return "tool-discovery";
    }
    current = current.cause;
  }
  return fallback;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("native integration wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function nativeArtifact(): Promise<AdmittedGooseRunnerArtifact> {
  const admitted = await admitGooseRunnerArtifact(artifactDirectory!, {
    expectedTargetTriple: "x86_64-unknown-linux-gnu",
    trustedManifestSha256: trustedManifestSha256!,
  });
  if (admitted.sourceCommit === undefined) {
    throw new Error("native integration artifact lacks its source commit");
  }
  const probe = await readFile(
    path.join(repositoryRoot, "workers/goose-runner/src/containment/linux.rs"),
  );
  return Object.freeze({
    ...admitted,
    containment: Object.freeze({
      contractVersion: 1,
      targetTriple: admitted.targetTriple,
      sourceCommit: admitted.sourceCommit,
      probeSha256: createHash("sha256").update(probe).digest("hex"),
      executableSha256: admitted.executableSha256,
      filesystem: true,
      network: true,
      processTree: true,
      resources: true,
      parentDeath: true,
      cleanup: true,
    }),
  });
}

async function createFixture(): Promise<{
  readonly root: string;
  readonly attempts: string;
  readonly workspace: string;
}> {
  const root = await mkdtemp("/tmp/actestra-linux-acp-");
  fixtureRoots.push(root);
  const attempts = path.join(root, "attempts");
  const workspace = path.join(root, "workspace");
  await Promise.all([mkdir(attempts), mkdir(workspace)]);
  return { root, attempts, workspace };
}

function messageModel(text = "bounded native integration answer"): GooseLoopbackModelInvoker {
  return async () =>
    Object.freeze({
      type: "message" as const,
      text,
      usage: Object.freeze({ promptTokens: 11, completionTokens: 5 }),
    });
}

function deniedToolInvoker(calls: GooseMcpToolCall[]): GooseMcpToolInvoker {
  return async (call) => {
    calls.push(call);
    return Object.freeze({
      isError: true,
      content: JSON.stringify({ contractVersion: 1, type: "approval-denied" }),
    });
  };
}

function unusedToolInvoker(): GooseMcpToolInvoker {
  return async () => {
    throw new Error("native integration did not admit this tool call");
  };
}

async function findRunnerPid(privateRoot: string): Promise<number> {
  let found: number | undefined;
  await waitFor(async () => {
    const entries = await readdir("/proc", { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[1-9][0-9]*$/u.test(entry.name)) continue;
      const commandLine = await readFile(path.join("/proc", entry.name, "cmdline")).catch(
        (): undefined => undefined,
      );
      if (commandLine?.includes(Buffer.from(`${privateRoot}/bin/actestra-goose-runner`))) {
        found = Number(entry.name);
        return true;
      }
    }
    return false;
  });
  if (found === undefined || !Number.isSafeInteger(found)) {
    throw new Error("native integration runner PID was unavailable");
  }
  return found;
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function unixSocketAcceptsConnections(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const finish = (connected: boolean): void => {
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(250, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const evidence: NativeIntegrationEvidence = {
  contractVersion: 1,
  targetTriple: "x86_64-unknown-linux-gnu",
  sourceCommit: "",
  executableSha256: "",
  initialize: false,
  openSession: false,
  toolDiscovery: false,
  prompt: false,
  toolDenial: false,
  cancellation: false,
  crashRestart: false,
  parentDeath: false,
  cleanup: false,
  status: "verified",
};

let artifact: AdmittedGooseRunnerArtifact;

describe.skipIf(!nativeEnabled)("native Linux Goose authenticated composition", () => {
  beforeAll(async () => {
    await markFailureStage("artifact-admission");
    artifact = await nativeArtifact();
    evidence.sourceCommit = artifact.sourceCommit!;
    evidence.executableSha256 = artifact.executableSha256;
  });

  afterAll(async () => {
    const capabilities = [
      evidence.initialize,
      evidence.openSession,
      evidence.toolDiscovery,
      evidence.prompt,
      evidence.toolDenial,
      evidence.cancellation,
      evidence.crashRestart,
      evidence.parentDeath,
      evidence.cleanup,
    ];
    if (!capabilities.every((value) => value === true)) {
      throw new Error("native integration evidence is incomplete");
    }
    await writeFile(evidencePath!, `${JSON.stringify(evidence)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  });

  it("initializes, discovers authenticated tools, and returns a denied tool result", async () => {
    await markFailureStage("composition-open");
    const fixture = await createFixture();
    const toolCalls: GooseMcpToolCall[] = [];
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const modelInvoker: GooseLoopbackModelInvoker = async (invocation) => {
      modelInvocations.push(invocation);
      if (modelInvocations.length === 1) {
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-linux-native-denied-1",
          name: `actestra-capability-proxy__${CODING_FILE_READ_TOOL_ID}`,
          arguments: Object.freeze({ contractVersion: 1, relativePath: "README.md" }),
          usage: Object.freeze({ promptTokens: 13, completionTokens: 7 }),
        });
      }
      return Object.freeze({
        type: "message" as const,
        text: "The Main-owned tool boundary denied the request.",
        usage: Object.freeze({ promptTokens: 17, completionTokens: 6 }),
      });
    };
    const opened = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent: fixture.attempts,
      workspaceDirectory: fixture.workspace,
      modelId: "actestra-linux-native-integration",
      modelInvoker,
      toolInvoker: deniedToolInvoker(toolCalls),
      commandIds: Object.freeze([]),
      testIds: Object.freeze([]),
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    }).catch(async (error: unknown) => {
      await markFailureStage(classifyOpeningFailureStage(error));
      throw error;
    });
    try {
      await markFailureStage("tool-discovery");
      expect(opened.info).toMatchObject({
        protocolVersion: 1,
        agentName: "goose",
        agentVersion: "1.45.0",
      });
      expect(opened.session.sessionId).toEqual(expect.any(String));
      expect(opened.toolNames).toContain(`actestra-capability-proxy__${CODING_FILE_READ_TOOL_ID}`);
      await markFailureStage("prompt");
      const result = await opened.prompt({
        text: "Attempt one bounded read and report the denied outcome.",
        timeoutMs: 30_000,
      });
      await markFailureStage("tool-denial");
      expect(result.stopReason).toBe("end_turn");
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({ toolId: CODING_FILE_READ_TOOL_ID });
      expect(modelInvocations[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            content: expect.stringContaining("approval-denied"),
          }),
        ]),
      );
      evidence.initialize = true;
      evidence.openSession = true;
      evidence.toolDiscovery = true;
      evidence.prompt = true;
      evidence.toolDenial = true;
    } finally {
      const firstClose = opened.close();
      expect(opened.close()).toBe(firstClose);
      await firstClose;
    }
    expect(await readdir(fixture.attempts)).toEqual([]);
  }, 60_000);

  it("cancels an active prompt and removes its bridge and private root", async () => {
    await markFailureStage("cancellation");
    const fixture = await createFixture();
    const invocationStarted = deferred<void>();
    const modelInvoker: GooseLoopbackModelInvoker = async (_invocation, signal) => {
      invocationStarted.resolve();
      return new Promise((_resolve, reject) => {
        const abort = (): void => reject(new Error("native integration model request aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    };
    const opened = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent: fixture.attempts,
      workspaceDirectory: fixture.workspace,
      modelId: "actestra-linux-native-cancellation",
      modelInvoker,
      toolInvoker: unusedToolInvoker(),
      commandIds: Object.freeze([]),
      testIds: Object.freeze([]),
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    const prompting = opened.prompt({ text: "Wait for cancellation.", timeoutMs: 30_000 });
    await invocationStarted.promise;
    const close = opened.close();
    const rejection = await prompting.then(
      () => undefined,
      (error: unknown) => error,
    );
    await close;
    expect(rejection).toEqual(expect.any(Error));
    expect(await readdir(fixture.attempts)).toEqual([]);
    evidence.cancellation = true;
  }, 60_000);

  it("recovers from a runner crash with a clean second composition", async () => {
    await markFailureStage("crash");
    const fixture = await createFixture();
    const invocationStarted = deferred<void>();
    const blockingModel: GooseLoopbackModelInvoker = async (_invocation, signal) => {
      invocationStarted.resolve();
      return new Promise((_resolve, reject) => {
        const abort = (): void => reject(new Error("crashed runner request aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    };
    const first = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent: fixture.attempts,
      workspaceDirectory: fixture.workspace,
      modelId: "actestra-linux-native-crash",
      modelInvoker: blockingModel,
      toolInvoker: unusedToolInvoker(),
      commandIds: Object.freeze([]),
      testIds: Object.freeze([]),
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    const prompting = first.prompt({ text: "Wait for an injected crash.", timeoutMs: 30_000 });
    await invocationStarted.promise;
    const runnerPid = await findRunnerPid(first.privateRoot);
    process.kill(-runnerPid, "SIGKILL");
    await expect(prompting).rejects.toEqual(expect.any(Error));
    await first.close();
    expect(await readdir(fixture.attempts)).toEqual([]);

    await markFailureStage("restart");
    const second = await openGooseMcpSessionComposition({
      artifact,
      privateRootParent: fixture.attempts,
      workspaceDirectory: fixture.workspace,
      modelId: "actestra-linux-native-restart",
      modelInvoker: messageModel("restart succeeded"),
      toolInvoker: unusedToolInvoker(),
      commandIds: Object.freeze([]),
      testIds: Object.freeze([]),
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    try {
      await expect(
        second.prompt({ text: "Return the restart result.", timeoutMs: 30_000 }),
      ).resolves.toMatchObject({ stopReason: "end_turn" });
    } finally {
      await second.close();
    }
    expect(await readdir(fixture.attempts)).toEqual([]);
    evidence.crashRestart = true;
  }, 90_000);

  it("terminates the runner and relay when the Main-style supervisor dies", async () => {
    await markFailureStage("parent-death");
    const fixture = await createFixture();
    const statePath = path.join(fixture.root, "supervisor-state.json");
    const supervisor = spawn(
      "bun",
      ["run", "test", "--", "tests/fixtures/gooseLinuxNativeSupervisorExit.test.ts"],
      {
        cwd: repositoryRoot,
        detached: true,
        env: {
          ...process.env,
          ACTESTRA_GOOSE_NATIVE_SUPERVISOR: "1",
          ACTESTRA_GOOSE_NATIVE_SUPERVISOR_ROOT: fixture.root,
          ACTESTRA_GOOSE_NATIVE_SUPERVISOR_STATE: statePath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let state:
      | {
          readonly privateRoot: string;
          readonly runnerPid: number;
          readonly capabilitySocketPath: string;
          readonly modelSocketPath: string;
        }
      | undefined;
    try {
      await waitFor(async () => {
        const bytes = await readFile(statePath).catch((): undefined => undefined);
        if (bytes === undefined) return false;
        state = JSON.parse(bytes.toString("utf8"));
        return Number.isSafeInteger(state?.runnerPid);
      }, 30_000);
      process.kill(-supervisor.pid!, "SIGKILL");
      await waitFor(() => !processIsAlive(state!.runnerPid), 5_000);
      expect(await unixSocketAcceptsConnections(state!.capabilitySocketPath)).toBe(false);
      expect(await unixSocketAcceptsConnections(state!.modelSocketPath)).toBe(false);
      evidence.parentDeath = true;
    } finally {
      if (supervisor.pid !== undefined && processIsAlive(supervisor.pid)) {
        process.kill(-supervisor.pid, "SIGKILL");
      }
      if (state !== undefined && processIsAlive(state.runnerPid)) {
        process.kill(-state.runnerPid, "SIGKILL");
      }
      if (state !== undefined) {
        await rm(state.privateRoot, { recursive: true, force: true });
      }
    }
    expect(await readdir(fixture.attempts)).toEqual([]);
  }, 60_000);

  it("leaves no private-root residue after all Main-owned cleanup paths", async () => {
    await markFailureStage("cleanup");
    for (const root of fixtureRoots) {
      const attempts = path.join(root, "attempts");
      const entries = await readdir(attempts);
      expect(entries).toEqual([]);
    }
    evidence.cleanup = true;
  });
});

afterAll(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
