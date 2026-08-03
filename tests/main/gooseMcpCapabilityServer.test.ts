// @vitest-environment node

import http from "node:http";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODING_DIFF_TOOL_ID,
  CODING_FILE_READ_TOOL_ID,
  CODING_FILE_WRITE_TOOL_ID,
  CODING_GIT_TOOL_ID,
  CODING_TERMINAL_TOOL_ID,
  CODING_TEST_TOOL_ID,
} from "../../apps/desktop/src/core";
import {
  startGooseMcpCapabilityServer,
  type GooseMcpCapabilityServer,
} from "../../apps/desktop/src/main/workers/gooseMcpCapabilityServer";

const ATTEMPT_LEASE = "attempt-lease-0123456789abcdef0123456789abcdef";
const MCP_PROTOCOL_VERSION = "2025-03-26";

interface McpHttpResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

const servers = new Set<GooseMcpCapabilityServer>();

async function openServer(): Promise<GooseMcpCapabilityServer> {
  const server = await startGooseMcpCapabilityServer({
    attemptLease: ATTEMPT_LEASE,
    commandIds: ["format-check", "typecheck"],
    testIds: ["focused-tests"],
  });
  servers.add(server);
  return server;
}

async function postMcp(
  url: string,
  message: unknown,
  options: {
    readonly protocolVersion?: string;
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly method?: string;
    readonly path?: string;
    readonly rawBody?: string;
  } = {},
): Promise<McpHttpResponse> {
  const body = options.rawBody ?? JSON.stringify(message);
  const target = new URL(url);
  const requestTarget = new URL(options.path ?? target.pathname, target.origin);
  const headers: Record<string, string | string[] | number> = {
    Accept: "text/event-stream, application/json",
    Authorization: `Bearer ${ATTEMPT_LEASE}`,
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json",
    Host: target.host,
    "User-Agent": "goose/1.45.0",
    ...(options.protocolVersion === undefined
      ? {}
      : { "MCP-Protocol-Version": options.protocolVersion }),
  };
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === undefined) {
      delete headers[name];
    } else {
      headers[name] = typeof value === "string" ? value : [...value];
    }
  }
  return new Promise((resolve, reject) => {
    const request = http.request(
      requestTarget,
      {
        method: options.method ?? "POST",
        agent: false,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function initialize(server: GooseMcpCapabilityServer): Promise<McpHttpResponse> {
  return postMcp(server.url, initializeMessage());
}

function initializeMessage(): Readonly<Record<string, unknown>> {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        extensions: {},
        roots: {},
        sampling: {},
        elicitation: {},
      },
      clientInfo: {
        name: "actestra-core",
        version: "0.1.0-alpha.0",
      },
    },
  };
}

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
});

