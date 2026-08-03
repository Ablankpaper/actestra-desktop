# P5.2 Containment Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the process, filesystem, Git-binding, timeout, and cleanup gaps in the local P5.2 isolated coding foundation before any real Goose session receives those capabilities.

**Architecture:** Keep all authority in Electron main. Registered processes remain ID-selected and run in the attempt-private worktree, but every terminal path must now deny host user-data reads, deny worktree Git-pointer writes, terminate surviving descendants on every leader exit, and report timeout after persistence completes. The managed platform and every tool invocation bind to the exact worktree Git directory/common directory returned by the creator, while worktree cleanup becomes retryable without deleting bytes before Git metadata is detached.

**Tech Stack:** TypeScript, Node.js child processes and filesystem APIs, macOS `sandbox-exec`, Git linked worktrees, Vitest, Actestra Tool Gateway and persistence contracts.

---

## File map

- Modify `apps/desktop/src/main/workers/isolatedCodingWorktree.ts`: lock local Git configuration across inspection and checkout, return exact Git binding, and make cleanup retryable.
- Modify `apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts`: verify exact Git binding, narrow the macOS read/write profile, clean descendant process groups after every exit, and re-check cancellation after output persistence.
- Modify `apps/desktop/src/main/privileged/isolatedCodingToolPlatform.ts`: carry exact repository/worktree/Git-binding identity and reject mixed platform/worktree composition.
- Modify `tests/main/isolatedCodingWorktree.test.ts`: prove binding capture, configuration-lock denial, and retryable locked-worktree cleanup.
- Modify `tests/main/isolatedCodingTools.test.ts`: prove host-read and `.git` denial, binding-tamper rejection, success/failure descendant cleanup, platform composition rejection, and timeout-after-persistence behavior.
- Modify `docs/product/P5_ISOLATED_CODING_CAPABILITY.md`, `docs/PROJECT_STATUS.md`, `docs/architecture/SYSTEM_OVERVIEW.md`, and `docs/roadmap/DEVELOPMENT_SEQUENCE.md`: record only fresh final-byte evidence and keep ACP/model/real-Goose work explicitly open.

### Task 1: Terminate descendants after successful and failed process leaders

**Files:**

- Modify: `tests/main/isolatedCodingTools.test.ts`
- Modify: `apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts`

- [x] **Step 1: Add a failing regression test for both exit codes**

Add a fixture whose leader spawns a same-process-group child that ignores `SIGTERM`, writes its PID, and exits with the selected code. Invoke one registered command that exits `0` and one that exits `7`; after the gateway settles, assert both recorded child PIDs return `ESRCH` from `process.kill(pid, 0)`. Keep a `finally` fallback that sends `SIGKILL` only if the assertion exposes the old leak.

```ts
const leader = [
  "import { spawn } from 'node:child_process';",
  "import { writeFileSync } from 'node:fs';",
  "const [pidFile, exitCode] = process.argv.slice(2);",
  "const child = spawn(process.execPath, ['descendant.mjs'], { stdio: 'ignore' });",
  "child.unref();",
  "writeFileSync(pidFile, String(child.pid));",
  "process.exit(Number(exitCode));",
].join("\n");
```

- [x] **Step 2: Run only the new test and confirm RED**

Run:

```bash
bunx vitest run tests/main/isolatedCodingTools.test.ts -t "removes descendants after registered process leaders exit"
```

Expected: FAIL because at least one descendant remains alive after the current direct `close` path settles.

- [x] **Step 3: Make process-group signalling observable and mandatory on close**

Change `signalProcessGroup` to return `false` only for `ESRCH` and `true` after a delivered signal. In the child `close` listener, set `directCloseCode`, call `terminate()`, and settle only after either no process-group member exists or the existing grace timer has delivered `SIGKILL`.

```ts
function signalProcessGroup(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): boolean {
  if (child.pid === undefined) return false;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
```

