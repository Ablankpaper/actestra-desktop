# P8.2 Packaged Product-Journey Evidence Gate

## Goal

Make the existing P8 product-journey smoke controller execute a real, bounded
acceptance composition inside the packaged AionUI application on each declared
P8.2 target, then bind the resulting nine-journey record to the exact source
commit, package bytes, Goose runner, and CI run.

This closes the missing execution/evidence boundary only. It does not start
P8.3 candidate trust, signing, notarization, update metadata, rollback, or
P8.4 clean-machine/user acceptance.

## Context and constraints

- The source of truth is `origin/main@22019119938a17f5d3b78627ff157ae5863fa97e`.
- `foundation/aionui-v2.1.41` remains byte-frozen.
- The existing external controller in
  `scripts/smoke-p8-product-journeys.mjs` already validates package layout,
  isolated profile directories, package hashes, runner attestation inputs,
  bounded result-file syntax, process probes, and exact binding.
- Existing P8 fresh-profile and P7 packaged smokes establish the accepted
  pattern: an explicit environment marker, Main-owned bounded execution, a
  write-once result file, graceful app exit, and external hash/binding checks.
- The current P8.2 ledger remains `evidence-incomplete` until exact current-SHA
  evidence exists for every required journey row.
- No renderer authority, generic IPC, raw credentials, source-workspace path,
  arbitrary network, or private Worker state may be added.

## Selected approach

Add one Actestra-owned packaged acceptance coordinator behind a new downstream
overlay patch. The coordinator is enabled only when all required P8 smoke
environment fields are present and `ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE=1`.
It runs after the packaged application's existing Main/Core initialization and
renderer load, using the already composed Main-owned services and the same
deterministic loopback Provider/model boundary used by the accepted P6
development journey. It writes one exact, newline-terminated
`p8-product-journeys-result.json` under the isolated Actestra user-data path
only after all nine journeys and cleanup have completed.

The new behavior is implemented in a focused source module copied through the
downstream `sourceCopies` contract and installed by a recorded R1/R2 patch
(`0024-actestra-p8-product-journey-smoke.mjs`). The patch adds no user-facing
route and is inert outside the explicit smoke environment.

## Journey execution contract

The packaged coordinator executes the exact matrix order:

1. `fresh-profile-launch` — existing startup/profile result is retained as the
   first journey observation.
2. `general-artifact` — submit a bounded General task through Main/Core,
   require durable terminal state and an Actestra-owned Artifact reference,
   and verify no raw content/path escapes the bounded result.
3. `goose-isolated-patch` — start the admitted Goose coding journey in an
   isolated Git worktree, complete a bounded file/test change through the six
   closed tools, capture the patch, and require the source checkout to remain
   unchanged.
4. `workspace-apply-approval` — require a separate persisted approval before
   Main-owned apply, verify exact re-capture/digest and destination binding,
   and reject any approval or workspace drift.
5. `general-goose-team` — create an orchestrated Team, admit the bounded
   planner graph, run General and Goose nodes, persist result references, and
   expose only the existing bounded Team projection.
6. `cancellation-no-orphan` — cancel an in-flight attempt and verify durable
   cancellation ordering, process-group termination, grant/worktree cleanup,
   and zero residual privileged descendants.
7. `crash-restart-recovery` — force the accepted Worker failure/restart
   boundary, restart the packaged app once, and verify recovery reads durable
   state without replaying an already committed effect or launching an orphan.
8. `privacy-redaction` — inspect only bounded Main-owned evidence and verify
   credentials, raw provider values, private paths, raw tool payloads, and
   Worker/process identifiers are absent from Renderer-visible and result-file
   projections.
9. `p7-platform-obligations` — invoke the already accepted packaged P7
   security, resource, diagnostic/audit, and cleanup authorities and require
   their closed denied-safe/verified outcomes for the target.

