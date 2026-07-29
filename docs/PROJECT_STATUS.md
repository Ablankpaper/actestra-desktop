# Project Status

Last updated: 2026-07-29

## Current phase

### P3 accepted; P4.0 and P4.1 implementations CI-backed; PR remains Draft

Branch `feat/aionui-first-foundation` starts from `origin/main` commit
`a32b7cb4516f5592e8e1fe6f1f5afad7c50de991` and implements the corrected
product direction in ADR-0010: the real AionUi application, original functional
UI, and original functions are the product baseline; the accepted Actestra P3
core will be fused beneath compatible bridge domains.

F0 implementation commit
`13270ca0abd7353710541afca9ddf46c47670be3` is pushed to
[draft pull request 6](https://github.com/bignormal/actestra-desktop/pull/6).
Its exact-head
[CI run 30392140461](https://github.com/bignormal/actestra-desktop/actions/runs/30392140461)
passes the macOS arm64 foundation job, including source, tests, boundaries,
documentation, unsigned legacy-harness package, packaged identity, and
clean-profile smoke.

Current F0 evidence:

- exact AionUi `v2.1.41` commit
  `2d8925fc67a97a20996fadcd2a0862b778b572ba` imported as an unmodified
  1,766-file runnable desktop source snapshot;
- source manifest SHA-256
  `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`;
- direct comparison to a clean exact-commit checkout passes all 1,766 selected
  file hashes and confirms complete `packages`, `public`, `patches`, `tests`,
  and `examples` subtrees;
- machine preservation check passes every file hash, all 27 native routes, and
  all 41 functional bridge domains;
- frozen dependency install and native production build pass;
- native Electron launch passes in an isolated profile and displays the
  original Guide, navigation, agent/model selector, assistants, schedules,
  Team, Settings, composer, workspace, and suggestion experience;
- after restoring one exact upstream workflow fixture omitted by the initial
  archive selection, the complete native rerun passes 321 files with 1 skipped
  and 2,576 tests with 5 skipped; there are 0 failures.

Current F1 implementation and evidence:

- a reviewable downstream overlay materializes Actestra from the exact frozen
  AionUi source without editing the 1,766-file foundation;
- the overlay checker passes 64 declared changed files and 4 protected R0
  layout/bridge files;
- the real AionUi routes, layout, Guide, feature entries, and bridge surface
  remain; product identity, icons, application ID, executable, protocol,
  repository, and release links are Actestra-owned;
- a fresh versioned Actestra profile is created independently from native
  AionUi data with `0700` directories and a `0600` manifest;
- telemetry, updates, feedback uploads, known upstream official services, and
  public listeners are disabled by default without deleting their UI entries;
- strict types, 12 focused F1/retained-provider files with 120 tests, 323
  complete native files with 2,585 passing tests, and native production build
  pass;
- a real downstream Electron launch shows the preserved AionUi desktop
  structure with the Actestra title and wordmark;
- the runtime listener snapshot is loopback-only and the settled process tree
  has no non-loopback established socket or official-service log match.
- implementation commit
  `836a9f1f81687f091e1c5b92ce30bff167e9da4f` and resource-only CI
  remediation `462a1b0d920279d42f124fdd28673d77dc55b765` are pushed;
- exact implementation
  [CI run 30417692550](https://github.com/bignormal/actestra-desktop/actions/runs/30417692550)
  passes root checks, documentation links, materialization and install,
  TypeScript, 120 focused tests, native production build, unsigned bundle,
  packaged identity boundary, and clean-profile smoke.

Detailed implementation and non-claim evidence is recorded in
[AionUi F1 Identity and Isolation](product/AIONUI_F1_IDENTITY_ISOLATION.md).
F1 implementation is CI-backed but remains on a Draft pull request. Merge,
candidate, release, distribution, and acceptance remain separate gates.

The complete native suite and visual/runtime socket inspection remain local
evidence. The foundation manifest, downstream overlay, focused contracts,
native production build, unsigned package boundary, and clean-profile smoke
are CI-backed on the exact implementation plus resource-only remediation.
PR 6 remains Draft and is not merge, candidate, release, distribution, or
acceptance evidence. CodeRabbit returned a successful status but explicitly
skipped review because the PR is Draft; it is not review evidence.

P3.1-P3.6 and review remediation are pushed and CI-backed. The full independent
review and remediation review are complete.
[Pull request 3](https://github.com/bignormal/actestra-desktop/pull/3) reached
final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f`, squash merged as
`f6833c50eaf5a426948bac7999f93a08b19a425e`, and exact
[main CI run 30378191752](https://github.com/bignormal/actestra-desktop/actions/runs/30378191752)
passes. These facts close the P3 exit gate.

P0 through P3 are accepted on `main`.
[Pull request 2](https://github.com/bignormal/actestra-desktop/pull/2) merged
the P2 independent product shell with squash commit
`76d6a58b20c3e010ee759358f2c86be80bc6a6c1`. Its exact final PR head was
`f972bb6c33c925f3e333a6ee87d20e5bbb72cece`.
[Main CI run 30329620829](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)
passes on the exact squash commit.

`feat/platform-core-contracts` began from that verified `main` commit and
merged through pull request 3.
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

P3.4 implementation commit
`2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b` accepts
[ADR-0006](architecture/decisions/0006-agent-adapter-lifecycle-and-supervision.md)
and adds protocol version 1, exact capability negotiation, an `AgentAdapter`
contract, observed-time lifecycle supervision, immutable attempts, terminal
reconciliation, cancellation, crash, bounded restart, and an explicitly
stepped deterministic fake adapter.
[macOS arm64 CI run 30339662937](https://github.com/bignormal/actestra-desktop/actions/runs/30339662937)
passes on that exact implementation commit.

P3.5 implementation commit
`cec0cdc554656c021cdff7f2341ddd3f9b5d83dd` accepts
[ADR-0007](architecture/decisions/0007-privileged-service-authorization.md)
and adds closed protected-operation and tool-manifest contracts, conservative
policy evaluation, exact one-shot approval evidence, opaque credential leases,
a metadata-only audit trail, and a fixed-order main-owned gateway.
[macOS arm64 CI run 30345370507](https://github.com/bignormal/actestra-desktop/actions/runs/30345370507)
passes on that exact implementation commit.

P3.6 implementation commit
`950fe0efa2fdc5adc69d013acc9f417d201cb28e` accepts
[ADR-0008](architecture/decisions/0008-main-owned-projection-and-ipc.md)
and adds SQLite schema version 3, durable metadata-only privileged audit,
immutable terminal-attempt evidence, persist-before-release coordination,
main-owned inert service registration, trusted-frame IPC, a three-operation
preload allowlist, and bounded renderer projection.
[macOS arm64 CI run 30350732223](https://github.com/bignormal/actestra-desktop/actions/runs/30350732223)
passes on that exact implementation commit.

Review-remediation commit
`4fa0fb120a6ceb2c71effd2a552e8d9bbf05d151` adds bounded structural
comparison, idempotent incremental redelivery, explicit persistence
idempotency contracts, post-replacement stream-cache invalidation, and
evidence-document corrections.
[macOS arm64 CI run 30374144474](https://github.com/bignormal/actestra-desktop/actions/runs/30374144474)
passes on that exact remediation commit.

Review-closure evidence commit
`2fe179a63ac7e8a4d23373fe87dda7b062c314fc` records the complete review,
remediation, validation, and remaining owner gate.
[macOS arm64 CI run 30374447377](https://github.com/bignormal/actestra-desktop/actions/runs/30374447377)
passes on that exact evidence head. The subsequent Ready transition triggered
CodeRabbit run `c55e04d9-8360-4570-a06c-2dec6b5d19e6`, which selected all 67
PR files and completed with a successful status, no review submission, and no
review thread. This Free-plan summary/walkthrough is not represented as an
independent approval.

Ready-state evidence commit
`755416c7b9bbb09172559460bc1a122eea2f7c8f` records the completed owner and
Ready gates.
[macOS arm64 CI run 30376456379](https://github.com/bignormal/actestra-desktop/actions/runs/30376456379)
passes on that exact commit. Its incremental CodeRabbit run
`5d4c70ac-5432-4ea0-af1e-2bf51db50362` selected only the four changed status
documents but was rate-limited before review with a 55-minute wait. The
resulting successful status is command-handling evidence, not a completed
review or a zero-issue result.

Final PR-head evidence commit
`71bf3e3fb1d7661fee053ee811279d44f1fdf45f` records the Ready-state CI
evidence.
[macOS arm64 CI run 30376696055](https://github.com/bignormal/actestra-desktop/actions/runs/30376696055)
passes on that exact final head. Incremental CodeRabbit run
`226b4810-7e15-495f-a3f9-50cf0536fb8c` selected the final four-document status
range but was rate-limited before review with a 52-minute wait. Its successful
status records limit handling only; it is not a completed review or zero-issue
result.

Pull request 3 squash merged that exact final head as
`f6833c50eaf5a426948bac7999f93a08b19a425e`.
[macOS arm64 main CI run 30378191752](https://github.com/bignormal/actestra-desktop/actions/runs/30378191752)
passes on the exact squash commit, including source, tests, boundaries,
documentation, unsigned bundle, packaged identity, and clean-profile smoke.

Application startup now opens the owned SQLite store and registers the
deny-by-default reference services only in main. The fake worker still performs
no filesystem, network, process, shell, model, credential, or tool operation.
There is no secret backend, real executor, input-reference store, production
policy snapshot, worker process, or MCP/native transport.

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

Local validation of P3.4 at
`2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b` on
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
- exact implementation CI run 30339662937 — pass, including source/test/
  boundary, documentation, unsigned bundle, packaged identity, and clean-profile
  smoke steps.

Local validation of P3.5 at
`cec0cdc554656c021cdff7f2341ddd3f9b5d83dd` on
`feat/platform-core-contracts`:

- `bun install --frozen-lockfile` — pass with 443 installs and no lockfile
  change;
- two focused P3.5 contract files — pass with 27 tests covering validation,
  policy, approval, audit, credential-lease, gateway, cleanup, concurrency, and
  post-call uncertainty rules;
- `bun run check` — pass, including format, lint with 0 warnings, strict types,
  all 14 Vitest files with 103 tests, the exact Electron `37.10.3` / Node.js
  `22.21.1` / SQLite `3.50.4` probe, the 3-scenario process-failure harness, the
  27-source product-boundary check, and desktop build;
- `bun run test:coverage` — pass with 84.00% statement, 76.75% branch, and
  95.18% function coverage overall; `core/privilegedServices.ts` has 93.96%
  statement coverage and `main/privileged` has 84.04%;
- `bun run docs:check` — pass for all 28 Markdown files;
- `bunx markdownlint-cli2 'docs/**/*.md' 'README.md' 'AGENTS.md'` — pass across
  24 matched files with 0 issues;
- `bun run dist:dir && bun run verify:package && bun run smoke:package` — pass
  for the unsigned arm64 app and isolated shell profile; this is regression
  evidence only because P3.5 is not wired into startup;
- `git diff --cached --check` — pass before the implementation commit;
- three completed CodeRabbit CLI reviews raised 14 issues: 1 critical,
  10 major, and 3 minor. All were verified and remediated. A fourth final CLI
  retry was rate-limited before review and therefore is not zero-issue evidence;
  the remote CodeRabbit status is `SUCCESS` on the pushed implementation head;
- exact implementation CI run 30345370507 — pass, including source/test/
  boundary, documentation, unsigned bundle, packaged identity, and clean-profile
  smoke steps.

Validation of P3.6 implementation commit
`950fe0efa2fdc5adc69d013acc9f417d201cb28e`:

- the first contract, preload, and IPC group passed 4 focused files with 9
  tests after the intended red phase;
- SQLite migration and platform-evidence groups passed restart-continuity,
  idempotency, immutable-conflict, bounded-read, and projection-corruption
  tests;
- terminal-attempt unit and SQLite integration tests prove event persistence,
  metadata evidence, failure retention, idempotent retry, and supervisor release
  order;
- `bun run check` — pass, including format, lint with 0 warnings, strict types,
  all 24 Vitest files with 129 tests, the exact Electron `37.10.3` / Node.js
  `22.21.1` / SQLite `3.50.4` probe, the 3-scenario process-failure harness, the
  34-source product-boundary check, and desktop build;
- `bun run test:coverage` — pass with 84.15% statement, 76.59% branch, and
  94.30% function coverage overall; `main/ipc` has 92.85% statement coverage,
  `main/persistence` has 87.92%, and the preload bridge has 90.90%;
- `bun run dist:dir && bun run verify:package && bun run smoke:package` — pass
  for the unsigned arm64 app, packaged identity, and isolated application,
  window, and renderer-ready markers with SQLite v3 active;
- documentation links and lint pass. Two CodeRabbit CLI reviews raised six
  valid issues (1 critical, 2 major, and 3 minor), all remediated; a third
  tracked-file pass returned zero issues. A full staged-diff retry was
  rate-limited before review and is not zero-issue evidence. A manual full-diff
  audit found and remediated two additional defensive gaps;
- exact implementation CI run 30350732223 — pass, including source/test/
  boundary, documentation, unsigned bundle, packaged identity, and clean-profile
  smoke steps;
- the explicit remote 67-file CodeRabbit review request was also rate-limited
  before review. Its `SUCCESS` status represents command handling, not completed
  review; GitHub has no review submission or review thread on the implementation
  head.

Review closure validation at
`4fa0fb120a6ceb2c71effd2a552e8d9bbf05d151`:

- `coderabbit review --agent -t committed --base main -c AGENTS.md` completed
  against all 67 PR files at pre-remediation head
  `164be7da1b73ffeb8da813e33268ccaf4a77b7ad` and raised 10 issues: 4 major
  and 6 minor;
- nine issues were verified and remediated. One minor request to replace
  kickoff CI run 30329964305 with the earlier run 30329899300 was rejected
  after GitHub verification showed that both passed, but 30329964305 is the
  later canonical run on exact head
  `b9c1119479c805c02452e4054a3d904649a3ca03`;
- four focused files pass 23 tests. `bun run check` passes format, zero-warning
  lint, strict types, the exact Electron SQLite probe, all 24 Vitest files with
  130 tests, the process-failure harness, 34-source boundary check, and build;
- `bun run test:coverage` passes with 84.16% statement, 76.70% branch, and
  94.30% function coverage. Documentation links and Markdown lint pass with
  zero issues;
- unsigned arm64 packaging, packaged identity, and isolated application,
  window, and renderer-ready smoke pass;
- the first nine-file remediation review raised one minor immutable-evidence
  wording issue, which was fixed. The second nine-file review completed with 0
  issues;
- a final redundant 67-file confirmation attempt was rate-limited during setup
  with a 43-minute wait. It is not represented as zero-issue evidence; closure
  rests on the completed full review plus the completed zero-issue remediation
  review;
- exact remediation CI run 30374144474 passes all source/test/boundary,
  documentation, unsigned bundle, package identity, and clean-profile smoke
  steps.

## Evidence snapshot

| Area | State | Evidence or blocker |
| --- | --- | --- |
| Repository | P3 accepted on `main` | PR 3 final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f`; squash merge `f6833c50eaf5a426948bac7999f93a08b19a425e` |
| P2 merge | Accepted on `main` | PR 2 final head `f972bb6c33c925f3e333a6ee87d20e5bbb72cece`; squash merge `76d6a58b20c3e010ee759358f2c86be80bc6a6c1` |
| P2 main CI | Pass | Main push run 30329620829 passed on the exact squash merge |
| P3 kickoff CI | Pass | Pull-request run 30329964305 passed on exact pushed head `b9c1119479c805c02452e4054a3d904649a3ca03` |
| P3.1/P3.2 CI | Pass | Pull-request run 30331681309 passed on exact implementation commit `31dd6e4178eb7641b45be0ee2bccb862a96dac99` |
| P3.3 CI | Pass | Pull-request run 30335076556 passed on exact implementation commit `4de756984269624a02fbfdf77e558c958a03c2e0` |
| P3.4 CI | Pass | Pull-request run 30339662937 passed on exact implementation commit `2b1ad9200ff44f2b6be219a8a4b58b0083ebd45b` |
| P3.5 CI | Pass | Pull-request run 30345370507 passed on exact implementation commit `cec0cdc554656c021cdff7f2341ddd3f9b5d83dd` |
| P3.6 CI | Pass | Pull-request run 30350732223 passed on exact implementation commit `950fe0efa2fdc5adc69d013acc9f417d201cb28e` |
| P3 review closure | Pass with one documented invalid issue | Full 67-file review completed with 10 issues; 9 valid issues fixed; all 9 remediation files then completed a zero-issue review; exact remediation CI run 30374144474 passed |
| P3 Ready gate | Pass | Owner authorized the Ready transition; runs 30374447377 and 30376456379 passed on their exact heads; final PR-head run 30376696055 passed; the first Ready-triggered CodeRabbit selected 67 files and completed successfully with 0 review submissions and 0 threads |
| P3 merge | Accepted on `main` | PR 3 squash merged exact final head `71bf3e3fb1d7661fee053ee811279d44f1fdf45f` as `f6833c50eaf5a426948bac7999f93a08b19a425e` |
| P3 main CI | Pass | Main push run 30378191752 passed on exact squash commit `f6833c50eaf5a426948bac7999f93a08b19a425e` |
| P4.0 branch | Pushed; draft PR | Implementation `13270ca0abd7353710541afca9ddf46c47670be3`; draft PR 6; exact-head CI run 30392140461 passes |
| P4.1 identity and isolation | Implemented, pushed, CI-backed; draft PR | Implementation `836a9f1f81687f091e1c5b92ce30bff167e9da4f`; resource-only CI remediation `462a1b0d920279d42f124fdd28673d77dc55b765`; run 30417692550 passes |
| Native AionUi source | Exact local desktop snapshot | AionUi `v2.1.41` at `2d8925fc67a97a20996fadcd2a0862b778b572ba`; 1,766 files; no local modification inside snapshot |
| Native preservation contract | Local pass | Manifest SHA-256 `252b7b22b75e3a89ad4d9379398a04521772f853b855227c236928fa151f844f`; 27 routes and 41 bridge domains verified |
| Native AionUi build and launch | Local pass | Frozen install, production build, isolated native Electron launch, and actual Guide screenshot pass |
| Native AionUi tests | Local pass | 321 files passed, 1 skipped; 2,576 tests passed, 5 skipped; 0 failures |
| Legacy product shell | P3 harness only | Original Actestra Electron/React shell remains for platform-contract and packaging regression; it is not the target product UI |
| Renderer boundary | CI-backed through P3.6 | Context isolation, sandbox, Node and packaged DevTools disabled, production CSP denies connections, exact frozen preload allowlist, trusted-frame zero-argument IPC, and direct-client source checks |
| Automated tests | Exact merged-main CI pass | Main run 30378191752 passes 24 Vitest files with 130 tests, the exact Electron SQLite probe, process-failure harness, 34-source boundary check, build, package identity, and clean-profile smoke |
| Desktop package | Local and CI unsigned evidence | macOS arm64 app bundle, packaged identity, and clean-profile smoke verified; not a candidate |
| P3 domain contracts | Implemented and CI-backed | Typed IDs and timestamps; workspace, task, session, worker, approval, and artifact records; transition and graph invariants; exact commit and run above |
| P3 event contract | Implemented and CI-backed | Schema version 1; per-attempt gapless order, exact-id idempotency, verified replay cursors, terminal enforcement, and diagnostic redaction; exact commit and run above |
| P3 persistence and migrations | Implemented and CI-backed | ADR-0005 schemas 1 and 2 plus ADR-0008 schema 3 for privileged audit and terminal-attempt evidence; exact runs above |
| P3 worker lifecycle | Implemented and CI-backed | ADR-0006, protocol version 1, runtime validation, supervisor, observed-time health, cancellation, crash, bounded fresh-attempt restart, deterministic fake, and 22 focused tests; exact commit and run above |
| P3 privileged services | Implemented and CI-backed | ADR-0007; protected-operation and manifest contracts; policy, approval, opaque lease, metadata-only audit, and deterministic gateway services; exact commit and run above |
| P3 main integration | Implemented and CI-backed | ADR-0008; main-only inert composition, durable audit, persist-before-release barrier, fixed IPC allowlist, bounded renderer projection, and packaged startup smoke; exact commit and run above |
| Release | None | No candidate, signed artifact, deployment, distribution, or user acceptance |

## Accepted direction

- Actestra is independent from Aera.
- AionUi `v2.1.41` is the preserved product application, functional UI, and
  general-work foundation. The default is to retain original functions and
  workflows, not selectively redraw them.
- Actestra authority is introduced below stable AionUi bridge shapes one domain
  at a time; unready effects keep their UI and receive an explicit isolated
  state.
- Goose is integrated through a specialized worker adapter exposed by the
  preserved AionUi agent/ACP experience.
- Eigent-style orchestration is mapped into the preserved AionUi Team
  experience; its repository and separate UI are not imported wholesale.
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
| Final GitHub review | No submitted review; CodeRabbit summary/status succeeded on the exact final head with 0 review threads, then the owner merged after CLI remediation and CI |
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

1. Review draft PR 6 and retain the exact frozen source plus downstream-overlay
   boundary during any remediation.
2. Begin P4.2/F2 with a compatibility inventory for native conversation, task,
   provider, workspace, approval, artifact, and runtime shapes.
3. Add read-only or metadata-only P3 shadow projections before moving any
   native AionUi domain to Actestra authority.
4. Keep every retained AionUi route and functional UI entry stable while the
   compatibility projection is introduced and regression-tested.
5. Do not describe F0/F1 as merged, Actestra-authoritative general work,
   Goose/Eigent integration, candidate, release, distribution, or user
   acceptance.

## Open decisions

- License for original Actestra source.
- Credential storage mechanism and platform-keychain boundary.
- Main-owned input-reference storage and MCP/native-tool transport.
- Worker sandbox implementation per operating system.
- Long-term dependency upgrade policy.
- Code-signing, notarization, update, and distribution accounts.
- AionCore license clarification and accepted binary provenance before
  distribution.
- Exact downstream patch-series mechanism for F1 and later AionUi updates.
- Cloud identity or sync scope, which remains outside the initial MVP unless
  promoted by a new product decision.

## Known blockers and non-claims

- P3.1 through P3.6, review remediation, the final PR head, squash merge, and
  exact merged-main CI are evidenced. P3 phase acceptance is not a release or
  user-acceptance claim.
- The final redundant full-diff confirmation was rate-limited before review and
  is not zero-issue evidence. The completed 67-file review plus the completed
  zero-issue nine-file remediation review are the review-closure evidence.
- Incremental CodeRabbit run `5d4c70ac-5432-4ea0-af1e-2bf51db50362` was
  rate-limited before reviewing the four Ready-state documents. Its successful
  GitHub status is not review evidence; local documentation checks and exact
  CI run 30376456379 passed for those files.
- Incremental CodeRabbit run `226b4810-7e15-495f-a3f9-50cf0536fb8c` was also
  rate-limited before reviewing the final four-document status range. Its
  successful status is limit-handling evidence; exact final-head CI run
  30376696055 passed.
- Main startup registers SQLite v3 and inert P3.5 reference services, but no
  protected operation, tool transport, credential value, or worker control is
  renderer-visible.
- The P3.4 deterministic fake is test infrastructure, not a worker process or
  evidence of packaged crash recovery.
- P3.6 makes metadata-only audit and terminal-attempt evidence durable.
  Approval, credential-lease, and policy state remains in memory and contains no
  secret value or real tool execution.
- SQLite still runs synchronously in main; it must move behind a supervised
  persistence utility before real user-workload writes are enabled.
- The P3 contracts and fake-worker gate have passed. Real-worker integration is
  P4 work and still requires the dedicated scope, decisions, branch, and tests
  described above.
- F0 proves the original AionUi application can be preserved and run. It does
  not yet prove Actestra identity, profile migration, authoritative P3 writes,
  permission-complete native operations, Goose, or Eigent-style integration.
- The local AionCore `v0.1.52` bundle is ignored and used only for native launch
  proof. It is not committed, packaged, or approved for distribution.
- The upstream managed-Node path can download a runtime on first launch, and
  the Sentry startup path reports a missing-DSN error. F1 must isolate or
  replace these effects while keeping their functional UI and recovery states.
- Draft pull request 5 follows the displaced custom-shell general-work route.
  Preserve it for compatible P3-core mining, but do not merge it as the product
  UI foundation.
- PR 6 CodeRabbit run `4c42ce22-31b1-4554-a6fc-d2639f45dbda`
  returned a successful status but explicitly skipped review because the PR is
  Draft. It provides no line-by-line review or zero-issue evidence.
- The local P2 package remains deliberately unsigned and is not a candidate.
- The `main` branch currently has no GitHub branch-protection rule; explicit
  owner-gated PR discipline remains required.
- CI runs 30339662937, 30350732223, and 30378191752 passed, but GitHub
  annotated the pinned checkout and setup-node actions as Node 20-targeting
  actions forced onto Node 24; this is a dependency-maintenance item, not
  failed P3 evidence.
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
