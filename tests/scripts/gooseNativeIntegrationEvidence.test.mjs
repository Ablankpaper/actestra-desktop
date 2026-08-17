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
      ["artifact-admission", "integration-artifact-admission-failed"],
      ["bridge-capability-open", "integration-bridge-capability-open-failed"],
      ["bridge-config", "integration-bridge-config-failed"],
      ["bridge-model-open", "integration-bridge-model-open-failed"],
      ["bridge-open", "integration-bridge-open-failed"],
      ["bridge-port-reservation", "integration-bridge-port-reservation-failed"],
      ["bridge-socket-listen", "integration-bridge-socket-listen-failed"],
      ["bridge-socket-permission", "integration-bridge-socket-permission-failed"],
      ["bridge-socket-state", "integration-bridge-socket-state-failed"],
      ["composition-cleanup", "integration-composition-cleanup-failed"],
      ["composition-open", "integration-composition-open-failed"],
      ["handshake", "integration-handshake-failed"],
      ["handshake-cleanup", "integration-handshake-cleanup-failed"],
      ["handshake-process-exit", "integration-handshake-process-exit-failed"],
      ["handshake-process-signal", "integration-handshake-process-signal-failed"],
      ["handshake-response", "integration-handshake-response-failed"],
      ["handshake-timeout", "integration-handshake-timeout-failed"],
      ["handshake-transport", "integration-handshake-transport-failed"],
      ["handshake-transport-process", "integration-handshake-transport-process-failed"],
      ["handshake-transport-stderr", "integration-handshake-transport-stderr-failed"],
      ["handshake-transport-stdin", "integration-handshake-transport-stdin-failed"],
      ["handshake-transport-stdout", "integration-handshake-transport-stdout-failed"],
      ["initialize", "integration-initialize-failed"],
      ["launch-contract", "integration-launch-contract-failed"],
      ["runner-open", "integration-runner-open-failed"],
      ["runner-acp", "integration-runner-acp-failed"],
      ["runner-panic", "integration-runner-panic-failed"],
      ["runner-relay", "integration-runner-relay-failed"],
      ["runner-runtime", "integration-runner-runtime-failed"],
      ["runner-process-spawn", "integration-runner-process-spawn-failed"],
      ["runner-stdin", "integration-runner-stdin-failed"],
      ["runner-spawn", "integration-runner-spawn-failed"],
      ["runtime-network", "integration-runtime-network-failed"],
      ["runtime-resource", "integration-runtime-resource-failed"],
      ["session-open", "integration-session-open-failed"],
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
      { contractVersion: 1, stage: "toString" },
      { contractVersion: 1, stage: "__proto__" },
      { contractVersion: 1, stage: "/tmp/private" },
      { contractVersion: 1, stage: "prompt", detail: "/tmp/private" },
      { contractVersion: 2, stage: "prompt" },
      null,
    ]) {
      expect(classify(candidate)).toBeUndefined();
    }
  });
});
