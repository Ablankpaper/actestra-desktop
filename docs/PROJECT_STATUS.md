# Project Status

Last updated: 2026-08-20

## 2026-08-20 P8.2c Batch 3 Task 11 MCP-free Windows ACP composition (local/package green; native gate open)

Task 11 is implemented locally on top of `ffc005f`. ACP session options are
now a backward-compatible discriminated union: macOS/Linux retain the existing
MCP-HTTP `session/new` request, while the Windows authenticated mode sends
`mcpServers: []` and places neither a URL nor an attempt lease in ACP. The
Windows composition creates the Main-owned model and capability hosts, attaches
them to the Supervisor's duplex channels, binds both to the one ACP session,
waits for the exact six-tool discovery, and preserves the existing refusal and
rejected-request counters and durable error mapping. Existing loopback and
Linux relay composition tests remain unchanged and green.

Local evidence is green: the focused cross-layer suite passes `110` tests with
`2` platform skips; format, lint (zero warnings/errors), typecheck, and
`git diff --check` pass. The downstream overlay now declares the shared bridge
protocol as well as the new composition dependencies (`377` declared files),
and `bun run downstream:aionui:package` completes after materialization and
Electron/Vite bundling.

This does not close Task 11 or P8.2c: the Windows-only duplex test is skipped on
macOS, no exact-artifact Windows ACP/runtime/provider journey has run, and
Windows CI is still in progress. Task 12 exact Windows runtime evidence,
Electron/provider-backed acceptance, P8.3, P8.4, release, deployment, and user
acceptance remain open.

## 2026-08-20 P8.2c Batch 3 Task 10 explicit transport modes and seven-channel launch (local slice green; composition/native gate open)

Task 10's launch slice is implemented locally on top of `201f121`. The Main
side now selects an explicit transport mode from the exact runner target:
macOS uses the existing loopback path, Linux uses the existing socket relay,
and Windows is admitted only as `windows-authenticated`. Windows launch uses
the shared seven-channel order (ACP stdin/stdout/stderr, one-shot control,
parent liveness, capability, and model), with the last two channels represented
as duplex streams and no URL, SSE, or MCP endpoint added to the environment.
The existing Windows control contract remains unchanged; the new channel
module is registered in the downstream overlay so materialized package builds
include it.

Portable local evidence is green: the complete `bun run check` exits `0` with
`169` test files passed / `3` skipped and `1,808` tests passed / `11` skipped;
P7 abuse, smoke harness, product boundary, frozen foundation, downstream
overlay (`376` declared files), package, format, lint (zero warnings/errors),
typecheck, Electron SQLite, and `git diff --check` also pass. The Windows-only
duplex native test is skipped on macOS and therefore is not Windows evidence.

This does not close Task 10 or P8.2c: the Main bridge hosts are not yet attached
to the real Windows transport lifecycle, the ACP session still uses the
loopback MCP request shape, and no exact-artifact Windows runtime/provider
journey has run. Task 11 (MCP-free injected Windows ACP session), Task 12 exact
Windows runtime evidence, Windows CI, Electron/provider-backed acceptance,
P8.3, P8.4, release, deployment, and user acceptance remain open.

## 2026-08-20 P8.2c Batch 3 Task 9 Main authenticated bridge hosts (local slice green; native gate remains open)

Task 9 is implemented locally on top of `40cc9af`. Main now has separate
authenticated Windows model and capability bridge hosts around the existing
Actestra invoker ports. Both hosts consume the versioned length-prefixed frame
protocol, bind exactly one ACP session to the attempt lease, reject malformed,
stale, duplicate, wrong-scope, and cross-boundary requests, support bounded
cancellation, and close idempotently. The model host preserves the existing
failure vocabulary and counters: only a completion that passes Main's
completion contract and can be serialized onto the bridge counts as served;
broker or completion/serialization refusal counts as
`model-completion-refused`; malformed or duplicate requests count as
`rejectedRequestCount`. The capability host lists the exact six
`CODING_TOOL_IDS`, reuses the existing tool schemas and `parseCodingToolInput`,
and delegates execution to the existing `GooseMcpToolInvoker`; it does not
gain filesystem, Git, shell, credential, or network authority.

The protocol validator now also applies the existing coding-tool input
contract before a capability call frame is admitted, and the existing MCP
tool-list builder is shared by the Windows host so the Windows and loopback
surfaces cannot drift in tool names or schemas. New tests exercise successful
model and tool calls, refusal classification, malformed/wrong-scope input,
replay rejection, cancellation, session binding, exact six-tool discovery,
and idempotent cleanup.

Local evidence is green: the focused protocol/host suite passes `13` tests
with `56` assertions; `bun run check` exits `0` with `168` test files passed /
`2` skipped and `1,805` tests passed / `10` skipped. The same run passed the
P8 contract, Electron SQLite, P7 abuse gate (`28` cases / `168` variants),
smoke harness, product boundary, frozen foundation, downstream overlay, and
package gates. Format, lint (zero warnings/errors), typecheck, and
`git diff --check` also pass.

This does not close Task 9 or P8.2c yet: the Windows native runtime has not
consumed these Main hosts through the real Supervisor channels, and the
exact-head CI run `32271632641` is still in progress (Ubuntu build probe,
Goose admission, and macOS foundation are green; Windows build/containment,
Ubuntu containment, and the remaining CI jobs are not final). Task 10's
explicit transport-mode composition and seven-channel implementation,
Windows authenticated runtime integration, Electron/provider-backed
acceptance, P8.3, P8.4, release, deployment, and user acceptance remain open.

## Current phase

### 2026-08-19 P8.2c Batch 2 Task 7 local Worker runtime composition (native gate remains open)

Task 7 is now implemented locally on top of `5ca5ef8`, beginning with commit
`583bf21`. The Windows Worker no longer exits immediately after bridge
readiness. Its startup path has a fixed, fail-closed seven-stage order:
control validation, boundary verification, capability-pipe connection,
model-pipe connection, adapter construction, ready notification, and adapted
Goose ACP serving. The Worker constructs the existing
`WindowsModelProvider` and `WindowsCapabilityClient`, binds the fixed
`actestra` Provider identity and control-supplied model ID, installs the fixed
`actestra-capability-proxy` extension, creates `goose-data` and `goose-config`
only under the admitted attempt-private root, writes ready only after all of
those steps succeed, and then calls the pinned private Goose runtime's
`run_with_runtime_adapter()` entry point. It does not read Goose Provider,
model, URL, credential, or global data/configuration environment variables.

Portable local evidence is green: `cargo fmt --check`, `cargo test --locked`
for `workers/goose-runner` (`81` tests passed), `git diff --check`, and the
complete `bun run check` (`165` test files passed / `2` skipped and `1,792`
tests passed / `10` skipped, followed by P7, smoke-harness, product-boundary,
frozen-foundation, downstream-overlay, and package gates at exit `0`). The new
tests lock startup ordering, every transition's stop-before-later-stage
behavior, skip/replay rejection, symlink-safe private Goose state directories,
first-discovery session binding, and a real in-process `initialize` -> MCP-free
`session/new` -> injected-extension tool-discovery exchange through the pinned
Goose ACP agent. That in-process exchange caught and closed a real defect: the
shared model/capability session cell was previously never populated, so the
first injected tool discovery would have failed closed before Main could bind
the session. The capability adapter now atomically binds the first valid
Goose-supplied session ID and rejects every later mismatch. The complete gate
also reproduced an existing shell-fixture race in the Windows control-channel
test: file existence could be observed after redirection created an empty file
but before `cat` finished. The regression now makes that window deterministic,
waits for the later launch-evidence completion marker, and only then reads and
compares the exact control frame; the focused suite passes `7` tests with the
native-Windows case skipped on macOS.

This does not close Task 7 or P8.2c. The full Windows-target Cargo check was
attempted again and remains blocked on this macOS host by the existing native
C toolchain gap (`zstd-sys`, `libsqlite3-sys`, and tree-sitter builds cannot
find Windows CRT headers/tools); this is not Windows execution evidence. The
real Windows native startup/ACP session, exact-artifact authenticated runtime
integration, Windows CI, and Electron/provider-backed acceptance remain open.
The subsequent Task 8–11 Main bridge/composition work and Batch 4 evidence/CI
tasks are not claimed complete. P8.3, P8.4, release, deployment, and user
acceptance remain open.

### 2026-08-19 P8.2c Batch 2 Task 6 local supervisor-relay implementation (native gate remains open)

The Windows Supervisor composition now has the Task 6 source slice in place:
Main launches seven ordered channels (ACP stdin/stdout/stderr, one-shot control,
parent liveness, and duplex capability/model), while the Worker inherits exactly
five handles (the three ACP handles plus dedicated control-read and ready-write
handles). The Supervisor creates the two attempt-scoped `LOCAL` named pipes,
accepts both AppContainer clients before consuming the dedicated ready marker,
and relays ACP bytes plus bounded length-prefixed capability/model frames. The
framed relays reject zero or oversized payloads, handle partial reads/writes,
and terminate on disconnect. Parent-liveness close, Worker exit, relay failure,
and the fixed active-duration budget are terminal; cleanup is bounded and emits
the primary failure and an independent cleanup-failure code when both occur.
The pre-Task-7 Worker intentionally fails closed after bridge readiness because
the adapted Goose ACP/provider runtime is not yet present.

Local evidence on branch `codex/p8-2c-windows-runtime-composition` is green:
Goose Rust tests pass `74/74`; the focused Supervisor, diagnostic, bridge,
lifecycle, and Main setup-classification suite passes `66` with `1` platform
skip; TypeScript typecheck, project format, documentation links, and
`git diff --check` pass. An isolated Windows-target API probe using the current
source passes. The complete Cargo Windows-target check cannot run on this macOS
host because the existing `zstd-sys`/`libsqlite3-sys` C builds lack the Windows
CRT; this is environment evidence, not Windows native execution. The complete
local `bun run check` exits `0`: Vitest reports `165` files passed / `2`
skipped and `1,792` tests passed / `10` skipped; the P7 gate passes all `28`
cases and `168` exact variants; smoke harness, product boundary (`143`
Actestra-owned source files), frozen foundation, downstream overlay, and
package checks all pass.

This does not close Task 6 or P8.2c: Windows native execution, exact-artifact
CI, and real relay behavior remain unverified. Task 7 must add the adapted Goose
ACP/provider runtime and startup-order tests before any Windows runtime or
Electron/provider-backed acceptance claim. P8.3, P8.4, release, deployment,
and user acceptance remain open.

### 2026-08-19 P8.2c Batch 1 private Goose runtime admission accepted

The P8.2c source boundary now pins the standalone private
`Ablankpaper/actestra-goose-runtime` repository at immutable commit
`e246f395592b01995cd34faf5e3ce1ed5444a41a`, descending from canonical Goose
`v1.45.0` commit `4dc0420f5704a92806c6628c8f0a3497d7a88759`. The admitted
binary full-index diff changes exactly the three declared ACP server files and
has SHA-256
`a5f2df85313dbbd1ac20bef3fafba4e40e32e2ffa0c76ad5a5d62414d1eae1f4`.
The private runtime is Apache-2.0, upstream has no root `NOTICE`, its adapter
seam is default-off, and the admitted Goose Cargo feature set remains empty.

The Actestra artifact and build contracts fail closed on canonical repository,
base, private repository, runtime commit, changed-path set and order, patch
digest, lock source, and feature drift. Six existing CI jobs admit the private
source only for same-repository work. They load a repository-scoped read-only
deploy key after dependency installation, run one frozen `cargo fetch`, then
delete the key and clear the SSH command before tests, builds, or Artifact
uploads. The private repository is not a GitHub Fork; its default branch stays
at the canonical base, GitHub Actions are disabled, and it has no webhook or
automatic upstream synchronization.

Local Batch 1 evidence is green: source and workflow tests pass 98/98, runner
Rust tests pass 53/53, `cargo metadata --locked` resolves the exact private
commit, and the real metadata/check-out contract verifies source, ancestry,
changed paths, patch digest, and features. Project format, Rust format, lint
(zero warnings and errors), typecheck, documentation links (96 Markdown
files), and `git diff --check` pass.

The first pushed Batch 1 head `497bd243cbdd6d75ac55f19e8b4b7686a46f0a4d`
started pull-request run
[`32249392029`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32249392029).
Both Windows jobs failed before private-source fetch because Git Bash
`install -m 700 -d` could not change permissions on the NTFS-backed
`RUNNER_TEMP`; Ubuntu completed the same credential setup and fetch. The run
was cancelled because its remaining results could not verify the corrected
head. The local correction keeps key creation, frozen fetch, and trap-based
deletion in one step, normalizes only the Windows temporary path with
`cygpath`, and applies POSIX modes only on non-Windows runners. A new exact-head
CI run was required.

The corrected exact head `87e3d29268920ce2d4ba3f179a913a51cf7cbfb0`
passes pull-request CI run
[`32249942348`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32249942348)
with all six jobs green: Windows and Ubuntu x64 Goose build probes, Windows and
Ubuntu x64 Goose containment, macOS arm64 foundation, and Goose runner
admission. Every job fetched and admitted the exact private runtime. The two
Windows jobs crossed the prior NTFS setup failure, Windows containment passed
against the exact artifact, and the admission job passed the real Goose ACP
handshake and cleanup. This closes Batch 1 source, provenance, credential
scope, and exact-head CI admission only.

This is source/provenance admission only. No adapted Windows Goose session,
authenticated model/capability bridge, Electron package, P8.2c exit, P8.3
candidate integrity, P8.4 real-provider acceptance, release, deployment, or
user acceptance is claimed. Rollback restores canonical Goose
`4dc0420f5704a92806c6628c8f0a3497d7a88759` and keeps Windows production
runtime admission disabled.

### 2026-08-19 P8.2b Windows containment verified; P8.2b gate closed

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
head `c9871dac252ec9c1d6092b0704b14dbdc85e31fe`. Pull-request run
[`32220641275`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32220641275)
completed all six jobs successfully: Windows build probe, Windows containment,
Ubuntu build probe, Ubuntu containment, Goose runner admission, and macOS
foundation. The Windows containment job completed both exact acceptance and
success-only evidence preservation.

The preserved evidence Artifact
`p8-goose-containment-windows-6878da53ff453a982ac58803a3f9d4ded8559798`
contains a verified record for `x86_64-pc-windows-msvc`:

- manifest SHA-256: `cd9562bb73395849cb53c44e56ce80c01bc54865ea913506cc0abd4c3665993d`
- executable SHA-256: `3b144602c317884977a0131973be129ac41dabe10d299f37c6658cdfc39b74bf`
- probe SHA-256: `dd3d0e3c32ae0686297540cb2b69cefaecf4a99868c86ebabe7d68808dd7fd22`
- evidence status: `verified`

This closes the Windows P8.2b containment gate. The verified run crossed the
AppContainer, inherited-environment, Job/resource, parent-side excluded-handle
identity, filesystem, network, process-tree, parent-death, and cleanup checks.
For the network check, the supervisor first reached and drained the positive
host control connection; the Worker then timed out without a server-side
Worker connection. The final aggregate now consumes that already-verified
network result, so a valid timeout is not rejected by the old `denied()`-only
completion check. Other network outcomes remain fail-closed.

The preceding exact-head run `32219446833` failed only with
`windows-job-evidence-incomplete`: the composite network proof had succeeded,
but the final completeness helper still required `network_outcome.denied()`.
The one-line semantic split was covered by Rust tests and corrected in this
head. Local focused validation is green: Rust 53/53, containment diagnostics
10/10, format, lint (0 warnings / 0 errors), typecheck, docs (94 Markdown
files), and `git diff --check`. This closes P8.2b only; overall P8.2 product
journeys, P8.3 candidate integrity/signing, P8.4 clean-machine and
real-provider acceptance, release, deployment, and user acceptance remain
open.

### 2026-08-19 P8.2b Windows timeout selected; controlled denial repair local (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
diagnostic head `2e661d3ac284f346b1084809516fb5dfc7aaa83c`. Pull-request run
[`32217053851`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32217053851)
completed five jobs successfully and failed only Windows containment job
[`95960429255`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32217053851/job/95960429255).
The exact Windows runner passed native-primitives compilation and execution,
frozen-lock verification, build, and Artifact admission. Its manifest SHA-256
was `84b7996de29e1fd2090d1a01aad51f5120ed75fc6a22a35e7c6582cd241ee374`,
its executable SHA-256 was
`1f882d46d88c13a11a54958681e03ceb757a8c1eac90cba0c8e954072e0c7f80`,
and its executable size was 487,936 bytes. The containment run then selected
the closed `windows-network-timeout` category; the success-only evidence upload
was skipped.

The result proves the capability-free AppContainer Worker could not establish
the hostile loopback connection during the fixed two-second attempt, but a
timeout alone is not sufficient evidence that the listener and host network
path were healthy. The local repair therefore does not admit an unconditional
timeout. Before launching the Worker, the supervisor connects to the same
listener through its ordinary host token and drains that exact accepted
connection. If this positive control fails, the probe exits nonzero as
`windows-network-control-invalid`. After launch, a timeout is accepted only
when the listener accepted no Worker connection. A successful Worker connect,
missing control, refused/unreachable address, unavailable network stack,
missing raw status, or any unclassified result remains nonzero and
non-admitting.

The composite rule was written RED to GREEN. Its test requires all three
conditions independently: host control reachable, Worker timeout, and no
server-side Worker connection. Portable Rust tests pass 53/53 and containment
diagnostics pass 10/10 locally. The probe does not expose the listener address,
port, raw WinSock value, error text, path, handle, environment value, or
credential, and it does not grant an AppContainer network capability or widen
production Worker authority.

Two fresh complete `bun run check` attempts both passed format, lint,
typecheck, the P8 contract, and Electron SQLite, then stopped in the broad
parallel test phase on two different existing process-timing failures. The
first read a shell-created but still empty Windows-control fixture; its
isolated rerun passed 7 tests / 1 platform skip. The second timed out while
cleaning a Team model probe group; its isolated rerun passed 94/94. Neither
failure touches a changed file or reproduces in isolation, but neither failed
complete run is reported as GREEN. The preceding exact diagnostic head passed
all six CI jobs except the expected Windows containment discriminator, and the
preceding local diagnostic commit completed `bun run check` at exit 0. A new
exact-head Windows run must compile and execute the positive control, verify
all six capabilities, and preserve the success-only evidence Artifact before
P8.2b can close. Overall P8.2, P8.3, P8.4, candidate creation, release,
deployment, and user acceptance remain open.

### 2026-08-19 P8.2b exact-head HANDLE proof passed; Windows network error split local (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
head `0ee4bf1c40d0a7a6b43789fdf3b54990ac3d1c11`. Pull-request run
[`32215185835`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32215185835)
completed five jobs successfully and failed only Windows containment job
[`95955252370`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32215185835/job/95955252370).
The exact Windows runner passed native-primitives compilation and execution,
frozen-lock verification, build, and Artifact admission. Its manifest SHA-256
was `be1a68fa48bee8d05f36984651c40e8b21b28f199a89ed7c3a83714214b691fd`,
its executable SHA-256 was
`b5de68c6184a82fcd3e3ec4791fcdf3fc988dda2a56d32242ea113d1bb05d78f`,
and its executable size was 486,400 bytes. The containment run then failed
closed at `windows-network-other`; the success-only evidence upload was
skipped.

This result verifies the parent-side `DuplicateHandle` plus
`CompareObjectHandles` proof on Windows 2025. The deliberately excluded object
was not inherited or ambiguous, the Worker reached the hostile network probe,
and no handle-value collision was misclassified. It does not prove network
containment: the preceding diagnostic grouped every remaining raw WinSock
value and every missing raw value into `other`, so the result cannot justify
admitting a new network denial category.

The local follow-up is diagnostic only and was written RED to GREEN. It splits
the previous `other` bucket into address unavailable, invalid argument,
network-stack unavailable, permission denied without a raw code, raw code
absent, and unclassified. It uses only `std::io::ErrorKind` and a closed set of
WinSock values; no raw value, error text, path, address, port, handle,
environment value, or credential enters the result frame or public
diagnostic. `WSAEACCES` remains the only accepted network-containment result.
Every new category remains nonzero and non-admitting. Focused portable Rust
tests pass 52/52 and containment diagnostics pass 10/10 locally. A new
complete `bun run check` exits 0 with 164 test files passed / 2 skipped and
1,761 tests passed / 10 skipped, followed by the P7 abuse, smoke-harness,
product-boundary, frozen-foundation, downstream, and package gates. A new
exact-head Windows run is required to select the actual category before a
behavioral repair or an acceptance change is justified. P8.2b, overall P8.2,
P8.3, P8.4, candidate creation, release, deployment, and user acceptance
remain open.

### 2026-08-19 P8.2b parent-side handle proof passed; network outcome discriminator local (gate remains open)

Draft pull request #68 reached exact head
`5c78dedd04daaed2e134da3bdd5fb5de24521baf`. Pull-request run
[`32211250074`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32211250074)
built and admitted the exact Windows runner. Windows build-probe job
`95944224255`, Goose runner admission `95944224324`, Ubuntu build
`95944224126`, and Ubuntu containment `95944224194` passed. Windows
containment job
[`95944224178`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32211250074/job/95944224178)
passed build, frozen-lock, and artifact-admission steps, then failed the native
acceptance with `windows-network-evidence-incomplete`; the success-only
evidence upload was skipped. The exact Windows artifact had manifest SHA-256
`7b26769dccc5d64b0d9683a640886ae29e8f1b4285c8378f14026d851ac5dc36`,
executable SHA-256
`269b44778b2ce36f5da7c69c05196ba55a4e4eb75d7d4408d83b6d33d53b612d`,
and size 485,888 bytes.

This result proves that the parent-side suspended `DuplicateHandle` check no
longer terminates the child and did not classify the deliberately excluded
handle as inherited or ambiguous. The Worker completed the request and reached
the later hostile network evidence check. The network probe previously reduced
every non-`WSAEACCES` result and a successful connection to one boolean, so the
failure does not yet justify admitting another WinSock outcome as a denial.

The local diagnostic follow-up keeps every outcome non-admitting and records
only one closed category in the fixed internal result frame: access denied,
connected, timed out, unreachable, refused, other, or not attempted. The
public failure vocabulary maps these to bounded, path-free codes while only
access denied remains accepted as containment proof. The focused Rust suite
passes 52/52 and containment diagnostics pass 10/10 locally. A new exact-head
Windows run is required to identify the actual network outcome. P8.2b,
overall P8.2, P8.3, P8.4, candidate creation, release, deployment, and user
acceptance remain open.

### 2026-08-19 P8.2b parent-side excluded-handle proof implemented (Windows CI pending)

The `GetHandleInformation` route was removed after exact-head Windows run
`32207713253` / containment job `95934057414` showed that querying an invalid
handle inside the AppContainer Worker terminates the child before it can emit
the stage marker. The local implementation now keeps the proof in the
supervisor: while the Worker remains suspended and after Job assignment, the
parent calls `DuplicateHandle` against the Worker process handle table for the
deliberately excluded value. A successful duplicate is classified as
`windows-excluded-handle-inherited`; only `ERROR_INVALID_HANDLE` proves absence;
all other errors classify as `windows-excluded-handle-ambiguous` and fail
closed. The child receives only the parent-verified boolean in the bounded
request frame and no longer calls a Win32 API on an invalid handle.

The local RED tests are now GREEN: Goose runner Rust tests 52/52,
containment-diagnostics 10/10, Rust formatting, project formatting, lint,
typecheck, and `git diff --check` pass. `bun run check` also exits 0 with 164
test files passed / 2 skipped and 1,761 tests passed / 10 skipped, followed by
the P7 abuse, smoke-harness, product-boundary, frozen-foundation, downstream,
and package gates. These edits are still local at this point; PR #68 remains
at the preceding exact head `cc3b607`, whose Windows containment job is red.
The macOS host cannot execute the Windows MSVC/AppContainer branch. A new
exact-head Windows CI run must build the changed runner, pass containment, and
preserve the success-only six-capability evidence Artifact before P8.2b can
close. Overall P8.2, P8.3, P8.4, candidate creation, release, deployment, and
user acceptance remain open.

### 2026-08-19 P8.2b Windows excluded-handle probe isolated and local repair (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
head `f1839412f73c4279f715cbbc915e404849e75549`. Pull-request run
[`32205798445`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32205798445)
built and admitted the exact Windows runner, preserved the frozen lock, and
failed Windows containment job
[`95928734916`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32205798445/job/95928734916)
with `windows-child-excluded-handle-stage-invalid`. The ordered child
transcript proves that the AppContainer probe obtained standard input, read
the bounded request length and frame, decoded the request, and then terminated
inside the deliberately excluded-handle check. Build, Artifact admission,
AppContainer entry, and the request transport are therefore not the immediate
failure boundary.

The excluded-handle probe previously passed the deliberately non-inherited raw
handle value to `WaitForSingleObject`. The local repair instead uses the
read-only `GetHandleInformation` query and accepts absence only when that query
fails with the closed Win32 `ERROR_INVALID_HANDLE` value. A successful query or
any other error remains fail closed. No AppContainer capability, Job Object
limit, inherited-handle allowlist, environment cleaning, evidence-upload rule,
or runtime authority is widened.

The correction was written test-first: the focused test failed before the
implementation and now passes. All 52 portable runner tests, the containment
diagnostic suite (10/10), Rust formatting, documentation-link validation, and
`git diff --check` pass locally. The complete `bun run check` gate also exits 0
with 164 test files passed / 2 skipped and 1,761 tests passed / 10 skipped,
followed by the P7 abuse, smoke-harness, product-boundary, frozen-foundation,
downstream, and package gates. A minimal `windows-sys` 0.61.2 probe compiles
for `x86_64-pc-windows-msvc`; the macOS host still lacks the Windows C/assembly
toolchain needed to cross-compile the full Goose dependency graph. A new
exact-head Windows run must therefore compile and execute this Windows-only
branch, produce a verified six-capability containment record, and preserve its
success-only evidence Artifact before P8.2b can close. Overall P8.2, P8.3,
P8.4, candidate creation, release, deployment, and user acceptance remain open.

### 2026-08-19 P8.2b Windows child request stage isolated (substage verification pending)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
diagnostic head `a270f2405402f040fbb256deed2cd354520888a1`. Pull-request run
[`32204212767`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32204212767)
built and admitted the exact Windows runner, preserved the frozen lock, and
failed Windows containment job
[`95924090568`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32204212767/job/95924090568)
with `windows-child-request-stage-invalid`. This proves the AppContainer child
entered the probe role and wrote its entry marker, then terminated before the
request read completed. It rules out CreateProcess, AppContainer creation,
Job assignment, build, and artifact admission as the immediate failure stage.

The follow-up local diagnostic splits the request boundary into five fixed
sub-stages: standard-input handle admitted, length read, frame read, frame
decoded, and excluded-handle check complete. Together with the later
filesystem, network, process, and result-write stages, the transcript remains
an exact ordered byte sequence on the inherited stderr pipe. It never records
raw exit statuses, paths, environment values, handle values, SIDs,
credentials, or Win32 text. An invalid or mixed transcript remains
`windows-child-unexpected-exit-invalid`; every failure remains nonzero and
non-admitting.

