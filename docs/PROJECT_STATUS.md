# Project Status

Last updated: 2026-07-30

## Current phase

### GW-P4.3 is on main; GW-P4.4 has complete local validation

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

GW-P4.4 is implemented with complete local validation on
`feat/aionui-p4-scoped-native-tools`, based on the exact GW-P4.3 merge.
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
those changes. Push, exact-head CI, merge, and merged-main CI remain pending.

This real launch diagnoses the installation-incomplete screenshot: the dialog
is the retained AionUi fail-closed state when AionCore is absent or startup is
intentionally failed. The local exact AionCore binary starts successfully when
discoverable. No approved distributable AionCore bundle is committed, so this
is local runtime evidence, not target-package, candidate, release, deployment,
distribution, or user-acceptance evidence.

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

| Area                                               | State                                                      | Evidence or blocker                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository                                         | F0-F3.3 and P6 architecture accepted on `main`             | PR 9 final head `d7e615206af0829375db0db1d1fcc6ca205102a8`; squash merge `327d5ca5abf3a0090bc2b3d3193e2935bbd47f38`; main CI 30470505690 passes                                                                                                                                                                                                                                                                                                     |
| P2 merge                                           | Accepted on `main`                                         | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`                                                                                                                                                                                                                                                                                                                                 |
| P2 main CI                                         | Pass                                                       | Main push run 30329620829 passed on the exact squash merge                                                                                                                                                                                                                                                                                                                                                                                          |
| P3 kickoff CI                                      | Pass                                                       | Pull-request run 30329964305 passed on exact pushed head `b9c1119479c805c02452e4054a3d904649a3ca03`                                                                                                                                                                                                                                                                                                                                                 |
| P3.1/P3.2 CI                                       | Pass                                                       | Pull-request run 30331681309 passed on exact implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99`                                                                                                                                                                                                                                                                                                                                       |
| P3.3 CI                                            | Pass                                                       | Pull-request run 30335076556 passed on exact implementation commit `4de756984269624a02fbfdf77e558c958a03c2e0`                                                                                                                                                                                                                                                                                                                                       |
| P3.4 CI                                            | Pass                                                       | Pull-request run 30339662937 passed on exact implementation commit `2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b`                                                                                                                                                                                                                                                                                                                                       |
| P3.5 CI                                            | Pass                                                       | Pull-request run 30345370507 passed on exact implementation commit `cec0cdc554656c021cdff7f2341ddd3f9b5d83dd`                                                                                                                                                                                                                                                                                                                                       |
| P3.6 CI                                            | Pass                                                       | Pull-request run 30350732223 passed on exact implementation commit `950fe0efa2fdc5adc69d013acc9f417d201cb28e`                                                                                                                                                                                                                                                                                                                                       |
| P3 review closure                                  | Pass with one documented invalid issue                     | Full 67-file review completed with 10 issues; 9 valid issues fixed; all 9 remediation files then completed a zero-issue review; exact remediation CI run 30374144474 passed                                                                                                                                                                                                                                                                         |
| P3 Ready gate                                      | Pass                                                       | Owner authorized the Ready transition; runs 30374447377 and 30376456379 passed on their exact heads; final PR-head run 30376696055 passed; the first Ready-triggered CodeRabbit selected 67 files and completed successfully with 0 review submissions and 0 threads                                                                                                                                                                                |
| P3 merge                                           | Accepted on `main`                                         | PR 3 squash merged exact final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f` as `f6833c50eaf5a426948bac7999f93a08b19a425e`                                                                                                                                                                                                                                                                                                                        |
| P3 main CI                                         | Pass                                                       | Main push run 30378191752 passed on exact squash commit `f6833c50eaf5a426948bac7999f93a08b19a425e`                                                                                                                                                                                                                                                                                                                                                  |
| P4.0 foundation                                    | Accepted on `main` through PR 6                            | Implementation `13270ca0abd7353710541afca9ddf46c47670be3`; early exact-head CI run 30392140461 passes                                                                                                                                                                                                                                                                                                                                               |
| P4.1 identity and isolation                        | Accepted on `main` through PR 6                            | Implementation `836a9f1f81687f091e1c5b92ce30bff167e9da4f`; resource-only CI remediation `462a1b0d920279d42f124fdd28673d77dc55b765`; run 30417692550 passes                                                                                                                                                                                                                                                                                          |
| P4.2 compatibility shadow                          | Accepted on `main` through PR 6                            | Implementation `632573fa03c34fdb789c85d8efc1ce1e0f8e8177`; packaged-boundary remediation `1478726d62302fa885525024eb4839af5e98b4dd`; run 30421351204 passes                                                                                                                                                                                                                                                                                         |
| P4.3/F3.1 approval decision authority              | Accepted on `main` through PR 6                            | Implementation `cf61ffb8453a888cdc03f73457ebeaf72708511a`; ADR-0012; schema version 5 persist-before-deliver outbox; 30/153 root and 330/2,602 native tests; run 30425061316 passes                                                                                                                                                                                                                                                                 |
| PR 6 review and merge closure                      | Accepted on `main`                                         | Final head `70b2f29329fec26bf0e3d6384d8563aedcb7a4ce`; exact-head CI 30431557027 passes; local review of 21 final changed files returned zero findings; squash merge `61b9405fc007aa8cb16ec05a65f421cb7d277b51`; exact main CI 30434563810 passes                                                                                                                                                                                                   |
| F3.2 approval delivery policy gate                 | Accepted on `main` through PR 7                            | Implementation `20e3c0fcada0d072fc35820d43b85c953bf93929`; final head `df821ca203bea7b611fa8fb8092d00a16cabe578`; squash merge `ce19dbe072328e16dcdaf116b8199d5502cb44c6`; exact main CI run 30442166290 passes                                                                                                                                                                                                                                     |
| F3.3 approval reconciliation policy gate           | Accepted on `main` through PR 8                            | Implementation `c2fa4bbc4989b9a41bf6a283b5f0eb1f2f523acb`; final head `3f85e13072f5fb13fb43c9dae94f992bb0b7fb9c`; squash merge `c841ed9cb6a54bcb2e4078ca2be941adce0ac4ad`; exact main CI run 30449520722 passes; the complete local 18-file review raised zero issues before merge                                                                                                                                                                  |
| GW-P4.2 persistence utility and content foundation | Accepted on `main` through PR 10                           | Final head `9003cc0387cb4266c4b1240308092366ef365bf4`; exact-head CI 30475836615; zero-finding 50-file review; squash merge `8e32882108b10272c1489c1a46a77cede1cc4fb7`; exact main CI 30476091907                                                                                                                                                                                                                                                   |
| GW-P4.3 General Worker and Adapter v2              | Accepted on `main` through PR 11                           | Final head `b3a3bc7e27d7dab44dadeff6dcedc92cec1b3ee5`; exact-head CI 30481670123; squash merge `671587813bea18411b6cdc2ee388d94cd18d6c50`; exact main CI 30481890911; ADR-0017; 40/217 root and 334/2,610 native tests; build, unsigned harness package, real utility-worker smoke, and isolated native AionUi/AionCore launch pass                                                                                                                 |
| GW-P4.4 scoped native tools and policy             | Complete local validation and review; remote gates pending | Branch `feat/aionui-p4-scoped-native-tools` based on `671587813bea18411b6cdc2ee388d94cd18d6c50`; ADR-0018; exactly two closed native text tools; 42/232 root and 335/2,612 native tests; root/native build, unsigned harness package, scoped desktop registration, and isolated native AionUi/AionCore launch pass; complete 30-file review remediated seven valid findings and rejected two invalid findings; push, CI, merge, and main CI pending |
| P6 orchestration boundary                          | Accepted architecture direction only                       | ADR-0015; CrewAI `1.15.8` at `e9caf1e1b89343bb833b5da6660faa91804a9dce` verified as the first supervised sidecar candidate; Eigent `v1.0.2` at `e478094a9ff433132b3cf1928e4143338ddaab20` retained as a reference; neither is imported, bundled, or implemented                                                                                                                                                                                     |
| Native AionUi source                               | Exact local desktop snapshot                               | AionUi `v2.1.41` at `2d8925fc67a97a20996fadcd2a0862b778b572ba`; 1,766 files; no local modification inside snapshot                                                                                                                                                                                                                                                                                                                                  |
| Native preservation contract                       | Local pass                                                 | Manifest SHA-256 `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`; 27 routes and 41 bridge domains verified                                                                                                                                                                                                                                                                                                                       |
| Native AionUi build and launch                     | Local pass                                                 | Frozen install, production build, isolated native Electron launch, and actual Guide screenshot pass                                                                                                                                                                                                                                                                                                                                                 |
| Native AionUi tests                                | Latest local pass                                          | 334 files passed, 1 skipped; 2,610 tests passed, 5 skipped; 0 failures                                                                                                                                                                                                                                                                                                                                                                              |
| Legacy product shell                               | P3 harness only                                            | Original Actestra Electron/React shell remains for platform-contract and packaging regression; it is not the target product UI                                                                                                                                                                                                                                                                                                                      |
| Renderer boundary                                  | CI-backed through P3.6                                     | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, exact frozen preload allowlist, trusted-frame zero-argument IPC, and direct-client source checks                                                                                                                                                                                                                                                |
| Automated tests                                    | Exact merged-main CI pass                                  | Main run 30378191752 passes 24 Vitest files with 130 tests, the exact Electron SQLite probe, process-failure harness, 34-source boundary check, build, package identity, and clean-profile smoke                                                                                                                                                                                                                                                    |
| Desktop package                                    | Local and CI unsigned evidence                             | macOS arm64 app bundle, packaged identity, and clean-profile smoke verified; not a candidate                                                                                                                                                                                                                                                                                                                                                        |
| P3 domain contracts                                | Implemented and CI-backed                                  | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above                                                                                                                                                                                                                                                                                             |
| P3 event contract                                  | Implemented and CI-backed                                  | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above                                                                                                                                                                                                                                                                              |
| P3 persistence and migrations                      | Implemented and CI-backed                                  | ADR-0005 schemas 1 and 2 plus ADR-0008 schema 3 for privileged audit and terminal-attempt evidence; exact runs above                                                                                                                                                                                                                                                                                                                                |
| P3 worker lifecycle                                | Implemented and CI-backed through GW-P4.3                  | ADR-0006 protocol v1, supervisor, lifecycle, and fake are accepted; ADR-0017 supersedes only the AgentAdapter version/interface with v2 and adds a separate General Worker protocol v1, typed tool results, and a real deterministic utility process                                                                                                                                                                                                |
| P3 privileged services                             | Implemented and CI-backed                                  | ADR-0007; protected-operation and manifest contracts; policy, approval, opaque lease, metadata-only audit, and deterministic gateway services; exact commit and run above                                                                                                                                                                                                                                                                           |
| P3 main integration                                | Implemented and CI-backed                                  | ADR-0008; main-only inert composition, durable audit, persist-before-release barrier, fixed IPC allowlist, bounded renderer projection, and packaged startup smoke; exact commit and run above                                                                                                                                                                                                                                                      |
| F2 shadow persistence                              | Local and CI-backed contract evidence                      | ADR-0011; schema version 4; gapless and idempotent metadata-only evidence; no authoritative domain or event writes; real Guide read remains local proof                                                                                                                                                                                                                                                                                             |
| F3.1 approval response persistence                 | Implemented and CI-backed                                  | ADR-0012; schema version 5 immutable response and delivery outbox; exact implementation run 30425061316; restart and explicit-fallback live proof remains local; native pending-request and protected-operation authority remain separate                                                                                                                                                                                                           |
| Release                                            | None                                                       | No candidate, signed artifact, deployment, distribution, or user acceptance                                                                                                                                                                                                                                                                                                                                                                         |

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

1. Finish the exact diff and secret audit, then commit
   `feat/aionui-p4-scoped-native-tools`.
2. Push the exact GW-P4.4 head, require pull-request CI, verify the selected
   repository, branch, SHA, checks, and artifacts, then squash merge.
3. Require merged-main CI before calling GW-P4.4 accepted.
4. Start GW-P4.5 from that verified main and implement only authoritative
   task/attempt coordination, artifact ownership, persistence ordering, and
   recovery around the two admitted tools.
5. Continue through the complete P4 journey before Goose P5 and CrewAI-assisted
   Team P6 production work.

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
- CrewAI production version and rollback pin, minimal dependency lock, sidecar
  protocol, vulnerability evidence, and cross-platform packaging strategy.
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
- Merged `main` runs the full schemas 1 through 6 adapter in a dedicated
  persistence utility. The downstream main accepts one fixed
  shadow-observation operation and one fixed desktop confirmation response
  operation. F3.2 gates only that response's native delivery, while F3.3
  separately gates only the boolean pending-state reconciliation read. It
  exposes no renderer-selected protected operation, generic tool transport,
  credential value, or worker control.
- The P3.4 deterministic fake remains test infrastructure. Accepted GW-P4.3
  adds a real deterministic utility process and packaged-process probe.
  GW-P4.4 locally connects its blocked fixture to exactly two main-owned native
  tools, but not yet to a user-submitted AionUi task.
- P3.6 makes metadata-only audit and terminal-attempt evidence durable.
  Approval, credential-lease, and policy state remains in memory and contains no
  secret value. F3.1 separately makes the bounded native confirmation response
  and outbox durable. F3.2 activates the accepted P3 sequence for exactly
  one compatibility delivery capability, not for generic native tool
  execution.
- GW-P4.2 removes synchronous SQLite from both root and native Electron main
  entry graphs and is accepted on `main`. It has no in-main fallback;
  transparent hot recovery remains future GW-P4.5 work.
- F2 shadow evidence is renderer-originated compatibility evidence, not trusted
  audit, product, policy, approval, migration, or user-workload state.
- The P3 contracts and fake-worker gate have passed. The bounded deterministic
  General Worker is accepted through GW-P4.3. Exactly two scoped native text
  tools have complete local GW-P4.4 evidence; complete task/artifact
  coordination, recovery, preserved-AionUi journey mapping, and specialized
  Goose work remain later gates.
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
