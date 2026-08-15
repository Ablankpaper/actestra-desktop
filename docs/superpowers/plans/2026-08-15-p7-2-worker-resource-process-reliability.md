# P7.2 Worker Resource and Process Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one Main-owned, immutable resource budget and fail-closed process/resource enforcement to the existing General utility process and Goose ACP runner without introducing a second worker, sandbox, policy, or UI framework.

**Architecture:** A small platform-neutral budget module defines the two fixed worker profiles, validates and freezes every attempt budget, and exposes only bounded incident metadata. Existing supervision remains the terminal authority: a monitor reports a typed breach to the supervisor, which persists the terminal evidence and invokes the worker's existing cleanup path. General keeps Electron `utilityProcess`; Goose keeps the pinned Rust runner and macOS `sandbox-exec`, with native limits applied before ACP startup. No Renderer, Planner, foundation, or persistence schema change is introduced.

**Tech Stack:** TypeScript, Electron 37 `utilityProcess`/`app.getAppMetrics`, Vitest, Rust `libc::setrlimit`, macOS `sandbox-exec`, existing Actestra Core events/evidence, downstream overlay source copies.

---

### Task 1: Add the immutable budget and incident contract

**Files:**
- Create: `apps/desktop/src/core/workerResourceBudget.ts`
- Modify: `apps/desktop/src/core/index.ts`
- Test: `tests/core/workerResourceBudget.test.ts`

- [ ] **Step 1: Write the failing contract tests**

  Cover exact keys, positive safe integer ranges, the fixed General/Goose profiles, deep freezing, renderer/non-worker attempts to widen a profile, and the seven closed incident codes. Assert that incident metadata contains only `workerKind`, `attemptId`, `resourceKind`, `observed`, and `limit` (plus a sanitized termination shape), never paths, prompts, output, environment, or credentials.

- [ ] **Step 2: Run the focused test and confirm the expected missing-module failure**

  Run: `bun run test -- tests/core/workerResourceBudget.test.ts`

  Expected: FAIL because `workerResourceBudget.ts` and its exports do not yet exist.

- [ ] **Step 3: Implement the minimal contract**

  Export `WorkerKind`, `WorkerResourceBudget`, `WorkerResourceProfile`, `WORKER_RESOURCE_PROFILES`, `WorkerResourceIncidentCode`, `WorkerResourceIncident`, `assertWorkerResourceBudget`, `freezeWorkerResourceBudget`, and `createWorkerResourceIncident`. Validate exact keys, integer bounds, and immutable values at the Main boundary; do not accept caller-supplied profiles.

- [ ] **Step 4: Run the focused test and then the core tests**

  Run: `bun run test -- tests/core/workerResourceBudget.test.ts tests/core`

  Expected: all focused and existing core tests pass.

- [ ] **Step 5: Commit the contract slice**

  ```bash
  git add apps/desktop/src/core/workerResourceBudget.ts apps/desktop/src/core/index.ts tests/core/workerResourceBudget.test.ts
  git commit -m "feat: define p7.2 worker resource budget contract"
  ```

### Task 2: Make supervisor terminalization resource-aware

**Files:**
- Create: `apps/desktop/src/main/workers/workerResourceMonitor.ts`
- Modify: `apps/desktop/src/main/workers/agentAdapterSupervisor.ts`
- Modify: `apps/desktop/src/core/agentAdapter.ts`
- Test: `tests/main/workerResourceMonitor.test.ts`
- Test: `tests/main/agentAdapterSupervisor.test.ts`

- [ ] **Step 1: Add failing tests for breach ordering and pause/resume**

  Use a deterministic clock and fake observation source to prove that the first breach wins over a concurrent normal exit, a human-decision hold pauses only active duration, a second hold does not release early, and a breach is terminal, non-retryable, and cleaned exactly once.

- [ ] **Step 2: Run the tests and verify they fail for the missing resource API**

  Run: `bun run test -- tests/main/workerResourceMonitor.test.ts tests/main/agentAdapterSupervisor.test.ts`

  Expected: FAIL because no monitor or supervisor resource-terminal method exists.

- [ ] **Step 3: Implement the monitor and supervisor port**

  Add `AgentAdapterSupervisor.failForResource(sessionId, incident)` (idempotent, Main-only) and a monitor with `start`, `hold`, `stop`, and `snapshot`. The monitor accepts an injected clock/observation source, emits only the closed incident metadata, stops accepting effects before cleanup, and calls the supervisor port once. Extend incident code typing without changing the Core event shape.

