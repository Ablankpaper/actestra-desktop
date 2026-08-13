import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { extractFile } from "@electron/asar";
import { admitGooseRunnerArtifact } from "../apps/desktop/src/main/workers/gooseRunnerArtifact.ts";

const APP_IDENTIFIER = "com.bignormal.actestra";
const APP_EXECUTABLE = "Actestra";
const P7_HOOK_MARKERS = ["ACTESTRA_P7_SECURITY_SMOKE_RESULT", "P7-A-RENDERER-002"];
const PLANNER_ENTRY = "out/main/actestra-team-planner.js";
const PLANNER_MANIFEST = "out/main/actestra-team-planner.manifest.json";

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
  const admit = options.admitRunnerArtifact ?? admitGooseRunnerArtifact;
  let admitted;
  try {
    admitted = await admit(options.runnerArtifactDirectory, {
      expectedTargetTriple: options.expectedTargetTriple,
      trustedManifestSha256: options.trustedRunnerManifestSha256,
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
  const manifestPath =
    runnerArtifactDirectory === undefined
      ? undefined
      : path.join(runnerArtifactDirectory, "actestra-goose-runner.manifest.json");
  const trustedRunnerManifestSha256 =
    process.env.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256 ??
    (manifestPath === undefined || !fs.existsSync(manifestPath)
      ? undefined
      : sha256(fs.readFileSync(manifestPath)));
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
    !expectedTargetTriple ||
    !overlay ||
    !Array.isArray(overlay.sourceCopies)
  )
    fail(
      "app, runner artifact, manifest digest, target, and materialized source-copy contract are required",
    );
  inspectP7PackagedTrust({
    appBundle,
    runnerArtifactDirectory,
    trustedRunnerManifestSha256,
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
