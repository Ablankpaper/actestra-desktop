import { describe, expect, it, vi } from "vitest";
import {
  DesktopIpcError,
  registerDesktopIpc,
  type DesktopIpcEvent,
  type DesktopIpcMain,
  type TrustedWebContents,
} from "../../apps/desktop/src/main/ipc/desktopIpc";
import {
  APP_INFO_CHANNEL,
  PLATFORM_SNAPSHOT_CHANNEL,
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  RENDERER_READY_CHANNEL,
  type AppInfo,
  type PlatformSnapshot,
} from "../../apps/desktop/src/shared/contracts";

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
    if (handler === undefined) {
      throw new Error(`Missing handler ${channel}`);
    }
    return handler(event, ...args);
  }

  emit(channel: string, event: DesktopIpcEvent, ...args: unknown[]): void {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener(event, ...args);
    }
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
  audit: {
    durability: "sqlite-metadata-only",
    recordCount: 0,
    lastSequence: 0,
  },
  attempts: [],
};

describe("desktop IPC registration", () => {
  it("serves only the current main frame and rejects arguments", async () => {
    const ipcMain = new FakeIpcMain();
    const mainFrame = {};
    const trusted = { mainFrame } satisfies TrustedWebContents;
    const event = {
      sender: trusted,
      senderFrame: mainFrame,
    } satisfies DesktopIpcEvent;
    const onRendererReady = vi.fn();
    const dispose = registerDesktopIpc({
      ipcMain,
      trustedWebContents: () => trusted,
      getAppInfo: () => APP_INFO,
      getPlatformSnapshot: () => Promise.resolve(PLATFORM_SNAPSHOT),
      onRendererReady,
    });

    await expect(ipcMain.invoke(APP_INFO_CHANNEL, event)).resolves.toEqual(APP_INFO);
    await expect(ipcMain.invoke(PLATFORM_SNAPSHOT_CHANNEL, event)).resolves.toEqual(
      PLATFORM_SNAPSHOT,
    );
    await expect(ipcMain.invoke(APP_INFO_CHANNEL, event, "unexpected")).rejects.toBeInstanceOf(
      DesktopIpcError,
    );

    const untrusted = {
      sender: { mainFrame: {} },
      senderFrame: {},
    } satisfies DesktopIpcEvent;
    await expect(ipcMain.invoke(APP_INFO_CHANNEL, untrusted)).rejects.toThrow(
      /trusted main frame/i,
    );
    ipcMain.emit(RENDERER_READY_CHANNEL, untrusted);
    ipcMain.emit(RENDERER_READY_CHANNEL, event, "unexpected");
    expect(onRendererReady).not.toHaveBeenCalled();
    ipcMain.emit(RENDERER_READY_CHANNEL, event);
    expect(onRendererReady).toHaveBeenCalledTimes(1);

    dispose();
    expect(ipcMain.handlers.size).toBe(0);
    expect(ipcMain.listeners.get(RENDERER_READY_CHANNEL)?.size ?? 0).toBe(0);
  });
});
