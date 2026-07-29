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
- Exact, unmodified 1,766-file AionUi `v2.1.41` desktop source foundation,
  Apache-2.0 license, immutable provenance, and per-file SHA-256 manifest.
- A machine preservation check for every frozen source file, all 27 native
  routes, and all 41 functional bridge domains.
- Native AionUi install, test, build, launch, and visual-evidence entrypoints.
- Full AionUi functional-UI retention matrix, preserve-first fusion topology,
  downstream patch rules, and F0-F7 migration phases.
- Reviewable F1 downstream overlay that materializes Actestra from the frozen
  AionUi foundation without modifying the upstream snapshot.
- Actestra-owned identity, icons, application ID, executable, protocol,
  repository links, and a private versioned profile with restrictive
  permissions.
- Fail-closed isolation for telemetry, updates, feedback upload, upstream
  official services, and public listeners while retaining the corresponding
  AionUi implementation and functional UI entries.
- Native F1 policy tests, CI-backed production and packaged smoke coverage,
  full local native regression execution, real Electron launch,
  runtime-boundary evidence, and an Actestra visual preservation screenshot.

### Changed

- Hardened the P2 merge gate with immutable CI action pins, canonical unique
  development staging, deterministic packaged-process cleanup, dynamic-import
  boundary checks, packaged DevTools denial, and environment-specific renderer
  CSP verification.
- Superseded the selective-port shell direction with ADR-0010: AionUi is now the
  retained product application, the P2 shell is a legacy platform harness, and
  Actestra authority is fused behind compatible providers.
- Assigned Goose to the preserved AionUi agent/ACP experience and Eigent-style
  orchestration to the preserved AionUi Team experience.
