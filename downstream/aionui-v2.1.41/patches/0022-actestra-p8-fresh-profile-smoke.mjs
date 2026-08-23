import fs from "node:fs";
import path from "node:path";

const outputRoot = path.resolve(process.argv[2] ?? "");
if (path.basename(outputRoot) !== "aionui-v2.1.41") {
  throw new Error(`Expected a materialized aionui-v2.1.41 tree, received ${outputRoot}`);
}

function replaceOnce(relativePath, before, after) {
  const filePath = path.join(outputRoot, relativePath);
  const contents = fs.readFileSync(filePath, "utf8");
  const first = contents.indexOf(before);
  if (first === -1 || contents.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Expected exactly one P8.2d patch context in ${relativePath}`);
  }
  fs.writeFileSync(
    filePath,
    contents.slice(0, first) + after + contents.slice(first + before.length),
    "utf8",
  );
}

replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx",
  `<div className='flex flex-col items-center justify-center py-40px'>
            <Info theme='outline' size='48' className='text-t-secondary mb-16px' />`,
  `<div
            className='flex flex-col items-center justify-center py-40px'
            data-testid='actestra-provider-unavailable'
          >
            <Info theme='outline' size='48' className='text-t-secondary mb-16px' />`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `const isActestraE2ETest =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';`,
  `const isActestraE2ETest =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';

const writeFreshProfileBootstrapStage = (stage: string): void => {
  if (process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE !== '1') return;
  const userData = process.env.ACTESTRA_USER_DATA_DIR?.trim();
  if (!userData || ![
    'bootstrap-isolation',
    'bootstrap-home',
    'bootstrap-temp',
    'bootstrap-app-data',
    'bootstrap-name',
    'bootstrap-directories',
    'bootstrap-user-data',
    'bootstrap-session-data',
    'bootstrap-logs',
    'bootstrap-crash-dumps',
    'bootstrap-complete',
  ].includes(stage)) return;
  try {
    const stagePath = path.join(userData, 'p8-fresh-profile-stage-' + stage + '.json');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(stagePath, JSON.stringify({ status: 'running', stage }) + '\\n', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch {
    // A later write-once stage or bounded terminal marker remains the fallback.
  }
};`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `    throw new Error('Actestra E2E runtime paths escaped their real isolated root');
  }
  app.setPath('home', actestraE2EHomeDir);
  app.setPath('temp', actestraE2ETempDir);`,
  `    throw new Error('Actestra E2E runtime paths escaped their real isolated root');
  }
  writeFreshProfileBootstrapStage('bootstrap-isolation');
  app.setPath('home', actestraE2EHomeDir);
  writeFreshProfileBootstrapStage('bootstrap-home');
  app.setPath('temp', actestraE2ETempDir);
  writeFreshProfileBootstrapStage('bootstrap-temp');`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `const actestraUserDataDir = resolveActestraUserDataPath({
  appDataRoot: app.getPath('appData'),`,
  `const actestraAppDataRoot = explicitUserDataDir?.trim()
  ? path.dirname(path.resolve(explicitUserDataDir))
  : undefined;
if (actestraAppDataRoot) app.setPath('appData', actestraAppDataRoot);
const resolvedActestraAppDataRoot = app.getPath('appData');
writeFreshProfileBootstrapStage('bootstrap-app-data');
const actestraUserDataDir = resolveActestraUserDataPath({
  appDataRoot: resolvedActestraAppDataRoot,`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `app.setName(ACTESTRA_PRODUCT.name);`,
  `app.setName(ACTESTRA_PRODUCT.name);
writeFreshProfileBootstrapStage('bootstrap-name');
`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `app.setPath('userData', actestraUserDataDir);`,
  `writeFreshProfileBootstrapStage('bootstrap-directories');
app.setPath('userData', actestraUserDataDir);
writeFreshProfileBootstrapStage('bootstrap-user-data');`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `app.setPath('sessionData', path.join(actestraUserDataDir, 'session'));`,
  `app.setPath('sessionData', path.join(actestraUserDataDir, 'session'));
writeFreshProfileBootstrapStage('bootstrap-session-data');`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `app.setPath('logs', path.join(actestraUserDataDir, 'logs'));`,
  `app.setPath('logs', path.join(actestraUserDataDir, 'logs'));
writeFreshProfileBootstrapStage('bootstrap-logs');`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `app.setPath('crashDumps', path.join(actestraUserDataDir, 'crash-dumps'));`,
  `app.setPath('crashDumps', path.join(actestraUserDataDir, 'crash-dumps'));
writeFreshProfileBootstrapStage('bootstrap-crash-dumps');`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `ensureActestraProfileLayout(actestraUserDataDir);`,
  `ensureActestraProfileLayout(actestraUserDataDir);
writeFreshProfileBootstrapStage('bootstrap-complete');`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `const handleAppReady = async (): Promise<void> => {`,
  `const writeFreshProfileStage = (stage: string): void => {
  if (process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE !== '1') return;
  const userData = process.env.ACTESTRA_USER_DATA_DIR?.trim();
  if (!userData || ![
    'app-ready',
    'initialize-start',
    'initialize-complete',
    'backend-start',
    'backend-ready',
    'window-created',
    'renderer-loaded',
    'renderer-probe-started',
  ].includes(stage)) return;
  try {
    const stagePath = path.join(userData, 'p8-fresh-profile-stage-' + stage + '.json');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(stagePath, JSON.stringify({ status: 'running', stage }) + '\\n', {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch {
    // A later write-once stage or bounded terminal marker remains the fallback.
  }
};

const handleAppReady = async (): Promise<void> => {`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  mark('start');

  if (!app.isPackaged`,
  `  mark('start');
  writeFreshProfileStage('app-ready');

  if (!app.isPackaged`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  try {
    await initializeProcess();`,
  `  try {
    writeFreshProfileStage('initialize-start');
    await initializeProcess();`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;
    mark('initializeProcess');`,
  `    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;
    writeFreshProfileStage('initialize-complete');
    mark('initializeProcess');`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `    const backendStartup = await startBackendOrExit({`,
  `    writeFreshProfileStage('backend-start');
    const backendStartup = await startBackendOrExit({`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `    createWindow({ showOnReady: showMainWindowOnReady });
    appReadyDone = true;`,
  `    createWindow({ showOnReady: showMainWindowOnReady });
    writeFreshProfileStage('window-created');
    appReadyDone = true;`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  exposeBackendPort(backendPort);
  backendStartedOk = true;`,
  `  exposeBackendPort(backendPort);
  writeFreshProfileStage('backend-ready');
  backendStartedOk = true;`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `      process.env.ACTESTRA_E2E_TEST === '1' &&
      process.env.ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO !== 'recover-worker-crash'`,
  `      process.env.ACTESTRA_E2E_TEST === '1' &&
      process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE !== '1' &&
      process.env.ACTESTRA_GENERAL_WORK_SMOKE_SCENARIO !== 'recover-worker-crash'`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `      if (process.env.ACTESTRA_E2E_TEST === '1') {
        const providerProbe = [`,
  `      if (process.env.ACTESTRA_P8_FRESH_PROFILE_SMOKE === '1') {
        writeFreshProfileStage('renderer-loaded');
        const freshProfileResultPath = path.join(
          app.getPath('userData'),
          'p8-fresh-profile-result.json',
        );
        const writeFreshProfileResult = (value: unknown) => {
          try {
            const temporaryPath = freshProfileResultPath + '.tmp';
            fs.writeFileSync(temporaryPath, JSON.stringify(value) + '\\n', {
              encoding: 'utf8',
              mode: 0o600,
            });
            fs.renameSync(temporaryPath, freshProfileResultPath);
          } catch {
            // stdout remains the compatibility fallback when file evidence is unavailable.
          }
        };
        writeFreshProfileStage('renderer-probe-started');
        const freshProfileProbe = [
          '(async () => {',
          '  const port = window.__backendPort;',
          "  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('backend-port-unavailable');",
          '  let directProviderFetchDenied = false;',
          "  try { await fetch('http://127.0.0.1:' + String(port) + '/api/providers'); } catch { directProviderFetchDenied = true; }",
          "  if (!directProviderFetchDenied) throw new Error('direct-provider-fetch-not-denied');",
          '  const listProviders = window.electronAPI?.actestraProviderList;',
          "  if (typeof listProviders !== 'function') throw new Error('provider-ipc-unavailable');",
          '  const providers = await listProviders();',
          "  if (!Array.isArray(providers) || providers.length !== 0) throw new Error('provider-projection-nonempty');",
          "  window.location.hash = '/settings/model';",
          '  const deadline = Date.now() + 15_000;',
          '  let routeReady = false;',
          '  let headerReady = false;',
          '  let emptyStateReady = false;',
          '  let emptyStateTextReady = false;',
          '  while (Date.now() < deadline) {',
          "    routeReady = window.location.hash.includes('/settings/model');",
          "    const header = document.querySelector('[data-testid=model-header]');",
          "    const emptyState = document.querySelector('[data-testid=actestra-provider-unavailable]');",
          '    headerReady = header !== null;',
          '    emptyStateReady = emptyState !== null;',
          '    emptyStateTextReady = (emptyState?.textContent ?? "").trim().length > 0;',
          '    if (routeReady && headerReady && emptyStateReady && emptyStateTextReady) {',
          "      return { providerCount: 0, providerUiState: 'provider-unavailable', providerUiTextPresent: true };",
          '    }',
          '    await new Promise((resolve) => setTimeout(resolve, 50));',
          '  }',
          "  if (!routeReady) throw new Error('provider-ui-route-missing');",
          "  if (!headerReady) throw new Error('provider-ui-header-missing');",
          "  if (!emptyStateReady) throw new Error('provider-ui-empty-state-missing');",
          "  if (!emptyStateTextReady) throw new Error('provider-ui-text-missing');",
          "  throw new Error('provider-ui-evidence-invalid');",
          '})()',
        ].join('\\n');
        void mainWindow.webContents
          .executeJavaScript(freshProfileProbe, true)
          .then((probeEvidence: unknown) => {
            if (
              !probeEvidence ||
              typeof probeEvidence !== 'object' ||
              !('providerCount' in probeEvidence) ||
              probeEvidence.providerCount !== 0 ||
              !('providerUiState' in probeEvidence) ||
              probeEvidence.providerUiState !== 'provider-unavailable' ||
              !('providerUiTextPresent' in probeEvidence) ||
              probeEvidence.providerUiTextPresent !== true
            ) {
              throw new Error('provider-ui-evidence-invalid');
            }
            const evidence = {
              providerCount: 0,
              providerUiState: 'provider-unavailable',
              providerUiTextPresent: true,
            };
            writeFreshProfileResult({ status: 'verified', ...evidence });
            console.info('ACTESTRA_P8_FRESH_PROFILE_READY ' + JSON.stringify(evidence));
            app.quit();
          })
          .catch((error: unknown) => {
            const code =
              error instanceof Error &&
              [
                'backend-port-unavailable',
                'direct-provider-fetch-not-denied',
                'provider-ipc-unavailable',
                'provider-projection-nonempty',
                'provider-ui-route-missing',
                'provider-ui-header-missing',
                'provider-ui-empty-state-missing',
                'provider-ui-text-missing',
                'provider-ui-evidence-invalid',
              ].includes(error.message)
                ? error.message
                : 'provider-ui-evidence-invalid';
            writeFreshProfileResult({ status: 'failed', code });
            console.error('ACTESTRA_P8_FRESH_PROFILE_FAILED ' + code);
            app.exit(1);
          });
      } else if (process.env.ACTESTRA_E2E_TEST === '1') {
        const providerProbe = [`,
);
