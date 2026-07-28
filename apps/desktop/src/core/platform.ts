import {
  compareInstants,
  correlationId,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type CorrelationId,
  type Instant,
  type SessionId,
  type TaskId,
  type TaskState,
  type WorkerId,
  type WorkspaceId,
} from "./domain";
import { eventStreamId, type EventStreamId } from "./events";
import {
  assertAuditEvent,
  auditRecordId,
  type AuditEvent,
  type AuditRecord,
  type AuditRecordId,
} from "./privilegedServices";

export const PLATFORM_EVIDENCE_CONTRACT_VERSION = 1 as const;

export const TERMINAL_AGENT_ATTEMPT_STATES = [
  "completed",
  "failed",
  "cancelled",
  "crashed",
  "timed-out",
  "protocol-failed",
] as const;

export type TerminalAgentAttemptState = (typeof TERMINAL_AGENT_ATTEMPT_STATES)[number];

export interface AgentSupervisorIncidentEvidence {
  readonly code: string;
  readonly occurredAt: Instant;
}

export interface AgentAttemptEvidence {
  readonly contractVersion: typeof PLATFORM_EVIDENCE_CONTRACT_VERSION;
  readonly redaction: "metadata";
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly correlationId: CorrelationId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly streamId: EventStreamId;
  readonly state: TerminalAgentAttemptState;
  readonly taskState?: TaskState;
  readonly startedAt: Instant;
  readonly lastSignalAt: Instant;
  readonly lastControlSequence: number;
  readonly lastCoreEventSequence: number;
  readonly restartCount: number;
  readonly restartedFromSessionId?: SessionId;
  readonly replacementSessionId?: SessionId;
  readonly disposed: true;
  readonly forcedCancellation: boolean;
  readonly incident?: AgentSupervisorIncidentEvidence;
}

export interface AppendPrivilegedAuditInput {
  readonly recordId: AuditRecordId;
  readonly occurredAt: Instant;
  readonly event: AuditEvent;
}

export interface PersistEvidenceResult {
  readonly status: "appended" | "duplicate";
}

export interface PrivilegedAuditSummary {
  readonly recordCount: number;
  readonly lastSequence: number;
}

export interface PlatformEvidencePersistencePort {
  appendPrivilegedAudit(input: AppendPrivilegedAuditInput): Promise<AuditRecord>;
  appendAgentAttemptEvidence(evidence: AgentAttemptEvidence): Promise<PersistEvidenceResult>;
  summarizePrivilegedAudit(): Promise<PrivilegedAuditSummary>;
  listRecentAgentAttemptEvidence(limit: number): Promise<readonly AgentAttemptEvidence[]>;
}

