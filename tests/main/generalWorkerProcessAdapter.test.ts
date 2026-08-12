import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correlationId,
  eventId,
  instant,
  toolOutputReference,
  toolRequestId,
  type AgentCapabilities,
  type EventId,
} from "../../apps/desktop/src/core";
import {
  AgentAdapterSupervisor,
  type AgentAdapterSupervisorConfig,
} from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  GeneralWorkerProcessAdapter,
} from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import {
  ActestraGeneralWorkModelError,
  type TrustedActestraGeneralWorkRuntime,
} from "../../apps/desktop/src/main/workers/actestraGeneralWorkRuntime";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { GENERAL_WORKER_PROTOCOL_VERSION } from "../../apps/desktop/src/shared/generalWorkerProtocol";
import { createAgentStartRequest, FIXTURE_AGENT_SESSION_ID } from "../fixtures/agentAdapter";
import { LoopbackGeneralWorkerTransport, openTestGeneralWorker } from "../fixtures/generalWorker";

const SUPERVISOR_CONFIG = {
  expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
  requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 0,
} as const satisfies AgentAdapterSupervisorConfig;

function clock(): DeterministicAgentClock {
  return new DeterministicAgentClock(instant("2026-07-30T02:00:00.000Z"));
}

function deterministicEventIds(): () => EventId {
  let sequence = 0;
  return () => {
    sequence += 1;
    return eventId(`general-worker-event-${sequence}`);
  };
}

