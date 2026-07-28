# ADR-0009: Define P4 General-Work Process and Content Boundaries

- Status: Accepted
- Date: 2026-07-29

Owner gate: accepted on 2026-07-29 to begin P4.2.

## Context

P3 established Actestra-owned task, event, persistence, worker-lifecycle,
privileged-service, audit, and renderer boundaries. The accepted implementation
is deliberately inert:

- the only adapter is an in-memory deterministic fake;
- `AgentAdapter` protocol version 1 has no tool-result return path;
- protected operations carry opaque input references, but no content-reference
  store exists;
- the disabled executor has no filesystem, network, process, model, MCP, or
  credential backend;
- synchronous SQLite currently runs in Electron main; and
- renderer IPC exposes only bounded metadata and renderer-ready intents.

P4 needs one real cross-process general-work path before a model runtime or a
broad tool surface is introduced. The first path must prove scoped reads,
create-only task outputs, failure handling, restart evidence, and durable
artifacts without importing an upstream desktop application or silently
expanding renderer authority.

AionCore remains an evaluated P1 pin. Its root license is Apache-2.0 while its
workspace manifest declares MIT, and no root `NOTICE` was found. Actestra
cannot treat that runtime as an approved distribution dependency until the
license and minimum integration surface are resolved.

## Decision

This decision is accepted. Its P4.2 persistence and content subset may now be
implemented. Until each later slice is implemented and evidenced,
`AgentAdapter` version 1, the disabled executor, and the three-operation preload
allowlist remain the current runtime architecture.

### First execution worker

The first P4 worker will be an Actestra-owned deterministic reference
general-work worker running in a real Electron utility process. It will execute
versioned fixture plans through the same adapter, policy, tool, event,
persistence, and artifact boundaries intended for a future model-backed
worker.

The reference worker is not the P3 in-memory fake, but it is also not evidence
of model reasoning, arbitrary tool use, AionCore integration, or production
sandboxing. Its purpose is to make the real process and authority path
testable before adding provider credentials, network access, or an upstream
runtime.

### Process topology and transport

Electron main will supervise two Actestra-owned utility-process roles:

1. the reference general-work worker; and
2. the SQLite persistence and content-reference service.

Each role uses a closed, versioned structured-clone message protocol over
Electron utility-process messaging. Every request carries a protocol version,
message identifier, operation kind, bounded payload, and attempt identity.
Responses correlate to one request and have explicit success or stable failure
codes. Runtime validators reject missing, extra, oversized, out-of-order, or
unsupported messages.

Main owns process creation, timeout, cancellation, retry, and termination.
Utility processes receive a minimal environment and controlled working
directory. The reference worker receives no workspace root, credential,
application database path, or generic main-process capability.

Actestra-owned utility roles will not introduce a loopback HTTP or WebSocket
server. A utility crash makes the dependent operation unavailable; main must
not fall back to synchronous workload persistence or an unsupervised
in-process worker.

Electron utility processes are not an operating-system sandbox. Source and
dependency checks will prevent the reference-worker entry graph from importing
filesystem, network, shell, child-process, Electron renderer, or credential
modules, but P4 must not describe that check as hostile-code containment.

### Adapter protocol extension

P4 will introduce an exactly negotiated `AgentAdapter` protocol version 2
rather than overloading version 1. The proposal adds:

- a `tool-results` capability;
- a validated tool-request signal containing only the request, tool, opaque
  input-reference, and bounded summary needed by the Actestra core; and
- a main-to-adapter tool-resolution operation carrying the request identifier,
  terminal result, optional opaque output reference, stable error code, and
  resolution time.

The existing `send` operation remains a user-message operation. It will not be
used for tool results.

The native worker protocol is semantic and untrusted; it does not emit
Actestra `CoreEvent` envelopes. A main-side adapter validates a bounded native
tool request, stores its typed arguments as an input reference, derives the
workspace, task, session, worker, action, resource, and credential fields from
the active attempt and trusted tool manifest, and then emits the normalized
adapter signal. The worker cannot self-authorize or select policy metadata.

For a successful read, the concrete adapter may resolve the matching output
reference and deliver its bounded content to the same live worker attempt.
Raw content, paths, and references do not enter renderer projection, audit
records, generic IPC, or diagnostic text.

Protocol version 1 and version 2 are not implicitly compatible. Unsupported
versions or missing capabilities fail before worker start.

### Content and input references

The persistence utility owns an Actestra content-reference store. A reference
is an unpredictable opaque identifier bound to:

- reference kind and schema version;
- workspace, task, session, worker, and optional tool-request identity;
- content classification and media type;
- byte length and SHA-256 digest;
- creation time, optional expiry, and consumption state; and
- immutable bounded content.

The first slice accepts UTF-8 text only and limits each stored payload to
1 MiB. Metadata and content use the same owned SQLite transaction so a
reference cannot point at partially written data. Retrieval requires an exact
ownership match; conflicting reuse, expired references, wrong-attempt access,
and digest mismatch fail closed.

References and their payloads are never written to metadata-only audit records
or renderer projections. Cleanup occurs only after terminal evidence and the
configured task-retention point, so restart does not invalidate required
inputs or outputs.

### Initial workspace and tool surface

