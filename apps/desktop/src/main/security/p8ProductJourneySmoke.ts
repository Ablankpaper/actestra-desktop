import fs from "node:fs";
import path from "node:path";

export const P8_PRODUCT_JOURNEY_RESULT_FILE_NAME = "p8-product-journeys-result.json" as const;
export const P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME = "p8-product-journeys-failure.json" as const;
export const P8_PRODUCT_JOURNEY_RESTART_JOURNAL_FILE_NAME =
  "p8-product-journeys-restart.json" as const;

export const P8_PRODUCT_JOURNEY_IDS = Object.freeze([
  "fresh-profile-launch",
  "general-artifact",
  "goose-isolated-patch",
  "workspace-apply-approval",
  "general-goose-team",
  "cancellation-no-orphan",
  "crash-restart-recovery",
  "privacy-redaction",
  "p7-platform-obligations",
] as const);

export type P8ProductJourneyId = (typeof P8_PRODUCT_JOURNEY_IDS)[number];
export type P8ProductJourneyStatus = "verified";
export type P8ProductJourneyRuntimeDiagnosticStage =
  | "model-binding"
  | "user-data"
  | "runner-package"
  | "runner-admission"
  | "git-executable"
  | "private-root"
  | "runtime-startup"
  | "persistence"
  | "general-work"
  | "coding-journey"
  | "coding-artifact"
  | "isolated-coding"
  | "team-composition"
  | "general-recovery"
  | "schedule-recovery"
  | "team-recovery";
export type P8ProductJourneyInnerDiagnosticStage =
  | "coding-submit"
  | "coding-projection"
  | "coding-tool-approval"
  | "coding-publish-approval"
  | "coding-artifact-preview"
  | "coding-durable-state"
  | "coding-cleanup"
  | "crash-restart-prepare-submit"
  | "crash-restart-prepare-checkpoint"
  | "crash-restart-prepare-journal"
  | "crash-restart-recovery-load"
  | "crash-restart-recovery-verify"
  | "crash-restart-recovery-duplicate"
  | "crash-restart-recovery-journal"
  | "destination-workspace-authority"
  | "destination-workspace-canonical"
  | "destination-workspace-grant-read"
  | "destination-workspace-graph-read"
  | "destination-workspace-graph-assert"
  | "destination-workspace-graph-write"
  | "destination-workspace-grant-write"
  | "destination-workspace-grant-check";
export type P8ProductJourneyFailureStage =
  | "startup-recovery"
  | P8ProductJourneyId
  | P8ProductJourneyRuntimeDiagnosticStage
  | P8ProductJourneyInnerDiagnosticStage;

export type P8ProductJourneyObservation = Readonly<{
  id: P8ProductJourneyId;
  status: P8ProductJourneyStatus;
  residualProcessCount: 0;
}>;

export type P8ProductJourneyResult = Readonly<{
  schemaVersion: 1;
  status: "verified";
  journeys: readonly P8ProductJourneyObservation[];
}>;

export type P8ProductJourneyFailure = Readonly<{
  code: P8ProductJourneySmokeErrorCode;
  stage: P8ProductJourneyFailureStage;
}>;

export type P8ProductJourneyRestartJournal = Readonly<{
  schemaVersion: 1;
  journey: "crash-restart-recovery";
  phase: "active-checkpoint" | "recovered";
  restartCount: 0 | 1;
}>;

export type P8ProductJourneySmokeEnvironment = Readonly<{
  root: string;
  userData: string;
  home: string;
  temp: string;
  workspace: string;
  resultPath: string;
  timeoutMs: number;
}>;

export type P8ProductJourneyCleanupResult = Readonly<{
  residualProcessCount: number;
}>;

export interface P8ProductJourneyRunContext {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly appIsPackaged: boolean;
  readonly executeJourney: (
    id: P8ProductJourneyId,
    signal: AbortSignal,
  ) => Promise<P8ProductJourneyObservation>;
  readonly cleanup: (signal: AbortSignal) => Promise<P8ProductJourneyCleanupResult>;
  readonly writeResult?: (result: P8ProductJourneyResult) => void | Promise<void>;
  readonly signal?: AbortSignal;
}

