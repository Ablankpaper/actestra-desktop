# Upstream Import Log

This file records source, asset, binary, prompt, Skill, model, and other
copyrightable material imported into Actestra.

## Current inventory

ADR-0010 accepts AionUi as the complete functional-UI and general-work product
foundation. On 2026-07-29, Actestra imported one cohesive frozen snapshot from
AionUi `v2.1.41` at exact commit
`2d8925fc67a97a20996fadcd2a0862b778b572ba`.

The snapshot contains 1,766 files: desktop application source, build and
packaging configuration, lockfile, patches, functionally required platform
resources, examples, unit/integration/E2E tests, and the upstream Apache-2.0
license. It contains no local modifications.

The upstream commit has 2,033 tracked files. The 267 excluded files are the
separate mobile application, promotional/reference media, upstream
repository/CI/governance documents, and non-desktop root tooling. No tracked
file under `packages`, `public`, `patches`, `tests`, or `examples` is excluded.
The exact scope and counts are in
[AionUi Source Scope](../../foundation/AIONUI_V2.1.41_SCOPE.md).

No AionCore binary, Goose source, Eigent source, Aera source, AgentEra source,
credential, user data, or upstream release secret is committed. An ignored
local link to the previously evaluated AionCore `v0.1.52` bundle was used only
for native launch proof.

## Import record

| Date | Upstream and immutable revision | Original path | Actestra destination | License and notice | Modification record | Validation |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-07-29 | `iOfficeAI/AionUi` tag `v2.1.41`, commit `2d8925fc67a97a20996fadcd2a0862b778b572ba` | Exact runnable desktop selection from the accepted Git tree | `foundation/aionui-v2.1.41/` | Apache-2.0 in `foundation/aionui-v2.1.41/LICENSE`; no upstream root `NOTICE` | Exact unmodified snapshot; downstream product changes must live in a recorded patch series or overlay | 1,766-file manifest; manifest SHA-256 `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`; `bun run foundation:aionui:check` verifies every file, 27 routes, and 41 bridge domains |

## Provenance files

- [Provenance record](../../foundation/aionui-v2.1.41.provenance.json)
- [Source manifest](../../foundation/AIONUI_V2.1.41_SOURCE_MANIFEST.sha256)
- [Foundation instructions](../../foundation/README.md)
- [Source scope](../../foundation/AIONUI_V2.1.41_SCOPE.md)
- [Native launch evidence](../product/AIONUI_NATIVE_FOUNDATION.md)
- [Retention matrix](AIONUI_RETENTION_MATRIX.md)

## Downstream patch records

No downstream patch is applied inside the frozen snapshot at F0.

For every later patch group, add a row with:

- upstream file and symbol;
- patch or overlay destination;
- R0, R1, or R2 classification;
- user-visible difference, if any;
- Actestra authority owner;
- migration and rollback behavior;
- native and compatibility test evidence;
- license and modification notice handling.

Generated packages and local evaluation profiles do not belong in this
repository.
