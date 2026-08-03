import path from "node:path";

export const GOOSE_ACP_PROTOCOL_VERSION = 1 as const;
export const GOOSE_ACP_CRATE_VERSION = "1.0.1" as const;
export const GOOSE_ACP_SCHEMA_VERSION = "1.1.0" as const;
export const GOOSE_AGENT_NAME = "goose" as const;
export const GOOSE_AGENT_VERSION = "1.45.0" as const;
export const ACTESTRA_ACP_CLIENT_VERSION = "0.1.0-alpha.0" as const;
export const ACTESTRA_GOOSE_MCP_EXTENSION_NAME = "actestra-capability-proxy" as const;

const INITIALIZE_REQUEST_ID = "actestra-goose-initialize-1";
const SESSION_NEW_REQUEST_ID = "actestra-goose-session-new-1";
const TOOLS_LIST_REQUEST_ID = "actestra-goose-tools-list-1";
const SESSION_PROMPT_REQUEST_ID = "actestra-goose-session-prompt-1";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_SESSION_TIMEOUT_MS = 30_000;
const MAX_SESSION_TIMEOUT_MS = 120_000;
const MAX_INITIALIZE_LINE_BYTES = 64 * 1024;
const MAX_SESSION_LINE_BYTES = 64 * 1024;
const MAX_WORKSPACE_PATH_BYTES = 4 * 1024;
const MAX_PROMPT_TEXT_BYTES = 256 * 1024;
const MAX_PROMPT_UPDATES = 512;

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
  | "session-transport-error"
  | "tool-discovery-rejected"
  | "tool-discovery-timeout"
  | "tool-discovery-already-requested"
  | "prompt-rejected"
  | "prompt-timeout"
  | "prompt-already-requested";

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
  discoverTools(options: GooseAcpToolDiscoveryOptions): Promise<GooseAcpToolDiscovery>;
  prompt(options: GooseAcpPromptOptions): Promise<GooseAcpPromptResult>;
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

export interface GooseAcpToolDiscoveryOptions {
  readonly sessionId: string;
  readonly extensionName: string;
  readonly timeoutMs?: number;
}

export interface GooseAcpToolDiscovery {
  readonly toolNames: readonly string[];
}

export interface GooseAcpPromptOptions {
  readonly sessionId: string;
  readonly text: string;
  readonly timeoutMs?: number;
}

export type GooseAcpPromptStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export type GooseAcpJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly GooseAcpJsonValue[]
  | Readonly<{ [key: string]: GooseAcpJsonValue }>;

export type GooseAcpToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type GooseAcpToolStatus = "pending" | "in_progress" | "completed" | "failed";

export type GooseAcpToolCallContent =
  | Readonly<{
      type: "content";
      content: Readonly<{ type: "text"; text: string }>;
    }>
  | Readonly<{
      type: "diff";
      path: string;
      oldText?: string | null;
      newText: string;
    }>
  | Readonly<{
      type: "terminal";
      terminalId: string;
    }>;

export interface GooseAcpToolCallLocation {
  readonly path: string;
  readonly line?: number;
}

export type GooseAcpPromptUpdate =
  | Readonly<{
      type: "session_info_update";
      title?: string | null;
      updatedAt?: string | null;
    }>
  | Readonly<{
      type: "tool_call";
      toolCallId: string;
      title: string;
      kind: GooseAcpToolKind;
      status: GooseAcpToolStatus;
      content?: readonly GooseAcpToolCallContent[];
      locations?: readonly GooseAcpToolCallLocation[];
      rawInput?: GooseAcpJsonValue;
      rawOutput?: GooseAcpJsonValue;
    }>
  | Readonly<{
      type: "tool_call_update";
      toolCallId: string;
      title?: string;
      kind?: GooseAcpToolKind;
      status?: GooseAcpToolStatus;
      content?: readonly GooseAcpToolCallContent[];
      locations?: readonly GooseAcpToolCallLocation[];
      rawInput?: GooseAcpJsonValue;
      rawOutput?: GooseAcpJsonValue;
    }>
  | Readonly<{
      type: "agent_message_chunk";
      messageId?: string;
      text: string;
    }>
  | Readonly<{
      type: "usage_update";
      used: number;
      size: number;
    }>;

