# ADR-0023: Own Bounded Scheduled General Work in Actestra Core

- Status: Accepted
- Date: 2026-07-31
- Owners: Actestra Core and Desktop
- Phase: P4 General Work

## Context

AionUI v2.1.41 already supplies the mature Scheduled Tasks entry, `/scheduled`
and `/scheduled/:job_id` routes, create/edit dialog, list, detail, history,
pause/resume, run-now, and delete interactions through `ipcBridge.cron`. The
retention matrix classifies that surface as R0/R1 and requires it to remain.

The current native bridge sends those operations directly to AionCore's
`/api/cron/*` routes. Leaving that provider authoritative would create a second
source of truth for scheduling, execution, recovery, and failure state. Adding
only a renamed General Work fixture or a separate Actestra schedule page would
avoid that authority problem only by failing the retained product contract.

Office is accepted on `main` through pull request 19 at exact final head
`091f786d57c6b4569cdaac17ea969a0b9070ea02`, squash merge
`505afb2f3916e75c7abb07cdf461bda29a602b9b`, and exact merged-main CI run 30602821085. The next P4 vertical slice must therefore prove one real schedule
path while keeping the renderer unable to own a timer, Worker, runtime,
credential, filesystem path, or policy decision.

## Decision

### Preserve the native Scheduled Tasks surface

The existing AionUI Scheduled Tasks routes, components, dialog fields, status
tags, history links, event names, and explicit error states remain the only
schedule UI. No Actestra schedule window or replacement page is added.

The existing conversation-history **Create Scheduled Task** action opens the
retained `CreateTaskDialog` on `/scheduled` with that current native
conversation identity and title. In this bounded provider mode the existing
dialog locks execution to that conversation; the standalone `/scheduled`
create action remains visible but returns the existing explicit unsupported
state when no conversation is bound. This is an R1 provider wiring change, not
a second form, route, or scheduler UI.

The downstream overlay substitutes an Actestra provider for the exact native
cron HTTP contract. `ipcBridge.cron` remains the renderer-facing API. The
common HTTP bridge recognizes only list, conversation-filtered list, get,
create, update, delete, and run-now operations under `/api/cron/jobs`, plus the
existing `/api/cron/jobs/:id/conversations` history read. It forwards a
bounded request through one fixed preload channel and maps a validated Actestra
result back to the existing native DTO. Cron Skill routes are retained but
return an explicit unsupported result in this slice. Unrelated native HTTP and
WebSocket routes remain unchanged.

The upstream main-process `/api/cron/internal/system-resume` notification is
disabled when this provider is active. Wake and resume recalculate Actestra
timers in main and never notify or reactivate AionCore cron authority.

When the Actestra schedule provider is unavailable, cron operations fail with
an explicit structured unavailable error. They never fall back silently to
AionCore scheduling. Successful create, update, delete, and execution changes
reuse the native `cron.job-created`, `cron.job-updated`, `cron.job-removed`, and
`cron.job-executed` event names through a closed main-to-preload subscription;
the renderer cannot choose an event name or emit schedule state.

### Add one bounded Actestra schedule contract

Schema version 13 adds one `aionui_schedule_jobs` authority table. A schedule
record contains only:

- an Actestra schedule identifier and contract version;
- the owning AionUI conversation hash plus the bounded native conversation
  target required by the retained compatibility surface;
- the identifier of one schedule-owned Workspace grant captured from canonical
  native context at registration;
- bounded name, optional job description, and one bounded `/actestra` General
  Work prompt;
- one validated `at`, `every`, or five-field `cron` schedule, including its
  separate bounded schedule description and an IANA time zone where applicable;
- enabled state, next and previous run instants, terminal status and bounded
  incident code;
- an optional opaque active-run claim, its claim instant, and a monotonic run
  sequence that never enters the renderer projection;
- run, retry, and queue counters fixed by this decision; and
- created and updated instants.

Registration atomically stores the schedule record, an Actestra Workspace, and
one active schedule-owned Workspace grant. The canonical root remains only in
that grant. A later run never re-resolves or silently rebinds the schedule to a
changed renderer or native workspace. Revoking the grant makes future runs
fail closed.

The raw native conversation target and prompt are workload state, not product
identity, audit metadata, or an authorization capability. They never enter
Core events or metadata-only privileged audit. Only the owning native schedule
surface receives the compatibility target and bounded prompt it already
submitted. No workspace root, content-reference identifier, tool input,
credential, process handle, run claim, or Worker identity enters the schedule
projection.

Name is limited to 256 UTF-8 bytes, optional job description to 2 KiB, the
separate schedule description to 512 bytes, cron expression to 256 bytes, IANA time zone to 128
bytes, incident code to 128 bytes, and native conversation identity to the
accepted 256-character bound. The existing 16 KiB General Work prompt ceiling
remains the outer prompt bound. These strings reject control characters and
unknown fields. `at` accepts one future safe-integer epoch no more than ten
years ahead; `every` accepts 60,000 through 31,536,000,000 milliseconds;
`cron` accepts either an empty manual expression or exactly five fields. A
non-empty cron expression is validated by `croner` with an optional validated
IANA time zone. Creation and startup both cap non-deleted schedule rows at 100
so timer recovery is bounded.

