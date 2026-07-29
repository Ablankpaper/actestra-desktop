import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayDirectory = path.join(repositoryRoot, "downstream", "aionui-v2.1.41");
const overlayPath = path.join(overlayDirectory, "overlay.json");
const provenancePath = path.join(repositoryRoot, "foundation", "aionui-v2.1.41.provenance.json");
const defaultOutputRoot = path.join(repositoryRoot, ".actestra", "aionui-v2.1.41");

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseSourceManifest(contents) {
  const entries = [];
  for (const line of contents.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  \.\/(.+)$/u.exec(line);
    if (!match) {
      throw new Error(`Malformed AionUi source-manifest line: ${line}`);
    }
    entries.push({ hash: match[1], relativePath: match[2] });
  }
  return entries;
}

function parseArguments(argv) {
  let outputRoot = defaultOutputRoot;
  let linkLocalDependencies = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--link-local-dependencies") {
      linkLocalDependencies = true;
      continue;
    }
    if (argument === "--output") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--output requires a path");
      }
      outputRoot = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown materializer argument: ${argument}`);
  }

  return { linkLocalDependencies, outputRoot };
}

function assertSafeGeneratedOutput(outputRoot) {
  const resolved = path.resolve(outputRoot);
  const parsed = path.parse(resolved);
  if (
    resolved === parsed.root ||
    resolved === repositoryRoot ||
    resolved === path.resolve(process.env.HOME ?? parsed.root)
  ) {
    throw new Error(`Refusing unsafe downstream output path: ${resolved}`);
  }
  if (path.basename(resolved) !== "aionui-v2.1.41") {
    throw new Error(`Downstream output must end in aionui-v2.1.41, received: ${resolved}`);
  }
}

function copyManifestSelection(sourceRoot, outputRoot, sourceEntries) {
  for (const entry of sourceEntries) {
    const sourcePath = path.join(sourceRoot, entry.relativePath);
    const destinationPath = path.join(outputRoot, entry.relativePath);
    const contents = fs.readFileSync(sourcePath);
    const actualHash = sha256(contents);
    if (actualHash !== entry.hash) {
      throw new Error(`Frozen source drifted before materialization: ${entry.relativePath}`);
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, contents, {
      mode: fs.statSync(sourcePath).mode,
    });
  }
}

function applyPatch(outputRoot, patchPath) {
  if (path.extname(patchPath) === ".mjs") {
    const result = spawnSync(process.execPath, [patchPath, outputRoot], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `Downstream overlay script failed for ${patchPath}:\n${result.stderr || result.stdout}`,
      );
    }
    return;
  }

  const check = spawnSync("git", ["apply", "--check", "--whitespace=error-all", patchPath], {
    cwd: outputRoot,
    encoding: "utf8",
  });
  if (check.status !== 0) {
    throw new Error(
      `Downstream patch check failed for ${patchPath}:\n${check.stderr || check.stdout}`,
    );
  }

  const apply = spawnSync("git", ["apply", "--whitespace=error-all", patchPath], {
    cwd: outputRoot,
    encoding: "utf8",
  });
  if (apply.status !== 0) {
    throw new Error(
      `Downstream patch apply failed for ${patchPath}:\n${apply.stderr || apply.stdout}`,
    );
  }
}

function copyOwnedAssets(outputRoot, assetCopies) {
  for (const asset of assetCopies) {
    const sourcePath = path.join(repositoryRoot, asset.source);
    const destinationPath = path.join(outputRoot, asset.destination);
    const contents = fs.readFileSync(sourcePath);
    const actualHash = sha256(contents);
    if (actualHash !== asset.sha256) {
      throw new Error(
        `Actestra asset hash drifted for ${asset.source}: expected ${asset.sha256}, received ${actualHash}`,
      );
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, contents, {
      mode: fs.statSync(sourcePath).mode,
    });
  }
}

function copyOwnedSources(outputRoot, sourceCopies) {
  for (const sourceCopy of sourceCopies) {
    const sourcePath = path.join(repositoryRoot, sourceCopy.source);
    const destinationPath = path.join(outputRoot, sourceCopy.destination);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Actestra source copy is missing: ${sourceCopy.source}`);
    }
    if (fs.existsSync(destinationPath)) {
      throw new Error(
        `Actestra source copy would overwrite a frozen-source path: ${sourceCopy.destination}`,
      );
    }
    const contents = fs.readFileSync(sourcePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, contents, {
      mode: fs.statSync(sourcePath).mode,
    });
  }
}

