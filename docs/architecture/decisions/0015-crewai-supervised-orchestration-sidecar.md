# ADR-0015: Supervise P6 Planner Providers Under Actestra Authority

- Status: Partially superseded by ADR-0026 for planner-engine selection
- Date: 2026-07-30
- Amended: 2026-08-06
- Clarifies:
  [ADR-0001](0001-capability-fusion.md) and
  [ADR-0010](0010-aionui-first-product-foundation.md)

## Context

ADR-0001 assigns AionUi the product-foundation role, Goose the coding-worker
role, and Eigent the multi-agent product and orchestration-reference role.
ADR-0010 later makes the preserved AionUi application the visible Actestra
product and requires every external runtime to remain behind Actestra-owned
state, policy, event, and process boundaries.

P6 needs an orchestration runtime candidate, but it must not introduce a second
desktop product, task service, memory system, tool gateway, permission model, or
event authority. Embedding the complete Eigent application would duplicate
those boundaries because Eigent is itself an Electron, FastAPI, and CAMEL-based
desktop product with its own UI and backend services.

CrewAI is a narrower Python orchestration framework. Its Crews, Flows, event
bus, human-feedback hooks, and persistence interfaces make it a more suitable
first candidate for a supervised planner sidecar. That suitability is an
evaluation hypothesis, not evidence that CrewAI is already a product
dependency or that P6 is implemented.

The evaluation snapshot verified on 2026-07-30 is:

- CrewAI release `1.15.8`, exact commit
  `e9caf1e1b89343bb833b5da6660faa91804a9dce`, root MIT license, and declared
  Python range `>=3.10,<3.14`;
- Eigent release `v1.0.2`, exact commit
  `e478094a9ff433132b3cf1928e4143338ddaab20`, root Apache-2.0 license, root
  `package.json` license value `MIT`, backend Python range `>=3.11,<3.12`, and
  `camel-ai[eigent]==0.2.91a5`.

Neither snapshot is imported, installed, bundled, or approved for
distribution. P6 must reverify the selected version, dependency graph,
licenses, vulnerabilities, packaging, and rollback revision before production
integration.

The owner amended the first production-provider evaluation on 2026-08-06 after
the generic boundary and AionUI Team journey exposed a concrete startup gap.
Actestra first evaluates a Main-owned local-Agent compatibility provider. The
locally installed Claude and Codex CLIs may be detected in its closed catalogue,
but neither is currently admitted: each requires a pre-execution boundary that
proves tools, hooks, network, credentials, and arbitrary reads cannot become a
second execution authority. Gemini remains outside this batch, and CrewAI
remains a separately gated future candidate. Where the original text below
calls CrewAI the first production candidate, this amendment controls.

## Decision

### 2026-08-06 local-Agent provider amendment

Actestra Main owns one closed provider catalogue and all provider process
lifecycle. Renderer code may display the catalogue and submit one stable
provider/model selection, but it may not submit an executable path, arguments,
environment, credential, workspace path, process identity, planner identity,
Worker identity, or authoritative Team/run/node identifier. Core validates and
persists the selected provider capability before a run becomes schedulable.

No local-Agent engine is currently admitted. Admission is capability-specific
rather than name-based:

- Claude CLI may provide bounded planner, reference-only aggregation, and Goose
  raw-model completion only when the exact executable supports print mode,
  structured JSON/schema output, `--bare`, disabled session persistence, and
  cancellation of the whole owned process group, and when an Actestra-owned
  credential boundary works in that bare context without renderer secrets, raw
  token or API-key forwarding, a shell-based `apiKeyHelper`, or user settings.
  Claude Code `2.1.168` explicitly disables OAuth and Keychain access in bare
  mode. Its non-bare OAuth path cannot prove hooks and plugin startup are absent.
  It therefore projects an empty capability set and rejects every structured
  invocation before a model process starts until that credential boundary is
  available.
