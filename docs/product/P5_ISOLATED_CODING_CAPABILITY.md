# P5.2 Isolated Coding Capability

## Status

The P5.2 containment slice was developed on branch
`feat/p5-isolated-coding-capability` from exact `main` baseline
`071aa922c08dd9a139f0c11dee2aa0dadab02417`. This document records the
implemented closed worktree and Tool Gateway foundation. It is not P5.2 phase
acceptance.

## Scope

This slice creates one task-private detached Git worktree and admits six exact
main-owned capabilities:

- bounded UTF-8 file read;
- bounded UTF-8 file write;
- a main-registered terminal command;
- fixed Git status or HEAD inspection;
- fixed working-tree diff inspection; and
- a main-registered test command.

It adds no renderer route, bridge, or visual surface. The frozen AionUi source
and R0/R1/R2 retention inventory are unchanged. The downstream manifest adds
one byte-identical Actestra-owned copy of the core contract so the copied core
barrel remains complete; no downstream patch imports or invokes the coding
platform. P5.3 remains the first user-visible coding journey.

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

The focused P5.2 set passes 3 files and 39 tests:

- 3 core contract tests;
- 9 worktree creation, binding, configuration-lock, rejection, hook, filter,
  and retryable-cleanup tests; and
- 27 Gateway, approval, file, Git-binding, diff, process, registry, sandbox,
  persistence-timeout, cancellation, process-group, and lifecycle tests.

Complete root `bun run check` passes formatting, zero-warning lint, strict
types, the Electron SQLite probe, 63 passing and 1 skipped test files with 488
passing and 1 skipped tests, the smoke harness, the 84-source product boundary,
the 1,766-file frozen AionUi foundation, the 179-file downstream contract, and
the 58-main/3-preload/28-renderer-module production build. Git delivery and CI
evidence remain separate from these local gates and do not by themselves accept
P5.2.

## Remaining P5.2 work and non-claims

This library-level foundation is not yet composed into desktop main. It does
not send ACP `session/new`, expose an authenticated Actestra MCP transport,
admit the exact loopback model path, normalize ACP evidence, or provide the
publish and Artifact flow required by ADR-0024. It therefore does not yet prove
a real Goose coding session. It also adds no renderer projection, AionUi
journey, candidate, release, deployment, P5.3 work, CrewAI sidecar, Eigent
runtime, or P6 behavior.

P5.2 can be accepted only after the remaining desktop composition, ACP, MCP,
model, evidence, publish, and Artifact boundaries are implemented or the
accepted architecture is explicitly revised, followed by the complete local,
review, exact-head CI, and merged-main gates.

## Rollback

Rollback removes the isolated coding contract, worktree, Gateway platform,
executor, focused tests, core export, and downstream source-copy declaration
together. No schema, frozen upstream source, user profile, release artifact, or
migration needs reversal.
