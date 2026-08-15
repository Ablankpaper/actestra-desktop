import { describe, expect, it } from "vitest";
import { P7_ABUSE_CASES, P7_ABUSE_OUTCOMES, P7_SECURITY_INVARIANTS } from "./abuseCaseCatalog";

const EXPECTED_CASE_IDS = [
  "P7-A-RENDERER-001",
  "P7-A-RENDERER-002",
  "P7-A-IPC-001",
  "P7-A-IPC-002",
  "P7-A-CREDENTIAL-001",
  "P7-A-CREDENTIAL-002",
  "P7-A-CREDENTIAL-003",
  "P7-A-WORKSPACE-001",
  "P7-A-WORKSPACE-002",
  "P7-A-WORKSPACE-003",
  "P7-A-DELIVERY-001",
  "P7-A-DELIVERY-002",
  "P7-A-TOOL-001",
  "P7-A-TOOL-002",
  "P7-A-APPROVAL-001",
  "P7-A-APPROVAL-002",
  "P7-A-MCP-001",
  "P7-A-MCP-002",
  "P7-A-MCP-003",
  "P7-A-WORKER-001",
  "P7-A-NETWORK-001",
  "P7-A-PROCESS-001",
  "P7-A-PROCESS-002",
  "P7-A-PERSISTENCE-001",
  "P7-A-PERSISTENCE-002",
  "P7-A-REDACTION-001",
  "P7-A-REDACTION-002",
  "P7-A-ARTIFACT-001",
] as const;

const EXPECTED_INVARIANT_IDS = [
  "P7-I-RENDERER-001",
  "P7-I-IPC-001",
  "P7-I-CREDENTIAL-001",
  "P7-I-WORKSPACE-001",
  "P7-I-DELIVERY-001",
  "P7-I-TOOL-001",
  "P7-I-APPROVAL-001",
  "P7-I-MCP-001",
  "P7-I-WORKER-001",
  "P7-I-NETWORK-001",
  "P7-I-PROCESS-001",
  "P7-I-PERSISTENCE-001",
  "P7-I-REDACTION-001",
  "P7-I-ARTIFACT-001",
] as const;

const EXPECTED_CASE_KEYS = [
  "id",
  "invariantId",
  "risk",
  "minimumLayer",
  "requiredLayers",
  "variants",
  "expectedBoundary",
  "expectedIncidentCode",
  "supportedPlatforms",
  "p8Obligation",
] as const;

const EXPECTED_VARIANT_KEYS = [
  "id",
  "testFile",
  "testName",
  "forbiddenEffects",
  "evidenceFields",
] as const;

const EXPECTED_REQUIRED_LAYERS: Readonly<Record<string, readonly number[]>> = {
  "P7-A-RENDERER-001": [1],
  "P7-A-RENDERER-002": [1, 4],
  "P7-A-IPC-001": [2],
  "P7-A-IPC-002": [2],
  "P7-A-CREDENTIAL-001": [2, 4],
  "P7-A-CREDENTIAL-002": [2],
  "P7-A-CREDENTIAL-003": [2, 4],
  "P7-A-WORKSPACE-001": [2],
  "P7-A-WORKSPACE-002": [2],
  "P7-A-WORKSPACE-003": [2],
  "P7-A-DELIVERY-001": [2],
  "P7-A-DELIVERY-002": [2],
  "P7-A-TOOL-001": [2],
  "P7-A-TOOL-002": [2, 3],
  "P7-A-APPROVAL-001": [2],
  "P7-A-APPROVAL-002": [2],
  "P7-A-MCP-001": [3],
  "P7-A-MCP-002": [3],
  "P7-A-MCP-003": [3],
  "P7-A-WORKER-001": [3, 4],
  "P7-A-NETWORK-001": [3, 4],
  "P7-A-PROCESS-001": [3],
  "P7-A-PROCESS-002": [3, 4],
  "P7-A-PERSISTENCE-001": [2],
  "P7-A-PERSISTENCE-002": [2],
  "P7-A-REDACTION-001": [2, 3],
  "P7-A-REDACTION-002": [2],
  "P7-A-ARTIFACT-001": [1, 2, 4],
};

const EXPECTED_TEST_FILES: Readonly<
  Record<(typeof EXPECTED_CASE_IDS)[number], `tests/security/${string}.test.ts`>