The follow-up is locally validated by its RED-to-GREEN Rust test, containment
diagnostics 10/10, and Rust formatting. The preceding exact head passed the
Windows native-primitives compile, while the macOS host cannot compile the
runner's C dependencies for MSVC. A new exact-head Windows job is still
required to select the request sub-stage before a behavioral repair is
justified. P8.2b remains open until Windows containment produces and preserves
a verified six-capability evidence Artifact.

### 2026-08-19 P8.2b exact-head probe-route correction disproved; exit discriminator added (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
head `9ed17e80652352d164f1f9d3516bdc21ba92770a`. Pull-request run
[`32183130018`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32183130018)
completed with five successful jobs and one failed job. The Windows x64 build
probe (`95860608121`), Ubuntu x64 build probe (`95860608122`), Goose runner
admission (`95860608190`), Ubuntu x64 containment (`95860608214`), and macOS
arm64 foundation (`95860608256`) all passed. Windows containment job
[`95860608291`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32183130018/job/95860608291)
built and admitted the exact Windows runner, preserved the frozen lock, and
then failed the exact containment acceptance with the closed code
`windows-child-unexpected-exit-invalid`. The success-only Windows evidence
upload was skipped, so no failed result was retained as an admitting Artifact.

This exact result disproves the preceding route-only repair as a complete root
cause. The repaired bytes did compile and the separate native supervisor
primitives passed, but the real admitted runner still terminated after the
AppContainer child launch and before it returned its fixed result frame. The
old exit classifier collapsed explicit entry failure, Rust panic, Windows
image/dependency initialization failure, runtime fault, and every other
unexpected process status into the same code, so the run does not justify a
new behavioral repair.

The follow-up local change is diagnostic only and was written test-first. It
adds closed, path-free categories for child entry failure, Rust panic, known
Windows image/dependency loading statuses, and known runtime-fault statuses;
all other statuses remain `windows-child-unexpected-exit-invalid`. It does not
emit a raw status, path, handle, environment value, SID, credential, or Win32
message. Every category remains nonzero and non-admitting. The focused
diagnostic file passes 10/10, all portable runner tests pass 50/50, Rust and
project formatting pass, lint remains at zero warnings and errors, and
`git diff --check` is clean. Exact-head Windows CI is still required to select
the actual category before any root-cause repair is made.

No AppContainer capability, Job Object limit, inherited-handle allowlist,
environment cleaning, admission rule, `foundation/`, Renderer, preload,
provider, persistence, or UI authority was weakened or changed. Windows
containment, P8.2b, overall P8.2, P8.3, P8.4, candidate creation, release,
deployment, and user acceptance remain open.

### 2026-08-19 P8.2b Windows `LOCALAPPDATA` root cause proved and local repair (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
diagnostic head `4ea0d9ddaa9883bf32619c91baf5872e80737073`. Pull-request run
[`32158083962`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32158083962)
completed the native-primitives step in Windows build-probe job
[`95780046553`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32158083962/job/95780046553)
successfully before the remaining run was deliberately cancelled. The four
native tests passed in 0.15 seconds. The sanitized environment discriminator
reported the exact results:

- absent `LOCALAPPDATA`: `failure`, `environment-variable-not-found`, Win32
  `203`;
- attempt-private `LOCALAPPDATA`: `success`, Win32 `0`;
- restored runner `LOCALAPPDATA`: `success`, Win32 `0`.

The companion launch matrix also showed that production inheritance,
security-capabilities-only inheritance, handle-list-only inheritance, and plain
inheritance all created a process, while the two sparse custom blocks still
failed with Win32 `203`. This is native evidence that the production failure is
the cleaned supervisor environment omitting one Windows-required variable; it
does not authorize inheriting the host environment or weakening AppContainer,
the handle allowlist, Job Object, suspended launch, or fail-closed admission.

The follow-up local correction was written test-first. Before implementation,
four assertions failed because the strict environment lacked `LOCALAPPDATA` and
the attempt-private directory did not exist. Main now binds `LOCALAPPDATA` to
`<attempt-root>/local-app-data` and creates that directory with the other
attempt-private directories before transport startup. It does not read or copy
the host value. The parent-environment canary and credential sweep remain in
the exact whitelist test.

After the minimal correction, the three directly affected files passed 28
tests with one platform skip. The expanded environment, credential, resource,
Windows bridge, and lifecycle slice passed 76 tests with one platform skip;
Rust formatting and all 35 portable runner tests passed. A complete
`bun run check` then reached exit 0 with 163 test files passed / 2 skipped and
1,752 tests passed / 10 skipped, followed by the P7 abuse, smoke-harness,
product-boundary, frozen-foundation, downstream, and package gates. Existing
frozen-foundation bundler notices remain warnings rather than failed gates.

This local repair still requires exact-head Windows build-probe and containment
evidence. Windows runtime admission remains fail closed. P8.2b, overall P8.2,
candidate creation, release, deployment, and user acceptance remain open.

### 2026-08-18 P8.2b Windows sixth native denial and discriminator (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached exact
implementation head `500d8115003e2a14638c79f26db38531eeb507cf`. Pull-request run
[`32103584563`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32103584563)
failed Windows build-probe job
[`95608623187`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32103584563/job/95608623187):
the AppContainer-profile and Job Object tests passed, while the suspended Worker
launch again failed at `stage=create-process reason=other win32_code=203`. This
is the sixth native Windows failure of the same Task 4 launch test. The workflow
was then cancelled after preserving the failed job; that cancellation does not
turn the Windows failure into a pass.

