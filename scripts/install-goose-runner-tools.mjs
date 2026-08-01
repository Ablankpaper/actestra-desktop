import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toolRoot = path.join(repositoryRoot, ".actestra", "goose-runner-tools");
const maximumArchiveBytes = 20 * 1024 * 1024;
const sourceContract = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "apps", "desktop", "src", "shared", "gooseRunnerSource.json"),
    "utf8",
  ),
);

const toolAssets = {
  "darwin-arm64": [
    {
      name: "cargo-auditable",
      version: "0.7.4",
      commit: "1d50810095d1a40d02c4f5c38152cdb9d0ea06bd",
      archive: "cargo-auditable-aarch64-apple-darwin.tar.xz",
      repository: "rust-secure-code/cargo-auditable",
      assetId: 366985535,
      size: 389720,
      url: "https://github.com/rust-secure-code/cargo-auditable/releases/download/v0.7.4/cargo-auditable-aarch64-apple-darwin.tar.xz",
      sha256: "fade0f3befebce7b54a46edfa31bea27789ea2136c51e662c2922b10f9d6f701",
      expectedVersion: "cargo-auditable 0.7.4",
    },
    {
      name: "cargo-audit",
      version: "0.22.2",
      commit: "281452c35cf0870969042374110f099a411bc185",
      archive: "cargo-audit-aarch64-apple-darwin-v0.22.2.tgz",
      repository: "rustsec/rustsec",
      assetId: 439291477,
      size: 5954803,
      url: "https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-aarch64-apple-darwin-v0.22.2.tgz",
      sha256: "ec7ca4263769593df4d909be85b94a6b79efa2897be5d2bb8ebd516e823175af",
      expectedVersion: "cargo-audit 0.22.2",
    },
  ],
  "darwin-x64": [
    {
      name: "cargo-auditable",
      version: "0.7.4",
      commit: "1d50810095d1a40d02c4f5c38152cdb9d0ea06bd",
      archive: "cargo-auditable-x86_64-apple-darwin.tar.xz",
      repository: "rust-secure-code/cargo-auditable",
      assetId: 366985540,
      size: 431300,
      url: "https://github.com/rust-secure-code/cargo-auditable/releases/download/v0.7.4/cargo-auditable-x86_64-apple-darwin.tar.xz",
      sha256: "2a1e73d769b2ab6c027178d11c6ba6bf3ad7c1e756910b349b513583da9d52bc",
      expectedVersion: "cargo-auditable 0.7.4",
    },
    {
      name: "cargo-audit",
      version: "0.22.2",
      commit: "281452c35cf0870969042374110f099a411bc185",
      archive: "cargo-audit-x86_64-apple-darwin-v0.22.2.tgz",
      repository: "rustsec/rustsec",
      assetId: 439292734,
      size: 6357453,
      url: "https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-x86_64-apple-darwin-v0.22.2.tgz",
      sha256: "847831323de932155b226ab60ee4a180e13e5d007a019f0d4b7b4d89a6de2ab2",
      expectedVersion: "cargo-audit 0.22.2",
    },
  ],
};

function fail(message) {
  throw new Error(`Goose runner tool installation failed: ${message}`);
}

function requireAssetContract(host, assets) {
  const expected = sourceContract.buildToolAssets[host];
  if (!Array.isArray(expected) || expected.length !== assets.length) {
    fail(`host ${host} has no exact build-tool asset contract`);
  }
  for (const asset of assets) {
    const contract = expected.find((candidate) => candidate.name === asset.name);
    const toolKey = asset.name === "cargo-auditable" ? "cargoAuditable" : "cargoAudit";
    const tool = sourceContract.buildTools[toolKey];
    if (
      contract?.archive !== asset.archive ||
      contract?.size !== asset.size ||
      contract?.sha256 !== asset.sha256 ||
      tool?.version !== asset.version ||
      tool?.commit !== asset.commit
    ) {
      fail(`${asset.name} does not match the shared source contract`);
    }
  }
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function findFile(directory, basename) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, basename);
      if (nested !== undefined) {
        return nested;
      }
    } else if (entry.isFile() && entry.name === basename) {
      return candidate;
    }
  }
  return undefined;
}

