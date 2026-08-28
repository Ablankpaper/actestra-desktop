# P8.2 Packaged Product-Journey Evidence Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each packaged P8.2 target run the nine bounded product journeys through the existing Actestra Main/Core authorities and emit only exact, redacted, fail-closed journey evidence.

**Architecture:** Add a Main-side, source-copied coordinator that is inert unless the explicit packaged-smoke marker and a complete isolated environment are present. The coordinator receives already-composed authority callbacks from the downstream startup patch, executes the fixed nine-journey order with one timeout and one cleanup barrier, and writes a single newline-terminated result file only after every journey and residual-process check is verified. The existing external smoke controller remains responsible for package layout, hashes, runner attestation, process-tree probes, and source/CI binding.

**Tech Stack:** TypeScript, Electron Main, Vitest, downstream AionUi overlay patches, Node.js file/process APIs, GitHub Actions.

---

## Files and boundaries

- Create `apps/desktop/src/main/security/p8ProductJourneySmoke.ts`: closed environment parser, journey identifiers/result types, bounded coordinator interfaces, privacy assertions, write-once result writer, timeout/cleanup aggregation, and the Main-owned runner.
- Create `tests/security/p8ProductJourneySmoke.test.ts`: unit/TDD coverage for parser, order, result shape, privacy, timeout, cleanup, and write-once behavior.
- Create `tests/scripts/p8ProductJourneyDownstream.test.mjs`: overlay/source-copy/patch contract checks; this test must inspect text and never execute a packaged app.
- Modify `downstream/aionui-v2.1.41/overlay.json`: append patch `0024` metadata and the coordinator source copy with its exact classification and owner.
- Create `downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs`: inject the copied coordinator into the existing Main startup after renderer load and existing service composition; leave ordinary startup and `ACTESTRA_P8_FRESH_PROFILE_SMOKE` unchanged.
- Modify `.github/workflows/ci.yml`: invoke `smoke:p8-product-journeys` in the existing macOS, Windows, and Ubuntu final-package jobs with exact runtime/package/runner/source/CI bindings and upload one evidence artifact per target.
- Modify `docs/PROJECT_STATUS.md` only after exact-head CI produces fresh current-SHA evidence; record the implementation as local/CI evidence and keep P8.2, P8.3, and P8.4 gates separate.

## Contract constants used by every task

The coordinator and downstream patch must use these exact values and no aliases:

```ts
export const P8_PRODUCT_JOURNEY_IDS = Object.freeze([
  "fresh-profile-launch",
  "general-artifact",
  "goose-isolated-patch",
  "workspace-apply-approval",
  "general-goose-team",
  "cancellation-no-orphan",
  "crash-restart-recovery",
  "privacy-redaction",
  "p7-platform-obligations",
] as const);
export type P8ProductJourneyId = (typeof P8_PRODUCT_JOURNEY_IDS)[number];
export type P8ProductJourneyStatus = "verified";
export type P8ProductJourneyObservation = Readonly<{
  id: P8ProductJourneyId;
  status: P8ProductJourneyStatus;
  residualProcessCount: 0;
}>;
export type P8ProductJourneyResult = Readonly<{
  schemaVersion: 1;
  status: "verified";
  journeys: readonly P8ProductJourneyObservation[];
}>;
```

### Task 1: Add failing coordinator contract tests

**Files:**
- Create: `tests/security/p8ProductJourneySmoke.test.ts`

- [ ] **Step 1: Write the failing tests.**

Add the following node-environment test module. It deliberately imports the not-yet-created coordinator and exercises only closed public contracts:

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  P8_PRODUCT_JOURNEY_IDS,
  assertP8ProductJourneyPrivacy,
  createP8ProductJourneyCoordinator,
  parseP8ProductJourneySmokeEnvironment,
  type P8ProductJourneyRunContext,
} from "../../apps/desktop/src/main/security/p8ProductJourneySmoke";