export interface GooseAcpPromptResult {
  readonly stopReason: GooseAcpPromptStopReason;
  readonly usage?: Readonly<{
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    thoughtTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  }>;
  readonly updates: readonly GooseAcpPromptUpdate[];
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
                name: ACTESTRA_GOOSE_MCP_EXTENSION_NAME,
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

function assertToolDiscoveryOptions(
  options: GooseAcpToolDiscoveryOptions,
  expectedSessionId: string,
): void {
  if (options.sessionId !== expectedSessionId) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose tool discovery must reference the active admitted session",
    );
  }
  if (options.extensionName !== ACTESTRA_GOOSE_MCP_EXTENSION_NAME) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose tool discovery must reference the admitted Actestra MCP extension",
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
      "Goose tool discovery timeout must be a bounded positive safe integer",
    );
  }
}

function parseToolDiscoveryMessage(
  line: string,
  options: GooseAcpToolDiscoveryOptions,
): GooseAcpToolDiscovery {
  if (Buffer.byteLength(line, "utf8") > MAX_SESSION_LINE_BYTES) {
    throw invalidSessionMessage("Goose tool-discovery message is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSessionMessage("Goose tool-discovery message is not valid JSON", error);
  }
  const message = assertSessionRecord(parsed, "Goose tool-discovery message");
  if (Object.hasOwn(message, "method")) {
    throw invalidSessionMessage("Goose sent an unadmitted message during tool discovery");
  }
  if (Object.hasOwn(message, "error")) {
    assertSessionExactKeys(message, ["jsonrpc", "id", "error"], "Goose tool-discovery error");
    if (message.jsonrpc !== "2.0" || message.id !== TOOLS_LIST_REQUEST_ID) {
      throw invalidSessionMessage("Goose tool-discovery error correlation is incompatible");
    }
    const error = assertSessionRecord(message.error, "Goose tool-discovery error payload");
    assertSessionAllowedKeys(
      error,
      ["code", "message", "data"],
      ["code", "message"],
      "Goose tool-discovery error payload",
    );
    if (
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== "string" ||
      error.message.length < 1 ||
      error.message.length > 1_024
    ) {
      throw invalidSessionMessage("Goose tool-discovery error payload is invalid");
    }
    throw new GooseAcpSessionError(
      "tool-discovery-rejected",
      "Goose rejected explicit MCP tool discovery",
    );
  }
  assertSessionExactKeys(message, ["jsonrpc", "id", "result"], "Goose tool-discovery response");
  if (message.jsonrpc !== "2.0" || message.id !== TOOLS_LIST_REQUEST_ID) {
    throw invalidSessionMessage("Goose tool-discovery response correlation is incompatible");
  }
  const result = assertSessionRecord(message.result, "Goose tool-discovery result");
  assertSessionExactKeys(result, ["tools"], "Goose tool-discovery result");
  if (!Array.isArray(result.tools) || result.tools.length < 1 || result.tools.length > 128) {
    throw invalidSessionMessage("Goose tool discovery returned an invalid tool count");
  }
  const prefix = `${options.extensionName}__`;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of result.tools) {
    const tool = assertSessionRecord(value, "Goose discovered tool");
    assertSessionAllowedKeys(
      tool,
      ["name", "description", "parameters", "permission", "inputSchema", "outputSchema"],
      ["name", "description", "parameters", "permission", "inputSchema"],
      "Goose discovered tool",
    );
    if (
      typeof tool.name !== "string" ||
      !tool.name.startsWith(prefix) ||
      tool.name.length <= prefix.length ||
      tool.name.length > 512 ||
      !/^[A-Za-z0-9._:-]+(?:__[A-Za-z0-9._:-]+)?$/.test(tool.name) ||
      seen.has(tool.name) ||
      typeof tool.description !== "string" ||
      tool.description.length > 16_384 ||
      !Array.isArray(tool.parameters) ||
      tool.parameters.length > 128 ||
      tool.parameters.some(
        (parameter) =>
          typeof parameter !== "string" || parameter.length < 1 || parameter.length > 128,
      ) ||
      (tool.permission !== null &&
        tool.permission !== "always_allow" &&
        tool.permission !== "ask_before" &&
        tool.permission !== "never_allow") ||
      !isRecord(tool.inputSchema) ||
      (tool.outputSchema !== undefined && !isRecord(tool.outputSchema))
    ) {
      throw invalidSessionMessage("Goose discovered tool differs from the admitted shape");
    }
    seen.add(tool.name);
    names.push(tool.name);
  }
  return Object.freeze({ toolNames: Object.freeze(names) });
}

