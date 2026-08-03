import path from "node:path";

export const GOOSE_ACP_PROTOCOL_VERSION = 1 as const;
export const GOOSE_ACP_CRATE_VERSION = "1.0.1" as const;
export const GOOSE_ACP_SCHEMA_VERSION = "1.1.0" as const;
export const GOOSE_AGENT_NAME = "goose" as const;
export const GOOSE_AGENT_VERSION = "1.45.0" as const;
export const ACTESTRA_ACP_CLIENT_VERSION = "0.1.0-alpha.0" as const;

const INITIALIZE_REQUEST_ID = "actestra-goose-initialize-1";
const SESSION_NEW_REQUEST_ID = "actestra-goose-session-new-1";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_SESSION_TIMEOUT_MS = 30_000;
const MAX_SESSION_TIMEOUT_MS = 120_000;
const MAX_INITIALIZE_LINE_BYTES = 64 * 1024;
const MAX_SESSION_LINE_BYTES = 64 * 1024;
const MAX_WORKSPACE_PATH_BYTES = 4 * 1024;

export type GooseAcpHandshakeErrorCode =
  | "invalid-message"
  | "startup-timeout"
  | "transport-error"
  | "process-exit"
  | "unsupported-protocol"
  | "unsupported-agent"
  | "unsupported-version"
  | "unexpected-capabilities";

export class GooseAcpHandshakeError extends Error {
  constructor(
    readonly code: GooseAcpHandshakeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseAcpHandshakeError";
  }
}

export type GooseAcpSessionErrorCode =
  | "invalid-session-options"
  | "invalid-session-message"
  | "session-rejected"
  | "session-already-open"
  | "session-closed"
  | "session-timeout"
  | "session-process-exit"
  | "session-transport-error";

export class GooseAcpSessionError extends Error {
  constructor(
    readonly code: GooseAcpSessionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseAcpSessionError";
  }
}

export interface GooseAcpTransport {
  sendLine(line: string): void;
  onLine(listener: (line: string) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onExit(listener: (code: number | null, signal: string | null) => void): () => void;
  close(): Promise<void>;
}

export interface GooseAcpHandshakeOptions {
  readonly timeoutMs?: number;
}

export interface GooseAcpInfo {
  readonly protocolVersion: typeof GOOSE_ACP_PROTOCOL_VERSION;
  readonly agentName: typeof GOOSE_AGENT_NAME;
  readonly agentVersion: typeof GOOSE_AGENT_VERSION;
  readonly loadSession: true;
  readonly prompt: {
    readonly image: true;
    readonly audio: false;
    readonly embeddedContext: true;
  };
  readonly mcp: {
    readonly http: true;
    readonly sse: false;
    readonly acp: false;
  };
  readonly session: {
    readonly list: true;
    readonly close: true;
  };
}

export interface GooseAcpConnection {
  readonly info: GooseAcpInfo;
  openSession(options: GooseAcpSessionOptions): Promise<GooseAcpSession>;
  close(): Promise<void>;
}

export interface GooseAcpSessionOptions {
  readonly workspaceDirectory: string;
  readonly capabilityProxyUrl: string;
  readonly attemptLease: string;
  readonly timeoutMs?: number;
}

export type GooseAcpSetupNotificationKind = "usage_update" | "available_commands_update";

export interface GooseAcpSession {
  readonly sessionId: string;
  readonly setupNotificationKinds: readonly GooseAcpSetupNotificationKind[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new GooseAcpHandshakeError("invalid-message", `${label} must be an object`);
  }
  return value;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  const missing = expected.filter((key) => !Object.hasOwn(value, key));
  const additional = actual.filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || additional.length > 0) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      `${label} keys do not match the admitted manifest`,
    );
  }
}

function assertEmptyRecord(value: unknown, label: string): void {
  const record = assertRecord(value, label);
  if (Object.keys(record).length !== 0) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      `${label} must not advertise nested capabilities`,
    );
  }
}

