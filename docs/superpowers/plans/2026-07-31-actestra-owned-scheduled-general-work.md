# Actestra-Owned Scheduled General Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` and `superpowers:test-driven-development` to implement this plan task-by-task. The owner has explicitly selected inline execution; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve AionUI v2.1.41's native Scheduled Tasks experience while making Actestra Core the sole authority for one bounded existing-conversation `/actestra` schedule journey.

**Architecture:** A strict schedule contract validates native cron DTOs and maps them to schema-13 Actestra records. A persistence-utility extension atomically owns schedule Workspaces, grants, jobs, run claims, terminal state, and recovery. Electron main owns calculation, timers, execution, and native-event projection; a fixed preload/HTTP compatibility channel retains `ipcBridge.cron` without giving the renderer timing, filesystem, Worker, credential, model, or policy authority.

**Tech Stack:** TypeScript 5.9, Electron 37, React 19, Node SQLite, Vitest, `croner@9.1.0`, AionUI v2.1.41 downstream overlays, Bun 1.3.9.

---

## Locked boundaries and file map

- Create `apps/desktop/src/compatibility/aionui/scheduledGeneralWork.ts` for strict schedule records, native request/result shapes, assertions, identity derivation, projection privacy, and schedule calculation.
- Create `apps/desktop/src/compatibility/aionui/scheduleBridge.ts` for the fixed request and event bridge contract.
- Create `apps/desktop/src/main/compatibility/aionuiScheduleService.ts` for main-owned timers, recovery, claims, and General Work invocation.
- Create `apps/desktop/src/main/compatibility/aionuiScheduleBridgeService.ts` for exact method/path routing and native DTO mapping.
- Extend `apps/desktop/src/core/productPersistence.ts`, `apps/desktop/src/shared/persistenceUtilityProtocol.ts`, `apps/desktop/src/main/persistence/persistenceUtilityClient.ts`, `apps/desktop/src/utility/persistence/persistenceUtilityService.ts`, and `apps/desktop/src/utility/persistence/sqliteCorePersistence.ts` with closed schedule operations.
- Extend `apps/desktop/src/utility/persistence/sqliteMigrations.ts` with forward-only schema 13.
- Add `downstream/aionui-v2.1.41/patches/0011-actestra-scheduled-general-work.mjs`; do not edit `foundation/` and do not expand patch 0010.
- Update `downstream/aionui-v2.1.41/overlay.json` to copy the new source files and apply patch 0011.
- Update `package.json`, `bun.lock`, and `THIRD_PARTY_NOTICES.md` for exact `croner@9.1.0` ownership.
- Extend `scripts/check-aionui-downstream.mjs`, `scripts/smoke-aionui-general-work.mjs`, and focused tests with schedule evidence.
- Update `docs/PROJECT_STATUS.md`, `docs/product/P4_GENERAL_WORK.md`, `docs/roadmap/DEVELOPMENT_SEQUENCE.md`, `docs/architecture/SYSTEM_OVERVIEW.md`, and the overlay README only after the corresponding evidence exists.

### Contract names used throughout

```ts
type AionUiScheduleKind = "at" | "every" | "cron";
type AionUiScheduleLastStatus = "ok" | "error" | "skipped" | "missed";

interface AionUiScheduleJob {
  readonly contractVersion: 1;
  readonly id: string;
  readonly conversationHash: string;
  readonly nativeConversationId: string;
  readonly nativeConversationTitle?: string;
  readonly workspaceId: WorkspaceId;
  readonly workspaceGrantId: WorkspaceGrantId;
  readonly name: string;
  readonly description?: string;
  readonly prompt: string;
  readonly schedule: AionUiSchedule;
  readonly enabled: boolean;
  readonly nextRunAtMs?: number;
  readonly lastRunAtMs?: number;
  readonly lastStatus?: AionUiScheduleLastStatus;
  readonly lastIncidentCode?: string;
  readonly activeClaim?: string;
  readonly activeClaimedAtMs?: number;
  readonly runSequence: number;
  readonly runCount: number;
  readonly retryCount: 0;
  readonly maxRetries: 0;
  readonly queueEnabled: false;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly deletedAtMs?: number;
}
```

The raw native conversation identifier, prompt, canonical root, grant identifier, active claim, and run sequence are persistence workload state. `toNativeCronJob()` returns the native conversation target and prompt only to the owning cron surface and excludes root, grant, claim, Worker, content-reference, credential, model, provider, CLI, and tool fields.

