# Actestra Documentation Index

This directory is the canonical entry point for Actestra product, architecture,
planning, and governance documents.

## Current truth

| Document | Purpose |
| --- | --- |
| [Project Status](PROJECT_STATUS.md) | Verified state, evidence, blockers, and next gate |
| [MVP Definition](product/MVP.md) | Target users, journeys, scope, and success criteria |
| [P2 Product Shell](product/P2_PRODUCT_SHELL.md) | Implementation, review remediation, boundary, package, launch, and non-claim evidence |
| [P3 Platform Core](product/P3_PLATFORM_CORE.md) | Current phase order, decisions, exit evidence, and non-claims |
| [AionUi Native Foundation](product/AIONUI_NATIVE_FOUNDATION.md) | Exact native source, install, test, build, launch, visual evidence, and non-claims |
| [AionUi F1 Identity and Isolation](product/AIONUI_F1_IDENTITY_ISOLATION.md) | Downstream overlay, identity, private profile, effect policy, visual parity, and local plus CI evidence |
| [Development Sequence](roadmap/DEVELOPMENT_SEQUENCE.md) | Ordered phases, dependencies, and exit gates |
| [System Overview](architecture/SYSTEM_OVERVIEW.md) | Product boundaries, components, data ownership, and isolation |
| [AionUi–Actestra Fusion](architecture/AIONUI_ACTESTRA_FUSION.md) | Preserve-first topology, authority transition, phases, and patch rules |
| [Architecture Decisions](architecture/decisions/README.md) | Accepted and proposed architectural decisions |

## Governance

| Document | Purpose |
| --- | --- |
| [Git Workflow](governance/GIT_WORKFLOW.md) | Branch, commit, pull request, tag, and merge rules |
| [Upstream Policy](governance/UPSTREAM_POLICY.md) | How AionUi, Goose, Eigent, and future upstreams are evaluated and imported |
| [Upstream Versions](governance/UPSTREAM_VERSIONS.md) | Exact upstream revisions and verification evidence |
| [Release Evidence](governance/RELEASE_EVIDENCE.md) | Required proof from local validation through user acceptance |

## Upstream evaluations

| Document | Purpose |
| --- | --- |
| [AionUi v2.1.41 Baseline](upstream/AIONUI_V2.1.41_BASELINE.md) | Exact pins, commands, validation, inventory, package evidence, and blockers |
| [AionUi Module Map](upstream/AIONUI_MODULE_MAP.md) | R0, R1, R2, and build-support dispositions for the native foundation |
| [AionUi Retention Matrix](upstream/AIONUI_RETENTION_MATRIX.md) | Full functional-UI preservation contract and acceptance proof |
| [Upstream Import Log](upstream/IMPORT_LOG.md) | Per-module provenance, license, modification, and validation record |

## Repository-level documents

| Document | Purpose |
| --- | --- |
| [README](../README.md) | Product and repository entry point |
| [AGENTS](../AGENTS.md) | Instructions for coding agents and automated contributors |
| [Contributing](../CONTRIBUTING.md) | Human contribution workflow |
| [Changelog](../CHANGELOG.md) | User-visible and operational change history |
| [Third-Party Notices](../THIRD_PARTY_NOTICES.md) | Imported code and asset attribution inventory |

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
