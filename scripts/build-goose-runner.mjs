import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { resolveGooseRunnerToolInstallContract } from "./install-goose-runner-tools.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runnerRoot = path.join(repositoryRoot, "workers", "goose-runner");
const sourceContractPath = path.join(
  repositoryRoot,
  "apps",
  "desktop",
  "src",
  "shared",
  "gooseRunnerSource.json",
);
const sourceContract = JSON.parse(await readFile(sourceContractPath, "utf8"));
const buildTarget = resolveGooseRunnerToolInstallContract(process.platform, process.arch);
const hostKey = buildTarget.host;
const toolDirectory = path.join(repositoryRoot, ".actestra", "goose-runner-tools", hostKey, "bin");
function installedToolPath(asset) {
  return path.join(toolDirectory, asset.executableFile);
}
const cargoAuditAsset = buildTarget.assets.find(({ name }) => name === "cargo-audit");
const cargoAuditableAsset = buildTarget.assets.find(({ name }) => name === "cargo-auditable");
if (cargoAuditAsset === undefined || cargoAuditableAsset === undefined) {
  throw new Error("Goose runner build failed: native build-tool contract is incomplete");
}
const cargoAuditPath = installedToolPath(cargoAuditAsset);
const cargoAuditablePath = installedToolPath(cargoAuditableAsset);
const advisoryDatabasePath = path.join(
  process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"),
  "advisory-db",
);

const sourceTreeFiles = [
  "apps/desktop/src/main/workers/gooseRunnerContainment.ts",
  "apps/desktop/src/main/workers/gooseRunnerArtifact.ts",
  "apps/desktop/src/main/workers/gooseRunnerProcess.ts",
  "apps/desktop/src/main/workers/gooseRunnerTarget.ts",
  "apps/desktop/src/shared/gooseRunnerSource.json",
  "scripts/build-goose-runner.mjs",
  "scripts/gooseContainmentEvidence.mjs",
  "scripts/install-goose-runner-tools.mjs",
  "scripts/record-goose-runner-containment.mjs",
  "scripts/run-goose-runner-containment.mjs",
  "scripts/test-goose-runner-containment.mjs",
  "workers/goose-runner/Cargo.lock",
  "workers/goose-runner/Cargo.toml",
  "workers/goose-runner/PATCHES.md",
  "workers/goose-runner/licenses/GOOSE-APACHE-2.0.txt",
  "workers/goose-runner/rust-toolchain.toml",
  "workers/goose-runner/src/containment/linux.rs",
  "workers/goose-runner/src/containment/mod.rs",
  "workers/goose-runner/src/containment/unix.rs",
  "workers/goose-runner/src/containment/windows.rs",
  "workers/goose-runner/src/linux_bootstrap.rs",
  "workers/goose-runner/src/main.rs",
  "workers/goose-runner/src/windows_bridge.rs",
  "workers/goose-runner/src/windows_control.rs",
  "workers/goose-runner/src/windows_supervisor.rs",
];

function fail(message) {
  throw new Error(`Goose runner build failed: ${message}`);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.stream === true) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (options.stream === true) {
        process.stderr.write(chunk);
      }
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function requireSuccess(command, args, options) {
  const result = await run(command, args, options);
  if (result.code !== 0 || result.signal !== null) {
    fail(
      `${path.basename(command)} ${args.join(" ")} failed (code=${String(result.code)}, signal=${String(result.signal)}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function parseJsonOutput(result, label, acceptedCodes) {
  if (
    !acceptedCodes.includes(result.code) ||
    result.signal !== null ||
    result.stdout.trim() === ""
  ) {
    fail(`${label} failed: ${result.stderr.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`${label} did not produce JSON: ${error.message}`);
  }
}

function compilerArtifactPackageIds(output) {
  const packageIds = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      fail(`Cargo build emitted a non-JSON message: ${error.message}`);
    }
    if (message.reason === "compiler-artifact") {
      if (typeof message.package_id !== "string" || message.package_id.length === 0) {
        fail("Cargo compiler-artifact message has no package identity");
      }
      packageIds.add(message.package_id);
    }
  }
  if (packageIds.size < 1) {
    fail("Cargo build emitted no compiler-artifact package identities");
  }
  return packageIds;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

