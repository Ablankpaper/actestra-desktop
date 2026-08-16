# P8 Cross-Platform Internal Beta Design

**Status:** Approved design; written specification awaiting review

**Date:** 2026-08-16

**Baseline:** `origin/main@d6e7dc63d5d95fc8435d6f5da0240b0a529cb0cd`

**Phase:** P8 — Cross-Platform Internal Beta

## Purpose

P8 turns the accepted macOS arm64 development integration into a bounded,
cross-platform internal-beta program. It does not add a new product journey.
It proves that the existing General, Goose, Team, approval, recovery, privacy,
and security contracts can be built, installed, and exercised on one accepted
macOS, Windows, and Linux target without replacing Actestra's mature AionUI,
Goose, AionCore, planner, Main/Core, persistence, policy, or approval
boundaries.

P8 is divided into four independently reviewable and evidenced batches:

1. **P8.1 — Acceptance contract and platform matrix:** freeze the supported
   targets, package formats, required journeys, evidence vocabulary, and
   non-claims in human-readable and machine-checkable contracts.
2. **P8.2 — Cross-platform build and runtime:** build the exact application on
   all three targets, add equivalent platform adapters where current macOS-only
   enforcement prevents execution, and run packaged primary-journey and
   security smoke on each target.
3. **P8.3 — Candidate and supply-chain evidence:** create exact candidate
   artifacts with signing or notarization where applicable, SBOMs, checksums,
   provenance, license and NOTICE bundles, update metadata, and a rollback
   contract.
4. **P8.4 — Clean-machine internal acceptance:** install, upgrade, uninstall,
   recover, and run the candidate from fresh profiles on the accepted target
   systems, then record internal-beta operations and issue intake separately
   from CI and packaging evidence.

Each batch has its own source or documentation scope, focused verification,
complete project gate, pull request, exact-head CI, governed merge, and
merged-main CI. Completing P8.1 does not prove a Windows or Linux build.
Completing P8.2 does not create a signed candidate. Completing P8.3 does not
prove clean-machine or user acceptance. P8 closes only when all four batches
meet their own exit gates.

## Approved platform matrix

P8 accepts exactly these initial targets:

| Target ID | CI build environment | Internal acceptance environment | Electron platform / architecture | Package formats |
| --- | --- | --- | --- | --- |
| `macos-15-arm64` | GitHub-hosted `macos-15` | macOS 15 on Apple silicon | `darwin` / `arm64` | `dmg`, `zip` |
| `windows-11-x64` | GitHub-hosted `windows-2025` | Windows 11 24H2 x64 | `win32` / `x64` | `nsis` |
| `ubuntu-24.04-x64` | GitHub-hosted `ubuntu-24.04` | Ubuntu 24.04 LTS x64 | `linux` / `x64` | `deb` |

The CI operating system and internal acceptance operating system are distinct
evidence fields. A Windows Server CI build cannot substitute for Windows 11
clean-machine acceptance. A Linux container cannot substitute for an installed
Ubuntu desktop package. A macOS build on Intel cannot substitute for the
accepted Apple-silicon target.

The first P8 contract does not include macOS x64, Windows arm64, Linux arm64,
AppImage, RPM, Snap, Flatpak, MSI, or additional distributions. Adding one
requires a new reviewed matrix revision, target-specific package and runtime
evidence, and an explicit owner; it cannot be inferred from an upstream script
or an available AionCore archive.

## Existing foundation and confirmed gaps

The pinned AionUI v2.1.41 foundation already defines mature builder entry
points for macOS DMG/ZIP, Windows NSIS, and Linux DEB. AionCore v0.1.52
publishes matching x64 or arm64 assets for the three operating-system families.
Those facts are reusable build inputs, not Actestra acceptance evidence.

Actestra's current accepted runtime is intentionally narrower:

- the Goose source contract admits audit-tool assets only for Darwin hosts;
- the current target-triple resolver returns a value only on macOS;
- the Goose launcher requires `/usr/bin/sandbox-exec` and rejects non-macOS
  execution as `network-policy-unavailable`;
- P7 package trust, resource limits, security smoke, diagnostic export, and
  CI paths are bound to macOS arm64; and
- every P7 abuse-catalog entry records Windows and Linux as a P8 obligation,
  not as a pass.

P8 therefore cannot be implemented as an Electron Builder matrix alone. P8.2
must preserve the existing authority model while supplying equivalent Windows
and Linux execution, process-tree, network, filesystem, artifact, and cleanup
evidence. A package that launches but disables Goose, Team, protected approval,
or recovery does not satisfy the target.

## Product and upstream boundaries

P8 preserves these existing authorities:

- AionUI v2.1.41 remains the pinned functional UI and build foundation.
- `foundation/` remains byte-identical; changes use an Actestra-owned source
  file or a recorded downstream patch or overlay.
- Actestra Main/Core owns product state, platform admission, provider traffic,
  protected effects, recovery, and acceptance projection.
- Tool Gateway remains the only policy, approval, credential-reference, and
  privileged-audit boundary.
- Goose remains the exact pinned isolated coding worker and is not allowed to
  acquire direct workspace, credential, network, persistence, or application
  UI authority.
