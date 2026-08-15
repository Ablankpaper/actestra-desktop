# ADR-0027: P7 Threat Model and Abuse-Case Authority

- Status: Accepted
- Date: 2026-08-13
- Owners: Actestra Core, Main, Worker, Security, and Release
- Phase: P7.1 Security and Reliability Hardening
- Related: [ADR-0007](0007-privileged-service-authorization.md),
  [ADR-0008](0008-main-owned-projection-and-ipc.md),
  [ADR-0017](0017-general-worker-process-and-agent-adapter-v2.md),
  [ADR-0024](0024-minimal-goose-acp-runner.md), and
  [ADR-0026](0026-actestra-native-team-planner.md)

## Context

Actestra's P4-P6 product already has Main/Core authority, Main-owned
projections, ToolGateway policy and approval, workspace grants, isolated Git
worktrees, supervised Workers, authenticated loopback paths, SQLite
persistence, and artifact trust checks. Those controls span many modules and
need one reviewable threat model and one executable abuse-case vocabulary.

P7.1 must attack the existing boundaries without importing a second product
framework or making test fixtures into runtime authority. A result that merely
returns an error, skips an unsupported platform, or omits redacted evidence is
not a security pass. Conversely, a deterministic local fixture must not be
described as a real Goose, provider, or cross-platform acceptance run.

## Decision

### 1. The threat model is repository-scoped authority

The repository threat model in
[docs/security/THREAT_MODEL.md](../../security/THREAT_MODEL.md) is the
source of truth for protected assets, trust boundaries, assumptions, stable
invariant IDs, attacker stories, severity calibration, and evidence rules.
The human abuse ledger in
[docs/security/P7_ABUSE_CASES.md](../../security/P7_ABUSE_CASES.md) is the
reviewable disposition record. The machine catalog and executable attacks are
bound to the same IDs.

### 2. IDs and outcome vocabulary are closed

P7.1 uses stable `P7-I-*` invariant IDs and `P7-A-*` abuse-case IDs. A catalog
entry includes its invariant, risk, minimum verification layer, exact test
binding, expected boundary, forbidden effects, evidence fields, supported
platforms, and P8 obligation. Unknown, duplicate, widened, or silently
removed entries fail the catalog contract.

The only passing outcome is `denied-safe`. The other closed outcomes are
`unsupported-platform`, `security-boundary-violated`, `cleanup-incomplete`,
`evidence-incomplete`, and `test-harness-invalid`. Unsupported, incomplete,
flaky, or invalid cases are never converted into success.

### 3. Existing authorities remain the implementation boundary

P7.1 tests and repairs the existing `desktopIpc`, Main/Core, persistence
utility, ToolGateway, approval, workspace/Git, Goose MCP/model loopback,
supervised Worker, planner, package, and downstream source-copy boundaries.
It does not introduce a second policy engine, approval system, sandbox,
credential store, persistence authority, Worker protocol, or UI. The Renderer
does not gain filesystem, Git, process, credential, persistence, or unrestricted
network authority to make an attack test easier.

### 4. Critical and high findings block the batch

Raw credential disclosure, Renderer privilege, unapproved original-workspace
write, arbitrary execution outside ToolGateway, sandbox escape, approval or
policy bypass, external Worker network, authoritative persistence tampering,
and privileged orphan residue are release-blocking P7.1 findings. They must be
repaired at the owning authority boundary and regression-locked before the
batch may merge. Medium and low findings require explicit ownership, rationale,
workaround, target batch, and regression coverage.

### 5. macOS is required for P7.1; Windows/Linux are P8 obligations

P7.1 performs enforcement and packaged acceptance on macOS. A macOS-required
case cannot resolve to `unsupported-platform`. Windows and Linux obligations
are recorded in the catalog and ledger for P8; a platform probe that cannot
run exits nonzero and is reported as unverified rather than counted as a pass.

### 6. Fixtures and developer inputs cannot authorize production bytes

Security fixtures are local, deterministic, malicious test inputs. They are
never production startup dependencies and never trust roots. Production admits
only external manifest, digest, target, shape, source-copy, license, SBOM, and
build evidence. A self-consistent fixture, cache, manifest, or mutable branch
does not authorize an executable, planner, Worker, or package.

### 7. Evidence is bounded and redacted

Security evidence contains only IDs, classifications, booleans, bounded
lengths, counts, immutable digests when required, and sanitized process-exit
shapes. It never contains API keys, authorization headers, provider URLs with
embedded credentials, prompt or completion text, tool arguments, content
references, raw patches, absolute user paths, environment values, or private
Worker state. If evidence persistence fails after an effect may have occurred,
the outcome is not `denied-safe`; existing uncertain/recovery handling applies.

## Consequences

### Positive

- Security review has one stable vocabulary across static, Core/Main, local
  process, and packaged macOS layers.
- Existing mature AionUI, Main/Core, ToolGateway, approval, persistence,
  Worker, and artifact authorities remain intact.
- P7.1 can distinguish a product violation, cleanup failure, missing evidence,
  unsupported platform, and invalid fixture without hiding any as a pass.
- P8 receives explicit Windows/Linux obligations instead of an accidental
  cross-platform claim.

### Costs

- Every catalog ID requires a real test binding before the aggregate gate can
  pass, and documentation must be revised when a boundary changes.
- Packaged macOS acceptance needs a fresh isolated profile and a residue scan.
- Security evidence requires careful redaction and cannot use convenient raw
  logs or user paths.

## Rejected alternatives

### Add a second security or policy framework

Rejected because it would split authority from existing Main/Core and
ToolGateway contracts, duplicate approval semantics, and expand the product
surface without evidence of a boundary defect.

### Treat skipped or unsupported cases as green

Rejected because it would turn an unverified platform or incomplete harness
into a false security claim. Windows/Linux work remains P8.

### Let fixtures or manifests self-authorize runtime artifacts

Rejected because test control, local caches, and mutable build inputs are not an
external trust root for a privileged executable or planner.

### Put security diagnostics or privileged effects in Renderer

Rejected because preserving Main/Core authority and the existing AionUI surface
is safer than widening Renderer capabilities for convenience.

## Review triggers

Review this ADR when a new UI, provider, Worker, planner, tool, MCP server,
credential store, persistence service, or platform runtime is proposed; when a
protected asset or trust boundary changes; when P7.2-P7.4 would weaken an
invariant; when a critical/high finding cannot be repaired within P7.1; when
P8 exposes a platform contract mismatch; or when signing, notarization,
updates, rollback, or distribution changes the artifact trust root.
