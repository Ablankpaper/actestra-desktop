import { describe, expect, it } from "vitest";
import {
  GOOSE_WINDOWS_STDIO_CHANNELS,
  GOOSE_WINDOWS_STDIO_CONFIGURATION,
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
});
