import { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import type { ActestraMainModelInvoker } from "../../apps/desktop/src/main/model/actestraMainModelBroker";
import {
  decodeGooseWindowsModelFrame,
  encodeGooseWindowsModelFrame,
  type GooseWindowsModelFrame,
} from "../../apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol";
import {
  startGooseWindowsModelBridgeHost,
  type GooseWindowsModelBridgeHost,
} from "../../apps/desktop/src/main/workers/gooseWindowsModelBridgeHost";

const LEASE = "lease_0123456789abcdef0123456789abcdef";
const SESSION = "session_0123456789abcdef";

function linkedDuplexPair(): readonly [Duplex, Duplex] {
  let left!: Duplex;
  let right!: Duplex;
  left = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      right.push(chunk);
      callback();
    },
    final(callback) {
      right.push(null);
      callback();
    },
  });
  right = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      left.push(chunk);
      callback();
    },
    final(callback) {
      left.push(null);
      callback();
    },
  });
  return [left, right];
}

async function readFrame(stream: Duplex): Promise<Buffer> {
  let bytes = Buffer.alloc(0);
  for await (const chunk of stream.iterator({ destroyOnReturn: false })) {
    bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
    if (bytes.byteLength >= 4 && bytes.byteLength >= bytes.readUInt32LE(0) + 4) {
      const length = bytes.readUInt32LE(0) + 4;
      return bytes.subarray(0, length);
    }
  }
  throw new Error("bridge closed before a complete frame");
}

function invocation() {
  return {
    sessionId: SESSION,
    purpose: "coding" as const,
    responseMode: "text-or-tool-call" as const,
    messages: [{ role: "user" as const, content: "bounded prompt" }],
    tools: [
      { name: "actestra.coding.file.read-text", inputSchema: {} },
      { name: "actestra.coding.file.write-text", inputSchema: {} },
      { name: "actestra.coding.terminal.run", inputSchema: {} },
      { name: "actestra.coding.git.inspect", inputSchema: {} },
      { name: "actestra.coding.diff.inspect", inputSchema: {} },
      { name: "actestra.coding.test.run", inputSchema: {} },
    ],
  };
}

function request(): GooseWindowsModelFrame {
  return {
    contractVersion: 1,
    kind: "completion-request",
    requestId: "model-request-1",
    lease: LEASE,
    sessionId: SESSION,
    invocation: invocation(),
  };
}

async function closeHost(host: GooseWindowsModelBridgeHost, worker: Duplex): Promise<void> {
  await host.close();
  worker.destroy();
}

describe("Goose Windows Main model bridge host", () => {
  it("serves a validated completion and tracks exact counters", async () => {
    const [main, worker] = linkedDuplexPair();
    const host = startGooseWindowsModelBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeModel: async () => ({
        type: "message",
        text: "bounded completion",
        usage: { promptTokens: 3, completionTokens: 2 },
      }),
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsModelFrame(request()));
    const response = decodeGooseWindowsModelFrame(await readFrame(worker), {
      expectedRequestId: "model-request-1",
    });
    expect(response.kind).toBe("completion-response");
    if (response.kind === "completion-response") expect(response.completion.type).toBe("message");
    expect(host.servedInferenceCount).toBe(1);
    expect(host.refusedInferenceCount).toBe(0);
    expect(host.rejectedRequestCount).toBe(0);
    await closeHost(host, worker);
  });

  it("classifies broker refusal and invalid completion as model refusals", async () => {
    const invokers: readonly ActestraMainModelInvoker[] = [
      async () => {
        throw new Error("broker refused");
      },
      async () => ({
        type: "message",
        text: "invalid usage",
        usage: { promptTokens: -1, completionTokens: 1 },
      }),
    ];
    for (const invokeModel of invokers) {
      const [main, worker] = linkedDuplexPair();
      const host = startGooseWindowsModelBridgeHost({
        stream: main,
        attemptLease: LEASE,
        invokeModel,
      });
      host.bindSession(SESSION);
      worker.write(encodeGooseWindowsModelFrame(request()));
      const response = decodeGooseWindowsModelFrame(await readFrame(worker), {
        expectedRequestId: "model-request-1",
      });
      expect(response).toMatchObject({ kind: "model-error", code: "model-completion-refused" });
      expect(host.servedInferenceCount).toBe(0);
      expect(host.refusedInferenceCount).toBe(1);
      expect(host.rejectedRequestCount).toBe(0);
      await closeHost(host, worker);
    }
  });

  it("does not count a completion that cannot cross the authenticated bridge as served", async () => {
    const [main, worker] = linkedDuplexPair();
    const host = startGooseWindowsModelBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeModel: async () => ({
        type: "tool-call",
        callId: "call-1",
        name: "undeclared-tool",
        arguments: {},
        usage: { promptTokens: 1, completionTokens: 1 },
      }),
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsModelFrame(request()));
    const response = decodeGooseWindowsModelFrame(await readFrame(worker), {
      expectedRequestId: "model-request-1",
    });
    expect(response).toMatchObject({ kind: "model-error", code: "model-completion-refused" });
    expect(host.servedInferenceCount).toBe(0);
    expect(host.refusedInferenceCount).toBe(1);
    expect(host.rejectedRequestCount).toBe(0);
    await closeHost(host, worker);
  });

  it("rejects malformed, wrong-scope, duplicate, and non-request frames", async () => {
    const [main, worker] = linkedDuplexPair();
    const host = startGooseWindowsModelBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeModel: async () => ({
        type: "message",
        text: "unused",
        usage: { promptTokens: 1, completionTokens: 1 },
      }),
    });
    host.bindSession(SESSION);
    const wrong = { ...request(), lease: "lease_wrong_0123456789abcdef0123456789" } as const;
    worker.write(encodeGooseWindowsModelFrame(wrong));
    worker.write(
      encodeGooseWindowsModelFrame({
        contractVersion: 1,
        kind: "completion-response",
        requestId: "model-request-2",
        completion: {
          type: "message",
          text: "unexpected",
          usage: { promptTokens: 1, completionTokens: 1 },
        },
      }),
    );
    worker.write(encodeGooseWindowsModelFrame(request()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.rejectedRequestCount).toBe(3);
    await closeHost(host, worker);
  });

  it("cancels an in-flight invocation and closes idempotently", async () => {
    const [main, worker] = linkedDuplexPair();
    let aborted = false;
    const host = startGooseWindowsModelBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeModel: async (_invocation, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
        }),
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsModelFrame(request()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.write(
      encodeGooseWindowsModelFrame({
        contractVersion: 1,
        kind: "cancel",
        requestId: "model-request-1",
        lease: LEASE,
      }),
    );
    const response = decodeGooseWindowsModelFrame(await readFrame(worker), {
      expectedRequestId: "model-request-1",
    });
    expect(response).toMatchObject({ kind: "model-error", code: "cancelled" });
    expect(aborted).toBe(true);
    await host.close();
    await host.close();
    worker.destroy();
  });
});
