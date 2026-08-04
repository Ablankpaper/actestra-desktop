import {
  artifactId,
  correlationId,
  normalizeTeamPlanCandidate,
  normalizeTeamPlannerRequest,
  taskId,
  teamPlanId,
  teamRunId,
  type ArtifactKind,
  type CorrelationId,
  type TeamArtifactReference,
  type TeamPlanCandidate,
  type TeamPlanId,
  type TeamPlannerRequest,
  type TeamRunId,
} from "../core";

export const TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION = 1 as const;
export const TEAM_PLANNER_SIDECAR_ROLE = "planner" as const;
export const TEAM_PLANNER_SIDECAR_OPERATIONS = ["propose", "aggregate"] as const;
export const TEAM_PLANNER_SIDECAR_ERROR_CODES = [
  "invalid-request",
  "planner-failed",
  "cancelled",
] as const;
export const MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES = 64 * 1024;
export const MAX_TEAM_PLANNER_SIDECAR_REQUEST_ID_BYTES = 128;
export const MAX_TEAM_PLANNER_SIDECAR_ENGINE_TEXT_BYTES = 128;
export const MAX_TEAM_PLANNER_AGGREGATION_SUMMARY_BYTES = 4_096;
export const MAX_TEAM_PLANNER_AGGREGATION_ARTIFACTS = 25;

export type TeamPlannerSidecarOperation = (typeof TEAM_PLANNER_SIDECAR_OPERATIONS)[number];
export type TeamPlannerSidecarErrorCode = (typeof TEAM_PLANNER_SIDECAR_ERROR_CODES)[number];

export type TeamPlannerSidecarProtocolErrorCode =
  | "invalid-message"
  | "incompatible-protocol"
  | "identity-mismatch"
  | "invalid-result";

export class TeamPlannerSidecarProtocolError extends Error {
  constructor(
    readonly code: TeamPlannerSidecarProtocolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamPlannerSidecarProtocolError";
  }
}

export interface TeamPlannerSidecarEngine {
  readonly name: string;
  readonly version: string;
}

export interface TeamPlannerSidecarReady {
  readonly protocolVersion: typeof TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly role: typeof TEAM_PLANNER_SIDECAR_ROLE;
  readonly engine: TeamPlannerSidecarEngine;
}

export interface TeamPlannerAggregatePayload {
  readonly correlationId: CorrelationId;
  readonly planId: TeamPlanId;
  readonly runId: TeamRunId;
  readonly revision: number;
  readonly artifacts: readonly TeamArtifactReference[];
}

export interface TeamPlannerAggregateResult {
  readonly summary: string;
  readonly artifacts: readonly TeamArtifactReference[];
}

interface TeamPlannerSidecarRequestBase {
  readonly protocolVersion: typeof TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION;
  readonly type: "request";
  readonly requestId: string;
}

export interface TeamPlannerSidecarProposeRequest extends TeamPlannerSidecarRequestBase {
  readonly operation: "propose";
  readonly payload: TeamPlannerRequest;
}

export interface TeamPlannerSidecarAggregateRequest extends TeamPlannerSidecarRequestBase {
  readonly operation: "aggregate";
  readonly payload: TeamPlannerAggregatePayload;
}

export type TeamPlannerSidecarRequest =
  | TeamPlannerSidecarProposeRequest
  | TeamPlannerSidecarAggregateRequest;

export interface TeamPlannerSidecarProposeSuccessResponse {
  readonly protocolVersion: typeof TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly status: "ok";
  readonly result: TeamPlanCandidate;
}

export interface TeamPlannerSidecarAggregateSuccessResponse {
  readonly protocolVersion: typeof TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly status: "ok";
  readonly result: TeamPlannerAggregateResult;
}

export interface TeamPlannerSidecarErrorResponse {
  readonly protocolVersion: typeof TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION;
  readonly type: "response";
  readonly requestId: string;
  readonly status: "error";
  readonly code: TeamPlannerSidecarErrorCode;
}

export type TeamPlannerSidecarSuccessResponse =
  | TeamPlannerSidecarProposeSuccessResponse
  | TeamPlannerSidecarAggregateSuccessResponse;
export type TeamPlannerSidecarResponse =
  | TeamPlannerSidecarSuccessResponse
  | TeamPlannerSidecarErrorResponse;

