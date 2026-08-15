import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  inspectSourceFilesForPrivilegePatterns,
  rendererPrivilegePatterns,
  // @ts-ignore The boundary rules are an executable .mjs checker without a declaration file.
} from "../../scripts/product-boundary-rules.mjs";
// @ts-ignore The materializer is an executable .mjs fixture bootstrap without a declaration file.
import { materializeAionUiDownstream } from "../../scripts/materialize-aionui-downstream.mjs";
import {
  APP_INFO_CHANNEL,
  type AppInfo,
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  type PlatformSnapshot,
} from "../../apps/desktop/src/shared/contracts";
import {
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  correlationId,
  instant,
  toDiagnosticEvent,
  type AgentAttemptEvidence,
} from "../../apps/desktop/src/core";
import {
  registerDesktopIpc,
  type DesktopIpcEvent,
  type DesktopIpcMain,
} from "../../apps/desktop/src/main/ipc/desktopIpc";
import { createGooseRunnerEnvironment } from "../../apps/desktop/src/main/workers/gooseRunnerProcess";
import {
  installSessionSecurity,
  isAllowedDevelopmentUrl,
} from "../../apps/desktop/src/main/security";
import { installWebviewGuestSecurity } from "../../apps/desktop/src/main/security/p7SecuritySmoke";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  FIXTURE_SESSION_ID,
  FIXTURE_STREAM_ID,
  FIXTURE_TASK_ID,
  FIXTURE_WORKER_ID,
  FIXTURE_WORKSPACE_ID,
  createEvent,
} from "../fixtures/core";

type IpcHandler = (event: DesktopIpcEvent, ...args: unknown[]) => unknown;

class FakeIpcMain implements DesktopIpcMain {
  readonly handlers = new Map<string, IpcHandler>();
  readonly listeners = new Map<string, Set<IpcHandler>>();

  handle(channel: string, listener: IpcHandler): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  on(channel: string, listener: IpcHandler): this {
    const listeners = this.listeners.get(channel) ?? new Set<IpcHandler>();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
    return this;
  }

  removeListener(channel: string, listener: IpcHandler): this {
    this.listeners.get(channel)?.delete(listener);
    return this;
  }

  invoke(channel: string, event: DesktopIpcEvent, ...args: unknown[]): unknown {
    const handler = this.handlers.get(channel);
    if (handler === undefined) throw new Error(`missing handler ${channel}`);
    return handler(event, ...args);
  }
}

const APP_INFO: AppInfo = {
  name: "Actestra",
  version: "0.1.0-alpha.0",
  dataLayoutVersion: 1,
  platform: "darwin",
  arch: "arm64",
  environment: "development",
  networkPolicy: "offline-shell",
};

const PLATFORM_SNAPSHOT: PlatformSnapshot = {
  contractVersion: PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  authority: "main-only",
  privilegedServices: "scoped-native-active",
  policy: "deny-by-default",
  credentials: "opaque-references-only",
  tools: "workspace-read-task-output-create",
  audit: { durability: "sqlite-metadata-only", recordCount: 0, lastSequence: 0 },
  attempts: [],
};

type PrivilegeRule = Readonly<{ label: string; pattern: RegExp }>;
type PrivilegeFinding = Readonly<{ relativePath: string; label: string }>;

