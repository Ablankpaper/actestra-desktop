// @vitest-environment node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CODING_FILE_READ_TOOL_ID } from "../../apps/desktop/src/core";
import {
  GooseAcpHandshakeError,
  GooseAcpSessionError,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";
import { GooseBridgeSocketError } from "../../apps/desktop/src/main/workers/gooseBridgeSocket";
import { GooseContainmentError } from "../../apps/desktop/src/main/workers/gooseRunnerContainment";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { admitInstalledGooseRunnerLinuxPackage } from "../../apps/desktop/src/main/workers/gooseRunnerLinuxPackage";
import {
  GOOSE_LINUX_EXECUTABLE_PATH,
  GOOSE_LINUX_RESOURCES_PATH,
} from "../../apps/desktop/src/shared/gooseRunnerLinuxPackage";
import {
  GooseLoopbackModelServerError,
  type GooseLoopbackModelInvocation,
  type GooseLoopbackModelInvoker,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import {
  GooseMcpCapabilityServerError,
  type GooseMcpToolCall,
  type GooseMcpToolInvoker,
} from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";
import {
  GooseMcpSessionCompositionError,
  openGooseMcpSessionComposition,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import { GooseRunnerProcessError } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import {
  type LinuxProcessGroupReadFailure,
  readLinuxProcessGroupIdResult,
} from "./gooseLinuxProcessDiagnostics";

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
const nativeCommandIds = Object.freeze(["git.status"]);
const nativeTestIds = Object.freeze(["git.diff-check"]);

type NativeIntegrationFailureStage =
  | "artifact-admission"
  | "bridge-capability-open"
  | "bridge-config"
  | "bridge-model-open"
  | "bridge-open"
  | "bridge-port-reservation"
  | "bridge-socket-listen"
  | "bridge-socket-permission"
  | "bridge-socket-state"
  | "cancellation"
  | "cleanup"
  | "composition-cleanup"
  | "composition-open"
  | "crash"
  | "handshake"
  | "handshake-process-exit"
  | "handshake-process-signal"
  | "handshake-cleanup"
  | "handshake-response"
  | "handshake-timeout"
  | "handshake-transport"
  | "handshake-transport-process"
  | "handshake-transport-stderr"
  | "handshake-transport-stdin"
  | "handshake-transport-stdout"
  | "initialize"
  | "launch-contract"
  | "parent-death"
  | "parent-death-supervisor-group-missing"
  | "parent-death-supervisor-group-inaccessible"
  | "parent-death-supervisor-group-malformed"
  | "parent-death-supervisor-group-unavailable"
  | "parent-death-runner-group-missing"
  | "parent-death-runner-group-inaccessible"
  | "parent-death-runner-group-malformed"
  | "parent-death-runner-group-unavailable"
  | "parent-death-supervisor-not-exited"
  | "parent-death-capability-owner-mismatch"
  | "parent-death-model-owner-mismatch"
  | "parent-death-capability-orphan-owner"
  | "parent-death-model-orphan-owner"
  | "parent-death-capability-owner-unresolved"
  | "parent-death-model-owner-unresolved"
  | "parent-death-capability-owner-not-listed"
  | "parent-death-model-owner-not-listed"
  | "parent-death-capability-owner-no-visible-process"
  | "parent-death-model-owner-no-visible-process"
  | "parent-death-capability-owner-scan-failed"
  | "parent-death-model-owner-scan-failed"
  | "parent-death-capability-owner-fd-inaccessible"
  | "parent-death-model-owner-fd-inaccessible"
  | "parent-death-capability-owner-process-race"
  | "parent-death-model-owner-process-race"
  | "parent-death-runner-not-exited"
  | "parent-death-capability-socket"
  | "parent-death-model-socket"
  | "parent-death-private-root"
  | "prompt"
  | "restart"
  | "runner-open"
  | "runner-acp"
  | "runner-panic"
  | "runner-relay"
  | "runner-runtime"
  | "runner-process-spawn"
  | "runner-stdin"
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

function processGroupCaptureFailureStage(
  role: "supervisor" | "runner",
  reason: LinuxProcessGroupReadFailure,
): NativeIntegrationFailureStage {
  return `parent-death-${role}-group-${reason}` as NativeIntegrationFailureStage;
}

function classifyOpeningFailureStage(error: unknown): NativeIntegrationFailureStage {
  let current = error;
  let fallback: NativeIntegrationFailureStage = "composition-open";
  for (let depth = 0; depth < 6 && current instanceof Error; depth += 1) {
    if (current instanceof GooseRunnerProcessError) {
      if (current.code === "artifact-mismatch") return "artifact-admission";
      if (current.code === "network-policy-unavailable") return "runtime-network";
      if (current.code === "worker-resource-enforcement-unavailable") {
        return "runtime-resource";
      }
      if (current.code === "invalid-options") return "launch-contract";
      if (current.code === "spawn-failed") {
        if (current.message === "Failed to launch Goose ACP process") {
          return "runner-process-spawn";
        }
        if (current.message === "Goose stdin is not writable") return "runner-stdin";
        if (current.message === "Goose async runtime failed") return "runner-runtime";
        if (current.message === "Goose ACP server failed") return "runner-acp";
        if (current.message === "Goose Linux relay stopped") return "runner-relay";
        if (current.message === "Goose runner panicked") return "runner-panic";
        if (current.message === "Goose handshake launch failed") {
          fallback = "runner-open";
        } else {
          return "runner-spawn";
        }
      }
      if (current.code === "cleanup-failed") return "composition-cleanup";
    } else if (current instanceof GooseContainmentError) {
      return current.code === "network-policy-unavailable" ? "runtime-network" : "launch-contract";
    } else if (current instanceof GooseBridgeSocketError) {
      if (current.code === "invalid-config") return "bridge-config";
      if (current.message === "Goose bridge loopback port could not be reserved") {
        return "bridge-port-reservation";
      }
      if (
        current.message === "Goose bridge socket path could not be inspected" ||
        current.message === "Goose bridge socket path is occupied by a non-socket entry" ||
        current.message === "Goose bridge socket path is already owned by another listener"
      ) {
        return "bridge-socket-state";
      }
      if (current.message === "Goose bridge Unix socket permissions could not be established") {
        return "bridge-socket-permission";
      }
      if (current.message === "Goose bridge server could not start") {
        return "bridge-socket-listen";
      }
      fallback = "bridge-open";
    } else if (current instanceof GooseMcpCapabilityServerError) {
      fallback = current.code === "invalid-config" ? "bridge-config" : "bridge-capability-open";
    } else if (current instanceof GooseLoopbackModelServerError) {
      fallback = current.code === "invalid-config" ? "bridge-config" : "bridge-model-open";
    } else if (current instanceof GooseAcpHandshakeError) {
      if (current.code === "process-exit") return "handshake-process-exit";
      if (current.code === "process-signal") return "handshake-process-signal";
      if (current.code === "startup-timeout") return "handshake-timeout";
      if (current.code === "transport-error") {
        fallback = "handshake-transport";
      } else {
        return "handshake-response";
      }
    } else if (current instanceof GooseAcpSessionError) {
      return current.code.startsWith("tool-discovery") ? "tool-discovery" : "session-open";
    } else if (current instanceof GooseMcpSessionCompositionError) {
      if (current.code === "cleanup-failed") return "composition-cleanup";
      if (current.code === "tool-discovery-mismatch") return "tool-discovery";
    } else if (current instanceof AggregateError) {
      return "handshake-cleanup";
    } else if (current.message === "Goose stdin stream failed") {
      return "handshake-transport-stdin";
    } else if (
      current.message === "Goose stdout stream failed" ||
      current.message === "Goose ACP stdout line exceeded the bounded frame size"
    ) {
      return "handshake-transport-stdout";
    } else if (
      current.message === "Goose stderr stream failed" ||
      current.message === "Goose stderr exceeded the bounded diagnostic size"
    ) {
      return "handshake-transport-stderr";
    } else if (current.message === "Goose child process emitted an error") {
      return "handshake-transport-process";
    }
    current = current.cause;
  }
  return fallback;
}

describe("native Linux integration opening failure staging", () => {
  it("does not let the generic handshake-launch wrapper hide a launch-contract failure", () => {
    const error = new GooseRunnerProcessError("spawn-failed", "Goose handshake launch failed", {
      cause: new GooseContainmentError("invalid-options", "fixed internal diagnostic"),
    });

    expect(classifyOpeningFailureStage(error)).toBe("launch-contract");
  });

  it.each([
    [new GooseBridgeSocketError("invalid-config", "fixed internal diagnostic"), "bridge-config"],
    [
      new GooseMcpCapabilityServerError("listen-failed", "fixed internal diagnostic"),
      "bridge-capability-open",
    ],
    [
      new GooseLoopbackModelServerError("listen-failed", "fixed internal diagnostic"),
      "bridge-model-open",
    ],
    [
      new GooseBridgeSocketError(
        "listen-failed",
        "Goose bridge loopback port could not be reserved",
      ),
      "bridge-port-reservation",
    ],
    [
      new GooseBridgeSocketError(
        "listen-failed",
        "Goose bridge socket path is already owned by another listener",
      ),
      "bridge-socket-state",
    ],
    [
      new GooseBridgeSocketError(
        "listen-failed",
        "Goose bridge Unix socket permissions could not be established",
      ),
      "bridge-socket-permission",
    ],
    [
      new GooseBridgeSocketError("listen-failed", "Goose bridge server could not start"),
      "bridge-socket-listen",
    ],
  ])("classifies the typed bridge sub-boundary without retaining its message", (cause, stage) => {
    const error = new GooseRunnerProcessError("spawn-failed", "Goose handshake launch failed", {
      cause,
    });

    expect(classifyOpeningFailureStage(error)).toBe(stage);
  });

  it.each([
    ["Failed to launch Goose ACP process", "runner-process-spawn"],
    ["Goose stdin is not writable", "runner-stdin"],
  ])("separates the fixed %s failure from the generic spawn bucket", (message, stage) => {
    expect(classifyOpeningFailureStage(new GooseRunnerProcessError("spawn-failed", message))).toBe(
      stage,
    );
  });

  it.each([
    [
      new GooseAcpHandshakeError("process-exit", "fixed internal diagnostic"),
      "handshake-process-exit",
    ],
    [
      new GooseAcpHandshakeError("transport-error", "fixed internal diagnostic"),
      "handshake-transport",
    ],
    [
      new GooseAcpHandshakeError("startup-timeout", "fixed internal diagnostic"),
      "handshake-timeout",
    ],
    [
      new GooseAcpHandshakeError("invalid-message", "fixed internal diagnostic"),
      "handshake-response",
    ],
    [
      new GooseAcpHandshakeError("unexpected-capabilities", "fixed internal diagnostic"),
      "handshake-response",
    ],
  ])("classifies the closed ACP handshake sub-boundary", (error, stage) => {
    expect(classifyOpeningFailureStage(error)).toBe(stage);
  });

  it.each([
    ["network-policy-unavailable", "runtime-network"],
    ["worker-resource-enforcement-unavailable", "runtime-resource"],
  ] as const)("keeps %s ahead of the transport fallback", (code, stage) => {
    const error = new GooseAcpHandshakeError("transport-error", "fixed internal diagnostic", {
      cause: new GooseRunnerProcessError(code, "fixed internal diagnostic"),
    });

    expect(classifyOpeningFailureStage(error)).toBe(stage);
  });

  it.each([
    ["Goose async runtime failed", "runner-runtime"],
    ["Goose ACP server failed", "runner-acp"],
    ["Goose Linux relay stopped", "runner-relay"],
    ["Goose runner panicked", "runner-panic"],
  ])("classifies the fixed runner marker %s", (message, stage) => {
    const error = new GooseAcpHandshakeError("transport-error", "fixed internal diagnostic", {
      cause: new GooseRunnerProcessError("spawn-failed", message),
    });

    expect(classifyOpeningFailureStage(error)).toBe(stage);
  });

  it.each([
    ["Goose stdin stream failed", "handshake-transport-stdin"],
    ["Goose stdout stream failed", "handshake-transport-stdout"],
    ["Goose ACP stdout line exceeded the bounded frame size", "handshake-transport-stdout"],
    ["Goose stderr stream failed", "handshake-transport-stderr"],
    ["Goose stderr exceeded the bounded diagnostic size", "handshake-transport-stderr"],
    ["Goose child process emitted an error", "handshake-transport-process"],
  ])("classifies the fixed transport source %s", (message, stage) => {
    const error = new GooseAcpHandshakeError("transport-error", "fixed internal diagnostic", {
      cause: new Error(message),
    });

    expect(classifyOpeningFailureStage(error)).toBe(stage);
  });

  it("separates handshake cleanup from its original transport failure", () => {
    const error = new GooseAcpHandshakeError("transport-error", "fixed internal diagnostic", {
      cause: new AggregateError([new Error("fixed internal diagnostic")]),
    });

    expect(classifyOpeningFailureStage(error)).toBe("handshake-cleanup");
  });

  it("separates a signal-terminated initialize from an ordinary process exit", () => {
    expect(
      classifyOpeningFailureStage(
        new GooseAcpHandshakeError("process-signal", "fixed internal diagnostic"),
      ),
    ).toBe("handshake-process-signal");
  });
});

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
  const installed = await admitInstalledGooseRunnerLinuxPackage(GOOSE_LINUX_RESOURCES_PATH);
  if (installed === null) {
    throw new Error("native integration Linux Goose package admission failed");
  }
  const admitted = installed.artifact;
  if (admitted.manifestSha256 !== trustedManifestSha256) {
    throw new Error("native integration package manifest differs from the admitted build");
  }
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
  const executableNeedle =
    process.platform === "linux"
      ? GOOSE_LINUX_EXECUTABLE_PATH
      : `${privateRoot}/bin/actestra-goose-runner`;
  let found: number | undefined;
  await waitFor(async () => {
    const entries = await readdir("/proc", { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[1-9][0-9]*$/u.test(entry.name)) continue;
      const commandLine = await readFile(path.join("/proc", entry.name, "cmdline")).catch(
        (): undefined => undefined,
      );
      if (commandLine?.includes(Buffer.from(executableNeedle))) {
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

async function readProcessUid(processId: number): Promise<number> {
  const status = await readFile(path.join("/proc", String(processId), "status"), "utf8");
  const uid = status.match(/^Uid:\s+(\d+)/mu)?.[1];
  if (uid === undefined) throw new Error("native integration runner UID was unavailable");
  return Number(uid);
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function linuxProcessStatIsExecuting(value: string): boolean {
  const commandEnd = value.lastIndexOf(")");
  if (commandEnd < 1 || value[commandEnd + 1] !== " " || value[commandEnd + 3] !== " ") {
    return true;
  }
  const state = value[commandEnd + 2];
  return state !== "Z" && state !== "X" && state !== "x";
}

async function linuxProcessIsExecuting(processId: number): Promise<boolean> {
  try {
    const stat = await readFile(path.join("/proc", String(processId), "stat"), "utf8");
    return linuxProcessStatIsExecuting(stat);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

describe("native Linux process execution state", () => {
  it.each([
    ["R", true],
    ["S", true],
    ["Z", false],
    ["X", false],
    ["x", false],
  ])("treats /proc state %s as executing=%s", (state, executing) => {
    expect(linuxProcessStatIsExecuting(`123 (actestra-goose-runner) ${state} 1 2 3`)).toBe(
      executing,
    );
  });

  it("fails closed when the bounded /proc stat shape is malformed", () => {
    expect(linuxProcessStatIsExecuting("malformed process state")).toBe(true);
  });
});

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

interface LinuxUnixSocketOwnerScan {
  readonly listed: boolean;
  readonly owners: ReadonlySet<number>;
  readonly inaccessible: boolean;
  readonly processRace: boolean;
}

async function readLinuxUnixSocketOwnerProcessIds(
  socketPath: string,
  relevantProcessGroups: ReadonlySet<number>,
  relevantProcessIds: ReadonlySet<number>,
  phase: "pre-kill" | "post-kill",
): Promise<LinuxUnixSocketOwnerScan> {
  if (relevantProcessGroups.size === 0 || relevantProcessIds.size === 0) {
    throw new Error("native integration relevant process groups were unavailable");
  }
  const table = await readFile("/proc/net/unix", "utf8");
  if (Buffer.byteLength(table, "utf8") > 1024 * 1024) {
    throw new Error("native integration Unix socket table exceeded its bound");
  }
  const lines = table.split("\n");
  if (lines.length > 65_536) {
    throw new Error("native integration Unix socket table contained too many entries");
  }
  const entry = lines
    .map((line) => line.trim().split(/\s+/u))
    .find(
      (fields) =>
        fields.length >= 8 && fields[5] === "01" && fields.slice(7).join(" ") === socketPath,
    );
  const inode = entry?.[6];
  if (inode === undefined || !/^[1-9][0-9]*$/u.test(inode)) {
    return Object.freeze({
      listed: false,
      owners: new Set<number>(),
      inaccessible: false,
      processRace: false,
    });
  }
  const processes = await readdir("/proc", { withFileTypes: true });
  if (processes.length > 4_096) {
    throw new Error("native integration process table exceeded its bound");
  }
  const owners = new Set<number>();
  let inaccessible = false;
  let processRace = false;
  const socketDescriptor = `socket:[${inode}]`;
  for (const processEntry of processes) {
    if (!processEntry.isDirectory() || !/^[1-9][0-9]*$/u.test(processEntry.name)) continue;
    const processId = Number(processEntry.name);
    const processGroupResult = await readLinuxProcessGroupIdResult(processId);
    if (processGroupResult.kind === "failure") {
      if (relevantProcessIds.has(processId)) {
        if (processGroupResult.reason === "missing" && phase === "post-kill") {
          processRace = true;
          continue;
        }
        throw new Error("native integration relevant process group could not be read");
      }
      continue;
    }
    const processGroup = processGroupResult.processGroupId;
    if (!relevantProcessGroups.has(processGroup)) continue;
    const descriptors = await readdir(path.join("/proc", processEntry.name, "fd")).catch(
      (error: unknown): undefined => {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM") inaccessible = true;
        else if (code === "ENOENT") processRace = true;
        else throw error;
        return undefined;
      },
    );
    if (descriptors === undefined) continue;
    if (descriptors.length > 4_096) {
      throw new Error("native integration descriptor table exceeded its bound");
    }
    for (const descriptor of descriptors) {
      const target = await readlink(path.join("/proc", processEntry.name, "fd", descriptor)).catch(
        (error: unknown): undefined => {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "EACCES" || code === "EPERM") inaccessible = true;
          else if (code === "ENOENT") processRace = true;
          else throw error;
          return undefined;
        },
      );
      if (target === socketDescriptor) {
        owners.add(processId);
        break;
      }
    }
  }
  return Object.freeze({ listed: true, owners, inaccessible, processRace });
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
          arguments: Object.freeze({
            contractVersion: 1,
            relativePath: "README.md",
          }),
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
      commandIds: nativeCommandIds,
      testIds: nativeTestIds,
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
      const currentUid = process.getuid?.();
      expect(currentUid).toBeDefined();
      expect(currentUid).not.toBe(0);
      expect(await readProcessUid(await findRunnerPid(opened.privateRoot))).toBe(currentUid);
      await markFailureStage("prompt");
      const result = await opened.prompt({
        text: "Attempt one bounded read and report the denied outcome.",
        timeoutMs: 30_000,
      });
      await markFailureStage("tool-denial");
      expect(result.stopReason).toBe("end_turn");
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({
        toolId: CODING_FILE_READ_TOOL_ID,
      });
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
      commandIds: nativeCommandIds,
      testIds: nativeTestIds,
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    const prompting = opened.prompt({
      text: "Wait for cancellation.",
      timeoutMs: 30_000,
    });
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
      commandIds: nativeCommandIds,
      testIds: nativeTestIds,
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    const prompting = first.prompt({
      text: "Wait for an injected crash.",
      timeoutMs: 30_000,
    });
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
      commandIds: nativeCommandIds,
      testIds: nativeTestIds,
      handshakeTimeoutMs: 20_000,
      sessionTimeoutMs: 30_000,
    });
    try {
      await expect(
        second.prompt({
          text: "Return the restart result.",
          timeoutMs: 30_000,
        }),
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
    const supervisorFixture = path.join(
      repositoryRoot,
      "tests/fixtures/gooseLinuxNativeSupervisorExit.ts",
    );
    const supervisor = spawn("bun", [supervisorFixture], {
      cwd: repositoryRoot,
      detached: true,
      env: {
        ...process.env,
        ACTESTRA_GOOSE_NATIVE_SUPERVISOR: "1",
        ACTESTRA_GOOSE_NATIVE_SUPERVISOR_ROOT: fixture.root,
        ACTESTRA_GOOSE_NATIVE_SUPERVISOR_STATE: statePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      const supervisorPid = supervisor.pid;
      if (supervisorPid === undefined) {
        throw new Error("native integration supervisor PID was unavailable");
      }
      const relevantProcessIds = new Set([supervisorPid, state!.runnerPid]);
      const processGroupResults = await Promise.all([
        readLinuxProcessGroupIdResult(supervisorPid),
        readLinuxProcessGroupIdResult(state!.runnerPid),
      ]);
      const processGroupRoles = ["supervisor", "runner"] as const;
      for (const [index, result] of processGroupResults.entries()) {
        if (result.kind === "failure") {
          await markFailureStage(
            processGroupCaptureFailureStage(processGroupRoles[index], result.reason),
          );
          throw new Error("native integration relevant process groups were unavailable");
        }
      }
      const relevantProcessGroups = new Set(
        processGroupResults.map((result) => {
          if (result.kind !== "ok") {
            throw new Error("native integration relevant process groups were unavailable");
          }
          return result.processGroupId;
        }),
      );
      const capabilityOwners = await readLinuxUnixSocketOwnerProcessIds(
        state!.capabilitySocketPath,
        relevantProcessGroups,
        relevantProcessIds,
        "pre-kill",
      ).catch((): undefined => undefined);
      if (
        capabilityOwners === undefined ||
        !capabilityOwners.listed ||
        capabilityOwners.owners.size !== 1 ||
        !capabilityOwners.owners.has(supervisorPid)
      ) {
        await markFailureStage("parent-death-capability-owner-mismatch");
        throw new Error("native integration capability listener ownership was invalid");
      }
      const modelOwners = await readLinuxUnixSocketOwnerProcessIds(
        state!.modelSocketPath,
        relevantProcessGroups,
        relevantProcessIds,
        "pre-kill",
      ).catch((): undefined => undefined);
      if (
        modelOwners === undefined ||
        !modelOwners.listed ||
        modelOwners.owners.size !== 1 ||
        !modelOwners.owners.has(supervisorPid)
      ) {
        await markFailureStage("parent-death-model-owner-mismatch");
        throw new Error("native integration model listener ownership was invalid");
      }
      process.kill(-supervisorPid, "SIGKILL");
      try {
        await waitFor(async () => !(await linuxProcessIsExecuting(supervisorPid)), 5_000);
      } catch (error) {
        await markFailureStage("parent-death-supervisor-not-exited");
        throw error;
      }
      try {
        await waitFor(async () => !(await linuxProcessIsExecuting(state!.runnerPid)), 5_000);
      } catch (error) {
        await markFailureStage("parent-death-runner-not-exited");
        throw error;
      }
      await markFailureStage("parent-death-capability-socket");
      if (await unixSocketAcceptsConnections(state!.capabilitySocketPath)) {
        const scan = await readLinuxUnixSocketOwnerProcessIds(
          state!.capabilitySocketPath,
          relevantProcessGroups,
          relevantProcessIds,
          "post-kill",
        ).catch((): undefined => undefined);
        if (scan === undefined) {
          await markFailureStage("parent-death-capability-owner-scan-failed");
        } else if (!scan.listed) {
          await markFailureStage("parent-death-capability-owner-not-listed");
        } else if (scan.owners.size > 0) {
          await markFailureStage("parent-death-capability-orphan-owner");
        } else if (scan.inaccessible) {
          await markFailureStage("parent-death-capability-owner-fd-inaccessible");
        } else if (scan.processRace) {
          await markFailureStage("parent-death-capability-owner-process-race");
        } else {
          await markFailureStage("parent-death-capability-owner-no-visible-process");
        }
        throw new Error("native integration capability listener survived supervisor death");
      }
      await markFailureStage("parent-death-model-socket");
      if (await unixSocketAcceptsConnections(state!.modelSocketPath)) {
        const scan = await readLinuxUnixSocketOwnerProcessIds(
          state!.modelSocketPath,
          relevantProcessGroups,
          relevantProcessIds,
          "post-kill",
        ).catch((): undefined => undefined);
        if (scan === undefined) {
          await markFailureStage("parent-death-model-owner-scan-failed");
        } else if (!scan.listed) {
          await markFailureStage("parent-death-model-owner-not-listed");
        } else if (scan.owners.size > 0) {
          await markFailureStage("parent-death-model-orphan-owner");
        } else if (scan.inaccessible) {
          await markFailureStage("parent-death-model-owner-fd-inaccessible");
        } else if (scan.processRace) {
          await markFailureStage("parent-death-model-owner-process-race");
        } else {
          await markFailureStage("parent-death-model-owner-no-visible-process");
        }
        throw new Error("native integration model listener survived supervisor death");
      }
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
    await markFailureStage("parent-death-private-root");
    expect(await readdir(fixture.attempts)).toEqual([]);
    evidence.parentDeath = true;
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
