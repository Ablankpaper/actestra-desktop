# P8.2b Ubuntu AppArmor User-Namespace Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the exact root-owned Goose runner installed by the Actestra Ubuntu DEB to create its existing rootless user namespace under Ubuntu 24.04 AppArmor restriction, without admitting any unpacked or user-writable Linux runner.

**Architecture:** Electron-builder's existing DEB lifecycle installs one checked-in AppArmor profile with fixed Actestra and Goose executable paths. A generated sibling admission record binds that profile to the exact six-file Goose Artifact. Main verifies the root-owned package and runs a bounded bootstrap probe before any attempt root is created; the runner repeats the same identity check immediately before `unshare(CLONE_NEWUSER)`. Darwin retains its current attempt-private executable staging.

**Tech Stack:** TypeScript, Bun, Vitest, Node filesystem/process APIs, Rust 1.96.1, libc, Electron-builder 26.15.2, AppArmor, GitHub Actions Ubuntu 24.04.

---

## File Map

- Create `apps/desktop/src/shared/gooseRunnerLinuxPackage.ts` for fixed paths and exact admission-record parsing.
- Create `apps/desktop/src/main/workers/gooseRunnerLinuxPackage.ts` for Main-only ownership, canonical-path, digest, Artifact, and bootstrap admission.
- Modify `actestraCodingJourneyRuntime.ts` to select package admission only on Linux.
- Modify `gooseRunnerTarget.ts`, `gooseRunnerContainment.ts`, and `gooseRunnerProcess.ts` to model a stable Linux package executable separately from a Darwin attempt-private executable.
- Create `workers/goose-runner/src/linux_bootstrap.rs` and wire it into normal Linux startup immediately before namespace creation.
- Create `apps/desktop/resources/linux/actestra-apparmor-profile` with two exact executable profiles.
- Create `scripts/stage-aionui-linux-goose-package.ts` and `scripts/inspect-aionui-linux-deb.mjs` for package staging and bounded package inspection.
- Create downstream patch `0021-actestra-ubuntu-apparmor-bootstrap.mjs`; update `overlay.json` without editing `foundation/`.
- Modify the Ubuntu containment job to simulate installation with `sudo`, then run Goose as the ordinary GitHub user.
- Update `docs/PROJECT_STATUS.md` only after exact-head native CI evidence exists.

## Baseline Note

Before implementation, `bun run check` reached 1,653 passed / 10 skipped and had one parallel-only failure in `tests/scripts/p7PackagedTrust.test.mjs`: “packaged P7 hook marker is missing.” The same file passed 10/10 in isolation. Do not alter that unrelated fixture in this slice unless it later fails reproducibly in isolation.

### Task 1: Define the fixed Linux package contract

**Files:**
- Create: `apps/desktop/src/shared/gooseRunnerLinuxPackage.ts`
- Create: `apps/desktop/resources/linux/actestra-apparmor-profile`
- Create: `tests/main/gooseRunnerLinuxPackageContract.test.ts`

- [ ] **Step 1: Write the failing exact-contract test**

```ts
it("accepts only the seven-key Ubuntu package record", () => {
  const valid = {
    contractVersion: 1,
    targetTriple: "x86_64-unknown-linux-gnu",
    runnerManifestSha256: "a".repeat(64),
    executableSha256: "b".repeat(64),
    profileSha256: "c".repeat(64),
    profileName: "Actestra-Goose-Runner",
    executablePath:
      "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
  };
  expect(parseGooseRunnerLinuxPackageAdmission(valid)).toEqual(Object.freeze(valid));
  expect(parseGooseRunnerLinuxPackageAdmission({ ...valid, unexpected: true })).toBeNull();
  expect(parseGooseRunnerLinuxPackageAdmission({ ...valid, executablePath: "/tmp/runner" })).toBeNull();
});
```

- [ ] **Step 2: Verify RED**

Run: `bun run test tests/main/gooseRunnerLinuxPackageContract.test.ts`

Expected: FAIL because the shared contract module does not exist.

