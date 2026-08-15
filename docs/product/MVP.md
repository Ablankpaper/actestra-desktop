# Actestra MVP

Status: Draft product scope for the first internal alpha

## Product statement

Actestra is a desktop AI workspace that lets a user complete general work,
delegate coding tasks to a specialized worker, and coordinate a small team of
agents without learning multiple tools or managing separate runtime state.

The desktop experience starts from AionUi `v2.1.41`. Its original functional
UI and functions are a preservation baseline, not a menu of optional visual
references. That baseline preserves the design language, component system,
navigation foundation, mature interactions, and retained functions; it does
not freeze every page or the information architecture. Actestra may add or
adapt AionUI-native product surfaces through recorded R1/R2 downstream patches
with retention, compatibility, and rollback evidence while changing providers
and authority behind compatible boundaries.

The product composition is AionUi for the visible desktop experience, Actestra
Core for state and authority, Goose for professional coding execution, the
Actestra-native planner for the admitted P6 graph, a capability-gated
local-Agent compatibility boundary as a separate provider evaluation, and
Eigent as the Team experience and acceptance reference. Claude and Codex both
remain admission-disabled until they have a pre-execution zero-tool and
safe-credential boundary; CrewAI remains a separately gated later candidate.

## Target users

- Individuals who want AI to work with local files and produce usable artifacts.
- Knowledge workers who need research, writing, analysis, and office workflows.
- Developers who need repository-aware coding, terminal execution, diffs, and
  test evidence.
- Advanced users who want visible, controllable multi-agent delegation.

## Core journeys

### 1. General work

The user selects a workspace, describes an outcome, reviews requested
permissions, watches progress, and receives an artifact without needing a CLI.

### 2. Coding work

The user selects a Git repository. Actestra creates an isolated worktree, routes
the task to the Goose worker, shows commands and diffs, runs checks, and returns
evidence before the user chooses whether to publish.

Goose enters as the exact minimal stdio ACP runner selected by ADR-0024, not as
a second application or the broad upstream CLI. It receives no builtin tool,
original checkout, raw provider credential, unrestricted network, or product
history. File, terminal, Git, diff, test, and publish actions cross the
Actestra-owned capability proxy and existing policy, approval, event, artifact,
audit, and recovery boundaries.

### 3. Team work

The user gives Actestra a complex goal. A leader creates a small dependency
graph, assigns general or coding workers, exposes progress and approval nodes,
and aggregates the result into one deliverable. Actestra owns the graph and
execution state; an admitted supervised provider may propose plans, replans,
and aggregations without receiving direct tool or product authority. The first
evaluation is the local-Agent boundary under amended ADR-0015. Claude and Codex
have no admitted planner, aggregation, or Goose capability until tools, hooks,
network, credentials, and arbitrary reads are blocked before execution and a
safe credential path is available. Real CrewAI requires separate admission.

The current product startup does not ship, construct, probe, or invoke a local
Claude/Codex planner provider. It uses the fixed Actestra-native planner and
admits orchestrated execution only when Main can resolve the persisted
provider/model selection plus both General and Goose Worker journeys. If any
prerequisite is absent, Main projects that unavailability and its next action
before task submission, and the AionUI page blocks the impossible intent
without inventing readiness in the renderer. A non-shipped local-Agent provider
prototype remains evaluation evidence only.

The visible P6 journey is a real AionUI-native Team/group chat, not a hidden
Core or provider feature. The Team `+` asks the user to choose a standard Team
or an Actestra orchestrated Team. Standard Teams retain the native AionUI
assistant, member, model, workspace, chat, view, permission, scheduling, and
sidebar experience. Orchestrated Teams use fixed General+Goose roles and the
Actestra-owned plan, dependency, approval, control, Artifact, aggregation, and
recovery surfaces. A user can create and list both types, open `/team/:id`,
enter tasks and messages, and move between them without one experience
replacing the other. The page makes Actestra identity, authority source,
current executor, blocking reason, and next valid action explicit without
exposing private Worker or audit data.

The first P6 boundary admits only a versioned 3-5-node candidate with fixed
depth, concurrency, and attempt budgets, declared General/coding capabilities,
classified context references, one human-feedback node, and a parallel branch.
Actestra validates it and creates its own deterministic plan, node, and Task
identities, then persists the canonical admitted graph in its own schema-14
authority before returning it for any later scheduling. This boundary does not
itself add a CrewAI process or make an admitted candidate executable.

Executable Team state remains separate from that admitted plan. Schema 15 owns
the Team definition, current run snapshot, and append-only revisions used for
scheduling, controls, recovery, and result references. Schema 16 separately
binds each Team identity exactly once to `standard` or `orchestrated`. Main
migrates existing native AionUI Teams to `standard`, binds schema-15 Actestra
Team definitions to `orchestrated`, and fails closed on conflicts. The renderer
receives one bounded Main/Core projection and never infers Team type; neither
the UI nor a planner sidecar may write or reinterpret canonical Team state
directly.

## MVP capabilities

- The preserved AionUi desktop frame, Guide, navigation, conversation history,
  settings, appearance, and platform interactions.
