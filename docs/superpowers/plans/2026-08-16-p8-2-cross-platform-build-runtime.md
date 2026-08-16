# P8.2a Cross-Platform Goose Build Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (- [ ]) syntax for tracking.

**Goal:** Build and independently admit the pinned Goose runner on the exact
P8 host families while keeping Windows and Linux runtime launch fail-closed
until their containment mechanisms have separate native evidence and an
accepted ADR.

**Architecture:** Extend the existing shared Goose source contract with one
closed host-to-target table and exact Windows/Linux build-tool assets. Reuse
that table from build scripts, artifact admission, and Main runtime target
checks so build support cannot be mistaken for runtime containment. Make the
minimal Rust wrapper compile on all three native hosts, but retain an explicit
network-policy-unavailable result outside the accepted macOS sandbox-exec
runtime. Add Windows and Ubuntu jobs that prove native tool installation,
compilation, audit, manifest admission, and the deliberate runtime stop.

**Tech Stack:** Node.js 24 ESM, Bun 1.3.9, TypeScript 5.9, Vitest 4.1,
Rust 1.96.1, cargo-auditable 0.7.4, cargo-audit 0.22.2, GitHub-hosted
macos-15, windows-2025, and ubuntu-24.04 runners, and the existing Actestra
downstream overlay.

---

## Scope and non-claims

This is the first independently testable slice of P8.2. It proves native build
and artifact admission only. It does not claim:

- Windows or Linux Goose runtime containment;
- an Electron DMG, ZIP, NSIS, or DEB package;
- General, Goose, Team, approval, recovery, privacy, or P7 journey evidence;
- candidate integrity, formal signing, notarization, release, deployment,
  distribution, clean-machine acceptance, or real-provider acceptance.

foundation/ remains byte-identical. AionUI, Main/Core, Tool Gateway, Renderer,
provider, persistence, and approval authority do not change in this slice.

## File map

### New files

- apps/desktop/src/main/workers/gooseRunnerTarget.ts: closed host/target
  resolver and build-versus-runtime distinction.
- tests/main/gooseRunnerTarget.test.ts: target, duplicate, executable,
  unsupported-host, and runtime-ceiling regressions.
- scripts/admit-goose-runner-build.ts: admission of the native artifact emitted
  on the current host, with bounded metadata output.
- tests/scripts/p8NativeBuildWiring.test.mjs: package and CI wiring contract.
- docs/superpowers/plans/2026-08-16-p8-2-cross-platform-build-runtime.md:
  this plan.

### Existing files to modify

- apps/desktop/src/shared/gooseRunnerSource.json
- apps/desktop/src/main/workers/gooseRunnerArtifact.ts
- apps/desktop/src/main/workers/gooseRunnerProcess.ts
- scripts/install-goose-runner-tools.mjs
- scripts/build-goose-runner.mjs
- workers/goose-runner/src/main.rs
- tests/main/gooseRunnerArtifact.test.ts
- tests/main/gooseRunnerLifecycle.test.ts
- package.json
- .github/workflows/ci.yml
- downstream/aionui-v2.1.41/overlay.json
- scripts/check-aionui-downstream.mjs
- docs/PROJECT_STATUS.md
- docs/roadmap/DEVELOPMENT_SEQUENCE.md

---

### Task 1: Add the closed host and build-target contract

**Files:**

- Create: tests/main/gooseRunnerTarget.test.ts
- Create: apps/desktop/src/main/workers/gooseRunnerTarget.ts
- Modify: apps/desktop/src/shared/gooseRunnerSource.json

- [ ] **Step 1: Write the failing exact-target test**

The test defines these records and requires an immutable one-to-one host and
target-triple mapping:

~~~ts
const expected = [
  ["darwin", "arm64", "aarch64-apple-darwin", "darwin-arm64", "actestra-goose-runner"],
  ["darwin", "x64", "x86_64-apple-darwin", "darwin-x64", "actestra-goose-runner"],
  ["win32", "x64", "x86_64-pc-windows-msvc", "win32-x64", "actestra-goose-runner.exe"],
  ["linux", "x64", "x86_64-unknown-linux-gnu", "linux-x64", "actestra-goose-runner"],
].map(([platform, architecture, targetTriple, buildToolHost, executableFile]) => ({
  platform,
  architecture,
  targetTriple,
  buildToolHost,
  executableFile,
}));
~~~

