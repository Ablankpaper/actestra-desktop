import { createHash } from "node:crypto";
import { PersistenceError } from "../../core";

export const AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION = 1 as const;
export const AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT = 100;

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_DATA_STRING_LENGTH = 4_096;
const MAX_DELIVERY_BODY_BYTES = 16_384;
const MAX_DATA_DEPTH = 8;
const MAX_DATA_NODES = 256;

export type AionUiApprovalDecision = "approved" | "denied" | "cancelled" | "selected";
export type AionUiApprovalDeliveryState = "pending-delivery" | "delivered";

export interface AionUiApprovalDecisionRequest {
  readonly contractVersion: typeof AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION;
  readonly method: "POST";
  readonly path: string;
  readonly body: {
    readonly msg_id: string;
    readonly data: unknown;
    readonly always_allow?: boolean;
  };
}

export interface NormalizedAionUiApprovalDecision {
  readonly contractVersion: typeof AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION;
  readonly decisionId: string;
  readonly nativeConversationId: string;
  readonly nativeCallId: string;
  readonly nativeMessageId: string;
  readonly nativePath: string;
  readonly requestHash: string;
  readonly decision: AionUiApprovalDecision;
  readonly alwaysAllow: boolean;
  readonly deliveryBody: AionUiApprovalDecisionRequest["body"];
}

export interface AionUiApprovalDecisionRecord extends NormalizedAionUiApprovalDecision {
  readonly deliveryState: AionUiApprovalDeliveryState;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastAttemptAt?: string;
  readonly deliveredAt?: string;
  readonly lastErrorCode?: string;
}

export interface ReserveAionUiApprovalDecisionResult {
  readonly status: "created" | "duplicate";
  readonly record: AionUiApprovalDecisionRecord;
}

export interface AionUiApprovalAuthoritySummary {
  readonly recordCount: number;
  readonly pendingCount: number;
  readonly deliveredCount: number;
}

export interface AionUiApprovalAuthorityPersistencePort {
  reserveAionUiApprovalDecision(
    decision: NormalizedAionUiApprovalDecision,
    now: string,
  ): Promise<ReserveAionUiApprovalDecisionResult>;
  beginAionUiApprovalDelivery(
    decisionId: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord>;
  markAionUiApprovalDelivered(
    decisionId: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord>;
  markAionUiApprovalDeliveryFailed(
    decisionId: string,
    errorCode: string,
    now: string,
  ): Promise<AionUiApprovalDecisionRecord>;
  getAionUiApprovalDecision(decisionId: string): Promise<AionUiApprovalDecisionRecord | undefined>;
  listPendingAionUiApprovalDecisions(
    limit: number,
  ): Promise<readonly AionUiApprovalDecisionRecord[]>;
  summarizeAionUiApprovalAuthority(): Promise<AionUiApprovalAuthoritySummary>;
}

export class AionUiApprovalAuthorityContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AionUiApprovalAuthorityContractError";
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
    throw new AionUiApprovalAuthorityContractError(
      `${label} contains unsupported field ${unexpected}`,
    );
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function assertBoundedIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    throw new AionUiApprovalAuthorityContractError(`${label} is invalid`);
  }
}

function assertJsonValue(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): asserts value is
  | null
  | boolean
  | number
  | string
  | readonly unknown[]
  | Record<string, unknown> {
  state.nodes += 1;
  if (state.nodes > MAX_DATA_NODES || depth > MAX_DATA_DEPTH) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval decision data exceeds the structural limit",
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    if (value.length > MAX_DATA_STRING_LENGTH) {
      throw new AionUiApprovalAuthorityContractError(
        "AionUi approval decision data contains an oversized string",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonValue(entry, state, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval decision data must be JSON-safe",
    );
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      key.length < 1 ||
      key.length > 128 ||
      key === "__proto__" ||
      key === "constructor" ||
      key === "prototype"
    ) {
      throw new AionUiApprovalAuthorityContractError(
        "AionUi approval decision data contains an unsupported key",
      );
    }
    assertJsonValue(entry, state, depth + 1);
  }
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableJsonValue(value[key])]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodedSegment(value: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch (error) {
    throw new AionUiApprovalAuthorityContractError(`${label} is not valid URI encoding`, {
      cause: error,
    });
  }
  assertBoundedIdentifier(decoded, label);
  return decoded;
}

function parseNativePath(path: string): {
  readonly conversationId: string;
  readonly callId: string;
} {
  const match = /^\/api\/conversations\/([^/?#]+)\/confirmations\/([^/?#]+)\/confirm$/u.exec(path);
  if (match === null) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval authority accepts only the native confirmation route",
    );
  }
  return {
    conversationId: decodedSegment(match[1], "AionUi approval conversation identifier"),
    callId: decodedSegment(match[2], "AionUi approval call identifier"),
  };
}

