# Windows Authenticated Goose Runtime Composition Design

Date: 2026-08-19

## Status

Approved for specification by the product owner on 2026-08-19. This document
defines the next P8.2 Windows runtime slice. It is not evidence that the runtime,
Windows Electron package, P8.2, P8.3, P8.4, a release, or user acceptance is
complete.

## Objective

Connect the already admitted Windows x64 Goose containment boundary to the
production Actestra coding composition without weakening either side.

The completed slice must run the pinned Goose ACP agent inside the existing
capability-free AppContainer Worker while Electron Main retains model, MCP,
policy, approval, credential, workspace-grant, and durable-state authority.
The Windows Supervisor is only a bounded lifecycle and byte-relay owner.

Deterministic CI evidence must prove one real ACP session, exact tool discovery,
one model turn, one admitted tool call, cancellation, parent-death cleanup, and
the absence of credentials, broad environment inheritance, direct network, and
original-workspace authority. A real external provider remains a P8.4
acceptance obligation.

## Verified starting point

Formal `main` at `07fd8141434e9aba0edd3d0af265997b738b5c56` contains the
merged P8.2b containment implementation. Merged-main CI run `32224533674`
passed all six jobs, including the Windows x64 build probe and Windows x64
containment job.

That evidence proves the native Windows containment primitives. It does not
prove a production Windows Goose coding session:

- `gooseMcpSessionComposition.ts` gives runner-owned bridge preparation only to
  Linux.
- `openGooseRunnerHandshake()` correctly rejects a Windows launch without the
  exact named-pipe bridge metadata.
- the Windows Worker currently reads its control frame, verifies its boundary,
  writes a ready marker, and exits;
- the Supervisor consumes that marker, emits a resource failure marker, and
  exits nonzero;
- `windows_bridge.rs` validates only a bounded model-frame vocabulary and does
  not implement named-pipe connections, an MCP client, a model Provider, or a
  sustained relay;
- the standard Goose ACP session path accepts HTTP, stdio, and SSE MCP server
  descriptions, while the current Actestra handshake always supplies a
  loopback HTTP MCP endpoint.

The fixed Goose source exposes `Provider`, `McpClientTrait`,
`ExtensionManager::add_client`, `GooseAcpAgent::new`, and the stdio
`serve()` entry point. It does not expose an external hook that supplies
Actestra's Provider and MCP client to each newly activated ACP session. The ACP
file and terminal client is not an equivalent substitute: it exposes generic
read, write, edit, and shell operations instead of Actestra's six exact coding
tools and their existing Tool Gateway, approval, and audit contracts.

## Invariants

The implementation must preserve all of the following:

1. Main owns Provider credentials and performs external model traffic.
2. Main and Core own Tool Gateway policy, approval, workspace grants, durable
   state, events, Artifacts, and apply-to-original-workspace authority.
3. The Worker sees only the admitted isolated coding worktree. It never sees or
   modifies the original authorized workspace.
4. The Worker receives no API key, Provider credential, generic network
   capability, shell authority outside the existing Tool Gateway, or broad
   parent environment.
5. The Worker remains inside the P8.2b AppContainer, Job Object, resource,
   handle, parent-death, and cleanup boundary for its entire lifetime.
6. Renderer and preload receive no new filesystem, Git, process, credential,
   patch-content, or network authority.
7. No HTTP loopback exception, ordinary-token fallback, direct uncontained
   Goose launch, hidden YOLO mode, or second agent framework is introduced.
8. `foundation/` remains unchanged. User-visible AionUI behavior is outside
   this runner-only slice.

## Considered approaches

### Chosen: minimal pinned Goose runtime-adapter seam

Maintain a narrowly reviewed Actestra Goose fork commit based exactly on
upstream `v1.45.0` commit
`4dc0420f5704a92806c6628c8f0a3497d7a88759`. The fork adds only optional,
default-off ACP runtime-adapter inputs needed to install an Actestra Provider
and one Actestra MCP client before a session becomes active.

