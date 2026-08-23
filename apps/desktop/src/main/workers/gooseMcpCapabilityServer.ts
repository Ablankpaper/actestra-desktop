import { createHash, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import {
  CODING_DIFF_TOOL_ID,
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_TEST_TOOL_ID,
  CODING_TOOL_IDS,
  MAX_ISOLATED_CODING_TEXT_BYTES,
  MAX_SCOPED_NATIVE_RELATIVE_PATH_BYTES,
  parseCodingToolInput,
  type IsolatedCodingToolId,
  type IsolatedCodingToolInput,
} from "../../core";
import {
  closeGooseBridgeServer,
  GooseBridgeSocketError,
  listenGooseBridgeServer,
  type GooseBridgeListenerOptions,
  type GooseBridgeServerBinding,
} from "./gooseBridgeSocket";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const SERVER_NAME = "actestra-core";
const SERVER_VERSION = "0.1.0-alpha.0";
const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_TOOLS_LIST_WAIT_MS = 30_000;
const MAX_TOOLS_LIST_WAIT_MS = 120_000;
const MAX_WORKSPACE_PATH_BYTES = 4 * 1024;
const MAX_TOOL_CALLS = 128;

export interface GooseMcpToolCall {
  readonly sessionId: string;
  readonly toolCallRequestId: string;
  readonly toolId: IsolatedCodingToolId;
  readonly input: IsolatedCodingToolInput;
  readonly signal: AbortSignal;
}

export interface GooseMcpToolInvocationResult {
  readonly isError: boolean;
  readonly content: string;
}

export type GooseMcpToolInvoker = (call: GooseMcpToolCall) => Promise<GooseMcpToolInvocationResult>;

export interface StartGooseMcpCapabilityServerOptions {
  readonly attemptLease: string;
  readonly commandIds: readonly string[];
  readonly testIds: readonly string[];
  readonly workspaceDirectory: string;
  readonly invokeTool: GooseMcpToolInvoker;
  readonly socketPath?: string;
  readonly loopbackPort?: number;
}

export interface GooseMcpCapabilityServer {
  readonly url: string;
  waitForToolsList(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export type GooseMcpCapabilityServerErrorCode =
  | "invalid-config"
  | "listen-failed"
  | "invalid-wait-timeout"
  | "closed"
  | "tools-list-timeout";

export class GooseMcpCapabilityServerError extends Error {
  constructor(
    readonly code: GooseMcpCapabilityServerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseMcpCapabilityServerError";
  }
}

type ServerPhase = "initialize" | "initialized" | "ready";
type RequestBodyErrorCode = "invalid-json" | "invalid-request" | "too-large";

interface ToolsListWaiter {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

class RequestBodyError extends Error {
  constructor(
    readonly code: RequestBodyErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RequestBodyError";
  }
}

type JsonRpcRequest = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function initializeRequestId(message: JsonRpcRequest): number | undefined {
  if (!hasExactKeys(message, ["jsonrpc", "id", "method", "params"])) {
    return undefined;
  }
  if (
    message.jsonrpc !== "2.0" ||
    message.method !== "initialize" ||
    typeof message.id !== "number" ||
    !Number.isSafeInteger(message.id) ||
    message.id < 0 ||
    !isRecord(message.params) ||
    !hasExactKeys(message.params, ["protocolVersion", "capabilities", "clientInfo"]) ||
    message.params.protocolVersion !== MCP_PROTOCOL_VERSION
  ) {
    return undefined;
  }
  const capabilities = message.params.capabilities;
  if (
    !isRecord(capabilities) ||
    !hasExactKeys(capabilities, ["extensions", "roots", "sampling", "elicitation"]) ||
    !isEmptyRecord(capabilities.extensions) ||
    !isEmptyRecord(capabilities.roots) ||
    !isEmptyRecord(capabilities.sampling) ||
    !isEmptyRecord(capabilities.elicitation)
  ) {
    return undefined;
  }
  const clientInfo = message.params.clientInfo;
  if (
    !isRecord(clientInfo) ||
    !hasExactKeys(clientInfo, ["name", "version"]) ||
    clientInfo.name !== SERVER_NAME ||
    clientInfo.version !== SERVER_VERSION
  ) {
    return undefined;
  }
  return message.id;
}

function isInitializedNotification(message: JsonRpcRequest): boolean {
  return (
    hasExactKeys(message, ["jsonrpc", "method"]) &&
    message.jsonrpc === "2.0" &&
    message.method === "notifications/initialized"
  );
}

function isRequestId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

interface ToolsListRequest {
  readonly requestId: number;
  readonly sessionId: string;
}

function toolsListRequest(message: JsonRpcRequest): ToolsListRequest | undefined {
  if (
    !hasExactKeys(message, ["jsonrpc", "id", "method", "params"]) ||
    message.jsonrpc !== "2.0" ||
    message.method !== "tools/list" ||
    !isRequestId(message.id) ||
    !isRecord(message.params) ||
    !hasExactKeys(message.params, ["_meta"])
  ) {
    return undefined;
  }
  const meta = message.params._meta;
  if (
    !isRecord(meta) ||
    (!hasExactKeys(meta, ["agent-session-id"]) &&
      !hasExactKeys(meta, ["agent-session-id", "progressToken"]))
  ) {
    return undefined;
  }
  const sessionId = meta["agent-session-id"];
  if (
    typeof sessionId !== "string" ||
    sessionId.length < 1 ||
    sessionId.length > 256 ||
    !/^[A-Za-z0-9._:-]+$/.test(sessionId)
  ) {
    return undefined;
  }
  if (
    Object.hasOwn(meta, "progressToken") &&
    (typeof meta.progressToken !== "number" ||
      !Number.isSafeInteger(meta.progressToken) ||
      meta.progressToken < 0)
  ) {
    return undefined;
  }
  return Object.freeze({ requestId: message.id, sessionId });
}

function invalidConfig(message: string): GooseMcpCapabilityServerError {
  return new GooseMcpCapabilityServerError("invalid-config", message);
}

function ownDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidConfig(`Goose MCP server ${key} must be an own data property`);
  }
  return descriptor.value;
}

function snapshotRegistryIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw invalidConfig(`Goose MCP server ${label} must contain between 1 and 128 identifiers`);
  }
  const identifiers: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const identifier = ownDataProperty(value, String(index));
    if (
      typeof identifier !== "string" ||
      identifier.length < 1 ||
      identifier.length > 128 ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(identifier) ||
      seen.has(identifier)
    ) {
      throw invalidConfig(`Goose MCP server ${label} contains an invalid identifier`);
    }
    seen.add(identifier);
    identifiers.push(identifier);
  }
  return Object.freeze(identifiers);
}