> = {
  "P7-A-RENDERER-001": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-RENDERER-002": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-IPC-001": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-IPC-002": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-CREDENTIAL-001": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-CREDENTIAL-002": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-CREDENTIAL-003": "tests/security/rendererIpcCredentialAbuse.test.ts",
  "P7-A-WORKSPACE-001": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-WORKSPACE-002": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-WORKSPACE-003": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-DELIVERY-001": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-DELIVERY-002": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-TOOL-001": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-TOOL-002": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-APPROVAL-001": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-APPROVAL-002": "tests/security/workspaceToolApprovalAbuse.test.ts",
  "P7-A-MCP-001": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-MCP-002": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-MCP-003": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-WORKER-001": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-NETWORK-001": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-PROCESS-001": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-PROCESS-002": "tests/security/mcpWorkerProcessAbuse.test.ts",
  "P7-A-PERSISTENCE-001": "tests/security/persistenceArtifactRedactionAbuse.test.ts",
  "P7-A-PERSISTENCE-002": "tests/security/persistenceArtifactRedactionAbuse.test.ts",
  "P7-A-REDACTION-001": "tests/security/persistenceArtifactRedactionAbuse.test.ts",
  "P7-A-REDACTION-002": "tests/security/persistenceArtifactRedactionAbuse.test.ts",
  "P7-A-ARTIFACT-001": "tests/security/persistenceArtifactRedactionAbuse.test.ts",
};

const variantIds = <const Prefix extends string, const Suffixes extends readonly string[]>(
  prefix: Prefix,
  suffixes: Suffixes,
) => suffixes.map((suffix) => `P7-V-${prefix}-${suffix}`) as readonly string[];

const EXPECTED_VARIANT_IDS: Readonly<
  Record<(typeof EXPECTED_CASE_IDS)[number], readonly string[]>
