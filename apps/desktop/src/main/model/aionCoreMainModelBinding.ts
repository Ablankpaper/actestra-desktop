import {
  assertActestraMainModelCompletion,
  type ActestraMainModelBrokerPort,
  type ActestraMainModelInvocation,
  type ActestraMainModelJsonObject,
  type ActestraMainModelMessage,
  type ActestraMainModelTool,
} from "./actestraMainModelBroker";
import {
  isBoundedActestraMainModelJsonValue,
  snapshotBoundedActestraMainModelJsonValue,
} from "./actestraMainModelJson";

const MODEL_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u;
const OPENAI_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAX_PROVIDER_COUNT = 64;
const MAX_PROVIDER_MODELS = 256;
const MAX_DIAGNOSTIC_KEYS = 48;
const MAX_DIAGNOSTIC_MESSAGES = 8;
const MAX_DIAGNOSTIC_TOOLS = 16;
const DIAGNOSTIC_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u;
const MAX_STREAM_CHUNKS = 8192;
const MAX_STREAM_TEXT_LENGTH = 256 * 1024;
const MAX_STREAM_TOOL_CALLS = 8;
const REQUIRED_TEAM_MODEL_CAPABILITIES = Object.freeze(["text", "function_calling"] as const);

/** The provider DTO is confined to this Main-owned AionCore adapter. */
export interface AionCoreProviderModelSnapshot {
  readonly id: string;
  readonly platform: string;
  readonly name: string;
  readonly base_url: string;
  readonly api_key: string;
  readonly models: readonly string[];
  readonly use_model: string;
  readonly model_protocols?: Readonly<Record<string, string>>;
  readonly model_settings?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly is_full_url?: boolean;
}

export interface AionCoreMainModelClient {
  createChatCompletion(
    request: unknown,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown>;
}

export interface AionCoreMainModelSelection {
  readonly providerId: string;
  readonly modelId: string;
}

export interface AionCoreTeamModelProviderOption {
  readonly providerId: string;
  readonly name: string;
  readonly modelIds: readonly string[];
}

export interface AionCoreMainModelBindingDependencies {
  /** Must come from an existing Main-owned record of explicit user intent. */
  readonly selection: AionCoreMainModelSelection | null;
  readonly listProviders: () => Promise<unknown>;
  readonly createClient: (
    provider: AionCoreProviderModelSnapshot,
  ) => Promise<AionCoreMainModelClient>;
}

function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    ? (value as Record<string, unknown>)
    : null;
}

function stableText(value: unknown, maximumLength: number): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value &&
    // eslint-disable-next-line no-control-regex -- rejecting control characters is this guard's purpose.
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : null;
}

function stableModel(value: unknown): string | null {
  const text = stableText(value, 256);
  return text !== null && MODEL_ID_PATTERN.test(text) ? text : null;
}

function snapshotSelection(value: unknown): Readonly<AionCoreMainModelSelection> | null {
  const selection = record(value);
  if (
    selection === null ||
    Reflect.ownKeys(selection).length !== 2 ||
    Reflect.ownKeys(selection).some(
      (key) => typeof key !== "string" || !["providerId", "modelId"].includes(key),
    )
  ) {
    return null;
  }
  const providerId = stableModel(own(selection, "providerId"));
  const modelId = stableModel(own(selection, "modelId"));
  return providerId === null || modelId === null ? null : Object.freeze({ providerId, modelId });
}

function enabledModel(value: unknown, modelId: string): boolean {
  const settings = record(value);
  const modelEnabled = settings === null ? undefined : own(settings, modelId);
  return modelEnabled !== false;
}

function healthyModel(value: unknown, modelId: string): boolean {
  const health = record(value);
  const status = health === null ? undefined : own(record(own(health, modelId)) ?? {}, "status");
  return status === "healthy";
}

function hasRequiredTeamModelCapabilities(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return REQUIRED_TEAM_MODEL_CAPABILITIES.every((requiredType) =>
    value.some((candidate) => {
      const capability = record(candidate);
      if (capability === null || own(capability, "type") !== requiredType) return false;
      const isUserSelected = own(capability, "isUserSelected");
      return isUserSelected === undefined || isUserSelected === true;
    }),
  );
}

