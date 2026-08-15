# ADR-0028: P7 Worker Resource and Process Reliability

- Status: Accepted
- Date: 2026-08-16
- Owners: Actestra Core, Main, Worker, Security, and Release
- Phase: P7.2 Worker resource and process reliability
- Related: [ADR-0006](0006-agent-adapter-lifecycle-and-supervision.md),
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md),
  [ADR-0024](0024-minimal-goose-acp-runner.md), and
  [ADR-0027](0027-p7-threat-model-and-abuse-authority.md)

## Context

P7.1 established Actestra's threat model and abuse-case authority, but the two
product Worker boundaries still needed explicit CPU, memory, active-duration,
output, storage, and process-tree limits. Those controls must extend the
existing mature boundaries rather than introduce another Worker framework,
sandbox, policy engine, approval system, or user interface.

This decision applies to the General Worker and Goose Worker only. The Electron
General Worker remains an isolated `utilityProcess`; Goose remains the pinned,
Actestra-built ACP runner launched through the existing macOS sandbox. Main and
Core remain the authority for admission, terminal evidence, and cleanup. The
frozen AionUI source under `foundation/` is unchanged.

## Decision

### 1. Main owns two immutable profiles

Main selects and freezes a product-owned profile for each attempt. Renderer,
Planner, provider input, General, and Goose cannot select or widen these values.
An unavailable enforcement primitive fails closed before launch as
`worker-resource-enforcement-unavailable`.

| Worker | Active duration | CPU | Memory | Output | Private storage | Child processes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| General | 10 minutes | 30 CPU seconds | 512 MiB private memory and a 256 MiB V8 heap cap | 96 KiB | 0 bytes owned directly | 0 |
| Goose | 30 minutes | 120 CPU seconds | 1 GiB address space | 256 KiB | 512 MiB aggregate and 64 MiB per file | 0 |

The active-duration clock pauses only while the existing human-decision gate is
held. Approval expiry remains independently bounded, and a pause does not widen
CPU, memory, output, storage, or process limits.

### 2. Existing process authorities perform enforcement

The General Worker keeps Electron `utilityProcess.fork`, adds the fixed V8 heap
argument, and is observed through a Main-owned monitor keyed by PID and process
creation time. Electron's macOS private-memory and CPU metrics feed the existing
supervisor terminal path. The Worker receives no filesystem, shell, network,
SQLite, or process-spawn authority.

The Goose Worker keeps the admitted runner, ACP protocol, process group, and
macOS `sandbox-exec` boundary. The runner applies `setrlimit` before ACP startup;
the production sandbox denies process fork/exec beyond the admitted runner.
Main-owned tool and publisher boundaries account for output and private-root
storage before and after effects. Storage inspection uses bounded `lstat`
traversal and rejects symbolic links; it does not add shell-based accounting.

### 3. Resource failures are closed, durable terminal outcomes

Only the following resource and process incident codes are admitted:

- `worker-resource-cpu-exceeded`;
- `worker-resource-memory-exceeded`;
- `worker-resource-output-exceeded`;
- `worker-resource-timeout`;
- `worker-resource-storage-exceeded`;
- `worker-process-tree-violated`; and
- `worker-resource-enforcement-unavailable`.

The first durable terminal outcome wins a concurrent breach/exit race. A breach
stops new effects, persists bounded incident evidence, uses the existing cleanup
path exactly once, and cannot become completed, unchanged, cancelled, or
retryable by default. Incident evidence contains only the Worker kind, attempt
identity, resource kind, bounded observed/limit counters, code, and sanitized
termination shape. It never contains prompts, model output, tool arguments,
credentials, environment values, private paths, or raw process output.

### 4. Scope and non-goals remain narrow

The Planner sidecar, SQLite persistence utility, Renderer and preload, AionUI
routes, user-configurable quotas, and the frozen foundation are outside P7.2.
P7.3 database backup/migration recovery and P7.4 diagnostic export/audit
retention remain independent batches. Windows and Linux enforcement and
physical acceptance remain P8 work. Unsupported or skipped probes are
unverified and cannot be counted as passing evidence.

## Consequences

### Positive

- Both existing product Workers have one reviewable, fail-closed resource
  contract without a second runtime or policy framework.
- Resource causes survive through supervisor, durable attempt evidence, Core
  events, and bounded projections instead of collapsing into generic success or
  cancellation.
- Hostile probes can verify the exact packaged Worker boundaries while remaining
  outside production manifests, package resources, and trust roots.

### Costs

- macOS metrics, `setrlimit`, and seatbelt behavior require packaged physical
  evidence in addition to deterministic unit tests.
- The fixed values can change only through a reviewed code, documentation, and
  evidence update.
- Windows and Linux require platform adapters that preserve the same contract
  before P8 can claim cross-platform enforcement.

## Rejected alternatives

### Add a second supervisor, sandbox, or resource daemon

Rejected because the existing Electron utility process, Goose runner,
Supervisor, Tool Gateway, sandbox, and cleanup paths already own the relevant
boundaries. A parallel framework would split authority and increase lifecycle
risk.

### Let users, providers, or Workers choose limits

Rejected because a caller-controlled quota is not an enforcement boundary and
would permit accidental or adversarial widening.

### Treat an unsupported metric or skipped hostile probe as success

Rejected because it would turn missing enforcement into false GREEN evidence.
The attempt or gate fails closed instead.

## Rollback

Rollback removes the resource profiles and monitor, General metrics wiring,
Goose native limits and fork denial, storage/output accounting, incident
mappings, hostile smoke, and this ADR. It does not alter SQLite schema or
require a data migration. The pre-existing supervision, Tool Gateway, approval,
worktree isolation, sandbox, protocol bounds, and redaction controls remain.

## Review triggers

Review this decision if Electron removes the required utility-process metrics,
macOS changes `setrlimit` or seatbelt semantics, a product Worker legitimately
needs child processes, fixed limits must change, a new Worker enters the product,
or a P8 platform adapter cannot preserve the same fail-closed vocabulary and
cleanup guarantees.
