# Project Status

Last updated: 2026-07-28

## Current phase

### P3 — Platform Core and Contracts

P3.1-P3.3 are CI-backed. P3.4 local validation passed; commit, push, and CI
remain pending.

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
P3.1/P3.2 implementation commit
`31dd6e4178eb7641b45be0ee2bccb862a96dac99` adds the P3.1 domain records,
state transitions, and ownership invariants plus the P3.2 version 1 event
envelope, ordering, idempotency, replay, terminal, and redaction rules.
[macOS arm64 CI run 30331681309](https://github.com/bignormal/actestra-desktop/actions/runs/30331681309)
passes on that exact commit.

P3.3 implementation commit
`4de756984269624a02fbfdf77e558c958a03c2e0` accepts
[ADR-0005](architecture/decisions/0005-sqlite-persistence-and-migrations.md)
and implements storage-neutral persistence ports, two forward-only SQLite
migrations, a main-owned domain/event adapter, corruption and rollback checks,
and an exact Electron-runtime compatibility probe.
[macOS arm64 CI run 30335076556](https://github.com/bignormal/actestra-desktop/actions/runs/30335076556)
passes on that exact implementation commit.

The local P3.4 working tree above current commit
`6817a384be66d9ffaed990c8777edc2e76eec1a8` accepts
[ADR-0006](architecture/decisions/0006-agent-adapter-lifecycle-and-supervision.md)
and adds protocol version 1, exact capability negotiation, an `AgentAdapter`
contract, observed-time lifecycle supervision, immutable attempts, terminal
reconciliation, cancellation, crash, bounded restart, and an explicitly
stepped deterministic fake adapter. This work is not yet committed, pushed, or
CI-backed.

The SQLite adapter, P3.4 supervisor, and fake adapter are not registered at
application startup and expose no preload or renderer operation. The fake
performs no filesystem, network, process, shell, model, credential, or tool
operation. No real worker, worker transport, or privileged service exists.

Local validation of P3.3 at
`4de756984269624a02fbfdf77e558c958a03c2e0` on
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

Local validation of the current uncommitted P3.4 working tree on
`feat/platform-core-contracts`:

- three focused contract files — pass with 22 tests covering version and
  capability rejection, lifecycle order, messages, approval grant/denial/
  expiry/cancellation, normal and forced cancellation, startup and heartbeat
  timeout, crash, fresh-attempt restart, restart bounds, identity and sequence
  drift, approval-reference drift, and terminal reconciliation;
- `bun run check` — pass, including format, lint, strict types, all 12 Vitest
  files with 76 tests, the exact Electron `37.10.3` / Node.js `22.21.1` /
  SQLite `3.50.4` probe, the 3-scenario process-failure harness, the 21-source
  product-boundary check, and desktop build;
- `bun run test:coverage` — pass after remediation with 81.88% statement,
  75.28% branch, and 93.75% function coverage overall; `core/agentAdapter.ts`
  has 89.71% statement coverage and `main/workers` has 75.86%;
- `bun run docs:check` — pass for all 27 Markdown files;
- `bunx markdownlint-cli2 'docs/**/*.md' 'README.md' 'AGENTS.md'` — pass with
  0 issues;
- `git diff --cached --check` — pass;
- `coderabbit review --agent -t uncommitted -c AGENTS.md` — the first
  tracked-file review raised 1 minor status-wording issue; the complete 13-file
  review raised 4 major lifecycle/validation issues; all were verified and
  remediated, and the final 13-file review completed with 0 issues;
- commit, push, and exact-head CI remain pending.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | Pushed P3.1-P3.3 draft plus local P3.4 worktree | `feat/platform-core-contracts` begins at `76d6a58b20c3e010ee759358f2c86be80bc6a6c1`; current pushed head `6817a384be66d9ffaed990c8777edc2e76eec1a8`; uncommitted P3.4 changes; draft PR 3 |
| P2 merge | Accepted on `main` | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1` |
| P2 main CI | Pass | Main push run 30329620829 passed on the exact squash merge |
| P3 kickoff CI | Pass | Pull-request run 30329964305 passed on exact pushed head `b9c1119479c805c02452e4054a3d904649a3ca03` |
| P3.1/P3.2 CI | Pass | Pull-request run 30331681309 passed on exact implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99` |
| P3.3 CI | Pass | Pull-request run 30335076556 passed on exact implementation commit `4de756984269624a02fbfdf77e558c958a03c2e0` |
| Product shell | Implemented | Original Actestra Electron/React shell; no upstream or Aera application source or asset imported |
| Renderer boundary | Verified | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, narrow typed bridge |
| Automated tests | Local P3.4 pass; exact CI remains P3.3 | Locally, 12 Vitest files with 76 tests plus exact Electron SQLite probe, process-failure harness, boundary check, and build pass; run 30335076556 remains the latest exact implementation CI evidence |
| Desktop package | Local unsigned evidence | macOS arm64 app, DMG, and ZIP verified; not a candidate |
| P3 domain contracts | Implemented and CI-backed | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above |
| P3 event contract | Implemented and CI-backed | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above |
| P3 persistence and migrations | Implemented and CI-backed | ADR-0005, storage-neutral port, owned SQLite schema versions 1 and 2, immutable checksummed history, rollback/future/corruption rejection, private file modes, domain round-trip, and ordered event replay; exact commit and run above |
| P3 worker lifecycle | Locally implemented; not committed or CI-backed | ADR-0006, protocol version 1, runtime validation, supervisor, observed-time health, cancellation, crash, bounded fresh-attempt restart, deterministic fake, and 22 focused tests |
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

1. Complete independent review and final local verification of the P3.4
   contract, supervisor, and deterministic fake.
2. Commit and push P3.4, then require exact-head pull-request CI evidence.
3. Begin P3.5 privileged service contracts only after P3.4 evidence is recorded.
4. Keep real AionUi, Goose, Eigent, or other workers out until the whole P3 exit
   gate passes.

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

- P3.1 through P3.3 are CI-backed, and P3.4 is locally implemented, but they do
  not complete the P3 exit gate.
- P3.4 has no commit, push, or CI evidence yet. P3.5 and P3.6 remain
  unimplemented.
- The P3.3 persistence adapter and P3.4 worker components are not registered
  with application startup and are not renderer-visible features.
- The P3.4 deterministic fake is test infrastructure, not a worker process or
  evidence of packaged crash recovery.
- No real worker may be integrated until the P3 contracts and fake-worker gate
  pass.
- The local P2 package remains deliberately unsigned and is not a candidate.
- CI run 30335076556 passed, but GitHub annotated the pinned checkout and
  setup-node actions as Node 20-targeting actions forced onto Node 24; this is a
  dependency-maintenance item, not failed P3.3 evidence.
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