- [ ] **Step 4: Run focused supervisor/monitor tests**

  Run: `bun run test -- tests/main/workerResourceMonitor.test.ts tests/main/agentAdapterSupervisor.test.ts`

  Expected: PASS with no duplicate cleanup and no retryable resource breach.

- [ ] **Step 5: Commit the supervision slice**

  ```bash
  git add apps/desktop/src/core/agentAdapter.ts apps/desktop/src/main/workers/agentAdapterSupervisor.ts apps/desktop/src/main/workers/workerResourceMonitor.ts tests/main/workerResourceMonitor.test.ts tests/main/agentAdapterSupervisor.test.ts
  git commit -m "feat: terminalize worker resource breaches through supervisor"
  ```

### Task 3: Enforce and monitor the General Worker budget

**Files:**
- Modify: `apps/desktop/src/main/workers/electronGeneralWorker.ts`
- Modify: `apps/desktop/src/main/workers/generalWorkerProcessAdapter.ts`
- Modify: `apps/desktop/src/main/workers/generalWorkCoordinator.ts`
- Modify: `apps/desktop/src/main/workers/agentAttemptEvidenceCoordinator.ts`
- Test: `tests/main/electronGeneralWorkerResource.test.ts`
- Test: `tests/main/generalWorkerProcessAdapter.test.ts`

- [ ] **Step 1: Write failing launch and metric tests**

  Assert the fixed General profile supplies `--max-old-space-size=256`, records utility PID plus creation time, rejects a metrics source without a provable private-memory field, classifies CPU/memory/active-duration breaches, and preserves the exact incident code in terminal evidence.

- [ ] **Step 2: Run focused tests and confirm they fail**

  Run: `bun run test -- tests/main/electronGeneralWorkerResource.test.ts tests/main/generalWorkerProcessAdapter.test.ts`

  Expected: FAIL because launch has no budget/monitor options and the adapter has no resource terminal hook.

- [ ] **Step 3: Implement the General launch integration**

  Add a Main-created budget option, derive the V8 argument from the admitted profile, expose an injectable `app.getAppMetrics` source, match PID and creation time, and start a periodic monitor with an unref'ed timer. Route every breach to the existing adapter/supervisor cleanup path; never convert it to completion, unchanged, cancellation, or a retryable crash.

- [ ] **Step 4: Run focused General tests and existing worker tests**

  Run: `bun run test -- tests/main/electronGeneralWorkerResource.test.ts tests/main/generalWorkerProcessAdapter.test.ts tests/main/generalWorkCoordinator.test.ts`

  Expected: PASS and unchanged protocol/event behavior for non-breach journeys.

- [ ] **Step 5: Commit the General slice**

  ```bash
  git add apps/desktop/src/main/workers/electronGeneralWorker.ts apps/desktop/src/main/workers/generalWorkerProcessAdapter.ts apps/desktop/src/main/workers/generalWorkCoordinator.ts apps/desktop/src/main/workers/agentAttemptEvidenceCoordinator.ts tests/main/electronGeneralWorkerResource.test.ts tests/main/generalWorkerProcessAdapter.test.ts
  git commit -m "feat: enforce general worker resource budget"
  ```

### Task 4: Enforce Goose native limits and process-tree denial

**Files:**
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/Cargo.toml`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerSandbox.ts`
- Test: `tests/main/gooseRunnerResource.test.ts`
- Test: `workers/goose-runner/src/main.rs` (unit tests where practical)

- [ ] **Step 1: Write failing Rust/TypeScript launch tests**

  Assert that admitted Goose options carry an immutable address-space/CPU budget, invalid or unavailable limits fail before spawn, the generated seatbelt profile denies fork/exec and allows only the existing runner plus admitted loopback ports, and the failure mapping is one of the closed resource codes.

- [ ] **Step 2: Run focused tests and confirm the missing enforcement**

  Run: `bun run test -- tests/main/gooseRunnerResource.test.ts && cargo test --manifest-path workers/goose-runner/Cargo.toml`

  Expected: FAIL because no resource launch contract or native `setrlimit` calls exist.

- [ ] **Step 3: Implement native limits in the existing runner**

  Pass only validated numeric values through the trusted launch environment, call `setrlimit` before `goose::acp::server::run`, return a stable failure marker on setup failure, and add the explicit sandbox process-fork/exec denial without adding a wrapper or sidecar.

