import type { GooseRunnerModelBinding } from "./gooseRunnerProcess";

export type GooseSessionTransportMode = "macos-loopback" | "linux-relay" | "windows-authenticated";

export class GooseSessionTransportError extends Error {
  constructor(readonly targetTriple: string) {
    super("Goose session transport is not admitted for the requested target");
    this.name = "GooseSessionTransportError";
  }
}

export const GOOSE_WINDOWS_STDIO_CHANNELS = Object.freeze([
  "stdin",
  "stdout",
  "stderr",
  "control",
  "parent-liveness",
  "capability",
  "model",
] as const);

// Node keeps its parent endpoints asynchronous on Windows in both modes. The two
// Supervisor endpoints must also be overlapped because each carries concurrent
// request and response traffic through one duplex named-pipe client handle.
export const GOOSE_WINDOWS_STDIO_CONFIGURATION = Object.freeze([
  "pipe",
  "pipe",
  "pipe",
  "pipe",
  "pipe",
  "overlapped",
  "overlapped",
] as const);

export const GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES = Object.freeze([
  "windows-capability-worker-request-written",
  "windows-capability-supervisor-request-read",
  "windows-capability-supervisor-request-forwarded",
  "windows-capability-main-request-decoded",
  "windows-capability-main-response-written",
  "windows-capability-supervisor-response-read",
  "windows-capability-supervisor-response-forwarded",
  "windows-capability-worker-response-decoded",
] as const);

export const GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES = Object.freeze([
  "windows-capability-call-worker-request-written",
  "windows-capability-call-supervisor-request-read",
  "windows-capability-call-supervisor-request-forwarded",
  "windows-capability-call-main-request-decoded",
  "windows-capability-call-main-tool-invocation-started",
  "windows-capability-call-main-tool-invocation-completed",
  "windows-capability-call-main-response-written",
  "windows-capability-call-supervisor-response-read",
  "windows-capability-call-supervisor-response-forwarded",
  "windows-capability-call-worker-response-decoded",
] as const);

// Main records exactly one of these when a capability call fails inside the
// Tool Gateway. They name the layer that refused, so a durable token separates
// an approval refusal from a gateway, output, or contract failure.
export const GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES = Object.freeze([
  "windows-capability-call-main-tool-invocation-failed",
  "windows-capability-call-main-contract-failed",
  "windows-capability-call-main-approval-failed",
  "windows-capability-call-main-gateway-failed",
  "windows-capability-call-main-output-failed",
] as const);

export const GOOSE_WINDOWS_MODEL_PROGRESS_STAGES = Object.freeze([
  "windows-model-worker-request-written",
  "windows-model-supervisor-request-read",
  "windows-model-supervisor-request-forwarded",
  "windows-model-main-request-decoded",
  "windows-model-main-invocation-started",
  "windows-model-main-invocation-completed",
  "windows-model-main-response-written",
  "windows-model-supervisor-response-read",
  "windows-model-supervisor-response-forwarded",
  "windows-model-worker-response-decoded",
] as const);

export type GooseWindowsCapabilityProgressStage =
  | (typeof GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES)[number]
  | (typeof GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES)[number]
  | (typeof GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES)[number];

/**
 * Progress is recorded twice: once for the whole session, and once for the
 * current attempt. A session-wide set cannot classify the second prompt in a
 * session, because every stage the first prompt completed is already present
 * and no stage looks missing. `beginAttempt` opens a fresh attempt window so
 * each prompt is classified on its own round trips.
 */
export interface GooseWindowsCapabilityProgress {
  record(stage: GooseWindowsCapabilityProgressStage): void;
  snapshot(): readonly GooseWindowsCapabilityProgressStage[];
  beginAttempt(): void;
  attemptSnapshot(): readonly GooseWindowsCapabilityProgressStage[];
}

const GOOSE_WINDOWS_CAPABILITY_ALL_STAGES = Object.freeze([
  ...GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES,
  ...GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES,
  ...GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES,
] as const);

export function createGooseWindowsCapabilityProgress(): GooseWindowsCapabilityProgress {
  const observed = new Set<GooseWindowsCapabilityProgressStage>();
  let attempt = new Set<GooseWindowsCapabilityProgressStage>();
  const ordered = (
    stages: ReadonlySet<GooseWindowsCapabilityProgressStage>,
  ): readonly GooseWindowsCapabilityProgressStage[] =>
    Object.freeze(GOOSE_WINDOWS_CAPABILITY_ALL_STAGES.filter((stage) => stages.has(stage)));
  return Object.freeze({
    record(stage: GooseWindowsCapabilityProgressStage): void {
      if ((GOOSE_WINDOWS_CAPABILITY_ALL_STAGES as readonly string[]).includes(stage)) {
        observed.add(stage);
        attempt.add(stage);
      }
    },
    snapshot(): readonly GooseWindowsCapabilityProgressStage[] {
      return ordered(observed);
    },
    beginAttempt(): void {
      attempt = new Set<GooseWindowsCapabilityProgressStage>();
    },
    attemptSnapshot(): readonly GooseWindowsCapabilityProgressStage[] {
      return ordered(attempt);
    },
  });
}

export type GooseWindowsModelProgressStage = (typeof GOOSE_WINDOWS_MODEL_PROGRESS_STAGES)[number];

/** Attempt-scoped for the same reason as {@link GooseWindowsCapabilityProgress}. */
export interface GooseWindowsModelProgress {
  record(stage: GooseWindowsModelProgressStage): void;
  snapshot(): readonly GooseWindowsModelProgressStage[];
  beginAttempt(): void;
  attemptSnapshot(): readonly GooseWindowsModelProgressStage[];
}

export function createGooseWindowsModelProgress(): GooseWindowsModelProgress {
  const observed = new Set<GooseWindowsModelProgressStage>();
  let attempt = new Set<GooseWindowsModelProgressStage>();
  const ordered = (
    stages: ReadonlySet<GooseWindowsModelProgressStage>,
  ): readonly GooseWindowsModelProgressStage[] =>
    Object.freeze(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES.filter((stage) => stages.has(stage)));
  return Object.freeze({
    record(stage: GooseWindowsModelProgressStage): void {
      if ((GOOSE_WINDOWS_MODEL_PROGRESS_STAGES as readonly string[]).includes(stage)) {
        observed.add(stage);
        attempt.add(stage);
      }
    },
    snapshot(): readonly GooseWindowsModelProgressStage[] {
      return ordered(observed);
    },
    beginAttempt(): void {
      attempt = new Set<GooseWindowsModelProgressStage>();
    },
    attemptSnapshot(): readonly GooseWindowsModelProgressStage[] {
      return ordered(attempt);
    },
  });
}

export interface GooseCapabilityBoundary {
  readonly sessionEndpoint?: Readonly<{ readonly url: string; readonly attemptLease: string }>;
  bindSession(sessionId: string): void;
  waitForToolsList(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface GooseModelBoundary {
  readonly runnerBinding?: GooseRunnerModelBinding;
  bindSession(sessionId: string): void;
  readonly servedInferenceCount: number;
  readonly refusedInferenceCount: number;
  readonly rejectedRequestCount: number;
  close(): Promise<void>;
}

export function resolveGooseSessionTransportMode(targetTriple: string): GooseSessionTransportMode {
  switch (targetTriple) {
    case "aarch64-apple-darwin":
    case "x86_64-apple-darwin":
      return "macos-loopback";
    case "x86_64-unknown-linux-gnu":
      return "linux-relay";
    case "x86_64-pc-windows-msvc":
      return "windows-authenticated";
    default:
      throw new GooseSessionTransportError(targetTriple);
  }
}