function admittedCatalogModels(provider: Record<string, unknown>): readonly string[] {
  const models = own(provider, "models");
  const modelSettings = record(own(provider, "model_settings"));
  if (
    !hasRequiredTeamModelCapabilities(own(provider, "capabilities")) ||
    !Array.isArray(models) ||
    models.length === 0 ||
    models.length > MAX_PROVIDER_MODELS
  ) {
    return Object.freeze([]);
  }
  const admitted = models.filter((candidate, index): candidate is string => {
    const modelId = stableModel(candidate);
    if (
      modelId === null ||
      models.indexOf(candidate) !== index ||
      !enabledModel(own(provider, "model_enabled"), modelId) ||
      !healthyModel(own(provider, "model_health"), modelId)
    ) {
      return false;
    }
    const perModelSettings = modelSettings === null ? null : record(own(modelSettings, modelId));
    return own(perModelSettings ?? {}, "openai_api_mode") !== "responses";
  });
  return Object.freeze(admitted);
}

/**
 * Projects only the finite provider/model identifiers needed by the Team picker.
 * Provider endpoints, credentials, protocol settings, and health DTOs never cross
 * this Main-owned boundary.
 */
export function projectAionCoreTeamModelCatalog(
  value: unknown,
): readonly AionCoreTeamModelProviderOption[] {
  if (!Array.isArray(value) || value.length > MAX_PROVIDER_COUNT) return Object.freeze([]);
  const seenProviderIds = new Set<string>();
  const catalog: AionCoreTeamModelProviderOption[] = [];
  for (const candidate of value) {
    const provider = record(candidate);
    if (provider === null || own(provider, "enabled") === false) continue;
    const providerId = stableModel(own(provider, "id"));
    const name = stableText(own(provider, "name"), 256);
    const modelIds = admittedCatalogModels(provider);
    if (
      providerId === null ||
      name === null ||
      modelIds.length === 0 ||
      seenProviderIds.has(providerId)
    ) {
      continue;
    }
    seenProviderIds.add(providerId);
    catalog.push(Object.freeze({ providerId, name, modelIds }));
  }
  return Object.freeze(catalog);
}

function admittedProviderModel(
  value: unknown,
  selection: AionCoreMainModelSelection,
): AionCoreProviderModelSnapshot | null {
  const provider = record(value);
  if (
    provider === null ||
    own(provider, "enabled") === false ||
    !hasRequiredTeamModelCapabilities(own(provider, "capabilities"))
  ) {
    return null;
  }
  const id = stableModel(own(provider, "id"));
  const platform = stableText(own(provider, "platform"), 128);
  const name = stableText(own(provider, "name"), 256);
  const baseUrl = stableText(own(provider, "base_url"), 2048);
  const apiKey = stableText(own(provider, "api_key"), 128 * 1024);
  const models = own(provider, "models");
  if (
    id === null ||
    id !== selection.providerId ||
    platform === null ||
    name === null ||
    baseUrl === null ||
    apiKey === null ||
    !Array.isArray(models) ||
    models.length === 0 ||
    models.length > MAX_PROVIDER_MODELS
  ) {
    return null;
  }

  const matchingModels = models.filter((candidate) => candidate === selection.modelId);
  if (
    matchingModels.length !== 1 ||
    !enabledModel(own(provider, "model_enabled"), selection.modelId) ||
    !healthyModel(own(provider, "model_health"), selection.modelId)
  ) {
    return null;
  }

  const modelSettings = record(own(provider, "model_settings"));
  const modelProtocols = record(own(provider, "model_protocols"));
  const isFullUrl = own(provider, "is_full_url");
  const perModelSettings =
    modelSettings === null ? undefined : record(own(modelSettings, selection.modelId));
  if (own(perModelSettings ?? {}, "openai_api_mode") === "responses") return null;
  return Object.freeze({
    id,
    platform,
    name,
    base_url: baseUrl,
    api_key: apiKey,
    models: Object.freeze([selection.modelId]),
    use_model: selection.modelId,
    ...(modelProtocols === null
      ? {}
      : { model_protocols: modelProtocols as Readonly<Record<string, string>> }),
    ...(modelSettings === null
      ? {}
      : {
          model_settings: modelSettings as Readonly<
            Record<string, Readonly<Record<string, string>>>
          >,
        }),
    ...(typeof isFullUrl === "boolean" ? { is_full_url: isFullUrl } : {}),
  });
}

