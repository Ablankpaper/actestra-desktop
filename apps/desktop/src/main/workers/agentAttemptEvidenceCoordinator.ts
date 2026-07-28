import {
  AgentAdapterError,
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  TERMINAL_AGENT_ATTEMPT_STATES,
  assertAgentAttemptEvidence,
  type AgentAttemptEvidence,
  type CorePersistencePort,
  type PersistEventResult,
  type PlatformEvidencePersistencePort,
  type SessionId,
} from "../../core";
import { AgentAdapterSupervisor, type AgentAttemptSnapshot } from "./agentAdapterSupervisor";

export interface AgentAttemptEvidenceCoordinatorConfig {
  readonly supervisor: AgentAdapterSupervisor;
  readonly corePersistence: Pick<CorePersistencePort, "appendEvent">;
  readonly evidencePersistence: Pick<PlatformEvidencePersistencePort, "appendAgentAttemptEvidence">;
}

export interface PersistedAttemptRelease {
  readonly evidence: AgentAttemptEvidence;
  readonly eventResults: readonly PersistEventResult[];
  readonly evidenceResult: {
    readonly status: "appended" | "duplicate";
  };
}

export class AgentAttemptEvidenceCoordinator {
  private readonly inFlightReleases = new Map<SessionId, Promise<PersistedAttemptRelease>>();

  constructor(private readonly config: AgentAttemptEvidenceCoordinatorConfig) {}

  async persistAndRelease(session: SessionId): Promise<PersistedAttemptRelease> {
    const inFlight = this.inFlightReleases.get(session);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const release = this.persistAndReleaseOnce(session);
    this.inFlightReleases.set(session, release);
    try {
      return await release;
    } finally {
      if (this.inFlightReleases.get(session) === release) {
        this.inFlightReleases.delete(session);
      }
    }
  }

  private async persistAndReleaseOnce(session: SessionId): Promise<PersistedAttemptRelease> {
    const { supervisor } = this.config;
    const snapshot = supervisor.snapshot(session);
    if (
      !TERMINAL_AGENT_ATTEMPT_STATES.includes(
        snapshot.state as (typeof TERMINAL_AGENT_ATTEMPT_STATES)[number],
      )
    ) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${session} must be terminal before durable release`,
      );
    }
    if (!snapshot.disposed) {
      throw new AgentAdapterError(
        "invalid-state",
        `Session ${session} must finish adapter cleanup before durable release`,
      );
    }

    const events = supervisor.coreEvents(session);
    this.assertEventProjection(snapshot, events);
    const evidence = this.createEvidence(snapshot);
    const eventResults: PersistEventResult[] = [];
    for (const event of events) {
      eventResults.push(await this.config.corePersistence.appendEvent(event));
    }
    const evidenceResult =
      await this.config.evidencePersistence.appendAgentAttemptEvidence(evidence);

    await supervisor.dispose(session);
    return Object.freeze({
      evidence,
      eventResults: Object.freeze(eventResults),
      evidenceResult: Object.freeze({ ...evidenceResult }),
    });
  }

  private createEvidence(snapshot: AgentAttemptSnapshot): AgentAttemptEvidence {
    const evidence = Object.freeze({
      contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
      redaction: "metadata",
      workspaceId: snapshot.workspaceId,
      taskId: snapshot.taskId,
      correlationId: snapshot.correlationId,
      sessionId: snapshot.sessionId,
      workerId: snapshot.workerId,
      streamId: snapshot.streamId,
      state: snapshot.state as AgentAttemptEvidence["state"],
      ...(snapshot.taskState === undefined ? {} : { taskState: snapshot.taskState }),
      startedAt: snapshot.startedAt,
      lastSignalAt: snapshot.lastSignalAt,
      lastControlSequence: snapshot.lastControlSequence,
      lastCoreEventSequence: snapshot.lastCoreEventSequence,
      restartCount: snapshot.restartCount,
      ...(snapshot.restartedFromSessionId === undefined
        ? {}
        : { restartedFromSessionId: snapshot.restartedFromSessionId }),
      ...(snapshot.replacementSessionId === undefined
        ? {}
        : { replacementSessionId: snapshot.replacementSessionId }),
      disposed: true,
      forcedCancellation: snapshot.forcedCancellation,
      ...(snapshot.incident === undefined
        ? {}
        : {
            incident: Object.freeze({
              code: snapshot.incident.code,
              occurredAt: snapshot.incident.occurredAt,
            }),
          }),
    }) satisfies AgentAttemptEvidence;
    assertAgentAttemptEvidence(evidence);
    return evidence;
  }

  private assertEventProjection(
    snapshot: AgentAttemptSnapshot,
    events: ReturnType<AgentAdapterSupervisor["coreEvents"]>,
  ): void {
    if ((events.at(-1)?.sequence ?? 0) !== snapshot.lastCoreEventSequence) {
      throw new AgentAdapterError(
        "terminal-reconciliation-failed",
        `Session ${snapshot.sessionId} event projection is incomplete`,
      );
    }

    const mismatch = events.find(
      (event) =>
        event.workspaceId !== snapshot.workspaceId ||
        event.taskId !== snapshot.taskId ||
        event.correlationId !== snapshot.correlationId ||
        event.sessionId !== snapshot.sessionId ||
        event.workerId !== snapshot.workerId ||
        event.streamId !== snapshot.streamId,
    );
    if (mismatch !== undefined) {
      throw new AgentAdapterError(
        "terminal-reconciliation-failed",
        `Session ${snapshot.sessionId} event projection changed identity`,
      );
    }
  }
}
