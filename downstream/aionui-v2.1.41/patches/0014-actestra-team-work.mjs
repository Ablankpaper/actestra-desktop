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

const httpBridgePath = "packages/desktop/src/common/adapter/httpBridge.ts";

replaceOnce(
  httpBridgePath,
  `} from '@/actestra/compatibility/aionui/scheduleBridge';`,
  `} from '@/actestra/compatibility/aionui/scheduleBridge';
import {
  AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
  assertAionUiTeamBridgeResponse,
  assertAionUiTeamEvent,
  type AionUiTeamBridgeMethod,
  type AionUiTeamEvent,
} from '@/actestra/compatibility/aionui/teamBridge';`,
);

replaceOnce(
  httpBridgePath,
  `export function isBackendHttpError(error: unknown): error is BackendHttpError {`,
  `const ACTESTRA_TEAM_PATH = '/api/teams';

function isActestraTeamPath(path: string): boolean {
  return path === ACTESTRA_TEAM_PATH || path.startsWith(ACTESTRA_TEAM_PATH + '/') || path.startsWith(ACTESTRA_TEAM_PATH + '?');
}

export function isActestraTeamProviderActive(): boolean {
  return typeof window !== 'undefined' && window.actestraTeam !== undefined;
}

function teamUnavailableError(method: string, path: string): BackendHttpError {
  return new BackendHttpError({
    method,
    path,
    status: 503,
    body: {
      success: false,
      error: 'Actestra Team work is unavailable',
      code: 'team-unavailable',
    },
  });
}

function cloneTeamRequestBody(body: unknown): unknown {
  if (body === undefined) return undefined;
  const serialized = JSON.stringify(body);
  return serialized === undefined ? undefined : JSON.parse(serialized);
}

async function requestActestraTeam<Data>(method: string, path: string, body: unknown): Promise<Data> {
  if (!isActestraTeamProviderActive()) throw teamUnavailableError(method, path);
  let response: unknown;
  try {
    response = await window.actestraTeam!.request({
      contractVersion: AIONUI_TEAM_BRIDGE_CONTRACT_VERSION,
      method: method as AionUiTeamBridgeMethod,
      path,
      body: cloneTeamRequestBody(body),
    });
    assertAionUiTeamBridgeResponse(response);
  } catch {
    throw teamUnavailableError(method, path);
  }
  if (response.status !== 200) {
    throw new BackendHttpError({
      method,
      path,
      status: response.status,
      body: { success: false, error: response.message, code: response.code },
    });
  }
  return response.data as Data;
}

export function isBackendHttpError(error: unknown): error is BackendHttpError {`,
);

replaceOnce(
  httpBridgePath,
  `  if (isActestraSchedulePath(path)) {
    return requestActestraSchedule<T>(method, path, body);
  }

  const approvalRoute = await routeActestraApprovalRequest`,
  `  if (isActestraTeamPath(path)) {
    return requestActestraTeam<T>(method, path, body);
  }
  if (isActestraSchedulePath(path)) {
    return requestActestraSchedule<T>(method, path, body);
  }

  const approvalRoute = await routeActestraApprovalRequest`,
);

replaceOnce(
  httpBridgePath,
  `export function wsEmitter<Params = undefined>(eventName: string): EmitterLike<Params> {
  if (isActestraScheduleEventName(eventName)) {`,
  `const ACTESTRA_TEAM_EVENT_NAMES = new Set<AionUiTeamEvent['type']>([
  'team.created',
  'team.removed',
  'team.renamed',
  'team.listChanged',
  'team.agentSpawned',
  'team.agentRemoved',
  'team.agentRenamed',
  'team.teammateMessage',
  'team.runAccepted',
  'team.runStarted',
  'team.runUpdated',
  'team.runCompleted',
  'team.runCancelled',
  'team.runFailed',
  'team.slotWorkChanged',
]);

function isActestraTeamEventName(eventName: string): eventName is AionUiTeamEvent['type'] {
  return ACTESTRA_TEAM_EVENT_NAMES.has(eventName as AionUiTeamEvent['type']);
}

function teamEmitter<Params>(eventName: AionUiTeamEvent['type']): EmitterLike<Params> {
  return {
    on: (callback: (params: Params) => void) => {
      if (!isActestraTeamProviderActive()) return () => {};
      return window.actestraTeam!.onEvent((event) => {
        try {
          assertAionUiTeamEvent(event);
        } catch {
          return;
        }
        if (event.type === eventName) callback(event.payload as Params);
      });
    },
    emit: (() => {}) as EmitterLike<Params>['emit'],
  };
}

export function wsEmitter<Params = undefined>(eventName: string): EmitterLike<Params> {
  if (isActestraTeamEventName(eventName)) {
    return teamEmitter<Params>(eventName);
  }
  if (isActestraScheduleEventName(eventName)) {`,
);

const preloadPath = "packages/desktop/src/preload/main.ts";

replaceOnce(
  preloadPath,
  `} from '../actestra/compatibility/aionui/scheduleBridge';`,
  `} from '../actestra/compatibility/aionui/scheduleBridge';
import {
  ACTESTRA_TEAM_EVENT_CHANNEL,
  ACTESTRA_TEAM_REQUEST_CHANNEL,
  assertAionUiTeamEvent,
  type AionUiTeamBridgeRequest,
  type AionUiTeamEventHandler,
} from '../actestra/compatibility/aionui/teamBridge';`,
);

replaceOnce(
  preloadPath,
  `contextBridge.exposeInMainWorld('electronAPI', {`,
  `contextBridge.exposeInMainWorld('actestraTeam', {
  request: (request: AionUiTeamBridgeRequest) =>
    ipcRenderer.invoke(ACTESTRA_TEAM_REQUEST_CHANNEL, request),
  onEvent: (handler: AionUiTeamEventHandler) => {
    const listener = (_event: unknown, value: unknown) => {
      try {
        assertAionUiTeamEvent(value);
      } catch {
        return;
      }
      handler(value);
    };
    ipcRenderer.on(ACTESTRA_TEAM_EVENT_CHANNEL, listener);
    return () => {
      ipcRenderer.off(ACTESTRA_TEAM_EVENT_CHANNEL, listener);
    };
  },
});

contextBridge.exposeInMainWorld('electronAPI', {`,
);