The first slice registers exactly two native tools:

- `actestra.workspace.read-text` reads one bounded UTF-8 file beneath an active
  workspace grant; and
- `actestra.task-output.write-text` creates one bounded UTF-8 file beneath an
  Actestra-owned task-output area.

Workspace roots are selected or injected through a main-owned grant boundary
and stored only by trusted main/persistence services. The renderer receives an
opaque workspace identifier and display metadata; the worker receives only the
identifier, never the raw root.

Read inputs contain a relative path. Absolute paths, empty components,
traversal, unsupported encoding, oversized files, and symlink components are
rejected. The implementation must prove that the resolved target remains
beneath the canonical granted root.

Task outputs are written to an Actestra-owned per-task directory before any
future export. Writes are create-only and bounded. Existing names, symlinks,
partial writes, and destination drift produce explicit artifact-conflict or
tool-failure results; P4 will not overwrite user files.

The research fixture uses a local corpus. Network requests, shell execution,
MCP servers, provider APIs, credentials, user-workspace mutation, publishing,
and external messaging remain denied.

### Policy and authorization

The first production policy snapshot names the two exact tool identifiers and
their exact action/resource pairs:

- scoped workspace text read may be allowed for an active grant; and
- create-only text output may be allowed inside the active task-output area.

Everything else remains denied by default. Main derives the protected
operation from the trusted manifest and active attempt before the existing
authorization gateway runs. Neither a fixture nor a worker-provided summary
can widen authority.

Denial, cancellation, timeout, executor failure, content-reference failure,
and possible-execution uncertainty remain distinct outcomes. A policy grant
authorizes one attempt; it is not execution-success evidence.

### Persistence, restart, and failure

The persistence utility exclusively owns the SQLite connection before P4
activates user-workload writes. Main talks to it through an asynchronous,
versioned port and does not retain an emergency synchronous write path.

Durable ordering remains:

1. validate and persist task/attempt state;
2. persist normalized events and metadata-only privileged evidence;
3. persist artifact metadata and referenced content;
4. acknowledge completion to the worker and renderer only after the required
   writes succeed.

After a worker crash or application restart, recovery creates fresh session,
worker-attempt, and event-stream identities according to ADR-0006. Idempotency
keys allow safe persistence retries, but there is no hidden continuation of a
terminated process. A persistence-utility crash blocks new task execution and
surfaces an unavailable state until supervised recovery succeeds.

### Upstream boundary

No AionUi or AionCore source, binary, asset, configuration, or runtime is
imported by this first slice. The exact P1 pins remain evaluation evidence.

A later AionCore adapter must use the same accepted Actestra contracts and
must first provide:

- clarified license and notice obligations;
- an exact immutable revision and artifact provenance;
- a minimal reviewed adapter/process surface; and
- compatibility, cancellation, restart, and boundary tests.

## Consequences

### Positive

- P4 proves a real process boundary and real scoped filesystem path without
  requiring credentials or network access.
- Tool arguments and results remain opaque to core events, audit, and renderer
  projection.
- SQLite workload writes leave Electron main before they are activated.
- The deterministic fixture worker makes denial, cancellation, crash,
  restart, and artifact-conflict paths reproducible.
- A future model runtime must fit Actestra authority instead of redefining it.

### Costs

- P4 needs two supervised utility protocols, strict validators, lifecycle
  tests, and crash harnesses before a visible user journey is complete.
- The first worker demonstrates orchestration rather than model quality.
- A 1 MiB UTF-8-only reference store does not support binary or large-document
  workflows.
- Renderer workspace selection and richer task controls require separately
  reviewed intents.
- Utility-process separation reduces accidental coupling but does not provide
  hostile-code containment.

## Rejected alternatives

### Import AionUi or distribute AionCore immediately

Rejected because the first vertical slice can prove Actestra's contracts
without importing an application foundation, and the AionCore license
inconsistency remains unresolved.

### Keep SQLite workload writes in Electron main

Rejected because synchronous database work would make UI and process
supervision depend on user-workload latency and failure.

### Reuse `AgentAdapter.send` for tool results

Rejected because user messages and privileged operation results have different
identity, ordering, retry, and validation rules.

### Let workers emit trusted `CoreEvent` envelopes

Rejected because Actestra must own event identifiers, sequence, classification,
and trusted attempt identity.

### Send raw paths or content through renderer IPC and audit

Rejected because those surfaces do not need the authority or sensitive data.

### Write directly to or overwrite user workspace files

Rejected because P4 needs deterministic artifact-conflict and review behavior
before any replacement flow is designed.

### Use loopback HTTP or WebSocket transport for owned utilities

Rejected because it adds port allocation, local-network exposure, and another
authentication surface without a requirement in the first slice.

## Review triggers

Review this decision if:

- the proposed fixture worker cannot exercise the same contract required by a
  model-backed adapter;
- binary or larger content must enter the MVP;
- a supported operating system cannot enforce the scoped path checks;
- utility-process restart cannot preserve the required persistence ordering;
- a renderer intent needs raw paths, content references, or protected-operation
  fields;
- AionCore licensing and provenance become distribution-ready;
- MCP, provider networking, credentials, export, or workspace replacement is
  introduced; or
- an operating-system sandbox is selected.
