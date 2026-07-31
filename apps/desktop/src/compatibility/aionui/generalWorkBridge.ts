import { artifactId, taskId } from "../../core/domain";
import {
  OFFICE_DOCUMENT_PREVIEW_MEDIA_TYPE,
  assertOfficeDocumentModel,
  type OfficeDocumentModel,
} from "../../core";
import { MAX_WORKLOAD_CONTENT_BYTES } from "../../core/workloadContent";
import {
  AIONUI_GENERAL_WORK_CONTRACT_VERSION,
  AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION,
  assertAionUiNativeConversationId,
  assertAionUiGeneralWorkProjection,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkProjection,
} from "./generalWorkJourney";

export type { AionUiGeneralWorkIntent } from "./generalWorkJourney";

export const ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL = "actestra:general-work:submit" as const;
export const ACTESTRA_GENERAL_WORK_LIST_CHANNEL = "actestra:general-work:list" as const;
export const ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL = "actestra:general-work:cancel" as const;
export const ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL = "actestra:general-work:preview" as const;

const LIST_REQUEST_KEYS = ["contractVersion", "nativeConversationId", "limit"] as const;
const CANCEL_REQUEST_KEYS = [
  "contractVersion",
  "nativeConversationId",
  "taskId",
  "reason",
] as const;
const PREVIEW_REQUEST_KEYS = [
  "contractVersion",
  "nativeConversationId",
  "taskId",
  "artifactId",
] as const;
const TEXT_PREVIEW_KEYS = [
  "contractVersion",
  "taskId",
  "artifactId",
  "label",
  "mediaType",
  "content",
] as const;
const OFFICE_DOCUMENT_PREVIEW_KEYS = [
  "contractVersion",
  "taskId",
  "artifactId",
  "label",
  "mediaType",
  "document",
] as const;
const BRIDGE_REJECTION_CODES = [
  "invalid-request",
  "persistence-unavailable",
  "task-not-owned",
  "task-conflict",
  "execution-failed",
] as const;

export type AionUiGeneralWorkBridgeRejectionCode = (typeof BRIDGE_REJECTION_CODES)[number];

export interface AionUiGeneralWorkListRequest {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly limit: number;
}

export interface AionUiGeneralWorkCancelRequest {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly taskId: string;
  readonly reason?: string;
}

export interface AionUiGeneralWorkPreviewRequest {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly nativeConversationId: string;
  readonly taskId: string;
  readonly artifactId: string;
}

interface AionUiGeneralWorkArtifactPreviewBase {
  readonly contractVersion: typeof AIONUI_GENERAL_WORK_CONTRACT_VERSION;
  readonly taskId: string;
  readonly artifactId: string;
  readonly label: string;
}

export interface AionUiGeneralWorkTextArtifactPreview extends AionUiGeneralWorkArtifactPreviewBase {
  readonly mediaType: "text/plain; charset=utf-8" | "text/markdown; charset=utf-8";
  readonly content: string;
}

export interface AionUiGeneralWorkOfficeDocumentArtifactPreview extends AionUiGeneralWorkArtifactPreviewBase {
  readonly mediaType: typeof OFFICE_DOCUMENT_PREVIEW_MEDIA_TYPE;
  readonly document: OfficeDocumentModel;
}

export type AionUiGeneralWorkArtifactPreview =
  | AionUiGeneralWorkTextArtifactPreview
  | AionUiGeneralWorkOfficeDocumentArtifactPreview;

export type AionUiGeneralWorkBridgeResult =
  | {
      readonly status: "ok";
      readonly projection: AionUiGeneralWorkProjection;
    }
  | {
      readonly status: "ok";
      readonly projections: readonly AionUiGeneralWorkProjection[];
    }
  | {
      readonly status: "ok";
      readonly preview: AionUiGeneralWorkArtifactPreview;
    }
  | {
      readonly status: "rejected";
      readonly code: AionUiGeneralWorkBridgeRejectionCode;
    };

export interface AionUiGeneralWorkBridgeApi {
  submit(intent: AionUiGeneralWorkIntent): Promise<AionUiGeneralWorkBridgeResult>;
  list(request: AionUiGeneralWorkListRequest): Promise<AionUiGeneralWorkBridgeResult>;
  cancel(request: AionUiGeneralWorkCancelRequest): Promise<AionUiGeneralWorkBridgeResult>;
  preview(request: AionUiGeneralWorkPreviewRequest): Promise<AionUiGeneralWorkBridgeResult>;
}

declare global {
  interface Window {
    actestraGeneralWork?: AionUiGeneralWorkBridgeApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new Error(`${label} contains unsupported field ${unexpected}`);
  }
}

function assertConversationIdentity(value: unknown): asserts value is string {
  assertAionUiNativeConversationId(value);
}

function assertBoundedReason(value: unknown): asserts value is string | undefined {
  if (value === undefined) {
    return;
  }
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > 512 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
    })
  ) {
    throw new Error("AionUI general-work cancellation reason is invalid");
  }
}