- [ ] **Step 4: Run focused Rust/TypeScript tests and Goose lifecycle tests**

  Run: `bun run test -- tests/main/gooseRunnerResource.test.ts tests/main/gooseRunnerLifecycle.test.ts && cargo test --manifest-path workers/goose-runner/Cargo.toml`

  Expected: PASS; existing ACP handshake, parent-death, and cleanup tests remain green.

- [ ] **Step 5: Commit the Goose slice**

  ```bash
  git add workers/goose-runner/Cargo.toml workers/goose-runner/src/main.rs apps/desktop/src/main/workers/gooseRunnerProcess.ts apps/desktop/src/main/workers/gooseRunnerSandbox.ts tests/main/gooseRunnerResource.test.ts
  git commit -m "feat: enforce goose worker resource limits"
  ```

### Task 5: Bound output and Goose private-root storage

**Files:**
- Create: `apps/desktop/src/main/workers/workerStorageBudget.ts`
- Modify: `apps/desktop/src/main/workers/gooseCodingToolInvoker.ts`
- Modify: `apps/desktop/src/main/workers/gooseCodingArtifactPublisher.ts`
- Modify: `apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts`
- Test: `tests/main/workerStorageBudget.test.ts`
- Test: `tests/main/gooseCodingToolInvoker.test.ts`
- Test: `tests/main/isolatedCodingTools.test.ts`

- [ ] **Step 1: Write failing aggregate/per-file/output tests**

  Cover bounded `lstat` traversal, 64 MiB per-file and 512 MiB aggregate Goose private-root limits, pre-write rejection, post-write recheck, ACP/output overflow, symlink denial, and redacted errors. Assert that a rejected write cannot produce a successful or unchanged terminal result.

- [ ] **Step 2: Run the focused tests and confirm missing storage enforcement**

  Run: `bun run test -- tests/main/workerStorageBudget.test.ts tests/main/gooseCodingToolInvoker.test.ts tests/main/isolatedCodingTools.test.ts`

  Expected: FAIL because current write/publish paths do not account for the shared private-root budget.

- [ ] **Step 3: Implement bounded accounting at existing Main-owned write boundaries**

  Add a no-shell, bounded traversal helper; call it before and after Main-owned writes/publish reads; preserve existing content/path caps; map overflow to `worker-resource-output-exceeded` or `worker-resource-storage-exceeded` and close the attempt through the existing lifecycle.

- [ ] **Step 4: Run focused storage/tool tests**

  Run: `bun run test -- tests/main/workerStorageBudget.test.ts tests/main/gooseCodingToolInvoker.test.ts tests/main/isolatedCodingTools.test.ts`

  Expected: PASS with no raw path/content in thrown or persisted messages.

- [ ] **Step 5: Commit the storage slice**

  ```bash
  git add apps/desktop/src/main/workers/workerStorageBudget.ts apps/desktop/src/main/workers/gooseCodingToolInvoker.ts apps/desktop/src/main/workers/gooseCodingArtifactPublisher.ts apps/desktop/src/main/privileged/isolatedCodingToolExecutor.ts tests/main/workerStorageBudget.test.ts tests/main/gooseCodingToolInvoker.test.ts tests/main/isolatedCodingTools.test.ts
  git commit -m "feat: enforce worker output and private storage bounds"
  ```

### Task 6: Add hostile local probes and downstream composition

**Files:**
- Create: `scripts/smoke-p7-2-resource-reliability.mjs`
- Create: `tests/security/p7ResourceReliabilitySmoke.test.ts`
- Create: `downstream/aionui-v2.1.41/patches/0019-actestra-p7-resource-reliability.mjs`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `tests/scripts/aionuiDownstreamPathSafety.test.mjs`
- Modify: `tests/scripts/p7CiWiring.test.mjs`

- [ ] **Step 1: Add failing wiring/probe tests**

  Assert that the new source copies and patch are registered, probe inputs are not packaged/trusted, unsupported probes exit nonzero, and the packaged smoke requires explicit General/Goose breach, cleanup, and redaction markers.

- [ ] **Step 2: Run the wiring tests and confirm they fail**

  Run: `bun run test -- tests/security/p7ResourceReliabilitySmoke.test.ts tests/scripts/aionuiDownstreamPathSafety.test.mjs tests/scripts/p7CiWiring.test.mjs`

  Expected: FAIL because patch 0019, source copies, and smoke entry do not exist.

