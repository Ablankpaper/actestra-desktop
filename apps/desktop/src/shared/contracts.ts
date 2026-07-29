export const APP_INFO_CHANNEL = "actestra:app-info";
export const PLATFORM_SNAPSHOT_CHANNEL = "actestra:platform-snapshot";
export const RENDERER_READY_CHANNEL = "actestra:renderer-ready";
export const PLATFORM_SNAPSHOT_CONTRACT_VERSION = 2 as const;

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly dataLayoutVersion: number;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly environment: "development" | "packaged";
  readonly networkPolicy: "offline-shell";
}

export const PLATFORM_PROJECTION_STATES = [
  "completed",
  "failed",
  "cancelled",
  "crashed",
  "timed-out",
  "protocol-failed",
] as const;

export type PlatformProjectionState = (typeof PLATFORM_PROJECTION_STATES)[number];

export interface PlatformAttemptProjection {
  readonly sessionId: string;
  readonly workerId: string;
  readonly state: PlatformProjectionState;
  readonly taskState?:
    | "draft"
    | "ready"
    | "running"
    | "blocked"
    | "completed"
    | "failed"
    | "cancelled";
  readonly lastCoreEventSequence: number;
  readonly forcedCancellation: boolean;
  readonly incidentCode?: string;
}

export interface PlatformSnapshot {
  readonly contractVersion: typeof PLATFORM_SNAPSHOT_CONTRACT_VERSION;
  readonly authority: "main-only";
  readonly privilegedServices: "scoped-native-active";
  readonly policy: "deny-by-default";
  readonly credentials: "opaque-references-only";
  readonly tools: "workspace-read-task-output-create";
  readonly audit: {
    readonly durability: "sqlite-metadata-only";
    readonly recordCount: number;
    readonly lastSequence: number;
  };
  readonly attempts: readonly PlatformAttemptProjection[];
}

export interface ActestraBridge {
  getAppInfo(): Promise<AppInfo>;
  getPlatformSnapshot(): Promise<PlatformSnapshot>;
  notifyRendererReady(): void;
}

export type DesktopContractErrorCode = "invalid-response";

export class DesktopContractError extends Error {
  constructor(
    readonly code: DesktopContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DesktopContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DesktopContractError("invalid-response", `${label} must be an object`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new DesktopContractError(
      "invalid-response",
      `${label} contains unsupported field ${unexpected}`,
    );
  }
}

function assertText(value: unknown, label: string, maximumLength = 128): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    [...value].some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point <= 31 || (point >= 127 && point <= 159));
    })
  ) {
    throw new DesktopContractError(
      "invalid-response",
      `${label} must be unpadded control-free text`,
    );
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DesktopContractError(
      "invalid-response",
      `${label} must be a non-negative safe integer`,
    );
  }
}

export function assertAppInfo(value: unknown): asserts value is AppInfo {
  assertRecord(value, "Application metadata");
  assertExactKeys(
    value,
    ["name", "version", "dataLayoutVersion", "platform", "arch", "environment", "networkPolicy"],
    "Application metadata",
  );
  assertText(value.name, "Application metadata.name");
  assertText(value.version, "Application metadata.version");
  if (!Number.isSafeInteger(value.dataLayoutVersion) || (value.dataLayoutVersion as number) < 1) {
    throw new DesktopContractError(
      "invalid-response",
      "Application metadata.dataLayoutVersion must be positive",
    );
  }
  assertText(value.platform, "Application metadata.platform", 32);
  assertText(value.arch, "Application metadata.arch", 32);
  if (value.environment !== "development" && value.environment !== "packaged") {
    throw new DesktopContractError(
      "invalid-response",
      "Application metadata.environment is unsupported",
    );
  }
  if (value.networkPolicy !== "offline-shell") {
    throw new DesktopContractError(
      "invalid-response",
      "Application metadata.networkPolicy is unsupported",
    );
  }
}

const TASK_STATES = [
  "draft",
  "ready",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
] as const;

