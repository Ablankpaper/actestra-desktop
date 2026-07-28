# Project Status

Last updated: 2026-07-28

## Current phase

### P3 — Platform Core and Contracts (entry gate open; implementation not started)

P0, P1, and P2 are accepted on `main`.
[Pull request 2](https://github.com/bignormal/actestra-desktop/pull/2) merged
the P2 independent product shell with squash commit
`76d6a58b20c3e010ee759358f2c86be80bc6a6c1`. Its exact final PR head was
`f972bb6c33c925f3e333a6ee87d20e5bbb72cece`.
[Main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)
passes on the exact squash commit.

`feat/platform-core-contracts` begins from that verified `main` commit. This
kickoff contains status and execution-index work only. No P3 domain model,
database, migration, worker, approval, policy, credential, tool, or audit
implementation exists yet.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | P3 branch from accepted `main` | `feat/platform-core-contracts` begins at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1` |
| P2 merge | Accepted on `main` | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1` |
| P2 main CI | Pass | Main push run 30329620829 passed on the exact squash merge |
| Product shell | Implemented | Original Actestra Electron/React shell; no upstream or Aera application source or asset imported |
| Renderer boundary | Verified | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, narrow typed bridge |
| Automated tests | Main-backed pass | Five Vitest files with 22 tests plus a three-scenario process-failure smoke harness |
| Desktop package | Local unsigned evidence | macOS arm64 app, DMG, and ZIP verified; not a candidate |
| P3 models and contracts | Not implemented | Task, session, workspace, worker, approval, event, and artifact types remain to be defined |
| P3 persistence and migrations | Not implemented | Storage technology and migration registry require an accepted decision |
| P3 worker lifecycle | Not implemented | `AgentAdapter` and deterministic fake worker remain to be built |
| P3 privileged services | Not implemented | Credential, policy, approval, MCP/tool, and audit services remain absent |
| Release | None | No candidate, signed artifact, deployment, distribution, or user acceptance |

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

## P2 acceptance evidence

| Requirement | Result |
| --- | --- |
| Independent identity, icon, protocol, and data path | Pass on merged `main` |
| No upstream or Aera brand, account, endpoint, updater, telemetry, or application source | Pass on merged `main` |
| Sandboxed renderer and narrow preload bridge | Pass on merged `main` |
| Deny-by-default permissions, navigation, windows, and external network | Pass on merged `main` |
| Account-free clean-profile launch | Pass locally and in CI smoke |
| Unsigned macOS arm64 app, DMG, and ZIP packaging | Pass locally; deliberately non-candidate |
| Packaged identity, notices, CSP, and architecture verification | Pass locally and in CI |
| Independent review remediation | 13 valid CodeRabbit CLI issues fixed; one invalid `void` Promise suggestion documented |
| Final GitHub review | Pass; no review submission, inline thread, or unresolved actionable comment |
| Final PR-head CI | Pass on `f972bb6c33c925f3e333a6ee87d20e5bbb72cece` |
| Main CI | Pass on squash commit `76d6a58b20c3e010ee759358f2c86be80bc6a6c1` |

Detailed commands, review history, package hashes, screenshot, and non-claims are
in [P2 Product Shell](product/P2_PRODUCT_SHELL.md).

## P3 entry scope

P3 must establish Actestra-owned contracts before any real external worker is
adapted:

1. task, session, workspace, worker, approval, event, and artifact models;
2. a versioned unified event envelope and ordering rules;
3. the `AgentAdapter` lifecycle and deterministic fake worker;
4. persistence ports, an accepted storage decision, and forward migrations;
5. credential, policy, approval, MCP/tool, and audit service boundaries;
6. heartbeat, timeout, crash, restart, and cancellation semantics;
7. tests proving the renderer cannot bypass main-process authority.

The ordered implementation index and P3 non-claims are in
[P3 Platform Core](product/P3_PLATFORM_CORE.md).

## Next gate

1. Commit and push the P3 kickoff from exact accepted `main`, then open a draft
   pull request.
2. Define the minimum domain vocabulary and event-ordering invariants with tests
   before choosing a concrete database.
3. Record the persistence and migration choice in a new ADR before adding the
   backend dependency.
4. Implement the `AgentAdapter` contract and deterministic fake worker behind
   the main-process boundary.
5. Require lifecycle, approval, cancellation, crash-recovery, migration, and
   renderer-bypass tests before P3 can be accepted.

## Open decisions

- License for original Actestra source.
- P3 local database technology and migration registry beyond layout version 1.
- Credential storage mechanism and platform-keychain boundary.
- Policy and approval rule representation.
- MCP/tool gateway transport and capability manifest shape.
- Worker sandbox implementation per operating system.
- Long-term dependency upgrade policy.
- Code-signing, notarization, update, and distribution accounts.
- Cloud identity or sync scope, which remains outside the initial MVP unless
  promoted by a new product decision.

## Known blockers and non-claims

- P3 implementation has not started; this branch is only the verified entry
  point and execution index.
- No real worker may be integrated until the P3 contracts and fake-worker gate
  pass.
- The local P2 package remains deliberately unsigned and is not a candidate.
- Signing, notarization, SBOM, provenance, clean-machine installation, update
  metadata, and cross-platform acceptance remain future gates.
- There is no release, deployment, distribution, or user acceptance.

## Update policy

Every material status update must state:

- exact branch and commit;
- commands run and their results;
- whether evidence is local, pushed, CI-backed, packaged, released, deployed, or
  user-accepted;
- unresolved blockers;
- the next phase gate.
