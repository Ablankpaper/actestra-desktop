import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TeamPlannerSidecarProcess,
  type TeamPlannerSidecarProcessOptions,
} from "../../apps/desktop/src/main/orchestration/teamPlannerSidecarProcess";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixturePath = path.join(repositoryRoot, "tests/fixtures/teamPlannerSidecar.mjs");
const supervisorExitFixturePath = path.join(
  repositoryRoot,
  "tests/fixtures/teamPlannerSupervisorExit.mjs",
);
const EXPECTED_ENGINE = {
  name: "actestra-deterministic-fixture",
  version: "1.0.0",
} as const;

const PLAN_REQUEST = {
  protocolVersion: 1,
  correlationId: "correlation-sidecar-process",
  planVersion: 1,
  goal: "Coordinate one bounded General and coding result.",
  workerCapabilities: ["general", "coding"],
  contextReferences: [],
  limits: {
    maxNodes: 3,
    maxDepth: 2,
    maxConcurrency: 2,
    maxTotalAttempts: 3,
  },
} as const;

const AGGREGATE_PAYLOAD = {
  correlationId: PLAN_REQUEST.correlationId,
  planId: `team-plan-${"a".repeat(64)}`,
  runId: `team-run-${"b".repeat(64)}`,
  revision: 9,
  artifacts: [
    {
      artifactId: "artifact-general-result",
      taskId: "task-general-result",
      kind: "document",
    },
    {
      artifactId: "artifact-coding-result",
      taskId: "task-coding-result",
      kind: "file",
    },
  ],
} as const;

let temporaryRoot = "";

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-team-planner-test-"));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupFixtureProcesses();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

function pidFile(): string {
  return path.join(temporaryRoot, "fixture-pids.json");
}

function childReadyFile(): string {
  return `${pidFile()}.child-ready`;
}

function options(
  mode: string,
  overrides: Partial<TeamPlannerSidecarProcessOptions> = {},
): TeamPlannerSidecarProcessOptions {
  return {
    executable: process.execPath,
    args: [fixturePath, mode, pidFile()],
    workingDirectory: temporaryRoot,
    expectedEngine: EXPECTED_ENGINE,
    startupTimeoutMs: 1_000,
    requestTimeoutMs: 1_000,
    terminationGraceMs: 50,
    ...overrides,
  };
}

async function readFixturePids(): Promise<{
  readonly processId: number;
  readonly childProcessId: number | null;
  readonly receivedRequests: number;
}> {
  await vi.waitFor(() => expect(fs.existsSync(pidFile())).toBe(true));
  return JSON.parse(fs.readFileSync(pidFile(), "utf8")) as {
    readonly processId: number;
    readonly childProcessId: number | null;
    readonly receivedRequests: number;
  };
}