interface OpenAiToolNameIndex {
  readonly aliasByCanonicalName: ReadonlyMap<string, string>;
  readonly canonicalNameByAlias: ReadonlyMap<string, string>;
}

function indexOpenAiToolNames(tools: readonly ActestraMainModelTool[]): OpenAiToolNameIndex {
  const aliasByCanonicalName = new Map<string, string>();
  const canonicalNameByAlias = new Map<string, string>();
  for (const tool of tools) {
    const canonicalName = stableText(tool.name, 512);
    if (canonicalName === null || aliasByCanonicalName.has(canonicalName)) {
      throw new Error("AionCore model tool aliases are ambiguous");
    }
    const alias = canonicalName.replace(/[^A-Za-z0-9_-]/gu, "_");
    if (!OPENAI_TOOL_NAME_PATTERN.test(alias)) {
      throw new Error("AionCore model tool name is incompatible");
    }
    const existing = canonicalNameByAlias.get(alias);
    if (existing !== undefined && existing !== canonicalName) {
      throw new Error("AionCore model tool aliases are ambiguous");
    }
    aliasByCanonicalName.set(canonicalName, alias);
    canonicalNameByAlias.set(alias, canonicalName);
  }
  return Object.freeze({ aliasByCanonicalName, canonicalNameByAlias });
}

function openAiToolAlias(toolNames: OpenAiToolNameIndex, canonicalName: string): string {
  const alias = toolNames.aliasByCanonicalName.get(canonicalName);
  if (alias === undefined) throw new Error("AionCore model tool call is undeclared");
  return alias;
}

function modelMessages(
  messages: readonly ActestraMainModelMessage[],
  toolNames: OpenAiToolNameIndex,
): readonly Record<string, unknown>[] {
  return Object.freeze(
    messages.map((message) => {
      if (message.role === "assistant" && "toolCalls" in message) {
        return Object.freeze({
          role: "assistant",
          content: null,
          tool_calls: Object.freeze(
            message.toolCalls.map((toolCall) =>
              Object.freeze({
                id: toolCall.callId,
                type: "function",
                function: Object.freeze({
                  name: openAiToolAlias(toolNames, toolCall.name),
                  arguments: JSON.stringify(toolCall.arguments),
                }),
              }),
            ),
          ),
        });
      }
      if (message.role === "tool") {
        return Object.freeze({
          role: "tool",
          tool_call_id: message.callId,
          content: message.content,
        });
      }
      return Object.freeze({ role: message.role, content: message.content });
    }),
  );
}

function modelTools(
  tools: readonly ActestraMainModelTool[],
  toolNames: OpenAiToolNameIndex,
): readonly Record<string, unknown>[] {
  return Object.freeze(
    tools.map((tool) =>
      Object.freeze({
        type: "function",
        function: Object.freeze({
          name: openAiToolAlias(toolNames, tool.name),
          description: tool.description,
          parameters: tool.inputSchema,
        }),
      }),
    ),
  );
}

function safeCounter(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0;
}

interface ResponseValueShape {
  readonly kind: string;
  readonly length?: number;
  readonly keys?: readonly string[];
  readonly first?: ResponseValueShape;
}

/** Key names only; a gateway-supplied key that is not a plain identifier is masked. */
function diagnosticKeys(value: object): readonly string[] {
  const keys = Reflect.ownKeys(value)
    .slice(0, MAX_DIAGNOSTIC_KEYS)
    .map((key) =>
      typeof key === "string" && DIAGNOSTIC_KEY_PATTERN.test(key) ? key : "unsupported-key",
    );
  return Object.freeze(keys.sort());
}

/**
 * Describes an untrusted response value by structure alone. Enumerating real keys is
 * what separates "the gateway parked a tool call in a nonstandard field" from
 * "the completion is genuinely empty"; no value, text, or credential is recorded.
 */
