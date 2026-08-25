// @vitest-environment node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const buildScript = path.join(repositoryRoot, "scripts", "build-aionui-dev-app.mjs");

function readBuildScript() {
  return fs.readFileSync(buildScript, "utf8");
}

// The rejection paths are executed rather than grepped: the guard runs before
// materialize, so an unsafe override exits non-zero without building anything.
function runWithOutputDir(outputDir) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-build-guard-bin-"));
  const fakeBun = path.join(fakeBin, "bun");
  fs.writeFileSync(fakeBun, "#!/bin/sh\nexit 97\n", { mode: 0o755 });
  try {
    return spawnSync(process.execPath, [buildScript], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ACTESTRA_AIONUI_BUILD_OUTPUT_DIR: outputDir,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
}

describe("build-aionui-dev-app", () => {
  describe("output directory safety", () => {
    it("rejects relative paths", () => {
      const result = runWithOutputDir("relative/build/output");
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/must be absolute/i);
    });

    it("rejects paths under ~/Desktop", () => {
      const result = runWithOutputDir(path.join(os.homedir(), "Desktop", "actestra-build"));
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/must not be under.*Desktop/i);

      const source = readBuildScript();
      expect(source).toMatch(/File Provider.*com\.apple\.FinderInfo/i);
    });

    it("rejects paths inside the repository", () => {
      const result = runWithOutputDir(path.join(repositoryRoot, "out-build"));
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/must not be inside the repository/i);
    });

    it("rejects broad filesystem, home, and temporary roots", () => {
      const cases = [
        { outputDir: path.parse(repositoryRoot).root, reason: /filesystem root/i },
        { outputDir: os.homedir(), reason: /user home directory/i },
        { outputDir: os.tmpdir(), reason: /system temporary directory/i },
      ];

      for (const { outputDir, reason } of cases) {
        const result = runWithOutputDir(outputDir);
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toMatch(reason);
      }
    });

    it("rejects a symlink whose real target is inside the repository", () => {
      const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-build-output-alias-"));
      const outputAlias = path.join(aliasRoot, "output");
      fs.symlinkSync(repositoryRoot, outputAlias, "dir");
      try {
        const result = runWithOutputDir(outputAlias);
        expect(result.status).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toMatch(/resolve inside the repository/i);
      } finally {
        fs.rmSync(aliasRoot, { recursive: true, force: true });
      }
    });

    it("does not reject a sibling directory sharing the repository name prefix", () => {
      const source = readBuildScript();
      expect(source).toContain("candidate === root");
      expect(source).toContain("`${root}${path.sep}`");
    });

    it("validates the output directory before materializing or building", () => {
      const source = readBuildScript();
      const mainBody = source.match(/function main\(\) \{([\s\S]+?)\n\}/)?.[1] ?? "";
      expect(mainBody.indexOf("resolveOutputDirectory")).toBeGreaterThan(-1);
      expect(mainBody.indexOf("resolveOutputDirectory")).toBeLessThan(
        mainBody.indexOf("materializeDownstream"),
      );
    });

    it("defaults to ~/Library/Caches/Actestra/builds/<worktree-hash>", () => {
      const source = readBuildScript();
      expect(source).toContain("function computeWorktreeHash");
      expect(source).toContain('git", ["rev-parse", "--show-toplevel"]');
      expect(source).toContain("createHash");
      expect(source).toContain("Library");
      expect(source).toContain("Caches");
      expect(source).toContain("Actestra");
      expect(source).toContain("builds");
      expect(source).toMatch(/worktreeHash|computeWorktreeHash/);
    });

    it("allows ACTESTRA_AIONUI_BUILD_OUTPUT_DIR override", () => {
      const source = readBuildScript();
      expect(source).toContain("ACTESTRA_AIONUI_BUILD_OUTPUT_DIR");
      expect(source).toContain("function resolveOutputDirectory");
      expect(source).toMatch(/if \(process\.env\.ACTESTRA_AIONUI_BUILD_OUTPUT_DIR\)/);
    });
  });

  describe("build environment", () => {
    it("always sets CSC_IDENTITY_AUTO_DISCOVERY=false", () => {
      const source = readBuildScript();
      expect(source).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
      expect(source).toMatch(/CSC_IDENTITY_AUTO_DISCOVERY.*false/);
      expect(source).toMatch(/function buildApp/);
    });

    it("passes --config.directories.output to electron-builder", () => {
      const source = readBuildScript();
      expect(source).toContain("--config.directories.output");
      expect(source).toContain("dist:mac");
      expect(source).toContain("--arm64");
      expect(source).toContain("--dir");
    });

    it("sets AIONUI_HUB_SKIP=1", () => {
      const source = readBuildScript();
      expect(source).toContain("AIONUI_HUB_SKIP");
      expect(source).toMatch(/AIONUI_HUB_SKIP.*1/);
    });

    it("uses the installed frozen Electron distribution instead of downloading it again", () => {
      const source = readBuildScript();
      expect(source).toContain("function resolveElectronDistribution");
      expect(source).toContain('path.join(materializedRoot, "node_modules", "electron", "dist")');
      expect(source).toContain("--config.electronDist");
      expect(source).toMatch(/--config\.electronDist=\$\{resolveElectronDistribution\(\)\}/u);
    });

    it("uses the standard Electron install cache while preserving an explicit override", () => {
      const source = readBuildScript();
      expect(source).toContain("function resolveElectronCache");
      expect(source).toContain("process.env.electron_config_cache");
      expect(source).toContain("process.env.ELECTRON_CACHE");
      expect(source).toContain('path.join(os.homedir(), "Library", "Caches", "electron")');
      expect(source).toMatch(/electron_config_cache:\s*resolveElectronCache\(\)/u);
      expect(source).toMatch(/ELECTRON_CACHE:\s*resolveElectronCache\(\)/u);
    });
  });

  describe("build verification", () => {
    it("checks Contents/Info.plist, Contents/MacOS/Actestra, Contents/Resources/app.asar", () => {
      const source = readBuildScript();
      expect(source).toContain("function verifyApp");
      expect(source).toContain("Contents/Info.plist");
      expect(source).toContain("Contents/MacOS/Actestra");
      expect(source).toContain("Contents/Resources/app.asar");
      expect(source).toMatch(/Incomplete.*\.app.*bundle/i);
    });

    it("runs codesign --verify --deep --strict and fails if it fails", () => {
      const source = readBuildScript();
      expect(source).toMatch(/codesign.*--verify.*--deep.*--strict/);
      expect(source).toMatch(/verifyResult\.status.*0/);
      expect(source).toMatch(/codesign --verify failed/i);
    });

    it("requires Signature=adhoc", () => {
      const source = readBuildScript();
      expect(source).toMatch(/codesign.*-dv/);
      expect(source).toMatch(/Signature=adhoc/i);
      expect(source).toMatch(/Expected ad-hoc signature/i);
    });

    it("does not create smoke link if build fails", () => {
      const source = readBuildScript();
      const buildIndex = source.indexOf("function buildApp");
      const verifyIndex = source.indexOf("function verifyApp");
      const linkIndex = source.indexOf("function atomicLinkOutput");
      const mainBody = source.match(/function main\(\) \{([^}]+)\}/)?.[1] ?? "";

      expect(buildIndex).toBeGreaterThan(0);
      expect(verifyIndex).toBeGreaterThan(0);
      expect(linkIndex).toBeGreaterThan(0);
      expect(mainBody).toContain("buildApp");
      expect(mainBody).toContain("verifyApp");
      expect(mainBody).toContain("atomicLinkOutput");
      expect(mainBody.indexOf("buildApp")).toBeLessThan(mainBody.indexOf("verifyApp"));
      expect(mainBody.indexOf("verifyApp")).toBeLessThan(mainBody.indexOf("atomicLinkOutput"));
    });

    it("does not create smoke link if verification fails", () => {
      const source = readBuildScript();
      expect(source).toMatch(/if \(verifyResult\.status !== 0\)/);
      expect(source).toMatch(/fail\(`codesign --verify failed/);
      expect(source).toContain("function atomicLinkOutput");
      const verifyFailIndex = source.indexOf("if (verifyResult.status !== 0)");
      const linkFnIndex = source.indexOf("function atomicLinkOutput");
      expect(verifyFailIndex).toBeLessThan(linkFnIndex);
    });

    it("atomically replaces the smoke link only after all verification passes", () => {
      const source = readBuildScript();
      expect(source).toContain("function atomicLinkOutput");
      expect(source).toMatch(/tempLink.*process\.pid/);
      expect(source).toMatch(/symlinkSync.*tempLink/);
      expect(source).toMatch(/renameSync.*tempLink.*linkTarget/);
    });

    it("replaces a real out/mac-arm64 directory left by a non-wrapper build", () => {
      // renameSync over a real directory fails with EISDIR, so the leftover
      // directory must be removed before the symlink is swapped in.
      const source = readBuildScript();
      const linkBody = source.match(/function atomicLinkOutput[\s\S]+?\n\}/)?.[0] ?? "";
      expect(linkBody).toContain("lstatSync(linkTarget");
      expect(linkBody).toContain("isSymbolicLink()");
      expect(linkBody).toMatch(/rmSync\(linkTarget/);
      expect(linkBody.indexOf("rmSync(linkTarget")).toBeLessThan(
        linkBody.indexOf("renameSync(tempLink"),
      );
    });
  });

  describe("materialize and build order", () => {
    it("materializes downstream before building", () => {
      const source = readBuildScript();
      expect(source).toContain("function materializeDownstream");
      expect(source).toContain("downstream:aionui:materialize");
      const mainBody = source.match(/function main\(\) \{([^}]+)\}/)?.[1] ?? "";
      expect(mainBody.indexOf("materializeDownstream")).toBeLessThan(mainBody.indexOf("buildApp"));
    });

    it("installs the frozen downstream lockfile after materializing and before building", () => {
      const source = readBuildScript();
      expect(source).toContain("function installDownstreamDependencies");
      expect(source).toContain('"install", "--cwd", materializedRoot, "--frozen-lockfile"');
      const mainBody = source.match(/function main\(\) \{([\s\S]+?)\n\}/)?.[1] ?? "";
      expect(mainBody.indexOf("materializeDownstream")).toBeGreaterThan(-1);
      expect(mainBody.indexOf("installDownstreamDependencies")).toBeGreaterThan(-1);
      expect(mainBody.indexOf("buildApp")).toBeGreaterThan(-1);
      expect(mainBody.indexOf("materializeDownstream")).toBeLessThan(
        mainBody.indexOf("installDownstreamDependencies"),
      );
      expect(mainBody.indexOf("installDownstreamDependencies")).toBeLessThan(
        mainBody.indexOf("buildApp"),
      );
    });
  });
});
