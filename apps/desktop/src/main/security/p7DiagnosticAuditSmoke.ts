import fs from "node:fs";
import path from "node:path";
import {
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  PRIVILEGED_CONTRACT_VERSION,
  assertAuditRecord,
  assertDiagnosticExportReport,
  auditContextFor,
  auditRecordId,
  correlationId,
  eventStreamId,
  instant,
  policyRevision,
  sessionId,
  taskId,
  toolId,
  toolInputReference,
  toolOutputReference,
  toolRequestId,
  workerId,
  workspaceId,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type DiagnosticExportReport,
  type PlatformEvidencePersistencePort,
  type ProtectedOperation,
} from "../../core";
import { DiagnosticExportService } from "../diagnostics/diagnosticExportService";

export const P7_DIAGNOSTIC_AUDIT_SMOKE_MARKER = "ACTESTRA_P7_DIAGNOSTIC_AUDIT_RESULT " as const;
export const P7_DIAGNOSTIC_AUDIT_SMOKE_DATABASE_SCHEMA_VERSION = 23 as const;
const P7_DIAGNOSTIC_AUDIT_SMOKE_NOW = instant("2026-12-01T00:00:00.000Z");

export interface P7DiagnosticAuditSmokeIsolation {
  readonly root: string;
  readonly userData: string;
  readonly home: string;
  readonly temp: string;
  readonly report: string;
  readonly evidence: string;
}

export interface P7DiagnosticAuditSmokeResult {
  readonly databaseSchemaVersion: typeof P7_DIAGNOSTIC_AUDIT_SMOKE_DATABASE_SCHEMA_VERSION;
  readonly reportSchemaVersion: 1;
  readonly policyVersion: 1;
  readonly prunedRecordCount: 2;
  readonly retainedRecordCount: 2;
  readonly unresolvedPreserved: true;
  readonly chainVerified: true;
  readonly reportPrivate: true;
  readonly redacted: true;
}

export interface P7DiagnosticAuditSmokeConfig {
  readonly isolation: P7DiagnosticAuditSmokeIsolation;
  readonly persistence: PlatformEvidencePersistencePort;
  readonly app: DiagnosticExportReport["app"];
}

function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}

function isRealDirectory(filePath: string): boolean {
  const state = fs.lstatSync(filePath, { throwIfNoEntry: false });
  return state?.isDirectory() === true && !state.isSymbolicLink();
}

function isAbsent(filePath: string): boolean {
  return fs.lstatSync(filePath, { throwIfNoEntry: false }) === undefined;
}

export function resolveP7DiagnosticAuditSmokeIsolation(
  environment: Readonly<Record<string, string | undefined>>,
): P7DiagnosticAuditSmokeIsolation | null {
  if (
    environment.ACTESTRA_E2E_TEST !== "1" ||
    environment.ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE !== "1"
  ) {
    return null;
  }
  const root = environment.ACTESTRA_E2E_ISOLATION_ROOT?.trim();
  const userData = environment.ACTESTRA_USER_DATA_DIR?.trim();
  const home = environment.ACTESTRA_E2E_HOME_DIR?.trim();
  const temp = environment.ACTESTRA_E2E_TEMP_DIR?.trim();
  const report = environment.ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT?.trim();
  const evidence = environment.ACTESTRA_P7_DIAGNOSTIC_AUDIT_EVIDENCE?.trim();
  if (
    root === undefined ||
    userData === undefined ||
    home === undefined ||
    temp === undefined ||
    report === undefined ||
    evidence === undefined ||
    report === evidence ||
    ![root, userData, home, temp, report, evidence].every(path.isAbsolute) ||
    !isRealDirectory(root) ||
    ![userData, home, temp].every(
      (candidate) => isStrictlyInside(root, candidate) && isRealDirectory(candidate),
    ) ||
    ![report, evidence].every(
      (candidate) =>
        isStrictlyInside(root, candidate) &&
        isRealDirectory(path.dirname(candidate)) &&
        isAbsent(candidate),
    )
  ) {
    return null;
  }
  const realRoot = fs.realpathSync(root);
  if (
    ![userData, home, temp].every((candidate) =>
      isStrictlyInside(realRoot, fs.realpathSync(candidate)),
    ) ||
    ![report, evidence].every((candidate) =>
      isStrictlyInside(
        realRoot,
        path.join(fs.realpathSync(path.dirname(candidate)), path.basename(candidate)),
      ),
    )
  ) {
    return null;
  }
  return Object.freeze({ root, userData, home, temp, report, evidence });
}