const root = "/tmp/actestra-p8-smoke";
const completeEnvironment = {
  ACTESTRA_E2E_TEST: "1",
  ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE: "1",
  ACTESTRA_E2E_ISOLATION_ROOT: root,
  ACTESTRA_USER_DATA_DIR: `${root}/user-data`,
  ACTESTRA_E2E_HOME_DIR: `${root}/home`,
  ACTESTRA_E2E_TEMP_DIR: `${root}/temp`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE: `${root}/workspace`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: `${root}/user-data/p8-product-journeys-result.json`,
  ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS: "30000",
};

function context(overrides: Partial<P8ProductJourneyRunContext> = {}): P8ProductJourneyRunContext {
  return {
    environment: completeEnvironment,
    appIsPackaged: true,
    executeJourney: async (id) => ({ id, status: "verified", residualProcessCount: 0 }),
    cleanup: async () => ({ residualProcessCount: 0 }),
    ...overrides,
  };
}

describe("P8 packaged product-journey coordinator", () => {
  it("is inert unless the complete explicit environment is present", () => {
    expect(parseP8ProductJourneySmokeEnvironment({})).toBeNull();
    expect(parseP8ProductJourneySmokeEnvironment(completeEnvironment)?.resultPath).toBe(
      completeEnvironment.ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT,
    );
    expect(
      parseP8ProductJourneySmokeEnvironment({
        ...completeEnvironment,
        ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT: "/tmp/outside/result.json",
      }),
    ).toBeNull();
  });

  it("runs the fixed nine journeys in order and returns only bounded observations", async () => {
    const seen: string[] = [];
    const result = await createP8ProductJourneyCoordinator(
      context({
        executeJourney: async (id) => {
          seen.push(id);
          return { id, status: "verified", residualProcessCount: 0 };
        },
      }),
    ).run();
    expect(seen).toEqual(P8_PRODUCT_JOURNEY_IDS);
    expect(result).toEqual({
      schemaVersion: 1,
      status: "verified",
      journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({ id, status: "verified", residualProcessCount: 0 })),
    });
    expect(JSON.stringify(result)).not.toMatch(/path|credential|worker|pid|payload/i);
  });

  it("fails closed and never writes a success result when a journey or cleanup fails", async () => {
    const writeResult = vi.fn();
    await expect(
      createP8ProductJourneyCoordinator(
        context({
          writeResult,
          executeJourney: async (id) => {
            if (id === "goose-isolated-patch") throw new Error("journey-failed");
            return { id, status: "verified", residualProcessCount: 0 };
          },
        }),
      ).run(),
    ).rejects.toMatchObject({ code: "journey-failed" });
    expect(writeResult).not.toHaveBeenCalledWith(expect.objectContaining({ status: "verified" }));
  });

  it("rejects privacy leaks in bounded projections", () => {
    expect(() => assertP8ProductJourneyPrivacy({ status: "verified", journeys: [] })).not.toThrow();
    expect(() => assertP8ProductJourneyPrivacy({ privatePath: "/Users/private" })).toThrow(
      "privacy-redaction-failed",
    );
    expect(() => assertP8ProductJourneyPrivacy({ credential: "secret" })).toThrow(
      "privacy-redaction-failed",
    );
  });

  it("aggregates residual processes as a closed cleanup failure", async () => {
    await expect(
      createP8ProductJourneyCoordinator(
        context({ cleanup: async () => ({ residualProcessCount: 1 }) }),
      ).run(),
    ).rejects.toMatchObject({ code: "residual-processes" });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED.**

Run `bunx vitest run tests/security/p8ProductJourneySmoke.test.ts --reporter=verbose` from the worktree. Expected: collection fails because `apps/desktop/src/main/security/p8ProductJourneySmoke.ts` does not exist. Do not add a production stub before observing this failure.

- [ ] **Step 3: Commit the red test.**

```bash
git add tests/security/p8ProductJourneySmoke.test.ts
git commit -m "test: define p8 packaged journey coordinator contract"
```

### Task 2: Implement the closed Main-side coordinator

**Files:**
- Create: `apps/desktop/src/main/security/p8ProductJourneySmoke.ts`
- Test: `tests/security/p8ProductJourneySmoke.test.ts`

- [ ] **Step 1: Implement environment parsing and path containment.**

Require `ACTESTRA_E2E_TEST=1`, `ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE=1`, `appIsPackaged`, absolute canonical-looking isolation root, user-data/home/temp/workspace/result children, and a bounded timeout between 1,000 and 300,000 ms. Reject symlink-like or outside paths by lexical `path.relative` containment; return `null` on every malformed or incomplete input. Do not include raw environment values in thrown errors.

- [ ] **Step 2: Implement the bounded runner interface.**

Export `P8ProductJourneyRunContext` with `executeJourney(id)`, `cleanup()`, optional `writeResult(value)`, optional `now()`, and optional `signal`. Wrap each callback in one global timeout; normalize only stable error codes (`journey-failed`, `journey-timeout`, `cleanup-failed`, `residual-processes`, `privacy-redaction-failed`, `result-write-failed`). Run the nine IDs sequentially, stop on first failure, always await cleanup, and reject if any journey or cleanup reports a non-zero residual count.

- [ ] **Step 3: Implement the write-once result contract.**

Write `JSON.stringify(result) + "\n"` to `<result>.tmp` with mode `0600`, then atomically rename it to the exact result path. Refuse a second write in the same coordinator instance and never write `{status:"verified"}` from a failure path. Keep the result keys exactly `schemaVersion`, `status`, and `journeys`; detailed diagnostics remain in process logs controlled by the external script.

- [ ] **Step 4: Implement privacy assertions.**

Allow only bounded primitive status objects and recursively reject keys or string values matching `credential`, `secret`, `token`, `password`, `privatePath`, `rawPayload`, `workerPid`, `processId`, or an absolute home/workspace path. Throw only `privacy-redaction-failed`.

- [ ] **Step 5: Run focused tests to GREEN.**

Run `bunx vitest run tests/security/p8ProductJourneySmoke.test.ts --reporter=verbose`. Expected: all coordinator tests pass. Then run `bun run format:check -- apps/desktop/src/main/security/p8ProductJourneySmoke.ts tests/security/p8ProductJourneySmoke.test.ts` and fix only formatting issues.

- [ ] **Step 6: Commit the coordinator.**

```bash
git add apps/desktop/src/main/security/p8ProductJourneySmoke.ts tests/security/p8ProductJourneySmoke.test.ts
git commit -m "feat: add fail-closed p8 product journey coordinator"
```

### Task 3: Add downstream source-copy and startup hook contracts

**Files:**
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Create: `downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs`
- Create: `tests/scripts/p8ProductJourneyDownstream.test.mjs`

- [ ] **Step 1: Write failing downstream contract tests.**

Assert that the overlay contains one `0024` patch classified only `R1`/`R2`, owned by Actestra Main, and exactly one source copy from `apps/desktop/src/main/security/p8ProductJourneySmoke.ts` to `packages/desktop/src/actestra/main/security/p8ProductJourneySmoke.ts`. Assert that the patch imports the copied coordinator, gates on `ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE`, checks `app.isPackaged`, starts only once after the existing renderer-ready/service-composition point, awaits completion before `app.quit`, writes `p8-product-journeys-result.json`, and does not alter `foundation/`, preload, renderer authority, or generic IPC. Run this test before adding the patch and observe the expected RED failure.

- [ ] **Step 2: Add the overlay metadata.**

Append the patch entry after `0023-actestra-product-acceptance-fixes.mjs` and add the source copy alongside the existing P7 security source copies. Record the owner, domains, rollback, and `R1`/`R2` classification; do not change the pinned upstream fields or frozen foundation manifest.

- [ ] **Step 3: Implement the downstream patch.**

Use the existing `replaceOnce`/`writeNew` pattern. Import `runP8ProductJourneySmoke` and `resolveP8ProductJourneySmokeEnvironment` into the materialized Main entry. Add one `p8ProductJourneySmokeStarted` guard. After `mainWindow.webContents` has loaded and the existing Main/Core composition variables are initialized, call the coordinator with adapter callbacks that invoke the already-composed General, Coding/Goose, Team, approval, recovery, P7, persistence, and process-cleanup authorities. The adapter must return only `{id,status,residualProcessCount:0}`. Do not instantiate a second persistence, policy, provider, worker, or Team authority. On success log `ACTESTRA_P8_PRODUCT_JOURNEYS_READY` and quit gracefully; on failure log only the closed code and exit non-zero after cleanup. Keep the hook inert when the marker is absent, the package is not packaged, the environment parser returns `null`, or the fresh-profile marker is active.

- [ ] **Step 4: Materialize and run the downstream contract tests.**

Run `bunx vitest run tests/scripts/p8ProductJourneyDownstream.test.mjs --reporter=verbose`, then `bun run downstream:aionui:materialize`. Expected: the patch applies once, `.actestra-overlay.json` lists the new patch/source copy, and the frozen foundation check reports no changes.

- [ ] **Step 5: Commit the downstream hook.**

```bash
git add downstream/aionui-v2.1.41/overlay.json downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs tests/scripts/p8ProductJourneyDownstream.test.mjs
git commit -m "feat: wire packaged p8 journeys through downstream main"
```

### Task 4: Bind the nine adapters to existing authorities

**Files:**
- Modify: `downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs`
- Test: `tests/security/p8ProductJourneySmoke.test.ts`
- Test: existing Main authority tests under `tests/main/`

- [ ] **Step 1: Add adapter-level failing tests.**

Use spies for the existing Main-owned General Work, isolated coding, Team orchestrator, approval, recovery, P7 security/resource/diagnostic, and process supervisor ports. Assert one call per journey, exact argument identities derived inside the isolated workspace, persistence before acknowledgement, approval before apply, no source-checkout mutation, cancellation followed by process cleanup, recovery without replay, and privacy-redacted projections. Assert no adapter can receive a raw credential, renderer object, source checkout, or arbitrary path.

- [ ] **Step 2: Implement each adapter as a thin bounded composition.**

Implement the journey callbacks in this order:

1. retain the existing fresh-profile observation;
2. submit a text-only General task and assert a durable terminal Task plus Actestra Artifact reference;
3. start Goose through the admitted runner and isolated worktree, capture a patch, and assert the source checkout digest is unchanged;
4. require a distinct persisted approval, re-capture the artifact digest, apply only to the supplied destination, and verify the postcondition;
5. create/start the already admitted Team plan and assert General + Goose node completion and bounded aggregation;
6. cancel an in-flight attempt, await supervisor group cleanup, and require zero descendants;
7. exercise the existing crash/restart recovery path, read durable state once, and reject a duplicate effect;
8. inspect only bounded DTOs and run `assertP8ProductJourneyPrivacy`;
9. invoke existing P7 packaged security/resource/diagnostic and cleanup authorities and require their accepted closed outcomes.

Every adapter must throw a stable code on unavailable provider, runner mismatch, dirty workspace, approval drift, ambiguous persistence, unsupported primitive, timeout, or cleanup failure. No adapter may mark an unsupported result as verified.

- [ ] **Step 3: Run focused adapter tests and existing authority suites.**

Run `bunx vitest run tests/security/p8ProductJourneySmoke.test.ts tests/main/aionuiGeneralWorkJourneyService.test.ts tests/main/aionuiCodingJourneyService.test.ts tests/main/teamOrchestratorService.test.ts --reporter=verbose`. Expected: all focused tests pass; any existing failure is reported at its first concrete boundary and not hidden by retries.

- [ ] **Step 4: Commit the adapter composition.**

```bash
git add downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs tests/security/p8ProductJourneySmoke.test.ts
git commit -m "feat: compose real p8 journeys from existing authorities"
```

### Task 5: Connect the three package jobs to the external controller

**Files:**
- Modify: `.github/workflows/ci.yml`
- Test: `tests/scripts/p8CiWiring.test.mjs` (extend existing contract)

- [ ] **Step 1: Write failing CI contract assertions.**

Extend the existing CI wiring test to require one `Run P8.2 packaged product-journey acceptance` step in each `electron-package-windows`, Ubuntu package section, and `macos` job. Each invocation must pass the exact target ID, runtime, every package format for that target, `${{ github.sha }}`, `--ci-run-id "${{ github.run_id }}"`, all three runner digests, and a target-specific `out/p8-evidence/p8-product-journeys-*.json` path. Require an `actions/upload-artifact` step with a matching path and `${{ github.sha }}` in its name. Run the test and observe RED.

- [ ] **Step 2: Add Windows wiring.**

After runner re-admission and before the fresh-profile step, invoke the controller against `win-unpacked/Actestra.exe` and the single NSIS installer. Compute or reuse the admitted runner manifest/executable/containment digests from the existing job outputs; do not introduce secrets or an alternate runner directory. Upload only the bounded evidence JSON.

- [ ] **Step 3: Add Ubuntu wiring.**

After the complete DEB is installed and AppArmor is loaded, run under `xvfb-run` against `/opt/Actestra/Actestra` and the exact DEB path. Preserve the existing cleanup trap and upload the evidence before package removal.

- [ ] **Step 4: Add macOS wiring.**

After the app, DMG, ZIP, and runner re-admission are complete, invoke the controller against `out/mac-arm64/Actestra.app` plus exactly one DMG and ZIP. Keep P7 trust and existing General/P7 smokes separate. Upload the journey record with three-day retention and no release/candidate promotion.

- [ ] **Step 5: Run CI contract and YAML checks.**

Run `bunx vitest run tests/scripts/p8CiWiring.test.mjs --reporter=verbose` and `bun run p8:contract:check`. Expected: the three package jobs contain exact current-SHA journey invocations and the P8 matrix remains unchanged.

- [ ] **Step 6: Commit CI wiring.**

```bash
git add .github/workflows/ci.yml tests/scripts/p8CiWiring.test.mjs
git commit -m "ci: run p8 product journeys on all package targets"
```

### Task 6: Run materialized native checks and record only fresh evidence

**Files:**
- Modify: `docs/PROJECT_STATUS.md` only after exact-head CI evidence exists.

- [ ] **Step 1: Run narrow local verification.**

Run, in order:

```bash
bunx vitest run tests/security/p8ProductJourneySmoke.test.ts tests/scripts/p8ProductJourneyDownstream.test.mjs tests/scripts/p8CiWiring.test.mjs --reporter=verbose
bun run downstream:aionui:materialize
bun run downstream:aionui:check
bun run foundation:aionui:check
bun run typecheck
bun run format:check
bun run lint
git diff --check
```

Then run the materialized native TypeScript and focused AionUi suites used by the existing package jobs. A local green result is implementation evidence only; it does not update the P8 ledger.

- [ ] **Step 2: Run the existing external controller only with a real packaged app and admitted runner.**

For each target, run `bun run smoke:p8-product-journeys -- ...` with the exact package paths, isolated profile, runner digests, source SHA, and CI run ID. Do not fabricate `p8-product-journeys-result.json`, copy a result between targets, or use the old candidate path.

- [ ] **Step 3: Validate each record and the matrix.**

Run `bun run p8:journeys:check -- out/p8-evidence/p8-product-journeys-macos-15-arm64.json out/p8-evidence/p8-product-journeys-windows-11-x64.json out/p8-evidence/p8-product-journeys-ubuntu-24.04-x64.json`. A missing, malformed, incomplete, or residual-process record keeps the gate closed.

- [ ] **Step 4: Update status only with exact-head CI artifacts.**

If and only if all 27 rows validate against one exact source SHA and CI run, append a dated `PROJECT_STATUS.md` section linking the three artifact names and recording P8.2 product-journey evidence as verified. Keep candidate, signing, release, deployment, clean-machine, real-provider, and user-acceptance states explicitly unstarted/open. If any target fails, record the first closed failure boundary and leave the ledger `evidence-incomplete`.

- [ ] **Step 5: Commit documentation evidence separately.**

```bash
git add docs/PROJECT_STATUS.md
git commit -m "docs: record exact-head p8 product journey evidence"
```

## Self-review checklist

- The nine IDs and order match `scripts/p8-product-journey-evidence.mjs` exactly.
- The coordinator is source-copied through the overlay and never edits `foundation/`.
- The result file contains no paths, credentials, Worker/process identifiers, raw payloads, or renderer authority.
- Cleanup runs on success and failure; residual processes fail closed.
- The external controller remains the package/hash/runner/CI binding authority.
- CI runs all three accepted P8 targets and uploads bounded records without starting P8.3/P8.4.
- No local, PR-only, old-candidate, or fixture-only evidence is promoted to the ledger.
