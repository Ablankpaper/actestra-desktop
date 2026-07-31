# Development Sequence

This roadmap defines order and phase gates. It is not a claim that planned
features are implemented.

## Principles

- Prove the unmodified foundation before refactoring it.
- Preserve AionUi functions and functional UI by default; swap providers behind
  compatibility seams instead of redrawing or deleting workflows.
- Establish one product source of truth before adding external workers.
- Integrate one vertical slice at a time.
- Add orchestration only after individual workers have stable lifecycle and
  event contracts.
- Treat security, packaging, and acceptance as engineering deliverables.
- Keep local validation, push, CI, candidate, release, and acceptance distinct.

## Phase summary

| Phase | Outcome                                                  | Entry dependency  |
| ----- | -------------------------------------------------------- | ----------------- |
| P0    | Project foundation                                       | New repository    |
| P1    | Reproducible AionUi baseline                             | P0                |
| P2    | Independent Actestra product shell                       | P1                |
| P3    | Actestra platform core and contracts                     | P2                |
| P4    | Native AionUi preservation and Actestra authority fusion | P3                |
| P5    | Goose coding-worker vertical slice                       | P3, P4 event path |
| P6    | Multi-agent team orchestration                           | P4, P5            |
| P7    | Security and reliability hardening                       | P4-P6             |
| P8    | Cross-platform internal beta                             | P7                |

Current execution state on 2026-08-01: native-fusion slices F0 through F3.3,
general-work through GW-P4.6, and the representative workspace-file, bounded
local-research, writing, Office-document, and schedule extensions are accepted
on `main`. Office reached exact final PR head
`091f786d57c6b4569cdaac17ea969a0b9070ea02`, passed PR CI run 30602624426,
squash merged as `505afb2f3916e75c7abb07cdf461bda29a602b9b`, and passed
exact merged-main CI run 30602821085. Its 50-file/338-test root gate,
343-file/2,644-test native gate, final production build, Apple
Development-signed unnotarized local arm64 package, and schema-12 target-app
Office/file/research/writing/denial/cancellation smoke remain separate local
evidence. The Ready PR's Free-plan CodeRabbit output contains only a summary
and walkthrough, with no submitted review or inline comment, so it is not
represented as line-level review evidence.

