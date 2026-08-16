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

writeNew(
  "tests/unit/actestra/diagnosticExportBridge.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as diagnosticExport from '@/actestra/compatibility/aionui/diagnosticExport';

type Handler = (
  event: Readonly<{ sender: unknown; senderFrame: unknown }>,
  ...args: unknown[]
) => Promise<unknown> | unknown;

type RegisterDiagnosticExportIpc = (options: Readonly<{
  ipcMain: Readonly<{
    handle(channel: string, handler: Handler): void;
    removeHandler(channel: string): void;
  }>;
  trustedWebContents: () => Readonly<{
    mainFrame: unknown;
    isDestroyed(): boolean;
  }> | null;
  exporter: Readonly<{ exportReport(): Promise<unknown> }>;
}>) => () => void;

const moduleSurface = diagnosticExport as unknown as Readonly<{
  AIONUI_DIAGNOSTIC_EXPORT_CHANNEL?: unknown;
  registerAionUiDiagnosticExportIpc?: unknown;
}>;

function requireRegistration(): RegisterDiagnosticExportIpc {
  expect(moduleSurface.AIONUI_DIAGNOSTIC_EXPORT_CHANNEL).toBe('actestra:diagnostic-export');
  expect(moduleSurface.registerAionUiDiagnosticExportIpc).toBeTypeOf('function');
  return moduleSurface.registerAionUiDiagnosticExportIpc as RegisterDiagnosticExportIpc;
}

function createHarness(result: unknown = { status: 'saved' }) {
  const handlers = new Map<string, Handler>();
  const removed: string[] = [];
  const mainFrame = {};
  const webContents = { mainFrame, isDestroyed: () => false };
  const exporter = { exportReport: vi.fn(async () => result) };
  const dispose = requireRegistration()({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => {
        removed.push(channel);
        handlers.delete(channel);
      },
    },
    trustedWebContents: () => webContents,
    exporter,
  });
  const channel = 'actestra:diagnostic-export';
  const handler = handlers.get(channel);
  expect(handler).toBeTypeOf('function');
  return { channel, dispose, exporter, handler: handler!, mainFrame, removed, webContents };
}