async function settledSnapshot(
  supervisor: AgentAdapterSupervisor,
  state: "completed" | "failed" | "cancelled" | "crashed" | "protocol-failed",
) {
  await vi.waitFor(() => {
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state,
      disposed: true,
    });
  });
  return supervisor.snapshot(FIXTURE_AGENT_SESSION_ID);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("General Worker process AgentAdapter v2", () => {
  it("negotiates exact capabilities and completes one no-tool process journey", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "no-tool-complete",
      newAttemptToken: () => "general-worker-attempt",
      newEventId: deterministicEventIds(),
    });
    const capabilities = await adapter.capabilities();
    expect(capabilities).toEqual({
      protocolVersion: 2,
      adapterKind: GENERAL_WORKER_ADAPTER_KIND,
      capabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      maxConcurrentSessions: 1,
      heartbeatIntervalMs: 1_000,
    } satisfies AgentCapabilities);
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);

    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    await settledSnapshot(supervisor, "completed");
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "agent.message",
      "task.completed",
    ]);
    await adapter.close();
    expect(transport.killCount).toBeGreaterThanOrEqual(1);
  });

  it("maps one typed tool result without giving the worker raw content", async () => {
    const agentClock = clock();
    const requestIdValue = toolRequestId("general-worker-tool-request");
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "tool-fixture",
      newAttemptToken: () => "general-worker-tool-attempt",
      newToolRequestId: () => requestIdValue,
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("blocked");
    expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBe(requestIdValue);
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "task.updated",
      "worker.blocked",
    ]);

    agentClock.advance(10);
    await supervisor.resolveTool(requestIdValue, {
      requestId: requestIdValue,
      status: "succeeded",
      startedAt: agentClock.now(),
      completedAt: agentClock.now(),
      outputRef: toolOutputReference("general-worker-tool-output"),
      summary: "Created one bounded output reference.",
    });
    await settledSnapshot(supervisor, "completed");
    expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBeUndefined();
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "tool.requested",
      "task.updated",
      "worker.blocked",
      "tool.started",
      "tool.completed",
      "task.updated",
      "task.completed",
    ]);
  });

  it("routes a sequenced model request through the Main-only runtime and keeps output private", async () => {
    const agentClock = clock();
    const requestIdValue = toolRequestId("general-worker-model-write-request");
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () => ({
      content: JSON.stringify({
        status: "completed",
        markdown: "# Main model draft\n\nReady for review.\n",
      }),
    }));
    const modelRuntime = Object.freeze({
      modelId: "actestra.test.model",
      invoke,
    }) satisfies TrustedActestraGeneralWorkRuntime;
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime,
      newAttemptToken: () => "general-worker-model-attempt",
      newToolRequestId: () => requestIdValue,
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);

    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Write a bounded Team launch note.",
      }),
    );
    await adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => {
      expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBe(requestIdValue);
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]![0]).toEqual({
      sessionId: FIXTURE_AGENT_SESSION_ID,
      prompt: "Write a bounded Team launch note.",
    });
    expect(invoke.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(invoke.mock.calls[0]![1].aborted).toBe(false);
    expect(adapter.activeToolInput(requestIdValue)).toEqual({
      contractVersion: 1,
      relativePath: "draft.md",
      mediaType: "text/markdown; charset=utf-8",
      content: "# Main model draft\n\nReady for review.\n",
    });
    expect(JSON.stringify(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID))).not.toContain(
      "Main model draft",
    );
  });

  it("fails closed without a second provider request while resolve-model acknowledgement is pending", async () => {
    const agentClock = clock();
    const invoke = vi.fn<TrustedActestraGeneralWorkRuntime["invoke"]>(async () => ({
      content: "# One model result\n",
    }));
    const transport = new LoopbackGeneralWorkerTransport();
    const connecting = GeneralWorkerProcessAdapter.connect(transport, agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
      newAttemptToken: () => "general-worker-model-once-attempt",
      newEventId: deterministicEventIds(),
    });
    transport.start();
    const adapter = await connecting;
    const originalPostMessage = transport.postMessage.bind(transport);
    let duplicateInjected = false;
    transport.postMessage = (message: unknown) => {
      if (
        !duplicateInjected &&
        typeof message === "object" &&
        message !== null &&
        (message as { readonly operation?: unknown }).operation === "resolve-model"
      ) {
        duplicateInjected = true;
        transport.emitMessage({
          protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
          type: "event",
          attemptToken: "general-worker-model-once-attempt",
          sequence: 3,
          event: {
            type: "model-requested",
            callId: "general-worker-model-second-call",
            prompt: "Write a bounded Team launch note.",
          },
        });
      }
      originalPostMessage(message);
    };
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);

    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Write a bounded Team launch note.",
      }),
    );
    await adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => expect(duplicateInjected).toBe(true));
    await settledSnapshot(supervisor, "protocol-failed");
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("aborts and removes a pending model when the start response fails after model dispatch", async () => {
    const agentClock = clock();
    let modelSignal: AbortSignal | undefined;
    let resolveProvider: ((result: Readonly<{ content: string }>) => void) | undefined;
    const invoke = vi.fn(
      (_input: { readonly sessionId: string; readonly prompt: string }, signal: AbortSignal) => {
        modelSignal = signal;
        return new Promise<Readonly<{ content: string }>>((resolve) => {
          resolveProvider = resolve;
        });
      },
    );
    const modelRuntime = Object.freeze({ modelId: "actestra.test.model", invoke });
    const transport = new LoopbackGeneralWorkerTransport();
    const operations: string[] = [];
    const originalPostMessage = transport.postMessage.bind(transport);
    let startRequestId: string | undefined;
    transport.postMessage = (message: unknown) => {
      if (typeof message === "object" && message !== null) {
        const operation = (message as { readonly operation?: unknown }).operation;
        if (typeof operation === "string") {
          operations.push(operation);
        }
        if (
          operation === "start" &&
          typeof (message as { readonly requestId?: unknown }).requestId === "string"
        ) {
          startRequestId = (message as { readonly requestId: string }).requestId;
          transport.dropNextResponse();
        }
      }
      originalPostMessage(message);
    };
    const connecting = GeneralWorkerProcessAdapter.connect(transport, agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime,
      newAttemptToken: () => "general-worker-model-start-failure-attempt",
      newEventId: deterministicEventIds(),
    });
    transport.start();
    const adapter = await connecting;
    const starting = adapter.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Start a bounded model writing attempt.",
      }),
    );
    const releasing = adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledOnce();
      expect(startRequestId).toBeTypeOf("string");
    });
    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "response",
      requestId: startRequestId,
      operation: "start",
      ok: false,
      error: {
        code: "invalid-state",
        message: "The start response failed after dispatching the model request.",
      },
    });

    await expect(starting).rejects.toMatchObject({
      name: "AgentAdapterError",
      code: "invalid-state",
    });
    await releasing;
    expect(modelSignal?.aborted).toBe(true);
    await expect(
      adapter.send(FIXTURE_AGENT_SESSION_ID, {
        messageId: correlationId("late-start-send"),
        content: "must not reach a removed attempt",
        sentAt: agentClock.now(),
      }),
    ).rejects.toMatchObject({ code: "unknown-session" });

    resolveProvider?.({ content: "private late model content" });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(operations).not.toContain("resolve-model");
  });

  it("rejects model execution mode before an attempt when no Main runtime is admitted", async () => {
    const transport = new LoopbackGeneralWorkerTransport();
    const connecting = GeneralWorkerProcessAdapter.connect(transport, clock(), {
      executionMode: "model-writing-artifact",
    });
    transport.start();

    await expect(connecting).rejects.toMatchObject({
      name: "GeneralWorkerProcessError",
      code: "operation-failed",
      message: expect.stringMatching(/model runtime/u),
    });
  });

  it("times out a Main model call, aborts it, and emits only a bounded public failure", async () => {
    const agentClock = clock();
    let modelSignal: AbortSignal | undefined;
    const invoke = vi.fn(
      (_input: { readonly sessionId: string; readonly prompt: string }, signal: AbortSignal) => {
        modelSignal = signal;
        return new Promise<Readonly<{ content: string }>>(() => undefined);
      },
    );
    const modelRuntime = Object.freeze({ modelId: "actestra.test.model", invoke });
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime,
      modelTimeoutMs: 10,
      newAttemptToken: () => "general-worker-model-timeout-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    vi.useFakeTimers();
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Wait for a bounded model timeout.",
      }),
    );
    const releasing = adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(11);

    await settledSnapshot(supervisor, "failed");
    await releasing;
    expect(modelSignal?.aborted).toBe(true);
    expect(JSON.stringify(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID))).toContain(
      "model-timeout",
    );
  });

  it("aborts a pending model call on cancellation and ignores its late settlement", async () => {
    const agentClock = clock();
    let modelSignal: AbortSignal | undefined;
    let resolveProvider: ((result: Readonly<{ content: string }>) => void) | undefined;
    const invoke = vi.fn(
      (_input: { readonly sessionId: string; readonly prompt: string }, signal: AbortSignal) =>
        new Promise<Readonly<{ content: string }>>((resolve) => {
          modelSignal = signal;
          resolveProvider = resolve;
        }),
    );
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
      newAttemptToken: () => "general-worker-model-cancel-attempt",
      newEventId: deterministicEventIds(),
    });
    const operations: string[] = [];
    const originalPostMessage = transport.postMessage.bind(transport);
    transport.postMessage = (message: unknown) => {
      if (typeof message === "object" && message !== null) {
        const operation = (message as { readonly operation?: unknown }).operation;
        if (typeof operation === "string") {
          operations.push(operation);
        }
      }
      originalPostMessage(message);
    };
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Cancel the pending model call.",
      }),
    );
    const releasing = adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "User cancelled model work");
    await settledSnapshot(supervisor, "cancelled");
    await releasing;
    expect(modelSignal?.aborted).toBe(true);
    resolveProvider?.({ content: "private late model content" });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(operations).not.toContain("resolve-model");
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "task.cancelled",
    ]);
    const eventText = JSON.stringify(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID));
    expect(eventText).not.toContain("private late model content");
    expect(eventText).not.toContain("tool.requested");
  });

  it("redacts provider failures before they enter the worker protocol", async () => {
    const agentClock = clock();
    const invoke = vi.fn(async () => {
      throw new Error("provider secret /private/credential.json");
    });
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
      newAttemptToken: () => "general-worker-model-redaction-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Surface a bounded provider failure.",
      }),
    );
    await adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await settledSnapshot(supervisor, "failed");
    const eventText = JSON.stringify(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID));
    expect(eventText).toContain("model-unavailable");
    expect(eventText).toContain("The admitted model is unavailable.");
    expect(eventText).not.toContain("provider secret");
    expect(eventText).not.toContain("credential.json");
  });

  it("keeps a classified provider refusal apart from an outage", async () => {
    const agentClock = clock();
    // The provider answered; the answer was just not a usable draft turn. Spec F6 keeps that distinct
    // from an unreachable provider, because only one of the two is worth retrying as-is.
    const invoke = vi.fn(async () => {
      throw new ActestraGeneralWorkModelError(
        "model-completion-refused",
        "provider secret /private/credential.json",
      );
    });
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
      newAttemptToken: () => "general-worker-model-refusal-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Surface a classified provider refusal.",
      }),
    );
    await adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await settledSnapshot(supervisor, "failed");
    const eventText = JSON.stringify(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID));
    expect(eventText).toContain("model-completion-refused");
    expect(eventText).toContain("The admitted model returned no usable completion.");
    // The error's own type decides the code, so a refusal is never flattened into an outage.
    expect(eventText).not.toContain("model-unavailable");
    // The classification changes nothing about redaction: the provider's own words stay out.
    expect(eventText).not.toContain("provider secret");
    expect(eventText).not.toContain("credential.json");
  });

  it("rejects a tool event interleaved while the Main model request is pending", async () => {
    const agentClock = clock();
    let modelSignal: AbortSignal | undefined;
    const invoke = vi.fn(
      (_input: { readonly sessionId: string; readonly prompt: string }, signal: AbortSignal) => {
        modelSignal = signal;
        return new Promise<Readonly<{ content: string }>>(() => undefined);
      },
    );
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
      newAttemptToken: () => "general-worker-model-interleave-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Keep the model phase isolated.",
      }),
    );
    const releasing = adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "general-worker-model-interleave-attempt",
      sequence: 3,
      event: {
        type: "tool-requested",
        callId: "interleaved-tool-call",
        toolName: "actestra.task-output.write-text",
        summary: "Must not interleave before the Main model result.",
      },
    });

    await settledSnapshot(supervisor, "protocol-failed");
    await releasing;
    expect(invoke).toHaveBeenCalledOnce();
    expect(modelSignal?.aborted).toBe(true);
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
    ]);
  });

  it("aborts and protocol-fails a forged completed event while the model is pending", async () => {
    const agentClock = clock();
    let modelSignal: AbortSignal | undefined;
    const invoke = vi.fn(
      (_input: { readonly sessionId: string; readonly prompt: string }, signal: AbortSignal) => {
        modelSignal = signal;
        return new Promise<Readonly<{ content: string }>>(() => undefined);
      },
    );
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "model-writing-artifact",
      modelRuntime: Object.freeze({ modelId: "actestra.test.model", invoke }),
      newAttemptToken: () => "general-worker-model-terminal-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Reject a forged terminal model event.",
      }),
    );
    const releasing = adapter.releaseModel(FIXTURE_AGENT_SESSION_ID);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());

    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "general-worker-model-terminal-attempt",
      sequence: 3,
      event: { type: "completed" },
    });

    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("protocol-failed");
    await releasing;
    expect(modelSignal?.aborted).toBe(true);
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
    ]);
  });

  it("keeps Worker-produced task-output input private across a two-tool file journey", async () => {
    const agentClock = clock();
    const requestIds = [
      toolRequestId("general-worker-file-read-request"),
      toolRequestId("general-worker-file-write-request"),
    ] as const;
    let requestIndex = 0;
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "workspace-read-then-task-output-write-fixture",
      newAttemptToken: () => "general-worker-file-attempt",
      newToolRequestId: () => requestIds[requestIndex++]!,
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(
      createAgentStartRequest({
        startedAt: agentClock.now(),
        initialPrompt: "Process the reserved workspace text.",
      }),
    );
    expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBe(requestIds[0]);
    expect(adapter.activeToolInput(requestIds[0])).toBeUndefined();

    agentClock.advance(10);
    await supervisor.resolveTool(requestIds[0], {
      requestId: requestIds[0],
      status: "succeeded",
      startedAt: agentClock.now(),
      completedAt: agentClock.now(),
      outputRef: toolOutputReference("general-worker-file-read-output"),
    });
    await supervisor.send(FIXTURE_AGENT_SESSION_ID, {
      messageId: correlationId("general-worker-file-content"),
      content: "Private source text",
      sentAt: agentClock.now(),
    });

    expect(supervisor.activeToolRequest(FIXTURE_AGENT_SESSION_ID)).toBe(requestIds[1]);
    expect(adapter.activeToolInput(requestIds[1])).toEqual({
      contractVersion: 1,
      relativePath: "result.md",
      mediaType: "text/markdown; charset=utf-8",
      content:
        "# Actestra file result\n\n" +
        "Instruction: Process the reserved workspace text.\n\n" +
        "Source text:\n\nPrivate source text\n",
    });
    expect(JSON.stringify(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID))).not.toContain(
      "Private source text",
    );
  });

  it("acknowledges cancellation through the real process protocol", async () => {
    const agentClock = clock();
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-cancel-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).state).toBe("running");
    await supervisor.cancel(FIXTURE_AGENT_SESSION_ID, "User stopped the task");
    await settledSnapshot(supervisor, "cancelled");
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).at(-1)).toMatchObject({
      type: "task.cancelled",
      payload: { reason: "User stopped the task" },
    });
  });

  it("isolates a throwing signal subscriber and continues peer delivery", async () => {
    const agentClock = clock();
    const { adapter } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-subscriber-attempt",
      newEventId: deterministicEventIds(),
    });
    const peerSignals: string[] = [];
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, () => {
      throw new Error("Subscriber fixture failed");
    });
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => {
      peerSignals.push(signal.type);
    });

    await adapter.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    await vi.waitFor(() => {
      expect(peerSignals).toEqual(["ready", "core-event"]);
    });
    await adapter.close();
  });

  it("treats an exit during the close handshake as expected cleanup", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-close-attempt",
      newEventId: deterministicEventIds(),
    });
    const signals: string[] = [];
    adapter.subscribe(FIXTURE_AGENT_SESSION_ID, (signal) => {
      signals.push(signal.type);
    });
    await adapter.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    await vi.waitFor(() => {
      expect(signals).toEqual(["ready", "core-event"]);
    });

    transport.dropNextResponse();
    const closing = adapter.close();
    transport.crash(0);
    await expect(closing).resolves.toBeUndefined();
    expect(signals).toEqual(["ready", "core-event"]);
  });

  it("maps an unexpected process exit to a retryable worker crash", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-crash-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    transport.crash(9);
    const snapshot = await settledSnapshot(supervisor, "crashed");
    expect(snapshot.incident).toBeUndefined();
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).map((event) => event.type)).toEqual([
      "task.started",
      "task.updated",
      "worker.failed",
    ]);
  });

  it("fails closed on stale attempt identity and wire sequence gaps", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-sequence-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "stale-attempt",
      sequence: 2,
      event: { type: "heartbeat" },
    });
    const stale = await settledSnapshot(supervisor, "protocol-failed");
    expect(stale.incident?.code).toBe("signal-identity-mismatch");

    const secondClock = clock();
    const opened = await openTestGeneralWorker(secondClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-gap-attempt",
      newEventId: deterministicEventIds(),
    });
    const secondSupervisor = new AgentAdapterSupervisor(
      opened.adapter,
      secondClock,
      SUPERVISOR_CONFIG,
    );
    await secondSupervisor.start(createAgentStartRequest({ startedAt: secondClock.now() }));
    opened.transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "general-worker-gap-attempt",
      sequence: 3,
      event: { type: "heartbeat" },
    });
    const gap = await settledSnapshot(secondSupervisor, "protocol-failed");
    expect(gap.incident?.code).toBe("signal-sequence-gap");
  });

  it("fails closed on a malformed active-process message", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      executionMode: "hold",
      newAttemptToken: () => "general-worker-malformed-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    transport.emitMessage({
      protocolVersion: GENERAL_WORKER_PROTOCOL_VERSION,
      type: "event",
      attemptToken: "general-worker-malformed-attempt",
      sequence: 2,
      event: {
        type: "shell",
        command: "whoami",
      },
    });
    const snapshot = await settledSnapshot(supervisor, "protocol-failed");
    expect(snapshot.incident?.code).toBe("invalid-signal");
    expect(transport.killCount).toBeGreaterThanOrEqual(1);
  });

  it("times out an unacknowledged process request and cleans up", async () => {
    const agentClock = clock();
    const { adapter, transport } = await openTestGeneralWorker(agentClock, {
      requestTimeoutMs: 10,
      executionMode: "hold",
      newAttemptToken: () => "general-worker-timeout-attempt",
      newEventId: deterministicEventIds(),
    });
    const supervisor = new AgentAdapterSupervisor(adapter, agentClock, SUPERVISOR_CONFIG);
    vi.useFakeTimers();
    transport.dropNextResponse();
    const starting = supervisor.start(createAgentStartRequest({ startedAt: agentClock.now() }));
    const rejection = expect(starting).rejects.toMatchObject({
      name: "AgentAdapterError",
      code: "adapter-operation-failed",
    });
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    await vi.waitFor(() => {
      expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
        state: "protocol-failed",
        disposed: true,
      });
    });
    expect(transport.killCount).toBeGreaterThanOrEqual(1);
  });

  it("rejects incompatible startup and times out missing negotiation", async () => {
    const incompatible = new LoopbackGeneralWorkerTransport();
    const incompatibleConnection = GeneralWorkerProcessAdapter.connect(incompatible, clock());
    incompatible.start({
      protocolVersion: 1,
      type: "ready",
      role: "general-worker",
      implementationVersion: "0.2.0",
      capabilities: ["messages", "cancellation", "heartbeats", "tool-results", "model-requests"],
      maxConcurrentAttempts: 1,
      heartbeatIntervalMs: 1_000,
    });
    await expect(incompatibleConnection).rejects.toMatchObject({
      message: expect.stringMatching(/protocol version 2/),
    });

    vi.useFakeTimers();
    const silent = new LoopbackGeneralWorkerTransport();
    const timedOut = GeneralWorkerProcessAdapter.connect(silent, clock(), {
      startupTimeoutMs: 10,
    });
    const timeoutExpectation = expect(timedOut).rejects.toMatchObject({
      name: "GeneralWorkerProcessError",
      code: "startup-timeout",
    });
    await vi.advanceTimersByTimeAsync(11);
    await timeoutExpectation;
    expect(silent.killCount).toBeGreaterThanOrEqual(1);
  });
});
