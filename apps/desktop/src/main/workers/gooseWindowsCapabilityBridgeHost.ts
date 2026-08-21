import type { Duplex } from "node:stream";
import { parseCodingToolInput, type IsolatedCodingToolId } from "../../core";
import type { ActestraMainModelTool } from "../model/actestraMainModelBroker";
import type { GooseMcpToolInvocationResult, GooseMcpToolInvoker } from "./gooseMcpCapabilityServer";
import {
  decodeGooseWindowsCapabilityFrame,
  encodeGooseWindowsCapabilityFrame,
  GooseAuthenticatedBridgeProtocolError,
  GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES,
  type GooseWindowsCapabilityFrame,
} from "./gooseAuthenticatedBridgeProtocol";
import { toolList } from "./gooseMcpCapabilityServer";
import {
  GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES,
  type GooseWindowsCapabilityProgress,
} from "./gooseSessionTransport";

const MAX_FRAME_BYTES = GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES;
const MAX_WAIT_MS = 120_000;
const MAX_TOOL_CALLS = 128;

export interface StartGooseWindowsCapabilityBridgeHostOptions {
  readonly stream: Duplex;
  readonly attemptLease: string;
  readonly invokeTool: GooseMcpToolInvoker;
  readonly commandIds: readonly string[];
  readonly testIds: readonly string[];
  readonly capabilityProgress: GooseWindowsCapabilityProgress;
}

export interface GooseWindowsCapabilityBridgeHost {
  bindSession(sessionId: string): void;
  waitForToolsList(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

interface PendingRequest {
  readonly controller: AbortController;
  cancelled: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function validLease(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{32,256}$/.test(value);
}

function writeFrame(
  stream: Duplex,
  frame: GooseWindowsCapabilityFrame,
  onWritten?: () => void,
): void {
  if (!stream.destroyed && !stream.writableEnded) {
    stream.write(encodeGooseWindowsCapabilityFrame(frame), (error?: Error | null) => {
      if (error === undefined || error === null) onWritten?.();
    });
  }
}

function snapshotRegistryIds(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((id) => typeof id !== "string" || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(id))
  ) {
    throw new GooseAuthenticatedBridgeProtocolError("Windows capability registry is invalid");
  }
  return Object.freeze([...new Set(value)]);
}

export function startGooseWindowsCapabilityBridgeHost(
  options: StartGooseWindowsCapabilityBridgeHostOptions,
): GooseWindowsCapabilityBridgeHost {
  if (
    !isRecord(options) ||
    !(options.stream instanceof Object) ||
    typeof options.stream.on !== "function" ||
    typeof options.stream.write !== "function" ||
    !validLease(options.attemptLease) ||
    typeof options.invokeTool !== "function" ||
    !isRecord(options.capabilityProgress) ||
    typeof options.capabilityProgress.record !== "function" ||
    typeof options.capabilityProgress.snapshot !== "function"
  ) {
    throw new GooseAuthenticatedBridgeProtocolError(
      "Invalid Windows capability bridge host options",
    );
  }
  const commandIds = snapshotRegistryIds(options.commandIds);
  const testIds = snapshotRegistryIds(options.testIds);
  const tools = toolList(commandIds, testIds) as readonly ActestraMainModelTool[];
  const stream = options.stream;
  let sessionId: string | undefined;
  let input = Buffer.alloc(0);
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let toolsListed = false;
  const pending = new Map<string, PendingRequest>();
  const seenToolCallRequestIds = new Set<string>();
  const waiters = new Set<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  const closeHost = (): Promise<void> => {
    closePromise ??= (async () => {
      if (closed) return;
      closed = true;
      for (const request of pending.values()) {
        request.cancelled = true;
        request.controller.abort("goose-windows-capability-closing");
      }
      pending.clear();
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(
          new GooseAuthenticatedBridgeProtocolError("Windows capability bridge closed"),
        );
      }
      waiters.clear();
      stream.off("data", onData);
      if (!stream.destroyed && !stream.writableEnded) stream.end();
    })();
    return closePromise;
  };

  const emitError = (
    requestId: string,
    code: "cancelled" | "capability-request-rejected" | "tool-execution-failed",
  ): void => {
    writeFrame(stream, { contractVersion: 1, kind: "capability-error", requestId, code });
  };

  const serve = async (frameBytes: Buffer): Promise<void> => {
    let frame: GooseWindowsCapabilityFrame;
    try {
      frame = decodeGooseWindowsCapabilityFrame(frameBytes, {
        expectedLease: options.attemptLease,
        expectedSessionId: sessionId,
      });
    } catch {
      return;
    }

    if (frame.kind === "cancel") {
      const request = pending.get(frame.requestId);
      if (request === undefined || request.cancelled) return;
      request.cancelled = true;
      pending.delete(frame.requestId);
      request.controller.abort("goose-windows-capability-cancelled");
      emitError(frame.requestId, "cancelled");
      return;
    }
    if (frame.kind === "list-request") {
      if (sessionId === undefined || toolsListed) return;
      options.capabilityProgress.record(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[3]);
      toolsListed = true;
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve();
      }
      waiters.clear();
      writeFrame(
        stream,
        {
          contractVersion: 1,
          kind: "list-response",
          requestId: frame.requestId,
          tools,
        },
        () => options.capabilityProgress.record(GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[4]),
      );
      return;
    }
    if (
      frame.kind !== "call-request" ||
      sessionId === undefined ||
      !toolsListed ||
      seenToolCallRequestIds.has(frame.requestId) ||
      seenToolCallRequestIds.size >= MAX_TOOL_CALLS
    ) {
      if (frame.kind === "call-request") emitError(frame.requestId, "capability-request-rejected");
      return;
    }

    let inputValue: ReturnType<typeof parseCodingToolInput>;
    try {
      inputValue = parseCodingToolInput(frame.toolName, JSON.stringify(frame.arguments));
    } catch {
      emitError(frame.requestId, "capability-request-rejected");
      return;
    }
    seenToolCallRequestIds.add(frame.requestId);
    const request: PendingRequest = { controller: new AbortController(), cancelled: false };
    pending.set(frame.requestId, request);
    try {
      const result: GooseMcpToolInvocationResult = await options.invokeTool({
        sessionId,
        toolCallRequestId: frame.requestId,
        toolId: frame.toolName as IsolatedCodingToolId,
        input: inputValue,
        signal: request.controller.signal,
      });
      if (request.cancelled || closed) return;
      if (
        !isRecord(result) ||
        typeof result.isError !== "boolean" ||
        typeof result.content !== "string"
      ) {
        throw new Error("invalid-tool-result");
      }
      pending.delete(frame.requestId);
      writeFrame(stream, {
        contractVersion: 1,
        kind: "call-response",
        requestId: frame.requestId,
        isError: result.isError,
        content: result.content,
      });
    } catch {
      if (request.cancelled || closed) return;
      pending.delete(frame.requestId);
      emitError(frame.requestId, "tool-execution-failed");
    }
  };

