# Third-Party Notices

Actestra uses third-party runtime and development packages from locked Bun
dependency graphs. The AionUi-first foundation contains the exact AionUi source
snapshot recorded below. It contains no committed AionCore binary, Goose,
CrewAI, Eigent, Aera, or AgentEra source or asset.

## Distributed runtime components

| Component | Version | License | Packaged notice location | Source |
| --- | --- | --- | --- | --- |
| Electron | `37.10.3` | MIT plus Chromium third-party licenses | `Contents/Resources/LICENSE.electron.txt` and `LICENSES.chromium.html` | <https://github.com/electron/electron> |
| React | `19.2.4` | MIT | `app.asar/node_modules/react/LICENSE` | <https://react.dev/> |
| React DOM | `19.2.4` | MIT | `app.asar/node_modules/react-dom/LICENSE` | <https://react.dev/> |
| Scheduler | `0.27.0` | MIT | `app.asar/node_modules/scheduler/LICENSE` | <https://www.npmjs.com/package/scheduler> |

The package verifier fails if the Electron and Chromium notices are absent.
The React packages are also bundled into renderer output, while their package
directories and license texts are retained in ASAR by the current packager.

## Imported application source

| Component | Revision | License | Imported material | Notice location |
| --- | --- | --- | --- | --- |
| AionUi | `v2.1.41` (`2d8925fc67a97a20996fadcd2a0862b778b572ba`) | Apache-2.0; no root `NOTICE` | Exact 1,766-file runnable desktop source, build, test, example, patch, and functional-resource snapshot | Repository: `foundation/aionui-v2.1.41/LICENSE`; native Actestra package notice location must be verified before a candidate |

The exact source and destination paths, hashes, copyright statements, and
modification records are in the
[Upstream Import Log](docs/upstream/IMPORT_LOG.md). The SHA-256 source manifest
and provenance record are under `foundation/`. Original Actestra code remains
unlicensed pending the owner's license decision; Apache-2.0 applies to the
AionUi material identified there.

## Direct development and test dependencies

These packages are required to build, test, lint, format, or package the
repository. They are not represented as Actestra-authored code.

| Packages | Versions | License |
| --- | --- | --- |
| `@testing-library/jest-dom`, `@testing-library/react` | `6.9.1`, `16.3.2` | MIT |
| `@types/node`, `@types/react`, `@types/react-dom` | `24.12.0`, `19.2.14`, `19.2.3` | MIT |
| `@vitest/coverage-v8`, `vitest`, `jsdom` | `4.1.0`, `4.1.0`, `28.1.0` | MIT |
| `@electron/asar`, `electron-builder`, `electron-vite`, `vite` | `3.4.1`, `26.15.2`, `5.0.0`, `6.4.1` | MIT |
| `oxfmt`, `oxlint` | `0.41.0`, `1.56.0` | MIT |
| TypeScript | `5.9.3` | Apache-2.0 |

Transitive dependency licenses remain part of the locked package graph and must
be represented in the P8 SBOM and candidate notice bundle. This P2 inventory is
not a release-grade transitive license report.

## Evaluated references

The following projects remain architectural or evaluation references only.
Exact evaluation pins do not change their non-imported status.

| Project | Evaluated revision | Observed root license | Role | Source |
| --- | --- | --- | --- | --- |
| AionCore | `v0.1.52` (`76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d`) | Root Apache-2.0; Cargo metadata says MIT; no root `NOTICE` | Ignored local F0 launch runtime and proposed initial general-worker compatibility runtime; not committed or approved for distribution | <https://github.com/iOfficeAI/AionCore> |
| Goose | Not selected | Not yet inspected | Specialized coding and terminal worker | <https://github.com/aaif-goose/goose> |
| CrewAI | `1.15.8` (`e9caf1e1b89343bb833b5da6660faa91804a9dce`) | MIT | First supervised P6 planner-sidecar candidate; metadata inspected only, with no source or package imported | <https://github.com/crewAIInc/crewAI> |
| Eigent | `v1.0.2` (`e478094a9ff433132b3cf1928e4143338ddaab20`) | Root Apache-2.0; root `package.json` says MIT | Team product and acceptance reference; metadata inspected only, with no source or runtime imported | <https://github.com/eigent-ai/eigent> |

This file must be updated in the same change that imports, vendors, bundles,
upgrades, or distributes third-party code or assets. A reference link alone
does not satisfy license or notice obligations.

The exact AionUi runnable desktop source selection is committed as the accepted
product foundation; its installed dependencies and generated packages are
ignored. Before a native Actestra candidate, the full transitive runtime
inventory, packaged Apache-2.0 license, third-party asset notices, SBOM, and
provenance must be verified.
AionCore distribution remains blocked until its license inconsistency and
binary provenance are resolved. See the
[baseline report](docs/upstream/AIONUI_V2.1.41_BASELINE.md) and
[native foundation evidence](docs/product/AIONUI_NATIVE_FOUNDATION.md).
