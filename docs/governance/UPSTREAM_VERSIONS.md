# Upstream Versions

This file records immutable upstream revisions and verification evidence.

## Current pins

P1 selected and verified the following pins on 2026-07-27. The complete
runnable AionUi desktop source foundation was imported on 2026-07-29 under
ADR-0010.

| Upstream | Repository | Version or tag | Exact commit | Integration | Status |
| --- | --- | --- | --- | --- | --- |
| AionUi | `iOfficeAI/AionUi` | `v2.1.41` | `2d8925fc67a97a20996fadcd2a0862b778b572ba` | Product UI and general-work foundation | P1 reproduced; exact 1,766-file runnable desktop snapshot imported and manifest-verified |
| AionCore | `iOfficeAI/AionCore` | `v0.1.52` | `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d` | Initial native compatibility runtime/general worker | P1 locally built; ignored local bundle used for F0 launch; not committed or approved for distribution |
| Croner | `Hexagon/croner` | `9.1.0` | `364a3074c2642b903eaf26e96f4bc197e3eaa6bc` | Main-owned schedule validation and occurrence calculation | Exact npm and downstream-native pin; MIT notice retained and package-verified |
| Goose | `aaif-goose/goose` | Not selected | Not selected | Worker adapter | Pending P5 |
| CrewAI | `crewAIInc/crewAI` | `1.15.8` evaluation snapshot | `e9caf1e1b89343bb833b5da6660faa91804a9dce` | First supervised planner-sidecar candidate | Metadata and license verified; not imported, installed, bundled, or selected as the production P6 pin |
| Eigent | `eigent-ai/eigent` | `v1.0.2` reference snapshot | `e478094a9ff433132b3cf1928e4143338ddaab20` | Team product and acceptance reference | Metadata inspected; not imported, installed, bundled, or selected as a runtime |

## CI action pins

The following actions are executed by CI and are not imported into or
distributed with the Actestra application. The immutable commits were resolved
from the corresponding official GitHub tags on 2026-07-28.

| Action | Version | Exact commit | Use |
| --- | --- | --- | --- |
| `actions/checkout` | `v4.4.0` | `11d5960a326750d5838078e36cf38b85af677262` | Repository checkout |
| `actions/setup-node` | `v4.4.0` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | Node.js 24.13.0 setup |
| `oven-sh/setup-bun` | `v2.2.0` | `0c5077e51419868618aeaa5fe8019c62421857d6` | Bun 1.3.9 setup |

## AionUi v2.1.41 evidence

- Selection date: 2026-07-27.
- Upstream URL: <https://github.com/iOfficeAI/AionUi>.
- Release/tag: `v2.1.41`, published 2026-07-24.
- License: root Apache-2.0 `LICENSE`; no root `NOTICE`.
- Bundled backend: AionCore `v0.1.52` at
  `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d`.
- AionCore binary SHA-256:
  `29dea30561b1457ac784c5fa48a58a63c6580b0e8cee8d7471ed079e0e50908c`.
- Imported path: complete runnable desktop source selection under
  `foundation/aionui-v2.1.41`, including source, build configuration, lockfile,
  patches, functional resources, examples, tests, and Apache-2.0 license.
- Provenance: 1,766 source-snapshot files; manifest SHA-256
  `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`;
  all files, 27 routes, and 41 bridge domains verified by
  `bun run foundation:aionui:check`.
- Local modifications inside the snapshot: none. Later Actestra work uses a
  recorded patch series or overlay.
- Local reproduction: frozen install and native production build pass; native
  Electron launch passes in an isolated profile with update effects disabled.
  After restoring one exact upstream workflow fixture omitted from the first
  archive selection, the complete native rerun passes 321 files with 1 skipped
  and 2,576 tests with 5 skipped.
