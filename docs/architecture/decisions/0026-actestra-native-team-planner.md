# ADR-0026: Actestra-Native Team Planner Behind a Closed Supervisor

- Status: Accepted
- Date: 2026-08-07
- Supersedes: the planner-engine selection in ADR-0015 only; all authority,
  process, approval, cleanup, and non-CrewAI boundaries in ADR-0015 remain in
  force.
- Related: [ADR-0010](0010-aionui-first-product-foundation.md),
  [ADR-0015](0015-crewai-supervised-orchestration-sidecar.md),
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md), and
  [ADR-0024](0024-minimal-goose-acp-runner.md).

## Context

The P6 plan protocol, schema-14 durability barrier, schema-15 Team/run
authority, and TeamOrchestrator are implemented locally, but product startup
still has no admitted planner. The generic JSON-lines supervisor and its
deterministic fixture prove protocol and no-orphan mechanics only; the fixture
is test infrastructure and cannot become a product runtime by changing its
name or startup path. ADR-0015 intentionally left the planner engine open while
Claude, Codex, and CrewAI remained separately gated. The measured P6 path now
shows that a small Actestra-owned planner is a more reliable and maintainable
next candidate than waiting for an external provider, so the review trigger in
ADR-0015 has fired.

The product still has no admitted Goose execution runtime in this batch. A
planner becoming available must therefore produce a distinct worker-runtime
unavailable state, not silently report `planner-unavailable`, launch a fixture,
or claim the mixed General+Goose journey is complete.

## Decision

Actestra will implement one versioned, Actestra-owned production planner v1 as
a separately supervised sidecar. The owner is the Actestra Main/Core boundary;
the sidecar is a disposable pure planner and has no product authority.

### Exact engine and source boundary

- Engine name: `actestra-native-team-planner`.
- Engine version: `1.0.0`.
- Protocol: `TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION` 1, JSON-lines over stdin and
  stdout, with the existing closed handshake and request/response normalizers.
- Production source: `apps/desktop/src/main/orchestration/actestraNativeTeamPlanner.ts`
  and the dedicated sidecar entry
  `apps/desktop/src/utility/orchestration/actestraNativeTeamPlannerEntry.ts`.
- The production entry is a new source identity. It must not import, copy,
  execute, or depend on `tests/fixtures/teamPlannerSidecar.mjs`,
  `tests/fixtures/localAgentCli.mjs`, `supervisedLocalAgentProvider`, any CLI,
  CrewAI, Eigent, AionCore, or dynamic code.
- The exact engine/version and source digest are recorded in the packaged
  manifest and checked before Main admits the process. A future engine change
  requires a new ADR or an explicit versioned amendment and a rollback pin.

### Planner contract and first graph

The planner accepts only the normalized bounded `TeamPlannerRequest`. It rejects
requests that do not declare both `general` and `coding`, exceed Core limits, or
contain unsupported context classifications. It returns one deterministic
candidate containing exactly three nodes:

1. a `general` worker node;
2. a `coding` worker node with no dependency on the General node; and
3. one `human-feedback` node depending on both workers.

The candidate has no authoritative Team, run, node, Task, Worker, Approval,
Artifact, workspace, or process identifiers. Core creates those identities,
normalizes and admits the candidate, and persists schema 14 before any
scheduler or Worker effect. The sidecar may provide bounded reference-only
aggregation of already admitted Artifact references; it never receives raw
content and never writes state.

### Process, environment, and effect boundary

- Main launches the absolute packaged sidecar entry through the existing
  `TeamPlannerSidecarProcess` supervisor with fixed executable, arguments,
  working directory, and engine identity. Renderer input cannot affect any of
  those fields.
- The sidecar receives a minimal closed environment containing only locale,
  UTC, and explicit deny markers. Parent environment, credentials, model IDs,
  shell options, `PATH`, workspace paths, and proxy credentials are not
  forwarded.
- The entry may read its supervisor stdin and write bounded protocol stdout and
  stderr only. It imports no filesystem, shell, child-process, network, HTTP,
  MCP, credential, or dynamic-module APIs. Static guards and focused runtime
  tests prove this pre-execution boundary; post-hoc tool-event observation is
  never an admission mechanism.
- Protocol, request, response, startup, timeout, abort, parent-EOF, close, and
  process-group cleanup failures fail closed with bounded public error classes.
  The supervisor resolves close only after the complete owned process group is
  gone. No fallback engine or fixture is attempted.

### Composition and worker readiness

Main may construct the native planner only from the trusted packaged entry. The
Team composition reports two independent readiness facts:

- `planner-admitted`: the exact native planner handshake and identity passed;
- `worker-runtime-unavailable`: the planner is admitted but General and/or
  Goose execution is not configured for the current build/profile.

The latter blocks task submission and keeps the Team UI explainable. It does not
create an orchestrator until both planner and required Worker ports are
available. Standard AionUI Teams continue through the native provider path.

### Packaging, integrity, and rollback

The downstream AionUI package gets one explicit
`actestra-team-planner.js` main/utility entry. `electron-builder` includes the
entry only from the generated downstream tree; root and legacy P2 renderer
paths do not build it. Packaged smoke checks verify the exact entry name,
engine marker, source-copy mapping, and absence of fixture/local-agent strings.
The rollback revision is the current planner-unavailable composition: remove
the native entry and inject no planner, leaving the existing fail-closed UI
state. No data migration is required for this planner admission; schema 14,
15, 16, and 17 remain unchanged.

### Acceptance and non-claims

This ADR authorizes implementation and local focused evidence only. It does not
admit Claude, Codex, Gemini, CrewAI, or a production Goose model; it does not
close the P6 Task 14 ledger or permit P7/P8. P6 still requires a fresh-profile
Electron journey proving real General and Goose execution, dependency and
approval blocking, controls, Artifact aggregation, deterministic restart,
whole-team cancel, no orphan processes/worktrees, and source-checkout
protection. A planner-only GREEN result is evidence for the planner layer, not
evidence for those downstream journeys.

## Consequences

### Positive

- Actestra has a reviewable planner implementation without importing a second
  application or Python dependency graph.
- Planner behavior is deterministic, bounded, and reproducible across platforms.
- Planner admission and Worker readiness become separately explainable in the
  existing AionUI-native Team surface.
- CrewAI/CLI evaluation can continue independently without being smuggled into
  product startup.

### Costs

- A maintained sidecar entry and packaged integrity checks add build surface.
- The first planner is intentionally narrow and cannot produce a complete Team
  run until real General and Goose runtimes are wired.
- Process-group and parent-death cleanup require dedicated tests on every target
  platform.

## Rejected alternatives

### Rename the deterministic fixture

Rejected because fixture identity, test-only paths, and fixture behavior are
not production provenance or a real worker runtime.

### Use Claude, Codex, or Gemini CLI as the planner

Rejected because current pre-execution tool, credential, network, and arbitrary
read boundaries do not satisfy ADR-0015. Gemini configuration is not part of
this admission.

### Import CrewAI now

Rejected because exact Python lock, license/NOTICE/SBOM, `pip-audit`, telemetry
and network denial, packaging, rollback, and cross-platform gates remain open.

### Run the planner in Main or the renderer

Rejected because the planner must remain separately supervised and disposable;
the Electron main process remains the authority boundary.

## Review triggers

Review this ADR if the native planner needs model/tool/filesystem/network
effects, changes its protocol or output graph, cannot satisfy cross-platform
no-orphan packaging, or if a separately admitted external planner provides a
safer equivalent under a new decision.