const READY_KEYS = ["protocolVersion", "type", "role", "engine"] as const;
const ENGINE_KEYS = ["name", "version"] as const;
const REQUEST_KEYS = ["protocolVersion", "type", "requestId", "operation", "payload"] as const;
const AGGREGATE_PAYLOAD_KEYS = [
  "correlationId",
  "planId",
  "runId",
  "revision",
  "artifacts",
] as const;
const ARTIFACT_KEYS = ["artifactId", "taskId", "kind"] as const;
const SUCCESS_RESPONSE_KEYS = ["protocolVersion", "type", "requestId", "status", "result"] as const;
const ERROR_RESPONSE_KEYS = ["protocolVersion", "type", "requestId", "status", "code"] as const;
const AGGREGATE_RESULT_KEYS = ["summary", "artifacts"] as const;
const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  "file",
  "document",
  "dataset",
  "directory",
  "other",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159));
  });
}

function isRoundTrippableUtf8(value: string): boolean {
  return new TextDecoder().decode(new TextEncoder().encode(value)) === value;
}

function requireText(value: unknown, label: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    containsControlCharacter(value) ||
    !isRoundTrippableUtf8(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      `${label} must be normalized, unpadded, control-free UTF-8 text of at most ${maximumBytes} bytes`,
    );
  }
  return value;
}

function requireRequestId(value: unknown): string {
  const requestId = requireText(
    value,
    "Team planner request id",
    MAX_TEAM_PLANNER_SIDECAR_REQUEST_ID_BYTES,
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(requestId)) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner request id must be an opaque identifier",
    );
  }
  return requestId;
}

function requireProtocolVersion(value: unknown): void {
  if (value !== TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION) {
    throw new TeamPlannerSidecarProtocolError(
      "incompatible-protocol",
      `Team planner requires protocol version ${TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION}`,
    );
  }
}

function requireMessageSize(value: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner message must be structurally serializable",
    );
  }
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).byteLength > MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES
  ) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      `Team planner message exceeds ${MAX_TEAM_PLANNER_SIDECAR_MESSAGE_BYTES} bytes`,
    );
  }
}

function requireArtifactReferences(value: unknown): readonly TeamArtifactReference[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_TEAM_PLANNER_AGGREGATION_ARTIFACTS
  ) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner aggregation requires a bounded non-empty Artifact reference list",
    );
  }
  const artifacts = value.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ARTIFACT_KEYS) ||
      !ARTIFACT_KINDS.includes(entry.kind as ArtifactKind)
    ) {
      throw new TeamPlannerSidecarProtocolError(
        "invalid-message",
        "Team planner Artifact reference is invalid",
      );
    }
    return Object.freeze({
      artifactId: artifactId(String(entry.artifactId)),
      taskId: taskId(String(entry.taskId)),
      kind: entry.kind as ArtifactKind,
    });
  });
  const keys = artifacts.map(artifactReferenceKey);
  if (new Set(keys).size !== keys.length) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner Artifact references must be unique",
    );
  }
  return Object.freeze(artifacts);
}

function artifactReferenceKey(reference: TeamArtifactReference): string {
  return `${reference.artifactId}\u0000${reference.taskId}\u0000${reference.kind}`;
}

function normalizeAggregatePayload(value: unknown): TeamPlannerAggregatePayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, AGGREGATE_PAYLOAD_KEYS) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1
  ) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner aggregate payload is invalid",
    );
  }
  return Object.freeze({
    correlationId: correlationId(String(value.correlationId)),
    planId: teamPlanId(String(value.planId)),
    runId: teamRunId(String(value.runId)),
    revision: value.revision as number,
    artifacts: requireArtifactReferences(value.artifacts),
  });
}

export function normalizeTeamPlannerSidecarReady(value: unknown): TeamPlannerSidecarReady {
  requireMessageSize(value);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, READY_KEYS) ||
    !isRecord(value.engine) ||
    !hasExactKeys(value.engine, ENGINE_KEYS)
  ) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner ready handshake is invalid",
    );
  }
  requireProtocolVersion(value.protocolVersion);
  if (value.type !== "ready" || value.role !== TEAM_PLANNER_SIDECAR_ROLE) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner ready identity is incompatible",
    );
  }
  return Object.freeze({
    protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
    type: "ready",
    role: TEAM_PLANNER_SIDECAR_ROLE,
    engine: Object.freeze({
      name: requireText(
        value.engine.name,
        "Team planner engine name",
        MAX_TEAM_PLANNER_SIDECAR_ENGINE_TEXT_BYTES,
      ),
      version: requireText(
        value.engine.version,
        "Team planner engine version",
        MAX_TEAM_PLANNER_SIDECAR_ENGINE_TEXT_BYTES,
      ),
    }),
  });
}

