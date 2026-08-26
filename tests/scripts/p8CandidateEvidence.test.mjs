// @vitest-environment node

import fs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleP8Candidate,
  buildP8CandidateManifest,
  sha256File,
  validateP8CandidateManifest,
  validateP8CandidateMatrix,
} from "../../scripts/p8-candidate-evidence.mjs";
import { P8_PRODUCT_JOURNEY_IDS } from "../../scripts/p8-product-journey-evidence.mjs";

const sourceCommit = "a".repeat(40);
const ciRunId = "32879077165";
const digest = (character) => character.repeat(64);
const hexDigest = (offset) => "abcdef"[offset % 6].repeat(64);
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function targetEvidence(targetId, packageFormats, index) {
  return {
    targetId,
    platform: targetId.startsWith("macos")
      ? "darwin"
      : targetId.startsWith("windows")
        ? "win32"
        : "linux",
    architecture: targetId.startsWith("macos") ? "arm64" : "x64",
    packages: packageFormats.map((format, packageIndex) => ({
      format,
      sha256: hexDigest(index + packageIndex),
    })),
    runtime: {
      executableSha256: hexDigest(2 + index),
      appAsarSha256: hexDigest(3 + index),
    },
    journeyEvidenceSha256: hexDigest(4 + index),
    runner: {
      manifestSha256: hexDigest(0 + index),
      executableSha256: hexDigest(1 + index),
      containmentEvidenceSha256: hexDigest(5 - index),
    },
    sbom: {
      format: "CycloneDX",
      specVersion: "1.6",
      sha256: hexDigest(1 + index),
    },
    provenance: {
      sourceCommit,
      ciRunId,
      builder: targetId.startsWith("macos")
        ? "macos-15"
        : targetId.startsWith("windows")
          ? "windows-2025"
          : "ubuntu-24.04",
    },
    notices: {
      sha256: hexDigest(2 + index),
      files: ["THIRD_PARTY_NOTICES.md", "GOOSE-APACHE-2.0.txt"],
    },
    signing: {
      status: "signed",
      identity: `Actestra Internal Beta ${targetId}`,
      notarization: targetId.startsWith("macos") ? "notarized" : "not-applicable",
      verificationSha256: hexDigest(3 + index),
    },
  };
}

function completeManifest() {
  return buildP8CandidateManifest({
    sourceCommit,
    ciRunId,
    version: "0.1.0-alpha.0",
    targets: [
      targetEvidence("macos-15-arm64", ["dmg", "zip"], 0),
      targetEvidence("windows-11-x64", ["nsis"], 1),
      targetEvidence("ubuntu-24.04-x64", ["deb"], 2),
    ],
    update: {
      channel: "internal-beta",
      endpoint: "https://updates.actestra.example/internal-beta",
      metadataSha256: digest("a"),
      signingAuthority: "actestra-update-key-v1",
    },
    rollback: {
      previousVersion: "0.0.9-alpha.0",
      stateSchema: 23,
      strategy: "restore-previous-candidate-on-update-failure",
      failureAction: "retain-state-and-require-operator-confirmation",
      proofSha256: digest("b"),
    },
  });
}