function validateOptions(options: StartGooseMcpCapabilityServerOptions): {
  readonly attemptLease: string;
  readonly commandIds: readonly string[];
  readonly testIds: readonly string[];
  readonly workspaceDirectory: string;
  readonly invokeTool: GooseMcpToolInvoker;
  readonly socketPath?: string;
  readonly loopbackPort?: number;
} {
  if (!isRecord(options)) {
    throw invalidConfig("Goose MCP server options must be an object");
  }
  const keys = Reflect.ownKeys(options);
  if (
    keys.length < 5 ||
    keys.length > 7 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        ![
          "attemptLease",
          "commandIds",
          "testIds",
          "workspaceDirectory",
          "invokeTool",
          "socketPath",
          "loopbackPort",
        ].includes(key),
    )
  ) {
    throw invalidConfig("Goose MCP server options contain unsupported fields");
  }
  const attemptLease = ownDataProperty(options, "attemptLease");
  if (
    typeof attemptLease !== "string" ||
    attemptLease.length < 32 ||
    attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(attemptLease)
  ) {
    throw invalidConfig("Goose MCP server attempt lease is invalid");
  }
  const workspaceDirectory = ownDataProperty(options, "workspaceDirectory");
  if (
    typeof workspaceDirectory !== "string" ||
    !path.isAbsolute(workspaceDirectory) ||
    path.resolve(workspaceDirectory) !== workspaceDirectory ||
    path.parse(workspaceDirectory).root === workspaceDirectory ||
    workspaceDirectory.includes("\0") ||
    Buffer.byteLength(workspaceDirectory, "utf8") > MAX_WORKSPACE_PATH_BYTES
  ) {
    throw invalidConfig("Goose MCP server workspace must be an absolute normalized non-root path");
  }
  const invokeTool = ownDataProperty(options, "invokeTool");
  if (typeof invokeTool !== "function") {
    throw invalidConfig("Goose MCP server tool invoker must be a function");
  }
  const socketPath = Object.hasOwn(options, "socketPath")
    ? ownDataProperty(options, "socketPath")
    : undefined;
  const loopbackPort = Object.hasOwn(options, "loopbackPort")
    ? ownDataProperty(options, "loopbackPort")
    : undefined;
  if ((socketPath === undefined) !== (loopbackPort === undefined)) {
    throw invalidConfig("Goose MCP server socket path and loopback port must be paired");
  }
  return Object.freeze({
    attemptLease,
    commandIds: snapshotRegistryIds(ownDataProperty(options, "commandIds"), "commandIds"),
    testIds: snapshotRegistryIds(ownDataProperty(options, "testIds"), "testIds"),
    workspaceDirectory,
    invokeTool: invokeTool as GooseMcpToolInvoker,
    ...(socketPath === undefined
      ? {}
      : {
          socketPath: socketPath as string,
          loopbackPort: loopbackPort as number,
        }),
  });
}