function selectedValue(data: unknown): string | undefined {
  if (typeof data === "string") {
    return data;
  }
  if (isRecord(data) && typeof data.value === "string") {
    return data.value;
  }
  return undefined;
}

function classifyDecision(data: unknown): AionUiApprovalDecision {
  const selected = selectedValue(data)?.toLowerCase();
  if (selected === "cancel") {
    return "cancelled";
  }
  if (
    selected === "deny" ||
    selected === "reject" ||
    selected === "reject_once" ||
    selected === "reject_always"
  ) {
    return "denied";
  }
  if (
    selected === "proceed_once" ||
    selected === "proceed_always" ||
    selected === "proceed_always_server" ||
    selected === "proceed_always_tool" ||
    selected === "allow_once" ||
    selected === "allow_always"
  ) {
    return "approved";
  }
  return "selected";
}

function cloneDeliveryBody(
  body: AionUiApprovalDecisionRequest["body"],
): AionUiApprovalDecisionRequest["body"] {
  return Object.freeze(JSON.parse(JSON.stringify(body)) as AionUiApprovalDecisionRequest["body"]);
}

function decisionIdentifier(conversationId: string, callId: string): string {
  return `actestra-approval-decision-${sha256(`${conversationId}\u0000${callId}`).slice(0, 32)}`;
}

function requestDigest(request: AionUiApprovalDecisionRequest): string {
  return sha256(stableJson(request));
}

function assertInstant(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new AionUiApprovalAuthorityContractError(`${label} must be a canonical instant`);
  }
}

function compareInstants(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

export function normalizeAionUiApprovalDecisionRequest(
  value: unknown,
): NormalizedAionUiApprovalDecision {
  if (!isRecord(value)) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval decision request must be an object",
    );
  }
  assertExactKeys(value, ["contractVersion", "method", "path", "body"], "AionUi approval request");
  if (value.contractVersion !== AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION) {
    throw new AionUiApprovalAuthorityContractError(
      `AionUi approval authority requires contract version ${AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION}`,
    );
  }
  if (value.method !== "POST" || typeof value.path !== "string") {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval authority requires the native POST route",
    );
  }
  const identity = parseNativePath(value.path);
  if (!isRecord(value.body)) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval delivery body must be an object",
    );
  }
  assertExactKeys(value.body, ["msg_id", "data", "always_allow"], "AionUi approval delivery body");
  assertBoundedIdentifier(value.body.msg_id, "AionUi approval message identifier");
  assertJsonValue(value.body.data, { nodes: 0 });
  const alwaysAllow = value.body.always_allow;
  if (alwaysAllow !== undefined && typeof alwaysAllow !== "boolean") {
    throw new AionUiApprovalAuthorityContractError("AionUi approval always_allow must be boolean");
  }
  const normalizedAlwaysAllow = typeof alwaysAllow === "boolean" ? alwaysAllow : undefined;
  const request = Object.freeze({
    contractVersion: AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION,
    method: "POST",
    path: value.path,
    body: cloneDeliveryBody({
      msg_id: value.body.msg_id,
      data: value.body.data,
      ...(normalizedAlwaysAllow === undefined ? {} : { always_allow: normalizedAlwaysAllow }),
    }),
  }) satisfies AionUiApprovalDecisionRequest;
  const encoded = stableJson(request);
  if (Buffer.byteLength(encoded, "utf8") > MAX_DELIVERY_BODY_BYTES) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval delivery body exceeds the byte limit",
    );
  }
  const decision = classifyDecision(request.body.data);
  if (request.body.always_allow === true && decision !== "approved") {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval always_allow requires an explicit allow decision",
    );
  }
  return Object.freeze({
    contractVersion: AIONUI_APPROVAL_AUTHORITY_CONTRACT_VERSION,
    decisionId: decisionIdentifier(identity.conversationId, identity.callId),
    nativeConversationId: identity.conversationId,
    nativeCallId: identity.callId,
    nativeMessageId: request.body.msg_id,
    nativePath: request.path,
    requestHash: requestDigest(request),
    decision,
    alwaysAllow: request.body.always_allow === true,
    deliveryBody: request.body,
  });
}