export class PlatformEvidenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlatformEvidenceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new PlatformEvidenceError(`${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new PlatformEvidenceError(`${label} contains unsupported field ${unexpected}`);
  }
}

function assertIdentifier(
  value: unknown,
  factory: (candidate: string) => unknown,
  label: string,
): void {
  if (typeof value !== "string") {
    throw new PlatformEvidenceError(`${label} must be an identifier`);
  }

  try {
    factory(value);
  } catch {
    throw new PlatformEvidenceError(`${label} is invalid`);
  }
}

function assertInstant(value: unknown, label: string): asserts value is Instant {
  assertIdentifier(value, instant, label);
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new PlatformEvidenceError(`${label} must be a non-negative safe integer`);
  }
}

function assertIncident(value: unknown): asserts value is AgentSupervisorIncidentEvidence {
  assertRecord(value, "Agent attempt evidence.incident");
  assertExactKeys(value, ["code", "occurredAt"], "Agent attempt evidence.incident");
  if (
    typeof value.code !== "string" ||
    value.code.length === 0 ||
    value.code.length > 128 ||
    value.code.trim() !== value.code ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value.code)
  ) {
    throw new PlatformEvidenceError(
      "Agent attempt evidence.incident.code must be a lowercase stable code",
    );
  }
  assertInstant(value.occurredAt, "Agent attempt evidence.incident.occurredAt");
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

export function assertAgentAttemptEvidence(value: unknown): asserts value is AgentAttemptEvidence {
  assertRecord(value, "Agent attempt evidence");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "redaction",
      "workspaceId",
      "taskId",
      "correlationId",
      "sessionId",
      "workerId",
      "streamId",
      "state",
      "taskState",
      "startedAt",
      "lastSignalAt",
      "lastControlSequence",
      "lastCoreEventSequence",
      "restartCount",
      "restartedFromSessionId",
      "replacementSessionId",
      "disposed",
      "forcedCancellation",
      "incident",
    ],
    "Agent attempt evidence",
  );

  if (value.contractVersion !== PLATFORM_EVIDENCE_CONTRACT_VERSION) {
    throw new PlatformEvidenceError(
      `Agent attempt evidence requires contract version ${PLATFORM_EVIDENCE_CONTRACT_VERSION}`,
    );
  }
  if (value.redaction !== "metadata") {
    throw new PlatformEvidenceError("Agent attempt evidence must be metadata-only");
  }
  assertIdentifier(value.workspaceId, workspaceId, "Agent attempt evidence.workspaceId");
  assertIdentifier(value.taskId, taskId, "Agent attempt evidence.taskId");
  assertIdentifier(value.correlationId, correlationId, "Agent attempt evidence.correlationId");
  assertIdentifier(value.sessionId, sessionId, "Agent attempt evidence.sessionId");
  assertIdentifier(value.workerId, workerId, "Agent attempt evidence.workerId");
  assertIdentifier(value.streamId, eventStreamId, "Agent attempt evidence.streamId");

  if (
    typeof value.state !== "string" ||
    !TERMINAL_AGENT_ATTEMPT_STATES.includes(value.state as TerminalAgentAttemptState)
  ) {
    throw new PlatformEvidenceError("Agent attempt evidence.state must be terminal");
  }
  if (
    value.taskState !== undefined &&
    (typeof value.taskState !== "string" || !TASK_STATES.includes(value.taskState as TaskState))
  ) {
    throw new PlatformEvidenceError("Agent attempt evidence.taskState is unsupported");
  }

  assertInstant(value.startedAt, "Agent attempt evidence.startedAt");
  assertInstant(value.lastSignalAt, "Agent attempt evidence.lastSignalAt");
  if (compareInstants(value.lastSignalAt, value.startedAt) < 0) {
    throw new PlatformEvidenceError("Agent attempt evidence cannot move time backwards");
  }
  assertNonNegativeSafeInteger(
    value.lastControlSequence,
    "Agent attempt evidence.lastControlSequence",
  );
  assertNonNegativeSafeInteger(
    value.lastCoreEventSequence,
    "Agent attempt evidence.lastCoreEventSequence",
  );
  assertNonNegativeSafeInteger(value.restartCount, "Agent attempt evidence.restartCount");

  if (value.restartedFromSessionId !== undefined) {
    assertIdentifier(
      value.restartedFromSessionId,
      sessionId,
      "Agent attempt evidence.restartedFromSessionId",
    );
  }
  if (value.replacementSessionId !== undefined) {
    assertIdentifier(
      value.replacementSessionId,
      sessionId,
      "Agent attempt evidence.replacementSessionId",
    );
  }
  if (
    (value.restartCount === 0) !== (value.restartedFromSessionId === undefined) ||
    value.restartedFromSessionId === value.sessionId ||
    value.replacementSessionId === value.sessionId
  ) {
    throw new PlatformEvidenceError("Agent attempt evidence restart references are inconsistent");
  }
  if (value.disposed !== true) {
    throw new PlatformEvidenceError("Agent attempt evidence must be disposed before release");
  }
  if (typeof value.forcedCancellation !== "boolean") {
    throw new PlatformEvidenceError("Agent attempt evidence.forcedCancellation must be boolean");
  }
  if (value.forcedCancellation && value.state !== "cancelled") {
    throw new PlatformEvidenceError("Only cancelled attempt evidence may be force-cancelled");
  }
  if (value.incident !== undefined) {
    assertIncident(value.incident);
    if (compareInstants(value.incident.occurredAt, value.startedAt) < 0) {
      throw new PlatformEvidenceError("Agent attempt incident cannot predate the attempt");
    }
  }
}

export function assertAppendPrivilegedAuditInput(
  value: unknown,
): asserts value is AppendPrivilegedAuditInput {
  assertRecord(value, "Privileged audit append");
  assertExactKeys(value, ["recordId", "occurredAt", "event"], "Privileged audit append");
  assertIdentifier(value.recordId, auditRecordId, "Privileged audit append.recordId");
  assertInstant(value.occurredAt, "Privileged audit append.occurredAt");
  try {
    assertAuditEvent(value.event);
  } catch (error) {
    throw new PlatformEvidenceError("Privileged audit append contains an invalid event", {
      cause: error,
    });
  }
}
