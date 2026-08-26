// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

function readWorkflowJob(workflow, jobId) {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  if (start === -1) return "";
  const tail = workflow.slice(start + 1);
  const nextJob = tail.search(/\n  [A-Za-z0-9_-]+:\n/u);
  return workflow.slice(start, nextJob === -1 ? workflow.length : start + 1 + nextJob);
}

function expectOrderedFragments(contents, fragments) {
  const normalized = contents.replace(/\s+/gu, " ");
  let cursor = -1;
  for (const fragment of fragments) {
    const next = normalized.indexOf(fragment.replace(/\s+/gu, " "), cursor + 1);
    expect(next, `missing or out-of-order package binding fragment: ${fragment}`).toBeGreaterThan(
      cursor,
    );
    cursor = next;
  }
}

const targets = Object.freeze([
  {
    job: "macos",
    triple: "aarch64-apple-darwin",
    packageMarker: "Build native macOS DMG and ZIP from the verified app",
    packageCommand: "electron-builder --config packages/desktop/electron-builder.yml --mac dmg zip",
    buildMarker: "Build exact Goose runner artifact for final package",
    admitMarker: "Admit exact Goose runner artifact for final package",
  },
  {
    job: "electron-package-windows",
    triple: "x86_64-pc-windows-msvc",
    packageMarker: "Build native Windows NSIS and unpacked application",
    packageCommand: "dist:win",
    buildMarker: "Build exact Goose runner artifact for final package",
    admitMarker: "Admit exact Goose runner artifact for final package",
  },
  {
    job: "goose-containment-linux",
    triple: "x86_64-unknown-linux-gnu",
    packageMarker: "Build and inspect exact Ubuntu DEB package",
    packageCommand: "dist:linux",
    buildMarker: "Build exact Ubuntu Goose runner artifact",
    admitMarker: "Admit exact Ubuntu Goose runner artifact",
  },
]);

