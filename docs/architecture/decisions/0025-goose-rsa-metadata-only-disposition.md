# ADR-0025: Admit the Exact Goose RSA Metadata-Only Audit Disposition

- Status: Accepted
- Date: 2026-08-01
- Owners: Actestra Worker, Security, and Release
- Phase: P5.1 Goose Minimal Runner and Handshake
- Clarifies: ADR-0024 artifact-admission RustSec gate

## Context

ADR-0024 requires a new accepted decision before a Goose runner artifact may
be admitted with any remaining RustSec vulnerability or unsoundness finding.
The P5.1 runner uses Goose `v1.45.0` at exact commit
`4dc0420f5704a92806c6628c8f0a3497d7a88759`, disables default features,
enables no Goose Cargo feature, and excludes `goose-cli`, `goose-mcp`,
`quick-xml`, builtins, and the scheduler from the selected runtime graph.

The first macOS arm64 build has 545 packages in its committed lock, 458
packages in the dependency metadata embedded by `cargo-auditable`, 423 package
identities in the current compiler-artifact messages, and 413 active normal
dependencies in both the Actestra SBOM and normalized Cargo target tree. Both the
lock scan and the embedded-metadata scan report exactly
`RUSTSEC-2023-0071` for `rsa 0.9.10`. The report cannot be represented as a
clean audit.

The same build supplies independent non-reachability evidence:

- `cargo tree --locked --no-default-features --target all --invert rsa
  --edges normal` has no path;
- the equivalent all-target query for `sqlx-mysql` has no path;
- Actestra's active normal-dependency graph contains neither package; and
- the current Cargo machine-readable build messages contain no `rsa` or
  `sqlx-mysql` compiler artifact, independently of any stale target-directory
  file.

The advisory therefore remains present in lock and auditable metadata, but the
affected package is not selected or compiled into this exact runner. This is a
bounded metadata-only disposition, not a waiver for reachable RSA code and not
a general permission to ignore `cargo-audit` findings.

## Decision

Actestra accepts only the following P5.1 disposition:

| Field | Required value |
| --- | --- |
| Advisory | `RUSTSEC-2023-0071` |
| Package | `rsa 0.9.10` |
| Disposition | `metadata-only-not-compiled` |
| Proof label | `cargo-tree-all-targets-no-path` |
| Report sources | exactly `cargo-audit-lock` and `cargo-audit-bin` |

The runner build and artifact-admission code must fail closed unless all of the
following remain true in the same build:

1. Goose source, empty feature set, patch digest, ACP versions, Rust toolchain,
   `cargo-auditable`, and `cargo-audit` match their exact source contract,
   including the per-target archive and executed-tool SHA-256 values.
2. The runner is built with `cargo auditable build --locked --release
   --message-format=json-render-diagnostics`, the committed lock remains
   unchanged, and the current build's compiler-artifact identities are recorded.
3. `event-listener` resolves to `5.4.2`; vulnerable `quick-xml` versions and
   the broad Goose CLI/tool crates do not enter the selected graph.
4. The active graph, all-target inverse normal-edge queries, and compiled
   release artifacts all independently show no `rsa` or `sqlx-mysql` path or
   artifact. The active SBOM dependency count must also equal Cargo's normalized
   target-specific normal-edge tree count.
5. Lock and binary scans contain exactly the disposition above, contain no
   unsound warning, and complete with no yanked package. Unmaintained warnings
   remain a separate recorded field and are never relabeled as vulnerabilities.
6. The RustSec advisory database commit, fetch time, and scan time are recorded;
   the database was actually fetched within seven days when an offline local
   build ran, or within ten minutes when the build owned an online refresh.
7. The immutable artifact carries the complete lock, CycloneDX 1.6 SBOM,
   normalized audit report, Goose Apache-2.0 license payload, source and patch
   digests, executable digest, target triple, and build provenance. Admission
   also requires a manifest SHA-256 and expected target triple supplied by a
   trusted caller outside the artifact; self-consistent or wrong-architecture
   files are not their own trust root. CI provenance
   is emitted only from a clean checkout at the recorded Actestra commit.

Any additional advisory, different RSA version, reachable dependency path,
compiled artifact, unsound warning, incomplete yanked check, widened feature,
or changed proof fails admission. Resolving such a change requires removing the
finding or accepting another explicit owner-reviewed ADR; this decision cannot
be pattern-matched onto another package or advisory.

The P5.1 artifact is local or short-lived CI evidence. It is not a signed,
notarized, released, deployed, or cross-platform accepted product artifact.
P7/P8 still own release signing, package-level SBOM and notices, update and
rollback, resource enforcement, and physical-machine acceptance.

This decision changes no UI or authority boundary. AionUI remains the only
product surface, Actestra remains the sole state and permission authority, and
the runner receives no workspace, tool, provider, credential, or network
capability during the P5.1 initialize handshake.

## Consequences

- P5.1 can admit the exact minimal runner without falsely calling its lock or
  embedded dependency metadata vulnerability-free.
- The accepted artifact retains machine-readable evidence for both the finding
  and its exact non-compilation proof.
- The committed lock may contain disconnected metadata needed by Goose's crate
  definitions, but no disconnected package becomes runtime authority or an
  automatically accepted security exception.
- A future upstream or dependency change that removes the lock-only RSA entry
  can tighten the admission rule and retire this disposition.

## Rejected alternatives

### Ignore or suppress the advisory

Rejected because a global `--ignore` would discard the finding without binding
it to package version, reachability evidence, build target, or review ownership.

### Report the binary audit as clean

Rejected because `cargo-audit bin` does report the RSA entry from embedded
metadata. The artifact records that fact and the separate non-compilation proof.

### Accept the broad upstream Goose CLI

Rejected by ADR-0024 because its feature and dependency graph contains more
reachable findings and authorities than the minimal runner.

### Patch or delete lock entries without a dependency change

Rejected because hand-editing the lock would not change Cargo's package model
or prove what the compiler selected. The committed lock and independent graph
evidence must remain reproducible.

## Review triggers

Revisit this decision when:

- Goose, SQLx, JWT, or RSA dependency declarations change;
- the Goose source, feature set, target, lock, toolchain, or audit tools change;
- `cargo-auditable` changes the embedded dependency metadata behavior;
- either inverse dependency query finds a path or either package is compiled;
- the advisory is withdrawn, superseded, or fixed in the selected graph; or
- a candidate, release, or non-macOS artifact is proposed.
