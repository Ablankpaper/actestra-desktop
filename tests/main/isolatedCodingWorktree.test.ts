import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createIsolatedCodingWorktree } from "../../apps/desktop/src/main/workers/isolatedCodingWorktree";

const execFileAsync = promisify(execFile);
const fixtureRoots = new Set<string>();

const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: os.tmpdir(),
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

async function runGit(repository: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("/usr/bin/git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
  return result.stdout.trim();
}

async function createRepositoryFixture(): Promise<{
  readonly fixtureRoot: string;
  readonly managedRoot: string;
  readonly repositoryRoot: string;
  readonly sentinelPath: string;
}> {
  const fixtureRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "actestra-coding-worktree-test-")),
  );
  fixtureRoots.add(fixtureRoot);
  const repositoryRoot = path.join(fixtureRoot, "source");
  const managedRoot = path.join(fixtureRoot, "managed");
  await Promise.all([mkdir(repositoryRoot), mkdir(managedRoot)]);
  await runGit(repositoryRoot, "init", "--initial-branch=main");
  await runGit(repositoryRoot, "config", "user.name", "Actestra Test");
  await runGit(repositoryRoot, "config", "user.email", "actestra-test@example.invalid");
  const sentinelPath = path.join(repositoryRoot, "sentinel.txt");
  await writeFile(sentinelPath, "source checkout must remain unchanged\n", "utf8");
  await runGit(repositoryRoot, "add", "sentinel.txt");
  await runGit(repositoryRoot, "commit", "-m", "fixture");
  return { fixtureRoot, managedRoot, repositoryRoot, sentinelPath };
}

afterEach(async () => {
  await Promise.all(
    [...fixtureRoots].map(async (fixtureRoot) => {
      await rm(fixtureRoot, { force: true, recursive: true });
      fixtureRoots.delete(fixtureRoot);
    }),
  );
});

