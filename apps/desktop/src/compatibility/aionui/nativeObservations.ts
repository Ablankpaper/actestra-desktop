export const AIONUI_NATIVE_OBSERVATION_CONTRACT_VERSION = 1 as const;
export const AIONUI_NATIVE_SOURCE_VERSION = "2.1.41" as const;

const MAX_OBSERVATIONS_PER_RESPONSE = 50;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_WORKSPACE_KEY_LENGTH = 4_096;
const MAX_WORKSPACE_ENTRY_COUNT = 100_000;

type ConversationStatus = "finished" | "pending" | "running" | "unknown";
type RuntimeState =
  | "cancelling"
  | "failed"
  | "idle"
  | "ready"
  | "running"
  | "starting"
  | "waiting_confirmation";

interface NativeObservationBase<Kind extends string> {
  readonly contractVersion: typeof AIONUI_NATIVE_OBSERVATION_CONTRACT_VERSION;
  readonly kind: Kind;
  readonly nativeId: string;
  readonly observedAtMs: number;
}

export interface AionUiConversationObservation extends NativeObservationBase<"conversation"> {
  readonly conversationId: string;
  readonly conversationType: string;
  readonly status: ConversationStatus;
  readonly runtimeState?: RuntimeState;
  readonly workspaceKey?: string;
  readonly providerKey?: string;
  readonly createdAtMs?: number;
  readonly updatedAtMs?: number;
}

export interface AionUiTaskObservation extends NativeObservationBase<"task"> {
  readonly conversationId: string;
  readonly turnId: string;
  readonly status: "cancelled" | "failed" | "finished" | "pending" | "running";
}

export interface AionUiProviderObservation extends NativeObservationBase<"provider"> {
  readonly providerId: string;
  readonly available: boolean;
  readonly platform?: string;
}

export interface AionUiWorkspaceObservation extends NativeObservationBase<"workspace"> {
  readonly conversationId: string;
  readonly workspaceKey?: string;
  readonly entryCount: number;
}

export interface AionUiApprovalObservation extends NativeObservationBase<"approval"> {
  readonly conversationId: string;
  readonly approvalId: string;
  readonly state: "approved" | "cancelled" | "denied" | "expired" | "pending" | "unknown";
}

export interface AionUiArtifactObservation extends NativeObservationBase<"artifact"> {
  readonly conversationId: string;
  readonly artifactId: string;
  readonly artifactKind: string;
  readonly status: string;
  readonly createdAtMs?: number;
  readonly updatedAtMs?: number;
}

export interface AionUiRuntimeObservation extends NativeObservationBase<"runtime"> {
  readonly conversationId: string;
  readonly runtimeId: string;
  readonly state: RuntimeState;
  readonly failureKind?: string;
}

export type AionUiNativeObservation =
  | AionUiApprovalObservation
  | AionUiArtifactObservation
  | AionUiConversationObservation
  | AionUiProviderObservation
  | AionUiRuntimeObservation
  | AionUiTaskObservation
  | AionUiWorkspaceObservation;

export type AionUiNativeObservationKind = AionUiNativeObservation["kind"];

