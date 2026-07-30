# P4 General-Work Vertical Slice

Status: GW-P4.2 through GW-P4.6 accepted on `main`; the first representative
workspace-file journey is implemented and locally validated on
`feat/p4-representative-file-journey`; local complete gates and full-diff
review pass, while remote closure remains pending

Date: 2026-07-31

Exact base:
`d32fd6712ea10295af40a4a45833088a9e9b1f95`

## Entry evidence

The branch starts from the exact verified `main` status-closure merge for
[pull request 15](https://github.com/bignormal/actestra-desktop/pull/15).
[Main CI run 30555498924](https://github.com/bignormal/actestra-desktop/actions/runs/30555498924)
passes on that commit.

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

Current representative-file extension:

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

Exit: the complete general-work journey is understandable and recoverable in
the retained AionUi UI with Actestra as the declared system of record.

## Phase gate

P4 is complete only after:

- the general-work journey completes after restart;
- scoped file, local research, writing, and artifact fixtures pass;
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

- GW-P4.2 through GW-P4.6 are accepted on `main`; the representative-file
  extension is not accepted on `main` until PR-head CI, review, merge, and
  merged-main CI complete.
- The two native tools are connected to a user-submitted preserved-AionUI task,
  but the file path remains the one main-owned `actestra-input.txt`; this is not
  a renderer-selected generic filesystem API.
- No shell, network, credential, MCP, publish, Git, arbitrary workspace
  mutation, model, Goose adapter, CrewAI sidecar, or Team orchestration is
  active.
- Utility-process separation is not OS sandbox evidence.
- Schemas 7 through 9 are forward-only; development rollback uses a fresh
  profile rather than deleting or downgrading user state.
- The accepted target package contains the exact pinned AionCore binary, but
  its license clarification, notarized candidate, distribution, and fresh-user
  acceptance remain unresolved.
- No new package, candidate, release, deployment, distribution, or user
  acceptance is claimed for the representative-file branch.