It requires exact resolution by host and triple, rejects Windows arm64, Linux
arm64, Linux musl, FreeBSD, missing fields, unknown fields, and duplicate
identities. It separately requires runtime resolution to return only the two
Darwin records.

- [ ] **Step 2: Verify RED**

Run: bun run test tests/main/gooseRunnerTarget.test.ts

Expected: FAIL because gooseRunnerTarget.ts does not exist.

- [ ] **Step 3: Add buildTargets to the shared JSON**

Add the five exact fields from Step 1 for all four records. Do not add
Windows arm64, Linux arm64, or a second Linux ABI.

- [ ] **Step 4: Implement the resolver**

The module validates exact keys and non-empty strings, freezes each record and
the collection, rejects duplicate host pairs and triples during module load,
and exports:

~~~ts
resolveGooseRunnerBuildTarget(platform: string, architecture: string)
resolveGooseRunnerBuildTargetByTriple(targetTriple: string)
resolveGooseRunnerRuntimeTarget(platform: string, architecture: string)
~~~

The last function returns a record only when platform is darwin. That explicit
ceiling prevents native build support from granting runtime authority.

- [ ] **Step 5: Verify GREEN and commit**

Run the focused test, formatter, zero-warning lint, and git diff --check.
Commit only the JSON, resolver, and test as:

~~~text
feat: define Goose native build targets
~~~

---

### Task 2: Add exact Windows and Linux audit-tool assets

**Files:**

- Modify: apps/desktop/src/shared/gooseRunnerSource.json
- Modify: scripts/install-goose-runner-tools.mjs
- Modify: scripts/build-goose-runner.mjs
- Modify: tests/main/gooseRunnerTarget.test.ts

- [ ] **Step 1: Add failing asset assertions**

Require the exact archive evidence:

| Host | Tool | Asset ID | Archive | Bytes | SHA-256 |
| --- | --- | ---: | --- | ---: | --- |
| win32-x64 | cargo-auditable | 366985543 | cargo-auditable-x86_64-pc-windows-msvc.zip | 485072 | e2da8d873978982381269c27be8b76cfd4084fbf99c43bd83231ac9c714488bb |
| win32-x64 | cargo-audit | 439294720 | cargo-audit-x86_64-pc-windows-msvc-v0.22.2.zip | 6192256 | 0a7316540862c13d954f648917ceacca593747baed6eec180fafa590be2710ab |
| linux-x64 | cargo-auditable | 366985552 | cargo-auditable-x86_64-unknown-linux-gnu.tar.xz | 458196 | fbc6c3779f2f4040578f76e8a77a73ab6d31187e3ef1558ced00dc81d2a0f080 |
| linux-x64 | cargo-audit | 439291614 | cargo-audit-x86_64-unknown-linux-gnu-v0.22.2.tgz | 6554209 | ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39 |

Also require the existing versions/commits, public GitHub repository, HTTPS
release URL, expected version output, and .exe executable name on Windows.

- [ ] **Step 2: Verify RED and add the asset records**

Run the target test and observe missing win32-x64 and linux-x64. Add those
records without changing the existing Darwin digests.

- [ ] **Step 3: Refactor the installer**

Delete the hard-coded toolAssets table. Resolve the current record from
sourceContract.buildTargets and select buildToolAssets by buildToolHost.
Download through the existing authorized gh path or a bounded fetch with a
180-second timeout and 20 MiB maximum. Reject non-success responses, archive
size drift, and SHA drift. Extract through tar.exe on Windows and tar on
Unix. Find and install the exact declared executable file; skip chmod only on
Windows. Keep tools.json at contract version 1 and metadata-only.

- [ ] **Step 4: Make the build script platform-safe**

Require rustc host to equal the shared target triple. Resolve .exe names from
the target contract. Replace the hard-coded colon in PATH with path.delimiter.
Preserve all audit, all-target dependency, SBOM, license, digest, and dirty-CI
checks.

- [ ] **Step 5: Verify unchanged Darwin behavior**

Run:

