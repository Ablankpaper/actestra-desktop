# Actestra-Native Team Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned, Actestra-owned, no-tool/no-credential Team planner sidecar that can be admitted by Core while keeping Worker readiness and P6 acceptance explicitly separate.

**Architecture:** A pure planner function creates one bounded three-node candidate (parallel General and Goose workers followed by human feedback). A dedicated utility-process entry exposes that function over the existing closed JSON-lines protocol; Main supervises the process with fixed packaged paths and Core remains the sole authority for normalization, IDs, persistence, scheduling, approval, and recovery. Downstream composition reports planner admission independently from missing Worker runtimes.

**Tech Stack:** TypeScript 5.9, Electron utility process/Node stdio, Vitest, downstream AionUI v2.1.41 materialization, existing JSON-lines protocol and TeamPlanAdmissionService.

---

## Task 1: Record the decision and freeze the implementation boundary

**Files:**

- Create: `docs/architecture/decisions/0026-actestra-native-team-planner.md`
- Create: `docs/superpowers/plans/2026-08-07-actestra-native-team-planner.md`
- Modify: `docs/architecture/decisions/README.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/decisions/0015-crewai-supervised-orchestration-sidecar.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/PROJECT_STATUS.md`

- [x] **Step 1: Write ADR-0026 and this plan**

Record the exact engine name/version, source allowlist, closed environment,
authority split, packaged entry, rollback revision, and non-claims. Mark ADR-0015
as partially superseded only for planner-engine selection.

- [x] **Step 2: Run documentation checks**

Run:

```bash
bun run docs:check
git diff --check -- docs
```

Expected: all links resolve and `git diff --check` is clean. No production or
test bytes are changed by this task.

## Task 2: Prove the production identity is absent (RED)

**Files:**

- Create: `tests/main/actestraNativeTeamPlanner.test.ts`
- Create: `tests/scripts/actestraNativePlannerBoundary.test.mjs`
- Modify: `scripts/check-aionui-downstream.mjs`
- Modify: `scripts/check-product-boundary.mjs`

- [x] **Step 1: Add RED assertions**

The tests must fail on the current bytes by requiring the new production module,
the dedicated entry, the exact engine marker, and one downstream
`actestra-team-planner.js` entry. They must also reject fixture/local-agent
imports and any `fs`, `net`, `child_process`, `http`, `https`, `fetch`, or
credential access in the production entry.

- [x] **Step 2: Run only the affected RED tests**

```bash
bunx vitest run tests/main/actestraNativeTeamPlanner.test.ts
bunx vitest run tests/scripts/actestraNativePlannerBoundary.test.mjs
```

Expected: both fail because the production source and packaged entry do not yet
exist. This is the only RED evidence needed for the identity layer.

## Task 3: Implement the pure native planner (GREEN)

**Files:**

- Create: `apps/desktop/src/main/orchestration/actestraNativeTeamPlanner.ts`
- Modify: `tests/main/actestraNativeTeamPlanner.test.ts`

- [x] **Step 1: Implement the exact public API**

Export:

```ts
export const ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE = Object.freeze({
  name: "actestra-native-team-planner",
  version: "1.0.0",
});
export function createActestraNativeTeamPlanCandidate(requestValue: unknown): TeamPlanCandidate;
export function aggregateActestraNativeTeamArtifacts(
  payloadValue: unknown,
): TeamPlannerAggregateResult;
```

Normalize the request with `normalizeTeamPlannerRequest`, require both
capabilities, copy only bounded goal/context metadata, and return exactly the
General, coding, and dependent human-feedback nodes with stable candidate keys.
Normalize the aggregate payload and return a deterministic summary plus the
same ordered Artifact references. Never create authority IDs, read content, or
perform I/O.

- [x] **Step 2: Run focused GREEN tests**

```bash
bunx vitest run tests/main/actestraNativeTeamPlanner.test.ts
```

Expected: exact candidate/aggregation, missing-capability rejection, limit
rejection, immutability, and deterministic repeat tests pass.

## Task 4: Add the supervised production entry (RED → GREEN)

**Files:**

- Create: `apps/desktop/src/utility/orchestration/actestraNativeTeamPlannerEntry.ts`
- Create: `apps/desktop/src/main/orchestration/actestraNativeTeamPlannerProcess.ts`
- Create: `tests/fixtures/actestraNativeTeamPlannerProbe.mjs`
- Modify: `tests/main/actestraNativeTeamPlannerProcess.test.ts`
- Modify: `tests/main/actestraNativeTeamPlanner.test.ts`

