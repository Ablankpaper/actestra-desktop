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

replaceOnce(
  "tests/unit/common-adapter/httpBridge.test.ts",
  `  describe('httpGet', () => {\n`,
  `  describe('Actestra schedule provider', () => {
    const scheduleJobId = 'schedule-aionui-' + 'a'.repeat(64);

    it('routes cron requests through the fixed preload provider without using fetch', async () => {
      const fetchSpy = vi.fn();
      const request = vi.fn().mockResolvedValue({
        contractVersion: 1,
        status: 200,
        data: [],
      });
      vi.stubGlobal('fetch', fetchSpy);
      vi.stubGlobal('window', {
        __backendPort: 13400,
        actestraSchedule: { request, onEvent: vi.fn() },
      });

      await expect(httpGet('/api/cron/jobs').invoke()).resolves.toEqual([]);

      expect(request).toHaveBeenCalledWith({
        contractVersion: 1,
        method: 'GET',
        path: '/api/cron/jobs',
        body: undefined,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('fails closed with a structured 503 when the fixed provider is unavailable', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      vi.stubGlobal('window', { __backendPort: 13400 });

      await expect(httpGet('/api/cron/jobs').invoke()).rejects.toMatchObject({
        name: 'BackendHttpError',
        status: 503,
        code: 'schedule-unavailable',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('subscribes fixed cron events without opening WebSocket and drops invalid payloads', () => {
      const fetchSpy = vi.fn();
      const onEvent = vi.fn().mockReturnValue(() => {});
      vi.stubGlobal('fetch', fetchSpy);
      vi.stubGlobal('window', {
        __backendPort: 13400,
        actestraSchedule: { request: vi.fn(), onEvent },
      });
      vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
      FakeWebSocket.instances = [];
      const received: unknown[] = [];

      const unsubscribe = wsEmitter<{ job_id: string }>('cron.job-removed').on((payload) => {
        received.push(payload);
      });
      const handler = onEvent.mock.calls[0]?.[0] as ((value: unknown) => void) | undefined;
      expect(handler).toBeTypeOf('function');
      handler?.({ type: 'cron.job-removed', payload: { job_id: '../invalid' } });
      handler?.({ type: 'cron.job-removed', payload: { job_id: scheduleJobId } });

      expect(received).toEqual([{ job_id: scheduleJobId }]);
      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(fetchSpy).not.toHaveBeenCalled();
      unsubscribe();
    });
  });

  describe('httpGet', () => {\n`,
);

replaceOnce(
  "tests/unit/renderer/conversation/useConversationActionsCron.dom.test.ts",
  `  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = 'current-conversation';
  });`,
  `  beforeEach(() => {
    vi.clearAllMocks();
    routeState.id = 'current-conversation';
    delete window.actestraSchedule;
  });

  it('opens the retained schedule route with only the bound conversation identity in provider mode', () => {
    window.actestraSchedule = {
      request: vi.fn(),
      onEvent: vi.fn(),
    };
    const onSessionClick = vi.fn();
    const { result } = renderActions(onSessionClick);

    act(() => result.current.handleCreateCronTask(makeConversation('provider-conversation', 'acp')));

    expect(requestPrefillMock).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/scheduled', {
      state: {
        conversation_id: 'provider-conversation',
        conversation_title: 'provider-conversation',
      },
    });
    expect(onSessionClick).toHaveBeenCalledOnce();
  });`,
);

replaceOnce(
  "tests/unit/renderer/cron/CreateTaskDialog.dom.test.tsx",
  `  beforeEach(() => {
    vi.clearAllMocks();
    currentAssistants = assistants();`,
  `  beforeEach(() => {
    vi.clearAllMocks();
    delete window.actestraSchedule;
    currentAssistants = assistants();`,
);

