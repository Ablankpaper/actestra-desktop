import {
  PRIVILEGED_CONTRACT_VERSION,
  ProtectedToolExecutionError,
  PrivilegedServiceError,
  ScopedNativeToolContractError,
  assertAgentToolResult,
  instant,
  scopedNativeToolDefinition,
  sessionId,
  toolInputReference,
  toolRequestId,
  type AgentClock,
  type AgentToolResult,
  type ProtectedOperation,
  type SessionId,
  type ToolGateway,
  type ToolInputReference,
  type ToolRequestId,
} from "../../core";
import { AgentAdapterSupervisor } from "./agentAdapterSupervisor";

export type ScopedNativeToolCoordinatorErrorCode =
  | "inactive-attempt"
  | "request-mismatch"
  | "duplicate-invocation";

export class ScopedNativeToolCoordinatorError extends Error {
  constructor(
    readonly code: ScopedNativeToolCoordinatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScopedNativeToolCoordinatorError";
  }
}

export interface ScopedNativeToolInvocation {
  readonly sessionId: SessionId;
  readonly requestId: ToolRequestId;
  readonly inputRef: ToolInputReference;
  readonly signal?: AbortSignal;
}

interface InFlightInvocation {
  readonly controller: AbortController;
  cancellationReason?: string;
  readonly removeExternalAbort?: () => void;
}

function protectedExecutionCause(error: unknown): ProtectedToolExecutionError | undefined {
  if (error instanceof ProtectedToolExecutionError) {
    return error;
  }
  if (
    error instanceof PrivilegedServiceError &&
    error.cause instanceof ProtectedToolExecutionError
  ) {
    return error.cause;
  }
  return undefined;
}

function stableFailure(error: unknown): { readonly errorCode: string; readonly message: string } {
  const execution = protectedExecutionCause(error);
  if (execution !== undefined) {
    return {
      errorCode: execution.errorCode,
      message: "Scoped native tool execution failed.",
    };
  }
  if (error instanceof PrivilegedServiceError) {
    return {
      errorCode: error.code,
      message: "Scoped native tool authorization failed.",
    };
  }
  if (error instanceof ScopedNativeToolContractError) {
    return {
      errorCode: error.code,
      message: "Scoped native tool request is unsupported.",
    };
  }
  return {
    errorCode: "tool-coordination-failed",
    message: "Scoped native tool coordination failed.",
  };
}

function assertInvocationSignal(signal: AbortSignal | undefined): void {
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      typeof signal.aborted !== "boolean" ||
      typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function")
  ) {
    throw new ScopedNativeToolCoordinatorError(
      "request-mismatch",
      "Scoped native tool signal must be an AbortSignal",
    );
  }
}

export class ScopedNativeToolCoordinator {
  private readonly inFlight = new Map<ToolRequestId, InFlightInvocation>();

  constructor(
    private readonly supervisor: AgentAdapterSupervisor,
    private readonly gateway: ToolGateway,
    private readonly clock: AgentClock,
  ) {}

