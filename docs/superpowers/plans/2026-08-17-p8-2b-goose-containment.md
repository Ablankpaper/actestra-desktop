# P8.2b Goose Cross-Platform Containment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native, independently evidenced Windows 11 x64 and Ubuntu 24.04
x64 Goose containment while preserving the existing macOS sandbox and
fail-closed runtime admission.

**Architecture:** Main remains the only authority that admits a target,
artifact, workspace, resource profile, and authenticated loopback session. A
small shared launch contract feeds one Actestra-owned Rust Goose runner and
platform-specific containment backends. Windows uses a Job Object plus a
restricted identity and an authenticated local bridge; Linux uses rootless
filesystem, syscall, network, and resource controls plus an inherited local
bridge. A target is admitted only after native hostile probes prove the same
P7 invariants; otherwise the existing `network-policy-unavailable` stop is
retained.

**Tech Stack:** TypeScript/Node 24, Bun/Vitest, Rust 1.96.1, existing Goose
ACP runner, macOS `sandbox-exec`, Windows native process APIs, and Ubuntu 24.04
kernel primitives. No foundation source or new application framework.

---

## Scope and file map

This plan is deliberately limited to the P8.2b Goose containment foundation.
It does not implement General Worker portability, Electron installers,
candidate signing, update metadata, clean-machine acceptance, or a real
provider run. Those are later P8.2/P8.3/P8.4 plans.

### Files to create

- `apps/desktop/src/main/workers/gooseRunnerContainment.ts` — immutable shared
  launch contract and platform-adapter selection.
- `tests/main/gooseRunnerContainment.test.ts` — exact-key, target, path,
  endpoint, budget, and fail-closed contract tests.
- `workers/goose-runner/src/containment/mod.rs` — Rust backend trait and common
  bounded launch/evidence types.
- `workers/goose-runner/src/containment/macos.rs` — regression adapter around
  the current Unix limit and parent-liveness behavior.
- `workers/goose-runner/src/containment/linux.rs` — Ubuntu namespace, Landlock,
  seccomp, cgroup-v2, and IPC bridge setup.
- `workers/goose-runner/src/containment/windows.rs` — Job Object, restricted
  token/AppContainer feasibility adapter, and parent-death cleanup.
- `tests/security/gooseRunnerContainmentProbe.integration.ts` — redacted
  result-shape and native-probe orchestration assertions.
- `scripts/test-goose-runner-containment.mjs` — exact-artifact native probe
  runner that exits nonzero for failed or incomplete evidence.

### Files to modify

- `workers/goose-runner/Cargo.toml` and `Cargo.lock` — only pinned native API
  crates required by the accepted backend; no unreviewed sandbox binary.
- `apps/desktop/src/main/workers/gooseRunnerArtifact.ts` and its fixtures —
  bind the versioned containment record to the manifest and executable digest.
- `workers/goose-runner/src/main.rs` — call the common containment setup before
  starting Goose ACP and preserve the fixed failure marker.
- `apps/desktop/src/main/workers/gooseRunnerProcess.ts` — use the contract and
  platform adapter before private-root staging/transport creation.
- `apps/desktop/src/main/workers/gooseRunnerTarget.ts` — admit runtime targets
  only when the native adapter has a verified capability record.
- `tests/main/gooseRunnerLifecycle.test.ts` and
  `tests/main/gooseRunnerResource.test.ts` — preserve macOS behavior and add
  cross-platform pre-root and resource regressions.
- `tests/scripts/gooseRunnerPortability.test.mjs` — require the new cfg-gated
  backend and no unsandboxed fallback.
- `.github/workflows/ci.yml` — add native feasibility jobs on
  `windows-2025` and `ubuntu-24.04`; keep build-only jobs distinct.
- `scripts/test-goose-runner.mjs` and `package.json` — expose the bounded
  native containment probe command.
- `docs/PROJECT_STATUS.md` and `docs/roadmap/DEVELOPMENT_SEQUENCE.md` — record
  exact evidence and leave the gate open for any target that is incomplete.

