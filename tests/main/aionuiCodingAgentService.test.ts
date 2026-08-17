// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GooseRunnerArtifactError } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import type { IsolatedCodingMainService } from "../../apps/desktop/src/main/workers/isolatedCodingMainService";

const servicePath = path.resolve(
  import.meta.dirname,
  "../../apps/desktop/src/main/compatibility/aionuiCodingAgentService.ts",
);

async function loadServiceModule() {
  const exists = fs.existsSync(servicePath);
  expect(exists).toBe(true);
  if (!exists) {
    throw new Error("AionUI coding-agent service is not implemented");
  }
  return import("../../apps/desktop/src/main/compatibility/aionuiCodingAgentService");
}

const mainService = {} as IsolatedCodingMainService;
const artifact = Object.freeze({
  directory: "/private/tmp/actestra-goose-runner",
  executablePath: "/private/tmp/actestra-goose-runner/actestra-goose-runner",
  executableSha256: "a".repeat(64),
  executableSize: 1,
  targetTriple: "aarch64-apple-darwin",
  gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseVersion: "1.45.0",
  manifestPath: "/private/tmp/actestra-goose-runner/actestra-goose-runner.manifest.json",
  manifestSha256: "b".repeat(64),
}) satisfies AdmittedGooseRunnerArtifact;

const admission = Object.freeze({
  directory: artifact.directory,
  trustedManifestSha256: artifact.manifestSha256,
  expectedTargetTriple: artifact.targetTriple,
});

