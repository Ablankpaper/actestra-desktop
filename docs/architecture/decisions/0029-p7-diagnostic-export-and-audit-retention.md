# ADR-0029: P7 Diagnostic Export and Privileged-Audit Retention

- Status: Accepted
- Date: 2026-08-16
- Owners: Actestra Core, Main, Persistence, Security, and Release
- Phase: P7.4 Diagnostic export and audit retention
- Related: [ADR-0005](0005-sqlite-persistence-and-migrations.md),
  [ADR-0007](0007-privileged-service-authorization.md),
  [ADR-0008](0008-main-owned-projection-and-ipc.md), and
  [ADR-0027](0027-p7-threat-model-and-abuse-authority.md)

## Context

Actestra already persists metadata-only privileged audit records and terminal
Worker-attempt evidence behind the SQLite utility boundary. P7.1 requires
diagnostic evidence to remain bounded and redacted, but the product has no
user-visible export path, no fixed audit-retention policy, and no integrity
proof that distinguishes an intentionally retained prefix from record
deletion or tampering.

P7.4 must add those controls without restoring upstream telemetry or feedback
upload, exposing SQLite or filesystem authority to Renderer, changing the
frozen AionUI foundation in place, or exporting prompts, model content, tool
payloads, credentials, paths, patches, logs, environment values, or raw
identifiers.

## Decision

### 1. Diagnostic export is explicit, local, and Main-owned

The AionUI-native settings surface explains what the report includes and
excludes before offering an export action. A report is created only after the
user confirms that explanation and then chooses a destination in Electron's
native save dialog. Cancelling either decision creates no file.

Electron Main obtains bounded evidence through the persistence utility,
constructs and validates the report, and writes one private JSON file
atomically. It returns only one closed result: `saved`, `cancelled`, or
`rejected`. Renderer and preload receive no selected path, report bytes, raw
audit records, SQLite access, logs, credentials, or generic filesystem
capability.

The export is local-only. P7.4 does not add Sentry, telemetry, feedback upload,
automatic collection, remote support submission, or background export.

### 2. Export data is a closed metadata contract

Diagnostic export schema 1 contains only:

- bounded application name, version, platform, architecture, and
  development/packaged classification;
- a validated retention summary;
- at most 1,000 recent metadata-only privileged audit events; and
- at most 50 recent terminal Worker-attempt summaries.

Every request and attempt identifier is replaced with an opaque, per-export
alias. Stable event, action, resource, outcome, state, count, boolean, time,
and digest fields are accepted only through exact-key validators. The encoded
report may not exceed 2 MiB.

The report explicitly excludes credentials and provider configuration,
prompts and completions, tool arguments and results, content references and
patches, user paths, environment values, raw logs, and raw identifiers. A
value that cannot be represented by the closed contract causes the export to
fail closed rather than widening the report.

### 3. The retention policy is fixed and bounded

Privileged audit retention policy 1 keeps no more than 90 days and no more
than 100,000 records. The SQLite persistence utility is the sole authority
that may verify or maintain this policy. Callers cannot select a wider age,
count, or deletion range.

Retention may remove only one contiguous oldest prefix composed entirely of
complete terminal request groups. A group is terminal only when its last
record is a closed tool outcome (`tool.completed` or `tool.failed`) and every
record for that request lies inside the candidate prefix. An unresolved or
partially selected request group is preserved. If the hard count bound cannot
be met without deleting such a group, maintenance fails closed and deletes
nothing.

### 4. Schema 23 proves retained-chain integrity

Forward migration 23 adds a domain-separated SHA-256 chain for every
privileged audit record and one singleton retention state. Legacy records are
chained in their existing sequence order during migration or first verified
maintenance. Each subsequent append stores its chain link atomically with the
record. Reads, summaries, export, and maintenance verify the retained chain
before returning evidence.

When a valid prefix is pruned, the state retains the last deleted sequence and
digest as the prefix anchor. The first retained record must extend that anchor;
the final retained digest is the chain head. Sequence, record JSON, indexed
projection, chain link, policy state, anchor, or count disagreement is
`corrupt-database` and fails closed. No destructive repair is attempted.

The existing audit summary remains compatible: `recordCount` reports total
accepted records (pruned plus retained), and `lastSequence` remains the
immutable latest sequence.

### 5. AionUI remains the only product surface

The user-visible entry is delivered as a recorded downstream overlay/patch
against pinned AionUI v2.1.41 and is classified under the retention matrix.
The frozen source in `foundation/` is not edited. The patch adds no Goose,
Eigent, or separate diagnostics application UI.

### 6. Scope and non-claims remain explicit

P7.4 proves the local development build and exact packaged macOS application.
It does not prove Windows/Linux behavior, formal signing, notarization,
distribution, release, deployment, remote support ingestion, encryption at
rest, or final user acceptance. Those remain P8 or release obligations.

## Consequences

### Positive

- Users can deliberately save useful bounded evidence without granting the
  Renderer privileged data or filesystem authority.
- Audit deletion becomes policy-governed and distinguishable from corruption.
- Existing SQLite, Main/Core, IPC, and AionUI boundaries remain the authority.
- A stable report schema can be reviewed and tested for redaction without
  depending on raw application logs.

### Costs

- Audit append, startup, retention, and export perform additional SHA-256 and
  validation work.
- Unresolved request groups may temporarily keep more than the hard count;
  such a state blocks maintenance/export instead of silently deleting evidence.
- Schema 23 is forward-only; rollback requires restoring a schema-22 backup or
  shipping another forward migration.

## Rejected alternatives

### Upload diagnostics or restore upstream feedback services

Rejected because P7.4 requires explicit local export and has no accepted
remote recipient, privacy contract, credential boundary, or release service.

### Export raw logs or database rows

Rejected because they can contain credentials, paths, prompts, model content,
tool payloads, patches, environment values, and attacker-controlled text.

### Let Renderer build or write the report

Rejected because it would expose persistence records, destination paths, or
filesystem authority outside Electron Main.

### Delete individual old records or unresolved request groups

Rejected because it destroys request-level audit meaning and makes a retained
history indistinguishable from partial tampering.

### Make retention limits caller-configurable

Rejected because a renderer, provider, or Worker-controlled widening is not a
security boundary. Policy changes require reviewed product code, migration,
tests, and evidence.

## Rollback

Rollback removes the downstream diagnostics surface, closed IPC operation,
Main exporter, and scheduled retention call. Schema 23 data remains readable
only by builds that understand its integrity state; a binary rollback therefore
requires restoring the pre-migration backup described by ADR-0005. Rollback
must not delete or rewrite audit evidence in place.

## Review triggers

Review this decision if a remote diagnostic recipient, user-selectable
retention, encryption at rest, multi-user identity, support-bundle format,
additional exported evidence class, Windows/Linux implementation, or a new
persistence authority is proposed; or if the fixed limits cannot be preserved
without weakening fail-closed behavior.
