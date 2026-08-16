# ADR-0030: P8 Cross-Platform Internal Beta Acceptance

- Status: Accepted
- Date: 2026-08-16
- Owners: Actestra Product, Main, Core, Worker, Security, and Release
- Phase: P8.1 acceptance contract and platform matrix
- Related: [ADR-0010](0010-aionui-first-product-foundation.md),
  [ADR-0024](0024-minimal-goose-acp-runner.md),
  [ADR-0027](0027-p7-threat-model-and-abuse-authority.md),
  [ADR-0028](0028-p7-worker-resource-and-process-reliability.md), and
  [ADR-0029](0029-p7-diagnostic-export-and-audit-retention.md)

## Context

P7 closes the macOS arm64 development-integration sequence. It does not prove
that a package, containment primitive, recovery path, or installation journey
works on Windows or Linux. Treating an Electron Builder output, skipped test,
or a macOS result as a cross-platform result would conceal missing authority
and security evidence.

The initial internal-beta program needs a bounded matrix before platform
adapters, CI jobs, signing, candidates, or clean-machine acceptance are added.
The matrix must preserve existing AionUi, Main/Core, Tool Gateway, Goose,
AionCore, planner, persistence, and Renderer authority boundaries. It must not
turn a planning document into a claim that a target already works.

## Decision

### 1. The initial target matrix is closed

P8 recognizes only these initial targets:

| Target ID | CI builder | Clean-machine acceptance | Package formats |
| --- | --- | --- | --- |
| `macos-15-arm64` | `macos-15` | macOS 15 arm64 | DMG, ZIP |
| `windows-11-x64` | `windows-2025` | Windows 11 24H2 x64 | NSIS EXE |
| `ubuntu-24.04-x64` | `ubuntu-24.04` | Ubuntu 24.04 LTS x64 | DEB |

CI builders and clean-machine acceptance environments are distinct evidence.
No target, package format, architecture, or operating-system family may be
added, removed, or reinterpreted without a successor decision and a revised
machine-checked contract.

### 2. Every target owes the same product and security outcomes

Every target eventually owes General, Goose, Team, approval, recovery, privacy,
and P7-invariant outcomes. The P8 matrix uses only `verified`, `failed`,
`unsupported-platform`, `evidence-incomplete`, and `test-harness-invalid`.
Only `verified` advances a matrix item. P7 attacks retain `denied-safe` as their
only pass state.

`skip`, `xfail`, `unsupported-platform`, a missing job, and a build-only
package do not pass. Deterministic loopback-provider evidence may support P8.2
CI, but it is not real-provider acceptance.

### 3. P8 is staged and evidence remains separate

- P8.1 owns this contract, the matrix checker, focused regression tests, and
  source-of-truth documentation only.
- P8.2 owns native platform runtime, package, General, Goose, Team, approval,
  recovery, privacy, cancellation/no-orphan, and P7 platform-boundary evidence.
- P8.3 owns candidate integrity, SBOM/provenance, signing/notarization where
  applicable, update metadata, and rollback evidence.
- P8.4 owns clean-machine install, upgrade, uninstall, real-provider internal
  acceptance, runbook, and issue intake evidence.

P8.1 does not modify `foundation/`, implement Windows/Linux runtime support,
sign a candidate, publish update metadata, release, deploy, distribute, or
claim user acceptance.

### 4. Existing authorities remain unchanged

P8.1 does not change Renderer, preload, Electron Main, Core, Worker runtime,
downstream patches, CI configuration, installer configuration, signing
configuration, or persisted product state. Renderer remains free of filesystem,
shell, process, Git, credential, and generic network authority. P8.2 and later
must extend existing product-owned boundaries rather than import a replacement
application shell, policy engine, persistence authority, or Worker framework.

## Consequences

### Positive

- Cross-platform work has one exact scope, rather than a broad label that can
  hide a missing target or acceptance layer.
- A later build cannot be reported as internal-beta acceptance without the
  package, journey, and target-specific evidence that the matrix requires.
- Existing P7 obligations carry into P8 without treating an unsupported probe
  as a pass.

### Costs

- Each target needs independent native execution and clean-machine evidence;
  macOS proof cannot be reused for Windows or Ubuntu.
- The contract checker deliberately rejects convenient additions and requires a
  reviewed update when the program's scope changes.

## Rejected alternatives

### Declare P8 complete from build output alone

Rejected because a generated installer does not establish containment,
recovery, privacy, cancellation, install lifecycle, or real-provider behavior.

### Start with a broad platform matrix

Rejected because unsupported targets would dilute the evidence program and
encourage `skip` or `xfail` to look like success.

### Replace the current product shell or authorities for another platform

Rejected because it would split product state, permissions, and audit ownership
from the AionUi-first Actestra product.

## Rollback

Rollback removes the P8.1 matrix checker, focused tests, and documentation. It
does not alter product runtime code, packages, signing state, persisted state,
or `foundation/`.

## Review triggers

Review this decision before adding an operating-system target, changing a
package format or architecture, enabling Windows/Linux Worker containment,
adding CI matrix jobs, creating a candidate, changing signing/update trust
roots, or recording clean-machine or real-provider acceptance.
