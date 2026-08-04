import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  advanceCoreEventStreamState,
  assertApprovalRequestSnapshot,
  assertApprovalTransition,
  assertDomainGraph,
  assertProtectedOperation,
  assertSessionTransition,
  assertTaskTransition,
  assertWorkerTransition,
  compareInstants,
  correlationId,
  createCoreEventStreamState,
  eventId,
  eventStreamId,
  instant,
  type ActestraPersistencePort,
  type Approval,
  type ApprovalActorId,
  type ApprovalRequestSnapshot,
  type ApprovalService,
  type CoreEvent,
  type CoreEventStreamState,
  type CoreEventType,
  type CorrelationId,
  type EventId,
  type EventPayloadByType,
  type EventStreamId,
  type Instant,
  type PrivilegedClock,
  type ProtectedOperation,
  type SessionId,
  type SessionState,
  type TaskId,
  type TaskState,
  type ToolRequestId,
  type WorkerId,
  type WorkerState,
  type WorkspaceId,
} from "../../core";
import { withPersistenceMutationBarrier } from "../persistence/persistenceMutationBarrier";
import type { GooseAcpPromptResult } from "./gooseAcpHandshake";
import type {
  GooseCodingToolEvidenceRecorder,
  GooseCodingToolFailureEvidence,
} from "./gooseCodingToolInvoker";

const MAX_DURABLE_ASSISTANT_MESSAGE_BYTES = 1024 * 1024;

export type GooseCodingEvidenceErrorCode =
  | "identity-mismatch"
  | "invalid-state"
  | "invalid-evidence";

export class GooseCodingEvidenceError extends Error {
  constructor(
    readonly code: GooseCodingEvidenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseCodingEvidenceError";
  }
}

export interface GooseCodingEvidenceIdentity {
  readonly streamId: EventStreamId;
  readonly correlationId: CorrelationId;
}

export interface GooseCodingEvidenceCoordinatorConfig {
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly identity: GooseCodingEvidenceIdentity;
  readonly approvalService: ApprovalService;
  readonly cancellationActorId: ApprovalActorId;
  readonly newEventId?: () => EventId;
}

interface DomainProjection {
  readonly taskState: TaskState;
  readonly sessionState: SessionState;
  readonly workerState: WorkerState;
}

function maximumInstant(...values: readonly Instant[]): Instant {
  return values.reduce((latest, value) => (compareInstants(value, latest) > 0 ? value : latest));
}

function defaultEventId(): EventId {
  return eventId(`event-coding-${randomUUID()}`);
}

export function deriveGooseCodingEvidenceIdentity(options: {
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
}): GooseCodingEvidenceIdentity {
  const digest = createHash("sha256")
    .update(
      [
        "actestra-goose-coding-evidence-v1",
        options.workspaceId,
        options.taskId,
        options.sessionId,
        options.workerId,
      ].join("\u0000"),
    )
    .digest("hex");
  return Object.freeze({
    streamId: eventStreamId(`stream-coding-${digest}`),
    correlationId: correlationId(`correlation-coding-${digest}`),
  });
}

export class GooseCodingEvidenceCoordinator implements GooseCodingToolEvidenceRecorder {
  private readonly newEventId: () => EventId;
  private readonly events: CoreEvent[] = [];
  private eventState: CoreEventStreamState = createCoreEventStreamState([]);
  private persistedEventCount = 0;
  private projection: DomainProjection = Object.freeze({
    taskState: "running",
    sessionState: "running",
    workerState: "busy",
  });
  private operationTail: Promise<void> = Promise.resolve();
  private startPrepared = false;
  private promptResult: GooseAcpPromptResult | undefined;
  private promptTarget: DomainProjection | undefined;
  private promptCancelledApprovals:
    | readonly (readonly [ToolRequestId, ApprovalRequestSnapshot])[]
    | undefined;
  private openingFailurePrepared = false;
  private promptFailurePrepared = false;
  private cancellationPrepared = false;
  private readonly toolStates = new Map<
    ToolRequestId,
    "requested" | "approval-pending" | "approval-resolved" | "terminal"
  >();
  private readonly pendingApprovals = new Map<ToolRequestId, ApprovalRequestSnapshot>();
  private readonly approvalCancellationPrepared = new Set<ToolRequestId>();

