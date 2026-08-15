import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGeneralWorkerReadyMessage } from "../../apps/desktop/src/shared/generalWorkerProtocol";

const { fork, getAppMetrics } = vi.hoisted(() => ({
  fork: vi.fn(),
  getAppMetrics: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppMetrics },
  utilityProcess: { fork },
}));

import { launchElectronGeneralWorker } from "../../apps/desktop/src/main/workers/electronGeneralWorker";

class FakeUtilityProcess extends EventEmitter {
  readonly pid = 42_424;
  killCount = 0;

  postMessage(message: unknown): void {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { readonly type?: unknown }).type === "request"
    ) {
      const request = message as {
        readonly requestId: string;
        readonly operation: string;
      };
      setTimeout(() => {
        this.emit("message", {
          protocolVersion: 2,
          type: "response",
          requestId: request.requestId,
          operation: request.operation,
          ok: true,
        });
      }, 0);
    }
  }

  kill(): boolean {
    this.killCount += 1;
    this.emit("exit", 0);
    return true;
  }
}

function metrics(privateBytes: number | undefined) {
  return [
    {
      pid: 42_424,
      creationTime: 1_725_000_000_000,
      cpu: {
        cumulativeCPUUsage: 3,
        idleWakeupsPerSecond: 0,
        percentCPUUsage: 0,
      },
      memory: {
        privateBytes,
        peakWorkingSetSize: 4_096,
        workingSetSize: 4_096,
      },
    },
  ];
}

describe("Electron General Worker resource launch", () => {
  beforeEach(() => {
    fork.mockReset();
    getAppMetrics.mockReset();
  });

  it("uses the fixed V8 budget and binds observations to PID plus creation time", async () => {
    const child = new FakeUtilityProcess();
    fork.mockImplementation(() => {
      setTimeout(() => {
        child.emit("message", createGeneralWorkerReadyMessage());
      }, 0);
      return child;
    });
    getAppMetrics.mockReturnValue(metrics(8_192));

    const adapter = await launchElectronGeneralWorker({
      modulePath: "/tmp/general-worker.mjs",
      workingDirectory: "/tmp",
    });

    expect(fork).toHaveBeenCalledWith(
      "/tmp/general-worker.mjs",
      [],
      expect.objectContaining({
        execArgv: ["--max-old-space-size=256"],
      }),
    );
    expect(adapter.resourceIdentity()).toEqual({
      pid: 42_424,
      creationTime: 1_725_000_000_000,
    });
    expect(adapter.observeResources()).toMatchObject({
      cpuSeconds: 3,
      privateMemoryBytes: 8_192,
    });
    await adapter.close();
  });

  it("fails closed when Electron cannot prove private memory", async () => {
    const child = new FakeUtilityProcess();
    fork.mockImplementation(() => {
      setTimeout(() => {
        child.emit("message", createGeneralWorkerReadyMessage());
      }, 0);
      return child;
    });
    getAppMetrics.mockReturnValue(metrics(undefined));

    const adapter = await launchElectronGeneralWorker({
      modulePath: "/tmp/general-worker.mjs",
      workingDirectory: "/tmp",
    });

    expect(() => adapter.observeResources()).toThrow(
      "General Worker private-memory observation is unavailable",
    );
    await adapter.close();
  });
});
