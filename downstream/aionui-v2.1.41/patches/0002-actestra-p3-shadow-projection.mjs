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

writeNew(
  "packages/desktop/src/common/config/actestraShadowContract.ts",
  `/**
 * Fixed F2 renderer-to-main compatibility channel.
 *
 * The native AionUi response path remains authoritative. This API only accepts
 * bounded metadata observations for a fail-isolated P3 shadow projection.
 */

export const ACTESTRA_SHADOW_OBSERVE_CHANNEL =
  'actestra:shadow-observe-v1';

export type ActestraShadowObservationResult =
  | {
      readonly status: 'appended' | 'duplicate';
      readonly evidenceId: string;
      readonly sequence: number;
    }
  | {
      readonly status: 'rejected';
      readonly code:
        | 'invalid-observation'
        | 'persistence-unavailable'
        | 'projection-failed';
    };

export interface ActestraShadowBridgeApi {
  observe(observation: unknown): Promise<ActestraShadowObservationResult>;
}

declare global {
  interface Window {
    actestraShadow?: ActestraShadowBridgeApi;
  }
}
`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraShadowPublisher.ts",
  `import {
  collectAionUiHttpObservations,
  collectAionUiWebSocketObservations,
  type AionUiNativeObservation,
} from '@/actestra/compatibility/aionui/nativeObservations';
import type { ActestraShadowObservationResult } from '@/common/config/actestraShadowContract';

function warnUnavailable(): void {
  console.warn('[Actestra shadow] Observation channel unavailable');
}

function publish(observations: readonly AionUiNativeObservation[]): void {
  if (
    typeof window === 'undefined' ||
    window.actestraShadow === undefined
  ) {
    return;
  }

  const bridge = window.actestraShadow;
  for (const observation of observations) {
    try {
      void bridge
        .observe(observation)
        .then((result: ActestraShadowObservationResult) => {
          if (result.status === 'rejected') {
            console.warn(
              '[Actestra shadow] Observation rejected:',
              result.code,
            );
          }
        })
        .catch(warnUnavailable);
    } catch {
      // F2 shadow failures must never alter a native response or UI state.
      warnUnavailable();
    }
  }
}

export function publishActestraHttpObservation(input: {
  readonly method: string;
  readonly path: string;
  readonly response: unknown;
}): void {
  try {
    publish(collectAionUiHttpObservations(input));
  } catch {
    warnUnavailable();
  }
}

export function publishActestraWebSocketObservation(input: {
  readonly eventName: string;
  readonly payload: unknown;
}): void {
  try {
    publish(collectAionUiWebSocketObservations(input));
  } catch {
    warnUnavailable();
  }
}
`,
);

