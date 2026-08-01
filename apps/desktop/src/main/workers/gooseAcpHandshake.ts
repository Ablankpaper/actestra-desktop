export const GOOSE_ACP_PROTOCOL_VERSION = 1 as const;
export const GOOSE_ACP_CRATE_VERSION = "1.0.1" as const;
export const GOOSE_ACP_SCHEMA_VERSION = "1.1.0" as const;
export const GOOSE_AGENT_NAME = "goose" as const;
export const GOOSE_AGENT_VERSION = "1.45.0" as const;
export const ACTESTRA_ACP_CLIENT_VERSION = "0.1.0-alpha.0" as const;

const INITIALIZE_REQUEST_ID = "actestra-goose-initialize-1";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_INITIALIZE_LINE_BYTES = 64 * 1024;

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
  close(): Promise<void>;
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
    return Object.freeze({
      info,
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
