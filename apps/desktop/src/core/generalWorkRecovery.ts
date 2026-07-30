import {
  artifactId,
  compareInstants,
  correlationId,
  instant,
  sessionId,
  taskId,
  toolRequestId,
  workerId,
  workspaceId,
  type Artifact,
  type ArtifactId,
  type ArtifactKind,
  type CorrelationId,
  type Instant,
  type SessionId,
  type TaskId,
  type TaskState,
  type ToolRequestId,
  type WorkerId,
  type WorkspaceId,
} from "./domain";
import {
  advanceCoreEventStreamState,
  assertCoreEventStream,
  createCoreEventStreamState,
  eventStreamId,
  resumeCoreEventStreamState,
  type CoreEvent,
  type CoreEventStreamState,
  type EventStreamId,
} from "./events";
import {
  toolId,
  toolInputReference,
  toolOutputReference,
  type ToolId,
  type ToolInputReference,
  type ToolOutputReference,
} from "./privilegedServices";
import { TASK_OUTPUT_WRITE_TEXT_TOOL_ID, WORKSPACE_READ_TEXT_TOOL_ID } from "./scopedNativeTools";
import {
  assertContentReferenceOwner,
  workspaceGrantId,
  type ContentReferenceOwner,
  type WorkspaceGrantId,
} from "./workloadContent";

export const GENERAL_WORK_RECOVERY_CONTRACT_VERSION = 1 as const;
export const MAX_GENERAL_WORK_CHECKPOINT_EVENTS = 128;
export const MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS = 100;

export const GENERAL_WORK_CHECKPOINT_PHASES = ["active", "terminal-pending", "finalized"] as const;
export type GeneralWorkCheckpointPhase = (typeof GENERAL_WORK_CHECKPOINT_PHASES)[number];

export const GENERAL_WORK_ACTIVE_ATTEMPT_STATES = [
  "starting",
  "running",
  "blocked",
  "cancelling",
] as const;
export const GENERAL_WORK_TERMINAL_ATTEMPT_STATES = [
  "completed",
  "failed",
  "cancelled",
  "crashed",
  "timed-out",
  "protocol-failed",
] as const;
export const GENERAL_WORK_ATTEMPT_STATES = [
  ...GENERAL_WORK_ACTIVE_ATTEMPT_STATES,
  ...GENERAL_WORK_TERMINAL_ATTEMPT_STATES,
] as const;

export type GeneralWorkActiveAttemptState = (typeof GENERAL_WORK_ACTIVE_ATTEMPT_STATES)[number];
export type GeneralWorkTerminalAttemptState = (typeof GENERAL_WORK_TERMINAL_ATTEMPT_STATES)[number];
export type GeneralWorkAttemptState = (typeof GENERAL_WORK_ATTEMPT_STATES)[number];

export interface GeneralWorkAttemptIncident {
  readonly code: string;
  readonly occurredAt: Instant;
}

export interface GeneralWorkAttemptRecord {
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly correlationId: CorrelationId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly streamId: EventStreamId;
  readonly state: GeneralWorkAttemptState;
  readonly taskState?: TaskState;
  readonly startedAt: Instant;
  readonly lastSignalAt: Instant;
  readonly lastControlSequence: number;
  readonly lastCoreEventSequence: number;
  readonly restartCount: number;
  readonly restartedFromSessionId?: SessionId;
  readonly replacementSessionId?: SessionId;
  readonly disposed: boolean;
  readonly forcedCancellation: boolean;
  readonly incident?: GeneralWorkAttemptIncident;
}

interface GeneralWorkToolBase {
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
  readonly inputRef: ToolInputReference;
  readonly startedAt: Instant;
  readonly mayHaveExecuted: boolean;
}

export type GeneralWorkToolCheckpoint =
  | (GeneralWorkToolBase & {
      readonly state: "in-flight";
    })
  | (GeneralWorkToolBase & {
      readonly state: "succeeded";
      readonly completedAt: Instant;
      readonly outputRef: ToolOutputReference;
      readonly summary?: string;
    })
  | (GeneralWorkToolBase & {
      readonly state: "failed";
      readonly completedAt: Instant;
      readonly errorCode: string;
      readonly message: string;
    })
  | (GeneralWorkToolBase & {
      readonly state: "cancelled";
      readonly completedAt: Instant;
      readonly reason?: string;
    });