describe('Actestra P7.4 diagnostic export bridge', () => {
  it('allows only a no-argument request from the current main frame', async () => {
    const harness = createHarness();

    await expect(
      harness.handler(
        { sender: harness.webContents, senderFrame: harness.mainFrame },
      ),
    ).resolves.toEqual({ status: 'saved' });
    await expect(
      harness.handler({ sender: {}, senderFrame: {} }),
    ).resolves.toEqual({ status: 'rejected' });
    await expect(
      harness.handler(
        { sender: harness.webContents, senderFrame: harness.mainFrame },
        '/tmp/renderer-chosen-path.json',
      ),
    ).resolves.toEqual({ status: 'rejected' });
    expect(harness.exporter.exportReport).toHaveBeenCalledTimes(1);
  });

  it('validates the closed result and disposes the fixed handler exactly once', async () => {
    const harness = createHarness({ status: 'saved', path: '/private/report.json' });

    await expect(
      harness.handler(
        { sender: harness.webContents, senderFrame: harness.mainFrame },
      ),
    ).resolves.toEqual({ status: 'rejected' });
    harness.dispose();
    harness.dispose();
    expect(harness.removed).toEqual([harness.channel]);
  });

  it('wires one fixed preload operation into the persistence-owned Main lifecycle', () => {
    const root = process.cwd();
    const preload = fs.readFileSync(path.join(root, 'packages/desktop/src/preload/main.ts'), 'utf8');
    const main = fs.readFileSync(
      path.join(root, 'packages/desktop/src/process/services/actestraShadowBridge.ts'),
      'utf8',
    );

    expect(preload).toContain("contextBridge.exposeInMainWorld('actestraDiagnostics'");
    expect(preload).toContain('exportReport: async () =>');
    expect(preload).toContain('AIONUI_DIAGNOSTIC_EXPORT_CHANNEL');
    expect(preload).not.toContain('exportReport: async (path');
    expect(main).toContain('registerAionUiDiagnosticExportIpc');
    expect(main).toContain('disposeDiagnosticExportIpc');
    expect(main).toContain('new DiagnosticExportService');
    expect(main).toContain('currentWindow.webContents');
    expect(main).toContain('resolveP7DiagnosticAuditSmokeIsolation');
    expect(main).toContain('runP7PackagedDiagnosticAuditSmoke');
    expect(main).toContain('P7_DIAGNOSTIC_AUDIT_SMOKE_MARKER');
    expect(main).toContain('p7DiagnosticAuditSmokeStarted');
    expect(main).toContain('void startP7DiagnosticAuditSmoke()');
    expect(main).toContain("ACTESTRA_P7_DIAGNOSTIC_AUDIT_FAILED");
    expect(main).toContain("JSON.stringify({ code: 'probe-failed' })");
  });
});
`,
);

writeNew(
  "tests/unit/actestra/diagnosticExport.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exportReport: vi.fn(),
  messageSuccess: vi.fn(),
  messageInfo: vi.fn(),
  messageError: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      success: mocks.messageSuccess,
      info: mocks.messageInfo,
      error: mocks.messageError,
    },
  };
});

vi.mock('@/renderer/components/base/AionModal', () => ({
  default: ({
    visible,
    children,
    onCancel,
    onOk,
    okText,
    cancelText,
    confirmLoading,
  }: {
    visible: boolean;
    children: React.ReactNode;
    onCancel?: () => void;
    onOk?: () => void;
    okText?: React.ReactNode;
    cancelText?: React.ReactNode;
    confirmLoading?: boolean;
  }) =>
    visible ? (
      <div role='dialog' data-testid='actestra-diagnostic-export-dialog'>
        {children}
        <button type='button' onClick={onCancel}>
          {cancelText}
        </button>
        <button type='button' disabled={confirmLoading} onClick={onOk}>
          {okText}
        </button>
      </div>
    ) : null,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    shell: { openFile: { invoke: vi.fn() } },
    autoUpdate: { quitAndInstall: { invoke: vi.fn() } },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal', () => ({
  default: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid='retained-feedback-modal' /> : null,
}));

vi.mock('@/renderer/components/settings/checkForUpdatesShared', () => ({
  getIncludePrerelease: () => false,
  runUpdateCheck: vi.fn(),
}));

vi.mock('@/renderer/components/settings/useUpdateNotificationController', () => ({
  UPDATE_AVAILABLE_EVENT: 'aionui-update-available',
}));

vi.mock('@/renderer/components/settings/updateReadyState', () => ({
  getUpdateReadyState: () => ({ ready: false, version: '', preparing: false }),
  setUpdateReadyState: vi.fn(),
  subscribeUpdateReadyState: () => () => undefined,
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';

function installBridge(): void {
  (window as unknown as { actestraDiagnostics?: unknown }).actestraDiagnostics = {
    exportReport: mocks.exportReport,
  };
}

describe('Actestra P7.4 diagnostic export About surface', () => {
  beforeEach(() => {
    vi.stubGlobal('__APP_VERSION__', '0.1.0-alpha.0');
    installBridge();
    mocks.exportReport.mockResolvedValue({ status: 'saved' });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { actestraDiagnostics?: unknown }).actestraDiagnostics;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('explains included, excluded, and local-only data before invoking Main', async () => {
    render(<AboutModalContent />);

    expect(screen.getByText('settings.helpDocumentation')).toBeInTheDocument();
    expect(screen.getByText('settings.bugReport')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'settings.diagnosticExportAction' }));

    expect(mocks.exportReport).not.toHaveBeenCalled();
    expect(screen.getByText('settings.diagnosticExportLocalOnly')).toBeInTheDocument();
    expect(screen.getByText('settings.diagnosticExportIncludes')).toBeInTheDocument();
    expect(screen.getByText('settings.diagnosticExportExcludes')).toBeInTheDocument();
    expect(screen.getByText('settings.diagnosticExportNoUpload')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'settings.diagnosticExportConfirm' }));
    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledWith());
    expect(mocks.messageSuccess).toHaveBeenCalledWith('settings.diagnosticExportSaved');
  });

  it('keeps modal cancellation and the retained feedback flow isolated from export', async () => {
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.diagnosticExportAction' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.diagnosticExportCancel' }));
    expect(mocks.exportReport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('settings.bugReport'));
    expect(screen.getByTestId('retained-feedback-modal')).toBeInTheDocument();
    expect(mocks.exportReport).not.toHaveBeenCalled();
  });

  it.each([
    ['cancelled', 'info', 'settings.diagnosticExportCancelled'],
    ['rejected', 'error', 'settings.diagnosticExportRejected'],
  ] as const)('handles the %s Main result without exposing report data', async (status, kind, message) => {
    mocks.exportReport.mockResolvedValue({ status });
    render(<AboutModalContent />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.diagnosticExportAction' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.diagnosticExportConfirm' }));

    await waitFor(() => expect(mocks.exportReport).toHaveBeenCalledWith());
    expect(kind === 'info' ? mocks.messageInfo : mocks.messageError).toHaveBeenCalledWith(message);
  });
});
`,
);

const shadowBridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  shadowBridgePath,
  `import {
  app,
  BrowserWindow,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';`,
  `import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from 'electron';`,
);

replaceOnce(
  shadowBridgePath,
  `import {
  resolveP7ResourceReliabilitySmokeIsolation,
  runP7PackagedResourceReliabilitySmoke,
} from '@/actestra/main/security/p7ResourceReliabilitySmoke';`,
  `import {
  resolveP7ResourceReliabilitySmokeIsolation,
  runP7PackagedResourceReliabilitySmoke,
} from '@/actestra/main/security/p7ResourceReliabilitySmoke';
import {
  P7_DIAGNOSTIC_AUDIT_SMOKE_MARKER,
  resolveP7DiagnosticAuditSmokeIsolation,
  runP7PackagedDiagnosticAuditSmoke,
} from '@/actestra/main/security/p7DiagnosticAuditSmoke';
import { DiagnosticExportService } from '@/actestra/main/diagnostics/diagnosticExportService';
import { registerAionUiDiagnosticExportIpc } from '@/actestra/compatibility/aionui/diagnosticExport';`,
);

replaceOnce(
  shadowBridgePath,
  `let p7ResourceReliabilitySmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(`,
  `let p7ResourceReliabilitySmokeStarted = false;
let p7DiagnosticAuditSmokeStarted = false;
const generalWorkSmokeConfig = resolveActestraGeneralWorkSmokeConfig(`,
);

replaceOnce(
  shadowBridgePath,
  `const p7ResourceReliabilitySmokeIsolation =
  resolveP7ResourceReliabilitySmokeIsolation(process.env);`,
  `const p7ResourceReliabilitySmokeIsolation =
  resolveP7ResourceReliabilitySmokeIsolation(process.env);
const p7DiagnosticAuditSmokeIsolation =
  resolveP7DiagnosticAuditSmokeIsolation(process.env);`,
);

replaceOnce(
  shadowBridgePath,
  `    app.quit();
  }
}

export async function initializeActestraPersistenceUtility(`,
  `    app.quit();
  }
}

async function startP7DiagnosticAuditSmoke(): Promise<void> {
  if (
    p7DiagnosticAuditSmokeStarted ||
    p7DiagnosticAuditSmokeIsolation === null ||
    !app.isPackaged ||
    persistence === null
  ) {
    return;
  }
  p7DiagnosticAuditSmokeStarted = true;
  try {
    const result = await runP7PackagedDiagnosticAuditSmoke({
      isolation: p7DiagnosticAuditSmokeIsolation,
      persistence,
      app: {
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        environment: 'packaged',
      },
    });
    console.info(P7_DIAGNOSTIC_AUDIT_SMOKE_MARKER + JSON.stringify(result));
    app.quit();
  } catch {
    console.error(
      'ACTESTRA_P7_DIAGNOSTIC_AUDIT_FAILED ' +
        JSON.stringify({ code: 'probe-failed' }),
    );
    app.quit();
  }
}

export async function initializeActestraPersistenceUtility(`,
);

replaceOnce(
  shadowBridgePath,
  `let disposeScheduleBridgeIpc: (() => void) | null = null;`,
  `let disposeScheduleBridgeIpc: (() => void) | null = null;
let disposeDiagnosticExportIpc: (() => void) | null = null;`,
);

