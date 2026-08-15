# P7.2 Worker Resource and Process Reliability Design

**Status:** Proposed implementation design

**Date:** 2026-08-15

**Baseline:** `main@1de868de0192230a0e0776a589c04f9c430ac136`

**Phase:** P7.2 — Worker resource and process reliability

## Purpose

P7.2 adds bounded resource and process reliability to the two product Worker
boundaries that already exist: the Electron General Worker and the isolated
Goose coding Worker. It extends the existing Main-owned supervision, protocol,
sandbox, and cleanup contracts without replacing them.

AionUI v2.1.41 remains the product surface, Actestra Main/Core remains the
authority for task state and privileged effects, the existing Tool Gateway
remains the policy and approval boundary, and Goose remains the existing
isolated coding Worker. The frozen `foundation/` snapshot is not edited.

P7.2 is a separate, reversible batch. It must not be counted as complete until
its focused tests, full project gate, packaged macOS evidence, pull-request CI,
merge, and merged-main CI all cover the same final bytes.

## Decision

### 1. Scope is limited to product Workers

The following are in scope:

- the Electron `utilityProcess` General Worker launched by
  `electronGeneralWorker.ts`;
- the admitted Goose ACP runner launched by `gooseRunnerProcess.ts`; and
- the shared Main-owned resource budget, incident classification, monitoring,
  and terminal cleanup contracts used by those two launch paths.

The following remain outside this batch:

- the Actestra-native planner sidecar;
- the SQLite persistence utility;
- Renderer, preload, AionUI routes, and user-configurable resource controls;
- the frozen `foundation/` tree and its upstream UI behavior;
- P7.3 database backup, migration rollback, and corruption recovery;
- P7.4 diagnostic export and audit retention; and
- Windows/Linux enforcement and physical acceptance, which remain P8 work.

The planner and persistence utility retain their existing timeout and process
contracts. They are not silently presented as having the new Worker resource
guarantees.

### 2. Main owns one immutable resource budget

Each Worker attempt receives one immutable, Main-created budget. Renderer,
Planner, Goose, and General Worker input cannot select or widen it. The
platform-neutral contract has these fields:

```ts
interface WorkerResourceBudget {
  readonly maxActiveDurationMs: number;
  readonly maxCpuSeconds: number;
  readonly maxPrivateMemoryBytes: number;
  readonly maxOutputBytes: number;
  readonly maxPrivateStorageBytes: number;
  readonly maxChildProcesses: number;
}
```

The budget is validated as a positive, bounded, exact record before launch and
is frozen for the lifetime of the attempt. A platform adapter may expose only
the enforcement capabilities it can prove. If a required macOS capability is
unavailable, Main refuses to launch the attempt with
`worker-resource-enforcement-unavailable`; it does not launch first and report
an unverified success later.

Resource incidents are metadata-only. They contain the attempt identity,
resource kind, bounded observed counter, configured limit, and a sanitized
termination shape. They never contain prompt text, model output, tool
arguments, credentials, environment values, private paths, or raw process
output.

### 3. Fixed initial profiles

The first implementation uses two product-owned profiles. These values are not
renderer settings, provider settings, or a hidden unlimited mode. Changing a
production value requires a reviewed code and evidence change.

| Worker | Active lifetime | CPU budget | Memory budget | Storage budget | Child-process budget |
| --- | ---: | ---: | ---: | ---: | ---: |
| General | 10 minutes | 30 CPU seconds | 512 MiB admitted memory bound (macOS/Linux working set or Windows private bytes), with a 256 MiB V8 heap cap | 0 bytes owned directly by the Worker | 0 |
| Goose | 30 minutes | 120 CPU seconds | 1 GiB address-space growth above the measured launch baseline | 512 MiB private-root aggregate, 64 MiB per file | 0 |

Existing wire and protocol caps remain active and are included in the output
budget rather than replaced:

- General retains its 256 KiB message, 96 KiB model-output, and 128 KiB private
  tool-input limits;
- Goose retains its 64 KiB ACP line, 256 KiB stderr, 256 KiB prompt, and
  120-second per-request bounds; and
- Main-owned workspace and Artifact tools retain their own content and patch
  limits.