writeNew(
  "packages/desktop/src/process/services/actestraTeamComposition.ts",
  `import { randomBytes } from 'node:crypto';
import { ipcMain, type BrowserWindow } from 'electron';
import type { ActestraPersistencePort, Instant } from '@/actestra/core';
import { AionUiTeamBridgeService, registerAionUiTeamBridgeIpc } from '@/actestra/main/compatibility/aionuiTeamBridgeService';
import { AionUiTeamService } from '@/actestra/main/compatibility/aionuiTeamService';
import { TeamJourneyWorkerRouter, type TeamCodingJourneyPort, type TeamGeneralWorkJourneyPort, type TeamWorkspaceContextPort } from '@/actestra/main/orchestration/teamJourneyWorkerRouter';
import { TeamOrchestratorService, type TeamResultAggregationPort } from '@/actestra/main/orchestration/teamOrchestratorService';
import { TeamPlanAdmissionService, type TeamPlannerPort } from '@/actestra/main/orchestration/teamPlanAdmissionService';

export interface ActestraTeamPlannerRuntime extends TeamPlannerPort, TeamResultAggregationPort {
  close(): Promise<void>;
}

export interface ActestraTeamRuntime {
  readonly planner: ActestraTeamPlannerRuntime;
  readonly workspaceContext: TeamWorkspaceContextPort;
}

export interface ActestraTeamCompositionOptions {
  readonly persistence: ActestraPersistencePort;
  readonly general: TeamGeneralWorkJourneyPort;
  readonly coding: TeamCodingJourneyPort | null;
  readonly runtime: ActestraTeamRuntime | null;
  readonly now: () => Instant;
}

export class ActestraTeamComposition {
  readonly #service: AionUiTeamService;
  readonly #orchestrator: TeamOrchestratorService | null;
  readonly #planner: ActestraTeamPlannerRuntime | null;
  #disposeIpc: (() => void) | null = null;
  #closed = false;

  constructor(private readonly options: ActestraTeamCompositionOptions) {
    const available = options.runtime !== null && options.coding !== null;
    const worker = available
      ? new TeamJourneyWorkerRouter({
          persistence: options.persistence,
          workspaceContext: options.runtime!.workspaceContext,
          general: options.general,
          coding: options.coding!,
        })
      : null;
    this.#planner = available ? options.runtime!.planner : null;
    this.#orchestrator =
      worker === null || this.#planner === null
        ? null
        : new TeamOrchestratorService({
            persistence: options.persistence,
            worker,
            aggregator: this.#planner,
            now: options.now,
          });
    const admission =
      this.#planner === null
        ? null
        : new TeamPlanAdmissionService({
            planner: this.#planner,
            persistence: options.persistence,
          });
    this.#service = new AionUiTeamService({
      persistence: options.persistence,
      admission,
      orchestrator: this.#orchestrator,
      now: options.now,
      createDigest: () => randomBytes(32).toString('hex'),
    });
  }

  async recover(): Promise<number> {
    if (this.#closed) throw new Error('Actestra Team composition is closed');
    const recovered = await this.#orchestrator?.recover(this.options.now());
    return recovered?.length ?? 0;
  }

  register(window: BrowserWindow): void {
    if (this.#closed || this.#disposeIpc !== null || window.isDestroyed()) return;
    this.#disposeIpc = registerAionUiTeamBridgeIpc({
      ipcMain,
      trustedWebContents: () => (window.isDestroyed() ? null : window.webContents),
      bridge: new AionUiTeamBridgeService(this.#service),
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#disposeIpc?.();
    this.#disposeIpc = null;
    this.#service.close();
    const failures: unknown[] = [];
    try {
      await this.#orchestrator?.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.#planner?.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Actestra Team composition shutdown failed');
    }
  }
}
`,
);

const shadowBridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  shadowBridgePath,
  `import {
  resolveActestraGeneralWorkSmokeConfig,`,
  `import {
  ActestraTeamComposition,
  type ActestraTeamRuntime,
} from './actestraTeamComposition';
import {
  resolveActestraGeneralWorkSmokeConfig,`,
);

replaceOnce(
  shadowBridgePath,
  `let scheduleService: AionUiScheduleService | null = null;
let disposeScheduleBridgeIpc: (() => void) | null = null;`,
  `let scheduleService: AionUiScheduleService | null = null;
let teamComposition: ActestraTeamComposition | null = null;
let teamRuntime: ActestraTeamRuntime | null = null;
let disposeScheduleBridgeIpc: (() => void) | null = null;`,
);

replaceOnce(
  shadowBridgePath,
  `export function configureActestraCodingJourneyRuntime(
  runtime: AionUiCodingJourneyRuntime | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra coding journey runtime must be injected before persistence startup');
  }
  codingJourneyRuntime = runtime;
}`,
  `export function configureActestraCodingJourneyRuntime(
  runtime: AionUiCodingJourneyRuntime | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra coding journey runtime must be injected before persistence startup');
  }
  codingJourneyRuntime = runtime;
}

export function configureActestraTeamRuntime(runtime: ActestraTeamRuntime | null): void {
  if (persistence !== null) {
    throw new Error('Actestra Team runtime must be injected before persistence startup');
  }
  teamRuntime = runtime;
}`,
);

replaceOnce(
  shadowBridgePath,
  `  generalWorkJourneyService = journey;
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(journey);
  const scheduleClock = new SystemAionUiScheduleClock();`,
  `  generalWorkJourneyService = journey;
  generalWorkBridgeService = new AionUiGeneralWorkBridgeService(journey);
  teamComposition = new ActestraTeamComposition({
    persistence: activePersistence,
    general: journey,
    coding: codingJourneyService,
    runtime: teamRuntime,
    now: () => platform.clock.now(),
  });
  const scheduleClock = new SystemAionUiScheduleClock();`,
);

replaceOnce(
  shadowBridgePath,
  `    await scheduleService.recover();
    scheduleRecovered = true;
    registerRecoveredScheduleBridge();`,
  `    await scheduleService.recover();
    scheduleRecovered = true;
    const recoveredTeamRuns = await teamComposition.recover();
    console.info('ACTESTRA_AIONUI_TEAM_RECOVERY_READY ' + JSON.stringify({ recoveredRuns: recoveredTeamRuns }));
    registerRecoveredScheduleBridge();
    registerRecoveredTeamBridge();`,
);

replaceOnce(
  shadowBridgePath,
  `  } catch {
    await isolatedCodingMainService?.close().catch((): undefined => undefined);`,
  `  } catch {
    await teamComposition?.close().catch((): undefined => undefined);
    teamComposition = null;
    teamRuntime = null;
    await isolatedCodingMainService?.close().catch((): undefined => undefined);`,
);

