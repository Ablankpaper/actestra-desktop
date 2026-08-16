# Actestra Repository Threat Model

**Status:** P7.1-P7.4 product-source review and local plus packaged-macOS
development gates verified; exact-head pull-request CI, merge, merged-main CI,
cross-platform P8, formal signing/notarization, release, deployment, and final
acceptance remain open
**Date:** 2026-08-16
**Scope:** P4-P6 product boundaries and the P7.1-P7.4 macOS development evidence

## Overview

Actestra is an AionUI-first desktop product. AionUI v2.1.41 supplies the
preserved application surface and mature interaction patterns. Actestra Main
and Core own product state, protected effects, approvals, persistence, worker
coordination, and the projections delivered to the Renderer. Goose is an
isolated coding Worker, and the Actestra-native Team planner is a separately
supervised, no-tool planner. The frozen `foundation/` snapshot is not a
runtime trust root that may be edited by P7.

P7.1 turns the existing authority model into a repository-scoped threat model
and executable abuse-case baseline. P7.2 adds fixed General/Goose resource and
process controls, P7.3 adds private migration backup and crash recovery, and
P7.4 adds an explicit-consent local diagnostic export plus integrity-checked,
bounded privileged-audit retention. These slices reuse the existing owning
boundaries; they do not introduce another policy engine, approval system,
sandbox, Worker protocol, credential store, persistence authority, or separate
application UI.

This document describes the final P7 product-source review at the implementation
parent named below. P7 is not yet integrated until the separate documentation
commit, exact-head pull-request CI, governed merge, and independent merged-main
CI are complete. Cross-platform enforcement, formal release signing,
distribution, deployment, and final user acceptance are also not claimed.

## Verified P7 development evidence

The reviewed product-source and test parent is
`7b0c27f4af3bb4e0e0049a03646af19c4fa9acc2`. On macOS arm64:

- all 14 stable invariants still map to the closed 28-case catalog, and the
  security gate passes 28/28 cases and 168/168 exact variants as
  `denied-safe`;
- the P7.4 focused gate passes 14 test files and 117 tests;
- `bun run check` exits 0 with 138 test files passed / 2 skipped and 1,516
  tests passed / 9 skipped, zero-warning lint, strict typecheck, Electron
  SQLite, security, smoke-harness, product-boundary, frozen-foundation,
  downstream-overlay, and package gates green;
- schema 23 chains privileged-audit rows, preserves a verifiable retained-prefix
  anchor, prunes only complete terminal request groups under the fixed 90-day /
  100,000-record policy, and fails closed on corruption or an unsafe hard-cap
  state;
- the Main-owned exporter writes only a bounded, aliased, metadata-only JSON
  report after explicit consent and native save selection; Renderer receives
  only `saved`, `cancelled`, or `rejected` and no path, bytes, persistence, or
  filesystem authority;
- `bun run dist:dir` exits 0, the exact development app has identifier
  `com.bignormal.actestra`, arm64 architecture, and a strict verified ad-hoc
  signature; and
- the same packaged app passes schema-23 General Work, the seven required
  Layer-4 security cases, five P7.2 resource/process cases, and the P7.4
  diagnostic/audit smoke. The security smoke admits the existing real Goose
  runner through manifest SHA-256
  `7195e5f7f0d72c78e36a380ee1db8f02cfc03e1fcc874d5000445ef93b2089a7`.

The catalog cases and their dispositions were not weakened by P7.4, and the
frozen `foundation/` snapshot remains unchanged. These are local and packaged
development-build results. No exact-head CI for this parent, merge,
merged-main CI, formal signing/notarization, release, deployment, or user
acceptance is claimed here.

## Threat Model, Trust Boundaries, and Assumptions

### Protected assets

The threat model protects:

- provider credentials, opaque credential references, and provider metadata;
- user workspace content, canonical authorized roots, Git checkouts, isolated
  worktrees, patches, and Artifact content references;
- protected-operation policy, approval records, delivery records, and audit
  evidence;
- Task, Session, Worker, Attempt, Team, run, node, and persistence identity;
- SQLite product state, migrations, recovery records, compare-and-swap
  versions, and append-only audit sequence;
- admitted Worker, planner, MCP, and tool manifests and their trusted digests;
- Main-owned IPC and bounded Renderer projections;
- Worker process groups, private roots, closed environments, loopback leases,
  sandbox profiles, and cleanup state; and