~~~text
bun run test tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerArtifact.test.ts
bun run goose:runner:tools
ACTESTRA_GOOSE_AUDIT_NO_FETCH=1 bun run goose:runner:build
~~~

Expected: current Darwin archive evidence and target triple remain unchanged.
Windows/Linux evidence is deferred to their native jobs, not inferred locally.

- [ ] **Step 6: Format, lint, diff-check, and commit**

Commit as:

~~~text
build: admit Windows and Linux Goose tool assets
~~~

---

### Task 3: Make the minimal Rust wrapper native-build portable

**Files:**

- Modify: workers/goose-runner/src/main.rs
- Test: inline Rust unit tests in the same file

- [ ] **Step 1: Add platform-gated tests first**

Add:

~~~rust
#[cfg(target_os = "linux")]
#[test]
fn reads_a_real_linux_virtual_size_baseline() {
    assert!(current_virtual_size_bytes().unwrap() > 0);
}

#[cfg(target_os = "windows")]
#[test]
fn keeps_windows_native_resource_enforcement_unavailable() {
    assert!(apply_resource_limits().is_err());
}
~~~

Move kernel rlimit tests under cfg(unix). The existing macOS child-process
test remains unchanged.

- [ ] **Step 2: Gate Unix-only imports and process groups**

Use cfg(unix) for FromRawFd, rlimit, setrlimit, signals, and process-group
parent liveness. Add a Windows parent-liveness function with no side effect;
the Windows binary cannot reach a successful Goose session because native
resource/containment admission remains unavailable first.

- [ ] **Step 3: Implement Linux address-space baseline**

Read the first decimal field from /proc/self/statm, read page size with
sysconf(_SC_PAGESIZE), reject zero, negative, malformed, and overflow values,
then return pages multiplied by page size. Do not substitute RSS; the accepted
budget is address-space growth.

- [ ] **Step 4: Keep Windows setup fail-closed**

Compile the fixed environment parser, but make Windows
apply_resource_limits return Err. Direct execution therefore prints only the
existing fixed setup-failure marker and exits nonzero until the later Windows
containment slice supplies a real implementation.

- [ ] **Step 5: Verify local macOS**

Run cargo fmt --check, cargo test --locked --release, and cargo check. Native
Linux/Windows test results are claimed only after their CI jobs run.

- [ ] **Step 6: Commit**

Commit as:

~~~text
build: make Goose wrapper source host portable
~~~

---

### Task 4: Extend artifact admission without widening runtime launch

**Files:**

- Modify: apps/desktop/src/main/workers/gooseRunnerArtifact.ts
- Modify: apps/desktop/src/main/workers/gooseRunnerProcess.ts
- Modify: tests/main/gooseRunnerArtifact.test.ts
- Modify: tests/main/gooseRunnerLifecycle.test.ts

- [ ] **Step 1: Write failing artifact tests**

Parameterize the existing full artifact fixture by target triple and executable
file. Add successful admission for x86_64-pc-windows-msvc with an .exe and
x86_64-unknown-linux-gnu without one. Add rejection for executable suffix
substitution, tool-host substitution, and unknown triples. Retain every
existing manifest, SBOM, audit, license, lock, symlink, digest, and exact-key
check.

- [ ] **Step 2: Verify RED**

Run: bun run test tests/main/gooseRunnerArtifact.test.ts

Expected: Windows/Linux cases fail because admission recognizes Darwin only.

- [ ] **Step 3: Derive admission from the shared resolver**

Remove BUILD_TOOL_HOST_BY_TARGET and the broad executable-basename set. Resolve
the manifest triple through resolveGooseRunnerBuildTargetByTriple, require its
exact buildToolHost and executableFile, and reject unknown triples. Preserve
caller-owned expectedTargetTriple equality and the external manifest digest.

- [ ] **Step 4: Prove the runtime ceiling behavior**

Add a lifecycle test for this exact chain:

~~~text
matching Windows or Linux build artifact
→ network-policy-unavailable
→ transport factory not called
→ no attempt-private directory created
~~~

Move the resolveGooseRunnerRuntimeTarget check before preparePrivateRoot. Use a
platform-neutral sanitized error saying the current host lacks admitted Goose
containment.

- [ ] **Step 5: Verify GREEN**

