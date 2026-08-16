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
export const GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const GOOSE_RUNNER_TOOL_DOWNLOAD_TIMEOUT_MS = 180_000;
const sourceContract = JSON.parse(
  await readFile(
    path.join(repositoryRoot, "apps", "desktop", "src", "shared", "gooseRunnerSource.json"),
    "utf8",
  ),
);

function fail(message) {
  throw new Error(`Goose runner tool installation failed: ${message}`);
}

function resolveBuildTool(name) {
  if (name === "cargo-auditable") {
    return sourceContract.buildTools?.cargoAuditable;
  }
  if (name === "cargo-audit") {
    return sourceContract.buildTools?.cargoAudit;
  }
  return undefined;
}

export function resolveGooseRunnerToolInstallContract(platform, architecture) {
  const requestedHost = `${platform}-${architecture}`;
  const target = sourceContract.buildTargets?.find(
    (candidate) => candidate?.platform === platform && candidate?.architecture === architecture,
  );
  if (target === undefined) {
    fail(`host ${requestedHost} is outside the Goose native build matrix`);
  }
  const sourceAssets = sourceContract.buildToolAssets?.[target.buildToolHost];
  if (!Array.isArray(sourceAssets) || sourceAssets.length !== 2) {
    fail(`host ${target.buildToolHost} has no exact build-tool asset contract`);
  }
  const assets = sourceAssets.map((asset) => {
    const tool = resolveBuildTool(asset?.name);
    if (
      tool === undefined ||
      typeof tool.version !== "string" ||
      typeof tool.commit !== "string" ||
      typeof asset.executableFile !== "string"
    ) {
      fail(`${String(asset?.name)} does not match the shared source contract`);
    }
    return Object.freeze({ ...asset, version: tool.version, commit: tool.commit });
  });
  if (assets.map(({ name }) => name).join("\0") !== "cargo-auditable\0cargo-audit") {
    fail(`host ${target.buildToolHost} has an unexpected build-tool asset order`);
  }
  return Object.freeze({
    host: target.buildToolHost,
    targetTriple: target.targetTriple,
    executableFile: target.executableFile,
    extractor: platform === "win32" ? "tar.exe" : "tar",
    assets: Object.freeze(assets),
  });
}

function requireAssetContract(host, assets) {
  const expected = sourceContract.buildToolAssets?.[host];
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
      contract?.repository !== asset.repository ||
      contract?.assetId !== asset.assetId ||
      contract?.url !== asset.url ||
      contract?.executableFile !== asset.executableFile ||
      contract?.expectedVersion !== asset.expectedVersion ||
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

function requireArchiveBytes(asset, bytes) {
  if (
    bytes.byteLength !== asset.size ||
    bytes.byteLength > GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES
  ) {
    fail(`${asset.name} archive size is out of bounds`);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    fail(`${asset.name} archive digest does not match the pinned release asset`);
  }
}

async function readBoundedResponse(asset, response) {
  if (!response?.ok) {
    fail(`${asset.name} download returned HTTP ${String(response?.status ?? "unknown")}`);
  }
  const contentLength = response.headers?.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (
      !/^\d+$/.test(contentLength) ||
      !Number.isSafeInteger(parsedLength) ||
      parsedLength > GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES
    ) {
      fail(`${asset.name} archive size is out of bounds`);
    }
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    fail(`${asset.name} download returned no archive body`);
  }
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!(value instanceof Uint8Array)) {
      fail(`${asset.name} download returned an invalid archive body`);
    }
    totalBytes += value.byteLength;
    if (totalBytes > GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      fail(`${asset.name} archive size is out of bounds`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function downloadGooseRunnerToolArchive(asset, archivePath, options = {}) {
  const viaApi = options.viaApi ?? process.env.ACTESTRA_GOOSE_DOWNLOAD_VIA_API === "1";
  let bytes;
  if (viaApi) {
    const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
    const apiDownload = spawnSyncImpl(
      "gh",
      [
        "api",
        `repos/${asset.repository}/releases/assets/${asset.assetId}`,
        "-H",
        "Accept: application/octet-stream",
      ],
      {
        encoding: null,
        timeout: GOOSE_RUNNER_TOOL_DOWNLOAD_TIMEOUT_MS,
        maxBuffer: GOOSE_RUNNER_TOOL_MAXIMUM_ARCHIVE_BYTES + 1,
      },
    );
    if (
      apiDownload.status !== 0 ||
      apiDownload.signal !== null ||
      !Buffer.isBuffer(apiDownload.stdout)
    ) {
      fail(`${asset.name} GitHub API download failed`);
    }
    bytes = apiDownload.stdout;
  } else {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeoutSignal = options.timeoutSignal ?? AbortSignal.timeout;
    let response;
    try {
      response = await fetchImpl(asset.url, {
        redirect: "follow",
        signal: timeoutSignal(GOOSE_RUNNER_TOOL_DOWNLOAD_TIMEOUT_MS),
      });
    } catch {
      fail(`${asset.name} download failed`);
    }
    bytes = await readBoundedResponse(asset, response);
  }
  requireArchiveBytes(asset, bytes);
  await writeFile(archivePath, bytes, { flag: "wx", mode: 0o600 });
}

export async function applyGooseRunnerToolExecutableMode(binaryPath, platform, options = {}) {
  if (platform !== "win32") {
    await (options.chmodImpl ?? chmod)(binaryPath, 0o500);
  }
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

function verifyVersion(binaryPath, asset) {
  if (asset.name === "cargo-auditable") {
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
  if (result.status !== 0 || result.stdout.trim() !== asset.expectedVersion) {
    fail(
      `${path.basename(binaryPath)} version output was ${JSON.stringify(result.stdout.trim())}; stderr=${JSON.stringify(result.stderr.trim())}`,
    );
  }
}

async function installAsset(asset, binaryDirectory, temporaryDirectory, platform, extractor) {
  const archivePath = path.join(temporaryDirectory, asset.archive);
  await downloadGooseRunnerToolArchive(asset, archivePath);

  const extractDirectory = path.join(temporaryDirectory, `${asset.name}-extract`);
  await mkdir(extractDirectory, { mode: 0o700 });
  const extracted = spawnSync(extractor, ["-xf", archivePath, "-C", extractDirectory], {
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    fail(`${asset.name} archive extraction failed: ${extracted.stderr.trim()}`);
  }
  const extractedBinary = await findFile(extractDirectory, asset.executableFile);
  if (extractedBinary === undefined || !(await stat(extractedBinary)).isFile()) {
    fail(`${asset.name} archive does not contain the expected executable`);
  }
  const installedPath = path.join(binaryDirectory, asset.executableFile);
  await copyFile(extractedBinary, installedPath);
  await applyGooseRunnerToolExecutableMode(installedPath, platform);
  verifyVersion(installedPath, asset);
  return {
    name: asset.name,
    version: asset.version,
    commit: asset.commit,
    archive: asset.archive,
    archiveSha256: asset.sha256,
    executableSha256: await sha256File(installedPath),
  };
}

async function main() {
  const platform = process.platform;
  const contract = resolveGooseRunnerToolInstallContract(platform, process.arch);
  const { assets, extractor, host } = contract;
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
      installed.push(
        await installAsset(asset, binaryDirectory, temporaryDirectory, platform, extractor),
      );
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
}

export const isDirectExecution =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  await main();
}
