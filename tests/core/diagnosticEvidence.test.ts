import { describe, expect, it } from "vitest";
import {
  AUDIT_RETENTION_POLICY,
  DIAGNOSTIC_EXPORT_EXCLUSIONS,
  DIAGNOSTIC_EXPORT_MAX_ATTEMPTS,
  DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS,
  DIAGNOSTIC_EXPORT_MAX_BYTES,
  assertDiagnosticExportReport,
  assertPrivilegedAuditRetentionState,
  type DiagnosticExportReport,
  type PrivilegedAuditRetentionState,
} from "../../apps/desktop/src/core/diagnosticEvidence";
import { instant } from "../../apps/desktop/src/core/domain";

const SHA256 = "a".repeat(64);

function retention(
  overrides: Partial<PrivilegedAuditRetentionState> = {},
): PrivilegedAuditRetentionState {
  return {
    contractVersion: 1,
    policyVersion: 1,
    maxAgeDays: 90,
    maxRecordCount: 100_000,
    retainedRecordCount: 2,
    prunedRecordCount: 3,
    firstRetainedSequence: 4,
    lastSequence: 5,
    chainHeadSha256: SHA256,
    lastMaintainedAt: instant("2026-08-16T06:00:00.000Z"),
    ...overrides,
  };
}

function report(): DiagnosticExportReport {
  return {
    schemaVersion: 1,
    generatedAt: instant("2026-08-16T06:00:00.000Z"),
    redaction: "metadata-only",
    app: {
      name: "Actestra",
      version: "0.1.0-alpha.0",
      platform: "darwin",
      arch: "arm64",
      environment: "packaged",
    },
    audit: {
      retention: retention(),
      exportedRecordCount: 1,
      truncated: true,
      events: [
        {
          sequence: 5,
          occurredAt: instant("2026-08-16T05:59:00.000Z"),
          requestAlias: "request-0001",
          type: "tool.failed",
          action: "workspace.read",
          resourceKind: "workspace",
          outcomeCode: "workspace-unavailable",
          mayHaveExecuted: false,
        },
      ],
    },
    attempts: {
      exportedRecordCount: 1,
      truncated: false,
      records: [
        {
          attemptAlias: "attempt-0001",
          state: "failed",
          taskState: "failed",
          startedAt: instant("2026-08-16T05:58:00.000Z"),
          lastSignalAt: instant("2026-08-16T05:59:00.000Z"),
          restartCount: 0,
          forcedCancellation: false,
          incidentCode: "workspace-unavailable",
        },
      ],
    },
    exclusions: DIAGNOSTIC_EXPORT_EXCLUSIONS,
  };
}

describe("P7.4 diagnostic evidence contract", () => {
  it("locks the bounded production policy", () => {
    expect(AUDIT_RETENTION_POLICY).toEqual({
      contractVersion: 1,
      policyVersion: 1,
      maxAgeDays: 90,
      maxRecordCount: 100_000,
    });
    expect(DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS).toBe(1_000);
    expect(DIAGNOSTIC_EXPORT_MAX_ATTEMPTS).toBe(50);
    expect(DIAGNOSTIC_EXPORT_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("accepts a consistent retention anchor and rejects sequence drift", () => {
    expect(() => assertPrivilegedAuditRetentionState(retention())).not.toThrow();
    expect(() => assertPrivilegedAuditRetentionState(retention({ lastSequence: 6 }))).toThrow(
      /sequence/i,
    );
    expect(() =>
      assertPrivilegedAuditRetentionState(
        retention({ retainedRecordCount: 0, firstRetainedSequence: 4, lastSequence: 3 }),
      ),
    ).toThrow(/first retained/i);
    expect(() =>
      assertPrivilegedAuditRetentionState(retention({ chainHeadSha256: "not-a-digest" })),
    ).toThrow(/sha-256/i);
  });

  it("accepts only bounded metadata aliases and closed report keys", () => {
    const value = report();
    expect(() => assertDiagnosticExportReport(value)).not.toThrow();

    expect(() =>
      assertDiagnosticExportReport({ ...value, workspacePath: "/private/workspace" }),
    ).toThrow(/unsupported field/i);
    expect(() =>
      assertDiagnosticExportReport({
        ...value,
        audit: {
          ...value.audit,
          events: [{ ...value.audit.events[0], requestAlias: "request-secret-real-id" }],
        },
      }),
    ).toThrow(/alias/i);
    expect(() =>
      assertDiagnosticExportReport({
        ...value,
        attempts: {
          ...value.attempts,
          records: [
            {
              ...value.attempts.records[0],
              sessionId: "session-real-id",
            },
          ],
        },
      }),
    ).toThrow(/unsupported field/i);
  });

  it("rejects oversized event and attempt collections", () => {
    const value = report();
    expect(() =>
      assertDiagnosticExportReport({
        ...value,
        audit: {
          ...value.audit,
          exportedRecordCount: DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS + 1,
          events: Array.from(
            { length: DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS + 1 },
            () => value.audit.events[0],
          ),
        },
      }),
    ).toThrow(/audit events/i);
    expect(() =>
      assertDiagnosticExportReport({
        ...value,
        attempts: {
          ...value.attempts,
          exportedRecordCount: DIAGNOSTIC_EXPORT_MAX_ATTEMPTS + 1,
          records: Array.from(
            { length: DIAGNOSTIC_EXPORT_MAX_ATTEMPTS + 1 },
            () => value.attempts.records[0],
          ),
        },
      }),
    ).toThrow(/attempt/i);
  });
});
