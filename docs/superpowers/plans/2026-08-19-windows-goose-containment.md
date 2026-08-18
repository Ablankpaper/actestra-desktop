# Windows Goose Runtime Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce exact-artifact Windows x64 evidence for filesystem, network, process-tree, resource, parent-death, and cleanup containment using the production AppContainer and Job Object launch path.

**Architecture:** Keep `containment/windows.rs` as the evidence orchestrator, add one pure fixed-frame contract that can be tested on macOS, and expose one opaque probe seam from `windows_supervisor.rs` instead of duplicating Windows APIs. The exact runner launches bounded probe roles of itself, collects only fixed booleans and closed stage codes, and emits `verified` only after the parent independently confirms all six capabilities.

**Tech Stack:** Rust 1.96.1, `windows-sys` 0.61.2, Node.js/Bun evidence binders, Vitest, GitHub Actions `windows-2025`.

---

## File map

- Create `workers/goose-runner/src/containment/windows_contract.rs`: fixed probe-mode names, bounded request/result frames, safe metadata helpers, and portable unit tests.
- Modify `workers/goose-runner/src/containment/mod.rs`: include the pure Windows contract in test builds and keep production dispatch Windows-only.
- Modify `workers/goose-runner/src/containment/windows.rs`: exact Windows probe orchestration, hostile operations, parent-death observation, cleanup, closed diagnostics, and final record serialization.
- Modify `workers/goose-runner/src/windows_supervisor.rs`: expose one opaque containment launch seam that reuses the exact production AppContainer, Job Object, suspended-launch, handle-list, token, and cleanup primitives.
- Modify `workers/goose-runner/src/main.rs`: dispatch fixed containment child/intermediate roles only when the existing containment-probe marker is exact.
- Modify `scripts/gooseContainmentEvidence.mjs`: admit only enumerated Windows bounded-stage diagnostics.
- Modify `tests/scripts/gooseContainmentDiagnostics.test.mjs`: prove closed diagnostic classification and raw-output rejection.
- Create `tests/scripts/gooseWindowsContainmentContract.test.mjs`: portable source and CI wiring contract for the Windows implementation.
- Modify `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`: lock exact-artifact Windows acceptance and success-only upload.
- Modify `docs/PROJECT_STATUS.md`: record only exact local/CI evidence and the remaining runtime-admission boundary.

### Task 1: Add the fixed Windows probe contract

**Files:**
- Create: `workers/goose-runner/src/containment/windows_contract.rs`
- Modify: `workers/goose-runner/src/containment/mod.rs:1-105`
- Test: `workers/goose-runner/src/containment/windows_contract.rs`

- [ ] **Step 1: Write the failing portable contract tests**

Create the new module with tests first. The tests must call the not-yet-defined
`parse_role`, `encode_result`, `decode_result`, and `bounded_probe_metadata`
functions so the first compile is genuinely red. Add tests for exact mode
parsing, exact frame length/version/magic, rejection of unknown bits or
trailing bytes, and safe metadata normalization. Start with this public shape:

```rust
pub(crate) const WINDOWS_PROBE_CHILD_ARGUMENT: &str =
    "--actestra-windows-containment-child-v1";
pub(crate) const WINDOWS_PROBE_PARENT_ARGUMENT: &str =
    "--actestra-windows-containment-parent-v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsContainmentRole {
    Child,
    IntermediateParent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowsProbeResult {
    pub(crate) filesystem_attempted: bool,
    pub(crate) filesystem_denied: bool,
    pub(crate) network_attempted: bool,
    pub(crate) network_denied: bool,
    pub(crate) process_attempted: bool,
    pub(crate) process_denied: bool,
    pub(crate) environment_canary_absent: bool,
    pub(crate) excluded_handle_absent: bool,
}
```

The encoded result must be a fixed byte array, not JSON. Reserve all unused
bits as zero and reject them during decode.

