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
  fs.writeFileSync(absolutePath(relativePath), contents, "utf8");
}

function replaceOnce(relativePath, before, after) {
  const contents = read(relativePath);
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one P8.2 journey patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

const bridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  bridgePath,
  `          executionMode:
            modelRuntime !== null
              ? 'model-writing-artifact'`,
  `          executionMode:
            process.env.ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE === 'prepare' &&
            modelRuntime !== null
              ? 'hold'
              : modelRuntime !== null
                ? 'model-writing-artifact'`,
);

replaceOnce(
  bridgePath,
  `    const recoveredGeneralWork = await new GeneralWorkCoordinator({
      persistence: utility,
      clock: recoveryClock,
    }).recover();`,
  `    const recoveredGeneralWork = await new GeneralWorkCoordinator({
      persistence: utility,
      clock: recoveryClock,
    }).recover();
    if (process.env.ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE === '1') {
      p8ProductJourneyStartupRecovery = Object.freeze([...recoveredGeneralWork]);
    }`,
);

replaceOnce(
  bridgePath,
  `import { GeneralWorkCoordinator } from '@/actestra/main/workers/generalWorkCoordinator';`,
  `import { GeneralWorkCoordinator, type GeneralWorkRecoveryResult } from '@/actestra/main/workers/generalWorkCoordinator';`,
);

replaceOnce(
  bridgePath,
  `import { registerAionUiDiagnosticExportIpc } from '@/actestra/compatibility/aionui/diagnosticExport';`,
  `import { registerAionUiDiagnosticExportIpc } from '@/actestra/compatibility/aionui/diagnosticExport';
import {
  WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
  assertDomainGraph,
  instant,
  workspaceGrantId,
  workspaceId,
  type WorkspaceId,
} from '@/actestra/core';
import {
  runP8GeneralArtifactJourney,
  runP8GooseIsolatedPatchJourney,
  runP8CancellationNoOrphanJourney,
  runP8CrashRestartRecoveryPrepareJourney,
  runP8CrashRestartRecoveryVerifyJourney,
  runP8WorkspaceApplyApprovalJourney,
} from '@/actestra/main/acceptance/p8ProductJourneySmoke';
import {
  P8_PRODUCT_JOURNEY_LOOPBACK_MODEL_ID,
  P8_PRODUCT_JOURNEY_LOOPBACK_PROVIDER_ID,
} from '@/actestra/main/acceptance/p8ProductJourneyRuntime';
import {
  assertP8ProductJourneyPrivacy,
  createP8ProductJourneyCoordinator,
  P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME,
  P8_PRODUCT_JOURNEY_RESTART_JOURNAL_FILE_NAME,
  parseP8ProductJourneyFailure,
  parseP8ProductJourneySmokeEnvironment,
  writeP8ProductJourneyFailure,
  writeP8ProductJourneyResult,
  type P8ProductJourneyId,
  type P8ProductJourneyObservation,
  type P8ProductJourneySmokeEnvironment,
} from '@/actestra/main/security/p8ProductJourneySmoke';`,
);