When the optional inputs are absent, upstream session resolution and extension
behavior remain unchanged. The Actestra runner supplies them only on the
Windows controlled Worker path. The broad Goose CLI, UI, builtin extensions,
scheduler, updater, telemetry, keyring, and direct Provider implementations
remain outside the selected feature and runtime surface.

This approach retains Goose's mature Agent, conversation, ACP, cancellation,
tool-notification, and session machinery and changes only the missing
composition seam.

### Rejected: Goose ACP file and terminal capabilities

Advertising ACP client file and terminal capabilities would avoid a Goose
patch, but it would replace six exact Actestra tools with generic read, write,
edit, and shell operations. That widens capability semantics, changes tool
names, bypasses existing per-tool policy and approval behavior, and makes
Windows differ materially from macOS and Linux. It is not an equivalent
integration.

### Rejected: an Actestra reimplementation of the Goose ACP agent

Writing a second ACP session and tool loop would duplicate mature Goose
behavior, increase protocol and recovery drift, and make upstream compatibility
harder to review. It also conflicts with the product requirement to preserve
the selected mature upstream framework wherever its boundary is usable.

### Rejected: direct loopback or Supervisor-owned authority

Granting the AppContainer loopback or network capability would weaken the
accepted Windows boundary. Giving the Supervisor model, MCP, credential,
policy, or workspace semantics would create a second authority owner. Neither
is permitted.

## Upstream fork and provenance contract

The implementation change must treat the Goose fork as an upstream update,
not as an unrecorded compatibility shim.

- Pin both the upstream base commit and one immutable Actestra fork commit.
- Keep the fork diff limited to the ACP runtime-adapter seam and its upstream
  unit tests.
- Record the canonical repository, fork repository, base commit, fork commit,
  changed upstream paths, diff SHA-256, license, NOTICE state, rollback, and
  test evidence in `UPSTREAM_VERSIONS.md` and the Goose evaluation.
- Update `THIRD_PARTY_NOTICES.md` and mark modified upstream files as required
  by Apache-2.0.
- Extend the runner source contract and build admission so an unrecorded fork
  commit, changed diff digest, expanded Cargo feature set, or unapproved
  upstream file fails closed.
- Keep the upstream source outside this repository; Cargo fetches only the
  exact immutable fork commit. Do not import the Goose repository into the
  Actestra source tree.
- Rollback restores the upstream commit and disables Windows production
  runtime admission. Rollback must not fall back to direct HTTP, direct
  Provider credentials, or an uncontained Worker.

The optional Goose seam supplies four typed inputs:

1. a fixed session Provider identity and model configuration that do not depend
   on global Goose configuration or environment variables;
2. an `Arc<dyn Provider>` created by the Actestra runner;
3. one named and configured `Arc<dyn McpClientTrait>` installed before the ACP
   session is registered as active;
4. per-attempt Goose data and configuration directories derived inside the
   Worker's admitted private root, never the user's global Goose paths.

The seam must not expose raw credentials, arbitrary extension factories,
generic command execution, global registry mutation, or a post-activation race.
Adapted session creation must not read Provider, model, extension, mode, naming,
data-directory, or configuration-directory defaults from global Goose
configuration or environment variables. Provider and extension installation
failure rejects `session/new` and removes the partially created session.

## Runtime topology

```text
Electron Main
  |-- ACP stdio -----------------------------\
  |-- capability bridge channel -------------+--> Windows Supervisor
  |-- model bridge channel -------------------+       |
  |-- one-shot control + parent liveness ----/        | AppContainer + Job
                                                      |
                                     +----------------+----------------+
                                     |                                 |
                              ACP Worker stdio                 two named pipes
                                     |                                 |
                         pinned Goose ACP agent          Provider + MCP adapters
                                     |                                 |
                                     +----------- AppContainer Worker -+
```

Main starts the Supervisor with seven exact channels:

- ACP stdin through the standard input handle;
- ACP stdout through the standard output handle;
- bounded stderr diagnostics through the standard error handle;
- one one-shot control channel;
- one parent-liveness channel;
- one duplex capability bridge channel;
- one duplex model bridge channel.