function assertAttemptProjection(value: unknown): asserts value is PlatformAttemptProjection {
  assertRecord(value, "Platform attempt projection");
  assertExactKeys(
    value,
    [
      "sessionId",
      "workerId",
      "state",
      "taskState",
      "lastCoreEventSequence",
      "forcedCancellation",
      "incidentCode",
    ],
    "Platform attempt projection",
  );
  assertText(value.sessionId, "Platform attempt projection.sessionId");
  assertText(value.workerId, "Platform attempt projection.workerId");
  if (
    typeof value.state !== "string" ||
    !PLATFORM_PROJECTION_STATES.includes(value.state as PlatformProjectionState)
  ) {
    throw new DesktopContractError(
      "invalid-response",
      "Platform attempt projection.state is unsupported",
    );
  }
  if (
    value.taskState !== undefined &&
    (typeof value.taskState !== "string" ||
      !TASK_STATES.includes(value.taskState as (typeof TASK_STATES)[number]))
  ) {
    throw new DesktopContractError(
      "invalid-response",
      "Platform attempt projection.taskState is unsupported",
    );
  }
  assertNonNegativeSafeInteger(
    value.lastCoreEventSequence,
    "Platform attempt projection.lastCoreEventSequence",
  );
  if (typeof value.forcedCancellation !== "boolean") {
    throw new DesktopContractError(
      "invalid-response",
      "Platform attempt projection.forcedCancellation must be boolean",
    );
  }
  if (value.incidentCode !== undefined) {
    assertText(value.incidentCode, "Platform attempt projection.incidentCode");
  }
}

export function assertPlatformSnapshot(value: unknown): asserts value is PlatformSnapshot {
  assertRecord(value, "Platform snapshot");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "authority",
      "privilegedServices",
      "policy",
      "credentials",
      "tools",
      "audit",
      "attempts",
    ],
    "Platform snapshot",
  );
  if (value.contractVersion !== PLATFORM_SNAPSHOT_CONTRACT_VERSION) {
    throw new DesktopContractError(
      "invalid-response",
      `Platform snapshot requires contract version ${PLATFORM_SNAPSHOT_CONTRACT_VERSION}`,
    );
  }
  if (
    value.authority !== "main-only" ||
    value.privilegedServices !== "scoped-native-active" ||
    value.policy !== "deny-by-default" ||
    value.credentials !== "opaque-references-only" ||
    value.tools !== "workspace-read-task-output-create"
  ) {
    throw new DesktopContractError("invalid-response", "Platform snapshot boundary is unsupported");
  }

  assertRecord(value.audit, "Platform snapshot.audit");
  assertExactKeys(
    value.audit,
    ["durability", "recordCount", "lastSequence"],
    "Platform snapshot.audit",
  );
  if (value.audit.durability !== "sqlite-metadata-only") {
    throw new DesktopContractError(
      "invalid-response",
      "Platform snapshot.audit durability is unsupported",
    );
  }
  assertNonNegativeSafeInteger(value.audit.recordCount, "Platform snapshot.audit.recordCount");
  assertNonNegativeSafeInteger(value.audit.lastSequence, "Platform snapshot.audit.lastSequence");
  if (value.audit.recordCount !== value.audit.lastSequence) {
    throw new DesktopContractError(
      "invalid-response",
      "Platform snapshot audit count and sequence must be gapless",
    );
  }

  if (!Array.isArray(value.attempts)) {
    throw new DesktopContractError(
      "invalid-response",
      "Platform snapshot.attempts must be an array",
    );
  }
  if (value.attempts.length > 50) {
    throw new DesktopContractError(
      "invalid-response",
      "Platform snapshot.attempts must contain at most 50 records",
    );
  }
  const sessionIds: string[] = [];
  for (const attempt of value.attempts) {
    assertAttemptProjection(attempt);
    sessionIds.push(attempt.sessionId);
  }
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new DesktopContractError("invalid-response", "Platform snapshot cannot repeat a session");
  }
}
