import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { extractFile, listPackage } from "@electron/asar";
import { admitGooseRunnerArtifact } from "../apps/desktop/src/main/workers/gooseRunnerArtifact.ts";

const APP_IDENTIFIER = "com.bignormal.actestra";
const APP_EXECUTABLE = "Actestra";
export const P7_HOOK_MARKERS = Object.freeze([
  "ACTESTRA_P7_SECURITY_SMOKE_RESULT",
  "P7-A-RENDERER-002",
  "P7-A-CREDENTIAL-001",
  "P7-A-CREDENTIAL-003",
  "P7-A-WORKER-001",
  "P7-A-NETWORK-001",
  "P7-A-PROCESS-002",
  "P7-A-ARTIFACT-001",
]);
// electron-builder writes the native app bundle back under out/mac-*, and the
// bundle/frameworks legitimately contain symlinks. The trust root must bind
// only the Vite source outputs that are copied into app.asar's out/ namespace.
const MATERIALIZED_SOURCE_OUTPUTS = ["main", "preload", "renderer"];
const PLANNER_ENTRY = "out/main/actestra-team-planner.js";
const PLANNER_MANIFEST = "out/main/actestra-team-planner.manifest.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(`P7 packaged trust verification failed: ${message}`);
}

function defaultRunCommand(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function requiredFile(filePath, label) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) fail(`${label} is missing`);
}

function requiredExternalSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${label} is required from the caller trust root`);
  }
  return value;
}

function collectOutputEntries(root) {
  const outputRoot = path.join(root, "out");
  if (!fs.lstatSync(outputRoot, { throwIfNoEntry: false })?.isDirectory()) {
    fail("materialized package output is missing");
  }
  const entries = [];
  function visit(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : `out/${entry.name}`;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath, relative);
      } else if (entry.isFile()) {
        entries.push({ relative, bytes: fs.readFileSync(filePath) });
      } else {
        fail("materialized package output contains a non-regular entry");
      }
    }
  }
  for (const outputName of MATERIALIZED_SOURCE_OUTPUTS) {
    const sourceRoot = path.join(outputRoot, outputName);
    if (!fs.lstatSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) {
      fail(`materialized source output ${outputName} is missing`);
    }
    visit(sourceRoot, `out/${outputName}`);
  }
  if (entries.length === 0) fail("materialized package output is empty");
  return entries.sort((left, right) => left.relative.localeCompare(right.relative));
}

function digestEntries(entries) {
  const digest = createHash("sha256");
  for (const entry of entries) {
    digest.update(entry.relative);
    digest.update("\0");
    digest.update(String(entry.bytes.length));
    digest.update("\0");
    digest.update(entry.bytes);
  }
  return digest.digest("hex");
}

/**
 * Compute the caller-supplied package-output trust root. This is intentionally
 * exported so CI/build orchestration can calculate it in a separate step;
 * the verifier never falls back to calculating its own trust root.
 */
export function computeMaterializedOutputSha256(materializedRoot) {
  return digestEntries(collectOutputEntries(materializedRoot));
}

function collectPackagedOutputEntries(archive) {
  const entries = [];
  for (const rawPath of listPackage(archive)) {
    const relative = rawPath.replace(/^\/+/, "");
    if (!relative.startsWith("out/")) continue;
    try {
      entries.push({ relative, bytes: extractFile(archive, relative) });
    } catch {
      // Directory entries are listed by @electron/asar but cannot be extracted.
    }
  }
  if (entries.length === 0) fail("packaged app output is missing");
  return entries.sort((left, right) => left.relative.localeCompare(right.relative));
}

function verifyPackagedOutputBinding(archive, materializedRoot, trustedSha256) {
  const callerDigest = requiredExternalSha256(trustedSha256, "packaged output trust root");
  const materializedEntries = collectOutputEntries(materializedRoot);
  const materializedDigest = digestEntries(materializedEntries);
  if (materializedDigest !== callerDigest) {
    fail("packaged output digest is outside the caller trust root");
  }
  const packagedEntries = collectPackagedOutputEntries(archive);
  if (
    materializedEntries.length !== packagedEntries.length ||
    materializedEntries.some(
      (entry, index) =>
        packagedEntries[index]?.relative !== entry.relative ||
        !packagedEntries[index].bytes.equals(entry.bytes),
    )
  ) {
    fail("packaged output drift detected");
  }
  if (digestEntries(packagedEntries) !== callerDigest) {
    fail("packaged output digest is outside the caller trust root");
  }
  return { sha256: callerDigest, files: materializedEntries.length };
}

function containedPath(root, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    fail(`${label} must be a relative path`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`${label} escapes its trust root`);
  }
  return resolved;
}

function plistValue(infoPlist, key, runCommand) {
  const result = runCommand("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist]);
  if (result.status !== 0) fail(`Info.plist ${key} is unavailable`);
  return result.stdout.trim();
}

function verifyPackagedApp(appBundle, runCommand) {
  const infoPlist = path.join(appBundle, "Contents", "Info.plist");
  const executable = path.join(appBundle, "Contents", "MacOS", APP_EXECUTABLE);
  const archive = path.join(appBundle, "Contents", "Resources", "app.asar");
  requiredFile(infoPlist, "packaged Info.plist");
  requiredFile(executable, "packaged executable");
  requiredFile(archive, "packaged app.asar");
  if (plistValue(infoPlist, "CFBundleIdentifier", runCommand) !== APP_IDENTIFIER)
    fail("unexpected app identity");
  if (plistValue(infoPlist, "CFBundleExecutable", runCommand) !== APP_EXECUTABLE)
    fail("unexpected app executable");
  const fileResult = runCommand("/usr/bin/file", [executable]);
  if (fileResult.status !== 0 || !/arm64/u.test(`${fileResult.stdout}\n${fileResult.stderr}`))
    fail("packaged executable is not arm64");
  const verifyResult = runCommand("codesign", ["--verify", "--deep", "--strict", appBundle]);
  if (verifyResult.status !== 0) fail("codesign verification failed");
  const identityResult = runCommand("codesign", ["-dv", appBundle]);
  const identityOutput = `${identityResult.stdout}\n${identityResult.stderr}`;
  if (
    identityResult.status !== 0 ||
    !identityOutput.includes(`Identifier=${APP_IDENTIFIER}`) ||
    !/Signature=adhoc/u.test(identityOutput)
  ) {
    fail("packaged app is not the expected ad-hoc Actestra bundle");
  }
  return { archive, identity: APP_IDENTIFIER, signature: "adhoc", architecture: "arm64" };
}

function verifyPlannerAndP7Markers(archive) {
  let main;
  let planner;
  let manifest;
  try {
    main = extractFile(archive, "out/main/index.js").toString("utf8");
    planner = extractFile(archive, PLANNER_ENTRY);
    manifest = JSON.parse(extractFile(archive, PLANNER_MANIFEST).toString("utf8"));
  } catch {
    fail("packaged planner or main entry is missing");
  }
  if (P7_HOOK_MARKERS.some((marker) => !main.includes(marker)))
    fail("packaged P7 hook marker is missing");
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.engine?.name !== "actestra-native-team-planner" ||
    manifest?.entry?.fileName !== path.basename(PLANNER_ENTRY) ||
    manifest.entry.sha256 !== sha256(planner) ||
    manifest.entry.size !== planner.length
  ) {
    fail("packaged planner manifest does not match its final entry");
  }
  return { packaged: true, manifest: "verified", p7Hook: "verified" };
}

function verifySourceCopies(sourceCopies) {
  if (!sourceCopies || !Array.isArray(sourceCopies.sourceCopies))
    fail("source-copy contract is missing");
  let checked = 0;
  for (const copy of sourceCopies.sourceCopies) {
    if (
      typeof copy?.source !== "string" ||
      typeof copy?.destination !== "string" ||
      !/^[a-f0-9]{64}$/u.test(copy?.sha256 ?? "")
    )
      fail("source-copy contract is malformed");
    const source = containedPath(sourceCopies.repositoryRoot, copy.source, "source-copy source");
    const destination = containedPath(
      sourceCopies.outputRoot,
      copy.destination,
      "source-copy destination",
    );
    const sourceBytes = fs.readFileSync(source);
    const destinationBytes = fs.readFileSync(destination);
    if (sha256(sourceBytes) !== copy.sha256 || !sourceBytes.equals(destinationBytes))
      fail(`source copy drift: ${copy.destination}`);
    checked += 1;
  }
  return { drift: false, checked };
}

export async function inspectP7PackagedTrust(options) {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const verifyPackage =
    options.verifyPackage ??
    (() => {
      const result = defaultRunCommand(process.execPath, [
        "scripts/verify-packaged-app.mjs",
        options.appBundle,
      ]);
      if (result.status !== 0) fail("verify:package failed");
    });
  const app = verifyPackagedApp(options.appBundle, runCommand);
  verifyPackage();
  const planner = verifyPlannerAndP7Markers(app.archive);
  const output = verifyPackagedOutputBinding(
    app.archive,
    options.materializedRoot,
    options.trustedPackagedOutputSha256,
  );
  const admit = options.admitRunnerArtifact ?? admitGooseRunnerArtifact;
  const trustedRunnerManifestSha256 = requiredExternalSha256(
    options.trustedRunnerManifestSha256,
    "Goose runner manifest digest",
  );
  let admitted;
  try {
    admitted = await admit(options.runnerArtifactDirectory, {
      expectedTargetTriple: options.expectedTargetTriple,
      trustedManifestSha256: trustedRunnerManifestSha256,
    });
  } catch (error) {
    fail(
      `external Goose runner admission failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
  if (admitted.targetTriple !== options.expectedTargetTriple)
    fail("external Goose runner architecture drifted");
  const sourceCopy = verifySourceCopies(options.sourceCopies);
  return Object.freeze({
    schemaVersion: 1,
    app: { ...app, packageVerification: "passed" },
    planner,
    output,
    gooseRunner: {
      packaged: false,
      disposition: "external-admitted",
      manifest: "verified",
      sbom: "verified",
      license: "verified",
      audit: "verified",
      targetTriple: admitted.targetTriple,
    },
    sourceCopy,
  });
}