Creation is accepted only when all of these conditions hold:

- `created_by` is `user`;
- execution mode is `existing` and the native conversation identifier is
  present;
- the prompt parses as the plain `prompt-artifact` form of the accepted
  `/actestra` General Work command contract; the file, research, writing, and
  Office subcommands remain explicit unsupported schedule inputs;
- the main process resolves the native conversation to a valid non-root
  workspace before persistence;
- queueing is disabled and maximum retries are zero; and
- renderer-supplied workspace, CLI path, model, provider, credential-like
  configuration, or arbitrary runtime options are absent.

The returned native agent metadata identifies the fixed Actestra General
Worker. Renderer-selected assistant metadata never selects the executable,
Worker mode, model, tool, or workspace. New-conversation execution, arbitrary
prompts, queueing, retries, and generic native cron payloads fail explicitly in
this slice rather than falling through to an upstream provider.

The service derives the schedule identity from the conversation hash and
canonical bounded creation payload. Exact duplicate creation is idempotent;
an internal identity collision with changed content is a conflict. Update,
pause/resume, and delete are serialized by the persistence transaction.
Updates cannot change the owning conversation, schedule grant, fixed agent, or
retry/queue policy. Prompt updates must still satisfy the same bounded
`/actestra` contract. Deleting an actively claimed run is rejected until the
run reaches a terminal state; pausing it cancels only future timers.

### Keep scheduling and execution in main/Core

The main-owned schedule service is the only component that calculates the next
run, owns timers, claims work, and updates terminal schedule state. Cron
calculation uses exact `croner@9.1.0`, pinned and attributed with this change.
Manual cron entries with an empty expression have no timer and remain runnable
through the native Run Now action. A completed `at` schedule is disabled after
its one terminal occurrence. Repeating and cron schedules always calculate the
next occurrence strictly after the reference instant, so a stale occurrence is
never selected twice.

Every automatic or run-now execution first performs one atomic persistence
claim. A job cannot have two active claims. The service resolves the persisted
schedule grant and requires it to remain active with the same owning Workspace.
It derives a unique stable General Work submission identity from the schedule
and claimed run, then invokes an internal `AionUiGeneralWorkJourneyService`
entry using only the canonical context captured from that grant. The journey
creates its ordinary run-specific Task graph and grant from that trusted
context without re-reading AionCore or renderer state. It still owns Task,
Session, Worker, Attempt, policy, tool audit, content, Artifact, events,
cancellation, and cleanup. The scheduler cannot invoke a tool or Worker
directly.

The run completes only after the authoritative General Work projection reaches
a terminal state. Success or failure is persisted on the schedule record and
projected through the existing native status fields. Run Now returns the
existing native conversation identifier so the original detail action can
navigate to the conversation and its Actestra-owned task/artifact projection.

### Recover without replaying ambiguous work

At startup, the schedule service loads schema-13 jobs before registering the
renderer bridge:

- a persisted active claim from a prior process is terminalized as an
  interrupted error and is never replayed;
- an overdue occurrence is marked `missed`, then the following valid occurrence
  is calculated without catch-up execution;
- disabled and manual jobs receive no timer; and
- future enabled jobs receive exactly one main-owned timer.

Application resume applies the same bounded recalculation. It cannot call the
upstream cron resume route or catch up an occurrence that became overdue while
the machine slept.

Pause or delete cancels only future timers. An active General Work run remains
owned by its existing conversation cancellation path. Shutdown stops timers,
cancels or awaits supervised runs through the existing journey close path, and
closes the persistence utility without leaving a Worker process or active run
claim behind. Durable Workspace and schedule records remain authoritative.

### Prove the vertical slice

The slice requires:

- core contract and schedule-calculation tests for exact shapes, bounds, time
  zones, unsupported authority fields, and projection privacy;
- schema-13 migration plus atomic CRUD, claim, terminalization, idempotency,
  conflict, missed-run, interrupted-run, and duplicate-claim tests;
- main service and preload-route tests for main-frame ownership, exact method
  and path handling, fail-closed unavailability, native DTO compatibility, and
  event delivery;
- native conversation-action/dialog wiring and schedule-history tests proving
  the supported existing-conversation path is usable without a replacement UI;
- a scheduled existing-conversation `/actestra` run proving the existing
  General Worker, policy, event, Artifact, and recovery authority;
- native compatibility tests proving the original `/scheduled` routes and
  components remain, unsupported Skill routes fail explicitly, and AionCore
  cron and system-resume routes are not called; and
- packaged target-app smoke proving schema 13, create, restart, list, run-now,
  terminal Task/Attempt/Artifact evidence, privacy, missed/interrupted state,
  and process cleanup.

