# Architecture Decision Records

Architecture Decision Records (ADRs) capture choices that constrain multiple
components or phases.

## Status values

- **Proposed** — under evaluation and not authoritative.
- **Accepted** — current architectural source of truth.
- **Superseded** — replaced by another ADR.
- **Rejected** — evaluated and intentionally not selected.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-capability-fusion.md) | Accepted | Fuse capabilities, not repositories |
| [0002](0002-single-source-of-truth.md) | Accepted | Actestra owns product state behind adapter and event boundaries |
| [0003](0003-clean-shell-selective-ports.md) | Accepted | Build an Actestra-owned shell and port upstream modules selectively |
| [0004](0004-core-domain-event-stream.md) | Accepted | Own the core domain and order events per worker attempt |
| [0005](0005-sqlite-persistence-and-migrations.md) | Accepted | Use embedded SQLite behind ports with forward-only migrations |
| [0006](0006-agent-adapter-lifecycle-and-supervision.md) | Accepted | Version and supervise immutable agent attempts |
| [0007](0007-privileged-service-authorization.md) | Accepted | Gate privileged tools with policy, approval, credential, and audit evidence |
| [0008](0008-main-owned-projection-and-ipc.md) | Accepted | Keep platform evidence and closed renderer intents main-owned |
| [0009](0009-p4-general-work-process-and-content-boundaries.md) | Accepted | Define the first real worker, content, tool, and persistence process boundaries |

## Creating an ADR

Use the next four-digit number and include:

1. context;
2. decision;
3. consequences;
4. rejected alternatives;
5. review triggers.

Do not rewrite an accepted ADR to reverse its decision. Add a new ADR that
supersedes it.