> = {
  "P7-A-RENDERER-001": variantIds("RENDERER-001", [
    "DIRECT-NODE",
    "DIRECT-ELECTRON",
    "PRIVILEGED-PROCESS",
    "SHELL",
    "PERSISTENCE",
    "FILESYSTEM",
    "GIT",
  ]),
  "P7-A-RENDERER-002": variantIds("RENDERER-002", [
    "FETCH",
    "WEBSOCKET",
    "EVENTSOURCE",
    "XMLHTTPREQUEST",
    "WINDOW-REQUIRE",
  ]),
  "P7-A-IPC-001": variantIds("IPC-001", [
    "UNDECLARED-CHANNEL",
    "STALE-FRAME",
    "NON-MAIN-FRAME",
    "WRONG-SENDER",
    "REQUEST-AFTER-DISPOSAL",
  ]),
  "P7-A-IPC-002": variantIds("IPC-002", [
    "UNKNOWN-KEYS",
    "PROTOTYPE-BEARING-INPUT",
    "UNEXPECTED-ARGUMENTS",
    "OVERSIZED-PAYLOAD",
  ]),
  "P7-A-CREDENTIAL-001": variantIds("CREDENTIAL-001", [
    "PROVIDER-LIST-REDACTION",
    "PROVIDER-READ-REDACTION",
    "CHROMIUM-NO-STORE",
    "RENDERER-CACHE-ABSENCE",
  ]),
  "P7-A-CREDENTIAL-002": variantIds("CREDENTIAL-002", [
    "SENTINEL-WRITE-BACK",
    "CROSS-PROVIDER-SUBSTITUTION",
    "MISSING-STORED-KEY",
    "ANONYMOUS-FETCH-FALLBACK",
  ]),
  "P7-A-CREDENTIAL-003": variantIds("CREDENTIAL-003", [
    "RENDERER-LEAKAGE",
    "LOG-LEAKAGE",
    "PERSISTENCE-LEAKAGE",
    "WORKER-ENVIRONMENT-LEAKAGE",
    "DIAGNOSTIC-LEAKAGE",
  ]),
  "P7-A-WORKSPACE-001": variantIds("WORKSPACE-001", [
    "TRAVERSAL",
    "ABSOLUTE-PATH",
    "EMBEDDED-NUL",
    "SYMLINK-ESCAPE",
    "WORKSPACE-EXTERNAL-READ",
    "WORKSPACE-EXTERNAL-WRITE",
  ]),
  "P7-A-WORKSPACE-002": variantIds("WORKSPACE-002", [
    "REPLACED-GIT-POINTER",
    "WRONG-CANONICAL-ROOT",
    "SUBDIRECTORY",
    "LINKED-WORKTREE",
    "REVOKED-GRANT",
  ]),
  "P7-A-WORKSPACE-003": variantIds("WORKSPACE-003", [
    "HOOKS",
    "FILTERS",
    "INCLUDES",
    "FSMONITOR",
    "DIRTY-TREE",
    "HEAD-DRIFT",
  ]),
  "P7-A-DELIVERY-001": variantIds("DELIVERY-001", [
    "SOURCE-WRITE-BEFORE-APPLY-APPROVAL",
    "CONFLICTING-PATCH",
    "DIGEST-DRIFT",
    "MULTI-FILE-ATOMIC-DENIAL",
  ]),
  "P7-A-DELIVERY-002": variantIds("DELIVERY-002", [
    "CONCURRENT-APPLY",
    "ALREADY-APPLIED-RETRY",
    "LOST-RESPONSE",
    "REPOSITORY-LOCK",
    "IDEMPOTENT-RECOVERY",
  ]),
  "P7-A-TOOL-001": variantIds("TOOL-001", [
    "UNKNOWN-TOOL",
    "MISSING-MANIFEST",
    "NO-POLICY",
    "CONFLICTING-POLICY",
    "MALFORMED-INPUT",
    "WIDENED-MANIFEST",
  ]),
  "P7-A-TOOL-002": variantIds("TOOL-002", [
    "INVALID-CREDENTIAL-REFERENCE",
    "STALE-AUTHORIZATION",
    "EXECUTOR-MISMATCH",
    "AMBIGUOUS-POST-EFFECT-RETRY",
  ]),
  "P7-A-APPROVAL-001": variantIds("APPROVAL-001", [
    "DENY",
    "EXPIRE",
    "CANCEL",
    "REUSE",
    "WRONG-OPERATION",
    "WRONG-ATTEMPT",
    "STALE-SNAPSHOT",
  ]),
  "P7-A-APPROVAL-002": variantIds("APPROVAL-002", [
    "PROTECTED-AS-WORKFLOW-FEEDBACK",
    "PROTECTED-AS-PUBLISH",
    "PROTECTED-AS-WORKSPACE-APPLY",
    "WORKFLOW-FEEDBACK-AS-PROTECTED",
    "WORKFLOW-FEEDBACK-AS-PUBLISH",
    "WORKFLOW-FEEDBACK-AS-WORKSPACE-APPLY",
    "PUBLISH-AS-PROTECTED",
    "PUBLISH-AS-WORKFLOW-FEEDBACK",
    "PUBLISH-AS-WORKSPACE-APPLY",
    "WORKSPACE-APPLY-AS-PROTECTED",
    "WORKSPACE-APPLY-AS-WORKFLOW-FEEDBACK",
    "WORKSPACE-APPLY-AS-PUBLISH",
  ]),
  "P7-A-MCP-001": variantIds("MCP-001", [
    "WRONG-LEASE",
    "WRONG-TOKEN",
    "WRONG-HOST",
    "WRONG-ORIGIN",
    "WRONG-USER-AGENT",
    "WRONG-METHOD",
    "WRONG-CONTENT-TYPE",
    "WRONG-MODEL",
    "INVALID-INITIALIZATION-ORDER",
  ]),
  "P7-A-MCP-002": variantIds("MCP-002", [
    "MALFORMED-JSON",
    "MALFORMED-SSE",
    "OVERSIZED-BODY",
    "OVERSIZED-FRAME",
    "OVERSIZED-TREE",
    "DUPLICATE-IDENTITY",
    "REQUEST-AFTER-CLOSE",
    "IN-FLIGHT-CLOSE",
  ]),
  "P7-A-MCP-003": variantIds("MCP-003", [
    "UNDECLARED-TOOL",
    "AMBIGUOUS-ALIAS",
    "INVALID-TOOL-COUNT",
    "UNMODELED-PROVIDER-FIELD",
  ]),
  "P7-A-WORKER-001": variantIds("WORKER-001", [
    "UNADMITTED-EXECUTABLE",
    "UNADMITTED-DIGEST",
    "WIDENED-CAPABILITIES",
    "INHERITED-ENVIRONMENT-SECRET",
  ]),
  "P7-A-NETWORK-001": variantIds("NETWORK-001", [
    "RENDERER-EXTERNAL-NETWORK",
    "WORKER-EXTERNAL-NETWORK",
    "UNDECLARED-LOOPBACK-DESTINATION",
  ]),
  "P7-A-PROCESS-001": variantIds("PROCESS-001", [
    "UNEXPECTED-CHILD",
    "OUTPUT-OVERFLOW",
    "TIMEOUT",
    "CRASH",
    "CANCELLATION",
    "NORMAL-LEADER-EXIT",
    "FAILING-LEADER-EXIT",
  ]),
  "P7-A-PROCESS-002": variantIds("PROCESS-002", [
    "PARENT-DEATH",
    "CLOSE-RACE",
    "CLEANUP-RETRY",
    "RESIDUAL-PROCESS-SCAN",
    "RESIDUAL-PRIVATE-ROOT-SCAN",
    "RESIDUAL-WORKTREE-SCAN",
    "RESIDUAL-REPOSITORY-LOCK-SCAN",
  ]),
  "P7-A-PERSISTENCE-001": variantIds("PERSISTENCE-001", [
    "STALE-CAS",
    "CONFLICTING-DUPLICATE",
    "CROSS-OWNER-RECORD",
    "CROSS-ATTEMPT-RECORD",
    "SEQUENCE-REGRESSION",
    "REPLAY",
  ]),
  "P7-A-PERSISTENCE-002": variantIds("PERSISTENCE-002", [
    "UNKNOWN-KEYS",
    "TRUNCATED-PROTOCOL",
    "TRUNCATED-DATABASE",
    "DIGEST-TAMPER",
    "INVALID-SQLITE",
    "CLOSED-PORT",
  ]),
  "P7-A-REDACTION-001": variantIds("REDACTION-001", [
    "CREDENTIAL",
    "PATH",
    "PROMPT",
    "COMPLETION",
    "TOOL-ARGUMENT",
    "CONTENT-REFERENCE",
    "PATCH",
    "ENVIRONMENT-TEXT",
  ]),
  "P7-A-REDACTION-002": variantIds("REDACTION-002", [
    "REJECTED-MODEL-FALSE-COMPLETED",
    "REJECTED-MODEL-FALSE-UNCHANGED",
    "REJECTED-TOOL-FALSE-COMPLETED",
    "REJECTED-TOOL-FALSE-UNCHANGED",
    "REJECTED-WORKER-FALSE-COMPLETED",
    "REJECTED-WORKER-FALSE-UNCHANGED",
  ]),
  "P7-A-ARTIFACT-001": variantIds("ARTIFACT-001", [
    "SELF-AUTHORIZING-MANIFEST",
    "WRONG-DIGEST",
    "WRONG-ARCHITECTURE",
    "SYMLINK",
    "UNEXPECTED-FILE",
    "FEATURE-WIDENING",
    "UNSAFE-DEPENDENCY",
    "MISSING-LICENSE",
    "MISSING-SBOM",
    "MISSING-AUDIT",
    "PACKAGED-SOURCE-COPY-DRIFT",
  ]),
};