replaceOnce(
  shadowBridgePath,
  `export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {`,
  `function registerRecoveredTeamBridge(): void {
  const activeWindow = currentWindow;
  if (activeWindow === null || activeWindow.isDestroyed()) return;
  teamComposition?.register(activeWindow);
}

export function registerActestraShadowBridge(
  window: BrowserWindow,
): void {`,
);

replaceOnce(
  shadowBridgePath,
  `  registerRecoveredScheduleBridge();
  // Recovery needs the native backend`,
  `  registerRecoveredScheduleBridge();
  registerRecoveredTeamBridge();
  // Recovery needs the native backend`,
);

replaceOnce(
  shadowBridgePath,
  `  const activeSchedule = scheduleService;
  const activeGeneralWork = generalWorkJourneyService;`,
  `  const activeSchedule = scheduleService;
  const activeTeam = teamComposition;
  const activeGeneralWork = generalWorkJourneyService;`,
);

replaceOnce(
  shadowBridgePath,
  `  scheduleService = null;
  disposeScheduleBridgeIpc = null;`,
  `  scheduleService = null;
  teamComposition = null;
  teamRuntime = null;
  disposeScheduleBridgeIpc = null;`,
);

replaceOnce(
  shadowBridgePath,
  `  disposeScheduleBridge?.();
  let codingJourneyCloseError: unknown;`,
  `  disposeScheduleBridge?.();
  let teamCloseError: unknown;
  try {
    await activeTeam?.close();
  } catch (error) {
    teamCloseError = error;
  }
  let codingJourneyCloseError: unknown;`,
);

replaceOnce(
  shadowBridgePath,
  `  if (codingJourneyCloseError !== undefined || isolatedCodingCloseFailed) {
    throw new AggregateError(
      [codingJourneyCloseError, isolatedCodingCloseError].filter(`,
  `  if (teamCloseError !== undefined || codingJourneyCloseError !== undefined || isolatedCodingCloseFailed) {
    throw new AggregateError(
      [teamCloseError, codingJourneyCloseError, isolatedCodingCloseError].filter(`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraTeamClient.ts",
  `import type {
  AionUiTeamEvent,
  NativeAionUiTeamRunAck,
  NativeAionUiTeamRunState,
} from '@/actestra/compatibility/aionui/teamBridge';
import { httpRequest, isActestraTeamProviderActive } from './httpBridge';

export { isActestraTeamProviderActive };

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function subscribeActestraTeamEvents(handler: (event: AionUiTeamEvent) => void): () => void {
  if (!isActestraTeamProviderActive()) return () => {};
  return window.actestraTeam!.onEvent(handler);
}

export function getActestraTeamRunState(teamId: string): Promise<NativeAionUiTeamRunState> {
  return httpRequest<NativeAionUiTeamRunState>('GET', '/api/teams/' + segment(teamId) + '/run-state');
}

export function submitActestraTeamTask(teamId: string, content: string): Promise<NativeAionUiTeamRunAck> {
  return httpRequest<NativeAionUiTeamRunAck>('POST', '/api/teams/' + segment(teamId) + '/messages', { content });
}

export type ActestraTeamNodeAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'replace' | 'handoff';

export function controlActestraTeamNode(input: {
  teamId: string;
  runId: string;
  slotId: string;
  action: ActestraTeamNodeAction;
  reason: string;
}): Promise<NativeAionUiTeamRunState> {
  return httpRequest<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(input.teamId) + '/runs/' + segment(input.runId) + '/agents/' + segment(input.slotId) + '/' + input.action,
    { reason: input.reason },
  );
}

export function decideActestraTeamApproval(input: {
  teamId: string;
  runId: string;
  slotId: string;
  decision: 'approved' | 'denied';
}): Promise<NativeAionUiTeamRunState> {
  return httpRequest<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(input.teamId) + '/runs/' + segment(input.runId) + '/agents/' + segment(input.slotId) + '/approval',
    { decision: input.decision },
  );
}

export function resolveActestraTeamFeedback(input: {
  teamId: string;
  runId: string;
  decision: 'approved' | 'denied';
  note: string;
}): Promise<NativeAionUiTeamRunState> {
  return httpRequest<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(input.teamId) + '/runs/' + segment(input.runId) + '/feedback',
    { decision: input.decision, note: input.note },
  );
}

export function cancelActestraTeamRun(teamId: string, runId: string, reason: string): Promise<NativeAionUiTeamRunState> {
  return httpRequest<NativeAionUiTeamRunState>(
    'POST',
    '/api/teams/' + segment(teamId) + '/runs/' + segment(runId) + '/cancel',
    { reason },
  );
}
`,
);

