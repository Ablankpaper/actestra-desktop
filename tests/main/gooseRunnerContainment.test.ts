import { describe, expect, it } from "vitest";
import { GOOSE_WORKER_RESOURCE_PROFILE } from "../../apps/desktop/src/core/workerResourceBudget";
import {
  assertGooseContainmentLaunch,
  hasVerifiedGooseContainment,
  type GooseContainmentEvidence,
} from "../../apps/desktop/src/main/workers/gooseRunnerContainment";

function validLaunch(): Record<string, unknown> {
  return Object.freeze({
    platform: "linux",
    architecture: "x64",
    targetTriple: "x86_64-unknown-linux-gnu",
    executablePath: "/owned/attempt/bin/actestra-goose-runner",
    privateRoot: "/owned/attempt",
    workspaceDirectory: "/owned/worktree",
    networkPolicy: "deny-all",
    resourceBudget: GOOSE_WORKER_RESOURCE_PROFILE,
    parentLiveness: Object.freeze({ kind: "inherited-ipc", token: "a".repeat(32) }),
  });
}

function validEvidence(): GooseContainmentEvidence {
  return Object.freeze({
    contractVersion: 1,
    targetTriple: "x86_64-unknown-linux-gnu",
    sourceCommit: "a".repeat(40),
    probeSha256: "b".repeat(64),
    executableSha256: "c".repeat(64),
    filesystem: true,
    network: true,
    processTree: true,
    resources: true,
    parentDeath: true,
    cleanup: true,
  });
}

describe("Goose containment launch contract", () => {
  it("accepts one frozen, fixed-budget launch record", () => {
    expect(() => assertGooseContainmentLaunch(validLaunch())).not.toThrow();
  });

  it.each([
    ["unknown field", () => ({ ...validLaunch(), unexpected: true })],
    ["relative executable", () => ({ ...validLaunch(), executablePath: "bin/runner" })],
    ["relative private root", () => ({ ...validLaunch(), privateRoot: "attempt" })],
    [
      "widened resource budget",
      () => ({
        ...validLaunch(),
        resourceBudget: Object.freeze({
          ...GOOSE_WORKER_RESOURCE_PROFILE,
          maxCpuSeconds: GOOSE_WORKER_RESOURCE_PROFILE.maxCpuSeconds + 1,
        }),
      }),
    ],
    [
      "missing parent liveness",
      () => {
        const { parentLiveness: _parentLiveness, ...withoutParentLiveness } = validLaunch();
        return withoutParentLiveness;
      },
    ],
    [
      "invalid loopback port",
      () => ({
        ...validLaunch(),
        networkPolicy: Object.freeze({
          kind: "loopback-session",
          host: "127.0.0.1",
          capabilityProxyPort: 0,
          modelProxyPort: 43_124,
        }),
      }),
    ],
  ])("rejects %s before launch", (_label, makeValue) => {
    expect(() => assertGooseContainmentLaunch(makeValue())).toThrow();
  });

  it("rejects a mutable top-level record or mutable nested policy", () => {
    const mutable = { ...validLaunch() };
    expect(() => assertGooseContainmentLaunch(mutable)).toThrow();

    const nestedMutable = { ...validLaunch() };
    nestedMutable.networkPolicy = {
      kind: "loopback-session",
      host: "127.0.0.1",
      capabilityProxyPort: 43_123,
      modelProxyPort: 43_124,
    };
    expect(() => assertGooseContainmentLaunch(Object.freeze(nestedMutable))).toThrow();
  });

  it("accepts evidence only when it matches the admitted artifact exactly", () => {
    const evidence = validEvidence();
    expect(
      hasVerifiedGooseContainment(evidence, {
        targetTriple: evidence.targetTriple,
        executableSha256: evidence.executableSha256,
        sourceCommit: evidence.sourceCommit,
      }),
    ).toBe(true);
    expect(
      hasVerifiedGooseContainment(evidence, {
        targetTriple: evidence.targetTriple,
        executableSha256: "d".repeat(64),
        sourceCommit: evidence.sourceCommit,
      }),
    ).toBe(false);
    expect(hasVerifiedGooseContainment(undefined, evidence)).toBe(false);
  });
});
