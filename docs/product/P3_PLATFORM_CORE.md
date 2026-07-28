# P3 Platform Core and Contracts

Status: P3.1 domain and P3.2 event contracts pushed and CI-backed; P3 remains open

Evidence date: 2026-07-28

Branch: `feat/platform-core-contracts`

Exact base: `main` at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`

Kickoff commit: `30d05747cbaedf0c4901fd47de253e7009fe6643`

Evidence commit: `4afa5531804cfce214cf6c0d204ae21820df3502`

Implementation commit: `31dd6e4178eb7641b45be0ee2bccb862a96dac99`

Review surface:
[draft pull request 3](https://github.com/bignormal/actestra-desktop/pull/3)

P2 entry proof:
[main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)

P3 kickoff proof:
[pull-request CI run 30329899300](https://github.com/bignormal/actestra-desktop/actions/runs/30329899300)

P3.1/P3.2 implementation proof:
[pull-request CI run 30331681309](https://github.com/bignormal/actestra-desktop/actions/runs/30331681309)

## Purpose

P3 creates the Actestra-owned platform vocabulary and authority boundaries that
all later workers must obey. It does not integrate AionUi, Goose, Eigent, or
another real agent runtime.

The phase succeeds only when a deterministic fake worker proves the contracts,
event ordering, approvals, cancellation, crash recovery, and migrations without
giving the renderer privileged authority.

The first implementation slice is governed by
[ADR-0004](../architecture/decisions/0004-core-domain-event-stream.md).

## Implemented slice

P3.1 and P3.2 now provide:

- branded opaque identifiers and canonical UTC timestamps;
- workspace, task, session, worker, approval, and artifact records;
- authoritative lifecycle transition checks and terminal-state helpers;
- aggregate validation for ownership, references, chronology, and approval
  resolution;
- a runtime-validated event schema version 1 with typed payloads;
- per-attempt, gapless event ordering, exact-id idempotency, replay cursors, task
  state coherence, terminal enforcement, and diagnostic redaction.

The implementation is pure TypeScript under `apps/desktop/src/core`. It does not
have Electron, database, renderer, preload, worker, filesystem, shell, network,
or credential authority.

## Execution order

### P3.1 — Domain vocabulary

- Implemented: task, session, workspace, worker, approval, event, and artifact
  concepts.
- Implemented: explicit identifiers, timestamps, state transitions, and
  ownership.
- Verified locally and in CI: invalid transitions and cross-workspace references
  fail in unit tests.

### P3.2 — Unified event envelope

- Implemented: versioned discriminated event envelope.
- Implemented: ordering, replay, idempotency, terminal-state, and redaction
  rules.
- Verified locally and in CI: deterministic sequences fail closed on gaps, conflicts,
  identity drift, timestamp regression, state mismatch, invalid cursors, and
  writes after a terminal event.

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

## Accepted decisions

- Domain ownership, authoritative lifecycle transitions, per-attempt event
  ordering, replay cursors, idempotency, terminal behavior, and redaction are
  accepted in
  [ADR-0004](../architecture/decisions/0004-core-domain-event-stream.md).

## Questions that still require explicit decisions

- Which embedded database and migration mechanism meet rollback and packaging
  needs?
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

- P3.1 and P3.2 do not complete the P3 exit gate.
- No database, migration library, credential backend, policy language, or MCP
  transport is selected.
- No fake or real worker, process transport, persistence adapter, IPC route, or
  renderer feature is implemented.
- No real worker or external upstream source is imported.
- No candidate, release, deployment, distribution, or acceptance claim is made.
