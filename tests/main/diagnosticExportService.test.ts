// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_EXPORT_MAX_BYTES,
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  auditContextFor,
  auditRecordId,
  correlationId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceId,
  type AgentAttemptEvidence,
  type AuditRecord,
  type PrivilegedAuditRetentionState,
} from "../../apps/desktop/src/core";
import {
  DiagnosticExportService,
  assertDiagnosticExportEncodedSize,
  type DiagnosticExportPersistencePort,
} from "../../apps/desktop/src/main/diagnostics/diagnosticExportService";
import { createProtectedOperation } from "../fixtures/privilegedServices";

const testDirectories: string[] = [];

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-diagnostic-export-test-"));
  testDirectories.push(directory);
  return directory;
}

function retention(): PrivilegedAuditRetentionState {
  return {
    contractVersion: 1,
    policyVersion: 1,
    maxAgeDays: 90,
    maxRecordCount: 100_000,
    retainedRecordCount: 2,
    prunedRecordCount: 3,
    firstRetainedSequence: 4,
    lastSequence: 5,
    chainHeadSha256: "a".repeat(64),
    lastMaintainedAt: instant("2026-08-16T08:00:00.000Z"),
  };
}

function auditRecords(): readonly AuditRecord[] {
  const completedOperation = createProtectedOperation({
    requestId: toolRequestId("request-secret-completed"),
    workspaceId: workspaceId("workspace-secret-diagnostic"),
    taskId: taskId("task-secret-diagnostic"),
    sessionId: sessionId("session-secret-diagnostic"),
    workerId: workerId("worker-secret-diagnostic"),
  });
  const failedOperation = createProtectedOperation({
    requestId: toolRequestId("request-secret-failed"),
    workspaceId: workspaceId("workspace-secret-diagnostic"),
    taskId: taskId("task-secret-diagnostic"),
    sessionId: sessionId("session-secret-diagnostic"),
    workerId: workerId("worker-secret-diagnostic"),
  });
  return [
    {
      contractVersion: 1,
      recordId: auditRecordId("record-secret-5"),
      sequence: 5,
      occurredAt: instant("2026-08-16T07:59:59.000Z"),
      redaction: "metadata",
      event: {
        type: "tool.failed",
        context: auditContextFor(failedOperation),
        errorCode: "workspace-unavailable",
        mayHaveExecuted: false,
      },
    },
    {
      contractVersion: 1,
      recordId: auditRecordId("record-secret-4"),
      sequence: 4,
      occurredAt: instant("2026-08-16T07:59:58.000Z"),
      redaction: "metadata",
      event: {
        type: "tool.completed",
        context: auditContextFor(completedOperation),
        outputRef: toolOutputReference("tool-output-secret-patch"),
      },
    },
  ];
}

function attemptEvidence(): readonly AgentAttemptEvidence[] {
  return [
    {
      contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
      redaction: "metadata",
      workspaceId: workspaceId("workspace-secret-diagnostic"),
      taskId: taskId("task-secret-diagnostic"),
      correlationId: correlationId("correlation-secret-diagnostic"),
      sessionId: sessionId("attempt-secret-diagnostic"),
      workerId: workerId("worker-secret-diagnostic"),
      streamId: eventStreamId("stream-secret-diagnostic"),
      state: "failed",
      taskState: "failed",
      startedAt: instant("2026-08-16T07:58:00.000Z"),
      lastSignalAt: instant("2026-08-16T07:59:00.000Z"),
      lastControlSequence: 2,
      lastCoreEventSequence: 3,
      restartCount: 1,
      restartedFromSessionId: sessionId("previous-attempt-secret-diagnostic"),
      disposed: true,
      forcedCancellation: false,
      incident: {
        code: "workspace-unavailable",
        occurredAt: instant("2026-08-16T07:59:00.000Z"),
      },
    },
  ];
}

function persistence(): DiagnosticExportPersistencePort & {
  readonly maintainPrivilegedAudit: ReturnType<typeof vi.fn>;
  readonly listRecentPrivilegedAudit: ReturnType<typeof vi.fn>;
  readonly listRecentAgentAttemptEvidence: ReturnType<typeof vi.fn>;
} {
  return {
    maintainPrivilegedAudit: vi.fn(async () => retention()),
    listRecentPrivilegedAudit: vi.fn(async () => auditRecords()),
    listRecentAgentAttemptEvidence: vi.fn(async () => attemptEvidence()),
  };
}

