import { GENERAL_DRAFT_SYSTEM_PROMPT } from "../../core/generalDraftContract";
import {
  assertActestraMainModelCompletion,
  type ActestraMainModelBrokerPort,
  type ActestraMainModelInvoker,
} from "../model/actestraMainModelBroker";

const MODEL_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/;
const MAX_GENERAL_WORK_MODEL_OUTPUT_BYTES = 96 * 1024;
// General v1 is deliberately text-only: it receives no tools, so it cannot read
// files or reach the network. That absence of authority is enforced here. The
// prompt states the draft contract, and the worker validates the reply against
// it, so a model that ignores the instruction is refused rather than trusted.
const GENERAL_WORK_SYSTEM_PROMPT = GENERAL_DRAFT_SYSTEM_PROMPT;

export interface ActestraGeneralWorkModelBinding extends ActestraMainModelBrokerPort {}

export interface ActestraGeneralWorkModelInvocation {
  readonly sessionId: string;
  readonly prompt: string;
}

export interface TrustedActestraGeneralWorkRuntime {
  readonly modelId: string;
  invoke(
    invocation: ActestraGeneralWorkModelInvocation,
    signal: AbortSignal,
  ): Promise<Readonly<{ content: string }>>;
}

export interface StartTrustedActestraGeneralWorkRuntimeOptions {
  readonly modelBinding: ActestraGeneralWorkModelBinding | null;
}

function ownDataProperty(value: object, key: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

function snapshotModelBinding(
  value: ActestraGeneralWorkModelBinding | null,
): Readonly<ActestraGeneralWorkModelBinding> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== "string" || !["modelId", "invokeModel"].includes(key))
  ) {
    return null;
  }
  const modelId = ownDataProperty(value, "modelId");
  const invokeModel = ownDataProperty(value, "invokeModel");
  if (
    typeof modelId !== "string" ||
    modelId.length < 1 ||
    modelId.length > 256 ||
    !MODEL_ID_PATTERN.test(modelId) ||
    typeof invokeModel !== "function"
  ) {
    return null;
  }
  return Object.freeze({ modelId, invokeModel: invokeModel as ActestraMainModelInvoker });
}

/**
 * Carries the reason a model turn failed, so the layer above can report a refusal separately from an
 * outage instead of inferring one from message text.
 */
export class ActestraGeneralWorkModelError extends Error {
  readonly code: "model-completion-refused" | "model-unavailable";

  constructor(code: "model-completion-refused" | "model-unavailable", message: string) {
    super(message);
    this.name = "ActestraGeneralWorkModelError";
    this.code = code;
  }
}

function unavailable(): ActestraGeneralWorkModelError {
  return new ActestraGeneralWorkModelError(
    "model-unavailable",
    "General Work model response is unavailable",
  );
}

/** The model answered, but not with a usable draft turn. That is a refusal, not an outage. */
function refused(): ActestraGeneralWorkModelError {
  return new ActestraGeneralWorkModelError(
    "model-completion-refused",
    "General Work model returned no usable completion",
  );
}

export function startTrustedActestraGeneralWorkRuntime(
  options: StartTrustedActestraGeneralWorkRuntimeOptions,
): TrustedActestraGeneralWorkRuntime | null {
  const binding = snapshotModelBinding(options.modelBinding);
  if (binding === null) return null;

  return Object.freeze({
    modelId: binding.modelId,
    async invoke(invocation: ActestraGeneralWorkModelInvocation, signal: AbortSignal) {
      try {
        const completion = await binding.invokeModel(
          Object.freeze({
            sessionId: invocation.sessionId,
            purpose: "general-work",
            messages: Object.freeze([
              Object.freeze({ role: "system", content: GENERAL_WORK_SYSTEM_PROMPT }),
              Object.freeze({ role: "user", content: invocation.prompt }),
            ]),
            tools: Object.freeze([]),
            responseMode: "text",
          }),
          signal,
        );
        assertActestraMainModelCompletion(completion);
        if (
          completion.type !== "message" ||
          new TextEncoder().encode(completion.text).byteLength > MAX_GENERAL_WORK_MODEL_OUTPUT_BYTES
        ) {
          throw refused();
        }
        return Object.freeze({ content: completion.text });
      } catch (error) {
        // A refusal is reported as itself; anything else is treated as the broker being unreachable.
        throw error instanceof ActestraGeneralWorkModelError ? error : unavailable();
      }
    },
  });
}