  async invoke(invocation: ScopedNativeToolInvocation): Promise<AgentToolResult> {
    sessionId(invocation.sessionId);
    toolRequestId(invocation.requestId);
    toolInputReference(invocation.inputRef);
    assertInvocationSignal(invocation.signal);
    if (this.inFlight.has(invocation.requestId)) {
      throw new ScopedNativeToolCoordinatorError(
        "duplicate-invocation",
        `Tool request ${invocation.requestId} is already executing`,
      );
    }

    const snapshot = this.supervisor.snapshot(invocation.sessionId);
    if (
      snapshot.disposed ||
      snapshot.state !== "blocked" ||
      snapshot.taskState !== "blocked" ||
      this.supervisor.activeToolRequest(invocation.sessionId) !== invocation.requestId
    ) {
      throw new ScopedNativeToolCoordinatorError(
        "inactive-attempt",
        `Session ${invocation.sessionId} does not own an active tool block`,
      );
    }
    const matchingEvents = this.supervisor
      .coreEvents(invocation.sessionId)
      .filter(
        (event) =>
          event.type === "tool.requested" && event.payload.requestId === invocation.requestId,
      );
    if (matchingEvents.length !== 1) {
      throw new ScopedNativeToolCoordinatorError(
        "request-mismatch",
        `Session ${invocation.sessionId} does not own tool request ${invocation.requestId}`,
      );
    }
    const requestEvent = matchingEvents[0];
    if (requestEvent?.type !== "tool.requested") {
      throw new ScopedNativeToolCoordinatorError(
        "request-mismatch",
        "Scoped native tool request event is unavailable",
      );
    }

    const controller = new AbortController();
    let removeExternalAbort: (() => void) | undefined;
    const active: InFlightInvocation = {
      controller,
      ...(invocation.signal === undefined
        ? {}
        : {
            removeExternalAbort: () => {
              invocation.signal?.removeEventListener("abort", abortFromExternal);
            },
          }),
    };
    const abortFromExternal = (): void => {
      active.cancellationReason =
        typeof invocation.signal?.reason === "string"
          ? invocation.signal.reason
          : "Tool execution cancelled";
      controller.abort(active.cancellationReason);
    };
    if (invocation.signal?.aborted) {
      abortFromExternal();
    } else if (invocation.signal !== undefined) {
      invocation.signal.addEventListener("abort", abortFromExternal, { once: true });
      removeExternalAbort = active.removeExternalAbort;
    }
    this.inFlight.set(invocation.requestId, active);

    try {
      const startedAt = this.now();
      let result: AgentToolResult;
      try {
        const definition = scopedNativeToolDefinition(requestEvent.payload.toolName);
        const operation = Object.freeze({
          contractVersion: PRIVILEGED_CONTRACT_VERSION,
          requestId: invocation.requestId,
          workspaceId: snapshot.workspaceId,
          taskId: snapshot.taskId,
          sessionId: snapshot.sessionId,
          workerId: snapshot.workerId,
          toolId: definition.toolId,
          inputRef: invocation.inputRef,
          action: definition.action,
          resourceKind: definition.resourceKind,
          summary: requestEvent.payload.summary,
          credentialRefs: Object.freeze([]),
          requestedAt: requestEvent.occurredAt,
        }) satisfies ProtectedOperation;
        const gatewayResult = await this.gateway.invoke(operation, undefined, {
          signal: controller.signal,
        });
        if (gatewayResult.status !== "executed") {
          throw new PrivilegedServiceError(
            "approval-not-granted",
            "Scoped native tools cannot require an implicit approval",
          );
        }
        result = Object.freeze({
          requestId: invocation.requestId,
          status: "succeeded",
          startedAt,
          completedAt: this.now(),
          ...(gatewayResult.result.outputRef === undefined
            ? {}
            : { outputRef: gatewayResult.result.outputRef }),
          summary: "Scoped native tool completed.",
        });
      } catch (error) {
        const execution = protectedExecutionCause(error);
        if (execution?.errorCode === "tool-cancelled" && !execution.mayHaveExecuted) {
          result = Object.freeze({
            requestId: invocation.requestId,
            status: "cancelled",
            startedAt,
            completedAt: this.now(),
            reason: active.cancellationReason ?? "Tool execution cancelled",
          });
        } else {
          const failure = stableFailure(error);
          result = Object.freeze({
            requestId: invocation.requestId,
            status: "failed",
            startedAt,
            completedAt: this.now(),
            errorCode: failure.errorCode,
            message: failure.message,
          });
        }
      }

      assertAgentToolResult(result);
      await this.supervisor.resolveTool(invocation.requestId, result);
      return result;
    } finally {
      removeExternalAbort?.();
      this.inFlight.delete(invocation.requestId);
    }
  }

  cancel(request: ToolRequestId, reason = "Tool execution cancelled"): boolean {
    toolRequestId(request);
    if (typeof reason !== "string") {
      throw new ScopedNativeToolCoordinatorError(
        "request-mismatch",
        "Tool cancellation reason must be a string",
      );
    }
    const active = this.inFlight.get(request);
    if (active === undefined) {
      return false;
    }
    active.cancellationReason = reason;
    active.controller.abort(reason);
    return true;
  }

  private now() {
    const value = this.clock.now();
    instant(value);
    return value;
  }
}
