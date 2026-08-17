import { createHash, timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  assertActestraMainModelCompletion,
  type ActestraMainModelCompletion,
  type ActestraMainModelInvocation,
  type ActestraMainModelInvoker,
  type ActestraMainModelJsonObject,
  type ActestraMainModelMessage,
  type ActestraMainModelTool,
  type ActestraMainModelUsage,
} from "../model/actestraMainModelBroker";
import { snapshotBoundedActestraMainModelJsonValue } from "../model/actestraMainModelJson";
import {
  closeGooseBridgeServer,
  GooseBridgeSocketError,
  listenGooseBridgeServer,
  type GooseBridgeListenerOptions,
  type GooseBridgeServerBinding,
} from "./gooseBridgeSocket";

const MODEL_CATALOG_PATH = "/v1/models";
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const RESPONSES_PATH = "/v1/responses";
const MAX_INFERENCE_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_INFERENCE_MESSAGES = 512;
const MAX_INFERENCE_TOOLS = 128;
const MAX_INFERENCE_TOOL_CALLS = 128;
const MAX_MODEL_TEXT_BYTES = 256 * 1024;
const GOOSE_HISTORICAL_TOOL_NAME_LENGTH = 128;

export type GooseLoopbackModelServerErrorCode = "invalid-config" | "listen-failed";

export class GooseLoopbackModelServerError extends Error {
  constructor(
    readonly code: GooseLoopbackModelServerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GooseLoopbackModelServerError";
  }
}

export interface StartGooseLoopbackModelServerOptions {
  readonly modelId: string;
  readonly attemptLease: string;
  readonly invokeModel: GooseLoopbackModelInvoker;
  readonly socketPath?: string;
  readonly loopbackPort?: number;
}

export type GooseLoopbackModelUsage = ActestraMainModelUsage;
export type GooseLoopbackModelCompletion = ActestraMainModelCompletion;
export type GooseLoopbackModelInvocation = ActestraMainModelInvocation;
export type GooseLoopbackModelInvoker = ActestraMainModelInvoker;

export interface GooseLoopbackModelServer {
  readonly baseUrl: string;
  bindSession(sessionId: string): void;
  /**
   * How many inference turns Main refused, and how many it served. Goose only
   * ever sees a content-free 400, which it treats as a recoverable turn, so
   * these counters are the sole signal that a prompt reached its end without a
   * usable model turn.
   *
   * `refusedInferenceCount` counts only model-side refusals: the broker
   * rejected the completion, or the completion violated the Main-owned
   * contract. A request Goose itself malformed is counted separately as
   * `rejectedRequestCount`, because attributing it to the model would report
   * the wrong cause for an equally failed turn.
   */
  readonly refusedInferenceCount: number;
  readonly rejectedRequestCount: number;
  readonly servedInferenceCount: number;
  close(): Promise<void>;
}

function invalidConfig(message: string): GooseLoopbackModelServerError {
  return new GooseLoopbackModelServerError("invalid-config", message);
}

function ownDataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
    throw invalidConfig(`Goose loopback model server ${key} must be an own data property`);
  }
  return descriptor.value;
}

function validateOptions(options: StartGooseLoopbackModelServerOptions): {
  readonly modelId: string;
  readonly attemptLease: string;
  readonly invokeModel: GooseLoopbackModelInvoker;
  readonly socketPath?: string;
  readonly loopbackPort?: number;
} {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw invalidConfig("Goose loopback model server options must be an object");
  }
  const keys = Reflect.ownKeys(options);
  if (
    keys.length < 3 ||
    keys.length > 5 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !["modelId", "attemptLease", "invokeModel", "socketPath", "loopbackPort"].includes(key),
    )
  ) {
    throw invalidConfig("Goose loopback model server options contain unsupported fields");
  }
  const modelId = ownDataProperty(options, "modelId");
  if (
    typeof modelId !== "string" ||
    modelId.length < 1 ||
    modelId.length > 256 ||
    !/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(modelId)
  ) {
    throw invalidConfig("Goose loopback model identifier is invalid");
  }
  const attemptLease = ownDataProperty(options, "attemptLease");
  if (
    typeof attemptLease !== "string" ||
    attemptLease.length < 32 ||
    attemptLease.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/.test(attemptLease)
  ) {
    throw invalidConfig("Goose loopback model attempt lease is invalid");
  }
  const invokeModel = ownDataProperty(options, "invokeModel");
  if (typeof invokeModel !== "function") {
    throw invalidConfig("Goose loopback model invoker is invalid");
  }
  const socketPath = Object.hasOwn(options, "socketPath")
    ? ownDataProperty(options, "socketPath")
    : undefined;
  const loopbackPort = Object.hasOwn(options, "loopbackPort")
    ? ownDataProperty(options, "loopbackPort")
    : undefined;
  if ((socketPath === undefined) !== (loopbackPort === undefined)) {
    throw invalidConfig("Goose loopback model socket path and loopback port must be paired");
  }
  return Object.freeze({
    modelId,
    attemptLease,
    invokeModel: invokeModel as GooseLoopbackModelInvoker,
    ...(socketPath === undefined
      ? {}
      : {
          socketPath: socketPath as string,
          loopbackPort: loopbackPort as number,
        }),
  });
}

