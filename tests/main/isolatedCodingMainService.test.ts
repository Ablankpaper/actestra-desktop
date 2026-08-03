// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CODING_FILE_READ_TOOL_ID,
  PRIVILEGED_CONTRACT_VERSION,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  instant,
  sessionId,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  workspaceGrantId,
  workspaceId,
  type DomainGraph,
  type ProtectedOperation,
} from "../../apps/desktop/src/core";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import {
  createIsolatedCodingMainService,
  type IsolatedCodingMainService,
} from "../../apps/desktop/src/main/workers/isolatedCodingMainService";
import type { PersistenceUtilityClient } from "../../apps/desktop/src/main/persistence/persistenceUtilityClient";

const execFileAsync = promisify(execFile);
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: os.tmpdir(),
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

interface MainServiceFixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly managedRoot: string;
  readonly sourceFile: string;
  readonly persistence: PersistenceUtilityClient;
  readonly clock: DeterministicAgentClock;
  readonly service: IsolatedCodingMainService;
  readonly ids: {
    readonly workspaceId: ReturnType<typeof workspaceId>;
    readonly taskId: ReturnType<typeof taskId>;
    readonly sessionId: ReturnType<typeof sessionId>;
    readonly workerId: ReturnType<typeof workerId>;
  };
}

const fixtures: MainServiceFixture[] = [];

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function runGit(repositoryRoot: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
  return result.stdout.trim();
}