export function assertAionUiGeneralWorkListRequest(
  value: unknown,
): asserts value is AionUiGeneralWorkListRequest {
  if (!isRecord(value)) {
    throw new Error("AionUI general-work list request must be an object");
  }
  assertExactKeys(value, LIST_REQUEST_KEYS, "AionUI general-work list request");
  if (
    value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    !Number.isSafeInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
  ) {
    throw new Error("AionUI general-work list request is invalid");
  }
  assertConversationIdentity(value.nativeConversationId);
}

export function assertAionUiGeneralWorkCancelRequest(
  value: unknown,
): asserts value is AionUiGeneralWorkCancelRequest {
  if (!isRecord(value)) {
    throw new Error("AionUI general-work cancel request must be an object");
  }
  assertExactKeys(value, CANCEL_REQUEST_KEYS, "AionUI general-work cancel request");
  if (
    value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    typeof value.taskId !== "string"
  ) {
    throw new Error("AionUI general-work cancel request is invalid");
  }
  assertConversationIdentity(value.nativeConversationId);
  taskId(value.taskId);
  assertBoundedReason(value.reason);
}

export function assertAionUiGeneralWorkPreviewRequest(
  value: unknown,
): asserts value is AionUiGeneralWorkPreviewRequest {
  if (!isRecord(value)) {
    throw new Error("AionUI general-work preview request must be an object");
  }
  assertExactKeys(value, PREVIEW_REQUEST_KEYS, "AionUI general-work preview request");
  if (
    value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    typeof value.taskId !== "string" ||
    typeof value.artifactId !== "string"
  ) {
    throw new Error("AionUI general-work preview request is invalid");
  }
  assertConversationIdentity(value.nativeConversationId);
  taskId(value.taskId);
  artifactId(value.artifactId);
}

export function assertAionUiGeneralWorkArtifactPreview(
  value: unknown,
): asserts value is AionUiGeneralWorkArtifactPreview {
  if (!isRecord(value)) {
    throw new Error("AionUI general-work artifact preview must be an object");
  }
  if (
    value.contractVersion !== AIONUI_GENERAL_WORK_CONTRACT_VERSION ||
    typeof value.taskId !== "string" ||
    typeof value.artifactId !== "string" ||
    typeof value.label !== "string" ||
    value.label.trim().length === 0 ||
    new TextEncoder().encode(value.label).byteLength > 512 ||
    typeof value.mediaType !== "string"
  ) {
    throw new Error("AionUI general-work artifact preview is invalid");
  }
  taskId(value.taskId);
  artifactId(value.artifactId);
  if (value.mediaType === OFFICE_DOCUMENT_PREVIEW_MEDIA_TYPE) {
    assertExactKeys(value, OFFICE_DOCUMENT_PREVIEW_KEYS, "AionUI Office-document artifact preview");
    try {
      assertOfficeDocumentModel(value.document);
    } catch (error) {
      throw new Error("AionUI Office-document artifact preview is invalid", { cause: error });
    }
    return;
  }
  assertExactKeys(value, TEXT_PREVIEW_KEYS, "AionUI text artifact preview");
  if (
    (value.mediaType !== "text/plain; charset=utf-8" &&
      value.mediaType !== "text/markdown; charset=utf-8") ||
    typeof value.content !== "string" ||
    new TextEncoder().encode(value.content).byteLength > MAX_WORKLOAD_CONTENT_BYTES
  ) {
    throw new Error("AionUI general-work artifact preview is invalid");
  }
}

export function assertAionUiGeneralWorkBridgeResult(
  value: unknown,
): asserts value is AionUiGeneralWorkBridgeResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new Error("AionUI general-work bridge result must be an object");
  }
  if (value.status === "rejected") {
    assertExactKeys(value, ["status", "code"], "AionUI general-work bridge rejection");
    if (
      typeof value.code !== "string" ||
      !BRIDGE_REJECTION_CODES.includes(value.code as AionUiGeneralWorkBridgeRejectionCode)
    ) {
      throw new Error("AionUI general-work bridge rejection code is invalid");
    }
    return;
  }
  if (value.status !== "ok") {
    throw new Error("AionUI general-work bridge result status is invalid");
  }
  if (Object.hasOwn(value, "projection") && !Object.hasOwn(value, "projections")) {
    assertExactKeys(value, ["status", "projection"], "AionUI general-work submit result");
    assertAionUiGeneralWorkProjection(value.projection);
    return;
  }
  if (Object.hasOwn(value, "projections") && !Object.hasOwn(value, "projection")) {
    if (Object.hasOwn(value, "preview")) {
      throw new Error("AionUI general-work bridge success has an ambiguous payload");
    }
    assertExactKeys(value, ["status", "projections"], "AionUI general-work list result");
    if (
      !Array.isArray(value.projections) ||
      value.projections.length > AIONUI_GENERAL_WORK_MAX_JOURNEYS_PER_CONVERSATION
    ) {
      throw new Error("AionUI general-work projection list is invalid");
    }
    value.projections.forEach(assertAionUiGeneralWorkProjection);
    return;
  }
  if (
    Object.hasOwn(value, "preview") &&
    !Object.hasOwn(value, "projection") &&
    !Object.hasOwn(value, "projections")
  ) {
    assertExactKeys(value, ["status", "preview"], "AionUI general-work preview result");
    assertAionUiGeneralWorkArtifactPreview(value.preview);
    return;
  }
  throw new Error("AionUI general-work bridge success has an ambiguous payload");
}