The Supervisor derives the two attempt-scoped `LOCAL` named-pipe names from the
validated attempt ID. It creates each named-pipe endpoint with an ACL limited to
the exact AppContainer SID and the required owner, then launches the suspended
Worker with the existing AppContainer, Job Object, resource limits, and handle
allowlist.

The Supervisor does not receive a Provider credential or original-workspace
path. It does not interpret prompts, model responses, tool arguments, tool
results, policy, or approval state. It validates only framing, maximum size,
direction, connection count, lifecycle, and closed failure stages, then relays
bytes between the two Main channels and the corresponding named pipes.

## Worker startup and ACP flow

Worker standard input and output are reserved for sustained ACP traffic. The
one-shot Worker control frame and ready result therefore move to dedicated
Supervisor-created handles; they must not share ACP stdout.

The Worker startup order is exact:

1. read and strictly validate the one-shot control frame;
2. verify AppContainer token, Job membership, cleaned environment, admitted
   standard/control/ready handles, and absence of disallowed handles;
3. connect once to each attempt-scoped named pipe;
4. construct the model Provider and MCP client adapters;
5. construct `GooseAcpAgent` with no builtins, no scheduler, the fixed session
   model configuration, per-attempt private state directories, and the optional
   runtime adapters;
6. report ready over the dedicated ready handle;
7. serve Goose ACP over Worker stdin/stdout until orderly close, cancellation,
   parent death, or failure.

The Supervisor consumes the ready result and never forwards it to Main. Only
after readiness does it relay ACP between Main and Worker. Any partial startup
terminates the Job, closes all relays, removes the AppContainer profile, and
returns one closed diagnostic code.

## Model bridge

The Worker model adapter implements the public Goose `Provider` trait. It maps
one Goose model request to the existing Actestra coding invocation shape and
sends a bounded, length-prefixed request over the model pipe.

The model vocabulary contains only:

- completion request;
- completion response;
- closed model error;
- cancellation.

Each request carries the contract version, opaque request ID, attempt lease,
session ID, fixed model ID, messages, response mode, and exact tool schemas.
Unknown fields, duplicate JSON keys, unsupported roles, more than one declared
model tool call, invalid lengths, wrong lease, wrong session, or a response to
an unknown request fail closed.

Main receives the relayed frame through a Windows model bridge host. That host
uses the same Main-owned `GooseLoopbackModelInvoker` and the same completion
validation and refusal classification as the existing loopback implementation.
It never sends a Provider credential into the Supervisor or Worker. The bridge
host preserves served, refused, and rejected counters so
`model-completion-refused` and `model-request-rejected` retain their durable
meaning.

## Capability bridge

The Worker capability adapter implements `McpClientTrait` and exposes exactly
the six members of `CODING_TOOL_IDS` under the existing
`actestra-capability-proxy` extension name. It supports only:

- list tools;
- call one listed tool;
- cancel one in-flight call.

Resources, prompts, subscriptions, arbitrary extension loading, and additional
tool names are unsupported. List results and tool calls use bounded,
length-prefixed frames with exact keys, version, request ID, attempt lease, ACP
session ID, tool name, and JSON arguments or result.

Main's Windows capability bridge host invokes the existing
`GooseMcpToolInvoker`. Tool Gateway policy, approvals, isolated-worktree
validation, command and test allowlists, audit, output limits, and result
sanitization remain unchanged. The bridge is a transport adapter, not a second
tool executor.

The standard Windows `session/new` request carries no HTTP, SSE, or stdio MCP
server. The injected MCP client exists before the session becomes active. Tool
discovery must still return exactly the six expected names; any missing,
additional, duplicated, or renamed tool rejects the composition.

## Main composition changes

`openGooseMcpSessionComposition()` gains an explicit platform transport mode
rather than another implicit boolean:

- macOS keeps the admitted loopback HTTP composition;
- Linux keeps the admitted Unix-socket-to-loopback relay composition;
- Windows uses only the authenticated Supervisor channels and named-pipe
  adapters.

