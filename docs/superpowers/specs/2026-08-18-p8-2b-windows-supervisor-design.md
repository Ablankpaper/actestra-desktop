# P8.2b Windows Goose Supervisor Design

**Status:** Architecture approved; written specification pending review

**Date:** 2026-08-18

**Baseline:** `codex/p8-2b-runtime-containment@56b04bf2effc9c39ceb08fb597f3c5963fffb441`

**Phase:** P8.2b — Windows 11 x64 Goose runtime containment

**Related:**

- [P8.2b Goose cross-platform containment design](2026-08-17-p8-2b-goose-cross-platform-containment-design.md)
- [P8.2b Goose containment implementation plan](../plans/2026-08-17-p8-2b-goose-containment.md)
- [ADR-0024: Minimal Goose ACP runner](../../architecture/decisions/0024-minimal-goose-acp-runner.md)
- [ADR-0028: Worker resource and process reliability](../../architecture/decisions/0028-p7-worker-resource-and-process-reliability.md)
- [ADR-0030: P8 cross-platform internal beta acceptance](../../architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md)

## Purpose

The exact Windows Goose runner already builds and passes Artifact admission,
but its containment backend deliberately returns unavailable. The exact-head
Windows containment job therefore ends with `evidence-incomplete`. This is the
correct fail-closed state: compilation is not proof that an untrusted coding
worker is safely runnable.

This specification closes the missing Windows architecture decision. The one
admitted `actestra-goose-runner.exe` binary operates in two fixed modes:

1. a trusted supervisor mode that creates Windows containment before any Goose
   code runs; and
2. a capability-free AppContainer worker mode that runs the existing Goose ACP
   server.

The supervisor is an operating-system adapter inside the existing runner, not
a second Worker framework, policy engine, UI, or persisted authority. Windows
runtime admission remains disabled until the exact emitted executable passes
the native hostile probe and its bounded evidence is bound into the existing
Artifact manifest.

## Current facts

- `workers/goose-runner/src/containment/windows.rs` validates the fixed resource
  environment and then returns `Err(())`.
- the Windows containment probe returns `unsupported-platform`, which the
  acceptance script correctly converts to `evidence-incomplete`;
- Main has no admitted Windows executable authority or Windows process launch
  branch;
- the existing ACP protocol uses bounded stdin/stdout while model and MCP
  access use two Main-owned, per-attempt authenticated endpoints;
- `windows-sys 0.61.2` is already present transitively in `Cargo.lock`, but the
  runner does not directly declare or use it; and
- Ubuntu and macOS evidence cannot be reused for Windows.

## Goals

1. Start the Windows worker only after its identity, Job Object, filesystem
   ACLs, bridge, resource limits, and parent-death behavior are ready.
2. Keep one admitted executable, one manifest, one SBOM, one source pin, and
   one Main/Core/Tool Gateway authority chain.
3. Deny the worker host network and loopback completely while allowing only the
   two existing authenticated Main semantics through bounded named pipes.
4. Restrict filesystem access to the attempt-private root and admitted isolated
   coding worktree; the original source checkout remains outside the worker
   boundary.
5. Keep the worker and every descendant inside one Job Object with fixed P7
   CPU, memory, process-count, lifetime, and cleanup outcomes.
6. Terminate the whole job when Main disappears, the supervisor crashes, the
   worker violates the contract, or bounded shutdown fails.
7. Produce exact-executable Windows evidence without paths, prompts, tokens,
   provider credentials, or other private payloads.

## Non-goals

- No General Worker portability, Windows Electron installer, signing, update,
  release, deployment, or clean-machine acceptance in this slice.
- No edits under `foundation/`, Renderer, preload, or generated AionUI output.
- No new Goose/Eigent application UI and no second agent runtime.
- No ordinary-user sandbox settings, network exceptions, resource controls,
  container choices, or fallback mode.
- No Windows service, administrator requirement, Docker/VM dependency, global
  firewall mutation, or persistent loopback exemption.
- No restricted-token-only fallback when AppContainer setup is unavailable.
- No trust in a probe sidecar that is not bound to the admitted executable and
  manifest.

## Approaches considered

### Selected: the same executable in supervisor and worker modes

Main launches the admitted runner in supervisor mode. The supervisor creates a
Job Object, a unique capability-free AppContainer identity, narrow ACLs, named
pipes, and a suspended second instance of the same executable. It assigns that
worker to the Job Object before resuming it and forwards ACP bytes without
interpreting them.

This keeps containment setup before untrusted code, preserves one binary and
trust chain, and gives Windows native APIs a stable owner.

### Rejected: let Electron Main launch Goose directly