- [ ] **Step 2: Run the Rust compile and verify RED**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_contract --no-run
```

Expected: compilation fails on the undefined contract functions, proving the
tests—not an empty filter—are the red phase.

- [ ] **Step 3: Implement the minimal pure contract**

Add the module under `#[cfg(any(windows, test))]` so its protocol tests run on
macOS without compiling `windows-sys` APIs:

```rust
#[cfg(any(windows, test))]
mod windows_contract;
```

Implement exact role parsing from the full argument slice, fixed frame
encoding/decoding, and the same bounded target/hex validation rules used by the
Linux evidence record. Do not read paths, handles, PIDs, or environment values
into the result type.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_contract
bun run goose:runner:format:check
```

Expected: all new portable contract tests pass and Rust formatting is clean.

- [ ] **Step 5: Commit the contract**

```bash
git add workers/goose-runner/src/containment/mod.rs \
  workers/goose-runner/src/containment/windows_contract.rs
git commit -m "feat: define Windows containment probe contract"
```

### Task 2: Reuse the production supervisor boundary

**Files:**
- Modify: `workers/goose-runner/src/windows_supervisor.rs:467-1408`
- Modify: `workers/goose-runner/src/containment/windows.rs:1-16`
- Create: `tests/scripts/gooseWindowsContainmentContract.test.mjs`

- [ ] **Step 1: Write the failing portable source contract**

Create a Vitest file that reads the two Rust sources and asserts all of the
following exact properties:

```javascript
expect(supervisor).toContain("pub(crate) struct WindowsContainmentLaunch");
expect(supervisor).toContain("pub(crate) fn launch_windows_containment_worker");
expect(supervisor).toContain("PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES");
expect(supervisor).toContain("PROC_THREAD_ATTRIBUTE_HANDLE_LIST");
expect(supervisor).toContain("AssignProcessToJobObject");
expect(supervisor).toContain("ResumeThread");
expect(supervisor).toContain("TokenIsAppContainer");
expect(windowsProbe).toContain("launch_windows_containment_worker");
```

Also assert that the seam returns opaque observations rather than raw
`HANDLE`, `PSID`, environment maps, or Win32 message strings.

- [ ] **Step 2: Run the source contract and verify RED**

Run:

```bash
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs
```

Expected: failure on the absent opaque launch seam.

- [ ] **Step 3: Extract one opaque launch seam**

Keep the existing private RAII wrappers. Add an owning wrapper with only these
operations:

```rust
pub(crate) struct WindowsContainmentLaunch {
    profile: AppContainerProfile,
    job: JobObject,
    worker: SuspendedWorker,
    pipes: WorkerPipeSet,
}

pub(crate) struct ProbeHandle {
    // The HANDLE is private to windows_supervisor.rs. No raw handle crosses the
    // containment module boundary.
}

pub(crate) struct WindowsContainmentObservation {
    pub(crate) app_container: bool,
    pub(crate) assigned_before_resume: bool,
    pub(crate) resumed_once: bool,
    pub(crate) exact_job_limits: bool,
}

pub(crate) fn launch_windows_containment_worker(
    attempt_id: &str,
    executable: &Path,
    current_directory: &Path,
    child_argument: &str,
    excluded_handle: &ProbeHandle,
) -> Result<WindowsContainmentLaunch, WindowsContainmentFailure>;
```

`ProbeHandle` is created and closed by `windows_supervisor.rs`; the
containment orchestrator can only request that it be omitted from the exact
handle list. `WindowsContainmentLaunch` must provide bounded methods to write the fixed
request, read the fixed result, query the observation, wait for termination,
and perform explicit cleanup. It must not expose the Job, token, SID, pipes, or
raw handles to `containment/windows.rs`.

Refactor the existing internal launch function to accept the exact child
argument while production continues to pass
`--actestra-windows-worker-v1`. Both paths must use the same AppContainer,
attribute list, handle list, suspended launch, assign-before-resume, and
single-resume code.

- [ ] **Step 4: Add native assertions to the existing Windows test matrix**

Extend `windows_native_tests` so the probe seam asserts:

```rust
assert!(observation.app_container);
assert!(observation.assigned_before_resume);
assert!(observation.resumed_once);
assert!(observation.exact_job_limits);
```

Create one inheritable event that is deliberately omitted from the handle
list; the probe child must later report it absent. Do not accept a plain-token
or inherited-environment fallback.

- [ ] **Step 5: Run portable checks and commit**

Run:

```bash
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs \
  tests/scripts/p8NativeBuildWiring.test.mjs
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
bun run goose:runner:format:check
```

Expected: portable contracts and all host Rust tests pass. The new
`#[cfg(windows)]` assertions remain explicitly unverified until Windows CI.

