# P8.1 Acceptance Contract and Platform Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one fail-closed, human-readable and machine-checkable P8
acceptance contract for the exact macOS arm64, Windows x64, and Ubuntu x64
internal-beta targets without claiming that cross-platform runtime support or a
candidate already exists.

**Architecture:** Keep the product and frozen AionUI foundation unchanged.
Add one data-only platform matrix, one deterministic checker, and focused tests
that bind the exact targets, packages, journeys, evidence states, and non-claims.
Record the same contract in ADR-0030 and the authoritative product, architecture,
roadmap, and status documents; then deliver it through the existing governed PR
and exact-head/merged-main CI path.

**Tech Stack:** Node.js 24 ESM, Bun 1.3.9, Vitest 4.1, JSON-compatible frozen
JavaScript data, Markdown ADR/product documentation, existing Actestra root
gates, and GitHub Actions.

---

## File map

### New files

- `scripts/p8-platform-matrix.mjs`: immutable P8.1 contract plus closed
  validation function; no runtime or credential authority.
- `scripts/check-p8-platform-matrix.mjs`: bounded CLI gate that validates the
  in-repository contract and prints counts or stable reason codes only.
- `tests/scripts/p8PlatformMatrix.test.mjs`: exact target, package, journey,
  evidence, mutation, freezing, CLI, and root-gate regression tests.
- `tests/scripts/p8AcceptanceDocs.test.mjs`: ADR, product matrix, authority
  ordering, staged evidence, and non-claim consistency tests.
- `docs/architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md`:
  accepted authority for the initial P8 matrix and evidence vocabulary.
- `docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md`: human-readable target,
  journey, evidence, phase, and exit-gate matrix.
- `docs/superpowers/plans/2026-08-16-p8-1-acceptance-contract-platform-matrix.md`:
  this implementation plan.

### Existing files to modify

- `package.json`: add `p8:contract:check` and make the complete root `check`
  invoke it before platform-dependent probes.
- `docs/README.md`: index ADR-0030 and the P8 product matrix.
- `docs/architecture/decisions/README.md`: register ADR-0030 as Accepted.
- `docs/architecture/SYSTEM_OVERVIEW.md`: state the accepted three-target
  contract and preserve the current macOS-only runtime truth.
- `docs/product/MVP.md`: bind internal-beta success to the exact initial
  target matrix and evidence separation.
- `docs/roadmap/DEVELOPMENT_SEQUENCE.md`: divide P8 into P8.1–P8.4 and record
  the P8.1 gate without claiming later batches.
- `docs/PROJECT_STATUS.md`: record local, pushed, CI, merge, and merged-main
  evidence only after each state actually exists.

`foundation/`, Renderer, preload, Electron Main, Core, Worker runtime,
downstream patches, `.github/workflows/ci.yml`, installer configuration, and
signing configuration do not change in P8.1.

## Closed contract values

The implementation uses these exact target records:

```js
[
  {
    id: "macos-15-arm64",
    ciRunner: "macos-15",
    acceptanceEnvironment: "macOS 15 arm64",
    electronPlatform: "darwin",
    architecture: "arm64",
    packageFormats: ["dmg", "zip"],
  },
  {
    id: "windows-11-x64",
    ciRunner: "windows-2025",
    acceptanceEnvironment: "Windows 11 24H2 x64",
    electronPlatform: "win32",
    architecture: "x64",
    packageFormats: ["nsis"],
  },
  {
    id: "ubuntu-24.04-x64",
    ciRunner: "ubuntu-24.04",
    acceptanceEnvironment: "Ubuntu 24.04 LTS x64",
    electronPlatform: "linux",
    architecture: "x64",
    packageFormats: ["deb"],
  },
]
```

The exact required-journey identifiers are:

```js
[
  { id: "fresh-profile-launch", requiredBatch: "P8.2" },
  { id: "general-artifact", requiredBatch: "P8.2" },
  { id: "goose-isolated-patch", requiredBatch: "P8.2" },
  { id: "workspace-apply-approval", requiredBatch: "P8.2" },
  { id: "general-goose-team", requiredBatch: "P8.2" },
  { id: "cancellation-no-orphan", requiredBatch: "P8.2" },
  { id: "crash-restart-recovery", requiredBatch: "P8.2" },
  { id: "privacy-redaction", requiredBatch: "P8.2" },
  { id: "p7-platform-obligations", requiredBatch: "P8.2" },
  { id: "clean-install", requiredBatch: "P8.4" },
  { id: "upgrade-state-continuity", requiredBatch: "P8.4" },
  { id: "rollback-after-update-failure", requiredBatch: "P8.4" },
  { id: "uninstall-data-choice", requiredBatch: "P8.4" },
  { id: "real-provider-acceptance", requiredBatch: "P8.4" },
]
```