Node `child_process` does not expose the complete ordered sequence needed to
create a capability-free AppContainer process suspended, restrict inherited
handles, assign it to a configured Job Object, verify the identity, and only
then resume it. Reimplementing that boundary in an Electron native addon would
add a second native artifact and make Main own low-level forwarding logic.

### Rejected: a separate launcher, service, or helper package

A second executable can perform the Windows calls, but it creates another
manifest/SBOM/signing/admission/cleanup surface and risks becoming a second
Worker framework. A privileged service would also exceed the P8 target and
least-privilege contract.

### Rejected: restricted token without AppContainer

A restricted token can remove privileges and narrow filesystem ACL checks, but
it does not independently establish default-deny network behavior. Pairing it
with global firewall rules or a broad loopback exemption would add mutable host
state and still expose unrelated local services. The accepted worker identity
is therefore a capability-free AppContainer; failure to create or verify it is
a closed setup failure.

## Process topology

```text
Electron Main
  | exact artifact + bounded launch contract
  | ACP stdio + parent-liveness/control + model/MCP bridge handles
  v
actestra-goose-runner.exe --actestra-windows-supervisor-v1
  | owns Job Object, AppContainer profile, ACLs and named-pipe servers
  | creates the same admitted image suspended
  v
actestra-goose-runner.exe --actestra-windows-worker-v1
  | verifies AppContainer + Job + handles before Tokio/Goose
  | Actestra provider adapter + builtin MCP adapter -> named pipes
  v
existing Goose ACP server and tool protocol
```

The supervisor never emits ACP data of its own. It copies Main stdin to worker
stdin and worker stdout to Main stdout byte-for-byte. Worker stderr is copied
to supervisor stderr so the existing bounded fixed-marker parser remains the
only Main-facing diagnostic boundary.

## Exact modes and bootstrap protocol

On Windows the executable accepts exactly these production modes:

- `--actestra-windows-supervisor-v1`
- `--actestra-windows-worker-v1`
- the existing exact containment-probe mode used by the native CI harness

Unknown, duplicated, or combined modes exit nonzero before Tokio or Goose is
constructed. Running the executable without the supervisor mode does not start
an unsandboxed Windows Goose session.

Main passes the supervisor launch contract through a dedicated inherited
control handle, not through variable command-line values. The command line
therefore contains no root path, endpoint, lease, or credential. The control
message is versioned, length-prefixed, bounded to 32 KiB, consumed once, and
contains exactly:

- contract version and target triple;
- exact executable digest and private-copy path;
- canonical private root and isolated worktree paths;
- the fixed P7 resource profile;
- the exact model identity and opaque attempt lease;
- inherited ACP, parent-liveness, and control handle identities; and
- one random 128-bit attempt identifier used only to derive local object names.

The supervisor validates every field against the environment, its own admitted
image, canonical paths, fixed budgets, and inherited handle list. It rejects
unknown keys, overlong fields, a root path, a device path, alternate data
stream syntax, a reparse-point escape, ambiguous handles, or a digest mismatch.

The worker receives a second bounded control message through an inherited
read-only handle. Its command line contains only the fixed worker mode. Raw
provider credentials are never sent; the worker receives only the existing
per-attempt model/capability lease.

## One admitted executable

The supervisor runs from the exact Artifact admitted by Main. Before creating
the AppContainer, Main copies the same executable bytes into a read-only
`bin` directory below the attempt-private root and verifies the copy against
the admitted SHA-256 digest. The supervisor starts that private copy in worker
mode. The AppContainer can read and execute the copy but cannot modify the
`bin` directory, manifest, or admission evidence.

This is still one binary product and one source/manifest/SBOM identity. The
private copy avoids mutating ACLs on the installed application resources and
prevents a worker from changing the supervisor image used by another attempt.

## Mandatory AppContainer identity

The supervisor creates one unique per-attempt AppContainer profile whose name
is derived from the random attempt identifier, not from a path, team name,
prompt, provider, or lease. A pre-existing profile with the same name is a
collision and fails closed; it is not reused.

