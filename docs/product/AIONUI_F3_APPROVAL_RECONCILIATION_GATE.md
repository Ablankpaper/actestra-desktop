# AionUi F3.3 Approval Reconciliation Policy Gate

Date: 2026-07-29

Branch: `feat/aionui-f3-reconciliation-audit`

Base: `ce19dbe072328e16dcdaf116b8199d5502cb44c6`

## Outcome

F3.3 preserves the original AionUi confirmation UI and closes the remaining
policy bypass in F3.1 retry and restart recovery: the bounded loopback read
that checks whether one previously attempted native call is still pending.

It does not take ownership of pending-confirmation creation or the underlying
native tool.

## Preserved product contract

F3.3 changes no renderer, route, permission card, ACP option, pet confirmation,
Team count, loading state, HTTP response shape, or preload API. The four
protected R0 files remain byte-identical.

The existing F3.1/F3.2 sequence remains:

1. persist the immutable desktop response;
2. persist a delivery attempt;
3. if the outcome may be ambiguous, check native pending state;
4. if still pending, send through the F3.2 delivery gate;
5. mark delivered only after native success or confirmed absence.

Only step 3 enters the new F3.3 gate.

## Closed capability

| Field | F3.3 value |
| --- | --- |
| Tool | `aionui-approval-reconciliation-read-v1` |
| Action | `network.request` |
| Resource | `external-service` |
| Credentials | Forbidden |
| Input | Main-generated in-memory reference |
| Output | In-memory boolean only |
| Manifest timeout | 12 seconds |
| Policy | One exact allow rule |
| Audit | `policy.evaluated`, `tool.started`, then completion or failure |

Only a schema version 5 `pending-delivery` decision with at least one attempt
can enter the gate. The actual native list is bounded and reduced to a boolean
inside the loopback compatibility transport.

## Privacy and authority

The new durable audit records exclude:

- raw native conversation, call, and message identifiers;
- native confirmation arrays;
- titles, prompts, descriptions, commands, paths, and filenames;
- option labels, option values, response bodies, and arbitrary diagnostics;
- credentials and credential references.

Compatibility-scoped hashes correlate the read with the F3.2 delivery evidence,
but do not create authoritative workspace, task, session, worker, or pending
confirmation records.

The hashed conversation/call identity also provides the stable in-memory key
for coalescing concurrent reads. Concurrent callers share one native read and
one audit sequence; the key is released on either success or failure.

## Failure behavior

| Failure | Result |
| --- | --- |
| Decision has no prior attempt | No native read |
| Manifest or policy invalid | No native read |
| Policy or tool-start audit unavailable | No native read |
| Native list invalid, unavailable, or timed out | `tool.failed`; no reconciliation decision |
| Completion audit unavailable | Read outcome is uncertain and not consumed |
| Concurrent read for the same confirmation | Joins the existing in-flight read; no duplicate native access |
| Call absent with complete audit | Existing F3.1 row can reconcile as delivered |
| Call present with complete audit | Existing F3.1 rules may permit the stored response to retry through F3.2 |

F3.3 does not turn a failed read into permission to redeliver.

## Composition, migration, and rollback

F3.3 is an independent wrapper around the accepted F3.2 transport:

- `isPending` is policy-gated and audited;
- `deliver` delegates to F3.2 unchanged.

No migration or schema version is added.

- `ACTESTRA_APPROVAL_RECONCILIATION_GATE=0` bypasses only F3.3 for
  `isPending`: the read returns to F3.1 direct native reconciliation while
  `deliver` remains delegated through F3.2.
- `ACTESTRA_APPROVAL_POLICY_GATE=0` returns to F3.1 and disables F3.3.
- `ACTESTRA_APPROVAL_AUTHORITY=0` remains the broad native fallback.
- Regenerating without patch
  `0005-actestra-approval-reconciliation-policy-gate.mjs` is the source
  rollback.

Existing decision and audit rows remain immutable after rollback.

## Current local validation

- new F3.3 root tests: 1 file and 7 tests pass;
- focused F3 root regression: 4 files and 24 tests pass;
- complete root gate: 33 files and 178 tests pass, including Electron SQLite,
  process smoke, 42-source product boundary, frozen/downstream checks, and
  production build;
- downstream overlay: 104 declared files, 4 R0 invariant files, and 22
  reviewed source copies pass;
- materialized focused F3 integration: 5 files and 11 tests pass;
- materialized Actestra/identity integration: 21 files and 143 tests pass;
- materialized strict TypeScript passes;
- complete materialized native regression: 332 files pass with 1 skipped;
  2,608 tests pass with 5 skipped;
- materialized production build: 570 main, 7 preload, and 10,163 renderer
  modules pass.
- unsigned legacy-harness bundle, packaged identity/product boundary, and
  clean-profile application/window/renderer smoke pass as regression evidence.

These are local working-tree results. They are not yet commit, push, CI,
candidate, release, distribution, or user-acceptance evidence.

## Non-claims

F3.3 does not prove:

- Actestra ownership of native pending-confirmation creation or list content;
- policy understanding of the underlying file, shell, MCP, or other tool;
- P3 approval consumption for that underlying operation;
- a general renderer or WebUI network-read gateway;
- credential use, general input storage, or a general native executor;
- Goose, Eigent-style orchestration, candidate, release, distribution, or
  acceptance.

## Governing decisions

- [ADR-0010](../architecture/decisions/0010-aionui-first-product-foundation.md)
- [ADR-0011](../architecture/decisions/0011-aionui-shadow-projection.md)
- [ADR-0012](../architecture/decisions/0012-aionui-approval-decision-authority.md)
- [ADR-0013](../architecture/decisions/0013-aionui-approval-delivery-policy-gate.md)
- [ADR-0014](../architecture/decisions/0014-aionui-approval-reconciliation-policy-gate.md)