function verifyVersion(binaryPath, expectedVersion) {
  if (path.basename(binaryPath) === "cargo-auditable") {
    const result = spawnSync(binaryPath, [], { encoding: "utf8" });
    if (
      result.status !== 1 ||
      result.stderr.trim() !== "'cargo auditable' should be invoked through Cargo"
    ) {
      fail("cargo-auditable executable did not expose the pinned Cargo-subcommand entry point");
    }
    return;
  }
  const result = spawnSync(binaryPath, ["--version"], { encoding: "utf8" });
  if (result.status !== 0 || result.stdout.trim() !== expectedVersion) {
    fail(
      `${path.basename(binaryPath)} version output was ${JSON.stringify(result.stdout.trim())}; stderr=${JSON.stringify(result.stderr.trim())}`,
    );
  }
}

async function installAsset(asset, binaryDirectory, temporaryDirectory) {
  const archivePath = path.join(temporaryDirectory, asset.archive);
  if (process.env.ACTESTRA_GOOSE_DOWNLOAD_VIA_API === "1") {
    const apiDownload = spawnSync(
      "gh",
      [
        "api",
        `repos/${asset.repository}/releases/assets/${asset.assetId}`,
        "-H",
        "Accept: application/octet-stream",
      ],
      { encoding: null, timeout: 200_000, maxBuffer: maximumArchiveBytes },
    );
    if (apiDownload.status !== 0 || !Buffer.isBuffer(apiDownload.stdout)) {
      fail(`${asset.name} GitHub API download failed`);
    }
    await writeFile(archivePath, apiDownload.stdout, { flag: "wx", mode: 0o600 });
  } else {
    const download = spawnSync(
      "/usr/bin/curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        "2",
        "--retry-all-errors",
        "--connect-timeout",
        "15",
        "--max-time",
        "180",
        "--output",
        archivePath,
        asset.url,
      ],
      { encoding: "utf8", timeout: 200_000 },
    );
    if (download.status !== 0) {
      fail(`${asset.name} download failed: ${download.stderr.trim()}`);
    }
  }
  const archiveSize = (await stat(archivePath)).size;
  if (archiveSize !== asset.size || archiveSize > maximumArchiveBytes) {
    fail(`${asset.name} archive size is out of bounds`);
  }
  if ((await sha256File(archivePath)) !== asset.sha256) {
    fail(`${asset.name} archive digest does not match the pinned release asset`);
  }

  const extractDirectory = path.join(temporaryDirectory, `${asset.name}-extract`);
  await mkdir(extractDirectory, { mode: 0o700 });
  const extracted = spawnSync("/usr/bin/tar", ["-xf", archivePath, "-C", extractDirectory], {
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    fail(`${asset.name} archive extraction failed: ${extracted.stderr.trim()}`);
  }
  const extractedBinary = await findFile(extractDirectory, asset.name);
  if (extractedBinary === undefined || !(await stat(extractedBinary)).isFile()) {
    fail(`${asset.name} archive does not contain the expected executable`);
  }
  const installedPath = path.join(binaryDirectory, asset.name);
  await copyFile(extractedBinary, installedPath);
  await chmod(installedPath, 0o500);
  verifyVersion(installedPath, asset.expectedVersion);
  return {
    name: asset.name,
    version: asset.version,
    commit: asset.commit,
    archive: asset.archive,
    archiveSha256: asset.sha256,
    executableSha256: await sha256File(installedPath),
  };
}

const host = `${process.platform}-${process.arch}`;
const assets = toolAssets[host];
if (assets === undefined) {
  fail(`host ${host} is outside the P5.1 macOS admission matrix`);
}
requireAssetContract(host, assets);

const installDirectory = path.join(toolRoot, host);
const binaryDirectory = path.join(installDirectory, "bin");
const temporaryDirectory = await mkdtemp(path.join(toolRoot, `.install-${host}-`)).catch(
  async (error) => {
    await mkdir(toolRoot, { recursive: true, mode: 0o700 });
    return mkdtemp(path.join(toolRoot, `.install-${host}-`)).catch(() => {
      throw error;
    });
  },
);

try {
  await rm(installDirectory, { recursive: true, force: true });
  await mkdir(binaryDirectory, { recursive: true, mode: 0o700 });
  const installed = [];
  for (const asset of assets) {
    installed.push(await installAsset(asset, binaryDirectory, temporaryDirectory));
  }
  await writeFile(
    path.join(installDirectory, "tools.json"),
    `${JSON.stringify({ contractVersion: 1, host, installed }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.info(`Goose runner tools installed at ${binaryDirectory}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
