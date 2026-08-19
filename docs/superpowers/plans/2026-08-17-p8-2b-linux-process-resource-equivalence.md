# P8.2b Linux Process and Resource Equivalence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not dispatch subagents for this batch. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the non-portable cgroup/PID feasibility assumption with exact Linux x86-64 RLIMIT and thread-aware seccomp evidence while keeping Linux runtime admission and overall P8.2b fail closed.

**Architecture:** Keep the existing Actestra-built Goose runner, Main/Core authority, Artifact admission, evidence binder, and CI jobs. Apply the existing fixed `RLIMIT_CPU` and baseline-plus-1-GiB `RLIMIT_AS`, then install one classic-BPF seccomp filter before Tokio is constructed; exercise that same filter in a disposable native probe child. Remove cgroup v2 from the required evidence path because its PIDs controller counts threads and the accepted Ubuntu builder does not delegate it.

**Tech Stack:** Rust 1.96.1, `libc`, classic BPF seccomp, Tokio 1.48, Bun 1.3.9, Vitest, GitHub Actions Ubuntu 24.04.

---

## Fixed boundary

The approved specification is
[`docs/superpowers/specs/2026-08-17-p8-2b-linux-process-resource-equivalence-design.md`](../specs/2026-08-17-p8-2b-linux-process-resource-equivalence-design.md).
Implementation starts from
`codex/p8-2b-runtime-containment@aed9e54d9409ddf0440e71bdb98caea29b5576e4`.

This batch must not edit `foundation/`, add a second supervisor or policy
engine, add root/sudo/setuid authority, widen Renderer or preload authority,
change `complete` to true, bind partial evidence, or enable Linux runtime
admission. macOS and Windows results remain separate evidence.

## File responsibility map

- `workers/goose-runner/src/containment/linux.rs`: Linux seccomp program,
  hostile process probe, exact RLIMIT probe, fixed failure codes, and evidence.
- `workers/goose-runner/src/containment/mod.rs`: Linux policy export.
- `workers/goose-runner/src/main.rs`: resource → seccomp → Tokio startup order.
- `scripts/gooseContainmentEvidence.mjs`: closed diagnostics and partial-stage
  classification.
- `scripts/record-goose-runner-containment.mjs` and
  `scripts/test-goose-runner-containment.mjs`: fail-closed evidence consumers.
- `scripts/run-goose-runner-containment.mjs`: closed acceptance vocabulary.
- `tests/scripts/gooseRunnerContainmentProbe.test.mjs`,
  `tests/scripts/gooseContainmentDiagnostics.test.mjs`,
  `tests/scripts/gooseContainmentEvidenceBinding.test.mjs`, and
  `tests/scripts/gooseRunnerPortability.test.mjs`: local contract proofs.
- `docs/PROJECT_STATUS.md`: local and target-native evidence separation.

### Task 1: Lock and build the thread-aware seccomp program

**Files:**

- Modify: `tests/scripts/gooseRunnerContainmentProbe.test.mjs`
- Modify: `workers/goose-runner/src/containment/linux.rs`

- [ ] **Step 1: Write the failing source-contract test.**

Replace the current deny-all process-policy assertion with:

```js
it("requires an x86-64 thread-aware seccomp policy", () => {
  const source = fs.readFileSync(linuxContainmentPath, "utf8");
  for (const token of [
    "AUDIT_ARCH_X86_64",
    "X32_SYSCALL_BIT",
    "CLONE_THREAD",
    "CLONE_SIGHAND",
    "CLONE_VM",
    "SECCOMP_RET_KILL_PROCESS",
    "SECCOMP_RET_ERRNO | libc::ENOSYS as u32",
    "SECCOMP_RET_ERRNO | libc::EPERM as u32",
    "install_process_creation_filter",
  ]) expect(source).toContain(token);
  expect(source).toContain("BPF_JSET");
  expect(source).toContain("BPF_AND");
  expect(source).not.toContain("can_install_seccomp_filter");
});
```

