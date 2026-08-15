// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  auditContextFor,
  auditRecordId,
  correlationId,
  eventStreamId,
  instant,
  policyRevision,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
} from "../../apps/desktop/src/core";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import { createProtectedOperation } from "../fixtures/privilegedServices";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-platform-store-test-"));
  testDirectories.push(directory);
  return directory;
}

function createAuditInput(
  record = "audit-platform-1",
  occurredAt = "2026-07-28T09:00:00.000Z",
): AppendPrivilegedAuditInput {
  const operation = createProtectedOperation();
  return {
    recordId: auditRecordId(record),
    occurredAt: instant(occurredAt),
    event: {
      type: "policy.evaluated",
      context: auditContextFor(operation),
      policyRevision: policyRevision("policy-main-deny-v1"),
      decision: "deny",
      reasonCode: "no-matching-rule",
      matchedRuleIds: [],
    },
  };
}

function createAttemptEvidence(
  overrides: Partial<AgentAttemptEvidence> = {},
): AgentAttemptEvidence {
  return {
    contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
    redaction: "metadata",
    workspaceId: workspaceId("workspace-platform"),
    taskId: taskId("task-platform"),
    correlationId: correlationId("correlation-platform"),
    sessionId: sessionId("session-platform"),
    workerId: workerId("worker-platform"),
    streamId: eventStreamId("stream-platform"),
    state: "timed-out",
    taskState: "running",
    startedAt: instant("2026-07-28T09:00:00.000Z"),
    lastSignalAt: instant("2026-07-28T09:00:01.000Z"),
    lastControlSequence: 1,
    lastCoreEventSequence: 1,
    restartCount: 0,
    disposed: true,
    forcedCancellation: false,
    incident: {
      code: "heartbeat-timeout",
      occurredAt: instant("2026-07-28T09:00:02.000Z"),
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-platform-store-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("SQLite platform evidence", () => {
  it("continues gapless metadata-only audit sequence across restart", async () => {
    const userDataPath = createTestDirectory();
    const first = openSqliteCorePersistence(userDataPath);
    await expect(first.appendPrivilegedAudit(createAuditInput())).resolves.toMatchObject({
      recordId: "audit-platform-1",
      sequence: 1,
      redaction: "metadata",
    });
    await expect(first.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 1,
      lastSequence: 1,
    });
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(
      reopened.appendPrivilegedAudit(
        createAuditInput("audit-platform-2", "2026-07-28T09:00:01.000Z"),
      ),
    ).resolves.toMatchObject({
      sequence: 2,
    });
    await expect(reopened.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 2,
      lastSequence: 2,
    });
    await expect(
      reopened.appendPrivilegedAudit(
        createAuditInput("audit-platform-2", "2026-07-28T09:00:02.000Z"),
      ),
    ).rejects.toMatchObject({
      code: "evidence-conflict",
    });
    await reopened.close();
  });

  it("persists immutable terminal evidence idempotently without incident text", async () => {
    const userDataPath = createTestDirectory();
    const evidence = createAttemptEvidence();
    const evidenceWithExplicitUndefined = {
      ...evidence,
      restartedFromSessionId: undefined,
      replacementSessionId: undefined,
    } as unknown as AgentAttemptEvidence;
    const persistence = openSqliteCorePersistence(userDataPath);

    await expect(
      persistence.appendAgentAttemptEvidence({
        ...evidence,
        incident: {
          ...evidence.incident,
          message: "operator visible detail",
        },
      } as unknown as AgentAttemptEvidence),
    ).rejects.toMatchObject({
      code: "invalid-record",
    });
    await expect(
      persistence.appendAgentAttemptEvidence(evidenceWithExplicitUndefined),
    ).resolves.toEqual({
      status: "appended",
    });
    await expect(
      persistence.appendAgentAttemptEvidence(evidenceWithExplicitUndefined),
    ).resolves.toEqual({
      status: "duplicate",
    });
    await expect(
      persistence.appendAgentAttemptEvidence({
        ...evidence,
        state: "failed",
      }),
    ).rejects.toMatchObject({
      code: "evidence-conflict",
    });
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.listRecentAgentAttemptEvidence(50)).resolves.toEqual([evidence]);
    expect(JSON.stringify(await reopened.listRecentAgentAttemptEvidence(50))).not.toContain(
      "message",
    );
    await expect(reopened.listRecentAgentAttemptEvidence(0)).rejects.toMatchObject({
      code: "invalid-record",
    });
    await reopened.close();
  });

  it("round-trips bounded resource incident metadata and rejects extra private fields", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    const resource = {
      workerKind: "general",
      attemptId: sessionId("session-platform-resource"),
      code: "worker-resource-memory-exceeded",
      resourceKind: "private-memory",
      observed: 536_870_913,
      limit: 536_870_912,
      termination: "forced",
    } as const;
    const evidence = createAttemptEvidence({
      sessionId: resource.attemptId,
      state: "failed",
      taskState: "failed",
      incident: {
        code: resource.code,
        occurredAt: instant("2026-07-28T09:00:02.000Z"),
        resource,
      },
    } as unknown as Partial<AgentAttemptEvidence>);

    await expect(persistence.appendAgentAttemptEvidence(evidence)).resolves.toEqual({
      status: "appended",
    });
    await expect(persistence.listRecentAgentAttemptEvidence(50)).resolves.toEqual([evidence]);
    await expect(
      persistence.appendAgentAttemptEvidence({
        ...evidence,
        sessionId: sessionId("session-platform-resource-private"),
        incident: {
          ...evidence.incident,
          resource: {
            ...resource,
            attemptId: sessionId("session-platform-resource-private"),
            path: "/private/workspace",
          },
        },
      } as unknown as AgentAttemptEvidence),
    ).rejects.toMatchObject({ code: "invalid-record" });
    await persistence.close();
  });

  it("rejects a corrupted indexed evidence projection", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.appendAgentAttemptEvidence(createAttemptEvidence());
    await persistence.close();

    const database = new DatabaseSync(resolveCoreDatabasePath(userDataPath));
    database
      .prepare("UPDATE agent_attempt_evidence SET state = ? WHERE session_id = ?")
      .run("failed", "session-platform");
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.listRecentAgentAttemptEvidence(50)).rejects.toMatchObject({
      code: "corrupt-database",
    });
    await reopened.close();
  });
});
