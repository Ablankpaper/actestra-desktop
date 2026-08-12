import { afterEach, describe, expect, it } from "vitest";
import {
  GooseLoopbackModelServerError,
  startGooseLoopbackModelServer,
  type GooseLoopbackModelCompletion,
  type GooseLoopbackModelServer,
  type GooseLoopbackModelInvoker,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";

const MODEL_LEASE = "model-lease-0123456789abcdef0123456789abcdef";
const MAX_MAIN_MODEL_JSON_DEPTH = 64;
const MAX_MAIN_MODEL_JSON_NODES = 16_384;
const MAX_MAIN_MODEL_JSON_UTF8_BYTES = 256 * 1024;
const modelInvoker: GooseLoopbackModelInvoker = async () =>
  Object.freeze({
    type: "message",
    text: "bounded model response",
    usage: Object.freeze({ promptTokens: 7, completionTokens: 3 }),
  });
const openServers: GooseLoopbackModelServer[] = [];

function nestedJsonObject(depth: number): { readonly nested?: unknown } {
  let value: { readonly nested?: unknown } = {};
  for (let level = 0; level < depth; level += 1) {
    value = { nested: value };
  }
  return value;
}

async function postInference(
  server: GooseLoopbackModelServer,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return fetch(`${server.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MODEL_LEASE}`,
      "Content-Type": "application/json",
      "agent-session-id": "goose-session-1",
    },
    body: JSON.stringify(body),
  });
}

