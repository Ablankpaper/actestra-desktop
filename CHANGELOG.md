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
- Strict AionUi `v2.1.41` metadata observers for conversation, task, provider,
  workspace, approval, artifact, and runtime shapes.
- ADR-0011, a fixed fail-isolated observation bridge, deterministic
  metadata-only P3 projection, and SQLite schema version 4 shadow evidence
  separated from authoritative domain and event tables.
- F2 mapping, redaction, event ordering, duplicate, restart, corruption,
  persistence-failure, invariant-UI, and real native conversation-read
  evidence.
- ADR-0012 and F3.1 desktop confirmation authority: one fixed trusted-main-frame
  intent, immutable schema version 5 response/outbox records, persist-before-
  deliver ordering, duplicate and conflict handling, ambiguous-delivery and
  restart reconciliation, bounded native transport, and explicit rollback.
- Downstream routing for the preserved renderer permission cards and pet
  confirmation window without replacing their UI or native response shapes.
- ADR-0013 and F3.2 policy-gated approval response delivery: one exact
  loopback `network.request` manifest and allow rule, durable policy/start/
  outcome audit ordering, private compatibility-scoped correlation hashes,
  native structured-error preservation, uncertain-outcome reconciliation, and
  explicit F3.1 rollback without inferring the underlying native tool.
- ADR-0014 and F3.3 policy-gated approval reconciliation: one exact loopback
  pending-state read capability and allow rule, boolean-only in-memory result,
  concurrent-read coalescing, durable policy/start/outcome audit, fail-closed
  retry and restart behavior, and an explicit rollback of the read to F3.1
  while retaining F3.2 delivery, without persisting native confirmation
  content.
- ADR-0015 and the P6 orchestration boundary: CrewAI is the first supervised
  planner-sidecar candidate, Actestra remains the authoritative Team state
  machine, and Eigent remains the Team interaction and acceptance reference.
- ADR-0016 and the GW-P4.2 workload-persistence boundary: a separately built
  utility owns schemas 1 through 6, existing P3/F2/F3 operations, durable
  workspace grants, and immutable bounded UTF-8 content references.
- A strict version 1 persistence-utility protocol and async main client with
  correlation, size, timeout, digest, ownership, lifecycle, and process-exit
  validation and no synchronous main-process fallback.
- Preserved-AionUi initialization for the persistence utility, explicit
  compatibility unavailability, native type/test/build coverage, and source
  plus packaged-graph enforcement that SQLite is utility-only.
- ADR-0017 and GW-P4.3 AgentAdapter version 2 with typed tool-result
  resolution, explicit protocol-error signals, and a separate exact General
  Worker protocol version 1.
- A supervised, single-attempt General Worker utility process with strict
  negotiation, main-owned identities and normalized events, bounded messages,
  deterministic no-tool/tool/cancel fixtures, timeout and crash handling, and
  idempotent listener cleanup.
- Preserved-AionUi downstream worker materialization, native unit coverage,
  exact build-entry and authority-graph checks, and clean-profile startup
  probes that leave the renderer and original routes unchanged.
- Preserved-AionUI General Work commands for bounded prompt, reserved
  workspace-file, and local-research artifacts, with schema-versioned closed
  journey kinds, main-owned inputs, supervised Worker processing,
  create-only Markdown outputs, owned Preview, and prepared-task recovery.
- ADR-0024 and the exact Goose `v1.45.0` source, ACP, license, dependency,
  rollback, telemetry, network, artifact, and minimal-runner admission boundary.
- ADR-0025, a pinned Rust 1.96.1 minimal Goose core runner, exact lock and audit
  tools, CycloneDX 1.6 and immutable artifact evidence, strict ACP initialize,
  deny-network private supervision, and deterministic preparation, rejection,
  close, and process cleanup without adding a Goose UI or coding-session
  authority.

### Changed

- Stabilized the packaged external-Worker crash gate with a 15-second
  post-readiness quiescence window while retaining the real `SIGKILL`, failed
  Task, restart-recovery, and cleanup assertions.
- Hardened the AionUi-first review boundary with canonical capture-independent
  shadow revisions, exact workspace counts, explicit terminal-state mapping,
  durable evidence-tuple checks, normalized validation errors, service-owned
  abortable approval transport deadlines with in-flight retry guards, packaged
  CDP denial and an explicit legacy-variable compatibility contract, aligned
  Windows installer markers, contained materialization paths, bounded IPv4/IPv6
  loopback CDP evidence capture, and fail-closed macOS ad-hoc signing.
- Hardened the P2 merge gate with immutable CI action pins, canonical unique
  development staging, deterministic packaged-process cleanup, dynamic-import
  boundary checks, packaged DevTools denial, and environment-specific renderer
  CSP verification.
- Superseded the selective-port shell direction with ADR-0010: AionUi is now the
  retained product application, the P2 shell is a legacy platform harness, and
  Actestra authority is fused behind compatible providers.
- Assigned Goose to the preserved AionUi agent/ACP experience and Eigent-style
  orchestration to the preserved AionUi Team experience.
- Clarified that ADR-0017 supersedes only the AgentAdapter version and
  interface portions of ADR-0006; Actestra Core remains the sole event and
  attempt authority, and the deterministic P3 fake remains test
  infrastructure.
