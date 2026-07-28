# P3 Platform Core and Contracts

Status: P3.1-P3.3 pushed and CI-backed; P3.4 locally validated with commit,
push, and CI pending; P3 remains open

Evidence date: 2026-07-28

Branch: `feat/platform-core-contracts`

Exact base: `main` at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`

Kickoff commit: `30d05747cbaedf0c4901fd47de253e7009fe6643`

Evidence commit: `4afa5531804cfce214cf6c0d204ae21820df3502`

P3.1/P3.2 implementation commit:
`31dd6e4178eb7641b45be0ee2bccb862a96dac99`

P3.3 implementation commit: `4de756984269624a02fbfdf77e558c958a03c2e0`

Review surface:
[draft pull request 3](https://github.com/bignormal/actestra-desktop/pull/3)

P2 entry proof:
[main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)

P3 kickoff proof:
[pull-request CI run 30329899300](https://github.com/bignormal/actestra-desktop/actions/runs/30329899300)

P3.1/P3.2 implementation proof:
[pull-request CI run 30331681309](https://github.com/bignormal/actestra-desktop/actions/runs/30331681309)

P3.3 implementation proof:
[pull-request CI run 30335076556](https://github.com/bignormal/actestra-desktop/actions/runs/30335076556)

## Purpose

P3 creates the Actestra-owned platform vocabulary and authority boundaries that
all later workers must obey. It does not integrate AionUi, Goose, Eigent, or
another real agent runtime.

The phase succeeds only when a deterministic fake worker proves the contracts,
event ordering, approvals, cancellation, crash recovery, and migrations without
giving the renderer privileged authority.

The first implementation slice is governed by
[ADR-0004](../architecture/decisions/0004-core-domain-event-stream.md).
The persistence slice is governed by
[ADR-0005](../architecture/decisions/0005-sqlite-persistence-and-migrations.md).
The worker lifecycle slice is governed by
[ADR-0006](../architecture/decisions/0006-agent-adapter-lifecycle-and-supervision.md).

## Implemented slice

P3.1 through the local P3.4 working tree now provide:

- branded opaque identifiers and canonical UTC timestamps;
- workspace, task, session, worker, approval, and artifact records;
- authoritative lifecycle transition checks and terminal-state helpers;
- aggregate validation for ownership, references, chronology, and approval
  resolution;
- a runtime-validated event schema version 1 with typed payloads;
- per-attempt, gapless event ordering, exact-id idempotency, replay cursors, task
  state coherence, terminal enforcement, and diagnostic redaction;
- a storage-neutral asynchronous persistence port;
- Actestra-owned SQLite domain and event schemas with immutable checksummed
  forward migrations;
- private database placement, fail-closed ownership/version/history checks,
  transactional rollback, domain round-trip, event idempotency/replay, and
  corrupt-projection rejection;
- a validated stream-state cache that keeps repeated appends constant-time
  without weakening sequence, identity, lifecycle, or terminal checks;
- an exact Electron embedded-runtime probe for SQLite options, constraints,
  strict types, and rollback.
- a protocol-versioned `AgentAdapter` with a closed capability vocabulary and
  runtime validation for starts, messages, approvals, and control signals;
- main-owned supervision for readiness, heartbeat, cancellation
  acknowledgement, control/core-event ordering, immutable attempt identity,
  terminal reconciliation, crash, timeout, and bounded fresh-attempt restart;
- a deterministic, explicitly stepped fake adapter with an injected clock and
  no filesystem, network, process, shell, model, credential, or tool authority.

The domain, event, port, and adapter contracts are pure TypeScript under
`apps/desktop/src/core`. The SQLite implementation is main-owned under
`apps/desktop/src/main/persistence`; the supervisor and fake adapter are
main-owned under `apps/desktop/src/main/workers`. None are registered with
application startup, and none grant database, path, SQL, filesystem, process,
shell, tool, or credential authority to preload or renderer.

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

- Implemented and CI-backed: storage-neutral persistence ports.
- Accepted: embedded `node:sqlite` and forward-only migration policy in
  ADR-0005, with no added database dependency.
- Verified locally and in exact-head CI: fresh creation, reopen, real `1 -> 2`
  forward migration,
  incompatible-future and foreign-state rejection, migration-history tampering,
  transactional rollback, invalid database rejection, domain restoration,
  ordered event replay, exact-id idempotency, and corrupt event projection
  rejection.

### P3.4 — Worker adapter and deterministic fake

- Accepted locally: ADR-0006 fixes protocol compatibility, immutable attempt
  identity, control/core-event sequencing, supervision, cancellation, crash,
  and bounded restart semantics.
- Implemented locally: capabilities, start, send, approve, cancel, subscribe,
  and dispose with exact runtime validation.
- Implemented locally: explicit startup, heartbeat, and cancellation
  acknowledgement bounds; fail-closed protocol and identity drift; terminal
  reconciliation; crash; and fresh-identity restart.
- Implemented locally: only a deterministic fake adapter with a controllable
  clock and explicit plans. It performs no real worker or privileged operation.
- Verified locally on the uncommitted P3.4 working tree above
  `6817a384be66d9ffaed990c8777edc2e76eec1a8`: the three new test files pass 22
  protocol and lifecycle tests, and `bun run check` passes all 12 test files
  with 76 tests, exact-runtime, process-failure, boundary, and build checks.
- Not yet committed, pushed, or CI-backed. Real worker adapters remain later
  phase work.

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
- Embedded SQLite ownership, conservative DELETE/FULL connection policy,
  immutable forward migrations, and fail-closed database adoption are accepted
  in
  [ADR-0005](../architecture/decisions/0005-sqlite-persistence-and-migrations.md).
- Agent protocol version 1, immutable attempt identity, independent signal/event
  ordering, observed-time supervision, cancellation, crash, and bounded
  fresh-attempt restart are accepted in
  [ADR-0006](../architecture/decisions/0006-agent-adapter-lifecycle-and-supervision.md).

## Questions that still require explicit decisions

- Which data is audit evidence, and which data must be redacted or never stored?
- How are platform keychains represented behind a testable credential port?
- Which supervisor incidents must become durable audit evidence in P3.6?

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

- P3.1 through the locally implemented P3.4 slice do not complete the P3 exit
  gate.
- No credential backend, policy language, or MCP transport is selected.
- The deterministic fake is protocol test infrastructure, not a real worker.
  No real worker, process transport, persistence-service process, IPC route, or
  renderer worker feature is implemented.
- The SQLite adapter is not part of application startup and is not evidence of
  restart recovery through the packaged UI.
- No real worker or external upstream source is imported.
- No candidate, release, deployment, distribution, or acceptance claim is made.