- [x] **Step 1: Add process RED**

Assert the entry writes the exact ready handshake, serves one normalized propose
or aggregate request, rejects unknown operations, and exits after stdin EOF.
Assert the Main wrapper supplies the fixed engine identity and closes the whole
process group after timeout, abort, and explicit close. The wrapper test must
inspect the child environment and prove no parent credential or `PATH` value is
forwarded. A separate parent harness must exit without calling `close()` and
prove that the planner leader and every descendant disappear before packaged
parent-death/no-orphan can be marked GREEN.

- [x] **Step 2: Implement the entry and wrapper**

The entry imports only the pure planner, `readline`, and protocol normalizers;
it does not import filesystem, shell, network, credential, or child-process
modules. The wrapper calls the existing `TeamPlannerSidecarProcess` with an
absolute trusted executable and fixed args, then exposes `propose`, `aggregate`,
and `close`. A missing or mismatched engine fails closed.

- [x] **Step 3: Run focused process tests**

```bash
bunx vitest run tests/main/actestraNativeTeamPlannerProcess.test.ts tests/main/teamPlannerSidecarProcess.test.ts
```

Expected: the new production entry passes deterministic request/response plus
abort, timeout, and explicit-close wrapper cases; the unchanged generic
supervisor tests stay green. The production entry is stdio-only and cannot
create descendants; the fixture's descendant mode remains test-only. Reuse
the merged generic supervisor process-group evidence for cleanup mechanics and
reserve packaged parent-death smoke for the release gate.

## Task 5: Package and wire the planner without claiming Workers

**Files:**

- Modify: `downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs`
- Modify: `scripts/check-aionui-downstream.mjs`
- Modify: `tests/scripts/aionuiDownstreamPathSafety.test.mjs`
- Modify: `tests/scripts/actestraNativePlannerBoundary.test.mjs`
- Modify: `tests/main/actestraNativeTeamPlanner.test.ts`

- [x] **Step 1: Add downstream source-copy and entry RED**

Require the production source and utility entry to be copied to the declared
Actestra downstream paths, the generated build to contain exactly
`actestra-team-planner.js`, and no fixture/local-agent source to be copied.

- [x] **Step 2: Add the fixed package entry**

Materialized Electron config gets one utility/main entry named
`actestra-team-planner`; the generated package uses a trusted absolute path and
the closed environment. No root legacy renderer entry is restored.

- [x] **Step 3: Wire composition readiness**

Change `ActestraTeamComposition` so planner admission is reported separately
from `options.coding === null`. It may create a planner-only readiness object, but
it must not construct `TeamOrchestratorService` or accept a task until both
Worker ports are present. The bridge projection uses `worker-runtime-unavailable`
and `configure-goose-runtime` for that case, preserving the existing
`planner-unavailable` state only when the planner itself is absent.

- [ ] **Step 4: Run affected downstream checks**

```bash
bun run downstream:aionui:materialize
bunx vitest run tests/main/actestraNativeTeamPlanner.test.ts tests/scripts/aionuiDownstreamPathSafety.test.mjs
bun run --cwd .actestra/aionui-v2.1.41 typecheck
```

Expected: generated source-copy, entry, and composition tests pass; no native
Team surface is removed.

## Task 6: Verify the stable local closure

**Files:**

- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/architecture/decisions/0026-actestra-native-team-planner.md`

- [ ] **Step 1: Run focused production checks**

Run the affected Vitest files, strict root and materialized TypeScript, targeted
zero-warning lint, downstream/foundation contract checks, and Markdown/link
checks. Do not run `bun run check` until all shared production bytes are stable;
then run it at most once for this complete vertical slice.

- [ ] **Step 2: Audit final scope**

Run `git diff --check`, `git diff --name-status`, a secret scan, and a static
review for Aera paths, credentials, fixture imports, CLI names, and old P2
renderer entrypoints. Confirm no Electron, planner, Worker, fixture, or temp
directory remains.

- [ ] **Step 3: Update status without overclaiming**

Record exact local test fingerprints and state that native planner admission is
local-only, Worker runtime and real mixed Electron acceptance remain open, the
ledger remains 2/7, and no commit/push/PR/Actions/release occurred.
