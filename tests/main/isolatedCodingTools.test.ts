// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_APPLY_TOOL_ID,
  buildArtifactApplyApprovalSummary,
  CODING_DIFF_TOOL_ID,
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_TEST_TOOL_ID,
  MAX_ISOLATED_CODING_TEXT_BYTES,
  PRIVILEGED_CONTRACT_VERSION,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  approvalActorId,
  approvalId,
  auditRecordId,
  authorizationGrantId,
  credentialLeaseId,
  instant,
  policyDecisionId,
  sessionId,
  taskId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type DomainGraph,
  type ProtectedAction,
  type ProtectedOperation,
  type ToolId,
  type WorkspaceGrant,
} from "../../apps/desktop/src/core";
import { GOOSE_WORKER_RESOURCE_PROFILE } from "../../apps/desktop/src/core/workerResourceBudget";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";
import {
  createIsolatedCodingToolPlatform,
  manageIsolatedCodingToolPlatform,
  type IsolatedCodingProcessDefinition,
  type IsolatedCodingToolPlatform,
} from "../../apps/desktop/src/main/privileged/isolatedCodingToolPlatform";
import {
  createIsolatedCodingWorktree,
  type IsolatedCodingWorktree,
} from "../../apps/desktop/src/main/workers/isolatedCodingWorktree";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import type { PersistenceUtilityClient } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";

const execFileAsync = promisify(execFile);
const fixtureRoots = new Set<string>();
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: os.tmpdir(),
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

interface CodingToolHarness {
  readonly fixtureRoot: string;
  readonly sourceRoot: string;
  readonly sourceFile: string;
  readonly worktree: IsolatedCodingWorktree;
  readonly persistence: PersistenceUtilityClient;
  readonly platform: IsolatedCodingToolPlatform;
  readonly clock: DeterministicAgentClock;
  readonly grant: WorkspaceGrant;
  readonly operation: ProtectedOperation;
}

interface CodingToolHarnessOptions {
  readonly sourceFiles?: Readonly<Record<string, string>>;
  readonly commands?: (
    worktreeRoot: string,
  ) => Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests?: (
    worktreeRoot: string,
  ) => Readonly<Record<string, IsolatedCodingProcessDefinition>>;
}

const harnesses: CodingToolHarness[] = [];

async function runGit(repository: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
  return result.stdout.trim();
}

function graph(harnessIds: {
  readonly workspaceId: ReturnType<typeof workspaceId>;
  readonly taskId: ReturnType<typeof taskId>;
  readonly sessionId: ReturnType<typeof sessionId>;
  readonly workerId: ReturnType<typeof workerId>;
  readonly now: ReturnType<typeof instant>;
}): DomainGraph {
  return {
    workspaces: [
      {
        id: harnessIds.workspaceId,
        name: "P5.2 isolated coding fixture",
        state: "active",
        createdAt: harnessIds.now,
        updatedAt: harnessIds.now,
      },
    ],
    tasks: [
      {
        id: harnessIds.taskId,
        workspaceId: harnessIds.workspaceId,
        title: "Modify the isolated fixture",
        state: "running",
        activeSessionId: harnessIds.sessionId,
        createdAt: harnessIds.now,
        updatedAt: harnessIds.now,
      },
    ],
    workers: [
      {
        id: harnessIds.workerId,
        workspaceId: harnessIds.workspaceId,
        adapterKind: "goose",
        state: "busy",
        createdAt: harnessIds.now,
        updatedAt: harnessIds.now,
      },
    ],
    sessions: [
      {
        id: harnessIds.sessionId,
        workspaceId: harnessIds.workspaceId,
        taskId: harnessIds.taskId,
        workerId: harnessIds.workerId,
        state: "running",
        createdAt: harnessIds.now,
        updatedAt: harnessIds.now,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

async function openHarness(
  suffix: string,
  options: CodingToolHarnessOptions = {},
): Promise<CodingToolHarness> {
  const fixtureRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "actestra-isolated-coding-tools-test-")),
  );
  fixtureRoots.add(fixtureRoot);
  const sourceRoot = path.join(fixtureRoot, "source");
  const managedRoot = path.join(fixtureRoot, "managed");
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(managedRoot);
  await runGit(sourceRoot, "init", "--initial-branch=main");
  await runGit(sourceRoot, "config", "user.name", "Actestra Test");
  await runGit(sourceRoot, "config", "user.email", "actestra-test@example.invalid");
  const sourceFile = path.join(sourceRoot, "answer.txt");
  fs.writeFileSync(sourceFile, "before\n", "utf8");
  for (const [relativePath, content] of Object.entries(options.sourceFiles ?? {})) {
    fs.writeFileSync(path.join(sourceRoot, relativePath), content, "utf8");
  }
  await runGit(sourceRoot, "add", ".");
  await runGit(sourceRoot, "commit", "-m", "fixture");

  const worktree = await createIsolatedCodingWorktree({ managedRoot, repositoryRoot: sourceRoot });
  const { client: persistence } = await openTestPersistenceUtility(
    path.join(fixtureRoot, "product-state"),
  );
  const clock = new DeterministicAgentClock(instant("2026-08-03T06:00:00.000Z"));
  const ids = {
    workspaceId: workspaceId(`workspace-coding-${suffix}`),
    taskId: taskId(`task-coding-${suffix}`),
    sessionId: sessionId(`session-coding-${suffix}`),
    workerId: workerId(`worker-coding-${suffix}`),
    now: clock.now(),
  };
  await persistence.replaceDomainGraph(graph(ids));
  const grant = {
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    grantId: workspaceGrantId(`grant-coding-${suffix}`),
    workspaceId: ids.workspaceId,
    rootPath: worktree.worktreeRoot,
    displayName: "P5.2 isolated worktree",
    state: "active",
    createdAt: clock.now(),
    updatedAt: clock.now(),
  } as const satisfies WorkspaceGrant;
  await persistence.persistWorkspaceGrant(grant);

  let auditSequence = 0;
  let decisionSequence = 0;
  let approvalSequence = 0;
  let authorizationSequence = 0;
  let credentialSequence = 0;
  let outputSequence = 0;
  const platform = createIsolatedCodingToolPlatform({
    clock,
    persistence,
    repositoryRoot: sourceRoot,
    worktreeRoot: worktree.worktreeRoot,
    gitDirectory: worktree.gitDirectory,
    gitCommonDirectory: worktree.gitCommonDirectory,
    commands: options.commands?.(worktree.worktreeRoot) ?? {},
    tests: options.tests?.(worktree.worktreeRoot) ?? {},
    identifiers: {
      newAuditRecordId: () => auditRecordId(`audit-coding-${suffix}-${String(++auditSequence)}`),
      newPolicyDecisionId: () =>
        policyDecisionId(`decision-coding-${suffix}-${String(++decisionSequence)}`),
      newApprovalId: () => approvalId(`approval-coding-${suffix}-${String(++approvalSequence)}`),
      newAuthorizationGrantId: () =>
        authorizationGrantId(`authorization-coding-${suffix}-${String(++authorizationSequence)}`),
      newCredentialLeaseId: () =>
        credentialLeaseId(`credential-coding-${suffix}-${String(++credentialSequence)}`),
      newOutputReference: () =>
        toolOutputReference(`output-coding-${suffix}-${String(++outputSequence)}`),
    },
  });
  const operation = {
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    requestId: toolRequestId(`request-coding-${suffix}`),
    workspaceId: ids.workspaceId,
    taskId: ids.taskId,
    sessionId: ids.sessionId,
    workerId: ids.workerId,
    toolId: CODING_FILE_WRITE_TOOL_ID,
    inputRef: toolInputReference(`input-coding-${suffix}`),
    action: "workspace.modify",
    resourceKind: "repository",
    summary: "Replace answer.txt only inside the isolated coding worktree",
    credentialRefs: [],
    requestedAt: clock.now(),
  } as const satisfies ProtectedOperation;
  await persistence.storeContentReference({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: operation.inputRef,
    kind: "tool-input",
    owner: {
      workspaceId: operation.workspaceId,
      taskId: operation.taskId,
      sessionId: operation.sessionId,
      workerId: operation.workerId,
      requestId: operation.requestId,
      grantId: grant.grantId,
    },
    classification: "task-content",
    mediaType: "text/plain; charset=utf-8",
    content: JSON.stringify({
      contractVersion: 1,
      relativePath: "answer.txt",
      content: "after\n",
    }),
    createdAt: clock.now(),
  });

  const harness = {
    fixtureRoot,
    sourceRoot,
    sourceFile,
    worktree,
    persistence,
    platform,
    clock,
    grant,
    operation,
  };
  harnesses.push(harness);
  return harness;
}

function operationFor(
  harness: CodingToolHarness,
  suffix: string,
  tool: ToolId,
  action: ProtectedAction,
): ProtectedOperation {
  return {
    ...harness.operation,
    requestId: toolRequestId(`request-coding-${suffix}`),
    toolId: tool,
    inputRef: toolInputReference(`input-coding-${suffix}`),
    action,
    summary: `Exercise the closed ${tool} capability`,
  };
}

async function storeInput(
  harness: CodingToolHarness,
  operation: ProtectedOperation,
  input: unknown,
): Promise<void> {
  await harness.persistence.storeContentReference({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: operation.inputRef,
    kind: "tool-input",
    owner: {
      workspaceId: operation.workspaceId,
      taskId: operation.taskId,
      sessionId: operation.sessionId,
      workerId: operation.workerId,
      requestId: operation.requestId,
      grantId: harness.grant.grantId,
    },
    classification: "task-content",
    mediaType: "text/plain; charset=utf-8",
    content: JSON.stringify(input),
    createdAt: harness.clock.now(),
  });
}

async function resolvedOutput(
  harness: CodingToolHarness,
  operation: ProtectedOperation,
  outputRef: ReturnType<typeof toolOutputReference>,
): Promise<Record<string, unknown>> {
  const resolved = await harness.persistence.resolveContentReference({
    contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
    reference: outputRef,
    kind: "tool-output",
    owner: {
      workspaceId: operation.workspaceId,
      taskId: operation.taskId,
      sessionId: operation.sessionId,
      workerId: operation.workerId,
      requestId: operation.requestId,
      grantId: harness.grant.grantId,
    },
    resolvedAt: harness.clock.now(),
    consume: false,
  });
  return JSON.parse(resolved.content) as Record<string, unknown>;
}

async function approveAndInvoke(
  harness: CodingToolHarness,
  operation: ProtectedOperation,
  control?: { readonly signal: AbortSignal },
) {
  const pending = await harness.platform.toolGateway.invoke(operation);
  if (pending.status !== "approval-required") {
    throw new Error("Expected the protected coding operation to require approval");
  }
  await harness.platform.approvalService.resolve(
    pending.approval.approvalId,
    "approved",
    approvalActorId("local-user"),
  );
  return harness.platform.toolGateway.invoke(operation, pending.approval.approvalId, control);
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await delay(25);
  }
}

