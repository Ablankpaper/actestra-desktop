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

export interface LaunchElectronGeneralWorkerOptions {
  readonly modulePath: string;
  readonly workingDirectory: string;
  readonly adapter?: GeneralWorkerProcessAdapterOptions;
  readonly clock?: AgentClock;
  readonly getAppMetrics?: () => readonly ProcessMetric[];
}

class ElectronGeneralWorkerTransport implements GeneralWorkerProcessTransport {
  private expectedCreationTime: number | undefined;

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

  observeResources(): WorkerResourceObservation {
    const metric = this.metric();
    this.rememberCreationTime(metric.creationTime);
    if (metric.cpu.cumulativeCPUUsage === undefined) {
      throw new Error("General Worker CPU observation is unavailable");
    }
    if (metric.memory.privateBytes === undefined) {
      throw new Error("General Worker private-memory observation is unavailable");
    }
    return Object.freeze({
      cpuSeconds: metric.cpu.cumulativeCPUUsage,
      privateMemoryBytes: metric.memory.privateBytes,
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
