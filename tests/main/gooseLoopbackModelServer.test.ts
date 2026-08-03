import { afterEach, describe, expect, it } from "vitest";
import {
  GooseLoopbackModelServerError,
  startGooseLoopbackModelServer,
  type GooseLoopbackModelServer,
  type GooseLoopbackModelInvoker,
} from "../../apps/desktop/src/main/workers/gooseLoopbackModelServer";

const MODEL_LEASE = "model-lease-0123456789abcdef0123456789abcdef";
const modelInvoker: GooseLoopbackModelInvoker = async () =>
  Object.freeze({
    type: "message",
    text: "bounded model response",
    usage: Object.freeze({ promptTokens: 7, completionTokens: 3 }),
  });
const openServers: GooseLoopbackModelServer[] = [];

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
    expect(Object.keys(server).sort()).toEqual(["baseUrl", "bindSession", "close"]);
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

    const requestBody = {
      model: "actestra-caller-model",
      messages: [{ role: "user", content: "Return one bounded answer." }],
      stream: true,
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
        modelId: "actestra-caller-model",
        request: requestBody,
      },
    ]);
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
