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

Downstream patch `0010-actestra-preserved-general-work-journey.mjs` adds one
versioned `/actestra <bounded text>` intent to the existing AionUI SendBox.
Ordinary AionUI messages, attachments, quotes, routes, history, Agents,
Assistants, Skills, MCP, scheduled tasks, Team, settings, and other retained
flows remain unchanged.

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

One `BEGIN IMMEDIATE` transaction registers the authoritative Workspace,
active WorkspaceGrant, Task, Session, Worker, prompt content reference, output
tool-input reference, and journey link. Partial registration is forbidden.
Exact duplicates are idempotent; changed ownership, content, grant, or graph
identity conflicts fail closed.

### Keep execution and artifacts Actestra-authoritative

The journey launches one separately supervised General Worker utility process
with an exact main-owned ToolRequest ID. The Worker requests the existing
create-only task-output text capability. Main rechecks the exact active grant
before execution and routes the request through the accepted policy, audit,
content-reference, artifact-binding, event, checkpoint, and terminal-evidence
sequence.

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
   schema-8 linked Tasks that are still `ready` and have no durable attempt,
   then starts them from their persisted prompt, grant, and output input.

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
restart, denial, and cancellation through schema-8
journey rows, finalized checkpoints, normalized events, Artifact counts,
terminal attempt evidence, foreign keys, renderer readiness, and process
cleanup.

## Consequences

### Positive

- The user completes the first visible General Work journey inside the
  preserved AionUI application.
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
- The first output is one deterministic Markdown artifact.
- The loopback native-context read remains a compatibility dependency and must
  fail closed when AionCore is unavailable or incompatible.
- Schema version 8 is forward-only.
- Full representative file, research, writing, office, schedule, and broader
  permission journeys remain later P4 acceptance work.

## Rejected alternatives

### Trust a workspace path submitted by the renderer

Rejected because the renderer has no filesystem or authorization authority.

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