Run target, artifact, and lifecycle tests plus root typecheck. Format, lint,
diff-check, and commit as:

~~~text
feat: admit native Goose build artifacts
~~~

---

### Task 5: Add real emitted-artifact admission

**Files:**

- Create: scripts/admit-goose-runner-build.ts
- Create: tests/scripts/p8NativeBuildWiring.test.mjs
- Modify: package.json

- [ ] **Step 1: Write failing command-wiring assertions**

Require this exact package command:

~~~json
"goose:runner:admit-build": "bun scripts/admit-goose-runner-build.ts"
~~~

The test also requires imports of admitGooseRunnerArtifact and the build-target
resolver, and rejects imports of the runtime launcher.

- [ ] **Step 2: Implement the verifier**

The script resolves the current target, rejects unsupported hosts, resolves the
artifact beneath .actestra/goose-runner, verifies the manifest is a bounded
regular non-symlink, independently computes its SHA-256, invokes production
artifact admission, and prints only targetTriple, manifestSha256,
executableSha256, and executableSize. It prints no absolute path, environment
value, user name, provider, credential, prompt, source, or advisory content.

- [ ] **Step 3: Verify against the current Darwin artifact**

Run:

~~~text
bun run goose:runner:admit-build
bun run test tests/scripts/p8NativeBuildWiring.test.mjs
~~~

Expected: zero exit with the exact current Darwin triple. This is not an ACP
handshake.

- [ ] **Step 4: Format, lint, diff-check, and commit**

Commit as:

~~~text
build: verify emitted Goose artifacts
~~~

---

### Task 6: Materialize the target boundary into AionUI

**Files:**

- Modify: downstream/aionui-v2.1.41/overlay.json
- Modify: scripts/check-aionui-downstream.mjs
- Modify: tests/scripts/p8NativeBuildWiring.test.mjs

- [ ] **Step 1: Add a failing source-copy assertion**

Require:

~~~text
apps/desktop/src/main/workers/gooseRunnerTarget.ts
→ packages/desktop/src/actestra/main/workers/gooseRunnerTarget.ts
~~~

Require the destination in expectedChangedFiles and require the materialized
artifact/process files to import ./gooseRunnerTarget.

- [ ] **Step 2: Register the byte-identical copy**

Add the source copy, expected changed file, and downstream checker entries. Do
not create a UI patch and do not modify foundation/.

- [ ] **Step 3: Verify**

Run the focused wiring test, downstream:aionui:check, clean materialization,
and materialized TypeScript. Expected: exact source-copy equality and no
changed-file drift.

- [ ] **Step 4: Commit**

Commit as:

~~~text
build: materialize Goose target admission
~~~

---

### Task 7: Add target-native CI build probes

**Files:**

- Modify: .github/workflows/ci.yml
- Modify: tests/scripts/p8NativeBuildWiring.test.mjs

- [ ] **Step 1: Write failing workflow assertions**

Require:

- P8.2 Windows x64 Goose build probe on windows-2025.
- P8.2 Ubuntu x64 Goose build probe on ubuntu-24.04.

Each job uses the same pinned checkout, Node, Bun, and Rust setup; frozen root
install; Rust formatting; exact tool install; runner build; Cargo.lock diff;
focused target/artifact/lifecycle/wiring tests; and emitted-artifact admission.
Neither job may run goose:runner:test, Electron packaging, packaged journeys,
artifact upload, signing, publishing, or release commands. Existing required
job names Goose runner admission and macOS arm64 foundation remain unchanged.

- [ ] **Step 2: Verify RED**

Run the wiring test and observe both jobs are absent.

- [ ] **Step 3: Add the two native jobs**

Use a 35-minute timeout and this ordered command surface:

~~~yaml
- run: bun install --frozen-lockfile
- run: bun run goose:runner:format:check
- run: bun run goose:runner:tools
- run: bun run goose:runner:build
- run: git diff --exit-code -- workers/goose-runner/Cargo.lock
- run: bun run test tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/scripts/p8NativeBuildWiring.test.mjs
- run: bun run goose:runner:admit-build
~~~

Do not use no-fetch audit mode in CI and do not upload these probe artifacts.

- [ ] **Step 4: Verify local workflow contracts**

