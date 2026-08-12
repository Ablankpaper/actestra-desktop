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
import {
  OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH,
  officeDocumentModelFromBrief,
  parseOfficeDocumentBrief,
} from "../../core/officeDocumentArtifact";
import { TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID } from "../../core/scopedNativeTools";
import { parseWritingArtifactBrief } from "../../core/writingArtifact";
import type { GeneralCapabilityRequest } from "../../core/generalCapabilityAdmission";
import {
  GENERAL_DRAFT_REPAIR_ATTEMPT_LIMIT,
  admitGeneralWritingRequest,
  buildGeneralDraftRepairInstruction,
  validateGeneralDraft,
} from "../../core/generalDraftContract";

type GeneralWorkerAttemptState =
  | "running"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled"
  | "disposed";

interface GeneralWorkerAttempt {
  readonly token: string;
  readonly prompt: string;
  readonly executionMode: Extract<
    GeneralWorkerRequest,
    { operation: "start" }
  >["payload"]["executionMode"];
  state: GeneralWorkerAttemptState;
  sequence: number;
  pendingCallId?: string;
  pendingModelCallId?: string;
  awaitingWorkspaceContent?: boolean;
  /** Counts repairs already spent, so the bound holds across the whole attempt and not per reply. */
  draftRepairAttempts?: number;
  /** Structured admission input, carried so a restart re-derives the same blocking reason. */
  readonly requirements?: GeneralCapabilityRequest;
}

function localResearchArtifact(
  prompt: string,
  source: string,
): {
  readonly byteLength: number;
  readonly noteCount: number;
  readonly content: string;
} {
  const byteLength = new TextEncoder().encode(source).byteLength;
  const notes = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 32);
  const evidence =
    notes.length === 0
      ? "- No non-empty evidence notes were provided."
      : notes.map((note) => `- ${note}`).join("\n");
  return Object.freeze({
    byteLength,
    noteCount: notes.length,
    content:
      "# Actestra local research brief\n\n" +
      `Instruction: ${prompt.trim()}\n\n` +
      "## Evidence notes\n\n" +
      `${evidence}\n`,
  });
}