replaceOnce(
  shadowBridgePath,
  `function configurePersistenceServices(
  activePersistence: ActestraPersistencePort & ArtifactWorkspaceOperationsPort,
  userDataPath: string,
): void {`,
  `function registerDiagnosticExportBridge(): void {
  if (
    disposeDiagnosticExportIpc !== null ||
    persistence === null ||
    nativeToolPlatform === null
  ) {
    return;
  }
  const activeWindow = currentWindow;
  if (activeWindow === null || activeWindow.isDestroyed()) return;

  const exporter = new DiagnosticExportService({
    persistence,
    clock: nativeToolPlatform.clock,
    app: {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      environment: app.isPackaged ? 'packaged' : 'development',
    },
    saveDialog: {
      showSaveDialog: async (options) => {
        const trustedWindow = currentWindow;
        if (trustedWindow === null || trustedWindow.isDestroyed()) {
          throw new Error('Actestra diagnostic export window is unavailable');
        }
        const selected = await dialog.showSaveDialog(trustedWindow, {
          title: options.title,
          defaultPath: options.defaultPath,
          filters: options.filters.map((filter) => ({
            name: filter.name,
            extensions: [...filter.extensions],
          })),
        });
        if (selected.canceled || selected.filePath === undefined) {
          return { cancelled: true };
        }
        return { cancelled: false, filePath: selected.filePath };
      },
    },
  });
  disposeDiagnosticExportIpc = registerAionUiDiagnosticExportIpc({
    ipcMain,
    trustedWebContents: () => {
      const trustedWindow = currentWindow;
      return trustedWindow === null || trustedWindow.isDestroyed()
        ? null
        : trustedWindow.webContents;
    },
    exporter,
  });
}

function configurePersistenceServices(
  activePersistence: ActestraPersistencePort & ArtifactWorkspaceOperationsPort,
  userDataPath: string,
): void {`,
);

replaceOnce(
  shadowBridgePath,
  `  approvalService = new AionUiApprovalAuthorityService(
    activePersistence,
    approvalTransport,
  );
}`,
  `  approvalService = new AionUiApprovalAuthorityService(
    activePersistence,
    approvalTransport,
  );
  registerDiagnosticExportBridge();
}`,
);

replaceOnce(
  shadowBridgePath,
  `    disposeScheduleBridgeIpc?.();
    disposeScheduleBridgeIpc = null;
    scheduleRecovered = false;`,
  `    disposeScheduleBridgeIpc?.();
    disposeScheduleBridgeIpc = null;
    disposeDiagnosticExportIpc?.();
    disposeDiagnosticExportIpc = null;
    scheduleRecovered = false;`,
);

replaceOnce(
  shadowBridgePath,
  `  registerRecoveredScheduleBridge();
  registerRecoveredTeamBridge();
  // Recovery needs the native backend and original window lifecycle. Utility`,
  `  registerRecoveredScheduleBridge();
  registerRecoveredTeamBridge();
  registerDiagnosticExportBridge();
  // Recovery needs the native backend and original window lifecycle. Utility`,
);

replaceOnce(
  shadowBridgePath,
  `  const activeIsolatedCoding = isolatedCodingMainService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;
  currentWindow = null;`,
  `  const activeIsolatedCoding = isolatedCodingMainService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;
  const disposeDiagnosticExport = disposeDiagnosticExportIpc;
  currentWindow = null;`,
);

replaceOnce(
  shadowBridgePath,
  `  teamRuntime = null;
  disposeScheduleBridgeIpc = null;
  scheduleRecovered = false;`,
  `  teamRuntime = null;
  disposeScheduleBridgeIpc = null;
  disposeDiagnosticExportIpc = null;
  scheduleRecovered = false;`,
);

replaceOnce(
  shadowBridgePath,
  `  p7ResourceReliabilitySmokeStarted = false;
  disposeScheduleBridge?.();`,
  `  p7ResourceReliabilitySmokeStarted = false;
  p7DiagnosticAuditSmokeStarted = false;
  disposeDiagnosticExport?.();
  disposeScheduleBridge?.();`,
);

replaceOnce(
  shadowBridgePath,
  `    void startP7SecuritySmoke();
    void startP7ResourceReliabilitySmoke();`,
  `    void startP7SecuritySmoke();
    void startP7ResourceReliabilitySmoke();
    void startP7DiagnosticAuditSmoke();`,
);

const preloadPath = "packages/desktop/src/preload/main.ts";