writeNew(
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx",
  `import { Button, Input, Message, Radio } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { TTeam } from '@/common/types/team/teamTypes';
import AionModal from '@renderer/components/base/AionModal';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (team: TTeam) => void;
};

const WORKSPACE_REFERENCE = /^workspace-[A-Za-z0-9][A-Za-z0-9._:-]{0,117}$/u;

const ActestraTeamCreateModal: React.FC<Props> = ({ visible, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [generalName, setGeneralName] = useState('General');
  const [gooseName, setGooseName] = useState('Goose');
  const [leader, setLeader] = useState<'general' | 'coding'>('general');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLeader('general');
  }, [visible]);

  const valid = useMemo(
    () =>
      name.trim().length > 0 &&
      generalName.trim().length > 0 &&
      gooseName.trim().length > 0 &&
      WORKSPACE_REFERENCE.test(workspaceId.trim()),
    [generalName, gooseName, name, workspaceId],
  );

  const close = () => {
    setName('');
    setWorkspaceId('');
    setGeneralName('General');
    setGooseName('Goose');
    setLeader('general');
    onClose();
  };

  const create = async () => {
    if (!valid) {
      Message.warning(t('team.actestra.createInvalid', { defaultValue: 'Enter a Team name, member names, and an Actestra workspace reference such as workspace-project.' }));
      return;
    }
    setLoading(true);
    try {
      const team = await ipcBridge.team.create.invoke({
        user_id: 'actestra-local-user',
        name: name.trim(),
        workspace: workspaceId.trim(),
        workspace_mode: 'isolated',
        agents: [
          {
            role: leader === 'general' ? 'leader' : 'teammate',
            assistant_name: generalName.trim(),
            assistant_id: 'actestra-general-worker',
            model: 'default',
          },
          {
            role: leader === 'coding' ? 'leader' : 'teammate',
            assistant_name: gooseName.trim(),
            assistant_id: 'actestra-goose-worker',
            model: 'default',
          },
        ],
      });
      onCreated(team);
      close();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('team.create.error', { defaultValue: 'Failed to create Team' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AionModal
      variant='standard'
      visible={visible}
      onCancel={close}
      style={{ width: 720, maxWidth: 'calc(100vw - 32px)' }}
      wrapStyle={{ zIndex: 10000 }}
      maskStyle={{ zIndex: 9999 }}
      autoFocus={false}
      unmountOnExit={false}
      header={{
        title: t('team.actestra.createTitle', { defaultValue: 'Create Actestra Team' }),
        subtitle: t('team.actestra.createSubtitle', { defaultValue: 'General and Goose collaborate through Actestra Core in one isolated workspace.' }),
        showClose: true,
      }}
      footer={{
        render: () => (
          <div className='flex justify-end gap-10px'>
            <Button onClick={close}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
            <Button data-testid='actestra-team-create-submit' type='primary' loading={loading} disabled={!valid} onClick={() => void create()}>
              {t('team.actestra.createAction', { defaultValue: 'Create Team' })}
            </Button>
          </div>
        ),
      }}
    >
      <div data-testid='actestra-team-create-modal' className='flex flex-col gap-18px px-20px py-18px'>
        <div className='rounded-10px border border-solid border-[color:var(--border-base)] bg-fill-1 p-14px'>
          <div className='text-14px font-600 text-t-primary'>Actestra Core</div>
          <div className='mt-4px text-12px leading-18px text-t-tertiary'>Identity, plan, approvals, execution state, Artifacts, and recovery remain authoritative in Actestra.</div>
        </div>
        <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
          {t('team.create.nameLabel', { defaultValue: 'Team name' })}
          <Input data-testid='actestra-team-name-input' value={name} maxLength={120} onChange={setName} placeholder='Launch workspace' />
        </label>
        <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
          {t('team.actestra.workspaceReference', { defaultValue: 'Actestra workspace reference' })}
          <Input data-testid='actestra-team-workspace-input' value={workspaceId} onChange={setWorkspaceId} placeholder='workspace-project' />
          <span className='text-12px font-400 text-t-tertiary'>A reference is used here; renderer pages never receive a filesystem path.</span>
        </label>
        <div className='grid grid-cols-1 gap-12px md:grid-cols-2'>
          <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
            General Worker
            <Input data-testid='actestra-team-general-name' value={generalName} maxLength={120} onChange={setGeneralName} />
          </label>
          <label className='flex flex-col gap-6px text-13px font-500 text-t-secondary'>
            Goose coding Worker
            <Input data-testid='actestra-team-goose-name' value={gooseName} maxLength={120} onChange={setGooseName} />
          </label>
        </div>
        <div className='flex flex-col gap-8px'>
          <span className='text-13px font-500 text-t-secondary'>{t('team.actestra.leader', { defaultValue: 'Team leader' })}</span>
          <Radio.Group value={leader} onChange={(value) => setLeader(value as 'general' | 'coding')}>
            <Radio value='general'>General</Radio>
            <Radio value='coding'>Goose</Radio>
          </Radio.Group>
        </div>
      </div>
    </AionModal>
  );
};

export default ActestraTeamCreateModal;
`,
);