- [ ] **Step 3: Implement the downstream patch and probes**

  Copy only Actestra-owned sources into the existing `packages/desktop/src/actestra` namespace, wire the already-composed Main services, and make the smoke launch the exact `.app` under a fresh isolated profile. A skipped hostile probe is an error; every result is bounded metadata only.

- [ ] **Step 4: Run wiring and local probe tests**

  Run: `bun run test -- tests/security/p7ResourceReliabilitySmoke.test.ts tests/scripts/aionuiDownstreamPathSafety.test.mjs tests/scripts/p7CiWiring.test.mjs && node scripts/smoke-p7-2-resource-reliability.mjs`

  Expected: PASS on supported macOS arm64, with no residual Actestra/AionCore/Goose/Planner/General Worker or probe processes.

- [ ] **Step 5: Commit the packaged composition slice**

  ```bash
  git add downstream/aionui-v2.1.41/patches/0019-actestra-p7-resource-reliability.mjs downstream/aionui-v2.1.41/overlay.json scripts/smoke-p7-2-resource-reliability.mjs tests/security/p7ResourceReliabilitySmoke.test.ts tests/scripts/aionuiDownstreamPathSafety.test.mjs tests/scripts/p7CiWiring.test.mjs
  git commit -m "test: add packaged p7.2 resource reliability smoke"
  ```

### Task 7: Record ADR and phase evidence

**Files:**
- Create: `docs/architecture/decisions/0028-p7-worker-resource-and-process-reliability.md`
- Modify: `docs/architecture/decisions/README.md`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/README.md`
- Modify: `THIRD_PARTY_NOTICES.md` only if the Rust source adds a new external dependency

- [ ] **Step 1: Write documentation conformance tests**

  Assert ADR-0028 is indexed, P7.2 scope/non-goals and the exact incident vocabulary are present, the stale P7.1 evidence sentence is corrected, and status separates local/package/PR/merge/acceptance evidence.

- [ ] **Step 2: Run docs tests and confirm missing references**

  Run: `bun run docs:check && bun run test -- tests/scripts/aionuiDownstreamPathSafety.test.mjs`

  Expected: the new ADR/index/status assertions fail until the documents are updated.

- [ ] **Step 3: Add the accepted ADR and evidence placeholders only for verified results**

  Record the existing Electron/Rust/sandbox authorities, fixed profiles, rollback, and explicit P8 non-claims. Do not claim packaged, CI, or real-provider evidence before those commands have run on the final bytes.

- [ ] **Step 4: Run documentation and repository checks**

  Run: `git diff --check && bun run docs:check`

  Expected: PASS with no unverified completion language.

- [ ] **Step 5: Commit the documentation slice**

  ```bash
  git add docs/architecture/decisions/0028-p7-worker-resource-and-process-reliability.md docs/architecture/decisions/README.md docs/architecture/SYSTEM_OVERVIEW.md docs/roadmap/DEVELOPMENT_SEQUENCE.md docs/PROJECT_STATUS.md docs/README.md THIRD_PARTY_NOTICES.md
  git commit -m "docs: record p7.2 resource reliability authority"
  ```

### Task 8: Run the complete P7.2 gate and handoff

- [ ] **Step 1: Install dependencies in this isolated worktree and run narrow checks**

  Run: `bun install --frozen-lockfile`, then the focused tests from Tasks 1–7.

- [ ] **Step 2: Run the full local gate**

  Run: `NODE_OPTIONS=--max-old-space-size=4096 bun run check && bun run goose:runner:check`.

- [ ] **Step 3: Build and verify the exact development app**

  Run: `bun run dist:dir && bun run verify:package && bun run verify:p7-package`.

- [ ] **Step 4: Run packaged smoke against a fresh profile**

  Run: `bun run smoke:aionui-general-work && bun run smoke:p7-security && node scripts/smoke-p7-2-resource-reliability.mjs`.

- [ ] **Step 5: Record evidence, inspect processes, and stop at the PR boundary**

  Run: `git diff --check`, a bounded process scan, `git status -sb`, and `git log -1`. Record local/package evidence separately from exact-head CI, merge, merged-main CI, release, deployment, and final user acceptance. Push only after the user reviews the final diff.