function scanFixtures(
  rules: readonly PrivilegeRule[],
  sources: readonly string[],
): PrivilegeFinding[] {
  const root = mkdtempSync(join(tmpdir(), "actestra-p7-renderer-"));
  try {
    const relativePaths = sources.map((source, index) => {
      const relativePath = `fixture-${index}.tsx`;
      writeFileSync(join(root, relativePath), source);
      return relativePath;
    });
    return inspectSourceFilesForPrivilegePatterns({
      rootPath: root,
      relativePaths,
      rules,
    }) as PrivilegeFinding[];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const STATIC_FIXTURE_EFFECT = "__actestraP7StaticFixtureExecuted";

function expectStaticFixtureRejected(
  source: string,
  expectedLabels: readonly string[],
  rules: readonly PrivilegeRule[] = rendererPrivilegePatterns,
): void {
  const target = globalThis as Record<string, unknown>;
  delete target[STATIC_FIXTURE_EFFECT];
  const findings = scanFixtures(rules, [source]);
  expect(findings).toEqual(
    expectedLabels.map((label) => ({ relativePath: "fixture-0.tsx", label })),
  );
  expect(Object.hasOwn(target, STATIC_FIXTURE_EFFECT)).toBe(false);
}

type DesktopIpcHarness = Readonly<{
  ipcMain: FakeIpcMain;
  trusted: Readonly<{ mainFrame: unknown }>;
  mainFrame: unknown;
  effects: Readonly<{
    appInfo: ReturnType<typeof vi.fn>;
    platformSnapshot: ReturnType<typeof vi.fn>;
    rendererReady: ReturnType<typeof vi.fn>;
    persistence: ReturnType<typeof vi.fn>;
    provider: ReturnType<typeof vi.fn>;
  }>;
  dispose: () => void;
}>;

function createDesktopIpcHarness(): DesktopIpcHarness {
  const ipcMain = new FakeIpcMain();
  const mainFrame = {};
  const trusted = { mainFrame };
  const effects = {
    appInfo: vi.fn(() => APP_INFO),
    platformSnapshot: vi.fn(() => PLATFORM_SNAPSHOT),
    rendererReady: vi.fn(),
    persistence: vi.fn(),
    provider: vi.fn(),
  };
  const dispose = registerDesktopIpc({
    ipcMain,
    trustedWebContents: () => trusted,
    getAppInfo: effects.appInfo,
    getPlatformSnapshot: effects.platformSnapshot,
    onRendererReady: effects.rendererReady,
  });
  return { ipcMain, trusted, mainFrame, effects, dispose };
}

function trustedDesktopIpcEvent(harness: DesktopIpcHarness): DesktopIpcEvent {
  return { sender: harness.trusted, senderFrame: harness.mainFrame };
}

function expectNoDesktopIpcEffects(harness: DesktopIpcHarness): void {
  expect(harness.effects.appInfo).not.toHaveBeenCalled();
  expect(harness.effects.platformSnapshot).not.toHaveBeenCalled();
  expect(harness.effects.rendererReady).not.toHaveBeenCalled();
  expect(harness.effects.persistence).not.toHaveBeenCalled();
  expect(harness.effects.provider).not.toHaveBeenCalled();
}

function ensureMaterializedProviderBoundary(): void {
  const downstreamRoot = resolve(".actestra/aionui-v2.1.41");
  const providerBoundary = join(
    downstreamRoot,
    "packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts",
  );
  const providerTest = join(downstreamRoot, "tests/unit/actestra/providerRendererBoundary.test.ts");
  if (!existsSync(providerBoundary) || !existsSync(providerTest)) {
    // These cases inspect the applied downstream patch, so bootstrap that
    // generated fixture when the test is run directly from a clean checkout.
    materializeAionUiDownstream();
  }
}

const DOWNSTREAM_ROOT = resolve(".actestra/aionui-v2.1.41");

function runDownstreamProbe<T extends Readonly<Record<string, unknown>>>(script: string): T {
  ensureMaterializedProviderBoundary();
  const result = spawnSync("bun", ["-e", script], {
    cwd: DOWNSTREAM_ROOT,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH ?? "",
      TZ: "UTC",
      NO_COLOR: "1",
    },
  });
  if (result.status !== 0 || result.error !== undefined) {
    throw new Error("The bounded downstream credential probe did not complete");
  }
  const output = result.stdout.trim();
  if (Buffer.byteLength(output, "utf8") > 4_096) {
    throw new Error("The bounded downstream credential probe exceeded its output limit");
  }
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error("The bounded downstream credential probe returned invalid evidence");
  }
}

function providerReadProbe(kind: "list" | "read"): Readonly<Record<string, unknown>> {
  return runDownstreamProbe(`
    import { randomBytes } from "node:crypto";
    const kind = ${JSON.stringify(kind)};
    const canary = "p7-provider-" + randomBytes(24).toString("base64url");
    const boundary = await import(
      "./packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts"
    );
    const handlers = new Map();
    const mainFrame = {};
    const webContents = { mainFrame, isDestroyed: () => false };
    const effects = [];
    boundary.registerActestraProviderRendererIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      request: async (method, path, body) => {
        effects.push({ method, path, body });
        const record = {
          id: "provider-one",
          api_key: canary,
          base_url:
            "https://credential-user:" + canary +
            "@example.invalid/models?access_token=" + canary,
          bedrock_config: { access_key_id: canary, secret_access_key: canary },
        };
        return kind === "list" ? [record] : record;
      },
      trustedWebContents: () => webContents,
    });
    const channel =
      kind === "list"
        ? boundary.ACTESTRA_PROVIDER_LIST_CHANNEL
        : boundary.ACTESTRA_PROVIDER_GET_CHANNEL;
    const handler = handlers.get(channel);
    const result = await handler(
      { sender: webContents, senderFrame: mainFrame },
      ...(kind === "read" ? ["provider-one"] : [])
    );
    const serialized = JSON.stringify(result);
    process.stdout.write(JSON.stringify({
      requestCount: effects.length,
      requestPath: effects[0]?.path ?? "",
      leakageCount: serialized.includes(canary) ? 1 : 0,
      redactedCredentialCount: (serialized.match(/\\[REDACTED\\]/g) ?? []).length,
      rendererEffectCount: 0,
    }));
  `);
}