- [ ] **Step 3: Implement the minimal pure contract**

```ts
export const GOOSE_LINUX_INSTALL_ROOT = "/opt/Actestra" as const;
export const GOOSE_LINUX_RESOURCES_PATH = "/opt/Actestra/resources" as const;
export const GOOSE_LINUX_ARTIFACT_DIRECTORY =
  "/opt/Actestra/resources/actestra-goose-runner" as const;
export const GOOSE_LINUX_EXECUTABLE_PATH =
  "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner" as const;
export const GOOSE_LINUX_ADMISSION_RECORD_FILE =
  "actestra-goose-runner-admission.json" as const;
export const GOOSE_LINUX_PROFILE_NAME = "Actestra-Goose-Runner" as const;
export const GOOSE_LINUX_TARGET_TRIPLE = "x86_64-unknown-linux-gnu" as const;
```

The parser must enumerate own data properties, require exactly the seven declared keys, bound strings, validate three lowercase SHA-256 values, and return a frozen copy.

- [ ] **Step 4: Add the exact profile source**

```text
abi <abi/4.0>,
include <tunables/global>

profile "Actestra" "/opt/Actestra/Actestra" flags=(unconfined) {
  userns,
}

profile "Actestra-Goose-Runner" "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner" flags=(unconfined) {
  userns,
}
```

The test must reject wildcard paths, `goose-attempt-*`, `capability`, `network`, `mount`, shell paths, home paths, and any extra include beyond `tunables/global`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `bun run test tests/main/gooseRunnerLinuxPackageContract.test.ts && bun run format:check`

Commit:

```bash
git add apps/desktop/src/shared/gooseRunnerLinuxPackage.ts \
  apps/desktop/resources/linux/actestra-apparmor-profile \
  tests/main/gooseRunnerLinuxPackageContract.test.ts
git commit -m "feat: define Linux Goose package contract"
```

### Task 2: Stage package resources through the downstream overlay

**Files:**
- Create: `scripts/stage-aionui-linux-goose-package.ts`
- Create: `tests/scripts/stageAionuiLinuxGoosePackage.test.mjs`
- Create: `downstream/aionui-v2.1.41/patches/0021-actestra-ubuntu-apparmor-bootstrap.mjs`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `scripts/check-aionui-downstream.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing staging tests**

```js
it("stages exactly six Artifact files plus one sibling record", async () => {
  const result = await stageAionuiLinuxGoosePackage({
    materializedRoot,
    artifactDirectory,
    trustedManifestSha256,
  });
  expect(result.files).toEqual([
    "actestra-goose-runner/actestra-goose-runner",
    "actestra-goose-runner/actestra-goose-runner.manifest.json",
    "actestra-goose-runner/actestra-goose-runner.cdx.json",
    "actestra-goose-runner/actestra-goose-runner.audit.json",
    "actestra-goose-runner/Cargo.lock",
    "actestra-goose-runner/GOOSE-APACHE-2.0.txt",
    "actestra-goose-runner-admission.json",
  ]);
});
```

Also assert that the generated record's manifest/executable/profile digests match the copied bytes, stale generated resources are removed first, symlinks are rejected, and an unexpected seventh Artifact entry fails.

- [ ] **Step 2: Verify RED**

Run: `bun run test tests/scripts/stageAionuiLinuxGoosePackage.test.mjs tests/scripts/p8NativeBuildWiring.test.mjs`

Expected: FAIL because the staging entry point and patch 0021 do not exist.

- [ ] **Step 3: Implement staging using the existing Artifact admission**

```ts
const admitted = await admitGooseRunnerArtifact(artifactDirectory, {
  expectedTargetTriple: GOOSE_LINUX_TARGET_TRIPLE,
  trustedManifestSha256,
});
await copyExactArtifactFiles(admitted.directory, packageRunnerDirectory);
await writeFile(recordPath, JSON.stringify({
  contractVersion: 1,
  targetTriple: admitted.targetTriple,
  runnerManifestSha256: admitted.manifestSha256,
  executableSha256: admitted.executableSha256,
  profileSha256: await sha256File(materializedProfilePath),
  profileName: GOOSE_LINUX_PROFILE_NAME,
  executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
}, null, 2) + "\n", { mode: 0o644 });
```

Add root script:

```json
"downstream:aionui:stage:linux-goose": "bun scripts/stage-aionui-linux-goose-package.ts"
```

- [ ] **Step 4: Add downstream patch 0021**

Patch only `packages/desktop/electron-builder.yml`:

```yaml
deb:
  appArmorProfile: resources/actestra-apparmor-profile
