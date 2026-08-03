import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTESTRA_ACP_CLIENT_VERSION,
  connectGooseAcp,
} from "../../apps/desktop/src/main/workers/gooseAcpHandshake";
import { EXPECTED_GOOSE_INITIALIZE_RESULT, LoopbackGooseAcpTransport } from "../fixtures/gooseAcp";

class FailingSessionSendTransport extends LoopbackGooseAcpTransport {
  override sendLine(line: string): void {
    const request = JSON.parse(line) as { readonly method?: unknown };
    if (request.method === "session/new") {
      throw new Error("injected stdin failure");
    }
    super.sendLine(line);
  }
}

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

  it("opens one session through the exact isolated loopback MCP declaration", async () => {
    const transport = new LoopbackGooseAcpTransport();
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toEqual({
      sessionId: "goose-session-1",
      setupNotificationKinds: ["available_commands_update"],
    });

    expect(transport.sentLines).toHaveLength(2);
    expect(JSON.parse(transport.sentLines[1]!)).toEqual({
      jsonrpc: "2.0",
      id: "actestra-goose-session-new-1",
      method: "session/new",
      params: {
        cwd: "/private/tmp/actestra-worktree",
        mcpServers: [
          {
            type: "http",
            name: "actestra-capability-proxy",
            url: "http://127.0.0.1:43123/mcp",
            headers: [
              {
                name: "Authorization",
                value: "Bearer attempt-lease-0123456789abcdef0123456789abcdef",
              },
            ],
          },
        ],
      },
    });

    await connection.close();
    expect(transport.closeCount).toBe(1);
  });

  it.each([
    {
      label: "relative workspace",
      options: {
        workspaceDirectory: "relative/worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      },
    },
    {
      label: "non-exact loopback URL",
      options: {
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://localhost:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      },
    },
    {
      label: "unsafe attempt lease",
      options: {
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "short lease\r\nInjected: value",
      },
    },
    {
      label: "invalid session timeout",
      options: {
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
        timeoutMs: 0,
      },
    },
    {
      label: "unbounded session timeout",
      options: {
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
        timeoutMs: 120_001,
      },
    },
    {
      label: "oversized workspace path",
      options: {
        workspaceDirectory: `/private/tmp/${"x".repeat(4_096)}`,
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      },
    },
  ])("rejects $label before writing a session request", async ({ options }) => {
    const transport = new LoopbackGooseAcpTransport();
    const connection = await connectGooseAcp(transport);

    await expect(connection.openSession(options)).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "invalid-session-options",
    });
    expect(transport.sentLines.map((line) => JSON.parse(line).method)).toEqual(["initialize"]);
    expect(transport.closeCount).toBe(0);

    await connection.close();
  });

  it("closes the transport when setup notifications do not match the response session", async () => {
    const transport = new LoopbackGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "setup-session",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [],
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: request.id,
          result: { sessionId: "response-session" },
        },
      ],
    });
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "invalid-session-message",
    });
    expect(transport.closeCount).toBe(1);
  });

  it.each([
    {
      label: "unknown agent request",
      sessionMessages: (request: Readonly<Record<string, unknown>>) => [
        { jsonrpc: "2.0", id: "goose-request-1", method: "fs/read", params: {} },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [],
            },
          },
        },
        { jsonrpc: "2.0", id: request.id, result: { sessionId: "goose-session-1" } },
      ],
    },
    {
      label: "unknown notification method",
      sessionMessages: (request: Readonly<Record<string, unknown>>) => [
        { jsonrpc: "2.0", method: "session/unknown", params: {} },
        { jsonrpc: "2.0", id: request.id, result: { sessionId: "goose-session-1" } },
      ],
    },
    {
      label: "non-setup session update",
      sessionMessages: (request: Readonly<Record<string, unknown>>) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: { sessionUpdate: "tool_call" },
          },
        },
        { jsonrpc: "2.0", id: request.id, result: { sessionId: "goose-session-1" } },
      ],
    },
    {
      label: "expanded response envelope",
      sessionMessages: (request: Readonly<Record<string, unknown>>) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [],
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: request.id,
          result: { sessionId: "goose-session-1" },
          extra: true,
        },
      ],
    },
    {
      label: "expanded response result",
      sessionMessages: (request: Readonly<Record<string, unknown>>) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [],
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: request.id,
          result: { sessionId: "goose-session-1", unexpectedAuthority: true },
        },
      ],
    },
  ])("closes on $label during session setup", async ({ sessionMessages }) => {
    const transport = new LoopbackGooseAcpTransport({ sessionMessages });
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "invalid-session-message",
    });
    expect(transport.closeCount).toBe(1);
  });

  it("normalizes the admitted Goose setup notifications and optional response fields", async () => {
    const transport = new LoopbackGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: { sessionUpdate: "usage_update", used: 0, size: 128_000 },
          },
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "compact", description: "Compact context" }],
            },
          },
        },
        {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            sessionId: "goose-session-1",
            modes: { currentModeId: "auto", availableModes: [] },
            configOptions: [],
            _meta: { goose: { extensions: [] } },
          },
        },
      ],
    });
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).resolves.toEqual({
      sessionId: "goose-session-1",
      setupNotificationKinds: ["usage_update", "available_commands_update"],
    });

    await connection.close();
  });

  it("bounds setup notifications to one usage and one available-commands update", async () => {
    const transport = new LoopbackGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: { sessionUpdate: "usage_update", used: 0, size: 128_000 },
          },
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [],
            },
          },
        },
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: { sessionUpdate: "usage_update", used: 0, size: 128_000 },
          },
        },
        { jsonrpc: "2.0", id: request.id, result: { sessionId: "goose-session-1" } },
      ],
    });
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "invalid-session-message",
    });
    expect(transport.closeCount).toBe(1);
  });

  it("normalizes a correlated JSON-RPC rejection and closes the transport", async () => {
    const transport = new LoopbackGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32_602,
            message: "Invalid params",
            data: "injected upstream diagnostic",
          },
        },
      ],
    });
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "session-rejected",
      message: "Goose rejected the ACP session/new request",
    });
    expect(transport.closeCount).toBe(1);
  });

  it("bounds a silent session/new request and closes the transport", async () => {
    vi.useFakeTimers();
    const transport = new LoopbackGooseAcpTransport({ silentSession: true });
    const connection = await connectGooseAcp(transport);
    const opening = connection.openSession({
      workspaceDirectory: "/private/tmp/actestra-worktree",
      capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
      attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      timeoutMs: 10,
    });
    const observed = opening.then(
      (value) => ({ status: "resolved" as const, value }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );

    await vi.advanceTimersByTimeAsync(11);
    const outcome = await Promise.race([observed, Promise.resolve({ status: "pending" as const })]);

    expect(outcome).toMatchObject({
      status: "rejected",
      error: {
        name: "GooseAcpSessionError",
        code: "session-timeout",
      },
    });
    expect(transport.closeCount).toBe(1);
  });

  it.each([
    {
      label: "transport error",
      expectedCode: "session-transport-error",
      trigger: (transport: LoopbackGooseAcpTransport) => {
        transport.emitError(new Error("injected transport failure"));
      },
    },
    {
      label: "process exit",
      expectedCode: "session-process-exit",
      trigger: (transport: LoopbackGooseAcpTransport) => {
        transport.emitExit(17, null);
      },
    },
  ])("closes after $label during session/new", async ({ expectedCode, trigger }) => {
    const transport = new LoopbackGooseAcpTransport({ silentSession: true });
    const connection = await connectGooseAcp(transport);
    const opening = connection.openSession({
      workspaceDirectory: "/private/tmp/actestra-worktree",
      capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
      attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
    });

    trigger(transport);
    await expect(opening).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: expectedCode,
    });
    expect(transport.closeCount).toBe(1);
  });

  it("permits only one ACP session/new request per Goose process", async () => {
    const transport = new LoopbackGooseAcpTransport();
    const connection = await connectGooseAcp(transport);
    const options = {
      workspaceDirectory: "/private/tmp/actestra-worktree",
      capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
      attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
    } as const;

    await connection.openSession(options);
    await expect(connection.openSession(options)).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "session-already-open",
    });
    expect(transport.sentLines.map((line) => JSON.parse(line).method)).toEqual([
      "initialize",
      "session/new",
    ]);
    expect(transport.closeCount).toBe(0);

    await connection.close();
  });

  it("normalizes a synchronous session transport failure and closes it", async () => {
    const transport = new FailingSessionSendTransport();
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "session-transport-error",
    });
    expect(transport.closeCount).toBe(1);
  });

  it("rejects an oversized session setup frame and closes the transport", async () => {
    const transport = new LoopbackGooseAcpTransport({
      sessionMessages: (request) => [
        {
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "goose-session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "oversized", description: "x".repeat(70 * 1_024) }],
            },
          },
        },
        { jsonrpc: "2.0", id: request.id, result: { sessionId: "goose-session-1" } },
      ],
    });
    const connection = await connectGooseAcp(transport);

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "invalid-session-message",
    });
    expect(transport.closeCount).toBe(1);
  });

  it("rejects session/new after the ACP connection is closed", async () => {
    const transport = new LoopbackGooseAcpTransport();
    const connection = await connectGooseAcp(transport);
    await connection.close();

    await expect(
      connection.openSession({
        workspaceDirectory: "/private/tmp/actestra-worktree",
        capabilityProxyUrl: "http://127.0.0.1:43123/mcp",
        attemptLease: "attempt-lease-0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      name: "GooseAcpSessionError",
      code: "session-closed",
    });
    expect(transport.sentLines.map((line) => JSON.parse(line).method)).toEqual(["initialize"]);
    expect(transport.closeCount).toBe(1);
  });
});
