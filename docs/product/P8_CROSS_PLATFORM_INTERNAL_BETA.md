# P8 Cross-Platform Internal Beta

## Status

P8.1 defines the acceptance contract for the first internal-beta target matrix.
It does not state that a Windows or Linux package, runtime, candidate, or
clean-machine journey has been accepted. The accepted P7 baseline remains the
macOS arm64 development-integration sequence.

## Initial target matrix

| Target ID | CI builder | Internal acceptance environment | Electron platform / architecture | Required package formats |
| --- | --- | --- | --- | --- |
| `macos-15-arm64` | `macos-15` | macOS 15 arm64 | `darwin` / `arm64` | DMG, ZIP |
| `windows-11-x64` | `windows-2025` | Windows 11 24H2 x64 | `win32` / `x64` | NSIS EXE |
| `ubuntu-24.04-x64` | `ubuntu-24.04` | Ubuntu 24.04 LTS x64 | `linux` / `x64` | DEB |

Builder evidence proves only the named builder result. It never replaces
clean-machine acceptance on the matching operating-system family.

## Required product journeys

Every initial target eventually needs these target-specific results:

| Journey | Batch |
| --- | --- |
| Fresh isolated-profile launch | P8.2 |
| General Artifact creation | P8.2 |
| Goose isolated patch Artifact | P8.2 |
| Workspace apply approval | P8.2 |
| General + Goose Team | P8.2 |
| Cancellation with no orphan | P8.2 |
| Crash and restart recovery | P8.2 |
| Privacy and credential redaction | P8.2 |
| P7 platform obligations | P8.2 |
| Clean install | P8.4 |
| Upgrade and state continuity | P8.4 |
| Rollback after update failure | P8.4 |
| Uninstall and data choice | P8.4 |
| Real-provider internal acceptance | P8.4 |

These journeys retain the existing product contract: General, Goose, Team,
approval, recovery, privacy, Artifacts, cancellation, and cleanup continue to
be owned by the current Main/Core and policy boundaries. A deterministic
loopback provider can establish CI transport evidence, but cannot substitute
for real-provider acceptance.

## Required evidence classes

| Evidence class | Batch |
| --- | --- |
| Native package and runtime | P8.2 |
| Platform security boundaries | P8.2 |
| Candidate digest, SBOM, and provenance | P8.3 |
| Signing and notarization where applicable | P8.3 |
| Update metadata and rollback | P8.3 |
| Clean-machine lifecycle | P8.4 |
| Internal-beta runbook and issue intake | P8.4 |

## Evidence interpretation

The matrix accepts only these result values:

- `verified`: the exact target, package, journey, and evidence are present and
  the verifier exits zero.
- `failed`: a required invariant, build, install, or journey did not meet its
  contract.
- `unsupported-platform`: the current platform cannot enforce or exercise the
  requirement.
- `evidence-incomplete`: behavior may be correct but artifact, target,
  redaction, cleanup, or environment proof is missing.
- `test-harness-invalid`: the fixture, target, or environment is not faithful.

Only `verified` advances a matrix item. `skip`, `xfail`, a missing job, a
build-only package, and `unsupported-platform` are not success. P7 attack
records retain their separate `denied-safe` pass state.

## Staged delivery

### P8.1 - Acceptance contract and platform matrix

P8.1 owns the machine-readable matrix, fail-closed checker, regression tests,
ADR-0030, and aligned source-of-truth documentation. It changes no platform
runtime, CI matrix, installer, signing configuration, candidate, or release.

### P8.2 - Native package and runtime matrix

P8.2 adds and verifies native runtime, package, product-journey, cleanup, and
P7 boundary evidence independently on all three targets.

### P8.3 - Candidate integrity and update trust

P8.3 establishes candidate digest, SBOM, provenance, signing/notarization,
update metadata, and bounded rollback evidence.

### P8.4 - Clean-machine internal acceptance

P8.4 verifies install, upgrade, uninstall, real-provider acceptance, internal
beta runbook, and issue intake on clean machines.

Completing P8.1 does not prove a Windows or Linux build.
Completing P8.2 does not create a signed candidate.
Completing P8.3 does not prove clean-machine or user acceptance.

## Failure and exit rules

Failure retains the original nonzero status with bounded, sanitized diagnostics.
A partial package, unsupported containment primitive, missing evidence, or
uncertain cleanup must remain failed or incomplete; none may drift into a
completed result. Evidence is exact target and exact artifact: it may not be
borrowed across platforms, architectures, package types, profiles, source
commits, signatures, or provider modes.

P8 completes only after P8.1 through P8.4 have their separate evidence. This
document does not authorize a release, deployment, distribution, or final user
acceptance.
