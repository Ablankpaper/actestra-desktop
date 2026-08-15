import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GENERAL_WORKER_RESOURCE_PROFILE,
  correlationId,
  eventStreamId,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type AgentStartRequest,
  type WorkerKind,
  type WorkerResourceIncidentCode,
} from "../../core";
import { AgentAdapterSupervisor } from "../workers/agentAdapterSupervisor";
import { SystemAgentClock, launchElectronGeneralWorker } from "../workers/electronGeneralWorker";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  type GeneralWorkerProcessAdapter,
} from "../workers/generalWorkerProcessAdapter";
import { createGooseRunnerSandboxLaunch } from "../workers/gooseRunnerSandbox";
import {
  WorkerStorageBudgetError,
  assertWorkerOutputWithinBudget,
  assertWorkerPrivateStorageWithinBudget,
} from "../workers/workerStorageBudget";
import {
  createWorkerResourceMonitor,
  type WorkerResourceMonitor,
} from "../workers/workerResourceMonitor";

export const P7_RESOURCE_RELIABILITY_CASES = Object.freeze([
  "P7-R-GENERAL-CPU-001",
  "P7-R-GENERAL-MEMORY-001",
  "P7-R-GOOSE-OUTPUT-001",
  "P7-R-GOOSE-STORAGE-001",
  "P7-R-GOOSE-FORK-001",
] as const);

export type P7ResourceReliabilityCaseId = (typeof P7_RESOURCE_RELIABILITY_CASES)[number];

export interface P7ResourceReliabilitySmokeResult {
  readonly id: P7ResourceReliabilityCaseId;
  readonly workerKind: WorkerKind;
  readonly incidentCode: WorkerResourceIncidentCode;
  readonly outcome: "failed-closed";
  readonly terminalState: "failed";
  readonly cleanup: "verified";
  readonly redacted: true;
}

export type P7ResourceReliabilitySmokeIsolation = Readonly<{
  root: string;
  evidence: string;
  generalCpuProbe: string;
  generalMemoryProbe: string;
  gooseForkProbe: string;
  goosePrivateRoot: string;
}>;

const EXPECTED_CASES: Readonly<
  Record<
    P7ResourceReliabilityCaseId,
    Readonly<{ workerKind: WorkerKind; incidentCode: WorkerResourceIncidentCode }>
  >
> = Object.freeze({
  "P7-R-GENERAL-CPU-001": Object.freeze({
    workerKind: "general",
    incidentCode: "worker-resource-cpu-exceeded",
  }),
  "P7-R-GENERAL-MEMORY-001": Object.freeze({
    workerKind: "general",
    incidentCode: "worker-resource-memory-exceeded",
  }),
  "P7-R-GOOSE-OUTPUT-001": Object.freeze({
    workerKind: "goose",
    incidentCode: "worker-resource-output-exceeded",
  }),
  "P7-R-GOOSE-STORAGE-001": Object.freeze({
    workerKind: "goose",
    incidentCode: "worker-resource-storage-exceeded",
  }),
  "P7-R-GOOSE-FORK-001": Object.freeze({
    workerKind: "goose",
    incidentCode: "worker-process-tree-violated",
  }),
});

const RESULT_KEYS = Object.freeze([
  "id",
  "workerKind",
  "incidentCode",
  "outcome",
  "terminalState",
  "cleanup",
  "redacted",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(id: P7ResourceReliabilityCaseId): P7ResourceReliabilitySmokeResult {
  const expected = EXPECTED_CASES[id];
  return Object.freeze({
    id,
    workerKind: expected.workerKind,
    incidentCode: expected.incidentCode,
    outcome: "failed-closed",
    terminalState: "failed",
    cleanup: "verified",
    redacted: true,
  });
}

export function assertP7ResourceReliabilityResults(
  value: unknown,
): asserts value is readonly P7ResourceReliabilitySmokeResult[] {
  if (!Array.isArray(value) || value.length !== P7_RESOURCE_RELIABILITY_CASES.length) {
    throw new Error("P7.2 resource evidence is incomplete");
  }
  for (let index = 0; index < P7_RESOURCE_RELIABILITY_CASES.length; index += 1) {
    const candidate = value[index];
    const id = P7_RESOURCE_RELIABILITY_CASES[index]!;
    const expected = EXPECTED_CASES[id];
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).length !== RESULT_KEYS.length ||
      RESULT_KEYS.some((key) => !Object.hasOwn(candidate, key)) ||
      Object.keys(candidate).some((key) => !RESULT_KEYS.includes(key as never)) ||
      candidate.id !== id ||
      candidate.workerKind !== expected.workerKind ||
      candidate.incidentCode !== expected.incidentCode ||
      candidate.outcome !== "failed-closed" ||
      candidate.terminalState !== "failed" ||
      candidate.cleanup !== "verified" ||
      candidate.redacted !== true
    ) {
      throw new Error("P7.2 resource evidence is incomplete");
    }
  }
}