- logs, incidents, bounded diagnostic reports, privileged-audit chain and
  retention anchors, packaged resources, source-copy provenance, licenses,
  SBOMs, and build evidence.

### Trusted authorities

The following are trusted only after their existing admission and composition
checks succeed:

1. accepted Actestra Core contracts and state machines;
2. Electron Main services and `desktopIpc` after exact startup composition;
3. the SQLite persistence utility after protocol and schema validation;
4. ToolGateway after manifest, policy, approval, credential-reference, and
   audit checks;
5. an exact admitted Goose runner or planner artifact whose external trust
   root, digest, and target identity match; and
6. the user for each exact protected decision and for the separate explicit
   local-diagnostic export consent and native save selection.

A user decision authorizes only that exact operation, attempt, and approval
record. It does not grant a broader workspace, credential, process, or tool
capability.

### Untrusted and partially trusted inputs

The following are attacker-controlled or may be malicious, stale, or
inconsistent:

- every Renderer and preload request, including one from a compromised frame;
- provider metadata, HTTP responses, streamed chunks, and model completions;
- Goose ACP messages, MCP requests, tool arguments, progress, and diagnostics;
- planner candidates and Worker-private identifiers;
- user-selected workspaces and files, symlinks, Git configuration, hooks,
  filters, includes, fsmonitor settings, and concurrent changes;
- unauthenticated local loopback clients and malformed HTTP/SSE/ACP frames;
- environment variables, inherited descriptors, subprocess output, signals,
  abnormal exits, and parent death;
- persisted bytes after restart, including replayed, stale, conflicting,
  truncated, structurally valid but unauthorized, or tampered records; and
- packaged resources unless they pass the exact downstream overlay, source-copy,
  manifest, license, and package checks.

Developer and operator inputs (pins, overlays, CI actions, build tools,
fixtures, and local profiles) are build-time inputs, not runtime product
authority. A fixture or self-consistent manifest cannot authorize its own
production use.

### Trust-boundary assumptions

- The operating system and Electron process separation are available, but
  process separation is defense in depth rather than a substitute for Main/Core
  validation.
- The canonical workspace and Git implementation may change concurrently;
  every privileged operation therefore revalidates its grant and root at the
  effect boundary.
- A provider may return malformed, adversarial, or protocol-inconsistent data;
  provider success status is never model-contract evidence.
- A process can exit between any two observations. Durable terminal state and
  cleanup must be ordered so an uncertain effect is recoverable, not silently
  retried.
- macOS is the P7.1 enforcement and packaged-acceptance platform. Windows and
  Linux remain explicit P8 obligations; unsupported execution is unverified,
  not successful.

## Security Invariants

The following stable identifiers are the P7.1 authority. They are referenced by
the human ledger and the machine catalog. An invariant may be added or removed
only through an updated threat model, catalog, tests, and source-of-truth
decision.

| ID | Invariant |
| --- | --- |
| `P7-I-RENDERER-001` | Renderer receives bounded projections and typed intents only; it has no direct credential, filesystem, shell, process, Git, patch-content, persistence, or unrestricted network authority. |
| `P7-I-IPC-001` | Only the trusted current main frame may invoke an exact registered IPC operation; unknown fields, prototypes, stale frames, and undeclared channels fail closed. |
| `P7-I-CREDENTIAL-001` | Raw credentials remain Main-owned, are redacted before projection or caching, are never written back as sentinels, and reach effects only through the admitted Main path. |
| `P7-I-WORKSPACE-001` | Every file or Git effect is bound to the active grant and revalidated canonical root; traversal, symlink, Git-indirection, binding drift, and scope substitution fail closed. |
| `P7-I-DELIVERY-001` | Goose changes an isolated worktree only; applying a patch to the original workspace requires a distinct persisted Main-owned approval and post-approval revalidation. |
| `P7-I-TOOL-001` | An undeclared tool, missing manifest, unmatched or conflicting policy, malformed input, invalid credential reference, or stale approval never reaches an executor. |
| `P7-I-APPROVAL-001` | Approval is exact-operation, exact-attempt, one-shot evidence; protected approval, workflow feedback, publish approval, and workspace-apply approval cannot satisfy one another. |
| `P7-I-MCP-001` | MCP and model loopback endpoints admit only the exact authenticated peer, bounded protocol shape, allowed tool set, and declared model behavior. |
| `P7-I-WORKER-001` | A Worker receives a closed environment, admitted executable and capabilities, no raw credential, and no authority outside its attempt-private scope. |
| `P7-I-NETWORK-001` | Packaged Renderer and isolated Workers cannot create undeclared external network effects; admitted provider traffic remains a Main-owned, bounded exception. |
| `P7-I-PROCESS-001` | Success, rejection, timeout, cancellation, crash, and parent death settle durable state before release and leave no privileged child, process group, lease, lock, private root, or worktree orphan. |
| `P7-I-PERSISTENCE-001` | Replayed, stale, conflicting, tampered, malformed, or unauthorized durable records fail closed without rewriting accepted authority or creating a second effect. |
| `P7-I-REDACTION-001` | Events, audit, incidents, logs, Renderer projections, and test evidence retain only admitted classification and never expose credentials, prompt or model text, tool arguments, content references, or user paths. |
| `P7-I-ARTIFACT-001` | Worker, planner, tool, and packaged artifacts require an external trust root, exact digest and shape, and fail closed on substitution, widening, symlinks, unexpected files, or unsupported platform identity. |

