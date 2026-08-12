import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { MAX_ISOLATED_CODING_PATCH_BYTES } from "../../core";
import {
  requireClosedRepositoryConfiguration,
  withRepositoryConfigurationLocks,
} from "./isolatedCodingWorktree";

const execFileAsync = promisify(execFile);
const GIT_EXECUTABLE = "/usr/bin/git";
const GIT_TIMEOUT_MS = 10_000;
const MAX_UNTRACKED_PATCH_PATHS = 256;
const CLOSED_GIT_CONFIG_ARGUMENTS = Object.freeze([
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
] as const);

export type IsolatedCodingPatchErrorCode =
  | "invalid-options"
  | "repository-config-denied"
  | "worktree-scope-denied"
  | "patch-unavailable"
  | "patch-too-large";

export class IsolatedCodingPatchError extends Error {
  constructor(
    readonly code: IsolatedCodingPatchErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IsolatedCodingPatchError";
  }
}

export interface CaptureIsolatedCodingPatchOptions {
  readonly worktreeRoot: string;
  readonly gitDirectory: string;
  readonly gitCommonDirectory: string;
}

export interface IsolatedCodingPatchSnapshot {
  readonly baseCommit: string;
  readonly patch: string;
  readonly patchByteLength: number;
  readonly patchSha256: string;
  readonly changedFileCount: number;
}

function gitEnvironment(worktreeRoot: string): Readonly<Record<string, string>> {
  return Object.freeze({
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: path.dirname(worktreeRoot),
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  });
}

function assertCanonicalAbsolutePath(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new IsolatedCodingPatchError(
      "invalid-options",
      `${label} must be an absolute normalized non-root path`,
    );
  }
}

async function runGit(
  worktreeRoot: string,
  environment: Readonly<Record<string, string>>,
  maximumOutputBytes: number,
  ...args: readonly string[]
): Promise<string> {
  try {
    const result = await execFileAsync(
      GIT_EXECUTABLE,
      ["-C", worktreeRoot, ...CLOSED_GIT_CONFIG_ARGUMENTS, ...args],
      {
        encoding: "utf8",
        env: environment,
        maxBuffer: maximumOutputBytes,
        timeout: GIT_TIMEOUT_MS,
      },
    );
    return result.stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new IsolatedCodingPatchError(
      code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "patch-too-large" : "patch-unavailable",
      code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? "Coding patch exceeds the admitted byte boundary"
        : "Coding patch could not be read from the isolated worktree",
      { cause: error },
    );
  }
}

