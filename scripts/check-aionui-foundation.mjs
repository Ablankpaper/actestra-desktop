import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provenancePath = path.join(repositoryRoot, "foundation", "aionui-v2.1.41.provenance.json");
const compatibilityPath = path.join(
  repositoryRoot,
  "foundation",
  "aionui-v2.1.41.compatibility.json",
);
const generatedDirectoryNames = new Set([
  ".git",
  "coverage",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
]);
const generatedFilePaths = new Set(["resources/windows/support/_sentry-dsn.generated.nsh"]);

const requiredRoutes = [
  "/login",
  "/guid",
  "/conversation/:id",
  "/team/:id",
  "/settings/model",
  "/assistants",
  "/settings/assistants",
  "/settings/agent",
  "/settings/agent/:id/repair",
  "/settings/skills",
  "/settings/skills/import-history",
  "/settings/skills/detail/:skillName",
  "/settings/tools",
  "/settings/capabilities",
  "/settings/capabilities/skills/import-history",
  "/settings/skills-hub",
  "/settings/appearance",
  "/settings/display",
  "/settings/webui",
  "/settings/pet",
  "/settings/system",
  "/settings/about",
  "/settings/ext/:tabId",
  "/settings",
  "/test/components",
  "/scheduled",
  "/scheduled/:job_id",
];

const requiredBridgeDomains = [
  "shell",
  "assistants",
  "conversation",
  "runtime",
  "application",
  "update",
  "autoUpdate",
  "dialog",
  "fs",
  "fileWatch",
  "workspaceOfficeWatch",
  "fileStream",
  "fileSnapshot",
  "googleAuth",
  "google",
  "bedrock",
  "mode",
  "acpConversation",
  "mcpService",
  "openclawConversation",
  "remoteAgent",
  "database",
  "previewHistory",
  "preview",
  "document",
  "pptPreview",
  "wordPreview",
  "excelPreview",
  "deepLink",
  "windowControls",
  "theme",
  "systemSettings",
  "notification",
  "task",
  "webui",
  "cron",
  "extensions",
  "channel",
  "hub",
  "realtime",
  "team",
];

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listSnapshotFiles(root) {
  const files = [];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && generatedDirectoryNames.has(entry.name)) {
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
        if (!generatedFilePaths.has(relativePath)) {
          files.push(`./${relativePath}`);
        }
      }
    }
  }

  walk(root);
  return files.sort();
}

function parseManifest(contents) {
  const entries = new Map();

  for (const line of contents.trimEnd().split("\n")) {
    const match = /^([a-f0-9]{64})  (\.\/.+)$/u.exec(line);
    if (!match) {
      throw new Error(`Malformed AionUi source-manifest line: ${line}`);
    }
    if (entries.has(match[2])) {
      throw new Error(`Duplicate AionUi source-manifest path: ${match[2]}`);
    }
    entries.set(match[2], match[1]);
  }

  return entries;
}

function requireIncludes(contents, expectedValues, label, renderNeedle) {
  const missing = expectedValues.filter((value) => !contents.includes(renderNeedle(value)));
  if (missing.length > 0) {
    throw new Error(`AionUi ${label} contract is missing: ${missing.join(", ")}`);
  }
}

