# ADR-0017: Supervise One General Worker Process per Adapter v2 Attempt

- Status: Accepted
- Date: 2026-07-30
- Supersedes: the protocol-version and capability vocabulary portions of
  [ADR-0006](0006-agent-adapter-lifecycle-and-supervision.md)
- Clarifies:
  [ADR-0004](0004-core-domain-event-stream.md),
  [ADR-0007](0007-privileged-service-authorization.md),
  [ADR-0010](0010-aionui-first-product-foundation.md), and
  [ADR-0016](0016-p4-general-work-process-and-content-boundaries.md)

## Context

ADR-0006 deliberately stopped at an in-process deterministic fake and
AgentAdapter protocol version 1. That contract proved immutable attempts,
independent control and core-event sequencing, cancellation, crash, timeout,
restart, and cleanup semantics before Actestra admitted a real worker
transport.

GW-P4.3 now needs a real operating-system process boundary. It must prove that:

- an external worker can negotiate an exact protocol before receiving a task;
- Actestra main, not the worker, owns product identities and normalized events;
- a tool result can return to a blocked worker without giving it raw tool
  output or permission authority;
- malformed, stale, gapped, timed-out, crashed, or cancelled attempts fail
  closed;
- one process cannot silently continue as a different attempt; and
- the preserved AionUI renderer, routes, features, and AionCore lifecycle do
  not change.

The first worker remains deterministic and offline. It is a transport and
lifecycle proof, not a general model runtime.

## Decision

### AgentAdapter protocol version 2

Actestra advances its internal AgentAdapter contract from version 1 to exact
version 2. Version 2 retains the lifecycle and supervision rules in ADR-0006
and adds:

- the closed `tool-results` capability;
- `resolveTool(requestId, result)` on the adapter;
- a typed result union for `succeeded`, `failed`, and `cancelled`;
- optional opaque `ToolOutputReference` and bounded summary for success; and
- a `protocol-error` control signal for incompatible protocol, invalid signal,
  immutable-identity mismatch, sequence gap, or timestamp regression.

The result carries exact start and completion instants. It cannot contain raw
content, a filesystem path, a workspace root, credentials, or an arbitrary
tool response. Approval resolution remains a separate capability and method.

Protocol compatibility is exact. Unknown versions, capabilities, fields,
states, identities, timestamps, or result shapes fail closed.

This decision supersedes only the version-1 interface and closed capability
list in ADR-0006. Its immutable-attempt, sequencing, lifecycle, supervision,
terminal-reconciliation, restart, and post-consumption cleanup rules remain
accepted.

### Separate native General Worker protocol

The General Worker does not emit Actestra Core events directly. It speaks a
separate structured-clone wire protocol at exact version 1 with:

- role `general-worker`;
- exact implementation version `0.1.0`;
- closed capabilities `messages`, `cancellation`, `heartbeats`, and
  `tool-results`;
- one concurrent attempt;
- bounded request correlation and gapless worker-event sequence;
- operations `start`, `send`, `resolve-tool`, `cancel`, `dispose`, and
  `close`; and
- events for start, heartbeat, message, tool request, accepted tool result,
  resume, completion, failure, and cancellation.

Messages are at most 256 KiB; start prompts and later `send` content are each
at most 64 KiB. A Worker-produced private task-output input is separately
limited to 128 KiB after JSON serialization so it cannot consume the complete
message envelope. Validators reject unknown fields, oversized private inputs,
and undeclared operations before dispatch.

Electron main creates the opaque attempt token, tool-request ID, event IDs,
session/worker association, stream sequence, timestamps, and normalized Core
events. The worker never receives a workspace root, database handle, product
credential, approval evidence, renderer handle, policy engine, MCP client, or
generic tool gateway.

### One process per immutable attempt

Electron main launches the worker through `utilityProcess.fork` with:

- one bundled entry module;
- an explicit working directory;
- no command-line arguments;
- an allowlist-only environment containing locale, time-zone, temporary
  directory, and required Windows runtime values;
- unsigned-library loading disabled; and
- authentication requests delegated to neither the worker nor the renderer.

The utility service accepts exactly one attempt during its lifetime. Disposal
cannot make the process reusable. A replacement attempt requires a new
process, token, session, worker, and event stream under the ADR-0006 restart
rules.

Source and packaged-graph checks reject filesystem, shell, network, SQLite,
and Electron imports from the worker entry graph. This reduces accidental
authority; it is not an operating-system sandbox or hostile-code containment
claim.

