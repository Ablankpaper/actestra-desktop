import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Absolute interpreter path, so a mutated `PATH` can never select a different Git. */
export const GIT_EXECUTABLE = "/usr/bin/git";
export const GIT_TIMEOUT_MS = 10_000;

/**
 * Configuration that must not be inherited from the destination repository. Hooks and the filesystem
 * monitor would let a checked-out repository run its own code during an Actestra-initiated write.
 */
export const CLOSED_GIT_CONFIG_ARGUMENTS = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
] as const);

export type WorkspaceGitBindingErrorCode = "not-a-repository" | "git-failed" | "binding-changed";

export class WorkspaceGitBindingError extends Error {
  constructor(
    readonly code: WorkspaceGitBindingErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceGitBindingError";
  }
}

/**
 * A destination proven by Git rather than by path shape. Every field is what Git itself reported for
 * one working tree, which is the only way to know a root, its Git directory and its repository
 * actually belong together.
 */
export interface WorkspaceGitBinding {
  /** Canonical top level of the working tree. */
  readonly workspaceRoot: string;
  /** Canonical Git directory for this working tree; per-worktree when the root is a linked worktree. */
  readonly gitDirectory: string;
  /** Canonical shared repository directory. Equal to {@link gitDirectory} for a primary checkout. */
  readonly gitCommonDirectory: string;
  /** True when this root is a linked worktree rather than the repository's own checkout. */
  readonly isLinkedWorktree: boolean;
}

export function workspaceGitEnvironment(workspaceRoot: string): Readonly<Record<string, string>> {
  return Object.freeze({
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: path.dirname(workspaceRoot),
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  });
}

export async function execWorkspaceGit(
  workspaceRoot: string,
  environment: Readonly<Record<string, string>>,
  ...args: readonly string[]
): Promise<string> {
  const result = await execFileAsync(
    GIT_EXECUTABLE,
    ["-C", workspaceRoot, ...CLOSED_GIT_CONFIG_ARGUMENTS, ...args],
    {
      encoding: "utf8",
      env: environment,
      maxBuffer: 64 * 1024,
      timeout: GIT_TIMEOUT_MS,
    },
  );
  return result.stdout;
}

async function canonicalize(target: string, field: string): Promise<string> {
  try {
    return await realpath(target);
  } catch (error) {
    throw new WorkspaceGitBindingError("not-a-repository", `Workspace ${field} is unavailable`, {
      cause: error,
    });
  }
}

/**
 * Resolves what Git reports for `candidateRoot` in a single closed environment. `realpath` alone
 * cannot establish a binding: it proves a path exists, not that it is a working tree, not which Git
 * directory serves it, and not whether that directory is a linked worktree's or the repository's own.
 */
export async function resolveWorkspaceGitBinding(
  candidateRoot: string,
): Promise<WorkspaceGitBinding> {
  const canonicalCandidate = await canonicalize(candidateRoot, "root");
  const environment = workspaceGitEnvironment(canonicalCandidate);
  let output: string;
  try {
    output = await execWorkspaceGit(
      canonicalCandidate,
      environment,
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--git-common-dir",
      "--is-inside-work-tree",
      "--is-bare-repository",
    );
  } catch (error) {
    throw new WorkspaceGitBindingError(
      "not-a-repository",
      "Git could not resolve the workspace binding",
      { cause: error },
    );
  }
  const lines = output.split("\n").filter((line) => line.length > 0);
  if (lines.length !== 5) {
    throw new WorkspaceGitBindingError(
      "git-failed",
      "Git returned an unexpected workspace binding",
    );
  }
  const [topLevel, gitDir, commonDir, insideWorkTree, bare] = lines as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (insideWorkTree !== "true" || bare !== "false") {
    throw new WorkspaceGitBindingError(
      "not-a-repository",
      "Workspace is not a non-bare Git working tree",
    );
  }
  const workspaceRoot = await canonicalize(topLevel, "root");
  const gitDirectory = await canonicalize(gitDir, "Git directory");
  // `--git-common-dir` may be relative to the working tree, so it is joined before canonicalizing.
  const gitCommonDirectory = await canonicalize(
    path.isAbsolute(commonDir) ? commonDir : path.resolve(workspaceRoot, commonDir),
    "shared Git directory",
  );
  return Object.freeze({
    workspaceRoot,
    gitDirectory,
    gitCommonDirectory,
    isLinkedWorktree: gitDirectory !== gitCommonDirectory,
  });
}

/**
 * Re-resolves the destination and fails unless every field still matches. Used across a user
 * decision, where the admitted path can be moved, relinked or swapped while approval is pending.
 */
export async function assertWorkspaceGitBindingUnchanged(
  expected: WorkspaceGitBinding,
): Promise<void> {
  let observed: WorkspaceGitBinding;
  try {
    observed = await resolveWorkspaceGitBinding(expected.workspaceRoot);
  } catch (error) {
    throw new WorkspaceGitBindingError(
      "binding-changed",
      "Workspace Git binding could no longer be resolved",
      { cause: error },
    );
  }
  if (
    observed.workspaceRoot !== expected.workspaceRoot ||
    observed.gitDirectory !== expected.gitDirectory ||
    observed.gitCommonDirectory !== expected.gitCommonDirectory ||
    observed.isLinkedWorktree !== expected.isLinkedWorktree
  ) {
    throw new WorkspaceGitBindingError("binding-changed", "Workspace Git binding changed");
  }
}