function main() {
  const provenance = readJson(provenancePath);
  const compatibility = readJson(compatibilityPath);
  const snapshotRoot = path.join(repositoryRoot, provenance.sourceRoot);
  const manifestPath = path.join(repositoryRoot, provenance.manifest);
  const manifestContents = fs.readFileSync(manifestPath);
  const manifestSha = sha256(manifestContents);

  if (manifestSha !== provenance.manifestSha256) {
    throw new Error(
      `AionUi manifest hash drifted: expected ${provenance.manifestSha256}, received ${manifestSha}`,
    );
  }

  const manifestEntries = parseManifest(manifestContents.toString("utf8"));
  if (manifestEntries.size !== provenance.fileCount) {
    throw new Error(
      `AionUi manifest count drifted: expected ${provenance.fileCount}, received ${manifestEntries.size}`,
    );
  }
  if (
    provenance.fileCount + provenance.excludedTrackedFileCount !==
    provenance.upstreamTrackedFileCount
  ) {
    throw new Error("AionUi source-scope counts do not reconcile");
  }

  const snapshotFiles = listSnapshotFiles(snapshotRoot);
  const unexpected = snapshotFiles.filter((filePath) => !manifestEntries.has(filePath));
  const missing = [...manifestEntries.keys()].filter(
    (filePath) => !snapshotFiles.includes(filePath),
  );
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      [
        "AionUi snapshot file set drifted.",
        unexpected.length > 0 ? `Unexpected: ${unexpected.join(", ")}` : "",
        missing.length > 0 ? `Missing: ${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const hashFailures = [];
  for (const [relativePath, expectedHash] of manifestEntries) {
    const absolutePath = path.join(snapshotRoot, relativePath.slice(2));
    const actualHash = sha256(fs.readFileSync(absolutePath));
    if (actualHash !== expectedHash) {
      hashFailures.push(`${relativePath} expected ${expectedHash}, received ${actualHash}`);
    }
  }
  if (hashFailures.length > 0) {
    throw new Error(`AionUi snapshot content drifted:\n${hashFailures.join("\n")}`);
  }

  const packageJson = readJson(path.join(snapshotRoot, "package.json"));
  if (packageJson.name !== "AionUi" || packageJson.version !== "2.1.41") {
    throw new Error(
      `Unexpected AionUi package identity: ${String(packageJson.name)} ${String(packageJson.version)}`,
    );
  }
  if (
    compatibility.upstream.tag !== provenance.tag ||
    compatibility.upstream.commit !== provenance.commit
  ) {
    throw new Error("AionUi compatibility contract and provenance pin disagree");
  }
  if (
    compatibility.defaultDisposition !== "retain" ||
    compatibility.f0Authority.userInterfaceChangesAllowed !== false ||
    compatibility.f0Authority.actestraAuthoritativeBridgeDomains.length !== 0
  ) {
    throw new Error(
      "AionUi F0 compatibility policy must preserve UI and claim no Actestra authority",
    );
  }

  const contractRoutes = compatibility.routes.R0;
  if (
    contractRoutes.length !== requiredRoutes.length ||
    requiredRoutes.some((route) => !contractRoutes.includes(route))
  ) {
    throw new Error("AionUi compatibility contract does not retain every required route as R0");
  }

  const contractBridgeDomains = [
    ...compatibility.bridgeDomains.R1,
    ...compatibility.bridgeDomains.R2,
  ];
  if (
    new Set(contractBridgeDomains).size !== contractBridgeDomains.length ||
    contractBridgeDomains.length !== requiredBridgeDomains.length ||
    requiredBridgeDomains.some((domain) => !contractBridgeDomains.includes(domain))
  ) {
    throw new Error("AionUi compatibility contract does not classify every bridge domain once");
  }

  const routerContents = fs.readFileSync(
    path.join(snapshotRoot, "packages/desktop/src/renderer/components/layout/Router.tsx"),
    "utf8",
  );
  requireIncludes(routerContents, requiredRoutes, "route", (route) => `'${route}'`);

  const bridgeContents = fs.readFileSync(
    path.join(snapshotRoot, "packages/desktop/src/common/adapter/ipcBridge.ts"),
    "utf8",
  );
  requireIncludes(
    bridgeContents,
    requiredBridgeDomains,
    "bridge-domain",
    (domain) => `export const ${domain} =`,
  );

  console.log(
    `Verified exact AionUi ${provenance.tag} runnable desktop selection: ` +
      `${manifestEntries.size} of ${provenance.upstreamTrackedFileCount} tracked files, ` +
      `${requiredRoutes.length} routes, ${requiredBridgeDomains.length} bridge domains.`,
  );
}

main();