async function discoverGooseAcpTools(
  transport: GooseAcpTransport,
  options: GooseAcpToolDiscoveryOptions,
): Promise<GooseAcpToolDiscovery> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const unsubscribers: Array<() => void> = [];
  try {
    return await new Promise<GooseAcpToolDiscovery>((resolve, reject) => {
      unsubscribers.push(
        transport.onLine((line) => {
          try {
            resolve(parseToolDiscoveryMessage(line, options));
          } catch (error) {
            reject(error);
          }
        }),
        transport.onError((error) => {
          reject(
            new GooseAcpSessionError(
              "session-transport-error",
              "Goose ACP transport failed during explicit tool discovery",
              { cause: error },
            ),
          );
        }),
        transport.onExit((code, signal) => {
          reject(
            new GooseAcpSessionError(
              "session-process-exit",
              `Goose exited before tool discovery completed (code=${String(code)}, signal=${String(signal)})`,
            ),
          );
        }),
      );
      timeout = setTimeout(() => {
        reject(
          new GooseAcpSessionError(
            "tool-discovery-timeout",
            "Goose did not complete explicit MCP tool discovery before the deadline",
          ),
        );
      }, timeoutMs);
      transport.sendLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: TOOLS_LIST_REQUEST_ID,
          method: "_goose/unstable/tools/list",
          params: {
            sessionId: options.sessionId,
            extensionName: options.extensionName,
          },
        }),
      );
    });
  } catch (error) {
    const discoveryError =
      error instanceof GooseAcpSessionError
        ? error
        : new GooseAcpSessionError(
            "session-transport-error",
            "Goose ACP transport failed while sending explicit tool discovery",
            { cause: error },
          );
    try {
      await transport.close();
    } catch (closeError) {
      throw new GooseAcpSessionError(
        "session-transport-error",
        "Goose tool discovery failed and transport cleanup also failed",
        { cause: new AggregateError([discoveryError, closeError]) },
      );
    }
    throw discoveryError;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  }
}

function freezeJsonValue(value: unknown, depth = 0): GooseAcpJsonValue {
  if (depth > 32) {
    throw invalidSessionMessage("Goose prompt JSON value exceeds the admitted nesting depth");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 512) {
      throw invalidSessionMessage("Goose prompt JSON array exceeds the admitted item count");
    }
    return Object.freeze(value.map((item) => freezeJsonValue(item, depth + 1)));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length > 512 || entries.some(([key]) => key.length > 1_024)) {
      throw invalidSessionMessage("Goose prompt JSON object exceeds the admitted field bound");
    }
    return Object.freeze(
      Object.fromEntries(entries.map(([key, item]) => [key, freezeJsonValue(item, depth + 1)])),
    );
  }
  throw invalidSessionMessage("Goose prompt JSON value is incompatible");
}

function normalizeToolKind(value: unknown, fallback?: GooseAcpToolKind): GooseAcpToolKind {
  const kinds: readonly GooseAcpToolKind[] = [
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
  ];
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !kinds.includes(value as GooseAcpToolKind)) {
    throw invalidSessionMessage("Goose tool call kind is incompatible");
  }
  return value as GooseAcpToolKind;
}

