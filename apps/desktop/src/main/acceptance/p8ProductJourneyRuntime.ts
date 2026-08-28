import {
  CODING_DIFF_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
} from "../../core/isolatedCodingTools";
import type {
  ActestraMainModelBrokerPort,
  ActestraMainModelCompletion,
  ActestraMainModelInvocation,
  ActestraMainModelJsonObject,
  ActestraMainModelMessage,
  ActestraMainModelTool,
} from "../model/actestraMainModelBroker";
import type { NativeAionUiTeamModelOptions } from "../../compatibility/aionui/teamBridge";

/**
 * This runtime exists solely to make the packaged P8.2 journey repeatable. It
 * is a Main-owned loopback model binding, not a Provider record and not a
 * second Team/Worker authority. The caller must prove both the packaged
 * boundary and the two explicit smoke switches before it can be constructed.
 */
export const P8_PRODUCT_JOURNEY_LOOPBACK_PROVIDER_ID = "actestra-p8-loopback" as const;
export const P8_PRODUCT_JOURNEY_LOOPBACK_MODEL_ID = "actestra-p8-loopback-v1" as const;

export const P8_PRODUCT_JOURNEY_CODING_TOOL_SEQUENCE = Object.freeze([
  CODING_GIT_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_DIFF_TOOL_ID,
] as const);

export const P8_PRODUCT_JOURNEY_FILE = "p8-journey-proof.txt" as const;
export const P8_PRODUCT_JOURNEY_FILE_CONTENT =
  "Actestra P8.2 deterministic journey proof.\n" as const;
export const P8_PRODUCT_JOURNEY_TEAM_FILE = "p8-team-journey-proof.txt" as const;
export const P8_PRODUCT_JOURNEY_TEAM_FILE_CONTENT =
  "Actestra P8.2 deterministic Team journey proof.\n" as const;
export const P8_PRODUCT_JOURNEY_GENERAL_MARKDOWN =
  "# Actestra P8.2 journey proof\n\nThe deterministic packaged acceptance journey completed through the Main-owned runtime.\n" as const;
const MODEL_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/u;

export interface P8ProductJourneyRuntimeConfig {
  readonly enabled: true;
  readonly providerId: typeof P8_PRODUCT_JOURNEY_LOOPBACK_PROVIDER_ID;
  readonly modelId: typeof P8_PRODUCT_JOURNEY_LOOPBACK_MODEL_ID;
  readonly restartPhase: "prepare" | "recover" | null;
}