async function postResponsesInference(
  server: GooseLoopbackModelServer,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> {
  return fetch(`${server.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MODEL_LEASE}`,
      "Content-Type": "application/json",
      "agent-session-id": "goose-session-1",
    },
    body: JSON.stringify(body),
  });
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("Goose loopback model server", () => {
  it("serves one authenticated caller-selected OpenAI-compatible model catalog", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      invokeModel: modelInvoker,
    });
    openServers.push(server);

    const response = await fetch(`${server.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "User-Agent": "goose/1.45.0",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: "list",
      data: [
        {
          id: "actestra-caller-model",
          object: "model",
          created: 0,
          owned_by: "actestra",
        },
      ],
    });
    expect(Object.keys(server).sort()).toEqual([
      "baseUrl",
      "bindSession",
      "close",
      "refusedInferenceCount",
      "rejectedRequestCount",
      "servedInferenceCount",
    ]);
  });

  // Regression: a refused Main completion used to become an opaque 400 with no
  // record, so a coding attempt that never ran a tool still published as
  // "unchanged" and terminalized as "completed" with zero Artifacts.
  it("records a refused inference when the Main completion is rejected", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        throw new Error("AionCore model completion is unavailable");
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    expect(server.refusedInferenceCount).toBe(0);

    const response = await postInference(server, {
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Read the README." }],
      stream: true,
    });

    expect(response.status).toBe(400);
    // The loopback body stays content-free: the reason is recorded in-process,
    // never handed to the runner.
    expect(await response.text()).toBe("");
    expect(server.refusedInferenceCount).toBe(1);
    expect(server.servedInferenceCount).toBe(0);
  });

  it("counts a served inference separately from a refused one", async () => {
    let shouldRefuse = true;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel(invocation, signal) {
        if (shouldRefuse) {
          shouldRefuse = false;
          throw new Error("AionCore model completion is unavailable");
        }
        return modelInvoker(invocation, signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const refused = await postInference(server, {
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Read the README." }],
      stream: true,
    });
    const served = await postInference(server, {
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Read the README." }],
      stream: true,
    });

    expect(refused.status).toBe(400);
    expect(served.status).toBe(200);
    expect(server.refusedInferenceCount).toBe(1);
    expect(server.servedInferenceCount).toBe(1);
  });

  it("rejects a wrong lease and inference before an ACP session is bound", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      invokeModel: modelInvoker,
    });
    openServers.push(server);

    const wrongLease = await fetch(`${server.baseUrl}/models`, {
      headers: { Authorization: "Bearer wrong-lease-0123456789abcdef0123456789abcdef" },
    });
    const inference = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "actestra-caller-model", messages: [] }),
    });

    expect(wrongLease.status).toBe(401);
    expect(inference.status).toBe(409);
  });

  it("invokes the model only for the exact bound session and streams a bounded response", async () => {
    const invocations: unknown[] = [];
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel(invocation, signal) {
        expect(signal.aborted).toBe(false);
        invocations.push(invocation);
        return Object.freeze({
          type: "message" as const,
          text: "bounded model response",
          usage: Object.freeze({ promptTokens: 7, completionTokens: 3 }),
        });
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const inputSchema = {
      type: "object",
      properties: {
        contractVersion: { type: "integer", const: 1 },
        relativePath: { type: "string" },
      },
      required: ["contractVersion", "relativePath"],
      additionalProperties: false,
    };
    const requestBody = {
      model: "actestra-caller-model",
      messages: [
        { role: "system", content: "Use only the admitted coding tools." },
        { role: "user", content: "Read README.md and return its result." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-actestra-prior-1",
              type: "function",
              function: {
                name: "actestra-capability-proxy__coding.file.read",
                arguments: '{"contractVersion":1,"relativePath":"README.md"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-actestra-prior-1",
          content: "integration tool result",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "actestra-capability-proxy__coding.file.read",
            description: "Read one file from the admitted coding worktree.",
            parameters: inputSchema,
          },
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
    };
    const wrongSession = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-2",
      },
      body: JSON.stringify(requestBody),
    });
    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify(requestBody),
    });

    expect(wrongSession.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    const frames = (await response.text())
      .split("\n\n")
      .filter((frame) => frame.length > 0)
      .map((frame) => frame.slice("data: ".length));
    expect(frames.at(-1)).toBe("[DONE]");
    expect(frames.slice(0, -1).map((frame) => JSON.parse(frame))).toEqual([
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [
          {
            index: 0,
            delta: { content: "bounded model response" },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    ]);
    expect(invocations).toEqual([
      {
        sessionId: "goose-session-1",
        purpose: "coding",
        messages: [
          { role: "system", content: "Use only the admitted coding tools." },
          { role: "user", content: "Read README.md and return its result." },
          {
            role: "assistant",
            toolCalls: [
              {
                callId: "call-actestra-prior-1",
                name: "actestra-capability-proxy__coding.file.read",
                arguments: { contractVersion: 1, relativePath: "README.md" },
              },
            ],
          },
          {
            role: "tool",
            callId: "call-actestra-prior-1",
            content: "integration tool result",
          },
        ],
        tools: [
          {
            name: "actestra-capability-proxy__coding.file.read",
            description: "Read one file from the admitted coding worktree.",
            inputSchema,
          },
        ],
        responseMode: "text-or-tool-call",
      },
    ]);
  });

  it("accepts Goose's Responses API request and returns a bounded streamed message", async () => {
    const invocations: unknown[] = [];
    const server = await startGooseLoopbackModelServer({
      modelId: "gpt-5.6-sol",
      attemptLease: MODEL_LEASE,
      async invokeModel(invocation) {
        invocations.push(invocation);
        return Object.freeze({
          type: "message" as const,
          text: "responses model answer",
          usage: Object.freeze({ promptTokens: 9, completionTokens: 4 }),
        });
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await postResponsesInference(server, {
      model: "gpt-5.6-sol",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: "Use only the admitted coding tools." }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: "Return one bounded answer." }],
        },
      ],
      store: false,
      stream: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect((await response.text()).split("\n\n").at(-2)).toBe("data: [DONE]");
    expect(invocations).toEqual([
      {
        sessionId: "goose-session-1",
        purpose: "coding",
        messages: [
          { role: "system", content: "Use only the admitted coding tools." },
          { role: "user", content: "Return one bounded answer." },
        ],
        tools: [],
        responseMode: "text-or-tool-call",
      },
    ]);
  });

  it("accepts a tool input schema at the JSON depth limit and rejects limit plus one before invocation", async () => {
    let invocationCount = 0;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return modelInvoker({} as never, new AbortController().signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const requestAtDepth = (depth: number) => ({
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Use the admitted tool." }],
      tools: [
        {
          type: "function",
          function: {
            name: "actestra-capability-proxy__coding.file.read",
            parameters: nestedJsonObject(depth),
          },
        },
      ],
      stream: true,
    });

    const atLimit = await postInference(server, requestAtDepth(MAX_MAIN_MODEL_JSON_DEPTH));
    const aboveLimit = await postInference(server, requestAtDepth(MAX_MAIN_MODEL_JSON_DEPTH + 1));

    expect(atLimit.status).toBe(200);
    expect(aboveLimit.status).toBe(400);
    expect(invocationCount).toBe(1);
  });

  it("accepts historical tool arguments at the JSON depth limit and rejects limit plus one before invocation", async () => {
    let invocationCount = 0;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return modelInvoker({} as never, new AbortController().signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const requestAtDepth = (depth: number) => ({
      model: "actestra-caller-model",
      messages: [
        { role: "user", content: "Use the admitted tool." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-bounded-history",
              type: "function",
              function: {
                name: "actestra-capability-proxy__coding.file.read",
                arguments: JSON.stringify(nestedJsonObject(depth)),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-bounded-history",
          content: "bounded tool result",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "actestra-capability-proxy__coding.file.read",
            parameters: { type: "object" },
          },
        },
      ],
      stream: true,
    });

    const atLimit = await postInference(server, requestAtDepth(MAX_MAIN_MODEL_JSON_DEPTH));
    const aboveLimit = await postInference(server, requestAtDepth(MAX_MAIN_MODEL_JSON_DEPTH + 1));

    expect(atLimit.status).toBe(200);
    expect(aboveLimit.status).toBe(400);
    expect(invocationCount).toBe(1);
  });

  it("rejects a tool input schema above the bounded JSON node budget before invocation", async () => {
    let invocationCount = 0;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return modelInvoker({} as never, new AbortController().signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await postInference(server, {
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Use only a bounded schema." }],
      tools: [
        {
          type: "function",
          function: {
            name: "actestra-capability-proxy__coding.file.read",
            parameters: {
              values: Array.from({ length: MAX_MAIN_MODEL_JSON_NODES }, () => null),
            },
          },
        },
      ],
      stream: true,
    });

    expect(response.status).toBe(400);
    expect(invocationCount).toBe(0);
  });

  it("rejects historical arguments above the aggregate UTF-8 key and string budget before invocation", async () => {
    let invocationCount = 0;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return modelInvoker({} as never, new AbortController().signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");
    const utf8Component = "界".repeat(Math.floor(MAX_MAIN_MODEL_JSON_UTF8_BYTES / 6) + 1);

    const response = await postInference(server, {
      model: "actestra-caller-model",
      messages: [
        { role: "user", content: "Use only bounded arguments." },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-over-budget-history",
              type: "function",
              function: {
                name: "actestra-capability-proxy__coding.file.read",
                arguments: JSON.stringify({ [utf8Component]: utf8Component }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-over-budget-history",
          content: "bounded tool result",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "actestra-capability-proxy__coding.file.read",
            parameters: { type: "object" },
          },
        },
      ],
      stream: true,
    });

    expect(response.status).toBe(400);
    expect(invocationCount).toBe(0);
  });

  it("rejects ambiguous declared Goose aliases before a user-only request can invoke Main", async () => {
    let invocationCount = 0;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return modelInvoker({} as never, new AbortController().signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await postInference(server, {
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Do not invoke an ambiguous tool." }],
      tools: [
        { type: "function", function: { name: "a.b", parameters: { type: "object" } } },
        { type: "function", function: { name: "a_b", parameters: { type: "object" } } },
      ],
      stream: true,
    });

    expect(response.status).toBe(400);
    expect(invocationCount).toBe(0);
  });

  it("maps one unambiguous Goose-sanitized historical tool name back to its declared canonical name", async () => {
    const invocations: unknown[] = [];
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel(invocation) {
        invocations.push(invocation);
        return Object.freeze({
          type: "message" as const,
          text: "bounded model response",
          usage: Object.freeze({ promptTokens: 7, completionTokens: 3 }),
        });
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify({
        model: "actestra-caller-model",
        messages: [
          { role: "user", content: "Use the admitted tool." },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-actestra-prior-1",
                type: "function",
                function: {
                  name: "actestra-capability-proxy__coding_file_read",
                  arguments: "{}",
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call-actestra-prior-1",
            content: "bounded tool result",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "actestra-capability-proxy__coding.file.read",
              parameters: { type: "object" },
            },
          },
        ],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(invocations).toEqual([
      expect.objectContaining({
        messages: expect.arrayContaining([
          {
            role: "assistant",
            toolCalls: [
              {
                callId: "call-actestra-prior-1",
                name: "actestra-capability-proxy__coding.file.read",
                arguments: {},
              },
            ],
          },
        ]),
      }),
    ]);
  });

  it.each([
    {
      caseName: "collides after invalid-character replacement",
      historicalName: "actestra-capability-proxy__coding_file_read",
      declaredNames: [
        "actestra-capability-proxy__coding.file.read",
        "actestra-capability-proxy__coding:file:read",
      ],
    },
    {
      caseName: "collides with another declared canonical name",
      historicalName: "actestra-capability-proxy__coding_file_read",
      declaredNames: [
        "actestra-capability-proxy__coding.file.read",
        "actestra-capability-proxy__coding_file_read",
      ],
    },
    {
      caseName: "collides after Goose's 128-character truncation",
      historicalName: "x".repeat(128),
      declaredNames: [`${"x".repeat(128)}a`, `${"x".repeat(128)}b`],
    },
    {
      caseName: "was not derived from a declared canonical name",
      historicalName: "actestra-capability-proxy__coding_file_write",
      declaredNames: ["actestra-capability-proxy__coding.file.read"],
    },
  ])(
    "rejects a historical Goose alias that $caseName",
    async ({ historicalName, declaredNames }) => {
      let invocationCount = 0;
      const server = await startGooseLoopbackModelServer({
        modelId: "actestra-caller-model",
        attemptLease: MODEL_LEASE,
        async invokeModel() {
          invocationCount += 1;
          return modelInvoker({} as never, new AbortController().signal);
        },
      });
      openServers.push(server);
      server.bindSession("goose-session-1");

      const response = await fetch(`${server.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MODEL_LEASE}`,
          "Content-Type": "application/json",
          "agent-session-id": "goose-session-1",
        },
        body: JSON.stringify({
          model: "actestra-caller-model",
          messages: [
            { role: "user", content: "Use only an admitted tool." },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-actestra-prior-1",
                  type: "function",
                  function: { name: historicalName, arguments: "{}" },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: "call-actestra-prior-1",
              content: "bounded tool result",
            },
          ],
          tools: declaredNames.map((name) => ({
            type: "function",
            function: { name, parameters: { type: "object" } },
          })),
          stream: true,
        }),
      });

      expect(response.status).toBe(400);
      expect(invocationCount).toBe(0);
    },
  );

  it("rejects unmodeled provider fields instead of forwarding them into Main", async () => {
    let invocationCount = 0;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        invocationCount += 1;
        return modelInvoker({} as never, new AbortController().signal);
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify({
        model: "actestra-caller-model",
        messages: [{ role: "user", content: "Return one bounded answer." }],
        stream: true,
        headers: { Authorization: "must-not-cross-the-adapter" },
      }),
    });

    expect(response.status).toBe(400);
    expect(invocationCount).toBe(0);
  });

  it("streams one bounded MCP tool call without exposing raw response bytes", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-actestra-1",
          name: "actestra-capability-proxy__coding.file.read",
          arguments: Object.freeze({ contractVersion: 1, path: "README.md" }),
          usage: Object.freeze({ promptTokens: 11, completionTokens: 5 }),
        });
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify({
        model: "actestra-caller-model",
        messages: [{ role: "user", content: "Read README.md." }],
        tools: [
          {
            type: "function",
            function: {
              name: "actestra-capability-proxy__coding.file.read",
              parameters: { type: "object" },
            },
          },
        ],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    const frames = (await response.text())
      .split("\n\n")
      .filter((frame) => frame.length > 0)
      .map((frame) => frame.slice("data: ".length));
    expect(frames.at(-1)).toBe("[DONE]");
    expect(frames.slice(0, -1).map((frame) => JSON.parse(frame))).toEqual([
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  index: 0,
                  id: "call-actestra-1",
                  type: "function",
                  function: {
                    name: "actestra-capability-proxy__coding.file.read",
                    arguments: "",
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: '{"contractVersion":1,"path":"README.md"}',
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
      {
        id: "chatcmpl-actestra-1",
        object: "chat.completion.chunk",
        created: 0,
        model: "actestra-caller-model",
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
      },
    ]);
  });

  it("rejects a completion tool call that was not declared in the inference request", async () => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        return Object.freeze({
          type: "tool-call" as const,
          callId: "call-undeclared-tool",
          name: "actestra-capability-proxy__coding.file.write",
          arguments: Object.freeze({ contractVersion: 1 }),
          usage: Object.freeze({ promptTokens: 3, completionTokens: 2 }),
        });
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify({
        model: "actestra-caller-model",
        messages: [{ role: "user", content: "Use only the declared tool." }],
        tools: [
          {
            type: "function",
            function: {
              name: "actestra-capability-proxy__coding.file.read",
              parameters: { type: "object" },
            },
          },
        ],
        stream: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it.each([
    {
      caseName: "message completion",
      completion: {
        type: "message",
        text: "must not cross the broker",
        usage: { promptTokens: 3, completionTokens: 2 },
        providerBody: { raw: true },
      },
      tools: [],
    },
    {
      caseName: "tool-call completion",
      completion: {
        type: "tool-call",
        callId: "call-extra-field",
        name: "actestra-capability-proxy__coding.file.read",
        arguments: { contractVersion: 1 },
        usage: { promptTokens: 3, completionTokens: 2 },
        providerBody: { raw: true },
      },
      tools: [
        {
          type: "function",
          function: {
            name: "actestra-capability-proxy__coding.file.read",
            parameters: { type: "object" },
          },
        },
      ],
    },
    {
      caseName: "usage",
      completion: {
        type: "message",
        text: "must not cross the broker",
        usage: {
          promptTokens: 3,
          completionTokens: 2,
          headers: { authorization: "must-not-cross-the-broker" },
        },
      },
      tools: [],
    },
  ])("rejects unknown fields in a $caseName before SSE", async ({ completion, tools }) => {
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel() {
        return completion as unknown as GooseLoopbackModelCompletion;
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const response = await fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify({
        model: "actestra-caller-model",
        messages: [{ role: "user", content: "Return one bounded answer." }],
        tools,
        stream: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("aborts and awaits an in-flight model invocation before closing its listener", async () => {
    let invocationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      invocationStarted = resolve;
    });
    let releaseInvocation!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseInvocation = resolve;
    });
    let invocationSignal: AbortSignal | undefined;
    const server = await startGooseLoopbackModelServer({
      modelId: "actestra-caller-model",
      attemptLease: MODEL_LEASE,
      async invokeModel(_invocation, signal) {
        invocationSignal = signal;
        invocationStarted();
        await released;
        throw new Error("released after model proxy close");
      },
    });
    openServers.push(server);
    server.bindSession("goose-session-1");

    const inference = fetch(`${server.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MODEL_LEASE}`,
        "Content-Type": "application/json",
        "agent-session-id": "goose-session-1",
      },
      body: JSON.stringify({
        model: "actestra-caller-model",
        messages: [{ role: "user", content: "Wait for cancellation." }],
        stream: true,
      }),
    });
    await started;

    const closing = server.close();
    let closeSettled = false;
    void closing.then(
      () => {
        closeSettled = true;
      },
      () => {
        closeSettled = true;
      },
    );
    try {
      await expect(inference).rejects.toBeInstanceOf(TypeError);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(invocationSignal?.aborted).toBe(true);
      expect(closeSettled).toBe(false);
    } finally {
      releaseInvocation();
      await closing;
    }
  });

  it.each([
    { modelId: "", attemptLease: MODEL_LEASE, invokeModel: modelInvoker },
    { modelId: "unsafe model", attemptLease: MODEL_LEASE, invokeModel: modelInvoker },
    { modelId: "actestra-caller-model", attemptLease: "short", invokeModel: modelInvoker },
  ])("rejects invalid catalog options before listening", async (options) => {
    await expect(startGooseLoopbackModelServer(options)).rejects.toBeInstanceOf(
      GooseLoopbackModelServerError,
    );
  });
});