function responseValueShape(value: unknown, depth = 1): ResponseValueShape {
  if (value === undefined) return Object.freeze({ kind: "undefined" });
  if (value === null) return Object.freeze({ kind: "null" });
  if (Array.isArray(value)) {
    return Object.freeze({
      kind: "array",
      length: value.length,
      ...(depth > 0 && value.length > 0 ? { first: responseValueShape(value[0], depth - 1) } : {}),
    });
  }
  if (typeof value === "string") return Object.freeze({ kind: "string", length: value.length });
  if (typeof value === "object") {
    return Object.freeze({ kind: "object", keys: diagnosticKeys(value) });
  }
  return Object.freeze({ kind: typeof value });
}

/** Records the outbound shape only: roles, lengths, and Actestra-owned tool names. */
function requestShape(
  request: Readonly<Record<string, unknown>>,
  invocation: ActestraMainModelInvocation,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    keys: diagnosticKeys(request),
    stream: own(request, "stream") === true,
    // Recorded so a multi-call rejection proves the gateway overrode an explicit
    // single-call request rather than answering one Actestra never sent.
    parallelToolCalls: own(request, "parallel_tool_calls") === false ? false : "unset",
    responseMode: invocation.responseMode,
    purpose: invocation.purpose,
    messageCount: invocation.messages.length,
    messages: Object.freeze(
      invocation.messages.slice(-MAX_DIAGNOSTIC_MESSAGES).map((message) =>
        Object.freeze({
          role: message.role,
          ...(message.role === "assistant" && "toolCalls" in message
            ? { toolCallCount: message.toolCalls.length }
            : { contentLength: (own(message, "content") as string | undefined)?.length ?? 0 }),
        }),
      ),
    ),
    toolCount: invocation.tools.length,
    tools: Object.freeze(
      invocation.tools.slice(0, MAX_DIAGNOSTIC_TOOLS).map((tool) =>
        Object.freeze({
          name: tool.name,
          schema: responseValueShape(tool.inputSchema),
        }),
      ),
    ),
  });
}

/**
 * Records why an untrusted completion was refused, keeping the Provider's response
 * structure and the outbound request shape. Every rejection path reports, so a
 * nonstandard tool-call field cannot be mistaken for an empty completion.
 */
function reportCompletionRejection(
  reason: string,
  request: Readonly<Record<string, unknown>>,
  response: unknown,
): never {
  const body = record(response);
  const choices = body === null ? undefined : own(body, "choices");
  const choice = Array.isArray(choices) ? record(choices[0]) : null;
  const message = choice === null ? null : record(own(choice, "message"));
  const usage = body === null ? null : record(own(body, "usage"));
  const field = (source: Record<string, unknown> | null, key: string): unknown =>
    source === null ? undefined : own(source, key);
  console.warn(
    "ACTESTRA_AIONUI_MODEL_COMPLETION_REJECTED " +
      JSON.stringify({
        reason,
        request,
        response: responseValueShape(response),
        choiceCount: Array.isArray(choices) ? choices.length : 0,
        choice: responseValueShape(choice),
        message: responseValueShape(message),
        usage: responseValueShape(usage),
        finishReason: stableText(field(choice, "finish_reason"), 64) ?? "unavailable",
        content: responseValueShape(field(message, "content")),
        toolCalls: responseValueShape(field(message, "tool_calls")),
        functionCall: responseValueShape(field(message, "function_call")),
        reasoningContent: responseValueShape(field(message, "reasoning_content")),
        promptTokens: safeCounter(field(usage, "prompt_tokens")),
        completionTokens: safeCounter(field(usage, "completion_tokens")),
        promptTokensDetails: responseValueShape(field(usage, "prompt_tokens_details")),
        completionTokensDetails: responseValueShape(field(usage, "completion_tokens_details")),
      }),
  );
  throw new Error("AionCore model completion is unavailable");
}

