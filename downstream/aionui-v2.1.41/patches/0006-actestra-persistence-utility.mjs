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

function replaceRange(relativePath, start, end, replacement) {
  const contents = read(relativePath);
  const startIndex = contents.indexOf(start);
  const endIndex = contents.indexOf(end, startIndex + start.length);
  if (
    startIndex === -1 ||
    endIndex === -1 ||
    contents.indexOf(start, startIndex + start.length) !== -1
  ) {
    throw new Error(`Expected one bounded downstream patch range in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, startIndex) + replacement + contents.slice(endIndex));
}

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `          input: {
            index: resolve('packages/desktop/src/index.ts'),
            // Built-in MCP server entry points`,
  `          input: {
            index: resolve('packages/desktop/src/index.ts'),
            'actestra-persistence-utility': resolve(
              'packages/desktop/src/actestra/utility/persistence/persistenceUtilityEntry.ts'
            ),
            // Built-in MCP server entry points`,
);

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `            // not vite — esbuild bundles all deps for self-contained execution by external node processes)
          },
          onwarn(warning, warn) {`,
  `            // not vite — esbuild bundles all deps for self-contained execution by external node processes)
          },
          output: {
            entryFileNames: '[name].js',
          },
          onwarn(warning, warn) {`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `import {
  closeActestraShadowBridge,
  registerActestraShadowBridge,
} from './process/services/actestraShadowBridge';`,
  `import {
  closeActestraShadowBridge,
  initializeActestraPersistenceUtility,
  registerActestraShadowBridge,
} from './process/services/actestraShadowBridge';`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  registerActestraShadowBridge(mainWindow, app.getPath('userData'));`,
  `  registerActestraShadowBridge(mainWindow);`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `    await initializeProcess();
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;`,
  `    await initializeProcess();
    await initializeActestraPersistenceUtility(app.getPath('userData'));
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `} from 'electron';
import type { AionUiShadowObservationResult }`,
  `} from 'electron';
import path from 'node:path';
import type { AionUiShadowObservationResult }`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import {
  openSqliteCorePersistence,
  type ActestraPersistencePort,
} from '@/actestra/main/persistence/sqliteCorePersistence';`,
  `import type { ActestraPersistencePort } from '@/actestra/core';
import {
  launchElectronPersistenceUtility,
} from '@/actestra/main/persistence/electronPersistenceUtility';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `let approvalHandlerRegistered = false;`,
  `let approvalHandlerRegistered = false;
let approvalRecoveryStarted = false;`,
);

replaceRange(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  "export function registerActestraShadowBridge(",
  "export async function closeActestraShadowBridge(): Promise<void> {",
  `function configurePersistenceServices(
  activePersistence: ActestraPersistencePort,
): void {
  persistence = activePersistence;
  projectionService = new AionUiShadowProjectionService(activePersistence);
  const nativeApprovalTransport =
    new LoopbackAionUiApprovalNativeTransport();
  const deliveryGatedApprovalTransport = approvalPolicyGateEnabled
    ? createPolicyGatedAionUiApprovalNativeTransport({
        persistence: activePersistence,
        transport: nativeApprovalTransport,
      })
    : nativeApprovalTransport;
  const approvalTransport =
    approvalPolicyGateEnabled && approvalReconciliationGateEnabled
      ? createPolicyGatedAionUiApprovalReconciliationTransport({
          persistence: activePersistence,
          transport: deliveryGatedApprovalTransport,
        })
      : deliveryGatedApprovalTransport;
  approvalService = new AionUiApprovalAuthorityService(
    activePersistence,
    approvalTransport,
  );
}

function startApprovalRecovery(): void {
  if (
    !approvalAuthorityEnabled ||
    approvalRecoveryStarted ||
    approvalService === null
  ) {
    return;
  }
  approvalRecoveryStarted = true;
  void approvalService
    .recoverPending()
    .then((summary) => {
      if (summary.attempted > 0) {
        console.info(
          \`[Actestra approval] Recovery attempted=\${summary.attempted} delivered=\${summary.delivered} pending=\${summary.pending}\`,
        );
      }
    })
    .catch(() => {
      console.warn('[Actestra approval] Pending delivery recovery unavailable');
    });
}

export async function initializeActestraPersistenceUtility(
  userDataPath: string,
): Promise<void> {
  if (persistence !== null) {
    return;
  }

  let launchedPersistence: ActestraPersistencePort | null = null;
  try {
    const utility = await launchElectronPersistenceUtility({
      modulePath: path.join(__dirname, 'actestra-persistence-utility.js'),
      userDataPath,
      workingDirectory: process.resourcesPath,
    });
    launchedPersistence = utility;
    configurePersistenceServices(utility);
    console.info(
      \`[Actestra persistence] Utility ready schema=\${utility.schemaVersion}\`,
    );
  } catch {
    await launchedPersistence?.close().catch((): undefined => undefined);
    persistence = null;
    projectionService = null;
    approvalService = null;
    console.warn('[Actestra shadow] Persistence utility unavailable at startup');
    console.warn('[Actestra approval] Authority unavailable at startup');
  }
}

export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {
  currentWindow = window;
  if (!handlerRegistered) {
    ipcMain.handle(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observe);
    handlerRegistered = true;
  }
  if (!approvalHandlerRegistered) {
    ipcMain.handle(ACTESTRA_APPROVAL_DECIDE_CHANNEL, resolveApproval);
    approvalHandlerRegistered = true;
  }
  // Recovery needs the native backend and original window lifecycle. Utility
  // readiness alone is intentionally too early for loopback reconciliation.
  startApprovalRecovery();
}

`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  approvalService = null;
  if (activePersistence !== null) {`,
  `  approvalService = null;
  approvalRecoveryStarted = false;
  if (activePersistence !== null) {`,
);

for (const relativePath of [
  "tests/unit/actestra/approvalAuthorityPersistence.test.ts",
  "tests/unit/actestra/approvalAuthorityService.test.ts",
  "tests/unit/actestra/approvalPolicyGate.test.ts",
  "tests/unit/actestra/approvalReconciliationPolicyGate.test.ts",
  "tests/unit/actestra/shadowPersistence.test.ts",
]) {
  replaceOnce(
    relativePath,
    "@/actestra/main/persistence/sqliteCorePersistence",
    "@/actestra/utility/persistence/sqliteCorePersistence",
  );
}

writeNew(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectAionUiHttpObservations,
  normalizeAionUiApprovalDecisionRequest,
  projectAionUiObservation,
} from '@/actestra/compatibility/aionui';
import {
  PersistenceUtilityClient,
  type PersistenceUtilityTransport,
} from '@/actestra/main/persistence/persistenceUtilityClient';
import { PersistenceUtilityService } from '@/actestra/utility/persistence/persistenceUtilityService';

type MessageListener = (message: unknown) => void;
type ErrorListener = () => void;
type ExitListener = (code: number) => void;

class LoopbackTransport implements PersistenceUtilityTransport {
  private readonly messages = new Set<MessageListener>();
  private readonly errors = new Set<ErrorListener>();
  private readonly exits = new Set<ExitListener>();
  private readonly service = new PersistenceUtilityService();
  private exited = false;

  postMessage(message: unknown): void {
    queueMicrotask(() => {
      void this.service.handle(message).then((response) => {
        if (!this.exited) {
          this.messages.forEach((listener) => listener(response));
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
    if (this.exited) {
      return false;
    }
    this.exited = true;
    void this.service.shutdown().finally(() => {
      this.exits.forEach((listener) => listener(0));
    });
    return true;
  }

  start(): void {
    queueMicrotask(() => {
      this.messages.forEach((listener) =>
        listener({
          protocolVersion: 1,
          type: 'ready',
          role: 'persistence',
        }),
      );
    });
  }
}

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(path.join(os.tmpdir(), 'actestra-native-utility-'))) {
      throw new Error(\`Refusing to remove unexpected test directory: \${directory}\`);
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Actestra persistence utility client', () => {
  it('keeps AionUI shadow and approval authority behind schema v6 utility IPC', async () => {
    const userDataPath = fs.mkdtempSync(
      path.join(os.tmpdir(), 'actestra-native-utility-'),
    );
    directories.push(userDataPath);
    const transport = new LoopbackTransport();
    const connecting = PersistenceUtilityClient.connect(transport, userDataPath);
    transport.start();
    const client = await connecting;
    expect(client.schemaVersion).toBe(6);

    const [observation] = collectAionUiHttpObservations({
      method: 'GET',
      path: '/api/providers',
      observedAtMs: Date.parse('2026-07-29T03:00:00.000Z'),
      response: [{ id: 'provider-utility', enabled: true }],
    });
    const evidence = projectAionUiObservation(observation);
    await expect(client.appendAionUiShadowEvidence(evidence)).resolves.toEqual({
      status: 'appended',
      sequence: 1,
    });

    const decision = normalizeAionUiApprovalDecisionRequest({
      contractVersion: 1,
      method: 'POST',
      path:
        '/api/conversations/conversation-utility/confirmations/call-utility/confirm',
      body: {
        msg_id: 'message-utility',
        data: { value: 'proceed_once' },
      },
    });
    await client.reserveAionUiApprovalDecision(
      decision,
      '2026-07-29T05:00:00.000Z',
    );
    await expect(client.summarizeAionUiShadowEvidence()).resolves.toEqual({
      recordCount: 1,
      lastSequence: 1,
    });
    await expect(client.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 1,
      deliveredCount: 0,
    });
    await client.close();
  });
});
`,
);