```

Add explicit extra resources:

```yaml
  - from: resources/actestra-goose-runner
    to: actestra-goose-runner
  - from: resources/actestra-goose-runner-admission.json
    to: actestra-goose-runner-admission.json
```

Register patch 0021 as R1, the profile as an `assetCopy`, the shared contract as a `sourceCopy`, and every generated destination in `expectedChangedFiles`. Update downstream checks to require exact profile/resource wiring and reject a foundation edit.

- [ ] **Step 5: Verify GREEN and commit**

Run: `bun run test tests/scripts/stageAionuiLinuxGoosePackage.test.mjs tests/scripts/p8NativeBuildWiring.test.mjs && bun run downstream:aionui:check`

Commit:

```bash
git add scripts/stage-aionui-linux-goose-package.ts \
  tests/scripts/stageAionuiLinuxGoosePackage.test.mjs \
  downstream/aionui-v2.1.41/patches/0021-actestra-ubuntu-apparmor-bootstrap.mjs \
  downstream/aionui-v2.1.41/overlay.json scripts/check-aionui-downstream.mjs package.json
git commit -m "feat: stage Goose runner for Ubuntu DEB"
```

### Task 3: Add Main-owned root package admission

**Files:**
- Create: `apps/desktop/src/main/workers/gooseRunnerLinuxPackage.ts`
- Create: `tests/main/gooseRunnerLinuxPackageAdmission.test.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerArtifact.ts`
- Modify: `apps/desktop/src/main/workers/actestraCodingJourneyRuntime.ts`
- Modify: `tests/main/actestraCodingJourneyRuntime.test.ts`

- [ ] **Step 1: Write failing ownership and digest tests**

```ts
it.each([
  "missing-profile",
  "profile-digest-drift",
  "manifest-digest-drift",
  "executable-digest-drift",
  "symlink-component",
  "non-root-owner",
  "group-writable",
  "other-writable",
  "wrong-resources-path",
  "bootstrap-failure",
])("rejects %s before creating goose-private", async (fault) => {
  const result = await startTrustedActestraCodingJourneyRuntime(
    linuxOptions(fault),
    linuxDependencies(fault),
  );
  expect(result).toBeNull();
  expect(await readdir(userDataPath)).not.toContain("goose-private");
});
```

Use dependency-injected `lstat`, `realpath`, `readFile`, digest, and bootstrap execution so macOS tests can prove root ownership without creating real root-owned fixtures.

- [ ] **Step 2: Verify RED**

Run: `bun run test tests/main/gooseRunnerLinuxPackageAdmission.test.ts tests/main/actestraCodingJourneyRuntime.test.ts`

Expected: FAIL because Linux package admission is absent.

- [ ] **Step 3: Implement ordered fail-closed preflight**

```ts
const resourcesPath = assertFixedResourcesPath(options.resourcesPath);
await assertRootOwnedCanonicalTree(requiredPackagePaths(resourcesPath));
const record = parseGooseRunnerLinuxPackageAdmission(await readBoundedRecord(recordPath));
if (record === null) return null;
if (await sha256File(profilePath) !== record.profileSha256) return null;
const artifact = await admitGooseRunnerArtifact(runnerDirectory, {
  trustedManifestSha256: record.runnerManifestSha256,
  expectedTargetTriple: record.targetTriple,
});
if (artifact.executableSha256 !== record.executableSha256) return null;
if (!(await runLinuxBootstrapCheck(artifact.executablePath))) return null;
return freezeLinuxInstalledArtifact(artifact, record);
```

The ownership check covers `/opt`, `/opt/Actestra`, `resources`, profile, record, runner directory, and all six Artifact files. Every component must be canonical, non-symlink, UID 0, correct file type, and not group/other writable.

The bootstrap process invokes only the fixed executable with `--actestra-linux-bootstrap-check`, a closed environment, bounded stdout/stderr, and a fixed timeout. It accepts one exact stdout marker and empty stderr. It returns a closed result and never logs child output or paths.

- [ ] **Step 4: Integrate runtime startup**

On Linux, `startTrustedActestraCodingJourneyRuntime` ignores environment-selected Artifact paths and requires `linuxPackageResourcesPath` from Electron Main. On Darwin it retains `resolveTrustedActestraCodingRunnerAdmission(process.env)`. The admitted Artifact receives an optional frozen `linuxInstall` attestation; the underlying six-file manifest remains unchanged.

- [ ] **Step 5: Verify GREEN and commit**

Run: `bun run test tests/main/gooseRunnerLinuxPackageAdmission.test.ts tests/main/actestraCodingJourneyRuntime.test.ts tests/main/gooseRunnerArtifact.test.ts`

Commit:

```bash
git add apps/desktop/src/main/workers/gooseRunnerLinuxPackage.ts \
  apps/desktop/src/main/workers/gooseRunnerArtifact.ts \
  apps/desktop/src/main/workers/actestraCodingJourneyRuntime.ts \
  tests/main/gooseRunnerLinuxPackageAdmission.test.ts \
  tests/main/actestraCodingJourneyRuntime.test.ts