function parseCompletion(
  response: unknown,
  invocation: ActestraMainModelInvocation,
  toolNames: OpenAiToolNameIndex,
  request: Readonly<Record<string, unknown>>,
): unknown {
  const reject: (reason: string) => never = (reason) =>
    reportCompletionRejection(reason, request, response);
  const body = record(response);
  const choices = body === null ? null : own(body, "choices");
  if (!Array.isArray(choices) || choices.length !== 1) reject("choices-unavailable");
  const choice = record(choices[0]);
  const message = choice === null ? null : record(own(choice, "message"));
  if (message === null) reject("message-unavailable");
  const usage = record(body === null ? undefined : own(body, "usage"));
  const normalizedUsage = Object.freeze({
    promptTokens: safeCounter(usage === null ? undefined : own(usage, "prompt_tokens")),
    completionTokens: safeCounter(usage === null ? undefined : own(usage, "completion_tokens")),
  });
  const toolCalls = own(message, "tool_calls");
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    if (invocation.responseMode !== "text-or-tool-call") reject("tool-call-mode-unsupported");
    if (toolCalls.length !== 1) reject("tool-call-count-unsupported");
    const toolCall = record(toolCalls[0]);
    const functionCall = toolCall === null ? null : record(own(toolCall, "function"));
    const callId = stableText(toolCall === null ? undefined : own(toolCall, "id"), 256);
    const alias = stableText(functionCall === null ? undefined : own(functionCall, "name"), 64);
    const name = alias === null ? undefined : toolNames.canonicalNameByAlias.get(alias);
    const rawArguments = functionCall === null ? undefined : own(functionCall, "arguments");
    if (callId === null) reject("tool-call-id-unavailable");
    if (name === undefined) reject("tool-call-name-undeclared");
    if (typeof rawArguments !== "string") reject("tool-call-arguments-unavailable");
    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(rawArguments);
    } catch {
      reject("tool-call-arguments-unparsable");
    }
    if (!isBoundedActestraMainModelJsonValue(parsedArguments) || record(parsedArguments) === null) {
      reject("tool-call-arguments-unbounded");
    }
    return Object.freeze({
      type: "tool-call",
      callId,
      name,
      arguments: snapshotBoundedActestraMainModelJsonValue(
        parsedArguments,
      ) as ActestraMainModelJsonObject,
      usage: normalizedUsage,
    });
  }
  const text = own(message, "content");
  if (invocation.responseMode !== "text" && invocation.responseMode !== "text-or-tool-call") {
    reject("text-mode-unsupported");
  }
  if (typeof text !== "string") reject("content-shape-unsupported");
  if (text.length === 0) reject("content-empty");
  return Object.freeze({ type: "message", text, usage: normalizedUsage });
}

interface StreamedToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

function asyncIterable(value: unknown): AsyncIterable<unknown> | null {
  return (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function"
    ? (value as AsyncIterable<unknown>)
    : null;
}

function accumulateStreamedToolCalls(
  toolCalls: unknown,
  accumulators: Map<number, StreamedToolCallAccumulator>,
): void {
  if (!Array.isArray(toolCalls)) return;
  for (const candidate of toolCalls) {
    const delta = record(candidate);
    if (delta === null) continue;
    const rawIndex = own(delta, "index");
    const index = Number.isSafeInteger(rawIndex) ? (rawIndex as number) : 0;
    if (index < 0 || (accumulators.size >= MAX_STREAM_TOOL_CALLS && !accumulators.has(index))) {
      throw new Error("AionCore model stream tool calls are unsupported");
    }
    const accumulator = accumulators.get(index) ?? { id: "", name: "", arguments: "" };
    const id = own(delta, "id");
    if (typeof id === "string" && id.length > 0) accumulator.id = id;
    const functionDelta = record(own(delta, "function"));
    if (functionDelta !== null) {
      const name = own(functionDelta, "name");
      if (typeof name === "string" && name.length > 0) accumulator.name = name;
      const delta_arguments = own(functionDelta, "arguments");
      if (typeof delta_arguments === "string") accumulator.arguments += delta_arguments;
    }
    if (accumulator.arguments.length > MAX_STREAM_TEXT_LENGTH) {
      throw new Error("AionCore model stream tool call is oversized");
    }
    accumulators.set(index, accumulator);
  }
}

/**
 * Collapses an OpenAI-compatible chunk stream into the same non-streaming body shape
 * `parseCompletion` already validates. Some gateways only emit `tool_calls` on the
 * streaming path, so the streamed legs stays the source of truth for tool calls while
 * admission, aliasing, and bounds checks remain unchanged.
 */
async function aggregateStreamedCompletion(streamed: unknown): Promise<unknown> {
  const chunks = asyncIterable(streamed);
  // A gateway may ignore `stream: true` and answer with a whole body; let parseCompletion judge it.
  if (chunks === null) return streamed;
  const toolCallAccumulators = new Map<number, StreamedToolCallAccumulator>();
  let content = "";
  let sawContent = false;
  let finishReason: string | null = null;
  let usage: unknown;
  let chunkCount = 0;
  for await (const candidate of chunks) {
    if (++chunkCount > MAX_STREAM_CHUNKS) throw new Error("AionCore model stream is oversized");
    const chunk = record(candidate);
    if (chunk === null) continue;
    const chunkUsage = record(own(chunk, "usage"));
    if (chunkUsage !== null) usage = chunkUsage;
    const choices = own(chunk, "choices");
    if (!Array.isArray(choices) || choices.length === 0) continue;
    if (choices.length !== 1) throw new Error("AionCore model stream is unsupported");
    const choice = record(choices[0]);
    if (choice === null) continue;
    const reason = stableText(own(choice, "finish_reason"), 64);
    if (reason !== null) finishReason = reason;
    const delta = record(own(choice, "delta"));
    if (delta === null) continue;
    const deltaContent = own(delta, "content");
    if (typeof deltaContent === "string") {
      content += deltaContent;
      sawContent = true;
      if (content.length > MAX_STREAM_TEXT_LENGTH) {
        throw new Error("AionCore model stream is oversized");
      }
    }
    accumulateStreamedToolCalls(own(delta, "tool_calls"), toolCallAccumulators);
  }
  const toolCalls = [...toolCallAccumulators.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, accumulator]) =>
      Object.freeze({
        id: accumulator.id,
        type: "function",
        function: Object.freeze({ name: accumulator.name, arguments: accumulator.arguments }),
      }),
    );
  return Object.freeze({
    choices: Object.freeze([
      Object.freeze({
        finish_reason: finishReason ?? "stop",
        message: Object.freeze({
          role: "assistant",
          ...(toolCalls.length > 0
            ? { content: null, tool_calls: Object.freeze(toolCalls) }
            : { content: sawContent ? content : null }),
        }),
      }),
    ]),
    ...(usage === undefined ? {} : { usage }),
  });
}

