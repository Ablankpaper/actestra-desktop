import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  assertPersistWorkspaceGrantResult,
  assertWorkspaceGrant,
  ActestraPersistencePort,
  PrivilegedClock,
  type WorkspaceGrant,
  WorkspaceGrantId,
  WorkspaceId,
} from "../../core";
import {
  createIsolatedCodingToolPlatform,
  manageIsolatedCodingToolPlatform,
  IsolatedCodingProcessDefinition,
  ManagedIsolatedCodingToolPlatform,
} from "../privileged/isolatedCodingToolPlatform";
import {
  createIsolatedCodingWorktree,
  type IsolatedCodingWorktree,
} from "./isolatedCodingWorktree";

export type IsolatedCodingMainServiceErrorCode =
  | "invalid-options"
  | "closed"
  | "open-failed"
  | "cleanup-failed";

export class IsolatedCodingMainServiceError extends Error {
  constructor(
    readonly code: IsolatedCodingMainServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IsolatedCodingMainServiceError";
  }
}

export interface CreateIsolatedCodingMainServiceOptions {
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly managedRoot: string;
}

export interface OpenIsolatedCodingMainSessionOptions {
  readonly repositoryRoot: string;
  readonly workspaceId: WorkspaceId;
  readonly grantId: WorkspaceGrantId;
  readonly displayName: string;
  readonly commands: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
}

export type IsolatedCodingMainSession = ManagedIsolatedCodingToolPlatform;

export interface IsolatedCodingMainService {
  readonly managedRoot: string;
  open(options: OpenIsolatedCodingMainSessionOptions): Promise<IsolatedCodingMainSession>;
  close(): Promise<void>;
}

function assertManagedRootPath(managedRoot: string): void {
  if (
    typeof managedRoot !== "string" ||
    !path.isAbsolute(managedRoot) ||
    path.resolve(managedRoot) !== managedRoot ||
    path.parse(managedRoot).root === managedRoot
  ) {
    throw new IsolatedCodingMainServiceError(
      "invalid-options",
      "Isolated coding managed root must be an absolute normalized non-root path",
    );
  }
}

async function ensureManagedRoot(managedRoot: string): Promise<void> {
  const parent = path.dirname(managedRoot);
  const [parentMetadata, canonicalParent] = await Promise.all([lstat(parent), realpath(parent)]);
  if (
    parentMetadata.isSymbolicLink() ||
    !parentMetadata.isDirectory() ||
    canonicalParent !== parent
  ) {
    throw new IsolatedCodingMainServiceError(
      "invalid-options",
      "Isolated coding managed-root parent must be a canonical directory",
    );
  }
  try {
    await mkdir(managedRoot, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  const [metadata, canonical] = await Promise.all([lstat(managedRoot), realpath(managedRoot)]);
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== managedRoot) {
    throw new IsolatedCodingMainServiceError(
      "invalid-options",
      "Isolated coding managed root must be a canonical directory",
    );
  }
}

function requireExactGrantReceipt(
  result: Awaited<ReturnType<ActestraPersistencePort["persistWorkspaceGrant"]>>,
  grant: WorkspaceGrant,
): void {
  assertPersistWorkspaceGrantResult(result);
  if (!isDeepStrictEqual(result.grant, grant)) {
    throw new IsolatedCodingMainServiceError(
      "open-failed",
      "Workspace grant persistence returned mismatched evidence",
    );
  }
}

interface PendingIsolatedCodingCleanup {
  close(): Promise<void>;
}

function createPendingCleanup(options: {
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly worktree: IsolatedCodingWorktree;
  readonly grant?: WorkspaceGrant;
}): PendingIsolatedCodingCleanup {
  const revokedGrant =
    options.grant === undefined
      ? undefined
      : Object.freeze({
          ...options.grant,
          state: "revoked",
          updatedAt: options.clock.now(),
        } as const satisfies WorkspaceGrant);
  if (revokedGrant !== undefined) {
    assertWorkspaceGrant(revokedGrant);
  }
  let grantRevoked = revokedGrant === undefined;
  let worktreeRemoved = false;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    close(): Promise<void> {
      if (worktreeRemoved) {
        return Promise.resolve();
      }
      closePromise ??= (async () => {
        if (!grantRevoked && revokedGrant !== undefined) {
          requireExactGrantReceipt(
            await options.persistence.persistWorkspaceGrant(revokedGrant),
            revokedGrant,
          );
          grantRevoked = true;
        }
        await options.worktree.close();
        worktreeRemoved = true;
      })().catch((error: unknown) => {
        closePromise = undefined;
        throw error;
      });
      return closePromise;
    },
  });
}

