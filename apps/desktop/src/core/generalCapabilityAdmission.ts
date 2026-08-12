/**
 * Structured capability admission for General v1.
 *
 * General v1 contract: Text-only instruction following with NO workspace/network/tool access.
 * Capability admission is based on structured metadata from request envelope,
 * NOT keyword scanning of user prompts.
 */

export const GENERAL_V1_CONTRACT_VERSION = 1 as const;

export const GENERAL_CAPABILITY_TYPES = [
  "text-analysis",
  "text-generation",
  "text-transformation",
  "workspace-read",
  "workspace-write",
  "network-fetch",
  "tool-invocation",
] as const;

export type GeneralCapabilityType = (typeof GENERAL_CAPABILITY_TYPES)[number];

export const GENERAL_V1_ALLOWED_CAPABILITIES: readonly GeneralCapabilityType[] = Object.freeze([
  "text-analysis",
  "text-generation",
  "text-transformation",
]);

export const GENERAL_V1_FORBIDDEN_CAPABILITIES: readonly GeneralCapabilityType[] = Object.freeze([
  "workspace-read",
  "workspace-write",
  "network-fetch",
  "tool-invocation",
]);

export const GENERAL_CONTEXT_REFERENCE_KINDS = [
  "none",
  "inline-text",
  "workspace-file",
  "network-resource",
] as const;

export type GeneralContextReferenceKind = (typeof GENERAL_CONTEXT_REFERENCE_KINDS)[number];

export const GENERAL_V1_ALLOWED_CONTEXT_REFERENCES: readonly GeneralContextReferenceKind[] =
  Object.freeze(["none", "inline-text"]);

export const GENERAL_V1_FORBIDDEN_CONTEXT_REFERENCES: readonly GeneralContextReferenceKind[] =
  Object.freeze(["workspace-file", "network-resource"]);

export const GENERAL_INPUT_REQUIREMENT_KINDS = [
  "none",
  "bounded-text",
  "file-reference",
  "network-reference",
] as const;

export type GeneralInputRequirementKind = (typeof GENERAL_INPUT_REQUIREMENT_KINDS)[number];

export const GENERAL_COMPLETION_CRITERIA_KINDS = [
  "text-response",
  "json-envelope",
  "file-artifact",
  "network-result",
] as const;

export type GeneralCompletionCriteriaKind = (typeof GENERAL_COMPLETION_CRITERIA_KINDS)[number];

/**
 * Structured capability request for General v1 admission.
 */
export interface GeneralCapabilityRequest {
  readonly contractVersion: typeof GENERAL_V1_CONTRACT_VERSION;
  readonly capabilities: readonly GeneralCapabilityType[];
  readonly contextReferences: readonly GeneralContextReferenceKind[];
  readonly inputRequirements: readonly GeneralInputRequirementKind[];
  readonly completionCriteria: GeneralCompletionCriteriaKind;
}

export class GeneralCapabilityAdmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneralCapabilityAdmissionError";
  }
}

/**
 * Assertion: Validate capability request structure.
 */
export function assertGeneralCapabilityRequest(
  request: unknown,
): asserts request is GeneralCapabilityRequest {
  if (typeof request !== "object" || request === null) {
    throw new GeneralCapabilityAdmissionError("Capability request must be an object");
  }

  const req = request as Record<string, unknown>;

  if (req.contractVersion !== GENERAL_V1_CONTRACT_VERSION) {
    throw new GeneralCapabilityAdmissionError(
      `Unsupported contract version: ${req.contractVersion}`,
    );
  }

  if (!Array.isArray(req.capabilities)) {
    throw new GeneralCapabilityAdmissionError("capabilities must be an array");
  }

  const invalidCapabilities = req.capabilities.filter(
    (cap) => !GENERAL_CAPABILITY_TYPES.includes(cap as GeneralCapabilityType),
  );
  if (invalidCapabilities.length > 0) {
    throw new GeneralCapabilityAdmissionError(
      `Unsupported capabilities: ${invalidCapabilities.join(", ")}`,
    );
  }

  const duplicateCapabilities = (req.capabilities as unknown[]).filter(
    (cap, index) => (req.capabilities as unknown[]).indexOf(cap) !== index,
  );
  if (duplicateCapabilities.length > 0) {
    throw new GeneralCapabilityAdmissionError(
      `Duplicate capabilities: ${duplicateCapabilities.join(", ")}`,
    );
  }

  if (!Array.isArray(req.contextReferences)) {
    throw new GeneralCapabilityAdmissionError("contextReferences must be an array");
  }

  const invalidContextRefs = req.contextReferences.filter(
    (ref) => !GENERAL_CONTEXT_REFERENCE_KINDS.includes(ref as GeneralContextReferenceKind),
  );
  if (invalidContextRefs.length > 0) {
    throw new GeneralCapabilityAdmissionError(
      `Unsupported context references: ${invalidContextRefs.join(", ")}`,
    );
  }

  if (!Array.isArray(req.inputRequirements)) {
    throw new GeneralCapabilityAdmissionError("inputRequirements must be an array");
  }

  const invalidInputReqs = req.inputRequirements.filter(
    (kind) => !GENERAL_INPUT_REQUIREMENT_KINDS.includes(kind as GeneralInputRequirementKind),
  );
  if (invalidInputReqs.length > 0) {
    throw new GeneralCapabilityAdmissionError(
      `Unsupported input requirements: ${invalidInputReqs.join(", ")}`,
    );
  }

  if (
    !GENERAL_COMPLETION_CRITERIA_KINDS.includes(
      req.completionCriteria as GeneralCompletionCriteriaKind,
    )
  ) {
    throw new GeneralCapabilityAdmissionError(
      `Unsupported completion criteria: ${req.completionCriteria}`,
    );
  }

  const allowedKeys = new Set([
    "contractVersion",
    "capabilities",
    "contextReferences",
    "inputRequirements",
    "completionCriteria",
  ]);
  const unexpectedKeys = Object.keys(req).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new GeneralCapabilityAdmissionError(
      `Unexpected fields in capability request: ${unexpectedKeys.join(", ")}`,
    );
  }
}

