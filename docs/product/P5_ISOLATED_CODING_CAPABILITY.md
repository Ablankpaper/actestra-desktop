# P5.2 Isolated Coding Capability

## Status

The P5.2 containment foundation was developed on branch
`feat/p5-isolated-coding-capability` from exact `main` baseline
`071aa922c08dd9a139f0c11dee2aa0dadab02417` and delivered through pull request
31. The desktop-main composition slice reached exact final head
`5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`, passed exact-head CI
30817462671, squash merged as
`f55b5550c6ac189f09536061a70e8c8c7299c4f4`, and passed exact merged-main CI
30818949121. The ACP `session/new` lifecycle slice starts from that merge on
branch `feat/p5-goose-acp-session`. This document records the closed worktree,
Tool Gateway, main-owned lifecycle composition, and fixture-backed ACP session
contract. It is not P5.2 phase acceptance.

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

The admitted Goose connection sends exactly one `session/new` request per
process. It declares an absolute coding workspace and one Actestra capability
proxy at exact `http://127.0.0.1:<port>/mcp`, carrying one bounded opaque Bearer
attempt lease. The connection matches the fixed JSON-RPC request ID instead of
assuming the first stdout line is the response because Goose
v1.45.0 sends `session/update` setup notifications first. It admits at most one
`usage_update` and one `available_commands_update`, requires their session ID
to match the response, bounds every frame to 64 KiB, and returns only the ACP
session ID plus admitted notification kinds. Known modes, configuration
options, command details, and metadata are discarded as compatibility input.
Unknown envelopes, result fields, update kinds or fields, malformed
correlation, JSON-RPC rejection, timeout, transport failure, process exit, and
a second session request fail closed. Session failure closes the transport and
removes the runner's attempt-private root without touching the repository.

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

The combined focused P5.2 set passes 7 files and 85 tests:

- 3 core contract tests;
- 9 worktree creation, binding, configuration-lock, rejection, hook, filter,
  and retryable-cleanup tests;
- 27 Gateway, approval, file, Git-binding, diff, process, registry, sandbox,
  persistence-timeout, cancellation, process-group, and lifecycle tests;
- 8 desktop-main private-root, grant-ordering, response-loss, failed-open
  cleanup, close-race, all-settled session, and cleanup-retry tests;
- 2 native-manifest composition and shutdown-order tests;
- 27 ACP initialize/session declaration, correlation, allowlist, bound,
  timeout, transport, process-exit, and one-session tests; and
- 9 runner artifact/private-root/session cleanup tests.

The complete root gate components pass formatting over 197 files, zero-warning
lint over 189 files, strict TypeScript, the Electron SQLite probe, 65 passing
and 1 skipped test files with 523 passing and 1 skipped tests, the smoke
harness, the 85-source product boundary, the exact 1,766-file frozen AionUi
foundation, the 184-file downstream contract, and the
58-main/3-preload/28-renderer-module production build. The downstream contract
contains 4 R0 invariants and 63 reviewed source copies. A clean materialization
installs 3,177 packages, passes strict TypeScript, and passes the generated
native composition test 1 file/1 test. Git delivery and CI evidence remain
separate from these local gates and do not by themselves accept P5.2.

## Remaining P5.2 work and non-claims

The closed capability foundation is composed into desktop main, and the Goose
adapter has a fixture-backed `session/new` declaration and cleanup contract.
The desktop-main coding service does not call that adapter yet, and no live
authenticated Actestra MCP server receives the declaration. The exact loopback
model path, prompt and tool execution, normalized durable ACP evidence, and the
publish and Artifact flow required by ADR-0024 remain absent. It therefore does
not yet prove a real Goose coding session. It also adds no renderer projection,
AionUi journey, candidate, release, deployment, P5.3 work, CrewAI sidecar,
Eigent runtime, or P6 behavior.

P5.2 can be accepted only after the remaining ACP, MCP, model, evidence,
publish, and Artifact boundaries are implemented or the accepted architecture
is explicitly revised, followed by the complete local, review, exact-head CI,
and merged-main gates.

## Rollback

Rollback of the ACP slice removes the bounded session method, its runner
lifecycle wrapper, and focused fixtures while leaving the accepted initialize
handshake and desktop-main containment composition intact. Rollback of the
composition removes downstream patch 0012, the main service,
its four source-copy declarations, and its focused tests while leaving the
delivered containment foundation inert and available. Rolling back the full
foundation additionally removes the isolated coding contract, worktree,
Gateway platform, executor, core export, and focused tests together. No schema,
frozen upstream source, native AionUi profile, release artifact, or migration
needs reversal.
