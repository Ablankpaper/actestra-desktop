# P7.4 Diagnostic Export and Audit Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close P7 with an explicit-consent, local-only, metadata-redacted diagnostic export and a bounded, integrity-checked privileged-audit retention policy.

**Architecture:** The SQLite persistence utility remains the only audit-record authority. Schema 23 adds a SHA-256 chain plus a retained-prefix anchor; startup verifies or initializes the chain, applies the fixed retention policy only to terminal request groups, and fails closed on corruption. Electron Main requests bounded evidence, converts identifiers to per-export aliases, writes one private JSON file after a native save decision, and returns only a closed status to the AionUI Renderer. A new downstream patch adds an AionUI-native About/Settings entry and a packaged E2E-only acceptance hook without restoring upstream telemetry or feedback upload.

**Tech Stack:** TypeScript 5.9, Electron 37, `node:sqlite`, Node crypto/fs, Vitest, AionUI v2.1.41 downstream overlay, Bun, GitHub Actions macOS arm64.

---

## Task 1: Record the P7.4 authority and closed contracts

**Files:**

- Create: `docs/architecture/decisions/0029-p7-diagnostic-export-and-audit-retention.md`
- Modify: `docs/architecture/decisions/README.md`
- Create: `apps/desktop/src/core/diagnosticEvidence.ts`
- Modify: `apps/desktop/src/core/index.ts`
- Modify: `apps/desktop/src/core/platform.ts`
- Modify: `apps/desktop/src/core/productPersistence.ts`
- Test: `tests/core/diagnosticEvidence.test.ts`

- [ ] Write failing contract tests for exact-key diagnostic records, fixed retention policy, bounded lists, opaque aliases, allowed stable codes, and forbidden raw identifiers/content.
- [ ] Run `bun run test -- tests/core/diagnosticEvidence.test.ts` and verify the missing contract fails.
- [ ] Add the version-1 diagnostic/retention types and validators. Fix production policy to 90 days, 100,000 retained audit records, 1,000 exported audit events, 50 terminal attempts, and a 2 MiB encoded report limit.
- [ ] Add the persistence-port methods `maintainPrivilegedAudit(now)`, `listRecentPrivilegedAudit(limit)`, and `readPrivilegedAuditRetentionState()`.
- [ ] Run the focused contract test and adjacent core tests GREEN.
- [ ] Record the authority, explicit-consent rule, redaction exclusions, schema migration, rollback, macOS/P8 boundary, and non-claims in ADR-0029.

## Task 2: Add schema-23 audit-chain and retention state

**Files:**

- Modify: `apps/desktop/src/utility/persistence/sqliteMigrations.ts`
- Modify: `apps/desktop/src/utility/persistence/sqliteCorePersistence.ts`
- Test: `tests/utility/sqliteMigrations.test.ts`
- Test: `tests/utility/platformPersistence.test.ts`

- [ ] Write failing migration tests for `privileged_audit_integrity` and singleton `privileged_audit_retention_state`, including forward upgrade from schema 22.
- [ ] Write failing persistence tests that establish a chain for legacy rows, append atomically, reject row/digest tamper, prune only a contiguous prefix of fully terminal request groups, preserve unresolved groups, retain a verifiable anchor, and fail closed when the hard cap cannot be enforced safely.
- [ ] Run both focused suites and verify each new test is RED for the intended missing behavior.
- [ ] Add migration 23 and implement SHA-256 domain-separated chain initialization/verification, atomic append, retention maintenance, recent-list, and retention-state reads.
- [ ] Keep `summarizePrivilegedAudit()` compatible by reporting total accepted records (`pruned + retained`) and the immutable last sequence.
- [ ] Run both focused suites GREEN, reopen the database, and rerun the tamper cases.

## Task 3: Carry the new operations through the utility protocol

**Files:**

- Modify: `apps/desktop/src/shared/persistenceUtilityProtocol.ts`
- Modify: `apps/desktop/src/utility/persistence/persistenceUtilityService.ts`
- Modify: `apps/desktop/src/main/persistence/persistenceUtilityClient.ts`
- Test: `tests/shared/persistenceUtilityProtocol.test.ts`
- Test: `tests/utility/persistenceUtilityService.test.ts`
- Test: `tests/main/persistenceUtilityClient.test.ts`

- [ ] Add failing exact-surface tests for the three new operations and malformed limits/timestamps/results.
- [ ] Verify RED, then add request/result validation and exhaustive dispatch/client methods.
- [ ] Make utility startup run one retention/integrity maintenance pass using its injected clock before reporting ready.
- [ ] Run protocol, service, client, and persistence tests GREEN.

## Task 4: Build the Main-owned local diagnostic exporter

**Files:**

