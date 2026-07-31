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

writeNew(
  "packages/desktop/src/common/config/actestraProduct.ts",
  `/**
 * Actestra downstream product identity and F1 external-effect policy.
 *
 * This file is added by the reviewable Actestra overlay. The frozen AionUi
 * source remains unchanged.
 */

export const ACTESTRA_PRODUCT = Object.freeze({
  name: 'Actestra',
  appId: 'com.bignormal.actestra',
  executableName: 'Actestra',
  protocol: 'actestra',
  profileLayoutVersion: 1,
  repositoryUrl: 'https://github.com/bignormal/actestra-desktop',
  releasesUrl: 'https://github.com/bignormal/actestra-desktop/releases',
});

export const ACTESTRA_EXTERNAL_EFFECTS = Object.freeze({
  telemetry: false,
  updates: false,
  feedback: false,
  upstreamOfficialServices: false,
  publicListeners: false,
});

export type ActestraCdpEnvironment = Readonly<{
  ACTESTRA_CDP_PORT?: string;
  AIONUI_CDP_PORT?: string;
}>;

/**
 * AIONUI_CDP_PORT remains a temporary compatibility input owned by the frozen
 * upstream E2E and benchmark tooling. Remove it only after those retained
 * callers migrate to ACTESTRA_CDP_PORT. The Actestra variable always wins.
 */
export function resolveActestraCdpEnvironmentValue(
  environment: ActestraCdpEnvironment,
): string | undefined {
  return environment.ACTESTRA_CDP_PORT ?? environment.AIONUI_CDP_PORT;
}

export function shouldEnableActestraCdp(input: {
  packaged: boolean;
  environment: ActestraCdpEnvironment;
  configuredEnabled?: boolean;
}): boolean {
  if (input.packaged) {
    return false;
  }
  const environmentValue = resolveActestraCdpEnvironmentValue(input.environment);
  if (environmentValue === '0' || environmentValue === 'false') {
    return false;
  }
  if (environmentValue !== undefined && environmentValue !== '') {
    return true;
  }
  return input.configuredEnabled ?? false;
}

export type ActestraIsolatedEffect =
  | 'feedback'
  | 'public-listener'
  | 'telemetry'
  | 'update'
  | 'upstream-official-service';

const ISOLATION_MESSAGES: Record<ActestraIsolatedEffect, string> = {
  feedback: 'Actestra feedback is not connected yet. Logs and attachments were not uploaded.',
  'public-listener':
    'Public listeners are isolated until an Actestra-owned authentication and network policy is available.',
  telemetry: 'Actestra telemetry is disabled by default.',
  update: 'Actestra updates are unavailable until an Actestra-signed update provider is configured.',
  'upstream-official-service':
    'This upstream service is isolated until an Actestra-owned provider is available.',
};

const UPSTREAM_GITHUB_PROJECTS = [
  '/iofficeai/aionui',
  '/iofficeai/aionhub',
  '/iofficeai/officecli',
];

export class ActestraExternalEffectIsolatedError extends Error {
  readonly code = 'ACTESTRA_EXTERNAL_EFFECT_ISOLATED';

  constructor(readonly effect: ActestraIsolatedEffect) {
    super(ISOLATION_MESSAGES[effect]);
    this.name = 'ActestraExternalEffectIsolatedError';
  }
}

export function getActestraIsolationMessage(effect: ActestraIsolatedEffect): string {
  return ISOLATION_MESSAGES[effect];
}

export function getActestraProfileProductDirectory(
  development: boolean,
  multiInstance: boolean,
): string {
  if (!development) return ACTESTRA_PRODUCT.name;
  return multiInstance ? 'Actestra Dev 2' : 'Actestra Dev';
}

export function isUpstreamOfficialUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  if (hostname === 'aionui.com' || hostname.endsWith('.aionui.com')) return true;
  if (hostname === 'officecli.ai' || hostname.endsWith('.officecli.ai')) return true;

  if (
    hostname === 'github.com' ||
    hostname === 'api.github.com' ||
    hostname === 'raw.githubusercontent.com'
  ) {
    return UPSTREAM_GITHUB_PROJECTS.some((project) => pathname.includes(project));
  }

  if (hostname === 'cdn.jsdelivr.net') {
    return UPSTREAM_GITHUB_PROJECTS.some((project) =>
      pathname.includes('/gh' + project),
    );
  }

  return false;
}

export function assertActestraExternalUrlAllowed(rawUrl: string): void {
  if (
    !ACTESTRA_EXTERNAL_EFFECTS.upstreamOfficialServices &&
    isUpstreamOfficialUrl(rawUrl)
  ) {
    throw new ActestraExternalEffectIsolatedError('upstream-official-service');
  }
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function assertActestraNetworkInputAllowed(
  input: string | URL | Request,
): void {
  assertActestraExternalUrlAllowed(requestUrl(input));
}

export function assertActestraBridgeRequestAllowed(
  path: string,
  body?: unknown,
): void {
  if (
    !ACTESTRA_EXTERNAL_EFFECTS.upstreamOfficialServices &&
    (path === '/api/hub' || path.startsWith('/api/hub/'))
  ) {
    throw new ActestraExternalEffectIsolatedError('upstream-official-service');
  }

  if (
    path === '/api/shell/open-external' &&
    body &&
    typeof body === 'object' &&
    'url' in body &&
    typeof (body as { url?: unknown }).url === 'string'
  ) {
    assertActestraExternalUrlAllowed((body as { url: string }).url);
  }
}

export function brandActestraValue<T>(value: T): T {
  if (typeof value === 'string') {
    return value.replaceAll('AionUI', ACTESTRA_PRODUCT.name).replaceAll(
      'AionUi',
      ACTESTRA_PRODUCT.name,
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => brandActestraValue(entry)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        brandActestraValue(entry),
      ]),
    ) as T;
  }
  return value;
}
`,
);

writeNew(
  "packages/desktop/src/process/utils/actestraProfile.ts",
  `/**
 * Actestra F1 versioned profile layout.
 *
 * The profile is independent from native AionUi directories. Native data is
 * not migrated implicitly; a later migration must be explicit and reversible.
 */

import fs from 'fs';
import path from 'path';
import {
  ACTESTRA_PRODUCT,
  getActestraProfileProductDirectory,
} from '@/common/config/actestraProduct';

export const ACTESTRA_PROFILE_MANIFEST = 'actestra-profile.json';

export type ActestraProfileState = 'created' | 'current';

type ActestraProfileManifest = {
  product: 'Actestra';
  layoutVersion: number;
};

export function ensureActestraPrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    fs.chmodSync(directory, 0o700);
  }
}

export function resolveActestraUserDataPath(options: {
  appDataRoot: string;
  development: boolean;
  explicitPath?: string;
  multiInstance: boolean;
}): string {
  const explicitPath = options.explicitPath?.trim();
  if (explicitPath) return path.resolve(explicitPath);

  return path.join(
    options.appDataRoot,
    getActestraProfileProductDirectory(
      options.development,
      options.multiInstance,
    ),
    'profiles',
    'v' + ACTESTRA_PRODUCT.profileLayoutVersion,
    'default',
  );
}

function validateManifest(value: unknown): ActestraProfileManifest {
  if (
    !value ||
    typeof value !== 'object' ||
    !('product' in value) ||
    value.product !== ACTESTRA_PRODUCT.name ||
    !('layoutVersion' in value) ||
    value.layoutVersion !== ACTESTRA_PRODUCT.profileLayoutVersion
  ) {
    throw new Error('Actestra profile manifest is invalid or unsupported');
  }
  return {
    product: 'Actestra',
    layoutVersion: ACTESTRA_PRODUCT.profileLayoutVersion,
  };
}

export function ensureActestraProfileLayout(
  userDataPath: string,
): ActestraProfileState {
  ensureActestraPrivateDirectory(userDataPath);
  const manifestPath = path.join(userDataPath, ACTESTRA_PROFILE_MANIFEST);

  try {
    validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    if (process.platform !== 'win32') {
      fs.chmodSync(manifestPath, 0o600);
    }
    return 'current';
  } catch (error) {
    if (
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }

  const manifest: ActestraProfileManifest = {
    product: 'Actestra',
    layoutVersion: ACTESTRA_PRODUCT.profileLayoutVersion,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\\n', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return 'created';
}
`,
);

