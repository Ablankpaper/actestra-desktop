import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  PRIVILEGED_CONTRACT_VERSION,
  PrivilegedServiceError,
  ProtectedToolExecutionError,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  approvalActorId,
  assertApprovalRequestSnapshot,
  assertPersistContentReferenceResult,
  assertResolvedContentReference,
  assertStoreContentReferenceInput,
  assertWorkspaceGrant,
  codingToolDefinition,
  instant,
  parseCodingToolInput,
  sessionId,
  taskId,
  toolInputReference,
  toolRequestId,
  workerId,
  type ActestraPersistencePort,
  type ApprovalActorId,
  type ApprovalRequestSnapshot,
  type PrivilegedClock,
  type ProtectedOperation,
  type SessionId,
  type TaskId,
  type ToolGatewayResult,
  type ToolInputReference,
  type ToolRequestId,
  type UserApprovalDecision,
  type WorkerId,
  type WorkerResourceIncidentCode,
} from "../../core";
import type { IsolatedCodingMainSession } from "./isolatedCodingMainService";
import { WorkerStorageBudgetError, assertWorkerOutputWithinBudget } from "./workerStorageBudget";
import type {
  GooseMcpToolCall,
  GooseMcpToolInvocationResult,
  GooseMcpToolInvoker,
} from "./gooseMcpCapabilityServer";

export type GooseCodingToolInvokerErrorCode =
  | "invalid-config"
  | "invalid-call"
  | "persistence-failed"
  | "gateway-failed";

export class GooseCodingToolInvokerError extends Error {
  constructor(
    readonly code: GooseCodingToolInvokerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseCodingToolInvokerError";
  }
}

export interface CreateGooseCodingToolInvokerOptions {
  readonly persistence: ActestraPersistencePort;
  readonly clock: PrivilegedClock;
  readonly session: IsolatedCodingMainSession;
  readonly taskId: TaskId;
  readonly sessionId: SessionId;
  readonly workerId: WorkerId;
  readonly approvalDecisionHandler?: GooseCodingApprovalDecisionHandler;
  /** Suspends the Goose prompt inactivity deadline while a human decides. */
  readonly holdHumanDecision?: () => () => void;
  readonly evidenceRecorder?: GooseCodingToolEvidenceRecorder;
  readonly newToolRequestId?: () => ToolRequestId;
  readonly newToolInputReference?: () => ToolInputReference;
}

export interface GooseCodingApprovalDecisionRequest {
  readonly approval: ApprovalRequestSnapshot;
  readonly sessionId: string;
  readonly toolCallRequestId: string;
  readonly signal: AbortSignal;
}

export interface GooseCodingApprovalDecision {
  readonly decision: Exclude<UserApprovalDecision, "cancelled">;
  readonly actorId: ApprovalActorId;
}

export type GooseCodingApprovalDecisionHandler = (
  request: GooseCodingApprovalDecisionRequest,
) => Promise<GooseCodingApprovalDecision>;

export interface GooseCodingToolFailureEvidence {
  readonly errorCode: string;
  readonly message: string;
  readonly mayHaveExecuted: boolean;
}