function linkLocalRuntimeInputs(sourceRoot, outputRoot) {
  const relativePaths = ["node_modules", "resources/bundled-aioncore"];
  const sourcePackagesRoot = path.join(sourceRoot, "packages");
  if (fs.existsSync(sourcePackagesRoot)) {
    for (const entry of fs.readdirSync(sourcePackagesRoot, {
      withFileTypes: true,
    })) {
      if (
        entry.isDirectory() &&
        fs.existsSync(path.join(sourcePackagesRoot, entry.name, "node_modules"))
      ) {
        relativePaths.push(path.join("packages", entry.name, "node_modules"));
      }
    }
  }

  for (const relativePath of relativePaths) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const destinationPath = path.join(outputRoot, relativePath);
    if (!fs.existsSync(sourcePath) || fs.existsSync(destinationPath)) {
      continue;
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.symlinkSync(fs.realpathSync(sourcePath), destinationPath, "junction");
  }
}

export function materializeAionUiDownstream(options = {}) {
  const overlay = readJson(overlayPath);
  const provenance = readJson(provenancePath);
  const sourceRoot = path.join(repositoryRoot, provenance.sourceRoot);
  const sourceManifestPath = path.join(repositoryRoot, provenance.manifest);
  const sourceManifestContents = fs.readFileSync(sourceManifestPath);
  const outputRoot = path.resolve(options.outputRoot ?? defaultOutputRoot);

  assertSafeGeneratedOutput(outputRoot);

  if (
    overlay.upstream.tag !== provenance.tag ||
    overlay.upstream.commit !== provenance.commit ||
    overlay.upstream.manifestSha256 !== sha256(sourceManifestContents)
  ) {
    throw new Error("Downstream overlay pin disagrees with frozen AionUi provenance");
  }

  const sourceEntries = parseSourceManifest(sourceManifestContents.toString("utf8"));
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  copyManifestSelection(sourceRoot, outputRoot, sourceEntries);
  copyOwnedSources(outputRoot, overlay.sourceCopies ?? []);

  for (const patch of overlay.patches) {
    applyPatch(outputRoot, path.join(overlayDirectory, patch.path));
  }
  copyOwnedAssets(outputRoot, overlay.assetCopies);

  if (options.linkLocalDependencies) {
    linkLocalRuntimeInputs(sourceRoot, outputRoot);
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstream: overlay.upstream,
    patches: overlay.patches.map((patch) => patch.path),
    sourceCopies: (overlay.sourceCopies ?? []).map((sourceCopy) => {
      const contents = fs.readFileSync(path.join(repositoryRoot, sourceCopy.source));
      return {
        destination: sourceCopy.destination,
        sha256: sha256(contents),
        source: sourceCopy.source,
      };
    }),
    assetCopies: overlay.assetCopies.map((asset) => ({
      destination: asset.destination,
      sha256: asset.sha256,
      source: asset.source,
    })),
  };
  fs.writeFileSync(
    path.join(outputRoot, ".actestra-overlay.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );

  return {
    outputRoot,
    sourceFileCount: sourceEntries.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const result = materializeAionUiDownstream(options);
  console.log(
    `Materialized Actestra downstream AionUi tree at ${result.outputRoot} from ${result.sourceFileCount} frozen files.`,
  );
}