No file under `foundation/`, AionUI generated output, Renderer, or preload is
in scope.

## Task 1: Lock the shared containment contract (TDD)

**Files:**

- Create: `tests/main/gooseRunnerContainment.test.ts`
- Create: `apps/desktop/src/main/workers/gooseRunnerContainment.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`

- [ ] **Step 1: Write the failing contract tests.**

Add tests that construct a frozen valid record and assert:

~~~
const valid = Object.freeze({
  platform: "linux",
  architecture: "x64",
  targetTriple: "x86_64-unknown-linux-gnu",
  executablePath: "/owned/attempt/bin/actestra-goose-runner",
  privateRoot: "/owned/attempt",
  workspaceDirectory: "/owned/worktree",
  networkPolicy: "deny-all",
  resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
  parentLiveness: Object.freeze({ kind: "inherited-ipc", token: "a".repeat(32) }),
});
expect(() => assertGooseContainmentLaunch(valid)).not.toThrow();
~~~

The same test must reject a mutable object, unknown field, relative or
symlinked path, workspace outside the admitted grant, non-loopback endpoint,
widened resource profile, missing parent-liveness token, target/artifact
mismatch, and a Windows/Linux record when the capability registry has no
verified native evidence. Assert that the rejection occurs before the transport
factory and before `mkdtemp` are called.

- [ ] **Step 2: Run the focused test and verify RED.**

Run:

~~~
bun run test tests/main/gooseRunnerContainment.test.ts
~~~

Expected result: the import or `assertGooseContainmentLaunch` is missing. Fix
test-only typos until the failure is specifically about the absent contract.

- [ ] **Step 3: Implement the minimal TypeScript contract.**

Export frozen types and functions:

~~~
export type GooseContainmentNetwork =
  | "deny-all"
  | Readonly<{
      kind: "loopback-session";
      capabilityProxyPort: number;
      modelProxyPort: number;
    }>;

export interface GooseContainmentLaunch {
  readonly platform: "darwin" | "win32" | "linux";
  readonly architecture: "arm64" | "x64";
  readonly targetTriple: string;
  readonly executablePath: string;
  readonly privateRoot: string;
  readonly workspaceDirectory?: string;
  readonly networkPolicy: GooseContainmentNetwork;
  readonly resourceBudget: WorkerResourceBudget;
  readonly parentLiveness: Readonly<{ kind: "inherited-ipc"; token: string }>;
}

export interface GooseContainmentEvidence {
  readonly contractVersion: 1;
  readonly targetTriple: string;
  readonly sourceCommit: string;
  readonly probeSha256: string;
  readonly executableSha256: string;
  readonly filesystem: true;
  readonly network: true;
  readonly processTree: true;
  readonly resources: true;
  readonly parentDeath: true;
  readonly cleanup: true;
}

export function assertGooseContainmentLaunch(value: unknown): asserts value is GooseContainmentLaunch;
export function hasVerifiedGooseContainment(
  evidence: GooseContainmentEvidence | undefined,
  artifact: Readonly<{ targetTriple: string; executableSha256: string; sourceCommit: string }>,
): boolean;
~~~

Use the existing canonical-path and fixed-budget helpers. Do not accept an
arbitrary URL, environment value, port list, or caller-selected limit. Do not
use an in-memory capability flag as a trust root. Windows/Linux remain
unverified until the exact Artifact manifest contains a containment record with
the contract version, target triple, source commit, probe implementation
digest, executable digest binding, and all six closed capability booleans.

- [ ] **Step 4: Wire the contract without widening runtime admission.**

Make `openGooseRunnerHandshake()` validate the runtime target and artifact,
then build the contract before `preparePrivateRoot()`. Keep non-Darwin behavior
returning `network-policy-unavailable`. Add a test that proves no private root
or transport is created when validation fails.

- [ ] **Step 5: Run focused tests and commit.**

