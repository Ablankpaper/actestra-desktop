// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { assertActestraMainModelCompletion } from "../../apps/desktop/src/main/model/actestraMainModelBroker";
import { resolveAionCoreMainModelBinding } from "../../apps/desktop/src/main/model/aionCoreMainModelBinding";

const MAX_MAIN_MODEL_JSON_DEPTH = 64;
const MAX_MAIN_MODEL_JSON_NODES = 16_384;
const MAX_MAIN_MODEL_JSON_UTF8_BYTES = 256 * 1024;

function nestedJsonObject(depth: number): { readonly nested?: unknown } {
  let value: { readonly nested?: unknown } = {};
  for (let level = 0; level < depth; level += 1) {
    value = { nested: value };
  }
  return value;
}

function toolCallCompletion(argumentsValue: unknown): unknown {
  return {
    type: "tool-call",
    callId: "call-bounded-json",
    name: "bounded_tool",
    arguments: argumentsValue,
    usage: { promptTokens: 1, completionTokens: 1 },
  };
}

const READ_FILE_TOOL = Object.freeze({
  name: "read_file",
  description: "Read one admitted workspace file.",
  inputSchema: Object.freeze({
    type: "object",
    properties: Object.freeze({ path: Object.freeze({ type: "string" }) }),
    required: Object.freeze(["path"]),
  }),
});

function admittedProvider(): Record<string, unknown> {
  return {
    id: "provider-anhepro",
    platform: "openai",
    name: "Anhepro",
    base_url: "https://gateway.invalid/v1",
    api_key: "provider-secret-placeholder",
    models: ["gpt-5.4-openai-compact"],
    enabled: true,
    capabilities: [{ type: "text" }, { type: "function_calling" }],
    model_health: { "gpt-5.4-openai-compact": { status: "healthy" } },
  };
}

async function bindingWithClient(
  createChatCompletion: (request: unknown) => Promise<unknown>,
): Promise<{
  readonly invoke: (tools: readonly unknown[]) => Promise<unknown>;
  readonly requests: readonly unknown[];
}> {
  const requests: unknown[] = [];
  const binding = await resolveAionCoreMainModelBinding({
    selection: { providerId: "provider-anhepro", modelId: "gpt-5.4-openai-compact" },
    listProviders: async () => [admittedProvider()],
    createClient: async () => ({
      createChatCompletion: async (request: unknown) => {
        requests.push(request);
        return await createChatCompletion(request);
      },
    }),
  });
  if (binding === null) throw new Error("expected an admitted Main-owned binding");
  return {
    requests,
    invoke: async (tools) =>
      await binding.invokeModel(
        {
          sessionId: "session-stream",
          purpose: "coding",
          messages: [{ role: "user", content: "Read /tmp/test.txt" }],
          tools: tools as never,
          responseMode: "text-or-tool-call",
        },
        new AbortController().signal,
      ),
  };
}

async function* streamedChunks(chunks: readonly unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) yield chunk;
}

