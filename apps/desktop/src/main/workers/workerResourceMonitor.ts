import {
  createWorkerResourceIncident,
  freezeWorkerResourceBudget,
  instant,
  type AgentClock,
  type WorkerKind,
  type WorkerResourceBudget,
  type WorkerResourceIncident,
  type WorkerResourceIncidentCode,
  type WorkerResourceKind,
} from "../../core";

export type WorkerResourceMetric =
  | "cpuSeconds"
  | "privateMemoryBytes"
  | "outputBytes"
  | "privateStorageBytes"
  | "childProcesses";

export interface WorkerResourceObservation {
  readonly cpuSeconds?: number;
  readonly privateMemoryBytes?: number;
  readonly outputBytes?: number;
  readonly privateStorageBytes?: number;
  readonly childProcesses?: number;
  readonly processTreeViolated?: boolean;
}

export interface WorkerResourceMonitorOptions {
  readonly workerKind: WorkerKind;
  readonly attemptId: string;
  readonly budget: WorkerResourceBudget;
  readonly clock: AgentClock;
  readonly requiredMetrics?: readonly WorkerResourceMetric[];
  /** Null means Main has proved the monitored process is already terminal. */
  readonly sample: () => WorkerResourceObservation | null;
  readonly onBreach: (incident: WorkerResourceIncident) => void | Promise<void>;
  readonly intervalMs?: number;
}

export interface WorkerResourceMonitorSnapshot {
  readonly activeDurationMs: number;
  readonly paused: boolean;
  readonly stopped: boolean;
  readonly breach?: WorkerResourceIncident;
}

export interface WorkerResourceMonitor {
  start(): void;
  poll(): Promise<void>;
  hold(): () => void;
  stop(): void;
  snapshot(): WorkerResourceMonitorSnapshot;
}

const DEFAULT_INTERVAL_MS = 1_000;
const OBSERVATION_KEYS = Object.freeze([
  "cpuSeconds",
  "privateMemoryBytes",
  "outputBytes",
  "privateStorageBytes",
  "childProcesses",
  "processTreeViolated",
] as const);

const METRICS: Readonly<
  Record<
    WorkerResourceMetric,
    {
      readonly resourceKind: WorkerResourceKind;
      readonly incidentCode: WorkerResourceIncidentCode;
      readonly limit: keyof WorkerResourceBudget;
    }
  >