function normalizeCapabilities(
  value: unknown,
): Omit<GooseAcpInfo, "protocolVersion" | "agentName" | "agentVersion">;
function normalizeCapabilities(
  value: unknown,
): Omit<GooseAcpInfo, "protocolVersion" | "agentName" | "agentVersion"> {
  const capabilities = assertRecord(value, "Goose agentCapabilities");
  assertExactKeys(
    capabilities,
    ["loadSession", "promptCapabilities", "mcpCapabilities", "sessionCapabilities", "auth"],
    "Goose agentCapabilities",
  );
  if (capabilities.loadSession !== true) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      "Goose must advertise the admitted loadSession capability",
    );
  }

  const prompt = assertRecord(capabilities.promptCapabilities, "Goose promptCapabilities");
  assertExactKeys(prompt, ["image", "audio", "embeddedContext"], "Goose promptCapabilities");
  if (prompt.image !== true || prompt.audio !== false || prompt.embeddedContext !== true) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      "Goose prompt capabilities differ from the admitted manifest",
    );
  }

  const mcp = assertRecord(capabilities.mcpCapabilities, "Goose mcpCapabilities");
  const mcpKeys = Object.keys(mcp);
  if (
    mcpKeys.some((key) => !["http", "sse", "acp"].includes(key)) ||
    mcp.http !== true ||
    (mcp.sse !== undefined && mcp.sse !== false) ||
    (mcp.acp !== undefined && mcp.acp !== false)
  ) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      "Goose MCP capabilities differ from the admitted manifest",
    );
  }

  const session = assertRecord(capabilities.sessionCapabilities, "Goose sessionCapabilities");
  assertExactKeys(session, ["list", "close"], "Goose sessionCapabilities");
  assertEmptyRecord(session.list, "Goose sessionCapabilities.list");
  assertEmptyRecord(session.close, "Goose sessionCapabilities.close");
  assertEmptyRecord(capabilities.auth, "Goose auth capabilities");

  return Object.freeze({
    loadSession: true,
    prompt: Object.freeze({ image: true, audio: false, embeddedContext: true }),
    mcp: Object.freeze({ http: true, sse: false, acp: false }),
    session: Object.freeze({ list: true, close: true }),
  });
}

function parseInitializeResponse(line: string): GooseAcpInfo {
  if (Buffer.byteLength(line, "utf8") > MAX_INITIALIZE_LINE_BYTES) {
    throw new GooseAcpHandshakeError("invalid-message", "Goose initialize response is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new GooseAcpHandshakeError(
      "invalid-message",
      "Goose initialize response is not valid JSON",
      { cause: error },
    );
  }

  const response = assertRecord(parsed, "Goose initialize response");
  const responseKeys = Object.keys(response);
  if (
    responseKeys.length !== 3 ||
    !responseKeys.every((key) => ["jsonrpc", "id", "result"].includes(key)) ||
    response.jsonrpc !== "2.0" ||
    response.id !== INITIALIZE_REQUEST_ID
  ) {
    throw new GooseAcpHandshakeError(
      "invalid-message",
      "Goose initialize response envelope is incompatible",
    );
  }

  const result = assertRecord(response.result, "Goose initialize result");
  const resultKeys = ["protocolVersion", "agentCapabilities", "authMethods", "agentInfo"];
  if (
    Object.keys(result).length !== resultKeys.length ||
    !Object.keys(result).every((key) => resultKeys.includes(key))
  ) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      "Goose initialize result differs from the admitted manifest",
    );
  }
  if (result.protocolVersion !== GOOSE_ACP_PROTOCOL_VERSION) {
    throw new GooseAcpHandshakeError(
      "unsupported-protocol",
      `Goose ACP protocol ${String(result.protocolVersion)} is not supported`,
    );
  }

  const agentInfo = assertRecord(result.agentInfo, "Goose agentInfo");
  assertExactKeys(agentInfo, ["name", "version"], "Goose agentInfo");
  if (agentInfo.name !== GOOSE_AGENT_NAME) {
    throw new GooseAcpHandshakeError(
      "unsupported-agent",
      `ACP agent ${String(agentInfo.name)} is not the admitted Goose implementation`,
    );
  }
  if (agentInfo.version !== GOOSE_AGENT_VERSION) {
    throw new GooseAcpHandshakeError(
      "unsupported-version",
      `Goose ${String(agentInfo.version)} is not the admitted ${GOOSE_AGENT_VERSION} version`,
    );
  }

  if (!Array.isArray(result.authMethods) || result.authMethods.length !== 1) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      "Goose authentication methods differ from the admitted manifest",
    );
  }
  const authMethod = assertRecord(result.authMethods[0], "Goose auth method");
  assertExactKeys(authMethod, ["id", "name", "description"], "Goose auth method");
  if (
    authMethod.id !== "goose-provider" ||
    authMethod.name !== "Configure Provider" ||
    authMethod.description !== "Run `goose configure` to set up your AI provider and API key"
  ) {
    throw new GooseAcpHandshakeError(
      "unexpected-capabilities",
      "Goose authentication method differs from the admitted manifest",
    );
  }

  const normalized = normalizeCapabilities(result.agentCapabilities);
  return Object.freeze({
    protocolVersion: GOOSE_ACP_PROTOCOL_VERSION,
    agentName: GOOSE_AGENT_NAME,
    agentVersion: GOOSE_AGENT_VERSION,
    ...normalized,
  });
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new GooseAcpHandshakeError(
      "invalid-message",
      "Goose handshake timeout must be a positive safe integer",
    );
  }
}

