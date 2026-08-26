# P8.2 Complete Product-Journey Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` to implement this plan task by task, and use
> `superpowers:test-driven-development` for every production boundary change.

**Goal:** Close P8.2 with one machine-validated, package-bound evidence record
for each of the nine required product journeys on macOS 15 arm64, Windows 11
x64, and Ubuntu 24.04 x64.

**Architecture:** A cross-platform outer controller launches the native
packaged Electron product in an isolated profile and accepts only a bounded
Main-owned result file. An E2E-only Main journey composer exercises the
existing General, Goose, Artifact delivery/apply, Team, recovery, cancellation,
privacy, and P7 services using a deterministic loopback Provider. A strict
evidence validator binds the nine results to the exact source commit, native
package, executable, `app.asar`, admitted Goose runner, CI run, and zero
residual processes. The composer is copied into the materialized AionUI Main
tree through a recorded downstream overlay; the frozen foundation is never
edited.

**Tech stack:** Node.js 24 ESM, TypeScript 5.9, Vitest, Electron 37,
electron-builder, SQLite `node:sqlite`, Git, PowerShell, Bash, Xvfb, and GitHub
Actions.

---

## Non-negotiable evidence rules

- P8.2 has exactly three targets and nine required journeys. The aggregate gate
  expects exactly 27 unique target/journey rows.
- Only `verified` passes. `failed`, `unsupported-platform`,
  `evidence-incomplete`, `test-harness-invalid`, missing, duplicate, or unknown
  rows fail the aggregate gate.
- Unit/Vitest, native runner, packaged Electron, CI Artifact, candidate,
  release, and clean-machine acceptance remain separate evidence layers.
- Every verified target record binds the source SHA, CI run, package formats and
  SHA-256 values, executable SHA-256, `app.asar` SHA-256, Goose manifest and
  executable SHA-256 values, and `residualProcessCount = 0`.
- Evidence and failure files use closed schemas and closed codes. They never
  contain paths, raw stdout/stderr, prompts, credentials, file contents, or
  arbitrary exception text.
- Deterministic loopback Provider execution is valid only for P8.2. It does not
  advance P8.4 real-Provider acceptance.
- Existing unchanged fresh-profile evidence may be referenced only when its
  source tree, package digests, target, and CI Artifact remain exactly bound.
  A newly built package requires newly bound evidence.

## Task 1: Lock the complete evidence contract and 27-row gate

**Files:**

- Create: `tests/scripts/p8ProductJourneyEvidence.test.mjs`
- Create: `scripts/p8-product-journey-evidence.mjs`
- Modify: `scripts/p8-platform-matrix.mjs` only if the implementation reveals a
  contract mismatch; do not change the accepted targets or journeys.
- Modify: `package.json`

- [ ] **Step 1: Write RED tests for one exact target record**

  Define a complete valid record and require exact keys, the nine ordered P8.2
  journey IDs, unique rows, verified status, zero residuals, exact target
  formats, commit/CI identifiers, and SHA-256 bindings. Separately reject extra
  keys, missing or duplicate journeys, a wrong target, a wrong package format,
  digest drift, an unbound runner, nonzero/unknown residuals, and any non-verified
  outcome.

- [ ] **Step 2: Write RED tests for bounded failure records and aggregation**

  Require one closed failure schema and code vocabulary. Aggregate exactly the
  three target records into 27 unique rows, then reject duplicate targets,
  source/package/runner drift, a missing row, an unsupported row, and a mixed
  CI run.

- [ ] **Step 3: Observe RED**

  ```bash
  bun run test tests/scripts/p8ProductJourneyEvidence.test.mjs
  ```

- [ ] **Step 4: Implement the minimal schema, validator, and aggregate gate**

  Export immutable constants and pure functions. Validators return only
  `{ ok: true }` or `{ ok: false, code: '<closed-code>' }`; they never return
  rejected data. Add a CLI mode that validates three JSON inputs and emits only
  a bounded pass/fail summary.

- [ ] **Step 5: Observe GREEN**

  Run the focused test and `bun run p8:contract:check`.

## Task 2: Lock cross-platform package launch, hashing, and cleanup

**Files:**

