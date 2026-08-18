# P8.2b Windows Goose Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Do not use subagents for this plan
> unless the user explicitly changes the current no-subagent preference.

**Goal:** Implement and verify Windows 11 x64 Goose runtime containment with one
admitted `actestra-goose-runner.exe` using supervisor and AppContainer worker
modes.

**Architecture:** Electron Main remains the admission and policy authority. On
Windows, Main starts the admitted runner in supervisor mode; the supervisor
creates a Job Object, a capability-free AppContainer worker, exact ACLs, and
two named-pipe bridges. The worker uses Actestra-owned Goose Provider and
builtin MCP adapters over named pipes, never host loopback, and Windows runtime
admission stays disabled until exact native evidence is bound into the runner
manifest.

**Tech Stack:** TypeScript/Node 24, Bun/Vitest, Rust 1.96.1, `windows-sys`
0.61.2, Windows Job Object/AppContainer/named-pipe APIs, existing Goose ACP
server, existing Main model and MCP capability boundaries.

---

## Scope And File Map

This plan implements only the Windows P8.2b Goose containment slice described
by:

- `docs/superpowers/specs/2026-08-18-p8-2b-windows-supervisor-design.md`
- `docs/superpowers/specs/2026-08-17-p8-2b-goose-cross-platform-containment-design.md`

It does not implement Windows Electron installer smoke, General Worker
portability, P8.3 signing/update trust, or P8.4 clean-machine acceptance.

### Files To Create

- `workers/goose-runner/src/windows_control.rs` — bounded supervisor/worker
  control-frame parser and serializer.
- `workers/goose-runner/src/windows_bridge.rs` — named-pipe frame contract,
  Actestra Provider adapter, builtin MCP pipe adapter, and conformance vectors.
- `workers/goose-runner/src/windows_supervisor.rs` — Windows Job Object,
  AppContainer, ACL, suspended process launch, parent-death, cleanup, and
  native probe orchestration.
- `tests/main/gooseRunnerWindowsBridge.test.ts` — Main-side bridge/control
  validation and fail-closed launch tests.
- `tests/scripts/gooseRunnerWindowsSupervisorContract.test.mjs` — source-level
  CI wiring checks that the Windows job cannot pass through unsupported stubs.

### Files To Modify

- `workers/goose-runner/src/main.rs` — exact Windows mode dispatch before Goose
  starts.
- `workers/goose-runner/src/containment/windows.rs` — replace the permanent
  unavailable stub with supervisor-backed setup and evidence.
- `workers/goose-runner/src/containment/mod.rs` — expose Windows probe/status
  functions behind `cfg(windows)`.
- `workers/goose-runner/Cargo.toml` and `workers/goose-runner/Cargo.lock` — add
  direct target-specific `windows-sys` dependency and features through Cargo.
- `apps/desktop/src/main/workers/gooseRunnerProcess.ts` — add Windows
  bridge/control contract and supervisor launch branch.
- `apps/desktop/src/main/workers/gooseRunnerTarget.ts` — admit Windows
  executable authority only with verified containment evidence.
- `apps/desktop/src/main/workers/gooseRunnerArtifact.ts` — preserve existing
  containment evidence binding; add Windows negative cases if needed.
- `apps/desktop/src/main/workers/gooseMcpSessionComposition.ts` — allow Windows
  to prepare named-pipe bridge resources instead of direct loopback servers.
- `scripts/run-goose-runner-containment.mjs` — classify Windows supervisor
  evidence and reject unsupported/incomplete output.
- `.github/workflows/ci.yml` — keep Windows build probe distinct; make Windows
  containment job require exact native evidence.
- `docs/PROJECT_STATUS.md` and `docs/roadmap/DEVELOPMENT_SEQUENCE.md` — update
  only after exact evidence exists.

## Task 1: Lock Windows Contract And Fail-Closed Main Launch

**Files:**

- Create: `tests/main/gooseRunnerWindowsBridge.test.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerTarget.ts`
- Modify: `apps/desktop/src/main/workers/gooseMcpSessionComposition.ts`

- [ ] **Step 1: Write failing Main-side Windows contract tests**

Create `tests/main/gooseRunnerWindowsBridge.test.ts` with a `windowsArtifact()`
fixture and two tests. The first proves absent containment evidence rejects
Windows before `transportFactory` is called. The second proves direct
`http://127.0.0.1` loopback is rejected even when the manifest carries exact
Windows containment evidence.

