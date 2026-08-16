// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceUtilityService } from "../../apps/desktop/src/utility/persistence/persistenceUtilityService";
import { CURRENT_CORE_SCHEMA_VERSION } from "../../apps/desktop/src/utility/persistence/sqliteMigrations";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";
import { createTeamRunFixture } from "../fixtures/teamRun";
import {
  instant,
  normalizeTeamDefinition,
  transitionTeamRun,
  type PrivilegedClock,
} from "../../apps/desktop/src/core";

const testClock: PrivilegedClock = Object.freeze({
  now: () => instant(new Date().toISOString()),
});

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-utility-service-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-utility-service-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistence utility schedule service", () => {
  it("maintains audit integrity on open and dispatches the bounded P7.4 evidence reads", async () => {
    const userDataPath = createTestDirectory();
    const openedAt = instant("2026-08-16T07:15:00.000Z");
    const service = new PersistenceUtilityService(
      Object.freeze({
        now: () => openedAt,
      }),
    );

    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "p7-4-service-open",
        operation: "open",
        payload: { userDataPath },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { schemaVersion: CURRENT_CORE_SCHEMA_VERSION },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "p7-4-service-retention",
        operation: "read-privileged-audit-retention-state",
        payload: {},
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: {
        retainedRecordCount: 0,
        prunedRecordCount: 0,
        lastSequence: 0,
        lastMaintainedAt: openedAt,
      },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "p7-4-service-list",
        operation: "list-privileged-audit",
        payload: { limit: 1_000 },
      }),
    ).resolves.toMatchObject({ status: "ok", result: [] });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "p7-4-service-maintain",
        operation: "maintain-privileged-audit",
        payload: { now: "2026-08-16T07:16:00.000Z" },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { lastMaintainedAt: "2026-08-16T07:16:00.000Z" },
    });
    await service.shutdown();
  });

  it("dispatches schema 15 Team definitions and append-only run snapshots", async () => {
    const userDataPath = createTestDirectory();
    const service = new PersistenceUtilityService(testClock);
    const { plan, team, accepted } = await createTeamRunFixture("service");

    await service.handle({
      protocolVersion: 1,
      type: "request",
      requestId: "team-service-open",
      operation: "open",
      payload: { userDataPath },
    });
    await service.handle({
      protocolVersion: 1,
      type: "request",
      requestId: "team-service-plan",
      operation: "persist-admitted-team-plan",
      payload: { plan },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "team-service-definition",
        operation: "persist-team-definition",
        payload: { team },
      }),
    ).resolves.toMatchObject({ status: "ok", result: { status: "stored", team } });
    const replacement = normalizeTeamDefinition({
      ...team,
      name: "Service replacement Team",
      updatedAt: "2026-08-04T01:00:02.000Z",
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "team-service-definition-replace",
        operation: "replace-team-definition",
        payload: { expected: team, replacement },
      }),
    ).resolves.toMatchObject({ status: "ok", result: { status: "stored", team: replacement } });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "team-service-run",
        operation: "persist-team-run-snapshot",
        payload: { snapshot: accepted },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { status: "stored", snapshot: accepted },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "team-service-recoverable",
        operation: "list-recoverable-team-runs",
        payload: { limit: 100 },
      }),
    ).resolves.toMatchObject({ status: "ok", result: [accepted] });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "team-service-runs",
        operation: "list-team-runs-for-team",
        payload: { teamId: team.teamId, limit: 100 },
      }),
    ).resolves.toMatchObject({ status: "ok", result: [accepted] });
    const cancelled = transitionTeamRun(accepted, {
      type: "cancel-run",
      reason: "Close the service fixture before Team removal.",
      occurredAt: instant("2026-08-04T01:00:03.000Z"),
    });
    await service.handle({
      protocolVersion: 1,
      type: "request",
      requestId: "team-service-run-cancelled",
      operation: "persist-team-run-snapshot",
      payload: { snapshot: cancelled },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "team-service-definition-remove",
        operation: "remove-team-definition",
        payload: { expected: replacement, removedAt: "2026-08-04T01:00:04.000Z" },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { status: "removed", teamId: team.teamId },
    });
    await service.shutdown();
  });

  it("dispatches schedule state and preserves typed persistence errors", async () => {
    const userDataPath = createTestDirectory();
    const service = new PersistenceUtilityService(testClock);
    const registration = createAionUiScheduleRegistration("service", userDataPath);

    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "schedule-service-open",
        operation: "open",
        payload: { userDataPath },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { schemaVersion: CURRENT_CORE_SCHEMA_VERSION },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "schedule-service-register",
        operation: "register-aionui-schedule",
        payload: { registration },
      }),
    ).resolves.toMatchObject({
      status: "ok",
      result: { status: "stored", job: registration.job },
    });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "schedule-service-list",
        operation: "list-aionui-schedules",
        payload: { input: { limit: 100 } },
      }),
    ).resolves.toMatchObject({ status: "ok", result: [registration.job] });
    await expect(
      service.handle({
        protocolVersion: 1,
        type: "request",
        requestId: "schedule-service-conflict",
        operation: "register-aionui-schedule",
        payload: {
          registration: {
            ...registration,
            job: {
              ...registration.job,
              prompt: "/actestra Changed content under the same identity.",
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      status: "error",
      error: { domain: "persistence", code: "schedule-conflict" },
    });

    await service.shutdown();
  });
});