- Create: `tests/scripts/smokeP8ProductJourneys.test.mjs`
- Create: `scripts/smoke-p8-product-journeys.mjs`
- Reuse: `scripts/smoke-p8-fresh-profile.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write RED tests for platform package resolution**

  Cover macOS `.app` plus DMG/ZIP, Windows `Actestra.exe` plus NSIS, and Ubuntu
  `/opt/Actestra/actestra` or the verified emitted executable plus DEB. Require
  real non-symlink files, exact expected formats, streaming hashes, and exact
  `app.asar` resolution.

- [ ] **Step 2: Write RED tests for process and profile isolation**

  Reuse the fresh-profile isolation conventions and injected process probes.
  Cover early exit, timeout, malformed/oversized result, symlink escape,
  process-snapshot failure, a surviving descendant, a nonzero result residual,
  and a complete successful fixture.

- [ ] **Step 3: Observe RED**

  ```bash
  bun run test tests/scripts/smokeP8ProductJourneys.test.mjs
  ```

- [ ] **Step 4: Implement one portable outer controller**

  Launch only with `ACTESTRA_E2E_TEST=1` and
  `ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE=1`; create isolated user-data/home/temp
  roots; pass the exact source and runner bindings; cap output; parse only the
  bounded result file; verify hashes after execution; terminate the complete
  process tree; and always write a bounded success or failure evidence file.

- [ ] **Step 5: Observe GREEN**

  Run the evidence and controller focused tests together.

## Task 3: Close the packaged Git executable boundary on every target

**Files:**

- Modify: `tests/main/actestraCodingJourneyRuntime.test.ts`
- Modify: `tests/main/aionuiCodingJourneyService.test.ts`
- Modify: `apps/desktop/src/main/workers/actestraCodingJourneyRuntime.ts`
- Modify: `apps/desktop/src/main/compatibility/aionuiCodingJourneyService.ts`
- Reuse: `apps/desktop/src/main/workers/workspaceGitBinding.ts`

- [ ] **Step 1: Write RED Windows-focused tests**

  Inject or mock the admitted Git executable and assert both trusted runtime
  commands and canonical-workspace validation use the platform-owned binding,
  not `/usr/bin/git`. Preserve the closed environment, standard Windows Git
  root admission, hook denial, and no mutable `PATH` lookup.

- [ ] **Step 2: Observe RED with only the focused tests**

  ```bash
  bun run test -- \
    tests/main/actestraCodingJourneyRuntime.test.ts \
    tests/main/aionuiCodingJourneyService.test.ts
  ```

- [ ] **Step 3: Reuse the single workspace Git authority**

  Remove duplicate hard-coded Git definitions. Export only the minimal shared
  resolver/environment needed by the two consumers. Do not weaken canonical
  path or executable checks and do not add general shell authority.

- [ ] **Step 4: Observe GREEN and run the existing worktree/apply boundary set**

  ```bash
  bun run test -- \
    tests/main/actestraCodingJourneyRuntime.test.ts \
    tests/main/aionuiCodingJourneyService.test.ts \
    tests/main/isolatedCodingWorktree.test.ts \
    tests/main/artifactWorkspaceApplicator.test.ts
  ```

## Task 4: Bind one exact Goose runner to every native package

**Files:**

- Create: `tests/scripts/p8PackagedGooseBinding.test.mjs`
- Create or modify the smallest staging helper under `scripts/`
- Modify: `.github/workflows/ci.yml`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `scripts/check-aionui-downstream.mjs`
- Modify: relevant root and downstream package configuration only as required

- [ ] **Step 1: Write RED package-contract tests**

  Require macOS, Windows, and Ubuntu package jobs to build the exact native
  runner before their final package; stage the admitted manifest/executable and
  required notices into a fixed resource path; then run package admission
  against that installed path. Reject external CI-only runner directories as
  product-journey proof.

- [ ] **Step 2: Observe RED**

  ```bash
  bun run test tests/scripts/p8PackagedGooseBinding.test.mjs
  ```

- [ ] **Step 3: Implement target-neutral staging and admission**

  Extend the existing Linux pattern without changing runtime authority. The
  package owns only the exact admitted runner resource; Main still validates
  manifest, target triple, executable digest, containment binding, provenance,
  and license/NOTICE before use.

- [ ] **Step 4: Materialize and inspect the host package**

  Run the downstream contract, foundation check when required by the manifest
  change, strict materialized TypeScript, and host-native package inspection.

## Task 5: Compose the nine real Main/Core journeys behind an E2E-only hook

**Files:**

- Create: `apps/desktop/src/main/acceptance/p8ProductJourneySmoke.ts`
- Create: `tests/main/p8ProductJourneySmoke.test.ts`
- Create: `downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journeys.mjs`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `scripts/check-aionui-downstream.mjs`
- Create: `tests/scripts/p8ProductJourneyDownstream.test.mjs`

- [ ] **Step 1: Write RED focused journey tests**

  Require the composer to exercise, through existing production services:
  fresh-profile launch; General Artifact; real admitted Goose isolated Patch
  Artifact; protected workspace apply; mixed General+Goose Team aggregation;
  cancellation with cleanup; crash/restart recovery without replay; privacy and
  redaction; and target-specific P7 obligations. Require the original checkout
  to stay unchanged until approved apply and require exact durable terminal
  states.

- [ ] **Step 2: Write RED hook/overlay tests**

  The hook must be impossible during normal startup, require the E2E isolation
  variables and exact smoke mode, emit no Renderer capability, write only the
  bounded Main result file, and quit. Record R1 ownership and rollback. Do not
  edit `foundation/aionui-v2.1.41`.

- [ ] **Step 3: Implement the smallest Main journey composer**

  Reuse the real services already proven by
  `aionuiGeneralWorkJourneyService`, `aionuiCodingJourneyService`,
  `aionuiCodingArtifactService`, `artifactDeliveryService`,
  `artifactWorkspaceApplicator`, `TeamOrchestrator`, and
  `TeamJourneyWorkerRouter`. Use the real admitted Goose runner and a
  deterministic authenticated loopback model/MCP composition. Do not fork test
  fixtures into production.

- [ ] **Step 4: Implement patch 0024 and source-copy wiring**

  Copy the Main-only composer into the materialized tree and call it only from
  the fixed E2E branch. Add exact overlay/checker contracts and run
  materialization, strict TypeScript, downstream tests, and foundation checks.

## Task 6: Wire one package-bound record per native CI target

**Files:**

- Create: `tests/scripts/p8ProductJourneyCiWiring.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

