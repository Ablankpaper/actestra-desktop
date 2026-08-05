# ADR-0015: Use CrewAI as the First Supervised P6 Orchestration Candidate

- Status: Accepted
- Date: 2026-07-30
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

## Decision

### Product and authority roles

The P6 product composition is:

```text
AionUi product UI
  -> Actestra Main/Core
    -> Actestra TeamOrchestrator
      -> supervised CrewAI planner sidecar
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

As of 2026-08-05, the unpushed P6 batch on
`codex/p6-team-plan-persistence` implements the Actestra-owned parts of this
decision without admitting CrewAI:

- a closed planner protocol and generic supervised JSON-lines process boundary
  can propose a candidate or aggregate ordered Artifact references, but its
  deterministic fixture is not CrewAI and the production planner provider
  remains unavailable;
- schema 14 remains the canonical admitted-plan durability barrier, while
  schema 15 separately owns Team definitions, current run heads, and
  append-only revisions;
- the Actestra scheduler persists Core transitions before observation or
  effects, routes real General and Goose work, keeps workflow feedback separate
  from protected-operation Approval evidence, and owns control, cancellation,
  cleanup, recovery, and reference-only aggregation;
- downstream patch 0014 projects that authority into the sole AionUI-native
  Team/group-chat surface through a fixed current-main-frame provider, with
  creation, configuration, messages, explainable state, controls, Artifacts,
  aggregation, and recovery behavior.

No CrewAI source, package, Python lock, or runtime is imported, installed,
bundled, or selected by that implementation. The exact version and rollback
pin, locked dependencies, license/NOTICE/SBOM and `pip-audit` evidence,
telemetry and network denial, packaging, rollback, and cross-platform smoke
gates above remain mandatory. The generic supervisor and AionUI Team journey
are therefore local P6 implementation evidence, not CrewAI admission, P6 phase
acceptance, a candidate, or a release.

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
