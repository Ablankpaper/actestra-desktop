# ADR-0008: Keep Platform Evidence and IPC Main-Owned

- Status: Accepted
- Date: 2026-07-28

## Context

P3.3 provides Actestra-owned SQLite persistence, P3.4 retains terminal worker
attempts until their caller releases them, and P3.5 provides a deterministic
privileged-service authority chain. Those components are not registered at
desktop startup and expose no renderer operation.

P3.6 must connect the boundaries without turning IPC into a generic capability
transport. It must also close two evidence gaps:

- P3.5 audit records are metadata-only but in memory;
- P3.4 terminal events and incidents disappear when the supervisor release
  barrier is crossed.

A compromised renderer must not select an IPC channel, construct a protected
operation, provide a tool or credential reference, query raw persistence, or
obtain an Electron or Node capability.

## Decision

### Main-owned composition root

After the Actestra data layout is ready, Electron main opens the owned SQLite
store and constructs one platform-service composition root. The root owns:

- the durable metadata-only audit trail;
- a no-rule policy snapshot whose default result is denial;
- the approval service and reference-only credential broker;
- a disabled executor and the privileged tool gateway;
- the bounded renderer projection reader.

The disabled executor has no manifest, transport, tool, filesystem, process,
network, environment, or secret backend. Registration is not evidence of real
tool execution.

### Durable evidence schema

SQLite schema version 3 adds:

- gapless privileged audit records with their canonical metadata-only JSON and
  indexed metadata projection;
- immutable terminal worker-attempt evidence with a canonical JSON projection.

The persistence adapter allocates audit sequence numbers inside the same
transaction that writes the record. Restart therefore continues the durable
sequence instead of restarting an in-memory counter.

Terminal attempt evidence includes opaque ownership and attempt identifiers,
state, bounded counters, timestamps, restart references, forced-cancellation
state, and an optional stable incident code and time. It excludes incident
messages, prompts, worker messages, raw tool input, tool output, credentials,
paths, and arbitrary exception text.

### Supervisor release barrier

The main-owned attempt-evidence coordinator accepts only terminal attempts. It
performs this order:

1. snapshot the terminal attempt and its immutable event list;
2. append every core event through the existing idempotent persistence port;
3. append immutable terminal-attempt evidence;
4. release the supervisor attempt only after every durable write succeeds.

Partial persistence is retryable because core-event delivery and terminal
evidence insertion are idempotent. Any write failure leaves the supervisor
snapshot and event list available for another attempt. The coordinator never
persists an incident message.

### Closed renderer projection

Preload exposes exactly three frozen operations:

- request application metadata;
- request a bounded, metadata-only platform snapshot;
- notify main that the renderer is ready.

The bridge does not expose `ipcRenderer`, channel names, generic
`send`/`invoke`, persistence methods, protected operations, tool identifiers,
input references, credential references, worker controls, or approval
resolution.

Main accepts those operations only from the current main frame of the current
Actestra window and rejects unexpected arguments. The platform snapshot
contains fixed boundary modes, aggregate audit sequence/count data, and at most
50 terminal attempt projections. Runtime validators reject extra fields and
unsupported values on both sides of the bridge.

Renderer source remains unable to import Electron or Node, use CommonJS
`require`, access the Node `process` global, or create an external network
client. Packaged context isolation, sandboxing, CSP, navigation, permission, and
window policies remain mandatory.

## Consequences

### Positive

- Privileged service lifecycle, persistent evidence, and IPC authority have one
  main-owned composition boundary.
- Audit sequence survives restart without exposing audit contents to renderer.
- A terminal attempt cannot be released before its required events and incident
  code are durable.
- Renderer projection is bounded and contains no workspace content, incident
  message, input reference, or credential reference.
- Future intent operations must be added explicitly to the shared allowlist and
  tested at both IPC ends.

### Costs

- Main startup performs a bounded SQLite open and migration before loading the
  renderer.
- P3 still uses synchronous embedded SQLite in main; user-workload writes must
  move to a supervised persistence utility before a real worker is enabled.
- The initial renderer projection is read-only and does not expose worker
  control, approval resolution, or tool invocation.
- A real policy snapshot, credential backend, input-reference store, executor,
  transport, and worker remain later vertical-slice work.

## Rejected alternatives

### Expose generic IPC send or invoke

Rejected because a renderer could select an unreviewed channel or pass a
low-level privileged payload.

### Send protected operations from renderer

Rejected because tool, input, action, resource, and credential references must
be derived and validated inside trusted application and worker boundaries.

### Persist audit after acknowledging a privileged state change

Rejected because approval, credential, or tool state could become authoritative
without durable evidence.

### Release supervisor memory before persistence

Rejected because a failed write would irreversibly discard the only validated
terminal event and incident evidence.

### Persist incident and worker messages in the projection

Rejected because arbitrary text can contain workspace content, secrets, paths,
provider details, or attacker-controlled diagnostic payloads.

## Review triggers

Review this decision if:

- a real worker requires live event streaming rather than bounded terminal
  projection;
- a renderer intent needs protected-operation input that cannot be derived in
  main;
- persistence moves to a utility process and changes the trusted IPC topology;
- durable audit needs signatures, retention, export, or multi-user identity;
- a real executor, keychain, MCP server, or native tool is introduced.
