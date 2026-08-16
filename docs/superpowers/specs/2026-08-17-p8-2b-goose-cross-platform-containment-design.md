# P8.2b Goose Cross-Platform Containment Design

**Status:** Proposed; pending user review

**Date:** 2026-08-17

**Baseline:** `main@1ef7f957bf5c097b5339d9980d084c871808726f`

**Phase:** P8.2 — native package and runtime matrix

## Purpose

P8.2a proved that the pinned Actestra Goose runner can be built and admitted
for the three P8 target families. It deliberately did not grant Windows or
Linux runtime authority. P8.2b supplies the missing runtime-containment
foundation without replacing the existing AionUI, Main/Core, Tool Gateway,
ACP, persistence, approval, or Goose boundaries.

The deliverable is a platform-native containment contract that can be proved
before a Goose attempt is admitted. A platform is not admitted merely because
its executable compiles, an Electron package launches, or a test is skipped.
If any required primitive cannot be proved on the target, the existing
fail-closed result remains in force and that target is recorded as
`unsupported-platform` or `evidence-incomplete`.

This specification covers the Goose runtime foundation only. General Worker
adaptation, full packaged product journeys, candidate signing, and clean-
machine acceptance remain separate P8.2/P8.3/P8.4 work after this gate.

## Baseline facts

The accepted P8.2a source already has one closed build-target table for:

- `aarch64-apple-darwin` and `x86_64-apple-darwin` build identities;
- `x86_64-pc-windows-msvc`; and
- `x86_64-unknown-linux-gnu`.

The runtime resolver intentionally returns only the Darwin target. The Main
launcher currently rejects Windows and Linux before creating an attempt-private
root or transport. The transport uses macOS `sandbox-exec`, while the Rust
runner applies Unix resource limits and watches a Unix parent-liveness file
descriptor. Windows resource enforcement and parent-liveness are currently
explicitly unavailable. These are correct fail-closed non-claims and are the
starting point for this batch.

## Goals

1. Preserve one Actestra Goose ACP runner and one Main-owned admission path.
2. Give each accepted platform an independently testable containment adapter.
3. Enforce the same protected outcomes on every admitted platform:
   - no arbitrary external network;
   - only the explicitly bound Main capability/model transport;
   - reads and writes limited to the private attempt root plus the already
     admitted coding workspace;
   - no unapproved fork/exec or process-tree escape;
   - the fixed P7 CPU, memory, output, storage, and duration budgets;
   - parent-death termination and complete private-root cleanup.
4. Keep all platform-specific setup behind Main/Rust worker boundaries, never
   in Renderer or preload.
5. Produce native hostile evidence, not just string or unit-test evidence.
6. Keep the current macOS behavior byte- and semantically stable unless a
   regression test demonstrates an unavoidable shared-contract correction.

## Non-goals

- No changes to `foundation/` or import of another application shell.
- No second policy engine, approval service, persistence authority, or Worker
  framework.
- No user-selectable sandbox, quota, network, or resource settings.
- No unsandboxed Windows/Linux fallback, inherited environment fallback, or
  YOLO mode.
- No expansion of the P8 target matrix, package formats, or architectures.
- No claim that a loopback-provider fixture is a real third-party provider.
- No packaging, signing, update, release, deployment, or clean-machine gate in
  this design batch.

## Authority topology

The existing authority ownership remains unchanged:

```text
Main admission
  -> immutable GooseContainmentLaunch contract
  -> platform adapter / native runner setup
  -> one admitted Goose ACP process
  -> Main-owned MCP and model loopback bridges
  -> existing Tool Gateway, approval, persistence, and cleanup paths
```

Main is the only component allowed to derive the target, artifact digest,
private root, workspace grant, proxy ports or sockets, resource profile, and
parent-liveness token. The worker receives an immutable, bounded launch
description. Renderer and preload receive only existing projections and typed
intents.

The platform adapter is a containment implementation detail, not a new
authority. It may be compiled into the existing Rust runner or be a tiny
Actestra-owned launcher required by an OS API, but it must not become a second
general-purpose supervisor. Any additional executable must be included in the
same exact artifact manifest, SBOM, license evidence, digest admission, and
cleanup contract as the existing runner.

