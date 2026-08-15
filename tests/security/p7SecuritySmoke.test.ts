// @vitest-environment node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  P7_EXPECTED_RENDERER_BRIDGE_KEYS,
  P7_PACKAGED_SECURITY_CASES,
  isP7HostReadDeniedCode,
  waitForP7ProcessGone,
  summarizeP7ProviderResourceKinds,
  resolveP7SecuritySmokeIsolation,
  runP7ProviderCredentialSmoke,
  runP7RendererNetworkSmoke,
} from "../../apps/desktop/src/main/security/p7SecuritySmoke";

describe("P7 packaged security smoke contract", () => {
  it("runs the real sandbox denial probe without executing from a denied host root", async () => {
    const module = await import("../../apps/desktop/src/main/security/p7SecuritySmoke");
    const runProbe = (
      module as typeof module & {
        runP7SandboxBoundaryProbe?: (
          isolation: Readonly<{
            hostReadProbe: string;
            target: string;
          }>,
        ) => Promise<Readonly<{ hostReadDenied: boolean; networkDenied: boolean }>>;
      }
    ).runP7SandboxBoundaryProbe;
    expect(runProbe).toEqual(expect.any(Function));
    if (runProbe === undefined) return;

    const fixture = await mkdtemp(path.join(os.tmpdir(), "actestra-p7-sandbox-probe-test-"));
    try {
      const hostReadProbe = path.join(fixture, "protected-host-read.txt");
      await writeFile(hostReadProbe, "protected host bytes");

      await expect(
        runProbe({
          hostReadProbe,
          target: "http://192.0.2.1:9/p7-denied",
        }),
      ).resolves.toEqual({ hostReadDenied: true, networkDenied: true });
      await expect(readFile(hostReadProbe, "utf8")).resolves.toBe("protected host bytes");
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("kills a real E2E-only probe process group without weakening the production sandbox", async () => {
    const module = await import("../../apps/desktop/src/main/security/p7SecuritySmoke");
    const runProbe = (
      module as typeof module & {
        runP7ProcessCleanupBoundaryProbe?: () => Promise<
          Readonly<{ id: string; outcome: string; sideEffectCount: number }>
        >;
      }
    ).runP7ProcessCleanupBoundaryProbe;
    expect(runProbe).toEqual(expect.any(Function));
    if (runProbe === undefined) return;

    await expect(runProbe()).resolves.toMatchObject({
      id: "P7-A-PROCESS-002",
      outcome: "denied-safe",
      sideEffectCount: 0,
    });
  });

  it("does not signal a process group again while its leader is exiting", async () => {
    const module = await import("../../apps/desktop/src/main/security/p7SecuritySmoke");
    const runProbe = (
      module as typeof module & {
        runP7ProcessCleanupBoundaryProbe?: () => Promise<
          Readonly<{ id: string; outcome: string; sideEffectCount: number }>
        >;
      }
    ).runP7ProcessCleanupBoundaryProbe;
    expect(runProbe).toEqual(expect.any(Function));
    if (runProbe === undefined) return;

    const originalKill = process.kill.bind(process);
    let groupKillCount = 0;
    const kill = vi.spyOn(process, "kill").mockImplementation(((processId, signal) => {
      if (processId < 0 && signal === "SIGKILL") {
        groupKillCount += 1;
        if (groupKillCount === 2) {
          throw Object.assign(new Error("process group is still exiting"), { code: "EPERM" });
        }
      }
      return originalKill(processId, signal);
    }) as typeof process.kill);
    try {
      await expect(runProbe()).resolves.toMatchObject({
        id: "P7-A-PROCESS-002",
        outcome: "denied-safe",
        sideEffectCount: 0,
      });
    } finally {
      kill.mockRestore();
    }
    expect(groupKillCount).toBe(1);
  });

  it("does not confuse a live descendant with a missing process group", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    if (child.pid === undefined) throw new Error("process liveness fixture has no PID");
    try {
      await expect(waitForP7ProcessGone(child.pid, 50)).rejects.toThrow("left a descendant alive");
    } finally {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    await expect(waitForP7ProcessGone(child.pid, 50)).resolves.toBeUndefined();
  });

  it("only treats permission failures as a denied host read", () => {
    expect(isP7HostReadDeniedCode("EPERM")).toBe(true);
    expect(isP7HostReadDeniedCode("EACCES")).toBe(true);
    expect(isP7HostReadDeniedCode("EISDIR")).toBe(false);
    expect(isP7HostReadDeniedCode("ENOENT")).toBe(false);
  });

  it("keeps only physically exercised packaged cases in its closed hook", () => {
    expect(P7_PACKAGED_SECURITY_CASES).toEqual([
      "P7-A-RENDERER-002",
      "P7-A-CREDENTIAL-001",
      "P7-A-CREDENTIAL-003",
      "P7-A-WORKER-001",
      "P7-A-NETWORK-001",
      "P7-A-PROCESS-002",
      "P7-A-ARTIFACT-001",
    ]);
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

  it("requires the Main provider projection to be redacted and IPC-only", async () => {
    const safeResult = {
      providerIpcAvailable: true,
      redacted: true,
      directFetchRejected: true,
      noDirectProviderResource: true,
      providerResourceKinds: [],
      leakageCount: 0,
    };
    await expect(
      runP7ProviderCredentialSmoke({
        executeJavaScript: async () => safeResult,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "P7-A-CREDENTIAL-001", outcome: "denied-safe" }),
      expect.objectContaining({ id: "P7-A-CREDENTIAL-003", outcome: "denied-safe" }),
    ]);
    await expect(
      runP7ProviderCredentialSmoke({
        executeJavaScript: async () => ({ ...safeResult, leakageCount: 1, redacted: false }),
      }),
    ).rejects.toThrow("credential boundary was not physically denied");
  });

  it("does not count the intentionally blocked provider probe as an unexpected resource", async () => {
    expect(summarizeP7ProviderResourceKinds(["probe"])).toEqual({
      valid: true,
      providerResourceCount: 1,
      unexpectedProviderResourceCount: 0,
    });
    expect(summarizeP7ProviderResourceKinds(["probe", "unexpected"])).toEqual({
      valid: true,
      providerResourceCount: 2,
      unexpectedProviderResourceCount: 1,
    });
    expect(summarizeP7ProviderResourceKinds(["probe", "invalid"])).toMatchObject({
      valid: false,
    });

    const probeResult = {
      providerIpcAvailable: true,
      redacted: true,
      directFetchRejected: true,
      noDirectProviderResource: false,
      leakageCount: 0,
      providerResourceKinds: ["probe"],
    };
    await expect(
      runP7ProviderCredentialSmoke({
        executeJavaScript: async () => probeResult,
      }),
    ).resolves.toHaveLength(2);
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
        ACTESTRA_P7_SECURITY_SMOKE_HOST_READ_PROBE: "/tmp/p7-host/protected.txt",
        ACTESTRA_P7_SECURITY_SMOKE_TARGET: "http://192.0.2.1:12345/denied",
        ACTESTRA_P7_SECURITY_SMOKE_RUNNER_ARTIFACT_DIRECTORY: "/tmp/runner",
        ACTESTRA_P7_SECURITY_SMOKE_RUNNER_MANIFEST_SHA256: "a".repeat(64),
      }),
    ).toEqual({
      root: "/tmp/p7",
      userData: "/tmp/p7/user-data",
      home: "/tmp/p7/home",
      temp: "/tmp/p7/temp",
      sentinel: "/tmp/p7/sentinel",
      workspace: "/tmp/p7/workspace",
      evidence: "/tmp/p7/evidence",
      hostReadProbe: "/tmp/p7-host/protected.txt",
      target: "http://192.0.2.1:12345/denied",
      runnerArtifactDirectory: "/tmp/runner",
      runnerManifestSha256: "a".repeat(64),
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
        ACTESTRA_P7_SECURITY_SMOKE_HOST_READ_PROBE: "/tmp/p7-host/protected.txt",
        ACTESTRA_P7_SECURITY_SMOKE_TARGET: "http://192.0.2.1:12345/denied",
        ACTESTRA_P7_SECURITY_SMOKE_RUNNER_ARTIFACT_DIRECTORY: "/tmp/runner",
        ACTESTRA_P7_SECURITY_SMOKE_RUNNER_MANIFEST_SHA256: "a".repeat(64),
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
        ACTESTRA_P7_SECURITY_SMOKE_HOST_READ_PROBE: "/tmp/p7-host/protected.txt",
        ACTESTRA_P7_SECURITY_SMOKE_TARGET: "https://evil.example/collect",
        ACTESTRA_P7_SECURITY_SMOKE_RUNNER_ARTIFACT_DIRECTORY: "/tmp/runner",
        ACTESTRA_P7_SECURITY_SMOKE_RUNNER_MANIFEST_SHA256: "a".repeat(64),
      }),
    ).toBeNull();
  });
});
