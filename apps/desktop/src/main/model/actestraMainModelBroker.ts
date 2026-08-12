export interface ActestraMainModelUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export type ActestraMainModelJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ActestraMainModelJsonValue[]
  | { readonly [key: string]: ActestraMainModelJsonValue };

export type ActestraMainModelJsonObject = {
  readonly [key: string]: ActestraMainModelJsonValue;
};

export interface ActestraMainModelToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: ActestraMainModelJsonObject;
}

export type ActestraMainModelMessage =
  | Readonly<{
      readonly role: "system";
      readonly content: string;
    }>
  | Readonly<{
      readonly role: "user";
      readonly content: string;
    }>
  | Readonly<{
      readonly role: "assistant";
      readonly content: string;
    }>
  | Readonly<{
      readonly role: "assistant";
      readonly toolCalls: readonly ActestraMainModelToolCall[];
    }>
  | Readonly<{
      readonly role: "tool";
      readonly callId: string;
      readonly content: string;
    }>;

export interface ActestraMainModelTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: ActestraMainModelJsonObject;
}

export type ActestraMainModelCompletion =
  | Readonly<{
      type: "message";
      text: string;
      usage: ActestraMainModelUsage;
    }>
  | Readonly<{
      type: "tool-call";
      callId: string;
      name: string;
      arguments: ActestraMainModelJsonObject;
      usage: ActestraMainModelUsage;
    }>;

export interface ActestraMainModelInvocation {
  readonly sessionId: string;
  readonly purpose: "general-work" | "coding";
  readonly messages: readonly ActestraMainModelMessage[];
  readonly tools: readonly ActestraMainModelTool[];
  readonly responseMode: "text" | "text-or-tool-call";
}

export type ActestraMainModelInvoker = (
  invocation: ActestraMainModelInvocation,
  signal: AbortSignal,
) => Promise<ActestraMainModelCompletion>;

export interface ActestraMainModelBrokerPort {
  readonly modelId: string;
  readonly invokeModel: ActestraMainModelInvoker;
}

function hasExactDataProperties(value: unknown, keys: readonly string[]): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length &&
    ownKeys.every((key) => typeof key === "string" && keys.includes(key)) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, "value");
    })
  );
}

function dataProperty(value: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isActestraMainModelUsage(value: unknown): value is ActestraMainModelUsage {
  if (!hasExactDataProperties(value, ["promptTokens", "completionTokens"])) return false;
  const promptTokens = dataProperty(value, "promptTokens");
  const completionTokens = dataProperty(value, "completionTokens");
  return (
    Number.isSafeInteger(promptTokens) &&
    (promptTokens as number) >= 0 &&
    Number.isSafeInteger(completionTokens) &&
    (completionTokens as number) >= 0 &&
    Number.isSafeInteger((promptTokens as number) + (completionTokens as number))
  );
}

function isActestraMainModelJsonValue(value: unknown): value is ActestraMainModelJsonValue {
  return isBoundedActestraMainModelJsonValue(value);
}

function isActestraMainModelJsonObject(value: unknown): value is ActestraMainModelJsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isActestraMainModelJsonValue(value)
  );
}

export function assertActestraMainModelCompletion(
  value: unknown,
): asserts value is ActestraMainModelCompletion {
  if (!hasExactDataProperties(value, ["type", "text", "usage"])) {
    if (!hasExactDataProperties(value, ["type", "callId", "name", "arguments", "usage"])) {
      throw new Error("Actestra Main model completion is invalid");
    }
    if (
      dataProperty(value, "type") !== "tool-call" ||
      typeof dataProperty(value, "callId") !== "string" ||
      typeof dataProperty(value, "name") !== "string" ||
      !isActestraMainModelJsonObject(dataProperty(value, "arguments")) ||
      !isActestraMainModelUsage(dataProperty(value, "usage"))
    ) {
      throw new Error("Actestra Main model completion is invalid");
    }
    return;
  }
  if (
    dataProperty(value, "type") !== "message" ||
    typeof dataProperty(value, "text") !== "string" ||
    !isActestraMainModelUsage(dataProperty(value, "usage"))
  ) {
    throw new Error("Actestra Main model completion is invalid");
  }
}
import { isBoundedActestraMainModelJsonValue } from "./actestraMainModelJson";