async function sourceTreeSha256() {
  const digest = createHash("sha256");
  for (const relativePath of [...sourceTreeFiles].sort()) {
    const bytes = await readFile(path.join(repositoryRoot, relativePath));
    digest.update(relativePath);
    digest.update("\0");
    digest.update(bytes);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function deterministicUuid(digest) {
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = "8";
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function cargoPurl(packageValue) {
  const base = `pkg:cargo/${encodeURIComponent(packageValue.name)}@${encodeURIComponent(packageValue.version)}`;
  if (typeof packageValue.source === "string" && packageValue.source.startsWith("git+")) {
    return `${base}?vcs_url=${encodeURIComponent(`git+https://github.com/aaif-goose/goose@${sourceContract.goose.commit}`)}`;
  }
  return base;
}

function normalizedDependencyName(name) {
  return name.replaceAll("-", "_");
}

function activatedOptionalDependencies(packageValue, node) {
  const optionalNames = new Set(
    packageValue.dependencies
      .filter((dependency) => dependency.kind === null && dependency.optional)
      .map((dependency) => dependency.rename ?? dependency.name),
  );
  const activated = new Set();
  const visitedFeatures = new Set();
  const pendingFeatures = [...node.features];
  while (pendingFeatures.length > 0) {
    const feature = pendingFeatures.pop();
    if (visitedFeatures.has(feature)) {
      continue;
    }
    visitedFeatures.add(feature);
    if (optionalNames.has(feature)) {
      activated.add(normalizedDependencyName(feature));
    }
    for (const expansion of packageValue.features[feature] ?? []) {
      if (expansion.startsWith("dep:")) {
        activated.add(normalizedDependencyName(expansion.slice(4)));
        continue;
      }
      const dependencyFeature = expansion.match(/^([^/?]+)(\?)?\//);
      if (dependencyFeature !== null) {
        if (dependencyFeature[2] !== "?" && optionalNames.has(dependencyFeature[1])) {
          activated.add(normalizedDependencyName(dependencyFeature[1]));
        }
        continue;
      }
      if (Object.hasOwn(packageValue.features, expansion)) {
        pendingFeatures.push(expansion);
      } else if (optionalNames.has(expansion)) {
        activated.add(normalizedDependencyName(expansion));
      }
    }
  }
  return activated;
}

function activeDependencyIds(packageValue, node) {
  const activeOptional = activatedOptionalDependencies(packageValue, node);
  return node.deps
    .filter((dependency) => dependency.dep_kinds.some((kind) => kind.kind === null))
    .filter((dependency) => {
      const declarations = packageValue.dependencies.filter(
        (candidate) =>
          candidate.kind === null &&
          normalizedDependencyName(candidate.rename ?? candidate.name) === dependency.name,
      );
      return (
        declarations.length === 0 ||
        declarations.some((candidate) => !candidate.optional) ||
        activeOptional.has(dependency.name)
      );
    })
    .map((dependency) => dependency.pkg);
}

function packageKey(packageValue) {
  return `${packageValue.name}\0${packageValue.version}`;
}

function cargoTreePackageKeys(output) {
  const keys = new Set();
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }
    const match = line.match(/^(\S+) v(\S+)/);
    if (match === null) {
      fail(`cargo tree emitted an unrecognized package line: ${line}`);
    }
    keys.add(`${match[1]}\0${match[2]}`);
  }
  if (keys.size < 2) {
    fail("cargo tree did not return the runner dependency graph");
  }
  return keys;
}

function activeGraph(metadata, selectedPackageKeys) {
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const root = metadata.resolve.root;
  if (typeof root !== "string") {
    fail("cargo metadata did not identify the runner root package");
  }
  const packagesByKey = new Map();
  for (const packageValue of metadata.packages) {
    const key = packageKey(packageValue);
    const candidates = packagesByKey.get(key) ?? [];
    candidates.push(packageValue);
    packagesByKey.set(key, candidates);
  }
  const selectedPackages = [];
  for (const key of selectedPackageKeys) {
    const candidates = packagesByKey.get(key);
    if (candidates?.length !== 1) {
      fail(`cargo metadata does not uniquely identify cargo-tree package ${key}`);
    }
    selectedPackages.push(candidates[0]);
  }
  const reachable = new Set(selectedPackages.map((packageValue) => packageValue.id));
  if (!reachable.has(root)) {
    fail("cargo tree did not include the runner root package");
  }
  const selected = selectedPackages
    .map((packageValue) => {
      const node = nodes.get(packageValue.id);
      if (node === undefined) {
        fail(`cargo metadata is missing node ${packageValue.id}`);
      }
      return {
        packageValue,
        node,
        activeDependencies: activeDependencyIds(packageValue, node),
      };
    })
    .sort((left, right) => left.packageValue.name.localeCompare(right.packageValue.name));
  return { root, selected, reachable };
}

function createSbom(metadata, graph, builtAt, sourceDigest, targetTriple) {
  const rootPackage = graph.selected.find(
    ({ packageValue }) => packageValue.id === graph.root,
  ).packageValue;
  const components = graph.selected
    .filter(({ packageValue }) => packageValue.id !== graph.root)
    .map(({ packageValue, node }) => {
      const purl = cargoPurl(packageValue);
      const component = {
        type: "library",
        "bom-ref": purl,
        name: packageValue.name,
        version: packageValue.version,
        purl,
        properties: [
          { name: "cargo:features", value: [...node.features].sort().join(",") },
          { name: "cargo:source", value: packageValue.source ?? "path" },
        ],
      };
      if (typeof packageValue.license === "string") {
        component.licenses = [{ expression: packageValue.license }];
      }
      return component;
    });
  const dependencies = graph.selected.map(({ packageValue, activeDependencies }) => ({
    ref: packageValue.id === graph.root ? cargoPurl(rootPackage) : cargoPurl(packageValue),
    dependsOn: activeDependencies
      .filter((dependencyId) => graph.reachable.has(dependencyId))
      .map((dependencyId) => cargoPurl(metadata.packages.find((item) => item.id === dependencyId)))
      .sort(),
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${deterministicUuid(sourceDigest)}`,
    version: 1,
    metadata: {
      timestamp: builtAt,
      component: {
        type: "application",
        "bom-ref": cargoPurl(rootPackage),
        name: rootPackage.name,
        version: rootPackage.version,
        purl: cargoPurl(rootPackage),
        properties: [
          { name: "actestra:target-triple", value: targetTriple },
          { name: "actestra:source-tree-sha256", value: sourceDigest },
        ],
      },
    },
    components,
    dependencies,
  };
}

function vulnerabilityDispositions(report, source) {
  const vulnerabilities = report.vulnerabilities?.list ?? [];
  if (
    vulnerabilities.length !== 1 ||
    vulnerabilities[0]?.advisory?.id !== "RUSTSEC-2023-0071" ||
    vulnerabilities[0]?.package?.name !== "rsa" ||
    vulnerabilities[0]?.package?.version !== "0.9.10"
  ) {
    const observed = vulnerabilities.map((v) => ({
      id: v.advisory?.id ?? "unknown",
      package: v.package?.name ?? "unknown",
      version: v.package?.version ?? "unknown",
      title: v.advisory?.title ?? "",
    }));
    console.error(`${source} vulnerability mismatch (count=${vulnerabilities.length}):`);
    console.error(JSON.stringify(observed, null, 2));
    fail(`${source} contains an unreviewed RustSec vulnerability set`);
  }
  return [
    {
      id: "RUSTSEC-2023-0071",
      package: { name: "rsa", version: "0.9.10" },
      disposition: "metadata-only-not-compiled",
      proof: "cargo-tree-all-targets-no-path",
      source,
    },
  ];
}

function warningList(report, name) {
  const value = report.warnings?.[name];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`cargo-audit ${name} warnings are malformed`);
  }
  return value.map((warning) => ({
    id: warning.advisory?.id ?? "unknown",
    package: {
      name: warning.package?.name ?? "unknown",
      version: warning.package?.version ?? "unknown",
    },
  }));
}

function requireNoSelectedPackage(graph, name) {
  if (graph.selected.some(({ packageValue }) => packageValue.name === name)) {
    fail(`${name} unexpectedly entered the selected compile graph`);
  }
}

const toolManifest = JSON.parse(
  await readFile(path.join(path.dirname(toolDirectory), "tools.json"), "utf8").catch(() =>
    fail("pinned build tools are not installed; run goose:runner:tools"),
  ),
);
const expectedAssets = buildTarget.assets;
if (
  toolManifest.contractVersion !== 1 ||
  toolManifest.host !== hostKey ||
  !Array.isArray(toolManifest.installed) ||
  !Array.isArray(expectedAssets) ||
  toolManifest.installed.length !== expectedAssets.length
) {
  fail("installed build-tool manifest does not match the host source contract");
}
const buildToolEvidence = new Map();
for (const [name, expected, binaryPath] of [
  ["cargo-auditable", sourceContract.buildTools.cargoAuditable, cargoAuditablePath],
  ["cargo-audit", sourceContract.buildTools.cargoAudit, cargoAuditPath],
]) {
  const installed = toolManifest.installed.find((tool) => tool.name === name);
  const expectedAsset = expectedAssets.find((asset) => asset.name === name);
  if (
    installed?.version !== expected.version ||
    installed?.commit !== expected.commit ||
    installed?.archive !== expectedAsset?.archive ||
    installed?.archiveSha256 !== expectedAsset?.sha256 ||
    !/^[a-f0-9]{64}$/.test(installed?.executableSha256 ?? "") ||
    (await sha256File(binaryPath)) !== installed.executableSha256
  ) {
    fail(`build tool ${name} or its executable does not match the source contract`);
  }
  buildToolEvidence.set(
    name,
    Object.freeze({
      version: installed.version,
      commit: installed.commit,
      archiveSha256: installed.archiveSha256,
      executableSha256: installed.executableSha256,
    }),
  );
}

function requireBuildToolEvidence(name) {
  const evidence = buildToolEvidence.get(name);
  if (evidence === undefined) {
    fail(`build tool ${name} has no verified executable evidence`);
  }
  return evidence;
}

const rustVersion = await requireSuccess("cargo", ["--version"], { cwd: runnerRoot });
if (!rustVersion.includes("1.96.1")) {
  fail(`Cargo toolchain is not 1.96.1: ${rustVersion.trim()}`);
}
const rustcVersion = await requireSuccess("rustc", ["-Vv"], { cwd: runnerRoot });
const rustcHost = rustcVersion.match(/^host: (.+)$/m)?.[1];
const rustcCommit = rustcVersion.match(/^commit-hash: (.+)$/m)?.[1];
if (rustcHost !== buildTarget.targetTriple || rustcCommit !== sourceContract.rust.rustcCommit) {
  fail("Rust host target or compiler commit does not match the source contract");
}
const targetTriple = buildTarget.targetTriple;
const rustfmtVersion = (await requireSuccess("rustfmt", ["--version"], { cwd: runnerRoot })).trim();
if (rustfmtVersion !== sourceContract.rust.rustfmt) {
  fail(`Rust formatter does not match the source contract: ${rustfmtVersion}`);
}

const buildEnvironment = {
  ...process.env,
  PATH: [toolDirectory, process.env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  CARGO_NET_GIT_FETCH_WITH_CLI: "true",
};
const buildOutput = await requireSuccess(
  "cargo",
  ["auditable", "build", "--locked", "--release", "--message-format=json-render-diagnostics"],
  {
    cwd: runnerRoot,
    env: buildEnvironment,
  },
);
const compiledPackageIds = compilerArtifactPackageIds(buildOutput);

const executableName = buildTarget.executableFile;
const builtExecutable = path.join(runnerRoot, "target", "release", executableName);
const sourceDigest = await sourceTreeSha256();
const builtAt = new Date().toISOString();
const metadata = JSON.parse(
  await requireSuccess(
    "cargo",
    [
      "metadata",
      "--locked",
      "--no-default-features",
      "--filter-platform",
      targetTriple,
      "--format-version",
      "1",
    ],
    { cwd: runnerRoot, env: { ...buildEnvironment, CARGO_NET_OFFLINE: "true" } },
  ),
);
const cargoTreeOutput = await requireSuccess(
  "cargo",
  [
    "tree",
    "--locked",
    "--no-default-features",
    "--target",
    targetTriple,
    "--edges",
    "normal",
    "--prefix",
    "none",
    "--format",
    "{p}",
  ],
  { cwd: runnerRoot, env: { ...buildEnvironment, CARGO_NET_OFFLINE: "true" } },
);
const cargoTreePackages = cargoTreePackageKeys(cargoTreeOutput);
const graph = activeGraph(metadata, cargoTreePackages);
const cargoTreePackageCount = cargoTreePackages.size;
for (const excluded of ["rsa", "sqlx-mysql", "quick-xml", "goose-mcp", "goose-cli"]) {
  requireNoSelectedPackage(graph, excluded);
}

for (const packageName of ["rsa", "sqlx-mysql"]) {
  const tree = await run(
    "cargo",
    [
      "tree",
      "--locked",
      "--no-default-features",
      "--target",
      "all",
      "--invert",
      packageName,
      "--edges",
      "normal",
    ],
    {
      cwd: runnerRoot,
      env: { ...buildEnvironment, CARGO_NET_OFFLINE: "false" },
    },
  );
  if (tree.code !== 0 || tree.signal !== null) {
    fail(
      `${packageName} all-target dependency query failed (code=${String(tree.code)}, signal=${String(tree.signal)}): ${tree.stderr.trim()}`,
    );
  }
  if (tree.stdout.trim() !== "" || !tree.stderr.includes("nothing to print")) {
    fail(`${packageName} has entered the all-target selected dependency graph`);
  }
  const packageIds = metadata.packages
    .filter((packageValue) => packageValue.name === packageName)
    .map((packageValue) => packageValue.id);
  if (packageIds.some((packageId) => compiledPackageIds.has(packageId))) {
    fail(`${packageName} entered the current Cargo compiler-artifact set`);
  }
}

const noFetchAudit = process.env.ACTESTRA_GOOSE_AUDIT_NO_FETCH === "1";
const lockAuditArguments = ["audit", "--json"];
if (noFetchAudit) {
  lockAuditArguments.push("--no-fetch");
}
lockAuditArguments.push("--file", "Cargo.lock");
const lockAuditResult = await run(cargoAuditPath, lockAuditArguments, { cwd: runnerRoot });
const lockAudit = parseJsonOutput(lockAuditResult, "cargo-audit lock scan", [1]);
const binaryAuditResult = await run(
  cargoAuditPath,
  ["audit", "--json", "--no-fetch", "bin", builtExecutable],
  { cwd: runnerRoot },
);
const binaryAudit = parseJsonOutput(binaryAuditResult, "cargo-audit binary scan", [1]);
const lockVulnerabilities = vulnerabilityDispositions(lockAudit, "cargo-audit-lock");
const binaryVulnerabilities = vulnerabilityDispositions(binaryAudit, "cargo-audit-bin");
const lockUnsound = warningList(lockAudit, "unsound");
const binaryUnsound = warningList(binaryAudit, "unsound");
if (lockUnsound.length > 0 || binaryUnsound.length > 0) {
  fail("Goose runner has an unresolved unsound dependency warning");
}
const advisoryDatabaseCommit = (
  await requireSuccess("git", ["-C", advisoryDatabasePath, "rev-parse", "HEAD"])
).trim();
const advisoryDatabaseFetchedAt = (
  await stat(path.join(advisoryDatabasePath, ".git", "FETCH_HEAD"))
).mtime;
const maximumFetchAgeMs = (noFetchAudit ? 7 * 24 * 60 : 10) * 60 * 1000;
if (
  !/^[a-f0-9]{40}$/.test(advisoryDatabaseCommit) ||
  !Number.isFinite(advisoryDatabaseFetchedAt.getTime()) ||
  advisoryDatabaseFetchedAt.getTime() - Date.now() > 5 * 60 * 1000 ||
  Date.now() - advisoryDatabaseFetchedAt.getTime() > maximumFetchAgeMs
) {
  fail("RustSec advisory database fetch evidence is missing, invalid, or stale");
}

const auditReport = {
  contractVersion: 1,
  cargoAudit: requireBuildToolEvidence("cargo-audit"),
  advisoryDatabase: {
    commit: advisoryDatabaseCommit,
    fetchedAt: advisoryDatabaseFetchedAt.toISOString(),
    checkedAt: new Date().toISOString(),
  },
  reachability: {
    targetTriple,
    activeDependencyCount: graph.selected.length - 1,
    cargoTreeDependencyCount: cargoTreePackageCount - 1,
    compilerArtifactPackageCount: compiledPackageIds.size,
    cargoTreeAllTargets: {
      rsa: "no-path",
      sqlxMysql: "no-path",
    },
    compilerArtifactsAbsent: ["rsa", "sqlx-mysql"],
  },
  binary: {
    auditableDependencyCount: binaryAudit.lockfile["dependency-count"],
    vulnerabilities: binaryVulnerabilities,
    unsound: binaryUnsound,
  },
  lock: {
    dependencyCount: lockAudit.lockfile["dependency-count"],
    vulnerabilities: lockVulnerabilities,
    unsound: lockUnsound,
    unmaintained: warningList(lockAudit, "unmaintained"),
    yanked: {
      complete: true,
      packages: warningList(lockAudit, "yanked"),
    },
  },
};

const outputDirectory = path.join(repositoryRoot, ".actestra", "goose-runner", targetTriple);
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
const executablePath = path.join(outputDirectory, executableName);
const lockfilePath = path.join(outputDirectory, "Cargo.lock");
const licensePath = path.join(outputDirectory, "GOOSE-APACHE-2.0.txt");
const sbomPath = path.join(outputDirectory, "actestra-goose-runner.cdx.json");
const auditPath = path.join(outputDirectory, "actestra-goose-runner.audit.json");
await Promise.all([
  copyFile(builtExecutable, executablePath),
  copyFile(path.join(runnerRoot, "Cargo.lock"), lockfilePath),
  copyFile(path.join(repositoryRoot, sourceContract.license.sourcePath), licensePath),
]);
if (process.platform !== "win32") {
  await chmod(executablePath, 0o500);
}
const sbom = createSbom(metadata, graph, builtAt, sourceDigest, targetTriple);
await Promise.all([
  writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`, { flag: "wx", mode: 0o600 }),
  writeFile(auditPath, `${JSON.stringify(auditReport, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  }),
]);

const [actestraCommit, status] = await Promise.all([
  requireSuccess("git", ["rev-parse", "HEAD"]),
  requireSuccess("git", ["status", "--porcelain", "--untracked-files=all"]),
]);
const dirty = status.trim() !== "";
if (process.env.GITHUB_ACTIONS === "true" && dirty) {
  fail("GitHub Actions cannot emit Goose runner provenance from a dirty checkout");
}
const executableBytes = await readFile(executablePath);
const manifest = {
  contractVersion: 1,
  runner: {
    ...sourceContract.runner,
    targetTriple,
    executable: {
      file: executableName,
      sha256: sha256(executableBytes),
      size: executableBytes.byteLength,
    },
  },
  goose: sourceContract.goose,
  acp: sourceContract.acp,
  build: {
    rustToolchain: sourceContract.rust,
    profile: "release",
    cargoAuditable: requireBuildToolEvidence("cargo-auditable"),
    lockfile: {
      file: "Cargo.lock",
      sha256: await sha256File(lockfilePath),
    },
    sourceTreeSha256: sourceDigest,
  },
  materials: {
    license: {
      file: "GOOSE-APACHE-2.0.txt",
      spdx: sourceContract.license.spdx,
      sha256: await sha256File(licensePath),
    },
    sbom: {
      file: "actestra-goose-runner.cdx.json",
      format: "CycloneDX",
      specVersion: "1.6",
      sha256: await sha256File(sbomPath),
    },
    audit: {
      file: "actestra-goose-runner.audit.json",
      sha256: await sha256File(auditPath),
    },
  },
  provenance: {
    actestraCommit: actestraCommit.trim(),
    dirty,
    builder: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    builtAt,
    command: "cargo auditable build --locked --release --message-format=json-render-diagnostics",
  },
};
const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFile(path.join(outputDirectory, "actestra-goose-runner.manifest.json"), manifestBytes, {
  flag: "wx",
  mode: 0o600,
});

console.info(
  JSON.stringify({
    artifactDirectory: outputDirectory,
    targetTriple,
    manifestSha256: sha256(manifestBytes),
    executableSha256: manifest.runner.executable.sha256,
    executableSize: manifest.runner.executable.size,
    activeDependencyCount: auditReport.reachability.activeDependencyCount,
    lockDependencyCount: auditReport.lock.dependencyCount,
    auditableDependencyCount: auditReport.binary.auditableDependencyCount,
    rustSecDisposition: "RUSTSEC-2023-0071 metadata-only-not-compiled",
  }),
);