replaceOnce(
  "tests/unit/renderer/cron/CreateTaskDialog.dom.test.tsx",
  `  it('does not render the task description field', async () => {`,
  `  it('keeps only bounded schedule fields and submits no renderer authority in provider mode', async () => {
    window.actestraSchedule = {
      request: vi.fn(),
      onEvent: vi.fn(),
    };
    const user = userEvent.setup();

    render(
      <CreateTaskDialog
        visible
        onClose={() => {}}
        conversation_id='conversation-provider-1'
        conversation_title='Provider conversation'
      />
    );

    expect(await screen.findByText('cron.page.form.name')).toBeInTheDocument();
    expect(screen.queryByTestId('cron-assistant-select')).not.toBeInTheDocument();
    expect(screen.queryByText('cron.page.form.executionMode')).not.toBeInTheDocument();
    expect(screen.queryByText('cron.page.form.queue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guid-model-selector')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-folder-select')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('cron.page.form.namePlaceholder'), 'provider task');
    await user.type(screen.getByPlaceholderText('cron.page.form.promptPlaceholder'), '/actestra Create a schedule artifact.');
    await user.click(screen.getByTestId('modal-ok'));

    await waitFor(() => expect(ipcBridge.cron.addJob.invoke).toHaveBeenCalledTimes(1));
    expect(resolveCronAgentConfig).not.toHaveBeenCalled();
    expect(vi.mocked(ipcBridge.cron.addJob.invoke).mock.calls[0]?.[0]).toEqual({
      name: 'provider task',
      schedule: expect.objectContaining({ kind: 'cron' }),
      prompt: '/actestra Create a schedule artifact.',
      conversation_id: 'conversation-provider-1',
      conversation_title: 'Provider conversation',
      created_by: 'user',
      execution_mode: 'existing',
      queue_enabled: false,
    });
  });

  it('shows an explicit unsupported state for standalone provider creation', async () => {
    window.actestraSchedule = {
      request: vi.fn(),
      onEvent: vi.fn(),
    };
    const user = userEvent.setup();

    render(<CreateTaskDialog visible onClose={() => {}} />);

    expect(await screen.findByText('cron.page.form.actestraExistingConversationRequired')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('cron.page.form.namePlaceholder'), 'unsupported task');
    await user.type(screen.getByPlaceholderText('cron.page.form.promptPlaceholder'), '/actestra Unsupported.');
    await user.click(screen.getByTestId('modal-ok'));
    expect(ipcBridge.cron.addJob.invoke).not.toHaveBeenCalled();
  });

  it('does not render the task description field', async () => {`,
);

writeNew(
  "tests/unit/actestra/scheduleNativeWiring.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('Actestra schedule native wiring', () => {
  it('exposes only the fixed request and event preload capabilities', () => {
    const source = readSource('packages/desktop/src/preload/main.ts');

    expect(source).toContain("contextBridge.exposeInMainWorld('actestraSchedule'");
    expect(source).toContain('ACTESTRA_SCHEDULE_REQUEST_CHANNEL');
    expect(source).toContain('ACTESTRA_SCHEDULE_EVENT_CHANNEL');
    expect(source).toContain('assertAionUiScheduleEvent');
    expect(source).not.toContain('actestraSchedule:timer');
    expect(source).not.toContain('actestraSchedule:worker');
  });

  it('recovers, resumes, registers, and closes the main-owned schedule service', () => {
    const bridgeSource = readSource('packages/desktop/src/process/services/actestraShadowBridge.ts');
    const mainSource = readSource('packages/desktop/src/index.ts');

    expect(bridgeSource).toContain('new AionUiScheduleService({');
    expect(bridgeSource).toContain('await scheduleService.recover()');
    expect(bridgeSource).toContain('registerAionUiScheduleBridgeIpc({');
    expect(bridgeSource).toContain('resumeActestraSchedule');
    expect(bridgeSource.indexOf('await activeSchedule?.close')).toBeLessThan(
      bridgeSource.indexOf('await activeGeneralWork?.close')
    );
    expect(mainSource).toContain('resumeActestraSchedule');
    expect(mainSource).not.toContain('/api/cron/internal/system-resume');
  });

  it('binds the retained scheduled route dialog to navigation identity only', () => {
    const pageSource = readSource(
      'packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx'
    );
    const dialogSource = readSource(
      'packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx'
    );

    expect(pageSource).toContain('useLocation');
    expect(pageSource).toContain('conversation_id={scheduledConversation?.conversation_id}');
    expect(pageSource).toContain('conversation_title={scheduledConversation?.conversation_title}');
    expect(dialogSource).toContain('cron.page.form.actestraExistingConversationRequired');
  });

  it('keeps the frozen ipcBridge cron contract unchanged', () => {
    const source = readSource('packages/desktop/src/common/adapter/ipcBridge.ts');

    expect(source).toContain("listJobs: httpGet<ICronJob[], void>('/api/cron/jobs')");
    expect(source).toContain("onJobCreated: wsEmitter<ICronJob>('cron.job-created')");
  });
});
`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `import { routeActestraApprovalRequest } from './actestraApprovalAuthorityClient';
`,
  `import { routeActestraApprovalRequest } from './actestraApprovalAuthorityClient';