writeNew(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';
import type { AionUiShadowObservationResult } from '@/actestra/main/compatibility/aionuiShadowProjectionService';
import { AionUiShadowProjectionService } from '@/actestra/main/compatibility/aionuiShadowProjectionService';
import {
  openSqliteCorePersistence,
  type ActestraPersistencePort,
} from '@/actestra/main/persistence/sqliteCorePersistence';
import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '@/common/config/actestraShadowContract';

let currentWindow: BrowserWindow | null = null;
let persistence: ActestraPersistencePort | null = null;
let projectionService: AionUiShadowProjectionService | null = null;
let handlerRegistered = false;

const unavailable = (): AionUiShadowObservationResult => ({
  status: 'rejected',
  code: 'persistence-unavailable',
});

async function observe(
  event: IpcMainInvokeEvent,
  observation: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiShadowObservationResult> {
  if (
    extraArguments.length !== 0 ||
    currentWindow === null ||
    currentWindow.isDestroyed() ||
    event.sender !== currentWindow.webContents ||
    event.senderFrame !== currentWindow.webContents.mainFrame
  ) {
    return unavailable();
  }

  return projectionService?.observe(observation) ?? unavailable();
}

export function registerActestraShadowBridge(
  window: BrowserWindow,
  userDataPath: string,
): void {
  currentWindow = window;
  if (!handlerRegistered) {
    ipcMain.handle(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observe);
    handlerRegistered = true;
  }
  if (projectionService !== null) {
    return;
  }

  try {
    persistence = openSqliteCorePersistence(userDataPath);
    projectionService = new AionUiShadowProjectionService(persistence);
  } catch {
    persistence = null;
    projectionService = null;
    console.warn('[Actestra shadow] Persistence unavailable at startup');
  }
}

export async function closeActestraShadowBridge(): Promise<void> {
  const activePersistence = persistence;
  currentWindow = null;
  persistence = null;
  projectionService = null;
  if (activePersistence !== null) {
    try {
      await activePersistence.close();
    } catch {
      console.warn('[Actestra shadow] Persistence unavailable during shutdown');
    }
  }
}
`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  "import { assertActestraBridgeRequestAllowed } from '@/common/config/actestraProduct';",
  `import { assertActestraBridgeRequestAllowed } from '@/common/config/actestraProduct';
import {
  publishActestraHttpObservation,
  publishActestraWebSocketObservation,
} from './actestraShadowPublisher';`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  const json = await response.json();
  // Backend wraps in { success, data, ... } — unwrap when present
  if (json && typeof json === 'object' && 'data' in json) {
    return json.data as T;
  }
  return json as T;`,
  `  const json = await response.json();
  // Backend wraps in { success, data, ... } — unwrap when present.
  const data =
    json && typeof json === 'object' && 'data' in json ? json.data : json;
  publishActestraHttpObservation({
    method,
    path,
    response: data,
  });
  return data as T;`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `function dispatchWsEvent(eventName: string, payload: unknown): void {
  const handlers = wsListeners.get(eventName);`,
  `function dispatchWsEvent(eventName: string, payload: unknown): void {
  publishActestraWebSocketObservation({ eventName, payload });
  const handlers = wsListeners.get(eventName);`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  "import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';",
  `import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';
import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '../common/config/actestraShadowContract';`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `contextBridge.exposeInMainWorld('electronAPI', {
`,
  `contextBridge.exposeInMainWorld('actestraShadow', {
  observe: (observation: unknown) =>
    ipcRenderer.invoke(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observation),
});

contextBridge.exposeInMainWorld('electronAPI', {
`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  "import { installQuitCleanup } from './process/startup/quitCleanup';",
  `import { installQuitCleanup } from './process/startup/quitCleanup';
import {
  closeActestraShadowBridge,
  registerActestraShadowBridge,
} from './process/services/actestraShadowBridge';`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  initMainAdapterWithWindow(mainWindow);
  bindMainWindowReferences(mainWindow);`,
  `  initMainAdapterWithWindow(mainWindow);
  registerActestraShadowBridge(mainWindow, app.getPath('userData'));
  bindMainWindowReferences(mainWindow);`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  stopBackend: () => backendManager.stop(),
  destroyPetWindow: async () => {`,
  `  stopBackend: async () => {
    await closeActestraShadowBridge();
    await backendManager.stop();
  },
  destroyPetWindow: async () => {`,
);

writeNew(
  "tests/unit/actestra/shadowProjection.test.ts",
  `// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  assertAionUiNativeObservation,
  collectAionUiHttpObservations,
  collectAionUiWebSocketObservations,
} from '@/actestra/compatibility/aionui/nativeObservations';
import { projectAionUiObservation } from '@/actestra/compatibility/aionui/shadowProjection';
import {
  assertCoreEventStream,
  assertDomainGraph,
} from '@/actestra/core';

const OBSERVED_AT = Date.parse('2026-07-29T03:00:00.000Z');

describe('Actestra F2 AionUi shadow projection', () => {
  it('projects all seven metadata domains without native content or identifiers', () => {
    const observations = [
      ...collectAionUiHttpObservations({
        method: 'GET',
        path: '/api/conversations',
        observedAtMs: OBSERVED_AT,
        response: {
          items: [{
            id: 'conversation-private',
            name: 'Private title',
            type: 'acp',
            status: 'running',
            extra: {
              workspace: '/Users/private/workspace',
              backend: 'codex',
            },
            model: {
              id: 'provider-private',
              api_key: 'sk-do-not-project',
            },
          }],
        },
      }),
      ...collectAionUiHttpObservations({
        method: 'GET',
        path: '/api/providers',
        observedAtMs: OBSERVED_AT,
        response: [{ id: 'provider-private', enabled: true }],
      }),
      ...collectAionUiHttpObservations({
        method: 'GET',
        path: '/api/conversations/conversation-private/workspace',
        observedAtMs: OBSERVED_AT,
        response: [{ name: 'private.txt' }],
      }),
      ...collectAionUiHttpObservations({
        method: 'GET',
        path: '/api/conversations/conversation-private/confirmations',
        observedAtMs: OBSERVED_AT,
        response: [{ id: 'approval-private', description: 'Private command' }],
      }),
      ...collectAionUiHttpObservations({
        method: 'GET',
        path: '/api/conversations/conversation-private/artifacts',
        observedAtMs: OBSERVED_AT,
        response: [{
          id: 'artifact-private',
          payload: { content: 'Private artifact' },
        }],
      }),
      ...collectAionUiWebSocketObservations({
        eventName: 'turn.completed',
        observedAtMs: OBSERVED_AT,
        payload: {
          session_id: 'conversation-private',
          turn_id: 'turn-private',
          status: 'finished',
          runtime: { state: 'idle', turn_id: 'turn-private' },
          last_message: { content: 'Private response' },
        },
      }),
    ];

    expect(new Set(observations.map(({ kind }) => kind))).toEqual(
      new Set([
        'conversation',
        'task',
        'provider',
        'workspace',
        'approval',
        'artifact',
        'runtime',
      ]),
    );

    for (const observation of observations) {
      assertAionUiNativeObservation(observation);
      const evidence = projectAionUiObservation(observation);
      assertDomainGraph(evidence.graph);
      assertCoreEventStream(evidence.events);
      expect(evidence.redaction).toBe('metadata-only');
      const encoded = JSON.stringify(evidence);
      expect(encoded).not.toContain('conversation-private');
      expect(encoded).not.toContain('/Users/private/workspace');
      expect(encoded).not.toContain('sk-do-not-project');
      expect(encoded).not.toContain('Private');
    }
  });

  it('emits a deterministic ordered P3 task event stream', () => {
    const [observation] = collectAionUiWebSocketObservations({
      eventName: 'turn.completed',
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: 'conversation-1',
        turn_id: 'turn-1',
        status: 'finished',
        runtime: { state: 'idle', turn_id: 'turn-1' },
      },
    });
    const first = projectAionUiObservation(observation);
    const second = projectAionUiObservation(observation);
    expect(first).toEqual(second);
    expect(first.events.map(({ sequence, type }) => [sequence, type])).toEqual([
      [1, 'task.started'],
      [2, 'task.completed'],
    ]);
  });

  it('keeps complete workspace counts and explicit terminal states', () => {
    const [workspace] = collectAionUiHttpObservations({
      method: 'GET',
      path: '/api/conversations/conversation-1/workspace',
      observedAtMs: OBSERVED_AT,
      response: Array.from({ length: 75 }, (_, index) => ({
        name: \`private-\${index}.txt\`,
      })),
    });
    const [failed] = collectAionUiWebSocketObservations({
      eventName: 'turn.completed',
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: 'conversation-1',
        turn_id: 'turn-failed',
        status: 'failed',
        state: 'unknown',
      },
    });
    const [cancelledState] = collectAionUiWebSocketObservations({
      eventName: 'turn.completed',
      observedAtMs: OBSERVED_AT,
      payload: {
        session_id: 'conversation-1',
        turn_id: 'turn-cancelled-state',
        state: 'cancelled',
      },
    });
    expect(workspace).toMatchObject({ kind: 'workspace', entryCount: 75 });
    expect(failed).toMatchObject({ kind: 'task', status: 'failed' });
    expect(cancelledState).toMatchObject({ kind: 'task', status: 'cancelled' });
    expect(
      collectAionUiHttpObservations({
        method: 'GET',
        path: '/api/conversations/conversation-1/active-lease',
        observedAtMs: OBSERVED_AT,
        response: { runtime: { failure_kind: '' } },
      }),
    ).toEqual([]);
  });

  it('uses capture-independent canonical revisions for unchanged metadata', () => {
    const first = projectAionUiObservation({
      contractVersion: 1,
      kind: 'provider',
      nativeId: 'provider-1',
      observedAtMs: OBSERVED_AT,
      providerId: 'provider-1',
      available: true,
      platform: 'openai',
    });
    const replayed = projectAionUiObservation({
      platform: 'openai',
      available: true,
      providerId: 'provider-1',
      observedAtMs: OBSERVED_AT + 10_000,
      nativeId: 'provider-1',
      kind: 'provider',
      contractVersion: 1,
    });
    expect(replayed.evidenceId).toBe(first.evidenceId);
    expect(replayed.nativeRevisionHash).toBe(first.nativeRevisionHash);
    expect(replayed.capturedAt).not.toBe(first.capturedAt);
  });
});
`,
);

writeNew(
  "tests/unit/actestra/shadowPublisher.test.ts",
  `// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishActestraHttpObservation } from '@/common/adapter/actestraShadowPublisher';
import { httpRequest } from '@/common/adapter/httpBridge';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Actestra F2 native response isolation', () => {
  it('returns the native response unchanged when shadow persistence fails', async () => {
    const observe = vi.fn(async () => {
      throw new Error('shadow unavailable');
    });
    vi.stubGlobal('window', {
      __backendPort: 13400,
      actestraShadow: { observe },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'conversation-private',
              name: 'Native title remains visible',
              type: 'acp',
              status: 'running',
              extra: { workspace: '/Users/private/workspace' },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await httpRequest<Record<string, unknown>>(
      'GET',
      '/api/conversations/conversation-private',
    );

    expect(result).toMatchObject({
      id: 'conversation-private',
      name: 'Native title remains visible',
    });
    await vi.waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
    expect(observe.mock.calls[0]?.[0]).not.toHaveProperty('name');
    expect(JSON.stringify(observe.mock.calls[0]?.[0])).not.toContain(
      'Native title remains visible',
    );
  });

  it('contains collector and synchronous channel failures', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('window', {
      actestraShadow: {
        observe: () => {
          throw new Error('synchronous channel failure');
        },
      },
    });

    expect(() =>
      publishActestraHttpObservation({
        method: 'GET',
        path: '/api/conversations/conversation-private',
        response: {
          id: 'conversation-private',
          type: 'acp',
          status: 'running',
        },
      }),
    ).not.toThrow();

    const throwingResponse = new Proxy(
      {},
      {
        get() {
          throw new Error('collector failure');
        },
      },
    );
    expect(() =>
      publishActestraHttpObservation({
        method: 'GET',
        path: '/api/conversations/conversation-private',
        response: throwingResponse,
      }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      '[Actestra shadow] Observation channel unavailable',
    );
  });
});
`,
);

writeNew(
  "tests/unit/actestra/shadowPersistence.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AionUiShadowProjectionService } from '@/actestra/main/compatibility/aionuiShadowProjectionService';
import { openSqliteCorePersistence } from '@/actestra/main/persistence/sqliteCorePersistence';

const directories: string[] = [];

function testProfile(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'actestra-downstream-shadow-'),
  );
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (
      !directory.startsWith(
        path.join(os.tmpdir(), 'actestra-downstream-shadow-'),
      )
    ) {
      throw new Error('Refusing to remove an unexpected test directory');
    }
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('Actestra F2 downstream shadow persistence', () => {
  it('is idempotent and restart-safe without changing authoritative P3 state', async () => {
    const profile = testProfile();
    const observation = {
      contractVersion: 1,
      kind: 'provider',
      nativeId: 'provider-private',
      observedAtMs: Date.parse('2026-07-29T03:00:00.000Z'),
      providerId: 'provider-private',
      available: true,
    };

    const firstPersistence = openSqliteCorePersistence(profile);
    const firstService = new AionUiShadowProjectionService(firstPersistence);
    await expect(firstService.observe(observation)).resolves.toMatchObject({
      status: 'appended',
      sequence: 1,
    });
    await expect(firstService.observe({
      ...observation,
      observedAtMs: observation.observedAtMs + 10_000,
    })).resolves.toMatchObject({
      status: 'duplicate',
      sequence: 1,
    });
    await expect(firstPersistence.loadDomainGraph()).resolves.toEqual({
      approvals: [],
      artifacts: [],
      sessions: [],
      tasks: [],
      workers: [],
      workspaces: [],
    });
    await firstPersistence.close();

    const reopened = openSqliteCorePersistence(profile);
    await expect(reopened.summarizeAionUiShadowEvidence()).resolves.toEqual({
      recordCount: 1,
      lastSequence: 1,
    });
    await reopened.close();
  });
});
`,
);
