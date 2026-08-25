import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeAionUiDownstream,
  resolveContainedPath,
} from "./materialize-aionui-downstream.mjs";
import {
  extractStaticModuleSpecifiers,
  inspectGeneralWorkerModuleGraph,
} from "./general-worker-authority-rules.mjs";
import {
  actestraTeamRendererAuthorityPaths,
  actestraTeamRendererPrivilegePatterns,
  inspectSourceFilesForPrivilegePatterns,
} from "./product-boundary-rules.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayPath = path.join(repositoryRoot, "downstream", "aionui-v2.1.41", "overlay.json");
const provenancePath = path.join(repositoryRoot, "foundation", "aionui-v2.1.41.provenance.json");
const generatedNames = new Set([
  ".DS_Store",
  ".actestra-overlay.json",
  "_sentry-dsn.generated.nsh",
  "node_modules",
  "out",
]);

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (generatedNames.has(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolutePath).split(path.sep).join("/"));
      }
    }
  }
  walk(root);
  return files.sort();
}

function requireText(filePath, values) {
  const contents = fs.readFileSync(filePath, "utf8");
  for (const value of values) {
    if (!contents.includes(value)) {
      throw new Error(`${path.relative(repositoryRoot, filePath)} is missing ${value}`);
    }
  }
}

function rejectText(filePath, values) {
  const contents = fs.readFileSync(filePath, "utf8");
  for (const value of values) {
    if (contents.includes(value)) {
      throw new Error(`${path.relative(repositoryRoot, filePath)} contains forbidden ${value}`);
    }
  }
}

function requireOrderedText(filePath, anchor, first, second) {
  const contents = fs.readFileSync(filePath, "utf8");
  const anchorIndex = contents.indexOf(anchor);
  const bodyStart = anchorIndex === -1 ? -1 : contents.indexOf("{", anchorIndex + anchor.length);
  const bodyEnd = bodyStart === -1 ? -1 : contents.indexOf("\n}", bodyStart + 1);
  const body = bodyStart === -1 || bodyEnd === -1 ? "" : contents.slice(bodyStart + 1, bodyEnd);
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  if (
    anchorIndex === -1 ||
    bodyStart === -1 ||
    bodyEnd === -1 ||
    firstIndex === -1 ||
    secondIndex === -1 ||
    firstIndex >= secondIndex
  ) {
    throw new Error(
      `${path.relative(repositoryRoot, filePath)} must place ${first} before ${second}`,
    );
  }
}

function requireOrderedFragments(filePath, fragments) {
  const contents = fs.readFileSync(filePath, "utf8");
  let cursor = 0;
  for (const fragment of fragments) {
    const index = contents.indexOf(fragment, cursor);
    if (index === -1) {
      throw new Error(
        `${path.relative(repositoryRoot, filePath)} is missing ordered structure ${fragment}`,
      );
    }
    cursor = index + fragment.length;
  }
}

