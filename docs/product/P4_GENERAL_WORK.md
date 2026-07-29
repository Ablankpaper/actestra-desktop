# P4 General-Work Vertical Slice

Status: GW-P4.2 accepted on `main`; GW-P4.3 implemented and locally validated
on `feat/aionui-p4-general-worker`; push, pull-request CI, merge, and
merged-main CI for GW-P4.3 are pending

Date: 2026-07-30

Exact base:
`8e32882108b10272c1489c1a46a77cede1cc4fb7`

## Entry evidence

The branch starts from the exact `main` squash merge for
[pull request 10](https://github.com/bignormal/actestra-desktop/pull/10).
[Main CI run 30476091907](https://github.com/bignormal/actestra-desktop/actions/runs/30476091907)
passes on that commit.

[ADR-0016](../architecture/decisions/0016-p4-general-work-process-and-content-boundaries.md)
accepts the P4 process, persistence, grant, and content boundaries while
retaining AionUi as the product UI and Actestra Core as the sole authority.

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

Implemented and locally validated on the current branch:

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

Current local evidence:

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

### GW-P4.4 — Scoped native tools and policy

- register only `actestra.workspace.read-text` and
  `actestra.task-output.write-text`;
- derive protected operations from trusted manifests and active attempts;
- enforce canonical grant containment, traversal and symlink rejection,
  UTF-8/size bounds, create-only output, and explicit conflicts; and
- keep shell, network, credentials, MCP, publishing, Git, and arbitrary
  workspace mutation denied.

Exit: success, denial, failure, cancellation, and output-conflict tests prove
no scope or policy bypass.

### GW-P4.5 — Coordination and recovery

- connect tasks, attempts, worker supervision, tool gateway, events, audit,
  content, artifacts, and terminal evidence;
- preserve persist-before-acknowledge and supervisor-release ordering;
- recover after worker, persistence, and application failure with fresh
  identities where required; and
- prove no orphan process or silent-success state remains.

Exit: all non-UI fixtures and recovery paths pass locally and in exact-head CI.

### GW-P4.6 — Preserved-AionUi journey

- map only bounded task intents and projections into the original AionUi
  conversation, workspace, permission, preview, artifact, and status surfaces;
- keep roots, content, references, protected-operation fields, and generic IPC
  outside the renderer; and
- extend packaged clean-profile smoke through restart, denial, and
  cancellation.

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

- GW-P4.3 is locally implemented but is not yet pushed, CI-backed, merged, or
  accepted on `main`.
- The General Worker is a real deterministic process used by the isolated
  probe; it is not yet connected to a user-submitted AionUI task.
- No native filesystem tool, content-consuming task, credential backend,
  model, Goose adapter, CrewAI sidecar, or Team orchestration is active.
- Utility-process separation is not OS sandbox evidence.
- Schema 6 is forward-only; development rollback uses a fresh profile rather
  than deleting or downgrading user state.
- The successful native launch uses the exact local AionCore binary. The frozen
  repository still does not contain an approved distributable AionCore bundle;
  target packaging remains GW-P4.6/P8 work.
- The produced applications are unsigned local builds, not candidates,
  releases, deployments, distributions, or user acceptance.
