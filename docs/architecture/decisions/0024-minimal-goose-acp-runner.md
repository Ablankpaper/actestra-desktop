# ADR-0024: Select a Minimal Goose v1.45.0 ACP Runner Boundary

- Status: Accepted
- Date: 2026-08-01
- Owners: Actestra Core, Worker, Security, and Release
- Phase: P5 Goose Coding Worker

## Context

P4 is accepted on `main`, so P5 may admit one specialized coding Worker without
changing the preserved AionUI product surface or the Actestra authority model.
The P5 entry gate requires an exact Goose revision, protocol, license,
dependency, telemetry, rollback, and packaging decision before Goose is
imported or executed.

Goose `v1.45.0` is the latest stable upstream release verified on 2026-08-01.
Its exact commit is `4dc0420f5704a92806c6628c8f0a3497d7a88759`, its root
license is Apache-2.0, and it has no root `NOTICE`. The release exposes an ACP
stdio server and reports `goose` plus the package version in the ACP initialize
response. The exact lock contains `agent-client-protocol` `1.0.1` and
`agent-client-protocol-schema` `1.1.0`.

The upstream release CLI is not an acceptable Actestra Worker artifact. Its
default feature set includes code mode, local inference, TUI, AWS providers,
telemetry, Nostr, OpenTelemetry, system keyring, and self-update. The verified
macOS arm64 binary is about 262.6 MB after extraction, is ad-hoc signed, is
rejected by Gatekeeper, and does not contain dependency metadata recoverable by
`cargo-audit bin`.

An offline RustSec scan of the exact upstream lock reports five vulnerability
matches, one unsoundness warning, and five unmaintained dependencies. The
unsound `event-listener` `5.4.1` dependency is on the ACP `1.0.1` path. The
`quick-xml` denial-of-service advisories enter through `goose-cli`'s
unconditional `goose-mcp` dependency, while the RSA advisory enters through
Goose core's JWT and SQLx dependency graph. Upstream `main` at
`20bb609c68f98c856b7fcc473fd1bf140b0406f0` has the same findings. These facts
do not prove exploitability in every feature selection, but they forbid
representing the upstream lock or release binary as clean.

The full evaluation and reproducible evidence are recorded in
[Goose v1.45.0 Evaluation](../../upstream/GOOSE_V1.45.0_EVALUATION.md).

## Decision

### Pin the source and compatibility target

Actestra selects Goose `v1.45.0` at exact commit
`4dc0420f5704a92806c6628c8f0a3497d7a88759` as the P5 source and ACP
compatibility target. The rollback comparison is `v1.44.0` at exact commit
`876555f85b1bd0e15ed75eed7c5ac1163c1f097a`. No revision older than
`v1.44.0` is an allowed rollback because `v1.44.0` fixes
`GHSA-r5pp-p5r8-466r`.

This pin does not approve an upstream prebuilt binary for import,
distribution, candidate status, or release. It authorizes the bounded P5
implementation and local build work described below. A version, commit,
protocol, feature set, artifact digest, or dependency graph outside the exact
admission manifest fails closed.

### Build a minimal Actestra-owned runner

Actestra will build a small `actestra-goose-runner` executable that depends on
the exact pinned Goose core crate with default features disabled and only the
smallest reviewed feature set needed by the runner. The initial Goose feature
set is empty. The first handshake has no network, and later model traffic uses
plain loopback HTTP inside the Actestra process boundary, so a Goose TLS feature
would add dependency surface without an admitted capability. The upstream
`goose-cli` crate is not a runtime dependency.

The runner calls the public pinned entry point
`goose::acp::server::run(Vec::new(), false)`. This fixes all of the following:

- ACP runs only over inherited stdio;
- no HTTP, WebSocket, or other listening server is started;
- no Goose builtin extension is enabled;
- the Goose scheduler is disabled;
- no Goose UI, TUI, updater, local-inference feature, AWS-provider feature,
  Nostr feature, telemetry feature, OpenTelemetry feature, system-keyring
  feature, or `goose-mcp` tool bundle is included deliberately; and
- the process presents the pinned Goose package version in ACP `agentInfo`.

The runner is an Actestra adapter executable, not a forked product surface.
The preserved AionUI agent settings, selector, repair, ACP conversation,
permission, terminal, diff, test, and artifact experiences remain the only UI.

### Admit artifacts separately from source

Every runner build must have an Actestra-owned immutable manifest containing
the Goose source commit, Rust toolchain, Cargo feature list, complete lockfile
digest, local patch digest, target triple, executable digest, ACP versions,
license payload, and build provenance. It must be built with dependency
metadata suitable for binary auditing and must produce an SBOM.

The first lock must select `event-listener` `5.4.2` or newer within the
compatible dependency range so `RUSTSEC-2026-0221` is absent. Any remaining
RustSec vulnerability or unsoundness finding fails artifact admission unless a
new accepted ADR records exact compiled reachability, compensating controls,
and an owner decision. Unmaintained warnings remain separately recorded and
must not be presented as vulnerabilities or silently ignored.

The upstream release archives may be used only as provenance and compatibility
references. They are never silently substituted for the admitted runner. A
future packaged runner must be signed by the Actestra release process and carry
the applicable Apache-2.0 license; upstream ad-hoc signing is not sufficient.

### Keep Goose outside every authority boundary