- [ ] **Step 2: Run it and verify RED.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerContainmentProbe.test.mjs
```

Expected: FAIL because the current filter denies every `clone`, lacks the
architecture/x32 guard, and returns `EPERM` for `clone3`.

- [ ] **Step 3: Implement the exact classic-BPF program.**

Keep `SockFilter` and `SockFilterProgram`. Add these constants and helpers:

```rust
const BPF_ALU: u16 = 0x04;
const BPF_AND: u16 = 0x50;
const BPF_JSET: u16 = 0x40;
const SECCOMP_RET_KILL_PROCESS: u32 = 0x8000_0000;
const AUDIT_ARCH_X86_64: u32 = 0xc000_003e;
const X32_SYSCALL_BIT: u32 = 0x4000_0000;
const SECCOMP_DATA_NR_OFFSET: u32 = 0;
const SECCOMP_DATA_ARCH_OFFSET: u32 = 4;
const SECCOMP_DATA_ARG0_OFFSET: u32 = 16;
const REQUIRED_THREAD_CLONE_FLAGS: u32 =
    (libc::CLONE_THREAD | libc::CLONE_SIGHAND | libc::CLONE_VM) as u32;

fn bpf_statement(code: u16, value: u32) -> SockFilter {
    SockFilter { code, jump_true: 0, jump_false: 0, value }
}

fn bpf_jump(code: u16, value: u32, jump_true: u8, jump_false: u8) -> SockFilter {
    SockFilter { code, jump_true, jump_false, value }
}
```

Replace `process_creation_filter()` with:

```rust
fn process_creation_filter() -> Vec<SockFilter> {
    vec![
        bpf_statement(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARCH_OFFSET),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
        bpf_statement(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
        bpf_statement(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_NR_OFFSET),
        bpf_jump(BPF_JMP | BPF_JSET | BPF_K, X32_SYSCALL_BIT, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_KILL_PROCESS),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_clone as u32, 0, 5),
        bpf_statement(BPF_LD | BPF_W | BPF_ABS, SECCOMP_DATA_ARG0_OFFSET),
        bpf_statement(BPF_ALU | BPF_AND | BPF_K, REQUIRED_THREAD_CLONE_FLAGS),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, REQUIRED_THREAD_CLONE_FLAGS, 1, 0),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ALLOW),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_clone3 as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::ENOSYS as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_fork as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_vfork as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_execve as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_jump(BPF_JMP | BPF_JEQ | BPF_K, libc::SYS_execveat as u32, 0, 1),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ERRNO | libc::EPERM as u32),
        bpf_statement(BPF_RET_K, SECCOMP_RET_ALLOW),
    ]
}
```

The clone comparison's false jump is exactly `5`: it skips the five
clone-argument instructions and lands on the `clone3` comparison. Do not add a
default-deny policy for unrelated admitted Goose syscalls.

- [ ] **Step 4: Lock the instruction shape in a Linux Rust test.**

Replace the old filter-shape test with:

```rust
#[test]
fn process_filter_guards_architecture_x32_and_thread_clone_flags() {
    let filter = process_creation_filter();
    assert_eq!(filter.len(), 23);
    assert_eq!(filter[0].value, SECCOMP_DATA_ARCH_OFFSET);
    assert_eq!(filter[1].value, AUDIT_ARCH_X86_64);
    assert_eq!(filter[2].value, SECCOMP_RET_KILL_PROCESS);
    assert_eq!(filter[4].code, BPF_JMP | BPF_JSET | BPF_K);
    assert_eq!(filter[4].value, X32_SYSCALL_BIT);
    assert_eq!(filter[8].code, BPF_ALU | BPF_AND | BPF_K);
    assert_eq!(filter[8].value, REQUIRED_THREAD_CLONE_FLAGS);
    assert_eq!(filter[13].value, SECCOMP_RET_ERRNO | libc::ENOSYS as u32);
    for index in [10, 15, 17, 19, 21] {
        assert_eq!(filter[index].value, SECCOMP_RET_ERRNO | libc::EPERM as u32);
    }
    assert_eq!(filter[22].value, SECCOMP_RET_ALLOW);
}
```

- [ ] **Step 5: Verify GREEN and commit.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerContainmentProbe.test.mjs
bun run goose:runner:format:check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
git diff --check
```

Expected locally: Vitest passes and the macOS Rust suite remains green. Linux
Rust tests are target-native evidence and are not claimed from this Mac.

Commit:

```bash
git add tests/scripts/gooseRunnerContainmentProbe.test.mjs workers/goose-runner/src/containment/linux.rs
git commit -m "feat: add thread-aware Linux Goose process policy"
```