## Task 1: Strict schedule contract and next-run calculation

**Files:**

- Create: `apps/desktop/src/compatibility/aionui/scheduledGeneralWork.ts`
- Modify: `apps/desktop/src/compatibility/aionui/index.ts`
- Create: `tests/compatibility/aionuiScheduledGeneralWork.test.ts`

- [ ] **Step 1: Write failing validation and calculation tests**

```ts
it("accepts only an existing-conversation prompt-artifact schedule", () => {
  const input = createAionUiScheduleCreateInput();
  expect(() => assertAionUiScheduleCreateInput(input, NOW_MS)).not.toThrow();
  for (const rejected of [
    { ...input, created_by: "agent" },
    { ...input, execution_mode: "new_conversation" },
    { ...input, message: "/actestra file private.txt" },
    { ...input, queue_enabled: true },
    { ...input, agent_config: { name: "renderer-agent", workspace: "/tmp/private" } },
  ]) {
    expect(() => assertAionUiScheduleCreateInput(rejected, NOW_MS)).toThrow(
      AionUiScheduledGeneralWorkError,
    );
  }
});

it("calculates strictly-future every and cron occurrences", () => {
  expect(
    calculateAionUiScheduleNextRun({ kind: "every", everyMs: 60_000, description: "minute" }, 1000),
  ).toBe(61_000);
  expect(
    calculateAionUiScheduleNextRun(
      { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai", description: "daily" },
      Date.parse("2026-07-31T01:00:00.000Z"),
    ),
  ).toBe(Date.parse("2026-08-01T01:00:00.000Z"));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bunx vitest run tests/compatibility/aionuiScheduledGeneralWork.test.ts`

Expected: FAIL because `scheduledGeneralWork.ts` and its exported assertions do not exist.

- [ ] **Step 3: Implement the closed contract**

Implement exact-key assertions with these limits: name 256 UTF-8 bytes, description 2 KiB, schedule description 512 bytes, cron expression 256 bytes, time zone and incident 128 bytes, prompt 16 KiB, native conversation ID 256 characters, `every` 60,000–31,536,000,000 ms, and `at` strictly future but no more than ten years. Reject C0/C1 controls, non-safe integers, unknown keys, more than five cron fields, invalid IANA zones, nonzero retries, queueing, agent/runtime/model/provider/credential/workspace/CLI fields, and every `/actestra` subcommand except plain `prompt-artifact`.

Use the exact calculator:

```ts
import { Cron } from "croner";

export function calculateAionUiScheduleNextRun(
  schedule: AionUiSchedule,
  afterMs: number,
): number | undefined {
  if (schedule.kind === "at") return schedule.atMs > afterMs ? schedule.atMs : undefined;
  if (schedule.kind === "every") {
    return afterMs + schedule.everyMs;
  }
  if (schedule.expr.length === 0) return undefined;
  const next = new Cron(schedule.expr, {
    timezone: schedule.tz,
    paused: true,
  }).nextRun(new Date(afterMs));
  return next?.getTime();
}
```

After the RED run and before adding this import, add `"croner": "9.1.0"` to root production dependencies, run `bun install`, verify the lock resolves exactly 9.1.0, and add its MIT attribution to `THIRD_PARTY_NOTICES.md`. Derive the job ID with SHA-256 over a versioned canonical JSON tuple of conversation hash, name, prompt, and schedule. Make exact duplicates stable and changed-content collisions detectable by persistence.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `bunx vitest run tests/compatibility/aionuiScheduledGeneralWork.test.ts`

Expected: PASS for bounds, unknown fields, subcommand rejection, time zones, manual cron, `at`, `every`, cron, identity, native DTO mapping, and privacy.

- [ ] **Step 5: Commit the contract slice**

```bash
git add apps/desktop/src/compatibility/aionui/scheduledGeneralWork.ts apps/desktop/src/compatibility/aionui/index.ts tests/compatibility/aionuiScheduledGeneralWork.test.ts package.json bun.lock THIRD_PARTY_NOTICES.md
git commit -m "feat: define bounded scheduled general work"
```

## Task 2: Schema-13 atomic schedule persistence

**Files:**

- Modify: `apps/desktop/src/utility/persistence/sqliteMigrations.ts`
- Modify: `apps/desktop/src/core/productPersistence.ts`
- Modify: `apps/desktop/src/utility/persistence/sqliteCorePersistence.ts`
- Create: `tests/fixtures/aionuiSchedule.ts`
- Create: `tests/utility/aionuiSchedulePersistence.test.ts`
- Modify: `tests/utility/sqliteMigrations.test.ts`
- Modify: `tests/utility/sqliteCorePersistence.test.ts`

