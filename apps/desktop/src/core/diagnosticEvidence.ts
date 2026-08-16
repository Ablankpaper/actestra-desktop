import { instant, type Instant, type TaskState } from "./domain";
import {
  PROTECTED_ACTIONS,
  PROTECTED_RESOURCE_KINDS,
  type AuditEvent,
  type ProtectedAction,
  type ProtectedResourceKind,
} from "./privilegedServices";
import { TERMINAL_AGENT_ATTEMPT_STATES, type TerminalAgentAttemptState } from "./platform";

export const DIAGNOSTIC_EVIDENCE_CONTRACT_VERSION = 1 as const;
export const DIAGNOSTIC_EXPORT_SCHEMA_VERSION = 1 as const;
export const AUDIT_RETENTION_POLICY = Object.freeze({
  contractVersion: DIAGNOSTIC_EVIDENCE_CONTRACT_VERSION,
  policyVersion: 1 as const,
  maxAgeDays: 90 as const,
  maxRecordCount: 100_000 as const,
});
export const DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS = 1_000 as const;
export const DIAGNOSTIC_EXPORT_MAX_ATTEMPTS = 50 as const;
export const DIAGNOSTIC_EXPORT_MAX_BYTES = 2 * 1024 * 1024;
export const DIAGNOSTIC_EXPORT_EXCLUSIONS = Object.freeze([
  "credentials",
  "provider-configuration",
  "prompts-and-completions",
  "tool-arguments-and-results",
  "content-references-and-patches",
  "user-paths",
  "environment-values",
  "raw-logs",
  "raw-identifiers",
] as const);

export type DiagnosticExportExclusion = (typeof DIAGNOSTIC_EXPORT_EXCLUSIONS)[number];

export interface PrivilegedAuditRetentionState {
  readonly contractVersion: typeof DIAGNOSTIC_EVIDENCE_CONTRACT_VERSION;
  readonly policyVersion: typeof AUDIT_RETENTION_POLICY.policyVersion;
  readonly maxAgeDays: typeof AUDIT_RETENTION_POLICY.maxAgeDays;
  readonly maxRecordCount: typeof AUDIT_RETENTION_POLICY.maxRecordCount;
  readonly retainedRecordCount: number;
  readonly prunedRecordCount: number;
  readonly firstRetainedSequence: number | null;
  readonly lastSequence: number;
  readonly chainHeadSha256: string;
  readonly lastMaintainedAt: Instant;
}

export type DiagnosticAuditEventType = AuditEvent["type"];

export interface DiagnosticAuditEvent {
  readonly sequence: number;
  readonly occurredAt: Instant;
  readonly requestAlias: string;
  readonly type: DiagnosticAuditEventType;
  readonly action: ProtectedAction;
  readonly resourceKind: ProtectedResourceKind;
  readonly outcomeCode: string | null;
  readonly mayHaveExecuted: boolean | null;
}

export interface DiagnosticAttemptRecord {
  readonly attemptAlias: string;
  readonly state: TerminalAgentAttemptState;
  readonly taskState: TaskState | null;
  readonly startedAt: Instant;
  readonly lastSignalAt: Instant;
  readonly restartCount: number;
  readonly forcedCancellation: boolean;
  readonly incidentCode: string | null;
}

export interface DiagnosticExportReport {
  readonly schemaVersion: typeof DIAGNOSTIC_EXPORT_SCHEMA_VERSION;
  readonly generatedAt: Instant;
  readonly redaction: "metadata-only";
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly platform: string;
    readonly arch: string;
    readonly environment: "development" | "packaged";
  };
  readonly audit: {
    readonly retention: PrivilegedAuditRetentionState;
    readonly exportedRecordCount: number;
    readonly truncated: boolean;
    readonly events: readonly DiagnosticAuditEvent[];
  };
  readonly attempts: {
    readonly exportedRecordCount: number;
    readonly truncated: boolean;
    readonly records: readonly DiagnosticAttemptRecord[];
  };
  readonly exclusions: readonly DiagnosticExportExclusion[];
}

