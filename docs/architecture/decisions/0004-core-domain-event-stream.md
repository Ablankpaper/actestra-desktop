# ADR-0004: Core Domain and Per-Attempt Event Streams

- Status: Accepted
- Date: 2026-07-28

## Context

Actestra must own task and execution state before it integrates any external
worker. If identifiers, lifecycle transitions, ordering, replay, or redaction
are left to individual adapters, the product would acquire several competing
sources of truth and could not reconcile approval, cancellation, recovery, or
audit behavior consistently.

P3 also needs deterministic contract tests before a storage backend or process
transport is selected. The contract therefore cannot depend on Electron, a
database, or a worker-native session format.

## Decision

Actestra defines a runtime-neutral core contract in
`apps/desktop/src/core`. It owns the following records:

- a `Workspace` is the ownership boundary;
- a `Task` belongs to one workspace and may identify one active session while
  retaining historical sessions;
- a `Worker` is one workspace-scoped execution process;
- a `Session` connects one task to one worker in the same workspace;
- an `Approval` belongs to one task and session in that workspace;
- an `Artifact` belongs to one task and may identify its producing session.

All identifiers are typed, opaque, non-empty strings. All timestamps use
canonical UTC ISO-8601 form. Runtime graph validation rejects missing,
duplicated, mismatched, or cross-workspace references and timestamps that move
backwards.

### Authoritative lifecycle transitions

The core rejects same-state rewrites and any transition out of a terminal
state.

| Record | Allowed transitions |
| --- | --- |
| Workspace | `active -> archived` |
| Task | `draft -> ready/cancelled`; `ready -> running/failed/cancelled`; `running -> blocked/completed/failed/cancelled`; `blocked -> running/completed/failed/cancelled` |
| Session | `created -> starting/cancelled`; `starting -> running/failed/cancelled`; `running -> blocked/completed/failed/cancelled`; `blocked -> running/completed/failed/cancelled` |
| Worker | `created -> starting/stopped`; `starting -> ready/stopping/crashed`; `ready -> busy/stopping/crashed`; `busy -> ready/stopping/crashed`; `stopping -> stopped/crashed` |
| Approval | `pending -> approved/denied/expired/cancelled` |

Task terminal states are `completed`, `failed`, and `cancelled`. Session terminal
states are `completed`, `failed`, and `cancelled`. Worker terminal states are
`stopped` and `crashed`. Every approval decision is terminal, and a terminal
approval must have a resolution timestamp.

### Event stream boundary

Core event schema version 1 uses a discriminated envelope with:

- event, stream, workspace, task, session, and worker identifiers;
- a positive sequence number and canonical timestamp;
- correlation and optional causation identifiers;
- an event type, typed payload, and required redaction classification.

One stream represents one worker execution attempt. Its stream, workspace, task,
session, and worker identity is immutable. A replacement or restarted worker
uses new session, worker, and attempt-stream identifiers; later recovery work
may correlate attempts without rewriting their history.

Events in one stream:

1. start with sequence `1` and `task.started` from `ready` or `blocked`;
2. increase without gaps, duplicates, or timestamp regression;
3. use event sequence—not timestamp—as their authoritative order;
4. apply task transitions from the state established by previous events;
5. use a dedicated completion, failure, or cancellation event for a terminal
   transition;
6. accept no new event after a terminal task event.

A blocked task resumes inside the same attempt with `task.updated`. A
`task.started` event from `blocked` is reserved for the first event of a new
attempt stream after replacement or restart.

An event identifier is an idempotency key. Reappending the structurally
identical event returns the committed event stream unchanged. Reusing the
identifier with different content, or reusing a sequence with another event,
fails closed.

Replay uses a cursor containing the stream identifier, sequence, and event
identifier. The cursor must match one canonical committed event before later
events are returned.

### Redaction

Each event type has one minimum classification:

- `metadata` may retain its structured payload in diagnostics;
- `workspace-content` is replaced by a redaction marker in diagnostics;
- `sensitive-reference` is also replaced and may contain only references to
  protected operations or records.

`approval.required` is a sensitive reference because it carries the protected
action description. `approval.resolved` is metadata because it contains only
the approval identifier and terminal decision; it never repeats the action.

The schema carries approval, artifact, and tool request identifiers rather than
dedicated raw-credential fields, and runtime validation rejects undeclared
envelope or payload fields. Arbitrary user or worker text is classified as
`workspace-content`; preventing a secret from being embedded inside that text
remains a later policy and credential-boundary responsibility. A caller cannot
downgrade the classification assigned to an event type.

## Consequences

### Positive

- Adapters and persistence can target one deterministic Actestra contract.
- Cross-workspace leakage and invalid lifecycle rewrites fail before storage.
- Replay and duplicate delivery have explicit behavior.
- Diagnostics have a contract-level redaction floor.
- Tests run without Electron, a database, or an external runtime.

### Costs

- Adapters must translate worker-native events into the Actestra schema.
- A worker restart creates a new attempt rather than silently continuing the
  old stream.
- Future schema changes require explicit version compatibility and migration
  behavior.
- Causation integrity across streams and durable transaction semantics remain
  persistence-layer responsibilities.

## Rejected alternatives

### Order events by timestamp

Rejected because clock skew and equal timestamps cannot provide deterministic
ordering.

### Use one global sequence

Rejected because unrelated attempts would contend on one ordering authority and
could not be replayed independently.

### Tolerate gaps for later reconciliation

Rejected because an incomplete stream could be mistaken for authoritative task
state.

### Reuse worker-native identifiers and lifecycle states directly

Rejected because adapters would become competing product contracts.

### Include raw tool arguments or credential fields in the common event envelope

Rejected because the event store and diagnostic path must not become a secret
transport.

## Review triggers

Review this decision if:

- one task must intentionally move between workers without creating a new
  execution attempt;
- distributed synchronization requires ordering beyond one attempt stream;
- a supported event schema version cannot preserve the current replay or
  terminal-state guarantees;
- protected payload handling needs a stronger representation than references
  plus redaction classes.
