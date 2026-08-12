import { describe, expect, it } from "vitest";
import { parseAionUiTeamBridgeRequest } from "../../../apps/desktop/src/compatibility/aionui/teamBridge";

describe("Team Bridge multiline validation", () => {
  const baseRequest = {
    contractVersion: 1,
    method: "POST",
    path: "/api/teams/team-test/messages",
    body: {
      content: "single line task",
      request_nonce: "nonce-test",
    },
  };

  it("accepts single-line content", () => {
    const route = parseAionUiTeamBridgeRequest(baseRequest);
    expect(route.kind).toBe("send-message");
    if (route.kind === "send-message") {
      expect(route.content).toBe("single line task");
    }
  });

  it("accepts multiline content with LF", () => {
    const multiline = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "first line\nsecond line\nthird line",
      },
    };
    const route = parseAionUiTeamBridgeRequest(multiline);
    expect(route.kind).toBe("send-message");
    if (route.kind === "send-message") {
      expect(route.content).toBe("first line\nsecond line\nthird line");
    }
  });

  it("normalizes CRLF to LF", () => {
    const crlf = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "first line\r\nsecond line\r\nthird line",
      },
    };
    const route = parseAionUiTeamBridgeRequest(crlf);
    expect(route.kind).toBe("send-message");
    if (route.kind === "send-message") {
      expect(route.content).toBe("first line\nsecond line\nthird line");
    }
  });

  it("rejects content with NUL", () => {
    const withNul = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "task with\x00null byte",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withNul)).toThrow();
  });

  it("rejects content with tab", () => {
    const withTab = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "task with\ttab",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withTab)).toThrow();
  });

  it("rejects content with vertical tab", () => {
    const withVTab = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "task with\x0Bvertical tab",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withVTab)).toThrow();
  });

  it("rejects content with form feed", () => {
    const withFF = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "task with\x0Cform feed",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withFF)).toThrow();
  });

  it("rejects content with CR alone", () => {
    const withCR = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "task with\rbare CR",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withCR)).toThrow();
  });

  it("rejects content with C1 control characters", () => {
    const withC1 = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "task with\x7FC1 control",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withC1)).toThrow();
  });

  it("rejects content with leading whitespace", () => {
    const withLeading = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "  leading space",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withLeading)).toThrow();
  });

  it("rejects content with trailing whitespace", () => {
    const withTrailing = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "trailing space  ",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(withTrailing)).toThrow();
  });

  it("rejects non-NFC content", () => {
    const nonNFC = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        // U+0041 (A) + U+0301 (combining acute) = NFD, not NFC
        content: "task with Á non-NFC",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(nonNFC)).toThrow();
  });

  it("rejects empty content", () => {
    const empty = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "",
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(empty)).toThrow();
  });

  it("rejects content exceeding byte limit", () => {
    const oversized = {
      ...baseRequest,
      body: {
        ...baseRequest.body,
        content: "a".repeat(16 * 1024 + 1),
      },
    };
    expect(() => parseAionUiTeamBridgeRequest(oversized)).toThrow();
  });
});