Commit:

```bash
git add workers/goose-runner/src/windows_supervisor.rs \
  workers/goose-runner/src/containment/windows.rs \
  tests/scripts/gooseWindowsContainmentContract.test.mjs
git commit -m "refactor: expose Windows containment launch seam"
```

### Task 3: Add real child hostile probes

**Files:**
- Modify: `workers/goose-runner/src/containment/windows.rs`
- Modify: `workers/goose-runner/src/main.rs:1-105`
- Modify: `workers/goose-runner/src/windows_supervisor.rs`
- Modify: `workers/goose-runner/src/containment/windows_contract.rs`
- Test: `workers/goose-runner/src/containment/windows.rs`
- Test: `tests/scripts/gooseWindowsContainmentContract.test.mjs`

- [ ] **Step 1: Write failing dispatch and result tests**

The portable tests must prove that probe roles dispatch only when
`ACTESTRA_GOOSE_CONTAINMENT_PROBE=1`, reject extra arguments, and do not become
valid `WindowsMode` values. The native result test must require every hostile
operation to report both `attempted=true` and `denied=true`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_contract
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs
```

Expected: failure because `main.rs` has no probe-role dispatch and the child
does not execute hostile operations.

- [ ] **Step 3: Implement exact probe-only dispatch**

Before the normal Windows mode parser, dispatch only the exact probe roles:

```rust
#[cfg(windows)]
if env::var("ACTESTRA_GOOSE_CONTAINMENT_PROBE").as_deref() == Ok("1") {
    if let Some(exit_code) = containment::dispatch_windows_containment_role(&arguments) {
        std::process::exit(exit_code);
    }
}
```

The top-level no-argument containment path must still call
`run_windows_containment_probe()`. Unknown or duplicate role arguments exit
nonzero with one closed marker.

- [ ] **Step 4: Implement the child operations**

After reading one bounded request frame from stdin, the AppContainer child
must:

1. attempt to read the outside sentinel and set `filesystem_denied` only on
   `PermissionDenied`/the exact closed Windows denial class;
2. attempt to create or replace the outside output and report denial;
3. initialize Winsock and attempt one connection to the bounded parent
   listener;
4. attempt to create one child instance of the exact runner;
5. verify the environment canary is absent;
6. verify the deliberately excluded inheritable handle is invalid;
7. write one fixed result frame and exit.

Setup failure, missing attempt, timeout, EOF, unexpected success, unknown
Win32 code, or malformed frame must remain false/incomplete. The parent must
independently confirm the outside files are unchanged, no listener connection
was accepted, Job membership is exactly one, and the production Job limits
query back exactly.

- [ ] **Step 5: Add Windows-native tests**

Under `#[cfg(all(test, windows))]`, run the real child against temporary
sentinels and a loopback listener. Assert:

```rust
assert!(result.filesystem_attempted && result.filesystem_denied);
assert!(result.network_attempted && result.network_denied);
assert!(result.process_attempted && result.process_denied);
assert!(result.environment_canary_absent);
assert!(result.excluded_handle_absent);
assert_eq!(outside_bytes_after, outside_bytes_before);
assert!(!outside_output.exists());
```

- [ ] **Step 6: Run host checks and commit**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs \
  tests/scripts/gooseRunnerPortability.test.mjs
