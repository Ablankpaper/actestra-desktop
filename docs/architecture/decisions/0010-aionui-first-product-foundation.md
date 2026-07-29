# ADR-0010: Preserve AionUi as the Product Foundation

- Status: Accepted
- Date: 2026-07-29
- Supersedes:
  [ADR-0003](0003-clean-shell-selective-ports.md)

## Context

ADR-0001 assigned AionUi the desktop product and general-work role, Goose the
specialized coding-worker role, and Eigent the orchestration-reference role.
P1 reproduced AionUi `v2.1.41` at exact commit
`2d8925fc67a97a20996fadcd2a0862b778b572ba`.

ADR-0003 later optimized for an original Actestra shell and selective source
ports. P2 and P3 produced useful independent identity, persistence, lifecycle,
policy, approval, audit, and renderer-authority contracts, but the shell
direction displaced the selected AionUi experience. Recreating only its visual
appearance would still discard useful original functions and duplicate their
interaction design.

The owner has clarified the intended product composition:

- retain AionUi's original functional UI and functions as completely as
  practical;
- make that native application the visible product base;
- fuse the accepted Actestra core beneath it;
- expose Goose coding and Eigent-style orchestration through AionUi's existing
  agent, conversation, and Team experiences.

## Decision

Actestra will maintain a downstream product fork of AionUi `v2.1.41`.
Preservation is the default. The exact native source, routes, components,
interactions, and user functions form the golden baseline.

Actestra will not:

- use a separately drawn shell as the target product;
- selectively recreate AionUi's appearance while omitting its functions;
- remove a user feature solely because its Actestra provider is not ready in
  the current phase;
- show separate Goose or Eigent application interfaces.

Each AionUi functional area is classified as:

1. **R0 — exact retain**: keep UI and behavior as the golden baseline;
2. **R1 — compatible provider**: keep UI and user-visible semantics while
   replacing identity, data, runtime, permission, or service authority behind a
   compatible interface;
3. **R2 — retained but isolated**: keep source, route, entry, and intended
   workflow, but block unsafe external effects with an explicit unavailable
   state until the Actestra-owned boundary is ready.

The complete classifications and acceptance requirements are recorded in the
[AionUi Retention Matrix](../../upstream/AIONUI_RETENTION_MATRIX.md).

## Product roles

- **AionUi product foundation** — window, navigation, Guide, conversations,
  history, models/providers, agents, assistants, Skills, MCP/tools, files,
  previews, scheduled tasks, Team, appearance, extensions, Hub, WebUI, remote
  agents, channels, notifications, deep links, pet, settings, diagnostics, and
  update experience.
- **Actestra authority** — product/profile identity, authoritative task and
  event state, persistence and migrations, workspace grants, credentials,
  policy, approvals, audit, artifacts, worker supervision, packaging, updates,
  provenance, and release.
- **Goose capability** — coding, repository, worktree, terminal, diff, and test
  execution through `AgentAdapter`, registered in AionUi's existing agent/ACP
  surfaces.
- **Eigent-style capability** — planning, dependencies, parallel workers,
  approval nodes, retry, handoff, and aggregation mapped into AionUi's existing
  Team UI and event shapes.

## Source strategy

The first foundation slice is the complete runnable desktop AionUi `v2.1.41`
source, build, test, and functional-resource selection at the accepted commit.
It is stored as a frozen 1,766-file source tree with:

- the upstream Apache-2.0 license;
- an immutable provenance record;
- a SHA-256 manifest for every source-snapshot file;
- a root check for all file hashes, all 27 router paths, and all 41 bridge
  domains;
- native dependency install, test, build, launch, and screenshot evidence.

The frozen snapshot is not edited in place. Product changes use a reviewable
downstream patch series or overlay. Each patch identifies upstream files and
symbols, its R0/R1/R2 classification, the Actestra authority owner, migration
and rollback behavior, and native-plus-compatibility tests.

Updating to a later AionUi version is a separate upstream change. It must
reproduce the new native baseline, compare the retention contract, and replay
the downstream patches with explicit differences.

## Runtime and data transition

The accepted P3 core is retained and becomes the authority layer beneath
AionUi. Migration proceeds by bridge domain:

1. native baseline in an isolated test profile;
2. read-only or metadata-only Actestra shadow projection;
3. Actestra-authoritative writes with native shapes preserved;
4. migrated native storage becomes read-only compatibility input.

Two stores may not silently own the same domain.

The exact AionCore `v0.1.52` runtime may be used during native reproduction and
early compatibility work so original functions remain testable. It is a
supervised general-worker compatibility runtime, not the long-term owner of
Actestra task, approval, audit, or release state. Distribution remains blocked
until the observed Apache-2.0 root license versus MIT Cargo metadata
inconsistency is resolved and binary provenance is accepted.

The implementation topology and ordered phases are defined in
[AionUi–Actestra Fusion Architecture](../AIONUI_ACTESTRA_FUSION.md).

## External effects

Preserving UI does not authorize upstream external effects. AionUi accounts,
official-service endpoints, telemetry, update feeds, publishing credentials,
application directories, bundle identifiers, protocols, credentials, signing,
and release infrastructure are R1 or R2:

- retain the corresponding user flow and states;
- default unsafe or unowned effects to isolated;
- replace the provider with an Actestra-owned, policy-scoped implementation;
- prove offline, failure, denial, cancellation, migration, and rollback
  behavior before activation.

## Consequences

### Positive

- Users receive the mature AionUi interface and useful original functions
  instead of a partial imitation.
- General, coding, and team work share one familiar product surface.
- P3 security, lifecycle, data, approval, and audit work remains reusable.
- Exact-source and compatibility checks make upstream and downstream drift
  reviewable.
- Temporarily unavailable services do not erase their future UI and workflow.

### Costs

- The repository carries a substantial pinned downstream source foundation.
- Every AionUi update requires a native-baseline replay and downstream patch
  rebase.
- Actestra must preserve both visual behavior and bridge compatibility while
  replacing authority.
- Native upstream dependencies and external-service assumptions require staged
  isolation, migration, and cross-platform testing.
- AionCore licensing must be resolved before a distributed candidate can rely
  on it.

## Rejected alternatives

### Continue the original Actestra shell

Rejected because it would make the P2 shell, rather than the selected AionUi
experience, the visible product and would require reimplementing mature
functions.

### Recreate only AionUi's visual style

Rejected because visual similarity does not preserve route behavior,
conversation workflows, settings, assistants, Skills, MCP, previews, scheduled
tasks, Team, extensions, remote features, or their tests.

### Keep only a small selective source port

Rejected because AionUi's renderer and functional bridges form a cohesive
application. Repeatedly extracting small pieces would create a permanent,
incomplete imitation and make upstream updates harder to reconcile.

### Merge AionUi, Goose, and Eigent wholesale

Rejected because their data, process, permission, update, and release models
would compete. AionUi supplies the product UI; Goose and Eigent-style behavior
enter through assigned Actestra boundaries.

### Run three separate product interfaces

Rejected because users should not manage separate histories, settings,
permissions, and mental models.

## Review triggers

Review this decision if:

- legal review prevents maintaining or distributing the chosen AionUi
  downstream fork;
- a newer exact AionUi revision materially improves maintainability and passes
  the full retention gate;
- AionUi publishes a stable package or protocol that preserves the full product
  experience with a smaller source boundary;
- measured product evidence shows that a retained function should be retired,
  in which case a new owner-approved decision must name the specific function,
  migration, and user impact.
