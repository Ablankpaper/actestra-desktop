import { TextDecoder } from "node:util";
import { CODING_TOOL_IDS } from "../../core";
import type {
  ActestraMainModelCompletion,
  ActestraMainModelInvocation,
  ActestraMainModelJsonObject,
  ActestraMainModelMessage,
  ActestraMainModelTool,
} from "../model/actestraMainModelBroker";

export const GOOSE_AUTHENTICATED_BRIDGE_VERSION = 1 as const;
export const GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES = 2 * 1024 * 1024;

const MAX_PENDING_REQUESTS = 128;
const MAX_MESSAGES = 512;
const MAX_TEXT_BYTES = 256 * 1024;
const MAX_DEPTH = 32;
const BRIDGE_TOOL_IDS = Object.freeze([...CODING_TOOL_IDS] as readonly string[]);
const MODEL_ERROR_CODES = Object.freeze([
  "cancelled",
  "model-completion-refused",
  "model-request-rejected",
  "model-timeout",
  "model-unavailable",
] as const);
const CAPABILITY_ERROR_CODES = Object.freeze([
  "cancelled",
  "capability-request-rejected",
  "capability-timeout",
  "capability-unavailable",
  "tool-execution-failed",
] as const);

export type GooseWindowsModelErrorCode = (typeof MODEL_ERROR_CODES)[number];
export type GooseWindowsCapabilityErrorCode = (typeof CAPABILITY_ERROR_CODES)[number];

export type GooseWindowsModelFrame =
  | Readonly<{
      contractVersion: 1;
      kind: "completion-request";
      requestId: string;
      lease: string;
      sessionId: string;
      invocation: ActestraMainModelInvocation;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "completion-response";
      requestId: string;
      completion: ActestraMainModelCompletion;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "model-error";
      requestId: string;
      code: GooseWindowsModelErrorCode;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "cancel";
      requestId: string;
      lease: string;
    }>;

export type GooseWindowsCapabilityFrame =
  | Readonly<{
      contractVersion: 1;
      kind: "list-request";
      requestId: string;
      lease: string;
      sessionId: string;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "list-response";
      requestId: string;
      tools: readonly ActestraMainModelTool[];
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "call-request";
      requestId: string;
      lease: string;
      sessionId: string;
      toolName: string;
      arguments: ActestraMainModelJsonObject;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "call-response";
      requestId: string;
      isError: boolean;
      content: string;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "cancel";
      requestId: string;
      lease: string;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "capability-error";
      requestId: string;
      code: GooseWindowsCapabilityErrorCode;
    }>;

export interface GooseAuthenticatedBridgeDecodeOptions {
  readonly expectedLease?: string;
  readonly expectedSessionId?: string;
  readonly expectedRequestId?: string;
}

export class GooseAuthenticatedBridgeProtocolError extends Error {
  constructor(message = "Invalid Goose authenticated bridge frame") {
    super(message);
    this.name = "GooseAuthenticatedBridgeProtocolError";
  }
}

/** Tracks request ownership so stale and duplicate replies fail closed. */
export class GooseAuthenticatedBridgeRequestLedger {
  private readonly pending = new Set<string>();
  private readonly completed = new Set<string>();

  begin(requestId: string): void {
    token(requestId, 1, 128);
    if (
      this.pending.size >= MAX_PENDING_REQUESTS ||
      this.pending.has(requestId) ||
      this.completed.has(requestId)
    ) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    this.pending.add(requestId);
  }

  acceptResponse(requestId: string): void {
    token(requestId, 1, 128);
    if (!this.pending.delete(requestId)) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    this.completed.add(requestId);
  }

  cancel(requestId: string): void {
    token(requestId, 1, 128);
    if (!this.pending.delete(requestId)) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    this.completed.add(requestId);
  }
}

export function encodeGooseWindowsModelFrame(frame: GooseWindowsModelFrame): Buffer {
  validateModelFrame(frame);
  return encodeFrame(frame);
}

export function decodeGooseWindowsModelFrame(
  frame: Uint8Array,
  options: GooseAuthenticatedBridgeDecodeOptions = {},
): GooseWindowsModelFrame {
  const value = decodeFrame(frame);
  validateModelFrame(value, options);
  return value;
}

export function encodeGooseWindowsCapabilityFrame(frame: GooseWindowsCapabilityFrame): Buffer {
  validateCapabilityFrame(frame);
  return encodeFrame(frame);
}

export function decodeGooseWindowsCapabilityFrame(
  frame: Uint8Array,
  options: GooseAuthenticatedBridgeDecodeOptions = {},
): GooseWindowsCapabilityFrame {
  const value = decodeFrame(frame);
  validateCapabilityFrame(value, options);
  return value;
}