### Task 2: Prove hostile denial and install the same policy before Tokio

**Files:**

- Modify: `workers/goose-runner/src/containment/linux.rs`
- Modify: `workers/goose-runner/src/containment/mod.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `tests/scripts/gooseRunnerPortability.test.mjs`
- Modify: `tests/scripts/gooseContainmentDiagnostics.test.mjs`
- Modify: `scripts/gooseContainmentEvidence.mjs`

- [ ] **Step 1: Add failing startup-order and diagnostic tests.**

Add to `tests/scripts/gooseRunnerPortability.test.mjs`:

```js
it("installs the Linux process policy before constructing Tokio", () => {
  const source = fs.readFileSync(runnerSourcePath, "utf8");
  const containment = fs.readFileSync(containmentModulePath, "utf8");
  expect(containment).toContain("pub(crate) use linux::install_process_creation_filter");
  const policy = source.indexOf("install_process_creation_filter()");
  const runtime = source.indexOf("tokio::runtime::Builder::new_multi_thread()");
  expect(policy).toBeGreaterThan(-1);
  expect(runtime).toBeGreaterThan(policy);
});
```

Add to `tests/scripts/gooseContainmentDiagnostics.test.mjs`:

```js
it("accepts only the closed process-stage vocabulary", () => {
  for (const code of [
    "process-seccomp-unavailable",
    "process-thread-unavailable",
    "process-creation-not-denied",
    "process-exec-not-denied",
    "process-probe-cleanup-failed",
  ]) {
    expect(
      classifyGooseContainmentProbeStderr(
        `Goose process-tree probe failed at bounded stage ${code}\n`,
      ),
    ).toBe(code);
  }
  expect(
    classifyGooseContainmentProbeStderr(
      "Goose process-tree probe failed at bounded stage process-private-path\n",
    ),
  ).toBeUndefined();
});
```

- [ ] **Step 2: Run the two tests and verify RED.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerPortability.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs
```

Expected: FAIL because production does not install seccomp and the Node
boundary recognizes only the old resource vocabulary.

- [ ] **Step 3: Add a closed process-probe result type.**

Add to `linux.rs`:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessProbeFailure {
    SeccompUnavailable,
    ThreadUnavailable,
    CreationNotDenied,
    ExecNotDenied,
    CleanupFailed,
}

fn process_probe_failure_code(failure: ProcessProbeFailure) -> &'static str {
    match failure {
        ProcessProbeFailure::SeccompUnavailable => "process-seccomp-unavailable",
        ProcessProbeFailure::ThreadUnavailable => "process-thread-unavailable",
        ProcessProbeFailure::CreationNotDenied => "process-creation-not-denied",
        ProcessProbeFailure::ExecNotDenied => "process-exec-not-denied",
        ProcessProbeFailure::CleanupFailed => "process-probe-cleanup-failed",
    }
}

fn syscall_errno(result: libc::c_long, expected: i32) -> bool {
    result == -1 && std::io::Error::last_os_error().raw_os_error() == Some(expected)
}

fn finish_creation_probe(result: libc::c_long) -> bool {
    if result == 0 {
        unsafe { libc::_exit(80) };
    }
    if result > 0 {
        let mut status = 0;
        unsafe { libc::waitpid(result as libc::pid_t, &mut status, 0) };
        return false;
    }
    syscall_errno(result, libc::EPERM)
}
```

Make `install_process_creation_filter()` `pub(crate)`.

- [ ] **Step 4: Replace the native process probe with thread success plus hostile denial.**

Inside the disposable child, after installing the shared filter, execute this
sequence and map its exits in the parent:

```rust
if std::thread::spawn(|| 7_u8).join() != Ok(7_u8) {
    unsafe { libc::_exit(21) };
}
let clone_result = unsafe {
    libc::syscall(libc::SYS_clone, libc::SIGCHLD, 0, 0, 0, 0)
};
if !finish_creation_probe(clone_result)
    || !finish_creation_probe(unsafe { libc::syscall(libc::SYS_fork) })
    || !finish_creation_probe(unsafe { libc::syscall(libc::SYS_vfork) })
    || !syscall_errno(
        unsafe { libc::syscall(libc::SYS_clone3, std::ptr::null::<c_void>(), 0) },
        libc::ENOSYS,
    )
{
    unsafe { libc::_exit(22) };
}