```ts
await expect(
  openGooseRunnerHandshake(
    {
      artifact: windowsArtifact(),
      privateRootParent: root,
      workspaceDirectory: root,
      capabilityProxyUrl: "http://127.0.0.1:41001/mcp",
      modelBinding: {
        baseUrl: "http://127.0.0.1:41002/v1",
        modelId: "test-model",
        attemptLease: "a".repeat(32),
      },
      transportFactory,
    },
    { platform: "win32", architecture: "x64" },
  ),
).rejects.toMatchObject({ code: "network-policy-unavailable" });
expect(transportFactory).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun run test tests/main/gooseRunnerWindowsBridge.test.ts
```

Expected: the test fails because Windows runtime/executable authority and the
Windows no-loopback branch are not yet represented.

- [ ] **Step 3: Add Windows executable authority without allowing launch**

Modify `apps/desktop/src/main/workers/gooseRunnerTarget.ts`:

```ts
export type GooseExecutableAuthority = "attempt-private" | "linux-package" | "windows-supervisor";

export function resolveGooseRunnerExecutableAuthority(
  platform: string,
): GooseExecutableAuthority | undefined {
  if (platform === "darwin") return "attempt-private";
  if (platform === "linux") return "linux-package";
  if (platform === "win32") return "windows-supervisor";
  return undefined;
}
```

Keep runtime admission gated by exact artifact containment evidence; do not use
host OS alone as the trust root.

- [ ] **Step 4: Keep Windows direct loopback fail-closed**

In `apps/desktop/src/main/workers/gooseRunnerProcess.ts`, add:

```ts
export interface GooseRunnerWindowsBridgeEnvironment {
  readonly capabilityPipeName: string;
  readonly modelPipeName: string;
  readonly attemptLease: string;
}
```

Extend `GooseRunnerPreparedBridge` with an optional frozen `windows` field, then
reject Windows if that field is absent:

```ts
if (runtimeTarget.platform === "win32" && bridge?.windows === undefined) {
  throw new GooseRunnerProcessError(
    "network-policy-unavailable",
    "Windows Goose runtime requires the exact admitted named-pipe bridge contract",
  );
}
```

- [ ] **Step 5: Verify Task 1 locally**

Run:

```bash
bun run test tests/main/gooseRunnerWindowsBridge.test.ts tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerLifecycle.test.ts
bun run format:check
bun run lint
git diff --check
```

Expected: all listed commands exit 0. Windows is recognized as a possible
runtime target but still cannot launch without the named-pipe bridge.

- [ ] **Step 6: Commit Task 1**

```bash
git add apps/desktop/src/main/workers/gooseRunnerTarget.ts apps/desktop/src/main/workers/gooseRunnerProcess.ts tests/main/gooseRunnerWindowsBridge.test.ts
git commit -m "test: lock Windows Goose supervisor launch contract"
```

## Task 2: Add Bounded Windows Control And Bridge Frames

**Files:**

- Create: `workers/goose-runner/src/windows_control.rs`
- Create: `workers/goose-runner/src/windows_bridge.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Test: Rust unit tests inside the two new modules

- [ ] **Step 1: Write failing Rust tests for control and frame parsing**

Add tests that require:

- only `--actestra-windows-supervisor-v1` and
  `--actestra-windows-worker-v1` are accepted;
- no-argument Windows launch returns `None`, so Main must choose supervisor
  mode;
- duplicated or combined modes return `Err(())`;
- control messages are bounded to 32 KiB;
- model bridge frames are bounded to 2 MiB; and
- redacted evidence never contains paths, leases, pipe names, prompts, or model
  text.

```rust
assert_eq!(
    WindowsMode::parse(&[
        "actestra-goose-runner.exe".into(),
        "--actestra-windows-supervisor-v1".into(),
    ])
    .unwrap(),
    Some(WindowsMode::Supervisor),
);
assert!(parse_control_message(&vec![b'a'; WINDOWS_CONTROL_MAX_BYTES + 1]).is_err());
```

- [ ] **Step 2: Run Rust tests and verify RED**

Run:

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_control windows_bridge
```

Expected: missing modules/functions.

- [ ] **Step 3: Implement exact parser surfaces**

Add:

```rust
pub(crate) const WINDOWS_CONTROL_MAX_BYTES: usize = 32 * 1024;
pub(crate) const WINDOWS_BRIDGE_MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WindowsMode {
    Supervisor,
    Worker,
}
```

