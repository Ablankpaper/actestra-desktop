import process from "node:process";
import { utilityProcess, type UtilityProcess } from "electron";
import { instant, type AgentClock, type Instant } from "../../core";
import {
  GeneralWorkerProcessAdapter,
  type GeneralWorkerProcessAdapterOptions,
  type GeneralWorkerProcessTransport,
} from "./generalWorkerProcessAdapter";

export interface LaunchElectronGeneralWorkerOptions {
  readonly modulePath: string;
  readonly workingDirectory: string;
  readonly adapter?: GeneralWorkerProcessAdapterOptions;
  readonly clock?: AgentClock;
}

class ElectronGeneralWorkerTransport implements GeneralWorkerProcessTransport {
  constructor(private readonly child: UtilityProcess) {}

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
    const handleError = (): void => {
      listener();
    };
    this.child.on("error", handleError);
    return () => {
      this.child.off("error", handleError);
    };
  }

  onExit(listener: (code: number) => void): () => void {
    this.child.on("exit", listener);
    return () => {
      this.child.off("exit", listener);
    };
  }

  kill(): boolean {
    return this.child.kill();
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
    execArgv: [],
    cwd: options.workingDirectory,
    stdio: ["ignore", "ignore", "ignore"],
    serviceName: "Actestra General Worker",
    allowLoadingUnsignedLibraries: false,
    respondToAuthRequestsFromMainProcess: false,
  });
  const transport = new ElectronGeneralWorkerTransport(child);
  try {
    return await GeneralWorkerProcessAdapter.connect(
      transport,
      options.clock ?? new SystemAgentClock(),
      options.adapter,
    );
  } catch (error) {
    transport.kill();
    throw error;
  }
}