async function closeAfterFailure(transport: GooseAcpTransport, error: unknown): Promise<never> {
  try {
    await transport.close();
  } catch (closeError) {
    throw new GooseAcpHandshakeError(
      "transport-error",
      "Goose handshake failed and process cleanup also failed",
      { cause: new AggregateError([error, closeError]) },
    );
  }
  throw error;
}

function invalidSessionMessage(message: string, cause?: unknown): GooseAcpSessionError {
  return new GooseAcpSessionError(
    "invalid-session-message",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertSessionRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidSessionMessage(`${label} must be an object`);
  }
  return value;
}

function assertSessionExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expectedSet.has(key)) ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw invalidSessionMessage(`${label} fields differ from the admitted ACP message`);
  }
}

function assertSessionAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  if (
    Object.keys(value).some((key) => !allowedSet.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key))
  ) {
    throw invalidSessionMessage(`${label} fields differ from the admitted ACP message`);
  }
}

function assertSessionId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw invalidSessionMessage(`${label} is not a bounded ACP session identifier`);
  }
  return value;
}

interface PendingSessionSetup {
  sessionId?: string;
  readonly notificationKinds: GooseAcpSetupNotificationKind[];
}

function parseSessionMessage(
  line: string,
  setup: PendingSessionSetup,
): GooseAcpSession | undefined {
  if (Buffer.byteLength(line, "utf8") > MAX_SESSION_LINE_BYTES) {
    throw invalidSessionMessage("Goose session setup message is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSessionMessage("Goose session setup message is not valid JSON", error);
  }
  const message = assertSessionRecord(parsed, "Goose session setup message");
  if (Object.hasOwn(message, "method")) {
    assertSessionExactKeys(message, ["jsonrpc", "method", "params"], "Goose notification");
    if (message.jsonrpc !== "2.0" || message.method !== "session/update") {
      throw invalidSessionMessage("Goose sent an unadmitted session setup notification");
    }
    const params = assertSessionRecord(message.params, "Goose session update params");
    assertSessionExactKeys(params, ["sessionId", "update"], "Goose session update params");
    const sessionId = assertSessionId(params.sessionId, "Goose setup notification sessionId");
    if (setup.sessionId !== undefined && setup.sessionId !== sessionId) {
      throw invalidSessionMessage("Goose setup notifications reference different sessions");
    }
    const update = assertSessionRecord(params.update, "Goose session update");
    let notificationKind: GooseAcpSetupNotificationKind;
    if (update.sessionUpdate === "available_commands_update") {
      assertSessionExactKeys(
        update,
        ["sessionUpdate", "availableCommands"],
        "Goose available-commands update",
      );
      if (!Array.isArray(update.availableCommands)) {
        throw invalidSessionMessage("Goose available commands must be an array");
      }
      notificationKind = "available_commands_update";
    } else if (update.sessionUpdate === "usage_update") {
      assertSessionAllowedKeys(
        update,
        ["sessionUpdate", "used", "size", "cost"],
        ["sessionUpdate", "used", "size"],
        "Goose usage update",
      );
      if (
        !Number.isSafeInteger(update.used) ||
        (update.used as number) < 0 ||
        !Number.isSafeInteger(update.size) ||
        (update.size as number) < 1 ||
        (update.cost !== undefined && !isRecord(update.cost))
      ) {
        throw invalidSessionMessage("Goose usage update values are invalid");
      }
      notificationKind = "usage_update";
    } else {
      throw invalidSessionMessage("Goose sent a non-setup session update before session/new");
    }
    if (setup.notificationKinds.length >= 2 || setup.notificationKinds.includes(notificationKind)) {
      throw invalidSessionMessage("Goose exceeded the admitted session setup notification set");
    }
    setup.sessionId = sessionId;
    setup.notificationKinds.push(notificationKind);
    return undefined;
  }

  if (Object.hasOwn(message, "error")) {
    assertSessionExactKeys(message, ["jsonrpc", "id", "error"], "Goose session/new error");
    if (message.jsonrpc !== "2.0" || message.id !== SESSION_NEW_REQUEST_ID) {
      throw invalidSessionMessage("Goose session/new error correlation is incompatible");
    }
    const error = assertSessionRecord(message.error, "Goose session/new error payload");
    assertSessionAllowedKeys(
      error,
      ["code", "message", "data"],
      ["code", "message"],
      "Goose session/new error payload",
    );
    if (
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== "string" ||
      error.message.length < 1 ||
      error.message.length > 1_024
    ) {
      throw invalidSessionMessage("Goose session/new error payload is invalid");
    }
    throw new GooseAcpSessionError(
      "session-rejected",
      "Goose rejected the ACP session/new request",
    );
  }

  assertSessionExactKeys(message, ["jsonrpc", "id", "result"], "Goose session/new response");
  if (message.jsonrpc !== "2.0" || message.id !== SESSION_NEW_REQUEST_ID) {
    throw invalidSessionMessage("Goose session/new response correlation is incompatible");
  }
  const result = assertSessionRecord(message.result, "Goose session/new result");
  assertSessionAllowedKeys(
    result,
    ["sessionId", "modes", "configOptions", "_meta"],
    ["sessionId"],
    "Goose session/new result",
  );
  if (
    (result.modes !== undefined && !isRecord(result.modes)) ||
    (result.configOptions !== undefined && !Array.isArray(result.configOptions)) ||
    (result._meta !== undefined && !isRecord(result._meta))
  ) {
    throw invalidSessionMessage("Goose session/new optional result fields are invalid");
  }
  const sessionId = assertSessionId(result.sessionId, "Goose session/new sessionId");
  if (
    setup.sessionId !== sessionId ||
    !setup.notificationKinds.includes("available_commands_update")
  ) {
    throw invalidSessionMessage("Goose setup notification does not match the created session");
  }
  return Object.freeze({
    sessionId,
    setupNotificationKinds: Object.freeze([...setup.notificationKinds]),
  });
}

async function openGooseAcpSession(
  transport: GooseAcpTransport,
  options: GooseAcpSessionOptions,
): Promise<GooseAcpSession> {
  assertSessionOptions(options);
  const setup: PendingSessionSetup = { notificationKinds: [] };
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const unsubscribers: Array<() => void> = [];
  try {
    return await new Promise<GooseAcpSession>((resolve, reject) => {
      unsubscribers.push(
        transport.onLine((line) => {
          try {
            const session = parseSessionMessage(line, setup);
            if (session !== undefined) {
              resolve(session);
            }
          } catch (error) {
            reject(error);
          }
        }),
        transport.onError((error) => {
          reject(
            new GooseAcpSessionError(
              "session-transport-error",
              "Goose ACP transport failed during session/new",
              { cause: error },
            ),
          );
        }),
        transport.onExit((code, signal) => {
          reject(
            new GooseAcpSessionError(
              "session-process-exit",
              `Goose exited before session/new completed (code=${String(code)}, signal=${String(signal)})`,
            ),
          );
        }),
      );
      timeout = setTimeout(() => {
        reject(
          new GooseAcpSessionError(
            "session-timeout",
            "Goose did not complete ACP session/new before the deadline",
          ),
        );
      }, timeoutMs);
      transport.sendLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: SESSION_NEW_REQUEST_ID,
          method: "session/new",
          params: {
            cwd: options.workspaceDirectory,
            mcpServers: [
              {
                type: "http",
                name: "actestra-capability-proxy",
                url: options.capabilityProxyUrl,
                headers: [
                  {
                    name: "Authorization",
                    value: `Bearer ${options.attemptLease}`,
                  },
                ],
              },
            ],
          },
        }),
      );
    });
  } catch (error) {
    const sessionError =
      error instanceof GooseAcpSessionError
        ? error
        : new GooseAcpSessionError(
            "session-transport-error",
            "Goose ACP transport failed while sending session/new",
            { cause: error },
          );
    try {
      await transport.close();
    } catch (closeError) {
      throw new GooseAcpSessionError(
        "session-transport-error",
        "Goose session setup failed and transport cleanup also failed",
        { cause: new AggregateError([sessionError, closeError]) },
      );
    }
    throw sessionError;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  }
}