export class AionUiShadowContractError extends Error {
  constructor(
    readonly code: "invalid-observation" | "unsupported-observation",
    message: string,
  ) {
    super(message);
    this.name = "AionUiShadowContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function boundedString(value: unknown, maximum = MAX_IDENTIFIER_LENGTH): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    return undefined;
  }
  return value;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function timestampMilliseconds(value: unknown): number | undefined {
  const numeric = nonNegativeInteger(value);
  if (numeric === undefined) {
    return undefined;
  }
  return numeric > 0 && numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function frozen<Observation extends AionUiNativeObservation>(
  observation: Observation,
): Observation {
  return Object.freeze(observation);
}

function base<Kind extends AionUiNativeObservationKind>(
  kind: Kind,
  nativeId: string,
  observedAtMs: number,
): NativeObservationBase<Kind> {
  return {
    contractVersion: AIONUI_NATIVE_OBSERVATION_CONTRACT_VERSION,
    kind,
    nativeId,
    observedAtMs,
  };
}

function knownConversationStatus(value: unknown): ConversationStatus {
  return value === "finished" || value === "pending" || value === "running" ? value : "unknown";
}

function knownRuntimeState(value: unknown): RuntimeState | undefined {
  if (
    value === "cancelling" ||
    value === "failed" ||
    value === "idle" ||
    value === "ready" ||
    value === "running" ||
    value === "starting" ||
    value === "waiting_confirmation"
  ) {
    return value;
  }
  return undefined;
}

function conversationObservation(
  value: unknown,
  observedAtMs: number,
): AionUiConversationObservation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const conversationId = boundedString(value.id);
  if (conversationId === undefined) {
    return undefined;
  }
  const extra = optionalRecord(value.extra);
  const model = optionalRecord(value.model);
  const runtime = optionalRecord(value.runtime);
  const conversationType = boundedString(value.type) ?? "unknown";
  const workspaceKey = boundedString(extra?.workspace, MAX_WORKSPACE_KEY_LENGTH);
  const providerKey =
    boundedString(model?.id) ?? boundedString(extra?.backend) ?? boundedString(extra?.agent_name);
  const runtimeState = knownRuntimeState(runtime?.state);
  const createdAtMs = timestampMilliseconds(value.created_at);
  const updatedAtMs = timestampMilliseconds(value.modified_at);

  return frozen({
    ...base("conversation", conversationId, observedAtMs),
    conversationId,
    conversationType,
    status: knownConversationStatus(value.status),
    ...(runtimeState === undefined ? {} : { runtimeState }),
    ...(workspaceKey === undefined ? {} : { workspaceKey }),
    ...(providerKey === undefined ? {} : { providerKey }),
    ...(createdAtMs === undefined ? {} : { createdAtMs }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
  });
}

function providerObservation(
  value: unknown,
  observedAtMs: number,
): AionUiProviderObservation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const providerId = boundedString(value.id);
  if (providerId === undefined) {
    return undefined;
  }
  const platform = boundedString(value.platform);
  return frozen({
    ...base("provider", providerId, observedAtMs),
    providerId,
    available: value.enabled !== false && value.disabled !== true,
    ...(platform === undefined ? {} : { platform }),
  });
}

function approvalObservation(
  value: unknown,
  conversationId: string,
  observedAtMs: number,
): AionUiApprovalObservation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const approvalId = boundedString(value.id) ?? boundedString(value.call_id);
  if (approvalId === undefined) {
    return undefined;
  }
  const rawState = value.state ?? value.status ?? value.decision;
  const state =
    rawState === "approved" ||
    rawState === "cancelled" ||
    rawState === "denied" ||
    rawState === "expired" ||
    rawState === "pending"
      ? rawState
      : "unknown";
  return frozen({
    ...base("approval", approvalId, observedAtMs),
    conversationId,
    approvalId,
    state,
  });
}

function artifactObservation(
  value: unknown,
  conversationId: string,
  observedAtMs: number,
): AionUiArtifactObservation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const artifactId = boundedString(value.id);
  if (artifactId === undefined) {
    return undefined;
  }
  const artifactConversationId = boundedString(value.conversation_id) ?? conversationId;
  const artifactKind = boundedString(value.kind) ?? "other";
  const status = boundedString(value.status) ?? "unknown";
  const createdAtMs = timestampMilliseconds(value.created_at);
  const updatedAtMs = timestampMilliseconds(value.updated_at);
  return frozen({
    ...base("artifact", artifactId, observedAtMs),
    conversationId: artifactConversationId,
    artifactId,
    artifactKind,
    status,
    ...(createdAtMs === undefined ? {} : { createdAtMs }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
  });
}

function runtimeObservation(
  value: unknown,
  conversationId: string,
  observedAtMs: number,
): AionUiRuntimeObservation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const runtime = optionalRecord(value.runtime) ?? value;
  const failureKind = boundedString(runtime.failure_kind);
  const state =
    knownRuntimeState(runtime.state) ??
    knownRuntimeState(runtime.phase) ??
    (failureKind === undefined ? undefined : "failed");
  if (state === undefined) {
    return undefined;
  }
  const runtimeId =
    boundedString(runtime.turn_id) ??
    boundedString(runtime.resource_id) ??
    boundedString(value.turn_id) ??
    conversationId;
  return frozen({
    ...base("runtime", runtimeId, observedAtMs),
    conversationId,
    runtimeId,
    state,
    ...(failureKind === undefined ? {} : { failureKind }),
  });
}

function responseItems(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_OBSERVATIONS_PER_RESPONSE);
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items.slice(0, MAX_OBSERVATIONS_PER_RESPONSE);
  }
  return [];
}

