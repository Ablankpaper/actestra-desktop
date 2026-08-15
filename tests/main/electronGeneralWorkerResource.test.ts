import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERAL_WORKER_RESOURCE_PROFILE,
  instant,
  type WorkerResourceIncident,
} from "../../apps/desktop/src/core";
import {
  AgentAdapterSupervisor,
  type AgentAdapterSupervisorConfig,
} from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import { DeterministicAgentClock } from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import { createGeneralWorkerReadyMessage } from "../../apps/desktop/src/shared/generalWorkerProtocol";
import { GeneralWorkerService } from "../../apps/desktop/src/utility/worker/generalWorkerService";
import { createAgentStartRequest, FIXTURE_AGENT_SESSION_ID } from "../fixtures/agentAdapter";

const { fork, getAppMetrics } = vi.hoisted(() => ({
  fork: vi.fn(),
  getAppMetrics: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getAppMetrics },
  utilityProcess: { fork },
}));

import { launchElectronGeneralWorker } from "../../apps/desktop/src/main/workers/electronGeneralWorker";
import { GENERAL_WORKER_ADAPTER_KIND } from "../../apps/desktop/src/main/workers/generalWorkerProcessAdapter";
import { createWorkerResourceMonitor } from "../../apps/desktop/src/main/workers/workerResourceMonitor";

const SUPERVISOR_CONFIG = {
  expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
  requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 0,
} as const satisfies AgentAdapterSupervisorConfig;

function nextImmediate(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

class FakeUtilityProcess extends EventEmitter {
  readonly pid = 42_424;
  private readonly service = new GeneralWorkerService();
  killCount = 0;

  postMessage(message: unknown): void {
    void this.service.handle(message).then((responses) => {
      setTimeout(() => {
        for (const response of responses) this.emit("message", response);
      }, 0);
    });
  }

  kill(): boolean {
    this.killCount += 1;
    this.service.shutdown();
    this.emit("exit", 0);
    return true;
  }
}

function metrics(privateBytes: number | undefined, workingSetSize: number | undefined) {
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
        workingSetSize,
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
    getAppMetrics.mockReturnValue(metrics(8_192, 4_096));

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

  it("normalizes Electron working-set memory when private bytes are unavailable", async () => {
    const child = new FakeUtilityProcess();
    fork.mockImplementation(() => {
      setTimeout(() => {
        child.emit("message", createGeneralWorkerReadyMessage());
      }, 0);
      return child;
    });
    getAppMetrics.mockReturnValue(metrics(undefined, 4_096));

    const adapter = await launchElectronGeneralWorker({
      modulePath: "/tmp/general-worker.mjs",
      workingDirectory: "/tmp",
    });

    expect(adapter.observeResources()).toMatchObject({
      privateMemoryBytes: 4_096 * 1_024,
    });
    await adapter.close();
  });

  it("fails closed when Electron exposes neither private bytes nor working-set memory", async () => {
    const child = new FakeUtilityProcess();
    fork.mockImplementation(() => {
      setTimeout(() => {
        child.emit("message", createGeneralWorkerReadyMessage());
      }, 0);
      return child;
    });
    getAppMetrics.mockReturnValue(metrics(undefined, undefined));

    const adapter = await launchElectronGeneralWorker({
      modulePath: "/tmp/general-worker.mjs",
      workingDirectory: "/tmp",
    });

    expect(() => adapter.observeResources()).toThrow(
      "General Worker memory observation is unavailable",
    );
    await adapter.close();
  });

  it("lets a raw process exit win over the now-unavailable metrics sample", async () => {
    const child = new FakeUtilityProcess();
    fork.mockImplementation(() => {
      setTimeout(() => {
        child.emit("message", createGeneralWorkerReadyMessage());
      }, 0);
      return child;
    });
    getAppMetrics.mockReturnValue(metrics(8_192, 4_096));
    const clock = new DeterministicAgentClock(instant("2026-08-16T01:30:00.000Z"));
    const adapter = await launchElectronGeneralWorker({
      modulePath: "/tmp/general-worker.mjs",
      workingDirectory: "/tmp",
      clock,
      adapter: { executionMode: "hold" },
    });
    const supervisor = new AgentAdapterSupervisor(adapter, clock, SUPERVISOR_CONFIG);
    await supervisor.start(createAgentStartRequest({ startedAt: clock.now() }));
    await vi.waitFor(() => {
      expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID).taskState).toBe("running");
    });
    const incidents: WorkerResourceIncident[] = [];
    const monitor = createWorkerResourceMonitor({
      workerKind: "general",
      attemptId: FIXTURE_AGENT_SESSION_ID,
      budget: GENERAL_WORKER_RESOURCE_PROFILE,
      clock,
      requiredMetrics: ["cpuSeconds", "privateMemoryBytes"],
      sample: () => adapter.observeResources(),
      onBreach: async (incident) => {
        incidents.push(incident);
        await supervisor.failForResource(FIXTURE_AGENT_SESSION_ID, incident);
      },
      intervalMs: 60_000,
    });

    getAppMetrics.mockReturnValue([]);
    child.emit("exit", 9);
    await monitor.poll();
    await nextImmediate();

    expect(incidents).toEqual([]);
    expect(supervisor.snapshot(FIXTURE_AGENT_SESSION_ID)).toMatchObject({
      state: "crashed",
      disposed: true,
    });
    expect(supervisor.coreEvents(FIXTURE_AGENT_SESSION_ID).at(-1)).toMatchObject({
      type: "worker.failed",
      payload: { errorCode: "worker-process-exit", retryable: true },
    });
    monitor.stop();
  });
});