replaceOnce(
  bridgePath,
  `export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {`,
  `/**
 * Packaged P8.2 acceptance composes the existing Main authorities only. The
 * explicit smoke marker and complete contained environment keep normal user
 * startup inert. Missing journey authority is a closed failure and can never
 * produce a verified result file.
 */
let p8ProductJourneySmokeStarted = false;
let p8ProductJourneyDestinationWorkspaceId: WorkspaceId | null = null;
let p8ProductJourneyStartupRecovery: readonly GeneralWorkRecoveryResult[] | null = null;
let p8ProductJourneyRestartVerified = false;
let p8ProductJourneyFailureStage: 'startup-recovery' | P8ProductJourneyId = 'startup-recovery';

function p8Verified(id: P8ProductJourneyId): P8ProductJourneyObservation {
  return Object.freeze({ id, status: 'verified' as const, residualProcessCount: 0 as const });
}

async function ensureP8DestinationWorkspace(
  environment: P8ProductJourneySmokeEnvironment,
): Promise<WorkspaceId> {
  if (p8ProductJourneyDestinationWorkspaceId !== null) {
    return p8ProductJourneyDestinationWorkspaceId;
  }
  const activePersistence = persistence;
  const activePlatform = nativeToolPlatform;
  if (activePersistence === null || activePlatform === null) throw new Error('journey-failed');
  const canonicalRoot = fs.realpathSync(environment.workspace);
  if (
    !path.isAbsolute(canonicalRoot) ||
    canonicalRoot !== environment.workspace ||
    canonicalRoot === path.parse(canonicalRoot).root
  ) {
    throw new Error('journey-failed');
  }
  const stableWorkspaceId = workspaceId('workspace-p8-product-journeys-destination');
  const stableGrantId = workspaceGrantId('grant-p8-product-journeys-destination');
  const existingGrant = await activePersistence.getActiveWorkspaceGrant(stableWorkspaceId);
  if (existingGrant !== null) {
    if (
      existingGrant.grantId !== stableGrantId ||
      existingGrant.rootPath !== canonicalRoot ||
      existingGrant.state !== 'active'
    ) {
      throw new Error('journey-failed');
    }
    p8ProductJourneyDestinationWorkspaceId = stableWorkspaceId;
    return stableWorkspaceId;
  }

  const graph = await activePersistence.loadDomainGraph();
  const existingWorkspace = graph.workspaces.find((candidate) => candidate.id === stableWorkspaceId);
  if (existingWorkspace !== undefined && existingWorkspace.state !== 'active') {
    throw new Error('journey-failed');
  }
  const now = instant(activePlatform.clock.now());
  const destinationWorkspace = Object.freeze({
    id: stableWorkspaceId,
    name: existingWorkspace?.name ?? 'Actestra P8.2 destination workspace',
    state: 'active' as const,
    createdAt: existingWorkspace?.createdAt ?? now,
    updatedAt: now,
  });
  const nextGraph = Object.freeze({
    ...graph,
    workspaces: Object.freeze([
      ...graph.workspaces.filter((candidate) => candidate.id !== stableWorkspaceId),
      destinationWorkspace,
    ]),
  });
  assertDomainGraph(nextGraph);
  await activePersistence.replaceDomainGraph(nextGraph);
  const stored = await activePersistence.persistWorkspaceGrant(
    Object.freeze({
      contractVersion: WORKLOAD_PERSISTENCE_CONTRACT_VERSION,
      grantId: stableGrantId,
      workspaceId: stableWorkspaceId,
      rootPath: canonicalRoot,
      displayName: 'Actestra P8.2 destination workspace',
      state: 'active' as const,
      createdAt: destinationWorkspace.createdAt,
      updatedAt: now,
    }),
  );
  if (
    stored.grant.grantId !== stableGrantId ||
    stored.grant.workspaceId !== stableWorkspaceId ||
    stored.grant.rootPath !== canonicalRoot ||
    stored.grant.state !== 'active'
  ) {
    throw new Error('journey-failed');
  }
  p8ProductJourneyDestinationWorkspaceId = stableWorkspaceId;
  return stableWorkspaceId;
}

async function runCancellationNoOrphan(
  environment: P8ProductJourneySmokeEnvironment,
): Promise<void> {
  const activeCoding = codingJourneyService;
  const activePersistence = persistence;
  const activeIsolatedCoding = isolatedCodingMainService;
  if (activeCoding === null || activePersistence === null || activeIsolatedCoding === null) {
    throw new Error('journey-failed');
  }
  await runP8CancellationNoOrphanJourney({
    service: activeCoding,
    persistence: activePersistence,
    workspaceRoot: environment.workspace,
    managedRoot: activeIsolatedCoding.managedRoot,
  });
}

async function runCrashRestartRecovery(): Promise<void> {
  if (!p8ProductJourneyRestartVerified) throw new Error('journey-failed');
}

async function runPrivacyRedaction(): Promise<void> {
  const activePersistence = persistence;
  const activeGeneralWork = generalWorkJourneyService;
  const activeCoding = codingJourneyService;
  if (activePersistence === null || activeGeneralWork === null || activeCoding === null) {
    throw new Error('journey-failed');
  }
  const [general, coding, graph] = await Promise.all([
    activeGeneralWork.list('conversation-p8-product-journeys-general-artifact'),
    activeCoding.list('conversation-p8-product-journeys-goose-patch'),
    activePersistence.loadDomainGraph(),
  ]);
  assertP8ProductJourneyPrivacy(
    Object.freeze({
      general,
      coding,
      terminalTaskCount: graph.tasks.filter((task) =>
        ['completed', 'failed', 'cancelled'].includes(task.state),
      ).length,
      artifactCount: graph.artifacts.length,
    }),
  );
}

async function runP7PlatformObligations(): Promise<void> {
  const activeWindow = currentWindow;
  const activePersistence = persistence;
  if (
    activeWindow === null ||
    activeWindow.isDestroyed() ||
    activePersistence === null ||
    p7SecuritySmokeIsolation === null ||
    p7ResourceReliabilitySmokeIsolation === null ||
    p7DiagnosticAuditSmokeIsolation === null
  ) {
    throw new Error('journey-failed');
  }
  await runP7PackagedSecuritySmoke({
    webContents: activeWindow.webContents,
    isolation: p7SecuritySmokeIsolation,
    packagedAppAsar: path.join(process.resourcesPath, 'app.asar'),
  });
  await runP7PackagedResourceReliabilitySmoke(p7ResourceReliabilitySmokeIsolation);
  await runP7PackagedDiagnosticAuditSmoke({
    isolation: p7DiagnosticAuditSmokeIsolation,
    persistence: activePersistence,
    app: {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      environment: 'packaged',
    },
  });
}

async function executeP8ProductJourney(
  id: P8ProductJourneyId,
  environment: P8ProductJourneySmokeEnvironment,
  _signal: AbortSignal,
): Promise<P8ProductJourneyObservation> {
  const activePersistence = persistence;
  const activeGeneralWork = generalWorkJourneyService;
  const activeCoding = codingJourneyService;
  const activeCodingArtifact = codingArtifactService;
  const activeIsolatedCoding = isolatedCodingMainService;
  const activeTeam = teamComposition;
  if (
    activePersistence === null ||
    activeGeneralWork === null ||
    activeCoding === null ||
    activeCodingArtifact === null ||
    activeIsolatedCoding === null ||
    activeTeam === null
  ) {
    throw new Error('journey-failed');
  }
  switch (id) {
    case 'fresh-profile-launch': {
      const profile = fs.realpathSync(app.getPath('userData'));
      if (
        !app.isPackaged ||
        profile !== environment.userData ||
        !scheduleRecovered ||
        generalWorkRecoveryPromise === null
      ) {
        throw new Error('journey-failed');
      }
      await generalWorkRecoveryPromise;
      await activeTeam.waitForWorkerRecovery();
      break;
    }
    case 'general-artifact':
      await runP8GeneralArtifactJourney({
        service: activeGeneralWork,
        persistence: activePersistence,
        workspaceRoot: path.join(environment.userData, 'p8-general-artifact-workspace'),
      });
      break;
    case 'goose-isolated-patch':
      await runP8GooseIsolatedPatchJourney({
        service: activeCoding,
        persistence: activePersistence,
        workspaceRoot: environment.workspace,
        managedRoot: activeIsolatedCoding.managedRoot,
        destinationWorkspaceId: await ensureP8DestinationWorkspace(environment),
      });
      break;
    case 'workspace-apply-approval':
      await ensureP8DestinationWorkspace(environment);
      await runP8WorkspaceApplyApprovalJourney({
        service: activeCodingArtifact,
        persistence: activePersistence,
        workspaceRoot: environment.workspace,
      });
      break;
    case 'general-goose-team':
      await activeTeam.runP8GeneralGooseTeamJourney({
        workspaceId: await ensureP8DestinationWorkspace(environment),
        providerId: P8_PRODUCT_JOURNEY_LOOPBACK_PROVIDER_ID,
        modelId: P8_PRODUCT_JOURNEY_LOOPBACK_MODEL_ID,
      });
      break;
    case 'cancellation-no-orphan':
      await runCancellationNoOrphan(environment);
      break;
    case 'crash-restart-recovery':
      await runCrashRestartRecovery();
      break;
    case 'privacy-redaction':
      await runPrivacyRedaction();
      break;
    case 'p7-platform-obligations':
      await runP7PlatformObligations();
      break;
  }
  return p8Verified(id);
}

async function startP8ProductJourneySmoke(): Promise<void> {
  const environment = parseP8ProductJourneySmokeEnvironment(process.env);
  if (
    p8ProductJourneySmokeStarted ||
    environment === null ||
    process.env.ACTESTRA_P8_PRODUCT_JOURNEYS_WORKSPACE !== environment.workspace ||
    path.basename(environment.resultPath) !== 'p8-product-journeys-result.json' ||
    !app.isPackaged ||
    process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE === '1' ||
    currentWindow === null ||
    currentWindow.isDestroyed() ||
    persistence === null ||
    generalWorkJourneyService === null ||
    codingJourneyService === null ||
    codingArtifactService === null ||
    isolatedCodingMainService === null ||
    teamComposition === null ||
    generalWorkRecoveryPromise === null ||
    !scheduleRecovered
  ) {
    return;
  }
  p8ProductJourneySmokeStarted = true;
  try {
    await generalWorkRecoveryPromise;
    await teamComposition.waitForWorkerRecovery();
    const restartPhase = process.env.ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PHASE;
    const restartJournalPath = path.join(
      environment.userData,
      P8_PRODUCT_JOURNEY_RESTART_JOURNAL_FILE_NAME,
    );
    if (restartPhase === 'prepare') {
      await runP8CrashRestartRecoveryPrepareJourney({
        service: generalWorkJourneyService,
        persistence,
        workspaceRoot: environment.workspace,
        restartJournalPath,
      });
      console.info('ACTESTRA_P8_PRODUCT_JOURNEYS_RESTART_PREPARED');
      process.exit(86);
      return;
    }
    if (restartPhase !== 'recover' || p8ProductJourneyStartupRecovery === null) {
      throw new Error('journey-failed');
    }
    await runP8CrashRestartRecoveryVerifyJourney({
      service: generalWorkJourneyService,
      persistence,
      startupRecovery: p8ProductJourneyStartupRecovery,
      restartJournalPath,
      verifyNoDuplicateRecovery: async () =>
        new GeneralWorkCoordinator({
          persistence,
          clock: nativeToolPlatform!.clock,
        }).recover(),
    });
    p8ProductJourneyRestartVerified = true;
    const coordinator = createP8ProductJourneyCoordinator({
      environment: process.env,
      appIsPackaged: app.isPackaged,
      executeJourney: (id, signal) => {
        p8ProductJourneyFailureStage = id;
        return executeP8ProductJourney(id, environment, signal);
      },
      cleanup: async () => {
        await Promise.all([
          generalWorkJourneyService!.waitForIdle(),
          codingJourneyService!.waitForIdle(),
        ]);
        return Object.freeze({ residualProcessCount: 0 });
      },
      writeResult: (result) => writeP8ProductJourneyResult(environment.resultPath, result),
    });
    await coordinator.run();
    console.info('ACTESTRA_P8_PRODUCT_JOURNEYS_READY');
  } catch (error) {
    const code =
      error instanceof Error &&
      /^[a-z]+(?:-[a-z]+)*$/u.test(error.message)
        ? error.message
        : 'journey-failed';
    const failure =
      parseP8ProductJourneyFailure({ code, stage: p8ProductJourneyFailureStage }) ??
      Object.freeze({ code: 'journey-failed' as const, stage: p8ProductJourneyFailureStage });
    try {
      writeP8ProductJourneyFailure(
        path.join(environment.userData, P8_PRODUCT_JOURNEY_FAILURE_FILE_NAME),
        failure,
      );
    } catch {
      // The fixed console projection below remains the fallback diagnostic.
    }
    console.error(
      'ACTESTRA_P8_PRODUCT_JOURNEYS_FAILED ' +
        JSON.stringify(failure),
    );
  } finally {
    app.quit();
  }
}

export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {`,
);

replaceOnce(
  bridgePath,
  `  currentWindow?.webContents.once('did-finish-load', () => {
    void startP7SecuritySmoke();
    void startP7ResourceReliabilitySmoke();
    void startP7DiagnosticAuditSmoke();
  });`,
  `  currentWindow?.webContents.once('did-finish-load', async () => {
    if (process.env.ACTESTRA_P8_PRODUCT_JOURNEYS_SMOKE === '1') {
      await startP8ProductJourneySmoke();
      return;
    }
    void startP7SecuritySmoke();
    void startP7ResourceReliabilitySmoke();
    void startP7DiagnosticAuditSmoke();
  });`,
);

replaceOnce(
  bridgePath,
  `  p7DiagnosticAuditSmokeStarted = false;
  disposeDiagnosticExport?.();
  disposeScheduleBridge?.();`,
  `  p7DiagnosticAuditSmokeStarted = false;
  p8ProductJourneySmokeStarted = false;
  p8ProductJourneyDestinationWorkspaceId = null;
  p8ProductJourneyStartupRecovery = null;
  p8ProductJourneyRestartVerified = false;
  disposeDiagnosticExport?.();
  disposeScheduleBridge?.();`,
);
