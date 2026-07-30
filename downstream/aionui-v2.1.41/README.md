# Actestra Downstream Overlay for AionUi v2.1.41

This directory contains the reviewable Actestra patch series applied on top of
the immutable AionUi `v2.1.41` foundation.

The source of truth remains
[`foundation/aionui-v2.1.41`](../../foundation/aionui-v2.1.41). Files under
that directory must continue to match the recorded SHA-256 manifest exactly.
Actestra development commands materialize a generated working tree under
`.actestra/aionui-v2.1.41` and apply the patches listed in
[`overlay.json`](overlay.json).

## Rules

- Never edit the frozen foundation to implement an Actestra change.
- Keep one functional boundary per patch group.
- Record every changed or added path in `overlay.json`.
- Preserve all AionUi routes, feature entries, interaction structure, and
  bridge-domain shapes unless a later owner-approved ADR permits a specific
  difference.
- R1 patches may change product identity or provider authority while preserving
  the user flow.
- R2 patches retain the entry and return an explicit isolation reason instead
  of performing an unowned external effect.
- CDP classification is R0 for unchanged settings UI, R1 for the
  Actestra-owned `ACTESTRA_CDP_PORT` primary input and compatible legacy shim,
  and R2 for packaged-listener denial. The Actestra downstream compatibility
  layer owns the retained `AIONUI_CDP_PORT` shim on behalf of frozen upstream
  E2E and benchmark callers. Remove it only after those callers migrate to
  `ACTESTRA_CDP_PORT`; the Actestra variable always takes precedence. Packaged
  applications deny CDP regardless of either variable or saved config. See the
  [compatibility policy test](patches/0001-actestra-identity-and-isolation.mjs)
  and [native packaged-launch proof](../../docs/product/AIONUI_FIRST_PR6_REVIEW_CLOSURE.md#local-verification).
- F2 compatibility observers are metadata-only and fail-isolated. Native
  AionUi responses, routes, state, and UI remain authoritative; shadow evidence
  cannot drive user-visible decisions.
- F3.1 routes desktop permission-card and pet confirmation decisions through a
  fixed main-frame operation. The Actestra SQLite outbox is authoritative for
  the immutable decision before the local native runtime receives it; pending
  delivery is reconciled on retry and restart.
- `ACTESTRA_APPROVAL_AUTHORITY=0` is the explicit F3.1 rollback switch. It
  restores the retained native confirmation path without deleting version 5
  authority rows or modifying the frozen source.
- F3.2 gates only delivery of the persisted response through an exact loopback
  capability. F3.3 separately gates the bounded pending-state read used before
  a retry and during restart recovery. Neither path interprets or authorizes
  the underlying native tool.
- `ACTESTRA_APPROVAL_RECONCILIATION_GATE=0` bypasses only the F3.3
  `isPending` wrapper, returning that read to F3.1 direct native
  reconciliation while retaining F3.2 delivery.
  `ACTESTRA_APPROVAL_POLICY_GATE=0` retains the broader F3.1 rollback, so
  reconciliation does not remain enabled without the F3.2 delivery gate.
- GW-P4.5 performs bounded General Work recovery after the schema v7
  persistence utility and scoped native tool platform are ready, but before
  the preserved AionUI window is created. Recovery checkpoints, tool ambiguity,
  artifact ownership, terminal events, domain state, and attempt evidence stay
  under Actestra Core authority; no renderer route or feature entry changes.
- GW-P4.6 adds one strict text intent to the preserved SendBox. Main resolves
  native workspace context, schema v8 atomically registers the journey
  authority, and a real supervised Worker produces one task-owned output.
  Status, cancellation, and exact-owner content project through native message
  and Preview surfaces; Preview content is transient and not cached in
  renderer `localStorage`. Ordinary native sends and all other retained
  features remain unchanged.
- An explicit E2E-only target-app driver covers prepared restart recovery,
  fixture grant denial, and cancellation against the exact pinned AionCore.
  It is disabled unless both the existing E2E guard and one closed smoke
  scenario are set; it adds no production renderer entry or general tool mode.
- Actestra-owned source files are copied into the generated tree through the
  declared `sourceCopies` contract and must remain byte-identical to their
  reviewed root sources.
- Binary product assets are copied from Actestra-owned source assets with
  recorded SHA-256 values.

## Commands

```bash
bun run foundation:aionui:check
bun run downstream:aionui:materialize
bun run downstream:aionui:check
bun run downstream:aionui:test
bun run downstream:aionui:package
bun run downstream:aionui:dist:dir
bun run smoke:aionui-general-work
bun run downstream:aionui:dev
```

Run `foundation:aionui:check` before reviewing or shipping any downstream
materialization. It is the mandatory proof that the immutable upstream source
still matches its pinned provenance and SHA-256 manifest.

The generated `.actestra` tree is disposable and ignored by Git. Removing it
does not remove the frozen source or the downstream patch series.
