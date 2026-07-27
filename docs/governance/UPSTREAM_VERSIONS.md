# Upstream Versions

This file records immutable upstream revisions and verification evidence.

## Current pins

No upstream source has been imported into Actestra. P1 selected and verified the
following evaluation pins on 2026-07-27.

| Upstream | Repository | Version or tag | Exact commit | Integration | Status |
| --- | --- | --- | --- | --- | --- |
| AionUi | `iOfficeAI/AionUi` | `v2.1.41` | `2d8925fc67a97a20996fadcd2a0862b778b572ba` | Foundation evaluation | P1 locally reproduced; not imported |
| AionCore | `iOfficeAI/AionCore` | `v0.1.52` | `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d` | AionUi backend dependency | P1 locally built and packaged; not imported |
| Goose | `aaif-goose/goose` | Not selected | Not selected | Worker adapter | Pending P5 |
| Eigent | `eigent-ai/eigent` | Not selected | Not selected | Reference-first | Pending P6 |

## AionUi v2.1.41 evidence

- Selection date: 2026-07-27.
- Upstream URL: <https://github.com/iOfficeAI/AionUi>.
- Release/tag: `v2.1.41`, published 2026-07-24.
- License: root Apache-2.0 `LICENSE`; no root `NOTICE`.
- Bundled backend: AionCore `v0.1.52` at
  `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d`.
- AionCore binary SHA-256:
  `29dea30561b1457ac784c5fa48a58a63c6580b0e8cee8d7471ed079e0e50908c`.
- Imported paths or packages: none.
- Local patches: none.
- Previous or rollback revision: none; this is the first selected pin.
- Toolchain, commands, tests, package checksums, incompatibilities, and
  reproduction proof:
  [AionUi v2.1.41 Baseline](../upstream/AIONUI_V2.1.41_BASELINE.md).
- Planned disposition:
  [AionUi Module Map](../upstream/AIONUI_MODULE_MAP.md).

## AionCore license note

AionCore's root `LICENSE` is Apache-2.0, while its workspace `Cargo.toml`
declares `license = "MIT"`. There is no root `NOTICE`. This inconsistency must be
clarified before Actestra distributes AionCore-derived code or binaries.

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
