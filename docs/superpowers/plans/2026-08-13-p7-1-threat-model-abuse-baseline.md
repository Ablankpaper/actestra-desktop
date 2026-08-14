# P7.1 Threat Model and Abuse-Case Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind Actestra's repository-wide security model to executable attacks,
close every discovered critical or high boundary violation, and prove the final
ad-hoc-signed macOS application denies the required attacks without protected
side effects or residual processes.

**Architecture:** Keep AionUI, Main/Core, Tool Gateway, approval, persistence,
Goose, General Worker, Team, and Artifact delivery as the only production
authorities. Add one metadata-only abuse catalog and one aggregate runner around
the existing focused suites; extend an owning production boundary only when a
faithful RED attack demonstrates a critical or high defect. Finish with a
strictly isolated packaged-macOS harness and a documentation-only revision that
binds the repository threat model to the exact reviewed product/test parent.

**Tech Stack:** TypeScript 5.9, Bun 1.3.9, Vitest 4, Electron 37, Node 24,
SQLite, macOS sandbox/process APIs, Git linked worktrees, AionUI v2.1.41
downstream overlays, Markdown, GitHub Actions.

---

## File map

### New files

- `docs/security/THREAT_MODEL.md`: repository-scoped threat model with the
  required repository/version footer.
- `docs/security/P7_ABUSE_CASES.md`: human-readable invariant, attack,
  disposition, and platform-obligation ledger.
- `docs/architecture/decisions/0027-p7-threat-model-and-abuse-authority.md`:
  accepted authority for invariant IDs, result vocabulary, catalog ownership,
  and P7 staging.
- `tests/security/abuseCaseCatalog.ts`: closed, metadata-only machine catalog.
- `tests/security/abuseCaseCatalog.test.ts`: exact-key, unique-ID, coverage,
  source-binding, redaction, and platform contract tests.
- `tests/security/rendererIpcCredentialAbuse.test.ts`: Renderer, preload, IPC,
  provider projection, cache, sentinel, and credential-substitution attacks.
- `tests/security/workspaceToolApprovalAbuse.test.ts`: workspace, Git,
  delivery, Tool Gateway, and approval-composition attacks.
- `tests/security/mcpWorkerProcessAbuse.test.ts`: real loopback, MCP, sandbox,
  environment, network, process-tree, timeout, cancellation, and parent-death
  attacks.
- `tests/security/persistenceArtifactRedactionAbuse.test.ts`: replay, CAS,
  tamper, false-terminal, redaction, artifact, package, license, and source-copy
  attacks.
- `scripts/run-p7-abuse-cases.mjs`: catalog validation plus deterministic
  layer-1 through layer-3 aggregate gate.
- `scripts/smoke-p7-security.mjs`: isolated packaged-macOS attack harness and
  bounded outcome verifier.
- `tests/scripts/p7SecurityHarness.test.mjs`: fail-closed harness parsing,
  environment, residue, and redaction tests.

### Existing files expected to change

- `package.json`: add `test:security` and `smoke:p7-security` entry points and
  place the attack gate before package build in `check`.
- `scripts/product-boundary-rules.mjs` and
  `scripts/check-product-boundary.mjs`: close only static authority gaps proven
  by the new attacks.
- `apps/desktop/src/main/security.ts`, `apps/desktop/src/main/ipc/desktopIpc.ts`,
  and downstream patch `0016`: change only if Renderer/IPC/credential RED tests
  expose a real critical/high violation.
- Existing owning Main/Core/Worker files: change only with a faithful failing
  attack and keep the repair at the current authority boundary.
- `.github/workflows/ci.yml`: run the catalog/abuse gate explicitly and run the
  packaged P7 security smoke after the existing package verification.
- `docs/README.md`, `docs/architecture/decisions/README.md`,
  `docs/architecture/SYSTEM_OVERVIEW.md`, `docs/product/MVP.md`,
  `docs/roadmap/DEVELOPMENT_SEQUENCE.md`, and `docs/PROJECT_STATUS.md`: record
  accepted scope and exact final evidence without claiming P7.2-P7.4 or P8.

`foundation/` must remain byte-identical. A user-visible AionUI change is not
planned; if a packaged attack proves one necessary, it must use a new recorded
downstream patch, R0/R1/R2 classification, compatibility proof, and exact
overlay registration.

## Closed catalog allocation

The catalog uses these 28 cases. A case may run several input variants only
when all variants share one protected invariant, rejection boundary, forbidden
side-effect set, and severity.

