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
  "packages/desktop/src/common/config/actestraApprovalAuthorityContract.ts",
  `/**
 * Fixed F3 desktop main-frame channel for native confirmation decisions.
 *
 * The renderer can submit only one exact confirmation-route envelope. Main
 * persists the immutable decision before delivering it to the local runtime.
 */

export const ACTESTRA_APPROVAL_DECIDE_CHANNEL =
  'actestra:approval-decide-v1';

export type ActestraApprovalDecisionRequest = {
  readonly contractVersion: 1;
  readonly method: 'POST';
  readonly path: string;
  readonly body: {
    readonly msg_id: string;
    readonly data: unknown;
    readonly always_allow?: boolean;
  };
};

export type ActestraApprovalDecisionResult =
  | {
      readonly status: 'delivered';
      readonly decisionId: string;
      readonly disposition: 'new' | 'duplicate' | 'reconciled';
      readonly attemptCount: number;
    }
  | {
      readonly status: 'rejected';
      readonly httpStatus: number;
      readonly body: {
        readonly success: false;
        readonly error: string;
        readonly code: string;
        readonly details?: unknown;
      };
    }
  | {
      readonly status: 'native-fallback';
    };

export interface ActestraApprovalAuthorityApi {
  decide(
    request: ActestraApprovalDecisionRequest,
  ): Promise<ActestraApprovalDecisionResult>;
}

declare global {
  interface Window {
    actestraApprovalAuthority?: ActestraApprovalAuthorityApi;
  }
}
`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraApprovalAuthorityClient.ts",
  `import type {
  ActestraApprovalDecisionRequest,
  ActestraApprovalDecisionResult,
} from '@/common/config/actestraApprovalAuthorityContract';

export type ActestraApprovalRouteResult =
  | {
      readonly handled: false;
    }
  | {
      readonly handled: true;
      readonly result: ActestraApprovalDecisionResult;
    };

const CONFIRMATION_ROUTE =
  /^\\/api\\/conversations\\/[^/?#]+\\/confirmations\\/[^/?#]+\\/confirm$/u;

const unavailable = (): ActestraApprovalDecisionResult => ({
  status: 'rejected',
  httpStatus: 503,
  body: {
    success: false,
    error: 'Actestra approval authority is unavailable.',
    code: 'ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE',
  },
});

function validResult(value: unknown): value is ActestraApprovalDecisionResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.status === 'native-fallback') {
    return true;
  }
  if (result.status === 'delivered') {
    return (
      typeof result.decisionId === 'string' &&
      /^actestra-approval-decision-[a-f0-9]{32}$/u.test(result.decisionId) &&
      (result.disposition === 'new' ||
        result.disposition === 'duplicate' ||
        result.disposition === 'reconciled') &&
      Number.isSafeInteger(result.attemptCount) &&
      (result.attemptCount as number) > 0
    );
  }
  if (
    result.status !== 'rejected' ||
    !Number.isSafeInteger(result.httpStatus) ||
    (result.httpStatus as number) < 400 ||
    (result.httpStatus as number) > 599 ||
    typeof result.body !== 'object' ||
    result.body === null ||
    Array.isArray(result.body)
  ) {
    return false;
  }
  const body = result.body as Record<string, unknown>;
  return body.success === false && typeof body.error === 'string' && typeof body.code === 'string';
}

export async function routeActestraApprovalRequest(input: {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}): Promise<ActestraApprovalRouteResult> {
  if (input.method !== 'POST' || !CONFIRMATION_ROUTE.test(input.path)) {
    return { handled: false };
  }

  // Headless WebUI has no preload or desktop main-frame trust boundary. F3
  // keeps that separately isolated path on its native compatibility behavior.
  if (
    typeof window === 'undefined' ||
    window.__backendPort === undefined ||
    window.__backendPort < 1
  ) {
    return { handled: false };
  }
  const bridge = window.actestraApprovalAuthority;
  if (bridge === undefined) {
    return {
      handled: true,
      result: unavailable(),
    };
  }

  const request: ActestraApprovalDecisionRequest = {
    contractVersion: 1,
    method: 'POST',
    path: input.path,
    body: input.body as ActestraApprovalDecisionRequest['body'],
  };
  try {
    const result: unknown = await bridge.decide(request);
    return {
      handled: true,
      result: validResult(result) ? result : unavailable(),
    };
  } catch {
    return {
      handled: true,
      result: unavailable(),
    };
  }
}
`,
);

