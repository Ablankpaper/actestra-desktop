# Third-Party Notices

No third-party product source code, asset, binary, or package has been imported
into or distributed from Actestra.

The following projects are architectural or evaluation references only. Exact
evaluation pins do not change their non-imported status.

| Project | Evaluated revision | Observed root license | Role | Source |
| --- | --- | --- | --- | --- |
| AionUi | `v2.1.41` (`2d8925fc67a97a20996fadcd2a0862b778b572ba`) | Apache-2.0; no root `NOTICE` | Initial desktop product foundation | <https://github.com/iOfficeAI/AionUi> |
| AionCore | `v0.1.52` (`76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d`) | Root Apache-2.0; Cargo metadata says MIT; no root `NOTICE` | Backend bundled by the evaluated AionUi package | <https://github.com/iOfficeAI/AionCore> |
| Goose | Not selected | Not yet inspected | Specialized coding and terminal worker | <https://github.com/aaif-goose/goose> |
| Eigent | Not selected | Not yet inspected | Multi-agent orchestration reference | <https://github.com/eigent-ai/eigent> |

This file must be updated in the same change that imports, vendors, bundles, or
distributes third-party code or assets. A reference link alone does not satisfy
license or notice obligations.

The local P1 evaluation packages and their dependencies are not committed or
published. Before any adoption or distribution, Actestra must inventory
dependency and asset licenses, preserve required notices, resolve the AionCore
license inconsistency, and generate an SBOM. See the
[baseline report](docs/upstream/AIONUI_V2.1.41_BASELINE.md).