The worker starts with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES` and:

- the exact derived AppContainer SID;
- an empty capability list;
- no internet, private-network, enterprise-authentication, broad-file-system,
  package-family, or loopback capability; and
- no inherited handle outside the explicit handle allowlist.

The worker's first native check verifies `TokenIsAppContainer`, the exact
AppContainer SID, low-integrity/AppContainer state, membership in the expected
Job Object, and the exact inherited handles. A missing or widened property
emits the existing network/resource setup marker and exits before relay or ACP
startup. There is no normal-token retry.

## Filesystem boundary

The private root has separate ACL domains:

| Area                                                      | Worker access                               |
| --------------------------------------------------------- | ------------------------------------------- |
| `bin/` and admission metadata                             | read/execute only                           |
| `home/`, `tmp/`, and Goose private state                  | read/write/delete                           |
| bridge/control objects                                    | only the exact handles and named pipes      |
| admitted isolated worktree                                | access already required by the coding grant |
| original source checkout and all other user/profile paths | no access                                   |

The supervisor creates explicit DACLs for the exact AppContainer SID and the
owning Actestra user; it never grants `Everyone`, `Authenticated Users`, or
`ALL APPLICATION PACKAGES`. Before worker resume it canonicalizes each path,
rejects root/device/UNC paths outside the admitted contract, walks every
existing component for reparse points, and verifies the resulting ACL.

The isolated worktree remains the only coding workspace. The AppContainer does
not gain access to the original repository merely because both are owned by
the same Windows user. Junction, symlink, alternate-data-stream, short-name,
and case-folding escapes are native hostile-probe requirements.

## Job Object ownership and resource limits

The supervisor creates and configures a non-inheritable Job Object before the
worker process exists. It sets:

- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`;
- `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION`;
- the exact active-process limit derived from the fixed P7 Goose profile;
- an aggregate job-memory limit equal to the fixed private-memory budget;
- an aggregate job user-time limit equal to the fixed CPU-seconds budget; and
- UI restrictions that deny clipboard, desktop, display, global-atom, handle,
  system-parameter, and window-system access not needed by ACP.

The supervisor creates the worker with `CREATE_SUSPENDED`,
`EXTENDED_STARTUPINFO_PRESENT`, `CREATE_UNICODE_ENVIRONMENT`, and
`CREATE_NO_WINDOW`. It assigns the worker to the configured Job Object, queries
the assignment and limits back from the kernel, installs completion/exit
observation, and only then resumes the primary thread.

The custom Unicode environment block contains only one sorted entry,
`SystemRoot=<trusted Windows directory>`, obtained by the supervisor through
`GetWindowsDirectoryW` and terminated by the required second NUL. The
supervisor neither inherits nor enumerates the parent environment, and no
environment value is written to diagnostics.

No breakaway flag is permitted. A descendant is allowed only when the existing
Goose/tool contract creates it and the Job Object admits it within the fixed
active-process ceiling; every descendant remains accounted to the same job.
Failure to assign a nested job on a supported Windows 11 host terminates the
suspended worker and keeps Windows runtime admission closed.

The supervisor itself remains outside the worker job so it can observe and
terminate it. It cannot outlive Main because of the parent-liveness handle.

## Main bridge and named-pipe security

The AppContainer receives no host-network capability. The supervisor creates
exactly two per-attempt named-pipe servers below
`\\.\pipe\LOCAL\Actestra.Goose.`: one for the existing capability semantics and
one for the model semantics. The remaining name contains only a random
attempt-derived identifier and purpose suffix; name secrecy is not an
authorization boundary. Main and the supervisor communicate through two
dedicated inherited bridge handles that are never exposed to the worker. The
supervisor performs bounded byte forwarding between each inherited handle and
its matching named pipe.

Each pipe uses:

- an explicit DACL for the exact AppContainer SID and owning Actestra user SID;
- `PIPE_REJECT_REMOTE_CLIENTS` and `FILE_FLAG_FIRST_PIPE_INSTANCE`;
- byte mode, at most eight concurrent connections, 256 KiB per direction, and
  a 30-second connection deadline;
- client PID/token verification through named-pipe impersonation; and
- a check that the connecting process belongs to the supervisor's Job Object.

The worker does not start a TCP listener and does not receive `OPENAI_BASE_URL`
or an HTTP MCP URL. Windows blocks AppContainer loopback by default; relying on
`CheckNetIsolation`, `privateNetworkClientServer`, a firewall exception, or a
self-loopback assumption would widen or mutate host authority and is therefore
explicitly forbidden.

Instead, worker mode uses two public Goose extension points without editing the
pinned Goose source:

1. it constructs `GooseAcpAgent` with an Actestra-owned `Provider`
   implementation whose only transport is the model named pipe; and
2. it registers one Actestra builtin MCP extension whose Tokio duplex streams
   are copied to the capability named pipe.

The model adapter translates the public Goose message/tool types to a
versioned, length-prefixed Actestra model-bridge envelope. Main validates that
envelope and invokes the already admitted `ActestraMainModelBrokerPort`; the
response contains only the normalized text/tool-call/usage result already
accepted at that boundary. The adapter does not select a provider, hold a real
provider credential, normalize a gateway response, or make completion-policy
decisions.

