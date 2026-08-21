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

export type GooseWindowsCapabilityProgressStage =
  (typeof GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES)[number];

export interface GooseWindowsCapabilityProgress {
  record(stage: GooseWindowsCapabilityProgressStage): void;
  snapshot(): readonly GooseWindowsCapabilityProgressStage[];
}

export function createGooseWindowsCapabilityProgress(): GooseWindowsCapabilityProgress {
  const observed = new Set<GooseWindowsCapabilityProgressStage>();
  return Object.freeze({
    record(stage: GooseWindowsCapabilityProgressStage): void {
      if ((GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES as readonly string[]).includes(stage)) {
        observed.add(stage);
      }
    },
    snapshot(): readonly GooseWindowsCapabilityProgressStage[] {
      return Object.freeze(
        GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES.filter((stage) => observed.has(stage)),
      );
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
