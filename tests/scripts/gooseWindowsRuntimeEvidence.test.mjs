// @vitest-environment node

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  GOOSE_WINDOWS_RUNTIME_EVIDENCE_KEYS,
  classifyGooseWindowsCodingSessionOpenError,
  classifyGooseWindowsOpeningFailure,
  classifyGooseWindowsArtifactAdmissionExecution,
  classifyGooseWindowsArtifactAdmissionFailure,
  classifyGooseWindowsRuntimeFailureEvidence,
  classifyGooseWindowsRuntimeChildFailure,
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
  it("classifies opening failures by fixed sub-stage without retaining diagnostics", () => {
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpHandshakeError",
        code: "startup-timeout",
        message: "fixed internal diagnostic",
      }),
    ).toBe("handshake-timeout");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "session-timeout",
        message: "fixed internal diagnostic",
      }),
    ).toBe("session-timeout");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "invalid-session-options",
        message: "fixed internal diagnostic",
      }),
    ).toBe("session-invalid-options");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "session-already-open",
        message: "fixed internal diagnostic",
      }),
    ).toBe("session-already-open");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "session-closed",
        message: "fixed internal diagnostic",
      }),
    ).toBe("session-closed");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "prompt-rejected",
        message: "fixed internal diagnostic",
      }),
    ).toBe("prompt-rejected");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "prompt-timeout",
        message: "fixed internal diagnostic",
      }),
    ).toBe("prompt-timeout");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "prompt-already-requested",
        message: "fixed internal diagnostic",
      }),
    ).toBe("prompt-already-requested");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "session-rejected",
        message: "fixed internal diagnostic",
      }),
    ).toBe("session-rejected");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseAcpSessionError",
        code: "invalid-session-message",
        message: "fixed internal diagnostic",
      }),
    ).toBe("session-message-invalid");
    for (const [code, stage] of [
      ["windows-composition-runner-open-failed", "windows-composition-runner-open-failed"],
      ["windows-composition-session-open-failed", "windows-composition-session-open-failed"],
      ["windows-composition-session-bind-failed", "windows-composition-session-bind-failed"],
      [
        "windows-composition-capability-tools-list-failed",
        "windows-composition-capability-tools-list-failed",
      ],
      ["windows-composition-tool-discovery-failed", "windows-composition-tool-discovery-failed"],
      [
        "windows-composition-tool-normalization-failed",
        "windows-composition-tool-normalization-failed",
      ],
    ]) {
      expect(
        classifyGooseWindowsOpeningFailure({
          name: "GooseMcpSessionCompositionError",
          code,
          message: "fixed internal diagnostic",
        }),
      ).toBe(stage);
    }
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseMcpSessionCompositionError",
        code: "model-completion-refused",
        message: "fixed internal diagnostic",
      }),
    ).toBe("model-completion-refused");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseMcpSessionCompositionError",
        code: "model-request-rejected",
        message: "fixed internal diagnostic",
      }),
    ).toBe("model-request-rejected");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-control-frame-invalid",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-control-frame-invalid");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-boundary-verification-failed",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-boundary-verification-failed");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-runtime-creation-failed",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-runtime-creation-failed");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-model-bridge-failed",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-model-bridge-failed");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-state-directory-failed",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-state-directory-failed");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-ready-signal-failed",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-ready-signal-failed");
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "windows-worker-acp-handshake-failed",
        message: "Goose Windows worker startup failed",
      }),
    ).toBe("windows-worker-acp-handshake-failed");
    for (const [code, stage] of [
      ["windows-worker-acp-entry-failed", "windows-worker-acp-entry-failed"],
      ["windows-worker-agent-creation-failed", "windows-worker-agent-creation-failed"],
      ["windows-worker-serve-failed", "windows-worker-serve-failed"],
      ["windows-worker-acp-connect-failed", "windows-worker-acp-connect-failed"],
    ]) {
      expect(
        classifyGooseWindowsOpeningFailure({
          name: "GooseMcpSessionCompositionError",
          code,
          message: "fixed internal diagnostic",
        }),
      ).toBe(stage);
    }
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseRunnerProcessError",
        code: "spawn-failed",
        message: "Goose handshake launch failed",
        cause: {
          name: "GooseAcpHandshakeError",
          code: "transport-error",
          message: "fixed internal diagnostic",
          cause: {
            name: "GooseRunnerProcessError",
            code: "network-policy-unavailable",
            message: "C:\\private\\secret",
          },
        },
      }),
    ).toBe("runtime-network");
    expect(
      JSON.stringify(classifyGooseWindowsOpeningFailure({ error: "C:\\private" })),
    ).not.toContain("private");
  });
  it("prefers the specific nested coding-session cause over the outer open-failed wrapper", () => {
    expect(
      classifyGooseWindowsCodingSessionOpenError({
        code: "open-failed",
        cause: new AggregateError([{ code: "repository-invalid" }, { code: "unrelated" }]),
      }),
    ).toBe("coding-session-open-repository-invalid");
    expect(classifyGooseWindowsCodingSessionOpenError({ code: "open-failed" })).toBe(
      "coding-session-open-persistence-failed",
    );
    expect(classifyGooseWindowsCodingSessionOpenError({ code: "unknown" })).toBe(
      "coding-session-open",
    );
  });

  it("maps each worker startup stage to a distinct final evidence token", () => {
    const stages = [
      "windows-worker-control-frame-invalid",
      "windows-worker-boundary-verification-failed",
      "windows-worker-runtime-creation-failed",
      "windows-worker-capability-bridge-failed",
      "windows-worker-model-bridge-failed",
      "windows-worker-state-directory-failed",
      "windows-worker-ready-signal-failed",
      "windows-worker-acp-handshake-failed",
    ];
    const tokens = stages.map((stage) =>
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage }),
    );
    expect(new Set(tokens).size).toBe(8);
    expect(tokens.every((token) => typeof token === "string" && token.length > 0)).toBe(true);
    expect(tokens.every((token) => !token.includes("\\") && !token.includes("/"))).toBe(true);
    expect(tokens).toEqual([
      "windows-runtime-worker-control-frame-invalid-failed",
      "windows-runtime-worker-boundary-verification-failed",
      "windows-runtime-worker-runtime-creation-failed",
      "windows-runtime-worker-capability-bridge-failed",
      "windows-runtime-worker-model-bridge-failed",
      "windows-runtime-worker-state-directory-failed",
      "windows-runtime-worker-ready-signal-failed",
      "windows-runtime-worker-acp-handshake-failed",
    ]);
  });

  it("maps each supervisor stage to a distinct final evidence token", () => {
    const stages = [
      "windows-control-channel-invalid",
      "windows-ready-channel-invalid",
      "windows-capability-channel-invalid",
      "windows-model-channel-invalid",
      "windows-acp-relay-failed",
      "windows-capability-relay-failed",
      "windows-model-relay-failed",
      "windows-worker-runtime-failed",
      "windows-runtime-timeout",
      "windows-runtime-cleanup-failed",
    ];
    const tokens = stages.map((stage) =>
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage }),
    );
    expect(new Set(tokens).size).toBe(10);
    expect(tokens.every((token) => typeof token === "string" && token.length > 0)).toBe(true);
    expect(tokens.every((token) => !token.includes("\\") && !token.includes("/"))).toBe(true);
    expect(tokens).toEqual([
      "windows-runtime-supervisor-control-channel-invalid-failed",
      "windows-runtime-supervisor-ready-channel-invalid-failed",
      "windows-runtime-supervisor-capability-channel-invalid-failed",
      "windows-runtime-supervisor-model-channel-invalid-failed",
      "windows-runtime-supervisor-acp-relay-failed",
      "windows-runtime-supervisor-capability-relay-failed",
      "windows-runtime-supervisor-model-relay-failed",
      "windows-runtime-supervisor-worker-runtime-failed",
      "windows-runtime-supervisor-timeout-failed",
      "windows-runtime-supervisor-cleanup-failed",
    ]);
    stages.forEach((stage) => {
      expect(
        classifyGooseWindowsOpeningFailure({
          name: "GooseRunnerProcessError",
          code: stage,
          message: "Goose Windows supervisor failed",
        }),
      ).toBe(stage);
    });
  });

  it("maps all eight capability round-trip gaps through composition into distinct final tokens", () => {
    const stages = [
      "windows-capability-worker-request-write-failed",
      "windows-capability-supervisor-request-read-failed",
      "windows-capability-supervisor-request-forward-failed",
      "windows-capability-main-request-decode-failed",
      "windows-capability-main-response-write-failed",
      "windows-capability-supervisor-response-read-failed",
      "windows-capability-supervisor-response-forward-failed",
      "windows-capability-worker-response-decode-failed",
    ];
    const tokens = stages.map((code) => {
      expect(
        classifyGooseWindowsOpeningFailure({
          name: "GooseMcpSessionCompositionError",
          code,
          message: "Windows capability round trip stopped before a bounded stage",
        }),
      ).toBe(code);
      return classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage: code });
    });

    expect(tokens).toEqual([
      "windows-runtime-capability-worker-request-write-failed",
      "windows-runtime-capability-supervisor-request-read-failed",
      "windows-runtime-capability-supervisor-request-forward-failed",
      "windows-runtime-capability-main-request-decode-failed",
      "windows-runtime-capability-main-response-write-failed",
      "windows-runtime-capability-supervisor-response-read-failed",
      "windows-runtime-capability-supervisor-response-forward-failed",
      "windows-runtime-capability-worker-response-decode-failed",
    ]);
    expect(new Set(tokens).size).toBe(8);
  });

  it("maps the first Windows tool-call failure stages into closed runtime tokens", () => {
    const stages = [
      "windows-capability-call-worker-request-write-failed",
      "windows-capability-call-supervisor-request-read-failed",
      "windows-capability-call-supervisor-request-forward-failed",
      "windows-capability-call-main-request-decode-failed",
      "windows-capability-call-main-tool-invocation-start-failed",
      "windows-capability-call-main-tool-invocation-complete-failed",
      "windows-capability-call-main-tool-invocation-failed",
      "windows-capability-call-main-response-write-failed",
      "windows-capability-call-supervisor-response-read-failed",
      "windows-capability-call-supervisor-response-forward-failed",
      "windows-capability-call-worker-response-decode-failed",
    ];
    const tokens = stages.map((stage) =>
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage }),
    );
    expect(tokens).toEqual([
      "windows-runtime-capability-call-worker-request-write-failed",
      "windows-runtime-capability-call-supervisor-request-read-failed",
      "windows-runtime-capability-call-supervisor-request-forward-failed",
      "windows-runtime-capability-call-main-request-decode-failed",
      "windows-runtime-capability-call-main-tool-invocation-start-failed",
      "windows-runtime-capability-call-main-tool-invocation-complete-failed",
      "windows-runtime-capability-call-main-tool-invocation-failed",
      "windows-runtime-capability-call-main-response-write-failed",
      "windows-runtime-capability-call-supervisor-response-read-failed",
      "windows-runtime-capability-call-supervisor-response-forward-failed",
      "windows-runtime-capability-call-worker-response-decode-failed",
    ]);
    expect(new Set(tokens).size).toBe(stages.length);
    expect(
      classifyGooseWindowsOpeningFailure({
        name: "GooseMcpSessionCompositionError",
        code: "windows-capability-call-main-tool-invocation-failed",
        message: "Windows capability tool-call round trip stopped before a bounded stage",
      }),
    ).toBe("windows-capability-call-main-tool-invocation-failed");
  });

  it("maps all ten Windows model round-trip gaps through composition into distinct final tokens", () => {
    const stages = [
      "windows-model-worker-request-write-failed",
      "windows-model-supervisor-request-read-failed",
      "windows-model-supervisor-request-forward-failed",
      "windows-model-main-request-decode-failed",
      "windows-model-main-invocation-start-failed",
      "windows-model-main-invocation-complete-failed",
      "windows-model-main-response-write-failed",
      "windows-model-supervisor-response-read-failed",
      "windows-model-supervisor-response-forward-failed",
      "windows-model-worker-response-decode-failed",
    ];
    const tokens = stages.map((code) => {
      expect(
        classifyGooseWindowsOpeningFailure({
          name: "GooseMcpSessionCompositionError",
          code,
          message: "Windows model round trip stopped before a bounded stage",
        }),
      ).toBe(code);
      return classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage: code });
    });

    expect(tokens).toEqual([
      "windows-runtime-model-worker-request-write-failed",
      "windows-runtime-model-supervisor-request-read-failed",
      "windows-runtime-model-supervisor-request-forward-failed",
      "windows-runtime-model-main-request-decode-failed",
      "windows-runtime-model-main-invocation-start-failed",
      "windows-runtime-model-main-invocation-complete-failed",
      "windows-runtime-model-main-response-write-failed",
      "windows-runtime-model-supervisor-response-read-failed",
      "windows-runtime-model-supervisor-response-forward-failed",
      "windows-runtime-model-worker-response-decode-failed",
    ]);
    expect(new Set(tokens).size).toBe(10);
  });

  it("keeps model refusal causes distinct from transport stages", () => {
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "model-completion-refused",
      }),
    ).toBe("windows-runtime-model-completion-refused-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "model-request-rejected",
      }),
    ).toBe("windows-runtime-model-request-rejected-failed");
  });

  it("keeps each pre-launch state-directory admission stage distinct from Worker access", () => {
    const stages = [
      "windows-state-directory-layout-failed",
      "windows-state-directory-traversal-shape-invalid",
      "windows-state-directory-ancestor-access-failed",
      "windows-state-directory-root-access-failed",
      "windows-state-directory-child-access-failed",
      "windows-state-directory-integrity-label-failed",
    ];
    const tokens = stages.map((stage) =>
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage }),
    );

    expect(tokens).toEqual([
      "windows-runtime-state-directory-layout-failed",
      "windows-runtime-state-directory-traversal-shape-invalid",
      "windows-runtime-state-directory-ancestor-access-failed",
      "windows-runtime-state-directory-root-access-failed",
      "windows-runtime-state-directory-child-access-failed",
      "windows-runtime-state-directory-integrity-label-failed",
    ]);
    expect(new Set(tokens).size).toBe(stages.length);
    stages.forEach((stage) => {
      expect(
        classifyGooseWindowsOpeningFailure({
          name: "GooseRunnerProcessError",
          code: stage,
          message: "Goose Windows state-directory admission failed",
        }),
      ).toBe(stage);
    });
  });

  it("keeps every classified worker startup token admitted by the outer runtime runner", async () => {
    const evidenceModule = await import("../../scripts/gooseWindowsRuntimeEvidence.mjs");
    const workerStartupTokens = [
      "windows-runtime-worker-control-frame-invalid-failed",
      "windows-runtime-worker-boundary-verification-failed",
      "windows-runtime-worker-runtime-creation-failed",
      "windows-runtime-worker-capability-bridge-failed",
      "windows-runtime-worker-model-bridge-failed",
      "windows-runtime-worker-state-directory-failed",
      "windows-runtime-worker-ready-signal-failed",
      "windows-runtime-worker-acp-handshake-failed",
    ];
    const runner = fs.readFileSync(
      path.join(repositoryRoot, "scripts/run-goose-runner-windows-runtime.mjs"),
      "utf8",
    );

    expect(evidenceModule.GOOSE_WINDOWS_RUNTIME_STAGE_FAILURE_CODES).toEqual(
      expect.arrayContaining(workerStartupTokens),
    );
    expect(runner).toContain("GOOSE_WINDOWS_RUNTIME_STAGE_FAILURE_CODES");
    expect(runner).toContain("...GOOSE_WINDOWS_RUNTIME_STAGE_FAILURE_CODES");
  });

  it("classifies bounded Windows runtime child failures without retaining child output", () => {
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        failureStage: "windows-worker-capability-bridge-failed",
        status: 1,
        signal: null,
        stdout: "C:\\Users\\private\\stdout",
        stderr: "C:\\Users\\private\\stderr",
      }),
    ).toBe("windows-runtime-worker-capability-bridge-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        errorCode: "ETIMEDOUT",
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
      }),
    ).toBe("windows-runtime-test-child-timeout-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        errorCode: "ENOENT",
        status: null,
        signal: null,
        stdout: "",
        stderr: "",
      }),
    ).toBe("windows-runtime-test-child-spawn-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        status: 1,
        signal: null,
        stdout: "",
        stderr: "No test files found",
      }),
    ).toBe("windows-runtime-test-collection-empty-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        status: 1,
        signal: null,
        stdout: "",
        stderr: "Failed to load url ./native.integration.ts",
      }),
    ).toBe("windows-runtime-test-module-load-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        status: 1,
        signal: null,
        stdout: "FAIL tests/main/gooseRunnerWindowsNative.integration.ts",
        stderr: "Tests failed",
      }),
    ).toBe("windows-runtime-test-assertion-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        status: 1,
        signal: null,
        stdout: "",
        stderr: "",
      }),
    ).toBe("windows-runtime-test-child-exited-failed");
    expect(
      classifyGooseWindowsRuntimeChildFailure({
        status: 1,
        signal: null,
        stdout: "x".repeat(65 * 1024),
        stderr: "",
      }),
    ).toBe("windows-runtime-test-output-too-large-failed");
    expect(
      JSON.stringify(
        classifyGooseWindowsRuntimeChildFailure({
          status: 1,
          signal: null,
          stdout: "C:\\Users\\private\\stdout",
          stderr: "C:\\Users\\private\\stderr",
        }),
      ),
    ).not.toContain("private");
  });

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

  it("separates each Windows parent-death cleanup step into its own bounded token", async () => {
    const stages = [
      "parent-death-fixture-spawn",
      "parent-death-fixture-exited",
      "parent-death-state-timeout",
      "parent-death-state-malformed",
      "parent-death-supervisor-pid-missing",
      "parent-death-kill-failed",
      "parent-death-supervisor-not-exited",
      "parent-death-worker-not-exited",
      "parent-death-probe-inaccessible",
      "parent-death-residual-processes",
    ];
    const tokens = stages.map((stage) =>
      classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage }),
    );

    expect(tokens.every((token) => typeof token === "string" && token.length > 0)).toBe(true);
    expect(new Set(tokens).size).toBe(stages.length);
    expect(tokens).not.toContain("windows-runtime-parent-death-failed");
    const evidenceModule = await import("../../scripts/gooseWindowsRuntimeEvidence.mjs");
    expect(evidenceModule.GOOSE_WINDOWS_RUNTIME_STAGE_FAILURE_CODES).toEqual(
      expect.arrayContaining(tokens),
    );
    expect(JSON.stringify(tokens)).not.toContain("private");

    const probe = fs.readFileSync(
      path.join(repositoryRoot, "tests/main/gooseRunnerWindowsNative.integration.ts"),
      "utf8",
    );
    for (const stage of stages) {
      // The early-exit stage is returned by the fixture-exit resolver rather
      // than marked inline, so every stage is asserted as a reachable literal.
      expect(probe).toContain(
        stage === "parent-death-fixture-exited" ? `"${stage}"` : `markFailure("${stage}")`,
      );
    }
  });

  it("carries each fixture-side parent-death step into its own bounded token", async () => {
    // The fixture drains its own stdout/stderr pipes; an early exit still only
    // reaches the bounded evidence vocabulary through its last published step.
    const steps = [
      "fixture-artifact-admission",
      "fixture-session-open",
      "fixture-process-tree",
      "fixture-state-publish",
    ];
    const tokens = steps.map((step) =>
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: `parent-death-${step}`,
      }),
    );

    expect(tokens.every((token) => typeof token === "string" && token.length > 0)).toBe(true);
    expect(new Set(tokens).size).toBe(steps.length);
    expect(tokens).not.toContain("windows-runtime-parent-death-failed");
    expect(tokens).not.toContain("windows-runtime-parent-death-fixture-exited-failed");
    const evidenceModule = await import("../../scripts/gooseWindowsRuntimeEvidence.mjs");
    expect(evidenceModule.GOOSE_WINDOWS_RUNTIME_STAGE_FAILURE_CODES).toEqual(
      expect.arrayContaining(tokens),
    );

    const fixture = fs.readFileSync(
      path.join(repositoryRoot, "tests/fixtures/gooseWindowsRuntimeSupervisorExit.ts"),
      "utf8",
    );
    for (const step of steps)
      expect(fixture).toContain(`publishFailureStage(statePath, "${step}")`);
    expect(fixture).toContain("ACTESTRA_GOOSE_WINDOWS_RUNTIME_WORKSPACE");
    expect(fixture).toContain("workspaceDirectory,");
    expect(fixture).toContain("classifyGooseWindowsOpeningFailure(error)");
    const integration = fs.readFileSync(
      path.join(repositoryRoot, "tests/main/gooseRunnerWindowsNative.integration.ts"),
      "utf8",
    );
    expect(integration).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(integration).toContain("child.stdout?.resume()");
    expect(integration).toContain("child.stderr?.resume()");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "parent-death-fixture-unbounded-step",
      }),
    ).toBeUndefined();
  });

  it("runs the parent-death fixture under Node so Windows overlapped channels match production", () => {
    const integration = fs.readFileSync(
      path.join(repositoryRoot, "tests/main/gooseRunnerWindowsNative.integration.ts"),
      "utf8",
    );

    expect(integration).toContain("buildParentDeathFixtureBundle(root)");
    expect(integration).toContain("spawn(process.execPath, [fixtureBundle]");
    expect(integration).not.toContain(
      'spawn(\n    "bun",\n    [path.join(repositoryRoot, "tests/fixtures/gooseWindowsRuntimeSupervisorExit.ts")]',
    );
  });

  it("keeps the parent-death watchdog outside every bounded fixture startup phase", async () => {
    const contractPath = path.join(
      repositoryRoot,
      "tests/fixtures/gooseWindowsRuntimeSupervisorContract.mjs",
    );
    const contractExists = fs.existsSync(contractPath);
    expect(contractExists).toBe(true);
    if (!contractExists) return;

    const contract = await import("../fixtures/gooseWindowsRuntimeSupervisorContract");
    const boundedFixtureStartupMs =
      contract.WINDOWS_RUNTIME_HANDSHAKE_TIMEOUT_MS +
      contract.WINDOWS_RUNTIME_SESSION_PHASE_TIMEOUT_MS * 2 +
      contract.WINDOWS_PARENT_DEATH_PROCESS_DISCOVERY_TIMEOUT_MS;
    expect(contract.WINDOWS_PARENT_DEATH_STATE_TIMEOUT_MS).toBeGreaterThan(boundedFixtureStartupMs);
    const boundedPrimaryJourneyMs =
      contract.WINDOWS_RUNTIME_HANDSHAKE_TIMEOUT_MS +
      contract.WINDOWS_RUNTIME_SESSION_PHASE_TIMEOUT_MS * 2 +
      contract.WINDOWS_RUNTIME_PROMPT_TIMEOUT_MS * 3;
    const boundedParentDeathJourneyMs =
      contract.WINDOWS_PARENT_DEATH_STATE_TIMEOUT_MS +
      contract.WINDOWS_PARENT_DEATH_PROCESS_EXIT_TIMEOUT_MS * 2;
    expect(contract.WINDOWS_RUNTIME_INTEGRATION_TIMEOUT_MS).toBeGreaterThan(
      boundedPrimaryJourneyMs + boundedParentDeathJourneyMs,
    );
    expect(contract.WINDOWS_RUNTIME_CHILD_TIMEOUT_MS).toBeGreaterThan(
      contract.WINDOWS_RUNTIME_INTEGRATION_TIMEOUT_MS,
    );

    const integration = fs.readFileSync(
      path.join(repositoryRoot, "tests/main/gooseRunnerWindowsNative.integration.ts"),
      "utf8",
    );
    const fixture = fs.readFileSync(
      path.join(repositoryRoot, "tests/fixtures/gooseWindowsRuntimeSupervisorExit.ts"),
      "utf8",
    );
    const runner = fs.readFileSync(
      path.join(repositoryRoot, "scripts/run-goose-runner-windows-runtime.mjs"),
      "utf8",
    );
    expect(integration).toContain("WINDOWS_PARENT_DEATH_STATE_TIMEOUT_MS");
    expect(integration).toContain("WINDOWS_PARENT_DEATH_PROCESS_EXIT_TIMEOUT_MS");
    expect(integration).toContain("WINDOWS_RUNTIME_PROMPT_TIMEOUT_MS");
    expect(integration).toContain("WINDOWS_RUNTIME_INTEGRATION_TIMEOUT_MS");
    expect(integration).toContain("vi.setConfig({ testTimeout: integrationTimeoutMs });");
    expect(integration).not.toContain("}, 480_000);");
    expect(integration).not.toContain("}, 180_000);");
    expect(integration).not.toContain("}, 45_000);");
    expect(fixture).toContain("WINDOWS_RUNTIME_HANDSHAKE_TIMEOUT_MS");
    expect(fixture).toContain("WINDOWS_RUNTIME_SESSION_PHASE_TIMEOUT_MS");
    expect(fixture).toContain("WINDOWS_PARENT_DEATH_PROCESS_DISCOVERY_TIMEOUT_MS");
    expect(runner).toContain("WINDOWS_RUNTIME_CHILD_TIMEOUT_MS");
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
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "artifact-admission-digest-mismatch",
      }),
    ).toBe("windows-runtime-artifact-admission-digest-mismatch");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "artifact-admission-unexpected",
      }),
    ).toBe("windows-runtime-artifact-admission-rejected");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "artifact-binding-incomplete",
      }),
    ).toBe("windows-runtime-artifact-binding-invalid");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "fixture-setup",
      }),
    ).toBe("windows-runtime-fixture-setup-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "fixture-git-init",
      }),
    ).toBe("windows-runtime-fixture-git-init-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "fixture-persistence-open",
      }),
    ).toBe("windows-runtime-fixture-persistence-open-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "fixture-domain-state",
      }),
    ).toBe("windows-runtime-fixture-domain-state-failed");
    expect(
      classifyGooseWindowsRuntimeFailureEvidence({
        contractVersion: 1,
        stage: "coding-session-open",
      }),
    ).toBe("windows-runtime-coding-session-open-failed");
    for (const [stage, code] of [
      ["session-open", "windows-runtime-session-open-failed"],
      ["session-invalid-options", "windows-runtime-session-invalid-options-failed"],
      ["session-already-open", "windows-runtime-session-already-open-failed"],
      ["session-closed", "windows-runtime-session-closed-failed"],
      ["session-rejected", "windows-runtime-session-rejected-failed"],
      ["session-message-invalid", "windows-runtime-session-message-invalid-failed"],
      ["prompt-rejected", "windows-runtime-prompt-rejected-failed"],
      ["prompt-timeout", "windows-runtime-prompt-timeout-failed"],
      ["prompt-already-requested", "windows-runtime-prompt-already-requested-failed"],
    ]) {
      expect(classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage })).toBe(code);
    }
    for (const [stage, code] of [
      [
        "coding-session-open-invalid-options",
        "windows-runtime-coding-session-invalid-options-failed",
      ],
      [
        "coding-session-open-repository-invalid",
        "windows-runtime-coding-session-repository-invalid-failed",
      ],
      [
        "coding-session-open-repository-config-denied",
        "windows-runtime-coding-session-repository-config-denied-failed",
      ],
      [
        "coding-session-open-worktree-create-failed",
        "windows-runtime-coding-session-worktree-create-failed",
      ],
      ["coding-session-open-cleanup-failed", "windows-runtime-coding-session-cleanup-failed"],
      [
        "coding-session-open-persistence-failed",
        "windows-runtime-coding-session-persistence-failed",
      ],
    ]) {
      expect(classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage })).toBe(code);
    }
    for (const [stage, code] of [
      ["fixture-filesystem", "windows-runtime-fixture-filesystem-failed"],
      ["fixture-git-config", "windows-runtime-fixture-git-config-failed"],
      ["fixture-git-commit", "windows-runtime-fixture-git-commit-failed"],
      ["fixture-baseline", "windows-runtime-fixture-baseline-failed"],
    ]) {
      expect(classifyGooseWindowsRuntimeFailureEvidence({ contractVersion: 1, stage })).toBe(code);
    }
  });

  it("classifies only one closed Artifact admission error without echoing diagnostics", () => {
    expect(
      classifyGooseWindowsArtifactAdmissionFailure(
        '$ bun scripts/admit-goose-runner-build.ts\r\n{"status":"failed","code":"incompatible-artifact"}\r\nerror: script exited with code 1\r\n',
      ),
    ).toBe("windows-runtime-artifact-admission-incompatible-artifact");
    expect(
      classifyGooseWindowsArtifactAdmissionFailure('{"status":"failed","code":"unsafe-audit"}\n'),
    ).toBe("windows-runtime-artifact-admission-unsafe-audit");
    expect(
      classifyGooseWindowsArtifactAdmissionFailure(
        '{"status":"failed","code":"incompatible-artifact","path":"C:\\\\private"}\n',
      ),
    ).toBeUndefined();
    expect(
      classifyGooseWindowsArtifactAdmissionFailure('{"status":"failed","code":"private-error"}\n'),
    ).toBeUndefined();
    expect(
      classifyGooseWindowsArtifactAdmissionFailure(
        '{"status":"failed","code":"invalid-manifest"}\n{"status":"failed","code":"digest-mismatch"}\n',
      ),
    ).toBeUndefined();
  });

  it("classifies Artifact admission process failures without returning subprocess data", () => {
    const valid = {
      errorCode: undefined,
      status: 0,
      signal: null,
      stdoutBytes: 128,
      stderrBytes: 0,
      stderr: "",
    };
    expect(classifyGooseWindowsArtifactAdmissionExecution(valid)).toBeUndefined();
    expect(
      classifyGooseWindowsArtifactAdmissionExecution({ ...valid, errorCode: "ETIMEDOUT" }),
    ).toBe("windows-runtime-artifact-admission-timeout");
    expect(
      classifyGooseWindowsArtifactAdmissionExecution({ ...valid, errorCode: "private-spawn" }),
    ).toBe("windows-runtime-artifact-admission-process-failed");
    expect(
      classifyGooseWindowsArtifactAdmissionExecution({
        ...valid,
        status: 1,
        stderr: '{"status":"failed","code":"digest-mismatch"}\n',
        stderrBytes: 56,
      }),
    ).toBe("windows-runtime-artifact-admission-digest-mismatch");
    expect(
      classifyGooseWindowsArtifactAdmissionExecution({
        ...valid,
        status: 1,
        stderr: "C:\\\\private\\raw-error",
        stderrBytes: 20,
      }),
    ).toBe("windows-runtime-artifact-admission-rejected");
    expect(
      classifyGooseWindowsArtifactAdmissionExecution({
        ...valid,
        stdoutBytes: 65 * 1024,
      }),
    ).toBe("windows-runtime-artifact-admission-output-too-large");
    expect(
      classifyGooseWindowsArtifactAdmissionExecution({
        ...valid,
        stderrBytes: 65 * 1024,
      }),
    ).toBe("windows-runtime-artifact-admission-output-too-large");
    expect(classifyGooseWindowsArtifactAdmissionExecution({ ...valid, signal: "SIGTERM" })).toBe(
      "windows-runtime-artifact-admission-process-failed",
    );
  });

  it("registers a bounded exact-artifact Windows runtime runner", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    );
    const runnerPath = path.join(repositoryRoot, "scripts/run-goose-runner-windows-runtime.mjs");
    const integrationPath = path.join(
      repositoryRoot,
      "tests/main/gooseRunnerWindowsNative.integration.ts",
    );
    const vitest = fs.readFileSync(path.join(repositoryRoot, "vitest.config.ts"), "utf8");

    expect(packageJson.scripts["goose:runner:integration:windows"]).toBe(
      "node scripts/run-goose-runner-windows-runtime.mjs",
    );
    expect(fs.existsSync(runnerPath)).toBe(true);
    if (!fs.existsSync(runnerPath)) return;
    const runner = fs.readFileSync(runnerPath, "utf8");
    expect(runner).toContain("goose:runner:admit-build");
    expect(runner).toContain('["--silent", "run", "goose:runner:admit-build"]');
    expect(runner).toContain("ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_PATH");
    expect(runner).toContain("gooseRunnerWindowsNative.integration.ts");
    expect(runner).toContain("validateGooseWindowsRuntimeEvidence");
    expect(runner).toContain("classifyGooseWindowsArtifactAdmissionExecution");
    expect(runner).toContain("windows-runtime-artifact-binding-invalid");
    expect(runner).toContain("windows-runtime-artifact-admission-output-invalid");
    expect(runner).toContain("windows-runtime-fixture-setup-failed");
    expect(runner).toContain("classifyGooseWindowsRuntimeFailureEvidence");
    expect(runner).toContain("readFailureCode");
    expect(runner).toContain('"windows-runtime-test-cleanup-failed"');
    expect(runner).toContain('"windows-runtime-test-stage-unknown-failed"');
    expect(runner).toContain("let primaryFailure");
    expect(runner).toContain("Preserve the actionable primary stage");
    expect(runner).not.toContain('? "windows-runtime-test-failed"');
    expect(runner).not.toContain('stdio: "inherit"');
    expect(vitest).toContain("nativeWindowsGooseIntegrationFiles");
    expect(vitest).toContain('"tests/main/gooseRunnerWindowsNative.integration.ts"');
    expect(vitest).toContain('ACTESTRA_GOOSE_WINDOWS_RUNTIME_INTEGRATION === "1"');
    const integration = fs.readFileSync(integrationPath, "utf8");
    expect(integration).toContain("GooseRunnerArtifactError");
    expect(integration).toContain("`artifact-admission-${error.code}`");
    expect(integration).toContain('markFailure("artifact-binding-incomplete")');
    expect(integration).toContain('markFailure("fixture-setup")');
    expect(integration).toContain('markFailure("fixture-git-init")');
    expect(integration).toContain('markFailure("fixture-persistence-open")');
    expect(integration).toContain('markFailure("fixture-domain-state")');
    expect(integration).toContain('markFailure("coding-session-open")');
    expect(integration).toContain("openGooseMcpSessionComposition({");
    expect(integration).toContain("await markFailure(classifyGooseWindowsOpeningFailure(error));");
    expect(integration).toMatch(
      /const root = await realpath\(\s*await mkdtemp\(path\.join\(os\.tmpdir\(\), "actestra-goose-windows-runtime-"\)\),?\s*\);/u,
    );
  });
});
