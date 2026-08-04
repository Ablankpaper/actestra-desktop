# P5.2 Isolated Coding Capability

## Status

The P5.2 containment foundation was developed on branch
`feat/p5-isolated-coding-capability` from exact `main` baseline
`071aa922c08dd9a139f0c11dee2aa0dadab02417` and delivered through pull request
31. The desktop-main composition slice reached exact final head
`5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`, passed exact-head CI
30817462671, squash merged as
`f55b5550c6ac189f09536061a70e8c8c7299c4f4`, and passed exact merged-main CI
30818949121. The ACP `session/new` lifecycle slice starts from that merge and is
delivered on `main` through pull request 33 and squash merge
`c5f498e926adac484694dab6d2f05b9822cc0b12`; exact remote evidence is recorded
below. Pull request 34 records that closure in the source-of-truth documents and
squash merged as `776d1e1c10d13f036a3318f7d3c193a7819443a2`. The authenticated
MCP transport is delivered through pull request 35 and squash merge
`8a31bafc1cd322744189fc4ed1e68f769225c999`. The authenticated readiness
composition is delivered through pull request 36 at exact head
`5fe78bfaf2982556af975d23bc904d10b77a1f29`, squash merge
`08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`, and exact merged-main CI
30845006202. The authenticated MCP tool-call slice is delivered through pull
request 37 at exact head `84b0550495717343b75ca2540cb7c191ab65b12a`,
squash merge `d933546454e63a2d836e728f1b93980cb4a7c0ac`, and exact
merged-main CI 30853499159. The authenticated inference and prompt loop starts
from that exact merge on branch `codex/p5-goose-inference-prompt-loop` and is
delivered through pull request 38 at exact head
`cc773081ba448266951a3b2ac3654831022118fc`, squash merge
`a6280dd38eacdbada9db159c4784110ec8e42770`, and exact-head CI 30859115162.
The single automatic merged-main CI 30860137257 failed only when the first
real-Git desktop-main integration test exceeded Vitest's implicit five-second
unit-test deadline; the macOS foundation job and the other 123 Goose tests
passed. Pull request 39 corrected only that test deadline at exact head
`38cbbaaedbb8e5955b96a6d7148841180e751e35`, passed exact-head CI
30861770178, squash merged as
`7e8732e264febff42fb3d451011b3b8e48caaff5`, and passed exact merged-main CI
30862710547. The desktop-main Goose lifecycle starts from that merge on branch
`codex/p5-goose-desktop-main-lifecycle` and is locally implemented. This
document records the closed worktree, Tool Gateway, service-owned Goose session,
bounded ACP session, authenticated MCP transport, bounded tool-call bridge, and
real Goose prompt/tool round trip. It is not P5.2 phase acceptance or current-
slice remote delivery evidence.

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
preload or renderer exposure. The manifest copies the four containment sources,
seven Goose session sources, and exact runner source pin and adds one native
lifecycle test. It adds no renderer route, bridge, or visual surface. The frozen
AionUi source and R0 retention invariants remain
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

The local MCP server listens only on a random `127.0.0.1` port and accepts only
the exact `/mcp` path over `POST`. Every request requires the attempt-private
Bearer lease plus the pinned Goose `v1.45.0` User-Agent, exact Host, bounded
non-chunked JSON content, the expected Accept header, no Origin or MCP session
header, and the correct MCP 2025-03-26 header for the current phase. The server
admits only the ordered initialize notification and tool-list sequence before
any tool invocation. It returns no stateful MCP session identifier and exposes
only the same six closed coding schemas. Command and test identifiers are
copied into closed enums before the listener starts. The pinned Goose numeric
`progressToken` is allowed beside bounded ACP correlation metadata; other
metadata is denied. After the accepted list, `tools/call` requires the exact
active ACP session, isolated worktree, bounded Worker tool-call correlation
identifier, closed tool identifier, and versioned input contract. It admits at
most 128 unique calls, rejects replay before main authority, bounds and
sanitizes the result, stops accepting new calls when cleanup begins, aborts and
awaits in-flight invocations, and only then completes listener shutdown. All other
methods return method-not-found. Body and header bounds, immediate
rejected-connection closure, idempotent shutdown, and destruction of partial
sockets prevent the listener from becoming a second unbounded process or
network authority.