let executable = CString::new("/bin/false").unwrap_or_else(|_| unsafe {
    libc::_exit(23)
});
let argv = [executable.as_ptr(), std::ptr::null()];
let envp = [std::ptr::null::<libc::c_char>()];
let execve = unsafe {
    libc::syscall(
        libc::SYS_execve,
        executable.as_ptr(),
        argv.as_ptr(),
        envp.as_ptr(),
    )
};
let execveat = unsafe {
    libc::syscall(
        libc::SYS_execveat,
        libc::AT_FDCWD,
        executable.as_ptr(),
        argv.as_ptr(),
        envp.as_ptr(),
        0,
    )
};
if !syscall_errno(execve, libc::EPERM) || !syscall_errno(execveat, libc::EPERM) {
    unsafe { libc::_exit(23) };
}
unsafe { libc::_exit(0) };
```

`finish_creation_probe` immediately exits an accidentally created child and
waits for it in the parent branch, so a policy regression cannot leave a probe
zombie. The outer parent must map `20` to `SeccompUnavailable`, `21` to
`ThreadUnavailable`, `22|80` to `CreationNotDenied`, `23|1` to
`ExecNotDenied`, and any signal/wait/unknown exit to `CleanupFailed`. Under
`ACTESTRA_GOOSE_CONTAINMENT_DEBUG=1`, emit only:

```rust
eprintln!(
    "Goose process-tree probe failed at bounded stage {}",
    process_probe_failure_code(failure)
);
```

Use `/bin/false`, not `/bin/true`: an accidentally permitted `exec` must not
exit zero and masquerade as a passing probe.

- [ ] **Step 5: Install the same filter in normal Linux startup.**

Add to `containment/mod.rs`:

```rust
#[cfg(target_os = "linux")]
pub(crate) use linux::install_process_creation_filter;
```

Import it under the same `cfg` in `main.rs`, then place this block immediately
after successful `apply_resource_limits()` and before `Builder::new_multi_thread`:

```rust
#[cfg(target_os = "linux")]
if install_process_creation_filter().is_err() {
    eprintln!("{RESOURCE_LIMIT_FAILURE_MARKER}");
    std::process::exit(1);
}
```

Reuse `ACTESTRA_GOOSE_RESOURCE_LIMIT_SETUP_FAILED`; Main already maps it to
`worker-resource-enforcement-unavailable`. Do not add a second incident path.

- [ ] **Step 6: Admit only fixed process/resource diagnostic lines.**

In `scripts/gooseContainmentEvidence.mjs`, use this closed list:

```js
export const GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES = Object.freeze([
  "process-creation-not-denied",
  "process-exec-not-denied",
  "process-probe-cleanup-failed",
  "process-seccomp-unavailable",
  "process-thread-unavailable",
  "resource-rlimit-mismatch",
  "resource-rlimit-unavailable",
  "resource-rlimit-widening-not-denied",
  "resource-probe-cleanup-failed",
]);
```

Replace the regex with:

```js
const matches = [
  ...value.matchAll(
    /^Goose (?:process-tree|resource) probe failed at bounded stage ((?:process|resource)-[a-z-]+)$/gmu,
  ),
];
```

Keep the 64-KiB bound and require exactly one recognized match.

- [ ] **Step 7: Verify GREEN and commit.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerPortability.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs tests/scripts/gooseRunnerContainmentProbe.test.mjs
bun run goose:runner:format:check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
bun run format:check
bun run lint
git diff --check
```

Commit:

```bash
git add workers/goose-runner/src/containment/linux.rs workers/goose-runner/src/containment/mod.rs workers/goose-runner/src/main.rs scripts/gooseContainmentEvidence.mjs tests/scripts/gooseRunnerPortability.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs tests/scripts/gooseRunnerContainmentProbe.test.mjs
git commit -m "feat: enforce Linux Goose process policy before runtime"
```

### Task 3: Replace mandatory cgroup evidence with exact RLIMIT evidence

**Files:**

- Modify: `workers/goose-runner/src/containment/linux.rs`
- Modify: `tests/scripts/gooseRunnerContainmentProbe.test.mjs`
- Modify: `tests/scripts/gooseContainmentDiagnostics.test.mjs`