Use exact-key `serde_json::Value` projection. The accepted control message has
only contract version, target triple, executable digest, canonical private
root, canonical worktree root, model id, attempt lease, fixed resource budget,
and 128-bit attempt id.

- [ ] **Step 4: Wire mode dispatch before ordinary Goose startup**

Modify `workers/goose-runner/src/main.rs` so Windows parses the mode before
Tokio, Goose, provider, or MCP initialization:

```rust
#[cfg(windows)]
{
    let args: Vec<String> = std::env::args().collect();
    match windows_control::WindowsMode::parse(&args) {
        Ok(Some(windows_control::WindowsMode::Supervisor)) => {
            std::process::exit(windows_supervisor::run_supervisor());
        }
        Ok(Some(windows_control::WindowsMode::Worker)) => {
            std::process::exit(windows_supervisor::run_worker());
        }
        Ok(None) => {}
        Err(()) => {
            eprintln!("{}", containment::RESOURCE_LIMIT_FAILURE_MARKER);
            std::process::exit(1);
        }
    }
}
```

- [ ] **Step 5: Verify Task 2**

Run:

```bash
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_control windows_bridge
bun run test tests/scripts/gooseRunnerPortability.test.mjs
git diff --check
```

Expected on macOS: source-level tests pass; Windows-native behavior remains
unclaimed until Windows CI runs.

- [ ] **Step 6: Commit Task 2**

```bash
git add workers/goose-runner/src/main.rs workers/goose-runner/src/windows_control.rs workers/goose-runner/src/windows_bridge.rs tests/scripts/gooseRunnerPortability.test.mjs
git commit -m "feat: add Windows Goose supervisor control frames"
```

## Task 3: Add Direct Windows API Dependency And Native Supervisor Skeleton

**Files:**

- Create: `workers/goose-runner/src/windows_supervisor.rs`
- Modify: `workers/goose-runner/Cargo.toml`
- Modify: `workers/goose-runner/Cargo.lock`
- Modify: `workers/goose-runner/src/containment/windows.rs`

- [ ] **Step 1: Add target-specific `windows-sys` dependency**

Modify `workers/goose-runner/Cargo.toml`:

```toml
[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.61.2", features = [
  "Win32_Foundation",
  "Win32_Networking_WinSock",
  "Win32_Security",
  "Win32_Security_AppLocker",
  "Win32_Storage_FileSystem",
  "Win32_System_JobObjects",
  "Win32_System_Pipes",
  "Win32_System_SystemServices",
  "Win32_System_Threading",
] }
```

Run:

```bash
cargo check --manifest-path workers/goose-runner/Cargo.toml --locked
```

If Cargo requires a lock update, run:

```bash
cargo update --manifest-path workers/goose-runner/Cargo.toml -p windows-sys --precise 0.61.2
cargo check --manifest-path workers/goose-runner/Cargo.toml --locked
```

- [ ] **Step 2: Write failing supervisor skeleton tests**

Create `workers/goose-runner/src/windows_supervisor.rs` with tests for pipe-name
derivation and `cfg(windows)` Job Object query-back:

```rust
#[test]
fn derives_pipe_names_without_paths_or_prompt_text() {
    let names = derive_pipe_names("0123456789abcdef0123456789abcdef").unwrap();
    assert!(names.capability.starts_with(r"\\.\pipe\LOCAL\Actestra.Goose."));
    assert!(names.model.starts_with(r"\\.\pipe\LOCAL\Actestra.Goose."));
    assert_ne!(names.capability, names.model);
    assert!(!names.capability.contains("C:"));
}
```

- [ ] **Step 3: Implement fail-closed skeleton functions**

Add:

```rust
pub(crate) const WINDOWS_SETUP_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_NETWORK_POLICY_SETUP_FAILED";
pub(crate) const WINDOWS_RESOURCE_FAILURE_MARKER: &str =
    "ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED";

pub(crate) fn run_supervisor() -> i32 {
    eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
    1
}

pub(crate) fn run_worker() -> i32 {
    eprintln!("{WINDOWS_SETUP_FAILURE_MARKER}");
    1
}
```

- [ ] **Step 4: Keep containment probe incomplete until native setup is real**

Modify `workers/goose-runner/src/containment/windows.rs` so
`run_windows_containment_probe()` returns closed JSON with
`status:"unsupported-platform"` until Task 6 replaces it. Keep
`apply_resource_limits()` failing so runtime cannot be admitted.