const packageJsonPath = "package.json";
const packageJson = JSON.parse(read(packageJsonPath));
packageJson.name = "actestra-desktop";
packageJson.version = "0.1.0-alpha.0";
packageJson.description = "Actestra independent multi-agent desktop workspace";
packageJson.author = {
  name: "bignormal",
};
packageJson.repository = {
  type: "git",
  url: "https://github.com/bignormal/actestra-desktop.git",
};
packageJson.productName = "Actestra";
write(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const builderPath = "packages/desktop/electron-builder.yml";
let builder = read(builderPath);
for (const [before, after] of [
  ["appId: com.aionui.app", "appId: com.bignormal.actestra"],
  ["productName: AionUi", "productName: Actestra"],
  ["executableName: AionUi", "executableName: Actestra"],
  [
    "copyright: Copyright © 2024 AionUi",
    "copyright: Copyright © 2026 bignormal. Portions Copyright © 2024 AionUi contributors.",
  ],
  ["- name: AionUi Protocol", "- name: Actestra Protocol"],
  ["      - aionui", "      - actestra"],
  ["  maintainer: aionui", "  maintainer: bignormal"],
  ["  vendor: aionui", "  vendor: bignormal"],
  ["      Name: AionUi", "      Name: Actestra"],
  ["      Icon: AionUi", "      Icon: Actestra"],
  ["      MimeType: x-scheme-handler/aionui;", "      MimeType: x-scheme-handler/actestra;"],
  ["  owner: iOfficeAI", "  owner: bignormal"],
  ["  repo: AionUi", "  repo: actestra-desktop"],
]) {
  const count = builder.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`Expected one builder identity token: ${before}`);
  }
  builder = builder.replace(before, after);
}
write(builderPath, builder);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  "import { getDevAppName } from '@/common/platform';",
  `import {
  ACTESTRA_PRODUCT,
  resolveActestraCdpEnvironmentValue,
  shouldEnableActestraCdp,
} from '@/common/config/actestraProduct';
import {
  ensureActestraPrivateDirectory,
  ensureActestraProfileLayout,
  resolveActestraUserDataPath,
} from './actestraProfile';`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `const e2eUserDataDir = process.env.AIONUI_E2E_TEST === '1' ? process.env.AIONUI_E2E_USER_DATA_DIR : undefined;
if (e2eUserDataDir && e2eUserDataDir.trim() !== '') {
  fs.mkdirSync(e2eUserDataDir, { recursive: true });
  app.setPath('userData', e2eUserDataDir);
}

// ============ Environment Separation ============
// Set app name before any getPath() call so userData is isolated from production.
// Note: getPlatformServices() auto-registration also applies this as a safety net
// in case Rollup loads initStorage's chunk before this module runs.
// 开发模式下设置独立 app 名称，userData 目录将与正式版隔离，允许同时运行
// E2E 沙箱已显式设置 userData 时跳过，避免被 dev app 名覆盖。
if (!app.isPackaged && !e2eUserDataDir) {
  const devAppName = getDevAppName();
  app.setName(devAppName);
  // In Electron 28+, setName alone no longer updates userData path on macOS.
  // Explicitly override userData to the dev directory.
  const appSupportDir = path.dirname(app.getPath('userData'));
  app.setPath('userData', path.join(appSupportDir, devAppName));
}`,
  `const isActestraE2ETest =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';
const explicitUserDataDir =
  process.env.ACTESTRA_USER_DATA_DIR ??
  (isActestraE2ETest ? process.env.AIONUI_E2E_USER_DATA_DIR : undefined);
const actestraUserDataDir = resolveActestraUserDataPath({
  appDataRoot: app.getPath('appData'),
  development: !app.isPackaged,
  explicitPath: explicitUserDataDir,
  multiInstance:
    process.env.ACTESTRA_MULTI_INSTANCE === '1' ||
    process.env.AIONUI_MULTI_INSTANCE === '1',
});

app.setName(ACTESTRA_PRODUCT.name);
for (const directory of [
  actestraUserDataDir,
  path.join(actestraUserDataDir, 'session'),
  path.join(actestraUserDataDir, 'logs'),
  path.join(actestraUserDataDir, 'crash-dumps'),
]) {
  ensureActestraPrivateDirectory(directory);
}
app.setPath('userData', actestraUserDataDir);
app.setPath('sessionData', path.join(actestraUserDataDir, 'session'));
app.setPath('logs', path.join(actestraUserDataDir, 'logs'));
app.setPath('crashDumps', path.join(actestraUserDataDir, 'crash-dumps'));
ensureActestraProfileLayout(actestraUserDataDir);`,
);

replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  "const CDP_REGISTRY_FILE = path.join(os.homedir(), '.aionui-cdp-registry.json');",
  "const CDP_REGISTRY_FILE = path.join(os.homedir(), '.actestra-cdp-registry-v1.json');",
);
replaceAll(
  "packages/desktop/src/process/utils/configureChromium.ts",
  "const envVal = process.env.AIONUI_CDP_PORT;",
  "const envVal = resolveActestraCdpEnvironmentValue(process.env);",
  2,
);
replaceOnce(
  "packages/desktop/src/process/utils/configureChromium.ts",
  `function shouldEnableCdp(config: CdpConfig): boolean {
  const envVal = resolveActestraCdpEnvironmentValue(process.env);
  if (envVal === '0' || envVal === 'false') return false;
  if (envVal) return true;

  if (app.isPackaged) {
    return false;
  }

  if (config.enabled !== undefined) {
    return config.enabled;
  }

  return true;
}`,
  `function shouldEnableCdp(config: CdpConfig): boolean {
  return shouldEnableActestraCdp({
    packaged: app.isPackaged,
    environment: process.env,
    configuredEnabled: config.enabled,
  });
}`,
);