describe("Goose authenticated loopback MCP capability server", () => {
  it("serves only the six closed coding schemas after the exact MCP initialization sequence", async () => {
    const server = await openServer();

    const initializeResponse = await initialize(server);
    expect(initializeResponse).toMatchObject({
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
    expect(initializeResponse.headers).not.toHaveProperty("access-control-allow-origin");
    expect(initializeResponse.headers).not.toHaveProperty("mcp-session-id");
    expect(JSON.parse(initializeResponse.body)).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: {
          name: "actestra-core",
          version: "0.1.0-alpha.0",
        },
      },
    });

    const initializedResponse = await postMcp(
      server.url,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );
    expect(initializedResponse.status).toBe(202);
    expect(initializedResponse.body).toBe("");
    expect(initializedResponse.headers).not.toHaveProperty("mcp-session-id");

    const listResponse = await postMcp(
      server.url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {
          _meta: {
            "agent-session-id": "goose:session-1",
            progressToken: 0,
          },
        },
      },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );
    expect(listResponse.status).toBe(200);
    const listBody = JSON.parse(listResponse.body) as {
      readonly result: {
        readonly tools: ReadonlyArray<{
          readonly name: string;
          readonly inputSchema: {
            readonly properties?: {
              readonly commandId?: { readonly enum?: readonly string[] };
              readonly testId?: { readonly enum?: readonly string[] };
            };
          };
        }>;
      };
    };
    expect(listBody.result.tools).toEqual([
      {
        name: CODING_FILE_READ_TOOL_ID,
        description: "Read bounded UTF-8 text inside the isolated coding worktree.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["contractVersion", "relativePath"],
          properties: {
            contractVersion: { type: "integer", const: 1 },
            relativePath: { type: "string", minLength: 1, maxLength: 1_024 },
            maximumBytes: { type: "integer", minimum: 1, maximum: 65_536 },
          },
        },
      },
      {
        name: CODING_FILE_WRITE_TOOL_ID,
        description: "Write bounded UTF-8 text inside the isolated coding worktree after approval.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["contractVersion", "relativePath", "content"],
          properties: {
            contractVersion: { type: "integer", const: 1 },
            relativePath: { type: "string", minLength: 1, maxLength: 1_024 },
            content: { type: "string", maxLength: 65_536 },
          },
        },
      },
      {
        name: CODING_TERMINAL_TOOL_ID,
        description: "Run one Actestra-registered command in the isolated worktree after approval.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["contractVersion", "commandId"],
          properties: {
            contractVersion: { type: "integer", const: 1 },
            commandId: { type: "string", enum: ["format-check", "typecheck"] },
          },
        },
      },
      {
        name: CODING_GIT_TOOL_ID,
        description: "Inspect fixed Git status or HEAD state without changing the repository.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["contractVersion", "query"],
          properties: {
            contractVersion: { type: "integer", const: 1 },
            query: { type: "string", enum: ["status", "head"] },
          },
        },
      },
      {
        name: CODING_DIFF_TOOL_ID,
        description: "Inspect the fixed worktree diff without external diff or text conversion.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["contractVersion"],
          properties: { contractVersion: { type: "integer", const: 1 } },
        },
      },
      {
        name: CODING_TEST_TOOL_ID,
        description:
          "Run one Actestra-registered test command in the isolated worktree after approval.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["contractVersion", "testId"],
          properties: {
            contractVersion: { type: "integer", const: 1 },
            testId: { type: "string", enum: ["focused-tests"] },
          },
        },
      },
    ]);
    expect(Buffer.byteLength(listResponse.body)).toBeLessThanOrEqual(65_536);
  });

  it.each([
    {
      label: "short lease",
      options: {
        attemptLease: "short",
        commandIds: ["format-check"],
        testIds: ["focused-tests"],
      },
    },
    {
      label: "empty command registry",
      options: {
        attemptLease: ATTEMPT_LEASE,
        commandIds: [],
        testIds: ["focused-tests"],
      },
    },
    {
      label: "invalid command identifier",
      options: {
        attemptLease: ATTEMPT_LEASE,
        commandIds: ["FORMAT CHECK"],
        testIds: ["focused-tests"],
      },
    },
    {
      label: "duplicate test identifier",
      options: {
        attemptLease: ATTEMPT_LEASE,
        commandIds: ["format-check"],
        testIds: ["focused-tests", "focused-tests"],
      },
    },
    {
      label: "additional authority field",
      options: {
        attemptLease: ATTEMPT_LEASE,
        commandIds: ["format-check"],
        testIds: ["focused-tests"],
        toolsCallEnabled: true,
      },
    },
  ])("rejects $label before opening a listener", async ({ options }) => {
    const outcome = await startGooseMcpCapabilityServer(options).then(
      async (server) => {
        await server.close();
        return undefined;
      },
      (error: unknown) => error,
    );

    expect(outcome).toMatchObject({
      name: "GooseMcpCapabilityServerError",
      code: "invalid-config",
    });
  });

  it("snapshots command and test identifiers before exposing schemas", async () => {
    const commandIds = ["format-check"];
    const testIds = ["focused-tests"];
    const server = await startGooseMcpCapabilityServer({
      attemptLease: ATTEMPT_LEASE,
      commandIds,
      testIds,
    });
    servers.add(server);
    commandIds.push("unreviewed-command");
    testIds[0] = "substituted-test";
    await initialize(server);
    await postMcp(
      server.url,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );

    const response = await postMcp(
      server.url,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { "agent-session-id": "goose-session-1" } },
      },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );
    const tools = (
      JSON.parse(response.body) as {
        readonly result: {
          readonly tools: readonly {
            readonly inputSchema: {
              readonly properties?: Readonly<Record<string, { readonly enum?: readonly string[] }>>;
            };
          }[];
        };
      }
    ).result.tools;
    expect(tools[2]?.inputSchema.properties?.commandId?.enum).toEqual(["format-check"]);
    expect(tools[5]?.inputSchema.properties?.testId?.enum).toEqual(["focused-tests"]);
  });

  it.each([
    {
      label: "missing authorization",
      expectedStatus: 401,
      headers: { Authorization: undefined },
    },
    {
      label: "wrong attempt lease",
      expectedStatus: 401,
      headers: { Authorization: `Bearer ${"x".repeat(48)}` },
    },
    {
      label: "duplicate authorization",
      expectedStatus: 401,
      headers: {
        Authorization: [`Bearer ${ATTEMPT_LEASE}`, `Bearer ${ATTEMPT_LEASE}`],
      },
    },
    {
      label: "browser origin",
      expectedStatus: 403,
      headers: { Origin: "https://example.invalid" },
    },
    {
      label: "non-exact host",
      expectedStatus: 400,
      headers: { Host: "localhost" },
    },
    {
      label: "non-JSON content",
      expectedStatus: 415,
      headers: { "Content-Type": "text/plain" },
    },
    {
      label: "SSE-only accept",
      expectedStatus: 406,
      headers: { Accept: "text/event-stream" },
    },
    {
      label: "unknown user agent",
      expectedStatus: 403,
      headers: { "User-Agent": "curl/9" },
    },
    {
      label: "stateful MCP session",
      expectedStatus: 400,
      headers: { "MCP-Session-Id": "unexpected-session" },
    },
    {
      label: "protocol header on initialize",
      expectedStatus: 400,
      headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION },
    },
  ])("rejects $label without advancing initialization", async ({ expectedStatus, headers }) => {
    const server = await openServer();
    const rejected = await postMcp(
      server.url,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            extensions: {},
            roots: {},
            sampling: {},
            elicitation: {},
          },
          clientInfo: { name: "actestra-core", version: "0.1.0-alpha.0" },
        },
      },
      { headers },
    );

    expect(rejected.status).toBe(expectedStatus);
    expect(rejected.headers).not.toHaveProperty("access-control-allow-origin");
    expect(rejected.headers).not.toHaveProperty("location");
    expect(rejected.headers).not.toHaveProperty("mcp-session-id");
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it("closes a rejected unauthenticated connection without draining an unbounded body", async () => {
    const server = await openServer();
    const target = new URL(server.url);
    const socket = net.connect({ host: target.hostname, port: Number(target.port) });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      response += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const closed = new Promise<void>((resolve) => socket.once("close", resolve));
    socket.write(
      [
        "POST /mcp HTTP/1.1",
        `Host: ${target.host}`,
        "Accept: text/event-stream, application/json",
        "Authorization: Bearer xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "Content-Length: 999999999",
        "Content-Type: application/json",
        "User-Agent: goose/1.45.0",
        "Connection: keep-alive",
        "",
        "",
      ].join("\r\n"),
    );

    try {
      await Promise.race([
        closed,
        delay(250).then(() => {
          throw new Error("Rejected Goose MCP connection remained open");
        }),
      ]);
      expect(response).toContain("HTTP/1.1 401 Unauthorized");
      expect(response.toLowerCase()).toContain("connection: close");
    } finally {
      socket.destroy();
    }
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it.each([
    {
      label: "unsupported protocol",
      message: {
        ...initializeMessage(),
        params: {
          ...(initializeMessage().params as Record<string, unknown>),
          protocolVersion: "2025-06-18",
        },
      },
    },
    {
      label: "expanded client capabilities",
      message: {
        ...initializeMessage(),
        params: {
          ...(initializeMessage().params as Record<string, unknown>),
          capabilities: {
            extensions: {},
            roots: {},
            sampling: {},
            elicitation: {},
            tasks: {},
          },
        },
      },
    },
    {
      label: "different MCP client",
      message: {
        ...initializeMessage(),
        params: {
          ...(initializeMessage().params as Record<string, unknown>),
          clientInfo: { name: "goose", version: "1.45.0" },
        },
      },
    },
    {
      label: "expanded client info",
      message: {
        ...initializeMessage(),
        params: {
          ...(initializeMessage().params as Record<string, unknown>),
          clientInfo: {
            name: "actestra-core",
            version: "0.1.0-alpha.0",
            title: "unexpected",
          },
        },
      },
    },
    {
      label: "extra initialize parameter",
      message: {
        ...initializeMessage(),
        params: {
          ...(initializeMessage().params as Record<string, unknown>),
          authorization: "widened",
        },
      },
    },
    {
      label: "extra JSON-RPC envelope field",
      message: { ...initializeMessage(), result: {} },
    },
    {
      label: "null request id",
      message: { ...initializeMessage(), id: null },
    },
  ])("rejects $label without consuming initialize", async ({ message }) => {
    const server = await openServer();
    await expect(postMcp(server.url, message)).resolves.toMatchObject({ status: 400 });
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it("requires the exact initialized notification before entering the ready state", async () => {
    const server = await openServer();
    await initialize(server);

    await expect(
      postMcp(
        server.url,
        {
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        },
        { protocolVersion: MCP_PROTOCOL_VERSION },
      ),
    ).resolves.toMatchObject({ status: 400 });

    await expect(
      postMcp(
        server.url,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { protocolVersion: MCP_PROTOCOL_VERSION },
      ),
    ).resolves.toMatchObject({ status: 202, body: "" });
  });

  it("rejects out-of-order and repeated handshake messages without corrupting the sequence", async () => {
    const server = await openServer();
    await expect(
      postMcp(server.url, { jsonrpc: "2.0", method: "notifications/initialized" }),
    ).resolves.toMatchObject({ status: 400 });
    await initialize(server);
    await expect(
      postMcp(server.url, initializeMessage(), { protocolVersion: MCP_PROTOCOL_VERSION }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      postMcp(
        server.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: { _meta: { "agent-session-id": "goose-session-1" } },
        },
        { protocolVersion: MCP_PROTOCOL_VERSION },
      ),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      postMcp(
        server.url,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { protocolVersion: MCP_PROTOCOL_VERSION },
      ),
    ).resolves.toMatchObject({ status: 202 });
    await expect(
      postMcp(
        server.url,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { protocolVersion: MCP_PROTOCOL_VERSION },
      ),
    ).resolves.toMatchObject({ status: 400 });
  });

  it.each([
    {
      label: "missing request id",
      message: {
        jsonrpc: "2.0",
        method: "tools/list",
        params: { _meta: { "agent-session-id": "goose-session-1" } },
      },
    },
    {
      label: "pagination cursor",
      message: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { "agent-session-id": "goose-session-1" }, cursor: "next" },
      },
    },
    {
      label: "expanded metadata",
      message: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {
          _meta: {
            "agent-session-id": "goose-session-1",
            "working-directory": "/private/tmp/source",
          },
        },
      },
    },
    {
      label: "unsafe session metadata",
      message: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { "agent-session-id": "session\r\ninjected" } },
      },
    },
    {
      label: "expanded envelope",
      message: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { "agent-session-id": "goose-session-1" } },
        result: {},
      },
    },
  ])("rejects $label in tools/list without changing ready state", async ({ message }) => {
    const server = await openServer();
    await initialize(server);
    await postMcp(
      server.url,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );

    await expect(
      postMcp(server.url, message, { protocolVersion: MCP_PROTOCOL_VERSION }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      postMcp(
        server.url,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: { _meta: { "agent-session-id": "goose-session-1" } },
        },
        { protocolVersion: MCP_PROTOCOL_VERSION },
      ),
    ).resolves.toMatchObject({ status: 200 });
  });

  it("rejects tools/call as an unimplemented method without executing authority", async () => {
    const server = await openServer();
    await initialize(server);
    await postMcp(
      server.url,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );

    const response = await postMcp(
      server.url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: CODING_FILE_READ_TOOL_ID,
          arguments: { contractVersion: 1, relativePath: "secret.txt" },
        },
      },
      { protocolVersion: MCP_PROTOCOL_VERSION },
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it.each([
    { label: "GET stream", method: "GET", path: "/mcp", expectedStatus: 405 },
    { label: "DELETE session", method: "DELETE", path: "/mcp", expectedStatus: 405 },
    { label: "CORS preflight", method: "OPTIONS", path: "/mcp", expectedStatus: 405 },
    { label: "different path", method: "POST", path: "/", expectedStatus: 404 },
    { label: "query string", method: "POST", path: "/mcp?stream=true", expectedStatus: 404 },
  ])("rejects $label without entering the MCP state machine", async (requestOptions) => {
    const server = await openServer();
    const response = await postMcp(server.url, initializeMessage(), {
      method: requestOptions.method,
      path: requestOptions.path,
      headers:
        requestOptions.method === "OPTIONS"
          ? { Origin: "https://example.invalid", "Access-Control-Request-Method": "POST" }
          : undefined,
    });

    expect(response.status).toBe(requestOptions.expectedStatus);
    expect(response.headers).not.toHaveProperty("access-control-allow-origin");
    expect(response.headers).not.toHaveProperty("location");
    expect(response.headers["content-type"]).not.toBe("text/event-stream");
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it("rejects request bodies larger than 64 KiB before JSON parsing", async () => {
    const server = await openServer();
    const response = await postMcp(server.url, undefined, {
      rawBody: JSON.stringify({ padding: "x".repeat(65_536) }),
    });

    expect(response.status).toBe(413);
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it.each([
    {
      label: "malformed JSON",
      rawBody: "{",
      expectedCode: -32700,
    },
    {
      label: "JSON-RPC batch",
      rawBody: JSON.stringify([initializeMessage()]),
      expectedCode: -32600,
    },
  ])("rejects $label without consuming initialize", async ({ rawBody, expectedCode }) => {
    const server = await openServer();
    const response = await postMcp(server.url, undefined, { rawBody });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: expectedCode } });
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it("rejects a chunked request without an exact content length", async () => {
    const server = await openServer();
    const response = await postMcp(server.url, initializeMessage(), {
      headers: { "Content-Length": undefined, "Transfer-Encoding": "chunked" },
    });

    expect(response.status).toBe(411);
    await expect(initialize(server)).resolves.toMatchObject({ status: 200 });
  });

  it("closes idempotently and destroys a connection stalled in a partial request body", async () => {
    const server = await openServer();
    const target = new URL(server.url);
    const socket = net.connect({ host: target.hostname, port: Number(target.port) });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      [
        "POST /mcp HTTP/1.1",
        `Host: ${target.host}`,
        "Accept: text/event-stream, application/json",
        `Authorization: Bearer ${ATTEMPT_LEASE}`,
        "Content-Length: 100",
        "Content-Type: application/json",
        "User-Agent: goose/1.45.0",
        "Connection: keep-alive",
        "",
        "{",
      ].join("\r\n"),
    );
    await delay(10);
    const socketClosed = new Promise<void>((resolve) => socket.once("close", resolve));

    const firstClose = server.close();
    const secondClose = server.close();
    expect(secondClose).toBe(firstClose);
    try {
      await Promise.race([
        firstClose,
        delay(250).then(() => {
          throw new Error("Goose MCP server close did not destroy the residual connection");
        }),
      ]);
      await Promise.race([
        socketClosed,
        delay(250).then(() => {
          throw new Error("Goose MCP client socket did not observe server-side destruction");
        }),
      ]);
      expect(socket.destroyed).toBe(true);
    } finally {
      socket.destroy();
      await firstClose;
    }

    await expect(postMcp(server.url, initializeMessage())).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
    await expect(server.close()).resolves.toBeUndefined();
  });
});