- [ ] **Step 5: Verify Task 3**

Run:

```bash
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked derive_pipe_names
bun run test tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseRunnerPortability.test.mjs
git diff --check
```

- [ ] **Step 6: Commit Task 3**

```bash
git add workers/goose-runner/Cargo.toml workers/goose-runner/Cargo.lock workers/goose-runner/src/windows_supervisor.rs workers/goose-runner/src/containment/windows.rs workers/goose-runner/src/main.rs
git commit -m "feat: scaffold Windows Goose supervisor mode"
```

## Task 4: Implement Job Object And AppContainer Native Setup

**Files:**

- Modify: `workers/goose-runner/src/windows_supervisor.rs`
- Modify: `workers/goose-runner/src/containment/windows.rs`
- Test: `cfg(windows)` Rust tests in `windows_supervisor.rs`

- [ ] **Step 1: Add RED native tests for Job Object and AppContainer**

Add `cfg(windows)` tests that create a unique per-attempt AppContainer profile,
prove it has no capabilities, reject a reused profile name, create a Job
Object, and query back kill-on-close, active process limit, job memory limit,
and CPU limit.

- [ ] **Step 2: Implement AppContainer profile lifecycle**

Use `CreateAppContainerProfile`, `DeriveAppContainerSidFromAppContainerName`,
and `DeleteAppContainerProfile` through `windows-sys`. Profile names must be:

```text
Actestra.Goose.<32 lowercase hex attempt id>
```

The implementation rejects non-hex attempt IDs, passes no capabilities, deletes
only the exact derived profile, fails on profile collision, and never writes the
profile SID or attempt ID to stderr.

- [ ] **Step 3: Implement Job Object lifecycle**

Use `CreateJobObjectW`, `SetInformationJobObject`,
`QueryInformationJobObject`, `AssignProcessToJobObject`, and
`TerminateJobObject`. Required limits are kill-on-close, die-on-unhandled
exception, fixed active-process count, 1 GiB job memory, 120 seconds job user
time, and UI restrictions for clipboard/desktop/display/global atoms/handles.

- [ ] **Step 4: Implement suspended worker launch**

Use `CreateProcessW` with:

```text
CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW
```

Use `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` and
`PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`. Assign the worker to the Job
Object before `ResumeThread`.

- [ ] **Step 5: Verify Task 4 on Windows CI**

Run locally where supported:

```bash
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
```

On Windows exact CI, run:

```powershell
bun run goose:runner:build
bun run goose:runner:containment:accept
```

Expected before bridge/probe completion: native setup tests pass, but
containment acceptance remains nonzero because hostile evidence is incomplete.

- [ ] **Step 6: Commit Task 4**

```bash
git add workers/goose-runner/src/windows_supervisor.rs workers/goose-runner/src/containment/windows.rs
git commit -m "feat: add Windows Goose Job Object supervisor"
```

## Task 5: Implement Windows Named-Pipe Provider And MCP Bridge

**Files:**

- Modify: `workers/goose-runner/src/windows_bridge.rs`
- Modify: `workers/goose-runner/src/windows_supervisor.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `apps/desktop/src/main/workers/gooseMcpSessionComposition.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Test: `tests/main/gooseRunnerWindowsBridge.test.ts`

- [ ] **Step 1: Add RED conformance tests for Main bridge contract**

Extend `tests/main/gooseRunnerWindowsBridge.test.ts` with a `prepareBridge`
fixture that returns `windows.capabilityPipeName`, `windows.modelPipeName`, and
`windows.attemptLease`. The test must prove verified Windows evidence reaches
the transport factory only through a named-pipe contract and never through
direct `http://127.0.0.1`.

- [ ] **Step 2: Add Rust bridge adapter tests**

In `workers/goose-runner/src/windows_bridge.rs`, add tests that convert one
Goose provider request into the exact model pipe envelope and one MCP tool-list
request into the exact capability pipe stream. Fixed vectors must contain no
`http://`, `127.0.0.1`, path, or credential.

- [ ] **Step 3: Implement Actestra Provider adapter**

Implement a struct that implements Goose's public `Provider` trait and sends
model requests through the model named pipe. It maps Goose `Message` and `Tool`
values to `ActestraMainModelInvocation`, supports only `purpose:"coding"` and
`responseMode:"text-or-tool-call"`, allows one outstanding request per session,
and converts `ActestraMainModelCompletion` back to a Goose provider stream.