Run:

~~~
bun run test tests/main/gooseRunnerContainment.test.ts tests/main/gooseRunnerLifecycle.test.ts
bun run format:check
bun run lint
git diff --check
~~~

Commit:

~~~
feat: add Goose containment launch contract
~~~

## Task 2: Factor the Rust runner containment boundary (TDD)

**Files:**

- Create: `workers/goose-runner/src/containment/mod.rs`
- Create: `workers/goose-runner/src/containment/macos.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/Cargo.toml`
- Test: Rust unit tests in `workers/goose-runner/src/containment/mod.rs`

- [ ] **Step 1: Add failing common-backend tests.**

Define a platform-neutral `ContainmentConfig` containing only the fixed
resource limits, canonical private/workspace paths, network mode, and a
parent-liveness handle. Add tests for exact environment parsing, missing
fields, widened limits, path traversal, and evidence serialization that never
contains paths, tokens, or environment values.

- [ ] **Step 2: Run Rust tests to verify RED.**

Run:

~~~
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
~~~

Expected result: missing module/types, not a dependency or compiler failure.

- [ ] **Step 3: Extract macOS behavior unchanged.**

Move the existing Unix `RLIMIT_CPU`, address-space baseline, and
parent-liveness functions behind `containment::macos`/`cfg(unix)` without
changing the fixed marker `ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED`. Keep
equal soft and hard limits, overflow checks, process-group ownership, and
SIGTERM cleanup. Keep `main()` calling `containment::prepare()` before
constructing the Tokio runtime or starting `goose::acp::server::run`.

- [ ] **Step 4: Verify macOS regression and commit.**

Run:

~~~
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
~~~

Commit:

~~~
refactor: isolate Goose containment backend boundary
~~~

## Task 3: Build the Ubuntu native feasibility backend

**Files:**

- Create/modify: `workers/goose-runner/src/containment/linux.rs`
- Modify: `workers/goose-runner/src/containment/mod.rs`
- Create: `scripts/goose-containment-probe-linux.mjs`
- Create: `tests/security/gooseRunnerContainmentProbe.integration.ts`

- [ ] **Step 1: Add Linux RED tests and probe contract.**

The Rust tests must require `current_virtual_size_bytes()` from
`/proc/self/statm`, reject malformed/overflowing values, and require a native
setup result with all of `filesystem`, `network`, `processTree`,
`resources`, `parentDeath`, and `cleanup` booleans. The TypeScript test
must reject a result containing raw paths, environment values, tokens, prompt
text, or unknown keys.

Run the focused tests and confirm they fail because the Linux adapter and probe
are absent.

- [ ] **Step 2: Implement rootless filesystem rules.**

Before ACP starts, create a private mount/user namespace without setuid or
root. Apply Landlock rules allowing only the canonical private root and
admitted workspace (read-only where the existing workspace grant requires it),
and deny symlink traversal outside those roots. If the kernel ABI or ruleset is
unavailable, emit the fixed bounded setup marker and exit nonzero.

- [ ] **Step 3: Implement process, network, and resource rules.**

Install a syscall policy that denies privilege escalation and arbitrary
process creation. Use cgroup v2 or an equivalent unprivileged controller for
the exact CPU, memory, process-count, and cleanup profile. Use an isolated
network namespace with no external interface. Expose only a local TCP endpoint
inside the namespace backed by an inherited Unix socket to Main; the bridge
must forward only the existing authenticated MCP/model protocol.

Do not use host networking, Docker, a root daemon, setuid helpers, or a broad
firewall exemption. Any unavailable primitive is a setup failure, not a
permissive fallback.

- [ ] **Step 4: Add hostile native probes.**

The probe must attempt external DNS/TCP, an unrelated localhost port, a host
file read, an outside-root write, a symlink escape, fork/exec, resource
widening, parent termination, and duplicate cleanup. It must assert denial or
bounded terminalization and emit only the closed metadata result.