function encodeFrame(value: object): Buffer {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  const payload = Buffer.from(serialized, "utf8");
  if (payload.byteLength === 0 || payload.byteLength > GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  const frame = Buffer.allocUnsafe(payload.byteLength + 4);
  frame.writeUInt32LE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeFrame(frame: Uint8Array): Record<string, unknown> {
  const bytes = Buffer.from(frame);
  if (bytes.byteLength < 5) throw new GooseAuthenticatedBridgeProtocolError();
  const payloadLength = bytes.readUInt32LE(0);
  if (
    payloadLength === 0 ||
    payloadLength > GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES ||
    bytes.byteLength !== payloadLength + 4
  ) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4));
    scanJson(source);
  } catch {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  assertNoUnpairedSurrogates(value);
  if (!isRecord(value)) throw new GooseAuthenticatedBridgeProtocolError();
  return value;
}

function validateModelFrame(
  value: unknown,
  options: GooseAuthenticatedBridgeDecodeOptions = {},
): asserts value is GooseWindowsModelFrame {
  const object = exactObject(value);
  if (object.contractVersion !== GOOSE_AUTHENTICATED_BRIDGE_VERSION) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  const requestId = token(object.requestId, 1, 128);
  if (options.expectedRequestId !== undefined && options.expectedRequestId !== requestId) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  switch (object.kind) {
    case "completion-request": {
      exactKeys(object, [
        "contractVersion",
        "invocation",
        "kind",
        "lease",
        "requestId",
        "sessionId",
      ]);
      const lease = token(object.lease, 32, 256);
      const sessionId = token(object.sessionId, 1, 256);
      checkScope(lease, sessionId, options);
      assertInvocation(object.invocation, sessionId);
      return;
    }
    case "completion-response":
      exactKeys(object, ["completion", "contractVersion", "kind", "requestId"]);
      assertCompletion(object.completion);
      return;
    case "model-error":
      exactKeys(object, ["code", "contractVersion", "kind", "requestId"]);
      if (!isOneOf(object.code, MODEL_ERROR_CODES))
        throw new GooseAuthenticatedBridgeProtocolError();
      return;
    case "cancel": {
      exactKeys(object, ["contractVersion", "kind", "lease", "requestId"]);
      const lease = token(object.lease, 32, 256);
      if (options.expectedLease !== undefined && options.expectedLease !== lease) {
        throw new GooseAuthenticatedBridgeProtocolError();
      }
      return;
    }
    default:
      throw new GooseAuthenticatedBridgeProtocolError();
  }
}

function validateCapabilityFrame(
  value: unknown,
  options: GooseAuthenticatedBridgeDecodeOptions = {},
): asserts value is GooseWindowsCapabilityFrame {
  const object = exactObject(value);
  if (object.contractVersion !== GOOSE_AUTHENTICATED_BRIDGE_VERSION) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  const requestId = token(object.requestId, 1, 128);
  if (options.expectedRequestId !== undefined && options.expectedRequestId !== requestId) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  switch (object.kind) {
    case "list-request": {
      exactKeys(object, ["contractVersion", "kind", "lease", "requestId", "sessionId"]);
      const lease = token(object.lease, 32, 256);
      const sessionId = token(object.sessionId, 1, 256);
      checkScope(lease, sessionId, options);
      return;
    }
    case "list-response":
      exactKeys(object, ["contractVersion", "kind", "requestId", "tools"]);
      assertTools(object.tools);
      return;
    case "call-request": {
      exactKeys(object, [
        "arguments",
        "contractVersion",
        "kind",
        "lease",
        "requestId",
        "sessionId",
        "toolName",
      ]);
      const lease = token(object.lease, 32, 256);
      const sessionId = token(object.sessionId, 1, 256);
      checkScope(lease, sessionId, options);
      if (!isOneOf(object.toolName, BRIDGE_TOOL_IDS) || !isJsonObject(object.arguments)) {
        throw new GooseAuthenticatedBridgeProtocolError();
      }
      return;
    }
    case "call-response":
      exactKeys(object, ["content", "contractVersion", "isError", "kind", "requestId"]);
      if (typeof object.isError !== "boolean") throw new GooseAuthenticatedBridgeProtocolError();
      boundedText(object.content);
      return;
    case "cancel": {
      exactKeys(object, ["contractVersion", "kind", "lease", "requestId"]);
      const lease = token(object.lease, 32, 256);
      if (options.expectedLease !== undefined && options.expectedLease !== lease) {
        throw new GooseAuthenticatedBridgeProtocolError();
      }
      return;
    }
    case "capability-error":
      exactKeys(object, ["code", "contractVersion", "kind", "requestId"]);
      if (!isOneOf(object.code, CAPABILITY_ERROR_CODES)) {
        throw new GooseAuthenticatedBridgeProtocolError();
      }
      return;
    default:
      throw new GooseAuthenticatedBridgeProtocolError();
  }
}

