/**
 * Bounded repair and layered error codes for General v1.
 *
 * General v1 contract:
 * - Single repair attempt on validation failure (not unbounded retry)
 * - Layered error codes preserved from admission → execution → validation → repair
 * - Each layer has specific error codes that propagate upward
 * - Repair failure results in terminal error, not infinite loop
 */

import {
  admitGeneralCapability,
  isGeneralCapabilityRejected,
  type GeneralCapabilityRequest,
  type GeneralCapabilityAdmissionResult,
} from "./generalCapabilityAdmission";
import {
  isGeneralOutputEnvelopeInvalid,
  validateGeneralOutputEnvelope,
  type GeneralOutputEnvelopeValidationResult,
} from "./generalOutputEnvelope";

/**
 * Layered error codes for General v1 instruction execution.
 *
 * Layer 1 (Admission): Pre-execution capability check
 * Layer 2 (Execution): Model invocation and runtime errors
 * Layer 3 (Validation): Output envelope schema validation
 * Layer 4 (Repair): Single bounded repair attempt
 */
export const GENERAL_ERROR_LAYERS = ["admission", "execution", "validation", "repair"] as const;

export type GeneralErrorLayer = (typeof GENERAL_ERROR_LAYERS)[number];

export const GENERAL_ADMISSION_ERROR_CODES = [
  "workspace-capability-required",
  "network-capability-required",
  "tool-capability-required",
  "file-context-required",
  "network-context-required",
  "artifact-completion-unsupported",
  "invalid-capability-request",
] as const;

export const GENERAL_EXECUTION_ERROR_CODES = [
  "model-unavailable",
  "model-timeout",
  "model-overloaded",
  "model-refused",
  "context-length-exceeded",
  "execution-aborted",
  "runtime-error",
] as const;

export const GENERAL_VALIDATION_ERROR_CODES = [
  "output-too-large",
  "invalid-json",
  "missing-required-field",
  "invalid-contract-version",
  "invalid-capability",
  "invalid-format",
  "text-content-too-large",
  "structured-content-too-complex",
  "content-type-mismatch",
  "unexpected-field",
] as const;

export const GENERAL_REPAIR_ERROR_CODES = [
  "repair-failed",
  "repair-timeout",
  "repair-exceeded-bounds",
] as const;

export type GeneralAdmissionErrorCode = (typeof GENERAL_ADMISSION_ERROR_CODES)[number];
export type GeneralExecutionErrorCode = (typeof GENERAL_EXECUTION_ERROR_CODES)[number];
export type GeneralValidationErrorCode = (typeof GENERAL_VALIDATION_ERROR_CODES)[number];
export type GeneralRepairErrorCode = (typeof GENERAL_REPAIR_ERROR_CODES)[number];

export type GeneralErrorCode =
  | GeneralAdmissionErrorCode
  | GeneralExecutionErrorCode
  | GeneralValidationErrorCode
  | GeneralRepairErrorCode;

/**
 * Layered error with exact layer and code preserved.
 */
export interface GeneralLayeredError {
  readonly layer: GeneralErrorLayer;
  readonly code: GeneralErrorCode;
  readonly message: string;
  readonly repairAttempted?: boolean;
  readonly originalError?: GeneralLayeredError;
}

/**
 * General v1 execution result with layered error tracking.
 */
export type GeneralExecutionResult =
  | Readonly<{
      readonly success: true;
      readonly output: string;
      readonly repairAttempted: boolean;
    }>
  | Readonly<{
      readonly success: false;
      readonly error: GeneralLayeredError;
    }>;

export class GeneralLayeredExecutionError extends Error {
  constructor(readonly layeredError: GeneralLayeredError) {
    super(layeredError.message);
    this.name = "GeneralLayeredExecutionError";
  }
}

/**
 * A model turn that failed for a reason the caller already knows. Callers declare the code so this
 * layer never has to guess one from message text: provider wording is not a contract, and a
 * sniffed keyword silently reclassifies a refusal as an outage the moment that wording changes.
 */
export class GeneralModelInvocationError extends Error {
  readonly code: GeneralExecutionErrorCode;

  constructor(code: GeneralExecutionErrorCode, message: string) {
    super(message);
    this.name = "GeneralModelInvocationError";
    this.code = code;
  }
}