The session-composition helper creates separate fresh 256-bit base64url leases
for MCP and model traffic inside Electron main and never accepts either from the
Worker. Before the admitted Goose handshake, it starts the MCP listener and an
Actestra-owned model proxy on separate random `127.0.0.1` ports. The model proxy
accepts the authenticated `GET /v1/models` catalog for the caller-selected model
ID. Its `POST /v1/chat/completions` route remains unavailable until Actestra
binds the exact ACP session, then requires the same opaque lease, exact Host,
absence of Origin and transfer encoding, one matching `agent-session-id`, a
bounded non-chunked JSON body, the caller-selected model, streaming mode, and a
bounded messages array. The route delegates only to a caller-supplied
main-process model invoker and emits a closed OpenAI-compatible SSE union:
bounded assistant text or one bounded MCP tool call plus token usage. The
model-related additions to the closed Worker environment are the pinned OpenAI
provider, caller model, exact proxy base URL, opaque local API lease, loopback
`NO_PROXY`, and `GOOSE_DISABLE_SESSION_NAMING=true`. The last setting prevents
Goose from making a private background model call to name the session; Actestra
Core retains session naming authority. The macOS sandbox continues to deny all
other network access and admits outbound traffic only to the exact MCP and model
ports.

After `session/new`, Actestra sends pinned Goose's explicit
`_goose/unstable/tools/list` ACP request for the admitted MCP extension. The
helper returns only after the server accepts its authenticated `tools/list`,
Goose acknowledges discovery, and the response matches exactly the six
Actestra coding tool identifiers. A valid list necessarily follows authenticated
initialize and initialized requests. Opening failure and normal close release
the Worker before MCP and the model proxy. Close is idempotent, attempts every
cleanup even after an earlier failure, and preserves all cleanup errors in
order. After discovery, the helper admits one bounded text `session/prompt`
request with fixed correlation. It accepts only updates for the exact session,
bounds the turn to 512 updates, normalizes admitted session-info, tool-call,
tool-call-update, assistant-text, and usage shapes, and rejects expanded or
uncorrelated messages. Timeout, rejection, transport failure, or process exit
closes the Worker and its private root. The returned object exposes only
normalized Goose info, private-root path, session identity, setup kinds,
canonical tool names, the single bounded prompt method, and close; it does not
expose either Bearer lease.

The caller supplies one main-owned tool invoker to that composition. The
current invoker binds the active desktop-main coding grant and Actestra Task,
Session, and Worker identities, generates fresh Tool Gateway request and input
reference identifiers, persists the exact versioned input owner, invokes the
existing policy/approval/audit/executor path, and resolves only the matching
durable output reference. Goose session and tool-call identifiers remain
correlation metadata and never become authority. An approval-required result
does not execute the protected operation and returns only a bounded generic MCP
error; approval continuation and denial projection remain later work.

The caller also supplies the model invoker. It receives only the bound Actestra
session identifier, selected model identifier, bounded Goose request, and an
abort signal, and may return only the closed message-or-tool-call completion
union. The loopback proxy owns streaming compatibility and never receives a raw
provider credential from Goose. In the admitted real-runner proof, the first
model result selects the authenticated Actestra file-read tool, Goose invokes it
once through MCP, and the second model request contains the bounded tool result
before returning the final assistant message and ACP usage.

The desktop-main service now owns that composition through one `openGoose`
operation. It first opens the existing isolated coding session, then creates the
main-owned tool invoker from that exact grant and Actestra Task, Session, and
Worker identifiers, and finally opens Goose against the worktree with only the
snapshotted command/test identifiers. The returned session retains both the
coding authority and bounded prompt surface. Normal and failed close always
attempt Goose before grant revocation and worktree removal, aggregate failures
in that order, and retry unfinished stages. Service shutdown waits for Goose
openings; an opening that loses the shutdown race closes its Worker and coding
authority before rejecting. A failed Goose opening plus failed worktree cleanup
retains both causes and the managed session for shutdown retry.

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

The corrected composition fingerprint passes formatting over 203 files,
zero-warning lint over 195 files, strict TypeScript, the Electron SQLite probe,
68 passing and 1 skipped test files with 582 passing and 1 skipped tests, the
smoke harness, the 88-source product boundary, the exact 1,766-file frozen AionUi
foundation, the 184-file downstream contract, and the
58-main/3-preload/28-renderer-module production build. The downstream contract
contains 4 R0 invariants and 63 reviewed source copies. A clean materialization
installs 3,177 packages, passes strict TypeScript, and passes the generated
native composition test 1 file/1 test. Git delivery and CI evidence remain
separate from these local gates and do not by themselves accept P5.2.