function assertInvocation(
  value: unknown,
  sessionId: string,
): asserts value is ActestraMainModelInvocation {
  const object = exactObject(value);
  exactKeys(object, ["messages", "purpose", "responseMode", "sessionId", "tools"]);
  if (
    object.purpose !== "coding" ||
    object.responseMode !== "text-or-tool-call" ||
    object.sessionId !== sessionId ||
    !Array.isArray(object.messages) ||
    object.messages.length === 0 ||
    object.messages.length > MAX_MESSAGES ||
    !Array.isArray(object.tools) ||
    object.tools.length !== BRIDGE_TOOL_IDS.length
  ) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  const names = new Set<string>();
  for (const tool of object.tools) {
    assertTool(tool);
    if (!isOneOf(tool.name, BRIDGE_TOOL_IDS) || names.has(tool.name)) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    names.add(tool.name);
  }
  if (names.size !== BRIDGE_TOOL_IDS.length) throw new GooseAuthenticatedBridgeProtocolError();
  for (const message of object.messages) assertMessage(message);
}

function assertMessage(value: unknown): asserts value is ActestraMainModelMessage {
  const object = exactObject(value);
  if (object.role === "system" || object.role === "user" || object.role === "assistant") {
    if (Object.hasOwn(object, "content")) {
      exactKeys(object, ["content", "role"]);
      boundedText(object.content);
      return;
    }
  }
  if (object.role === "assistant") {
    exactKeys(object, ["role", "toolCalls"]);
    if (!Array.isArray(object.toolCalls) || object.toolCalls.length !== 1) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    assertToolCall(object.toolCalls[0]);
    return;
  }
  if (object.role === "tool") {
    exactKeys(object, ["callId", "content", "role"]);
    token(object.callId, 1, 128);
    boundedText(object.content);
    return;
  }
  throw new GooseAuthenticatedBridgeProtocolError();
}

function assertToolCall(
  value: unknown,
): asserts value is ActestraMainModelInvocation["messages"][number] & { toolCalls: never } {
  const object = exactObject(value);
  exactKeys(object, ["arguments", "callId", "name"]);
  token(object.callId, 1, 128);
  token(object.name, 1, 256);
  if (!isJsonObject(object.arguments)) throw new GooseAuthenticatedBridgeProtocolError();
}

function assertCompletion(value: unknown): asserts value is ActestraMainModelCompletion {
  const object = exactObject(value);
  if (object.type === "message") {
    exactKeys(object, ["text", "type", "usage"]);
    boundedText(object.text);
    assertUsage(object.usage);
    return;
  }
  if (object.type === "tool-call") {
    exactKeys(object, ["arguments", "callId", "name", "type", "usage"]);
    token(object.callId, 1, 128);
    if (!isOneOf(object.name, BRIDGE_TOOL_IDS) || !isJsonObject(object.arguments)) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    assertUsage(object.usage);
    return;
  }
  throw new GooseAuthenticatedBridgeProtocolError();
}

function assertUsage(value: unknown): void {
  const object = exactObject(value);
  exactKeys(object, ["completionTokens", "promptTokens"]);
  if (
    !Number.isSafeInteger(object.promptTokens) ||
    !Number.isSafeInteger(object.completionTokens) ||
    (object.promptTokens as number) < 0 ||
    (object.completionTokens as number) < 0 ||
    !Number.isSafeInteger((object.promptTokens as number) + (object.completionTokens as number))
  ) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
}

function assertTools(value: unknown): asserts value is readonly ActestraMainModelTool[] {
  if (!Array.isArray(value) || value.length !== BRIDGE_TOOL_IDS.length) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  const names = new Set<string>();
  for (const tool of value) {
    assertTool(tool);
    if (!isOneOf(tool.name, BRIDGE_TOOL_IDS) || names.has(tool.name)) {
      throw new GooseAuthenticatedBridgeProtocolError();
    }
    names.add(tool.name);
  }
  if (names.size !== BRIDGE_TOOL_IDS.length) throw new GooseAuthenticatedBridgeProtocolError();
}

function assertTool(value: unknown): asserts value is ActestraMainModelTool {
  const object = exactObject(value);
  const keys = Object.hasOwn(object, "description")
    ? ["description", "inputSchema", "name"]
    : ["inputSchema", "name"];
  exactKeys(object, keys);
  token(object.name, 1, 256);
  if (!isJsonObject(object.inputSchema)) throw new GooseAuthenticatedBridgeProtocolError();
  if (Object.hasOwn(object, "description")) boundedText(object.description);
}

