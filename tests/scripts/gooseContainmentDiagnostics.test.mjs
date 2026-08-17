// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  classifyGooseContainmentIncompleteEvidence,
  classifyGooseContainmentProbeStderr,
} from "../../scripts/gooseContainmentEvidence.mjs";

describe("Goose containment probe diagnostics", () => {
  it("accepts only the closed process-stage vocabulary", () => {
    for (const code of [
      "process-seccomp-unavailable",
      "process-thread-unavailable",
      "process-creation-not-denied",
      "process-exec-not-denied",
      "process-probe-cleanup-failed",
    ]) {
      expect(
        classifyGooseContainmentProbeStderr(
          `Goose process-tree probe failed at bounded stage ${code}\n`,
        ),
      ).toBe(code);
    }
    expect(
      classifyGooseContainmentProbeStderr(
        "Goose process-tree probe failed at bounded stage process-private-path\n",
      ),
    ).toBeUndefined();
  });

  it("accepts only the closed resource-stage vocabulary", () => {
    for (const code of [
      "resource-rlimit-unavailable",
      "resource-rlimit-mismatch",
      "resource-rlimit-widening-not-denied",
      "resource-probe-cleanup-failed",
    ]) {
      expect(
        classifyGooseContainmentProbeStderr(
          `Goose resource probe failed at bounded stage ${code}\n`,
        ),
      ).toBe(code);
    }
    expect(
      classifyGooseContainmentProbeStderr(
        "Goose resource probe failed at bounded stage resource-cgroup-controller-not-delegated\n",
      ),
    ).toBeUndefined();
  });

  it("drops raw, unknown, oversized, and path-bearing diagnostics", () => {
    for (const value of [
      undefined,
      "resource-rlimit-unavailable",
      "Goose resource probe failed at bounded stage /Users/private/secret\n",
      "Goose resource probe failed at bounded stage resource-invented-code\n",
      `Goose resource probe failed at bounded stage resource-rlimit-mismatch\n${"x".repeat(65 * 1024)}`,
    ]) {
      expect(classifyGooseContainmentProbeStderr(value)).toBeUndefined();
    }
  });

  it("classifies bounded process and resource stages without declaring containment verified", () => {
    const evidence = {
      cleanup: true,
      contractVersion: 1,
      executableSha256: "c".repeat(64),
      filesystem: true,
      network: true,
      parentDeath: true,
      probeSha256: "b".repeat(64),
      processTree: true,
      resources: true,
      sourceCommit: "a".repeat(40),
      status: "evidence-incomplete",
      targetTriple: "x86_64-unknown-linux-gnu",
    };
    expect(classifyGooseContainmentIncompleteEvidence(evidence)).toBe(
      "remaining-evidence-incomplete",
    );
    expect(classifyGooseContainmentIncompleteEvidence({ ...evidence, processTree: false })).toBe(
      "process-evidence-incomplete",
    );
    expect(classifyGooseContainmentIncompleteEvidence({ ...evidence, resources: false })).toBe(
      "resource-evidence-incomplete",
    );
  });

  it.each([
    ["filesystem", "filesystem-evidence-incomplete"],
    ["network", "network-evidence-incomplete"],
    ["parentDeath", "parent-death-evidence-incomplete"],
    ["cleanup", "cleanup-evidence-incomplete"],
  ])("classifies the bounded %s stage without exposing probe values", (capability, code) => {
    const evidence = {
      cleanup: true,
      contractVersion: 1,
      executableSha256: "c".repeat(64),
      filesystem: true,
      network: true,
      parentDeath: true,
      probeSha256: "b".repeat(64),
      processTree: true,
      resources: true,
      sourceCommit: "a".repeat(40),
      status: "evidence-incomplete",
      targetTriple: "x86_64-unknown-linux-gnu",
      [capability]: false,
    };

    expect(classifyGooseContainmentIncompleteEvidence(evidence)).toBe(code);
    expect(code).not.toContain("/");
    expect(code).not.toContain(" ");
  });
});
