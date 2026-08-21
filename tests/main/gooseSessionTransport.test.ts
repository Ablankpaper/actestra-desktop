import { describe, expect, it } from "vitest";
import {
  GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES,
  GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES,
  GOOSE_WINDOWS_MODEL_PROGRESS_STAGES,
  GOOSE_WINDOWS_STDIO_CHANNELS,
  GOOSE_WINDOWS_STDIO_CONFIGURATION,
  createGooseWindowsModelProgress,
  resolveGooseSessionTransportMode,
} from "../../apps/desktop/src/main/workers/gooseSessionTransport";

describe("Goose session transport selection", () => {
  it("selects the exact transport for every admitted target", () => {
    expect(resolveGooseSessionTransportMode("aarch64-apple-darwin")).toBe("macos-loopback");
    expect(resolveGooseSessionTransportMode("x86_64-apple-darwin")).toBe("macos-loopback");
    expect(resolveGooseSessionTransportMode("x86_64-unknown-linux-gnu")).toBe("linux-relay");
    expect(resolveGooseSessionTransportMode("x86_64-pc-windows-msvc")).toBe(
      "windows-authenticated",
    );
  });

  it("fails closed for an unknown or unsupported target", () => {
    expect(() => resolveGooseSessionTransportMode("x86_64-unknown-freebsd")).toThrow();
    expect(() => resolveGooseSessionTransportMode("x86_64-pc-windows-gnu")).toThrow();
  });

  it("locks the Windows seven-channel order and duplex bridge channels", () => {
    expect(GOOSE_WINDOWS_STDIO_CHANNELS).toEqual([
      "stdin",
      "stdout",
      "stderr",
      "control",
      "parent-liveness",
      "capability",
      "model",
    ]);
    expect(GOOSE_WINDOWS_STDIO_CHANNELS).toHaveLength(7);
    expect(GOOSE_WINDOWS_STDIO_CHANNELS.slice(-2)).toEqual(["capability", "model"]);
    expect(GOOSE_WINDOWS_STDIO_CONFIGURATION).toEqual([
      "pipe",
      "pipe",
      "pipe",
      "pipe",
      "pipe",
      "overlapped",
      "overlapped",
    ]);
    expect(Object.isFrozen(GOOSE_WINDOWS_STDIO_CONFIGURATION)).toBe(true);
  });

  it("keeps first tool-call progress separate from tools/list discovery", () => {
    expect(GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES).toEqual([
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
    ]);
    expect(GOOSE_WINDOWS_CAPABILITY_CALL_FAILURE_STAGES).toEqual([
      "windows-capability-call-main-tool-invocation-failed",
    ]);
  });

  it("locks one closed Windows model request-response progress vocabulary", () => {
    expect(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES).toEqual([
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
    ]);
    expect(Object.isFrozen(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES)).toBe(true);

    const progress = createGooseWindowsModelProgress();
    progress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[7]);
    progress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[0]);
    progress.record(GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[0]);
    expect(progress.snapshot()).toEqual([
      GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[0],
      GOOSE_WINDOWS_MODEL_PROGRESS_STAGES[7],
    ]);
    expect(Object.isFrozen(progress.snapshot())).toBe(true);
  });
});
