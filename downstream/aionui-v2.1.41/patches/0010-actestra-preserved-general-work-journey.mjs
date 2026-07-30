import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

function absolutePath(relativePath) {
  return path.join(outputRoot, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(absolutePath(relativePath), "utf8");
}

function write(relativePath, contents) {
  const filePath = absolutePath(relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
}

function writeNew(relativePath, contents) {
  if (fs.existsSync(absolutePath(relativePath))) {
    throw new Error(`Downstream overlay expected a new file: ${relativePath}`);
  }
  write(relativePath, contents);
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

function replaceAll(relativePath, before, after, expectedCount) {
  const contents = read(relativePath);
  const actualCount = contents.split(before).length - 1;
  if (actualCount !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} downstream patch contexts in ${relativePath}, received ${actualCount}`,
    );
  }
  write(relativePath, contents.split(before).join(after));
}

replaceOnce(
  "tests/unit/actestra/productBoundary.test.ts",
  `import {
  ACTESTRA_PROFILE_MANIFEST,
  ensureActestraProfileLayout,
  resolveActestraUserDataPath,
} from '@/process/utils/actestraProfile';
`,
  `import {
  ACTESTRA_PROFILE_MANIFEST,
  ensureActestraProfileLayout,
  resolveActestraUserDataPath,
} from '@/process/utils/actestraProfile';
import { shouldBypassActestraCliSafeSymlink } from '@/process/utils/utils';
`,
);

replaceOnce(
  "tests/unit/actestra/productBoundary.test.ts",
  `  it('creates and validates a versioned private profile manifest', () => {`,
  `  it('bypasses the global CLI-safe symlink only for an explicit Actestra E2E profile', () => {
    expect(
      shouldBypassActestraCliSafeSymlink({
        ACTESTRA_E2E_TEST: '1',
        ACTESTRA_USER_DATA_DIR: '/tmp/actestra-isolated-profile',
      }),
    ).toBe(true);
    expect(
      shouldBypassActestraCliSafeSymlink({
        ACTESTRA_E2E_TEST: '1',
      }),
    ).toBe(false);
    expect(
      shouldBypassActestraCliSafeSymlink({
        ACTESTRA_USER_DATA_DIR: '/tmp/actestra-isolated-profile',
      }),
    ).toBe(false);
  });

  it('creates and validates a versioned private profile manifest', () => {`,
);

replaceOnce(
  "tests/unit/bootstrap/configureConsoleLog.test.ts",
  `  it('keeps stdout console transport available during development', async () => {`,
  `  it('keeps stdout console transport available for packaged Actestra E2E evidence', async () => {
    process.env.ACTESTRA_E2E_TEST = '1';
    try {
      const log = await loadConfigureConsoleLog(true);

      expect(log.transports.console.level).toBe('silly');
    } finally {
      delete process.env.ACTESTRA_E2E_TEST;
    }
  });

  it('keeps stdout console transport available during development', async () => {`,
);

replaceOnce(
  "packages/desktop/src/process/utils/utils.ts",
  `export const getDataPath = (): string => {
  const rootPath = getElectronPathOrFallback('userData');
  const dataPath = path.join(rootPath, 'runtime');
  return ensureCliSafeSymlink(dataPath, getEnvAwareName('.actestra-v1'));
};`,
  `export const shouldBypassActestraCliSafeSymlink = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean =>
  environment.ACTESTRA_E2E_TEST === '1' &&
  Boolean(environment.ACTESTRA_USER_DATA_DIR?.trim());

export const getDataPath = (): string => {
  const rootPath = getElectronPathOrFallback('userData');
  const dataPath = path.join(rootPath, 'runtime');
  return shouldBypassActestraCliSafeSymlink()
    ? dataPath
    : ensureCliSafeSymlink(dataPath, getEnvAwareName('.actestra-v1'));
};`,
);

replaceOnce(
  "packages/desktop/src/process/utils/utils.ts",
  `  const configPath = path.join(rootPath, 'config');
  return ensureCliSafeSymlink(
    configPath,
    getEnvAwareName('.actestra-config-v1'),
  );`,
  `  const configPath = path.join(rootPath, 'config');
  return shouldBypassActestraCliSafeSymlink()
    ? configPath
    : ensureCliSafeSymlink(
        configPath,
        getEnvAwareName('.actestra-config-v1'),
      );`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureConsoleLog.ts",
  `log.transports.file.level = FILE_LOG_LEVEL;
log.transports.file.maxSize = FILE_SIZE_LIMIT;
log.transports.console.level = app.isPackaged ? false : CONSOLE_LOG_LEVEL;`,
  `log.transports.file.level = FILE_LOG_LEVEL;
log.transports.file.maxSize = FILE_SIZE_LIMIT;
const preserveActestraE2EConsoleEvidence =
  process.env.ACTESTRA_E2E_TEST === '1';
log.transports.console.level =
  app.isPackaged && !preserveActestraE2EConsoleEvidence
    ? false
    : CONSOLE_LOG_LEVEL;`,
);

replaceOnce(
  "packages/shared-scripts/src/prepare-aioncore.js",
  `function copyDirectorySafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
}

function ensureExecutableMode(filePath) {`,
  `function copyDirectorySafe(sourcePath, targetPath) {
  ensureDirectory(path.dirname(targetPath));
  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });
}

function isPathInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith('..' + path.sep) &&
      !path.isAbsolute(relativePath))
  );
}

function normalizeBundledSymlinks(rootDir, sourceRootDir = rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteSourceRoot = path.resolve(sourceRootDir);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error('Managed-resources bundle is missing: ' + absoluteRoot);
  }

  const pendingDirectories = [absoluteRoot];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), linkTarget);
        let bundledTarget = resolvedTarget;
        if (
          !isPathInside(absoluteRoot, bundledTarget) &&
          isPathInside(absoluteSourceRoot, resolvedTarget)
        ) {
          bundledTarget = path.join(
            absoluteRoot,
            path.relative(absoluteSourceRoot, resolvedTarget)
          );
        }
        if (!isPathInside(absoluteRoot, bundledTarget)) {
          throw new Error(
            'Managed-resources symlink escapes the managed-resources bundle: ' + entryPath
          );
        }
        if (!fs.existsSync(bundledTarget)) {
          throw new Error('Managed-resources symlink is broken: ' + entryPath);
        }
        if (path.isAbsolute(linkTarget) || bundledTarget !== resolvedTarget) {
          const relativeTarget = path.relative(path.dirname(entryPath), bundledTarget) || '.';
          const targetType = fs.statSync(bundledTarget).isDirectory() ? 'dir' : 'file';
          fs.unlinkSync(entryPath);
          fs.symlinkSync(relativeTarget, entryPath, targetType);
        }
        continue;
      }
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      }
    }
  }
}

function ensureExecutableMode(filePath) {`,
);

replaceOnce(
  "packages/shared-scripts/src/prepare-aioncore.js",
  `  });

  removeDirectorySafe(dataDir);
  return bundleOut;
}`,
  `  });

  normalizeBundledSymlinks(bundleOut);
  removeDirectorySafe(dataDir);
  return bundleOut;
}`,
);

replaceOnce(
  "packages/shared-scripts/src/prepare-aioncore.js",
  `      copyDirectorySafe(resolvedLocalBundleDir, targetDir);
      ensureExecutableMode(targetBinaryPath);`,
  `      copyDirectorySafe(resolvedLocalBundleDir, targetDir);
      normalizeBundledSymlinks(
        path.join(targetDir, 'managed-resources'),
        localManagedResourcesDir
      );
      ensureExecutableMode(targetBinaryPath);`,
);

replaceOnce(
  "packages/shared-scripts/src/prepare-aioncore.js",
  `  getActionsArtifactMissingMessage,
  getActionsArtifactName,
  prepareAioncore,`,
  `  getActionsArtifactMissingMessage,
  getActionsArtifactName,
  normalizeBundledSymlinks,
  prepareAioncore,`,
);

replaceOnce(
  "packages/shared-scripts/src/verify-bundled-aioncore-resources.js",
  `function contractBundledPath(runtimeKey, ...parts) {
  return bundledPath(runtimeKey, 'managed-resources', ...parts);
}

function addSchemaFailure(`,
  `function contractBundledPath(runtimeKey, ...parts) {
  return bundledPath(runtimeKey, 'managed-resources', ...parts);
}

function isPathInside(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === '' ||
    (relativePath !== '..' &&
      !relativePath.startsWith('..' + path.sep) &&
      !path.isAbsolute(relativePath))
  );
}

function verifyManagedResourceSymlinks(baseDir, runtimeKey, checked, missing, failures) {
  const managedRoot = path.join(baseDir, 'managed-resources');
  if (!isDirectory(managedRoot)) return;

  const pendingDirectories = [managedRoot];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        const relativePath = contractBundledPath(
          runtimeKey,
          normalize(path.relative(managedRoot, entryPath))
        );
        const linkTarget = fs.readlinkSync(entryPath);
        const resolvedTarget = path.resolve(path.dirname(entryPath), linkTarget);
        let reason = null;
        if (path.isAbsolute(linkTarget)) {
          reason = 'absolute_symlink';
        } else if (!isPathInside(managedRoot, resolvedTarget)) {
          reason = 'external_symlink';
        } else if (!fs.existsSync(entryPath)) {
          reason = 'broken_symlink';
        }
        if (reason !== null) {
          addFailure(failures, missing, checked, {
            component: 'managed-resources',
            reason,
            path: relativePath,
          });
        } else {
          checked.push(relativePath);
        }
        continue;
      }
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      }
    }
  }
}

function addSchemaFailure(`,
);

replaceOnce(
  "packages/shared-scripts/src/verify-bundled-aioncore-resources.js",
  `  requireRelativeDirectory(baseDir, runtimeKey, ['managed-resources'], checked, missing, failures);
  verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures);`,
  `  requireRelativeDirectory(baseDir, runtimeKey, ['managed-resources'], checked, missing, failures);
  verifyManagedResourceSymlinks(baseDir, runtimeKey, checked, missing, failures);
  verifyManagedResourcesContract(baseDir, runtimeKey, checked, missing, failures);`,
);

replaceOnce(
  "tests/unit/assets/verifyBundledAioncoreResources.test.ts",
  `import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';`,
  `import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';`,
);

