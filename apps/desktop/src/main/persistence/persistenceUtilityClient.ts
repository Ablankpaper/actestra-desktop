import { createHash, randomUUID } from "node:crypto";
import {
  CoreContractError,
  PersistenceError,
  type ActestraPersistencePort,
  type AgentAttemptEvidence,
  type AppendPrivilegedAuditInput,
  type AuditRecord,
  type CoreEvent,
  type CoreEventCursor,
  type DomainGraph,
  type EventStreamId,
  type PersistContentReferenceResult,
  type PersistEvidenceResult,
  type PersistEventResult,
  type PersistWorkspaceGrantResult,
  type PrivilegedAuditSummary,
  type ResolveContentReferenceInput,
  type ResolvedContentReference,
  type StoreContentReferenceInput,
  type WorkspaceGrant,
  type WorkspaceId,
} from "../../core";
import {
  PERSISTENCE_UTILITY_PROTOCOL_VERSION,
  assertPersistenceUtilityMessage,
  assertPersistenceUtilityRequest,
  type PersistenceUtilityErrorData,
  type PersistenceUtilityMessage,
  type PersistenceUtilityOperation,
  type PersistenceUtilityOperationMap,
  type PersistenceUtilityRequest,
  type PersistenceUtilityResponse,
} from "../../shared/persistenceUtilityProtocol";

export type PersistenceUtilityErrorCode =
  | "startup-timeout"
  | "request-timeout"
  | "unavailable"
  | "invalid-message"
  | "operation-failed";

export class PersistenceUtilityError extends Error {
  constructor(
    readonly code: PersistenceUtilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PersistenceUtilityError";
  }
}

export interface PersistenceUtilityTransport {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onExit(listener: (code: number) => void): () => void;
  kill(): boolean;
}

export interface PersistenceUtilityClientOptions {
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly operation: PersistenceUtilityOperation;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function responseError(error: PersistenceUtilityErrorData): Error {
  if (error.domain === "persistence") {
    return new PersistenceError(error.code, error.message);
  }
  if (error.domain === "core-contract") {
    return new CoreContractError(error.code, error.message);
  }
  return new PersistenceUtilityError("operation-failed", error.message);
}

export class PersistenceUtilityClient implements ActestraPersistencePort {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeExit: () => void;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveStartup!: () => void;
  private rejectStartup!: (error: Error) => void;
  private readonly startup: Promise<void>;
  private receivedReady = false;
  private connected = false;
  private closed = false;
  private failed = false;
  private futureError: Error | null = null;
  private _schemaVersion = 0;