export function createIsolatedCodingMainService(
  options: CreateIsolatedCodingMainServiceOptions,
): IsolatedCodingMainService {
  assertManagedRootPath(options.managedRoot);
  const sessions = new Set<ManagedIsolatedCodingToolPlatform>();
  const openings = new Set<Promise<IsolatedCodingMainSession>>();
  const pendingCleanups = new Set<PendingIsolatedCodingCleanup>();
  let accepting = true;
  let closed = false;
  let closePromise: Promise<void> | undefined;

  const openOnce = async (
    sessionOptions: OpenIsolatedCodingMainSessionOptions,
  ): Promise<IsolatedCodingMainSession> => {
    if (!accepting) {
      throw new IsolatedCodingMainServiceError(
        "closed",
        "Desktop-main isolated coding composition is closed",
      );
    }
    await ensureManagedRoot(options.managedRoot);
    let worktree: IsolatedCodingWorktree | undefined;
    let managed: ManagedIsolatedCodingToolPlatform | undefined;
    let grant: WorkspaceGrant | undefined;
    try {
      worktree = await createIsolatedCodingWorktree({
        managedRoot: options.managedRoot,
        repositoryRoot: sessionOptions.repositoryRoot,
      });
      const now = options.clock.now();
      grant = Object.freeze({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        grantId: sessionOptions.grantId,
        workspaceId: sessionOptions.workspaceId,
        rootPath: worktree.worktreeRoot,
        displayName: sessionOptions.displayName,
        state: "active",
        createdAt: now,
        updatedAt: now,
      } as const satisfies WorkspaceGrant);
      assertWorkspaceGrant(grant);
      requireExactGrantReceipt(await options.persistence.persistWorkspaceGrant(grant), grant);
      const platform = createIsolatedCodingToolPlatform({
        persistence: options.persistence,
        repositoryRoot: worktree.repositoryRoot,
        worktreeRoot: worktree.worktreeRoot,
        gitDirectory: worktree.gitDirectory,
        gitCommonDirectory: worktree.gitCommonDirectory,
        clock: options.clock,
        commands: sessionOptions.commands,
        tests: sessionOptions.tests,
      });
      managed = manageIsolatedCodingToolPlatform({
        platform,
        persistence: options.persistence,
        worktree,
        grant,
        clock: options.clock,
      });
      sessions.add(managed);
      if (!accepting) {
        await managed.close();
        sessions.delete(managed);
        throw new IsolatedCodingMainServiceError(
          "closed",
          "Desktop-main isolated coding composition closed while opening a session",
        );
      }
      const stableManaged = managed;
      return Object.freeze({
        approvalService: stableManaged.approvalService,
        policyEngine: stableManaged.policyEngine,
        toolGateway: stableManaged.toolGateway,
        grant: stableManaged.grant,
        repositoryRoot: stableManaged.repositoryRoot,
        worktreeRoot: stableManaged.worktreeRoot,
        gitDirectory: stableManaged.gitDirectory,
        gitCommonDirectory: stableManaged.gitCommonDirectory,
        async close(): Promise<void> {
          await stableManaged.close();
          sessions.delete(stableManaged);
        },
      });
    } catch (error) {
      if (managed === undefined && worktree !== undefined) {
        const cleanup = createPendingCleanup({
          persistence: options.persistence,
          clock: options.clock,
          worktree,
          ...(grant === undefined ? {} : { grant }),
        });
        pendingCleanups.add(cleanup);
        try {
          await cleanup.close();
          pendingCleanups.delete(cleanup);
        } catch (cleanupError) {
          throw new IsolatedCodingMainServiceError(
            "cleanup-failed",
            "Failed opening retained an isolated coding worktree for cleanup retry",
            { cause: new AggregateError([error, cleanupError]) },
          );
        }
      }
      if (error instanceof IsolatedCodingMainServiceError) {
        throw error;
      }
      throw new IsolatedCodingMainServiceError(
        "open-failed",
        "Desktop-main isolated coding composition failed to open",
        { cause: error },
      );
    }
  };

  const open = (
    sessionOptions: OpenIsolatedCodingMainSessionOptions,
  ): Promise<IsolatedCodingMainSession> => {
    if (!accepting) {
      return Promise.reject(
        new IsolatedCodingMainServiceError(
          "closed",
          "Desktop-main isolated coding composition is closed",
        ),
      );
    }
    let opening: Promise<IsolatedCodingMainSession>;
    opening = openOnce(sessionOptions).finally(() => {
      openings.delete(opening);
    });
    openings.add(opening);
    return opening;
  };

  return Object.freeze({
    managedRoot: options.managedRoot,
    open,
    close(): Promise<void> {
      if (closed) {
        return Promise.resolve();
      }
      accepting = false;
      closePromise ??= (async () => {
        await Promise.allSettled(openings);
        await Promise.all(
          [...pendingCleanups].map(async (cleanup) => {
            await cleanup.close();
            pendingCleanups.delete(cleanup);
          }),
        );
        await Promise.all([...sessions].map((session) => session.close()));
      })()
        .then(() => {
          sessions.clear();
          closed = true;
        })
        .catch((error: unknown) => {
          closePromise = undefined;
          throw new IsolatedCodingMainServiceError(
            "cleanup-failed",
            "Desktop-main isolated coding sessions failed to close",
            { cause: error },
          );
        });
      return closePromise;
    },
  });
}