- Codex CLI is projected with an empty capability set and every structured
  invocation is rejected before a model process can start. Empty or read-only
  working directories, ephemeral sessions, ignored configuration, sandbox
  labels, schema-constrained output, and post-hoc event inspection do not prove
  zero tools because a shell, file, MCP, or web effect may already have occurred
  before its event is observed. Codex remains admission-disabled for planner,
  aggregation, and Goose roles until its exact version and an Actestra-owned
  policy or OS sandbox prove, before execution, that tools, network,
  credentials, and arbitrary filesystem reads are unavailable.
- Gemini CLI and every undeclared executable fail closed and are not probed,
  configured, or invoked by this batch.

The current product implementation is intentionally narrower than this
candidate design. Product startup does not ship, import, construct, catalogue,
version-probe, help-probe, or invoke the local-Agent provider. It does not copy
that provider or its runtime into the materialized AionUI product and does not
forward a credential or user environment. Downstream guards reject both those
source copies and startup injection. The orchestrated Team composition
therefore receives no planner/coding runtime and returns the explicit
`team-planner-unavailable` state.

Current implementation note: the safe unavailable envelope now distinguishes
sidecar startup/request timeout as `planner-timeout` and protocol or Core
candidate-admission failure as `planner-invalid`. The fixed AionUI bridge maps
those categories to bounded 504 and 422 errors, while the page preserves task
input and shows fixed recovery guidance without private provider details. This
error-classification boundary does not start or admit a provider and is not
planner, Worker, or P6 acceptance evidence.

A non-shipped evaluation prototype exposes no model-binding option, projects an
empty capability set, and rejects structured invocation before model-process
spawn. Caller-supplied legacy-shaped bindings cannot upgrade it. Its focused
2-file rejection closure is GREEN at 4/4 on the current bytes; this evidence is
research for a later admission decision, not product runtime or acceptance
evidence. Any future provider admission requires
a new explicit implementation and proof for the safe credential-backed model
proxy, portable sandbox, exact executable, and zero-tool boundary; observing a
later shell, file, MCP, or web event could not repair those gaps. Codex remains
`admission-disabled`; Claude remains unavailable in the product. No provider
result may assemble a production Team runtime on prototype or fixture evidence.

Any future admitted invocation must receive its prompt through stdin so
model-controlled or user-controlled content is absent from process arguments.
Main must supply a minimal environment and a private, non-workspace current
directory, never read or copy a CLI credential file, never forward renderer
credentials, and record the exact engine/version/capability projection used for
the attempt. An outbound model request would be an explicit provider effect,
not Worker network authority.

Provider output is untrusted. A planner candidate still passes the existing
closed plan normalization, Core admission, persistence-before-scheduling, and
budget/policy gates. A Goose completion is reduced to the existing closed
message-or-tool-call contract; every proposed coding tool still crosses the
accepted Goose -> Actestra capability, policy, approval, audit, grant, and
worktree boundary. A CLI may not execute a product tool on Goose's behalf.

Timeout, caller abort, app shutdown, malformed output, unsupported version,
missing authentication, provider failure, and parent loss must terminate the
entire owned process group and produce a bounded user-visible unavailable or
failed state. No fallback may silently switch engine, provider, model, Team
type, or authority.

This amendment does not admit CrewAI. Real CrewAI remains subject to the exact
pin, dependency lock, license/NOTICE/SBOM, vulnerability, telemetry/network,
packaging, rollback, and cross-platform gates recorded below.

### Product and authority roles

The P6 product composition is:

```text
AionUi product UI
  -> Actestra Main/Core
    -> Actestra TeamOrchestrator
      -> supervised admitted planner provider
      -> AgentAdapter/Supervisor
        -> General Worker
        -> Goose Worker
```

The Actestra `TeamOrchestrator` remains the only authoritative team state
machine. It owns task, session, attempt, dependency, approval, artifact, audit,
budget, cancellation, and recovery state.