> = Object.freeze({
  cpuSeconds: Object.freeze({
    resourceKind: "cpu",
    incidentCode: "worker-resource-cpu-exceeded",
    limit: "maxCpuSeconds",
  }),
  privateMemoryBytes: Object.freeze({
    resourceKind: "private-memory",
    incidentCode: "worker-resource-memory-exceeded",
    limit: "maxPrivateMemoryBytes",
  }),
  outputBytes: Object.freeze({
    resourceKind: "output",
    incidentCode: "worker-resource-output-exceeded",
    limit: "maxOutputBytes",
  }),
  privateStorageBytes: Object.freeze({
    resourceKind: "private-storage",
    incidentCode: "worker-resource-storage-exceeded",
    limit: "maxPrivateStorageBytes",
  }),
  childProcesses: Object.freeze({
    resourceKind: "child-processes",
    incidentCode: "worker-process-tree-violated",
    limit: "maxChildProcesses",
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowMilliseconds(clock: AgentClock): number {
  const value = clock.now();
  instant(value);
  return Date.parse(value);
}

function assertCounter(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite counter`);
  }
}

function assertObservation(value: unknown): asserts value is WorkerResourceObservation {
  if (!isRecord(value)) {
    throw new TypeError("Worker resource observation must be an object");
  }
  if (Object.keys(value).some((key) => !OBSERVATION_KEYS.includes(key as never))) {
    throw new TypeError("Worker resource observation contains an unsupported field");
  }
  for (const metric of Object.keys(METRICS) as WorkerResourceMetric[]) {
    if (value[metric] !== undefined) {
      assertCounter(value[metric], `Worker resource observation.${metric}`);
    }
  }
  if (value.processTreeViolated !== undefined && typeof value.processTreeViolated !== "boolean") {
    throw new TypeError("Worker resource observation.processTreeViolated must be boolean");
  }
}

function assertOptions(options: WorkerResourceMonitorOptions): void {
  freezeWorkerResourceBudget(options.budget);
  if (
    (options.workerKind !== "general" && options.workerKind !== "goose") ||
    typeof options.attemptId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,256}$/.test(options.attemptId) ||
    typeof options.clock?.now !== "function" ||
    typeof options.sample !== "function" ||
    typeof options.onBreach !== "function"
  ) {
    throw new TypeError("Worker resource monitor options are invalid");
  }
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 60_000) {
    throw new TypeError("Worker resource monitor interval is invalid");
  }
  const requiredMetrics = options.requiredMetrics ?? [];
  if (
    !Array.isArray(requiredMetrics) ||
    new Set(requiredMetrics).size !== requiredMetrics.length ||
    requiredMetrics.some((metric) => !Object.hasOwn(METRICS, metric))
  ) {
    throw new TypeError("Worker resource monitor required metrics are invalid");
  }
  nowMilliseconds(options.clock);
}

export function createWorkerResourceMonitor(
  options: WorkerResourceMonitorOptions,
): WorkerResourceMonitor {
  assertOptions(options);
  const budget = freezeWorkerResourceBudget(options.budget);
  const requiredMetrics = Object.freeze([...(options.requiredMetrics ?? [])]);
  const startedAtMs = nowMilliseconds(options.clock);
  let pausedAtMs: number | undefined;
  let pausedDurationMs = 0;
  let holdCount = 0;
  let stopped = false;
  let polling = false;
  let breach: WorkerResourceIncident | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const activeDurationAt = (nowMs: number): number => {
    const currentPause = pausedAtMs === undefined ? 0 : Math.max(0, nowMs - pausedAtMs);
    return Math.max(0, nowMs - startedAtMs - pausedDurationMs - currentPause);
  };

  const makeIncident = (
    code: WorkerResourceIncidentCode,
    resourceKind: WorkerResourceKind,
    observed: number,
    limit: number,
  ): WorkerResourceIncident =>
    createWorkerResourceIncident({
      workerKind: options.workerKind,
      attemptId: options.attemptId,
      code,
      resourceKind,
      observed,
      limit,
      termination: "requested",
    });

  const firstObservationBreach = (
    observation: WorkerResourceObservation,
  ): WorkerResourceIncident | undefined => {
    for (const required of requiredMetrics) {
      if (observation[required] === undefined) {
        return makeIncident(
          "worker-resource-enforcement-unavailable",
          METRICS[required].resourceKind,
          0,
          budget[METRICS[required].limit],
        );
      }
    }
    if (observation.processTreeViolated === true) {
      return makeIncident("worker-process-tree-violated", "process-tree", 1, 0);
    }
    for (const metric of Object.keys(METRICS) as WorkerResourceMetric[]) {
      const observed = observation[metric];
      const definition = METRICS[metric];
      const limit = budget[definition.limit];
      if (observed !== undefined && observed > limit) {
        return makeIncident(definition.incidentCode, definition.resourceKind, observed, limit);
      }
    }
    return undefined;
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const poll = async (): Promise<void> => {
    if (stopped || breach !== undefined || polling) return;
    polling = true;
    try {
      const nowMs = nowMilliseconds(options.clock);
      const activeDurationMs = activeDurationAt(nowMs);
      let candidate: WorkerResourceIncident | undefined;
      if (activeDurationMs > budget.maxActiveDurationMs) {
        candidate = makeIncident(
          "worker-resource-timeout",
          "active-duration",
          activeDurationMs,
          budget.maxActiveDurationMs,
        );
      } else {
        let observation: WorkerResourceObservation | null;
        try {
          observation = options.sample();
          if (observation === null) {
            stop();
            return;
          }
          assertObservation(observation);
          candidate = firstObservationBreach(observation);
        } catch {
          candidate = makeIncident(
            "worker-resource-enforcement-unavailable",
            requiredMetrics[0] === undefined
              ? "process-tree"
              : METRICS[requiredMetrics[0]].resourceKind,
            0,
            requiredMetrics[0] === undefined ? 0 : budget[METRICS[requiredMetrics[0]].limit],
          );
        }
      }
      if (candidate !== undefined && breach === undefined) {
        breach = candidate;
        stop();
        await options.onBreach(candidate);
      }
    } finally {
      polling = false;
    }
  };

  return Object.freeze({
    start(): void {
      if (stopped || timer !== undefined) return;
      timer = setInterval(() => {
        void poll();
      }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
      timer.unref();
    },
    poll,
    hold(): () => void {
      if (stopped || breach !== undefined) return () => undefined;
      if (holdCount === 0) pausedAtMs = nowMilliseconds(options.clock);
      holdCount += 1;
      let released = false;
      return (): void => {
        if (released) return;
        released = true;
        holdCount = Math.max(0, holdCount - 1);
        if (holdCount === 0 && pausedAtMs !== undefined) {
          pausedDurationMs += Math.max(0, nowMilliseconds(options.clock) - pausedAtMs);
          pausedAtMs = undefined;
        }
      };
    },
    stop,
    snapshot(): WorkerResourceMonitorSnapshot {
      return Object.freeze({
        activeDurationMs: activeDurationAt(nowMilliseconds(options.clock)),
        paused: holdCount > 0,
        stopped,
        ...(breach === undefined ? {} : { breach }),
      });
    },
  });
}