| ID | Required variants |
| --- | --- |
| `P7-A-RENDERER-001` | direct Node, Electron, privileged-process, shell, persistence, filesystem, and Git imports |
| `P7-A-RENDERER-002` | direct fetch, WebSocket, EventSource, XMLHttpRequest, and window-require escape |
| `P7-A-IPC-001` | undeclared channel, stale frame, non-main frame, wrong sender, and request after disposal |
| `P7-A-IPC-002` | unknown keys, prototype-bearing input, unexpected arguments, and oversized payload |
| `P7-A-CREDENTIAL-001` | provider list/read redaction, Chromium no-store, and Renderer-cache absence |
| `P7-A-CREDENTIAL-002` | sentinel write-back, cross-provider substitution, missing stored key, and anonymous fetch fallback |
| `P7-A-CREDENTIAL-003` | Renderer, log, persistence, Worker-environment, and diagnostic leakage |
| `P7-A-WORKSPACE-001` | traversal, absolute path, NUL, symlink escape, and workspace-external read/write |
| `P7-A-WORKSPACE-002` | replaced `.git` pointer, wrong canonical root, subdirectory, linked worktree, and revoked grant |
| `P7-A-WORKSPACE-003` | hooks, filters, includes, fsmonitor, dirty tree, and HEAD drift |
| `P7-A-DELIVERY-001` | source write before apply approval, conflicting patch, digest drift, and multi-file atomic denial |
| `P7-A-DELIVERY-002` | concurrent apply, already-applied retry, lost response, repository lock, and idempotent recovery |
| `P7-A-TOOL-001` | unknown tool, missing manifest, no policy, conflicting policy, malformed input, and widened manifest |
| `P7-A-TOOL-002` | invalid credential reference, stale authorization, executor mismatch, and ambiguous post-effect retry |
| `P7-A-APPROVAL-001` | deny, expire, cancel, reuse, wrong operation, wrong attempt, and stale snapshot |
| `P7-A-APPROVAL-002` | protected/workflow-feedback/publish/workspace-apply approval substitution |
| `P7-A-MCP-001` | wrong lease/token, Host, Origin, User-Agent, method, content type, model, and initialization order |
| `P7-A-MCP-002` | malformed JSON/SSE, oversized body/frame/tree, duplicate identity, request after close, and in-flight close |
| `P7-A-MCP-003` | undeclared tool, ambiguous alias, invalid tool count, and unmodeled provider field |
| `P7-A-WORKER-001` | unadmitted executable/digest, widened capabilities, and inherited environment secret |
| `P7-A-NETWORK-001` | Renderer external network, Worker external network, and undeclared loopback destination |
| `P7-A-PROCESS-001` | unexpected child, output overflow, timeout, crash, cancellation, and normal/failing leader exit |
| `P7-A-PROCESS-002` | parent death, close race, cleanup retry, and residual process/private-root/worktree scan |
| `P7-A-PERSISTENCE-001` | stale CAS, conflicting duplicate, cross-owner/cross-attempt record, sequence regression, and replay |
| `P7-A-PERSISTENCE-002` | unknown keys, truncated protocol/database, digest tamper, invalid SQLite, and closed port |
| `P7-A-REDACTION-001` | credential, path, prompt, completion, tool argument, content reference, patch, and environment text |
| `P7-A-REDACTION-002` | rejected model/tool/Worker result falsely projected completed or unchanged |
| `P7-A-ARTIFACT-001` | self-authorizing manifest, wrong digest/architecture, symlink, unexpected file, feature widening, unsafe dependency, missing license/SBOM/audit, and packaged source-copy drift |

### Task 1: Establish the repository threat model and accepted authority

**Files:**

- Create: `docs/security/THREAT_MODEL.md`
- Create: `docs/security/P7_ABUSE_CASES.md`
- Create: `docs/architecture/decisions/0027-p7-threat-model-and-abuse-authority.md`
- Modify: `docs/README.md`
- Modify: `docs/architecture/decisions/README.md`

- [ ] **Step 1: Write the repository-scoped threat model against the current product source**

Use the structure `Overview`, `Threat Model, Trust Boundaries, and Assumptions`,
`Attack Surface, Mitigations, and Attacker Stories`, and `Severity Calibration`.
Name the concrete current controls: `desktopIpc`, `product-boundary-rules`,
`ToolGateway`, approval records, workspace grants, repository locks, Goose MCP
and model loopback leases, sandboxed Worker composition, SQLite validation,
artifact trust roots, and downstream source-copy checks. End with:

```text
Repository: github.com/Ablankpaper/actestra-desktop
Version: 17acae034d723e45a46dcef264844ed5a27c3da2
```

This initial footer binds the P6 baseline. Task 10 rewrites it to the final
reviewed P7.1 product/test parent without changing the body unless the attacks
discover a new repository-wide boundary.

- [ ] **Step 2: Write the abuse ledger with no pass claims**

Create one row for every catalog ID above with columns `ID`, `Invariant`,
`Risk`, `Layer`, `Expected boundary`, `Forbidden effects`, `macOS`, and
`Windows/Linux P8 obligation`. Set the current disposition to
`evidence-incomplete`; do not pre-mark any row `denied-safe`.

- [ ] **Step 3: Record ADR-0027**

Accept these decisions: stable invariant and attack IDs; Main/Core remains the
authority; the machine catalog is metadata-only; `denied-safe` is the only pass;
macOS-required attacks cannot be unsupported; critical/high findings block;
Windows/Linux enforcement remains a separately recorded P8 obligation; and
security fixtures cannot authorize production bytes.

- [ ] **Step 4: Link the documents from the canonical indexes**

Add `Security Threat Model`, `P7 Abuse-Case Ledger`, and ADR `0027` to the
existing tables without changing unrelated historical evidence.

- [ ] **Step 5: Run documentation checks**

Run:

```bash
npx --yes markdownlint-cli2@0.20.0 "docs/**/*.md" "*.md"
node scripts/check-doc-links.mjs
git diff --check
```

Expected: 0 Markdown errors, all relative links resolve, and no whitespace
errors.

- [ ] **Step 6: Commit the documentation authority**

```bash
git add docs/security docs/architecture/decisions/0027-p7-threat-model-and-abuse-authority.md docs/architecture/decisions/README.md docs/README.md
git commit -m "docs: establish P7 security authority"
```

### Task 2: Add the machine catalog and aggregate gate

**Files:**