function graph(ids: MainServiceFixture["ids"], now: ReturnType<typeof instant>): DomainGraph {
  return {
    workspaces: [
      {
        id: ids.workspaceId,
        name: "P5.2 desktop-main fixture",
        state: "active",
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [
      {
        id: ids.taskId,
        workspaceId: ids.workspaceId,
        title: "Compose isolated coding in desktop main",
        state: "running",
        activeSessionId: ids.sessionId,
        createdAt: now,
        updatedAt: now,
      },
    ],
    workers: [
      {
        id: ids.workerId,
        workspaceId: ids.workspaceId,
        adapterKind: "goose",
        state: "busy",
        createdAt: now,
        updatedAt: now,
      },
    ],
    sessions: [
      {
        id: ids.sessionId,
        workspaceId: ids.workspaceId,
        taskId: ids.taskId,
        workerId: ids.workerId,
        state: "running",
        createdAt: now,
        updatedAt: now,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

async function openFixture(suffix: string): Promise<MainServiceFixture> {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "actestra-coding-main-service-test-")),
  );
  const repositoryRoot = path.join(root, "source");
  const managedRoot = path.join(root, "product-state", "coding-worktrees");
  fs.mkdirSync(repositoryRoot);
  await runGit(repositoryRoot, "init", "--initial-branch=main");
  await runGit(repositoryRoot, "config", "user.name", "Actestra Test");
  await runGit(repositoryRoot, "config", "user.email", "actestra-test@example.invalid");
  const sourceFile = path.join(repositoryRoot, "answer.txt");
  fs.writeFileSync(sourceFile, "before\n", "utf8");
  await runGit(repositoryRoot, "add", ".");
  await runGit(repositoryRoot, "commit", "-m", "fixture");

  const { client: persistence } = await openTestPersistenceUtility(
    path.join(root, "product-state"),
  );
  const clock = new DeterministicAgentClock(instant("2026-08-03T12:00:00.000Z"));
  const ids = {
    workspaceId: workspaceId(`workspace-coding-main-${suffix}`),
    taskId: taskId(`task-coding-main-${suffix}`),
    sessionId: sessionId(`session-coding-main-${suffix}`),
    workerId: workerId(`worker-coding-main-${suffix}`),
  };
  await persistence.replaceDomainGraph(graph(ids, clock.now()));
  const service = createIsolatedCodingMainService({
    persistence,
    clock,
    managedRoot,
  });
  const fixture = {
    root,
    repositoryRoot,
    managedRoot,
    sourceFile,
    persistence,
    clock,
    service,
    ids,
  };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const fixture of fixtures.splice(0)) {
    await fixture.service.close().catch((): undefined => undefined);
    await fixture.persistence.close().catch((): undefined => undefined);
    fs.rmSync(fixture.root, { force: true, recursive: true });
  }
});

describe("P5.2 desktop-main isolated coding composition", () => {
  it("persists one exact worktree grant before exposing the closed Tool Gateway", async () => {
    const fixture = await openFixture("open");
    const grantId = workspaceGrantId("grant-coding-main-open");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId,
      displayName: "P5.2 desktop-main worktree",
      commands: {},
      tests: {},
    });

    expect(
      fs
        .realpathSync(session.worktreeRoot)
        .startsWith(`${fs.realpathSync(fixture.managedRoot)}${path.sep}`),
    ).toBe(true);
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toEqual(session.grant);

    const operation = {
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      requestId: toolRequestId("request-coding-main-read"),
      workspaceId: fixture.ids.workspaceId,
      taskId: fixture.ids.taskId,
      sessionId: fixture.ids.sessionId,
      workerId: fixture.ids.workerId,
      toolId: CODING_FILE_READ_TOOL_ID,
      inputRef: toolInputReference("input-coding-main-read"),
      action: "workspace.read",
      resourceKind: "repository",
      summary: "Read answer.txt from the isolated worktree",
      credentialRefs: [],
      requestedAt: fixture.clock.now(),
    } as const satisfies ProtectedOperation;
    await fixture.persistence.storeContentReference({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: operation.inputRef,
      kind: "tool-input",
      owner: {
        workspaceId: operation.workspaceId,
        taskId: operation.taskId,
        sessionId: operation.sessionId,
        workerId: operation.workerId,
        requestId: operation.requestId,
        grantId,
      },
      classification: "task-content",
      mediaType: "text/plain; charset=utf-8",
      content: JSON.stringify({ contractVersion: 1, relativePath: "answer.txt" }),
      createdAt: fixture.clock.now(),
    });

    const result = await session.toolGateway.invoke(operation);
    expect(result).toMatchObject({ status: "executed" });
    expect(fs.readFileSync(fixture.sourceFile, "utf8")).toBe("before\n");
    expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe("");

    const worktreeRoot = session.worktreeRoot;
    await session.close();
    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
  });

  it("closes every active worktree before the desktop-main service becomes unavailable", async () => {
    const fixture = await openFixture("shutdown");
    const session = await fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-shutdown"),
      displayName: "P5.2 shutdown worktree",
      commands: {},
      tests: {},
    });
    const worktreeRoot = session.worktreeRoot;

    await fixture.service.close();

    await expect(fs.promises.stat(worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-after-close"),
        displayName: "must not open",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "closed",
    });
  });

  it("revokes an ambiguously committed grant before removing a failed opening", async () => {
    const fixture = await openFixture("response-loss");
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant").mockImplementationOnce(async (grant) => {
      await persistWorkspaceGrant(grant);
      throw new Error("active grant response lost after commit");
    });

    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-response-loss"),
        displayName: "P5.2 response-loss worktree",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "open-failed",
    });

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  });

  it("waits for an in-flight opening before desktop-main shutdown completes", async () => {
    const fixture = await openFixture("open-close-race");
    const activePersistStarted = deferred<void>();
    const releaseActivePersist = deferred<void>();
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant").mockImplementationOnce(async (grant) => {
      activePersistStarted.resolve();
      await releaseActivePersist.promise;
      return persistWorkspaceGrant(grant);
    });

    const opening = fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-open-close-race"),
      displayName: "P5.2 open-close race worktree",
      commands: {},
      tests: {},
    });
    await activePersistStarted.promise;
    let closeSettled = false;
    const closing = fixture.service.close().then(() => {
      closeSettled = true;
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(closeSettled).toBe(false);

    releaseActivePersist.resolve();
    await expect(opening).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "closed",
    });
    await closing;

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  });

  it("retains a failed opening until grant revocation and worktree cleanup can retry", async () => {
    const fixture = await openFixture("cleanup-retry");
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => {
        await persistWorkspaceGrant(grant);
        throw new Error("active grant response lost after commit");
      })
      .mockRejectedValueOnce(new Error("revocation persistence unavailable"))
      .mockImplementation(persistWorkspaceGrant);

    await expect(
      fixture.service.open({
        repositoryRoot: fixture.repositoryRoot,
        workspaceId: fixture.ids.workspaceId,
        grantId: workspaceGrantId("grant-coding-main-cleanup-retry"),
        displayName: "P5.2 cleanup-retry worktree",
        commands: {},
        tests: {},
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
      code: "cleanup-failed",
    });
    const activeGrant = await fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId);
    expect(activeGrant).not.toBeNull();
    await expect(fs.promises.stat(activeGrant!.rootPath)).resolves.toMatchObject({});

    await fixture.service.close();

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    await expect(fs.promises.stat(activeGrant!.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a raced managed session owned when its first shutdown cleanup fails", async () => {
    const fixture = await openFixture("managed-close-retry");
    const activePersistStarted = deferred<void>();
    const releaseActivePersist = deferred<void>();
    const persistWorkspaceGrant = fixture.persistence.persistWorkspaceGrant.bind(
      fixture.persistence,
    );
    vi.spyOn(fixture.persistence, "persistWorkspaceGrant")
      .mockImplementationOnce(async (grant) => {
        activePersistStarted.resolve();
        await releaseActivePersist.promise;
        return persistWorkspaceGrant(grant);
      })
      .mockRejectedValueOnce(new Error("first managed revocation unavailable"))
      .mockImplementation(persistWorkspaceGrant);

    const opening = fixture.service.open({
      repositoryRoot: fixture.repositoryRoot,
      workspaceId: fixture.ids.workspaceId,
      grantId: workspaceGrantId("grant-coding-main-managed-close-retry"),
      displayName: "P5.2 managed close retry worktree",
      commands: {},
      tests: {},
    });
    await activePersistStarted.promise;
    const closing = fixture.service.close();
    releaseActivePersist.resolve();

    await expect(opening).rejects.toMatchObject({
      name: "IsolatedCodingMainServiceError",
    });
    await closing;

    await expect(
      fixture.persistence.getActiveWorkspaceGrant(fixture.ids.workspaceId),
    ).resolves.toBeNull();
    expect(fs.readdirSync(fixture.managedRoot)).toEqual([]);
  });
});
