# P3 Platform Core and Contracts

Status: P3.1-P3.5 pushed and CI-backed; P3.6 locally validated; exact CI pending; P3 remains open

Evidence date: 2026-07-28

Branch: `feat/platform-core-contracts`

Exact base: `main` at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`

Kickoff commit: `30d05747cbaedf0c4901fd47de253e7009fe6643`

Evidence commit: `4afa5531804cfce214cf6c0d204ae21820df3502`

P3.1/P3.2 implementation commit:
`31dd6e4178eb7641b45be0ee2bccb862a96dac99`

P3.3 implementation commit: `4de756984269624a02fbfdf77e558c958a03c2e0`

P3.4 implementation commit: `2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b`

P3.5 implementation commit: `cec0cdc554656c021cdff7f2341ddd3f9b5d83dd`

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

P3.4 implementation proof:
[pull-request CI run 30339662937](https://github.com/bignormal/actestra-desktop/actions/runs/30339662937)

P3.5 implementation proof:
[pull-request CI run 30345370507](https://github.com/bignormal/actestra-desktop/actions/runs/30345370507)

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
The privileged-service slice is governed by
[ADR-0007](../architecture/decisions/0007-privileged-service-authorization.md).
The main integration and projection slice is governed by
[ADR-0008](../architecture/decisions/0008-main-owned-projection-and-ipc.md).

## Implemented slice

P3.1 through P3.5 now provide:

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
- closed version-1 protected-operation, policy, tool-manifest, approval,
  authorization, credential-lease, audit, executor, and gateway contracts;
- an immutable policy evaluator with no-match denial and conservative
  deny-over-approval-over-allow precedence;
- exact, expiring, one-shot approval evidence bound to the full operation and
  policy revision;
- a reference-only credential broker that emits short-lived opaque leases and
  contains no secret backend;
- a gapless, immutable, metadata-only in-memory audit trail;
- a deterministic main-owned gateway that snapshots asynchronous inputs,
  verifies a tool capability manifest, requires pre-execution audit evidence,
  sanitizes executor failures, releases leases, and marks post-call uncertainty.

The domain, event, port, and adapter contracts are pure TypeScript under
`apps/desktop/src/core`. The SQLite implementation is main-owned under
`apps/desktop/src/main/persistence`; the supervisor and fake adapter are
main-owned under `apps/desktop/src/main/workers`; the deterministic P3.5
services are main-owned under `apps/desktop/src/main/privileged`. None are
registered with application startup, and none grant database, path, SQL,
filesystem, process, shell, tool, or credential authority to preload or
renderer.

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

- Accepted and CI-backed: ADR-0006 fixes protocol compatibility, immutable attempt
  identity, control/core-event sequencing, supervision, cancellation, crash,
  and bounded restart semantics.
- Implemented and CI-backed: capabilities, start, send, approve, cancel, subscribe,
  and dispose with exact runtime validation.
- Implemented and CI-backed: explicit startup, heartbeat, and cancellation
  acknowledgement bounds; fail-closed protocol and identity drift; terminal
  reconciliation; crash; and fresh-identity restart.
- Implemented and CI-backed: only a deterministic fake adapter with a controllable
  clock and explicit plans. It performs no real worker or privileged operation.
- Verified locally and in exact implementation CI at
  `2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b`: the three new test files pass 22
  protocol and lifecycle tests, and the complete gate passes all 12 test files
  with 76 tests, exact-runtime, process-failure, documentation, boundary,
  unsigned bundle, packaged identity, and clean-profile smoke checks.
- Real worker adapters remain later phase work.

### P3.5 — Privileged services

- Accepted and CI-backed: ADR-0007 fixes the version-1 protected-operation and
  tool-capability-manifest boundary, conservative policy rule lattice, exact
  approval evidence, opaque credential leases, metadata-only audit vocabulary,
  and fixed gateway order.
- Implemented and CI-backed: credential broker, policy engine, approval service,
  MCP/native-tool-neutral executor and gateway, and audit trail interfaces with
  runtime-closed shapes.
- Implemented and CI-backed: immutable asynchronous snapshots, no-match denial,
  deny precedence, normalized instant ordering, finite approval expiry, exact
  operation and policy binding, concurrent creation reservation, one-shot
  consumption claims with audit rollback, manifest drift rejection, credential
  lease mutation serialization, bounded history, rollback/release/expiry
  cleanup, pre-execution audit failure closure, sanitized executor failures, and
  explicit post-call uncertainty.
- Verified locally and in exact implementation CI at
  `cec0cdc554656c021cdff7f2341ddd3f9b5d83dd`: two focused files pass 27 tests,
  and the complete gate passes 14 test files with 103 tests, exact-runtime,
  process-failure, documentation, boundary, unsigned bundle, packaged identity,
  and clean-profile smoke checks. Local coverage passes at 84.00% statements,
  76.75% branches, and 95.18% functions overall;
  `core/privilegedServices.ts` has 93.96% statement coverage and
  `main/privileged` has 84.04%.
- Kept absent: secret values, a keychain backend, production policy snapshot,
  raw tool arguments, input-reference storage, a real executor or transport,
  startup registration, preload IPC, renderer operations, and upstream source.

### P3.6 — Main/renderer proof

- Accepted locally: ADR-0008 fixes main-owned startup composition, SQLite
  version 3 platform evidence, terminal-attempt release order, trusted-frame
  IPC, and bounded metadata-only renderer projection.
- Implemented locally: application startup opens the owned SQLite store and
  registers durable audit, no-rule policy, approval, reference-only credential,
  disabled-executor, and gateway services only in main.
- Implemented locally: preload exposes exactly three frozen operations on fixed
  channels. Main accepts zero-argument calls only from the current main frame;
  runtime validators reject extra response fields and unsupported values.
- Implemented locally: privileged audit allocates gapless sequence in the write
  transaction and resumes after restart. Terminal attempt projection persists
  core events, then immutable metadata evidence, then crosses the supervisor
  release barrier; partial writes remain retryable.
- Verified locally: 24 test files pass 129 tests; the boundary scanner checks 34
  source files and rejects renderer Node, Electron, CommonJS, process, and
  direct network clients plus privileged preload primitives. The unsigned
  packaged app reaches application, window, and renderer-ready markers from an
  isolated profile with SQLite v3 active.
- Kept absent: generic IPC, protected-operation payloads from renderer, raw
  audit or event content in renderer, real policy, secret storage, input
  references, worker process, tool manifest, executor, or transport.

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
- Protected-operation version 1, capability-manifest validation, conservative
  policy evaluation, exact one-shot approval evidence, opaque credential
  leases, metadata-only audit, and fixed gateway order are accepted in
  [ADR-0007](../architecture/decisions/0007-privileged-service-authorization.md).
- Main-owned composition, durable metadata-only platform evidence,
  persist-before-release ordering, trusted-frame zero-argument IPC, and bounded
  renderer projection are accepted in
  [ADR-0008](../architecture/decisions/0008-main-owned-projection-and-ipc.md).

## Questions that still require explicit decisions

- Which operating-system secure-storage implementation backs opaque credential
  references on each supported platform?
- How does main-owned input-reference storage connect a real transport without
  admitting raw arguments into audit or renderer state?
- When does synchronous SQLite move from main to a supervised persistence
  utility before user-workload writes are enabled?

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

The local implementation exercises every exit item, but P3 is not accepted
until the exact source commit and CI run are recorded in
[Project Status](../PROJECT_STATUS.md) and the Draft receives final review.

## Non-claims

- P3.1 through P3.5 are CI-backed; P3.6 is local-only until its exact commit and
  CI run are recorded.
- No credential backend, production policy snapshot, input-reference store, or
  MCP/native transport is selected.
- The deterministic fake is protocol test infrastructure, not a real worker.
  No real worker, process transport, persistence-service process, IPC route, or
  renderer worker feature is implemented.
- SQLite v3 and the inert platform composition now start in main, but
  synchronous user-workload persistence still requires a supervised utility.
- The registered executor is deliberately disabled. Approval, lease, and policy
  state remains in memory; only metadata audit and terminal attempt evidence is
  durable.
- No real worker or external upstream source is imported.
- No candidate, release, deployment, distribution, or acceptance claim is made.