function operation(request: string, requestedAt: string): ProtectedOperation {
  return Object.freeze({
    contractVersion: PRIVILEGED_CONTRACT_VERSION,
    requestId: toolRequestId(request),
    workspaceId: workspaceId("workspace-p7-diagnostic-private"),
    taskId: taskId("task-p7-diagnostic-private"),
    sessionId: sessionId("session-p7-diagnostic-private"),
    workerId: workerId("worker-p7-diagnostic-private"),
    toolId: toolId("tool-p7-diagnostic-private"),
    inputRef: toolInputReference("tool-input-p7-diagnostic-private"),
    action: "workspace.read",
    resourceKind: "workspace",
    summary: "Exercise packaged P7.4 metadata-only audit retention",
    credentialRefs: [],
    requestedAt: instant(requestedAt),
  });
}

function auditInput(
  record: string,
  request: string,
  occurredAt: string,
  type: "policy.evaluated" | "tool.started" | "tool.completed",
): AppendPrivilegedAuditInput {
  const context = auditContextFor(operation(request, occurredAt));
  const event: AppendPrivilegedAuditInput["event"] =
    type === "policy.evaluated"
      ? {
          type,
          context,
          policyRevision: policyRevision("policy-p7-diagnostic-deny-v1"),
          decision: "deny",
          reasonCode: "no-matching-rule",
          matchedRuleIds: [],
        }
      : type === "tool.started"
        ? { type, context, authorizationMethod: "policy" }
        : {
            type,
            context,
            outputRef: toolOutputReference("tool-output-p7-diagnostic-private"),
          };
  return Object.freeze({
    recordId: auditRecordId(record),
    occurredAt: instant(occurredAt),
    event,
  });
}

async function appendFixtureAudit(
  persistence: PlatformEvidencePersistencePort,
  input: AppendPrivilegedAuditInput,
  sequence: number,
): Promise<void> {
  const record = await persistence.appendPrivilegedAudit(input);
  assertAuditRecord(record);
  if (record.sequence !== sequence || record.recordId !== input.recordId) {
    throw new Error("P7.4 diagnostic audit fixture did not start from a fresh sequence");
  }
}

function attemptEvidence(): AgentAttemptEvidence {
  return Object.freeze({
    contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
    redaction: "metadata",
    workspaceId: workspaceId("workspace-p7-diagnostic-private"),
    taskId: taskId("task-p7-diagnostic-private"),
    correlationId: correlationId("correlation-p7-diagnostic-private"),
    sessionId: sessionId("session-p7-diagnostic-attempt"),
    workerId: workerId("worker-p7-diagnostic-private"),
    streamId: eventStreamId("stream-p7-diagnostic-private"),
    state: "failed",
    taskState: "failed",
    startedAt: instant("2026-11-30T00:00:00.000Z"),
    lastSignalAt: instant("2026-11-30T00:01:00.000Z"),
    lastControlSequence: 1,
    lastCoreEventSequence: 1,
    restartCount: 0,
    disposed: true,
    forcedCancellation: false,
    incident: Object.freeze({
      code: "workspace-unavailable",
      occurredAt: instant("2026-11-30T00:01:00.000Z"),
    }),
  });
}

function assertPrivateRegularFile(filePath: string): void {
  const state = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (
    state === undefined ||
    !state.isFile() ||
    state.isSymbolicLink() ||
    (state.mode & 0o077) !== 0
  ) {
    throw new Error("P7.4 diagnostic smoke output is not a private regular file");
  }
}

function exactResult(): P7DiagnosticAuditSmokeResult {
  return Object.freeze({
    databaseSchemaVersion: P7_DIAGNOSTIC_AUDIT_SMOKE_DATABASE_SCHEMA_VERSION,
    reportSchemaVersion: 1,
    policyVersion: 1,
    prunedRecordCount: 2,
    retainedRecordCount: 2,
    unresolvedPreserved: true,
    chainVerified: true,
    reportPrivate: true,
    redacted: true,
  });
}

