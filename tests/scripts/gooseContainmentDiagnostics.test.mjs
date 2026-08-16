// @vitest-environment node

import { describe, expect, it } from "vitest";
import { classifyGooseContainmentProbeStderr } from "../../scripts/gooseContainmentEvidence.mjs";

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
    expect(
      classifyGooseContainmentProbeStderr(
        "Goose resource probe failed at bounded stage resource-cgroup-controller-not-delegated\n",
      ),
    ).toBe("resource-cgroup-controller-not-delegated");
    expect(
      classifyGooseContainmentProbeStderr(
        "Goose resource probe failed at bounded stage resource-process-count-not-enforced\n",
      ),
    ).toBe("resource-process-count-not-enforced");
  });

  it("drops raw, unknown, oversized, and path-bearing diagnostics", () => {
    for (const value of [
      undefined,
      "resource-cgroup-controller-not-delegated",
      "Goose resource probe failed at bounded stage /Users/private/secret\n",
      "Goose resource probe failed at bounded stage resource-invented-code\n",
      `Goose resource probe failed at bounded stage resource-cgroup-limit-failed\n${"x".repeat(65 * 1024)}`,
    ]) {
      expect(classifyGooseContainmentProbeStderr(value)).toBeUndefined();
    }
  });
});
