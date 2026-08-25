# P8.2d Native Electron Package and Fresh-Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate the native Electron package from a clean isolated
Actestra profile on all three accepted P8 targets.

**Architecture:** A single root smoke runner owns target/package validation,
profile isolation, bounded evidence, durable-state checks, and cleanup. One R1
downstream patch adds a stable identifier to the existing model-provider empty
state and a Main-only E2E probe; CI supplies only platform-native package and
runtime paths.

**Tech Stack:** Node.js 24 ESM, Vitest, Electron/electron-builder, React/AionUI
downstream patching, SQLite `node:sqlite`, GitHub Actions, PowerShell, Bash, and
Xvfb.

---

### Task 1: Lock the bounded evidence contract

**Files:**

- Create: `tests/scripts/p8FreshProfileEvidence.test.mjs`
- Create: `scripts/p8-fresh-profile-evidence.mjs`

- [ ] **Step 1: Write RED tests for exact verified evidence**

  Import `P8_FRESH_PROFILE_TARGETS`, `validateP8FreshProfileEvidence`, and
  `validateP8FreshProfileFailureEvidence`. Assert a complete macOS record
  validates, then separately reject an extra key, wrong target, wrong package
  formats, digest mismatch, nonzero Provider count, missing UI state, schema
  other than 23, nonzero residual count, and a string containing a path or
  credential. Assert a closed failed record cannot validate as success.

- [ ] **Step 2: Run the evidence tests and observe RED**

  Run:

  ```bash
  bun run test tests/scripts/p8FreshProfileEvidence.test.mjs
  ```

  Expected: fail because `scripts/p8-fresh-profile-evidence.mjs` does not
  exist.

- [ ] **Step 3: Implement the minimal exact-schema validator**

  Define the three target/format pairs, exact success and failure key arrays,
  the SHA-256 and commit patterns, and a closed failure-code set. Return only
  `{ ok: true }` or `{ ok: false, code: '<closed-code>' }`; never return the
  rejected value.

- [ ] **Step 4: Run the evidence tests and observe GREEN**

  Run the same focused command and require zero failures.

### Task 2: Lock smoke parsing, isolation, and cleanup behavior

**Files:**

- Create: `tests/scripts/smokeP8FreshProfile.test.mjs`
- Create: `scripts/smoke-p8-fresh-profile.mjs`

- [ ] **Step 1: Write RED tests for runner failure boundaries**

  Use temporary package/profile fixtures and injected child/process probes.
  Cover these one-behavior cases: early exit, startup timeout, malformed
  marker, Provider count nonzero, missing UI state, profile symlink escape,
  process-snapshot failure, and a surviving descendant. Add one successful
  fixture that writes the exact manifest/database/marker and exits zero.

- [ ] **Step 2: Run the smoke tests and observe RED**

  ```bash
  bun run test tests/scripts/smokeP8FreshProfile.test.mjs
  ```

  Expected: fail because the smoke runner exports are absent.

- [ ] **Step 3: Implement package discovery and safe hashing**

  Parse repeatable `format=path` inputs, require exact target formats, reject
  symlinks/non-files, resolve the platform runtime layout, and stream SHA-256
  for each package, executable, and `app.asar`.

- [ ] **Step 4: Implement the isolated launch and marker state machine**

  Create private `user-data`, `home`, and `temp` children; pass the existing
  E2E isolation variables plus `ACTESTRA_P8_FRESH_PROFILE_SMOKE=1`; cap output;
  require exactly one bounded marker; and never copy raw child diagnostics into
  evidence.

- [ ] **Step 5: Implement profile, SQLite, normal-exit, and residual checks**

  Require the exact profile manifest and schema 23. Poll an injected/native
  process snapshot while the app runs, then require every observed descendant
  PID to disappear after a zero exit. A snapshot error remains failed.

- [ ] **Step 6: Run smoke and evidence tests and observe GREEN**

  ```bash
  bun run test \
    tests/scripts/p8FreshProfileEvidence.test.mjs \
    tests/scripts/smokeP8FreshProfile.test.mjs
  ```

### Task 3: Add the retained AionUI empty-state acceptance hook

**Files:**

- Create: `downstream/aionui-v2.1.41/patches/0022-actestra-p8-fresh-profile-smoke.mjs`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `scripts/check-aionui-downstream.mjs`
- Modify: `tests/scripts/aionuiDownstreamPathSafety.test.mjs`
- Create: `tests/scripts/p8FreshProfileDownstream.test.mjs`

- [ ] **Step 1: Write RED downstream contract tests**

  Require patch 0022 to be R1 with Main ownership and rollback text; require
  `ModelModalContent.tsx` to contain
  `data-testid='actestra-provider-unavailable'`; require the fresh mode to skip
  the General Worker probe; and require the exact bounded ready marker, direct-
  fetch denial, Main-owned Provider IPC call, model route, selectors, and
  `app.quit()`.