function workspaceEntryCount(value: unknown): number | undefined {
  const entries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : undefined;
  if (entries === undefined || entries.length > MAX_WORKSPACE_ENTRY_COUNT) {
    return undefined;
  }
  return entries.length;
}

function decodedPathSegment(value: string): string | undefined {
  try {
    return boundedString(decodeURIComponent(value));
  } catch {
    return undefined;
  }
}

export function collectAionUiHttpObservations(input: {
  readonly method: string;
  readonly path: string;
  readonly response: unknown;
  readonly observedAtMs?: number;
}): readonly AionUiNativeObservation[] {
  const observedAtMs = nonNegativeInteger(input.observedAtMs ?? Date.now());
  if (observedAtMs === undefined) {
    return Object.freeze([]);
  }

  let url: URL;
  try {
    url = new URL(input.path, "http://actestra.invalid");
  } catch {
    return Object.freeze([]);
  }

  const pathname = url.pathname;
  const observations: AionUiNativeObservation[] = [];
  const add = (observation: AionUiNativeObservation | undefined): void => {
    if (observation !== undefined && observations.length < MAX_OBSERVATIONS_PER_RESPONSE) {
      observations.push(observation);
    }
  };

  if (pathname === "/api/conversations") {
    const items = responseItems(input.response);
    if (items.length > 0) {
      for (const item of items) {
        add(conversationObservation(item, observedAtMs));
      }
    } else {
      add(conversationObservation(input.response, observedAtMs));
    }
  }

  const conversationMatch = /^\/api\/conversations\/([^/]+)$/u.exec(pathname);
  if (conversationMatch !== null) {
    add(conversationObservation(input.response, observedAtMs));
  }

  if (pathname === "/api/providers") {
    const items = responseItems(input.response);
    for (const item of items.length > 0 ? items : [input.response]) {
      add(providerObservation(item, observedAtMs));
    }
  }

  const artifactMatch = /^\/api\/conversations\/([^/]+)\/artifacts(?:\/[^/]+)?$/u.exec(pathname);
  if (artifactMatch !== null) {
    const conversationId = decodedPathSegment(artifactMatch[1]);
    if (conversationId !== undefined) {
      const items = responseItems(input.response);
      for (const item of items.length > 0 ? items : [input.response]) {
        add(artifactObservation(item, conversationId, observedAtMs));
      }
    }
  }

  const confirmationMatch =
    /^\/api\/conversations\/([^/]+)\/confirmations(?:\/[^/]+\/confirm)?$/u.exec(pathname);
  if (confirmationMatch !== null) {
    const conversationId = decodedPathSegment(confirmationMatch[1]);
    if (conversationId !== undefined) {
      const items = responseItems(input.response);
      for (const item of items.length > 0 ? items : [input.response]) {
        add(approvalObservation(item, conversationId, observedAtMs));
      }
    }
  }

  const workspaceMatch = /^\/api\/conversations\/([^/]+)\/workspace$/u.exec(pathname);
  if (workspaceMatch !== null) {
    const conversationId = decodedPathSegment(workspaceMatch[1]);
    const entryCount = workspaceEntryCount(input.response);
    if (conversationId !== undefined && entryCount !== undefined) {
      add(
        frozen({
          ...base("workspace", conversationId, observedAtMs),
          conversationId,
          entryCount,
        }),
      );
    }
  }

  const runtimeMatch =
    /^\/api\/conversations\/([^/]+)\/(?:active-lease|cancel|messages|runtime\/ensure)$/u.exec(
      pathname,
    );
  if (runtimeMatch !== null) {
    const conversationId = decodedPathSegment(runtimeMatch[1]);
    if (conversationId !== undefined) {
      add(runtimeObservation(input.response, conversationId, observedAtMs));
    }
  }

  return Object.freeze(observations);
}