function main() {
  const overlay = readJson(overlayPath);
  const provenance = readJson(provenancePath);
  const sourceRoot = resolveContainedPath(
    repositoryRoot,
    provenance.sourceRoot,
    "AionUi provenance source root",
  );
  const { outputRoot } = materializeAionUiDownstream({
    linkLocalDependencies: true,
  });

  if (
    overlay.schemaVersion !== 1 ||
    overlay.phase !== "P6-aionui-native-team-work" ||
    !overlay.migration.strategy.includes("schema v14") ||
    !overlay.migration.strategy.includes("schemas v1-v13") ||
    !overlay.migration.strategy.includes("schema v15") ||
    !overlay.migration.strategy.includes("team_definitions") ||
    !overlay.migration.strategy.includes("team_runs") ||
    !overlay.migration.strategy.includes("team_run_revisions") ||
    !overlay.migration.strategy.includes("schema v17") ||
    !overlay.migration.strategy.includes("standard_team_message_deliveries") ||
    !overlay.migration.rollback.includes("schema v14") ||
    !overlay.migration.rollback.includes("schema v15") ||
    !overlay.migration.rollback.includes("schema v17") ||
    !overlay.migration.rollback.includes("patch 0014") ||
    !overlay.migration.rollback.includes("patch 0013") ||
    !overlay.patches.some((patch) => patch.path === "patches/0014-actestra-team-work.mjs") ||
    !overlay.patches.some(
      (patch) => patch.path === "patches/0015-actestra-macos-build-hardening.mjs",
    ) ||
    !overlay.patches.some(
      (patch) => patch.path === "patches/0016-actestra-provider-credential-and-capability.mjs",
    ) ||
    !overlay.patches.some(
      (patch) => patch.path === "patches/0017-actestra-p7-security-smoke.mjs",
    ) ||
    !overlay.patches.some(
      (patch) => patch.path === "patches/0020-actestra-p7-diagnostic-export.mjs",
    ) ||
    !overlay.patches.some(
      (patch) => patch.path === "patches/0021-actestra-ubuntu-apparmor-bootstrap.mjs",
    ) ||
    !overlay.patches.some(
      (patch) => patch.path === "patches/0022-actestra-p8-fresh-profile-smoke.mjs",
    ) ||
    overlay.uiContract.layoutChangesAllowed !== true ||
    overlay.uiContract.featureEntryRemovalAllowed !== false
  ) {
    throw new Error("Invalid P6 AionUI-native Team-work downstream overlay policy");
  }

  const teamPatch = overlay.patches.find(
    (patch) => patch.path === "patches/0014-actestra-team-work.mjs",
  );
  for (const classification of ["R1", "R2"]) {
    if (!teamPatch.classification.includes(classification)) {
      throw new Error(`P6 Team patch is missing ${classification} retention classification`);
    }
  }
  for (const domain of [
    "AionUI Team provider",
    "Team creation and group chat",
    "Team plan and Worker explainability",
    "Team controls and Artifact aggregation",
    "Team restart recovery",
  ]) {
    if (!teamPatch.domains.includes(domain)) {
      throw new Error(`P6 Team patch is missing reviewed domain: ${domain}`);
    }
  }
  const freshProfilePatch = overlay.patches.find(
    (patch) => patch.path === "patches/0022-actestra-p8-fresh-profile-smoke.mjs",
  );
  if (
    freshProfilePatch.classification.length !== 1 ||
    freshProfilePatch.classification[0] !== "R1" ||
    !freshProfilePatch.authorityOwner.includes("Actestra Main") ||
    !freshProfilePatch.rollback.includes("Regenerate without patch 0022")
  ) {
    throw new Error("Invalid P8.2d fresh-profile downstream authority metadata");
  }

  const diagnosticExportPatch = overlay.patches.find(
    (patch) => patch.path === "patches/0020-actestra-p7-diagnostic-export.mjs",
  );
  if (
    diagnosticExportPatch.classification.length !== 1 ||
    diagnosticExportPatch.classification[0] !== "R1" ||
    !diagnosticExportPatch.authorityOwner.includes("Actestra Main") ||
    !diagnosticExportPatch.rollback.includes("Regenerate without patch 0020")
  ) {
    throw new Error("Invalid P7.4 diagnostic-export downstream authority metadata");
  }

  const linuxAppArmorPatch = overlay.patches.find(
    (patch) => patch.path === "patches/0021-actestra-ubuntu-apparmor-bootstrap.mjs",
  );
  if (
    linuxAppArmorPatch.classification.length !== 1 ||
    linuxAppArmorPatch.classification[0] !== "R1" ||
    !linuxAppArmorPatch.authorityOwner.includes("electron-builder") ||
    !linuxAppArmorPatch.rollback.includes("Regenerate without patch 0021")
  ) {
    throw new Error("Invalid Ubuntu AppArmor downstream authority metadata");
  }
  for (const domain of [
    "Ubuntu DEB AppArmor profile",
    "root-owned Goose package resources",
    "Linux runner admission",
  ]) {
    if (!linuxAppArmorPatch.domains.includes(domain)) {
      throw new Error(`Ubuntu AppArmor patch is missing reviewed domain: ${domain}`);
    }
  }
  for (const domain of [
    "explicit-consent local diagnostic export",
    "fixed current-main-frame diagnostic IPC",
    "metadata-only audit and terminal-attempt evidence",
    "packaged P7.4 diagnostic and audit acceptance",
  ]) {
    if (!diagnosticExportPatch.domains.includes(domain)) {
      throw new Error(`P7.4 diagnostic patch is missing reviewed domain: ${domain}`);
    }
  }

  for (const patch of overlay.patches) {
    resolveContainedPath(path.dirname(overlayPath), patch.path, "AionUi downstream patch metadata");
    if (
      !Array.isArray(patch.classification) ||
      patch.classification.length === 0 ||
      !patch.authorityOwner ||
      !patch.rollback
    ) {
      throw new Error(`Incomplete downstream patch metadata: ${patch.path}`);
    }
  }

  const repositoryPackage = readJson(path.join(repositoryRoot, "package.json"));
  if (
    repositoryPackage.scripts?.["smoke:p7-4-diagnostic-audit"] !==
    "node scripts/smoke-p7-4-diagnostic-audit.mjs"
  ) {
    throw new Error("Missing P7.4 packaged diagnostic smoke script");
  }
  const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  const macosJob = workflow.slice(workflow.indexOf("\n  macos:"));
  const p72SmokeIndex = macosJob.indexOf("bun run smoke:p7-2-resource-reliability");
  const p74SmokeIndex = macosJob.indexOf("bun run smoke:p7-4-diagnostic-audit");
  if (p72SmokeIndex === -1 || p74SmokeIndex <= p72SmokeIndex) {
    throw new Error("P7.4 packaged diagnostic smoke must follow the P7.2 smoke in macOS CI");
  }

  const sourceFiles = new Set(listFiles(sourceRoot));
  const outputFiles = new Set(listFiles(outputRoot));
  const changedFiles = new Set();

  for (const filePath of new Set([...sourceFiles, ...outputFiles])) {
    const sourcePath = path.join(sourceRoot, filePath);
    const outputPath = path.join(outputRoot, filePath);
    if (!sourceFiles.has(filePath) || !outputFiles.has(filePath)) {
      changedFiles.add(filePath);
      continue;
    }
    if (sha256(fs.readFileSync(sourcePath)) !== sha256(fs.readFileSync(outputPath))) {
      changedFiles.add(filePath);
    }
  }

  const expectedChangedFiles = new Set(overlay.expectedChangedFiles);
  const unexpected = [...changedFiles].filter((filePath) => !expectedChangedFiles.has(filePath));
  const missing = [...expectedChangedFiles].filter((filePath) => !changedFiles.has(filePath));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      [
        "Downstream changed-file contract drifted.",
        unexpected.length > 0 ? `Unexpected: ${unexpected.join(", ")}` : "",
        missing.length > 0 ? `Missing: ${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  for (const filePath of overlay.invariantFiles) {
    const sourceHash = sha256(
      fs.readFileSync(resolveContainedPath(sourceRoot, filePath, "AionUi invariant source file")),
    );
    const outputHash = sha256(
      fs.readFileSync(resolveContainedPath(outputRoot, filePath, "AionUi invariant output file")),
    );
    if (sourceHash !== outputHash) {
      throw new Error(`R0 invariant file changed: ${filePath}`);
    }
  }

  const sourceCopyDestinations = new Set();
  for (const sourceCopy of overlay.sourceCopies) {
    if (
      typeof sourceCopy.source !== "string" ||
      !sourceCopy.source.startsWith("apps/desktop/src/") ||
      typeof sourceCopy.destination !== "string" ||
      !sourceCopy.destination.startsWith("packages/desktop/src/actestra/") ||
      sourceCopyDestinations.has(sourceCopy.destination)
    ) {
      throw new Error(`Invalid Actestra source-copy contract: ${JSON.stringify(sourceCopy)}`);
    }
    sourceCopyDestinations.add(sourceCopy.destination);
    const sourceHash = sha256(
      fs.readFileSync(
        resolveContainedPath(repositoryRoot, sourceCopy.source, "Actestra source-copy source"),
      ),
    );
    const outputHash = sha256(
      fs.readFileSync(
        resolveContainedPath(
          outputRoot,
          sourceCopy.destination,
          "Actestra source-copy destination",
        ),
      ),
    );
    if (sourceHash !== outputHash) {
      throw new Error(
        `Actestra source copy drifted from its reviewed source: ${sourceCopy.destination}`,
      );
    }
  }
  const formatterConfig = readJson(path.join(outputRoot, ".oxfmtrc.json"));
  const sourceCopyFormatterOverride = Array.isArray(formatterConfig.overrides)
    ? formatterConfig.overrides.find(
        (override) =>
          Array.isArray(override?.files) &&
          override.files.includes("packages/desktop/src/actestra/**/*.{js,jsx,ts,tsx,cjs,mjs}"),
      )
    : undefined;
  if (
    sourceCopyFormatterOverride?.options?.singleQuote !== false ||
    sourceCopyFormatterOverride?.options?.jsxSingleQuote !== false ||
    sourceCopyFormatterOverride?.options?.printWidth !== 100 ||
    sourceCopyFormatterOverride?.options?.trailingComma !== "all"
  ) {
    throw new Error("Actestra source-copy formatter ownership override is missing or widened");
  }
  for (const requiredScheduleSourceCopy of [
    "packages/desktop/src/actestra/compatibility/aionui/scheduleContract.ts",
    "packages/desktop/src/actestra/compatibility/aionui/scheduleBridge.ts",
    "packages/desktop/src/actestra/compatibility/aionui/scheduledGeneralWork.ts",
    "packages/desktop/src/actestra/main/compatibility/aionuiScheduleBridgeService.ts",
    "packages/desktop/src/actestra/main/compatibility/aionuiScheduleService.ts",
  ]) {
    if (!sourceCopyDestinations.has(requiredScheduleSourceCopy)) {
      throw new Error(`Missing scheduled-work source copy: ${requiredScheduleSourceCopy}`);
    }
  }
  for (const requiredCodingSourceCopy of [
    "packages/desktop/src/actestra/main/compatibility/aionuiCodingArtifactService.ts",
    "packages/desktop/src/actestra/main/workers/gooseAcpHandshake.ts",
    "packages/desktop/src/actestra/main/workers/gooseCodingToolInvoker.ts",
    "packages/desktop/src/actestra/main/workers/gooseCodingEvidenceCoordinator.ts",
    "packages/desktop/src/actestra/main/workers/gooseBridgeSocket.ts",
    "packages/desktop/src/actestra/main/workers/gooseLoopbackModelServer.ts",
    "packages/desktop/src/actestra/main/workers/gooseMcpCapabilityServer.ts",
    "packages/desktop/src/actestra/main/workers/gooseMcpSessionComposition.ts",
    "packages/desktop/src/actestra/main/workers/gooseRunnerArtifact.ts",
    "packages/desktop/src/actestra/main/workers/gooseRunnerLinuxPackage.ts",
    "packages/desktop/src/actestra/main/workers/actestraCodingJourneyRuntime.ts",
    "packages/desktop/src/actestra/main/workers/gooseRunnerProcess.ts",
    "packages/desktop/src/actestra/main/workers/gooseRunnerTarget.ts",
    "packages/desktop/src/actestra/main/workers/isolatedCodingMainService.ts",
    "packages/desktop/src/actestra/main/workers/isolatedCodingWorktree.ts",
    "packages/desktop/src/actestra/main/privileged/isolatedCodingToolExecutor.ts",
    "packages/desktop/src/actestra/main/privileged/isolatedCodingToolPlatform.ts",
    "packages/desktop/src/actestra/shared/gooseRunnerSource.json",
    "packages/desktop/src/actestra/shared/gooseRunnerLinuxPackage.ts",
  ]) {
    if (!sourceCopyDestinations.has(requiredCodingSourceCopy)) {
      throw new Error(`Missing isolated-coding source copy: ${requiredCodingSourceCopy}`);
    }
  }
  for (const requiredMainModelSourceCopy of [
    "packages/desktop/src/actestra/main/model/actestraMainModelJson.ts",
    "packages/desktop/src/actestra/main/model/actestraMainModelBroker.ts",
    "packages/desktop/src/actestra/main/workers/actestraGeneralWorkRuntime.ts",
  ]) {
    if (!sourceCopyDestinations.has(requiredMainModelSourceCopy)) {
      throw new Error(`Missing Main model source copy: ${requiredMainModelSourceCopy}`);
    }
  }
  for (const requiredTeamSourceCopy of [
    "packages/desktop/src/actestra/core/teamRun.ts",
    "packages/desktop/src/actestra/compatibility/aionui/teamBridge.ts",
    "packages/desktop/src/actestra/main/compatibility/aionuiTeamBridgeService.ts",
    "packages/desktop/src/actestra/main/compatibility/aionuiTeamService.ts",
    "packages/desktop/src/actestra/main/orchestration/actestraNativeTeamPlanner.ts",
    "packages/desktop/src/actestra/main/orchestration/actestraNativeTeamPlannerProcess.ts",
    "packages/desktop/src/actestra/main/orchestration/teamPlanAdmissionService.ts",
    "packages/desktop/src/actestra/main/orchestration/teamOrchestratorService.ts",
    "packages/desktop/src/actestra/main/orchestration/teamJourneyWorkerRouter.ts",
    "packages/desktop/src/actestra/main/orchestration/teamPlannerSidecarProcess.ts",
    "packages/desktop/src/actestra/main/orchestration/teamWorkspaceGrantContext.ts",
    "packages/desktop/src/actestra/main/privileged/approvalAuditEvidence.ts",
    "packages/desktop/src/actestra/shared/teamPlannerSidecarProtocol.ts",
    "packages/desktop/src/actestra/utility/orchestration/actestraNativeTeamPlannerEntry.ts",
  ]) {
    if (!sourceCopyDestinations.has(requiredTeamSourceCopy)) {
      throw new Error(`Missing Team-work source copy: ${requiredTeamSourceCopy}`);
    }
  }
  for (const requiredDiagnosticSourceCopy of [
    "packages/desktop/src/actestra/core/diagnosticEvidence.ts",
    "packages/desktop/src/actestra/compatibility/aionui/diagnosticExport.ts",
    "packages/desktop/src/actestra/main/diagnostics/diagnosticExportService.ts",
    "packages/desktop/src/actestra/main/security/p7DiagnosticAuditSmoke.ts",
  ]) {
    if (!sourceCopyDestinations.has(requiredDiagnosticSourceCopy)) {
      throw new Error(`Missing P7.4 diagnostic source copy: ${requiredDiagnosticSourceCopy}`);
    }
  }
  const plannerManifestDestination =
    "packages/desktop/src/actestra/scripts/actestraNativeTeamPlannerManifest.cjs";
  if (!sourceCopyDestinations.has(plannerManifestDestination)) {
    throw new Error(
      `Missing native planner manifest helper source copy: ${plannerManifestDestination}`,
    );
  }
  for (const admissionDisabledSourceCopy of [
    "packages/desktop/src/actestra/main/orchestration/localClaudeProductRuntime.ts",
    "packages/desktop/src/actestra/main/orchestration/supervisedLocalAgentProvider.ts",
    "packages/desktop/src/actestra/main/orchestration/supervisedLocalAgentRuntime.ts",
  ]) {
    if (sourceCopyDestinations.has(admissionDisabledSourceCopy)) {
      throw new Error(
        `Admission-disabled local-Agent evaluation code entered the product graph: ${admissionDisabledSourceCopy}`,
      );
    }
  }
  for (const sourceCopy of overlay.sourceCopies) {
    const declared = `${sourceCopy.source}\n${sourceCopy.destination}`;
    if (
      declared.includes("tests/fixtures") ||
      declared.includes("localAgentCli") ||
      declared.includes("teamPlannerSidecar.mjs")
    ) {
      throw new Error(`Test-only planner source entered the product graph: ${declared}`);
    }
  }
  for (const requiredR0Path of [
    "packages/desktop/src/common/adapter/ipcBridge.ts",
    "packages/desktop/src/renderer/components/layout/Router.tsx",
    "packages/desktop/src/renderer/components/layout/Sider/index.tsx",
  ]) {
    if (!overlay.invariantFiles.includes(requiredR0Path)) {
      throw new Error(`The preserved AionUI path must remain an R0 invariant: ${requiredR0Path}`);
    }
  }
  for (const changedPath of overlay.expectedChangedFiles) {
    const normalizedPath = changedPath.toLowerCase();
    if (
      normalizedPath.includes("eigent") ||
      normalizedPath.includes("crewai") ||
      (normalizedPath.includes("goose") && normalizedPath.includes("renderer/pages"))
    ) {
      throw new Error(`A second upstream application UI/runtime path entered P6: ${changedPath}`);
    }
  }

  const teamRendererAuthorityFindings = inspectSourceFilesForPrivilegePatterns({
    rootPath: outputRoot,
    relativePaths: actestraTeamRendererAuthorityPaths,
    rules: actestraTeamRendererPrivilegePatterns,
  });
  if (teamRendererAuthorityFindings.length > 0) {
    throw new Error(
      `Actestra Team renderer authority boundary is invalid: ${teamRendererAuthorityFindings
        .map((finding) => `${finding.relativePath}: ${finding.label}`)
        .join("; ")}`,
    );
  }

  for (const assetCopy of overlay.assetCopies) {
    const sourcePath = resolveContainedPath(
      repositoryRoot,
      assetCopy.source,
      "Actestra asset-copy source",
    );
    const destinationPath = resolveContainedPath(
      outputRoot,
      assetCopy.destination,
      "Actestra asset-copy destination",
    );
    if (
      sha256(fs.readFileSync(sourcePath)) !== assetCopy.sha256 ||
      sha256(fs.readFileSync(destinationPath)) !== assetCopy.sha256
    ) {
      throw new Error(`Actestra asset copy drifted: ${assetCopy.destination}`);
    }
  }

  const linuxProfileAsset = overlay.assetCopies.find(
    (asset) =>
      asset.source === "apps/desktop/resources/linux/actestra-apparmor-profile" &&
      asset.destination === "resources/actestra-apparmor-profile",
  );
  if (linuxProfileAsset === undefined) {
    throw new Error("Missing Ubuntu AppArmor profile asset-copy contract");
  }

  const packageJson = readJson(path.join(outputRoot, "package.json"));
  if (
    packageJson.name !== "actestra-desktop" ||
    packageJson.productName !== "Actestra" ||
    packageJson.version !== "0.1.0-alpha.0"
  ) {
    throw new Error("Materialized package does not have the Actestra F1 identity");
  }

  const builderConfigPath = path.join(outputRoot, "packages/desktop/electron-builder.yml");
  requireText(builderConfigPath, [
    "appId: com.bignormal.actestra",
    "productName: Actestra",
    "executableName: Actestra",
    "Portions Copyright © 2024 AionUi contributors.",
    "- actestra",
    "- node_modules/docx/LICENSE",
    "- node_modules/croner/LICENSE",
    "from: node_modules/electron/dist/LICENSE",
    "to: LICENSE.electron.txt",
    "from: node_modules/electron/dist/LICENSES.chromium.html",
    "to: LICENSES.chromium.html",
  ]);
  requireOrderedFragments(builderConfigPath, [
    "extraResources:",
    "- from: resources/actestra-goose-runner\n    to: actestra-goose-runner",
    "- from: resources/actestra-goose-runner-admission.json\n    to: actestra-goose-runner-admission.json",
    "deb:\n  appArmorProfile: resources/actestra-apparmor-profile",
    "linux:\n",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/common/config/actestraProduct.ts"), [
    "name: 'Actestra'",
    "protocol: 'actestra'",
    "profileLayoutVersion: 1",
    "telemetry: false",
    "updates: false",
    "feedback: false",
    "upstreamOfficialServices: false",
    "publicListeners: false",
    "return environment.ACTESTRA_CDP_PORT ?? environment.AIONUI_CDP_PORT",
    "if (input.packaged)",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/renderer/components/layout/Layout.tsx"), [
    ">Actestra<",
  ]);
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx",
    ),
    ["data-testid='actestra-provider-unavailable'"],
  );
  requireText(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "ACTESTRA_P8_FRESH_PROFILE_READY",
    "ACTESTRA_P8_FRESH_PROFILE_SMOKE !== '1'",
    "window.electronAPI?.actestraProviderList",
    "actestra-provider-unavailable",
    "app.quit()",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/common/adapter/httpBridge.ts"), [
    "publishActestraHttpObservation",
    "publishActestraWebSocketObservation",
    "ACTESTRA_SCHEDULE_PATH = '/api/cron'",
    "requestActestraSchedule",
    "window.actestraSchedule!.onEvent",
    "scheduleUnavailableError",
  ]);
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/common/adapter/httpBridge.ts"),
    [
      "if (isActestraSchedulePath(path))",
      "return requestActestraSchedule<T>(method, path, body);",
      "const approvalRoute = await routeActestraApprovalRequest",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/common/adapter/httpBridge.ts"),
    [
      "if (isActestraScheduleEventName(eventName))",
      "return scheduleEmitter<Params>(eventName);",
      "ensureWs();",
    ],
  );
  rejectText(path.join(outputRoot, "packages/desktop/src/common/adapter/httpBridge.ts"), [
    "ACTESTRA_TEAM_PATH = '/api/teams'",
    "isActestraTeamProviderActive",
    "requestActestraTeam",
    "teamEmitter",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/preload/main.ts"), [
    "contextBridge.exposeInMainWorld('actestraTeam'",
    "ACTESTRA_TEAM_REQUEST_CHANNEL",
    "ACTESTRA_TEAM_EVENT_CHANNEL",
    "assertAionUiTeamEvent(value)",
    "ipcRenderer.invoke(ACTESTRA_TEAM_REQUEST_CHANNEL, request)",
    "ipcRenderer.on(ACTESTRA_TEAM_EVENT_CHANNEL, listener)",
    "ipcRenderer.off(ACTESTRA_TEAM_EVENT_CHANNEL, listener)",
    "contextBridge.exposeInMainWorld('actestraSchedule'",
    "ACTESTRA_SCHEDULE_REQUEST_CHANNEL",
    "ACTESTRA_SCHEDULE_EVENT_CHANNEL",
    "assertAionUiScheduleEvent(value)",
    "ipcRenderer.invoke(ACTESTRA_SCHEDULE_REQUEST_CHANNEL, request)",
    "ipcRenderer.on(ACTESTRA_SCHEDULE_EVENT_CHANNEL, listener)",
    "ipcRenderer.off(ACTESTRA_SCHEDULE_EVENT_CHANNEL, listener)",
    "contextBridge.exposeInMainWorld('actestraDiagnostics'",
    "exportReport: async () =>",
    "ipcRenderer.invoke(AIONUI_DIAGNOSTIC_EXPORT_CHANNEL)",
    "assertAionUiDiagnosticExportResult(result)",
  ]);
  rejectText(path.join(outputRoot, "packages/desktop/src/preload/main.ts"), [
    "exportReport: async (path",
    "showSaveDialog",
    "DiagnosticExportService",
    "openSqliteCorePersistence",
    "node:sqlite",
    "DatabaseSync",
    "node:fs",
  ]);
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/compatibility/aionui/diagnosticExport.ts"),
    [
      'AIONUI_DIAGNOSTIC_EXPORT_CHANNEL = "actestra:diagnostic-export"',
      "args.length !== 0",
      "event.sender === webContents",
      "event.senderFrame === webContents.mainFrame",
      "options.ipcMain.removeHandler(AIONUI_DIAGNOSTIC_EXPORT_CHANNEL)",
      'return Object.freeze({ status: "rejected" })',
    ],
  );
  rejectText(
    path.join(outputRoot, "packages/desktop/src/actestra/compatibility/aionui/diagnosticExport.ts"),
    ["filePath", "reportBytes", "reportContent", "node:fs", "node:sqlite", "fetch("],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/compatibility/aionui/teamBridge.ts"),
    [
      "AIONUI_TEAM_BRIDGE_CONTRACT_VERSION = 1",
      'ACTESTRA_TEAM_REQUEST_CHANNEL = "actestra:team-request-v1"',
      'ACTESTRA_TEAM_EVENT_CHANNEL = "actestra:team-event-v1"',
      'ACTESTRA_TEAM_LOCAL_USER_ID = "actestra-local-user"',
      'segments[0] !== "api"',
      'segments[1] !== "teams"',
      '"team-planner-unavailable": 503',
      'authority_source: "schema-15-team-run"',
      'authority_source: "actestra-main-runtime"',
      '"restart-after-planner-admission"',
      "assertAionUiTeamBridgeRequest",
      "assertAionUiTeamBridgeResponse",
      "assertAionUiTeamEvent",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiTeamBridgeService.ts",
    ),
    [
      "class AionUiTeamBridgeService",
      '"team-planner-unavailable": 503',
      "registerAionUiTeamBridgeIpc",
      "event.sender === trusted.webContents",
      "event.senderFrame === trusted.mainFrame",
      "trusted.webContents.send(ACTESTRA_TEAM_EVENT_CHANNEL, event)",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/main/compatibility/aionuiTeamService.ts"),
    [
      "class AionUiTeamService",
      "persistTeamDefinition",
      "team-planner-unavailable",
      'authority_source: "schema-15-team-run"',
      'blocked_reason: "planner-unavailable"',
      'next_action: "restart-after-planner-admission"',
      "next_actions",
      "decideApproval",
      "resolveFeedback",
      "requestHandoff",
      "cancelRun",
      "getAdmittedTeamPlan",
      "#projectActivities",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/common/config/actestraShadowContract.ts"),
    ["actestra:shadow-observe-v1"],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "event.senderFrame !== currentWindow.webContents.mainFrame",
      "initializeActestraPersistenceUtility",
      "launchElectronPersistenceUtility",
      "actestra-persistence-utility.js",
      "persistence-unavailable",
      "ACTESTRA_APPROVAL_DECIDE_CHANNEL",
      "AionUiApprovalAuthorityService",
      "ACTESTRA_APPROVAL_AUTHORITY",
      "ACTESTRA_APPROVAL_POLICY_GATE",
      "ACTESTRA_APPROVAL_RECONCILIATION_GATE",
      "createPolicyGatedAionUiApprovalNativeTransport",
      "createPolicyGatedAionUiApprovalReconciliationTransport",
      "createScopedNativeToolPlatform",
      "getActestraScopedNativeToolPlatform",
      "[Actestra native tools] Ready tools=",
      "createIsolatedCodingMainService",
      "getActestraIsolatedCodingMainService",
      "path.join(userDataPath, 'coding-worktrees')",
      "[Actestra isolated coding] Desktop-main containment ready",
      "GeneralWorkCoordinator",
      "ACTESTRA_GENERAL_WORK_RECOVERY_READY",
      "ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL",
      "ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL",
      "runActestraGeneralWorkSmoke",
      "ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_READY",
      "local-research-artifact-fixture",
      "writing-artifact-fixture",
      "office-document-artifact-fixture",
      "TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID",
      "AionUiScheduleService",
      "registerAionUiScheduleBridgeIpc",
      "ACTESTRA_AIONUI_SCHEDULE_RECOVERY_READY",
      "ActestraTeamComposition",
      "configureActestraTeamRuntime",
      "registerRecoveredTeamBridge",
      "DiagnosticExportService",
      "registerAionUiDiagnosticExportIpc",
      "disposeDiagnosticExportIpc",
      "dialog.showSaveDialog",
      "resolveP7DiagnosticAuditSmokeIsolation",
      "runP7PackagedDiagnosticAuditSmoke",
      "P7_DIAGNOSTIC_AUDIT_SMOKE_MARKER",
      "p7DiagnosticAuditSmokeStarted",
      "ACTESTRA_P7_DIAGNOSTIC_AUDIT_FAILED",
      "void startP7DiagnosticAuditSmoke()",
      "[Actestra schedule] Recovery unavailable at startup",
      "[Actestra general work] Recovery unavailable at startup",
      "nativeFallback",
      "recoverPending",
    ],
  );
  rejectText(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    ["openSqliteCorePersistence", "node:sqlite", "DatabaseSync"],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/main/security/p7DiagnosticAuditSmoke.ts"),
    [
      "P7_DIAGNOSTIC_AUDIT_SMOKE_MARKER",
      "ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE",
      "resolveP7DiagnosticAuditSmokeIsolation",
      "runP7PackagedDiagnosticAuditSmoke",
      "new DiagnosticExportService",
      "readPrivilegedAuditRetentionState",
    ],
  );
  const diagnosticAboutPath = path.join(
    outputRoot,
    "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  );
  requireText(diagnosticAboutPath, [
    "data-testid='actestra-diagnostic-export-card'",
    "data-testid='actestra-diagnostic-export-consent'",
    "window.actestraDiagnostics",
    "bridge.exportReport()",
    "settings.diagnosticExportLocalOnly",
    "settings.diagnosticExportIncludes",
    "settings.diagnosticExportExcludes",
    "settings.diagnosticExportNoUpload",
    "FeedbackReportModal",
  ]);
  rejectText(diagnosticAboutPath, [
    "AIONUI_DIAGNOSTIC_EXPORT_CHANNEL",
    "ipcRenderer",
    "showSaveDialog",
    "DiagnosticExportService",
    "openSqliteCorePersistence",
    "node:sqlite",
    "DatabaseSync",
    "node:fs",
    "reportBytes",
    "reportContent",
  ]);
  for (const locale of ["en-US", "zh-CN"]) {
    requireText(
      path.join(
        outputRoot,
        `packages/desktop/src/renderer/services/i18n/locales/${locale}/settings.json`,
      ),
      [
        '"diagnosticExportLocalOnly"',
        '"diagnosticExportIncludes"',
        '"diagnosticExportExcludes"',
        '"diagnosticExportNoUpload"',
      ],
    );
  }
  requireText(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraTeamComposition.ts"),
    [
      "class ActestraTeamComposition",
      "new TeamJourneyWorkerRouter",
      "readonly #teamRuntimes = new Map",
      "workerRuntimeAdmission:",
      "new TeamOrchestratorService",
      "new TeamPlanAdmissionService",
      "new AionUiTeamService",
      "registerAionUiTeamBridgeIpc",
      "workspaceSelection: { select: () => this.#selectWorkspace() }",
      "dialog.showOpenDialog(window",
      "const rootPath = await realpath(selectedPath);",
      "rootPath === path.parse(rootPath).root",
      "await orchestrator.close()",
      "await runtime.close()",
      "await this.#planner?.close()",
      "Actestra Team composition shutdown failed",
      "ACTESTRA_AIONUI_TEAM_RECOVERY_READY",
      "recoverStandardAuthority",
      "window.webContents.once('did-finish-load'",
      "this.#recoverWorkerRuns()",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraTeamComposition.ts"),
    ["this.#service.close();", "await orchestrator.close();", "await this.#planner?.close();"],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "createGeneralWorkJourney(trustedRuntime.general)",
      "modelCatalog: teamWorkerRuntimeAdmission?.modelCatalog ?? null",
      "workerRuntimeAdmission:",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "await scheduleService.recover();",
      "await teamComposition.recoverStandardAuthority();",
      "registerRecoveredTeamBridge();",
      "[Actestra persistence] Utility ready schema=",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/renderer/components/chat/SendBox/index.tsx"),
    ["useActestraGeneralWork", "extractActestraGeneralWorkIntent", "effectiveLoading"],
  );
  requireText(path.join(outputRoot, "packages/desktop/src/renderer/components/layout/Router.tsx"), [
    "path='/scheduled'",
    "path='/scheduled/:job_id'",
    "ScheduledTasksPage",
    "TaskDetailPage",
  ]);
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts",
    ),
    [
      "isActestraScheduleProviderActive()",
      "void navigate('/scheduled'",
      "conversation_id: conversation.id",
      "conversation_title: conversationTitle",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx"),
    [
      "resolveScheduledConversationLocation",
      "scheduledConversation",
      "handleCreateDialogClose",
      "conversation_id={scheduledConversation?.conversation_id}",
      "conversation_title={scheduledConversation?.conversation_title}",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
    ),
    [
      "scheduleProviderActive = isActestraScheduleProviderActive()",
      "hasBoundScheduleConversation",
      "scheduleProviderActive || isTeamOwnedTask ? 'existing'",
      "scheduleProviderActive ? 0 : editJob!.state.max_retries",
      "scheduleProviderActive ? false : queueEnabled",
      "scheduleProviderActive || agent_config === undefined ? {} : { agent_config }",
      "actestraExistingConversationRequired",
      "{!scheduleProviderActive && (",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/renderer/hooks/chat/useActestraGeneralWork.ts"),
    ["journeyKind !== 'prompt-artifact'"],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiGeneralWorkJourneyService.ts",
    ),
    [
      '"actestra-input.txt"',
      '"actestra-research.txt"',
      '"workspace-file-artifact"',
      '"local-research-artifact"',
      '"writing-artifact"',
      '"office-document-artifact"',
      'kind: "document"',
      "invokeScopedToolStep",
      "activeToolInput",
      "MAX_GENERAL_WORKER_SEND_CONTENT_BYTES",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/compatibility/aionui/scheduleContract.ts"),
    [
      "AIONUI_SCHEDULE_MAX_JOBS = 100",
      'ACTESTRA_GENERAL_WORKER_AGENT_TYPE = "actestra-general-worker"',
      "AIONUI_SCHEDULE_JOB_ID_RE",
      "isAionUiScheduleJobId",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/compatibility/aionui/scheduledGeneralWork.ts",
    ),
    [
      "AIONUI_SCHEDULE_CONTRACT_VERSION = 1",
      "AIONUI_SCHEDULE_MAX_JOBS",
      "ACTESTRA_GENERAL_WORKER_AGENT_TYPE",
      'from "./scheduleContract"',
      "new Cron(value.expr",
      "deriveAionUiScheduleIdentity",
      "calculateAionUiScheduleNextRun",
      "activeClaim",
      "toNativeCronJob",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/compatibility/aionui/scheduleBridge.ts"),
    [
      'ACTESTRA_SCHEDULE_REQUEST_CHANNEL = "actestra:schedule-request-v1"',
      'ACTESTRA_SCHEDULE_EVENT_CHANNEL = "actestra:schedule-event-v1"',
      '"schedule-skill-unsupported": 501',
      'segments[0] !== "api"',
      'segments[1] !== "cron"',
      'segments[2] !== "jobs"',
      'type: "cron.job-created"',
      'type: "cron.job-updated"',
      'type: "cron.job-removed"',
      'type: "cron.job-executed"',
      "assertAionUiScheduleEvent",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiScheduleService.ts",
    ),
    [
      "class AionUiScheduleService",
      "claimAionUiScheduleRun",
      "completeAionUiScheduleRun",
      "recoverAionUiScheduleRuns",
      "submitFromTrustedContext",
      "async recover()",
      "async resume()",
      "async close(",
      "this.clearAllTimers()",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiScheduleBridgeService.ts",
    ),
    [
      "class AionUiScheduleBridgeService",
      'aionUiScheduleBridgeError("schedule-skill-unsupported")',
      "registerAionUiScheduleBridgeIpc",
      "event.sender === trusted.webContents",
      "event.senderFrame === trusted.mainFrame",
      "trusted.webContents.send(ACTESTRA_SCHEDULE_EVENT_CHANNEL, event)",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx",
    ),
    [
      "persist?: boolean",
      "actestraDocument?: OfficeDocumentModel",
      "tab.metadata?.persist !== false",
      "persistActiveTab",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraGeneralWorkSmoke.ts"),
    [
      "prepare-restart",
      "recover-restart",
      "denial",
      "cancellation",
      "local-research",
      "local-research-artifact",
      "Actestra local research brief",
      "prepare-writing-restart",
      "recover-writing-restart",
      "writing-artifact",
      "Actestra writing draft",
      "prepare-office-restart",
      "recover-office-restart",
      "office-document-artifact",
      "Actestra Office document",
      "prepare-tool-failure",
      "recover-tool-failure",
      "content-too-large",
      "prepare-worker-crash",
      "recover-worker-crash",
      "ACTESTRA_AIONUI_GENERAL_WORKER_ACTIVE",
      "worker-process-exit",
      "prepare-schedule-restart",
      "recover-schedule-restart",
      "Schedule smoke run-now",
      "Schedule smoke missed",
      "Schedule smoke interrupted",
      "schedule-smoke-interrupted-claim",
      "schedule-skill-unsupported",
      "service.preview(",
      "ACTESTRA_E2E_TEST",
    ],
  );
  requireText(path.join(outputRoot, "packages/desktop/src/process/utils/utils.ts"), [
    "shouldBypassActestraCliSafeSymlink",
    "environment.ACTESTRA_E2E_TEST === '1'",
    "environment.ACTESTRA_USER_DATA_DIR?.trim()",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/process/utils/configureConsoleLog.ts"), [
    "preserveActestraE2EConsoleEvidence",
    "process.env.ACTESTRA_E2E_TEST === '1'",
  ]);
  requireText(path.join(repositoryRoot, "scripts/smoke-aionui-general-work.mjs"), [
    "Contents",
    "Resources",
    "app.asar",
    "MacOS",
    "Actestra",
    "Packaged exact AionCore runtime",
    "[Actestra] Main window created",
    "[AionUi] Renderer did-finish-load",
    '"actestra-input.txt"',
    "workspace-file-artifact",
    '"actestra-research.txt"',
    '"research.md"',
    "local-research-artifact",
    '"draft.md"',
    "writing-artifact",
    '"brief.docx"',
    "office-document-artifact",
    '"prepare-tool-failure"',
    '"recover-tool-failure"',
    '"content-too-large"',
    '"tool.failed"',
    '"task.failed"',
    "mayHaveExecuted",
    "privileged_audit_records",
    "toolFailurePrivateMarker",
    '"prepare-worker-crash"',
    '"recover-worker-crash"',
    '"ACTESTRA_UTILITY_ROLE=general-worker"',
    '"--utility-sub-type=node.mojom.NodeService"',
    '"startup: managed runtime background preparation completed"',
    "targetAppIsReady(output)",
    'process.kill(workerPid, "SIGKILL")',
    '"worker-process-exit"',
    "agent_attempt_evidence",
    '"task.updated", "worker.failed", "task.failed"',
    '"prepare-schedule-restart"',
    '"recover-schedule-restart"',
    "aionui_schedule_jobs",
    "Schedule smoke run-now",
    "next_run_at_ms",
    "active_claim",
    "last_incident_code",
    "missed-occurrence",
    "schedule-smoke-interrupted-claim",
    "schedule-skill-unsupported",
    "expectedPersistenceSchemaVersion = 23",
  ]);
  rejectText(path.join(repositoryRoot, "scripts/smoke-aionui-general-work.mjs"), [
    "Electron.app",
    "[applicationPath]",
    'spawnSync("which", ["aioncore"]',
  ]);
  requireText(path.join(outputRoot, "packages/desktop/electron.vite.config.ts"), [
    "'actestra-persistence-utility'",
    "persistenceUtilityEntry.ts",
    "'actestra-general-worker'",
    "generalWorkerEntry.ts",
    "'actestra-team-planner'",
    "actestraNativeTeamPlannerEntry.ts",
    "createRequire(import.meta.url)",
    "actestraNativeTeamPlannerManifest.cjs",
    "configResolved(config: { readonly root: string })",
    "projectRoot = config.root",
    "writeActestraTeamPlannerManifest(projectRoot ?? process.cwd())",
    "entryFileNames: '[name].js'",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "await initializeProcess();",
    "startTrustedActestraCodingJourneyRuntime",
    "resolveTrustedActestraCodingRunnerAdmission",
    "configureActestraTeamWorkerRuntimeAdmission({",
    "projectAionCoreTeamModelCatalog",
    "await initializeActestraPersistenceUtility(app.getPath('userData'));",
    "registerActestraScheduleResumeBridge();",
    "resumeActestraSchedule()",
    "runGeneralWorkerProbe",
    "actestra-general-worker.js",
    "ACTESTRA_GENERAL_WORKER_READY",
    "process.env.ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO !==",
    "'recover-worker-crash'",
    "registerActestraShadowBridge(mainWindow);",
  ]);
  rejectText(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "/api/cron/internal/system-resume",
    "admitLocalClaudeProductRuntime",
    "configureActestraTeamRuntime({ planner:",
    "configureActestraCodingJourneyRuntime({",
    "selection: null",
  ]);
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "isolatedCodingMainService = createIsolatedCodingMainService({",
      "configurePersistenceServices(utility, userDataPath);",
      "new GeneralWorkCoordinator({",
      "}).recover();",
      "ACTESTRA_GENERAL_WORK_RECOVERY_READY",
      "await scheduleService.recover();",
      "scheduleRecovered = true;",
      "registerRecoveredScheduleBridge();",
      "ACTESTRA_AIONUI_SCHEDULE_RECOVERY_READY",
      "[Actestra persistence] Utility ready schema=",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "disposeScheduleBridge?.();",
      "await activeTeam?.close();",
      "let codingJourneyCloseError: unknown;",
      "await activeCodingJourney?.close();",
      "codingJourneyService = null;",
      "let codingArtifactCloseError: unknown;",
      "await activeCodingArtifact?.close();",
      "codingArtifactCloseError = error;",
      "let isolatedCodingCloseFailed = false;",
      "await activeIsolatedCoding?.close();",
      "isolatedCodingMainService = null;",
      "isolatedCodingCloseFailed = true;",
      "await activeSchedule?.close()",
      "await activeGeneralWork?.close()",
      "teamCloseError !== undefined ||",
      "codingJourneyCloseError !== undefined ||",
      "codingArtifactCloseError !== undefined ||",
      "isolatedCodingCloseFailed",
      "Actestra coding journey shutdown failed",
      "persistence = null;",
      "await activePersistence.close();",
    ],
  );
  requireOrderedFragments(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "await initializeProcess();",
    "rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;",
    "configureActestraTeamWorkerRuntimeAdmission({",
    "await initializeActestraPersistenceUtility(app.getPath('userData'));",
    "createWindow({ showOnReady: showMainWindowOnReady });",
  ]);
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/common/config/actestraApprovalAuthorityContract.ts",
    ),
    ["actestra:approval-decide-v1", "native-fallback"],
  );
  requireText(path.join(outputRoot, "packages/desktop/src/common/adapter/httpBridge.ts"), [
    "routeActestraApprovalRequest",
    "BackendHttpError",
  ]);
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiApprovalPolicyGate.ts",
    ),
    [
      "PolicyGatedAionUiApprovalNativeTransport",
      "network.request",
      "external-service",
      "PrivilegedToolGateway",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiApprovalReconciliationPolicyGate.ts",
    ),
    [
      "PolicyGatedAionUiApprovalReconciliationTransport",
      "aionui-approval-reconciliation-read-v1",
      "aionui-approval-reconciliation-request",
      "aionui-approval-reconciliation-${conversationHash}-${callHash}",
      "network.request",
      "PrivilegedToolGateway",
    ],
  );
  requireOrderedFragments(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiApprovalReconciliationPolicyGate.ts",
    ),
    [
      'if (record.deliveryState !== "pending-delivery" || record.attemptCount < 1)',
      "inputRef: toolInputReference(",
      "const pending = await this.transport.isPending(active.record, active.signal);",
      'if (typeof pending !== "boolean")',
      "active.pending = pending;",
      "active.completed = true;",
      "const inputRef = operation.inputRef;",
      "this.activeReads.set(inputRef, active);",
      "const result = await this.gateway.invoke(operation);",
      'if (result.status !== "executed")',
      'if (!active.completed || typeof active.pending !== "boolean")',
      "return active.pending;",
      "const existing = this.inFlightReads.get(inputRef);",
      "if (existing !== undefined)",
      "return existing;",
      "this.inFlightReads.set(inputRef, inFlight);",
      "this.inFlightReads.delete(inputRef);",
      "return this.config.transport.deliver(record, signal);",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "const nativeApprovalTransport =",
      "const deliveryGatedApprovalTransport = approvalPolicyGateEnabled",
      "createPolicyGatedAionUiApprovalNativeTransport({",
      "const approvalTransport =",
      "approvalPolicyGateEnabled && approvalReconciliationGateEnabled",
      "createPolicyGatedAionUiApprovalReconciliationTransport({",
      ": deliveryGatedApprovalTransport;",
      "new AionUiApprovalAuthorityService(",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "tests/unit/actestra/approvalReconciliationPolicyGate.test.ts"),
    [
      "service.resolve({",
      "disposition: 'reconciled'",
      "expect(isPending).toHaveBeenCalledTimes(1);",
      "expect(deliver).not.toHaveBeenCalled();",
      "persistence.summarizePrivilegedAudit()",
      "recordCount: 3",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/process/services/actestraApprovalNativeTransport.ts",
    ),
    ["127.0.0.1", "AbortSignal.timeout", "MAX_NATIVE_RESPONSE_BYTES"],
  );
  requireText(path.join(outputRoot, "packages/desktop/src/process/pet/petConfirmManager.ts"), [
    "resolveActestraApprovalDecisionFromMain",
    "native fallback failed",
  ]);
  requireText(path.join(outputRoot, "resources/windows/installer-process-control.nsh"), [
    "Actestra\\profiles\\v1\\default",
    "installer-last-failure.json",
  ]);
  requireText(path.join(outputRoot, "scripts/afterSign.js"), [
    "execFileSync('xattr', ['-cr', appPath]",
    "['--force', '--deep', '--sign', '-', appPath]",
    "throw adHocError",
  ]);
  requireOrderedText(
    path.join(outputRoot, "packages/desktop/src/process/utils/configureChromium.ts"),
    "function shouldEnableCdp",
    "packaged: app.isPackaged",
    "environment: process.env",
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/utility/persistence/sqliteMigrations.ts"),
    [
      "CURRENT_CORE_SCHEMA_VERSION = 23",
      "privileged-audit-integrity-and-retention",
      "privileged_audit_integrity",
      "privileged_audit_retention_state",
      "artifact-delivery-split-authority",
      "artifact-delivery-patch-owner-identity",
      "patch_owner_grant_id",
      "patch_owner_worker_id",
      "patch_request_id",
      "destination_grant_id",
      "verified_head",
      "aionui_shadow_evidence",
      "aionui_approval_decisions",
      "pending-delivery",
      "workspace_grants",
      "content_references",
      "general_work_checkpoints",
      "journey_kind",
      "local-research-artifact",
      "writing-artifact",
      "office-document-artifact",
      "aionui-general-work-requirements",
      "requirements_json",
      "aionui-scheduled-general-work",
      "aionui_schedule_jobs",
      "team-plan-authority",
      "team_experience_bindings",
      "standard-team-message-delivery-authority",
      "standard_team_message_deliveries",
      "team_plans",
      "team_definitions",
      "team_runs",
      "team_run_revisions",
    ],
  );
  rejectText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/persistence/persistenceUtilityClient.ts",
    ),
    ["node:sqlite", "DatabaseSync", "openSqliteCorePersistence"],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/utility/persistence/sqliteCorePersistence.ts",
    ),
    [
      "node:sqlite",
      "DatabaseSync",
      "persistWorkspaceGrant",
      "storeContentReference",
      "persistGeneralWorkCheckpoint",
      "listRecoverableGeneralWorkCheckpoints",
      "registerAionUiSchedule",
      "listAionUiSchedules",
      "claimAionUiScheduleRun",
      "completeAionUiScheduleRun",
      "recoverAionUiScheduleRuns",
      "persistTeamDefinition",
      "persistTeamRunSnapshot",
      "listRecoverableTeamRuns",
      "PRIVILEGED_AUDIT_CHAIN_DOMAIN",
      "maintainPrivilegedAudit",
      "listRecentPrivilegedAudit",
      "readPrivilegedAuditRetentionState",
    ],
  );
  requireText(path.join(outputRoot, "packages/desktop/src/actestra/core/generalWorkRecovery.ts"), [
    "GENERAL_WORK_RECOVERY_CONTRACT_VERSION = 1",
    "MAX_RECOVERABLE_GENERAL_WORK_CHECKPOINTS",
    '"terminal-pending"',
    "mayHaveExecuted",
    "assertGeneralWorkCheckpointTransition",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/actestra/core/agentAdapter.ts"), [
    "AGENT_ADAPTER_PROTOCOL_VERSION = 2",
    '"tool-results"',
    "AgentToolResult",
    "resolveTool",
    '"protocol-error"',
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/actestra/core/scopedNativeTools.ts"), [
    "WORKSPACE_READ_TEXT_TOOL_ID",
    "TASK_OUTPUT_WRITE_TEXT_TOOL_ID",
    "TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID",
    "actestra.workspace.read-text",
    "actestra.task-output.write-text",
    "actestra.task-output.write-office-document",
    "assertPortableRelativePath",
    "SCOPED_NATIVE_TOOL_IDS",
  ]);
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/privileged/scopedNativeTextToolExecutor.ts",
    ),
    [
      "implements ProtectedToolExecutor",
      "workspace-grant-invalid",
      "symlink-denied",
      "output-conflict",
      "fsConstants.O_EXCL",
      'OUTPUT_ROOT_SEGMENTS = [".actestra", "task-output"]',
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/privileged/scopedNativeToolPlatform.ts",
    ),
    [
      "policy-p4-scoped-native-tools-v2",
      "rule-gw-p4-4-workspace-read-text",
      "rule-gw-p4-4-task-output-write-text",
      "rule-p4-office-document-output",
      'credentialUse: "none"',
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/workers/scopedNativeToolCoordinator.ts",
    ),
    [
      "activeToolRequest",
      "scopedNativeToolDefinition",
      "retainedResults",
      "this.gateway.invoke",
      "this.beforeResolve",
      "this.supervisor.resolveTool",
      "hasRetainedResult",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/shared/generalWorkerProtocol.ts"),
    [
      "GENERAL_WORKER_PROTOCOL_VERSION = 2",
      'GENERAL_WORKER_IMPLEMENTATION_VERSION = "0.2.0"',
      "MAX_GENERAL_WORKER_MESSAGE_BYTES",
      "MAX_GENERAL_WORKER_PROMPT_BYTES",
      '"tool-result-accepted"',
      '"model-requests"',
      '"model-requested"',
      '"resolve-model"',
      "assertGeneralWorkerMessage",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/main/workers/generalWorkCoordinator.ts"),
    [
      "persistGeneralWorkCheckpoint",
      "listRecoverableGeneralWorkCheckpoints",
      "appendAuthoritativeArtifactEvent",
      "resumePersistedToolResolution",
      "hasRetainedResult",
      "releaseRetainedResult",
      "application-restart",
      "terminal-pending",
      "createAgentAttemptEvidence",
      "reconcileDomainGraph",
    ],
  );
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/actestra/main/workers/generalWorkCoordinator.ts"),
    [
      "await this.config.persistence.resolveContentReference({",
      "await this.reconcileDomainGraph(checkpoint);",
      "await this.config.persistence.appendEvent(event)",
      "await this.config.persistence.appendAgentAttemptEvidence(evidence)",
      'phase: "finalized"',
      "await supervisor?.dispose(checkpoint.attempt.sessionId);",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/workers/generalWorkerProcessAdapter.ts",
    ),
    [
      "implements AgentAdapter",
      "GENERAL_WORKER_ADAPTER_KIND",
      "newToolRequestId",
      '"signal-identity-mismatch"',
      '"signal-sequence-gap"',
      '"tool.started"',
      '"worker.failed"',
      "listenersCleaned",
    ],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/main/workers/electronGeneralWorker.ts"),
    [
      'ACTESTRA_UTILITY_ROLE: "general-worker"',
      "utilityProcess.fork",
      "subscribeDeferredUtilityProcessTerminalEvent",
      'this.child.once("error", handleError)',
      'this.child.once("exit", handleExit)',
      "allowLoadingUnsignedLibraries: false",
      "respondToAuthRequestsFromMainProcess: false",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/workers/utilityProcessTerminalDispatch.ts",
    ),
    ["setImmediate", "clearImmediate", "triggered", "listener(...arguments_)"],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/utility/worker/generalWorkerService.ts"),
    [
      "private attemptStarted = false",
      "accepts exactly one immutable attempt",
      '"no-tool-complete"',
      '"tool-fixture"',
      '"workspace-read-text-fixture"',
      '"workspace-read-then-task-output-write-fixture"',
      '"local-research-artifact-fixture"',
      '"writing-artifact-fixture"',
      '"draft.md"',
      '"office-document-artifact-fixture"',
      "OFFICE_DOCUMENT_OUTPUT_RELATIVE_PATH",
      "TASK_OUTPUT_WRITE_OFFICE_DOCUMENT_TOOL_ID",
      '"task-output-write-text-fixture"',
      '"cancelled"',
    ],
  );
  const workerGraph = inspectGeneralWorkerModuleGraph({
    rootPath: path.join(outputRoot, "packages/desktop/src"),
    entryPaths: [
      path.join(outputRoot, "packages/desktop/src/actestra/utility/worker/generalWorkerEntry.ts"),
    ],
    isAllowedLocalModule: (relativePath) =>
      relativePath.startsWith("actestra/utility/worker/") ||
      relativePath === "actestra/shared/generalWorkerProtocol.ts" ||
      relativePath.startsWith("actestra/core/"),
  });
  if (workerGraph.findings.length > 0) {
    throw new Error(
      `Actestra downstream General Worker authority graph is invalid: ${workerGraph.findings.join(
        "; ",
      )}`,
    );
  }
  const mainModelJsonPath = path.join(
    outputRoot,
    "packages/desktop/src/actestra/main/model/actestraMainModelJson.ts",
  );
  const mainModelBrokerPath = path.join(
    outputRoot,
    "packages/desktop/src/actestra/main/model/actestraMainModelBroker.ts",
  );
  const generalWorkRuntimePath = path.join(
    outputRoot,
    "packages/desktop/src/actestra/main/workers/actestraGeneralWorkRuntime.ts",
  );
  requireText(mainModelBrokerPath, [
    "export interface ActestraMainModelInvocation",
    'readonly purpose: "general-work" | "coding";',
    "export interface ActestraMainModelBrokerPort",
    "readonly invokeModel: ActestraMainModelInvoker;",
  ]);
  requireText(generalWorkRuntimePath, [
    'from "../model/actestraMainModelBroker";',
    'purpose: "general-work"',
    "tools: Object.freeze([])",
  ]);
  for (const providerNeutralPath of [
    mainModelJsonPath,
    mainModelBrokerPath,
    generalWorkRuntimePath,
  ]) {
    rejectText(providerNeutralPath, [
      "credential",
      "Credential",
      "authorization",
      "Authorization",
      "headers",
      "Headers",
      "baseUrl",
      "baseURL",
      "base_url",
      "BASE_URL",
      "Provider",
      "provider",
      "Goose",
      "goose",
      "GOOSE",
      " DTO",
      "Dto",
      "http://",
      "https://",
      'from "node:http"',
      'from "node:https"',
      'from "node:net"',
      'from "node:tls"',
      "fetch(",
      "WebSocket",
      "EventSource",
      "XMLHttpRequest",
    ]);
  }
  const mainModelBrokerImports = extractStaticModuleSpecifiers(
    fs.readFileSync(mainModelBrokerPath, "utf8"),
  );
  const mainModelJsonImports = extractStaticModuleSpecifiers(
    fs.readFileSync(mainModelJsonPath, "utf8"),
  );
  if (mainModelJsonImports.length !== 1 || mainModelJsonImports[0] !== "node:buffer") {
    throw new Error(
      `Actestra Main model JSON boundary has an undeclared dependency: ${mainModelJsonImports.join(", ")}`,
    );
  }
  if (
    mainModelBrokerImports.length !== 1 ||
    mainModelBrokerImports[0] !== "./actestraMainModelJson"
  ) {
    throw new Error(
      `Actestra Main model broker has a non-neutral dependency: ${mainModelBrokerImports.join(", ")}`,
    );
  }
  const generalWorkRuntimeImports = extractStaticModuleSpecifiers(
    fs.readFileSync(generalWorkRuntimePath, "utf8"),
  );
  // The broker is the runtime's only authority-bearing dependency. The draft contract is a pure
  // core module holding the shared prompt and envelope rules, so the prompt has one definition
  // instead of a copy that can drift from the validator that enforces it.
  const generalWorkRuntimeAllowedImports = new Set([
    "../model/actestraMainModelBroker",
    "../../core/generalDraftContract",
  ]);
  const generalWorkRuntimeUnexpected = generalWorkRuntimeImports.filter(
    (specifier) => !generalWorkRuntimeAllowedImports.has(specifier),
  );
  if (generalWorkRuntimeUnexpected.length > 0) {
    throw new Error(
      `Actestra General runtime depends outside the Main model broker: ${generalWorkRuntimeUnexpected.join(", ")}`,
    );
  }
  requireText(path.join(outputRoot, "tests/unit/actestra/generalWorkerProcessAdapter.test.ts"), [
    "General Worker process adapter",
    "protocolVersion: 2",
    "'task.started', 'agent.message', 'task.completed'",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/scopedNativeTools.test.ts"), [
    "registers only the three accepted scoped capabilities",
    "fails closed for traversal and unknown fields",
    "actestra.shell.execute",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/generalWorkRecovery.test.ts"), [
    "native general-work recovery contract",
    "active to terminal-pending",
    "application-restart",
    "assertGeneralWorkCheckpointTransition",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/persistenceUtilityClient.test.ts"), [
    "schema v14 utility IPC",
    "expect(client.schemaVersion).toBe(CURRENT_CORE_SCHEMA_VERSION)",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/generalWorkSmoke.test.ts"), [
    "prepare-writing-restart",
    "recover-writing-restart",
    "Actestra writing draft",
    "prepare-office-restart",
    "recover-office-restart",
    "Actestra Office document",
    "prepare-tool-failure",
    "recover-tool-failure",
    "content-too-large",
    "prepare-worker-crash",
    "recover-worker-crash",
    "ACTESTRA_AIONUI_GENERAL_WORKER_ACTIVE",
    "worker-process-exit",
    "kind: 'document'",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/scheduleSmoke.test.ts"), [
    "Actestra target-app schedule smoke contract",
    "prepare-schedule-restart",
    "recover-schedule-restart",
    "Schedule smoke run-now",
    "missed-occurrence",
    "interrupted",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/isolatedCodingMainComposition.test.ts"), [
    "Actestra native isolated-coding main composition",
    "createIsolatedCodingMainService",
    "denies opening after close",
    "code: 'closed'",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/codingAgentNativeWiring.test.ts"), [
    "Actestra retained AionUI coding-agent wiring",
    "AionUiCodingAgentService",
    "actestraCodingAgent",
    "ActestraCodingAgentRepairPanel",
  ]);
  const codingJourneyRuntimePath = path.join(
    outputRoot,
    "packages/desktop/src/actestra/main/workers/actestraCodingJourneyRuntime.ts",
  );
  requireText(codingJourneyRuntimePath, [
    "resolveTrustedActestraCodingRunnerAdmission",
    "startTrustedActestraCodingJourneyRuntime",
    "admitGooseRunnerArtifact",
    "admitInstalledGooseRunnerLinuxPackage",
    "linuxPackageResourcesPath",
    "goose-private",
    '"git.status"',
    '"git.diff-check"',
    "modelBinding",
    'from "../model/actestraMainModelBroker";',
  ]);
  rejectText(codingJourneyRuntimePath, ["actestraGeneralWorkRuntime"]);
  const allowedCodingJourneyRuntimeImports = [
    "node:fs",
    "node:fs/promises",
    "node:path",
    "../model/actestraMainModelBroker",
    "../compatibility/aionuiCodingAgentService",
    "../privileged/isolatedCodingToolPlatform",
    "./gooseRunnerArtifact",
    "./gooseRunnerLinuxPackage",
  ];
  const codingJourneyRuntimeImports = extractStaticModuleSpecifiers(
    fs.readFileSync(codingJourneyRuntimePath, "utf8"),
  );
  if (
    codingJourneyRuntimeImports.length !== allowedCodingJourneyRuntimeImports.length ||
    codingJourneyRuntimeImports.some(
      (specifier, index) => specifier !== allowedCodingJourneyRuntimeImports[index],
    )
  ) {
    throw new Error(
      `Actestra coding runtime import closure is invalid: ${codingJourneyRuntimeImports.join(", ")}`,
    );
  }
  const linuxPackageAdmissionPath = path.join(
    outputRoot,
    "packages/desktop/src/actestra/main/workers/gooseRunnerLinuxPackage.ts",
  );
  requireText(linuxPackageAdmissionPath, [
    "GOOSE_LINUX_BOOTSTRAP_OK_MARKER",
    "admitInstalledGooseRunnerLinuxPackage",
    "parseGooseRunnerLinuxPackageAdmission",
    "GOOSE_LINUX_RESOURCES_PATH",
    "runBootstrapCheck",
  ]);
  rejectText(linuxPackageAdmissionPath, [
    "sudo",
    "setuid",
    "sysctl -w",
    "ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY",
    "process.env",
    "Renderer",
  ]);
  const allowedLinuxPackageAdmissionImports = [
    "node:child_process",
    "node:crypto",
    "node:fs/promises",
    "node:path",
    "../../shared/gooseRunnerLinuxPackage",
    "./gooseRunnerArtifact",
  ];
  const linuxPackageAdmissionImports = extractStaticModuleSpecifiers(
    fs.readFileSync(linuxPackageAdmissionPath, "utf8"),
  );
  if (
    linuxPackageAdmissionImports.length !== allowedLinuxPackageAdmissionImports.length ||
    linuxPackageAdmissionImports.some(
      (specifier, index) => specifier !== allowedLinuxPackageAdmissionImports[index],
    )
  ) {
    throw new Error(
      `Ubuntu Goose package admission import closure is invalid: ${linuxPackageAdmissionImports.join(", ")}`,
    );
  }
  requireText(path.join(outputRoot, "tests/unit/actestra/codingAgentClient.dom.test.ts"), [
    "Actestra coding-agent renderer client",
    "mergeActestraCodingAgent",
    "probeActestraCodingManagedAgent",
    "actestra-goose",
  ]);
  requireText(
    path.join(outputRoot, "packages/desktop/src/actestra/compatibility/aionui/codingJourney.ts"),
    [
      "AIONUI_CODING_JOURNEY_CONTRACT_VERSION = 1",
      "ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_LIST_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL",
      "ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyService.ts",
    ),
    [
      "deriveAionUiCodingJourneyIdentities",
      "awaitToolApprovalDecision",
      "awaitPublishDecision",
      'approvalActorId("actestra-aionui-coding-user")',
      "return this.project(identities)",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/actestra/main/compatibility/aionuiCodingJourneyBridgeService.ts",
    ),
    [
      "AionUiCodingJourneyBridgeService",
      "assertAionUiCodingJourneySubmitRequest",
      "assertAionUiCodingJourneyBridgeResult",
      "execution-failed",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
    ),
    [
      "useActestraCodingJourney",
      "actestraCodingJourneySelector",
      "data-testid='actestra-coding-agent-selector'",
      "Goose coding accepts text only",
      "ipcBridge.acpConversation.sendMessage.invoke",
      "ipcBridge.conversation.stop.invoke",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx",
    ),
    [
      "readActestraCodingPermissionMetadata",
      "decideActestraCodingJourneyApproval",
      "decideActestraCodingJourneyPublish",
      "conversation.confirmMessage.invoke",
    ],
  );
  requireText(path.join(outputRoot, "tests/unit/actestra/codingJourneyClient.dom.test.ts"), [
    "Actestra coding-journey renderer client",
    "five fixed preload operations",
    "agent-unavailable",
    "execution-failed",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/codingJourneyHook.dom.test.tsx"), [
    "Actestra retained AionUI coding-journey hook",
    "projectActestraCodingJourneyMessages",
    "submission-aionui-coding-",
    "retained AionUI ACP SendBox",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/codingJourneyNativeWiring.test.ts"), [
    "Actestra retained AionUI coding-journey wiring",
    "main-frame-only",
    "non-Team selector",
    "MessageAcpToolCall",
    "MessageAcpPermission",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/common/adapter/actestraTeamClient.ts"), [
    "isActestraTeamProviderActive",
    "window.actestraTeam!.request",
    "listActestraTeams",
    "getActestraTeam",
    "createStandardTeam",
    "addStandardTeamMember",
    "getStandardTeamConfigOptions",
    "isActestraTeamUnavailableError",
    "selectActestraTeamWorkspace",
    "listActestraTeamModelOptions",
    "createActestraTeam",
    "description: input.description?.trim() || null",
    "subscribeActestraTeamEvents",
    "getActestraTeamRunState",
    "submitActestraTeamTask",
    "controlActestraTeamNode",
    "decideActestraTeamApproval",
    "resolveActestraTeamFeedback",
    "cancelActestraTeamRun",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/renderer/pages/team/TeamPage.tsx"), [
    "resolveTeamExperience(team) === 'orchestrated'",
    "resolveTeamExperience(team) === 'standard'",
    "ActestraTeamWorkspace",
    "NativeTeamPage",
    "team-experience-unavailable",
  ]);
  rejectText(path.join(outputRoot, "packages/desktop/src/renderer/pages/team/TeamPage.tsx"), [
    "isActestraTeamProviderActive()",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/renderer/pages/team/index.tsx"), [
    "return getActestraTeam(id!)",
    "team-provider-unavailable",
    "team.experience.providerUnavailable",
  ]);
  rejectText(path.join(outputRoot, "packages/desktop/src/renderer/pages/team/index.tsx"), [
    "listActestraTeams",
    "mergeTeamLists",
  ]);
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx",
    ),
    ["TeamAssistantPicker", "WorkspaceFolderSelect", "createStandardTeam"],
  );
  rejectText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx",
    ),
    ["isActestraTeamProviderActive()", "ActestraTeamCreateModal", "NativeTeamCreateModal"],
  );
  requireText(
    path.join(outputRoot, "packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts"),
    ["isActestraTeamProviderActive()", "listActestraTeams", "teamProviderUnavailable"],
  );
  rejectText(
    path.join(outputRoot, "packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts"),
    ["mergeTeamLists"],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/components/layout/Sider/TeamSiderSection.tsx",
    ),
    [
      "TeamCreateExperienceChooser",
      "setCreateChooserVisible(true)",
      "<TeamCreateModal",
      "<ActestraTeamCreateModal",
      "actestra-team-provider-unavailable",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/team/components/TeamCreateExperienceChooser.tsx",
    ),
    [
      "team-create-kind-standard",
      "team-create-kind-orchestrated",
      "role='menuitem'",
      "team.experience.standardTitle",
      "team.experience.orchestratedTitle",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx",
    ),
    [
      "data-testid='actestra-team-create-modal'",
      "data-testid='actestra-team-description-input'",
      "data-testid='actestra-team-workspace-select'",
      "data-testid='actestra-team-workspace-grant'",
      "data-testid='actestra-team-provider-select'",
      "data-testid='actestra-team-model-select'",
      "data-testid='actestra-team-member-row'",
      "data-testid='actestra-team-member-add'",
      "members.length >= 2",
      "members.length <= 5",
      "member.capability === 'general' ? 'actestra-general-worker' : 'actestra-goose-worker'",
      "workspace_mode: 'isolated'",
      "selectActestraTeamWorkspace",
      "listActestraTeamModelOptions",
    ],
  );
  rejectText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx",
    ),
    [
      "data-testid='actestra-team-workspace-input'",
      "defaultValue:",
      "useModelProviderList",
      "api_key",
      "base_url",
    ],
  );
  const teamWorkspacePath = path.join(
    outputRoot,
    "packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx",
  );
  requireText(teamWorkspacePath, [
    "data-testid='actestra-team-workspace'",
    "data-testid='actestra-team-current-executor'",
    "data-testid='actestra-team-run-status'",
    "data-testid='actestra-team-member-status'",
    "data-testid='actestra-team-node-status'",
    "data-testid='actestra-team-node-capability'",
    "data-testid='actestra-team-blocked-reason'",
    "data-testid='actestra-team-result'",
    "data-testid='actestra-team-run-submit'",
    "data-testid='actestra-team-submission-unavailable'",
    "data-testid='actestra-team-action-error'",
    "setActionFailureKey('controlFailed')",
    "setActionFailureKey('feedbackFailed')",
    "setActionFailureKey('cancelFailed')",
    "setActionFailureKey('renameFailed')",
    "team.actestra.authoritySourceDescription",
    "team.actestra.groupChat",
    "team.actestra.blocked.protectedApproval",
    "team.actestra.blocked.unknown",
    "t('team.actestra.runStatus.' + run.actestra.core_status)",
    "t('team.actestra.assistantStatus.' + assistant.status)",
    "t('team.actestra.nodeState.' + node.state)",
    "t('team.actestra.capability.' + node.capability)",
    "blockedExplanation(node, t)",
    "data?.activities",
    "team.actestra.planEmpty",
    "pause",
    "resume",
    "cancel",
    "retry",
    "replace",
    "handoff",
    "approve",
    "deny",
  ]);
  rejectText(teamWorkspacePath, [
    "auditRecordId",
    "workerId",
    "repositoryRoot",
    "sidecarTraceback",
    "Message.error(controlError",
    "Message.error(feedbackError",
    "Message.error(cancelError",
    "Message.error(renameError",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/teamNativeWiring.test.ts"), [
    "Actestra AionUI-native Team wiring",
    "keeps native Team HTTP and events reachable",
    "keeps Team authority, recovery, IPC, and close ordering",
    "keeps Workspace selection in the registered main window and projects no path",
    "keeps both Team creation directions reachable",
    "ships English and Chinese Team experience copy",
  ]);
  requireText(
    path.join(outputRoot, "tests/unit/renderer/team/TeamCreateExperienceChooser.dom.test.tsx"),
    [
      "routes standard to the preserved native modal",
      "routes the explicit orchestrated choice",
      "returns focus to the Team plus",
    ],
  );
  requireText(
    path.join(outputRoot, "tests/unit/renderer/team/TeamExperienceRouting.dom.test.tsx"),
    [
      "opens a standard Team from the single Main/Core projection while the provider is active",
      "opens an orchestrated Team from its Main/Core projection",
      "uses the preserved native provider only when the Actestra provider is absent",
      "fails closed when the Main/Core projection fails",
      "explains an Actestra provider failure",
    ],
  );
  requireText(
    path.join(outputRoot, "tests/unit/renderer/team/TeamPageCronJobManager.dom.test.tsx"),
    [
      "keeps native Team chat and switches to Actestra plan controls",
      "team-tabs-slot",
      "team-chat-view-member-conv",
      "actestra-team-plan-control",
    ],
  );
  requireText(path.join(outputRoot, "tests/e2e/helpers/teamHelpers.ts"), [
    "chooseTeamExperience",
    "team-create-kind-${experience}",
    "await chooseTeamExperience(page, 'standard')",
    "modal.locator('[data-testid=\"team-create-name-input\"]')",
    'team-create-add-member-btn"]:visible',
    "const options = page.locator('[data-testid^=\"team-create-agent-option-\"]')",
  ]);
  for (const relativePath of [
    "tests/e2e/cases/teams/team-create.e2e.ts",
    "tests/e2e/cases/teams/team-create-mobile.e2e.ts",
    "tests/e2e/cases/teams/team-create-ui.e2e.ts",
    "tests/e2e/cases/teams/team-ui-details.e2e.ts",
    "tests/e2e/cases/teams/team-whitelist.e2e.ts",
  ]) {
    requireText(path.join(outputRoot, relativePath), ["chooseTeamExperience(page, 'standard')"]);
  }
  requireText(path.join(outputRoot, "tests/e2e/cases/teams/team-experience-choice.e2e.ts"), [
    "team-create-kind-standard",
    "team-create-kind-orchestrated",
    "team-create-layout",
    "actestra-team-create-modal",
    "keeps the Main/Core standard provider readable",
    "createTeam(page, teamName, 'claude')",
    "/api/teams?user_id=actestra-local-user",
    "team-provider-unavailable",
    "team-tab-bar",
  ]);
  requireText(path.join(outputRoot, "tests/e2e/cases/teams/team-member-messaging.e2e.ts"), [
    "page.route('**/api/teams/*/session'",
    "team-warmup-retry",
    "invokeBridge<TeamProjection>(page, 'team.get'",
    "team-tab-${addedMember.slot_id}",
    "cleanupTeamsByName",
  ]);
  const teamMemberOpsPath = path.join(outputRoot, "tests/e2e/cases/teams/team-member-ops.e2e.ts");
  requireText(teamMemberOpsPath, [
    "window.actestraTeam?.request",
    "experience: 'standard'",
    "Main/Core did not return a standard Team member slot",
    "team-tab-remove-${addResult.slot_id}",
  ]);
  rejectText(teamMemberOpsPath, ["invokeBridge<{ slot_id: string } | null>"]);
  requireText(path.join(outputRoot, "tests/e2e/cases/teams/team-orchestrated-create.e2e.ts"), [
    "actestra-team-workspace-grant",
    "experience: 'orchestrated'",
    "not.toContain(workspaceRoot)",
    "restartElectronApp",
    "planner|规划器|不可用",
  ]);
  requireText(path.join(outputRoot, "tests/e2e/fixtures.ts"), [
    "AIONUI_E2E_USER_DATA_DIR: e2eUserDataDir",
    "ACTESTRA_E2E_TEST: '1'",
    "ACTESTRA_USER_DATA_DIR: e2eUserDataDir",
    "restartElectronApp",
    "previousApp.close()",
    "app = await launchApp()",
  ]);
  requireText(
    path.join(outputRoot, "tests/unit/renderer/team/ActestraTeamCreateModal.dom.test.tsx"),
    [
      "supporting two to five explicit members",
      "requests Main-owned workspace selection without renderer path input",
      "submits description, approved workspace reference, finite model IDs, and member intent",
      "not.toContain('team-member-')",
    ],
  );
  requireText(
    path.join(outputRoot, "tests/unit/renderer/team/ActestraTeamWorkspace.dom.test.tsx"),
    [
      "Actestra Team workspace",
      "shows authority, executor, dependency, blocked reason, actions, and Artifact references",
      "localizes run, member, node, and capability tokens from the Main projection",
      "routes approval through the fixed Actestra Team control client",
      "restores durable user and Worker activity",
      "projects planner unavailability before effect and blocks an impossible task intent",
    ],
  );

  console.log(
    `Verified Actestra P6 AionUI-native Team-work downstream overlay: ${changedFiles.size} declared files, ` +
      `${overlay.invariantFiles.length} R0 invariant files, ${overlay.sourceCopies.length} ` +
      "reviewed source copies, preserved AionUI surfaces, utility-owned persistence, shadow and " +
      "approval authority, workspace grants, bounded content references, AgentAdapter v2, and " +
      "the supervised General Worker, scoped native text tools, deterministic recovery, and " +
      "the preserved AionUI General Work and scheduled-task journeys plus the main-owned " +
      "isolated-coding containment lifecycle, retained Goose Agent readiness, and the closed " +
      "native ACP coding journey plus the schema-15 Team authority, schema-16 Team experience " +
      "binding, visible group-chat, controls, explainability, Artifact aggregation, and recovery " +
      "projection present.",
  );
}

main();
