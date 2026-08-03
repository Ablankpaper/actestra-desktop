import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  PRIVILEGED_CONTRACT_VERSION,
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
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
  type PrivilegedClock,
  type ProtectedOperation,
  type SessionId,
  type TaskId,
  type ToolInputReference,
  type ToolRequestId,
  type WorkerId,
} from "../../core";
import type { IsolatedCodingMainSession } from "./isolatedCodingMainService";
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
  readonly newToolRequestId?: () => ToolRequestId;
  readonly newToolInputReference?: () => ToolInputReference;
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

    let gatewayResult;
    try {
      gatewayResult = await options.session.toolGateway.invoke(operation, undefined, {
        signal: call.signal,
      });
    } catch (error) {
      throw new GooseCodingToolInvokerError(
        "gateway-failed",
        "Goose coding tool invocation failed inside the Tool Gateway",
        { cause: error },
      );
    }
    if (gatewayResult.status === "approval-required") {
      return approvalRequiredResult();
    }
    if (gatewayResult.result.outputRef === undefined) {
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
      const parsed = JSON.parse(resolved.content) as unknown;
      if (!isRecord(parsed) || parsed.contractVersion !== 1) {
        throw new Error("Coding tool output must use contract version 1");
      }
      normalizedOutput = JSON.stringify(parsed);
    } catch (error) {
      throw new GooseCodingToolInvokerError(
        "persistence-failed",
        "Goose coding tool output is not normalized JSON evidence",
        { cause: error },
      );
    }
    return Object.freeze({ isError: false, content: normalizedOutput });
  };
}
