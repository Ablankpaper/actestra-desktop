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

| Phase | Outcome | Entry dependency |
| --- | --- | --- |
| P0 | Project foundation | New repository |
| P1 | Reproducible AionUi baseline | P0 |
| P2 | Independent Actestra product shell | P1 |
| P3 | Actestra platform core and contracts | P2 |
| P4 | Native AionUi preservation and Actestra authority fusion | P3 |
| P5 | Goose coding-worker vertical slice | P3, P4 event path |
| P6 | Multi-agent team orchestration | P4, P5 |
| P7 | Security and reliability hardening | P4-P6 |
| P8 | Cross-platform internal beta | P7 |

Current execution state on 2026-07-29: P4.0/F0 and P4.1/F1 are pushed and
exact-implementation CI-backed on Draft pull request 6. P4.2/F2 is implemented
and locally validated: seven bounded native metadata domains project into
separate SQLite schema version 4 shadow evidence without changing native UI or
authoritative P3 tables. Its commit, push, and exact-head CI remain pending.
P4.3/F3 domain authority is the next product slice only after F2 evidence is
recorded; merge and release states remain separate.

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
  cancel, subscribe, and dispose.
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

### Deliverables

- **P4.0 — native baseline:** freeze the exact AionUi source, preserve all
  routes and bridge domains, run the native test/build/launch path, record
  golden screenshots, and establish the R0/R1/R2 retention matrix.
- **P4.1 — identity and isolation:** apply Actestra identity and versioned
  profiles without changing the AionUi layout or removing feature entries;
  isolate upstream account, telemetry, update, feedback, catalog, and other
  unowned external effects while retaining their UI states.
- **P4.2 — compatibility projection:** map native conversation, task, provider,
  workspace, approval, artifact, and runtime shapes to read-only or
  metadata-only P3 shadow projections. ADR-0011 keeps those projections inert,
  main-owned, fail-isolated, and separate from authoritative P3 tables.
- **P4.3 — authoritative general work:** move one functional domain at a time to
  Actestra persistence, policy, approval, audit, artifact, and worker authority
  while keeping AionUi bridge and UI semantics.
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
satisfied and the decision is recorded.
