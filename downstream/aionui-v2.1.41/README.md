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
- Actestra-owned P3 source files are copied into the generated tree through the
  declared `sourceCopies` contract and must remain byte-identical to their
  reviewed root sources.
- Binary product assets are copied from Actestra-owned source assets with
  recorded SHA-256 values.

## Commands

```bash
bun run downstream:aionui:materialize
bun run downstream:aionui:check
bun run downstream:aionui:test
bun run downstream:aionui:package
bun run downstream:aionui:dev
```

The generated `.actestra` tree is disposable and ignored by Git. Removing it
does not remove the frozen source or the downstream patch series.
