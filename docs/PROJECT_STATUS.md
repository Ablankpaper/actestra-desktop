# Project Status

Last updated: 2026-08-04

## Current phase

### P6 team-plan admission is accepted; durable plan authority is the current slice

The containment foundation was developed from exact `origin/main`
`071aa922c08dd9a139f0c11dee2aa0dadab02417` on branch
`feat/p5-isolated-coding-capability`. It adds a detached Actestra-managed Git
worktree and six closed file, terminal, Git, diff, and test capabilities behind
the existing policy, one-shot approval, durable audit, credential, grant, and
content-reference boundaries. It adds no renderer or AionUi runtime or UI
change.

The focused local set passes 3 files and 39 tests. It proves source-checkout
preservation, canonical and disjoint roots, exact per-invocation Git binding,
configuration locks across inspection and checkout, hook and fsmonitor
overrides, repository filter denial, bounded UTF-8 file access, Git and diff
inspection, approval and replay denial, closed process environments, network
and host-user-data denial, `.git` pointer-write denial, registry snapshotting,
prototype-chain tool-identifier denial, output limits, side-effect-aware timeout
after durable output persistence, success/failure/cancellation descendant
process-group cleanup, post-create Git-metadata cleanup, exact persistence
authority and grant-revocation receipts, response-loss-safe revocation retry,
and retryable worktree removal. Zero-warning lint and strict TypeScript pass.

Its complete root `bun run check` also passed formatting, zero-warning lint, strict
types, the Electron SQLite probe, 63 passing and 1 skipped test files with 488
passing and 1 skipped tests, deterministic smoke, the 84-source product
boundary, the 1,766-file frozen AionUi foundation, the 179-file downstream
contract, and the 58-main/3-preload/28-renderer-module production build.

Initial pull-request head `40ba94d98293a260cdbce6b79731372fe5bac334`
passed the complete root check in CI run 30806677080, then failed materialized
AionUi strict TypeScript because the copied core barrel exported
`isolatedCodingTools.ts` without declaring that Actestra-owned file in the
downstream manifest. The focused correction added the byte-identical source
copy and expected changed-file entry. Pull request 31 reached exact final head
`c10110b38e8714b831a6d6d0fc09aa8df4218b7c`; exact-head CI 30808650150 passed
both Goose runner admission and macOS arm64 foundation. CodeRabbit selected the
six final correction files but was rate-limited before line-level review; its
successful status and Free walkthrough are not formal review evidence. The
branch squash merged as `266e3857bed7d4c32b773f92deff676bf2144b15`, and exact
merged-main CI 30809931486 passes both jobs.

The desktop-main composition slice starts from that exact merge on branch
`feat/p5-coding-main-composition`. It adds a main-owned lifecycle service that
creates the isolated worktree, persists the exact active grant before exposing
the Tool Gateway, composes the managed platform with production-random
identifiers, tracks opening and close races, retains failed cleanup for retry,
repairs the managed root to POSIX `0700`, attempts all pending and session
cleanup units, and preserves persistence authority if coding cleanup must retry.
Downstream patch 0012 creates the service under the private Actestra profile and
exposes only a main-process getter. It adds no preload, renderer, route, bridge,
UI, schema, or frozen-foundation change.

The combined focused P5.2 set passes 5 files and 49 tests. The downstream
contract passes 184 declared files, 4 R0 invariants, and 63 reviewed source
copies. A clean materialization from the exact 1,766-file frozen foundation
installs 3,177 packages, passes strict TypeScript, and passes the generated
native composition test 1 file/1 test. The complete root gate components pass
formatting over 197 files, zero-warning lint over 189 files, strict TypeScript,
the Electron SQLite probe, 65 passing and 1 skipped test files with 498 passing
and 1 skipped tests, deterministic smoke, the 85-source product boundary, the
frozen foundation and downstream contracts, and the
58-main/3-preload/28-renderer-module production build.

Pull request 32 reached exact final head
`5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`; exact-head CI 30817462671
passed both jobs. The exact-head CodeRabbit re-review covered all 12 changed
files and reported 0 issues; GitHub has no submitted review or inline review
thread. The branch squash merged as
`f55b5550c6ac189f09536061a70e8c8c7299c4f4`, and exact merged-main CI
30818949121 passed both macOS arm64 foundation and Goose runner admission.

The ACP session lifecycle slice starts from that exact merge on branch
`feat/p5-goose-acp-session`. It adds one bounded ACP `session/new` operation to
the admitted Goose connection and runner lifecycle. The request declares only
an absolute coding workspace and one exact
`http://127.0.0.1:<port>/mcp` capability proxy with one bounded opaque Bearer
attempt lease. Response correlation is by the fixed JSON-RPC request ID rather
than stdout position because Goose may first emit setup notifications. Only one
`usage_update` and one `available_commands_update` are admitted; their session
identifier must match the final response. Unknown or expanded messages,
oversized frames, malformed correlation, JSON-RPC rejection, timeout,
transport failure, process exit, and a second session request fail closed. A
failed session also closes the transport and removes the attempt-private runner
root without touching the repository. The combined focused P5.2 set passes 7
files and 85 tests. The complete root `bun run check` passes formatting,
zero-warning lint, strict TypeScript, the Electron SQLite probe, 65 passing and
1 skipped test files with 523 passing and 1 skipped tests, deterministic smoke,
the 85-source product boundary, frozen/downstream contracts, and the
58-main/3-preload/28-renderer-module production build.

Pull request 33 reached exact final head
`5d873f2feb94679341627aab0472a66630cf16cd`; exact-head CI 30823601815
passed both Goose runner admission and macOS arm64 foundation. CodeRabbit
selected all 9 changed files but supplied only its Free-plan summary and
walkthrough; GitHub records no submitted review, inline review comment, or
review thread, so the successful status is not formal review evidence. The
branch squash merged as `c5f498e926adac484694dab6d2f05b9822cc0b12`, and exact
merged-main CI 30825221070 passed macOS arm64 foundation job 91725008830 and
Goose runner admission job 91725008914, including the real ACP handshake and
cleanup step.

Pull request 34 then updated only these four source-of-truth documents. It
reached exact head `c17d5cd6df9de187ea93659e768da6207c6b4f34`, passed the
automatically created exact-head CI 30827073008, squash merged as
`776d1e1c10d13f036a3318f7d3c193a7819443a2`, and passed the single automatic
merged-main CI 30828549443: macOS arm64 foundation job 91736358985 and Goose
runner admission job 91736358994. That PR changed no product bytes.

The authenticated MCP transport slice started from that exact merge on branch
`feat/p5-goose-mcp-transport`. It adds one Actestra-owned HTTP server that
listens on a random `127.0.0.1` port and accepts only exact `POST /mcp` requests
carrying the attempt-private Bearer lease. It enforces the pinned Goose
`v1.45.0` User-Agent and MCP 2025-03-26 header sequence, rejects Origin and
stateful MCP session headers, requires a bounded non-chunked JSON body, and
admits only `initialize`, `notifications/initialized`, and `tools/list` in
order. The returned tool list contains only the six closed coding schemas and
snapshotted command/test identifiers. The real pinned Goose `progressToken`
shape is admitted, while expanded metadata remains denied. `tools/call` returns
JSON-RPC method-not-found and cannot reach the Tool Gateway in this slice.
Rejected and partial connections are closed, and server shutdown destroys all
remaining sockets.

Pull request 35 reached exact head
`93a8e9633f2be7b5f8c8b1eead3f2a21b0770073`. Exact-head CI 30832907098
passed macOS arm64 foundation job 91750962007 and Goose runner admission job
91750962049. CodeRabbit exhausted its review quota and GitHub records no
submitted review, inline comment, or review thread, so its status is not
represented as line-level review. The branch squash merged as
`8a31bafc1cd322744189fc4ed1e68f769225c999`, and exact merged-main CI
30834217310 passed macOS arm64 foundation job 91755320708 and Goose runner
admission job 91755320706.

The session-composition slice starts from that exact merge on branch
`feat/p5-goose-mcp-session-composition`. Pull request 36 first reached exact head
`9e277e1593b2715ed3721e1febb886985a942824`. Its automatic exact-head CI
30837296114 passed macOS arm64 foundation job 91765490611, while Goose runner
admission job 91765490592 failed its real integration at `session/new` with
`session-rejected`. That exact SHA was not rerun. Diagnosis against pinned Goose
and isolated probes established four compatibility facts: `session/new`
resolves a provider and model; the previous deny-all sandbox blocked the needed
loopback connections; the host proxy path required explicit loopback
`NO_PROXY`; and `session/new` initializes MCP without itself issuing
`tools/list`.

The corrected main-process helper generates separate 256-bit MCP and model
leases, starts the authenticated MCP server and a non-inference model catalog
on separate random loopback ports, and then opens the admitted Goose Worker.
Its model-related closed-environment additions are only the pinned provider,
caller model, exact catalog URL, opaque local API lease, and loopback proxy
bypass; the sandbox admits only those exact two ports. After the single `session/new`,
Actestra sends pinned Goose's `_goose/unstable/tools/list` request for the exact
MCP extension. The helper returns only after the MCP server accepts its
authenticated `tools/list`, Goose acknowledges discovery, and the response
matches all six coding tools. Normal and failed opening close Worker, MCP, then
the model catalog; idempotent close attempts every step and aggregates failures.

The corrected focused input passes 4 files and 51 tests. The admitted artifact
with manifest SHA-256
`e7bf0a7b78c6a603748cd119db888ed3fc367e118aed8bc10c4ded05611ea97c`
passes the real-runner integration 1 file/1 test on the corrected runtime bytes,
including exact-six discovery and private-root cleanup. On the corrected final
fingerprint, the one permitted `bun run check` passes formatting over 203 files,
zero-warning lint over 195 files, strict TypeScript, the Electron SQLite probe,
68 passing and 1 skipped test files with 582 passing and 1 skipped tests,
deterministic smoke, the 88-source product boundary, frozen/downstream
contracts, and the 58-main/3-preload/28-renderer-module production build.

Pull request 36 corrected final head
`5fe78bfaf2982556af975d23bc904d10b77a1f29` passed exact-head CI 30843561874:
macOS arm64 foundation job 91786216829 and Goose runner admission job
91786216934. CodeRabbit selected all 15 changed files but supplied only its
Free-plan summary and walkthrough, skipped the unchanged integration file as
similar to its prior review, and left no submitted review, inline comment, or
review thread. The branch squash merged as
`08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`. Exact merged-main CI 30845006202
passed macOS arm64 foundation job 91791030796 and Goose runner admission job
91791030814.

The authenticated MCP tool-call slice starts from that exact merge on branch
`codex/p5-goose-prompt-tool-loop`. After authenticated initialize, initialized,
and exact tool discovery, the server validates one active ACP session, the exact
isolated worktree, a bounded unique tool-call correlation identifier, one of the
six closed tools, and its versioned input contract. Replay and calls after
cleanup begins fail before main authority; result bytes and failures are bounded
and sanitized; shutdown aborts and awaits in-flight work. A main-owned invoker
binds the active desktop coding grant and Actestra Task, Session, Worker,
request, input, and output owners, persists the input, and routes execution
through the existing Tool Gateway policy, approval, audit, and executor. An
approval-required write is not executed. The affected focused fingerprint
passes 3 files and 65 tests: 49 MCP transport/call tests, 10 desktop-main and
real Gateway tests, and 6 composition tests. The unchanged artifact-gated
readiness integration was not rebuilt or rerun during focused iteration. The
Goose runner admission script now includes the real Gateway bridge test. On the
exact final production/test/script fingerprint, the one permitted `bun run check`
passes formatting over 204 files, zero-warning lint over 196 files, strict
TypeScript, the Electron SQLite probe, 68 passing and 1 skipped test files with
589 passing and 1 skipped tests, deterministic smoke, the 89-source product
boundary, frozen/downstream contracts, and the
58-main/3-preload/28-renderer-module production build.

A committed CodeRabbit review covered all 12 files in the pushed slice and
raised six findings. Verification confirmed two: shutdown could win before the
deferred invoker while the request still entered main authority, and the test
fixture used a non-portable fixed `/tmp` path. The server now rechecks closure
after body intake and immediately before deferred invocation, the regression
test proves the close-winning path never invokes main authority, and the fixture
uses the operating-system temporary directory. Four suggestions were rejected
after source and contract checks: the Gateway result union has only
`approval-required` and `executed`; invalid tool identifiers already fail the
closed parser; the recorded `2026-08-04` date matches this checkout's CST
environment; and the 128-call ceiling is the intentional P5.2 containment bound.

Pull request 37 delivered that authenticated tool-call bridge at exact head
`84b0550495717343b75ca2540cb7c191ab65b12a`. Exact-head CI 30851778390
passed macOS arm64 foundation job 91813249905 and Goose runner admission job
91813250047. CodeRabbit selected all 12 files but explicitly stopped at its
review limit; its successful status and Free summary are not line-level review
evidence. GitHub records no submitted review or inline review thread. The branch
squash merged as `d933546454e63a2d836e728f1b93980cb4a7c0ac`. The single
automatic merged-main CI 30853499159 passed macOS arm64 foundation job
91818968991 and Goose runner admission job 91818969025.

The authenticated inference/prompt slice starts from that exact merge on branch
`codex/p5-goose-inference-prompt-loop`. The Actestra model listener now retains
its authenticated catalog and adds one session-bound, bounded
`POST /v1/chat/completions` path. It requires the exact local lease, Host,
Actestra-bound ACP session header, selected model, streaming request, bounded
messages, and non-chunked JSON; a main-owned invoker returns only bounded
assistant text or one MCP tool call with usage, which Actestra serializes to the
closed SSE shape. The closed Worker environment adds
`GOOSE_DISABLE_SESSION_NAMING=true`, preventing pinned Goose's private
background naming inference and preserving Actestra Core's naming authority.

After exact tool discovery, the ACP connection admits one bounded text prompt
with fixed request correlation. It normalizes only same-session session-info,
tool-call, tool-call-update, assistant-text, and usage shapes; expanded frames,
rejection, timeout, transport failure, process exit, or a second prompt fail
closed and remove the private Worker root. The affected focused gate passes 4
files and 55 tests. The environment regression failed before the exact naming
key was added and then passed. With admitted artifact manifest SHA-256
`3dc1bf1b58dee9639ff35453a6486f890bb68f38fbc9dbf3e63ef56bfcdbb4af`,
the real-runner integration passes 1 file/1 test: exactly two model invocations,
one authenticated MCP file-read call, the bounded tool result in the second
request, normalized tool-call/completed/final-message updates, ACP usage, and an
empty private-root parent after close. No Runner process remains. The final root
gate on the same production/test fingerprint passes formatting over 204 files,
zero-warning lint over 196 files, strict TypeScript, the Electron SQLite probe,
68 passing and 1 skipped test files with 593 passing and 1 skipped tests,
deterministic smoke, the 89-source product boundary, the exact 1,766-file frozen
AionUi foundation, the 184-file downstream contract, and the
58-main/3-preload/28-renderer-module production build.

Pull request 38 reached exact head
`cc773081ba448266951a3b2ac3654831022118fc`. Exact-head CI 30859115162 passed
macOS arm64 foundation job 91836946596 and Goose runner admission job
91836946628. CodeRabbit explicitly did not start a review because its quota was
exhausted; GitHub records no submitted review or inline review thread, so that
status is not formal review evidence. The branch squash merged as
`a6280dd38eacdbada9db159c4784110ec8e42770`.

The single automatic merged-main CI 30860137257 passed macOS arm64 foundation
job 91840096925 but failed Goose runner admission job 91840096947 after the
runner artifact built successfully. The exact eight-file Goose gate passed 123
of 124 tests; the first real-Git desktop-main integration test took 5.260
seconds and crossed Vitest's implicit five-second unit-test deadline. The PR
head and squash merge have the same tree
`46b3941436b5ed232e6ba674c67abfcf42b09dbb`; the same test took 2.413 seconds
in exact-head CI. The unchanged test passes locally in 329 ms when run alone.
The correction gives only that real Git plus persistence-utility integration
test an explicit bounded 15-second deadline. A forced one-millisecond default
reproduces the timeout before the correction and passes after the per-test
deadline. The exact eight-file Goose selection then passes locally with 7 files
and 123 tests passing and the unchanged real-artifact file skipped because no
artifact environment was supplied. Formatting, zero-warning lint, strict
TypeScript, Markdown style, 63-file documentation links, and whitespace checks
pass without changing production code, tool authority, Worker behavior, or the
frozen AionUi foundation. The expensive runner build and complete root gate are
not repeated for this test-and-document-only fingerprint. The failed merged-main
run is not rerun and is not represented as successful remote closure.

Pull request 39 delivered that bounded test deadline at exact head
`38cbbaaedbb8e5955b96a6d7148841180e751e35`. Exact-head CI 30861770178
passed macOS arm64 foundation job 91845074323 and Goose runner admission job
91845074258. The branch squash merged as
`7e8732e264febff42fb3d451011b3b8e48caaff5`; the single automatic
merged-main CI 30862710547 passed macOS arm64 foundation job 91847939794 and
Goose runner admission job 91847939858. CodeRabbit returned success without
starting a review because its quota was exhausted; GitHub records no submitted
review or inline review thread, so that status is not line-level review evidence.

The desktop-main Goose lifecycle slice starts from that exact merge on branch
`codex/p5-goose-desktop-main-lifecycle`. The service now opens the existing
session helper only after creating the isolated worktree, persisting its active
grant, and constructing the main-owned Tool Gateway invoker. The helper receives
only that worktree, the admitted artifact, caller-owned model invoker, and the
snapshotted command/test identifiers. Service shutdown waits for in-flight Goose
openings, rejects a session whose open loses the close race, and closes Goose
before grant revocation and worktree removal. Opening and cleanup failures retain
both causes and unfinished worktree ownership for retry. Downstream patch 0012
materializes the seven Goose TypeScript dependencies and exact runner source pin
alongside the service; no preload, renderer, route, schema, or frozen-foundation
file changes.

The current affected evidence passes 3 focused files and 22 tests, the ACP
normalization test file with 31 tests, root strict TypeScript, the 192-file
downstream contract with 4 R0 invariants and 71 reviewed source copies, a clean
3,177-package native materialization, native TypeScript, and the generated
native composition test 1 file/1 test. The copied ACP source also passes the
AionUI-equivalent non-strict compiler configuration after three explicit
type-narrowing annotations with no runtime protocol change. The single final-
byte root gate passes formatting over 204 files, zero-warning lint over 196
files, strict TypeScript, the Electron SQLite probe, 68 passing and 1 skipped
test files with 597 passing and 1 skipped tests, deterministic smoke, the
89-source product boundary, the 1,766-file frozen foundation, the 192-file
downstream contract, and the 58-main/3-preload/28-renderer-module production
build. Pull request 40 reached exact head
`c35f8c37c14dedaa980dfbb539f16fc21379be8a`; exact-head CI 30865837496
passed macOS arm64 foundation job 91857370003 and Goose runner admission job 91857370054. CodeRabbit did not start a review because its quota was exhausted;
GitHub records no submitted review or inline review thread. The branch squash
merged as `1909033977576d94f6983f9c911b8e0a866a59de`, and exact merged-main CI
30866691199 passed macOS arm64 foundation job 91859998038 and Goose runner
admission job 91859998109.

The approval-outcome slice starts from that exact merge on branch
`codex/p5-goose-approval-outcomes`. Desktop main may inject one explicit
approval-decision handler; without it the invoker retains the delivered
`approval-required` fail-closed result. An approved decision is persisted by
the Actestra approval service before the same operation and one-shot approval
identifier re-enter the Tool Gateway. A denial is persisted and projected as
the bounded `approval-denied` result without execution. Abort settles an
unresolved handler without writing. Resolution evidence must retain the exact
approval, operation, policy revision, request time, expiry, state, and actor.
The current focused file passes 18 tests with 2 admitted-artifact tests skipped
locally because no runner artifact environment is supplied; those two tests are
already selected by the existing Goose CI gate and exercise real approved and
denied prompt/tool turns. No renderer, preload, route, schema, frozen-foundation,
credential, or original-checkout authority is added. On the final
production/test bytes, the single root gate passes formatting over 204 files,
zero-warning lint over 196 files, strict TypeScript, the Electron SQLite probe,
68 passing and 1 skipped test files with 601 passing and 3 skipped tests,
deterministic smoke, the 89-source product boundary, the 1,766-file frozen
foundation, the 192-file downstream contract, and the
58-main/3-preload/28-renderer-module production build. The installed
materialized-native tree also passes TypeScript and its generated composition
test 1 file/1 test.

