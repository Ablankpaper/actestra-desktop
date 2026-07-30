# ADR-0020: Project Preserved AionUI General Work Through Actestra Authority

- Status: Accepted
- Date: 2026-07-30
- Clarifies:
  [ADR-0002](0002-single-source-of-truth.md),
  [ADR-0005](0005-sqlite-persistence-and-migrations.md),
  [ADR-0008](0008-main-owned-projection-and-ipc.md),
  [ADR-0010](0010-aionui-first-product-foundation.md),
  [ADR-0016](0016-p4-general-work-process-and-content-boundaries.md),
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md),
  [ADR-0018](0018-scoped-native-text-tools-and-policy.md), and
  [ADR-0019](0019-general-work-durable-coordination-and-recovery.md)

## Context

GW-P4.5 made the non-UI General Work sequence durable and recoverable, but the
preserved AionUI application still had no user-submitted path into that
sequence. GW-P4.6 must expose one complete journey without adding a second
renderer, route, task model, filesystem client, Worker controller, or state
authority.

The native conversation owns the user's selected workspace before submission.
Actestra must obtain that context from AionCore in main, not trust a renderer
path. A raw native conversation identifier is compatibility data and must not
become the durable product identity. Artifact content may be displayed in the
native Preview surface, but must not become an unbounded renderer or
`localStorage` record.

## Decision

### Preserve the native entry and ordinary sends

Downstream patch `0010-actestra-preserved-general-work-journey.mjs` adds
versioned `/actestra <bounded text>` and
`/actestra file <bounded instruction>` intents to the existing AionUI SendBox.
The first selects the prompt-artifact journey. The second selects the
workspace-file-artifact journey; it does not carry a path. Ordinary AionUI
messages, attachments, quotes, routes, history, Agents, Assistants, Skills,
MCP, scheduled tasks, Team, settings, and other retained flows remain
unchanged.

The intent accepts text only and crosses a context-isolated preload bridge with
strict submit, list, cancel, and preview operations. Electron main accepts
those operations only from the current window's main frame and revalidates
every request and result. The renderer receives no workspace path, content
reference, grant, session, Worker, tool input, or process control.

This is an R1 compatible-provider change to the native SendBox, message-tip,
and Preview surfaces. All unaffected behavior remains R0. If Actestra
persistence or execution is unavailable, the entry remains visible and
returns a bounded R2-style unavailable result.

### Resolve native workspace context in main

For a new submission, main reads exactly one native conversation from the
ready loopback AionCore endpoint. The response is size- and time-bounded.
Actestra validates the exact conversation identity, bounded display name, and
absolute workspace path, then canonicalizes the path with `realpath`.

SQLite schema version 8 adds an AionUI journey-link table keyed by:

- a one-way SHA-256 hash of the native conversation identifier; and
- the deterministic Actestra Task ID.

The raw native identifier and raw AionCore response are not persisted.

SQLite schema version 9 adds a required closed set of journey kinds:
`prompt-artifact` or `workspace-file-artifact`. Existing schema-8 rows migrate
to `prompt-artifact`; arbitrary kinds fail at both the compatibility contract
and SQLite constraint.

One `BEGIN IMMEDIATE` transaction registers the authoritative Workspace,
active WorkspaceGrant, Task, Session, Worker, prompt content reference, initial
tool-input reference, and journey link. The prompt journey stores its
create-only output input. The file journey stores only the fixed
`actestra-input.txt` read input with a main-owned 64 KiB maximum aligned to the
General Worker `send` bound; its later write input does not exist until the
Worker processes the owned read result. Partial registration is forbidden.
Exact duplicates are idempotent; changed kind, ownership, content, grant, or
graph identity conflicts fail closed.

### Keep execution and artifacts Actestra-authoritative

The journey launches one separately supervised General Worker utility process
with exact main-owned ToolRequest IDs. The prompt journey requests the existing
create-only task-output text capability.

The workspace-file journey is a closed two-tool sequence:

1. main supplies the fixed owned input for
   `actestra.workspace.read-text("actestra-input.txt")`;
2. main resolves the successful output reference with the exact request,
   grant, Workspace, Task, Session, and Worker owner;
3. only that bounded source text is sent to the same isolated Worker;
4. the Worker emits a strictly validated private
   `actestra.task-output.write-text` input for `result.md`;
5. main reads that input from the process adapter, persists it under the new
   write-request owner, and invokes the existing create-only tool; and
6. source text and the private write input never enter normalized Core events
   or the renderer projection.

Main rechecks the exact active grant before execution and routes both tool
steps through the accepted policy, audit, content-reference, event, checkpoint,
and terminal-evidence sequence. Only the create-only write introduces Artifact
intent and binding. A reserved file above 64 KiB fails at the read tool with
stable `content-too-large` terminal evidence before source content crosses the
Worker protocol.