export type P8ProductJourneySmokeErrorCode =
  | "invalid-environment"
  | "journey-failed"
  | "journey-timeout"
  | "cleanup-failed"
  | "residual-processes"
  | "privacy-redaction-failed"
  | "result-write-failed";

const MINIMUM_TIMEOUT_MS = 1_000;
const MAXIMUM_TIMEOUT_MS = 300_000;
const RESULT_KEYS = Object.freeze(["schemaVersion", "status", "journeys"] as const);
const FAILURE_KEYS = Object.freeze(["code", "stage"] as const);
const JOURNEY_KEYS = Object.freeze(["id", "status", "residualProcessCount"] as const);
const RESTART_JOURNAL_KEYS = Object.freeze([
  "schemaVersion",
  "journey",
  "phase",
  "restartCount",
] as const);
const CLOSED_ERROR_CODES = new Set<P8ProductJourneySmokeErrorCode>([
  "invalid-environment",
  "journey-failed",
  "journey-timeout",
  "cleanup-failed",
  "residual-processes",
  "privacy-redaction-failed",
  "result-write-failed",
]);
const FORBIDDEN_KEY =
  /^(?:credential|secret|token|password|privatepath|rawpayload|workerpid|processid)$/iu;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/iu;
const UNC_ABSOLUTE_PATH = /^\\\\[^\\]/u;
const FAILURE_STAGES = new Set<P8ProductJourneyFailureStage>([
  "startup-recovery",
  ...P8_PRODUCT_JOURNEY_IDS,
  "model-binding",
  "user-data",
  "runner-package",
  "runner-admission",
  "git-executable",
  "private-root",
  "runtime-startup",
  "persistence",
  "general-work",
  "coding-journey",
  "coding-artifact",
  "isolated-coding",
  "team-composition",
  "general-recovery",
  "schedule-recovery",
  "team-recovery",
  "coding-submit",
  "coding-projection",
  "coding-tool-approval",
  "coding-publish-approval",
  "coding-artifact-preview",
  "coding-durable-state",
  "coding-cleanup",
  "crash-restart-prepare-submit",
  "crash-restart-prepare-checkpoint",
  "crash-restart-prepare-journal",
  "crash-restart-recovery-load",
  "crash-restart-recovery-verify",
  "crash-restart-recovery-duplicate",
  "crash-restart-recovery-journal",
  "destination-workspace-authority",
  "destination-workspace-canonical",
  "destination-workspace-grant-read",
  "destination-workspace-graph-read",
  "destination-workspace-graph-assert",
  "destination-workspace-graph-write",
  "destination-workspace-grant-write",
  "destination-workspace-grant-check",
]);
const P8_PRODUCT_JOURNEY_RUNTIME_DIAGNOSTIC_STAGES: ReadonlySet<P8ProductJourneyFailureStage> =
  new Set([
    "model-binding",
    "user-data",
    "runner-package",
    "runner-admission",
    "git-executable",
    "private-root",
    "runtime-startup",
    "persistence",
    "general-work",
    "coding-journey",
    "coding-artifact",
    "isolated-coding",
    "team-composition",
    "general-recovery",
    "schedule-recovery",
    "team-recovery",
  ]);

/**
 * The trusted runtime startup records its exact fail-closed stage in the
 * private failure projection before the packaged smoke observes authority.
 * Preserve that earliest precise stage instead of masking it with the
 * coarser authority-missing stage.
 */
export function resolveP8ProductJourneyAuthorityFailureStage(
  recordedFailure: P8ProductJourneyFailure | null,
  authorityStage: P8ProductJourneyFailureStage,
): P8ProductJourneyFailureStage {
  if (
    recordedFailure !== null &&
    recordedFailure.code === "journey-failed" &&
    P8_PRODUCT_JOURNEY_RUNTIME_DIAGNOSTIC_STAGES.has(recordedFailure.stage)
  ) {
    return recordedFailure.stage;
  }
  return authorityStage;
}