export interface GeneralWorkArtifactIntent {
  readonly artifactId: ArtifactId;
  readonly kind: ArtifactKind;
  readonly label: string;
  readonly grantId: WorkspaceGrantId;
}

export interface GeneralWorkArtifactBinding {
  readonly artifact: Artifact;
  readonly outputRef: ToolOutputReference;
  readonly owner: ContentReferenceOwner;
}

export interface GeneralWorkEventBaseline {
  readonly sequence: number;
  readonly event: CoreEvent;
  readonly taskState: TaskState;
}

export interface GeneralWorkCheckpoint {
  readonly contractVersion: typeof GENERAL_WORK_RECOVERY_CONTRACT_VERSION;
  readonly phase: GeneralWorkCheckpointPhase;
  readonly revision: number;
  readonly attempt: GeneralWorkAttemptRecord;
  readonly eventBaseline?: GeneralWorkEventBaseline;
  readonly events: readonly CoreEvent[];
  readonly tool?: GeneralWorkToolCheckpoint;
  readonly artifactIntent?: GeneralWorkArtifactIntent;
  readonly artifactBinding?: GeneralWorkArtifactBinding;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface PersistGeneralWorkCheckpointResult {
  readonly status: "stored" | "updated" | "duplicate";
  readonly checkpoint: GeneralWorkCheckpoint;
}

export interface GeneralWorkRecoveryPersistencePort {
  persistGeneralWorkCheckpoint(
    checkpoint: GeneralWorkCheckpoint,
  ): Promise<PersistGeneralWorkCheckpointResult>;
  getGeneralWorkCheckpoint(session: SessionId): Promise<GeneralWorkCheckpoint | null>;
  listRecoverableGeneralWorkCheckpoints(limit: number): Promise<readonly GeneralWorkCheckpoint[]>;
}

export type GeneralWorkRecoveryErrorCode =
  | "invalid-contract"
  | "invalid-transition"
  | "identity-mismatch"
  | "event-mismatch"
  | "artifact-mismatch";

export class GeneralWorkRecoveryError extends Error {
  constructor(
    readonly code: GeneralWorkRecoveryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GeneralWorkRecoveryError";
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
const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "file",
  "document",
  "dataset",
  "directory",
  "other",
];
const STABLE_CODE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GeneralWorkRecoveryError("invalid-contract", `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unsupported = Object.keys(value).find((key) => !allowed.includes(key));
  if (unsupported !== undefined) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      `${label} contains unsupported field ${unsupported}`,
    );
  }
}

function assertIdentifier(
  value: unknown,
  factory: (candidate: string) => unknown,
  label: string,
): void {
  if (typeof value !== "string") {
    throw new GeneralWorkRecoveryError("invalid-contract", `${label} must be an identifier`);
  }
  try {
    factory(value);
  } catch (error) {
    throw new GeneralWorkRecoveryError("invalid-contract", `${label} is invalid`, {
      cause: error,
    });
  }
}

function assertInstant(value: unknown, label: string): asserts value is Instant {
  assertIdentifier(value, instant, label);
}

function assertText(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.trim().length === 0) ||
    value.length > maximumLength
  ) {
    throw new GeneralWorkRecoveryError("invalid-contract", `${label} must be bounded text`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      `${label} must be a non-negative safe integer`,
    );
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      `${label} must be a positive safe integer`,
    );
  }
}

function assertStableCode(value: unknown, label: string): asserts value is string {
  assertText(value, label, 128);
  if (!STABLE_CODE.test(value)) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      `${label} must be a lowercase stable code`,
    );
  }
}

function assertAttemptRecord(value: unknown): asserts value is GeneralWorkAttemptRecord {
  assertRecord(value, "General-work attempt");
  assertExactKeys(
    value,
    [
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
    "General-work attempt",
  );
  assertIdentifier(value.workspaceId, workspaceId, "General-work attempt.workspaceId");
  assertIdentifier(value.taskId, taskId, "General-work attempt.taskId");
  assertIdentifier(value.correlationId, correlationId, "General-work attempt.correlationId");
  assertIdentifier(value.sessionId, sessionId, "General-work attempt.sessionId");
  assertIdentifier(value.workerId, workerId, "General-work attempt.workerId");
  assertIdentifier(value.streamId, eventStreamId, "General-work attempt.streamId");
  if (
    typeof value.state !== "string" ||
    !GENERAL_WORK_ATTEMPT_STATES.includes(value.state as GeneralWorkAttemptState)
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work attempt.state is unsupported",
    );
  }
  if (
    value.taskState !== undefined &&
    (typeof value.taskState !== "string" || !TASK_STATES.includes(value.taskState as TaskState))
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work attempt.taskState is unsupported",
    );
  }
  assertInstant(value.startedAt, "General-work attempt.startedAt");
  assertInstant(value.lastSignalAt, "General-work attempt.lastSignalAt");
  if (compareInstants(value.lastSignalAt, value.startedAt) < 0) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work attempt time cannot move backwards",
    );
  }
  assertNonNegativeSafeInteger(
    value.lastControlSequence,
    "General-work attempt.lastControlSequence",
  );
  assertNonNegativeSafeInteger(
    value.lastCoreEventSequence,
    "General-work attempt.lastCoreEventSequence",
  );
  assertNonNegativeSafeInteger(value.restartCount, "General-work attempt.restartCount");
  if (value.restartedFromSessionId !== undefined) {
    assertIdentifier(
      value.restartedFromSessionId,
      sessionId,
      "General-work attempt.restartedFromSessionId",
    );
    if (value.restartedFromSessionId === value.sessionId) {
      throw new GeneralWorkRecoveryError(
        "identity-mismatch",
        "A restarted attempt requires a different predecessor session",
      );
    }
  }
  if (value.replacementSessionId !== undefined) {
    assertIdentifier(
      value.replacementSessionId,
      sessionId,
      "General-work attempt.replacementSessionId",
    );
    if (value.replacementSessionId === value.sessionId) {
      throw new GeneralWorkRecoveryError(
        "identity-mismatch",
        "A replacement attempt requires a different session",
      );
    }
  }
  if (typeof value.disposed !== "boolean" || typeof value.forcedCancellation !== "boolean") {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work attempt cleanup flags must be boolean",
    );
  }
  if (value.incident !== undefined) {
    assertRecord(value.incident, "General-work attempt.incident");
    assertExactKeys(value.incident, ["code", "occurredAt"], "General-work attempt.incident");
    assertStableCode(value.incident.code, "General-work attempt.incident.code");
    assertInstant(value.incident.occurredAt, "General-work attempt.incident.occurredAt");
  }
}

function assertToolCheckpoint(value: unknown): asserts value is GeneralWorkToolCheckpoint {
  assertRecord(value, "General-work tool checkpoint");
  const baseKeys = ["requestId", "toolId", "inputRef", "startedAt", "mayHaveExecuted", "state"];
  const state = value.state;
  if (
    state !== "in-flight" &&
    state !== "succeeded" &&
    state !== "failed" &&
    state !== "cancelled"
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work tool checkpoint.state is unsupported",
    );
  }
  assertExactKeys(
    value,
    state === "succeeded"
      ? [...baseKeys, "completedAt", "outputRef", "summary"]
      : state === "failed"
        ? [...baseKeys, "completedAt", "errorCode", "message"]
        : state === "cancelled"
          ? [...baseKeys, "completedAt", "reason"]
          : baseKeys,
    "General-work tool checkpoint",
  );
  assertIdentifier(value.requestId, toolRequestId, "General-work tool checkpoint.requestId");
  assertIdentifier(value.toolId, toolId, "General-work tool checkpoint.toolId");
  assertIdentifier(value.inputRef, toolInputReference, "General-work tool checkpoint.inputRef");
  assertInstant(value.startedAt, "General-work tool checkpoint.startedAt");
  if (typeof value.mayHaveExecuted !== "boolean") {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work tool checkpoint.mayHaveExecuted must be boolean",
    );
  }
  if (state !== "in-flight") {
    assertInstant(value.completedAt, "General-work tool checkpoint.completedAt");
    if (compareInstants(value.completedAt, value.startedAt) < 0) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "General-work tool completion cannot precede its start",
      );
    }
  }
  if (state === "succeeded") {
    assertIdentifier(
      value.outputRef,
      toolOutputReference,
      "General-work tool checkpoint.outputRef",
    );
    if (!value.mayHaveExecuted) {
      throw new GeneralWorkRecoveryError(
        "invalid-contract",
        "A successful tool checkpoint must acknowledge execution",
      );
    }
    if (value.summary !== undefined) {
      assertText(value.summary, "General-work tool checkpoint.summary", 4096, true);
    }
  } else if (state === "failed") {
    assertStableCode(value.errorCode, "General-work tool checkpoint.errorCode");
    assertText(value.message, "General-work tool checkpoint.message", 4096, true);
  } else if (state === "cancelled" && value.reason !== undefined) {
    assertText(value.reason, "General-work tool checkpoint.reason", 4096, true);
  }
}

function assertArtifactIntent(value: unknown): asserts value is GeneralWorkArtifactIntent {
  assertRecord(value, "General-work artifact intent");
  assertExactKeys(
    value,
    ["artifactId", "kind", "label", "grantId"],
    "General-work artifact intent",
  );
  assertIdentifier(value.artifactId, artifactId, "General-work artifact intent.artifactId");
  if (typeof value.kind !== "string" || !ARTIFACT_KINDS.includes(value.kind as ArtifactKind)) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work artifact intent.kind is unsupported",
    );
  }
  assertText(value.label, "General-work artifact intent.label", 512);
  assertIdentifier(value.grantId, workspaceGrantId, "General-work artifact intent.grantId");
}

function assertArtifactBinding(value: unknown): asserts value is GeneralWorkArtifactBinding {
  assertRecord(value, "General-work artifact binding");
  assertExactKeys(value, ["artifact", "outputRef", "owner"], "General-work artifact binding");
  assertRecord(value.artifact, "General-work artifact");
  assertExactKeys(
    value.artifact,
    [
      "id",
      "workspaceId",
      "taskId",
      "sessionId",
      "kind",
      "label",
      "state",
      "createdAt",
      "updatedAt",
    ],
    "General-work artifact",
  );
  assertIdentifier(value.artifact.id, artifactId, "General-work artifact.id");
  assertIdentifier(value.artifact.workspaceId, workspaceId, "General-work artifact.workspaceId");
  assertIdentifier(value.artifact.taskId, taskId, "General-work artifact.taskId");
  if (value.artifact.sessionId !== undefined) {
    assertIdentifier(value.artifact.sessionId, sessionId, "General-work artifact.sessionId");
  }
  if (
    typeof value.artifact.kind !== "string" ||
    !ARTIFACT_KINDS.includes(value.artifact.kind as ArtifactKind)
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work artifact.kind is unsupported",
    );
  }
  assertText(value.artifact.label, "General-work artifact.label", 512);
  if (value.artifact.state !== "available") {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "A newly bound general-work artifact must be available",
    );
  }
  assertInstant(value.artifact.createdAt, "General-work artifact.createdAt");
  assertInstant(value.artifact.updatedAt, "General-work artifact.updatedAt");
  if (compareInstants(value.artifact.updatedAt, value.artifact.createdAt) < 0) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work artifact time cannot move backwards",
    );
  }
  assertIdentifier(value.outputRef, toolOutputReference, "General-work artifact outputRef");
  try {
    assertContentReferenceOwner(value.owner);
  } catch (error) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work artifact owner is invalid",
      { cause: error },
    );
  }
}

function assertEventBaseline(value: unknown): asserts value is GeneralWorkEventBaseline {
  assertRecord(value, "General-work event baseline");
  assertExactKeys(value, ["sequence", "event", "taskState"], "General-work event baseline");
  assertPositiveSafeInteger(value.sequence, "General-work event baseline.sequence");
  if (typeof value.taskState !== "string" || !TASK_STATES.includes(value.taskState as TaskState)) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work event baseline.taskState is unsupported",
    );
  }
  try {
    const state = resumeCoreEventStreamState(
      value.event as CoreEvent,
      value.taskState as TaskState,
    );
    if (state.previous?.sequence !== value.sequence) {
      throw new GeneralWorkRecoveryError(
        "event-mismatch",
        "General-work event baseline sequence does not match its event",
      );
    }
  } catch (error) {
    if (error instanceof GeneralWorkRecoveryError) {
      throw error;
    }
    throw new GeneralWorkRecoveryError(
      "event-mismatch",
      "General-work event baseline is not a valid resume point",
      { cause: error },
    );
  }
}

export function createGeneralWorkEventStreamState(
  baseline: GeneralWorkEventBaseline | undefined,
  events: readonly CoreEvent[],
): CoreEventStreamState {
  if (baseline === undefined) {
    return createCoreEventStreamState(events);
  }
  let state = resumeCoreEventStreamState(baseline.event, baseline.taskState);
  for (const event of events) {
    state = advanceCoreEventStreamState(state, event);
  }
  return state;
}

export function assertGeneralWorkCheckpoint(
  value: unknown,
): asserts value is GeneralWorkCheckpoint {
  assertRecord(value, "General-work checkpoint");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "phase",
      "revision",
      "attempt",
      "eventBaseline",
      "events",
      "tool",
      "artifactIntent",
      "artifactBinding",
      "createdAt",
      "updatedAt",
    ],
    "General-work checkpoint",
  );
  if (value.contractVersion !== GENERAL_WORK_RECOVERY_CONTRACT_VERSION) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      `General-work checkpoint requires contract version ${GENERAL_WORK_RECOVERY_CONTRACT_VERSION}`,
    );
  }
  if (
    typeof value.phase !== "string" ||
    !GENERAL_WORK_CHECKPOINT_PHASES.includes(value.phase as GeneralWorkCheckpointPhase)
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work checkpoint.phase is unsupported",
    );
  }
  assertPositiveSafeInteger(value.revision, "General-work checkpoint.revision");
  assertAttemptRecord(value.attempt);
  if (value.eventBaseline !== undefined) {
    assertEventBaseline(value.eventBaseline);
  }
  if (!Array.isArray(value.events) || value.events.length > MAX_GENERAL_WORK_CHECKPOINT_EVENTS) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      `General-work checkpoint events exceed ${MAX_GENERAL_WORK_CHECKPOINT_EVENTS}`,
    );
  }
  let eventState: CoreEventStreamState;
  try {
    if (value.eventBaseline === undefined) {
      assertCoreEventStream(value.events);
    }
    eventState = createGeneralWorkEventStreamState(
      value.eventBaseline as GeneralWorkEventBaseline | undefined,
      value.events as readonly CoreEvent[],
    );
  } catch (error) {
    throw new GeneralWorkRecoveryError(
      "event-mismatch",
      "General-work checkpoint events are not a canonical stream",
      { cause: error },
    );
  }
  const attempt = value.attempt as GeneralWorkAttemptRecord;
  const events = value.events as readonly CoreEvent[];
  const identityMismatch = [
    ...((value.eventBaseline as GeneralWorkEventBaseline | undefined) === undefined
      ? []
      : [(value.eventBaseline as GeneralWorkEventBaseline).event]),
    ...events,
  ].find(
    (event) =>
      event.workspaceId !== attempt.workspaceId ||
      event.taskId !== attempt.taskId ||
      event.correlationId !== attempt.correlationId ||
      event.sessionId !== attempt.sessionId ||
      event.workerId !== attempt.workerId ||
      event.streamId !== attempt.streamId,
  );
  if (identityMismatch !== undefined) {
    throw new GeneralWorkRecoveryError(
      "identity-mismatch",
      "General-work checkpoint event identity changed",
    );
  }
  if (
    (eventState.previous?.sequence ?? 0) !== attempt.lastCoreEventSequence ||
    eventState.taskState !== attempt.taskState
  ) {
    throw new GeneralWorkRecoveryError(
      "event-mismatch",
      "General-work attempt does not match its canonical event projection",
    );
  }
  if (value.phase === "active") {
    if (
      !GENERAL_WORK_ACTIVE_ATTEMPT_STATES.includes(
        attempt.state as GeneralWorkActiveAttemptState,
      ) ||
      attempt.disposed
    ) {
      throw new GeneralWorkRecoveryError(
        "invalid-transition",
        "An active checkpoint requires a live non-terminal attempt",
      );
    }
  } else if (
    !GENERAL_WORK_TERMINAL_ATTEMPT_STATES.includes(
      attempt.state as GeneralWorkTerminalAttemptState,
    ) ||
    !attempt.disposed
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A terminal checkpoint requires completed adapter cleanup",
    );
  }
  if (value.tool !== undefined) {
    assertToolCheckpoint(value.tool);
  }
  if (value.artifactIntent !== undefined) {
    assertArtifactIntent(value.artifactIntent);
  }
  const intent = value.artifactIntent as GeneralWorkArtifactIntent | undefined;
  const tool = value.tool as GeneralWorkToolCheckpoint | undefined;
  if (
    (intent !== undefined &&
      (intent.kind !== "file" || tool?.toolId !== TASK_OUTPUT_WRITE_TEXT_TOOL_ID)) ||
    (tool?.toolId === TASK_OUTPUT_WRITE_TEXT_TOOL_ID && intent === undefined)
  ) {
    throw new GeneralWorkRecoveryError(
      "artifact-mismatch",
      "General-work task-output tool and file artifact intent must be checkpointed together",
    );
  }
  if (intent !== undefined && tool?.state === "succeeded" && value.artifactBinding === undefined) {
    throw new GeneralWorkRecoveryError(
      "artifact-mismatch",
      "A successful task-output checkpoint requires its durable artifact binding",
    );
  }
  if (value.artifactBinding !== undefined) {
    assertArtifactBinding(value.artifactBinding);
    const binding = value.artifactBinding as GeneralWorkArtifactBinding;
    if (
      intent === undefined ||
      binding.artifact.id !== intent.artifactId ||
      binding.artifact.kind !== intent.kind ||
      binding.artifact.label !== intent.label ||
      binding.artifact.workspaceId !== attempt.workspaceId ||
      binding.artifact.taskId !== attempt.taskId ||
      binding.artifact.sessionId !== attempt.sessionId ||
      binding.owner.workspaceId !== attempt.workspaceId ||
      binding.owner.taskId !== attempt.taskId ||
      binding.owner.sessionId !== attempt.sessionId ||
      binding.owner.workerId !== attempt.workerId ||
      binding.owner.grantId !== intent.grantId ||
      tool?.state !== "succeeded" ||
      tool.outputRef !== binding.outputRef ||
      binding.owner.requestId !== tool.requestId
    ) {
      throw new GeneralWorkRecoveryError(
        "artifact-mismatch",
        "General-work artifact binding does not match its attempt, intent, and tool result",
      );
    }
  }
  assertInstant(value.createdAt, "General-work checkpoint.createdAt");
  assertInstant(value.updatedAt, "General-work checkpoint.updatedAt");
  if (compareInstants(value.updatedAt, value.createdAt) < 0) {
    throw new GeneralWorkRecoveryError(
      "invalid-contract",
      "General-work checkpoint time cannot move backwards",
    );
  }
}

function canonicalJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map(normalize);
    }
    if (isRecord(candidate)) {
      return Object.fromEntries(
        Object.keys(candidate)
          .sort()
          .map((key) => [key, normalize(candidate[key])]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function assertUnchanged(previous: unknown, next: unknown, label: string): void {
  if (canonicalJson(previous) !== canonicalJson(next)) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      `${label} cannot be rewritten after it is checkpointed`,
    );
  }
}

function baselineSequence(checkpoint: GeneralWorkCheckpoint): number {
  return checkpoint.eventBaseline?.sequence ?? 0;
}

function advanceToBaseline(
  checkpoint: GeneralWorkCheckpoint,
  sequence: number,
): GeneralWorkEventBaseline {
  let state =
    checkpoint.eventBaseline === undefined
      ? createCoreEventStreamState([])
      : resumeCoreEventStreamState(
          checkpoint.eventBaseline.event,
          checkpoint.eventBaseline.taskState,
        );
  let eventAtBaseline: CoreEvent | undefined;
  for (const event of checkpoint.events) {
    if (event.sequence > sequence) {
      break;
    }
    state = advanceCoreEventStreamState(state, event);
    if (event.sequence === sequence) {
      eventAtBaseline = event;
    }
  }
  if (eventAtBaseline === undefined || state.taskState === undefined) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work event baseline may advance only through previously durable events",
    );
  }
  return Object.freeze({
    sequence,
    event: eventAtBaseline,
    taskState: state.taskState,
  });
}

function assertAppendOnlyEvents(
  previous: GeneralWorkCheckpoint,
  next: GeneralWorkCheckpoint,
): void {
  const previousBaselineSequence = baselineSequence(previous);
  const nextBaselineSequence = baselineSequence(next);
  if (nextBaselineSequence < previousBaselineSequence) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work checkpoint cannot move its durable event baseline backwards",
    );
  }
  if (nextBaselineSequence === previousBaselineSequence) {
    assertUnchanged(previous.eventBaseline, next.eventBaseline, "General-work event baseline");
  } else {
    assertUnchanged(
      advanceToBaseline(previous, nextBaselineSequence),
      next.eventBaseline,
      "General-work event baseline",
    );
  }

  const retainedPrevious = previous.events.filter((event) => event.sequence > nextBaselineSequence);
  if (next.events.length < retainedPrevious.length) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work checkpoint cannot remove events after its durable baseline",
    );
  }
  for (let index = 0; index < retainedPrevious.length; index += 1) {
    assertUnchanged(
      retainedPrevious[index],
      next.events[index],
      `General-work retained event ${index + 1}`,
    );
  }
}

function assertMonotonicAttempt(
  previous: GeneralWorkAttemptRecord,
  next: GeneralWorkAttemptRecord,
): void {
  if (
    previous.startedAt !== next.startedAt ||
    previous.restartedFromSessionId !== next.restartedFromSessionId
  ) {
    throw new GeneralWorkRecoveryError(
      "identity-mismatch",
      "A general-work checkpoint cannot rewrite attempt lineage or start time",
    );
  }
  if (
    compareInstants(next.lastSignalAt, previous.lastSignalAt) < 0 ||
    next.lastControlSequence < previous.lastControlSequence ||
    next.lastCoreEventSequence < previous.lastCoreEventSequence ||
    next.restartCount < previous.restartCount
  ) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work checkpoint cannot move attempt progress backwards",
    );
  }
  if (previous.forcedCancellation && !next.forcedCancellation) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work checkpoint cannot clear forced cancellation evidence",
    );
  }
  if (
    previous.replacementSessionId !== undefined &&
    previous.replacementSessionId !== next.replacementSessionId
  ) {
    throw new GeneralWorkRecoveryError(
      "identity-mismatch",
      "A general-work checkpoint cannot rewrite replacement-session lineage",
    );
  }
  if (previous.incident !== undefined) {
    assertUnchanged(previous.incident, next.incident, "General-work attempt incident");
  }
}

function assertMonotonicTool(
  previousCheckpoint: GeneralWorkCheckpoint,
  nextCheckpoint: GeneralWorkCheckpoint,
): void {
  const previous = previousCheckpoint.tool;
  const next = nextCheckpoint.tool;
  if (previous === undefined) {
    return;
  }
  if (next === undefined) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work checkpoint cannot remove durable tool state",
    );
  }
  if (
    previous.requestId !== next.requestId ||
    previous.toolId !== next.toolId ||
    previous.inputRef !== next.inputRef
  ) {
    const readCompleted = nextCheckpoint.events.find(
      (event) => event.type === "tool.completed" && event.payload.requestId === previous.requestId,
    );
    const writeRequested = nextCheckpoint.events.find(
      (event) => event.type === "tool.requested" && event.payload.requestId === next.requestId,
    );
    if (
      previousCheckpoint.phase === "active" &&
      nextCheckpoint.phase === "active" &&
      previous.state === "succeeded" &&
      previous.toolId === WORKSPACE_READ_TEXT_TOOL_ID &&
      next.state === "in-flight" &&
      next.toolId === TASK_OUTPUT_WRITE_TEXT_TOOL_ID &&
      previousCheckpoint.artifactIntent === undefined &&
      previousCheckpoint.artifactBinding === undefined &&
      nextCheckpoint.artifactIntent?.kind === "file" &&
      nextCheckpoint.artifactBinding === undefined &&
      readCompleted !== undefined &&
      writeRequested !== undefined &&
      readCompleted.sequence < writeRequested.sequence
    ) {
      return;
    }
    throw new GeneralWorkRecoveryError(
      "identity-mismatch",
      "A general-work checkpoint cannot rewrite tool identity",
    );
  }
  if (previous.state !== "in-flight") {
    assertUnchanged(previous, next, "Terminal general-work tool state");
  } else if (next.state === "in-flight") {
    assertUnchanged(previous, next, "In-flight general-work tool state");
  } else if (compareInstants(next.startedAt, previous.startedAt) < 0) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work tool cannot move its execution start backwards",
    );
  }
}

export function assertGeneralWorkCheckpointTransition(
  previous: GeneralWorkCheckpoint,
  next: GeneralWorkCheckpoint,
): void {
  assertGeneralWorkCheckpoint(previous);
  assertGeneralWorkCheckpoint(next);
  if (
    previous.attempt.sessionId !== next.attempt.sessionId ||
    previous.attempt.workspaceId !== next.attempt.workspaceId ||
    previous.attempt.taskId !== next.attempt.taskId ||
    previous.attempt.correlationId !== next.attempt.correlationId ||
    previous.attempt.workerId !== next.attempt.workerId ||
    previous.attempt.streamId !== next.attempt.streamId ||
    previous.createdAt !== next.createdAt
  ) {
    throw new GeneralWorkRecoveryError(
      "identity-mismatch",
      "A general-work checkpoint update cannot change immutable attempt identity",
    );
  }
  if (next.revision !== previous.revision + 1) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "A general-work checkpoint update must advance exactly one revision",
    );
  }
  const allowed: Record<GeneralWorkCheckpointPhase, readonly GeneralWorkCheckpointPhase[]> = {
    active: ["active", "terminal-pending"],
    "terminal-pending": ["terminal-pending", "finalized"],
    finalized: [],
  };
  if (!allowed[previous.phase].includes(next.phase)) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      `General-work checkpoint cannot move from ${previous.phase} to ${next.phase}`,
    );
  }
  if (compareInstants(next.updatedAt, previous.updatedAt) < 0) {
    throw new GeneralWorkRecoveryError(
      "invalid-transition",
      "General-work checkpoint update time cannot move backwards",
    );
  }
  assertAppendOnlyEvents(previous, next);
  assertMonotonicAttempt(previous.attempt, next.attempt);
  assertMonotonicTool(previous, next);
  if (previous.artifactIntent !== undefined) {
    assertUnchanged(previous.artifactIntent, next.artifactIntent, "General-work artifact intent");
  }
  if (previous.artifactBinding !== undefined) {
    assertUnchanged(
      previous.artifactBinding,
      next.artifactBinding,
      "General-work artifact binding",
    );
  }
  if (previous.phase !== "active") {
    assertUnchanged(previous.attempt, next.attempt, "Terminal general-work attempt");
  }
}