export function assertP7DiagnosticAuditSmokeResult(
  value: unknown,
): asserts value is P7DiagnosticAuditSmokeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("P7.4 diagnostic audit smoke result is invalid");
  }
  const record = value as Record<string, unknown>;
  const expected = exactResult() as unknown as Record<string, unknown>;
  const keys = Object.keys(expected);
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key) || record[key] !== expected[key])
  ) {
    throw new Error("P7.4 diagnostic audit smoke result is invalid");
  }
}

export async function runP7PackagedDiagnosticAuditSmoke(
  config: P7DiagnosticAuditSmokeConfig,
): Promise<P7DiagnosticAuditSmokeResult> {
  const { isolation, persistence } = config;
  await appendFixtureAudit(
    persistence,
    auditInput(
      "audit-p7-diagnostic-terminal-policy",
      "request-p7-diagnostic-terminal",
      "2026-07-01T00:00:00.000Z",
      "policy.evaluated",
    ),
    1,
  );
  await appendFixtureAudit(
    persistence,
    auditInput(
      "audit-p7-diagnostic-terminal-outcome",
      "request-p7-diagnostic-terminal",
      "2026-07-01T00:00:01.000Z",
      "tool.completed",
    ),
    2,
  );
  await appendFixtureAudit(
    persistence,
    auditInput(
      "audit-p7-diagnostic-unresolved",
      "request-p7-diagnostic-unresolved",
      "2026-07-01T00:00:02.000Z",
      "tool.started",
    ),
    3,
  );
  await appendFixtureAudit(
    persistence,
    auditInput(
      "audit-p7-diagnostic-recent",
      "request-p7-diagnostic-recent",
      "2026-11-30T00:00:00.000Z",
      "tool.completed",
    ),
    4,
  );
  const attempt = attemptEvidence();
  const attemptResult = await persistence.appendAgentAttemptEvidence(attempt);
  if (attemptResult.status !== "appended") {
    throw new Error("P7.4 diagnostic attempt fixture was not appended");
  }

  const exporter = new DiagnosticExportService({
    persistence,
    clock: { now: () => P7_DIAGNOSTIC_AUDIT_SMOKE_NOW },
    app: config.app,
    saveDialog: {
      showSaveDialog: async () => ({ cancelled: false, filePath: isolation.report }),
    },
  });
  const exportResult = await exporter.exportReport();
  if (exportResult.status !== "saved") {
    throw new Error("P7.4 packaged diagnostic report was not saved");
  }

  const retention = await persistence.readPrivilegedAuditRetentionState();
  const retained = await persistence.listRecentPrivilegedAudit(1_000);
  if (
    retention.policyVersion !== 1 ||
    retention.prunedRecordCount !== 2 ||
    retention.retainedRecordCount !== 2 ||
    retention.firstRetainedSequence !== 3 ||
    retention.lastSequence !== 4 ||
    !/^[a-f0-9]{64}$/u.test(retention.chainHeadSha256) ||
    retained.length !== 2 ||
    retained[0]?.sequence !== 4 ||
    retained[0].event.type !== "tool.completed" ||
    retained[1]?.sequence !== 3 ||
    retained[1].event.type !== "tool.started"
  ) {
    throw new Error("P7.4 privileged audit retention evidence is incomplete");
  }

  assertPrivateRegularFile(isolation.report);
  const reportBytes = fs.readFileSync(isolation.report, "utf8");
  const report = JSON.parse(reportBytes) as unknown;
  assertDiagnosticExportReport(report);
  const expectedRawValues = [
    isolation.root,
    "request-p7-diagnostic-terminal",
    "request-p7-diagnostic-unresolved",
    "request-p7-diagnostic-recent",
    "session-p7-diagnostic-attempt",
    "workspace-p7-diagnostic-private",
    "tool-output-p7-diagnostic-private",
  ];
  if (
    expectedRawValues.some((value) => reportBytes.includes(value)) ||
    report.audit.retention.prunedRecordCount !== 2 ||
    report.audit.retention.retainedRecordCount !== 2 ||
    report.audit.events.length !== 2 ||
    report.audit.events[0]?.sequence !== 4 ||
    report.audit.events[1]?.sequence !== 3 ||
    report.attempts.records.length !== 1
  ) {
    throw new Error("P7.4 diagnostic report redaction evidence is incomplete");
  }

  const result = exactResult();
  assertP7DiagnosticAuditSmokeResult(result);
  fs.writeFileSync(isolation.evidence, JSON.stringify(result), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  assertPrivateRegularFile(isolation.evidence);
  return result;
}