/**
 * Run one operation that temporarily refines the packaged smoke failure
 * stage. A successful operation restores the caller's stage so a later
 * boundary owns any failure; a thrown operation keeps the precise inner
 * stage that was last recorded.
 */
export async function withP8ProductJourneyFailureStageScope<T>(
  callerStage: P8ProductJourneyFailureStage,
  setFailureStage: (stage: P8ProductJourneyFailureStage) => void,
  operation: () => Promise<T>,
): Promise<T> {
  let succeeded = false;
  try {
    const result = await operation();
    succeeded = true;
    return result;
  } finally {
    if (succeeded) setFailureStage(callerStage);
  }
}

const P8_PRODUCT_JOURNEY_FAILURE_MAX_BYTES = 4 * 1024;

export class P8ProductJourneySmokeError extends Error {
  constructor(readonly code: P8ProductJourneySmokeErrorCode) {
    super(code);
    this.name = "P8ProductJourneySmokeError";
  }
}

function smokeError(code: P8ProductJourneySmokeErrorCode): P8ProductJourneySmokeError {
  return new P8ProductJourneySmokeError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function strictlyInside(root: string, candidate: string): boolean {
  if (!path.isAbsolute(root) || !path.isAbsolute(candidate)) return false;
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function cleanAbsolutePath(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (candidate === undefined || candidate.length === 0 || !path.isAbsolute(candidate)) {
    return null;
  }
  const normalized = path.normalize(candidate);
  return normalized === candidate ? normalized : null;
}

export function parseP8ProductJourneyFailure(value: unknown): P8ProductJourneyFailure | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FAILURE_KEYS) ||
    typeof value.code !== "string" ||
    !CLOSED_ERROR_CODES.has(value.code as P8ProductJourneySmokeErrorCode) ||
    typeof value.stage !== "string" ||
    !FAILURE_STAGES.has(value.stage as P8ProductJourneyFailureStage)
  ) {
    return null;
  }
  try {
    assertP8ProductJourneyPrivacy(value);
  } catch {
    return null;
  }
  return Object.freeze({
    code: value.code as P8ProductJourneySmokeErrorCode,
    stage: value.stage as P8ProductJourneyFailureStage,
  });
}