  constructor(private readonly config: GooseCodingEvidenceCoordinatorConfig) {
    this.newEventId = config.newEventId ?? defaultEventId;
  }

  start(): Promise<void> {
    return this.serialize(async () => {
      if (!this.startPrepared) {
        await this.requireInitialAuthority();
        const existing = await this.config.persistence.replayEvents(this.config.identity.streamId);
        if (existing.length > 0) {
          throw new GooseCodingEvidenceError(
            "invalid-state",
            "A fresh Goose coding attempt cannot reuse an existing event stream",
          );
        }
        this.queueEvent("task.started", { from: "ready", to: "running" });
        this.startPrepared = true;
      }
      await this.flushEvents();
    });
  }

  recordRequested(operation: ProtectedOperation): Promise<void> {
    return this.serialize(async () => {
      this.requireOperation(operation);
      if (this.requireTaskState() !== "running" || this.toolStates.has(operation.requestId)) {
        throw new GooseCodingEvidenceError(
          "invalid-state",
          "A Goose coding tool request requires one unique running Task operation",
        );
      }
      this.queueEvent("tool.requested", {
        requestId: operation.requestId,
        toolName: operation.toolId,
        summary: operation.summary,
      });
      this.toolStates.set(operation.requestId, "requested");
      await this.flushEvents();
    });
  }

  recordApprovalRequired(
    operation: ProtectedOperation,
    approval: ApprovalRequestSnapshot,
  ): Promise<void> {
    return this.serialize(async () => {
      this.requireApproval(operation, approval, "pending");
      if (this.toolStates.get(operation.requestId) !== "requested") {
        throw new GooseCodingEvidenceError(
          "invalid-state",
          "Approval evidence requires one requested Goose coding operation",
        );
      }
      const from = this.requireTaskState();
      if (from !== "running") {
        throw new GooseCodingEvidenceError(
          "invalid-state",
          "Approval evidence can block only a running Goose coding Task",
        );
      }
      this.queueEvent("approval.required", {
        approvalId: approval.approvalId,
        action: approval.operation.action,
        expiresAt: approval.expiresAt,
      });
      this.queueEvent("task.updated", {
        from,
        to: "blocked",
        reason: "coding-approval-required",
      });
      this.queueEvent("worker.blocked", {
        reason: "approval",
        approvalId: approval.approvalId,
      });
      this.toolStates.set(operation.requestId, "approval-pending");
      this.pendingApprovals.set(operation.requestId, approval);
      await this.flushEvents();
      await this.reconcileProjection(
        Object.freeze({
          taskState: "blocked",
          sessionState: "blocked",
          workerState: "busy",
        }),
        approval,
      );
    });
  }

  recordApprovalResolved(
    operation: ProtectedOperation,
    approval: ApprovalRequestSnapshot,
  ): Promise<void> {
    return this.serialize(async () => {
      this.requireApproval(operation, approval, approval.state);
      if (
        (approval.state !== "approved" && approval.state !== "denied") ||
        approval.resolvedAt === undefined ||
        this.toolStates.get(operation.requestId) !== "approval-pending"
      ) {
        throw new GooseCodingEvidenceError(
          "invalid-state",
          "Approval resolution requires the matching pending Goose coding operation",
        );
      }
      const from = this.requireTaskState();
      if (from !== "blocked") {
        throw new GooseCodingEvidenceError(
          "invalid-state",
          "Approval resolution can resume only the blocked Goose coding Task",
        );
      }
      this.queueEvent("approval.resolved", {
        approvalId: approval.approvalId,
        decision: approval.state,
      });
      this.queueEvent("task.updated", {
        from,
        to: "running",
        reason: `coding-approval-${approval.state}`,
      });
      this.toolStates.set(operation.requestId, "approval-resolved");
      await this.flushEvents();
      await this.reconcileProjection(
        Object.freeze({
          taskState: "running",
          sessionState: "running",
          workerState: "busy",
        }),
        approval,
      );
      this.pendingApprovals.delete(operation.requestId);
    });
  }

