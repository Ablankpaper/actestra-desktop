# Architecture Decision Records

Architecture Decision Records (ADRs) capture choices that constrain multiple
components or phases.

## Status values

- **Proposed** — under evaluation and not authoritative.
- **Accepted** — current architectural source of truth.
- **Partially superseded** — historical decision remains authoritative except
  for a section explicitly replaced by a newer ADR.
- **Superseded** — replaced by another ADR.
- **Rejected** — evaluated and intentionally not selected.

## Index

| ADR                                                            | Status                       | Decision                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-capability-fusion.md)                              | Accepted                     | Fuse capabilities, not repositories                                                                                                      |
| [0002](0002-single-source-of-truth.md)                         | Accepted                     | Actestra owns product state behind adapter and event boundaries                                                                          |
| [0003](0003-clean-shell-selective-ports.md)                    | Superseded                   | Build an Actestra-owned shell and port upstream modules selectively                                                                      |
| [0004](0004-core-domain-event-stream.md)                       | Accepted                     | Own the core domain and order events per worker attempt                                                                                  |
| [0005](0005-sqlite-persistence-and-migrations.md)              | Accepted                     | Use embedded SQLite behind ports with forward-only migrations                                                                            |
| [0006](0006-agent-adapter-lifecycle-and-supervision.md)        | Partially superseded by 0017 | Version and supervise immutable agent attempts; protocol v1 is historical                                                                |
| [0007](0007-privileged-service-authorization.md)               | Accepted                     | Gate privileged tools with policy, approval, credential, and audit evidence                                                              |
| [0008](0008-main-owned-projection-and-ipc.md)                  | Accepted                     | Keep platform evidence and closed renderer intents main-owned                                                                            |
| [0010](0010-aionui-first-product-foundation.md)                | Accepted                     | Preserve native AionUi as the product foundation and embed Goose and Eigent-style capabilities through its existing UI                   |
| [0011](0011-aionui-shadow-projection.md)                       | Accepted                     | Observe native AionUi metadata through an inert, main-owned P3 shadow projection                                                         |
| [0012](0012-aionui-approval-decision-authority.md)             | Accepted                     | Persist desktop AionUi confirmation decisions before native delivery and reconcile ambiguous outcomes                                    |
| [0013](0013-aionui-approval-delivery-policy-gate.md)           | Accepted                     | Gate persisted AionUi response delivery through one exact P3 policy, capability, and durable audit path                                  |
| [0014](0014-aionui-approval-reconciliation-policy-gate.md)     | Accepted                     | Gate the bounded native pending-state read used by retry and restart reconciliation                                                      |
| [0015](0015-crewai-supervised-orchestration-sidecar.md)        | Accepted                     | Evaluate CrewAI as a supervised P6 planner sidecar while Actestra retains team authority and Eigent remains the experience reference     |
| [0016](0016-p4-general-work-process-and-content-boundaries.md) | Accepted                     | Move workload persistence behind a utility boundary and add bounded workspace grants and content references before real workers or tools |
| [0017](0017-general-worker-process-and-agent-adapter-v2.md)    | Accepted                     | Run one supervised General Worker process per immutable Adapter v2 attempt                                                               |
| [0018](0018-scoped-native-text-tools-and-policy.md)            | Accepted                     | Admit only scoped workspace text read and create-only task-output write through trusted manifests and policy                             |
| [0019](0019-general-work-durable-coordination-and-recovery.md) | Accepted                     | Persist tool, artifact, event, terminal, and cleanup state before acknowledgement or release, then recover deterministically             |
| [0020](0020-preserved-aionui-general-work-journey.md)          | Accepted                     | Map one bounded General Work journey into preserved AionUI while Actestra retains workspace, task, artifact, and recovery authority      |
| [0021](0021-bounded-writing-artifact-journey.md)               | Accepted                     | Add one prompt-derived writing journey whose Worker-authored draft input persists before create-only document output                     |
| [0022](0022-bounded-office-document-artifact-journey.md)       | Accepted                     | Add one bounded Office journey that creates a real DOCX in main and projects only an owned document model into native Word Preview       |

## Creating an ADR

Use the next four-digit number and include:

1. context;
2. decision;
3. consequences;
4. rejected alternatives;
5. review triggers.

Do not rewrite an accepted ADR to reverse its decision. Add a new ADR that
supersedes it.
