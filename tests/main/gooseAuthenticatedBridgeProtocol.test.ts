import { describe, expect, it } from "vitest";
import { CODING_TOOL_IDS } from "../../apps/desktop/src/core";
import {
  GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES,
  GOOSE_AUTHENTICATED_BRIDGE_VERSION,
  GooseAuthenticatedBridgeRequestLedger,
  decodeGooseWindowsCapabilityFrame,
  decodeGooseWindowsModelFrame,
  encodeGooseWindowsCapabilityFrame,
  encodeGooseWindowsModelFrame,
  type GooseWindowsCapabilityFrame,
  type GooseWindowsModelFrame,
} from "../../apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol";

const LEASE = "lease_0123456789abcdef0123456789abcdef";
const SESSION = "session_0123456789abcdef";
const REQUEST = "request-1";

function frame(payload: string | Uint8Array): Buffer {
  const bytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(bytes.byteLength, 0);
  return Buffer.concat([header, bytes]);
}

function usage() {
  return { promptTokens: 1, completionTokens: 2 };
}

function invocation() {
  return {
    sessionId: SESSION,
    purpose: "coding" as const,
    responseMode: "text-or-tool-call" as const,
    messages: [{ role: "user" as const, content: "inspect the file" }],
    tools: CODING_TOOL_IDS.map((name) => ({
      name,
      inputSchema: {},
    })),
  };
}

function modelRequest(): GooseWindowsModelFrame {
  return {
    contractVersion: GOOSE_AUTHENTICATED_BRIDGE_VERSION,
    kind: "completion-request",
    requestId: REQUEST,
    lease: LEASE,
    sessionId: SESSION,
    invocation: invocation(),
  };
}

function capabilityRequest(): GooseWindowsCapabilityFrame {
  return {
    contractVersion: GOOSE_AUTHENTICATED_BRIDGE_VERSION,
    kind: "call-request",
    requestId: REQUEST,
    lease: LEASE,
    sessionId: SESSION,
    toolName: CODING_TOOL_IDS[0],
    arguments: { contractVersion: 1, relativePath: "README.md" },
  };
}

describe("Goose authenticated Windows bridge protocol", () => {
  it("round-trips the exact model and capability vocabularies", () => {
    const modelFrames: readonly GooseWindowsModelFrame[] = [
      modelRequest(),
      {
        contractVersion: 1,
        kind: "completion-response",
        requestId: REQUEST,
        completion: { type: "message", text: "done", usage: usage() },
      },
      { contractVersion: 1, kind: "model-error", requestId: REQUEST, code: "model-timeout" },
      { contractVersion: 1, kind: "cancel", requestId: REQUEST, lease: LEASE },
    ];
    for (const value of modelFrames) {
      const encoded = encodeGooseWindowsModelFrame(value);
      expect(
        decodeGooseWindowsModelFrame(encoded, { expectedLease: LEASE, expectedSessionId: SESSION }),
      ).toEqual(value);
    }

    const capabilityFrames: readonly GooseWindowsCapabilityFrame[] = [
      {
        contractVersion: 1,
        kind: "list-request",
        requestId: REQUEST,
        lease: LEASE,
        sessionId: SESSION,
      },
      {
        contractVersion: 1,
        kind: "list-response",
        requestId: REQUEST,
        tools: CODING_TOOL_IDS.map((name) => ({ name, inputSchema: {} })),
      },
      capabilityRequest(),
      {
        contractVersion: 1,
        kind: "call-response",
        requestId: REQUEST,
        isError: false,
        content: "ok",
      },
      { contractVersion: 1, kind: "cancel", requestId: REQUEST, lease: LEASE },
      {
        contractVersion: 1,
        kind: "capability-error",
        requestId: REQUEST,
        code: "capability-unavailable",
      },
    ];
    for (const value of capabilityFrames) {
      const encoded = encodeGooseWindowsCapabilityFrame(value);
      expect(
        decodeGooseWindowsCapabilityFrame(encoded, {
          expectedLease: LEASE,
          expectedSessionId: SESSION,
        }),
      ).toEqual(value);
    }
  });

  it("rejects duplicate keys, invalid Unicode, excess depth, trailing bytes, and wrong lengths", () => {
    const duplicate = frame(
      `{"contractVersion":1,"kind":"cancel","kind":"model-error","lease":"${LEASE}","requestId":"${REQUEST}"}`,
    );
    expect(() =>
      decodeGooseWindowsModelFrame(duplicate, { expectedLease: LEASE, expectedSessionId: SESSION }),
    ).toThrow();

    const invalidUnicode = frame(
      `{"contractVersion":1,"kind":"model-error","requestId":"${REQUEST}","code":"\ud800"}`,
    );
    expect(() => decodeGooseWindowsModelFrame(invalidUnicode)).toThrow();

    let nested = "{}";
    for (let index = 0; index < 40; index += 1) nested = `{"x":${nested}}`;
    expect(() => decodeGooseWindowsModelFrame(frame(nested))).toThrow();

    const trailing = Buffer.concat([
      frame(JSON.stringify({ contractVersion: 1 })),
      Buffer.from([0]),
    ]);
    expect(() => decodeGooseWindowsModelFrame(trailing)).toThrow();

    const wrongLength = Buffer.from(frame(JSON.stringify({ contractVersion: 1 })));
    wrongLength.writeUInt32LE(wrongLength.byteLength, 0);
    expect(() => decodeGooseWindowsModelFrame(wrongLength)).toThrow();

    const oversize = {
      contractVersion: 1,
      kind: "completion-response" as const,
      requestId: REQUEST,
      completion: { type: "message" as const, text: "x".repeat(256 * 1024 + 1), usage: usage() },
    } as const;
    expect(() => encodeGooseWindowsModelFrame(oversize)).toThrow();
    expect(GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES).toBe(2 * 1024 * 1024);
  });

  it("rejects unknown fields, wrong scope, unsupported roles, undeclared tools, and cross-pipe frames", () => {
    expect(() =>
      encodeGooseWindowsModelFrame({ ...modelRequest(), unexpected: true } as never),
    ).toThrow();
    expect(() =>
      decodeGooseWindowsModelFrame(encodeGooseWindowsModelFrame(modelRequest()), {
        expectedLease: "lease_wrong_0123456789abcdef0123456789",
        expectedSessionId: SESSION,
      }),
    ).toThrow();
    expect(() =>
      encodeGooseWindowsModelFrame({
        ...modelRequest(),
        invocation: { ...invocation(), messages: [{ role: "developer", content: "no" }] },
      } as never),
    ).toThrow();
    expect(() =>
      encodeGooseWindowsModelFrame({
        ...modelRequest(),
        invocation: { ...invocation(), tools: [{ name: "not-admitted", inputSchema: {} }] },
      } as never),
    ).toThrow();
    expect(() =>
      decodeGooseWindowsCapabilityFrame(encodeGooseWindowsModelFrame(modelRequest())),
    ).toThrow();
  });

  it("rejects stale and duplicate responses through the request ledger", () => {
    const ledger = new GooseAuthenticatedBridgeRequestLedger();
    ledger.begin(REQUEST);
    ledger.acceptResponse(REQUEST);
    expect(() => ledger.acceptResponse(REQUEST)).toThrow();
    expect(() => ledger.acceptResponse("stale-request")).toThrow();
    expect(() => ledger.begin(REQUEST)).toThrow();
  });
});
