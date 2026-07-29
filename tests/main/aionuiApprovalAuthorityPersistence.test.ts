// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeAionUiApprovalDecisionRequest } from "../../apps/desktop/src/compatibility/aionui";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/main/persistence/sqliteCorePersistence";

const testDirectories: string[] = [];
const CREATED_AT = "2026-07-29T05:00:00.000Z";
const ATTEMPTED_AT = "2026-07-29T05:00:01.000Z";
const COMPLETED_AT = "2026-07-29T05:00:02.000Z";

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-approval-authority-test-"));
  testDirectories.push(directory);
  return directory;
}

function decision(value = "proceed_once") {
  return normalizeAionUiApprovalDecisionRequest({
    contractVersion: 1,
    method: "POST",
    path: "/api/conversations/conversation-private/confirmations/call-private/confirm",
    body: {
      msg_id: "message-private",
      data: {
        value,
      },
    },
  });
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-approval-authority-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("AionUi F3 SQLite approval authority", () => {
  it("persists an immutable decision and its outbox lifecycle across restart", async () => {
    const userDataPath = createTestDirectory();
    const first = openSqliteCorePersistence(userDataPath);
    const normalized = decision();

    await expect(
      first.reserveAionUiApprovalDecision(normalized, CREATED_AT),
    ).resolves.toMatchObject({
      status: "created",
      record: {
        decisionId: normalized.decisionId,
        deliveryState: "pending-delivery",
        attemptCount: 0,
      },
    });
    await expect(
      first.beginAionUiApprovalDelivery(normalized.decisionId, ATTEMPTED_AT),
    ).resolves.toMatchObject({
      deliveryState: "pending-delivery",
      attemptCount: 1,
      lastAttemptAt: ATTEMPTED_AT,
    });
    await expect(
      first.markAionUiApprovalDeliveryFailed(
        normalized.decisionId,
        "native-http-503",
        COMPLETED_AT,
      ),
    ).resolves.toMatchObject({
      deliveryState: "pending-delivery",
      attemptCount: 1,
      lastErrorCode: "native-http-503",
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 1,
      deliveredCount: 0,
    });
    await expect(reopened.listPendingAionUiApprovalDecisions(10)).resolves.toHaveLength(1);
    await expect(
      reopened.markAionUiApprovalDelivered(normalized.decisionId, "2026-07-29T05:00:03.000Z"),
    ).resolves.toMatchObject({
      deliveryState: "delivered",
      attemptCount: 1,
      deliveredAt: "2026-07-29T05:00:03.000Z",
      lastErrorCode: undefined,
    });
    await expect(reopened.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 0,
      deliveredCount: 1,
    });
    await reopened.close();
  });

  it("deduplicates the exact decision and rejects a changed decision for the same call", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const approved = decision();
    await persistence.reserveAionUiApprovalDecision(approved, CREATED_AT);
    await expect(
      persistence.reserveAionUiApprovalDecision(approved, "2026-07-29T06:00:00.000Z"),
    ).resolves.toMatchObject({
      status: "duplicate",
      record: {
        createdAt: CREATED_AT,
      },
    });
    await expect(
      persistence.reserveAionUiApprovalDecision(decision("deny"), "2026-07-29T06:00:00.000Z"),
    ).rejects.toMatchObject({
      code: "evidence-conflict",
    });
    await persistence.close();
  });

  it("fails closed when an indexed delivery projection is corrupted", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const normalized = decision();
    await persistence.reserveAionUiApprovalDecision(normalized, CREATED_AT);
    await persistence.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    database
      .prepare("UPDATE aionui_approval_decisions SET native_message_id = ? WHERE decision_id = ?")
      .run("tampered", normalized.decisionId);
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.getAionUiApprovalDecision(normalized.decisionId)).rejects.toMatchObject({
      code: "corrupt-database",
    });
    await reopened.close();
  });
});