function rawHeaderValues(request: IncomingMessage, name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function authorized(request: IncomingMessage, expectedLeaseDigest: Buffer): boolean {
  const values = rawHeaderValues(request, "authorization");
  if (values.length !== 1 || !values[0]!.startsWith("Bearer ")) {
    return false;
  }
  const candidate = values[0]!.slice("Bearer ".length);
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(candidateDigest, expectedLeaseDigest);
}

function emptyResponse(response: ServerResponse, status: number): void {
  response.writeHead(status, {
    Connection: "close",
    "Content-Length": "0",
    "Cache-Control": "no-store",
  });
  response.end();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === "string" && allowed.has(key)) &&
    required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function validToolName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 512 &&
    /^[A-Za-z0-9._:-]+(?:__[A-Za-z0-9._:-]+)?$/.test(value)
  );
}

function snapshotJsonObject(value: unknown): ActestraMainModelJsonObject {
  if (!isRecord(value)) {
    throw new Error("invalid-json-object");
  }
  return snapshotBoundedActestraMainModelJsonValue(value) as ActestraMainModelJsonObject;
}

function parseToolDefinition(value: unknown): ActestraMainModelTool {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "function"])) {
    throw new Error("invalid-request-tool");
  }
  const definition = value.function;
  if (
    value.type !== "function" ||
    !isRecord(definition) ||
    !hasExactKeys(definition, ["name", "parameters"], ["description"])
  ) {
    throw new Error("invalid-request-tool");
  }
  const name = definition.name;
  const description = definition.description;
  const parameters = definition.parameters;
  if (!validToolName(name)) {
    throw new Error("invalid-request-tool");
  }
  let validatedDescription: string | undefined;
  if (description === undefined) {
    validatedDescription = undefined;
  } else if (typeof description === "string") {
    validatedDescription = description;
  } else {
    throw new Error("invalid-request-tool");
  }
  const inputSchema = snapshotJsonObject(parameters);
  if (validatedDescription === undefined) {
    return Object.freeze({ name, inputSchema });
  }
  return Object.freeze({
    name,
    description: validatedDescription,
    inputSchema,
  });
}

interface DeclaredToolNameIndex {
  readonly canonicalNames: ReadonlySet<string>;
  readonly historicalAliasToCanonical: ReadonlyMap<string, string>;
  readonly ambiguousHistoricalAliases: ReadonlySet<string>;
}

// Compatibility owner: Goose adapter. Remove only when the pinned Goose OpenAI
// formatter stops rewriting historical tool names; the loopback tests pin the rule.
function gooseHistoricalToolNameAlias(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, GOOSE_HISTORICAL_TOOL_NAME_LENGTH);
}

function indexDeclaredToolNames(tools: readonly ActestraMainModelTool[]): DeclaredToolNameIndex {
  const canonicalNames = new Set<string>();
  const historicalAliasToCanonical = new Map<string, string>();
  const ambiguousHistoricalAliases = new Set<string>();
  for (const tool of tools) {
    canonicalNames.add(tool.name);
    const alias = gooseHistoricalToolNameAlias(tool.name);
    if (ambiguousHistoricalAliases.has(alias)) {
      continue;
    }
    const existing = historicalAliasToCanonical.get(alias);
    if (existing === undefined || existing === tool.name) {
      historicalAliasToCanonical.set(alias, tool.name);
      continue;
    }
    historicalAliasToCanonical.delete(alias);
    ambiguousHistoricalAliases.add(alias);
  }
  return Object.freeze({ canonicalNames, historicalAliasToCanonical, ambiguousHistoricalAliases });
}

function resolveHistoricalToolName(
  name: string,
  declaredToolNames: DeclaredToolNameIndex,
): string | undefined {
  if (declaredToolNames.ambiguousHistoricalAliases.has(name)) {
    return undefined;
  }
  if (declaredToolNames.canonicalNames.has(name)) {
    return name;
  }
  return declaredToolNames.historicalAliasToCanonical.get(name);
}

