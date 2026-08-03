import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdtemp, open, realpath, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_EXECUTABLE = "/usr/bin/git";
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
const CLOSED_GIT_CONFIG_ARGUMENTS = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
] as const);

export type IsolatedCodingWorktreeErrorCode =
  | "invalid-options"
  | "repository-invalid"
  | "repository-config-denied"
  | "worktree-create-failed"
  | "cleanup-failed";

export class IsolatedCodingWorktreeError extends Error {
  constructor(
    readonly code: IsolatedCodingWorktreeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IsolatedCodingWorktreeError";
  }
}

export interface CreateIsolatedCodingWorktreeOptions {
  readonly managedRoot: string;
  readonly repositoryRoot: string;
}

export interface IsolatedCodingWorktree {
  readonly repositoryRoot: string;
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
  close(): Promise<void>;
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

async function requireCanonicalDirectory(value: string, label: string): Promise<string> {
  if (
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new IsolatedCodingWorktreeError(
      "invalid-options",
      `${label} must be an absolute normalized non-root path`,
    );
  }
  let metadata;
  let canonical;
  try {
    [metadata, canonical] = await Promise.all([lstat(value), realpath(value)]);
  } catch (error) {
    throw new IsolatedCodingWorktreeError("invalid-options", `${label} is unavailable`, {
      cause: error,
    });
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || canonical !== value) {
    throw new IsolatedCodingWorktreeError(
      "invalid-options",
      `${label} must be a canonical directory`,
    );
  }
  return canonical;
}

function gitEnvironment(managedRoot: string): Readonly<Record<string, string>> {
  return Object.freeze({
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: managedRoot,
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  });
}

async function runGit(
  repositoryRoot: string,
  environment: Readonly<Record<string, string>>,
  ...args: readonly string[]
): Promise<string> {
  const result = await execFileAsync(
    GIT_EXECUTABLE,
    ["-C", repositoryRoot, ...CLOSED_GIT_CONFIG_ARGUMENTS, ...args],
    {
      encoding: "utf8",
      env: environment,
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
    },
  );
  return result.stdout.trim();
}

interface RepositoryConfigurationLock {
  readonly lockPath: string;
  readonly handle: Awaited<ReturnType<typeof open>>;
  closed: boolean;
  removed: boolean;
}

interface RepositoryConfigurationLocks {
  close(): Promise<void>;
}

async function releaseRepositoryConfigurationLocks(
  locks: readonly RepositoryConfigurationLock[],
): Promise<readonly unknown[]> {
  const errors: unknown[] = [];
  for (const lock of [...locks].reverse()) {
    if (!lock.closed) {
      try {
        await lock.handle.close();
        lock.closed = true;
      } catch (error) {
        errors.push(error);
      }
    }
    if (!lock.removed) {
      try {
        await unlink(lock.lockPath);
        lock.removed = true;
      } catch (error) {
        errors.push(error);
      }
    }
  }
  return errors;
}

async function acquireRepositoryConfigurationLocks(
  gitCommonDirectory: string,
  repositoryGitDirectory: string,
): Promise<RepositoryConfigurationLocks> {
  const lockPaths = [
    path.join(gitCommonDirectory, "config.lock"),
    path.join(repositoryGitDirectory, "config.worktree.lock"),
  ];
  const locks: RepositoryConfigurationLock[] = [];
  try {
    for (const lockPath of lockPaths) {
      const handle = await open(
        lockPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      locks.push({ lockPath, handle, closed: false, removed: false });
    }
  } catch (error) {
    const cleanupErrors = await releaseRepositoryConfigurationLocks(locks);
    throw new IsolatedCodingWorktreeError(
      "repository-config-denied",
      "Coding repository configuration is locked by another operation",
      {
        cause: cleanupErrors.length === 0 ? error : new AggregateError([error, ...cleanupErrors]),
      },
    );
  }

  return {
    async close(): Promise<void> {
      const errors = await releaseRepositoryConfigurationLocks(locks);
      if (errors.length > 0) {
        throw new IsolatedCodingWorktreeError(
          "cleanup-failed",
          "Failed to release coding repository configuration locks",
          { cause: errors.length === 1 ? errors[0] : new AggregateError(errors) },
        );
      }
    },
  };
}

async function withRepositoryConfigurationLocks<T>(
  gitCommonDirectory: string,
  repositoryGitDirectory: string,
  operation: () => Promise<T>,
): Promise<T> {
  const locks = await acquireRepositoryConfigurationLocks(
    gitCommonDirectory,
    repositoryGitDirectory,
  );
  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }
  try {
    await locks.close();
  } catch (error) {
    operationError =
      operationError === undefined ? error : new AggregateError([operationError, error]);
  }
  if (operationError !== undefined) {
    throw operationError;
  }
  return result as T;
}

async function requireClosedRepositoryConfiguration(
  repositoryRoot: string,
  environment: Readonly<Record<string, string>>,
): Promise<void> {
  let serialized: string;
  try {
    serialized = await runGit(
      repositoryRoot,
      environment,
      "config",
      "--local",
      "--no-includes",
      "--null",
      "--list",
    );
  } catch (error) {
    throw new IsolatedCodingWorktreeError(
      "repository-invalid",
      "Coding repository configuration could not be inspected",
      { cause: error },
    );
  }

  for (const entry of serialized.split("\0")) {
    const separator = entry.indexOf("\n");
    const key = (separator === -1 ? entry : entry.slice(0, separator)).toLowerCase();
    if (
      /^filter\..+\.(?:clean|smudge|process)$/.test(key) ||
      key === "include.path" ||
      /^includeif\..+\.path$/.test(key)
    ) {
      throw new IsolatedCodingWorktreeError(
        "repository-config-denied",
        "Coding repository configuration can invoke an external checkout process",
      );
    }
  }
}

export async function createIsolatedCodingWorktree(
  options: CreateIsolatedCodingWorktreeOptions,
): Promise<IsolatedCodingWorktree> {
  const [repositoryRoot, managedRoot] = await Promise.all([
    requireCanonicalDirectory(options.repositoryRoot, "Coding repository root"),
    requireCanonicalDirectory(options.managedRoot, "Coding worktree managed root"),
  ]);
  if (isInside(repositoryRoot, managedRoot) || isInside(managedRoot, repositoryRoot)) {
    throw new IsolatedCodingWorktreeError(
      "invalid-options",
      "Coding repository and managed worktree roots must be disjoint",
    );
  }

  const environment = gitEnvironment(managedRoot);
  let reportedRoot: string;
  let insideWorktree: string;
  let commit: string;
  let repositoryGitCommonDirectory: string;
  let repositoryGitDirectory: string;
  try {
    [reportedRoot, insideWorktree, commit, repositoryGitCommonDirectory, repositoryGitDirectory] =
      await Promise.all([
        runGit(repositoryRoot, environment, "rev-parse", "--show-toplevel"),
        runGit(repositoryRoot, environment, "rev-parse", "--is-inside-work-tree"),
        runGit(repositoryRoot, environment, "rev-parse", "--verify", "HEAD^{commit}"),
        runGit(
          repositoryRoot,
          environment,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ).then((directory) => realpath(directory)),
        runGit(repositoryRoot, environment, "rev-parse", "--absolute-git-dir").then((directory) =>
          realpath(directory),
        ),
      ]);
  } catch (error) {
    throw new IsolatedCodingWorktreeError(
      "repository-invalid",
      "Coding repository could not be verified",
      { cause: error },
    );
  }
  if (reportedRoot !== repositoryRoot) {
    throw new IsolatedCodingWorktreeError(
      "repository-invalid",
      "Coding repository root must be the canonical Git worktree root",
    );
  }
  if (insideWorktree !== "true") {
    throw new IsolatedCodingWorktreeError(
      "repository-invalid",
      "Coding repository must be a non-bare Git worktree",
    );
  }
  let attemptRoot: string | undefined;
  let worktreeRoot: string | undefined;
  let worktreeAdded = false;
  let gitDirectory: string;
  let gitCommonDirectory: string;
  try {
    const binding = await withRepositoryConfigurationLocks(
      repositoryGitCommonDirectory,
      repositoryGitDirectory,
      async () => {
        await requireClosedRepositoryConfiguration(repositoryRoot, environment);
        attemptRoot = await mkdtemp(path.join(managedRoot, "coding-attempt-"));
        worktreeRoot = path.join(attemptRoot, "worktree");
        await runGit(
          repositoryRoot,
          environment,
          "worktree",
          "add",
          "--detach",
          worktreeRoot,
          commit,
        );
        worktreeAdded = true;
        const canonicalWorktreeRoot = await realpath(worktreeRoot);
        if (
          canonicalWorktreeRoot !== worktreeRoot ||
          !isInside(managedRoot, canonicalWorktreeRoot)
        ) {
          throw new IsolatedCodingWorktreeError(
            "worktree-create-failed",
            "Created coding worktree escaped the Actestra-managed root",
          );
        }
        const values = (
          await runGit(
            worktreeRoot,
            environment,
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--absolute-git-dir",
            "--git-common-dir",
          )
        ).split("\n");
        if (values.length !== 3 || values[0] !== canonicalWorktreeRoot) {
          throw new IsolatedCodingWorktreeError(
            "worktree-create-failed",
            "Created coding worktree reported an incompatible Git binding",
          );
        }
        const [canonicalGitDirectory, canonicalGitCommonDirectory] = await Promise.all([
          realpath(values[1]!),
          realpath(values[2]!),
        ]);
        if (
          canonicalGitCommonDirectory !== repositoryGitCommonDirectory ||
          !isInside(canonicalGitCommonDirectory, canonicalGitDirectory)
        ) {
          throw new IsolatedCodingWorktreeError(
            "worktree-create-failed",
            "Created coding worktree escaped the verified repository Git metadata",
          );
        }
        return {
          gitDirectory: canonicalGitDirectory,
          gitCommonDirectory: canonicalGitCommonDirectory,
        };
      },
    );
    gitDirectory = binding.gitDirectory;
    gitCommonDirectory = binding.gitCommonDirectory;
  } catch (error) {
    if (worktreeAdded && worktreeRoot !== undefined) {
      try {
        await runGit(repositoryRoot, environment, "worktree", "remove", "--force", worktreeRoot);
        worktreeAdded = false;
      } catch (cleanupError) {
        throw new IsolatedCodingWorktreeError(
          "cleanup-failed",
          "Failed to remove Git metadata for a partially created coding worktree",
          { cause: new AggregateError([error, cleanupError]) },
        );
      }
    }
    if (attemptRoot !== undefined) {
      try {
        await rm(attemptRoot, { force: true, recursive: true });
      } catch (cleanupError) {
        throw new IsolatedCodingWorktreeError(
          "cleanup-failed",
          "Failed to remove a partially created coding worktree",
          { cause: new AggregateError([error, cleanupError]) },
        );
      }
    }
    if (error instanceof IsolatedCodingWorktreeError) {
      throw error;
    }
    throw new IsolatedCodingWorktreeError(
      "worktree-create-failed",
      "Failed to create the isolated coding worktree",
      { cause: error },
    );
  }

  if (attemptRoot === undefined || worktreeRoot === undefined) {
    throw new IsolatedCodingWorktreeError(
      "worktree-create-failed",
      "Isolated coding worktree creation completed without a managed root",
    );
  }
  const stableAttemptRoot = attemptRoot;
  const stableWorktreeRoot = worktreeRoot;

  let closePromise: Promise<void> | undefined;
  let gitMetadataRemoved = false;
  let attemptRootRemoved = false;
  return Object.freeze({
    repositoryRoot,
    worktreeRoot: stableWorktreeRoot,
    gitDirectory,
    gitCommonDirectory,
    close(): Promise<void> {
      if (gitMetadataRemoved && attemptRootRemoved) {
        return Promise.resolve();
      }
      closePromise ??= (async () => {
        if (!gitMetadataRemoved) {
          await runGit(
            repositoryRoot,
            environment,
            "worktree",
            "remove",
            "--force",
            stableWorktreeRoot,
          );
          gitMetadataRemoved = true;
        }
        if (!attemptRootRemoved) {
          await rm(stableAttemptRoot, { force: true, recursive: true });
          attemptRootRemoved = true;
        }
      })().catch((error: unknown) => {
        closePromise = undefined;
        if (error instanceof IsolatedCodingWorktreeError) {
          throw error;
        }
        throw new IsolatedCodingWorktreeError(
          "cleanup-failed",
          "Failed to remove the isolated coding worktree",
          { cause: error },
        );
      });
      return closePromise;
    },
  });
}
