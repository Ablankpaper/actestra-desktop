# ADR-0021: Add a Prompt-Derived Writing Artifact Journey

- Status: Accepted
- Date: 2026-07-31
- Clarifies:
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md),
  [ADR-0018](0018-scoped-native-text-tools-and-policy.md),
  [ADR-0019](0019-general-work-durable-coordination-and-recovery.md), and
  [ADR-0020](0020-preserved-aionui-general-work-journey.md)

## Context

The accepted prompt, workspace-file, and local-research journeys all create a
bounded Markdown artifact, but they do not prove a representative writing
workflow. Renaming the research output would not establish a different user
intent, input contract, Worker behavior, artifact meaning, or recovery path.

The writing slice must remain inside the preserved AionUI conversation and
Preview experience. The renderer still cannot choose a filesystem path,
construct a tool input, control a Worker, or write product state. Actestra Core
must retain Task, Session, Worker, Attempt, policy, audit, Artifact, and recovery
authority.

## Decision

### Add one closed writing intent

The preserved SendBox adds `/actestra write <bounded writing brief>`, mapped to
the exact `writing-artifact` journey kind. Ordinary sends and the accepted
prompt, file, and research commands remain unchanged.

The writing brief is text only and uses this exact ordered form:

```text
Title: <bounded title>
Audience: <bounded audience>
Purpose: <bounded purpose>
Point: <bounded point 1>
Point: <bounded point 2>
```

There must be one title, audience, and purpose plus one through eight points.
Unknown fields, reordered fields, empty values, control characters, or values
outside their bounds fail before authoritative registration. Title and audience
are each limited to 256 UTF-8 bytes; purpose and each point are each limited to
2 KiB. The existing 16 KiB General Work prompt ceiling remains the outer
envelope. The parsed title is also the bounded Task presentation title.

### Keep writing distinct from research and file work

The writing journey performs no workspace read. The same separately supervised
General Worker receives the already persisted brief as its start prompt and
uses a closed `writing-artifact-fixture` mode to create a deterministic draft:

- title becomes the Markdown heading;
- audience becomes bounded presentation context;
- purpose becomes the opening paragraph; and
- each point becomes one draft paragraph in source order.

The Worker requests only the existing
`actestra.task-output.write-text` capability with a private input for
`draft.md`, media type `text/markdown; charset=utf-8`. Main reads that private
input from the process adapter, validates and serializes it, persists it under
the exact write request owner, and only then invokes the accepted create-only
tool.

The resulting Artifact has kind `document` and label
`Actestra writing draft`. Exact-owner bounded content opens in the existing
non-persisted native Preview. This is a deterministic workflow and authority
fixture, not a model-quality claim or a general document editor.

### Extend durable registration without a placeholder tool input

SQLite schema version 11 expands the exact journey-kind set only with
`writing-artifact`. Existing schema-10 rows remain unchanged.

The existing prompt, file, and research registration shapes retain their
initial tool or read input. Writing registration atomically stores the
Workspace, active grant, Task, Session, Worker, prompt reference, and journey
link, but no placeholder tool input. The real create-only input does not exist
until the Worker authors it. Exact duplicate registration remains idempotent;
changed identity, prompt, kind, grant, or graph state conflicts fail closed.

Prepared recovery starts from the persisted writing brief and journey kind. It
does not re-read native workspace context. Because no external effect occurs
before the private write input is persisted and the existing tool checkpoint
barrier begins, deterministic regeneration after a pre-tool restart is safe.

### Preserve authority and visibility boundaries

No new renderer bridge operation, route, generic tool, path, network access,
credential, shell, scheduler, or Office provider is added. The renderer sees
only its original brief, redacted task status, Artifact metadata, and the final
owned Preview content. The private create-only input and content reference do
not enter normalized Core events or metadata-only audit.

The target-app smoke adds one fixed writing scenario that proves schema 11,
`document` Artifact ownership, exact `draft.md`, non-persisted Preview,
prepared-task restart, terminal evidence, and process cleanup.

## Consequences

### Positive

- Writing has a distinct structured input, no workspace read, a dedicated
  Worker mode, and a `document` Artifact rather than a renamed research file.
- Main persists the Worker-authored tool input before the only filesystem
  effect.
- Prepared recovery needs only Actestra-owned prompt and journey state.
- The preserved AionUI conversation and Preview remain the only UI.

### Costs and limits

- The first writer is deterministic and accepts one closed brief format.
- Output remains bounded Markdown; real Office formats are a separate slice.
- Interactive editing, revision history, model quality, arbitrary templates,
  and multi-artifact writing remain outside this decision.
- Schema version 11 is forward-only.

## Rejected alternatives

### Rename the local-research fixture

Rejected because it would reuse the same workspace read, evidence extraction,
file Artifact, and output semantics without proving writing.

### Let the renderer construct or save the draft

Rejected because the renderer has no filesystem, tool-input, content-reference,
or Artifact authority.

### Pre-store a placeholder create-only input

Rejected because it would create false authority for content that the Worker
has not authored and complicate duplicate and recovery semantics.

### Create DOCX in the writing slice

Rejected because genuine Office output requires a separately accepted binary
content, creation, Preview, packaging, and recovery boundary.

## Review triggers

Review this decision if:

- writing requires multiple revisions or artifacts;
- a model-backed writer replaces the deterministic Worker mode;
- native Preview must persist or edit content;
- the writing brief needs attachments or workspace sources; or
- Office output is admitted through a binary tool boundary.
