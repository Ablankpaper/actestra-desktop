// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

describe("P8.2 packaged product-journey downstream composition", () => {
  it("declares one reversible Main-owned R1/R2 patch and exact source copy", () => {
    const overlay = JSON.parse(read("downstream/aionui-v2.1.41/overlay.json"));
    expect(
      overlay.patches.find(
        (entry) => entry.path === "patches/0024-actestra-p8-product-journey-smoke.mjs",
      ),
    ).toMatchObject({
      classification: ["R1", "R2"],
      domains: expect.arrayContaining([
        "packaged Main product journeys",
        "P8.2 bounded journey evidence",
        "journey cleanup and recovery",
      ]),
      authorityOwner: expect.stringContaining("Actestra Main"),
      rollback: expect.stringContaining("Regenerate without patch 0024"),
    });
    expect(overlay.sourceCopies).toContainEqual({
      source: "apps/desktop/src/main/security/p8ProductJourneySmoke.ts",
      destination: "packages/desktop/src/actestra/main/security/p8ProductJourneySmoke.ts",
    });
  });

  it("is packaged-only, waits for recovered authorities, and runs all nine real callbacks", () => {
    const patch = read(
      "downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs",
    );
    for (const fragment of [
      "parseP8ProductJourneySmokeEnvironment",
      "createP8ProductJourneyCoordinator",
      "writeP8ProductJourneyResult",
      "ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE",
      "app.isPackaged",
      "await generalWorkRecoveryPromise",
      "scheduleRecovered",
      "p8-product-journeys-result.json",
      "fresh-profile-launch",
      "general-artifact",
      "goose-isolated-patch",
      "workspace-apply-approval",
      "general-goose-team",
      "cancellation-no-orphan",
      "crash-restart-recovery",
      "privacy-redaction",
      "p7-platform-obligations",
      "generalWorkJourneyService",
      "codingJourneyService",
      "codingArtifactService",
      "isolatedCodingMainService",
      "teamComposition",
      "runP7PackagedSecuritySmoke",
      "runP7PackagedResourceReliabilitySmoke",
      "runP7PackagedDiagnosticAuditSmoke",
      "ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE",
      "P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME",
      "let p8ProductJourneyFailureStage: 'startup-recovery' | P8ProductJourneyId = 'startup-recovery'",
      "writeP8ProductJourneyFailure",
      "? 'hold'",
      "app.quit()",
    ]) {
      expect(patch).toContain(fragment);
    }
    expect(patch).not.toMatch(/(?:unavailable|evidence-incomplete).*verified/iu);
    expect(patch).not.toContain("runGeneralArtifact: unavailable");
    expect(patch).not.toContain("runCancellationNoOrphan: unavailable");
    expect(patch).not.toContain("runCrashRestartRecovery: unavailable");
    expect(patch).not.toContain("runPrivacyRedaction: unavailable");
    expect(patch).not.toContain("runP7PlatformObligations: unavailable");
  });

  it("adds no Renderer, preload, generic IPC, credential, or source-workspace authority", () => {
    const patch = read(
      "downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs",
    );
    expect(patch).not.toMatch(/contextBridge|ipcRenderer|ipcMain\.handle|api[_-]?key|password/iu);
    expect(patch).not.toMatch(/packages\/desktop\/src\/(?:renderer|preload)\//u);
    expect(patch).not.toContain("foundation/");
    expect(patch).not.toContain("process.cwd()");
    expect(patch).toContain("ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE");
    expect(patch).toContain("p8ProductJourneyFailureStage");
    expect(patch).toContain("stage: p8ProductJourneyFailureStage");
  });

  it("starts after renderer load and awaits completion before graceful exit", () => {
    const patch = read(
      "downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs",
    );
    const loaded = patch.indexOf("did-finish-load");
    const started = patch.indexOf("await startP8ProductJourneySmoke()");
    const write = patch.indexOf("writeP8ProductJourneyResult");
    const quit = patch.lastIndexOf("app.quit()");
    expect(loaded).toBeGreaterThanOrEqual(0);
    expect(started).toBeGreaterThan(loaded);
    expect(write).toBeGreaterThanOrEqual(0);
    expect(quit).toBeGreaterThan(write);
  });

  it("writes a bounded private failure file before quitting", () => {
    const patch = read(
      "downstream/aionui-v2.1.41/patches/0024-actestra-p8-product-journey-smoke.mjs",
    );
    expect(patch).toContain("writeP8ProductJourneyFailure");
    expect(patch).toContain("P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME");
    expect(patch.indexOf("writeP8ProductJourneyFailure")).toBeLessThan(
      patch.lastIndexOf("app.quit()"),
    );
  });
});
