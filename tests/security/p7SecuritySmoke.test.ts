import { describe, expect, it } from "vitest";
import {
  P7_EXPECTED_RENDERER_BRIDGE_KEYS,
  P7_PACKAGED_SECURITY_CASES,
  resolveP7SecuritySmokeIsolation,
  runP7RendererNetworkSmoke,
} from "../../apps/desktop/src/main/security/p7SecuritySmoke";

describe("P7 packaged security smoke contract", () => {
  it("keeps only physically exercised packaged cases in its closed hook", () => {
    expect(P7_PACKAGED_SECURITY_CASES).toEqual(["P7-A-RENDERER-002"]);
  });

  it("requires physical Renderer denials before returning evidence", async () => {
    await expect(
      runP7RendererNetworkSmoke({
        executeJavaScript: async () => ({
          exactBridgeKeys: [...P7_EXPECTED_RENDERER_BRIDGE_KEYS],
          hasNodeAuthority: false,
          fetchRejected: true,
          socketRejected: true,
          eventSourceRejected: true,
          xhrRejected: true,
          guest: {
            hasNodeAuthority: false,
            fetchRejected: true,
          },
        }),
      }),
    ).resolves.toMatchObject({ id: "P7-A-RENDERER-002", outcome: "denied-safe" });
    await expect(
      runP7RendererNetworkSmoke({
        executeJavaScript: async () => ({
          exactBridgeKeys: [...P7_EXPECTED_RENDERER_BRIDGE_KEYS],
          hasNodeAuthority: false,
          fetchRejected: false,
          socketRejected: true,
          eventSourceRejected: true,
          xhrRejected: true,
          guest: {
            hasNodeAuthority: false,
            fetchRejected: true,
          },
        }),
      }),
    ).rejects.toThrow("not physically denied");
    await expect(
      runP7RendererNetworkSmoke({
        executeJavaScript: async () => ({
          exactBridgeKeys: [...P7_EXPECTED_RENDERER_BRIDGE_KEYS, "unexpectedRawBridge"],
          hasNodeAuthority: false,
          fetchRejected: true,
          socketRejected: true,
          eventSourceRejected: false,
          xhrRejected: true,
          guest: {
            hasNodeAuthority: false,
            fetchRejected: true,
          },
        }),
      }),
    ).rejects.toThrow("not physically denied");
    await expect(
      runP7RendererNetworkSmoke({
        executeJavaScript: async () => ({
          exactBridgeKeys: [...P7_EXPECTED_RENDERER_BRIDGE_KEYS],
          hasNodeAuthority: false,
          fetchRejected: true,
          socketRejected: true,
          eventSourceRejected: true,
          xhrRejected: true,
          guest: {
            hasNodeAuthority: true,
            fetchRejected: true,
          },
        }),
      }),
    ).rejects.toThrow("not physically denied");
    await expect(
      runP7RendererNetworkSmoke({
        executeJavaScript: async () => ({
          exactBridgeKeys: [...P7_EXPECTED_RENDERER_BRIDGE_KEYS],
          hasNodeAuthority: false,
          fetchRejected: true,
          socketRejected: true,
          eventSourceRejected: true,
          xhrRejected: true,
          guest: {
            hasNodeAuthority: false,
            fetchRejected: false,
          },
        }),
      }),
    ).rejects.toThrow("not physically denied");
  });

  it("requires the complete E2E isolation contract", () => {
    expect(
      resolveP7SecuritySmokeIsolation({
        ACTESTRA_P7_SECURITY_SMOKE: "1",
        ACTESTRA_E2E_TEST: "1",
        ACTESTRA_E2E_ISOLATION_ROOT: "/tmp/p7",
        ACTESTRA_USER_DATA_DIR: "/tmp/p7/user-data",
        ACTESTRA_E2E_HOME_DIR: "/tmp/p7/home",
        ACTESTRA_E2E_TEMP_DIR: "/tmp/p7/temp",
        ACTESTRA_P7_SECURITY_SMOKE_SENTINEL: "/tmp/p7/sentinel",
        ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE: "/tmp/p7/workspace",
        ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE: "/tmp/p7/evidence",
        ACTESTRA_P7_SECURITY_SMOKE_TARGET: "http://192.0.2.1:12345/denied",
      }),
    ).toEqual({
      root: "/tmp/p7",
      userData: "/tmp/p7/user-data",
      home: "/tmp/p7/home",
      temp: "/tmp/p7/temp",
      sentinel: "/tmp/p7/sentinel",
      workspace: "/tmp/p7/workspace",
      evidence: "/tmp/p7/evidence",
      target: "http://192.0.2.1:12345/denied",
    });
    expect(
      resolveP7SecuritySmokeIsolation({
        ACTESTRA_P7_SECURITY_SMOKE: "1",
        ACTESTRA_E2E_TEST: "1",
        ACTESTRA_E2E_ISOLATION_ROOT: "/tmp/p7",
        ACTESTRA_USER_DATA_DIR: "/outside/user-data",
        ACTESTRA_E2E_HOME_DIR: "/tmp/p7/home",
        ACTESTRA_E2E_TEMP_DIR: "/tmp/p7/temp",
        ACTESTRA_P7_SECURITY_SMOKE_SENTINEL: "/tmp/p7/sentinel",
        ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE: "/outside/workspace",
        ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE: "/tmp/p7/evidence",
        ACTESTRA_P7_SECURITY_SMOKE_TARGET: "http://192.0.2.1:12345/denied",
      }),
    ).toBeNull();
    expect(
      resolveP7SecuritySmokeIsolation({
        ACTESTRA_P7_SECURITY_SMOKE: "1",
        ACTESTRA_E2E_TEST: "0",
      }),
    ).toBeNull();
    expect(
      resolveP7SecuritySmokeIsolation({
        ACTESTRA_P7_SECURITY_SMOKE: "1",
        ACTESTRA_E2E_TEST: "1",
        ACTESTRA_E2E_ISOLATION_ROOT: "/tmp/p7",
        ACTESTRA_USER_DATA_DIR: "/tmp/p7/user-data",
        ACTESTRA_E2E_HOME_DIR: "/tmp/p7/home",
        ACTESTRA_E2E_TEMP_DIR: "/tmp/p7/temp",
        ACTESTRA_P7_SECURITY_SMOKE_SENTINEL: "/tmp/p7/sentinel",
        ACTESTRA_P7_SECURITY_SMOKE_WORKSPACE: "/tmp/p7/workspace",
        ACTESTRA_P7_SECURITY_SMOKE_EVIDENCE: "/tmp/p7/evidence",
        ACTESTRA_P7_SECURITY_SMOKE_TARGET: "https://evil.example/collect",
      }),
    ).toBeNull();
  });
});