function httpNoStoreProbe(): Readonly<Record<string, unknown>> {
  return runDownstreamProbe(`
    console.debug = () => {};
    console.error = () => {};
    console.warn = () => {};
    delete globalThis.window;
    delete globalThis.document;
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ data: { models: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const { httpRequest } = await import(
      "./packages/desktop/src/common/adapter/httpBridge.ts"
    );
    await httpRequest("POST", "/api/providers/fetch-models", { api_key: "fixture-key" });
    process.stdout.write(JSON.stringify({
      fetchCount: captured === null ? 0 : 1,
      cache: captured?.init?.cache ?? "",
      cacheControl: captured?.init?.headers?.["Cache-Control"] ?? "",
    }));
  `);
}

function rendererProviderCacheProbe(): Readonly<Record<string, unknown>> {
  return runDownstreamProbe(`
    console.debug = () => {};
    console.error = () => {};
    let fetchCount = 0;
    let listCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response("{}", { status: 200 });
    };
    globalThis.window = {
      __backendPort: 13400,
      electronAPI: {
        actestraProviderList: async () => {
          listCount += 1;
          return [{ id: "provider-one", api_key: "[REDACTED]" }];
        },
        actestraProviderGet: async () => null,
        actestraProviderMutate: async () => null,
      },
    };
    const { httpRequest } = await import(
      "./packages/desktop/src/common/adapter/httpBridge.ts"
    );
    const result = await httpRequest("GET", "/api/providers");
    process.stdout.write(JSON.stringify({
      fetchCount,
      listCount,
      resourceCount: fetchCount,
      projectionIsRedacted: result?.[0]?.api_key === "[REDACTED]",
    }));
  `);
}

function providerMutationProbe(
  mode: "same-provider" | "cross-provider",
): Readonly<Record<string, unknown>> {
  return runDownstreamProbe(`
    import { randomBytes } from "node:crypto";
    console.debug = () => {};
    console.error = () => {};
    console.warn = () => {};
    const mode = ${JSON.stringify(mode)};
    const canaryA = "p7-provider-a-" + randomBytes(24).toString("base64url");
    const canaryB = "p7-provider-b-" + randomBytes(24).toString("base64url");
    const store = new Map([
      ["provider-a", { id: "provider-a", name: "A", api_key: canaryA }],
      ["provider-b", { id: "provider-b", name: "B", api_key: canaryB }],
    ]);
    const boundary = await import(
      "./packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts"
    );
    const handlers = new Map();
    const mainFrame = {};
    const webContents = { mainFrame, isDestroyed: () => false };
    const effects = [];
    boundary.registerActestraProviderRendererIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      request: async (method, path, body) => {
        effects.push({ method, path, body });
        const id = decodeURIComponent(path.slice("/api/providers/".length));
        const current = store.get(id);
        if (method === "PUT" && current !== undefined) {
          const next = { ...current, ...body };
          store.set(id, next);
          return next;
        }
        return current;
      },
      trustedWebContents: () => webContents,
    });
    const invoke = (channel, ...args) =>
      handlers.get(channel)({ sender: webContents, senderFrame: mainFrame }, ...args);
    globalThis.window = {
      __backendPort: 13400,
      electronAPI: {
        actestraProviderList: () => invoke(boundary.ACTESTRA_PROVIDER_LIST_CHANNEL),
        actestraProviderGet: (id) => invoke(boundary.ACTESTRA_PROVIDER_GET_CHANNEL, id),
        actestraProviderMutate: (request) =>
          invoke(boundary.ACTESTRA_PROVIDER_MUTATE_CHANNEL, request),
      },
    };
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error("unexpected fetch");
    };
    const { httpRequest } = await import(
      "./packages/desktop/src/common/adapter/httpBridge.ts"
    );
    const providerId = mode === "cross-provider" ? "provider-b" : "provider-a";
    const result = await httpRequest("PUT", "/api/providers/" + providerId, {
      name: "Updated",
      api_key: "[REDACTED]",
      bedrock_config: {
        region: "us-test-1",
        access_key_id: "[REDACTED]",
        secret_access_key: "[REDACTED]",
      },
    });
    const body = effects[0]?.body ?? {};
    const resultText = JSON.stringify(result);
    process.stdout.write(JSON.stringify({
      requestCount: effects.length,
      requestPath: effects[0]?.path ?? "",
      requestBodyKeys: Object.keys(body).sort(),
      nestedBodyKeys: Object.keys(body.bedrock_config ?? {}).sort(),
      providerASecretPreserved: store.get("provider-a")?.api_key === canaryA,
      providerBSecretPreserved: store.get("provider-b")?.api_key === canaryB,
      responseLeakageCount:
        resultText.includes(canaryA) || resultText.includes(canaryB) ? 1 : 0,
      fetchCount,
    }));
  `);
}

