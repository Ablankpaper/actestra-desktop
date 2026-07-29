import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeAionUiDownstream,
  resolveContainedPath,
} from "./materialize-aionui-downstream.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const overlayPath = path.join(repositoryRoot, "downstream", "aionui-v2.1.41", "overlay.json");
const provenancePath = path.join(repositoryRoot, "foundation", "aionui-v2.1.41.provenance.json");
const generatedNames = new Set([
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
    overlay.phase !== "GW-P4.2" ||
    overlay.uiContract.layoutChangesAllowed !== false ||
    overlay.uiContract.featureEntryRemovalAllowed !== false
  ) {
    throw new Error("Invalid GW-P4.2 downstream overlay policy");
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

  const packageJson = readJson(path.join(outputRoot, "package.json"));
  if (
    packageJson.name !== "actestra-desktop" ||
    packageJson.productName !== "Actestra" ||
    packageJson.version !== "0.1.0-alpha.0"
  ) {
    throw new Error("Materialized package does not have the Actestra F1 identity");
  }

  requireText(path.join(outputRoot, "packages/desktop/electron-builder.yml"), [
    "appId: com.bignormal.actestra",
    "productName: Actestra",
    "executableName: Actestra",
    "Portions Copyright © 2024 AionUi contributors.",
    "- actestra",
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
  requireText(path.join(outputRoot, "packages/desktop/src/common/adapter/httpBridge.ts"), [
    "publishActestraHttpObservation",
    "publishActestraWebSocketObservation",
  ]);
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
      "nativeFallback",
      "recoverPending",
    ],
  );
  rejectText(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    ["openSqliteCorePersistence", "node:sqlite", "DatabaseSync"],
  );
  requireText(path.join(outputRoot, "packages/desktop/electron.vite.config.ts"), [
    "'actestra-persistence-utility'",
    "persistenceUtilityEntry.ts",
    "entryFileNames: '[name].js'",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "await initializeProcess();",
    "await initializeActestraPersistenceUtility(app.getPath('userData'));",
    "registerActestraShadowBridge(mainWindow);",
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
      "CURRENT_CORE_SCHEMA_VERSION = 6",
      "aionui_shadow_evidence",
      "aionui_approval_decisions",
      "pending-delivery",
      "workspace_grants",
      "content_references",
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
    ["node:sqlite", "DatabaseSync", "persistWorkspaceGrant", "storeContentReference"],
  );

  console.log(
    `Verified Actestra GW-P4.2 downstream overlay: ${changedFiles.size} declared files, ` +
      `${overlay.invariantFiles.length} R0 invariant files, ${overlay.sourceCopies.length} ` +
      "reviewed source copies, preserved AionUI surfaces, utility-owned persistence, shadow and " +
      "approval authority, workspace grants, and bounded content references present.",
  );
}

main();
