/**
 * Strict General v1 output envelope validation.
 *
 * Validates JSON structure, size limits, schema conformance, and content types.
 * Each validation failure includes a specific error code and repair hint.
 */

import {
  GENERAL_V1_ALLOWED_CAPABILITIES,
  type GeneralCapabilityType,
} from "./generalCapabilityAdmission";

export const GENERAL_OUTPUT_ENVELOPE_MAXIMUM_BYTES = 1024 * 1024; // 1 MB
export const GENERAL_OUTPUT_TEXT_MAXIMUM_BYTES = 512 * 1024; // 512 KB
export const GENERAL_OUTPUT_STRUCTURED_DATA_MAXIMUM_PROPERTIES = 1000;

export type GeneralOutputFormat = "text" | "structured";

export interface GeneralOutputEnvelope {
  readonly contractVersion: 1;
  readonly capability: GeneralCapabilityType;
  readonly format: GeneralOutputFormat;
  readonly content: string | Record<string, unknown>;
  readonly metadata?: {
    readonly model?: string;
    readonly tokensConsumed?: number;
    readonly completionReason?: string;
  };
}

export class GeneralOutputEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralOutputEnvelopeError";
  }
}

export type GeneralOutputEnvelopeValidationResult =
  | Readonly<{
      readonly valid: true;
      readonly envelope: GeneralOutputEnvelope;
    }>
  | Readonly<{
      readonly valid: false;
      readonly errorCode:
        | "output-too-large"
        | "invalid-json"
        | "missing-required-field"
        | "invalid-contract-version"
        | "invalid-capability"
        | "invalid-format"
        | "text-content-too-large"
        | "structured-content-too-complex"
        | "content-type-mismatch"
        | "unexpected-field";
      readonly message: string;
      readonly repairHint?: string;
    }>;

/** The invalid half of a validation result, narrowed. */
export type GeneralOutputEnvelopeRejection = Extract<
  GeneralOutputEnvelopeValidationResult,
  { readonly valid: false }
>;

/**
 * Narrows an invalid envelope result. The downstream tree compiles without `strictNullChecks`, where
 * a plain `!result.valid` check does not narrow a boolean discriminant, so callers use this guard.
 */
export function isGeneralOutputEnvelopeInvalid(
  result: GeneralOutputEnvelopeValidationResult,
): result is GeneralOutputEnvelopeRejection {
  return result.valid === false;
}

function countStructuredDataProperties(data: unknown): number {
  if (typeof data !== "object" || data === null) {
    return 0;
  }

  let count = 0;
  const stack: unknown[] = [data];

  while (stack.length > 0) {
    const current = stack.pop();

    if (typeof current !== "object" || current === null) {
      continue;
    }

    if (Array.isArray(current)) {
      count += current.length;
      stack.push(...current);
    } else {
      const obj = current as Record<string, unknown>;
      const keys = Object.keys(obj);
      count += keys.length;
      stack.push(...keys.map((key) => obj[key]));
    }
  }

  return count;
}

/**
 * Validate General v1 output envelope.
 *
 * Checks:
 * 1. Size limits before parsing
 * 2. JSON parsing
 * 3. Required fields presence
 * 4. No unexpected fields
 * 5. Contract version
 * 6. Capability type
 * 7. Format type
 * 8. Content type matching format
 * 9. Text/structured size limits
 * 10. Optional metadata schema
 */