The authenticated transport/call test now has 49 passing tests. It covers
configuration snapshotting, lease and header authentication,
the exact pinned initialize and tool-list sequence, all six schemas, real Goose
session/progress/tool-call metadata, versioned input rejection, replay denial,
sanitized synchronous failure, cancellation, close-time admission denial, the
close-winning deferred-invocation race, size and method rejection, and socket
cleanup. Test workspaces derive from the operating-system temporary directory
instead of a fixed POSIX-only path. A
source comparison against pinned Goose `v1.45.0` first exposed the missing
`progressToken` compatibility case; the focused test failed before the minimal
server correction and then passed. The corrected Worker-readiness input passes
4 focused files and 51 tests for strict ACP discovery, separate model/MCP
leases, exact-port sandboxing, authenticated catalog denial, ordered all-settled
cleanup, failed-session cleanup, both readiness waits, and exact-six tool
matching. With the admitted artifact whose manifest SHA-256 is
`e7bf0a7b78c6a603748cd119db888ed3fc367e118aed8bc10c4ded05611ea97c`, the
real-runner integration passes 1 file and 1 test: real Goose completes
`session/new`, triggers the authenticated MCP `tools/list` through explicit ACP
discovery, returns the exact six tools, and leaves no private root.

The current tool-call fingerprint passes 3 affected files and 65 tests: 49 MCP
transport/call tests, 10 desktop-main containment and real Tool Gateway tests,
and 6 session-composition tests. The artifact-gated integration is unchanged
and was not rerun for this focused iteration because the admitted runner,
manifest, model-readiness path, and discovery bytes did not change. On the exact
final production/test/script fingerprint, the one permitted `bun run check`
passes formatting over 204 files, zero-warning lint over 196 files, strict
TypeScript, the Electron SQLite probe, 68 passing and 1 skipped test files with
589 passing and 1 skipped tests, deterministic smoke, the 89-source product
boundary, frozen/downstream contracts, and the
58-main/3-preload/28-renderer-module production build.

The current inference/prompt fingerprint passes 4 affected files and 55 tests
covering the closed Runner environment, authenticated and session-bound model
catalog/inference routes, bounded message and tool-call SSE, in-flight
abort-and-await, strict ACP prompt correlation and normalization, single-prompt
admission, and composition forwarding. The environment regression first failed because
`GOOSE_DISABLE_SESSION_NAMING` was absent, then passed with the exact upstream
documented value `true`. With admitted artifact manifest SHA-256
`3dc1bf1b58dee9639ff35453a6486f890bb68f38fbc9dbf3e63ef56bfcdbb4af`,
the real-runner test passes 1 file and 1 test on the current bytes: exactly two
model invocations, one authenticated MCP tool call, the second request carrying
`integration tool result`, normalized tool-call/completed/final-message updates,
ACP usage, and an empty private-root parent after close. No Runner process
remains. The single final-byte root gate passes formatting over 204 files,
zero-warning lint over 196 files, strict TypeScript, the Electron SQLite probe,
68 passing and 1 skipped test files with 593 passing and 1 skipped tests,
deterministic smoke, the 89-source boundary, the exact 1,766-file frozen AionUi
foundation, the 184-file downstream contract, and the
58-main/3-preload/28-renderer-module production build.

The current desktop-main lifecycle fingerprint passes 3 affected files and 22
tests for exact worktree/invoker composition, service-owned shutdown, Goose-
first close ordering, open/close race rejection, ordered failure aggregation,
and failed-opening cleanup retry. The ACP normalization file remains green at
31 tests after explicit type narrowing for AionUI's non-strict compiler mode.
Root strict TypeScript passes. The downstream contract passes 192 declared
files, 4 R0 invariants, and 71 reviewed source copies; a clean materialization
installs 3,177 packages, passes native TypeScript, and passes the generated
native composition test 1 file/1 test. The single final-byte root gate passes
formatting over 204 files, zero-warning lint over 196 files, strict TypeScript,
the Electron SQLite probe, 68 passing and 1 skipped test files with 597 passing
and 1 skipped tests, deterministic smoke, the 89-source product boundary, the
1,766-file frozen foundation, the 192-file downstream contract, and the
58-main/3-preload/28-renderer-module production build. Review, Git, PR,
exact-head CI, and merged-main CI remain pending.