function parseToolCall(
  value: unknown,
  declaredToolNames: DeclaredToolNameIndex,
): Readonly<{ callId: string; name: string; arguments: ActestraMainModelJsonObject }> {
  if (!isRecord(value) || !hasExactKeys(value, ["id", "type", "function"])) {
    throw new Error("invalid-request-tool-call");
  }
  const callable = value.function;
  if (
    !validSessionId(value.id) ||
    value.type !== "function" ||
    !isRecord(callable) ||
    !hasExactKeys(callable, ["name", "arguments"]) ||
    !validToolName(callable.name) ||
    typeof callable.arguments !== "string"
  ) {
    throw new Error("invalid-request-tool-call");
  }
  const canonicalToolName = resolveHistoricalToolName(callable.name, declaredToolNames);
  if (canonicalToolName === undefined) {
    throw new Error("invalid-request-tool-call");
  }
  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(callable.arguments);
  } catch {
    throw new Error("invalid-request-tool-arguments");
  }
  return Object.freeze({
    callId: value.id,
    name: canonicalToolName,
    arguments: snapshotJsonObject(parsedArguments),
  });
}

function parseMessages(
  value: unknown,
  declaredToolNames: DeclaredToolNameIndex,
): readonly ActestraMainModelMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INFERENCE_MESSAGES) {
    throw new Error("invalid-request-messages");
  }
  const pendingToolCalls = new Set<string>();
  const seenToolCalls = new Set<string>();
  const messages: ActestraMainModelMessage[] = [];
  for (const message of value) {
    if (!isRecord(message) || typeof message.role !== "string") {
      throw new Error("invalid-request-message");
    }
    if (message.role === "system" || message.role === "user") {
      if (!hasExactKeys(message, ["role", "content"]) || typeof message.content !== "string") {
        throw new Error("invalid-request-message");
      }
      messages.push(Object.freeze({ role: message.role, content: message.content }));
      continue;
    }
    if (message.role === "assistant") {
      if (hasExactKeys(message, ["role", "content"]) && typeof message.content === "string") {
        messages.push(Object.freeze({ role: "assistant", content: message.content }));
        continue;
      }
      if (
        !hasExactKeys(message, ["role", "content", "tool_calls"]) ||
        (message.content !== null && message.content !== "") ||
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.length < 1 ||
        message.tool_calls.length > MAX_INFERENCE_TOOL_CALLS
      ) {
        throw new Error("invalid-request-message");
      }
      const toolCalls = message.tool_calls.map((toolCall) => {
        const normalized = parseToolCall(toolCall, declaredToolNames);
        if (seenToolCalls.has(normalized.callId)) {
          throw new Error("duplicate-request-tool-call");
        }
        seenToolCalls.add(normalized.callId);
        pendingToolCalls.add(normalized.callId);
        return normalized;
      });
      messages.push(Object.freeze({ role: "assistant", toolCalls: Object.freeze(toolCalls) }));
      continue;
    }
    if (
      message.role !== "tool" ||
      !hasExactKeys(message, ["role", "tool_call_id", "content"]) ||
      !validSessionId(message.tool_call_id) ||
      typeof message.content !== "string" ||
      !pendingToolCalls.delete(message.tool_call_id)
    ) {
      throw new Error("invalid-request-tool-result");
    }
    messages.push(
      Object.freeze({
        role: "tool",
        callId: message.tool_call_id,
        content: message.content,
      }),
    );
  }
  if (pendingToolCalls.size !== 0) {
    throw new Error("missing-request-tool-result");
  }
  return Object.freeze(messages);
}

function parseTools(value: unknown): readonly ActestraMainModelTool[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_INFERENCE_TOOLS) {
    throw new Error("invalid-request-tools");
  }
  const tools = value.map(parseToolDefinition);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new Error("duplicate-request-tool");
  }
  return Object.freeze(tools);
}

function parseResponsesToolDefinition(value: unknown): ActestraMainModelTool {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["type", "name", "parameters", "strict"], ["description"]) ||
    value.type !== "function" ||
    value.strict !== false ||
    !validToolName(value.name)
  ) {
    throw new Error("invalid-responses-tool");
  }
  const description = value.description;
  if (description !== undefined && description !== null && typeof description !== "string") {
    throw new Error("invalid-responses-tool");
  }
  const inputSchema = snapshotJsonObject(value.parameters);
  return Object.freeze({
    name: value.name,
    ...(typeof description === "string" ? { description } : {}),
    inputSchema,
  });
}

