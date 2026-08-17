# P8.2b Linux Authenticated ACP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the exact native Ubuntu Goose runner can complete an authenticated Main-owned ACP journey through the Linux Unix-socket relay, while the production runtime resolver remains Darwin-only and partial evidence remains fail closed.

**Architecture:** Keep `resolveGooseRunnerRuntimeTarget()` unchanged and use a Vitest-only module mock to select the already-declared Linux build target inside the native integration test. Add the real Linux direct-spawn branch to the existing Main transport factory, then drive the existing session composition, model server, MCP server, leases, ACP handshake, and cleanup code with deterministic model/tool invokers. A bounded composite evidence gate will require both the all-true native primitive result and the authenticated ACP result before it writes the existing containment record; neither input can pass by itself.

**Tech Stack:** TypeScript, Node child processes and Unix sockets, Vitest 4.1, Bun 1.3.9, Rust 1.96.1, GitHub Actions `ubuntu-24.04`.

---

## Fixed boundary

- Do not edit `foundation/`, Renderer, preload, provider, credentials, persistence, or the pinned Goose source.
- Do not change `resolveGooseRunnerRuntimeTarget()`; Linux and Windows remain unavailable to the packaged product in this batch.
- Do not add a production environment override, exported target-bypass API, host-network fallback, root/sudo/setuid, cgroup mutation, container, or second supervisor.
- Keep the raw Rust probe's `complete = false`. Only the composite Node gate may promote all-true primitive evidence plus exact authenticated integration evidence into the existing durable containment record.
- No real Provider secret is used. This gate proves transport and lifecycle only; P8.4 still owns real-provider acceptance.

## File responsibility map

- `apps/desktop/src/main/workers/gooseRunnerProcess.ts`: real Linux direct-spawn branch behind the unchanged runtime preflight; fixed marker mapping and process-group cleanup stay shared.
- `tests/main/gooseRunnerLinuxNative.integration.ts`: exact-artifact authenticated ACP lifecycle using a Vitest-only runtime-target mock.
- `tests/fixtures/gooseLinuxNativeSupervisorExit.test.ts`: opt-in child supervisor used only by the parent-death integration scenario; skipped in ordinary test discovery.
- `scripts/run-goose-runner-native-integration.mjs`: bounded Linux-only test launcher and evidence-file admission.
- `scripts/gooseNativeIntegrationEvidence.mjs`: closed schema, digest binding, exact keys, and redaction-safe validation.
- `scripts/record-goose-runner-containment.mjs`: composite binder; requires primitive and integration evidence for Linux before manifest mutation.
- `scripts/run-goose-runner-containment.mjs`: ordered native integration, primitive probe, binding, restart validation, and bounded final output.
- `tests/scripts/gooseRunnerNativeIntegration.test.mjs`: source, schema, fail-closed, no-secret, and production-ceiling contracts.
- `.github/workflows/ci.yml`: exact Ubuntu Artifact integration before success-only evidence upload.
- `docs/PROJECT_STATUS.md`: exact-head local/CI evidence and remaining Windows/P8.2/P8.3/P8.4 non-claims.

### Task 1: Add the real but still unreachable Linux Main launcher

**Files:**

- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `tests/main/gooseRunnerLifecycle.test.ts`
- Modify: `tests/main/gooseRunnerTarget.test.ts`
- Modify: `tests/scripts/gooseRunnerPortability.test.mjs`

- [ ] **Step 1: Write the failing launcher tests.**

Add a Linux source/option contract that requires direct execution of the staged admitted binary, `detached: true`, the inherited parent-liveness pipe at fd 3, the exact closed bridge environment, and a loopback-session network policy. Keep assertions that the public handshake resolves `resolveGooseRunnerRuntimeTarget(process.platform, process.arch)` before `preparePrivateRoot`, and that Linux runtime resolution remains `undefined`.

- [ ] **Step 2: Run the focused tests and verify RED.**

Run:

```bash
bun run test -- tests/main/gooseRunnerLifecycle.test.ts tests/main/gooseRunnerTarget.test.ts tests/scripts/gooseRunnerPortability.test.mjs
```

Expected: the new Linux launcher contract fails because `createNodeGooseAcpTransport()` currently admits only Darwin.

- [ ] **Step 3: Implement the minimal Linux branch.**

Refactor the transport factory into closed Darwin and Linux branches. The Linux branch must require:

```ts
process.platform === "linux"
process.arch === "x64"
options.networkPolicy !== "deny-all"
options.workspaceDirectory !== undefined
options.environment.ACTESTRA_GOOSE_LINUX_CAPABILITY_SOCKET !== undefined
options.environment.ACTESTRA_GOOSE_LINUX_MODEL_SOCKET !== undefined
```

It launches only `options.executablePath` with no arguments:

```ts
spawn(options.executablePath, [], {
  cwd: options.workingDirectory,
  env: { ...options.environment, ACTESTRA_PARENT_LIVENESS_FD: "3" },
  detached: true,
  stdio: ["pipe", "pipe", "pipe", "pipe"],
  windowsHide: true,
});
```

The runner remains responsible for namespace, Landlock, seccomp, limits, relay, and ACP setup. Unknown platforms still fail with `network-policy-unavailable`; no shell or helper command is introduced.

- [ ] **Step 4: Run focused tests and verify GREEN.**

Run the command from Step 2, then `bun run typecheck`, `bun run format:check`, and `git diff --check`.

- [ ] **Step 5: Commit the launcher slice.**

Commit only the four listed files as `feat: add closed Linux Goose launcher`.

### Task 2: Drive the exact Artifact through authenticated ACP

**Files:**

- Create: `tests/main/gooseRunnerLinuxNative.integration.ts`
- Create: `tests/fixtures/gooseLinuxNativeSupervisorExit.test.ts`
- Modify: `scripts/test-goose-runner.mjs` only if ordinary discovery must explicitly retain the fixture skip

- [ ] **Step 1: Write the opt-in native integration test and observe RED.**

At module load, use `vi.mock()` only in this test to make `resolveGooseRunnerRuntimeTarget("linux", "x64")` return `resolveGooseRunnerBuildTarget("linux", "x64")`. Do not alter the production target module. Require exact artifact directory, trusted manifest digest, evidence output path, and `ACTESTRA_GOOSE_NATIVE_INTEGRATION=1`; otherwise skip the native-only suite.

The first test must use real `openGooseMcpSessionComposition()` defaults and deterministic invokers to prove:

- Goose `initialize` and exact version/capabilities;
- `session/new` and authenticated `_goose/unstable/tools/list`;
- exact admitted tool discovery;
- one bounded prompt;
- one valid tool call that Main returns as an explicit denial;
- a final model message after that denial; and
- duplicate close with an empty private-root parent.

Run on macOS without the opt-in environment and confirm the suite skips rather than passing as native evidence.

- [ ] **Step 2: Add cancellation and crash/restart tests.**

For cancellation, hold the deterministic model invoker until its `AbortSignal` fires, close the composition, assert the prompt rejects with a closed session/transport code, and assert all sockets/private roots are removed. For crash/restart, locate only the staged runner whose command line contains the returned canonical private root, send `SIGKILL`, assert the active prompt fails, close idempotently, open a second composition, complete one bounded prompt, and verify no residual process or private root.

- [ ] **Step 3: Add the opt-in supervisor-death fixture.**

The fixture must be skipped unless `ACTESTRA_GOOSE_NATIVE_SUPERVISOR=1`. When enabled it opens the same real composition, writes only `{ privateRoot, runnerPid }` to the caller-owned state file, prints `READY`, and stays alive. The parent integration test kills the supervisor rather than the runner, verifies the detached runner and relay terminate within a fixed deadline, verifies both socket paths are no longer listening, and removes the caller-owned fixture parent in `finally`.

- [ ] **Step 4: Emit one bounded evidence file only after every scenario passes.**

Write an exact object containing contract version, target triple, source commit, executable digest, and these booleans:

```text
initialize, openSession, toolDiscovery, prompt, toolDenial,
cancellation, crashRestart, parentDeath, cleanup
```

Do not include paths, PIDs, leases, prompts, model text, tool input/output, environment values, or timestamps.

- [ ] **Step 5: Run the native test on Ubuntu only.**

Local macOS verification is limited to type/source contracts and the opt-in skip. The real GREEN claim must come from `ubuntu-24.04` against the exact emitted Artifact.

### Task 3: Bind primitive and ACP evidence fail closed

**Files:**

