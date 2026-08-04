// @vitest-environment node

import { describe, expect, it } from "vitest";

describe("AionUI Goose coding-agent bridge contract", () => {
  it("exports one fixed agent identity and closed status/probe channels", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRequest = compatibility.assertAionUiCodingAgentRequest as (value: unknown) => void;
    const assertProjection = compatibility.assertAionUiCodingAgentProjection as (
      value: unknown,
    ) => void;

    expect(compatibility.ACTESTRA_GOOSE_MANAGED_AGENT_ID).toBe("actestra-goose");
    expect(compatibility.ACTESTRA_CODING_AGENT_STATUS_CHANNEL).toBe("actestra:coding-agent:status");
    expect(compatibility.ACTESTRA_CODING_AGENT_PROBE_CHANNEL).toBe("actestra:coding-agent:probe");
    expect(assertRequest).toBeTypeOf("function");
    expect(assertProjection).toBeTypeOf("function");

    expect(() => assertRequest({ contractVersion: 1 })).not.toThrow();
    expect(() =>
      assertProjection({
        contractVersion: 1,
        agentId: "actestra-goose",
        displayName: "Goose coding",
        status: "ready",
        runnerVersion: "1.45.0",
      }),
    ).not.toThrow();
    for (const [status, reason] of [
      ["missing", "runner-not-configured"],
      ["incompatible", "runner-incompatible"],
      ["unavailable", "main-unavailable"],
    ] as const) {
      expect(() =>
        assertProjection({
          contractVersion: 1,
          agentId: "actestra-goose",
          displayName: "Goose coding",
          status,
          reason,
        }),
      ).not.toThrow();
    }
  });

  it("rejects renderer-supplied authority and private runner details", async () => {
    const compatibility = (await import("../../apps/desktop/src/compatibility/aionui")) as Record<
      string,
      unknown
    >;
    const assertRequest = compatibility.assertAionUiCodingAgentRequest as (value: unknown) => void;
    const assertProjection = compatibility.assertAionUiCodingAgentProjection as (
      value: unknown,
    ) => void;

    for (const invalid of [
      { contractVersion: 1, agentId: "actestra-goose" },
      { contractVersion: 1, artifactDirectory: "/private/runner" },
      { contractVersion: 1, manifestSha256: "f".repeat(64) },
      { contractVersion: 2 },
    ]) {
      expect(() => assertRequest(invalid)).toThrow();
    }

    for (const invalid of [
      {
        contractVersion: 1,
        agentId: "actestra-goose",
        displayName: "Goose coding",
        status: "ready",
        runnerVersion: "1.45.0",
        executablePath: "/private/runner/actestra-goose-runner",
      },
      {
        contractVersion: 1,
        agentId: "goose",
        displayName: "Goose coding",
        status: "ready",
        runnerVersion: "1.45.0",
      },
      {
        contractVersion: 1,
        agentId: "actestra-goose",
        displayName: "Goose coding",
        status: "ready",
        runnerVersion: "1.46.0",
      },
      {
        contractVersion: 1,
        agentId: "actestra-goose",
        displayName: "Goose coding",
        status: "missing",
        reason: "runner-incompatible",
      },
    ]) {
      expect(() => assertProjection(invalid)).toThrow();
    }
  });
});