describe("AionUI coding-agent readiness service", () => {
  it("reuses the startup-admitted artifact and revalidates it only on an explicit probe", async () => {
    const { AionUiCodingAgentService } = await loadServiceModule();
    const admitRunnerArtifact = vi.fn(async () => artifact);
    const service = new AionUiCodingAgentService(
      {
        getMainService: () => mainService,
        runnerAdmission: admission,
        admittedArtifact: artifact,
      },
      { admitRunnerArtifact },
    );

    await expect(service.status()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    await expect(service.requireAdmittedArtifact()).resolves.toBe(artifact);
    expect(admitRunnerArtifact).not.toHaveBeenCalled();

    await expect(service.probe()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    expect(admitRunnerArtifact).toHaveBeenCalledOnce();
  });

  it("admits the exact runner once for status and refreshes only on an explicit probe", async () => {
    const { AionUiCodingAgentService } = await loadServiceModule();
    const admitRunnerArtifact = vi.fn(async () => artifact);
    const service = new AionUiCodingAgentService(
      {
        getMainService: () => mainService,
        runnerAdmission: admission,
      },
      { admitRunnerArtifact },
    );

    await expect(service.status()).resolves.toEqual({
      contractVersion: 1,
      agentId: "actestra-goose",
      displayName: "Goose coding",
      status: "ready",
      runnerVersion: "1.45.0",
    });
    await expect(service.status()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    expect(admitRunnerArtifact).toHaveBeenCalledTimes(1);
    expect(admitRunnerArtifact).toHaveBeenCalledWith(artifact.directory, {
      trustedManifestSha256: artifact.manifestSha256,
      expectedTargetTriple: artifact.targetTriple,
    });
    await expect(service.requireAdmittedArtifact()).resolves.toBe(artifact);
    expect(admitRunnerArtifact).toHaveBeenCalledTimes(1);

    await expect(service.probe()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    expect(admitRunnerArtifact).toHaveBeenCalledTimes(2);
  });

  it("revalidates a packaged Linux attestation before an actual coding submission", async () => {
    const { AionUiCodingAgentService } = await loadServiceModule();
    const linuxInstall = Object.freeze({
      contractVersion: 1 as const,
      resourcesPath: "/opt/Actestra/resources" as const,
      executablePath:
        "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner" as const,
      runnerManifestSha256: artifact.manifestSha256,
      executableSha256: artifact.executableSha256,
      profileSha256: "c".repeat(64),
    });
    const packagedArtifact = Object.freeze({ ...artifact, linuxInstall });
    const revalidateArtifact = vi.fn(async () => packagedArtifact);
    const service = new AionUiCodingAgentService({
      getMainService: () => mainService,
      runnerAdmission: admission,
      admittedArtifact: packagedArtifact,
      revalidateArtifact,
    });

    await expect(service.status()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    await expect(service.probe()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    expect(revalidateArtifact).toHaveBeenCalledOnce();
    await expect(service.requireAdmittedArtifact()).resolves.toBe(packagedArtifact);
    expect(revalidateArtifact).toHaveBeenCalledTimes(2);
  });

  it("reports main and runner availability without exposing private paths or digests", async () => {
    const { AionUiCodingAgentService } = await loadServiceModule();
    const admitRunnerArtifact = vi.fn(async () => artifact);
    const mainUnavailable = new AionUiCodingAgentService(
      {
        getMainService: () => null,
        runnerAdmission: admission,
      },
      { admitRunnerArtifact },
    );
    const runnerUnconfigured = new AionUiCodingAgentService(
      {
        getMainService: () => mainService,
      },
      { admitRunnerArtifact },
    );

    await expect(mainUnavailable.status()).resolves.toEqual({
      contractVersion: 1,
      agentId: "actestra-goose",
      displayName: "Goose coding",
      status: "unavailable",
      reason: "main-unavailable",
    });
    await expect(runnerUnconfigured.status()).resolves.toEqual({
      contractVersion: 1,
      agentId: "actestra-goose",
      displayName: "Goose coding",
      status: "missing",
      reason: "runner-not-configured",
    });
    expect(admitRunnerArtifact).not.toHaveBeenCalled();
    expect(JSON.stringify(await mainUnavailable.status())).not.toContain("private");
    expect(JSON.stringify(await runnerUnconfigured.status())).not.toContain("sha256");
  });

  it.each([
    ["missing-artifact", "missing", "runner-missing"],
    ["invalid-manifest", "incompatible", "runner-incompatible"],
    ["incompatible-artifact", "incompatible", "runner-incompatible"],
    ["digest-mismatch", "incompatible", "runner-incompatible"],
    ["invalid-sbom", "incompatible", "runner-incompatible"],
    ["unsafe-audit", "incompatible", "runner-incompatible"],
  ] as const)("maps artifact error %s to a closed native status", async (code, status, reason) => {
    const { AionUiCodingAgentService } = await loadServiceModule();
    const service = new AionUiCodingAgentService(
      {
        getMainService: () => mainService,
        runnerAdmission: admission,
      },
      {
        admitRunnerArtifact: vi.fn(async () => {
          throw new GooseRunnerArtifactError(code, "private runner failure");
        }),
      },
    );

    await expect(service.status()).resolves.toEqual({
      contractVersion: 1,
      agentId: "actestra-goose",
      displayName: "Goose coding",
      status,
      reason,
    });
    await expect(service.requireAdmittedArtifact()).rejects.toMatchObject({
      name: "AionUiCodingAgentServiceError",
      code: "not-ready",
    });
  });

  it("fails closed for an unknown admission failure and retries on probe", async () => {
    const { AionUiCodingAgentService } = await loadServiceModule();
    const admitRunnerArtifact = vi
      .fn<() => Promise<AdmittedGooseRunnerArtifact>>()
      .mockRejectedValueOnce(new Error("private failure"))
      .mockResolvedValueOnce(artifact);
    const service = new AionUiCodingAgentService(
      {
        getMainService: () => mainService,
        runnerAdmission: admission,
      },
      { admitRunnerArtifact },
    );

    await expect(service.status()).resolves.toEqual({
      contractVersion: 1,
      agentId: "actestra-goose",
      displayName: "Goose coding",
      status: "incompatible",
      reason: "runner-admission-failed",
    });
    await expect(service.probe()).resolves.toEqual(expect.objectContaining({ status: "ready" }));
    expect(admitRunnerArtifact).toHaveBeenCalledTimes(2);
  });
});