- [ ] **Step 5: Run on Ubuntu CI and commit only if evidence is complete.**

Run locally where supported:

~~~
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
bun run test tests/security/gooseRunnerContainmentProbe.integration.ts
~~~

The Ubuntu job must run the emitted exact artifact, not a source fixture. A
missing kernel capability produces a nonzero job and leaves runtime admission
unchanged. Commit:

~~~
feat: add Ubuntu Goose containment probe
~~~

## Task 4: Build the Windows native feasibility backend

**Files:**

- Create/modify: `workers/goose-runner/src/containment/windows.rs`
- Modify: `workers/goose-runner/Cargo.toml` and `Cargo.lock`
- Create: `scripts/goose-containment-probe-windows.mjs`
- Modify: `tests/scripts/gooseRunnerPortability.test.mjs`

- [ ] **Step 1: Add Windows RED tests.**

Under `cfg(windows)`, require a Job Object with kill-on-job-close, active
process limit, fixed CPU/memory limits, and descendant accounting. Require a
restricted token/AppContainer setup that grants only the private root and
admitted workspace. Require a per-attempt named-pipe bridge; reject a blanket
loopback exemption. Keep the existing test that Windows resource enforcement is
unavailable until this backend is actually complete.

- [ ] **Step 2: Add the pinned Windows API dependency.**

Use the already locked `windows-sys` `0.61.2` APIs (or a reviewed exact newer
pin only if the lock requires it) for Job Object, process-token, security
capability, named-pipe, and process-creation calls. Run Cargo's resolver and
audit tools; do not hand-edit `Cargo.lock` or add a downloaded sandbox binary.

- [ ] **Step 3: Implement the native setup and parent-death path.**

Create the Job Object before the Goose process, set kill-on-job-close and the
fixed limits, launch with the restricted identity, attach the process before
exposing ACP, and close the job on Main disconnect. Use a named pipe for the
Main bridge and authenticate it with the existing opaque attempt lease. If
AppContainer/ACL or bridge setup cannot be narrowed to the admitted roots and
pipe, return the fixed setup marker and exit nonzero.

- [ ] **Step 4: Add hostile native probes and run on Windows CI.**

Attempt external network, unrelated loopback, profile reads, outside-root
writes, symlink traversal, child process creation, resource widening, parent
death, and duplicate cleanup. Require exact redacted metadata and no orphaned
processes. The job must use the exact `.exe` artifact admitted by the existing
manifest checker.

- [ ] **Step 5: Commit only after native evidence.**

Run:

~~~
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
bun run test tests/scripts/gooseRunnerPortability.test.mjs
~~~

Commit:

~~~
feat: add Windows Goose containment probe
~~~

## Task 5: Bind probe evidence and integrate verified backends into Main and ACP

**Files:**

- Modify: `apps/desktop/src/main/workers/gooseRunnerTarget.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerArtifact.ts`
- Modify: `tests/main/gooseRunnerArtifact.test.ts`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `tests/main/gooseRunnerLifecycle.test.ts`
- Modify: `tests/main/gooseRunnerResource.test.ts`

- [ ] **Step 1: Add failing manifest/evidence tests.**

Extend the exact manifest contract with a versioned `containment` record whose
keys are exactly `contractVersion`, `targetTriple`, `sourceCommit`,
`probeSha256`, `executableSha256`, `filesystem`, `network`, `processTree`,
`resources`, `parentDeath`, and `cleanup`. Require all six booleans to be true
for non-Darwin runtime admission, bind the target/source/executable values to
the admitted artifact, and reject unknown keys, stale source commits, probe
digest drift, or any false capability. Preserve the existing P8.2a Darwin
compatibility path until a rebuilt Darwin artifact carries the new record.

- [ ] **Step 2: Add failing integration tests for each verified target.**

Parameterize the existing lifecycle fixture by target triple and assert that a
verified target performs an ACP initialize/open-session over the authenticated
bridge, while an unverified or mismatched digest fails before private-root
creation. Assert that no transport factory is called on failure.

