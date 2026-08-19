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