- Create: `tests/security/abuseCaseCatalog.ts`
- Create: `tests/security/abuseCaseCatalog.test.ts`
- Create: `scripts/run-p7-abuse-cases.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing catalog-contract test**

Define this exact public shape in the test before the module exists:

```ts
type AbuseCase = Readonly<{
  id: `P7-A-${string}-${string}`;
  invariantId: `P7-I-${string}-${string}`;
  risk: "critical" | "high" | "medium" | "low";
  minimumLayer: 1 | 2 | 3 | 4;
  testFile: string;
  testName: string;
  expectedBoundary: string;
  expectedIncidentCode: string | null;
  forbiddenEffects: readonly string[];
  evidenceFields: readonly string[];
  supportedPlatforms: readonly ("darwin" | "win32" | "linux")[];
  p8Obligation: string | null;
}>;
```

Assert exactly 28 unique cases, the 14 invariant IDs from the design, closed
enum values, relative contained `tests/` paths, nonempty forbidden effects,
macOS coverage for every required case, and a nonempty P8 obligation whenever
Windows or Linux is absent. Do not read the test files in this first contract:
those files are created by Tasks 3–6. The later aggregate binding check is the
gate that requires every `testFile` to exist and its `testName` to contain the
exact case ID.

- [ ] **Step 2: Run the contract test and confirm RED**

```bash
bunx vitest run tests/security/abuseCaseCatalog.test.ts
```

Expected: FAIL because `abuseCaseCatalog.ts` and its 28 bindings do not exist.

- [ ] **Step 3: Implement the closed catalog**

Export frozen `P7_SECURITY_INVARIANTS`, `P7_ABUSE_OUTCOMES`, and
`P7_ABUSE_CASES`. Use only identifiers, classifications, relative test paths,
closed incident codes, booleans, and generic forbidden-effect labels such as
`workspace-write`, `executor-call`, `credential-projection`, `child-process`,
and `terminal-completed`. Do not store prompts, provider URLs, arguments,
content references, patches, environment values, or absolute paths.

- [ ] **Step 4: Add the aggregate runner**

`run-p7-abuse-cases.mjs` must first run the catalog contract, then run the four
security test files. Spawn Bun with inherited stdio, preserve the first nonzero
exit, and reject `P7_SECURITY_TEST_FILES` overrides containing absolute paths,
traversal, NUL, or files outside `tests/security/`.

```js
const commands = [
  ["bunx", "vitest", "run", "tests/security/abuseCaseCatalog.test.ts"],
  ["bunx", "vitest", "run", "tests/security"],
];
```

- [ ] **Step 5: Register project commands**

Add:

```json
"test:security": "node scripts/run-p7-abuse-cases.mjs",
"smoke:p7-security": "node scripts/smoke-p7-security.mjs"
```

Insert `bun run test:security` after the normal Vitest suite in `check`; do not
remove or weaken any existing gate.

- [ ] **Step 6: Confirm the metadata catalog is GREEN before attack bindings exist**

Run the catalog test alone. Expected: PASS for the metadata-only contract. Do
not run the aggregate security command until Tasks 3–6 have created the four
attack files; the aggregate binding gate must remain nonzero while any bound
test is missing and must never translate that state into `denied-safe`.

- [ ] **Step 7: Commit the catalog framework**

```bash
git add package.json scripts/run-p7-abuse-cases.mjs tests/security/abuseCaseCatalog.ts tests/security/abuseCaseCatalog.test.ts
git commit -m "test: add P7 abuse-case catalog"
```

### Task 3: Bind Renderer, IPC, and credential attacks

**Files:**

- Create: `tests/security/rendererIpcCredentialAbuse.test.ts`
- Modify: `tests/security/abuseCaseCatalog.ts`
- Modify only on demonstrated RED: `scripts/product-boundary-rules.mjs`,
  `scripts/check-product-boundary.mjs`, `apps/desktop/src/main/security.ts`,
  `apps/desktop/src/main/ipc/desktopIpc.ts`, or downstream patch `0016`

- [ ] **Step 1: Add six ID-bound attacks**

Use temporary source files with every forbidden Renderer import/client variant;
real `registerDesktopIpc` handlers with a replaced main frame and prototype-
bearing inputs; `installSessionSecurity` fakes that assert all packaged external
requests are cancelled; and the materialized provider credential tests from
patch `0016`. Each case records spy counts before and after rejection and
asserts no Main provider request, cacheable response, credential write,
Renderer secret, persistence secret, or environment secret.

- [ ] **Step 2: Run only this file and classify RED accurately**

```bash
bunx vitest run tests/security/rendererIpcCredentialAbuse.test.ts
```

Expected: every already-enforced variant passes. Any variant that reaches an
effect is `security-boundary-violated`; missing observable evidence is
`evidence-incomplete`, not a product vulnerability.

- [ ] **Step 3: Repair only faithful critical/high failures**

For a static gap, add the narrow syntax detector to
`rendererPrivilegePatterns` or `preloadPrivilegePatterns`. For IPC, keep the
trusted-current-main-frame check ahead of parsing/effects and add a bounded
payload validator. For credentials, keep redaction in Main before IPC and keep
sentinel stripping before mutation. Do not add Renderer authority or edit
`foundation/`.

- [ ] **Step 4: Prove GREEN and adjacent compatibility**

```bash
bunx vitest run tests/security/rendererIpcCredentialAbuse.test.ts tests/main/desktopIpc.test.ts tests/preload/bridge.test.ts tests/scripts/productBoundaryRules.test.mjs
bun run downstream:aionui:check
```

Expected: all selected attacks are `denied-safe`; the downstream credential
tests and overlay contract pass.

- [ ] **Step 5: Commit this boundary**

```bash
git add tests/security/rendererIpcCredentialAbuse.test.ts tests/security/abuseCaseCatalog.ts scripts apps/desktop/src/main downstream/aionui-v2.1.41
git commit -m "test: lock renderer IPC and credential abuse cases"
```

Before committing, use `git diff --cached --name-only` to unstage every file
not required by this task.

### Task 4: Bind workspace, delivery, Tool Gateway, and approval attacks

**Files:**

- Create: `tests/security/workspaceToolApprovalAbuse.test.ts`
- Modify: `tests/security/abuseCaseCatalog.ts`
- Modify only on faithful RED: the owning files under
  `apps/desktop/src/core/`, `apps/desktop/src/main/privileged/`, and
  `apps/desktop/src/main/workers/`

- [ ] **Step 1: Add nine ID-bound attacks using real Git repositories**

Create temporary repositories outside the checkout. Use real grants, real
linked worktrees, `ToolGateway`, approval service, repository lock, and
`applyArtifactToWorkspace`. Cover the exact variants assigned to
`WORKSPACE-001..003`, `DELIVERY-001..002`, `TOOL-001..002`, and
`APPROVAL-001..002`. Snapshot original HEAD, tracked bytes, untracked set,
artifact record count, audit count, executor count, approval count, and lock
state before each request.

- [ ] **Step 2: Assert denial plus the forbidden-effect set**

After every rejected variant assert: HEAD unchanged; protected file bytes
unchanged; no unexpected untracked file; no executor call; no duplicate audit,
approval, or Artifact; no retained authorization; no lock/worktree residue.
For ambiguous post-effect retry, assert the result remains uncertain/recoverable
and never executes a second effect.

- [ ] **Step 3: Run and classify the focused attacks**

```bash
bunx vitest run tests/security/workspaceToolApprovalAbuse.test.ts
```

Expected: already-safe paths pass. A write, approval substitution, second
effect, or scope escape is critical/high and must be repaired before continuing.

- [ ] **Step 4: Apply the minimum owning-boundary repair when RED proves one**

Preserve the existing flow: isolated worktree -> patch Artifact -> distinct
persisted approval -> canonical root/HEAD/clean/dry-run revalidation -> Main
apply. Preserve Tool Gateway order: manifest -> policy -> approval/lease ->
audit -> executor -> completion audit. Add no direct workflow or Renderer
shortcut.

- [ ] **Step 5: Prove focused and adjacent GREEN**

```bash
bunx vitest run tests/security/workspaceToolApprovalAbuse.test.ts tests/main/artifactWorkspaceApplicator.test.ts tests/main/workspaceRepositoryLock.test.ts tests/main/isolatedCodingTools.test.ts tests/core/privilegedServices.test.ts
```

Expected: all attacks deny safely and existing successful approved operations
still execute exactly once.

- [ ] **Step 6: Commit this boundary**

```bash
git add tests/security/workspaceToolApprovalAbuse.test.ts tests/security/abuseCaseCatalog.ts apps/desktop/src/core apps/desktop/src/main/privileged apps/desktop/src/main/workers
git commit -m "test: lock workspace tool and approval abuse cases"
```

### Task 5: Bind MCP, Worker, network, and process attacks

**Files:**

- Create: `tests/security/mcpWorkerProcessAbuse.test.ts`
- Modify: `tests/security/abuseCaseCatalog.ts`
- Modify only on faithful RED: Goose loopback/MCP/session/supervisor files and
  their current platform helpers

- [ ] **Step 1: Start real local hostile transports**

Use `startGooseLoopbackModelServer` and `startGooseMcpCapabilityServer` on
random loopback ports. Send raw HTTP bytes for wrong headers, method/content
type, malformed JSON, oversized frames, duplicate call identity, requests after
close, undeclared tools, aliases, and tool-count violations. Count model and
tool invocations before and after each request.

- [ ] **Step 2: Run real supervised Worker/process attacks**

Use the existing admitted local fixtures and macOS sandbox. Attempt inherited
secret reads, host-data reads, external network, unexpected child creation,
output overflow, timeout, crash, cancellation, successful/failing leader exit,
parent death, and close/open races. Record PIDs and private roots only inside
the test process; final evidence retains counts and classifications, not paths
or environment values.

- [ ] **Step 3: Assert complete cleanup**

On every terminal path, poll with a bounded deadline and require recorded PIDs
to return `ESRCH`, listeners to reject after close, leases/grants to be absent,
and attempt-private roots/worktrees to be removed. A primary denial with residue
must classify `cleanup-incomplete` and fail.

- [ ] **Step 4: Run and classify the focused attacks**

```bash
bunx vitest run tests/security/mcpWorkerProcessAbuse.test.ts
```

Expected: local hostile peers receive bounded rejection; Main model/tool spies
remain untouched when admission fails; no child or private root remains.

- [ ] **Step 5: Repair only the owning boundary if required**

Keep authentication and shape validation before invocation, preserve bounded
JSON/SSE handling, abort and await in-flight requests before listener release,
and terminate the complete process group before releasing grants/worktrees.
Do not add provider credentials to Worker environments or broaden network
profiles.

- [ ] **Step 6: Prove adjacent lifecycle GREEN**

```bash
bunx vitest run tests/security/mcpWorkerProcessAbuse.test.ts tests/main/gooseLoopbackModelServer.test.ts tests/main/gooseMcpCapabilityServer.test.ts tests/main/gooseMcpSessionComposition.test.ts tests/main/gooseRunnerLifecycle.test.ts tests/main/supervisedLocalAgentProvider.test.ts tests/main/agentAdapterSupervisor.test.ts
```

- [ ] **Step 7: Commit this boundary**

```bash
git add tests/security/mcpWorkerProcessAbuse.test.ts tests/security/abuseCaseCatalog.ts apps/desktop/src/main/workers apps/desktop/src/main/orchestration
git commit -m "test: lock MCP worker and process abuse cases"
```

### Task 6: Bind persistence, redaction, artifact, and package attacks

**Files:**

- Create: `tests/security/persistenceArtifactRedactionAbuse.test.ts`
- Modify: `tests/security/abuseCaseCatalog.ts`
- Modify only on faithful RED: persistence validators, incident projection,
  artifact admission, package verification, or downstream checker files

- [ ] **Step 1: Add five ID-bound attack groups**

Open real temporary SQLite databases through the production persistence class;
submit stale CAS, conflicting duplicate, cross-owner/attempt, sequence
regression, unknown-key, truncated protocol, invalid database, and digest-tamper
inputs. Exercise rejected model/tool/Worker outcomes through the real incident
mapper and projection. Copy admitted artifact/package fixtures and mutate one
digest, architecture, symlink, unexpected file, feature, dependency evidence,
license/SBOM/audit file, and source-copy byte per subcase.

- [ ] **Step 2: Use high-entropy canaries only inside the test**

Generate credential, path, prompt, completion, tool-argument, content-reference,
patch, and environment canaries. Serialize every resulting event, audit,
incident, projection, persisted row, runner output, and diagnostic value and
assert none of the canaries occur. Never print a canary on failure; report only
its category.

- [ ] **Step 3: Prove rejected work cannot become completed**

Drive model refusal, malformed request, tool rejection, Worker crash, and
persistence rejection through composition. Assert Task/Session/Team terminal
state and incident code remain failed/blocked as specified and never become
`completed`, `unchanged`, or a successful Artifact.

- [ ] **Step 4: Run and classify**

```bash
bunx vitest run tests/security/persistenceArtifactRedactionAbuse.test.ts
```

Expected: database state remains at its prior accepted revision after every
rejection; no secret canary survives; artifact/package substitutions fail
before admission.

- [ ] **Step 5: Repair only faithful critical/high failures**

Keep all parsing exact-key and fail-closed. Preserve metadata-only evidence,
external artifact trust roots, and source-copy hashing. Do not suppress a
finding by deleting evidence or weakening a validator.

- [ ] **Step 6: Prove adjacent suites GREEN**

```bash
bunx vitest run tests/security/persistenceArtifactRedactionAbuse.test.ts tests/utility/sqliteCorePersistence.test.ts tests/utility/sqliteMigrations.test.ts tests/shared/persistenceUtilityProtocol.test.ts tests/main/generalWorkerProcessAdapter.test.ts tests/main/teamOrchestratorService.test.ts tests/main/gooseRunnerArtifact.test.ts tests/scripts/aionuiDownstreamPathSafety.test.mjs
bun run foundation:aionui:check
bun run downstream:aionui:check
```

- [ ] **Step 7: Commit this boundary**

```bash
git add tests/security/persistenceArtifactRedactionAbuse.test.ts tests/security/abuseCaseCatalog.ts apps/desktop/src scripts downstream docs/governance THIRD_PARTY_NOTICES.md
git commit -m "test: lock persistence redaction and artifact abuse cases"
```

Stage only files actually required by a demonstrated repair; do not modify
license/notices when no imported artifact or dependency changed.

### Task 7: Close the complete layer-1 through layer-3 abuse gate

**Files:**

- Modify: `scripts/run-p7-abuse-cases.mjs`
- Modify: `tests/security/abuseCaseCatalog.test.ts`
- Modify: `docs/security/P7_ABUSE_CASES.md`

- [ ] **Step 1: Run the complete attack gate**

```bash
bun run test:security
```

Expected: all 28 catalog IDs execute; every macOS-required case is
`denied-safe`; no `unsupported-platform`, skipped, flaky retry, or invalid
fixture is counted as pass.

- [ ] **Step 2: Add aggregate output validation**

The runner must first verify that each catalog `testFile` exists and that its
`testName` contains the exact case ID, then print only ID, invariant, risk,
layer, outcome, and bounded counts. Its success summary must equal the catalog
count. Reject duplicate, missing, unknown, skipped, unsupported-macOS, or
non-denied outcomes.

- [ ] **Step 3: Run a deliberate harness-failure proof**

Point `P7_SECURITY_TEST_FILES` at a traversing path and then at a missing
contained fixture. Expected: nonzero `test-harness-invalid`; no product
vulnerability or pass is reported. Remove the override and rerun the normal
gate GREEN.

- [ ] **Step 4: Update only verified ledger rows**

Set each layer-1 through layer-3 row to `denied-safe` with its exact test file
and command. Leave layer-4 rows `evidence-incomplete` until Task 9.

- [ ] **Step 5: Commit the aggregate gate**

```bash
git add scripts/run-p7-abuse-cases.mjs tests/security docs/security/P7_ABUSE_CASES.md
git commit -m "test: close P7 local abuse gate"
```

### Task 8: Add a fail-closed packaged security harness

**Files:**

- Create: `scripts/smoke-p7-security.mjs`
- Create: `tests/scripts/p7SecurityHarness.test.mjs`
- Modify: `package.json`
- Modify only if final-bundle reachability requires it: a new Actestra-owned
  downstream patch registered in `downstream/aionui-v2.1.41/overlay.json`

- [ ] **Step 1: Write harness contract tests before the harness**

Use fake `.app` executables to prove: missing app, early exit, timeout,
malformed marker, duplicate/unknown attack ID, unsupported required macOS case,
non-denied outcome, output overflow, missing durable evidence, retained
protected-file mutation, and residual descendant all exit nonzero. Prove a
complete 28-case redacted fixture exits zero.

- [ ] **Step 2: Run the harness tests and confirm RED**

```bash
bunx vitest run tests/scripts/p7SecurityHarness.test.mjs
```

Expected: FAIL because `smoke-p7-security.mjs` is absent.

- [ ] **Step 3: Implement strict isolated launch**

Resolve the verified app exactly as the existing General Work smoke does.
Create one root containing `user-data`, `home`, `temp`, hostile fixture state,
and protected sentinel files. Launch only with `ACTESTRA_E2E_TEST=1` and all
three isolated paths. Bound output and total runtime. Never inherit a test
credential or expose the user's home/workspace.

- [ ] **Step 4: Exercise final-bundle boundaries**

Use a local hostile peer and the final packaged bundle to prove at least:
Renderer network denial; exact exposed bridge surface; provider response
redaction/no-store; wrong loopback/MCP authentication and shape rejection;
original-workspace write denial before apply approval; Worker external network
and host-read denial; cancellation/crash cleanup; durable failed rather than
completed projection; artifact/package trust markers. Any E2E hook must be
Main-owned, enabled only when all isolation-root checks pass, accept a closed
scenario enum, return metadata-only results, and remain unreachable from normal
Renderer intents.

- [ ] **Step 5: Verify protected state and residue after quit**

Compare sentinel hashes, Git HEAD/status, SQLite rows, approval/grant counts,
and catalog outcomes. Scan the complete recorded process tree and the isolation
root for Actestra, AionCore, General Worker, Goose, planner, hostile fixture,
or descendants. A residue is `cleanup-incomplete`, not success.

- [ ] **Step 6: Prove harness GREEN with its unit suite**

```bash
bunx vitest run tests/scripts/p7SecurityHarness.test.mjs
```

Expected: all fake failure modes fail closed and only the complete safe fixture
passes.

- [ ] **Step 7: Commit the packaged harness**

```bash
git add scripts/smoke-p7-security.mjs tests/scripts/p7SecurityHarness.test.mjs package.json downstream/aionui-v2.1.41
git commit -m "test: add packaged P7 security acceptance"
```

### Task 9: Build and run packaged macOS acceptance

**Files:**

- Modify: `docs/security/P7_ABUSE_CASES.md`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Run the root final-byte gate before packaging**

```bash
NODE_OPTIONS=--max-old-space-size=4096 bun run check
```

Expected: EXIT 0 with format, zero-warning lint, strict typecheck, Electron
SQLite, normal tests, the 28-case security gate, smoke harness, boundary,
frozen foundation, downstream overlay, and package all GREEN.

- [ ] **Step 2: Build the development app outside Desktop**

```bash
bun run dist:dir
```

Expected: EXIT 0; complete `Actestra.app`; `codesign --verify --deep --strict`
EXIT 0; `Signature=adhoc`; verified output symlinked at the materialized
`out/mac-arm64` location.

- [ ] **Step 3: Preserve the existing product smoke**

```bash
bun run smoke:aionui-general-work
```

Expected: EXIT 0 against the exact app from Step 2. This is regression evidence,
not the P7 security acceptance.

- [ ] **Step 4: Run packaged P7 security acceptance**

```bash
bun run smoke:p7-security
```

Expected: EXIT 0; every required layer-4 macOS case is `denied-safe`; protected
files and Git state are unchanged; durable rejected operations are not
completed; no credentials or private values appear; final process scan empty.

- [ ] **Step 5: Add CI gates**

Run `bun run test:security` explicitly after the normal source test and run
`bun run smoke:p7-security` after `verify:package` and the existing packaged
General Work smoke. Keep exact action SHAs and the existing 4 GiB Node heap.

- [ ] **Step 6: Record packaged evidence and commit**

Update layer-4 ledger rows with exact command, architecture, app identity,
signature class, schema version, counts, and outcomes. Do not record profile
paths, PIDs, prompt text, fixture secrets, or raw arguments.

```bash
git add .github/workflows/ci.yml docs/security/P7_ABUSE_CASES.md
git commit -m "ci: require P7 security acceptance"
```

### Task 10: Bind final revision and update source-of-truth documents

**Files:**

- Modify: `docs/security/THREAT_MODEL.md`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`
- Modify: `docs/product/MVP.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Freeze the reviewed product/test parent**

Record `git rev-parse HEAD` after Task 9. Confirm the next commit changes only
the five documentation/evidence files in this task. That parent is the
`Version` written into the threat model footer.

- [ ] **Step 2: Reconcile threat-model body with actual findings**

Add any newly demonstrated repository-wide trust boundary or mitigation. Do
not include diff-specific vulnerability prose in the threat model. Set the
footer to:

```text
Repository: github.com/Ablankpaper/actestra-desktop
Version: <exact Task 9 parent SHA>
```

- [ ] **Step 3: Record verified completion and explicit non-claims**

State exact focused, aggregate, root, package, smoke, residue, and app-signature
results. State that P7.2 resource enforcement, P7.3 backup/recovery, P7.4
diagnostic/audit hardening, P8 Windows/Linux, formal signing, candidate,
release, deployment, and final user acceptance remain open.

- [ ] **Step 4: Run final documentation and scope checks**

```bash
npx --yes markdownlint-cli2@0.20.0 "docs/**/*.md" "*.md"
node scripts/check-doc-links.mjs
git diff --check
test -z "$(git diff --name-only origin/main...HEAD -- foundation/)"
```

Expected: all GREEN and `foundation/` unchanged.

- [ ] **Step 5: Commit the revision-bound evidence**

```bash
git add docs/security/THREAT_MODEL.md docs/architecture/SYSTEM_OVERVIEW.md docs/product/MVP.md docs/roadmap/DEVELOPMENT_SEQUENCE.md docs/PROJECT_STATUS.md
git commit -m "docs: record P7.1 security baseline evidence"
```

Verify `git diff-tree --name-only HEAD` contains documentation only and the
threat-model `Version` equals `HEAD^`.

### Task 11: Deliver P7.1 through review and CI

**Files:**

- No source edit unless exact-head CI exposes a reproducible defect

- [ ] **Step 1: Run the final local gate on committed bytes**

```bash
NODE_OPTIONS=--max-old-space-size=4096 bun run check
bun run dist:dir
bun run smoke:aionui-general-work
bun run smoke:p7-security
git diff --check
git status -sb
```

Expected: all commands EXIT 0, worktree clean, and no residual processes.

- [ ] **Step 2: Push the exact branch and open a PR**

Push `codex/p7-threat-model-abuse-baseline`. The PR must separate local,
packaged, exact-head CI, release, and acceptance states; list every finding and
disposition; state no foundation or upstream revision change; and state P7.2-
P7.4/P8 remain open.

- [ ] **Step 3: Wait for exact-head CI and review disposition**

Require both `Goose runner admission` and `macOS arm64 foundation` GREEN on the
exact PR head. Treat a review bot success as advisory, not owner review. Repair
only reproducible failures, rerun the changed boundary, and update the final
evidence commit if product/test bytes change.

- [ ] **Step 4: Merge and verify merged-main CI**

Merge only with no unresolved critical/high finding and all required checks
GREEN. Record the merge SHA and one GREEN merged-main CI run in a separate
documentation-only PR if the evidence cannot exist before merge.

- [ ] **Step 5: Declare only P7.1 complete**

Report exact-head and merged-main evidence separately. Do not call all P7 or P8
complete. Start P7.2 with a new written design and implementation plan based on
the accepted P7.1 threat model.