Pull request 41 delivered those approval outcomes at exact head
`917a95260d84f09aacf5038d92a5230d1781676d`, passed its single exact-head CI
30870425378, squash merged as
`7dfc4973021d68d5df0ded12fa218ecd42da9691`, and passed the single exact
merged-main CI 30871703449. The merge was authorized after the owner resumed
remote progress; it is not an accidental or bypassed merge.

The durable normalized-evidence slice starts from that exact merge on branch
`codex/p5-goose-durable-evidence`. Electron main derives stable SHA-256 attempt
stream and correlation identifiers only from Actestra Workspace, Task, Session,
and Worker identity, persists `task.started` before Goose opening, and records
bounded assistant, tool, approval, failure, cancellation, and review-blocked
events without promoting Goose-private identifiers or raw tool inputs. The same
coordinator reconciles authoritative Task, Session, Worker, and Approval
projections; prompt completion leaves the isolated worktree blocked for review,
while close persists cancellation before Goose, grant, and worktree cleanup.
Pending approvals are cancelled before terminal Task evidence, including
cancelled prompts and approval-handler failures. Opening and prompt failures use
stable sanitized codes, and committed-but-lost evidence acknowledgements replay
without invoking Goose or a tool twice. General Work and coding reconciliation
share one persistence mutation barrier so two main-owned graph writers cannot
overwrite each other.

The affected local fingerprint passes 2 focused files with 44 tests passed and
2 admitted-artifact tests skipped, strict TypeScript, and zero-warning lint over
the seven affected TypeScript/JavaScript files. The downstream overlay passes
with 194 declared files, 4 R0 invariants, and 73 reviewed source copies. After a
locked 3,177-package install, the materialized-native tree passes strict
TypeScript and its generated composition test 1 file/1 test. The final-byte root
gate passes formatting over 206 files, zero-warning lint over 198 files, strict
TypeScript, the Electron SQLite probe, 68 passing and 1 skipped test files with
613 passing and 3 skipped tests, deterministic smoke, the 91-source product
boundary, the exact 1,766-file foundation, the downstream contract, and the
59-main/3-preload/28-renderer-module production build. Pull request 42 reached
exact head `a20882abeb6caac3b4f230fde42a7e06965a0730`, passed exact-head CI
30876755457, squash merged as `e064dc88e717cef093c866cdbc2692d23ed7dd03`,
and passed the single exact merged-main CI 30877711241: Goose runner admission
job 91892412815 and macOS arm64 foundation job 91892412830. CodeRabbit supplied
only its Free summary and walkthrough; GitHub records no submitted review or
inline thread, so that status is not line-level review evidence.

The publish and Artifact-registration slice starts from that exact merge on
branch `codex/p5-goose-publish-artifact`. It adds one main-only
`actestra.coding.artifact.publish` capability without adding it to Goose's six
MCP tools. Main captures one base-to-worktree binary patch across tracked,
staged, unstaged, and untracked paths with a private temporary index, a 1 MiB
bound, exact Git binding, and common plus worktree configuration locks. The
real index remains unchanged, executable filter/include configuration fails
closed, and the source checkout is never a target.

The approval surface receives only the base commit, patch byte length, and
SHA-256. The patch stays in an Actestra-owned content reference. An approved
operation re-captures the worktree and requires an exact match before the same
one-shot approval enters the Tool Gateway. Output content, normalized events,
the `Artifact` record, and completed Task/Session state are durable before
Goose, grant, and worktree cleanup. Denial or post-approval drift returns to
blocked review and retains the worktree. Exact derived request, input, patch,
output, and Artifact identifiers make in-process response replay idempotent
without a second approval or duplicate event.

The affected final fingerprint passes 5 focused files with 123 tests passed
and 2 admitted-artifact tests skipped. The one final-production-byte
`bun run check` passes formatting over 208 files, zero-warning lint over 200
files, strict TypeScript, the Electron SQLite probe, 68 passing and 1 skipped
test files with 618 passing and 3 skipped tests, deterministic smoke, the
93-source product boundary, the exact 1,766-file foundation, the 196-file
downstream contract with 4 R0 invariants and 75 reviewed source copies, and the
59-main/3-preload/28-renderer-module production build.

Pull request 43 delivered the publish and Artifact-registration boundary at
exact head `305a29d9b2b514865983ae9d8a23f877566bb7a5`. Exact-head CI
30883055147 passed Goose runner admission job 91908308668 and macOS arm64
foundation job 91908308735. CodeRabbit selected all 14 changed files but stopped
before review because its quota was exhausted; GitHub records no submitted
review or inline comment, so its successful status is not line-level review
evidence. The branch squash merged as
`9048fe2cc23819f596d8721adb8c544dcd0b786f`. The single automatic
merged-main CI 30884138218 passed macOS arm64 foundation job 91911549623 and
Goose runner admission job 91911549665. This closes the P5.2 phase gate: the
source checkout remains unchanged, only the isolated worktree is modified and
tested, approvals remain one-shot and main-owned, exact patch re-capture gates
the available Actestra Artifact, and cleanup is durable and ordered.

The P5.3 preserved-AionUI journey starts from that exact merge on branch
`codex/p5-aionui-coding-journey`. Downstream patch
`0013-actestra-goose-native-agent.mjs` is an R1 provider change; it does not edit
the frozen foundation or add a Goose application UI. Electron main owns one
fixed Goose readiness provider for retained Agent Settings and Repair, five
main-frame-only coding-journey IPC intents, runner admission, canonical native
Git-root resolution, deterministic Actestra identities, and bounded projection
from durable Core state. A dedicated context-isolated preload API exposes only
submit, list, cancel, tool-decision, and publish-decision operations.

The retained non-Team ACP SendBox adds one fixed native/Goose selector. Native
ACP send and stop behavior remains available, Team behavior is unchanged, and
Goose submissions reject attachments rather than silently dropping them. Only
closed Actestra coding metadata can route the native permission component to
tool or publish decisions; ordinary native confirmations keep their existing
path. Assistant text, tool status, terminal/test summaries, diffs, review state,
and Artifact labels project into the existing AionUI conversation surfaces.
The affected root set passes 7 files and 26 tests, including the admitted-
artifact file's 2 real-Goose journeys. Real Goose receives a file-write
approval, a registered focused-test approval, and the final assistant response
before exact publish approval produces one available Artifact; a separate real
in-flight prompt cancellation removes the Worker, grant, private root, and
worktree. Both outcomes preserve the source checkout. Root strict TypeScript,
affected zero-warning lint/format, patch syntax, documentation links, and
whitespace checks pass. The downstream contract passes 217 declared files, 4 R0
invariants, and 80 reviewed source copies. The materialized native application
passes strict TypeScript and 3 files/8 focused tests without reinstalling its
byte-identical locked dependency graph.

On the unchanged final production/test fingerprint, one complete root
`bun run check` passes formatting over 221 files, zero-warning lint over 213
files, strict TypeScript, the Electron SQLite probe, 74 passing and 2 skipped
test files with 642 passing and 5 skipped tests, deterministic smoke, the
98-source product boundary, the exact 1,766-file foundation with 27 routes and
41 bridge domains, the 217-file downstream contract with 4 R0 invariants and
80 reviewed source copies, and the
61-main/3-preload/28-renderer-module production build. Pull request 44 reached
exact head `15a8e29b44a6684313f29a694f0d0615de95cf36`; exact-head CI
30899489690 passed macOS arm64 foundation job 91960187584 and Goose runner
admission job 91960187604. CodeRabbit supplied only its Free summary and
walkthrough; GitHub records no submitted review or inline thread. The branch
squash merged as `ee8425e39e201078cd64fe3af38355279ecf56de`, and exact
merged-main CI 30900884248 passed Goose runner admission job 91964656475 and
macOS arm64 foundation job 91964656542. The exact-head and merged-main trees
both resolve to `e301a0acede51671b404daf11248788cdaba34d9`. P5.3 is accepted
on `main`; candidate, release, deployment, and user acceptance remain
unclaimed.

The first P6 implementation slice started from that exact merge on branch
`codex/p6-team-plan-admission`. It adds an Actestra Core-owned protocol version
1 request/candidate boundary plus a desktop-main planner port and admission
service. Requests contain only a bounded goal, unique declared General/coding
capabilities, classified context references, an Actestra correlation ID, and
fixed node, depth, concurrency, and attempt budgets. Candidate records reject
unknown authority fields, unsupported versions or capabilities, cycles,
missing or duplicate dependencies, unbounded text, invalid UTF-8, excessive
depth, width, nodes, or attempts, and the absence of General, coding, human
feedback, or a parallel branch. Accepted candidates receive deterministic
Actestra `TeamPlan`, node, and Task identities in a deeply frozen stable
topological result.

Desktop main normalizes and freezes the closed request before invoking the
planner port, refuses pre-call and in-flight cancellation, sanitizes planner
failures, and preserves Core admission error codes. The focused local set
passes 2 files and 30 tests. On the unchanged production/test fingerprint, the
single root `bun run check` passes formatting over 225 files, zero-warning lint
over 217 files, strict TypeScript, the Electron SQLite probe, 76 passing and 2
skipped test files with 672 passing and 5 skipped tests, deterministic smoke,
the 100-source product boundary, the exact 1,766-file foundation with 27 routes
and 41 bridge domains, the then-current 217/4/80 downstream contract, and the
62-main/3-preload/28-renderer-module production build.

Pull request 45 initially reached exact head
`59cf48fbbb45d78c803ab6691547b61878fc8eb3`. Its sole exact-head CI run
30905371865 passed the root source/test/boundary step, then failed macOS job
91979102770 at materialized-native TypeScript because the copied Core barrel
exported `teamOrchestration.ts` without declaring that new source copy. The
already-running Goose job 91979102841 was cancelled after the deterministic
macOS failure to stop further Actions consumption; the failed SHA is not
rerun.

The overlay-only correction reached exact head
`a3d08a934160c1a5d61ff987ade29212bd3c0b05`. Exact-head CI 30906689796
passed Goose runner-admission job 91983312901 and macOS arm64 foundation job
91983312925. GitHub records no submitted review or inline thread; CodeRabbit's
successful status is not represented as line-level review evidence. The branch
squash merged as `30742934adde1e0944c4e8ced1f005452a1f3568`; exact
merged-main CI 30907869824 passed Goose job 91987128709 and macOS job
91987128766. The bounded team-plan admission slice is accepted on `main`.

The next P6 slice starts from that exact merge on branch
`codex/p6-team-plan-persistence`. SQLite schema 14 adds one strict
`team_plans` authority table. Actestra Core revalidates exact fields, bounded
text, deterministic identifier shapes, limits, canonical dependency order and
topology, and the required General/coding/human-feedback/parallel envelope.
Plan and correlation/version identities are unique; the canonical JSON digest
detects stored-byte drift; identical retries return `duplicate`; conflicting
identities fail as `team-plan-conflict`; and reloaded records are deeply frozen.
The persistence utility exposes only closed persist and lookup operations. Its
client rejects substituted persisted bytes or lookup identities and fails the
connection closed. Desktop main awaits the persistence barrier before
returning an admitted plan.

The focused P6 set passes 5 files and 64 tests. Strict TypeScript, targeted
formatting, and zero-warning targeted lint pass. The slice's single permitted
root-gate attempt passed formatting, lint, strict TypeScript, and the Electron
SQLite probe, then reached 75 passing and 2 skipped files with 679 passing and
5 skipped tests before one stale `schemaVersion: 13` assertion failed. The
assertion now uses `CURRENT_CORE_SCHEMA_VERSION`; its focused utility-service
test and narrow format/lint checks pass. The final overlay and cumulative patch
bytes also pass the exact 1,766-file foundation check and the 218-file
downstream contract with 4 R0 invariants and 81 reviewed source copies; all 63
documentation links resolve. The complete root gate is deliberately not
repeated; the exact-head CI remains the only final-byte full validation.
This slice adds no scheduler, orchestration state-machine execution,
CrewAI/Python process, Worker launch, renderer, bridge, route, Team UI, packaged
runtime dependency, candidate, release, deployment, or P6 phase-completion
claim.

P4's phase acceptance record reached pull request 25 at exact head
`c461fb06bdebd4bf6f55d39741a21dcb6980b3ff` and squash merged as current
`main` `adc9a99d7806f5627041368b4ff932c1fe9a42f0`. Merged-main CI run
30689608454 initially failed only while the smoke harness externally killed the
Worker after all target-app readiness markers were present. The same exact
product and documentation bytes passed the failed job once on a fresh runner as
attempt 2. That is recorded as a runner/timing failure followed by a passing
exact-SHA rerun, not as a product fix or a hidden regression.

