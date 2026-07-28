# P3 Platform Core and Contracts

Status: Entry planning only; no P3 implementation

Evidence date: 2026-07-28

Branch: `feat/platform-core-contracts`

Exact base: `main` at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`

P2 entry proof:
[main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)

## Purpose

P3 creates the Actestra-owned platform vocabulary and authority boundaries that
all later workers must obey. It does not integrate AionUi, Goose, Eigent, or
another real agent runtime.

The phase succeeds only when a deterministic fake worker proves the contracts,
event ordering, approvals, cancellation, crash recovery, and migrations without
giving the renderer privileged authority.

## Execution order

### P3.1 — Domain vocabulary

- Define task, session, workspace, worker, approval, event, and artifact
  concepts.
- Keep identifiers, timestamps, state transitions, and ownership explicit.
- Reject invalid transitions and cross-workspace references in unit tests.

### P3.2 — Unified event envelope

- Define a versioned discriminated event envelope.
- Specify ordering, replay, idempotency, terminal-state, and redaction rules.
- Prove deterministic event sequences before adding a persistent transport.

### P3.3 — Persistence and migrations

- Define persistence ports independently of the storage technology.
- Accept a database and migration ADR before adding its dependency.
- Support fresh creation, forward migration, incompatible-future rejection, and
  transactional recovery tests.

### P3.4 — Worker adapter and deterministic fake

- Define capabilities, start, send, approve, cancel, subscribe, and dispose.
- Add heartbeat, timeout, crash, restart, and cancellation semantics.
- Implement only a deterministic fake worker in P3; real worker adapters start
  in later phases.

### P3.5 — Privileged services

- Establish credential broker, policy engine, approval service, MCP/tool
  gateway, and audit trail interfaces.
- Keep secrets out of renderer state, events, logs, fixtures, and snapshots.
- Require policy and approval evidence before any protected operation can run.

### P3.6 — Main/renderer proof

- Register privileged services only in the main-process boundary.
- Expose narrow, typed, intent-level renderer operations.
- Test that direct filesystem, shell, credential, worker, and tool access cannot
  bypass the boundary.

## Questions that require explicit decisions

- Which embedded database and migration mechanism meet rollback and packaging
  needs?
- What ordering scope and replay cursor does the event envelope guarantee?
- Which state transitions are authoritative for tasks, sessions, workers, and
  approvals?
- How are capability manifests versioned and rejected when incompatible?
- Which data is audit evidence, and which data must be redacted or never stored?
- How are platform keychains represented behind a testable credential port?

Answers that constrain multiple components must be recorded as ADRs rather than
silently embedded in implementation code.

## Exit evidence

P3 is not complete until tests prove:

- deterministic lifecycle and event ordering;
- approval grant, denial, expiry, and cancellation behavior;
- heartbeat timeout, crash, restart, and terminal-state reconciliation;
- fresh database creation and supported migration paths;
- fail-closed handling of future or corrupt state;
- audit records for protected decisions without credential leakage;
- renderer inability to bypass the main-process boundary.

The exact source commit and CI run must be recorded in
[Project Status](../PROJECT_STATUS.md) before merge.

## Non-claims

- No domain contract or event schema is implemented by this document.
- No database, migration library, credential backend, policy language, or MCP
  transport is selected.
- No real worker or external upstream source is imported.
- No candidate, release, deployment, distribution, or acceptance claim is made.
