import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeAionUiDownstream,
  resolveContainedPath,
} from "./materialize-aionui-downstream.mjs";
import { inspectGeneralWorkerModuleGraph } from "./general-worker-authority-rules.mjs";

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
    overlay.phase !== "P4-writing" ||
    overlay.uiContract.layoutChangesAllowed !== false ||
    overlay.uiContract.featureEntryRemovalAllowed !== false
  ) {
    throw new Error("Invalid P4 writing downstream overlay policy");
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
      "createScopedNativeToolPlatform",
      "getActestraScopedNativeToolPlatform",
      "[Actestra native tools] Ready tools=",
      "GeneralWorkCoordinator",
      "ACTESTRA_GENERAL_WORK_RECOVERY_READY",
      "ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL",
      "ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL",
      "runActestraGeneralWorkSmoke",
      "ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_READY",
      "local-research-artifact-fixture",
      "writing-artifact-fixture",
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
    path.join(outputRoot, "packages/desktop/src/renderer/components/chat/SendBox/index.tsx"),
    ["useActestraGeneralWork", "extractActestraGeneralWorkIntent", "effectiveLoading"],
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
      'kind: "document"',
      "invokeScopedToolStep",
      "activeToolInput",
      "MAX_GENERAL_WORKER_SEND_CONTENT_BYTES",
    ],
  );
  requireText(
    path.join(
      outputRoot,
      "packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx",
    ),
    ["persist?: boolean", "tab.metadata?.persist !== false", "persistActiveTab"],
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
    "schema version 11",
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
    "entryFileNames: '[name].js'",
  ]);
  requireText(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "await initializeProcess();",
    "await initializeActestraPersistenceUtility(app.getPath('userData'));",
    "runGeneralWorkerProbe",
    "actestra-general-worker.js",
    "ACTESTRA_GENERAL_WORKER_READY",
    "registerActestraShadowBridge(mainWindow);",
  ]);
  requireOrderedFragments(
    path.join(outputRoot, "packages/desktop/src/process/services/actestraShadowBridge.ts"),
    [
      "configurePersistenceServices(utility);",
      "new GeneralWorkCoordinator({",
      "}).recover();",
      "ACTESTRA_GENERAL_WORK_RECOVERY_READY",
      "[Actestra persistence] Utility ready schema=",
    ],
  );
  requireOrderedFragments(path.join(outputRoot, "packages/desktop/src/index.ts"), [
    "await initializeActestraPersistenceUtility(app.getPath('userData'));",
    "rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;",
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
      "CURRENT_CORE_SCHEMA_VERSION = 11",
      "aionui_shadow_evidence",
      "aionui_approval_decisions",
      "pending-delivery",
      "workspace_grants",
      "content_references",
      "general_work_checkpoints",
      "journey_kind",
      "local-research-artifact",
      "writing-artifact",
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
    "actestra.workspace.read-text",
    "actestra.task-output.write-text",
    "assertPortableRelativePath",
    "Only the two GW-P4.4 scoped native tools are registered",
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
      "policy-gw-p4-4-scoped-native-text-v1",
      "rule-gw-p4-4-workspace-read-text",
      "rule-gw-p4-4-task-output-write-text",
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
      "GENERAL_WORKER_PROTOCOL_VERSION = 1",
      'GENERAL_WORKER_IMPLEMENTATION_VERSION = "0.1.0"',
      "MAX_GENERAL_WORKER_MESSAGE_BYTES",
      "MAX_GENERAL_WORKER_PROMPT_BYTES",
      '"tool-result-accepted"',
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
      "allowLoadingUnsignedLibraries: false",
      "respondToAuthRequestsFromMainProcess: false",
    ],
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
  requireText(path.join(outputRoot, "tests/unit/actestra/generalWorkerProcessAdapter.test.ts"), [
    "General Worker process adapter",
    "protocolVersion: 2",
    "'task.started', 'agent.message', 'task.completed'",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/scopedNativeTools.test.ts"), [
    "registers only the two GW-P4.4 capabilities",
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
    "schema v11 utility IPC",
    "expect(client.schemaVersion).toBe(11)",
  ]);
  requireText(path.join(outputRoot, "tests/unit/actestra/generalWorkSmoke.test.ts"), [
    "prepare-writing-restart",
    "recover-writing-restart",
    "Actestra writing draft",
    "kind: 'document'",
  ]);

  console.log(
    `Verified Actestra P4 writing downstream overlay: ${changedFiles.size} declared files, ` +
      `${overlay.invariantFiles.length} R0 invariant files, ${overlay.sourceCopies.length} ` +
      "reviewed source copies, preserved AionUI surfaces, utility-owned persistence, shadow and " +
      "approval authority, workspace grants, bounded content references, AgentAdapter v2, and " +
      "the supervised General Worker, scoped native text tools, deterministic recovery, and " +
      "the preserved AionUI General Work journey present.",
  );
}

main();
