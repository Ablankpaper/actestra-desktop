# ADR-0012: Own AionUi Approval Decisions Before Native Delivery

- Status: Accepted
- Date: 2026-07-29

## Context

ADR-0010 retains the exact AionUi `v2.1.41` application and requires Actestra
authority to move beneath preserved bridge and UI semantics one functional
domain at a time. ADR-0011 proves seven native metadata shapes through an inert
F2 shadow projection, but explicitly forbids that evidence from authorizing a
tool or resolving an approval.

F3 must begin with a write small enough to migrate, reconcile, and roll back
without replacing the AionUi permission experience. The native application has
two preserved desktop response surfaces:

- renderer permission cards submit the native confirmation `POST`;
- the main-owned pet confirmation window submits the same response through the
  existing bridge.

Calling the native endpoint first and recording evidence afterward would leave
an unrecoverable crash window. Treating every provider option identifier as an
allow or deny would also invent semantics that the ACP protocol does not
guarantee.

## Decision

### F3.1 authority scope

Actestra becomes the system of record for the immutable desktop confirmation
response and its delivery state before that response is sent to the local
native runtime.

This is intentionally narrower than the complete approval domain:

- native AionCore still creates and validates the pending confirmation;
- native AionCore still applies provider-specific option and `always_allow`
  semantics;
- the accepted P3 policy, approval, protected-operation, audit, and tool
  services are not activated by this slice;
- the protected operation itself remains native-owned.

The authoritative record therefore proves which bounded native response
Actestra accepted for delivery and whether delivery was reconciled. It does not
yet prove that Actestra policy authorized the underlying operation.

### Closed desktop intent

The preserved renderer HTTP adapter recognizes only:

```text
POST /api/conversations/{conversation}/confirmations/{call}/confirm
```

In Electron desktop mode it submits a version 1 envelope through the fixed
`actestra:approval-decide-v1` preload operation. Main accepts the operation only
from the current window's current main frame and rejects extra arguments.
Preload exposes no channel selection, SQLite access, generic HTTP proxy,
filesystem, credential, policy, worker, or tool authority.

The pet confirmation window calls the same main-owned service directly. Both
surfaces retain their existing UI, option values, loading behavior, and native
error handling.

Headless WebUI has no desktop preload or trusted desktop main-frame boundary.
F3.1 leaves that separately isolated surface on its retained native
compatibility path; it is not evidence of Actestra authority for remote WebUI.

### Bounded immutable decision

Main validates exact request and body keys, route shape, identifiers, JSON
depth and node count, string length, and total encoded bytes. It derives a
deterministic private decision identifier and request hash.

Explicit `allow_*` and `proceed_*` choices are classified as `approved`;
explicit reject choices as `denied`; `cancel` as `cancelled`. Any opaque
provider option identifier is stored as `selected`, not guessed to be an
approval. `always_allow: true` is accepted only with an explicit allow choice.

The exact bounded native response body is retained because crash-safe redelivery
requires it. The record does not fetch or copy the confirmation prompt,
description, command, workspace path, conversation content, credential, or
artifact payload.

### Persist-before-deliver outbox

SQLite schema version 5 adds `aionui_approval_decisions`. The main-owned
adapter:

1. reserves the immutable response and `pending-delivery` state in one
   transaction;
2. increments and persists the attempt before native delivery;
3. marks the row `delivered` only after native success or successful
   reconciliation;
4. keeps a bounded error code on a failed attempt;
5. rejects a changed response for the same native conversation and call as a
   conflict;
6. returns an exact duplicate without redelivery after delivery is complete.

Canonical JSON and indexed columns are validated against each other on every
read. Corruption fails closed.

### Ambiguous-delivery reconciliation

A crash or transport failure can occur after native acceptance but before the
delivered marker commits. Before any retry with a prior attempt, and again
after a failed `POST`, main reads the native pending-confirmation list:

- if the call is absent, the immutable row is reconciled as delivered;
- if the call is still pending, the exact stored body may be retried;
- if pending state cannot be verified, no blind redelivery occurs.

Startup reconciles at most 100 pending rows. Native loopback requests are fixed
to `127.0.0.1`, pass the existing Actestra bridge allowlist, time out after 10
seconds, and reject responses larger than 64 KiB.

### Error compatibility

A structured native `4xx` or `5xx` remains the user-visible status and stable
error code. Returned detail objects are byte-bounded and recursively redact
credential-like keys. Invalid authority input returns `400`, immutable
conflicts return `409`, and persistence, reconciliation, or transport
uncertainty returns a bounded `503`.

Authority failure does not silently call the native write path. Only the
explicit rollback result may do so.

### Migration and rollback

The forward migration preserves all schema version 1-4 records and creates the
version 5 outbox. F2 did not retain raw response bodies, so already resolved
pre-F3 confirmations cannot be imported. A pending native confirmation enters
F3.1 authority when the user next responds.

Launching with `ACTESTRA_APPROVAL_AUTHORITY=0` returns the explicit
`native-fallback` result to the preserved renderer and pet paths. Regenerating
the downstream tree without patch
`0003-actestra-approval-authority.mjs` is the source-level rollback.

Rollback does not delete or rewrite schema version 5 rows. They remain inert;
forward migration history and the frozen AionUi source remain unchanged.

## Consequences

### Positive

- A user decision is durable before native delivery.
- Exact duplicates are idempotent and changed decisions conflict.
- Crash-after-acceptance can be reconciled without blind redelivery.
- AionUi permission cards, ACP options, pet confirmation, bridge shape, and
  runtime behavior remain the functional UI.
- The first F3 write has an explicit authority owner, migration, rollback,
  restart, error, and parity contract.

### Costs

- SQLite still runs synchronously in desktop main and must move to a supervised
  persistence utility before broad user-workload writes.
- The exact bounded response body consumes local storage and can contain an
  opaque provider-selected value.
- Startup recovery is bounded; more than 100 pending rows require later
  reconciliation passes.
- Remote WebUI and the full P3 policy/tool release path remain outside this
  slice.

## Rejected alternatives

### Deliver first, write evidence afterward

Rejected because a crash after native acceptance would lose the only durable
decision and make retries ambiguous.

### Retry every unresolved row blindly

Rejected because a native runtime may already have accepted the response.

### Treat unknown option identifiers as approved

Rejected because ACP option IDs are provider-generated and do not carry
portable allow or reject semantics.

### Replace the AionUi permission UI

Rejected because ADR-0010 makes the original functional UI the product
contract. F3.1 changes authority below it.

### Fall back on every authority error

Rejected because bypassing failed persistence would create two write paths and
destroy the persist-before-deliver guarantee.

### Import F2 shadow approval evidence

Rejected because F2 intentionally omitted raw native identifiers and response
bodies and is not migration authority.

## Review triggers

Review this decision if:

- policy evaluation, protected-operation release, or P3 approval/audit records
  move into this path;
- pending-confirmation creation or reads move from native AionCore to Actestra;
- remote WebUI is proposed as Actestra-authoritative;
- more than 100 pending decisions or synchronous main-process writes become a
  realistic workload;
- the native confirmation route or response schema changes;
- AionUi is updated from `v2.1.41`;
- rollback would delete rows or rewrite migration history.