replaceOnce(
  "packages/desktop/src/common/platform/index.ts",
  "import { NodePlatformServices } from './NodePlatformServices';",
  `import { NodePlatformServices } from './NodePlatformServices';
import {
  ACTESTRA_PRODUCT,
  assertActestraNetworkInputAllowed,
  getActestraProfileProductDirectory,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/common/platform/index.ts",
  `export function getDevAppName(): string {
  const isMultiInstance = process.env.AIONUI_MULTI_INSTANCE === '1';
  return isMultiInstance ? 'AionUi-Dev-2' : 'AionUi-Dev';
}`,
  `export function getDevAppName(): string {
  const isMultiInstance =
    process.env.ACTESTRA_MULTI_INSTANCE === '1' ||
    process.env.AIONUI_MULTI_INSTANCE === '1';
  return getActestraProfileProductDirectory(true, isMultiInstance);
}`,
);
replaceOnce(
  "packages/desktop/src/common/platform/index.ts",
  `        if (!app.isPackaged) {
          const devAppName = getDevAppName();
          app.setName(devAppName);
          app.setPath('userData', path.join(path.dirname(app.getPath('userData')), devAppName));
        }`,
  `        const explicitUserDataDir =
          process.env.ACTESTRA_USER_DATA_DIR ??
          ((process.env.ACTESTRA_E2E_TEST === '1' ||
            process.env.AIONUI_E2E_TEST === '1')
            ? process.env.AIONUI_E2E_USER_DATA_DIR
            : undefined);
        const profileRoot = explicitUserDataDir?.trim()
          ? path.resolve(explicitUserDataDir)
          : path.join(
              app.getPath('appData'),
              getActestraProfileProductDirectory(
                !app.isPackaged,
                process.env.ACTESTRA_MULTI_INSTANCE === '1' ||
                  process.env.AIONUI_MULTI_INSTANCE === '1',
              ),
              'profiles',
              'v' + ACTESTRA_PRODUCT.profileLayoutVersion,
              'default',
            );
        app.setName(ACTESTRA_PRODUCT.name);
        app.setPath('userData', profileRoot);`,
);
replaceOnce(
  "packages/desktop/src/common/platform/index.ts",
  `          network: {
            fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
              net.fetch(input instanceof URL ? input.toString() : input, init),
          },`,
  `          network: {
            fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
              assertActestraNetworkInputAllowed(input);
              return net.fetch(input instanceof URL ? input.toString() : input, init);
            },
          },`,
);

replaceOnce(
  "packages/desktop/src/common/platform/NodePlatformServices.ts",
  "import type { IPlatformServices, IWorkerProcess } from './IPlatformServices';",
  `import type { IPlatformServices, IWorkerProcess } from './IPlatformServices';
import {
  ACTESTRA_PRODUCT,
  assertActestraNetworkInputAllowed,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/common/platform/NodePlatformServices.ts",
  "    return { name: 'aionui', version: '0.0.0' };",
  "    return { name: 'actestra-desktop', version: '0.0.0' };",
);
replaceOnce(
  "packages/desktop/src/common/platform/NodePlatformServices.ts",
  `    getDataDir: () => process.env.DATA_DIR ?? path.join(os.homedir(), '.aionui-server'),
    getTempDir: () => os.tmpdir(),
    getHomeDir: () => os.homedir(),
    getLogsDir: () => process.env.LOGS_DIR ?? path.join(os.homedir(), '.aionui-server', 'logs'),`,
  `    getDataDir: () =>
      process.env.DATA_DIR ??
      path.join(
        os.homedir(),
        '.actestra-server',
        'v' + ACTESTRA_PRODUCT.profileLayoutVersion,
      ),
    getTempDir: () => os.tmpdir(),
    getHomeDir: () => os.homedir(),
    getLogsDir: () =>
      process.env.LOGS_DIR ??
      path.join(
        os.homedir(),
        '.actestra-server',
        'v' + ACTESTRA_PRODUCT.profileLayoutVersion,
        'logs',
      ),`,
);
replaceOnce(
  "packages/desktop/src/common/platform/NodePlatformServices.ts",
  "    getName: () => _pkg.name ?? 'aionui',",
  "    getName: () => _pkg.name ?? 'actestra-desktop',",
);
replaceOnce(
  "packages/desktop/src/common/platform/NodePlatformServices.ts",
  `  network = {
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> => fetch(input, init),
  };`,
  `  network = {
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      assertActestraNetworkInputAllowed(input);
      return fetch(input, init);
    },
  };`,
);

replaceOnce(
  "packages/desktop/src/common/platform/ElectronPlatformServices.ts",
  "import type { IPlatformServices, IWorkerProcess } from './IPlatformServices';",
  `import type { IPlatformServices, IWorkerProcess } from './IPlatformServices';
import { assertActestraNetworkInputAllowed } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/common/platform/ElectronPlatformServices.ts",
  `  network = {
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      net.fetch(input instanceof URL ? input.toString() : input, init),
  };`,
  `  network = {
    fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      assertActestraNetworkInputAllowed(input);
      return net.fetch(input instanceof URL ? input.toString() : input, init);
    },
  };`,
);

replaceOnce(
  "packages/desktop/src/process/utils/utils.ts",
  "  return path.join(rootPath, 'aionui');",
  "  return path.join(rootPath, 'actestra');",
);
replaceOnce(
  "packages/desktop/src/process/utils/utils.ts",
  `  const dataPath = path.join(rootPath, 'aionui');
  return ensureCliSafeSymlink(dataPath, getEnvAwareName('.aionui'));`,
  `  const dataPath = path.join(rootPath, 'runtime');
  return ensureCliSafeSymlink(dataPath, getEnvAwareName('.actestra-v1'));`,
);
replaceOnce(
  "packages/desktop/src/process/utils/utils.ts",
  `  const configPath = path.join(rootPath, 'config');
  return ensureCliSafeSymlink(configPath, getEnvAwareName('.aionui-config'));`,
  `  const configPath = path.join(rootPath, 'config');
  return ensureCliSafeSymlink(
    configPath,
    getEnvAwareName('.actestra-config-v1'),
  );`,
);

replaceOnce(
  "packages/desktop/src/process/utils/deepLink.ts",
  "import { ipcBridge } from '@/common';",
  `import { ipcBridge } from '@/common';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/process/utils/deepLink.ts",
  "export const PROTOCOL_SCHEME = 'aionui';",
  "export const PROTOCOL_SCHEME = ACTESTRA_PRODUCT.protocol;",
);

replaceOnce(
  "packages/desktop/src/index.ts",
  "import './process/utils/configureChromium';",
  `import './process/utils/configureChromium';
import {
  ACTESTRA_EXTERNAL_EFFECTS,
  ACTESTRA_PRODUCT,
  isUpstreamOfficialUrl,
} from './common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  "const isE2ETestMode = process.env.AIONUI_E2E_TEST === '1';",
  `const isE2ETestMode =
  process.env.ACTESTRA_E2E_TEST === '1' || process.env.AIONUI_E2E_TEST === '1';`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  "const skipSingleInstanceLock = isE2ETestMode || process.env.AIONUI_MULTI_INSTANCE === '1';",
  `const skipSingleInstanceLock =
  isE2ETestMode ||
  process.env.ACTESTRA_MULTI_INSTANCE === '1' ||
  process.env.AIONUI_MULTI_INSTANCE === '1';`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  "  console.log(`[AionUi] Main window created (id=${mainWindow.id})`);",
  `  console.log('[Actestra] Main window created (id=' + mainWindow.id + ')');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isUpstreamOfficialUrl(url)) {
      console.warn('[Actestra] Blocked isolated upstream window URL:', url);
    }
    return { action: 'deny' };
  });`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  `  const disableAutoUpdater =
    process.env.AIONUI_DISABLE_AUTO_UPDATE === '1' || process.env.AIONUI_E2E_TEST === '1' || isCiRuntime;`,
  `  const disableAutoUpdater =
    !ACTESTRA_EXTERNAL_EFFECTS.updates ||
    process.env.ACTESTRA_DISABLE_AUTO_UPDATE === '1' ||
    process.env.AIONUI_DISABLE_AUTO_UPDATE === '1' ||
    isE2ETestMode ||
    isCiRuntime;`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  "    console.log('[AionUi] Auto-updater disabled via env/CI guard');",
  "    console.log('[Actestra] Auto-updater isolated by the F1 product policy');",
);
replaceOnce(
  "packages/desktop/src/index.ts",
  `  if (!app.isPackaged) {
    try {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer');
      await installExtension(REACT_DEVELOPER_TOOLS);
      console.log('[DevTools] React Developer Tools installed');
    } catch (e) {
      console.warn('[DevTools] Failed to install React DevTools:', e);
    }
  }`,
  `  if (!app.isPackaged && process.env.ACTESTRA_INSTALL_REACT_DEVTOOLS === '1') {
    try {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import(
        'electron-devtools-installer'
      );
      await installExtension(REACT_DEVELOPER_TOOLS);
      console.log('[DevTools] React Developer Tools installed by explicit opt-in');
    } catch (e) {
      console.warn('[DevTools] Failed to install React DevTools:', e);
    }
  }`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  "    const allowRemote = resolveRemoteAccess(userConfigInfo.config, isRemoteMode);",
  `    const requestedRemoteAccess = resolveRemoteAccess(
      userConfigInfo.config,
      isRemoteMode,
    );
    const allowRemote =
      ACTESTRA_EXTERNAL_EFFECTS.publicListeners && requestedRemoteAccess;
    if (requestedRemoteAccess && !allowRemote) {
      console.error(
        '[Actestra] --remote is isolated until an owned public-listener policy is available',
      );
    }`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  `    if (!isE2ETestMode) {
      // 窗口创建后异步恢复 WebUI，不阻塞 UI / Restore WebUI async after window creation, non-blocking
      restoreDesktopWebUIFromPreferences().catch((error) => {
        console.error('[WebUI] Failed to auto-restore:', error);
      });
    }`,
  `    if (!isE2ETestMode && ACTESTRA_EXTERNAL_EFFECTS.publicListeners) {
      // Retain the setting and status UI, but do not restore an unowned listener
      // during F1 startup.
      restoreDesktopWebUIFromPreferences().catch((error) => {
        console.error('[WebUI] Failed to auto-restore:', error);
      });
    }`,
);
replaceOnce(
  "packages/desktop/src/index.ts",
  "// Register aionui:// as the default protocol client",
  "// Register actestra:// as the default protocol client",
);

replaceOnce(
  "packages/desktop/src/sentry.ts",
  "import { classifyBackendStartupFailure } from './process/startup/backendStartupFailure';",
  `import { classifyBackendStartupFailure } from './process/startup/backendStartupFailure';