The exact result disproves the preceding `SystemRoot`-only hypothesis. Two
single-variable production hypotheses are now explicitly false on
`windows-2025`: supplying an explicit current directory, and replacing the
empty custom environment with exactly one trusted `SystemRoot` entry. The
numeric name `ERROR_ENVVAR_NOT_FOUND` is therefore insufficient to conclude
that adding more environment variables is the correct production repair. The
remaining fault may be an environment requirement or the interaction between
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`, the inherited-handle list, and
`CreateProcessW`.

The next local change is evidence gathering, not a seventh repair guess. A
`cfg(test)`-only launch matrix compares the exact production structure against
parent-environment inheritance, trusted `SystemRoot + WINDIR`, trusted
`ComSpec + SystemRoot + WINDIR`, security-capabilities-only, handle-list-only,
and plain `CreateProcessW` variants. Every result uses only a closed variant
label, stage, reason, and numeric Win32 code. No path, environment value,
parent-environment entry, SID, handle value, prompt, lease, or credential is
printed. CI uses `--nocapture --test-threads=1` so all variants complete and
their sanitized outcomes are preserved before the production assertion keeps
the job fail closed.

The non-test build exposes only `WorkerLaunchVariant::Production`; it still
uses the capability-free AppContainer, explicit handle allowlist, trusted
`SystemRoot` block, explicit current directory, suspended launch, Job Object
assignment-before-resume, and closed `run_supervisor()` / `run_worker()`
entries. No diagnostic variant is available to a production caller and no
Windows runtime admission is enabled.

TDD first failed the source contract on the absent seven matrix labels and
failed Rust compilation on the absent diagnostic environment constructor. The
minimal implementation now passes the focused source contract 6/6, the
portable Windows supervisor slice 7/7, and the three related script files
21/21; Rust format, lint, format, and `git diff --check` are also green. The
first full `bun run check` attempt exposed one parallel
`p7PackagedTrust.test.mjs` fixture race (`packaged planner or main entry is
missing`); its isolated rerun passed 10/10. A fresh complete rerun then exited
0 with 162 files passed / 2 skipped and 1,741 tests passed / 9 skipped, followed
by the P7 abuse, smoke-harness, product-boundary, frozen-foundation,
downstream, and package gates.

The discriminator has no Windows result yet. Task 4, Windows containment,
cross-platform P8.2b, overall P8.2, candidate creation, release, and user
acceptance all remain open.

### 2026-08-18 P8.2b Windows worker environment correction (local only; gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) reached implementation
head `84e9e2cf9eb9c80d3994b269c42e403c49a1233f`. Pull-request run
[`32101652973`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32101652973)
failed its Windows native supervisor probe
[`95603175848`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32101652973/job/95603175848)
at the exact closed boundary `stage=create-process reason=other win32_code=203`;
the other two native supervisor tests passed. Win32 code 203 is
`ERROR_ENVVAR_NOT_FOUND`. The failing call supplied a custom Unicode environment
block containing only two NUL code units, so the next single hypothesis is that
AppContainer process creation requires a trusted `SystemRoot` entry rather than
an entirely empty environment.

The local correction obtains the Windows directory through
`GetWindowsDirectoryW` and supplies exactly the sorted, double-NUL-terminated
`SystemRoot=<Windows directory>` entry. It does not enumerate or inherit the
parent environment and does not log the directory or environment content. The
AppContainer profile, security-capabilities attribute, inherited-handle
allowlist, Job Object, creation flags, explicit current directory, and
fail-closed `run_supervisor()` / `run_worker()` entries are unchanged.

TDD evidence first failed the source contract 2/5 on the absent API/feature and
failed Rust compilation on the absent environment-block constructor. After the
minimal implementation, the source contract passed 5/5, the portable Windows
supervisor unit slice passed 6/6, and the three related script files passed
14/14. Rust formatting, focused JavaScript lint/format, `git diff --check`, and
a direct `x86_64-pc-windows-msvc` metadata compile of the exact supervisor
source also passed. A full macOS-hosted Windows Cargo cross-check is not usable
as native evidence because transitive C builds require the absent MSVC SDK
headers; it stopped in `zstd-sys`/`libsqlite3-sys`, before this source was the
failure boundary.

The complete local `bun run check` then exited 0: 162 test files passed / 2
skipped, 1,740 tests passed / 9 skipped, followed by the P7 abuse,
smoke-harness, product-boundary, frozen-foundation, downstream, and package
gates. The existing frozen-foundation bundler notices remain warnings rather
than failed gates.

This is local implementation evidence only. Windows Task 4 remains open until
the next `windows-2025` native run passes all three supervisor tests and the
exact Windows build/admission job completes. No Windows containment Artifact,
package journey, P8.2b acceptance, P8.2 completion, candidate, release, or user
acceptance is claimed.

### 2026-08-18 P8.2b Ubuntu containment accepted on the exact PR implementation head

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) now has exact
Ubuntu runtime-containment evidence for implementation head
`e597d85abef885c2b6a78a61a4860d1180614bac`. Pull-request run
[`32087808605`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32087808605)
completed Ubuntu containment job
[`95563851187`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32087808605/job/95563851187)
successfully. The job independently built and admitted the exact
`x86_64-unknown-linux-gnu` Goose Artifact, built and inspected the DEB,
installed the root-owned package layout and AppArmor profile, re-admitted that
installed package, ran the authenticated Linux Goose integration, passed the
native containment acceptance, re-admitted the bound manifest, uploaded the
bounded evidence, and removed the temporary package layout. Steps 9 through 19
all completed successfully; in particular the containment, bound-manifest, and
evidence-preservation steps 16, 17, and 18 are green.

This run followed a fail-closed diagnostic run rather than concealing the
earlier failure. Exact head
`5bd6bd4ac1068d67366dc2c56c5b02b7be51ef0c`, run
[`32086110390`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32086110390),
and Ubuntu job `95558874746` reached the native acceptance and emitted the
single closed stage `parent-death-readiness-failed`. Root-cause tracing showed
that the intermediate child closed `death_pipe[0]` and `watch_pipe[1]` before
creating `ready_pipe`; Linux then reused those available descriptor slots for
the new pipe. The grandchild repeated the stale closes and could therefore
close the new ready writer before reporting readiness. A TDD regression failed
on those two stale closes, then passed after the minimal repair removed only
the redundant grandchild closes. The focused probe file passed 22/22 and the
four related containment files passed 60/60.

Fresh local evidence for the corrected bytes is `bun run check` at exit 0:
160 test files passed / 2 skipped, 1,730 tests passed / 9 skipped, followed by
the P7 abuse, smoke-harness, product-boundary, frozen-foundation, downstream,
and package gates. Formatting, lint (0 warnings/errors), typecheck, P8 contract,
Electron SQLite, Rust formatting, and `git diff --check` also passed. The
artifact-dependent local `goose:runner:test` command was not counted because
this isolated worktree had no generated macOS runner manifest, and the local
Linux cross-check stopped at the known missing `x86_64-linux-gnu-gcc` tool.
Those local environment gaps are not substituted for native evidence; the
successful Ubuntu job compiled and ran the exact Linux bytes.

The success-only Artifact
`p8-goose-containment-ubuntu-8122a771196596556b04e3e7e1d8003957dd2205`
(GitHub Artifact `9307692493`) is present and unexpired. Its downloaded
`containment-evidence.json` is `verified` for
`x86_64-unknown-linux-gnu` and binds manifest SHA-256
`a3d85832a17ef92947adedcc376b2a290ad0b7902bcec1d3b1692f537c339e07`,
executable SHA-256
`abdf2cb7cb75784a7824bb5e1dc512563cfc029e3d31a155c4594624c8b0aee3`,
and probe SHA-256
`ce317cf9673d860118975cc78f8c202e815756e31b24dc229cc902046ff6d6f1`.
No `foundation/`, Renderer, preload, provider, persistence, or UI authority was
changed by the repair.

This accepts the Ubuntu native containment and authenticated runner-integration
slice on the exact pull-request implementation head only. Pull request 68 is
not merged, and this is not merged-main or clean-machine evidence. Windows
runtime containment remains a separate open target; full Electron package
journeys and the remaining P8.2 matrix obligations are also not established by
this runner-only Artifact. Therefore cross-platform P8.2b, overall P8.2, P8.3,
P8.4, candidate, signing/notarization, release, deployment, distribution,
real-provider, clean-machine, and final user acceptance remain open.

### 2026-08-17 P8.2a native Goose build admission accepted on main

P8.2a is accepted as a development-integration slice through pull request
[#66](https://github.com/Ablankpaper/actestra-desktop/pull/66). Its exact head
`00477af46497c717b1299994fcde18d2df0df341` passed pull-request CI run
[`31959966388`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31959966388)
with all four jobs green: Ubuntu x64 Goose build probe
(`95196338813`, completed 2026-08-16T17:06:40Z), Goose runner admission
(`95196338835`, 2026-08-16T17:09:56Z), Windows x64 Goose build probe
(`95196338837`, 2026-08-16T17:12:11Z), and macOS arm64 foundation
(`95196338841`, 2026-08-16T17:16:34Z). The governed squash merge produced
formal-main commit `dbc964044871bea7fabb5c5a484ac6d941c61500`.

The independent merged-main CI run
[`31961253627`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31961253627)
was bound to that merge commit and also passed all four jobs: Goose runner
admission (`95199466482`, 14m38s), Ubuntu x64 probe (`95199466540`, 12m30s),
Windows x64 probe (`95199466541`, 18m17s), and macOS arm64 foundation
(`95199466589`, 24m54s). The main-only artifact
`actestra-goose-runner-macOS-ARM64` is not expired, is 20,900,996 bytes, has
digest
`sha256:03baea8bd5c12048d5ca016258e107b3d809b65ded9f7e571d757a0b0fc0c436`,
and expires at 2026-08-19T17:34:07Z.

P8.2a closes the native build/admission boundary for the declared targets. The
native probes installed the pinned Rust 1.96.1 and audit assets, preserved
`Cargo.lock`, compiled the portable wrapper, and independently admitted the
emitted Artifact. Their exact admission evidence was:

- `x86_64-unknown-linux-gnu` / `actestra-goose-runner`: manifest
  `d2558f24d07605eb477e80eb13d3ba01fce533c606c9290c506f5c9cc58862e0`,
  executable `d5f807fa7488cbc4b6838378cee1936c697d66b461b7b31b12e839c86ba939f0`,
  74,084,096 bytes.
- `x86_64-pc-windows-msvc` / `actestra-goose-runner.exe`: manifest
  `cccbc70b6554dec4533082b7ed2e5cf7d30fb2c8ce1230fa5004d520c5de8597`,
  executable `c31ec181431d1870d2e7b8b59f74e2883ea87950ff31a9a9595f0c6851112a7e`,
  132,608 bytes.
- `aarch64-apple-darwin` / `actestra-goose-runner`: package-trust build
  manifest `ca6b2a8852d389ed21ebb11758113d9539c785492d8118dd2beb252b0b7c4d93`,
  executable `23900a388900716878908fed94b41807a5b3bdf54769fc3824dddda1e2812992`,
  63,928,920 bytes. The packaged verifier reported `manifest`, SBOM, license,
  audit, and source-copy checks verified.

The fresh exact-head local gate also passed: `bun run check` exited 0 with 145
files passed / 2 skipped and 1,541 tests passed / 9 skipped, zero lint
warnings, and clean `git diff --check`. The PR and merged-main macOS jobs also
re-ran the materialized AionUi build, package identity/trust checks, General
Work smoke, P7 security/resource/diagnostic smoke, and no-orphan cleanup.

This closes P8.2a only. Build admission does not grant runtime authority: the
current resolver still admits only Darwin, and matching Windows/Linux Artifacts
fail closed with `network-policy-unavailable` before a private attempt root or
transport is created. Windows/Linux runtime containment, Electron packaging,
product journeys, P7 platform obligations, P8.2 overall, P8.3, P8.4, candidate,
signing/notarization, release, deployment, distribution, clean-machine,
real-provider, and final user acceptance remain open.

### 2026-08-17 P8.2b Linux containment probe scaffold (not an acceptance)

The isolated implementation worktree
`/Users/zizimutou/actestra-worktrees/p8-2b-runtime-containment` is on
`codex/p8-2b-runtime-containment` at `b22b99d` (the implementation slice is
`ca64b8e`).
The shared launch contract and Rust containment boundary are preserved in the
preceding commits `c8d2c26` and `40fb687`. This slice adds a Linux-only
feasibility-probe entry point and a bounded evidence validator. The validator
requires the exact probe key set, binds target/source/executable digests, and
returns only closed reason codes; the probe runner also bounds output and
checks the exact regular executable digest before launch. Landlock capability
classification now requires a positive ABI result, and probe metadata accepts
only bounded safe target/digest strings. The Linux backend deliberately keeps
all six capabilities false and reports `evidence-incomplete` until the native
filesystem, network, process, resource, parent-death, and cleanup hostile
probes are implemented and run on Ubuntu.

Local evidence for this scaffold: 6 focused test files / 49 tests passed,
Rust macOS debug tests 8/8 passed (including the existing native resource
child), TypeScript typecheck passed, lint reported 0 warnings/errors, format
check passed, and `git diff --check` passed. This is local evidence only.

This record does not claim Linux or Windows compilation, native containment,
hostile-probe denial, an artifact-bound manifest containment record, runtime
admission, ACP on either non-Darwin target, packaging, or Electron acceptance.
The resolver remains Darwin-only and the non-Darwin `network-policy-unavailable`
fail-closed behavior is unchanged. The next required work is a real Ubuntu
backend and native CI evidence, followed by binding the six booleans to the
exact runner manifest before any non-Darwin runtime can be admitted.

### 2026-08-17 P8.2b local hardening follow-up (not an acceptance)

The local-hardening follow-up was developed on
`codex/p8-2b-runtime-containment` from formal
`HEAD 39566b342ca2c8492199d600247265df592463ce`. The evidence binder now uses a
closed failure-code set: an unexpected filesystem or runtime exception falls
back to `containment-bind-failed` and never echoes an OS error message or path.
A regression deliberately runs the binder against an unreadable manifest and
asserts both the fixed code and the absence of the fixture path.

Fresh local evidence for this follow-up is 8 focused files / 68 tests passed,
TypeScript typecheck passed, lint reported 0 warnings/errors, format check
passed, Rust format check passed, Rust macOS tests passed (8/8), and
`git diff --check` passed. This is development-worktree evidence only; it is
not a pull-request or merged-main result.

The first complete-gate attempt exposed a real downstream integration omission:
the new `gooseRunnerContainment.ts` source was not present in the materialized
AionUi overlay. The overlay now declares that source copy and its expected
destination. A fresh `bun run check` then exited 0: 148 test files passed / 2
skipped, 1,573 tests passed / 9 skipped; downstream reported 369 declared files
and 126 reviewed source copies; and the materialized package completed.

The runtime gate remains open. The Linux probe still deliberately emits
`evidence-incomplete` (`complete = false`) because the authenticated Main MCP
and model bridge, cgroup/process-count enforcement, and full descendant
parent-death evidence are not implemented as a packaged runtime composition.
The Docker/LinuxKit run is not native Ubuntu evidence (its seccomp hostile
probe returns the fixed environment-limitation stage), so it cannot advance a
target. Windows still has only the fail-closed scaffold: no Job Object,
restricted identity, named-pipe bridge, or native hostile probe. The resolver
therefore remains Darwin-only, and no Linux/Windows Artifact may start a
private root or ACP transport.

The digest-binding follow-up was revalidated after the latest test addition:
the focused containment evidence/probe suite passed 2 files / 19 tests, the
Rust macOS containment tests passed 8/8, and format, lint (0 warnings/errors),
TypeScript typecheck, documentation links, Rust format, and `git diff --check`
all passed. A fresh full `bun run check` completed its 148-test-file suite
with 1,575 passed / 9 skipped, preserved the 28-case / 168-variant P7 abuse
gate, and completed the downstream boundary and package stages. A separate
`bun run package` also exited 0. These were development-worktree results
collected before target-native pull-request evidence; they do not change the
native-runtime non-claims above.

This follow-up also adds a bounded `goose:runner:containment:accept` command.
The existing pull-request workflow now keeps its Windows/Linux build-only jobs
unchanged and adds separate `goose-containment-windows` and
`goose-containment-linux` jobs. Each containment job independently builds and
admits the exact native Artifact on its target host, binds the probe record,
reruns the probe, and fails on incomplete or unsupported evidence. The jobs use
no provider credentials and upload only bounded successful containment
metadata. On this macOS host the command correctly returns
`target-unsupported` (exit 2). No target-native containment job has run yet, so
this is pull-request workflow/entry-point wiring, not Linux or Windows
acceptance.

After adding this acceptance slice, the fresh local gate still exits 0: Vitest
reports 149 files passed / 2 skipped and 1,579 tests passed / 9 skipped; lint
remains 0 warnings/errors; the P7 abuse gate remains 28 cases / 168 variants;
and the downstream, foundation, boundary, and package stages all complete.

### 2026-08-17 P8.2b Linux cgroup-v2 feasibility slice (not an acceptance)

The same isolated `codex/p8-2b-runtime-containment` worktree now adds a
Linux-only cgroup-v2 resource and process-count probe without enabling Linux
runtime admission. The probe verifies the real cgroup-v2 filesystem magic,
parses one bounded unified membership, and requires `cpu`, `memory`, and
`pids` to be already delegated by the host. It does not mutate a shared
parent's `cgroup.subtree_control`. Inside an attempt-named child cgroup it
binds a supplemental `cpu.max` rate probe, a checked
`memory.current + 1 GiB` `memory.max`, and `pids.max` equal to the measured
single-task baseline. The cumulative 120 CPU-second and 1 GiB address-space
growth contract remains independently enforced by the existing
`RLIMIT_CPU`/`RLIMIT_AS` stage; the cgroup CPU rate is not treated as a
replacement for that contract.

The hostile child is held until Main-side setup is complete, enters the
existing Landlock filesystem boundary, proves it cannot rewrite `cpu.max`,
`memory.max`, or `pids.max`, then requires a new `fork()` to fail with
`EAGAIN`. Every setup, delegation, baseline, limit, widening, process-count,
wait, and cleanup failure maps to a fixed `resource-*` code. The Node evidence
binder and native acceptance wrapper accept only that closed vocabulary and
never forward raw probe stderr, paths, or platform errors. The child cgroup
and probe roots must both be removed before the stage can pass.

TDD evidence for this slice includes the expected pre-implementation RED, then
7 focused files / 61 tests GREEN after the early-failure cleanup regressions,
macOS Goose Rust tests 8/8 GREEN, Rust format GREEN, format check GREEN, lint 0
warnings/errors, TypeScript typecheck GREEN, and `git diff --check` GREEN.
Because this Mac lacks the Linux C cross compiler, the full Goose cross-check
stops in the existing `zstd-sys` build dependency; an isolated dependency-free
Linux-target wrapper nevertheless compiles the actual `linux.rs` and its test
code with `cargo check --tests`. That wrapper is compile evidence only, not a
native Ubuntu execution. The macOS acceptance entry remains correctly
fail-closed as `target-unsupported` with exit 2.

A fresh complete `bun run check` exits 0 after this slice: 150 test files pass
/ 2 skip, 1,584 tests pass / 9 skip, the P7 abuse gate remains 28 cases / 168
exact variants, and Electron SQLite, smoke harness, boundary, frozen
foundation, downstream overlay, and package all pass.

This does not close the Linux feasibility or runtime gate. The native Ubuntu
workflow has not run this exact source and Artifact; the probe still emits
`complete = false`; the authenticated Main MCP/model bridge, a production
composition that reconciles Goose's required runtime threads with zero child
processes, full descendant-tree parent-death evidence, ACP/runtime integration,
and target-native denial/cancel/crash/recovery/cleanup remain open. Windows is
unchanged and still lacks its Job Object, restricted identity, named-pipe
bridge, and native hostile evidence. The resolver remains Darwin-only.

The final local audit corrected two additional trust-boundary defects before
the branch was prepared for review. The Windows Bun setup action is now pinned
to the same complete 40-hex commit as the other jobs, with a regression that
rejects every shortened action reference. An existing containment record is
also revalidated against the current probe source digest both when binding and
when the final acceptance command reads it, so source drift cannot reuse stale
evidence. The old standalone manual workflow was removed; the native jobs now
run as independent jobs in the existing pull-request workflow while preserving
the build-only jobs' no-upload contract.

Fresh evidence after those corrections is 9 focused files / 67 tests passed,
Goose Rust macOS release tests 8/8 passed, the dependency-free wrapper around
the actual Linux containment module passed
`cargo check --target x86_64-unknown-linux-gnu --tests`, Rust formatting passed,
and `actionlint v1.7.7 .github/workflows/ci.yml` exited 0. The final local
`bun run check` also exited 0 with 150 test files passed / 2 skipped and 1,585
tests passed / 9 skipped; format, lint (0 warnings/errors), typecheck, the P8
contract, Electron SQLite, P7 abuse cases, smoke harness, product boundary,
frozen foundation, downstream overlay, and package stages all passed. This
local evidence was collected before any target-native containment job ran, so
P8.2b and overall P8.2 remain open and non-Darwin runtime admission remains
fail closed.

### 2026-08-17 P8.2b target-native diagnostic PR (gate remains open)

Draft pull request
[#68](https://github.com/Ablankpaper/actestra-desktop/pull/68) publishes exact
branch head `815c8e1e908d39996ccec772b1df0a249d227b2f`. Its pull-request CI run
[`31977086293`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31977086293)
completed with the intended evidence separation: the macOS arm64 foundation
job `95238089254`, Ubuntu x64 build-only job `95238089263`, Windows x64
build-only job `95238089265`, and Goose runner admission job `95238089270` all
passed. The two new target-native containment jobs failed closed, so the
overall run is correctly red rather than treating build admission as runtime
acceptance.

Ubuntu containment job `95238089303` independently built and admitted an
`x86_64-unknown-linux-gnu` Artifact with manifest SHA-256
`aceb4fc7d7460bfa789b07ae2d3a4dfd952b4d50325f7e3c052fa40f9abf5064`,
executable SHA-256
`dd3ba07b5479e59d5bd402023174634fcfc6811d57c5a3fd44e673579b256c78`,
and executable size 74,131,792 bytes. Its native acceptance returned only the
closed code `resource-cgroup-controller-not-delegated` and exited 2. This
establishes that the Ubuntu 24.04 hosted runner does not delegate the required
`cpu`, `memory`, and `pids` controllers to the current unprivileged cgroup; it
does not justify mutating a shared parent cgroup, adding root authority, or
weakening the resource contract.

Windows containment job `95238089313` independently built and admitted an
`x86_64-pc-windows-msvc` Artifact with manifest SHA-256
`d0ea05e39058c75097a8d5279e15b868b11d674eefc8dd0db898e921b4fd3f38`,
executable SHA-256
`816d7897041c121f9b86828341a902664c1fa7d4b4e05e668eec84253d66e914`,
and executable size 137,216 bytes. Its native acceptance returned the closed
code `evidence-incomplete` and terminated nonzero, matching the current
Windows scaffold. Neither failed job uploaded a success-only containment
Artifact, and the completed run has no published evidence Artifact.

The next Linux slice must replace the unavailable cgroup delegation assumption
with a reviewed product-owned, unprivileged resource/process authority or an
equivalent enforcement composition. It must permit the runner's required
Tokio threads while denying new processes and exec, retain the fixed cumulative
CPU and address-space limits, prove parent-death and cleanup on native Ubuntu,
and keep Linux runtime admission disabled until all six exact evidence fields
verify. Windows remains a separate later slice for Job Object, restricted
identity, named-pipe bridge, and hostile-probe completion. P8.2b, P8.2, P8.3,
and P8.4 remain open.

### 2026-08-17 P8.2b Linux process/resource equivalence implementation (local only)

The unprivileged Linux process/resource replacement is implemented locally on
`codex/p8-2b-runtime-containment` through implementation head
`dd87665fc51e04d4e40d441bd84a5aacb67f17cf`. The six-commit reviewed sequence
is design `aed9e54d9409ddf0440e71bdb98caea29b5576e4`, plan
`9bfeb200efac303711e8e06b26926cf05d19f363`, thread-aware process policy
`90f04463d306a946cbafd21163c9eb267825daf6`, production startup enforcement
`3bf9d580c0fff54af497a43bd6873fe802ef4df8`, RLIMIT resource equivalence
`ebd3bea6f8e38896ee31b590f49572b4332457f6`, and bounded partial-stage evidence
`dd87665fc51e04d4e40d441bd84a5aacb67f17cf`.

The Linux runner now applies the fixed 120 CPU-second and baseline-plus-1-GiB
address-space hard limits, then installs one x86-64 classic-BPF seccomp policy
before constructing Tokio or starting the parent-liveness thread. The same
installer is used by the native hostile probe. It permits only legacy clone
calls carrying the required thread-group, shared-signal, and shared-memory
flags; returns `ENOSYS` for `clone3`; and denies non-thread clone, fork, vfork,
execve, and execveat. The resource probe reads the real Linux virtual-size
baseline, verifies the exact `RLIMIT_CPU` and `RLIMIT_AS` values, and requires
hard-limit widening to fail with `EPERM`. Mandatory cgroup-v2 delegation and
the thread-counting `pids.max` assumption are removed from the evidence path.

The native JSON now preserves measured `processTree` and `resources` booleans
instead of hiding them behind the overall result. This does not weaken the
gate: `complete` remains hard-coded false, status remains
`evidence-incomplete`, the validator still binds only `verified` evidence with
all six capabilities true, and incomplete manifests remain byte-for-byte
unchanged. Only the closed `process-evidence-incomplete`,
`resource-evidence-incomplete`, and `remaining-evidence-incomplete` outcomes
cross the Node boundary; raw platform output and paths remain excluded.

Fresh local evidence for these exact implementation bytes is 9 focused test
files / 69 tests passed, Goose Rust macOS release tests 8/8 passed, Rust and
project formatting passed, lint reported 0 warnings/errors, TypeScript
typecheck passed, documentation links passed, and actionlint v1.7.7 run through
Go against `.github/workflows/ci.yml` exited 0 without diagnostics. The single
full `bun run check` exited 0 with 150 test files passed / 2 skipped and 1,589
tests passed / 9 skipped; the P8 contract, Electron SQLite, 28-case /
168-variant P7 abuse gate, smoke harness, product boundary, frozen foundation,
downstream overlay, and package stages all passed.

This is local macOS development evidence only. No Ubuntu 24.04 runner has
executed these new bytes, so Linux `processTree` or `resources` is not yet a
target-native verified result. Linux runtime admission and the resolver remain
disabled, no containment manifest is bound, and authenticated ACP composition,
filesystem/network production composition, target-native parent-death and
cleanup, Electron packaging, Windows containment, P8.2b, P8.2, P8.3, and P8.4
remain open. No foundation, Renderer, preload, provider, persistence, or UI
authority changed.

### 2026-08-17 P8.2b first native build diagnostic and Linux compile correction

Draft pull request 68 pushed exact head
`86e8e13c0ff7f3c9050ff1fe2b858cdb904f000e` to pull-request CI run
[`31980531759`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31980531759).
Both Ubuntu jobs failed during Rust compilation, before Artifact admission or
the containment probe could run: containment job `95246399987` and build-only
job `95246400003` reported Rust `E0369` at
`src/containment/linux.rs:504` because `JoinHandle::join()` returns a
`Result<u8, Box<dyn Any + Send>>` whose panic payload cannot be compared with
`Ok(7_u8)`. Both logs also reported the test-only
`apply_resource_limits_with` re-export as unused in the production build.
Consequently this run establishes no native Linux process, resource, Artifact,
or runtime result; the containment gate remains open.

Correction commit
`53c2c18d7aaca9a0d0f87ba9d0847339eb2b591b` uses a pattern match for the
thread result and exports the resource-limit seam only for Unix test builds.
Two source-contract regressions lock those exact boundaries. Fresh local
evidence for the corrected bytes is 9 focused files / 71 tests passed, macOS
Goose Rust release tests 8/8 passed, and Rust formatting passed. A temporary,
dependency-minimal wrapper compiled the real `containment/mod.rs`, `linux.rs`,
and `unix.rs` with
`cargo check --offline --target x86_64-unknown-linux-gnu` at exit 0; that is
Linux type-check evidence only, not native Ubuntu execution. The unchanged
broader corrected source had already passed one complete `bun run check` at
exit 0 with 150 test files passed / 2 skipped and 1,591 tests passed / 9
skipped. The next and only advancing key is a new exact-head pull-request run;
Linux admission remains disabled, `complete` remains false, and no incomplete
containment record may be bound.

### 2026-08-17 P8.2b Linux runtime composition Task 4 (local implementation, gate remains open)

Task 1–3's Main-owned Unix bridge, Linux namespace relay, and lifecycle
composition are joined by the local Task 4 change at commit `21cd915`. The
Node ACP transport now recognizes both fixed native setup markers: a Linux
bridge failure remains `network-policy-unavailable`, while the existing native
resource marker remains `worker-resource-enforcement-unavailable`. The
handshake unwraps either code without collapsing it to `transport-error`,
`spawn-failed`, or a successful turn. No raw stderr, path, socket name, or
environment value crosses the boundary.

The acceptance contract now explicitly locks that Linux probe output remains
`complete = false` / `evidence-incomplete`, incomplete output cannot mutate a
runner manifest, source commit/executable SHA-256/probe SHA-256 are all bound
to the exact runner and probe implementation, and containment evidence upload
is success-only. The Darwin-only resolver and the non-Darwin pre-root
`network-policy-unavailable` stop are unchanged.

Fresh local evidence for this exact implementation is:

- the combined Main/bridge/lifecycle/composition/containment/portability and
  evidence suite passed 12 files / 167 tests;
- `cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --offline`
  exited 0 (14 runner unit tests and the macOS native-limit child test passed);
- `bun run check` exited 0: 151 test files passed / 2 skipped, 1,616 tests
  passed / 9 skipped; P8 contract, Electron SQLite, P7 abuse (28 cases / 168
  variants), smoke harness, boundary, foundation, downstream, and package all
  passed; format, lint (0 warnings/errors), typecheck, Rust format, actionlint,
  and `git diff --check` also passed.

The artifact-dependent `bun run goose:runner:test` command was attempted but
could not start because this worktree has no generated macOS runner manifest at
`.actestra/goose-runner/aarch64-apple-darwin/actestra-goose-runner.manifest.json`;
this is missing local build output, not a reported Rust test failure. No fresh
Ubuntu 24.04 native job has executed this exact commit, the Linux probe has not
produced admissible complete evidence, and no containment manifest is bound.
Therefore P8.2b, overall P8.2, Windows containment, P8.3, P8.4, packaged
Electron/provider acceptance, candidate, release, and final user acceptance
remain open. No `foundation/`, Renderer, preload, provider, persistence, or UI
authority changed.

### 2026-08-16 P8.1 acceptance contract accepted on main

P8.1 is accepted on formal `main` through pull request
[#64](https://github.com/Ablankpaper/actestra-desktop/pull/64). Its exact head
`d62d2138f09e4cdb1242858fa3be3b29103096a9` passed both required jobs in
pull-request CI run
[`31950580690`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31950580690):
`Goose runner admission` completed at 2026-08-16T13:59:47Z and
`macOS arm64 foundation` completed at 2026-08-16T14:08:03Z. The latter
repeated source, test, boundary, documentation, materialized AionUI, package,
package-trust, General Work, P7.1 security, P7.2 resource, and P7.4
diagnostic/audit gates against the exact pull-request bytes.

The governed squash merge produced formal-main commit
`5555c84ffaf2ad506aa09604dbdca13707125fa8`. Its independent merged-main CI
run
[`31951854272`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31951854272)
also passed both required jobs: `Goose runner admission` completed at
2026-08-16T14:21:29Z and `macOS arm64 foundation` completed at
2026-08-16T14:28:25Z. The main-only artifact
`actestra-goose-runner-macOS-ARM64` is not expired, contains 20,900,993 bytes,
has digest
`sha256:faebcf486fe30f3c0affb68e981f26270eeb8cb39fa5d3343de9b6e6fe890038`,
and expires at 2026-08-19T14:21:23Z.

This accepts ADR-0030, the exact three-target P8 matrix, its fail-closed root
gate, and aligned source-of-truth documents. It does not establish a Windows
or Linux runtime, cross-platform CI package matrix, signing/notarization,
candidate, release, deployment, distribution, clean-machine acceptance,
real-provider acceptance, or final user acceptance. P8.2 is the next open
batch; P8.3 and P8.4 remain later gates.

### 2026-08-16 P8.1 pre-merge local gate

P8.1 acceptance contract implementation is in local development on branch
`codex/p8-1-acceptance-contract`, based on formal
`origin/main@d6e7dc63d5d95fc8435d6f5da0240b0a529cb0cd`. It establishes a
machine-checked acceptance obligation for exactly `macos-15-arm64`,
`windows-11-x64`, and `ubuntu-24.04-x64`. The contract separates CI builders
from clean-machine acceptance and reserves P8.2 for native package/runtime and
journey evidence, P8.3 for candidate integrity/signing/update evidence, and
P8.4 for lifecycle and real-provider internal acceptance.

The local P8.1 implementation adds the immutable matrix, its bounded checker,
ADR-0030, the human-readable product matrix, and regression tests. Focused
local verification passes the explicit 3-target / 14-journey / 7-evidence-class
checker, 2 test files / 5 tests, and the 80-file documentation link check.
The complete root `bun run check` exits 0: formatting, zero-warning lint,
typecheck, the P8.1 checker, Electron SQLite, smoke harness, product boundary,
frozen foundation, downstream overlay, and package gates pass; Vitest reports
140 files passed / 2 skipped and 1,521 tests passed / 9 skipped; and the P7
abuse gate preserves all 28 cases / 168 exact variants as `denied-safe`. The
frozen `foundation/` snapshot and product runtime are unchanged by this batch.

This record does not claim a Windows or Linux build. It also does not claim
formal signing, notarization, candidate, release, deployment, distribution, or
user acceptance. At that record P8.1 still awaited a governed pull request,
exact-head CI, squash merge, and independent merged-main CI; the current
section above records those later facts.

### 2026-08-16 P7 development integration gate accepted on main

P7.4 diagnostic export and privileged-audit retention is accepted on formal
`main` through pull request
[#62](https://github.com/Ablankpaper/actestra-desktop/pull/62). Its exact head
`27590471e75086dbbf24ff29eab23aeb7f32ffed` passed both required jobs in
pull-request CI run
[`31941498806`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31941498806):
`Goose runner admission` completed at 2026-08-16T10:41:00Z and
`macOS arm64 foundation` completed at 2026-08-16T10:43:24Z. The latter
repeated the source, test, boundary, documentation, materialized AionUI,
package, package-trust, General Work, P7.1 security, P7.2 resource, and P7.4
diagnostic/audit gates against the exact pull-request bytes.

The governed squash merge produced formal-main commit
`fc7b4683794934a6a650aecd90a7d00de1cf4280`. Its independent merged-main CI
run
[`31942456848`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31942456848)
also passed both required jobs: `Goose runner admission` completed at
2026-08-16T11:03:17Z and `macOS arm64 foundation` completed at
2026-08-16T11:08:30Z. The main-only artifact
`actestra-goose-runner-macOS-ARM64` is not expired, contains 20,900,993 bytes,
has digest
`sha256:659d051aa1d95711064ca9bbe57d7f966ede8983f2556a6a41a0ef2b80c459fa`,
and expires at 2026-08-19T11:03:09Z.

This closes the macOS arm64 P7 development integration sequence recorded by
ADR-0027 through ADR-0029: the P7.1 threat model and abuse catalog, P7.2 fixed
General/Goose resource and process controls, P7.3 SQLite migration recovery,
and P7.4 explicit local diagnostic export plus bounded integrity-checked audit
retention are accepted on `main`. P8 Windows/Linux acceptance, formal signing
and notarization, candidate creation, release, deployment, distribution, and
final user acceptance remain separate and unclaimed.

### 2026-08-16 P7.4 pre-merge local and packaged development gate

P7.4 diagnostic export and privileged-audit retention is implemented on branch
`codex/p7-4-diagnostic-audit`, based on formal
`origin/main@257863ee23cbdf28bdb5fba8d4f42a79accbfeb6`. The reviewed
product-source and test parent is
`7b0c27f4af3bb4e0e0049a03646af19c4fa9acc2`. The scope follows ADR-0029:
schema 23 adds a domain-separated SHA-256 chain and retained-prefix anchor for
privileged audit records; the persistence utility applies the fixed 90-day /
100,000-record policy only to a contiguous oldest prefix of complete terminal
request groups; Electron Main creates one bounded metadata-only report after
explicit consent and native destination selection; Renderer receives only
`saved`, `cancelled`, or `rejected`. The frozen `foundation/` snapshot is
unchanged.

Focused P7.4 verification passes 14 files / 117 tests. The complete local gate
`bun run check` exits 0: format and typecheck pass, lint reports 0 warnings and
0 errors, Electron SQLite passes, Vitest reports 138 files passed / 2 skipped
and 1,516 tests passed / 9 skipped, the P7 security gate preserves all 14
invariants and passes all 28 cases / 168 exact variants as `denied-safe`, and
the smoke-harness, product-boundary, frozen-foundation, downstream-overlay, and
package gates pass.

The complete root `bun run dist:dir` exits 0. The resulting macOS arm64
development app reports identifier `com.bignormal.actestra`,
`Signature=adhoc`, and passes `codesign --verify --deep --strict`. Against
that same app, `smoke:aionui-general-work`, `smoke:p7-security` (7 required
Layer-4 cases), `smoke:p7-2-resource-reliability` (5 cases), and
`smoke:p7-4-diagnostic-audit` all exit 0. The final scan finds no residual
Actestra, AionCore, Goose, Planner, General Worker, or security-probe process.
One earlier build attempt timed out while downloading Electron directly; the
successful full root build used the exact matching local Electron cache and a
proxy only for Electron's validation request. One earlier P7.1 security-smoke
attempt used the wrong environment-variable names and was killed by the
harness timeout; rerunning with the documented P7-specific runner artifact and
manifest variables passed. Neither failure is product evidence.

Pull request
[#62](https://github.com/Ablankpaper/actestra-desktop/pull/62) was opened. Its
first remote head, `3d810fbf8b051145302c6d7487d3064c44ac052d`, correctly
failed `macOS arm64 foundation` in pull-request CI run
[`31940590085`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31940590085).
The same run's `Goose runner admission` job passed, including the real ACP
handshake and cleanup; as expected for a pull request, it did not upload the
main-only runner artifact.
The root `bun run check`, documentation links, and materialized application
typecheck passed, but the materialized AionUI identity/isolation collection
reported 45 files and 248 tests passed plus one failure in
`persistenceUtilityClient.test.ts`; subsequent build, package, trust, and smoke
steps were skipped. P7.4 made `PrivilegedClock` a required dependency of
`PersistenceUtilityService`, while the historical downstream patch 0006 test
fixture still constructed that service without a clock. The missing fixture
dependency reached `clock.now()` and was deliberately redacted at the utility
boundary as `operation-failed`.

Commit `7b0c27f4af3bb4e0e0049a03646af19c4fa9acc2` fixes that composition gap in
downstream patch 0020 by injecting a deterministic test clock; it does not make
the production clock optional. The original materialized test changes from
one failure to one pass, the related materialized collection passes 44 files /
238 tests, the root-side clock and persistence collection passes 3 files / 26
tests, `downstream:aionui:check` exits 0, and the complete `bun run check`
result remains the 138-file / 1,516-test result recorded above. One earlier
full-gate attempt saw the isolated `p7PackagedTrust.test.mjs` fixture report
packaged-output drift under parallel load. That file then passed in isolation
and in 20 consecutive repetitions, and a second complete `bun run check`
passed; no package-trust authority or product logic was changed for that
load-related fixture flake.

These results were local and packaged development-build evidence, not formal
P7 integration. This separate revision-binding documentation change did not
alter the reviewed product bytes. At that pre-merge record, fresh exact-head
pull-request CI for the revision containing the clock-fixture fix, governed
merge, independent merged-main CI, and the main-only Goose artifact remained
required. Their accepted evidence is recorded in the integration section
above. P8, Windows/Linux acceptance, formal signing/notarization, release,
deployment, distribution, and final user acceptance remain unclaimed.

### 2026-08-16 P7.3 development integration gate accepted on main

P7.3 database backup, migration rollback, and crash-recovery is accepted into
formal `main` through pull request
[#60](https://github.com/Ablankpaper/actestra-desktop/pull/60). Its exact head
`e4f548f3d5ba3d5fd1e02882b0beaa928241e9e0` passed required pull-request CI
run
[`31906809232`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31906809232):
`Goose runner admission` passed at 2026-08-15T20:44:49Z and
`macOS arm64 foundation` passed at 2026-08-15T20:53:30Z. The latter repeated
source, test, boundary, documentation, materialized AionUI, package,
package-trust, General Work, P7.1 security, and P7.2 resource smoke gates
against the exact pull-request bytes.

The governed squash merge produced formal-main commit
`7418d4d6bb348f9c80961343ec49807fbfdab4ad`. Its independent merged-main CI
run
[`31907989900`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31907989900)
also passes both required jobs: `Goose runner admission` completed at
2026-08-15T21:10:11Z and `macOS arm64 foundation` completed at
2026-08-15T21:15:45Z. The main-only Goose artifact upload succeeded as
`actestra-goose-runner-macOS-ARM64`, not expired, with expiration
2026-08-18T21:10:04Z.

This closes the macOS arm64 P7.3 development integration gate for the SQLite
persistence utility. It adds private pre-migration backups, SHA-256-bound
recovery manifests, migration-failure restore, and pending-manifest crash
recovery while preserving ADR-0005's forward-only migration model and renderer
non-authority. It does not add Renderer/UI, Planner, General/Goose resource
scope, P7.4 diagnostic export/audit retention, P8, Windows/Linux enforcement,
formal signing/notarization, release, deployment, or final user acceptance.
P7.4 is the next ordered phase.

### 2026-08-16 P7.3 pre-merge local implementation gate

P7.3 database backup, migration rollback, and crash-recovery implementation is
locally complete on branch `codex/p7-3-database-recovery`, based on formal
`main@a95c26beae604bc11a46d9f2e08569d4f8770dc7`. The scope is intentionally
narrow: the SQLite persistence utility startup path now creates a private
pre-migration backup for existing Actestra-owned databases, records a
SHA-256-bound recovery manifest under the profile's `state/` directory,
restores that backup if an in-process migration fails, and recovers from a
pending manifest on the next startup when a crash leaves the current database
unreadable. It preserves ADR-0005's forward-only migration model, DELETE/FULL
journal policy, renderer/preload non-authority, foreign/future/corrupt
fail-closed behavior, and no-down-migration rule. The frozen `foundation/`
snapshot is unchanged.

Focused P7.3 persistence evidence passes: the new recovery tests plus existing
SQLite migration, core persistence, persistence-utility service, and
persistence-utility client suites report 5 files passed and 61 tests passed.
The full local gate `bun run check` exits 0: format passes, lint reports 0
warnings and 0 errors, typecheck passes, Electron SQLite passes against
Electron 37.10.3 / Node 22.21.1 / SQLite 3.50.4, Vitest reports 133 files
passed / 2 skipped and 1,482 tests passed / 9 skipped, the P7 abuse gate
passes all 28 cases and 168 exact variants, the smoke harness passes, product
boundary passes 134 Actestra-owned source files, frozen foundation and
downstream overlay checks pass, and downstream package exits 0. `docs:check`
also passes 74 Markdown files.

This is local development-build evidence only. It does not yet claim pull
request CI, merged-main CI, P7.3 acceptance on formal `main`, P7.4 diagnostic
export/audit retention, P8, Windows/Linux acceptance, formal
signing/notarization, release, deployment, or final user acceptance.

### 2026-08-16 P7.2 development integration gate accepted on main

P7.2 scheme A is accepted into formal `main` through pull request
[#58](https://github.com/Ablankpaper/actestra-desktop/pull/58). Its exact head
`69dde6adfd44188eec475a55ae02cbab893103b4` passed required pull-request CI
run
[`31900510574`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31900510574):
`Goose runner admission` passed in 15m27s and `macOS arm64 foundation` passed
in 22m43s. The latter completed package trust, General Work, seven-case P7.1,
and five-case P7.2 packaged smoke on the exact pull-request bytes. The
main-only Goose artifact upload was skipped as designed. GitHub recorded no
submitted review, inline review comment, or issue comment, and both required
contexts were green before merge.

The governed squash merge produced formal-main commit
`dc904b7b9cf7d0c64c563bcc732547f0ff27ce13`. Its independent merged-main CI
run
[`31901651415`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31901651415)
also passes both required jobs: `Goose runner admission` in 14m48s and
`macOS arm64 foundation` in 23m57s. The macOS job repeated the complete source,
test, boundary, documentation, materialized AionUI, package, trusted-runner,
package-trust, General Work, P7.1 security, and P7.2 hostile-resource smoke
chain against the squash result. The main-only Goose artifact upload succeeded
with the configured three-day retention.

This closes the macOS arm64 P7.2 development integration gate for the General
Worker and Goose Worker only. It does not add Planner, SQLite utility, or
Renderer/UI scope and does not claim P7.3, P7.4, P8, Windows/Linux enforcement,
formal signing/notarization, release, deployment, or final user acceptance. The
only CI annotation is the non-blocking GitHub Actions Node 20 deprecation notice
for pinned upstream actions that GitHub forced onto Node 24; both jobs remain
green. P7.3 is the next ordered phase.

### 2026-08-16 P7.2 pre-merge local implementation gate (superseded)

The pre-merge P7.2 implementation was built on branch
`codex/p7-2-resource-reliability` from
`origin/main@1de868de0192230a0e0776a589c04f9c430ac136`, with final exact head
`69dde6adfd44188eec475a55ae02cbab893103b4` after the reviewed macOS General
memory-normalization and terminal-observation fixes.
The scope is scheme A: General Worker and Goose Worker only. Planner, SQLite
utility, Renderer/UI, P7.3, P7.4, and P8 are not included, and the frozen
`foundation/` snapshot is unchanged.

The immutable budgets, supervisor terminalization, General metrics enforcement,
Goose native limits and production fork denial, bounded output/private storage,
downstream composition, and hostile packaged-smoke harness are present. Focused
resource/reliability tests pass (`9` files, `60` tests), and Goose runner tests
pass (`11` files, `187` tests). The current Rust source also passes
`cargo test --locked --release` (`6` tests), including the real macOS child
process limit probe.

Fresh local packaged development evidence:

- `bun run downstream:aionui:dist:dir` exited 0. The arm64 app at
  `.actestra/aionui-v2.1.41/out/mac-arm64/Actestra.app` passed
  `codesign --verify --deep --strict`; `codesign -dv` reported identifier
  `com.bignormal.actestra` and `Signature=adhoc`.
- `bun run verify:p7-package` exited 0 for output SHA-256
  `dac5c9f39cb2da810341c3c2eb0974d2ef3074c0e5015fc8de5d30b909ee32a0`, with
  565 files, no source-copy drift, and Goose manifest SHA-256
  `12f65066da7dcbc23e990b4018a4c415c0a3146fe3c3de52203a649362c8802b`.
- `bun run smoke:aionui-general-work` exited 0 against that exact app.
- `smoke:p7-security` exited 0 with all 7 required cases `denied-safe` and
  redacted when supplied the runner artifact directory and manifest trust root.
- `smoke:p7-2-resource-reliability` exited 0 with all 5 hostile cases
  fail-closed and redacted: General CPU, General memory, Goose output, Goose
  storage, and Goose fork denial.
- The final residual-process scan found no Actestra, AionCore, Goose runner,
  planner, General Worker, or P7 probe residue.

The full local gate `bun run check` exited 0: format passed, lint reported
0 warnings/0 errors, typecheck passed, Electron SQLite passed, Vitest reported
`132` files passed / `2` skipped and `1479` tests passed / `9` skipped, the P7
abuse gate passed all 28 cases and 168 exact variants, and boundary, foundation,
downstream, and package checks passed. The initial two security-smoke attempts
omitted the required runner trust-root environment variables and were killed by
the harness timeout; with the documented trust roots supplied, the smoke passed.

These local and packaged development-build results are superseded by the pull
request and merged-main evidence above. They remain provenance for the exact
implementation but do not prove formal signing/notarization, release,
deployment, or final user acceptance. P7.3, P7.4, Windows/Linux enforcement,
and P8 remain open.

### 2026-08-15 P7.1 development integration gate accepted on main

P7.1 is accepted into formal `main` through pull request
[#56](https://github.com/Ablankpaper/actestra-desktop/pull/56). Its exact head
`1311e15498a00ec0fe21cfb6d1ea447f02e6ead3` passed required pull-request CI
run
[`31882496420`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31882496420):
`Goose runner admission` passed in 15m14s and `macOS arm64 foundation` passed
in 21m08s. GitHub recorded no submitted review or inline review comment, and
the pull request was mergeable with both required contexts green.

The governed squash merge produced formal-main commit
`d7db878ce0385a14dae579bea3fe299e17e856b7`. Its independent merged-main CI
run
[`31883431956`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/31883431956)
also passes both required jobs: `Goose runner admission` in 19m03s and
`macOS arm64 foundation` in 25m34s. The latter re-ran the complete source,
test, boundary, documentation, materialized AionUI, package, trusted-runner,
package-trust, General Work smoke, and seven-case packaged P7 security smoke
chain against the squash result. The main-only Goose artifact upload also
succeeded with the configured three-day retention.

This closes the macOS arm64 P7.1 development integration gate. It does not
claim P7.2-P7.4, P8, Windows/Linux acceptance, formal signing or notarization,
release, deployment, or final user acceptance. The only CI annotation is the
non-blocking GitHub Actions Node 20 deprecation notice for pinned upstream
actions that GitHub forced onto Node 24; both jobs remain green. P7.2 is the
next phase.

### 2026-08-15 P7.1 exact-variant pre-merge local and packaged gate (superseded)

The current local delivery branch is `codex/p7-1-security-closure-final` on
reviewed implementation/test parent
`88d68bcb7881159bee8422693350e6ce9410e2fb`, based on
`origin/main@ee28c1d9138fa474704b8fd083e2511da64dee3e`. Tasks 1-6 are locally
bound across all 28 catalog cases and 168 exact variants. Task 4 contributes
55 exact Workspace/Delivery/Tool Gateway/Approval variants plus one positive
apply control; Task 5 contributes all 42 exact
MCP/Worker/Network/Process variants; and Task 6 contributes all 37 exact
Persistence/Redaction/Artifact variants plus one trusted-artifact positive
control.

Task 4 exposed and repaired three concrete problems at existing authority
boundaries: the security fixture's non-canonical macOS temp path had made its
old apply probes fail before reaching the intended boundary; artifact apply
accepted a redirected primary `.git` pointer and did not lock/reject dangerous
repository-local Git configuration before and after approval; and a Tool
Gateway request whose first result was `mayHaveExecuted: true` could reach the
executor again. The repaired flow preserves the existing one-shot
`approval-replayed` classification while preventing an ambiguous second
effect.

Fresh macOS arm64 evidence on that exact parent:

- `NODE_OPTIONS=--max-old-space-size=4096 bun run check` exits 0: 123 test
  files pass and 2 skip; 1,429 tests pass and 9 skip; formatting,
  zero-warning lint, strict typecheck, Electron SQLite, smoke harness,
  130-source product boundary, frozen foundation, downstream overlay, and
  package all pass. `bun run test:security` reports all 28 cases and 168 exact
  variants `denied-safe`. A temporary ignored PATH wrapper added only
  `--no-cache` to the nested materialized `bun install` to avoid a local Bun
  1.3.9 proxy-cache hang; no repository configuration or product byte changed.
- The release Goose runner build exits 0 from a clean, task-local RustSec
  database at `69f93e1d081d8b6fbee010e48f0b5e0d13661415`. Its manifest SHA-256 is
  `da415eace135db4275c475ac931b35fe9a34194d803ccf982e505f48fbfd7068`,
  binds Actestra parent `88d68bc`, records `dirty=false`, and retains only the
  accepted `RUSTSEC-2023-0071 metadata-only-not-compiled` disposition.
- `bun run dist:dir` exits 0. The arm64 development app has identifier
  `com.bignormal.actestra`, passes `codesign --verify --deep --strict`, and has
  `Signature=adhoc`. Package trust exits 0 for materialized-output digest
  `f6383c4430ab7e5fbfb041f86571fd7e5b7de911732233f6bf9b345922e6d82c`
  across 565 files, the external Goose manifest/SBOM/license/audit roots, the
  packaged planner hook, and 116 source copies with no drift.
- `bun run smoke:aionui-general-work` exits 0 against that exact app through
  the schema-22 representative General Work recovery/failure/Artifact suite.
  `bun run smoke:p7-security` exits 0 with all seven required packaged cases
  `denied-safe` and redacted.
- The final process scan contains no Actestra, AionCore, Goose, planner,
  General Worker, or P7 probe residue. `git diff --check` is clean.

These are local and packaged development-build results on the reviewed
product/test parent. Pull request #56 and the merged-main evidence above
supersede this pre-merge status. The evidence does not prove release,
deployment, or final user acceptance. At that record P7.2-P7.4 and P8 remained
open; the accepted sections above now supersede P7.2-P7.4.

### 2026-08-15 earlier 28-case packaged verification (superseded)

The P7.1 Threat Model and Abuse-Case Baseline is implemented at reviewed
implementation/test parent
`a8292e6433eacc3414dcc9408e10df7d6031b9a3` on
`codex/p7-1-security-closure`, based on
`origin/main@ee28c1d9138fa474704b8fd083e2511da64dee3e`. The frozen
`foundation/` snapshot is unchanged. Pull request
[#55](https://github.com/Ablankpaper/actestra-desktop/pull/55) is closed as
superseded by pull request #56; its exact-head CI tested only the older parent.

Fresh macOS arm64 evidence on that parent:

- `NODE_OPTIONS=--max-old-space-size=4096 bun run check` exits 0: 123 test
  files passed, 2 skipped; 1,273 tests passed, 9 skipped; format, zero-warning
  lint, strict typecheck, Electron SQLite, smoke harness, product boundary,
  frozen foundation, downstream overlay, and package all pass;
- `bun run test:security` is self-contained and reports 28/28
  `denied-safe`; `bun run goose:runner:test` passes 184/184 focused Goose
  tests, including the real parent-death and process cleanup cases. The
  admitted manifest binds `a8292e6` and records `dirty=false`;
- `dist:dir` exits 0 with `AIONUI_HUB_SKIP=1`; the arm64 development app has
  identifier `com.bignormal.actestra`, passes deep strict ad-hoc codesign
  verification, and package trust verifies the planner, external Goose
  manifest/SBOM/license/audit roots, and 116 source-copy checks without drift;
- the existing General Work packaged smoke exits 0, and the packaged P7
  security smoke exits 0 with seven required Layer-4 cases `denied-safe`;
- the current process scan shows no Actestra, AionCore, Goose, Planner, or P7
  probe residue.

These are historical local and packaged development-build results only. The
exact-head CI run `31861861143` tested the older head `ee6634e` and failed at
three materialized type errors. The final pull-request and merged-main closure
above supersedes this record. P7.2-P7.4, Windows/Linux enforcement, formal
signing, release, deployment, and final user acceptance remain open.

### 2026-08-15 new-repository main governance enabled

Repository ruleset
[`20861348`](https://github.com/Ablankpaper/actestra-desktop/rules/20861348)
is active on the default branch of `Ablankpaper/actestra-desktop`. Changes to
`main` must enter through a pull request and pass the exact GitHub Actions
contexts `macOS arm64 foundation` and `Goose runner admission`, both pinned to
the GitHub Actions integration. Zero approving reviews are required so the
single-owner workflow does not deadlock. Branch deletion and non-fast-forward
updates are denied. The `Ablankpaper` owner has an emergency bypass only from
a pull request; that bypass does not permit direct pushes to `main`.

A real direct-push attempt from a documentation branch ahead of `main` exited
1 with GitHub error `GH013`: GitHub required a pull request and both required
status checks. The remote `main` ref remained unchanged at
`17845d0c7701a31c6e7778b082c42966f056f0f8`. A separate dry-run through
`old-origin` exited 128 before contacting GitHub because its disabled
`no_push` protocol has no remote helper. The governed pull-request path is
exercised by
[#54](https://github.com/Ablankpaper/actestra-desktop/pull/54).

The canonical local `origin` remains
`git@github-ablankpaper:Ablankpaper/actestra-desktop.git`. The historical
`old-origin` retains its former address for read-only redirect diagnostics, but
its local push URL is disabled so subsequent development cannot accidentally
use the former-account remote. This is repository-development governance, not
a release, deployment, candidate, signing, notarization, or new product
acceptance claim.

### 2026-08-14 repository authority migration verified

The GitHub repository was transferred from `bignormal/actestra-desktop` to
`Ablankpaper/actestra-desktop`. The destination is public, its default branch
is `main`, and anonymous GitHub API, web, and Git reads all succeed. The former
web and Git addresses redirect to the same transferred repository and exact
`main` commit.

Migration verification compared every local branch name and object ID against
the destination rather than relying on push output alone: all 51 local heads
match all 51 remote heads, no head is missing or extra, and both sides have
zero tags. Every local branch tracks the new `origin`; authenticated
`push --dry-run --all` and `push --dry-run --tags` are up to date. A fresh
anonymous mirror clone reports the same 51 heads and `main` at
`17acae034d723e45a46dcef264844ed5a27c3da2`, and `git fsck --full` passes. The
repository has no Git submodule or Git LFS rule requiring a separate object
migration.

GitHub-side resources remain attached to the transferred repository: 52 pull
requests are present (51 merged and one open), the active CI workflow and its
154 historical runs are present, and the exact `main` commit above passed CI
run `31629487703`. There are no Issues, Releases, Deployments, Pages,
Environments, repository rulesets, webhooks, deploy keys, Actions secrets, or
Actions variables to migrate. `Ablankpaper` has administrator authority and
the former owner remains a write collaborator. Product repository metadata,
downstream identity links, and historical evidence links now use the canonical
`Ablankpaper/actestra-desktop` address.

The canonical-link normalization passes its focused entry-point suite with 7
tests, resolves all relative links across 66 Markdown files, and reports zero
Markdown lint errors across 62 files. The complete
`NODE_OPTIONS=--max-old-space-size=4096 bun run check` exits zero: formatting,
zero-warning lint, strict types, Electron SQLite, 111 test files passed with 2
skipped, 1,182 tests passed with 9 skipped, smoke harness, 127-file product
boundary, frozen foundation, downstream overlay, frozen-lock install, and the
materialized AionUI package all pass. The generated package metadata and
electron-builder GitHub publisher both name `Ablankpaper`; no generated file
contains the former repository URL.

An offline migration bundle remains outside the repository at
`/Users/zizimutou/actestra-migration-backup-20260814`; bundle verification and
its recorded SHA-256 checksum pass. This repository transfer changes hosting
authority and canonical links only. It is not a source release, deployment,
candidate, signing, notarization, or new P6/P7 product-acceptance claim.

### 2026-08-13 initial P7.1 baseline (superseded)

The initial P7.1 local snapshot was superseded by the current evidence recorded
above. Its earlier implementation parent and test counts remain available in
Git history for provenance; they are not current acceptance evidence.

### 2026-08-13 current verification: P6 delivery exit accepted on `main`

P6's development-delivery exit gate is accepted. Pull request
[#51](https://github.com/Ablankpaper/actestra-desktop/pull/51) passed exact-head
CI run `31623674948` at
`aef8d537be6409f4a0ce2d53299413b26155ed82`, then squash merged as
`1aefa46597d334b4fad48cf176fed1b166cdbacc`. The one post-merge `main` CI run,
`31625296206`, is GREEN on that exact merge commit.

Both CI runs passed the independent `macOS arm64 foundation` and `Goose runner
admission` jobs. The final bytes therefore pass the complete root gate,
documentation, frozen-lock downstream installation, materialized typecheck and
renderer build, local app bundle, packaged identity, packaged General Work
smoke, auditable Goose build and admission, frozen-lock check, real ACP
handshake and cleanup, and admission-artifact preservation. The earlier
`RUSTSEC-2026-0253 / lru 0.18.1` blocker is removed by the exact `lru 0.18.2`
runner lock and the independent artifact-admission rejection described below.

The visible P6 exit evidence remains the 2026-08-12 isolated, real-provider
Electron acceptance recorded below: AionUI-native Team creation and execution,
General+Goose model/tool use, patch Artifact creation, second-approved workspace
apply, multiline requests, final feedback, cancellation, restart recovery, and
no-orphan shutdown. Together with the deterministic fixtures and failure-path
coverage, this satisfies the P6 exit gate in the development sequence. P7 is
the next ordered phase.

Review coverage is recorded conservatively. CodeRabbit's SUCCESS context was
not a review: its comment says review was skipped because the PR selected 174
files, above the free-plan limit of 150, and its path filter excluded
`Cargo.lock`. No human review was submitted, and the repository had no required
review or branch-protection rule. That gap was recorded in the PR before merge;
it is not represented as zero-finding review evidence.

This acceptance is development integration, not a release. Formal signing,
notarization, Windows/Linux acceptance, candidate creation, distribution,
deployment, update/rollback operations, P7 security/reliability acceptance, P8
internal-beta acceptance, and final user acceptance remain separate and are not
claimed.

### 2026-08-13 delivery diagnosis: exact-head CI packaging and RustSec repairs

The latest pushed exact head is
`ad3f6716b9caec95c69811349074f5e5f096cfe4`. CI run `31620624446` proves the
entire `macOS arm64 foundation` job green, including the complete root check,
documentation, frozen-lock downstream install, materialized typecheck and
renderer build, local app bundle, packaged identity, and packaged General Work
smoke. The independent `Goose runner admission` job failed, so this SHA remains
unmergeable.

Raw `cargo-audit 0.22.2` JSON against the CI-era RustSec database identifies the
failure as `RUSTSEC-2026-0253`: `lru 0.18.1` has a potential use-after-free and
is fixed in `>=0.18.2`. The package is a direct normal dependency of the pinned
Goose core and appears in both the committed lock and auditable runner binary;
it cannot use ADR-0025's metadata-only RSA disposition. The committed runner
lock now resolves only `lru 0.18.2`, and artifact admission independently
rejects a self-consistent lock containing `0.18.1`. Goose remains pinned to
`v1.45.0` at the same commit with its empty feature and source-patch sets.

Verified local remediation evidence:

- the admission regression failed against the old validator because the unsafe
  lock was admitted, then passed after the dependency floor was added;
- the focused artifact suite passes 10 tests;
- an auditable release build against RustSec database commit
  `69f93e1d081d8b6fbee010e48f0b5e0d13661415` reports 545 lock packages, 458
  auditable binary dependencies, 413 active dependencies, no unsound warning
  in either scan, and only ADR-0025's exact
  `RUSTSEC-2023-0071 / rsa 0.9.10` metadata-only disposition;
- the real Goose suite passes 10 files and 183 tests across artifact admission,
  ACP handshake and lifecycle, MCP/model composition, the real runner, coding
  journey, and Team mixed journey;
- `NODE_OPTIONS=--max-old-space-size=4096 bun run check` exits zero: format,
  zero-warning lint, strict types, Electron SQLite, 111 test files with 1,181
  tests passed and 9 skipped, smoke harness, 127-file product boundary, frozen
  foundation, downstream overlay, frozen-lock install, and the 10,207-module
  AionUI package build all pass;
- documentation links resolve across 66 files, Markdown lint reports zero
  errors across 62 files, `git diff --check` is clean, `foundation/` is
  unchanged, and the source diff contains no credential or private-key value.

The first online build attempt completed compilation but its second advisory
database fetch failed with a GitHub network I/O error. The successful build used
the builder's governed offline mode with the same database commit and a
one-minute-old `FETCH_HEAD`; that path still performs both scans and rejects
database evidence older than seven days. This was local remediation evidence;
the exact-head and merged-main CI results above subsequently verified the same
security boundary. No release, deployment, formal signing, or new user
acceptance is claimed.

The P6 delivery batch was pushed to
`codex/p6-aionui-team-acceptance` at
`f5056101ea77cada30a6dbc1913bb7d99a2460fb` and opened as pull request
[#51](https://github.com/Ablankpaper/actestra-desktop/pull/51). Its first
exact-head CI run, `31618173046`, is not a passing delivery gate: the `macOS
arm64 foundation` job `94186061728` failed during the root `bun run check`, so
that SHA must not be merged.

The complete job log narrows the failure to the final downstream package step.
Formatting, zero-warning lint, strict types, Electron SQLite, all 1,178 tests,
the smoke harness, product boundary, frozen-foundation check, and downstream
overlay check passed first. The generated AionUI build then failed to load
`@sentry/vite-plugin`. The root cause was a clean-checkout dependency gap:
`downstream:aionui:package` materialized the frozen AionUI tree and built it
without installing the dependency set declared by its own frozen `bun.lock`.
Local runs had linked an already-installed `foundation/aionui-v2.1.41/node_modules`,
which masked the missing prerequisite.

The local follow-up changes the package entry point to run the existing
`downstream:aionui:install` command before the build. This preserves the frozen
source and lockfile and makes the normal package command self-contained on a
clean checkout. A new entry-point regression failed against the old command and
passes against the corrected command.

Verified follow-up evidence on 2026-08-13:

- focused entry-point regression: 1 file and 5 tests passed;
- `bun run package`: EXIT 0 after materializing the reviewed overlay and
  installing 3,177 packages from the frozen downstream lockfile; the Sentry
  plugin was present and the Main, preload, and renderer bundles all built;
- `bun run check`: EXIT 0; 111 test files passed, 2 skipped; 1,179 tests passed,
  9 skipped; format, lint, typecheck, Electron SQLite, smoke harness, boundary,
  frozen foundation, downstream overlay, frozen-lock dependency installation,
  and package all passed;
- `git diff --check` is clean, `foundation/` is unchanged, and the process scan
  has no Actestra, AionCore, Goose, planner, or General Worker residue.

That repair was committed and pushed as
`81a73e47c2cb7a52f8ab4aab25e270a8e5877e00`. Its exact-head CI run
`31619324454` proves that the dependency correction worked: all 1,179 tests and
the frozen-lock installation passed, `@sentry/vite-plugin` was installed, and
the renderer transformed 10,207 modules. The same `bun run check` step then
failed during chunk rendering with `SIGABRT` / EXIT 134 because Node reached its
default approximately 2 GB heap limit. This was a second deterministic CI
configuration defect. The workflow already gave the later standalone renderer
build `NODE_OPTIONS=--max-old-space-size=4096`, but omitted it from the complete
check even though that check now builds the same renderer.

The local follow-up applies that existing 4 GB heap setting to the complete CI
check and locks the exact step environment in the entry-point regression. With
the same environment, the complete local `bun run check` exits zero: 111 test
files passed, 2 skipped; 1,180 tests passed, 9 skipped; the downstream lockfile
was installed and the 10,207-module renderer completed chunk rendering.

This is a local repair of two observed exact-head CI failures, not replacement
CI evidence. The second repair still requires a new commit and push, a fresh
exact-head CI run with both jobs green, review disposition, merge, and one green
merged-main CI run. No formal signing, release, deployment, production
readiness, or final user acceptance is claimed.

The heap correction was committed and pushed as
`69c9d2f639c06ee5a2f628575df68358e24adc0f`. Its exact-head CI run
`31619997348` proves both earlier corrections: the complete `bun run check`,
documentation links, and frozen-lock downstream install all passed. The next
independent gate then exposed one root-versus-materialized TypeScript contract
gap at `artifactDeliveryService.ts:232`: the root strict check accepted the
Promise rejection handler, while the AionUI `noImplicitAny` check required its
`undefined` return type to be explicit and failed with `TS7011`.

The one-line local follow-up now matches the explicit rejection-handler pattern
already used throughout the same Actestra modules. The exact materialized
`bunx tsc --noEmit --pretty false` command moves from EXIT 2 to EXIT 0. The
focused Artifact delivery suite passes 3 files and 26 tests, and root typecheck
and formatting also pass. This is runtime-neutral type information; it does not
change the accepted Provider, Electron, Artifact apply, or packaged smoke
behavior. A new exact-head CI run is still required before merge.

### 2026-08-12 current verification: P6 local development acceptance complete

The P6 delivery batch is maintained on branch
`codex/p6-aionui-team-acceptance`; its pre-delivery checkpoint was
`ceeb7eeb89702df1f21cdd6b3941276e708c5979`. The evidence below is local. No
push, exact-head CI, review/merge, release, deployment, or formal signing is
claimed. The frozen `foundation/` tree remains untouched.

The current P6 implementation contains both previously open vertical slices:

- Coding delivery is `isolated worktree → patch Artifact → second explicit
approval → Main-owned apply to the original workspace`. The Main applicator
  has repository locking, canonical Git binding, HEAD/clean-tree/dry-run and
  post-approval re-verification, idempotent retry/recovery, and fail-closed
  dirty/drift/conflict handling. The real cross-layer regression walks the
  Artifact through Git and the persistence utility into the bounded AionUI
  projection; no path, patch content, or content-reference authority reaches
  Renderer.
- General v1 remains text-only. Structured Planner requirements are persisted
  and admitted before model invocation; file/network/repository requirements are
  rejected with distinct `general-input-required` or
  `general-capability-mismatch` codes. A structured JSON output envelope,
  one bounded repair, placeholder/invalid-output rejection, and separated
  provider/instruction/lifecycle incident codes prevent false completed
  Artifacts.

Verified local gates on 2026-08-12:

- `bun run check`: EXIT 0; 111 test files passed, 2 skipped; 1178 tests
  passed, 9 skipped; format, lint (0 warnings/errors), typecheck, Electron
  SQLite, smoke harness, boundary, frozen foundation, downstream overlay, and
  package all passed.
- `bun run dist:dir`: EXIT 0 with the arm64 development `.app` built outside
  `~/Desktop` at the worktree-scoped cache directory. Bundle structure is
  complete, `Signature=adhoc`, and `codesign --verify --deep --strict` exits 0;
  `.actestra/aionui-v2.1.41/out/mac-arm64` points to that verified output.
- `bun run smoke:aionui-general-work`: EXIT 0 against the packaged app. The
  P4 scenarios pass against the current Actestra persistence schema 22,
  including schedule recovery, representative file/content failures, Worker
  crash recovery, writing/Office/DOCX, local research, grant denial,
  cancellation, Artifact/event/privacy, and terminal evidence.

The final provider-backed Electron gate is also GREEN on the same ad-hoc-signed
development app. An isolated profile under
`/private/tmp/actestra-p6-acceptance.a4YSo8` admitted the persisted provider and
`gpt-5.4`, emitted `ACTESTRA_AIONUI_TEAM_WORKER_RUNTIME_READY`, and ran the
visible AionUI-native General+Goose Team journey against the real provider.
The acceptance evidence includes:

- one capability-aligned mixed run in which General produced one durable
  document Artifact, Goose used its real tool path to create the exact isolated
  patch for `acceptance-result.txt`, and the separately approved Main-owned
  apply operation wrote the 36-byte file to the original authorized workspace;
  the persisted delivery is `applied`, `base_commit` and `verified_head` both
  equal `d5f04caa75fbd2c5905fff56ad5bb5283915f792`, and the changed-file count is
  one;
- a new two-line Team request whose content rendered with the line break intact;
  General produced one durable Artifact, Goose correctly completed the read-only
  instruction as `no-changes`, final human feedback advanced revision 7 to
  revision 8, and the run terminalized `completed` with 100% progress and one
  aggregated Artifact;
- a separate two-line run that reached final human feedback and then exercised
  whole-Team cancellation, advancing revision 6 `blocked` to revision 7
  `cancelled`;
- normal quit and isolated-profile restart after the completed and cancelled
  outcomes. The same terminal revisions were restored, AionCore shut down
  gracefully with app exit code 0, and the final Actestra, AionCore, Goose, and
  planner process scan was empty.

The multiline bridge defect found during acceptance is fixed at the bounded
compatibility boundary: Team activity content now uses the existing LF-only
multiline normalizer instead of the single-line text assertion. The focused
bridge regressions pass 30/30 and the complete gate above includes that change.
No credential-shaped token appears in the captured Electron logs.

This closes P6's local development exit gate for source, development build,
real provider-backed Electron behavior, restart recovery, cancellation,
Artifact delivery/apply, and packaged General Work smoke. It does not claim a
push, exact-head CI, review/merge, merged-main CI, formal signing, release,
deployment, production readiness, or final user acceptance. The delivery batch
remains local and `foundation/` remains untouched.

### Historical acceptance baseline (2026-08-10)

On 2026-08-10 a real packaged Electron General+Goose Team journey ran from the
local uncommitted branch `codex/p6-aionui-team-acceptance` at
`ceeb7eeb89702df1f21cdd6b3941276e708c5979`. The ad-hoc-signed arm64
development app used one isolated E2E root, schema 17 persistence, an admitted
`actestra-native-team-planner@1.0.0`, the locally built Goose artifact, and the
persisted real provider/model binding. Packaged startup emitted both
`ACTESTRA_AIONUI_TEAM_PLANNER_READY` and
`ACTESTRA_AIONUI_TEAM_WORKER_RUNTIME_READY`. General completed with one durable
document Artifact, but the Artifact retained `<to be filled after read>`
placeholders and did not report the actual `README.md` first line; the current
General runtime explicitly requests a text-only draft with no tools. This exact
scenario therefore does not prove General workspace-read behavior. The real
provider's streaming response also proves that the former empty-completion
failure is gone: it returned `finish_reason=tool_calls`, 748 prompt tokens, 90
completion tokens, and two tool calls. The current Main-owned model contract
accepts exactly one tool call per completion, so all four bounded attempts were
rejected as `tool-call-count-unsupported` before Goose could execute
`read_file`; the requested `acceptance-result.txt` was not created and the
coding node had no Artifact.

The same journey exposed a second fail-closed gap after that rejection. Goose's
400 response became an assistant message saying that the request failed, but
the coding journey persisted `task.completed`, projected the Goose node as
completed with zero Artifacts, and created no `agent_attempt_evidence` row for
the coding task. The human-feedback correction itself is real-Electron GREEN:
the visible `要求修改` action used the workflow-feedback route, advanced the
run from revision 6 to 7, and exposed retry, replace, handoff, and cancel without
the former protected-approval `team-conflict`. A normal quit reached AionCore
graceful shutdown with exit code 0. Restarting the same isolated profile emitted
`ACTESTRA_AIONUI_TEAM_RECOVERY_READY {"recoveredRuns":3}` and restored the exact
revision-7 blocked state and controls; the second normal quit also exited 0,
and the final Actestra/AionCore/Goose/planner process scan was empty. The
authoritative run is
`team-run-5231a0548c7d3d91fe4f9a8c3e8490641e03e73be3717b5bce48c21477dc390f`.
This is local packaged failure, recovery, feedback-route, and cleanup evidence,
not P6 acceptance. The next gate is to keep the singular tool-execution contract
explicit at the provider boundary or deliberately version it for multiple tool
calls, terminalize a rejected model completion as failed rather than completed,
add regressions for both facts, decide whether General v1 remains text-only or
admits bounded workspace reads, rebuild the packaged app, and rerun a
capability-aligned General+Goose journey through successful file output and
final feedback.

On 2026-08-10 the local development-app build wrapper and one load-dependent
probe-process test were hardened without changing the frozen AionUI foundation.
The wrapper now rejects filesystem, user-home, and system-temporary roots and
uses real-path containment checks for the repository and `~/Desktop`, including
symlink aliases, before materialization begins. The probe-process regression
now waits for parseable PID JSON instead of assuming that file creation and a
non-atomic write complete together. Focused evidence is 117/117 tests, and the
previously flaky process-group-membership test passes 10 consecutive isolated
runs. `bun run check` is GREEN at 990 passed, 9 skipped, and 0 failed, with
format, zero-warning lint, strict TypeScript, Electron SQLite, smoke harness,
product boundary, frozen foundation, downstream checks, and package all
passing.

The follow-up development build is also GREEN. `bun run dist:dir` materialized
the downstream tree and built the arm64 app outside `~/Desktop` at the
worktree-scoped cache location, then linked the verified output into the
materialized `out/mac-arm64` path. `codesign --verify --deep --strict` exits 0;
the bundle reports `Signature=adhoc`, `flags=0x2(adhoc)`, and sealed resources.
`bun run smoke:aionui-general-work` exits 0 against that packaged app and covers
the schema-17 General Work recovery, failure, DOCX/Word Preview, workspace-grant,
cancellation, privacy, Artifact, event, and terminal-evidence paths. This is a
local development-build and packaged General Work checkpoint, not a formal
signature, release, deployment, provider-backed General+Goose Team journey, or
P6 acceptance claim. Hub resources are intentionally skipped by the current
development wrapper, so this smoke does not establish Hub packaging.

On 2026-08-07 the owner authorized ADR-0026 and a local implementation slice for
an Actestra-native planner. The local source now implements the exact engine
`actestra-native-team-planner@1.0.0` as a separately supervised, no-tool,
no-credential sidecar with a fixed three-node General/Goose-parallel plus
human-feedback candidate. The trusted factory is locally GREEN: it accepts no
caller-supplied launch fields, reads only the fixed packaged
`actestra-team-planner.manifest.json` beside `actestra-team-planner.js`, and
rechecks the exact engine, file name, byte size, and SHA-256 before spawn.
Downstream materialization copies the production planner sources and declares
one exact `actestra-team-planner` build entry; no fixture or local-Agent source
enters the product graph. Fresh local evidence is the focused
planner/coding/experience/router/Team-readiness set at 113/113 with the real
local Goose artifact admitted against manifest SHA-256
`7444e12e4e218cfd4d4d8f9ae253dee12b9b1930b5546849498790277328b9df`, the
manifest/boundary/readiness/path-safety/product-
entrypoint scripts at 13/13, root and materialized strict TypeScript,
repository-wide format and zero-warning lint, and the three materialized native
Team/coding wiring files at 14/14. Documentation links, the exact frozen AionUI
foundation, the product boundary, and `git diff --check` also pass. The
downstream overlay and contract now declare 320 `expectedChangedFiles` and 100
exact `sourceCopies`. The materialized formatter keeps
the root-owned Actestra source-copy convention explicit while AionUI-owned
startup, composition, and wiring-test files retain the AionUI convention; the
four-path materialized format check passes without changing generated files or
weakening source-copy equality. The final bundled planner remains
covered by an exact engine, SHA-256, and byte-size manifest written and
reverified before pack-only return and electron-builder invocation.

This GREEN result is limited to planner identity, trusted launch, source
packaging, and wrapper-level abort, timeout, and explicit-close regression.
The production entry is stdio-only and imports no child-process or dynamic
execution API, so it cannot create native planner descendants; the deterministic
fixture's self-spawned descendant is test-only and is not evidence against the
production entry. The supervisor wrapper has no unused `PassThrough` or
`parentLivenessFd` liveness wiring; its launch boundary is stdio-only. Complete
process-group cleanup remains covered by the already merged generic supervisor
evidence, while a packaged parent-death smoke is still required before release
claims. The actual AionUI production entry now
contains local startup wiring: `handleAppReady()` calls the zero-argument
trusted factory and injects `configureActestraTeamRuntime({ planner })` before
persistence startup; a failed factory produces the explicit
`ACTESTRA_AIONUI_TEAM_PLANNER_UNAVAILABLE` marker and never falls back to a
fixture. This is source/materialization evidence only. A real Electron launch,
admitted General and Goose Worker runtimes, model binding, the mixed journey,
and P6 acceptance remain open. The local composition distinguishes a missing
planner from missing General/Goose runtime readiness: only all required Worker
ports construct an orchestrator, while Main/Core projects
`worker-runtime-unavailable` with `configure-worker-runtime`; the AionUI-native
Team surface disables submission and explains that next action. The current
orchestrated ledger remains 2/7. CrewAI and CLI providers remain outside this
change; commit, push, PR, Actions, package, release, deployment, and user
acceptance remain unclaimed.

The Main-owned model JSON and broker sources, plus the General and Coding
runtime-port sources, now exist locally and are included in those exact
`sourceCopies`. `actestraGeneralWorkRuntime.ts` imports only the Main-owned model
broker and has no Goose dependency. This is local source and downstream-contract
evidence, not a configured runtime. Production startup still passes
`modelBinding: null`; Team composition still passes `general: null`; and the
downstream checker still rejects `general: journey`. Coding startup therefore
has no admitted model binding, General still has no production composition port,
and the planner continues to project `worker-runtime-unavailable` without
constructing an orchestrator. The real General+Goose mixed journey, a fresh
Electron journey, Task 14 and P6 acceptance remain open, and the orchestrated
ledger remains 2/7. Activating a real provider/model still requires an explicit
provider/model choice and authorized credential/network use. These current facts
supersede the earlier historical null-startup notes retained below.

The local B2 Team/Core/persistence checkpoint records forward-only schema 16
immutable Team experience bindings, schema 17 metadata-only standard-Team
message delivery authority, and the bounded root Main/Core projection for
standard and orchestrated Teams. It persists intent before a provider message
effect, replays only an observed durable acknowledgement for the same nonce and
request digest, and keeps content and attachment paths out of persistence.
Focused staged-tree evidence passes 9 test files with 177 tests, the
deterministic smoke harness, root strict TypeScript, zero-warning lint, exact
code/test changed-file formatting, documentation links, and cached diff
checking. This is local root authority evidence only: the downstream Team
patch/materialization, Worker runtime admission, real General+Goose mixed
journey, fresh-profile Electron journey, Task 14, and P6 acceptance remain
open. No push, PR, Actions/CI, release, or deployment is claimed.

The current uncommitted Task 14 batch is local on branch
`codex/p6-aionui-team-acceptance` at base
`a3f23d6391a6f6c34f5a88cfa12e35b9665e5196`. Downstream patch 0014 now
embeds the orchestrated Team controls inside the native AionUI `ChatLayout`,
retains the native `TeamTabs` and `TeamViewToggle`, and routes native title
editing through the Actestra Main/Core rename projection. Orchestrated Teams
disable member drag ordering because that provider cannot yet persist the
operation; the standard Team default remains enabled. The affected local
closure passes 5 generated native test files with 27 tests, materialized AionUI
TypeScript, zero-warning targeted lint, and patch formatting. This is local
implementation evidence only: no commit, push, PR, Actions, package, release,
deployment, or user acceptance has occurred for these bytes.

The A3 pre-B1 checkpoint scope used explicit command definitions.
`git status --porcelain=v1 --untracked-files=all` reported 96 paths at the
checkpoint: 61 modified, 8 deleted, and 27 untracked files. Before B1 staging,
the same expanded command reported 97 paths: 62 modified, 8 deleted, and 27
untracked files. `git status --porcelain=v1` then reported 96 entries: 62
modified, 8 deleted, and 26 untracked entries. That default view folds the two untracked files under
`apps/desktop/src/main/model/` into one directory entry, while
`git ls-files --others --exclude-standard` lists all 27 untracked files.
`vitest.config.ts` was clean at the checkpoint and is now modified by the A2
focused correction, which accounts for the one-path increase in the expanded
view. Both status views had zero staged entries before B1 staging.

A1 local focused evidence: `bun run test:smoke-harness` is GREEN. A2 local
focused evidence is exactly `./node_modules/.bin/vitest run
tests/scripts/aionuiProductEntrypoints.test.mjs`, with `Test Files 1 passed (1)`
and `Tests 4 passed (4)`. The only companion files in this A2 check are
`tests/scripts/aionuiProductEntrypoints.test.mjs` and `vitest.config.ts`; both
pass `oxfmt --check`, and the same two-file scope passes `git diff --check`.
These are local focused checks only, not broad product or acceptance evidence.
`.codex-tmp`,
`supervisedLocalAgentProvider`, and `localAgentCli` remain outside the product
checkpoint: the latter two have no production consumer, and the temporary
compiler cache is not product source. `foundation/` has no worktree change.

A local safety incident is recorded separately. An A2 quality subtask
mistakenly started CodeRabbit without a path filter and with include-untracked;
it was interrupted. The CLI displayed authenticated and analyzing before a
WebSocket error ended the run, but emitted no file count, upload event, or
findings. Whether any data was uploaded cannot be confirmed. This run is not
review evidence, and external review remains prohibited without new
authorization. At the A3 pre-B1 checkpoint, no commit, push, PR, CI, or fresh
Electron acceptance had occurred for these bytes.

The latest focused standard-Team authority correction closes stale-list
mutation paths in the native AionUI sidebar. When the provider is active but a
delete or rename target has disappeared from the current Main/Core Team
projection, the renderer now fails closed with a fixed refresh instruction
before invoking either native AionCore IPC or a guessed standard/orchestrated
route. The provider-absent native fallback remains unchanged. The generated
`useTeamListCronCleanup.dom.test.tsx` RED reproduced the previous resolved
native-delete path; the final focused closure passes 2/2, and the native-wiring
retention file passes 9/9 with the matching rename guard. This is local
compatibility evidence only; it does not advance the orchestrated 2/7 ledger or
claim Task 14/P6 acceptance, fresh Electron acceptance, commit, push, PR,
Actions, release, or deployment.

The subsequent provider-active event-source audit corrected a sidebar run-state
authority mismatch. `useSiderTeamRunning` previously applied both Actestra
provider events and raw native AionUI run lifecycle payloads even though its
snapshot reads already used Main/Core. Native run events now remain available
as compatibility hints but, while the provider is active, trigger a bounded
Main/Core run-state reconciliation instead of mutating the badge directly.
Validated Actestra provider events still apply immediately, and provider-absent
AionUI keeps its original native event behavior. The focused RED reproduced the
direct native update; the final renderer file passes 25/25, materialized strict
TypeScript and zero-warning lint pass, and the downstream contract remains
green at 308 declared files with 92 reviewed source copies. This does not
advance the orchestrated 2/7 ledger or establish broader Task 14 acceptance.

The matching Team-page audit closes the remaining run/slot event-source split
inside `useTeamRunView`. Its initial snapshot already came from Main/Core, but
six native run lifecycle channels and native `slotWorkChanged` still mutated
renderer state directly and the page did not subscribe to the validated
Actestra provider stream. With the provider active, native run/slot events now
act only as reconciliation hints; Main/Core provider run/slot events apply
directly and invalidate any older in-flight snapshot. With the provider absent,
the original AionUI event behavior remains intact. Native child-turn, chat, and
session-status paths are intentionally unchanged because their retained
standard-Team capabilities do not yet have an equivalent Main projection. The
focused RED produced five exact failures across native run/slot hints,
provider run/slot events, and stale in-flight snapshot ordering; the final
generated file passes 17/17. Materialized
strict TypeScript, zero-warning targeted lint, two-file formatting, and the
downstream contract at 308 declared files with 92 reviewed source copies pass.
This is local event-authority evidence only; it does not advance the
orchestrated 2/7 ledger or claim Task 14/P6 acceptance, fresh Electron
acceptance, commit, push, PR, Actions, release, or deployment.

The next provider-active retention audit separates the native permission and
scheduled-task surfaces by their real authority paths. Team `CronJobManager`,
its job events, and delete-before-Team cleanup already use the preserved
`ipcBridge.cron` DTO while `httpBridge` routes every `/api/cron/*` request and
event through the Actestra Main/Core schedule provider; no schedule production
byte changed. The permission decision POST already crosses the accepted
Actestra approval persistence, policy, audit, and delivery boundary. The actual
gap was the visible pending-confirmation count: the in-page and sidebar hooks
still consumed native list/event data directly after the Team provider became
active. They now hydrate or reconcile from the Main/Core Team projection and
treat native confirmation events only as refresh hints; provider absence keeps
the original native list and delta behavior. The focused RED failed the two
provider-active cases with the exact `0` instead of `3` and `2` instead of `4`
counts while the native fallback passed. GREEN passes the new file at 3/3 and
the five-file permission/Team-page/cron closure at 43/43. A follow-up RED then
proved that an older in-flight sidebar reconciliation could overwrite a newer
Main/Core Team-list projection. The Team-list signature change now invalidates
every affected reconciliation sequence before replacing visible counts; the
new file passes 4/4 and the same five-file closure passes 44/44. Materialized
strict TypeScript, exact patch formatting, and zero-warning two-file lint pass.
The downstream contract remains the next unchanged-input contract check. This
is local standard-Team retention evidence only; it does not advance the
orchestrated 2/7 ledger or claim Electron acceptance, commit, push, PR,
Actions, P6 completion, release, or deployment.

The current uncommitted correction adds forward-only schema 16
`team_experience_bindings` while preserving the accepted schema-15 migration
bytes. Main now persists `standard` before returning a newly created native
Team, migrates legacy AionCore Teams to `standard`, binds schema-15 Actestra
Team definitions to `orchestrated`, rejects type or cross-store identity
conflicts, and restores both types after restart. Provider-active renderer
list/get now consume one Main/Core projection; they no longer merge a native
list with an Actestra list or infer a missing type. Focused evidence currently
passes the 5-test Core authority file, the 41-test Main Team service file, the
16-test persistence-utility client file, root and materialized AionUI strict
TypeScript, the generated 5-test experience-routing DOM file, and the smoke
harness. This remains local development evidence, not Task 14 or P6 acceptance.

The standard-Team create failure exposed by the first fresh Electron journey is
now corrected locally. When no folder is selected, AionCore owns an
`auto_from_leader` workspace rather than echoing the renderer's empty selection;
Main previously rejected that authoritative result as a conflict and
compensating-deleted the valid Team. A focused regression failed with the exact
`The persisted standard Team differs from the admitted creation intent` error,
then passed after Main accepted AionCore's validated workspace while retaining
exact equality for an explicit user selection. The complete affected Main file
passes 38/38 tests.

A fresh `/tmp`-isolated real Electron profile then created standard Team
`019fd31e-a4bd-7b41-ba88-2bf6cddae0aa` from the native `+` chooser with Claude
Code as leader and Codex CLI as teammate. The native page exposed Team tabs,
parallel/single views, per-member chat and model controls, add-member, and the
workspace file panel. Codex returned exact `CODEX_TEAM_OK`; Claude returned
exact `CLAUDE_TEAM_OK`. Restarting the same isolated profile restored the same
standard Team, both members, both replies, and native workspace view. The four
local Claude/Codex/Aion logo requests returned `200`, and the visible member and
navigation icons rendered through the native image controls. Both shutdowns
left no profile-owned Electron, AionCore, Claude, or Codex process and no agent
process registry; the test profiles were moved to Trash. No file under
`~/.actestra-v1-dev` was newer than the isolated profile marker. Gemini and
Google credential variables were explicitly removed, and no Gemini credential
or API request was read or used. This exercised AionUI's standard-Team AionCore
provider path; it does not admit Claude or Codex as an Actestra orchestrated-
Team planner, aggregator, General Worker, or Goose model provider.

The screenshot regression `创建团队失败 / The Team conflicts with durable
authority` is now corrected in the uncommitted Main/Core session-mode slice.
AionCore's `GET /api/teams/:id` contract legitimately omits `session_mode`;
Main now treats that omission as compatible with the previously confirmed safe
write, keeps explicit unsafe values fail-closed, and returns the Main-owned safe
projection. The focused RED-to-GREEN closure is 8/8, including create, explicit
session-mode write, and warmup-seed omission cases; the added AionCore/session
combination is 3/3. Root and materialized strict TypeScript, exact two-file
formatting, and zero-warning lint pass, and the latest materialized production
build exited 0 without rerunning the full root gate.

A fresh profile at
`/tmp/actestra-p6-session-authority-fix-20260806b` launched the latest Electron
bytes with Electron user-data, AionCore runtime/data, HOME, and TMPDIR under the
same isolated root. The Team `+` chooser, native Standard Team form, Claude Code
and Codex CLI icons, and member selection were visible; creation returned 201,
entered `/team/019fd757-e95a-7061-b788-024fd787e639`, and never showed the
durable-authority error or deleted the Team. The backend log records successful
`session-mode` writes, a 200 Claude config-options postcondition, and an
isolated-profile Codex runtime-not-ready response; this is an authentication or
runtime-readiness limitation of the disposable HOME, not a Team creation
conflict. No Gemini request or credential was used. The app then exited through
the normal quit path; the profile-owned process registry is empty and no
Electron/AionCore/Claude/Codex process or test fixture remains. The daily
`~/.actestra-v1-dev` directory remains absent/empty. This is fresh local
Electron evidence only; it does not close the remaining native warmup/error
journey, advance the orchestrated 2/7 ledger, or claim Task 14/P6 acceptance,
commit, push, PR, Actions, release, deployment, or user acceptance.

The remaining focused standard-Team sidebar and member-operation set is now
closed on the same local production bytes. Delete removes the Team from the
sidebar, rename persists through the native menu, pin/unpin changes ordering,
and the native member-tab close removes a Main/Core-projected Claude member.
The first member-removal RED exposed a test-only authority bypass:
the generic E2E helper mapped `team.add-agent` directly to AionCore HTTP and
then swallowed its error. The corrected setup calls the provider-active
`window.actestraTeam` contract with `experience: standard`, asserts the
Main/Core response, and the exact failed journey passes 1/1 in 48.6 seconds.
The three unchanged companion journeys already passed in the same 4-test
session. A downstream retention guard now rejects reintroducing the direct
helper path. Final exit left no worktree-owned Electron/AionCore/Claude/Codex
process and no new E2E state or profile directory.

A later `team-session-mode` attempt did not execute the permission journey and
is not additional acceptance evidence. Re-materialization had removed the
generated Electron main output, so the Playwright `electronApp` fixture timed
out during setup before the Team UI opened. The new worker-scoped teardown still
removed that failed attempt's isolated user-data and state roots, and the
post-run audit found no worktree-owned Electron, AionCore, Claude, Codex, or
planner process. The production bundle prerequisite has since been rebuilt, but
the already-green 1/1 permission journey was not repeated because no related
product byte or acceptance input established a new verification key.

The current local E2E-fixture correction establishes a new safe verification
key before any further native journey. Electron user-data, AionCore runtime and
data, HOME, TMPDIR/TEMP/TMP, and XDG directories share one disposable
`actestra-e2e-*` root; the launch environment also removes common model API-key
variables without reading their values. The first runtime assertion failed
before the Team journey with exact evidence that macOS Electron still reported
`appHome` as `/Users/zizimutou`, despite the isolated `HOME` environment. The
source-of-truth patch now passes explicit isolation-root, home, and temp paths
to the app. E2E-only startup validates that those paths and user-data are
absolute, non-root, lexically contained, and still contained after realpath,
creates them privately, and calls `app.setPath('home', ...)` and
`app.setPath('temp', ...)` before the first `app.getPath('appData')`. Normal
development and packaged startup do not enter that branch.

The focused native-wiring RED failed only the missing explicit path contract;
GREEN passes 9/9, materialized strict TypeScript, exact patch formatting,
zero-warning fixture/test lint, and the 311-file downstream contract with 92
reviewed source copies. The final materialized production build succeeds. One
new-key real Electron `team-session-mode` journey then passed 1/1 in 35.0
seconds. Its startup log proves that Electron user-data, `appHome`, `appTemp`,
`DATA_DIR`, environment home, and environment temp all lived under exact root
`actestra-e2e-dJpiF1`. The native Standard Team was created without the
durable-authority error and reached the explicit permission-unavailable state;
this run therefore proves safe creation and error presentation, not a successful
mode switch. Normal teardown removed the exact isolation root and left no
matching Electron, AionCore, model, or planner process. The daily
`~/.actestra-v1-dev` profile still contains no file. Real warmup success and the
remaining error/recovery journeys remain open.

A clean downstream reconstruction also exposed and corrected two patch-0014
ordering defects: one attempted to edit the chooser DOM test before creating
it, and one failed to preserve the escaped Team-route regex while matching a
later E2E edit. The corrected source-of-truth patch materializes from the frozen
foundation and passes the 292-file downstream contract with 91 reviewed source
copies. The resulting AionUI main/preload/renderer production build succeeds;
its existing dynamic-import, circular-chunk, and large-chunk warnings remain
non-blocking. Gemini CLI is excluded from the current acceptance matrix because
the owner has not configured a usable local model; no further Gemini diagnosis,
invocation, credential access, or network request is planned for this batch.

The retired P2 renderer no longer supplies the root development, preview, or
package entrypoint. A scoped product-boundary guard now scans all 17 modified
Team renderer/adapter paths in the materialized downstream application. It
rejects Node/Electron imports, CommonJS or `window.require`, direct network
clients, and process/environment authority while retaining the one compile-time
`process.env.NODE_ENV` debug flag. Its RED-to-GREEN rule set passes 10 focused
tests, and the guard passes against the same 293-file downstream reconstruction.
No secret-shaped value, unexpected file-mode change, frozen-foundation change,
or live Actestra/AionCore/Claude/Codex process was found in the final pre-gate
audit. The prior root gate passed once on the then-stable production/test
bytes: formatting over 248 files, zero-warning lint over 243 files, strict
TypeScript, the Electron SQLite probe, 90 passing and 2 skipped test files with
820 passing and 8 skipped tests, the deterministic smoke harness, the
106-source product boundary, the frozen 1,766-file AionUI selection, the
293-file downstream contract with 92 reviewed source copies, and the
production build with 643 main, 30 preload, and 10,198 renderer modules.
Existing dynamic-import, circular-chunk, and large-chunk warnings remain
non-blocking. The current batch subsequently changed production/test bytes for
the Main-owned standard-Team config setter, so this root-gate result is
historical evidence and does not certify the final bytes. Per the current
validation budget it is not being repeated; final delivery must rely on the
narrow evidence below plus the one eventual exact-head gate.

The standard-Team configuration, rename, deletion, and member-mutation
corrections have their own focused evidence: the bridge contract is 8/8 plus
the standard-slot route closure is 1/1, the Main Team service was 47/47 before
the deletion delta, deletion is 2/2, and member rename/removal is 2/2; the
materialized downstream `useAcpModelInfo` DOM contract is 12/12, native Team
wiring was 8/8 before the deletion delta and its deletion/member wiring closure
is 1/1, and the affected downstream TypeScript check passes. The downstream
overlay contract now passes with 301 declared files and 92 reviewed source
copies. The earlier four newly declared source-copy paths are
`useAcpConfigOptions.ts`, `useAcpModelInfo.ts`, `teamConfigOptions.ts`, and
`useAcpModelInfo.dom.test.ts`. The session/warmup closure additionally declares
`useTeamWarmup.ts`, `AcpSendBox.dom.test.tsx`,
`TeamPermissionContext.dom.test.tsx`, and `useTeamWarmup.dom.test.tsx` in the
changed-file contract; no additional reviewed source-copy scope was added.

Provider-active standard-Team title, deletion, and member edits now return
through Main/Core. Main routes only an identity durably bound as `standard`,
sends bounded PATCH or DELETE intents through the AionCore loopback provider,
and requires the requested name, member name, or member absence in the
observed projection before acknowledging the renderer. Native AionUI slot IDs
remain bounded provider identities; only schema-15 orchestrated members use
Actestra's `team-member-<digest>` identity rule. The retained AionUI deletion
flow still performs its cron cleanup before the Main-owned Team delete; Main
emits removed, agent-removed, and agent-renamed events only after the relevant
postcondition. The fixed event boundary now admits bounded provider-owned Team
and slot identities for those cross-experience list, rename, deletion, and
member events, so standard-Team callbacks survive preload/renderer validation;
schema-15 run, slot-work, teammate-message, and assistant events retain strict
Actestra digest identities. The native Team session receives provider callbacks
while the provider-absent native fallback remains intact. This closes the
configuration, title, deletion, member, and session-mode write bypasses. At this
checkpoint, standard message/control writes still required the same authority
audit. It does not start a planner or Worker and does not advance the
orchestrated 2/7 ledger.

The same provider-active authority now owns both standard-Team warmup entry
points. Main routes `POST /api/teams/:id/session` by the durable Team experience,
persists and re-reads a safe session mode before starting AionCore, verifies
Claude `default` and Codex `auto` member modes, and compensating-stops a partial
session when a postcondition fails. `useTeamWarmup` and
`TeamPermissionContext` call that fixed Main/Core projection when the provider
is active and retain the native AionUI IPC fallback only when it is absent. A
controlled legacy-path RED failed at the projected-call assertion; final focused
evidence passes 4/4 Main session tests and 3 materialized renderer files with
29/29 tests. Root and materialized strict TypeScript, exact-path zero-warning
lint and formatting, the 1,766-file frozen-foundation check, and the 301-file
downstream contract with 92 reviewed source copies pass. This is local focused
evidence only; no real Electron acceptance, commit, push, PR, Actions run, or
orchestrated-ledger advance is claimed.

The subsequent session-mode/warmup authority closure added two provider-active
retention guards. A directed retry-start now calls the Main/Core projected
standard-Team attach intent and keeps native `attachAgent` only when the Actestra
provider is absent; a RED exposed the previous direct native call and the final
`teamSendRuntime` file passes 18/18. `TeamPermissionContext` now routes
provider-active session-mode and config reads through Main/Core, restores native
`team.setSessionMode` and `team.getConfigOptions` when the provider is absent,
and leaves the native ACP config setter in control in that fallback; its focused
DOM file passes 7/7. The combined affected renderer closure is 5 files and
57/57 tests, while the four Main session tests and four changed Team route
fixtures also pass. Root and materialized strict TypeScript pass; root changed
path formatting/lint and the four changed renderer paths pass with no warnings.
The downstream contract now records 303 declared files and 92 reviewed source
copies. This remains local compatibility evidence only; it does not start a
planner or Worker, advance the orchestrated 2/7 ledger, or claim Electron
acceptance, commit, push, PR, Actions, or P6 completion.

The next focused `useTeamSession` closure applies that authority split to
session revalidation and member addition. With the provider active, SWR reads
the Team through the fixed Main/Core projection and member creation submits the
bounded standard-Team intent; with the provider absent, the original native
`team.get` and `team.addAgent` paths remain reachable. The RED run failed the
two expected assertions with the other 6 tests passing; the final generated DOM
file passes 8/8. Materialized strict TypeScript, exact patch formatting, and
zero-warning lint for the generated hook and test pass, and the downstream
contract remains green at 303 declared files and 92 reviewed source copies.
This is local standard-Team compatibility evidence only; it does not start a
planner or Worker, advance the orchestrated 2/7 ledger, or claim Electron
acceptance, commit, push, PR, Actions, or P6 completion.

The next standard-Team control audit found that pause and cancel called the
provider before proving that the requested run was still current. A stale run
ID, or a matching run already in a terminal state, could therefore reach the
AionCore effect before the later postcondition read. Main now projects the
current run state first, requires the requested run to be the active accepted or
running run and the member work to reference that same run, then performs the
provider effect and retains the existing post-effect reconciliation. The stale
and terminal RED cases both previously resolved successfully; the final focused
closure passes those two rejection cases plus one valid running-to-paused
precondition/effect/postcondition sequence at 3/3. Root and materialized strict
TypeScript pass, and the two root source/test paths pass exact formatting and
zero-warning lint. The downstream contract remains green at 303 declared files
and 92 reviewed source copies. This remains local standard-Team control
evidence. At this checkpoint, standard message durability and the remaining
Task 14 native/error journeys were still open; the orchestrated ledger remained
2/7, and no commit, push, PR, Actions, or P6 completion was claimed.

One parallel full Main-file attempt passed 56/57 and timed out only while the
already-closed no-orphan guard read `/bin/ps` under its test-only 50 ms grace.
The same file had passed 57/57 before that concurrent attempt, and the failed
test's `finally` cleanup left no probe process or test directory. A proposed
unrelated timeout expansion was removed; the no-orphan layer was not rerun or
changed by this session/warmup closure.

The latest focused standard-Team message correction closes that remaining local
delivery-authority gap with forward-only schema 17. Main persists a metadata-
only `pending-effect` delivery before the AionCore message effect, records the
bounded provider message/run acknowledgement only after the same run is
observed, and records `effect-uncertain` after an ambiguous failure. One
Main-owned delivery ID, bounded client nonce, and request SHA-256 make an
observed duplicate safely replay its durable acknowledgement without repeating
the effect; a changed request conflicts, while pending or uncertain delivery
fails closed. Only one unresolved delivery may exist for a Team/target, and
startup converts interrupted pending deliveries to uncertain before bridge
registration instead of resending them. Message content and attachment paths
are not persisted. The renderer stores only the nonce and request fingerprint,
reuses them after failure or reload, and clears them after acknowledgement.
Focused RED proved duplicate provider effects and missing renderer nonce reuse.
The corrected closure passes 5 persistence/utility/bridge files with 66 tests,
9/9 affected Main message/recovery/orchestrated tests, the complete 13/13 root
bridge file, generated downstream slow-response 7/7 and native-wiring 8/8
files, downstream path safety 3/3, and root plus materialized strict TypeScript.
This is local focused evidence only: no fresh-profile Electron message journey,
commit, push, PR, Actions run, orchestrated-ledger advance, or P6 completion is
claimed. Remaining native/error journeys and the real orchestrated Team journey
remain open.

The latest session-mode authority slice closes the provider-active Team lease
path without changing the retained native fallback. A RED first showed that
`useActiveLease` still called native `ipcBridge.team.activeLease` while the
Actestra provider was active, and a Main/Core RED showed that the existing
`active-lease` route only read run state instead of forwarding the standard-Team
lease effect. Main now checks the durable experience binding, forwards
standard-Team renewal through the bounded AionCore loopback route, and keeps
orchestrated Teams on their Actestra-owned state projection. The generated
renderer hook selects the Actestra client only when the provider is active and
retains native IPC otherwise. The final focused evidence is root Main/loopback
3/3, materialized lease DOM 6/6, materialized strict TypeScript, downstream
overlay 305 declared files with 92 reviewed source copies, exact-path format,
and zero-warning lint. This remains local compatibility evidence only; the
no-orphan `/bin/ps` path was not changed or rerun, the orchestrated ledger stays
2/7, and no planner, Worker admission, Electron acceptance, commit, push, PR,
Actions run, or P6 completion is claimed.

The next native Team projection slice closes two remaining provider-active read
bypasses in the visible AionUI shell. `useSiderTeamRunning` now hydrates each
Team's running badge from the Main/Core projected run-state, subscribes to the
fixed Actestra run-event provider for orchestrated Teams, and retains native
run-state/events when the provider is absent. The mobile titlebar now resolves
the Team name through the same Main/Core Team projection when provider-active,
while preserving the native fallback. RED failed both provider-active sidebar
journeys against the old native-only hook; GREEN passes the affected sidebar
DOM file and native-wiring guard. The combined downstream focused closure is
39/39 tests, materialized strict TypeScript, zero-warning lint, and the 307-file
downstream contract with 92 reviewed source copies. This remains local
compatibility evidence only: no real Electron acceptance, planner or Worker
admission, commit, push, PR, Actions run, or P6 completion is claimed.

The latest no-credential Task 14 UI audit found one additional orchestrated-
Team defect: a failed authoritative create sent the raw bridge error message to
a transient Toast and left no durable explanation in the form. The focused RED
failed because the error region was absent. Patch 0014 now preserves every
field, shows a localized bounded failure plus the next valid retry step, and
does not render the raw bridge method or path. The exact generated DOM file
passes 4/4 tests. This closes only the create-failure presentation defect; it
does not supply a production planner or advance the 2/7 orchestrated-Team
acceptance ledger.

The subsequent startup-chain correction removes the attempted local-Agent
startup injection and all three provider/runtime destinations from the shipped
downstream source-copy graph. The generated desktop index now performs no
Claude/Codex provider admission or Team/coding runtime assembly before
persistence startup. The affected downstream contract passes with 293 declared
files and 92 reviewed source copies; generated native wiring passes 8/8, the
overlay path-safety contract passes 3/3, nine changed paths pass formatting,
three changed scripts pass zero-warning lint, all 64 Markdown files pass link
resolution, and `git diff --check` passes. The unchanged non-shipped provider
rejection tests were not repeated, and no full root gate was run. This is a
fail-closed product-graph correction only and does not advance the 2/7 ledger.

The next local correction makes that fail-closed state visible before effect.
Main now projects a closed `submission` availability object from the actual
admission/orchestrator composition in every orchestrated Team run-state read.
With no admitted runtime it returns `unavailable`,
`planner-unavailable`, `restart-after-planner-admission`, and the
`actestra-main-runtime` authority source. The bridge rejects inconsistent
availability/reason/action combinations. The AionUI-native page displays the
localized reason and next step immediately, disables task input and Run Team,
and refuses the submit handler before any bridge intent; the existing POST
rejection remains a race-safe Main boundary. Focused RED proved both the absent
Main projection and absent UI state. GREEN passes the 3-file bridge/Main
closure with 55 tests, the new inconsistent-contract check, the complete
generated workspace file with 8 tests, root and materialized strict TypeScript,
and the 293-file downstream contract. No planner, Worker, credential, model
request, run record, commit, push, PR, Actions run, or ledger advance is
claimed.

Task 14 remains open. The standard-Team permission-count and scheduled-task
authority paths now have the focused local evidence recorded above, but their
fresh Electron error/recovery acceptance and the complete native journey still
remain open. The orchestrated Team still has only its explicit
planner-unavailable journey rather than a real admitted planner, General+Goose
plan, protected approvals, controls, Artifact aggregation, and restart
recovery. No commit, push, PR, Actions, package, release, deployment, or user
acceptance is claimed for the current local bytes.

The existing orchestrated-Team acceptance ledger remains 2/7; this provider
hardening does not advance it. Live source audit confirms five
remaining blockers: product startup supplies no admitted planner/model binding;
the resulting null runtime leaves Team admission and orchestration unavailable;
General Work still selects deterministic execution modes from `journeyKind`;
the real Electron journey has not completed the mixed General+Goose,
dependency, protected-approval, control, Artifact/aggregation, and restart
postconditions; and the whole uncommitted batch still lacks one final stable-
byte delivery and acceptance closure. The first four are product/acceptance
gaps. The last is delivery state and must not be used to conceal them.

The same source audit found and locally corrected one narrower defect in the
unavailable path. `TeamPlanAdmissionService` now maps sidecar startup/request
timeouts to `planner-timeout`, protocol or Core candidate-admission failures to
`planner-invalid`, and every other unavailable planner failure to the existing
generic category. The fixed bridge exposes bounded 504
`team-planner-timeout` and 422 `team-planner-invalid` envelopes, and AionUI
preserves the task while showing distinct English/Chinese recovery guidance
without rendering private error details. RED failed the expected four cases;
GREEN passes the three affected Main/bridge files with 56 tests and the
generated Workspace DOM file with 10 tests. Root and materialized strict
TypeScript, exact eight-path format/lint, and the 293-file downstream contract
also pass. No provider, credential, model, tool, Worker, or run was started;
the unchanged spawn-rejection tests were not rerun, and the 2/7 ledger does not
advance.

The next local UI audit removed four remaining raw-error paths from the
orchestrated Team page. Control/approval, workflow feedback, whole-Team cancel,
and rename failures no longer display a runtime `Error.message` in a transient
Toast. They now select one fixed localized inline error and recovery step while
preserving the authoritative Team projection. The generated Workspace DOM file
passes 12 tests, including approval, cancellation, and rename failures that
contain private bridge paths or runtime details; none is rendered. Patch and
guard formatting plus zero-warning lint pass, the materialized AionUI strict
TypeScript check passes, and the 293-file downstream contract rejects restoring
the four raw-message branches. An initial parallel TypeScript attempt was
invalid setup evidence because the downstream checker rebuilt the same
materialized tree while `tsc` read it; one clean serial materialization and
TypeScript run then passed. This UI containment does not start a planner or
Worker and does not advance the 2/7 ledger.

A further live audit corrected an initial assumption: the bridge already
validated node and slot blocked reasons against closed enums, so no redundant
contract was added. The actual defect was renderer presentation. For every
Main-owned dependency, human-feedback, protected-approval, attempt-failed,
cancelled, paused, handoff, or interrupted reason, AionUI now renders fixed
English/Chinese explanation text instead of the Main English
`blocked_explanation`; an unreachable unknown value has fixed fail-closed copy.
The focused RED failed with the old protected-write explanation. After the UI
mapping, the first GREEN attempt exposed one stale old-text assertion; the
updated complete Workspace file passes 13/13. Materialized strict TypeScript,
two-path format/lint, and the 293-file downstream contract pass. This improves
multilingual explainability only and does not admit or execute a planner or
advance the 2/7 ledger.

The next focused UI RED found that run, member, node, and capability cards still
displayed raw Main tokens (`running`, `active`, `blocked`, and `coding`). Patch
0014 now maps every closed value in those four projections to fixed
English/Chinese AionUI labels and adds stable DOM markers. The RED failed at
13/14; the corrected Workspace DOM file passes 14/14. Exact patch/checker
formatting and zero-warning lint, materialized AionUI strict TypeScript, and
the 293-file downstream contract all pass. This is local explainability
evidence only; the orchestrated ledger remains 2/7 and Task 14 remains open.

An earlier production-startup call-chain audit exposed the orchestrated-Team
blocker. `configureActestraTeamRuntime()` and
`configureActestraCodingJourneyRuntime()` are exported by the materialized
desktop-main bridge but had no product startup caller. Persistence startup
therefore constructed `ActestraTeamComposition` with both the Team runtime and
coding journey unavailable; by contract it created neither
`TeamPlanAdmissionService` nor `TeamOrchestratorService`, so an orchestrated
send deterministically returns `team-planner-unavailable`. The generic
sidecar supervisor and deterministic test fixture are not a production
planner, and no CrewAI runtime or production Goose model broker has been
silently substituted. Closing the real Electron orchestrated journey requires
an explicitly admitted production planner plus coding runtime before another
acceptance claim. The current correction deliberately keeps that null-runtime
product state: it removes the attempted local-Agent startup injection and the
provider/runtime source copies from the materialized product graph. New
manifest, downstream, and native-wiring guards reject their reintroduction.

The same startup audit also prevents calling the existing mixed fixture a real
product Team run. The current General Work launcher selects deterministic
fixture execution modes from `journeyKind`; it does not yet bind a configured
local Agent runtime for ordinary product work. Goose's loopback model port
accepts raw completion and tool-call results, while Claude CLI and Codex CLI
are complete Agents with their own execution surfaces. Passing either CLI
through that port without an explicit no-tool, cancellable, policy-scoped
Main-owned provider would create a second execution authority. The retained
AionCore provider and Agent catalogue is useful compatibility input, but its
upstream API clients are not an accepted Actestra credential or policy
boundary. The materialized product now contains no local Claude/Codex planner
adapter or startup wiring. The General Worker still uses its deterministic
fixture modes and no real isolated Claude or Codex invocation is admitted. No
renderer-side credential, model, command, or authoritative-ID construction is
acceptable.

The owner authorized that local architecture change on 2026-08-06. A live
non-inference capability check found Claude Code `2.1.168` and Codex CLI
`0.144.3` on the local PATH without reading or printing either credential.
Codex advertises ephemeral structured output, ignored rules/config, and a
read-only sandbox but no enforceable all-tools-disabled mode. Its earlier
focused RED proved the first implementation still advertised planner and
aggregation; the correction projects zero capabilities and rejects structured
invocation before model-process spawn. Post-hoc event rejection is not accepted
evidence because an observed shell, file, MCP, or web event may follow an
effect.

The same investigation has now rejected the earlier Claude admission claim.
In one-variable non-inference checks, the closed environment reported OAuth
login until `--setting-sources ""` was added; that flag alone changed the same
`auth status` result to unauthenticated. Claude's own `--help` identifies
`--bare` as the only mode that skips hooks, LSP, plugin sync, attribution,
auto-memory, Skills, MCP, and all tools before execution, and explicitly states
that bare mode never reads OAuth or Keychain. Private HOME, private
`CLAUDE_CONFIG_DIR`, and the documented secure-storage split did not produce a
safe OAuth-visible configuration. Enabling real user settings, invoking a
shell-based `apiKeyHelper`, or forwarding a raw OAuth token/API key would widen
the boundary and was not attempted. These checks made no model/API request and
their temporary roots were removed.

The local evaluation correction projected empty capabilities for both Claude
and Codex, removed the unsafe Claude model invocation/output-parser path, and
returned `capability-unavailable` before model-process spawn. The focused
2-file rejection closure is GREEN at 4/4 on those bytes; it is retained as
non-shipped research and was not rerun for this product-graph correction. The
ordinary desktop product does not
construct, catalogue, version-probe, help-probe, or invoke that prototype; it
does not create a Goose-attempt root, compose a Team/coding runtime, or forward
credentials. The obsolete product-runtime adapter and structured runtime were
removed rather than retained as dead production code.

Script-based Codex has no equivalent pre-execution proof and remains
admission-disabled. Claude remains unavailable because its safe bare boundary
cannot reuse the accepted local authentication path without widening credential
authority. A post-hoc shell, file, MCP, or web event can never upgrade either
candidate. No real credential, tool, model, or network request was used, and no
CrewAI, commit, push, PR, Actions run, or P6 acceptance is claimed. Real
planner/Goose execution, the non-fixture General Worker, and the orchestrated
Team journey remain open.

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
passed macOS arm64 foundation job 91750962007 and Goose runner admission job 91750962049. CodeRabbit exhausted its review quota and GitHub records no
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
macOS arm64 foundation job 91786216829 and Goose runner admission job 91786216934. CodeRabbit selected all 15 changed files but supplied only its
Free-plan summary and walkthrough, skipped the unchanged integration file as
similar to its prior review, and left no submitted review, inline comment, or
review thread. The branch squash merged as
`08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`. Exact merged-main CI 30845006202
passed macOS arm64 foundation job 91791030796 and Goose runner admission job 91791030814.

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
passed macOS arm64 foundation job 91813249905 and Goose runner admission job 91813250047. CodeRabbit selected all 12 files but explicitly stopped at its
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
macOS arm64 foundation job 91836946596 and Goose runner admission job 91836946628. CodeRabbit explicitly did not start a review because its quota was
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
passed macOS arm64 foundation job 91845074323 and Goose runner admission job 91845074258. The branch squash merged as
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
passed Goose runner-admission job 91983312901 and macOS arm64 foundation job 91983312925. GitHub records no submitted review or inline thread; CodeRabbit's
successful status is not represented as line-level review evidence. The branch
squash merged as `30742934adde1e0944c4e8ced1f005452a1f3568`; exact
merged-main CI 30907869824 passed Goose job 91987128709 and macOS job 91987128766. The bounded team-plan admission slice is accepted on `main`.

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

Pull request 46 reached exact pushed head
`e529e4c572209e61cc4ca3660e25bfe35fd2ce24`. Its sole exact-head CI run
30913054785 passed the root source, test, documentation, materialized-native
TypeScript, identity-isolation, build, and package-boundary steps in macOS job
92004255775, then failed the clean-profile target-app smoke with
`prepare-schedule-restart did not leave exact schema version 13 schedule
authority`. Production had correctly migrated the clean profile to schema 14;
the external packaged-smoke contracts still hard-coded the previous schema 13
value. Goose job 92004255657 was cancelled while building its artifact to stop
further Actions consumption, so the overall run ended `cancelled`. The failed
SHA is not rerun.

The local, unpushed correction remains in the larger P6 Team Work batch. Its
smoke constants now follow current schema 15 while preserving schema 14 as the
unchanged admitted-plan authority. Schema 15 separately adds immutable Team
definitions, current Team run heads, and append-only Team run revisions. The
pure Core reducer owns dependency readiness, immutable attempts, workflow
feedback versus protected-operation Approval references, pause/resume,
failure/retry, replacement, handoff, whole-run cancellation, deterministic
interruption recovery, and reference-only result aggregation.

The Core Team run file passes 13 tests. The affected six-file persistence and
protocol closure totals 58 tests: 57 passed in the combined run, and its sole
stale schema-14 single-step migration expectation passed after its input was
fixed to the first 14 migrations. The smoke harness, explicit-path formatting,
zero-warning lint, and strict TypeScript pass.

Final authority review then found that existence and contiguous-revision checks
alone could still admit a structurally valid substituted first run or later
state rewrite. A focused RED proved that a run with a noncanonical `runId` was
stored. The corrected SQLite barrier now reconstructs revision 1 from the
referenced canonical schema-14 plan and Team, including immutable node and
limit bytes, and accepts every later revision only when one allowed Core
transition or deterministic recovery reproduces it exactly. The focused test
passes 1/1 after the correction; the final changed Core/persistence closure
passes 2 files and 17 tests, explicit-path format and zero-warning lint pass,
and strict TypeScript passes. No second root gate, packaged target-app smoke,
push, or Actions run was performed. Pull request 46 remains open and unmerged;
this work is not yet a scheduler, Worker execution, Team UI, CrewAI admission,
or P6 completion claim.

This durable-authority checkpoint is committed locally on
`codex/p6-team-plan-persistence` as
`ae2d4b98a05ef9f89b30e8cd3734f46d38d50345`. It is one unpushed internal
checkpoint in the larger P6 batch, not an exact-head CI, merge, or acceptance
state.

The next local, unpushed Task 3 layer adds a closed version-1 planner-sidecar
protocol plus a generic supervised JSON-lines process. `propose` accepts only a
normalized `TeamPlannerRequest` and returns a typed `TeamPlanCandidate` for Core
re-admission. `aggregate` receives only Actestra correlation/plan/run identity,
revision, and bounded Artifact references, and its result must preserve the
same ordered references exactly. The process accepts one request at a time,
uses `shell: false`, a closed environment without inherited `HOME`, `PATH`, or
parent secrets, explicit telemetry-disable and network-denial policy variables,
bounded stdout/stderr handling, exact engine/protocol negotiation, sanitized
errors, startup/request timeouts, caller cancellation, and TERM-to-KILL process
group cleanup. The final focused closure passes 3 files and 19 tests; targeted
format, zero-warning lint, and strict TypeScript pass.

The deterministic process fixture is explicitly not CrewAI. This is not proof
of an OS-enforced network sandbox, a real CrewAI runtime, exact Python locks,
license/NOTICE/SBOM/`pip-audit`, cross-platform packaging, real mixed
General+Goose work, Team UI, or P6 completion. The production planner provider
remains unavailable until every ADR-0015 admission gate is satisfied.

The local, unpushed Task 4 layer adds the Actestra-owned Team scheduler,
control, subscription, and restart-recovery service over the schema-15 Core
state machine. It persists every snapshot before notifying observers or
launching, pausing, resuming, cancelling, replacing, handing off, or aggregating
an effect; serializes mutations per run; starts two admitted dependency-free
Workers within concurrency `2`; waits for durable Artifact references before
opening feedback or aggregation; and retains protected Approval/audit
references separately from workflow feedback. Child and whole-Team
cancellation, retry with a new attempt, replace, handoff, concurrent stale
control rejection, close cleanup, persisted cancellation despite cleanup
failure, and deterministic running/paused-to-interrupted recovery are covered.
The final focused closure passes 3 files and 31 tests; explicit-path format,
zero-warning lint, and strict TypeScript pass. The Worker port is still a
deterministic fixture: no real General+Goose router, mixed journey, AionUI Team
provider/UI, package, push, Actions run, or P6 acceptance is claimed.

The local, unpushed Task 5 layer routes the scheduler through the real
`AionUiGeneralWorkJourneyService` and the admitted isolated Goose coding
journey. Deterministic run/node/attempt bindings produce main-owned General and
coding Task identities; the scheduler supplies no root, model, runner,
commands, credential, or approval actor. Each journey must finish in Actestra
persistence, and its available Artifact must match the admitted kind before a
reference can return to the Team state machine. A real integration RED exposed
that the router incorrectly passed the General projection limit `100` to the
coding service whose closed maximum is `50`; the corrected router lets each
journey apply its own authoritative default.

The real mixed fixture uses the writing General Worker service plus the exact
locally built and admitted `aarch64-apple-darwin` Goose runner manifest
`7444e12e4e218cfd4d4d8f9ae253dee12b9b1930b5546849498790277328b9df`.
General and Goose are active in parallel. Goose file-write, focused-test, and
publish operations each block on distinct real policy, ApprovalService, audit,
and persist-before-effect/outcome evidence. The completed run aggregates only
the two durable document/file Artifact references. Separate real cases prove a
denied write never executes and whole-Team cancellation aborts the model,
closes the General Worker, removes the coding worktree and private runner root,
leaves one unchanged clean source checkout, and never aggregates a cancelled
run.

The final Task 5 router/orchestrator closure passes 2 files and 19 tests; the
admitted-artifact mixed closure passes 1 file and 4 tests. Strict TypeScript and
the targeted 17-path format and zero-warning lint checks pass. The admitted
runner artifact is local test evidence, not a candidate or release. That
checkpoint did not yet include the renderer/preload route or AionUI Team UI;
later local Tasks 6 through 8 now supply those layers. Real CrewAI admission,
package acceptance, push, Actions run, and P6 completion remain absent.

The local Task 6 layer now adds the fixed `actestra:team-request-v1` and
`actestra:team-event-v1` contracts, validates the retained native Team routes,
and exposes them only through a trusted current-main-frame IPC boundary. The
renderer can select only Actestra-owned Workspace references, fixed General and
Goose assistants, and the closed plan-mode Team controls; it cannot select a
runtime, model, filesystem path, Worker, plan, node, Approval identity, or
durable state. Invalid provider DTOs and events are contained before renderer
delivery, and private failure text is replaced with a bounded fixed envelope.

Schema 15 Team definitions now support two-to-five-member CAS updates, active-
run mutation exclusion, durable soft removal, safe duplicate retries, and
current run-head listing through the closed persistence utility and fail-closed
main client. The main-owned `AionUiTeamService` composes those operations with
the real plan-admission service and TeamOrchestrator: a focused integration
creates a Team, admits a user message as a durable plan, starts General and
Goose in parallel, projects Actestra authority/current executor/valid controls,
pauses the coding node, and cancels the whole Team while aborting both Worker
signals. The affected nine-file closure passes 72 tests; strict TypeScript and
targeted 18-path formatting and zero-warning lint pass. No downstream AionUI
patch, preload exposure, visible `/team/:id` page, packaged journey, push,
Actions run, or P6 completion is claimed.

The owner has clarified the remaining P6 product gate: AionUI v2.1.41 is the
sole design language, component system, navigation foundation, and visible
product surface, but its Team page and information architecture are not frozen.
The same P6 batch must deliver a real AionUI-native Team/group-chat journey for
creation, listing, `/team/:id`, member/role and General+Goose configuration,
workspace and task input, messages, plan/node/Worker progress, dependencies and
blocked reasons, protected approval, pause/cancel/retry/replace/handoff,
Artifact/result aggregation, and restart recovery. Actestra identity,
authoritative source, current executor, reason for blocking, and the next valid
action must be visible through coherent AionUI-style guidance, cards, and
controls. Each changed area requires recorded R1/R2 retention, compatibility,
and rollback evidence. No Goose or Eigent application UI may be introduced.

Local Tasks 7 and 8 are committed at
`94e6699b4fc352084ebfa53539b42e2496207ad5`. Downstream patch 0014 keeps the
frozen foundation byte-identical while exposing only `/api/teams` and declared
Team events through the fixed preload/current-main-frame provider. It adds the
AionUI-native Team creation/list and `/team/:id` group-chat surface, members and
roles, fixed General+Goose configuration, Workspace/task input, messages,
plan/node/Worker/dependency and blocked-state cards, protected approval,
pause/cancel/retry/replace/handoff controls, Artifact references, aggregation,
and restart guidance. The overlay records R1/R2 retention and rollback; the
current contract has 237 declared paths, 4 R0 invariants, and 91 reviewed source
copies.

The final local recovery correction persists bounded Team activities in the
native run projection. A user message is reconstructed from the canonical
schema-14 admitted-plan goal, while Worker activities and Artifact references
are reconstructed from schema-15 run revisions. Raw Worker summaries, private
paths, audit identifiers, process details, plan internals, and persistence
authority do not cross into the renderer. Reopening the same Team conversation
restores user and Worker group-chat activity, and live teammate events remain
filtered to that Team.

On these final Task 7/8 bytes, the root focused closure passes 4 files and 14
tests, the additional type-correction closure passes 3 files and 36 tests, the
Team DOM closure passes 1 file and 4 tests, and the earlier native Task 7
closure passes 20 files and 135 tests. Root and materialized-AionUI strict
TypeScript pass. The downstream checker passes 237 declared paths, 4 R0
invariants, and 91 source copies; exact-path formatting and zero-warning lint
pass. These are local focused and compatibility results, not the batch's final
root gate or package acceptance.

The single P6-batch `bun run check` was then executed on frozen head
`06fdea77994dd223fb0aff6f2c26582a01545a82`, tree
`29cfb11a12f0b3688e0b7f4bbe04d660ec078086`. Formatting over 248 files,
zero-warning lint over 240 files, strict TypeScript, and the Electron
37.10.3/Node.js 22.21.1/SQLite 3.50.4 probe passed. The test layer reached 84
passing and 2 skipped files with 747 passing and 8 skipped tests, then stopped
at three static-contract failures: four new AionUI Team compatibility files
were absent from the exact product-boundary allowlist, and two historical P5
tests incorrectly froze the global downstream phase and patch 0013's final
position.

Correction commit `292e1da6d89aac8876c6add87bf423ac28fcde28`
adds only those four declared compatibility paths and makes the P5 regression
tests assert retained patch presence rather than the repository's current
highest phase. The exact failed closure now passes 3 files and 12 tests;
targeted formatting and zero-warning lint pass. The complete root gate is not
repeated because the batch budget was one attempt.

The final shutdown audit then found one reporting gap in
`TeamOrchestratorService.close()`: it aborted and attempted cancellation for
every active Worker but swallowed each cancellation failure, preventing the
already-aggregating outer Team composition from reporting an incomplete
cleanup. A focused RED proved the close incorrectly resolved. The correction
still aborts and attempts every Worker, then throws one `worker-failed` error
whose cause aggregates every rejected cancellation. The full affected test
file passes 15 tests; exact two-path formatting and zero-warning lint pass. The
outer desktop owner continues attempting Team planner, coding journey, isolated
coding sessions/worktrees, schedule, and General Work cleanup in its recorded
order, then retains persistence authority for a later close retry if any owned
cleanup reports failure.

That production/test byte change invalidates the earlier fingerprint without
authorizing another root gate. The refreshed 57-file production/test/overlay
content-manifest fingerprint, computed from sorted path plus SHA-256 rows, is
`4e8c4a004f0ea573d091bd07d013be81fede7a7e6a7afeec39afd8227960c2e8`;
the unique exact-head CI is the remaining final-byte full-gate evidence. The
diff-scoped audit finds no frozen-foundation change, generated/package output,
non-ordinary file mode, high-confidence secret, foreign-project content, or
unresolved renderer, schema, approval-order, rollback, or source-checkout
blocker. Its conclusion that no sidecar/cleanup blocker remained was later
invalidated by live process evidence.

Pull request 46 reached exact final head
`eaae304ef6e4a3d555fd03885f316de62c07a83b`; exact-head CI 30946794552
passed, the branch squash merged as
`2b6821bd7b65f6debcbdaf5a40a0daaea6909885`, and merged-main CI 30948418563
passed. Those green layers did not exercise supervisor parent death. A live
2026-08-05 audit found detached fixture PID 91520 at PPID 1 and PGID 91520,
plus child PID 91521, still running after about 5 hours 29 minutes while the
temporary directory had already been removed. This reopens the no-orphan exit
gate and prevents P6 acceptance despite the merged implementation and green CI.

The exact process group was safely terminated and no matching planner fixture
process or temporary directory remains. Correction commit
`9c6cf1e7c4a83e97a4da49d36aaef429b1b77eed` was pushed to pull request 47.
Its sole exact-head run 30965777287 exposed two macOS cleanup failures in the
serialization and surviving-descendant tests: a negative-process-group
signal-0 probe raised `EPERM`, which the liveness helper incorrectly surfaced
as `cleanup-failed`. The already-doomed Goose job was cancelled; the failed SHA
was not rerun.

The follow-up keeps actual TERM/KILL permission failures fail closed but treats
probe-only `EPERM` as evidence that the process group is still alive. Commit
`cdae501e6009ed49583a82706e177fad7bdfa9e3` passed exact-head CI 30967391533;
GitHub recorded no submitted review or inline thread, and pull request 47 was
squash merged as `102ac48d7c1178f484662c40ef85c8d64a596ec4`. Its tree is
byte-identical to the passing exact head.

The sole merged-main run 30968128430 then failed the macOS job at the existing
P5.2 `isolatedCodingTools` output-limit test. The runner received
`tool-execution-failed` without the expected `output-too-large` cause. The
already-doomed Goose job was cancelled, and the failed merge SHA was not
rerun. Focused diagnosis found that registered-process cleanup waited a fixed
second after TERM and then signalled the old process-group identifier without
first proving that the group still existed. A denied stale KILL overwrote the
original bounded-output error as `process-cleanup-failed`.

The isolated-coding correction reached exact head
`e7805e37eab53c409367827479b72b835e98231e`, passed exact-head CI
30969172383, and pull request 48 squash merged as
`a24ad5ebb8b32595853fff1dedaefbbdd73da6bf` with byte-identical tree
`c269b5fab10ee1449deea1b02c4e28dca9d481ad`. Its sole merged-main run
30970186524 then failed the existing planner-sidecar serialization test with
`cleanup-failed` at the generic termination catch. The already-doomed Goose
job was cancelled, the overall run reached `cancelled`, and the merge SHA was
not rerun.

Focused diagnosis found that a sidecar with no descendants can exit after stdin
EOF while the old negative PGID reports `EPERM`. The corrected helper keeps
`EPERM` alive while the same-uid leader remains, but after the leader's observed
exit treats it as a stale or reused group identity; a surviving supervised
descendant remains signalable, and actual TERM/KILL errors remain fail closed.
Pull request 49 reached exact head
`a22121c63dc3d3bb3736ba85f797a6dfb6eac611`; exact-head CI 30971605452
passed both jobs. It squash merged as
`a3f23d6391a6f6c34f5a88cfa12e35b9665e5196`, whose tree
`fa76108ebed0031b1fa58f526ed5a5a23e8d96b8` is byte-identical to that exact
head; the sole merged-main CI 30972570429 passed. GitHub records no submitted
review or inline thread; CodeRabbit returned a review-limit response before
analysis, so its status is limit handling and not line-level review evidence.
This closes the merged planner no-orphan correction without claiming UI or
phase acceptance.

Task 14 local development then exposed a separate standard-Team model-catalog
probe leak: deleting the temporary AionCore conversation removed its registry
entry after the wrapper exited while a detached child remained in the same
process group, so application teardown lost its ownership evidence. The local
Main-owned guard now freezes only that conversation's PID/PGID snapshot before
DELETE, then performs bounded TERM/KILL cleanup from the frozen snapshot and
fails closed without touching another conversation. Backend close aborts and
awaits in-flight probes before composition continues. Focused RED-to-GREEN
evidence passes the 34-test service file, root and materialized strict
TypeScript, the 8-test native-wiring file, downstream source-copy equality, and
whitespace checks. The real detached wrapper/child probe is removed while an
unrelated process remains alive; the captured profile-owned PID/PGID and
temporary-directory scans are empty. These bytes remain local and unpushed.

The same local Task 14 batch now retains standard-Team creation failures inside
the native AionUI form instead of relying only on a transient toast. A focused
DOM RED first failed because `team-create-error` did not exist; the corrected
form preserves the Team name, members, and Workspace choice, displays the
Main-sanitized failure plus an English/Chinese CLI-login-or-configuration next
step, and keeps retry available. The exact focused file passes 14 tests; the
affected generated component, test, and two locale files pass the downstream
formatter, the component and test pass zero-warning lint, the root patch passes
formatting and whitespace checks, and the one affected root wiring assertion
passes under Vitest/Node.

The same local UI closure now fails closed when the authoritative orchestrated
Team run-state projection cannot be read: the workspace keeps the explanatory
authority-unavailable banner but disables task input and Run Team, and the
submit handler refuses the intent before calling the bridge. The new RED failed
the generated Actestra workspace file (7/8 passing); after patch 0014 was
updated, the focused file passes 8/8. This is a local UI/error-state fix only;
it does not admit a planner or add real mixed Worker execution.

A focused follow-up removes the remaining raw `running`, `active`, `blocked`,
and `coding` tokens from the visible orchestrated-Team workspace. Renderer
code now maps every closed Main-projected run status, assistant status, node
state, and node capability to fixed English/Chinese AionUI copy without
changing the authoritative values. The RED failed at 13/14 because the run
status was still rendered directly; the corrected Workspace DOM file passes
14/14. The two affected patch/checker files pass exact formatting and
zero-warning lint, materialized AionUI strict TypeScript passes, and the
293-file downstream contract requires the localized projection and stable DOM
markers. This is local, uncommitted explainability evidence only and does not
advance the 2/7 orchestrated journey ledger.

Fresh-profile native evidence remains local and unpushed. In one isolated
profile, a Claude Code leader and Codex CLI member both returned their requested
bounded replies in the preserved parallel Team view. A separate verification
key rooted at `/tmp/actestra-task14-gemini-nocred-CXnaap` fixed both Electron
user data and AionCore runtime beneath its `profile` directory and fixed
`GEMINI_CLI_HOME` beneath its separate `gemini-home`. Gemini/Google credential
variables were unset, no user Gemini configuration was copied or read, and
external proxy access was denied. The native standard-Team creation journey
returned `Authentication required` / `Gemini API key is missing or not
configured` in about 1.9 seconds. The fixed form retained the entered name and
member, showed the Main-sanitized unavailable-model error and CLI
login/configuration next step, and kept retry available. Immediately after the
failed creation, `GET /api/teams` was empty and the temporary AionCore Gemini
conversation Workspace was absent; Gemini CLI's own local state remained
confined to the isolated `gemini-home`. Final shutdown recorded `before-quit`,
AionCore graceful shutdown, `will-quit`, and exit code 0. The profile-owned
process registry contained zero entries; all captured Electron, AionCore, and
Gemini PIDs were absent; and no path under `~/.actestra-v1-dev` was newer than
the verification start. Gemini CLI is not configured with a usable model on the
owner's current machine, so Task 14 does not spend further time attempting or
claiming a Gemini success reply. This is a local-configuration limitation, not
a product-level Gemini retirement or defect claim; the retained entry remains
available and, when local configuration is missing, must keep the existing
clear, retryable failure and complete cleanup behavior. This proves only the
bounded configured-Claude/Codex success and unconfigured-local-Gemini failure
paths. It made no credential or Gemini API request, does not validate a working
Gemini configuration, and does not close the remaining Team journeys or P6
acceptance.

P6 also remains independently unaccepted at the real AionUI Team/group-chat UI
gate. Patch 0014, bridge contracts, DOM tests, and green CI do not substitute
for a native user-journey review. After cleanup closure, acceptance must still
enter from native navigation, create and edit a Team, open `/team/:id`, configure
roles plus General+Goose, submit Workspace/task input and messages, understand
plan/Worker/dependency/blocked/approval/Artifact/aggregation/recovery state, and
exercise pause/cancel/retry/replace/handoff/feedback/approval through real bridge
intents with explicit failure and unavailable states. Real CrewAI admission,
P7, P8, and P6 phase acceptance remain open.

P4's phase acceptance record reached pull request 25 at exact head
`c461fb06bdebd4bf6f55d39741a21dcb6980b3ff` and squash merged as current
`main` `adc9a99d7806f5627041368b4ff932c1fe9a42f0`. Merged-main CI run
30689608454 initially failed only while the smoke harness externally killed the
Worker after all target-app readiness markers were present. The same exact
product and documentation bytes passed the failed job once on a fresh runner as
attempt 2. That is recorded as a runner/timing failure followed by a passing
exact-SHA rerun, not as a product fix or a hidden regression.

P5.0 reached
[pull request 26](https://github.com/Ablankpaper/actestra-desktop/pull/26) at
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
[pull request 27](https://github.com/Ablankpaper/actestra-desktop/pull/27) at
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
[pull request 28](https://github.com/Ablankpaper/actestra-desktop/pull/28) at
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
[Main CI run 30449520722](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30449520722)
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
[Main CI run 30470505690](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30470505690)
passes on that exact merge.

ADR-0015 records CrewAI as the first supervised P6 planner-sidecar candidate
while keeping the Actestra TeamOrchestrator authoritative and Eigent as the
product and acceptance reference. This is an accepted architecture direction
only: CrewAI is not imported, installed, bundled, or implemented, and P6
remains ordered after the P4 and P5 gates.

General-work GW-P4.2 reached
[pull request 10](https://github.com/Ablankpaper/actestra-desktop/pull/10) at
exact final head `9003cc0387cb4266c4b1240308092366ef365bf4`, passed
[PR CI run 30475836615](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30475836615),
and completed a 50-file CodeRabbit review with zero findings. It squash merged
as `8e32882108b10272c1489c1a46a77cede1cc4fb7`; exact merged-main
[CI run 30476091907](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30476091907)
passes.
[ADR-0016](architecture/decisions/0016-p4-general-work-process-and-content-boundaries.md)
records the accepted process and content boundary: schemas 1 through 6 and all
P3/F2/F3 operations now run behind the asynchronous persistence utility, with
durable grants and bounded content references and no synchronous SQLite
fallback in Electron main.

GW-P4.3 reached
[pull request 11](https://github.com/Ablankpaper/actestra-desktop/pull/11) at
exact final head `b3a3bc7e27d7dab44dadeff6dcedc92cec1b3ee5`, passed
[PR CI run 30481670123](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30481670123),
and squash merged as `671587813bea18411b6cdc2ee388d94cd18d6c50`.
[Merged-main CI run 30481890911](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30481890911)
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
[pull request 12](https://github.com/Ablankpaper/actestra-desktop/pull/12) at
exact final head `34f2d2201581c19b3dc67c5a7936f8a411bff9e1`, passed
[PR CI run 30486392525](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30486392525),
and squash merged as `7ec009c6384a93c17f24e4276469e98cb5f2b71d`.
[Merged-main CI run 30486544268](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30486544268)
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
[pull request 13](https://github.com/Ablankpaper/actestra-desktop/pull/13) at
exact final head `f160d9a3a00f317f12b7579bc3a48849c1cf32d2`, passed
[PR CI run 30495112290](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30495112290),
and squash merged as `1dacbc0bee8ebae26d688e6e719c8f0f5750db5f`.
[Merged-main CI run 30495301140](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30495301140)
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
[pull request 14](https://github.com/Ablankpaper/actestra-desktop/pull/14) at
exact final head `4a07eb9db1907ae8fab2613b4cf11a7d2a8cbee4`, passed
[PR CI run 30553454459](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30553454459),
and squash merged as `784191bfc59d71a128ed5d3251db3535f1349e45`.
[Merged-main CI run 30554447144](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30554447144)
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
[PR CI run 30567484733](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30567484733),
and squash merged as `2aed0f705bf6f9b3734742c0905c94ac562f501e`.
[Merged-main CI run 30569476160](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30569476160)
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
[pull request 17](https://github.com/Ablankpaper/actestra-desktop/pull/17).
The initial and final exact heads pass PR CI runs
[30577349875](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30577349875)
and
[30577647392](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30577647392).
The pull request squash merged as
`779880f28106aa8423ba042de5a6a3264bc0452e`; exact merged-main
[CI run 30577886631](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30577886631)
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
[pull request 18](https://github.com/Ablankpaper/actestra-desktop/pull/18).
[PR CI run 30585829619](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30585829619)
passes. The PR squash merged as
`d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2`; exact merged-main
[CI run 30586015008](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30586015008)
passes. The Ready PR's CodeRabbit Free result selected all 33 files but
contains only a summary and walkthrough, with no submitted review or inline
comment; it is not represented as line-level review evidence. This local
package and smoke do not claim notarization, candidate, release, distribution,
or user acceptance.

[ADR-0022](architecture/decisions/0022-bounded-office-document-artifact-journey.md)
accepts the independent Office-document slice, developed on
[pull request 19](https://github.com/Ablankpaper/actestra-desktop/pull/19) from
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
[PR CI run 30601752177](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30601752177)
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
[PR CI run 30602422431](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30602422431)
passes every step, including the corrected schema-12 clean-profile packaged
smoke. A local CodeRabbit CLI review of the three follow-up files raised zero
issues. The remote incremental review selected the same three files but was
rate-limited for 43 minutes before it started, so the successful remote status
remains summary/walkthrough evidence only and is not a line-level review. The
status-only evidence update changed no implementation input and produced exact
final PR head `091f786d57c6b4569cdaac17ea969a0b9070ea02`.
[Final PR CI run 30602624426](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30602624426)
passes on that head. PR 19 has no submitted reviews or inline comments; its
successful CodeRabbit Free status contains only a summary and walkthrough.
The PR squash merged as
`505afb2f3916e75c7abb07cdf461bda29a602b9b`; exact merged-main
[CI run 30602821085](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30602821085)
passes.

[ADR-0023](architecture/decisions/0023-actestra-owned-scheduled-general-work.md)
governs the bounded schedule slice accepted on `main` through Ready
[pull request 20](https://github.com/Ablankpaper/actestra-desktop/pull/20) from
exact verified Office merge
`505afb2f3916e75c7abb07cdf461bda29a602b9b`. The PR reached exact final head
`c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, passed
[PR CI run 30659567604](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30659567604),
and squash merged as `5b0748af674165f9e9475be61dc1e02a1b08c8bc`.
[Merged-main CI run 30660078199](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30660078199)
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
[PR CI run 30657973409](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30657973409)
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
[pull request 22](https://github.com/Ablankpaper/actestra-desktop/pull/22). It
started from exact verified `main`
`3d8d697a6416176d90183f671da28347bb194553`; exact implementation commit
`fd5524c7f0485923b2aa765df95b5ef0b14187e7` contains only the 15 reviewed
files. The PR reached exact final head
`077f30bcfa3929959c971d08081092bbf976e2ee`, passed
[PR CI run 30673687603](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30673687603),
and squash merged as `c7c414c0c5a126b276fb02b372e02fff437e5f23`.
[Merged-main CI run 30673919260](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30673919260)
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
[main CI run 30674966106](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30674966106)
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
reviewed files. [Ready pull request 24](https://github.com/Ablankpaper/actestra-desktop/pull/24)
reached exact final head `3593fac8db48a0cb149bb6c736374eeaccebe332`, passed
[PR CI run 30687199671](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30687199671),
and squash merged as `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`.
[Merged-main CI run 30687433298](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30687433298)
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
[pull request 6](https://github.com/Ablankpaper/actestra-desktop/pull/6), which
subsequently merged through the exact final head recorded above. Its early
exact-head
[CI run 30392140461](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30392140461)
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
  [CI run 30417692550](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30417692550)
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
[Exact-head CI run 30421351204](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30421351204)
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
  [CI run 30425061316](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30425061316)
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
[30421071039](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30421071039)
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
[Pull request 3](https://github.com/Ablankpaper/actestra-desktop/pull/3) reached
final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f`, squash merged as
`f6833c50eaf5a426948bac7999f93a08b19a425e`, and exact
[main CI run 30378191752](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30378191752)
passes. These facts close the P3 exit gate.

P0 through P3 are accepted on `main`.
[Pull request 2](https://github.com/Ablankpaper/actestra-desktop/pull/2) merged
the P2 independent product shell with squash commit
`76d6a58b20c3e010ee759358f2c86be80bc6a6c1`. Its exact final PR head was
`f972bb6c33c925f3e333a6ee87d20e5bbb72cece`.
[Main CI run 30329620829](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30329620829)
passes on the exact squash commit.

`feat/platform-core-contracts` began from that verified `main` commit and
merged through pull request 3.
P3.1/P3.2 implementation commit
`31dd6e4178eb7641b45be0ee2bccb862a96dac99` adds the P3.1 domain records,
state transitions, and ownership invariants plus the P3.2 version 1 event
envelope, ordering, idempotency, replay, terminal, and redaction rules.
[macOS arm64 CI run 30331681309](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30331681309)
passes on that exact commit.

P3.3 implementation commit
`4de756984269624a02fbfdf77e558c958a03c2e0` accepts
[ADR-0005](architecture/decisions/0005-sqlite-persistence-and-migrations.md)
and implements storage-neutral persistence ports, two forward-only SQLite
migrations, a main-owned domain/event adapter, corruption and rollback checks,
and an exact Electron-runtime compatibility probe.
[macOS arm64 CI run 30335076556](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30335076556)
passes on that exact implementation commit.

P3.4 implementation commit
`2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b` accepts
[ADR-0006](architecture/decisions/0006-agent-adapter-lifecycle-and-supervision.md)
and adds protocol version 1, exact capability negotiation, an `AgentAdapter`
contract, observed-time lifecycle supervision, immutable attempts, terminal
reconciliation, cancellation, crash, bounded restart, and an explicitly
stepped deterministic fake adapter.
[macOS arm64 CI run 30339662937](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30339662937)
passes on that exact implementation commit.

P3.5 implementation commit
`cec0cdc554656c021cdff7f2341ddd3f9b5d83dd` accepts
[ADR-0007](architecture/decisions/0007-privileged-service-authorization.md)
and adds closed protected-operation and tool-manifest contracts, conservative
policy evaluation, exact one-shot approval evidence, opaque credential leases,
a metadata-only audit trail, and a fixed-order main-owned gateway.
[macOS arm64 CI run 30345370507](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30345370507)
passes on that exact implementation commit.

P3.6 implementation commit
`950fe0efa2fdc5adc69d013acc9f417d201cb28e` accepts
[ADR-0008](architecture/decisions/0008-main-owned-projection-and-ipc.md)
and adds SQLite schema version 3, durable metadata-only privileged audit,
immutable terminal-attempt evidence, persist-before-release coordination,
main-owned inert service registration, trusted-frame IPC, a three-operation
preload allowlist, and bounded renderer projection.
[macOS arm64 CI run 30350732223](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30350732223)
passes on that exact implementation commit.

Review-remediation commit
`4fa0fb120a6ceb2c71effd2a552e8d9bbf05d151` adds bounded structural
comparison, idempotent incremental redelivery, explicit persistence
idempotency contracts, post-replacement stream-cache invalidation, and
evidence-document corrections.
[macOS arm64 CI run 30374144474](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30374144474)
passes on that exact remediation commit.

Review-closure evidence commit
`2fe179a63ac7e8a4d23373fe87dda7b062c314fc` records the complete review,
remediation, validation, and remaining owner gate.
[macOS arm64 CI run 30374447377](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30374447377)
passes on that exact evidence head. The subsequent Ready transition triggered
CodeRabbit run `c55e04d9-8360-4570-a06c-2dec6b5d19e6`, which selected all 67
PR files and completed with a successful status, no review submission, and no
review thread. This Free-plan summary/walkthrough is not represented as an
independent approval.

Ready-state evidence commit
`755416c7b9bbb09172559460bc1a122eea2f7c8f` records the completed owner and
Ready gates.
[macOS arm64 CI run 30376456379](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30376456379)
passes on that exact commit. Its incremental CodeRabbit run
`5d4c70ac-5432-4ea0-af1e-2bf51db50362` selected only the four changed status
documents but was rate-limited before review with a 55-minute wait. The
resulting successful status is command-handling evidence, not a completed
review or a zero-issue result.

Final PR-head evidence commit
`71bf3e3fb1d7661fee053ee811279d44f1fdf45f` records the Ready-state CI
evidence.
[macOS arm64 CI run 30376696055](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30376696055)
passes on that exact final head. Incremental CodeRabbit run
`226b4810-7e15-495f-a3f9-50cf0536fb8c` selected the final four-document status
range but was rate-limited before review with a 52-minute wait. Its successful
status records limit handling only; it is not a completed review or zero-issue
result.

Pull request 3 squash merged that exact final head as
`f6833c50eaf5a426948bac7999f93a08b19a425e`.
[macOS arm64 main CI run 30378191752](https://github.com/Ablankpaper/actestra-desktop/actions/runs/30378191752)
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

| Area                                               | State                                                               | Evidence or blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                                         | F0-F3.3 and P6 architecture accepted on `main`                      | PR 9 final head `d7e615206af0829375db0db1d1fcc6ca205102a8`; squash merge `327d5ca5abf3a0090bc2b3d3193e2935bbd47f38`; main CI 30470505690 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P2 merge                                           | Accepted on `main`                                                  | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2 main CI                                         | Pass                                                                | Main push run 30329620829 passed on the exact squash merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P3 kickoff CI                                      | Pass                                                                | Pull-request run 30329964305 passed on exact pushed head `b9c1119479c805c02452e4054a3d904649a3ca03`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P3.1/P3.2 CI                                       | Pass                                                                | Pull-request run 30331681309 passed on exact implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3.3 CI                                            | Pass                                                                | Pull-request run 30335076556 passed on exact implementation commit `4de756984269624a02fbfdf77e558c958a03c2e0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3.4 CI                                            | Pass                                                                | Pull-request run 30339662937 passed on exact implementation commit `2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3.5 CI                                            | Pass                                                                | Pull-request run 30345370507 passed on exact implementation commit `cec0cdc554656c021cdff7f2341ddd3f9b5d83dd`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3.6 CI                                            | Pass                                                                | Pull-request run 30350732223 passed on exact implementation commit `950fe0efa2fdc5adc69d013acc9f417d201cb28e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P3 review closure                                  | Pass with one documented invalid issue                              | Full 67-file review completed with 10 issues; 9 valid issues fixed; all 9 remediation files then completed a zero-issue review; exact remediation CI run 30374144474 passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P3 Ready gate                                      | Pass                                                                | Owner authorized the Ready transition; runs 30374447377 and 30376456379 passed on their exact heads; final PR-head run 30376696055 passed; the first Ready-triggered CodeRabbit selected 67 files and completed successfully with 0 review submissions and 0 threads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3 merge                                           | Accepted on `main`                                                  | PR 3 squash merged exact final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f` as `f6833c50eaf5a426948bac7999f93a08b19a425e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P3 main CI                                         | Pass                                                                | Main push run 30378191752 passed on exact squash commit `f6833c50eaf5a426948bac7999f93a08b19a425e`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P4.0 foundation                                    | Accepted on `main` through PR 6                                     | Implementation `13270ca0abd7353710541afca9ddf46c47670be3`; early exact-head CI run 30392140461 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P4.1 identity and isolation                        | Accepted on `main` through PR 6                                     | Implementation `836a9f1f81687f091e1c5b92ce30bff167e9da4f`; resource-only CI remediation `462a1b0d920279d42f124fdd28673d77dc55b765`; run 30417692550 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P4.2 compatibility shadow                          | Accepted on `main` through PR 6                                     | Implementation `632573fa03c34fdb789c85d8efc1ce1e0f8e8177`; packaged-boundary remediation `1478726d62302fa885525024eb4839af5e98b4dd`; run 30421351204 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P4.3/F3.1 approval decision authority              | Accepted on `main` through PR 6                                     | Implementation `cf61ffb8453a888cdc03f73457ebeaf72708511a`; ADR-0012; schema version 5 persist-before-deliver outbox; 30/153 root and 330/2,602 native tests; run 30425061316 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| PR 6 review and merge closure                      | Accepted on `main`                                                  | Final head `70b2f29329fec26bf0e3d6384d8563aedcb7a4ce`; exact-head CI 30431557027 passes; local review of 21 final changed files returned zero findings; squash merge `61b9405fc007aa8cb16ec05a65f421cb7d277b51`; exact main CI 30434563810 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| F3.2 approval delivery policy gate                 | Accepted on `main` through PR 7                                     | Implementation `20e3c0fcada0d072fc35820d43b85c953bf93929`; final head `df821ca203bea7b611fa8fb8092d00a16cabe578`; squash merge `ce19dbe072328e16dcdaf116b8199d5502cb44c6`; exact main CI run 30442166290 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| F3.3 approval reconciliation policy gate           | Accepted on `main` through PR 8                                     | Implementation `c2fa4bbc4989b9a41bf6a283b5f0eb1f2f523acb`; final head `3f85e13072f5fb13fb43c9dae94f992bb0b7fb9c`; squash merge `c841ed9cb6a54bcb2e4078ca2be941adce0ac4ad`; exact main CI run 30449520722 passes; the complete local 18-file review raised zero issues before merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GW-P4.2 persistence utility and content foundation | Accepted on `main` through PR 10                                    | Final head `9003cc0387cb4266c4b1240308092366ef365bf4`; exact-head CI 30475836615; zero-finding 50-file review; squash merge `8e32882108b10272c1489c1a46a77cede1cc4fb7`; exact main CI 30476091907                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GW-P4.3 General Worker and Adapter v2              | Accepted on `main` through PR 11                                    | Final head `b3a3bc7e27d7dab44dadeff6dcedc92cec1b3ee5`; exact-head CI 30481670123; squash merge `671587813bea18411b6cdc2ee388d94cd18d6c50`; exact main CI 30481890911; ADR-0017; 40/217 root and 334/2,610 native tests; build, unsigned harness package, real utility-worker smoke, and isolated native AionUi/AionCore launch pass                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GW-P4.4 scoped native tools and policy             | Accepted on `main` through PR 12                                    | Final head `34f2d2201581c19b3dc67c5a7936f8a411bff9e1`; PR CI 30486392525; squash merge `7ec009c6384a93c17f24e4276469e98cb5f2b71d`; main CI 30486544268; ADR-0018; two scoped text tools; 42/232 root and 335/2,612 native tests; root/native build, unsigned harness package, scoped registration, and isolated AionUi/AionCore launch pass                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GW-P4.5 durable coordination and recovery          | Accepted on `main` through PR 13                                    | Final head `f160d9a3a00f317f12b7579bc3a48849c1cf32d2`; PR CI 30495112290; squash merge `1dacbc0bee8ebae26d688e6e719c8f0f5750db5f`; main CI 30495301140; ADR-0019; schema 7 recovery journal; full root/native regression, production builds, unsigned smoke, isolated AionUI recovery launch, and process cleanup pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GW-P4.6 preserved-AionUI General Work journey      | Accepted on `main` through PR 14                                    | Final head `4a07eb9db1907ae8fab2613b4cf11a7d2a8cbee4`; PR CI 30553454459; squash merge `784191bfc59d71a128ed5d3251db3535f1349e45`; main CI 30554447144; ADR-0020; schema 8 atomic journey authority; complete root check passes 50 files/292 tests; native passes 341 files/2,634 tests; production builds, signed local arm64 package, and target-app restart/denial/cancellation smoke pass                                                                                                                                                                                                                                                                                                                                                                                                  |
| P4 representative workspace-file journey           | Accepted on `main` through PR 16                                    | Final head `f19b7dd006cf091aa9c7f1559dd484fdad35f200`; PR CI 30567484733; squash merge `2aed0f705bf6f9b3734742c0905c94ac562f501e`; exact main CI 30569476160; schema 9 closed kinds; 50/308 root and 341/2,635 native tests; signed local package and target-app smoke; no submitted reviews or inline comments; Free-plan summary is not line-level review evidence                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P4 bounded local-research journey                  | Accepted on `main` through PR 17                                    | Final head `5694865462f7209ad413b2cd1dbe2eef0fe955bc`; PR CI 30577647392; squash merge `779880f28106aa8423ba042de5a6a3264bc0452e`; merged-main CI 30577886631; schema 10; 50/313 root and 341/2,637 native tests; builds, signed unnotarized local package, target-app smoke, local review closure; remote CodeRabbit rate-limited before review                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P4 bounded writing journey                         | Accepted on `main` through PR 18                                    | Final head `2febf25e80868fac51fb7b37fffb746d10f8edde`; PR CI 30585829619; squash merge `d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2`; merged-main CI 30586015008; ADR-0021; schema 11; 50/325 root and 341/2,639 native tests; root/native builds; ad-hoc-signed unnotarized local arm64 package and target-app smoke; Free-plan remote summary is not line-level review evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P4 bounded Office-document journey                 | Accepted on `main` through PR 19                                    | Final head `091f786d57c6b4569cdaac17ea969a0b9070ea02`; PR CI 30602624426; squash merge `505afb2f3916e75c7abb07cdf461bda29a602b9b`; merged-main CI 30602821085; ADR-0022; schema 12; 50/338 root and 343/2,644 native tests; final local CodeRabbit closure; signed unnotarized arm64 package and real Office target-app smoke pass; remote Free output is summary/walkthrough only                                                                                                                                                                                                                                                                                                                                                                                                             |
| P4 bounded scheduled General Work                  | Accepted on `main` through PR 20                                    | ADR-0023; exact final head `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`; PR CI 30659567604; squash merge `5b0748af674165f9e9475be61dc1e02a1b08c8bc`; merged-main CI 30660078199; schema 13; 56/424 root and 345/2,658 native tests; final local review closure; signed unnotarized arm64 package, strict package/ASAR/resource checks, and real schedule target-app smoke; remote CodeRabbit output is rate-limited summary/walkthrough only                                                                                                                                                                                                                                                                                                                                                     |
| P4 representative tool failure                     | Accepted on `main` through PR 22                                    | Implementation `fd5524c7f0485923b2aa765df95b5ef0b14187e7`; final head `077f30bcfa3929959c971d08081092bbf976e2ee`; PR CI 30673687603; squash merge `c7c414c0c5a126b276fb02b372e02fff437e5f23`; merged-main CI 30673919260; 56/425 final root and 345/2,662 native tests; complete 15-file manual review and final scope/secret/generated-output audit; pinned, signed, unnotarized local arm64 package and schema-13 target-app `content-too-large` plus restart evidence; CodeRabbit was rate-limited before formal review and its Free summary is not line-level review evidence                                                                                                                                                                                                              |
| P4 Worker crash/recovery                           | Accepted on `main` through PR 24                                    | Implementation `47ed445eab204c0998e44167455c062600158dd3`; exact final head `3593fac8db48a0cb149bb6c736374eeaccebe332`; PR CI 30687199671; squash merge `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`; merged-main CI 30687433298; 56/427 root and 345/2,665 native tests; builds; signed unnotarized arm64 package; external-`SIGKILL` schema-13 smoke; complete 14-file manual review and exact scope audits; automatic CodeRabbit was rate-limited before review and is not line-level review evidence                                                                                                                                                                                                                                                                                         |
| P4 phase                                           | Accepted on `main`                                                  | The retained AionUI journey and representative file, local-research, writing, Office, schedule, denial, cancellation, tool-failure, persistence, Worker-crash/recovery, and Artifact-conflict evidence satisfy the P4 exit gate at exact phase head `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`; acceptance record merge `adc9a99d7806f5627041368b4ff932c1fe9a42f0`; merged-main CI 30689608454 attempt 2 passes                                                                                                                                                                                                                                                                                                                                                                                |
| P5.0 Goose source and ACP admission                | Accepted on `main` through PR 26                                    | Exact head `e622f36e697b4e0be1037175267452e24cc180e3`; exact-head CI 30691045159; squash merge `b61dd3ea44a4c522ca0c15a84a01d8f76b335e4c`; merged-main CI 30691300690; ADR-0024 selects `v1.45.0` / `4dc0420f5704a92806c6628c8f0a3497d7a88759`, minimal Goose core stdio runner with empty feature set and no builtins, scheduler, or second UI; upstream CLI rejected; CodeRabbit rate limit is not formal review evidence                                                                                                                                                                                                                                                                                                                                                                    |
| P5.1 minimal Goose runner and ACP handshake        | Accepted on `main` through PR 28                                    | Runner exact head `d3be6c665b1df51acec13c95691315ba97ba98dc`; PR 27 CI 30698164038; runner merge `df5bd41ca0ecd4838e046f48a9016e418b036ac7`; its main CI 30698648996 isolates a passing Goose job and failing Worker-crash desktop job; official symbols identify synchronous `HandleTermination` to `PostMessage` reentrancy; hotfix exact head `eed1623e9849b9f662f3dec690d02d7c85a693ef`; PR 28 CI 30699859869 passes; squash merge `d313fb2ed65e4b010f777435953752818fbbfae4`; merged-main CI 30700441312 passes both Goose admission and the packaged immediate-`SIGKILL` recovery smoke; incomplete automatic review is not zero-finding evidence; complete 9-file manual/static review; no session, tool, workspace, model, credential, UI, candidate, release, or deployment authority |
| P5.2 isolated-coding containment foundation        | Delivered on `main` through PR 31                                   | Exact final head `c10110b38e8714b831a6d6d0fc09aa8df4218b7c`; exact-head CI 30808650150 passes; squash merge `266e3857bed7d4c32b773f92deff676bf2144b15`; exact merged-main CI 30809931486 passes; CodeRabbit was rate-limited before line-level review and its successful status/Free walkthrough are not formal review evidence; 3 focused files/39 tests and the recorded 63-file/488-test root gate pass; no ACP session or P5.2 acceptance                                                                                                                                                                                                                                                                                                                                                  |
| P5.2 desktop-main containment composition          | Delivered on `main` through PR 32                                   | Exact final head `5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`; exact-head CI 30817462671 passes; exact-head CodeRabbit re-review covers 12 files with 0 issues and no GitHub review threads; squash merge `f55b5550c6ac189f09536061a70e8c8c7299c4f4`; exact merged-main CI 30818949121 passes both jobs; main-owned worktree/grant/Gateway lifecycle and patch 0012; 5 focused files/49 tests; recorded 65-file/498-test root gate; no renderer surface, real Goose coding, or phase acceptance                                                                                                                                                                                                                                                                                                  |
| P5.2 ACP session/new lifecycle                     | Delivered on `main` through PR 33                                   | Exact head `5d873f2feb94679341627aab0472a66630cf16cd`; exact-head CI 30823601815; squash merge `c5f498e926adac484694dab6d2f05b9822cc0b12`; merged-main CI 30825221070; one process/one session, fixed request-ID correlation, exact loopback MCP declaration, bounded setup notifications/frames, and failed-session private-root cleanup; no model, prompt/tool execution, publish/Artifact flow, or phase acceptance                                                                                                                                                                                                                                                                                                                                                                         |
| P5.2 authenticated MCP transport                   | Delivered on `main` through PR 35                                   | Exact head `93a8e9633f2be7b5f8c8b1eead3f2a21b0770073`; exact-head CI 30832907098; squash merge `8a31bafc1cd322744189fc4ed1e68f769225c999`; merged-main CI 30834217310; random authenticated loopback endpoint and six closed schemas; CodeRabbit quota exhaustion is not review evidence; `tools/call` remains denied                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P5.2 authenticated Goose readiness                 | Delivered on `main` through PR 36                                   | Old head `9e277e1593b2715ed3721e1febb886985a942824` had macOS pass/Goose `session-rejected` failure in CI 30837296114 and was not rerun; corrected exact head `5fe78bfaf2982556af975d23bc904d10b77a1f29`; exact-head CI 30843561874; squash merge `08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`; merged-main CI 30845006202; separate MCP/model leases and loopback ports, authenticated non-inference catalog, closed provider/model environment, explicit ACP tool discovery, exact-six match, and Worker-first cleanup; 4 focused files/51 tests, admitted-artifact integration 1 file/1 test, and recorded 68-file/582-test root gate pass; no inference, prompt/tool execution, durable evidence, publish/Artifact flow, or phase acceptance                                                 |
| P5.2 authenticated MCP tool-call bridge            | Delivered on `main` through PR 37                                   | Exact head `84b0550495717343b75ca2540cb7c191ab65b12a`; exact-head CI 30851778390; squash merge `d933546454e63a2d836e728f1b93980cb4a7c0ac`; merged-main CI 30853499159; bounded `tools/call` through the real Tool Gateway, close-race guard, 3 focused files/65 tests, and recorded 68-file/589-test root gate; CodeRabbit review limit and zero GitHub review threads are not line-level review evidence; no inference, prompt loop, publish/Artifact flow, or phase acceptance                                                                                                                                                                                                                                                                                                               |
| P5.2 authenticated inference/prompt loop           | Delivered on `main` through PR 39                                   | Prompt exact head `cc773081ba448266951a3b2ac3654831022118fc`; exact-head CI 30859115162; squash merge `a6280dd38eacdbada9db159c4784110ec8e42770`; merged-main CI 30860137257 failed only the Goose job when one real-Git test crossed the implicit 5-second limit and was not rerun; bounded-deadline correction exact head `38cbbaaedbb8e5955b96a6d7148841180e751e35`; exact-head CI 30861770178; squash merge `7e8732e264febff42fb3d451011b3b8e48caaff5`; merged-main CI 30862710547 passes both jobs; no submitted review or inline thread; no desktop-main composition, approval outcome projection, durable normalized evidence, publish/Artifact flow, or phase acceptance                                                                                                               |
| P5.2 desktop-main Goose lifecycle                  | Delivered on `main` through PR 40                                   | Exact head `c35f8c37c14dedaa980dfbb539f16fc21379be8a`; exact-head CI 30865837496; squash merge `1909033977576d94f6983f9c911b8e0a866a59de`; merged-main CI 30866691199; service-owned worktree/grant/Gateway/invoker/Goose opening, prompt, close ordering, close-race rejection, failure aggregation, and cleanup retry; no submitted review or inline thread; no approval outcomes, durable normalized evidence, publish/Artifact flow, or phase acceptance in that delivery                                                                                                                                                                                                                                                                                                                  |
| P5.2 main-owned approval outcomes                  | Delivered on `main` through PR 41                                   | Exact head `917a95260d84f09aacf5038d92a5230d1781676d`; exact-head CI 30870425378; squash merge `7dfc4973021d68d5df0ded12fa218ecd42da9691`; merged-main CI 30871703449; persisted approve/deny outcomes, exact approval-snapshot binding, one-shot approved execution, denied no-execution projection, abort settlement, and explicit service forwarding; focused 18 passed/2 artifact-gated, recorded 68-file/601-test root gate, and materialized-native TypeScript plus generated 1/1 test pass; no durable normalized evidence, publish/Artifact flow, or phase acceptance in that delivery                                                                                                                                                                                                 |
| P5.2 durable normalized coding evidence            | Delivered on `main` through PR 42                                   | Exact head `a20882abeb6caac3b4f230fde42a7e06965a0730`; exact-head CI 30876755457; squash merge `e064dc88e717cef093c866cdbc2692d23ed7dd03`; merged-main CI 30877711241 with Goose job 91892412815 and macOS job 91892412830; stable Actestra-owned stream/correlation identity, persist-before-open start, bounded evidence, review-blocked projection, response-loss-safe replay, and shared mutation barrier; Free CodeRabbit summary is not line-level review evidence; no publish/Artifact flow or phase acceptance in that delivery                                                                                                                                                                                                                                                        |
| P5.2 publish and Artifact registration             | Accepted on `main` through PR 43                                    | Exact head `305a29d9b2b514865983ae9d8a23f877566bb7a5`; exact-head CI 30883055147; squash merge `9048fe2cc23819f596d8721adb8c544dcd0b786f`; merged-main CI 30884138218; main-only seventh publish capability remains outside Goose's six MCP tools; locked exact patch capture, metadata-only one-shot approval, drift denial, durable Artifact completion, ordered cleanup, 5 focused files/123 passed/2 artifact-gated skipped, recorded 68-file/618-test root gate, and 196-file downstream contract; rate-limited CodeRabbit status is not line-level review evidence; P5.2 accepted, not released or user-accepted                                                                                                                                                                         |
| P5.3 preserved AionUI coding journey               | Accepted on `main` through PR 44                                    | Exact head `15a8e29b44a6684313f29a694f0d0615de95cf36`; exact-head CI 30899489690 passes; squash merge `ee8425e39e201078cd64fe3af38355279ecf56de`; merged-main CI 30900884248 passes; exact-head and merged-main tree `e301a0acede51671b404daf11248788cdaba34d9`; R1 patch 0013 preserves native and Team paths while providing the fixed Goose journey, real approval/publish/cancel evidence, 74/2 files and 642/5 tests in the final root gate, 217/4/80 downstream checks, and the 61/3/28 build; Free CodeRabbit summary is not line-level review evidence; no candidate, release, deployment, or user-acceptance claim                                                                                                                                                                    |
| P6 bounded team-plan admission                     | Accepted on `main` through PR 45                                    | Initial head `59cf48fbbb45d78c803ab6691547b61878fc8eb3` failed sole run 30905371865 only at the missing downstream source-copy declaration and was not rerun; corrected exact head `a3d08a934160c1a5d61ff987ade29212bd3c0b05`; exact-head CI 30906689796; squash merge `30742934adde1e0944c4e8ced1f005452a1f3568`; merged-main CI 30907869824; 2 focused files/30 tests and recorded 76/2-file, 672/5-test root gate; no submitted review or inline thread; no CrewAI/Python, persistence, scheduling, Worker launch, Team UI, packaging, or P6 phase acceptance                                                                                                                                                                                                                               |
| P6 Team implementation and no-orphan gate          | Accepted on `main` through PR 51                                    | PRs 46-49 record the earlier process-cleanup failures and corrections. The final delivery closes the AionCore model-probe child, passes the complete 1,181-test root gate, and retains real packaged quit/restart evidence with an empty Actestra, AionCore, Goose, and planner process scan. Exact-head CI 31623674948, squash merge `1aefa46597d334b4fad48cf176fed1b166cdbacc`, and merged-main CI 31625296206 pass both jobs.                                                                                                                                                                                                                                                                                                                                                                    |
| P6 admitted plan and Team run durability           | Accepted on `main` through PR 51                                    | Schemas 14-22 own admitted plans, Team definitions and revisions, Team experience binding, message-delivery intent, Artifact delivery/apply authority, General requirements, and destination workspace identity. Core transition replay, CAS persistence, recovery, and fail-closed identity checks are covered by the accepted gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P6 generic planner-sidecar boundary                | Accepted on `main`; CrewAI remains unadmitted                       | The versioned no-tool planner protocol, exact engine handshake, bounded JSONL, sanitized failure, timeout/abort/crash cleanup, and packaged Actestra-native planner are admitted. No CrewAI runtime is imported or packaged, and later CrewAI admission remains a separate reviewed change that must repeat the P6 failure and no-orphan gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P6 Team scheduler/control/recovery                 | Accepted on `main` through PR 51                                    | Actestra-owned persisted transitions, per-run serialization, bounded parallel roots, dependency and Artifact gating, protected approval and workflow feedback, pause/retry/replace/handoff/cancel, reference-only aggregation, and deterministic interrupted recovery pass the accepted root, packaged, exact-head, and merged-main gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P6 real General+Goose Team composition             | Accepted with real-provider Electron evidence                       | The packaged development app completed a capability-aligned General+Goose run with a durable General Artifact, real Goose tool execution, isolated patch creation, separate apply approval, Main-owned write-back, final feedback, cancellation, restart recovery, and no-orphan shutdown. General v1 remains text-only and fail-closed through structured admission/output validation; the implementation is integrated on `main` through PR 51.                                                                                                                                                                                                                                                                                                                                                 |
| P6 AionUI Team main provider and bridge            | Accepted on `main` through PR 51                                    | Fixed request/event contracts, trusted-current-main-frame IPC, Main/Core Team authority, provider credential redaction, standard/orchestrated binding, multiline activity, localized closed errors, and bounded projection pass the accepted complete and downstream gates. Renderer receives no credential, filesystem, Git, patch-content, process, or persistence authority.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P6 AionUI-native Team journey and recovery         | Accepted with real-provider Electron evidence                       | R1/R2 patch 0014 preserves the AionUI-first product while supplying creation/list, `/team/:id`, group chat, members/roles, General+Goose configuration, workspace/task input, explainable plan/Worker/dependency/blocked state, approvals, controls, Artifacts, apply delivery state, aggregation, and recovery. Real navigation, multiline submission, final feedback, cancellation, completion, apply, quit, and restart were exercised in the packaged development app; the implementation is integrated on `main` through PR 51.                                                                                                                                                                                                  |
| Native AionUi source                               | Exact local desktop snapshot                                        | AionUi `v2.1.41` at `2d8925fc67a97a20996fadcd2a0862b778b572ba`; 1,766 files; no local modification inside snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Native preservation contract                       | Local pass                                                          | Manifest SHA-256 `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`; 27 routes and 41 bridge domains verified                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Native AionUi build and launch                     | Local pass                                                          | Frozen install, production build, isolated native Electron launch, and actual Guide screenshot pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native AionUi tests                                | Latest local pass                                                   | Final Worker-crash input: 345 files passed, 1 skipped; 2,665 tests passed, 5 skipped; 0 failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Legacy product shell                               | P3 harness only                                                     | Original Actestra Electron/React shell remains for platform-contract and packaging regression; it is not the target product UI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Renderer boundary                                  | CI-backed through P3.6                                              | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, exact frozen preload allowlist, trusted-frame zero-argument IPC, and direct-client source checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Automated tests                                    | Exact merged-main CI pass                                           | Main run 30378191752 passes 24 Vitest files with 130 tests, the exact Electron SQLite probe, process-failure harness, 34-source boundary check, build, package identity, and clean-profile smoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Desktop package                                    | Final-byte local Apple Development-signed evidence; not notarized   | `/private/tmp/actestra-p4-worker-crash-final.J8Jw8M/out/mac-arm64/Actestra.app` passes independent package verification, 4/4 exact production-entry ASAR hashes, AionCore `0.1.52`, 14/14 pinned Hub Git blobs, 13/13 Hub ZIPs, 4/4 Croner/docx/Electron notice checks, 25 signed actual arm64 Mach-O files, 17 valid symbolic links, and schema-13 target-app tool-failure plus external-Worker-crash restart smoke. It is not a notarized candidate, release, distribution, or user-acceptance artifact                                                                                                                                                                                                                                                                                      |
| P3 domain contracts                                | Implemented and CI-backed                                           | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P3 event contract                                  | Implemented and CI-backed                                           | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P3 persistence and migrations                      | Implemented and CI-backed                                           | ADR-0005 schemas 1 and 2 plus ADR-0008 schema 3 for privileged audit and terminal-attempt evidence; exact runs above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3 worker lifecycle                                | Implemented and CI-backed through GW-P4.3                           | ADR-0006 protocol v1, supervisor, lifecycle, and fake are accepted; ADR-0017 supersedes only the AgentAdapter version/interface with v2 and adds a separate General Worker protocol v1, typed tool results, and a real deterministic utility process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P3 privileged services                             | Implemented and CI-backed                                           | ADR-0007; protected-operation and manifest contracts; policy, approval, opaque lease, metadata-only audit, and deterministic gateway services; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P3 main integration                                | Implemented and CI-backed                                           | ADR-0008; main-only inert composition, durable audit, persist-before-release barrier, fixed IPC allowlist, bounded renderer projection, and packaged startup smoke; exact commit and run above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| F2 shadow persistence                              | Local and CI-backed contract evidence                               | ADR-0011; schema version 4; gapless and idempotent metadata-only evidence; no authoritative domain or event writes; real Guide read remains local proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F3.1 approval response persistence                 | Implemented and CI-backed                                           | ADR-0012; schema version 5 immutable response and delivery outbox; exact implementation run 30425061316; restart and explicit-fallback live proof remains local; native pending-request and protected-operation authority remain separate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Release                                            | None                                                                | No candidate, signed artifact, deployment, distribution, or user acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

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
   merge `1909033977576d94f6983f9c911b8e0a866a59de`, and merged-main CI 30866691199. Preserve approval-outcome exact head
   `917a95260d84f09aacf5038d92a5230d1781676d`, exact-head CI 30870425378,
   merge `7dfc4973021d68d5df0ded12fa218ecd42da9691`, and merged-main CI 30871703449. Preserve durable-evidence PR 42 and publish/Artifact PR 43 exact
   head `305a29d9b2b514865983ae9d8a23f877566bb7a5`, squash merge
   `9048fe2cc23819f596d8721adb8c544dcd0b786f`, and merged-main CI 30884138218. Goose may not receive builtins, the original checkout, raw
   credentials, or a second UI.
8. Preserve P5.3 exact head `15a8e29b44a6684313f29a694f0d0615de95cf36`,
   exact-head CI 30899489690, squash merge
   `ee8425e39e201078cd64fe3af38355279ecf56de`, and merged-main CI
   30900884248 together with the retained AionUI journey, real-Goose publish
   and cancellation proof, native compatibility, and source-checkout
   preservation.
9. Treat PR 46 and corrective PRs 47-49 as historical implementation evidence,
   not as substitutes for the final P6 acceptance record. Do not rerun
   failed SHAs or runs 9c6cf1e, 102ac48, 30968128430, or 30970186524. Preserve
   PR 49 exact-head CI 30971605452, squash merge
   `a3f23d6391a6f6c34f5a88cfa12e35b9665e5196`, and merged-main CI
   30972570429 as the closed planner no-orphan layer. Preserve PR 51 exact head
   `aef8d537be6409f4a0ce2d53299413b26155ed82`, exact-head CI 31623674948,
   squash merge `1aefa46597d334b4fad48cf176fed1b166cdbacc`, and merged-main
   CI 31625296206 as the accepted P6 development-delivery gate. CodeRabbit
   skipped the PR because of its free-plan file limit and path filter; do not
   represent its SUCCESS context as review evidence. P7 security and
   reliability hardening is the next ordered phase. Admit real CrewAI only
   after exact pin/rollback,
   locked dependencies,
   license/NOTICE/SBOM/`pip-audit`, telemetry/network denial, cleanup,
   packaging, and cross-platform smoke pass. Do not give a planner process,
   renderer, worktree, credential, approval, tool, or durable-state authority.
10. Preserve P7.4 product-source parent
    `7b0c27f4af3bb4e0e0049a03646af19c4fa9acc2`, pull-request 62 exact head
    `27590471e75086dbbf24ff29eab23aeb7f32ffed`, exact-head CI 31941498806,
    squash merge `fc7b4683794934a6a650aecd90a7d00de1cf4280`, merged-main CI
    31942456848, and the main-only Goose artifact together with all 14 P7.1
    invariants, 28 abuse cases, and 168 exact variants. Do not promote the P7
    macOS development integration gate to P8, release, deployment, or user
    acceptance.

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
- The current P7.4 local branch runs schemas 1 through 23 in the dedicated
  persistence utility. Schema 14 owns canonical admitted plans; schema 15 owns
  Team definitions, current run heads, and append-only revisions; schema 16
  binds each Team identity to its Main/Core `standard` or `orchestrated`
  experience; schema 17 owns standard-Team message-delivery intent; schemas
  18-20 and 22 own Artifact delivery/apply identity and destination authority;
  schema 21 owns General Work requirements; and schema 23 owns the
  privileged-audit chain and retained-prefix state. The downstream main retains
  the accepted shadow, confirmation, General Work, coding, and schedule
  boundaries and locally adds one fixed Team request/event provider. The
  provider returns only bounded Team DTOs,
  explanations, valid actions, messages, and Artifact references. It exposes no
  renderer-selected filesystem path, generic protected operation, generic tool
  transport, credential value, Worker/process identifier, private summary, or
  durable-state authority.
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
  `ee8425e39e201078cd64fe3af38355279ecf56de`, and merged-main CI 30900884248. P6 admission is accepted through PR 45 and exact merge
  `30742934adde1e0944c4e8ced1f005452a1f3568`. PR 46 merged the Team batch as
  `2b6821bd7b65f6debcbdaf5a40a0daaea6909885`, but post-merge live PIDs
  91520/91521 invalidate its parent-death no-orphan claim. The batch proves
  schema-14 admitted-plan persistence, schema-15 Team run state and revision
  durability, generic sidecar supervision, Actestra-owned scheduler effects,
  real General+Goose mixed execution, protected approval ordering,
  reference-only aggregation, whole-Team cancellation, and bounded
  process/worktree cleanup. Patch 0014 and local commit `94e6699` additionally
  prove the fixed Team bridge/preload/provider and the first orchestrated Team
  control, privacy-projection, and persistent-activity surface under focused
  native and DOM tests; they do not prove preservation of the complete native
  Team experience. Corrective PR 47 adds parent-death and
  whole-group teardown evidence, passed exact-head CI 30967391533, and merged
  as `102ac48d7c1178f484662c40ef85c8d64a596ec4`. Its merged-main run
  30968128430 exposed a separate stale post-TERM KILL race in the accepted P5.2
  executor. PR 48 corrected that path at exact head `e7805e3`, passed exact-head
  CI 30969172383, and merged as `a24ad5e`; merged-main run 30970186524 then
  exposed the planner's stale-PGID `EPERM` close race and was not rerun. PR 49
  corrected that path at exact head `a22121c`, passed exact-head CI 30971605452,
  merged as `a3f23d6`, and passed merged-main CI 30972570429. The later local
  AionCore probe guard closes the detached model-catalog child by an owned
  pre-DELETE PID/PGID snapshot. The current delivery batch also records the
  separate real provider-backed AionUI Team/group-chat acceptance at the top of
  this document. That local evidence closes the P6 development gate; it does
  not prove real CrewAI admission, exact-head CI, merge, release, deployment, or
  final user acceptance.
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