- [ ] **Step 1: Write the failing no-cgroup contract test.**

Replace the cgroup-specific test with:

```js
it("requires exact non-widenable RLIMIT evidence without mandatory cgroup authority", () => {
  const source = fs.readFileSync(linuxContainmentPath, "utf8");
  for (const token of [
    "run_rlimit_resource_probe",
    "current_virtual_size_bytes",
    "apply_resource_limits_with",
    "RLIMIT_CPU",
    "RLIMIT_AS",
    "resource-rlimit-mismatch",
    "resource-rlimit-widening-not-denied",
  ]) expect(source).toContain(token);
  for (const token of [
    "run_cgroup_v2_resource_probe",
    "cgroup.subtree_control",
    "cgroup.procs",
    "cpu.max",
    "memory.max",
    "pids.max",
  ]) expect(source).not.toContain(token);
  expect(source).toContain("let complete = false");
});
```

- [ ] **Step 2: Run it and verify RED.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerContainmentProbe.test.mjs
```

Expected: FAIL because the current resource probe requires delegated `cpu`,
`memory`, and `pids` controllers.

- [ ] **Step 3: Reduce resource failures to the exact RLIMIT vocabulary.**

Replace `ResourceProbeFailure` and its mapping with:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResourceProbeFailure {
    RlimitUnavailable,
    RlimitMismatch,
    RlimitWideningNotDenied,
    CleanupFailed,
}

fn resource_probe_failure_code(failure: ResourceProbeFailure) -> &'static str {
    match failure {
        ResourceProbeFailure::RlimitUnavailable => "resource-rlimit-unavailable",
        ResourceProbeFailure::RlimitMismatch => "resource-rlimit-mismatch",
        ResourceProbeFailure::RlimitWideningNotDenied => {
            "resource-rlimit-widening-not-denied"
        }
        ResourceProbeFailure::CleanupFailed => "resource-probe-cleanup-failed",
    }
}
```

Delete the cgroup constants, parsers, directory/controller writes, and cgroup
cleanup functions. Remove only imports made unused by that deletion; preserve
the Landlock/filesystem probe imports.

- [ ] **Step 4: Implement exact, non-widenable kernel-limit verification.**

Add:

```rust
fn hard_limit_cannot_be_raised(
    resource: libc::__rlimit_resource_t,
    limit: libc::rlimit,
) -> bool {
    let Some(raised_max) = limit.rlim_max.checked_add(1) else {
        return false;
    };
    let raised = libc::rlimit {
        rlim_cur: limit.rlim_cur,
        rlim_max: raised_max,
    };
    unsafe { libc::setrlimit(resource, &raised) } != 0
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}
```

Replace `run_rlimit_resource_probe()` with a `Result`-returning child probe.
Inside the child, use the shared functions and exact fixed values:

```rust
env::set_var(
    super::CPU_LIMIT_ENVIRONMENT_KEY,
    super::CPU_LIMIT_SECONDS.to_string(),
);
env::set_var(
    super::ADDRESS_SPACE_LIMIT_ENVIRONMENT_KEY,
    super::ADDRESS_SPACE_LIMIT_BYTES.to_string(),
);
let limits = match super::parse_resource_limits_with(|key| env::var(key).ok()) {
    Ok(value) => value,
    Err(()) => unsafe { libc::_exit(20) },
};
let baseline = match super::unix::current_virtual_size_bytes() {
    Ok(value) => value,
    Err(()) => unsafe { libc::_exit(20) },
};
let expected_address_space = match baseline.checked_add(super::ADDRESS_SPACE_LIMIT_BYTES) {
    Some(value) => value,
    None => unsafe { libc::_exit(20) },
};
if super::unix::apply_resource_limits_with(limits, baseline, |resource, soft, hard| {
    let limit = libc::rlimit {
        rlim_cur: soft as libc::rlim_t,
        rlim_max: hard as libc::rlim_t,
    };
    unsafe { libc::setrlimit(resource as _, &limit) }
})
.is_err()
{
    unsafe { libc::_exit(20) };
}

let mut cpu = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
let mut address_space = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
let read_exact = unsafe {
    libc::getrlimit(libc::RLIMIT_CPU, &mut cpu) == 0
        && libc::getrlimit(libc::RLIMIT_AS, &mut address_space) == 0
        && cpu.rlim_cur == super::CPU_LIMIT_SECONDS
        && cpu.rlim_max == super::CPU_LIMIT_SECONDS
        && address_space.rlim_cur == expected_address_space
        && address_space.rlim_max == expected_address_space
};
if !read_exact {
    unsafe { libc::_exit(21) };
}
if !hard_limit_cannot_be_raised(libc::RLIMIT_CPU, cpu)
    || !hard_limit_cannot_be_raised(libc::RLIMIT_AS, address_space)
{
    unsafe { libc::_exit(22) };
}
unsafe { libc::_exit(0) };
```

