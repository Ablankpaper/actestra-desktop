# ADR-0018: Admit Only Scoped Native Text Read and Create-Only Output Tools

- Status: Accepted
- Date: 2026-07-30
- Clarifies:
  [ADR-0007](0007-privileged-service-authorization.md),
  [ADR-0010](0010-aionui-first-product-foundation.md),
  [ADR-0016](0016-p4-general-work-process-and-content-boundaries.md), and
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md)

## Context

GW-P4.2 made workspace grants and bounded content references durable.
GW-P4.3 added a real supervised General Worker and a typed result path back to
a blocked attempt. Neither slice admitted filesystem authority.

GW-P4.4 must now prove a useful native-tool path without accidentally creating
an arbitrary filesystem, shell, network, credential, MCP, publish, Git, or
workspace-mutation surface. It must also prevent a worker from choosing its
own action, resource kind, product identity, policy rule, workspace root, or
output identifier.

The preserved AionUI application remains the only product UI. This slice may
register a main-process provider, but it must not add a renderer bridge, route,
component, permission model, worker-specific screen, or second application
shell.

## Decision

### Closed tool registry

Actestra registers exactly two native tools:

| Tool                              | Protected action  | Resource kind | Effect                               |
| --------------------------------- | ----------------- | ------------- | ------------------------------------ |
| `actestra.workspace.read-text`    | `workspace.read`  | `workspace`   | read one bounded UTF-8 file          |
| `actestra.task-output.write-text` | `artifact.create` | `task-output` | create one bounded UTF-8 task output |

Each tool has one exact, Actestra-owned capability manifest, forbids credential
leases, and has a five-second execution timeout. The production policy has one
exact allow rule per tool. No matching rule is denial. In particular,
workspace modification or deletion, shell, system change, network, messaging,
publishing, Git push, credential use, generic tool invocation, and unknown
tool identifiers remain denied or unregistered.

The worker-provided tool name is only a request to select a registered
definition. It cannot define the protected action, resource kind, credential
use, timeout, or policy effect.

### Active-attempt operation derivation

The main-owned coordinator accepts an opaque session, tool request, and input
reference. Before execution it proves that:

- the supervisor still owns a non-disposed, blocked attempt;
- the exact tool request is the attempt's current pending request, not merely
  an older event in its history;
- one and only one matching `tool.requested` event exists;
- workspace, task, session, worker, request time, and summary come from that
  supervised attempt and event; and
- action, resource kind, tool ID, credential prohibition, and timeout come
  from the trusted registry.

Only the opaque input reference is supplied by the main-owned caller.
Persistence resolves it against the exact workspace, task, session, worker,
request, and active grant. Wrong-attempt, missing, expired, corrupt, or
conflicting references fail closed.

The coordinator permits one in-flight execution per request. It returns only
the Adapter v2 typed success, failure, or cancellation result. Raw file
content, workspace roots, native paths, policy objects, and audit records do
not enter the worker result or renderer.

### Portable input contract and workspace reads

Both tools consume strict version 1 JSON stored inside a 1 MiB-bounded
`task-content` input reference. A workspace-read input may carry a main-owned
`maximumBytes` integer from 1 byte through 1 MiB; omission retains the 1 MiB
tool maximum, and the field can only reduce that limit for a specific
invocation. Unknown fields, invalid limits, or versions fail closed.

Paths use normalized, forward-slash relative segments. Actestra rejects:

- absolute, drive, UNC, backslash, colon, empty, dot, and parent segments;
- control characters, non-NFC forms, overlong paths or segments;
- Windows device aliases and trailing dot or space forms; and
- any lexical resolution outside the authorized root.

Before a read, main reloads the current active workspace grant and verifies
that its root is an accessible canonical directory rather than a symbolic link
or filesystem root. It checks every requested component with `lstat`, requires
the final canonical path to stay exact and contained, opens without following
the final symbolic link where the platform supports it, and requires a regular
file. Files larger than the invocation limit, or 1 MiB when no smaller limit is
present, and invalid UTF-8 are rejected.

These checks reduce accidental scope escape and common link attacks. They are
not an OS sandbox or a claim of containment against a hostile process racing
the same workspace; stronger operating-system isolation remains P7 work.