- [ ] **Step 4: Implement builtin MCP pipe adapter**

Register exactly one builtin extension name matching
`actestra-capability-proxy`. Its spawn function connects Goose duplex streams
to the capability named pipe with bounded copying. The adapter does not
implement tools; Main remains the MCP server.

- [ ] **Step 5: Adjust Main composition for Windows**

In `gooseMcpSessionComposition.ts`, make Windows use `prepareBridge` like
Linux, but return Windows pipe metadata rather than socket paths/loopback
ports. Keep Darwin direct loopback unchanged. Main still owns model/MCP
contracts and the worker receives only named-pipe reachability.

- [ ] **Step 6: Verify Task 5**

Run:

```bash
bun run test tests/main/gooseRunnerWindowsBridge.test.ts tests/main/gooseMcpSessionComposition.test.ts tests/main/gooseRunnerLifecycle.test.ts
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_bridge
git diff --check
```

- [ ] **Step 7: Commit Task 5**

```bash
git add apps/desktop/src/main/workers/gooseMcpSessionComposition.ts apps/desktop/src/main/workers/gooseRunnerProcess.ts tests/main/gooseRunnerWindowsBridge.test.ts workers/goose-runner/src/windows_bridge.rs workers/goose-runner/src/windows_supervisor.rs workers/goose-runner/src/main.rs
git commit -m "feat: bridge Windows Goose through named pipes"
```

## Task 6: Add Windows Hostile Probe And Manifest Evidence Binding

**Files:**

