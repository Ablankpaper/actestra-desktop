# Changelog

All notable changes to Actestra will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/) once versioned
releases begin.

## [Unreleased]

### Added

- Initial repository and documentation baseline.
- Product scope, development sequence, architecture boundaries, and governance.
- Exact AionUi `v2.1.41` and AionCore `v0.1.52` evaluation pins.
- Reproducible macOS baseline evidence, dependency and license inventory,
  package checksums, known blockers, and the AionUi module disposition map.
- Original Actestra Electron and React product shell with independent identity,
  icon, protocol, and versioned data layout.
- Sandboxed renderer, typed preload bridge, deny-by-default permission and
  navigation handling, and an offline external-network policy.
- Locked Bun dependency graph, formatting, lint, strict types, unit and renderer
  tests, product-boundary checks, macOS packaging verification, and
  fresh-profile startup smoke coverage.
- Single Codex run, debug, logs, telemetry, and verification entrypoint plus a
  macOS CI workflow.
- ADR-0003 and the upstream import log for clean-shell and selective-port
  governance.
- Actestra-owned P3.1 domain records, lifecycle transition validation, and
  cross-workspace graph invariants.
- Version 1 per-attempt core event envelopes with deterministic ordering,
  idempotent append, replay cursors, terminal enforcement, and diagnostic
  redaction.
- ADR-0004 for authoritative domain lifecycles and per-attempt event streams.
- ADR-0009 for the first real-process general-work, persistence, content,
  scoped-tool, and recovery boundaries.
- A versioned persistence utility protocol, Electron utility-process launcher,
  schema 4 workspace grants, and bounded UTF-8 content references with exact
  ownership, expiry, consumption, and digest validation.

### Changed

- Hardened the P2 merge gate with immutable CI action pins, canonical unique
  development staging, deterministic packaged-process cleanup, dynamic-import
  boundary checks, packaged DevTools denial, and environment-specific renderer
  CSP verification.
- Moved synchronous SQLite ownership out of Electron main and added packaged
  entry-graph isolation plus schema 4 fresh-profile smoke verification.