The MCP adapter forwards the existing MCP JSON-RPC byte stream and does not
implement tools. Main's existing capability handler, lease checks, Tool
Gateway, approvals, audit, and bounded tool results remain authoritative. On
Windows Main does not advertise the HTTP MCP endpoint to Goose; it enables only
this fixed builtin extension.

Both bridge protocols authenticate the opaque attempt lease and use exact-key,
versioned, bounded frames. Cross-platform conformance vectors must prove that
the Windows provider/MCP adapters produce the same model invocation, tool
surface, rejection, and terminal outcomes as the accepted loopback path. The
worker has no network capability at all, so localhost, LAN, DNS, and internet
attempts must all be denied.

The model pipe frame is a little-endian `u32` byte length followed by one UTF-8
JSON object, with a maximum payload of 2 MiB. A request has exactly
`contractVersion`, `kind`, `requestId`, `lease`, and `invocation` keys; `kind` is
`completion`, `requestId` is a bounded opaque identifier, and `invocation` is
the existing `ActestraMainModelInvocation` shape (`sessionId`, `purpose`,
`messages`, `tools`, and `responseMode`). A response has exactly
`contractVersion`, `kind`, `requestId`, and one of `completion` or `error`;
`completion` is the existing `ActestraMainModelCompletion` shape and `error`
is one of the existing bounded model-bridge failure codes. A cancel frame has
exactly `contractVersion`, `kind`, `requestId`, and `lease`. Main rejects a
second outstanding request, an unknown key, a mismatched lease/request ID,
invalid bounded JSON, or a frame over the limit before invoking the broker.

The capability pipe carries the existing MCP JSON-RPC message framing through
the same `u32` length ceiling and a 256 KiB per-direction aggregate bound. It
does not accept a second method, destination, or authentication scheme. A
closed pipe cancels the corresponding Goose turn and is terminalized through
the existing worker failure mapping.

## Parent death, crash, and cleanup

Main owns an inherited parent-liveness pipe. The supervisor continuously waits
for EOF, broken-pipe, cancellation, or Main-side closure. Any of those events
causes this ordered shutdown:

1. stop accepting named-pipe clients and close the worker stdin;
2. allow the existing bounded graceful-close interval;
3. call `TerminateJobObject` if any member remains;
4. wait for the Job Object active-process count to reach zero;
5. close the Job handle, all pipe/control handles, and forwarded stdio;
6. delete the unique AppContainer profile;
7. remove the attempt-private root through the existing Main cleanup path; and
8. report `cleanup-failed` if owned residue remains after the bounded retry.

