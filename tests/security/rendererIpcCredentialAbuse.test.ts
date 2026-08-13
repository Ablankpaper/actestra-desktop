import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  actestraTeamRendererPrivilegePatterns,
  inspectSourceFilesForPrivilegePatterns,
  preloadPrivilegePatterns,
  rendererPrivilegePatterns,
  // @ts-ignore The boundary rules are an executable .mjs checker without a declaration file.
} from "../../scripts/product-boundary-rules.mjs";
import {
  APP_INFO_CHANNEL,
  type AppInfo,
  PLATFORM_SNAPSHOT_CHANNEL,
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  type PlatformSnapshot,
} from "../../apps/desktop/src/shared/contracts";
import {
  registerDesktopIpc,
  type DesktopIpcEvent,
  type DesktopIpcMain,
} from "../../apps/desktop/src/main/ipc/desktopIpc";
import {
  installSessionSecurity,
  isAllowedDevelopmentUrl,
} from "../../apps/desktop/src/main/security";
import { installWebviewGuestSecurity } from "../../apps/desktop/src/main/security/p7SecuritySmoke";

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

describe("P7 renderer, IPC, and credential abuse baseline", () => {
  it("P7-A-RENDERER-001 rejects privileged renderer imports", () => {
    const sources = [
      'import fs from "node:fs"; export const value = fs.readFileSync("x");',
      'import { app } from "electron"; export const value = app.getPath("home");',
      'import { execFile } from "node:child_process"; export const value = execFile;',
      'import { readFile } from "node:fs/promises"; export const value = readFile;',
      'const child = require("node:child_process"); export const value = child;',
    ] as const;
    const findings = scanFixtures(rendererPrivilegePatterns, sources);
    expect(findings).toHaveLength(5);
    expect(findings.map((finding: PrivilegeFinding) => finding.label)).toEqual([
      "Node import",
      "Electron import",
      "Node import",
      "Node import",
      "CommonJS require",
    ]);
  });

  it("P7-A-RENDERER-002 rejects renderer network escape", () => {
    const sources = [
      'export const value = fetch("https://example.invalid");',
      'export const value = new WebSocket("wss://example.invalid");',
      'export const value = new EventSource("https://example.invalid/events");',
      "export const value = new XMLHttpRequest();",
      'export const value = window["require"]("node:fs");',
    ] as const;
    const findings = scanFixtures(rendererPrivilegePatterns, sources);
    expect(findings).toHaveLength(4);
    expect(findings.map((finding: PrivilegeFinding) => finding.label)).toEqual([
      "direct fetch client",
      "direct WebSocket client",
      "direct EventSource client",
      "direct XMLHttpRequest client",
    ]);
    const windowRequireFindings = scanFixtures(rendererPrivilegePatterns, [
      'export const value = window.require("node:fs");',
    ]);
    expect(windowRequireFindings).toEqual([
      { relativePath: "fixture-0.tsx", label: "CommonJS require" },
      { relativePath: "fixture-0.tsx", label: "window require escape" },
    ]);

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
          listener({ url: "file:///tmp/preview.html" }, (result) => allowed.push(result));
          expect(allowed).toEqual([{ cancel: false }, { cancel: true }]);
        },
      },
    };
    installWebviewGuestSecurity(
      {
        on: (event: "will-attach-webview", listener: typeof attachListener) => {
          expect(event).toBe("will-attach-webview");
          attachListener = listener;
        },
      },
      () => guestSession,
    );
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
      src: "https://preview.example.invalid/page",
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

  it("P7-A-IPC-001 rejects untrusted IPC callers", async () => {
    const ipcMain = new FakeIpcMain();
    const mainFrame = {};
    const trusted = { mainFrame };
    const effect = vi.fn(() => APP_INFO);
    const dispose = registerDesktopIpc({
      ipcMain,
      trustedWebContents: () => trusted,
      getAppInfo: effect,
      getPlatformSnapshot: () => PLATFORM_SNAPSHOT,
      onRendererReady: vi.fn(),
    });
    const untrusted = { sender: {}, senderFrame: {} } satisfies DesktopIpcEvent;
    await expect(ipcMain.invoke(APP_INFO_CHANNEL, untrusted)).rejects.toMatchObject({
      code: "untrusted-sender",
    });
    const stale = { sender: trusted, senderFrame: {} } satisfies DesktopIpcEvent;
    await expect(ipcMain.invoke(PLATFORM_SNAPSHOT_CHANNEL, stale)).rejects.toMatchObject({
      code: "untrusted-sender",
    });
    expect(effect).not.toHaveBeenCalled();
    dispose();
    expect(ipcMain.handlers.size).toBe(0);
  });

  it("P7-A-IPC-002 rejects malformed IPC payloads", async () => {
    const ipcMain = new FakeIpcMain();
    const mainFrame = {};
    const trusted = { mainFrame };
    const effect = vi.fn(() => APP_INFO);
    registerDesktopIpc({
      ipcMain,
      trustedWebContents: () => trusted,
      getAppInfo: effect,
      getPlatformSnapshot: () => PLATFORM_SNAPSHOT,
      onRendererReady: vi.fn(),
    });
    const event = { sender: trusted, senderFrame: mainFrame } satisfies DesktopIpcEvent;
    const prototypeBearing = Object.create({ injected: true }) as Record<string, unknown>;
    prototypeBearing.value = "unexpected";
    await expect(ipcMain.invoke(APP_INFO_CHANNEL, event, prototypeBearing)).rejects.toMatchObject({
      code: "unexpected-arguments",
    });
    await expect(
      ipcMain.invoke(APP_INFO_CHANNEL, event, "x".repeat(1024 * 1024)),
    ).rejects.toMatchObject({
      code: "unexpected-arguments",
    });
    expect(effect).not.toHaveBeenCalled();
  });

  it("P7-A-CREDENTIAL-001 redacts provider reads", () => {
    expect(isAllowedDevelopmentUrl("https://api.example.invalid")).toBe(false);
    let permissionCallback: ((allowed: boolean) => void) | undefined;
    let listener:
      | ((
          details: Readonly<{ url: string }>,
          callback: (result: { cancel: boolean }) => void,
        ) => void)
      | undefined;
    const targetSession = {
      setPermissionRequestHandler: (_handler: unknown) => {
        permissionCallback = (allowed) => void allowed;
      },
      webRequest: {
        onBeforeRequest: (_filter: unknown, next: typeof listener) => {
          listener = next;
        },
      },
    };
    installSessionSecurity(targetSession as never, true);
    expect(listener).toBeTypeOf("function");
    const result = vi.fn();
    listener!({ url: "http://127.0.0.1:49152/api/providers" }, result);
    expect(result).toHaveBeenCalledWith({ cancel: true });
    permissionCallback?.(true);
    const providerBoundary = readFileSync(
      resolve(
        ".actestra/aionui-v2.1.41/packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts",
      ),
      "utf8",
    );
    expect(providerBoundary).toContain("redactedProviderResponse");
    expect(providerBoundary).toContain("redactActestraProviderRecord");
    expect(
      readFileSync(
        resolve(
          "downstream/aionui-v2.1.41/patches/0016-actestra-provider-credential-and-capability.mjs",
        ),
        "utf8",
      ),
    ).toContain("Cache-Control");
  });

  it("P7-A-CREDENTIAL-002 rejects credential substitution", () => {
    const downstreamRoot = resolve(".actestra/aionui-v2.1.41");
    const providerBoundary = join(
      downstreamRoot,
      "packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts",
    );
    const providerTest = join(
      downstreamRoot,
      "tests/unit/actestra/providerRendererBoundary.test.ts",
    );
    expect(existsSync(providerBoundary)).toBe(true);
    expect(existsSync(providerTest)).toBe(true);
    const source = readFileSync(providerBoundary, "utf8");
    expect(source).toContain("redactActestraProviderRecord");
    expect(source).toContain("withoutRedactedActestraCredentials");
    expect(source).toContain("isTrustedEvent");
    expect(source).not.toMatch(/console\.(?:log|error)\([^)]*(?:api_key|secret_access_key)/u);
    const result = spawnSync(
      "bunx",
      ["vitest", "run", "tests/unit/actestra/providerRendererBoundary.test.ts"],
      {
        cwd: downstreamRoot,
        encoding: "utf8",
        timeout: 120_000,
        env: process.env,
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("P7-A-CREDENTIAL-003 blocks credential leakage", () => {
    const providerBoundary = readFileSync(
      resolve(
        ".actestra/aionui-v2.1.41/packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts",
      ),
      "utf8",
    );
    expect(providerBoundary).toContain("redactActestraProviderRecord");
    expect(providerBoundary).toContain("withoutRedactedActestraCredentials");
    expect(providerBoundary).not.toMatch(
      /console\.(?:log|error)\([^)]*(?:api_key|secret_access_key)/u,
    );
    expect(providerBoundary).not.toMatch(/sk-[a-z0-9]{16,}/iu);
    const findings = scanFixtures(actestraTeamRendererPrivilegePatterns, [
      "export const safe = process.env.NODE_ENV;",
      "export const unsafe = process.env.ACTESTRA_SECRET;",
    ]);
    expect(findings).toEqual([{ relativePath: "fixture-1.tsx", label: "Node process global" }]);
    expect(preloadPrivilegePatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "privileged IPC primitive" }),
        expect.objectContaining({ label: "raw ipcRenderer exposure" }),
      ]),
    );
  });
});
