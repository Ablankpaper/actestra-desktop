import process from "node:process";
import { app, utilityProcess, type ProcessMetric, type UtilityProcess } from "electron";
import { instant, type AgentClock, type Instant } from "../../core";
import {
  GeneralWorkerProcessAdapter,
  type GeneralWorkerProcessAdapterOptions,
  type GeneralWorkerResourceIdentity,
  type GeneralWorkerProcessTransport,
} from "./generalWorkerProcessAdapter";
import { subscribeDeferredUtilityProcessTerminalEvent } from "./utilityProcessTerminalDispatch";
import type { WorkerResourceObservation } from "./workerResourceMonitor";

const BYTES_PER_KIB = 1_024;

function normalizeMemoryBytes(memory: ProcessMetric["memory"]): number {
  if (memory.privateBytes !== undefined) {
    if (!Number.isFinite(memory.privateBytes) || memory.privateBytes < 0) {
      throw new Error("General Worker memory observation is unavailable");
    }
    return memory.privateBytes;
  }

  // Electron exposes privateBytes only on Windows. On macOS/Linux the working-set
  // value is the available per-process bound and is reported in KiB; normalize it
  // to the byte-based Actestra budget while remaining conservative about resident use.
  const workingSetKiB = memory.workingSetSize;
  if (
    !Number.isFinite(workingSetKiB) ||
    workingSetKiB < 0 ||
    workingSetKiB > Number.MAX_SAFE_INTEGER / BYTES_PER_KIB
  ) {
    throw new Error("General Worker memory observation is unavailable");
  }
  return workingSetKiB * BYTES_PER_KIB;
}

export interface LaunchElectronGeneralWorkerOptions {
  readonly modulePath: string;
  readonly workingDirectory: string;
  readonly adapter?: GeneralWorkerProcessAdapterOptions;
  readonly clock?: AgentClock;
  readonly getAppMetrics?: () => readonly ProcessMetric[];
}

class ElectronGeneralWorkerTransport implements GeneralWorkerProcessTransport {
  private expectedCreationTime: number | undefined;
  private terminalObserved = false;

  constructor(
    private readonly child: UtilityProcess,
    private readonly getAppMetrics: () => readonly ProcessMetric[],
  ) {}

  postMessage(message: unknown): void {
    this.child.postMessage(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.child.on("message", listener);
    return () => {
      this.child.off("message", listener);
    };
  }

  onError(listener: () => void): () => void {
    return subscribeDeferredUtilityProcessTerminalEvent<[]>(
      (handleError) => {
        this.child.once("error", handleError);
      },
      (handleError) => {
        this.child.off("error", handleError);
      },
      () => {
        listener();
      },
      () => {
        this.terminalObserved = true;
      },
    );
  }

  onExit(listener: (code: number) => void): () => void {
    return subscribeDeferredUtilityProcessTerminalEvent<[number]>(
      (handleExit) => {
        this.child.once("exit", handleExit);
      },
      (handleExit) => {
        this.child.off("exit", handleExit);
      },
      listener,
      () => {
        this.terminalObserved = true;
      },
    );
  }

  kill(): boolean {
    return this.child.kill();
  }

  resourceIdentity(): GeneralWorkerResourceIdentity {
    const metric = this.metric();
    this.rememberCreationTime(metric.creationTime);
    return Object.freeze({
      pid: metric.pid,
      creationTime: metric.creationTime,
    });
  }

  observeResources(): WorkerResourceObservation | null {
    if (this.terminalObserved) return null;
    let metric: ProcessMetric;
    try {
      metric = this.metric();
    } catch (error) {
      if (this.processHasTerminated()) return null;
      throw error;
    }
    this.rememberCreationTime(metric.creationTime);
    if (metric.cpu.cumulativeCPUUsage === undefined) {
      throw new Error("General Worker CPU observation is unavailable");
    }
    return Object.freeze({
      cpuSeconds: metric.cpu.cumulativeCPUUsage,
      privateMemoryBytes: normalizeMemoryBytes(metric.memory),
    });
  }

  private metric(): ProcessMetric {
    const pid = this.child.pid;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) {
      throw new Error("General Worker PID is unavailable");
    }
    const metric = this.getAppMetrics().find((candidate) => candidate.pid === pid);
    if (metric === undefined || !Number.isFinite(metric.creationTime)) {
      throw new Error("General Worker process metrics are unavailable");
    }
    return metric;
  }

  private processHasTerminated(): boolean {
    if (this.terminalObserved) return true;
    const pid = this.child.pid;
    if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }

  private rememberCreationTime(creationTime: number): void {
    if (this.expectedCreationTime === undefined) {
      this.expectedCreationTime = creationTime;
      return;
    }
    if (this.expectedCreationTime !== creationTime) {
      throw new Error("General Worker process identity changed");
    }
  }
}

export class SystemAgentClock implements AgentClock {
  now(): Instant {
    return instant(new Date().toISOString());
  }
}

function minimalWorkerEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    ACTESTRA_UTILITY_ROLE: "general-worker",
  };
  for (const name of ["LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR"]) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

export async function launchElectronGeneralWorker(
  options: LaunchElectronGeneralWorkerOptions,
): Promise<GeneralWorkerProcessAdapter> {
  const child = utilityProcess.fork(options.modulePath, [], {
    env: minimalWorkerEnvironment(),
    execArgv: ["--max-old-space-size=256"],
    cwd: options.workingDirectory,
    stdio: ["ignore", "ignore", "ignore"],
    serviceName: "Actestra General Worker",
    allowLoadingUnsignedLibraries: false,
    respondToAuthRequestsFromMainProcess: false,
  });
  const transport = new ElectronGeneralWorkerTransport(
    child,
    options.getAppMetrics ?? (() => app.getAppMetrics()),
  );
  try {
    return await GeneralWorkerProcessAdapter.connect(
      transport,
      options.clock ?? new SystemAgentClock(),
      {
        ...options.adapter,
        resourceObservation: () => transport.observeResources(),
        resourceIdentity: () => transport.resourceIdentity(),
      },
    );
  } catch (error) {
    transport.kill();
    throw error;
  }
}