### Event and tool-result mapping

Main maps validated worker events into main-owned Adapter v2 signals and Core
events:

| Worker event            | Main-owned result                                                        |
| ----------------------- | ------------------------------------------------------------------------ |
| `started`               | `ready`, then `task.started`                                             |
| `message`               | `agent.message`                                                          |
| `tool-requested`        | fresh `ToolRequestId`, `tool.requested`, task blocked, `worker.blocked`  |
| `tool-result-accepted`  | correlated `tool.started` plus `tool.completed` or `tool.failed`         |
| `resumed`               | blocked-to-running `task.updated`, then `resumed`                        |
| `completed`             | `task.completed`, then `completed`                                       |
| `failed`                | `task.failed`, then `failed`                                             |
| `cancelled`             | `task.cancelled`, then `cancelled`                                       |
| unexpected process exit | running-to-blocked transition, `worker.failed`, then retryable `crashed` |

The supervisor accepts a blocked tool signal only when it matches the preceding
`tool.requested` event. It releases the pending reference only after a
correlated typed result and legal task transition. A duplicate resolution,
wrong request, conflicting status, stale token, sequence gap, or terminal
event mismatch terminates the attempt as a protocol failure.

GW-P4.3 does not execute a native tool. GW-P4.4 will own tool registration,
workspace scope, policy, approval, execution, and creation of the opaque output
reference.

### Packaging and AionUI preservation

Both the Actestra regression harness and the materialized AionUI application
build a separate General Worker entry. Packaged verification follows the
reachable worker module graph and rejects undeclared authority.

An isolated end-to-end probe launches the real process, negotiates both
protocols, completes the deterministic no-tool journey, validates its three
Core events, disposes the attempt, and closes the process. Its explicit ready
marker is independent of AionCore startup status.

The AionUI downstream change copies reviewed Actestra sources and touches only
Electron main, build configuration, and an Actestra unit test. It adds no
renderer component, route, feature entry, alternate shell, or worker-specific
UI.

### Failure, cancellation, and rollback

Handshake and request timeouts terminate the process and reject pending
operations. Malformed messages, incompatible negotiation, fatal worker
messages, stale tokens, sequence gaps, and illegal lifecycle events fail
closed. Unexpected exit maps to a retryable crashed attempt only after the
main-owned blocked and worker-failure evidence is produced.

Cancellation is a protocol request whose terminal acknowledgement must match
the resulting `task.cancelled` event. Supervisor timeout remains the forced
cleanup path defined by ADR-0006. Listener cleanup and close are idempotent.

This slice changes no database schema. Source rollback regenerates the AionUI
downstream without patch `0007-actestra-general-worker.mjs` and removes the
General Worker entry and probe while retaining GW-P4.2 schema version 6.

## Consequences

### Positive

- Actestra now exercises a real child-process boundary without giving that
  process product authority.
- Worker-native events cannot become a second UI or state protocol.
- Typed tool results unblock GW-P4.4 without leaking raw content.
- One-process-per-attempt cleanup makes crash and replacement evidence
  deterministic.
- The same adapter and process pattern can later supervise Goose without
  importing Goose's desktop UI.

### Costs

- Adapter v1 implementations must upgrade before use with the current
  supervisor.
- Each replacement attempt pays process startup and negotiation cost.
- The deterministic worker does not prove model quality, tool correctness,
  durable coordination, or recovery.
- A source-level authority allowlist does not provide OS-enforced sandboxing.

## Rejected alternatives

### Let the worker emit Core events and product IDs

Rejected because it would make an external runtime a competing product
authority and allow it to forge event identity or sequence.

### Reuse one process for multiple attempts

Rejected because stale state, messages, or permissions could cross immutable
attempt boundaries.

### Return raw tool output to the worker

Rejected because content access must remain owner-checked and bounded through
Actestra references.

### Run the worker in the renderer or Electron main

Rejected because either location would collapse the UI, product-authority, and
worker failure domains.

### Start with Goose, CrewAI, or arbitrary shell execution

Rejected because P5 and P6 depend on the completed P4 tool, policy,
coordination, artifact, cancellation, and recovery path.

## Review triggers

Review this decision if:

- a supported Electron platform cannot reliably package or supervise the
  utility entry;
- a worker requires streaming payloads larger than the current bounds;
- tool results require more than opaque references and bounded status;
- OS sandboxing or a separate broker changes process authority;
- restart requires warm process reuse; or
- the General Worker protocol must support more than one concurrent attempt.