function service(
  evidence: DiagnosticExportPersistencePort,
  destination: string,
): DiagnosticExportService {
  return new DiagnosticExportService({
    persistence: evidence,
    clock: { now: () => instant("2026-08-16T08:00:00.000Z") },
    app: {
      name: "Actestra",
      version: "0.1.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      environment: "packaged",
    },
    saveDialog: {
      showSaveDialog: vi.fn(async () => ({ cancelled: false, filePath: destination })),
    },
    aliasSalt: () => new Uint8Array(32).fill(7),
    temporaryId: () => "fixed-temporary-id",
  });
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-diagnostic-export-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("P7.4 diagnostic export service", () => {
  it("writes one private atomic metadata-only report without raw evidence identities", async () => {
    const directory = createTestDirectory();
    const destination = path.join(directory, "actestra-diagnostics.json");
    const evidence = persistence();

    await expect(service(evidence, destination).exportReport()).resolves.toEqual({
      status: "saved",
    });
    const encoded = fs.readFileSync(destination, "utf8");
    const report = JSON.parse(encoded) as Record<string, unknown>;
    expect(report).toMatchObject({
      schemaVersion: 1,
      redaction: "metadata-only",
      audit: {
        exportedRecordCount: 2,
        truncated: false,
        events: [
          {
            sequence: 5,
            requestAlias: expect.stringMatching(/^request-\d{4}$/u),
            outcomeCode: "workspace-unavailable",
            mayHaveExecuted: false,
          },
          {
            sequence: 4,
            requestAlias: expect.stringMatching(/^request-\d{4}$/u),
            outcomeCode: null,
            mayHaveExecuted: true,
          },
        ],
      },
      attempts: {
        exportedRecordCount: 1,
        records: [
          {
            attemptAlias: expect.stringMatching(/^attempt-\d{4}$/u),
            state: "failed",
            incidentCode: "workspace-unavailable",
          },
        ],
      },
    });
    for (const forbidden of [
      "request-secret",
      "workspace-secret",
      "task-secret",
      "session-secret",
      "worker-secret",
      "attempt-secret",
      "correlation-secret",
      "stream-secret",
      "record-secret",
      "tool-output-secret-patch",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
    expect(fs.statSync(destination).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(directory)).toEqual(["actestra-diagnostics.json"]);
    expect(evidence.maintainPrivilegedAudit).toHaveBeenCalledWith(
      instant("2026-08-16T08:00:00.000Z"),
    );
    expect(evidence.listRecentPrivilegedAudit).toHaveBeenCalledWith(1_000);
    expect(evidence.listRecentAgentAttemptEvidence).toHaveBeenCalledWith(50);
  });

  it("does not read evidence or create a file when the native save is cancelled", async () => {
    const directory = createTestDirectory();
    const evidence = persistence();
    const exporter = new DiagnosticExportService({
      persistence: evidence,
      clock: { now: () => instant("2026-08-16T08:00:00.000Z") },
      app: {
        name: "Actestra",
        version: "0.1.0-alpha.0",
        platform: "darwin",
        arch: "arm64",
        environment: "packaged",
      },
      saveDialog: {
        showSaveDialog: vi.fn(async () => ({ cancelled: true }) as const),
      },
      aliasSalt: () => new Uint8Array(32).fill(7),
      temporaryId: () => "fixed-temporary-id",
    });

    await expect(exporter.exportReport()).resolves.toEqual({ status: "cancelled" });
    expect(evidence.maintainPrivilegedAudit).not.toHaveBeenCalled();
    expect(evidence.listRecentPrivilegedAudit).not.toHaveBeenCalled();
    expect(evidence.listRecentAgentAttemptEvidence).not.toHaveBeenCalled();
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("rejects a destination symlink without touching its target or reading evidence", async () => {
    const directory = createTestDirectory();
    const target = path.join(directory, "target.json");
    const destination = path.join(directory, "diagnostics.json");
    fs.writeFileSync(target, "preserve me", { mode: 0o600 });
    fs.symlinkSync(target, destination);
    const evidence = persistence();

    await expect(service(evidence, destination).exportReport()).resolves.toEqual({
      status: "rejected",
    });
    expect(fs.readFileSync(target, "utf8")).toBe("preserve me");
    expect(fs.lstatSync(destination).isSymbolicLink()).toBe(true);
    expect(evidence.maintainPrivilegedAudit).not.toHaveBeenCalled();
  });

  it("returns one stable rejected status when the native dialog fails", async () => {
    const evidence = persistence();
    const exporter = new DiagnosticExportService({
      persistence: evidence,
      clock: { now: () => instant("2026-08-16T08:00:00.000Z") },
      app: {
        name: "Actestra",
        version: "0.1.0-alpha.0",
        platform: "darwin",
        arch: "arm64",
        environment: "packaged",
      },
      saveDialog: {
        showSaveDialog: vi.fn(async () => {
          throw new Error("EACCES /private/profile");
        }),
      },
      aliasSalt: () => new Uint8Array(32).fill(7),
      temporaryId: () => "fixed-temporary-id",
    });

    await expect(exporter.exportReport()).resolves.toEqual({ status: "rejected" });
    expect(evidence.maintainPrivilegedAudit).not.toHaveBeenCalled();
  });

  it("enforces the encoded 2 MiB report bound", () => {
    expect(() => assertDiagnosticExportEncodedSize(DIAGNOSTIC_EXPORT_MAX_BYTES)).not.toThrow();
    expect(() => assertDiagnosticExportEncodedSize(DIAGNOSTIC_EXPORT_MAX_BYTES + 1)).toThrow(
      /size/i,
    );
  });
});
