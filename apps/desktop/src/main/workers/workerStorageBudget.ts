import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { GOOSE_WORKER_RESOURCE_PROFILE } from "../../core/workerResourceBudget";

export const GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES = 64 * 1024 * 1024;

const MAX_TRAVERSAL_ENTRIES = 16_384;

export type WorkerStorageBudgetErrorCode =
  | "worker-resource-output-exceeded"
  | "worker-resource-storage-exceeded";

export class WorkerStorageBudgetError extends Error {
  constructor(
    readonly code: WorkerStorageBudgetErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkerStorageBudgetError";
  }
}

export interface WorkerPrivateStorageMeasurement {
  readonly fileCount: number;
  readonly byteLength: number;
  readonly largestFileBytes: number;
}

function storageExceeded(message: string, cause?: unknown): WorkerStorageBudgetError {
  return new WorkerStorageBudgetError("worker-resource-storage-exceeded", message, { cause });
}

function outputExceeded(message: string): WorkerStorageBudgetError {
  return new WorkerStorageBudgetError("worker-resource-output-exceeded", message);
}

function assertStorageRoot(root: string): void {
  if (
    typeof root !== "string" ||
    !path.isAbsolute(root) ||
    path.resolve(root) !== root ||
    path.parse(root).root === root
  ) {
    throw storageExceeded("Worker private storage root is unavailable");
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function measureWorkerPrivateStorage(
  root: string,
): Promise<WorkerPrivateStorageMeasurement> {
  assertStorageRoot(root);
  const rootMetadata = await lstat(root).catch((error: unknown) => {
    throw storageExceeded("Worker private storage root cannot be inspected", error);
  });
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw storageExceeded("Worker private storage root is unavailable");
  }

  const pending = [root];
  let visited = 0;
  let fileCount = 0;
  let byteLength = 0;
  let largestFileBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    visited += 1;
    if (visited > MAX_TRAVERSAL_ENTRIES) {
      throw storageExceeded("Worker private storage traversal exceeded the admitted boundary");
    }
    const metadata = await lstat(current).catch((error: unknown) => {
      throw storageExceeded("Worker private storage entry cannot be inspected", error);
    });
    if (metadata.isSymbolicLink()) {
      throw storageExceeded("Worker private storage cannot contain symbolic links");
    }
    if (metadata.isDirectory()) {
      const entries = await readdir(current).catch((error: unknown) => {
        throw storageExceeded("Worker private storage directory cannot be read", error);
      });
      for (const entry of entries) {
        pending.push(path.join(current, entry));
      }
      continue;
    }
    if (!metadata.isFile()) {
      throw storageExceeded("Worker private storage contains an unsupported entry type");
    }
    fileCount += 1;
    byteLength += metadata.size;
    largestFileBytes = Math.max(largestFileBytes, metadata.size);
    if (
      metadata.size > GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES ||
      byteLength > GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateStorageBytes
    ) {
      throw storageExceeded("Worker private storage exceeded the admitted byte boundary");
    }
  }
  return Object.freeze({ fileCount, byteLength, largestFileBytes });
}

export async function assertWorkerPrivateStorageWithinBudget(
  root: string,
): Promise<WorkerPrivateStorageMeasurement> {
  return measureWorkerPrivateStorage(root);
}

export async function assertProjectedWorkerPrivateStorageWrite(
  root: string,
  target: string,
  byteLength: number,
): Promise<void> {
  assertStorageRoot(root);
  if (
    typeof target !== "string" ||
    !path.isAbsolute(target) ||
    path.resolve(target) !== target ||
    !isInside(root, target) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw storageExceeded("Worker private storage projected write is unavailable");
  }
  if (byteLength > GOOSE_WORKER_MAX_PRIVATE_STORAGE_FILE_BYTES) {
    throw storageExceeded("Worker private storage file exceeded the admitted byte boundary");
  }
  const measurement = await measureWorkerPrivateStorage(root);
  const existing = await lstat(target).catch((error: unknown): undefined => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw storageExceeded("Worker private storage write target cannot be inspected", error);
  });
  if (existing !== undefined) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw storageExceeded("Worker private storage write target is unsupported");
    }
  }
  if (measurement.byteLength + byteLength > GOOSE_WORKER_RESOURCE_PROFILE.maxPrivateStorageBytes) {
    throw storageExceeded("Worker private storage aggregate exceeded the admitted byte boundary");
  }
}

export function assertWorkerOutputWithinBudget(content: string): void {
  if (
    typeof content !== "string" ||
    Buffer.byteLength(content, "utf8") > GOOSE_WORKER_RESOURCE_PROFILE.maxOutputBytes
  ) {
    throw outputExceeded("Worker output exceeded the admitted byte boundary");
  }
}