  recordCompleted(operation: ProtectedOperation, summary: string): Promise<void> {
    return this.serialize(async () => {
      this.requireOperation(operation);
      const state = this.toolStates.get(operation.requestId);
      if (
        (state !== "requested" && state !== "approval-resolved") ||
        this.requireTaskState() !== "running" ||
        typeof summary !== "string" ||
        summary.length < 1 ||
        summary.length > 4_096
      ) {
        throw new GooseCodingEvidenceError(
          "invalid-evidence",
          "Goose coding completion evidence does not match an active requested operation",
        );
      }
      this.queueEvent("tool.started", { requestId: operation.requestId });
      this.queueEvent("tool.completed", { requestId: operation.requestId, summary });
      this.toolStates.set(operation.requestId, "terminal");
      await this.flushEvents();
    });
  }

  recordFailed(
    operation: ProtectedOperation,
    failure: GooseCodingToolFailureEvidence,
  ): Promise<void> {
    return this.serialize(async () => {
      this.requireOperation(operation);
      const state = this.toolStates.get(operation.requestId);
      if (
        (state !== "requested" && state !== "approval-resolved") ||
        this.requireTaskState() !== "running" ||
        typeof failure.errorCode !== "string" ||
        failure.errorCode.length < 1 ||
        failure.errorCode.length > 128 ||
        typeof failure.message !== "string" ||
        failure.message.length < 1 ||
        failure.message.length > 4_096 ||
        typeof failure.mayHaveExecuted !== "boolean"
      ) {
        throw new GooseCodingEvidenceError(
          "invalid-evidence",
          "Goose coding failure evidence does not match an active requested operation",
        );
      }
      this.queueEvent("tool.failed", {
        requestId: operation.requestId,
        errorCode: failure.errorCode,
        message: failure.message,
        mayHaveExecuted: failure.mayHaveExecuted,
      });
      this.toolStates.set(operation.requestId, "terminal");
      await this.flushEvents();
    });
  }

  completePrompt(result: GooseAcpPromptResult): Promise<void> {
    return this.serialize(async () => {
      if (this.promptResult === undefined) {
        const message = result.updates
          .filter(
            (
              update,
            ): update is Extract<
              (typeof result.updates)[number],
              { type: "agent_message_chunk" }
            > => update.type === "agent_message_chunk",
          )
          .map((update) => update.text)
          .join("");
        if (Buffer.byteLength(message, "utf8") > MAX_DURABLE_ASSISTANT_MESSAGE_BYTES) {
          throw new GooseCodingEvidenceError(
            "invalid-evidence",
            "Goose assistant evidence exceeds the durable message boundary",
          );
        }
        if (message.length > 0) {
          this.queueEvent("agent.message", { role: "assistant", content: message });
        }
        if (result.stopReason === "cancelled") {
          this.promptCancelledApprovals = await this.preparePendingApprovalCancellations();
          this.queueEvent("task.cancelled", {
            from: this.requireTaskState(),
            to: "cancelled",
            reason: "goose-prompt-cancelled",
          });
          this.promptTarget = Object.freeze({
            taskState: "cancelled",
            sessionState: "cancelled",
            workerState: "stopping",
          });
        } else {
          const from = this.requireTaskState();
          if (from !== "running" && from !== "blocked") {
            throw new GooseCodingEvidenceError(
              "invalid-state",
              "A completed Goose prompt must still own a running or blocked Actestra Task",
            );
          }
          if (from === "running") {
            this.queueEvent("task.updated", {
              from,
              to: "blocked",
              reason: `coding-review-required:${result.stopReason}`,
            });
          }
          this.promptTarget = Object.freeze({
            taskState: "blocked",
            sessionState: "blocked",
            workerState: "ready",
          });
        }
        this.promptResult = Object.freeze({
          ...result,
          ...(result.usage === undefined ? {} : { usage: Object.freeze({ ...result.usage }) }),
          updates: Object.freeze([...result.updates]),
        });
      } else if (!isDeepStrictEqual(this.promptResult, result)) {
        throw new GooseCodingEvidenceError(
          "invalid-evidence",
          "A Goose prompt retry returned different normalized evidence",
        );
      }
      await this.flushEvents();
      if (this.promptCancelledApprovals !== undefined) {
        await this.reconcileCancelledApprovals(this.promptCancelledApprovals);
      }
      await this.reconcileProjection(this.promptTarget!);
      this.promptCancelledApprovals = undefined;
    });
  }