ADR-0023's independent schedule slice is implemented and pushed from exact
verified main `505afb2f3916e75c7abb07cdf461bda29a602b9b`. It retains the
native `/scheduled` routes, dialog, detail/history, status, CRUD, pause,
run-now, and event surfaces while moving bounded existing-conversation jobs,
schema-13 grants and claims, timing, missed/interrupted recovery, and General
Work execution into Actestra main/Core. The pre-review 56-file/414-test root
gate, 345-file/2,658-test native gate, production build, Apple Development-
signed unnotarized arm64 package, and actual schema-13 target-app smoke are
diagnostic baseline evidence only; review remediation changed production bytes.
The third 50-file CodeRabbit confirmation raised four issues (three Major, one
Minor): the two valid documentation corrections are applied, while the empty
manual cron and explicit unsupported Skill suggestions are rejected by
ADR-0023. The fourth confirmation raised three issues (one Major, two Minor):
the valid protocol negative test and status correction are applied; the request
for a pre-existing Actestra workspace registry or Git worktree allowlist is
rejected because ADR-0020 makes validated native selection the initial
authority, ADR-0023 captures it atomically as a canonical grant, and coding
worktrees remain P5. Two follow-up confirmations were then rate-limited before
analysis (first with a 3-minute wait, then 31 seconds), so they are not
zero-issue evidence; the final manual 51-file review includes the later
Node-free schedule contract split and found no additional confirmed defect.
Final-byte validation now passes 56 root files/424 tests, 345 native files/2,658
tests, strict native TypeScript, the 607/24/10,184-module native production
build, a newly built Apple Development-signed unnotarized arm64 package, exact
package/ASAR/resource checks, and actual schema-13 target-app smoke. Ready PR 20
reached initial head `70b11992f4de015e0952d482a126cd1270208aa8`; CI run
30657973409 exposed that CI packaged the legacy root output rather than the
target native app. Focused workflow TDD produced exact final head
`c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`; PR CI 30659567604 passes the full
native package and clean-profile smoke path. PR 20 squash merged as
`5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and exact merged-main CI
30660078199 passes. Its remote CodeRabbit output is a rate-limited summary, not
line-level review evidence. Representative tool-failure and Worker-crash gates
remain; P5 Goose and P6 CrewAI/Team work have not started.

## P0 — Project Foundation

### Deliverables

- Repository, documentation index, product scope, architecture decisions, Git
  workflow, and upstream policy.
- Explicit separation from Aera and other local products.
- Evidence-based project status.

### Exit gate

- Bootstrap files are reviewed, committed, and available on the remote default
  branch.

## P1 — Reproducible Upstream Baseline

### Deliverables

- Pin one exact AionUi tag and commit.
- Build and run the unmodified source on macOS.
- Run the upstream test suites.
- Produce an unsigned local desktop package.
- Inventory licenses, NOTICE files, assets, bundled runtimes, telemetry, update
  endpoints, configuration stores, and external services.
- Create a module map: keep, wrap, replace, remove, or defer.
- Record all commands and required tool versions.

### Exit gate

- A second clean checkout repeats install, launch, tests, and package generation.
- Evidence and upstream revision are recorded in the repository.
- No Actestra feature work is mixed into the baseline proof.

## P2 — Independent Actestra Product Shell

### Deliverables

- Replace external branding, identifiers, icons, deep links, update endpoints,
  telemetry endpoints, and default service names.
- Establish Actestra-owned application directories and migration versioning.
- Disable unsafe automatic approval behavior.
- Separate renderer, main process, privileged services, and worker processes.
- Add a first-run flow that works without Aera or upstream accounts.

### Exit gate

- A clean profile launches as Actestra with no upstream or Aera brand, account,
  endpoint, data-path, or update dependency except documented third-party
  components.
- Packaging and smoke tests remain green.

## P3 — Platform Core and Contracts

### Deliverables

- Define task, session, workspace, worker, approval, event, and artifact models.
- Implement the `AgentAdapter` lifecycle: capabilities, start, send, approve,
  typed tool resolution, cancel, subscribe, and dispose.
- Implement a versioned unified event envelope.
- Establish Actestra-owned persistence and migrations.
- Establish credential broker, policy engine, approval service, MCP/tool gateway,
  and audit trail.
- Add worker heartbeat, timeout, crash, restart, and cancellation semantics.

### Exit gate

- A deterministic fake worker passes lifecycle, event ordering, approval,
  cancellation, crash recovery, and migration tests.
- Renderer tests prove privileged operations cannot bypass the main-process
  boundary.

## P4 — Native AionUi Preservation and Actestra Fusion

The `F` labels below are the native-fusion track already used by F0 through
F3.3. The `GW-P4.n` labels are the separate ordered general-work execution
track. The `GW` prefix is mandatory in cross-track status text so, for example,
GW-P4.3 General Worker cannot be confused with the historical F3.1 authority
slice previously described as P4.3/F3.1.

### Deliverables

- **F0 — native baseline:** freeze the exact AionUi source, preserve all
  routes and bridge domains, run the native test/build/launch path, record
  golden screenshots, and establish the R0/R1/R2 retention matrix.
- **F1 — identity and isolation:** apply Actestra identity and versioned
  profiles without changing the AionUi layout or removing feature entries;
  isolate upstream account, telemetry, update, feedback, catalog, and other
  unowned external effects while retaining their UI states.
- **F2 — compatibility projection:** map native conversation, task, provider,
  workspace, approval, artifact, and runtime shapes to read-only or
  metadata-only P3 shadow projections. ADR-0011 keeps those projections inert,
  main-owned, fail-isolated, and separate from authoritative P3 tables.
- **F3 — narrow native authority:** move one functional domain at a time to
  Actestra persistence, policy, approval, audit, artifact, and worker authority
  while keeping AionUi bridge and UI semantics.
  - **F3.1 — approval response and delivery:** reserve the immutable desktop
    confirmation response before native delivery, reconcile uncertain attempts
    on retry and restart, retain structured native errors, and provide an
    explicit native rollback. Pending-request creation, provider semantics,
    policy and approval for the underlying protected operation, and that
    operation's execution remain future slices.
  - **F3.2 — approval delivery policy and audit:** represent only delivery of
    the persisted response as one fixed loopback `network.request`; validate an
    exact capability manifest, evaluate one exact policy rule, and persist
    policy, start, and outcome audit before acknowledging delivery. Do not
    infer or authorize the underlying native tool, and retain an explicit F3.1
    rollback.
  - **F3.3 — approval reconciliation policy and audit:** gate only the bounded
    loopback pending-state read used after an ambiguous attempt and during
    restart. Reduce the native list to an in-memory boolean before the gateway
    consumes it; persist only metadata policy/start/outcome audit, keep native
    request creation and content authoritative in AionCore, and retain an
    explicit rollback of the read to F3.1 while retaining F3.2 delivery.
- **GW-P4.2 — general-work persistence foundation:** move schemas 1 through 5 and
  all P3/F2/F3 persistence operations behind a dedicated utility process; add
  schema version 6 workspace grants and immutable, bounded UTF-8 content
  references; prove that SQLite is unreachable from Electron main. Preserve
  the complete AionUi application and expose an explicit compatibility
  unavailable state if the utility cannot start.
- **GW-P4.3 — General Worker and Adapter v2:** launch one deterministic real worker
  process, negotiate its exact protocol and capabilities, add typed tool-result
  resolution, and prove timeout, malformed-message, stale-attempt, crash,
  cancellation, and cleanup behavior.
- **GW-P4.4 — scoped native tools and policy:** admit only bounded workspace
  text-read and create-only task-output write capabilities through trusted
  manifests, workspace grants, deny-by-default policy, and durable audit.
- **GW-P4.5 — coordination and recovery:** connect task/attempt state, worker
  supervision, tools, normalized events, content, artifacts, cancellation,
  terminal evidence, and restart recovery without orphan processes or silent
  success.
- **GW-P4.6 — preserved-AionUi journey:** map the completed general-work flow into
  original AionUi conversation, workspace, permission, preview, artifact, and
  status surfaces through bounded intents and projections; extend target-app
  packaged smoke through restart, denial, and cancellation. The first vertical
  slice uses one explicit bounded text intent, schema-version-8 atomic
  journey/grant/content registration, a real supervised General Worker,
  redacted status and Artifact projections, non-persisted native Preview, and
  prepared-task startup recovery. The representative-file extension adds one
  closed `/actestra file` intent, schema-version-9 kind persistence, a fixed
  main-owned `actestra-input.txt` read bounded to the Worker's 64 KiB transport,
  private same-Worker processing, stable oversized-input failure, and one
  create-only Artifact. The local-research extension adds one closed
  `/actestra research` intent, schema-version-10 kind persistence, the fixed
  main-owned `actestra-research.txt` source, private deterministic
  same-Worker evidence processing, and one create-only `research.md` file
  Artifact. The writing extension adds one closed `/actestra write` intent,
  schema-version-11 kind persistence, prompt-only registration, private
  Worker-authored `draft.md` content persisted by main before create-only
  output, and one `document` Artifact. The Office extension adds one closed
  `/actestra office` intent, schema-version-12 kind and Preview-media
  persistence, a private Worker-authored document model persisted by main, one
  exact create-only Office tool that generates fixed `brief.docx`, and an
  owned `document` Artifact rendered through the retained Word Preview without
  exposing paths or package bytes. These extensions add no generic local or
  network research, renderer-selected paths, or another UI. Office has exact
  merged-main evidence. ADR-0023 retains the native cron surface while
  adding schema-13 Actestra schedule authority, main-owned timers and atomic
  claims, skipped missed runs, interrupted-run recovery, and bounded
  existing-conversation General Work execution. Its pre-review local
  implementation and target-app smoke passed; the first formal 50-file review
  raised 12 issues and the valid concerns now pass focused remediation tests,
  lint, and strict TypeScript. Complete final-byte root/native gates, package,
  package audits, target-app smoke, and manual review closure now pass locally.
  Ready PR 20's initial CI exposed a wrong-package path; the focused remediation
  reached final head `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, passed PR CI
  30659567604, squash merged as `5b0748af674165f9e9475be61dc1e02a1b08c8bc`,
  and passed merged-main CI 30660078199. The phase exit gate remains pending
  until representative tool-failure and Worker-crash smokes pass.
