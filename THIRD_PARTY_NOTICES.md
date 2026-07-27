# Third-Party Notices

The P2 shell uses third-party runtime and development packages from the locked
Bun dependency graph. It does not contain application source or assets copied
from AionUi, AionCore, Goose, Eigent, Aera, or AgentEra.

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

## Direct development and test dependencies

These packages are required to build, test, lint, format, or package the
repository. They are not represented as Actestra-authored code.

| Packages | Versions | License |
| --- | --- | --- |
| `@testing-library/jest-dom`, `@testing-library/react` | `6.9.1`, `16.3.2` | MIT |
| `@types/node`, `@types/react`, `@types/react-dom` | `24.12.0`, `19.2.14`, `19.2.3` | MIT |
| `@vitest/coverage-v8`, `vitest`, `jsdom` | `4.1.0`, `4.1.0`, `28.1.0` | MIT |
| `electron-builder`, `electron-vite`, `vite` | `26.15.2`, `5.0.0`, `6.4.1` | MIT |
| `oxfmt`, `oxlint` | `0.41.0`, `1.56.0` | MIT |
| TypeScript | `5.9.3` | Apache-2.0 |

Transitive dependency licenses remain part of the locked package graph and must
be represented in the P8 SBOM and candidate notice bundle. This P2 inventory is
not a release-grade transitive license report.

## Evaluated references

The following projects are architectural or evaluation references only. Exact
evaluation pins do not change their non-imported status.

| Project | Evaluated revision | Observed root license | Role | Source |
| --- | --- | --- | --- | --- |
| AionUi | `v2.1.41` (`2d8925fc67a97a20996fadcd2a0862b778b572ba`) | Apache-2.0; no root `NOTICE` | Initial desktop product foundation | <https://github.com/iOfficeAI/AionUi> |
| AionCore | `v0.1.52` (`76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d`) | Root Apache-2.0; Cargo metadata says MIT; no root `NOTICE` | Backend bundled by the evaluated AionUi package | <https://github.com/iOfficeAI/AionCore> |
| Goose | Not selected | Not yet inspected | Specialized coding and terminal worker | <https://github.com/aaif-goose/goose> |
| Eigent | Not selected | Not yet inspected | Multi-agent orchestration reference | <https://github.com/eigent-ai/eigent> |

This file must be updated in the same change that imports, vendors, bundles,
upgrades, or distributes third-party code or assets. A reference link alone
does not satisfy license or notice obligations.

The local P1 evaluation packages and their dependencies are not committed or
published. Before any AionUi or AionCore adoption, Actestra must inventory the
selected module dependencies and assets, preserve required notices, resolve
the AionCore license inconsistency, and update the import log. See the
[baseline report](docs/upstream/AIONUI_V2.1.41_BASELINE.md).
