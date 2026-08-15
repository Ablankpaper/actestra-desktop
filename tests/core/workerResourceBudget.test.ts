import { describe, expect, it } from "vitest";
import {
  GOOSE_WORKER_RESOURCE_PROFILE,
  GENERAL_WORKER_RESOURCE_PROFILE,
  WORKER_RESOURCE_PROFILES,
  WorkerResourceBudgetError,
  assertWorkerResourceBudget,
  createWorkerResourceIncident,
  freezeWorkerResourceBudget,
  type WorkerResourceBudget,
  type WorkerResourceIncidentCode,
} from "../../apps/desktop/src/core";

const EXPECTED_CODES: readonly WorkerResourceIncidentCode[] = [
  "worker-resource-cpu-exceeded",
  "worker-resource-memory-exceeded",
  "worker-resource-output-exceeded",
  "worker-resource-timeout",
  "worker-resource-storage-exceeded",
  "worker-process-tree-violated",
  "worker-resource-enforcement-unavailable",
];

describe("P7.2 worker resource budget contract", () => {
  it("publishes the two fixed profiles with exact bounded values", () => {
    expect(GENERAL_WORKER_RESOURCE_PROFILE).toEqual({
      maxActiveDurationMs: 600_000,
      maxCpuSeconds: 30,
      maxPrivateMemoryBytes: 512 * 1024 * 1024,
      maxOutputBytes: 96 * 1024,
      maxPrivateStorageBytes: 0,
      maxChildProcesses: 0,
    });
    expect(GOOSE_WORKER_RESOURCE_PROFILE).toEqual({
      maxActiveDurationMs: 1_800_000,
      maxCpuSeconds: 120,
      maxPrivateMemoryBytes: 1024 * 1024 * 1024,
      maxOutputBytes: 256 * 1024,
      maxPrivateStorageBytes: 512 * 1024 * 1024,
      maxChildProcesses: 0,
    });
    expect(WORKER_RESOURCE_PROFILES).toEqual({
      general: GENERAL_WORKER_RESOURCE_PROFILE,
      goose: GOOSE_WORKER_RESOURCE_PROFILE,
    });
    expect(Object.isFrozen(GENERAL_WORKER_RESOURCE_PROFILE)).toBe(true);
    expect(Object.isFrozen(GOOSE_WORKER_RESOURCE_PROFILE)).toBe(true);
  });

  it("accepts one exact immutable budget and rejects widened or malformed records", () => {
    const budget: WorkerResourceBudget = freezeWorkerResourceBudget({
      ...GOOSE_WORKER_RESOURCE_PROFILE,
    });
    expect(assertWorkerResourceBudget(budget)).toBeUndefined();
    expect(Object.isFrozen(budget)).toBe(true);
    expect(() => {
      (budget as { maxCpuSeconds: number }).maxCpuSeconds = 999_999;
    }).toThrow(TypeError);

    for (const candidate of [
      { ...budget, maxCpuSeconds: 0 },
      { ...budget, maxPrivateMemoryBytes: Number.MAX_SAFE_INTEGER },
      { ...budget, maxChildProcesses: -1 },
      { ...budget, unexpected: 1 },
    ]) {
      expect(() => assertWorkerResourceBudget(candidate)).toThrow(WorkerResourceBudgetError);
    }
  });

  it("exposes only bounded redacted incident metadata", () => {
    expect(EXPECTED_CODES).toHaveLength(7);
    const incident = createWorkerResourceIncident({
      workerKind: "goose",
      attemptId: "attempt-p7-2-1",
      code: "worker-resource-storage-exceeded",
      resourceKind: "private-storage",
      observed: 600,
      limit: 512,
      termination: "forced",
    });
    expect(incident).toEqual({
      workerKind: "goose",
      attemptId: "attempt-p7-2-1",
      code: "worker-resource-storage-exceeded",
      resourceKind: "private-storage",
      observed: 600,
      limit: 512,
      termination: "forced",
    });
    expect(Object.keys(incident).sort()).toEqual([
      "attemptId",
      "code",
      "limit",
      "observed",
      "resourceKind",
      "termination",
      "workerKind",
    ]);
    expect(JSON.stringify(incident)).not.toMatch(/prompt|secret|\/Users|OPENAI|content/i);
  });
});