- Desktop onboarding and model/provider configuration.
- Local workspace selection with explicit scope.
- One Actestra-owned task and conversation history.
- General worker for file, research, and artifact tasks.
- Exact-version Goose worker adapter for isolated repository and terminal tasks,
  backed by an admitted minimal runner artifact and fail-closed ACP handshake.
- One retained-AionUI coding journey: fixed Goose readiness in Agent Settings
  and Repair, a non-Team native/Goose ACP selector, text-only submission,
  existing permission/terminal/diff/test message surfaces, explicit stop, exact
  publish approval, and available Actestra Artifact projection. Native ACP and
  Team paths remain available and Goose receives no separate application UI.
- Small team orchestration with a leader, dependencies, parallel workers,
  retries, pause, cancel, and user handoff.
- One complete AionUI-native Team/group-chat journey with an explicit standard
  versus orchestrated choice, retained native standard-Team capabilities, and
  an Actestra orchestrated path covering creation, list, `/team/:id`,
  member/role and General+Goose setup, workspace/task input, messages,
  explainable plan/node/Worker state, dependencies, approvals, controls,
  Artifacts, aggregation, and deterministic restart recovery.
- A closed Actestra-owned plan-admission protocol that rejects expanded or
  over-budget candidates and maps accepted nodes to Actestra identities before
  they can become product state.
- A separately supervised planner sidecar whose private state is disposable and
  whose plan candidates are validated and persisted by Actestra before use.
- Unified events for messages, tool requests, approvals, artifacts, completion,
  failure, and cancellation.
- Durable General Work checkpoints that persist tool ambiguity, artifact
  ownership, normalized events, cleanup, and terminal evidence before
  acknowledgement or release, then recover deterministically after restart.
- A preserved-AionUI General Work entry whose native workspace selection is
  resolved in main, atomically registered as Actestra authority, executed by a
  supervised Worker, and projected back as redacted status, cancellation, and
  non-persisted native artifact Preview.
- Risk-based approvals for filesystem, shell, network, message, publish, and Git
  actions.
- Diff, command, test, and artifact previews.
- Local credential storage through operating-system secure storage.
- Crash recovery for task, approval, and artifact metadata.
- Audit trail for user-approved operations.
- Preserved AionUi assistants, Skills, MCP/tools, previews, document workflows,
  scheduled tasks, Team experience, extensions, Hub, WebUI, remote agents,
  channels, notifications, deep links, pet, diagnostics, and updater UI.
  Capabilities that require an unready external provider stay visible with an
  explicit isolated state until their Actestra boundary passes its gate.

## Explicit non-goals

- Importing Aera accounts, data, profiles, memory, code, or release systems.
- Supporting every external agent CLI in the first release.
- Embedding the full Eigent product or CAMEL runtime, or treating CrewAI as a
  second product-state, permission, tool, credential, or approval authority.
- An ungoverned public marketplace for agents, Skills, or MCP servers. The
  original Hub UI is retained, but remote installation remains isolated until
  catalog signing, provenance, permission, and rollback are implemented.
- Organization administration, billing, mobile clients, or cloud collaboration.
- Autonomous payment, message sending, deployment, publishing, or Git push
  without explicit confirmation.
- Hidden or default YOLO execution.

## Safety baseline

Security and reliability status: the P7.1 threat-model and 28-case abuse
baseline and the scheme-A P7.2 General/Goose Worker resource controls are
accepted on `main`. P7.1 physically checks seven required Layer-4 boundaries;
P7.2 physically checks General CPU/memory and Goose output/storage/fork
fail-closed behavior on packaged macOS arm64 bytes. This is not a claim that
P7.3 backup and migration recovery, P7.4 diagnostic retention, cross-platform
enforcement, formal signing, release, or user acceptance is complete; those
remain later gates.

| Action                                      | Default policy                                        |
| ------------------------------------------- | ----------------------------------------------------- |
| Read within an approved workspace           | Allowed and audited                                   |
| Create a new artifact in a task output area | Allowed and surfaced                                  |
| Modify existing user files                  | Confirmation required                                 |
| Delete or overwrite files                   | Confirmation required                                 |
| Execute shell commands                      | Scoped approval required                              |
| Install software or change system settings  | Explicit approval required                            |
| Access credentials                          | Brokered; never exposed to the renderer or model text |
| Send, publish, deploy, pay, or push         | Confirmation for every material action                |

## Internal-alpha success criteria

The MVP is ready for internal alpha only when:

1. a clean machine can install and launch a signed candidate;
2. all three core journeys complete against representative fixtures;
3. task, approval, artifact, and audit data survive restart;
4. cancel and failure paths leave no untracked worker or worktree;
5. the application never performs a protected action without the required
   approval;
6. macOS passes first, followed by defined Windows and Linux acceptance;
7. artifacts, checksums, SBOM, third-party notices, and exact source commit are
   available for the candidate;
8. fresh-user acceptance is recorded separately from CI and packaging proof.
9. the AionUi retention matrix has no unexplained missing functional entry,
   route, bridge domain, or user-visible behavior in the exact candidate.