CrewAI may only:

- propose a bounded task decomposition and dependency graph;
- recommend worker roles from an Actestra-supplied capability manifest;
- propose bounded retry or replanning candidates from an authoritative state
  summary;
- aggregate references to completed worker results;
- produce a user-facing explanation of team progress.

CrewAI may not create worker processes, worktrees, credentials, approvals,
tools, authoritative task identifiers, or durable product state.

Eigent remains the product and acceptance reference for leader/coordinator
behavior, editable task decomposition, dependency and parallel-worker
visualization, retry, replan, pause, resume, handoff, approval nodes, and result
aggregation. Its separate UI, Task Service, memory, tools, workspace authority,
FastAPI service, and complete CAMEL runtime are not imported by this decision.

### Plan admission

Actestra sends the sidecar only:

- a bounded goal;
- declared worker capabilities;
- classified or redacted context references;
- budget, depth, node-count, and concurrency limits;
- an Actestra-generated correlation reference.

The sidecar returns a versioned plan candidate containing bounded nodes,
dependencies, suggested worker capabilities, expected artifact classes,
completion criteria, and risk labels.

Actestra validates the candidate before it becomes authoritative. Validation
rejects unknown fields, unsupported versions, missing nodes, cycles, excessive
depth or breadth, invalid dependencies, unavailable capabilities, and budget or
policy violations. Only an accepted and persisted Actestra graph may be
scheduled.

Replanning follows the same rule. CrewAI receives a bounded summary of the
current authoritative state and proposes a new version; Actestra validates,
records, and decides whether to activate it.

### Process and privilege boundary

CrewAI runs in a separate, supervised Python process or sidecar. It never runs
inside the AionUi renderer or the Electron main-process privilege domain.

The sidecar receives a minimal environment and no unrestricted filesystem,
shell, network, credential, MCP, publishing, or Git capability. P6 will not
install `crewai[tools]` by default. Any later tool surface must be a minimal
Actestra capability proxy whose operations still pass through the accepted
policy, approval, credential-broker, tool-gateway, audit, and cancellation
chain.

Telemetry and tracking are disabled in the process environment, including
`OTEL_SDK_DISABLED=true`, `CREWAI_DISABLE_TELEMETRY=true`, and
`CREWAI_DISABLE_TRACKING=true`. Environment flags are defense in depth only;
the process and network policy must also deny unapproved outbound traffic.
CrewAI AMP, Control Plane, cloud accounts, hosted tracing, and enterprise
services are not MVP dependencies.

### State, identity, and recovery

CrewAI Flow persistence, memory, task identifiers, event identifiers, traces,
and retry counters are private compatibility state. They must map to
Actestra-generated identifiers and remain disposable or reconstructable from
Actestra state.

CrewAI human feedback represents workflow feedback or handoff only. It cannot
replace Actestra approval evidence for a protected operation.

Heartbeat, startup, cancellation, timeout, crash, replacement-attempt, and
cleanup semantics remain owned by the Actestra supervisor. CrewAI-internal
retry cannot bypass Actestra attempt identity, budget, event, or audit rules.
An incompatible version, protocol, or capability declaration fails closed.

The Actestra-owned sidecar entrypoint must treat EOF on its supervisor control
stdin as parent loss, stop every descendant it created, and exit. Explicit
supervisor teardown is complete only after the whole process group is gone,
not merely after its leader exits. Parent-death, caller-abort, graceful close,
TERM-to-KILL escalation, and failed-test teardown are separate no-orphan
admission cases; a green request/response test cannot substitute for them.

### First P6 vertical slice

The first production candidate is limited to:

- one leader or planner;
- one General Worker;
- one Goose Worker, or the deterministic fake until the P5 gate passes;
- three to five dependent nodes with at least one parallel branch;
- one user feedback or approval-blocked node;
- one bounded failure and retry or replanning path;
- one whole-team cancellation and process-cleanup path;
- one result aggregation and artifact delivery.

