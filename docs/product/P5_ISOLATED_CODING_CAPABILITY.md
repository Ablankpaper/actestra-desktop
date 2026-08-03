# P5.2 Isolated Coding Capability

## Status

The P5.2 containment foundation was developed on branch
`feat/p5-isolated-coding-capability` from exact `main` baseline
`071aa922c08dd9a139f0c11dee2aa0dadab02417` and delivered through pull request
31. The desktop-main composition slice is developed on branch
`feat/p5-coding-main-composition` from its exact merge baseline
`266e3857bed7d4c32b773f92deff676bf2144b15`. This document records the closed
worktree, Tool Gateway, and main-owned lifecycle composition. It is not P5.2
phase acceptance.

## Scope

This slice creates one task-private detached Git worktree and admits six exact
main-owned capabilities:

- bounded UTF-8 file read;
- bounded UTF-8 file write;
- a main-registered terminal command;
- fixed Git status or HEAD inspection;
- fixed working-tree diff inspection; and
- a main-registered test command.

The desktop-main service creates the worktree, persists the exact active grant
before exposing the Tool Gateway, composes the managed platform, tracks
in-flight openings and sessions, retains failed cleanup for retry, and closes
all coding authority before the persistence utility. It repairs a pre-existing
managed root to POSIX `0700`, attempts every pending cleanup and active session
before aggregating shutdown failures, and preserves the service plus persistence
authority when coding cleanup must retry. Production invocations use
main-generated random identifiers; deterministic identifier sources remain an
explicit test-only option.

Downstream patch 0012 composes that service only in the native AionUi Electron
main persistence owner under the Actestra private profile's
`coding-worktrees` directory. It provides a main-process getter but adds no
preload or renderer exposure. The manifest copies the four reviewed coding main
sources and adds one native lifecycle test. It adds no renderer route, bridge,
or visual surface. The frozen AionUi source and R0 retention invariants remain
unchanged, and P5.3 remains the first user-visible coding journey.

## Authority and policy

The Worker supplies only a versioned tool input and, for terminal or test, one
registry identifier. Electron main owns the executable, arguments, worktree,
manifest, policy, approval, credential prohibition, timeout, execution, audit,
and output reference.

| Capability | Default policy | Native authority |
| --- | --- | --- |
| File read | allow and audit | one regular UTF-8 file below the active worktree grant |
| File write | one-shot approval | atomic replacement below the active worktree grant |
| Terminal | one-shot approval | one snapshotted main-process registry entry |
| Git | allow and audit | fixed `status` or `rev-parse HEAD` query |
| Diff | allow and audit | fixed no-ext-diff and no-textconv query |
| Test | one-shot approval | one snapshotted main-process registry entry |

All inputs and outputs use durable content references with the exact workspace,
task, session, Worker, request, and grant owner. No coding tool accepts a raw
shell command, arbitrary Git arguments, a credential reference, a `.git`
administration path, a path outside the worktree, or an inherited object
property masquerading as a declared tool identifier.

## Worktree and process isolation

Actestra verifies a canonical repository root and creates a detached worktree
under a disjoint Actestra-managed root. Repository-local clean, smudge, and
process filters are rejected before checkout. Local include directives are
also rejected because they could hide the same executable configuration.
Hooks and fsmonitor are overridden for every managed Git command, global and
system configuration are disabled, and read-only Git uses
`GIT_OPTIONAL_LOCKS=0`. Actestra holds the repository `config.lock` and the
source-worktree `config.worktree.lock` from local-configuration inspection
through checkout, and an existing lock fails before an attempt root is
created.

Creation captures the canonical worktree root, Git directory, and common Git
directory. Every invocation revalidates that exact binding before consuming
its one-shot input reference. A changed `.git` pointer therefore fails as
`worktree-scope-denied` without consuming input or exposing another repository.
If validation fails after `git worktree add`, cleanup removes the Git worktree
metadata before deleting the attempt root; a failed Git cleanup preserves the
remaining attempt for an explicit retry instead of creating a hidden prunable
registration.

Registered terminal and test processes receive a rebuilt environment and run
under the admitted macOS sandbox with network denied, host user-data reads
denied, and writes limited to the attempt-private root except for the worktree
root and its `.git` pointer. Combined output is limited to 64 KiB. Success,
failure, cancellation, timeout, and output overflow terminate the complete
detached process group; cleanup waits through forced termination so a child
that ignores `SIGTERM` cannot outlive grant revocation or worktree removal.

The lifecycle wrapper stops new invocations, cancels and awaits active tools,
uses the same persistence authority as the executor, persists the active grant
as revoked, reuses that exact record when a committed persistence response is
lost, requires an exact revoked-grant receipt, and only then removes the Git
worktree. It waits for authoritative output persistence even when the manifest
deadline expires, then reports timeout instead of success while retaining
`mayHaveExecuted` when a write or process side effect already completed.
Worktree close preserves bytes when Git metadata removal fails and may retry its
unfinished stage. The close operation is idempotent and does not expose the
underlying executor as an alternate Worker path.

## Local evidence

The focused P5.2 set passes 5 files and 49 tests:

- 3 core contract tests;
- 9 worktree creation, binding, configuration-lock, rejection, hook, filter,
  and retryable-cleanup tests; and
- 27 Gateway, approval, file, Git-binding, diff, process, registry, sandbox,
  persistence-timeout, cancellation, process-group, and lifecycle tests;
- 8 desktop-main private-root, grant-ordering, response-loss, failed-open
  cleanup, close-race, all-settled session, and cleanup-retry tests; and
- 2 native-manifest composition and shutdown-order tests.

The complete root gate components pass formatting over 197 files, zero-warning
lint over 189 files, strict TypeScript, the Electron SQLite probe, 65 passing
and 1 skipped test files with 498 passing and 1 skipped tests, the smoke
harness, the 85-source product boundary, the exact 1,766-file frozen AionUi
foundation, the 184-file downstream contract, and the
58-main/3-preload/28-renderer-module production build. The downstream contract
contains 4 R0 invariants and 63 reviewed source copies. A clean materialization
installs 3,177 packages, passes strict TypeScript, and passes the generated
native composition test 1 file/1 test. Git delivery and CI evidence remain
separate from these local gates and do not by themselves accept P5.2.

## Remaining P5.2 work and non-claims

The closed capability foundation is composed into desktop main, but nothing
calls `open` from an ACP attempt yet. It does not send ACP `session/new`, expose
an authenticated Actestra MCP transport, admit the exact loopback model path,
normalize ACP evidence, or provide the publish and Artifact flow required by
ADR-0024. It therefore does not yet prove a real Goose coding session. It also
adds no renderer projection, AionUi journey, candidate, release, deployment,
P5.3 work, CrewAI sidecar, Eigent runtime, or P6 behavior.

P5.2 can be accepted only after the remaining ACP, MCP, model, evidence,
publish, and Artifact boundaries are implemented or the accepted architecture
is explicitly revised, followed by the complete local, review, exact-head CI,
and merged-main gates.

## Rollback

Rollback of the composition removes downstream patch 0012, the main service,
its four source-copy declarations, and its focused tests while leaving the
delivered containment foundation inert and available. Rolling back the full
foundation additionally removes the isolated coding contract, worktree,
Gateway platform, executor, core export, and focused tests together. No schema,
frozen upstream source, native AionUi profile, release artifact, or migration
needs reversal.
