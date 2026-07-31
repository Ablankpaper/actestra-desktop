# P4 General-Work Vertical Slice

Status: GW-P4.2 through GW-P4.6 plus the representative workspace-file,
bounded local-research, writing, Office-document, and schedule journeys are
accepted on `main`. Schedule reached exact final head
`c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, PR CI 30659567604, squash merge
`5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and merged-main CI 30660078199.
Representative tool-failure and Worker-crash evidence still blocks the P4 gate

Date: 2026-08-01

Exact base:
`505afb2f3916e75c7abb07cdf461bda29a602b9b`

## Entry evidence

The schedule branch starts from the exact verified Office squash merge for
[pull request 19](https://github.com/bignormal/actestra-desktop/pull/19).
[Main CI run 30602821085](https://github.com/bignormal/actestra-desktop/actions/runs/30602821085)
passes on exact commit `505afb2f3916e75c7abb07cdf461bda29a602b9b`.

[ADR-0016](../architecture/decisions/0016-p4-general-work-process-and-content-boundaries.md),
[ADR-0017](../architecture/decisions/0017-general-worker-process-and-agent-adapter-v2.md),
[ADR-0018](../architecture/decisions/0018-scoped-native-text-tools-and-policy.md), and
[ADR-0019](../architecture/decisions/0019-general-work-durable-coordination-and-recovery.md)
retain AionUi as the product UI, Actestra Core as the sole authority, and the
General Worker as an unprivileged supervised process.

## Product journey

P4 must complete one offline general-work journey through the preserved
AionUi surfaces:

1. select or register a bounded workspace grant;
2. create an Actestra-authoritative task and attempt;
3. start a real supervised General Worker;
4. read one approved UTF-8 workspace file through the tool gateway;
5. create one bounded task-owned Markdown output;
6. persist normalized events, audit, content references, artifact metadata,
   and terminal evidence before success is shown;
7. make denial, failure, conflict, cancellation, and crash states visible; and
8. restart and recover the task and artifact projection from Actestra state.

The first worker is deterministic and offline. It proves process, permission,
state, and recovery contracts; it is not evidence of model quality, AionCore
distribution readiness, Goose, CrewAI, or a production OS sandbox.

## Ordered implementation

### GW-P4.2 — Persistence utility, grants, and content references

Accepted on `main` through pull request 10:

- Electron main launches a dedicated persistence utility and communicates
  through a strict version 1 structured-clone protocol;
- schemas 1 through 5 and their existing P3/F2/F3 operations move together
  behind the asynchronous port;
- schema version 6 adds durable workspace grants and immutable, 1 MiB-bounded
  UTF-8 content references;
- exact ownership, kind, lifecycle, expiry, length, and SHA-256 checks fail
  closed;
- source and packaged-graph checks reject synchronous SQLite from the main
  entry and require it in the utility entry;
- the preserved AionUi bridge uses the same client without changing the
  renderer, routes, feature entries, native response shapes, or backend
  authority; and
- utility startup failure leaves preserved AionUi available while Actestra
  compatibility providers report an explicit unavailable state.

Validation completed before pull request 10 merged:

- focused protocol, client, migration, grant, and content tests: 8 files,
  27 tests passed;
- complete root `bun run check`: formatting, zero-warning lint, strict types,
  Electron SQLite probe, 37 files and 194 tests, process smoke, 49-source
  boundary, frozen foundation, 112-file downstream contract, and dual-entry
  production build passed;
- root coverage: 81.85% statements, 74.17% branches, 90.73% functions, and
  82.07% lines without threshold changes;
- documentation: all 48 relative-link documents resolve, the 9 changed
  Markdown files have zero lint issues, and `git diff --check` passes;
- materialized native strict TypeScript: passed;
- materialized native CI-targeted suite: 22 files, 144 tests passed;
- complete native suite: 333 files and 2,609 tests passed, with 1 file and
  5 tests skipped by the retained upstream configuration;
- materialized native production build: passed and emitted separate
  `index.js` and `actestra-persistence-utility.js` entries;
- recursive build inspection found SQLite only in the utility entry;
- a real materialized AionUi Electron launch from an isolated profile logged
  `Actestra persistence` utility readiness at schema 6, created the preserved
  AionUi window, and reached renderer-ready;
- the live database contained `workspace_grants`, `content_references`,
  `aionui_shadow_evidence`, and `aionui_approval_decisions`; and
- terminating that development launch left no orphan Electron utility
  process.
- the unsigned legacy-harness arm64 bundle passed packaged identity and graph
  verification, then reached persistence utility, application, window, and
  renderer readiness from a clean profile with schema 6.

The exact GW-P4.2 implementation head
`9003cc0387cb4266c4b1240308092366ef365bf4` passed pull-request CI run
30475836615 and a complete 50-file CodeRabbit review with zero findings.
It squash merged as `8e32882108b10272c1489c1a46a77cede1cc4fb7`;
exact merged-main CI run 30476091907 passes.

The live launch used the frozen snapshot without an AionCore distribution
binary, so its existing installation-incomplete dialog was expected fixture
behavior and is not backend-success evidence. The launch was terminated
abruptly; it proves cleanup after that run, not a fully exercised graceful
shutdown journey. The packaged smoke above validates the platform regression
harness; target AionUi packaging remains a separate GW-P4.6 gate.

### GW-P4.3 — General Worker and Adapter v2

Accepted on `main` through pull request 11:

- [ADR-0017](../architecture/decisions/0017-general-worker-process-and-agent-adapter-v2.md)
  advances AgentAdapter to exact version 2, adds the closed `tool-results`
  capability, typed result resolution, and explicit protocol-error signals;
- the worker speaks a separate exact native protocol version 1 with exact
  implementation identity, closed capabilities, 256 KiB message and 64 KiB
  prompt bounds, and no Actestra Core event authority;
- Electron main creates attempt tokens, tool-request IDs, event IDs,
  timestamps, normalized events, and terminal mappings;
- one Electron utility process accepts exactly one immutable attempt, receives
  an allowlist-only environment, and cannot be reused after disposal;
- source and packaged-graph checks reject filesystem, shell, network, SQLite,
  and Electron authority from the worker graph;
- typed tool results carry only status, timestamps, bounded diagnostics, and an
  optional opaque output reference; and
- startup negotiation, no-tool completion, tool blocking/resume,
  cancellation, crash, timeout, malformed messages, stale identity, sequence
  gaps, duplicate attempts, and cleanup are covered.

Validation completed before pull request 11 merged:

- focused Adapter v2 and worker validation: 8 files and 47 tests passed;
- complete root `bun run check`: formatting, zero-warning lint, strict types,
  Electron SQLite probe, 40 files and 217 tests, smoke-harness regression,
  55-source boundary, exact frozen foundation, 120-file downstream contract,
  and three-entry production build passed;
- root coverage: 79.76% statements, 72.23% branches, 87.30% functions, and
  79.95% lines without threshold changes;
- root macOS arm64 directory package passed identity and recursive worker-graph
  verification; clean-profile smoke observed persistence, real General Worker,
  application, window, and renderer readiness with schema 6;
- materialized AionUI strict TypeScript passed;
- all 13 Actestra native files and 34 tests passed;
- complete native regression passed 334 files and 2,610 tests, with 1 file and
  5 tests skipped by retained upstream configuration;
- the full native build transformed 584 main modules and emitted separate
  `index.js`, `actestra-persistence-utility.js`, and
  `actestra-general-worker.js` entries without changing the renderer;
- reachable worker output contains the exact protocols and no filesystem,
  shell, network, SQLite, or Electron import; and
- a real isolated-profile native launch, with no startup-failure injection and
  the exact local `aioncore 0.1.52`, logged the Adapter v2/worker v1 completion
  marker, AionCore health, renderer load, and window readiness. Terminal
  shutdown left no Actestra, worker, or AionCore process.

Exit: a no-tool fixture completes through a real worker process and every
invalid or terminal path fails deterministically.

The exact GW-P4.3 head
`b3a3bc7e27d7dab44dadeff6dcedc92cec1b3ee5` passed
[pull-request CI run 30481670123](https://github.com/bignormal/actestra-desktop/actions/runs/30481670123).
It squash merged as `671587813bea18411b6cdc2ee388d94cd18d6c50`;
exact
[merged-main CI run 30481890911](https://github.com/bignormal/actestra-desktop/actions/runs/30481890911)
passes.

### GW-P4.4 — Scoped native tools and policy

Accepted on `main` through pull request 12:

- [ADR-0018](../architecture/decisions/0018-scoped-native-text-tools-and-policy.md)
  registers only `actestra.workspace.read-text` and
  `actestra.task-output.write-text` with exact Actestra-owned manifests,
  five-second bounds, no credential lease, and one exact allow rule each;
- a main-owned coordinator proves the still-active blocked attempt and its
  exact current request, derives identity and timestamps from the supervisor
  and normalized event, and derives action and resource kind from the closed
  registry;
- the production executor reloads the exact active workspace grant and content
  owner, rejects lexical or canonical escape, symbolic links, invalid portable
  paths, invalid UTF-8, non-regular files, and content above 1 MiB;
- output writes are restricted to the task-owned
  `.actestra/task-output/<task-id>` subtree and use mode-0600 temporary files
  plus exclusive same-filesystem publication, so an existing path is an
  explicit conflict and is never overwritten;
- successful content crosses the boundary only as a new exact-owner opaque
  `tool-output` reference; stable failure codes and `mayHaveExecuted` evidence
  enter metadata-only durable audit; and
- the preserved AionUi downstream registers the main-process provider after
  persistence readiness without adding a renderer route, bridge operation, UI,
  alternate state machine, or second product shell.

Current local evidence:

- root strict types and zero-warning lint pass;
- the two scoped-native root suites pass 15 tests covering both success paths,
  create-only conflict, traversal, symlink escape, invalid UTF-8, oversized
  input, wrong owner, malicious task identity, cancellation, unsupported tool,
  timeout ceilings, cleanup failure, coordinator unlock, and the denied
  action/resource surface;
- the downstream overlay contract passes with 125 declared files, 4 frozen R0
  invariants, and 40 reviewed Actestra source copies; and
- three materialized native files pass 4 focused tests for provider
  registration, the General Worker, and persistence utility;
- complete root `bun run check` passes formatting, zero-warning lint, strict
  types, the Electron SQLite probe, 42 files and 232 tests, process smoke,
  59-source authority boundary, frozen foundation, downstream contract, and
  the three-entry production build;
- root coverage passes at 80.80% statements, 73.59% branches, 86.88%
  functions, and 81.01% lines without threshold changes;
- the first materialized native strict-TypeScript gate exposed three callback
  annotations accepted by the root config but rejected by the retained AionUi
  config; adding the explicit return types made the same minimal gate pass;
- complete native regression passes 335 files and 2,612 tests, with 1 file and
  5 tests skipped by the retained upstream configuration;
- the native production build transforms 588 main modules and emits separate
  `index.js`, `actestra-persistence-utility.js`, and
  `actestra-general-worker.js` entries without changing the renderer;
- the unsigned arm64 legacy-harness directory bundle passes identity and
  recursive worker-graph verification, then reaches persistence, General
  Worker, application, window, and renderer readiness from a clean profile;
  and
- a real isolated-profile native launch logs both registered native tool IDs,
  schema 6 persistence, Adapter v2/Worker v1 completion, exact local
  `aioncore 0.1.52` health, window creation, and renderer load. Graceful exit
  leaves no Actestra, worker, persistence, or AionCore process; and
- full staged-diff review covered all 30 implementation files, remediated seven
  valid path, timeout, persistence-error, cleanup, lock-release, and harness
  findings, and rejected two invalid date/redundant-check findings.

Exit: success, denial, failure, cancellation, and output-conflict tests prove
no scope or policy bypass.

The exact GW-P4.4 head
`34f2d2201581c19b3dc67c5a7936f8a411bff9e1` passed
[pull-request CI run 30486392525](https://github.com/bignormal/actestra-desktop/actions/runs/30486392525).
It squash merged as `7ec009c6384a93c17f24e4276469e98cb5f2b71d`;
exact
[merged-main CI run 30486544268](https://github.com/bignormal/actestra-desktop/actions/runs/30486544268)
passes.

### GW-P4.5 — Coordination and recovery

Accepted on `main` through pull request 13:

- [ADR-0019](../architecture/decisions/0019-general-work-durable-coordination-and-recovery.md)
  adds a schema version 7 recovery journal with immutable attempt identity,
  bounded append-only events, a verified sliding resume baseline whose evicted
  prefix is first committed to the normalized event store, explicit tool
  ambiguity, a pre-execution workspace-grant identity, file-artifact intent
  and exact-owner output binding, monotonic revisions, and active,
  terminal-pending, and finalized phases;
- main persists the in-flight tool before gateway execution and persists its
  terminal result and artifact event before Adapter acknowledgement;
- a failed persistence or projection barrier retains the exact tool result and
  retries only the barrier and resolution path, so create-only output cannot
  execute twice;
- Adapter cleanup completes before terminal-pending state, then authoritative
  event history, artifact ownership, serialized domain graph reconciliation,
  normalized events, terminal evidence, and finalized state persist before
  Supervisor release;
- active application-interrupted attempts become explicit failed or cancelled
  terminal evidence, while terminal-pending attempts resume idempotently;
- non-finalized checkpoint admission and startup recovery are bounded at 100;
  process crash replacement uses fresh session, worker, stream, and process
  identities; artifact conflicts, unknown identity, duplicate event IDs,
  missing content, and unprojected authoritative events fail closed; and
- the preserved AionUI main process runs recovery after schema version 7 and
  scoped-tool readiness but before creating the original window, with no
  renderer, route, preload, or feature-entry change.

Current directed evidence:

- strict root TypeScript passes;
- the final affected root set passes 9 files and 80 tests, covering the
  recovery contract, coordinator, persistence client and SQLite adapter,
  utility protocol, lifecycle cleanup, retained-result retry, event identity,
  exact artifact projection, grant ownership, checkpoint bounds, and restart;
- the downstream contract passes with 129 declared files, 4 frozen R0
  invariants, and 43 reviewed Actestra source copies;
- the materialized AionUI recovery, persistence, worker, and native-tool files
  pass 4 files and 5 tests after the latest review remediation and formatting;
  and
- the first full CodeRabbit pass produced nine candidates; five valid findings
  were fixed and four invalid findings were dispositioned. Its changed-diff
  follow-up later waited about 25 minutes without a conclusion and was
  terminated as an orphan, so it is recorded as incomplete rather than zero
  findings. A complete manual/static review of all 43 changed files then fixed
  six additional event-history, grant-ownership, artifact-contract,
  checkpoint-bound, and serialized-reconciliation issues. The two
  smoke-contract files added by the gate remediation were reviewed separately;
- root pre-commit gates pass zero-warning format/lint, strict types, the
  Electron SQLite probe, 44 files and 256 tests, the smoke harness, 61-source
  boundary, exact foundation/downstream contracts, and production build. Four
  ignored `.DS_Store` files caused one environment-only foundation failure;
  removing those exact files and resuming from the failed gate passed without
  repeating the root suite;
- the first complete native attempt is recorded as an environment failure
  because the disposable tree lacked installed dependencies. After the exact
  3,177-package lock was installed, strict TypeScript exposed and closed two
  coordinator callback annotations; the complete native regression passes 336
  files and 2,613 tests, with 1 file and 5 tests skipped;
- the native production build passes after 591 main, 7 preload, and 10,163
  renderer modules and preserves separate Utility and General Worker entries;
- the unsigned compatibility package passes identity and graph verification.
  Its obsolete schema-6 smoke assertion was corrected to schema 7 after the
  application itself reached all readiness markers; the affected harness and
  real packaged smoke pass; and
- a real isolated-profile materialized AionUI launch with local exact
  `aioncore 0.1.52` reaches scoped-tool readiness, schema 7, zero recovered
  attempts, Adapter v2/Worker v1 completion, backend health, original window,
  and renderer load. The authoritative SQLite event, artifact, and checkpoint
  tables are present with no pending checkpoint, and shutdown leaves no
  Electron, Utility, Worker, or AionCore process.

The exact GW-P4.5 head
`f160d9a3a00f317f12b7579bc3a48849c1cf32d2` passed pull-request CI run 30495112290. It squash merged as
`1dacbc0bee8ebae26d688e6e719c8f0f5750db5f`; exact merged-main CI run
30495301140 passes.

### GW-P4.6 — Preserved-AionUi journey

Accepted on `main` through pull request 14:

- one bounded `/actestra` prompt-artifact intent maps into the original AionUi
  conversation, workspace, status, cancellation, artifact, and Preview
  surfaces;
- schema version 8 atomically registers the authoritative journey while roots,
  content references, protected-operation fields, and generic IPC remain
  outside the renderer; and
- packaged target-app smoke covers restart, denial, cancellation, finalized
  evidence, renderer readiness, and process cleanup.

The exact GW-P4.6 head
`4a07eb9db1907ae8fab2613b4cf11a7d2a8cbee4` passed pull-request CI run 30553454459. It squash merged as
`784191bfc59d71a128ed5d3251db3535f1349e45`; exact merged-main CI run
30554447144 passes.

Accepted representative-file extension:

- `/actestra file <instruction>` selects a closed
  `workspace-file-artifact` journey; ordinary `/actestra` remains
  `prompt-artifact`;
- schema version 9 persists that closed kind and migrates schema-8 rows to
  `prompt-artifact`;
- main owns the fixed `actestra-input.txt` read input, lowers that invocation to
  the Worker's 64 KiB send bound, and owns both request IDs;
- source above 64 KiB terminates as `content-too-large` at the read step before
  entering Worker transport;
- the same isolated Worker receives the owned source, creates a private
  create-only `result.md` input capped at 128 KiB after JSON serialization, and
  exposes that input only to its main-owned adapter;
- main persists the write input under its exact owner before invoking the
  existing create-only tool;
- atomic registration uses kind-discriminated `toolInputReference` and
  `readInputReference` authority, including duplicate and reopen persistence;
  and
- normalized Core events and renderer projections contain neither source text
  nor the private write input.

Complete local evidence for the feature branch:

- complete root `bun run check` passes 50 files and 308 tests together with
  formatting, zero-warning lint, strict TypeScript, Electron SQLite, smoke,
  boundary, frozen-foundation, downstream, and production-build gates;
- the downstream contract passes 156 declared files, 4 R0 invariants, and 49
  reviewed source copies;
- materialized native strict TypeScript passes, the dedicated target-app smoke
  contract passes 3 tests, and the complete native suite passes 341 files and
  2,635 tests, with 1 file and 5 tests skipped by retained upstream
  configuration;
- the native production build transforms 599 main, 20 preload, and 10,180
  renderer modules; and
- the local arm64 package passes 11 AionCore resource checks, exact
  `aioncore 0.1.52`, 13 Hub fallback extensions, no broken symbolic links, strict
  recursive signing verification, and target-app workspace-file restart
  recovery, denial, cancellation, artifact-content, durable-state, and process
  cleanup smoke. Notarization remains unverified; and
- an initial complete 36-file CodeRabbit review raised five issues. Four valid
  issues were remediated, one Worker timing issue was rejected against the
  ordered response barrier, and the first complete post-remediation 37-file
  review raised zero issues. A later complete 37-file review after evidence
  updates raised one valid minor ADR closed-set wording issue, which was fixed.
  Documentation checks pass; a redundant post-fix confirmation was
  rate-limited before review with a 21-minute wait and is not zero-issue
  evidence.

The exact representative-file head
`f19b7dd006cf091aa9c7f1559dd484fdad35f200` passed pull-request CI run 30567484733. Pull request 16 has no submitted reviews or inline review
comments; its successful Free-plan CodeRabbit result is summary/walkthrough
evidence, not line-level review evidence. It squash merged as
`2aed0f705bf6f9b3734742c0905c94ac562f501e`; exact merged-main CI run
30569476160 passes.

Current bounded local-research extension:

- `/actestra research <instruction>` selects only
  `local-research-artifact`; ordinary `/actestra` and `/actestra file` retain
  their accepted meanings;
- schema version 10 rebuilds the journey-link table with the three exact
  accepted kinds, preserving every schema-9 prompt and file row while
  rejecting arbitrary kinds;
- main owns one 64 KiB-bounded `actestra-research.txt` input and both exact
  tool-request identities; no renderer path, network operation, credential,
  or generic research provider is added;
- the same isolated General Worker converts at most 32 non-empty local
  evidence lines into a private `research.md` write input;
- main stores that write input under its exact owner before the accepted
  create-only tool produces a `file` Artifact labeled
  `Actestra local research brief`;
- local source text stays out of normalized Core events and renderer
  projections, while the existing exact-owner, non-persisted native Preview
  renders the final Markdown;
- duplicate registration, SQLite reopen, and a real persistence-utility reopen
  plus prepared-task recovery retain the exact research kind and input without
  replaying native workspace context; and
- the target-app smoke contract now includes one fixed local-research scenario,
  schema 10, exact `research.md`, owned Preview validation, Core-event privacy,
  and process cleanup.

Complete local evidence:

- complete root `bun run check` passes formatting, zero-warning lint, strict
  TypeScript, Electron SQLite, 50 files and 313 tests, the smoke harness,
  67-source boundary, frozen foundation, 156-file/49-source-copy downstream
  contract, and three-entry production build;
- materialized native strict TypeScript and the complete native suite pass 341
  files and 2,637 tests, with 1 file and 5 tests skipped by retained upstream
  configuration;
- the native production build transforms 599 main, 20 preload, and 10,180
  renderer modules;
- the local macOS arm64 package under
  `/tmp/actestra-p4-research.fXes59/out/mac-arm64/Actestra.app` passes 11
  resource checks, exact `aioncore 0.1.52`, 13 integrity-checked Hub fallback
  archives, 17 valid symbolic links, arm64 identity, and strict recursive
  signing verification. It has an Apple Development signature but no
  notarization, so it is not a candidate or release;
- actual packaged target-app smoke exits zero through local-research prepared
  restart and recovery, exact `research.md`, exact-owner non-persisted Preview,
  schema 10, Core-event source privacy, denial, cancellation, finalized
  evidence, and process cleanup;
- the complete 24-file CodeRabbit review raised four issues. Two valid test
  issues were fixed and the affected 2 files pass 24 tests; the requested date
  change and stale packaged-smoke status were rejected against current local
  evidence; and
- complete manual review covers all 24 runtime, migration, downstream, smoke,
  test, and evidence-document changes without another in-scope defect.

Implementation `e7f3212f5978d69eb0afeaa140ddf9dcedf2414f` and final head
`5694865462f7209ad413b2cd1dbe2eef0fe955bc` reached Ready pull request 17.
Final PR-head CI run 30577647392 passes. It squash merged as
`779880f28106aa8423ba042de5a6a3264bc0452e`; exact merged-main CI run
30577886631 passes. The remote CodeRabbit run was rate-limited before review
and is not review evidence.

ADR-0021 defines the next writing slice as a prompt-derived structured brief,
not another workspace read or renamed research result. It creates a
Worker-authored private `draft.md` input, persists it before the accepted
create-only tool, and projects a `document` Artifact through owned Preview.

The writing implementation is locally complete on
`feat/p4-writing-journey` from exact main
`779880f28106aa8423ba042de5a6a3264bc0452e`:

- `/actestra write` validates the closed ordered brief before schema-11
  prompt-only registration and adds no workspace read, renderer path, generic
  tool transport, shell, credential, or scheduler authority;
- the same isolated Worker authors private `draft.md` content, main persists
  it under the exact write-request owner, and the create-only tool binds one
  `document` Artifact labeled `Actestra writing draft`;
- prepared recovery uses the persisted brief without re-reading native
  workspace state, while normalized events, metadata audit, and renderer
  projections exclude the private draft input and path; and
- the original AionUI SendBox, conversation, status, cancellation, error, and
  non-persisted owned Preview surfaces remain the only UI.

Complete local evidence:

- the post-review affected root set passes 7 files/74 tests and complete `bun
run check` passes 50 files/325 tests together with formatting, zero-warning lint,
  strict TypeScript, Electron SQLite, smoke, boundary, frozen-foundation,
  downstream, and production-build gates;
- materialized native strict TypeScript, 4 focused files/9 tests, the complete
  341-file/2,639-test native regression, and native production build pass. The
  build transforms 600 main, 21 preload, and 10,181 renderer modules; 1 file
  and 5 tests remain skipped by retained upstream configuration;
- `/tmp/actestra-p4-writing-reviewed.8JgbPo/out/mac-arm64/Actestra.app` passes 11
  resource checks, exact `aioncore 0.1.52`, integrity checks for 13 Hub
  archives and 17 symbolic links, arm64 identity, and strict recursive ad-hoc
  signature verification. An earlier Apple Development attempt could not
  reach the external timestamp service; this reviewed package explicitly uses
  the local ad-hoc path. Gatekeeper rejects it with status 3 as expected, so it
  is not a candidate or release; and
- real packaged target-app smoke passes schema-11 writing prepare/recover,
  prompt-only prepared state, exact `document`/`draft.md`/owned Preview,
  private-input event and audit privacy, plus the accepted file restart,
  research, denial, cancellation, terminal evidence, and cleanup journeys.

Manual review covers all 33 current files and fixes the command-boundary
Unicode-separator bypass plus stale schema wording. The initial complete
CodeRabbit pass covered tracked and untracked files and raised two valid issues
plus one invalid date request. The final 31-tracked-file confirmation raised
one valid Worker-attempt poisoning issue, fixed with a red-green regression;
it omitted the two untracked files and is not represented as a complete
zero-finding review.

Documentation links pass across 54 Markdown files, Markdown lint reports zero
issues across 48 files, and `git diff --check` passes. Implementation commit
`3e9d57407207ee8718fea2ed127a85dbab4daad8` was followed by exact Ready PR head
`2febf25e80868fac51fb7b37fffb746d10f8edde`. PR CI run 30585829619 passes; PR
18 squash merged as `d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2`; exact
merged-main CI run 30586015008 passes. The Ready PR's CodeRabbit Free result is
only a summary and walkthrough with no submitted review or inline comment; it
is not represented as complete line-level review evidence. Notarization,
candidate, release, distribution, and user acceptance remain pending.

ADR-0022 defines the independent Office-document slice as a real binary
document journey, not a renamed Markdown fixture. The implementation on
`feat/p4-office-document-journey` starts from exact verified main
`d5dbc68bb4b3076448dc0bfb9ffc164ffd1c40d2`:

- `/actestra office` validates the exact ordered Document, Owner, Summary, and
  one-through-six Section brief before schema-12 prompt-only registration;
- the isolated Worker returns a private bounded document model without a
  workspace read, and main persists it under the exact request owner before
  invoking `actestra.task-output.write-office-document`;
- the create-only main process tool fixes `brief.docx`, generates a real
  ZIP/OOXML package through pinned `docx@9.6.1`, publishes atomically, and
  binds one `document` Artifact labeled `Actestra Office document`;
- the retained AionUI Word Preview receives only the exact-owner bounded model
  with `persist: false`; DOCX bytes, roots, paths, references, process handles,
  and document-generation authority remain outside the renderer; and
- prepared recovery starts from the durable brief and kind, without replaying
  native workspace context.

Current Office local evidence:

- `bun run downstream:aionui:check` passes 163 declared files, 4 R0
  invariants, and 52 reviewed source copies; exact downstream install completes
  with 3,177 packages;
- the final complete root gate passes 50 files/338 tests and the complete
  native suite passes 343 files/2,644 tests. Manual review found that the
  shared output-media union let the text writer accept the new Office Preview
  type. A focused red run failed 1 of 8 assertions; after narrowing the text
  writer to plain text and Markdown, the green run passes 8/8 and strict root
  TypeScript passes. Final native strict TypeScript, the complete native suite,
  and the native production build pass from those bytes after transforming
  602 main, 22 preload, and 10,182 renderer modules;
- `/tmp/actestra-p4-office-stable-final.Symazz/out/mac-arm64/Actestra.app` is
  rebuilt from the final production output and passes 11 resource checks, both
  required Electron notices, exact `aioncore 0.1.52`, 13/13 Hub ZIP integrity
  and archive checks pinned locally to
  `63952fa23897184e03e67a97664f9a901ab2266b`, 17 valid symbolic links, arm64
  identity, exact production-entry hashes, strict recursive Apple Development
  signing with Team ID `7H3BA9HTRK`, and the packaged `docx@9.6.1` MIT-license
  check; and
- actual packaged target-app smoke passes schema-12 Office prepare/recover, a
  real `brief.docx` with required OOXML entries, exact `document` Artifact,
  bounded owned Word Preview, Core-event and metadata-audit privacy, the
  accepted file/writing/research/denial/cancellation evidence, and full smoke
  root, CLI-link, and process cleanup.

The Office package is local disposable evidence: it has no notarization and is
not a candidate or release. One intermediate signed package was rejected
before smoke because a moving-tag mixed-mirror Hub download matched only 9/13
index integrity values; the final package uses the verified 13/13 local set.
The earlier complete 42-file CodeRabbit review raised only an invalid UTC-date
request. The final stable-input 43-file review raised two valid wording issues
about prompt-only Office registration ownership and the persisted canonical
model versus detached non-persisted renderer projection. Both were fixed in
the system overview and ADR-0022; the complete post-remediation 43-file review
raised zero issues. The complete manual review found and closed the text-writer
media-type defect. Final documentation, link, range, secret, binary,
generated-output, and staged-scope audits passed. Implementation commit
`7df1c17db31c0ab76c2ecf33d0f4c87cfd3c7d5f`, schema-smoke fix
`0b8b40a68bad68d6a9d06f202eeb85cb019afbfa`, and final evidence head
`091f786d57c6b4569cdaac17ea969a0b9070ea02` reached Ready pull request 19.
Final PR CI run 30602624426 passes. PR 19 squash merged as
`505afb2f3916e75c7abb07cdf461bda29a602b9b`; exact merged-main CI run
30602821085 passes. The remote CodeRabbit Free status is summary/walkthrough
evidence only, with no submitted review or inline comment.

ADR-0023 governs the local schedule implementation beneath the retained AionUI
`/scheduled` routes, `CreateTaskDialog`, detail/history/status surfaces, and
`ipcBridge.cron` DTOs. It admits only an existing native conversation plus a
bounded `/actestra` prompt. Schema 13 owns jobs, canonical schedule grants,
next-run state, atomic run claims, and missed/interrupted outcomes. Electron
main owns timers and invokes the existing General Work journey from the stored
grant; renderer-selected paths, runtime, model, credentials, Worker, tool,
queue, retry, and new-conversation authority remain rejected. The native
conversation action opens the existing dialog with its current conversation
binding so the admitted path is usable without a replacement UI.

Pre-review local schedule baseline evidence:

- complete root `bun run check` passed 56 files/414 tests together with format,
  zero-warning lint, strict types, SQLite, smoke, product-boundary, frozen
  foundation, downstream, and production-build gates;
- materialized native strict TypeScript and the complete 345-file/2,658-test
  native suite passed with only retained upstream skips; the pre-review
  production build transformed 606 main, 26 preload, and 10,186 renderer
  modules;
- the pre-review Apple Development-signed unnotarized arm64 package under
  `/private/tmp` passed exact AionCore, 13/13 Hub fallback, Electron notice,
  Croner license, architecture, and strict recursive signature checks; and
- that package's target-app smoke passed schema-13 create/restart/list,
  run-now, missed/interrupted outcomes, one scheduled General Work Artifact,
  privacy, the accepted prior journeys, and process cleanup.

The first formal 50-file CodeRabbit review raised 12 issues, including 4 Major
and 8 Minor. Valid status, canonical-path test, bridge policy, Task-correlated
failure, graph-identity, and exact-due-time concerns were remediated through
focused RED-to-GREEN cycles. The affected 5 files pass 81 tests, the 8 changed
code/test files pass zero-warning lint, and strict TypeScript passes. The empty
manual cron, explicit unsupported Skill route, fail-closed recovery, and
duplicate recovery-event requests were rejected against ADR-0023 and the
durable interrupted state.

The second confirmation raised 8 issues (5 Major, 3 Minor), the third raised 4
(3 Major, 1 Minor), and the fourth raised 3 (1 Major, 2 Minor). The later valid
documentation and closed-protocol coverage items are applied. The fourth-pass
request to authorize native AionUI workspace selection through a pre-existing
Actestra registry or Git worktree set is rejected against ADR-0020's initial
native-selection authority, ADR-0023's atomic canonical grant capture, and the
P5 coding-worktree boundary. Two final-input follow-ups were rate-limited before
analysis and cannot be reported as zero-issue reviews; the final complete
manual 51-file review includes the Node-free schedule contract split and its
corrected downstream-owner assertion and found no additional confirmed defect.

Current final-byte local evidence supersedes the earlier package as proof of
the present input:

- `bun run check` passes 56 files/424 tests, all source and authority gates,
  and a 56/3/28-module root production build;
- the exact 3,177-package materialization, arm64 Electron 37.10.3
  `better-sqlite3` source rebuild, strict TypeScript, and complete native suite
  pass 345 files/2,658 tests with only the retained 1-file/5-test upstream
  skips; the native production build transforms 607 main, 24 preload, and
  10,184 renderer modules;
- `/private/tmp/actestra-p4-schedule-final-byte.54REpE/out/mac-arm64/Actestra.app`
  passes independent package, exact ASAR-entry, Electron notice, AionCore
  `0.1.52`, Hub 13/13, docx/Croner notice, 26-file arm64 Mach-O signature, and
  17-link checks; and
- the same package passes actual schema-13 target-app schedule, retained prior
  journey, privacy, terminal-evidence, temporary-root, and process-cleanup
  smoke.

The implementation first reached Ready pull request 20 as
`70b11992f4de015e0952d482a126cd1270208aa8`. Initial exact-head CI run
30657973409 passes through the native production build and bundle creation,
then fails strict package verification because the workflow packages the legacy
root `out/` instead of the materialized native output. A focused RED-to-GREEN
workflow contract packages inside the materialized tree, verifies that exact
native app, and runs the schema-13 target-app smoke. The remediation reached
exact final head `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`; PR CI run
30659567604 passes the complete job. PR 20 has no submitted review or review
thread; its CodeRabbit Free output is a rate-limited summary/walkthrough, not a
line-level review. The PR squash merged as
`5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and merged-main CI run
30660078199 passes. The local Apple Development signature is not notarization,
a candidate, release, distribution, or user acceptance.

### Representative tool-failure final-local evidence

The next independent slice reuses the accepted workspace-file journey and
forces the main-owned `actestra.workspace.read-text` capability above its 64 KiB
per-invocation bound. The user still submits through the retained AionUI
conversation; the renderer receives no path, content, tool, Worker, credential,
or scheduling authority. Actestra owns the one Task, Session, Worker, Attempt,
policy decision, metadata audit sequence, normalized Core events, finalized
checkpoint, terminal projection, and restart result.

Focused RED-to-GREEN coverage proves that a failed scoped tool contributes its
stable incident code to terminal Attempt evidence only when the final
`task.failed` code matches. Existing Supervisor incidents retain precedence;
mismatched terminal evidence fails closed. A real target-app run additionally
found that the external smoke compared a canonical persisted workspace root to
its non-canonical macOS test alias. A separate RED-to-GREEN harness correction
now compares the canonical root and checks both aliases for privacy leakage;
the packaged app itself did not change for that correction.

Final-local evidence on `feat/p4-representative-tool-failure` from exact base
`3d8d697a6416176d90183f671da28347bb194553`:

- final root `bun run check` passes 56 files/425 tests, all source, smoke,
  renderer-authority, foundation, downstream, and 56/3/28-module build gates;
- strict native TypeScript, the focused 10-test native smoke file, and the full
  native suite pass 345 files/2,662 tests with the retained one-file/five-test
  upstream skips; the native production build transforms 607 main, 24 preload,
  and 10,184 renderer modules;
- `/private/tmp/actestra-p4-tool-failure-pinned-local-electron.IUrN6a/out/mac-arm64/Actestra.app`
  passes independent package verification, 4/4 production-entry ASAR parity,
  4/4 Electron/docx/Croner notice checks, AionCore `0.1.52`, 14/14 exact Hub
  Git blobs and 13/13 valid ZIPs at pin
  `63952fa23897184e03e67a97664f9a901ab2266b`, 25/25 actual arm64 Mach-O
  signatures, and 17/17 contained symbolic links; and
- the same package passes schema-13 target-app smoke through the retained
  schedule and prior journeys plus exact first-run and post-restart
  `content-too-large` evidence, one unchanged Task/Session/Worker/Attempt, no
  Artifact, metadata privacy, and complete process cleanup.

The first post-review package was rejected because the moving `dist-latest`
Hub input contained only seven extensions. The final package uses the already
verified static 13-file fallback from the exact pin above, local Electron
37.10.3 arm64, and the unchanged final production output. Its fresh target-app
wrapper is
`/private/tmp/actestra-p4-tool-failure-smoke-wrapper-pinned.WZdkNW`.

The complete manual review covers all 15 tracked files and closed terminal
Attempt fail-closed validation, stale schedule truth, and target-app identity
chain issues without another confirmed defect. This remains local evidence.
CodeRabbit was not retried after the known rate limit. The exact scope,
high-confidence secret, binary/generated-output, tracked-document,
frozen-foundation, user-copy, and process-cleanup audits pass. Commit, push,
exact PR-head CI, merge, and merged-main CI remain before acceptance. The Apple
Development-signed package is not notarized, a candidate, release, deployment,
distribution, or user acceptance. Worker crash/recovery remains the next
separate P4 slice after this one is accepted on `main`.

Exit: the complete general-work journey is understandable and recoverable in
the retained AionUi UI with Actestra as the declared system of record.

## Phase gate

P4 is complete only after:

- the general-work journey completes after restart;
- scoped file, local research, writing, office-document, schedule, and
  artifact fixtures pass;
- denial, cancellation, tool failure, persistence failure, worker crash, and
  artifact conflict are covered;
- renderer code cannot bypass main-owned state, policy, process, scope, or
  content boundaries;
- no raw root, content, credential, or reference enters metadata-only audit or
  renderer projection;
- exact PR-head and merged-main CI pass; and
- the packaged target AionUi product, not only the legacy harness, passes the
  required smoke.

## Current non-claims

- GW-P4.2 through GW-P4.6 plus the representative-file, local-research,
  writing, Office, and schedule extensions are accepted on `main`. Four complete
  schedule CodeRabbit passes are dispositioned and the manual review is closed;
  two CLI follow-ups and the final remote request were rate-limited before
  analysis. Its final-byte local gates, exact PR-head CI, squash merge, and
  merged-main CI pass.
- Three scoped native tools are connected to user-submitted preserved-AionUI
  tasks. The two text tools retain their accepted fixed or bounded paths; the
  Office tool accepts only fixed `brief.docx`. None is a renderer-selected
  generic filesystem API.
- Representative tool failure has complete local root, native, package, and
  target-app evidence, but no commit, PR-head CI, merge, or merged-main CI. It
  does not close the separate Worker-crash/recovery gate or full P4 acceptance.
- No shell, network, credential, MCP, publish, Git, arbitrary workspace
  mutation, model, Goose adapter, CrewAI sidecar, or Team orchestration is
  active.
- Utility-process separation is not OS sandbox evidence.
- Schemas 7 through 13 are forward-only; development rollback uses a fresh
  profile rather than deleting or downgrading user state.
- The local target package contains the exact pinned AionCore binary, but
  its license clarification, notarized candidate, distribution, and fresh-user
  acceptance remain unresolved.
- The schedule and tool-failure packages are disposable local evidence only; no candidate,
  release, deployment, distribution, or user acceptance is claimed.