- [ ] **Step 1: Write schema and transaction tests**

```ts
it("migrates 12 to 13 without changing Office rows", () => {
  migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 12), APPLIED_AT);
  const result = migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS, APPLIED_AT);
  expect(result).toEqual({ fromVersion: 12, toVersion: 13, appliedVersions: [13] });
  expect(
    database.prepare("SELECT name FROM sqlite_schema WHERE name = 'aionui_schedule_jobs'").get(),
  ).toEqual({ name: "aionui_schedule_jobs" });
});

it("atomically stores a job, schedule workspace, and active grant", async () => {
  await expect(store.registerAionUiSchedule(registration)).resolves.toMatchObject({
    status: "stored",
  });
  await expect(store.getAionUiSchedule(registration.job.id)).resolves.toEqual(registration.job);
  await expect(store.getActiveWorkspaceGrant(registration.workspace.id)).resolves.toEqual(
    registration.grant,
  );
});

it("allows only one active claim and persists terminal state", async () => {
  const first = await store.claimAionUiScheduleRun(claimInput);
  expect(first.status).toBe("claimed");
  await expect(
    store.claimAionUiScheduleRun({ ...claimInput, claim: "other" }),
  ).resolves.toMatchObject({ status: "busy" });
  await expect(store.completeAionUiScheduleRun(terminalInput)).resolves.toMatchObject({
    status: "completed",
  });
});
```

- [ ] **Step 2: Run persistence tests and verify RED**

Run: `bunx vitest run tests/utility/sqliteMigrations.test.ts tests/utility/aionuiSchedulePersistence.test.ts tests/utility/sqliteCorePersistence.test.ts`

Expected: FAIL at schema 13 and missing persistence methods.

- [ ] **Step 3: Add schema 13**

Set `CURRENT_CORE_SCHEMA_VERSION = 13` and append one migration creating `aionui_schedule_jobs` with strict checks for contract version, kinds, status, fixed retry/queue fields, claim-pair consistency, monotonic counters, timestamps, and soft deletion. Store schedule JSON, native target, and prompt only in this table; keep canonical root only in `workspace_grants`.

Required indexes:

```sql
CREATE UNIQUE INDEX aionui_schedule_identity_idx
  ON aionui_schedule_jobs(conversation_hash, job_id);
CREATE INDEX aionui_schedule_next_run_idx
  ON aionui_schedule_jobs(enabled, next_run_at_ms)
  WHERE deleted_at_ms IS NULL AND enabled = 1;
CREATE INDEX aionui_schedule_active_claim_idx
  ON aionui_schedule_jobs(active_claim)
  WHERE active_claim IS NOT NULL;
```

- [ ] **Step 4: Add atomic persistence methods**

Extend `ActestraPersistencePort` with `AionUiScheduledGeneralWorkPersistencePort` and implement:

```ts
registerAionUiSchedule(registration): Promise<{ status: "stored" | "duplicate"; job: AionUiScheduleJob }>;
listAionUiSchedules(limit): Promise<readonly AionUiScheduleJob[]>;
getAionUiSchedule(jobId): Promise<AionUiScheduleJob | null>;
updateAionUiSchedule(input): Promise<AionUiScheduleMutationResult>;
deleteAionUiSchedule(input): Promise<AionUiScheduleMutationResult>;
claimAionUiScheduleRun(input): Promise<AionUiScheduleClaimResult>;
completeAionUiScheduleRun(input): Promise<AionUiScheduleMutationResult>;
recoverAionUiScheduleRuns(input): Promise<readonly AionUiScheduleJob[]>;
```

Use `BEGIN IMMEDIATE`; register Workspace, grant, and job in one transaction. Enforce 100 non-deleted rows, duplicate byte equality, collision conflict, immutable owner/grant/fixed agent/retry/queue fields, active-run delete rejection, and compare-and-swap claim/terminal transitions.

- [ ] **Step 5: Run persistence tests and verify GREEN**

Run: `bunx vitest run tests/utility/sqliteMigrations.test.ts tests/utility/aionuiSchedulePersistence.test.ts tests/utility/sqliteCorePersistence.test.ts`

Expected: PASS for fresh schema, 12→13, idempotency, conflict, cap, CRUD, pause, delete, claim, terminalization, interrupted recovery, missed state, and reopen.

