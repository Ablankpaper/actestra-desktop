# ADR-0016: Move P4 Workload Persistence Behind a Utility Boundary

- Status: Accepted
- Date: 2026-07-30
- Clarifies:
  [ADR-0005](0005-sqlite-persistence-and-migrations.md),
  [ADR-0006](0006-agent-adapter-lifecycle-and-supervision.md),
  [ADR-0010](0010-aionui-first-product-foundation.md),
  [ADR-0011](0011-aionui-shadow-projection.md), and
  [ADR-0012](0012-aionui-approval-decision-authority.md)

## Context

The accepted AionUi-first baseline keeps the native AionUi application,
routes, bridge domains, and functional UI as the Actestra product surface.
Actestra already owns durable P3 state plus the narrowly authoritative F3
approval-response outbox, but the synchronous SQLite adapter still runs inside
Electron main. Activating broader user-workload writes there would couple the
desktop lifecycle and UI responsiveness to database latency and corruption.

P4 general work also needs bounded content references and durable workspace
grants before a real worker or native filesystem tool can be admitted. Those
records contain private paths or user content and therefore cannot be carried
through renderer IPC, metadata-only audit, or the F2 shadow projection.

The native-fusion labels F0 through F3.3 and the general-work implementation
labels GW-P4.2 through GW-P4.6 describe two related tracks. F0 through F3.3 record
which preserved AionUi domains have been observed or accepted beneath the
native UI. GW-P4.2 through GW-P4.6 record the ordered general-work execution slices:
persistence, worker transport, native tools, coordination/recovery, and the
visible journey.

## Decision

### GW-P4.2 scope

GW-P4.2 introduces one Actestra-owned persistence utility process and one
versioned structured-clone protocol. The utility is the exclusive owner of
`state/actestra.sqlite3`. Electron main and the preserved AionUi bridge use an
asynchronous `ActestraPersistencePort`; they do not retain a synchronous
SQLite fallback.

The move includes every existing schema and operation:

- authoritative P3 domain records, core events, privileged audit, and terminal
  attempt evidence;
- F2 metadata-only AionUi shadow evidence;
- F3 immutable approval decisions and delivery state; and
- new schema version 6 workspace grants and content references.

Moving an operation does not change its authority classification. F2 records
remain inert evidence, F3 records retain their accepted narrow authority, and
native AionUi remains authoritative for domains not yet fused.

### Protocol and process boundary

Every request and response carries protocol version 1, a correlation
identifier, one declared operation, and a strictly validated bounded payload.
Unknown fields, unsupported versions, malformed values, oversized messages,
uncorrelated responses, timeouts, digest mismatches, and post-exit use fail
closed.

Electron main launches the utility with a minimal environment and explicit
working directory. It owns startup, timeout, close, and failure reporting.
Source and packaged-graph checks reject `node:sqlite` or `DatabaseSync` when
reachable from the main entry and require them in the persistence-utility
entry.

The utility boundary prevents accidental renderer/main coupling; it is not an
operating-system sandbox or hostile-code containment claim.

### Workspace grants

A workspace grant is an Actestra-owned durable record containing an opaque
workspace identity, canonical root, lifecycle state, and bounded timestamps.
Only one active grant may exist for a workspace. The renderer and future
worker receive opaque identifiers and display metadata, not the canonical
root.

GW-P4.2 stores grants but does not yet activate filesystem reads. GW-P4.4 must still
prove canonical containment, traversal and symlink rejection, size and
encoding limits, cancellation, and policy enforcement before any grant can
authorize a native tool.

### Content references

Content references are immutable, opaque, and owned by an exact workspace,
task, session, worker, and optional tool request. GW-P4.2 accepts UTF-8 text only
with a 1 MiB payload limit and stores byte length plus SHA-256 digest in the
same transaction as the content.

Reads require an exact owner and kind match. Wrong-attempt access, conflicts,
expiry, invalid UTF-8, length mismatch, digest mismatch, and corrupt persisted
content fail closed. Raw content, roots, and reference identifiers may cross
only the dedicated main-to-utility persistence protocol. They do not enter
metadata-only audit, renderer projections, renderer IPC, or generic bridge
IPC.

### AionUi preservation and availability

The downstream AionUi main process starts the utility after native process
initialization and before registering Actestra shadow and approval providers.
The original AionUi UI, routes, and native backend lifecycle remain intact.
If the Actestra utility cannot start, the compatibility providers enter an
explicit unavailable state while the preserved AionUi application continues
to launch; no second shell or persistence UI is introduced.

### Migration and rollback

Schema version 6 is a forward-only migration under ADR-0005. It adds
`workspace_grants` and `content_references` without rewriting schemas 1
through 5. A rollback removes the downstream GW-P4.2 provider patch and uses a
fresh Actestra profile. It does not downgrade or delete an existing database
silently.

### Ordered follow-up

This decision admits only the persistence/content foundation. It does not
activate a real worker or filesystem tool.

The remaining P4 order is:

1. GW-P4.3: real deterministic General Worker process and `AgentAdapter` v2;
2. GW-P4.4: scoped read/create-only native tools and production policy;
3. GW-P4.5: task coordination, durable recovery, cancellation, and artifact
   ownership; and
4. GW-P4.6: the complete preserved-AionUi general-work journey and packaged
   acceptance smoke.

Goose remains P5 and CrewAI-assisted Team orchestration remains P6.

## Consequences

### Positive

- SQLite workload latency and failure no longer execute in Electron main.
- Existing P3 and AionUi compatibility records cross one common asynchronous
  persistence boundary without changing their authority.
- Workspace scope and user content gain strict durable ownership before a
  worker or tool consumes them.
- The preserved AionUi product can report Actestra unavailability without
  losing its original UI or introducing a second application shell.
- Later General Worker, Goose, and CrewAI processes must use the same
  Actestra-owned state instead of creating competing records.

### Costs

- Startup now depends on protocol negotiation and process lifecycle handling.
- Utility-process failure blocks new Actestra-authoritative work until a later
  supervised-recovery slice restores it.
- A 1 MiB UTF-8 store does not cover binary or large-document workflows.
- Forward-only schema 6 requires fresh-profile rollback during development.
- The process boundary alone does not limit OS-level filesystem or network
  access.

## Rejected alternatives

### Keep workload SQLite in Electron main

Rejected because UI/process lifecycle would remain coupled to user-workload
latency and failure, and no enforceable ownership boundary would exist.

### Give AionCore or another worker its own product database

Rejected because Actestra Core must remain the only durable product authority.

### Send raw roots or content through renderer IPC

Rejected because the renderer neither needs nor owns filesystem or content
authority.

### Introduce a replacement desktop shell

Rejected by ADR-0010. The retained AionUi application is the product UI.

### Add loopback HTTP for owned persistence

Rejected because structured-clone messaging avoids port allocation, listener
exposure, and an additional local authentication surface.

### Start Goose or CrewAI in this slice

Rejected because P5 and P6 depend on the completed P4 worker, tool, policy,
artifact, cancellation, and recovery path.

## Review triggers

Review this decision if:

- a supported platform cannot host or package the utility entry consistently;
- transparent utility restart cannot preserve request and persistence
  semantics;
- binary or payloads larger than 1 MiB enter MVP scope;
- content retention requires encryption or external blob storage;
- any renderer feature requires a raw root, content reference, or persistence
  operation;
- an OS sandbox is selected; or
- schema 6 cannot be migrated without breaking schemas 1 through 5.
