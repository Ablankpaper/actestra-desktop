# Upstream Versions

This file records immutable upstream revisions and verification evidence.

## Current pins

P1 selected and verified the initial AionUI and AionCore pins on 2026-07-27.
Later phases append their own exact selections and evidence. The complete
runnable AionUi desktop source foundation was imported on 2026-07-29 under
ADR-0010.

| Upstream | Repository | Version or tag | Exact commit | Integration | Status |
| --- | --- | --- | --- | --- | --- |
| AionUi | `iOfficeAI/AionUi` | `v2.1.41` | `2d8925fc67a97a20996fadcd2a0862b778b572ba` | Product UI and general-work foundation | P1 reproduced; exact 1,766-file runnable desktop snapshot imported and manifest-verified |
| AionCore | `iOfficeAI/AionCore` | `v0.1.52` | `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d` | Initial native compatibility runtime/general worker | P1 locally built; ignored local bundle used for F0 launch; not committed or approved for distribution |
| Croner | `Hexagon/croner` | `9.1.0` | `364a3074c2642b903eaf26e96f4bc197e3eaa6bc` | Main-owned schedule validation and occurrence calculation | Exact npm and downstream-native pin; MIT notice retained and package-verified |
| Goose | `aaif-goose/goose`; private runtime source `Ablankpaper/actestra-goose-runtime` | `v1.45.0` source/ACP target | upstream base `4dc0420f5704a92806c6628c8f0a3497d7a88759`; runtime `e246f395592b01995cd34faf5e3ce1ed5444a41a` | Minimal Actestra-built stdio ACP coding Worker under ADR-0024 | P5.1 runner admitted; P8.2c source contract pins a default-off three-file adapter seam; Windows adapted execution is not yet verified; upstream binary rejected |
| CrewAI | `crewAIInc/crewAI` | `1.15.8` evaluation snapshot | `e9caf1e1b89343bb833b5da6660faa91804a9dce` | First supervised planner-sidecar candidate | Metadata and license verified; local generic supervisor is Actestra-owned test infrastructure, not CrewAI; no source/package is imported, installed, bundled, or selected as the production P6 pin |
| Eigent | `eigent-ai/eigent` | `v1.0.2` reference snapshot | `e478094a9ff433132b3cf1928e4143338ddaab20` | Team product and acceptance reference | Metadata inspected; not imported, installed, bundled, or selected as a runtime |

## CI action pins

The following actions are executed by CI and are not imported into or
distributed with the Actestra application. The immutable commits were resolved
from the corresponding official GitHub tags on 2026-07-28 and 2026-08-01.

| Action | Version | Exact commit | Use |
| --- | --- | --- | --- |
| `actions/checkout` | `v4.4.0` | `11d5960a326750d5838078e36cf38b85af677262` | Repository checkout |
| `actions/setup-node` | `v4.4.0` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | Node.js 24.13.0 setup |
| `oven-sh/setup-bun` | `v2.2.0` | `0c5077e51419868618aeaa5fe8019c62421857d6` | Bun 1.3.9 setup |
| `actions/upload-artifact` | `v4.6.2` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | Preserve the short-lived P5.1 runner admission artifact |

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

## Goose v1.45.0 evidence

- Verification dates: upstream evaluation 2026-08-01; private runtime pin
  2026-08-19.
- Upstream URL: <https://github.com/aaif-goose/goose>.
- Release/tag: `v1.45.0`, published 2026-07-29; exact commit:
  `4dc0420f5704a92806c6628c8f0a3497d7a88759`.
- Root license: Apache-2.0; no root `NOTICE`.
- Exact locked ACP dependencies: `agent-client-protocol 1.0.1` and
  `agent-client-protocol-schema 1.1.0`.
- Selected integration: an Actestra-owned minimal runner calling the public
  Goose core stdio ACP entry with default features disabled, an initially empty
  Goose feature set, no builtins, and no scheduler. The broad upstream CLI is
  not selected as a runtime artifact.
- P8.2c private runtime source: standalone private repository
  `Ablankpaper/actestra-goose-runtime` at exact commit
  `e246f395592b01995cd34faf5e3ce1ed5444a41a`. It is not a GitHub Fork, its
  default branch remains the exact upstream base, GitHub Actions are disabled,
  it has no webhook, and no automatic upstream synchronization moves the
  admitted commit. Actestra CI receives repository-scoped read-only access;
  fork pull requests do not enter jobs that resolve the private source.
- The runtime commit descends from the exact upstream base and modifies only
  `crates/goose/src/acp/server.rs`,
  `crates/goose/src/acp/server_factory.rs`, and
  `crates/goose/src/acp/server/new_session.rs`. Their binary full-index diff
  SHA-256 is
  `a5f2df85313dbbd1ac20bef3fafba4e40e32e2ffa0c76ad5a5d62414d1eae1f4`.
  The change adds a default-off adapter seam for one fixed Provider, model, MCP
  client, and active session. The admitted Goose Cargo feature set remains
  empty.