Each journey returns only `{ id, status, residualProcessCount }` to the result
file. Detailed diagnostics stay in bounded CI artifacts owned by the external
controller. A journey may be `verified` only when its exact durable assertions
and cleanup checks pass; the coordinator fails closed with a stable error and
does not write a fabricated success record on timeout, unavailable provider,
missing runner, drift, ambiguous effect, or cleanup failure.

## Lifecycle and data flow

```text
CI package job
  → smoke-p8-product-journeys.mjs
  → isolated env + package/runner binding
  → packaged AionUI Main startup
  → P8 coordinator after renderer-ready
  → Main/Core/Utility/General/Goose/Team authorities
  → exact result file + graceful exit
  → external controller re-hashes package/result/process tree
  → p8:journeys:check validates exact evidence shape and binding
```

The coordinator owns only test orchestration and bounded assertions. It does
not become a product authority: product identifiers, approvals, artifacts,
events, workspace grants, Git binding, and cleanup remain delegated to the
existing Actestra services. It uses a fresh isolated profile and temporary
workspace supplied by the controller, never the user's source checkout.

The app must not exit until persistence writes and worker/process cleanup have
completed. On failure it writes a bounded failure record where the controller's
closed failure vocabulary can classify it, then exits non-zero. All cleanup is
attempted and aggregated; residual processes or uncertain effects are failure,
not a pass.

## Files and boundaries

- Create `apps/desktop/src/main/security/p8ProductJourneySmoke.ts` for the
  Main-side coordinator contract, environment parsing, journey result shape,
  lifecycle, and bounded failure codes.
- Add the source-copy declaration and authority metadata to
  `downstream/aionui-v2.1.41/overlay.json`.
- Create
  `downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs`
  to inject the coordinator into the native packaged startup after the
  existing Team/General/Coding composition is ready and after renderer load.
- Extend `.github/workflows/ci.yml` so macOS, Windows, and Ubuntu final package
  jobs invoke the existing external controller with the exact package and
  runner bindings and upload its evidence file.
- Extend the P8 ledger/status only after exact-head CI produces current-SHA
  evidence; no status text should promote local or PR-only evidence.

## Testing strategy

Use TDD at the coordinator and patch contracts before implementation:

- unit tests for closed environment parsing, exact journey order/result shape,
  failure mapping, write-once result behavior, timeout, cleanup aggregation,
  and privacy assertions;
- downstream contract tests proving the patch is R1/R2, source-copy hashes are
  declared, the frozen foundation is untouched, the hook is inert without the
  smoke marker, and the native startup awaits the coordinator before exit;
- external-controller tests remain the binding authority for package hashes,
  runner attestation, isolation, process probes, and malformed-result rejection;
- materialized native TypeScript and focused downstream tests run before the
  full root gate;
- exact-head CI must execute the three native package jobs and upload
  current-SHA journey records before the ledger is updated.

## Failure and rollback

Any missing composition, provider/model admission, unsupported target
primitive, package/runner mismatch, uncommitted workspace, approval drift,
ambiguous persistence response, malformed result, timeout, or residual process
returns a closed failure. The smoke marker is the only activation gate, so
ordinary development and user startup are unchanged.

Rollback is to remove patch `0024` and its declared source copy, remove the
three CI invocations and evidence upload, and regenerate the downstream tree.
Existing P8.2 fresh-profile, P7, General Work, Goose, Team, persistence, and
frozen-foundation behavior remains available; no schema downgrade or native
profile mutation is required.

## Non-claims

This design does not claim:

- P8.2 completion before all 27 target/journey rows are exact-SHA `verified`;
- P8.3 candidate integrity, signing, notarization, update trust, or rollback;
- P8.4 clean-machine installation, upgrade, uninstall, real-provider, runbook,
  issue-intake, or user acceptance;
- a release, deployment, distribution, tag, or GitHub Release;
- CrewAI, Claude CLI, Codex CLI, Eigent, or another external application/runtime
  being imported or admitted.