  failPrompt(): Promise<void> {
    return this.serialize(async () => {
      const state = this.requireTaskState();
      if (
        (state === "completed" || state === "failed" || state === "cancelled") &&
        !this.promptFailurePrepared
      ) {
        return;
      }
      const cancelledApprovals = await this.preparePendingApprovalCancellations();
      if (!this.promptFailurePrepared) {
        const message = "The isolated Goose prompt failed before review evidence was available.";
        this.queueEvent("worker.failed", {
          errorCode: "goose-prompt-failed",
          message,
          retryable: false,
        });
        this.queueEvent("task.failed", {
          from: state,
          to: "failed",
          errorCode: "goose-prompt-failed",
          message,
        });
        this.promptFailurePrepared = true;
      }
      await this.flushEvents();
      await this.reconcileCancelledApprovals(cancelledApprovals);
      await this.reconcileProjection(
        Object.freeze({
          taskState: "failed",
          sessionState: "failed",
          workerState: "crashed",
        }),
      );
    });
  }

  failOpen(): Promise<void> {
    return this.serialize(async () => {
      if (!this.startPrepared) {
        return;
      }
      const state = this.requireTaskState();
      if (
        (state === "completed" || state === "failed" || state === "cancelled") &&
        !this.openingFailurePrepared
      ) {
        return;
      }
      if (!this.openingFailurePrepared) {
        const message = "The isolated Goose session failed before coding became available.";
        this.queueEvent("worker.failed", {
          errorCode: "goose-session-open-failed",
          message,
          retryable: false,
        });
        this.queueEvent("task.failed", {
          from: state,
          to: "failed",
          errorCode: "goose-session-open-failed",
          message,
        });
        this.openingFailurePrepared = true;
      }
      await this.flushEvents();
      await this.reconcileProjection(
        Object.freeze({
          taskState: "failed",
          sessionState: "failed",
          workerState: "crashed",
        }),
      );
    });
  }

  cancel(): Promise<void> {
    return this.serialize(async () => {
      const state = this.requireTaskState();
      const cancelledApprovals = await this.preparePendingApprovalCancellations();
      if (
        state !== "cancelled" &&
        state !== "failed" &&
        state !== "completed" &&
        !this.cancellationPrepared
      ) {
        this.queueEvent("task.cancelled", {
          from: state,
          to: "cancelled",
          reason: "coding-session-closed",
        });
        this.cancellationPrepared = true;
      }
      await this.flushEvents();
      await this.reconcileCancelledApprovals(cancelledApprovals);
      if (this.cancellationPrepared) {
        await this.reconcileProjection(
          Object.freeze({
            taskState: "cancelled",
            sessionState: "cancelled",
            workerState: "stopping",
          }),
        );
      }
    });
  }