import { ACTESTRA_EXTERNAL_EFFECTS } from './common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/sentry.ts",
  `export function initSentry(): void {
  Sentry.init({`,
  `export function initSentry(): void {
  if (!ACTESTRA_EXTERNAL_EFFECTS.telemetry) {
    console.log('[Actestra] Telemetry is disabled by the F1 product policy');
    return;
  }
  Sentry.init({`,
);
replaceOnce(
  "packages/desktop/src/sentry.ts",
  `export function setSentryDeviceId(): void {
  const id = getOrCreateAnalyticsId();`,
  `export function setSentryDeviceId(): void {
  if (!ACTESTRA_EXTERNAL_EFFECTS.telemetry) return;
  const id = getOrCreateAnalyticsId();`,
);
replaceOnce(
  "packages/desktop/src/sentry.ts",
  `export async function captureBackendStartupFailure(error: unknown): Promise<void> {
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;`,
  `export async function captureBackendStartupFailure(error: unknown): Promise<void> {
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
  if (!ACTESTRA_EXTERNAL_EFFECTS.telemetry) return;`,
);
replaceOnce(
  "packages/desktop/src/sentry.ts",
  `export function scheduleStartupLogReport(window: BrowserWindow): void {
  const trigger = () => {`,
  `export function scheduleStartupLogReport(window: BrowserWindow): void {
  if (!ACTESTRA_EXTERNAL_EFFECTS.telemetry) return;
  const trigger = () => {`,
);

replaceOnce(
  "packages/desktop/src/renderer/main.tsx",
  "// Sentry must be initialized first",
  `import {
  ACTESTRA_EXTERNAL_EFFECTS,
} from '@/common/config/actestraProduct';

// Sentry remains in the preserved source, but F1 never initializes it.`,
);
replaceOnce(
  "packages/desktop/src/renderer/main.tsx",
  "if ((window as { electronAPI?: unknown }).electronAPI) {",
  `if (
  ACTESTRA_EXTERNAL_EFFECTS.telemetry &&
  (window as { electronAPI?: unknown }).electronAPI
) {`,
);
replaceOnce(
  "packages/desktop/src/renderer/main.tsx",
  `function captureRuntimeInstallationIntegrityFailure(event: IRuntimeStatusEvent): void {
  if (!isInstallationIntegrityFailure(event.failure_kind)) {`,
  `function captureRuntimeInstallationIntegrityFailure(event: IRuntimeStatusEvent): void {
  if (
    !ACTESTRA_EXTERNAL_EFFECTS.telemetry ||
    !isInstallationIntegrityFailure(event.failure_kind)
  ) {`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `// Hook Sentry IPC so the renderer SDK uses ipcRenderer.send instead of falling
// back to fetch('sentry-ipc://...'), which floods the DevTools Network panel.
// Bundled into this preload via \`externalizeDepsPlugin({ exclude: [...] })\` so
// Electron's sandbox-mode preload doesn't try to resolve it from node_modules.
import '@sentry/electron/preload';`,
  `// F1 intentionally does not initialize the upstream Sentry preload hook.`,
);

replaceOnce(
  "packages/desktop/electron.vite.config.ts",
  `  const enableSentrySourceMaps =
    !isDevelopment &&
    !!process.env.SENTRY_AUTH_TOKEN &&
    (process.env.CI !== 'true' || process.env.SENTRY_UPLOAD_SOURCE_MAPS === 'true');`,
  `  // F1 never uploads source maps to an upstream telemetry provider.
  const enableSentrySourceMaps = false;`,
);
replaceAll(
  "packages/desktop/electron.vite.config.ts",
  "JSON.stringify(process.env.SENTRY_DSN ?? '')",
  "JSON.stringify('')",
  2,
);

replaceOnce(
  "packages/desktop/src/process/services/autoUpdaterService.ts",
  "import { buildCdnFeedOptions } from './updateFeed';",
  `import { buildCdnFeedOptions } from './updateFeed';
import { ACTESTRA_EXTERNAL_EFFECTS } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/process/services/autoUpdaterService.ts",
  `    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    this.configureDevAutoUpdateDebug();`,
  `    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    if (!ACTESTRA_EXTERNAL_EFFECTS.updates) {
      log.info('[Actestra] Update provider is isolated by the F1 product policy');
      return;
    }
    this.configureDevAutoUpdateDebug();`,
);
replaceOnce(
  "packages/desktop/src/process/services/autoUpdaterService.ts",
  "      const safeCwd = path.join(app.getPath('temp'), 'aionui-updater-cwd');",
  "      const safeCwd = path.join(app.getPath('temp'), 'actestra-updater-cwd');",
);

replaceOnce(
  "packages/desktop/src/process/bridge/updateBridge.ts",
  "import { consumeInstallerLastFailure } from '../services/installerLastFailure';",
  `import { consumeInstallerLastFailure } from '../services/installerLastFailure';
import {
  ACTESTRA_EXTERNAL_EFFECTS,
  getActestraIsolationMessage,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/process/bridge/updateBridge.ts",
  `export function initUpdateBridge(): void {
  ipcBridge.update.consumeInstallerLastFailure.provider(`,
  `function initIsolatedUpdateBridge(): void {
  const message = getActestraIsolationMessage('update');

  ipcBridge.update.consumeInstallerLastFailure.provider(async () => ({
    success: true,
    data: null,
  }));
  ipcBridge.update.check.provider(async () => ({ success: false, msg: message }));
  ipcBridge.update.download.provider(async () => ({
    success: false,
    msg: message,
  }));
  ipcBridge.update.cancelDownload.provider(async () => ({
    success: true,
    msg: message,
  }));
  ipcBridge.autoUpdate.check.provider(async () => ({
    success: false,
    msg: message,
  }));
  ipcBridge.autoUpdate.download.provider(async () => ({
    success: false,
    msg: message,
  }));
  ipcBridge.autoUpdate.restoreDownloaded.provider(async () => ({
    success: true,
    data: { ready: false },
    msg: message,
  }));
  ipcBridge.autoUpdate.cancelDownload.provider(async () => ({
    success: true,
    msg: message,
  }));
  ipcBridge.autoUpdate.quitAndInstall.provider(async () => undefined);
}

export function initUpdateBridge(): void {
  if (!ACTESTRA_EXTERNAL_EFFECTS.updates) {
    initIsolatedUpdateBridge();
    return;
  }

  ipcBridge.update.consumeInstallerLastFailure.provider(`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `/**
 * HTTP/WS bridge factory`,
  `import { assertActestraBridgeRequestAllowed } from '@/common/config/actestraProduct';

/**
 * HTTP/WS bridge factory`,
);
replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `): Promise<T> {
  const url = \`\${getBaseUrl()}\${path}\`;`,
  `): Promise<T> {
  assertActestraBridgeRequestAllowed(path, body);
  const url = \`\${getBaseUrl()}\${path}\`;`,
);