## Shared launch contract

Before an attempt root is created, Main constructs a frozen contract with
exactly the following semantic fields:

| Field | Authority and constraint |
| --- | --- |
| target triple and executable digest | resolved from admitted artifact; never caller supplied |
| private root | canonical Main-created directory below the owned attempt parent |
| workspace root | canonical Team workspace/worktree grant, if present |
| network mode | `deny-all` or one authenticated loopback session |
| capability/model endpoints | Main-owned per-attempt bridge, never arbitrary URL |
| resource profile | exact immutable P7 Goose profile |
| parent-liveness handle | Main-created pipe/socket/job association |
| protocol limits | existing ACP frame, stdout, stderr, and timeout bounds |

Unknown fields, mutable objects, non-canonical paths, non-loopback endpoints,
target mismatches, widened budgets, or missing parent-liveness data reject the
attempt before any worker process or private root is exposed.

The transport bridge is deliberately narrow. The worker may send only the
existing authenticated MCP/model HTTP protocol through the per-attempt local
bridge. The bridge performs no arbitrary URL forwarding and does not grant the
worker access to the host network. On platforms where an isolated network
namespace or AppContainer cannot directly reach a host loopback port, the
adapter may expose a local TCP endpoint inside the sandbox backed by an
inherited Unix socket or Windows named pipe to Main. The bridge must preserve
the existing lease, capability, redaction, and audit checks; it is not a second
provider or policy boundary.

## Platform adapters

### macOS

Keep the existing `sandbox-exec` profile and Rust Unix resource/parent-death
implementation as the reference contract. The adapter must continue to prove:

- deny-by-default network with only the two authenticated loopback ports;
- no process fork and no arbitrary executable launch;
- private-root writes and admitted workspace reads only;
- fixed `RLIMIT_CPU` and address-space growth limits;
- process-group termination and private-root removal.

This batch may extract the shared launch contract from the current code, but it
must not relax the established profile or reinterpret existing macOS evidence.

### Windows 11 x64

The feasibility gate must evaluate the following native composition:

1. A Windows Job Object with kill-on-job-close, active-process limits, and the
   fixed CPU/memory limits. Every descendant must remain in the same job.
2. A restricted process identity (AppContainer or an equivalently narrow
   token/ACL design) that permits the private root and explicitly admitted
   workspace only. The design must not rely on a broad user-profile or
   `Everyone` ACL.
3. Default-deny network behavior with a per-attempt Main bridge. A blanket
   loopback exemption is not acceptable evidence because it exposes unrelated
   local services. If AppContainer loopback semantics cannot be narrowed to the
   authenticated bridge, the native probe must fail closed rather than enable
   host networking.
4. A parent-death association that terminates the entire Job Object and leaves
   no runner or descendant behind when Main exits unexpectedly.

The adapter may use a small Actestra-owned native launcher to create the Job
Object, restricted token, and bridge before the Goose runner starts. That
launcher is not a new Worker framework and must be admitted and cleaned up as
part of the same runner artifact. A Node-only approximation based on
`child.kill()` is not sufficient.

### Ubuntu 24.04 x64

The feasibility gate must evaluate one unprivileged, packaged composition of:

1. a private mount/user namespace or an equivalent rootless filesystem view;
2. Landlock (or a kernel-supported equivalent) for explicit private-root and
   workspace path rules;
3. seccomp or an equivalent syscall policy denying arbitrary process creation,
   privilege escalation, and unapproved network operations;
4. cgroup v2 or an equivalent native controller for the fixed CPU, memory,
   process-count, and cleanup limits; and
5. a per-attempt local bridge. If a network namespace is used, the bridge must
   work without host networking or elevated privileges, commonly through an
   inherited Unix socket and a local in-namespace endpoint.

The implementation must not require setuid helpers, a root daemon, Docker, or
an unpinned distribution-specific sandbox binary. If Ubuntu's kernel or the
packaged runtime cannot provide one of these primitives with deterministic
evidence, admission remains fail-closed.

## Feasibility gate

The first implementation slice is native probes, not product launch. Each
probe runs on its actual target OS and emits only bounded metadata:

- target identity and runner/artifact digest;
- primitive availability and exact result classification;
- booleans for each forbidden effect;
- bounded exit/termination shapes and resource counters;
- cleanup residue count and private-root ownership result.

The probe must actively attempt each forbidden effect from inside the admitted
worker:

| Probe | Required safe result |
| --- | --- |
| external DNS/TCP/HTTP | denied; no request reaches external network |
| unrelated localhost service | denied; only Main bridge works |
| host profile/private path read | denied |
| outside-root write or symlink traversal | denied |
| fork/exec/child escape | denied and terminalized |
| CPU/memory/process widening | bounded and terminalized |
| parent termination | worker tree terminates, no orphan remains |
| cleanup | private root and launcher residue removed exactly once |

A probe that cannot distinguish denial from a missing test, a skipped platform,
or a permissive fallback is `evidence-incomplete`, never `verified`.

## Runtime integration gate

Only after a target's feasibility probes pass may the shared runtime resolver
return that target. Integration then proceeds in this order:

1. add a failing Main test proving the target is rejected before private-root
   creation while its containment adapter is absent;
2. implement the smallest adapter needed by the native probe;
3. admit the exact artifact and launch a real ACP handshake;
4. run the authenticated loopback MCP/model path and one bounded Goose tool;
5. exercise denial, cancellation, crash/restart, parent-death and cleanup
   paths; and
6. record target-specific evidence without reusing macOS results.

The existing `network-policy-unavailable`,
`worker-resource-enforcement-unavailable`, `spawn-failed`, and
`cleanup-failed` vocabulary remains authoritative. A new code may be added
only if the existing durable incident mapper cannot preserve a distinct cause;
it must be added to the shared contract, UI localization, tests, and
documentation together.

## Test-first file boundaries

The implementation plan must keep changes bounded to these areas:

- `apps/desktop/src/main/workers/` — shared contract, target resolver, and
  platform launch adapter;
- `workers/goose-runner/` — `cfg`-gated native resource, parent-liveness, and
  bridge setup;
- `tests/main/` — contract, lifecycle, artifact, and cleanup regressions;
- `tests/security/` or `scripts/` — native hostile probes and redacted evidence;
- `.github/workflows/` — target-native feasibility/runtime jobs only;
- source-of-truth docs and the P8 status ledger.

No Renderer, preload, `foundation/`, AionUi generated source, or unrelated
product module is in scope.

Every behavior change follows RED → GREEN → REFACTOR. A test must first fail
for the missing containment behavior on the current code. A unit test alone is
not sufficient for a platform security claim; the corresponding native probe
must execute on the target OS.

## Acceptance and rollback

P8.2b is accepted only when:

1. the shared launch contract rejects all widened or ambiguous inputs;
2. macOS regression tests remain green with unchanged containment semantics;
3. Windows and Ubuntu native probes independently verify all rows in the
   feasibility table, or remain explicitly fail-closed with a documented
   blocker (which keeps this gate open);
4. an admitted target completes a real ACP handshake and authenticated
   loopback transport without external network or host-path access;
5. parent-death, cancellation, crash, and cleanup leave no owned residue;
6. exact artifact, manifest, SBOM, license, and digest admission still passes;
7. native CI evidence is bound to the exact source commit and target artifact;
8. `bun run check`, foundation/downstream/boundary checks, and `git diff --check`
   pass; and
9. the result is reviewed through a pull request and merged-main CI before the
   target is called admitted.

If a platform adapter fails, rollback is to remove its runtime admission and
retain the existing pre-root `network-policy-unavailable` stop. No persisted
product migration is needed, and no package or UI fallback is introduced.

## Open feasibility questions

These are implementation questions for the native probe, not permission to
weaken the contract:

- Can Windows AppContainer/Job Object networking reach only the authenticated
  bridge without a broad loopback exemption?
- Can Ubuntu 24.04 provide the required Landlock, namespace, seccomp and cgroup
  behavior in the packaged user context without root or setuid helpers?
- Can the bridge preserve the current HTTP-facing Goose configuration while
  using an inherited local IPC channel under isolated networking?

An answer of “no” to any question leaves that target fail-closed and is
reported as an unclosed P8.2 obligation; it is not silently replaced by a
weaker primitive.