  private async preparePendingApprovalCancellations(): Promise<
    readonly (readonly [ToolRequestId, ApprovalRequestSnapshot])[]
  > {
    const cancelledApprovals: Array<readonly [ToolRequestId, ApprovalRequestSnapshot]> = [];
    for (const [requestId, pending] of this.pendingApprovals) {
      let resolved = pending;
      if (pending.state === "pending") {
        try {
          resolved = await this.config.approvalService.resolve(
            pending.approvalId,
            "cancelled",
            this.config.cancellationActorId,
          );
        } catch (error) {
          const committed = await this.config.approvalService.get(pending.approvalId);
          if (committed !== undefined) {
            this.requireCancelledApproval(pending, committed);
            this.pendingApprovals.set(requestId, committed);
          }
          throw error;
        }
      }
      this.requireCancelledApproval(pending, resolved);
      this.pendingApprovals.set(requestId, resolved);
      if (!this.approvalCancellationPrepared.has(requestId)) {
        this.queueEvent("approval.resolved", {
          approvalId: resolved.approvalId,
          decision: "cancelled",
        });
        this.queueEvent("tool.failed", {
          requestId,
          errorCode: "approval-cancelled",
          message: "The pending coding approval was cancelled with the coding session.",
          mayHaveExecuted: false,
        });
        this.toolStates.set(requestId, "terminal");
        this.approvalCancellationPrepared.add(requestId);
      }
      cancelledApprovals.push(Object.freeze([requestId, resolved]));
    }
    return Object.freeze(cancelledApprovals);
  }

  private async reconcileCancelledApprovals(
    approvals: readonly (readonly [ToolRequestId, ApprovalRequestSnapshot])[],
  ): Promise<void> {
    for (const [requestId, approval] of approvals) {
      await this.reconcileProjection(this.projection, approval);
      this.pendingApprovals.delete(requestId);
      this.approvalCancellationPrepared.delete(requestId);
    }
  }

  private requireCancelledApproval(
    pending: ApprovalRequestSnapshot,
    resolved: ApprovalRequestSnapshot,
  ): void {
    this.requireApproval(pending.operation, resolved, "cancelled");
    if (
      resolved.approvalId !== pending.approvalId ||
      resolved.policyRevision !== pending.policyRevision ||
      resolved.requestedAt !== pending.requestedAt ||
      resolved.expiresAt !== pending.expiresAt ||
      resolved.resolvedAt === undefined ||
      resolved.resolvedBy !== this.config.cancellationActorId
    ) {
      throw new GooseCodingEvidenceError(
        "identity-mismatch",
        "Cancelled coding approval evidence changed the pending request snapshot",
      );
    }
  }

  finishClose(): Promise<void> {
    return this.serialize(async () => {
      if (this.projection.workerState !== "stopping") {
        return;
      }
      await this.reconcileProjection(
        Object.freeze({
          taskState: this.projection.taskState,
          sessionState: this.projection.sessionState,
          workerState: "stopped",
        }),
      );
    });
  }

