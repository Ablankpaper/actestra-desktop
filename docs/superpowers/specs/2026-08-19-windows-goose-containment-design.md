# Windows Goose Runtime Containment Design

Date: 2026-08-19

## Status

Approved for implementation under the owner's standing instruction that an
unanswered implementation checkpoint is treated as approved. This document is
an implementation design, not evidence that Windows containment, P8.2b, or P8
is complete.

## Objective

Produce exact-artifact, target-native evidence that the Windows x64 Goose
Worker is contained by the same production primitives used at runtime. The
evidence must prove all six P8 containment capabilities before it can be bound
to the runner manifest:

- filesystem;
- network;
- process tree;
- resources;
- parent death;
- cleanup.

Windows runtime admission remains fail closed until this evidence and the
separate authenticated runtime composition are both accepted.

## Existing boundary

The production supervisor already creates a capability-free AppContainer,
constructs an explicit inherited-handle list, starts the Worker suspended,
assigns it to a configured Job Object before the single resume, and verifies
that the Worker reports ready only from an AppContainer token inside a Job.
Main supplies a closed environment and an attempt-private `LOCALAPPDATA`.

The containment probe is still a scaffold: it reports six false values and
`unsupported-platform`. The probe must exercise the production primitives; it
must not copy them into a second test-only implementation or turn the scaffold
booleans into assertions of intent.

## Chosen architecture

### Production primitive reuse

Refactor only the minimum opaque operations from `windows_supervisor.rs` so the
containment orchestrator can use the exact AppContainer, Job Object, suspended
launch, handle-list, token, and cleanup implementation. The normal supervisor
entry and its control contract remain unchanged.

The rejected alternative is a second Windows API implementation under
`containment/windows.rs`: it could pass while production remained broken. The
other rejected alternative is PowerShell or another external probe helper,
which would introduce an unpinned runtime and would not prove the embedded
runner boundary.

### Bounded probe roles

The exact runner gains probe-only child roles that are admitted only while the
closed containment-probe environment marker is present. The normal Windows
mode parser continues to reject those arguments. Probe roles receive only
fixed arguments and inherited standard handles; they do not receive a shell,
provider credential, arbitrary command, path-bearing diagnostic channel, or
generic execution API.

Child results use one fixed-version binary frame containing a magic value and
boolean/closed-enum fields. Paths, environment values, SIDs, handle values,
PIDs, credentials, prompts, and raw Win32 text never cross the evidence
boundary.

## Capability evidence

### Filesystem

The parent prepares bounded sentinels and launches the exact AppContainer
Worker. The Worker attempts the declared hostile reads and writes. Evidence is
true only when host/outside access is denied and the parent independently
observes that no outside file was created or changed. A setup failure is not a
denial success.

### Network

The parent creates a bounded loopback listener that is not granted to the
AppContainer. The Worker makes a real Winsock connection attempt. Evidence is
true only when the Worker receives a denied result and the parent observes no
accepted connection within the bounded interval. A missing Winsock setup or an
unexecuted attempt is incomplete evidence.

### Process tree

The parent queries back `JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1` and the complete
required Job flag set. The Worker then attempts to create a child process.
Evidence is true only when process creation is denied and the Job still reports
exactly the single admitted Worker. The probe never relaxes the active-process
limit to make the test easier.

### Resources

The parent queries the exact production Job Object limits: one active process,
one GiB job memory, 120 seconds job user time, kill-on-close, and the required
UI restrictions. The Worker receives no Job handle and cannot widen the
limits. Evidence is true only when the queried values are exact and the
hostile process-creation check confirms enforcement remains active.

### Parent death

A bounded intermediate probe process owns the configured Job and Worker. The
outer probe terminates the intermediate process without giving it an orderly
cleanup command. Evidence is true only when the Worker also reaches a terminal
state within the bounded interval because the non-inherited Job handle closed.
Calling `TerminateJobObject` directly from the owner is cleanup evidence, not a
substitute for the parent-death probe.

### Cleanup

All success and failure paths close process, thread, pipe, token, listener, and
Job handles; terminate residual Job members; explicitly remove the unique
AppContainer profile; and delete the probe-private directory. Evidence is true
only when the Worker is terminal, the profile removal succeeded, and the
private directory no longer exists. Cleanup failure keeps the whole record
non-admitting.

## Canary and fallback assertions

The probe places one environment canary and one inheritable-but-not-allowlisted
handle in the supervisor process. The Worker must report both absent while its
three declared standard handles remain usable. The parent also verifies an
AppContainer token and exact Job membership. No ordinary-token, broad-
environment, broad-handle, unsupported-platform, or evidence-incomplete result
is accepted as a fallback.

## Evidence binding and diagnostics

The record retains the existing exact keys and binds target triple, source
commit, probe source SHA-256, and executable SHA-256. `verified` is emitted only
when every capability and cleanup is true. Any missing stage emits
`evidence-incomplete` and exits nonzero at the Node acceptance boundary.

Native stderr is limited to one closed stage code. The Node classifier must
enumerate each new Windows stage code and must never return raw stderr.
Success-only CI upload remains unchanged.

## Implementation sequence

1. Extract the opaque production probe seam and add portable contract tests.
2. Add the exact child frame and native token, Job, handle, and environment
   assertions.
3. Add filesystem, network, process-tree, and resource hostile probes.
4. Add intermediate-parent death and exhaustive cleanup probes.
5. Bind the six-capability record only after exact-head Windows native CI is
   green; retain Windows runtime admission as a separate gate.

Each slice starts with a failing focused test, keeps the record non-admitting
until all stages exist, runs the portable Rust and TypeScript checks locally,
and then uses one exact-head Windows run for target-native proof.

## Acceptance gates

- Portable format, lint, typecheck, focused contract tests, Rust tests, and
  `git diff --check` pass.
- The Windows native tests compile and pass on `windows-2025`.
- The exact Windows runner Artifact builds, remains lock-frozen, and is
  independently admitted.
- All six hostile probes pass against that exact Artifact and bind one bounded
  success-only evidence Artifact.
- No residual Worker, Job member, AppContainer profile, private directory, or
  test listener remains.
- Windows runtime admission, packaging, product journeys, P8.2, P8.3, P8.4,
  release, and user acceptance remain separate claims until their own gates
  pass.

## Non-goals

- No edit to `foundation/`.
- No separate Goose or Eigent UI.
- No shell or generic command runner for the probe.
- No host credential, provider, network, filesystem, or Renderer authority.
- No weakening of AppContainer, Job limits, handle allowlisting, environment
  cleaning, socket/path limits, evidence validation, or runtime admission.
