# ADR-0020: Project Preserved AionUI General Work Through Actestra Authority

- Status: Accepted
- Date: 2026-07-30
- Amended: 2026-08-01
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
versioned `/actestra <bounded text>`,
`/actestra file <bounded instruction>`, and
`/actestra research <bounded instruction>`,
`/actestra write <bounded writing brief>`, and
`/actestra office <bounded document brief>` intents to the existing AionUI
SendBox. They select the prompt-artifact, workspace-file-artifact,
local-research-artifact, writing-artifact, and office-document-artifact
journeys respectively. Neither read-based intent carries a path. Ordinary
AionUI messages, attachments, quotes, routes, history, Agents, Assistants,
Skills, MCP, scheduled tasks, Team, settings, and other retained flows remain
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

SQLite schema version 9 adds the required
`prompt-artifact` and `workspace-file-artifact` journey kinds. Existing
schema-8 rows migrate to `prompt-artifact`. Schema version 10 expands that
exact closed set only with `local-research-artifact`; schema version 11 adds
only `writing-artifact`; and schema version 12 adds only
`office-document-artifact`. Existing values remain unchanged at each
forward-only step. Arbitrary kinds fail at both the compatibility contract and
SQLite constraint.

One `BEGIN IMMEDIATE` transaction registers the authoritative Workspace,
active WorkspaceGrant, Task, Session, Worker, prompt content reference, initial
tool-input reference, and journey link. The prompt journey stores its
create-only output input. The file journey stores only the fixed
`actestra-input.txt` read input with a main-owned 64 KiB maximum aligned to the
General Worker `send` bound; its later write input does not exist until the
Worker processes the owned read result. The local-research journey uses the
same read-input authority but fixes its source to `actestra-research.txt`
under the same maximum. Partial registration is forbidden. Exact duplicates
are idempotent; changed kind, ownership, content, grant, or graph identity
conflicts fail closed.

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

The local-research journey reuses that exact two-tool sequence with a distinct
closed Worker mode:

1. main reads only `actestra-research.txt` through the existing bounded
   workspace-read tool;
2. the same isolated Worker converts at most 32 non-empty local evidence lines
   into a deterministic Markdown brief;
3. main persists the private create-only input under the exact write request;
   and
4. the accepted task-output tool creates `research.md` with Artifact kind
   `file` and label `Actestra local research brief`.

The current slices create bounded `result.md` or `research.md` task outputs.
The research path is one offline, main-owned local corpus fixture. It is not
network research, generic retrieval, a model-quality claim, a Goose
integration, general shell, arbitrary filesystem API, or evidence that every
general-work fixture is complete.

The writing and Office journeys perform no workspace read and register no
placeholder tool input. Their isolated Worker modes derive a private output
from the already persisted structured brief. Main persists that exact-owner
input before invoking a create-only tool. Writing uses the accepted text tool
for `draft.md`; Office uses only
`actestra.task-output.write-office-document`, whose input fixes `brief.docx`
and whose Electron-main implementation generates a bounded DOCX package. The
Office output reference contains only the validated document model for native
Word Preview, never DOCX bytes or a path. ADR-0021 and ADR-0022 define the
closed brief, model, Artifact, Preview, packaging, and recovery contracts.

List and status projections are rebuilt from the Actestra domain graph,
checkpoint, event, incident, and Artifact records. Cancellation targets only
the active `running` or `blocked` supervised attempt owned by the requesting
conversation link. A prepared `ready` Task has no live Worker to cancel and
must not advertise a misleading cancellation action.

The generic coordinator retains ADR-0006's retryable crash disposition: a
crashed attempt may leave its Task `blocked` while an explicit replacement is
possible. The preserved AionUI journey does not launch a replacement attempt.
For that exact no-replacement composition, an unexpected General Worker exit
must include the canonical `worker.failed` event, then main appends
`task.failed` after `task.updated` and `worker.failed`. The authoritative Task
and Session become `failed`; the Worker and Attempt remain `crashed` with the
same `worker-process-exit` incident. Missing or inconsistent crash evidence
fails closed instead of inventing a terminal result. No renderer operation can
request, simulate, or recover a process crash.