- Support scoped workspace reads and task-output writes through the preserved
  file, workspace, conversation, preview, and artifact surfaces.
- Add representative file, research, writing, office-document, schedule,
  denial, cancellation, crash, and conflict fixtures.

### Exit gate

- The native AionUi retention contract passes with no unexplained missing route,
  bridge domain, functional entry, or user-visible behavior.
- A clean profile launches with Actestra identity and no unapproved upstream
  account, endpoint, telemetry, updater, or public listener effect.
- The general-work core journey completes end to end after restart with
  Actestra declared as the system of record for every fused domain.
- Permission denial, cancellation, tool failure, and artifact conflict paths are
  covered.

## P5 — Goose Coding-Worker Vertical Slice

### Deliverables

- Pin an exact Goose revision or compatible published interface.
- Launch Goose outside the renderer through a dedicated adapter.
- Register Goose through the preserved AionUi agent settings, selector, repair,
  ACP conversation, permission, terminal, diff, and test experience; do not add
  a separate Goose application UI.
- Create an isolated Git worktree per coding task.
- Translate Goose messages, tool requests, commands, diffs, tests, and approvals
  into Actestra events.
- Add version detection and fail-closed compatibility checks.
- Clean up workers and worktrees after completion, failure, and cancellation.

### Exit gate