export function collectAionUiWebSocketObservations(input: {
  readonly eventName: string;
  readonly payload: unknown;
  readonly observedAtMs?: number;
}): readonly AionUiNativeObservation[] {
  const observedAtMs = nonNegativeInteger(input.observedAtMs ?? Date.now());
  if (observedAtMs === undefined || !isRecord(input.payload)) {
    return Object.freeze([]);
  }

  const payload = input.payload;
  const observations: AionUiNativeObservation[] = [];
  const add = (observation: AionUiNativeObservation | undefined): void => {
    if (observation !== undefined) {
      observations.push(observation);
    }
  };

  if (input.eventName === "turn.completed") {
    const conversationId =
      boundedString(payload.session_id) ?? boundedString(payload.conversation_id);
    const turnId = boundedString(payload.turn_id);
    if (conversationId !== undefined && turnId !== undefined) {
      const rawStatus = payload.status;
      const rawState = payload.state;
      const status =
        rawState === "error" ||
        rawState === "failed" ||
        rawStatus === "failed" ||
        rawStatus === "error"
          ? "failed"
          : rawState === "stopped" ||
              rawState === "cancelled" ||
              rawState === "canceled" ||
              rawStatus === "cancelled" ||
              rawStatus === "canceled" ||
              rawStatus === "stopped"
            ? "cancelled"
            : rawStatus === "pending" || rawStatus === "running"
              ? rawStatus
              : "finished";
      add(
        frozen({
          ...base("task", turnId, observedAtMs),
          conversationId,
          turnId,
          status,
        }),
      );
      add(runtimeObservation(payload, conversationId, observedAtMs));
    }
  } else if (input.eventName === "conversation.artifact") {
    const conversationId = boundedString(payload.conversation_id);
    if (conversationId !== undefined) {
      add(artifactObservation(payload, conversationId, observedAtMs));
    }
  } else if (input.eventName === "confirmation.add" || input.eventName === "confirmation.update") {
    const conversationId = boundedString(payload.conversation_id);
    if (conversationId !== undefined) {
      add(approvalObservation(payload, conversationId, observedAtMs));
    }
  } else if (input.eventName === "runtime.statusChanged") {
    const scope = optionalRecord(payload.scope);
    if (scope?.kind === "conversation") {
      const conversationId = boundedString(scope.id);
      if (conversationId !== undefined) {
        add(runtimeObservation(payload, conversationId, observedAtMs));
      }
    }
  }

  return Object.freeze(observations);
}

const ALLOWED_KEYS_BY_KIND: Record<AionUiNativeObservationKind, ReadonlySet<string>> = {
  approval: new Set([
    "approvalId",
    "contractVersion",
    "conversationId",
    "kind",
    "nativeId",
    "observedAtMs",
    "state",
  ]),
  artifact: new Set([
    "artifactId",
    "artifactKind",
    "contractVersion",
    "conversationId",
    "createdAtMs",
    "kind",
    "nativeId",
    "observedAtMs",
    "status",
    "updatedAtMs",
  ]),
  conversation: new Set([
    "contractVersion",
    "conversationId",
    "conversationType",
    "createdAtMs",
    "kind",
    "nativeId",
    "observedAtMs",
    "providerKey",
    "runtimeState",
    "status",
    "updatedAtMs",
    "workspaceKey",
  ]),
  provider: new Set([
    "available",
    "contractVersion",
    "kind",
    "nativeId",
    "observedAtMs",
    "platform",
    "providerId",
  ]),
  runtime: new Set([
    "contractVersion",
    "conversationId",
    "failureKind",
    "kind",
    "nativeId",
    "observedAtMs",
    "runtimeId",
    "state",
  ]),
  task: new Set([
    "contractVersion",
    "conversationId",
    "kind",
    "nativeId",
    "observedAtMs",
    "status",
    "turnId",
  ]),
  workspace: new Set([
    "contractVersion",
    "conversationId",
    "entryCount",
    "kind",
    "nativeId",
    "observedAtMs",
    "workspaceKey",
  ]),
};

function requireString(
  record: Record<string, unknown>,
  key: string,
  maximum = MAX_IDENTIFIER_LENGTH,
): string {
  const value = boundedString(record[key], maximum);
  if (value === undefined) {
    throw new AionUiShadowContractError(
      "invalid-observation",
      `AionUi observation ${key} must be a bounded non-empty string`,
    );
  }
  return value;
}

function assertOptionalTimestamp(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  const milliseconds = nonNegativeInteger(value);
  if (
    value !== undefined &&
    (milliseconds === undefined || (milliseconds > 0 && milliseconds < 10_000_000_000))
  ) {
    throw new AionUiShadowContractError(
      "invalid-observation",
      `AionUi observation ${key} must be a normalized millisecond timestamp`,
    );
  }
}

