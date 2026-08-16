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
  toolRequestId,
  workerId,
  workspaceId,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
} from "../../apps/desktop/src/core";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  CORE_SQLITE_MIGRATIONS,
  migrateSqliteDatabase,
} from "../../apps/desktop/src/utility/persistence/sqliteMigrations";
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

function createRequestAuditInput(
  record: string,
  request: string,
  occurredAt: string,
  type: "policy.evaluated" | "tool.started" | "tool.completed" | "tool.failed",
): AppendPrivilegedAuditInput {
  const operation = createProtectedOperation({ requestId: toolRequestId(request) });
  const context = auditContextFor(operation);
  const event: AppendPrivilegedAuditInput["event"] =
    type === "policy.evaluated"
      ? {
          type,
          context,
          policyRevision: policyRevision("policy-main-deny-v1"),
          decision: "deny",
          reasonCode: "no-matching-rule",
          matchedRuleIds: [],
        }
      : type === "tool.started"
        ? {
            type,
            context,
            authorizationMethod: "policy",
          }
        : type === "tool.completed"
          ? {
              type,
              context,
            }
          : {
              type,
              context,
              errorCode: "workspace-unavailable",
              mayHaveExecuted: false,
            };
  return {
    recordId: auditRecordId(record),
    occurredAt: instant(occurredAt),
    event,
  };
}

function openRawDatabase(userDataPath: string): DatabaseSync {
  fs.mkdirSync(path.dirname(resolveCoreDatabasePath(userDataPath)), {
    recursive: true,
    mode: 0o700,
  });
  return new DatabaseSync(resolveCoreDatabasePath(userDataPath), {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
  });
}

