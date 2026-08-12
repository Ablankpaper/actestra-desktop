// @vitest-environment node

import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type {
  ActestraMainModelCompletion,
  ActestraMainModelInvoker,
} from "../../apps/desktop/src/main/model/actestraMainModelBroker";
import { GENERAL_DRAFT_SYSTEM_PROMPT } from "../../apps/desktop/src/core/generalDraftContract";
import {
  startTrustedActestraGeneralWorkRuntime,
  type ActestraGeneralWorkModelBinding,
} from "../../apps/desktop/src/main/workers/actestraGeneralWorkRuntime";

const invocation = Object.freeze({
  sessionId: "session-general-model",
  prompt: "Write a bounded release note.",
});

describe("trusted Actestra General Work runtime startup", () => {
  it("depends only on the Actestra Main model broker port", async () => {
    const source = await readFile(
      "apps/desktop/src/main/workers/actestraGeneralWorkRuntime.ts",
      "utf8",
    );

    expect(source).toContain("../model/actestraMainModelBroker");
    expect(source).not.toMatch(/goose/iu);
  });

  it("fails closed when the Main-owned model binding is absent or malformed", () => {
    expect(startTrustedActestraGeneralWorkRuntime({ modelBinding: null })).toBeNull();
    expect(
      startTrustedActestraGeneralWorkRuntime({
        modelBinding: {
          modelId: "actestra.test.model",
          invokeModel: async () => ({
            type: "message",
            text: "unused",
            usage: { promptTokens: 1, completionTokens: 1 },
          }),
          apiKey: "must-not-enter-the-binding",
        } as ActestraGeneralWorkModelBinding,
      }),
    ).toBeNull();
  });

  it("keeps the provider invoker in Main and returns only bounded text", async () => {
    const invokeModel = vi.fn<ActestraMainModelInvoker>(async () => ({
      type: "message",
      text: "# Release note\n\nReady for review.\n",
      usage: { promptTokens: 5, completionTokens: 8 },
    }));
    const binding = Object.freeze({
      modelId: "actestra.test.model",
      invokeModel,
    }) satisfies ActestraGeneralWorkModelBinding;

    const runtime = startTrustedActestraGeneralWorkRuntime({ modelBinding: binding });
    const abortController = new AbortController();

    await expect(runtime!.invoke(invocation, abortController.signal)).resolves.toEqual({
      content: "# Release note\n\nReady for review.\n",
    });
    expect(runtime!.modelId).toBe(binding.modelId);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(invokeModel).toHaveBeenCalledWith(
      {
        sessionId: invocation.sessionId,
        purpose: "general-work",
        messages: [
          // Asserted against the shared constant so the envelope contract has one source of truth.
          { role: "system", content: GENERAL_DRAFT_SYSTEM_PROMPT },
          { role: "user", content: invocation.prompt },
        ],
        tools: [],
        responseMode: "text",
      },
      abortController.signal,
    );
  });

  it("rejects tool calls and oversized output without exposing provider details", async () => {
    const toolCallInvoker: ActestraMainModelInvoker = async () => ({
      type: "tool-call",
      callId: "call-secret",
      name: "dangerous_tool",
      arguments: { credential: "secret" },
      usage: { promptTokens: 1, completionTokens: 1 },
    });
    const oversizedInvoker: ActestraMainModelInvoker = async () => ({
      type: "message",
      text: "x".repeat(96 * 1024 + 1),
      usage: { promptTokens: 1, completionTokens: 1 },
    });

    const toolRuntime = startTrustedActestraGeneralWorkRuntime({
      modelBinding: { modelId: "actestra.test.model", invokeModel: toolCallInvoker },
    });
    const oversizedRuntime = startTrustedActestraGeneralWorkRuntime({
      modelBinding: { modelId: "actestra.test.model", invokeModel: oversizedInvoker },
    });

    // The provider answered, just not with a usable draft turn, so this is a refusal not an outage.
    await expect(
      toolRuntime!.invoke(invocation, new AbortController().signal),
    ).rejects.toMatchObject({ code: "model-completion-refused" });
    await expect(
      oversizedRuntime!.invoke(invocation, new AbortController().signal),
    ).rejects.toMatchObject({ code: "model-completion-refused" });
    // Neither the tool name nor the provider payload may travel in the message.
    await expect(toolRuntime!.invoke(invocation, new AbortController().signal)).rejects.toThrow(
      /^General Work model returned no usable completion$/u,
    );
  });

  // General v1 is text-only by contract. It must never be handed tools, and the
  // prompt must state the boundary so a gap comes back as a structured needs-input
  // envelope rather than a placeholder the runtime has no way to fill. This asserts
  // the request Main sends, which is the part the runtime controls; a reply that
  // ignores the envelope is caught by validation, not here.
  it("states its text-only v1 scope and never offers tools", async () => {
    const invokeModel = vi.fn<ActestraMainModelInvoker>(async () => ({
      type: "message",
      text: "# Draft\n\nThe prompt did not include the README contents.\n",
      usage: { promptTokens: 4, completionTokens: 8 },
    }));

    const runtime = startTrustedActestraGeneralWorkRuntime({
      modelBinding: { modelId: "actestra.test.model", invokeModel },
    });
    await runtime!.invoke(invocation, new AbortController().signal);

    const [request] = invokeModel.mock.calls[0]!;
    expect(request.tools).toEqual([]);
    expect(request.responseMode).toBe("text");
    const systemMessage = request.messages[0]!;
    expect(systemMessage.role).toBe("system");
    const systemPrompt = systemMessage.role === "system" ? systemMessage.content : "";
    expect(systemPrompt).toMatch(/no file, repository, or network access/i);
    expect(systemPrompt).toMatch(/never leave a placeholder/i);
    // Spec B: a gap is reported through the structured needs-input status, not narrated in prose.
    expect(systemPrompt).toMatch(/"status":"needs-input"/u);
    expect(systemPrompt).toMatch(/missing_inputs/u);
  });

  it("rejects message completions with unknown provider fields", async () => {
    const invokeModel: ActestraMainModelInvoker = async () =>
      ({
        type: "message",
        text: "must not cross the broker",
        usage: { promptTokens: 1, completionTokens: 1 },
        providerBody: { raw: true },
      }) as unknown as ActestraMainModelCompletion;
    const runtime = startTrustedActestraGeneralWorkRuntime({
      modelBinding: { modelId: "actestra.test.model", invokeModel },
    });

    await expect(runtime!.invoke(invocation, new AbortController().signal)).rejects.toThrow(
      "General Work model response is unavailable",
    );
  });

  it("rejects usage with unknown header fields", async () => {
    const invokeModel: ActestraMainModelInvoker = async () =>
      ({
        type: "message",
        text: "must not cross the broker",
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          headers: { authorization: "must-not-cross-the-broker" },
        },
      }) as unknown as ActestraMainModelCompletion;
    const runtime = startTrustedActestraGeneralWorkRuntime({
      modelBinding: { modelId: "actestra.test.model", invokeModel },
    });

    await expect(runtime!.invoke(invocation, new AbortController().signal)).rejects.toThrow(
      "General Work model response is unavailable",
    );
  });
});