The three modes implement one internal capability-boundary interface and one
model-boundary interface. These interfaces expose the lifecycle and counters
already used by composition; they do not expose sockets or pipes to callers.
This prevents Windows-specific branching from spreading into Team, coding
journey, Tool Gateway, or durable incident code.

`openGooseRunnerHandshake()` keeps target-native fail-closed admission. A
Windows launch requires verified containment evidence, exact fork/source
admission, Windows bridge metadata, deny-all network policy, and the
Supervisor executable authority. Direct loopback options remain rejected.

## Authentication and privacy

Named-pipe ACLs and the attempt lease are both required. Neither substitutes
for the other:

- the ACL admits only the exact AppContainer identity and owner;
- the random attempt lease binds every semantic request to the current
  composition;
- the attempt ID derives names but is not treated as a secret;
- only one connection per pipe is accepted;
- a reconnect, second client, wrong lease, stale response, or cross-pipe frame
  terminates the attempt.

Logs and durable evidence contain only closed stage codes, counts, contract
versions, target identity, and digests. They never contain prompts, messages,
tool arguments, tool results, leases, pipe names, SIDs, PIDs, paths, API keys,
raw Win32 errors, or Provider responses.

## Lifecycle and failure handling

The Supervisor owns the Worker process and every native handle. Main owns the
Supervisor process and bridge hosts.

- Main cancellation sends the existing ACP cancellation and cancels in-flight
  model or tool bridge requests.
- Closing Main's parent-liveness channel terminates the Job through the
  accepted kill-on-close path.
- Worker exit, named-pipe disconnect, malformed frame, oversized frame,
  duplicate connection, relay failure, timeout, or unknown request is terminal.
- No failed bridge may be replaced by loopback HTTP, a direct Provider, a
  generic shell tool, or a non-AppContainer Worker.
- Cleanup is idempotent and bounded. It closes Main channels, Worker pipes,
  process and thread handles, terminates residual Job members, removes the
  AppContainer profile, closes bridge hosts, and removes the private attempt
  root.
- Cleanup failure remains a separate `cleanup-failed` result and cannot hide
  the original runtime failure.

Native diagnostics add closed stages for control, ready, capability-pipe,
model-pipe, ACP-relay, capability-relay, model-relay, Worker-runtime, timeout,
and cleanup failures. Main maps those stages to the existing bounded product
error vocabulary without returning raw stderr.

## Implementation batches

### Batch 1: pinned Goose adapter seam

- Create the minimal fork change and upstream tests.
- Pin the immutable fork commit and diff digest.
- Update source, license, provenance, audit, and rollback records.
- Add admission tests proving all unrecorded revisions, changed files, and
  expanded feature sets fail closed.

No Windows runtime admission changes in this batch.

### Batch 2: Worker adapters and Supervisor relays

- Add dedicated Worker control and ready handles.
- Add the Provider and MCP named-pipe adapters.
- Add capability frames alongside the existing model frames.
- Add ACL-bound named-pipe endpoints and three sustained Supervisor relays.
- Preserve the P8.2b AppContainer, Job, resource, handle, environment,
  parent-death, and cleanup assertions.

The Worker remains non-admitting until all channels and lifecycle paths exist.

### Batch 3: Main composition

- Add Windows capability and model bridge hosts around existing invokers.
- Add the explicit transport-mode abstraction.
- Send an MCP-free Windows `session/new` request.
- Preserve exact tool discovery, model-refusal classification, cancellation,
  approval waiting, and aggregate cleanup behavior.
- Keep Team and coding journey callers platform-neutral.

### Batch 4: native and cross-layer evidence

- Run portable Rust and TypeScript tests.
- Run target-native Windows compilation and unit tests.
- Run one exact-artifact Main-to-Supervisor-to-AppContainer integration using a
  deterministic Main model invoker and the real Tool Gateway boundary.
- Bind successful evidence to the exact runner and source/fork digests.
- Run the complete project gate and exact-head pull-request and merged-main CI.