interface ParsedToolCall {
  readonly requestId: number;
  readonly sessionId: string;
  readonly toolCallRequestId: string;
  readonly toolId: IsolatedCodingToolId;
  readonly input: IsolatedCodingToolInput;
}

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function parseToolCallRequest(
  message: JsonRpcRequest,
  expectedSessionId: string | undefined,
  expectedWorkspaceDirectory: string,
): ParsedToolCall | undefined {
  if (
    expectedSessionId === undefined ||
    !hasExactKeys(message, ["jsonrpc", "id", "method", "params"]) ||
    message.jsonrpc !== "2.0" ||
    message.method !== "tools/call" ||
    !isRequestId(message.id) ||
    !isRecord(message.params) ||
    !hasExactKeys(message.params, ["name", "arguments", "_meta"]) ||
    typeof message.params.name !== "string" ||
    !CODING_TOOL_IDS.includes(message.params.name as IsolatedCodingToolId) ||
    !isRecord(message.params.arguments) ||
    !isRecord(message.params._meta)
  ) {
    return undefined;
  }
  const meta = message.params._meta;
  const requiredMeta = [
    "agent-session-id",
    "agent-working-dir",
    "agent-tool-call-request-id",
  ] as const;
  if (
    (!hasExactKeys(meta, requiredMeta) &&
      !hasExactKeys(meta, [...requiredMeta, "progressToken"])) ||
    meta["agent-session-id"] !== expectedSessionId ||
    meta["agent-working-dir"] !== expectedWorkspaceDirectory ||
    !isBoundedIdentifier(meta["agent-tool-call-request-id"]) ||
    (Object.hasOwn(meta, "progressToken") &&
      (typeof meta.progressToken !== "number" ||
        !Number.isSafeInteger(meta.progressToken) ||
        meta.progressToken < 0))
  ) {
    return undefined;
  }
  const toolId = message.params.name as IsolatedCodingToolId;
  let input: IsolatedCodingToolInput;
  try {
    input = parseCodingToolInput(toolId, JSON.stringify(message.params.arguments));
  } catch {
    return undefined;
  }
  return Object.freeze({
    requestId: message.id,
    sessionId: expectedSessionId,
    toolCallRequestId: meta["agent-tool-call-request-id"],
    toolId,
    input: Object.freeze({ ...input }),
  });
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function normalizeToolResult(value: unknown): GooseMcpToolInvocationResult | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["isError", "content"]) ||
    typeof value.isError !== "boolean" ||
    typeof value.content !== "string" ||
    hasUnpairedSurrogate(value.content) ||
    Buffer.byteLength(value.content, "utf8") > MAX_REQUEST_BYTES
  ) {
    return undefined;
  }
  return Object.freeze({ isError: value.isError, content: value.content });
}