If the first `SIGTERM` reports no group, set cleanup complete immediately. Preserve the original process exit code so a successful leader still returns its bounded output and a failed leader still returns `process-exit-failed` after cleanup.

- [x] **Step 4: Run the focused process tests and confirm GREEN**

Run:

```bash
bunx vitest run tests/main/isolatedCodingTools.test.ts -t "registered process|process group|descendants"
```

Expected: all selected tests pass and every recorded PID is gone.

### Task 2: Deny host user-data reads and worktree Git-pointer writes

**Files:**

- Modify: `tests/main/isolatedCodingTools.test.ts`
- Modify: `apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts`

- [x] **Step 1: Add failing sandbox tests**

Create a sentinel beside, not inside, the attempt-private root. A registered Node fixture must still read its worktree script, but reading that sentinel must return `EPERM` or `EACCES`. A second fixture attempts `appendFileSync('.git', '\n# denied')`; it must report denial. Save and restore the original `.git` pointer in test cleanup so RED cannot poison worktree cleanup.

- [x] **Step 2: Run the two tests and confirm RED**

Run:

```bash
bunx vitest run tests/main/isolatedCodingTools.test.ts -t "denies host user-data reads|denies worktree Git pointer writes"
```

Expected: FAIL because the current `(allow default)` profile permits both reads under the fixture parent and writes anywhere under the private root.

- [x] **Step 3: Build a path-specific macOS profile**

Retain default system operations, deny network, deny reads from user and mutable host-data roots, then re-allow only the exact attempt-private root and exact admitted executable. Keep the global write denial, re-allow the attempt-private root, and finally deny the exact worktree root and `.git` pointer as write targets.

```ts
const deniedReadRoots = ["/Users", "/Volumes", "/private/tmp", "/private/var/folders", "/Library"];
const profile = [
  "(version 1)",
  "(allow default)",
  "(deny network*)",
  `(deny file-read* ${deniedReadRoots
    .map((root) => `(subpath "${sandboxLiteral(root)}")`)
    .join(" ")})`,
  `(allow file-read-metadata ${sandboxTraversalPaths(privateRoot, stableDefinition.executablePath)
    .map((entry) => `(literal "${sandboxLiteral(entry)}")`)
    .join(" ")})`,
  `(allow file-read* (subpath "${sandboxLiteral(privateRoot)}") (literal "${sandboxLiteral(stableDefinition.executablePath)}"))`,
  "(deny file-write*)",
  `(allow file-write* (subpath "${sandboxLiteral(privateRoot)}") (literal "/dev/null"))`,
  `(deny file-write* (literal "${sandboxLiteral(root)}") (literal "${sandboxLiteral(path.join(root, ".git"))}"))`,
].join(" ");
```

- [x] **Step 4: Run the sandbox tests and existing process success test**

Run:

```bash
bunx vitest run tests/main/isolatedCodingTools.test.ts -t "closed environment|denies host user-data reads|denies worktree Git pointer writes"
```

Expected: all selected tests pass; worktree reads and registered execution still work, while the sibling sentinel and `.git` pointer remain unchanged.

### Task 3: Bind every platform and invocation to the creator's exact Git directories

**Files:**

- Modify: `apps/desktop/src/main/workers/isolatedCodingWorktree.ts`
- Modify: `apps/desktop/src/main/privileged/isolatedCodingToolPlatform.ts`
- Modify: `apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts`
- Modify: `tests/main/isolatedCodingWorktree.test.ts`
- Modify: `tests/main/isolatedCodingTools.test.ts`

- [x] **Step 1: Add failing binding and mixed-composition tests**

Require a created worktree to expose canonical `gitDirectory` and `gitCommonDirectory`. In the tool test, replace the linked worktree `.git` pointer with another fixture repository, invoke file read, and expect `worktree-scope-denied`; restore the original pointer in `finally`. Separately pass a platform created for repository A into a managed worktree facade naming repository B and expect synchronous `invalid-config`.

