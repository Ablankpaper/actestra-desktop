import { describe, expect, it } from "vitest";
import { isAllowedDevelopmentUrl } from "../../apps/desktop/src/main/security";

describe("offline shell network policy", () => {
  it.each([
    "http://127.0.0.1:5173",
    "https://localhost:5173",
    "ws://127.0.0.1:5173/socket",
    "wss://localhost:5173/socket",
  ])("allows a loopback development origin: %s", (url) => {
    expect(isAllowedDevelopmentUrl(url)).toBe(true);
  });

  it.each([
    "https://example.com",
    "https://localhost.example.com",
    "file:///tmp/index.html",
    "actestra://task/example",
    "not a url",
  ])("rejects a non-loopback or irrelevant origin: %s", (url) => {
    expect(isAllowedDevelopmentUrl(url)).toBe(false);
  });
});