The exact evidence identifiers are:

```js
[
  { id: "native-package-runtime", requiredBatch: "P8.2" },
  { id: "platform-security-boundaries", requiredBatch: "P8.2" },
  { id: "candidate-digest-sbom-provenance", requiredBatch: "P8.3" },
  { id: "signing-notarization", requiredBatch: "P8.3" },
  { id: "update-metadata-rollback", requiredBatch: "P8.3" },
  { id: "clean-machine-lifecycle", requiredBatch: "P8.4" },
  { id: "internal-beta-runbook-issue-intake", requiredBatch: "P8.4" },
]
```

The matrix result vocabulary is exactly:

```js
[
  "verified",
  "failed",
  "unsupported-platform",
  "evidence-incomplete",
  "test-harness-invalid",
]
```

P7 attacks continue to use `denied-safe` as their only pass state. P8.1 does
not reinterpret that vocabulary.

---

### Task 1: Add the failing exact-matrix contract test

**Files:**

- Create: `tests/scripts/p8PlatformMatrix.test.mjs`
- Test: `tests/scripts/p8PlatformMatrix.test.mjs`

- [ ] **Step 1: Write the failing file-existence and exact-value test**

Create the test with this initial content. The existence assertion deliberately
precedes the dynamic import so the RED is an assertion failure rather than an
ESM loader error.

