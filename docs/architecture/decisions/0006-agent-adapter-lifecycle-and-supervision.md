# ADR-0006: Agent Adapter Lifecycle and Supervision

- Status: Accepted
- Date: 2026-07-28

## Context

Actestra owns workspace, task, worker, session, approval, artifact, and event
state. P3.4 needs the first worker boundary without making a real agent runtime,
transport, or privileged tool service part of the desktop product.

The boundary must be strict enough that later local and remote workers can be
supervised consistently. In particular, Actestra must be able to:

- reject an incompatible adapter before work starts;
- distinguish adapter control signals from ordered core events;
- detect startup silence, heartbeat loss, cancellation silence, crashes, and
  protocol corruption without real-time sleeps in tests;
- preserve one immutable worker attempt instead of silently continuing it after
  a crash;
- make cancellation and disposal idempotent;
- exercise the full lifecycle with a deterministic fake that performs no real
  I/O or privileged action.

ADR-0004 already makes a session, worker, and core-event stream immutable
identities for one attempt. This decision extends that rule across the adapter
protocol and supervisor.

## Decision

### Versioned adapter contract

Actestra defines protocol version `1` with one `AgentAdapter` interface:

- `capabilities()` declares the adapter kind, protocol version, supported
  capabilities, concurrency limit, and heartbeat interval;
- `start(request)` creates one immutable attempt;
- `send(sessionId, input)` sends user input to an active attempt;
- `approve(requestId, decision)` resolves a referenced approval request;
- `cancel(sessionId, reason)` requests cancellation;
- `subscribe(sessionId, handler)` observes control signals and nested core
  events;
- `dispose(sessionId)` releases adapter resources.

Protocol compatibility is exact in P3.4. Unknown protocol versions, unknown
capability names, duplicate capabilities, invalid timing limits, missing
required capabilities, or a mismatched adapter kind fail closed before
`start`.

The version-1 capability vocabulary is closed:

- `messages`;
- `approvals`;
- `cancellation`;
- `heartbeats`.

Adding a capability or changing a message shape requires a protocol review.

### Immutable attempt identity

Every start request contains:

- workspace ID;
- task ID;
- session ID;
- worker ID;
- core-event stream ID;
- correlation ID;
- task entry state;
- start time;
- initial prompt.

These values are immutable for the life of the attempt. The task entry state is
`ready` for a first attempt and `blocked` for a supervised restart.

A restart must keep the workspace, task, and correlation identities, but must
use new session, worker, and stream IDs. Reusing any attempt identity is a
protocol error. A restart creates a new event stream whose first core event is
`task.started`; it does not append to the crashed stream.

### Subscription and sequencing

The supervisor subscribes before calling `start`, because the start request
already owns the session ID and an adapter may synchronously publish readiness.
Resolving `start` does not itself mean that the worker is ready.

Each adapter control signal contains:

- protocol version;
- a positive sequence number that is gapless within the attempt;
- occurrence time;
- session ID;
- worker ID.

The control-signal vocabulary is:

- `ready`;
- `heartbeat`;
- `core-event`;
- `blocked`;
- `resumed`;
- `completed`;
- `failed`;
- `cancelled`;
- `crashed`.

Nested core events retain their own independent, gapless sequence governed by
ADR-0004. The supervisor validates both sequences, monotonic timestamps,
immutable identities, legal lifecycle transitions, and every nested core-event
stream. A violation terminates the attempt as `protocol-failed` and disposes its
adapter resources.

### Lifecycle supervision

The supervisor tracks these attempt states:

- `starting`;
- `running`;
- `blocked`;
- `cancelling`;
- `completed`;
- `failed`;
- `cancelled`;
- `crashed`;
- `timed-out`;
- `protocol-failed`;
- `disposed`.

`ready` moves `starting` to `running`. `blocked` and `resumed` move between
`running` and `blocked`. A completed, failed, or cancelled control signal is
accepted only after its matching terminal core event has been observed.

P3.4 uses an injected monotonic wall clock and an explicit health check instead
of hidden timers:

- a silent `starting` attempt exceeds the startup timeout;
- a `running` or `blocked` attempt exceeds the heartbeat timeout when no signal
  arrives;
- a `cancelling` attempt exceeds the cancellation acknowledgement timeout when
  no `cancelled` signal arrives.

