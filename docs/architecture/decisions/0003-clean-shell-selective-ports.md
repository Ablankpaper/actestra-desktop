# ADR-0003: Build an Actestra-Owned Shell and Port Upstream Modules Selectively

- Status: Accepted
- Date: 2026-07-28

## Context

P1 verified AionUi `v2.1.41` as a useful desktop and general-work reference,
but it also identified product identity, data-path, telemetry, update,
extension, packaging, entitlement, dependency, and licensing surfaces that
cannot ship unchanged.

A repository-wide AionUi import would bring those surfaces into Actestra before
the product authority model is implemented. It would also add hundreds of
megabytes of promotional media and make it difficult to distinguish original
Actestra code from modified upstream code.

Actestra still needs a runnable desktop shell in P2 and a maintainable path for
reusing proven AionUi modules in later vertical slices.

## Decision

Actestra will implement an Actestra-owned Electron and React shell in this
repository. The initial shell may use dependency versions proven by the P1
baseline, but it will not copy AionUi application source.

Upstream code may enter later only as a selective port:

1. identify the smallest module that serves an accepted Actestra boundary;
2. record its upstream repository, tag, commit, original paths, destination
   paths, license, and local modifications in
   [the import log](../../upstream/IMPORT_LOG.md);
3. preserve required license and notice text;
4. adapt the module behind Actestra-owned contracts;
5. add boundary and compatibility tests;
6. keep the port reviewable as a distinct commit or patch series.

The Actestra shell owns:

- application name, bundle identifier, executable, icon, and protocol;
- application data and configuration directories;
- renderer-to-main IPC;
- window, permission, navigation, and network policy;
- packaging, update, signing, telemetry, and release configuration;
- source layout, tests, and build entrypoints.

AionCore and future workers remain outside the renderer and will be introduced
behind `AgentAdapter` in P3 and P4.

## Consequences

### Positive

- P2 can prove the independent product boundary before runtime integration.
- Upstream branding, endpoints, accounts, and release behavior are absent by
  construction.
- Every future upstream port has explicit provenance and a narrow review unit.
- Actestra can update or replace individual modules without replaying a broad
  repository merge.
- The repository stays small enough for ordinary clone, review, and CI flows.

### Costs

- Some useful AionUi UI and general-work modules must be ported deliberately.
- Actestra must own shell accessibility, state, tests, packaging, and migration
  design instead of inheriting them implicitly.
- Upstream updates require module-level comparison rather than a simple branch
  merge.

## Rejected alternatives

### Import the complete AionUi repository

Rejected because it would introduce unrelated history, media, identity,
endpoints, release scripts, and authority assumptions before their Actestra
replacements exist.

### Keep AionUi as a Git submodule

Rejected because Actestra would need invasive product modifications inside the
submodule, while ordinary builds would depend on nested Git state.

### Maintain only an overlay patch against an external checkout

Rejected because Actestra source and CI would not be self-contained, and patch
failures would become the primary development interface.

## Review triggers

Review this decision if:

- selective ports become more expensive than maintaining a clearly bounded
  fork;
- AionUi publishes stable packages or protocols that replace source ports;
- an accepted worker or UI boundary requires a cohesive upstream subsystem that
  cannot be reviewed module by module.

A decision to vendor or merge a broad upstream tree requires a new ADR that
supersedes this one.