import {
  AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION,
  assertAionUiScheduleBridgeResponse,
  assertAionUiScheduleEvent,
  type AionUiScheduleBridgeMethod,
  type AionUiScheduleEvent,
} from '@/actestra/compatibility/aionui/scheduleBridge';
`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `export function isBackendHttpError(error: unknown): error is BackendHttpError {`,
  `const ACTESTRA_SCHEDULE_PATH_PREFIX = '/api/cron/';

function isActestraSchedulePath(path: string): boolean {
  return path.startsWith(ACTESTRA_SCHEDULE_PATH_PREFIX);
}

export function isActestraScheduleProviderActive(): boolean {
  return typeof window !== 'undefined' && window.actestraSchedule !== undefined;
}

function scheduleUnavailableError(method: string, path: string): BackendHttpError {
  return new BackendHttpError({
    method,
    path,
    status: 503,
    body: {
      success: false,
      error: 'Actestra scheduling is unavailable',
      code: 'schedule-unavailable',
    },
  });
}

function cloneScheduleRequestBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  const serialized = JSON.stringify(body);
  return serialized === undefined ? undefined : JSON.parse(serialized);
}

async function requestActestraSchedule<Data>(method: string, path: string, body: unknown): Promise<Data> {
  if (!isActestraScheduleProviderActive()) {
    throw scheduleUnavailableError(method, path);
  }
  let response: unknown;
  try {
    response = await window.actestraSchedule!.request({
      contractVersion: AIONUI_SCHEDULE_BRIDGE_CONTRACT_VERSION,
      method: method as AionUiScheduleBridgeMethod,
      path,
      body: cloneScheduleRequestBody(body),
    });
    assertAionUiScheduleBridgeResponse(response);
  } catch {
    throw scheduleUnavailableError(method, path);
  }
  if (response.status !== 200) {
    throw new BackendHttpError({
      method,
      path,
      status: response.status,
      body: {
        success: false,
        error: response.message,
        code: response.code,
      },
    });
  }
  return response.data as Data;
}