- [ ] **Step 6: Commit the persistence slice**

```bash
git add apps/desktop/src/core/productPersistence.ts apps/desktop/src/utility/persistence/sqliteMigrations.ts apps/desktop/src/utility/persistence/sqliteCorePersistence.ts tests/fixtures/aionuiSchedule.ts tests/utility/aionuiSchedulePersistence.test.ts tests/utility/sqliteMigrations.test.ts tests/utility/sqliteCorePersistence.test.ts
git commit -m "feat: persist Actestra schedule authority"
```

## Task 3: Persistence utility protocol and client

**Files:**

- Modify: `apps/desktop/src/shared/persistenceUtilityProtocol.ts`
- Modify: `apps/desktop/src/utility/persistence/persistenceUtilityService.ts`
- Modify: `apps/desktop/src/main/persistence/persistenceUtilityClient.ts`
- Modify: `tests/shared/persistenceUtilityProtocol.test.ts`
- Modify: `tests/utility/persistenceUtilityService.test.ts`
- Modify: `tests/main/persistenceUtilityClient.test.ts`

- [ ] **Step 1: Write failing exact-operation tests**

Add request/response assertions for the eight operation names from Task 2 and reject raw roots, credentials, unknown fields, malformed hashes, missing claim pairs, or response results from another operation.

```ts
expect(() =>
  assertPersistenceUtilityRequest({
    protocolVersion: 1,
    type: "request",
    requestId: "schedule-list-1",
    operation: "list-aionui-schedules",
    payload: { limit: 100 },
  }),
).not.toThrow();
```

- [ ] **Step 2: Run the protocol/client tests and verify RED**

Run: `bunx vitest run tests/shared/persistenceUtilityProtocol.test.ts tests/utility/persistenceUtilityService.test.ts tests/main/persistenceUtilityClient.test.ts`

Expected: FAIL because schedule operations are not in the closed map.

- [ ] **Step 3: Wire the exact operation map, dispatcher, and client**

Add each operation to `PersistenceUtilityOperationMap`, `PERSISTENCE_UTILITY_OPERATIONS`, payload/result validation switches, `PersistenceUtilityService.dispatch`, and `PersistenceUtilityClient`. Preserve the 8 MiB envelope cap and existing error-domain mapping.

- [ ] **Step 4: Run the protocol/client tests and verify GREEN**

Run: `bunx vitest run tests/shared/persistenceUtilityProtocol.test.ts tests/utility/persistenceUtilityService.test.ts tests/main/persistenceUtilityClient.test.ts`

Expected: PASS, including transport exit/error behavior and schedule result validation.

- [ ] **Step 5: Commit the protocol slice**

```bash
git add apps/desktop/src/shared/persistenceUtilityProtocol.ts apps/desktop/src/utility/persistence/persistenceUtilityService.ts apps/desktop/src/main/persistence/persistenceUtilityClient.ts tests/shared/persistenceUtilityProtocol.test.ts tests/utility/persistenceUtilityService.test.ts tests/main/persistenceUtilityClient.test.ts
git commit -m "feat: route schedule state through persistence utility"
```

## Task 4: Trusted scheduled entry into General Work

**Files:**

- Modify: `apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService.ts`
- Modify: `tests/main/aionuiGeneralWorkJourneyService.test.ts`

- [ ] **Step 1: Write a failing trusted-context test**