describe("P7 abuse-case catalog contract", () => {
  it("exports the closed invariant and outcome vocabularies", () => {
    expect(P7_SECURITY_INVARIANTS.map((invariant) => invariant.id)).toEqual(EXPECTED_INVARIANT_IDS);
    expect(P7_SECURITY_INVARIANTS).toHaveLength(EXPECTED_INVARIANT_IDS.length);
    expect(P7_ABUSE_OUTCOMES).toEqual([
      "denied-safe",
      "unsupported-platform",
      "security-boundary-violated",
      "cleanup-incomplete",
      "evidence-incomplete",
      "test-harness-invalid",
    ]);
  });

  it("contains exactly the closed set of unique attack IDs", () => {
    expect(P7_ABUSE_CASES).toHaveLength(EXPECTED_CASE_IDS.length);
    expect(P7_ABUSE_CASES.map((abuseCase) => abuseCase.id)).toEqual(EXPECTED_CASE_IDS);
    expect(new Set(P7_ABUSE_CASES.map((abuseCase) => abuseCase.id)).size).toBe(
      EXPECTED_CASE_IDS.length,
    );
  });

  it("binds the exact complete set of globally unique executable variants", () => {
    const observedVariantIds = P7_ABUSE_CASES.flatMap((abuseCase) =>
      abuseCase.variants.map((variant) => variant.id),
    );

    for (const abuseCase of P7_ABUSE_CASES) {
      expect(abuseCase.variants.map((variant) => variant.id)).toEqual(
        EXPECTED_VARIANT_IDS[abuseCase.id as (typeof EXPECTED_CASE_IDS)[number]],
      );
    }
    expect(observedVariantIds).toHaveLength(168);
    expect(new Set(observedVariantIds).size).toBe(observedVariantIds.length);
  });

  it("keeps every case and variant metadata-only and structurally closed", () => {
    const bindings = new Set<string>();
    for (const abuseCase of P7_ABUSE_CASES) {
      expect(Object.keys(abuseCase).sort()).toEqual([...EXPECTED_CASE_KEYS].sort());
      expect(abuseCase.id).toMatch(/^P7-A-[A-Z]+-\d{3}$/u);
      expect(EXPECTED_INVARIANT_IDS).toContain(abuseCase.invariantId);
      expect(["critical", "high", "medium", "low"]).toContain(abuseCase.risk);
      expect([1, 2, 3, 4]).toContain(abuseCase.minimumLayer);
      expect(abuseCase.requiredLayers).toEqual(EXPECTED_REQUIRED_LAYERS[abuseCase.id]);
      expect(abuseCase.requiredLayers).toContain(abuseCase.minimumLayer);
      expect(abuseCase.requiredLayers).not.toHaveLength(0);
      expect(
        abuseCase.requiredLayers.every(
          (layer, index, layers) => [1, 2, 3, 4].includes(layer) && layers.indexOf(layer) === index,
        ),
      ).toBe(true);
      expect(abuseCase.variants.length).toBeGreaterThan(0);
      expect(abuseCase.expectedBoundary.length).toBeGreaterThan(0);
      expect(
        abuseCase.expectedIncidentCode === null ||
          typeof abuseCase.expectedIncidentCode === "string",
      ).toBe(true);
      expect(abuseCase.supportedPlatforms).toContain("darwin");
      expect(
        abuseCase.supportedPlatforms.every((platform) =>
          ["darwin", "win32", "linux"].includes(platform),
        ),
      ).toBe(true);
      if (
        !abuseCase.supportedPlatforms.includes("win32") ||
        !abuseCase.supportedPlatforms.includes("linux")
      ) {
        expect(abuseCase.p8Obligation).toEqual(expect.any(String));
        expect(abuseCase.p8Obligation?.length).toBeGreaterThan(0);
      }

      const expectedVariantPrefix = abuseCase.id.replace("P7-A-", "P7-V-");
      for (const variant of abuseCase.variants) {
        expect(Object.keys(variant).sort()).toEqual([...EXPECTED_VARIANT_KEYS].sort());
        expect(variant.id).toMatch(/^P7-V-[A-Z]+-\d{3}-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u);
        expect(variant.id.startsWith(`${expectedVariantPrefix}-`)).toBe(true);
        expect(variant.id.length).toBeLessThanOrEqual(96);
        expect(variant.testFile).toMatch(/^tests\/security\/[^/]+\.test\.(?:ts|mjs)$/u);
        expect(variant.testFile).toBe(
          EXPECTED_TEST_FILES[abuseCase.id as (typeof EXPECTED_CASE_IDS)[number]],
        );
        expect(variant.testFile).not.toContain("..");
        expect(variant.testName).toBe(`${abuseCase.id} ${variant.id}`);
        expect(variant.forbiddenEffects.length).toBeGreaterThan(0);
        expect(variant.evidenceFields.length).toBeGreaterThan(0);
        const binding = `${variant.testFile}\0${variant.testName}`;
        expect(bindings.has(binding)).toBe(false);
        bindings.add(binding);
      }
    }
  });

  it("deep-freezes every exported metadata collection", () => {
    expect(Object.isFrozen(P7_SECURITY_INVARIANTS)).toBe(true);
    expect(P7_SECURITY_INVARIANTS.every((invariant) => Object.isFrozen(invariant))).toBe(true);
    expect(Object.isFrozen(P7_ABUSE_OUTCOMES)).toBe(true);
    expect(Object.isFrozen(P7_ABUSE_CASES)).toBe(true);
    for (const abuseCase of P7_ABUSE_CASES) {
      expect(Object.isFrozen(abuseCase)).toBe(true);
      expect(Object.isFrozen(abuseCase.requiredLayers)).toBe(true);
      expect(Object.isFrozen(abuseCase.supportedPlatforms)).toBe(true);
      expect(Object.isFrozen(abuseCase.variants)).toBe(true);
      for (const variant of abuseCase.variants) {
        expect(Object.isFrozen(variant)).toBe(true);
        expect(Object.isFrozen(variant.forbiddenEffects)).toBe(true);
        expect(Object.isFrozen(variant.evidenceFields)).toBe(true);
      }
    }
  });

  it("does not embed secrets, raw inputs, absolute paths, or mutable fixture values", () => {
    const serialized = JSON.stringify({
      invariants: P7_SECURITY_INVARIANTS,
      outcomes: P7_ABUSE_OUTCOMES,
      cases: P7_ABUSE_CASES,
    });
    expect(serialized).not.toMatch(/(?:sk-[a-z0-9]|api[_-]?key\s*[:=]|bearer\s+[a-z0-9])/iu);
    expect(serialized).not.toMatch(/(?:\/Users\/|\/private\/|\/tmp\/|[A-Z]:\\)/u);
    expect(serialized).not.toMatch(/(?:credential-canary|raw-input|fixture-value)/iu);
    expect(serialized).not.toContain("http://");
    expect(serialized).not.toContain("https://");
  });
});