async function waitForReceivedRequest(): Promise<void> {
  await vi.waitFor(() => {
    const state = JSON.parse(fs.readFileSync(pidFile(), "utf8")) as {
      readonly receivedRequests: number;
    };
    expect(state.receivedRequests).toBeGreaterThanOrEqual(1);
  });
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function expectProcessesGone(processIds: readonly (number | null)[]): Promise<void> {
  await vi.waitFor(
    () => {
      for (const processId of processIds) {
        if (processId !== null) expect(processIsAlive(processId)).toBe(false);
      }
    },
    { timeout: 2_000 },
  );
}

function signalRecordedProcessGroup(processId: number, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32") process.kill(processId, signal);
    else process.kill(-processId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForProcessesGone(
  processIds: readonly (number | null)[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processIds.some((processId) => processId !== null && processIsAlive(processId))) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

async function cleanupFixtureProcesses(): Promise<void> {
  if (!fs.existsSync(pidFile())) return;
  const pids = JSON.parse(fs.readFileSync(pidFile(), "utf8")) as {
    readonly processId: number;
    readonly childProcessId: number | null;
  };
  const processIds = [pids.processId, pids.childProcessId];
  if (await waitForProcessesGone(processIds, 100)) return;
  signalRecordedProcessGroup(pids.processId, "SIGTERM");
  if (!(await waitForProcessesGone(processIds, 100))) {
    signalRecordedProcessGroup(pids.processId, "SIGKILL");
  }
  if (!(await waitForProcessesGone(processIds, 1_000))) {
    throw new Error("Team planner fixture process group survived test teardown");
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
}

describe("Team planner sidecar process", () => {
  it("negotiates the exact engine and executes typed propose and aggregate operations", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("normal"));

    const candidate = await sidecar.propose(PLAN_REQUEST);
    expect(candidate).toMatchObject({
      protocolVersion: 1,
      correlationId: PLAN_REQUEST.correlationId,
      planVersion: PLAN_REQUEST.planVersion,
    });

    const aggregate = await sidecar.aggregate(AGGREGATE_PAYLOAD);
    expect(aggregate).toEqual({
      summary: "The bounded Artifact references are ready.",
      artifacts: AGGREGATE_PAYLOAD.artifacts,
    });
    await sidecar.close();
  });

  it("serializes requests so the sidecar never receives concurrent work", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("serial"));
    const [first, second] = await Promise.all([
      sidecar.propose(PLAN_REQUEST),
      sidecar.propose(PLAN_REQUEST),
    ]);
    expect(first.correlationId).toBe(PLAN_REQUEST.correlationId);
    expect(second.correlationId).toBe(PLAN_REQUEST.correlationId);
    await sidecar.close();
  });

  it("treats a transient EPERM process-group probe as evidence the group is alive", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("normal"));
    const originalKill = process.kill.bind(process);
    let injected = false;
    vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
      if (!injected && processId < 0 && signal === 0) {
        injected = true;
        throw Object.assign(new Error("process group probe denied"), { code: "EPERM" });
      }
      return originalKill(processId, signal);
    }) as typeof process.kill);

    await sidecar.close();
    expect(injected).toBe(true);
  });

  it("does not signal a stale process-group identity after the leader exits", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("normal"));
    const pids = await readFixturePids();
    const originalKill = process.kill.bind(process);
    let staleProbeObserved = false;
    let staleSignalSent = false;
    vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
      if (processId !== -pids.processId) return originalKill(processId, signal);
      try {
        return originalKill(processId, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        if (signal === 0) staleProbeObserved = true;
        else staleSignalSent = true;
        throw Object.assign(new Error("stale process group is no longer owned"), { code: "EPERM" });
      }
    }) as typeof process.kill);

    await expect(sidecar.close()).resolves.toBeUndefined();
    expect(staleProbeObserved).toBe(true);
    expect(staleSignalSent).toBe(false);
  });

  it("uses a closed environment with telemetry and network policy disabled", async () => {
    const previous = process.env.ACTESTRA_TEST_PARENT_SECRET;
    process.env.ACTESTRA_TEST_PARENT_SECRET = "must-not-cross";
    try {
      const sidecar = await TeamPlannerSidecarProcess.start(options("assert-environment"));
      await expect(sidecar.propose(PLAN_REQUEST)).resolves.toMatchObject({
        correlationId: PLAN_REQUEST.correlationId,
      });
      await sidecar.close();
    } finally {
      if (previous === undefined) delete process.env.ACTESTRA_TEST_PARENT_SECRET;
      else process.env.ACTESTRA_TEST_PARENT_SECRET = previous;
    }
  });

  it("fails closed on incompatible startup, extra stdout, and malformed JSON", async () => {
    for (const mode of ["incompatible-protocol", "incompatible-engine", "extra-stdout"]) {
      await expect(TeamPlannerSidecarProcess.start(options(mode))).rejects.toMatchObject({
        name: "TeamPlannerSidecarProcessError",
        code: "startup-failed",
      });
    }

    const malformed = await TeamPlannerSidecarProcess.start(options("malformed"));
    await expect(malformed.propose(PLAN_REQUEST)).rejects.toMatchObject({
      name: "TeamPlannerSidecarProcessError",
      code: "protocol-failed",
    });
  });

  it("never exposes stderr, process ids, or executable paths after a crash", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("stderr-crash"));
    const failure = await sidecar.propose(PLAN_REQUEST).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      name: "TeamPlannerSidecarProcessError",
      code: "unavailable",
    });
    const rendered = JSON.stringify(failure);
    expect(rendered).not.toContain("private-sidecar-trace");
    expect(rendered).not.toContain("/private/runtime");
    expect(rendered).not.toContain(fixturePath);
    expect(rendered).not.toMatch(/pid=/u);
  });

  it("times out one request and removes the sidecar process group", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(
      options("timeout", { requestTimeoutMs: 30 }),
    );
    const pids = await readFixturePids();
    await expect(sidecar.propose(PLAN_REQUEST)).rejects.toMatchObject({
      name: "TeamPlannerSidecarProcessError",
      code: "request-timeout",
    });
    await expectProcessesGone([pids.processId, pids.childProcessId]);
  });

  it("discards a response after abort and removes the sidecar process group", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("abort"));
    const pids = await readFixturePids();
    const controller = new AbortController();
    const proposed = sidecar.propose(PLAN_REQUEST, controller.signal);
    await waitForReceivedRequest();
    controller.abort();
    await expect(proposed).rejects.toMatchObject({
      name: "TeamPlannerSidecarProcessError",
      code: "cancelled",
    });
    await expectProcessesGone([pids.processId, pids.childProcessId]);
  });

  it("removes the sidecar process group when the supervisor parent exits", async () => {
    const supervisor = spawn(
      process.execPath,
      [supervisorExitFixturePath, fixturePath, "abort", pidFile(), temporaryRoot],
      {
        cwd: temporaryRoot,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    await expect(waitForExit(supervisor)).resolves.toBe(0);
    const pids = await readFixturePids();
    await expectProcessesGone([pids.processId, pids.childProcessId]);
  });

  it("kills a surviving descendant after the sidecar leader exits during close", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("orphan-child"));
    const pids = await readFixturePids();
    expect(pids.childProcessId).not.toBeNull();
    await vi.waitFor(() => expect(fs.existsSync(childReadyFile())).toBe(true));
    await sidecar.close();
    await expectProcessesGone([pids.processId, pids.childProcessId]);
  });

  it("escalates explicit close to KILL and leaves no child process", async () => {
    const sidecar = await TeamPlannerSidecarProcess.start(options("ignore-term"));
    const pids = await readFixturePids();
    await sidecar.close();
    await expectProcessesGone([pids.processId, pids.childProcessId]);
  });
});