`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is the supervisor-crash backstop. If the
supervisor itself terminates unexpectedly, Windows closes its Job handle and
kills the worker tree. The native probe must exercise both Main death and
supervisor death.

Cleanup is idempotent and attempt-scoped. A repeated close may observe already
closed handles, an already terminated job, or an already deleted profile and
still succeeds. It may never search by a broad process name or delete another
attempt's profile/root. A unique attempt cannot be relaunched from stale local
objects.

## Failure classification

The supervisor and worker write only fixed markers to stderr. They never emit
paths, pipe names, SIDs, leases, environment values, prompts, model content, or
provider details.

Existing durable classifications remain authoritative:

| Failure                                                                    | Durable result                            |
| -------------------------------------------------------------------------- | ----------------------------------------- |
| AppContainer, ACL, named-pipe, or network-boundary setup fails             | `network-policy-unavailable`              |
| Job Object, CPU, memory, active-process, or identity verification fails    | `worker-resource-enforcement-unavailable` |
| supervisor/worker creation, control message, relay, or ACP bootstrap fails | `spawn-failed`                            |
| bounded termination or owned-object removal fails                          | `cleanup-failed`                          |

No failure retries with a normal token, unrestricted network, direct Goose
spawn, or uncontained worker. A new incident code is unnecessary unless native
implementation proves an existing code cannot preserve one materially
different user action; such a change would require a separate contract,
localization, persistence, and UI review.

## Exact evidence contract

The successful Windows probe emits the existing closed JSON surface only:

| Key                | Required value                                                            |
| ------------------ | ------------------------------------------------------------------------- |
| `contractVersion`  | integer `1`                                                               |
| `targetTriple`     | exact string `x86_64-pc-windows-msvc`                                     |
| `sourceCommit`     | 40 lowercase hexadecimal characters equal to the checked-out commit       |
| `probeSha256`      | 64 lowercase hexadecimal characters for the executed probe implementation |
| `executableSha256` | 64 lowercase hexadecimal characters for the executed `.exe`               |
| `filesystem`       | boolean `true`                                                            |
| `network`          | boolean `true`                                                            |
| `processTree`      | boolean `true`                                                            |
| `resources`        | boolean `true`                                                            |
| `parentDeath`      | boolean `true`                                                            |
| `cleanup`          | boolean `true`                                                            |
| `status`           | exact string `verified`                                                   |

No individual probe may be skipped, neutral, inferred, or replaced with a
source-string assertion. Any false, absent, malformed, or unobserved outcome
produces a nonzero acceptance command and no `verified` containment record.

The probe implementation digest, exact emitted `.exe` digest, source commit,
target triple, and all six booleans are bound into the existing runner
manifest. Main revalidates that record before granting Windows runtime
authority. CI success by itself is not a runtime trust root.

## TDD and native acceptance matrix

Implementation proceeds RED → GREEN in these bounded layers:

1. **Mode and contract tests:** exact CLI modes, one-shot control message,
   digest/path/resource validation, no-argument fail-closed behavior.
2. **Native supervisor unit tests:** Job limits, AppContainer SID/profile,
   security descriptors, handle allowlist, suspended launch, and query-back.
3. **Bridge tests:** exact two-pipe mapping, ACL/client identity, byte/deadline/
   connection bounds, lease preservation, provider conformance vectors,
   builtin MCP conformance vectors, and zero TCP/HTTP endpoint creation.
4. **Hostile Windows probe:** external network, unrelated localhost, profile
   read, outside-root write, junction/symlink/ADS escape, breakaway/child limit,
   CPU, memory, Main death, supervisor crash, duplicate close, and residue.
5. **Exact ACP integration:** initialize/session/tool exchange through the exact
   admitted `.exe`, then cancellation, crash, and cleanup.
6. **Main admission tests:** absent/mismatched/false evidence fails before a
   private root or transport; exact verified evidence enables only Windows x64.
7. **Exact-head Windows CI:** emitted Artifact admission, native containment,
   bounded evidence upload, no orphan, and lock/audit checks.

The Windows containment job must fail on `unsupported-platform`,
`evidence-incomplete`, `test-harness-invalid`, skip, neutral, missing output, or
residual processes/objects. macOS and Ubuntu regressions run independently and
their evidence does not count toward the Windows rows.

## Implementation boundaries

Expected files are limited to:

- `workers/goose-runner/src/main.rs` — exact Windows mode dispatch;
- `workers/goose-runner/src/containment/windows.rs` — AppContainer, Job,
  parent-death, native probe, and closed evidence;
- focused Windows runtime/supervisor and bridge-adapter modules under
  `workers/goose-runner/src/` when separation keeps each unit bounded;
- target-specific `windows-sys` features in
  `workers/goose-runner/Cargo.toml`, with Cargo-generated lock changes only;
- `apps/desktop/src/main/workers/gooseRunnerProcess.ts`, target/artifact/
  containment helpers, and their focused tests;
- the existing containment acceptance scripts and Windows CI job; and
- exact P8 status/roadmap evidence after native execution.

No foundation, Renderer, preload, UI, product workflow, provider, approval,
Team, or persistence implementation is changed by this slice.

## Acceptance gate

The Windows containment slice is accepted only when all of the following are
true on one exact pull-request head:

1. the same admitted `.exe` proves supervisor and AppContainer worker modes;
2. the worker cannot start outside the exact AppContainer and configured Job;
3. all six containment evidence booleans are natively `true`;
4. the authenticated capability/model bridge and real ACP handshake succeed;
5. parent death, supervisor crash, cancellation, and cleanup leave no owned
   process, pipe, profile, or private-root residue;
6. Artifact/manifest/SBOM/license/digest admission remains green;
7. focused tests, `bun run check`, foundation/downstream/boundary gates, Cargo
   format/test/audit, and `git diff --check` pass;
8. exact-head Windows CI is green and preserves the bounded evidence Artifact;
   and
9. a reviewed PR is merged and independent merged-main CI repeats the gate.

Until every row is proved, `resolveGooseRunnerRuntimeTarget()` must continue to
reject Windows before private-root creation. Even after this slice closes,
P8.2 package/product journeys, P8.3 candidate/signing/update trust, P8.4 clean-
machine/real-provider acceptance, release, deployment, and public distribution
remain open.

## Rollback

Rollback removes Windows runtime admission and supervisor-mode integration,
while retaining the already accepted Windows build/Artifact admission. The
resolver returns to pre-root `network-policy-unavailable`; no persisted product
migration, UI fallback, host firewall repair, or external service is required.