## Attack Surface, Mitigations, and Attacker Stories

### Renderer, preload, and IPC

An attacker controlling a Renderer may attempt privileged imports, direct
network calls, undeclared channels, stale-frame requests, prototype pollution,
unknown fields, or oversized payloads. The boundary is the native
`desktopIpc` registration and Main-owned projection path. Product-boundary
rules, exact operation schemas, trusted-current-main-frame checks, bounded
normalizers, and typed intents must reject the request before any provider,
filesystem, process, persistence, or credential effect.

### Providers and credentials

A hostile provider can return extra fields, tool-call violations, malformed
stream chunks, or a response that tries to make a secret appear in a projection.
A compromised Renderer may try to read the provider list, cache, sentinel,
logs, persistence, or Worker environment. Main-side redaction, no-store
provider reads, sentinel stripping on writes, id-scoped credential fetch, and
closed Worker environment composition keep raw credentials Main-owned. A
redacted response is not permission to perform an unbounded provider request.

### Workspace, Git, and delivery

Files and Git metadata are hostile inputs: `..` traversal, absolute paths,
symlinks, replaced `.git` pointers, hooks, filters, includes, fsmonitor,
subdirectories, dirty trees, HEAD drift, and concurrent edits can redirect or
change an effect. Workspace grants, canonical-root resolution, Git checks,
repository locks, isolated worktrees, patch digests, dry-runs, approval
records, and post-approval revalidation must stop the effect. Goose never writes
the original workspace before the explicit apply operation is approved.

### Tool Gateway and approvals

An attacker may name an unknown tool, exploit a missing or conflicting rule,
reuse an approval, substitute a different attempt or operation, or race a
publish/apply effect. ToolGateway resolves a declared manifest and policy
before execution; exact approval records are persisted and consumed once. A
denied, expired, cancelled, stale, or cross-purpose approval cannot authorize
another protected operation.

### MCP, model loopback, and Workers

Local clients and model output can spoof Host, Origin, User-Agent, method,
content type, lease/token, model identity, tool count, or call identity, or
send malformed and oversized JSON/SSE frames. Worker launch can be attacked by
an unadmitted executable, digest, widened capability, inherited secret,
external network attempt, unexpected child, timeout, crash, cancellation, or
parent death. Authenticated loopback leases, bounded protocols, exact tool
admission, sandboxed Worker composition, closed environments, process-group
supervision, and cleanup verification form the boundary.

### Persistence, diagnostics, and artifacts

Persisted bytes may be replayed, stale, conflicting, cross-owner, truncated,
tampered, or structurally valid but unauthorized. Incidents and diagnostics
may accidentally include credentials, paths, prompt/completion text, tool
arguments, content references, patches, environment values, or linkable raw
identifiers. SQLite validation, compare-and-swap ordering, ownership checks,
durable terminal records, schema-23 audit-chain verification, fixed
complete-group retention, per-export aliases, exact metadata validators,
private atomic writes, artifact digests, package identity, source-copy checks,
licenses, SBOMs, and audit evidence prevent a durable, diagnostic, or packaged
substitution from becoming authority.

### Attacker stories

1. A compromised Renderer submits an unknown IPC operation with a prototype-
   bearing payload. Main rejects it before parsing an effect and records only
   bounded classification.
2. A provider returns two tool calls when one was admitted. The model broker
   rejects the completion; the Worker attempt fails with the model-contract
   incident and cannot be projected as completed or unchanged.
3. A coding Worker follows a symlink or Git filter toward the source checkout.
   Canonical-root and grant checks reject the operation; the original checkout
   remains byte-identical.
