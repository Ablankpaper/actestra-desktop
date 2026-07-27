# Upstream Policy

## Purpose

Actestra uses upstream projects deliberately while preserving a coherent product,
security model, update path, and license trail.

## Current upstream roles

| Upstream | Intended role | Initial integration posture |
| --- | --- | --- |
| [AionUi](https://github.com/iOfficeAI/AionUi) | Desktop product foundation and general-work baseline | Evaluate and pin in P1 |
| [Goose](https://github.com/aaif-goose/goose) | Coding and terminal worker | External worker adapter in P5 |
| [Eigent](https://github.com/eigent-ai/eigent) | Multi-agent product and orchestration reference | Reference-first; selective reuse only after P6 analysis |

These roles are governed by
[ADR-0001](../architecture/decisions/0001-capability-fusion.md).

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

Choose the narrowest maintainable mechanism:

1. Published protocol or API.
2. Versioned child process or CLI adapter.
3. Published package dependency.
4. Small attributed source import.
5. Maintained fork or vendor subtree.

A broad source merge is a last resort and requires a new accepted ADR.

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
