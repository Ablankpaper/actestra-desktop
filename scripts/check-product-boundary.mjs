import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { inspectGeneralWorkerModuleGraph } from "./general-worker-authority-rules.mjs";
import { preloadPrivilegePatterns } from "./product-boundary-rules.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productSourceRoot = path.join(repositoryRoot, "apps", "desktop", "src");
const preloadRoot = path.join(productSourceRoot, "preload");
const mainRoot = path.join(productSourceRoot, "main");
const generalWorkerRoot = path.join(productSourceRoot, "utility", "worker");

const forbiddenProductPatterns = [
  { label: "AionUi product identity", pattern: /\baionui\b/i },
  { label: "Aera product identity", pattern: /\baera\b/i },
  { label: "upstream application data directory", pattern: /\.aionui/i },
  { label: "upstream service hostname", pattern: /static\.aionui\.com/i },
  { label: "upstream organization identity", pattern: /iofficeai/i },
  { label: "unapproved telemetry client", pattern: /\bsentry\b/i },
];

const aionUiCompatibilityIdentityFiles = new Set([
  "apps/desktop/src/compatibility/aionui/approvalAuthority.ts",
  "apps/desktop/src/compatibility/aionui/codingAgent.ts",
  "apps/desktop/src/compatibility/aionui/codingJourney.ts",
  "apps/desktop/src/compatibility/aionui/generalWorkBridge.ts",
  "apps/desktop/src/compatibility/aionui/generalWorkJourney.ts",
  "apps/desktop/src/compatibility/aionui/nativeObservations.ts",
  "apps/desktop/src/compatibility/aionui/scheduleContract.ts",
  "apps/desktop/src/compatibility/aionui/scheduleBridge.ts",
  "apps/desktop/src/compatibility/aionui/scheduledGeneralWork.ts",
  "apps/desktop/src/compatibility/aionui/shadowProjection.ts",
  "apps/desktop/src/compatibility/aionui/teamBridge.ts",
  "apps/desktop/src/core/productPersistence.ts",
  "apps/desktop/src/main/compatibility/aionuiApprovalAuthorityService.ts",
  "apps/desktop/src/main/compatibility/aionuiApprovalPolicyGate.ts",
  "apps/desktop/src/main/compatibility/aionuiApprovalReconciliationPolicyGate.ts",
  "apps/desktop/src/main/compatibility/aionuiCodingAgentService.ts",
  "apps/desktop/src/main/compatibility/aionuiCodingJourneyBridgeService.ts",
  "apps/desktop/src/main/compatibility/aionuiCodingJourneyService.ts",
  "apps/desktop/src/main/compatibility/aionuiGeneralWorkBridgeService.ts",
  "apps/desktop/src/main/compatibility/aionuiGeneralWorkJourneyService.ts",
  "apps/desktop/src/main/compatibility/aionuiGeneralWorkNativeContext.ts",
  "apps/desktop/src/main/compatibility/aionuiScheduleBridgeService.ts",
  "apps/desktop/src/main/compatibility/aionuiScheduleService.ts",
  "apps/desktop/src/main/compatibility/aionuiShadowProjectionService.ts",
  "apps/desktop/src/main/compatibility/aionuiTeamBridgeService.ts",
  "apps/desktop/src/main/compatibility/aionuiTeamService.ts",
  "apps/desktop/src/main/orchestration/teamJourneyWorkerRouter.ts",
  "apps/desktop/src/main/persistence/persistenceUtilityClient.ts",
  "apps/desktop/src/shared/persistenceUtilityProtocol.ts",
  "apps/desktop/src/utility/persistence/persistenceUtilityService.ts",
  "apps/desktop/src/utility/persistence/sqliteCorePersistence.ts",
  "apps/desktop/src/utility/persistence/sqliteMigrations.ts",
]);

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolvedPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(resolvedPath) : [resolvedPath];
  });
}

function relativePath(filePath) {
  return path.relative(repositoryRoot, filePath);
}

function reportPatternMatches(files, rules) {
  const findings = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const rule of rules) {
      const repositoryPath = relativePath(filePath);
      const isDeclaredAionUiCompatibilityReference =
        rule.label === "AionUi product identity" &&
        aionUiCompatibilityIdentityFiles.has(repositoryPath);
      if (rule.pattern.test(content) && !isDeclaredAionUiCompatibilityReference) {
        findings.push(`${repositoryPath}: ${rule.label}`);
      }
    }
  }

  return findings;
}

const sourceFiles = listFiles(productSourceRoot);
const identityFindings = reportPatternMatches(sourceFiles, forbiddenProductPatterns);
const preloadFindings = reportPatternMatches(listFiles(preloadRoot), preloadPrivilegePatterns);
const mainPersistenceFindings = reportPatternMatches(listFiles(mainRoot), [
  {
    label: "synchronous SQLite implementation outside utility process",
    pattern: /(?:from\s+["']node:sqlite["']|\bDatabaseSync\b)/,
  },
]);
const generalWorkerGraph = inspectGeneralWorkerModuleGraph({
  rootPath: productSourceRoot,
  entryPaths: [path.join(generalWorkerRoot, "generalWorkerEntry.ts")],
  isAllowedLocalModule: (relativePath) =>
    relativePath.startsWith("utility/worker/") ||
    relativePath === "shared/generalWorkerProtocol.ts" ||
    relativePath.startsWith("core/"),
});
const generalWorkerAuthorityFindings = generalWorkerGraph.findings;

const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
const builderConfiguration = fs.readFileSync(
  path.join(
    repositoryRoot,
    "downstream",
    "aionui-v2.1.41",
    "patches",
    "0001-actestra-identity-and-isolation.mjs",
  ),
  "utf8",
);
const entitlements = fs.readFileSync(
  path.join(repositoryRoot, "apps", "desktop", "entitlements.mac.plist"),
  "utf8",
);

const metadataFindings = [];
if (packageJson.name !== "actestra-desktop") {
  metadataFindings.push("package.json: package name must be actestra-desktop");
}
if (!builderConfiguration.includes("appId: com.bignormal.actestra")) {
  metadataFindings.push("downstream identity patch: missing Actestra bundle identifier");
}
if (!builderConfiguration.includes("productName: Actestra")) {
  metadataFindings.push("downstream identity patch: missing Actestra product name");
}
if (!builderConfiguration.includes("- actestra")) {
  metadataFindings.push("downstream identity patch: missing Actestra protocol scheme");
}

const entitlementKeys = [...entitlements.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
const allowedEntitlements = new Set(["com.apple.security.cs.allow-jit"]);
const unexpectedEntitlements = entitlementKeys.filter((key) => !allowedEntitlements.has(key));
if (unexpectedEntitlements.length > 0) {
  metadataFindings.push(
    `entitlements.mac.plist: unexpected keys ${unexpectedEntitlements.join(", ")}`,
  );
}

const findings = [
  ...identityFindings,
  ...preloadFindings,
  ...mainPersistenceFindings,
  ...generalWorkerAuthorityFindings,
  ...metadataFindings,
];
if (findings.length > 0) {
  console.error("Actestra product-boundary check failed:");
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exitCode = 1;
} else {
  console.info(
    `Actestra product-boundary check passed (${sourceFiles.length} Actestra-owned source files; the product renderer is the reviewed downstream AionUI surface).`,
  );
}
