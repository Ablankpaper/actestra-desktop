# ADR-0014: Gate AionUi Approval Reconciliation Reads Through P3 Policy and Audit

- Status: Accepted
- Date: 2026-07-29

## Context

ADR-0012 persists a desktop confirmation response before delivery and avoids
blind redelivery by checking whether the native call remains pending. ADR-0013
places the response-delivery `POST` behind one exact P3 capability, policy, and
durable audit sequence.

The retry and restart path still performs one native loopback `GET` directly:

```text
GET /api/conversations/{conversation}/confirmations
```

The returned native list can contain titles, descriptions, commands, option
labels, and provider-specific values. F3.3 must not persist that response,
expose it through a new renderer API, interpret it as a trusted protected
operation, or claim authority over pending-confirmation creation.

One narrower operation is known exactly: after at least one delivery attempt,
main may ask whether the persisted call identifier is still present in the
bounded native list.

## Decision

### F3.3 authority scope

Actestra routes only the pending-state read used by F3.1 retry and restart
reconciliation through a new P3 privileged gateway composition.

The operation is fixed to:

- tool `aionui-approval-reconciliation-read-v1`;
- action `network.request`;
- resource `external-service`;
- no credential references;
- one main-generated, compatibility-scoped input reference;
- one metadata-only summary with no native prompt, command, path, option, or
  response content.

Only an immutable schema version 5 decision in `pending-delivery` state with at
least one recorded attempt can enter the gate. The renderer cannot request,
parameterize, or observe this capability.

### Boolean-only compatibility boundary

The existing loopback transport performs the bounded native list request and
reduces the response to one boolean before returning to the gate:

- `true` means the exact persisted call identifier is still pending;
- `false` means it is absent;
- malformed, oversized, unavailable, or timed-out responses fail closed.

The native list, prompts, descriptions, commands, option labels, provider
values, and other response fields are never stored in the input registry,
privileged audit, authoritative P3 tables, or renderer projection.

The boolean exists only for the active main-process call. It is not an
authoritative pending-confirmation record. AionCore continues to create and
own the pending request.

### Exact capability and policy

The F3.3 executor publishes one immutable manifest for the exact tool, action,
resource, no-credential mode, and 12-second bound. Its policy snapshot contains
one exact allow rule for that tool.

Compatibility-scoped workspace, task, session, and worker identifiers are
derived from private SHA-256 hashes. Each attempt receives a unique request
identifier; the input reference is stable for the private conversation/call
identity so concurrent reads can coalesce without exposing raw identifiers.
Raw native identifiers and user content are not written to audit.

### Gateway and failure order

Each reconciliation read performs:

1. decision-state and protected-operation validation;
2. immutable capability-manifest validation;
3. deterministic policy evaluation;
4. durable `policy.evaluated` audit;
5. policy authorization without credentials or user approval;
6. durable `tool.started` audit;
7. the bounded boolean native read;
8. durable `tool.completed` or `tool.failed` audit.

Concurrent reads for the same compatibility-scoped confirmation identity join
the same in-flight promise. They therefore cause one native read and one audit
sequence. The entry is removed after success or failure so later recovery can
retry normally.

Policy or pre-execution audit failure prevents native access. If the native read
may have completed but terminal audit cannot persist, the result is uncertain
and is not used to mark the decision delivered or to permit redelivery.
Repeating the read is safe, but automatic response delivery remains governed by
the existing F3.1 reconciliation rules.

### Composition and rollback

F3.3 wraps the accepted F3.2 transport:

- `isPending` enters the F3.3 read gate;
- `deliver` delegates unchanged to the F3.2 delivery gate.

F3.3 is enabled only while the F3.2 policy gate is enabled.
`ACTESTRA_APPROVAL_RECONCILIATION_GATE=0` bypasses only the F3.3 `isPending`
wrapper: that read returns to F3.1 direct native reconciliation while
`deliver` remains delegated through F3.2. `ACTESTRA_APPROVAL_POLICY_GATE=0`
remains the broader F3.1 rollback and prevents the F3.3 wrapper from
activating.

Removing downstream patch
`0005-actestra-approval-reconciliation-policy-gate.mjs` is the source rollback.
No schema version is added. Existing schema version 3 audit and schema version
5 decision rows remain immutable and inert after rollback.

## Consequences

### Positive

- Retry and restart reconciliation no longer bypass P3 policy and durable
  audit.
- The original AionUi permission cards, pet confirmation, Team state, routes,
  loading states, and response shapes remain unchanged.
- Native prompts and provider details remain outside privileged audit and
  authoritative storage.
- F3.2 delivery policy and rollback semantics remain independently reviewable.
- Pre-execution failure cannot silently access the native pending list.

### Costs

- One reconciliation read adds three durable metadata-only audit records.
- Compatibility-scoped audit identifiers still do not correspond to
  authoritative P3 workspace, task, session, or worker rows.
- AionCore remains the system of record for pending-request creation, list
  content, provider semantics, and protected-operation execution.
- The native list is still parsed inside the loopback compatibility transport
  before it is reduced to a boolean.

## Rejected alternatives

### Persist the native pending list as Actestra approval state

Rejected because the response can contain user content and provider-specific
semantics, and AionCore still creates and owns those requests.

### Route renderer pending-list recovery through a new privileged IPC

Rejected because F3.3 needs only main-owned ambiguity reconciliation. Expanding
the renderer bridge would expose a broader content-bearing read without moving
creation or operation authority.

### Treat absence from one list read as approval evidence

Rejected because absence proves only that the native call is no longer pending.
It does not prove which native operation ran or that Actestra authorized it.

### Add the read tool to the F3.2 delivery policy

Rejected because a separate wrapper, policy revision, rollback switch, and
tests preserve the already accepted delivery boundary instead of silently
expanding it.

### Skip audit because the operation is read-only

Rejected because it is still a privileged network access that changes the
authoritative outbox decision made by reconciliation.

## Review triggers

Review this decision if:

- pending-confirmation creation or list authority moves to Actestra;
- renderer or WebUI pending-list reads enter this gate;
- a complete trusted `ProtectedOperation` for the underlying native action is
  available;
- native list content is proposed for persistence or audit;
- the loopback route, response schema, or AionCore version changes;
- the read requires credentials or a non-loopback endpoint;
- AionUi is updated from `v2.1.41`.
