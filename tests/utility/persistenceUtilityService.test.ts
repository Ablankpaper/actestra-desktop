// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PersistenceUtilityService } from "../../apps/desktop/src/utility/persistence/persistenceUtilityService";
import { createAionUiScheduleRegistration } from "../fixtures/aionuiSchedule";

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
    ).resolves.toMatchObject({ status: "ok", result: { schemaVersion: 13 } });
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