writeNew(
  "packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx",
  `import { Button, Empty, Input, Message, Progress, Spin, Tag } from '@arco-design/web-react';
import { CheckOne, CloseOne, Pause, Play, Refresh, TransferData, UserToUserTransmission } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import type { AionUiTeamEvent, NativeAionUiTeamNodeView, NativeAionUiTeamRunState } from '@/actestra/compatibility/aionui/teamBridge';
import type { TTeam } from '@/common/types/team/teamTypes';
import {
  cancelActestraTeamRun,
  controlActestraTeamNode,
  decideActestraTeamApproval,
  getActestraTeamRunState,
  resolveActestraTeamFeedback,
  submitActestraTeamTask,
  subscribeActestraTeamEvents,
  type ActestraTeamNodeAction,
} from '@/common/adapter/actestraTeamClient';

type Props = { team: TTeam };
type Activity = { id: string; author: string; content: string; tone: 'user' | 'system' | 'worker' };

function eventTeamId(event: AionUiTeamEvent): string | null {
  if ('team_id' in event.payload && typeof event.payload.team_id === 'string') return event.payload.team_id;
  return null;
}

function eventBelongsToTeam(event: AionUiTeamEvent, team: TTeam): boolean {
  const directTeamId = eventTeamId(event);
  if (directTeamId !== null) return directTeamId === team.id;
  return event.type === 'team.teammateMessage' && team.assistants.some(
    (assistant) => assistant.conversation_id === event.payload.conversation_id,
  );
}

function statusColor(status: string): 'blue' | 'green' | 'red' | 'orange' | 'gray' {
  if (status === 'completed') return 'green';
  if (status === 'failed' || status === 'cancelled') return 'red';
  if (status === 'blocked' || status === 'paused') return 'orange';
  if (status === 'running' || status === 'ready') return 'blue';
  return 'gray';
}

function actionLabel(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

const ActestraTeamWorkspace: React.FC<Props> = ({ team }) => {
  const { t } = useTranslation();
  const { data, error, isLoading, mutate } = useSWR<NativeAionUiTeamRunState>(
    'actestra-team-run/' + team.id,
    () => getActestraTeamRunState(team.id),
    { revalidateOnFocus: false },
  );
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [liveActivities, setLiveActivities] = useState<Activity[]>([]);

  useEffect(() =>
    subscribeActestraTeamEvents((event) => {
      if (!eventBelongsToTeam(event, team)) return;
      if (event.type === 'team.teammateMessage') {
        setLiveActivities((current) => [
          ...current,
          { id: event.payload.conversation_id + '-' + String(current.length), author: event.payload.from_name, content: event.payload.content, tone: 'worker' },
        ]);
      }
      void mutate();
    }),
  [mutate, team]);

  const run = data?.active_run ?? null;
  const nodes = run?.actestra.nodes ?? [];
  const activities = useMemo(() => {
    const byId = new Map<string, Activity>();
    for (const activity of data?.activities ?? []) byId.set(activity.id, activity);
    for (const activity of liveActivities) if (!byId.has(activity.id)) byId.set(activity.id, activity);
    return [...byId.values()];
  }, [data?.activities, liveActivities]);
  const progress = useMemo(() => {
    if (nodes.length === 0) return 0;
    return Math.round((nodes.filter((node) => node.state === 'completed').length / nodes.length) * 100);
  }, [nodes]);
  const currentExecutors = useMemo(
    () => [...new Set(nodes.filter((node) => ['ready', 'running', 'blocked', 'paused', 'handoff-required'].includes(node.state)).map((node) => node.current_executor))],
    [nodes],
  );

  const refresh = useCallback(async (next?: NativeAionUiTeamRunState) => {
    if (next) await mutate(next, false);
    else await mutate();
  }, [mutate]);

  const submit = async () => {
    const content = task.trim();
    if (!content || busy !== null) return;
    setBusy('submit');
    try {
      const ack = await submitActestraTeamTask(team.id, content);
      setLiveActivities((current) => [...current, { id: ack.message_id, author: 'You', content, tone: 'user' }]);
      setTask('');
      await refresh();
    } catch (submitError) {
      Message.error(submitError instanceof Error ? submitError.message : 'The supervised Team planner is unavailable.');
    } finally {
      setBusy(null);
    }
  };

  const control = async (node: NativeAionUiTeamNodeView, action: string) => {
    if (!run || busy !== null) return;
    const key = node.action_id + '-' + action;
    setBusy(key);
    try {
      let next: NativeAionUiTeamRunState;
      if (action === 'approve' || action === 'deny') {
        next = await decideActestraTeamApproval({
          teamId: team.id,
          runId: run.team_run_id,
          slotId: node.slot_id,
          decision: action === 'approve' ? 'approved' : 'denied',
        });
      } else {
        next = await controlActestraTeamNode({
          teamId: team.id,
          runId: run.team_run_id,
          slotId: node.slot_id,
          action: action as ActestraTeamNodeAction,
          reason: 'User requested ' + action + ' from the Actestra Team page.',
        });
      }
      await refresh(next);
    } catch (controlError) {
      Message.error(controlError instanceof Error ? controlError.message : 'The Team control failed.');
    } finally {
      setBusy(null);
    }
  };

  const resolveFeedback = async (decision: 'approved' | 'denied') => {
    if (!run || busy !== null) return;
    setBusy('feedback-' + decision);
    try {
      await refresh(await resolveActestraTeamFeedback({
        teamId: team.id,
        runId: run.team_run_id,
        decision,
        note: decision === 'approved' ? 'Continue from Team feedback.' : 'Revise from Team feedback.',
      }));
    } catch (feedbackError) {
      Message.error(feedbackError instanceof Error ? feedbackError.message : 'The Team feedback failed.');
    } finally {
      setBusy(null);
    }
  };

  const cancelRun = async () => {
    if (!run || busy !== null) return;
    setBusy('cancel-run');
    try {
      await refresh(await cancelActestraTeamRun(team.id, run.team_run_id, 'User cancelled the whole Team from the Actestra Team page.'));
    } catch (cancelError) {
      Message.error(cancelError instanceof Error ? cancelError.message : 'The Team could not be cancelled.');
    } finally {
      setBusy(null);
    }
  };

  if (isLoading) return <div className='flex h-full items-center justify-center'><Spin loading /></div>;

  return (
    <main data-testid='actestra-team-workspace' className='flex h-full min-h-0 flex-col overflow-hidden bg-1'>
      <header className='flex flex-wrap items-center justify-between gap-12px border-b border-solid border-[color:var(--border-base)] px-18px py-14px'>
        <div className='min-w-0'>
          <div className='flex items-center gap-8px'>
            <h1 className='m-0 truncate text-18px font-600 text-t-primary'>{team.name}</h1>
            <Tag color='arcoblue'>Actestra Team</Tag>
            {run && <Tag color={statusColor(run.status)}>{run.status}</Tag>}
          </div>
          <p className='m-0 mt-4px text-12px text-t-tertiary'>{team.workspace} · schema-15 Team authority</p>
        </div>
        <div className='flex items-center gap-8px'>
          <Button icon={<Refresh />} onClick={() => void refresh()}>{t('common.refresh', { defaultValue: 'Refresh' })}</Button>
          {run && !['completed', 'cancelled', 'failed'].includes(run.status) && (
            <Button status='danger' icon={<CloseOne />} loading={busy === 'cancel-run'} onClick={() => void cancelRun()}>
              {t('team.actestra.cancelWholeTeam', { defaultValue: 'Cancel Team' })}
            </Button>
          )}
        </div>
      </header>

      <section className='grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[260px_minmax(360px,1fr)_minmax(320px,420px)]'>
        <aside className='border-b border-solid border-[color:var(--border-base)] p-16px xl:border-b-0 xl:border-r'>
          <h2 className='m-0 text-14px font-600 text-t-primary'>{t('team.actestra.members', { defaultValue: 'Members and roles' })}</h2>
          <div className='mt-12px flex flex-col gap-10px'>
            {team.assistants.map((assistant) => (
              <article key={assistant.slot_id} className='rounded-10px border border-solid border-[color:var(--border-base)] bg-fill-1 p-12px'>
                <div className='flex items-center justify-between gap-8px'>
                  <span className='font-600 text-t-primary'>{assistant.assistant_name}</span>
                  <Tag color={assistant.assistant_backend === 'goose' ? 'orange' : 'blue'}>{assistant.assistant_backend === 'goose' ? 'Goose' : 'General'}</Tag>
                </div>
                <div className='mt-6px flex items-center justify-between text-12px text-t-tertiary'>
                  <span>{assistant.role === 'leader' ? 'Leader' : 'Teammate'}</span>
                  <span>{assistant.status}</span>
                </div>
              </article>
            ))}
          </div>
          <div className='mt-14px rounded-10px bg-fill-1 p-12px text-12px leading-18px text-t-secondary'>
            <div className='font-600 text-t-primary'>Authority source</div>
            <div className='mt-4px'>Actestra Core owns Team identity, plan, approvals, attempts, Artifacts, and recovery.</div>
            <div className='mt-8px font-600 text-t-primary'>Current executor</div>
            <div className='mt-4px' data-testid='actestra-team-current-executor'>{currentExecutors.length > 0 ? currentExecutors.join(' + ') : 'None'}</div>
          </div>
        </aside>

        <section className='flex min-h-520px flex-col border-b border-solid border-[color:var(--border-base)] xl:border-b-0 xl:border-r'>
          <div className='border-b border-solid border-[color:var(--border-base)] px-16px py-12px'>
            <h2 className='m-0 text-14px font-600 text-t-primary'>{t('team.actestra.groupChat', { defaultValue: 'Team group chat' })}</h2>
            <p className='m-0 mt-3px text-12px text-t-tertiary'>Give the Team one bounded goal. General and Goose updates remain linked to the same authoritative run.</p>
          </div>
          <div className='flex flex-1 flex-col gap-12px overflow-y-auto p-16px' data-testid='actestra-team-activity'>
            {activities.length === 0 && run === null ? (
              <Empty description='No Team run yet. Enter a task below to start planning.' />
            ) : (
              <>
                {run && (
                  <div className='max-w-[92%] self-start rounded-12px bg-fill-2 px-13px py-10px text-13px text-t-secondary'>
                    <div className='mb-3px text-11px font-600 uppercase tracking-wide text-t-tertiary'>Actestra Core · recovered revision {run.actestra.revision}</div>
                    {run.actestra.status_explanation}
                  </div>
                )}
                {activities.map((activity) => (
                  <div key={activity.id} className={'max-w-[88%] rounded-12px px-13px py-10px text-13px ' + (activity.tone === 'user' ? 'self-end bg-primary-6 text-white' : 'self-start bg-fill-2 text-t-primary')}>
                    <div className={'mb-3px text-11px font-600 ' + (activity.tone === 'user' ? 'text-white/80' : 'text-t-tertiary')}>{activity.author}</div>
                    {activity.content}
                  </div>
                ))}
              </>
            )}
          </div>
          <div className='border-t border-solid border-[color:var(--border-base)] p-12px'>
            <Input.TextArea
              data-testid='actestra-team-task-input'
              value={task}
              maxLength={16 * 1024}
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={busy !== null || Boolean(run && !['completed', 'cancelled', 'failed'].includes(run.status))}
              placeholder='Describe the Team goal, expected result, and constraints…'
              onChange={setTask}
            />
            <div className='mt-8px flex items-center justify-between gap-8px'>
              <span className='text-11px text-t-tertiary'>Text only · no renderer paths, models, credentials, or Worker IDs</span>
              <Button data-testid='actestra-team-run-submit' type='primary' icon={<Play />} loading={busy === 'submit'} disabled={!task.trim()} onClick={() => void submit()}>
                Run Team
              </Button>
            </div>
          </div>
        </section>

        <aside className='p-16px'>
          <div className='flex items-center justify-between gap-8px'>
            <h2 className='m-0 text-14px font-600 text-t-primary'>Plan and Worker state</h2>
            {run && <span className='text-11px text-t-tertiary'>revision {run.actestra.revision}</span>}
          </div>
          {error && <div className='mt-12px rounded-8px bg-danger-1 p-10px text-12px text-danger-6'>Team authority is temporarily unavailable.</div>}
          {run ? (
            <>
              <Progress className='mt-12px' percent={progress} size='small' />
              <div className='mt-12px flex flex-col gap-10px'>
                {nodes.map((node) => (
                  <article key={node.action_id} data-testid={'actestra-team-node-' + node.action_id} className='rounded-10px border border-solid border-[color:var(--border-base)] p-12px'>
                    <div className='flex items-start justify-between gap-8px'>
                      <div>
                        <div className='text-13px font-600 text-t-primary'>{node.title}</div>
                        <div className='mt-3px text-11px text-t-tertiary'>{node.current_executor} · {node.capability}</div>
                      </div>
                      <Tag color={statusColor(node.state)}>{node.state}</Tag>
                    </div>
                    {node.depends_on_action_ids.length > 0 && <div className='mt-8px text-11px text-t-tertiary'>Depends on {node.depends_on_action_ids.length} earlier node(s)</div>}
                    {node.blocked_explanation && <div data-testid='actestra-team-blocked-reason' className='mt-8px rounded-8px bg-warning-1 p-8px text-12px text-warning-7'>{node.blocked_explanation}</div>}
                    {node.artifacts.length > 0 && (
                      <div className='mt-8px flex flex-wrap gap-6px'>{node.artifacts.map((artifact) => <Tag key={artifact.artifact_id} color='green'>Artifact · {artifact.label}</Tag>)}</div>
                    )}
                    <div className='mt-9px flex flex-wrap gap-6px'>
                      {node.next_actions.map((action) => (
                        <Button key={action} size='mini' loading={busy === node.action_id + '-' + action} icon={action === 'pause' ? <Pause /> : action === 'resume' || action === 'retry' ? <Refresh /> : action === 'handoff' ? <UserToUserTransmission /> : action === 'replace' ? <TransferData /> : action === 'approve' ? <CheckOne /> : action === 'cancel' || action === 'deny' ? <CloseOne /> : undefined} onClick={() => void control(node, action)}>
                          {actionLabel(action)}
                        </Button>
                      ))}
                      {node.capability === 'feedback' && node.state === 'ready' && (
                        <>
                          <Button size='mini' icon={<CheckOne />} onClick={() => void resolveFeedback('approved')}>Continue</Button>
                          <Button size='mini' icon={<Refresh />} onClick={() => void resolveFeedback('denied')}>Request changes</Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {run.actestra.result && (
                <section className='mt-14px rounded-10px border border-solid border-[color:var(--success-3)] bg-success-1 p-12px' data-testid='actestra-team-result'>
                  <h3 className='m-0 text-13px font-600 text-success-7'>Aggregated result</h3>
                  <p className='m-0 mt-6px text-12px text-t-secondary'>{run.actestra.result.summary}</p>
                  <div className='mt-8px flex flex-wrap gap-6px'>{run.actestra.result.artifacts.map((artifact) => <Tag key={artifact.artifact_id} color='green'>{artifact.label}</Tag>)}</div>
                </section>
              )}
            </>
          ) : (
            <div className='mt-18px'><Empty description='Plan, dependencies, blocked reasons, controls, and Artifacts will appear here.' /></div>
          )}
        </aside>
      </section>
    </main>
  );
};

export default ActestraTeamWorkspace;
`,
);