One committed CodeRabbit review covered all 12 changed files and raised six
findings. The shutdown/deferred-invocation race and fixed `/tmp` fixture were
confirmed and remediated. The regression test's red phase proved the old path
could enter main authority after close won; the restored closure guard makes the
same test pass. Four suggestions were rejected after checking the production
contracts: the Gateway returns only `approval-required` or `executed`; invalid
tool identifiers already fail `parseCodingToolInput` through the closed tool
definition; the recorded `2026-08-04` date is correct for the CST environment;
and the 128-call limit is the documented containment decision rather than an
unbounded production quota.

## Git delivery evidence

Pull request 33 reached exact final head
`5d873f2feb94679341627aab0472a66630cf16cd`. Exact-head CI 30823601815
passed Goose runner admission and macOS arm64 foundation. CodeRabbit selected
all 9 changed files and returned only its Free-plan summary and walkthrough;
GitHub has no submitted review, inline review comment, or review thread. Its
successful status is therefore not represented as formal line-level review.
The branch squash merged as `c5f498e926adac484694dab6d2f05b9822cc0b12`.
Exact merged-main CI 30825221070 passed macOS arm64 foundation job 91725008830
and Goose runner admission job 91725008914, including the real ACP handshake
and cleanup step. This is remote delivery evidence for the bounded lifecycle,
not P5.2 phase acceptance.

Pull request 34 changed only this document and the other three P5
source-of-truth files. It reached exact head
`c17d5cd6df9de187ea93659e768da6207c6b4f34`, passed exact-head CI
30827073008, squash merged as `776d1e1c10d13f036a3318f7d3c193a7819443a2`,
and passed exact merged-main CI 30828549443, including macOS arm64 foundation
job 91736358985 and Goose runner admission job 91736358994. It changed no
product bytes.

Pull request 35 reached exact head
`93a8e9633f2be7b5f8c8b1eead3f2a21b0770073`; exact-head CI 30832907098
passed macOS arm64 foundation job 91750962007 and Goose runner admission job
91750962049. CodeRabbit supplied no line-level review because its quota was
exhausted; GitHub has no submitted review, inline comment, or review thread.
The branch squash merged as `8a31bafc1cd322744189fc4ed1e68f769225c999`.
Exact merged-main CI 30834217310 passed macOS arm64 foundation job 91755320708
and Goose runner admission job 91755320706.

Pull request 36 first reached exact head
`9e277e1593b2715ed3721e1febb886985a942824`. Its automatic exact-head CI
30837296114 passed macOS arm64 foundation job 91765490611, while Goose runner
admission job 91765490592 failed the real integration at `session/new` with
`session-rejected`. That exact SHA was not rerun. Diagnosis against the pinned
Goose source and isolated probes established that `session/new` resolves a
provider and model, the previous deny-all sandbox blocked both required
loopback connections, the host proxy path required explicit loopback
`NO_PROXY`, and `session/new` initializes MCP without itself issuing
`tools/list`. The corrected final head
`5fe78bfaf2982556af975d23bc904d10b77a1f29` passed exact-head CI 30843561874:
macOS arm64 foundation job 91786216829 and Goose runner admission job
91786216934. CodeRabbit selected all 15 changed files, skipped the unchanged
real-runner integration as similar to its prior review, and supplied only its
Free-plan summary and walkthrough; GitHub records no submitted review, inline
comment, or review thread. The branch squash merged as
`08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`. Exact merged-main CI 30845006202
passed macOS arm64 foundation job 91791030796 and Goose runner admission job
91791030814.

Pull request 37 reached exact head
`84b0550495717343b75ca2540cb7c191ab65b12a`. Exact-head CI 30851778390
passed macOS arm64 foundation job 91813249905 and Goose runner admission job
91813250047. CodeRabbit selected all 12 changed files but explicitly stopped at
its review limit; that successful status and Free summary are not line-level
review evidence. GitHub records no submitted review or inline review thread.
The branch squash merged as `d933546454e63a2d836e728f1b93980cb4a7c0ac`.
The single automatic merged-main CI 30853499159 passed macOS arm64 foundation
job 91818968991 and Goose runner admission job 91818969025.

