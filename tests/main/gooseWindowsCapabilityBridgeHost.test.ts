import { Duplex } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CODING_TOOL_IDS } from "../../apps/desktop/src/core";
import {
  decodeGooseWindowsCapabilityFrame,
  encodeGooseWindowsCapabilityFrame,
  type GooseWindowsCapabilityFrame,
} from "../../apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol";
import {
  startGooseWindowsCapabilityBridgeHost,
  type GooseWindowsCapabilityBridgeHost,
} from "../../apps/desktop/src/main/workers/gooseWindowsCapabilityBridgeHost";
import {
  GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES,
  GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES,
  createGooseWindowsCapabilityProgress,
} from "../../apps/desktop/src/main/workers/gooseSessionTransport";

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

function listRequest(requestId = "capability-request-1"): GooseWindowsCapabilityFrame {
  return { contractVersion: 1, kind: "list-request", requestId, lease: LEASE, sessionId: SESSION };
}

async function closeHost(host: GooseWindowsCapabilityBridgeHost, worker: Duplex): Promise<void> {
  await host.close();
  worker.destroy();
}

describe("Goose Windows Main capability bridge host", () => {
  it("lists exactly the six coding tools and completes one real invoker call", async () => {
    const [main, worker] = linkedDuplexPair();
    const capabilityProgress = createGooseWindowsCapabilityProgress();
    const invokeTool = vi.fn(async (call) => ({
      isError: false,
      content: `${call.toolId}:${call.input.relativePath}`,
    }));
    const host = startGooseWindowsCapabilityBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeTool,
      commandIds: ["command.test"],
      testIds: ["test.unit"],
      capabilityProgress,
    });
    host.bindSession(SESSION);
    const listed = host.waitForToolsList();
    worker.write(encodeGooseWindowsCapabilityFrame(listRequest()));
    const listResponse = decodeGooseWindowsCapabilityFrame(await readFrame(worker), {
      expectedRequestId: "capability-request-1",
    });
    await listed;
    expect(capabilityProgress.snapshot()).toEqual([
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[3],
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[4],
    ]);
    expect(listResponse.kind).toBe("list-response");
    if (listResponse.kind === "list-response") {
      expect(listResponse.tools.map((tool) => tool.name).sort()).toEqual(
        [...CODING_TOOL_IDS].sort(),
      );
    }
    worker.write(
      encodeGooseWindowsCapabilityFrame({
        contractVersion: 1,
        kind: "call-request",
        requestId: "capability-call-1",
        lease: LEASE,
        sessionId: SESSION,
        toolName: CODING_TOOL_IDS[0],
        arguments: { contractVersion: 1, relativePath: "README.md" },
      }),
    );
    const callResponse = decodeGooseWindowsCapabilityFrame(await readFrame(worker), {
      expectedRequestId: "capability-call-1",
    });
    expect(callResponse).toMatchObject({ kind: "call-response", isError: false });
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(capabilityProgress.snapshot()).toEqual([
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[3],
      GOOSE_WINDOWS_CAPABILITY_PROGRESS_STAGES[4],
      GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[3],
      GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[4],
      GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[5],
      GOOSE_WINDOWS_CAPABILITY_CALL_PROGRESS_STAGES[6],
    ]);
    await closeHost(host, worker);
  });

  it("rejects unsupported tools, wrong scope, malformed arguments, and duplicate calls", async () => {
    const [main, worker] = linkedDuplexPair();
    const host = startGooseWindowsCapabilityBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeTool: async () => ({ isError: false, content: "unused" }),
      commandIds: [],
      testIds: [],
      capabilityProgress: createGooseWindowsCapabilityProgress(),
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsCapabilityFrame(listRequest()));
    await readFrame(worker);
    for (const value of [
      {
        contractVersion: 1,
        kind: "call-request" as const,
        requestId: "capability-call-1",
        lease: LEASE,
        sessionId: SESSION,
        toolName: "not-admitted",
        arguments: {},
      },
      {
        contractVersion: 1,
        kind: "call-request" as const,
        requestId: "capability-call-2",
        lease: LEASE,
        sessionId: SESSION,
        toolName: CODING_TOOL_IDS[0],
        arguments: { contractVersion: 1 },
      },
    ]) {
      expect(() => encodeGooseWindowsCapabilityFrame(value as never)).toThrow();
    }
    await closeHost(host, worker);
  });

  it("rejects a replay after a completed tool call", async () => {
    const [main, worker] = linkedDuplexPair();
    const invokeTool = vi.fn(async () => ({ isError: false, content: "bounded" }));
    const host = startGooseWindowsCapabilityBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeTool,
      commandIds: [],
      testIds: [],
      capabilityProgress: createGooseWindowsCapabilityProgress(),
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsCapabilityFrame(listRequest()));
    await readFrame(worker);
    const call = encodeGooseWindowsCapabilityFrame({
      contractVersion: 1,
      kind: "call-request",
      requestId: "capability-call-1",
      lease: LEASE,
      sessionId: SESSION,
      toolName: CODING_TOOL_IDS[0],
      arguments: { contractVersion: 1, relativePath: "README.md" },
    });
    worker.write(call);
    expect(
      decodeGooseWindowsCapabilityFrame(await readFrame(worker), {
        expectedRequestId: "capability-call-1",
      }).kind,
    ).toBe("call-response");
    worker.write(call);
    expect(
      decodeGooseWindowsCapabilityFrame(await readFrame(worker), {
        expectedRequestId: "capability-call-1",
      }),
    ).toMatchObject({ kind: "capability-error", code: "capability-request-rejected" });
    expect(invokeTool).toHaveBeenCalledTimes(1);
    await closeHost(host, worker);
  });

  it("records a bounded Main invocation failure before writing the error response", async () => {
    const [main, worker] = linkedDuplexPair();
    const capabilityProgress = createGooseWindowsCapabilityProgress();
    const host = startGooseWindowsCapabilityBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeTool: async () => {
        throw new Error("fixture tool failure");
      },
      commandIds: [],
      testIds: [],
      capabilityProgress,
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsCapabilityFrame(listRequest()));
    await readFrame(worker);
    worker.write(
      encodeGooseWindowsCapabilityFrame({
        contractVersion: 1,
        kind: "call-request",
        requestId: "capability-call-failed",
        lease: LEASE,
        sessionId: SESSION,
        toolName: CODING_TOOL_IDS[0],
        arguments: { contractVersion: 1, relativePath: "README.md" },
      }),
    );
    expect(
      decodeGooseWindowsCapabilityFrame(await readFrame(worker), {
        expectedRequestId: "capability-call-failed",
      }),
    ).toMatchObject({ kind: "capability-error", code: "tool-execution-failed" });
    expect(capabilityProgress.snapshot()).toContain(
      "windows-capability-call-main-tool-invocation-failed",
    );
    await closeHost(host, worker);
  });

  it("cancels an in-flight tool and closes idempotently", async () => {
    const [main, worker] = linkedDuplexPair();
    let aborted = false;
    const host = startGooseWindowsCapabilityBridgeHost({
      stream: main,
      attemptLease: LEASE,
      invokeTool: async ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("cancelled"));
          });
        }),
      commandIds: [],
      testIds: [],
      capabilityProgress: createGooseWindowsCapabilityProgress(),
    });
    host.bindSession(SESSION);
    worker.write(encodeGooseWindowsCapabilityFrame(listRequest()));
    await readFrame(worker);
    worker.write(
      encodeGooseWindowsCapabilityFrame({
        contractVersion: 1,
        kind: "call-request",
        requestId: "capability-call-1",
        lease: LEASE,
        sessionId: SESSION,
        toolName: CODING_TOOL_IDS[0],
        arguments: { contractVersion: 1, relativePath: "README.md" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    worker.write(
      encodeGooseWindowsCapabilityFrame({
        contractVersion: 1,
        kind: "cancel",
        requestId: "capability-call-1",
        lease: LEASE,
      }),
    );
    const response = decodeGooseWindowsCapabilityFrame(await readFrame(worker), {
      expectedRequestId: "capability-call-1",
    });
    expect(response).toMatchObject({ kind: "capability-error", code: "cancelled" });
    expect(aborted).toBe(true);
    await host.close();
    await host.close();
    worker.destroy();
  });
});