- [ ] **Step 3: Admit only exact probe evidence.**

Bind the manifest containment record to the exact source commit, target triple,
executable digest, probe implementation digest, and containment contract
version. Return the evidence as part of `AdmittedGooseRunnerArtifact`, then
pass that record into the runtime-admission predicate. Update
`resolveGooseRunnerRuntimeTarget()` (or its artifact-aware wrapper) to return
Windows/Linux only when all six containment booleans are true for that exact
artifact. Do not infer capability from the host OS or build target alone.

- [ ] **Step 4: Integrate the platform transport.**

Replace the unconditional `/usr/bin/sandbox-exec` branch with the selected
adapter while retaining the existing `GooseAcpTransport` frame limits,
resource-failure matcher, handshake timeout, process-tree close, and private
root cleanup. Preserve macOS launch arguments byte-for-byte where no shared
contract change is required.

- [ ] **Step 5: Verify real ACP and terminal paths.**

Run the exact runner artifact with the deterministic authenticated loopback
provider, then exercise tool denial, cancellation, crash/restart, parent death,
resource failure, and cleanup. Assert durable failure codes do not drift to
completed or unchanged.

- [ ] **Step 6: Commit.**

~~~
feat: admit verified Goose containment runtimes
~~~

## Task 6: Native CI, local gates, and source-of-truth update

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/test-goose-runner.mjs`
- Modify: `package.json`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Test: `tests/scripts/p8NativeBuildWiring.test.mjs`

- [ ] **Step 1: Add separate feasibility/runtime jobs.**

Keep the existing build-only Windows/Linux jobs. Add target-native jobs that
install no credentials, run the exact emitted artifact and probe, upload only
bounded metadata, and fail on `unsupported-platform`,
`evidence-incomplete`, skip, neutral, or missing evidence. The macOS job must
run the unchanged regression and packaged smoke path.

- [ ] **Step 2: Run local checks.**

On macOS run:

~~~
bun run test tests/main/gooseRunnerContainment.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/main/gooseRunnerResource.test.ts
bun run goose:runner:format:check
bun run typecheck
bun run lint
bun run docs:check
bun run boundary:check
bun run foundation:aionui:check
bun run downstream:aionui:check
git diff --check
~~~

Record Windows/Linux results only from native CI, never from cross-compilation
or a macOS simulation.

- [ ] **Step 3: Run the complete gate and inspect exact evidence.**

Run `bun run check`, verify `foundation/` is byte-identical, inspect each
native job's source SHA, artifact digest, target identity, primitive results,
and cleanup evidence, then open a PR. Do not call P8.2b accepted until the
exact-head PR and independent merged-main CI both pass.

- [ ] **Step 4: Update status without overclaiming.**

Record the exact PR, merge, CI run IDs, target/artifact digests, and any
remaining fail-closed target. If either platform is incomplete, state that
P8.2b and overall P8.2 remain open and leave the resolver refusal in place.

## Plan self-review

- **Spec coverage:** Tasks 1–2 cover the shared contract and preserved macOS
  authority; Tasks 3–4 cover native Linux/Windows feasibility; Task 5 covers
  exact-artifact runtime admission; Task 6 covers CI and evidence. Packaging,
  candidate, and clean-machine work remains outside this plan as required.
- **Authority consistency:** Main remains the admission authority; the Rust
  runner is the only worker; no Renderer, second policy engine, or unsandboxed
  fallback is introduced.
- **Evidence consistency:** Unit tests cannot advance a platform without a
  native hostile probe and exact artifact binding. Build-only jobs remain
  distinct from runtime jobs.
- **Placeholder scan:** No task depends on a vague “handle errors later” step;
  every failure path names the existing closed code and expected command.
- **Type consistency:** The `GooseContainmentLaunch` fields, Rust
  `ContainmentConfig`, probe result keys, and target resolver evidence binding
  use the same semantic fields and target triples throughout.
