import {
  GENERAL_WORKER_PROTOCOL_VERSION,
  assertGeneralWorkerRequest,
  type GeneralWorkerErrorCode,
  type GeneralWorkerEventMessage,
  type GeneralWorkerEventPayload,
  type GeneralWorkerMessage,
  type GeneralWorkerRequest,
  type GeneralWorkerResponse,
} from "../../shared/generalWorkerProtocol";

type GeneralWorkerAttemptState =
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "disposed";

interface GeneralWorkerAttempt {
  readonly token: string;
  readonly executionMode: Extract<
    GeneralWorkerRequest,
    { operation: "start" }
  >["payload"]["executionMode"];
  state: GeneralWorkerAttemptState;
  sequence: number;
  pendingCallId?: string;
}

class GeneralWorkerServiceError extends Error {
  constructor(
    readonly code: GeneralWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GeneralWorkerServiceError";
  }
}

function success(request: GeneralWorkerRequest): GeneralWorkerResponse {
  return Object.freeze({
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "response",
    requestId: request.requestId,
    operation: request.operation,
    ok: true,
  });
}

function failure(
  request: GeneralWorkerRequest,
  error: GeneralWorkerServiceError,
): GeneralWorkerResponse {
  return Object.freeze({
    protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
    type: "response",
    requestId: request.requestId,
    operation: request.operation,
    ok: false,
    error: Object.freeze({
      code: error.code,
      message: error.message,
    }),
  });
}

function serviceError(error: unknown): GeneralWorkerServiceError {
  if (error instanceof GeneralWorkerServiceError) {
    return error;
  }
  return new GeneralWorkerServiceError(
    "invalid-state",
    "General Worker could not complete the requested operation",
  );
}

export class GeneralWorkerService {
  private readonly attempts = new Map<string, GeneralWorkerAttempt>();
  private attemptStarted = false;
  private closed = false;

  async handle(value: unknown): Promise<readonly GeneralWorkerMessage[]> {
    assertGeneralWorkerRequest(value);
    const request = value;

    try {
      const events = this.dispatch(request);
      return Object.freeze([success(request), ...events]);
    } catch (error) {
      return Object.freeze([failure(request, serviceError(error))]);
    }
  }

  shutdown(): void {
    this.closed = true;
    this.attempts.clear();
  }

  private dispatch(request: GeneralWorkerRequest): readonly GeneralWorkerEventMessage[] {
    if (this.closed && request.operation !== "close") {
      throw new GeneralWorkerServiceError("invalid-state", "General Worker is closed");
    }

    switch (request.operation) {
      case "start":
        return this.start(request);
      case "send":
        return this.send(request);
      case "resolve-tool":
        return this.resolveTool(request);
      case "cancel":
        return this.cancel(request);
      case "dispose":
        return this.dispose(request);
      case "close":
        this.shutdown();
        return [];
      default: {
        const unsupported: never = request;
        throw new GeneralWorkerServiceError(
          "unsupported-operation",
          `Unsupported General Worker request ${String(unsupported)}`,
        );
      }
    }
  }

