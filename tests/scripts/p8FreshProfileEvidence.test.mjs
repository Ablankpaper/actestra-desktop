// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  P8_FRESH_PROFILE_FAILURE_CODES,
  validateP8FreshProfileEvidence,
  validateP8FreshProfileFailureEvidence,
} from "../../scripts/p8-fresh-profile-evidence.mjs";

const digest = "a".repeat(64);
const commit = "b".repeat(40);

function validRecord() {
  return {
    schemaVersion: 1,
    status: "verified",
    targetId: "macos-15-arm64",
    sourceCommit: commit,
    packages: [
      { format: "dmg", sha256: digest },
      { format: "zip", sha256: digest },
    ],
    executableSha256: digest,
    appAsarSha256: digest,
    packageStructure: true,
    mainReady: true,
    rendererReady: true,
    providerIpc: true,
    directProviderFetchDenied: true,
    profileManifest: true,
    sqliteSchemaVersion: 23,
    providerCount: 0,
    providerUiState: "provider-unavailable",
    providerUiTextPresent: true,
    gracefulExit: true,
    residualProcessCount: 0,
  };
}

describe("P8.2d fresh-profile evidence contract", () => {
  it("keeps platform bootstrap and Provider UI diagnostics in the closed vocabulary", () => {
    expect(P8_FRESH_PROFILE_FAILURE_CODES).toEqual(
      expect.arrayContaining([
        "startup-timeout-bootstrap-home",
        "startup-timeout-bootstrap-temp",
        "startup-timeout-bootstrap-app-data",
        "startup-timeout-bootstrap-name",
        "startup-timeout-bootstrap-directories",
        "startup-timeout-bootstrap-session-data",
        "startup-timeout-bootstrap-logs",
        "startup-timeout-bootstrap-crash-dumps",
        "provider-ui-route-missing",
        "provider-ui-header-missing",
        "provider-ui-empty-state-missing",
        "provider-ui-text-missing",
      ]),
    );
  });

  it("accepts a complete record bound to the exact target and artifacts", async () => {
    expect(
      validateP8FreshProfileEvidence(validRecord(), {
        targetId: "macos-15-arm64",
        sourceCommit: commit,
        packages: [
          { format: "dmg", sha256: digest },
          { format: "zip", sha256: digest },
        ],
        executableSha256: digest,
        appAsarSha256: digest,
      }),
    ).toEqual({ ok: true });
  });

  it("accepts the exact Ubuntu target identifier from the closed P8 matrix", () => {
    const value = {
      ...validRecord(),
      targetId: "ubuntu-24.04-x64",
      packages: [{ format: "deb", sha256: digest }],
    };
    expect(
      validateP8FreshProfileEvidence(value, {
        targetId: value.targetId,
        sourceCommit: commit,
        packages: value.packages,
        executableSha256: value.executableSha256,
        appAsarSha256: value.appAsarSha256,
      }),
    ).toEqual({ ok: true });
  });

  it.each([
    ["extra key", (value) => (value.extra = true)],
    ["wrong target", (value) => (value.targetId = "windows-11-x64")],
    ["wrong package formats", (value) => (value.packages[0].format = "nsis")],
    ["package digest mismatch", (value) => (value.packages[0].sha256 = "c".repeat(64))],
    ["non-empty Provider projection", (value) => (value.providerCount = 1)],
    ["missing UI state", (value) => (value.providerUiState = "ready")],
    ["wrong SQLite schema", (value) => (value.sqliteSchemaVersion = 22)],
    ["residual process", (value) => (value.residualProcessCount = 1)],
    ["unredacted path field", (value) => (value.providerUiTextPresent = "/Users/private")],
  ])("rejects %s", async (_label, mutate) => {
    const value = validRecord();
    mutate(value);
    expect(
      validateP8FreshProfileEvidence(value, {
        targetId: "macos-15-arm64",
        sourceCommit: commit,
        packages: [
          { format: "dmg", sha256: digest },
          { format: "zip", sha256: digest },
        ],
        executableSha256: digest,
        appAsarSha256: digest,
      }).ok,
    ).toBe(false);
  });

  it("rejects a record bound to a different source or executable", async () => {
    const value = validRecord();
    expect(
      validateP8FreshProfileEvidence(value, {
        targetId: value.targetId,
        sourceCommit: "c".repeat(40),
        packages: value.packages,
        executableSha256: "d".repeat(64),
        appAsarSha256: value.appAsarSha256,
      }),
    ).toEqual({ ok: false, code: "artifact-mismatch" });
  });

  it("accepts only a closed failure record and never treats it as success", async () => {
    const failure = {
      schemaVersion: 1,
      status: "failed",
      targetId: "macos-15-arm64",
      sourceCommit: commit,
      code: "marker-missing",
    };
    expect(P8_FRESH_PROFILE_FAILURE_CODES).toContain("marker-missing");
    expect(
      validateP8FreshProfileFailureEvidence(failure, {
        targetId: failure.targetId,
        sourceCommit: commit,
      }),
    ).toEqual({ ok: true });
    expect(
      validateP8FreshProfileEvidence(failure, {
        targetId: failure.targetId,
        sourceCommit: commit,
        packages: [],
        executableSha256: digest,
        appAsarSha256: digest,
      }),
    ).toEqual({ ok: false, code: "invalid-evidence" });
    expect(
      validateP8FreshProfileFailureEvidence(
        { ...failure, code: "/Users/private/secret" },
        { targetId: failure.targetId, sourceCommit: commit },
      ),
    ).toEqual({ ok: false, code: "invalid-failure" });
  });
});
