// @vitest-environment node

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  GOOSE_WINDOWS_RUNTIME_EVIDENCE_KEYS,
  classifyGooseWindowsRuntimeFailureEvidence,
  validateGooseWindowsRuntimeEvidence,
} from "../../scripts/gooseWindowsRuntimeEvidence.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const binding = Object.freeze({
  targetTriple: "x86_64-pc-windows-msvc",
  sourceCommit: "a".repeat(40),
  gooseBaseCommit: "b".repeat(40),
  gooseRuntimeCommit: "c".repeat(40),
  goosePatchSha256: "d".repeat(64),
  manifestSha256: "e".repeat(64),
  executableSha256: "f".repeat(64),
  containmentEvidenceSha256: "1".repeat(64),
});

function validEvidence() {
  return {
    schemaVersion: 1,
    status: "verified",
    targetTriple: binding.targetTriple,
    sourceCommit: binding.sourceCommit,
    gooseBaseCommit: binding.gooseBaseCommit,
    gooseRuntimeCommit: binding.gooseRuntimeCommit,
    goosePatchSha256: binding.goosePatchSha256,
    manifestSha256: binding.manifestSha256,
    executableSha256: binding.executableSha256,
    containmentEvidenceSha256: binding.containmentEvidenceSha256,
    acpInitialized: true,
    mcpFreeSessionCreated: true,
    exactToolCount: 6,
    readToolCompleted: true,
    approvedWriteToolCompleted: true,
    cancellationObserved: true,
    parentDeathCleanupObserved: true,
    credentialCanaryAbsent: true,
    environmentCanaryAbsent: true,
    directNetworkDenied: true,
    originalWorkspaceUnchanged: true,
    residualProcessCount: 0,
  };
}

describe("Goose Windows runtime evidence", () => {
  it("accepts only the complete verified record bound to one exact Artifact", () => {
    expect(validateGooseWindowsRuntimeEvidence(validEvidence(), binding)).toEqual({ ok: true });
    expect(Object.keys(validEvidence()).sort()).toEqual([...GOOSE_WINDOWS_RUNTIME_EVIDENCE_KEYS]);
  });

  it.each([
    ["extra key", { prompt: "private task" }],
    ["false outcome", { approvedWriteToolCompleted: false }],
    ["wrong tool count", { exactToolCount: 5 }],
    ["residual process", { residualProcessCount: 1 }],
    ["wrong target", { targetTriple: "aarch64-pc-windows-msvc" }],
    ["raw path", { manifestSha256: "C:\\Users\\secret\\manifest.json" }],
    ["raw PID", { pid: 8124 }],
    ["raw SID", { sid: "S-1-15-2-private" }],
    ["pipe name", { pipeName: "\\\\.\\pipe\\LOCAL\\Actestra.Goose.private" }],
    ["API key", { apiKey: "sk-private" }],
    ["tool arguments", { toolArguments: { path: "private.txt" } }],
    ["raw error", { error: "CreateProcess failed at C:\\private" }],
  ])("rejects %s with a closed result", (_label, mutation) => {
    const result = validateGooseWindowsRuntimeEvidence(
      { ...validEvidence(), ...mutation },
      binding,
    );
    expect(result).toEqual({ ok: false, code: "invalid-windows-runtime-evidence" });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects a missing required outcome", () => {
    const evidence = validEvidence();
    delete evidence.parentDeathCleanupObserved;
    expect(validateGooseWindowsRuntimeEvidence(evidence, binding)).toEqual({
      ok: false,
      code: "invalid-windows-runtime-evidence",
    });
  });

  it("rejects an exact Artifact binding mismatch without echoing the mismatch", () => {
    expect(
      validateGooseWindowsRuntimeEvidence(validEvidence(), {
        ...binding,
        executableSha256: "2".repeat(64),
      }),
    ).toEqual({ ok: false, code: "windows-runtime-artifact-mismatch" });
  });

  it("maps only closed Windows runtime failure stages", () => {
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage: "composition-open" }),
    ).toBe("windows-runtime-composition-open-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage: "parent-death" }),
    ).toBe("windows-runtime-parent-death-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage: "private-path" }),
    ).toBeUndefined();
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "composition-open",
        path: "C:\\private",
      }),
    ).toBeUndefined();
  });

  it("registers a bounded exact-artifact Windows runtime runner", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    );
    const runnerPath = path.join(repositoryRoot, "scripts/run-goose-runner-windows-runtime.mjs");
    const vitest = fs.readFileSync(path.join(repositoryRoot, "vitest.config.ts"), "utf8");

    expect(packageJson.scripts["goose:runner:integration:windows"]).toBe(
      "node scripts/run-goose-runner-windows-runtime.mjs",
    );
    expect(fs.existsSync(runnerPath)).toBe(true);
    if (!fs.existsSync(runnerPath)) return;
    const runner = fs.readFileSync(runnerPath, "utf8");
    expect(runner).toContain("goose:runner:admit-build");
    expect(runner).toContain("ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_PATH");
    expect(runner).toContain("gooseRunnerWindowsNative.integration.ts");
    expect(runner).toContain("validateGooseWindowsRuntimeEvidence");
    expect(runner).toContain("classifyGooseWindowsRuntimeFailureEvidence");
    expect(runner).toContain("readFailureCode");
    expect(runner).not.toContain('stdio: "inherit"');
    expect(vitest).toContain("nativeWindowsGooseIntegrationFiles");
    expect(vitest).toContain('"tests/main/gooseRunnerWindowsNative.integration.ts"');
    expect(vitest).toContain('ACTESTRA_GOOSE_WINDOWS_RUNTIME_INTEGRATION === "1"');
  });
});