export function assertNormalizedAionUiApprovalDecision(
  value: unknown,
): asserts value is NormalizedAionUiApprovalDecision {
  if (!isRecord(value)) {
    throw new AionUiApprovalAuthorityContractError(
      "Normalized AionUi approval decision must be an object",
    );
  }
  assertExactKeys(
    value,
    [
      "contractVersion",
      "decisionId",
      "nativeConversationId",
      "nativeCallId",
      "nativeMessageId",
      "nativePath",
      "requestHash",
      "decision",
      "alwaysAllow",
      "deliveryBody",
    ],
    "Normalized AionUi approval decision",
  );
  const normalized = normalizeAionUiApprovalDecisionRequest({
    contractVersion: value.contractVersion,
    method: "POST",
    path: value.nativePath,
    body: value.deliveryBody,
  });
  if (
    value.decisionId !== normalized.decisionId ||
    value.nativeConversationId !== normalized.nativeConversationId ||
    value.nativeCallId !== normalized.nativeCallId ||
    value.nativeMessageId !== normalized.nativeMessageId ||
    value.requestHash !== normalized.requestHash ||
    value.decision !== normalized.decision ||
    value.alwaysAllow !== normalized.alwaysAllow
  ) {
    throw new AionUiApprovalAuthorityContractError(
      "Normalized AionUi approval decision projection does not match its delivery envelope",
    );
  }
}

export function assertAionUiApprovalDecisionRecord(
  value: unknown,
): asserts value is AionUiApprovalDecisionRecord {
  if (!isRecord(value)) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval authority record must be an object",
    );
  }
  assertExactKeys(
    value,
    [
      "contractVersion",
      "decisionId",
      "nativeConversationId",
      "nativeCallId",
      "nativeMessageId",
      "nativePath",
      "requestHash",
      "decision",
      "alwaysAllow",
      "deliveryBody",
      "deliveryState",
      "attemptCount",
      "createdAt",
      "updatedAt",
      "lastAttemptAt",
      "deliveredAt",
      "lastErrorCode",
    ],
    "AionUi approval authority record",
  );
  assertNormalizedAionUiApprovalDecision({
    contractVersion: value.contractVersion,
    decisionId: value.decisionId,
    nativeConversationId: value.nativeConversationId,
    nativeCallId: value.nativeCallId,
    nativeMessageId: value.nativeMessageId,
    nativePath: value.nativePath,
    requestHash: value.requestHash,
    decision: value.decision,
    alwaysAllow: value.alwaysAllow,
    deliveryBody: value.deliveryBody,
  });
  if (value.deliveryState !== "pending-delivery" && value.deliveryState !== "delivered") {
    throw new AionUiApprovalAuthorityContractError("AionUi approval delivery state is unsupported");
  }
  if (!Number.isSafeInteger(value.attemptCount) || (value.attemptCount as number) < 0) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval attempt count must be a non-negative safe integer",
    );
  }
  assertInstant(value.createdAt, "AionUi approval createdAt");
  assertInstant(value.updatedAt, "AionUi approval updatedAt");
  if (compareInstants(value.updatedAt, value.createdAt) < 0) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval authority time cannot move backwards",
    );
  }
  if (value.lastAttemptAt !== undefined) {
    assertInstant(value.lastAttemptAt, "AionUi approval lastAttemptAt");
    if (
      (value.attemptCount as number) < 1 ||
      compareInstants(value.lastAttemptAt, value.createdAt) < 0 ||
      compareInstants(value.updatedAt, value.lastAttemptAt) < 0
    ) {
      throw new AionUiApprovalAuthorityContractError(
        "AionUi approval last attempt metadata is inconsistent",
      );
    }
  } else if (value.attemptCount !== 0) {
    throw new AionUiApprovalAuthorityContractError(
      "AionUi approval attempts require a last-attempt timestamp",
    );
  }
  if (value.deliveryState === "delivered") {
    assertInstant(value.deliveredAt, "AionUi approval deliveredAt");
    if (
      (value.attemptCount as number) < 1 ||
      compareInstants(value.deliveredAt, value.createdAt) < 0 ||
      compareInstants(value.updatedAt, value.deliveredAt) < 0 ||
      value.lastErrorCode !== undefined
    ) {
      throw new AionUiApprovalAuthorityContractError(
        "Delivered AionUi approval metadata is inconsistent",
      );
    }
  } else if (value.deliveredAt !== undefined) {
    throw new AionUiApprovalAuthorityContractError(
      "Pending AionUi approval cannot contain a delivery timestamp",
    );
  }
  if (value.lastErrorCode !== undefined) {
    if (
      typeof value.lastErrorCode !== "string" ||
      value.lastErrorCode.length < 1 ||
      value.lastErrorCode.length > 128 ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value.lastErrorCode) ||
      value.attemptCount === 0
    ) {
      throw new AionUiApprovalAuthorityContractError("AionUi approval last error code is invalid");
    }
  }
}

export function assertAionUiApprovalAuthorityLimit(limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT
  ) {
    throw new PersistenceError(
      "invalid-record",
      `AionUi approval authority limit must be between 1 and ${AIONUI_APPROVAL_AUTHORITY_PENDING_LIMIT}`,
    );
  }
}