- AionCore remains a packaged runtime dependency behind Actestra's verified
  resource and model-provider boundaries.
- The Actestra-native no-tool planner remains the Team planning sidecar; no
  upstream Eigent or CrewAI application UI is introduced.
- Renderer and preload receive only bounded projections and typed intents.
  Cross-platform support cannot add filesystem, Git, process, installer,
  credential, shell, or unrestricted network authority to Renderer.

Windows and Linux enforcement must be implemented behind Main-owned platform
interfaces. P8.1 does not choose a particular Windows Job Object, Linux
namespace, cgroup, seccomp, Landlock, or sandbox implementation. P8.2 must make
that choice against faithful failing tests and record it in a separate accepted
decision before calling the platform enforced. An unavailable mechanism fails
closed and remains an open platform obligation.

## Machine-readable contract

P8.1 adds a single versioned platform-matrix module consumed only by build,
verification, and documentation tests. It is not runtime product authority.
The contract contains:

- `contractVersion` and the exact P8 phase identifier;
- the three closed target records above;
- distinct CI builder and clean-machine acceptance identities;
- exact Electron platform, architecture, and package formats;
- the required journey and evidence identifiers;
- the batch in which each evidence class becomes required; and
- explicit non-claims for signing, candidate, release, deployment,
  distribution, and user acceptance.

Unknown fields, duplicate target or evidence identifiers, unsupported package
formats, missing required journeys, an expanded architecture, or a target that
conflates its builder with its clean-machine environment fail the matrix check.
The machine contract contains no credential, provider endpoint, mutable local
path, runner token, user name, prompt, patch, or machine identifier.

## Required product journeys

Every accepted target must eventually record all of the following. P8.1 names
the obligations; the indicated later batch supplies the evidence.

### P8.2 packaged runtime evidence

1. **Fresh-profile launch:** start the packaged application under an isolated
   profile and show the explicit provider-unavailable state without accessing a
   daily-use profile.
2. **General Artifact:** run the bounded General text-only path and persist a
   valid Artifact without placeholder or false-completion output.
3. **Goose isolated patch:** run the real admitted Goose runner, execute a
   bounded tool, and produce a patch Artifact while the source workspace stays
   unchanged.
4. **Workspace apply approval:** require the distinct Main-owned second
   approval, reject denial or drift without a source effect, and apply exactly
   once after approval.
5. **General+Goose Team:** create and execute the accepted Team composition,
   project its plan and Worker states, and finish through the correct workflow
   feedback route.
6. **Cancellation and no-orphan cleanup:** cancel an active journey and show no
   residual Worker, planner, lease, lock, private root, or coding worktree.
7. **Crash and restart recovery:** terminate the application or Worker at a
   recorded checkpoint, restart, and project the durable authoritative state
   without duplicate execution.
8. **Privacy and redaction:** prove raw credentials, prompts, completions, tool
   arguments, patch content, content references, and user paths do not enter
   Renderer projections, logs, incidents, diagnostics, or evidence.
9. **P7 platform obligations:** exercise all 14 security invariants and all 28
   abuse-case classes at their required layer. A platform-specific equivalent
   may change the fixture mechanism but not the protected invariant, forbidden
   effects, or pass condition.

P8.2 may use a deterministic authenticated loopback provider for repeatable CI
transport and state-machine evidence. That run is always labeled synthetic and
cannot prove a real third-party provider, real user, release, or deployment.

### P8.3 candidate evidence

1. Each artifact is bound to the exact source commit, platform, architecture,
   package type, immutable digest, SBOM, provenance statement, and applicable
   license and NOTICE bundle.
2. macOS is signed with an approved identity and notarized; Windows is signed
   with an approved code-signing identity. Linux package integrity is bound to
   the same candidate manifest. Development or ad-hoc signing is not candidate
   evidence.
3. Update metadata refers only to the exact candidate artifacts and uses an
   Actestra-owned endpoint and signing authority.
4. Rollback defines the supported previous version, state-schema compatibility,
   failure behavior, and operator action without silently downgrading product
   state.

### P8.4 clean-machine evidence

1. Install the exact candidate on each accepted target with no prior Actestra
   profile.
2. Run the primary General, Goose, Team, approval, restart, privacy, and
   cleanup journeys from the installed application.
3. Upgrade from the accepted predecessor and prove state and Artifact
   continuity.
4. Exercise the bounded rollback plan after an injected update failure.
5. Uninstall and distinguish application removal from user-approved data
   retention or removal.
6. Run a real-provider acceptance journey with user-supplied credentials and
   sanitized evidence; credentials never enter CI, documentation, or the
   repository.
7. Record the internal-beta runbook, issue-intake channel, exact candidate
   identity, target environment, result, and remaining limitations.

## Evidence states and fail-closed rules

P8 matrix evidence uses a closed result vocabulary:

- `verified`: the exact required target, artifact, journey, and evidence are
  present and the verifier exits zero;
- `failed`: the required build, install, journey, or invariant did not meet its
  contract;
- `unsupported-platform`: the current platform cannot enforce or exercise the
  requirement;