```ts
it("runs a scheduled prompt from a persisted grant without rereading native context", async () => {
  const nativeResolve = vi.fn(async () => {
    throw new Error("must not be called");
  });
  const service = createJourneyService({ nativeResolve });
  await service.submitFromTrustedContext(intent, {
    rootPath: fs.realpathSync(workspaceRoot),
    displayName: "Persisted schedule workspace",
  });
  expect(nativeResolve).not.toHaveBeenCalled();
  await service.waitForIdle();
  await expect(service.list(intent.nativeConversationId)).resolves.toEqual([
    expect.objectContaining({ status: "completed" }),
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `bunx vitest run tests/main/aionuiGeneralWorkJourneyService.test.ts -t "persisted grant"`

Expected: FAIL because the trusted internal entry does not exist.

- [ ] **Step 3: Refactor one shared submission path**

Add `submitFromTrustedContext(value, nativeContext)` as an internal main-process method. Both public `submit()` and this method must call the same intent assertion, deduplication map, registration, Worker launch, checkpoint, policy, tool, event, Artifact, terminal, and cleanup code. The trusted method must still canonicalize the root, reject filesystem root, and validate display name; it must only skip `config.nativeContext.resolve()`.

- [ ] **Step 4: Run all journey-service tests and verify GREEN**

Run: `bunx vitest run tests/main/aionuiGeneralWorkJourneyService.test.ts`

Expected: PASS for existing renderer submissions, trusted scheduled submissions, denial, cancellation, recovery, file, research, writing, and Office.

- [ ] **Step 5: Commit the trusted-entry slice**

```bash
git add apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService.ts tests/main/aionuiGeneralWorkJourneyService.test.ts
git commit -m "feat: add trusted scheduled journey entry"
```

## Task 5: Main-owned schedule service, timers, claims, and recovery

**Files:**

- Create: `apps/desktop/src/main/compatibility/aionuiScheduleService.ts`
- Create: `tests/main/aionuiScheduleService.test.ts`

- [ ] **Step 1: Write deterministic timer and recovery tests**

Use a fake clock/timer port and a fake journey port. Cover: one timer per future job, no timer for disabled/manual jobs, missed occurrence skipped, stale claim terminalized as `interrupted`, duplicate claim refused, revoked/mismatched grant fails closed, Run Now works for manual cron, `at` disables after terminal state, repeating schedules advance strictly forward, and close clears timers and awaits active runs.

```ts
await service.recover();
expect(timers.pending()).toEqual([{ jobId: job.id, atMs: job.nextRunAtMs }]);
await timers.fire(job.id);
expect(journey.submitFromTrustedContext).toHaveBeenCalledWith(
  expect.objectContaining({ submissionId: `${job.id}:run:1` }),
  { rootPath: grant.rootPath, displayName: grant.displayName },
);
```

- [ ] **Step 2: Run the service test and verify RED**

Run: `bunx vitest run tests/main/aionuiScheduleService.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service**

Expose `recover`, `resume`, `list`, `get`, `create`, `update`, `remove`, `runNow`, `history`, `subscribe`, `waitForIdle`, and `close`. Resolve native context only during create, atomically persist the schedule Workspace/grant/job, and derive later execution context only from the active persisted grant. The service may call only `AionUiGeneralWorkJourneyService.submitFromTrustedContext`; it never starts a Worker or invokes a tool directly.

Use opaque 128-byte-bounded claim IDs, a single `Map<jobId, Timeout>`, and serialized per-job mutations. Emit only `cron.job-created`, `cron.job-updated`, `cron.job-removed`, and `cron.job-executed` with validated native projections.

- [ ] **Step 4: Run the service test and verify GREEN**

Run: `bunx vitest run tests/main/aionuiScheduleService.test.ts`

Expected: PASS for creation, timers, Run Now, terminal outcomes, privacy, missed/interrupted recovery, event names, and cleanup.

- [ ] **Step 5: Commit the service slice**

```bash
git add apps/desktop/src/main/compatibility/aionuiScheduleService.ts tests/main/aionuiScheduleService.test.ts
git commit -m "feat: own scheduled execution in Electron main"
```

## Task 6: Fixed preload request/event bridge and exact HTTP routing

**Files:**