describe("Actestra Main model broker boundary", () => {
  it("owns the shared model contract while Goose remains an adapter consumer", async () => {
    const [broker, goose, coding, general] = await Promise.all([
      readFile("apps/desktop/src/main/model/actestraMainModelBroker.ts", "utf8"),
      readFile("apps/desktop/src/main/workers/gooseLoopbackModelServer.ts", "utf8"),
      readFile("apps/desktop/src/main/workers/actestraCodingJourneyRuntime.ts", "utf8"),
      readFile("apps/desktop/src/main/workers/actestraGeneralWorkRuntime.ts", "utf8"),
    ]);

    expect(broker).toContain("export interface ActestraMainModelBrokerPort");
    expect(broker).toContain("export type ActestraMainModelJsonValue");
    expect(broker).toContain("export type ActestraMainModelMessage");
    expect(broker).toContain("export interface ActestraMainModelTool");
    expect(broker).not.toMatch(/\bRecord\s*</u);
    expect(broker).not.toMatch(/api[_-]?key|base[_-]?url|credential|provider dto/iu);
    const invocationContract = broker.slice(
      broker.indexOf("export interface ActestraMainModelInvocation"),
      broker.indexOf("export type ActestraMainModelInvoker"),
    );
    expect(invocationContract).toContain('readonly purpose: "general-work" | "coding";');
    expect(invocationContract).toContain("readonly messages: readonly ActestraMainModelMessage[];");
    expect(invocationContract).toContain("readonly tools: readonly ActestraMainModelTool[];");
    expect(invocationContract).toContain('readonly responseMode: "text" | "text-or-tool-call";');
    expect(invocationContract).not.toMatch(
      /\b(?:modelId|request|stream|baseUrl|apiKey|headers|providerBody)\b/u,
    );
    expect(goose).toContain("../model/actestraMainModelBroker");
    expect(coding).toContain("../model/actestraMainModelBroker");
    expect(general).toContain("../model/actestraMainModelBroker");
    expect(general).not.toMatch(/goose/iu);
  });

  it("accepts completion arguments at the JSON depth limit and rejects limit plus one", () => {
    expect(() =>
      assertActestraMainModelCompletion(
        toolCallCompletion(nestedJsonObject(MAX_MAIN_MODEL_JSON_DEPTH)),
      ),
    ).not.toThrow();

    expect(() =>
      assertActestraMainModelCompletion(
        toolCallCompletion(nestedJsonObject(MAX_MAIN_MODEL_JSON_DEPTH + 1)),
      ),
    ).toThrow("Actestra Main model completion is invalid");
  });

  it("rejects completion arguments above the bounded JSON node budget", () => {
    const argumentsValue = {
      values: Array.from({ length: MAX_MAIN_MODEL_JSON_NODES }, () => null),
    };

    expect(() => assertActestraMainModelCompletion(toolCallCompletion(argumentsValue))).toThrow(
      "Actestra Main model completion is invalid",
    );
  });

  it("rejects completion arguments above the aggregate UTF-8 key and string budget", () => {
    const utf8Component = "界".repeat(Math.floor(MAX_MAIN_MODEL_JSON_UTF8_BYTES / 6) + 1);
    const argumentsValue = { [utf8Component]: utf8Component };

    expect(() => assertActestraMainModelCompletion(toolCallCompletion(argumentsValue))).toThrow(
      "Actestra Main model completion is invalid",
    );
  });

  it("recovers a streamed tool call the non-streaming gateway path omits", async () => {
    const { invoke, requests } = await bindingWithClient(async () =>
      streamedChunks([
        {
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_Fc2wnLAcBNJjF9QYOmzEP4UG",
                    function: { name: "read_file", arguments: '{"path":' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index: 0, function: { arguments: '"/tmp/test.txt"}' } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
        { choices: [], usage: { prompt_tokens: 754, completion_tokens: 21 } },
      ]),
    );

    const completion = await invoke([READ_FILE_TOOL]);

    expect(completion).toStrictEqual({
      type: "tool-call",
      callId: "call_Fc2wnLAcBNJjF9QYOmzEP4UG",
      name: "read_file",
      arguments: { path: "/tmp/test.txt" },
      usage: { promptTokens: 754, completionTokens: 21 },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("keeps the non-streaming request shape when the invocation declares no tool", async () => {
    const { invoke, requests } = await bindingWithClient(async () => ({
      choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    }));

    const completion = await invoke([]);

    expect(completion).toStrictEqual({
      type: "message",
      text: "done",
      usage: { promptTokens: 12, completionTokens: 3 },
    });
    expect(requests[0]).toMatchObject({ stream: false });
    expect(requests[0]).not.toHaveProperty("tools");
    expect(requests[0]).not.toHaveProperty("stream_options");
    expect(requests[0]).not.toHaveProperty("parallel_tool_calls");
  });

  it("requests parallel_tool_calls=false whenever the invocation declares a tool", async () => {
    const { invoke, requests } = await bindingWithClient(async () =>
      streamedChunks([
        {
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  { index: 0, id: "call_single", function: { name: "read_file", arguments: "{}" } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]),
    );

    await invoke([READ_FILE_TOOL]);

    expect(requests[0]).toMatchObject({ parallel_tool_calls: false });
  });

  it("still refuses a gateway that returns two tool calls despite parallel_tool_calls=false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { invoke, requests } = await bindingWithClient(async () =>
        streamedChunks([
          {
            choices: [
              {
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_first",
                      function: { name: "read_file", arguments: '{"path":"/tmp/a.txt"}' },
                    },
                    {
                      index: 1,
                      id: "call_second",
                      function: { name: "read_file", arguments: '{"path":"/tmp/b.txt"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        ]),
      );

      await expect(invoke([READ_FILE_TOOL])).rejects.toThrow(
        "AionCore model completion is unavailable",
      );

      expect(requests[0]).toMatchObject({ parallel_tool_calls: false });
      const rejection = warn.mock.calls
        .map(([line]) => String(line))
        .find((line) => line.startsWith("ACTESTRA_AIONUI_MODEL_COMPLETION_REJECTED "));
      expect(rejection).toBeDefined();
      const diagnostics = JSON.parse(
        rejection!.slice("ACTESTRA_AIONUI_MODEL_COMPLETION_REJECTED ".length),
      ) as { reason: string; request: { parallelToolCalls: unknown } };
      // The recorded shape proves the gateway overrode an explicit single-call request.
      expect(diagnostics.reason).toBe("tool-call-count-unsupported");
      expect(diagnostics.request.parallelToolCalls).toBe(false);
      expect(rejection).not.toContain("/tmp/a.txt");
      expect(rejection).not.toContain("/tmp/b.txt");
      expect(rejection).not.toContain("provider-secret-placeholder");
    } finally {
      warn.mockRestore();
    }
  });

  it("reports a refused completion by structure without recording model or provider text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { invoke } = await bindingWithClient(async () =>
        streamedChunks([
          {
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "", refusal: "secret refusal text" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 754,
              completion_tokens: 90,
              completion_tokens_details: { reasoning_tokens: 90 },
            },
          },
        ]),
      );

      await expect(invoke([READ_FILE_TOOL])).rejects.toThrow(
        "AionCore model completion is unavailable",
      );

      expect(warn).toHaveBeenCalledTimes(1);
      const entry = String(warn.mock.calls[0]?.[0]);
      expect(entry).toContain("ACTESTRA_AIONUI_MODEL_COMPLETION_REJECTED");
      const report = JSON.parse(entry.slice(entry.indexOf(" ") + 1)) as Record<string, never>;
      expect(report).toMatchObject({
        reason: "content-empty",
        finishReason: "stop",
        promptTokens: 754,
        completionTokens: 90,
        completionTokensDetails: { kind: "object", keys: ["reasoning_tokens"] },
        content: { kind: "string", length: 0 },
        toolCalls: { kind: "undefined" },
        request: { stream: true, toolCount: 1, tools: [{ name: "read_file" }] },
      });
      expect(entry).not.toContain("secret refusal text");
      expect(entry).not.toContain("/tmp/test.txt");
      expect(entry).not.toContain("provider-secret-placeholder");
      expect(entry).not.toContain("gateway.invalid");
    } finally {
      warn.mockRestore();
    }
  });
});
