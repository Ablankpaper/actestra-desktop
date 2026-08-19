# P8.2b Linux Runtime Composition Design

**Status:** Accepted by user on 2026-08-17

**Date:** 2026-08-17

**Baseline:** `codex/p8-2b-runtime-containment@11c44fe52c4db5aa25f9b79e44da971a87ec1010`

**Phase:** P8.2 — native package and runtime matrix

**Related:** [P8.2b Goose containment design](2026-08-17-p8-2b-goose-cross-platform-containment-design.md), [Linux process/resource equivalence design](2026-08-17-p8-2b-linux-process-resource-equivalence-design.md), [ADR-0028](../../architecture/decisions/0028-p7-worker-resource-and-process-reliability.md), and [ADR-0030](../../architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md)

## Purpose

The native Ubuntu 24.04 evidence now proves the Linux Goose runner's fixed
resource and process contract: `RLIMIT_CPU=120`, launch-baseline-plus-1-GiB
`RLIMIT_AS`, thread-aware x86-64 seccomp, and denial of non-thread process
creation and executable replacement. That evidence is necessary but is not a
production runtime composition. The runner still cannot be admitted on Linux,
because an isolated process must also reach exactly the two Main-owned bridges,
must be confined to the private root and admitted workspace, and must terminate
and clean up when Main disappears.

This slice defines that production composition for Ubuntu 24.04 x64 without
changing the existing AionUI, Main/Core, Tool Gateway, approval, persistence,
ACP, or Goose authorities. It does not enable Linux runtime admission by
itself. A later integration gate must prove the complete real ACP journey
before a containment record can become admissible.

## Current facts and boundary

- The runtime resolver remains Darwin-only. Windows and Linux fail before a
  private root or transport is created.
- Main already owns the authenticated HTTP MCP capability server and model
  server, the attempt lease, private-root preparation, process-group cleanup,
  and the artifact digest trust root.
- The Rust runner already owns fixed RLIMIT setup, the Linux seccomp installer,
  Landlock probe code, and Unix parent-liveness behavior.
- The native acceptance command returns only bounded closed diagnostics and
  deliberately keeps `complete = false`; no partial probe output may be bound
  to a manifest.
- The previous cgroup-v2 feasibility assumption is removed. This slice must
  not reintroduce cgroup mutation, `sudo`, a root daemon, a setuid helper, a
  container runtime, or a second supervisor.

## Goals

1. Run the existing Goose ACP executable in a rootless Linux user, mount, and
   network namespace.
2. Preserve Goose's existing HTTP-facing configuration while allowing access
   only to the two authenticated Main-owned sessions.
3. Apply the existing Landlock rules in production: read/write only inside the
   attempt private root and read/execute only inside the admitted workspace.
4. Retain the already verified RLIMIT and seccomp behavior and install all
   process controls before any runner-created thread.
5. Make parent death, cancellation, crash, and cleanup observable as bounded
   terminal outcomes with no private-root or socket residue.
6. Produce native Ubuntu evidence that is exact-artifact and digest-bound while
   keeping Linux admission disabled until the subsequent ACP integration gate.

## Non-goals

- No Windows implementation in this slice; Windows remains fail closed.
- No changes under `foundation/`, no AionUI shell replacement, and no
  Renderer/preload authority expansion.
- No new provider, credential, policy, approval, persistence, or supervisor
  authority.
- No arbitrary URL forwarding, host-network fallback, broad localhost access,
  user-configurable limits, or hidden YOLO mode.
- No General Worker portability, installer, signing, SBOM, update, clean-machine,
  release, deployment, or user-acceptance work.
- No change to `complete=false` or to the Darwin-only runtime resolver during
  this slice.

## Invariants

The following are hard requirements. If any one cannot be proven on the native
Ubuntu target, setup and acceptance fail closed:

