// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditContextFor,
  auditRecordId,
  instant,
  policyRevision,
  type PrivilegedClock,
} from "../../apps/desktop/src/core";
import { openSqliteCorePersistence } from "../../apps/desktop/src/main/persistence/sqliteCorePersistence";
import { PersistentAuditTrail } from "../../apps/desktop/src/main/privileged/persistentAuditTrail";
import { createProtectedOperation } from "../fixtures/privilegedServices";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-audit-trail-test-"));
  testDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-audit-trail-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("persistent privileged audit trail", () => {
  it("uses the durable store as the authoritative sequence across restart", async () => {
    const userDataPath = createTestDirectory();
    const clock: PrivilegedClock = {
      now: () => instant("2026-07-28T09:00:00.000Z"),
    };
    const operation = createProtectedOperation();
    const event = {
      type: "policy.evaluated",
      context: auditContextFor(operation),
      policyRevision: policyRevision("policy-main-deny-v1"),
      decision: "deny",
      reasonCode: "no-matching-rule",
      matchedRuleIds: [],
    } as const;
    const firstPersistence = openSqliteCorePersistence(userDataPath);
    const first = new PersistentAuditTrail({
      clock,
      persistence: firstPersistence,
      newRecordId: () => auditRecordId("persistent-audit-1"),
    });
    await expect(first.append(event)).resolves.toMatchObject({
      sequence: 1,
      event,
    });
    await firstPersistence.close();

    const secondPersistence = openSqliteCorePersistence(userDataPath);
    const second = new PersistentAuditTrail({
      clock,
      persistence: secondPersistence,
      newRecordId: () => auditRecordId("persistent-audit-2"),
    });
    await expect(second.append(event)).resolves.toMatchObject({
      sequence: 2,
      event,
    });
    await secondPersistence.close();
  });
});
