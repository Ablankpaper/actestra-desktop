import { describe, expect, it } from "vitest";
import {
  GOOSE_WORKER_RESOURCE_PROFILE,
  instant,
  type AgentClock,
  type WorkerResourceIncident,
} from "../../apps/desktop/src/core";
import {
  createWorkerResourceMonitor,
  type WorkerResourceObservation,
} from "../../apps/desktop/src/main/workers/workerResourceMonitor";

class ManualClock implements AgentClock {
  private currentTimeMs: number;

  constructor() {
    this.currentTimeMs = Date.parse("2026-08-15T14:00:00.000Z");
  }

  now() {
    return instant(new Date(this.currentTimeMs).toISOString());
  }

  advance(milliseconds: number): void {
    this.currentTimeMs += milliseconds;
  }
}

function budget(overrides: Partial<typeof GOOSE_WORKER_RESOURCE_PROFILE> = {}) {
  return Object.freeze({
    ...GOOSE_WORKER_RESOURCE_PROFILE,
    maxActiveDurationMs: 1_000,
    ...overrides,
  });
}

describe("worker resource monitor", () => {
  it("pauses only active duration and balances overlapping holds", async () => {
    const clock = new ManualClock();
    const incidents: WorkerResourceIncident[] = [];
    let observation: WorkerResourceObservation = {
      cpuSeconds: 0,
      privateMemoryBytes: 1,
    };
    const monitor = createWorkerResourceMonitor({
      workerKind: "goose",
      attemptId: "attempt-monitor-pause",
      budget: budget(),
      clock,
      requiredMetrics: ["cpuSeconds", "privateMemoryBytes"],
      sample: () => observation,
      onBreach: (incident) => {
        incidents.push(incident);
      },
      intervalMs: 60_000,
    });

    const releaseOuter = monitor.hold();
    const releaseInner = monitor.hold();
    clock.advance(10_000);
    await monitor.poll();
    expect(incidents).toEqual([]);

    releaseInner();
    clock.advance(900);
    await monitor.poll();
    expect(incidents).toEqual([]);

    releaseOuter();
    clock.advance(999);
    await monitor.poll();
    expect(incidents).toEqual([]);
    clock.advance(2);
    await monitor.poll();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({
      code: "worker-resource-timeout",
      resourceKind: "active-duration",
      termination: "requested",
    });
    monitor.stop();
  });

  it("fails closed when a required observation is unavailable", async () => {
    const clock = new ManualClock();
    const incidents: WorkerResourceIncident[] = [];
    const monitor = createWorkerResourceMonitor({
      workerKind: "general",
      attemptId: "attempt-monitor-unavailable",
      budget: Object.freeze({
        ...GOOSE_WORKER_RESOURCE_PROFILE,
        maxPrivateStorageBytes: 0,
      }),
      clock,
      requiredMetrics: ["privateMemoryBytes"],
      sample: () => ({ cpuSeconds: 0 }),
      onBreach: (incident) => {
        incidents.push(incident);
      },
      intervalMs: 60_000,
    });

    await monitor.poll();
    expect(incidents).toMatchObject([
      {
        code: "worker-resource-enforcement-unavailable",
        resourceKind: "private-memory",
        observed: 0,
      },
    ]);
    await monitor.poll();
    expect(incidents).toHaveLength(1);
    monitor.stop();
  });

  it("reports the first breached resource and never samples after stop", async () => {
    const clock = new ManualClock();
    const incidents: WorkerResourceIncident[] = [];
    let samples = 0;
    const monitor = createWorkerResourceMonitor({
      workerKind: "goose",
      attemptId: "attempt-monitor-first",
      budget: budget({ maxCpuSeconds: 1 }),
      clock,
      requiredMetrics: ["cpuSeconds", "privateMemoryBytes"],
      sample: () => {
        samples += 1;
        return { cpuSeconds: 2, privateMemoryBytes: 1 };
      },
      onBreach: (incident) => {
        incidents.push(incident);
      },
      intervalMs: 60_000,
    });

    await monitor.poll();
    monitor.stop();
    await monitor.poll();
    expect(samples).toBe(1);
    expect(incidents[0]?.code).toBe("worker-resource-cpu-exceeded");
  });
});