The parent must map `0` to `Ok(())`, `20` to `RlimitUnavailable`, `21` to
`RlimitMismatch`, `22` to `RlimitWideningNotDenied`, and every wait/signal or
unknown exit to `CleanupFailed`. If the platform's `setrlimit` resource type is
not `libc::__rlimit_resource_t`, use the inferred type of `libc::RLIMIT_CPU`;
do not add an unchecked narrowing cast.

Change `run_resource_probe()` to call only this RLIMIT probe, log its fixed code
under the existing debug flag, and return false on every error.

- [ ] **Step 5: Replace cgroup unit tests with exact closed-code assertions.**

Use:

```rust
#[test]
fn resource_failure_diagnostics_are_closed_and_redacted() {
    let expected = [
        (ResourceProbeFailure::RlimitUnavailable, "resource-rlimit-unavailable"),
        (ResourceProbeFailure::RlimitMismatch, "resource-rlimit-mismatch"),
        (
            ResourceProbeFailure::RlimitWideningNotDenied,
            "resource-rlimit-widening-not-denied",
        ),
        (ResourceProbeFailure::CleanupFailed, "resource-probe-cleanup-failed"),
    ];
    for (failure, code) in expected {
        assert_eq!(resource_probe_failure_code(failure), code);
        assert!(!code.contains('/'));
        assert!(!code.contains(' '));
    }
}
```

Keep `native_resource_stage_is_a_hostile_probe()`; on Ubuntu it now proves the
exact values and denied hard-limit widening.