function classifyModelFailure(error: unknown): GeneralLayeredError {
  if (error instanceof GeneralModelInvocationError) {
    return createExecutionError(error.code, error.message);
  }
  if (error instanceof GeneralLayeredExecutionError) {
    return error.layeredError;
  }
  // An unclassified throw is a runtime fault. Reporting it as one keeps `model-*` codes meaning
  // "the provider said so" rather than "the message happened to contain a word".
  return createExecutionError(
    "runtime-error",
    `Model invocation failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * Create a layered error from admission failure.
 */
export function createAdmissionError(
  result: Extract<GeneralCapabilityAdmissionResult, { admitted: false }>,
): GeneralLayeredError {
  return Object.freeze({
    layer: "admission",
    code: result.rejectionCode,
    message: result.message,
  });
}

/**
 * Create a layered error from execution failure.
 */
export function createExecutionError(
  code: GeneralExecutionErrorCode,
  message: string,
): GeneralLayeredError {
  return Object.freeze({
    layer: "execution",
    code,
    message,
  });
}

/**
 * Create a layered error from validation failure.
 */
export function createValidationError(
  result: Extract<GeneralOutputEnvelopeValidationResult, { valid: false }>,
): GeneralLayeredError {
  return Object.freeze({
    layer: "validation",
    code: result.errorCode,
    message: result.message,
  });
}

/**
 * Create a layered error from repair failure.
 */
export function createRepairError(
  code: GeneralRepairErrorCode,
  message: string,
  originalError: GeneralLayeredError,
): GeneralLayeredError {
  return Object.freeze({
    layer: "repair",
    code,
    message,
    repairAttempted: true,
    originalError,
  });
}

export const GENERAL_REPAIR_ATTEMPT_LIMIT = 1 as const;
export const GENERAL_REPAIR_TIMEOUT_MS = 30000 as const; // 30 seconds

/**
 * Attempt bounded single repair of validation failure.
 *
 * Sends validation error + repair hint back to model ONCE.
 * If second attempt also fails, returns terminal error (no infinite loop).
 */
export async function attemptBoundedRepair(
  modelInvoke: (repairPrompt: string) => Promise<string>,
  validationResult: Extract<GeneralOutputEnvelopeValidationResult, { valid: false }>,
): Promise<GeneralExecutionResult> {
  // Spec C: the malformed output must not be echoed back. Resending it invites the model to edit its
  // own broken text — reproducing the same defect — and re-admits unvalidated content into a prompt
  // whose size bound was the reason validation failed. The diagnosis and hint are enough to retry.
  const repairPrompt = `Your previous output failed validation:

Error: ${validationResult.message}
${validationResult.repairHint ? `Hint: ${validationResult.repairHint}` : ""}

Please produce a CORRECTED output that satisfies the validation requirements.
You have ONE attempt to fix this. Return valid JSON envelope only.`;

  let repairedOutput: string;
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new GeneralLayeredExecutionError(
              createRepairError(
                "repair-timeout",
                `Repair attempt exceeded ${GENERAL_REPAIR_TIMEOUT_MS}ms timeout`,
                createValidationError(validationResult),
              ),
            ),
          ),
        GENERAL_REPAIR_TIMEOUT_MS,
      ),
    );
    repairedOutput = await Promise.race([modelInvoke(repairPrompt), timeoutPromise]);
  } catch (error) {
    if (error instanceof GeneralLayeredExecutionError) {
      return Object.freeze({
        success: false,
        error: error.layeredError,
      });
    }
    return Object.freeze({
      success: false,
      error: createRepairError(
        "repair-failed",
        `Repair model invocation failed: ${error instanceof Error ? error.message : String(error)}`,
        createValidationError(validationResult),
      ),
    });
  }

  // Validate repaired output
  const repairedValidation = validateGeneralOutputEnvelope(repairedOutput);
  if (isGeneralOutputEnvelopeInvalid(repairedValidation)) {
    // Repair failed - return terminal error with both original and repair errors
    return Object.freeze({
      success: false,
      error: createRepairError(
        "repair-exceeded-bounds",
        `Repair attempt failed validation: ${repairedValidation.message}`,
        createValidationError(validationResult),
      ),
    });
  }

  return Object.freeze({
    success: true,
    output: repairedOutput,
    repairAttempted: true,
  });
}

/**
 * Execute General v1 instruction with full layered error handling.
 *
 * Flow:
 * 1. Admission check (pre-execution capability validation)
 * 2. Model invocation
 * 3. Output validation
 * 4. Bounded single repair if validation fails
 * 5. Terminal error if repair also fails
 *
 * Error codes preserved across all layers.
 */
export async function executeGeneralInstruction(
  capabilityRequest: GeneralCapabilityRequest,
  modelInvoke: (prompt: string) => Promise<string>,
  userPrompt: string,
): Promise<GeneralExecutionResult> {
  // Layer 1: Admission
  const admissionResult = admitGeneralCapability(capabilityRequest);
  if (isGeneralCapabilityRejected(admissionResult)) {
    return Object.freeze({
      success: false,
      error: createAdmissionError(admissionResult),
    });
  }

  // Layer 2: Execution
  let output: string;
  try {
    output = await modelInvoke(userPrompt);
  } catch (error) {
    return Object.freeze({ success: false, error: classifyModelFailure(error) });
  }

  // Layer 3: Validation
  const validationResult = validateGeneralOutputEnvelope(output);
  if (isGeneralOutputEnvelopeInvalid(validationResult)) {
    // Layer 4: Bounded repair (single attempt)
    return attemptBoundedRepair(modelInvoke, validationResult);
  }

  return Object.freeze({
    success: true,
    output,
    repairAttempted: false,
  });
}
