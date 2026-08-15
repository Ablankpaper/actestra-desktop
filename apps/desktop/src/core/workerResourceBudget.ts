const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

export type WorkerKind = "general" | "goose";

export interface WorkerResourceBudget {
  readonly maxActiveDurationMs: number;
  readonly maxCpuSeconds: number;
  readonly maxPrivateMemoryBytes: number;
  readonly maxOutputBytes: number;
  readonly maxPrivateStorageBytes: number;
  readonly maxChildProcesses: number;
}

export type WorkerResourceProfile = WorkerResourceBudget;

export const GENERAL_WORKER_RESOURCE_PROFILE: WorkerResourceProfile = Object.freeze({
  maxActiveDurationMs: 10 * 60 * 1000,
  maxCpuSeconds: 30,
  maxPrivateMemoryBytes: 512 * MIB,
  maxOutputBytes: 96 * KIB,
  maxPrivateStorageBytes: 0,
  maxChildProcesses: 0,
});

export const GOOSE_WORKER_RESOURCE_PROFILE: WorkerResourceProfile = Object.freeze({
  maxActiveDurationMs: 30 * 60 * 1000,
  maxCpuSeconds: 120,
  maxPrivateMemoryBytes: GIB,
  maxOutputBytes: 256 * KIB,
  maxPrivateStorageBytes: 512 * MIB,
  maxChildProcesses: 0,
});

export const WORKER_RESOURCE_PROFILES: Readonly<Record<WorkerKind, WorkerResourceProfile>> =
  Object.freeze({
    general: GENERAL_WORKER_RESOURCE_PROFILE,
    goose: GOOSE_WORKER_RESOURCE_PROFILE,
  });

export type WorkerResourceIncidentCode =
  | "worker-resource-cpu-exceeded"
  | "worker-resource-memory-exceeded"
  | "worker-resource-output-exceeded"
  | "worker-resource-timeout"
  | "worker-resource-storage-exceeded"
  | "worker-process-tree-violated"
  | "worker-resource-enforcement-unavailable";

export type WorkerResourceKind =
  | "active-duration"
  | "cpu"
  | "private-memory"
  | "output"
  | "private-storage"
  | "child-processes"
  | "process-tree";

export type WorkerResourceTermination = "requested" | "forced";

export interface WorkerResourceIncident {
  readonly workerKind: WorkerKind;
  readonly attemptId: string;
  readonly code: WorkerResourceIncidentCode;
  readonly resourceKind: WorkerResourceKind;
  readonly observed: number;
  readonly limit: number;
  readonly termination: WorkerResourceTermination;
}

export class WorkerResourceBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerResourceBudgetError";
  }
}

const BUDGET_KEYS = Object.freeze([
  "maxActiveDurationMs",
  "maxCpuSeconds",
  "maxPrivateMemoryBytes",
  "maxOutputBytes",
  "maxPrivateStorageBytes",
  "maxChildProcesses",
] as const);

const BUDGET_LIMITS = Object.freeze({
  maxActiveDurationMs: Object.freeze({ min: 1, max: 24 * 60 * 60 * 1000 }),
  maxCpuSeconds: Object.freeze({ min: 1, max: 86_400 }),
  maxPrivateMemoryBytes: Object.freeze({ min: 1, max: 8 * GIB }),
  maxOutputBytes: Object.freeze({ min: 1, max: 64 * MIB }),
  maxPrivateStorageBytes: Object.freeze({ min: 0, max: 4 * GIB }),
  maxChildProcesses: Object.freeze({ min: 0, max: 64 }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new WorkerResourceBudgetError(`${label} must contain exactly the admitted fields`);
  }
}

function assertBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new WorkerResourceBudgetError(`${label} must be a bounded safe integer`);
  }
}

export function assertWorkerResourceBudget(value: unknown): asserts value is WorkerResourceBudget {
  if (!isRecord(value)) {
    throw new WorkerResourceBudgetError("Worker resource budget must be an object");
  }
  assertExactKeys(value, BUDGET_KEYS, "Worker resource budget");
  for (const key of BUDGET_KEYS) {
    const limits = BUDGET_LIMITS[key];
    assertBoundedInteger(value[key], limits.min, limits.max, `Worker resource budget.${key}`);
  }
}

export function freezeWorkerResourceBudget(value: WorkerResourceBudget): WorkerResourceBudget {
  assertWorkerResourceBudget(value);
  return Object.freeze({
    maxActiveDurationMs: value.maxActiveDurationMs,
    maxCpuSeconds: value.maxCpuSeconds,
    maxPrivateMemoryBytes: value.maxPrivateMemoryBytes,
    maxOutputBytes: value.maxOutputBytes,
    maxPrivateStorageBytes: value.maxPrivateStorageBytes,
    maxChildProcesses: value.maxChildProcesses,
  });
}

const INCIDENT_CODES: readonly WorkerResourceIncidentCode[] = Object.freeze([
  "worker-resource-cpu-exceeded",
  "worker-resource-memory-exceeded",
  "worker-resource-output-exceeded",
  "worker-resource-timeout",
  "worker-resource-storage-exceeded",
  "worker-process-tree-violated",
  "worker-resource-enforcement-unavailable",
]);

const RESOURCE_KINDS: readonly WorkerResourceKind[] = Object.freeze([
  "active-duration",
  "cpu",
  "private-memory",
  "output",
  "private-storage",
  "child-processes",
  "process-tree",
]);

const INCIDENT_KEYS = Object.freeze([
  "workerKind",
  "attemptId",
  "code",
  "resourceKind",
  "observed",
  "limit",
  "termination",
] as const);

function assertBoundedCounter(value: unknown, label: string): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new WorkerResourceBudgetError(`${label} must be a bounded counter`);
  }
}

function assertAttemptId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/.test(value)) {
    throw new WorkerResourceBudgetError("Worker resource incident attemptId is invalid");
  }
}

export function assertWorkerResourceIncident(
  value: unknown,
): asserts value is WorkerResourceIncident {
  if (!isRecord(value)) {
    throw new WorkerResourceBudgetError("Worker resource incident must be an object");
  }
  assertExactKeys(value, INCIDENT_KEYS, "Worker resource incident");
  if (value.workerKind !== "general" && value.workerKind !== "goose") {
    throw new WorkerResourceBudgetError("Worker resource incident workerKind is invalid");
  }
  assertAttemptId(value.attemptId);
  if (!INCIDENT_CODES.includes(value.code as WorkerResourceIncidentCode)) {
    throw new WorkerResourceBudgetError("Worker resource incident code is invalid");
  }
  if (!RESOURCE_KINDS.includes(value.resourceKind as WorkerResourceKind)) {
    throw new WorkerResourceBudgetError("Worker resource incident resourceKind is invalid");
  }
  assertBoundedCounter(value.observed, "Worker resource incident observed");
  assertBoundedCounter(value.limit, "Worker resource incident limit");
  if (value.termination !== "requested" && value.termination !== "forced") {
    throw new WorkerResourceBudgetError("Worker resource incident termination is invalid");
  }
}

export function createWorkerResourceIncident(
  value: WorkerResourceIncident,
): WorkerResourceIncident {
  assertWorkerResourceIncident(value);
  return Object.freeze({
    workerKind: value.workerKind,
    attemptId: value.attemptId,
    code: value.code,
    resourceKind: value.resourceKind,
    observed: value.observed,
    limit: value.limit,
    termination: value.termination,
  });
}
