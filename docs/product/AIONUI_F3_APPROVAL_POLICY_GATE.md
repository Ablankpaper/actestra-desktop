# AionUi F3.2 Approval Delivery Policy Gate

Date: 2026-07-29

Branch: `feat/aionui-f3-policy-audit`

Base: `61b9405fc007aa8cb16ec05a65f421cb7d277b51`

Implementation: `20e3c0fcada0d072fc35820d43b85c953bf93929`

Pull request: [7](https://github.com/bignormal/actestra-desktop/pull/7)

Final PR head: `df821ca203bea7b611fa8fb8092d00a16cabe578`

Squash merge: `ce19dbe072328e16dcdaf116b8199d5502cb44c6`

## Outcome

F3.2 keeps the original AionUi confirmation experience and places one exact
effect beneath the accepted Actestra P3 authority chain: delivery of an
already persisted desktop response to loopback AionCore.

It does not infer or authorize the underlying native tool.

## Preserved product contract

F3.2 changes no renderer layout, route, permission card, ACP option, pet
confirmation, loading state, or HTTP response shape. The four protected R0
files remain byte-identical.

The existing F3.1 sequence remains:

1. validate the fixed desktop response intent;
2. reserve the immutable schema version 5 decision;
3. begin one durable delivery attempt;
4. deliver or reconcile;
5. mark delivered only after success or confirmed native acceptance.

Step 4 now enters the P3 gateway before the loopback POST.

## Closed capability

| Field | F3.2 value |
| --- | --- |
| Tool | `aionui-approval-delivery-v1` |
| Action | `network.request` |
| Resource | `external-service` |
| Credentials | Forbidden |
| Input | Opaque hash-and-attempt reference |
| Manifest timeout | 12 seconds |
| Policy | One exact allow rule |
| Audit | `policy.evaluated`, `tool.started`, then completion or failure |

The exact allow rule is not a second user approval. It permits only delivery of
the response that F3.1 already accepted from the preserved confirmation UI.
Every other tool remains outside this composition and fails closed.

## Privacy and authority

Audit records contain private compatibility-scoped hashes for correlation.
They exclude:

- raw native conversation, call, and message identifiers;
- prompts, descriptions, commands, workspace paths, and filenames;
- option values and delivery bodies;
- input references in renderer projections;
- credentials, credential values, and arbitrary native errors.

The compatibility identifiers do not create authoritative workspace, task,
session, or worker records. Native AionCore still owns pending confirmation
creation, provider-specific option semantics, and protected-operation
execution.

## Failure behavior

| Failure | Result |
| --- | --- |
| Manifest or policy invalid | No native delivery |
| Policy audit unavailable | No native delivery |
| Tool-start audit unavailable | No native delivery |
| Structured native rejection | `tool.failed` persists, then the bounded native error returns |
| Completion audit unavailable | Outcome is uncertain; F3.1 reconciles before retry |
| Restart with pending outbox row | The same gate runs again after pending-state reconciliation |

The native pending-list query remains a bounded ambiguity-reconciliation read;
it is not claimed as a migrated tool or approval domain.

F3.3 later places that read behind its own capability, policy, and audit while
preserving this F3.2 delivery contract. See
[AionUi F3.3 Approval Reconciliation Policy Gate](AIONUI_F3_APPROVAL_RECONCILIATION_GATE.md).

## Migration and rollback

No schema version is added. F3.2 reuses schema version 5 decisions and schema
version 3 privileged audit records.

- `ACTESTRA_APPROVAL_POLICY_GATE=0` returns to F3.1 direct delivery while
  retaining persist-before-deliver.
- `ACTESTRA_APPROVAL_AUTHORITY=0` remains the broader native fallback.
- Regenerating without patch
  `0004-actestra-approval-policy-gate.mjs` is the source rollback.

Existing rows remain immutable and inert after rollback.

## Current validation

Local validation:

- root F3.2 policy-gate tests: 1 file, 7 tests pass;
- focused F3/P3 compatibility regression: 6 files, 44 tests pass;
- complete root gate: 32 files, 171 tests plus Electron SQLite, process smoke,
  41-source boundary, frozen/downstream checks, and production build pass;
- downstream overlay: 102 declared files, 4 R0 invariant files, and 21
  reviewed source copies pass;
- materialized focused integration: 4 files, 10 tests pass;
- materialized strict TypeScript: pass;
- complete materialized native regression: 331 files pass with 1 skipped;
  2,607 tests pass with 5 skipped;
- materialized production build: 569 main, 7 preload, and 10,163 renderer
  modules pass;
- unsigned legacy-harness package identity and clean-profile
  application/window/renderer smoke pass as regression evidence.

## Remote evidence

Implementation `20e3c0fcada0d072fc35820d43b85c953bf93929` was pushed to
PR 7. Exact implementation
[CI run 30437387097](https://github.com/bignormal/actestra-desktop/actions/runs/30437387097)
passes root source, test, type, boundary and build gates; documentation links;
materialized strict types and Actestra identity/isolation tests; native
production build; unsigned legacy-harness bundle; packaged identity/product
boundary; and clean-profile smoke.

The local CodeRabbit review raised three valid documentation issues. All were
fixed, and the follow-up completed with zero issues across all 23 changed
files. Final PR head `df821ca203bea7b611fa8fb8092d00a16cabe578`
passed
[CI run 30437723459](https://github.com/bignormal/actestra-desktop/actions/runs/30437723459).
The Ready-triggered GitHub CodeRabbit run selected all 23 files and completed
successfully under the Free-plan walkthrough, with no submitted review or
inline comment; it is not represented as an independent approval.

PR 7 squash merged the exact final head as
`ce19dbe072328e16dcdaf116b8199d5502cb44c6`.
[Main CI run 30442166290](https://github.com/bignormal/actestra-desktop/actions/runs/30442166290)
passes on that exact merge, including the root, documentation, materialized
AionUi, unsigned bundle, package-boundary, and clean-profile smoke gates.
Signed candidate and live F3.2 desktop evidence remain separate.

## Non-claims

F3.2 does not prove:

- P3 ownership of native pending confirmations;
- policy understanding of the underlying file, shell, MCP, or other tool;
- P3 one-shot approval consumption for that native operation;
- credential use, a general input-reference store, or a general executor;
- remote WebUI approval authority;
- Goose, Eigent-style orchestration, candidate, release, distribution, or user
  acceptance.

## Governing decisions

- [ADR-0010](../architecture/decisions/0010-aionui-first-product-foundation.md)
- [ADR-0011](../architecture/decisions/0011-aionui-shadow-projection.md)
- [ADR-0012](../architecture/decisions/0012-aionui-approval-decision-authority.md)
- [ADR-0013](../architecture/decisions/0013-aionui-approval-delivery-policy-gate.md)