git commit -m "feat: admit root-owned Linux Goose package"
```

### Task 4: Launch Linux only from the stable package path

**Files:**
- Modify: `apps/desktop/src/main/workers/gooseRunnerTarget.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerContainment.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `tests/main/gooseRunnerTarget.test.ts`
- Modify: `tests/main/gooseRunnerContainment.test.ts`
- Modify: `tests/main/gooseRunnerLifecycle.test.ts`
- Modify: `tests/main/gooseRunnerLinuxNative.integration.ts`
- Modify: `tests/security/gooseRunnerParentDeathAbuse.integration.ts`

- [ ] **Step 1: Write failing stable-path tests**

```ts
it("rejects a generic Linux Artifact before mkdtemp", async () => {
  await expect(openGooseRunnerHandshake(linuxOptions(genericArtifact)))
    .rejects.toMatchObject({ code: "network-policy-unavailable" });
  expect(await readdir(privateRootParent)).toEqual([]);
});

it("uses the fixed package executable and creates no attempt bin", async () => {
  await openGooseRunnerHandshake(linuxOptions(installedArtifact));
  expect(spawnOptions.executablePath).toBe(GOOSE_LINUX_EXECUTABLE_PATH);
  expect(spawnOptions.executableAuthority).toBe("linux-package");
  expect(await pathExists(path.join(privateRoot, "bin"))).toBe(false);
});
```

The containment contract must reject `linux-package` on Darwin and `attempt-private` on Linux.

- [ ] **Step 2: Verify RED**

Run: `bun run test tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerContainment.test.ts tests/main/gooseRunnerLifecycle.test.ts`

Expected: FAIL because runtime resolution remains Darwin-only and Linux staging still copies into `goose-attempt-*/bin`.

- [ ] **Step 3: Implement explicit executable authority**

```ts
export type GooseExecutableAuthority = "attempt-private" | "linux-package";

const executableAuthority =
  runtimeTarget.platform === "linux" ? "linux-package" : "attempt-private";
const prepared = await preparePrivateRoot(
  options.privateRootParent,
  options.artifact,
  executableAuthority,
);
```

For `linux-package`, create only `config`, `data`, `state`, `home`, `tmp`, `work`, and `bridge` at mode 0700. Do not create `bin` or copy executable bytes. Require the Artifact's frozen Linux install attestation and exact fixed executable path. Keep the Darwin copy/digest/chmod behavior byte-for-byte.

