import { createHash } from "node:crypto";
import {
  CORE_EVENT_SCHEMA_VERSION,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  approvalId,
  artifactId,
  assertCoreEventStream,
  assertDomainGraph,
  correlationId,
  eventId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type CoreEvent,
  type DomainGraph,
  type Instant,
  type SessionState,
  type TaskState,
  type WorkerState,
} from "../../core";
import {
  AIONUI_NATIVE_SOURCE_VERSION,
  AionUiShadowContractError,
  assertAionUiNativeObservation,
  type AionUiNativeObservation,
  type AionUiNativeObservationKind,
} from "./nativeObservations";

export const AIONUI_SHADOW_EVIDENCE_CONTRACT_VERSION = 1 as const;
export const AIONUI_SHADOW_REDACTION = "metadata-only" as const;

export interface AionUiShadowEvidence {
  readonly contractVersion: typeof AIONUI_SHADOW_EVIDENCE_CONTRACT_VERSION;
  readonly evidenceId: string;
  readonly capturedAt: Instant;
  readonly source: `aionui-v${typeof AIONUI_NATIVE_SOURCE_VERSION}`;
  readonly domain: AionUiNativeObservationKind;
  readonly nativeIdentityHash: string;
  readonly nativeRevisionHash: string;
  readonly redaction: typeof AIONUI_SHADOW_REDACTION;
  readonly graph: DomainGraph;
  readonly events: readonly CoreEvent[];
}

export interface StoredAionUiShadowEvidence {
  readonly sequence: number;
  readonly evidence: AionUiShadowEvidence;
}

export interface AppendAionUiShadowEvidenceResult {
  readonly status: "appended" | "duplicate";
  readonly sequence: number;
}

export interface AionUiShadowEvidenceSummary {
  readonly recordCount: number;
  readonly lastSequence: number;
}

export interface AionUiShadowPersistencePort {
  appendAionUiShadowEvidence(
    evidence: AionUiShadowEvidence,
  ): Promise<AppendAionUiShadowEvidenceResult>;
  listRecentAionUiShadowEvidence(limit: number): Promise<readonly StoredAionUiShadowEvidence[]>;
  summarizeAionUiShadowEvidence(): Promise<AionUiShadowEvidenceSummary>;
}

