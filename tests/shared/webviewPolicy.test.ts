import { describe, expect, it } from "vitest";
import {
  ACTESTRA_DEFAULT_WEBVIEW_PARTITION,
  isAllowedActestraWebviewRequest,
  isAllowedActestraWebviewSource,
} from "../../apps/desktop/src/shared/webviewPolicy";

const PREVIEW = { partition: ACTESTRA_DEFAULT_WEBVIEW_PARTITION } as const;

describe("Actestra WebView service policy", () => {
  it("admits only the current backend and retained Office preview ports", () => {
    expect(
      isAllowedActestraWebviewSource("http://127.0.0.1:13400/api/preview", {
        ...PREVIEW,
        backendPort: 13400,
      }),
    ).toBe(true);
    expect(isAllowedActestraWebviewSource("http://localhost:18791/preview", PREVIEW)).toBe(true);
    expect(isAllowedActestraWebviewSource("https://127.0.0.1:59999/preview", PREVIEW)).toBe(false);
    expect(isAllowedActestraWebviewSource("https://preview.example.invalid/page", PREVIEW)).toBe(
      false,
    );
  });

  it("rejects implicit ports, ambiguous loopback spellings, and undeclared partitions", () => {
    for (const url of [
      "http://localhost/preview",
      "http://127.0.0.2:18791/preview",
      "http://[::1]:18791/preview",
      "http://127.0.0.1:59999/preview",
    ]) {
      expect(isAllowedActestraWebviewSource(url, PREVIEW), url).toBe(false);
    }
    expect(
      isAllowedActestraWebviewSource("http://127.0.0.1:18791/preview", {
        partition: "persist:unowned",
      }),
    ).toBe(false);
  });

  it("keeps request admission port-bound across HTTP and WebSocket schemes", () => {
    expect(isAllowedActestraWebviewRequest("ws://127.0.0.1:13400/ws", { backendPort: 13400 })).toBe(
      true,
    );
    expect(isAllowedActestraWebviewRequest("wss://localhost:19000/events")).toBe(true);
    expect(isAllowedActestraWebviewRequest("ws://localhost:19001/events")).toBe(false);
    expect(isAllowedActestraWebviewRequest("file:///tmp/preview.html")).toBe(false);
  });

  it("retains local file and data previews without granting a network service", () => {
    expect(isAllowedActestraWebviewSource("file:///tmp/preview.html")).toBe(true);
    expect(isAllowedActestraWebviewSource("data:text/html,preview")).toBe(true);
  });
});