  const consume = (): void => {
    while (!closed && input.byteLength >= 4) {
      const length = input.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        void closeHost();
        return;
      }
      if (input.byteLength < length + 4) return;
      const frame = input.subarray(0, length + 4);
      input = input.subarray(length + 4);
      void serve(frame);
    }
  };
  const onData = (chunk: Buffer | Uint8Array): void => {
    if (closed) return;
    input = Buffer.concat([input, Buffer.from(chunk)]);
    consume();
  };
  stream.on("data", onData);
  stream.on("end", () => void closeHost());
  stream.on("error", () => void closeHost());

  return Object.freeze({
    bindSession(value: string): void {
      if (!validSessionId(value) || (sessionId !== undefined && sessionId !== value)) {
        throw new GooseAuthenticatedBridgeProtocolError(
          "Windows capability bridge session binding is invalid",
        );
      }
      sessionId = value;
    },
    waitForToolsList(timeoutMs = 30_000): Promise<void> {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_WAIT_MS) {
        return Promise.reject(
          new GooseAuthenticatedBridgeProtocolError(
            "Windows capability tools/list timeout is invalid",
          ),
        );
      }
      if (toolsListed) return Promise.resolve();
      if (closed)
        return Promise.reject(
          new GooseAuthenticatedBridgeProtocolError("Windows capability bridge is closed"),
        );
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new GooseAuthenticatedBridgeProtocolError("Windows capability tools/list timed out"),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    close(): Promise<void> {
      return closeHost();
    },
  });
}