bun run goose:runner:format:check
```

Commit:

```bash
git add workers/goose-runner/src/main.rs \
  workers/goose-runner/src/windows_supervisor.rs \
  workers/goose-runner/src/containment/windows.rs \
  workers/goose-runner/src/containment/windows_contract.rs \
  tests/scripts/gooseWindowsContainmentContract.test.mjs
git commit -m "feat: probe Windows Goose containment boundaries"
```

### Task 4: Prove parent death and exhaustive cleanup

**Files:**
- Modify: `workers/goose-runner/src/containment/windows.rs`
- Modify: `workers/goose-runner/src/containment/windows_contract.rs`
- Modify: `workers/goose-runner/src/windows_supervisor.rs`
- Test: `workers/goose-runner/src/containment/windows.rs`
- Test: `tests/scripts/gooseWindowsContainmentContract.test.mjs`

- [ ] **Step 1: Write failing parent-death and cleanup tests**

Require an intermediate probe role that owns the unique AppContainer profile,
Job, and Worker. The outer process must obtain a synchronization-only Worker
process handle through an internal bounded PID frame, terminate the
intermediate process without an orderly cleanup request, and wait for the
Worker to exit.

The test must separately assert that direct `TerminateJobObject` is used only
for cleanup and is not counted as parent-death evidence.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_contract
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs
```

Expected: failure on the absent intermediate-parent protocol and cleanup
receipt.

- [ ] **Step 3: Implement the intermediate-parent lifecycle**

The intermediate process must:

- create one unique profile and configured non-inheritable Job;
- launch one AppContainer child with only the declared handles;
- send a fixed ready frame containing only the internal Worker PID and stage;
- block without accepting an orderly-shutdown command.

The outer process opens the Worker with synchronization/query rights, kills
the intermediate, and requires `WaitForSingleObject(worker, bounded_timeout)`
to report terminal. Timeout, inability to open, or an already-missing Worker
before the parent is killed is incomplete evidence.

- [ ] **Step 4: Implement explicit cleanup receipts**

Make AppContainer profile removal observable rather than relying only on an
infallible-looking `Drop`. The cleanup result must require:

```rust
WindowsCleanupReceipt {
    worker_terminal: true,
    profile_removed: true,
    private_root_removed: true,
}
```

All handles and listeners remain RAII-owned, but explicit cleanup returns
`Err` when termination, profile deletion, or directory deletion cannot be
confirmed. The outer parent-death probe removes the deterministic profile left
by the forcibly terminated intermediate.

- [ ] **Step 5: Run host checks and commit**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs
bun run goose:runner:format:check
git diff --check
```

Commit:

```bash
git add workers/goose-runner/src/containment/windows.rs \
  workers/goose-runner/src/containment/windows_contract.rs \
  workers/goose-runner/src/windows_supervisor.rs \
  tests/scripts/gooseWindowsContainmentContract.test.mjs
git commit -m "feat: prove Windows Goose parent death and cleanup"
```

### Task 5: Bind exact Windows evidence and run the gate

**Files:**
- Modify: `workers/goose-runner/src/containment/windows.rs`
- Modify: `scripts/gooseContainmentEvidence.mjs:1-100`
- Modify: `tests/scripts/gooseContainmentDiagnostics.test.mjs`
- Modify: `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`
- Modify: `docs/PROJECT_STATUS.md:1-55`

- [ ] **Step 1: Write failing evidence and diagnostic tests**

Add a closed Windows diagnostic set such as:

```javascript
const WINDOWS_CODES = [
  "windows-child-frame-invalid",
  "windows-cleanup-incomplete",
  "windows-filesystem-evidence-incomplete",
  "windows-job-evidence-incomplete",
  "windows-network-evidence-incomplete",
  "windows-parent-death-evidence-incomplete",
  "windows-process-evidence-incomplete",
  "windows-profile-cleanup-failed",
  "windows-resource-evidence-incomplete",
  "windows-worker-launch-failed",
];
```

Tests must accept exactly one line of the form
`Goose windows containment failed at bounded stage <code>`, reject duplicates,
unknown codes, oversized text, raw Win32 strings, paths, PIDs, handles, SIDs,
or environment values, and leave a manifest byte-for-byte unchanged on every
failure.

- [ ] **Step 2: Run evidence tests and verify RED**

Run:

```bash
bun run test tests/scripts/gooseContainmentDiagnostics.test.mjs \
  tests/scripts/gooseContainmentEvidenceBinding.test.mjs \
  tests/scripts/gooseRunnerContainmentAcceptance.test.mjs
