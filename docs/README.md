# Actestra Documentation Index

This directory is the canonical entry point for Actestra product, architecture,
planning, and governance documents.

## Current truth

| Document                                                                                                               | Purpose                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [Project Status](PROJECT_STATUS.md)                                                                                    | Verified state, evidence, blockers, and next gate                                                                       |
| [MVP Definition](product/MVP.md)                                                                                       | Target users, journeys, scope, and success criteria                                                                     |
| [P2 Product Shell](product/P2_PRODUCT_SHELL.md)                                                                        | Implementation, review remediation, boundary, package, launch, and non-claim evidence                                   |
| [P3 Platform Core](product/P3_PLATFORM_CORE.md)                                                                        | Current phase order, decisions, exit evidence, and non-claims                                                           |
| [AionUi Native Foundation](product/AIONUI_NATIVE_FOUNDATION.md)                                                        | Exact native source, install, test, build, launch, visual evidence, and non-claims                                      |
| [AionUi F1 Identity and Isolation](product/AIONUI_F1_IDENTITY_ISOLATION.md)                                            | Downstream overlay, identity, private profile, effect policy, visual parity, and local plus CI evidence                 |
| [AionUi F2 Shadow Projection](product/AIONUI_F2_SHADOW_PROJECTION.md)                                                  | Seven-domain compatibility contract, metadata-only P3 shadow evidence, restart and UI-preservation proof                |
| [AionUi F3.1 Approval Decision Authority](product/AIONUI_F3_APPROVAL_AUTHORITY.md)                                     | Persist-before-deliver desktop confirmation authority, reconciliation, rollback, parity, and non-claims                 |
| [AionUi F3.2 Approval Delivery Policy Gate](product/AIONUI_F3_APPROVAL_POLICY_GATE.md)                                 | Exact loopback delivery capability, P3 policy and durable audit order, rollback, and non-claims                         |
| [AionUi F3.3 Approval Reconciliation Policy Gate](product/AIONUI_F3_APPROVAL_RECONCILIATION_GATE.md)                   | Exact pending-state read capability, retry/restart policy and audit, rollback, and non-claims                           |
| [P4 General Work](product/P4_GENERAL_WORK.md)                                                                          | Persistence utility, content/grant foundation, real-worker and native-tool sequence, validation, and non-claims         |
| [P5.2 Isolated Coding](product/P5_ISOLATED_CODING_CAPABILITY.md)                                                       | Closed worktree, Tool Gateway, process lifecycle, local evidence, and remaining ACP boundary                            |
| [AionUi-first PR 6 Review Closure](product/AIONUI_FIRST_PR6_REVIEW_CLOSURE.md)                                         | Partitioned review coverage, valid remediation, rejected candidates, package proof, blockers, and final gates           |
| [Development Sequence](roadmap/DEVELOPMENT_SEQUENCE.md)                                                                | Ordered phases, dependencies, and exit gates                                                                            |
| [System Overview](architecture/SYSTEM_OVERVIEW.md)                                                                     | Product boundaries, components, data ownership, and isolation                                                           |
| [AionUi–Actestra Fusion](architecture/AIONUI_ACTESTRA_FUSION.md)                                                       | Preserve-first topology, authority transition, phases, and patch rules                                                  |
| [P6 Supervised Provider Decision](architecture/decisions/0015-crewai-supervised-orchestration-sidecar.md)              | CLI/CrewAI pre-execution denial gates and Actestra authority; planner selection is amended by ADR-0026                  |
| [Actestra-Native Team Planner](architecture/decisions/0026-actestra-native-team-planner.md)                            | Versioned no-tool planner sidecar, packaging, Worker-readiness split, and rollback boundary                             |
| [P4 Process and Content Decision](architecture/decisions/0016-p4-general-work-process-and-content-boundaries.md)       | Persistence utility authority, workspace grants, bounded content references, AionUi preservation, and ordered follow-up |
| [General Worker and Adapter v2 Decision](architecture/decisions/0017-general-worker-process-and-agent-adapter-v2.md)   | One-process-per-attempt supervision, native protocol, typed tool results, event mapping, and rollback                   |
| [Scoped Native Text Tools Decision](architecture/decisions/0018-scoped-native-text-tools-and-policy.md)                | Closed text-read and create-only output capabilities, active-attempt derivation, scope, policy, audit, and rollback     |
| [General Work Recovery Decision](architecture/decisions/0019-general-work-durable-coordination-and-recovery.md)        | Schema 7 checkpoints, persist-before-acknowledgement/release, artifact binding, and deterministic restart recovery      |
| [Bounded Writing Journey Decision](architecture/decisions/0021-bounded-writing-artifact-journey.md)                    | Structured writing brief, Worker-authored private draft input, document Artifact, Preview, and recovery boundary        |
| [Bounded Office Document Journey Decision](architecture/decisions/0022-bounded-office-document-artifact-journey.md)    | Structured Office brief, main-owned DOCX creation, document Artifact, native Word Preview, and recovery boundary        |
| [Actestra-Owned Scheduled General Work Decision](architecture/decisions/0023-actestra-owned-scheduled-general-work.md) | Native Scheduled Tasks provider, schema-13 authority, main-owned timing, bounded execution, and restart boundary        |
| [Minimal Goose ACP Runner Decision](architecture/decisions/0024-minimal-goose-acp-runner.md)                           | Exact Goose source/protocol pin, minimal runner, artifact admission, isolation, authority, and rollback boundary        |
| [Goose RSA Metadata-Only Disposition](architecture/decisions/0025-goose-rsa-metadata-only-disposition.md)              | Exact non-compilation proof and fail-closed admission for the sole remaining RSA audit metadata finding                 |
| [Goose v1.45.0 Evaluation](upstream/GOOSE_V1.45.0_EVALUATION.md)                                                       | Exact release, ACP, license, artifact, dependency, RustSec, telemetry, network, rollback, and packaging evidence        |
| [GW-P4.6 Pause Handoff](handoffs/2026-07-30-gw-p4.6-local-gate-handoff.md)                                             | Exact safe-pause state, completed local evidence, non-claims, resume order, and remaining P4 work                       |
| [Architecture Decisions](architecture/decisions/README.md)                                                             | Accepted and proposed architectural decisions                                                                           |

