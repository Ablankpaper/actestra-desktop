import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES,
  WorkerStorageBudgetError,
  assertProjectedWorkerPrivateStorageWrite,
  assertWorkerOutputWithinBudget,
  assertWorkerPrivateStorageWithinBudget,
  measureWorkerPrivateStorage,
} from "../../apps/desktop/src/main/workers/workerStorageBudget";

const fixtureRoots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "actestra-worker-storage-budget-"));
  fixtureRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => fs.rm(root, { recursive: true })));
});

describe("Worker private-root storage budget", () => {
  it("measures regular files with bounded traversal and no shell dependency", async () => {
    const root = await fixtureRoot();
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "one.txt"), "one");
    await fs.writeFile(path.join(root, "nested", "two.txt"), "two-two");

    await expect(measureWorkerPrivateStorage(root)).resolves.toEqual({
      fileCount: 2,
      byteLength: Buffer.byteLength("onetwo-two"),
      largestFileBytes: Buffer.byteLength("two-two"),
    });
  });

  it("fails closed on symlinks and redacts private paths from errors", async () => {
    const root = await fixtureRoot();
    const secretPath = path.join(root, "secret-target.txt");
    await fs.writeFile(secretPath, "secret-content");
    await fs.symlink(secretPath, path.join(root, "link.txt"));

    const error = await measureWorkerPrivateStorage(root).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(WorkerStorageBudgetError);
    expect(error).toMatchObject({ code: "worker-resource-storage-exceeded" });
    expect(String(error)).not.toContain(root);
    expect(String(error)).not.toContain("secret-content");
  });

  it("rejects a projected write that would exceed aggregate or per-file limits", async () => {
    const root = await fixtureRoot();
    const target = path.join(root, "worktree", "result.txt");
    await fs.mkdir(path.dirname(target), { recursive: true });
    for (let index = 0; index < 8; index += 1) {
      const filler = path.join(root, `existing-${String(index)}.bin`);
      await fs.writeFile(filler, "");
      await fs.truncate(filler, GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES);
    }

    await expect(assertProjectedWorkerPrivateStorageWrite(root, target, 1)).rejects.toMatchObject({
      code: "worker-resource-storage-exceeded",
    });
    await expect(
      assertProjectedWorkerPrivateStorageWrite(
        root,
        target,
        GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES + 1,
      ),
    ).rejects.toMatchObject({ code: "worker-resource-storage-exceeded" });
  });

  it("accounts for the temporary file peak during an atomic replacement", async () => {
    const root = await fixtureRoot();
    const target = path.join(root, "result.txt");
    await fs.writeFile(target, "");
    await fs.truncate(target, GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES);
    for (let index = 0; index < 7; index += 1) {
      const filler = path.join(root, `replacement-filler-${String(index)}.bin`);
      await fs.writeFile(filler, "");
      await fs.truncate(filler, GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES);
    }

    await expect(
      assertProjectedWorkerPrivateStorageWrite(
        root,
        target,
        GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES,
      ),
    ).rejects.toMatchObject({ code: "worker-resource-storage-exceeded" });
  });

  it("rejects output evidence above the Goose Worker output budget", () => {
    expect(() => assertWorkerOutputWithinBudget("x".repeat(256 * 1024))).not.toThrow();
    expect(() => assertWorkerOutputWithinBudget("x".repeat(256 * 1024 + 1))).toThrowError(
      expect.objectContaining({ code: "worker-resource-output-exceeded" }),
    );
  });

  it("accepts a private root only when aggregate and per-file budgets remain within profile", async () => {
    const root = await fixtureRoot();
    await fs.writeFile(path.join(root, "small.txt"), "ok");

    await expect(assertWorkerPrivateStorageWithinBudget(root)).resolves.toEqual({
      fileCount: 1,
      byteLength: 2,
      largestFileBytes: 2,
    });
  });
});
