import type { Duplex } from "node:stream";
import {
  assertActestraMainModelCompletion,
  type ActestraMainModelInvoker,
} from "../model/actestraMainModelBroker";
import {
  decodeGooseWindowsModelFrame,
  encodeGooseWindowsModelFrame,
  GooseAuthenticatedBridgeProtocolError,
  GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES,
  type GooseWindowsModelFrame,
} from "./gooseAuthenticatedBridgeProtocol";
import {
  GOOSE_WINDOWS_MODEL_PROGRESS_STAGES,
  type GooseWindowsModelProgress,
} from "./gooseSessionTransport";

const MAX_FRAME_BYTES = GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES;

export interface StartGooseWindowsModelBridgeHostOptions {
  readonly stream: Duplex;
  readonly attemptLease: string;
  readonly invokeModel: ActestraMainModelInvoker;
  readonly modelProgress: GooseWindowsModelProgress;
}

export interface GooseWindowsModelBridgeHost {
  bindSession(sessionId: string): void;
  readonly servedInferenceCount: number;
  readonly refusedInferenceCount: number;
  readonly rejectedRequestCount: number;
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

function writeFrame(stream: Duplex, frame: GooseWindowsModelFrame, onWritten?: () => void): void {
  if (!stream.destroyed && !stream.writableEnded) {
    stream.write(encodeGooseWindowsModelFrame(frame), (error?: Error | null) => {
      if (error === undefined || error === null) onWritten?.();
    });
  }
}

export function startGooseWindowsModelBridgeHost(
  options: StartGooseWindowsModelBridgeHostOptions,
): GooseWindowsModelBridgeHost {
  if (
    !isRecord(options) ||
    !(options.stream instanceof Object) ||
    typeof options.stream.on !== "function" ||
    typeof options.stream.write !== "function" ||
    !validLease(options.attemptLease) ||
    typeof options.invokeModel !== "function" ||
    !isRecord(options.modelProgress) ||
    typeof options.modelProgress.record !== "function" ||
    typeof options.modelProgress.snapshot !== "function"
  ) {
    throw new GooseAuthenticatedBridgeProtocolError("Invalid Windows model bridge host options");
  }

  const stream = options.stream;
  let sessionId: string | undefined;
  let input = Buffer.alloc(0);
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let servedInferenceCount = 0;
  let refusedInferenceCount = 0;
  let rejectedRequestCount = 0;
  const pending = new Map<string, PendingRequest>();
  const seenRequestIds = new Set<string>();

  const closeHost = (): Promise<void> => {
    closePromise ??= (async () => {
      if (closed) return;
      closed = true;
      for (const request of pending.values()) {
        request.cancelled = true;
        request.controller.abort("goose-windows-model-closing");
      }
      pending.clear();
      stream.off("data", onData);
      if (!stream.destroyed && !stream.writableEnded) stream.end();
    })();
    return closePromise;
  };

  const rejectFrame = (): void => {
    rejectedRequestCount += 1;
  };

  const emitError = (
    requestId: string,
    code: "cancelled" | "model-completion-refused" | "model-request-rejected",
  ): void => {
    writeFrame(stream, { contractVersion: 1, kind: "model-error", requestId, code }, () =>
      options.modelProgress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[6]),
    );
  };

  const serve = async (frameBytes: Buffer): Promise<void> => {
    let frame: GooseWindowsModelFrame;
    try {
      const envelope = decodeGooseWindowsModelFrame(frameBytes);
      if (envelope.kind === "completion-request" && seenRequestIds.has(envelope.requestId)) {
        rejectFrame();
        return;
      }
      if (envelope.kind !== "cancel") seenRequestIds.add(envelope.requestId);
      frame = decodeGooseWindowsModelFrame(frameBytes, {
        expectedLease: options.attemptLease,
        expectedSessionId: sessionId,
      });
    } catch {
      rejectFrame();
      return;
    }

    if (frame.kind === "cancel") {
      const request = pending.get(frame.requestId);
      if (request === undefined || request.cancelled) {
        rejectFrame();
        return;
      }
      request.cancelled = true;
      pending.delete(frame.requestId);
      request.controller.abort("goose-windows-model-cancelled");
      emitError(frame.requestId, "cancelled");
      return;
    }

    if (
      frame.kind !== "completion-request" ||
      sessionId === undefined ||
      pending.has(frame.requestId)
    ) {
      rejectFrame();
      if (frame.kind === "completion-request") emitError(frame.requestId, "model-request-rejected");
      return;
    }
    options.modelProgress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[3]);

    const request: PendingRequest = { controller: new AbortController(), cancelled: false };
    pending.set(frame.requestId, request);
    options.modelProgress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[4]);
    try {
      const completion = await options.invokeModel(frame.invocation, request.controller.signal);
      options.modelProgress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[5]);
      if (request.cancelled || closed) return;
      try {
        assertActestraMainModelCompletion(completion);
      } catch {
        refusedInferenceCount += 1;
        pending.delete(frame.requestId);
        emitError(frame.requestId, "model-completion-refused");
        return;
      }
      const response = encodeGooseWindowsModelFrame({
        contractVersion: 1,
        kind: "completion-response",
        requestId: frame.requestId,
        completion,
      });
      pending.delete(frame.requestId);
      servedInferenceCount += 1;
      if (!stream.destroyed && !stream.writableEnded) {
        stream.write(response, (error?: Error | null) => {
          if (error === undefined || error === null) {
            options.modelProgress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[6]);
          }
        });
      }
    } catch {
      if (request.cancelled || closed) return;
      pending.delete(frame.requestId);
      refusedInferenceCount += 1;
      emitError(frame.requestId, "model-completion-refused");
    }
  };

  const consume = (): void => {
    while (!closed && input.byteLength >= 4) {
      const length = input.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        rejectFrame();
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
          "Windows model bridge session binding is invalid",
        );
      }
      sessionId = value;
    },
    get servedInferenceCount(): number {
      return servedInferenceCount;
    },
    get refusedInferenceCount(): number {
      return refusedInferenceCount;
    },
    get rejectedRequestCount(): number {
      return rejectedRequestCount;
    },
    close(): Promise<void> {
      return closeHost();
    },
  });
}