Startup and heartbeat timeout dispose the attempt and mark it `timed-out`.
Cancellation acknowledgement timeout force-disposes it and marks the local
attempt `cancelled`, while recording that the acknowledgement was forced. A
timeout is not rewritten as a user cancellation.

`cancel` is idempotent. An adapter that acknowledges cancellation emits the
`task.cancelled` core event followed by `cancelled`. A silent adapter is
force-disposed after the configured bound.

Adapter `dispose` is cleanup, not a task outcome. It is idempotent and must not
itself emit a completion, failure, or cancellation.

The P3.4 supervisor retains a disposed terminal snapshot and its validated
in-memory events until its caller explicitly releases that attempt through the
supervisor. Explicit supervisor disposal is the post-consumption barrier: it
clears the event array and removes the attempt from active lookup. P3.6 must
persist the required outcome and incident evidence before crossing that barrier.

### Crash and restart

A crash closes only the current attempt. Before `crashed`, a worker that had
been running moves the task to `blocked` and emits `worker.failed`. The
supervisor may start a bounded replacement attempt only from `crashed` or
`timed-out`.

Completed, failed, and cancelled tasks are not restartable. Restart count is
bounded by supervisor configuration. Restart admission requires:

- new session, worker, and stream IDs;
- the same workspace, task, and correlation IDs;
- task entry state `blocked`.

Automatic backoff, durable incident policy, and user-facing recovery controls
remain later integration work.

### Approval boundary

The adapter receives only an approval request reference and an Actestra-owned
decision. The contract does not grant credentials, execute tools, evaluate
policy, or persist approval authority.

P3.5 owns tool-policy evaluation and privileged services. P3.6 owns the
integration that persists supervisor incidents and projects worker events into
the application.

### Deterministic fake adapter

P3.4 supplies an Actestra-owned fake with:

- an injected controllable clock;
- explicit per-session plans;
- explicit step advancement;
- deterministic IDs, messages, approvals, heartbeats, completion, cancellation,
  and crash behavior;
- self-validation of every generated core event.

The fake performs no filesystem, network, process, shell, model, credential, or
tool operation. It is evidence for the protocol and supervisor only; it is not
a production worker.

## Consequences

### Positive

- Local and remote workers can target one small, versioned boundary.
- Readiness, liveness, cancellation, crash, and restart behavior is testable
  without races or real-time sleeps.
- A replacement attempt cannot corrupt or silently continue a prior event
  stream.
- Protocol drift and identity drift fail closed near the boundary.
- The fake exercises lifecycle behavior without expanding product authority.

### Costs

- Adapters must publish two independently ordered streams: control signals and
  core events.
- Exact version matching requires coordinated protocol upgrades.
- The explicit supervisor state machine adds validation code before a real
  worker exists.
- P3.4 does not yet persist supervisor incidents or expose them in the
  renderer.

## Rejected alternatives

### Let each worker own retry and restart behavior

Rejected because Actestra could not prove attempt identity, restart bounds, or
the authoritative task state.

### Reuse the session, worker, or event stream after a crash

Rejected because it would make a replacement process indistinguishable from
the original attempt and violate ADR-0004 ordering guarantees.

### Treat every adapter signal as a core event

Rejected because high-frequency health traffic does not belong in durable
product history, while product-relevant transitions still require validated
core events.

### Persist every heartbeat

Rejected because liveness is supervisory, high-volume, and replaceable. P3.6
may persist bounded incidents and state transitions instead.

### Treat `dispose` as cancellation

Rejected because cleanup may follow completion, failure, timeout, protocol
failure, or application shutdown. It cannot safely imply one task outcome.

### Connect a real worker in P3.4

Rejected because process transport, tool authority, credentials, recovery UI,
and renderer integration have not crossed their later phase gates.

## Review triggers

Review this decision if:

- a real adapter cannot express required lifecycle behavior without breaking
  protocol version 1;
- multiple workers must cooperate within one task attempt;
- remote transports require resumable delivery or acknowledgement semantics;
- heartbeat volume, clock behavior, or sleep/wake handling requires a different
  health model;
- P3.5 approval policy or P3.6 persistence reveals a missing authority
  boundary;
- automatic restart or backoff becomes a product requirement.
