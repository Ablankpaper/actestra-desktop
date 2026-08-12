import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

function absolutePath(relativePath) {
  return path.join(outputRoot, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), "utf8");
}

function write(relativePath, contents) {
  const filePath = absolutePath(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function writeNew(relativePath, contents) {
  if (fs.existsSync(absolutePath(relativePath))) {
    throw new Error(`Downstream overlay expected a new file: ${relativePath}`);
  }
  write(relativePath, contents);
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `            'actestra-persistence-utility': resolve(
              'packages/desktop/src/actestra/utility/persistence/persistenceUtilityEntry.ts'
            ),
            // Built-in MCP server entry points`,
  `            'actestra-persistence-utility': resolve(
              'packages/desktop/src/actestra/utility/persistence/persistenceUtilityEntry.ts'
            ),
            'actestra-general-worker': resolve(
              'packages/desktop/src/actestra/utility/worker/generalWorkerEntry.ts'
            ),
            // Built-in MCP server entry points`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `} from './process/services/actestraShadowBridge';
import { shouldRegisterBackendStartup }`,
  `} from './process/services/actestraShadowBridge';
import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';
import { shouldRegisterBackendStartup }`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `    await initializeProcess();
    await initializeActestraPersistenceUtility(app.getPath('userData'));
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;`,
  `    await initializeProcess();
    await initializeActestraPersistenceUtility(app.getPath('userData'));
    if (process.env.ACTESTRA_E2E_TEST === '1') {
      const workerProbe = await runGeneralWorkerProbe({
        modulePath: path.join(__dirname, 'actestra-general-worker.js'),
        workingDirectory: process.resourcesPath,
      });
      console.info(\`ACTESTRA_GENERAL_WORKER_READY \${JSON.stringify(workerProbe)}\`);
    }
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;`,
);

writeNew(
  "tests/unit/actestra/generalWorkerProcessAdapter.test.ts",
  `// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  correlationId,
  eventId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type AgentClock,
  type AgentStartRequest,
  type EventId,
  type Instant,
} from '@/actestra/core';
import {
  AgentAdapterSupervisor,
  type AgentAdapterSupervisorConfig,
} from '@/actestra/main/workers/agentAdapterSupervisor';
import {
  GENERAL_WORKER_ADAPTER_KIND,
  GeneralWorkerProcessAdapter,
  type GeneralWorkerProcessTransport,
} from '@/actestra/main/workers/generalWorkerProcessAdapter';
import {
  createGeneralWorkerReadyMessage,
} from '@/actestra/shared/generalWorkerProtocol';
import { GeneralWorkerService } from '@/actestra/utility/worker/generalWorkerService';

type MessageListener = (message: unknown) => void;
type ErrorListener = () => void;
type ExitListener = (code: number) => void;

class StaticClock implements AgentClock {
  now(): Instant {
    return instant('2026-07-30T02:00:00.000Z');
  }
}

class LoopbackGeneralWorkerTransport implements GeneralWorkerProcessTransport {
  private readonly messages = new Set<MessageListener>();
  private readonly errors = new Set<ErrorListener>();
  private readonly exits = new Set<ExitListener>();
  private readonly service = new GeneralWorkerService();
  private stopped = false;

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      void this.service.handle(message).then((responses) => {
        if (this.stopped) return;
        for (const response of responses) {
          for (const listener of this.messages) {
            listener(response);
          }
        }
      });
    });
  }

  onMessage(listener: MessageListener): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errors.add(listener);
    return () => this.errors.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  kill(): boolean {
    if (this.stopped) return false;
    this.stopped = true;
    this.service.shutdown();
    queueMicrotask(() => {
      for (const listener of this.exits) {
        listener(0);
      }
    });
    return true;
  }

  start(): void {
    queueMicrotask(() => {
      for (const listener of this.messages) {
        listener(createGeneralWorkerReadyMessage());
      }
    });
  }
}

const supervisorConfig = {
  expectedAdapterKind: GENERAL_WORKER_ADAPTER_KIND,
  requiredCapabilities: [
    'messages',
    'cancellation',
    'heartbeats',
    'tool-results',
  ],
  startupTimeoutMs: 2_000,
  heartbeatTimeoutMs: 3_000,
  cancellationTimeoutMs: 1_000,
  maxRestarts: 0,
} as const satisfies AgentAdapterSupervisorConfig;

function request(clock: AgentClock): AgentStartRequest {
  return {
    workspaceId: workspaceId('workspace-native-general-worker'),
    taskId: taskId('task-native-general-worker'),
    sessionId: sessionId('session-native-general-worker'),
    workerId: workerId('worker-native-general-worker'),
    streamId: eventStreamId('stream-native-general-worker'),
    correlationId: correlationId('correlation-native-general-worker'),
    taskState: 'ready',
    startedAt: clock.now(),
    initialPrompt: 'Complete the native deterministic process journey.',
  };
}

describe('Actestra native General Worker process adapter', () => {
  it('negotiates Adapter v2 and completes through supervised worker events', async () => {
    const transport = new LoopbackGeneralWorkerTransport();
    const clock = new StaticClock();
    let sequence = 0;
    const connecting = GeneralWorkerProcessAdapter.connect(transport, clock, {
      executionMode: 'no-tool-complete',
      newAttemptToken: () => 'attempt-native-general-worker',
      newEventId: (): EventId => {
        sequence += 1;
        return eventId(\`event-native-general-worker-\${sequence}\`);
      },
    });
    transport.start();
    const adapter = await connecting;
    expect(await adapter.capabilities()).toMatchObject({
      protocolVersion: 2,
      adapterKind: GENERAL_WORKER_ADAPTER_KIND,
      capabilities: ['messages', 'cancellation', 'heartbeats', 'tool-results'],
      maxConcurrentSessions: 1,
    });
    const supervisor = new AgentAdapterSupervisor(
      adapter,
      clock,
      supervisorConfig,
    );
    const startRequest = request(clock);

    await supervisor.start(startRequest);
    await vi.waitFor(() => {
      expect(supervisor.snapshot(startRequest.sessionId)).toMatchObject({
        state: 'completed',
        disposed: true,
      });
    });
    expect(
      supervisor.coreEvents(startRequest.sessionId).map((event) => event.type),
    ).toEqual(['task.started', 'agent.message', 'task.completed']);
    await adapter.close();
  });
});
`,
);
