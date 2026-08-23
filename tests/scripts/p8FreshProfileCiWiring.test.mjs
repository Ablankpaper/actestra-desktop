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

function expectBoundedEvidenceUpload(job, targetId) {
  const name = `p8-fresh-profile-${targetId}-${"${{ github.sha }}"}`;
  const file = `out/p8-evidence/p8-fresh-profile-${targetId}.json`;
  const uploadStart = job.indexOf(`name: ${name}`);
  expect(uploadStart).toBeGreaterThan(-1);
  const upload = job.slice(uploadStart, job.indexOf("\n      - name:", uploadStart));
  expect(upload).toContain(`path: ${file}`);
  expect(upload).toContain("if-no-files-found: error");
  expect(upload).toContain("retention-days: 3");
  expect(upload).toContain("compression-level: 0");
  for (const forbidden of ["user-data/**", "profiles/**", "*.log", "out/**", "resources/**"]) {
    expect(upload).not.toContain(forbidden);
  }
}

describe("P8.2d native Electron fresh-profile CI wiring", () => {
  it("publishes one root command for the bounded smoke runner", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts["smoke:p8-fresh-profile"]).toBe("node scripts/smoke-p8-fresh-profile.mjs");
  });

  it("builds macOS DMG and ZIP from the verified app and uploads only bounded evidence", () => {
    const job = readWorkflowJob(read(".github/workflows/ci.yml"), "macos");
    expect(job).not.toBe("");
    expect(job).toContain("runs-on: macos-15");
    expect(job).toContain("timeout-minutes: 45");
    expectOrderedFragments(job, [
      "Build local materialized AionUi app bundle",
      "bun run dist:mac -- --arm64 --dir --skip-vite",
      "Verify packaged identity and product boundary",
      "Build native macOS DMG and ZIP from the verified app",
      "bunx electron-builder --config packages/desktop/electron-builder.yml --mac dmg zip --arm64 --prepackaged out/mac-arm64/Actestra.app --publish never",
      "Run P8.2d packaged fresh-profile acceptance",
      "--target macos-15-arm64",
      "--runtime .actestra/aionui-v2.1.41/out/mac-arm64/Actestra.app",
      '--package "dmg=$dmg_path"',
      '--package "zip=$zip_path"',
      "--source-commit ${{ github.sha }}",
      "--evidence out/p8-evidence/p8-fresh-profile-macos-15-arm64.json",
    ]);
    expectBoundedEvidenceUpload(job, "macos-15-arm64");
  });

  it("adds one Windows 2025 Electron job for NSIS and win-unpacked runtime acceptance", () => {
    const job = readWorkflowJob(read(".github/workflows/ci.yml"), "electron-package-windows");
    expect(job).not.toBe("");
    expect(job).toContain("name: P8.2d Windows x64 native Electron package");
    expect(job).toContain("runs-on: windows-2025");
    expect(job).toContain(
      "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
    );
    expectOrderedFragments(job, [
      "bun install --frozen-lockfile",
      "bun run downstream:aionui:install",
      "bun run --cwd .actestra/aionui-v2.1.41 dist:win -- --x64",
      'Join-Path $outputRoot "win-unpacked/Actestra.exe"',
      'Get-ChildItem -LiteralPath $outputRoot -Filter "*.exe" -File',
      "bun run smoke:p8-fresh-profile --",
      "--target windows-11-x64",
      '--runtime "$runtimePath"',
      '--package "nsis=$($installers[0].FullName)"',
      "--source-commit ${{ github.sha }}",
      "--evidence out/p8-evidence/p8-fresh-profile-windows-11-x64.json",
    ]);
    expectBoundedEvidenceUpload(job, "windows-11-x64");
    expect(job).not.toContain("ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY");
    expect(job).not.toContain("API_KEY");
  });

  it("reuses the exact Ubuntu DEB, fully extracts /opt/Actestra, and launches under Xvfb", () => {
    const job = readWorkflowJob(read(".github/workflows/ci.yml"), "goose-containment-linux");
    expect(job).not.toBe("");
    expectOrderedFragments(job, [
      "Build and inspect exact Ubuntu DEB package",
      "Remove temporary Ubuntu Goose package layout",
      "Install complete Ubuntu Electron package for P8.2d",
      'dpkg-deb --extract "$ACTESTRA_LINUX_DEB_PATH" "$extract_root"',
      'sudo cp -a "$extract_root/opt/Actestra" /opt/Actestra',
      "Run P8.2d packaged fresh-profile acceptance under Xvfb",
      "xvfb-run -a bun run smoke:p8-fresh-profile --",
      "--target ubuntu-24.04-x64",
      "--runtime /opt/Actestra/Actestra",
      '--package "deb=$ACTESTRA_LINUX_DEB_PATH"',
      "--source-commit ${{ github.sha }}",
      "--evidence out/p8-evidence/p8-fresh-profile-ubuntu-24.04-x64.json",
      "Remove complete Ubuntu Electron package",
    ]);
    expectBoundedEvidenceUpload(job, "ubuntu-24.04-x64");
  });
});