## Current implementation evidence

The boundary is implemented locally on `feat/p4-schedule-journey` from exact
verified Office merge `505afb2f3916e75c7abb07cdf461bda29a602b9b`. Before
review remediation, complete root validation passed 56 files and 414 tests;
materialized native strict TypeScript and the complete native suite passed 345
files and 2,658 tests. That native production build transformed 606 main, 26
preload, and 10,186 renderer modules.

The pre-review local macOS arm64 package passed the independent resource,
AionCore, Hub fallback, Croner license, architecture, and strict recursive
signature checks. Its packaged target-app smoke passed schema-13
create/restart/list, run-now, missed and interrupted recovery, a terminal
scheduled General Work Artifact, metadata privacy, retained prior journeys,
and process cleanup. The package has an Apple Development signature but no
notarization and is not a candidate or release.

The first formal 50-file CodeRabbit review raised 12 issues: 4 Major and 8
Minor. Valid status, canonical-path test, bridge policy, Task-correlated
failure, graph-identity, and exact-due-time concerns were remediated through
focused RED-to-GREEN cycles. Five affected files pass 81 tests, 8 changed
code/test files pass zero-warning lint, and strict TypeScript passes. Empty
manual cron, explicit unsupported Skill route, fail-closed recovery, and
duplicate recovery-event requests were rejected against this decision and the
durable interrupted state.

The second confirmation raised 8 issues (5 Major, 3 Minor), the third raised 4
(3 Major, 1 Minor), and the fourth raised 3 (1 Major, 2 Minor). Valid later
documentation and closed-protocol coverage items are applied. The fourth-pass
request for a pre-existing Actestra workspace registry or Git worktree
allowlist is rejected because ADR-0020 makes validated native workspace
selection the initial authority, this decision captures that canonical root in
an atomic grant, and coding worktrees remain P5. Two final-input follow-ups were
rate-limited before analysis and cannot be reported as zero-issue reviews; the
final complete manual 51-file review includes the Node-free schedule contract
split and corrected downstream-owner assertion and found no additional
confirmed defect.

Final-byte current-input validation passes complete root `bun run check` with
56 files/424 tests, materialized strict TypeScript, the complete 345-file/
2,658-test native suite, and native production builds of 607 main, 24 preload,
and 10,184 renderer modules. A newly built local macOS arm64 package at
`/private/tmp/actestra-p4-schedule-final-byte.54REpE/out/mac-arm64/Actestra.app`
passes independent package verification, exact production-entry ASAR hashes,
AionCore `0.1.52`, 13/13 Hub, Electron/docx/Croner notice, 26-file arm64 Mach-O
signature, 17-link, and actual schema-13 target-app smoke checks. It has an
Apple Development signature but no notarization and is not a candidate,
release, distribution, or user-acceptance artifact.

An implementation commit containing the final working-tree bytes, push, Ready
PR, exact PR-head CI, squash merge, and merged-main CI remain pending.

## Consequences

### Positive

- Users keep the mature AionUI Scheduled Tasks experience.
- Actestra becomes the sole schedule and execution authority for the admitted
  path.
- A schedule run reuses the accepted General Work process, policy, content,
  Artifact, audit, recovery, and cancellation boundaries.
- Restart behavior is deterministic and avoids duplicate unattended side
  effects.
- The renderer receives compatibility DTOs but gains no timer, path, runtime,
  credential, Worker, or tool authority.

### Costs and limits

- The first provider accepts only existing-conversation bounded `/actestra`
  tasks.
- New-conversation execution, arbitrary agents/models, queues, and retries are
  explicit unavailable states.
- Missed runs are recorded and skipped rather than replayed.
- Schema version 13 is forward-only; development rollback uses a fresh
  Actestra profile.
- The additional cron library must remain exactly pinned and attributed.

## Rejected alternatives

### Add only a `/actestra schedule` conversation fixture

Rejected because it bypasses the retained `/scheduled` product surface and
does not prove native schedule compatibility.

### Keep AionCore cron authoritative and shadow its rows

Rejected because the native backend would still own execution, recovery, and
terminal state, leaving Actestra with non-authoritative evidence.

### Let the renderer calculate timers or launch a Worker

Rejected because renderer timing and process control bypass main-owned policy,
supervision, restart, and audit boundaries.

### Replay every missed occurrence after restart

Rejected because ambiguous catch-up can duplicate filesystem effects and run
without current user intent.

### Support arbitrary native agents, models, queues, and retries now

Rejected because those inputs would admit runtime and credential authority
before the corresponding provider, policy, and approval contracts exist.

## Review triggers

Review this decision if:

- a schedule must create a new native conversation;
- queued or retried execution is admitted;
- a protected operation requires a separate per-run approval;
- missed occurrences must be replayed;
- native conversation targets require migration or encryption;
- multiple schedules must coordinate one task or Artifact; or
- AionUI changes its cron route, DTO, event, or history contract.
