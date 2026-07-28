# P4 General-Work Vertical Slice

Status: P4.1 accepted; P4.2 implemented and locally validated on the Draft branch

Date: 2026-07-29

Branch: `feat/general-work-vertical-slice`

Exact base: `a32b7cb4516f5592e8e1fe6f1f5afad7c50de991`

## Entry evidence

The branch starts from the P3 acceptance-documentation merge on `main`.
[Main CI run 30379251723](https://github.com/bignormal/actestra-desktop/actions/runs/30379251723)
passes on that exact base.

P3's implementation merge remains
`f6833c50eaf5a426948bac7999f93a08b19a425e`, with
[main CI run 30378191752](https://github.com/bignormal/actestra-desktop/actions/runs/30378191752)
passing on that exact commit.

The process, adapter, content-reference, tool, scope, and persistence choices
for this phase are accepted in
[ADR-0009](../architecture/decisions/0009-p4-general-work-process-and-content-boundaries.md).
The owner accepted that decision on 2026-07-29 and authorized P4.2. This does
not accept the P4.2 implementation, merge the branch, or authorize P4.3.

## P4.2 implementation evidence

The current branch implements the persistence/content subset without enabling
a worker or tool:

- Electron main launches an Actestra persistence utility with a minimal
  environment and talks to it through a closed version 1 structured-clone
  protocol;
- the utility exclusively owns the synchronous `node:sqlite` adapter and
  forward migration registry; source and recursively reachable packaged-module
  checks reject SQLite in the main entry graph;
- schema version 4 adds one-active-per-workspace grant records and immutable,
  1 MiB-bounded UTF-8 input/output content references with SHA-256 metadata;
- exact owner, kind, grant, expiry, consumption-time, idempotency, conflict,
  UTF-8, byte-length, and digest checks fail closed;
- malformed, oversized, uncorrelated, timed-out, or post-exit utility messages
  fail the client, and main has no synchronous fallback; and
- a fresh client or application restart reopens the same owned database.
  Transparent hot restart or retry of an exited utility is not implemented.

The intended red command first failed only at the three absent P4.2 boundaries:

```text
bunx vitest run tests/core/workloadContent.test.ts \
  tests/main/persistenceUtilityClient.test.ts \
  tests/utility/workloadPersistence.test.ts
```

After implementation and remediation:

- the focused contract/client/migration/workload group passes 5 files with 21
  tests;
- `bun run check` passes formatting, zero-warning lint, strict types, the exact
  Electron SQLite probe, 28 Vitest files with 144 tests, the three-scenario
  smoke harness, the 41-source product-boundary check, and the desktop build;
- `bun run test:coverage` passes without threshold changes at 82.68% statements,
  75.79% branches, 91.22% functions, and 82.67% lines overall; and
- a rebuilt unsigned macOS arm64 `.app` passes packaged identity/CSP checks,
  recursively proves SQLite is absent from the main entry graph and present in
  the utility entry, and reaches utility, application, window, and renderer
  ready markers on an isolated Profile with SQLite schema 4; and
- all 31 relative Markdown links resolve, Markdown lint reports 0 issues, and
  the working diff has no whitespace errors.

The complete 40-file CodeRabbit CLI review raised 10 findings. Three were valid
and fixed: the P3/P4 evidence-row attribution, loopback SQLite shutdown on
simulated exit, and negative foreign `application_id` classification. Seven
were rejected after verification because they used the wrong current date or
conflicted with the accepted utility authority, retention, whole-graph
replacement, stable-error, and fail-closed client boundaries. A second complete
review raised one valid protocol-exhaustiveness issue, which was fixed with
operation-map-derived typing and `never` guards. The third complete 40-file
review finished with 0 findings.

This is local implementation, automated review, and package evidence. The exact
pushed commit, pull-request CI, merge, slice acceptance, candidate, release,
deployment, distribution, and user acceptance remain separate gates. No
submitted GitHub review or human approval is claimed.

## Purpose

P4 must prove one complete general-work journey through Actestra-owned
boundaries:

- a real supervised worker process;
- scoped workspace reads;
- create-only task-output writes;
- tool requests and results through policy and audit;
- durable events, content references, and artifact metadata;
- cancellation, denial, failure, conflict, and restart behavior; and
- a bounded renderer journey that cannot bypass main.

The first worker is an Actestra-owned deterministic reference worker. It exists
to prove execution and recovery contracts with reproducible fixtures. It does
not claim model reasoning, general intelligence, arbitrary tool selection,
AionCore integration, production sandboxing, or release readiness.

## Representative offline journey

The first end-to-end fixture will:

1. register a temporary fixture workspace through a main-owned grant;
2. create a task asking for a Markdown summary of one fixture document;
3. persist the task, attempt, and bounded input references;
4. start the reference worker in a real utility process;
5. receive a semantic request for `actestra.workspace.read-text`;
6. derive and authorize the protected operation in main;
7. execute the scoped read and return a task-bound opaque output reference;
8. let the adapter deliver the bounded content to the same live worker;
9. receive progress and a request for
   `actestra.task-output.write-text`;
10. create a Markdown artifact in the controlled task-output area;
11. persist normalized events, audit evidence, content, artifact metadata, and
    terminal attempt evidence before acknowledging completion; and
12. restart the application and reconstruct the task and artifact projection
    from owned persistence.

No step requires a provider account, secret, network request, MCP server, shell,
Git operation, user-workspace mutation, or upstream runtime.

## Fixture and failure matrix

| Fixture | Expected proof |
| --- | --- |
| File summary | Reads one granted UTF-8 file and creates one Markdown task output |
| Local research | Reads a versioned offline corpus and creates a cited note artifact |
| Writing | Turns a bounded fixture prompt into a create-only Markdown artifact |
| Scope denial | Absolute, traversal, symlink, or outside-grant input fails without a read |
| Cancellation | A pending tool is cancelled and no later success or artifact event appears |
| Tool failure | Missing, oversized, or invalid UTF-8 input produces a stable failure |
| Artifact conflict | An existing output name is preserved and an explicit conflict is recorded |
| Worker crash | The attempt terminates, evidence persists, and retry uses fresh identities |
| Application restart | A persisted task reopens; unfinished work never becomes silent success |
| Persistence crash | New work becomes unavailable; main does not use an in-process fallback |

Every fixture uses disposable directories and an isolated Actestra data root.
Tests must assert both intended output and absence of writes outside the owned
task-output area.

## Ordered implementation slices

### P4.1 — Kickoff proposal and red-test inventory

- Review and accept or revise ADR-0009.
- Freeze the representative journey, fixture matrix, stable failure codes, and
  non-claims.
- Name the exact files and contracts that later slices may change.

Exit: the Draft PR has an owner-reviewed design and no unresolved
cross-component choice is hidden in implementation.

State: achieved. ADR-0009 and the fixture/exit matrix were accepted on
2026-07-29.

### P4.2 — Persistence utility and content references

- Define the versioned utility protocol and strict runtime validators.
- Move the existing SQLite adapter behind a supervised persistence utility.
- Preserve schema ownership, migration, idempotency, corruption, and terminal
  evidence behavior.
- Add bounded task-bound input/output references and workspace-grant records.
- Add crash, timeout, restart, digest, ownership, expiry, and no-fallback tests.

Exit: existing P3 persistence tests pass through the utility boundary and
reference tests fail closed for wrong ownership or corrupt content.

State: achieved locally with completed automated full-diff review. Exact
pushed-head CI, merge, and owner acceptance remain open.

### P4.3 — Reference worker transport and adapter version 2

- Define native worker messages separately from normalized Actestra signals.
- Add exact protocol/capability negotiation and tool-result resolution.
- Launch the deterministic reference worker as a utility process with a minimal
  environment.
- Add source/dependency boundary checks and process crash/cancellation tests.

Exit: the worker completes a no-tool fixture across a real process boundary,
and malformed, stale, oversized, or wrong-attempt messages fail closed.

### P4.4 — Scoped native tools and policy

- Register only `actestra.workspace.read-text` and
  `actestra.task-output.write-text`.
- Add exact manifests and a deny-by-default production policy snapshot.
- Implement canonical grant containment, symlink rejection, UTF-8 and size
  bounds, create-only output, and deterministic conflict behavior.
- Keep credentials, network, shell, MCP, publishing, and workspace mutation
  disabled.

Exit: success, denial, missing input, invalid encoding, oversize, cancellation,
executor failure, and output-conflict paths pass focused tests.

### P4.5 — End-to-end coordination and recovery

- Connect task creation, adapter supervision, tool gateway, normalized events,
  persistence, artifacts, and terminal evidence.
- Preserve persist-before-acknowledge and supervisor release ordering.
- Cover worker crash, persistence crash, application restart, idempotent retry,
  and fresh-attempt identities.
- Run every representative fixture in an isolated application data root.

Exit: the non-UI vertical slice and all required failure paths pass locally and
in exact-head CI.

### P4.6 — Closed renderer journey and packaged smoke

- Add only the reviewed intents and bounded projections required to select a
  workspace, create/cancel a task, and inspect task/artifact status.
- Keep raw roots, content references, privileged-operation fields, audit
  payloads, and generic IPC out of preload and renderer.
- Extend packaged clean-profile smoke for the offline fixture journey.

Exit: the P4 journey completes through packaged renderer/main boundaries after
restart, with denial and cancellation visible and no renderer authority bypass.

## Validation gates

Each implementation slice must provide:

- intended red tests before or with the implementation;
- focused tests for new contracts and failure paths;
- `bun run check`;
- `bun run test:coverage` without weakening thresholds;
- `bun run docs:check`;
- Markdown lint and `git diff --check`;
- product-boundary validation;
- packaged validation when startup, preload, process, persistence, or renderer
  behavior changes;
- exact pushed commit and exact CI run; and
- separate statements for local validation, CI, merge, package, release,
  deployment, distribution, and user acceptance.

The phase exit also requires an independent full-scope review and remediation
review. A successful command/status without a submitted review is not
zero-issue evidence.

## Phase exit gate

P4 can be accepted only when:

1. the general-work core journey completes end to end after restart;
2. file, local-research, writing, and artifact fixtures pass;
3. permission denial, cancellation, tool failure, persistence failure, worker
   crash, and artifact conflict paths are covered;
4. the renderer cannot bypass main-owned policy, scope, process, persistence,
   or content-reference boundaries;
5. no raw credential, workspace root, content reference, or user content enters
   audit or renderer metadata projection;
6. exact-head CI and required packaged smoke pass; and
7. an owner explicitly accepts the phase.

## Blockers and non-claims

- ADR-0009 is Accepted, and P4.2 is locally implemented and automatically
  reviewed. Its exact pushed commit, CI, merge, and owner acceptance are still
  open.
- `AgentAdapter` version 1 still has no tool-result path; version 2 and the
  reference worker remain P4.3 work.
- SQLite now runs only in the persistence utility. An exited utility makes the
  current client unavailable with no in-main fallback; transparent hot recovery
  is deferred to the P4.5 coordination/recovery slice.
- Schema 4 stores content references and grants, but no worker or real tool uses
  them yet. Retention-point cleanup is deferred until terminal coordination is
  connected in P4.5.
- There is no real executor, production policy, worker process, native tool,
  model, or broader renderer journey in P4.2.
- The reference worker will be deterministic and offline; it is not a
  model-quality claim.
- Utility-process separation is not operating-system sandbox evidence.
- AionCore's license metadata remains inconsistent; no AionUi or AionCore
  source, binary, asset, or configuration is imported by this plan.
- Provider credentials, network models, MCP, shell, workspace mutation, export,
  signing, release, deployment, distribution, and user acceptance remain
  outside this kickoff.