function normalizeToolStatus(value: unknown, fallback?: GooseAcpToolStatus): GooseAcpToolStatus {
  const statuses: readonly GooseAcpToolStatus[] = ["pending", "in_progress", "completed", "failed"];
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !statuses.includes(value as GooseAcpToolStatus)) {
    throw invalidSessionMessage("Goose tool call status is incompatible");
  }
  return value as GooseAcpToolStatus;
}

function normalizeToolCallContent(value: unknown): readonly GooseAcpToolCallContent[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw invalidSessionMessage("Goose tool call content exceeds the admitted shape");
  }
  return Object.freeze(
    value.map((item): GooseAcpToolCallContent => {
      const content = assertSessionRecord(item, "Goose tool call content item");
      if (content.type === "content") {
        assertSessionAllowedKeys(
          content,
          ["type", "content", "_meta"],
          ["type", "content"],
          "Goose tool call content item",
        );
        if (content._meta !== undefined && !isRecord(content._meta)) {
          throw invalidSessionMessage("Goose tool call content metadata is incompatible");
        }
        const block = assertSessionRecord(content.content, "Goose tool call content block");
        assertSessionAllowedKeys(
          block,
          ["type", "text", "annotations", "_meta"],
          ["type", "text"],
          "Goose tool call text block",
        );
        if (
          block.type !== "text" ||
          typeof block.text !== "string" ||
          Buffer.byteLength(block.text, "utf8") > MAX_PROMPT_TEXT_BYTES ||
          (block.annotations !== undefined && !isRecord(block.annotations)) ||
          (block._meta !== undefined && !isRecord(block._meta))
        ) {
          throw invalidSessionMessage("Goose tool call text content is incompatible");
        }
        return Object.freeze({
          type: "content" as const,
          content: Object.freeze({ type: "text" as const, text: block.text }),
        });
      }
      if (content.type === "diff") {
        assertSessionAllowedKeys(
          content,
          ["type", "path", "oldText", "newText", "_meta"],
          ["type", "path", "newText"],
          "Goose tool call diff",
        );
        if (
          typeof content.path !== "string" ||
          content.path.length < 1 ||
          Buffer.byteLength(content.path, "utf8") > MAX_WORKSPACE_PATH_BYTES ||
          (content.oldText !== undefined &&
            content.oldText !== null &&
            typeof content.oldText !== "string") ||
          typeof content.newText !== "string" ||
          Buffer.byteLength(content.newText, "utf8") > MAX_PROMPT_TEXT_BYTES ||
          (content._meta !== undefined && !isRecord(content._meta))
        ) {
          throw invalidSessionMessage("Goose tool call diff is incompatible");
        }
        return Object.freeze({
          type: "diff" as const,
          path: content.path,
          ...(content.oldText === undefined ? {} : { oldText: content.oldText }),
          newText: content.newText,
        });
      }
      if (content.type === "terminal") {
        assertSessionAllowedKeys(
          content,
          ["type", "terminalId", "_meta"],
          ["type", "terminalId"],
          "Goose tool call terminal",
        );
        const terminalId = assertSessionId(content.terminalId, "Goose terminal identifier");
        if (content._meta !== undefined && !isRecord(content._meta)) {
          throw invalidSessionMessage("Goose tool call terminal metadata is incompatible");
        }
        return Object.freeze({ type: "terminal" as const, terminalId });
      }
      throw invalidSessionMessage("Goose tool call content type is not admitted");
    }),
  );
}

