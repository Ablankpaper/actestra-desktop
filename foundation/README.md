# AionUi Native Foundation

This directory establishes the native AionUi `v2.1.41` preservation baseline
selected by ADR-0010.

## Contents

- `aionui-v2.1.41/` is an unmodified source snapshot from exact upstream commit
  `2d8925fc67a97a20996fadcd2a0862b778b572ba`.
- `AIONUI_V2.1.41_SOURCE_MANIFEST.sha256` records every source-snapshot file.
- `aionui-v2.1.41.provenance.json` records the immutable pin, manifest hash,
  file count, and license.
- `aionui-v2.1.41.compatibility.json` is the first machine-readable Actestra
  compatibility contract: all native routes are R0 and every bridge domain is
  R1 or R2; no domain has a remove disposition.
- `AIONUI_V2.1.41_SCOPE.md` records the exact runnable-desktop selection and
  excluded non-desktop categories.

Do not edit files inside the snapshot directly. Actestra compatibility work
belongs in reviewed overlays or in an explicitly recorded downstream patch
series. A snapshot change requires an updated upstream pin, import record,
manifest, compatibility proof, and accepted review.

## Commands

From the Actestra repository root:

```sh
bun run foundation:aionui:check
bun run foundation:aionui:install
bun run foundation:aionui:test
bun run foundation:aionui:package
bun run foundation:aionui:dev
```

The native development app currently requires an AionCore runtime. A local
evaluation may link the exact verified AionCore `v0.1.52` bundle at
`resources/bundled-aioncore`; that local link is ignored and is not part of the
committed snapshot or a distribution decision.

The legacy root Electron shell remains a P3 platform-contract harness while the
native AionUi application is fused with Actestra authority. It is not the
target product interface.