export function validateGeneralOutputEnvelope(
  output: string,
): GeneralOutputEnvelopeValidationResult {
  const outputBytes = new TextEncoder().encode(output).length;

  if (outputBytes > GENERAL_OUTPUT_ENVELOPE_MAXIMUM_BYTES) {
    return Object.freeze({
      valid: false,
      errorCode: "output-too-large",
      message: `Output size ${outputBytes} bytes exceeds maximum ${GENERAL_OUTPUT_ENVELOPE_MAXIMUM_BYTES} bytes`,
      repairHint: "Reduce content size to fit within envelope size limit",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    return Object.freeze({
      valid: false,
      errorCode: "invalid-json",
      message: `Output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      repairHint: "Produce valid JSON output envelope",
    });
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return Object.freeze({
      valid: false,
      errorCode: "invalid-json",
      message: "Output must be a JSON object, not an array or primitive",
      repairHint: "Wrap output in a JSON object envelope",
    });
  }

  const envelope = parsed as Record<string, unknown>;

  const requiredFields = ["contractVersion", "capability", "format", "content"];
  for (const field of requiredFields) {
    if (!(field in envelope)) {
      return Object.freeze({
        valid: false,
        errorCode: "missing-required-field",
        message: `Missing required field: ${field}`,
        repairHint: `Include ${field} field in output envelope`,
      });
    }
  }

  const allowedFields = new Set([...requiredFields, "metadata"]);
  const unexpectedFields = Object.keys(envelope).filter((key) => !allowedFields.has(key));
  if (unexpectedFields.length > 0) {
    return Object.freeze({
      valid: false,
      errorCode: "unexpected-field",
      message: `Unexpected fields in envelope: ${unexpectedFields.join(", ")}`,
      repairHint: "Remove unexpected fields from envelope",
    });
  }

  if (envelope.contractVersion !== 1) {
    return Object.freeze({
      valid: false,
      errorCode: "invalid-contract-version",
      message: `Invalid contract version: ${envelope.contractVersion} (must be 1)`,
      repairHint: "Set contractVersion to 1",
    });
  }

  if (
    typeof envelope.capability !== "string" ||
    !GENERAL_V1_ALLOWED_CAPABILITIES.includes(envelope.capability as GeneralCapabilityType)
  ) {
    return Object.freeze({
      valid: false,
      errorCode: "invalid-capability",
      message: `Invalid capability: ${envelope.capability} (must be one of: ${GENERAL_V1_ALLOWED_CAPABILITIES.join(", ")})`,
      repairHint: `Set capability to one of: ${GENERAL_V1_ALLOWED_CAPABILITIES.join(", ")}`,
    });
  }

  if (envelope.format !== "text" && envelope.format !== "structured") {
    return Object.freeze({
      valid: false,
      errorCode: "invalid-format",
      message: `Invalid format: ${envelope.format} (must be "text" or "structured")`,
      repairHint: 'Set format to "text" or "structured"',
    });
  }

  if (envelope.format === "text" && typeof envelope.content !== "string") {
    return Object.freeze({
      valid: false,
      errorCode: "content-type-mismatch",
      message: `Format is "text" but content is not a string`,
      repairHint: "Text format must have string content",
    });
  }

  if (
    envelope.format === "structured" &&
    (typeof envelope.content !== "object" ||
      envelope.content === null ||
      Array.isArray(envelope.content))
  ) {
    return Object.freeze({
      valid: false,
      errorCode: "content-type-mismatch",
      message: `Format is "structured" but content is not an object`,
      repairHint: "Structured format must have object content",
    });
  }

  if (envelope.format === "text") {
    const textBytes = new TextEncoder().encode(envelope.content as string).length;
    if (textBytes > GENERAL_OUTPUT_TEXT_MAXIMUM_BYTES) {
      return Object.freeze({
        valid: false,
        errorCode: "text-content-too-large",
        message: `Text content ${textBytes} bytes exceeds maximum ${GENERAL_OUTPUT_TEXT_MAXIMUM_BYTES} bytes`,
        repairHint: "Reduce text content size",
      });
    }
  }

  if (envelope.format === "structured") {
    const propertyCount = countStructuredDataProperties(envelope.content);
    if (propertyCount > GENERAL_OUTPUT_STRUCTURED_DATA_MAXIMUM_PROPERTIES) {
      return Object.freeze({
        valid: false,
        errorCode: "structured-content-too-complex",
        message: `Structured content has ${propertyCount} properties, exceeds maximum ${GENERAL_OUTPUT_STRUCTURED_DATA_MAXIMUM_PROPERTIES}`,
        repairHint: "Simplify structured content to reduce property count",
      });
    }
  }

  if (envelope.metadata !== undefined) {
    if (typeof envelope.metadata !== "object" || envelope.metadata === null) {
      return Object.freeze({
        valid: false,
        errorCode: "unexpected-field",
        message: "metadata must be an object if present",
        repairHint: "Remove metadata or make it an object",
      });
    }

    const metadata = envelope.metadata as Record<string, unknown>;
    const allowedMetadataFields = new Set(["model", "tokensConsumed", "completionReason"]);
    const unexpectedMetadataFields = Object.keys(metadata).filter(
      (key) => !allowedMetadataFields.has(key),
    );
    if (unexpectedMetadataFields.length > 0) {
      return Object.freeze({
        valid: false,
        errorCode: "unexpected-field",
        message: `Unexpected metadata fields: ${unexpectedMetadataFields.join(", ")}`,
        repairHint: "Remove unexpected metadata fields",
      });
    }

    if (metadata.model !== undefined && typeof metadata.model !== "string") {
      return Object.freeze({
        valid: false,
        errorCode: "unexpected-field",
        message: "metadata.model must be a string if present",
        repairHint: "Make metadata.model a string or remove it",
      });
    }

    if (
      metadata.tokensConsumed !== undefined &&
      (typeof metadata.tokensConsumed !== "number" ||
        !Number.isInteger(metadata.tokensConsumed) ||
        metadata.tokensConsumed < 0)
    ) {
      return Object.freeze({
        valid: false,
        errorCode: "unexpected-field",
        message: "metadata.tokensConsumed must be a non-negative integer if present",
        repairHint: "Make metadata.tokensConsumed a non-negative integer or remove it",
      });
    }

    if (metadata.completionReason !== undefined && typeof metadata.completionReason !== "string") {
      return Object.freeze({
        valid: false,
        errorCode: "unexpected-field",
        message: "metadata.completionReason must be a string if present",
        repairHint: "Make metadata.completionReason a string or remove it",
      });
    }
  }

  return Object.freeze({
    valid: true,
    envelope: envelope as unknown as GeneralOutputEnvelope,
  });
}