export function writeP8ProductJourneyFailure(
  failurePath: string,
  failure: P8ProductJourneyFailure,
): void {
  if (
    parseP8ProductJourneyFailure(failure) === null ||
    !path.isAbsolute(failurePath) ||
    path.basename(failurePath) !== P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME
  ) {
    throw smokeError("result-write-failed");
  }
  const temporaryPath = `${failurePath}.tmp`;
  try {
    const existing = fs.lstatSync(failurePath, { throwIfNoEntry: false });
    const existingTemporary = fs.lstatSync(temporaryPath, {
      throwIfNoEntry: false,
    });
    if (existing !== undefined || existingTemporary !== undefined) {
      throw smokeError("result-write-failed");
    }
    const serialized = `${JSON.stringify(failure)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > P8_PRODUCT_JOURNEY_FAILURE_MAX_BYTES) {
      throw smokeError("result-write-failed");
    }
    fs.writeFileSync(temporaryPath, serialized, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, failurePath);
    fs.chmodSync(failurePath, 0o600);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Keep the exported failure code bounded.
    }
    throw closedError(error, "result-write-failed");
  }
}

export function parseP8ProductJourneySmokeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): P8ProductJourneySmokeEnvironment | null {
  if (
    environment.ACTESTRA_E2E_TEST !== "1" ||
    environment.ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE !== "1"
  ) {
    return null;
  }
  const root = cleanAbsolutePath(environment.ACTESTRA_E2E_ISOLATION_ROOT);
  const userData = cleanAbsolutePath(environment.ACTESTRA_USER_DATA_DIR);
  const home = cleanAbsolutePath(environment.ACTESTRA_E2E_HOME_DIR);
  const temp = cleanAbsolutePath(environment.ACTESTRA_E2E_TEMP_DIR);
  const workspace = cleanAbsolutePath(environment.ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE);
  const resultPath = cleanAbsolutePath(environment.ACTESTRA_P8_PRODUCT_JOURNEYS_RESULT);
  const timeoutText = environment.ACTESTRA_P8_PRODUCT_JOURNEYS_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutText === undefined ? Number.NaN : Number(timeoutText);
  if (
    root === null ||
    userData === null ||
    home === null ||
    temp === null ||
    workspace === null ||
    resultPath === null ||
    ![userData, home, temp, workspace, resultPath].every((candidate) =>
      strictlyInside(root, candidate),
    ) ||
    !strictlyInside(userData, resultPath) ||
    resultPath !== path.join(userData, P8_PRODUCT_JOURNEY_RESULT_FILE_NAME) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MINIMUM_TIMEOUT_MS ||
    timeoutMs > MAXIMUM_TIMEOUT_MS
  ) {
    return null;
  }
  return Object.freeze({
    root,
    userData,
    home,
    temp,
    workspace,
    resultPath,
    timeoutMs,
  });
}

function forbiddenString(value: string): boolean {
  return (
    path.posix.isAbsolute(value) ||
    WINDOWS_ABSOLUTE_PATH.test(value) ||
    UNC_ABSOLUTE_PATH.test(value)
  );
}

export function assertP8ProductJourneyPrivacy(value: unknown): void {
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate === "string" && forbiddenString(candidate)) {
      throw smokeError("privacy-redaction-failed");
    }
    if (typeof candidate !== "object" || candidate === null) continue;
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      pending.push(...candidate);
      continue;
    }
    for (const [key, entry] of Object.entries(candidate)) {
      if (FORBIDDEN_KEY.test(key)) throw smokeError("privacy-redaction-failed");
      pending.push(entry);
    }
  }
}

export function parseP8ProductJourneyRestartJournal(
  value: unknown,
): P8ProductJourneyRestartJournal | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RESTART_JOURNAL_KEYS) ||
    value.schemaVersion !== 1 ||
    value.journey !== "crash-restart-recovery" ||
    (value.phase !== "active-checkpoint" && value.phase !== "recovered") ||
    (value.restartCount !== 0 && value.restartCount !== 1) ||
    (value.phase === "active-checkpoint" && value.restartCount !== 0) ||
    (value.phase === "recovered" && value.restartCount !== 1)
  ) {
    return null;
  }
  try {
    assertP8ProductJourneyPrivacy(value);
  } catch {
    return null;
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    journey: "crash-restart-recovery" as const,
    phase: value.phase,
    restartCount: value.restartCount,
  });
}

export function writeP8ProductJourneyRestartJournal(
  journalPath: string,
  value: P8ProductJourneyRestartJournal,
): void {
  if (parseP8ProductJourneyRestartJournal(value) === null) {
    throw smokeError("result-write-failed");
  }
  const temporaryPath = `${journalPath}.tmp`;
  try {
    if (
      !path.isAbsolute(journalPath) ||
      path.basename(journalPath) !== P8_PRODUCT_JOURNEY_RESTART_JOURNAL_FILE_NAME
    ) {
      throw smokeError("result-write-failed");
    }
    const existing = fs.lstatSync(journalPath, { throwIfNoEntry: false });
    if (existing?.isSymbolicLink()) throw smokeError("result-write-failed");
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, journalPath);
    fs.chmodSync(journalPath, 0o600);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Keep the exported error bounded and code-only.
    }
    throw closedError(error, "result-write-failed");
  }
}

function assertObservation(
  value: unknown,
  expectedId: P8ProductJourneyId,
): asserts value is P8ProductJourneyObservation {
  assertP8ProductJourneyPrivacy(value);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, JOURNEY_KEYS) ||
    value.id !== expectedId ||
    value.status !== "verified"
  ) {
    throw smokeError("journey-failed");
  }
  if (value.residualProcessCount !== 0) throw smokeError("residual-processes");
}

function assertResult(value: unknown): asserts value is P8ProductJourneyResult {
  assertP8ProductJourneyPrivacy(value);
  if (
    !isRecord(value) ||
    !hasExactKeys(value, RESULT_KEYS) ||
    value.schemaVersion !== 1 ||
    value.status !== "verified" ||
    !Array.isArray(value.journeys) ||
    value.journeys.length !== P8_PRODUCT_JOURNEY_IDS.length
  ) {
    throw smokeError("result-write-failed");
  }
  for (const [index, id] of P8_PRODUCT_JOURNEY_IDS.entries()) {
    try {
      assertObservation(value.journeys[index], id);
    } catch {
      throw smokeError("result-write-failed");
    }
  }
}

function closedError(error: unknown, fallback: P8ProductJourneySmokeErrorCode) {
  if (error instanceof P8ProductJourneySmokeError) return error;
  if (error instanceof Error && CLOSED_ERROR_CODES.has(error.message as never)) {
    return smokeError(error.message as P8ProductJourneySmokeErrorCode);
  }
  return smokeError(fallback);
}

function abortError(signal: AbortSignal): P8ProductJourneySmokeError {
  return signal.reason instanceof P8ProductJourneySmokeError
    ? signal.reason
    : smokeError("journey-failed");
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  timeoutCode: P8ProductJourneySmokeErrorCode,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(abortError(parentSignal!));
  if (parentSignal?.aborted === true) throw abortError(parentSignal);
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = smokeError(timeoutCode);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onParentAbort);
  }
}

export function writeP8ProductJourneyResult(
  resultPath: string,
  result: P8ProductJourneyResult,
): void {
  assertResult(result);
  const temporaryPath = `${resultPath}.tmp`;
  try {
    if (
      fs.lstatSync(resultPath, { throwIfNoEntry: false }) !== undefined ||
      fs.lstatSync(temporaryPath, { throwIfNoEntry: false }) !== undefined
    ) {
      throw smokeError("result-write-failed");
    }
    fs.writeFileSync(temporaryPath, `${JSON.stringify(result)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporaryPath, resultPath);
  } catch (error) {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // The closed result-write error below is the only exported diagnostic.
    }
    throw closedError(error, "result-write-failed");
  }
}