function jsonResponse(
  response: ServerResponse,
  status: number,
  body: Readonly<Record<string, unknown>>,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function accepted(response: ServerResponse): void {
  response.writeHead(202, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end();
}

function rawHeaderValues(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function rejectHttp(request: IncomingMessage, response: ServerResponse, status: number): void {
  request.pause();
  response.shouldKeepAlive = false;
  response.setHeader("Connection", "close");
  response.once("finish", () => request.socket.destroy());
  jsonResponse(response, status, {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32600, message: "Rejected MCP transport request" },
  });
}

function hasExpectedAuthorization(request: IncomingMessage, expectedLeaseDigest: Buffer): boolean {
  const values = rawHeaderValues(request, "authorization");
  if (values.length !== 1) {
    return false;
  }
  const match = /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(values[0]!);
  if (match === null) {
    return false;
  }
  const candidateDigest = createHash("sha256").update(match[1]!, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedLeaseDigest);
}

function validateHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  expectedHost: string,
  expectedLeaseDigest: Buffer,
  phase: ServerPhase,
): boolean {
  if (!hasExpectedAuthorization(request, expectedLeaseDigest)) {
    rejectHttp(request, response, 401);
    return false;
  }
  const hosts = rawHeaderValues(request, "host");
  if (hosts.length !== 1 || hosts[0] !== expectedHost) {
    rejectHttp(request, response, 400);
    return false;
  }
  if (rawHeaderValues(request, "origin").length !== 0) {
    rejectHttp(request, response, 403);
    return false;
  }
  const contentTypes = rawHeaderValues(request, "content-type");
  if (contentTypes.length !== 1 || contentTypes[0] !== "application/json") {
    rejectHttp(request, response, 415);
    return false;
  }
  const transferEncodings = rawHeaderValues(request, "transfer-encoding");
  const contentLengths = rawHeaderValues(request, "content-length");
  if (transferEncodings.length !== 0 || contentLengths.length !== 1) {
    rejectHttp(request, response, 411);
    return false;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(contentLengths[0]!)) {
    rejectHttp(request, response, 400);
    return false;
  }
  const contentLength = Number(contentLengths[0]);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
    rejectHttp(request, response, 400);
    return false;
  }
  if (contentLength > MAX_REQUEST_BYTES) {
    rejectHttp(request, response, 413);
    return false;
  }
  const accepts = rawHeaderValues(request, "accept");
  if (accepts.length !== 1 || accepts[0] !== "text/event-stream, application/json") {
    rejectHttp(request, response, 406);
    return false;
  }
  const userAgents = rawHeaderValues(request, "user-agent");
  if (userAgents.length !== 1 || userAgents[0] !== "goose/1.45.0") {
    rejectHttp(request, response, 403);
    return false;
  }
  if (rawHeaderValues(request, "mcp-session-id").length !== 0) {
    rejectHttp(request, response, 400);
    return false;
  }
  const protocolVersions = rawHeaderValues(request, "mcp-protocol-version");
  if (
    (phase === "initialize" && protocolVersions.length !== 0) ||
    (phase !== "initialize" &&
      (protocolVersions.length !== 1 || protocolVersions[0] !== MCP_PROTOCOL_VERSION))
  ) {
    rejectHttp(request, response, 400);
    return false;
  }
  return true;
}

async function readJson(request: IncomingMessage): Promise<JsonRpcRequest> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_REQUEST_BYTES) {
      throw new RequestBodyError("too-large", "MCP request body is too large");
    }
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    throw new RequestBodyError("invalid-json", "MCP request body is not valid JSON", {
      cause: error,
    });
  }
  if (!isRecord(value)) {
    throw new RequestBodyError("invalid-request", "MCP request must be a JSON object");
  }
  return value;
}

function contractVersionProperty(): Readonly<Record<string, unknown>> {
  return Object.freeze({ type: "integer", const: 1 });
}

export function toolList(
  commandIds: readonly string[],
  testIds: readonly string[],
): readonly unknown[] {
  return Object.freeze([
    Object.freeze({
      name: CODING_FILE_READ_TOOL_ID,
      description: "Read bounded UTF-8 text inside the isolated coding worktree.",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["contractVersion", "relativePath"]),
        properties: Object.freeze({
          contractVersion: contractVersionProperty(),
          relativePath: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: MAX_SCOPED_NATIVE_RELATIVE_PATH_BYTES,
          }),
          maximumBytes: Object.freeze({
            type: "integer",
            minimum: 1,
            maximum: MAX_ISOLATED_CODING_TEXT_BYTES,
          }),
        }),
      }),
    }),
    Object.freeze({
      name: CODING_FILE_WRITE_TOOL_ID,
      description: "Write bounded UTF-8 text inside the isolated coding worktree after approval.",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["contractVersion", "relativePath", "content"]),
        properties: Object.freeze({
          contractVersion: contractVersionProperty(),
          relativePath: Object.freeze({
            type: "string",
            minLength: 1,
            maxLength: MAX_SCOPED_NATIVE_RELATIVE_PATH_BYTES,
          }),
          content: Object.freeze({ type: "string", maxLength: MAX_ISOLATED_CODING_TEXT_BYTES }),
        }),
      }),
    }),
    Object.freeze({
      name: CODING_TERMINAL_TOOL_ID,
      description: "Run one Actestra-registered command in the isolated worktree after approval.",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["contractVersion", "commandId"]),
        properties: Object.freeze({
          contractVersion: contractVersionProperty(),
          commandId: Object.freeze({ type: "string", enum: Object.freeze([...commandIds]) }),
        }),
      }),
    }),
    Object.freeze({
      name: CODING_GIT_TOOL_ID,
      description: "Inspect fixed Git status or HEAD state without changing the repository.",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["contractVersion", "query"]),
        properties: Object.freeze({
          contractVersion: contractVersionProperty(),
          query: Object.freeze({ type: "string", enum: Object.freeze(["status", "head"]) }),
        }),
      }),
    }),
    Object.freeze({
      name: CODING_DIFF_TOOL_ID,
      description: "Inspect the fixed worktree diff without external diff or text conversion.",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["contractVersion"]),
        properties: Object.freeze({ contractVersion: contractVersionProperty() }),
      }),
    }),
    Object.freeze({
      name: CODING_TEST_TOOL_ID,
      description:
        "Run one Actestra-registered test command in the isolated worktree after approval.",
      inputSchema: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: Object.freeze(["contractVersion", "testId"]),
        properties: Object.freeze({
          contractVersion: contractVersionProperty(),
          testId: Object.freeze({ type: "string", enum: Object.freeze([...testIds]) }),
        }),
      }),
    }),
  ]);
}