function normalizeToolCallLocations(value: unknown): readonly GooseAcpToolCallLocation[] {
  if (!Array.isArray(value) || value.length > 128) {
    throw invalidSessionMessage("Goose tool call locations exceed the admitted shape");
  }
  return Object.freeze(
    value.map((item): GooseAcpToolCallLocation => {
      const location = assertSessionRecord(item, "Goose tool call location");
      assertSessionAllowedKeys(
        location,
        ["path", "line", "_meta"],
        ["path"],
        "Goose tool call location",
      );
      if (
        typeof location.path !== "string" ||
        location.path.length < 1 ||
        Buffer.byteLength(location.path, "utf8") > MAX_WORKSPACE_PATH_BYTES ||
        (location.line !== undefined &&
          (!Number.isSafeInteger(location.line) || (location.line as number) < 0)) ||
        (location._meta !== undefined && !isRecord(location._meta))
      ) {
        throw invalidSessionMessage("Goose tool call location is incompatible");
      }
      return Object.freeze({
        path: location.path,
        ...(location.line === undefined ? {} : { line: location.line as number }),
      });
    }),
  );
}

function normalizePromptUpdate(value: unknown): GooseAcpPromptUpdate {
  const update = assertSessionRecord(value, "Goose prompt session update");
  if (update.sessionUpdate === "session_info_update") {
    assertSessionAllowedKeys(
      update,
      ["sessionUpdate", "title", "updatedAt", "_meta"],
      ["sessionUpdate"],
      "Goose session-info update",
    );
    if (
      (update.title !== undefined &&
        update.title !== null &&
        (typeof update.title !== "string" || update.title.length > 1_024)) ||
      (update.updatedAt !== undefined &&
        update.updatedAt !== null &&
        (typeof update.updatedAt !== "string" || update.updatedAt.length > 128)) ||
      (update._meta !== undefined && !isRecord(update._meta))
    ) {
      throw invalidSessionMessage("Goose session-info update is incompatible");
    }
    return Object.freeze({
      type: "session_info_update" as const,
      ...(update.title === undefined ? {} : { title: update.title as string | null }),
      ...(update.updatedAt === undefined ? {} : { updatedAt: update.updatedAt as string | null }),
    });
  }

  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    const initial = update.sessionUpdate === "tool_call";
    assertSessionAllowedKeys(
      update,
      [
        "sessionUpdate",
        "toolCallId",
        "title",
        "kind",
        "status",
        "content",
        "locations",
        "rawInput",
        "rawOutput",
        "_meta",
      ],
      initial ? ["sessionUpdate", "toolCallId", "title"] : ["sessionUpdate", "toolCallId"],
      initial ? "Goose tool call" : "Goose tool call update",
    );
    const toolCallId = assertSessionId(update.toolCallId, "Goose tool call identifier");
    if (
      (update.title !== undefined &&
        (typeof update.title !== "string" ||
          update.title.length < 1 ||
          update.title.length > 4_096)) ||
      (update._meta !== undefined && !isRecord(update._meta))
    ) {
      throw invalidSessionMessage("Goose tool call fields are incompatible");
    }
    const optionalFields = {
      ...(update.title === undefined ? {} : { title: update.title }),
      ...(update.kind === undefined ? {} : { kind: normalizeToolKind(update.kind) }),
      ...(update.status === undefined ? {} : { status: normalizeToolStatus(update.status) }),
      ...(update.content === undefined
        ? {}
        : { content: normalizeToolCallContent(update.content) }),
      ...(update.locations === undefined
        ? {}
        : { locations: normalizeToolCallLocations(update.locations) }),
      ...(update.rawInput === undefined ? {} : { rawInput: freezeJsonValue(update.rawInput) }),
      ...(update.rawOutput === undefined ? {} : { rawOutput: freezeJsonValue(update.rawOutput) }),
    };
    if (initial) {
      return Object.freeze({
        type: "tool_call" as const,
        toolCallId,
        title: update.title as string,
        kind: normalizeToolKind(update.kind, "other"),
        status: normalizeToolStatus(update.status, "pending"),
        ...(update.content === undefined
          ? {}
          : { content: normalizeToolCallContent(update.content) }),
        ...(update.locations === undefined
          ? {}
          : { locations: normalizeToolCallLocations(update.locations) }),
        ...(update.rawInput === undefined ? {} : { rawInput: freezeJsonValue(update.rawInput) }),
        ...(update.rawOutput === undefined ? {} : { rawOutput: freezeJsonValue(update.rawOutput) }),
      });
    }
    return Object.freeze({ type: "tool_call_update" as const, toolCallId, ...optionalFields });
  }

  if (update.sessionUpdate === "agent_message_chunk") {
    assertSessionAllowedKeys(
      update,
      ["sessionUpdate", "content", "messageId", "_meta"],
      ["sessionUpdate", "content"],
      "Goose agent-message chunk",
    );
    const content = assertSessionRecord(update.content, "Goose agent-message content");
    assertSessionAllowedKeys(
      content,
      ["type", "text", "annotations", "_meta"],
      ["type", "text"],
      "Goose agent-message text",
    );
    if (
      content.type !== "text" ||
      typeof content.text !== "string" ||
      Buffer.byteLength(content.text, "utf8") > MAX_PROMPT_TEXT_BYTES ||
      (content.annotations !== undefined && !isRecord(content.annotations)) ||
      (content._meta !== undefined && !isRecord(content._meta)) ||
      (update._meta !== undefined && !isRecord(update._meta))
    ) {
      throw invalidSessionMessage("Goose agent-message chunk is incompatible");
    }
    const messageId =
      update.messageId === undefined
        ? undefined
        : assertSessionId(update.messageId, "Goose agent-message identifier");
    return Object.freeze({
      type: "agent_message_chunk" as const,
      ...(messageId === undefined ? {} : { messageId }),
      text: content.text,
    });
  }

  if (update.sessionUpdate === "usage_update") {
    assertSessionAllowedKeys(
      update,
      ["sessionUpdate", "used", "size", "cost", "_meta"],
      ["sessionUpdate", "used", "size"],
      "Goose prompt usage update",
    );
    if (
      !Number.isSafeInteger(update.used) ||
      (update.used as number) < 0 ||
      !Number.isSafeInteger(update.size) ||
      (update.size as number) < 1 ||
      (update.cost !== undefined && !isRecord(update.cost)) ||
      (update._meta !== undefined && !isRecord(update._meta))
    ) {
      throw invalidSessionMessage("Goose prompt usage update is incompatible");
    }
    return Object.freeze({
      type: "usage_update" as const,
      used: update.used as number,
      size: update.size as number,
    });
  }

  throw invalidSessionMessage("Goose sent an unadmitted prompt session update");
}