export function resolveP8ProductJourneyRuntimeConfig(input: {
  readonly packaged: boolean;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): P8ProductJourneyRuntimeConfig | null {
  if (
    input.packaged !== true ||
    input.environment.ACTESTRA_E2E_TEST !== "1" ||
    input.environment.ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE !== "1"
  ) {
    return null;
  }
  const requestedRestartPhase = input.environment.ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE;
  if (
    requestedRestartPhase !== undefined &&
    requestedRestartPhase !== "prepare" &&
    requestedRestartPhase !== "recover"
  ) {
    return null;
  }
  const restartPhase: "prepare" | "recover" | null =
    requestedRestartPhase === "prepare" || requestedRestartPhase === "recover"
      ? requestedRestartPhase
      : null;
  return Object.freeze({
    enabled: true as const,
    providerId: P8_PRODUCT_JOURNEY_LOOPBACK_PROVIDER_ID,
    modelId: P8_PRODUCT_JOURNEY_LOOPBACK_MODEL_ID,
    restartPhase,
  });
}

function usage() {
  return Object.freeze({ promptTokens: 1, completionTokens: 1 });
}

function message(text: string): ActestraMainModelCompletion {
  return Object.freeze({ type: "message" as const, text, usage: usage() });
}

function toolCall(
  name: string,
  callId: string,
  argumentsValue: ActestraMainModelJsonObject,
): ActestraMainModelCompletion {
  return Object.freeze({
    type: "tool-call" as const,
    callId,
    name,
    arguments: Object.freeze(argumentsValue),
    usage: usage(),
  });
}

function toolName(tool: ActestraMainModelTool): string | null {
  if (
    typeof tool !== "object" ||
    tool === null ||
    typeof tool.name !== "string" ||
    !MODEL_ID_PATTERN.test(tool.name)
  ) {
    return null;
  }
  return tool.name;
}

function declaredTools(invocation: ActestraMainModelInvocation): ReadonlySet<string> {
  const names = new Set<string>();
  for (const candidate of invocation.tools) {
    const name = toolName(candidate);
    if (name !== null) names.add(name);
  }
  return names;
}

function assistantToolCallCount(messages: readonly ActestraMainModelMessage[]): number {
  return messages.reduce((count, current) => {
    if (current.role !== "assistant" || !("toolCalls" in current)) return count;
    return count + current.toolCalls.length;
  }, 0);
}

function hasToolResultForCall(
  messages: readonly ActestraMainModelMessage[],
  callId: string,
): boolean {
  return messages.some((current) => current.role === "tool" && current.callId === callId);
}

function nextCodingTool(
  invocation: ActestraMainModelInvocation,
): (typeof P8_PRODUCT_JOURNEY_CODING_TOOL_SEQUENCE)[number] | null {
  const count = assistantToolCallCount(invocation.messages);
  if (count >= P8_PRODUCT_JOURNEY_CODING_TOOL_SEQUENCE.length) return null;
  return P8_PRODUCT_JOURNEY_CODING_TOOL_SEQUENCE[count] ?? null;
}

function codingArguments(
  tool: (typeof P8_PRODUCT_JOURNEY_CODING_TOOL_SEQUENCE)[number],
  teamJourney: boolean,
): ActestraMainModelJsonObject {
  switch (tool) {
    case CODING_GIT_TOOL_ID:
      return Object.freeze({
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        query: "status",
      });
    case CODING_FILE_WRITE_TOOL_ID:
      return Object.freeze({
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
        relativePath: teamJourney ? P8_PRODUCT_JOURNEY_TEAM_FILE : P8_PRODUCT_JOURNEY_FILE,
        content: teamJourney
          ? P8_PRODUCT_JOURNEY_TEAM_FILE_CONTENT
          : P8_PRODUCT_JOURNEY_FILE_CONTENT,
      });
    case CODING_DIFF_TOOL_ID:
      return Object.freeze({
        contractVersion: ISOLATED_CODING_TOOL_INPUT_CONTRACT_VERSION,
      });
  }
  throw new Error("tool-not-declared");
}

function isTeamCodingInvocation(invocation: ActestraMainModelInvocation): boolean {
  return invocation.messages.some(
    (current) =>
      "content" in current &&
      typeof current.content === "string" &&
      current.content.includes("General and Goose Team"),
  );
}

function codingCompletion(invocation: ActestraMainModelInvocation): ActestraMainModelCompletion {
  if (invocation.tools.length === 0) throw new Error("tool-not-declared");
  const declared = declaredTools(invocation);
  const next = nextCodingTool(invocation);
  if (next === null) {
    return message("The isolated coding patch is ready for review.");
  }
  if (!declared.has(next)) throw new Error("tool-not-declared");

  // The real Goose protocol requires a result for every preceding call. A
  // direct unit caller may omit it, but a malformed repeated call must never
  // be mistaken for progress in the packaged journey.
  const previous = invocation.messages
    .filter(
      (current): current is Extract<ActestraMainModelMessage, { role: "assistant" }> =>
        current.role === "assistant",
    )
    .flatMap((current) => ("toolCalls" in current ? current.toolCalls : []))
    .at(-1);
  if (previous !== undefined && !hasToolResultForCall(invocation.messages, previous.callId)) {
    // Keep the deterministic unit contract useful while ensuring no arbitrary
    // tool arguments can enter the binding.
    if (assistantToolCallCount(invocation.messages) > 1) {
      throw new Error("tool-result-missing");
    }
  }
  const teamJourney = isTeamCodingInvocation(invocation);
  return toolCall(
    next,
    `p8-${String(assistantToolCallCount(invocation.messages) + 1)}`,
    codingArguments(next, teamJourney),
  );
}

function generalCompletion(): ActestraMainModelCompletion {
  return message(
    JSON.stringify({
      status: "completed",
      markdown: P8_PRODUCT_JOURNEY_GENERAL_MARKDOWN,
    }),
  );
}

export function createP8ProductJourneyLoopbackModelBinding(
  config: P8ProductJourneyRuntimeConfig,
): ActestraMainModelBrokerPort {
  if (
    config.enabled !== true ||
    config.providerId !== P8_PRODUCT_JOURNEY_LOOPBACK_PROVIDER_ID ||
    config.modelId !== P8_PRODUCT_JOURNEY_LOOPBACK_MODEL_ID
  ) {
    throw new Error("P8.2 loopback runtime configuration is invalid");
  }
  return Object.freeze({
    modelId: config.modelId,
    invokeModel: async (
      invocation: ActestraMainModelInvocation,
      signal: AbortSignal,
    ): Promise<ActestraMainModelCompletion> => {
      if (signal.aborted) throw new Error("model-aborted");
      if (invocation.purpose === "general-work") {
        if (invocation.tools.length !== 0 || invocation.responseMode !== "text") {
          throw new Error("general-runtime-contract-invalid");
        }
        return generalCompletion();
      }
      if (invocation.purpose !== "coding" || invocation.responseMode !== "text-or-tool-call") {
        throw new Error("loopback-runtime-purpose-invalid");
      }
      return codingCompletion(invocation);
    },
  });
}

export function createP8ProductJourneyTeamModelCatalog(config: P8ProductJourneyRuntimeConfig): {
  readonly list: () => Promise<NativeAionUiTeamModelOptions>;
} {
  if (config.enabled !== true) throw new Error("P8.2 loopback runtime is disabled");
  const options = Object.freeze({
    providers: Object.freeze([
      Object.freeze({
        provider_id: config.providerId,
        name: "Actestra P8 loopback",
        model_ids: Object.freeze([config.modelId]),
      }),
    ]),
  });
  return Object.freeze({ list: async () => options });
}