const createModalPath = "packages/desktop/src/renderer/pages/team/components/TeamCreateModal.tsx";
replaceOnce(
  createModalPath,
  `import TeamMemberDraftList, { type TeamMemberDraft } from './memberPicker/TeamMemberDraftList';`,
  `import TeamMemberDraftList, { type TeamMemberDraft } from './memberPicker/TeamMemberDraftList';
import { isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';
import ActestraTeamCreateModal from './ActestraTeamCreateModal';`,
);
replaceOnce(
  createModalPath,
  `const TeamCreateModal: React.FC<Props> =`,
  `const NativeTeamCreateModal: React.FC<Props> =`,
);
replaceOnce(
  createModalPath,
  `export default TeamCreateModal;`,
  `const TeamCreateModal: React.FC<Props> = (props) =>
  isActestraTeamProviderActive() ? <ActestraTeamCreateModal {...props} /> : <NativeTeamCreateModal {...props} />;

export default TeamCreateModal;`,
);

const teamListPath = "packages/desktop/src/renderer/pages/team/hooks/useTeamList.ts";
replaceOnce(
  teamListPath,
  `import { removeTeamWithCronCleanup } from '../utils/removeTeamAssistantWithCronCleanup';`,
  `import { removeTeamWithCronCleanup } from '../utils/removeTeamAssistantWithCronCleanup';
import { isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';`,
);
replaceOnce(
  teamListPath,
  `  const user_id = user?.id ?? 'system_default_user';`,
  `  const user_id = isActestraTeamProviderActive() ? 'actestra-local-user' : user?.id ?? 'system_default_user';`,
);