The first slice creates one bounded `result.md` task output. It is a
deterministic General Worker fixture proving the complete product path, not a
Goose integration, general shell, arbitrary filesystem API, or claim that all
general-work fixtures are complete.

List and status projections are rebuilt from the Actestra domain graph,
checkpoint, event, incident, and Artifact records. Cancellation targets only
the active `running` or `blocked` supervised attempt owned by the requesting
conversation link. A prepared `ready` Task has no live Worker to cancel and
must not advertise a misleading cancellation action.

Artifact preview requires all of the following:

1. the hashed native conversation owns the linked Task;
2. the available Artifact belongs to that Task;
3. the finalized checkpoint binds the same Artifact and output reference;
4. the content reference resolves under the exact stored owner; and
5. the media type is bounded UTF-8 plain text or Markdown.

Only the label, media type, and bounded content cross to the renderer. AionUI's
native Preview receives the content with `persist: false`; it may display the
content transiently but must not cache it in renderer `localStorage`.

### Recover in authoritative order

Startup retains two ordered recovery steps:

1. after schema and scoped-tool readiness, GW-P4.5 reconciles interrupted
   schema-7 attempts before the native window is created; and
2. after the native backend and preserved window are ready, GW-P4.6 lists
   schema-9 linked Tasks that are still `ready` and have no durable attempt,
   then starts them from their persisted prompt, grant, journey kind, and
   kind-selected initial input. A file journey resumes from its persisted read
   input; after the Worker processes that owned content, main persists the new
   private write input before invoking create-only output.

Prepared recovery never re-reads the native conversation or silently changes
the stored workspace authority. A failed recovery is counted and reported; it
does not mark the Task successful or fall back to AionCore or Worker-private
state.

### Keep target-app smoke explicit and non-production

The materialized desktop admits four fixed smoke scenarios only when both
`ACTESTRA_E2E_TEST=1` and a recognized
`ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO` are present. The smoke workspace must be
an explicit absolute test path. The driver can prepare and recover one task,
revoke its own fixture grant, or cancel its own held Worker; it cannot select
an arbitrary tool, policy, command, credential, or runtime mode. With no smoke
scenario, production construction continues to resolve native context only
from AionCore.

The external target-app smoke launches the packaged macOS `Actestra.app`
produced from the production-built materialized desktop, using only the exact
AionCore version bundled under the frozen AionUI manifest pin. It verifies
restart, denial, and cancellation through schema-9
journey rows, finalized checkpoints, normalized events, Artifact counts,
terminal attempt evidence, foreign keys, renderer readiness, and process
cleanup.

## Consequences

### Positive

- The user completes the first visible General Work journey inside the
  preserved AionUI application.
- The representative file journey reads only one reserved filename and keeps
  its source out of the renderer and normalized events.
- Actestra remains the sole authority for the Task, grant, attempt, event,
  Artifact, audit, terminal evidence, and recovery state.
- A renderer cannot choose a filesystem path or invoke a Worker/tool directly.
- Duplicate submit responses and pre-attempt application restarts are
  recoverable without duplicating the task output.
- Artifact content uses the native Preview experience without becoming a
  renderer persistence record.

### Costs and limits

- The first entry is an explicit `/actestra` command rather than a replacement
  for every native provider flow.
- Both current paths create one deterministic Markdown artifact.
- The representative file path accepts at most 64 KiB of source text even
  though the general workspace-read tool supports up to 1 MiB.
- The loopback native-context read remains a compatibility dependency and must
  fail closed when AionCore is unavailable or incompatible.
- Schema versions 8 and 9 are forward-only.
- Research, writing, office, schedule, representative tool-failure and Worker
  crash, and broader permission journeys remain later P4 acceptance work.

## Rejected alternatives

### Trust a workspace path submitted by the renderer

Rejected because the renderer has no filesystem or authorization authority.
The file journey uses one main-owned reserved filename instead.

### Persist the raw native conversation identifier

Rejected because it is compatibility identity, not an Actestra product ID, and
is unnecessary for ownership queries.

### Store task history in AionCore or Worker-private sessions

Rejected because those states are disposable and cannot replace Actestra
Task, event, Artifact, audit, or recovery records.

### Add a separate Actestra task or artifact window

Rejected because AionUI is the only product UI and already has SendBox,
message-status, cancellation, and Preview surfaces.

### Re-read the native workspace during prepared recovery

Rejected because restart must use the authority already committed atomically;
re-reading could silently rebind a Task to changed compatibility state.

## Review triggers

Review this decision if:

- general work no longer needs an explicit command entry;
- a task needs multiple workspaces, tool requests, or incremental artifacts;
- binary or large streaming preview content is admitted;
- native conversation migration requires reversible identity mapping;
- a workspace grant requires a separate interactive approval beyond native
  workspace selection;
- AionCore changes its conversation endpoint or workspace semantics; or
- renderer preview persistence can no longer honor non-persisted content.
