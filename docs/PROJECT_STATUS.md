# Project Status

Last updated: 2026-07-28

## Current phase

### P3 — Platform Core and Contracts (P3.1 and P3.2 CI-backed; P3.3 next)

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

No database, migration backend, worker, privileged service, or renderer
integration exists.

Local validation on `feat/platform-core-contracts`, committed exactly as
`31dd6e4178eb7641b45be0ee2bccb862a96dac99`:

- `bun install --frozen-lockfile` — pass with no lockfile change;
- `bun run check` — pass, including format, lint, strict types, 7 Vitest files
  with 39 tests, the 3-scenario process-failure harness, product-boundary check,
  and desktop build;
- `bun run docs:check` — pass for all 25 Markdown files;
- `npx --yes markdownlint-cli2@0.20.0 "**/*.md" "#node_modules"` — pass with
  0 errors;
- `git diff --cached --check` — pass.
- `coderabbit review --agent -t uncommitted -c AGENTS.md` — full 12-file
  post-remediation review completed with 0 issues.

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
| Automated tests | Exact implementation CI pass | Seven Vitest files with 39 tests plus a three-scenario process-failure smoke harness passed in run 30331681309 |
| Desktop package | Local unsigned evidence | macOS arm64 app, DMG, and ZIP verified; not a candidate |
| P3 domain contracts | Implemented and CI-backed | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above |
| P3 event contract | Implemented and CI-backed | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above |
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

1. Record the persistence and migration choice in a new ADR before adding the
   backend dependency.
2. Implement storage-neutral persistence ports and migration contract tests.
3. Implement the `AgentAdapter` contract and deterministic fake worker behind
   the main-process boundary.
4. Require lifecycle, approval, cancellation, crash-recovery, migration, and
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

- P3.1 and P3.2 are CI-backed, but they do not complete the P3 exit gate.
- P3.3 through P3.6 remain unimplemented.
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
