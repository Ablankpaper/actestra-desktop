// @vitest-environment node

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(root, "scripts/p8-platform-matrix.mjs");

const expectedTargets = [
  {
    id: "macos-15-arm64",
    ciRunner: "macos-15",
    acceptanceEnvironment: "macOS 15 arm64",
    electronPlatform: "darwin",
    architecture: "arm64",
    packageFormats: ["dmg", "zip"],
  },
  {
    id: "windows-11-x64",
    ciRunner: "windows-2025",
    acceptanceEnvironment: "Windows 11 24H2 x64",
    electronPlatform: "win32",
    architecture: "x64",
    packageFormats: ["nsis"],
  },
  {
    id: "ubuntu-24.04-x64",
    ciRunner: "ubuntu-24.04",
    acceptanceEnvironment: "Ubuntu 24.04 LTS x64",
    electronPlatform: "linux",
    architecture: "x64",
    packageFormats: ["deb"],
  },
];

const expectedJourneys = [
  ["fresh-profile-launch", "P8.2"],
  ["general-artifact", "P8.2"],
  ["goose-isolated-patch", "P8.2"],
  ["workspace-apply-approval", "P8.2"],
  ["general-goose-team", "P8.2"],
  ["cancellation-no-orphan", "P8.2"],
  ["crash-restart-recovery", "P8.2"],
  ["privacy-redaction", "P8.2"],
  ["p7-platform-obligations", "P8.2"],
  ["clean-install", "P8.4"],
  ["upgrade-state-continuity", "P8.4"],
  ["rollback-after-update-failure", "P8.4"],
  ["uninstall-data-choice", "P8.4"],
  ["real-provider-acceptance", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

const expectedEvidence = [
  ["native-package-runtime", "P8.2"],
  ["platform-security-boundaries", "P8.2"],
  ["candidate-digest-sbom-provenance", "P8.3"],
  ["signing-notarization", "P8.3"],
  ["update-metadata-rollback", "P8.3"],
  ["clean-machine-lifecycle", "P8.4"],
  ["internal-beta-runbook-issue-intake", "P8.4"],
].map(([id, requiredBatch]) => ({ id, requiredBatch }));

describe("P8.1 platform matrix", () => {
  it("publishes the exact approved targets and obligations", async () => {
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) return;
    const { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } = await import(contractPath);
    expect(P8_PLATFORM_MATRIX).toEqual({
      contractVersion: 1,
      phase: "P8",
      targets: expectedTargets,
      requiredJourneys: expectedJourneys,
      requiredEvidence: expectedEvidence,
      evidenceStates: [
        "verified",
        "failed",
        "unsupported-platform",
        "evidence-incomplete",
        "test-harness-invalid",
      ],
      securityPassState: "denied-safe",
      nonClaims: [
        "cross-platform-runtime-implemented",
        "formal-signing",
        "notarization",
        "candidate",
        "release",
        "deployment",
        "distribution",
        "user-acceptance",
      ],
    });
    expect(validateP8PlatformMatrix(P8_PLATFORM_MATRIX)).toEqual([]);
  });

  it("rejects widening, missing evidence, malformed targets, conflation, and skip-as-pass", async () => {
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) return;
    const { P8_PLATFORM_MATRIX, validateP8PlatformMatrix } = await import(contractPath);
    const mutate = (apply) => {
      const candidate = structuredClone(P8_PLATFORM_MATRIX);
      apply(candidate);
      return validateP8PlatformMatrix(candidate);
    };

    expect(
      mutate((value) => value.targets.push({ ...value.targets[0], id: "macos-15-x64" })),
    ).toContain("target-count");
    expect(mutate((value) => value.requiredJourneys.pop())).toContain("journey-count");
    expect(
      mutate((value) => {
        value.targets[1].id = value.targets[0].id;
      }),
    ).toContain("target-ids");
    expect(
      mutate((value) => {
        value.targets[0] = null;
      }),
    ).toContain("target-ids");
    expect(
      mutate((value) => {
        value.targets[2].acceptanceEnvironment = value.targets[2].ciRunner;
      }),
    ).toContain("target-builder-acceptance-conflated:ubuntu-24.04-x64");
    expect(
      mutate((value) => {
        value.evidenceStates[0] = "skipped";
      }),
    ).toContain("evidence-states");
    expect(
      mutate((value) => {
        value.unexpected = true;
      }),
    ).toContain("root-keys");
    expect(Object.isFrozen(P8_PLATFORM_MATRIX)).toBe(true);
    expect(Object.isFrozen(P8_PLATFORM_MATRIX.targets)).toBe(true);
    expect(P8_PLATFORM_MATRIX.targets.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(P8_PLATFORM_MATRIX.requiredJourneys)).toBe(true);
    expect(P8_PLATFORM_MATRIX.requiredJourneys.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(P8_PLATFORM_MATRIX.requiredEvidence)).toBe(true);
    expect(P8_PLATFORM_MATRIX.requiredEvidence.every(Object.isFrozen)).toBe(true);
  });
});