Enable Linux in `resolveGooseRunnerRuntimeTarget`; keep Windows runtime unavailable. Pass `executableAuthority` through spawn and containment contracts. Preserve the exact loopback bridge, workspace, resource, parent-liveness, cleanup, and error behavior.

- [ ] **Step 4: Update native PID/cleanup probes**

Linux PID lookup must match the fixed executable path rather than `privateRoot/bin`. Parent-death and cleanup still assert the process exits, bridge sockets close, and the attempt-private root disappears exactly once.

- [ ] **Step 5: Verify GREEN and commit**

Run: `bun run test tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerContainment.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/security/gooseRunnerParentDeathAbuse.integration.ts`

Commit:

```bash
git add apps/desktop/src/main/workers/gooseRunnerTarget.ts \
  apps/desktop/src/main/workers/gooseRunnerContainment.ts \
  apps/desktop/src/main/workers/gooseRunnerProcess.ts \
  tests/main/gooseRunnerTarget.test.ts tests/main/gooseRunnerContainment.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts tests/main/gooseRunnerLinuxNative.integration.ts \
  tests/security/gooseRunnerParentDeathAbuse.integration.ts
git commit -m "feat: launch Linux Goose from packaged path"
```

### Task 5: Add runner bootstrap and pre-unshare self-check

**Files:**
- Create: `workers/goose-runner/src/linux_bootstrap.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/src/containment/linux.rs`
- Modify: `scripts/build-goose-runner.mjs`
- Modify: `tests/main/gooseRunnerLinuxNative.integration.ts`

- [ ] **Step 1: Write failing Rust tests**

```rust
#[test]
fn accepts_only_the_exact_packaged_identity() {
    assert!(verify_bootstrap_inputs(
        "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
        "Actestra-Goose-Runner (unconfined)\n",
        "Y\n",
        "1\n",
    ).is_ok());
}

#[test]
fn rejects_changed_path_profile_or_host_state() {
    assert!(verify_bootstrap_inputs("/tmp/runner", "Actestra-Goose-Runner (unconfined)\n", "Y\n", "1\n").is_err());
    assert!(verify_bootstrap_inputs(GOOSE_PATH, "unconfined\n", "Y\n", "1\n").is_err());
    assert!(verify_bootstrap_inputs(GOOSE_PATH, "Actestra-Goose-Runner (unconfined)\n", "N\n", "1\n").is_err());
    assert!(verify_bootstrap_inputs(GOOSE_PATH, "Actestra-Goose-Runner (unconfined)\n", "Y\n", "0\n").is_err());
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path workers/goose-runner/Cargo.toml linux_bootstrap -- --nocapture`

Expected: FAIL because the bootstrap module and command mode do not exist.

- [ ] **Step 3: Implement bounded markers and file checks**

```rust
pub const BOOTSTRAP_OK: &str = "ACTESTRA_GOOSE_LINUX_BOOTSTRAP_OK";
pub const BOOTSTRAP_FAILED: &str = "ACTESTRA_GOOSE_LINUX_BOOTSTRAP_FAILED";

pub fn verify_current_linux_bootstrap() -> Result<(), ()> {
    verify_bootstrap_inputs(
        canonical_proc_self_exe()?,
        read_bounded("/proc/self/attr/current")?,
        read_bounded("/sys/module/apparmor/parameters/enabled")?,
        read_bounded("/proc/sys/kernel/apparmor_restrict_unprivileged_userns")?,
    )
}
```

Handle exact argument `--actestra-linux-bootstrap-check` before containment-probe or normal startup. Print only `BOOTSTRAP_OK` on success; emit only `BOOTSTRAP_FAILED` and nonzero exit on failure. This mode must not construct Tokio, start ACP, create a namespace, bind a relay, or contact a provider.

- [ ] **Step 4: Repeat the check immediately before unshare**