function providerHookProbe(
  mode: "missing-key" | "sentinel-no-id" | "stored-provider-a" | "stored-provider-b",
): Readonly<Record<string, unknown>> {
  return runDownstreamProbe(`
    import { mock } from "bun:test";
    const mode = ${JSON.stringify(mode)};
    const calls = [];
    mock.module("swr", () => ({
      default: (key, fetcher) => ({ key, fetcher }),
    }));
    mock.module("@/common", () => ({
      ipcBridge: {
        mode: {
          fetchProviderModels: {
            invoke: async (value) => {
              calls.push({ kind: "stored", value });
              return { models: [] };
            },
          },
          fetchModelList: {
            invoke: async (value) => {
              calls.push({ kind: "anonymous", value });
              return { models: [] };
            },
          },
        },
      },
    }));
    const { default: useModeModeList } = await import(
      "./packages/desktop/src/renderer/hooks/agent/useModeModeList.ts"
    );
    const inputs = {
      "missing-key": { apiKey: "", providerId: "provider-missing" },
      "sentinel-no-id": { apiKey: "[REDACTED]", providerId: undefined },
      "stored-provider-a": { apiKey: "[REDACTED]", providerId: "provider-a" },
      "stored-provider-b": { apiKey: "[REDACTED]", providerId: "provider-b" },
    }[mode];
    const hook = useModeModeList(
      "openai",
      "",
      inputs.apiKey,
      false,
      undefined,
      inputs.providerId
    );
    const response = await hook.fetcher(hook.key);
    process.stdout.write(JSON.stringify({
      storedCount: calls.filter((call) => call.kind === "stored").length,
      anonymousCount: calls.filter((call) => call.kind === "anonymous").length,
      providerIds: calls
        .filter((call) => call.kind === "stored")
        .map((call) => call.value.id),
      modelCount: response.models.length,
    }));
  `);
}

function providerLogProbe(): Readonly<Record<string, unknown>> {
  return runDownstreamProbe(`
    import { randomBytes } from "node:crypto";
    const canary = "p7-log-" + randomBytes(24).toString("base64url");
    const logs = [];
    console.debug = (...args) => logs.push(args);
    console.error = (...args) => logs.push(args);
    console.warn = (...args) => logs.push(args);
    delete globalThis.window;
    delete globalThis.document;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ error: canary, api_key: canary }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };
    const { httpRequest } = await import(
      "./packages/desktop/src/common/adapter/httpBridge.ts"
    );
    let errorLeakageCount = 0;
    try {
      await httpRequest("POST", "/api/providers/fetch-models", { api_key: canary });
    } catch (error) {
      const serialized = String(error?.message ?? "") + JSON.stringify(error?.body ?? null);
      errorLeakageCount = serialized.includes(canary) ? 1 : 0;
    }
    process.stdout.write(JSON.stringify({
      fetchCount,
      logLeakageCount: JSON.stringify(logs).includes(canary) ? 1 : 0,
      errorLeakageCount,
    }));
  `);
}

function credentialCanary(category: string): string {
  return `${category}-${randomBytes(24).toString("base64url")}`;
}

function assertCredentialCanaryAbsent(serialized: string, canary: string): void {
  if (serialized.includes(canary)) {
    throw new Error("A protected credential canary crossed its redaction boundary");
  }
}

function credentialAttemptEvidence(): AgentAttemptEvidence {
  return {
    contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
    redaction: "metadata",
    workspaceId: FIXTURE_WORKSPACE_ID,
    taskId: FIXTURE_TASK_ID,
    correlationId: correlationId("correlation-p7-credential"),
    sessionId: FIXTURE_SESSION_ID,
    workerId: FIXTURE_WORKER_ID,
    streamId: FIXTURE_STREAM_ID,
    state: "protocol-failed",
    taskState: "failed",
    startedAt: instant("2026-08-15T00:00:00.000Z"),
    lastSignalAt: instant("2026-08-15T00:00:01.000Z"),
    lastControlSequence: 1,
    lastCoreEventSequence: 1,
    restartCount: 0,
    disposed: true,
    forcedCancellation: false,
    incident: {
      code: "model-request-rejected",
      occurredAt: instant("2026-08-15T00:00:02.000Z"),
    },
  };
}