Artifact preview requires all of the following:

1. the hashed native conversation owns the linked Task;
2. the available Artifact belongs to that Task;
3. the finalized checkpoint binds the same Artifact and output reference;
4. the content reference resolves under the exact stored owner; and
5. the media type is bounded UTF-8 plain text, Markdown, or the exact bounded
   Office-document Preview model type.

Only the label, media type, and bounded text or validated Office document model
cross to the renderer. AionUI's native Preview receives the projection with
`persist: false`; it may display it transiently but must not cache it in
renderer `localStorage`. DOCX bytes, paths, roots, and content references never
cross this boundary.

### Recover in authoritative order

Startup retains two ordered recovery steps:

1. after schema and scoped-tool readiness, GW-P4.5 reconciles interrupted
   schema-7 attempts before the native window is created; and
2. after the native backend and preserved window are ready, GW-P4.6 lists
   schema-12 linked Tasks that are still `ready` and have no durable attempt,
   then starts them from their persisted prompt, grant, journey kind, and any
   kind-selected initial input. File and local-research journeys resume from
   their respective persisted read input; after the Worker processes that
   owned content, main persists the new private write input before invoking
   create-only output. Writing has no initial tool input or workspace read: it
   resumes from the persisted structured brief, deterministically regenerates
   private `draft.md` content in the Worker, and requires main to persist that
   input under the exact write-request owner before create-only output. The
   finalized checkpoint must bind the resulting `document` Artifact and exact
   draft content reference before recovery can report success. Office follows
   the same prompt-only recovery boundary, but the Worker regenerates only its
   bounded document model and Electron main creates the fixed DOCX after that
   model is persisted.

Prepared recovery never re-reads the native conversation or silently changes
the stored workspace authority. A failed recovery is counted and reported; it
does not mark the Task successful or fall back to AionCore or Worker-private
state.

A finalized no-replacement Worker crash is terminal, not prepared or
recoverable work. Startup reads its persisted failed projection without
relaunching a Worker, re-resolving native context, adding a replacement
Session, or exposing cancellation. Its checkpoint, Attempt evidence, and
normalized event stream remain unchanged across restart.

### Keep target-app smoke explicit and non-production

The final schema-13 materialized desktop admits fifteen fixed smoke scenarios
across this journey and ADR-0023's schedule provider only when both
`ACTESTRA_E2E_TEST=1` and a recognized
`ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO` are present. The smoke workspace must be
an explicit absolute test path. The driver can prepare and recover one task,
revoke its own fixture grant, or cancel its own held Worker; it cannot select
an arbitrary tool, policy, command, credential, or runtime mode. With no smoke
scenario, production construction continues to resolve native context only
from AionCore.

The Worker-crash scenario adds no production crash bridge or process selector.
After the packaged application reports that its held fixture attempt is active
and its native window, renderer/provider, and managed runtime are ready, the
external smoke harness recursively identifies the unique descendant Electron
NodeService whose exact environment role is
`ACTESTRA_UTILITY_ROLE=general-worker` and sends that process `SIGKILL`. The
recovery scenario disables the ordinary startup Worker probe so that any
Worker-ready marker is a failure rather than ambiguous probe output.