- Modify: `workers/goose-runner/src/containment/windows.rs`
- Modify: `scripts/run-goose-runner-containment.mjs`
- Modify: `tests/scripts/gooseRunnerContainmentProbe.test.mjs`
- Modify: `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add RED tests for Windows verified evidence**

Extend `tests/scripts/gooseRunnerContainmentProbe.test.mjs` with a Windows
fixture that has `status:"verified"` but `parentDeath:false`. Expected:
`containment-acceptance-failed` because every required boolean must be true.

- [ ] **Step 2: Implement native hostile probes**

Inside `workers/goose-runner/src/containment/windows.rs`, the probe must execute
through the exact supervisor/worker path and attempt external DNS/TCP,
unrelated localhost, user profile read, original repository read, outside-root
write, junction/symlink/ADS/short-name/case-folding escapes, breakaway/child
limit, memory and CPU limit, Main parent-liveness closure, supervisor crash,
duplicate close, and residue detection.

- [ ] **Step 3: Bind evidence into manifest**

Update the acceptance script to run the exact emitted `.exe`, compute the probe
implementation digest from the Windows source/probe files, require
`targetTriple:"x86_64-pc-windows-msvc"`, and write the manifest `containment`
record only after exact JSON validation.

- [ ] **Step 4: Verify Task 6**

Run locally:

```bash
bun run test tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseRunnerContainmentAcceptance.test.mjs
bun run test tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerTarget.test.ts
git diff --check
```

On Windows exact CI:

```powershell
bun run goose:runner:build
bun run goose:runner:admit-build
bun run goose:runner:containment:accept
```

Expected: Windows containment evidence JSON contains `status:"verified"` and
all six booleans true, with no raw paths, pipe names, SIDs, prompts, leases, or
provider credentials.

- [ ] **Step 5: Commit Task 6**

```bash
git add workers/goose-runner/src/containment/windows.rs scripts/run-goose-runner-containment.mjs tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseRunnerContainmentAcceptance.test.mjs .github/workflows/ci.yml
git commit -m "feat: verify Windows Goose containment evidence"
```

## Task 7: Admit Windows Runtime Only From Exact Evidence

**Files:**

- Modify: `apps/desktop/src/main/workers/gooseRunnerTarget.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerArtifact.ts`
- Modify: `tests/main/gooseRunnerArtifact.test.ts`
- Modify: `tests/main/gooseRunnerTarget.test.ts`
- Modify: `tests/main/gooseRunnerLifecycle.test.ts`

- [ ] **Step 1: Add RED runtime admission tests**

Add tests proving Windows without containment evidence, with false `network` or
`parentDeath`, or with stale `sourceCommit`/`executableSha256` fails before
private-root creation. Add one test proving exact evidence calls the Windows
supervisor transport factory once. Keep a Darwin compatibility assertion.

- [ ] **Step 2: Implement artifact-aware Windows admission**

Keep Windows runtime admission tied to `hasVerifiedGooseContainment()` for the
exact admitted artifact. If the plain target resolver cannot accept the
artifact cleanly, add an artifact-aware wrapper and leave the plain resolver
build-target-only.

- [ ] **Step 3: Integrate Windows supervisor spawn options**

Extend `GooseAcpSpawnOptions` with:

```ts
readonly windows?: Readonly<{
  readonly supervisorMode: "--actestra-windows-supervisor-v1";
  readonly capabilityPipeName: string;
  readonly modelPipeName: string;
  readonly attemptLease: string;
}>;
```

The Windows branch in `createNodeGooseAcpTransport()` must spawn:

```ts
command = options.executablePath;
arguments_ = ["--actestra-windows-supervisor-v1"];
```

It must reject when `windows` is absent, when `networkPolicy` is direct
loopback, or when `executableAuthority !== "windows-supervisor"`.

- [ ] **Step 4: Verify Task 7**

Run:

```bash
bun run test tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/main/gooseRunnerWindowsBridge.test.ts
bun run typecheck
bun run lint
git diff --check
```

- [ ] **Step 5: Commit Task 7**

```bash
git add apps/desktop/src/main/workers/gooseRunnerArtifact.ts apps/desktop/src/main/workers/gooseRunnerTarget.ts apps/desktop/src/main/workers/gooseRunnerProcess.ts tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/main/gooseRunnerWindowsBridge.test.ts
git commit -m "feat: admit Windows Goose runtime from exact containment evidence"
```

## Task 8: Close Exact-Head CI And Record Status Without Overclaiming

**Files:**

- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify:
  `docs/superpowers/plans/2026-08-18-p8-2b-windows-goose-supervisor.md` if
  execution notes are needed

- [ ] **Step 1: Run local complete gate**

Run:

```bash
bun run check
bun run goose:runner:format:check
git diff --check
```

If `bun run check` flakes, rerun the exact failed test once in isolation and
record both the failure and the isolated result. Do not claim full local green
unless the full command exits 0.

- [ ] **Step 2: Push branch and inspect Windows CI**

Run:

```bash
git push origin codex/p8-2b-runtime-containment
gh pr checks 68 --watch
gh run view --log-failed
```

Expected: Windows build probe and Windows containment job both pass on the
exact pushed head. Capture run ID, job ID, target triple, manifest SHA,
executable SHA, probe SHA, and Artifact ID.

- [ ] **Step 3: Update source-of-truth docs**

Update `docs/PROJECT_STATUS.md` with exact evidence only. If Windows native
containment is green, say P8.2b Windows containment is locally and exact-head CI
verified. If merged-main has not run, say P8.2b is not accepted on main yet. If
any Windows primitive remains incomplete, leave P8.2b open and keep runtime
admission disabled.

- [ ] **Step 4: Final verification and commit docs**

Run:

```bash
bun run docs:check
bunx oxfmt --check docs/PROJECT_STATUS.md docs/roadmap/DEVELOPMENT_SEQUENCE.md
git diff --check
```

Commit:

```bash
git add docs/PROJECT_STATUS.md docs/roadmap/DEVELOPMENT_SEQUENCE.md
git commit -m "docs: record Windows Goose containment evidence"
```

## Plan Self-Review

- **Spec coverage:** Tasks 1-3 cover fixed modes, no direct loopback, exact
  control frames, and fail-closed scaffolding. Tasks 4-5 cover AppContainer,
  Job Object, parent liveness, named-pipe Provider, and builtin MCP adapters.
  Tasks 6-7 cover hostile native evidence and artifact-bound runtime admission.
  Task 8 covers exact CI and source-of-truth updates.
- **Scope control:** The plan touches only Goose runner, Main worker
  launch/admission, containment scripts, CI, tests, and status docs. It does
  not change foundation, Renderer, preload, product UI, provider credentials,
  installers, signing, update trust, or clean-machine acceptance.
- **Evidence control:** Windows runtime cannot pass from build output, source
  grep, or skipped tests. It requires exact emitted `.exe` execution, all six
  containment booleans, manifest binding, and exact-head CI.
- **Type consistency:** `windows-supervisor`,
  `GooseRunnerWindowsBridgeEnvironment`, `--actestra-windows-supervisor-v1`,
  `--actestra-windows-worker-v1`, and the pipe frame keys are used consistently
  across tasks.
- **No fallback:** Every unavailable Windows primitive maps to the existing
  fail-closed vocabulary and keeps Windows runtime admission disabled.
