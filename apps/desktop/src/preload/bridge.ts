import {
  APP_INFO_CHANNEL,
  PLATFORM_SNAPSHOT_CHANNEL,
  RENDERER_READY_CHANNEL,
  assertAppInfo,
  assertPlatformSnapshot,
  type ActestraBridge,
  type AppInfo,
  type PlatformAttemptProjection,
  type PlatformSnapshot,
} from "../shared/contracts";

export interface PreloadIpcRenderer {
  invoke(channel: string): Promise<unknown>;
  send(channel: string): void;
}

function immutableAppInfo(value: AppInfo): AppInfo {
  return Object.freeze({ ...value });
}

function immutableAttempt(value: PlatformAttemptProjection): PlatformAttemptProjection {
  return Object.freeze({ ...value });
}

function immutablePlatformSnapshot(value: PlatformSnapshot): PlatformSnapshot {
  return Object.freeze({
    ...value,
    audit: Object.freeze({ ...value.audit }),
    attempts: Object.freeze(value.attempts.map(immutableAttempt)),
  });
}

export function createActestraBridge(ipcRenderer: PreloadIpcRenderer): ActestraBridge {
  return Object.freeze({
    async getAppInfo(): Promise<AppInfo> {
      const value = await ipcRenderer.invoke(APP_INFO_CHANNEL);
      assertAppInfo(value);
      return immutableAppInfo(value);
    },
    async getPlatformSnapshot(): Promise<PlatformSnapshot> {
      const value = await ipcRenderer.invoke(PLATFORM_SNAPSHOT_CHANNEL);
      assertPlatformSnapshot(value);
      return immutablePlatformSnapshot(value);
    },
    notifyRendererReady(): void {
      ipcRenderer.send(RENDERER_READY_CHANNEL);
    },
  });
}
