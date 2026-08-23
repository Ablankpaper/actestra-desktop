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
          '  while (Date.now() < deadline) {',
          '    const header = document.querySelector(\\\'[data-testid="model-header"]\\\');',
          '    const emptyState = document.querySelector(\\\'[data-testid="actestra-provider-unavailable"]\\\');',
          '    if (header && emptyState && (emptyState.textContent ?? "").trim().length > 0) {',
          "      return { providerCount: 0, providerUiState: 'provider-unavailable', providerUiTextPresent: true };",
          '    }',
          '    await new Promise((resolve) => setTimeout(resolve, 50));',
          '  }',
          "  throw new Error('provider-ui-state-missing');",
          '})()',
        ].join('\\n');
        void mainWindow.webContents
          .executeJavaScript(freshProfileProbe, true)
          .then((evidence: unknown) => {
            if (
              !evidence ||
              typeof evidence !== 'object' ||
              !('providerCount' in evidence) ||
              evidence.providerCount !== 0 ||
              !('providerUiState' in evidence) ||
              evidence.providerUiState !== 'provider-unavailable' ||
              !('providerUiTextPresent' in evidence) ||
              evidence.providerUiTextPresent !== true
            ) {
              throw new Error('provider-ui-evidence-invalid');
            }
            console.info('ACTESTRA_P8_FRESH_PROFILE_READY ' + JSON.stringify({
              providerCount: 0,
              providerUiState: 'provider-unavailable',
              providerUiTextPresent: true,
            }));
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
                'provider-ui-state-missing',
                'provider-ui-evidence-invalid',
              ].includes(error.message)
                ? error.message
                : 'provider-ui-evidence-invalid';
            console.error('ACTESTRA_P8_FRESH_PROFILE_FAILED ' + code);
            app.exit(1);
          });
      } else if (process.env.ACTESTRA_E2E_TEST === '1') {
        const providerProbe = [`,
);