writeNew(
  "packages/desktop/src/process/services/actestraApprovalNativeTransport.ts",
  `import type { AionUiApprovalDecisionRecord } from '@/actestra/compatibility/aionui';
import {
  AionUiApprovalNativeTransportError,
  type AionUiApprovalNativeTransport,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';
import { assertActestraBridgeRequestAllowed } from '@/common/config/actestraProduct';

const NATIVE_REQUEST_TIMEOUT_MS = 10_000;
const MAX_NATIVE_RESPONSE_BYTES = 65_536;

function backendPort(): number {
  const value = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new Error('Actestra approval delivery requires a ready loopback runtime');
  }
  return value as number;
}

async function responseBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    total += result.value.byteLength;
    if (total > MAX_NATIVE_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The bounded response is already rejected; cancellation is best effort.
      }
      throw new AionUiApprovalNativeTransportError(502, {
        success: false,
        error: 'Native approval response exceeded the size limit.',
        code: 'ACTESTRA_APPROVAL_NATIVE_RESPONSE_TOO_LARGE',
      });
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 1_024);
  }
}

async function nativeRequest(
  method: 'GET' | 'POST',
  requestPath: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  assertActestraBridgeRequestAllowed(requestPath, body);
  const response = await fetch(
    \`http://127.0.0.1:\${backendPort()}\${requestPath}\`,
    {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal:
        signal === undefined
          ? AbortSignal.timeout(NATIVE_REQUEST_TIMEOUT_MS)
          : AbortSignal.any([
              signal,
              AbortSignal.timeout(NATIVE_REQUEST_TIMEOUT_MS),
            ]),
    },
  );
  const parsed = await responseBody(response);
  if (!response.ok) {
    throw new AionUiApprovalNativeTransportError(response.status, parsed);
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    'data' in parsed
  ) {
    return (parsed as { data: unknown }).data;
  }
  return parsed;
}

function pendingIdentity(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.call_id === 'string') {
    return record.call_id;
  }
  return typeof record.id === 'string' ? record.id : undefined;
}

export class LoopbackAionUiApprovalNativeTransport
  implements AionUiApprovalNativeTransport
{
  async isPending(
    record: AionUiApprovalDecisionRecord,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const result = await nativeRequest(
      'GET',
      \`/api/conversations/\${encodeURIComponent(record.nativeConversationId)}/confirmations\`,
      undefined,
      signal,
    );
    if (!Array.isArray(result)) {
      throw new Error('Native confirmation list returned an invalid response');
    }
    return result.some((entry) => pendingIdentity(entry) === record.nativeCallId);
  }

  async deliver(
    record: AionUiApprovalDecisionRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    await nativeRequest('POST', record.nativePath, record.deliveryBody, signal);
  }
}
`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import { AionUiShadowProjectionService } from '@/actestra/main/compatibility/aionuiShadowProjectionService';`,
  `import { AionUiShadowProjectionService } from '@/actestra/main/compatibility/aionuiShadowProjectionService';
import {
  AionUiApprovalAuthorityService,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '@/common/config/actestraShadowContract';`,
  `import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '@/common/config/actestraShadowContract';
import {
  ACTESTRA_APPROVAL_DECIDE_CHANNEL,
  type ActestraApprovalDecisionRequest,
  type ActestraApprovalDecisionResult,
} from '@/common/config/actestraApprovalAuthorityContract';
import { LoopbackAionUiApprovalNativeTransport } from './actestraApprovalNativeTransport';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `let projectionService: AionUiShadowProjectionService | null = null;
let handlerRegistered = false;`,
  `let projectionService: AionUiShadowProjectionService | null = null;
let approvalService: AionUiApprovalAuthorityService | null = null;
let handlerRegistered = false;
let approvalHandlerRegistered = false;

const approvalAuthorityEnabled =
  process.env.ACTESTRA_APPROVAL_AUTHORITY !== '0';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `async function observe(
  event: IpcMainInvokeEvent,
  observation: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiShadowObservationResult> {`,
  `const approvalUnavailable = (): ActestraApprovalDecisionResult => ({
  status: 'rejected',
  httpStatus: 503,
  body: {
    success: false,
    error: 'Actestra approval authority is unavailable.',
    code: 'ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE',
  },
});

const nativeFallback = (): ActestraApprovalDecisionResult => ({
  status: 'native-fallback',
});

async function resolveApproval(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<ActestraApprovalDecisionResult> {
  if (
    extraArguments.length !== 0 ||
    currentWindow === null ||
    currentWindow.isDestroyed() ||
    event.sender !== currentWindow.webContents ||
    event.senderFrame !== currentWindow.webContents.mainFrame
  ) {
    return approvalUnavailable();
  }
  if (!approvalAuthorityEnabled) {
    return nativeFallback();
  }
  const service = approvalService;
  if (service === null) {
    return approvalUnavailable();
  }
  try {
    return await service.resolve(request);
  } catch {
    return approvalUnavailable();
  }
}

export async function resolveActestraApprovalDecisionFromMain(
  request: ActestraApprovalDecisionRequest,
): Promise<ActestraApprovalDecisionResult> {
  if (!approvalAuthorityEnabled) {
    return nativeFallback();
  }
  const service = approvalService;
  if (service === null) {
    return approvalUnavailable();
  }
  try {
    return await service.resolve(request);
  } catch {
    return approvalUnavailable();
  }
}

async function observe(
  event: IpcMainInvokeEvent,
  observation: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiShadowObservationResult> {`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  if (!handlerRegistered) {
    ipcMain.handle(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observe);
    handlerRegistered = true;
  }
  if (projectionService !== null) {`,
  `  if (!handlerRegistered) {
    ipcMain.handle(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observe);
    handlerRegistered = true;
  }
  if (!approvalHandlerRegistered) {
    ipcMain.handle(ACTESTRA_APPROVAL_DECIDE_CHANNEL, resolveApproval);
    approvalHandlerRegistered = true;
  }
  if (projectionService !== null && approvalService !== null) {`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    persistence = openSqliteCorePersistence(userDataPath);
    projectionService = new AionUiShadowProjectionService(persistence);
  } catch {`,
  `    persistence = openSqliteCorePersistence(userDataPath);
    projectionService = new AionUiShadowProjectionService(persistence);
    approvalService = new AionUiApprovalAuthorityService(
      persistence,
      new LoopbackAionUiApprovalNativeTransport(),
    );
    if (approvalAuthorityEnabled) {
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
  } catch {`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    persistence = null;
    projectionService = null;
    console.warn('[Actestra shadow] Persistence unavailable at startup');`,
  `    persistence = null;
    projectionService = null;
    approvalService = null;
    console.warn('[Actestra shadow] Persistence unavailable at startup');
    console.warn('[Actestra approval] Authority unavailable at startup');`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  persistence = null;
  projectionService = null;
  if (activePersistence !== null) {`,
  `  persistence = null;
  projectionService = null;
  approvalService = null;
  if (activePersistence !== null) {`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '../common/config/actestraShadowContract';`,
  `import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '../common/config/actestraShadowContract';
import {
  ACTESTRA_APPROVAL_DECIDE_CHANNEL,
  type ActestraApprovalDecisionRequest,
} from '../common/config/actestraApprovalAuthorityContract';`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `contextBridge.exposeInMainWorld('actestraShadow', {
  observe: (observation: unknown) =>
    ipcRenderer.invoke(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observation),
});

contextBridge.exposeInMainWorld('electronAPI', {`,
  `contextBridge.exposeInMainWorld('actestraShadow', {
  observe: (observation: unknown) =>
    ipcRenderer.invoke(ACTESTRA_SHADOW_OBSERVE_CHANNEL, observation),
});

contextBridge.exposeInMainWorld('actestraApprovalAuthority', {
  decide: (request: ActestraApprovalDecisionRequest) =>
    ipcRenderer.invoke(ACTESTRA_APPROVAL_DECIDE_CHANNEL, request),
});

contextBridge.exposeInMainWorld('electronAPI', {`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `import {
  publishActestraHttpObservation,
  publishActestraWebSocketObservation,
} from './actestraShadowPublisher';`,
  `import {
  publishActestraHttpObservation,
  publishActestraWebSocketObservation,
} from './actestraShadowPublisher';
import { routeActestraApprovalRequest } from './actestraApprovalAuthorityClient';`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  console.debug(
    \`[httpBridge] \${method} \${path}\`,
    body !== undefined ? JSON.stringify(redactForLog(body)).slice(0, 500) : '(no body)'
  );

  const response = await fetch(url, {`,
  `  console.debug(
    \`[httpBridge] \${method} \${path}\`,
    body !== undefined ? JSON.stringify(redactForLog(body)).slice(0, 500) : '(no body)'
  );

  const approvalRoute = await routeActestraApprovalRequest({ method, path, body });
  if (approvalRoute.handled && approvalRoute.result.status !== 'native-fallback') {
    if (approvalRoute.result.status === 'rejected') {
      throw new BackendHttpError({
        method,
        path,
        status: approvalRoute.result.httpStatus,
        body: approvalRoute.result.body,
      });
    }
    return undefined as T;
  }

  const response = await fetch(url, {`,
);

replaceOnce(
  "packages/desktop/src/process/pet/petConfirmManager.ts",
  `import { getCachedTheme, onThemeChanged } from '@process/bridge/themeBridge';`,
  `import { getCachedTheme, onThemeChanged } from '@process/bridge/themeBridge';
import { resolveActestraApprovalDecisionFromMain } from '@process/services/actestraShadowBridge';`,
);

writeNew(
  "tests/unit/actestra/approvalAuthorityPersistence.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeAionUiApprovalDecisionRequest } from '@/actestra/compatibility/aionui';
import { openSqliteCorePersistence } from '@/actestra/main/persistence/sqliteCorePersistence';

const directories: string[] = [];
const createdAt = '2026-07-29T05:00:00.000Z';

function directory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-downstream-approval-'));
  directories.push(value);
  return value;
}

function decision(value = 'proceed_once') {
  return normalizeAionUiApprovalDecisionRequest({
    contractVersion: 1,
    method: 'POST',
    path: '/api/conversations/conversation-private/confirmations/call-private/confirm',
    body: {
      msg_id: 'message-private',
      data: { value },
    },
  });
}

afterEach(() => {
  for (const value of directories.splice(0)) {
    if (!value.startsWith(path.join(os.tmpdir(), 'actestra-downstream-approval-'))) {
      throw new Error(\`Refusing unexpected cleanup path: \${value}\`);
    }
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe('Actestra F3 downstream approval persistence', () => {
  it('survives restart with one immutable pending decision', async () => {
    const userDataPath = directory();
    const normalized = decision();
    const first = openSqliteCorePersistence(userDataPath);
    await first.reserveAionUiApprovalDecision(normalized, createdAt);
    await first.beginAionUiApprovalDelivery(
      normalized.decisionId,
      '2026-07-29T05:00:01.000Z',
    );
    await first.markAionUiApprovalDeliveryFailed(
      normalized.decisionId,
      'native-http-503',
      '2026-07-29T05:00:02.000Z',
    );
    await first.close();

    const reopened = openSqliteCorePersistence(userDataPath);
    await expect(reopened.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 1,
      deliveredCount: 0,
    });
    await expect(reopened.listPendingAionUiApprovalDecisions(10)).resolves.toMatchObject([
      {
        decisionId: normalized.decisionId,
        deliveryState: 'pending-delivery',
        attemptCount: 1,
        lastErrorCode: 'native-http-503',
      },
    ]);
    await reopened.close();
  });

  it('rejects a changed decision for the same native call', async () => {
    const persistence = openSqliteCorePersistence(directory());
    await persistence.reserveAionUiApprovalDecision(decision(), createdAt);
    await expect(
      persistence.reserveAionUiApprovalDecision(
        decision('deny'),
        '2026-07-29T05:00:01.000Z',
      ),
    ).rejects.toMatchObject({ code: 'evidence-conflict' });
    await persistence.close();
  });
});
`,
);

writeNew(
  "tests/unit/actestra/approvalAuthorityService.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AionUiApprovalDecisionRecord } from '@/actestra/compatibility/aionui';
import {
  AionUiApprovalAuthorityService,
  AionUiApprovalNativeTransportError,
  type AionUiApprovalAuthorityClock,
} from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';
import { openSqliteCorePersistence } from '@/actestra/main/persistence/sqliteCorePersistence';

const directories: string[] = [];

function directory(): string {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-downstream-service-'));
  directories.push(value);
  return value;
}

function request(value = 'proceed_once') {
  return {
    contractVersion: 1,
    method: 'POST',
    path: '/api/conversations/conversation-private/confirmations/call-private/confirm',
    body: {
      msg_id: 'message-private',
      data: { value },
    },
  } as const;
}

function clock(): AionUiApprovalAuthorityClock {
  let value = Date.parse('2026-07-29T05:00:00.000Z');
  return {
    now: () => {
      const now = new Date(value).toISOString();
      value += 1_000;
      return now;
    },
  };
}

afterEach(() => {
  for (const value of directories.splice(0)) {
    if (!value.startsWith(path.join(os.tmpdir(), 'actestra-downstream-service-'))) {
      throw new Error(\`Refusing unexpected cleanup path: \${value}\`);
    }
    fs.rmSync(value, { recursive: true, force: true });
  }
});

describe('Actestra F3 downstream approval service', () => {
  it('serializes concurrent renderer decisions and delivers exactly once', async () => {
    const persistence = openSqliteCorePersistence(directory());
    const transport = {
      isPending: vi.fn(async () => true),
      deliver: vi.fn(async () => undefined),
    };
    const service = new AionUiApprovalAuthorityService(
      persistence,
      transport,
      clock(),
    );
    const results = await Promise.all([service.resolve(request()), service.resolve(request())]);
    expect(results).toMatchObject([
      { status: 'delivered', disposition: 'new', attemptCount: 1 },
      { status: 'delivered', disposition: 'duplicate', attemptCount: 1 },
    ]);
    expect(transport.deliver).toHaveBeenCalledTimes(1);
    await persistence.close();
  });

  it('maps the native error and safely retries the durable pending decision', async () => {
    const persistence = openSqliteCorePersistence(directory());
    const deliver = vi
      .fn<(record: AionUiApprovalDecisionRecord) => Promise<void>>()
      .mockRejectedValueOnce(
        new AionUiApprovalNativeTransportError(409, {
          success: false,
          error: 'Native confirmation is busy',
          code: 'CONFIRMATION_BUSY',
        }),
      )
      .mockResolvedValueOnce(undefined);
    const transport = {
      isPending: vi.fn(async () => true),
      deliver,
    };
    const service = new AionUiApprovalAuthorityService(
      persistence,
      transport,
      clock(),
    );
    await expect(service.resolve(request())).resolves.toEqual({
      status: 'rejected',
      httpStatus: 409,
      body: {
        success: false,
        error: 'Native confirmation is busy',
        code: 'CONFIRMATION_BUSY',
      },
    });
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: 'delivered',
      attemptCount: 2,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    await persistence.close();
  });

  it('reconciles uncertain native acceptance without duplicate delivery', async () => {
    const persistence = openSqliteCorePersistence(directory());
    const normalized = (
      await import('@/actestra/compatibility/aionui')
    ).normalizeAionUiApprovalDecisionRequest(request());
    await persistence.reserveAionUiApprovalDecision(
      normalized,
      '2026-07-29T05:00:00.000Z',
    );
    await persistence.beginAionUiApprovalDelivery(
      normalized.decisionId,
      '2026-07-29T05:00:01.000Z',
    );
    const transport = {
      isPending: vi.fn(async () => false),
      deliver: vi.fn(async () => undefined),
    };
    const service = new AionUiApprovalAuthorityService(
      persistence,
      transport,
      clock(),
    );
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: 'delivered',
      disposition: 'reconciled',
      attemptCount: 1,
    });
    expect(transport.deliver).not.toHaveBeenCalled();
    await persistence.close();
  });

  it('bounds a native transport and blocks redelivery while it remains in flight', async () => {
    const persistence = openSqliteCorePersistence(directory());
    let settleDelivery: (() => void) | undefined;
    const delivery = new Promise<void>((resolve) => {
      settleDelivery = resolve;
    });
    let observedSignal: AbortSignal | undefined;
    const transport = {
      isPending: vi.fn(async () => false),
      deliver: vi.fn(
        (_record: AionUiApprovalDecisionRecord, signal: AbortSignal) => {
          observedSignal = signal;
          return delivery;
        },
      ),
    };
    const service = new AionUiApprovalAuthorityService(
      persistence,
      transport,
      clock(),
      5,
    );
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: 'rejected',
      httpStatus: 503,
      body: {
        code: 'ACTESTRA_APPROVAL_DELIVERY_UNAVAILABLE',
      },
    });
    expect(observedSignal?.aborted).toBe(true);
    await expect(persistence.summarizeAionUiApprovalAuthority()).resolves.toEqual({
      recordCount: 1,
      pendingCount: 1,
      deliveredCount: 0,
    });
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: 'rejected',
      httpStatus: 503,
    });
    expect(transport.deliver).toHaveBeenCalledTimes(1);
    expect(transport.isPending).not.toHaveBeenCalled();

    settleDelivery?.();
    await delivery;
    await expect(service.resolve(request())).resolves.toMatchObject({
      status: 'delivered',
      disposition: 'reconciled',
      attemptCount: 1,
    });
    expect(transport.deliver).toHaveBeenCalledTimes(1);
    expect(transport.isPending).toHaveBeenCalledTimes(1);
    await persistence.close();
  });
});
`,
);

writeNew(
  "tests/unit/actestra/approvalAuthorityClient.dom.test.ts",
  `import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeActestraApprovalRequest } from '@/common/adapter/actestraApprovalAuthorityClient';

const nativeRequest = {
  method: 'POST',
  path: '/api/conversations/conversation-1/confirmations/call-1/confirm',
  body: {
    msg_id: 'message-1',
    data: { value: 'proceed_once' },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.actestraApprovalAuthority;
  window.__backendPort = undefined;
});

describe('Actestra F3 approval renderer routing', () => {
  it('leaves unrelated native routes unchanged', async () => {
    await expect(
      routeActestraApprovalRequest({
        method: 'GET',
        path: '/api/conversations',
        body: undefined,
      }),
    ).resolves.toEqual({ handled: false });
  });

  it('routes the exact desktop confirmation path through the fixed preload API', async () => {
    window.__backendPort = 55153;
    window.actestraApprovalAuthority = {
      decide: vi.fn(async () => ({
        status: 'delivered',
        decisionId: 'actestra-approval-decision-0123456789abcdef0123456789abcdef',
        disposition: 'new',
        attemptCount: 1,
      })),
    };
    await expect(routeActestraApprovalRequest(nativeRequest)).resolves.toMatchObject({
      handled: true,
      result: {
        status: 'delivered',
      },
    });
    expect(window.actestraApprovalAuthority.decide).toHaveBeenCalledWith({
      contractVersion: 1,
      ...nativeRequest,
    });
  });

  it('fails closed when the desktop preload authority is absent', async () => {
    window.__backendPort = 55153;
    await expect(routeActestraApprovalRequest(nativeRequest)).resolves.toEqual({
      handled: true,
      result: {
        status: 'rejected',
        httpStatus: 503,
        body: {
          success: false,
          error: 'Actestra approval authority is unavailable.',
          code: 'ACTESTRA_APPROVAL_AUTHORITY_UNAVAILABLE',
        },
      },
    });
  });

  it('honors only the explicit main-owned native fallback result', async () => {
    window.__backendPort = 55153;
    window.actestraApprovalAuthority = {
      decide: vi.fn(async () => ({ status: 'native-fallback' })),
    };
    await expect(routeActestraApprovalRequest(nativeRequest)).resolves.toEqual({
      handled: true,
      result: {
        status: 'native-fallback',
      },
    });
  });
});
`,
);

writeNew(
  "tests/unit/actestra/approvalNativeTransport.test.ts",
  `// @vitest-environment node

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  normalizeAionUiApprovalDecisionRequest,
  type AionUiApprovalDecisionRecord,
} from '@/actestra/compatibility/aionui';
import { AionUiApprovalNativeTransportError } from '@/actestra/main/compatibility/aionuiApprovalAuthorityService';
import { LoopbackAionUiApprovalNativeTransport } from '@/process/services/actestraApprovalNativeTransport';

const servers: http.Server[] = [];

function record(): AionUiApprovalDecisionRecord {
  const normalized = normalizeAionUiApprovalDecisionRequest({
    contractVersion: 1,
    method: 'POST',
    path: '/api/conversations/conversation-1/confirmations/call-1/confirm',
    body: {
      msg_id: 'message-1',
      data: { value: 'proceed_once' },
    },
  });
  return {
    ...normalized,
    deliveryState: 'pending-delivery',
    attemptCount: 1,
    createdAt: '2026-07-29T05:00:00.000Z',
    updatedAt: '2026-07-29T05:00:01.000Z',
    lastAttemptAt: '2026-07-29T05:00:01.000Z',
  };
}

async function listen(
  handler: http.RequestListener,
): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral loopback port');
  }
  (
    globalThis as typeof globalThis & { __backendPort?: number }
  ).__backendPort = address.port;
  return address.port;
}

afterEach(async () => {
  delete (
    globalThis as typeof globalThis & { __backendPort?: number }
  ).__backendPort;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Actestra F3 loopback approval transport', () => {
  it('checks pending identity and delivers the exact bounded body', async () => {
    let pending = true;
    let deliveredBody = '';
    await listen((request, response) => {
      if (request.method === 'GET') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ data: pending ? [{ call_id: 'call-1' }] : [] }));
        return;
      }
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        deliveredBody += chunk;
      });
      request.on('end', () => {
        pending = false;
        response.statusCode = 204;
        response.end();
      });
    });
    const transport = new LoopbackAionUiApprovalNativeTransport();
    const authorityRecord = record();
    await expect(transport.isPending(authorityRecord)).resolves.toBe(true);
    await expect(transport.deliver(authorityRecord)).resolves.toBeUndefined();
    await expect(transport.isPending(authorityRecord)).resolves.toBe(false);
    expect(JSON.parse(deliveredBody)).toEqual(authorityRecord.deliveryBody);
  });

  it('preserves native HTTP status and structured error body', async () => {
    await listen((_request, response) => {
      response.statusCode = 409;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          success: false,
          error: 'Confirmation conflict',
          code: 'CONFIRMATION_CONFLICT',
        }),
      );
    });
    const transport = new LoopbackAionUiApprovalNativeTransport();
    try {
      await transport.deliver(record());
    } catch (error) {
      expect(error).toBeInstanceOf(AionUiApprovalNativeTransportError);
      expect(error).toMatchObject({
        httpStatus: 409,
        body: {
          success: false,
          error: 'Confirmation conflict',
          code: 'CONFIRMATION_CONFLICT',
        },
      });
      return;
    }
    throw new Error('Expected native transport error');
  });

  it('rejects an oversized successful native response', async () => {
    await listen((_request, response) => {
      response.statusCode = 200;
      response.end('x'.repeat(65_537));
    });
    const transport = new LoopbackAionUiApprovalNativeTransport();
    await expect(transport.deliver(record())).rejects.toMatchObject({
      httpStatus: 502,
      body: {
        success: false,
        code: 'ACTESTRA_APPROVAL_NATIVE_RESPONSE_TOO_LARGE',
      },
    });
  });
});
`,
);

replaceOnce(
  "packages/desktop/src/process/pet/petConfirmManager.ts",
  `      // Forward response to backend via HTTP (aionui-conversation route)
      ipcBridge.conversation.confirmation.confirm
        .invoke({
          conversation_id: data.conversation_id,
          msg_id: data.msg_id,
          call_id: data.call_id,
          data: data.data,
        })
        .catch((error: unknown) => {
          console.error('[PetConfirm] confirmation.confirm.invoke failed:', error);
        });`,
  `      // Route the pet decision through the same main-owned durable authority
      // as the preserved renderer permission card.
      void resolveActestraApprovalDecisionFromMain({
        contractVersion: 1,
        method: 'POST',
        path:
          \`/api/conversations/\${encodeURIComponent(data.conversation_id)}/confirmations/\${encodeURIComponent(data.call_id)}/confirm\`,
        body: {
          msg_id: data.msg_id,
          data: data.data,
        },
      }).then((result) => {
        if (result.status === 'native-fallback') {
          return ipcBridge.conversation.confirmation.confirm
            .invoke({
              conversation_id: data.conversation_id,
              msg_id: data.msg_id,
              call_id: data.call_id,
              data: data.data,
            })
            .catch((error: unknown) => {
              console.error('[PetConfirm] native fallback failed:', error);
            });
        }
        if (result.status === 'rejected') {
          console.error(
            '[PetConfirm] approval authority rejected response:',
            result.body.code,
          );
        }
        return undefined;
      }).catch(() => {
        console.error('[PetConfirm] approval authority unavailable');
      });`,
);