replaceOnce(
  "tests/unit/assets/verifyBundledAioncoreResources.test.ts",
  `const {
  verifyBundledAioncoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');`,
  `const {
  verifyBundledAioncoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');
const {
  normalizeBundledSymlinks,
  prepareAioncore,
} = require('../../../packages/shared-scripts/src/prepare-aioncore');`,
);

replaceOnce(
  "tests/unit/assets/verifyBundledAioncoreResources.test.ts",
  `  it('fails when managed resources contract is missing', () => {`,
  `  it('rejects absolute symlinks even when their current target is inside the bundle', () => {
    const target = join(
      managedResourcesDir,
      'node',
      'node-v24.11.0-win-x64',
      'node.exe'
    );
    const link = join(managedResourcesDir, 'node-absolute-link');
    symlinkSync(target, link);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'managed-resources',
        reason: 'absolute_symlink',
        path: 'bundled-aioncore/win32-x64/managed-resources/node-absolute-link',
      })
    );
  });

  it('normalizes internal absolute symlinks and rejects bundle escapes', () => {
    const target = join(
      managedResourcesDir,
      'node',
      'node-v24.11.0-win-x64',
      'node.exe'
    );
    const internalLink = join(managedResourcesDir, 'node-internal-link');
    symlinkSync(target, internalLink);

    normalizeBundledSymlinks(managedResourcesDir);
    expect(isAbsolute(readlinkSync(internalLink))).toBe(false);

    const externalTarget = join(tmp, 'external-node');
    writeFile(externalTarget);
    const externalLink = join(managedResourcesDir, 'node-external-link');
    symlinkSync(externalTarget, externalLink);
    expect(() => normalizeBundledSymlinks(managedResourcesDir)).toThrow(
      /escapes the managed-resources bundle/
    );
  });

  it('maps copied source-bundle links into the copied bundle without mutating the source', () => {
    const sourceRoot = join(tmp, 'source-managed-resources');
    const copiedRoot = join(tmp, 'copied-managed-resources');
    const sourceTarget = join(sourceRoot, 'lib', 'npm-cli.js');
    writeFile(sourceTarget);
    cpSync(sourceRoot, copiedRoot, { recursive: true });
    const copiedLink = join(copiedRoot, 'bin', 'npm');
    mkdirSync(dirname(copiedLink), { recursive: true });
    symlinkSync(sourceTarget, copiedLink);

    normalizeBundledSymlinks(copiedRoot, sourceRoot);

    const relativeTarget = readlinkSync(copiedLink);
    expect(isAbsolute(relativeTarget)).toBe(false);
    expect(resolve(dirname(copiedLink), relativeTarget)).toBe(
      join(copiedRoot, 'lib', 'npm-cli.js')
    );
  });

  it('preserves relative managed-resource symlinks from a complete local bundle', () => {
    const sourceBundle = join(tmp, 'local-bundle');
    cpSync(join(resourcesDir, 'bundled-aioncore', 'win32-x64'), sourceBundle, {
      recursive: true,
      verbatimSymlinks: true,
    });
    const sourceLink = join(
      sourceBundle,
      'managed-resources',
      'node',
      'node-v24.11.0-win-x64',
      'node-link.exe'
    );
    symlinkSync('node.exe', sourceLink);

    const destinationProject = join(tmp, 'destination-project');
    const previousLocalBundle = process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = sourceBundle;
    try {
      prepareAioncore({
        projectRoot: destinationProject,
        platform: 'win32',
        arch: 'x64',
        version: 'v0.1.52',
      });
    } finally {
      if (previousLocalBundle === undefined) {
        delete process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR;
      } else {
        process.env.AIONUI_BACKEND_LOCAL_BUNDLE_DIR = previousLocalBundle;
      }
    }

    const destinationLink = join(
      destinationProject,
      'resources',
      'bundled-aioncore',
      'win32-x64',
      'managed-resources',
      'node',
      'node-v24.11.0-win-x64',
      'node-link.exe'
    );
    expect(readlinkSync(destinationLink)).toBe('node.exe');
    expect(isAbsolute(readlinkSync(destinationLink))).toBe(false);
  });

  it('fails when managed resources contract is missing', () => {`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import { GeneralWorkCoordinator } from '@/actestra/main/workers/generalWorkCoordinator';
import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '@/common/config/actestraShadowContract';`,
  `import { GeneralWorkCoordinator } from '@/actestra/main/workers/generalWorkCoordinator';
import {
  AionUiGeneralWorkJourneyService,
  type AionUiPreparedGeneralWorkRecoverySummary,
} from '@/actestra/main/compatibility/aionuiGeneralWorkJourneyService';
import { AionUiGeneralWorkBridgeService } from '@/actestra/main/compatibility/aionuiGeneralWorkBridgeService';
import { AionUiGeneralWorkNativeContextResolver } from '@/actestra/main/compatibility/aionuiGeneralWorkNativeContext';
import { launchElectronGeneralWorker } from '@/actestra/main/workers/electronGeneralWorker';
import {
  ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL,
  ACTESTRA_GENERAL_WORK_LIST_CHANNEL,
  ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL,
  ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL,
  type AionUiGeneralWorkBridgeResult,
} from '@/actestra/compatibility/aionui/generalWorkBridge';
import { ACTESTRA_SHADOW_OBSERVE_CHANNEL } from '@/common/config/actestraShadowContract';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import { LoopbackAionUiApprovalNativeTransport } from './actestraApprovalNativeTransport';`,
  `import { LoopbackAionUiApprovalNativeTransport } from './actestraApprovalNativeTransport';
import { LoopbackAionUiGeneralWorkNativeConversationReader } from './actestraGeneralWorkNativeConversationReader';
import {
  resolveActestraGeneralWorkSmokeConfig,
  runActestraGeneralWorkSmoke,
} from './actestraGeneralWorkSmoke';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `let approvalService: AionUiApprovalAuthorityService | null = null;
let nativeToolPlatform: ScopedNativeToolPlatform | null = null;
let handlerRegistered = false;
let approvalHandlerRegistered = false;
let approvalRecoveryStarted = false;`,
  `let approvalService: AionUiApprovalAuthorityService | null = null;
let nativeToolPlatform: ScopedNativeToolPlatform | null = null;
let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;
let generalWorkBridgeService: AionUiGeneralWorkBridgeService | null = null;
let handlerRegistered = false;
let approvalHandlerRegistered = false;
let generalWorkHandlersRegistered = false;
let approvalRecoveryStarted = false;
let generalWorkRecoveryStarted = false;
let generalWorkRecoveryPromise: Promise<AionUiPreparedGeneralWorkRecoverySummary> | null = null;
let generalWorkSmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(
  process.env,
);`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `const nativeFallback = (): ActestraApprovalDecisionResult => ({
  status: 'native-fallback',
});

async function resolveApproval(`,
  `const nativeFallback = (): ActestraApprovalDecisionResult => ({
  status: 'native-fallback',
});

const generalWorkUnavailable = (): AionUiGeneralWorkBridgeResult => ({
  status: 'rejected',
  code: 'persistence-unavailable',
});

function ownsMainFrame(event: IpcMainInvokeEvent, extraArguments: readonly unknown[]): boolean {
  return (
    extraArguments.length === 0 &&
    currentWindow !== null &&
    !currentWindow.isDestroyed() &&
    event.sender === currentWindow.webContents &&
    event.senderFrame === currentWindow.webContents.mainFrame
  );
}

async function submitGeneralWork(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiGeneralWorkBridgeResult> {
  if (!ownsMainFrame(event, extraArguments)) {
    return generalWorkUnavailable();
  }
  return generalWorkBridgeService?.submit(request) ?? generalWorkUnavailable();
}

async function listGeneralWork(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiGeneralWorkBridgeResult> {
  if (!ownsMainFrame(event, extraArguments)) {
    return generalWorkUnavailable();
  }
  return generalWorkBridgeService?.list(request) ?? generalWorkUnavailable();
}

async function cancelGeneralWork(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiGeneralWorkBridgeResult> {
  if (!ownsMainFrame(event, extraArguments)) {
    return generalWorkUnavailable();
  }
  return generalWorkBridgeService?.cancel(request) ?? generalWorkUnavailable();
}

async function previewGeneralWork(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiGeneralWorkBridgeResult> {
  if (!ownsMainFrame(event, extraArguments)) {
    return generalWorkUnavailable();
  }
  return generalWorkBridgeService?.preview(request) ?? generalWorkUnavailable();
}

async function resolveApproval(`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  nativeToolPlatform = createScopedNativeToolPlatform({
    persistence: activePersistence,
  });
  console.info(
    \`[Actestra native tools] Ready tools=\${WORKSPACE_READ_TEXT_TOOL_ID},\${TASK_OUTPUT_WRITE_TEXT_TOOL_ID}\`,
  );`,
  `  nativeToolPlatform = createScopedNativeToolPlatform({
    persistence: activePersistence,
  });
  const platform = nativeToolPlatform;
  generalWorkJourneyService = new AionUiGeneralWorkJourneyService({
    persistence: activePersistence,
    nativeTools: platform,
    clock: platform.clock,
    nativeContext:
      generalWorkSmokeConfig === null
        ? new AionUiGeneralWorkNativeContextResolver(
            new LoopbackAionUiGeneralWorkNativeConversationReader(),
          )
        : {
            resolve: async (nativeConversationId: string) => {
              if (
                nativeConversationId !==
                generalWorkSmokeConfig.nativeConversationId
              ) {
                throw new Error(
                  'Actestra General Work smoke conversation identity changed',
                );
              }
              return {
                rootPath: generalWorkSmokeConfig.workspaceRoot,
                displayName: 'Actestra target-app smoke workspace',
              };
            },
          },
    launchWorker: async ({ journeyKind, readRequestId, requestId }) => {
      if (generalWorkSmokeConfig?.scenario === 'prepare-restart') {
        throw new Error(
          'Actestra target-app smoke interrupted before Worker launch',
        );
      }
      if (generalWorkSmokeConfig?.scenario === 'denial') {
        const graph = await activePersistence.loadDomainGraph();
        const readyTasks = graph.tasks.filter((task) => task.state === 'ready');
        if (readyTasks.length !== 1 || readyTasks[0] === undefined) {
          throw new Error(
            'Actestra denial smoke requires exactly one prepared task',
          );
        }
        const grant = await activePersistence.getActiveWorkspaceGrant(
          readyTasks[0].workspaceId,
        );
        if (grant === null) {
          throw new Error('Actestra denial smoke has no active workspace grant');
        }
        await activePersistence.persistWorkspaceGrant({
          ...grant,
          state: 'revoked',
          updatedAt: platform.clock.now(),
        });
      }
      const requestIds =
        journeyKind !== 'prompt-artifact'
          ? [readRequestId, requestId]
          : [requestId];
      let requestIndex = 0;
      return launchElectronGeneralWorker({
        modulePath: path.join(__dirname, 'actestra-general-worker.js'),
        workingDirectory: process.resourcesPath,
        adapter: {
          executionMode:
            generalWorkSmokeConfig?.scenario === 'cancellation'
              ? 'hold'
              : journeyKind === 'local-research-artifact'
                ? 'local-research-artifact-fixture'
                : journeyKind === 'workspace-file-artifact'
                  ? 'workspace-read-then-task-output-write-fixture'
                  : 'task-output-write-text-fixture',
          newToolRequestId: () => {
            const nextRequestId = requestIds[requestIndex];
            requestIndex += 1;
            if (nextRequestId === undefined) {
              throw new Error(
                'Actestra General Worker requested an undeclared tool identity',
              );
            }
            return nextRequestId;
          },
        },
        clock: platform.clock,
      });
    },
  });
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(
    generalWorkJourneyService,
  );
  console.info(
    \`[Actestra native tools] Ready tools=\${WORKSPACE_READ_TEXT_TOOL_ID},\${TASK_OUTPUT_WRITE_TEXT_TOOL_ID}\`,
  );`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    approvalService = null;
    nativeToolPlatform = null;
    console.warn('[Actestra general work] Recovery unavailable at startup');`,
  `    approvalService = null;
    nativeToolPlatform = null;
    generalWorkJourneyService = null;
    generalWorkBridgeService = null;
    console.warn('[Actestra general work] Recovery unavailable at startup');`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    .catch(() => {
      console.warn('[Actestra approval] Pending delivery recovery unavailable');
    });
}

export async function initializeActestraPersistenceUtility(`,
  `    .catch(() => {
      console.warn('[Actestra approval] Pending delivery recovery unavailable');
    });
}

function startGeneralWorkRecovery(): void {
  if (generalWorkRecoveryStarted || generalWorkJourneyService === null) {
    return;
  }
  generalWorkRecoveryStarted = true;
  const operation = generalWorkJourneyService
    .recoverPrepared()
    .then((summary) => {
      console.info(
        \`ACTESTRA_AIONUI_GENERAL_WORK_JOURNEY_RECOVERY_READY \${JSON.stringify(summary)}\`,
      );
      return summary;
    });
  generalWorkRecoveryPromise = operation;
  void operation.catch(() => {
      console.warn('[Actestra general work] Prepared journey recovery unavailable');
    });
}

function startGeneralWorkSmoke(): void {
  if (
    generalWorkSmokeStarted ||
    generalWorkSmokeConfig === null ||
    generalWorkJourneyService === null ||
    generalWorkRecoveryPromise === null
  ) {
    return;
  }
  generalWorkSmokeStarted = true;
  void runActestraGeneralWorkSmoke(
    generalWorkSmokeConfig,
    generalWorkJourneyService,
    generalWorkRecoveryPromise,
  )
    .then((summary) => {
      console.info(
        \`ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_READY \${JSON.stringify(summary)}\`,
      );
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown failure';
      console.error(
        \`ACTESTRA_AIONUI_GENERAL_WORK_SMOKE_FAILED \${JSON.stringify({ message })}\`,
      );
    });
}

export async function initializeActestraPersistenceUtility(`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  if (!approvalHandlerRegistered) {
    ipcMain.handle(ACTESTRA_APPROVAL_DECIDE_CHANNEL, resolveApproval);
    approvalHandlerRegistered = true;
  }
  // Recovery needs the native backend`,
  `  if (!approvalHandlerRegistered) {
    ipcMain.handle(ACTESTRA_APPROVAL_DECIDE_CHANNEL, resolveApproval);
    approvalHandlerRegistered = true;
  }
  if (!generalWorkHandlersRegistered) {
    ipcMain.handle(ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL, submitGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_LIST_CHANNEL, listGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL, cancelGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL, previewGeneralWork);
    generalWorkHandlersRegistered = true;
  }
  // Recovery needs the native backend`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  startApprovalRecovery();
}`,
  `  startApprovalRecovery();
  startGeneralWorkRecovery();
  startGeneralWorkSmoke();
}`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `export async function closeActestraShadowBridge(): Promise<void> {
  const activePersistence = persistence;
  currentWindow = null;
  persistence = null;
  projectionService = null;
  approvalService = null;
  nativeToolPlatform = null;
  approvalRecoveryStarted = false;
  if (activePersistence !== null) {`,
  `export async function closeActestraShadowBridge(): Promise<void> {
  const activePersistence = persistence;
  const activeGeneralWork = generalWorkJourneyService;
  currentWindow = null;
  persistence = null;
  projectionService = null;
  approvalService = null;
  nativeToolPlatform = null;
  generalWorkJourneyService = null;
  generalWorkBridgeService = null;
  approvalRecoveryStarted = false;
  generalWorkRecoveryStarted = false;
  generalWorkRecoveryPromise = null;
  generalWorkSmokeStarted = false;
  await activeGeneralWork?.close().catch((): undefined => undefined);
  if (activePersistence !== null) {`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `import {
  ACTESTRA_APPROVAL_DECIDE_CHANNEL,
  type ActestraApprovalDecisionRequest,
} from '../common/config/actestraApprovalAuthorityContract';`,
  `import {
  ACTESTRA_APPROVAL_DECIDE_CHANNEL,
  type ActestraApprovalDecisionRequest,
} from '../common/config/actestraApprovalAuthorityContract';
import {
  ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL,
  ACTESTRA_GENERAL_WORK_LIST_CHANNEL,
  ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL,
  ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL,
  type AionUiGeneralWorkCancelRequest,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkListRequest,
  type AionUiGeneralWorkPreviewRequest,
} from '../actestra/compatibility/aionui/generalWorkBridge';`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `contextBridge.exposeInMainWorld('actestraApprovalAuthority', {
  decide: (request: ActestraApprovalDecisionRequest) =>
    ipcRenderer.invoke(ACTESTRA_APPROVAL_DECIDE_CHANNEL, request),
});

contextBridge.exposeInMainWorld('electronAPI', {`,
  `contextBridge.exposeInMainWorld('actestraApprovalAuthority', {
  decide: (request: ActestraApprovalDecisionRequest) =>
    ipcRenderer.invoke(ACTESTRA_APPROVAL_DECIDE_CHANNEL, request),
});

contextBridge.exposeInMainWorld('actestraGeneralWork', {
  submit: (intent: AionUiGeneralWorkIntent) =>
    ipcRenderer.invoke(ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL, intent),
  list: (request: AionUiGeneralWorkListRequest) =>
    ipcRenderer.invoke(ACTESTRA_GENERAL_WORK_LIST_CHANNEL, request),
  cancel: (request: AionUiGeneralWorkCancelRequest) =>
    ipcRenderer.invoke(ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL, request),
  preview: (request: AionUiGeneralWorkPreviewRequest) =>
    ipcRenderer.invoke(ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL, request),
});

contextBridge.exposeInMainWorld('electronAPI', {`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `keeps AionUI shadow, approval, and recovery authority behind schema v7 utility IPC`,
  `keeps AionUI shadow, approval, recovery, and journey authority behind schema v10 utility IPC`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `expect(client.schemaVersion).toBe(7);`,
  `expect(client.schemaVersion).toBe(10);`,
);

writeNew(
  "packages/desktop/src/process/services/actestraGeneralWorkNativeConversationReader.ts",
  `import type { AionUiGeneralWorkNativeConversationReader } from '@/actestra/main/compatibility/aionuiGeneralWorkNativeContext';
import { assertActestraBridgeRequestAllowed } from '@/common/config/actestraProduct';

const NATIVE_REQUEST_TIMEOUT_MS = 10_000;
const MAX_NATIVE_RESPONSE_BYTES = 65_536;

function backendPort(): number {
  const value = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new Error('Actestra general work requires a ready loopback runtime');
  }
  return value as number;
}

async function responseBody(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('AionUI native conversation returned no response body');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_NATIVE_RESPONSE_BYTES) {
      try {
        await reader.cancel();
      } catch {
        // The bounded response is already rejected; cancellation is best effort.
      }
      throw new Error('AionUI native conversation response exceeded the size limit');
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('AionUI native conversation returned invalid UTF-8');
  }
  if (text.length === 0) {
    throw new Error('AionUI native conversation returned an empty response');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('AionUI native conversation returned invalid JSON');
  }
}

export class LoopbackAionUiGeneralWorkNativeConversationReader
  implements AionUiGeneralWorkNativeConversationReader
{
  async read(nativeConversationId: string): Promise<unknown> {
    const requestPath =
      \`/api/conversations/\${encodeURIComponent(nativeConversationId)}\`;
    assertActestraBridgeRequestAllowed(requestPath);
    const response = await fetch(
      \`http://127.0.0.1:\${backendPort()}\${requestPath}\`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(NATIVE_REQUEST_TIMEOUT_MS),
      },
    );
    const parsed = await responseBody(response);
    if (!response.ok) {
      throw new Error(
        \`AionUI native conversation request failed with status \${response.status}\`,
      );
    }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      'data' in parsed
    ) {
      return (parsed as { data: unknown }).data;
    }
    return parsed;
  }
}
`,
);

writeNew(
  "packages/desktop/src/process/services/actestraGeneralWorkSmoke.ts",
  `import path from 'node:path';
import type {
  AionUiGeneralWorkJourneyService,
  AionUiPreparedGeneralWorkRecoverySummary,
} from '@/actestra/main/compatibility/aionuiGeneralWorkJourneyService';

const SMOKE_SCENARIOS = [
  'prepare-restart',
  'recover-restart',
  'denial',
  'cancellation',
  'local-research',
] as const;

export type ActestraGeneralWorkSmokeScenario =
  (typeof SMOKE_SCENARIOS)[number];

export interface ActestraGeneralWorkSmokeConfig {
  readonly scenario: ActestraGeneralWorkSmokeScenario;
  readonly workspaceRoot: string;
  readonly nativeConversationId: 'conversation-aionui-smoke';
}

export interface ActestraGeneralWorkSmokeSummary {
  readonly scenario: ActestraGeneralWorkSmokeScenario;
  readonly status: 'prepared' | 'completed' | 'failed' | 'cancelled';
  readonly taskCount: number;
  readonly artifactCount: number;
}

type SmokeEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveActestraGeneralWorkSmokeConfig(
  environment: SmokeEnvironment,
): ActestraGeneralWorkSmokeConfig | null {
  const requested = environment.ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO;
  if (requested === undefined) return null;
  if (
    environment.ACTESTRA_E2E_TEST !== '1' ||
    !SMOKE_SCENARIOS.includes(requested as ActestraGeneralWorkSmokeScenario)
  ) {
    throw new Error(
      'Actestra General Work smoke requires E2E mode and a recognized scenario',
    );
  }
  const workspaceRoot = environment.ACTESTRA_GENERAL_WORK_SMOKE_WORKSPACE;
  if (
    typeof workspaceRoot !== 'string' ||
    workspaceRoot.trim() !== workspaceRoot ||
    !path.isAbsolute(workspaceRoot) ||
    workspaceRoot === path.parse(workspaceRoot).root
  ) {
    throw new Error(
      'Actestra General Work smoke requires one absolute workspace root',
    );
  }
  return Object.freeze({
    scenario: requested as ActestraGeneralWorkSmokeScenario,
    workspaceRoot,
    nativeConversationId: 'conversation-aionui-smoke',
  });
}

function submissionId(
  scenario: ActestraGeneralWorkSmokeScenario,
): string {
  return scenario === 'prepare-restart' || scenario === 'recover-restart'
    ? 'submission-aionui-smoke-restart'
    : \`submission-aionui-smoke-\${scenario}\`;
}

function prompt(scenario: ActestraGeneralWorkSmokeScenario): string {
  if (scenario === 'cancellation') {
    return 'Hold the bounded Actestra smoke task until cancellation.';
  }
  if (scenario === 'denial') {
    return 'Exercise the bounded Actestra workspace grant denial.';
  }
  if (scenario === 'local-research') {
    return 'Compare the approved local source notes.';
  }
  return 'Create the restart-safe Actestra smoke artifact.';
}

function oneProjection(
  projections: Awaited<
    ReturnType<AionUiGeneralWorkJourneyService['list']>
  >,
) {
  if (projections.length !== 1 || projections[0] === undefined) {
    throw new Error('Actestra General Work smoke expected exactly one task');
  }
  return projections[0];
}

export async function runActestraGeneralWorkSmoke(
  config: ActestraGeneralWorkSmokeConfig,
  service: AionUiGeneralWorkJourneyService,
  recovery: Promise<AionUiPreparedGeneralWorkRecoverySummary>,
): Promise<ActestraGeneralWorkSmokeSummary> {
  const recoverySummary = await recovery;
  const restartJourney =
    config.scenario === 'prepare-restart' ||
    config.scenario === 'recover-restart';
  const intent = {
    contractVersion: 1,
    nativeConversationId: config.nativeConversationId,
    submissionId: submissionId(config.scenario),
    prompt: prompt(config.scenario),
    ...(restartJourney
      ? { journeyKind: 'workspace-file-artifact' as const }
      : config.scenario === 'local-research'
        ? { journeyKind: 'local-research-artifact' as const }
      : {}),
  } as const;

  if (config.scenario === 'prepare-restart') {
    if (
      recoverySummary.attempted !== 0 ||
      recoverySummary.started !== 0 ||
      recoverySummary.failed !== 0
    ) {
      throw new Error('The prepare-restart smoke profile was not clean');
    }
    let rejected = false;
    try {
      await service.submit(intent);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error('The prepare-restart smoke did not stop before Worker launch');
    }
    const projection = oneProjection(
      await service.list(config.nativeConversationId),
    );
    if (projection.status !== 'ready' || projection.canCancel) {
      throw new Error('The prepared smoke task is not restartable');
    }
    return Object.freeze({
      scenario: config.scenario,
      status: 'prepared',
      taskCount: 1,
      artifactCount: 0,
    });
  }

  if (config.scenario === 'recover-restart') {
    if (
      recoverySummary.attempted !== 1 ||
      recoverySummary.started !== 1 ||
      recoverySummary.failed !== 0
    ) {
      throw new Error('The recover-restart smoke did not start one prepared task');
    }
    await service.waitForIdle();
    const projection = oneProjection(
      await service.list(config.nativeConversationId),
    );
    if (
      projection.status !== 'completed' ||
      projection.canCancel ||
      projection.artifacts.length !== 1
    ) {
      throw new Error('The recovered smoke task has no completed artifact');
    }
    return Object.freeze({
      scenario: config.scenario,
      status: 'completed',
      taskCount: 1,
      artifactCount: 1,
    });
  }

  if (
    recoverySummary.attempted !== 0 ||
    recoverySummary.started !== 0 ||
    recoverySummary.failed !== 0
  ) {
    throw new Error('The scenario smoke profile was not clean');
  }
  const started = await service.submit(intent);
  if (!started.canCancel) {
    throw new Error('The scenario smoke task did not enter an active state');
  }
  if (config.scenario === 'cancellation') {
    const projection = await service.cancel(
      config.nativeConversationId,
      started.taskId,
      'Actestra target-app smoke requested cancellation.',
    );
    if (projection.status !== 'cancelled' || projection.canCancel) {
      throw new Error('The cancellation smoke did not persist a cancelled task');
    }
    return Object.freeze({
      scenario: config.scenario,
      status: 'cancelled',
      taskCount: 1,
      artifactCount: 0,
    });
  }

  await service.waitForIdle();
  const projection = oneProjection(
    await service.list(config.nativeConversationId),
  );
  if (config.scenario === 'local-research') {
    const artifact = projection.artifacts[0];
    if (
      projection.status !== 'completed' ||
      projection.canCancel ||
      projection.artifacts.length !== 1 ||
      artifact === undefined ||
      artifact.kind !== 'file' ||
      artifact.label !== 'Actestra local research brief' ||
      artifact.state !== 'available'
    ) {
      throw new Error(
        'The local-research smoke did not persist one completed file artifact',
      );
    }
    const preview = await service.preview(
      config.nativeConversationId,
      projection.taskId,
      artifact.artifactId,
    );
    if (
      preview.label !== 'Actestra local research brief' ||
      preview.mediaType !== 'text/markdown; charset=utf-8' ||
      !preview.content.includes('# Actestra local research brief') ||
      !preview.content.includes(\`Instruction: \${prompt(config.scenario)}\`)
    ) {
      throw new Error(
        'The local-research smoke did not resolve the exact owned Markdown Preview',
      );
    }
    return Object.freeze({
      scenario: config.scenario,
      status: 'completed',
      taskCount: 1,
      artifactCount: 1,
    });
  }
  if (
    projection.status !== 'failed' ||
    projection.canCancel ||
    projection.incidentCode === undefined ||
    projection.artifacts.length !== 0
  ) {
    throw new Error('The denial smoke did not persist terminal failure evidence');
  }
  return Object.freeze({
    scenario: config.scenario,
    status: 'failed',
    taskCount: 1,
    artifactCount: 0,
  });
}
`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraGeneralWorkClient.ts",
  `import {
  assertAionUiGeneralWorkBridgeResult,
  type AionUiGeneralWorkBridgeResult,
  type AionUiGeneralWorkCancelRequest,
  type AionUiGeneralWorkIntent,
  type AionUiGeneralWorkListRequest,
  type AionUiGeneralWorkPreviewRequest,
} from '@/actestra/compatibility/aionui/generalWorkBridge';

const unavailable = (): AionUiGeneralWorkBridgeResult => ({
  status: 'rejected',
  code: 'persistence-unavailable',
});

async function invoke(
  operation: (bridge: NonNullable<Window['actestraGeneralWork']>) => Promise<unknown>,
): Promise<AionUiGeneralWorkBridgeResult> {
  if (
    typeof window === 'undefined' ||
    window.actestraGeneralWork === undefined
  ) {
    return unavailable();
  }
  try {
    const result = await operation(window.actestraGeneralWork);
    assertAionUiGeneralWorkBridgeResult(result);
    return result;
  } catch {
    return {
      status: 'rejected',
      code: 'execution-failed',
    };
  }
}

export function submitActestraGeneralWork(
  intent: AionUiGeneralWorkIntent,
): Promise<AionUiGeneralWorkBridgeResult> {
  return invoke((bridge) => bridge.submit(intent));
}

export function listActestraGeneralWork(
  request: AionUiGeneralWorkListRequest,
): Promise<AionUiGeneralWorkBridgeResult> {
  return invoke((bridge) => bridge.list(request));
}

export function cancelActestraGeneralWork(
  request: AionUiGeneralWorkCancelRequest,
): Promise<AionUiGeneralWorkBridgeResult> {
  return invoke((bridge) => bridge.cancel(request));
}

export function previewActestraGeneralWork(
  request: AionUiGeneralWorkPreviewRequest,
): Promise<AionUiGeneralWorkBridgeResult> {
  return invoke((bridge) => bridge.preview(request));
}
`,
);

writeNew(
  "packages/desktop/src/renderer/hooks/chat/actestraGeneralWorkProjection.ts",
  `import {
  parseAionUiGeneralWorkCommand,
  type AionUiGeneralWorkCommand,
  type AionUiGeneralWorkProjection,
} from '@/actestra/compatibility/aionui/generalWorkJourney';
import type { TMessage } from '@/common/chat/chatLib';

function statusTipType(
  status: AionUiGeneralWorkProjection['status'],
): 'error' | 'info' | 'success' | 'warning' {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'cancelled' || status === 'blocked') return 'warning';
  return 'info';
}

export function extractActestraGeneralWorkIntent(
  value: string,
): AionUiGeneralWorkCommand | null {
  return parseAionUiGeneralWorkCommand(value);
}

export function extractActestraGeneralWorkPrompt(value: string): string | null {
  return extractActestraGeneralWorkIntent(value)?.prompt ?? null;
}

export function projectActestraGeneralWorkMessage(
  conversationId: string,
  projection: AionUiGeneralWorkProjection,
): TMessage {
  const lines = [
    \`Actestra · \${projection.status}\`,
    projection.title,
    ...(projection.summary === undefined ? [] : [projection.summary]),
    ...projection.artifacts.map((artifact) => \`Artifact: \${artifact.label} · \${artifact.state}\`),
    ...(projection.incidentCode === undefined ? [] : [\`Incident: \${projection.incidentCode}\`]),
  ];
  const messageId = \`actestra-general-work-\${projection.taskId}\`;
  return {
    id: messageId,
    msg_id: messageId,
    conversation_id: conversationId,
    type: 'tips',
    position: 'center',
    status: projection.canCancel ? 'work' : projection.status === 'failed' ? 'error' : 'finish',
    created_at: Date.parse(projection.createdAt),
    content: {
      content: lines.join('\\n'),
      type: statusTipType(projection.status),
      code: \`ACTESTRA_GENERAL_WORK_\${projection.status.toUpperCase()}\`,
      params: {
        actestraGeneralWork: {
          contractVersion: 1,
          taskId: projection.taskId,
          artifacts: projection.artifacts.map((artifact) => ({
            artifactId: artifact.artifactId,
            label: artifact.label,
            state: artifact.state,
          })),
        },
      },
    },
  };
}
`,
);

writeNew(
  "packages/desktop/src/renderer/hooks/chat/useActestraGeneralWork.ts",
  `import type {
  AionUiGeneralWorkJourneyKind,
  AionUiGeneralWorkProjection,
} from '@/actestra/compatibility/aionui/generalWorkJourney';
import {
  cancelActestraGeneralWork,
  listActestraGeneralWork,
  submitActestraGeneralWork,
} from '@/common/adapter/actestraGeneralWorkClient';
import { useAddOrUpdateMessage } from '@/renderer/pages/conversation/Messages/hooks';
import { projectActestraGeneralWorkMessage } from './actestraGeneralWorkProjection';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';

export {
  extractActestraGeneralWorkIntent,
  extractActestraGeneralWorkPrompt,
} from './actestraGeneralWorkProjection';

const POLL_INTERVAL_MS = 250;
let fallbackSubmissionSequence = 0;

function submissionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return \`submission-aionui-\${globalThis.crypto.randomUUID()}\`;
  }
  fallbackSubmissionSequence += 1;
  return \`submission-aionui-\${Date.now()}-\${fallbackSubmissionSequence}\`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function useActestraGeneralWork(conversationId: string | undefined) {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const mountedRef = useRef(true);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const pollGenerationRef = useRef(0);
  const readFailureNotifiedRef = useRef(false);
  const activeTaskIdRef = useRef<string | null>(null);
  const submitPendingRef = useRef(false);
  const cancelPendingSubmitRef = useRef(false);
  const [hasActive, setHasActive] = useState(false);

  const syncHasActive = useCallback(() => {
    setHasActive(
      activeTaskIdRef.current !== null || submitPendingRef.current,
    );
  }, []);

  const setActiveTask = useCallback((taskId: string | null) => {
    activeTaskIdRef.current = taskId;
    syncHasActive();
  }, [syncHasActive]);

  const setSubmitPending = useCallback((pending: boolean) => {
    submitPendingRef.current = pending;
    syncHasActive();
  }, [syncHasActive]);

  const upsert = useCallback(
    (projection: AionUiGeneralWorkProjection) => {
      if (!conversationId) return;
      addOrUpdateMessage(projectActestraGeneralWorkMessage(conversationId, projection));
    },
    [addOrUpdateMessage, conversationId],
  );

  const read = useCallback(async () => {
    if (!conversationId) return null;
    const targetConversationId = conversationId;
    const result = await listActestraGeneralWork({
      contractVersion: 1,
      nativeConversationId: targetConversationId,
      limit: 100,
    });
    if (
      !mountedRef.current ||
      conversationIdRef.current !== targetConversationId
    ) {
      return null;
    }
    if (result.status === 'rejected' || !('projections' in result)) {
      if (!readFailureNotifiedRef.current) {
        readFailureNotifiedRef.current = true;
        Message.error(
          \`Actestra general work unavailable (\${
            result.status === 'rejected' ? result.code : 'invalid-response'
          })\`,
        );
      }
      return null;
    }
    readFailureNotifiedRef.current = false;
    result.projections.forEach(upsert);
    return result.projections;
  }, [conversationId, upsert]);

  const waitForTerminal = useCallback(
    async (taskId: string, generation: number): Promise<void> => {
      while (mountedRef.current && generation === pollGenerationRef.current) {
        await delay(POLL_INTERVAL_MS);
        if (!mountedRef.current || generation !== pollGenerationRef.current) return;
        const projections = await read();
        if (projections === null) continue;
        const current = projections.find((projection) => projection.taskId === taskId);
        if (current === undefined || !current.canCancel) {
          if (activeTaskIdRef.current === taskId) {
            setActiveTask(null);
          }
          return;
        }
      }
    },
    [read, setActiveTask],
  );

  useEffect(() => {
    mountedRef.current = true;
    readFailureNotifiedRef.current = false;
    cancelPendingSubmitRef.current = false;
    setSubmitPending(false);
    const generation = ++pollGenerationRef.current;
    if (!conversationId) {
      setActiveTask(null);
      return () => {
        mountedRef.current = false;
        pollGenerationRef.current += 1;
      };
    }
    setActiveTask(null);
    void read().then((projections) => {
      if (!mountedRef.current || generation !== pollGenerationRef.current) return;
      if (projections === null) return;
      const active = [...projections].reverse().find((projection) => projection.canCancel);
      setActiveTask(active?.taskId ?? null);
      if (active !== undefined) {
        void waitForTerminal(active.taskId, generation);
      }
    });
    return () => {
      mountedRef.current = false;
      pollGenerationRef.current += 1;
    };
  }, [
    conversationId,
    read,
    setActiveTask,
    setSubmitPending,
    waitForTerminal,
  ]);

  const cancelTask = useCallback(
    async (targetConversationId: string, taskId: string): Promise<void> => {
      const result = await cancelActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: targetConversationId,
        taskId,
        reason: 'User stopped the task from the preserved AionUI SendBox.',
      });
      if (
        !mountedRef.current ||
        conversationIdRef.current !== targetConversationId
      ) {
        return;
      }
      if (result.status === 'rejected' || !('projection' in result)) {
        Message.error(
          \`Actestra cancellation failed (\${
            result.status === 'rejected' ? result.code : 'invalid-response'
          })\`,
        );
        return;
      }
      upsert(result.projection);
      if (!result.projection.canCancel) {
        setActiveTask(null);
      }
    },
    [setActiveTask, upsert],
  );

  const run = useCallback(
    async (
      prompt: string,
      journeyKind: AionUiGeneralWorkJourneyKind = 'prompt-artifact',
    ): Promise<void> => {
      if (!conversationId) return;
      const targetConversationId = conversationId;
      if (activeTaskIdRef.current !== null || submitPendingRef.current) {
        Message.warning('An Actestra task is already active in this conversation.');
        return;
      }
      cancelPendingSubmitRef.current = false;
      setSubmitPending(true);
      const result = await submitActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: targetConversationId,
        submissionId: submissionId(),
        prompt,
        ...(journeyKind !== 'prompt-artifact'
          ? { journeyKind }
          : {}),
      });
      if (
        !mountedRef.current ||
        conversationIdRef.current !== targetConversationId
      ) {
        return;
      }
      if (result.status === 'rejected' || !('projection' in result)) {
        setSubmitPending(false);
        cancelPendingSubmitRef.current = false;
        Message.error(
          \`Actestra task rejected (\${
            result.status === 'rejected' ? result.code : 'invalid-response'
          })\`,
        );
        return;
      }
      upsert(result.projection);
      if (!result.projection.canCancel) {
        setSubmitPending(false);
        cancelPendingSubmitRef.current = false;
        return;
      }
      setActiveTask(result.projection.taskId);
      setSubmitPending(false);
      if (cancelPendingSubmitRef.current) {
        cancelPendingSubmitRef.current = false;
        await cancelTask(targetConversationId, result.projection.taskId);
        return;
      }
      const generation = ++pollGenerationRef.current;
      await waitForTerminal(result.projection.taskId, generation);
    },
    [
      cancelTask,
      conversationId,
      setActiveTask,
      setSubmitPending,
      upsert,
      waitForTerminal,
    ],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const taskId = activeTaskIdRef.current;
    if (!conversationId) return;
    if (taskId === null) {
      if (submitPendingRef.current) {
        cancelPendingSubmitRef.current = true;
      }
      return;
    }
    await cancelTask(conversationId, taskId);
  }, [cancelTask, conversationId]);

  return {
    hasActive,
    run,
    cancel,
  };
}
`,
);

writeNew(
  "packages/desktop/src/renderer/pages/conversation/Messages/components/ActestraGeneralWorkArtifactActions.tsx",
  `import type { IMessageTips } from '@/common/chat/chatLib';
import { previewActestraGeneralWork } from '@/common/adapter/actestraGeneralWorkClient';
import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import React, { useCallback, useState } from 'react';

interface ActestraArtifactAction {
  readonly artifactId: string;
  readonly label: string;
  readonly state: 'available';
}

interface ActestraGeneralWorkTipContext {
  readonly taskId: string;
  readonly artifacts: readonly ActestraArtifactAction[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readContext(message: IMessageTips): ActestraGeneralWorkTipContext | null {
  if (
    !message.content.code?.startsWith('ACTESTRA_GENERAL_WORK_') ||
    typeof message.conversation_id !== 'string'
  ) {
    return null;
  }
  const value = message.content.params?.actestraGeneralWork;
  if (
    !isRecord(value) ||
    value.contractVersion !== 1 ||
    typeof value.taskId !== 'string' ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 100
  ) {
    return null;
  }
  const artifacts: ActestraArtifactAction[] = [];
  for (const entry of value.artifacts) {
    if (
      !isRecord(entry) ||
      typeof entry.artifactId !== 'string' ||
      typeof entry.label !== 'string' ||
      entry.state !== 'available'
    ) {
      continue;
    }
    artifacts.push({
      artifactId: entry.artifactId,
      label: entry.label,
      state: 'available',
    });
  }
  return artifacts.length === 0
    ? null
    : {
        taskId: value.taskId,
        artifacts,
      };
}

const ActestraGeneralWorkArtifactContent: React.FC<{
  context: ActestraGeneralWorkTipContext;
  conversationId: string;
}> = ({ context, conversationId }) => {
  const { openPreview } = usePreviewContext();
  const [error, setError] = useState<string | null>(null);
  const openArtifact = useCallback(
    async (artifact: ActestraArtifactAction): Promise<void> => {
      setError(null);
      const result = await previewActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: conversationId,
        taskId: context.taskId,
        artifactId: artifact.artifactId,
      });
      if (result.status === 'rejected' || !('preview' in result)) {
        setError(
          \`Actestra artifact preview unavailable (\${
            result.status === 'rejected' ? result.code : 'invalid-response'
          })\`,
        );
        return;
      }
      openPreview(
        result.preview.content,
        result.preview.mediaType === 'text/markdown; charset=utf-8'
          ? 'markdown'
          : 'code',
        {
          title: result.preview.label,
          editable: false,
          persist: false,
        },
      );
    },
    [context, conversationId, openPreview],
  );

  return (
    <div className='flex flex-col gap-4px'>
      <div className='flex flex-wrap gap-6px'>
        {context.artifacts.map((artifact) => (
          <button
            key={artifact.artifactId}
            type='button'
            className='rd-4px border border-solid border-border-2 bg-transparent p-x-8px p-y-2px text-12px text-t-secondary hover:text-t-primary cursor-pointer'
            onClick={() => void openArtifact(artifact)}
          >
            Preview {artifact.label}
          </button>
        ))}
      </div>
      {error !== null && (
        <span role='alert' className='text-12px text-danger'>
          {error}
        </span>
      )}
    </div>
  );
};

const ActestraGeneralWorkArtifactActions: React.FC<{
  message: IMessageTips;
}> = ({ message }) => {
  const context = readContext(message);
  if (context === null || typeof message.conversation_id !== 'string') {
    return null;
  }
  return (
    <ActestraGeneralWorkArtifactContent
      context={context}
      conversationId={message.conversation_id}
    />
  );
};

export default ActestraGeneralWorkArtifactActions;
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/components/MessageTips.tsx",
  `import { iconColors } from '@/renderer/styles/colors';`,
  `import { iconColors } from '@/renderer/styles/colors';
import ActestraGeneralWorkArtifactActions from './ActestraGeneralWorkArtifactActions';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/components/MessageTips.tsx",
  `          <div className='flex-1 min-w-0'>
            <CollapsibleContent maxHeight={48} defaultCollapsed={true} useMask={true}>
              <span className='whitespace-break-spaces text-t-primary [word-break:break-word]'>{displayContent}</span>
            </CollapsibleContent>
          </div>
        </div>
        {shouldShowButler && (`,
  `          <div className='flex-1 min-w-0'>
            <CollapsibleContent maxHeight={48} defaultCollapsed={true} useMask={true}>
              <span className='whitespace-break-spaces text-t-primary [word-break:break-word]'>{displayContent}</span>
            </CollapsibleContent>
          </div>
        </div>
        <ActestraGeneralWorkArtifactActions message={message} />
        {shouldShowButler && (`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx",
  `  editable?: boolean; // 是否可编辑 / Whether editable
  truncated?: boolean; // 预览内容是否被截断 / Whether preview content was truncated`,
  `  editable?: boolean; // 是否可编辑 / Whether editable
  persist?: boolean; // Whether this renderer-only preview may be cached in localStorage
  truncated?: boolean; // 预览内容是否被截断 / Whether preview content was truncated`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx",
  `const sanitizeTabsForPersistence = (input: PreviewTab[]): PreviewTab[] => {
  return input
    .filter((tab) => PERSISTABLE_CONTENT_TYPES.has(tab.content_type))
    .filter((tab) => tab.content.length <= MAX_PERSISTED_TAB_CONTENT_LENGTH)`,
  `const sanitizeTabsForPersistence = (input: PreviewTab[]): PreviewTab[] => {
  return input
    .filter((tab) => PERSISTABLE_CONTENT_TYPES.has(tab.content_type))
    .filter((tab) => tab.metadata?.persist !== false)
    .filter((tab) => tab.content.length <= MAX_PERSISTED_TAB_CONTENT_LENGTH)`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx",
  `      if (activeTabId) {
        localStorage.setItem(PREVIEW_ACTIVE_TAB_ID_KEY, activeTabId);
      } else {
        localStorage.removeItem(PREVIEW_ACTIVE_TAB_ID_KEY);
      }`,
  `      const persistActiveTab = tabs.some(
        (tab) =>
          tab.id === activeTabId &&
          PERSISTABLE_CONTENT_TYPES.has(tab.content_type) &&
          tab.metadata?.persist !== false &&
          tab.content.length <= MAX_PERSISTED_TAB_CONTENT_LENGTH,
      );
      if (activeTabId && persistActiveTab) {
        localStorage.setItem(PREVIEW_ACTIVE_TAB_ID_KEY, activeTabId);
      } else {
        localStorage.removeItem(PREVIEW_ACTIVE_TAB_ID_KEY);
      }`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Preview/context/PreviewContext.tsx",
  `  }, [activeTabId]);`,
  `  }, [activeTabId, tabs]);`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `import { useInputFocusRing } from '@/renderer/hooks/chat/useInputFocusRing';`,
  `import { useInputFocusRing } from '@/renderer/hooks/chat/useInputFocusRing';
import {
  extractActestraGeneralWorkIntent,
  useActestraGeneralWork,
} from '@/renderer/hooks/chat/useActestraGeneralWork';`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `  const [isLoading, setIsLoading] = useState(false);
  const [isSingleLine, setIsSingleLine] = useState(!effectiveDefaultMultiLine);`,
  `  const [isLoading, setIsLoading] = useState(false);
  const generalWork = useActestraGeneralWork(conversationContext?.conversation_id);
  const effectiveLoading = isLoading || generalWork.hasActive;
  const [isSingleLine, setIsSingleLine] = useState(!effectiveDefaultMultiLine);`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `    if (conversationContext?.conversation_id) {
      commands.push({
        name: 'copy',`,
  `    if (conversationContext?.conversation_id) {
      commands.push({
        name: 'actestra',
        description: 'Run through the Actestra Core supervised General Worker',
        kind: 'builtin',
        source: 'builtin',
        selectionBehavior: 'insert',
      });
      commands.push({
        name: 'copy',`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `      void btwCommand.ask(normalizedQuestion);
      return;
    }

    if (!allowSendWhileLoading && (isLoading || loading)) {`,
  `      void btwCommand.ask(normalizedQuestion);
      return;
    }

    const generalWorkIntent = extractActestraGeneralWorkIntent(input);
    if (generalWorkIntent !== null) {
      if (!generalWorkIntent.prompt) {
        message.warning('Add a bounded task after /actestra.');
        return;
      }
      if (hasPendingAttachments || domSnippets.length > 0 || replyQuote !== null) {
        message.warning('Actestra tasks accept text only; remove attachments and quotes.');
        return;
      }
      historyDraftRef.current = null;
      setHistoryNavigationIndex(null);
      setInput('');
      setIsLoading(true);
      void generalWork
        .run(generalWorkIntent.prompt, generalWorkIntent.journeyKind)
        .finally(() => {
          setIsLoading(false);
        });
      return;
    }

    if (!allowSendWhileLoading && (effectiveLoading || loading)) {`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `  const stopHandler = async () => {
    if (!onStop) return;
    try {
      await onStop();
    } finally {
      setIsLoading(false);
    }
  };`,
  `  const stopHandler = async () => {
    if (generalWork.hasActive) {
      try {
        await generalWork.cancel();
      } finally {
        setIsLoading(false);
      }
      return;
    }
    if (!onStop) return;
    try {
      await onStop();
    } finally {
      setIsLoading(false);
    }
  };`,
);

replaceAll(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `(isLoading || loading)`,
  `(effectiveLoading || loading)`,
  2,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `disabled={disabled || isLoading || loading || isUploading}`,
  `disabled={disabled || effectiveLoading || loading || isUploading}`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/chat/SendBox/index.tsx",
  `parentTaskRunning={Boolean(loading || isLoading)}`,
  `parentTaskRunning={Boolean(loading || effectiveLoading)}`,
);

replaceOnce(
  "tests/unit/renderer/conversation/SendBoxCronPrefill.dom.test.tsx",
  `vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
}));`,
  `vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMessageList: () => [],
  useAddOrUpdateMessage: () => vi.fn(),
}));

vi.mock('@/common/adapter/actestraGeneralWorkClient', () => ({
  listActestraGeneralWork: vi.fn(async () => ({
    status: 'ok',
    projections: [],
  })),
  submitActestraGeneralWork: vi.fn(),
  cancelActestraGeneralWork: vi.fn(),
}));`,
);

writeNew(
  "tests/unit/actestra/generalWorkSmoke.test.ts",
  `// @vitest-environment node

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AionUiGeneralWorkJourneyService } from '@/actestra/main/compatibility/aionuiGeneralWorkJourneyService';
import {
  resolveActestraGeneralWorkSmokeConfig,
  runActestraGeneralWorkSmoke,
} from '@/process/services/actestraGeneralWorkSmoke';

const zeroRecovery = Promise.resolve({
  attempted: 0,
  started: 0,
  failed: 0,
});

function config(
  scenario:
    | 'prepare-restart'
    | 'recover-restart'
    | 'denial'
    | 'cancellation'
    | 'local-research',
) {
  return {
    scenario,
    workspaceRoot: path.resolve('smoke-workspace'),
    nativeConversationId: 'conversation-aionui-smoke',
  } as const;
}

describe('Actestra target-app General Work smoke contract', () => {
  it('requires explicit E2E mode, scenario, and an absolute workspace', () => {
    expect(resolveActestraGeneralWorkSmokeConfig({})).toBeNull();
    expect(() =>
      resolveActestraGeneralWorkSmokeConfig({
        ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO: 'denial',
        ACTESTRA_GENERAL_WORK_SMOKE_WORKSPACE: path.resolve('workspace'),
      }),
    ).toThrow(/E2E mode/u);
    expect(() =>
      resolveActestraGeneralWorkSmokeConfig({
        ACTESTRA_E2E_TEST: '1',
        ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO: 'denial',
        ACTESTRA_GENERAL_WORK_SMOKE_WORKSPACE: path.parse(process.cwd()).root,
      }),
    ).toThrow(/absolute workspace root/u);
    expect(
      resolveActestraGeneralWorkSmokeConfig({
        ACTESTRA_E2E_TEST: '1',
        ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO: 'cancellation',
        ACTESTRA_GENERAL_WORK_SMOKE_WORKSPACE: path.resolve('smoke-workspace'),
      }),
    ).toEqual(config('cancellation'));
  });

  it('requires terminal cancellation evidence from the target service', async () => {
    const service = {
      submit: vi.fn(async () => ({
        taskId: 'task-smoke',
        canCancel: true,
      })),
      cancel: vi.fn(async () => ({
        status: 'cancelled',
        canCancel: false,
      })),
    } as unknown as AionUiGeneralWorkJourneyService;

    await expect(
      runActestraGeneralWorkSmoke(
        config('cancellation'),
        service,
        zeroRecovery,
      ),
    ).resolves.toEqual({
      scenario: 'cancellation',
      status: 'cancelled',
      taskCount: 1,
      artifactCount: 0,
    });
    expect(service.cancel).toHaveBeenCalledExactlyOnceWith(
      'conversation-aionui-smoke',
      'task-smoke',
      'Actestra target-app smoke requested cancellation.',
    );
  });

  it('distinguishes prepared and recovered restart evidence', async () => {
    const prepared = {
      submit: vi.fn(async () => {
        throw new Error('interrupted before launch');
      }),
      list: vi.fn(async () => [
        {
          status: 'ready',
          canCancel: false,
        },
      ]),
    } as unknown as AionUiGeneralWorkJourneyService;
    await expect(
      runActestraGeneralWorkSmoke(
        config('prepare-restart'),
        prepared,
        zeroRecovery,
      ),
    ).resolves.toMatchObject({
      scenario: 'prepare-restart',
      status: 'prepared',
    });
    expect(prepared.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        journeyKind: 'workspace-file-artifact',
      }),
    );

    const recovered = {
      waitForIdle: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        {
          status: 'completed',
          canCancel: false,
          artifacts: [{}],
        },
      ]),
    } as unknown as AionUiGeneralWorkJourneyService;
    await expect(
      runActestraGeneralWorkSmoke(
        config('recover-restart'),
        recovered,
        Promise.resolve({ attempted: 1, started: 1, failed: 0 }),
      ),
    ).resolves.toMatchObject({
      scenario: 'recover-restart',
      status: 'completed',
      artifactCount: 1,
    });
  });

  it('requires one completed local-research artifact and validates its owned Preview', async () => {
    const service = {
      submit: vi.fn(async () => ({
        taskId: 'task-local-research-smoke',
        canCancel: true,
      })),
      waitForIdle: vi.fn(async () => undefined),
      list: vi.fn(async () => [
        {
          taskId: 'task-local-research-smoke',
          status: 'completed',
          canCancel: false,
          artifacts: [
            {
              artifactId: 'artifact-local-research-smoke',
              kind: 'file',
              label: 'Actestra local research brief',
              state: 'available',
            },
          ],
        },
      ]),
      preview: vi.fn(async () => ({
        label: 'Actestra local research brief',
        mediaType: 'text/markdown; charset=utf-8',
        content:
          '# Actestra local research brief\\n\\n' +
          'Instruction: Compare the approved local source notes.\\n',
      })),
    } as unknown as AionUiGeneralWorkJourneyService;

    await expect(
      runActestraGeneralWorkSmoke(
        config('local-research'),
        service,
        zeroRecovery,
      ),
    ).resolves.toEqual({
      scenario: 'local-research',
      status: 'completed',
      taskCount: 1,
      artifactCount: 1,
    });
    expect(service.submit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        journeyKind: 'local-research-artifact',
      }),
    );
    expect(service.preview).toHaveBeenCalledExactlyOnceWith(
      'conversation-aionui-smoke',
      'task-local-research-smoke',
      'artifact-local-research-smoke',
    );
  });
});
`,
);

replaceOnce(
  "tests/unit/previews/PreviewContext.dom.test.tsx",
  `import { renderHook, act, cleanup } from '@testing-library/react';`,
  `import { renderHook, act, cleanup, waitFor } from '@testing-library/react';`,
);

replaceOnce(
  "tests/unit/previews/PreviewContext.dom.test.tsx",
  `  it('closes preview and clears all tabs', () => {`,
  `  it('keeps renderer-only preview content and active identity out of localStorage', async () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('Actestra private result', 'markdown', {
        title: 'Actestra result',
        persist: false,
      });
    });
    expect(result.current.activeTab?.content).toBe('Actestra private result');

    await waitFor(() => {
      expect(localStorage.getItem('aionui_preview_tabs')).toBe('[]');
      expect(localStorage.getItem('aionui_preview_active_tab_id')).toBeNull();
    });
  });

  it('closes preview and clears all tabs', () => {`,
);

writeNew(
  "tests/unit/actestra/generalWorkHook.dom.test.tsx",
  `// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addOrUpdateMessage: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
}));

vi.mock('@/common/adapter/actestraGeneralWorkClient', () => ({
  listActestraGeneralWork: mocks.list,
  submitActestraGeneralWork: mocks.submit,
  cancelActestraGeneralWork: mocks.cancel,
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => mocks.addOrUpdateMessage,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: mocks.messageError,
    warning: mocks.messageWarning,
  },
}));

import { useActestraGeneralWork } from '@/renderer/hooks/chat/useActestraGeneralWork';

const projection = {
  contractVersion: 1,
  taskId: 'task-native-stale-submit',
  status: 'running',
  title: 'Old conversation task',
  canCancel: true,
  createdAt: '2026-07-30T07:20:00.000Z',
  updatedAt: '2026-07-30T07:20:01.000Z',
  artifacts: [],
} as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Actestra preserved AionUI general-work hook', () => {
  it('submits the reserved-file command as a workspace-file journey', async () => {
    mocks.list.mockResolvedValue({ status: 'ok', projections: [] });
    mocks.submit.mockResolvedValue({
      status: 'ok',
      projection: {
        ...projection,
        status: 'completed',
        canCancel: false,
      },
    });
    const hook = renderHook(() =>
      useActestraGeneralWork('conversation-file-journey'),
    );
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalled();
    });

    await act(async () => {
      await hook.result.current.run(
        'Review the reserved workspace text',
        'workspace-file-artifact',
      );
    });

    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
      contractVersion: 1,
      nativeConversationId: 'conversation-file-journey',
      submissionId: expect.stringMatching(/^submission-aionui-/u),
      prompt: 'Review the reserved workspace text',
      journeyKind: 'workspace-file-artifact',
    });
  });

  it('submits the local-research command as a closed local-research journey', async () => {
    mocks.list.mockResolvedValue({ status: 'ok', projections: [] });
    mocks.submit.mockResolvedValue({
      status: 'ok',
      projection: {
        ...projection,
        status: 'completed',
        canCancel: false,
      },
    });
    const hook = renderHook(() =>
      useActestraGeneralWork('conversation-local-research-journey'),
    );
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalled();
    });

    await act(async () => {
      await hook.result.current.run(
        'Compare the approved local source notes',
        'local-research-artifact',
      );
    });

    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
      contractVersion: 1,
      nativeConversationId: 'conversation-local-research-journey',
      submissionId: expect.stringMatching(/^submission-aionui-/u),
      prompt: 'Compare the approved local source notes',
      journeyKind: 'local-research-artifact',
    });
  });

  it('updates one stable native task tip instead of appending every poll', async () => {
    mocks.list.mockResolvedValue({
      status: 'ok',
      projections: [
        {
          ...projection,
          status: 'completed',
          canCancel: false,
        },
      ],
    });
    renderHook(() => useActestraGeneralWork('conversation-stable'));

    await waitFor(() => {
      expect(mocks.addOrUpdateMessage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          msg_id: \`actestra-general-work-\${projection.taskId}\`,
          conversation_id: 'conversation-stable',
        }),
      );
    });
  });

  it('retains an active task across a transient projection read failure', async () => {
    mocks.list
      .mockResolvedValueOnce({ status: 'ok', projections: [projection] })
      .mockResolvedValue({
        status: 'rejected',
        code: 'persistence-unavailable',
      });
    const hook = renderHook(() =>
      useActestraGeneralWork('conversation-transient-failure'),
    );
    await waitFor(() => {
      expect(hook.result.current.hasActive).toBe(true);
    });

    await act(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 550);
        }),
    );

    expect(hook.result.current.hasActive).toBe(true);
    expect(mocks.messageError).toHaveBeenCalledExactlyOnceWith(
      'Actestra general work unavailable (persistence-unavailable)',
    );
  });

  it('queues cancellation while submit is still resolving its authoritative task', async () => {
    mocks.list.mockResolvedValue({ status: 'ok', projections: [] });
    let resolveSubmit!: (value: unknown) => void;
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    mocks.cancel.mockResolvedValue({
      status: 'ok',
      projection: {
        ...projection,
        status: 'cancelled',
        canCancel: false,
      },
    });
    const hook = renderHook(() =>
      useActestraGeneralWork('conversation-pending-submit'),
    );
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalled();
    });

    let run!: Promise<void>;
    act(() => {
      run = hook.result.current.run('Cancel this task during submit');
    });
    await waitFor(() => {
      expect(hook.result.current.hasActive).toBe(true);
    });
    await act(async () => {
      await hook.result.current.cancel();
    });
    expect(mocks.cancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveSubmit({ status: 'ok', projection });
      await run;
    });
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      contractVersion: 1,
      nativeConversationId: 'conversation-pending-submit',
      taskId: projection.taskId,
      reason: 'User stopped the task from the preserved AionUI SendBox.',
    });
    expect(hook.result.current.hasActive).toBe(false);
  });

  it('does not project a stale submit response into a newly selected conversation', async () => {
    mocks.list.mockResolvedValue({ status: 'ok', projections: [] });
    let resolveSubmit!: (value: unknown) => void;
    mocks.submit.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const hook = renderHook(
      ({ conversationId }) => useActestraGeneralWork(conversationId),
      {
        initialProps: { conversationId: 'conversation-old' },
      },
    );
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledWith({
        contractVersion: 1,
        nativeConversationId: 'conversation-old',
        limit: 100,
      });
    });

    let run!: Promise<void>;
    act(() => {
      run = hook.result.current.run('Old conversation task');
    });
    await waitFor(() => {
      expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
        contractVersion: 1,
        nativeConversationId: 'conversation-old',
        submissionId: expect.stringMatching(/^submission-aionui-/u),
        prompt: 'Old conversation task',
      });
    });

    hook.rerender({ conversationId: 'conversation-new' });
    await waitFor(() => {
      expect(mocks.list).toHaveBeenCalledWith({
        contractVersion: 1,
        nativeConversationId: 'conversation-new',
        limit: 100,
      });
    });
    await act(async () => {
      resolveSubmit({ status: 'ok', projection });
      await run;
    });

    expect(hook.result.current.hasActive).toBe(false);
    expect(mocks.addOrUpdateMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conversation-old' }),
    );
  });
});
`,
);

writeNew(
  "tests/unit/actestra/generalWorkNativeConversationReader.test.ts",
  `// @vitest-environment node

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AionUiGeneralWorkNativeContextResolver } from '@/actestra/main/compatibility/aionuiGeneralWorkNativeContext';
import { LoopbackAionUiGeneralWorkNativeConversationReader } from '@/process/services/actestraGeneralWorkNativeConversationReader';

const servers: http.Server[] = [];

async function listen(handler: http.RequestListener): Promise<void> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected an ephemeral loopback port');
  }
  (
    globalThis as typeof globalThis & { __backendPort?: number }
  ).__backendPort = address.port;
}

afterEach(async () => {
  delete (
    globalThis as typeof globalThis & { __backendPort?: number }
  ).__backendPort;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Actestra AionUI native conversation reader', () => {
  it('reads one encoded loopback conversation and projects only workspace context', async () => {
    let requestUrl = '';
    await listen((request, response) => {
      requestUrl = request.url ?? '';
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: {
            id: 'conversation/native',
            name: 'Native project',
            extra: {
              workspace: process.cwd(),
              backend: 'gemini',
            },
            model: {
              id: 'must-not-cross-the-boundary',
            },
          },
        }),
      );
    });
    const resolver = new AionUiGeneralWorkNativeContextResolver(
      new LoopbackAionUiGeneralWorkNativeConversationReader(),
    );

    await expect(resolver.resolve('conversation/native')).resolves.toEqual({
      rootPath: process.cwd(),
      displayName: 'Native project',
    });
    expect(requestUrl).toBe('/api/conversations/conversation%2Fnative');
  });

  it('rejects an oversized native response and a missing runtime port', async () => {
    await listen((_request, response) => {
      response.statusCode = 200;
      response.end('x'.repeat(65_537));
    });
    const reader = new LoopbackAionUiGeneralWorkNativeConversationReader();
    await expect(reader.read('conversation-native')).rejects.toThrow(
      /exceeded the size limit/u,
    );

    delete (
      globalThis as typeof globalThis & { __backendPort?: number }
    ).__backendPort;
    await expect(reader.read('conversation-native')).rejects.toThrow(
      /ready loopback runtime/u,
    );
  });

  it('rejects invalid UTF-8 before parsing native conversation JSON', async () => {
    await listen((_request, response) => {
      response.statusCode = 200;
      response.end(Buffer.from([0xff]));
    });
    await expect(
      new LoopbackAionUiGeneralWorkNativeConversationReader().read(
        'conversation-native',
      ),
    ).rejects.toThrow(/invalid UTF-8/u);
  });
});
`,
);

writeNew(
  "tests/unit/actestra/generalWorkArtifactActions.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMessageTips } from '@/common/chat/chatLib';

const mocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
  preview: vi.fn(),
}));

vi.mock('@/common/adapter/actestraGeneralWorkClient', () => ({
  previewActestraGeneralWork: mocks.preview,
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    openPreview: mocks.openPreview,
  }),
}));

import ActestraGeneralWorkArtifactActions from '@/renderer/pages/conversation/Messages/components/ActestraGeneralWorkArtifactActions';

const message = {
  id: 'actestra-general-work-task-native',
  msg_id: 'actestra-general-work-task-native',
  conversation_id: 'conversation-native',
  type: 'tips',
  content: {
    content: 'Actestra · completed',
    type: 'success',
    code: 'ACTESTRA_GENERAL_WORK_COMPLETED',
    params: {
      actestraGeneralWork: {
        contractVersion: 1,
        taskId: 'task-native',
        artifacts: [
          {
            artifactId: 'artifact-native',
            label: 'Actestra result',
            state: 'available',
          },
        ],
      },
    },
  },
} as IMessageTips;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Actestra artifact actions in preserved AionUI messages', () => {
  it('opens a non-persisted native Preview through the typed authority bridge', async () => {
    mocks.preview.mockResolvedValue({
      status: 'ok',
      preview: {
        contractVersion: 1,
        taskId: 'task-native',
        artifactId: 'artifact-native',
        label: 'Actestra result',
        mediaType: 'text/markdown; charset=utf-8',
        content: '# Result',
      },
    });
    render(<ActestraGeneralWorkArtifactActions message={message} />);

    fireEvent.click(screen.getByRole('button', { name: 'Preview Actestra result' }));

    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith({
      contractVersion: 1,
      nativeConversationId: 'conversation-native',
      taskId: 'task-native',
      artifactId: 'artifact-native',
    });
    await waitFor(() => {
      expect(mocks.openPreview).toHaveBeenCalledExactlyOnceWith(
        '# Result',
        'markdown',
        {
          title: 'Actestra result',
          editable: false,
          persist: false,
        },
      );
    });
    expect(JSON.stringify(mocks.preview.mock.calls[0])).not.toMatch(
      /workspace|contentRef|sessionId|workerId/u,
    );
  });

  it('renders no action for an unavailable or untyped artifact', () => {
    render(
      <ActestraGeneralWorkArtifactActions
        message={{
          ...message,
          content: {
            ...message.content,
            params: {
              actestraGeneralWork: {
                contractVersion: 1,
                taskId: 'task-native',
                artifacts: [
                  {
                    artifactId: 'artifact-native',
                    label: 'Actestra result',
                    state: 'pending',
                  },
                ],
              },
            },
          },
        }}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
`,
);

writeNew(
  "tests/unit/actestra/generalWorkClient.dom.test.ts",
  `// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listActestraGeneralWork,
  previewActestraGeneralWork,
  submitActestraGeneralWork,
} from '@/common/adapter/actestraGeneralWorkClient';
import {
  extractActestraGeneralWorkIntent,
  extractActestraGeneralWorkPrompt,
  projectActestraGeneralWorkMessage,
} from '@/renderer/hooks/chat/actestraGeneralWorkProjection';

const projection = {
  contractVersion: 1,
  taskId: 'task-native-preserved-journey',
  status: 'completed',
  title: 'Run one preserved AionUI journey.',
  summary: 'The supervised General Worker completed.',
  canCancel: false,
  createdAt: '2026-07-30T07:10:00.000Z',
  updatedAt: '2026-07-30T07:10:01.000Z',
  artifacts: [
    {
      artifactId: 'artifact-native-preserved-journey',
      kind: 'file',
      label: 'Bounded task output',
      state: 'available',
    },
  ],
} as const;

afterEach(() => {
  delete window.actestraGeneralWork;
});

describe('Actestra preserved AionUI general-work client', () => {
  it('uses only the typed preload bridge and projects redacted native messages', async () => {
    window.actestraGeneralWork = {
      submit: vi.fn(async () => ({ status: 'ok', projection })),
      list: vi.fn(async () => ({ status: 'ok', projections: [projection] })),
      cancel: vi.fn(async () => ({ status: 'ok', projection })),
      preview: vi.fn(async () => ({
        status: 'ok',
        preview: {
          contractVersion: 1,
          taskId: projection.taskId,
          artifactId: projection.artifacts[0].artifactId,
          label: projection.artifacts[0].label,
          mediaType: 'text/markdown; charset=utf-8',
          content: '# Result',
        },
      })),
    };

    await expect(
      submitActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: 'conversation-native-preserved-journey',
        submissionId: 'submission-native-preserved-journey',
        prompt: projection.title,
      }),
    ).resolves.toEqual({ status: 'ok', projection });
    await expect(
      listActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: 'conversation-native-preserved-journey',
        limit: 100,
      }),
    ).resolves.toEqual({ status: 'ok', projections: [projection] });
    await expect(
      previewActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: 'conversation-native-preserved-journey',
        taskId: projection.taskId,
        artifactId: projection.artifacts[0].artifactId,
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      preview: {
        content: '# Result',
      },
    });

    const message = projectActestraGeneralWorkMessage(
      'conversation-native-preserved-journey',
      projection,
    );
    expect(message).toMatchObject({
      msg_id: 'actestra-general-work-task-native-preserved-journey',
      conversation_id: 'conversation-native-preserved-journey',
      type: 'tips',
      position: 'center',
      content: {
        type: 'success',
        content: expect.stringContaining('Bounded task output'),
        params: {
          actestraGeneralWork: {
            contractVersion: 1,
            taskId: projection.taskId,
            artifacts: [
              {
                artifactId: projection.artifacts[0].artifactId,
                label: projection.artifacts[0].label,
                state: 'available',
              },
            ],
          },
        },
      },
    });
    expect(JSON.stringify(message)).not.toMatch(/workspaceRoot|contentRef|sessionId|workerId/u);
    expect(extractActestraGeneralWorkPrompt('/actestra inspect the bounded task')).toBe(
      'inspect the bounded task',
    );
    expect(
      extractActestraGeneralWorkIntent(
        '/actestra file review the reserved workspace text',
      ),
    ).toEqual({
      prompt: 'review the reserved workspace text',
      journeyKind: 'workspace-file-artifact',
    });
    expect(
      extractActestraGeneralWorkIntent(
        '/actestra research compare the approved local source notes',
      ),
    ).toEqual({
      prompt: 'compare the approved local source notes',
      journeyKind: 'local-research-artifact',
    });
    expect(extractActestraGeneralWorkPrompt('ordinary native AionUI message')).toBeNull();
  });

  it('fails closed when main returns authority-bearing projection fields', async () => {
    window.actestraGeneralWork = {
      submit: vi.fn(async () => ({
        status: 'ok',
        projection: {
          ...projection,
          workspaceRoot: '/private/workspace',
        },
      })),
      list: vi.fn(async () => ({ status: 'ok', projections: [] })),
      cancel: vi.fn(async () => ({ status: 'ok', projection })),
      preview: vi.fn(async () => ({
        status: 'rejected',
        code: 'task-not-owned',
      })),
    };

    await expect(
      submitActestraGeneralWork({
        contractVersion: 1,
        nativeConversationId: 'conversation-native-preserved-journey',
        submissionId: 'submission-native-preserved-journey',
        prompt: projection.title,
      }),
    ).resolves.toEqual({
      status: 'rejected',
      code: 'execution-failed',
    });
  });
});
`,
);