if (import.meta.main) {
  const repositoryRoot = process.cwd();
  const appBundle =
    process.argv[2] ??
    path.join(repositoryRoot, ".actestra", "aionui-v2.1.41", "out", "mac-arm64", "Actestra.app");
  const expectedTargetTriple =
    process.env.ACTESTRA_GOOSE_RUNNER_TARGET_TRIPLE ??
    (process.platform === "darwin" && process.arch === "arm64"
      ? "aarch64-apple-darwin"
      : undefined);
  const runnerArtifactDirectory =
    process.env.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY ??
    (expectedTargetTriple === undefined
      ? undefined
      : path.join(repositoryRoot, ".actestra", "goose-runner", expectedTargetTriple));
  const trustedRunnerManifestSha256 = process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256;
  const trustedPackagedOutputSha256 = process.env.ACTESTRA_AIONUI_PACKAGED_OUTPUT_SHA256;
  const overlayPath = path.join(
    repositoryRoot,
    ".actestra",
    "aionui-v2.1.41",
    ".actestra-overlay.json",
  );
  const overlay = fs.existsSync(overlayPath)
    ? JSON.parse(fs.readFileSync(overlayPath, "utf8"))
    : null;
  if (
    !runnerArtifactDirectory ||
    !trustedRunnerManifestSha256 ||
    !trustedPackagedOutputSha256 ||
    !expectedTargetTriple ||
    !overlay ||
    !Array.isArray(overlay.sourceCopies)
  )
    fail(
      "app, runner artifact, external manifest/output digests, target, and materialized source-copy contract are required",
    );
  inspectP7PackagedTrust({
    appBundle,
    materializedRoot: path.join(repositoryRoot, ".actestra", "aionui-v2.1.41"),
    runnerArtifactDirectory,
    trustedRunnerManifestSha256,
    trustedPackagedOutputSha256,
    expectedTargetTriple,
    sourceCopies: {
      repositoryRoot,
      outputRoot: path.join(repositoryRoot, ".actestra", "aionui-v2.1.41"),
      sourceCopies: overlay.sourceCopies,
    },
  })
    .then((evidence) => console.info(JSON.stringify(evidence)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