### Create-only task output

Writes cannot target an arbitrary workspace path. Main maps the validated task
identity to:

```text
<canonical-workspace>/.actestra/task-output/<task-id>/
```

The task identity must itself be one portable directory segment. Parent
directories are created one level at a time and may not be symbolic links or
non-directories.

The requested output path is relative to that task-owned root. Main writes the
complete UTF-8 content to a mode-0600 random temporary file, flushes it, and
uses an exclusive same-filesystem hard-link publication step. An existing
file or link is an explicit `output-conflict`; it is never overwritten.
Temporary files are removed on pre-publication failure.

After successful read or publication, main stores a fresh opaque
`tool-output` content reference with the exact owner and grant. A read has no
filesystem side effect. If output-reference persistence fails after a write
was published, the error is marked `mayHaveExecuted`; GW-P4.5 owns durable
recovery and artifact reconciliation for that ambiguous post-effect state.

### Cancellation, failure, and audit

The gateway accepts a main-internal abort signal and passes it to the
executor. Caller cancellation and manifest timeout are separate stable failure
codes. Cancellation before publication produces a typed cancelled result and
no target file. Once create-only publication succeeds, cancellation does not
misreport the committed effect as rolled back.

Executor failures carry a stable code and explicit `mayHaveExecuted` evidence.
The gateway records that code in metadata-only `tool.failed` audit and retains
the existing pre-execution policy and `tool.started` ordering. Generic executor
failures conservatively remain possibly executed.

### AionUI preservation and rollback

Downstream patch `0008-actestra-scoped-native-tools.mjs` constructs the scoped
platform only after the Actestra persistence utility is ready. It keeps the
provider in Electron main and logs the two registered IDs for isolated desktop
smoke evidence. It changes no renderer, route, native response shape, AionCore
lifecycle, AionUI feature entry, or native profile.

Source rollback regenerates without patch 0008. That removes native-tool
registration while retaining the GW-P4.3 worker, GW-P4.2 schema 6 persistence,
and all existing immutable evidence. No database downgrade or native AionUI
profile mutation is required.

## Consequences

### Positive

- A real General Worker can complete a useful filesystem operation without
  receiving filesystem authority.
- Tool meaning and authorization remain Actestra-owned even when a worker
  requests the operation.
- Read content and created output return as exact-owner opaque references.
- Portable path validation, canonical containment, link rejection, and
  create-only publication prevent common scope and overwrite failures.
- The same gateway, policy, audit, and result path can be reused by later
  workers without granting them a generic tool API.
- AionUI remains the sole visible product and retains every existing surface.

### Costs

- Binary, streaming, large-file, append, edit, delete, directory, shell, and
  network workflows remain unavailable.
- Task outputs live in a reserved workspace subtree until GW-P4.5 creates
  authoritative artifact ownership and recovery.
- A published file followed by persistence failure requires later
  reconciliation and cannot be retried blindly.
- Language-level and path checks do not replace an operating-system sandbox.

## Rejected alternatives

### Give the worker a workspace root or raw filesystem API

Rejected because the worker could escape policy, forge paths, and make its
private session the only execution record.

### Derive action and resource kind from worker arguments

Rejected because a worker could label a powerful operation as a harmless read.

### Permit arbitrary create-only paths anywhere in the workspace

Rejected because create-only still mutates user source and can shadow
configuration, repository, or executable files.

### Overwrite an existing task output

Rejected because overwrite destroys conflict evidence and makes retries
non-idempotent.

### Return raw file content in Adapter results

Rejected because content must retain exact owner, size, integrity, expiry, and
redaction boundaries.

### Add a new native-tool UI

Rejected because AionUI is the complete product surface and UI journey mapping
is ordered for GW-P4.6.

## Review triggers

Review this decision if:

- a supported filesystem cannot provide the exclusive publication primitive;
- task outputs must live outside the granted workspace;
- a hostile concurrent workspace writer enters the supported threat model;
- binary, streaming, larger, or editable content becomes required;
- policy requires per-path approval instead of the two exact production rules;
- output recovery changes the publish-before-reference ordering; or
- OS sandboxing, brokered file descriptors, or platform bookmarks replace
  canonical path grants.