- Create: `apps/desktop/src/compatibility/aionui/scheduleBridge.ts`
- Create: `apps/desktop/src/main/compatibility/aionuiScheduleBridgeService.ts`
- Modify: `apps/desktop/src/compatibility/aionui/index.ts`
- Create: `tests/compatibility/aionuiScheduleBridge.test.ts`
- Create: `tests/main/aionuiScheduleBridgeService.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Accept only:

```text
GET    /api/cron/jobs
GET    /api/cron/jobs?conversation_id=conversation%2Fnative
GET    /api/cron/jobs/:id
POST   /api/cron/jobs
PUT    /api/cron/jobs/:id
DELETE /api/cron/jobs/:id
POST   /api/cron/jobs/:id/run
GET    /api/cron/jobs/:id/conversations
```

Skill GET/POST/DELETE routes must return `schedule-skill-unsupported`. Unknown methods, fragments, duplicate query keys, path traversal, malformed encoding, extra fields, non-main-frame IPC, and provider unavailability must fail closed.

- [ ] **Step 2: Run bridge tests and verify RED**

Run: `bunx vitest run tests/compatibility/aionuiScheduleBridge.test.ts tests/main/aionuiScheduleBridgeService.test.ts`

Expected: FAIL because the contracts/services do not exist.

- [ ] **Step 3: Implement fixed contracts and route dispatch**

Define channels:

```ts
export const ACTESTRA_SCHEDULE_REQUEST_CHANNEL = "actestra:schedule-request-v1";
export const ACTESTRA_SCHEDULE_EVENT_CHANNEL = "actestra:schedule-event-v1";
```

The request envelope contains only `{ contractVersion: 1, method, path, body }`. The event subscription has no renderer-selected name; main sends one validated union and preload fans it out locally. Bridge errors map to bounded native-compatible status/code/message envelopes without roots, prompt bodies, grants, claims, Worker identities, or underlying exceptions.

- [ ] **Step 4: Run bridge tests and verify GREEN**

Run: `bunx vitest run tests/compatibility/aionuiScheduleBridge.test.ts tests/main/aionuiScheduleBridgeService.test.ts`

Expected: PASS for route ownership, unavailability, native DTO compatibility, privacy, and closed events.

- [ ] **Step 5: Commit the bridge slice**

```bash
git add apps/desktop/src/compatibility/aionui/scheduleBridge.ts apps/desktop/src/compatibility/aionui/index.ts apps/desktop/src/main/compatibility/aionuiScheduleBridgeService.ts tests/compatibility/aionuiScheduleBridge.test.ts tests/main/aionuiScheduleBridgeService.test.ts
git commit -m "feat: bridge native schedule routes to Actestra"
```

## Task 7: Native AionUI overlay and usable existing-conversation entry

**Files:**

- Create: `downstream/aionui-v2.1.41/patches/0011-actestra-scheduled-general-work.mjs`
- Modify: `downstream/aionui-v2.1.41/overlay.json`
- Modify: `downstream/aionui-v2.1.41/README.md`
- Modify: `scripts/check-aionui-downstream.mjs`
- Modify: `tests/scripts/aionuiDownstreamPathSafety.test.mjs`

- [ ] **Step 1: Extend downstream contract tests first**

Require patch 0011 to preserve `/scheduled`, `/scheduled/:job_id`, `CreateTaskDialog`, detail/history, status tags, CRUD, pause/resume, Run Now, and four cron events. Require the materialized app to contain the fixed schedule global, exact HTTP interception, no AionCore cron fallback, no system-resume request, existing-conversation dialog wiring, and explicit Skill unsupported handling.

- [ ] **Step 2: Run downstream checks and verify RED**

Run: `bunx vitest run tests/scripts/aionuiDownstreamPathSafety.test.mjs && bun run downstream:aionui:check`

Expected: FAIL because overlay patch 0011 is absent.

- [ ] **Step 3: Implement patch 0011**

Patch only the materialized tree to:

- copy and initialize the schedule service beside the existing General Work service after persistence is ready;
- register main-frame request handling and closed event delivery;
- expose `window.actestraSchedule.request()` and `.subscribe()` in preload;
- intercept exact cron HTTP routes in `httpBridge.ts`, throwing native `BackendHttpError` on structured rejection and never falling back to AionCore;
- attach closed Actestra cron events to the existing `wsEmitter` listener map;
- prevent `/api/cron/internal/system-resume` and call the main-owned resume method;
- make conversation-history **Create Scheduled Task** navigate to `/scheduled` with only the selected conversation ID/title;
- have `ScheduledTasksPage` open the existing `CreateTaskDialog` from that navigation state;
- lock that bound dialog to `existing`, omit renderer agent/model/workspace/runtime configuration, and submit only the accepted fields;
- leave standalone manual creation visible so its unsupported response remains explicit; and
- keep all native routes, components, labels, history, statuses, and error surfaces.

- [ ] **Step 4: Materialize and run focused native tests**

Run: `bun run downstream:aionui:materialize`

Run: `bun run --cwd .actestra/aionui-v2.1.41 test -- tests/unit/actestra/scheduleBridge.test.ts tests/unit/actestra/scheduleHttpBridge.test.ts tests/unit/actestra/scheduleDialog.dom.test.tsx`

Expected: PASS and zero changes under `foundation/aionui-v2.1.41`.

- [ ] **Step 5: Run downstream contract checks and verify GREEN**

Run: `bunx vitest run tests/scripts/aionuiDownstreamPathSafety.test.mjs && bun run downstream:aionui:check && bun run foundation:aionui:check`

Expected: PASS with no unexplained retention loss.

- [ ] **Step 6: Commit the overlay slice**

```bash
git add downstream/aionui-v2.1.41/patches/0011-actestra-scheduled-general-work.mjs downstream/aionui-v2.1.41/overlay.json downstream/aionui-v2.1.41/README.md scripts/check-aionui-downstream.mjs tests/scripts/aionuiDownstreamPathSafety.test.mjs
git commit -m "feat: preserve native scheduled task journey"
```

## Task 8: Reverify the exact dependency pin and third-party attribution

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Reverify the exact production dependency**

Confirm Task 1 added `"croner": "9.1.0"` to root `dependencies`, then run:

Run: `bun install --frozen-lockfile`

Expected: PASS because Task 1 already updated the lock from the exact contract input.

- [ ] **Step 2: Check the lock deterministically**

Run: `git diff origin/main -- package.json bun.lock`

Expected: `package.json` and `bun.lock` resolve exactly `croner@9.1.0`; no unrelated package version changes.

- [ ] **Step 3: Check attribution**

Confirm `THIRD_PARTY_NOTICES.md` records Croner 9.1.0, MIT license, repository URL, exact role, and unchanged-license notice. Do not copy foundation lock metadata as project evidence.

- [ ] **Step 4: Verify pin and install**

Run: `bun install --frozen-lockfile && bun pm ls | rg 'croner@9\.1\.0'`

Expected: PASS with exactly one root-resolved Croner version.

- [ ] **Step 5: Include any review correction in the next implementation commit**

```bash
git add package.json bun.lock THIRD_PARTY_NOTICES.md
```

## Task 9: Root integration, native build, and target-app smoke

**Files:**

- Modify: `scripts/smoke-aionui-general-work.mjs`
- Modify: `scripts/test-smoke-harness.mjs`
- Modify: `scripts/verify-packaged-app.mjs`
- Modify: `scripts/smoke-packaged-app.mjs`
- Add focused smoke fixtures under `tests/fixtures/` only if the harness imports them directly.

- [ ] **Step 1: Add failing harness assertions**

Require fresh-profile schema 13 plus: create from existing conversation, restart/list, Run Now, terminal Task/Session/Worker/Attempt/Artifact evidence, raw-root/prompt/credential/reference/claim privacy, missed occurrence, interrupted claim, Skill unsupported, absence of AionCore cron/system-resume calls, and final process cleanup.

- [ ] **Step 2: Run smoke-harness tests and verify RED**

Run: `bun run test:smoke-harness`

Expected: FAIL on missing schedule evidence markers.

- [ ] **Step 3: Implement deterministic schedule smoke scenarios**

Use one bounded existing-conversation `/actestra Produce the scheduled Actestra artifact.` job. Persist prepare-restart fixtures before app exit, inspect SQLite through the test-only Electron path, and require exact markers for schema, create, restart, missed, interrupted, run terminal state, privacy, and cleanup. Keep package/signing/release claims separate.

- [ ] **Step 4: Run focused root tests**

Run: `bunx vitest run tests/compatibility/aionuiScheduledGeneralWork.test.ts tests/utility/aionuiSchedulePersistence.test.ts tests/main/aionuiScheduleService.test.ts tests/compatibility/aionuiScheduleBridge.test.ts tests/main/aionuiScheduleBridgeService.test.ts tests/shared/persistenceUtilityProtocol.test.ts tests/utility/persistenceUtilityService.test.ts tests/main/persistenceUtilityClient.test.ts tests/main/aionuiGeneralWorkJourneyService.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the root complete gate once on stable inputs**

