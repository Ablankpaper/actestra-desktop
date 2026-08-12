// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { instant, type PrivilegedClock } from "../../apps/desktop/src/core";
import {
  REPOSITORY_LOCK_FILENAME,
  REPOSITORY_LOCK_STALE_AFTER_MS,
  WorkspaceRepositoryLockError,
  acquireWorkspaceRepositoryLock,
} from "../../apps/desktop/src/main/workers/workspaceRepositoryLock";

const START = instant("2026-08-11T00:00:00.000Z");

/** Fixed unless a test moves it, so staleness is decided by the injected clock and never wall time. */
function clock(offsetMs = 0): PrivilegedClock {
  return { now: () => instant(new Date(Date.parse(START) + offsetMs).toISOString()) };
}

const directories: string[] = [];

async function gitDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "actestra-lock-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  // Each lock lives inside its own temporary Git directory, so removing the directory drops it.
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("workspace repository lock", () => {
  it("writes the lock inside the Git directory, so the working tree is never touched", async () => {
    const directory = await gitDirectory();
    const lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-one",
    });

    expect(lock.lockPath).toBe(path.join(directory, REPOSITORY_LOCK_FILENAME));
    const contents: unknown = JSON.parse(await readFile(lock.lockPath, "utf8"));
    expect(contents).toMatchObject({ pid: process.pid, holder: "apply-one", acquiredAt: START });
  });

  it("refuses a second attempt while the first still holds the lock", async () => {
    const directory = await gitDirectory();
    await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-one",
    });

    const error = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-two",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceRepositoryLockError);
    expect((error as WorkspaceRepositoryLockError).code).toBe("lock-unavailable");
  });

  it("hands the lock to the next attempt once the holder releases", async () => {
    const directory = await gitDirectory();
    const first = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-one",
    });
    await first.release();

    const second = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-two",
    });

    const contents: unknown = JSON.parse(await readFile(second.lockPath, "utf8"));
    expect(contents).toMatchObject({ holder: "apply-two" });
  });

  it("releases idempotently, so a finally block can call it twice", async () => {
    const directory = await gitDirectory();
    const lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-one",
    });

    await lock.release();
    await expect(lock.release()).resolves.toBeUndefined();
    await expect(readFile(lock.lockPath, "utf8")).rejects.toThrow();
  });

  it("fails closed on a lock from another process that has not yet expired", async () => {
    const directory = await gitDirectory();
    const lockPath = path.join(directory, REPOSITORY_LOCK_FILENAME);
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid + 1, holder: "other-process", acquiredAt: START }),
      "utf8",
    );

    const error = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(REPOSITORY_LOCK_STALE_AFTER_MS - 1),
      holder: "apply-two",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceRepositoryLockError);
    expect((error as WorkspaceRepositoryLockError).code).toBe("lock-unavailable");
    // The refusal must leave the incumbent's lock intact rather than half-breaking it.
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({ holder: "other-process" });
  });

  it("reclaims a lock abandoned by a dead holder once the stale window passes", async () => {
    const directory = await gitDirectory();
    const lockPath = path.join(directory, REPOSITORY_LOCK_FILENAME);
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid + 1, holder: "dead-holder", acquiredAt: START }),
      "utf8",
    );

    const lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(REPOSITORY_LOCK_STALE_AFTER_MS),
      holder: "apply-two",
    });

    expect(JSON.parse(await readFile(lock.lockPath, "utf8"))).toMatchObject({
      holder: "apply-two",
    });
  });

  it("reclaims a lock whose contents are unreadable, since they cannot prove a live holder", async () => {
    const directory = await gitDirectory();
    const lockPath = path.join(directory, REPOSITORY_LOCK_FILENAME);
    await writeFile(lockPath, "{ truncated", "utf8");

    const lock = await acquireWorkspaceRepositoryLock({
      gitDirectory: directory,
      clock: clock(),
      holder: "apply-two",
    });

    expect(JSON.parse(await readFile(lock.lockPath, "utf8"))).toMatchObject({
      holder: "apply-two",
    });
  });

  it("reports lock-failed when the Git directory does not exist", async () => {
    const error = await acquireWorkspaceRepositoryLock({
      gitDirectory: path.join(await gitDirectory(), "missing"),
      clock: clock(),
      holder: "apply-one",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceRepositoryLockError);
    expect((error as WorkspaceRepositoryLockError).code).toBe("lock-failed");
  });
});