replaceOnce(
  preloadPath,
  `} from '../actestra/compatibility/aionui/teamBridge';`,
  `} from '../actestra/compatibility/aionui/teamBridge';
import {
  AIONUI_DIAGNOSTIC_EXPORT_CHANNEL,
  assertAionUiDiagnosticExportResult,
} from '../actestra/compatibility/aionui/diagnosticExport';`,
);

replaceOnce(
  preloadPath,
  `contextBridge.exposeInMainWorld('actestraTeam', {`,
  `contextBridge.exposeInMainWorld('actestraDiagnostics', {
  exportReport: async () => {
    const result = await ipcRenderer.invoke(AIONUI_DIAGNOSTIC_EXPORT_CHANNEL);
    assertAionUiDiagnosticExportResult(result);
    return result;
  },
});

contextBridge.exposeInMainWorld('actestraTeam', {`,
);

const aboutPath =
  "packages/desktop/src/renderer/components/settings/SettingsModal/contents/AboutModalContent.tsx";

replaceOnce(
  aboutPath,
  `import FeedbackReportModal from './FeedbackReportModal';`,
  `import FeedbackReportModal from './FeedbackReportModal';
import AionModal from '@/renderer/components/base/AionModal';`,
);

replaceOnce(
  aboutPath,
  `  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [updateReadyState, setLocalUpdateReadyState]`,
  `  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showDiagnosticExportModal, setShowDiagnosticExportModal] = useState(false);
  const [diagnosticExporting, setDiagnosticExporting] = useState(false);
  const [updateReadyState, setLocalUpdateReadyState]`,
);

replaceOnce(
  aboutPath,
  `  const linkItems: LinkItem[] = [`,
  `  const exportDiagnostics = async (): Promise<void> => {
    if (diagnosticExporting) return;
    const bridge = window.actestraDiagnostics;
    if (bridge === undefined) {
      Message.error(t('settings.diagnosticExportUnavailable'));
      return;
    }
    setDiagnosticExporting(true);
    try {
      const result = await bridge.exportReport();
      if (result.status === 'saved') {
        Message.success(t('settings.diagnosticExportSaved'));
        setShowDiagnosticExportModal(false);
      } else if (result.status === 'cancelled') {
        Message.info(t('settings.diagnosticExportCancelled'));
        setShowDiagnosticExportModal(false);
      } else {
        Message.error(t('settings.diagnosticExportRejected'));
      }
    } catch {
      Message.error(t('settings.diagnosticExportRejected'));
    } finally {
      setDiagnosticExporting(false);
    }
  };

  const linkItems: LinkItem[] = [`,
);

replaceOnce(
  aboutPath,
  `          {/* Divider */}
          <Divider className='my-16px' />`,
  `          {/* Local diagnostics remain separate from upstream feedback/upload. */}
          <div
            data-testid='actestra-diagnostic-export-card'
            className='flex flex-col gap-10px rounded-lg bg-fill-2 p-16px'
          >
            <div className='flex flex-col gap-4px'>
              <Typography.Text className='text-14px font-600 text-t-primary'>
                {t('settings.diagnosticExportTitle')}
              </Typography.Text>
              <Typography.Text className='text-12px text-t-secondary'>
                {t('settings.diagnosticExportDescription')}
              </Typography.Text>
            </div>
            <Button
              type='secondary'
              long
              disabled={!isElectron}
              onClick={() => setShowDiagnosticExportModal(true)}
            >
              {t('settings.diagnosticExportAction')}
            </Button>
            {!isElectron && (
              <Typography.Text className='text-12px text-t-secondary'>
                {t('settings.diagnosticExportUnavailable')}
              </Typography.Text>
            )}
          </div>

          {/* Divider */}
          <Divider className='my-16px' />`,
);