```js
// @vitest-environment node

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(root, "scripts/p8-platform-matrix.mjs");

const expectedTargets = [
  {
    id: "macos-15-arm64",
    ciRunner: "macos-15",
    acceptanceEnvironment: "macOS 15 arm64",
    electronPlatform: "darwin",
    architecture: "arm64",
    packageFormats: ["dmg", "zip"],
  },
  {
    id: "windows-11-x64",
    ciRunner: "windows-2025",
    acceptanceEnvironment: "Windows 11 24H2 x64",
    electronPlatform: "win32",
    architecture: "x64",
    packageFormats: ["nsis"],
  },
  {
    id: "ubuntu-24.04-x64",
    ciRunner: "ubuntu-24.04",
    acceptanceEnvironment: "Ubuntu 24.04 LTS x64",
    electronPlatform: "linux",
    architecture: "x64",
    packageFormats: ["deb"],
  },
];

const expectedJourneys = [
  ["fresh-profile-launch", "P8.2"],
  ["general-artifact", "P8.2"],
  ["goose-isolated-patch", "P8.2"],
  ["workspace-apply-approval", "P8.2"],
  ["general-goose-team", "P8.2"],
  ["cancellation-no-orphan", "P8.2"],
  ["crash-restart-recovery", "P8.2"],
  ["privacy-redaction", "P8.2"],
  ["p7-platform-obligations", "P8.2"],
  ["clean-install", "P8.4"],
  ["upgrade-state-continuity", "P8.4"],
  ["rollback-after-update-failure", "P8.4"],
  ["uninstall-data-choice", "P8.4"],
  ["real-provider-acceptance", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

const expectedEvidence = [
  ["native-package-runtime", "P8.2"],
  ["platform-security-boundaries", "P8.2"],
  ["candidate-digest-sbom-provenance", "P8.3"],
  ["signing-notarization", "P8.3"],
  ["update-metadata-rollback", "P8.3"],
  ["clean-machine-lifecycle", "P8.4"],
  ["internal-beta-runbook-issue-intake", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

describe("P8.1 platform matrix", () => {
  it("publishes the exact approved targets and obligations", async () => {
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) return;
    const { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } = await import(contractPath);
    expect(P8_PLATFORM_MATRIX).toEqual({
      contractVersion: 1,
      phase: "P8",
      targets: expectedTargets,
      requiredJourneys: expectedJourneys,
      requiredEvidence: expectedEvidence,
      evidenceStates: [
        "verified",
        "failed",
        "unsupported-platform",
        "evidence-incomplete",
        "test-harness-invalid",
      ],
      securityPassState: "denied-safe",
      nonClaims: [
        "cross-platform-runtime-implemented",
        "formal-signing",
        "notarization",
        "candidate",
        "release",
        "deployment",
        "distribution",
        "user-acceptance",
      ],
    });
    expect(validateP8PlatformMatrix(P8_PLATFORM_MATRIX)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify the intended RED**

Run:

```bash
bun run test tests/scripts/p8PlatformMatrix.test.mjs
```

Expected: one failed test at `expect(existsSync(contractPath)).toBe(true)` with
`Received: false`. No loader, syntax, or unrelated test error is acceptable.

- [ ] **Step 3: Commit only the RED test**

```bash
git add tests/scripts/p8PlatformMatrix.test.mjs
git diff --cached --check
git commit -m "test: define P8 platform matrix contract"
```

---

### Task 2: Implement and mutation-test the immutable matrix

**Files:**

- Create: `scripts/p8-platform-matrix.mjs`
- Modify: `tests/scripts/p8PlatformMatrix.test.mjs`
- Test: `tests/scripts/p8PlatformMatrix.test.mjs`

- [ ] **Step 1: Add mutation and freeze assertions before implementation**

Append a second test inside the existing `describe` block:

```js
  it("rejects widening, missing evidence, duplicate IDs, conflation, and skip-as-pass", async () => {
    const { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } = await import(contractPath);
    const mutate = (apply) => {
      const candidate = structuredClone(P8_PLATFORM_MATRIX);
      apply(candidate);
      return validateP8PlatformMatrix(candidate);
    };

    expect(mutate((value) => value.targets.push({ ...value.targets[0], id: "macos-15-x64" })))
      .toContain("target-count");
    expect(mutate((value) => value.requiredJourneys.pop())).toContain("journey-count");
    expect(mutate((value) => { value.targets[1].id = value.targets[0].id; }))
      .toContain("target-ids");
    expect(mutate((value) => {
      value.targets[2].acceptanceEnvironment = value.targets[2].ciRunner;
    })).toContain("target-builder-acceptance-conflated:ubuntu-24.04-x64");
    expect(mutate((value) => { value.evidenceStates[0] = "skipped"; }))
      .toContain("evidence-states");
    expect(mutate((value) => { value.unexpected = true; })).toContain("root-keys");
    expect(Object.isFrozen(P8_PLATFORM_MATRIX)).toBe(true);
    expect(P8_PLATFORM_MATRIX.targets.every(Object.isFrozen)).toBe(true);
    expect(P8_PLATFORM_MATRIX.requiredJourneys.every(Object.isFrozen)).toBe(true);
  });
```

Run the focused test. Expected: the first test fails because the module is
still absent; do not add implementation until that expected failure is seen.

- [ ] **Step 2: Add the minimal immutable contract and validator**

Create `scripts/p8-platform-matrix.mjs` with these exports and validation
behavior:

```js
const rootKeys = [
  "contractVersion",
  "evidenceStates",
  "nonClaims",
  "phase",
  "requiredEvidence",
  "requiredJourneys",
  "securityPassState",
  "targets",
];
const targetKeys = [
  "acceptanceEnvironment",
  "architecture",
  "ciRunner",
  "electronPlatform",
  "id",
  "packageFormats",
];
const obligationKeys = ["id", "requiredBatch"];

const expectedTargets = [
  ["macos-15-arm64", "macos-15", "macOS 15 arm64", "darwin", "arm64", ["dmg", "zip"]],
  ["windows-11-x64", "windows-2025", "Windows 11 24H2 x64", "win32", "x64", ["nsis"]],
  ["ubuntu-24.04-x64", "ubuntu-24.04", "Ubuntu 24.04 LTS x64", "linux", "x64", ["deb"]],
].map(([id, ciRunner, acceptanceEnvironment, electronPlatform, architecture, packageFormats]) => ({
  id,
  ciRunner,
  acceptanceEnvironment,
  electronPlatform,
  architecture,
  packageFormats,
}));