  private constructor(
    private readonly transport: PersistenceUtilityTransport,
    private readonly userDataPath: string,
    options: PersistenceUtilityClientOptions,
  ) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.startupTimeoutMs) ||
      this.startupTimeoutMs < 1 ||
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1
    ) {
      throw new PersistenceUtilityError(
        "operation-failed",
        "Persistence utility timeouts must be positive integers",
      );
    }

    this.startup = new Promise<void>((resolve, reject) => {
      this.resolveStartup = resolve;
      this.rejectStartup = reject;
    });
    this.unsubscribeMessage = transport.onMessage((message) => {
      this.handleMessage(message);
    });
    this.unsubscribeExit = transport.onExit(() => {
      if (!this.closed) {
        this.fail(
          new PersistenceUtilityError("unavailable", "Persistence utility exited"),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }
    });
  }

  static async connect(
    transport: PersistenceUtilityTransport,
    userDataPath: string,
    options: PersistenceUtilityClientOptions = {},
  ): Promise<PersistenceUtilityClient> {
    const client = new PersistenceUtilityClient(transport, userDataPath, options);
    client.startupTimer = setTimeout(() => {
      client.fail(
        new PersistenceUtilityError(
          "startup-timeout",
          "Persistence utility did not become ready in time",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
    }, client.startupTimeoutMs);
    await client.startup;
    return client;
  }

  get schemaVersion(): number {
    return this._schemaVersion;
  }

  async loadDomainGraph(): Promise<DomainGraph> {
    return this.invoke("load-domain-graph", {});
  }

  async replaceDomainGraph(graph: DomainGraph): Promise<void> {
    await this.invoke("replace-domain-graph", {
      graph,
    });
  }

  async appendEvent(event: CoreEvent): Promise<PersistEventResult> {
    return this.invoke("append-event", {
      event,
    });
  }

  async replayEvents(
    streamId: EventStreamId,
    after?: CoreEventCursor,
  ): Promise<readonly CoreEvent[]> {
    return this.invoke("replay-events", {
      streamId,
      after: after ?? null,
    });
  }

  async appendPrivilegedAudit(input: AppendPrivilegedAuditInput): Promise<AuditRecord> {
    return this.invoke("append-privileged-audit", {
      input,
    });
  }

  async appendAgentAttemptEvidence(evidence: AgentAttemptEvidence): Promise<PersistEvidenceResult> {
    return this.invoke("append-agent-attempt-evidence", {
      evidence,
    });
  }

  async summarizePrivilegedAudit(): Promise<PrivilegedAuditSummary> {
    return this.invoke("summarize-privileged-audit", {});
  }

  async listRecentAgentAttemptEvidence(limit: number): Promise<readonly AgentAttemptEvidence[]> {
    return this.invoke("list-agent-attempt-evidence", {
      limit,
    });
  }

  async persistWorkspaceGrant(grant: WorkspaceGrant): Promise<PersistWorkspaceGrantResult> {
    return this.invoke("persist-workspace-grant", {
      grant,
    });
  }

  async getActiveWorkspaceGrant(workspaceId: WorkspaceId): Promise<WorkspaceGrant | null> {
    return this.invoke("get-active-workspace-grant", {
      workspaceId,
    });
  }

  async storeContentReference(
    input: StoreContentReferenceInput,
  ): Promise<PersistContentReferenceResult> {
    return this.invoke("store-content-reference", {
      input,
    });
  }

  async resolveContentReference(
    input: ResolveContentReferenceInput,
  ): Promise<ResolvedContentReference> {
    return this.invoke("resolve-content-reference", {
      input,
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.failed) {
      this.closed = true;
      this.cleanup();
      this.transport.kill();
      return;
    }

    try {
      await this.invoke("close", {});
    } finally {
      this.closed = true;
      this.cleanup();
      this.transport.kill();
    }
  }

  private async invoke<Operation extends PersistenceUtilityOperation>(
    operation: Operation,
    payload: PersistenceUtilityOperationMap[Operation]["request"],
  ): Promise<PersistenceUtilityOperationMap[Operation]["result"]> {
    this.assertAvailable();
    return this.sendRequest(operation, payload);
  }

  private sendRequest<Operation extends PersistenceUtilityOperation>(
    operation: Operation,
    payload: PersistenceUtilityOperationMap[Operation]["request"],
  ): Promise<PersistenceUtilityOperationMap[Operation]["result"]> {
    const requestId = `persistence-${randomUUID()}`;
    const request: PersistenceUtilityRequest<Operation> = {
      protocolVersion: PERSISTENCE_UTILITY_PROTOCOL_VERSION,
      type: "request",
      requestId,
      operation,
      payload,
    } as PersistenceUtilityRequest<Operation>;
    assertPersistenceUtilityRequest(request);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const timeoutError = new PersistenceUtilityError(
          "request-timeout",
          `Persistence utility ${operation} request timed out`,
        );
        this.fail(
          timeoutError,
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        operation,
        resolve: (value) => {
          resolve(value as PersistenceUtilityOperationMap[Operation]["result"]);
        },
        reject,
        timeout,
      });

      try {
        this.transport.postMessage(request);
      } catch {
        this.fail(
          new PersistenceUtilityError(
            "unavailable",
            "Persistence utility request could not be sent",
          ),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
      }
    });
  }

  private handleMessage(value: unknown): void {
    if (this.closed || this.failed) {
      return;
    }

    try {
      assertPersistenceUtilityMessage(value);
    } catch {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility sent an invalid message",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    const message: PersistenceUtilityMessage = value;
    if (message.type === "ready") {
      if (this.receivedReady || this.connected) {
        this.fail(
          new PersistenceUtilityError(
            "invalid-message",
            "Persistence utility sent an unexpected ready message",
          ),
          new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
        );
        return;
      }
      this.receivedReady = true;
      void this.sendRequest("open", {
        userDataPath: this.userDataPath,
      }).then(
        (result) => {
          if (this.failed || this.closed) {
            return;
          }
          this._schemaVersion = result.schemaVersion;
          this.connected = true;
          this.clearStartupTimer();
          this.resolveStartup();
        },
        (error: Error) => {
          this.fail(
            error,
            new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
          );
        },
      );
      return;
    }
    if (message.type === "fatal") {
      this.fail(
        new PersistenceUtilityError(
          message.code === "invalid-request" ? "invalid-message" : "unavailable",
          message.message,
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }
    if (message.type === "request") {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility cannot send requests to main",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    this.handleResponse(message);
  }

  private handleResponse(response: PersistenceUtilityResponse): void {
    const pending = this.pending.get(response.requestId);
    if (pending === undefined || pending.operation !== response.operation) {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility response correlation is invalid",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    if (
      response.status === "ok" &&
      response.operation === "resolve-content-reference" &&
      createHash("sha256").update(response.result.content, "utf8").digest("hex") !==
        response.result.metadata.sha256
    ) {
      this.fail(
        new PersistenceUtilityError(
          "invalid-message",
          "Persistence utility content digest is invalid",
        ),
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable"),
      );
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.requestId);
    if (response.status === "error") {
      pending.reject(responseError(response.error));
      return;
    }
    pending.resolve(response.result);
  }

  private assertAvailable(): void {
    if (this.closed) {
      throw new PersistenceUtilityError("unavailable", "Persistence utility client is closed");
    }
    if (this.failed || !this.connected) {
      throw (
        this.futureError ??
        new PersistenceUtilityError("unavailable", "Persistence utility is unavailable")
      );
    }
  }

  private fail(error: Error, futureError: Error): void {
    if (this.failed || this.closed) {
      return;
    }
    this.failed = true;
    this.futureError = futureError;
    this.clearStartupTimer();
    this.rejectStartup(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.cleanup();
    this.transport.kill();
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  private cleanup(): void {
    this.clearStartupTimer();
    this.unsubscribeMessage();
    this.unsubscribeExit();
  }
}
