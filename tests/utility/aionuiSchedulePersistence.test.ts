// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AionUiScheduleClaimResult,
  AionUiScheduleCompletionResult,
  AionUiScheduleMutationResult,
  AionUiScheduleRegistration,
  AionUiScheduleRegistrationResult,
  AionUiScheduledGeneralWorkPersistencePort,
} from "../../apps/desktop/src/compatibility/aionui";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-aionui-schedule-store-test-"));
  testDirectories.push(directory);
  return directory;
}

function schedulePort(
  persistence: ReturnType<typeof openSqliteCorePersistence>,
): AionUiScheduledGeneralWorkPersistencePort {
  return persistence as AionUiScheduledGeneralWorkPersistencePort;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-aionui-schedule-store-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite Actestra-owned schedule persistence", () => {
  it("atomically restores the job, schedule Workspace, and active grant after reopen", async () => {
    const userDataPath = createTestDirectory();
    const registration = createAionUiScheduleRegistration("atomic", userDataPath);
    const first = openSqliteCorePersistence(userDataPath);
    const firstSchedule = schedulePort(first);

    await expect(firstSchedule.registerAionUiSchedule(registration)).resolves.toEqual({
      status: "stored",
      job: registration.job,
    } satisfies AionUiScheduleRegistrationResult);
    await expect(firstSchedule.registerAionUiSchedule(registration)).resolves.toEqual({
      status: "duplicate",
      job: registration.job,
    } satisfies AionUiScheduleRegistrationResult);
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const reopenedSchedule = schedulePort(reopened);
    await expect(reopenedSchedule.getAionUiSchedule(registration.job.id)).resolves.toEqual(
      registration.job,
    );
    await expect(
      reopenedSchedule.listAionUiSchedules({
        limit: 100,
        conversationHash: registration.job.conversationHash,
      }),
    ).resolves.toEqual([registration.job]);
    await expect(reopened.getActiveWorkspaceGrant(registration.workspace.id)).resolves.toEqual(
      registration.workspaceGrant,
    );
    await expect(reopened.loadDomainGraph()).resolves.toEqual({
      workspaces: [registration.workspace],
      tasks: [],
      sessions: [],
      workers: [],
      approvals: [],
      artifacts: [],
    });
    await reopened.close();
  });

  it("rejects changed content under an existing schedule identity", async () => {
    const userDataPath = createTestDirectory();
    const registration = createAionUiScheduleRegistration("conflict", userDataPath);
    const persistence = openSqliteCorePersistence(userDataPath);
    const schedule = schedulePort(persistence);
    await schedule.registerAionUiSchedule(registration);

    await expect(
      schedule.registerAionUiSchedule({
        ...registration,
        job: {
          ...registration.job,
          prompt: "/actestra Changed content under the same identity.",
        },
      }),
    ).rejects.toMatchObject({ code: "schedule-conflict" });
    await persistence.close();
  });

  it("caps non-deleted schedule rows at one hundred", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const schedule = schedulePort(persistence);
    for (let index = 0; index < 100; index += 1) {
      await schedule.registerAionUiSchedule(
        createAionUiScheduleRegistration(`cap-${String(index)}`, userDataPath),
      );
    }

    await expect(
      schedule.registerAionUiSchedule(
        createAionUiScheduleRegistration("cap-overflow", userDataPath),
      ),
    ).rejects.toMatchObject({ code: "schedule-limit" });
    await expect(schedule.listAionUiSchedules({ limit: 100 })).resolves.toHaveLength(100);
    await persistence.close();
  });

  it("updates mutable state, records missed work, and soft-deletes an idle job", async () => {
    const userDataPath = createTestDirectory();
    const registration = createAionUiScheduleRegistration("mutate", userDataPath);
    const persistence = openSqliteCorePersistence(userDataPath);
    const schedule = schedulePort(persistence);
    await schedule.registerAionUiSchedule(registration);
    const updateTime = registration.job.updatedAtMs + 10_000;

    await expect(
      schedule.updateAionUiSchedule({
        jobId: registration.job.id,
        updatedAtMs: updateTime,
        name: "Paused missed schedule",
        enabled: false,
        nextRunAtMs: updateTime + 60_000,
        lastRunAtMs: updateTime,
        lastStatus: "missed",
        lastIncidentCode: "missed-occurrence",
      }),
    ).resolves.toEqual({
      status: "updated",
      job: expect.objectContaining({
        name: "Paused missed schedule",
        enabled: false,
        lastStatus: "missed",
        lastIncidentCode: "missed-occurrence",
        updatedAtMs: updateTime,
      }),
    } satisfies AionUiScheduleMutationResult);

    await expect(
      schedule.deleteAionUiSchedule({
        jobId: registration.job.id,
        deletedAtMs: updateTime + 1,
      }),
    ).resolves.toEqual({
      status: "deleted",
      job: expect.objectContaining({
        enabled: false,
        deletedAtMs: updateTime + 1,
        updatedAtMs: updateTime + 1,
      }),
    } satisfies AionUiScheduleMutationResult);
    await expect(schedule.getAionUiSchedule(registration.job.id)).resolves.toBeNull();
    await expect(schedule.listAionUiSchedules({ limit: 100 })).resolves.toEqual([]);
    await persistence.close();
  });

  it("allows only one active claim and requires its exact terminal identity", async () => {
    const userDataPath = createTestDirectory();
    const registration = createAionUiScheduleRegistration("claim", userDataPath);
    const persistence = openSqliteCorePersistence(userDataPath);
    const schedule = schedulePort(persistence);
    await schedule.registerAionUiSchedule(registration);
    const claimedAtMs = registration.job.updatedAtMs + 1_000;

    await expect(
      schedule.claimAionUiScheduleRun({
        jobId: registration.job.id,
        claim: "claim-schedule-1",
        claimedAtMs,
      }),
    ).resolves.toEqual({
      status: "claimed",
      job: expect.objectContaining({
        activeClaim: "claim-schedule-1",
        activeClaimedAtMs: claimedAtMs,
        nextRunAtMs: undefined,
        runSequence: 1,
      }),
    } satisfies AionUiScheduleClaimResult);
    await expect(
      schedule.claimAionUiScheduleRun({
        jobId: registration.job.id,
        claim: "claim-schedule-2",
        claimedAtMs: claimedAtMs + 1,
      }),
    ).resolves.toEqual({
      status: "busy",
      job: expect.objectContaining({ activeClaim: "claim-schedule-1" }),
    } satisfies AionUiScheduleClaimResult);
    await expect(
      schedule.completeAionUiScheduleRun({
        jobId: registration.job.id,
        claim: "claim-wrong",
        completedAtMs: claimedAtMs + 2,
        status: "ok",
        nextRunAtMs: claimedAtMs + 60_000,
      }),
    ).resolves.toEqual({
      status: "claim-mismatch",
      job: expect.objectContaining({ activeClaim: "claim-schedule-1" }),
    } satisfies AionUiScheduleCompletionResult);
    await expect(
      schedule.completeAionUiScheduleRun({
        jobId: registration.job.id,
        claim: "claim-schedule-1",
        completedAtMs: claimedAtMs + 3,
        status: "ok",
        nextRunAtMs: claimedAtMs + 60_000,
      }),
    ).resolves.toEqual({
      status: "completed",
      job: expect.objectContaining({
        activeClaim: undefined,
        activeClaimedAtMs: undefined,
        runSequence: 1,
        runCount: 1,
        lastStatus: "ok",
        lastIncidentCode: undefined,
      }),
    } satisfies AionUiScheduleCompletionResult);
    await persistence.close();
  });

  it("rejects deletion during a claim and terminalizes stale claims as interrupted after reopen", async () => {
    const userDataPath = createTestDirectory();
    const registration = createAionUiScheduleRegistration("recover", userDataPath);
    const first = openSqliteCorePersistence(userDataPath);
    const firstSchedule = schedulePort(first);
    await firstSchedule.registerAionUiSchedule(registration);
    const claimedAtMs = registration.job.updatedAtMs + 1_000;
    await firstSchedule.claimAionUiScheduleRun({
      jobId: registration.job.id,
      claim: "claim-recover-1",
      claimedAtMs,
    });
    await expect(
      firstSchedule.deleteAionUiSchedule({
        jobId: registration.job.id,
        deletedAtMs: claimedAtMs + 1,
      }),
    ).resolves.toEqual({
      status: "active-claim",
      job: expect.objectContaining({ activeClaim: "claim-recover-1" }),
    } satisfies AionUiScheduleMutationResult);
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    const reopenedSchedule = schedulePort(reopened);
    await expect(
      reopenedSchedule.recoverAionUiScheduleRuns({ recoveredAtMs: claimedAtMs + 2 }),
    ).resolves.toEqual([
      expect.objectContaining({
        activeClaim: undefined,
        activeClaimedAtMs: undefined,
        lastRunAtMs: claimedAtMs + 2,
        lastStatus: "error",
        lastIncidentCode: "interrupted",
        runSequence: 1,
        runCount: 1,
      }),
    ]);
    await reopened.close();
  });

  it("rolls back the Workspace and grant when registration collides", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const schedule = schedulePort(persistence);
    const first = createAionUiScheduleRegistration("collision-first", userDataPath);
    const second = createAionUiScheduleRegistration("collision-second", userDataPath);
    await schedule.registerAionUiSchedule(first);
    const conflicting: AionUiScheduleRegistration = {
      ...second,
      workspace: { ...second.workspace, id: first.workspace.id },
      workspaceGrant: { ...second.workspaceGrant, workspaceId: first.workspace.id },
      job: { ...second.job, workspaceId: first.workspace.id },
    };

    await expect(schedule.registerAionUiSchedule(conflicting)).rejects.toMatchObject({
      code: "schedule-conflict",
    });
    await expect(persistence.getActiveWorkspaceGrant(first.workspace.id)).resolves.toEqual(
      first.workspaceGrant,
    );
    await expect(persistence.getActiveWorkspaceGrant(second.workspace.id)).resolves.toBeNull();
    await expect(schedule.getAionUiSchedule(second.job.id)).resolves.toBeNull();
    await persistence.close();
  });
});