- [x] **Step 2: Run the binding tests and confirm RED**

Run:

```bash
bunx vitest run tests/main/isolatedCodingWorktree.test.ts tests/main/isolatedCodingTools.test.ts -t "Git binding|mixed platform"
```

Expected: FAIL because the current worktree result does not carry Git-directory identity, file tools do not revalidate `.git`, and lifecycle composition compares only the grant root.

- [x] **Step 3: Capture and validate the exact binding**

After `git worktree add`, resolve and canonicalize:

```bash
git -C <worktree> rev-parse --absolute-git-dir
git -C <worktree> rev-parse --path-format=absolute --git-common-dir
```

Add both paths to `IsolatedCodingWorktree`, `IsolatedCodingToolPlatformConfig`, `IsolatedCodingToolPlatform`, and `IsolatedCodingToolExecutorConfig`. Before consuming any input reference, run the same closed Git queries and require exact equality with the captured directories and exact `--show-toplevel` equality with `worktreeRoot`.

- [x] **Step 4: Reject mixed lifecycle composition**

Expose immutable `repositoryRoot`, `worktreeRoot`, `gitDirectory`, and `gitCommonDirectory` from the platform. Extend `manageIsolatedCodingToolPlatform` so every value exactly equals the passed worktree before it creates `LifecycleToolGateway`.

- [x] **Step 5: Run all binding tests and confirm GREEN**

Run:

```bash
bunx vitest run tests/main/isolatedCodingWorktree.test.ts tests/main/isolatedCodingTools.test.ts -t "Git binding|mixed platform|modifies only"
```

Expected: selected tests pass; tampering fails before input consumption and correct worktrees remain usable.

### Task 4: Preserve timeout semantics through output persistence

**Files:**

- Modify: `tests/main/isolatedCodingTools.test.ts`
- Modify: `apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts`

- [x] **Step 1: Add a failing delayed-persistence test**

Wrap `storeContentReference` so only `kind === 'tool-output'` waits on a deferred promise. Start a file-read invocation, wait until output persistence starts, advance fake timers beyond the 5-second manifest timeout, release persistence, and expect `tool-execution-failed` with cause `tool-timeout` rather than a successful output reference. Restore real timers in `afterEach`.

- [x] **Step 2: Run the new test and confirm RED**

Run:

```bash
bunx vitest run tests/main/isolatedCodingTools.test.ts -t "does not report success after output persistence crosses the timeout"
```

Expected: FAIL because `storeOutput` currently returns an output reference without checking the aborted signal.

- [x] **Step 3: Check cancellation on both sides of the durable write**

Pass the execution signal into `storeOutput`, call `throwIfCancelled(signal)` before the persistence request and again after it resolves, and only then return the reference. Do not race away from the persistence promise: the lifecycle must not release the grant while an authoritative write is still unresolved.

- [x] **Step 4: Run the delayed-persistence and lifecycle tests**

Run:

```bash
bunx vitest run tests/main/isolatedCodingTools.test.ts -t "output persistence|lifecycle"
```

Expected: selected tests pass; close waits for the durable call and the invocation reports timeout after it settles.

### Task 5: Lock checkout configuration and make worktree cleanup retryable

**Files:**

- Modify: `tests/main/isolatedCodingWorktree.test.ts`
- Modify: `apps/desktop/src/main/workers/isolatedCodingWorktree.ts`

- [x] **Step 1: Add failing cleanup and lock tests**

Lock a created linked worktree with `git worktree lock`, call `close()`, and assert rejection leaves the worktree directory intact. Unlock it, call the same `close()` again, and assert both the directory and its `git worktree list --porcelain` entry are gone. Also pre-create the repository's `config.lock` and assert creation fails closed without creating an attempt root.

- [x] **Step 2: Run the two tests and confirm RED**

Run:

```bash
bunx vitest run tests/main/isolatedCodingWorktree.test.ts -t "retries cleanup|configuration lock"
```

Expected: the retry test fails because the current rejected promise is cached and the attempt root is deleted even when Git metadata removal fails.

- [x] **Step 3: Hold local configuration locks across inspection and checkout**

Resolve the common Git directory, atomically create and hold `config.lock` plus the main-worktree `config.worktree.lock`, inspect local configuration, perform `worktree add`, then close and unlink both locks in `finally`. If either lock already exists, return `repository-config-denied` before checkout. Global/system Git configuration remains disabled by environment.

- [x] **Step 4: Split cleanup into retryable stages**

Track `gitMetadataRemoved` and `attemptRootRemoved` separately. Never remove the attempt root after a failed `git worktree remove`. Reset `closePromise` on rejection so a later call can retry only the unfinished stage; once both stages finish, later calls resolve idempotently.

- [x] **Step 5: Run the full worktree suite and confirm GREEN**

Run:

```bash
bunx vitest run tests/main/isolatedCodingWorktree.test.ts
```

Expected: all worktree tests pass and no fixture leaves linked-worktree metadata behind.

### Task 6: Synchronize evidence and run the containment gate

**Files:**

- Modify: `docs/product/P5_ISOLATED_CODING_CAPABILITY.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`

- [x] **Step 1: Run the complete focused P5.2 set**

Run:

```bash
bunx vitest run tests/core/isolatedCodingTools.test.ts tests/main/isolatedCodingTools.test.ts tests/main/isolatedCodingWorktree.test.ts
```

Expected: all files and tests pass with the final count copied exactly into documentation.

- [x] **Step 2: Run formatting, lint, and strict TypeScript before editing evidence counts**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
```

Expected: every command exits `0` without warnings introduced by this slice.

- [x] **Step 3: Update source-of-truth documents**

Change the stale focused count from 21 to the fresh count, replace the stale root count only after a fresh full gate, correct the old P5.1/P5.2 contradictory paragraphs, and record containment as local evidence rather than P5.2 acceptance. Keep `session/new`, authenticated MCP, loopback model proxy, real Goose coding, normalized ACP evidence, review, commit, push, CI, P5.3, P6, candidate, release, deployment, and acceptance explicitly unclaimed.

- [x] **Step 4: Run the complete local gate**

Run:

```bash
bun run check
```

Expected: formatting, zero-warning lint, strict types, Electron SQLite probe, test suites, smoke, product-boundary checks, frozen AionUi checks, downstream compatibility, and production build all exit `0`; copy the exact file/test totals into the status documents.

- [x] **Step 5: Review the final diff and stop at the commit boundary**

Run:

```bash
git status -sb
git diff --check
git diff --stat
git diff -- apps/desktop/src/main/workers/isolatedCodingWorktree.ts apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts apps/desktop/src/main/privileged/isolatedCodingToolPlatform.ts tests/main/isolatedCodingWorktree.test.ts tests/main/isolatedCodingTools.test.ts docs/product/P5_ISOLATED_CODING_CAPABILITY.md docs/PROJECT_STATUS.md docs/architecture/SYSTEM_OVERVIEW.md docs/roadmap/DEVELOPMENT_SEQUENCE.md
```

Expected: only intended P5.2 files plus the pre-existing P5.2 foundation and this plan are present. Do not stage, commit, push, or open a pull request until the owner accepts this intermediate boundary.

Owner continuation on 2026-08-03 explicitly authorized the scoped Git, pull-request, review, CI, merge, and merged-main closure after the unchanged local gates. The initial pull-request CI exposed one missing byte-identical core-contract source copy in `downstream/aionui-v2.1.41/overlay.json`; adding that exact materialization declaration remains part of this containment slice. That delivery does not expand this slice into ACP composition, P5.3, P6, release, or P5.2 phase acceptance.