function parsePromptMessage(
  line: string,
  options: GooseAcpPromptOptions,
  updates: GooseAcpPromptUpdate[],
): GooseAcpPromptResult | undefined {
  if (Buffer.byteLength(line, "utf8") > MAX_SESSION_LINE_BYTES) {
    throw invalidSessionMessage("Goose prompt message is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw invalidSessionMessage("Goose prompt message is not valid JSON", error);
  }
  const message = assertSessionRecord(parsed, "Goose prompt message");
  if (Object.hasOwn(message, "method")) {
    assertSessionExactKeys(message, ["jsonrpc", "method", "params"], "Goose prompt notification");
    if (message.jsonrpc !== "2.0" || message.method !== "session/update") {
      throw invalidSessionMessage("Goose sent an unadmitted prompt notification");
    }
    const params = assertSessionRecord(message.params, "Goose prompt update params");
    assertSessionExactKeys(params, ["sessionId", "update"], "Goose prompt update params");
    if (params.sessionId !== options.sessionId) {
      throw invalidSessionMessage("Goose prompt update references a different session");
    }
    if (updates.length >= MAX_PROMPT_UPDATES) {
      throw invalidSessionMessage("Goose prompt exceeded the admitted update count");
    }
    updates.push(normalizePromptUpdate(params.update));
    return undefined;
  }
  if (Object.hasOwn(message, "error")) {
    assertSessionExactKeys(message, ["jsonrpc", "id", "error"], "Goose prompt error");
    if (message.jsonrpc !== "2.0" || message.id !== SESSION_PROMPT_REQUEST_ID) {
      throw invalidSessionMessage("Goose prompt error correlation is incompatible");
    }
    const error = assertSessionRecord(message.error, "Goose prompt error payload");
    assertSessionAllowedKeys(
      error,
      ["code", "message", "data"],
      ["code", "message"],
      "Goose prompt error payload",
    );
    if (
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== "string" ||
      error.message.length < 1 ||
      error.message.length > 1_024
    ) {
      throw invalidSessionMessage("Goose prompt error payload is invalid");
    }
    throw new GooseAcpSessionError(
      "prompt-rejected",
      "Goose rejected the ACP session/prompt request",
    );
  }
  assertSessionExactKeys(message, ["jsonrpc", "id", "result"], "Goose prompt response");
  if (message.jsonrpc !== "2.0" || message.id !== SESSION_PROMPT_REQUEST_ID) {
    throw invalidSessionMessage("Goose prompt response correlation is incompatible");
  }
  const result = assertSessionRecord(message.result, "Goose prompt result");
  assertSessionAllowedKeys(
    result,
    ["stopReason", "usage", "_meta"],
    ["stopReason"],
    "Goose prompt result",
  );
  const stopReasons: readonly GooseAcpPromptStopReason[] = [
    "end_turn",
    "max_tokens",
    "max_turn_requests",
    "refusal",
    "cancelled",
  ];
  if (
    typeof result.stopReason !== "string" ||
    !stopReasons.includes(result.stopReason as GooseAcpPromptStopReason) ||
    (result._meta !== undefined && !isRecord(result._meta))
  ) {
    throw invalidSessionMessage("Goose prompt result is incompatible");
  }
  let usage: GooseAcpPromptResult["usage"];
  if (result.usage !== undefined) {
    const rawUsage = assertSessionRecord(result.usage, "Goose prompt result usage");
    assertSessionAllowedKeys(
      rawUsage,
      [
        "totalTokens",
        "inputTokens",
        "outputTokens",
        "thoughtTokens",
        "cachedReadTokens",
        "cachedWriteTokens",
        "_meta",
      ],
      ["totalTokens", "inputTokens", "outputTokens"],
      "Goose prompt result usage",
    );
    const tokenFields = [
      "totalTokens",
      "inputTokens",
      "outputTokens",
      "thoughtTokens",
      "cachedReadTokens",
      "cachedWriteTokens",
    ] as const;
    if (
      tokenFields.some(
        (field) =>
          rawUsage[field] !== undefined &&
          (!Number.isSafeInteger(rawUsage[field]) || (rawUsage[field] as number) < 0),
      ) ||
      (rawUsage._meta !== undefined && !isRecord(rawUsage._meta))
    ) {
      throw invalidSessionMessage("Goose prompt result usage is incompatible");
    }
    usage = Object.freeze({
      totalTokens: rawUsage.totalTokens as number,
      inputTokens: rawUsage.inputTokens as number,
      outputTokens: rawUsage.outputTokens as number,
      ...(rawUsage.thoughtTokens === undefined
        ? {}
        : { thoughtTokens: rawUsage.thoughtTokens as number }),
      ...(rawUsage.cachedReadTokens === undefined
        ? {}
        : { cachedReadTokens: rawUsage.cachedReadTokens as number }),
      ...(rawUsage.cachedWriteTokens === undefined
        ? {}
        : { cachedWriteTokens: rawUsage.cachedWriteTokens as number }),
    });
  }
  return Object.freeze({
    stopReason: result.stopReason as GooseAcpPromptStopReason,
    ...(usage === undefined ? {} : { usage }),
    updates: Object.freeze([...updates]),
  });
}

function assertPromptOptions(options: GooseAcpPromptOptions, expectedSessionId: string): void {
  if (
    options.sessionId !== expectedSessionId ||
    typeof options.text !== "string" ||
    options.text.length < 1 ||
    Buffer.byteLength(options.text, "utf8") > MAX_PROMPT_TEXT_BYTES ||
    (options.timeoutMs !== undefined &&
      (!Number.isSafeInteger(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > MAX_SESSION_TIMEOUT_MS))
  ) {
    throw new GooseAcpSessionError(
      "invalid-session-options",
      "Goose prompt options differ from the active bounded text session",
    );
  }
}

async function promptGooseAcp(
  transport: GooseAcpTransport,
  options: GooseAcpPromptOptions,
): Promise<GooseAcpPromptResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const updates: GooseAcpPromptUpdate[] = [];
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const unsubscribers: Array<() => void> = [];
  try {
    return await new Promise<GooseAcpPromptResult>((resolve, reject) => {
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
          if (settled) {
            return;
          }
          try {
            const result = parsePromptMessage(line, options, updates);
            if (result !== undefined) {
              settle(() => resolve(result));
            }
          } catch (error) {
            settle(() => reject(error));
          }
        }),
        transport.onError((error) => {
          settle(() =>
            reject(
              new GooseAcpSessionError(
                "session-transport-error",
                "Goose ACP transport failed during session/prompt",
                { cause: error },
              ),
            ),
          );
        }),
        transport.onExit((code, signal) => {
          settle(() =>
            reject(
              new GooseAcpSessionError(
                "session-process-exit",
                `Goose exited before session/prompt completed (code=${String(code)}, signal=${String(signal)})`,
              ),
            ),
          );
        }),
      );
      timeout = setTimeout(() => {
        settle(() =>
          reject(
            new GooseAcpSessionError(
              "prompt-timeout",
              "Goose did not complete ACP session/prompt before the deadline",
            ),
          ),
        );
      }, timeoutMs);
      transport.sendLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: SESSION_PROMPT_REQUEST_ID,
          method: "session/prompt",
          params: {
            sessionId: options.sessionId,
            prompt: [{ type: "text", text: options.text }],
          },
        }),
      );
    });
  } catch (error) {
    const promptError =
      error instanceof GooseAcpSessionError
        ? error
        : new GooseAcpSessionError(
            "session-transport-error",
            "Goose ACP transport failed while sending session/prompt",
            { cause: error },
          );
    try {
      await transport.close();
    } catch (closeError) {
      throw new GooseAcpSessionError(
        "session-transport-error",
        "Goose prompt failed and transport cleanup also failed",
        { cause: new AggregateError([promptError, closeError]) },
      );
    }
    throw promptError;
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
    let activeSessionId: string | undefined;
    let toolDiscoveryRequested = false;
    let toolDiscoveryCompleted = false;
    let promptRequested = false;
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
        const session = await openGooseAcpSession(transport, options);
        activeSessionId = session.sessionId;
        return session;
      },
      async discoverTools(options: GooseAcpToolDiscoveryOptions): Promise<GooseAcpToolDiscovery> {
        if (closed) {
          throw new GooseAcpSessionError(
            "session-closed",
            "Goose ACP connection is already closed",
          );
        }
        if (activeSessionId === undefined) {
          throw new GooseAcpSessionError(
            "invalid-session-options",
            "Goose tool discovery requires an active admitted session",
          );
        }
        assertToolDiscoveryOptions(options, activeSessionId);
        if (toolDiscoveryRequested) {
          throw new GooseAcpSessionError(
            "tool-discovery-already-requested",
            "Goose process already received its single admitted tool-discovery request",
          );
        }
        toolDiscoveryRequested = true;
        const discovery = await discoverGooseAcpTools(transport, options);
        toolDiscoveryCompleted = true;
        return discovery;
      },
      async prompt(options: GooseAcpPromptOptions): Promise<GooseAcpPromptResult> {
        if (closed) {
          throw new GooseAcpSessionError(
            "session-closed",
            "Goose ACP connection is already closed",
          );
        }
        if (activeSessionId === undefined || !toolDiscoveryCompleted) {
          throw new GooseAcpSessionError(
            "invalid-session-options",
            "Goose prompt requires an active session with admitted tool discovery",
          );
        }
        assertPromptOptions(options, activeSessionId);
        if (promptRequested) {
          throw new GooseAcpSessionError(
            "prompt-already-requested",
            "Goose process already received its single admitted session/prompt request",
          );
        }
        promptRequested = true;
        return promptGooseAcp(transport, options);
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
