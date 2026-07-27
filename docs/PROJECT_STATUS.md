# Project Status

Last updated: 2026-07-28

## Current phase

### P2 — Independent Actestra Product Shell (implementation gate passes; review pending)

P0 and P1 are accepted on `main`. Pull request 1 merged P1 at
`174ef46ff971a2f67aec16fbfd6dc56fc0910306`.

P2 implementation commit
`1892b48402b1bfa9425a34172ff79259b7190b81` is pushed on
`feat/independent-product-shell`, based on that exact `main` commit, in
[draft pull request 2](https://github.com/bignormal/actestra-desktop/pull/2).
The local technical exit gate and pull-request CI on that exact implementation
commit pass. Evidence-only follow-up commits must still pass the PR head check.
Review and merge remain required before P2 is accepted on `main`.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | Pushed draft PR | `feat/independent-product-shell` from exact `main` commit `174ef46ff971a2f67aec16fbfd6dc56fc0910306`; implementation commit `1892b48402b1bfa9425a34172ff79259b7190b81`; draft PR 2 |
| Product source | Original Actestra shell | No AionUi, AionCore, Goose, Eigent, Aera, or AgentEra application source or asset imported |
| Framework pins | Locked | Node.js 24.13.0, Bun 1.3.9, Electron 37.10.3, React and React DOM 19.2.4 |
| Product identity | Locally verified | `Actestra`, `com.bignormal.actestra`, `Actestra` executable, `actestra:` protocol, original icon |
| Data ownership | Locally verified | Actestra user-data root and fail-closed `data-layout.json` at layout version 1 |
| Renderer boundary | Locally verified | Context isolation, sandbox, Node disabled, web security enabled, two-operation typed bridge |
| External access | Locally verified | Permission requests, new windows, cross-navigation, HTTP, HTTPS, WS, and WSS fail closed; only loopback development requests are allowed |
| Automated tests | Local pass | Five Vitest files; 21 tests passed |
| Source checks | Local pass | Formatting, zero lint warnings, strict TypeScript, documentation links, and product-boundary scan |
| Desktop package | Local unsigned artifacts | macOS arm64 `.app`, DMG, and ZIP produced; DMG checksum structure, bundle identity, architecture, ASAR boundary, and packaged Electron notices verified |
| Fresh-profile launch | Local pass | Application, window, and renderer ready markers plus Actestra layout manifest observed; real UI visually inspected |
| CI | Pass on implementation commit | [macOS arm64 run 30295163884](https://github.com/bignormal/actestra-desktop/actions/runs/30295163884) passed on `1892b48402b1bfa9425a34172ff79259b7190b81`; the final PR head must also pass after evidence updates |
| Release | None | No candidate, signed artifact, deployment, or acceptance |

## Accepted direction

- Actestra is independent from Aera.
- AionUi is an evaluated desktop and general-work reference; any reuse enters as
  a selective, attributed port behind an Actestra boundary.
- Goose is integrated through a specialized worker adapter.
- Eigent is initially a product and orchestration reference, not a wholesale
  runtime import.
- Actestra owns workspaces, tasks, permissions, credentials, events, artifacts,
  and audit history.
- External workers run behind stable adapter, event, and policy boundaries.

## P2 local gate assessment

| Requirement | Result |
| --- | --- |
| Independent identity and icon | Pass locally |
| Actestra-owned data path and layout version | Pass locally |
| No upstream or Aera application source, brand, account, endpoint, data path, telemetry, or updater | Pass locally |
| Sandboxed renderer and narrow preload bridge | Pass locally |
| Deny-by-default permission, window, navigation, and external-network policy | Pass locally |
| No automatic approval or privileged worker surface | Pass by absence; those services do not exist in P2 |
| Account-free first launch | Pass locally |
| Unsigned macOS arm64 app, DMG, and ZIP packaging | Pass locally |
| Packaged identity and notice verification | Pass locally |
| Fresh-profile application, window, renderer, and data-layout smoke | Pass locally |
| Visual inspection of the real packaged shell | Pass locally |
| Pull-request CI | Pass on exact implementation commit; final PR head check required |
| Review and merge | Pending |

Detailed commands, implementation boundaries, screenshot, and non-claims are in
[P2 Product Shell](product/P2_PRODUCT_SHELL.md).

## Next gate

1. Require the final draft-PR head to retain a passing macOS CI job.
2. Review the identity, renderer authority, data layout, package notice, and
   clean-launch evidence.
3. Merge P2 only after review and CI; then begin P3 models and deterministic fake
   worker contracts in a dedicated branch.

## Open decisions

- License for original Actestra source.
- Long-term dependency upgrade policy beyond the P2 Node.js, Bun, Electron, and
  React pins.
- P3 local database technology and migration registry beyond layout version 1.
- Worker sandbox implementation per operating system.
- Code-signing, notarization, update, and distribution accounts.
- Cloud identity or sync scope, which is outside the initial MVP unless promoted
  by a new product decision.

## Known blockers and non-claims

- The local P2 `.app` is deliberately unsigned and is not a candidate.
- Signing, notarization, SBOM, provenance, clean-machine installation, update
  metadata, and cross-platform acceptance remain future gates.
- Task persistence, workers, tools, approvals, and orchestration are not
  implemented.
- Draft PR 2 remains unreviewed and unmerged.
- There is no candidate, release, deployment, distribution, or user acceptance.

## Update policy

Every material status update must state:

- exact branch and commit;
- commands run and their results;
- whether evidence is local, pushed, CI-backed, packaged, released, deployed, or
  user-accepted;
- unresolved blockers;
- the next phase gate.
