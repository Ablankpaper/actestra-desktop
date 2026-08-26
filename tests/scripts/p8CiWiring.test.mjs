// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function readWorkflowJob(workflow, jobId) {
  const start = workflow.indexOf(`\n  ${jobId}:`);
  if (start === -1) return "";
  const end = workflow.slice(start + 1).search(/\n  [A-Za-z0-9_-]+:\n/u);
  return workflow.slice(start, end === -1 ? workflow.length : start + 1 + end);
}

function expectOrderedFragments(contents, fragments) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = contents.indexOf(fragment, cursor + 1);
    expect(next, `missing or out-of-order CI fragment: ${fragment}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function expectBoundedJourneyUpload(job, targetId) {
  const file = `out/p8-evidence/p8-product-journeys-${targetId}.json`;
  const artifactName = `p8-product-journeys-${targetId}-${"${{ github.sha }}"}`;
  const uploadStart = job.indexOf(`name: ${artifactName}`);
  expect(uploadStart).toBeGreaterThan(-1);
  const nextStep = job.indexOf("\n      - name:", uploadStart);
  const upload = job.slice(uploadStart, nextStep === -1 ? job.length : nextStep);
  expect(upload).toContain(`path: ${file}`);
  expect(upload).toContain("if-no-files-found: error");
  expect(upload).toContain("retention-days: 3");
  expect(upload).toContain("compression-level: 0");
  for (const forbidden of ["user-data/**", "profiles/**", "*.log", "resources/**"]) {
    expect(upload).not.toContain(forbidden);
  }
}

function expectCommonJourneyArguments(job, targetId) {
  expect(job).toContain("Run P8.2 packaged product-journey acceptance");
  expect(job).toContain(`--target ${targetId}`);
  expect(job).toContain("--source-commit ${{ github.sha }}");
  expect(job).toContain('--ci-run-id "${{ github.run_id }}"');
  expect(job).toContain("--runner-manifest");
  expect(job).toContain("--runner-executable");
  expect(job).toContain("--runner-containment");
  expect(job).toContain(`--evidence out/p8-evidence/p8-product-journeys-${targetId}.json`);
  expectBoundedJourneyUpload(job, targetId);
}

describe("P8.2 packaged product-journey CI wiring", () => {
  it("runs the Windows package, exact NSIS, and packaged runner with bound containment evidence", () => {
    const job = readWorkflowJob(read(".github/workflows/ci.yml"), "electron-package-windows");
    expect(job).not.toBe("");
    expect(job).toContain("needs:");
    expect(job).toContain("goose-runner-windows");
    expect(job).toContain("goose-containment-windows");
    expect(job).toContain('$manifest.runner.targetTriple -ne "x86_64-pc-windows-msvc"');
    expectOrderedFragments(job, [
      "Re-admit Goose runner from the final Windows package resources",
      "Run P8.2 packaged product-journey acceptance",
      'Join-Path $outputRoot "win-unpacked/Actestra.exe"',
      'Get-ChildItem -LiteralPath $outputRoot -Filter "*.exe" -File',
      "bun run smoke:p8-product-journeys --",
      "--target windows-11-x64",
      '--runtime "$runtimePath"',
      '--package "nsis=$($installers[0].FullName)"',
      "--source-commit ${{ github.sha }}",
      '--ci-run-id "${{ github.run_id }}"',
      '--runner-manifest "$manifestDigest"',
      '--runner-executable "$executableDigest"',
      '--runner-containment "$containmentDigest"',
      "--evidence out/p8-evidence/p8-product-journeys-windows-11-x64.json",
      "Run P8.2d packaged fresh-profile acceptance",
    ]);
    expectCommonJourneyArguments(job, "windows-11-x64");
  });

  it("runs the installed Ubuntu package under Xvfb with its exact DEB and containment record", () => {
    const job = readWorkflowJob(read(".github/workflows/ci.yml"), "goose-containment-linux");
    expect(job).not.toBe("");
    expect(job).toContain('manifest?.runner?.targetTriple === "x86_64-unknown-linux-gnu"');
    expectOrderedFragments(job, [
      "Run exact Ubuntu containment acceptance",
      "Install complete Ubuntu Electron package for P8.2d",
      "Run P8.2 packaged product-journey acceptance under Xvfb",
      "xvfb-run -a bun run smoke:p8-product-journeys --",
      "--target ubuntu-24.04-x64",
      "--runtime /opt/Actestra/Actestra",
      '--package "deb=$ACTESTRA_LINUX_DEB_PATH"',
      "--source-commit ${{ github.sha }}",
      '--ci-run-id "${{ github.run_id }}"',
      '--runner-manifest "$manifest_digest"',
      '--runner-executable "$executable_digest"',
      '--runner-containment "$containment_digest"',
      "--evidence out/p8-evidence/p8-product-journeys-ubuntu-24.04-x64.json",
      "Run P8.2d packaged fresh-profile acceptance under Xvfb",
      "Remove complete Ubuntu Electron package",
    ]);
    expectCommonJourneyArguments(job, "ubuntu-24.04-x64");
  });

  it("generates real macOS P7 platform evidence before binding the app, DMG, ZIP, and runner", () => {
    const job = readWorkflowJob(read(".github/workflows/ci.yml"), "macos");
    expect(job).not.toBe("");
    expect(job).toContain('manifest?.runner?.targetTriple === "aarch64-apple-darwin"');
    expectOrderedFragments(job, [
      "Re-admit Goose runner from the final macOS package resources",
      "Record bounded macOS P7 platform evidence",
      "Run P8.2 packaged product-journey acceptance",
      "bun run smoke:p8-product-journeys --",
      "--target macos-15-arm64",
      "--runtime .actestra/aionui-v2.1.41/out/mac-arm64/Actestra.app",
      '--package "dmg=$dmg_path"',
      '--package "zip=$zip_path"',
      "--source-commit ${{ github.sha }}",
      '--ci-run-id "${{ github.run_id }}"',
      '--runner-manifest "$manifest_digest"',
      '--runner-executable "$executable_digest"',
      '--runner-containment "$containment_digest"',
      "--evidence out/p8-evidence/p8-product-journeys-macos-15-arm64.json",
      "Run P8.2d packaged fresh-profile acceptance",
    ]);
    expect(job).toContain("p8-macos-platform-evidence.json");
    expect(job).toContain("bun run smoke:p7-security");
    expect(job).toContain("bun run smoke:p7-2-resource-reliability");
    expect(job).toContain("bun run smoke:p7-4-diagnostic-audit");
    expectCommonJourneyArguments(job, "macos-15-arm64");
  });
});