export function isBackendHttpError(error: unknown): error is BackendHttpError {`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `  console.debug(
    \`[httpBridge] \${method} \${path}\`,
    body !== undefined ? JSON.stringify(redactForLog(body)).slice(0, 500) : '(no body)'
  );

  const approvalRoute = await routeActestraApprovalRequest({ method, path, body });`,
  `  console.debug(
    \`[httpBridge] \${method} \${path}\`,
    body !== undefined ? JSON.stringify(redactForLog(body)).slice(0, 500) : '(no body)'
  );

  if (isActestraSchedulePath(path)) {
    return requestActestraSchedule<T>(method, path, body);
  }

  const approvalRoute = await routeActestraApprovalRequest({ method, path, body });`,
);

replaceOnce(
  "packages/desktop/src/common/adapter/httpBridge.ts",
  `export function wsEmitter<Params = undefined>(eventName: string): EmitterLike<Params> {
  return {`,
  `const ACTESTRA_SCHEDULE_EVENT_NAMES = new Set<AionUiScheduleEvent['type']>([
  'cron.job-created',
  'cron.job-updated',
  'cron.job-removed',
  'cron.job-executed',
]);

function isActestraScheduleEventName(eventName: string): eventName is AionUiScheduleEvent['type'] {
  return ACTESTRA_SCHEDULE_EVENT_NAMES.has(eventName as AionUiScheduleEvent['type']);
}

function scheduleEmitter<Params>(eventName: AionUiScheduleEvent['type']): EmitterLike<Params> {
  return {
    on: (callback: (params: Params) => void) => {
      if (!isActestraScheduleProviderActive()) return () => {};
      return window.actestraSchedule!.onEvent((event) => {
        try {
          assertAionUiScheduleEvent(event);
        } catch {
          return;
        }
        if (event.type === eventName) {
          callback(event.payload as Params);
        }
      });
    },
    emit: (() => {}) as EmitterLike<Params>['emit'],
  };
}

export function wsEmitter<Params = undefined>(eventName: string): EmitterLike<Params> {
  if (isActestraScheduleEventName(eventName)) {
    return scheduleEmitter<Params>(eventName);
  }
  return {`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `} from '../actestra/compatibility/aionui/generalWorkBridge';
`,
  `} from '../actestra/compatibility/aionui/generalWorkBridge';
import {
  ACTESTRA_SCHEDULE_EVENT_CHANNEL,
  ACTESTRA_SCHEDULE_REQUEST_CHANNEL,
  assertAionUiScheduleEvent,
  type AionUiScheduleBridgeRequest,
  type AionUiScheduleEventHandler,
} from '../actestra/compatibility/aionui/scheduleBridge';
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts",
  `import { ipcBridge } from '@/common';
`,
  `import { ipcBridge } from '@/common';
import { isActestraScheduleProviderActive } from '@/common/adapter/httpBridge';
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions.ts",
  `      const prefillPrompt = t('cron.status.defaultPrompt');
      setDropdownVisibleId(null);

      if (isLegacyReadOnlyConversationType(conversation.type)) {`,
  `      const prefillPrompt = t('cron.status.defaultPrompt');
      setDropdownVisibleId(null);

      if (isActestraScheduleProviderActive()) {
        const conversationTitle = conversation.name.trim();
        void navigate('/scheduled', {
          state: {
            conversation_id: conversation.id,
            ...(conversationTitle ? { conversation_title: conversationTitle } : {}),
          },
        });
        onSessionClick?.();
        return;
      }

      if (isLegacyReadOnlyConversationType(conversation.type)) {`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
  `import { useNavigate } from 'react-router-dom';
`,
  `import { useLocation, useNavigate } from 'react-router-dom';
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
  `import { Robot } from '@icon-park/react';

const ScheduledTasksPage: React.FC = () => {`,
  `import { Robot } from '@icon-park/react';
import { isActestraScheduleProviderActive } from '@/common/adapter/httpBridge';

type ScheduledConversationLocation = Readonly<{
  conversation_id: string;
  conversation_title?: string;
}>;

function resolveScheduledConversationLocation(state: unknown): ScheduledConversationLocation | undefined {
  if (!isActestraScheduleProviderActive() || typeof state !== 'object' || state === null || Array.isArray(state)) {
    return undefined;
  }
  const value = state as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'conversation_id' && key !== 'conversation_title')) {
    return undefined;
  }
  if (typeof value.conversation_id !== 'string' || value.conversation_id.trim() !== value.conversation_id) {
    return undefined;
  }
  if (
    value.conversation_id.length === 0 ||
    (value.conversation_title !== undefined &&
      (typeof value.conversation_title !== 'string' ||
        value.conversation_title.length === 0 ||
        value.conversation_title.trim() !== value.conversation_title))
  ) {
    return undefined;
  }
  return {
    conversation_id: value.conversation_id,
    ...(typeof value.conversation_title === 'string'
      ? { conversation_title: value.conversation_title }
      : {}),
  };
}

const ScheduledTasksPage: React.FC = () => {`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
  `  const { t } = useTranslation();
  const navigate = useNavigate();
  const { jobs, loading, pauseJob, resumeJob } = useAllCronJobs();`,
  `  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const scheduledConversation = useMemo(
    () => resolveScheduledConversationLocation(location.state),
    [location.state]
  );
  const { jobs, loading, pauseJob, resumeJob } = useAllCronJobs();`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
  `  useEffect(() => {
    setKeepAwake(configService.get('system.keepAwake') ?? false);
  }, []);
`,
  `  useEffect(() => {
    setKeepAwake(configService.get('system.keepAwake') ?? false);
  }, []);

  useEffect(() => {
    if (scheduledConversation !== undefined) {
      setCreateDialogVisible(true);
    }
  }, [scheduledConversation]);
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
  `  const handleCreateViaChat = useCallback(() => {
    navigate('/guid', { state: { prefillPrompt: t('cron.status.defaultPrompt') } });
  }, [navigate, t]);

  const handleCreateManually = useCallback(() => {
    setCreateDialogVisible(true);
  }, []);`,
  `  const handleCreateViaChat = useCallback(() => {
    if (isActestraScheduleProviderActive()) {
      setCreateDialogVisible(true);
      return;
    }
    navigate('/guid', { state: { prefillPrompt: t('cron.status.defaultPrompt') } });
  }, [navigate, t]);

  const handleCreateManually = useCallback(() => {
    setCreateDialogVisible(true);
  }, []);

  const handleCreateDialogClose = useCallback(() => {
    setCreateDialogVisible(false);
    if (scheduledConversation !== undefined) {
      navigate('/scheduled', { replace: true, state: null });
    }
  }, [navigate, scheduledConversation]);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/index.tsx",
  `      <CreateTaskDialog visible={createDialogVisible} onClose={() => setCreateDialogVisible(false)} />`,
  `      <CreateTaskDialog
        visible={createDialogVisible}
        onClose={handleCreateDialogClose}
        conversation_id={scheduledConversation?.conversation_id}
        conversation_title={scheduledConversation?.conversation_title}
      />`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `import { Form, Input, Select, Message, TimePicker, Radio, Button, Switch } from '@arco-design/web-react';`,
  `import { Alert, Form, Input, Select, Message, TimePicker, Radio, Button, Switch } from '@arco-design/web-react';`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `import { AionUiGeneralWorkBridgeService } from '@/actestra/main/compatibility/aionuiGeneralWorkBridgeService';
`,
  `import { AionUiGeneralWorkBridgeService } from '@/actestra/main/compatibility/aionuiGeneralWorkBridgeService';
import {
  AionUiScheduleService,
  SystemAionUiScheduleClock,
  SystemAionUiScheduleTimers,
} from '@/actestra/main/compatibility/aionuiScheduleService';
import {
  AionUiScheduleBridgeService,
  registerAionUiScheduleBridgeIpc,
} from '@/actestra/main/compatibility/aionuiScheduleBridgeService';
`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  initializeActestraPersistenceUtility,
  registerActestraShadowBridge,
} from './process/services/actestraShadowBridge';`,
  `  initializeActestraPersistenceUtility,
  registerActestraShadowBridge,
  resumeActestraSchedule,
} from './process/services/actestraShadowBridge';`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `let disposeCronResumeListener: (() => void) | null = null;`,
  `let disposeScheduleResumeListener: (() => void) | null = null;`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `function registerCronResumeBridge(backendPort: number): void {
  disposeCronResumeListener?.();

  const onResume = () => {
    void fetch(\`http://127.0.0.1:\${backendPort}/api/cron/internal/system-resume\`, {
      method: 'POST',
      headers: {
        'x-aionui-internal': '1',
      },
    }).catch((error) => {
      console.error('[AionUi] Failed to notify backend about system resume:', error);
    });
  };

  powerMonitor.on('resume', onResume);
  disposeCronResumeListener = () => {
    powerMonitor.removeListener('resume', onResume);
  };
}`,
  `function registerActestraScheduleResumeBridge(): void {
  disposeScheduleResumeListener?.();

  const onResume = () => {
    void resumeActestraSchedule().catch(() => {
      console.error('[Actestra schedule] Resume recalculation unavailable');
    });
  };

  powerMonitor.on('resume', onResume);
  disposeScheduleResumeListener = () => {
    powerMonitor.removeListener('resume', onResume);
  };
}`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  exposeBackendPort(backendPort);
  registerCronResumeBridge(backendPort);
  backendStartedOk = true;`,
  `  exposeBackendPort(backendPort);
  backendStartedOk = true;`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `    await initializeProcess();
    await initializeActestraPersistenceUtility(app.getPath('userData'));
    if (process.env.ACTESTRA_E2E_TEST === '1') {`,
  `    await initializeProcess();
    await initializeActestraPersistenceUtility(app.getPath('userData'));
    registerActestraScheduleResumeBridge();
    if (process.env.ACTESTRA_E2E_TEST === '1') {`,
);

replaceOnce(
  "packages/desktop/src/index.ts",
  `  disposeCronResumeListener: () => {
    disposeCronResumeListener?.();
    disposeCronResumeListener = null;
  },`,
  `  disposeCronResumeListener: () => {
    disposeScheduleResumeListener?.();
    disposeScheduleResumeListener = null;
  },`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;
let generalWorkBridgeService: AionUiGeneralWorkBridgeService | null = null;
let handlerRegistered = false;`,
  `let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;
let generalWorkBridgeService: AionUiGeneralWorkBridgeService | null = null;
let scheduleService: AionUiScheduleService | null = null;
let disposeScheduleBridgeIpc: (() => void) | null = null;
let handlerRegistered = false;`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  const platform = nativeToolPlatform;
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
    launchWorker: async ({ journeyKind, readRequestId, requestId }) => {`,
  `  const platform = nativeToolPlatform;
  const nativeContext =
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
        };
  const journey = new AionUiGeneralWorkJourneyService({
    persistence: activePersistence,
    nativeTools: platform,
    clock: platform.clock,
    nativeContext,
    launchWorker: async ({ journeyKind, readRequestId, requestId }) => {`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    },
  });
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(
    generalWorkJourneyService,
  );`,
  `    },
  });
  generalWorkJourneyService = journey;
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(journey);
  const scheduleClock = new SystemAionUiScheduleClock();
  scheduleService = new AionUiScheduleService({
    persistence: activePersistence,
    nativeContext,
    journey,
    clock: scheduleClock,
    timers: new SystemAionUiScheduleTimers(scheduleClock),
  });`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    console.info(
      \`ACTESTRA_GENERAL_WORK_RECOVERY_READY \${JSON.stringify({
        recoveredAttempts: recoveredGeneralWork.length,
      })}\`,
    );
    console.info(
      \`[Actestra persistence] Utility ready schema=\${utility.schemaVersion}\`,
    );`,
  `    console.info(
      \`ACTESTRA_GENERAL_WORK_RECOVERY_READY \${JSON.stringify({
        recoveredAttempts: recoveredGeneralWork.length,
      })}\`,
    );
    if (scheduleService === null) {
      throw new Error('Actestra schedule service is unavailable for recovery');
    }
    await scheduleService.recover();
    console.info('ACTESTRA_AIONUI_SCHEDULE_RECOVERY_READY');
    console.info(
      \`[Actestra persistence] Utility ready schema=\${utility.schemaVersion}\`,
    );`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `    generalWorkJourneyService = null;
    generalWorkBridgeService = null;
    console.warn('[Actestra general work] Recovery unavailable at startup');`,
  `    generalWorkJourneyService = null;
    generalWorkBridgeService = null;
    scheduleService = null;
    console.warn('[Actestra schedule] Recovery unavailable at startup');
    console.warn('[Actestra general work] Recovery unavailable at startup');`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  if (!generalWorkHandlersRegistered) {
    ipcMain.handle(ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL, submitGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_LIST_CHANNEL, listGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL, cancelGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL, previewGeneralWork);
    generalWorkHandlersRegistered = true;
  }
  // Recovery needs the native backend`,
  `  if (!generalWorkHandlersRegistered) {
    ipcMain.handle(ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL, submitGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_LIST_CHANNEL, listGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL, cancelGeneralWork);
    ipcMain.handle(ACTESTRA_GENERAL_WORK_PREVIEW_CHANNEL, previewGeneralWork);
    generalWorkHandlersRegistered = true;
  }
  if (disposeScheduleBridgeIpc === null) {
    disposeScheduleBridgeIpc = registerAionUiScheduleBridgeIpc({
      ipcMain,
      trustedWebContents: () => {
        const activeWindow = currentWindow;
        return activeWindow === null || activeWindow.isDestroyed()
          ? null
          : activeWindow.webContents;
      },
      bridge: new AionUiScheduleBridgeService(scheduleService),
    });
  }
  // Recovery needs the native backend`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `export async function closeActestraShadowBridge(): Promise<void> {
  const activePersistence = persistence;
  const activeGeneralWork = generalWorkJourneyService;`,
  `export async function resumeActestraSchedule(): Promise<void> {
  const activeSchedule = scheduleService;
  if (activeSchedule === null) {
    throw new Error('Actestra scheduling is unavailable');
  }
  await activeSchedule.resume();
}

export async function closeActestraShadowBridge(): Promise<void> {
  const activePersistence = persistence;
  const activeSchedule = scheduleService;
  const activeGeneralWork = generalWorkJourneyService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  generalWorkJourneyService = null;
  generalWorkBridgeService = null;
  approvalRecoveryStarted = false;`,
  `  generalWorkJourneyService = null;
  generalWorkBridgeService = null;
  scheduleService = null;
  disposeScheduleBridgeIpc = null;
  approvalRecoveryStarted = false;`,
);

replaceOnce(
  "packages/desktop/src/process/services/actestraShadowBridge.ts",
  `  generalWorkRecoveryPromise = null;
  generalWorkSmokeStarted = false;
  await activeGeneralWork?.close().catch((): undefined => undefined);`,
  `  generalWorkRecoveryPromise = null;
  generalWorkSmokeStarted = false;
  disposeScheduleBridge?.();
  await activeSchedule?.close().catch((): undefined => undefined);
  await activeGeneralWork?.close().catch((): undefined => undefined);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `          <FormItem
            label={t('cron.page.form.assistant')}`,
  `          {!scheduleProviderActive && (
            <>
              <FormItem
                label={t('cron.page.form.assistant')}`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `            {isTeamOwnedTask && (
              <p className='mb-0 mt-8px text-12px leading-18px text-t-secondary'>
                {t('cron.page.form.teamTaskExecutionModeLockedReason')}
              </p>
            )}
          </FormItem>

          <FormItem
            label={t('cron.page.form.prompt')}`,
  `            {isTeamOwnedTask && (
              <p className='mb-0 mt-8px text-12px leading-18px text-t-secondary'>
                {t('cron.page.form.teamTaskExecutionModeLockedReason')}
              </p>
            )}
              </FormItem>
            </>
          )}

          <FormItem
            label={t('cron.page.form.prompt')}`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `          <div className='mb-20px flex items-start justify-between gap-16px rounded-12px border border-solid border-[var(--color-border-2)] px-14px py-12px'>
            <div className='min-w-0'>
              <p className='m-0 text-14px font-medium text-t-primary'>{t('cron.page.form.queue')}</p>
              <p className='mb-0 mt-4px text-12px leading-18px text-t-secondary'>{t('cron.page.form.queueHint')}</p>
            </div>
            <Switch checked={queueEnabled} onChange={setQueueEnabled} />
          </div>`,
  `          {!scheduleProviderActive && (
            <div className='mb-20px flex items-start justify-between gap-16px rounded-12px border border-solid border-[var(--color-border-2)] px-14px py-12px'>
              <div className='min-w-0'>
                <p className='m-0 text-14px font-medium text-t-primary'>{t('cron.page.form.queue')}</p>
                <p className='mb-0 mt-4px text-12px leading-18px text-t-secondary'>{t('cron.page.form.queueHint')}</p>
              </div>
              <Switch checked={queueEnabled} onChange={setQueueEnabled} />
            </div>
          )}`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `import { assistantRuntimeKey, isAionrsAssistant } from '@/common/types/agent/assistantTypes';
`,
  `import { assistantRuntimeKey, isAionrsAssistant } from '@/common/types/agent/assistantTypes';
import { isActestraScheduleProviderActive } from '@/common/adapter/httpBridge';
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);`,
  `  const [form] = Form.useForm();
  const scheduleProviderActive = isActestraScheduleProviderActive();
  const hasBoundScheduleConversation =
    typeof _conversation_id === 'string' && _conversation_id.length > 0;
  const [submitting, setSubmitting] = useState(false);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `      setExecutionMode(editJob.target.execution_mode || 'existing');
      setQueueEnabled(editJob.state.queue_enabled);`,
  `      setExecutionMode(scheduleProviderActive ? 'existing' : editJob.target.execution_mode || 'existing');
      setQueueEnabled(scheduleProviderActive ? false : editJob.state.queue_enabled);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `      setExecutionMode('new_conversation');
      setQueueEnabled(false);`,
  `      setExecutionMode(scheduleProviderActive ? 'existing' : 'new_conversation');
      setQueueEnabled(false);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `  }, [visible, editJob, form]);`,
  `  }, [visible, editJob, form, scheduleProviderActive]);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `    if (!visible || !editJob?.metadata.conversation_id) {
      setTeamOwnershipStatus('standalone');`,
  `    if (scheduleProviderActive || !visible || !editJob?.metadata.conversation_id) {
      setTeamOwnershipStatus('standalone');`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `  }, [visible, editJob]);`,
  `  }, [visible, editJob, scheduleProviderActive]);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `    if (!visible || !editJob) return;`,
  `    if (scheduleProviderActive || !visible || !editJob) return;`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `  }, [visible, editJob, presetAssistants, form]);`,
  `  }, [visible, editJob, presetAssistants, form, scheduleProviderActive]);`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `  const canEditAgentConfig =
    !isExecutionModeLocked && !isOriginalExistingConversationTask && (!isEditMode || execution_mode !== 'existing');`,
  `  const canEditAgentConfig =
    !scheduleProviderActive &&
    !isExecutionModeLocked &&
    !isOriginalExistingConversationTask &&
    (!isEditMode || execution_mode !== 'existing');`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `      const resolvedExecutionMode: ExecutionMode = isTeamOwnedTask ? 'existing' : execution_mode;`,
  `      const resolvedExecutionMode: ExecutionMode =
        scheduleProviderActive || isTeamOwnedTask ? 'existing' : execution_mode;

      if (scheduleProviderActive && !isEditMode && !hasBoundScheduleConversation) {
        throw new Error(
          t('cron.page.form.actestraExistingConversationRequired', {
            defaultValue: 'Actestra scheduled work requires an existing conversation.',
          })
        );
      }`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `            max_retries: editJob!.state.max_retries,
            queue_enabled: queueEnabled,`,
  `            max_retries: scheduleProviderActive ? 0 : editJob!.state.max_retries,
            queue_enabled: scheduleProviderActive ? false : queueEnabled,`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `          queue_enabled: queueEnabled,
          agent_config,
        };`,
  `          queue_enabled: scheduleProviderActive ? false : queueEnabled,
          ...(scheduleProviderActive || agent_config === undefined ? {} : { agent_config }),
        };`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/cron/ScheduledTasksPage/CreateTaskDialog.tsx",
  `        <Form form={form} layout='vertical'>
          <FormItem`,
  `        <Form form={form} layout='vertical'>
          {scheduleProviderActive && !isEditMode && !hasBoundScheduleConversation && (
            <Alert
              type='warning'
              className='mb-16px'
              content={t('cron.page.form.actestraExistingConversationRequired', {
                defaultValue: 'Actestra scheduled work requires an existing conversation.',
              })}
            />
          )}
          <FormItem`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `contextBridge.exposeInMainWorld('electronAPI', {`,
  `contextBridge.exposeInMainWorld('actestraSchedule', {
  request: (request: AionUiScheduleBridgeRequest) =>
    ipcRenderer.invoke(ACTESTRA_SCHEDULE_REQUEST_CHANNEL, request),
  onEvent: (handler: AionUiScheduleEventHandler) => {
    const listener = (_event: unknown, value: unknown) => {
      try {
        assertAionUiScheduleEvent(value);
      } catch {
        return;
      }
      handler(value);
    };
    ipcRenderer.on(ACTESTRA_SCHEDULE_EVENT_CHANNEL, listener);
    return () => {
      ipcRenderer.off(ACTESTRA_SCHEDULE_EVENT_CHANNEL, listener);
    };
  },
});

contextBridge.exposeInMainWorld('electronAPI', {`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `  it('keeps AionUI shadow, approval, recovery, and journey authority behind schema v12 utility IPC', async () => {`,
  `  it('keeps AionUI shadow, approval, recovery, journey, and schedule authority behind schema v13 utility IPC', async () => {`,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `    expect(client.schemaVersion).toBe(12);`,
  `    expect(client.schemaVersion).toBe(13);`,
);