export class DiagnosticEvidenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiagnosticEvidenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DiagnosticEvidenceError(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpected !== undefined) {
    throw new DiagnosticEvidenceError(`${label} contains unsupported field ${unexpected}`);
  }
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) {
    throw new DiagnosticEvidenceError(`${label} is missing field ${missing}`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DiagnosticEvidenceError(`${label} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new DiagnosticEvidenceError(`${label} must be a positive safe integer`);
  }
}

function assertInstant(value: unknown, label: string): asserts value is Instant {
  if (typeof value !== "string") {
    throw new DiagnosticEvidenceError(`${label} must be an instant`);
  }
  try {
    instant(value);
  } catch (error) {
    throw new DiagnosticEvidenceError(`${label} must be an instant`, { cause: error });
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function assertBoundedText(
  value: unknown,
  label: string,
  maximumLength = 128,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    hasControlCharacter(value)
  ) {
    throw new DiagnosticEvidenceError(`${label} must be bounded control-free text`);
  }
}

function assertStableCode(value: unknown, label: string): asserts value is string {
  assertBoundedText(value, label);
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(value)) {
    throw new DiagnosticEvidenceError(`${label} must be a stable code`);
  }
}

function assertAlias(
  value: unknown,
  kind: "request" | "attempt",
  label: string,
): asserts value is string {
  if (typeof value !== "string" || !new RegExp(`^${kind}-[0-9]{4}$`, "u").test(value)) {
    throw new DiagnosticEvidenceError(`${label} must be an opaque ${kind} alias`);
  }
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new DiagnosticEvidenceError(`${label} must be a lowercase SHA-256 digest`);
  }
}

export function assertPrivilegedAuditRetentionState(
  value: unknown,
): asserts value is PrivilegedAuditRetentionState {
  assertRecord(value, "Privileged audit retention state");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "policyVersion",
      "maxAgeDays",
      "maxRecordCount",
      "retainedRecordCount",
      "prunedRecordCount",
      "firstRetainedSequence",
      "lastSequence",
      "chainHeadSha256",
      "lastMaintainedAt",
    ],
    "Privileged audit retention state",
  );
  if (
    value.contractVersion !== AUDIT_RETENTION_POLICY.contractVersion ||
    value.policyVersion !== AUDIT_RETENTION_POLICY.policyVersion ||
    value.maxAgeDays !== AUDIT_RETENTION_POLICY.maxAgeDays ||
    value.maxRecordCount !== AUDIT_RETENTION_POLICY.maxRecordCount
  ) {
    throw new DiagnosticEvidenceError("Privileged audit retention policy is unsupported");
  }
  assertNonNegativeInteger(value.retainedRecordCount, "Retained audit record count");
  assertNonNegativeInteger(value.prunedRecordCount, "Pruned audit record count");
  assertNonNegativeInteger(value.lastSequence, "Audit last sequence");
  if (value.prunedRecordCount + value.retainedRecordCount !== value.lastSequence) {
    throw new DiagnosticEvidenceError(
      "Privileged audit retention sequence counts are inconsistent",
    );
  }
  if (value.retainedRecordCount === 0) {
    if (value.firstRetainedSequence !== null) {
      throw new DiagnosticEvidenceError("Privileged audit first retained sequence must be null");
    }
  } else {
    assertPositiveInteger(value.firstRetainedSequence, "Privileged audit first retained sequence");
    if (value.firstRetainedSequence !== value.prunedRecordCount + 1) {
      throw new DiagnosticEvidenceError("Privileged audit first retained sequence is inconsistent");
    }
  }
  assertSha256(value.chainHeadSha256, "Privileged audit chain head SHA-256");
  assertInstant(value.lastMaintainedAt, "Privileged audit last maintained time");
}

const AUDIT_EVENT_TYPES: readonly DiagnosticAuditEventType[] = [
  "policy.evaluated",
  "approval.requested",
  "approval.resolved",
  "approval.decision-recorded",
  "approval.consumed",
  "credential.lease-issued",
  "credential.lease-released",
  "tool.started",
  "tool.completed",
  "tool.failed",
];

function assertDiagnosticAuditEvent(value: unknown): asserts value is DiagnosticAuditEvent {
  assertRecord(value, "Diagnostic audit event");
  assertExactKeys(
    value,
    [
      "sequence",
      "occurredAt",
      "requestAlias",
      "type",
      "action",
      "resourceKind",
      "outcomeCode",
      "mayHaveExecuted",
    ],
    "Diagnostic audit event",
  );
  assertPositiveInteger(value.sequence, "Diagnostic audit event.sequence");
  assertInstant(value.occurredAt, "Diagnostic audit event.occurredAt");
  assertAlias(value.requestAlias, "request", "Diagnostic audit event.requestAlias");
  if (!AUDIT_EVENT_TYPES.includes(value.type as DiagnosticAuditEventType)) {
    throw new DiagnosticEvidenceError("Diagnostic audit event.type is unsupported");
  }
  if (!PROTECTED_ACTIONS.includes(value.action as ProtectedAction)) {
    throw new DiagnosticEvidenceError("Diagnostic audit event.action is unsupported");
  }
  if (!PROTECTED_RESOURCE_KINDS.includes(value.resourceKind as ProtectedResourceKind)) {
    throw new DiagnosticEvidenceError("Diagnostic audit event.resourceKind is unsupported");
  }
  if (value.outcomeCode !== null) {
    assertStableCode(value.outcomeCode, "Diagnostic audit event.outcomeCode");
  }
  if (value.mayHaveExecuted !== null && typeof value.mayHaveExecuted !== "boolean") {
    throw new DiagnosticEvidenceError(
      "Diagnostic audit event.mayHaveExecuted must be boolean or null",
    );
  }
}

const TASK_STATES: readonly TaskState[] = [
  "draft",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
];

function assertDiagnosticAttempt(value: unknown): asserts value is DiagnosticAttemptRecord {
  assertRecord(value, "Diagnostic attempt");
  assertExactKeys(
    value,
    [
      "attemptAlias",
      "state",
      "taskState",
      "startedAt",
      "lastSignalAt",
      "restartCount",
      "forcedCancellation",
      "incidentCode",
    ],
    "Diagnostic attempt",
  );
  assertAlias(value.attemptAlias, "attempt", "Diagnostic attempt.attemptAlias");
  if (!TERMINAL_AGENT_ATTEMPT_STATES.includes(value.state as TerminalAgentAttemptState)) {
    throw new DiagnosticEvidenceError("Diagnostic attempt.state is unsupported");
  }
  if (value.taskState !== null && !TASK_STATES.includes(value.taskState as TaskState)) {
    throw new DiagnosticEvidenceError("Diagnostic attempt.taskState is unsupported");
  }
  assertInstant(value.startedAt, "Diagnostic attempt.startedAt");
  assertInstant(value.lastSignalAt, "Diagnostic attempt.lastSignalAt");
  assertNonNegativeInteger(value.restartCount, "Diagnostic attempt.restartCount");
  if (typeof value.forcedCancellation !== "boolean") {
    throw new DiagnosticEvidenceError("Diagnostic attempt.forcedCancellation must be boolean");
  }
  if (value.incidentCode !== null) {
    assertStableCode(value.incidentCode, "Diagnostic attempt.incidentCode");
  }
}

export function assertDiagnosticExportReport(
  value: unknown,
): asserts value is DiagnosticExportReport {
  assertRecord(value, "Diagnostic export report");
  assertExactKeys(
    value,
    ["schemaVersion", "generatedAt", "redaction", "app", "audit", "attempts", "exclusions"],
    "Diagnostic export report",
  );
  if (value.schemaVersion !== DIAGNOSTIC_EXPORT_SCHEMA_VERSION) {
    throw new DiagnosticEvidenceError("Diagnostic export schema version is unsupported");
  }
  assertInstant(value.generatedAt, "Diagnostic export generatedAt");
  if (value.redaction !== "metadata-only") {
    throw new DiagnosticEvidenceError("Diagnostic export must be metadata-only");
  }

  assertRecord(value.app, "Diagnostic export app");
  assertExactKeys(
    value.app,
    ["name", "version", "platform", "arch", "environment"],
    "Diagnostic export app",
  );
  assertBoundedText(value.app.name, "Diagnostic export app.name");
  assertBoundedText(value.app.version, "Diagnostic export app.version");
  assertBoundedText(value.app.platform, "Diagnostic export app.platform", 32);
  assertBoundedText(value.app.arch, "Diagnostic export app.arch", 32);
  if (value.app.environment !== "development" && value.app.environment !== "packaged") {
    throw new DiagnosticEvidenceError("Diagnostic export app.environment is unsupported");
  }

  assertRecord(value.audit, "Diagnostic export audit");
  assertExactKeys(
    value.audit,
    ["retention", "exportedRecordCount", "truncated", "events"],
    "Diagnostic export audit",
  );
  assertPrivilegedAuditRetentionState(value.audit.retention);
  assertNonNegativeInteger(value.audit.exportedRecordCount, "Exported audit record count");
  if (
    !Array.isArray(value.audit.events) ||
    value.audit.events.length > DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS
  ) {
    throw new DiagnosticEvidenceError("Diagnostic export audit events exceed the bound");
  }
  if (value.audit.exportedRecordCount !== value.audit.events.length) {
    throw new DiagnosticEvidenceError("Diagnostic export audit event count is inconsistent");
  }
  if (typeof value.audit.truncated !== "boolean") {
    throw new DiagnosticEvidenceError("Diagnostic export audit truncated flag must be boolean");
  }
  for (const event of value.audit.events) assertDiagnosticAuditEvent(event);

  assertRecord(value.attempts, "Diagnostic export attempts");
  assertExactKeys(
    value.attempts,
    ["exportedRecordCount", "truncated", "records"],
    "Diagnostic export attempts",
  );
  assertNonNegativeInteger(value.attempts.exportedRecordCount, "Exported attempt record count");
  if (
    !Array.isArray(value.attempts.records) ||
    value.attempts.records.length > DIAGNOSTIC_EXPORT_MAX_ATTEMPTS
  ) {
    throw new DiagnosticEvidenceError("Diagnostic export attempt records exceed the bound");
  }
  if (value.attempts.exportedRecordCount !== value.attempts.records.length) {
    throw new DiagnosticEvidenceError("Diagnostic export attempt record count is inconsistent");
  }
  if (typeof value.attempts.truncated !== "boolean") {
    throw new DiagnosticEvidenceError("Diagnostic export attempt truncated flag must be boolean");
  }
  for (const attempt of value.attempts.records) assertDiagnosticAttempt(attempt);

  if (
    !Array.isArray(value.exclusions) ||
    value.exclusions.length !== DIAGNOSTIC_EXPORT_EXCLUSIONS.length ||
    value.exclusions.some((item, index) => item !== DIAGNOSTIC_EXPORT_EXCLUSIONS[index])
  ) {
    throw new DiagnosticEvidenceError("Diagnostic export exclusions are unsupported");
  }
}