P5.0 reached
[pull request 26](https://github.com/bignormal/actestra-desktop/pull/26) at
exact head `e622f36e697b4e0be1037175267452e24cc180e3`, passed exact-head CI
30691045159, and squash merged as
`b61dd3ea44a4c522ca0c15a84a01d8f76b335e4c`. Exact merged-main CI
30691300690 passes. CodeRabbit reached a successful status only after returning
a rate-limit response, so it is not represented as a formal or zero-finding
review. ADR-0024 selects Goose `v1.45.0` at exact commit
`4dc0420f5704a92806c6628c8f0a3497d7a88759`, ACP 1.0.1/schema 1.1.0,
an empty Goose feature set, and the minimal stdio runner; the broad upstream
CLI remains rejected.

P5.1 reached
[pull request 27](https://github.com/bignormal/actestra-desktop/pull/27) at
exact head `d3be6c665b1df51acec13c95691315ba97ba98dc`, passed exact-head CI
30698164038, and squash merged as
`df5bd41ca0ecd4838e046f48a9016e418b036ac7`. It adds a minimal Rust entry point
that calls `goose::acp::server::run(Vec::new(), false)`, an exact committed
Cargo lock, Rust 1.96.1, pinned `cargo-auditable 0.7.4` and
`cargo-audit 0.22.2` installers, CycloneDX 1.6 and normalized RustSec evidence,
an immutable artifact manifest, and a main-owned supervised ACP initialize
path. The process receives a closed environment and attempt-private root, runs
under macOS deny-network sandboxing, receives no provider, credential, tool,
workspace, model, or user configuration, and is terminated and removed on
failure or close.

The real local arm64 runner is 63,911,512 bytes with executable SHA-256
`1aa35cfa29a781752f992afa67dc6139f235b3cc662e01d2d556080dabbe8d21`.
Its selected graph and normalized Cargo tree both have 413 active dependencies,
the current build reports 423 compiler-artifact packages, its auditable metadata
has 458, and its complete lock has 545. `event-listener` is `5.4.2`; vulnerable
`quick-xml`, `goose-cli`, and `goose-mcp` do not enter the selected graph.
Lock and embedded-metadata scans both report exactly `RUSTSEC-2023-0071` for
`rsa 0.9.10`, while all-target inverse normal-edge queries find no `rsa` or
`sqlx-mysql` path and the release output contains no matching compiled
artifact. ADR-0025 accepts only that exact `metadata-only-not-compiled`
disposition and requires every other finding or changed proof to fail closed.
The report is not called clean.

Failure-first tests prove strict numeric ACP protocol version 1,
exact Goose 1.45.0 identity and capability allowlisting, unsupported-version
rejection before session creation, external manifest trust, immutable staged
bytes, closed environment, and cleanup after success, handshake rejection, and
preparation-time digest failure. The complete P5.1 target set passes 4 files and
21 tests, including trusted target mismatch, artifact-directory symlink and
unexpected-entry rejection, stale advisory-fetch rejection, transport-cleanup
failure with root removal, and a real no-network sandboxed Goose
initialize/close, without leaving a process or attempt root. A complete local
CodeRabbit CLI review of the full uncommitted diff emitted only progress and
heartbeat events for ten minutes and was then terminated without a conclusion.
It is recorded as incomplete automatic-review evidence, not as zero findings,
and is not rerun against unchanged bytes. The complete 34-file manual review
found and remediated the directory trust and exact-entry gaps, then reviewed the
General Worker terminal-listener correction, its downstream invariant, and the
clean-runner Cargo-query correction separately, and supplies the review
substitute.

The initial P5.1 exact-head gates passed both the macOS arm64 foundation and
Goose runner-admission jobs. Merged-main run 30698648996 then separated the
outcomes: Goose runner admission job 91365677397 passed, while macOS arm64
foundation job 91365677408 failed because the packaged target application
exited during the injected Worker-crash scenario. That merge was therefore not
accepted until the desktop-crash hotfix closed the failed gate.

Four retained local crash reports reproduce the same Electron 37.10.3 arm64
`EXC_BAD_ACCESS` null dereference before and after the one-shot-listener change.
Symbolication with Electron's official v37.10.3 arm64 symbols resolves the
native path to `electron::api::UtilityProcessWrapper::HandleTermination`, a
synchronous JavaScript `exit` emission, and then
`electron::api::UtilityProcessWrapper::PostMessage`. The General Worker exit
callback synchronously persisted terminal state through the separate
Persistence Utility while Electron was still unwinding the native child
termination stack. Making listeners one-shot removed duplicate delivery but did
not remove that reentrant native call and was not the root-cause fix.

The desktop-crash hotfix reached
[pull request 28](https://github.com/bignormal/actestra-desktop/pull/28) at
exact head `eed1623e9849b9f662f3dec690d02d7c85a693ef`. It keeps AionUI as the
only UI and changes no schema, bridge, permission, task state, or recovery
authority. A small main-owned helper defers only Electron General Worker
terminal-event delivery with `setImmediate`, cancels pending delivery during
competing cleanup, and leaves the real Worker `SIGKILL` plus authoritative Core
persistence unchanged. The downstream overlay and checker require the same
implementation, and the smoke harness now records exact spawn error or
exit-code/signal diagnostics on early application termination.

The current hotfix local gates pass:

- complete root `bun run check` passes formatting, zero-warning lint, strict
  types, the Electron SQLite probe, 60 passing and 1 skipped test files with 449
  passing and 1 skipped tests, the smoke and authority boundaries, frozen
  AionUi foundation and downstream contract, and the root production build;
- 2 focused files and 13 tests specifically prove next-turn terminal delivery,
  queued-delivery cancellation, and existing General Worker adapter behavior;
- materialized AionUi strict TypeScript and production build pass, transforming
  608 main, 24 preload, and 10,184 renderer modules;
- the local macOS arm64 directory package at
  `/private/tmp/actestra-p5-package-deferred-terminal-20260801-2/mac-arm64/Actestra.app`
  passes 11 afterPack resource checks, the independent package verifier, and
  strict recursive code-sign verification with an Apple Development identity.
  It is not notarized, a candidate, a release, or a deployment; and
- the exact package passes the complete schema-13 target-app General Work smoke
  through scheduled, interrupted, representative failure, externally killed
  Worker, restart recovery, writing, Office/DOCX/Preview, local research,
  authorization-denial, cancellation, event, artifact, audit, privacy, and
  process-cleanup evidence.

The first P5.1 exact-head CI run failed Goose admission separately because a
clean runner lacked all-platform Cargo manifests while the all-target inverse
query was forced offline. The command failure was incorrectly reported as an
RSA dependency path. The corrected query keeps the exact lock and Goose commit,
permits only the missing locked manifests to be fetched, and now distinguishes
query failure from a non-empty dependency path. The corrected local runner
rebuild has manifest SHA-256
`3dc1bf1b58dee9639ff35453a6486f890bb68f38fbc9dbf3e63ef56bfcdbb4af`, the
unchanged executable SHA-256 above, and all 4 files/21 admission and real
handshake tests pass. PR 27 and merged-main Goose job 91365677397 now supply the
previously missing clean-runner evidence.

The earlier complete CodeRabbit CLI review emitted only progress and heartbeat
events for ten minutes and ended without a conclusion. It remains incomplete,
not zero-finding evidence, and was not rerun against unchanged bytes. A complete
manual/static review of the 9-file hotfix verifies the native-stack deferral,
competing-cleanup cancellation, one-shot production wiring, downstream copy,
smoke diagnostics, changelog, and status evidence and finds no unresolved
issue. Exact-head CI 30699859869 passes Goose runner-admission job 91368851431
and macOS arm64 foundation job 91368851457. The hotfix squash merged as
`d313fb2ed65e4b010f777435953752818fbbfae4`; exact merged-main CI
30700441312 passes Goose job 91370408096 and macOS foundation job 91370408204,
including the complete packaged external-`SIGKILL` recovery smoke. These gates
accept P5.1. No Goose session, coding capability, original-checkout write,
renderer route, second UI, CrewAI sidecar, Eigent runtime, candidate, release,
or deployment is added by this slice.

Pull request 8 reached exact final head
`3f85e13072f5fb13fb43c9dae94f992bb0b7fb9c` and squash merged F3.3 as
`c841ed9cb6a54bcb2e4078ca2be941adce0ac4ad`.
[Main CI run 30449520722](https://github.com/bignormal/actestra-desktop/actions/runs/30449520722)
passes on that exact merge. ADR-0014 and the merged F3.3 route only the bounded
pending-state read used by retry and restart reconciliation through an exact
P3 policy, capability, and durable audit path. A complete local CodeRabbit
review of all 18 changed files raised zero issues before merge; the explicit
remote review was rate-limited before review and is not represented as review
evidence. The real AionUi application, original functional UI, and original
functions remain the product baseline.

Pull request 9 reached exact final head
`d7e615206af0829375db0db1d1fcc6ca205102a8` and squash merged the P6
architecture update as
`327d5ca5abf3a0090bc2b3d3193e2935bbd47f38`.
[Main CI run 30470505690](https://github.com/bignormal/actestra-desktop/actions/runs/30470505690)
passes on that exact merge.

ADR-0015 records CrewAI as the first supervised P6 planner-sidecar candidate
while keeping the Actestra TeamOrchestrator authoritative and Eigent as the
product and acceptance reference. This is an accepted architecture direction
only: CrewAI is not imported, installed, bundled, or implemented, and P6
remains ordered after the P4 and P5 gates.

General-work GW-P4.2 reached
[pull request 10](https://github.com/bignormal/actestra-desktop/pull/10) at
exact final head `9003cc0387cb4266c4b1240308092366ef365bf4`, passed
[PR CI run 30475836615](https://github.com/bignormal/actestra-desktop/actions/runs/30475836615),
and completed a 50-file CodeRabbit review with zero findings. It squash merged
as `8e32882108b10272c1489c1a46a77cede1cc4fb7`; exact merged-main
[CI run 30476091907](https://github.com/bignormal/actestra-desktop/actions/runs/30476091907)
passes.
[ADR-0016](architecture/decisions/0016-p4-general-work-process-and-content-boundaries.md)
records the accepted process and content boundary: schemas 1 through 6 and all
P3/F2/F3 operations now run behind the asynchronous persistence utility, with
durable grants and bounded content references and no synchronous SQLite
fallback in Electron main.

GW-P4.3 reached
[pull request 11](https://github.com/bignormal/actestra-desktop/pull/11) at
exact final head `b3a3bc7e27d7dab44dadeff6dcedc92cec1b3ee5`, passed
[PR CI run 30481670123](https://github.com/bignormal/actestra-desktop/actions/runs/30481670123),
and squash merged as `671587813bea18411b6cdc2ee388d94cd18d6c50`.
[Merged-main CI run 30481890911](https://github.com/bignormal/actestra-desktop/actions/runs/30481890911)
passes on that exact merge.
[ADR-0017](architecture/decisions/0017-general-worker-process-and-agent-adapter-v2.md)
advances AgentAdapter to version 2, adds typed tool-result resolution, and
defines a separate strict General Worker protocol. One Electron utility
process accepts one immutable attempt; Electron main owns attempt, tool,
event, and timestamp identity and maps only validated worker signals into
Actestra events.

GW-P4.3 validation completed before merge:

- focused Adapter v2 and worker validation passes 8 files and 47 tests;
- complete root `bun run check` passes formatting, zero-warning lint, strict
  types, the Electron SQLite probe, 40 files and 217 tests, process smoke,
  55-source boundary, foundation/downstream checks, and the three-entry build;
- coverage passes at 79.76% statements, 72.23% branches, 87.30% functions, and
  79.95% lines without threshold changes;
- the unsigned arm64 legacy-harness directory bundle passes identity,
  recursive worker-graph verification, and clean-profile smoke through
  persistence, real General Worker, window, and renderer readiness;
- materialized native strict TypeScript and all 13 Actestra native files with
  34 tests pass;
- the complete native suite passes 334 files and 2,610 tests, with 1 file and
  5 tests skipped by retained upstream configuration;
- the native production build emits distinct main, persistence-utility, and
  General Worker entries without changing the renderer; and
- a real isolated-profile AionUi launch without fault injection used the exact
  local `aioncore 0.1.52`, logged worker completion, AionCore health, window,
  and renderer readiness, and left no Actestra, worker, or AionCore process
  after terminal shutdown.

GW-P4.4 reached
[pull request 12](https://github.com/bignormal/actestra-desktop/pull/12) at
exact final head `34f2d2201581c19b3dc67c5a7936f8a411bff9e1`, passed
[PR CI run 30486392525](https://github.com/bignormal/actestra-desktop/actions/runs/30486392525),
and squash merged as `7ec009c6384a93c17f24e4276469e98cb5f2b71d`.
[Merged-main CI run 30486544268](https://github.com/bignormal/actestra-desktop/actions/runs/30486544268)
passes on that exact merge.
[ADR-0018](architecture/decisions/0018-scoped-native-text-tools-and-policy.md)
admits only bounded workspace text read and create-only task-output text write.
The worker selects only a registered tool name; main derives the operation from
the current pending request and trusted registry, while workspace grants,
exact-owner content references, closed manifests, deny-by-default policy, and
durable audit remain Actestra-owned.

Current GW-P4.4 local evidence:

- root strict types and zero-warning lint pass;
- the two scoped-native root suites pass 15 tests across success, denial, traversal,
  symbolic-link escape, invalid UTF-8, size, ownership, malicious identity,
  cancellation, conflict, unsupported-tool, timeout-ceiling, cleanup-failure,
  and coordinator-unlock cases;
- the downstream overlay contract passes with 125 declared files, 4 frozen R0
  invariants, and 40 reviewed Actestra source copies; and
- three focused materialized-AionUi files pass 4 tests;
- complete root `bun run check` passes 42 files and 232 tests, the Electron
  SQLite probe, 59-source authority boundary, frozen foundation, downstream
  contract, smoke harness, and the three-entry production build;
- root coverage passes at 80.80% statements, 73.59% branches, 86.88%
  functions, and 81.01% lines;
- the first native strict-TypeScript gate found three missing explicit callback
  return types; the minimal source fix passed the same gate;
- complete native regression passes 335 files and 2,612 tests, with 1 file and
  5 tests skipped by retained upstream configuration;
- the native production build transforms 588 main modules and emits distinct
  main, persistence-utility, and General Worker entries;
- the unsigned arm64 harness package passes identity, recursive authority-graph
  verification, and clean-profile persistence/worker/window/renderer smoke;
  and
- a real isolated native launch logs the two exact native tools, schema 6,
  Adapter v2/Worker v1 completion, exact local `aioncore 0.1.52` health, window,
  and renderer readiness, then exits gracefully with no orphan process.

An initial CodeRabbit pass reviewed the 21 already-tracked changed files and
raised three issues. Two requested changing `2026-07-30` to the prior UTC date
and are invalid for the recorded Asia/Shanghai work date. The third requested
copying the legacy-harness `MainPlatformServices` into the native downstream
and is invalid because patch 0008 directly composes the scoped platform in the
AionUi main process; copying that unreferenced file would not connect it. The
new untracked implementation files were outside that pass.

The subsequent full staged-diff CodeRabbit pass covered all 30 implementation
files and raised nine issues. Seven valid findings were remediated: portable
Windows path characters and invalid UTF-16, the manifest timeout ceiling,
typed persistence ownership errors, post-publication temporary-file cleanup,
coordinator lock release, failed test-harness initialization cleanup, and the
shared content-size constant. The two rejected findings were another UTC-date
change and a redundant explicit `.`/`..` task check already enforced by
`assertPortableRelativePath`. Focused and complete gates above pass after
those changes. The recorded final head, exact-head CI, squash merge, and
merged-main CI close GW-P4.4 as an accepted implementation slice, not as a
candidate or release.

GW-P4.5 reached
[pull request 13](https://github.com/bignormal/actestra-desktop/pull/13) at
exact final head `f160d9a3a00f317f12b7579bc3a48849c1cf32d2`, passed
[PR CI run 30495112290](https://github.com/bignormal/actestra-desktop/actions/runs/30495112290),
and squash merged as `1dacbc0bee8ebae26d688e6e719c8f0f5750db5f`.
[Merged-main CI run 30495301140](https://github.com/bignormal/actestra-desktop/actions/runs/30495301140)
passes on that exact merge.
[ADR-0019](architecture/decisions/0019-general-work-durable-coordination-and-recovery.md)
adds schema version 7 checkpoints and the persist-before-acknowledgement and
persist-before-release sequence across Task, Attempt, tool ambiguity, content
reference, artifact binding, normalized events, audit, cleanup, terminal
evidence, and restart recovery.

Accepted GW-P4.5 evidence:

- strict root TypeScript passes;
- the final affected root set passes 9 files and 80 tests, including
  no-double-execution after a persistence barrier failure, exact pre-execution
  grant ownership, bounded checkpoint admission, authoritative event-history
  and artifact projection checks, duplicate event-ID rejection, cleanup after
  unsubscribe failure, and deterministic restart recovery;
- the AionUI downstream contract passes with 129 declared files, 4 frozen R0
  invariants, and 43 reviewed source copies;
- the post-remediation materialized native focus passes 4 files and 5 tests;
  and
- the first full CodeRabbit pass produced nine candidates; five valid findings
  were fixed and four invalid findings were dispositioned. The later
  changed-diff follow-up waited about 25 minutes without a conclusion and was
  terminated as an orphan, so it is incomplete review evidence, not a
  zero-finding result; and
- a complete manual/static review covered the initial 43-file change and fixed six
  additional event-history, grant-ownership, artifact-contract,
  checkpoint-bound, and serialized DomainGraph-reconciliation issues. The two
  smoke-contract files added by the later gate fix were reviewed separately,
  bringing the final local diff to 45 files;
- the root pre-commit gates pass: zero-warning format/lint, strict types,
  Electron SQLite probe, 44 files and 256 tests, smoke-harness regression,
  61-source product boundary, exact frozen foundation, 129-file downstream
  contract, and production build. The first aggregate invocation stopped at
  the foundation check because four ignored macOS `.DS_Store` files polluted
  the frozen directory; removing those exact untracked files and resuming from
  that gate passed without rerunning the already-passed root suite;
- the first complete materialized-native attempt failed because the disposable
  tree had no installed dependencies. The three-module resolution probe
  reproduced the missing environment, `downstream:aionui:install` installed
  the exact 3,177-package lock, and no source result was inferred from that
  failed run;
- with dependencies installed, strict native TypeScript exposed two missing
  callback return annotations in the copied coordinator. The source fix,
  affected coordinator test, rematerialization, and strict native TypeScript
  pass; the complete native regression then passes 336 files and 2,613 tests,
  with 1 file and 5 tests skipped by retained upstream configuration;
- the materialized native production build passes after 591 main, 7 preload,
  and 10,163 renderer modules and emits distinct persistence-utility and
  General Worker entries;
- the unsigned arm64 compatibility-harness bundle and package identity checks
  pass. Its first smoke exposed an obsolete schema-6 assertion while the
  application itself reached schema 7 and renderer readiness; the corrected
  schema-7 harness and real packaged smoke both pass; and
- a real materialized AionUI launch from an isolated Actestra profile uses
  exact local `aioncore 0.1.52`, logs both scoped tools, schema 7, zero recovered
  attempts, Adapter v2/Worker v1 completion, AionCore health, window
  ready-to-show, and renderer load. Its SQLite database contains the
  authoritative event, artifact, and checkpoint tables with zero pending
  checkpoints, and termination leaves no Electron, Utility, Worker, or
  AionCore process.

The AionUI startup path performs deterministic recovery after schema version 7
and scoped-tool readiness, before creating the preserved window. No renderer,
route, feature entry, Goose worker, CrewAI sidecar, or Eigent runtime is added.

This real launch diagnoses the installation-incomplete screenshot: the dialog
is the retained AionUi fail-closed state when AionCore is absent or startup is
intentionally failed. The local exact AionCore binary starts successfully when
discoverable. No approved distributable AionCore bundle is committed, so this
is local runtime evidence, not target-package, candidate, release, deployment,
distribution, or user-acceptance evidence.

GW-P4.6 reached
[pull request 14](https://github.com/bignormal/actestra-desktop/pull/14) at
exact final head `4a07eb9db1907ae8fab2613b4cf11a7d2a8cbee4`, passed
[PR CI run 30553454459](https://github.com/bignormal/actestra-desktop/actions/runs/30553454459),
and squash merged as `784191bfc59d71a128ed5d3251db3535f1349e45`.
[Merged-main CI run 30554447144](https://github.com/bignormal/actestra-desktop/actions/runs/30554447144)
passes on that exact merge.
[ADR-0020](architecture/decisions/0020-preserved-aionui-general-work-journey.md)
records the first preserved-AionUI General Work projection: one strict
`/actestra` text intent, main-resolved native workspace context, schema-version-8
atomic Workspace/grant/Task/Session/Worker/content/link registration, a real
supervised General Worker output, redacted status/cancel/Artifact projections,
exact-owner non-persisted native Preview, and prepared-task startup recovery.
Ordinary AionUI sends and retained features remain unchanged.

Accepted GW-P4.6 evidence:

- the complete manual/static review covers the contracts, schema-8 transaction,
  persistence protocol, main-frame bridge, native-context reader, real Worker
  lifecycle, recovery, cancellation, owned Preview, E2E-only driver, renderer
  projection, and packaged AionCore resources. It fixed native fixture identity,
  conversation-limit, grant-revocation, checkpoint/order, artifact/session
  ownership, recovery-version, stale-renderer, message-upsert, cancellation,
  Preview persistence, UTF-8, preload type, smoke-boundary, and packaged
  symlink issues;
- a process-separated message-delivery regression reproduced the final packaged
  recovery failure as `event-mismatch`: a successful Worker operation response
  could arrive before its `task.started`, tool, or terminal events. Success
  responses now form the delivery barrier after the complete ordered event
  batch. The affected 2 root files pass 10 tests with messages deliberately
  delivered on separate turns;
- complete root `bun run check` passes format, zero-warning lint, strict types,
  Electron SQLite, 50 files and 292 tests, the smoke harness, the 67-source
  product boundary, all 1,766 frozen files, the 156-file/49-source-copy
  downstream contract, and the main/persistence/Worker production build;
- materialized native strict TypeScript passes, and the complete native suite
  passes 341 files and 2,634 tests, with 1 file and 5 tests skipped by retained
  upstream configuration;
- the native production build transforms 599 main, 20 preload, and 10,180
  renderer modules and emits distinct persistence-utility and General Worker
  entries;
- the local macOS arm64 package passes 11 afterPack resource checks, contains
  exact `aioncore 0.1.52`, contains the integrity-checked 13-file Hub fallback,
  has no broken symlinks, and passes strict recursive code-sign verification.
  The available Apple Development identity signed this local package;
  notarization was explicitly skipped because notarization credentials are not
  present, so it is not a release;
- packaged target-app smoke passes prepared-task restart recovery, workspace
  grant denial, cancellation, finalized checkpoints, normalized terminal
  events, exact Artifact counts, terminal attempt evidence, foreign keys,
  preserved window/renderer readiness, and process cleanup; and
- the smoke-specific Actestra CLI profile/config links remain absent after the
  run and no Actestra smoke process remains; and
- the GitHub CodeRabbit check selected all 46 changed files and returned
  success, but its Free-plan output contains only a summary and walkthrough:
  there are no line-level comments, submitted reviews, or unresolved threads.
  It is not represented as a complete zero-finding review.

The exact final head, PR CI, squash merge, and merged-main CI close GW-P4.6 as
an accepted implementation slice. The broader representative P4 exit gate
remains pending. No Goose, CrewAI, Eigent runtime, notarized candidate, release,
deployment, distribution, or user acceptance is claimed.

The first representative-file extension is accepted on `main` through pull
request 16. Its implementation branch started from verified `main`
`d32fd6712ea10295af40a4a45833088a9e9b1f95`:

- `/actestra file <bounded instruction>` selects the closed
  `workspace-file-artifact` kind while ordinary `/actestra` remains the
  existing prompt-artifact journey;
- schema version 9 stores the journey kind and migrates every schema-8 row to
  `prompt-artifact`;
- main owns the fixed `actestra-input.txt` read input and two exact request
  identities; that input fixes a 64 KiB invocation maximum aligned to Worker
  transport, so oversized source produces stable `content-too-large` terminal
  evidence before transport;
- the same isolated Worker processes the owned source and returns a strictly
  validated private `result.md` write input whose serialized payload is capped
  at 128 KiB inside the 256 KiB Worker message envelope;
- main stores that write input under its exact owner before the existing
  create-only tool runs; source text and private input remain absent from Core
  events and renderer projections;
- atomic registration discriminates prompt `toolInputReference` authority from
  file `readInputReference` authority, including duplicate and reopen
  persistence; and
- the Artifact remains Actestra-owned and opens through the existing
  non-persisted AionUI Preview.

Complete local evidence for the feature branch:

- complete root `bun run check` exits zero after formatting, zero-warning lint,
  strict TypeScript, the Electron SQLite probe, 50 files and 308 tests, the
  smoke harness, the 67-source product boundary, all 1,766 frozen foundation
  files, the 156-file/49-source-copy downstream contract, and the
  main/persistence/Worker production build;
- materialized native strict TypeScript passes. The new target-app smoke
  contract passes 3 tests, and the complete native suite passes 341 files and
  2,635 tests, with 1 file and 5 tests skipped by retained upstream
  configuration;
- the native production build transforms 599 main, 20 preload, and 10,180
  renderer modules and emits distinct persistence-utility and General Worker
  entries;
- the local packaging command exits zero with output rooted outside the
  Desktop File Provider at
  `/tmp/actestra-p4-file-review.v4sthn/out/mac-arm64/Actestra.app`. Its
  afterPack hook passes 11 bundled-resource checks, exact `aioncore 0.1.52`,
  the integrity-checked 13-extension Hub fallback, no broken symbolic links,
  arm64 identity, and strict recursive code-sign verification. An available
  Apple Development identity signs this local package; notarization is
  explicitly skipped because credentials are absent, so it is not a release;
  and
- packaged target-app smoke exits zero through representative workspace-file
  prepared restart and recovery, exact `result.md` source inclusion,
  workspace-grant denial, cancellation, schema 9, finalized checkpoints,
  normalized terminal events, exact Artifact and attempt evidence, foreign-key
  integrity, preserved window/renderer readiness, and process cleanup. The
  smoke-specific Actestra CLI profile/config links remain absent; and
- the initial complete 36-file CodeRabbit review raised five issues. Four valid
  protocol, registration/persistence, recovery-wording, and privacy-assertion
  issues were remediated; the Worker follow-up timing issue was rejected
  against the ordered response barrier and process test. The first complete
  post-remediation 37-file review raised zero issues. After final evidence
  updates, a second complete 37-file review raised one valid minor closed-set
  wording issue in ADR-0020; it was fixed and documentation checks pass. The
  redundant post-fix confirmation was rate-limited before review with a
  21-minute wait and is not represented as zero-issue evidence.

Pull request 16 reached exact final head
`f19b7dd006cf091aa9c7f1559dd484fdad35f200`, passed
[PR CI run 30567484733](https://github.com/bignormal/actestra-desktop/actions/runs/30567484733),
and squash merged as `2aed0f705bf6f9b3734742c0905c94ac562f501e`.
[Merged-main CI run 30569476160](https://github.com/bignormal/actestra-desktop/actions/runs/30569476160)
passes on that exact merge. The pull request has no submitted reviews or
inline review comments. Its successful Free-plan CodeRabbit result contains a
summary and walkthrough, so it is not represented as line-level review
evidence. GitHub reports no branch-protection rule or matching repository
ruleset for `main`; the merge used the repository's explicit owner-gated PR
discipline and did not bypass a required protection.

The bounded local-research extension is now implemented locally on
`feat/p4-representative-knowledge-work` from exact verified `main`
`2aed0f705bf6f9b3734742c0905c94ac562f501e`:

- `/actestra research <bounded instruction>` selects only
  `local-research-artifact`;
- schema version 10 adds that one exact kind while preserving schema-9 prompt
  and file rows and rejecting arbitrary values;
- main owns a 64 KiB-bounded `actestra-research.txt` read input and the two
  exact request identities;
- the same isolated General Worker turns at most 32 non-empty local evidence
  lines into a private, create-only `research.md` input;
- main persists that input under its exact owner before creating a `file`
  Artifact labeled `Actestra local research brief`;
- normalized Core events and renderer projections exclude source text, while
  the existing exact-owner, non-persisted native Preview exposes only the final
  bounded Markdown;
- duplicate registration, SQLite reopen, and a real persistence-utility reopen
  plus prepared-task recovery retain the research kind and input without
  replaying native workspace context; and
- the target-app smoke contract adds a fixed local-research scenario with
  schema 10, exact output, owned Preview validation, Core-event privacy, and
  process cleanup.

Complete local evidence for the branch:

- complete root `bun run check` exits zero after formatting, zero-warning lint,
  strict TypeScript, the Electron SQLite probe, 50 files and 313 tests, the
  smoke harness, the 67-source product boundary, all 1,766 frozen foundation
  files, the 156-file/49-source-copy downstream contract, and the
  main/persistence/Worker production build;
- materialized native strict TypeScript passes. The complete native suite
  passes 341 files and 2,637 tests, with 1 file and 5 tests skipped by retained
  upstream configuration. Its production build transforms 599 main, 20
  preload, and 10,180 renderer modules;
- the local macOS arm64 package at
  `/tmp/actestra-p4-research.fXes59/out/mac-arm64/Actestra.app` passes 11
  afterPack resource checks, exact `aioncore 0.1.52`, the integrity-checked
  13-extension Hub fallback, all 17 symbolic links without a broken target,
  arm64 identity, and strict recursive code-sign verification. An available
  Apple Development identity signs this local package; notarization is absent
  and Gatekeeper rejection is expected, so it is not a candidate or release;
- packaged target-app smoke exits zero through prepared-task restart and
  recovery, exact `research.md`, exact-owner non-persisted Preview, schema 10,
  normalized-event source privacy, workspace-grant denial, cancellation,
  finalized checkpoints, Artifact and terminal-attempt evidence, and process
  cleanup. The smoke-specific Actestra CLI profile/config links remain absent;
- the complete 24-file CodeRabbit review raised four issues. Two valid test
  issues were fixed: multiline source privacy is now checked per non-empty
  source line, and the invalid-kind migration test uses an independent Task
  identity. Requests to change the Asia/Shanghai work date and to mark the
  already completed packaged smoke pending were rejected as invalid. The two
  affected test files pass 24 tests after remediation; and
- the complete manual review covers the runtime contracts, schema-10
  migration, Worker mode, downstream patch, smoke/check scripts, tests, and
  evidence documents. It found no additional in-scope defect.

Implementation commit `e7f3212f5978d69eb0afeaa140ddf9dcedf2414f` and
evidence head `5694865462f7209ad413b2cd1dbe2eef0fe955bc` reached Ready
[pull request 17](https://github.com/bignormal/actestra-desktop/pull/17).
The initial and final exact heads pass PR CI runs
[30577349875](https://github.com/bignormal/actestra-desktop/actions/runs/30577349875)
and
[30577647392](https://github.com/bignormal/actestra-desktop/actions/runs/30577647392).
The pull request squash merged as
`779880f28106aa8423ba042de5a6a3264bc0452e`; exact merged-main
[CI run 30577886631](https://github.com/bignormal/actestra-desktop/actions/runs/30577886631)
passes. The remote CodeRabbit run selected all 24 files but was rate-limited
before review, so its successful status is limit handling rather than remote
review evidence. There are no submitted reviews or inline comments. GitHub
reported no branch-protection rule or repository ruleset for `main`; the merge
followed explicit owner-gated PR discipline.

[ADR-0021](architecture/decisions/0021-bounded-writing-artifact-journey.md)
accepts the next independent writing slice on
`feat/p4-writing-journey` from exact verified main
`779880f28106aa8423ba042de5a6a3264bc0452e`. It adds one closed
`/actestra write` intent, schema 11 `writing-artifact`, a structured prompt
brief, a Worker-authored private create-only input, `document` Artifact, and
owned non-persisted `draft.md` Preview. Writing registration persists only the
prompt reference; main persists the real Worker-authored write input under its
exact owner before invoking the accepted create-only tool. Prepared restart
recovery uses the durable brief and does not re-read native workspace state.

Complete local evidence for writing implementation commit
`3e9d57407207ee8718fea2ed127a85dbab4daad8`:

- the post-review affected root set passes 7 files and 74 tests; complete `bun
run check` passes formatting, zero-warning lint, strict TypeScript, Electron
  SQLite, 50 files and 325 tests, the smoke harness, the 68-source product
  boundary, all 1,766 frozen foundation files, the 157-file/50-source-copy
  downstream contract with 4 R0 invariants, and the three-entry production
  build;
- materialized native strict TypeScript, the focused 4-file/9-test set, and the
  complete native suite pass. The complete suite reports 341 files and 2,639
  tests passed, with 1 file and 5 tests skipped by retained upstream
  configuration. The production build transforms 600 main, 21 preload, and
  10,181 renderer modules;
- the local macOS arm64 package at
  `/tmp/actestra-p4-writing-reviewed.8JgbPo/out/mac-arm64/Actestra.app` passes 11
  bundled-resource checks, exact `aioncore 0.1.52`, 13 manifest-size and
  ZIP-structure-checked Hub fallback archives, 17 valid symbolic links, arm64
  identity, and strict recursive code-sign verification. The reviewed package
  explicitly uses the local ad-hoc path after an earlier Apple Development
  attempt could not reach the external timestamp service; Gatekeeper rejects
  it with status 3 as expected. It is not notarized, a candidate, or a release;
  and
- actual packaged target-app smoke exits zero through schema-11 writing
  prepare/recover, prompt-only prepared authority, exact `document` Artifact,
  `draft.md`, owned non-persisted Preview, private draft/event/audit privacy,
  representative-file restart, local research, denial, cancellation, terminal
  evidence, and process cleanup. No smoke process, temporary smoke root, or
  smoke-specific global Actestra profile/config link remains.

The complete manual review covers all 33 current files and fixed the
writing-command Unicode-separator trim boundary plus one stale schema-10 status
statement. The initial complete CodeRabbit pass covered tracked and untracked
files, raised two valid contract/documentation issues and one invalid request
to change the Asia/Shanghai date, and led to the schema-11 recovery and
U+2028/U+2029 validation fixes. The final 31-tracked-file CodeRabbit
confirmation raised one valid Worker-attempt poisoning issue; a red-green
regression now proves that an invalid writing brief cannot consume the process.
That final run did not list the two untracked files, and no redundant post-fix
zero-issue run was performed, so it is not represented as a complete
zero-finding review.

Documentation links pass across 54 Markdown files, Markdown lint reports zero
issues across 48 files, and `git diff --check` passes on this evidence update.
The implementation commit was followed by exact Ready PR head
`2febf25e80868fac51fb7b37fffb746d10f8edde` on
[pull request 18](https://github.com/bignormal/actestra-desktop/pull/18).
[PR CI run 30585829619](https://github.com/bignormal/actestra-desktop/actions/runs/30585829619)
passes. The PR squash merged as
`d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2`; exact merged-main
[CI run 30586015008](https://github.com/bignormal/actestra-desktop/actions/runs/30586015008)
passes. The Ready PR's CodeRabbit Free result selected all 33 files but
contains only a summary and walkthrough, with no submitted review or inline
comment; it is not represented as line-level review evidence. This local
package and smoke do not claim notarization, candidate, release, distribution,
or user acceptance.

[ADR-0022](architecture/decisions/0022-bounded-office-document-artifact-journey.md)
accepts the independent Office-document slice, developed on
[pull request 19](https://github.com/bignormal/actestra-desktop/pull/19) from
exact verified main `d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2` and now
accepted on `main`:

- `/actestra office` selects only `office-document-artifact` and validates one
  exact ordered Document, Owner, Summary, and one-through-six Section brief;
- schema version 12 adds that one exact kind and the bounded Office Preview
  media type while preserving all existing journey rows and content ownership;
- the same isolated General Worker derives a private versioned document model
  from the already persisted brief without reading the workspace;
- main persists that model under the exact request owner before invoking the
  third closed scoped capability,
  `actestra.task-output.write-office-document`;
- the create-only Electron-main writer fixes `brief.docx`, creates a real
  ZIP/OOXML package with pinned `docx@9.6.1`, and binds a `document` Artifact
  labeled `Actestra Office document`; and
- the retained AionUI Word Preview receives only the exact-owner bounded model
  with `persist: false`. No DOCX bytes, output path, root, content reference,
  Worker handle, or document-generation authority enters the renderer.

Current Office local evidence:

- `bun run downstream:aionui:check` passes 163 declared files, 4 R0
  invariants, and 52 reviewed source copies; exact downstream install completes
  with 3,177 packages;
- the final complete root gate passes 50 files/338 tests and the complete
  materialized native suite passes 343 files/2,644 tests, with the retained
  upstream skips. The final manual review found that the shared output-media
  union let the existing text writer accept the new Office Preview type. A
  focused red run failed 1 of 8 assertions, the text writer was narrowed to
  plain text and Markdown, and the green run passes 8/8 with strict root
  TypeScript. The complete root gate, final native strict TypeScript, native
  suite, and native production build all pass from those bytes. The build
  transforms 602 main, 22 preload, and 10,182 renderer modules;
- `/tmp/actestra-p4-office-stable-final.Symazz/out/mac-arm64/Actestra.app`
  is rebuilt from that exact production output and passes 11 bundled-resource
  checks, contains both required Electron notices, exact `aioncore 0.1.52`,
  13/13 integrity-matching and ZIP-valid Hub fallbacks pinned locally to commit
  `63952fa23897184e03e67a97664f9a901ab2266b`, 17 valid symbolic links, the six
  exact native application entries, and the packaged `docx@9.6.1` MIT license.
  The six packaged application entries match the final production-output
  SHA-256 values. Strict recursive verification passes for the local Apple
  Development signature with Team ID `7H3BA9HTRK`; notarization is absent; and
- real packaged target-app smoke passes schema-12 Office prepare/recover, a
  real `brief.docx` with required OOXML entries, exact `document` Artifact,
  owned Word Preview, Core-event and metadata-audit privacy, accepted
  file/writing/research/denial/cancellation evidence, and complete temporary
  root, CLI-link, and process cleanup.

One intermediate signed package was rejected before smoke because a moving-tag
Hub download mixed mirrors and only 9/13 ZIPs matched the downloaded index.
The final package uses the previously verified 13/13 local resource set and
passes the independent integrity gate above. The earlier complete 42-file
CodeRabbit review found only an invalid request to use the prior UTC date. The
final stable-input 43-file review then raised two valid architecture-wording
issues: schema-12 ownership did not explicitly name prompt-only Office
registration, and persisted canonical document authority was not clearly
distinguished from the non-persisted renderer projection. Both were fixed in
the system overview and ADR-0022; the complete post-remediation 43-file
CodeRabbit review raised zero issues. The complete manual review found and
closed the text-writer media-type defect described above. Final documentation,
link, range, secret, binary, generated-output, and staged-scope audits then
passed. The exact 43-file implementation commit
`7df1c17db31c0ab76c2ecf33d0f4c87cfd3c7d5f` was pushed to Ready PR 19. Its
successful CodeRabbit Free status contains only a summary and walkthrough,
with no submitted review or inline comment, so it is not represented as
line-level review evidence.

Initial exact-head
[PR CI run 30601752177](https://github.com/bignormal/actestra-desktop/actions/runs/30601752177)
passes source, root tests, documentation, native install and strict TypeScript,
identity and isolation tests, native production build, unsigned bundle, and
package verification, then fails only the legacy clean-profile packaged smoke.
The packaged application reports persistence schema 12 while
`scripts/smoke-packaged-app.mjs` still expects schema 11. A focused red-green
follow-up makes the smoke harness require schema 12, updates only that stale
expectation, and passes the two-file format and zero-warning lint checks. A
fresh root production build, unsigned directory bundle, and local legacy
clean-profile smoke then pass with SQLite schema 12.

That follow-up was committed and pushed as exact head
`0b8b40a68bad68d6a9d06f202eeb85cb019afbfa`.
[PR CI run 30602422431](https://github.com/bignormal/actestra-desktop/actions/runs/30602422431)
passes every step, including the corrected schema-12 clean-profile packaged
smoke. A local CodeRabbit CLI review of the three follow-up files raised zero
issues. The remote incremental review selected the same three files but was
rate-limited for 43 minutes before it started, so the successful remote status
remains summary/walkthrough evidence only and is not a line-level review. The
status-only evidence update changed no implementation input and produced exact
final PR head `091f786d57c6b4569cdaac17ea969a0b9070ea02`.
[Final PR CI run 30602624426](https://github.com/bignormal/actestra-desktop/actions/runs/30602624426)
passes on that head. PR 19 has no submitted reviews or inline comments; its
successful CodeRabbit Free status contains only a summary and walkthrough.
The PR squash merged as
`505afb2f3916e75c7abb07cdf461bda29a602b9b`; exact merged-main
[CI run 30602821085](https://github.com/bignormal/actestra-desktop/actions/runs/30602821085)
passes.

[ADR-0023](architecture/decisions/0023-actestra-owned-scheduled-general-work.md)
governs the bounded schedule slice accepted on `main` through Ready
[pull request 20](https://github.com/bignormal/actestra-desktop/pull/20) from
exact verified Office merge
`505afb2f3916e75c7abb07cdf461bda29a602b9b`. The PR reached exact final head
`c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, passed
[PR CI run 30659567604](https://github.com/bignormal/actestra-desktop/actions/runs/30659567604),
and squash merged as `5b0748af674165f9e9475be61dc1e02a1b08c8bc`.
[Merged-main CI run 30660078199](https://github.com/bignormal/actestra-desktop/actions/runs/30660078199)
passes on that exact merge. The slice retains the native `/scheduled` routes,
dialog,
detail/history, status, pause, run-now, delete, and `ipcBridge.cron` DTOs while
assigning schema-13 job/grant state, timers, atomic run claims,
missed/interrupted recovery, and existing-conversation `/actestra` execution
to Actestra main/Core.

Pre-review local schedule baseline evidence:

- focused schedule contract, migration, persistence, service, bridge, native
  overlay, and smoke-harness tests pass through their final red-green cycles;
- complete root `bun run check` passed formatting, zero-warning lint, strict
  TypeScript, Electron SQLite, 56 files and 414 tests, smoke and authority
  boundaries, the frozen foundation, downstream contract, and production
  build;
- materialized native strict TypeScript passed, and the complete native suite
  passed 345 files and 2,658 tests with only the retained upstream skips;
- the pre-review native production build transformed 606 main, 26 preload, and
  10,186 renderer modules while keeping separate persistence-utility and
  General Worker entries;
- `/private/tmp/actestra-p4-schedule-final.jkpuxg/out/mac-arm64/Actestra.app`
  passed the independent package verifier, both Electron notices, exact
  `aioncore 0.1.52`, all 13 integrity- and ZIP-verified Hub fallbacks, bundled
  Croner and license checks, arm64 identity, and strict recursive Apple
  Development signature verification with Team ID `7H3BA9HTRK`; and
- that pre-review package's target-app smoke passed schema-13 create, restart, list,
  run-now, missed and interrupted recovery, terminal Task/Attempt/Artifact
  evidence, schedule privacy, the accepted file, research, writing, Office,
  denial, and cancellation journeys, plus complete temporary-root, link, and
  process cleanup.

One earlier pre-review package smoke retained a root after the renderer provider
could not discover the transient backend port. A subsequent unchanged-package
run completed the full smoke and removed its temporary root as designed. That
earlier failure is not pass evidence, and the successful run does not turn the
local package into a candidate or release.

The first formal 50-file CodeRabbit review raised 12 issues: 4 Major and 8
Minor. Valid concerns covered status wording, controlled canonical-path tests,
pre-provider queue/retry rejection, Task-correlated journey failures, complete
graph identity validation before terminal projection, and preserving an
occurrence exactly at `now`. Each behavior fix followed a focused RED-to-GREEN
cycle. The affected 4-file run passes 77 tests, the additional compatibility
bridge file passes 4 tests, zero-warning lint passes on the 8 changed code/test
files, and strict root TypeScript passes. Requests to forbid ADR-0023's empty
manual cron expression, change the explicit 501 Skill routes, skip fail-closed
recovery on identity derivation failure, or add a duplicate transient
`recovery-blocked` event were rejected against the accepted contract and
durable interrupted state.

The second 50-file remediation review raised 8 issues (5 Major, 3 Minor); its
valid items are included in the focused results above. The third confirmation
raised 4 issues (3 Major, 1 Minor): both documentation corrections are applied,
while the empty manual cron and explicit unsupported Skill changes are rejected
by ADR-0023. The fourth confirmation raised 3 issues (1 Major, 2 Minor). The
closed protocol now has an explicit unknown-operation rejection test and this
status wording is corrected. The request to authorize native AionUI workspaces
against a pre-existing Actestra registry or Git worktree set is rejected:
ADR-0020 makes the validated native workspace selection the initial authority,
ADR-0023 atomically captures its canonical root in an Actestra grant, and Git
worktrees remain the later P5 coding boundary. All fourth-pass issues therefore
have an explicit fix or accepted-decision disposition. Two follow-up
final-input confirmations were rejected before analysis by CodeRabbit's
organization rate limit (`waitTime` first 3 minutes, then 31 seconds); neither
is zero-issue review evidence. The complete manual 51-file review includes the
Node-free schedule contract split, its corrected downstream-owner assertion,
and no additional confirmed defect. The external CLI needs an assigned/linked
organization seat or Agentic API key before another confirmation can run.

Final-byte local evidence now proves the current input:

- focused RED-to-GREEN checks prove that public renderer General Work cannot
  reserve `schedule-aionui-*` submission identities and that native-context
  canonicalization rejects control-bearing names and invalid canonical paths;
- final root `bun run check` passes formatting, zero-warning lint, strict
  TypeScript, Electron SQLite, 56 files and 424 tests, smoke and authority
  boundaries, the exact frozen foundation, the 177-file downstream contract,
  and the 56/3/28-module root production build. An initial final run exposed a
  stale downstream assertion after the Node-free contract split; the focused
  check passed after moving that assertion to the actual owner, and the
  complete final run then exited zero;
- the exact 3,177-package materialization, Electron 37.10.3 arm64
  `better-sqlite3` source rebuild, strict native TypeScript, and complete native
  suite pass 345 files and 2,658 tests with 1 file and 5 retained upstream tests
  skipped. The native production build transforms 607 main, 24 preload, and
  10,184 renderer modules;
- `/private/tmp/actestra-p4-schedule-final-byte.54REpE/out/mac-arm64/Actestra.app`
  passes the independent package verifier, exact production-entry ASAR hashes,
  both Electron notices, exact `aioncore 0.1.52`, all 13 manifest-, size-, and
  ZIP-verified Hub fallbacks, bundled docx and Croner notices, 17 valid symbolic
  links, and strict recursive Apple Development signing for all 26 arm64 Mach-O
  files with Team ID `7H3BA9HTRK`; and
- that exact new package passes the schema-13 target-app schedule smoke through
  restart, run-now, missed/interrupted recovery, retained file, research,
  writing, Office, denial, and cancellation journeys, terminal
  Task/Attempt/Artifact evidence, metadata privacy, and complete smoke-root and
  process cleanup.

The new package has an Apple Development signature but no notarization and is
only disposable local evidence. The schedule implementation first reached
Ready PR 20 as `70b11992f4de015e0952d482a126cd1270208aa8`. Initial exact-head
[PR CI run 30657973409](https://github.com/bignormal/actestra-desktop/actions/runs/30657973409)
passes the root gate, documentation, materialized install and strict TypeScript,
selected native tests, native production build, and bundle creation, then fails
the package verifier with `packaged module is missing: out/preload/index.js`.
The smoke step is skipped.

Root-cause tracing proves that the workflow packages the legacy root `out/`
after building the materialized application: that root build emits
`out/preload/index.cjs` and has no scheduled-provider graph, while the target
native build emits `out/preload/index.js`, the isolated Actestra utility entries,
and the schema-13 schedule provider. The unchanged strict verifier passes when
pointed at the generated native app. A focused RED-to-GREEN smoke-harness
contract requires CI to package inside `.actestra/aionui-v2.1.41`, verify that
exact app, and run the schema-13 target-app smoke. The remediation's full root
`bun run check` exits zero with the same 56 files/424 tests and 56/3/28
production build. It reached exact final PR head
`c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`; PR CI 30659567604 passes the
complete native package and clean-profile smoke path. PR 20 has no submitted
review or review thread. Its CodeRabbit Free status and comment are explicitly
rate-limited summary/walkthrough output, not line-level review evidence. The PR
squash merged as `5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and exact
merged-main CI 30660078199 passes.

The representative tool-failure slice is accepted on `main` through Ready
[pull request 22](https://github.com/bignormal/actestra-desktop/pull/22). It
started from exact verified `main`
`3d8d697a6416176d90183f671da28347bb194553`; exact implementation commit
`fd5524c7f0485923b2aa765df95b5ef0b14187e7` contains only the 15 reviewed
files. The PR reached exact final head
`077f30bcfa3929959c971d08081092bbf976e2ee`, passed
[PR CI run 30673687603](https://github.com/bignormal/actestra-desktop/actions/runs/30673687603),
and squash merged as `c7c414c0c5a126b276fb02b372e02fff437e5f23`.
[Merged-main CI run 30673919260](https://github.com/bignormal/actestra-desktop/actions/runs/30673919260)
passes on that exact merge. The slice keeps the existing workspace-file user
journey and deliberately exceeds its main-owned 64 KiB read bound. The scoped
read fails as `content-too-large`; Actestra remains authoritative for the one
Task, Session, Worker, Attempt, policy result, audit sequence, normalized event
stream, finalized checkpoint, and restart projection. No output Artifact or
second execution is created.

Focused RED-to-GREEN evidence first exposed and fixed missing terminal Attempt
incident evidence when the failed tool and final `task.failed` code match. A
real target-app run then exposed an external smoke-harness comparison between a
canonical `/private/var/...` workspace grant and its `/var/...` test alias. A
second RED-to-GREEN change now compares the canonical root and checks both path
forms for privacy leakage; it changes no packaged application byte.

Current final-local evidence for the exact implementation input:

- final root `bun run check` passes formatting, zero-warning lint, strict
  TypeScript, Electron SQLite 3.50.4 under Electron 37.10.3, 56 files and 425
  tests, smoke and authority boundaries, the unchanged 1,766-file foundation,
  the 177-file downstream overlay, and the 56/3/28-module production build;
- the exact 3,177-package materialization and arm64 Electron native dependency
  rebuild pass strict native TypeScript, the focused 10-test native smoke file,
  and the complete native suite at 345 files/2,662 tests with the retained one
  file/five-test upstream skips; the native production build transforms 607
  main, 24 preload, and 10,184 renderer modules;
- `/private/tmp/actestra-p4-tool-failure-pinned-local-electron.IUrN6a/out/mac-arm64/Actestra.app`
  passes the independent package verifier, 4/4 exact production-entry ASAR
  hashes, Electron/docx/Croner notices, exact `aioncore 0.1.52`, all 13 Hub
  fallbacks as 14/14 exact Git blobs and 13/13 valid ZIPs at pin
  `63952fa23897184e03e67a97664f9a901ab2266b`, 17 contained symbolic links,
  and strict Apple Development signing for all 25 actual arm64 Mach-O files
  with Team ID `7H3BA9HTRK`; and
- that exact package passes the schema-13 target-app smoke through existing
  schedule and retained journeys plus first-run `content-too-large` failure,
  stable restart projection, one unchanged Task/Session/Worker/Attempt,
  metadata privacy, zero unexpected Artifact, and complete process cleanup.

The first post-review package was rejected because its moving `dist-latest`
input contained only seven Hub extensions and did not match the accepted
fallback pin. The final package above reuses the already verified static
13-file set from exact AionHub commit `63952fa23897184e03e67a97664f9a901ab2266b`
and was rebuilt from the unchanged final production output with local Electron
37.10.3 arm64 bytes. The fresh pinned-package smoke wrapper is
`/private/tmp/actestra-p4-tool-failure-smoke-wrapper-pinned.WZdkNW`.

The complete manual review covers all 15 tracked files. It fixed fail-closed
terminal evidence validation when a Supervisor incident already exists,
corrected stale schedule truth in the architecture documents, and strengthened
the target-app smoke's Workspace and Task/Session/Worker/Attempt identity
chain; no additional confirmed defect remains. PR 22 has no submitted review
or inline comment. CodeRabbit was rate-limited before formal review and emitted
only its Free summary and walkthrough, so the successful status is not
line-level review evidence and was not manually retried. The exact 15-file
scope, high-confidence secret, binary/generated-output, tracked-document,
frozen-foundation, user-copy, and process-cleanup audits pass. The exact final
PR-head CI, squash merge, and merged-main CI above close this slice as accepted
implementation evidence. The package remains disposable local Apple
Development-signed evidence only; it is not notarized and is not a candidate,
release, distribution, deployment, user acceptance, Goose, CrewAI, or Eigent
runtime. The separate Worker-crash/recovery slice is accepted on `main` as
recorded below, completing the P4 exit evidence.

The Worker-crash/recovery reliability slice starts from exact verified `main`
and `origin/main` `df3fd3cd27f034cd900e2528adf8af9b87f7ee40`; exact
[main CI run 30674966106](https://github.com/bignormal/actestra-desktop/actions/runs/30674966106)
passes on that base. Exact implementation commit
`47ed445eab204c0998e44167455c062600158dd3` on
`feat/p4-worker-crash-recovery` adds no schema, renderer bridge, tool, path,
credential, schedule, or production crash-control authority. The generic
coordinator keeps retryable crashes blocked; only the preserved AionUI
no-replacement journey requires canonical `worker.failed`, appends the exact
terminal tail `task.updated -> worker.failed -> task.failed`, and persists a
failed Task/Session with crashed Worker/Attempt and the same
`worker-process-exit` incident. Finalized restart projects that state without
relaunch or cancellation, and missing canonical failure evidence fails closed
as `event-mismatch`.

Final stable local evidence passes the complete root gate at 56 files/427
tests, the materialized native gate at 345 files/2,665 tests with the retained
1 file/5 tests skipped, and native production builds of 607 main, 24 preload,
and 10,184 renderer modules. The fresh local macOS arm64 directory package at
`/private/tmp/actestra-p4-worker-crash-final.J8Jw8M/out/mac-arm64/Actestra.app`
passes the package verifier, strict recursive signature, 4/4 ASAR, 14/14 Hub
Git blob, 13/13 ZIP, 17/17 symlink, and exact AionCore `0.1.52` checks. Its
`app.asar` SHA-256 is
`d42a03d2ea06e0bbf85b797a70ec730a4a125bad0fd8c66ff0b8a03d2a82a534`.

The final external target-app smoke identifies only a descendant Electron
NodeService with exact environment role
`ACTESTRA_UTILITY_ROLE=general-worker`, waits for the native window,
renderer/provider, and managed-runtime readiness markers, sends that process
`SIGKILL`, and proves the unchanged Core-owned authority snapshot after
restart. It also retains the accepted schema-13 schedule, representative file,
tool-failure, writing, Office, research, denial, cancellation, privacy, and
cleanup evidence. The package has an Apple Development signature only; it is
not notarized, a candidate, release, distribution, deployment, or user
acceptance. The complete 14-file manual review found no remaining confirmed
defect. Exact allowlist, high-confidence secret, binary/generated/package,
mode, staged-scope, frozen-foundation, 48-visible/8-ignored user-copy, package-
hash, signature, and process-cleanup audits pass. The standing CodeRabbit rate
limit was not manually retried and supplies no formal line-level review
evidence for this slice. The exact implementation commit contains all 14
reviewed files. [Ready pull request 24](https://github.com/bignormal/actestra-desktop/pull/24)
reached exact final head `3593fac8db48a0cb149bb6c736374eeaccebe332`, passed
[PR CI run 30687199671](https://github.com/bignormal/actestra-desktop/actions/runs/30687199671),
and squash merged as `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`.
[Merged-main CI run 30687433298](https://github.com/bignormal/actestra-desktop/actions/runs/30687433298)
passes on that exact merge. PR 24 has no submitted review or inline thread;
its automatic CodeRabbit request selected all 14 files but was rate-limited
before review, so the successful status is not line-level review evidence.
The completed manual review, exact scope audits, exact-head PR CI, squash
merge, and merged-main CI accept Worker-crash/recovery and close the P4 phase
gate. They do not establish notarization, release, distribution, deployment,
or user acceptance.

F0 implementation commit
`13270ca0abd7353710541afca9ddf46c47670be3` first established the preserved
foundation on
[pull request 6](https://github.com/bignormal/actestra-desktop/pull/6), which
subsequently merged through the exact final head recorded above. Its early
exact-head
[CI run 30392140461](https://github.com/bignormal/actestra-desktop/actions/runs/30392140461)
passes the macOS arm64 foundation job, including source, tests, boundaries,
documentation, unsigned legacy-harness package, packaged identity, and
clean-profile smoke.

Current F0 evidence:

- exact AionUi `v2.1.41` commit
  `2d8925fc67a97a20996fadcd2a0862b778b572ba` imported as an unmodified
  1,766-file runnable desktop source snapshot;
- source manifest SHA-256
  `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`;
- direct comparison to a clean exact-commit checkout passes all 1,766 selected
  file hashes and confirms complete `packages`, `public`, `patches`, `tests`,
  and `examples` subtrees;
- machine preservation check passes every file hash, all 27 native routes, and
  all 41 functional bridge domains;
- frozen dependency install and native production build pass;
- native Electron launch passes in an isolated profile and displays the
  original Guide, navigation, agent/model selector, assistants, schedules,
  Team, Settings, composer, workspace, and suggestion experience;
- after restoring one exact upstream workflow fixture omitted by the initial
  archive selection, the complete native rerun passes 321 files with 1 skipped
  and 2,576 tests with 5 skipped; there are 0 failures.

Current F1 implementation and evidence:

- a reviewable downstream overlay materializes Actestra from the exact frozen
  AionUi source without editing the 1,766-file foundation;
- the overlay checker passes 64 declared changed files and 4 protected R0
  layout/bridge files;
- the real AionUi routes, layout, Guide, feature entries, and bridge surface
  remain; product identity, icons, application ID, executable, protocol,
  repository, and release links are Actestra-owned;
- a fresh versioned Actestra profile is created independently from native
  AionUi data with `0700` directories and a `0600` manifest;
- telemetry, updates, feedback uploads, known upstream official services, and
  public listeners are disabled by default without deleting their UI entries;
- strict types, 12 focused F1/retained-provider files with 120 tests, 323
  complete native files with 2,585 passing tests, and native production build
  pass;
- a real downstream Electron launch shows the preserved AionUi desktop
  structure with the Actestra title and wordmark;
- the runtime listener snapshot is loopback-only and the settled process tree
  has no non-loopback established socket or official-service log match.
- implementation commit
  `836a9f1f81687f091e1c5b92ce30bff167e9da4f` and resource-only CI
  remediation `462a1b0d920279d42f124fdd28673d77dc55b765` are pushed;
- exact implementation
  [CI run 30417692550](https://github.com/bignormal/actestra-desktop/actions/runs/30417692550)
  passes root checks, documentation links, materialization and install,
  TypeScript, 120 focused tests, native production build, unsigned bundle,
  packaged identity boundary, and clean-profile smoke.

Detailed implementation and non-claim evidence is recorded in
[AionUi F1 Identity and Isolation](product/AIONUI_F1_IDENTITY_ISOLATION.md).
F1 implementation is CI-backed and merged through pull request 6. Candidate,
release, distribution, and acceptance remain separate gates.

Current F2 implementation and evidence:

- native conversation, task, provider, workspace, approval, artifact, and
  runtime shapes are collected through strict contract version 1;
- the existing AionUi HTTP and WebSocket adapter publishes recognized metadata
  through one fire-and-forget preload operation while returning every native
  response and event payload unchanged;
- main validates and hashes native identity, derives valid P3 domain graphs and
  task event streams, and appends only metadata-only SQLite schema version 4
  shadow evidence;
- raw native identifiers, titles, descriptions, prompts, messages, filenames,
  workspace paths, approval descriptions, artifact payloads, credentials, and
  arbitrary diagnostics are absent from durable evidence;
- shadow writes remain separate from authoritative P3 workspace, task, session,
  worker, approval, artifact, and core-event tables;
- duplicate evidence is idempotent, sequence remains gapless after restart,
  canonical-to-index corruption fails closed, and projection or persistence
  failure returns a bounded rejection without changing native UI state;
- the downstream checker passes 83 declared changed files, 4 byte-identical R0
  invariant files, and 13 reviewed root-to-downstream source copies;
- root focused tests pass 4 files and 18 tests; the complete root check passes
  27 files and 141 tests; downstream focused tests pass 5 files and 14 tests;
- the complete native suite passes 326 files with 1 skipped and 2,590 tests
  with 5 skipped; the native production build passes with 558 main, 6 preload,
  and 10,162 renderer modules;
- an isolated real Electron run proves append, restart duplicate, ordered task
  events, invalid-field rejection, and unchanged Guide UI;
- one actual native conversation was created and displayed through the existing
  Guide read path, which automatically appended shadow sequence 3 without
  persisting its raw identifier, title, or workspace path; the native fixture
  was then deleted and the isolated profile and workspace moved to Trash.

Detailed implementation, authority, rollback, automated, and live evidence is
recorded in
[AionUi F2 Shadow Projection](product/AIONUI_F2_SHADOW_PROJECTION.md) and
[ADR-0011](architecture/decisions/0011-aionui-shadow-projection.md).
Implementation commit
`632573fa03c34fdb789c85d8efc1ce1e0f8e8177` and packaged-boundary
remediation `1478726d62302fa885525024eb4839af5e98b4dd` are pushed.
[Exact-head CI run 30421351204](https://github.com/bignormal/actestra-desktop/actions/runs/30421351204)
passes root checks, documentation, downstream materialization and install,
strict types, 14 focused tests, native production build, unsigned bundle,
packaged identity and product boundary, and clean-profile smoke.

Current F3.1 implementation and evidence:

- the existing AionUi renderer permission cards, ACP options, pet confirmation
  window, HTTP bridge shape, and native confirmation endpoint remain the
  functional UI and compatibility contract;
- Electron desktop confirmation responses enter one fixed
  `actestra:approval-decide-v1` preload operation; main accepts only the current
  window's current main frame and the pet window calls the same service
  directly;
- exact route, keys, identifiers, JSON structure, and body size are bounded;
  explicit choices classify as approved, denied, or cancelled while opaque ACP
  option IDs remain `selected` instead of being guessed as approval;
- SQLite schema version 5 reserves the immutable response and
  `pending-delivery` outbox state before local native delivery;
- exact duplicates are idempotent, changed responses conflict, and a prior or
  failed attempt checks the native pending list before any redelivery;
- startup reconciles a bounded pending set; loopback transport is restricted to
  `127.0.0.1`, has a 10-second timeout and 64 KiB response bound, and maps
  structured native status while redacting bounded details;
- `ACTESTRA_APPROVAL_AUTHORITY=0` is the only runtime native fallback.
  Persistence or reconciliation failure otherwise fails closed;
- the forward version 4 to 5 migration preserves F2 rows. Rollback leaves
  version 5 rows inert and does not edit the frozen source or native profile;
- the overlay checker declares 93 changed files, 4 byte-identical R0 invariant
  files, and 15 reviewed root-to-downstream source copies.
- focused root migration and F3 tests pass 4 files and 20 tests; the complete
  root check passes 30 files and 153 tests, the Electron SQLite probe,
  three-scenario process smoke, 40-source product boundary, frozen and
  downstream checks, and production build;
- focused materialized F2/F3 tests pass 6 files and 15 tests; strict TypeScript
  passes; the complete native suite passes 330 files with 1 skipped and 2,602
  tests with 5 skipped;
- the materialized native production build passes with 563 main, 7 preload,
  and 10,163 renderer modules;
- an isolated real Electron run preserves the Guide UI, returns the exact
  native structured error through the new authority, proves schema version 5
  persisted first, preserves attempt count 1 after restart reconciliation
  cannot verify pending state, and proves the rollback switch returns
  `native-fallback` without creating another row.
- implementation commit
  `cf61ffb8453a888cdc03f73457ebeaf72708511a` is pushed;
- exact implementation
  [CI run 30425061316](https://github.com/bignormal/actestra-desktop/actions/runs/30425061316)
  passes root checks, documentation, downstream materialization and install,
  strict types, native production build, unsigned bundle, packaged identity
  and product boundary, and clean-profile smoke.

Detailed authority, migration, rollback, error, and non-claim evidence is in
[AionUi F3.1 Approval Decision Authority](product/AIONUI_F3_APPROVAL_AUTHORITY.md)
and
[ADR-0012](architecture/decisions/0012-aionui-approval-decision-authority.md).
F3.1 owns only the desktop response and delivery record. Pending-request
creation, provider semantics, protected-operation execution, P3 policy/audit
release, and headless WebUI authority remain outside this slice.

Current F3.2 implementation and local evidence:

- the already persisted F3.1 confirmation response is the only protected
  operation entering the accepted P3 privileged gateway;
- the fixed capability is `aionui-approval-delivery-v1` with
  `network.request` against `external-service`; renderer input cannot select a
  different tool, action, resource, policy, credential, or executor;
- deterministic policy evaluation and an in-memory policy authorization grant
  run before native delivery; no second user prompt or replacement approval UI
  is introduced;
- `policy.evaluated`, `tool.started`, and terminal `tool.completed` or
  `tool.failed` evidence are written through the existing durable metadata-only
  audit path;
- compatibility-scoped hashes replace raw native request and response
  identifiers in audit evidence. Response bodies, approval descriptions,
  workspace paths, credentials, and arbitrary native diagnostics are not
  audited;
- native structured rejection remains the F3.1 compatibility result only when
  its terminal failure evidence commits. Failure after execution but before
  outcome audit remains uncertain and is not converted into a retryable native
  rejection;
- pending-list reconciliation remains a bounded retained native read and does
  not invent protected-operation semantics for an unknown upstream tool;
- no schema or renderer change is required. The explicit rollback switch
  `ACTESTRA_APPROVAL_POLICY_GATE=0` restores the accepted F3.1 delivery path;
- targeted local verification passes 7 root policy-gate tests and the
  six-file/44-test F3/P3 compatibility set;
- the complete root gate passes 32 files and 171 tests, Electron SQLite,
  process smoke, the 41-source product boundary, frozen/downstream checks, and
  production build;
- the 102-file downstream declaration, four R0 invariants, and 21 reviewed
  source copies pass; materialized strict TypeScript and the four-file/10-test
  focused integration set pass;
- the complete materialized native suite passes 331 files with 1 skipped and
  2,607 tests with 5 skipped; production build passes with 569 main, 7 preload,
  and 10,163 renderer modules;
- unsigned legacy-harness packaging, packaged identity/product boundary, and
  clean-profile application/window/renderer smoke pass as regression evidence.

Detailed scope, sequence, rollback, and non-claims are recorded in
[AionUi F3.2 Approval Delivery Policy Gate](product/AIONUI_F3_APPROVAL_POLICY_GATE.md)
and
[ADR-0013](architecture/decisions/0013-aionui-approval-delivery-policy-gate.md).
Implementation `20e3c0fcada0d072fc35820d43b85c953bf93929` is pushed on
PR 7, and exact implementation CI run 30437387097 passes the root,
documentation, materialized AionUi, unsigned bundle, package-boundary, and
clean-profile smoke gates. A local CodeRabbit review raised three valid
documentation issues; all were fixed, and the 23-file follow-up completed with
zero issues. Final PR head `df821ca203bea7b611fa8fb8092d00a16cabe578`
passed CI run 30437723459. The Ready-triggered GitHub CodeRabbit walkthrough
selected all 23 files and completed successfully with no submitted review or
inline comment; it is not independent approval evidence. PR 7 squash merged as
`ce19dbe072328e16dcdaf116b8199d5502cb44c6`, and exact main CI run
30442166290 passed. Candidate, release, distribution, live F3.2 desktop proof,
and acceptance remain separate gates.

Current F3.3 implementation and local evidence:

- only schema version 5 `pending-delivery` decisions with a prior delivery
  attempt can enter the new reconciliation gate;
- the fixed capability is `aionui-approval-reconciliation-read-v1` with
  `network.request` against `external-service`, no credentials, and one exact
  allow rule;
- the existing bounded loopback transport reduces the native confirmation list
  to one boolean before it returns to the gate. Native list content, prompts,
  commands, paths, option values, and provider details are not persisted or
  audited;
- a unique request identifier and compatibility-scoped stable input reference
  enter the metadata-only `policy.evaluated`, `tool.started`, and terminal
  audit sequence. Concurrent reads for the same private confirmation identity
  coalesce to one native read and one audit sequence;
- policy or pre-execution audit failure prevents native access. A
  post-execution audit failure yields an uncertain read that cannot mark the
  response delivered or permit redelivery;
- `deliver` delegates unchanged to the accepted F3.2 transport.
  `ACTESTRA_APPROVAL_RECONCILIATION_GATE=0` bypasses only the F3.3
  `isPending` wrapper, returning that read to F3.1 direct native
  reconciliation while retaining F3.2 delivery. F3.3 activates only while the
  F3.2 gate is enabled;
- no schema, preload, renderer, route, permission-card, pet, or Team UI change
  is introduced. The four R0 invariant files remain byte-identical;
- new root tests pass 1 file and 7 tests; focused F3 regression passes 4 files
  and 24 tests;
- the complete root gate passes 33 files and 178 tests, Electron SQLite,
  process smoke, the 42-source product boundary, frozen/downstream checks, and
  production build;
- the 104-file downstream declaration, four R0 invariants, and 22 reviewed
  source copies pass. Materialized strict TypeScript, 21-file/143-test
  Actestra integration, and the five-file/11-test focused F3 set pass;
- the complete materialized native suite passes 332 files with 1 skipped and
  2,608 tests with 5 skipped. Production build passes with 570 main, 7 preload,
  and 10,163 renderer modules.
- unsigned legacy-harness bundle, packaged identity/product boundary, and
  clean-profile application/window/renderer smoke pass as regression evidence.

Detailed scope, rollback, failure, and non-claims are recorded in
[AionUi F3.3 Approval Reconciliation Policy Gate](product/AIONUI_F3_APPROVAL_RECONCILIATION_GATE.md)
and
[ADR-0014](architecture/decisions/0014-aionui-approval-reconciliation-policy-gate.md).
These local results are recorded on implementation commit
`c2fa4bbc4989b9a41bf6a283b5f0eb1f2f523acb`. Draft pull request 8 and
exact-head CI run 30445531680 verify evidence head
`53e7041399518969c67af0fb78bf92499ebe28fd`; review remediation
`228ff385afd1d0dfc03655d1d46eaad9998bedc3` reached Ready evidence head
`ab7b81957f32fda455c2219cb6ab169842df20a6`, and exact-head CI run 30448185324
passes. Candidate, release, distribution, and acceptance remain separate.

Four completed local CodeRabbit reviews informed F3.3. The first covered 13
tracked files and raised two valid documentation/checker issues plus one
invalid request to treat an Actestra-owned source copy as upstream provenance.
The next two covered all 18 files and raised five valid lifecycle, cleanup,
rollback, and concurrency issues. After a rate-limited attempt recovered, the
fourth complete 18-file review raised one valid minor request to prove durable
failure-event ordering and private-data exclusion directly from SQLite. All
eight valid issues are fixed, with the latest assertion in
`228ff385afd1d0dfc03655d1d46eaad9998bedc3`. A fifth complete review covered
all 18 changed files on `ab7b81957f32fda455c2219cb6ab169842df20a6` and
raised zero issues. The explicit remote review selected the same 18-file range
but was rate-limited before review with a 26-minute wait; its successful status
records command handling only and is not remote review evidence.

The implementation run
[30421071039](https://github.com/bignormal/actestra-desktop/actions/runs/30421071039)
passed through unsigned bundle creation but failed the legacy packaged-boundary
check because declared F2 compatibility text in main matched its former global
AionUi prohibition. It did not run clean-profile smoke and is not pass
evidence. The remediation retains a per-ASAR-file deny boundary and is verified
by the succeeding exact-head run.

The full native suite, F2 live projection, F3.1 restart reconciliation, and
visual/runtime socket inspection remain local evidence. F0-F3.1 foundation,
downstream overlay, focused contracts, native production build, unsigned
package boundary, and clean-profile smoke are CI-backed on their recorded exact
commits. Pull request 6 reached exact final head
`70b2f29329fec26bf0e3d6384d8563aedcb7a4ce`; exact-head CI run 30431557027
passed, and a scoped local CodeRabbit review completed across the 21 final
changed files with zero findings. The Ready-triggered GitHub CodeRabbit job
explicitly skipped because 1,774 files exceeded its 150-file limit, so that
status is not review evidence. Pull request 6 squash merged as
`61b9405fc007aa8cb16ec05a65f421cb7d277b51`, and main run 30434563810 passed
on that exact merge. These facts prove merge and main CI, not candidate,
release, distribution, or acceptance.

P3.1-P3.6 and review remediation are pushed and CI-backed. The full independent
review and remediation review are complete.
[Pull request 3](https://github.com/bignormal/actestra-desktop/pull/3) reached
final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f`, squash merged as
`f6833c50eaf5a426948bac7999f93a08b19a425e`, and exact
[main CI run 30378191752](https://github.com/bignormal/actestra-desktop/actions/runs/30378191752)
passes. These facts close the P3 exit gate.

P0 through P3 are accepted on `main`.
[Pull request 2](https://github.com/bignormal/actestra-desktop/pull/2) merged
the P2 independent product shell with squash commit
`76d6a58b20c3e010ee759358f2c86be80bc6a6c1`. Its exact final PR head was
`f972bb6c33c925f3e333a6ee87d20e5bbb72cece`.
[Main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)
passes on the exact squash commit.

`feat/platform-core-contracts` began from that verified `main` commit and
merged through pull request 3.
P3.1/P3.2 implementation commit
`31dd6e4178eb7641b45be0ee2bccb862a96dac99` adds the P3.1 domain records,
state transitions, and ownership invariants plus the P3.2 version 1 event
envelope, ordering, idempotency, replay, terminal, and redaction rules.
[macOS arm64 CI run 30331681309](https://github.com/bignormal/actestra-desktop/actions/runs/30331681309)
passes on that exact commit.

P3.3 implementation commit
`4de756984269624a02fbfdf77e558c958a03c2e0` accepts
[ADR-0005](architecture/decisions/0005-sqlite-persistence-and-migrations.md)
and implements storage-neutral persistence ports, two forward-only SQLite
migrations, a main-owned domain/event adapter, corruption and rollback checks,
and an exact Electron-runtime compatibility probe.
[macOS arm64 CI run 30335076556](https://github.com/bignormal/actestra-desktop/actions/runs/30335076556)
passes on that exact implementation commit.

P3.4 implementation commit
`2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b` accepts
[ADR-0006](architecture/decisions/0006-agent-adapter-lifecycle-and-supervision.md)
and adds protocol version 1, exact capability negotiation, an `AgentAdapter`
contract, observed-time lifecycle supervision, immutable attempts, terminal
reconciliation, cancellation, crash, bounded restart, and an explicitly
stepped deterministic fake adapter.
[macOS arm64 CI run 30339662937](https://github.com/bignormal/actestra-desktop/actions/runs/30339662937)
passes on that exact implementation commit.

P3.5 implementation commit
`cec0cdc554656c021cdff7f2341ddd3f9b5d83dd` accepts
[ADR-0007](architecture/decisions/0007-privileged-service-authorization.md)
and adds closed protected-operation and tool-manifest contracts, conservative
policy evaluation, exact one-shot approval evidence, opaque credential leases,
a metadata-only audit trail, and a fixed-order main-owned gateway.
[macOS arm64 CI run 30345370507](https://github.com/bignormal/actestra-desktop/actions/runs/30345370507)
passes on that exact implementation commit.

P3.6 implementation commit
`950fe0efa2fdc5adc69d013acc9f417d201cb28e` accepts
[ADR-0008](architecture/decisions/0008-main-owned-projection-and-ipc.md)
and adds SQLite schema version 3, durable metadata-only privileged audit,
immutable terminal-attempt evidence, persist-before-release coordination,
main-owned inert service registration, trusted-frame IPC, a three-operation
preload allowlist, and bounded renderer projection.
[macOS arm64 CI run 30350732223](https://github.com/bignormal/actestra-desktop/actions/runs/30350732223)
passes on that exact implementation commit.

Review-remediation commit
`4fa0fb120a6ceb2c71effd2a552e8d9bbf05d151` adds bounded structural
comparison, idempotent incremental redelivery, explicit persistence
idempotency contracts, post-replacement stream-cache invalidation, and
evidence-document corrections.
[macOS arm64 CI run 30374144474](https://github.com/bignormal/actestra-desktop/actions/runs/30374144474)
passes on that exact remediation commit.

Review-closure evidence commit
`2fe179a63ac7e8a4d23373fe87dda7b062c314fc` records the complete review,
remediation, validation, and remaining owner gate.
[macOS arm64 CI run 30374447377](https://github.com/bignormal/actestra-desktop/actions/runs/30374447377)
passes on that exact evidence head. The subsequent Ready transition triggered
CodeRabbit run `c55e04d9-8360-4570-a06c-2dec6b5d19e6`, which selected all 67
PR files and completed with a successful status, no review submission, and no
review thread. This Free-plan summary/walkthrough is not represented as an
independent approval.

Ready-state evidence commit
`755416c7b9bbb09172559460bc1a122eea2f7c8f` records the completed owner and
Ready gates.
[macOS arm64 CI run 30376456379](https://github.com/bignormal/actestra-desktop/actions/runs/30376456379)
passes on that exact commit. Its incremental CodeRabbit run
`5d4c70ac-5432-4ea0-af1e-2bf51db50362` selected only the four changed status
documents but was rate-limited before review with a 55-minute wait. The
resulting successful status is command-handling evidence, not a completed
review or a zero-issue result.

Final PR-head evidence commit
`71bf3e3fb1d7661fee053ee811279d44f1fdf45f` records the Ready-state CI
evidence.
[macOS arm64 CI run 30376696055](https://github.com/bignormal/actestra-desktop/actions/runs/30376696055)
passes on that exact final head. Incremental CodeRabbit run
`226b4810-7e15-495f-a3f9-50cf0536fb8c` selected the final four-document status
range but was rate-limited before review with a 52-minute wait. Its successful
status records limit handling only; it is not a completed review or zero-issue
result.

Pull request 3 squash merged that exact final head as
`f6833c50eaf5a426948bac7999f93a08b19a425e`.
[macOS arm64 main CI run 30378191752](https://github.com/bignormal/actestra-desktop/actions/runs/30378191752)
passes on the exact squash commit, including source, tests, boundaries,
documentation, unsigned bundle, packaged identity, and clean-profile smoke.

Application startup now opens the owned SQLite store and registers the
deny-by-default reference services only in main. The fake worker still performs
no filesystem, network, process, shell, model, credential, or tool operation.
There is no secret backend, real executor, input-reference store, production
policy snapshot, worker process, or MCP/native transport.

Local validation of P3.3 at
`4de756984269624a02fbfdf77e558c958a03c2e0` on
`feat/platform-core-contracts`:

- `bun install --frozen-lockfile` — pass with no lockfile change;
- `bun run check` — pass, including format, lint, strict types, 9 Vitest files
  with 54 tests, the exact Electron `37.10.3` / Node.js `22.21.1` / SQLite
  `3.50.4` probe, the 3-scenario process-failure harness, product-boundary
  check, and desktop build;
- `bun run test:coverage` — pass; `main/persistence` has 88.46% statement and
  77.77% branch coverage;
- `bun run docs:check` — pass for all 26 Markdown files;
- `bunx markdownlint-cli2 'docs/**/*.md' 'README.md' 'AGENTS.md'` — pass with
  0 issues;
- `bun run dist:dir && bun run verify:package && bun run smoke:package` — pass
  for the unsigned arm64 app and isolated shell profile; this is regression
  evidence only because P3.3 is not wired into startup;
- `git diff --cached --check` — pass;
- `coderabbit review --agent -t uncommitted -c AGENTS.md` — initial full review
  raised 5 issues (2 major, 3 minor); all were verified and remediated without
  weakening event invariants; the 17-file post-remediation review completed
  with 0 issues.

Local validation of P3.4 at
`2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b` on
`feat/platform-core-contracts`:

- three focused contract files — pass with 22 tests covering version and
  capability rejection, lifecycle order, messages, approval grant/denial/
  expiry/cancellation, normal and forced cancellation, startup and heartbeat
  timeout, crash, fresh-attempt restart, restart bounds, identity and sequence
  drift, approval-reference drift, and terminal reconciliation;
- `bun run check` — pass, including format, lint, strict types, all 12 Vitest
  files with 76 tests, the exact Electron `37.10.3` / Node.js `22.21.1` /
  SQLite `3.50.4` probe, the 3-scenario process-failure harness, the 21-source
  product-boundary check, and desktop build;
- `bun run test:coverage` — pass after remediation with 81.88% statement,
  75.28% branch, and 93.75% function coverage overall; `core/agentAdapter.ts`
  has 89.71% statement coverage and `main/workers` has 75.86%;
- `bun run docs:check` — pass for all 27 Markdown files;
- `bunx markdownlint-cli2 'docs/**/*.md' 'README.md' 'AGENTS.md'` — pass with
  0 issues;
- `git diff --cached --check` — pass;
- `coderabbit review --agent -t uncommitted -c AGENTS.md` — the first
  tracked-file review raised 1 minor status-wording issue; the complete 13-file
  review raised 4 major lifecycle/validation issues; all were verified and
  remediated, and the final 13-file review completed with 0 issues;
- exact implementation CI run 30339662937 — pass, including source/test/
  boundary, documentation, unsigned bundle, packaged identity, and clean-profile
  smoke steps.

Local validation of P3.5 at
`cec0cdc554656c021cdff7f2341ddd3f9b5d83dd` on
`feat/platform-core-contracts`:

- `bun install --frozen-lockfile` — pass with 443 installs and no lockfile
  change;
- two focused P3.5 contract files — pass with 27 tests covering validation,
  policy, approval, audit, credential-lease, gateway, cleanup, concurrency, and
  post-call uncertainty rules;
- `bun run check` — pass, including format, lint with 0 warnings, strict types,
  all 14 Vitest files with 103 tests, the exact Electron `37.10.3` / Node.js
  `22.21.1` / SQLite `3.50.4` probe, the 3-scenario process-failure harness, the
  27-source product-boundary check, and desktop build;
- `bun run test:coverage` — pass with 84.00% statement, 76.75% branch, and
  95.18% function coverage overall; `core/privilegedServices.ts` has 93.96%
  statement coverage and `main/privileged` has 84.04%;
- `bun run docs:check` — pass for all 28 Markdown files;
- `bunx markdownlint-cli2 'docs/**/*.md' 'README.md' 'AGENTS.md'` — pass across
  24 matched files with 0 issues;
- `bun run dist:dir && bun run verify:package && bun run smoke:package` — pass
  for the unsigned arm64 app and isolated shell profile; this is regression
  evidence only because P3.5 is not wired into startup;
- `git diff --cached --check` — pass before the implementation commit;
- three completed CodeRabbit CLI reviews raised 14 issues: 1 critical,
  10 major, and 3 minor. All were verified and remediated. A fourth final CLI
  retry was rate-limited before review and therefore is not zero-issue evidence;
  the remote CodeRabbit status is `SUCCESS` on the pushed implementation head;
- exact implementation CI run 30345370507 — pass, including source/test/
  boundary, documentation, unsigned bundle, packaged identity, and clean-profile
  smoke steps.

Validation of P3.6 implementation commit
`950fe0efa2fdc5adc69d013acc9f417d201cb28e`:

- the first contract, preload, and IPC group passed 4 focused files with 9
  tests after the intended red phase;
- SQLite migration and platform-evidence groups passed restart-continuity,
  idempotency, immutable-conflict, bounded-read, and projection-corruption
  tests;
- terminal-attempt unit and SQLite integration tests prove event persistence,
  metadata evidence, failure retention, idempotent retry, and supervisor release
  order;
- `bun run check` — pass, including format, lint with 0 warnings, strict types,
  all 24 Vitest files with 129 tests, the exact Electron `37.10.3` / Node.js
  `22.21.1` / SQLite `3.50.4` probe, the 3-scenario process-failure harness, the
  34-source product-boundary check, and desktop build;
- `bun run test:coverage` — pass with 84.15% statement, 76.59% branch, and
  94.30% function coverage overall; `main/ipc` has 92.85% statement coverage,
  `main/persistence` has 87.92%, and the preload bridge has 90.90%;
- `bun run dist:dir && bun run verify:package && bun run smoke:package` — pass
  for the unsigned arm64 app, packaged identity, and isolated application,
  window, and renderer-ready markers with SQLite v3 active;
- documentation links and lint pass. Two CodeRabbit CLI reviews raised six
  valid issues (1 critical, 2 major, and 3 minor), all remediated; a third
  tracked-file pass returned zero issues. A full staged-diff retry was
  rate-limited before review and is not zero-issue evidence. A manual full-diff
  audit found and remediated two additional defensive gaps;
- exact implementation CI run 30350732223 — pass, including source/test/
  boundary, documentation, unsigned bundle, packaged identity, and clean-profile
  smoke steps;
- the explicit remote 67-file CodeRabbit review request was also rate-limited
  before review. Its `SUCCESS` status represents command handling, not completed
  review; GitHub has no review submission or review thread on the implementation
  head.

Review closure validation at
`4fa0fb120a6ceb2c71effd2a552e8d9bbf05d151`:

- `coderabbit review --agent -t committed --base main -c AGENTS.md` completed
  against all 67 PR files at pre-remediation head
  `164be7da1b73ffeb8da813e33268ccaf4a77b7ad` and raised 10 issues: 4 major
  and 6 minor;
- nine issues were verified and remediated. One minor request to replace
  kickoff CI run 30329964305 with the earlier run 30329899300 was rejected
  after GitHub verification showed that both passed, but 30329964305 is the
  later canonical run on exact head
  `b9c1119479c805c02452e4054a3d904649a3ca03`;
- four focused files pass 23 tests. `bun run check` passes format, zero-warning
  lint, strict types, the exact Electron SQLite probe, all 24 Vitest files with
  130 tests, the process-failure harness, 34-source boundary check, and build;
- `bun run test:coverage` passes with 84.16% statement, 76.70% branch, and
  94.30% function coverage. Documentation links and Markdown lint pass with
  zero issues;
- unsigned arm64 packaging, packaged identity, and isolated application,
  window, and renderer-ready smoke pass;
- the first nine-file remediation review raised one minor immutable-evidence
  wording issue, which was fixed. The second nine-file review completed with 0
  issues;
- a final redundant 67-file confirmation attempt was rate-limited during setup
  with a 43-minute wait. It is not represented as zero-issue evidence; closure
  rests on the completed full review plus the completed zero-issue remediation
  review;
- exact remediation CI run 30374144474 passes all source/test/boundary,
  documentation, unsigned bundle, package identity, and clean-profile smoke
  steps.

## Evidence snapshot

<!-- markdownlint-disable MD060 -->

| Area                                               | State                                                             | Evidence or blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                                         | F0-F3.3 and P6 architecture accepted on `main`                    | PR 9 final head `d7e615206af0829375db0db1d1fcc6ca205102a8`; squash merge `327d5ca5abf3a0090bc2b3d3193e2935bbd47f38`; main CI 30470505690 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P2 merge                                           | Accepted on `main`                                                | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P2 main CI                                         | Pass                                                              | Main push run 30329620829 passed on the exact squash merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P3 kickoff CI                                      | Pass                                                              | Pull-request run 30329964305 passed on exact pushed head `b9c1119479c805c02452e4054a3d904649a3ca03`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P3.1/P3.2 CI                                       | Pass                                                              | Pull-request run 30331681309 passed on exact implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3.3 CI                                            | Pass                                                              | Pull-request run 30335076556 passed on exact implementation commit `4de756984269624a02fbfdf77e558c958a03c2e0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3.4 CI                                            | Pass                                                              | Pull-request run 30339662937 passed on exact implementation commit `2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3.5 CI                                            | Pass                                                              | Pull-request run 30345370507 passed on exact implementation commit `cec0cdc554656c021cdff7f2341ddd3f9b5d83dd`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3.6 CI                                            | Pass                                                              | Pull-request run 30350732223 passed on exact implementation commit `950fe0efa2fdc5adc69d013acc9f417d201cb28e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3 review closure                                  | Pass with one documented invalid issue                            | Full 67-file review completed with 10 issues; 9 valid issues fixed; all 9 remediation files then completed a zero-issue review; exact remediation CI run 30374144474 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P3 Ready gate                                      | Pass                                                              | Owner authorized the Ready transition; runs 30374447377 and 30376456379 passed on their exact heads; final PR-head run 30376696055 passed; the first Ready-triggered CodeRabbit selected 67 files and completed successfully with 0 review submissions and 0 threads                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3 merge                                           | Accepted on `main`                                                | PR 3 squash merged exact final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f` as `f6833c50eaf5a426948bac7999f93a08b19a425e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P3 main CI                                         | Pass                                                              | Main push run 30378191752 passed on exact squash commit `f6833c50eaf5a426948bac7999f93a08b19a425e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P4.0 foundation                                    | Accepted on `main` through PR 6                                   | Implementation `13270ca0abd7353710541afca9ddf46c47670be3`; early exact-head CI run 30392140461 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P4.1 identity and isolation                        | Accepted on `main` through PR 6                                   | Implementation `836a9f1f81687f091e1c5b92ce30bff167e9da4f`; resource-only CI remediation `462a1b0d920279d42f124fdd28673d77dc55b765`; run 30417692550 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P4.2 compatibility shadow                          | Accepted on `main` through PR 6                                   | Implementation `632573fa03c34fdb789c85d8efc1ce1e0f8e8177`; packaged-boundary remediation `1478726d62302fa885525024eb4839af5e98b4dd`; run 30421351204 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P4.3/F3.1 approval decision authority              | Accepted on `main` through PR 6                                   | Implementation `cf61ffb8453a888cdc03f73457ebeaf72708511a`; ADR-0012; schema version 5 persist-before-deliver outbox; 30/153 root and 330/2,602 native tests; run 30425061316 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| PR 6 review and merge closure                      | Accepted on `main`                                                | Final head `70b2f29329fec26bf0e3d6384d8563aedcb7a4ce`; exact-head CI 30431557027 passes; local review of 21 final changed files returned zero findings; squash merge `61b9405fc007aa8cb16ec05a65f421cb7d277b51`; exact main CI 30434563810 passes                                                                                                                                                                                                                                                                                                                                                                                                                       |
| F3.2 approval delivery policy gate                 | Accepted on `main` through PR 7                                   | Implementation `20e3c0fcada0d072fc35820d43b85c953bf93929`; final head `df821ca203bea7b611fa8fb8092d00a16cabe578`; squash merge `ce19dbe072328e16dcdaf116b8199d5502cb44c6`; exact main CI run 30442166290 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| F3.3 approval reconciliation policy gate           | Accepted on `main` through PR 8                                   | Implementation `c2fa4bbc4989b9a41bf6a283b5f0eb1f2f523acb`; final head `3f85e13072f5fb13fb43c9dae94f992bb0b7fb9c`; squash merge `c841ed9cb6a54bcb2e4078ca2be941adce0ac4ad`; exact main CI run 30449520722 passes; the complete local 18-file review raised zero issues before merge                                                                                                                                                                                                                                                                                                                                                                                      |
| GW-P4.2 persistence utility and content foundation | Accepted on `main` through PR 10                                  | Final head `9003cc0387cb4266c4b1240308092366ef365bf4`; exact-head CI 30475836615; zero-finding 50-file review; squash merge `8e32882108b10272c1489c1a46a77cede1cc4fb7`; exact main CI 30476091907                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GW-P4.3 General Worker and Adapter v2              | Accepted on `main` through PR 11                                  | Final head `b3a3bc7e27d7dab44dadeff6dcedc92cec1b3ee5`; exact-head CI 30481670123; squash merge `671587813bea18411b6cdc2ee388d94cd18d6c50`; exact main CI 30481890911; ADR-0017; 40/217 root and 334/2,610 native tests; build, unsigned harness package, real utility-worker smoke, and isolated native AionUi/AionCore launch pass                                                                                                                                                                                                                                                                                                                                     |
| GW-P4.4 scoped native tools and policy             | Accepted on `main` through PR 12                                  | Final head `34f2d2201581c19b3dc67c5a7936f8a411bff9e1`; PR CI 30486392525; squash merge `7ec009c6384a93c17f24e4276469e98cb5f2b71d`; main CI 30486544268; ADR-0018; two scoped text tools; 42/232 root and 335/2,612 native tests; root/native build, unsigned harness package, scoped registration, and isolated AionUi/AionCore launch pass                                                                                                                                                                                                                                                                                                                             |
| GW-P4.5 durable coordination and recovery          | Accepted on `main` through PR 13                                  | Final head `f160d9a3a00f317f12b7579bc3a48849c1cf32d2`; PR CI 30495112290; squash merge `1dacbc0bee8ebae26d688e6e719c8f0f5750db5f`; main CI 30495301140; ADR-0019; schema 7 recovery journal; full root/native regression, production builds, unsigned smoke, isolated AionUI recovery launch, and process cleanup pass                                                                                                                                                                                                                                                                                                                                                  |
| GW-P4.6 preserved-AionUI General Work journey      | Accepted on `main` through PR 14                                  | Final head `4a07eb9db1907ae8fab2613b4cf11a7d2a8cbee4`; PR CI 30553454459; squash merge `784191bfc59d71a128ed5d3251db3535f1349e45`; main CI 30554447144; ADR-0020; schema 8 atomic journey authority; complete root check passes 50 files/292 tests; native passes 341 files/2,634 tests; production builds, signed local arm64 package, and target-app restart/denial/cancellation smoke pass                                                                                                                                                                                                                                                                           |
| P4 representative workspace-file journey           | Accepted on `main` through PR 16                                  | Final head `f19b7dd006cf091aa9c7f1559dd484fdad35f200`; PR CI 30567484733; squash merge `2aed0f705bf6f9b3734742c0905c94ac562f501e`; exact main CI 30569476160; schema 9 closed kinds; 50/308 root and 341/2,635 native tests; signed local package and target-app smoke; no submitted reviews or inline comments; Free-plan summary is not line-level review evidence                                                                                                                                                                                                                                                                                                    |
| P4 bounded local-research journey                  | Accepted on `main` through PR 17                                  | Final head `5694865462f7209ad413b2cd1dbe2eef0fe955bc`; PR CI 30577647392; squash merge `779880f28106aa8423ba042de5a6a3264bc0452e`; merged-main CI 30577886631; schema 10; 50/313 root and 341/2,637 native tests; builds, signed unnotarized local package, target-app smoke, local review closure; remote CodeRabbit rate-limited before review                                                                                                                                                                                                                                                                                                                        |
| P4 bounded writing journey                         | Accepted on `main` through PR 18                                  | Final head `2febf25e80868fac51fb7b37fffb746d10f8edde`; PR CI 30585829619; squash merge `d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2`; merged-main CI 30586015008; ADR-0021; schema 11; 50/325 root and 341/2,639 native tests; root/native builds; ad-hoc-signed unnotarized local arm64 package and target-app smoke; Free-plan remote summary is not line-level review evidence                                                                                                                                                                                                                                                                                          |
| P4 bounded Office-document journey                 | Accepted on `main` through PR 19                                  | Final head `091f786d57c6b4569cdaac17ea969a0b9070ea02`; PR CI 30602624426; squash merge `505afb2f3916e75c7abb07cdf461bda29a602b9b`; merged-main CI 30602821085; ADR-0022; schema 12; 50/338 root and 343/2,644 native tests; final local CodeRabbit closure; signed unnotarized arm64 package and real Office target-app smoke pass; remote Free output is summary/walkthrough only                                                                                                                                                                                                                                                                                      |
| P4 bounded scheduled General Work                  | Accepted on `main` through PR 20                                  | ADR-0023; exact final head `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`; PR CI 30659567604; squash merge `5b0748af674165f9e9475be61dc1e02a1b08c8bc`; merged-main CI 30660078199; schema 13; 56/424 root and 345/2,658 native tests; final local review closure; signed unnotarized arm64 package, strict package/ASAR/resource checks, and real schedule target-app smoke; remote CodeRabbit output is rate-limited summary/walkthrough only                                                                                                                                                                                                                              |
| P4 representative tool failure                     | Accepted on `main` through PR 22                                  | Implementation `fd5524c7f0485923b2aa765df95b5ef0b14187e7`; final head `077f30bcfa3929959c971d08081092bbf976e2ee`; PR CI 30673687603; squash merge `c7c414c0c5a126b276fb02b372e02fff437e5f23`; merged-main CI 30673919260; 56/425 final root and 345/2,662 native tests; complete 15-file manual review and final scope/secret/generated-output audit; pinned, signed, unnotarized local arm64 package and schema-13 target-app `content-too-large` plus restart evidence; CodeRabbit was rate-limited before formal review and its Free summary is not line-level review evidence                                                                                       |
| P4 Worker crash/recovery                           | Accepted on `main` through PR 24                                  | Implementation `47ed445eab204c0998e44167455c062600158dd3`; exact final head `3593fac8db48a0cb149bb6c736374eeaccebe332`; PR CI 30687199671; squash merge `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`; merged-main CI 30687433298; 56/427 root and 345/2,665 native tests; builds; signed unnotarized arm64 package; external-`SIGKILL` schema-13 smoke; complete 14-file manual review and exact scope audits; automatic CodeRabbit was rate-limited before review and is not line-level review evidence                                                                                                                                                                  |
| P4 phase                                           | Accepted on `main`                                                | The retained AionUI journey and representative file, local-research, writing, Office, schedule, denial, cancellation, tool-failure, persistence, Worker-crash/recovery, and Artifact-conflict evidence satisfy the P4 exit gate at exact phase head `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`; acceptance record merge `adc9a99d7806f5627041368b4ff932c1fe9a42f0`; merged-main CI 30689608454 attempt 2 passes                                                                                                                                                                                                                                                         |
| P5.0 Goose source and ACP admission                | Accepted on `main` through PR 26                                  | Exact head `e622f36e697b4e0be1037175267452e24cc180e3`; exact-head CI 30691045159; squash merge `b61dd3ea44a4c522ca0c15a84a01d8f76b335e4c`; merged-main CI 30691300690; ADR-0024 selects `v1.45.0` / `4dc0420f5704a92806c6628c8f0a3497d7a88759`, minimal Goose core stdio runner with empty feature set and no builtins, scheduler, or second UI; upstream CLI rejected; CodeRabbit rate limit is not formal review evidence                                                                                                                                                                                                                                             |
| P5.1 minimal Goose runner and ACP handshake        | Accepted on `main` through PR 28                                  | Runner exact head `d3be6c665b1df51acec13c95691315ba97ba98dc`; PR 27 CI 30698164038; runner merge `df5bd41ca0ecd4838e046f48a9016e418b036ac7`; its main CI 30698648996 isolates a passing Goose job and failing Worker-crash desktop job; official symbols identify synchronous `HandleTermination` to `PostMessage` reentrancy; hotfix exact head `eed1623e9849b9f662f3dec690d02d7c85a693ef`; PR 28 CI 30699859869 passes; squash merge `d313fb2ed65e4b010f777435953752818fbbfae4`; merged-main CI 30700441312 passes both Goose admission and the packaged immediate-`SIGKILL` recovery smoke; incomplete automatic review is not zero-finding evidence; complete 9-file manual/static review; no session, tool, workspace, model, credential, UI, candidate, release, or deployment authority |
| P5.2 isolated-coding containment foundation       | Delivered on `main` through PR 31                                 | Exact final head `c10110b38e8714b831a6d6d0fc09aa8df4218b7c`; exact-head CI 30808650150 passes; squash merge `266e3857bed7d4c32b773f92deff676bf2144b15`; exact merged-main CI 30809931486 passes; CodeRabbit was rate-limited before line-level review and its successful status/Free walkthrough are not formal review evidence; 3 focused files/39 tests and the recorded 63-file/488-test root gate pass; no ACP session or P5.2 acceptance |
| P5.2 desktop-main containment composition         | Delivered on `main` through PR 32                                | Exact final head `5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`; exact-head CI 30817462671 passes; exact-head CodeRabbit re-review covers 12 files with 0 issues and no GitHub review threads; squash merge `f55b5550c6ac189f09536061a70e8c8c7299c4f4`; exact merged-main CI 30818949121 passes both jobs; main-owned worktree/grant/Gateway lifecycle and patch 0012; 5 focused files/49 tests; recorded 65-file/498-test root gate; no renderer surface, real Goose coding, or phase acceptance |
| P5.2 ACP session/new lifecycle                    | Delivered on `main` through PR 33                                | Exact head `5d873f2feb94679341627aab0472a66630cf16cd`; exact-head CI 30823601815; squash merge `c5f498e926adac484694dab6d2f05b9822cc0b12`; merged-main CI 30825221070; one process/one session, fixed request-ID correlation, exact loopback MCP declaration, bounded setup notifications/frames, and failed-session private-root cleanup; no model, prompt/tool execution, publish/Artifact flow, or phase acceptance |
| P5.2 authenticated MCP transport                  | Delivered on `main` through PR 35                                | Exact head `93a8e9633f2be7b5f8c8b1eead3f2a21b0770073`; exact-head CI 30832907098; squash merge `8a31bafc1cd322744189fc4ed1e68f769225c999`; merged-main CI 30834217310; random authenticated loopback endpoint and six closed schemas; CodeRabbit quota exhaustion is not review evidence; `tools/call` remains denied |
| P5.2 authenticated Goose readiness                | Delivered on `main` through PR 36                                | Old head `9e277e1593b2715ed3721e1febb886985a942824` had macOS pass/Goose `session-rejected` failure in CI 30837296114 and was not rerun; corrected exact head `5fe78bfaf2982556af975d23bc904d10b77a1f29`; exact-head CI 30843561874; squash merge `08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`; merged-main CI 30845006202; separate MCP/model leases and loopback ports, authenticated non-inference catalog, closed provider/model environment, explicit ACP tool discovery, exact-six match, and Worker-first cleanup; 4 focused files/51 tests, admitted-artifact integration 1 file/1 test, and recorded 68-file/582-test root gate pass; no inference, prompt/tool execution, durable evidence, publish/Artifact flow, or phase acceptance |
| P5.2 authenticated MCP tool-call bridge           | Delivered on `main` through PR 37                                | Exact head `84b0550495717343b75ca2540cb7c191ab65b12a`; exact-head CI 30851778390; squash merge `d933546454e63a2d836e728f1b93980cb4a7c0ac`; merged-main CI 30853499159; bounded `tools/call` through the real Tool Gateway, close-race guard, 3 focused files/65 tests, and recorded 68-file/589-test root gate; CodeRabbit review limit and zero GitHub review threads are not line-level review evidence; no inference, prompt loop, publish/Artifact flow, or phase acceptance |
| P5.2 authenticated inference/prompt loop          | Delivered on `main` through PR 39                                | Prompt exact head `cc773081ba448266951a3b2ac3654831022118fc`; exact-head CI 30859115162; squash merge `a6280dd38eacdbada9db159c4784110ec8e42770`; merged-main CI 30860137257 failed only the Goose job when one real-Git test crossed the implicit 5-second limit and was not rerun; bounded-deadline correction exact head `38cbbaaedbb8e5955b96a6d7148841180e751e35`; exact-head CI 30861770178; squash merge `7e8732e264febff42fb3d451011b3b8e48caaff5`; merged-main CI 30862710547 passes both jobs; no submitted review or inline thread; no desktop-main composition, approval outcome projection, durable normalized evidence, publish/Artifact flow, or phase acceptance |
| P5.2 desktop-main Goose lifecycle                  | Delivered on `main` through PR 40                                 | Exact head `c35f8c37c14dedaa980dfbb539f16fc21379be8a`; exact-head CI 30865837496; squash merge `1909033977576d94f6983f9c911b8e0a866a59de`; merged-main CI 30866691199; service-owned worktree/grant/Gateway/invoker/Goose opening, prompt, close ordering, close-race rejection, failure aggregation, and cleanup retry; no submitted review or inline thread; no approval outcomes, durable normalized evidence, publish/Artifact flow, or phase acceptance in that delivery                                                                                                                                                                                                                                                                                                                  |
| P5.2 main-owned approval outcomes                  | Delivered on `main` through PR 41                                 | Exact head `917a95260d84f09aacf5038d92a5230d1781676d`; exact-head CI 30870425378; squash merge `7dfc4973021d68d5df0ded12fa218ecd42da9691`; merged-main CI 30871703449; persisted approve/deny outcomes, exact approval-snapshot binding, one-shot approved execution, denied no-execution projection, abort settlement, and explicit service forwarding; focused 18 passed/2 artifact-gated, recorded 68-file/601-test root gate, and materialized-native TypeScript plus generated 1/1 test pass; no durable normalized evidence, publish/Artifact flow, or phase acceptance in that delivery                                                                                                                                                                                                 |
| P5.2 durable normalized coding evidence            | Delivered on `main` through PR 42                                 | Exact head `a20882abeb6caac3b4f230fde42a7e06965a0730`; exact-head CI 30876755457; squash merge `e064dc88e717cef093c866cdbc2692d23ed7dd03`; merged-main CI 30877711241 with Goose job 91892412815 and macOS job 91892412830; stable Actestra-owned stream/correlation identity, persist-before-open start, bounded evidence, review-blocked projection, response-loss-safe replay, and shared mutation barrier; Free CodeRabbit summary is not line-level review evidence; no publish/Artifact flow or phase acceptance in that delivery                                                                                                                                                                                                                                                        |
| P5.2 publish and Artifact registration             | Accepted on `main` through PR 43                                  | Exact head `305a29d9b2b514865983ae9d8a23f877566bb7a5`; exact-head CI 30883055147; squash merge `9048fe2cc23819f596d8721adb8c544dcd0b786f`; merged-main CI 30884138218; main-only seventh publish capability remains outside Goose's six MCP tools; locked exact patch capture, metadata-only one-shot approval, drift denial, durable Artifact completion, ordered cleanup, 5 focused files/123 passed/2 artifact-gated skipped, recorded 68-file/618-test root gate, and 196-file downstream contract; rate-limited CodeRabbit status is not line-level review evidence; P5.2 accepted, not released or user-accepted                                                                                                                                                                      |
| P5.3 preserved AionUI coding journey               | Accepted on `main` through PR 44                                  | Exact head `15a8e29b44a6684313f29a694f0d0615de95cf36`; exact-head CI 30899489690 passes; squash merge `ee8425e39e201078cd64fe3af38355279ecf56de`; merged-main CI 30900884248 passes; exact-head and merged-main tree `e301a0acede51671b404daf11248788cdaba34d9`; R1 patch 0013 preserves native and Team paths while providing the fixed Goose journey, real approval/publish/cancel evidence, 74/2 files and 642/5 tests in the final root gate, 217/4/80 downstream checks, and the 61/3/28 build; Free CodeRabbit summary is not line-level review evidence; no candidate, release, deployment, or user-acceptance claim                                                                                                                                                 |
| P6 bounded team-plan admission                     | Accepted on `main` through PR 45                                  | Initial head `59cf48fbbb45d78c803ab6691547b61878fc8eb3` failed sole run 30905371865 only at the missing downstream source-copy declaration and was not rerun; corrected exact head `a3d08a934160c1a5d61ff987ade29212bd3c0b05`; exact-head CI 30906689796; squash merge `30742934adde1e0944c4e8ced1f005452a1f3568`; merged-main CI 30907869824; 2 focused files/30 tests and recorded 76/2-file, 672/5-test root gate; no submitted review or inline thread; no CrewAI/Python, persistence, scheduling, Worker launch, Team UI, packaging, or P6 phase acceptance |
| P6 admitted team-plan persistence                  | Local implementation; exact-head CI pending                       | Schema 14 `team_plans`; persist-before-return; exact Core reload validation; canonical JSON digest; idempotent retry and identity-conflict denial; substituted-response fail-closed client; 5 focused files/64 tests plus corrected 1-test utility-service assertion; strict TypeScript and targeted zero-warning lint/format pass; the sole root attempt passed all pre-test gates and 679/5 tests before the corrected stale schema assertion; no second local root gate; scheduling, state-machine execution, CrewAI/Python, Worker launch, Team UI, packaging, and P6 acceptance remain absent |
| Native AionUi source                               | Exact local desktop snapshot                                      | AionUi `v2.1.41` at `2d8925fc67a97a20996fadcd2a0862b778b572ba`; 1,766 files; no local modification inside snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Native preservation contract                       | Local pass                                                        | Manifest SHA-256 `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`; 27 routes and 41 bridge domains verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Native AionUi build and launch                     | Local pass                                                        | Frozen install, production build, isolated native Electron launch, and actual Guide screenshot pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Native AionUi tests                                | Latest local pass                                                 | Final Worker-crash input: 345 files passed, 1 skipped; 2,665 tests passed, 5 skipped; 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Legacy product shell                               | P3 harness only                                                   | Original Actestra Electron/React shell remains for platform-contract and packaging regression; it is not the target product UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Renderer boundary                                  | CI-backed through P3.6                                            | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, exact frozen preload allowlist, trusted-frame zero-argument IPC, and direct-client source checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Automated tests                                    | Exact merged-main CI pass                                         | Main run 30378191752 passes 24 Vitest files with 130 tests, the exact Electron SQLite probe, process-failure harness, 34-source boundary check, build, package identity, and clean-profile smoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Desktop package                                    | Final-byte local Apple Development-signed evidence; not notarized | `/private/tmp/actestra-p4-worker-crash-final.J8Jw8M/out/mac-arm64/Actestra.app` passes independent package verification, 4/4 exact production-entry ASAR hashes, AionCore `0.1.52`, 14/14 pinned Hub Git blobs, 13/13 Hub ZIPs, 4/4 Croner/docx/Electron notice checks, 25 signed actual arm64 Mach-O files, 17 valid symbolic links, and schema-13 target-app tool-failure plus external-Worker-crash restart smoke. It is not a notarized candidate, release, distribution, or user-acceptance artifact                                                                                                                                                               |
| P3 domain contracts                                | Implemented and CI-backed                                         | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P3 event contract                                  | Implemented and CI-backed                                         | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3 persistence and migrations                      | Implemented and CI-backed                                         | ADR-0005 schemas 1 and 2 plus ADR-0008 schema 3 for privileged audit and terminal-attempt evidence; exact runs above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3 worker lifecycle                                | Implemented and CI-backed through GW-P4.3                         | ADR-0006 protocol v1, supervisor, lifecycle, and fake are accepted; ADR-0017 supersedes only the AgentAdapter version/interface with v2 and adds a separate General Worker protocol v1, typed tool results, and a real deterministic utility process                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3 privileged services                             | Implemented and CI-backed                                         | ADR-0007; protected-operation and manifest contracts; policy, approval, opaque lease, metadata-only audit, and deterministic gateway services; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P3 main integration                                | Implemented and CI-backed                                         | ADR-0008; main-only inert composition, durable audit, persist-before-release barrier, fixed IPC allowlist, bounded renderer projection, and packaged startup smoke; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| F2 shadow persistence                              | Local and CI-backed contract evidence                             | ADR-0011; schema version 4; gapless and idempotent metadata-only evidence; no authoritative domain or event writes; real Guide read remains local proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F3.1 approval response persistence                 | Implemented and CI-backed                                         | ADR-0012; schema version 5 immutable response and delivery outbox; exact implementation run 30425061316; restart and explicit-fallback live proof remains local; native pending-request and protected-operation authority remain separate                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Release                                            | None                                                              | No candidate, signed artifact, deployment, distribution, or user acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

<!-- markdownlint-enable MD060 -->

## Accepted direction

- Actestra is independent from Aera.
- AionUi `v2.1.41` is the preserved product application, functional UI, and
  general-work foundation. The default is to retain original functions and
  workflows, not selectively redraw them.
- Actestra authority is introduced below stable AionUi bridge shapes one domain
  at a time; unready effects keep their UI and receive an explicit isolated
  state.
- Goose is integrated through a specialized worker adapter exposed by the
  preserved AionUi agent/ACP experience.
- CrewAI is the first candidate for a supervised P6 planning, replanning, and
  aggregation sidecar. Actestra validates every candidate and remains the
  authoritative team state machine.
- Eigent-style orchestration is mapped into the preserved AionUi Team
  experience as a product and acceptance reference; its repository, separate
  UI, backend services, and complete runtime are not imported wholesale.
- Actestra owns workspaces, tasks, permissions, credentials, events, artifacts,
  and audit history.
- External workers run behind stable adapter, event, and policy boundaries.

## P2 acceptance evidence

| Requirement                                                                             | Result                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent identity, icon, protocol, and data path                                     | Pass on merged `main`                                                                                                                                      |
| No upstream or Aera brand, account, endpoint, updater, telemetry, or application source | Pass on merged `main`                                                                                                                                      |
| Sandboxed renderer and narrow preload bridge                                            | Pass on merged `main`                                                                                                                                      |
| Deny-by-default permissions, navigation, windows, and external network                  | Pass on merged `main`                                                                                                                                      |
| Account-free clean-profile launch                                                       | Pass locally and in CI smoke                                                                                                                               |
| Unsigned macOS arm64 app, DMG, and ZIP packaging                                        | Pass locally; deliberately non-candidate                                                                                                                   |
| Packaged identity, notices, CSP, and architecture verification                          | Pass locally and in CI                                                                                                                                     |
| Independent review remediation                                                          | 13 valid CodeRabbit CLI issues fixed; one invalid `void` Promise suggestion documented                                                                     |
| Final GitHub review                                                                     | No submitted review; CodeRabbit summary/status succeeded on the exact final head with 0 review threads, then the owner merged after CLI remediation and CI |
| Final PR-head CI                                                                        | Pass on `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`                                                                                                         |
| Main CI                                                                                 | Pass on squash commit `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`                                                                                           |

Detailed commands, review history, package hashes, screenshot, and non-claims are
in [P2 Product Shell](product/P2_PRODUCT_SHELL.md).

## P3 entry scope

P3 must establish Actestra-owned contracts before any real external worker is
adapted:

1. task, session, workspace, worker, approval, event, and artifact models;
2. a versioned unified event envelope and ordering rules;
3. the `AgentAdapter` lifecycle and deterministic fake worker;
4. persistence ports, an accepted storage decision, and forward migrations;
5. credential, policy, approval, MCP/tool, and audit service boundaries;
6. heartbeat, timeout, crash, restart, and cancellation semantics;
7. tests proving the renderer cannot bypass main-process authority.

The ordered implementation index and P3 non-claims are in
[P3 Platform Core](product/P3_PLATFORM_CORE.md).

## Next gate

1. Preserve the four completed CodeRabbit dispositions and final manual 51-file
   closure. The two follow-up confirmations were rate-limited before analysis;
   do not represent them as zero-issue evidence or retry without a changed
   external quota/seat condition.
2. Preserve the final-byte root/native, production-build, new arm64 package,
   verifier/signature, ASAR/resource, and schema-13 target-app smoke evidence;
   do not promote the Apple Development signature to notarization or release.
3. Preserve exact final schedule head
   `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, PR CI 30659567604, squash merge
   `5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and merged-main CI 30660078199.
   The rate-limited CodeRabbit summary is not formal review evidence.
4. Preserve representative tool-failure final head
   `077f30bcfa3929959c971d08081092bbf976e2ee`, PR CI 30673687603, squash merge
   `c7c414c0c5a126b276fb02b372e02fff437e5f23`, and merged-main CI 30673919260,
   together with its completed 15-file manual review and final scope audits.
   Do not retry the unchanged rate-limited CodeRabbit request or represent its
   Free summary as line-level review.
5. Preserve Worker-crash/recovery implementation
   `47ed445eab204c0998e44167455c062600158dd3`, exact final head
   `3593fac8db48a0cb149bb6c736374eeaccebe332`, PR CI 30687199671, squash merge
   `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`, and merged-main CI 30687433298,
   together with its completed 14-file manual review and exact scope audits.
   Do not retry the unchanged CodeRabbit rate limit or represent its status as
   formal review.
6. Preserve P5.1 hotfix head `eed1623e9849b9f662f3dec690d02d7c85a693ef`,
   PR CI 30699859869, squash merge
   `d313fb2ed65e4b010f777435953752818fbbfae4`, and merged-main CI
   30700441312 together with its complete manual/static review, local signed
   package, and PR/main packaged external-`SIGKILL` recovery evidence.
7. Preserve P5.2 foundation exact head
   `c10110b38e8714b831a6d6d0fc09aa8df4218b7c`, PR CI 30808650150, squash
   merge `266e3857bed7d4c32b773f92deff676bf2144b15`, and merged-main CI 30809931486. Do not represent the rate-limited CodeRabbit walkthrough as
   line-level review. Preserve desktop-main composition final head
   `5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`, PR CI 30817462671, squash
   merge `f55b5550c6ac189f09536061a70e8c8c7299c4f4`, merged-main CI
   30818949121, and its exact-head 12-file/0-issue re-review. Preserve ACP
   `session/new` delivery through PR 33 and authenticated MCP delivery through
   PR 35 at exact merge `8a31bafc1cd322744189fc4ed1e68f769225c999` and
   merged-main CI 30834217310. Preserve PR 36 old-head CI 30837296114 as a
   macOS-pass/Goose-session-rejected failure without rerunning that SHA, and its
   corrected merge `08e6fefcd87721fbe4f21eee73f9ba6c52a638c0` with merged-main
   CI 30845006202. Preserve the tool-call bridge through PR 37 exact head
   `84b0550495717343b75ca2540cb7c191ab65b12a`, merge
   `d933546454e63a2d836e728f1b93980cb4a7c0ac`, and merged-main CI 30853499159. Preserve PR 38 exact head
   `cc773081ba448266951a3b2ac3654831022118fc`, passing exact-head CI
   30859115162, merge `a6280dd38eacdbada9db159c4784110ec8e42770`, and failed
   merged-main CI 30860137257 as separate evidence; do not rerun or describe the
   failed SHA as closed. Preserve the bounded-deadline correction exact head
   `38cbbaaedbb8e5955b96a6d7148841180e751e35`, exact-head CI 30861770178,
   merge `7e8732e264febff42fb3d451011b3b8e48caaff5`, and passing merged-main CI 30862710547. Preserve desktop-main lifecycle exact head
   `c35f8c37c14dedaa980dfbb539f16fc21379be8a`, exact-head CI 30865837496,
   merge `1909033977576d94f6983f9c911b8e0a866a59de`, and merged-main CI
   30866691199. Preserve approval-outcome exact head
   `917a95260d84f09aacf5038d92a5230d1781676d`, exact-head CI 30870425378,
   merge `7dfc4973021d68d5df0ded12fa218ecd42da9691`, and merged-main CI
   30871703449. Preserve durable-evidence PR 42 and publish/Artifact PR 43 exact
   head `305a29d9b2b514865983ae9d8a23f877566bb7a5`, squash merge
   `9048fe2cc23819f596d8721adb8c544dcd0b786f`, and merged-main CI
   30884138218. Goose may not receive builtins, the original checkout, raw
   credentials, or a second UI.
8. Preserve P5.3 exact head `15a8e29b44a6684313f29a694f0d0615de95cf36`,
   exact-head CI 30899489690, squash merge
   `ee8425e39e201078cd64fe3af38355279ecf56de`, and merged-main CI
   30900884248 together with the retained AionUI journey, real-Goose publish
   and cancellation proof, native compatibility, and source-checkout
   preservation.
9. Close the schema-14 admitted-plan persistence slice through exact-head and
   merged-main evidence, then add the Actestra-owned scheduling state machine
   before any supervised sidecar lifecycle. Do not give a planner process,
   worktree, credential, approval, tool, or durable-state authority.

## Open decisions

- License for original Actestra source.
- Credential storage mechanism and platform-keychain boundary.
- Content-reference retention and any future binary, streaming, large-payload,
  or broader native-tool capability.
- Worker sandbox implementation per operating system.
- Long-term dependency upgrade policy.
- Code-signing, notarization, update, and distribution accounts.
- AionCore license clarification and accepted binary provenance before
  distribution.
- CrewAI production version and rollback pin, minimal dependency lock,
  executable sidecar transport, vulnerability evidence, and cross-platform
  packaging strategy. The Core plan-admission protocol does not settle those
  runtime choices.
- Cloud identity or sync scope, which remains outside the initial MVP unless
  promoted by a new product decision.

## Known blockers and non-claims

- P3.1 through P3.6, review remediation, the final PR head, squash merge, and
  exact merged-main CI are evidenced. P3 phase acceptance is not a release or
  user-acceptance claim.
- The final redundant full-diff confirmation was rate-limited before review and
  is not zero-issue evidence. The completed 67-file review plus the completed
  zero-issue nine-file remediation review are the review-closure evidence.
- Incremental CodeRabbit run `5d4c70ac-5432-4ea0-af1e-2bf51db50362` was
  rate-limited before reviewing the four Ready-state documents. Its successful
  GitHub status is not review evidence; local documentation checks and exact
  CI run 30376456379 passed for those files.
- Incremental CodeRabbit run `226b4810-7e15-495f-a3f9-50cf0536fb8c` was also
  rate-limited before reviewing the final four-document status range. Its
  successful status is limit-handling evidence; exact final-head CI run
  30376696055 passed.
- The current branch runs schemas 1 through 13 in the dedicated
  persistence utility. The downstream main accepts one fixed
  shadow-observation operation and one fixed desktop confirmation response
  operation. F3.2 gates only that response's native delivery, while F3.3
  separately gates only the boolean pending-state reconciliation read. The
  accepted GW-P4.6 bridge additionally accepts strict submit/list/cancel/preview
  intents and returns only redacted status or bounded owned content. It exposes
  no renderer-selected filesystem path, generic protected operation, generic
  tool transport, credential value, or worker control.
- The P3.4 deterministic fake remains test infrastructure. Accepted GW-P4.3
  adds a real deterministic utility process and packaged-process probe.
  Accepted GW-P4.4 connects its blocked fixture to exactly two main-owned text
  tools. PR 19's ADR-0022 Office slice adds a third closed create-only tool
  under the same gateway. Accepted GW-P4.5 coordinates durable non-UI journeys.
  Accepted GW-P4.6 adds the first user-submitted preserved-AionUI task and its
  target-app restart, denial, and cancellation smoke. The accepted
  representative-file, local bounded research, writing, and Office
  implementations reuse that authority without adding renderer-selected paths
  or network research. Office is accepted on `main` through exact PR head
  `091f786d57c6b4569cdaac17ea969a0b9070ea02`, merge
  `505afb2f3916e75c7abb07cdf461bda29a602b9b`, and merged-main CI 30602821085.
  ADR-0023's schema-13 provider, timers, and recovery are accepted through PR 20,
  exact final head `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, PR CI
  30659567604, squash merge `5b0748af674165f9e9475be61dc1e02a1b08c8bc`,
  and merged-main CI 30660078199. Its final-byte root/native gates, new local
  package, package audits, and target-app smoke remain distinct local evidence.
  PR 24 closes the remaining Worker-crash/recovery evidence, so P4 is accepted
  at exact merged head `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe` with merged-main
  CI 30687433298.
- P3.6 makes metadata-only audit and terminal-attempt evidence durable.
  Approval, credential-lease, and policy state remains in memory and contains no
  secret value. F3.1 separately makes the bounded native confirmation response
  and outbox durable. F3.2 activates the accepted P3 sequence for exactly
  one compatibility delivery capability, not for generic native tool
  execution.
- GW-P4.2 removes synchronous SQLite from both root and native Electron main
  entry graphs and is accepted on `main`. It has no in-main fallback.
  GW-P4.5 adds deterministic application-start recovery, not transparent live
  replacement of a failed persistence utility. GW-P4.6 adds prepared-task
  restart only after native backend/window readiness and does not rebind the
  stored workspace from current native state.
- F2 shadow evidence is renderer-originated compatibility evidence, not trusted
  audit, product, policy, approval, migration, or user-workload state.
- The P3 contracts and fake-worker gate have passed. The bounded deterministic
  General Worker is accepted through GW-P4.3. Exactly two scoped native text
  tools are accepted through GW-P4.4; accepted Office adds one create-only DOCX
  tool under ADR-0022. Task/artifact coordination
  and recovery are accepted through GW-P4.5. Preserved-AionUI journey mapping
  and the
  representative-file extension are accepted through GW-P4.6 plus PR 16. The
  bounded local-research extension is accepted through PR 17 and exact
  merged-main CI. Writing is accepted through PR 18 and exact merged-main CI.
  Office is accepted through PR 19, final PR CI 30602624426, squash merge
  `505afb2f3916e75c7abb07cdf461bda29a602b9b`, and merged-main CI 30602821085.
  Schedule is accepted through PR 20, exact final head
  `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, PR CI 30659567604, squash merge
  `5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and merged-main CI 30660078199.
  Representative tool-failure is accepted through exact final head
  `077f30bcfa3929959c971d08081092bbf976e2ee`, PR CI 30673687603, squash merge
  `c7c414c0c5a126b276fb02b372e02fff437e5f23`, and merged-main CI 30673919260,
  while its local package remains distinct unnotarized evidence.
  Worker-crash/recovery is accepted through exact final head
  `3593fac8db48a0cb149bb6c736374eeaccebe332`, PR CI 30687199671, squash merge
  `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`, and merged-main CI 30687433298.
  Full representative P4 acceptance is closed. The specialized Goose P5.2
  containment foundation, desktop-main containment, ACP session lifecycle, and
  authenticated MCP transport and tool-call bridge are delivered on `main`;
  the authenticated model-backed prompt/tool loop and bounded test deadline are
  delivered through exact merge `7e8732e264febff42fb3d451011b3b8e48caaff5`
  and merged-main CI 30862710547. The desktop-main Goose lifecycle is delivered
  through exact merge `1909033977576d94f6983f9c911b8e0a866a59de` and
  merged-main CI 30866691199. Approval continuation and denial projection are
  delivered through exact merge `7dfc4973021d68d5df0ded12fa218ecd42da9691`
  and merged-main CI 30871703449. Durable normalized evidence is delivered
  through PR 42. Publish/Artifact registration and P5.2 acceptance are closed
  through PR 43, squash merge `9048fe2cc23819f596d8721adb8c544dcd0b786f`,
  and merged-main CI 30884138218. P5.3 is accepted through PR 44, squash merge
  `ee8425e39e201078cd64fe3af38355279ecf56de`, and merged-main CI
  30900884248. P6 admission is accepted through PR 45 and exact merge
  `30742934adde1e0944c4e8ced1f005452a1f3568`. The current local slice proves
  schema-14 admitted-plan persistence, but not scheduling, sidecar supervision,
  Worker execution, Team UI, or recovery.
- F0 alone proves only that the original AionUi application can be preserved
  and run. F1, F2, F3.1, F3.2, and merged F3.3 add their separately recorded
  identity, shadow, narrow decision-authority, fixed-delivery audit, and
  reconciliation-read audit evidence; they do not prove permission-complete
  native operations, Goose, CrewAI, or Eigent-style integration.
- ADR-0015 chooses a P6 candidate and authority boundary; it is not a CrewAI
  dependency, sidecar implementation, packaged runtime, or Team-completion
  claim.
- The local AionCore `v0.1.52` bundle is ignored and used only for native launch
  proof. It is not committed, packaged, or approved for distribution.
- The upstream managed-Node path and Sentry startup path remain in retained
  source. F1 disables their unowned external effects by default while keeping
  the corresponding functional UI and recovery states.
- Draft pull request 5 follows the displaced custom-shell general-work route.
  Preserve it for compatible P3-core mining, but do not merge it as the product
  UI foundation.
- PR 6's Ready-triggered GitHub CodeRabbit check returned success but
  explicitly skipped because 1,774 files exceeded its 150-file limit. It is not
  line-by-line review evidence. The separate scoped local review did complete
  across the 21 final changed files with zero findings before the evidenced
  squash merge.
- The local P2 package remains deliberately unsigned and is not a candidate.
- The `main` branch currently has no GitHub branch-protection rule; explicit
  owner-gated PR discipline remains required.
- CI runs 30339662937, 30350732223, and 30378191752 passed, but GitHub
  annotated the pinned checkout and setup-node actions as Node 20-targeting
  actions forced onto Node 24; this is a dependency-maintenance item, not
  failed P3 evidence.
- Signing, notarization, SBOM, provenance, clean-machine installation, update
  metadata, and cross-platform acceptance remain future gates.
- There is no release, deployment, distribution, or user acceptance.

## Update policy

Every material status update must state:

- exact branch and commit;
- commands run and their results;
- whether evidence is local, pushed, CI-backed, packaged, released, deployed, or
  user-accepted;
- unresolved blockers;
- the next phase gate.