function parseResponsesTools(value: unknown): readonly ActestraMainModelTool[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_INFERENCE_TOOLS) {
    throw new Error("invalid-responses-tools");
  }
  const tools = value.map(parseResponsesToolDefinition);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new Error("duplicate-responses-tool");
  }
  return Object.freeze(tools);
}

function parseResponsesTextMessage(value: Record<string, unknown>): ActestraMainModelMessage {
  if (!hasExactKeys(value, ["role", "content"]) || !Array.isArray(value.content)) {
    throw new Error("invalid-responses-message");
  }
  const role = value.role;
  const expectedContentType = role === "assistant" ? "output_text" : "input_text";
  if (
    (role !== "system" && role !== "user" && role !== "assistant") ||
    value.content.length < 1 ||
    value.content.length > MAX_INFERENCE_MESSAGES
  ) {
    throw new Error("invalid-responses-message");
  }
  const parts = value.content.map((part) => {
    if (
      !isRecord(part) ||
      !hasExactKeys(part, ["type", "text"]) ||
      part.type !== expectedContentType ||
      typeof part.text !== "string" ||
      Buffer.byteLength(part.text, "utf8") > MAX_MODEL_TEXT_BYTES
    ) {
      throw new Error("invalid-responses-message");
    }
    return part.text;
  });
  const content = parts.join("\n");
  if (Buffer.byteLength(content, "utf8") > MAX_MODEL_TEXT_BYTES) {
    throw new Error("invalid-responses-message");
  }
  if (role === "assistant") {
    return Object.freeze({ role: "assistant", content });
  }
  return Object.freeze({ role, content });
}

function parseResponsesInput(
  value: unknown,
  declaredToolNames: DeclaredToolNameIndex,
): readonly ActestraMainModelMessage[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_INFERENCE_MESSAGES) {
    throw new Error("invalid-responses-input");
  }
  const messages: ActestraMainModelMessage[] = [];
  const pendingToolCalls = new Set<string>();
  const seenToolCalls = new Set<string>();
  let bufferedToolCalls: Array<
    Readonly<{ callId: string; name: string; arguments: ActestraMainModelJsonObject }>
  > = [];
  const flushToolCalls = (): void => {
    if (bufferedToolCalls.length === 0) return;
    messages.push(
      Object.freeze({ role: "assistant", toolCalls: Object.freeze(bufferedToolCalls) }),
    );
    bufferedToolCalls = [];
  };

  for (const item of value) {
    if (!isRecord(item)) {
      throw new Error("invalid-responses-input-item");
    }
    if (Object.prototype.hasOwnProperty.call(item, "role")) {
      flushToolCalls();
      if (pendingToolCalls.size !== 0) {
        throw new Error("missing-responses-tool-result");
      }
      messages.push(parseResponsesTextMessage(item));
      continue;
    }
    if (item.type === "function_call") {
      if (
        !hasExactKeys(item, ["type", "call_id", "name", "arguments"]) ||
        !validSessionId(item.call_id) ||
        !validToolName(item.name) ||
        typeof item.arguments !== "string" ||
        seenToolCalls.has(item.call_id)
      ) {
        throw new Error("invalid-responses-tool-call");
      }
      const canonicalToolName = resolveHistoricalToolName(item.name, declaredToolNames);
      if (canonicalToolName === undefined) {
        throw new Error("invalid-responses-tool-call");
      }
      let parsedArguments: unknown;
      try {
        parsedArguments = JSON.parse(item.arguments);
      } catch {
        throw new Error("invalid-responses-tool-arguments");
      }
      const toolCall = Object.freeze({
        callId: item.call_id,
        name: canonicalToolName,
        arguments: snapshotJsonObject(parsedArguments),
      });
      seenToolCalls.add(toolCall.callId);
      pendingToolCalls.add(toolCall.callId);
      bufferedToolCalls.push(toolCall);
      if (bufferedToolCalls.length > MAX_INFERENCE_TOOL_CALLS) {
        throw new Error("invalid-responses-tool-call");
      }
      continue;
    }
    flushToolCalls();
    if (
      item.type !== "function_call_output" ||
      !hasExactKeys(item, ["type", "call_id", "output"]) ||
      !validSessionId(item.call_id) ||
      typeof item.output !== "string" ||
      Buffer.byteLength(item.output, "utf8") > MAX_MODEL_TEXT_BYTES ||
      !pendingToolCalls.delete(item.call_id)
    ) {
      throw new Error("invalid-responses-tool-result");
    }
    messages.push(Object.freeze({ role: "tool", callId: item.call_id, content: item.output }));
  }
  flushToolCalls();
  if (pendingToolCalls.size !== 0) {
    throw new Error("missing-responses-tool-result");
  }
  return Object.freeze(messages);
}

