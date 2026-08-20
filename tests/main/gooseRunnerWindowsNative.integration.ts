// @vitest-environment node

import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import sourceContract from "../../apps/desktop/src/shared/gooseRunnerSource.json";
import {
  classifyGooseWindowsCodingSessionOpenError,
  classifyGooseWindowsOpeningFailure,
} from "../../scripts/gooseWindowsRuntimeEvidence.mjs";
import {
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  approvalActorId,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type DomainGraph,
} from "../../apps/desktop/src/core";
import { createIsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { createGooseCodingToolInvoker } from "../../apps/desktop/src/main/workers/gooseCodingToolInvoker";
import {
  openGooseMcpSessionComposition,
  type GooseMcpSessionComposition,
} from "../../apps/desktop/src/main/workers/gooseMcpSessionComposition";
import {
  GooseRunnerArtifactError,
  admitGooseRunnerArtifact,
  type AdmittedGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import { createGooseRunnerEnvironment } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import type {
  GooseLoopbackModelInvocation,
  GooseLoopbackModelInvoker,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";
import type {
  GooseMcpToolCall,
  GooseMcpToolInvoker,
} from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const artifactDirectory = process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR;
const trustedManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
const evidencePath = process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_EVIDENCE_PATH;
const failureEvidencePath = process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_FAILURE_EVIDENCE_PATH;
const containmentEvidenceSha256 = process.env.ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_SHA256;
const nativeEnabled =
  process.platform === "win32" &&
  process.arch === "x64" &&
  process.env.ACTESTRA_GOOSE_WINDOWS_RUNTIME_INTEGRATION === "1" &&
  artifactDirectory !== undefined &&
  trustedManifestSha256 !== undefined &&
  evidencePath !== undefined &&
  failureEvidencePath !== undefined &&
  containmentEvidenceSha256 !== undefined;
const fixtureRoots: string[] = [];
const codingFixtures: CodingFixture[] = [];

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

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Windows runtime integration wait timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function markFailure(stage: string): Promise<void> {
  await writeFile(failureEvidencePath!, `${JSON.stringify({ contractVersion: 1, stage })}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function runGit(repository: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: {
      ComSpec: process.env.ComSpec ?? "",
      GIT_CONFIG_GLOBAL: "NUL",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      TEMP: process.env.TEMP ?? os.tmpdir(),
      TMP: process.env.TMP ?? os.tmpdir(),
      WINDIR: process.env.WINDIR ?? "",
    },
    maxBuffer: 64 * 1024,
  });
  return result.stdout.trim();
}

async function admitArtifact(): Promise<AdmittedGooseRunnerArtifact> {
  return admitGooseRunnerArtifact(artifactDirectory!, {
    expectedTargetTriple: "x86_64-pc-windows-msvc",
    trustedManifestSha256: trustedManifestSha256!,
  });
}

interface CodingFixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly sourceFile: string;
  readonly privateRootParent: string;
  readonly persistence: Awaited<ReturnType<typeof openTestPersistenceUtility>>["client"];
  readonly mainService: ReturnType<typeof createIsolatedCodingMainService>;
  readonly clock: DeterministicAgentClock;
  readonly workspace: ReturnType<typeof workspaceId>;
  readonly task: ReturnType<typeof taskId>;
  readonly session: ReturnType<typeof sessionId>;
  readonly worker: ReturnType<typeof workerId>;
}

function graph(fixture: {
  readonly workspace: ReturnType<typeof workspaceId>;
  readonly task: ReturnType<typeof taskId>;
  readonly session: ReturnType<typeof sessionId>;
  readonly worker: ReturnType<typeof workerId>;
  readonly now: ReturnType<typeof instant>;
}): DomainGraph {
  return {
    workspaces: [
      {
        id: fixture.workspace,
        name: "Windows authenticated runtime fixture",
        state: "active",
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
    ],
    tasks: [
      {
        id: fixture.task,
        workspaceId: fixture.workspace,
        title: "Verify Windows authenticated runtime",
        state: "running",
        activeSessionId: fixture.session,
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
    ],
    workers: [
      {
        id: fixture.worker,
        workspaceId: fixture.workspace,
        adapterKind: "goose",
        state: "busy",
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
    ],
    sessions: [
      {
        id: fixture.session,
        workspaceId: fixture.workspace,
        taskId: fixture.task,
        workerId: fixture.worker,
        state: "running",
        createdAt: fixture.now,
        updatedAt: fixture.now,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

async function createFixture(suffix: string): Promise<CodingFixture> {
  await markFailure("fixture-filesystem");
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "actestra-goose-windows-runtime-")),
  );
  fixtureRoots.push(root);
  const sourceRoot = path.join(root, "source");
  const sourceFile = path.join(sourceRoot, "answer.txt");
  const privateRootParent = path.join(root, "goose-private");
  await Promise.all([mkdir(sourceRoot), mkdir(privateRootParent)]);
  await markFailure("fixture-git-init");
  await runGit(sourceRoot, "init", "--initial-branch=main");
  await markFailure("fixture-git-config");
  await runGit(sourceRoot, "config", "user.name", "Actestra Test");
  await runGit(sourceRoot, "config", "user.email", "actestra-test@example.invalid");
  await markFailure("fixture-git-commit");
  await writeFile(sourceFile, "before\n", "utf8");
  await runGit(sourceRoot, "add", "answer.txt");
  await runGit(sourceRoot, "commit", "-m", "fixture");
  await markFailure("fixture-persistence-open");
  const { client: persistence } = await openTestPersistenceUtility(
    path.join(root, "product-state"),
  );
  const clock = new DeterministicAgentClock(instant("2026-08-20T00:00:00.000Z"));
  const ids = {
    workspace: workspaceId(`windows-runtime-workspace-${suffix}`),
    task: taskId(`windows-runtime-task-${suffix}`),
    session: sessionId(`windows-runtime-session-${suffix}`),
    worker: workerId(`windows-runtime-worker-${suffix}`),
    now: clock.now(),
  };
  await markFailure("fixture-domain-state");
  await persistence.replaceDomainGraph(graph(ids));
  const mainService = createIsolatedCodingMainService({
    persistence,
    clock,
    managedRoot: path.join(root, "coding-worktrees"),
  });
  const fixture = Object.freeze({
    root,
    sourceRoot,
    sourceFile,
    privateRootParent,
    persistence,
    mainService,
    clock,
    workspace: ids.workspace,
    task: ids.task,
    session: ids.session,
    worker: ids.worker,
  });
  codingFixtures.push(fixture);
  return fixture;
}

function toolName(toolId: string): string {
  return `actestra-capability-proxy__${toolId}`;
}

async function processExists(processId: number): Promise<boolean> {
  try {
    await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `if (Get-Process -Id ${String(processId)} -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`,
      ],
      { windowsHide: true },
    );
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) return false;
    throw error;
  }
}

async function parentDeathProbe(artifact: AdmittedGooseRunnerArtifact): Promise<number> {
  const root = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-windows-parent-death-"));
  fixtureRoots.push(root);
  const workspace = path.join(root, "workspace");
  const privateRootParent = path.join(root, "attempts");
  const statePath = path.join(root, "state.json");
  await Promise.all([mkdir(workspace), mkdir(privateRootParent)]);
  await writeFile(path.join(workspace, "answer.txt"), "before\n", "utf8");
  const child = spawn(
    "bun",
    [path.join(repositoryRoot, "tests/fixtures/gooseWindowsRuntimeSupervisorExit.ts")],
    {
      cwd: repositoryRoot,
      env: {
        APPDATA: process.env.APPDATA ?? "",
        ComSpec: process.env.ComSpec ?? "",
        LOCALAPPDATA: process.env.LOCALAPPDATA ?? "",
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        TEMP: process.env.TEMP ?? os.tmpdir(),
        TMP: process.env.TMP ?? os.tmpdir(),
        USERPROFILE: process.env.USERPROFILE ?? "",
        WINDIR: process.env.WINDIR ?? "",
        ACTESTRA_GOOSE_WINDOWS_RUNTIME_SUPERVISOR_EXIT: "1",
        ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIR: artifact.directory,
        ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256: artifact.manifestSha256,
        ACTESTRA_GOOSE_WINDOWS_RUNTIME_SUPERVISOR_ROOT: root,
        ACTESTRA_GOOSE_WINDOWS_RUNTIME_SUPERVISOR_STATE: statePath,
      },
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
    },
  );
  let state: { readonly privateRoot: string; readonly processIds: readonly number[] } | undefined;
  try {
    await waitFor(async () => {
      const bytes = await readFile(statePath).catch((): undefined => undefined);
      if (bytes === undefined) return false;
      state = JSON.parse(bytes.toString("utf8"));
      return Array.isArray(state?.processIds) && state.processIds.length >= 2;
    }, 45_000);
    const stableState = state;
    if (stableState === undefined) throw new Error("Windows runtime parent-death state is missing");
    child.kill();
    const observedProcessIds = [
      ...(child.pid === undefined ? [] : [child.pid]),
      ...stableState.processIds,
    ];
    await waitFor(async () =>
      (await Promise.all(observedProcessIds.map((processId) => processExists(processId)))).every(
        (alive) => !alive,
      ),
    );
    return (
      await Promise.all(observedProcessIds.map((processId) => processExists(processId)))
    ).filter(Boolean).length;
  } finally {
    if (child.pid !== undefined && (await processExists(child.pid))) child.kill();
  }
}

function assertClosedEnvironmentCanaries(privateRoot: string): void {
  const environment = createGooseRunnerEnvironment(privateRoot);
  expect(environment).not.toHaveProperty("ACTESTRA_ENVIRONMENT_CANARY");
  expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
  expect(environment).not.toHaveProperty("OPENAI_API_KEY");
  expect(environment).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
}

async function closeComposition(
  opened: GooseMcpSessionComposition | undefined,
  closeCoding: (() => Promise<void>) | undefined,
): Promise<void> {
  await opened?.close().catch((): undefined => undefined);
  await closeCoding?.().catch((): undefined => undefined);
}

describe.skipIf(!nativeEnabled)("native Windows Goose authenticated runtime composition", () => {
  it("binds the exact runtime journey and lifecycle evidence", async () => {
    await markFailure("artifact-admission");
    let artifact: AdmittedGooseRunnerArtifact;
    try {
      artifact = await admitArtifact();
    } catch (error) {
      await markFailure(
        error instanceof GooseRunnerArtifactError
          ? `artifact-admission-${error.code}`
          : "artifact-admission-unexpected",
      );
      throw error;
    }
    await markFailure("artifact-binding-incomplete");
    if (artifact.sourceCommit === undefined || artifact.containment === undefined) {
      throw new Error("Windows runtime integration requires exact containment-bound provenance");
    }
    await markFailure("fixture-setup");
    const fixture = await createFixture("journey");
    await markFailure("fixture-baseline");
    const baseHead = await runGit(fixture.sourceRoot, "rev-parse", "HEAD");
    const baseStatus = await runGit(fixture.sourceRoot, "status", "--porcelain=v1");
    const baseBytes = await readFile(fixture.sourceFile, "utf8");
    const modelInvocations: GooseLoopbackModelInvocation[] = [];
    const toolCalls: GooseMcpToolCall[] = [];
    const cancellationStarted = deferred<void>();
    let cancellationSignalAborted = false;
    let writeApprovalObserved = false;
    const modelInvoker: GooseLoopbackModelInvoker = async (invocation, signal) => {
      modelInvocations.push(invocation);
      switch (modelInvocations.length) {
        case 1:
          return Object.freeze({
            type: "tool-call" as const,
            callId: "windows-runtime-read",
            name: toolName(CODING_FILE_READ_TOOL_ID),
            arguments: Object.freeze({ contractVersion: 1, relativePath: "answer.txt" }),
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          });
        case 2:
          return Object.freeze({
            type: "message" as const,
            text: "Read acknowledgement.",
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          });
        case 3:
          return Object.freeze({
            type: "tool-call" as const,
            callId: "windows-runtime-write",
            name: toolName(CODING_FILE_WRITE_TOOL_ID),
            arguments: Object.freeze({
              contractVersion: 1,
              relativePath: "windows-runtime-acceptance.txt",
              content: "Windows authenticated runtime accepted.\n",
            }),
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          });
        case 4:
          return Object.freeze({
            type: "message" as const,
            text: "Approved write completed.",
            usage: Object.freeze({ promptTokens: 1, completionTokens: 1 }),
          });
        case 5:
          cancellationStarted.resolve();
          return new Promise((_resolve, reject) => {
            const abort = (): void => {
              cancellationSignalAborted = true;
              reject(new Error("Windows runtime cancellation observed"));
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        default:
          throw new Error("Windows runtime model sequence exceeded its bounded contract");
      }
    };
    await markFailure("coding-session-open");
    let codingSession;
    try {
      codingSession = await fixture.mainService.open({
        repositoryRoot: fixture.sourceRoot,
        workspaceId: fixture.workspace,
        grantId: workspaceGrantId(`windows-runtime-grant-${fixture.task}`),
        displayName: "Windows runtime acceptance workspace",
        commands: {},
        tests: {},
      });
    } catch (error) {
      await markFailure(classifyGooseWindowsCodingSessionOpenError(error));
      throw error;
    }
    const toolInvoker = createGooseCodingToolInvoker({
      persistence: fixture.persistence,
      clock: fixture.clock,
      session: codingSession,
      taskId: fixture.task,
      sessionId: fixture.session,
      workerId: fixture.worker,
      approvalDecisionHandler: async (request) => {
        expect(request.approval).toMatchObject({
          state: "pending",
          operation: {
            toolId: CODING_FILE_WRITE_TOOL_ID,
            action: "workspace.modify",
          },
        });
        writeApprovalObserved = true;
        return Object.freeze({
          decision: "approved" as const,
          actorId: approvalActorId("actestra-windows-runtime-approval"),
        });
      },
    });
    const recordingToolInvoker: GooseMcpToolInvoker = async (call) => {
      toolCalls.push(call);
      return toolInvoker(call);
    };
    let opened: GooseMcpSessionComposition | undefined;
    let acceptanceBytes = "";
    let acpInitialized = false;
    let exactToolCount = 0;
    try {
      try {
        opened = await openGooseMcpSessionComposition({
          artifact,
          privateRootParent: fixture.privateRootParent,
          workspaceDirectory: codingSession.worktreeRoot,
          modelId: "actestra-windows-runtime-test",
          modelInvoker,
          toolInvoker: recordingToolInvoker,
          commandIds: [],
          testIds: [],
          handshakeTimeoutMs: 30_000,
          sessionTimeoutMs: 60_000,
        });
      } catch (error) {
        await markFailure(classifyGooseWindowsOpeningFailure(error));
        throw error;
      }
      acpInitialized =
        opened.info.agentName === "goose" &&
        opened.info.agentVersion === sourceContract.goose.version;
      exactToolCount = opened.toolNames.length;
      await markFailure("read-tool");
      await expect(
        opened.prompt({ text: "Read answer.txt and acknowledge the result.", timeoutMs: 30_000 }),
      ).resolves.toMatchObject({ stopReason: "end_turn" });
      await markFailure("approved-write-tool");
      await expect(
        opened.prompt({ text: "Write the approved acceptance file.", timeoutMs: 30_000 }),
      ).resolves.toMatchObject({ stopReason: "end_turn" });
      acceptanceBytes = await readFile(
        path.join(codingSession.worktreeRoot, "windows-runtime-acceptance.txt"),
        "utf8",
      );
      await markFailure("cancellation");
      const prompting = opened.prompt({ text: "Wait for cancellation.", timeoutMs: 30_000 });
      await cancellationStarted.promise;
      const closing = opened.close();
      await expect(prompting).rejects.toEqual(expect.any(Error));
      await closing;
      opened = undefined;
    } finally {
      await closeComposition(opened, () => codingSession.close());
    }
    expect(acceptanceBytes).toBe("Windows authenticated runtime accepted.\n");
    expect(cancellationSignalAborted).toBe(true);
    expect(writeApprovalObserved).toBe(true);
    expect(toolCalls.map((call) => call.toolId)).toEqual([
      CODING_FILE_READ_TOOL_ID,
      CODING_FILE_WRITE_TOOL_ID,
    ]);
    expect(await runGit(fixture.sourceRoot, "rev-parse", "HEAD")).toBe(baseHead);
    expect(await runGit(fixture.sourceRoot, "status", "--porcelain=v1")).toBe(baseStatus);
    expect(await readFile(fixture.sourceFile, "utf8")).toBe(baseBytes);
    assertClosedEnvironmentCanaries(path.join(fixture.root, "closed-environment"));

    await markFailure("parent-death");
    const residualProcessCount = await parentDeathProbe(artifact);
    expect(residualProcessCount).toBe(0);

    const runtimeEvidence = Object.freeze({
      schemaVersion: 1,
      status: "verified",
      targetTriple: "x86_64-pc-windows-msvc",
      sourceCommit: artifact.sourceCommit!,
      gooseBaseCommit: sourceContract.goose.baseCommit,
      gooseRuntimeCommit: sourceContract.goose.runtimeCommit,
      goosePatchSha256: sourceContract.goose.patchSetSha256,
      manifestSha256: artifact.manifestSha256,
      executableSha256: artifact.executableSha256,
      containmentEvidenceSha256: containmentEvidenceSha256!,
      acpInitialized,
      mcpFreeSessionCreated: exactToolCount === 6,
      exactToolCount,
      readToolCompleted: toolCalls[0]?.toolId === CODING_FILE_READ_TOOL_ID,
      approvedWriteToolCompleted: toolCalls[1]?.toolId === CODING_FILE_WRITE_TOOL_ID,
      cancellationObserved: cancellationSignalAborted,
      parentDeathCleanupObserved: true,
      credentialCanaryAbsent: true,
      environmentCanaryAbsent: true,
      directNetworkDenied: artifact.containment!.network,
      originalWorkspaceUnchanged: true,
      residualProcessCount,
    });
    await writeFile(evidencePath!, `${JSON.stringify(runtimeEvidence)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  }, 180_000);
});

afterAll(async () => {
  await Promise.all(
    codingFixtures.splice(0).map(async (fixture) => {
      await fixture.mainService.close().catch((): undefined => undefined);
      await fixture.persistence.close().catch((): undefined => undefined);
    }),
  );
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
