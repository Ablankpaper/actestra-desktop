# Upstream Policy

## Purpose

Actestra uses upstream projects deliberately while preserving a coherent product,
security model, update path, and license trail.

## Current upstream roles

| Upstream | Intended role | Initial integration posture |
| --- | --- | --- |
| [AionUi](https://github.com/iOfficeAI/AionUi) | Complete functional UI and general-work product foundation | Exact frozen downstream source foundation plus reviewed patches under ADR-0010 |
| [Goose](https://github.com/aaif-goose/goose) | Coding and terminal worker | External worker adapter in P5 |
| [CrewAI](https://github.com/crewAIInc/crewAI) | First P6 planner-sidecar candidate | Reference and protocol evaluation first; no runtime import before the ADR-0015 production gate |
| [Eigent](https://github.com/eigent-ai/eigent) | Multi-agent product, Team experience, and acceptance reference | Reference-first; no complete UI, service, memory, tool, workspace, or CAMEL-runtime import |

These roles are governed by
[ADR-0001](../architecture/decisions/0001-capability-fusion.md) and
[ADR-0010](../architecture/decisions/0010-aionui-first-product-foundation.md).
The CrewAI and Eigent P6 split is governed by
[ADR-0015](../architecture/decisions/0015-crewai-supervised-orchestration-sidecar.md).

## Import requirements

Before importing source, assets, packages, binaries, prompts, skills, or models:

1. identify the canonical upstream repository;
2. pin an exact immutable commit;
3. record any human-readable version or tag;
4. inspect repository LICENSE and NOTICE files;
5. inspect the license of imported assets, bundled binaries, model weights, and
   generated resources separately;
6. choose and document the integration mechanism;
7. record modified upstream files and local patches;
8. update [Upstream Versions](UPSTREAM_VERSIONS.md);
9. update [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md);
10. run the relevant build, test, packaging, and migration checks.

## Integration mechanisms

For a new upstream, choose the narrowest maintainable mechanism:

1. Published protocol or API.
2. Versioned child process or CLI adapter.
3. Published package dependency.
4. Small attributed source import.
5. Maintained fork or vendor subtree.

A broad source foundation is a last resort and requires a new accepted ADR.
ADR-0010 is that accepted exception for the exact AionUi `v2.1.41` snapshot;
it does not authorize complete imports from Goose, CrewAI, Eigent, or another
project.

## AionUi preservation rule

AionUi user functions and their functional UI use a preserve-by-default
contract:

- R0 retains native UI and behavior;
- R1 retains UI and semantics while swapping the provider;
- R2 retains the source, entry, and workflow while isolating unsafe external
  effects.

The frozen native snapshot is not edited in place. Downstream patches must cite
the retention level, affected routes and bridge domains, Actestra authority
owner, migration and rollback behavior, and native-plus-compatibility evidence.
An unavailable provider is not a reason to delete its UI.

See the
[AionUi Retention Matrix](../upstream/AIONUI_RETENTION_MATRIX.md).

## P6 orchestration rule

Actestra owns the P6 dependency graph, attempts, budgets, approvals, artifacts,
events, audit, cancellation, and recovery state. CrewAI may be evaluated only
as a separately supervised planner, replanner, and result-aggregation sidecar.
Its private persistence, memory, identifiers, tracing, retry, human-feedback,
and tools cannot become product authority.

Eigent remains the reference for visible Team behavior and acceptance. Its
separate application UI and full runtime are not imported by default.

Before a CrewAI package or runtime is introduced, the implementation change
must pin the exact version and rollback version, lock a minimal Python
dependency graph, record license and vulnerability evidence, prove telemetry
and network isolation, and verify process cleanup and packaging on every target
platform.

## Data and authority

An upstream runtime may not become the implicit owner of:

- Actestra user identity;
- workspace grants;
- product credentials;
- approval evidence;
- cross-worker task state;
- audit history;
- update or release authority.

Adapters translate to Actestra-owned contracts defined in
[System Overview](../architecture/SYSTEM_OVERVIEW.md).

## Update workflow

For each update:

1. open a dedicated `upstream/<project>-<version>` branch;
2. compare release notes and the exact commit range;
3. inspect license, NOTICE, dependency, migration, telemetry, update, and
   security changes;
4. update the pin and local patches;
5. run baseline and Actestra compatibility tests;
6. build representative desktop packages;
7. update changelog, notices, and evidence;
8. merge only after compatibility and rollback are understood.

## License posture

Apache-2.0 and other permissive licenses may permit commercial and closed-source
distribution, but they still impose preservation, attribution, modification,
NOTICE, and patent-related obligations. A repository-level license does not
automatically cover its dependencies, model weights, fonts, icons, skills,
plugins, MCP servers, or cloud services.

The root license for original Actestra code remains an owner decision. Do not
infer it from an upstream license.