- Create: `apps/desktop/src/main/diagnostics/diagnosticExportService.ts`
- Create: `apps/desktop/src/compatibility/aionui/diagnosticExport.ts`
- Modify: `apps/desktop/src/compatibility/aionui/index.ts`
- Test: `tests/main/diagnosticExportService.test.ts`
- Test: `tests/compatibility/aionuiDiagnosticExport.test.ts`

- [ ] Write failing tests for cancelled save, private atomic JSON output, destination-symlink rejection, size enforcement, per-export aliases, audit/attempt redaction, no raw logs, and stable rejected statuses.
- [ ] Verify RED, then implement the service with injected persistence, clock, app metadata, save-dialog port, random alias salt, and filesystem port.
- [ ] Main must never return the selected path or report bytes. The report must never contain credential references, provider data, prompts/completions, tool arguments/output references, patches, raw IDs, environment values, or user paths.
- [ ] Run focused tests GREEN and scan encoded fixtures for the forbidden sentinels.

## Task 5: Add the AionUI-native explicit-consent surface

**Files:**

- Create: `downstream/aionui-v2.1.41/patches/0020-actestra-p7-diagnostic-export.mjs`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `scripts/check-aionui-downstream.mjs`
- Test: materialized `tests/unit/actestra/diagnosticExport.dom.test.tsx`
- Test: materialized `tests/unit/actestra/diagnosticExportBridge.test.ts`

- [ ] Write the patch's materialized tests first: the About entry opens an explicit-consent modal, states included/excluded data and local-only behavior, invokes a no-argument Main bridge only after confirmation, handles cancel/success/rejection, and preserves existing About links and feedback isolation.
- [ ] Verify the new materialized tests fail before the UI/bridge patch is applied.
- [ ] Add source-copy entries for the new contracts/service; expose one fixed current-main-frame IPC operation; register/dispose it with the existing persistence composition; expose only `exportReport()` in preload.
- [ ] Add an AionUI-native diagnostics card/modal in About settings. Renderer receives status only and no filesystem, persistence, audit-record, or report-content authority.
- [ ] Classify the patch R1, record rollback, and extend downstream exact-path/authority checks.
- [ ] Materialize and run the two focused AionUI tests, typecheck, downstream check, and foundation check GREEN.

## Task 6: Add packaged P7.4 acceptance

**Files:**

- Create: `apps/desktop/src/main/security/p7DiagnosticAuditSmoke.ts`
- Create: `scripts/smoke-p7-4-diagnostic-audit.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `downstream/aionui-v2.1.41/patches/0020-actestra-p7-diagnostic-export.mjs`
- Test: `tests/security/p7DiagnosticAuditSmoke.test.ts`
- Test: `tests/scripts/p7DiagnosticAuditHarness.test.mjs`

- [ ] Write failing harness tests for isolation-root validation, private output, schema/retention/chain evidence, old-terminal pruning, unresolved preservation, redaction sentinels, no residual process, timeout, and nonzero failure.
- [ ] Verify RED, then add the E2E-only packaged composition and outer harness.
- [ ] Add `smoke:p7-4-diagnostic-audit` after P7.2 smoke in macOS CI; it must exercise the exact packaged app and fresh isolated profile.
- [ ] Run focused harness and packaged hook tests GREEN.

## Task 7: Complete local and packaged verification

**Files:**

- Modify only defects demonstrated by the specified gates.

- [ ] Run focused core, persistence, protocol, Main, compatibility, downstream, security, and harness suites.
- [ ] Run `bun run test:security`, `bun run check`, `bun run docs:check`, and `git diff --check`.
- [ ] Build the development app with `bun run dist:dir` after `check`.
- [ ] Run existing General Work, P7.1 security, P7.2 resource, and new P7.4 packaged smoke against the same app bytes.
- [ ] Verify no credential/path/content sentinel in source diff, logs, or report and no residual Actestra/AionCore/General/Goose/Planner process.

## Task 8: Final P7 security review, documentation, and governed integration

**Files:**

- Modify: `docs/security/THREAT_MODEL.md`
- Modify: `docs/security/P7_ABUSE_CASES.md`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`
- Modify: `docs/product/MVP.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/README.md`

- [ ] Audit every P7 invariant and 28 abuse cases against the final product-source parent; update the threat-model revision binding without weakening any P7.1 result.
- [ ] Record P7.4 local/package evidence and explicitly preserve P8, Windows/Linux, formal signing/notarization, release, deployment, and final user acceptance as non-claims.
- [ ] Commit production/test bytes first, then the revision-binding/status documentation.
- [ ] Push `codex/p7-4-diagnostic-audit`, open a PR, and wait for both required exact-head checks.
- [ ] Review comments and changed-files disposition; merge only after both checks are GREEN.
- [ ] Verify the squash result with an independent merged-main CI run, main-only artifact, clean `main`, synchronized `origin/main`, and no residual processes.