Acceptance requires deterministic restart recovery, no orphaned worker or
worktree, no protected-operation bypass, explainable worker and blocked states
in the preserved AionUi Team UI, and a recoverable error when the sidecar
crashes or is incompatible.

### Production admission gate

Before CrewAI becomes a packaged runtime dependency, one P6 implementation
change must record:

- the exact selected version, commit, and rollback version;
- the sidecar protocol and Actestra ID and event mappings;
- a minimal locked Python dependency graph;
- license, NOTICE, SBOM, and vulnerability evidence, including `pip-audit`;
- telemetry and network-denial proof;
- cancellation, crash, restart, and state-reconstruction proof;
- macOS, Windows, and Linux packaging strategy and smoke evidence.

A time-boxed spike may run earlier, but spike code cannot become production
architecture, claim P6 completion, or change product authority.

## Implementation status

As of 2026-08-06, the unpushed P6 batch on
`codex/p6-aionui-team-acceptance` implements the Actestra-owned parts of this
decision without admitting CrewAI:

- a closed planner protocol and generic supervised JSON-lines process boundary
  can propose a candidate or aggregate ordered Artifact references, but its
  deterministic fixture is not CrewAI and the production planner provider
  remains unavailable;
- schema 14 remains the canonical admitted-plan durability barrier, while
  schema 15 separately owns Team definitions, current run heads, and
  append-only revisions;
- schema 16 immutably binds each Team identity to `standard` or
  `orchestrated`; legacy/native Teams are Main-bound as `standard`, while
  schema-15 Actestra definitions are Main-bound as `orchestrated`, and
  conflicts fail closed;
- schema 17 separately persists metadata-only standard-Team message delivery
  intent before provider effect, records observed or uncertain outcomes, and
  uses a bounded client nonce plus request digest to replay only a durable
  acknowledgement or fail closed without storing message content or attachment
  paths;
- the Actestra scheduler persists Core transitions before observation or
  effects, routes real General and Goose work, keeps workflow feedback separate
  from protected-operation Approval evidence, and owns control, cancellation,
  cleanup, recovery, and reference-only aggregation;
- downstream patch 0014 projects that authority into the sole AionUI-native
  Team/group-chat surface through a fixed current-main-frame provider, with
  creation, configuration, messages, explainable state, controls, Artifacts,
  aggregation, and recovery behavior.
- Standard-Team configuration, title, deletion, and member writes now return
  through the Main-owned bridge. Main validates Team/conversation ownership and
  the authoritative model catalog for configuration, requires the durable
  `standard` experience binding for every provider-active mutation, forwards
  only bounded intents to AionCore, and requires the observed rename, member
  rename, or absence postcondition before acknowledging the renderer. Native
  cron cleanup remains before provider-active deletion, and Main emits removal
  events only after AionCore no longer projects the Team or member. Cross-
  experience identity/list/member-edit events admit bounded provider-owned Team
  and slot identities so standard-Team callbacks survive IPC validation;
  schema-15 run, slot-work, teammate-message, and assistant events retain
  strict Actestra identities. Native AionUI slot identities remain provider-
  owned; the `team-member-<digest>` rule is limited to schema-15 orchestrated
  members. The native AionUI Team controls remain visible; no renderer-side
  model-ID authority or provider-global Team-page replacement is retained.
- the non-shipped local-Agent evaluation prototype recognizes the reviewed
  Claude and Codex CLI shapes, projects an empty capability set, and rejects
  structured invocation before model-process spawn. The materialized product
  does not copy or start that prototype and composes no Team runtime from it.