async function processIdentitySnapshot(pid: number): Promise<string | undefined> {
  try {
    const result = await execFileAsync(
      "/bin/ps",
      ["-ww", "-o", "pid=,ppid=,pgid=,state=,command=", "-p", String(pid)],
      { encoding: "utf8" },
    );
    const snapshot = result.stdout.trim();
    return snapshot.length === 0 ? undefined : snapshot;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
      return undefined;
    }
    throw error;
  }
}

async function expectProcessIdentityGone(pid: number, marker: string): Promise<void> {
  const snapshot = await processIdentitySnapshot(pid);
  if (snapshot?.includes(marker)) {
    throw new Error(`Coding process identity remained after cleanup: ${snapshot}`);
  }
}

async function terminateProcessIdentityIfPresent(pid: number, marker: string): Promise<void> {
  const snapshot = await processIdentitySnapshot(pid);
  if (!snapshot?.includes(marker)) {
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const harness of harnesses.splice(0)) {
    await harness.persistence.close().catch((): undefined => undefined);
    await harness.worktree.close().catch((): undefined => undefined);
  }
  for (const fixtureRoot of fixtureRoots) {
    fs.rmSync(fixtureRoot, { force: true, recursive: true });
    fixtureRoots.delete(fixtureRoot);
  }
});

