# Goose v1.45.0 P5 Evaluation

Status: Verified P5 source, protocol, license, artifact, and dependency
evidence; P8.2c pins a private default-off runtime adapter, but adapted Windows
execution is not yet verified

Verification dates: upstream evaluation 2026-08-01; private runtime pin
2026-08-19

Decision: [ADR-0024](../architecture/decisions/0024-minimal-goose-acp-runner.md)

## Exact upstream identity

| Field | Verified value |
| --- | --- |
| Canonical repository | `https://github.com/aaif-goose/goose` |
| Stable release | `v1.45.0`, published 2026-07-29 |
| Exact commit | `4dc0420f5704a92806c6628c8f0a3497d7a88759` |
| Root license | Apache-2.0 |
| Root `NOTICE` | Absent |
| Rust workspace version | `1.45.0` |
| Rust MSRV | `1.94.1` in workspace metadata; repository toolchain file requests `1.96.1` |
| ACP crates in exact lock | `agent-client-protocol 1.0.1`; schema `1.1.0` |
| Rollback comparison | `v1.44.0` at `876555f85b1bd0e15ed75eed7c5ac1163c1f097a` |

The `v1.45.0` tag resolves to the exact commit above. The tag commit is not
cryptographically signed. GitHub attestation verification of the release asset
does bind the asset to upstream workflow `release.yml`, run `30484854946`, tag
`v1.45.0`, and the same source commit. This is useful provenance but does not
replace Actestra artifact admission or signing.

`v1.44.0` is the lowest allowed rollback comparison because it fixes
`GHSA-r5pp-p5r8-466r`, an arbitrary-command-execution issue involving
`goose review` and Git `core.fsmonitor`. Earlier versions are excluded.

## Protocol and process surface

The upstream CLI exposes `goose acp` as an ACP agent server over stdio. Its
implementation calls the public Goose core function:

```rust
goose::acp::server::run(builtins, enable_scheduler).await
```

The core also exposes `run(Vec::new(), false)`, which creates an stdio server
with no builtins and no scheduler. Initialize returns `agentInfo` with name
`goose` and `env!("CARGO_PKG_VERSION")`, providing an exact version gate.

This entry point permits an Actestra-owned minimal runner that excludes the
upstream CLI crate. Actestra will not use `goose serve`, HTTP/WebSocket ACP,
`--dangerously-unauthenticated`, `--with-builtin developer`, or the scheduler.
No second UI is involved.

### P8.2c private runtime adapter source

Actestra now resolves the `goose` and `goose-providers` crates from the
standalone private repository `Ablankpaper/actestra-goose-runtime` at immutable
commit `5d66f81a3a992b063ff6f22663789fbe7be42b48`. That commit descends from
the exact upstream base and changes only:

- `crates/goose/src/acp/server.rs`;
- `crates/goose/src/acp/server_factory.rs`; and
- `crates/goose/src/acp/server/new_session.rs`.

The binary full-index Git diff for the three declared paths has SHA-256
`7e848a929788d1c9fcfa55e85620a1359688386d3c52978b5f4074f0367ea205`.
It adds a default-off ACP adapter seam that binds one fixed Provider, model,
MCP client, and active session. The adapted path accepts only the absolute
workspace path already admitted by Main without requiring AppContainer
enumeration; the ordinary upstream entry point retains its accessible-directory
validation. No separate Goose UI is imported, and the admitted Goose feature
set remains empty.

The private repository is not a GitHub Fork. Its default branch remains the
exact upstream base, GitHub Actions are disabled, and there is no webhook or
automatic upstream synchronization. Actestra CI uses a repository-scoped
read-only deploy key only in same-repository jobs that resolve the private
source. The immutable commit, not a branch tip, is the product input.

The ACP server still creates private configuration and SQLite/session state.
`GOOSE_PATH_ROOT` can redirect the primary data, config, and state root, but
upstream source contains paths and discovery behavior that must be treated as
untrusted until the attempt-private-root tests pass. This state is disposable
and cannot become Actestra product authority.

## Upstream release artifacts