- Rollback comparison: `v1.44.0` at
  `876555f85b1bd0e15ed75eed7c5ac1163c1f097a`. Older revisions are disallowed
  because `v1.44.0` fixes `GHSA-r5pp-p5r8-466r`.
- Official macOS arm64 release asset SHA-256:
  `3a1b41197ff670c36b0b6285f41ccd949966ee037933f38c5e11c9356799ce58`.
  It is provenance evidence only: the extracted binary is ad-hoc signed,
  Gatekeeper-rejected, lacks recoverable dependency metadata, and is not
  committed or approved for distribution.
- Exact upstream `Cargo.lock` audit: five vulnerability matches, one unsoundness
  warning, and five unmaintained warnings. The first Actestra runner lock must
  remove `RUSTSEC-2026-0221` by selecting `event-listener >=5.4.2`.
- P5.1 build tools are pinned separately from Goose:

  | Tool | Version | Exact commit | Release license | Role |
  | --- | --- | --- | --- | --- |
  | `cargo-auditable` | `0.7.4` | `1d50810095d1a40d02c4f5c38152cdb9d0ea06bd` | MIT OR Apache-2.0 | Embed dependency metadata in the exact runner binary |
  | `cargo-audit` | `0.22.2` | `281452c35cf0870969042374110f099a411bc185` | Apache-2.0 OR MIT | Scan the committed lock and auditable binary against a recorded RustSec database commit |

- The shared tool-asset contract pins both macOS architectures. The
  `cargo-auditable` archive SHA-256 values are
  `fade0f3befebce7b54a46edfa31bea27789ea2136c51e662c2922b10f9d6f701`
  for arm64 and
  `2a1e73d769b2ab6c027178d11c6ba6bf3ad7c1e756910b349b513583da9d52bc`
  for x64. The `cargo-audit` archive SHA-256 values are
  `ec7ca4263769593df4d909be85b94a6b79efa2897be5d2bb8ebd516e823175af`
  for arm64 and
  `847831323de932155b226ab60ee4a180e13e5d007a019f0d4b7b4d89a6de2ab2`
  for x64. The local arm64 installed executable hashes are respectively
  `89ef000f9619f83aaa252af61c70a6ba3a623abf1295ff902edf701f06b19dd7`
  and `33fbe81adca1b794f4ffe98574d59b0ebe6fcfdb310976fafed98a094c795111`;
  the builder rehashes each executable before use.
- The committed minimal runner uses Rust 1.96.1 at rustc commit
  `31fca3adb283cc9dfd56b49cdee9a96eb9c96ffd` with the same toolchain's
  `rustfmt 1.9.0-stable (31fca3adb2 2026-06-26)`, an empty Goose feature set,
  the exact private runtime patch above, `event-listener 5.4.2`, and
  `lru 0.18.2`. The `lru` floor removes
  the reachable `RUSTSEC-2026-0253` unsoundness finding without changing the
  Goose source pin or feature surface. The original admitted macOS arm64
  executable was 63,911,512 bytes with SHA-256
  `1aa35cfa29a781752f992afa67dc6139f235b3cc662e01d2d556080dabbe8d21`;
  generated remediation artifacts remain local or short-lived CI evidence and
  are rehashed in their immutable manifest.
- The first exact runner lock and embedded-metadata scans both report only
  `RUSTSEC-2023-0071` for `rsa 0.9.10`. ADR-0025 permits that record only as
  `metadata-only-not-compiled`: the active graph excludes RSA and SQLx MySQL,
  all-target inverse normal-edge queries have no path, and no corresponding
  release artifact is compiled. The audit is not represented as clean.
- Current import status: the small Actestra runner source, exact lock, Goose
  Apache-2.0 license payload, source contract, and build/admission scripts are
  committed by P5.1 and extended by the P8.2c private-source admission. Cargo
  fetches the exact immutable runtime source to build ignored local or
  short-lived CI evidence. No Goose source tree is vendored into Actestra, and
  no official binary, model, credential, private state, desktop package,
  candidate, or release is committed or distributed by this source pin.
- Rollback restores the two Cargo dependencies and source contract to canonical
  upstream commit `4dc0420f5704a92806c6628c8f0a3497d7a88759` and keeps Windows
  production runtime admission disabled. This pin is not evidence of adapted
  Windows execution, Electron packaging, P8.2c completion, P8.3, or P8.4.
- Full commands, cross-platform artifact digests, dependency paths, telemetry,
  network, signing, and remaining admission gates:
  [Goose v1.45.0 Evaluation](../upstream/GOOSE_V1.45.0_EVALUATION.md).
- Governing decision:
  [ADR-0024](../architecture/decisions/0024-minimal-goose-acp-runner.md) and
  [ADR-0025](../architecture/decisions/0025-goose-rsa-metadata-only-disposition.md).

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
- Local P6 status: Actestra has a closed planner protocol and generic supervised
  process boundary with a deterministic fixture. That code does not execute,
  wrap, vendor, or prove CrewAI and does not change this upstream import status.
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