describe("P5.2 isolated coding capability proxy", () => {
  it("rejects a file write whose projected private-root usage exceeds the Goose storage budget", async () => {
    const harness = await openHarness("storage-prewrite");
    const fillerPath = path.join(path.dirname(harness.worktree.worktreeRoot), "filler.bin");
    await fs.promises.writeFile(fillerPath, "");
    await fs.promises.truncate(fillerPath, GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateStorageBytes);

    await expect(approveAndInvoke(harness, harness.operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "worker-resource-storage-exceeded" },
    });
    expect(fs.readFileSync(path.join(harness.worktree.worktreeRoot, "answer.txt"), "utf8")).toBe(
      "before\n",
    );
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
  });

  it("fails after an approved process writes beyond the private-root storage budget", async () => {
    const harness = await openHarness("storage-postprocess", {
      commands: (worktreeRoot) => ({
        storage_flood: {
          executablePath: process.execPath,
          args: Object.freeze([
            "-e",
            "const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'w');fs.writeSync(fd,Buffer.from([0]),0,1,Number(process.argv[2])-1);fs.closeSync(fd);",
            path.join(worktreeRoot, "storage-flood.bin"),
            String(GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateStorageBytes + 1),
          ]),
        },
      }),
    });
    const operation = operationFor(
      harness,
      "storage-postprocess-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, {
      contractVersion: 1,
      commandId: "storage_flood",
    });

    const error = await approveAndInvoke(harness, operation).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
    });
    expect((error as Error).cause).toMatchObject({
      errorCode: "worker-resource-storage-exceeded",
      mayHaveExecuted: true,
    });
    expect(await runGit(harness.sourceRoot, "status", "--porcelain=v1")).toBe("");
  });

  it("modifies only the isolated worktree after consuming one exact approval", async () => {
    const harness = await openHarness("write-approval");

    const pending = await harness.platform.toolGateway.invoke(harness.operation);
    expect(pending).toMatchObject({ status: "approval-required" });
    expect(fs.readFileSync(path.join(harness.worktree.worktreeRoot, "answer.txt"), "utf8")).toBe(
      "before\n",
    );
    if (pending.status !== "approval-required") {
      throw new Error("Expected the coding write to require approval");
    }

    expect(harness.platform.approvalAuditEvidence.pending(pending.approval)).toEqual({
      policyAuditRecordId: "audit-coding-write-approval-1",
      requestAuditRecordId: "audit-coding-write-approval-2",
    });
    const actorId = approvalActorId("local-user");
    await expect(
      harness.platform.approvalAuditEvidence.recordDecision(pending.approval, "approved", actorId),
    ).resolves.toBe("audit-coding-write-approval-3");

    await harness.platform.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      actorId,
    );
    expect(
      harness.platform.approvalAuditEvidence.resolution(pending.approval, "approved", actorId),
    ).toBe("audit-coding-write-approval-4");
    await expect(
      harness.platform.toolGateway.invoke(harness.operation, pending.approval.approvalId),
    ).resolves.toMatchObject({
      status: "executed",
      authorization: {
        method: "approval",
        approvalId: pending.approval.approvalId,
      },
    });

    expect(fs.readFileSync(path.join(harness.worktree.worktreeRoot, "answer.txt"), "utf8")).toBe(
      "after\n",
    );
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(harness.sourceRoot, "status", "--porcelain=v1")).toBe("");
    await expect(
      harness.platform.toolGateway.invoke(harness.operation, pending.approval.approvalId),
    ).rejects.toMatchObject({ code: "approval-replayed", mayHaveExecuted: false });
  });

  it("routes bounded file reads, Git status, and diff evidence through the Gateway", async () => {
    const harness = await openHarness("inspect");
    const readOperation = operationFor(
      harness,
      "inspect-read",
      CODING_FILE_READ_TOOL_ID,
      "workspace.read",
    );
    await storeInput(harness, readOperation, {
      contractVersion: 1,
      relativePath: "answer.txt",
    });
    const readResult = await harness.platform.toolGateway.invoke(readOperation);
    expect(readResult).toMatchObject({ status: "executed" });
    if (readResult.status !== "executed" || readResult.result.outputRef === undefined) {
      throw new Error("Expected an opaque coding file-read output");
    }
    await expect(
      resolvedOutput(harness, readOperation, readResult.result.outputRef),
    ).resolves.toEqual({
      contractVersion: 1,
      type: "file-read",
      relativePath: "answer.txt",
      content: "before\n",
    });

    const writeOperation = operationFor(
      harness,
      "inspect-write",
      CODING_FILE_WRITE_TOOL_ID,
      "workspace.modify",
    );
    await storeInput(harness, writeOperation, {
      contractVersion: 1,
      relativePath: "answer.txt",
      content: "after inspection\n",
    });
    const pending = await harness.platform.toolGateway.invoke(writeOperation);
    if (pending.status !== "approval-required") {
      throw new Error("Expected the coding write to require approval");
    }
    await harness.platform.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      approvalActorId("local-user"),
    );
    await harness.platform.toolGateway.invoke(writeOperation, pending.approval.approvalId);

    const gitOperation = operationFor(harness, "inspect-git", CODING_GIT_TOOL_ID, "tool.invoke");
    await storeInput(harness, gitOperation, { contractVersion: 1, query: "status" });
    const gitResult = await harness.platform.toolGateway.invoke(gitOperation);
    if (gitResult.status !== "executed" || gitResult.result.outputRef === undefined) {
      throw new Error("Expected an opaque coding Git output");
    }
    await expect(
      resolvedOutput(harness, gitOperation, gitResult.result.outputRef),
    ).resolves.toEqual({
      contractVersion: 1,
      type: "git-status",
      output: " M answer.txt",
    });

    const diffOperation = operationFor(
      harness,
      "inspect-diff",
      CODING_DIFF_TOOL_ID,
      "workspace.read",
    );
    await storeInput(harness, diffOperation, { contractVersion: 1 });
    const diffResult = await harness.platform.toolGateway.invoke(diffOperation);
    if (diffResult.status !== "executed" || diffResult.result.outputRef === undefined) {
      throw new Error("Expected an opaque coding diff output");
    }
    await expect(
      resolvedOutput(harness, diffOperation, diffResult.result.outputRef),
    ).resolves.toMatchObject({
      contractVersion: 1,
      type: "diff",
    });
    const diff = await resolvedOutput(harness, diffOperation, diffResult.result.outputRef);
    expect(diff.output).toContain("-before");
    expect(diff.output).toContain("+after inspection");

    await expect(
      harness.platform.policyEngine.evaluate({
        ...gitOperation,
        requestId: toolRequestId("request-coding-inspect-push"),
        action: "git.push",
        requestedAt: harness.clock.now(),
      }),
    ).resolves.toMatchObject({
      effect: "deny",
      reasonCode: "no-matching-rule",
    });
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
  });

  it("does not report success after output persistence crosses the timeout", async () => {
    const harness = await openHarness("output-persistence-timeout");
    const operation = operationFor(
      harness,
      "output-persistence-timeout-read",
      CODING_FILE_READ_TOOL_ID,
      "workspace.read",
    );
    await storeInput(harness, operation, {
      contractVersion: 1,
      relativePath: "answer.txt",
    });

    let notifyPersistenceStarted = (): void => undefined;
    const persistenceStarted = new Promise<void>((resolve) => {
      notifyPersistenceStarted = resolve;
    });
    let releasePersistence = (): void => undefined;
    const persistenceReleased = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    let persistedOutputRef: ReturnType<typeof toolOutputReference> | undefined;
    const storeContentReference = harness.persistence.storeContentReference.bind(
      harness.persistence,
    );
    const persistenceSpy = vi
      .spyOn(harness.persistence, "storeContentReference")
      .mockImplementation(async (request) => {
        if (request.kind === "tool-output") {
          persistedOutputRef = toolOutputReference(request.reference);
          notifyPersistenceStarted();
          await persistenceReleased;
        }
        return storeContentReference(request);
      });

    vi.useFakeTimers();
    const invocation = harness.platform.toolGateway.invoke(operation);
    try {
      await persistenceStarted;
      await vi.advanceTimersByTimeAsync(5_001);

      let invocationSettled = false;
      void invocation.then(
        () => {
          invocationSettled = true;
        },
        () => {
          invocationSettled = true;
        },
      );
      await Promise.resolve();
      expect(invocationSettled).toBe(false);

      releasePersistence();
      await expect(invocation).rejects.toMatchObject({
        code: "tool-execution-failed",
        mayHaveExecuted: false,
        cause: {
          errorCode: "tool-timeout",
          mayHaveExecuted: false,
        },
      });
      if (persistedOutputRef === undefined) {
        throw new Error("Expected durable coding output persistence to complete");
      }
      await expect(resolvedOutput(harness, operation, persistedOutputRef)).resolves.toEqual({
        contractVersion: 1,
        type: "file-read",
        relativePath: "answer.txt",
        content: "before\n",
      });
    } finally {
      releasePersistence();
      await invocation.catch((): undefined => undefined);
      persistenceSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("preserves completed file-write side-effect evidence after output persistence crosses the timeout", async () => {
    const harness = await openHarness("write-output-persistence-timeout");
    const pending = await harness.platform.toolGateway.invoke(harness.operation);
    if (pending.status !== "approval-required") {
      throw new Error("Expected the coding write to require approval");
    }
    await harness.platform.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      approvalActorId("local-user"),
    );

    let notifyPersistenceStarted = (): void => undefined;
    const persistenceStarted = new Promise<void>((resolve) => {
      notifyPersistenceStarted = resolve;
    });
    let releasePersistence = (): void => undefined;
    const persistenceReleased = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    let persistedOutputRef: ReturnType<typeof toolOutputReference> | undefined;
    const storeContentReference = harness.persistence.storeContentReference.bind(
      harness.persistence,
    );
    const persistenceSpy = vi
      .spyOn(harness.persistence, "storeContentReference")
      .mockImplementation(async (request) => {
        if (request.kind === "tool-output") {
          persistedOutputRef = toolOutputReference(request.reference);
          notifyPersistenceStarted();
          await persistenceReleased;
        }
        return storeContentReference(request);
      });

    vi.useFakeTimers();
    const invocation = harness.platform.toolGateway.invoke(
      harness.operation,
      pending.approval.approvalId,
    );
    try {
      await persistenceStarted;
      expect(fs.readFileSync(path.join(harness.worktree.worktreeRoot, "answer.txt"), "utf8")).toBe(
        "after\n",
      );
      expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
      await vi.advanceTimersByTimeAsync(5_001);

      releasePersistence();
      await expect(invocation).rejects.toMatchObject({
        code: "tool-execution-failed",
        mayHaveExecuted: true,
        cause: {
          errorCode: "tool-timeout",
          mayHaveExecuted: true,
        },
      });
      if (persistedOutputRef === undefined) {
        throw new Error("Expected durable coding output persistence to complete");
      }
      await expect(resolvedOutput(harness, harness.operation, persistedOutputRef)).resolves.toEqual(
        {
          contractVersion: 1,
          type: "file-written",
          relativePath: "answer.txt",
          byteLength: 6,
        },
      );
    } finally {
      releasePersistence();
      await invocation.catch((): undefined => undefined);
      persistenceSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("disables repository-local fsmonitor commands for read-only Git inspection", async () => {
    const harness = await openHarness("git-fsmonitor");
    const markerPath = path.join(harness.fixtureRoot, "fsmonitor-executed.txt");
    const monitorPath = path.join(harness.fixtureRoot, "fsmonitor.mjs");
    fs.writeFileSync(
      monitorPath,
      [
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(${JSON.stringify(markerPath)}, 'executed\\n');`,
      ].join("\n"),
      "utf8",
    );
    await runGit(
      harness.sourceRoot,
      "config",
      "core.fsmonitor",
      `${process.execPath} ${monitorPath}`,
    );

    const operation = operationFor(
      harness,
      "git-fsmonitor-status",
      CODING_GIT_TOOL_ID,
      "tool.invoke",
    );
    await storeInput(harness, operation, { contractVersion: 1, query: "status" });
    await expect(harness.platform.toolGateway.invoke(operation)).resolves.toMatchObject({
      status: "executed",
    });
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it("rechecks repository filters before every read-only Git capability", async () => {
    const harness = await openHarness("git-filter-after-open");
    await runGit(
      harness.sourceRoot,
      "config",
      "filter.late.clean",
      `${process.execPath} /tmp/actestra-filter-never-run`,
    );
    const operation = operationFor(
      harness,
      "git-filter-after-open-status",
      CODING_GIT_TOOL_ID,
      "tool.invoke",
    );
    await storeInput(harness, operation, { contractVersion: 1, query: "status" });

    await expect(harness.platform.toolGateway.invoke(operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "repository-config-denied", mayHaveExecuted: false },
    });
  });

  it("rejects read-only Git output above the closed text limit", async () => {
    const harness = await openHarness("git-output-limit");
    for (let index = 0; index < 400; index += 1) {
      const name = `untracked-${String(index).padStart(3, "0")}-${"x".repeat(180)}.txt`;
      fs.writeFileSync(path.join(harness.worktree.worktreeRoot, name), "fixture\n", "utf8");
    }
    const operation = operationFor(
      harness,
      "git-output-limit-status",
      CODING_GIT_TOOL_ID,
      "tool.invoke",
    );
    await storeInput(harness, operation, { contractVersion: 1, query: "status" });

    await expect(harness.platform.toolGateway.invoke(operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "output-too-large", mayHaveExecuted: false },
    });
  });

  it("denies symbolic-link file reads and writes inside the worktree", async () => {
    const harness = await openHarness("file-symlink");
    fs.symlinkSync("answer.txt", path.join(harness.worktree.worktreeRoot, "answer-link.txt"));

    const readOperation = operationFor(
      harness,
      "file-symlink-read",
      CODING_FILE_READ_TOOL_ID,
      "workspace.read",
    );
    await storeInput(harness, readOperation, {
      contractVersion: 1,
      relativePath: "answer-link.txt",
    });
    await expect(harness.platform.toolGateway.invoke(readOperation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "symlink-denied", mayHaveExecuted: false },
    });

    const writeOperation = operationFor(
      harness,
      "file-symlink-write",
      CODING_FILE_WRITE_TOOL_ID,
      "workspace.modify",
    );
    await storeInput(harness, writeOperation, {
      contractVersion: 1,
      relativePath: "answer-link.txt",
      content: "must not be written\n",
    });
    await expect(approveAndInvoke(harness, writeOperation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "symlink-denied", mayHaveExecuted: false },
    });
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
    expect(fs.readFileSync(path.join(harness.worktree.worktreeRoot, "answer.txt"), "utf8")).toBe(
      "before\n",
    );
  });

  it("rejects a workspace grant that no longer names the managed worktree", async () => {
    const harness = await openHarness("grant-scope");
    const operation = operationFor(
      harness,
      "grant-scope-read",
      CODING_FILE_READ_TOOL_ID,
      "workspace.read",
    );
    await storeInput(harness, operation, { contractVersion: 1, relativePath: "answer.txt" });
    await harness.persistence.persistWorkspaceGrant({
      ...harness.grant,
      state: "revoked",
      updatedAt: harness.clock.now(),
    });
    const otherRoot = path.join(harness.fixtureRoot, "other-workspace");
    fs.mkdirSync(otherRoot);
    await harness.persistence.persistWorkspaceGrant({
      ...harness.grant,
      grantId: workspaceGrantId("grant-coding-grant-scope-other"),
      rootPath: fs.realpathSync(otherRoot),
      state: "active",
      createdAt: harness.clock.now(),
      updatedAt: harness.clock.now(),
    });

    await expect(harness.platform.toolGateway.invoke(operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "worktree-scope-denied", mayHaveExecuted: false },
    });
  });

  it("rejects a worktree whose exact Git binding changed before input consumption", async () => {
    const harness = await openHarness("git-binding-tamper");
    const replacementRepository = path.join(harness.fixtureRoot, "replacement-repository");
    fs.mkdirSync(replacementRepository);
    await runGit(replacementRepository, "init", "--initial-branch=main");
    const gitPointerPath = path.join(harness.worktree.worktreeRoot, ".git");
    const originalGitPointer = fs.readFileSync(gitPointerPath, "utf8");
    const operation = operationFor(
      harness,
      "git-binding-tamper-read",
      CODING_FILE_READ_TOOL_ID,
      "workspace.read",
    );
    await storeInput(harness, operation, {
      contractVersion: 1,
      relativePath: "answer.txt",
    });

    try {
      fs.writeFileSync(
        gitPointerPath,
        `gitdir: ${path.join(replacementRepository, ".git")}\n`,
        "utf8",
      );
      await expect(harness.platform.toolGateway.invoke(operation)).rejects.toMatchObject({
        code: "tool-execution-failed",
        cause: { errorCode: "worktree-scope-denied", mayHaveExecuted: false },
      });
    } finally {
      fs.writeFileSync(gitPointerPath, originalGitPointer, "utf8");
    }

    const retry = await harness.platform.toolGateway.invoke(operation);
    if (retry.status !== "executed" || retry.result.outputRef === undefined) {
      throw new Error("Expected the unconsumed coding file-read input to remain executable");
    }
    await expect(resolvedOutput(harness, operation, retry.result.outputRef)).resolves.toEqual({
      contractVersion: 1,
      type: "file-read",
      relativePath: "answer.txt",
      content: "before\n",
    });
  });

  it.each(["repositoryRoot", "worktreeRoot", "gitDirectory", "gitCommonDirectory"] as const)(
    "rejects a mixed platform and worktree lifecycle composition for %s",
    async (identity) => {
      const harness = await openHarness(`mixed-platform-worktree-${identity}`);
      const mixedWorktree = Object.freeze({
        ...harness.worktree,
        [identity]: `${harness.worktree[identity]}-different`,
      });

      expect(() =>
        manageIsolatedCodingToolPlatform({
          platform: harness.platform,
          persistence: harness.persistence,
          worktree: mixedWorktree,
          grant: harness.grant,
          clock: harness.clock,
        }),
      ).toThrowError(
        expect.objectContaining({
          name: "IsolatedCodingToolLifecycleError",
          code: "invalid-config",
        }),
      );
    },
  );

  it("rejects lifecycle cleanup through a different persistence authority", async () => {
    const harness = await openHarness("mixed-platform-persistence");
    const differentPersistence = Object.create(harness.persistence) as PersistenceUtilityClient;

    expect(() =>
      manageIsolatedCodingToolPlatform({
        platform: harness.platform,
        persistence: differentPersistence,
        worktree: harness.worktree,
        grant: harness.grant,
        clock: harness.clock,
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "IsolatedCodingToolLifecycleError",
        code: "invalid-config",
      }),
    );
  });

  it("terminates a registered process whose combined output exceeds the closed limit", async () => {
    const harness = await openHarness("process-output-limit", {
      sourceFiles: {
        "large-output.mjs": `process.stdout.write('x'.repeat(${String(
          MAX_ISOLATED_CODING_TEXT_BYTES + 1,
        )}));\n`,
      },
      commands: () => ({
        large: { executablePath: process.execPath, args: ["large-output.mjs"] },
      }),
    });
    const operation = operationFor(
      harness,
      "process-output-limit-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, { contractVersion: 1, commandId: "large" });

    await expect(approveAndInvoke(harness, operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
      cause: { errorCode: "output-too-large", mayHaveExecuted: true },
    });
  });

  it("does not signal a vanished process group after TERM cleanup", async () => {
    const harness = await openHarness("process-output-limit-term-exit", {
      sourceFiles: {
        "large-output.mjs": `process.stdout.write('x'.repeat(${String(
          MAX_ISOLATED_CODING_TEXT_BYTES + 1,
        )}));\n`,
      },
      commands: () => ({
        large: { executablePath: process.execPath, args: ["large-output.mjs"] },
      }),
    });
    const operation = operationFor(
      harness,
      "process-output-limit-term-exit-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, { contractVersion: 1, commandId: "large" });

    const originalKill = process.kill.bind(process);
    let termSent = false;
    let killSent = false;
    vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
      if (processId < 0 && signal === "SIGTERM") {
        termSent = true;
        return originalKill(processId, signal);
      }
      if (termSent && processId < 0 && signal === 0) {
        throw Object.assign(new Error("process group exited after TERM"), { code: "ESRCH" });
      }
      if (termSent && processId < 0 && signal === "SIGKILL") {
        killSent = true;
        throw Object.assign(new Error("stale process group denied"), { code: "EPERM" });
      }
      return originalKill(processId, signal);
    }) as typeof process.kill);

    await expect(approveAndInvoke(harness, operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
      cause: { errorCode: "output-too-large", mayHaveExecuted: true },
    });
    expect(termSent).toBe(true);
    expect(killSent).toBe(false);
  });

  it("denies an unknown process registry identifier after approval", async () => {
    const harness = await openHarness("process-unknown");
    const operation = operationFor(
      harness,
      "process-unknown-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, { contractVersion: 1, commandId: "unknown" });

    await expect(approveAndInvoke(harness, operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: { errorCode: "process-definition-denied", mayHaveExecuted: false },
    });
  });

  it("runs only approved registered terminal and test commands in a closed environment", async () => {
    const harness = await openHarness("process-success", {
      sourceFiles: {
        "terminal.mjs": [
          "import net from 'node:net';",
          "const keys = Object.keys(process.env).sort();",
          "const socket = net.connect({ host: '1.1.1.1', port: 53 });",
          "socket.once('connect', () => { console.error('network unexpectedly available'); process.exit(9); });",
          "socket.once('error', () => { console.log(JSON.stringify({ cwd: process.cwd(), keys, network: 'denied' })); });",
          "setTimeout(() => { console.error('network denial timeout'); process.exit(8); }, 2000).unref();",
        ].join("\n"),
        "test-fixture.mjs": "console.log('TEST_FIXTURE_OK');\n",
      },
      commands: () => ({
        inspect: { executablePath: process.execPath, args: ["terminal.mjs"] },
      }),
      tests: () => ({
        fixture: { executablePath: process.execPath, args: ["test-fixture.mjs"] },
      }),
    });
    const terminalOperation = operationFor(
      harness,
      "process-success-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, terminalOperation, { contractVersion: 1, commandId: "inspect" });
    const terminalResult = await approveAndInvoke(harness, terminalOperation);
    if (terminalResult.status !== "executed" || terminalResult.result.outputRef === undefined) {
      throw new Error("Expected a persisted terminal result");
    }
    const terminalOutput = await resolvedOutput(
      harness,
      terminalOperation,
      terminalResult.result.outputRef,
    );
    expect(terminalOutput).toMatchObject({
      contractVersion: 1,
      type: "terminal",
      commandId: "inspect",
      exitCode: 0,
      stderr: "",
    });
    const terminalEvidence = JSON.parse(terminalOutput.stdout as string) as {
      readonly cwd: string;
      readonly keys: readonly string[];
      readonly network: string;
    };
    expect(terminalEvidence).toEqual({
      cwd: harness.worktree.worktreeRoot,
      keys: [
        "CI",
        "HOME",
        "NO_COLOR",
        "PATH",
        "TEMP",
        "TMP",
        "TMPDIR",
        "TZ",
        "__CF_USER_TEXT_ENCODING",
      ],
      network: "denied",
    });

    const testOperation = operationFor(
      harness,
      "process-success-test",
      CODING_TEST_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, testOperation, { contractVersion: 1, testId: "fixture" });
    const testResult = await approveAndInvoke(harness, testOperation);
    if (testResult.status !== "executed" || testResult.result.outputRef === undefined) {
      throw new Error("Expected a persisted test result");
    }
    await expect(
      resolvedOutput(harness, testOperation, testResult.result.outputRef),
    ).resolves.toEqual({
      contractVersion: 1,
      type: "test",
      testId: "fixture",
      exitCode: 0,
      stdout: "TEST_FIXTURE_OK",
      stderr: "",
    });
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
  });

  it("denies host user-data reads outside the attempt-private root", async () => {
    const harness = await openHarness("process-host-read", {
      sourceFiles: {
        "host-read.mjs": [
          "import { readFileSync } from 'node:fs';",
          "let hostRead = 'allowed';",
          "try {",
          "  readFileSync(process.argv[2], 'utf8');",
          "} catch (error) {",
          "  hostRead = error?.code === 'EPERM' || error?.code === 'EACCES' ? 'denied' : `unexpected:${String(error?.code)}`;",
          "}",
          "console.log(JSON.stringify({ hostRead }));",
        ].join("\n"),
      },
      commands: (worktreeRoot) => {
        const fixtureRoot = path.dirname(path.dirname(path.dirname(worktreeRoot)));
        const sentinelPath = path.join(fixtureRoot, "host-user-data-sentinel.txt");
        fs.writeFileSync(sentinelPath, "must remain unreadable\n", "utf8");
        return {
          inspect: {
            executablePath: process.execPath,
            args: ["host-read.mjs", sentinelPath],
          },
        };
      },
    });
    const operation = operationFor(
      harness,
      "process-host-read-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, { contractVersion: 1, commandId: "inspect" });
    const result = await approveAndInvoke(harness, operation);
    if (result.status !== "executed" || result.result.outputRef === undefined) {
      throw new Error("Expected persisted host-read sandbox evidence");
    }
    const output = await resolvedOutput(harness, operation, result.result.outputRef);
    expect(JSON.parse(output.stdout as string)).toEqual({ hostRead: "denied" });
  });

  it("denies registered processes from rewriting the worktree Git pointer", async () => {
    const harness = await openHarness("process-git-pointer", {
      sourceFiles: {
        "git-pointer.mjs": [
          "import { appendFileSync } from 'node:fs';",
          "let gitPointerWrite = 'allowed';",
          "try {",
          "  appendFileSync('.git', '\\n# process-write-probe');",
          "} catch (error) {",
          "  gitPointerWrite = error?.code === 'EPERM' || error?.code === 'EACCES' ? 'denied' : `unexpected:${String(error?.code)}`;",
          "}",
          "console.log(JSON.stringify({ gitPointerWrite }));",
        ].join("\n"),
      },
      commands: () => ({
        probe: { executablePath: process.execPath, args: ["git-pointer.mjs"] },
      }),
    });
    const gitPointerPath = path.join(harness.worktree.worktreeRoot, ".git");
    const originalGitPointer = fs.readFileSync(gitPointerPath, "utf8");
    try {
      const operation = operationFor(
        harness,
        "process-git-pointer-terminal",
        CODING_TERMINAL_TOOL_ID,
        "shell.execute",
      );
      await storeInput(harness, operation, { contractVersion: 1, commandId: "probe" });
      const result = await approveAndInvoke(harness, operation);
      if (result.status !== "executed" || result.result.outputRef === undefined) {
        throw new Error("Expected persisted Git-pointer sandbox evidence");
      }
      const output = await resolvedOutput(harness, operation, result.result.outputRef);
      expect(JSON.parse(output.stdout as string)).toEqual({ gitPointerWrite: "denied" });
      expect(fs.readFileSync(gitPointerPath, "utf8")).toBe(originalGitPointer);
    } finally {
      fs.writeFileSync(gitPointerPath, originalGitPointer, "utf8");
    }
  });

  it("records command failure and terminates a cancelled process group", async () => {
    const harness = await openHarness("process-terminal", {
      sourceFiles: {
        "fail.mjs": "console.error('expected fixture failure'); process.exit(7);\n",
        "lock.mjs": [
          "console.error(\"fatal: Unable to create '/Users/fixture/secret-repo/.git/index.lock': File exists.\");",
          "process.exit(128);",
        ].join("\n"),
        "wait.mjs": [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "const child = spawn(process.execPath, ['stubborn.mjs', 'actestra-process-terminal-descendant'], { stdio: 'ignore' });",
          "child.unref();",
          "writeFileSync('running.pid', String(process.pid));",
          "writeFileSync('stubborn.pid', String(child.pid));",
          "setInterval(() => undefined, 1000);",
        ].join("\n"),
        "stubborn.mjs": [
          "process.on('SIGTERM', () => undefined);",
          "setInterval(() => undefined, 1000);",
        ].join("\n"),
      },
      commands: () => ({
        fail: { executablePath: process.execPath, args: ["fail.mjs"] },
        lock: { executablePath: process.execPath, args: ["lock.mjs"] },
        wait: {
          executablePath: process.execPath,
          args: ["wait.mjs", "actestra-process-terminal-leader"],
        },
      }),
    });
    const failureOperation = operationFor(
      harness,
      "process-terminal-fail",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, failureOperation, { contractVersion: 1, commandId: "fail" });
    const failure = await approveAndInvoke(harness, failureOperation).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
      cause: {
        errorCode: "process-exit-failed",
        mayHaveExecuted: true,
      },
    });
    const exitMessage = String(
      (failure as { cause?: { message?: unknown } } | undefined)?.cause?.message,
    );
    expect(exitMessage).toContain("exitCode=7");
    expect(exitMessage).toContain("signal=none");
    expect(exitMessage).toMatch(/stderrBytes=[1-9][0-9]*/u);
    expect(exitMessage).toContain("stderrSignature=unclassified");
    expect(exitMessage).not.toContain("expected fixture failure");

    const lockOperation = operationFor(
      harness,
      "process-terminal-lock",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, lockOperation, { contractVersion: 1, commandId: "lock" });
    const lockFailure = await approveAndInvoke(harness, lockOperation).then(
      () => undefined,
      (error: unknown) => error,
    );
    const lockMessage = String(
      (lockFailure as { cause?: { message?: unknown } } | undefined)?.cause?.message,
    );
    expect(lockMessage).toContain("exitCode=128");
    expect(lockMessage).toContain("stderrSignature=git-lock-contention");
    expect(lockMessage).not.toContain("index.lock");
    expect(lockMessage).not.toContain("/Users/fixture");
    expect(lockMessage).not.toContain("secret-repo");

    const cancellationOperation = operationFor(
      harness,
      "process-terminal-cancel",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, cancellationOperation, { contractVersion: 1, commandId: "wait" });
    const pending = await harness.platform.toolGateway.invoke(cancellationOperation);
    if (pending.status !== "approval-required") {
      throw new Error("Expected the cancellable terminal command to require approval");
    }
    await harness.platform.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      approvalActorId("local-user"),
    );
    const controller = new AbortController();
    const invocation = harness.platform.toolGateway.invoke(
      cancellationOperation,
      pending.approval.approvalId,
      { signal: controller.signal },
    );
    const pidPath = path.join(harness.worktree.worktreeRoot, "running.pid");
    const stubbornPidPath = path.join(harness.worktree.worktreeRoot, "stubborn.pid");
    await waitForFile(pidPath);
    await waitForFile(stubbornPidPath);
    const pid = Number.parseInt(fs.readFileSync(pidPath, "utf8"), 10);
    const stubbornPid = Number.parseInt(fs.readFileSync(stubbornPidPath, "utf8"), 10);
    controller.abort("user-cancelled");
    await expect(invocation).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
      cause: {
        errorCode: "tool-cancelled",
        mayHaveExecuted: true,
      },
    });
    await expectProcessIdentityGone(pid, "actestra-process-terminal-leader");
    let cleanupError: unknown;
    try {
      await expectProcessIdentityGone(stubbornPid, "actestra-process-terminal-descendant");
    } finally {
      try {
        await terminateProcessIdentityIfPresent(
          stubbornPid,
          "actestra-process-terminal-descendant",
        );
      } catch (error) {
        cleanupError = error;
      }
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
  });

  it("removes descendants after registered process leaders exit successfully or fail", async () => {
    const harness = await openHarness("process-leader-exit", {
      sourceFiles: {
        "leader.mjs": [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "const [pidFile, exitCode, marker] = process.argv.slice(2);",
          "const child = spawn(process.execPath, ['descendant.mjs', marker], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });",
          "child.unref();",
          "child.once('message', (message) => {",
          "  if (message !== 'ready') process.exit(12);",
          "  writeFileSync(pidFile, String(child.pid));",
          "  process.exit(Number(exitCode));",
          "});",
        ].join("\n"),
        "descendant.mjs": [
          "process.on('SIGTERM', () => undefined);",
          "process.send?.('ready');",
          "setInterval(() => undefined, 1000);",
        ].join("\n"),
      },
      commands: () => ({
        success: {
          executablePath: process.execPath,
          args: [
            "leader.mjs",
            "success-descendant.pid",
            "0",
            "actestra-process-leader-exit-success-descendant",
          ],
        },
        failure: {
          executablePath: process.execPath,
          args: [
            "leader.mjs",
            "failure-descendant.pid",
            "7",
            "actestra-process-leader-exit-failure-descendant",
          ],
        },
      }),
    });
    const successOperation = operationFor(
      harness,
      "process-leader-exit-success",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, successOperation, { contractVersion: 1, commandId: "success" });
    await expect(approveAndInvoke(harness, successOperation)).resolves.toMatchObject({
      status: "executed",
    });

    const failureOperation = operationFor(
      harness,
      "process-leader-exit-failure",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, failureOperation, { contractVersion: 1, commandId: "failure" });
    const failureError = await approveAndInvoke(harness, failureOperation).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failureError).toMatchObject({ code: "tool-execution-failed" });
    const failureCause = (failureError as { readonly cause?: unknown }).cause;
    expect(failureCause).toMatchObject({
      errorCode: "process-exit-failed",
      mayHaveExecuted: true,
    });

    const descendantIdentities = [
      {
        pid: Number.parseInt(
          fs.readFileSync(
            path.join(harness.worktree.worktreeRoot, "success-descendant.pid"),
            "utf8",
          ),
          10,
        ),
        marker: "actestra-process-leader-exit-success-descendant",
      },
      {
        pid: Number.parseInt(
          fs.readFileSync(
            path.join(harness.worktree.worktreeRoot, "failure-descendant.pid"),
            "utf8",
          ),
          10,
        ),
        marker: "actestra-process-leader-exit-failure-descendant",
      },
    ] as const;
    let cleanupError: unknown;
    try {
      for (const identity of descendantIdentities) {
        await expectProcessIdentityGone(identity.pid, identity.marker);
      }
    } finally {
      for (const identity of descendantIdentities) {
        try {
          await terminateProcessIdentityIfPresent(identity.pid, identity.marker);
        } catch (error) {
          if (cleanupError === undefined) {
            cleanupError = error;
          }
        }
      }
    }
    if (cleanupError !== undefined) {
      throw cleanupError;
    }
  });

  it("snapshots the main-owned process registry before any Worker-selected invocation", async () => {
    const mutableArgs = ["safe.mjs"];
    const mutableCommands: Record<string, IsolatedCodingProcessDefinition> = {
      safe: { executablePath: process.execPath, args: mutableArgs },
    };
    const harness = await openHarness("registry-snapshot", {
      sourceFiles: {
        "safe.mjs": "console.log('SAFE');\n",
        "injected.mjs": "console.log('INJECTED');\n",
      },
      commands: () => mutableCommands,
    });
    mutableCommands.injected = { executablePath: process.execPath, args: ["injected.mjs"] };
    mutableArgs[0] = "injected.mjs";

    const operation = operationFor(
      harness,
      "registry-snapshot-injected",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, { contractVersion: 1, commandId: "injected" });
    await expect(approveAndInvoke(harness, operation)).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: false,
      cause: {
        errorCode: "process-definition-denied",
        mayHaveExecuted: false,
      },
    });

    const safeOperation = operationFor(
      harness,
      "registry-snapshot-safe",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, safeOperation, { contractVersion: 1, commandId: "safe" });
    const safeResult = await approveAndInvoke(harness, safeOperation);
    if (safeResult.status !== "executed" || safeResult.result.outputRef === undefined) {
      throw new Error("Expected the original registry snapshot to execute");
    }
    await expect(
      resolvedOutput(harness, safeOperation, safeResult.result.outputRef),
    ).resolves.toMatchObject({
      type: "terminal",
      commandId: "safe",
      stdout: "SAFE",
    });
  });

  it("cancels active tools before revoking the grant and removing the worktree", async () => {
    const harness = await openHarness("lifecycle-close", {
      sourceFiles: {
        "lifecycle-wait.mjs": [
          "import { spawn } from 'node:child_process';",
          "import { writeFileSync } from 'node:fs';",
          "const child = spawn(process.execPath, ['lifecycle-stubborn.mjs', 'actestra-lifecycle-descendant'], { stdio: 'ignore' });",
          "child.unref();",
          "writeFileSync('lifecycle.pid', String(process.pid));",
          "writeFileSync('lifecycle-stubborn.pid', String(child.pid));",
          "setInterval(() => undefined, 1000);",
        ].join("\n"),
        "lifecycle-stubborn.mjs": [
          "process.on('SIGTERM', () => undefined);",
          "setInterval(() => undefined, 1000);",
        ].join("\n"),
      },
      commands: () => ({
        lifecycle: {
          executablePath: process.execPath,
          args: ["lifecycle-wait.mjs", "actestra-lifecycle-leader"],
        },
      }),
    });
    const closeOrder: string[] = [];
    const lifecycleWorktree = Object.freeze({
      ...harness.worktree,
      async close(): Promise<void> {
        closeOrder.push("worktree-close");
        await expect(
          harness.persistence.getActiveWorkspaceGrant(harness.operation.workspaceId),
        ).resolves.toBeNull();
        await harness.worktree.close();
      },
    });
    const managed = manageIsolatedCodingToolPlatform({
      platform: harness.platform,
      persistence: harness.persistence,
      worktree: lifecycleWorktree,
      grant: harness.grant,
      clock: harness.clock,
    });
    const operation = operationFor(
      harness,
      "lifecycle-close-terminal",
      CODING_TERMINAL_TOOL_ID,
      "shell.execute",
    );
    await storeInput(harness, operation, { contractVersion: 1, commandId: "lifecycle" });
    const pending = await managed.toolGateway.invoke(operation);
    if (pending.status !== "approval-required") {
      throw new Error("Expected lifecycle process approval");
    }
    await managed.approvalService.resolve(
      pending.approval.approvalId,
      "approved",
      approvalActorId("local-user"),
    );
    const invocation = managed.toolGateway.invoke(operation, pending.approval.approvalId);
    const pidPath = path.join(harness.worktree.worktreeRoot, "lifecycle.pid");
    const stubbornPidPath = path.join(harness.worktree.worktreeRoot, "lifecycle-stubborn.pid");
    await waitForFile(pidPath);
    await waitForFile(stubbornPidPath);
    const pid = Number.parseInt(fs.readFileSync(pidPath, "utf8"), 10);
    const stubbornPid = Number.parseInt(fs.readFileSync(stubbornPidPath, "utf8"), 10);

    const closing = managed.close();
    await expect(invocation).rejects.toMatchObject({
      code: "tool-execution-failed",
      cause: { errorCode: "tool-cancelled", mayHaveExecuted: true },
    });
    await expect(closing).resolves.toBeUndefined();
    await expectProcessIdentityGone(pid, "actestra-lifecycle-leader");
    await expectProcessIdentityGone(stubbornPid, "actestra-lifecycle-descendant");
    await expect(
      harness.persistence.getActiveWorkspaceGrant(harness.operation.workspaceId),
    ).resolves.toBeNull();
    expect(fs.existsSync(harness.worktree.worktreeRoot)).toBe(false);
    expect(closeOrder).toEqual(["worktree-close"]);
    await expect(managed.toolGateway.invoke(operation)).rejects.toMatchObject({
      name: "IsolatedCodingToolLifecycleError",
      code: "closed",
    });
  });

  it("does not remove a worktree when grant revocation fails, and retries cleanup", async () => {
    const harness = await openHarness("lifecycle-retry");
    const managed = manageIsolatedCodingToolPlatform({
      platform: harness.platform,
      persistence: harness.persistence,
      worktree: harness.worktree,
      grant: harness.grant,
      clock: harness.clock,
    });
    const persist = vi
      .spyOn(harness.persistence, "persistWorkspaceGrant")
      .mockRejectedValueOnce(new Error("persistence unavailable"));

    await expect(managed.close()).rejects.toMatchObject({
      name: "IsolatedCodingToolLifecycleError",
      code: "cleanup-failed",
    });
    expect(fs.existsSync(harness.worktree.worktreeRoot)).toBe(true);
    await expect(
      harness.persistence.getActiveWorkspaceGrant(harness.operation.workspaceId),
    ).resolves.toMatchObject({ state: "active" });

    persist.mockRestore();
    await expect(managed.close()).resolves.toBeUndefined();
    expect(fs.existsSync(harness.worktree.worktreeRoot)).toBe(false);
  });

  it("reuses one revocation record when cleanup retries after a lost persistence response", async () => {
    const harness = await openHarness("lifecycle-revocation-response-lost");
    const managed = manageIsolatedCodingToolPlatform({
      platform: harness.platform,
      persistence: harness.persistence,
      worktree: harness.worktree,
      grant: harness.grant,
      clock: harness.clock,
    });
    const persistWorkspaceGrant = harness.persistence.persistWorkspaceGrant.bind(
      harness.persistence,
    );
    const persist = vi
      .spyOn(harness.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => {
        await persistWorkspaceGrant(grant);
        throw new Error("persistence response lost after commit");
      });

    await expect(managed.close()).rejects.toMatchObject({
      name: "IsolatedCodingToolLifecycleError",
      code: "cleanup-failed",
    });
    expect(fs.existsSync(harness.worktree.worktreeRoot)).toBe(true);
    await expect(
      harness.persistence.getActiveWorkspaceGrant(harness.operation.workspaceId),
    ).resolves.toBeNull();

    harness.clock.advance(1_000);
    persist.mockRestore();
    await expect(managed.close()).resolves.toBeUndefined();
    expect(fs.existsSync(harness.worktree.worktreeRoot)).toBe(false);
  });

  it("does not remove a worktree when grant revocation returns mismatched exact evidence", async () => {
    const harness = await openHarness("lifecycle-mismatched-receipt");
    const managed = manageIsolatedCodingToolPlatform({
      platform: harness.platform,
      persistence: harness.persistence,
      worktree: harness.worktree,
      grant: harness.grant,
      clock: harness.clock,
    });
    const persist = vi
      .spyOn(harness.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => ({
        status: "updated",
        grant: {
          ...grant,
          workspaceId: workspaceId("workspace-coding-lifecycle-receipt-other"),
        },
      }));

    try {
      await expect(managed.close()).rejects.toMatchObject({
        name: "IsolatedCodingToolLifecycleError",
        code: "cleanup-failed",
      });
      expect(fs.existsSync(harness.worktree.worktreeRoot)).toBe(true);
      await expect(
        harness.persistence.getActiveWorkspaceGrant(harness.operation.workspaceId),
      ).resolves.toMatchObject({ state: "active" });
    } finally {
      persist.mockRestore();
      await managed.close().catch((): undefined => undefined);
    }
  });

  it("asks the user a second time before a saved patch may be applied to the original workspace", async () => {
    const harness = await openHarness("apply-approval");
    const applyOperation = {
      ...harness.operation,
      requestId: toolRequestId("request-coding-apply-approval"),
      toolId: ARTIFACT_APPLY_TOOL_ID,
      action: "artifact.apply",
      summary: buildArtifactApplyApprovalSummary({
        changedFileCount: 2,
        baseCommit: "b".repeat(40),
      }),
    } as const satisfies ProtectedOperation;

    // A manifest must exist, otherwise the Gateway fails as `manifest-unavailable` before the
    // policy decision and the apply approval never reaches the user at all.
    await expect(harness.platform.executor.manifest(ARTIFACT_APPLY_TOOL_ID)).resolves.toMatchObject(
      { actions: ["artifact.apply"], resourceKinds: ["repository"] },
    );

    const gated = await harness.platform.toolGateway.invoke(applyOperation);
    expect(gated.status).toBe("approval-required");
    if (gated.status !== "approval-required") {
      throw new Error("Applying a saved patch must require its own approval");
    }
    expect(gated.approval.state).toBe("pending");
    expect(gated.decision.effect).toBe("require-approval");

    // Applying writes the user's repository, so the copy must not read like saving an Artifact.
    expect(applyOperation.summary).toContain("modifies the original workspace");
    expect(applyOperation.summary).not.toContain("does not modify the original workspace");

    // Even so, the isolated executor never applies a patch: Main owns that write.
    await expect(
      harness.platform.executor.execute({
        operation: applyOperation,
        authorization: {
          grantId: authorizationGrantId("authorization-coding-apply-approval"),
          requestId: applyOperation.requestId,
          workspaceId: applyOperation.workspaceId,
          taskId: applyOperation.taskId,
          sessionId: applyOperation.sessionId,
          workerId: applyOperation.workerId,
          toolId: applyOperation.toolId,
          inputRef: applyOperation.inputRef,
          action: applyOperation.action,
          resourceKind: applyOperation.resourceKind,
          credentialRefs: [],
          policyDecisionId: gated.decision.decisionId,
          policyRevision: gated.decision.policyRevision,
          method: "approval",
          approvalId: gated.approval.approvalId,
          issuedAt: harness.clock.now(),
        },
        credentialLeases: [],
        timeoutMs: 5_000,
      }),
    ).rejects.toMatchObject({
      name: "ProtectedToolExecutionError",
      errorCode: "unsupported-tool",
      mayHaveExecuted: false,
    });
    expect(fs.readFileSync(harness.sourceFile, "utf8")).toBe("before\n");
  });
});
