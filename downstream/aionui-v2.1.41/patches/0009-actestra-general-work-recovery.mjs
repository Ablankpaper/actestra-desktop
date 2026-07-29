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
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import {
  createScopedNativeToolPlatform,
  type ScopedNativeToolPlatform,
} from '@/actestra/main/privileged/scopedNativeToolPlatform';`,
  `import {
  createScopedNativeToolPlatform,
  type ScopedNativeToolPlatform,
} from '@/actestra/main/privileged/scopedNativeToolPlatform';
import { GeneralWorkCoordinator } from '@/actestra/main/workers/generalWorkCoordinator';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    launchedPersistence = utility;
    configurePersistenceServices(utility);
    console.info(
      \`[Actestra persistence] Utility ready schema=\${utility.schemaVersion}\`,
    );`,
  `    launchedPersistence = utility;
    configurePersistenceServices(utility);
    const recoveryClock = nativeToolPlatform?.clock;
    if (recoveryClock === undefined) {
      throw new Error('Actestra native tool platform is unavailable for recovery');
    }
    const recoveredGeneralWork = await new GeneralWorkCoordinator({
      persistence: utility,
      clock: recoveryClock,
    }).recover();
    console.info(
      \`ACTESTRA_GENERAL_WORK_RECOVERY_READY \${JSON.stringify({
        recoveredAttempts: recoveredGeneralWork.length,
      })}\`,
    );
    console.info(
      \`[Actestra persistence] Utility ready schema=\${utility.schemaVersion}\`,
    );`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    nativeToolPlatform = null;
    console.warn('[Actestra shadow] Persistence utility unavailable at startup');`,
  `    nativeToolPlatform = null;
    console.warn('[Actestra general work] Recovery unavailable at startup');
    console.warn('[Actestra shadow] Persistence utility unavailable at startup');`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `keeps AionUI shadow and approval authority behind schema v6 utility IPC`,
  `keeps AionUI shadow, approval, and recovery authority behind schema v7 utility IPC`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `expect(client.schemaVersion).toBe(6);`,
  `expect(client.schemaVersion).toBe(7);`,
);

writeNew(
  "tests/unit/actestra/generalWorkRecovery.test.ts",
  `// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  GENERAL_WORK_RECOVERY_CONTRACT_VERSION,
  REQUIRED_REDACTION_BY_EVENT_TYPE,
  assertGeneralWorkCheckpoint,
  assertGeneralWorkCheckpointTransition,
  correlationId,
  eventId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  workerId,
  workspaceId,
  type CoreEvent,
  type GeneralWorkCheckpoint,
} from '@/actestra/core';

const workspace = workspaceId('workspace-native-recovery');
const task = taskId('task-native-recovery');
const session = sessionId('session-native-recovery');
const worker = workerId('worker-native-recovery');
const stream = eventStreamId('stream-native-recovery');
const correlation = correlationId('correlation-native-recovery');

function event<Type extends 'task.started' | 'worker.failed' | 'task.failed'>(
  sequence: number,
  type: Type,
  payload: CoreEvent<Type>['payload'],
): CoreEvent<Type> {
  return {
    schemaVersion: 1,
    eventId: eventId(\`event-native-recovery-\${sequence}\`),
    streamId: stream,
    sequence,
    occurredAt: instant(
      new Date(Date.parse('2026-07-30T04:00:00.000Z') + sequence * 1_000).toISOString(),
    ),
    workspaceId: workspace,
    taskId: task,
    sessionId: session,
    workerId: worker,
    correlationId: correlation,
    type,
    redaction: REQUIRED_REDACTION_BY_EVENT_TYPE[type],
    payload,
  } as CoreEvent<Type>;
}

describe('Actestra native general-work recovery contract', () => {
  it('requires a monotonic active to terminal-pending checkpoint transition', () => {
    const started = event(1, 'task.started', {
      from: 'ready',
      to: 'running',
    });
    const active: GeneralWorkCheckpoint = {
      contractVersion: GENERAL_WORK_RECOVERY_CONTRACT_VERSION,
      phase: 'active',
      revision: 1,
      attempt: {
        workspaceId: workspace,
        taskId: task,
        correlationId: correlation,
        sessionId: session,
        workerId: worker,
        streamId: stream,
        state: 'running',
        taskState: 'running',
        startedAt: started.occurredAt,
        lastSignalAt: started.occurredAt,
        lastControlSequence: 1,
        lastCoreEventSequence: 1,
        restartCount: 0,
        disposed: false,
        forcedCancellation: false,
      },
      events: [started],
      createdAt: started.occurredAt,
      updatedAt: started.occurredAt,
    };
    const failedAt = instant('2026-07-30T04:00:03.000Z');
    const terminal: GeneralWorkCheckpoint = {
      ...active,
      phase: 'terminal-pending',
      revision: 2,
      attempt: {
        ...active.attempt,
        state: 'failed',
        taskState: 'failed',
        lastSignalAt: failedAt,
        lastCoreEventSequence: 3,
        disposed: true,
        incident: {
          code: 'application-restart',
          occurredAt: failedAt,
        },
      },
      events: [
        started,
        event(2, 'worker.failed', {
          errorCode: 'application-restart',
          message: 'Worker interrupted by application restart.',
          retryable: true,
        }),
        event(3, 'task.failed', {
          from: 'running',
          to: 'failed',
          errorCode: 'application-restart',
          message: 'A fresh attempt is required.',
        }),
      ],
      updatedAt: failedAt,
    };

    expect(() => assertGeneralWorkCheckpoint(active)).not.toThrow();
    expect(() => assertGeneralWorkCheckpoint(terminal)).not.toThrow();
    expect(() => assertGeneralWorkCheckpointTransition(active, terminal)).not.toThrow();
    expect(() =>
      assertGeneralWorkCheckpointTransition(active, {
        ...terminal,
        revision: 3,
      }),
    ).toThrow();
  });
});
`,
);