Each coding task receives a fresh Actestra-created Git worktree and immutable
Task, Session, Worker, and Attempt identities. The original checkout is never a
Worker target. Goose private SQLite, configuration, session identifiers, and
cache files are disposable compatibility state and are never the only product
record.

The runner receives an attempt-private absolute `GOOSE_PATH_ROOT`, working
directory, configuration directory, data directory, temporary directory, and
home-like environment. It receives a closed environment allowlist with
`GOOSE_TELEMETRY_OFF=1`, `GOOSE_DISABLE_KEYRING=1`,
`OTEL_SDK_DISABLED=true`, and all OpenTelemetry exporters set to `none`.
Provider, PostHog, Langfuse, shell-profile, Git credential, SSH agent, cloud,
and user keychain variables are absent unless a later exact broker rule admits
an opaque attempt lease.

Environment variables are defense in depth, not the network boundary. The
first handshake slice denies all network. Later inference may reach only an
Actestra-owned loopback model proxy through an explicit process policy. Goose
never receives a raw provider credential or unrestricted external network.

No Goose builtin tool is enabled. A coding session may receive only an
Actestra-owned MCP/capability proxy declared in the ACP `session/new` request.
That proxy maps every file, terminal, Git, diff, test, and publish request to a
closed Tool Gateway capability, canonical worktree scope, policy decision,
one-shot approval where required, durable audit, timeout, and redaction. Goose
cannot create another MCP server, process, credential, worktree, or tool path.

### Map ACP into existing Actestra contracts

The adapter accepts only ACP `agentInfo.name == "goose"`, version `1.45.0`,
the admitted runner digest, and the pinned protocol/capability manifest before
creating a session. Unknown, missing, or additional privileged capabilities
produce a clear non-destructive incompatibility result.

ACP messages, tool calls, permission requests, terminal updates, diffs, tests,
failures, and completion are normalized into the existing versioned Actestra
events. ACP and Goose identifiers are correlation metadata only. Actestra
persists tool intent, approval, result, Artifact ownership, terminal evidence,
and cleanup state before acknowledging or releasing the Worker.

Cancellation first records the Actestra intent, sends the bounded ACP cancel
request, and waits for acknowledgement. Timeout escalates to process-group
termination and then forced termination. The supervisor persists the terminal
incident before removing the attempt-private Goose root or coding worktree. A
crash or restart never resumes from Goose private state as product authority.

### Implement P5 in bounded slices

1. **P5.0 admission:** this decision, exact upstream evidence, and a fail-closed
   artifact contract; no Goose runtime is imported or executed.
2. **P5.1 runner and handshake:** build the minimal runner, admit its manifest,
   validate ACP initialize/version/capabilities, supervise cleanup, and prove an
   unsupported version fails without creating a session or modifying a repo.
3. **P5.2 isolated coding capability:** create one fixture worktree, provide
   only the Actestra capability proxy and loopback model path, and normalize
   command, file, diff, test, approval, failure, and cancellation evidence.
4. **P5.3 preserved journey:** map the accepted path into the retained AionUI
   ACP conversation and coding evidence surfaces, then satisfy the full P5 exit
   gate on macOS before P6 begins.

## Consequences

- Actestra maintains a small Rust runner and its lock/provenance pipeline, but
  avoids treating Goose's broad desktop CLI as a trusted product component.
- The exact Goose coding engine and ACP behavior are reused without importing
  Goose UI, updater, scheduler, tool authority, credential ownership, or
  product state.
- P5 can begin with deterministic protocol fixtures while the real runner build
  gate is developed, but fixture evidence cannot satisfy the real-Goose exit
  gate.
- No official Goose binary, source tree, Cargo cache, model, credential, or
  private state is committed by this decision.
- Cross-platform candidate packaging, notarization, resource enforcement, and
  physical-machine acceptance remain P7/P8 gates, while P5 must still record a
  feasible macOS, Windows, and Linux runner build topology.

## Rejected alternatives

### Bundle the official Goose CLI release

Rejected because it includes a much larger feature and dependency surface, is
not Gatekeeper-accepted, lacks recoverable binary dependency metadata, and has
an unresolved lock audit.

### Enable the Goose `developer` builtin

Rejected because an upstream builtin is not an Actestra capability manifest
and could create a direct tool path. Coding tools enter only through the
Actestra-owned proxy.

### Run `goose serve` or another network listener

Rejected because stdio ACP supplies the required process boundary without a
second authentication, origin, port, or lifecycle authority.

### Give Goose the original checkout or user environment

Rejected because it would bypass worktree isolation, credential brokering, and
attempt-scoped cleanup.

### Accept an unknown or automatically updated Goose version

Rejected because ACP shape, private state, capabilities, dependencies, and
security posture can change independently. Compatibility is exact and
fail-closed.

## Review triggers

Revisit this decision when:

- Goose publishes a newer stable release or changes the public ACP runner API;
- ACP `agent-client-protocol` or schema compatibility changes;
- the admitted feature graph, lockfile, RustSec result, or license payload
  changes;
- a Goose TLS, provider, telemetry, keyring, update, local-inference, or other
  Cargo feature is proposed;
- a direct Worker filesystem, shell, network, MCP, provider, or credential path
  is proposed;
- upstream fixes permit replacing a local dependency lock adjustment;
- process sandboxing or package signing differs across target operating
  systems; or
- P5 evidence cannot demonstrate isolated modification, testing, review,
  cancellation, cleanup, and unsupported-version failure.