export async function captureIsolatedCodingPatch(
  options: CaptureIsolatedCodingPatchOptions,
): Promise<IsolatedCodingPatchSnapshot> {
  assertCanonicalAbsolutePath(options.worktreeRoot, "Coding patch worktree root");
  assertCanonicalAbsolutePath(options.gitDirectory, "Coding patch Git directory");
  assertCanonicalAbsolutePath(options.gitCommonDirectory, "Coding patch Git common directory");
  const environment = gitEnvironment(options.worktreeRoot);
  const [canonicalWorktreeRoot, canonicalGitDirectory, canonicalGitCommonDirectory] =
    await Promise.all([
      realpath(options.worktreeRoot),
      realpath(options.gitDirectory),
      realpath(options.gitCommonDirectory),
    ]).catch((error: unknown) => {
      throw new IsolatedCodingPatchError(
        "worktree-scope-denied",
        "Coding patch worktree binding is unavailable",
        { cause: error },
      );
    });
  if (
    canonicalWorktreeRoot !== options.worktreeRoot ||
    canonicalGitDirectory !== options.gitDirectory ||
    canonicalGitCommonDirectory !== options.gitCommonDirectory
  ) {
    throw new IsolatedCodingPatchError(
      "worktree-scope-denied",
      "Coding patch worktree binding changed before capture",
    );
  }
  try {
    return await withRepositoryConfigurationLocks(
      options.gitCommonDirectory,
      options.gitDirectory,
      async () => {
        await requireClosedRepositoryConfiguration(options.worktreeRoot, environment).catch(
          (error: unknown) => {
            throw new IsolatedCodingPatchError(
              "repository-config-denied",
              "Coding patch capture rejects executable repository configuration",
              { cause: error },
            );
          },
        );
        const binding = (
          await runGit(
            options.worktreeRoot,
            environment,
            16 * 1024,
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--absolute-git-dir",
            "--git-common-dir",
            "--verify",
            "HEAD^{commit}",
          )
        )
          .trimEnd()
          .split("\n");
        if (binding.length !== 4) {
          throw new IsolatedCodingPatchError(
            "worktree-scope-denied",
            "Coding patch worktree returned an incompatible Git binding",
          );
        }
        const [reportedRoot, reportedGitDirectory, reportedGitCommonDirectory, baseCommit] =
          binding;
        const [boundGitDirectory, boundGitCommonDirectory] = await Promise.all([
          realpath(reportedGitDirectory!),
          realpath(reportedGitCommonDirectory!),
        ]);
        if (
          reportedRoot !== options.worktreeRoot ||
          boundGitDirectory !== options.gitDirectory ||
          boundGitCommonDirectory !== options.gitCommonDirectory ||
          !/^[a-f0-9]{40,64}$/u.test(baseCommit!)
        ) {
          throw new IsolatedCodingPatchError(
            "worktree-scope-denied",
            "Coding patch worktree no longer matches its admitted Git binding",
          );
        }
        const untracked = (
          await runGit(
            options.worktreeRoot,
            environment,
            MAX_ISOLATED_CODING_PATCH_BYTES + 1,
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
          )
        )
          .split("\0")
          .filter((candidate) => candidate.length > 0);
        if (untracked.length > MAX_UNTRACKED_PATCH_PATHS) {
          throw new IsolatedCodingPatchError(
            "patch-too-large",
            "Coding patch contains too many untracked paths",
          );
        }
        let temporaryIndexRoot: string | undefined;
        let patch: string;
        try {
          let patchEnvironment = environment;
          if (untracked.length > 0) {
            temporaryIndexRoot = await mkdtemp(
              path.join(path.dirname(options.worktreeRoot), ".publish-index-"),
            );
            patchEnvironment = Object.freeze({
              ...environment,
              GIT_INDEX_FILE: path.join(temporaryIndexRoot, "index"),
            });
            await runGit(
              options.worktreeRoot,
              patchEnvironment,
              16 * 1024,
              "read-tree",
              baseCommit!,
            );
            await runGit(
              options.worktreeRoot,
              patchEnvironment,
              16 * 1024,
              "add",
              "--intent-to-add",
              "--",
              ...untracked,
            );
          }
          patch = await runGit(
            options.worktreeRoot,
            patchEnvironment,
            MAX_ISOLATED_CODING_PATCH_BYTES + 1,
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--binary",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            baseCommit!,
            "--",
          );
          // Count changed files using the same environment so untracked files are included
          const changedPaths = (
            await runGit(
              options.worktreeRoot,
              patchEnvironment,
              MAX_ISOLATED_CODING_PATCH_BYTES + 1,
              "diff",
              "--name-only",
              "-z",
              baseCommit!,
              "--",
            )
          )
            .split("\0")
            .filter((candidate) => candidate.length > 0);

          return Object.freeze({
            baseCommit: baseCommit!,
            patch,
            patchByteLength: Buffer.byteLength(patch, "utf8"),
            patchSha256: createHash("sha256").update(patch, "utf8").digest("hex"),
            changedFileCount: changedPaths.length,
          });
        } finally {
          if (temporaryIndexRoot !== undefined) {
            await rm(temporaryIndexRoot, { force: true, recursive: true });
          }
        }
      },
    );
  } catch (error) {
    if (error instanceof IsolatedCodingPatchError) {
      throw error;
    }
    throw new IsolatedCodingPatchError(
      "repository-config-denied",
      "Coding patch capture could not lock repository configuration",
      { cause: error },
    );
  }
}