const teamPagePath = "packages/desktop/src/renderer/pages/team/TeamPage.tsx";
replaceOnce(
  teamPagePath,
  `import { usePreviewContext } from '@/renderer/pages/conversation/Preview';`,
  `import { usePreviewContext } from '@/renderer/pages/conversation/Preview';
import { isActestraTeamProviderActive } from '@/common/adapter/actestraTeamClient';
import ActestraTeamWorkspace from './components/ActestraTeamWorkspace';`,
);
replaceOnce(
  teamPagePath,
  `const TeamPage: React.FC<Props> = ({ team }) => {`,
  `const NativeTeamPage: React.FC<Props> = ({ team }) => {`,
);
replaceOnce(
  teamPagePath,
  `export default TeamPage;`,
  `const TeamPage: React.FC<Props> = ({ team }) =>
  isActestraTeamProviderActive() ? <ActestraTeamWorkspace team={team} /> : <NativeTeamPage team={team} />;

export default TeamPage;`,
);

writeNew(
  "tests/unit/actestra/teamNativeWiring.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Actestra AionUI-native Team wiring', () => {
  it('routes only exact Team paths and events through the fixed preload provider', () => {
    const http = read('packages/desktop/src/common/adapter/httpBridge.ts');
    const preload = read('packages/desktop/src/preload/main.ts');
    expect(http).toContain("ACTESTRA_TEAM_PATH = '/api/teams'");
    expect(http).toContain('return requestActestraTeam<T>(method, path, body)');
    expect(http).toContain('return teamEmitter<Params>(eventName)');
    expect(http.indexOf('if (isActestraTeamPath(path))')).toBeLessThan(http.indexOf('const approvalRoute = await routeActestraApprovalRequest'));
    expect(preload).toContain("contextBridge.exposeInMainWorld('actestraTeam'");
    expect(preload).toContain('ACTESTRA_TEAM_REQUEST_CHANNEL');
    expect(preload).toContain('ACTESTRA_TEAM_EVENT_CHANNEL');
    expect(preload).not.toContain('workspacePath: request');
    expect(preload).not.toContain('workerId: request');
  });

  it('keeps Team authority, recovery, IPC, and close ordering in desktop main', () => {
    const main = read('packages/desktop/src/process/services/actestraShadowBridge.ts');
    const composition = read('packages/desktop/src/process/services/actestraTeamComposition.ts');
    expect(main).toContain('new ActestraTeamComposition');
    expect(main).toContain('ACTESTRA_AIONUI_TEAM_RECOVERY_READY');
    expect(main).toContain('registerRecoveredTeamBridge');
    expect(composition).toContain('new TeamPlanAdmissionService');
    expect(composition).toContain('new TeamOrchestratorService');
    expect(composition).toContain('new TeamJourneyWorkerRouter');
    expect(composition).toContain('registerAionUiTeamBridgeIpc');
    expect(composition.indexOf('this.#service.close()')).toBeLessThan(composition.indexOf('this.#orchestrator?.close()'));
    expect(composition.indexOf('this.#orchestrator?.close()')).toBeLessThan(composition.indexOf('this.#planner?.close()'));
  });

  it('retains the native route and creation entry while adding a visible explainable control surface', () => {
    const page = read('packages/desktop/src/renderer/pages/team/TeamPage.tsx');
    const create = read('packages/desktop/src/renderer/pages/team/components/ActestraTeamCreateModal.tsx');
    const workspace = read('packages/desktop/src/renderer/pages/team/components/ActestraTeamWorkspace.tsx');
    expect(page).toContain('isActestraTeamProviderActive()');
    expect(page).toContain('<ActestraTeamWorkspace team={team} />');
    expect(create).toContain("assistant_id: 'actestra-general-worker'");
    expect(create).toContain("assistant_id: 'actestra-goose-worker'");
    expect(create).toContain("workspace_mode: 'isolated'");
    for (const marker of [
      "data-testid='actestra-team-workspace'",
      "data-testid='actestra-team-current-executor'",
      "data-testid='actestra-team-blocked-reason'",
      "data-testid='actestra-team-result'",
      "data-testid='actestra-team-run-submit'",
    ]) expect(workspace).toContain(marker);
    for (const control of ['pause', 'resume', 'cancel', 'retry', 'replace', 'handoff', 'approve', 'deny']) {
      expect(workspace).toContain(control);
    }
    expect(workspace).not.toContain('auditRecordId');
    expect(workspace).not.toContain('workerId');
    expect(workspace).not.toContain('repositoryRoot');
  });
});
  `,
);

replaceOnce(
  "tests/unit/actestra/persistenceUtilityClient.test.ts",
  `    expect(client.schemaVersion).toBe(14);`,
  `    expect(client.schemaVersion).toBe(15);`,
);

writeNew(
  "tests/unit/renderer/team/ActestraTeamWorkspace.dom.test.tsx",
  `// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AionUiTeamEvent, NativeAionUiTeamRunState } from '@/actestra/compatibility/aionui/teamBridge';
