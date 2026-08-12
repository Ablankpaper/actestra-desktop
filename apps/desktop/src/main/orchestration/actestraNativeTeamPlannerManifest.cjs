const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE = Object.freeze({
  name: "actestra-native-team-planner",
  version: "1.0.0",
});
const ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY = "actestra-team-planner.js";
const ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST = "actestra-team-planner.manifest.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathsFor(projectRoot) {
  const mainOutput = path.resolve(projectRoot, "out/main");
  return Object.freeze({
    entryPath: path.join(mainOutput, ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY),
    manifestPath: path.join(mainOutput, ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST),
  });
}

function expectedManifest(entryBytes) {
  return Object.freeze({
    schemaVersion: 1,
    engine: ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE,
    entry: Object.freeze({
      fileName: ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY,
      sha256: sha256(entryBytes),
      size: entryBytes.length,
    }),
  });
}

function stableManifestBytes(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function writeActestraTeamPlannerManifest(projectRoot) {
  const { entryPath, manifestPath } = pathsFor(projectRoot);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error("Actestra native Team planner bundle is missing");
  }
  const manifestBytes = stableManifestBytes(expectedManifest(fs.readFileSync(entryPath)));
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, manifestBytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporaryPath, manifestPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  verifyActestraTeamPlannerManifest(projectRoot);
  return manifestPath;
}

function verifyActestraTeamPlannerManifest(projectRoot) {
  const { entryPath, manifestPath } = pathsFor(projectRoot);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error("Actestra native Team planner bundle is missing");
  }
  let actual;
  try {
    actual = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("Actestra native Team planner manifest is missing or invalid");
  }
  const expected = expectedManifest(fs.readFileSync(entryPath));
  if (stableManifestBytes(actual) !== stableManifestBytes(expected)) {
    throw new Error("Actestra native Team planner manifest does not match the final bundle");
  }
  return Object.freeze(actual);
}

module.exports = {
  ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY,
  ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST,
  verifyActestraTeamPlannerManifest,
  writeActestraTeamPlannerManifest,
};