describe("P5.2 isolated coding worktree", () => {
  it("creates a detached worktree under the Actestra-managed root without changing the source checkout", async () => {
    const fixture = await createRepositoryFixture();
    const sourceCommit = await runGit(fixture.repositoryRoot, "rev-parse", "HEAD");
    const sourceStatus = await runGit(fixture.repositoryRoot, "status", "--porcelain=v1");

    const opened = await createIsolatedCodingWorktree({
      managedRoot: fixture.managedRoot,
      repositoryRoot: fixture.repositoryRoot,
    });

    try {
      const canonicalManagedRoot = await realpath(fixture.managedRoot);
      const canonicalWorktreeRoot = await realpath(opened.worktreeRoot);
      expect(canonicalWorktreeRoot.startsWith(`${canonicalManagedRoot}${path.sep}`)).toBe(true);
      expect(opened.gitDirectory).toBe(
        await realpath(await runGit(opened.worktreeRoot, "rev-parse", "--absolute-git-dir")),
      );
      expect(opened.gitCommonDirectory).toBe(
        await realpath(
          await runGit(
            opened.worktreeRoot,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ),
        ),
      );
      expect(await runGit(opened.worktreeRoot, "rev-parse", "HEAD")).toBe(sourceCommit);
      await expect(
        execFileAsync("/usr/bin/git", ["-C", opened.worktreeRoot, "symbolic-ref", "-q", "HEAD"], {
          encoding: "utf8",
          env: GIT_ENVIRONMENT,
        }),
      ).rejects.toMatchObject({ code: 1 });

      await writeFile(path.join(opened.worktreeRoot, "sentinel.txt"), "isolated change\n", "utf8");
      expect(await readFile(fixture.sentinelPath, "utf8")).toBe(
        "source checkout must remain unchanged\n",
      );
      expect(await runGit(fixture.repositoryRoot, "status", "--porcelain=v1")).toBe(sourceStatus);
    } finally {
      await opened.close();
    }

    await expect(stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries cleanup after a locked worktree blocks Git metadata removal", async () => {
    const fixture = await createRepositoryFixture();
    const opened = await createIsolatedCodingWorktree({
      managedRoot: fixture.managedRoot,
      repositoryRoot: fixture.repositoryRoot,
    });
    let locked = false;

    try {
      await runGit(fixture.repositoryRoot, "worktree", "lock", opened.worktreeRoot);
      locked = true;

      await expect(opened.close()).rejects.toMatchObject({
        name: "IsolatedCodingWorktreeError",
        code: "cleanup-failed",
      });
      await expect(stat(opened.worktreeRoot)).resolves.toMatchObject({});
      expect(await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).toContain(
        `worktree ${opened.worktreeRoot}`,
      );

      await runGit(fixture.repositoryRoot, "worktree", "unlock", opened.worktreeRoot);
      locked = false;
      await expect(opened.close()).resolves.toBeUndefined();
      await expect(stat(opened.worktreeRoot)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).not.toContain(
        `worktree ${opened.worktreeRoot}`,
      );
    } finally {
      if (locked) {
        await runGit(fixture.repositoryRoot, "worktree", "unlock", opened.worktreeRoot).catch(
          (): undefined => undefined,
        );
      }
      await opened.close().catch((): undefined => undefined);
    }
  });

  it("rejects an existing repository configuration lock before checkout", async () => {
    const fixture = await createRepositoryFixture();
    const gitCommonDirectory = await realpath(
      await runGit(
        fixture.repositoryRoot,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ),
    );
    const configLock = path.join(gitCommonDirectory, "config.lock");
    await writeFile(configLock, "held by another writer\n", { flag: "wx", mode: 0o600 });

    try {
      await expect(
        createIsolatedCodingWorktree({
          managedRoot: fixture.managedRoot,
          repositoryRoot: fixture.repositoryRoot,
        }),
      ).rejects.toMatchObject({
        name: "IsolatedCodingWorktreeError",
        code: "repository-config-denied",
      });
      expect(await readdir(fixture.managedRoot)).toEqual([]);
      expect(await readFile(configLock, "utf8")).toBe("held by another writer\n");
    } finally {
      await rm(configLock, { force: true });
    }
  });

  it("rejects a non-Git directory without leaving a managed attempt root", async () => {
    const fixture = await createRepositoryFixture();
    const nonRepository = path.join(fixture.fixtureRoot, "not-a-repository");
    await mkdir(nonRepository);

    await expect(
      createIsolatedCodingWorktree({
        managedRoot: fixture.managedRoot,
        repositoryRoot: nonRepository,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingWorktreeError",
      code: "repository-invalid",
    });

    expect(await readdir(fixture.managedRoot)).toEqual([]);
  });

  it("removes Git metadata when post-create binding validation rejects the worktree", async () => {
    const fixture = await createRepositoryFixture();
    const managedRoot = path.join(fixture.fixtureRoot, "managed\nroot");
    await mkdir(managedRoot);

    await expect(
      createIsolatedCodingWorktree({
        managedRoot,
        repositoryRoot: fixture.repositoryRoot,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingWorktreeError",
      code: "worktree-create-failed",
    });

    expect(await readdir(managedRoot)).toEqual([]);
    expect(await runGit(fixture.repositoryRoot, "worktree", "list", "--porcelain")).not.toContain(
      "coding-attempt-",
    );
  });

  it("rejects a repository subdirectory instead of silently widening to its Git root", async () => {
    const fixture = await createRepositoryFixture();
    const subdirectory = path.join(fixture.repositoryRoot, "nested");
    await mkdir(subdirectory);

    await expect(
      createIsolatedCodingWorktree({
        managedRoot: fixture.managedRoot,
        repositoryRoot: subdirectory,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingWorktreeError",
      code: "repository-invalid",
    });
  });

  it("rejects symbolic-link roots and overlapping managed scope", async () => {
    const fixture = await createRepositoryFixture();
    const repositoryAlias = path.join(fixture.fixtureRoot, "repository-alias");
    await symlink(fixture.repositoryRoot, repositoryAlias, "dir");

    await expect(
      createIsolatedCodingWorktree({
        managedRoot: fixture.managedRoot,
        repositoryRoot: repositoryAlias,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingWorktreeError",
      code: "invalid-options",
    });

    await expect(
      createIsolatedCodingWorktree({
        managedRoot: fixture.fixtureRoot,
        repositoryRoot: fixture.repositoryRoot,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingWorktreeError",
      code: "invalid-options",
    });
    expect(await readdir(fixture.managedRoot)).toEqual([]);
  });

  it("rejects repository-local clean, smudge, and process filters before checkout", async () => {
    const fixture = await createRepositoryFixture();
    const filterMarker = path.join(fixture.fixtureRoot, "filter-executed.txt");
    const filterScript = path.join(fixture.repositoryRoot, "filter.mjs");
    await writeFile(
      filterScript,
      [
        "import { appendFileSync } from 'node:fs';",
        `appendFileSync(${JSON.stringify(filterMarker)}, 'executed\\n');`,
        "process.stdin.pipe(process.stdout);",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(fixture.repositoryRoot, ".gitattributes"),
      "sentinel.txt filter=host-command\n",
      "utf8",
    );
    await runGit(fixture.repositoryRoot, "add", ".gitattributes", "filter.mjs");
    await runGit(fixture.repositoryRoot, "commit", "-m", "configure filter fixture");
    const command = `${process.execPath} ${filterScript}`;
    await runGit(fixture.repositoryRoot, "config", "filter.host-command.clean", command);
    await runGit(fixture.repositoryRoot, "config", "filter.host-command.smudge", command);
    await runGit(fixture.repositoryRoot, "config", "filter.host-command.process", command);

    await expect(
      createIsolatedCodingWorktree({
        managedRoot: fixture.managedRoot,
        repositoryRoot: fixture.repositoryRoot,
      }),
    ).rejects.toMatchObject({
      name: "IsolatedCodingWorktreeError",
      code: "repository-config-denied",
    });

    await expect(stat(filterMarker)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(fixture.managedRoot)).toEqual([]);
  });

  it("disables repository hooks while creating the isolated worktree", async () => {
    const fixture = await createRepositoryFixture();
    const hookMarker = path.join(fixture.fixtureRoot, "post-checkout-executed.txt");
    const hooksRoot = path.join(fixture.fixtureRoot, "hooks");
    const postCheckout = path.join(hooksRoot, "post-checkout");
    await mkdir(hooksRoot);
    await writeFile(postCheckout, `#!/bin/sh\ntouch ${hookMarker}\n`, "utf8");
    await chmod(postCheckout, 0o700);
    await runGit(fixture.repositoryRoot, "config", "core.hooksPath", hooksRoot);

    const opened = await createIsolatedCodingWorktree({
      managedRoot: fixture.managedRoot,
      repositoryRoot: fixture.repositoryRoot,
    });
    try {
      await expect(stat(hookMarker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await opened.close();
    }
  });
});