  private serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    return result;
  }

  private requireTaskState(): TaskState {
    const state = this.eventState.taskState;
    if (state === undefined) {
      throw new GooseCodingEvidenceError(
        "invalid-state",
        "Goose coding evidence has no started Task state",
      );
    }
    return state;
  }

  private queueEvent<Type extends CoreEventType>(
    type: Type,
    payload: EventPayloadByType[Type],
  ): void {
    const previous = this.events.at(-1);
    const now = this.config.clock.now();
    instant(now);
    const occurredAt = previous === undefined ? now : maximumInstant(now, previous.occurredAt);
    const next = Object.freeze({
      schemaVersion: 1,
      eventId: eventId(this.newEventId()),
      streamId: this.config.identity.streamId,
      sequence: (previous?.sequence ?? 0) + 1,
      occurredAt,
      workspaceId: this.config.workspaceId,
      taskId: this.config.taskId,
      sessionId: this.config.sessionId,
      workerId: this.config.workerId,
      correlationId: this.config.identity.correlationId,
      ...(previous === undefined ? {} : { causationId: previous.eventId }),
      type,
      redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
      payload,
    }) as CoreEvent<Type>;
    this.eventState = advanceCoreEventStreamState(this.eventState, next);
    this.events.push(next as CoreEvent);
  }

  private async flushEvents(): Promise<void> {
    while (this.persistedEventCount < this.events.length) {
      const event = this.events[this.persistedEventCount]!;
      try {
        await this.config.persistence.appendEvent(event);
      } catch (error) {
        let committed: CoreEvent | undefined;
        try {
          committed = (await this.config.persistence.replayEvents(event.streamId)).find(
            (candidate) => candidate.sequence === event.sequence,
          );
        } catch {
          // Preserve the append failure when its commit cannot be proven.
        }
        if (!isDeepStrictEqual(committed, event)) {
          throw error;
        }
      }
      this.persistedEventCount += 1;
    }
  }

  private async requireInitialAuthority(): Promise<void> {
    await withPersistenceMutationBarrier(this.config.persistence, async () => {
      const graph = await this.config.persistence.loadDomainGraph();
      const records = this.requireRecords(graph);
      if (
        records.task.state !== "running" ||
        records.task.activeSessionId !== this.config.sessionId ||
        records.session.state !== "running" ||
        records.worker.state !== "busy"
      ) {
        throw new GooseCodingEvidenceError(
          "invalid-state",
          "Goose coding evidence requires the exact running Task, Session, and Worker",
        );
      }
    });
  }

  private async reconcileProjection(
    target: DomainProjection,
    approval?: ApprovalRequestSnapshot,
  ): Promise<void> {
    await withPersistenceMutationBarrier(this.config.persistence, async () => {
      const graph = await this.config.persistence.loadDomainGraph();
      const records = this.requireRecords(graph);
      const current = Object.freeze({
        taskState: records.task.state,
        sessionState: records.session.state,
        workerState: records.worker.state,
      });
      const targetApproval = approval === undefined ? undefined : this.approvalRecord(approval);
      const existingApproval =
        targetApproval === undefined
          ? undefined
          : graph.approvals.find(({ id }) => id === targetApproval.id);
      let nextApprovals = graph.approvals;
      if (targetApproval !== undefined && !isDeepStrictEqual(existingApproval, targetApproval)) {
        if (existingApproval === undefined) {
          if (targetApproval.state !== "pending") {
            throw new GooseCodingEvidenceError(
              "invalid-state",
              "Terminal coding approval evidence has no pending domain record",
            );
          }
          nextApprovals = [...graph.approvals, targetApproval];
        } else {
          if (
            existingApproval.workspaceId !== targetApproval.workspaceId ||
            existingApproval.taskId !== targetApproval.taskId ||
            existingApproval.sessionId !== targetApproval.sessionId ||
            existingApproval.action !== targetApproval.action ||
            existingApproval.requestedAt !== targetApproval.requestedAt ||
            existingApproval.expiresAt !== targetApproval.expiresAt
          ) {
            throw new GooseCodingEvidenceError(
              "identity-mismatch",
              "Coding approval evidence conflicts with the authoritative domain record",
            );
          }
          assertApprovalTransition(existingApproval.state, targetApproval.state);
          nextApprovals = graph.approvals.map((candidate) =>
            candidate.id === targetApproval.id ? targetApproval : candidate,
          );
        }
      }
      if (!isDeepStrictEqual(current, target) || nextApprovals !== graph.approvals) {
        if (!isDeepStrictEqual(current, this.projection)) {
          throw new GooseCodingEvidenceError(
            "invalid-state",
            "Authoritative coding Task, Session, or Worker state changed concurrently",
          );
        }
        if (records.task.state !== target.taskState) {
          assertTaskTransition(records.task.state, target.taskState);
        }
        if (records.session.state !== target.sessionState) {
          assertSessionTransition(records.session.state, target.sessionState);
        }
        if (records.worker.state !== target.workerState) {
          assertWorkerTransition(records.worker.state, target.workerState);
        }
        const now = this.config.clock.now();
        instant(now);
        const next = {
          ...graph,
          tasks: graph.tasks.map((task) =>
            task.id === this.config.taskId
              ? Object.freeze({
                  ...task,
                  state: target.taskState,
                  ...(target.taskState === "running" || target.taskState === "blocked"
                    ? { activeSessionId: this.config.sessionId }
                    : { activeSessionId: undefined }),
                  updatedAt: maximumInstant(task.updatedAt, now),
                })
              : task,
          ),
          sessions: graph.sessions.map((session) =>
            session.id === this.config.sessionId
              ? Object.freeze({
                  ...session,
                  state: target.sessionState,
                  updatedAt: maximumInstant(session.updatedAt, now),
                })
              : session,
          ),
          workers: graph.workers.map((worker) =>
            worker.id === this.config.workerId
              ? Object.freeze({
                  ...worker,
                  state: target.workerState,
                  updatedAt: maximumInstant(worker.updatedAt, now),
                })
              : worker,
          ),
          approvals: nextApprovals,
        };
        assertDomainGraph(next);
        try {
          await this.config.persistence.replaceDomainGraph(next);
        } catch (error) {
          let committed = false;
          try {
            committed = this.projectionMatches(
              await this.config.persistence.loadDomainGraph(),
              target,
              targetApproval,
            );
          } catch {
            // Preserve the original write failure when its commit cannot be proven.
          }
          if (!committed) {
            throw error;
          }
        }
      }
      this.projection = target;
    });
  }

  private projectionMatches(
    graph: Awaited<ReturnType<ActestraPersistencePort["loadDomainGraph"]>>,
    target: DomainProjection,
    approval?: Approval,
  ): boolean {
    const records = this.requireRecords(graph);
    if (
      records.task.state !== target.taskState ||
      records.session.state !== target.sessionState ||
      records.worker.state !== target.workerState
    ) {
      return false;
    }
    return (
      approval === undefined ||
      isDeepStrictEqual(
        graph.approvals.find(({ id }) => id === approval.id),
        approval,
      )
    );
  }

  private requireOperation(operation: ProtectedOperation): void {
    assertProtectedOperation(operation);
    if (
      operation.workspaceId !== this.config.workspaceId ||
      operation.taskId !== this.config.taskId ||
      operation.sessionId !== this.config.sessionId ||
      operation.workerId !== this.config.workerId
    ) {
      throw new GooseCodingEvidenceError(
        "identity-mismatch",
        "Goose coding tool evidence changed the authoritative operation identity",
      );
    }
  }

  private requireApproval(
    operation: ProtectedOperation,
    approval: ApprovalRequestSnapshot,
    state: ApprovalRequestSnapshot["state"],
  ): void {
    this.requireOperation(operation);
    assertApprovalRequestSnapshot(approval);
    if (approval.state !== state || !isDeepStrictEqual(approval.operation, operation)) {
      throw new GooseCodingEvidenceError(
        "identity-mismatch",
        "Goose coding approval evidence changed the protected operation",
      );
    }
  }

  private approvalRecord(approval: ApprovalRequestSnapshot): Approval {
    return Object.freeze({
      id: approval.approvalId,
      workspaceId: this.config.workspaceId,
      taskId: this.config.taskId,
      sessionId: this.config.sessionId,
      action: approval.operation.action,
      state: approval.state,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt,
      ...(approval.resolvedAt === undefined ? {} : { resolvedAt: approval.resolvedAt }),
    });
  }

  private requireRecords(graph: Awaited<ReturnType<ActestraPersistencePort["loadDomainGraph"]>>) {
    const workspace = graph.workspaces.find(({ id }) => id === this.config.workspaceId);
    const task = graph.tasks.find(({ id }) => id === this.config.taskId);
    const session = graph.sessions.find(({ id }) => id === this.config.sessionId);
    const worker = graph.workers.find(({ id }) => id === this.config.workerId);
    if (
      workspace?.state !== "active" ||
      task?.workspaceId !== this.config.workspaceId ||
      session?.workspaceId !== this.config.workspaceId ||
      session.taskId !== this.config.taskId ||
      session.workerId !== this.config.workerId ||
      worker?.workspaceId !== this.config.workspaceId ||
      worker.adapterKind !== "goose"
    ) {
      throw new GooseCodingEvidenceError(
        "identity-mismatch",
        "Goose coding evidence does not match the authoritative domain graph",
      );
    }
    return { task, session, worker };
  }
}