- A repository fixture can be modified, tested, reviewed, and cancelled without
  writing to the source checkout or bypassing approvals.
- Unsupported Goose versions fail with a clear, non-destructive error.

## P6 — Multi-Agent Team Orchestration

### Deliverables

- Leader planning with bounded task decomposition.
- Keep an Actestra-owned TeamOrchestrator as the only authoritative dependency,
  attempt, budget, approval, artifact, cancellation, and recovery state
  machine.
- Evaluate CrewAI as a separately supervised planner, replanner, and result
  aggregation sidecar under ADR-0015. Validate every returned plan before it
  becomes authoritative or schedulable.
- Map orchestration into the preserved AionUi Team creation, navigation, chat,
  task/slot, worker-status, messaging, pause, cancel, rename, pin, and recovery
  experience; do not add a separate Eigent application UI.
- Dependency graph and ready/running/blocked/completed/failed/cancelled states.
- Parallel general and coding workers.
- Shared artifact references without shared uncontrolled working directories.
- Pause, retry, replace worker, manual handoff, and result aggregation.
- Approval nodes that block downstream work until resolved.

### Exit gate

- A representative mixed general-and-code fixture completes deterministically.
- Dependency, partial failure, retry, cancellation, and aggregation tests pass.
- The UI can explain what each worker is doing and why it is blocked.
- CrewAI crash, cancellation, restart, or version mismatch leaves the Actestra
  graph recoverable and creates no orphan process or worker.

## P7 — Security and Reliability Hardening

### Deliverables

- Threat model and abuse-case suite.
- Filesystem, shell, network, credential, MCP, and inter-process boundaries.
- Platform sandbox strategy and least-privilege defaults.
- Signed worker manifests or equivalent integrity checks.
- Resource limits, audit retention, redaction, and diagnostic export.
- Database backup, migration rollback, and crash-recovery tests.

### Exit gate

- Security review has no unresolved release-blocking findings.
- Protected actions cannot execute without policy and approval evidence.
- Recovery tests prove no orphaned privileged process or unreconciled task state.

## P8 — Cross-Platform Internal Beta

### Deliverables

- macOS, Windows, and Linux build and smoke matrices.
- Signing, notarization where applicable, update metadata, and rollback plan.
- SBOM, checksums, provenance, license and NOTICE bundle.
- Clean-machine install, upgrade, uninstall, and fresh-profile acceptance.
- Internal beta runbook and issue intake.

### Exit gate

- Exact source commits map to verified candidate artifacts.
- Platform-specific install and primary journey evidence is recorded.
- Candidate, release, deployment or distribution, and user acceptance are
  reported as separate states.

## Work sequencing rule

A later phase may run a time-boxed spike before the previous gate closes, but
spike code cannot become production architecture until its dependency gate is
satisfied and the decision is recorded. ADR-0015 permits a bounded CrewAI
protocol spike before P6, but it cannot change product authority or count as P6
implementation.