function writingArtifact(prompt: string): {
  readonly pointCount: number;
  readonly content: string;
} {
  const brief = parseWritingArtifactBrief(prompt);
  return Object.freeze({
    pointCount: brief.points.length,
    content:
      `# ${brief.title}\n\n` +
      `Audience: ${brief.audience}\n\n` +
      `${brief.purpose}\n\n` +
      `${brief.points.join("\n\n")}\n`,
  });
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
      // A successful response is the delivery barrier for the operation's
      // complete event batch. Electron parent-port messages arrive on separate
      // turns, so acknowledging first can race durable coordination ahead of
      // task.started, tool completion, or terminal evidence.
      return Object.freeze([...events, success(request)]);
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
      case "resolve-model":
        return this.resolveModel(request);
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
    const writingDraft =
      request.payload.executionMode === "writing-artifact-fixture"
        ? writingArtifact(request.payload.prompt)
        : null;
    const officeDocument =
      request.payload.executionMode === "office-document-artifact-fixture"
        ? officeDocumentModelFromBrief(parseOfficeDocumentBrief(request.payload.prompt))
        : null;

    const attempt: GeneralWorkerAttempt = {
      token: request.payload.attemptToken,
      prompt: request.payload.prompt,
      executionMode: request.payload.executionMode,
      state: "running",
      sequence: 0,
      ...(request.payload.requirements === undefined
        ? {}
        : { requirements: request.payload.requirements }),
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
      case "workspace-read-text-fixture":
      case "workspace-read-then-task-output-write-fixture":
        attempt.state = "blocked";
        attempt.pendingCallId = "general-worker-workspace-read-text-call";
        events.push(
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: "actestra.workspace.read-text",
            summary: "Read one bounded UTF-8 workspace file.",
          }),
        );
        break;
      case "local-research-artifact-fixture":
        attempt.state = "blocked";
        attempt.pendingCallId = "general-worker-workspace-read-text-call";
        events.push(
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: "actestra.workspace.read-text",
            summary: "Read the bounded local research source.",
          }),
        );
        break;
      case "writing-artifact-fixture": {
        if (writingDraft === null) {
          throw new GeneralWorkerServiceError(
            "invalid-state",
            "General Worker writing draft preparation is unavailable",
          );
        }
        attempt.state = "blocked";
        attempt.pendingCallId = "general-worker-task-output-write-text-call";
        events.push(
          this.event(attempt, {
            type: "message",
            role: "assistant",
            content: `Prepared a writing draft from ${String(writingDraft.pointCount)} ordered points.`,
          }),
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: "actestra.task-output.write-text",
            summary: "Create the bounded writing draft.",
            input: Object.freeze({
              contractVersion: 1,
              relativePath: "draft.md",
              mediaType: "text/markdown; charset=utf-8",
              content: writingDraft.content,
            }),
          }),
        );
        break;
      }
      case "office-document-artifact-fixture": {
        if (officeDocument === null) {
          throw new GeneralWorkerServiceError(
            "invalid-state",
            "General Worker Office-document preparation is unavailable",
          );
        }
        attempt.state = "blocked";
        attempt.pendingCallId = "general-worker-task-output-write-office-document-call";
        events.push(
          this.event(attempt, {
            type: "message",
            role: "assistant",
            content: `Prepared a Word document with ${String(officeDocument.sections.length)} structured sections.`,
          }),
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID,
            summary: "Create the bounded Word document.",
            input: Object.freeze({
              contractVersion: 1,
              relativePath: OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH,
              document: officeDocument,
            }),
          }),
        );
        break;
      }
      case "task-output-write-text-fixture":
        attempt.state = "blocked";
        attempt.pendingCallId = "general-worker-task-output-write-text-call";
        events.push(
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: "actestra.task-output.write-text",
            summary: "Create one bounded UTF-8 task output.",
          }),
        );
        break;
      case "model-writing-artifact": {
        // Admission runs before any model turn, so a task General cannot perform is refused rather
        // than sent to a model that would invent the material it lacks.
        const admission = admitGeneralWritingRequest(attempt.requirements);
        if (admission.admitted === false) {
          attempt.state = "failed";
          events.push(
            this.event(attempt, {
              type: "failed",
              errorCode: admission.errorCode,
              message: admission.message,
            }),
          );
          break;
        }
        attempt.pendingModelCallId = "general-worker-model-writing-call";
        events.push(
          this.event(attempt, {
            type: "model-requested",
            callId: attempt.pendingModelCallId,
            prompt: attempt.prompt,
          }),
        );
        break;
      }
    }

    return events;
  }

  private send(
    request: Extract<GeneralWorkerRequest, { operation: "send" }>,
  ): readonly GeneralWorkerEventMessage[] {
    const attempt = this.requireAttempt(request.payload.attemptToken);
    if (attempt.state !== "running" || attempt.pendingModelCallId !== undefined) {
      throw new GeneralWorkerServiceError(
        "invalid-state",
        "General Worker cannot receive input outside a running attempt",
      );
    }
    if (
      (attempt.executionMode === "workspace-read-then-task-output-write-fixture" ||
        attempt.executionMode === "local-research-artifact-fixture") &&
      attempt.awaitingWorkspaceContent
    ) {
      attempt.awaitingWorkspaceContent = false;
      attempt.state = "blocked";
      attempt.pendingCallId = "general-worker-task-output-write-text-call";
      const byteLength = new TextEncoder().encode(request.payload.content).byteLength;
      if (attempt.executionMode === "local-research-artifact-fixture") {
        const research = localResearchArtifact(attempt.prompt, request.payload.content);
        return [
          this.event(attempt, { type: "heartbeat" }),
          this.event(attempt, {
            type: "message",
            role: "assistant",
            content: `Prepared a local research brief from ${String(research.byteLength)} bytes and ${String(research.noteCount)} evidence notes.`,
          }),
          this.event(attempt, {
            type: "tool-requested",
            callId: attempt.pendingCallId,
            toolName: "actestra.task-output.write-text",
            summary: "Create the bounded local research brief.",
            input: Object.freeze({
              contractVersion: 1,
              relativePath: "research.md",
              mediaType: "text/markdown; charset=utf-8",
              content: research.content,
            }),
          }),
        ];
      }
      const source = request.payload.content.endsWith("\n")
        ? request.payload.content
        : `${request.payload.content}\n`;
      const outputContent =
        "# Actestra file result\n\n" +
        `Instruction: ${attempt.prompt.trim()}\n\n` +
        `Source text:\n\n${source}`;
      return [
        this.event(attempt, { type: "heartbeat" }),
        this.event(attempt, {
          type: "message",
          role: "assistant",
          content: `Processed ${String(byteLength)} bytes from the reserved workspace text.`,
        }),
        this.event(attempt, {
          type: "tool-requested",
          callId: attempt.pendingCallId,
          toolName: "actestra.task-output.write-text",
          summary: "Create the processed workspace-file artifact.",
          input: Object.freeze({
            contractVersion: 1,
            relativePath: "result.md",
            mediaType: "text/markdown; charset=utf-8",
            content: outputContent,
          }),
        }),
      ];
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
    const completedWorkspaceRead =
      (attempt.executionMode === "workspace-read-then-task-output-write-fixture" ||
        attempt.executionMode === "local-research-artifact-fixture") &&
      request.payload.callId === "general-worker-workspace-read-text-call";
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
      if (completedWorkspaceRead) {
        attempt.awaitingWorkspaceContent = true;
        return events;
      }
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

  private resolveModel(
    request: Extract<GeneralWorkerRequest, { operation: "resolve-model" }>,
  ): readonly GeneralWorkerEventMessage[] {
    const attempt = this.requireAttempt(request.payload.attemptToken);
    if (
      attempt.executionMode !== "model-writing-artifact" ||
      attempt.state !== "running" ||
      attempt.pendingModelCallId === undefined ||
      attempt.pendingModelCallId !== request.payload.callId
    ) {
      throw new GeneralWorkerServiceError(
        "invalid-state",
        "General Worker has no matching Main model request",
      );
    }

    attempt.pendingModelCallId = undefined;
    if (request.payload.result.status === "failed") {
      attempt.state = "failed";
      return [
        this.event(attempt, {
          type: "failed",
          errorCode: request.payload.result.errorCode,
          message: request.payload.result.message,
        }),
      ];
    }

    const validation = validateGeneralDraft(request.payload.result.content);

    if (validation.valid === false) {
      const spent = attempt.draftRepairAttempts ?? 0;
      if (spent < GENERAL_DRAFT_REPAIR_ATTEMPT_LIMIT) {
        // One repair, naming only the broken rule. The malformed reply is never quoted back.
        attempt.draftRepairAttempts = spent + 1;
        attempt.pendingModelCallId = "general-worker-model-writing-repair-call";
        return [
          this.event(attempt, {
            type: "message",
            role: "system",
            content: `The draft did not satisfy the contract (${validation.violatedRule}). Requesting one repair.`,
          }),
          this.event(attempt, {
            type: "model-requested",
            callId: attempt.pendingModelCallId,
            prompt: buildGeneralDraftRepairInstruction(validation.violatedRule),
          }),
        ];
      }
      // The repair was already spent, so the attempt fails with the code for the rule it broke.
      attempt.state = "failed";
      return [
        this.event(attempt, {
          type: "failed",
          errorCode: validation.errorCode,
          message: validation.message,
        }),
      ];
    }

    if (validation.draft.status === "needs-input") {
      // No artifact is written: a draft built around missing material is the outcome the contract
      // exists to prevent. The surface reports what is missing instead of a finished-looking draft.
      attempt.state = "failed";
      return [
        this.event(attempt, {
          type: "failed",
          errorCode: "general-input-required",
          message: `${validation.draft.message} Missing: ${validation.draft.missingInputs.join(", ")}`,
        }),
      ];
    }

    attempt.state = "blocked";
    attempt.pendingCallId = "general-worker-task-output-write-text-call";
    return [
      this.event(attempt, {
        type: "message",
        role: "assistant",
        content: "Prepared one bounded model-authored writing draft.",
      }),
      this.event(attempt, {
        type: "tool-requested",
        callId: attempt.pendingCallId,
        toolName: "actestra.task-output.write-text",
        summary: "Create the bounded model-authored writing draft.",
        input: Object.freeze({
          contractVersion: 1,
          relativePath: "draft.md",
          mediaType: "text/markdown; charset=utf-8",
          content: validation.draft.markdown,
        }),
      }),
    ];
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
    attempt.pendingModelCallId = undefined;
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
    attempt.pendingModelCallId = undefined;
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