Call `verify_current_linux_bootstrap()` in normal Linux startup and again in `containment/linux.rs` directly adjacent to the real `unshare(CLONE_NEWUSER)` call. Map failure to the existing bounded network-policy marker. Add `linux_bootstrap.rs` to `sourceTreeFiles` in `scripts/build-goose-runner.mjs`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `cargo test --manifest-path workers/goose-runner/Cargo.toml && bun run goose:runner:format:check`

Commit:

```bash
git add workers/goose-runner/src/linux_bootstrap.rs workers/goose-runner/src/main.rs \
  workers/goose-runner/src/containment/linux.rs scripts/build-goose-runner.mjs \
  tests/main/gooseRunnerLinuxNative.integration.ts
git commit -m "feat: verify Linux Goose AppArmor bootstrap"
```

### Task 6: Wire Electron Main, DEB inspection, and Ubuntu installation simulation

**Files:**
- Modify: `downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs`
- Create: `scripts/inspect-aionui-linux-deb.mjs`
- Create: `tests/scripts/inspectAionuiLinuxDeb.test.mjs`
- Modify: `tests/scripts/p8NativeBuildWiring.test.mjs`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing composition and CI-order tests**

```js
expect(teamPatch).toContain(
  "linuxPackageResourcesPath: process.platform === 'linux' ? process.resourcesPath : undefined",
);
expect(teamPatch).not.toContain("ACTESTRA_GOOSE_LINUX_PACKAGE");

expectOrderedFragments(linuxJob, [
  "Build exact Ubuntu Goose runner artifact",
  "Install temporary Ubuntu Goose package layout",
  "Run authenticated Linux Goose integration",
  "Run exact Ubuntu containment acceptance",
  "Remove temporary Ubuntu Goose package layout",
]);
expect(linuxJob).toContain("kernel.apparmor_restrict_unprivileged_userns");
expect(linuxJob).not.toContain("sysctl -w");
```

The DEB inspector fixture must require `resources/apparmor-profile`, the exact six runner files, the sibling record, and maintainer-script references to `/etc/apparmor.d/Actestra`. It must reject a missing profile, unexpected runner entry, or wrong profile hash with one closed code.

- [ ] **Step 2: Verify RED**

Run: `bun run test tests/scripts/p8NativeBuildWiring.test.mjs tests/scripts/inspectAionuiLinuxDeb.test.mjs`

Expected: FAIL because Main and CI have no package bootstrap wiring.

- [ ] **Step 3: Pass Electron-owned resources path**

Patch 0014 must pass `process.resourcesPath` only to the Linux runtime option. Do not expose it through Renderer, preload, IPC, provider configuration, or a production environment override.

- [ ] **Step 4: Add scoped Ubuntu installation simulation**

After exact runner build/admission:

```bash
set -euo pipefail
test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = "1"
sudo install -d -o root -g root -m 0755 /opt/Actestra/resources/actestra-goose-runner
sudo install -o root -g root -m 0755 /usr/bin/true /opt/Actestra/Actestra
sudo install -o root -g root -m 0644 \
  apps/desktop/resources/linux/actestra-apparmor-profile \
  /opt/Actestra/resources/apparmor-profile
# Stage the exact six admitted Artifact files and generated record with root ownership.
sudo install -o root -g root -m 0644 \
  apps/desktop/resources/linux/actestra-apparmor-profile \
  /etc/apparmor.d/Actestra
sudo apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/Actestra
```

Use a shell `trap` that unloads `/etc/apparmor.d/Actestra` and removes only that file plus `/opt/Actestra`. Run authenticated integration and containment as the ordinary GitHub user. Assert runner UID is nonzero, the profile is active, no root Goose process exists, and no profile/socket/private-root/install residue survives cleanup.

- [ ] **Step 5: Add bounded DEB build inspection**

After materialization, Linux runner staging, and AionUI build, produce the DEB with the existing `dist:linux` entry. Inspect package file lists and maintainer scripts without logging package contents or paths beyond fixed relative names. This proves package wiring only; it does not claim the P8.2 Electron journey gate.

- [ ] **Step 6: Verify GREEN and commit**

