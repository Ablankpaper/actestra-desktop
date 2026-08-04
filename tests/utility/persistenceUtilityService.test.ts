// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceUtilityService } from "../../apps/desktop/src/utility/persistence/persistenceUtilityService";
import { CURRENT_CORE_SCHEMA_VERSION } from "../../apps/desktop/src/utility/persistence/sqliteMigrations";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";
import { createTeamRunFixture } from "../fixtures/teamRun";

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
  it("dispatches schema 15 Team definitions and append-only run snapshots", async () => {
    const userDataPath = createTestDirectory();
    const service = new PersistenceUtilityService();
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
    await service.shutdown();
  });

  it("dispatches schedule state and preserves typed persistence errors", async () => {
    const userDataPath = createTestDirectory();
    const service = new PersistenceUtilityService();
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
