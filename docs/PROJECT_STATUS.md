# Project Status

Last updated: 2026-07-28

## Current phase

### P1 — Reproducible Upstream Baseline (evidence ready for review)

P0 is complete. P1 technical evidence has been reproduced locally on
`upstream/aionui-v2-1-41` from Actestra base commit
`2a0cfedfb9bab1c0f0410ea5e016b42054b38468`. The evidence branch must be
reviewed and merged before P1 is treated as accepted on `main`. P2 has not
started.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | P1 evidence branch | `upstream/aionui-v2-1-41` from `2a0cfedfb9bab1c0f0410ea5e016b42054b38468`; no application source imported |
| Product source | Not imported | Upstream checkouts and generated packages remain outside Actestra |
| Upstream revisions | Pinned | AionUi `v2.1.41` at `2d8925fc67a97a20996fadcd2a0862b778b572ba`; AionCore `v0.1.52` at `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d` |
| Development environment | Locally verified | macOS 26.5.2 arm64, Xcode 26.6, Node 24.13.0, Bun 1.3.9, Rust/Cargo 1.95.0 |
| Application launch | Locally reproduced | Two clean AionUi checkouts reached window, renderer, WebSocket, AionCore 0.1.52 health, and graceful shutdown |
| Automated tests | Locally reproduced | Each checkout: 321 Vitest files passed, 1 skipped; 2,576 tests passed, 5 skipped |
| Desktop package | Local unsigned evidence | Both checkouts produced arm64 DMG/ZIP; signatures invalid and Gatekeeper rejected them |
| Upstream inventory | Recorded | Licenses, assets, bundled runtimes, endpoints, data paths, entitlements, and module dispositions documented |
| Release | None | No candidate, signed artifact, deployment, or acceptance |

## Accepted direction

- Actestra is independent from Aera.
- AionUi is evaluated as the initial desktop product foundation.
- Goose is integrated through a specialized worker adapter.
- Eigent is initially a product and orchestration reference, not a wholesale
  runtime import.
- Actestra owns workspaces, tasks, permissions, credentials, events, artifacts,
  and audit history.
- External workers run behind stable adapter, event, and policy boundaries.

## P1 gate assessment

| Requirement | Result |
| --- | --- |
| Exact AionUi pin | Pass |
| Clean unmodified checkout | Pass in two independent clones |
| Documented macOS dependency installation | Pass |
| Reproducible development launch | Pass in both clones |
| Upstream test result | Primary Vitest suite passes in both clones; provider-dependent Playwright E2E not run |
| Unsigned local desktop package | DMG and ZIP produced in both clones |
| License, NOTICE, asset, and dependency inventory | Pass for the evaluated root and bundled runtime; complete dependency SBOM remains a release requirement |
| Keep, wrap, replace, remove, and defer map | Pass |
| Second clean-checkout repetition | Pass |

Detailed commands, checksums, warnings, and blockers are in
[AionUi v2.1.41 Baseline](upstream/AIONUI_V2.1.41_BASELINE.md). Planned module
handling is in [AionUi Module Map](upstream/AIONUI_MODULE_MAP.md).

## Next gate

1. Review and merge the P1 evidence without importing upstream source.
2. Open a dedicated P2 change for the independent Actestra product shell.
3. Decide the maintained-fork or selective-import mechanism before source
   enters this repository.
4. In P2, replace upstream identity, data paths, update and telemetry services,
   and unsafe packaging defaults before sharing any build.

## Open decisions

- License for original Actestra source.
- AionUi import strategy; the baseline revision is now selected.
- Actestra-owned Node.js, Bun, Electron, Rust, and Python version policy.
- Local database and migration ownership.
- Worker sandbox implementation per operating system.
- Code-signing, notarization, update, and distribution accounts.
- Cloud identity or sync scope, which is outside the initial MVP unless promoted
  by a new product decision.

## Known blockers and non-claims

- The evaluated unsigned packages are not Actestra packages or candidates.
- Upstream Hub input `dist-latest` is moving and its downloader tolerated
  partial results.
- The upstream ad-hoc signing fallback failed; `codesign` and Gatekeeper checks
  failed.
- AionCore's root Apache-2.0 license conflicts with MIT workspace metadata.
- Dependency and asset license inventory, SBOM, provenance, signing,
  notarization, clean-machine installation, and Playwright acceptance remain
  incomplete.
- The upstream update feed, Sentry behavior, release-named data symlinks, and
  privileged macOS entitlements cannot ship unchanged.
- There is no pushed application code, CI-backed candidate, release,
  deployment, or user acceptance.

## Update policy

Every material status update must state:

- exact branch and commit;
- commands run and their results;
- whether evidence is local, pushed, CI-backed, packaged, released, deployed, or
  user-accepted;
- unresolved blockers;
- the next phase gate.
