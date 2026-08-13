import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const materializedRoot = path.join(repositoryRoot, ".actestra", "aionui-v2.1.41");

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function resolveRealOutputPath(outputDir) {
  let existingAncestor = outputDir;
  const missingSegments = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const realAncestor = fs.realpathSync.native(existingAncestor);
  return path.resolve(realAncestor, ...missingSegments);
}

function pathIsWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertSafeOutputDirectory(outputDir) {
  // Check the raw value: path.resolve always returns an absolute path, so
  // testing the resolved form would never reject a relative override.
  if (!path.isAbsolute(outputDir)) {
    fail(`Build output directory must be absolute: ${outputDir}`);
  }
  const lexical = path.resolve(outputDir);
  const resolved = resolveRealOutputPath(lexical);
  const repositoryRealRoot = fs.realpathSync.native(repositoryRoot);
  const homeRealRoot = fs.realpathSync.native(os.homedir());
  const temporaryRealRoot = fs.realpathSync.native(os.tmpdir());
  const desktopRealRoot = resolveRealOutputPath(path.join(os.homedir(), "Desktop"));

  if (resolved === path.parse(resolved).root) {
    fail(`Build output directory must not be a filesystem root: ${resolved}`);
  }
  if (resolved === homeRealRoot) {
    fail(`Build output directory must not be the user home directory: ${resolved}`);
  }
  if (resolved === temporaryRealRoot) {
    fail(`Build output directory must not be the system temporary directory: ${resolved}`);
  }
  // Repository containment is checked before the ~/Desktop rule so a path that
  // is both reports the more specific reason.
  if (pathIsWithin(resolved, repositoryRealRoot)) {
    const reason = pathIsWithin(lexical, repositoryRoot)
      ? "must not be inside the repository"
      : "must not resolve inside the repository";
    fail(
      `Build output directory ${reason} to avoid confusion with materialized artifacts: ${resolved}`,
    );
  }
  if (pathIsWithin(resolved, desktopRealRoot)) {
    fail(
      `Build output directory must not be under ~/Desktop (macOS File Provider continuously re-stamps com.apple.FinderInfo on bundle directories, breaking codesign): ${resolved}`,
    );
  }
}

function computeWorktreeHash() {
  const worktreeRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  return crypto.createHash("sha256").update(worktreeRoot).digest("hex").slice(0, 16);
}

function resolveOutputDirectory() {
  if (process.env.ACTESTRA_AIONUI_BUILD_OUTPUT_DIR) {
    const custom = process.env.ACTESTRA_AIONUI_BUILD_OUTPUT_DIR;
    assertSafeOutputDirectory(custom);
    return path.resolve(custom);
  }
  const worktreeHash = computeWorktreeHash();
  const defaultDir = path.join(
    os.homedir(),
    "Library",
    "Caches",
    "Actestra",
    "builds",
    worktreeHash,
  );
  assertSafeOutputDirectory(defaultDir);
  return defaultDir;
}

function resolveElectronCache() {
  return process.env.ELECTRON_CACHE ?? path.join(os.homedir(), "Library", "Caches", "electron");
}

function materializeDownstream() {
  console.log("📦 Materializing AionUI downstream...");
  const result = spawnSync("bun", ["run", "downstream:aionui:materialize"], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    fail(`Failed to spawn materialize: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Downstream materialize failed with exit code ${result.status}`);
  }
}

function installDownstreamDependencies() {
  console.log("📥 Installing frozen downstream dependencies...");
  const result = spawnSync("bun", ["install", "--cwd", materializedRoot, "--frozen-lockfile"], {
    cwd: repositoryRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    fail(`Failed to spawn downstream install: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Downstream dependency install failed with exit code ${result.status}`);
  }
}

function buildApp(outputDir) {
  console.log(`🔨 Building Actestra.app to ${outputDir}...`);
  fs.mkdirSync(outputDir, { recursive: true });
  const result = spawnSync(
    "bun",
    [
      "run",
      "--cwd",
      materializedRoot,
      "dist:mac",
      "--",
      "--arm64",
      "--dir",
      `--config.directories.output=${outputDir}`,
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
        AIONUI_HUB_SKIP: "1",
        ELECTRON_CACHE: resolveElectronCache(),
      },
    },
  );
  if (result.error) {
    fail(`Failed to spawn build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Build failed with exit code ${result.status}`);
  }
}

function verifyApp(outputDir) {
  const appPath = path.join(outputDir, "mac-arm64", "Actestra.app");
  if (!fs.statSync(appPath, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Actestra.app not found at ${appPath}`);
  }

  console.log("✅ Verifying packaged app structure...");
  const required = [
    "Contents/Info.plist",
    "Contents/MacOS/Actestra",
    "Contents/Resources/app.asar",
  ];
  for (const relativePath of required) {
    const fullPath = path.join(appPath, relativePath);
    if (!fs.statSync(fullPath, { throwIfNoEntry: false })?.isFile()) {
      fail(`Incomplete .app bundle, missing ${relativePath}`);
    }
  }

  console.log("✅ Verifying ad-hoc codesign...");
  const verifyResult = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (verifyResult.error) {
    fail(`Failed to verify codesign: ${verifyResult.error.message}`);
  }
  if (verifyResult.status !== 0) {
    const output = `${verifyResult.stdout}\n${verifyResult.stderr}`.trim();
    fail(`codesign --verify failed:\n${output}`);
  }

  const infoResult = spawnSync("codesign", ["-dv", appPath], {
    stdio: "pipe",
    encoding: "utf8",
  });
  const codesignInfo = `${infoResult.stdout}\n${infoResult.stderr}`;
  if (!/Signature=adhoc/i.test(codesignInfo)) {
    fail(`Expected ad-hoc signature, got:\n${codesignInfo}`);
  }

  console.log("✅ Packaged app verified: structure complete, ad-hoc signature valid");
  return appPath;
}

function atomicLinkOutput(outputDir) {
  const linkTarget = path.join(materializedRoot, "out", "mac-arm64");
  const linkParent = path.dirname(linkTarget);
  fs.mkdirSync(linkParent, { recursive: true });

  const tempLink = path.join(linkParent, `.mac-arm64.${process.pid}.tmp`);
  const source = path.join(outputDir, "mac-arm64");

  try {
    if (fs.existsSync(tempLink)) {
      fs.unlinkSync(tempLink);
    }
    // A real directory left by an earlier non-wrapper build makes renameSync
    // fail with EISDIR, so clear it first. It is regenerated output inside the
    // materialized tree, never a source of truth.
    const existing = fs.lstatSync(linkTarget, { throwIfNoEntry: false });
    if (existing?.isDirectory() && !existing.isSymbolicLink()) {
      fs.rmSync(linkTarget, { recursive: true, force: true });
    }
    fs.symlinkSync(source, tempLink, "dir");
    fs.renameSync(tempLink, linkTarget);
    console.log(`🔗 Linked ${linkTarget} → ${source}`);
  } catch (error) {
    if (fs.existsSync(tempLink)) {
      try {
        fs.unlinkSync(tempLink);
      } catch {}
    }
    fail(`Failed to create output symlink: ${error.message}`);
  }
}

function main() {
  // Resolve and validate the output directory before any expensive work so an
  // unsafe override fails immediately instead of after a full materialize.
  const outputDir = resolveOutputDirectory();
  materializeDownstream();
  installDownstreamDependencies();
  buildApp(outputDir);
  verifyApp(outputDir);
  atomicLinkOutput(outputDir);
  console.log("✅ Development build complete");
}

main();
