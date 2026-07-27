export const APP_INFO_CHANNEL = "actestra:app-info";
export const RENDERER_READY_CHANNEL = "actestra:renderer-ready";

export interface AppInfo {
  readonly name: string;
  readonly version: string;
  readonly dataLayoutVersion: number;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly environment: "development" | "packaged";
  readonly networkPolicy: "offline-shell";
}

export interface ActestraBridge {
  getAppInfo(): Promise<AppInfo>;
  notifyRendererReady(): void;
}