The official release provides CLI archives for macOS arm64/x64, Linux
arm64/x64 GNU and musl variants, and Windows x64. Representative verified
release API digests are:

| Target asset | SHA-256 |
| --- | --- |
| `goose-aarch64-apple-darwin.tar.bz2` | `3a1b41197ff670c36b0b6285f41ccd949966ee037933f38c5e11c9356799ce58` |
| `goose-x86_64-unknown-linux-gnu.tar.bz2` | `ec5da5f018cf68ea446887d30decf847542035ffcf91536d1d134ed94bb24401` |
| `goose-x86_64-pc-windows-msvc.zip` | `6d9853bdc614cdbae41d700075953ddbdc28264f8c0e8f2b7fd3d859ffb1c762` |

The macOS arm64 archive is 77,050,338 bytes and contains only `goose`; it does
not contain the Apache-2.0 license or a notice file. The extracted executable
is 262,553,568 bytes. It is a Mach-O arm64 file with an ad-hoc signature,
`codesign --verify --strict` succeeds for that ad-hoc signature, and
`spctl -a -t exec` rejects it. It has no Apple Team identifier.

`cargo-audit bin` cannot recover dependency information from the file because
the upstream release was not built with recoverable auditable dependency
metadata. Therefore the binary scan is evidence-incomplete, not a zero-finding
scan. The official artifact is not selected for import or distribution.

## Feature and dependency surface

The exact upstream lock contains 1,238 package entries. The upstream
`goose-cli` default features are:

- code mode;
- local inference;
- TUI;
- AWS providers;
- telemetry;
- Nostr;
- OpenTelemetry;
- rustls TLS;
- system keyring; and
- update support.

The CLI also depends unconditionally on `goose-mcp`, `goose-providers`, `bat`,
archive handling, web-browser integration, and other command surfaces. That is
substantially broader than a supervised stdio ACP Worker.

Goose core declares no default features and exposes the ACP server publicly.
The selected Actestra runner therefore depends on Goose core at the exact
source commit with defaults disabled and an empty Goose feature set. The first
handshake has no network, and later model access is restricted to Actestra
loopback HTTP, so no Goose TLS feature is admitted initially. The runner's
generated lock and compiled binary, rather than the upstream workspace lock
alone, will be the artifact admission input.

## RustSec evidence

An isolated `cargo-audit 0.22.2` scan of the exact `v1.45.0` `Cargo.lock`, using
the locally fetched 1,177-advisory database with yanked checks disabled after
the registry query timed out, reports:

| Class | Count | Exact findings |
| --- | ---: | --- |
| Vulnerability matches | 5 | `RUSTSEC-2026-0194` and `RUSTSEC-2026-0195` for `quick-xml 0.36.2` and `0.37.5`; `RUSTSEC-2023-0071` for `rsa 0.9.10` |
| Unsoundness warnings | 1 | `RUSTSEC-2026-0221` for `event-listener 5.4.1`, patched in `>=5.4.2` |
| Unmaintained warnings | 5 | `bincode 1.3.3`, `instant 0.1.13`, `paste 1.0.15`, `proc-macro-error 1.0.4`, `ttf-parser 0.25.1` |

The yanked-package check is incomplete because crates.io queries timed out; it
is tracked as an environment gap and does not replace the vulnerability result.

For the current P8.2c runner lock, crates.io subsequently marked the selected
`arrayref 0.3.9` (via `blake3 1.8.5`) as yanked. The runner now uses a
vendored exact source copy of the pre-yank `droundy/arrayref` commit
`f8d0299d863922db6c409d08098941e833b70d69`; no yanked registry package is
accepted and the audit remains fail-closed. The copy and its BSD-2-Clause
license are included in the runner source-tree digest because the upstream
repository is unavailable to CI.

Static reverse dependency analysis of the exact lock and manifests shows:

- `quick-xml 0.36.2` enters through `docx-rs -> goose-mcp`;
- `quick-xml 0.37.5` enters through `umya-spreadsheet -> goose-mcp`;
- `rsa 0.9.10` enters through `jsonwebtoken -> goose` and SQLx's broader lock
  graph;