Run p8NativeBuildWiring, p7CiWiring, and p8:contract:check. Format, lint,
diff-check, and commit as:

~~~text
ci: probe native Goose build admission
~~~

---

### Task 8: Run the local gate and record only local evidence

**Files:**

- Modify after literal evidence exists: docs/PROJECT_STATUS.md
- Modify after literal evidence exists: docs/roadmap/DEVELOPMENT_SEQUENCE.md

- [ ] **Step 1: Run focused checks**

Run the three Main target/artifact/lifecycle files, the two CI-wiring files,
Rust release tests, emitted-artifact admission, and downstream:aionui:check.
Record literal file/test counts and exits. Do not report Windows/Linux results
from the macOS run.

- [ ] **Step 2: Run broad checks**

Run bun run check, bun run docs:check, git diff --check, and confirm no
foundation/ change.

- [ ] **Step 3: Add factual local status**

Record branch, exact baseline, literal local outputs, and the newly declared
native jobs. State explicitly:

~~~text
Windows/Linux commands have not yet run until exact-head CI executes them.
P8.2 runtime, packaging, product journeys, containment, and P7 platform
obligations remain open. P8.3 and P8.4 are unchanged.
~~~

Mark only P8.2a as locally ready for CI. Do not mark P8.2 complete.

- [ ] **Step 4: Verify and commit documentation**

Run P8 documentation and wiring tests plus docs:check. Commit as:

~~~text
docs: record P8 native build probe gate
~~~

---

### Task 9: Obtain exact native evidence and close only P8.2a

**Files:**

- Modify after remote evidence: docs/PROJECT_STATUS.md
- Modify after remote evidence: docs/roadmap/DEVELOPMENT_SEQUENCE.md

- [ ] **Step 1: Push and open a governed PR**

Push codex/p8-2-cross-platform-runtime. The PR separates local macOS evidence,
target-native build probes, and the Windows/Linux runtime non-claim.

- [ ] **Step 2: Verify exact-head CI**

All four jobs must belong to the PR exact head SHA and be success. Inspect the
Windows/Linux logs for Rust host triple, archive verification, executable name,
audit result, manifest target, and artifact-admission JSON. Skipped, neutral,
cancelled, and earlier-SHA jobs do not pass.

- [ ] **Step 3: Repair only observed native failures through TDD**

For each failure, first add a regression reproducing the same reason, then make
the minimal correction, rerun focused and complete local gates, and push a new
SHA. Do not add containment or Electron package work to repair a build issue.

- [ ] **Step 4: Merge and verify merged-main CI**

Use governed squash merge only after exact-head green. Verify independent
merged-main CI on the merge commit. Do not create a release or deployment.

- [ ] **Step 5: Record closure through a documentation-only PR**

Record exact PR, source head, job/run IDs, merge commit, and merged-main run.
State that P8.2a native build/artifact admission is accepted while containment,
packages, product journeys, and P7 platform obligations remain open. Re-run
documentation, complete root, and diff gates and deliver through governance.

- [ ] **Step 6: Begin the separate P8.2b containment design gate**

Compare and natively test Windows AppContainer plus Job Object and Linux
namespace/seccomp/resource options, including the Main-owned loopback MCP/model
transport. No mechanism is called enforced until hostile native tests prove
arbitrary external network, host filesystem, fork/exec, resource widening,
parent-death orphaning, and cleanup all fail safely. Only then may a separate
ADR become Accepted.

---

## Plan self-review

- **Spec coverage:** Covers native target resolution, exact tool assets, native
  build, artifact admission, and native CI evidence. Packaging, containment,
  journeys, and P7 platform obligations remain separate P8.2 plans.
- **Authority consistency:** Build admission never grants runtime authority.
  Windows/Linux fail before attempt-root staging. Renderer, provider, Tool
  Gateway, persistence, approval, and foundation/ remain unchanged.
- **Type consistency:** JSON, TypeScript, scripts, artifact admission, tests,
  and CI use the same five target fields and exact triples.
- **Evidence consistency:** Local macOS, exact-head native CI, merged-main CI,
  packaging, candidate, release, and user acceptance remain separate.
- **Placeholder scan:** No hidden implementation gap is represented as
  success. Unimplemented containment is an explicit non-claim and next design
  gate.