export class AionUiShadowProjectionError extends Error {
  constructor(
    readonly code: "invalid-evidence" | "invalid-observation" | "projection-failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AionUiShadowProjectionError";
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function projectedId(prefix: string, value: string): string {
  return `${prefix}-${hash(value).slice(0, 32)}`;
}

function freezeGraph(graph: DomainGraph): DomainGraph {
  return Object.freeze({
    workspaces: Object.freeze(graph.workspaces.map((record) => Object.freeze(record))),
    tasks: Object.freeze(graph.tasks.map((record) => Object.freeze(record))),
    sessions: Object.freeze(graph.sessions.map((record) => Object.freeze(record))),
    workers: Object.freeze(graph.workers.map((record) => Object.freeze(record))),
    approvals: Object.freeze(graph.approvals.map((record) => Object.freeze(record))),
    artifacts: Object.freeze(graph.artifacts.map((record) => Object.freeze(record))),
  });
}

function canonicalInstant(milliseconds: number): Instant {
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new AionUiShadowProjectionError(
      "projection-failed",
      "AionUi observation timestamp cannot be projected",
    );
  }
  return instant(date.toISOString());
}

function sourceTimestamp(observation: AionUiNativeObservation): number {
  if (observation.kind === "conversation" || observation.kind === "artifact") {
    return observation.updatedAtMs ?? observation.createdAtMs ?? observation.observedAtMs;
  }
  return observation.observedAtMs;
}

function stateForObservation(observation: AionUiNativeObservation): TaskState | undefined {
  if (observation.kind === "provider" || observation.kind === "workspace") {
    return undefined;
  }
  if (observation.kind === "approval") {
    return observation.state === "pending" || observation.state === "unknown"
      ? "blocked"
      : "running";
  }
  if (observation.kind === "artifact") {
    return "running";
  }
  if (observation.kind === "task") {
    if (observation.status === "finished") return "completed";
    if (observation.status === "failed") return "failed";
    if (observation.status === "cancelled") return "cancelled";
    if (observation.status === "running") return "running";
    return "ready";
  }
  if (observation.kind === "runtime") {
    if (observation.state === "failed") return "failed";
    if (observation.state === "waiting_confirmation") return "blocked";
    if (
      observation.state === "running" ||
      observation.state === "starting" ||
      observation.state === "cancelling"
    ) {
      return "running";
    }
    return "ready";
  }
  if (observation.runtimeState === "failed") return "failed";
  if (observation.runtimeState === "waiting_confirmation") return "blocked";
  if (observation.status === "finished") return "completed";
  if (
    observation.status === "running" ||
    observation.runtimeState === "running" ||
    observation.runtimeState === "starting" ||
    observation.runtimeState === "cancelling"
  ) {
    return "running";
  }
  return "ready";
}

function sessionStateForTask(
  taskState: TaskState,
  observation: AionUiNativeObservation,
): SessionState {
  if (taskState === "completed") return "completed";
  if (taskState === "failed") return "failed";
  if (taskState === "cancelled") return "cancelled";
  if (taskState === "blocked") return "blocked";
  if (
    taskState === "running" &&
    ((observation.kind === "runtime" && observation.state === "starting") ||
      (observation.kind === "conversation" && observation.runtimeState === "starting"))
  ) {
    return "starting";
  }
  return taskState === "running" ? "running" : "created";
}

function workerStateForTask(
  taskState: TaskState,
  observation: AionUiNativeObservation,
): WorkerState {
  if (taskState === "failed") return "crashed";
  if (taskState === "completed" || taskState === "cancelled") return "stopped";
  if (
    (observation.kind === "runtime" && observation.state === "starting") ||
    (observation.kind === "conversation" && observation.runtimeState === "starting")
  ) {
    return "starting";
  }
  return taskState === "ready" ? "ready" : "busy";
}

function conversationIdentity(observation: AionUiNativeObservation): string {
  if (observation.kind === "provider" || observation.kind === "workspace") {
    return observation.nativeId;
  }
  return observation.conversationId;
}

function graphForObservation(
  observation: AionUiNativeObservation,
  capturedAt: Instant,
): DomainGraph {
  const conversationKey = conversationIdentity(observation);
  const workspaceKey =
    observation.kind === "conversation" && observation.workspaceKey !== undefined
      ? observation.workspaceKey
      : observation.kind === "workspace" && observation.workspaceKey !== undefined
        ? observation.workspaceKey
        : `conversation:${conversationKey}`;
  const projectedWorkspaceId = workspaceId(projectedId("aionui-shadow-workspace", workspaceKey));
  const graph: DomainGraph = {
    workspaces: [
      {
        id: projectedWorkspaceId,
        name: "AionUi shadow workspace",
        state: "active",
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ],
    tasks: [],
    sessions: [],
    workers: [],
    approvals: [],
    artifacts: [],
  };

  if (observation.kind === "workspace") {
    return freezeGraph(graph);
  }

  const providerKey =
    observation.kind === "provider"
      ? observation.providerId
      : observation.kind === "conversation" && observation.providerKey !== undefined
        ? observation.providerKey
        : `native:${conversationKey}`;
  const projectedWorkerId = workerId(projectedId("aionui-shadow-worker", providerKey));

  if (observation.kind === "provider") {
    return freezeGraph({
      ...graph,
      workers: [
        {
          id: projectedWorkerId,
          workspaceId: projectedWorkspaceId,
          adapterKind: "aionui-native-shadow",
          state: observation.available ? "ready" : "stopped",
          createdAt: capturedAt,
          updatedAt: capturedAt,
        },
      ],
    });
  }

  const taskState = stateForObservation(observation);
  if (taskState === undefined) {
    throw new AionUiShadowProjectionError(
      "projection-failed",
      "AionUi observation did not produce a task state",
    );
  }
  const projectedTaskId = taskId(projectedId("aionui-shadow-task", conversationKey));
  const projectedSessionId = sessionId(projectedId("aionui-shadow-session", conversationKey));
  const sessionState = sessionStateForTask(taskState, observation);
  const workerState = workerStateForTask(taskState, observation);
  const terminalTask =
    taskState === "cancelled" || taskState === "completed" || taskState === "failed";

  const approvals =
    observation.kind === "approval"
      ? [
          {
            id: approvalId(projectedId("aionui-shadow-approval", observation.approvalId)),
            workspaceId: projectedWorkspaceId,
            taskId: projectedTaskId,
            sessionId: projectedSessionId,
            action: "Native AionUi confirmation",
            state: observation.state === "unknown" ? ("pending" as const) : observation.state,
            requestedAt: capturedAt,
            ...(observation.state === "pending" || observation.state === "unknown"
              ? {}
              : { resolvedAt: capturedAt }),
          },
        ]
      : [];
  const artifacts =
    observation.kind === "artifact"
      ? [
          {
            id: artifactId(projectedId("aionui-shadow-artifact", observation.artifactId)),
            workspaceId: projectedWorkspaceId,
            taskId: projectedTaskId,
            sessionId: projectedSessionId,
            kind: "other" as const,
            label: "Native AionUi artifact",
            state:
              observation.status === "dismissed" ? ("superseded" as const) : ("available" as const),
            createdAt: capturedAt,
            updatedAt: capturedAt,
          },
        ]
      : [];

  return freezeGraph({
    ...graph,
    tasks: [
      {
        id: projectedTaskId,
        workspaceId: projectedWorkspaceId,
        title: "Native AionUi conversation",
        state: taskState,
        ...(terminalTask ? {} : { activeSessionId: projectedSessionId }),
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ],
    sessions: [
      {
        id: projectedSessionId,
        workspaceId: projectedWorkspaceId,
        taskId: projectedTaskId,
        workerId: projectedWorkerId,
        state: sessionState,
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ],
    workers: [
      {
        id: projectedWorkerId,
        workspaceId: projectedWorkspaceId,
        adapterKind: "aionui-native-shadow",
        state: workerState,
        createdAt: capturedAt,
        updatedAt: capturedAt,
      },
    ],
    approvals,
    artifacts,
  });
}

function eventsForObservation(
  observation: AionUiNativeObservation,
  graph: DomainGraph,
  capturedAt: Instant,
): readonly CoreEvent[] {
  if (observation.kind !== "task" || observation.status === "pending") {
    return Object.freeze([]);
  }

  const workspace = graph.workspaces[0];
  const task = graph.tasks[0];
  const session = graph.sessions[0];
  const worker = graph.workers[0];
  if (
    workspace === undefined ||
    task === undefined ||
    session === undefined ||
    worker === undefined
  ) {
    throw new AionUiShadowProjectionError(
      "projection-failed",
      "AionUi task observation did not produce a complete P3 identity graph",
    );
  }

  const streamIdentity = `${observation.conversationId}\u0000${observation.turnId}`;
  const stream = eventStreamId(projectedId("aionui-shadow-stream", streamIdentity));
  const correlation = correlationId(projectedId("aionui-shadow-correlation", streamIdentity));
  const startId = eventId(projectedId("aionui-shadow-event", `${streamIdentity}\u0000start`));
  const started: CoreEvent<"task.started"> = Object.freeze({
    schemaVersion: CORE_EVENT_SCHEMA_VERSION,
    eventId: startId,
    streamId: stream,
    sequence: 1,
    occurredAt: capturedAt,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    workerId: worker.id,
    correlationId: correlation,
    type: "task.started",
    redaction: REQUIRED_REDACTION_BY_EVENT_TYPE["task.started"],
    payload: Object.freeze({
      from: "ready",
      to: "running",
    }),
  });

  if (observation.status === "running") {
    return Object.freeze([started]);
  }

  const terminalId = eventId(projectedId("aionui-shadow-event", `${streamIdentity}\u0000terminal`));
  const common = {
    schemaVersion: CORE_EVENT_SCHEMA_VERSION,
    eventId: terminalId,
    streamId: stream,
    sequence: 2,
    occurredAt: capturedAt,
    workspaceId: workspace.id,
    taskId: task.id,
    sessionId: session.id,
    workerId: worker.id,
    correlationId: correlation,
    causationId: startId,
  } as const;
  const terminal: CoreEvent =
    observation.status === "finished"
      ? Object.freeze({
          ...common,
          type: "task.completed",
          redaction: REQUIRED_REDACTION_BY_EVENT_TYPE["task.completed"],
          payload: Object.freeze({
            from: "running",
            to: "completed",
          }),
        })
      : observation.status === "cancelled"
        ? Object.freeze({
            ...common,
            type: "task.cancelled",
            redaction: REQUIRED_REDACTION_BY_EVENT_TYPE["task.cancelled"],
            payload: Object.freeze({
              from: "running",
              to: "cancelled",
              reason: "Native runtime reported cancellation",
            }),
          })
        : Object.freeze({
            ...common,
            type: "task.failed",
            redaction: REQUIRED_REDACTION_BY_EVENT_TYPE["task.failed"],
            payload: Object.freeze({
              from: "running",
              to: "failed",
              errorCode: "AIONUI_NATIVE_TASK_FAILED",
              message: "Native runtime reported failure",
            }),
          });
  return Object.freeze([started, terminal]);
}

function revisionInput(observation: AionUiNativeObservation): unknown {
  const { observedAtMs: _observedAtMs, ...stable } = observation;
  return stable;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new AionUiShadowProjectionError(
      "projection-failed",
      "AionUi observation contains a non-JSON revision value",
    );
  }
  return encoded;
}

export function projectAionUiObservation(value: unknown): AionUiShadowEvidence {
  try {
    assertAionUiNativeObservation(value);
    const capturedAt = canonicalInstant(sourceTimestamp(value));
    const nativeIdentityHash = hash(
      `${AIONUI_NATIVE_SOURCE_VERSION}\u0000${value.kind}\u0000${value.nativeId}`,
    );
    const nativeRevisionHash = hash(canonicalJson(revisionInput(value)));
    const graph = graphForObservation(value, capturedAt);
    assertDomainGraph(graph);
    const events = eventsForObservation(value, graph, capturedAt);
    assertCoreEventStream(events);

    const evidence = Object.freeze({
      contractVersion: AIONUI_SHADOW_EVIDENCE_CONTRACT_VERSION,
      evidenceId: projectedId(
        "aionui-shadow-evidence",
        `${value.kind}\u0000${nativeIdentityHash}\u0000${nativeRevisionHash}`,
      ),
      capturedAt,
      source: `aionui-v${AIONUI_NATIVE_SOURCE_VERSION}`,
      domain: value.kind,
      nativeIdentityHash,
      nativeRevisionHash,
      redaction: AIONUI_SHADOW_REDACTION,
      graph,
      events,
    }) satisfies AionUiShadowEvidence;
    assertAionUiShadowEvidence(evidence);
    return evidence;
  } catch (error) {
    if (error instanceof AionUiShadowProjectionError) {
      throw error;
    }
    if (error instanceof AionUiShadowContractError) {
      throw new AionUiShadowProjectionError(
        "invalid-observation",
        "AionUi native metadata violates the observation contract",
        { cause: error },
      );
    }
    throw new AionUiShadowProjectionError(
      "projection-failed",
      "AionUi native metadata could not be projected into P3 shadow evidence",
      { cause: error },
    );
  }
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  kind: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new AionUiShadowProjectionError(
        "invalid-evidence",
        `${kind} contains undeclared field ${key}`,
      );
    }
  }
}

function sha256String(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      `${field} must be a SHA-256 hex digest`,
    );
  }
  return value;
}