- `event-listener 5.4.1` enters the ACP path through
  `async-process -> agent-client-protocol -> goose`, and also the SQLx path;
- `bincode 1.3.3` enters the CLI through `bat` and the optional code-mode graph;
  and
- `ttf-parser 0.25.1` enters through `lopdf -> goose-mcp`.

The official upstream `main` lock at
`20bb609c68f98c856b7fcc473fd1bf140b0406f0`, fetched on 2026-08-01, reports the
same five vulnerability matches, one unsoundness warning, and five
unmaintained warnings. There is no verified upstream fix to select today.

These are lockfile findings, not proof that every dependency is compiled or
reachable in every feature set. Conversely, the release binary lacks the data
needed to prove that affected crates are absent. ADR-0024 therefore requires a
minimal Actestra runner lock, `event-listener >=5.4.2`, auditable binary
metadata, SBOM, and a new artifact scan before real Worker admission.

On 2026-08-12 the RustSec database added `RUSTSEC-2026-0253` for `lru 0.18.1`,
patched in `>=0.18.2`. Unlike the disconnected RSA metadata disposition, `lru`
is a direct normal Goose core dependency and was present in the Actestra
auditable binary. The Actestra-owned runner lock therefore advances only that
package to `0.18.2`; artifact admission pins the safe resolved version and
rejects `0.18.1`. A rebuilt lock and binary scan contains no unsound warning
and retains only ADR-0025's exact RSA metadata record. The canonical Goose base
and empty feature set are unchanged; the P8.2c three-file adapter patch is
recorded separately above.

## Telemetry, credentials, and network

Goose source includes PostHog support and an upstream capture URL. Telemetry is
normally opt-in, and `GOOSE_TELEMETRY_OFF=1` is a hard environment override.
Goose also supports OpenTelemetry and optional Langfuse configuration. The
upstream keyring is enabled unless `GOOSE_DISABLE_KEYRING` is present.

The Actestra runner initially enables no Goose Cargo features, including
telemetry, OpenTelemetry, system keyring, providers, update, local inference,
or TLS. Its supervisor also sets telemetry/exporter deny variables, strips
provider and tracking secrets, and applies a process network policy. The first
handshake permits no network. Later inference may use only an Actestra-owned
loopback HTTP model proxy and opaque attempt lease. Environment settings alone
are not considered an egress boundary.

## License and distribution disposition

Goose's root Apache-2.0 license is compatible with evaluation and a separately
attributed compiled dependency. No source or binary is committed by P5.0. When
the runner becomes a distributed component, Actestra must include the exact
Apache-2.0 license, generated SBOM, source and patch provenance, executable
digest, and applicable dependency notices in the package and in
`THIRD_PARTY_NOTICES.md`.

The root Actestra license remains an owner decision. Selecting Goose does not
set or change it.

Upstream has no root `NOTICE`. The private runtime preserves the Apache-2.0
license and records its modified upstream paths and exact diff digest. Rollback
restores the runner source and lock to canonical upstream commit
`4dc0420f5704a92806c6628c8f0a3497d7a88759` and disables Windows production
runtime admission. The source pin does not prove Windows runtime execution,
Electron packaging, candidate integrity, real-provider acceptance, or P8
completion.

## P5.0 result and remaining gate

P5.0 selects the source and protocol boundary but deliberately does not admit a
runtime artifact. The next slice must prove all of the following before any
real Goose session:

1. the minimal runner builds from the exact source pin and closed feature set;
2. its immutable manifest, lock digest, executable digest, Apache-2.0 payload,
   SBOM, and auditable dependency metadata agree;
3. RustSec has no unaccepted vulnerability or unsoundness finding;
4. exact ACP name/version/capabilities succeed and an unsupported version
   fails without side effects;
5. no network, credential, user configuration, original-checkout, or
   non-private state access occurs during initialize and cleanup; and
6. process-group termination removes the attempt-private state without an
   orphan process.

This evidence is a P5 entry result only. It is not a candidate build, release,
deployment, cross-platform acceptance, or completion of the coding journey.