- [ ] **Step 1: Write RED CI-wiring tests**

  Require the same root command in all three native package jobs after runner
  staging and final package creation. Require exact source/package/runner
  inputs, `xvfb-run` on Ubuntu, bounded failure evidence with `if: always()`,
  Artifact names containing target and `${{ github.sha }}`, and no uploaded
  profiles/logs/workspaces.

- [ ] **Step 2: Observe RED, implement the wiring, and observe GREEN**

  Run the CI-wiring test plus the existing fresh-profile and platform-contract
  suites. Keep fresh-profile as an independently reusable key until the new
  aggregate evidence has passed on all targets.

## Task 7: Validate locally, then use one exact-head native CI run

**Files:**

- Modify after evidence only: `docs/PROJECT_STATUS.md`
- Modify after evidence only:
  `docs/acceptance/P8.2_EVIDENCE_LEDGER_2026-08-26.md`

- [ ] **Step 1: Run the narrow focused collection**

  Run only the changed contract, controller, Git, package binding, composer,
  overlay, and CI wiring tests. Fix only the first real failure boundary.

- [ ] **Step 2: Run the relevant broader gates**

  ```bash
  bun run format:check
  bun run lint
  bun run typecheck
  bun run p8:contract:check
  bun run downstream:aionui:check
  bun run foundation:aionui:check
  bun run docs:check
  git diff --check
  ```

  Run the full `bun run check` once after the focused boundary is green. Reuse
  unchanged verification keys; do not repeatedly rerun the full gate.

- [ ] **Step 3: Run the host-native macOS packaged record**

  Build the exact package and admitted runner, execute the nine journeys, and
  validate the emitted record. This is local host evidence, not Windows/Ubuntu
  or clean-machine evidence.

- [ ] **Step 4: Commit, push, and create one reviewable PR**

  Use a Conventional Commit and the repository PR workflow. Permit one
  exact-head CI run. If CI fails, preserve the first bounded failure record and
  repair only that boundary; do not blindly rerun.

- [ ] **Step 5: Validate all three CI records independently**

  Download only the three bounded JSON Artifacts. Verify GitHub Artifact
  digests, file SHA-256 values, exact source SHA, CI run, target, package,
  executable, `app.asar`, runner bindings, nine unique journeys, and zero
  residuals. Then run the 27-row aggregate gate.

- [ ] **Step 6: Close P8.2 only after 27 verified rows**

  Update the evidence ledger and project status with exact PR/head/run/job/
  Artifact/digest values and remaining non-claims. Merge through the normal
  workflow and verify the resulting `origin/main`. Until all 27 rows validate,
  P8.2 remains open and P8.3 does not start.

## Task 8: Handoff to P8.3 without carrying unstable evidence

- [ ] Freeze the merged P8.2 source SHA and tree.
- [ ] Record which verification keys are unchanged and reusable.
- [ ] Confirm no feature work, generated package, profile, credential, or
  evidence log entered source control.
- [ ] Begin P8.3 only from the frozen merged SHA, rebuilding candidate artifacts
  with candidate-specific provenance and signing/update trust evidence.