describe("P8.3 candidate integrity and update-trust contract", () => {
  it("builds and validates one exact three-target candidate manifest", () => {
    const manifest = completeManifest();
    expect(validateP8CandidateManifest(manifest)).toEqual({ ok: true });
    expect(validateP8CandidateMatrix(manifest)).toEqual({ ok: true });
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      status: "verified",
      sourceCommit,
      ciRunId,
      version: "0.1.0-alpha.0",
    });
  });

  it.each([
    [
      "mixed source commit",
      (manifest) => ({
        ...manifest,
        targets: manifest.targets.map((target, index) =>
          index === 1
            ? { ...target, provenance: { ...target.provenance, sourceCommit: "b".repeat(40) } }
            : target,
        ),
      }),
      "source-mismatch",
    ],
    [
      "missing target",
      (manifest) => ({ ...manifest, targets: manifest.targets.slice(0, 2) }),
      "target-matrix-incomplete",
    ],
    [
      "ad-hoc signing",
      (manifest) => ({
        ...manifest,
        targets: manifest.targets.map((target) => ({
          ...target,
          signing: { ...target.signing, status: "ad-hoc" },
        })),
      }),
      "signing-incomplete",
    ],
    [
      "missing update metadata",
      (manifest) => ({ ...manifest, update: { ...manifest.update, metadataSha256: "" } }),
      "update-trust-incomplete",
    ],
    [
      "rollback version drift",
      (manifest) => ({
        ...manifest,
        rollback: { ...manifest.rollback, previousVersion: manifest.version },
      }),
      "rollback-invalid",
    ],
  ])("rejects %s", (_label, mutate, code) => {
    const result = validateP8CandidateManifest(mutate(completeManifest()));
    expect(result).toEqual({ ok: false, code });
  });

  it("never reports a candidate when signing or notarization is unavailable", () => {
    const manifest = buildP8CandidateManifest({
      ...completeManifest(),
      targets: completeManifest().targets.map((target) => ({
        ...target,
        signing: { ...target.signing, status: "unavailable" },
      })),
    });
    expect(manifest.status).toBe("evidence-incomplete");
    expect(validateP8CandidateMatrix(manifest)).toEqual({
      ok: false,
      code: "candidate-incomplete",
    });
  });

  it("assembles hashes from exact files and never emits descriptor paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "actestra-p8-candidate-"));
    roots.push(root);
    const source = sourceCommit;
    const files = {};
    const create = async (name, contents) => {
      const filePath = path.join(root, name);
      await writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 });
      files[name] = filePath;
      return filePath;
    };
    const targetInputs = [];
    for (const [index, [targetId, formats]] of [
      ["macos-15-arm64", ["dmg", "zip"]],
      ["windows-11-x64", ["nsis"]],
      ["ubuntu-24.04-x64", ["deb"]],
    ].entries()) {
      const packagePaths = {};
      for (const format of formats)
        packagePaths[format] = await create(`${targetId}.${format}`, format);
      const executablePath = await create(`${targetId}-app`, "app");
      const appAsarPath = await create(`${targetId}-asar`, "asar");
      const runnerExecutablePath = await create(`${targetId}-runner`, "runner");
      const runnerManifestPath = await create(
        `${targetId}-runner-manifest.json`,
        JSON.stringify({
          provenance: { actestraCommit: source },
          runner: {
            targetTriple:
              targetId === "macos-15-arm64"
                ? "aarch64-apple-darwin"
                : targetId === "windows-11-x64"
                  ? "x86_64-pc-windows-msvc"
                  : "x86_64-unknown-linux-gnu",
            executable: { sha256: sha256File(runnerExecutablePath) },
          },
        }),
      );
      const runnerContainmentEvidencePath = await create(
        `${targetId}-containment.json`,
        JSON.stringify({
          status: "verified",
          sourceCommit: source,
          executableSha256: sha256File(runnerExecutablePath),
        }),
      );
      const sbomPath = await create(
        `${targetId}-sbom.json`,
        JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.6" }),
      );
      const noticePaths = [
        await create("THIRD_PARTY_NOTICES.md", "notices"),
        await create("GOOSE-APACHE-2.0.txt", "license"),
      ];
      const signingVerificationPath = await create(`${targetId}-signing.json`, "signed");
      const runner = {
        manifestSha256: sha256File(runnerManifestPath),
        executableSha256: sha256File(runnerExecutablePath),
        containmentEvidenceSha256: sha256File(runnerContainmentEvidencePath),
      };
      const runtime = {
        executableSha256: sha256File(executablePath),
        appAsarSha256: sha256File(appAsarPath),
      };
      const packages = formats.map((format) => ({
        format,
        sha256: sha256File(packagePaths[format]),
      }));
      const journeyEvidence = {
        schemaVersion: 1,
        status: "verified",
        targetId,
        sourceCommit: source,
        ciRunId,
        packages,
        executableSha256: runtime.executableSha256,
        appAsarSha256: runtime.appAsarSha256,
        runner: { packaged: true, ...runner },
        journeyResultSha256: hexDigest(index),
        packageStructure: true,
        gracefulExit: true,
        residualProcessCount: 0,
        journeys: P8_PRODUCT_JOURNEY_IDS.map((id) => ({
          id,
          status: "verified",
          residualProcessCount: 0,
        })),
      };
      const journeyEvidencePath = await create(
        `${targetId}-journeys.json`,
        `${JSON.stringify(journeyEvidence)}\n`,
      );
      targetInputs.push({
        targetId,
        packages: packagePaths,
        runtimeExecutablePath: executablePath,
        appAsarPath,
        journeyEvidencePath,
        runnerManifestPath,
        runnerExecutablePath,
        runnerContainmentEvidencePath,
        sbomPath,
        noticePaths,
        signing: {
          status: "signed",
          identity: `verified-${targetId}`,
          notarization: targetId === "macos-15-arm64" ? "notarized" : "not-applicable",
          verificationPath: signingVerificationPath,
        },
      });
    }
    const assembled = assembleP8Candidate({
      sourceCommit: source,
      ciRunId,
      version: "0.1.0-alpha.0",
      targets: targetInputs,
      update: completeManifest().update,
      rollback: completeManifest().rollback,
    });
    expect(assembled.status).toBe("verified");
    expect(JSON.stringify(assembled)).not.toContain(root);
    expect(JSON.stringify(assembled)).not.toMatch(/Path|credential|secret|token/i);
  });
});