The external target-app smoke launches the packaged macOS `Actestra.app`
produced from the production-built materialized desktop, using only the exact
AionCore version bundled under the frozen AionUI manifest pin. As clarified by
ADR-0021, [ADR-0022](0022-bounded-office-document-artifact-journey.md), and
[ADR-0023](0023-actestra-owned-scheduled-general-work.md), it now verifies
restart, bounded local research, writing, Office-document creation, scheduling,
representative `content-too-large` tool failure, denial, and cancellation
through schema-13
journey rows, finalized checkpoints, normalized events, Artifact counts,
terminal attempt evidence, foreign keys, renderer readiness, and process
cleanup. Research resolves its exact owned non-persisted Markdown Preview and
keeps source evidence out of normalized Core events. Writing proves prompt-only
prepared authority, exact `document`/`draft.md` ownership and Preview, and
keeps private draft input out of normalized events and metadata audit.
Office proves a real `brief.docx` ZIP/OOXML package, prompt-only recovery, an
exact `document` Artifact, bounded owned Word Preview, and absence of the
private model and output path from normalized events and metadata audit.
Representative tool failure proves one failed file journey, exact matching
tool/Task/Attempt incident evidence, no output Artifact, no restart execution,
and absence of its root, source marker, filename, and opaque references from
normalized events, metadata audit, and renderer-facing output.
Worker crash proves a failed Task and Session, crashed Worker and Attempt,
exact `worker-process-exit` evidence, the terminal event tail
`task.updated -> worker.failed -> task.failed`, no replacement Session, tool,
approval, audit, or Artifact effect, and an identical authority snapshot after
restart. The external kill and process discovery remain test-harness authority
outside the packaged renderer and production bridge.

## Consequences

### Positive

- The user completes the first visible General Work journey inside the
  preserved AionUI application.
- The representative file journey reads only one reserved filename and keeps
  its source out of the renderer and normalized events.
- The local-research journey reads only one different reserved filename,
  creates a reviewable Markdown brief, and reuses the same bounded Worker,
  policy, audit, Artifact, Preview, and recovery authority.
- The writing journey performs no workspace read, persists its Worker-authored
  input before create-only output, and binds a distinct document Artifact.
- The Office journey creates a real DOCX through a separate main-owned tool and
  projects only an exact-owner bounded model through the retained Word Preview.
- Actestra remains the sole authority for the Task, grant, attempt, event,
  Artifact, audit, terminal evidence, and recovery state.
- A renderer cannot choose a filesystem path or invoke a Worker/tool directly.
- Duplicate submit responses and pre-attempt application restarts are
  recoverable without duplicating the task output.
- An externally killed, unreplaced General Worker becomes explicit durable
  failure evidence and is not silently relaunched after restart.
- Artifact content uses the native Preview experience without becoming a
  renderer persistence record.

### Costs and limits

- The first entry is an explicit `/actestra` command rather than a replacement
  for every native provider flow.
- All five current paths create one deterministic bounded artifact.
- The representative file path accepts at most 64 KiB of source text even
  though the general workspace-read tool supports up to 1 MiB.
- The loopback native-context read remains a compatibility dependency and must
  fail closed when AionCore is unavailable or incompatible.
- Schema versions 8 through 13 are forward-only.
- General or network research and broader permission journeys remain outside
  this representative P4 fixture set. Schedule is governed by ADR-0023; the
  representative tool-failure fixture reuses the accepted file journey rather
  than adding another journey kind.

## Rejected alternatives

### Trust a workspace path submitted by the renderer

Rejected because the renderer has no filesystem or authorization authority.
The file and local-research journeys each use one main-owned reserved filename
instead.

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

### Add a production crash-control operation

Rejected because process discovery and forced termination are external test
harness responsibilities. Giving the renderer or production bridge a Worker
PID or kill operation would violate the main-owned process boundary.

## Review triggers

Review this decision if:

- general work no longer needs an explicit command entry;
- a task needs multiple workspaces, tool requests, or incremental artifacts;
- binary or large streaming preview content is admitted;
- native conversation migration requires reversible identity mapping;
- a workspace grant requires a separate interactive approval beyond native
  workspace selection;
- AionCore changes its conversation endpoint or workspace semantics; or
- preserved General Work admits automatic replacement after a Worker crash; or
- renderer preview persistence can no longer honor non-persisted content.