Pull request 38 reached exact head
`cc773081ba448266951a3b2ac3654831022118fc`. Exact-head CI 30859115162
passed macOS arm64 foundation job 91836946596 and Goose runner admission job
91836946628. CodeRabbit did not start a review because its quota was exhausted;
GitHub records no submitted review or inline review thread. The branch squash
merged as `a6280dd38eacdbada9db159c4784110ec8e42770`. Its single automatic
merged-main CI 30860137257 passed macOS arm64 foundation job 91840096925 but
failed Goose runner admission job 91840096947 only when one real-Git test
crossed Vitest's implicit five-second deadline; that SHA was not rerun.

Pull request 39 delivered the bounded test deadline at exact head
`38cbbaaedbb8e5955b96a6d7148841180e751e35`. Exact-head CI 30861770178
passed macOS arm64 foundation job 91845074323 and Goose runner admission job
91845074258. CodeRabbit again did not start a review because its quota was
exhausted; GitHub records no submitted review or inline review thread. The
branch squash merged as `7e8732e264febff42fb3d451011b3b8e48caaff5`.
Exact merged-main CI 30862710547 passed macOS arm64 foundation job 91847939794
and Goose runner admission job 91847939858. This closes the timeout correction,
not P5.2 phase acceptance.

## Remaining P5.2 work and non-claims

The closed capability foundation is composed into desktop main, the Goose
adapter has a bounded `session/new` declaration and cleanup contract, the
authenticated MCP transport, tool-call bridge, and prompt loop are delivered.
The desktop-main coding service now calls that helper on the current local
branch and owns its complete worktree/Worker cleanup order. Approval continuation
and denial projection, durable normalized Task/Session evidence, publish, and
Artifact registration required by ADR-0024 have not been proved. The current
real-runner evidence and local desktop-main composition remain a contained
coding-session contract, not the retained-AionUI product journey. This slice
also adds no renderer projection, AionUi journey, candidate, release,
deployment, P5.3 work, CrewAI sidecar, Eigent runtime, or P6 behavior.

P5.2 can be accepted only after this lifecycle is remotely delivered and the
remaining approval outcomes, durable normalized evidence, publish, and Artifact
boundaries are implemented or the accepted architecture is explicitly revised,
followed by the complete local, review, exact-head CI, and merged-main gates.

## Rollback

Rollback of the current desktop-main lifecycle removes `openGoose`, its
service-owned opening/session tracking, the seven Goose TypeScript and runner-
pin source copies, the native `openGoose` assertion, and focused lifecycle tests
together. The delivered prompt helper and earlier desktop containment service
then remain separate at exact merge
`7e8732e264febff42fb3d451011b3b8e48caaff5`.

Rollback of the current inference/prompt slice removes the authenticated chat
completion route, bound model invoker, bounded ACP prompt/updates, private
session-naming disablement, and real two-round prompt/tool proof together. The
delivered pull-request-37 tool-call bridge then remains without an inference or
prompt route. Rollback of that tool-call slice removes the MCP `tools/call`
admission, main-owned invoker, session-composition injection, dedicated
Goose-job coverage, and focused tests together. The delivered authenticated
discovery composition then remains readiness-only and returns method-not-found
for `tools/call`.
Rollback of the current session-composition correction removes explicit ACP
tool discovery, the non-inference model catalog, the exact two-port sandbox and
closed provider/model environment, and their focused evidence; the composition
then returns to the known `session/new` rejection. Rolling back the complete
session-composition slice additionally removes its helper and focused test,
restores the real-runner integration to handshake-only, and removes the bounded
tools-list evidence waiter while leaving the delivered transport and ACP
session contract separate. Rollback of the transport slice removes its server
module and focused test; it does not alter the delivered ACP session contract or
desktop containment composition.
Rollback of the ACP slice removes the bounded session method, its runner
lifecycle wrapper, and focused fixtures while leaving the accepted initialize
handshake and desktop-main containment composition intact. Rollback of the
composition removes downstream patch 0012, the main service,
its remaining four containment source-copy declarations, and its focused tests
while leaving the delivered containment foundation inert and available. Rolling
back the full
foundation additionally removes the isolated coding contract, worktree,
Gateway platform, executor, core export, and focused tests together. No schema,
frozen upstream source, native AionUi profile, release artifact, or migration
needs reversal.