4. A user approves a publish operation, while an attacker replays that record
   as workspace apply. Exact operation and attempt binding rejects the replay.
5. A local process connects to a loopback endpoint with a wrong lease or sends
   an oversized frame after close. The authenticated, bounded protocol rejects
   it and cleanup leaves no process or lease residue.
6. A stale database row claims a task completed after a Worker crash. Ownership,
   compare-and-swap, terminal evidence, and restart reconciliation prevent the
   stale row from creating a second effect.
7. A packaged manifest points to a substituted executable or unexpected file.
   External digest, target, shape, source-copy, and license checks fail before
   admission.
8. A diagnostic export encounters a symlink destination, corrupt audit link,
   unresolved retention overflow, raw identifier, path, credential-shaped
   value, or oversized report. Main rejects the export and creates no widened
   report or Renderer authority.

## Severity Calibration

### Critical

Critical findings include raw credential disclosure, Renderer shell or
filesystem authority, unapproved modification of the original workspace,
arbitrary command execution outside ToolGateway, sandbox escape, or a
self-authorizing privileged executable. Any critical finding blocks P7.1 until
the owning boundary is repaired and regression-locked.

### High

High findings include approval or ToolGateway bypass, access outside an
authorized workspace, undeclared Worker network, replay of a protected effect,
authoritative persistence tampering, or a privileged orphan after rejection or
shutdown. Any high finding blocks P7.1 until repaired and regression-locked.

### Medium

Medium findings include a sanitized incident that leaks a user path or model
text, inaccurate terminal classification without authority gain, or
non-privileged temporary residue after safe denial. A deferral requires an
owner, invariant, reason it does not change authority, workaround, target P7
batch, and regression coverage.

### Low

Low findings include unclear denial guidance, overly broad non-sensitive
metadata, or missing coverage for a boundary independently proven elsewhere.
They still require an owner and target batch; they cannot disappear from the
ledger.

## P7 Evidence and Outcome Rules

The P7.1 outcome vocabulary is closed:

- `denied-safe`: the attack is rejected at the declared boundary, required
  evidence is present, and no forbidden effect occurs;
- `unsupported-platform`: the platform cannot enforce or verify the scenario;
  it is unverified and transferred to P8, never counted as a pass;
- `security-boundary-violated`: authority, protected data, approval, or state
  was bypassed;
- `cleanup-incomplete`: rejection left a process, lease, lock, private root,
  worktree, or other privileged residue;
- `evidence-incomplete`: rejection may have occurred, but durable, redacted,
  or no-side-effect proof is missing; and
- `test-harness-invalid`: the fixture or environment is not faithful.

Every case except `denied-safe` exits nonzero. P7.1's macOS aggregate gate
passes only when every required macOS case is `denied-safe`. Windows and Linux
obligations are recorded separately and are not silently skipped.

Evidence may contain IDs, classifications, booleans, bounded lengths, counts,
immutable digests when necessary, and sanitized exit shapes. It must never
contain API keys, authorization headers, provider URLs with embedded secrets,
prompt or completion text, tool arguments, content references, raw patches,
absolute user paths, environment values, or private Worker state.

The P7.1 catalog and ledger were initialized as `evidence-incomplete`; this
reviewed revision re-audits every invariant and case against the final P7
product-source parent without widening its disposition. P7.2-P7.4 add their
own local and packaged evidence and keep CI, merge, release, deployment, and
user acceptance separate.

## Related Authority

- [P7 Security and Reliability Hardening Design](../superpowers/specs/2026-08-13-p7-security-hardening-design.md)
- [P7.1 Threat Model and Abuse-Case Baseline Plan](../superpowers/plans/2026-08-13-p7-1-threat-model-abuse-baseline.md)
- [System Overview](../architecture/SYSTEM_OVERVIEW.md)
- [MVP Definition](../product/MVP.md)
- [Development Sequence](../roadmap/DEVELOPMENT_SEQUENCE.md)
- [ADR-0027](../architecture/decisions/0027-p7-threat-model-and-abuse-authority.md)
- [ADR-0028](../architecture/decisions/0028-p7-worker-resource-and-process-reliability.md)
- [ADR-0029](../architecture/decisions/0029-p7-diagnostic-export-and-audit-retention.md)

Repository: github.com/Ablankpaper/actestra-desktop
Version: 7b0c27f4af3bb4e0e0049a03646af19c4fa9acc2