function assertSessionOptions(options: GooseAcpSessionOptions): void {
  if (
    typeof options.workspaceDirectory !== "string" ||
    !path.isAbsolute(options.workspaceDirectory) ||
    options.workspaceDirectory.includes("\0") ||
    Buffer.byteLength(options.workspaceDirectory, "utf8") > MAX_WORKSPACE_PATH_BYTES
  ) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose session workspace must be an absolute path",
    );
  }
  const loopbackMatch = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})\/mcp$/.exec(
    options.capabilityProxyUrl,
  );
  const loopbackPort = loopbackMatch === null ? 0 : Number(loopbackMatch[1]);
  if (loopbackPort < 1 || loopbackPort > 65_535) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose session capability proxy must use the exact admitted loopback HTTP endpoint",
    );
  }
  if (
    typeof options.attemptLease !== "string" ||
    options.attemptLease.length < 32 ||
    options.attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(options.attemptLease)
  ) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose session attempt lease is not a bounded opaque bearer value",
    );
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > MAX_SESSION_TIMEOUT_MS)
  ) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose session timeout must be a bounded positive safe integer",
    );
  }
}

export async function connectGooseAcp(
  transport: GooseAcpTransport,
  options: GooseAcpHandshakeOptions = {},
): Promise<GooseAcpConnection> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  assertTimeout(timeoutMs);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const unsubscribers: Array<() => void> = [];
  try {
    const info = await new Promise<GooseAcpInfo>((resolve, reject) => {
      let settled = false;
      const settle = (operation: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        operation();
      };

      unsubscribers.push(
        transport.onLine((line) => {
          settle(() => {
            try {
              resolve(parseInitializeResponse(line));
            } catch (error) {
              reject(error);
            }
          });
        }),
        transport.onError((error) => {
          settle(() => {
            reject(
              new GooseAcpHandshakeError(
                "transport-error",
                "Goose ACP transport failed during initialize",
                { cause: error },
              ),
            );
          });
        }),
        transport.onExit((code, signal) => {
          settle(() => {
            reject(
              new GooseAcpHandshakeError(
                "process-exit",
                `Goose exited before initialize completed (code=${String(code)}, signal=${String(signal)})`,
              ),
            );
          });
        }),
      );
      timeout = setTimeout(() => {
        settle(() => {
          reject(
            new GooseAcpHandshakeError(
              "startup-timeout",
              "Goose did not complete ACP initialize before the deadline",
            ),
          );
        });
      }, timeoutMs);

      transport.sendLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: INITIALIZE_REQUEST_ID,
          method: "initialize",
          params: {
            protocolVersion: GOOSE_ACP_PROTOCOL_VERSION,
            clientCapabilities: {},
            clientInfo: {
              name: "actestra-core",
              version: ACTESTRA_ACP_CLIENT_VERSION,
            },
          },
        }),
      );
    });

    let closed = false;
    let sessionRequested = false;
    return Object.freeze({
      info,
      async openSession(options: GooseAcpSessionOptions): Promise<GooseAcpSession> {
        if (closed) {
          throw new GooseAcpSessionError(
            "session-closed",
            "Goose ACP connection is already closed",
          );
        }
        assertSessionOptions(options);
        if (sessionRequested) {
          throw new GooseAcpSessionError(
            "session-already-open",
            "Goose process already received its single admitted ACP session/new request",
          );
        }
        sessionRequested = true;
        return openGooseAcpSession(transport, options);
      },
      async close(): Promise<void> {
        if (closed) {
          return;
        }
        closed = true;
        await transport.close();
      },
    });
  } catch (error) {
    return closeAfterFailure(transport, error);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  }
}
