# P8.2b Linux Process and Resource Equivalence Design

**Status:** Approved specification; implementation not started

**Date:** 2026-08-17

**Baseline:** `codex/p8-2b-runtime-containment@77d970734e024f6c41a882441829c1ae08f1ac65`

**Phase:** P8.2b — Goose Linux runtime containment

**Related:** [P8.2b containment design](2026-08-17-p8-2b-goose-cross-platform-containment-design.md),
[ADR-0028](../../architecture/decisions/0028-p7-worker-resource-and-process-reliability.md),
and [ADR-0030](../../architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md)

## Purpose

This design replaces one invalid Linux feasibility assumption without widening
the accepted P7 resource contract. The P8.2b Ubuntu probe originally required
an unprivileged child cgroup with delegated `cpu`, `memory`, and `pids`
controllers. Pull-request CI proved that the GitHub-hosted Ubuntu 24.04 runner
does not delegate those controllers to the current cgroup. More importantly,
the cgroup PIDs controller counts kernel tasks or thread IDs, while the product
contract allows the Goose runner's required Tokio threads and forbids only
child processes.

The replacement must preserve the actual product outcome:

- fixed 120 CPU-second and 1 GiB address-space-growth limits;
- zero child processes and no post-launch executable replacement;
- required Rust, Tokio, and parent-liveness threads remain functional;
- no privileged helper, root daemon, host bootstrap, or CI-only exemption;
- bounded native evidence; and
- Linux runtime admission remains disabled until every P8.2b containment field
  and the real ACP composition verify.

This is a Linux process/resource slice. It does not complete the filesystem,
network bridge, ACP, packaging, Windows, or overall P8.2b gates.

## Evidence and root cause

Draft pull request 68 ran implementation head
`815c8e1e908d39996ccec772b1df0a249d227b2f` on native Ubuntu 24.04. Build-only
and artifact admission passed. Containment job `95238089303` then returned the
single closed code `resource-cgroup-controller-not-delegated` and exited 2.
The exact admitted executable was
`dd3ba07b5479e59d5bd402023174634fcfc6811d57c5a3fd44e673579b256c78`.

The failure has two independent causes:

1. A non-privileged process may create a cgroup subtree only after the host has
   delegated the relevant controller files. A standard GitHub-hosted job does
   not provide that product-owned delegation.
2. `pids.max` limits tasks/TIDs, not only independent child processes. Setting
   it to the launch baseline prevents later Tokio or liveness threads and is
   therefore not equivalent to a zero-child-process product contract.

Changing the CI image with `sudo`, mutating the shared parent
`cgroup.subtree_control`, or declaring the failed cgroup probe optional without
replacement evidence would address neither cause.

## Decision

Linux uses the same semantic split already accepted on macOS:

- kernel resource limits enforce CPU and address-space growth; and
- a kernel process policy allows threads but denies fork and exec.

The Linux runner will combine fixed `RLIMIT_CPU` and `RLIMIT_AS` with an
Actestra-owned, thread-aware seccomp filter. Cgroup v2 is not a mandatory
runtime or evidence dependency for this contract. A future delegated cgroup
may add defense in depth, but it cannot replace or silently widen the accepted
limits and is outside this slice.

### Resource authority

The existing Rust runner continues to:

1. parse only the exact product-owned values `120` and `1073741824`;
2. read its Linux virtual-size baseline from bounded `/proc/self/statm` data;
3. compute `baseline + 1 GiB` with checked arithmetic; and
4. set equal soft and hard `RLIMIT_CPU` and `RLIMIT_AS` values before ACP.

The Linux `resources` probe becomes verified only when a real child observes
the exact kernel limits and proves that neither hard limit can be raised. A
missing baseline, overflow, `setrlimit` failure, mismatched value, or successful
widening remains `resource-rlimit-unavailable` or another closed resource code.
It never falls back to a Main-only measurement.

### Process authority

The runner installs a classic BPF seccomp filter after resource-limit setup and
before constructing the Tokio runtime. `PR_SET_NO_NEW_PRIVS` is required before
the filter is installed. Because the filter is present before any runtime or
liveness thread exists, every subsequently created thread inherits it.

For the accepted `x86_64-unknown-linux-gnu` target the filter must:

1. validate the syscall architecture as x86-64 and fail closed for an
   unexpected architecture or x32 syscall identity;
2. return `ENOSYS` for `clone3`, whose pointed-to flags cannot be safely
   inspected by seccomp BPF, so the standard threading library may use the
   inspectable legacy `clone` path;
3. allow legacy `clone` only when its flags contain all of `CLONE_THREAD`,
   `CLONE_SIGHAND`, and `CLONE_VM`;
4. return `EPERM` for non-thread `clone`, `fork`, `vfork`, `execve`, and
   `execveat`; and
