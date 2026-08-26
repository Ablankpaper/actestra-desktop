// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  P8_PRODUCT_JOURNEY_FAILURE_CODES,
  P8_PRODUCT_JOURNEY_IDS,
  makeP8ProductJourneyFailureEvidence,
  validateP8ProductJourneyEvidence,
  validateP8ProductJourneyFailureEvidence,
  validateP8ProductJourneyMatrix,
} from "../../scripts/p8-product-journey-evidence.mjs";

const digest = "a".repeat(64);
const otherDigest = "c".repeat(64);
const commit = "b".repeat(40);
const runId = "32879077165";

const targets = Object.freeze([
  Object.freeze({
    targetId: "macos-15-arm64",
    packages: Object.freeze([
      Object.freeze({ format: "dmg", sha256: digest }),
      Object.freeze({ format: "zip", sha256: digest }),
    ]),
  }),
  Object.freeze({
    targetId: "windows-11-x64",
    packages: Object.freeze([Object.freeze({ format: "nsis", sha256: digest })]),
  }),
  Object.freeze({
    targetId: "ubuntu-24.04-x64",
    packages: Object.freeze([Object.freeze({ format: "deb", sha256: digest })]),
  }),
]);

function validRunner() {
  return {
    packaged: true,
    manifestSha256: digest,
    executableSha256: digest,
    containmentEvidenceSha256: digest,
  };
}

function validJourneys() {
  return P8_PRODUCT_JOURNEY_IDS.map((id) => ({
    id,
    status: "verified",
    residualProcessCount: 0,
  }));
}

function validRecord(target = targets[0]) {
  return {
    schemaVersion: 1,
    status: "verified",
    targetId: target.targetId,
    sourceCommit: commit,
    ciRunId: runId,
    packages: target.packages.map((entry) => ({ ...entry })),
    executableSha256: digest,
    appAsarSha256: digest,
    runner: validRunner(),
    journeyResultSha256: digest,
    packageStructure: true,
    gracefulExit: true,
    residualProcessCount: 0,
    journeys: validJourneys(),
  };
}

function bindingFor(value) {
  return {
    targetId: value.targetId,
    sourceCommit: value.sourceCommit,
    ciRunId: value.ciRunId,
    packages: value.packages.map((entry) => ({ ...entry })),
    executableSha256: value.executableSha256,
    appAsarSha256: value.appAsarSha256,
    runner: { ...value.runner },
  };
}

describe("P8.2 complete product-journey evidence contract", () => {
  it("retains the exact nine accepted P8.2 journey identifiers", () => {
    expect(P8_PRODUCT_JOURNEY_IDS).toEqual([
      "fresh-profile-launch",
      "general-artifact",
      "goose-isolated-patch",
      "workspace-apply-approval",
      "general-goose-team",
      "cancellation-no-orphan",
      "crash-restart-recovery",
      "privacy-redaction",
      "p7-platform-obligations",
    ]);
    expect(Object.isFrozen(P8_PRODUCT_JOURNEY_IDS)).toBe(true);
  });

  it.each(targets)("accepts one exact package and runner bound record for $targetId", (target) => {
    const value = validRecord(target);
    expect(validateP8ProductJourneyEvidence(value, bindingFor(value))).toEqual({ ok: true });
  });

  it.each([
    ["extra top-level key", (value) => (value.extra = true)],
    ["unknown target", (value) => (value.targetId = "macos-15-x64")],
    ["wrong package format", (value) => (value.packages[0].format = "nsis")],
    ["missing package", (value) => value.packages.pop()],
    ["unpackaged runner", (value) => (value.runner.packaged = false)],
    ["malformed runner digest", (value) => (value.runner.manifestSha256 = "not-a-digest")],
    ["missing journey", (value) => value.journeys.pop()],
    ["duplicate journey", (value) => (value.journeys[8].id = value.journeys[0].id)],
    ["unknown journey", (value) => (value.journeys[8].id = "new-feature")],
    ["incomplete journey", (value) => (value.journeys[4].status = "evidence-incomplete")],
    ["journey residual process", (value) => (value.journeys[5].residualProcessCount = 1)],
    ["target residual process", (value) => (value.residualProcessCount = 1)],
    ["non-graceful exit", (value) => (value.gracefulExit = false)],
    ["unbounded path field", (value) => (value.journeys[0].privatePath = "/Users/private")],
  ])("rejects %s", (_label, mutate) => {
    const value = validRecord();
    const binding = bindingFor(value);
    mutate(value);
    expect(validateP8ProductJourneyEvidence(value, binding).ok).toBe(false);
  });

  it("rejects artifact, runner, source, or CI binding drift", () => {
    const value = validRecord();
    for (const binding of [
      { ...bindingFor(value), sourceCommit: "d".repeat(40) },
      { ...bindingFor(value), ciRunId: "1" },
      { ...bindingFor(value), executableSha256: otherDigest },
      { ...bindingFor(value), appAsarSha256: otherDigest },
      {
        ...bindingFor(value),
        packages: [{ ...value.packages[0], sha256: otherDigest }, value.packages[1]],
      },
      {
        ...bindingFor(value),
        runner: { ...value.runner, executableSha256: otherDigest },
      },
    ]) {
      expect(validateP8ProductJourneyEvidence(value, binding)).toEqual({
        ok: false,
        code: "artifact-mismatch",
      });
    }
  });

  it("accepts only a closed bounded failure record", () => {
    expect(P8_PRODUCT_JOURNEY_FAILURE_CODES).toContain("journey-failed");
    const failure = makeP8ProductJourneyFailureEvidence(
      "windows-11-x64",
      commit,
      runId,
      "journey-failed",
    );
    expect(failure).toEqual({
      schemaVersion: 1,
      status: "failed",
      targetId: "windows-11-x64",
      sourceCommit: commit,
      ciRunId: runId,
      code: "journey-failed",
    });
    expect(
      validateP8ProductJourneyFailureEvidence(failure, {
        targetId: failure.targetId,
        sourceCommit: commit,
        ciRunId: runId,
      }),
    ).toEqual({ ok: true });
    expect(
      validateP8ProductJourneyFailureEvidence(
        { ...failure, code: "/Users/private/secret" },
        { targetId: failure.targetId, sourceCommit: commit, ciRunId: runId },
      ),
    ).toEqual({ ok: false, code: "invalid-failure" });
    expect(validateP8ProductJourneyEvidence(failure, {})).toEqual({
      ok: false,
      code: "invalid-evidence",
    });
  });

  it("accepts exactly 27 unique verified rows from one source and CI run", () => {
    const records = targets.map((target) => validRecord(target));
    expect(validateP8ProductJourneyMatrix(records)).toEqual({ ok: true });
  });

  it.each([
    ["missing target", (records) => records.pop()],
    ["duplicate target", (records) => (records[2] = structuredClone(records[0]))],
    ["mixed source", (records) => (records[2].sourceCommit = "d".repeat(40))],
    ["mixed CI run", (records) => (records[2].ciRunId = "1")],
    ["missing row", (records) => records[1].journeys.pop()],
    ["unsupported row", (records) => (records[1].journeys[4].status = "unsupported-platform")],
    ["residual row", (records) => (records[2].journeys[7].residualProcessCount = 2)],
  ])("keeps the aggregate gate closed for %s", (_label, mutate) => {
    const records = targets.map((target) => validRecord(target));
    mutate(records);
    expect(validateP8ProductJourneyMatrix(records).ok).toBe(false);
  });
});