## Governance

| Document                                             | Purpose                                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Git Workflow](governance/GIT_WORKFLOW.md)           | Branch, commit, pull request, tag, and merge rules                                 |
| [Upstream Policy](governance/UPSTREAM_POLICY.md)     | How AionUi, Goose, CrewAI, Eigent, and future upstreams are evaluated and imported |
| [Upstream Versions](governance/UPSTREAM_VERSIONS.md) | Exact upstream revisions and verification evidence                                 |
| [Release Evidence](governance/RELEASE_EVIDENCE.md)   | Required proof from local validation through user acceptance                       |

## Upstream evaluations

| Document                                                       | Purpose                                                                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [AionUi v2.1.41 Baseline](upstream/AIONUI_V2.1.41_BASELINE.md) | Exact pins, commands, validation, inventory, package evidence, and blockers |
| [AionUi Module Map](upstream/AIONUI_MODULE_MAP.md)             | R0, R1, R2, and build-support dispositions for the native foundation        |
| [AionUi Retention Matrix](upstream/AIONUI_RETENTION_MATRIX.md) | Full functional-UI preservation contract and acceptance proof               |
| [Upstream Import Log](upstream/IMPORT_LOG.md)                  | Per-module provenance, license, modification, and validation record         |

## Repository-level documents

| Document                                         | Purpose                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| [README](../README.md)                           | Product and repository entry point                        |
| [AGENTS](../AGENTS.md)                           | Instructions for coding agents and automated contributors |
| [Contributing](../CONTRIBUTING.md)               | Human contribution workflow                               |
| [Changelog](../CHANGELOG.md)                     | User-visible and operational change history               |
| [Third-Party Notices](../THIRD_PARTY_NOTICES.md) | Imported code and asset attribution inventory             |

## Authority order

When documents disagree, use this order:

1. Accepted architecture decision records.
2. System overview.
3. MVP definition.
4. Development sequence.
5. Project status.

`PROJECT_STATUS.md` may say that an accepted design is not implemented. Design
intent never overrides current evidence.

## Maintenance rules

- Keep links relative so the index works in local clones and on GitHub.
- Record decisions as ADRs instead of silently changing architectural language.
- Update project status after material implementation or verification work.
- Keep planned, locally validated, pushed, released, and accepted states
  separate.
- Use ISO dates (`YYYY-MM-DD`) and exact commit identifiers for evidence.
