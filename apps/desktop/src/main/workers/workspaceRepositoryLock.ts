import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { instant, type Instant, type PrivilegedClock } from "../../core";

/** Lock file name, kept inside the repository's own Git directory so it never touches the tree. */
export const REPOSITORY_LOCK_FILENAME = "actestra-apply.lock";

/**
 * A lock older than this is treated as abandoned. It only matters when the holder died without
 * releasing: a live holder refreshes nothing, so the window must exceed the longest apply.
 */
export const REPOSITORY_LOCK_STALE_AFTER_MS = 15 * 60 * 1_000;

export type WorkspaceRepositoryLockErrorCode = "lock-unavailable" | "lock-failed";

export class WorkspaceRepositoryLockError extends Error {
  constructor(
    readonly code: WorkspaceRepositoryLockErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceRepositoryLockError";
  }
}

export interface WorkspaceRepositoryLock {
  readonly lockPath: string;
  /** Idempotent: releasing twice is not an error, so `finally` blocks stay simple. */
  release(): Promise<void>;
}

export interface WorkspaceRepositoryLockOptions {
  /** Canonical Git directory, as proven by `resolveWorkspaceGitBinding`. */
  readonly gitDirectory: string;
  readonly clock: PrivilegedClock;
  /** Recorded in the lock file so an abandoned lock names what held it. */
  readonly holder: string;
  readonly staleAfterMs?: number;
}

interface LockContents {
  readonly pid: number;
  readonly holder: string;
  readonly acquiredAt: Instant;
}

/**
 * Locks held by this process. `fs.open` with `wx` is exclusive against other processes, but two
 * awaits inside one process would otherwise queue on the filesystem and surface as a stale-lock
 * race. Tracking them here makes a same-process conflict immediate and unambiguous.
 */
const heldLocks = new Set<string>();

function parseLockContents(raw: string): LockContents | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.pid !== "number" || typeof record.holder !== "string") return null;
    return {
      pid: record.pid,
      holder: record.holder,
      acquiredAt: instant(String(record.acquiredAt)),
    };
  } catch {
    return null;
  }
}

function isStale(contents: LockContents | null, now: Instant, staleAfterMs: number): boolean {
  // Unreadable or malformed contents cannot prove a live holder, so the lock is not trusted.
  if (contents === null) return true;
  const acquired = Date.parse(contents.acquiredAt);
  const current = Date.parse(now);
  if (!Number.isFinite(acquired) || !Number.isFinite(current)) return true;
  return current - acquired >= staleAfterMs;
}

async function writeLockFile(lockPath: string, contents: LockContents): Promise<boolean> {
  let handle;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw new WorkspaceRepositoryLockError(
      "lock-failed",
      "Repository apply lock could not be created",
      { cause: error },
    );
  }
  try {
    await handle.writeFile(JSON.stringify(contents), "utf8");
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Takes the repository's apply lock, so two apply attempts can never write one working tree at the
 * same time. Fails closed: an unexpired lock is refused rather than broken.
 */
export async function acquireWorkspaceRepositoryLock(
  options: WorkspaceRepositoryLockOptions,
): Promise<WorkspaceRepositoryLock> {
  const lockPath = path.join(options.gitDirectory, REPOSITORY_LOCK_FILENAME);
  const staleAfterMs = options.staleAfterMs ?? REPOSITORY_LOCK_STALE_AFTER_MS;
  if (heldLocks.has(lockPath)) {
    throw new WorkspaceRepositoryLockError(
      "lock-unavailable",
      "Another apply attempt in this process holds the repository lock",
    );
  }
  const now = instant(options.clock.now());
  const contents: LockContents = {
    pid: process.pid,
    holder: options.holder,
    acquiredAt: now,
  };

  if (!(await writeLockFile(lockPath, contents))) {
    // Someone holds it. Only an abandoned lock may be taken over, and only once.
    const existing = parseLockContents(await readFile(lockPath, "utf8").catch((): string => ""));
    if (!isStale(existing, now, staleAfterMs)) {
      throw new WorkspaceRepositoryLockError(
        "lock-unavailable",
        "The repository is locked by another apply attempt",
      );
    }
    await rm(lockPath, { force: true }).catch((): undefined => undefined);
    if (!(await writeLockFile(lockPath, contents))) {
      throw new WorkspaceRepositoryLockError(
        "lock-unavailable",
        "The repository lock was taken while reclaiming an abandoned lock",
      );
    }
  }

  heldLocks.add(lockPath);
  let released = false;
  return Object.freeze({
    lockPath,
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      heldLocks.delete(lockPath);
      // A failed unlink must not mask the apply outcome; the stale window recovers it.
      await rm(lockPath, { force: true }).catch((): undefined => undefined);
    },
  });
}
