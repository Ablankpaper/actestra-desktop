// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAionUiApprovalDecisionRecord,
  normalizeAionUiApprovalDecisionRequest,
  type AionUiApprovalDecisionRecord,
} from "../../apps/desktop/src/compatibility/aionui";
import {
  instant,
  type PlatformEvidencePersistencePort,
  type PrivilegedClock,
} from "../../apps/desktop/src/core";
import {
  AionUiApprovalNativeTransportError,
  type AionUiApprovalNativeTransport,
} from "../../apps/desktop/src/main/compatibility/aionuiApprovalAuthorityService";
import { createPolicyGatedAionUiApprovalNativeTransport } from "../../apps/desktop/src/main/compatibility/aionuiApprovalPolicyGate";
import {
  CORE_DATABASE_FILENAME,
  openSqliteCorePersistence,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-approval-policy-test-"));
  testDirectories.push(directory);
  return directory;
}

function clock(): PrivilegedClock {
  let milliseconds = Date.parse("2026-07-29T08:30:00.000Z");
  return {
    now: () => {
      const value = instant(new Date(milliseconds).toISOString());
      milliseconds += 1_000;
      return value;
    },
  };
}

function identifierSource(): (prefix: string) => string {
  let sequence = 0;
  return (prefix) => `${prefix}-${String(++sequence)}`;
}

function pendingDecision(): AionUiApprovalDecisionRecord {
  const decision = normalizeAionUiApprovalDecisionRequest({
    contractVersion: 1,
    method: "POST",
    path: "/api/conversations/private-conversation/confirmations/private-call/confirm",
    body: {
      msg_id: "private-message",
      data: {
        value: "proceed_once",
      },
    },
  });
  const record = Object.freeze({
    ...decision,
    deliveryState: "pending-delivery",
    attemptCount: 1,
    createdAt: "2026-07-29T08:29:00.000Z",
    updatedAt: "2026-07-29T08:29:01.000Z",
    lastAttemptAt: "2026-07-29T08:29:01.000Z",
  }) satisfies AionUiApprovalDecisionRecord;
  assertAionUiApprovalDecisionRecord(record);
  return record;
}

function transport(
  overrides: Partial<AionUiApprovalNativeTransport> = {},
): AionUiApprovalNativeTransport {
  return {
    isPending: vi.fn(async () => true),
    deliver: vi.fn(async () => undefined),
    ...overrides,
  };
}

function auditRows(userDataPath: string): readonly {
  readonly event_type: string;
  readonly record_json: string;
}[] {
  const database = new DatabaseSync(path.join(userDataPath, "state", CORE_DATABASE_FILENAME), {
    readOnly: true,
  });
  try {
    return database
      .prepare(
        `SELECT event_type, record_json
         FROM privileged_audit_records
         ORDER BY sequence`,
      )
      .all() as unknown as readonly {
      readonly event_type: string;
      readonly record_json: string;
    }[];
  } finally {
    database.close();
  }
}

function failingAuditPersistence(
  persistence: PlatformEvidencePersistencePort,
  failAt: number,
): PlatformEvidencePersistencePort {
  let appendCount = 0;
  return {
    appendPrivilegedAudit: async (input) => {
      appendCount += 1;
      if (appendCount === failAt) {
        throw new Error("injected audit failure");
      }
      return persistence.appendPrivilegedAudit(input);
    },
    appendAgentAttemptEvidence: (evidence) => persistence.appendAgentAttemptEvidence(evidence),
    summarizePrivilegedAudit: () => persistence.summarizePrivilegedAudit(),
    listRecentAgentAttemptEvidence: (limit) => persistence.listRecentAgentAttemptEvidence(limit),
  };
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-approval-policy-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("AionUi F3.2 approval delivery policy gate", () => {
  it("persists policy and tool evidence before and after one native delivery", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });
    const signal = new AbortController().signal;

    await expect(gated.deliver(pendingDecision(), signal)).resolves.toBeUndefined();
    expect(native.deliver).toHaveBeenCalledTimes(1);
    expect(native.deliver).toHaveBeenCalledWith(pendingDecision(), signal);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    await persistence.close();

    const rows = auditRows(userDataPath);
    expect(rows.map(({ event_type }) => event_type)).toEqual([
      "policy.evaluated",
      "tool.started",
      "tool.completed",
    ]);
    const encodedAudit = rows.map(({ record_json }) => record_json).join("\n");
    expect(encodedAudit).not.toContain("private-conversation");
    expect(encodedAudit).not.toContain("private-call");
    expect(encodedAudit).not.toContain("private-message");
    expect(encodedAudit).not.toContain("proceed_once");
  });

  it("rejects a durable response that has not entered a delivery attempt", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });
    const { lastAttemptAt: _lastAttemptAt, ...attempted } = pendingDecision();
    const unattempted = Object.freeze({
      ...attempted,
      attemptCount: 0,
      updatedAt: attempted.createdAt,
    }) satisfies AionUiApprovalDecisionRecord;
    assertAionUiApprovalDecisionRecord(unattempted);

    await expect(gated.deliver(unattempted, new AbortController().signal)).rejects.toMatchObject({
      code: "invalid-contract",
      mayHaveExecuted: false,
    });
    expect(native.deliver).not.toHaveBeenCalled();
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 0,
      lastSequence: 0,
    });
    await persistence.close();
  });

  it("fails closed before native delivery when required policy audit cannot persist", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence: failingAuditPersistence(persistence, 1),
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(
      gated.deliver(pendingDecision(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "audit-unavailable",
      mayHaveExecuted: false,
    });
    expect(native.deliver).not.toHaveBeenCalled();
    await persistence.close();
  });

  it("preserves a structured native rejection after failure audit succeeds", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const nativeError = new AionUiApprovalNativeTransportError(409, {
      success: false,
      error: "Native confirmation remains pending",
      code: "CONFIRMATION_BUSY",
    });
    const native = transport({
      deliver: vi.fn(async () => {
        throw nativeError;
      }),
    });
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(gated.deliver(pendingDecision(), new AbortController().signal)).rejects.toBe(
      nativeError,
    );
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    await persistence.close();
  });

  it("reports uncertainty when completion audit fails after native delivery", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence: failingAuditPersistence(persistence, 3),
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(
      gated.deliver(pendingDecision(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "post-execution-audit-failed",
      mayHaveExecuted: true,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 2,
      lastSequence: 2,
    });
    await persistence.close();
  });

  it("does not expose a native rejection when its failure audit cannot persist", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const nativeError = new AionUiApprovalNativeTransportError(409, {
      success: false,
      error: "Native confirmation remains pending",
      code: "CONFIRMATION_BUSY",
    });
    const native = transport({
      deliver: vi.fn(async () => {
        throw nativeError;
      }),
    });
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence: failingAuditPersistence(persistence, 3),
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(
      gated.deliver(pendingDecision(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "post-execution-audit-failed",
      mayHaveExecuted: true,
    });
    expect(native.deliver).toHaveBeenCalledTimes(1);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 2,
      lastSequence: 2,
    });
    await persistence.close();
  });

  it("keeps native pending-state reconciliation as a bounded delegated read", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport({
      isPending: vi.fn(async () => false),
    });
    const gated = createPolicyGatedAionUiApprovalNativeTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });
    const signal = new AbortController().signal;

    await expect(gated.isPending(pendingDecision(), signal)).resolves.toBe(false);
    expect(native.isPending).toHaveBeenCalledWith(pendingDecision(), signal);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 0,
      lastSequence: 0,
    });
    await persistence.close();
  });
});
