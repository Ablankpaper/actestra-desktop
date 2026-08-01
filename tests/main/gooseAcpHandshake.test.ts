import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTESTRA_ACP_CLIENT_VERSION,
  connectGooseAcp,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";
import { EXPECTED_GOOSE_INITIALIZE_RESULT, LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

afterEach(() => {
  vi.useRealTimers();
});

describe("Goose ACP handshake", () => {
  it("negotiates the exact Goose identity and closed capability manifest", async () => {
    const transport = new LoopbackGooseAcpTransport();
    const connection = await connectGooseAcp(transport);

    expect(connection.info).toEqual({
      protocolVersion: 1,
      agentName: "goose",
      agentVersion: "1.45.0",
      loadSession: true,
      prompt: {
        image: true,
        audio: false,
        embeddedContext: true,
      },
      mcp: {
        http: true,
        sse: false,
        acp: false,
      },
      session: {
        list: true,
        close: true,
      },
    });
    expect(transport.sentLines).toHaveLength(1);
    expect(JSON.parse(transport.sentLines[0]!)).toEqual({
      jsonrpc: "2.0",
      id: "actestra-goose-initialize-1",
      method: "initialize",
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: {
          name: "actestra-core",
          version: ACTESTRA_ACP_CLIENT_VERSION,
        },
      },
    });

    await connection.close();
    expect(transport.closeCount).toBe(1);
  });

  it("rejects an unsupported Goose version before any session request", async () => {
    const transport = new LoopbackGooseAcpTransport({
      initializeResult: {
        ...EXPECTED_GOOSE_INITIALIZE_RESULT,
        agentInfo: {
          name: "goose",
          version: "1.44.0",
        },
      },
    });

    await expect(connectGooseAcp(transport)).rejects.toMatchObject({
      name: "GooseAcpHandshakeError",
      code: "unsupported-version",
    });
    expect(transport.sentLines.map((line) => JSON.parse(line).method)).toEqual(["initialize"]);
    expect(transport.closeCount).toBe(1);
  });

  it("rejects additional advertised authority instead of widening the manifest", async () => {
    const transport = new LoopbackGooseAcpTransport({
      initializeResult: {
        ...EXPECTED_GOOSE_INITIALIZE_RESULT,
        agentCapabilities: {
          ...EXPECTED_GOOSE_INITIALIZE_RESULT.agentCapabilities,
          mcpCapabilities: {
            ...EXPECTED_GOOSE_INITIALIZE_RESULT.agentCapabilities.mcpCapabilities,
            sse: true,
          },
        },
      },
    });

    await expect(connectGooseAcp(transport)).rejects.toMatchObject({
      name: "GooseAcpHandshakeError",
      code: "unexpected-capabilities",
    });
    expect(transport.closeCount).toBe(1);
  });

  it("bounds a silent initialize and cleans up the transport", async () => {
    vi.useFakeTimers();
    const transport = new LoopbackGooseAcpTransport({ silent: true });
    const connecting = connectGooseAcp(transport, { timeoutMs: 10 });
    const rejection = expect(connecting).rejects.toMatchObject({
      name: "GooseAcpHandshakeError",
      code: "startup-timeout",
    });

    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    expect(transport.closeCount).toBe(1);
  });
});