function checkScope(
  lease: string,
  sessionId: string,
  options: GooseAuthenticatedBridgeDecodeOptions,
): void {
  if (
    (options.expectedLease !== undefined && options.expectedLease !== lease) ||
    (options.expectedSessionId !== undefined && options.expectedSessionId !== sessionId)
  ) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
}

function exactObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new GooseAuthenticatedBridgeProtocolError();
  return value;
}

function exactKeys(object: Record<string, unknown>, keys: readonly string[]): void {
  const ownKeys = Object.keys(object);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => !keys.includes(key))) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
}

function token(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[A-Za-z0-9._~-]+$/.test(value)
  ) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  return value;
}

function boundedText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES
  ) {
    throw new GooseAuthenticatedBridgeProtocolError();
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is ActestraMainModelJsonObject {
  return isRecord(value) && isBoundedJsonValue(value, 0);
}

function isBoundedJsonValue(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return typeof value !== "number" || Number.isFinite(value);
  }
  if (typeof value === "string")
    return !hasUnpairedSurrogate(value) && Buffer.byteLength(value, "utf8") <= MAX_TEXT_BYTES;
  if (Array.isArray(value)) return value.every((item) => isBoundedJsonValue(item, depth + 1));
  if (isRecord(value))
    return Object.values(value).every((item) => isBoundedJsonValue(item, depth + 1));
  return false;
}

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function scanJson(source: string): void {
  let index = 0;
  const whitespace = (): void => {
    while (
      index < source.length &&
      (source.charCodeAt(index) === 9 ||
        source.charCodeAt(index) === 10 ||
        source.charCodeAt(index) === 13 ||
        source.charCodeAt(index) === 32)
    ) {
      index += 1;
    }
  };
  const string = (): string => {
    const start = index;
    if (source[index] !== '"') throw new GooseAuthenticatedBridgeProtocolError();
    index += 1;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        const value = JSON.parse(source.slice(start, index));
        if (typeof value !== "string" || hasUnpairedSurrogate(value))
          throw new GooseAuthenticatedBridgeProtocolError();
        return value;
      }
      if (code < 0x20) throw new GooseAuthenticatedBridgeProtocolError();
      if (code === 0x5c) {
        index += 1;
        const escape = source[index];
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(index + 1, index + 5)))
            throw new GooseAuthenticatedBridgeProtocolError();
          index += 5;
        } else if (escape !== undefined && '"\\/bfnrt'.includes(escape)) {
          index += 1;
        } else {
          throw new GooseAuthenticatedBridgeProtocolError();
        }
      } else {
        index += 1;
      }
    }
    throw new GooseAuthenticatedBridgeProtocolError();
  };
  const value = (depth: number): void => {
    if (depth > MAX_DEPTH) throw new GooseAuthenticatedBridgeProtocolError();
    whitespace();
    const character = source[index];
    if (character === '"') {
      string();
      return;
    }
    if (character === "{") {
      index += 1;
      whitespace();
      const keys = new Set<string>();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (true) {
        const key = string();
        if (keys.has(key)) throw new GooseAuthenticatedBridgeProtocolError();
        keys.add(key);
        whitespace();
        if (source[index] !== ":") throw new GooseAuthenticatedBridgeProtocolError();
        index += 1;
        value(depth + 1);
        whitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") throw new GooseAuthenticatedBridgeProtocolError();
        index += 1;
        whitespace();
      }
    }
    if (character === "[") {
      index += 1;
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      while (true) {
        value(depth + 1);
        whitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") throw new GooseAuthenticatedBridgeProtocolError();
        index += 1;
        whitespace();
      }
    }
    if (source.startsWith("true", index)) {
      index += 4;
      return;
    }
    if (source.startsWith("false", index)) {
      index += 5;
      return;
    }
    if (source.startsWith("null", index)) {
      index += 4;
      return;
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      source.slice(index),
    );
    if (number !== null) {
      index += number[0].length;
      return;
    }
    throw new GooseAuthenticatedBridgeProtocolError();
  };
  value(0);
  whitespace();
  if (index !== source.length) throw new GooseAuthenticatedBridgeProtocolError();
}

function assertNoUnpairedSurrogates(value: unknown): void {
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) throw new GooseAuthenticatedBridgeProtocolError();
  } else if (Array.isArray(value)) {
    for (const item of value) assertNoUnpairedSurrogates(item);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (hasUnpairedSurrogate(key)) throw new GooseAuthenticatedBridgeProtocolError();
      assertNoUnpairedSurrogates(item);
    }
  }
}