- Previous or rollback revision: none; this is the first selected pin.
- Toolchain, commands, tests, package checksums, incompatibilities, and
  reproduction proof:
  [AionUi v2.1.41 Baseline](../upstream/AIONUI_V2.1.41_BASELINE.md).
- Current and planned disposition:
  [AionUi Module Map](../upstream/AIONUI_MODULE_MAP.md) and
  [Retention Matrix](../upstream/AIONUI_RETENTION_MATRIX.md).

## AionCore license note

AionCore's root `LICENSE` is Apache-2.0, while its workspace `Cargo.toml`
declares `license = "MIT"`. There is no root `NOTICE`. This inconsistency must be
clarified before Actestra distributes AionCore-derived code or binaries.

## Croner 9.1.0 evidence

- Verification date: 2026-07-31.
- Upstream URL: <https://github.com/Hexagon/croner>.
- Release/tag: `9.1.0`; exact commit:
  `364a3074c2642b903eaf26e96f4bc197e3eaa6bc`.
- Root and npm-package license: MIT, with
  `Copyright (c) 2015-2021 Hexagon` retained in the packaged ASAR.
- Root and materialized AionUI dependency specs are exact `9.1.0`; the locked
  npm integrity is
  `sha512-p9nwwR4qyT5W996vBZhdvBCnMhicY5ytZkR4D1Xj0wuTDEiMnjwR57Q3RXYY/s0EpX6Ay3vgIcfaR+ewGHsi+g==`.
- Runtime scope is limited to main-owned validation and next-occurrence
  calculation under ADR-0023. The renderer receives neither Croner nor timer
  authority.

## CrewAI 1.15.8 evaluation snapshot

- Verification date: 2026-07-30.
- Upstream URL: <https://github.com/crewAIInc/crewAI>.
- Release/tag: `1.15.8`, published 2026-07-28.
- Annotated tag object:
  `f11db7e821698db558a02320e847beb6f49e7299`; exact commit:
  `e9caf1e1b89343bb833b5da6660faa91804a9dce`.
- Root license: MIT.
- Declared Python range: `>=3.10,<3.14`.
- Current role: first P6 planner-sidecar candidate under
  [ADR-0015](../architecture/decisions/0015-crewai-supervised-orchestration-sidecar.md).
- Import status: none. No CrewAI package, source, lockfile, Python runtime, or
  binary is committed or distributed by Actestra.
- Production selection remains blocked on a fresh exact-version review,
  minimal dependency lock, telemetry and network proof, SBOM, `pip-audit`,
  protocol and recovery tests, and macOS, Windows, and Linux packaging
  evidence.

## Eigent v1.0.2 reference snapshot

- Verification date: 2026-07-30.
- Upstream URL: <https://github.com/eigent-ai/eigent>.
- Release/tag: `v1.0.2`, published 2026-07-21.
- Annotated tag object:
  `6bca9204fd3903455aaed1311e624318b18fc58e`; exact commit:
  `e478094a9ff433132b3cf1928e4143338ddaab20`.
- Observed root license: Apache-2.0.
- Observed root `package.json` license value: `MIT`.
- Backend Python range: `>=3.11,<3.12`; declared backend dependency:
  `camel-ai[eigent]==0.2.91a5`.
- Current role: Team interaction and acceptance reference only. The complete
  Electron UI, FastAPI service, Task Service, memory, tools, workspace, and
  CAMEL runtime are not imported.
- Any future source reuse requires a new exact comparison, license-metadata
  clarification, attribution record, and accepted integration decision.

## Required evidence per pin

Add the following when a revision is selected:

- selection date;
- upstream URL;
- tag or release name;
- full commit SHA;
- license and NOTICE paths;
- checksum for downloaded binary artifacts, if any;
- toolchain versions;
- clean install command and result;
- build command and result;
- test command and result;
- package command and result;
- imported paths or packages;
- local patch location;
- known incompatibilities and rollback revision.

Do not replace an old entry without retaining update history in Git and the
changelog.