export function createP8ProductJourneyCoordinator(context: P8ProductJourneyRunContext): Readonly<{
  run(): Promise<P8ProductJourneyResult>;
}> {
  const configuration = parseP8ProductJourneySmokeEnvironment(context.environment);
  let completed = false;
  return Object.freeze({
    async run(): Promise<P8ProductJourneyResult> {
      if (completed || configuration === null || context.appIsPackaged !== true) {
        throw smokeError("invalid-environment");
      }
      completed = true;
      const observations: P8ProductJourneyObservation[] = [];
      let primaryError: P8ProductJourneySmokeError | null = null;
      try {
        await withDeadline(
          async (signal) => {
            for (const id of P8_PRODUCT_JOURNEY_IDS) {
              const observation = await context.executeJourney(id, signal);
              assertObservation(observation, id);
              observations.push(Object.freeze({ ...observation }));
            }
          },
          configuration.timeoutMs,
          context.signal,
          "journey-timeout",
        );
      } catch (error) {
        primaryError = closedError(error, "journey-failed");
      }

      try {
        const cleanup = await withDeadline(
          context.cleanup,
          configuration.timeoutMs,
          undefined,
          "cleanup-failed",
        );
        assertP8ProductJourneyPrivacy(cleanup);
        if (
          !isRecord(cleanup) ||
          !hasExactKeys(cleanup, ["residualProcessCount"]) ||
          cleanup.residualProcessCount !== 0
        ) {
          throw smokeError("residual-processes");
        }
      } catch (error) {
        throw closedError(error, "cleanup-failed");
      }

      if (primaryError !== null) throw primaryError;
      const result = Object.freeze({
        schemaVersion: 1 as const,
        status: "verified" as const,
        journeys: Object.freeze(observations),
      });
      assertResult(result);
      if (context.writeResult !== undefined) {
        try {
          await context.writeResult(result);
        } catch (error) {
          throw closedError(error, "result-write-failed");
        }
      }
      return result;
    },
  });
}