| Area | Required invariant |
| --- | --- |
| Target | Exact `x86_64-unknown-linux-gnu` admitted executable and manifest digest |
| Filesystem | Private root is writable; admitted workspace is read/execute only; `/etc`, arbitrary host paths, traversal, symlink escape, and workspace writes are denied |
| Network | No host interface or external DNS/TCP/HTTP is reachable; only the two per-attempt Main bridge sessions are reachable through the private relay |
| Process | Required in-process Tokio threads work; fork/clone of a new process/vfork/exec remain denied |
| Resources | Fixed CPU and address-space limits remain exact and non-widenable |
| Parent death | Main disappearance terminates the runner and its process group, including relay tasks |
| Cleanup | Main and runner close sockets and remove the private root idempotently; no owned residue remains |
| Authority | Main retains lease, capability, model, artifact, workspace, approval, and audit authority; the runner only transports bytes and runs ACP |

## Architecture

### Main-owned bridge endpoints

For each attempt, Main creates two Unix-domain socket endpoints below the
canonical private root, with restrictive permissions and unpredictable names:

- one endpoint for the existing MCP capability HTTP server;
- one endpoint for the existing model HTTP server.

The HTTP handlers and their existing Bearer lease/session checks remain the
authority. The Unix socket is only a local transport. Main passes the socket
paths, the already admitted loopback port numbers, the canonical workspace
root, and the opaque attempt lease through a strict runner-owned environment
contract. No credential, provider URL, renderer value, or arbitrary endpoint is
added to that contract.

The two existing Goose URLs remain unchanged from Goose's point of view:
`http://127.0.0.1:<capability-port>` and
`http://127.0.0.1:<model-port>`. The port numbers are already known to Main and
are free inside the new network namespace.

### In-runner HTTP relay

Before ACP starts, the Rust runner binds the two supplied ports on the
namespace-local loopback device. Each listener forwards raw bounded HTTP
request/response bytes to exactly one inherited Main Unix socket. The relay:

- accepts only IPv4 loopback connections;
- has one fixed socket-to-service mapping and no caller-selected destination;
- applies the existing frame, header, body, and timeout bounds;
- never opens an external TCP/UDP connection;
- does not inspect, rewrite, log, or persist credentials or model content; and
- shuts down with the runner and reports only a fixed bridge failure marker.

This preserves the mature Goose HTTP protocol and the existing Main server
validation without granting the worker host-loopback access. A relay failure
before ACP initialization is a pre-admission `network-policy-unavailable`
outcome; it must not be converted into a successful or unchanged task.

### Linux setup order

The production runner follows this order, with no untrusted ACP code or worker
thread before the controls are in place:

```text
validate bounded environment and parent identity
  -> set PR_SET_PDEATHSIG and close the parent-death race
  -> apply exact RLIMIT_CPU / RLIMIT_AS
  -> unshare rootless user + mount + network namespaces
  -> bring up namespace loopback only; verify no external interface
  -> apply Landlock private-root/workspace rules
  -> install thread-aware seccomp
  -> create the bounded relay and its Tokio runtime
  -> start the existing parent-liveness watcher
  -> start Goose ACP
```

`PR_SET_PDEATHSIG(SIGTERM)` is set before namespace creation because a
multi-threaded process cannot safely unshare the required namespaces. The
existing inherited liveness pipe remains as a second signal and lets the
watcher perform the established process-group termination path after the
runtime is initialized. The parent identity is checked immediately after
setting the death signal; a race or missing handle fails closed.

The seccomp filter is installed before the relay runtime creates any thread.
The relay may use the existing Tokio dependency but is not a second supervisor:
it has no admission, retry, persistence, policy, or cleanup authority.

### Filesystem boundary

The existing rootless user/mount namespace setup and Landlock rules are reused
and moved from probe-only code into the production setup path. The ruleset
allows all required access beneath the private root, read/execute access beneath
the admitted workspace, and no other path. Socket endpoints are created inside
the private root before restriction. ABI, mapping, ruleset, canonical-path,
symlink, and cleanup failures use fixed diagnostics and never cross the Node
boundary as raw OS errors or paths.

### Cleanup and ownership

Main remains the final owner of the private root. Every setup stage has one
idempotent cleanup path:

1. close ACP and relay listeners;
2. terminate the process group on cancellation, crash, or parent death;
3. close Main's Unix sockets;
4. remove the private root and verify it no longer exists;
5. preserve the first terminal failure cause and any cleanup failure as the
   existing bounded `cleanup-failed` outcome.