export function assertAionUiNativeObservation(
  value: unknown,
): asserts value is AionUiNativeObservation {
  if (!isRecord(value) || value.contractVersion !== AIONUI_NATIVE_OBSERVATION_CONTRACT_VERSION) {
    throw new AionUiShadowContractError(
      "invalid-observation",
      "AionUi observation must use contract version 1",
    );
  }
  const kind = value.kind;
  if (
    kind !== "approval" &&
    kind !== "artifact" &&
    kind !== "conversation" &&
    kind !== "provider" &&
    kind !== "runtime" &&
    kind !== "task" &&
    kind !== "workspace"
  ) {
    throw new AionUiShadowContractError(
      "unsupported-observation",
      "AionUi observation kind is unsupported",
    );
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS_BY_KIND[kind].has(key)) {
      throw new AionUiShadowContractError(
        "invalid-observation",
        `AionUi ${kind} observation contains undeclared field ${key}`,
      );
    }
  }

  requireString(value, "nativeId");
  if (nonNegativeInteger(value.observedAtMs) === undefined) {
    throw new AionUiShadowContractError(
      "invalid-observation",
      "AionUi observation observedAtMs must be a non-negative integer",
    );
  }

  if (kind === "conversation") {
    requireString(value, "conversationId");
    requireString(value, "conversationType");
    if (
      value.status !== "finished" &&
      value.status !== "pending" &&
      value.status !== "running" &&
      value.status !== "unknown"
    ) {
      throw new AionUiShadowContractError(
        "invalid-observation",
        "AionUi conversation status is invalid",
      );
    }
    if (value.workspaceKey !== undefined) {
      requireString(value, "workspaceKey", MAX_WORKSPACE_KEY_LENGTH);
    }
    if (value.providerKey !== undefined) {
      requireString(value, "providerKey");
    }
    if (value.runtimeState !== undefined && knownRuntimeState(value.runtimeState) === undefined) {
      throw new AionUiShadowContractError(
        "invalid-observation",
        "AionUi conversation runtime state is invalid",
      );
    }
    assertOptionalTimestamp(value, "createdAtMs");
    assertOptionalTimestamp(value, "updatedAtMs");
  } else if (kind === "task") {
    requireString(value, "conversationId");
    requireString(value, "turnId");
    if (
      value.status !== "cancelled" &&
      value.status !== "failed" &&
      value.status !== "finished" &&
      value.status !== "pending" &&
      value.status !== "running"
    ) {
      throw new AionUiShadowContractError("invalid-observation", "AionUi task status is invalid");
    }
  } else if (kind === "provider") {
    requireString(value, "providerId");
    if (typeof value.available !== "boolean") {
      throw new AionUiShadowContractError(
        "invalid-observation",
        "AionUi provider availability must be boolean",
      );
    }
    if (value.platform !== undefined) {
      requireString(value, "platform");
    }
  } else if (kind === "workspace") {
    requireString(value, "conversationId");
    if (
      nonNegativeInteger(value.entryCount) === undefined ||
      (value.entryCount as number) > MAX_WORKSPACE_ENTRY_COUNT
    ) {
      throw new AionUiShadowContractError(
        "invalid-observation",
        `AionUi workspace entry count must be between 0 and ${MAX_WORKSPACE_ENTRY_COUNT}`,
      );
    }
    if (value.workspaceKey !== undefined) {
      requireString(value, "workspaceKey", MAX_WORKSPACE_KEY_LENGTH);
    }
  } else if (kind === "approval") {
    requireString(value, "conversationId");
    requireString(value, "approvalId");
    if (
      value.state !== "approved" &&
      value.state !== "cancelled" &&
      value.state !== "denied" &&
      value.state !== "expired" &&
      value.state !== "pending" &&
      value.state !== "unknown"
    ) {
      throw new AionUiShadowContractError(
        "invalid-observation",
        "AionUi approval state is invalid",
      );
    }
  } else if (kind === "artifact") {
    requireString(value, "conversationId");
    requireString(value, "artifactId");
    requireString(value, "artifactKind");
    requireString(value, "status");
    assertOptionalTimestamp(value, "createdAtMs");
    assertOptionalTimestamp(value, "updatedAtMs");
  } else {
    requireString(value, "conversationId");
    requireString(value, "runtimeId");
    if (knownRuntimeState(value.state) === undefined) {
      throw new AionUiShadowContractError("invalid-observation", "AionUi runtime state is invalid");
    }
    if (value.failureKind !== undefined) {
      requireString(value, "failureKind");
    }
  }
}
