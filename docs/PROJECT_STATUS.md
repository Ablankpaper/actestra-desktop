# Project Status

Last updated: 2026-07-27

## Current phase

### P1 — Reproducible Upstream Baseline

P0 is complete in the bootstrap baseline: the repository structure,
documentation index, architecture boundaries, Git workflow, and upstream
governance are established. P1 is ready to begin; no upstream baseline work has
started yet.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | P0 complete | Bootstrap structure and governance established on `main` |
| Product source | Not started | No AionUi, Goose, Eigent, or other product code imported |
| Upstream revisions | Not pinned | P1 must select exact tags and commits |
| Development environment | Not verified | No application toolchain selected in this repository |
| Application launch | Not verified | P1 baseline work has not started |
| Automated tests | Not available | No product source or test suite exists |
| Desktop package | Not built | Packaging proof belongs to P1 and later release gates |
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

## Next gate

Enter **P1 — Reproducible Upstream Baseline** and produce:

1. an exact AionUi tag and commit in
   [Upstream Versions](governance/UPSTREAM_VERSIONS.md);
2. a clean, unmodified checkout;
3. documented macOS dependency installation;
4. reproducible development launch;
5. upstream test results;
6. an unsigned local desktop package;
7. license, NOTICE, asset, and bundled dependency inventory;
8. a keep/replace/remove module map.

P1 is not complete until a second clean checkout can repeat the documented
commands.

## Open decisions

- License for original Actestra source.
- Exact AionUi baseline revision and import strategy.
- Node.js, package manager, Electron, Rust, and Python version policy after the
  baseline audit.
- Local database and migration ownership.
- Worker sandbox implementation per operating system.
- Code-signing, notarization, update, and distribution accounts.
- Cloud identity or sync scope, which is outside the initial MVP unless promoted
  by a new product decision.

## Update policy

Every material status update must state:

- exact branch and commit;
- commands run and their results;
- whether evidence is local, pushed, CI-backed, packaged, released, deployed, or
  user-accepted;
- unresolved blockers;
- the next phase gate.
