# Third-Party Notices

Actestra uses third-party runtime and development packages from locked Bun
dependency graphs. The AionUi-first foundation contains the exact AionUi source
snapshot recorded below. It contains no committed AionCore binary, Goose
upstream source tree or official binary, CrewAI, Eigent, Aera, or AgentEra
source or asset. The separately identified P5.1 Goose license and build
materials do not alter that frozen foundation.

## Distributed runtime components

| Component | Version | License | Packaged notice location | Source |
| --- | --- | --- | --- | --- |
| Electron | `37.10.3` | MIT plus Chromium third-party licenses | `Contents/Resources/LICENSE.electron.txt` and `LICENSES.chromium.html` | <https://github.com/electron/electron> |
| React | `19.2.4` | MIT | `app.asar/node_modules/react/LICENSE` | <https://react.dev/> |
| React DOM | `19.2.4` | MIT | `app.asar/node_modules/react-dom/LICENSE` | <https://react.dev/> |
| Scheduler | `0.27.0` | MIT | `app.asar/node_modules/scheduler/LICENSE` | <https://www.npmjs.com/package/scheduler> |
| Croner | `9.1.0` | MIT | `app.asar/node_modules/croner/LICENSE` | <https://github.com/Hexagon/croner> |
| docx | `9.6.1` | MIT | `app.asar/node_modules/docx/LICENSE` | <https://github.com/dolanmiu/docx> |

The package verifier fails if the Electron and Chromium notices are absent.
The React packages are also bundled into renderer output, while their package
directories and license texts are retained in ASAR by the current packager.
Actestra uses `docx` only in Electron main to construct the bounded Office Open
XML package. Its retained MIT license states `Copyright (c) 2016 Dolan`; the
package check must confirm that license text remains in ASAR before candidate
status can be considered.

Actestra uses exact `croner@9.1.0` only in the main-owned schedule contract to
validate bounded five-field cron expressions and calculate the next occurrence.
Its unchanged MIT license states `Copyright (c) 2015-2021 Hexagon` and must
remain in ASAR before candidate status can be considered; the renderer does
not receive Croner or timer authority.

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

## P5.1 Goose runner build materials

The minimal `actestra-goose-runner` keeps Goose `v1.45.0` at canonical upstream
base `4dc0420f5704a92806c6628c8f0a3497d7a88759`. For the P8.2c Windows runtime
composition it resolves `goose` and `goose-providers` from the standalone
private `Ablankpaper/actestra-goose-runtime` repository at immutable commit
`5d66f81a3a992b063ff6f22663789fbe7be42b48`. That commit modifies only the
three ACP server files recorded in `workers/goose-runner/PATCHES.md`; their
binary full-index diff SHA-256 is
`7e848a929788d1c9fcfa55e85620a1359688386d3c52978b5f4074f0367ea205`.
The adapter is default-off, and Goose default features remain disabled with no
enabled Goose feature.

Goose is Apache-2.0 and has no root `NOTICE`. The upstream source tree is not
vendored into Actestra and the official CLI binary is not committed. The exact
Apache-2.0 payload is retained at
`workers/goose-runner/licenses/GOOSE-APACHE-2.0.txt`, and each generated runner
artifact copies it beside the executable, lock, audit report, CycloneDX 1.6
SBOM, and immutable manifest.

The private repository is not a GitHub Fork and has no automatic upstream
synchronization. Actestra admits the immutable commit and exact diff rather
than a moving branch. Rollback restores the canonical upstream base and keeps
Windows production runtime admission disabled.

The generated local artifact and any future seven-day CI artifact are admission
evidence, not a packaged, signed, notarized, released, or distributed Actestra
component.

The runner also carries a source copy of `arrayref 0.3.9` under
`workers/goose-runner/vendor/arrayref`. It is BSD-2-Clause licensed; its
upstream commit and reason for vendoring are recorded in that directory's
`SOURCE.md`. This copy replaces the yanked crates.io package selected by
`blake3` and is included in the runner source-tree digest.
The private runtime pin also does not prove adapted Windows execution, an
Electron package, candidate status, P8.2c completion, or overall P8 completion.
Before a desktop candidate includes the runner, Release must verify the full
transitive SBOM and license expressions, applicable notices, package placement,
signature, provenance, update and rollback behavior, and target-platform
acceptance. ADR-0024 governs the source and authority boundary; ADR-0025 records
the sole exact RSA metadata-only audit disposition without calling the audit
clean.

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
| `cargo-auditable` | `0.7.4` (`1d50810095d1a40d02c4f5c38152cdb9d0ea06bd`) | MIT OR Apache-2.0 |
| `cargo-audit` | `0.22.2` (`281452c35cf0870969042374110f099a411bc185`) | Apache-2.0 OR MIT |

Transitive dependency licenses remain part of the locked package graph and must
be represented in the P8 SBOM and candidate notice bundle. This P2 inventory is
not a release-grade transitive license report.

## Evaluated references

The following projects remain architectural or evaluation references only.
Exact evaluation pins do not change their non-imported status.

| Project | Evaluated revision | Observed root license | Role | Source |
| --- | --- | --- | --- | --- |
| AionCore | `v0.1.52` (`76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d`) | Root Apache-2.0; Cargo metadata says MIT; no root `NOTICE` | Ignored local F0 launch runtime and proposed initial general-worker compatibility runtime; not committed or approved for distribution | <https://github.com/iOfficeAI/AionCore> |
| CrewAI | `1.15.8` (`e9caf1e1b89343bb833b5da6660faa91804a9dce`) | MIT | First supervised P6 planner-sidecar candidate; metadata inspected only, with no source or package imported | <https://github.com/crewAIInc/crewAI> |
| Eigent | `v1.0.2` (`e478094a9ff433132b3cf1928e4143338ddaab20`) | Root Apache-2.0; root `package.json` says MIT | Team product and acceptance reference; metadata inspected only, with no source or runtime imported | <https://github.com/eigent-ai/eigent> |

The local P6 planner protocol, generic supervised-process fixture, Team
orchestrator, and downstream patch 0014 are Actestra-owned implementation.
They do not import, vendor, install, bundle, or distribute CrewAI or Eigent
source, packages, assets, or application UI. Their presence therefore does not
change the evaluation-only notice status above.

This file must be updated in the same change that imports, vendors, bundles,
upgrades, or distributes third-party code or assets. A reference link alone
does not satisfy license or notice obligations.

ADR-0024 rejects the broad upstream Goose release CLI as the Actestra runtime
artifact. P5.1 commits the exact Goose Apache-2.0 license payload and runner
lock and generates source and patch provenance, lock and executable digests,
SBOM, and normalized audit evidence. Applicable transitive notices and release
packaging remain mandatory before distribution.

The exact AionUi runnable desktop source selection is committed as the accepted
product foundation; its installed dependencies and generated packages are
ignored. Before a native Actestra candidate, the full transitive runtime
inventory, packaged Apache-2.0 license, third-party asset notices, SBOM, and
provenance must be verified.
AionCore distribution remains blocked until its license inconsistency and
binary provenance are resolved. See the
[baseline report](docs/upstream/AIONUI_V2.1.41_BASELINE.md) and
[native foundation evidence](docs/product/AIONUI_NATIVE_FOUNDATION.md).
