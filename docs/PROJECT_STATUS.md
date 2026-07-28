# Project Status

Last updated: 2026-07-28

## Current phase

### P3 — Platform Core and Contracts (P3.1/P3.2 CI-backed; P3.3 locally validated)

P0, P1, and P2 are accepted on `main`.
[Pull request 2](https://github.com/bignormal/actestra-desktop/pull/2) merged
the P2 independent product shell with squash commit
`76d6a58b20c3e010ee759358f2c86be80bc6a6c1`. Its exact final PR head was
`f972bb6c33c925f3e333a6ee87d20e5bbb72cece`.
[Main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)
passes on the exact squash commit.

`feat/platform-core-contracts` begins from that verified `main` commit and is
open in
[draft pull request 3](https://github.com/bignormal/actestra-desktop/pull/3).
Implementation commit
`31dd6e4178eb7641b45be0ee2bccb862a96dac99` adds the P3.1 domain records,
state transitions, and ownership invariants plus the P3.2 version 1 event
envelope, ordering, idempotency, replay, terminal, and redaction rules.
[macOS arm64 CI run 30331681309](https://github.com/bignormal/actestra-desktop/actions/runs/30331681309)
passes on that exact commit.

The current P3.3 change accepts
[ADR-0005](architecture/decisions/0005-sqlite-persistence-and-migrations.md)
and implements storage-neutral persistence ports, two forward-only SQLite
migrations, a main-owned domain/event adapter, corruption and rollback checks,
and an exact Electron-runtime compatibility probe. It is locally validated; its
exact pushed implementation commit and CI run are not yet recorded.

The adapter is not registered at application startup and exposes no preload or
renderer operation. No worker or privileged service exists.

Local validation of the current P3.3 change on
`feat/platform-core-contracts`:

- `bun install --frozen-lockfile` — pass with no lockfile change;
- `bun run check` — pass, including format, lint, strict types, 9 Vitest files
  with 54 tests, the exact Electron `37.10.3` / Node.js `22.21.1` / SQLite
  `3.50.4` probe, the 3-scenario process-failure harness, product-boundary
  check, and desktop build;
- `bun run test:coverage` — pass; `main/persistence` has 88.46% statement and
  77.77% branch coverage;
- `bun run docs:check` — pass for all 26 Markdown files;
- `bunx markdownlint-cli2 'docs/**/*.md' 'README.md' 'AGENTS.md'` — pass with
  0 issues;
- `bun run dist:dir && bun run verify:package && bun run smoke:package` — pass
  for the unsigned arm64 app and isolated shell profile; this is regression
  evidence only because P3.3 is not wired into startup;
- `git diff --cached --check` — pass;
- `coderabbit review --agent -t uncommitted -c AGENTS.md` — initial full review
  raised 5 issues (2 major, 3 minor); all were verified and remediated without
  weakening event invariants; the 17-file post-remediation review completed
  with 0 issues.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | Pushed P3 draft PR | `feat/platform-core-contracts` begins at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`; implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99`; draft PR 3 |
| P2 merge | Accepted on `main` | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1` |
| P2 main CI | Pass | Main push run 30329620829 passed on the exact squash merge |
| P3 kickoff CI | Pass | Pull-request run 30329964305 passed on exact pushed head `b9c1119479c805c02452e4054a3d904649a3ca03` |
| P3.1/P3.2 CI | Pass | Pull-request run 30331681309 passed on exact implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99` |
| Product shell | Implemented | Original Actestra Electron/React shell; no upstream or Aera application source or asset imported |
| Renderer boundary | Verified | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, narrow typed bridge |
| Automated tests | P3.1/P3.2 CI pass; P3.3 local pass | Nine Vitest files with 54 tests, exact Electron SQLite probe, and three-scenario process-failure harness pass locally; P3.3 CI pending |
| Desktop package | Local unsigned evidence | macOS arm64 app, DMG, and ZIP verified; not a candidate |
| P3 domain contracts | Implemented and CI-backed | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above |
| P3 event contract | Implemented and CI-backed | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above |
| P3 persistence and migrations | Implemented and locally validated; CI pending | ADR-0005, storage-neutral port, owned SQLite schema versions 1 and 2, immutable checksummed history, rollback/future/corruption rejection, private file modes, domain round-trip, and ordered event replay |
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

1. Commit and push P3.3, then require an exact-head pull-request CI pass.
2. Record that exact implementation commit and CI run without calling P3
   complete.
3. Implement the `AgentAdapter` contract and deterministic fake worker behind
   the main-process boundary.
4. Require lifecycle, approval, cancellation, crash-recovery, migration, and
   renderer-bypass tests before P3 can be accepted.

## Open decisions

- License for original Actestra source.
- Credential storage mechanism and platform-keychain boundary.
- Policy and approval rule representation.
- MCP/tool gateway transport and capability manifest shape.
- Worker sandbox implementation per operating system.
- Long-term dependency upgrade policy.
- Code-signing, notarization, update, and distribution accounts.
- Cloud identity or sync scope, which remains outside the initial MVP unless
  promoted by a new product decision.

## Known blockers and non-claims

- P3.1 and P3.2 are CI-backed, but they do not complete the P3 exit gate.
- P3.3 is locally validated but not yet recorded as an exact pushed commit or
  CI-backed.
- P3.4 through P3.6 remain unimplemented.
- The P3.3 adapter is not registered with application startup and is not a
  renderer-visible feature.
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
