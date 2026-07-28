// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { instant, type DomainGraph } from "../../apps/desktop/src/core";
import { createMainPlatformServices } from "../../apps/desktop/src/main/platform/mainPlatformServices";
import { AgentAdapterSupervisor } from "../../apps/desktop/src/main/workers/agentAdapterSupervisor";
import {
  DeterministicAgentClock,
  DeterministicFakeAgentAdapter,
} from "../../apps/desktop/src/main/workers/deterministicFakeAgentAdapter";
import {
  createAgentStartRequest,
  FIXTURE_AGENT_CORRELATION_ID,
  FIXTURE_AGENT_SESSION_ID,
  FIXTURE_AGENT_STREAM_ID,
  FIXTURE_AGENT_TASK_ID,
  FIXTURE_AGENT_WORKER_ID,
  FIXTURE_AGENT_WORKSPACE_ID,
} from "../fixtures/agentAdapter";
import { openTestPersistenceUtility } from "../fixtures/persistenceUtility";

const testDirectories: string[] = [];
const STARTED_AT = instant("2026-07-28T08:00:00.000Z");

function createTestDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-attempt-release-test-"));
  testDirectories.push(directory);
  return directory;
}

function createAgentDomainGraph(): DomainGraph {
  return {
    workspaces: [
      {
        id: FIXTURE_AGENT_WORKSPACE_ID,
        name: "Agent workspace",
        state: "active",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      },
    ],
    tasks: [
      {
        id: FIXTURE_AGENT_TASK_ID,
        workspaceId: FIXTURE_AGENT_WORKSPACE_ID,
        title: "Persist a terminal attempt",
        state: "ready",
        activeSessionId: FIXTURE_AGENT_SESSION_ID,
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      },
    ],
    workers: [
      {
        id: FIXTURE_AGENT_WORKER_ID,
        workspaceId: FIXTURE_AGENT_WORKSPACE_ID,
        adapterKind: "deterministic-fake",
        state: "ready",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      },
    ],
    sessions: [
      {
        id: FIXTURE_AGENT_SESSION_ID,
        workspaceId: FIXTURE_AGENT_WORKSPACE_ID,
        taskId: FIXTURE_AGENT_TASK_ID,
        workerId: FIXTURE_AGENT_WORKER_ID,
        state: "created",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      },
    ],
    approvals: [],
    artifacts: [],
  };
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), "actestra-attempt-release-test-"))) {
      throw new Error(`Refusing to remove unexpected test directory: ${directory}`);
    }
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  }
});

describe("main terminal-attempt persistence integration", () => {
  it("survives restart only after the coordinator crosses the release barrier", async () => {
    const userDataPath = createTestDirectory();
    const seed = (await openTestPersistenceUtility(userDataPath)).client;
    await seed.replaceDomainGraph(createAgentDomainGraph());
    await seed.close();

    const clock = new DeterministicAgentClock(STARTED_AT);
    const adapter = new DeterministicFakeAgentAdapter(clock);
    const supervisor = new AgentAdapterSupervisor(adapter, clock, {
      expectedAdapterKind: "deterministic-fake",
      requiredCapabilities: ["messages", "approvals", "cancellation", "heartbeats"],
      startupTimeoutMs: 2_000,
      heartbeatTimeoutMs: 3_000,
      cancellationTimeoutMs: 1_000,
      maxRestarts: 1,
    });
    adapter.registerPlan(FIXTURE_AGENT_SESSION_ID, {
      steps: [{ type: "complete" }],
    });
    await supervisor.start(createAgentStartRequest());
    await adapter.advance(FIXTURE_AGENT_SESSION_ID);

    const servicesPersistence = await openTestPersistenceUtility(userDataPath);
    const services = createMainPlatformServices(servicesPersistence.client);
    const coordinator = services.createAttemptEvidenceCoordinator(supervisor);
    await coordinator.persistAndRelease(FIXTURE_AGENT_SESSION_ID);
    expect(supervisor.listAttempts()).toEqual([]);
    await services.close();

    const reopened = (await openTestPersistenceUtility(userDataPath)).client;
    await expect(reopened.replayEvents(FIXTURE_AGENT_STREAM_ID)).resolves.toHaveLength(2);
    await expect(reopened.listRecentAgentAttemptEvidence(50)).resolves.toMatchObject([
      {
        workspaceId: FIXTURE_AGENT_WORKSPACE_ID,
        taskId: FIXTURE_AGENT_TASK_ID,
        correlationId: FIXTURE_AGENT_CORRELATION_ID,
        sessionId: FIXTURE_AGENT_SESSION_ID,
        state: "completed",
      },
    ]);
    await reopened.close();
  });
});
