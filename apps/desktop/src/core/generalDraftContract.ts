/**
 * The contract General v1 must satisfy when it authors a writing draft.
 *
 * A text-only turn cannot read a file, so a model asked for material it was never given has exactly
 * two honest replies: the finished draft, or a statement of what is missing. This module admits only
 * those two shapes. Anything else — a placeholder standing in for unread content, a `completed`
 * status with nothing written, a draft smuggled alongside a `needs-input` — is rejected with a code
 * that says which rule broke, so the surface can tell "General cannot do this" apart from "the
 * provider was down".
 */

import {
  admitGeneralCapability,
  isGeneralCapabilityRejected,
  type GeneralCapabilityRequest,
} from "./generalCapabilityAdmission";

/** Codes that survive every layer between the worker and the Team surface. */
export const GENERAL_DRAFT_ERROR_CODES = [
  "general-capability-mismatch",
  "general-input-required",
  "general-output-invalid",
  "general-instruction-noncompliant",
] as const;

export type GeneralDraftErrorCode = (typeof GENERAL_DRAFT_ERROR_CODES)[number];

/**
 * The one code that means the task stalled on material only the user can supply. Nothing failed, so
 * the surface reports a blocked task the user can act on instead of an error they cannot. A
 * capability mismatch is deliberately excluded: supplying text does not grant General the authority
 * it lacks, so that case stays a failure pointing at a different execution path.
 */
export const GENERAL_AWAITING_INPUT_ERROR_CODE = "general-input-required";

export function isGeneralAwaitingInputErrorCode(code: string | undefined): boolean {
  return code === GENERAL_AWAITING_INPUT_ERROR_CODE;
}

/** Model-side codes. Separate from the draft codes: these describe the provider, not the content. */
export const GENERAL_MODEL_ERROR_CODES = [
  "model-completion-refused",
  "model-timeout",
  "model-unavailable",
] as const;

export type GeneralModelErrorCode = (typeof GENERAL_MODEL_ERROR_CODES)[number];

export const GENERAL_DRAFT_MAXIMUM_BYTES = 96 * 1024;
export const GENERAL_DRAFT_MARKDOWN_MAXIMUM_BYTES = 64 * 1024;
export const GENERAL_DRAFT_MESSAGE_MAXIMUM_LENGTH = 2000;
export const GENERAL_DRAFT_MISSING_INPUT_MAXIMUM_LENGTH = 200;
export const GENERAL_DRAFT_MISSING_INPUT_MAXIMUM_COUNT = 20;

const COMPLETED_KEYS: readonly string[] = Object.freeze(["status", "markdown"]);
const NEEDS_INPUT_KEYS: readonly string[] = Object.freeze(["status", "missing_inputs", "message"]);

/**
 * Placeholders a model leaves when it wants to look finished without the material. Matching is
 * structural — bracketed or ruled fill-me markers — rather than a search for topical words, so
 * prose that merely discusses a TODO list is not condemned by its subject matter.
 */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = Object.freeze([
  /<\s*(?:to\s+be\s+filled|to\s+be\s+determined|insert|placeholder|fill\s+in)[^>]*>/iu,
  /\[\s*(?:to\s+be\s+filled|to\s+be\s+determined|tbd|todo|placeholder|insert[^\]]*|fill[^\]]*)\s*\]/iu,
  /\{\{\s*[^}]*\}\}/u,
  /_{3,}\s*$/mu,
  /\bx{3,}\b/iu,
]);

export type GeneralDraft =
  | Readonly<{
      readonly status: "completed";
      readonly markdown: string;
    }>
  | Readonly<{
      readonly status: "needs-input";
      readonly missingInputs: readonly string[];
      readonly message: string;
    }>;

export type GeneralDraftValidation =
  | Readonly<{ readonly valid: true; readonly draft: GeneralDraft }>
  | Readonly<{
      readonly valid: false;
      readonly errorCode: GeneralDraftErrorCode;
      /** Names the broken rule. Never carries the offending output, so it is safe in a retry. */
      readonly violatedRule: string;
      readonly message: string;
    }>;