function validResponsesReasoning(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasExactKeys(value, [], ["effort", "summary", "mode"])) {
    return false;
  }
  const effort = value.effort;
  const summary = value.summary;
  const mode = value.mode;
  return (
    Reflect.ownKeys(value).length > 0 &&
    (effort === undefined ||
      (typeof effort === "string" &&
        ["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort))) &&
    (summary === undefined || summary === "auto") &&
    (mode === undefined || mode === "standard" || mode === "pro")
  );
}

async function readResponsesInferenceRequest(
  request: IncomingMessage,
  modelId: string,
): Promise<
  Readonly<{
    messages: readonly ActestraMainModelMessage[];
    tools: readonly ActestraMainModelTool[];
  }>
> {
  const lengths = rawHeaderValues(request, "content-length");
  const length = lengths.length === 1 && /^[0-9]+$/.test(lengths[0]!) ? Number(lengths[0]) : 0;
  if (
    length < 2 ||
    length > MAX_INFERENCE_REQUEST_BYTES ||
    !Number.isSafeInteger(length) ||
    rawHeaderValues(request, "content-type").length !== 1 ||
    rawHeaderValues(request, "content-type")[0] !== "application/json" ||
    rawHeaderValues(request, "content-encoding").length !== 0
  ) {
    throw new Error("invalid-responses-envelope");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    received += buffer.byteLength;
    if (received > length || received > MAX_INFERENCE_REQUEST_BYTES) {
      throw new Error("invalid-responses-size");
    }
    chunks.push(buffer);
  }
  if (received !== length) {
    throw new Error("invalid-responses-size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
  } catch {
    throw new Error("invalid-responses-json");
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(
      parsed,
      ["model", "input", "store", "stream"],
      ["tools", "reasoning", "max_output_tokens", "temperature"],
    ) ||
    parsed.model !== modelId ||
    parsed.store !== false ||
    parsed.stream !== true ||
    !validResponsesReasoning(parsed.reasoning) ||
    (parsed.max_output_tokens !== undefined &&
      (!Number.isSafeInteger(parsed.max_output_tokens) ||
        (parsed.max_output_tokens as number) < 1 ||
        (parsed.max_output_tokens as number) > 2_147_483_647)) ||
    (parsed.temperature !== undefined &&
      (typeof parsed.temperature !== "number" ||
        !Number.isFinite(parsed.temperature) ||
        parsed.temperature < 0 ||
        parsed.temperature > 2))
  ) {
    throw new Error("invalid-responses-body");
  }
  const tools = parseResponsesTools(parsed.tools);
  const declaredToolNames = indexDeclaredToolNames(tools);
  if (declaredToolNames.ambiguousHistoricalAliases.size !== 0) {
    throw new Error("ambiguous-responses-tool-alias");
  }
  const messages = parseResponsesInput(parsed.input, declaredToolNames);
  return Object.freeze({ messages, tools });
}

async function readInferenceRequest(
  request: IncomingMessage,
  modelId: string,
): Promise<
  Readonly<{
    messages: readonly ActestraMainModelMessage[];
    tools: readonly ActestraMainModelTool[];
  }>
> {
  const lengths = rawHeaderValues(request, "content-length");
  const length = lengths.length === 1 && /^[0-9]+$/.test(lengths[0]!) ? Number(lengths[0]) : 0;
  if (
    length < 2 ||
    length > MAX_INFERENCE_REQUEST_BYTES ||
    !Number.isSafeInteger(length) ||
    rawHeaderValues(request, "content-type").length !== 1 ||
    rawHeaderValues(request, "content-type")[0] !== "application/json" ||
    rawHeaderValues(request, "content-encoding").length !== 0
  ) {
    throw new Error("invalid-request-envelope");
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    received += buffer.byteLength;
    if (received > length || received > MAX_INFERENCE_REQUEST_BYTES) {
      throw new Error("invalid-request-size");
    }
    chunks.push(buffer);
  }
  if (received !== length) {
    throw new Error("invalid-request-size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, received).toString("utf8"));
  } catch {
    throw new Error("invalid-request-json");
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(
      parsed,
      ["model", "messages", "stream"],
      ["tools", "tool_choice", "parallel_tool_calls", "stream_options"],
    ) ||
    parsed.model !== modelId ||
    parsed.stream !== true ||
    (parsed.tool_choice !== undefined && parsed.tool_choice !== "auto") ||
    (parsed.parallel_tool_calls !== undefined && typeof parsed.parallel_tool_calls !== "boolean") ||
    (parsed.stream_options !== undefined &&
      (!isRecord(parsed.stream_options) ||
        !hasExactKeys(parsed.stream_options, ["include_usage"]) ||
        parsed.stream_options.include_usage !== true))
  ) {
    throw new Error("invalid-request-body");
  }
  const tools = parseTools(parsed.tools);
  const declaredToolNames = indexDeclaredToolNames(tools);
  if (declaredToolNames.ambiguousHistoricalAliases.size !== 0) {
    throw new Error("ambiguous-request-tool-alias");
  }
  const messages = parseMessages(parsed.messages, declaredToolNames);
  return Object.freeze({ messages, tools });
}

function serializeMessageCompletion(
  completionId: string,
  modelId: string,
  completion: Extract<GooseLoopbackModelCompletion, { readonly type: "message" }>,
): Buffer {
  if (
    typeof completion.text !== "string" ||
    Buffer.byteLength(completion.text, "utf8") > MAX_MODEL_TEXT_BYTES
  ) {
    throw new Error("invalid-model-message");
  }
  const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
  const common = {
    id: completionId,
    object: "chat.completion.chunk",
    created: 0,
    model: modelId,
  };
  return Buffer.from(
    [
      frame({
        ...common,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      }),
      frame({
        ...common,
        choices: [{ index: 0, delta: { content: completion.text }, finish_reason: null }],
      }),
      frame({
        ...common,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
      frame({
        ...common,
        choices: [],
        usage: {
          prompt_tokens: completion.usage.promptTokens,
          completion_tokens: completion.usage.completionTokens,
          total_tokens: completion.usage.promptTokens + completion.usage.completionTokens,
        },
      }),
      "data: [DONE]\n\n",
    ].join(""),
    "utf8",
  );
}

function serializeToolCallCompletion(
  completionId: string,
  modelId: string,
  completion: Extract<GooseLoopbackModelCompletion, { readonly type: "tool-call" }>,
): Buffer {
  if (
    !validSessionId(completion.callId) ||
    !validToolName(completion.name) ||
    !isRecord(completion.arguments)
  ) {
    throw new Error("invalid-model-tool-call");
  }
  let serializedArguments: string;
  try {
    serializedArguments = JSON.stringify(snapshotJsonObject(completion.arguments));
  } catch {
    throw new Error("invalid-model-tool-arguments");
  }
  if (
    typeof serializedArguments !== "string" ||
    Buffer.byteLength(serializedArguments, "utf8") > MAX_MODEL_TEXT_BYTES
  ) {
    throw new Error("invalid-model-tool-arguments");
  }
  const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
  const common = {
    id: completionId,
    object: "chat.completion.chunk",
    created: 0,
    model: modelId,
  };
  return Buffer.from(
    [
      frame({
        ...common,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  index: 0,
                  id: completion.callId,
                  type: "function",
                  function: { name: completion.name, arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
      frame({
        ...common,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: serializedArguments } }],
            },
            finish_reason: null,
          },
        ],
      }),
      frame({
        ...common,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }),
      frame({
        ...common,
        choices: [],
        usage: {
          prompt_tokens: completion.usage.promptTokens,
          completion_tokens: completion.usage.completionTokens,
          total_tokens: completion.usage.promptTokens + completion.usage.completionTokens,
        },
      }),
      "data: [DONE]\n\n",
    ].join(""),
    "utf8",
  );
}

function responsesUsage(
  completion: GooseLoopbackModelCompletion,
): Readonly<Record<string, unknown>> {
  const totalTokens = completion.usage.promptTokens + completion.usage.completionTokens;
  if (
    completion.usage.promptTokens > 2_147_483_647 ||
    completion.usage.completionTokens > 2_147_483_647 ||
    totalTokens > 2_147_483_647
  ) {
    throw new Error("invalid-responses-model-usage");
  }
  return Object.freeze({
    input_tokens: completion.usage.promptTokens,
    output_tokens: completion.usage.completionTokens,
    total_tokens: totalTokens,
    input_tokens_details: Object.freeze({ cached_tokens: 0 }),
  });
}

function serializeResponsesCompletion(
  completionId: string,
  modelId: string,
  completion: GooseLoopbackModelCompletion,
): Buffer {
  let outputItem: Readonly<Record<string, unknown>>;
  let deltaEvent: Readonly<Record<string, unknown>> | undefined;
  if (completion.type === "message") {
    if (
      typeof completion.text !== "string" ||
      Buffer.byteLength(completion.text, "utf8") > MAX_MODEL_TEXT_BYTES
    ) {
      throw new Error("invalid-responses-model-message");
    }
    const itemId = `msg-${completionId}`;
    outputItem = Object.freeze({
      type: "message",
      id: itemId,
      status: "completed",
      role: "assistant",
      content: Object.freeze([
        Object.freeze({
          type: "output_text",
          text: completion.text,
          annotations: Object.freeze([]),
          logprobs: Object.freeze([]),
        }),
      ]),
    });
    deltaEvent = Object.freeze({
      type: "response.output_text.delta",
      sequence_number: 1,
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: completion.text,
      logprobs: Object.freeze([]),
    });
  } else {
    if (
      !validSessionId(completion.callId) ||
      !validToolName(completion.name) ||
      !isRecord(completion.arguments)
    ) {
      throw new Error("invalid-responses-model-tool-call");
    }
    let serializedArguments: string;
    try {
      serializedArguments = JSON.stringify(snapshotJsonObject(completion.arguments));
    } catch {
      throw new Error("invalid-responses-model-tool-arguments");
    }
    if (Buffer.byteLength(serializedArguments, "utf8") > MAX_MODEL_TEXT_BYTES) {
      throw new Error("invalid-responses-model-tool-arguments");
    }
    outputItem = Object.freeze({
      type: "function_call",
      id: `fc-${completionId}`,
      status: "completed",
      call_id: completion.callId,
      name: completion.name,
      arguments: serializedArguments,
    });
  }
  const usage = responsesUsage(completion);
  const createdResponse = Object.freeze({
    id: completionId,
    object: "response",
    created_at: 0,
    status: "in_progress",
    model: modelId,
    output: Object.freeze([]),
  });
  const completedResponse = Object.freeze({
    id: completionId,
    object: "response",
    created_at: 0,
    status: "completed",
    model: modelId,
    output: Object.freeze([outputItem]),
    usage,
  });
  const frame = (value: unknown): string => `data: ${JSON.stringify(value)}\n\n`;
  return Buffer.from(
    [
      frame({ type: "response.created", sequence_number: 0, response: createdResponse }),
      ...(deltaEvent === undefined ? [] : [frame(deltaEvent)]),
      frame({
        type: "response.output_item.done",
        sequence_number: deltaEvent === undefined ? 1 : 2,
        output_index: 0,
        item: outputItem,
      }),
      frame({
        type: "response.completed",
        sequence_number: deltaEvent === undefined ? 2 : 3,
        response: completedResponse,
      }),
      "data: [DONE]\n\n",
    ].join(""),
    "utf8",
  );
}

export async function startGooseLoopbackModelServer(
  options: StartGooseLoopbackModelServerOptions,
): Promise<GooseLoopbackModelServer> {
  const config = validateOptions(options);
  const expectedLeaseDigest = createHash("sha256").update(config.attemptLease, "utf8").digest();
  const catalogBody = Buffer.from(
    JSON.stringify({
      object: "list",
      data: [{ id: config.modelId, object: "model", created: 0, owned_by: "actestra" }],
    }),
    "utf8",
  );
  const sockets = new Set<Socket>();
  const activeInvocationControllers = new Set<AbortController>();
  const activeInvocations = new Set<Promise<void>>();
  let expectedHost = "";
  let boundSessionId: string | undefined;
  let completionSequence = 0;
  let refusedInferenceCount = 0;
  let rejectedRequestCount = 0;
  let servedInferenceCount = 0;
  let closed = false;
  let serverBinding: GooseBridgeServerBinding;

  const server = http.createServer((request, response) => {
    if (closed) {
      emptyResponse(response, 503);
      return;
    }
    if (request.url === CHAT_COMPLETIONS_PATH || request.url === RESPONSES_PATH) {
      const isResponsesRequest = request.url === RESPONSES_PATH;
      if (request.method !== "POST") {
        emptyResponse(response, 405);
        return;
      }
      const hosts = rawHeaderValues(request, "host");
      if (
        hosts.length !== 1 ||
        hosts[0] !== expectedHost ||
        rawHeaderValues(request, "origin").length !== 0 ||
        rawHeaderValues(request, "transfer-encoding").length !== 0 ||
        !authorized(request, expectedLeaseDigest)
      ) {
        emptyResponse(response, 401);
        return;
      }
      if (boundSessionId === undefined) {
        emptyResponse(response, 409);
        return;
      }
      const sessionIds = rawHeaderValues(request, "agent-session-id");
      if (sessionIds.length !== 1 || sessionIds[0] !== boundSessionId) {
        emptyResponse(response, 401);
        return;
      }
      const controller = new AbortController();
      activeInvocationControllers.add(controller);
      const invocation = (async () => {
        let readRequest = true;
        try {
          const inferenceRequest = isResponsesRequest
            ? await readResponsesInferenceRequest(request, config.modelId)
            : await readInferenceRequest(request, config.modelId);
          readRequest = false;
          if (closed || controller.signal.aborted) {
            return;
          }
          const completion = await config.invokeModel(
            Object.freeze({
              sessionId: boundSessionId,
              purpose: "coding",
              messages: inferenceRequest.messages,
              tools: inferenceRequest.tools,
              responseMode: "text-or-tool-call",
            }),
            controller.signal,
          );
          assertActestraMainModelCompletion(completion);
          if (
            completion.type === "tool-call" &&
            !inferenceRequest.tools.some((tool) => tool.name === completion.name)
          ) {
            throw new Error("undeclared-model-tool-call");
          }
          if (controller.signal.aborted || response.destroyed) {
            return;
          }
          completionSequence += 1;
          const completionId = `${isResponsesRequest ? "resp" : "chatcmpl"}-actestra-${String(completionSequence)}`;
          const body = isResponsesRequest
            ? serializeResponsesCompletion(completionId, config.modelId, completion)
            : completion.type === "message"
              ? serializeMessageCompletion(completionId, config.modelId, completion)
              : serializeToolCallCompletion(completionId, config.modelId, completion);
          response.writeHead(200, {
            Connection: "close",
            "Content-Type": "text/event-stream; charset=utf-8",
            "Content-Length": String(body.byteLength),
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(body);
          servedInferenceCount += 1;
        } catch {
          // The 400 stays content-free: no reason, prompt, or credential may
          // cross into the Worker. The refusal is recorded on the Main side
          // instead, so a prompt that never produced a model turn cannot be
          // mistaken for a successful read-only attempt.
          //
          // Which counter moves decides the incident code the durable record
          // will carry, so a request Goose malformed must not be attributed to
          // a model refusal.
          if (!controller.signal.aborted && !response.headersSent && !response.destroyed) {
            if (readRequest) {
              rejectedRequestCount += 1;
            } else {
              refusedInferenceCount += 1;
            }
            emptyResponse(response, 400);
          }
        } finally {
          activeInvocationControllers.delete(controller);
        }
      })();
      activeInvocations.add(invocation);
      void invocation.then(
        () => activeInvocations.delete(invocation),
        () => activeInvocations.delete(invocation),
      );
      return;
    }
    if (request.url !== MODEL_CATALOG_PATH) {
      emptyResponse(response, 404);
      return;
    }
    if (request.method !== "GET") {
      emptyResponse(response, 405);
      return;
    }
    const hosts = rawHeaderValues(request, "host");
    if (
      hosts.length !== 1 ||
      hosts[0] !== expectedHost ||
      rawHeaderValues(request, "origin").length !== 0 ||
      rawHeaderValues(request, "transfer-encoding").length !== 0 ||
      !authorized(request, expectedLeaseDigest)
    ) {
      emptyResponse(response, 401);
      return;
    }
    response.writeHead(200, {
      Connection: "close",
      "Content-Type": "application/json",
      "Content-Length": String(catalogBody.byteLength),
      "Cache-Control": "no-store",
    });
    response.end(catalogBody);
  });
  server.maxHeadersCount = 24;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

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
    throw new GooseLoopbackModelServerError(
      error instanceof GooseBridgeSocketError && error.code === "invalid-config"
        ? "invalid-config"
        : "listen-failed",
      "Goose loopback model server could not listen on the admitted host",
      { cause: error },
    );
  }
  expectedHost = serverBinding.host;
  const baseUrl = `http://${serverBinding.host}/v1`;
  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    baseUrl,
    bindSession(sessionId: string): void {
      if (closed || !validSessionId(sessionId) || boundSessionId !== undefined) {
        throw invalidConfig("Goose loopback model server session binding is invalid");
      }
      boundSessionId = sessionId;
    },
    get refusedInferenceCount(): number {
      return refusedInferenceCount;
    },
    get rejectedRequestCount(): number {
      return rejectedRequestCount;
    },
    get servedInferenceCount(): number {
      return servedInferenceCount;
    },
    close(): Promise<void> {
      closePromise ??= (async () => {
        closed = true;
        const serverClosed = closeGooseBridgeServer(server, sockets, serverBinding);
        for (const controller of activeInvocationControllers) {
          controller.abort();
        }
        await Promise.allSettled(activeInvocations);
        await serverClosed;
      })();
      return closePromise;
    },
  });
}
