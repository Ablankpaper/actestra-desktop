// @vitest-environment node

import { describe, expect, it } from "vitest";
import * as nativeIntegrationEvidence from "../../scripts/gooseNativeIntegrationEvidence.mjs";

const { validateGooseNativeIntegrationEvidence, GOOSE_NATIVE_INTEGRATION_EVIDENCE_KEYS } =
  nativeIntegrationEvidence;

const binding = Object.freeze({
  targetTriple: "x86_64-unknown-linux-gnu",
  sourceCommit: "a".repeat(40),
  executableSha256: "b".repeat(64),
});

function validEvidence() {
  return {
    contractVersion: 1,
    targetTriple: binding.targetTriple,
    sourceCommit: binding.sourceCommit,
    executableSha256: binding.executableSha256,
    initialize: true,
    openSession: true,
    toolDiscovery: true,
    prompt: true,
    toolDenial: true,
    cancellation: true,
    crashRestart: true,
    parentDeath: true,
    cleanup: true,
    status: "verified",
  };
}

describe("Goose native integration evidence", () => {
  it("accepts exactly the nine verified outcomes bound to one Artifact", () => {
    expect(validateGooseNativeIntegrationEvidence(validEvidence(), binding)).toEqual({ ok: true });
    expect(Object.keys(validEvidence()).sort()).toEqual([
      ...GOOSE_NATIVE_INTEGRATION_EVIDENCE_KEYS,
    ]);
  });

  it.each([
    ["extra key", { extra: true }],
    ["false capability", { prompt: false }],
    ["wrong target", { targetTriple: "x86_64-unknown-linux-musl" }],
    ["wrong source", { sourceCommit: "c".repeat(40) }],
    ["wrong executable", { executableSha256: "d".repeat(64) }],
    ["raw path", { sourceCommit: "/tmp/secret" }],
  ])("rejects %s without exposing a path or raw diagnostic", (_label, mutation) => {
    const candidate = { ...validEvidence(), ...mutation };
    const result = validateGooseNativeIntegrationEvidence(candidate, binding);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("/tmp/secret");
    expect(JSON.stringify(result)).not.toContain("x86_64-unknown-linux-musl");
  });

  it("rejects an actually missing outcome key", () => {
    const candidate = validEvidence();
    delete candidate.cleanup;

    expect(validateGooseNativeIntegrationEvidence(candidate, binding)).toEqual({
      ok: false,
      code: "invalid-integration-evidence",
    });
  });

  it("rejects mismatched Artifact identity with a closed code", () => {
    expect(
      validateGooseNativeIntegrationEvidence(validEvidence(), {
        ...binding,
        executableSha256: "e".repeat(64),
      }),
    ).toEqual({ ok: false, code: "integration-artifact-mismatch" });
  });

  it("classifies only exact closed failure-stage evidence", () => {
    const classify = nativeIntegrationEvidence.classifyGooseNativeIntegrationFailureEvidence;
    expect(typeof classify).toBe("function");
    if (typeof classify !== "function") return;

    for (const [stage, code] of [
      ["initialize", "integration-initialize-failed"],
      ["tool-discovery", "integration-tool-discovery-failed"],
      ["prompt", "integration-prompt-failed"],
      ["tool-denial", "integration-tool-denial-failed"],
      ["cancellation", "integration-cancellation-failed"],
      ["crash", "integration-crash-failed"],
      ["restart", "integration-restart-failed"],
      ["parent-death", "integration-parent-death-failed"],
      ["cleanup", "integration-cleanup-failed"],
    ]) {
      expect(classify({ contractVersion: 1, stage })).toBe(code);
    }
    for (const candidate of [
      { contractVersion: 1, stage: "invented" },
      { contractVersion: 1, stage: "/tmp/private" },
      { contractVersion: 1, stage: "prompt", detail: "/tmp/private" },
      { contractVersion: 2, stage: "prompt" },
      null,
    ]) {
      expect(classify(candidate)).toBeUndefined();
    }
  });
});