Real Provider credentials and manual Team UI actions are not part of this
deterministic batch; they remain P8.4 evidence.

## Test and acceptance matrix

### Portable tests

- strict encode/decode tests for every model and capability frame;
- duplicate-key, unknown-field, wrong-lease, wrong-session, oversize,
  out-of-order, duplicate-response, reconnect, and cross-pipe rejection;
- Provider adapter completion, refusal, cancellation, and disconnect behavior;
- MCP adapter exact six-tool discovery, call, cancellation, and unsupported
  resources/prompts behavior;
- Supervisor relay state-machine and idempotent cleanup tests;
- Main transport-mode selection and refusal/rejection counter equivalence;
- source pin, fork diff, feature, license, and admission contract tests;
- regression proof that macOS and Linux composition behavior is unchanged.

### Windows native tests

- forked Goose code compiles under the pinned Windows toolchain;
- the real Worker remains `TokenIsAppContainer == 1` and inside the configured
  Job for the full ACP session;
- only the exact allowed handles are inherited;
- parent environment and credential canaries are absent;
- the AppContainer connects to both exact ACL-bound named pipes and an
  unapproved process cannot connect;
- direct network remains denied;
- real ACP initialize and `session/new` succeed without an HTTP MCP server;
- tool discovery returns exactly six Actestra tool names;
- a deterministic model completion produces one real admitted read-only tool
  call and a second turn produces one approved isolated-worktree write;
- cancellation stops the in-flight turn;
- killing Main or closing parent liveness terminates the complete Worker tree;
- no Worker, Job member, AppContainer profile, named pipe, bridge host, or
  private attempt root remains.

### Required gates

1. Focused Rust and TypeScript tests pass.
2. `cargo fmt --check`, lock-frozen audit/build admission, root format, lint,
   typecheck, documentation, boundary, foundation, downstream, and package
   checks pass.
3. `bun run check` exits zero on the exact implementation head.
4. Windows build, containment, and authenticated runtime-composition jobs pass
   against the same exact head and admitted Artifact.
5. Pull-request CI and independent merged-main CI are both green.
6. `PROJECT_STATUS.md` records exact commits, run and job IDs, Artifact digests,
   observed journeys, and explicit non-claims.

## Exit claim

When every gate above passes, the allowed claim is:

> The admitted Windows x64 Goose Worker can complete the deterministic
> Actestra model and Tool Gateway composition inside the verified AppContainer
> and Job boundary, with no direct network or credential authority and with
> bounded lifecycle cleanup.

The following claims remain forbidden until later gates pass:

- Windows Electron package acceptance;
- all Windows General, Team, approval, recovery, and privacy journeys;
- overall P8.2 completion;
- candidate integrity, signing, update, or rollback acceptance under P8.3;
- clean-machine, real-provider, manual Team, and user acceptance under P8.4;
- release, deployment, publication, or distribution.

## Documentation changes during implementation

The implementation change must update the accepted architecture and current
truth where the runtime adapter becomes real:

- amend ADR-0024 or add one narrowly scoped superseding ADR for the forked ACP
  runtime-adapter seam;
- update `SYSTEM_OVERVIEW.md` with the Main, Supervisor, and Worker data flow;
- update `P8_CROSS_PLATFORM_INTERNAL_BETA.md` and
  `DEVELOPMENT_SEQUENCE.md` with the exact slice boundary;
- update `UPSTREAM_VERSIONS.md`, the Goose evaluation,
  `THIRD_PARTY_NOTICES.md`, and the runner source contract;
- update `PROJECT_STATUS.md` only with verified results and remaining blockers.

## Non-goals

- No edit to `foundation/`.
- No Renderer, preload, Team UI, workflow, or information-architecture change.
- No import of Goose application UI or repository source tree.
- No Provider credential, original-workspace path, or generic network access in
  the Worker or Supervisor.
- No direct application of an Artifact to the original workspace.
- No Linux or macOS runtime redesign.
- No real external Provider credential in CI.
- No candidate, signing, notarization, updater, release, or deployment work.