export function normalizeTeamPlannerSidecarRequest(value: unknown): TeamPlannerSidecarRequest {
  requireMessageSize(value);
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS)) {
    throw new TeamPlannerSidecarProtocolError("invalid-message", "Team planner request is invalid");
  }
  requireProtocolVersion(value.protocolVersion);
  if (value.type !== "request") {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner request.type must be request",
    );
  }
  const base = {
    protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
    type: "request" as const,
    requestId: requireRequestId(value.requestId),
  };
  if (value.operation === "propose") {
    return Object.freeze({
      ...base,
      operation: "propose",
      payload: normalizeTeamPlannerRequest(value.payload),
    });
  }
  if (value.operation === "aggregate") {
    return Object.freeze({
      ...base,
      operation: "aggregate",
      payload: normalizeAggregatePayload(value.payload),
    });
  }
  throw new TeamPlannerSidecarProtocolError(
    "invalid-message",
    "Team planner request operation is unsupported",
  );
}

function requireResponseBase(
  value: Record<string, unknown>,
  expectedRequest: TeamPlannerSidecarRequest,
): void {
  requireProtocolVersion(value.protocolVersion);
  if (value.type !== "response") {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner response.type must be response",
    );
  }
  const requestId = requireRequestId(value.requestId);
  if (requestId !== expectedRequest.requestId) {
    throw new TeamPlannerSidecarProtocolError(
      "identity-mismatch",
      "Team planner response request identity is invalid",
    );
  }
}

function normalizeAggregateResult(
  value: unknown,
  request: TeamPlannerSidecarAggregateRequest,
): TeamPlannerAggregateResult {
  if (!isRecord(value) || !hasExactKeys(value, AGGREGATE_RESULT_KEYS)) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-result",
      "Team planner aggregate result is invalid",
    );
  }
  const artifacts = requireArtifactReferences(value.artifacts);
  if (
    artifacts.length !== request.payload.artifacts.length ||
    artifacts.some(
      (artifact, index) =>
        artifactReferenceKey(artifact) !== artifactReferenceKey(request.payload.artifacts[index]!),
    )
  ) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-result",
      "Team planner aggregate result must preserve every Artifact reference exactly",
    );
  }
  return Object.freeze({
    summary: requireText(
      value.summary,
      "Team planner aggregate summary",
      MAX_TEAM_PLANNER_AGGREGATION_SUMMARY_BYTES,
    ),
    artifacts,
  });
}

export function normalizeTeamPlannerSidecarResponse(
  value: unknown,
  expectedRequest: TeamPlannerSidecarRequest,
): TeamPlannerSidecarResponse {
  requireMessageSize(value);
  if (!isRecord(value)) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner response is invalid",
    );
  }
  requireResponseBase(value, expectedRequest);
  if (value.status === "error") {
    if (
      !hasExactKeys(value, ERROR_RESPONSE_KEYS) ||
      !TEAM_PLANNER_SIDECAR_ERROR_CODES.includes(value.code as TeamPlannerSidecarErrorCode)
    ) {
      throw new TeamPlannerSidecarProtocolError(
        "invalid-message",
        "Team planner error response is invalid",
      );
    }
    return Object.freeze({
      protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
      type: "response",
      requestId: expectedRequest.requestId,
      status: "error",
      code: value.code as TeamPlannerSidecarErrorCode,
    });
  }
  if (value.status !== "ok" || !hasExactKeys(value, SUCCESS_RESPONSE_KEYS)) {
    throw new TeamPlannerSidecarProtocolError(
      "invalid-message",
      "Team planner success response is invalid",
    );
  }
  if (expectedRequest.operation === "propose") {
    const result = normalizeTeamPlanCandidate(value.result);
    if (
      result.correlationId !== expectedRequest.payload.correlationId ||
      result.planVersion !== expectedRequest.payload.planVersion
    ) {
      throw new TeamPlannerSidecarProtocolError(
        "identity-mismatch",
        "Team planner candidate identity is invalid",
      );
    }
    return Object.freeze({
      protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
      type: "response",
      requestId: expectedRequest.requestId,
      status: "ok",
      result,
    });
  }
  return Object.freeze({
    protocolVersion: TEAM_PLANNER_SIDECAR_PROTOCOL_VERSION,
    type: "response",
    requestId: expectedRequest.requestId,
    status: "ok",
    result: normalizeAggregateResult(value.result, expectedRequest),
  });
}
