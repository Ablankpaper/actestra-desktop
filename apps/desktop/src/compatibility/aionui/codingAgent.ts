export const AIONUI_CODING_AGENT_CONTRACT_VERSION = 1 as const;
export const ACTESTRA_GOOSE_MANAGED_AGENT_ID = "actestra-goose" as const;
export const ACTESTRA_GOOSE_MANAGED_AGENT_NAME = "Goose coding" as const;
export const ACTESTRA_GOOSE_RUNNER_VERSION = "1.45.0" as const;

export const ACTESTRA_CODING_AGENT_STATUS_CHANNEL = "actestra:coding-agent:status" as const;
export const ACTESTRA_CODING_AGENT_PROBE_CHANNEL = "actestra:coding-agent:probe" as const;

const REQUEST_KEYS = ["contractVersion"] as const;
const READY_PROJECTION_KEYS = [
  "contractVersion",
  "agentId",
  "displayName",
  "status",
  "runnerVersion",
] as const;
const UNAVAILABLE_PROJECTION_KEYS = [
  "contractVersion",
  "agentId",
  "displayName",
  "status",
  "reason",
] as const;

export const AIONUI_CODING_AGENT_UNAVAILABLE_REASONS = [
  "main-unavailable",
  "runner-not-configured",
  "runner-missing",
  "runner-incompatible",
  "runner-admission-failed",
] as const;

export type AionUiCodingAgentUnavailableReason =
  (typeof AIONUI_CODING_AGENT_UNAVAILABLE_REASONS)[number];

export interface AionUiCodingAgentRequest {
  readonly contractVersion: typeof AIONUI_CODING_AGENT_CONTRACT_VERSION;
}

export interface AionUiCodingAgentReadyProjection {
  readonly contractVersion: typeof AIONUI_CODING_AGENT_CONTRACT_VERSION;
  readonly agentId: typeof ACTESTRA_GOOSE_MANAGED_AGENT_ID;
  readonly displayName: typeof ACTESTRA_GOOSE_MANAGED_AGENT_NAME;
  readonly status: "ready";
  readonly runnerVersion: typeof ACTESTRA_GOOSE_RUNNER_VERSION;
}

export interface AionUiCodingAgentUnavailableProjection {
  readonly contractVersion: typeof AIONUI_CODING_AGENT_CONTRACT_VERSION;
  readonly agentId: typeof ACTESTRA_GOOSE_MANAGED_AGENT_ID;
  readonly displayName: typeof ACTESTRA_GOOSE_MANAGED_AGENT_NAME;
  readonly status: "missing" | "incompatible" | "unavailable";
  readonly reason: AionUiCodingAgentUnavailableReason;
}

export type AionUiCodingAgentProjection =
  | AionUiCodingAgentReadyProjection
  | AionUiCodingAgentUnavailableProjection;

export interface AionUiCodingAgentBridgeApi {
  status(request: AionUiCodingAgentRequest): Promise<AionUiCodingAgentProjection>;
  probe(request: AionUiCodingAgentRequest): Promise<AionUiCodingAgentProjection>;
}

declare global {
  interface Window {
    actestraCodingAgent?: AionUiCodingAgentBridgeApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function assertAionUiCodingAgentRequest(
  value: unknown,
): asserts value is AionUiCodingAgentRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, REQUEST_KEYS) ||
    value.contractVersion !== AIONUI_CODING_AGENT_CONTRACT_VERSION
  ) {
    throw new Error("AionUI coding-agent request is invalid");
  }
}

function hasMatchingUnavailableReason(
  status: AionUiCodingAgentUnavailableProjection["status"],
  reason: unknown,
): reason is AionUiCodingAgentUnavailableReason {
  if (!AIONUI_CODING_AGENT_UNAVAILABLE_REASONS.includes(reason as never)) {
    return false;
  }
  if (status === "missing") {
    return reason === "runner-not-configured" || reason === "runner-missing";
  }
  if (status === "incompatible") {
    return reason === "runner-incompatible" || reason === "runner-admission-failed";
  }
  return reason === "main-unavailable";
}

export function assertAionUiCodingAgentProjection(
  value: unknown,
): asserts value is AionUiCodingAgentProjection {
  if (
    !isRecord(value) ||
    value.contractVersion !== AIONUI_CODING_AGENT_CONTRACT_VERSION ||
    value.agentId !== ACTESTRA_GOOSE_MANAGED_AGENT_ID ||
    value.displayName !== ACTESTRA_GOOSE_MANAGED_AGENT_NAME
  ) {
    throw new Error("AionUI coding-agent projection is invalid");
  }
  if (value.status === "ready") {
    if (
      !hasExactKeys(value, READY_PROJECTION_KEYS) ||
      value.runnerVersion !== ACTESTRA_GOOSE_RUNNER_VERSION
    ) {
      throw new Error("AionUI coding-agent ready projection is invalid");
    }
    return;
  }
  if (
    (value.status !== "missing" &&
      value.status !== "incompatible" &&
      value.status !== "unavailable") ||
    !hasExactKeys(value, UNAVAILABLE_PROJECTION_KEYS) ||
    !hasMatchingUnavailableReason(value.status, value.reason)
  ) {
    throw new Error("AionUI coding-agent unavailable projection is invalid");
  }
}
