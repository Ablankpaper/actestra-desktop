# Actestra

> Work, orchestrated.

Actestra is an independent, cross-platform desktop workspace for general AI work,
coding tasks, and coordinated multi-agent execution.

The product direction is intentionally modular:

- AionUi is an evaluated desktop and general-work reference; useful modules may
  enter later as selective, attributed ports.
- Goose is integrated later as a specialized coding and terminal worker.
- Eigent informs the multi-agent orchestration experience; its repository is not
  merged wholesale into Actestra.

Actestra is a new product. It does not share code, identity, data, configuration,
release infrastructure, or product boundaries with Aera.

## Current state

P2 is accepted on `main`.
[Pull request 2](https://github.com/bignormal/actestra-desktop/pull/2) squash
merged the independent product shell at
`76d6a58b20c3e010ee759358f2c86be80bc6a6c1`, and
[main CI](https://github.com/bignormal/actestra-desktop/actions/runs/30329620829)
passes on that exact commit.

Actestra is in **P3 — Platform Core and Contracts** on
`feat/platform-core-contracts`. P3.1 domain records and lifecycle rules plus the
P3.2 version 1 event contract are implemented at
`31dd6e4178eb7641b45be0ee2bccb862a96dac99` and pass
[PR CI run 30331681309](https://github.com/bignormal/actestra-desktop/actions/runs/30331681309).
P3.3 now has a locally validated storage-neutral persistence port, accepted
SQLite/migration decision, forward-only schema registry, and main-owned adapter;
its exact pushed-commit and CI evidence are not yet recorded. Worker,
privileged-service, and renderer integration work has not started.

- The Electron 37.10.3 and React 19.2.4 shell is original Actestra source; no
  AionUi, AionCore, Goose, Eigent, Aera, or AgentEra application source or asset
  has been copied.
- Product name, bundle identifier, executable, icon, deep-link scheme, and
  versioned data layout are Actestra-owned.
- The renderer is sandboxed and receives only two typed, non-privileged bridge
  operations. External HTTP, HTTPS, WebSocket, permissions, navigation, new
  windows, telemetry, updates, and accounts are inactive.
- Nine test files with 54 tests, an exact Electron-runtime SQLite probe, a
  three-scenario process-failure harness,
  formatting, lint, strict types, product-boundary checks, renderer build,
  unsigned arm64 app/DMG/ZIP packaging, packaged identity/CSP checks, and a
  fresh-profile three-stage startup smoke pass locally.
- The pure TypeScript core contract has no Electron, filesystem, shell, network,
  credential, or renderer authority. SQLite remains behind that port and is not
  registered with app startup, preload, or renderer. The shell still has no
  active task persistence, worker runtime, tool execution, or orchestration;
  later P3 slices prove those boundaries with a deterministic fake before any
  real worker is integrated.
- There is no CI-backed candidate, signed release, deployment, distribution, or
  user acceptance.

See [Project Status](docs/PROJECT_STATUS.md) for the evidence-backed state.
The local P2 proof is recorded in
[P2 Product Shell](docs/product/P2_PRODUCT_SHELL.md).
The current execution order is recorded in
[P3 Platform Core](docs/product/P3_PLATFORM_CORE.md).

## Start here

1. [Documentation Index](docs/README.md)
2. [MVP Definition](docs/product/MVP.md)
3. [Development Sequence](docs/roadmap/DEVELOPMENT_SEQUENCE.md)
4. [System Overview](docs/architecture/SYSTEM_OVERVIEW.md)
5. [Git Workflow](docs/governance/GIT_WORKFLOW.md)
6. [Upstream Policy](docs/governance/UPSTREAM_POLICY.md)
7. [AionUi Baseline Evidence](docs/upstream/AIONUI_V2.1.41_BASELINE.md)

Repository-wide instructions are in [AGENTS.md](AGENTS.md). Contribution rules
are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture stance

Actestra owns the user-facing product state: workspaces, tasks, permissions,
credentials, events, artifacts, and audit history. External agent runtimes are
workers behind a stable adapter and event boundary; they do not become competing
sources of truth.

```mermaid
flowchart LR
    UI["Actestra Desktop"] --> CORE["Actestra App Core"]
    CORE --> GENERAL["General Worker"]
    CORE --> GOOSE["Goose Worker"]
    CORE --> TEAM["Team Orchestrator"]
    GENERAL --> TOOLS["MCP and Tool Gateway"]
    GOOSE --> TOOLS
    TEAM --> GENERAL
    TEAM --> GOOSE
```

The accepted decisions are recorded in
[Architecture Decisions](docs/architecture/decisions/README.md).

## Licensing

The license for original Actestra code has not yet been selected. Referencing an
upstream project does not mean its code has been imported. When third-party code
is introduced, its exact version, commit, license, notices, and local
modifications must be recorded according to the
[Upstream Policy](docs/governance/UPSTREAM_POLICY.md).

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the current inventory.