describe("P7 renderer, IPC, and credential abuse baseline", () => {
  beforeAll(() => {
    ensureMaterializedProviderBoundary();
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-DIRECT-NODE", () => {
    expectStaticFixtureRejected(
      `import process from "node:process";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
process.chdir("/private/actestra-p7-denied");`,
      ["Node import", "Node process global"],
    );
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-DIRECT-ELECTRON", () => {
    expectStaticFixtureRejected(
      `import { app } from "electron";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
app.quit();`,
      ["Electron import"],
    );
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-PRIVILEGED-PROCESS", () => {
    expectStaticFixtureRejected(
      `import { installSessionSecurity } from "../../main/security";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
installSessionSecurity({} as never, false);`,
      ["privileged process import"],
    );
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-SHELL", () => {
    expectStaticFixtureRejected(
      `import { execFile } from "node:child_process";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
execFile("/usr/bin/false");`,
      ["Node import"],
    );
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-PERSISTENCE", () => {
    expectStaticFixtureRejected(
      `import { DatabaseSync } from "node:sqlite";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
new DatabaseSync(":memory:");`,
      ["Node import"],
    );
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-FILESYSTEM", () => {
    expectStaticFixtureRejected(
      `import { writeFile } from "node:fs/promises";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
void writeFile("/private/actestra-p7-denied", "denied");`,
      ["Node import"],
    );
  });

  it("P7-A-RENDERER-001 P7-V-RENDERER-001-GIT", () => {
    expectStaticFixtureRejected(
      `import git from "isomorphic-git";
globalThis.${STATIC_FIXTURE_EFFECT} = true;
void git.clone({ dir: "/private/actestra-p7-denied", url: "https://example.invalid/repository.git" });`,
      ["Git authority import"],
    );
  });

  it("P7-A-RENDERER-002 P7-V-RENDERER-002-FETCH", () => {
    expectStaticFixtureRejected(
      `globalThis.${STATIC_FIXTURE_EFFECT} = true;
void fetch("https://example.invalid");`,
      ["direct fetch client"],
    );
  });

  it("P7-A-RENDERER-002 P7-V-RENDERER-002-WEBSOCKET", () => {
    expectStaticFixtureRejected(
      `globalThis.${STATIC_FIXTURE_EFFECT} = true;
new WebSocket("wss://example.invalid");`,
      ["direct WebSocket client"],
    );
  });

  it("P7-A-RENDERER-002 P7-V-RENDERER-002-EVENTSOURCE", () => {
    expectStaticFixtureRejected(
      `globalThis.${STATIC_FIXTURE_EFFECT} = true;
new EventSource("https://example.invalid/events");`,
      ["direct EventSource client"],
    );
  });

  it("P7-A-RENDERER-002 P7-V-RENDERER-002-XMLHTTPREQUEST", () => {
    expectStaticFixtureRejected(
      `globalThis.${STATIC_FIXTURE_EFFECT} = true;
new XMLHttpRequest();`,
      ["direct XMLHttpRequest client"],
    );
  });

  it("P7-A-RENDERER-002 P7-V-RENDERER-002-WINDOW-REQUIRE", () => {
    expectStaticFixtureRejected(
      `globalThis.${STATIC_FIXTURE_EFFECT} = true;
window.require("node:fs").writeFileSync("/private/actestra-p7-denied", "denied");`,
      ["CommonJS require", "window require escape"],
    );
  });

  it("retains the adjacent WebView guest and session network boundary", () => {
    let attachListener:
      | ((
          event: { preventDefault: () => void },
          webPreferences: Record<string, unknown>,
          params: { src: string; partition?: string },
        ) => void)
      | undefined;
    const guestSession = {
      setPermissionRequestHandler: (handler: unknown) => {
        expect(handler).toBeTypeOf("function");
        const callback = vi.fn();
        (
          handler as (
            webContents: unknown,
            permission: string,
            callback: (allowed: boolean) => void,
          ) => void
        )({}, "media", callback);
        expect(callback).toHaveBeenCalledWith(false);
      },
      webRequest: {
        onBeforeRequest: (
          filter: unknown,
          listener: (
            details: { url: string },
            callback: (result: { cancel: boolean }) => void,
          ) => void,
        ) => {
          expect(filter).toEqual({
            urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"],
          });
          const allowed: { cancel: boolean }[] = [];
          listener({ url: "https://preview.example.invalid/page" }, (result) =>
            allowed.push(result),
          );
          listener({ url: "http://127.0.0.1:18791/preview" }, (result) => allowed.push(result));
          listener({ url: "http://localhost:13400/api/preview" }, (result) => allowed.push(result));
          listener({ url: "https://localhost:4443/preview" }, (result) => allowed.push(result));
          listener({ url: "http://127.0.0.1:59999/preview" }, (result) => allowed.push(result));
          listener({ url: "file:///tmp/preview.html" }, (result) => allowed.push(result));
          expect(allowed).toEqual([
            { cancel: true },
            { cancel: false },
            { cancel: false },
            { cancel: true },
            { cancel: true },
            { cancel: true },
          ]);
        },
      },
    };
    const webviewOwner = {
      on: (event: "will-attach-webview", listener: typeof attachListener) => {
        expect(event).toBe("will-attach-webview");
        attachListener = listener;
      },
    } as unknown as Parameters<typeof installWebviewGuestSecurity>[0];
    installWebviewGuestSecurity(webviewOwner, () => guestSession, { backendPort: () => 13400 });
    const preferences: Record<string, unknown> = {
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      nativeWindowOpen: true,
      preload: "/tmp/attacker-preload.js",
    };
    let prevented = false;
    attachListener?.({ preventDefault: () => (prevented = true) }, preferences, {
      src: "http://127.0.0.1:18791/preview",
      partition: "persist:ext-settings-safe",
    });
    expect(prevented).toBe(false);
    expect(preferences).toMatchObject({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      nativeWindowOpen: false,
    });
    expect(preferences).not.toHaveProperty("preload");

    let externalHttpsPrevented = false;
    attachListener?.(
      { preventDefault: () => (externalHttpsPrevented = true) },
      {},
      {
        src: "https://preview.example.invalid/page",
        partition: "persist:ext-settings-safe",
      },
    );
    expect(externalHttpsPrevented).toBe(true);

    let undeclaredLocalPortPrevented = false;
    attachListener?.(
      { preventDefault: () => (undeclaredLocalPortPrevented = true) },
      {},
      {
        src: "http://127.0.0.1:59999/preview",
        partition: "persist:actestra-preview",
      },
    );
    expect(undeclaredLocalPortPrevented).toBe(true);

    let missingPartitionPrevented = false;
    attachListener?.(
      { preventDefault: () => (missingPartitionPrevented = true) },
      {},
      { src: "https://preview.example.invalid/page" },
    );
    expect(missingPartitionPrevented).toBe(true);

    for (const src of ["file:///tmp/preview.html", "data:text/html,preview"]) {
      const localPreferences: Record<string, unknown> = {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        webSecurity: false,
        preload: "/tmp/attacker-preload.js",
      };
      let localPrevented = false;
      attachListener?.({ preventDefault: () => (localPrevented = true) }, localPreferences, {
        src,
      });
      expect(localPrevented, `${src} should remain a supported local preview`).toBe(false);
      expect(localPreferences).toMatchObject({
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      });
      expect(localPreferences).not.toHaveProperty("preload");
    }

    let invalidPartitionPrevented = false;
    attachListener?.(
      { preventDefault: () => (invalidPartitionPrevented = true) },
      {},
      { src: "https://preview.example.invalid/page", partition: "persist:attacker" },
    );
    expect(invalidPartitionPrevented).toBe(true);

    let invalidSchemePrevented = false;
    attachListener?.(
      { preventDefault: () => (invalidSchemePrevented = true) },
      {},
      { src: "javascript:alert(1)", partition: "persist:ext-settings-safe" },
    );
    expect(invalidSchemePrevented).toBe(true);
  });

  it("P7-A-IPC-001 P7-V-IPC-001-UNDECLARED-CHANNEL", () => {
    const harness = createDesktopIpcHarness();
    expect(() =>
      harness.ipcMain.invoke("actestra:undeclared", trustedDesktopIpcEvent(harness)),
    ).toThrow(/missing handler/iu);
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-001 P7-V-IPC-001-STALE-FRAME", async () => {
    const harness = createDesktopIpcHarness();
    const staleFrame = harness.trusted.mainFrame;
    (harness.trusted as { mainFrame: unknown }).mainFrame = {};
    await expect(
      harness.ipcMain.invoke(APP_INFO_CHANNEL, {
        sender: harness.trusted,
        senderFrame: staleFrame,
      }),
    ).rejects.toMatchObject({ code: "untrusted-sender" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-001 P7-V-IPC-001-NON-MAIN-FRAME", async () => {
    const harness = createDesktopIpcHarness();
    await expect(
      harness.ipcMain.invoke(APP_INFO_CHANNEL, {
        sender: harness.trusted,
        senderFrame: { kind: "subframe" },
      }),
    ).rejects.toMatchObject({ code: "untrusted-sender" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-001 P7-V-IPC-001-WRONG-SENDER", async () => {
    const harness = createDesktopIpcHarness();
    await expect(
      harness.ipcMain.invoke(APP_INFO_CHANNEL, {
        sender: { mainFrame: harness.mainFrame },
        senderFrame: harness.mainFrame,
      }),
    ).rejects.toMatchObject({ code: "untrusted-sender" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-001 P7-V-IPC-001-REQUEST-AFTER-DISPOSAL", () => {
    const harness = createDesktopIpcHarness();
    harness.dispose();
    expect(() => harness.ipcMain.invoke(APP_INFO_CHANNEL, trustedDesktopIpcEvent(harness))).toThrow(
      /missing handler/iu,
    );
    expect(harness.ipcMain.handlers.size).toBe(0);
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-002 P7-V-IPC-002-UNKNOWN-KEYS", async () => {
    const harness = createDesktopIpcHarness();
    await expect(
      harness.ipcMain.invoke(APP_INFO_CHANNEL, trustedDesktopIpcEvent(harness), {
        unknown: true,
      }),
    ).rejects.toMatchObject({ code: "unexpected-arguments" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-002 P7-V-IPC-002-PROTOTYPE-BEARING-INPUT", async () => {
    const harness = createDesktopIpcHarness();
    const prototypeBearing = Object.create({ injected: true }) as Record<string, unknown>;
    prototypeBearing.value = "unexpected";
    await expect(
      harness.ipcMain.invoke(APP_INFO_CHANNEL, trustedDesktopIpcEvent(harness), prototypeBearing),
    ).rejects.toMatchObject({ code: "unexpected-arguments" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-002 P7-V-IPC-002-UNEXPECTED-ARGUMENTS", async () => {
    const harness = createDesktopIpcHarness();
    await expect(
      harness.ipcMain.invoke(APP_INFO_CHANNEL, trustedDesktopIpcEvent(harness), "unexpected", 2),
    ).rejects.toMatchObject({ code: "unexpected-arguments" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-IPC-002 P7-V-IPC-002-OVERSIZED-PAYLOAD", async () => {
    const harness = createDesktopIpcHarness();
    await expect(
      harness.ipcMain.invoke(
        APP_INFO_CHANNEL,
        trustedDesktopIpcEvent(harness),
        "x".repeat(1024 * 1024 + 1),
      ),
    ).rejects.toMatchObject({ code: "unexpected-arguments" });
    expectNoDesktopIpcEffects(harness);
  });

  it("P7-A-CREDENTIAL-001 P7-V-CREDENTIAL-001-PROVIDER-LIST-REDACTION", () => {
    const evidence = providerReadProbe("list");
    expect(evidence).toMatchObject({
      requestCount: 1,
      requestPath: "/api/providers",
      leakageCount: 0,
      redactedCredentialCount: 3,
      rendererEffectCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-001 P7-V-CREDENTIAL-001-PROVIDER-READ-REDACTION", () => {
    const evidence = providerReadProbe("read");
    expect(evidence).toMatchObject({
      requestCount: 1,
      requestPath: "/api/providers/provider-one",
      leakageCount: 0,
      redactedCredentialCount: 3,
      rendererEffectCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-001 P7-V-CREDENTIAL-001-CHROMIUM-NO-STORE", () => {
    expect(httpNoStoreProbe()).toMatchObject({
      fetchCount: 1,
      cache: "no-store",
      cacheControl: "no-store",
    });
  });

  it("P7-A-CREDENTIAL-001 P7-V-CREDENTIAL-001-RENDERER-CACHE-ABSENCE", () => {
    expect(rendererProviderCacheProbe()).toMatchObject({
      fetchCount: 0,
      listCount: 1,
      resourceCount: 0,
      projectionIsRedacted: true,
    });
  });

  it("P7-A-CREDENTIAL-002 P7-V-CREDENTIAL-002-SENTINEL-WRITE-BACK", () => {
    const evidence = providerMutationProbe("same-provider");
    expect(evidence).toMatchObject({
      requestCount: 1,
      requestPath: "/api/providers/provider-a",
      requestBodyKeys: ["bedrock_config", "name"],
      nestedBodyKeys: ["region"],
      providerASecretPreserved: true,
      providerBSecretPreserved: true,
      responseLeakageCount: 0,
      fetchCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-002 P7-V-CREDENTIAL-002-CROSS-PROVIDER-SUBSTITUTION", () => {
    const mutation = providerMutationProbe("cross-provider");
    expect(mutation).toMatchObject({
      requestCount: 1,
      requestPath: "/api/providers/provider-b",
      requestBodyKeys: ["bedrock_config", "name"],
      nestedBodyKeys: ["region"],
      providerASecretPreserved: true,
      providerBSecretPreserved: true,
      responseLeakageCount: 0,
      fetchCount: 0,
    });
    expect(providerHookProbe("stored-provider-b")).toMatchObject({
      storedCount: 1,
      anonymousCount: 0,
      providerIds: ["provider-b"],
      modelCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-002 P7-V-CREDENTIAL-002-MISSING-STORED-KEY", () => {
    expect(providerHookProbe("missing-key")).toMatchObject({
      storedCount: 0,
      anonymousCount: 0,
      providerIds: [],
      modelCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-002 P7-V-CREDENTIAL-002-ANONYMOUS-FETCH-FALLBACK", () => {
    expect(providerHookProbe("sentinel-no-id")).toMatchObject({
      storedCount: 0,
      anonymousCount: 0,
      providerIds: [],
      modelCount: 0,
    });
    expect(providerHookProbe("stored-provider-a")).toMatchObject({
      storedCount: 1,
      anonymousCount: 0,
      providerIds: ["provider-a"],
      modelCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-003 P7-V-CREDENTIAL-003-RENDERER-LEAKAGE", () => {
    const evidence = providerReadProbe("list");
    expect(evidence).toMatchObject({
      requestCount: 1,
      leakageCount: 0,
      redactedCredentialCount: 3,
      rendererEffectCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-003 P7-V-CREDENTIAL-003-LOG-LEAKAGE", () => {
    expect(providerLogProbe()).toMatchObject({
      fetchCount: 1,
      logLeakageCount: 0,
      errorLeakageCount: 0,
    });
  });

  it("P7-A-CREDENTIAL-003 P7-V-CREDENTIAL-003-PERSISTENCE-LEAKAGE", async () => {
    const canary = credentialCanary("p7-persistence");
    const directory = mkdtempSync(join(tmpdir(), "actestra-p7-credential-persistence-"));
    const persistence = openSqliteCorePersistence(directory);
    let closed = false;
    try {
      await expect(
        persistence.appendAgentAttemptEvidence({
          ...credentialAttemptEvidence(),
          credential: canary,
        } as never),
      ).rejects.toMatchObject({ code: "invalid-record" });
      expect(await persistence.listRecentAgentAttemptEvidence(10)).toEqual([]);
      await persistence.close();
      closed = true;
      const databaseBytes = readFileSync(resolveCoreDatabasePath(directory));
      if (databaseBytes.includes(Buffer.from(canary, "utf8"))) {
        throw new Error("A protected credential canary entered Actestra persistence");
      }
    } finally {
      if (!closed) await persistence.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("P7-A-CREDENTIAL-003 P7-V-CREDENTIAL-003-WORKER-ENVIRONMENT-LEAKAGE", () => {
    const canary = credentialCanary("p7-worker-environment");
    const variableName = "ACTESTRA_P7_CREDENTIAL_CANARY";
    const previous = process.env[variableName];
    process.env[variableName] = canary;
    let environment: Readonly<Record<string, string>>;
    try {
      environment = createGooseRunnerEnvironment(
        resolve(tmpdir(), "actestra-p7-credential-worker-private-root"),
      );
    } finally {
      if (previous === undefined) delete process.env[variableName];
      else process.env[variableName] = previous;
    }
    assertCredentialCanaryAbsent(JSON.stringify(environment), canary);
    expect(Object.hasOwn(environment, variableName)).toBe(false);
    expect(
      Object.keys(environment).filter((key) =>
        /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION)/iu.test(key),
      ),
    ).toEqual([]);
  });

  it("P7-A-CREDENTIAL-003 P7-V-CREDENTIAL-003-DIAGNOSTIC-LEAKAGE", () => {
    const canary = credentialCanary("p7-diagnostic");
    const diagnostic = toDiagnosticEvent(
      createEvent(2, "agent.message", {
        role: "assistant",
        content: canary,
      }),
    );
    assertCredentialCanaryAbsent(JSON.stringify(diagnostic), canary);
    expect(diagnostic.payload).toEqual({
      redacted: true,
      classification: "workspace-content",
    });
  });

  it("retains the adjacent packaged-session request and permission denial", () => {
    expect(isAllowedDevelopmentUrl("https://api.example.invalid")).toBe(false);
    let permissionHandler:
      | ((webContents: unknown, permission: string, callback: (allowed: boolean) => void) => void)
      | undefined;
    let requestListener:
      | ((
          details: Readonly<{ url: string }>,
          callback: (result: { cancel: boolean }) => void,
        ) => void)
      | undefined;
    installSessionSecurity(
      {
        setPermissionRequestHandler: (handler: typeof permissionHandler) => {
          permissionHandler = handler;
        },
        webRequest: {
          onBeforeRequest: (_filter: unknown, listener: typeof requestListener) => {
            requestListener = listener;
          },
        },
      } as never,
      true,
    );
    const permissionResult = vi.fn();
    permissionHandler?.({}, "media", permissionResult);
    expect(permissionResult).toHaveBeenCalledWith(false);
    const requestResult = vi.fn();
    requestListener?.({ url: "http://127.0.0.1:49152/api/providers" }, requestResult);
    expect(requestResult).toHaveBeenCalledWith({ cancel: true });
  });
});