function contained(root: string, candidate: string): boolean {
  if (!path.isAbsolute(root) || !path.isAbsolute(candidate)) return false;
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function existingFile(value: string | undefined): value is string {
  return value !== undefined && statSync(value, { throwIfNoEntry: false })?.isFile() === true;
}

function existingDirectory(value: string | undefined): value is string {
  return value !== undefined && statSync(value, { throwIfNoEntry: false })?.isDirectory() === true;
}

export function resolveP7ResourceReliabilitySmokeIsolation(
  environment: Readonly<Record<string, string | undefined>>,
): P7ResourceReliabilitySmokeIsolation | null {
  if (
    environment.ACTESTRA_E2E_TEST !== "1" ||
    environment.ACTESTRA_P7_RESOURCE_RELIABILITY_SMOKE !== "1"
  ) {
    return null;
  }
  const root = environment.ACTESTRA_E2E_ISOLATION_ROOT;
  const evidence = environment.ACTESTRA_P7_RESOURCE_RELIABILITY_EVIDENCE;
  const generalCpuProbe = environment.ACTESTRA_P7_RESOURCE_GENERAL_CPU_PROBE;
  const generalMemoryProbe = environment.ACTESTRA_P7_RESOURCE_GENERAL_MEMORY_PROBE;
  const gooseForkProbe = environment.ACTESTRA_P7_RESOURCE_GOOSE_FORK_PROBE;
  const goosePrivateRoot = environment.ACTESTRA_P7_RESOURCE_GOOSE_PRIVATE_ROOT;
  const runtimeRoots = [
    environment.ACTESTRA_USER_DATA_DIR,
    environment.ACTESTRA_E2E_HOME_DIR,
    environment.ACTESTRA_E2E_TEMP_DIR,
  ];
  if (
    root === undefined ||
    !existingDirectory(root) ||
    evidence === undefined ||
    !path.isAbsolute(evidence) ||
    !existingFile(generalCpuProbe) ||
    !existingFile(generalMemoryProbe) ||
    !existingFile(gooseForkProbe) ||
    !existingDirectory(goosePrivateRoot) ||
    ![
      evidence,
      generalCpuProbe,
      generalMemoryProbe,
      gooseForkProbe,
      goosePrivateRoot,
      ...runtimeRoots,
    ].every((candidate) => candidate !== undefined && contained(root, candidate))
  ) {
    return null;
  }
  return Object.freeze({
    root,
    evidence,
    generalCpuProbe,
    generalMemoryProbe,
    gooseForkProbe,
    goosePrivateRoot,
  });
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function request(clock: SystemAgentClock): AgentStartRequest {
  return Object.freeze({
    workspaceId: workspaceId(identifier("workspace-p7-resource")),
    taskId: taskId(identifier("task-p7-resource")),
    sessionId: sessionId(identifier("session-p7-resource")),
    workerId: workerId(identifier("worker-p7-resource")),
    streamId: eventStreamId(identifier("stream-p7-resource")),
    correlationId: correlationId(identifier("correlation-p7-resource")),
    taskState: "ready",
    startedAt: clock.now(),
    initialPrompt: "Run the bounded P7.2 resource acceptance fixture.",
  });
}

async function waitForResourceFailure(
  supervisor: AgentAdapterSupervisor,
  attempt: AgentStartRequest,
  expectedCode: WorkerResourceIncidentCode,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const snapshot = supervisor.snapshot(attempt.sessionId);
    if (snapshot.state === "failed" && snapshot.disposed) {
      const events = supervisor.coreEvents(attempt.sessionId);
      const terminal = events.slice(-2);
      if (
        snapshot.incident?.code !== expectedCode ||
        terminal[0]?.type !== "worker.failed" ||
        terminal[0].payload.errorCode !== expectedCode ||
        terminal[1]?.type !== "task.failed" ||
        terminal[1].payload.errorCode !== expectedCode
      ) {
        throw new Error("P7.2 General resource terminal evidence is incomplete");
      }
      return;
    }
    if (
      ["cancelled", "completed", "crashed", "timed-out", "protocol-failed"].includes(snapshot.state)
    ) {
      throw new Error("P7.2 General resource probe ended without the admitted incident");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("P7.2 General resource probe timed out");
}

export async function runP7GeneralResourceProbe(
  options: Readonly<{
    modulePath: string;
    workingDirectory: string;
    id: "P7-R-GENERAL-CPU-001" | "P7-R-GENERAL-MEMORY-001";
    timeoutMs?: number;
  }>,
): Promise<P7ResourceReliabilitySmokeResult> {
  if (process.platform !== "darwin" || !existsSync(options.modulePath)) {
    throw new Error("P7.2 General resource probe is unavailable");
  }
  const expectedCode = EXPECTED_CASES[options.id].incidentCode;
  const timeoutMs = options.timeoutMs ?? (options.id === "P7-R-GENERAL-CPU-001" ? 45_000 : 15_000);
  const clock = new SystemAgentClock();
  let adapter: GeneralWorkerProcessAdapter | undefined;
  let monitor: WorkerResourceMonitor | undefined;
  try {
    adapter = await launchElectronGeneralWorker({
      modulePath: options.modulePath,
      workingDirectory: options.workingDirectory,
      clock,
      adapter: {
        startupTimeoutMs: 5_000,
        requestTimeoutMs: 5_000,
        executionMode: "hold",
      },
    });
    adapter.resourceIdentity();
    const supervisor = new AgentAdapterSupervisor(adapter, clock, {
      expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
      requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      startupTimeoutMs: 5_000,
      heartbeatTimeoutMs: 60_000,
      cancellationTimeoutMs: 5_000,
      maxRestarts: 0,
    });
    const attempt = request(clock);
    await supervisor.start(attempt);
    monitor = createWorkerResourceMonitor({
      workerKind: "general",
      attemptId: attempt.sessionId,
      budget: GENERAL_WORKER_RESOURCE_PROFILE,
      clock,
      requiredMetrics: ["cpuSeconds", "privateMemoryBytes"],
      sample: () => adapter!.observeResources(),
      onBreach: async (incident) => {
        await supervisor.failForResource(attempt.sessionId, incident);
      },
      intervalMs: 25,
    });
    monitor.start();
    await waitForResourceFailure(supervisor, attempt, expectedCode, timeoutMs);
    return result(options.id);
  } finally {
    monitor?.stop();
    await adapter?.close().catch((): undefined => undefined);
  }
}

function waitForExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("P7.2 Goose fork probe timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

export async function runP7GooseForkDenialProbe(
  options: Readonly<{
    privateRoot: string;
    probePath: string;
  }>,
): Promise<P7ResourceReliabilitySmokeResult> {
  if (process.platform !== "darwin" || !existsSync(options.probePath)) {
    throw new Error("P7.2 Goose fork probe is unavailable");
  }
  const probeRoot = await mkdtemp(path.join(options.privateRoot, "fork-probe-"));
  const resultPath = path.join(probeRoot, "result.txt");
  const launch = createGooseRunnerSandboxLaunch({
    executablePath: "/usr/bin/perl",
    privateRoot: probeRoot,
    networkPorts: [],
  });
  const child = spawn(launch.executable, [...launch.args, options.probePath, resultPath], {
    detached: true,
    env: { PATH: process.env.PATH ?? "" },
    stdio: "ignore",
  });
  let leaderExited = false;
  child.once("exit", () => {
    leaderExited = true;
  });
  try {
    const exitCode = await waitForExit(child, 5_000);
    if (exitCode !== 0 || !existsSync(resultPath)) {
      throw new Error("P7.2 Goose fork denial was not physically verified");
    }
    return result("P7-R-GOOSE-FORK-001");
  } finally {
    if (child.pid !== undefined && !leaderExited) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // A denied fork normally leaves no process group by cleanup time.
      }
    }
    await rm(probeRoot, { recursive: true });
  }
}

export async function runP7GooseOutputBoundaryProbe(): Promise<P7ResourceReliabilitySmokeResult> {
  try {
    assertWorkerOutputWithinBudget("x".repeat(256 * 1024 + 1));
  } catch (error) {
    if (
      error instanceof WorkerStorageBudgetError &&
      error.code === "worker-resource-output-exceeded"
    ) {
      return result("P7-R-GOOSE-OUTPUT-001");
    }
  }
  throw new Error("P7.2 Goose output boundary was not enforced");
}

export async function runP7GooseStorageBoundaryProbe(
  privateRoot: string,
): Promise<P7ResourceReliabilitySmokeResult> {
  const probeRoot = await mkdtemp(path.join(privateRoot, "storage-probe-"));
  try {
    const oversized = path.join(probeRoot, "oversized.bin");
    await writeFile(oversized, "", { mode: 0o600 });
    await truncate(oversized, 64 * 1024 * 1024 + 1);
    await assertWorkerPrivateStorageWithinBudget(probeRoot);
  } catch (error) {
    if (
      error instanceof WorkerStorageBudgetError &&
      error.code === "worker-resource-storage-exceeded"
    ) {
      return result("P7-R-GOOSE-STORAGE-001");
    }
    throw new Error("P7.2 Goose storage boundary evidence is unavailable");
  } finally {
    await rm(probeRoot, { recursive: true });
  }
  throw new Error("P7.2 Goose storage boundary was not enforced");
}

export async function runP7PackagedResourceReliabilitySmoke(
  isolation: P7ResourceReliabilitySmokeIsolation,
): Promise<readonly P7ResourceReliabilitySmokeResult[]> {
  const results = Object.freeze([
    await runP7GeneralResourceProbe({
      modulePath: isolation.generalCpuProbe,
      workingDirectory: isolation.root,
      id: "P7-R-GENERAL-CPU-001",
    }),
    await runP7GeneralResourceProbe({
      modulePath: isolation.generalMemoryProbe,
      workingDirectory: isolation.root,
      id: "P7-R-GENERAL-MEMORY-001",
    }),
    await runP7GooseOutputBoundaryProbe(),
    await runP7GooseStorageBoundaryProbe(isolation.goosePrivateRoot),
    await runP7GooseForkDenialProbe({
      privateRoot: isolation.goosePrivateRoot,
      probePath: isolation.gooseForkProbe,
    }),
  ]);
  assertP7ResourceReliabilityResults(results);
  return results;
}