function invalid(
  errorCode: GeneralDraftErrorCode,
  violatedRule: string,
  message: string,
): GeneralDraftValidation {
  return Object.freeze({ valid: false, errorCode, violatedRule, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Reports the first structural placeholder in the draft, or null when the prose stands on its own. */
export function findGeneralDraftPlaceholder(markdown: string): string | null {
  for (const pattern of PLACEHOLDER_PATTERNS) {
    const match = pattern.exec(markdown);
    if (match !== null) return match[0].trim();
  }
  return null;
}

/**
 * Validates one model reply against the draft contract.
 *
 * Returns a code rather than throwing: a malformed reply is an expected outcome that earns one
 * bounded repair, not an exception. `general-output-invalid` covers a reply that is not the shape at
 * all; `general-instruction-noncompliant` covers a well-formed reply that breaks a content rule,
 * because those two deserve different words on the surface.
 */
export function validateGeneralDraft(rawOutput: string): GeneralDraftValidation {
  if (byteLength(rawOutput) > GENERAL_DRAFT_MAXIMUM_BYTES) {
    return invalid(
      "general-output-invalid",
      "envelope-too-large",
      "The draft envelope exceeded the permitted size.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return invalid(
      "general-output-invalid",
      "not-json",
      "The reply was not a JSON draft envelope.",
    );
  }

  if (!isRecord(parsed)) {
    return invalid(
      "general-output-invalid",
      "not-an-object",
      "The draft envelope must be a JSON object.",
    );
  }

  const status: unknown = parsed["status"];
  if (status !== "completed" && status !== "needs-input") {
    return invalid(
      "general-output-invalid",
      "unknown-status",
      'The draft envelope status must be "completed" or "needs-input".',
    );
  }

  const permitted = status === "completed" ? COMPLETED_KEYS : NEEDS_INPUT_KEYS;
  const unexpected = Object.keys(parsed).filter((key) => !permitted.includes(key));
  if (unexpected.length > 0) {
    // A `needs-input` carrying `markdown` is the case worth naming: it is a draft written from
    // material the model never had, which is the failure this contract exists to stop.
    return invalid(
      "general-output-invalid",
      "unexpected-key",
      `The draft envelope declared a key it may not use: ${unexpected[0] ?? ""}.`,
    );
  }

  return status === "completed" ? completedDraft(parsed) : needsInputDraft(parsed);
}

function completedDraft(parsed: Record<string, unknown>): GeneralDraftValidation {
  const markdown: unknown = parsed["markdown"];
  if (typeof markdown !== "string") {
    return invalid(
      "general-output-invalid",
      "markdown-not-a-string",
      "A completed draft must carry markdown text.",
    );
  }
  if (markdown.trim().length === 0) {
    return invalid(
      "general-instruction-noncompliant",
      "empty-markdown",
      "A completed draft cannot be empty.",
    );
  }
  if (byteLength(markdown) > GENERAL_DRAFT_MARKDOWN_MAXIMUM_BYTES) {
    return invalid(
      "general-output-invalid",
      "markdown-too-large",
      "The completed draft exceeded the permitted size.",
    );
  }
  const placeholder = findGeneralDraftPlaceholder(markdown);
  if (placeholder !== null) {
    return invalid(
      "general-instruction-noncompliant",
      "placeholder-in-markdown",
      "A completed draft cannot leave a placeholder to fill in later.",
    );
  }
  return Object.freeze({
    valid: true,
    draft: Object.freeze({ status: "completed" as const, markdown }),
  });
}

function needsInputDraft(parsed: Record<string, unknown>): GeneralDraftValidation {
  const missing: unknown = parsed["missing_inputs"];
  const message: unknown = parsed["message"];
  if (!Array.isArray(missing) || missing.length === 0) {
    return invalid(
      "general-output-invalid",
      "missing-inputs-not-listed",
      "A needs-input reply must name at least one missing input.",
    );
  }
  if (missing.length > GENERAL_DRAFT_MISSING_INPUT_MAXIMUM_COUNT) {
    return invalid(
      "general-output-invalid",
      "too-many-missing-inputs",
      "A needs-input reply named more missing inputs than permitted.",
    );
  }
  const missingInputs: string[] = [];
  for (const entry of missing) {
    if (
      typeof entry !== "string" ||
      entry.trim().length === 0 ||
      entry.length > GENERAL_DRAFT_MISSING_INPUT_MAXIMUM_LENGTH
    ) {
      return invalid(
        "general-output-invalid",
        "invalid-missing-input",
        "Each missing input must be a short non-empty description.",
      );
    }
    missingInputs.push(entry.trim());
  }
  if (
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > GENERAL_DRAFT_MESSAGE_MAXIMUM_LENGTH
  ) {
    return invalid(
      "general-output-invalid",
      "invalid-message",
      "A needs-input reply must explain what it needs.",
    );
  }
  return Object.freeze({
    valid: true,
    draft: Object.freeze({
      status: "needs-input" as const,
      missingInputs: Object.freeze(missingInputs),
      message: message.trim(),
    }),
  });
}
/** One repair, then the attempt fails. Spec C: a second malformed reply is `general-output-invalid`. */
export const GENERAL_DRAFT_REPAIR_ATTEMPT_LIMIT = 1;

const REPAIR_INSTRUCTION_PREFIX = 'Your previous reply violated rule "' as const;
const REPAIR_INSTRUCTION_SUFFIX =
  '". Reply with one JSON object and nothing else. ' +
  'Either {"status":"completed","markdown":"<the full draft>"} ' +
  'or {"status":"needs-input","missing_inputs":["<what is missing>"],"message":"<what you need>"}. ' +
  "Declare no other keys. Never leave a placeholder for later.";

/** The rule names this contract reports, in the one shape a repair instruction may name. */
const VIOLATED_RULE_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;

/**
 * Builds the repair instruction for a malformed reply.
 *
 * It states the broken rule and nothing else. The offending output is deliberately absent: echoing it
 * back invites the model to repeat it, and it may contain the very placeholder prose being rejected.
 */
export function buildGeneralDraftRepairInstruction(violatedRule: string): string {
  return `${REPAIR_INSTRUCTION_PREFIX}${violatedRule}${REPAIR_INSTRUCTION_SUFFIX}`;
}

/**
 * Recognises a repair instruction this contract itself built.
 *
 * The Main process owns the model, so it must be able to tell a bounded repair apart from arbitrary
 * text a Worker asks it to send. Only the rule name varies, so anything else in the prompt means the
 * request is not the repair it claims to be and no model call is owed to it.
 */
export function isGeneralDraftRepairInstruction(prompt: string): boolean {
  if (
    !prompt.startsWith(REPAIR_INSTRUCTION_PREFIX) ||
    !prompt.endsWith(REPAIR_INSTRUCTION_SUFFIX)
  ) {
    return false;
  }
  const rule = prompt.slice(
    REPAIR_INSTRUCTION_PREFIX.length,
    prompt.length - REPAIR_INSTRUCTION_SUFFIX.length,
  );
  return VIOLATED_RULE_PATTERN.test(rule);
}

/** Admission outcome for one writing request, in the vocabulary the surface reports. */
export type GeneralWritingAdmission =
  | Readonly<{ readonly admitted: true }>
  | Readonly<{
      readonly admitted: false;
      readonly errorCode: "general-capability-mismatch" | "general-input-required";
      readonly message: string;
    }>;

/**
 * Decides whether General v1 can attempt a writing request at all, from the structured requirements
 * the Planner recorded — never from words found in the user's prompt.
 *
 * The two codes are kept apart on purpose. A capability mismatch means no input from the user would
 * help, so the surface should offer a different execution path. `general-input-required` means the
 * work is possible the moment the material is pasted in, so the surface should ask for it.
 */
export function admitGeneralWritingRequest(
  requirements: GeneralCapabilityRequest | undefined,
): GeneralWritingAdmission {
  // An attempt with no recorded requirements is a plain text turn, which is what General v1 is for.
  if (requirements === undefined) {
    return ADMITTED;
  }

  const decision = admitGeneralCapability(requirements);
  if (isGeneralCapabilityRejected(decision)) {
    return Object.freeze({
      admitted: false as const,
      errorCode: "general-capability-mismatch" as const,
      message: decision.message,
    });
  }

  // Admission passed on capabilities, but the work still needs material General cannot fetch itself.
  const missing = requirements.inputRequirements.filter(
    (kind) => kind === "file-reference" || kind === "network-reference",
  );
  if (missing.length > 0) {
    return Object.freeze({
      admitted: false as const,
      errorCode: "general-input-required" as const,
      message:
        `General has no file or network access, so it cannot obtain the required ` +
        `${missing.join(", ")} input. Provide the text and retry, or use a different execution path.`,
    });
  }

  return ADMITTED;
}

const ADMITTED: GeneralWritingAdmission = Object.freeze({ admitted: true as const });

/** The system prompt that states the contract up front, so the first reply can already satisfy it. */
export const GENERAL_DRAFT_SYSTEM_PROMPT =
  "You write one reviewable Markdown draft. You have no file, repository, or network access in this " +
  "turn, so write only from the prompt text and never invent file contents. " +
  "Reply with one JSON object and nothing else. " +
  'When you can write the draft: {"status":"completed","markdown":"<the full draft>"}. ' +
  "When the prompt did not give you material you need: " +
  '{"status":"needs-input","missing_inputs":["<what is missing>"],"message":"<what you need>"}. ' +
  "Declare no other keys. Never leave a placeholder to fill in later — if material is missing, say so " +
  "with needs-input instead of writing a draft around the gap.";