import type { TTeam } from '@/common/types/team/teamTypes';
import ActestraTeamWorkspace from '@/renderer/pages/team/components/ActestraTeamWorkspace';

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  submit: vi.fn(),
  control: vi.fn(),
  approval: vi.fn(),
  feedback: vi.fn(),
  cancel: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

let teamEventHandler: ((event: AionUiTeamEvent) => void) | null = null;

vi.mock('@/common/adapter/actestraTeamClient', () => ({
  getActestraTeamRunState: mocks.getState,
  submitActestraTeamTask: mocks.submit,
  controlActestraTeamNode: mocks.control,
  decideActestraTeamApproval: mocks.approval,
  resolveActestraTeamFeedback: mocks.feedback,
  cancelActestraTeamRun: mocks.cancel,
  subscribeActestraTeamEvents: mocks.subscribe,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

const team = {
  id: 'team-' + '1'.repeat(64),
  user_id: 'actestra-local-user',
  name: 'Launch Team',
  workspace: 'workspace-project',
  workspace_mode: 'isolated',
  leader_assistant_id: 'team-member-' + '2'.repeat(64),
  assistants: [
    { slot_id: 'team-member-' + '2'.repeat(64), conversation_id: 'actestra-team-conversation-general', role: 'leader', assistant_backend: 'general', assistant_name: 'General', status: 'active', assistant_id: 'actestra-general-worker', model: 'default', pending_confirmations: 0 },
    { slot_id: 'team-member-' + '3'.repeat(64), conversation_id: 'actestra-team-conversation-goose', role: 'teammate', assistant_backend: 'goose', assistant_name: 'Goose', status: 'active', assistant_id: 'actestra-goose-worker', model: 'default', pending_confirmations: 1 },
  ],
  session_mode: 'plan',
  created_at: 1,
  updated_at: 2,
} as TTeam;

const runState = {
  session_generation: 'schema-15-revision-7',
  active_run: {
    team_id: team.id,
    team_run_id: 'team-run-' + '4'.repeat(64),
    source: 'system_lifecycle',
    has_user_intervention: true,
    target_slot_id: team.assistants[0]!.slot_id,
    target_role: 'lead',
    status: 'running',
    queued_intent_count: 0,
    starting_batch_count: 0,
    running_batch_count: 1,
    active_enqueue_lease_count: 1,
    slot_work: [],
    actestra: {
      authority: 'Actestra Core',
      authority_source: 'schema-15-team-run',
      revision: 7,
      status_explanation: 'Goose is waiting for protected approval.',
      nodes: [
        {
          action_id: 'team-action-coding',
          slot_id: team.assistants[1]!.slot_id,
          title: 'Implement the isolated change',
          capability: 'coding',
          state: 'blocked',
          depends_on_action_ids: ['team-action-research'],
          blocked_reason: 'protected-approval',
          blocked_explanation: 'Approve the protected write before Goose continues.',
          current_executor: 'Goose',
          next_actions: ['approve', 'deny', 'cancel'],
          artifacts: [{ artifact_id: 'artifact-' + '5'.repeat(64), kind: 'file', label: 'Patch preview' }],
        },
      ],
      result: null,
    },
  },
  slot_work: [],
  activities: [
    {
      id: 'team-message-' + '6'.repeat(64),
      author: 'You',
      content: 'Prepare the recovered Team result.',
      tone: 'user',
      occurred_at: 1,
    },
    {
      id: 'team-activity-' + '7'.repeat(64),
      author: 'Goose',
      content: 'Goose recovered its persisted coding summary.',
      tone: 'worker',
      occurred_at: 2,
    },
  ],
} satisfies NativeAionUiTeamRunState;

function renderWorkspace() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ActestraTeamWorkspace team={team} />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  teamEventHandler = null;
  mocks.subscribe.mockImplementation((handler: (event: AionUiTeamEvent) => void) => {
    teamEventHandler = handler;
    return () => {
      if (teamEventHandler === handler) teamEventHandler = null;
    };
  });
  mocks.getState.mockResolvedValue(runState);
  mocks.approval.mockResolvedValue(runState);
});

describe('Actestra Team workspace', () => {
  it('shows authority, executor, dependency, blocked reason, actions, and Artifact references', async () => {
    renderWorkspace();
    expect(await screen.findByText('Launch Team')).toBeTruthy();
    expect(screen.getByText('Actestra Core · recovered revision 7')).toBeTruthy();
    expect(screen.getByTestId('actestra-team-current-executor').textContent).toContain('Goose');
    expect(screen.getByTestId('actestra-team-blocked-reason').textContent).toContain('protected write');
    expect(screen.getByText('Depends on 1 earlier node(s)')).toBeTruthy();
    expect(screen.getByText('Artifact · Patch preview')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('routes approval through the fixed Actestra Team control client', async () => {
    renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(mocks.approval).toHaveBeenCalledWith({
      teamId: team.id,
      runId: runState.active_run!.team_run_id,
      slotId: team.assistants[1]!.slot_id,
      decision: 'approved',
    }));
  });

  it('restores durable user and Worker activity from the recovered run state', async () => {
    const first = renderWorkspace();
    expect(await screen.findByText('Prepare the recovered Team result.')).toBeTruthy();
    expect(screen.getByText('Goose recovered its persisted coding summary.')).toBeTruthy();
    first.unmount();

    renderWorkspace();
    expect(await screen.findByText('Prepare the recovered Team result.')).toBeTruthy();
    expect(screen.getByText('Goose recovered its persisted coding summary.')).toBeTruthy();
  });

  it('shows only teammate messages owned by this Team conversation', async () => {
    renderWorkspace();
    expect(await screen.findByText('Launch Team')).toBeTruthy();
    act(() => teamEventHandler?.({
      type: 'team.teammateMessage',
      payload: {
        conversation_id: team.assistants[0]!.conversation_id,
        content: 'General finished the bounded research node.',
        from_slot_id: team.assistants[0]!.slot_id,
        from_name: 'General',
      },
    }));
    expect(await screen.findByText('General finished the bounded research node.')).toBeTruthy();

    act(() => teamEventHandler?.({
      type: 'team.teammateMessage',
      payload: {
        conversation_id: 'actestra-team-conversation-other',
        content: 'Other Team private message',
        from_slot_id: team.assistants[0]!.slot_id,
        from_name: 'Other',
      },
    }));
    expect(screen.queryByText('Other Team private message')).toBeNull();
  });
});
`,
);