describe("P8.2 package-bound Goose runner binding", () => {
  it("declares a target-neutral staging and installed-package admission boundary", () => {
    const packageJson = JSON.parse(read("package.json"));
    const stagePath = path.join(repositoryRoot, "scripts/stage-aionui-goose-package.ts");
    const admitPath = path.join(repositoryRoot, "scripts/admit-aionui-goose-package.ts");
    expect(fs.existsSync(stagePath)).toBe(true);
    expect(fs.existsSync(admitPath)).toBe(true);
    expect(packageJson.scripts["downstream:aionui:stage:goose"]).toBe(
      "bun scripts/stage-aionui-goose-package.ts",
    );
    expect(packageJson.scripts["downstream:aionui:admit:goose-package"]).toBe(
      "bun scripts/admit-aionui-goose-package.ts",
    );
    if (!fs.existsSync(stagePath) || !fs.existsSync(admitPath)) return;

    const stage = read("scripts/stage-aionui-goose-package.ts");
    const admit = read("scripts/admit-aionui-goose-package.ts");
    const contract = `${stage}\n${admit}`;
    for (const source of [contract]) {
      expect(source).toContain("admitGooseRunnerArtifact");
      expect(source).toContain("actestra-goose-runner");
      expect(source).toContain("actestra-goose-runner.manifest.json");
      expect(source).toContain("actestra-goose-runner.cdx.json");
      expect(source).toContain("actestra-goose-runner.audit.json");
      expect(source).toContain("Cargo.lock");
      expect(source).toContain("GOOSE-APACHE-2.0.txt");
      expect(source).toContain("actestra-goose-runner-package.json");
      expect(source).toContain("trustedManifestSha256");
      expect(source).toContain("sourceCommit");
    }
    expect(stage).toContain("GOOSE_PACKAGE_RESOURCE_DIRECTORY");
    expect(stage).toContain("GOOSE_PACKAGE_RUNNER_DIRECTORY");
    expect(admit).toContain("packageResource");
    expect(admit).toContain("re-admit");
    expect(admit).not.toContain("ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY");
  });

  it.each(targets)(
    "$job binds the exact $triple runner before and inside the final package",
    ({ job, triple, packageMarker, packageCommand, buildMarker, admitMarker }) => {
      const workflow = readWorkflowJob(read(".github/workflows/ci.yml"), job);
      expect(workflow, `missing CI job ${job}`).not.toBe("");
      if (job === "electron-package-windows") {
        expectOrderedFragments(workflow, [
          "needs: goose-runner-windows",
          "name: Install dependencies",
          "name: Download admitted Windows Goose runner artifact",
          "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
          "name: actestra-goose-runner-windows-${{ github.sha }}",
          "path: .actestra/goose-runner/x86_64-pc-windows-msvc",
          `bun run downstream:aionui:stage:goose -- --target-triple ${triple}`,
          `name: ${packageMarker}`,
          packageCommand,
          `bun run downstream:aionui:admit:goose-package -- --target-triple ${triple}`,
        ]);
        expect(workflow).not.toContain(`name: ${buildMarker}`);
        expect(workflow).not.toContain("bun run goose:runner:build");
        expect(workflow).not.toContain(`name: ${admitMarker}`);
      } else {
        expectOrderedFragments(workflow, [
          "name: Install dependencies",
          `name: ${buildMarker}`,
          "bun run goose:runner:build",
          `name: ${admitMarker}`,
          "bun run goose:runner:admit-build",
          `bun run downstream:aionui:stage:goose -- --target-triple ${triple}`,
          `name: ${packageMarker}`,
          packageCommand,
          `bun run downstream:aionui:admit:goose-package -- --target-triple ${triple}`,
        ]);
      }
      expect(workflow).toContain("--materialized-root .actestra/aionui-v2.1.41");
      expect(workflow).toContain("--package-resource");
      expect(workflow).toContain("--re-admit");
      const journeyStart = workflow.indexOf("name: Run P8.2d packaged fresh-profile acceptance");
      const packageWindow = workflow.slice(0, journeyStart === -1 ? workflow.length : journeyStart);
      expect(packageWindow).not.toContain("ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY");
      const journeyWindow = workflow.slice(journeyStart === -1 ? 0 : journeyStart);
      expect(journeyWindow).not.toContain("--artifact-directory .actestra/goose-runner");
    },
  );

  it("maps the runner resources into every native builder without a platform-only exception", () => {
    const overlay = JSON.parse(read("downstream/aionui-v2.1.41/overlay.json"));
    const patch = overlay.patches.find(
      (entry) => entry.path === "patches/0021-actestra-ubuntu-apparmor-bootstrap.mjs",
    );
    expect(patch).toMatchObject({ classification: ["R1"] });
    expect(overlay.expectedChangedFiles).toContain("packages/desktop/electron-builder.yml");
    const checker = read("scripts/check-aionui-downstream.mjs");
    expect(checker).toContain("actestra-goose-runner-package.json");
    expect(checker).toContain("resources/actestra-goose-runner");
    expect(checker).toContain("mac");
    expect(checker).toContain("win");
    expect(checker).toContain("linux");
    expect(checker).toContain("package-bound Goose runner");
  });

  it("does not accept a CI workspace runner directory as packaged product evidence", () => {
    const workflow = read(".github/workflows/ci.yml");
    for (const { job } of targets) {
      const packageJob = readWorkflowJob(workflow, job);
      const journeyStart = packageJob.indexOf("name: Run P8.2d packaged fresh-profile acceptance");
      const p8Window = packageJob.slice(0, journeyStart === -1 ? packageJob.length : journeyStart);
      expect(p8Window).not.toContain("ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY");
      expect(p8Window).not.toContain("--artifact-directory .actestra/goose-runner");
      expect(p8Window).toContain("--package-resource");
      expect(p8Window).toContain("--re-admit");
    }
  });

  it("makes packaged Main admit Goose only from Electron resources", () => {
    const teamPatch = read("downstream/aionui-v2.1.41/patches/0014-actestra-team-work.mjs");
    const checker = read("scripts/check-aionui-downstream.mjs");

    for (const source of [teamPatch, checker]) {
      expect(source).toContain(
        "runnerAdmission: app.isPackaged ? null : resolveTrustedActestraCodingRunnerAdmission(process.env)",
      );
      expect(source).toContain("packagedResourcesPath:");
      expect(source).toContain(
        "process.platform !== 'linux' && app.isPackaged ? process.resourcesPath : undefined",
      );
    }
  });
});
