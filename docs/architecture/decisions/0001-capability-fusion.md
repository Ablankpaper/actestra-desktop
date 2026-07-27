# ADR-0001: Fuse Capabilities, Not Repositories

- Status: Accepted
- Date: 2026-07-27

## Context

Actestra aims to combine:

- a consumer-friendly desktop workspace and general-work experience;
- a strong coding and terminal execution engine;
- visible multi-agent task decomposition and coordination.

AionUi, Goose, and Eigent represent these strengths, but each project has its
own lifecycle, configuration, state, assumptions, and update cadence. A direct
three-way source merge would create conflicting product models and make upstream
updates difficult to audit.

## Decision

Actestra will fuse capabilities through explicit product and runtime boundaries:

- **AionUi** is evaluated as the initial desktop product foundation.
- **Goose** is integrated as a specialized coding and terminal worker behind an
  Actestra adapter.
- **Eigent** is initially used as a product and orchestration reference. Actestra
  will implement the minimum required leader, dependency graph, worker, approval,
  retry, and aggregation behavior before considering deeper runtime reuse.

Repositories are not copied into one source tree by default. Every imported
upstream is pinned, licensed, reviewed, and introduced through a deliberate
integration mechanism.

## Consequences

### Positive

- One coherent user experience and data model.
- External engines can evolve or be replaced independently.
- Upstream changes remain reviewable.
- Security and approval policy are enforced once.
- Actestra can support future workers without redesigning the renderer.

### Costs

- Adapter and event translation work is required.
- Some upstream-native features may be deferred or unavailable.
- Actestra must own lifecycle, persistence, migration, and compatibility tests.
- Team orchestration cannot rely on UI-only simulation.

## Rejected alternatives

### Merge all three repositories

Rejected because it creates overlapping application state, dependency systems,
release processes, and permission models.

### Use only AionUi adapters without an Actestra core

Rejected because upstream adapters and session formats would become the product
contract and limit long-term control.

### Embed the full Eigent runtime first

Rejected for the initial phases because individual worker lifecycle and product
state must be stable before multi-agent complexity is introduced.

## Review triggers

Review this decision if:

- AionUi can no longer serve as a maintainable foundation;
- Goose provides a stable embeddable API that materially changes process
  isolation costs;
- Eigent exposes a mature runtime whose state and policy model can conform to
  Actestra without competing ownership;
- a new foundation satisfies the same product and governance goals at lower
  migration cost.