```

Expected: failure because Windows diagnostics and a verified Windows record do
not exist.

- [ ] **Step 3: Emit and bind only the complete record**

`run_windows_containment_probe()` must validate the four metadata fields, run
all hostile stages, and serialize the existing exact record shape. Compute:

```rust
let complete = filesystem
    && network
    && process_tree
    && resources
    && parent_death
    && cleanup;
let status = if complete { "verified" } else { "evidence-incomplete" };
```

Never infer success from lack of an error. Emit one closed diagnostic for the
first incomplete stage. Keep the Node binder fail closed and retain
success-only artifact upload.

- [ ] **Step 4: Run narrow and broad local gates**

Run in order:

```bash
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
bun run test tests/scripts/gooseWindowsContainmentContract.test.mjs \
  tests/scripts/gooseContainmentDiagnostics.test.mjs \
  tests/scripts/gooseContainmentEvidenceBinding.test.mjs \
  tests/scripts/gooseRunnerContainmentAcceptance.test.mjs \
  tests/scripts/p8NativeBuildWiring.test.mjs
bun run check
git diff --check
```

Expected: all local portable gates pass. Report Windows-only code as compiled
but not target-native verified unless a Windows target check actually ran.

- [ ] **Step 5: Commit and push the implementation**

```bash
git add workers/goose-runner/src/containment/windows.rs \
  scripts/gooseContainmentEvidence.mjs \
  tests/scripts/gooseContainmentDiagnostics.test.mjs \
  tests/scripts/gooseRunnerContainmentAcceptance.test.mjs
git commit -m "feat: bind Windows Goose containment evidence"
git push origin codex/p8-2b-runtime-containment
```

- [ ] **Step 6: Require exact-head Windows evidence**

Watch the new PR run. The acceptance evidence is valid only if the exact pushed
SHA has all of these results:

- Windows native supervisor/probe tests pass;
- exact Windows runner build and lock-frozen admission pass;
- Windows containment acceptance passes;
- success-only `p8-goose-containment-windows-<sha>` Artifact exists;
- no skipped/unsupported/incomplete result is counted as green.

If a native stage fails, read only the bounded stage code, add one failing test,
and repair that boundary. Do not rerun unchanged failures or weaken the gate.

- [ ] **Step 7: Record exact evidence without overclaiming**

Update `docs/PROJECT_STATUS.md` with the exact commit, run/job IDs, six native
booleans, Artifact name, local commands, and remaining blockers. Explicitly
state that Windows authenticated runtime composition, package journeys, P8.2,
P8.3, P8.4, release, and user acceptance remain open unless independently
proved.

Run:

```bash
bun run docs:check
git diff --check
```

Commit and push only the status record:

```bash
git add docs/PROJECT_STATUS.md
git commit -m "docs: record Windows containment evidence"
git push origin codex/p8-2b-runtime-containment
```

### Task 6: Continue P8.2b after containment

**Files:**
- Planning only after Task 5 exact-head evidence is accepted.

- [ ] **Step 1: Re-audit the remaining Windows runtime boundary**

Confirm whether `launch_controlled_worker()` still terminates after
`WINDOWS_RESOURCE_FAILURE_MARKER`, whether the named-pipe MCP/model bridge is
fully composed, and whether the resolver still keeps Windows runtime admission
closed.

- [ ] **Step 2: Create a separate focused design/plan**

Do not fold authenticated ACP composition, Electron packaging, General/Goose/
Team product journeys, or runtime admission into the containment probe. Write
the next design against the accepted containment Artifact and preserve the P8
gate separation.
