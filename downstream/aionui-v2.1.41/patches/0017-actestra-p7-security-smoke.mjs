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
    throw new Error(`Expected exactly one downstream patch context in ${relativePath}`);
  }
  write(relativePath, contents.slice(0, first) + after + contents.slice(first + before.length));
}

const bridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";
const providerBoundaryPath =
  "packages/desktop/src/actestra/main/compatibility/providerRendererBoundary.ts";
const providerBoundaryTestPath = "tests/unit/actestra/providerRendererBoundary.test.ts";

replaceOnce(
  "packages/desktop/src/index.ts",
  `import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor } from 'electron';`,
  `import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, session } from 'electron';`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';`,
  `import { runGeneralWorkerProbe } from './actestra/main/workers/generalWorkerProbe';
import { installWebviewGuestSecurity } from './actestra/main/security/p7SecuritySmoke';`,
);

replaceOnce(
  providerBoundaryPath,
  `export function installActestraProviderRendererBoundary(
  options: ActestraProviderRendererBoundaryOptions,
): void {
  options.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, callback) => {
    callback({
      cancel: isActestraProviderRecordRequest({
        backendPort: options.backendPort(),
        method: details.method,
        url: details.url,
      }),
    });
  });
}`,
  `function isActestraRendererLoopbackRequest(
  backendPort: number,
  rawUrl: string,
): boolean {
  if (!Number.isSafeInteger(backendPort) || backendPort < 1 || backendPort > 65_535) return false;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
    parsed.port === String(backendPort)
  );
}

export function installActestraProviderRendererBoundary(
  options: ActestraProviderRendererBoundaryOptions,
): void {
  // Renderer network is a Main-owned exception: only the current local
  // AionCore backend may be reached. Provider-record routes remain IPC-only;
  // every other HTTP/HTTPS/WS/WSS destination is cancelled before Chromium
  // sends a request.
  options.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const backendPort = options.backendPort();
      const allowed = isActestraRendererLoopbackRequest(backendPort, details.url);
      callback({
        cancel:
          !allowed ||
          isActestraProviderRecordRequest({
            backendPort,
            method: details.method,
            url: details.url,
          }),
      });
    },
  );
}`,
);

replaceOnce(
  providerBoundaryTestPath,
  `    expect(onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['http://*/*'] },
      expect.any(Function),
    );`,
  `    expect(onBeforeRequest).toHaveBeenCalledWith(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      expect.any(Function),
    );`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/media/WebviewHost.tsx",
  `  if (partition) {
    webviewAttrs.partition = partition;
  }`,
  `  webviewAttrs.partition = partition ?? 'persist:actestra-preview';`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  installActestraProviderRendererBoundary({
    backendPort: () => backendManager.port,
    webRequest: mainWindow.webContents.session.webRequest,
  });`,
  `  installActestraProviderRendererBoundary({
    backendPort: () => backendManager.port,
    webRequest: mainWindow.webContents.session.webRequest,
  });
  installWebviewGuestSecurity(mainWindow.webContents, (partition) =>
    partition === undefined ? session.defaultSession : session.fromPartition(partition),
  );`,
);

replaceOnce(
  bridgePath,
  `import {
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';`,
  `import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';
import fs from 'node:fs';`,
);

replaceOnce(
  bridgePath,
  `import {
  resolveActestraGeneralWorkSmokeConfig,
  runActestraGeneralWorkSmoke,
} from './actestraGeneralWorkSmoke';`,
  `import {
  resolveActestraGeneralWorkSmokeConfig,
  runActestraGeneralWorkSmoke,
} from './actestraGeneralWorkSmoke';
import {
  resolveP7SecuritySmokeIsolation,
  runP7RendererNetworkSmoke,
} from '@/actestra/main/security/p7SecuritySmoke';`,
);

replaceOnce(
  bridgePath,
  `let generalWorkSmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(
  process.env,
);`,
  `let generalWorkSmokeStarted = false;
let p7SecuritySmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(
  process.env,
);
const p7SecuritySmokeIsolation = resolveP7SecuritySmokeIsolation(process.env);`,
);

replaceOnce(
  bridgePath,
  `export async function initializeActestraPersistenceUtility(
  userDataPath: string,
): Promise<void> {`,
  `async function startP7SecuritySmoke(): Promise<void> {
  if (
    p7SecuritySmokeStarted ||
    p7SecuritySmokeIsolation === null ||
    !app.isPackaged ||
    currentWindow === null ||
    currentWindow.isDestroyed()
  ) {
    return;
  }
  p7SecuritySmokeStarted = true;
  try {
    const renderer = await runP7RendererNetworkSmoke(
      currentWindow.webContents,
      p7SecuritySmokeIsolation.target,
    );
    console.info('ACTESTRA_P7_SECURITY_SMOKE_RESULT ' + JSON.stringify(renderer));
    fs.writeFileSync(
      p7SecuritySmokeIsolation.evidence,
      JSON.stringify({
        schemaVersion: 1,
        ids: [renderer.id],
        outcomes: [renderer.outcome],
        redacted: true,
      }),
      { encoding: 'utf8', mode: 0o600 },
    );
    app.quit();
  } catch {
    console.error(
      'ACTESTRA_P7_SECURITY_SMOKE_FAILED ' + JSON.stringify({ code: 'probe-failed' }),
    );
    app.quit();
  }
}

export async function initializeActestraPersistenceUtility(
  userDataPath: string,
): Promise<void> {`,
);

replaceOnce(
  bridgePath,
  `  startGeneralWorkRecovery();
  startGeneralWorkSmoke();
}`,
  `  startGeneralWorkRecovery();
  startGeneralWorkSmoke();
  // Bridge registration precedes the BrowserWindow load. Reuse the existing
  // lifecycle so the packaged Renderer probe cannot race an empty document.
  currentWindow?.webContents.once('did-finish-load', () => {
    void startP7SecuritySmoke();
  });
}`,
);

replaceOnce(
  bridgePath,
  `  generalWorkSmokeStarted = false;
  disposeScheduleBridge?.();`,
  `  generalWorkSmokeStarted = false;
  p7SecuritySmokeStarted = false;
  disposeScheduleBridge?.();`,
);