Run: `bun run test tests/scripts/p8NativeBuildWiring.test.mjs tests/scripts/inspectAionuiLinuxDeb.test.mjs && actionlint .github/workflows/ci.yml && bun run downstream:aionui:check`

Commit:

```bash
git add downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs \
  scripts/inspect-aionui-linux-deb.mjs tests/scripts/inspectAionuiLinuxDeb.test.mjs \
  tests/scripts/p8NativeBuildWiring.test.mjs .github/workflows/ci.yml
git commit -m "ci: simulate Ubuntu Goose package bootstrap"
```

### Task 7: Local gates, one push, and exact-head native evidence

**Files:**
- Modify: `docs/PROJECT_STATUS.md` only after native evidence exists

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun run test \
  tests/main/gooseRunnerLinuxPackageContract.test.ts \
  tests/scripts/stageAionuiLinuxGoosePackage.test.mjs \
  tests/main/gooseRunnerLinuxPackageAdmission.test.ts \
  tests/main/gooseRunnerTarget.test.ts \
  tests/main/gooseRunnerContainment.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts \
  tests/scripts/inspectAionuiLinuxDeb.test.mjs \
  tests/scripts/p8NativeBuildWiring.test.mjs
cargo test --manifest-path workers/goose-runner/Cargo.toml
bun run goose:runner:format:check
actionlint .github/workflows/ci.yml
```

Expected: PASS; Linux-native behavior remains unclaimed on macOS.

- [ ] **Step 2: Run broad local gates**

```bash
bun run format:check
bun run lint
bun run typecheck
bun run foundation:aionui:check
bun run downstream:aionui:check
bun run check
git diff --check
```

If the recorded P7 packaged-trust parallel flake recurs, rerun that file in isolation and report both results. Do not modify it unless isolated reproduction proves a stable defect.

- [ ] **Step 3: Push the final implementation head once**

```bash
git push origin codex/p8-2b-runtime-containment
```

Wait for the exact-head Ubuntu containment job. When its decisive result appears, cancel unrelated still-running jobs to conserve Actions; never cancel the Ubuntu job before evidence is complete.

- [ ] **Step 4: Apply the acceptance matrix**

Ubuntu is acceptable only when all are true:

- AppArmor remains enabled and `kernel.apparmor_restrict_unprivileged_userns=1`.
- The exact checked-in profile and root-owned `/opt/Actestra` layout are active.
- The runner bootstrap emits only its exact success marker.
- Goose runs as non-root.
- Authenticated ACP, filesystem, network, process tree, resources, parent death, cancellation/crash, and cleanup all verify.
- Post-bind Artifact admission succeeds.
- Teardown leaves no profile, install tree, private root, socket, or Goose process.
- Only bounded success evidence is uploaded.

A build-only pass, skipped native test, unpacked runner, or disabled sysctl is not acceptance.

- [ ] **Step 5: Record evidence conservatively**

If exact-head Ubuntu is fully green, add a dated `PROJECT_STATUS.md` entry with the commit, run/job IDs, manifest/executable/profile digests, ordinary-user result, cleanup result, and remaining Windows/P8.2/P8.3/P8.4 non-claims. If CI fails, record only the bounded failure code and keep Linux runtime admission open.

- [ ] **Step 6: Commit status only when evidence exists**

```bash
git add docs/PROJECT_STATUS.md
git commit -m "docs: record Ubuntu Goose containment evidence"
```

Do not create this commit for incomplete or failed evidence.

## Self-Review

- Every production behavior starts with a RED test.
- No file under `foundation/` changes.
- The profile grants only `userns` to two fixed root-owned paths.
- Production Linux has no environment-selected runner path.
- Main verifies path, ownership, mode, record, profile, Artifact, and bootstrap before attempt creation.
- The runner repeats identity validation immediately before `unshare`.
- CI uses root only for temporary installation and teardown; Goose runs as ordinary user.
- Darwin behavior remains unchanged; Windows, P8.3, P8.4, signing, release, and real-provider acceptance are outside this plan.