function assertEvidenceComponent(validation: () => void, message: string): void {
  try {
    validation();
  } catch (error) {
    if (error instanceof AionUiShadowProjectionError) {
      throw error;
    }
    throw new AionUiShadowProjectionError("invalid-evidence", message, {
      cause: error,
    });
  }
}

export function assertAionUiShadowEvidence(value: unknown): asserts value is AionUiShadowEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence must be an object",
    );
  }
  const record = value as Record<string, unknown>;
  exactKeys(
    record,
    [
      "capturedAt",
      "contractVersion",
      "domain",
      "events",
      "evidenceId",
      "graph",
      "nativeIdentityHash",
      "nativeRevisionHash",
      "redaction",
      "source",
    ],
    "AionUi shadow evidence",
  );
  if (record.contractVersion !== AIONUI_SHADOW_EVIDENCE_CONTRACT_VERSION) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence must use contract version 1",
    );
  }
  if (
    record.domain !== "approval" &&
    record.domain !== "artifact" &&
    record.domain !== "conversation" &&
    record.domain !== "provider" &&
    record.domain !== "runtime" &&
    record.domain !== "task" &&
    record.domain !== "workspace"
  ) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence domain is unsupported",
    );
  }
  if (
    typeof record.evidenceId !== "string" ||
    !/^aionui-shadow-evidence-[a-f0-9]{32}$/u.test(record.evidenceId)
  ) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence identifier is invalid",
    );
  }
  assertEvidenceComponent(() => {
    instant(record.capturedAt as string);
  }, "AionUi shadow evidence capture timestamp is invalid");
  if (record.source !== `aionui-v${AIONUI_NATIVE_SOURCE_VERSION}`) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence source is invalid",
    );
  }
  if (record.redaction !== AIONUI_SHADOW_REDACTION) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence must remain metadata-only",
    );
  }
  const nativeIdentityHash = sha256String(record.nativeIdentityHash, "nativeIdentityHash");
  const nativeRevisionHash = sha256String(record.nativeRevisionHash, "nativeRevisionHash");
  const expectedEvidenceId = projectedId(
    "aionui-shadow-evidence",
    `${record.domain}\u0000${nativeIdentityHash}\u0000${nativeRevisionHash}`,
  );
  if (record.evidenceId !== expectedEvidenceId) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence identifier does not match its native revision",
    );
  }
  assertEvidenceComponent(() => {
    assertDomainGraph(record.graph as DomainGraph);
  }, "AionUi shadow evidence graph violates the core domain contract");
  if (!Array.isArray(record.events)) {
    throw new AionUiShadowProjectionError(
      "invalid-evidence",
      "AionUi shadow evidence events must be an array",
    );
  }
  assertEvidenceComponent(() => {
    assertCoreEventStream(record.events as CoreEvent[]);
  }, "AionUi shadow evidence events violate the core event contract");
}
