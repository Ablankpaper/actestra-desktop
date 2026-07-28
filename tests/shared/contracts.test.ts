import { describe, expect, it } from "vitest";
import {
  PLATFORM_SNAPSHOT_CONTRACT_VERSION,
  assertAppInfo,
  assertPlatformSnapshot,
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

function createPlatformSnapshot(overrides: Partial<PlatformSnapshot> = {}): PlatformSnapshot {
  return {
    contractVersion: PLATFORM_SNAPSHOT_CONTRACT_VERSION,
    authority: "main-only",
    privilegedServices: "registered-inert",
    policy: "deny-by-default",
    credentials: "opaque-references-only",
    tools: "disabled",
    audit: {
      durability: "sqlite-metadata-only",
      recordCount: 1,
      lastSequence: 1,
    },
    attempts: [
      {
        sessionId: "session-platform",
        workerId: "worker-platform",
        state: "completed",
        taskState: "completed",
        lastCoreEventSequence: 2,
        forcedCancellation: false,
      },
    ],
    ...overrides,
  };
}

describe("desktop shared contracts", () => {
  it("accepts exact application and bounded platform snapshots", () => {
    expect(() => assertAppInfo(APP_INFO)).not.toThrow();
    expect(() => assertPlatformSnapshot(createPlatformSnapshot())).not.toThrow();
  });

  it("rejects unsupported fields and impossible audit summaries", () => {
    expect(() =>
      assertAppInfo({
        ...APP_INFO,
        userDataPath: "/private/path",
      }),
    ).toThrow(/unsupported field userDataPath/i);
    expect(() =>
      assertPlatformSnapshot(
        createPlatformSnapshot({
          audit: {
            durability: "sqlite-metadata-only",
            recordCount: 0,
            lastSequence: 1,
          },
        }),
      ),
    ).toThrow(/audit/i);
  });

  it("bounds renderer attempt projections", () => {
    const attempt = createPlatformSnapshot().attempts[0];
    expect(attempt).toBeDefined();
    expect(() =>
      assertPlatformSnapshot(
        createPlatformSnapshot({
          attempts: Array.from({ length: 51 }, () => attempt!),
        }),
      ),
    ).toThrow(/at most 50/i);
  });

  it("rejects non-array and duplicate renderer attempt projections", () => {
    expect(() =>
      assertPlatformSnapshot(
        createPlatformSnapshot({
          attempts: "not-an-array" as unknown as PlatformSnapshot["attempts"],
        }),
      ),
    ).toThrow(/must be an array/i);

    const attempt = createPlatformSnapshot().attempts[0];
    expect(attempt).toBeDefined();
    expect(() =>
      assertPlatformSnapshot(
        createPlatformSnapshot({
          attempts: [attempt!, { ...attempt! }],
        }),
      ),
    ).toThrow(/repeat a session/i);
  });
});
