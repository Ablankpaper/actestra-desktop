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
import type { AionUiApprovalNativeTransport } from "../../apps/desktop/src/main/compatibility/aionuiApprovalAuthorityService";
import { createPolicyGatedAionUiApprovalReconciliationTransport } from "../../apps/desktop/src/main/compatibility/aionuiApprovalReconciliationPolicyGate";
import {
  CORE_DATABASE_FILENAME,
  openSqliteCorePersistence,
} from "../../apps/desktop/src/main/persistence/sqliteCorePersistence";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-reconciliation-gate-test-"));
  testDirectories.push(directory);
  return directory;
}

function clock(): PrivilegedClock {
  let milliseconds = Date.parse("2026-07-29T10:30:00.000Z");
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
    createdAt: "2026-07-29T10:29:00.000Z",
    updatedAt: "2026-07-29T10:29:01.000Z",
    lastAttemptAt: "2026-07-29T10:29:01.000Z",
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
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-reconciliation-gate-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("AionUi F3.3 approval reconciliation policy gate", () => {
  it("persists policy and tool evidence around one bounded pending-state read", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const native = transport({
      isPending: vi.fn(async () => false),
    });
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });
    const signal = new AbortController().signal;

    await expect(gated.isPending(pendingDecision(), signal)).resolves.toBe(false);
    expect(native.isPending).toHaveBeenCalledTimes(1);
    expect(native.isPending).toHaveBeenCalledWith(pendingDecision(), signal);
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

  it("fails closed before the native read when required policy audit is unavailable", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
      persistence: failingAuditPersistence(persistence, 1),
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(
      gated.isPending(pendingDecision(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "audit-unavailable",
      mayHaveExecuted: false,
    });
    expect(native.isPending).not.toHaveBeenCalled();
    await persistence.close();
  });

  it("reports an uncertain read when completion audit fails after native access", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
      persistence: failingAuditPersistence(persistence, 3),
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(
      gated.isPending(pendingDecision(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "post-execution-audit-failed",
      mayHaveExecuted: true,
    });
    expect(native.isPending).toHaveBeenCalledTimes(1);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 2,
      lastSequence: 2,
    });
    await persistence.close();
  });

  it("rejects an invalid native read result after durable failure evidence", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const native = transport({
      isPending: vi.fn(async () => "pending" as unknown as boolean),
    });
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });

    await expect(
      gated.isPending(pendingDecision(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "tool-execution-failed",
      mayHaveExecuted: true,
    });
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    await persistence.close();

    const rows = auditRows(userDataPath);
    expect(rows.map(({ event_type }) => event_type)).toEqual([
      "policy.evaluated",
      "tool.started",
      "tool.failed",
    ]);
    const encodedAudit = rows.map(({ record_json }) => record_json).join("\n");
    expect(encodedAudit).not.toContain("private-conversation");
    expect(encodedAudit).not.toContain("private-call");
    expect(encodedAudit).not.toContain("private-message");
    expect(encodedAudit).not.toContain("proceed_once");
  });

  it("rejects reconciliation before a delivery attempt without native access or audit", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
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

    await expect(gated.isPending(unattempted, new AbortController().signal)).rejects.toMatchObject({
      code: "invalid-contract",
      mayHaveExecuted: false,
    });
    expect(native.isPending).not.toHaveBeenCalled();
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 0,
      lastSequence: 0,
    });
    await persistence.close();
  });

  it("coalesces concurrent reads for the same private confirmation identity", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    let settleRead: ((pending: boolean) => void) | undefined;
    const firstRead = new Promise<boolean>((resolve) => {
      settleRead = resolve;
    });
    const isPending = vi
      .fn<(record: AionUiApprovalDecisionRecord, signal: AbortSignal) => Promise<boolean>>()
      .mockImplementationOnce(() => {
        markReadStarted?.();
        return firstRead;
      })
      .mockResolvedValueOnce(true);
    const native = transport({
      isPending,
    });
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
      persistence,
      transport: native,
      clock: clock(),
      newIdentifier: identifierSource(),
    });
    const record = pendingDecision();

    const active = gated.isPending(record, new AbortController().signal);
    await readStarted;
    const coalesced = gated.isPending(record, new AbortController().signal);
    expect(isPending).toHaveBeenCalledTimes(1);

    settleRead?.(false);
    await expect(Promise.all([active, coalesced])).resolves.toEqual([false, false]);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 3,
      lastSequence: 3,
    });
    await expect(gated.isPending(record, new AbortController().signal)).resolves.toBe(true);
    expect(isPending).toHaveBeenCalledTimes(2);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 6,
      lastSequence: 6,
    });
    await persistence.close();
  });

  it("delegates response delivery unchanged to the accepted F3.2 transport", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory());
    const native = transport();
    const gated = createPolicyGatedAionUiApprovalReconciliationTransport({
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
      recordCount: 0,
      lastSequence: 0,
    });
    await persistence.close();
  });
});