replaceOnce(
  aboutPath,
  `      <FeedbackReportModal visible={showFeedbackModal} onCancel={() => setShowFeedbackModal(false)} />`,
  `      <FeedbackReportModal visible={showFeedbackModal} onCancel={() => setShowFeedbackModal(false)} />
      {showDiagnosticExportModal && (
        <AionModal
          variant='standard'
          header={{ title: t('settings.diagnosticExportTitle'), showClose: true }}
          visible
          onCancel={() => setShowDiagnosticExportModal(false)}
          onOk={() => void exportDiagnostics()}
          confirmLoading={diagnosticExporting}
          okText={t('settings.diagnosticExportConfirm')}
          cancelText={t('settings.diagnosticExportCancel')}
          alignCenter
          className='w-[min(560px,calc(100vw-32px))] max-w-560px'
          wrapStyle={{ zIndex: 1050 }}
          maskStyle={{ zIndex: 1050 }}
        >
          <div className='flex flex-col gap-12px' data-testid='actestra-diagnostic-export-consent'>
            <Typography.Text className='text-13px text-t-primary'>
              {t('settings.diagnosticExportLocalOnly')}
            </Typography.Text>
            <div className='rounded-lg bg-fill-2 p-12px'>
              <Typography.Text className='text-12px text-t-secondary'>
                {t('settings.diagnosticExportIncludes')}
              </Typography.Text>
            </div>
            <div className='rounded-lg bg-fill-2 p-12px'>
              <Typography.Text className='text-12px text-t-secondary'>
                {t('settings.diagnosticExportExcludes')}
              </Typography.Text>
            </div>
            <Typography.Text className='text-12px font-600 text-t-primary'>
              {t('settings.diagnosticExportNoUpload')}
            </Typography.Text>
          </div>
        </AionModal>
      )}`,
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json",
  `  "appDescription": "One desktop. Your AI agents, actually coworking.",
  "helpDocumentation": "Help Documentation",`,
  `  "appDescription": "One desktop. Your AI agents, actually coworking.",
  "diagnosticExportTitle": "Local diagnostics",
  "diagnosticExportDescription": "Save a bounded, metadata-only report for troubleshooting.",
  "diagnosticExportAction": "Export diagnostics",
  "diagnosticExportLocalOnly": "The report is created only after you confirm and choose a local save location.",
  "diagnosticExportIncludes": "Includes: app, version and platform metadata; the audit-retention summary; up to 1,000 metadata-only privileged audit events; and up to 50 terminal attempts.",
  "diagnosticExportExcludes": "Excludes: credentials, provider configuration, prompts and completions, tool arguments and results, paths, patches, logs, environment values, and raw identifiers.",
  "diagnosticExportNoUpload": "Nothing is uploaded or sent automatically.",
  "diagnosticExportConfirm": "Choose location and export",
  "diagnosticExportCancel": "Cancel",
  "diagnosticExportSaved": "Diagnostic report saved locally",
  "diagnosticExportCancelled": "Diagnostic export cancelled",
  "diagnosticExportRejected": "Diagnostic report could not be exported",
  "diagnosticExportUnavailable": "Local diagnostic export is available only in the Actestra desktop app.",
  "helpDocumentation": "Help Documentation",`,
);

replaceOnce(
  "packages/desktop/src/renderer/services/i18n/locales/zh-CN/settings.json",
  `  "appDescription": "One desktop. Your AI agents, actually coworking.",
  "helpDocumentation": "帮助文档",`,
  `  "appDescription": "One desktop. Your AI agents, actually coworking.",
  "diagnosticExportTitle": "本地诊断",
  "diagnosticExportDescription": "保存一份有界、仅含元数据的故障排查报告。",
  "diagnosticExportAction": "导出诊断报告",
  "diagnosticExportLocalOnly": "只有在你确认并选择本地保存位置后，系统才会创建报告。",
  "diagnosticExportIncludes": "包含：应用、版本和平台元数据；审计保留摘要；最多 1,000 条仅含元数据的特权审计事件；以及最多 50 条终态执行记录。",
  "diagnosticExportExcludes": "不包含：凭据、Provider 配置、提示词和模型回复、工具参数和结果、路径、补丁、日志、环境变量以及原始标识符。",
  "diagnosticExportNoUpload": "系统不会自动上传或发送任何内容。",
  "diagnosticExportConfirm": "选择位置并导出",
  "diagnosticExportCancel": "取消",
  "diagnosticExportSaved": "诊断报告已保存到本地",
  "diagnosticExportCancelled": "已取消诊断导出",
  "diagnosticExportRejected": "无法导出诊断报告",
  "diagnosticExportUnavailable": "本地诊断导出仅在 Actestra 桌面应用中可用。",
  "helpDocumentation": "帮助文档",`,
);