  private start(
    request: Extract<GeneralWorkerRequest, { operation: "start" }>,
  ): readonly GeneralWorkerEventMessage[] {
    if (this.attemptStarted) {
      throw new GeneralWorkerServiceError(
        "duplicate-attempt",
        "A General Worker process accepts exactly one immutable attempt",
      );
    }
    if (this.attempts.has(request.payload.attemptToken)) {
      throw new GeneralWorkerServiceError(
        "duplicate-attempt",
        "General Worker attempt token has already started",
      );
    }
    const active = [...this.attempts.values()].find(
      (attempt) => attempt.state === "running" || attempt.state === "blocked",
    );
    if (active !== undefined) {
      throw new GeneralWorkerServiceError(
        "invalid-state",
        "General Worker already owns an active attempt",
      );
    }

    const attempt: GeneralWorkerAttempt = {
      token: request.payload.attemptToken,
      executionMode: request.payload.executionMode,
      state: "running",
      sequence: 0,
    };
    this.attemptStarted = true;
    this.attempts.set(attempt.token, attempt);
    const events: GeneralWorkerEventMessage[] = [this.event(attempt, { type: "started" })];

    switch (attempt.executionMode) {
      case "no-tool-complete":
        events.push(
          this.event(attempt, {
            type: "message",
            role: "assistant",
            content: "The deterministic General Worker completed its no-tool task.",
          }),
        );
        attempt.state = "completed";
        events.push(this.event(attempt, { type: "completed" }));
        break;
      case "hold":
        break;
      case "tool-fixture":
        attempt.state = "blocked";
        attempt.pendingCallId = "general-worker-tool-call";
        events.push(
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: "actestra.fixture.noop",
            summary: "Resolve the deterministic typed tool-result fixture.",
          }),
        );
        break;
    }

    return events;
  }

  private send(
    request: Extract<GeneralWorkerRequest, { operation: "send" }>,
  ): readonly GeneralWorkerEventMessage[] {
    const attempt = this.requireAttempt(request.payload.attemptToken);
    if (attempt.state !== "running") {
      throw new GeneralWorkerServiceError(
        "invalid-state",
        "General Worker cannot receive input outside a running attempt",
      );
    }
    return [
      this.event(attempt, { type: "heartbeat" }),
      this.event(attempt, {
        type: "message",
        role: "assistant",
        content: `Received ${new TextEncoder().encode(request.payload.content).byteLength} bytes.`,
      }),
    ];
  }

  private resolveTool(
    request: Extract<GeneralWorkerRequest, { operation: "resolve-tool" }>,
  ): readonly GeneralWorkerEventMessage[] {
    const attempt = this.requireAttempt(request.payload.attemptToken);
    if (
      attempt.state !== "blocked" ||
      attempt.pendingCallId === undefined ||
      attempt.pendingCallId !== request.payload.callId
    ) {
      throw new GeneralWorkerServiceError(
        "invalid-state",
        "General Worker has no matching blocked tool call",
      );
    }

    const result = request.payload.result;
    attempt.pendingCallId = undefined;
    const events: GeneralWorkerEventMessage[] = [
      this.event(attempt, {
        type: "tool-result-accepted",
        callId: request.payload.callId,
        status: result.status,
      }),
    ];
    if (result.status === "succeeded") {
      attempt.state = "running";
      events.push(this.event(attempt, { type: "resumed" }));
      attempt.state = "completed";
      events.push(this.event(attempt, { type: "completed" }));
      return events;
    }
    if (result.status === "failed") {
      attempt.state = "failed";
      events.push(
        this.event(attempt, {
          type: "failed",
          errorCode: result.errorCode,
          message: result.message,
        }),
      );
      return events;
    }

    attempt.state = "cancelled";
    events.push(
      this.event(attempt, {
        type: "cancelled",
        ...(result.reason === undefined ? {} : { reason: result.reason }),
      }),
    );
    return events;
  }

  private cancel(
    request: Extract<GeneralWorkerRequest, { operation: "cancel" }>,
  ): readonly GeneralWorkerEventMessage[] {
    const attempt = this.requireAttempt(request.payload.attemptToken);
    if (
      attempt.state === "completed" ||
      attempt.state === "failed" ||
      attempt.state === "cancelled" ||
      attempt.state === "disposed"
    ) {
      return [];
    }
    attempt.pendingCallId = undefined;
    attempt.state = "cancelled";
    return [
      this.event(attempt, {
        type: "cancelled",
        ...(request.payload.reason === undefined ? {} : { reason: request.payload.reason }),
      }),
    ];
  }

  private dispose(
    request: Extract<GeneralWorkerRequest, { operation: "dispose" }>,
  ): readonly GeneralWorkerEventMessage[] {
    const attempt = this.requireAttempt(request.payload.attemptToken);
    attempt.pendingCallId = undefined;
    attempt.state = "disposed";
    this.attempts.delete(attempt.token);
    return [];
  }

  private requireAttempt(token: string): GeneralWorkerAttempt {
    const attempt = this.attempts.get(token);
    if (attempt === undefined) {
      throw new GeneralWorkerServiceError(
        "unknown-attempt",
        "General Worker attempt token is unknown",
      );
    }
    return attempt;
  }

  private event(
    attempt: GeneralWorkerAttempt,
    event: GeneralWorkerEventPayload,
  ): GeneralWorkerEventMessage {
    attempt.sequence += 1;
    return Object.freeze({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: attempt.token,
      sequence: attempt.sequence,
      event: Object.freeze({ ...event }) as GeneralWorkerEventPayload,
    });
  }
}