function seedSchema22Audit(
  userDataPath: string,
  inputs: readonly AppendPrivilegedAuditInput[],
): void {
  const database = openRawDatabase(userDataPath);
  migrateSqliteDatabase(database, CORE_SQLITE_MIGRATIONS.slice(0, 22), "2026-08-16T00:00:00.000Z");
  const insert = database.prepare(
    `INSERT INTO privileged_audit_records (
       sequence, record_id, occurred_at, request_id, workspace_id, task_id,
       session_id, worker_id, tool_id, action, resource_kind, event_type,
       redaction, record_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  inputs.forEach((input, index) => {
    const record = {
      contractVersion: 1,
      recordId: input.recordId,
      sequence: index + 1,
      occurredAt: input.occurredAt,
      redaction: "metadata",
      event: input.event,
    } as const;
    insert.run(
      record.sequence,
      record.recordId,
      record.occurredAt,
      record.event.context.requestId,
      record.event.context.workspaceId,
      record.event.context.taskId,
      record.event.context.sessionId,
      record.event.context.workerId,
      record.event.context.toolId,
      record.event.context.action,
      record.event.context.resourceKind,
      record.event.type,
      record.redaction,
      JSON.stringify(record),
    );
  });
  database.close();
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
  it("initializes and reopens a SHA-256 chain for legacy schema-22 audit rows", async () => {
    const userDataPath = createTestDirectory();
    seedSchema22Audit(userDataPath, [
      createRequestAuditInput(
        "audit-legacy-1",
        "request-legacy",
        "2026-07-28T09:00:00.000Z",
        "tool.started",
      ),
      createRequestAuditInput(
        "audit-legacy-2",
        "request-legacy",
        "2026-07-28T09:00:01.000Z",
        "tool.completed",
      ),
    ]);

    const persistence = openSqliteCorePersistence(userDataPath);
    await expect(persistence.listRecentPrivilegedAudit(1_000)).resolves.toMatchObject([
      { sequence: 2, recordId: "audit-legacy-2" },
      { sequence: 1, recordId: "audit-legacy-1" },
    ]);
    await expect(persistence.readPrivilegedAuditRetentionState()).resolves.toMatchObject({
      retainedRecordCount: 2,
      prunedRecordCount: 0,
      firstRetainedSequence: 1,
      lastSequence: 2,
    });
    await persistence.close();

    const database = openRawDatabase(userDataPath);
    const integrity = database
      .prepare(
        `SELECT sequence, previous_sha256, chain_sha256
         FROM privileged_audit_integrity
         ORDER BY sequence`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(integrity).toHaveLength(2);
    expect(integrity[0]?.previous_sha256).toBe(
      "4eab5dc1aa1804c942a382c85b6c77673f44b46cae57082957c1ffc0a9af61c1",
    );
    expect(integrity[1]?.previous_sha256).toBe(integrity[0]?.chain_sha256);
    database.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 2,
      lastSequence: 2,
    });
    await reopened.close();
  });

  it("fails closed when an audit row or chain digest is tampered", async () => {
    for (const tamper of ["record", "digest"] as const) {
      const userDataPath = createTestDirectory();
      const persistence = openSqliteCorePersistence(userDataPath);
      await persistence.appendPrivilegedAudit(
        createRequestAuditInput(
          `audit-tamper-${tamper}`,
          `request-tamper-${tamper}`,
          "2026-07-28T09:00:00.000Z",
          "tool.completed",
        ),
      );
      await persistence.close();

      const database = openRawDatabase(userDataPath);
      if (tamper === "record") {
        database
          .prepare(
            `UPDATE privileged_audit_records
             SET record_id = ?, record_json = replace(record_json, ?, ?)
             WHERE sequence = 1`,
          )
          .run("audit-tampered", `audit-tamper-${tamper}`, "audit-tampered");
      } else {
        database
          .prepare("UPDATE privileged_audit_integrity SET chain_sha256 = ? WHERE sequence = 1")
          .run("b".repeat(64));
      }
      database.close();

      expect(() => openSqliteCorePersistence(userDataPath)).toThrowError(
        expect.objectContaining({ code: "corrupt-database" }),
      );
    }
  });

  it("prunes only a terminal contiguous prefix and preserves unresolved request groups", async () => {
    const userDataPath = createTestDirectory();
    const persistence = openSqliteCorePersistence(userDataPath);
    await persistence.appendPrivilegedAudit(
      createRequestAuditInput(
        "audit-terminal-1",
        "request-terminal",
        "2026-07-01T00:00:00.000Z",
        "policy.evaluated",
      ),
    );
    await persistence.appendPrivilegedAudit(
      createRequestAuditInput(
        "audit-terminal-2",
        "request-terminal",
        "2026-07-01T00:00:01.000Z",
        "tool.completed",
      ),
    );
    await persistence.appendPrivilegedAudit(
      createRequestAuditInput(
        "audit-unresolved",
        "request-unresolved",
        "2026-07-01T00:00:02.000Z",
        "tool.started",
      ),
    );
    await persistence.appendPrivilegedAudit(
      createRequestAuditInput(
        "audit-terminal-after-gap",
        "request-terminal-after-gap",
        "2026-07-01T00:00:03.000Z",
        "tool.completed",
      ),
    );

    await expect(
      persistence.maintainPrivilegedAudit(instant("2026-12-01T00:00:00.000Z")),
    ).resolves.toMatchObject({
      retainedRecordCount: 2,
      prunedRecordCount: 2,
      firstRetainedSequence: 3,
      lastSequence: 4,
      lastMaintainedAt: "2026-12-01T00:00:00.000Z",
    });
    await expect(persistence.listRecentPrivilegedAudit(1_000)).resolves.toMatchObject([
      { sequence: 4, recordId: "audit-terminal-after-gap" },
      { sequence: 3, recordId: "audit-unresolved" },
    ]);
    await expect(persistence.summarizePrivilegedAudit()).resolves.toEqual({
      recordCount: 4,
      lastSequence: 4,
    });
    await expect(
      persistence.appendPrivilegedAudit(
        createRequestAuditInput(
          "audit-after-prune",
          "request-after-prune",
          "2026-12-01T00:00:01.000Z",
          "tool.completed",
        ),
      ),
    ).resolves.toMatchObject({ sequence: 5 });
    await persistence.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.readPrivilegedAuditRetentionState()).resolves.toMatchObject({
      retainedRecordCount: 3,
      prunedRecordCount: 2,
      firstRetainedSequence: 3,
      lastSequence: 5,
    });
    await reopened.close();
  });

  it("deletes nothing when the hard cap cannot be met without pruning an unresolved group", async () => {
    const userDataPath = createTestDirectory();
    const database = openRawDatabase(userDataPath);
    migrateSqliteDatabase(
      database,
      CORE_SQLITE_MIGRATIONS.slice(0, 22),
      "2026-08-16T00:00:00.000Z",
    );
    database.exec(`
        WITH RECURSIVE audit_sequence(value) AS (
          SELECT 1
          UNION ALL
          SELECT value + 1 FROM audit_sequence WHERE value < 100001
        )
        INSERT INTO privileged_audit_records (
          sequence, record_id, occurred_at, request_id, workspace_id, task_id,
          session_id, worker_id, tool_id, action, resource_kind, event_type,
          redaction, record_json
        )
        SELECT
          value,
          'audit-hard-cap-' || value,
          '2026-07-01T00:00:00.000Z',
          'request-hard-cap',
          'workspace-privileged',
          'task-privileged',
          'session-privileged',
          'worker-privileged',
          'tool-workspace-read',
          'workspace.read',
          'workspace',
          'tool.started',
          'metadata',
          json_object(
            'contractVersion', 1,
            'recordId', 'audit-hard-cap-' || value,
            'sequence', value,
            'occurredAt', '2026-07-01T00:00:00.000Z',
            'redaction', 'metadata',
            'event', json_object(
              'type', 'tool.started',
              'context', json_object(
                'requestId', 'request-hard-cap',
                'workspaceId', 'workspace-privileged',
                'taskId', 'task-privileged',
                'sessionId', 'session-privileged',
                'workerId', 'worker-privileged',
                'toolId', 'tool-workspace-read',
                'action', 'workspace.read',
                'resourceKind', 'workspace'
              ),
              'authorizationMethod', 'policy'
            )
          )
        FROM audit_sequence;
      `);
    database.close();

    const persistence = openSqliteCorePersistence(userDataPath);
    await expect(
      persistence.maintainPrivilegedAudit(instant("2026-12-01T00:00:00.000Z")),
    ).rejects.toMatchObject({ code: "corrupt-database" });
    await persistence.close();

    const verification = openRawDatabase(userDataPath);
    expect(
      verification.prepare("SELECT COUNT(*) AS count FROM privileged_audit_records").get(),
    ).toEqual({ count: 100_001 });
    verification.close();
  }, 30_000);

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