- `evidence-incomplete`: behavior may be correct, but exact artifact,
  no-side-effect, cleanup, redaction, or environment proof is absent; and
- `test-harness-invalid`: the fixture, target, or environment is not faithful.

Only `verified` advances a non-security matrix item. P7 security attacks retain
their existing vocabulary and only `denied-safe` passes. `skip`, `xfail`, a
missing job, a generated package with no runtime evidence, and an
`unsupported-platform` result are never translated to `verified` or
`denied-safe`.

Evidence is exact-target and exact-artifact. A pass from one platform,
architecture, package type, source commit, signature state, profile, or
provider mode cannot satisfy another record. A later product-byte change
invalidates only the evidence whose exact source or artifact binding changed;
unchanged contract evidence need not be rerun without a changed verification
key.

## Failure handling

- Build failure returns the original nonzero status and preserves bounded,
  sanitized diagnostics. A partial application or installer is not retained as
  a successful artifact.
- Missing or mismatched AionCore, Goose, planner, manifest, architecture,
  digest, SBOM, or license evidence fails package admission before a Worker is
  exposed.
- Missing platform containment fails Worker admission. It cannot fall back to
  an unsandboxed, inherited-environment, detached, or YOLO launch.
- Journey failure terminalizes through the existing durable incident and task
  semantics. A refused model completion, tool rejection, crash, or cleanup
  failure cannot drift to completed or unchanged.
- Package or install smoke always uses an isolated profile and private
  temporary root. Failure cleanup scans the whole owned root and relevant
  process tree without touching daily-use state.
- Diagnostic and CI evidence remains metadata-only and redacted. It records
  identifiers, classifications, counts, platform identity, digests, and bounded
  lengths, not content or secrets.

## Verification strategy

### P8.1 contract verification

P8.1 follows failure-first development:

1. add a test that requires the exact three targets, formats, journeys, result
   vocabulary, and non-claims and observe it fail while the contract is absent;
2. add the minimal machine-readable contract and checker;
3. add document consistency tests for ADR-0030, the product matrix, System
   Overview, MVP, development sequence, and project status;
4. prove that a broadened architecture, missing journey, duplicate identifier,
   builder/acceptance conflation, unknown field, or `skip`-as-pass mutation is
   rejected; and
5. run the focused tests, documentation checks, complete `bun run check`,
   `git diff --check`, and foundation/downstream boundary gates.

P8.1 changes no Renderer UI and no foundation files. Its successful result is
an accepted contract on formal `main`, not a cross-platform build claim.

### P8.2–P8.4 verification ownership

Each platform job must run natively on the target operating-system family.
Cross-compilation can be diagnostic evidence only. Package-structure checks,
real Worker tests, process/network containment, platform filesystem semantics,
SQLite recovery, install lifecycle, and clean-machine journeys run where their
effects occur.

Platform-specific tests may share fixtures and expected contracts, but they
cannot share a fabricated pass result. Required Windows and Linux checks move
from `unsupported-platform` to `denied-safe` or `verified` only after the real
platform adapter and package execute them.

## P8.1 deliverables

The first implementation batch creates or updates only these categories:

- this approved design specification;
- ADR-0030 for the cross-platform beta acceptance authority;
- one human-readable P8 product and platform matrix document;
- one machine-readable matrix and fail-closed checker;
- focused matrix and documentation consistency tests;
- documentation index, ADR index, System Overview, MVP, development sequence,
  and Project Status updates; and
- the root verification entry required to keep the matrix contract live.

No P8.1 change adds a Windows or Linux runtime adapter, modifies CI into a
three-platform build matrix, downloads a signing credential, creates a
candidate, uploads a release artifact, publishes update metadata, deploys a
service, or claims user acceptance.

## P8.1 exit gate

P8.1 is complete only when:

1. the exact three-target matrix and required journeys are machine-checked;
2. ADR-0030 and all source-of-truth documents agree on scope, staged evidence,
   failure semantics, and non-claims;
3. focused RED/GREEN matrix tests and the complete local project gate pass;
4. `foundation/` remains byte-identical and the AionUI retention and downstream
   overlay checks pass;
5. the final branch is pushed through a governed pull request;
6. both required exact-head CI jobs pass;
7. the reviewed result is merged to formal `main`; and
8. independent merged-main CI passes on the exact merge.

The P8 phase goal remains open after this gate. P8.2 is then the next authorized
batch.

## Rejected alternatives

### Build-only matrix

Adding Windows and Linux Electron Builder jobs while Goose remains
macOS-only would create installable shells that cannot run the accepted product
journeys. It is rejected because build success is not platform acceptance.

### Broad first matrix

Adding Intel macOS, Windows arm64, Linux arm64, AppImage, RPM, Snap, Flatpak,
or MSI in the first contract multiplies native dependency, runtime, installer,
security, signing, and clean-machine evidence before the minimum beta is
accepted. Those targets remain eligible for later, separately reviewed matrix
revisions.

### New cross-platform application shell

Replacing AionUI or embedding Goose, Eigent, or another upstream application UI
is rejected. P8 ports platform enforcement and packaging behind existing
Actestra boundaries; it does not recreate the product.
