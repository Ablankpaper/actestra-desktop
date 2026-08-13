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
  "testFile",
  "testName",
  "expectedBoundary",
  "expectedIncidentCode",
  "forbiddenEffects",
  "evidenceFields",
  "supportedPlatforms",
  "p8Obligation",
] as const;

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

  it("keeps every case metadata-only and structurally closed", () => {
    for (const abuseCase of P7_ABUSE_CASES) {
      expect(Object.keys(abuseCase).sort()).toEqual([...EXPECTED_CASE_KEYS].sort());
      expect(abuseCase.id).toMatch(/^P7-A-[A-Z]+-\d{3}$/u);
      expect(EXPECTED_INVARIANT_IDS).toContain(abuseCase.invariantId);
      expect(["critical", "high", "medium", "low"]).toContain(abuseCase.risk);
      expect([1, 2, 3, 4]).toContain(abuseCase.minimumLayer);
      expect(abuseCase.testFile).toMatch(/^tests\/security\/[^/]+\.test\.(?:ts|mjs)$/u);
      expect(abuseCase.testFile).not.toContain("..");
      expect(abuseCase.testName).toContain(abuseCase.id);
      expect(abuseCase.expectedBoundary.length).toBeGreaterThan(0);
      expect(
        abuseCase.expectedIncidentCode === null ||
          typeof abuseCase.expectedIncidentCode === "string",
      ).toBe(true);
      expect(abuseCase.forbiddenEffects.length).toBeGreaterThan(0);
      expect(abuseCase.evidenceFields.length).toBeGreaterThan(0);
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
    }
  });

  it("does not embed secrets, prompts, paths, or mutable fixture values", () => {
    const serialized = JSON.stringify({
      invariants: P7_SECURITY_INVARIANTS,
      outcomes: P7_ABUSE_OUTCOMES,
      cases: P7_ABUSE_CASES,
    });
    expect(serialized).not.toMatch(/(?:sk-|api[_-]?key|bearer|authorization\s*:)/iu);
    expect(serialized).not.toMatch(
      /(?:\/Users\/|\/tmp\/|prompt|completion|tool[_-]?argument|content[_-]?reference)/iu,
    );
    expect(serialized).not.toContain("http://");
    expect(serialized).not.toContain("https://");
  });
});