const expectedJourneys = [
  ["fresh-profile-launch", "P8.2"], ["general-artifact", "P8.2"],
  ["goose-isolated-patch", "P8.2"], ["workspace-apply-approval", "P8.2"],
  ["general-goose-team", "P8.2"], ["cancellation-no-orphan", "P8.2"],
  ["crash-restart-recovery", "P8.2"], ["privacy-redaction", "P8.2"],
  ["p7-platform-obligations", "P8.2"], ["clean-install", "P8.4"],
  ["upgrade-state-continuity", "P8.4"], ["rollback-after-update-failure", "P8.4"],
  ["uninstall-data-choice", "P8.4"], ["real-provider-acceptance", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

const expectedEvidence = [
  ["native-package-runtime", "P8.2"], ["platform-security-boundaries", "P8.2"],
  ["candidate-digest-sbom-provenance", "P8.3"], ["signing-notarization", "P8.3"],
  ["update-metadata-rollback", "P8.3"], ["clean-machine-lifecycle", "P8.4"],
  ["internal-beta-runbook-issue-intake", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

const evidenceStates = [
  "verified", "failed", "unsupported-platform", "evidence-incomplete", "test-harness-invalid",
];
const nonClaims = [
  "cross-platform-runtime-implemented", "formal-signing", "notarization", "candidate",
  "release", "deployment", "distribution", "user-acceptance",
];

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function sameKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function same(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

export const P8_PLATFORM_MATRIX = freeze({
  contractVersion: 1,
  phase: "P8",
  targets: expectedTargets,
  requiredJourneys: expectedJourneys,
  requiredEvidence: expectedEvidence,
  evidenceStates,
  securityPassState: "denied-safe",
  nonClaims,
});

export function validateP8PlatformMatrix(value) {
  const reasons = [];
  if (!sameKeys(value, rootKeys)) reasons.push("root-keys");
  if (value?.contractVersion !== 1) reasons.push("contract-version");
  if (value?.phase !== "P8") reasons.push("phase");
  if (!Array.isArray(value?.targets) || value.targets.length !== expectedTargets.length)
    reasons.push("target-count");
  const targetIds = Array.isArray(value?.targets) ? value.targets.map(({ id }) => id) : [];
  if (!same(targetIds, expectedTargets.map(({ id }) => id))) reasons.push("target-ids");
  for (const target of Array.isArray(value?.targets) ? value.targets : []) {
    if (!sameKeys(target, targetKeys)) reasons.push(`target-keys:${String(target?.id)}`);
    const expected = expectedTargets.find(({ id }) => id === target?.id);
    if (!expected || !same(target, expected)) reasons.push(`target-values:${String(target?.id)}`);
    if (target?.ciRunner === target?.acceptanceEnvironment)
      reasons.push(`target-builder-acceptance-conflated:${String(target?.id)}`);
  }
  if (!Array.isArray(value?.requiredJourneys) || value.requiredJourneys.length !== expectedJourneys.length)
    reasons.push("journey-count");
  if (!same(value?.requiredJourneys, expectedJourneys)) reasons.push("journeys");
  for (const item of Array.isArray(value?.requiredJourneys) ? value.requiredJourneys : [])
    if (!sameKeys(item, obligationKeys)) reasons.push(`journey-keys:${String(item?.id)}`);
  if (!Array.isArray(value?.requiredEvidence) || value.requiredEvidence.length !== expectedEvidence.length)
    reasons.push("evidence-count");
  if (!same(value?.requiredEvidence, expectedEvidence)) reasons.push("evidence");
  for (const item of Array.isArray(value?.requiredEvidence) ? value.requiredEvidence : [])
    if (!sameKeys(item, obligationKeys)) reasons.push(`evidence-keys:${String(item?.id)}`);
  if (!same(value?.evidenceStates, evidenceStates)) reasons.push("evidence-states");
  if (value?.securityPassState !== "denied-safe") reasons.push("security-pass-state");
  if (!same(value?.nonClaims, nonClaims)) reasons.push("non-claims");
  return Object.freeze([...new Set(reasons)]);
}
```

- [ ] **Step 3: Run focused tests and verify GREEN**

```bash
bun run test tests/scripts/p8PlatformMatrix.test.mjs
```

Expected: 2 tests passed, 0 failed, 0 skipped.

- [ ] **Step 4: Run formatter and focused lint**

```bash
bunx oxfmt --write scripts/p8-platform-matrix.mjs tests/scripts/p8PlatformMatrix.test.mjs
bunx oxlint --deny-warnings scripts/p8-platform-matrix.mjs tests/scripts/p8PlatformMatrix.test.mjs
```

Expected: 0 warnings and 0 errors. Rerun the focused tests after formatting.

- [ ] **Step 5: Commit the immutable contract**

```bash
git add scripts/p8-platform-matrix.mjs tests/scripts/p8PlatformMatrix.test.mjs
git diff --cached --check
git commit -m "feat: add P8 platform matrix contract"
```

---

### Task 3: Add the explicit contract gate to the root check

**Files:**

- Create: `scripts/check-p8-platform-matrix.mjs`
- Modify: `tests/scripts/p8PlatformMatrix.test.mjs`
- Modify: `package.json`
- Test: `tests/scripts/p8PlatformMatrix.test.mjs`

- [ ] **Step 1: Write failing CLI and package-wiring assertions**

Add imports for `readFileSync` and `spawnSync`, then append:

```js
  it("runs a bounded explicit checker from the complete root gate", () => {
    const checkerPath = path.join(root, "scripts/check-p8-platform-matrix.mjs");
    expect(existsSync(checkerPath)).toBe(true);
    if (!existsSync(checkerPath)) return;
    const run = spawnSync(process.execPath, [checkerPath], {
      cwd: root,
      encoding: "utf8",
    });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout.trim()).toBe(
      "P8.1 platform contract passed: 3 targets, 14 journeys, 7 evidence classes.",
    );
    const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
    expect(scripts["p8:contract:check"]).toBe("node scripts/check-p8-platform-matrix.mjs");
    expect(scripts.check).toContain("bun run p8:contract:check");
    expect(scripts.check.indexOf("bun run p8:contract:check")).toBeLessThan(
      scripts.check.indexOf("bun run test:electron-sqlite"),
    );
  });
```

Run the focused test. Expected: the new test fails because the checker path is
absent.

- [ ] **Step 2: Add the bounded checker**

Create `scripts/check-p8-platform-matrix.mjs`:

```js
import { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } from "./p8-platform-matrix.mjs";

const reasons = validateP8PlatformMatrix(P8_PLATFORM_MATRIX);
if (reasons.length > 0) {
  console.error(`P8.1 platform contract failed: ${reasons.join(",")}`);
  process.exit(1);
}

console.log(
  `P8.1 platform contract passed: ${P8_PLATFORM_MATRIX.targets.length} targets, ` +
    `${P8_PLATFORM_MATRIX.requiredJourneys.length} journeys, ` +
    `${P8_PLATFORM_MATRIX.requiredEvidence.length} evidence classes.`,
);
```

- [ ] **Step 3: Wire the checker before platform-dependent probes**

Add this script to `package.json`:

```json
"p8:contract:check": "node scripts/check-p8-platform-matrix.mjs"
```

Change the beginning of `scripts.check` from:

```text
bun run format:check && bun run lint && bun run typecheck && bun run test:electron-sqlite
```

to:

```text
bun run format:check && bun run lint && bun run typecheck && bun run p8:contract:check && bun run test:electron-sqlite
```

- [ ] **Step 4: Verify focused GREEN and the direct gate**

```bash
bun run test tests/scripts/p8PlatformMatrix.test.mjs
bun run p8:contract:check
```

Expected: 3 tests passed and the exact one-line success summary above.

- [ ] **Step 5: Format, lint, and commit**

```bash
bunx oxfmt --write package.json scripts/check-p8-platform-matrix.mjs tests/scripts/p8PlatformMatrix.test.mjs
bunx oxlint --deny-warnings scripts/check-p8-platform-matrix.mjs tests/scripts/p8PlatformMatrix.test.mjs
git add package.json scripts/check-p8-platform-matrix.mjs tests/scripts/p8PlatformMatrix.test.mjs
git diff --cached --check
git commit -m "build: enforce P8 acceptance contract"
```

---

### Task 4: Record ADR-0030 and the human platform matrix

**Files:**

- Create: `tests/scripts/p8AcceptanceDocs.test.mjs`
- Create: `docs/architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md`
- Create: `docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/decisions/README.md`
- Test: `tests/scripts/p8AcceptanceDocs.test.mjs`

- [ ] **Step 1: Write the failing ADR/product-document test**

Create a Node-environment test that first checks both files exist, then verifies
the exact authority and non-claims:

```js
// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("P8.1 acceptance documentation", () => {
  it("indexes accepted ADR-0030 and the human platform matrix", () => {
    const adrPath = "docs/architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md";
    const productPath = "docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md";
    expect(fs.existsSync(path.join(root, adrPath))).toBe(true);
    expect(fs.existsSync(path.join(root, productPath))).toBe(true);
    if (![adrPath, productPath].every((entry) => fs.existsSync(path.join(root, entry)))) return;
    const adr = read(adrPath);
    const product = read(productPath);
    expect(adr).toContain("# ADR-0030:");
    expect(adr).toContain("- Status: Accepted");
    expect(read("docs/architecture/decisions/README.md")).toContain(
      "[0030]" + "(0030-p8-cross-platform-internal-beta-acceptance.md)",
    );
    expect(read("docs/README.md")).toContain(
      "product/P8_CROSS_PLATFORM_INTERNAL_BETA.md",
    );
    for (const id of ["macos-15-arm64", "windows-11-x64", "ubuntu-24.04-x64"])
      expect(adr + product).toContain(id);
    for (const value of ["General", "Goose", "Team", "approval", "recovery", "privacy"])
      expect(product).toContain(value);
    expect(adr).toContain("unsupported-platform");
    expect(adr).toContain("does not modify `foundation/`");
    expect(product).toContain("Completing P8.1 does not prove a Windows or Linux build");
    expect(product).toContain("P8.2");
    expect(product).toContain("P8.3");
    expect(product).toContain("P8.4");
  });
});
```

Run the test. Expected: it fails because ADR-0030 and the product matrix are
absent.

- [ ] **Step 2: Write ADR-0030**

Use the accepted ADR structure `Context`, `Decision`, `Consequences`, `Rejected
alternatives`, `Rollback`, and `Review triggers`. The Decision must state these
exact rules:

```text
The initial matrix contains only macos-15-arm64, windows-11-x64, and
ubuntu-24.04-x64. CI builders and clean-machine acceptance environments are
separate evidence. Every target owes the same General, Goose, Team, approval,
recovery, privacy, and P7-invariant outcomes. Only verified advances a matrix
item; only denied-safe passes a P7 attack. skip, xfail, unsupported-platform,
missing jobs, and build-only packages do not pass. P8.1 does not modify
foundation/, implement Windows/Linux runtime support, sign a candidate,
publish update metadata, release, deploy, distribute, or claim user
acceptance.
```

Record that AionUI, Main/Core, Tool Gateway, Goose, AionCore, planner,
persistence, and Renderer boundaries remain unchanged. Reject build-only,
broad-first, and replacement-shell alternatives. Rollback removes the checker,
matrix, and P8.1 documentation without changing product or persisted state.

- [ ] **Step 3: Write the human-readable product matrix**

Use the approved design's exact platform table, the 14 required journeys, the
7 evidence classes, the five matrix states, P8.1–P8.4 stage ownership, failure
rules, and exit gates. Include these exact statements:

```text
Completing P8.1 does not prove a Windows or Linux build.
Completing P8.2 does not create a signed candidate.
Completing P8.3 does not prove clean-machine or user acceptance.
```

Do not include future run IDs, candidate versions, credentials, endpoints,
mutable local paths, or implementation claims.

- [ ] **Step 4: Index the new documents**

Add one purpose row for the product matrix in `docs/README.md`, one purpose row
for ADR-0030 in the same file, and one Accepted row in
`docs/architecture/decisions/README.md`. Do not reorder historical ADRs.

- [ ] **Step 5: Verify GREEN and document links**

```bash
bun run test tests/scripts/p8AcceptanceDocs.test.mjs
bun run docs:check
```

Expected: 1 test passed and all relative links resolve.

- [ ] **Step 6: Commit the accepted authority documents**

```bash
git add docs/README.md docs/architecture/decisions/README.md \
  docs/architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md \
  docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md \
  tests/scripts/p8AcceptanceDocs.test.mjs
git diff --cached --check
git commit -m "docs: accept P8 internal beta matrix"
```

---

### Task 5: Align every source-of-truth document

**Files:**

- Modify: `tests/scripts/p8AcceptanceDocs.test.mjs`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`
- Modify: `docs/product/MVP.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/PROJECT_STATUS.md`
- Test: `tests/scripts/p8AcceptanceDocs.test.mjs`

- [ ] **Step 1: Add failing cross-document assertions**

Append a second test:

```js
  it("keeps architecture, MVP, roadmap, and verified status on the same staged contract", () => {
    const overview = read("docs/architecture/SYSTEM_OVERVIEW.md");
    const mvp = read("docs/product/MVP.md");
    const roadmap = read("docs/roadmap/DEVELOPMENT_SEQUENCE.md");
    const status = read("docs/PROJECT_STATUS.md");
    for (const source of [overview, mvp, roadmap, status]) {
      for (const id of ["macos-15-arm64", "windows-11-x64", "ubuntu-24.04-x64"])
        expect(source).toContain(id);
      expect(source).toContain("P8.1");
      expect(source).toContain("P8.2");
      expect(source).toContain("P8.3");
      expect(source).toContain("P8.4");
    }
    expect(overview).toContain("current accepted runtime remains macOS arm64 only");
    expect(mvp).toContain("CI build evidence does not replace clean-machine acceptance");
    expect(roadmap).toContain("### P8.1 — Acceptance contract and platform matrix");
    expect(status).toContain("P8.1 acceptance contract implementation");
    expect(status).toContain("does not claim a Windows or Linux build");
    expect(status).toContain("formal signing, notarization, candidate, release, deployment");
  });
```

Run the focused test. Expected: the new test fails because the current source
documents describe P8 only as a future aggregate phase.

- [ ] **Step 2: Update System Overview without changing current runtime truth**

Add a P8 contract paragraph after the accepted P7 sequence. State the exact
three IDs, staged P8.1–P8.4 evidence, unchanged authorities, and this exact
sentence:

```text
The matrix is an acceptance obligation; the current accepted runtime remains
macOS arm64 only until P8.2 supplies native Windows and Linux evidence.
```

- [ ] **Step 3: Update MVP success criteria**

Bind the internal-beta criteria to the three target IDs, require General,
Goose, Team, approval, recovery, privacy, install lifecycle, candidate
integrity, and separate evidence states. Include:

```text
CI build evidence does not replace clean-machine acceptance.
```

Do not claim the MVP has reached internal beta.

- [ ] **Step 4: Divide the P8 roadmap into four gated subsections**

Preserve the existing aggregate deliverables and exit gate, then add exact
subsections for P8.1–P8.4. P8.1 names contract-only deliverables; P8.2 names
native matrix/runtime work; P8.3 names signed candidate/supply chain; P8.4
names install lifecycle, real-provider acceptance, runbook, and issue intake.
State that the later three batches are not started by P8.1.

- [ ] **Step 5: Add a factual local P8.1 status section**

At the top of `docs/PROJECT_STATUS.md`, add a dated section that records:

- branch `codex/p8-1-acceptance-contract`;
- baseline `d6e7dc63d5d95fc8435d6f5da0240b0a529cb0cd`;
- the exact three targets;
- P8.1 contract files and focused local commands actually run;
- current verification counts copied verbatim from command output; and
- explicit non-claims for Windows/Linux build, signing/notarization,
  candidate, release, deployment, distribution, and user acceptance.

Use `implementation` or `local evidence`; do not write `accepted on main`, a
pull request number, or CI run ID before those facts exist.

- [ ] **Step 6: Verify cross-document GREEN**

```bash
bun run test tests/scripts/p8AcceptanceDocs.test.mjs
bun run docs:check
```

Expected: 2 tests passed and every relative link resolves.

- [ ] **Step 7: Commit aligned source-of-truth documents**

```bash
git add tests/scripts/p8AcceptanceDocs.test.mjs \
  docs/architecture/SYSTEM_OVERVIEW.md docs/product/MVP.md \
  docs/roadmap/DEVELOPMENT_SEQUENCE.md docs/PROJECT_STATUS.md
git diff --cached --check
git commit -m "docs: align P8 acceptance sources"
```

---

### Task 6: Run the complete local P8.1 gate and record exact evidence

**Files:**

- Modify only if evidence wording changes: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Run focused contract and documentation gates**

```bash
bun run p8:contract:check
bun run test tests/scripts/p8PlatformMatrix.test.mjs tests/scripts/p8AcceptanceDocs.test.mjs
bun run docs:check
```

Expected: the checker reports 3 targets, 14 journeys, and 7 evidence classes;
all focused tests and links pass.

- [ ] **Step 2: Run the complete project gate from clean input**

```bash
bun run check
```

Expected: exit 0 for format, zero-warning lint, strict types, P8 contract,
Electron SQLite, the complete Vitest suite, P7 28-case/168-variant security
gate, smoke harness, product boundary, frozen foundation, downstream overlay,
and package build. Do not reuse the pre-change baseline as final evidence.

- [ ] **Step 3: Run final repository audits**

```bash
git diff --check
git status -sb
git diff --name-only origin/main...HEAD
git diff --name-only origin/main...HEAD -- foundation/
rg -n 'T[B]D|T[O]DO|implement l[a]ter|fill in d[e]tails' \
  docs/superpowers/specs/2026-08-16-p8-cross-platform-internal-beta-design.md \
  docs/superpowers/plans/2026-08-16-p8-1-acceptance-contract-platform-matrix.md \
  docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md \
  docs/architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md
```

Expected: diff check clean; worktree contains only intended committed changes;
the foundation query prints nothing; the placeholder scan prints nothing.

- [ ] **Step 4: Correct Project Status with literal final output if needed**

If focused or complete counts differ from the earlier local status text, edit
only those evidence lines to match the literal outputs from Steps 1–2. Run
`bun run docs:check` and the two focused test files again, then commit:

```bash
git add docs/PROJECT_STATUS.md
git diff --cached --check
git commit -m "docs: record P8.1 local gate"
```

Do not manufacture a no-op commit when the recorded counts already match.

---

### Task 7: Deliver the implementation through governed GitHub evidence

**Files:**

- Modify after real remote evidence exists: `docs/PROJECT_STATUS.md`
- Modify after real remote evidence exists: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`

- [ ] **Step 1: Push the implementation branch**

```bash
git status -sb
git push -u origin codex/p8-1-acceptance-contract
```

Expected: the remote branch points to the exact locally verified head.

- [ ] **Step 2: Create a ready pull request**

Create a PR to `main` whose body separates:

- P8.1 contract implementation;
- local focused and complete gate evidence;
- no foundation or product-runtime change; and
- explicit non-claims for P8.2–P8.4, candidate, release, deployment, and user
  acceptance.

Do not request cross-platform runtime acceptance from this PR.

- [ ] **Step 3: Wait for exact-head CI and verify the SHA**

Use `gh pr view` and `gh run view` to prove both required jobs are `success`
on the PR's exact `headRefOid`. A green run on an earlier SHA is not evidence.
Repair only failures attributable to this branch, rerun the affected narrow
gate, then rerun the complete gate before pushing a correction.

- [ ] **Step 4: Merge only after required checks pass**

Use the repository's governed squash-merge path. Record the PR number, final
head SHA, exact-head CI run ID, squash-merge SHA, and merged-main CI run ID from
GitHub rather than inferring them locally.

- [ ] **Step 5: Create a documentation-only integration-closure branch**

From the verified merged `origin/main`, create a fresh
`codex/p8-1-integration-closure` worktree or branch. Update only
`docs/PROJECT_STATUS.md` and `docs/roadmap/DEVELOPMENT_SEQUENCE.md` with the
literal remote evidence gathered in Steps 3–4. State that P8.1 is accepted on
main while P8.2–P8.4 remain open.

Run:

```bash
bun run test tests/scripts/p8AcceptanceDocs.test.mjs
bun run docs:check
bun run check
git diff --check
```

Create, verify, and merge the documentation PR through the same exact-head and
merged-main CI gates.

- [ ] **Step 6: Final P8.1 audit**

Verify local main, `origin/main`, and remote main match; both PRs are merged;
the latest merged-main CI is green; the worktrees are clean; `foundation/` is
unchanged; no release, deployment, or environment was created; and no Actestra,
AionCore, Goose, planner, General Worker, or test-probe process remains.

P8.1 may then be reported complete. The overall P8 goal remains active with
P8.2 as the next batch.