/**
 * Admission result for General v1 capability request.
 */
export type GeneralCapabilityAdmissionResult =
  | Readonly<{
      readonly admitted: true;
      readonly allowedCapabilities: readonly GeneralCapabilityType[];
    }>
  | Readonly<{
      readonly admitted: false;
      readonly rejectionCode:
        | "workspace-capability-required"
        | "network-capability-required"
        | "tool-capability-required"
        | "file-context-required"
        | "network-context-required"
        | "artifact-completion-unsupported"
        | "invalid-capability-request";
      readonly message: string;
    }>;

/** The rejected half of an admission decision, narrowed. */
export type GeneralCapabilityRejection = Extract<
  GeneralCapabilityAdmissionResult,
  { readonly admitted: false }
>;

/**
 * Narrows a rejected admission. The downstream tree compiles without `strictNullChecks`, where a
 * plain `!result.admitted` check does not narrow a boolean discriminant, so callers use this guard
 * instead of relying on the flag alone.
 */
export function isGeneralCapabilityRejected(
  result: GeneralCapabilityAdmissionResult,
): result is GeneralCapabilityRejection {
  return result.admitted === false;
}

/**
 * Admit General v1 capability request (pre-execution check).
 *
 * Returns admission decision based on structured capability metadata.
 * Does NOT scan user prompt text for keywords.
 */
export function admitGeneralCapability(
  request: GeneralCapabilityRequest,
): GeneralCapabilityAdmissionResult {
  assertGeneralCapabilityRequest(request);

  const forbiddenCapabilities = request.capabilities.filter((cap) =>
    GENERAL_V1_FORBIDDEN_CAPABILITIES.includes(cap),
  );

  if (forbiddenCapabilities.includes("workspace-read")) {
    return Object.freeze({
      admitted: false,
      rejectionCode: "workspace-capability-required",
      message: "General v1 does not support workspace-read capability",
    });
  }

  if (forbiddenCapabilities.includes("workspace-write")) {
    return Object.freeze({
      admitted: false,
      rejectionCode: "workspace-capability-required",
      message: "General v1 does not support workspace-write capability",
    });
  }

  if (forbiddenCapabilities.includes("network-fetch")) {
    return Object.freeze({
      admitted: false,
      rejectionCode: "network-capability-required",
      message: "General v1 does not support network-fetch capability",
    });
  }

  if (forbiddenCapabilities.includes("tool-invocation")) {
    return Object.freeze({
      admitted: false,
      rejectionCode: "tool-capability-required",
      message: "General v1 does not support tool-invocation capability",
    });
  }

  const forbiddenContextRefs = request.contextReferences.filter((ref) =>
    GENERAL_V1_FORBIDDEN_CONTEXT_REFERENCES.includes(ref),
  );

  if (forbiddenContextRefs.includes("workspace-file")) {
    return Object.freeze({
      admitted: false,
      rejectionCode: "file-context-required",
      message: "General v1 does not support workspace-file context references",
    });
  }

  if (forbiddenContextRefs.includes("network-resource")) {
    return Object.freeze({
      admitted: false,
      rejectionCode: "network-context-required",
      message: "General v1 does not support network-resource context references",
    });
  }

  if (request.completionCriteria === "file-artifact") {
    return Object.freeze({
      admitted: false,
      rejectionCode: "artifact-completion-unsupported",
      message: "General v1 does not support file-artifact completion",
    });
  }

  if (request.completionCriteria === "network-result") {
    return Object.freeze({
      admitted: false,
      rejectionCode: "artifact-completion-unsupported",
      message: "General v1 does not support network-result completion",
    });
  }

  const allowedCapabilities = request.capabilities.filter((cap) =>
    GENERAL_V1_ALLOWED_CAPABILITIES.includes(cap),
  );

  return Object.freeze({
    admitted: true,
    allowedCapabilities: Object.freeze(allowedCapabilities),
  });
}
