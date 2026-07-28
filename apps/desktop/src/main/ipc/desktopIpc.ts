import {
  APP_INFO_CHANNEL,
  PLATFORM_SNAPSHOT_CHANNEL,
  RENDERER_READY_CHANNEL,
  assertAppInfo,
  assertPlatformSnapshot,
  type AppInfo,
  type PlatformSnapshot,
} from "../../shared/contracts";

export interface TrustedWebContents {
  readonly mainFrame: unknown;
}

export interface DesktopIpcEvent {
  readonly sender: unknown;
  readonly senderFrame: unknown;
}

type DesktopIpcListener = (event: DesktopIpcEvent, ...args: unknown[]) => unknown;

export interface DesktopIpcMain {
  handle(channel: string, listener: DesktopIpcListener): void;
  removeHandler(channel: string): void;
  on(channel: string, listener: DesktopIpcListener): this;
  removeListener(channel: string, listener: DesktopIpcListener): this;
}

export interface DesktopIpcRegistration {
  readonly ipcMain: DesktopIpcMain;
  readonly trustedWebContents: () => TrustedWebContents | null;
  readonly getAppInfo: () => AppInfo | Promise<AppInfo>;
  readonly getPlatformSnapshot: () => PlatformSnapshot | Promise<PlatformSnapshot>;
  readonly onRendererReady: () => void;
}

export class DesktopIpcError extends Error {
  constructor(
    readonly code: "untrusted-sender" | "unexpected-arguments" | "invalid-response",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DesktopIpcError";
  }
}

function assertTrustedEvent(
  event: DesktopIpcEvent,
  trustedWebContents: () => TrustedWebContents | null,
): void {
  const trusted = trustedWebContents();
  if (trusted === null || event.sender !== trusted || event.senderFrame !== trusted.mainFrame) {
    throw new DesktopIpcError(
      "untrusted-sender",
      "Desktop IPC accepts only the current trusted main frame",
    );
  }
}

function assertNoArguments(args: readonly unknown[]): void {
  if (args.length !== 0) {
    throw new DesktopIpcError(
      "unexpected-arguments",
      "Desktop IPC metadata intents do not accept arguments",
    );
  }
}

export function registerDesktopIpc(registration: DesktopIpcRegistration): () => void {
  const { ipcMain, trustedWebContents } = registration;
  const appInfoHandler: DesktopIpcListener = async (event, ...args) => {
    assertTrustedEvent(event, trustedWebContents);
    assertNoArguments(args);
    const value = await registration.getAppInfo();
    try {
      assertAppInfo(value);
    } catch (error) {
      throw new DesktopIpcError("invalid-response", "Main produced invalid application metadata", {
        cause: error,
      });
    }
    return value;
  };
  const platformSnapshotHandler: DesktopIpcListener = async (event, ...args) => {
    assertTrustedEvent(event, trustedWebContents);
    assertNoArguments(args);
    const value = await registration.getPlatformSnapshot();
    try {
      assertPlatformSnapshot(value);
    } catch (error) {
      throw new DesktopIpcError("invalid-response", "Main produced an invalid platform snapshot", {
        cause: error,
      });
    }
    return value;
  };
  const rendererReadyListener: DesktopIpcListener = (event, ...args) => {
    try {
      assertTrustedEvent(event, trustedWebContents);
      assertNoArguments(args);
    } catch {
      return;
    }
    registration.onRendererReady();
  };

  ipcMain.handle(APP_INFO_CHANNEL, appInfoHandler);
  ipcMain.handle(PLATFORM_SNAPSHOT_CHANNEL, platformSnapshotHandler);
  ipcMain.on(RENDERER_READY_CHANNEL, rendererReadyListener);

  let registered = true;
  return () => {
    if (!registered) {
      return;
    }
    registered = false;
    ipcMain.removeHandler(APP_INFO_CHANNEL);
    ipcMain.removeHandler(PLATFORM_SNAPSHOT_CHANNEL);
    ipcMain.removeListener(RENDERER_READY_CHANNEL, rendererReadyListener);
  };
}