The prior local root gate for this uncommitted batch passed once on the then
stable production/test bytes: 248 formatted files, 243 linted files with zero
warnings, 90 passing and 2 skipped test files with 820 passing and 8 skipped
tests, the 106-source product boundary, the frozen 1,766-file AionUI selection,
the 293-file downstream contract with 92 reviewed source copies, and a
643-main/30-preload/10,198-renderer production build. The current standard-
Team config-setter correction changed production/test bytes after that gate,
so this result is historical and is not evidence for the final tree. It is not
being repeated under the one-root-gate-per-batch budget.

The correction has its own narrow evidence: bridge 8/8, Main Team service
47/47, materialized downstream `useAcpModelInfo` DOM 12/12, native Team wiring
8/8, downstream TypeScript green, and the downstream contract green at 297
declared files and 92 reviewed source copies. This does not advance the 2/7
ledger.

The later standard-Team session/warmup closure routes both AionUI warmup entry
points through the Main/Core Team projection when the provider is active while
retaining the native fallback when it is absent. Main persists a safe seed
before the fixed loopback session start, verifies the per-member mode
postcondition, and stops a partially warmed Team on failure. Its final focused
evidence is 4/4 Main session tests and 3 materialized renderer files with 29/29
tests, plus root/materialized strict TypeScript, exact-path formatting and
zero-warning lint, the 1,766-file frozen-foundation contract, and the 301-file
downstream contract with 92 reviewed source copies. This remains local
standard-Team compatibility evidence and does not advance the 2/7 orchestrated
ledger.

The follow-on local closure keeps the same authority split for directed
retry-start, session-mode, and runtime-config operations. Provider-active retry
and config/session writes use the Main/Core projection; provider absence keeps
the native AionUi attach, session-mode, config-read, and ACP config-setter paths
reachable. RED-to-GREEN evidence is 18/18 for retry-start, 7/7 for the
permission-context DOM contract, and 57/57 across the five affected renderer
files, with the four Main session tests and four changed Team route fixtures
passing. Root and materialized TypeScript pass, the downstream contract is
303 declared files with 92 reviewed source copies, and no provider, planner,
Worker, or CrewAI runtime is admitted. This remains local compatibility
evidence and does not advance the 2/7 orchestrated ledger or P6 acceptance.

The next focused `useTeamSession` closure applies that split to Team
revalidation and member addition. Provider-active SWR reads and member creates
now use the Main/Core projection, while provider absence retains the native
`team.get` and `team.addAgent` paths. The RED run failed the two intended
assertions with 6 other tests passing; the final generated DOM file passes 8/8.
Materialized strict TypeScript, exact patch formatting, zero-warning lint for
the generated hook and test, and the 303-file downstream contract with 92
reviewed source copies pass. This remains local standard-Team compatibility
evidence; it does not admit a provider, planner, Worker, or CrewAI runtime and
does not advance the 2/7 orchestrated ledger or P6 acceptance.

The subsequent standard-Team control audit closes an effect-before-validation
gap in member pause and cancel. Main now projects current provider run state
before the effect, requires the requested run to be the active accepted or
running run and the target member work to reference it, and only then invokes
the provider before the existing post-effect reconciliation. Focused RED proved
that both a stale run ID and a terminal run previously reached the effect and
resolved; GREEN passes those two fail-closed cases plus one valid
running-to-paused ordering case at 3/3. Root and materialized strict TypeScript,
exact root source/test formatting, and zero-warning root lint pass. This is
local standard-Team control evidence only; the downstream contract remains
green at 303 declared files and 92 reviewed source copies. At this checkpoint,
standard message durability and the remaining native/error journeys were open,
and the 2/7 orchestrated ledger and P6 acceptance did not advance.