export async function resolveAionCoreMainModelBinding(
  dependencies: AionCoreMainModelBindingDependencies,
): Promise<ActestraMainModelBrokerPort | null> {
  try {
    const selection = snapshotSelection(dependencies.selection);
    if (selection === null) return null;
    const providers = await dependencies.listProviders();
    if (!Array.isArray(providers) || providers.length > MAX_PROVIDER_COUNT) return null;
    const candidates = providers
      .map((provider) => admittedProviderModel(provider, selection))
      .filter((provider): provider is AionCoreProviderModelSnapshot => provider !== null);
    if (candidates.length !== 1) return null;
    const selected = candidates[0]!;
    const client = await dependencies.createClient(selected);
    if (typeof client?.createChatCompletion !== "function") return null;
    const binding: ActestraMainModelBrokerPort = Object.freeze({
      modelId: selected.use_model,
      invokeModel: async (invocation: ActestraMainModelInvocation, signal: AbortSignal) => {
        if (signal.aborted) throw new Error("AionCore model invocation aborted");
        const toolNames = indexOpenAiToolNames(invocation.tools);
        // Tool exposure and SSE transport coincide today, but they are separate
        // concerns: `parallel_tool_calls` belongs to the tool request, so it is
        // keyed on the tools themselves rather than on how the answer streams.
        const toolsPresent = invocation.tools.length > 0;
        const streaming = toolsPresent;
        const request = Object.freeze({
          model: selected.use_model,
          messages: modelMessages(invocation.messages, toolNames),
          ...(toolsPresent
            ? {
                tools: modelTools(invocation.tools, toolNames),
                // Main accepts exactly one tool call per completion. A gateway
                // that ignores this still gets fail-closed by parseCompletion.
                parallel_tool_calls: false,
              }
            : {}),
          stream: streaming,
          ...(streaming ? { stream_options: Object.freeze({ include_usage: true }) } : {}),
        });
        const response = await client.createChatCompletion(request, Object.freeze({ signal }));
        const completion = parseCompletion(
          streaming ? await aggregateStreamedCompletion(response) : response,
          invocation,
          toolNames,
          requestShape(request, invocation),
        );
        assertActestraMainModelCompletion(completion);
        return completion;
      },
    });
    return binding;
  } catch {
    return null;
  }
}
