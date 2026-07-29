import { randomUUID } from "node:crypto";
import {
  correlationId,
  eventStreamId,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type AgentStartRequest,
} from "../../core";
import { AgentAdapterSupervisor } from "./agentAdapterSupervisor";
import {
  GENERAL_WORKER_ADAPTER_KIND,
  type GeneralWorkerProcessAdapter,
} from "./generalWorkerProcessAdapter";
import { SystemAgentClock, launchElectronGeneralWorker } from "./electronGeneralWorker";

export interface GeneralWorkerProbeOptions {
  readonly modulePath: string;
  readonly workingDirectory: string;
  readonly timeoutMs?: number;
}

export interface GeneralWorkerProbeResult {
  readonly adapterProtocolVersion: 2;
  readonly workerProtocolVersion: 1;
  readonly state: "completed";
  readonly eventCount: number;
  readonly disposed: true;
}

function identifier(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function waitForCompleted(
  supervisor: AgentAdapterSupervisor,
  request: AgentStartRequest,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const snapshot = supervisor.snapshot(request.sessionId);
    if (snapshot.state === "completed" && snapshot.disposed) {
      return;
    }
    if (
      snapshot.state === "failed" ||
      snapshot.state === "cancelled" ||
      snapshot.state === "crashed" ||
      snapshot.state === "timed-out" ||
      snapshot.state === "protocol-failed"
    ) {
      throw new Error(`General Worker probe ended in ${snapshot.state}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error("General Worker probe did not complete before timeout");
}

export async function runGeneralWorkerProbe(
  options: GeneralWorkerProbeOptions,
): Promise<GeneralWorkerProbeResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("General Worker probe timeout must be a positive integer");
  }
  const clock = new SystemAgentClock();
  let adapter: GeneralWorkerProcessAdapter | null = null;
  try {
    adapter = await launchElectronGeneralWorker({
      modulePath: options.modulePath,
      workingDirectory: options.workingDirectory,
      clock,
      adapter: {
        startupTimeoutMs: timeoutMs,
        requestTimeoutMs: timeoutMs,
        executionMode: "no-tool-complete",
      },
    });
    const supervisor = new AgentAdapterSupervisor(adapter, clock, {
      expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
      requiredCapabilities: ["messages", "cancellation", "heartbeats", "tool-results"],
      startupTimeoutMs: timeoutMs,
      heartbeatTimeoutMs: timeoutMs,
      cancellationTimeoutMs: timeoutMs,
      maxRestarts: 0,
    });
    const request: AgentStartRequest = {
      workspaceId: workspaceId(identifier("workspace-probe")),
      taskId: taskId(identifier("task-probe")),
      sessionId: sessionId(identifier("session-probe")),
      workerId: workerId(identifier("worker-probe")),
      streamId: eventStreamId(identifier("stream-probe")),
      correlationId: correlationId(identifier("correlation-probe")),
      taskState: "ready",
      startedAt: clock.now(),
      initialPrompt: "Complete the deterministic no-tool process probe.",
    };
    await supervisor.start(request);
    await waitForCompleted(supervisor, request, timeoutMs);
    const events = supervisor.coreEvents(request.sessionId);
    if (
      events.length !== 3 ||
      events[0]?.type !== "task.started" ||
      events[1]?.type !== "agent.message" ||
      events[2]?.type !== "task.completed"
    ) {
      throw new Error("General Worker probe produced an unexpected event journey");
    }
    await supervisor.dispose(request.sessionId);
    return Object.freeze({
      adapterProtocolVersion: 2,
      workerProtocolVersion: 1,
      state: "completed",
      eventCount: events.length,
      disposed: true,
    });
  } finally {
    await adapter?.close().catch((): undefined => undefined);
  }
}