export interface GooseCodingToolEvidenceRecorder {
  recordRequested(operation: ProtectedOperation): Promise<void>;
  recordApprovalRequired(
    operation: ProtectedOperation,
    approval: ApprovalRequestSnapshot,
  ): Promise<void>;
  recordApprovalResolved(
    operation: ProtectedOperation,
    approval: ApprovalRequestSnapshot,
  ): Promise<void>;
  recordCompleted(operation: ProtectedOperation, summary: string): Promise<void>;
  recordFailed(
    operation: ProtectedOperation,
    failure: GooseCodingToolFailureEvidence,
  ): Promise<void>;
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidConfig(message: string, cause?: unknown): GooseCodingToolInvokerError {
  return new GooseCodingToolInvokerError("invalid-config", message, { cause });
}

function assertOptions(options: CreateGooseCodingToolInvokerOptions): void {
  if (!isRecord(options)) {
    throw invalidConfig("Goose coding Tool Gateway invoker options must be an object");
  }
  const allowed = new Set([
    "persistence",
    "clock",
    "session",
    "taskId",
    "sessionId",
    "workerId",
    "approvalDecisionHandler",
    "holdHumanDecision",
    "evidenceRecorder",
    "newToolRequestId",
    "newToolInputReference",
  ]);
  if (
    Reflect.ownKeys(options).some((key) => typeof key !== "string" || !allowed.has(key)) ||
    !Object.hasOwn(options, "persistence") ||
    !Object.hasOwn(options, "clock") ||
    !Object.hasOwn(options, "session") ||
    !Object.hasOwn(options, "taskId") ||
    !Object.hasOwn(options, "sessionId") ||
    !Object.hasOwn(options, "workerId") ||
    typeof options.persistence?.storeContentReference !== "function" ||
    typeof options.persistence?.resolveContentReference !== "function" ||
    typeof options.clock?.now !== "function" ||
    typeof options.session?.toolGateway?.invoke !== "function" ||
    (options.approvalDecisionHandler !== undefined &&
      typeof options.approvalDecisionHandler !== "function") ||
    (options.holdHumanDecision !== undefined && typeof options.holdHumanDecision !== "function") ||
    (options.evidenceRecorder !== undefined &&
      (typeof options.evidenceRecorder !== "object" ||
        options.evidenceRecorder === null ||
        typeof options.evidenceRecorder.recordRequested !== "function" ||
        typeof options.evidenceRecorder.recordApprovalRequired !== "function" ||
        typeof options.evidenceRecorder.recordApprovalResolved !== "function" ||
        typeof options.evidenceRecorder.recordCompleted !== "function" ||
        typeof options.evidenceRecorder.recordFailed !== "function")) ||
    (options.newToolRequestId !== undefined && typeof options.newToolRequestId !== "function") ||
    (options.newToolInputReference !== undefined &&
      typeof options.newToolInputReference !== "function")
  ) {
    throw invalidConfig("Goose coding Tool Gateway invoker options are invalid");
  }
  try {
    assertWorkspaceGrant(options.session.grant);
    taskId(options.taskId);
    sessionId(options.sessionId);
    workerId(options.workerId);
    instant(options.clock.now());
  } catch (error) {
    throw invalidConfig("Goose coding Tool Gateway invoker authority is invalid", error);
  }
  if (
    options.session.grant.state !== "active" ||
    options.session.grant.workspaceId === undefined ||
    options.session.worktreeRoot !== options.session.grant.rootPath
  ) {
    throw invalidConfig("Goose coding Tool Gateway invoker requires one exact active grant");
  }
}

function normalizeApprovalDecision(value: unknown): GooseCodingApprovalDecision {
  if (
    !isRecord(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, "decision") ||
    !Object.hasOwn(value, "actorId") ||
    (value.decision !== "approved" && value.decision !== "denied") ||
    typeof value.actorId !== "string"
  ) {
    throw invalidConfig("Goose coding approval decision is invalid");
  }
  let actorId: ApprovalActorId;
  try {
    actorId = approvalActorId(value.actorId);
  } catch (error) {
    throw invalidConfig("Goose coding approval actor is invalid", error);
  }
  return Object.freeze({ decision: value.decision, actorId });
}

async function awaitApprovalDecision(
  handler: GooseCodingApprovalDecisionHandler,
  request: GooseCodingApprovalDecisionRequest,
  holdHumanDecision: (() => () => void) | undefined,
): Promise<GooseCodingApprovalDecision> {
  const aborted = (): GooseCodingToolInvokerError =>
    new GooseCodingToolInvokerError(
      "gateway-failed",
      "Goose coding approval was cancelled before a decision was returned",
    );
  if (request.signal.aborted) {
    throw aborted();
  }
  let rejectOnAbort!: (error: GooseCodingToolInvokerError) => void;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = (): void => rejectOnAbort(aborted());
  request.signal.addEventListener("abort", onAbort, { once: true });
  const releaseHumanDecision = holdHumanDecision?.();
  try {
    return normalizeApprovalDecision(
      await Promise.race([Promise.resolve().then(() => handler(request)), abortPromise]),
    );
  } finally {
    releaseHumanDecision?.();
    request.signal.removeEventListener("abort", onAbort);
  }
}

function assertCall(call: GooseMcpToolCall): void {
  if (
    !isRecord(call) ||
    !Object.hasOwn(call, "sessionId") ||
    !Object.hasOwn(call, "toolCallRequestId") ||
    !Object.hasOwn(call, "toolId") ||
    !Object.hasOwn(call, "input") ||
    !Object.hasOwn(call, "signal") ||
    Reflect.ownKeys(call).length !== 5 ||
    typeof call.sessionId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(call.sessionId) ||
    typeof call.toolCallRequestId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(call.toolCallRequestId) ||
    !isRecord(call.input) ||
    typeof call.signal !== "object" ||
    call.signal === null ||
    typeof call.signal.aborted !== "boolean" ||
    typeof call.signal.addEventListener !== "function" ||
    typeof call.signal.removeEventListener !== "function"
  ) {
    throw new GooseCodingToolInvokerError("invalid-call", "Goose coding tool call is invalid");
  }
  try {
    parseCodingToolInput(call.toolId, JSON.stringify(call.input));
  } catch (error) {
    throw new GooseCodingToolInvokerError(
      "invalid-call",
      "Goose coding tool call exceeds the admitted contract",
      { cause: error },
    );
  }
}

function approvalRequiredResult(): GooseMcpToolInvocationResult {
  return Object.freeze({
    isError: true,
    content: JSON.stringify({ contractVersion: 1, type: "approval-required" }),
  });
}

function approvalDeniedResult(): GooseMcpToolInvocationResult {
  return Object.freeze({
    isError: true,
    content: JSON.stringify({ contractVersion: 1, type: "approval-denied" }),
  });
}

function normalizedFailure(error: unknown): GooseCodingToolFailureEvidence {
  const resourceCode = workerResourceFailureCode(error);
  const code =
    resourceCode ??
    (isRecord(error) &&
    typeof error.code === "string" &&
    /^[a-z0-9][a-z0-9-]{0,127}$/u.test(error.code)
      ? error.code
      : "coding-tool-failed");
  return Object.freeze({
    errorCode: code,
    message: "The closed coding capability failed inside the Actestra Tool Gateway.",
    mayHaveExecuted:
      isRecord(error) && typeof error.mayHaveExecuted === "boolean" ? error.mayHaveExecuted : false,
  });
}

const WORKER_RESOURCE_FAILURE_CODES: ReadonlySet<WorkerResourceIncidentCode> = new Set([
  "worker-resource-cpu-exceeded",
  "worker-resource-memory-exceeded",
  "worker-resource-output-exceeded",
  "worker-resource-timeout",
  "worker-resource-storage-exceeded",
  "worker-process-tree-violated",
  "worker-resource-enforcement-unavailable",
]);

function workerResourceFailureCode(error: unknown): WorkerResourceIncidentCode | undefined {
  const executionError =
    error instanceof PrivilegedServiceError &&
    error.code === "tool-execution-failed" &&
    error.cause instanceof ProtectedToolExecutionError
      ? error.cause
      : error instanceof ProtectedToolExecutionError
        ? error
        : undefined;
  return executionError !== undefined &&
    WORKER_RESOURCE_FAILURE_CODES.has(executionError.errorCode as WorkerResourceIncidentCode)
    ? (executionError.errorCode as WorkerResourceIncidentCode)
    : undefined;
}

function matchesApprovalResolution(
  resolved: ApprovalRequestSnapshot,
  pending: ApprovalRequestSnapshot,
  operation: ProtectedOperation,
  decision: GooseCodingApprovalDecision,
): boolean {
  try {
    assertApprovalRequestSnapshot(resolved);
  } catch {
    return false;
  }
  return (
    resolved.approvalId === pending.approvalId &&
    resolved.policyRevision === pending.policyRevision &&
    resolved.requestedAt === pending.requestedAt &&
    resolved.expiresAt === pending.expiresAt &&
    resolved.state === decision.decision &&
    resolved.resolvedBy === decision.actorId &&
    isDeepStrictEqual(resolved.operation, operation)
  );
}

async function persistEvidence(operation: () => Promise<void>, message: string): Promise<void> {
  try {
    await operation();
  } catch (error) {
    throw new GooseCodingToolInvokerError("persistence-failed", message, { cause: error });
  }
}

export function createGooseCodingToolInvoker(
  options: CreateGooseCodingToolInvokerOptions,
): GooseMcpToolInvoker {
  assertOptions(options);
  const newToolRequestId =
    options.newToolRequestId ?? (() => toolRequestId(identifier("coding-tool-request")));
  const newToolInputReference =
    options.newToolInputReference ?? (() => toolInputReference(identifier("coding-tool-input")));
  const seenRequestIds = new Set<ToolRequestId>();
  const seenInputReferences = new Set<ToolInputReference>();

  return async (call: GooseMcpToolCall): Promise<GooseMcpToolInvocationResult> => {
    assertCall(call);
    const definition = codingToolDefinition(call.toolId);
    let requestId: ToolRequestId;
    let inputRef: ToolInputReference;
    try {
      requestId = toolRequestId(newToolRequestId());
      inputRef = toolInputReference(newToolInputReference());
    } catch (error) {
      throw new GooseCodingToolInvokerError(
        "invalid-config",
        "Goose coding Tool Gateway identifier source returned invalid authority",
        { cause: error },
      );
    }
    if (seenRequestIds.has(requestId) || seenInputReferences.has(inputRef)) {
      throw new GooseCodingToolInvokerError(
        "invalid-config",
        "Goose coding Tool Gateway identifier source reused authority",
      );
    }
    seenRequestIds.add(requestId);
    seenInputReferences.add(inputRef);

    const requestedAt = options.clock.now();
    instant(requestedAt);
    const operation = Object.freeze({
      contractVersion: PRIVILEGED_CONTRACT_VERSION,
      requestId,
      workspaceId: options.session.grant.workspaceId,
      taskId: options.taskId,
      sessionId: options.sessionId,
      workerId: options.workerId,
      toolId: definition.toolId,
      inputRef,
      action: definition.action,
      resourceKind: definition.resourceKind,
      summary: `Invoke the closed ${definition.toolId} capability in the isolated coding worktree`,
      credentialRefs: Object.freeze([]),
      requestedAt,
    } satisfies ProtectedOperation);
    const owner = Object.freeze({
      workspaceId: operation.workspaceId,
      taskId: operation.taskId,
      sessionId: operation.sessionId,
      workerId: operation.workerId,
      requestId: operation.requestId,
      grantId: options.session.grant.grantId,
    });
    const serializedInput = JSON.stringify(call.input);
    const storeInput = Object.freeze({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      reference: operation.inputRef,
      kind: "tool-input" as const,
      owner,
      classification: "task-content" as const,
      mediaType: "text/plain; charset=utf-8" as const,
      content: serializedInput,
      createdAt: requestedAt,
    });
    assertStoreContentReferenceInput(storeInput);
    let stored;
    try {
      stored = await options.persistence.storeContentReference(storeInput);
      assertPersistContentReferenceResult(stored);
    } catch (error) {
      throw new GooseCodingToolInvokerError(
        "persistence-failed",
        "Goose coding tool input could not be persisted",
        { cause: error },
      );
    }
    if (
      stored.status !== "stored" ||
      stored.metadata.reference !== storeInput.reference ||
      stored.metadata.kind !== storeInput.kind ||
      !isDeepStrictEqual(stored.metadata.owner, owner) ||
      stored.metadata.classification !== storeInput.classification ||
      stored.metadata.mediaType !== storeInput.mediaType ||
      stored.metadata.byteLength !== Buffer.byteLength(serializedInput, "utf8") ||
      stored.metadata.createdAt !== storeInput.createdAt
    ) {
      throw new GooseCodingToolInvokerError(
        "persistence-failed",
        "Goose coding tool input persistence returned mismatched evidence",
      );
    }
    if (options.evidenceRecorder !== undefined) {
      await persistEvidence(
        () => options.evidenceRecorder!.recordRequested(operation),
        "Goose coding tool request evidence could not be persisted",
      );
    }

    let gatewayResult: ToolGatewayResult;
    try {
      gatewayResult = await options.session.toolGateway.invoke(operation, undefined, {
        signal: call.signal,
      });
    } catch (error) {
      if (options.evidenceRecorder !== undefined) {
        await persistEvidence(
          () => options.evidenceRecorder!.recordFailed(operation, normalizedFailure(error)),
          "Goose coding tool failure evidence could not be persisted",
        );
      }
      throw new GooseCodingToolInvokerError(
        "gateway-failed",
        "Goose coding tool invocation failed inside the Tool Gateway",
        { cause: error },
      );
    }
    if (gatewayResult.status === "approval-required") {
      const pendingApproval = gatewayResult.approval;
      if (options.evidenceRecorder !== undefined) {
        await persistEvidence(
          () => options.evidenceRecorder!.recordApprovalRequired(operation, pendingApproval),
          "Goose coding approval-required evidence could not be persisted",
        );
      }
      if (options.approvalDecisionHandler === undefined) {
        return approvalRequiredResult();
      }
      try {
        const decision = await awaitApprovalDecision(
          options.approvalDecisionHandler,
          Object.freeze({
            approval: pendingApproval,
            sessionId: call.sessionId,
            toolCallRequestId: call.toolCallRequestId,
            signal: call.signal,
          }),
          options.holdHumanDecision,
        );
        let resolvedApproval: ApprovalRequestSnapshot;
        try {
          resolvedApproval = await options.session.approvalService.resolve(
            pendingApproval.approvalId,
            decision.decision,
            decision.actorId,
          );
        } catch (error) {
          const committed = await options.session.approvalService.get(pendingApproval.approvalId);
          if (
            committed === undefined ||
            !matchesApprovalResolution(committed, pendingApproval, operation, decision)
          ) {
            throw error;
          }
          resolvedApproval = committed;
        }
        if (!matchesApprovalResolution(resolvedApproval, pendingApproval, operation, decision)) {
          throw invalidConfig("Goose coding approval resolution returned mismatched evidence");
        }
        if (options.evidenceRecorder !== undefined) {
          await persistEvidence(
            () => options.evidenceRecorder!.recordApprovalResolved(operation, resolvedApproval),
            "Goose coding approval resolution evidence could not be persisted",
          );
        }
        if (decision.decision !== "approved") {
          if (options.evidenceRecorder !== undefined) {
            await persistEvidence(
              () =>
                options.evidenceRecorder!.recordFailed(
                  operation,
                  Object.freeze({
                    errorCode: "approval-denied",
                    message: "The user denied the closed coding capability.",
                    mayHaveExecuted: false,
                  }),
                ),
              "Goose coding denial evidence could not be persisted",
            );
          }
          return approvalDeniedResult();
        }
        try {
          gatewayResult = await options.session.toolGateway.invoke(
            operation,
            resolvedApproval.approvalId,
            { signal: call.signal },
          );
        } catch (error) {
          if (options.evidenceRecorder !== undefined) {
            await persistEvidence(
              () => options.evidenceRecorder!.recordFailed(operation, normalizedFailure(error)),
              "Goose coding tool failure evidence could not be persisted",
            );
          }
          throw error;
        }
      } catch (error) {
        if (error instanceof GooseCodingToolInvokerError) {
          throw error;
        }
        throw new GooseCodingToolInvokerError(
          "gateway-failed",
          "Goose coding approval could not be resolved inside the Tool Gateway",
          { cause: error },
        );
      }
      if (gatewayResult.status === "approval-required") {
        throw new GooseCodingToolInvokerError(
          "gateway-failed",
          "Approved Goose coding operation did not consume its one-shot approval",
        );
      }
    }
    if (gatewayResult.result.outputRef === undefined) {
      if (options.evidenceRecorder !== undefined) {
        await persistEvidence(
          () =>
            options.evidenceRecorder!.recordCompleted(
              operation,
              "The closed coding capability completed without durable output content.",
            ),
          "Goose coding tool completion evidence could not be persisted",
        );
      }
      return Object.freeze({
        isError: false,
        content: JSON.stringify({ contractVersion: 1, type: "completed" }),
      });
    }

    let resolved;
    try {
      resolved = await options.persistence.resolveContentReference({
        contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
        reference: gatewayResult.result.outputRef,
        kind: "tool-output",
        owner,
        resolvedAt: options.clock.now(),
        consume: false,
      });
      assertResolvedContentReference(resolved);
    } catch (error) {
      if (options.evidenceRecorder !== undefined) {
        await persistEvidence(
          () =>
            options.evidenceRecorder!.recordFailed(
              operation,
              Object.freeze({
                errorCode: "coding-output-persistence-failed",
                message: "The executed coding capability output could not be resolved safely.",
                mayHaveExecuted: true,
              }),
            ),
          "Goose coding output failure evidence could not be persisted",
        );
      }
      throw new GooseCodingToolInvokerError(
        "persistence-failed",
        "Goose coding tool output could not be resolved",
        { cause: error },
      );
    }
    if (
      resolved.metadata.reference !== gatewayResult.result.outputRef ||
      resolved.metadata.kind !== "tool-output" ||
      !isDeepStrictEqual(resolved.metadata.owner, owner) ||
      resolved.metadata.classification !== "task-content" ||
      resolved.metadata.mediaType !== "text/plain; charset=utf-8"
    ) {
      throw new GooseCodingToolInvokerError(
        "persistence-failed",
        "Goose coding tool output resolution returned mismatched evidence",
      );
    }
    let normalizedOutput: string;
    try {
      assertWorkerOutputWithinBudget(resolved.content);
      const parsed = JSON.parse(resolved.content) as unknown;
      if (!isRecord(parsed) || parsed.contractVersion !== 1) {
        throw new Error("Coding tool output must use contract version 1");
      }
      normalizedOutput = JSON.stringify(parsed);
    } catch (error) {
      if (options.evidenceRecorder !== undefined) {
        await persistEvidence(
          () =>
            options.evidenceRecorder!.recordFailed(
              operation,
              Object.freeze({
                errorCode:
                  error instanceof WorkerStorageBudgetError ? error.code : "coding-output-invalid",
                message: "The executed coding capability returned invalid normalized output.",
                mayHaveExecuted: true,
              }),
            ),
          "Goose coding invalid-output evidence could not be persisted",
        );
      }
      throw new GooseCodingToolInvokerError(
        "persistence-failed",
        "Goose coding tool output is not normalized JSON evidence",
        { cause: error },
      );
    }
    if (options.evidenceRecorder !== undefined) {
      await persistEvidence(
        () =>
          options.evidenceRecorder!.recordCompleted(
            operation,
            "The closed coding capability completed with durable normalized output.",
          ),
        "Goose coding tool completion evidence could not be persisted",
      );
    }
    return Object.freeze({ isError: false, content: normalizedOutput });
  };
}