The subsequent local message-delivery closure adds forward-only schema 17.
Main persists `pending-effect` before calling AionCore, records the bounded
provider message/run acknowledgement only after observing the same run, and
records `effect-uncertain` for ambiguous provider failure or interrupted
startup. An observed same-nonce/same-digest retry replays only its durable
acknowledgement; changed, pending, uncertain, or conflicting requests fail
closed before another effect. Only one unresolved delivery is allowed for a
Team/target, and neither message content nor attachment paths are persisted.
Focused evidence passes 5 persistence/utility/bridge files with 66 tests, 9/9
affected Main tests, the 13/13 root bridge file, generated slow-response 7/7 and
native-wiring 8/8 files, downstream path safety 3/3, and root plus materialized
strict TypeScript. This is local standard-Team durability evidence only; it does
not advance the 2/7 orchestrated ledger or establish Electron, delivery, or P6
acceptance.

This evidence leaves the orchestrated-Team acceptance ledger at 2/7. Product
startup still has no admitted planner/model binding, the null runtime keeps
orchestrated admission and execution unavailable, General Work is still
fixture-backed by `journeyKind`, and no real Electron journey has completed the
mixed General+Goose dependency, protected-approval, control, Artifact,
aggregation, and restart postconditions. Delivery of the current local batch is
also still open and is separate from those product gaps.

No CrewAI source, package, Python lock, or runtime is imported, installed,
bundled, or selected by that implementation. The exact version and rollback
pin, locked dependencies, license/NOTICE/SBOM and `pip-audit` evidence,
telemetry and network denial, packaging, rollback, and cross-platform smoke
gates above remain mandatory. The generic supervisor and AionUI Team journey
are therefore local P6 implementation evidence, not CrewAI admission, P6 phase
acceptance, a candidate, or a release.

ADR-0026 now selects a separate Actestra-native planner v1 as the first
Actestra-owned production planner candidate. This changes only the engine
selection: the closed request protocol, Core admission, persist-before-effect,
Worker/process isolation, approval/audit authority, cleanup, and all CrewAI/CLI
non-claims in this ADR remain mandatory.

## Consequences

### Positive

- Actestra can evaluate a mature orchestration framework without adopting a
  second desktop application or product state model.
- Eigent remains a concrete interaction and acceptance reference.
- Planning and aggregation can evolve independently from worker execution,
  policy, and persistence.
- Sidecar failure cannot silently become task-state corruption.
- The preserved AionUi Team experience remains the only team UI.

### Costs

- Actestra must define and validate a separate sidecar protocol.
- A Python runtime and locked dependency graph expand packaging and security
  work if the candidate passes.
- CrewAI-native tools, memory, persistence, tracing, and retries cannot be used
  as product authority.
- Cross-platform cancellation and process cleanup require dedicated tests.
- The candidate may be rejected after dependency, packaging, or reliability
  evaluation.

## Rejected alternatives

### Embed the complete Eigent product

Rejected because its UI, backend services, state, tools, workspace, and event
model would compete with AionUi and Actestra authority.

### Let CrewAI own the dependency graph and recovery state

Rejected because Actestra could not guarantee restart recovery, worker
identity, approval blocking, cancellation, audit, or deterministic replay.

### Run CrewAI in the renderer or Electron main process

Rejected because orchestration dependencies and model-controlled behavior must
not share renderer or main-process authority.

### Give CrewAI unrestricted native tools

Rejected because it would bypass the accepted Actestra capability, policy,
approval, credential, and audit chain.

### Build P6 before P4 and P5 gates

Rejected for production work because stable general and coding-worker paths are
dependencies of meaningful team orchestration. Only a bounded spike is
permitted earlier.

## Review triggers

Review this decision if:

- CrewAI cannot be packaged or supervised consistently on all target platforms;
- its dependency, telemetry, license, vulnerability, or runtime behavior
  violates an Actestra release boundary;
- its planner cannot remain stateless or reconstructable from Actestra state;
- direct CAMEL API use or a small attributed algorithm provides a safer and
  simpler boundary;
- Eigent exposes a narrow stable orchestration API that no longer competes with
  Actestra authority;
- measured P6 evidence shows that an Actestra-native planner is more reliable
  or maintainable.