replaceOnce(
  "packages/desktop/src/renderer/services/feedback/submitFeedbackReport.ts",
  "import { httpRequest } from '@/common/adapter/httpBridge';",
  `import { httpRequest } from '@/common/adapter/httpBridge';
import {
  ACTESTRA_EXTERNAL_EFFECTS,
  ActestraExternalEffectIsolatedError,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/services/feedback/submitFeedbackReport.ts",
  `export async function submitFeedbackReport(input: SubmitFeedbackReportInput): Promise<void> {
  const attachments = [...(input.attachments ?? [])];`,
  `export async function submitFeedbackReport(input: SubmitFeedbackReportInput): Promise<void> {
  if (!ACTESTRA_EXTERNAL_EFFECTS.feedback) {
    throw new ActestraExternalEffectIsolatedError('feedback');
  }

  const attachments = [...(input.attachments ?? [])];`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/FeedbackReportModal.tsx",
  "import { captureFeedbackRoute } from '@/renderer/services/feedback/routeContext';",
  `import { captureFeedbackRoute } from '@/renderer/services/feedback/routeContext';
import {
  ActestraExternalEffectIsolatedError,
  getActestraIsolationMessage,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/FeedbackReportModal.tsx",
  `    } catch {
      setError(t('settings.bugReportError'));
    } finally {
      setSubmitting(false);`,
  `    } catch (error) {
      setError(
        error instanceof ActestraExternalEffectIsolatedError
          ? getActestraIsolationMessage('feedback')
          : t('settings.bugReportError'),
      );
    } finally {
      setSubmitting(false);`,
);

replaceOnce(
  "packages/desktop/src/renderer/utils/platform.ts",
  "import { getBaseUrl } from '@/common/adapter/httpBridge';",
  `import { getBaseUrl } from '@/common/adapter/httpBridge';
import { Message } from '@arco-design/web-react';
import {
  ACTESTRA_EXTERNAL_EFFECTS,
  getActestraIsolationMessage,
  isUpstreamOfficialUrl,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/utils/platform.ts",
  `export const openExternalUrl = async (url: string): Promise<void> => {
  if (!url) return;

  if (isElectronDesktop()) {`,
  `export const openExternalUrl = async (url: string): Promise<void> => {
  if (!url) return;

  if (
    !ACTESTRA_EXTERNAL_EFFECTS.upstreamOfficialServices &&
    isUpstreamOfficialUrl(url)
  ) {
    Message.warning(getActestraIsolationMessage('upstream-official-service'));
    return;
  }

  if (isElectronDesktop()) {`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/layout/InstallationIntegrityDialog.tsx",
  "import { type FeedbackEventTags, submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';",
  `import { type FeedbackEventTags, submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';
import { openExternalUrl } from '@/renderer/utils/platform';`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/layout/InstallationIntegrityDialog.tsx",
  `const AIONUI_DOWNLOAD_URL = 'https://www.aionui.com/';
const INSTALLATION_INTEGRITY_REPORT_FLUSH_TIMEOUT_MS = 2000;`,
  "const INSTALLATION_INTEGRITY_REPORT_FLUSH_TIMEOUT_MS = 2000;",
);
replaceOnce(
  "packages/desktop/src/renderer/components/layout/InstallationIntegrityDialog.tsx",
  `export function openDownloadLatest(): void {
  window.open(AIONUI_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
}`,
  `export function openDownloadLatest(): void {
  void openExternalUrl(ACTESTRA_PRODUCT.releasesUrl);
}`,
);

replaceOnce(
  "packages/desktop/src/process/bridge/webuiBridge.ts",
  "import { ipcBridge } from '@/common';",
  `import { ipcBridge } from '@/common';
import {
  ACTESTRA_EXTERNAL_EFFECTS,
  ActestraExternalEffectIsolatedError,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/process/bridge/webuiBridge.ts",
  `  ipcBridge.webui.start.provider(async (params) => {
    await maybeSeedInitialPassword();`,
  `  ipcBridge.webui.start.provider(async (params) => {
    if (
      params?.allowRemote &&
      !ACTESTRA_EXTERNAL_EFFECTS.publicListeners
    ) {
      throw new ActestraExternalEffectIsolatedError('public-listener');
    }
    await maybeSeedInitialPassword();`,
);

replaceOnce(
  "resources/windows/installer-errors-sentry.nsh",
  `!macro AIONUI_REPORT_TO_SENTRY_IMPL _CODE _DETAIL _NO_UI
  Push $9
  InitPluginsDir
  File /oname=$PLUGINSDIR\\aionui-report-installer-failure.ps1 "\${PROJECT_DIR}\\resources\\windows\\support\\report-installer-failure.ps1"
  nsExec::Exec \`"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\\aionui-report-installer-failure.ps1" -Dsn "\${AIONUI_SENTRY_DSN}" -LogPath "$AionUiSessionLogPath" -Code "\${_CODE}" -Detail "\${_DETAIL}" -Release "\${VERSION}" -Arch "\${AIONUI_TARGET_ARCH}" -Session "$AionUiSessionId" -Updated "$AionUiIsUpdated" \${_NO_UI}\`
  Pop $9
  Pop $9
!macroend`,
  `!macro AIONUI_REPORT_TO_SENTRY_IMPL _CODE _DETAIL _NO_UI
  ; Actestra F1 keeps local installer diagnostics but never uploads them.
  !insertmacro AIONUI_SLOG "event=report-isolated code=\${_CODE} detail=\${_DETAIL}"
!macroend`,
);

replaceOnce(
  "packages/desktop/src/renderer/components/layout/Layout.tsx",
  `                    <path
                      key='logo-path-1'
                      d='M40 20 Q38 22 25 40 Q23 42 26 42 L30 42 Q32 40 40 30 Q48 40 50 42 L54 42 Q57 42 55 40 Q42 22 40 20'
                      fill='white'
                    ></path>
                    <circle key='logo-circle' cx='40' cy='46' r='3' fill='white'></circle>
                    <path
                      key='logo-path-2'
                      d='M18 50 Q40 70 62 50'
                      stroke='white'
                      strokeWidth='3.5'
                      fill='none'
                      strokeLinecap='round'
                    ></path>`,
  `                    <path
                      key='actestra-mark'
                      d='M20 58 L35 24 C36.5 20 38.5 18 40 18 C42 18 44 20 45.5 24 L60 58 H51 L47.5 49.5 H32 L28.5 58 Z M35 42 H45 L40 29 Z'
                      fill='white'
                    ></path>
                    <path
                      key='actestra-baseline'
                      d='M28 64 H52'
                      stroke='white'
                      strokeWidth='3.5'
                      strokeLinecap='round'
                      opacity='0.82'
                    ></path>`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/layout/Layout.tsx",
  `                      AionUi
                    </div>`,
  `                      Actestra
                    </div>`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/layout/Layout.tsx",
  ">AionUi</div>",
  ">Actestra</div>",
);
replaceOnce(
  "packages/desktop/src/renderer/components/layout/Titlebar/index.tsx",
  "  const appTitle = useMemo(() => 'AionUi', []);",
  "  const appTitle = useMemo(() => 'Actestra', []);",
);

replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  "import { ipcBridge } from '@/common';",
  `import { ipcBridge } from '@/common';
import {
  ACTESTRA_PRODUCT,
  getActestraIsolationMessage,
} from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  `      url: 'https://github.com/iOfficeAI/AionUi/wiki',`,
  `      url: ACTESTRA_PRODUCT.repositoryUrl,`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  `      url: 'https://github.com/iOfficeAI/AionUi/releases',`,
  `      url: ACTESTRA_PRODUCT.releasesUrl,`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  `      title: t('settings.contactMe'),
      url: 'https://x.com/WailiVery',
      icon: <Right theme='outline' size='16' />,`,
  `      title: t('settings.contactMe'),
      onClick: () =>
        Message.info(getActestraIsolationMessage('upstream-official-service')),
      icon: <Right theme='outline' size='16' />,`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  `      title: t('settings.officialWebsite'),
      url: 'https://www.aionui.com',
      icon: <Right theme='outline' size='16' />,`,
  `      title: t('settings.officialWebsite'),
      onClick: () =>
        Message.info(getActestraIsolationMessage('upstream-official-service')),
      icon: <Right theme='outline' size='16' />,`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  `              AionUi`,
  `              {ACTESTRA_PRODUCT.name}`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx",
  `                  openLink('https://github.com/iOfficeAI/AionUi').catch((error) =>`,
  `                  openLink(ACTESTRA_PRODUCT.repositoryUrl).catch((error) =>`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/guid/components/QuickActionButtons.tsx",
  "import { webui } from '@/common/adapter/ipcBridge';",
  `import { webui } from '@/common/adapter/ipcBridge';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/pages/guid/components/QuickActionButtons.tsx",
  "          onClick={() => onOpenLink('https://github.com/iOfficeAI/AionUi')}",
  "          onClick={() => onOpenLink(ACTESTRA_PRODUCT.repositoryUrl)}",
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/useUpdateNotificationController.ts",
  "import { ipcBridge } from '@/common';",
  `import { ipcBridge } from '@/common';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/components/settings/useUpdateNotificationController.ts",
  "const RELEASES_PAGE_URL = 'https://github.com/iOfficeAI/AionUi/releases';",
  "const RELEASES_PAGE_URL = ACTESTRA_PRODUCT.releasesUrl;",
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/index.ts",
  "import i18nConfig from '@/common/config/i18n-config.json';",
  `import i18nConfig from '@/common/config/i18n-config.json';
import { brandActestraValue } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/services/i18n/index.ts",
  "const localeData: LocaleData = {",
  "const localeData: LocaleData = brandActestraValue({",
);
replaceOnce(
  "packages/desktop/src/renderer/services/i18n/index.ts",
  `  'fa-IR': faIR,
};`,
  `  'fa-IR': faIR,
});`,
);
replaceOnce(
  "packages/desktop/src/process/services/i18n/index.ts",
  "import i18n from 'i18next';",
  `import i18n from 'i18next';
import { brandActestraValue } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/process/services/i18n/index.ts",
  "const localeData: LocaleData = {",
  "const localeData: LocaleData = brandActestraValue({",
);
replaceOnce(
  "packages/desktop/src/process/services/i18n/index.ts",
  `  'fa-IR': faIR,
};`,
  `  'fa-IR': faIR,
});`,
);

replaceOnce(
  "packages/desktop/src/common/api/ClientFactory.ts",
  "import { AuthType } from '@/common/types/provider/authType';",
  `import { AuthType } from '@/common/types/provider/authType';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceAll(
  "packages/desktop/src/common/api/ClientFactory.ts",
  "'HTTP-Referer': 'https://aionui.com'",
  "'HTTP-Referer': ACTESTRA_PRODUCT.repositoryUrl",
  2,
);
replaceAll(
  "packages/desktop/src/common/api/ClientFactory.ts",
  "'X-Title': 'AionUi'",
  "'X-Title': ACTESTRA_PRODUCT.name",
  2,
);

replaceOnce(
  "packages/desktop/src/process/utils/tray.ts",
  "import i18n from '@process/services/i18n';",
  `import i18n from '@process/services/i18n';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/process/utils/tray.ts",
  "    tray.setToolTip('AionUi');",
  "    tray.setToolTip(ACTESTRA_PRODUCT.name);",
);
replaceOnce(
  "packages/desktop/src/renderer/hooks/system/notification/useBrowserNotification.ts",
  "import { configService } from '@/common/config/configService';",
  `import { configService } from '@/common/config/configService';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/hooks/system/notification/useBrowserNotification.ts",
  "          const notification = new Notification('AionUi', { body });",
  "          const notification = new Notification(ACTESTRA_PRODUCT.name, { body });",
);
replaceOnce(
  "packages/desktop/src/renderer/hooks/system/notification/useDesktopTurnNotification.ts",
  "import { configService } from '@/common/config/configService';",
  `import { configService } from '@/common/config/configService';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';`,
);
replaceOnce(
  "packages/desktop/src/renderer/hooks/system/notification/useDesktopTurnNotification.ts",
  "        void ipcBridge.notification.show.invoke({ title: 'AionUi', body, conversation_id: conversationId });",
  `        void ipcBridge.notification.show.invoke({
          title: ACTESTRA_PRODUCT.name,
          body,
          conversation_id: conversationId,
        });`,
);

replaceOnce(
  "packages/desktop/src/renderer/index.html",
  '    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />',
  `    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; script-src 'self' 'sha256-7Idh1+UXw1EeqjvymdKlZx1+VizEn4fRq9vQ8CnrKbc=' 'sha256-7uv7xuYWXvoNaQH5U7+fTuUyKvspVEOexZFb545Nqo4='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; child-src 'self' blob:; frame-src 'self' data: blob:" />`,
);
replaceAll("packages/desktop/src/renderer/index.html", 'content="AionUi"', 'content="Actestra"', 2);
replaceOnce(
  "packages/desktop/src/renderer/index.html",
  "<title>AionUi</title>",
  "<title>Actestra</title>",
);

const pwaManifestPath = "public/manifest.webmanifest";
const pwaManifest = JSON.parse(read(pwaManifestPath));
pwaManifest.name = "Actestra";
pwaManifest.short_name = "Actestra";
pwaManifest.description =
  "Actestra local-first multi-agent workspace for mobile and desktop browsers.";
write(pwaManifestPath, `${JSON.stringify(pwaManifest, null, 2)}\n`);

replaceAll("scripts/build-with-builder.js", "'AionUi.exe'", "'Actestra.exe'", 4);
replaceOnce(
  "scripts/build-with-builder.js",
  "'⚠️  Detected running AionUi/Electron process. Attempting to close...'",
  "'⚠️  Detected running Actestra/Electron process. Attempting to close...'",
);
replaceOnce(
  "scripts/build-with-builder.js",
  "'⚠️  Directory still locked. Please close any running AionUi/Electron processes and retry.'",
  "'⚠️  Directory still locked. Please close any running Actestra/Electron processes and retry.'",
);
replaceOnce(
  "scripts/build-with-builder.js",
  "'⚠️  Windows local build failed after AionUi.exe was produced.'",
  "'⚠️  Windows local build failed after Actestra.exe was produced.'",
);
replaceOnce(
  "scripts/build-with-builder.js",
  `    \`!define AIONUI_SENTRY_DSN "\${escapeNsisDefineValue(process.env.SENTRY_DSN || '')}"\\n\``,
  `    '!define AIONUI_SENTRY_DSN ""\\n'`,
);
replaceOnce(
  "scripts/afterSign.js",
  "const { execSync } = require('child_process');",
  "const { execFileSync } = require('child_process');",
);
replaceOnce(
  "scripts/afterSign.js",
  "    execSync(`codesign --verify --verbose \"${appPath}\"`, { stdio: 'pipe' });",
  "    execFileSync('codesign', ['--verify', '--verbose', appPath], { stdio: 'pipe' });",
);
replaceOnce(
  "scripts/afterSign.js",
  "      execSync(`codesign --force --deep --sign - \"${appPath}\"`, { stdio: 'inherit' });",
  `      execFileSync('xattr', ['-cr', appPath], { stdio: 'inherit' });
      execFileSync(
        'codesign',
        ['--force', '--deep', '--sign', '-', appPath],
        { stdio: 'inherit' },
      );`,
);
replaceOnce(
  "scripts/afterSign.js",
  "      console.error('Ad-hoc signing failed:', adHocError.message);",
  `      console.error('Ad-hoc signing failed:', adHocError.message);
      throw adHocError;`,
);

for (const relativePath of ["resources/messages.yml", "resources/windows/installer-messages.nsh"]) {
  write(relativePath, read(relativePath).replaceAll("AionUi", "Actestra"));
}
replaceAll("resources/windows/installer-observability.nsh", "AionUi.exe", "Actestra.exe", 5);
replaceAll(
  "resources/windows/installer-observability.nsh",
  "aionui-installer-${VERSION}-",
  "actestra-installer-${VERSION}-",
  2,
);
replaceAll("resources/windows/installer-update-verify.nsh", "AionUi.exe", "Actestra.exe", 2);
replaceAll("resources/windows/support/query-lockers.ps1", "AionUi.exe", "Actestra.exe", 2);
replaceOnce(
  "resources/windows/support/query-lockers.ps1",
  "name = 'AionUi installer'",
  "name = 'Actestra installer'",
);

replaceOnce(
  "packages/desktop/src/process/services/installerLastFailure.ts",
  "  return path.join(appDataDir, 'AionUi', INSTALLER_LAST_FAILURE_FILE_NAME);",
  `  return path.join(
    appDataDir,
    'Actestra',
    'profiles',
    'v1',
    'default',
    INSTALLER_LAST_FAILURE_FILE_NAME,
  );`,
);
replaceOnce(
  "resources/windows/installer-process-control.nsh",
  "$$appDir = Join-Path $$env:APPDATA 'AionUi';",
  "$$appDir = Join-Path $$env:APPDATA 'Actestra\\profiles\\v1\\default';",
);

writeNew(
  "tests/unit/actestra/productBoundary.test.ts",
  `import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTESTRA_EXTERNAL_EFFECTS,
  ACTESTRA_PRODUCT,
  ActestraExternalEffectIsolatedError,
  assertActestraBridgeRequestAllowed,
  brandActestraValue,
  isUpstreamOfficialUrl,
  resolveActestraCdpEnvironmentValue,
  shouldEnableActestraCdp,
} from '@/common/config/actestraProduct';
import {
  ACTESTRA_PROFILE_MANIFEST,
  ensureActestraProfileLayout,
  resolveActestraUserDataPath,
} from '@/process/utils/actestraProfile';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Actestra F1 product boundary', () => {
  it('uses an independent product identity and closed external-effect defaults', () => {
    expect(ACTESTRA_PRODUCT).toMatchObject({
      name: 'Actestra',
      appId: 'com.bignormal.actestra',
      executableName: 'Actestra',
      protocol: 'actestra',
      profileLayoutVersion: 1,
    });
    expect(ACTESTRA_EXTERNAL_EFFECTS).toEqual({
      telemetry: false,
      updates: false,
      feedback: false,
      upstreamOfficialServices: false,
      publicListeners: false,
    });
  });

  it('keeps the retained CDP compatibility input subordinate and denies packaged CDP', () => {
    expect(
      resolveActestraCdpEnvironmentValue({
        ACTESTRA_CDP_PORT: '9231',
        AIONUI_CDP_PORT: '0',
      }),
    ).toBe('9231');
    expect(
      resolveActestraCdpEnvironmentValue({
        AIONUI_CDP_PORT: '9232',
      }),
    ).toBe('9232');
    expect(
      shouldEnableActestraCdp({
        packaged: false,
        environment: {
          ACTESTRA_CDP_PORT: '0',
          AIONUI_CDP_PORT: '9232',
        },
      }),
    ).toBe(false);
    expect(
      shouldEnableActestraCdp({
        packaged: true,
        environment: {
          ACTESTRA_CDP_PORT: '9231',
        },
        configuredEnabled: true,
      }),
    ).toBe(false);
  });

  it('isolates known upstream-owned URLs and Hub bridge requests', () => {
    expect(isUpstreamOfficialUrl('https://static.aionui.com/releases/latest.yml')).toBe(true);
    expect(isUpstreamOfficialUrl('https://github.com/iOfficeAI/AionUi/releases')).toBe(true);
    expect(isUpstreamOfficialUrl('https://api.openai.com/v1/models')).toBe(false);
    expect(() => assertActestraBridgeRequestAllowed('/api/hub/extensions')).toThrow(
      ActestraExternalEffectIsolatedError,
    );
    expect(() =>
      assertActestraBridgeRequestAllowed('/api/shell/open-external', {
        url: 'https://github.com/iOfficeAI/AionUi',
      }),
    ).toThrow(ActestraExternalEffectIsolatedError);
    expect(() => assertActestraBridgeRequestAllowed('/api/providers')).not.toThrow();
  });

  it('brands translated values without mutating the input object', () => {
    const source = {
      title: 'AionUi',
      nested: ['Use AionUI today'],
    };
    const branded = brandActestraValue(source);

    expect(branded).toEqual({
      title: 'Actestra',
      nested: ['Use Actestra today'],
    });
    expect(source.title).toBe('AionUi');
  });

  it('creates and validates a versioned private profile manifest', () => {
    const appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-profile-test-'));
    temporaryDirectories.push(appDataRoot);
    const userDataPath = resolveActestraUserDataPath({
      appDataRoot,
      development: false,
      multiInstance: false,
    });

    expect(userDataPath).toBe(
      path.join(appDataRoot, 'Actestra', 'profiles', 'v1', 'default'),
    );
    expect(ensureActestraProfileLayout(userDataPath)).toBe('created');
    const manifestPath = path.join(userDataPath, ACTESTRA_PROFILE_MANIFEST);
    if (process.platform !== 'win32') {
      fs.chmodSync(userDataPath, 0o755);
      fs.chmodSync(manifestPath, 0o644);
    }
    expect(ensureActestraProfileLayout(userDataPath)).toBe('current');
    expect(
      JSON.parse(fs.readFileSync(manifestPath, 'utf8')),
    ).toEqual({ product: 'Actestra', layoutVersion: 1 });
    if (process.platform !== 'win32') {
      expect(fs.statSync(userDataPath).mode & 0o777).toBe(0o700);
      expect(fs.statSync(manifestPath).mode & 0o777).toBe(0o600);
    }
  });

  it('fails closed when an existing profile has an unsupported manifest', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'actestra-profile-invalid-'));
    temporaryDirectories.push(userDataPath);
    fs.writeFileSync(
      path.join(userDataPath, ACTESTRA_PROFILE_MANIFEST),
      JSON.stringify({ product: 'AionUi', layoutVersion: 1 }),
    );

    expect(() => ensureActestraProfileLayout(userDataPath)).toThrow(
      'Actestra profile manifest is invalid or unsupported',
    );
  });
});
`,
);

writeNew(
  "tests/unit/actestra/externalEffectIsolation.test.ts",
  `import { beforeEach, describe, expect, it, vi } from 'vitest';
import { httpRequest } from '@/common/adapter/httpBridge';
import { ACTESTRA_PRODUCT } from '@/common/config/actestraProduct';
import { submitFeedbackReport } from '@/renderer/services/feedback/submitFeedbackReport';

const autoUpdaterMock = vi.hoisted(() => ({
  logger: null as unknown,
  autoDownload: true,
  autoInstallOnAppQuit: false,
  setFeedURL: vi.fn(),
}));
const sentryMocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
}));
const platformMocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('electron-updater', () => ({
  autoUpdater: autoUpdaterMock,
}));
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp/actestra-isolation-test'),
  },
  autoUpdater: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));
vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock('@sentry/electron/renderer', () => sentryMocks);
vi.mock('@/renderer/utils/platform', () => platformMocks);

describe('Actestra F1 external-effect isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not configure an upstream update feed at module startup', async () => {
    await import('@/process/services/autoUpdaterService');

    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(true);
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
  });

  it('rejects feedback before collecting or uploading diagnostics', async () => {
    await expect(
      submitFeedbackReport({
        description: 'local report',
        module: 'other',
        moduleLabel: 'Other',
      }),
    ).rejects.toMatchObject({
      code: 'ACTESTRA_EXTERNAL_EFFECT_ISOLATED',
      effect: 'feedback',
    });
    expect(sentryMocks.captureEvent).not.toHaveBeenCalled();
  });

  it('blocks an upstream Hub request before fetch is called', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(httpRequest('GET', '/api/hub/extensions')).rejects.toMatchObject({
      code: 'ACTESTRA_EXTERNAL_EFFECT_ISOLATED',
      effect: 'upstream-official-service',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('routes installation recovery to Actestra releases', async () => {
    const { openDownloadLatest } =
      await import('@/renderer/components/layout/InstallationIntegrityDialog');

    openDownloadLatest();

    expect(platformMocks.openExternalUrl).toHaveBeenCalledWith(
      ACTESTRA_PRODUCT.releasesUrl,
    );
  });
});
`,
);

replaceOnce(
  "tests/unit/process/services/autoUpdaterService.test.ts",
  `vi.mock('@/process/services/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
  i18nReady: Promise.resolve(),
}));`,
  `vi.mock('@/process/services/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
  i18nReady: Promise.resolve(),
}));

vi.mock('@/common/config/actestraProduct', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/common/config/actestraProduct')>();
  return {
    ...actual,
    ACTESTRA_EXTERNAL_EFFECTS: {
      ...actual.ACTESTRA_EXTERNAL_EFFECTS,
      updates: true,
    },
  };
});`,
);
replaceOnce(
  "tests/unit/process/services/autoUpdaterService.test.ts",
  "    const expectedCwd = path.join(tempRoot, 'aionui-updater-cwd');",
  "    const expectedCwd = path.join(tempRoot, 'actestra-updater-cwd');",
);

replaceOnce(
  "tests/unit/feedback/submitFeedbackReport.test.ts",
  "vi.mock('@sentry/electron/renderer', () => sentryMocks);",
  `vi.mock('@sentry/electron/renderer', () => sentryMocks);

vi.mock('@/common/config/actestraProduct', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/common/config/actestraProduct')>();
  return {
    ...actual,
    ACTESTRA_EXTERNAL_EFFECTS: {
      ...actual.ACTESTRA_EXTERNAL_EFFECTS,
      feedback: true,
    },
  };
});`,
);

replaceOnce(
  "tests/unit/feedback/FeedbackReportModal.dom.test.tsx",
  "vi.mock('@sentry/electron/renderer', () => sentryMocks);",
  `vi.mock('@sentry/electron/renderer', () => sentryMocks);

vi.mock('@/common/config/actestraProduct', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/common/config/actestraProduct')>();
  return {
    ...actual,
    ACTESTRA_EXTERNAL_EFFECTS: {
      ...actual.ACTESTRA_EXTERNAL_EFFECTS,
      feedback: true,
    },
  };
});`,
);

replaceAll(
  "tests/unit/renderer/layout/LayoutSiderBrandHome.dom.test.tsx",
  "screen.getByText('AionUi')",
  "screen.getByText('Actestra')",
  2,
);
replaceOnce(
  "tests/unit/renderer/useDesktopTurnNotification.dom.test.tsx",
  "      title: 'AionUi',",
  "      title: 'Actestra',",
);
replaceOnce(
  "tests/unit/providers/ClientFactory.test.ts",
  `      expect(config.defaultHeaders).toEqual({
        'HTTP-Referer': 'https://aionui.com',
        'X-Title': 'AionUi',
      });`,
  `      expect(config.defaultHeaders).toEqual({
        'HTTP-Referer': 'https://github.com/bignormal/actestra-desktop',
        'X-Title': 'Actestra',
      });`,
);
replaceOnce(
  "tests/unit/bootstrap/buildWithBuilder.test.ts",
  `    expect(queryScript).toContain("name = 'AionUi installer'");`,
  `    expect(queryScript).toContain("name = 'Actestra installer'");`,
);

replaceOnce(
  "tests/unit/sentry.test.ts",
  `vi.mock('@/process/utils/analyticsId', () => ({
  getOrCreateAnalyticsId: () => 'test-device-id',
}));`,
  `vi.mock('@/process/utils/analyticsId', () => ({
  getOrCreateAnalyticsId: () => 'test-device-id',
}));

vi.mock('@/common/config/actestraProduct', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/common/config/actestraProduct')>();
  return {
    ...actual,
    ACTESTRA_EXTERNAL_EFFECTS: {
      ...actual.ACTESTRA_EXTERNAL_EFFECTS,
      telemetry: true,
    },
  };
});`,
);
replaceOnce(
  "tests/unit/updateBridgeCdnRewrite.test.ts",
  `vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));`,
  `vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/common/config/actestraProduct', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/common/config/actestraProduct')>();
  return {
    ...actual,
    ACTESTRA_EXTERNAL_EFFECTS: {
      ...actual.ACTESTRA_EXTERNAL_EFFECTS,
      updates: true,
    },
  };
});`,
);
replaceOnce(
  "tests/unit/updateBridgeDownloadDedupe.test.ts",
  `vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));`,
  `vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/common/config/actestraProduct', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/common/config/actestraProduct')>();
  return {
    ...actual,
    ACTESTRA_EXTERNAL_EFFECTS: {
      ...actual.ACTESTRA_EXTERNAL_EFFECTS,
      updates: true,
    },
  };
});`,
);
