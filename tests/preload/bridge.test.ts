import { describe, expect, it, vi } from "vitest";
import { createActestraBridge } from "../../apps/desktop/src/preload/bridge";
import {
  APP_INFO_CHANNEL,
  PLATFORM_SNAPSHOT_CHANNEL,
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  RENDERER_READY_CHANNEL,
  type AppInfo,
  type PlatformSnapshot,
} from "../../apps/desktop/src/shared/contracts";

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

describe("preload bridge allowlist", () => {
  it("exposes exactly three frozen typed intents on fixed channels", async () => {
    const invoke = vi.fn((channel: string) =>
      Promise.resolve(channel === APP_INFO_CHANNEL ? APP_INFO : PLATFORM_SNAPSHOT),
    );
    const send = vi.fn();
    const bridge = createActestraBridge({ invoke, send });

    expect(Object.keys(bridge).sort()).toEqual([
      "getAppInfo",
      "getPlatformSnapshot",
      "notifyRendererReady",
    ]);
    expect(Object.isFrozen(bridge)).toBe(true);
    await expect(bridge.getAppInfo()).resolves.toEqual(APP_INFO);
    await expect(bridge.getPlatformSnapshot()).resolves.toEqual(PLATFORM_SNAPSHOT);
    bridge.notifyRendererReady();

    expect(invoke).toHaveBeenNthCalledWith(1, APP_INFO_CHANNEL);
    expect(invoke).toHaveBeenNthCalledWith(2, PLATFORM_SNAPSHOT_CHANNEL);
    expect(send).toHaveBeenCalledWith(RENDERER_READY_CHANNEL);
  });

  it("rejects an invalid main response instead of widening the bridge", async () => {
    const bridge = createActestraBridge({
      invoke: vi.fn().mockResolvedValue({
        ...APP_INFO,
        databasePath: "/private/database",
      }),
      send: vi.fn(),
    });

    await expect(bridge.getAppInfo()).rejects.toMatchObject({
      name: "DesktopContractError",
      code: "invalid-response",
    });
  });
});