export async function startGooseMcpCapabilityServer(
  options: StartGooseMcpCapabilityServerOptions,
): Promise<GooseMcpCapabilityServer> {
  const config = validateOptions(options);
  const tools = toolList(config.commandIds, config.testIds);
  const expectedLeaseDigest = createHash("sha256").update(config.attemptLease, "utf8").digest();
  let phase: ServerPhase = "initialize";
  let expectedHost = "";
  const sockets = new Set<Socket>();
  const toolsListWaiters = new Set<ToolsListWaiter>();
  const toolCallControllers = new Set<AbortController>();
  const toolCallInvocations = new Set<Promise<GooseMcpToolInvocationResult>>();
  const seenToolCallRequestIds = new Set<string>();
  let toolsListed = false;
  let activeSessionId: string | undefined;
  let closed = false;
  let serverBinding: GooseBridgeServerBinding;

  const resolveToolsListWaiters = (): void => {
    toolsListed = true;
    for (const waiter of toolsListWaiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve();
    }
    toolsListWaiters.clear();
  };

  const rejectToolsListWaiters = (error: Error): void => {
    for (const waiter of toolsListWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    toolsListWaiters.clear();
  };

  const server = http.createServer(async (request, response) => {
    if (closed) {
      rejectHttp(request, response, 503);
      return;
    }
    if (request.url !== "/mcp") {
      rejectHttp(request, response, 404);
      return;
    }
    if (request.method !== "POST") {
      rejectHttp(request, response, 405);
      return;
    }
    if (!validateHeaders(request, response, expectedHost, expectedLeaseDigest, phase)) {
      return;
    }
    try {
      const message = await readJson(request);
      if (closed) {
        rejectHttp(request, response, 503);
        return;
      }
      const initializeId = phase === "initialize" ? initializeRequestId(message) : undefined;
      if (initializeId !== undefined) {
        phase = "initialized";
        jsonResponse(response, 200, {
          jsonrpc: "2.0",
          id: initializeId,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        });
        return;
      }

      if (phase === "initialized" && isInitializedNotification(message)) {
        phase = "ready";
        accepted(response);
        return;
      }

      if (phase === "ready" && message.method === "tools/list") {
        const listRequest = toolsListRequest(message);
        if (
          listRequest !== undefined &&
          (activeSessionId === undefined || activeSessionId === listRequest.sessionId)
        ) {
          activeSessionId = listRequest.sessionId;
          jsonResponse(response, 200, {
            jsonrpc: "2.0",
            id: listRequest.requestId,
            result: { tools },
          });
          resolveToolsListWaiters();
        } else {
          jsonResponse(response, 400, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid MCP request" },
          });
        }
        return;
      }

      if (phase === "ready" && message.method === "tools/call") {
        const call = parseToolCallRequest(message, activeSessionId, config.workspaceDirectory);
        if (
          call === undefined ||
          seenToolCallRequestIds.has(call.toolCallRequestId) ||
          seenToolCallRequestIds.size >= MAX_TOOL_CALLS
        ) {
          jsonResponse(response, 400, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid MCP request" },
          });
          return;
        }
        seenToolCallRequestIds.add(call.toolCallRequestId);
        const controller = new AbortController();
        toolCallControllers.add(controller);
        let invocation: Promise<GooseMcpToolInvocationResult>;
        invocation = Promise.resolve()
          .then(() => {
            if (closed || controller.signal.aborted) {
              throw new GooseMcpCapabilityServerError(
                "closed",
                "Goose MCP capability server closed before tool invocation",
              );
            }
            return config.invokeTool(
              Object.freeze({
                sessionId: call.sessionId,
                toolCallRequestId: call.toolCallRequestId,
                toolId: call.toolId,
                input: call.input,
                signal: controller.signal,
              }),
            );
          })
          .finally(() => {
            toolCallControllers.delete(controller);
            toolCallInvocations.delete(invocation);
          });
        toolCallInvocations.add(invocation);
        try {
          const result = normalizeToolResult(await invocation);
          if (result === undefined) {
            throw new Error("Goose MCP tool invoker returned an invalid result");
          }
          const body = {
            jsonrpc: "2.0",
            id: call.requestId,
            result: {
              content: [{ type: "text", text: result.content }],
              isError: result.isError,
            },
          } as const;
          if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_REQUEST_BYTES) {
            throw new Error("Goose MCP tool result exceeds the admitted frame bound");
          }
          jsonResponse(response, 200, body);
        } catch {
          jsonResponse(response, 200, {
            jsonrpc: "2.0",
            id: call.requestId,
            error: { code: -32603, message: "Tool invocation failed" },
          });
        }
        return;
      }

      if (
        phase === "ready" &&
        message.jsonrpc === "2.0" &&
        typeof message.method === "string" &&
        isRequestId(message.id)
      ) {
        jsonResponse(response, 200, {
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
        return;
      }

      jsonResponse(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid MCP request" },
      });
    } catch (error) {
      const requestError = error instanceof RequestBodyError ? error : undefined;
      const status = requestError?.code === "too-large" ? 413 : 400;
      const code = requestError?.code === "invalid-request" ? -32600 : -32700;
      jsonResponse(response, status, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code,
          message:
            requestError?.code === "invalid-request" ? "Invalid MCP request" : "Invalid MCP JSON",
        },
      });
    }
  });
  server.maxHeadersCount = 32;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());

  try {
    const listenerOptions: GooseBridgeListenerOptions | undefined =
      config.socketPath === undefined
        ? undefined
        : Object.freeze({ socketPath: config.socketPath, loopbackPort: config.loopbackPort });
    serverBinding = await listenGooseBridgeServer(server, listenerOptions);
  } catch (error) {
    for (const socket of sockets) {
      socket.destroy();
    }
    throw new GooseMcpCapabilityServerError(
      error instanceof GooseBridgeSocketError && error.code === "invalid-config"
        ? "invalid-config"
        : "listen-failed",
      "Goose MCP capability server could not open its listener",
      { cause: error },
    );
  }
  expectedHost = serverBinding.host;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    url: `http://${serverBinding.host}/mcp`,
    waitForToolsList(timeoutMs = DEFAULT_TOOLS_LIST_WAIT_MS): Promise<void> {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TOOLS_LIST_WAIT_MS) {
        return Promise.reject(
          new GooseMcpCapabilityServerError(
            "invalid-wait-timeout",
            "Goose MCP tools/list wait must use a bounded positive safe integer",
          ),
        );
      }
      if (toolsListed) {
        return Promise.resolve();
      }
      if (closed) {
        return Promise.reject(
          new GooseMcpCapabilityServerError(
            "closed",
            "Goose MCP capability server closed before tools/list was accepted",
          ),
        );
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: ToolsListWaiter = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            toolsListWaiters.delete(waiter);
            reject(
              new GooseMcpCapabilityServerError(
                "tools-list-timeout",
                "Goose MCP capability server did not accept tools/list before the deadline",
              ),
            );
          }, timeoutMs),
        };
        toolsListWaiters.add(waiter);
      });
    },
    close(): Promise<void> {
      closePromise ??= (async () => {
        closed = true;
        rejectToolsListWaiters(
          new GooseMcpCapabilityServerError(
            "closed",
            "Goose MCP capability server closed before tools/list was accepted",
          ),
        );
        const serverClosed = closeGooseBridgeServer(server, sockets, serverBinding);
        for (const controller of toolCallControllers) {
          controller.abort("goose-mcp-capability-server-closing");
        }
        for (const socket of sockets) {
          socket.destroy();
        }
        await Promise.allSettled(toolCallInvocations);
        await serverClosed;
      })();
      return closePromise;
    },
  });
}