- [ ] **Step 2: Run the downstream tests and observe RED**

  ```bash
  bun run test \
    tests/scripts/p8FreshProfileDownstream.test.mjs \
    tests/scripts/aionuiDownstreamPathSafety.test.mjs
  ```

- [ ] **Step 3: Implement patch 0022 with no visual or authority change**

  The patch adds only the empty-state identifier and an E2E-only
  `did-finish-load` branch. The branch calls
  `window.electronAPI.actestraProviderList`, requires an empty list, navigates
  to `#/settings/model`, polls the two selectors, returns only three bounded
  fields, logs `ACTESTRA_P8_FRESH_PROFILE_READY`, and invokes `app.quit()`.
  Change the existing General Worker probe condition to exclude only this
  fresh-profile mode.

- [ ] **Step 4: Record the patch and changed-file contract**

  Append patch 0022 metadata to `overlay.json`, keep the source file in
  `expectedChangedFiles`, and extend the checker without changing the frozen
  source or overlay phase.

- [ ] **Step 5: Materialize and run native compatibility checks**

  ```bash
  bun run downstream:aionui:materialize
  bun run test \
    tests/scripts/p8FreshProfileDownstream.test.mjs \
    tests/scripts/aionuiDownstreamPathSafety.test.mjs
  bunx tsc --cwd .actestra/aionui-v2.1.41 --noEmit --pretty false
  ```

### Task 4: Wire package commands and three native CI records

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `tests/scripts/p8FreshProfileCiWiring.test.mjs`

- [ ] **Step 1: Write RED CI-wiring tests**

  Require the root smoke command; macOS DMG plus ZIP build and evidence upload;
  one Windows 2025 job producing NSIS plus `win-unpacked` and launching
  `Actestra.exe`; and the Ubuntu DEB job launching the exact extracted
  `/opt/Actestra/Actestra` under `xvfb-run`. Require all three artifact names to
  include the target and `${{ github.sha }}` and all uploads to use the bounded
  evidence file.

- [ ] **Step 2: Run the CI-wiring test and observe RED**

  ```bash
  bun run test tests/scripts/p8FreshProfileCiWiring.test.mjs
  ```

- [ ] **Step 3: Add root scripts and platform-native CI steps**

  Add `smoke:p8-fresh-profile`. Extend macOS and Ubuntu jobs instead of
  duplicating their native builds. Add the missing Windows Electron package
  job. Upload evidence with `if-no-files-found: error`, short retention, and no
  logs/profile directories.

- [ ] **Step 4: Run all focused contract tests and observe GREEN**

  ```bash
  bun run test \
    tests/scripts/p8FreshProfileEvidence.test.mjs \
    tests/scripts/smokeP8FreshProfile.test.mjs \
    tests/scripts/p8FreshProfileDownstream.test.mjs \
    tests/scripts/p8FreshProfileCiWiring.test.mjs \
    tests/scripts/aionuiDownstreamPathSafety.test.mjs
  ```

### Task 5: Verify locally and create the exact-head CI candidate

**Files:**

- Modify after CI only: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Run downstream and repository gates**

  ```bash
  bun run downstream:aionui:materialize
  bunx tsc --cwd .actestra/aionui-v2.1.41 --noEmit --pretty false
  bun run downstream:aionui:check
  bun run check
  bun run docs:check
  git diff --check
  ```

- [ ] **Step 2: Run the host-native macOS package smoke**

  Build the full DMG plus ZIP from the materialized tree with signing discovery
  disabled, then run `smoke:p8-fresh-profile` against the generated `.app` and
  both package files. Validate the resulting JSON against the current commit
  binding. This remains local macOS evidence only.

- [ ] **Step 3: Review the complete diff and secret boundary**

  Confirm no `foundation/` file, generated package, profile, log, credential,
  or unrelated working-tree path is included. Confirm Renderer authority did
  not expand.

- [ ] **Step 4: Commit and push one reviewable branch**

  Use Conventional Commits, push `codex/p8-2-package-runtime`, create/update the
  pull request, and allow exactly one exact-head CI run. Do not blindly rerun a
  failure; inspect the first bounded failure record.

- [ ] **Step 5: Independently validate the three CI evidence records**

  Download only the macOS, Windows, and Ubuntu P8.2d JSON artifacts. Verify
  their GitHub archive digests, file SHA-256 values, exact source SHA, target,
  format set, and evidence validator result. Require three `verified` records.

- [ ] **Step 6: Update status only after native evidence exists**

  Add the exact PR head, run/job/artifact IDs, digests, validator results, and
  remaining P8.2/P8.3/P8.4 non-claims to `docs/PROJECT_STATUS.md`; rerun the
  documentation gates and use the repository PR/merge workflow.