5. allow unrelated syscalls needed by the already admitted runner.

The kernel itself requires `CLONE_SIGHAND` and `CLONE_VM` when
`CLONE_THREAD` is used. A permitted clone therefore remains in the same thread
group and address space; it is not an independently executable child process.
The fixed address-space and CPU hard limits also bound abusive thread growth.

The filter is not installed with a permissive error fallback. If
`no_new_privs`, architecture validation, filter construction, or installation
fails, the runner emits the existing bounded setup marker and exits before
Tokio or ACP starts.

## Startup and cleanup order

The Linux normal path is ordered as follows:

```text
parse exact fixed limits
  -> read virtual-size baseline
  -> apply RLIMIT_CPU and RLIMIT_AS
  -> install thread-aware seccomp process filter
  -> construct the fixed two-worker Tokio runtime
  -> start the inherited parent-liveness watcher
  -> start Goose ACP
```

The liveness watcher is a thread in the same process group and inherits the
filter. On parent-pipe closure it retains the existing group termination and
process exit path. Main remains responsible for bounded termination,
private-root removal, attempt-state terminalization, and no-orphan evidence.
No second supervisor or launcher is introduced.

## Native evidence contract

The Linux feasibility probe must execute the same filter builder and installer
used by production. It runs in a disposable native child so the test process is
not permanently restricted. The child must prove all of these outcomes:

- a Rust thread can be created, joined, and observed;
- a non-thread clone or `fork` is denied with `EPERM`;
- `vfork` is denied;
- `clone3` returns `ENOSYS` and creates no task;
- `execve` and `execveat` are denied with `EPERM`;
- the exact CPU and address-space hard limits are present and cannot be
  widened; and
- every probe child is reaped and leaves no process or filesystem residue.

`processTree` may be true only after the thread-success and all process/exec
denial assertions pass. `resources` may be true only after the real RLIMIT
assertions pass. The remaining filesystem, network, parent-death, and cleanup
fields keep their own independent probes.

This slice does not change the deliberate overall `complete = false`. A
successful process/resource probe therefore advances the diagnosed boundary
but does not create a containment record or admit Linux runtime by itself.

## Diagnostics and redaction

Native failures cross the Node boundary only as fixed codes. The process stage
must distinguish at least:

- seccomp installation unavailable;
- thread creation unavailable;
- process creation not denied;
- executable replacement not denied; and
- probe wait or cleanup failure.

The existing resource stage retains a fixed RLIMIT failure code. Raw errno
strings, source paths, cgroup paths, environment values, child output, and
tokens are never persisted, uploaded, or echoed by the acceptance wrapper.
Unknown failures collapse to the existing generic containment failure.

## Testing strategy

Implementation follows RED–GREEN in this order:

1. Pure Rust tests lock the exact seccomp instruction shape, architecture
   guard, clone flag mask, `clone3` result, and fixed denial syscalls.
2. A Linux-native child test fails before implementation because a Rust thread
   cannot coexist with the old deny-all-clone filter.
3. The minimal filter implementation makes the thread test pass while keeping
   fork and exec denied.
4. The resource probe is changed from mandatory cgroup delegation to exact
   RLIMIT verification, with a regression proving that missing cgroup
   delegation cannot be translated directly to success.
5. Existing macOS Rust tests, Main containment/admission tests, bounded Node
   evidence tests, and CI wiring tests must remain green.
6. The exact rebuilt Linux artifact runs in the Ubuntu 24.04 containment job.
   Only native output can establish the new process/resource results.

The focused checks precede Rust format, TypeScript format/lint/typecheck,
`actionlint`, `bun run check`, and target-native CI. Unchanged Windows and
macOS evidence is not reinterpreted as Linux evidence.

## Alternatives rejected

### Require preconfigured cgroup delegation

Rejected because it makes a host administrator or CI bootstrap script part of
the product authority, fails on the accepted hosted builder, and does not match
the thread-versus-child-process contract.

### Add a privileged cgroup helper

Rejected because a root daemon, `sudo` step, setuid binary, or broad systemd
scope would add a second resource authority and would not be faithful
clean-machine evidence for the unprivileged desktop product.

### Remove cgroup checks and mark resources verified

Rejected because absence of one mechanism is not evidence of equivalent
enforcement. Exact RLIMIT and process-denial probes must pass before either
field becomes true.

## Rollback and remaining gates

Rollback restores the current cgroup feasibility probe and keeps Linux runtime
admission disabled. It does not alter persistence, Renderer, AionUI,
foundation source, provider state, or user data.

After this slice, P8.2b still requires the authenticated Linux Main bridge,
filesystem/network production composition, real ACP and bounded tool
execution, denial/cancellation/crash/recovery cleanup, and independent Windows
Job Object/restricted-identity/named-pipe work. P8.2, P8.3, and P8.4 remain
open.
