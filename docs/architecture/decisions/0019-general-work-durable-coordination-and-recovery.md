# ADR-0019: Persist General Work Before Acknowledgement and Release

- Status: Accepted
- Date: 2026-07-30
- Clarifies:
  [ADR-0004](0004-core-domain-event-stream.md),
  [ADR-0005](0005-sqlite-persistence-and-migrations.md),
  [ADR-0006](0006-agent-adapter-lifecycle-and-supervision.md),
  [ADR-0007](0007-privileged-service-authorization.md),
  [ADR-0010](0010-aionui-first-product-foundation.md),
  [ADR-0016](0016-p4-general-work-process-and-content-boundaries.md),
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md), and
  [ADR-0018](0018-scoped-native-text-tools-and-policy.md)

## Context

GW-P4.2 made Actestra persistence, workspace grants, and bounded content
references durable. GW-P4.3 added a supervised General Worker process and
Adapter v2. GW-P4.4 admitted two scoped native text tools. Those slices did
not yet make a complete attempt recoverable across failures between tool
execution, worker acknowledgement, artifact creation, event persistence,
terminal evidence, domain reconciliation, and supervisor release.

A create-only output can exist before its opaque reference or artifact
projection is durable. A tool result can be known to main before the worker
acknowledges it. A worker can terminate before normalized events and attempt
evidence are committed. Re-executing any such request blindly could create a
second effect or erase evidence of an uncertain first effect.

The preserved AionUI application remains the only product UI. GW-P4.5 may add
main-process coordination and startup recovery, but it must not add a renderer
route, alternate task model, Goose worker, CrewAI sidecar, Eigent runtime, or
second product state authority.

## Decision

### Revisioned recovery journal

SQLite schema version 7 adds `general_work_checkpoints`. One row is keyed by
the immutable session ID and contains:

- exact workspace, task, correlation, session, worker, and event-stream
  identity;
- a bounded canonical Core event window and an optional verified resume
  baseline;
- the supervised attempt snapshot and cleanup evidence;
- one optional tool checkpoint with explicit `mayHaveExecuted`;
- one optional file-artifact intent that captures the active workspace-grant
  identity before execution, plus its exact-owner output-reference binding;
  and
- phase `active`, `terminal-pending`, or `finalized`, with an exact monotonic
  revision.

Updates use a compare-and-swap revision and an append-only contract. Retained
events cannot be removed or rewritten. Before the window advances, its evicted
prefix is appended idempotently to the normalized event store; only then may a
baseline containing the last evicted event sequence and projected Task state
advance through already durable events. Before terminal reconciliation,
Actestra replays the authoritative event store, requires that baseline to be
present with the same projected state, rejects a stream ahead of the
checkpoint, and requires an exact `artifact.created` event for every binding.
Attempt progress cannot move backwards. Tool identity and terminal outcomes,
artifact intent, grant identity, artifact binding, incident, cancellation
evidence, and replacement lineage cannot be rewritten after commitment. Exact
duplicates are idempotent; stale or conflicting updates fail closed.

At most 100 non-finalized checkpoints may exist. Both admission and startup
recovery enforce that bound so corrupt or unexpectedly large recovery work
cannot produce unbounded startup latency or memory use.

The table has no foreign keys. A recovery checkpoint must remain readable
while the authoritative domain graph is being reconciled from an interrupted
transition.

### Persist before tool acknowledgement

Before the gateway executes a scoped tool, main resolves the active workspace
grant and stores it with the `in-flight` checkpoint and file-artifact intent.
The executor must resolve the same owner through the input reference; grant
rotation therefore fails before mutation instead of rebinding an output after
the effect. Create-only output starts conservatively with
`mayHaveExecuted: true`; a live cancellation that proves no mutation may
resolve that uncertainty to `false`.

The gateway result is retained in main memory before the persistence barrier.
If the barrier fails, a retry reuses that exact terminal result and reruns only
the barrier and Adapter resolution. It never invokes the tool gateway again.
If the retained result is unavailable, an already checkpointed request fails
closed and is recovered as interrupted instead of being re-executed.

A successful task-output result is acknowledged only after main:

1. resolves the exact output reference and owner without consuming it;
2. persists the terminal tool checkpoint, artifact binding, and
   `artifact.created` event; and