- [ ] **Step 6: Verify GREEN and commit.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs
bun run goose:runner:format:check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
bun run format:check
bun run lint
git diff --check
```

Commit:

```bash
git add workers/goose-runner/src/containment/linux.rs tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs
git commit -m "fix: verify Linux Goose resource equivalence"
```

### Task 4: Preserve partial native truth without binding or admission

**Files:**

- Modify: `workers/goose-runner/src/containment/linux.rs`
- Modify: `scripts/gooseContainmentEvidence.mjs`
- Modify: `scripts/record-goose-runner-containment.mjs`
- Modify: `scripts/test-goose-runner-containment.mjs`
- Modify: `scripts/run-goose-runner-containment.mjs`
- Modify: `tests/scripts/gooseRunnerContainmentProbe.test.mjs`
- Modify: `tests/scripts/gooseContainmentDiagnostics.test.mjs`
- Modify: `tests/scripts/gooseContainmentEvidenceBinding.test.mjs`
- Modify: `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`

- [ ] **Step 1: Write failing tests for partial stage truth.**

Import `classifyGooseContainmentIncompleteEvidence` in
`tests/scripts/gooseContainmentDiagnostics.test.mjs`, then add:

```js
it("classifies bounded partial stages without declaring containment verified", () => {
  const evidence = {
    cleanup: false,
    contractVersion: 1,
    executableSha256: "c".repeat(64),
    filesystem: false,
    network: false,
    parentDeath: false,
    probeSha256: "b".repeat(64),
    processTree: true,
    resources: true,
    sourceCommit: "a".repeat(40),
    status: "evidence-incomplete",
    targetTriple: "x86_64-unknown-linux-gnu",
  };
  expect(classifyGooseContainmentIncompleteEvidence(evidence)).toBe(
    "remaining-evidence-incomplete",
  );
  expect(
    classifyGooseContainmentIncompleteEvidence({ ...evidence, processTree: false }),
  ).toBe("process-evidence-incomplete");
  expect(
    classifyGooseContainmentIncompleteEvidence({ ...evidence, resources: false }),
  ).toBe("resource-evidence-incomplete");
});
```

In `tests/scripts/gooseContainmentEvidenceBinding.test.mjs`, change the fixture
builder to accept one boolean per capability. Add a fixture with only
`processTree` and `resources` true. Assert exit 2, stderr exactly
`Goose containment remaining-evidence-incomplete\n`, and byte-for-byte unchanged
manifest content.

- [ ] **Step 2: Run focused tests and verify RED.**

Run:

```bash
bun run test -- tests/scripts/gooseContainmentDiagnostics.test.mjs tests/scripts/gooseContainmentEvidenceBinding.test.mjs tests/scripts/gooseRunnerContainmentProbe.test.mjs
```

Expected: FAIL because measured booleans are hidden behind
`available && complete` and no bounded stage classifier exists.

- [ ] **Step 3: Emit measured booleans while keeping overall status incomplete.**

In `run_linux_containment_probe()`, retain:

```rust
let complete = false;
```

Pass the six measurements directly to `format!`:

```rust
filesystem_available,
network_namespace_available,
process_tree_available,
resources_available,
parent_death_available,
cleanup,
if complete { "verified" } else { "evidence-incomplete" },
```

Remove each `&& complete`. The validator still rejects the record because its
status is incomplete; only the bounded stage truth becomes observable.

- [ ] **Step 4: Add a closed incomplete-stage classifier.**

Export from `scripts/gooseContainmentEvidence.mjs`:

```js
export function classifyGooseContainmentIncompleteEvidence(value) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, EVIDENCE_KEYS) ||
    value.status !== "evidence-incomplete" ||
    CAPABILITY_KEYS.some((key) => typeof value[key] !== "boolean")
  ) return undefined;
  if (value.processTree !== true) return "process-evidence-incomplete";
  if (value.resources !== true) return "resource-evidence-incomplete";
  return "remaining-evidence-incomplete";
}
```

Add the three returned strings to
`GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES`. In both evidence consumers, select
only a closed outcome in this order:

```js
const diagnostic =
  classifyGooseContainmentProbeStderr(result.stderr) ??
  (validation.code === "evidence-incomplete"
    ? classifyGooseContainmentIncompleteEvidence(evidence)
    : undefined) ??
  validation.code;
```

Pass `diagnostic` into the existing fixed-failure path. The acceptance wrapper
already expands the exported code list, so it may surface the fixed code but
must remain exit 2.

- [ ] **Step 5: Lock fail-closed binding and workflow behavior.**

In `tests/scripts/gooseRunnerContainmentProbe.test.mjs`, assert:

```js
expect(source).toContain("let complete = false");
expect(source).not.toContain("process_tree_available && complete");
expect(source).not.toContain("resources_available && complete");
```

Keep the existing validator proof that only `status: "verified"` with all six
booleans true returns `{ ok: true }`. In
`tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`, retain the assertions
for no `continue-on-error` and success-only upload; also assert the acceptance
script imports `GOOSE_CONTAINMENT_PROBE_DIAGNOSTIC_CODES`.

- [ ] **Step 6: Verify GREEN and commit.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs tests/scripts/gooseContainmentEvidenceBinding.test.mjs tests/scripts/gooseRunnerContainmentAcceptance.test.mjs
bun run format:check
bun run lint
bun run typecheck
git diff --check
```

Commit:

```bash
git add workers/goose-runner/src/containment/linux.rs scripts/gooseContainmentEvidence.mjs scripts/record-goose-runner-containment.mjs scripts/test-goose-runner-containment.mjs scripts/run-goose-runner-containment.mjs tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs tests/scripts/gooseContainmentEvidenceBinding.test.mjs tests/scripts/gooseRunnerContainmentAcceptance.test.mjs
git commit -m "test: expose bounded Linux containment stage evidence"
```

### Task 5: Run the complete local gate and record only local evidence

**Files:**

- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Run the focused matrix.**

Run:

```bash
bun run test -- tests/scripts/gooseRunnerContainmentProbe.test.mjs tests/scripts/gooseContainmentDiagnostics.test.mjs tests/scripts/gooseContainmentEvidenceBinding.test.mjs tests/scripts/gooseRunnerContainmentAcceptance.test.mjs tests/scripts/gooseRunnerPortability.test.mjs tests/scripts/gooseRunnerBuildTarget.test.mjs tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerContainment.test.ts tests/main/gooseRunnerTarget.test.ts
bun run goose:runner:format:check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked --release
actionlint .github/workflows/ci.yml
bun run docs:check
git diff --check
```

Expected on this Mac: Node tests pass, macOS Rust release tests remain green,
and Linux child execution remains an explicit target-native non-claim.

- [ ] **Step 2: Run the root gate once.**

Run:

```bash
bun run check
```

Record exact files, tests, skips, and exit code. Do not repeat the same gate for
unchanged bytes.

- [ ] **Step 3: Record the local state without claiming Ubuntu execution.**

Append a dated subsection to `docs/PROJECT_STATUS.md` with the exact
implementation head, commit list, focused/root counts, and these non-claims:
`complete = false`; Linux admission disabled; authenticated ACP composition,
filesystem/network composition, parent-death/cleanup, packaging, Windows,
P8.2, P8.3, and P8.4 remain open; no target-native result exists for the new
bytes yet.

- [ ] **Step 4: Verify and commit the evidence record.**

Run:

```bash
bun run docs:check
git diff --check
git status -sb
```

Commit:

```bash
git add docs/PROJECT_STATUS.md
git commit -m "docs: record Linux process resource implementation"
```

### Task 6: Obtain exact-artifact Ubuntu evidence without weakening the gate

**Files:**

- No source change before the first native run
- Update: draft PR 68 description after the run

- [ ] **Step 1: Reconfirm a clean, bounded branch and request push approval.**

Run:

```bash
git status -sb
git log --oneline --decorate -6
git diff origin/codex/p8-2b-runtime-containment...HEAD --stat
```

Stop if credentials, profiles, packages, logs, or unrelated changes appear.

- [ ] **Step 2: Push the exact implementation head once after approval.**

Run:

```bash
git push origin codex/p8-2b-runtime-containment
```

The pull-request push is the single verification key. Do not manually dispatch
a duplicate workflow.

- [ ] **Step 3: Inspect each CI layer separately.**

Run:

```bash
gh pr checks 68 --repo Ablankpaper/actestra-desktop
gh run view "$(gh run list --repo Ablankpaper/actestra-desktop --branch codex/p8-2b-runtime-containment --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --repo Ablankpaper/actestra-desktop --log-failed
```

Expected for this narrow slice:

- macOS foundation, Ubuntu build-only, Windows build-only, and Goose admission
  remain green;
- Ubuntu builds and admits the exact x86-64 Artifact;
- Ubuntu no longer reports cgroup, process, or resource failure;
- Ubuntu remains nonzero as `remaining-evidence-incomplete`, proving the
  process/resource stages are true while later P8.2b fields remain open;
- no success-only Ubuntu containment Artifact is uploaded; and
- Windows remains independently fail closed and unchanged.

If Ubuntu reports a `process-*` or `resource-*` code, retain the red gate and
Linux runtime denial and diagnose that exact native boundary. Do not claim the
slice or phase complete.

- [ ] **Step 4: Record native evidence without creating a second CI key.**

Update the draft PR description with the exact head, run/job IDs, manifest and
executable digests, executable size, fixed outcome code, and non-claims. Do not
add a docs-only commit just to copy CI IDs; that would create another head and
spend a full workflow without changing the verified runtime bytes.

## Final self-review checklist

- [ ] Architecture and x32 syscall identity are checked before syscall rules.
- [ ] Required thread clone flags are allowed; non-thread clone, fork, vfork,
  execve, and execveat are denied with the required errno.
- [ ] `clone3` returns `ENOSYS` so libc may fall back to inspectable `clone`.
- [ ] The production policy is installed before Tokio and liveness threads.
- [ ] CPU and address-space limits are exact, finite, and cannot be raised.
- [ ] No cgroup controller is required or counted as passing evidence.
- [ ] Partial booleans are bounded, unbound, non-admitting, and nonzero.
- [ ] `complete` remains false and the resolver remains Darwin-only.
- [ ] No foundation, Renderer, preload, provider, persistence, or UI authority
  changed.
- [ ] Local, CI, runtime, package, and acceptance claims remain separate.