The active lifetime clock pauses while an existing human-decision gate holds an
attempt. The approval itself keeps its independent bounded expiry. CPU,
storage, and process cleanup remain observable during a pause; a pause cannot
authorize additional capacity.

The Goose address-space limit is intentionally described as address-space
growth enforcement, not as a false exact resident-memory promise. A modern
macOS arm64 process starts with hundreds of GiB of platform-owned dyld virtual
mappings, so an absolute 1 GiB `RLIMIT_AS` is below the launch baseline and the
kernel rejects it. Before creating the async runtime, the native runner reads
`MACH_TASK_BASIC_INFO.virtual_size` and sets the soft and hard `RLIMIT_AS` to
the checked sum of that baseline and the fixed 1 GiB allowance. A missing
baseline, arithmetic overflow, or rejected limit fails closed. General Worker
memory uses Electron's `privateBytes` where available; on macOS/Linux it uses
the documented KiB `workingSetSize` normalized to bytes as a conservative
resident-memory bound, together with its V8 heap cap. Missing or invalid
memory metrics fail closed.

### 4. Preserve the existing enforcement authorities

#### General Worker

`launchElectronGeneralWorker` continues to use Electron `utilityProcess.fork`
and the existing structured-clone protocol. It adds only:

- a fixed `--max-old-space-size` argument derived from the admitted profile;
- a Main-owned monitor keyed by the utility PID and creation time;
- periodic CPU and normalized memory observations from Electron app metrics; and
- the existing adapter terminal path when a budget is exceeded.

The Worker entry graph remains denied filesystem, shell, network, SQLite, and
process-spawn imports. Consequently the zero-child guarantee is an authority
and packaging invariant, not an assertion that a future arbitrary native
module would be magically contained. A source or packaged-graph violation
continues to fail the existing boundary gate.

#### Goose Worker

`openGooseRunnerHandshake` continues to stage the admitted executable into the
attempt-private root, launch it through the existing macOS `sandbox-exec`
profile, and supervise its process group. It adds only:

- immutable resource values passed through the trusted launch contract;
- a Mach launch-baseline query plus `setrlimit` calls in the existing Actestra
  Rust runner before the Goose ACP server starts;
- a sandbox denial for process fork/exec beyond the admitted runner; and
- private-root accounting at the existing Main-owned write and cleanup
  boundaries.

The Rust runner remains the same pinned Goose source, empty feature set, ACP
stdio server, and parent-liveness implementation. No shell wrapper, new sidecar
framework, or upstream Goose UI is introduced.

#### Storage and output

No Worker receives a new arbitrary filesystem capability. Main-owned tools
preflight the projected private-root/storage delta, reject a write that would
exceed the fixed budget, and recheck the postcondition before acknowledging the
effect. The Goose private root is scanned with bounded `lstat`/directory
traversal; shell `du`, unrestricted recursive deletion, and user-selected
quotas are not used. Existing transport validators remain the first output
boundary, and an overflow never becomes a successful or unchanged task.

### 5. Lifecycle and failure ordering

The resource lifecycle is:

1. Main derives the Worker kind, exact profile, attempt identity, and grant.
2. The platform adapter validates all limits and proves required macOS
   capabilities before launch.
3. Main launches the existing Worker boundary and records the monitor identity
   (PID plus creation time where available).
4. The monitor observes active duration, CPU, memory, output, storage, and
   process state without passing raw observations to Renderer.
5. On a breach, Main stops accepting new protocol effects, persists the
   metadata-only incident before releasing supervisor memory, and terminates
   the existing process/process group through its current cleanup path.
6. Main verifies private-root, worktree, lease, lock, and descendant cleanup,
   then settles the attempt as a resource-specific failure. A resource breach
   is not retryable by default and cannot be projected as completed, unchanged,
   or user-cancelled.
7. If the process exits concurrently with a breach, the first durable terminal
   evidence wins; ambiguous persistence or cleanup remains an uncertain
   recovery state rather than being rewritten as success.

The existing approval, cancellation, human-feedback, and retry contracts are
not reused as resource authorization. A protected approval cannot waive a
resource limit.

### 6. Closed incident vocabulary

Main/Core adds only these narrow classifications:

- `worker-resource-cpu-exceeded`;
- `worker-resource-memory-exceeded`;
- `worker-resource-output-exceeded`;
- `worker-resource-timeout`;
- `worker-resource-storage-exceeded`;
- `worker-process-tree-violated`; and
- `worker-resource-enforcement-unavailable`.

The existing generic `worker-execution-failed` remains the fallback only when
no resource or process cause can be identified. Incident mapping preserves the
specific cause through durable attempt evidence, Core events, and the bounded
Renderer projection. No raw metric, path, command, or process text crosses the
projection boundary.

## Verification design

### Focused contract tests

The implementation must add tests for:

- budget exact-key, range, immutability, and non-widening validation;
- active-clock pause/resume around the existing human-decision gate;
- General Worker V8 argument construction and PID/creation-time metric
  identity;
- CPU and platform-appropriate memory breach classification with a fake
  Electron metrics source;
- Goose native limit setup, failed setup, and bounded signal classification;
- process-fork/exec denial in the generated macOS sandbox profile;
- output and private-root aggregate/per-file overflow before and after a write;
- concurrent exit-versus-breach ordering and idempotent cleanup; and
- redaction of all incident and test evidence.

### Real local process tests

On macOS arm64, deterministic hostile probes must exercise both Worker launch
boundaries:

- a CPU hog is terminated and leaves no process group;
- a memory allocator is rejected or terminated at the admitted limit;
- an oversized protocol/output frame fails before completion;
- a storage flood is denied before the aggregate limit is crossed;
- an unauthorized child/fork attempt is denied; and
- timeout, cancellation, parent death, and breach races leave no private root,
  worktree, lease, lock, or descendant.

Test probes are test inputs only. They never become production manifests,
trust roots, package resources, or runtime dependencies. A skipped or
unsupported probe is nonzero and is reported as unverified, never green.

### Packaged acceptance

The packaged macOS smoke must run against the exact built `.app` and a fresh
isolated profile. It must verify the General and Goose resource incidents,
terminal projections, redaction, cleanup, and absence of residual processes.
It must also rerun the existing P7.1 seven-case security smoke and the General
Work/Team regression journey as unchanged compatibility evidence where their
inputs are affected.

The P7.2 gate records local tests, package evidence, exact-head CI, merge, and
merged-main CI separately. It does not claim Windows/Linux enforcement,
notarization, release, deployment, or final user acceptance.

## Documentation and provenance updates

The implementation batch will add ADR-0028 for this resource authority and
update, in the same change, the current P7.2 state in:

- `docs/architecture/SYSTEM_OVERVIEW.md`;
- `docs/roadmap/DEVELOPMENT_SEQUENCE.md`;
- `docs/PROJECT_STATUS.md`; and
- `docs/README.md` when the new ADR is indexed.

Those updates will also correct the stale P7.1 sentence in the System Overview
that still says exact-head and merge evidence are open. The correction is a
documentation consistency repair, not a new product feature.

No `foundation/` file, third-party dependency, upstream pin, root license, or
Renderer route is changed. If a new native Rust source file is added, its
license/provenance and `THIRD_PARTY_NOTICES.md` impact must be recorded before
the batch can merge.

## Rollback and non-goals

Rollback removes the new monitor, profile, Rust limit calls, sandbox clauses,
incident mappings, tests, ADR, and documentation updates. It does not change
SQLite schema or require a migration. Existing process supervision, protocol
bounds, Tool Gateway policy, approval, worktree isolation, and redaction remain
in place after rollback.

This design does not:

- add a second policy, approval, persistence, telemetry, or sandbox framework;
- give Renderer or Planner resource authority;
- make arbitrary third-party processes trusted;
- promise exact RSS or directory quotas where macOS exposes only a weaker
  primitive;
- treat a monitor race, unsupported platform, or skipped probe as a pass; or
- begin P7.3, P7.4, P8, release, or distribution work.

## Review triggers

Revisit this design if Electron removes the utility-process metrics needed for
General Worker monitoring, macOS changes `setrlimit` or seatbelt semantics, a
Worker needs a child process or larger streaming payload, resource values must
be user-configurable, or P8 requires a platform adapter that cannot preserve
the same budget and failure contract.