3. synchronizes that authoritative event into the Adapter/Supervisor stream.

Generated and injected events share one duplicate-ID set. Missing,
duplicated, reordered, or unprojected authoritative events make the attempt
`protocol-failed` and start cleanup.

### Persist before terminal release

Terminal processing is ordered:

1. complete Adapter listener and process cleanup;
2. persist `terminal-pending`;
3. replay the authoritative event history and verify any resume baseline and
   exact artifact event;
4. revalidate any artifact content reference and owner;
5. reconcile authoritative Task, Session, Worker, and Artifact records;
6. append the retained normalized event window idempotently; any evicted
   prefix is already durable before its recovery baseline advances;
7. append immutable terminal-attempt evidence;
8. persist `finalized`; and
9. release the in-memory Supervisor record and retained tool result.

Terminal release is serialized per persistence-utility client. This prevents
two General Work coordinators from loading the same DomainGraph snapshot and
overwriting each other's Task, Session, Worker, or Artifact reconciliation.

An exception before `finalized` leaves the checkpoint recoverable. Unsubscribe
or process-dispose failures are recorded as incidents without preventing the
remaining cleanup path.

### Startup recovery and fresh attempts

Startup recovery runs after the schema version 7 persistence utility and
scoped native tool platform are ready, and before the preserved AionUI window
is created.

`terminal-pending` checkpoints resume the idempotent release sequence. An
`active` checkpoint is never resumed as the same opaque worker attempt.
Recovery appends an explicit application-restart failure or cancellation,
preserves tool execution ambiguity, completes cleanup evidence, reconciles the
domain graph, and finalizes the checkpoint. Further work requires fresh
session, worker, stream, and process identity under the accepted restart
rules.

Corrupt identity, artifact conflict, unavailable owned content, unknown
protocol, or failed recovery isolates Actestra Core services and reports a
bounded startup failure. It does not silently mark the task successful or
fall back to a second authority.

### AionUI preservation and rollback

Downstream patch `0009-actestra-general-work-recovery.mjs` invokes the same
reviewed coordinator from the existing AionUI main-process persistence
initialization. No renderer, route, preload operation, functional entry,
native AionCore response, or native profile changes.

Source rollback regenerates without patch 0009. Schema version 7 rows remain
inert; a true data downgrade uses a fresh Actestra profile. The frozen AionUI
foundation and native AionUI profiles are not rewritten.

## Consequences

### Positive

- Tool execution, artifact ownership, normalized events, domain state,
  terminal evidence, and cleanup now share one recoverable Actestra sequence.
- A persistence-barrier retry cannot execute a create-only tool twice.
- Ambiguous post-effect failures remain explicit instead of becoming false
  success or safe-to-retry claims.
- Application restart produces deterministic terminal evidence and requires
  fresh worker identity.
- AionUI remains the sole product surface while Actestra Core remains the sole
  authority.

### Costs

- The first vertical slice supports one bounded tool request and artifact
  binding per deterministic attempt.
- Recovery is fail-closed and may keep Actestra work unavailable until corrupt
  or conflicting state is repaired.
- Schema version 7 is forward-only.
- Language-level supervision and utility-process separation are not an
  operating-system sandbox.

## Rejected alternatives

### Acknowledge the worker before checkpoint persistence

Rejected because a crash could leave an executed effect known only to a
disposable worker session.

### Retry the tool after a persistence barrier fails

Rejected because create-only output and future non-idempotent tools may already
have executed.

### Use the worker or AionCore session as the recovery record

Rejected because external runtime state is disposable compatibility state and
cannot replace Actestra task, permission, event, artifact, or audit authority.

### Keep recovery only in Electron main memory

Rejected because application and utility-process restart must not erase the
execution boundary.

### Add a recovery-specific UI

Rejected because recovery status must later project through preserved AionUI
conversation, status, artifact, and Team surfaces in GW-P4.6.

## Review triggers

Review this decision if:

- an attempt must execute multiple or parallel tool requests;
- streaming or partial artifacts require incremental bindings;
- a tool has a provider-supported idempotency key that changes retry safety;
- the checkpoint cap or startup recovery latency becomes material;
- domain and event persistence move into one transactional store;
- OS sandboxing or brokered file handles change the process boundary; or
- the preserved AionUI journey needs a new projection contract in GW-P4.6.