Run: `bun run check`

Expected: format, lint, typecheck, Electron SQLite, all root tests, smoke harness, product boundary, foundation retention, downstream contract, and three-entry production build all pass.

- [ ] **Step 6: Run materialized native tests and production build**

Run: `bun run downstream:aionui:test`

Run: `bun run downstream:aionui:package`

Expected: all materialized native tests and production entry builds pass from the exact final source bytes.

- [ ] **Step 7: Build the final local macOS arm64 package**

Run: `bun run downstream:aionui:dist:dir`

Expected: an Apple Development-signed local arm64 `.app` or explicit ad-hoc/unnotarized evidence according to the builder output. This is not a candidate, notarized release, or user acceptance.

- [ ] **Step 8: Run true target-app schedule smoke**

Run: `bun run smoke:aionui-general-work -- .actestra/aionui-v2.1.41`

Expected: schema 13, create, restart/list, Run Now, terminal evidence, privacy, missed/interrupted recovery, and cleanup markers all pass against the final package bytes.

- [ ] **Step 9: Commit smoke and evidence code**

```bash
git add scripts/smoke-aionui-general-work.mjs scripts/test-smoke-harness.mjs scripts/verify-packaged-app.mjs scripts/smoke-packaged-app.mjs tests
git commit -m "test: prove scheduled general work journey"
```