- Create: `scripts/gooseNativeIntegrationEvidence.mjs`
- Create: `scripts/run-goose-runner-native-integration.mjs`
- Create: `tests/scripts/gooseRunnerNativeIntegration.test.mjs`
- Modify: `scripts/gooseContainmentEvidence.mjs`
- Modify: `scripts/record-goose-runner-containment.mjs`
- Modify: `scripts/run-goose-runner-containment.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing exact-schema tests.**

Require exact keys, all nine booleans `true`, `status: "verified"`, exact Linux target, 40-character source commit, and 64-character executable digest. Assert rejection of an extra key, missing key, false capability, mismatched digest/commit, path-bearing value, oversized input, malformed JSON, and an integration file outside the caller-owned evidence root.

- [ ] **Step 2: Verify RED.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerNativeIntegration.test.mjs tests/scripts/gooseRunnerContainmentAcceptance.test.mjs tests/scripts/gooseContainmentEvidenceBinding.test.mjs
```

Expected: the integration schema/command and composite binder are absent.

- [ ] **Step 3: Implement the bounded integration launcher.**

Register:

```json
"goose:runner:integration:linux": "node scripts/run-goose-runner-native-integration.mjs"
```

The launcher resolves the native host target, computes the exact admitted manifest digest, creates a caller-owned temporary evidence directory, runs only the native integration test with a 120-second timeout and bounded stdout/stderr, validates the emitted evidence, prints one closed JSON line, and removes its temporary directory. Any error collapses to a closed `integration-*` code.

- [ ] **Step 4: Implement composite containment binding.**

Keep `validateGooseContainmentEvidence()` unchanged for final verified records. Add a separate primitive validator that accepts only `status: "evidence-incomplete"` with all six native booleans true. For Linux, `record-goose-runner-containment.mjs` must require a separately validated integration evidence file bound to the same target, source commit, and executable digest before constructing the existing status-free containment record. Windows keeps its current incomplete path and cannot reuse Linux evidence.

- [ ] **Step 5: Preserve all failure and privacy boundaries.**

The final acceptance command must run integration before manifest mutation, never write partial evidence, never echo child output, and delete temporary evidence in `finally`. Its stdout remains bounded structural evidence; stderr remains one closed code. Tests must assert the script and workflow contain no Provider/API credential names.

- [ ] **Step 6: Run focused tests and commit.**

Run the Step 2 suite, `bun run typecheck`, lint, format, and `git diff --check`. Commit as `feat: bind Linux Goose ACP evidence`.

### Task 4: Wire exact Ubuntu CI and record evidence

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`
- Modify: `tests/scripts/p8NativeBuildWiring.test.mjs`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Write failing CI-order assertions.**

Require the Ubuntu containment job to build, admit, run the authenticated integration gate, run composite containment acceptance, validate the post-bind Artifact again, and upload only the final bounded file on success. Assert Windows does not run the Linux integration command and that no job receives Provider credentials.

- [ ] **Step 2: Verify RED.**

Run both script test files and confirm the missing integration step/order fails.

- [ ] **Step 3: Add the exact Ubuntu steps.**

Keep one Ubuntu job and the existing pinned actions. Do not use `continue-on-error`. Store integration evidence only in the job temporary directory, pass its canonical path to the composite binder, delete it after binding, and preserve only the final success-only containment JSON.

- [ ] **Step 4: Run the complete local gate.**

Run focused tests, `bun run goose:runner:format:check`, `bun run check`, `bun run docs:check`, and `git diff --check`. On macOS, report the native integration suite as skipped/not run rather than green.

- [ ] **Step 5: Push and inspect exact-head CI.**

Wait for every job on the pushed commit. Inspect the full Ubuntu integration and containment logs, download the success-only Artifact, validate its exact keys/digests, and confirm there are no residual Goose/relay processes. A failed, skipped, missing, or stale-head result does not advance the gate.

- [ ] **Step 6: Update status and commit the evidence record.**

Record exact commit, run/job IDs, counts, digests, and explicit non-claims. If the native gate fails, record the fixed blocker instead and leave Linux containment/admission open.

## Exit gate

This batch closes only the Linux authenticated runtime-composition evidence when a fresh exact-head Ubuntu 24.04 job proves the same executable through all primitive booleans and all nine authenticated integration outcomes. The production resolver remains Darwin-only after this batch. Windows containment, cross-platform packaged product journeys, P8.2 overall, P8.3 candidate integrity/signing/update/rollback, and P8.4 clean-machine real-provider acceptance remain open.
