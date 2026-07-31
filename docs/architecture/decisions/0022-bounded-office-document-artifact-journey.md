# ADR-0022: Add a Bounded Office Document Artifact Journey

- Status: Accepted
- Date: 2026-07-31
- Clarifies:
  [ADR-0016](0016-p4-general-work-process-and-content-boundaries.md),
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md),
  [ADR-0018](0018-scoped-native-text-tools-and-policy.md),
  [ADR-0019](0019-general-work-durable-coordination-and-recovery.md),
  [ADR-0020](0020-preserved-aionui-general-work-journey.md), and
  [ADR-0021](0021-bounded-writing-artifact-journey.md)

## Context

The accepted writing journey produces bounded Markdown through the existing
create-only text tool. It does not prove that Actestra can create a portable
Office document, preserve the native AionUI Word Preview surface, or keep
binary document creation outside the renderer.

The Office slice must be a distinct vertical journey rather than the writing
fixture with a different filename. Actestra Core must continue to own Task,
Session, Worker, Attempt, policy, audit, Artifact, and recovery state. The
renderer cannot receive a filesystem path, binary package, content reference,
Worker handle, or document-generation authority.

## Decision

### Add one closed Office-document intent

The preserved SendBox adds `/actestra office <bounded document brief>`, mapped
to the exact `office-document-artifact` journey kind. Ordinary sends and the
accepted prompt, file, research, and writing commands remain unchanged.

The document brief is text only and uses this exact ordered form:

```text
Document: <bounded title>
Owner: <bounded owner>
Summary: <bounded summary>
Section: <bounded heading> | <bounded body>
```

There must be one title, owner, and summary plus one through six sections.
Unknown fields, reordered fields, empty values, control characters, or values
outside their bounds fail before authoritative registration. Title, owner,
and each section heading are limited to 256 UTF-8 bytes. Summary and each
section body are limited to 2 KiB. The existing 16 KiB General Work prompt
ceiling remains the outer envelope. The parsed title is also the bounded Task
presentation title.

### Generate a real DOCX behind one create-only tool

The separately supervised General Worker receives the already persisted brief
and uses the closed `office-document-artifact-fixture` mode. It returns only a
strict versioned document model containing the title, owner, summary, and
ordered sections. Main validates and serializes that private model, persists it
under the exact request owner, and only then invokes the new exact tool:

`actestra.task-output.write-office-document`

That tool is create-only, derives the fixed task-output path `brief.docx`, and
generates a real ZIP/OOXML Word package in Electron main with pinned
`docx@9.6.1`. The generated package must contain the standard content-types,
package-relationship, and Word-document entries, remain within the bounded
package ceiling, and publish atomically without replacing an existing output.
The Worker and renderer never receive the output path or binary bytes.

The tool output content reference stores only the canonical JSON document
model with media type
`application/vnd.actestra.office-document-preview+json` and classification
`task-content`. It does not store the DOCX package, workspace root, output path,
or a second copy of authority state. This exact-owner reference is durable
Actestra Core authority and is distinct from the detached renderer projection
used by Preview. The resulting Artifact has kind `document` and label
`Actestra Office document`.

### Extend durable registration and recovery

SQLite schema version 12 expands the exact journey-kind set only with
`office-document-artifact`. Existing schema-11 rows remain unchanged.

Office registration atomically stores the Workspace, active grant, Task,
Session, Worker, prompt reference, and journey link, but no placeholder tool
input. The real create-only input does not exist until the Worker authors the
document model. Exact duplicate registration remains idempotent; changed
identity, prompt, kind, grant, or graph state conflicts fail closed.

Prepared recovery starts from the persisted Office brief and journey kind. It
does not read native workspace content. Regeneration is safe before the tool
checkpoint begins because no filesystem effect has occurred. Once publication
is checkpointed, the accepted durable coordinator resolves or finalizes that
effect without uncontrolled re-execution.

### Preserve the native AionUI document surface

The downstream AionUI provider resolves the finalized Artifact binding and
exact-owner canonical model, then copies it into a detached bounded projection
for the existing native Word Preview surface. It renders only safe React text
nodes and does not use raw HTML injection. `persist: false` applies to this
renderer projection, not the durable canonical model. Preview receives neither
the DOCX bytes nor any Actestra path or content reference.

The ordinary upstream OfficeCLI path, its routes, and its explicit unavailable
or error states remain intact. This decision adds no renderer bridge operation,
generic filesystem API, credential access, shell authority, scheduler, network
authority, or second document UI.

The target-app smoke adds one fixed Office scenario proving schema 12, a real
DOCX package, the `document` Artifact, owned non-persisted Word Preview,
prepared-task restart, terminal evidence, privacy boundaries, and process
cleanup.

## Consequences

### Positive

- Office work has a distinct structured intent, Worker mode, binary output,
  Artifact meaning, Preview model, and recovery path.
- DOCX construction and atomic publication remain main-owned and policy-gated.
- The renderer receives only bounded presentation data through the retained
  AionUI Word Preview.
- The private document model persists before the only filesystem effect.

### Costs and limits

- The first Office writer is deterministic and supports one bounded document
  structure and one fixed output filename.
- Tables, images, arbitrary templates, editing, OfficeCLI automation, and
  round-trip document mutation remain outside this decision.
- The DOCX dependency and license notice become release inputs.
- Schema version 12 is forward-only.

## Rejected alternatives

### Rename `draft.md` to `brief.docx`

Rejected because a filename does not create a valid Office Open XML package or
prove the binary creation and Preview boundaries.

### Let the Worker create ZIP bytes or choose the output path

Rejected because the Worker has no direct filesystem authority and must not
expand its protocol into an unbounded binary transport or path-selection API.

### Send the DOCX package to the renderer

Rejected because Preview needs only bounded presentation data; exposing binary
bytes or paths would enlarge renderer authority without user value.

### Replace the native Word Preview or OfficeCLI flow

Rejected because AionUI remains the sole product surface and its retained
native routes, functions, and error states are preservation requirements.

## Review triggers

Review this decision if:

- Office documents require arbitrary templates, images, tables, or multiple
  output files;
- native Preview must edit or persist document content;
- document generation moves out of Electron main;
- the fixed package-size ceiling is no longer sufficient; or
- OfficeCLI automation is admitted through an Actestra policy boundary.