## Task 10: Status truth, review, GitHub delivery, and merged-main proof

**Files:**

- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/product/P4_GENERAL_WORK.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`

- [ ] **Step 1: Update documents with exact local evidence**

Record exact test counts, production build, package path/architecture/signing state, smoke scenarios, and remaining non-claims. Do not claim commit, push, PR CI, merge, merged-main CI, notarization, candidate, release, or user acceptance before each exists.

- [ ] **Step 2: Run documentation and diff checks**

Run: `node scripts/check-doc-links.mjs --tracked-only`

Run: `git diff --check`

Expected: PASS. The tracked-only mode intentionally excludes the owner's untracked `* 2.*` copies.

- [ ] **Step 3: Run CodeRabbit and manual review on stable bytes**

Run the repository's CodeRabbit CLI review against `origin/main`; record rate limits or Free-plan summary-only output accurately. Manually review every changed file for authority boundaries, timer races, persistence transactions, renderer privacy, cleanup, route fallthrough, and unrelated changes. Fix valid findings with the narrowest test first; rerun only invalidated broader gates.

- [ ] **Step 4: Audit exact scope before staging**

Verify `git status --short`, `git diff --name-only origin/main...HEAD`, `git diff --numstat`, common secret patterns, binary additions, generated `.actestra/`, package output, `/tmp` artifacts, and all `* 2.*` user files. Stage only intended tracked changes and new schedule files.

- [ ] **Step 5: Commit and push the stable slice**

```bash
git add -u
git add apps/desktop/src/compatibility/aionui/scheduledGeneralWork.ts apps/desktop/src/compatibility/aionui/scheduleBridge.ts apps/desktop/src/main/compatibility/aionuiScheduleService.ts apps/desktop/src/main/compatibility/aionuiScheduleBridgeService.ts downstream/aionui-v2.1.41/patches/0011-actestra-scheduled-general-work.mjs tests/compatibility/aionuiScheduledGeneralWork.test.ts tests/compatibility/aionuiScheduleBridge.test.ts tests/main/aionuiScheduleService.test.ts tests/main/aionuiScheduleBridgeService.test.ts tests/fixtures/aionuiSchedule.ts tests/utility/aionuiSchedulePersistence.test.ts docs/superpowers/plans/2026-07-31-actestra-owned-scheduled-general-work.md
git commit -m "feat: add Actestra-owned scheduled general work"
git push -u origin feat/p4-schedule-journey
```

- [ ] **Step 6: Open a Ready pull request and verify exact-head CI**

Create a non-draft PR describing authority, retention, migrations, validation, package, smoke, and non-claims. Resolve the exact remote PR head SHA and require its CI run plus mandatory repository review/protection rules. Do not bypass a required external approval.

- [ ] **Step 7: Squash merge only after required gates pass**

Use the repository's squash merge convention. Verify the PR reports merged and resolve the exact new `origin/main` SHA independently from the PR head.

- [ ] **Step 8: Verify exact merged-main CI**

Require a successful workflow run whose `headSha` equals the exact squash merge. Update `PROJECT_STATUS.md` only through a follow-up governed change if remote evidence is not already in the merged commit. Keep local package, PR CI, merged-main CI, candidate, notarization, release, and true-machine user acceptance as separate facts.

## Self-review result

- Spec coverage: the plan covers retained routes/dialog/detail/history/status/CRUD/pause/run/events; strict bounded input; schema-13 Workspace/grant/job authority; timers; atomic claims; terminalization; missed/interrupted recovery; General Work reuse; Skill/system-resume fail-closed behavior; dependency ownership; package smoke; privacy; cleanup; and exact remote gates.
- Placeholder scan: no implementation placeholder is used; each code-changing task names exact files, expected red/green commands, concrete interfaces, and required behavior.
- Type consistency: `AionUiScheduleJob`, `AionUiScheduledGeneralWorkPersistencePort`, `AionUiScheduleService`, `AionUiScheduleBridgeService`, `submitFromTrustedContext`, and all persistence operation names are used consistently across tasks.
- Execution mode: inline only in this task, as explicitly authorized by the owner; no subagent dispatch.
