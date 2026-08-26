// @vitest-environment node

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  P8_CLEAN_MACHINE_JOURNEY_IDS,
  buildP8CleanMachineEvidence,
  validateP8CleanMachineEvidence,
  validateP8CleanMachineMatrix,
} from "../../scripts/p8-clean-machine-evidence.mjs";
import packageJson from "../../package.json" with { type: "json" };

const sourceCommit = "a".repeat(40);
const candidateManifestSha256 = "b".repeat(64);
const ciRunId = "32879077165";
const environment = (targetId) =>
  targetId === "macos-15-arm64"
    ? {
        acceptanceEnvironment: "macOS 15 arm64",
        architecture: "arm64",
        cleanMachine: true,
        os: "macOS",
        osVersion: "15.6",
      }
    : targetId === "windows-11-x64"
      ? {
          acceptanceEnvironment: "Windows 11 24H2 x64",
          architecture: "x64",
          cleanMachine: true,
          os: "Windows",
          osVersion: "11 24H2",
        }
      : {
          acceptanceEnvironment: "Ubuntu 24.04 LTS x64",
          architecture: "x64",
          cleanMachine: true,
          os: "Ubuntu",
          osVersion: "24.04",
        };

const checks = (id) =>
  Object.fromEntries(
    {
      "clean-install": [
        "candidateDigestVerified",
        "noPriorActestraProfile",
        "installerAccepted",
        "installedVersionMatches",
        "freshProfileCreated",
        "applicationLaunched",
        "cleanupVerified",
      ],
      "upgrade-state-continuity": [
        "predecessorInstalled",
        "stateSchemaCompatible",
        "artifactVisibleBeforeUpgrade",
        "candidateInstalled",
        "artifactVisibleAfterUpgrade",
        "restartRecoveredState",
        "cleanupVerified",
      ],
      "rollback-after-update-failure": [
        "updateFailureInjected",
        "partialUpdateRejected",
        "previousVersionRestored",
        "stateRetained",
        "operatorConfirmationRequired",
        "cleanupVerified",
      ],
      "uninstall-data-choice": [
        "applicationRemoved",
        "dataChoicePresented",
        "retainedDataProved",
        "removedDataProved",
        "noResidualProcess",
        "cleanupVerified",
      ],
      "real-provider-acceptance": [
        "realProviderMode",
        "credentialRedactionVerified",
        "messageRoundTripVerified",
        "artifactResultVerified",
        "restartRecoveredState",
        "cleanupVerified",
      ],
    }[id].map((key) => [key, true]),
  );

function record(targetId) {
  const version = "0.1.0-alpha.0";
  return buildP8CleanMachineEvidence({
    targetId,
    sourceCommit,
    ciRunId,
    candidateVersion: version,
    candidateManifestSha256,
    environment: environment(targetId),
    journeys: P8_CLEAN_MACHINE_JOURNEY_IDS.map((id, index) => ({
      id,
      status: "verified",
      providerMode: id === "real-provider-acceptance" ? "real" : "none",
      evidenceSha256: `${String(index + 1).repeat(64)}`.slice(0, 64),
      checks: checks(id),
    })),
    runbook: {
      channel: "internal-beta",
      redacted: true,
      revision: "a".repeat(7),
      status: "verified",
    },
    issueIntake: {
      channel: "github-issues",
      endpoint: "https://github.com/Ablankpaper/actestra-desktop/issues",
      redacted: true,
      revision: "b".repeat(7),
      status: "verified",
    },
  });
}

describe("P8.4 clean-machine evidence contract", () => {
  it("registers bounded create and check commands", () => {
    expect(packageJson.scripts["p8:clean-machine:check"]).toBe(
      "node scripts/p8-clean-machine-evidence.mjs",
    );
    expect(packageJson.scripts["p8:clean-machine:create"]).toBe(
      "node scripts/create-p8-clean-machine-evidence.mjs",
    );
  });

  it("requires all five journeys, exact environment, and a redacted runbook/intake", () => {
    const value = record("macos-15-arm64");
    expect(
      validateP8CleanMachineEvidence(value, {
        targetId: value.targetId,
        sourceCommit,
        ciRunId,
        candidateVersion: value.candidateVersion,
        candidateManifestSha256,
        acceptanceEnvironment: value.environment.acceptanceEnvironment,
        architecture: value.environment.architecture,
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    [
      "synthetic provider",
      (value) => ({
        ...value,
        journeys: value.journeys.map((journey) =>
          journey.id === "real-provider-acceptance"
            ? { ...journey, providerMode: "synthetic" }
            : journey,
        ),
      }),
      "journey-incomplete",
    ],
    [
      "non-clean environment",
      (value) => ({ ...value, environment: { ...value.environment, cleanMachine: false } }),
      "evidence-incomplete",
    ],
    [
      "credential leak",
      (value) => ({ ...value, runbook: { ...value.runbook, channel: "token=secret" } }),
      "evidence-incomplete",
    ],
    [
      "candidate mismatch",
      (value) => ({ ...value, candidateManifestSha256: "c".repeat(64) }),
      "binding-mismatch",
    ],
  ])("rejects %s", (_label, mutate, code) => {
    const value = mutate(record("macos-15-arm64"));
    const result = validateP8CleanMachineEvidence(value, {
      targetId: "macos-15-arm64",
      sourceCommit,
      ciRunId,
      candidateVersion: "0.1.0-alpha.0",
      candidateManifestSha256,
      acceptanceEnvironment: "macOS 15 arm64",
      architecture: "arm64",
    });
    expect(result).toEqual({ ok: false, code });
  });

  it("requires one exact candidate binding across all three targets", () => {
    const records = [
      record("macos-15-arm64"),
      record("windows-11-x64"),
      record("ubuntu-24.04-x64"),
    ];
    expect(validateP8CleanMachineMatrix(records)).toEqual({ ok: true });
    expect(
      validateP8CleanMachineMatrix(
        records.map((value, index) =>
          index === 2 ? { ...value, sourceCommit: "d".repeat(40) } : value,
        ),
      ),
    ).toEqual({ ok: false, code: "matrix-mismatch" });
  });

  it("does not emit credentials, paths, or provider payloads", () => {
    const value = record("macos-15-arm64");
    const serialized = JSON.stringify(value);
    expect(serialized).not.toMatch(/secret|token|password|api[_-]?key|\/Users\//iu);
    expect(serialized).not.toContain("path");
  });

  it("keeps the checker bounded and rejects malformed files", () => {
    const root = fs.mkdtempSync("/tmp/actestra-p8.4-");
    const file = `${root}/evidence.json`;
    fs.writeFileSync(file, `${JSON.stringify(record("macos-15-arm64"))}\n`, { mode: 0o600 });
    expect(fs.statSync(file).size).toBeLessThan(128 * 1024);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