Repeated close calls must share one promise. A failed setup before a transport
exists must still remove sockets and the private root. No cleanup result may be
projected as `completed`, `unchanged`, or `cancelled` when a required cleanup
step failed.

## Failure vocabulary and redaction

The public Main error vocabulary remains intentionally narrow:

- `network-policy-unavailable` for missing or unverifiable Linux containment or
  bridge setup before admission;
- `worker-resource-enforcement-unavailable` for the existing native resource
  marker;
- `spawn-failed` for an admitted process that cannot complete its bounded
  launch; and
- `cleanup-failed` when any process, socket, or private-root cleanup fails.

Native diagnostics use a closed `linux-*` stage vocabulary, for example
`linux-user-namespace-unavailable`, `linux-loopback-unavailable`,
`linux-landlock-unavailable`, `linux-bridge-unavailable`,
`linux-parent-death-unavailable`, and `linux-cleanup-failed`. Unknown failures
collapse to `linux-containment-unavailable`. No raw errno, path, socket name,
environment value, token, request body, or provider output is persisted,
uploaded, or returned to Renderer.

## Evidence and admission gate

The native probe must use the same namespace, Landlock, relay, parent-death,
and cleanup functions as production. It must prove:

1. private-root read/write and workspace read/execute behavior;
2. host-path, traversal, symlink, workspace-write, external-network, and
   unrelated-localhost denial;
3. an authenticated round trip through each Main-style Unix socket and its
   namespace-local loopback port;
4. required thread creation plus process/exec denial;
5. exact RLIMIT values and non-widenability;
6. parent death terminates the child and relay; and
7. duplicate cleanup leaves no filesystem or process residue.

The probe output keeps the six existing booleans and closed diagnostics. During
this slice `complete` remains false even if the native primitive checks pass,
because the real Main-to-Goose ACP composition is verified by a separate
integration command. No script may write a `containment` manifest record from
this partial result. The runtime resolver remains Darwin-only until the
integration gate proves the exact Artifact, bridge, ACP lifecycle, and terminal
paths together.

## Testing strategy

### Pure and source-contract tests

- Exact environment key set, canonical path rules, socket-to-port mapping,
  bounded relay limits, and no unknown setup fields.
- Startup-order assertions: PDEATHSIG and namespace setup precede threads;
  seccomp precedes Tokio; ACP starts only after relay listeners are ready.
- Main tests prove bridge/setup rejection happens before `mkdtemp`, transport
  creation, or provider/model invocation.
- Cleanup tests cover setup failure, handshake failure, cancellation, duplicate
  close, parent death, and private-root removal failure.

### Native Ubuntu probe

The exact admitted `x86_64-unknown-linux-gnu` artifact runs the hostile probe
on `ubuntu-24.04`. The job remains separate from build-only and Goose admission
jobs, receives no provider credentials, uploads only success-only bounded
metadata, and exits nonzero for incomplete or unsupported evidence.

### Real ACP integration

After the primitive probe is green, a deterministic authenticated Main loopback
fixture exercises `initialize`, `open-session`, one bounded prompt, tool denial,
cancellation, crash/restart, parent death, and cleanup. This fixture proves
transport and lifecycle semantics only; it is not real-provider acceptance.

## Rollback and remaining gates

If any Linux setup or native probe fails, remove the Linux adapter invocation
and retain the existing pre-root `network-policy-unavailable` stop. No schema
or user-data migration is needed. The branch must not bind partial evidence or
enable Linux runtime as a convenience fallback.

This slice does not close P8.2b. It leaves Windows Job Object/restricted
identity/bridge work, packaged Electron journeys, candidate integrity (P8.3),
and clean-machine internal acceptance (P8.4) for their own gates.

## Self-review

- No cgroup, root, helper, second supervisor, or host-network fallback appears
  in the design.
- The relay is a transport adapter only; Main retains all product authority.
- `complete=false`, Darwin-only resolution, and fail-closed behavior are
  explicit in every stage.
- The design distinguishes native primitive evidence from real ACP integration
  and from later packaged/user acceptance.
- No placeholder or unbounded error path is required.
