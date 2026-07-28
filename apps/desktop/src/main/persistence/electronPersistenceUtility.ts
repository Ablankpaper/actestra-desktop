import process from "node:process";
import { utilityProcess, type UtilityProcess } from "electron";
import {
  PersistenceUtilityClient,
  type PersistenceUtilityTransport,
} from "./persistenceUtilityClient";

export interface LaunchElectronPersistenceUtilityOptions {
  readonly modulePath: string;
  readonly userDataPath: string;
  readonly workingDirectory: string;
}

class ElectronPersistenceUtilityTransport implements PersistenceUtilityTransport {
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

function minimalUtilityEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {
    ACTESTRA_UTILITY_ROLE: "persistence",
  };
  for (const name of ["LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP", "SystemRoot", "WINDIR"]) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }
  return environment;
}

export async function launchElectronPersistenceUtility(
  options: LaunchElectronPersistenceUtilityOptions,
): Promise<PersistenceUtilityClient> {
  const child = utilityProcess.fork(options.modulePath, [], {
    env: minimalUtilityEnvironment(),
    execArgv: [],
    cwd: options.workingDirectory,
    stdio: ["ignore", "ignore", "ignore"],
    serviceName: "Actestra Persistence",
    allowLoadingUnsignedLibraries: false,
    respondToAuthRequestsFromMainProcess: false,
  });
  const transport = new ElectronPersistenceUtilityTransport(child);
  try {
    return await PersistenceUtilityClient.connect(transport, options.userDataPath);
  } catch (error) {
    transport.kill();
    throw error;
  }
}
