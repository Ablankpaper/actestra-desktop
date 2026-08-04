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

const bridgePath = "packages/desktop/src/process/services/actestraShadowBridge.ts";

replaceOnce(
  bridgePath,
  `import {
  createIsolatedCodingMainService,
  type IsolatedCodingMainService,
} from '@/actestra/main/workers/isolatedCodingMainService';`,
  `import {
  createIsolatedCodingMainService,
  type IsolatedCodingMainService,
} from '@/actestra/main/workers/isolatedCodingMainService';
import {
  AionUiCodingAgentService,
  type AionUiCodingRunnerAdmission,
} from '@/actestra/main/compatibility/aionuiCodingAgentService';
import { AionUiCodingJourneyService } from '@/actestra/main/compatibility/aionuiCodingJourneyService';
import { AionUiCodingJourneyBridgeService } from '@/actestra/main/compatibility/aionuiCodingJourneyBridgeService';
import type { GooseLoopbackModelInvoker } from '@/actestra/main/workers/gooseLoopbackModelServer';
import type { IsolatedCodingProcessDefinition } from '@/actestra/main/privileged/isolatedCodingToolPlatform';`,
);

replaceOnce(
  bridgePath,
  `import {
  ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL,`,
  `import {
  ACTESTRA_CODING_AGENT_PROBE_CHANNEL,
  ACTESTRA_CODING_AGENT_STATUS_CHANNEL,
  AIONUI_CODING_AGENT_CONTRACT_VERSION,
  ACTESTRA_GOOSE_MANAGED_AGENT_ID,
  ACTESTRA_GOOSE_MANAGED_AGENT_NAME,
  assertAionUiCodingAgentRequest,
  type AionUiCodingAgentProjection,
} from '@/actestra/compatibility/aionui/codingAgent';
import {
  ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL,
  ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL,
  ACTESTRA_CODING_JOURNEY_LIST_CHANNEL,
  ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL,
  ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL,
  type AionUiCodingJourneyBridgeResult,
} from '@/actestra/compatibility/aionui/codingJourney';
import {
  ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL,`,
);

replaceOnce(
  bridgePath,
  `let isolatedCodingMainService: IsolatedCodingMainService | null = null;
let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;`,
  `let isolatedCodingMainService: IsolatedCodingMainService | null = null;
let codingAgentService: AionUiCodingAgentService | null = null;
let codingJourneyService: AionUiCodingJourneyService | null = null;
let codingJourneyBridgeService: AionUiCodingJourneyBridgeService | null = null;
let generalWorkJourneyService: AionUiGeneralWorkJourneyService | null = null;`,
);

replaceOnce(
  bridgePath,
  `let generalWorkHandlersRegistered = false;
let approvalRecoveryStarted = false;`,
  `let generalWorkHandlersRegistered = false;
let codingAgentHandlersRegistered = false;
let codingJourneyHandlersRegistered = false;
let approvalRecoveryStarted = false;`,
);

replaceOnce(
  bridgePath,
  `const approvalReconciliationGateEnabled =
  process.env.ACTESTRA_APPROVAL_RECONCILIATION_GATE !== '0';`,
  `const approvalReconciliationGateEnabled =
  process.env.ACTESTRA_APPROVAL_RECONCILIATION_GATE !== '0';

function resolveCodingRunnerAdmission(
  environment: NodeJS.ProcessEnv,
): AionUiCodingRunnerAdmission | undefined {
  const directory = environment.ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY?.trim();
  const trustedManifestSha256 =
    environment.ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256?.trim();
  const expectedTargetTriple =
    environment.ACTESTRA_GOOSE_RUNNER_TARGET_TRIPLE?.trim();
  if (!directory || !trustedManifestSha256 || !expectedTargetTriple) {
    return undefined;
  }
  return Object.freeze({
    directory,
    trustedManifestSha256,
    expectedTargetTriple,
  });
}

const codingRunnerAdmission = resolveCodingRunnerAdmission(process.env);

export interface AionUiCodingJourneyRuntime {
  readonly privateRootParent: string;
  readonly modelId: string;
  readonly modelInvoker: GooseLoopbackModelInvoker;
  readonly commands: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
  readonly tests: Readonly<Record<string, IsolatedCodingProcessDefinition>>;
}

let codingJourneyRuntime: AionUiCodingJourneyRuntime | null = null;

export function configureActestraCodingJourneyRuntime(
  runtime: AionUiCodingJourneyRuntime | null,
): void {
  if (persistence !== null) {
    throw new Error('Actestra coding journey runtime must be injected before persistence startup');
  }
  codingJourneyRuntime = runtime;
}`,
);

replaceOnce(
  bridgePath,
  `const generalWorkUnavailable = (): AionUiGeneralWorkBridgeResult => ({
  status: 'rejected',
  code: 'persistence-unavailable',
});`,
  `const generalWorkUnavailable = (): AionUiGeneralWorkBridgeResult => ({
  status: 'rejected',
  code: 'persistence-unavailable',
});

const codingAgentUnavailable = (): AionUiCodingAgentProjection => ({
  contractVersion: AIONUI_CODING_AGENT_CONTRACT_VERSION,
  agentId: ACTESTRA_GOOSE_MANAGED_AGENT_ID,
  displayName: ACTESTRA_GOOSE_MANAGED_AGENT_NAME,
  status: 'unavailable',
  reason: 'main-unavailable',
});

const codingJourneyUnavailable = (): AionUiCodingJourneyBridgeResult => ({
  status: 'rejected',
  code: 'agent-unavailable',
});`,
);

replaceOnce(
  bridgePath,
  `async function submitGeneralWork(
  event: IpcMainInvokeEvent,`,
  `async function readCodingAgentStatus(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingAgentProjection> {
  if (!ownsMainFrame(event, extraArguments)) {
    return codingAgentUnavailable();
  }
  try {
    assertAionUiCodingAgentRequest(request);
    return await (codingAgentService?.status() ?? codingAgentUnavailable());
  } catch {
    return codingAgentUnavailable();
  }
}

async function probeCodingAgent(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingAgentProjection> {
  if (!ownsMainFrame(event, extraArguments)) {
    return codingAgentUnavailable();
  }
  try {
    assertAionUiCodingAgentRequest(request);
    return await (codingAgentService?.probe() ?? codingAgentUnavailable());
  } catch {
    return codingAgentUnavailable();
  }
}

function trustedCodingJourneyBridge(
  event: IpcMainInvokeEvent,
  extraArguments: readonly unknown[],
): AionUiCodingJourneyBridgeService | null {
  if (!ownsMainFrame(event, extraArguments)) {
    return null;
  }
  return codingJourneyBridgeService;
}

async function submitCodingJourney(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingJourneyBridgeResult> {
  return trustedCodingJourneyBridge(event, extraArguments)?.submit(request) ?? codingJourneyUnavailable();
}

async function listCodingJourney(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingJourneyBridgeResult> {
  return trustedCodingJourneyBridge(event, extraArguments)?.list(request) ?? codingJourneyUnavailable();
}

async function cancelCodingJourney(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingJourneyBridgeResult> {
  return trustedCodingJourneyBridge(event, extraArguments)?.cancel(request) ?? codingJourneyUnavailable();
}

async function decideCodingJourneyApproval(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingJourneyBridgeResult> {
  return trustedCodingJourneyBridge(event, extraArguments)?.decideApproval(request) ?? codingJourneyUnavailable();
}

async function decideCodingJourneyPublish(
  event: IpcMainInvokeEvent,
  request: unknown,
  ...extraArguments: unknown[]
): Promise<AionUiCodingJourneyBridgeResult> {
  return trustedCodingJourneyBridge(event, extraArguments)?.decidePublish(request) ?? codingJourneyUnavailable();
}

async function submitGeneralWork(
  event: IpcMainInvokeEvent,`,
);

replaceOnce(
  bridgePath,
  `  isolatedCodingMainService = createIsolatedCodingMainService({
    persistence: activePersistence,
    clock: platform.clock,
    managedRoot: path.join(userDataPath, 'coding-worktrees'),
  });
  console.info('[Actestra isolated coding] Desktop-main containment ready');`,
  `  isolatedCodingMainService = createIsolatedCodingMainService({
    persistence: activePersistence,
    clock: platform.clock,
    managedRoot: path.join(userDataPath, 'coding-worktrees'),
  });
  codingAgentService = new AionUiCodingAgentService({
    getMainService: () => isolatedCodingMainService,
    ...(codingRunnerAdmission === undefined
      ? {}
      : { runnerAdmission: codingRunnerAdmission }),
  });
  console.info('[Actestra isolated coding] Desktop-main containment ready');`,
);

replaceOnce(
  bridgePath,
  `    isolatedCodingMainService = null;
    await scheduleService?.close().catch((): undefined => undefined);`,
  `    isolatedCodingMainService = null;
    codingAgentService = null;
    codingJourneyService = null;
    codingJourneyBridgeService = null;
    await scheduleService?.close().catch((): undefined => undefined);`,
);

replaceOnce(
  bridgePath,
  `  const journey = new AionUiGeneralWorkJourneyService({`,
  `  const activeCodingRuntime = codingJourneyRuntime;
  if (activeCodingRuntime !== null) {
    codingJourneyService = new AionUiCodingJourneyService({
      persistence: activePersistence,
      clock: platform.clock,
      nativeContext,
      codingAgent: codingAgentService,
      getMainService: () => isolatedCodingMainService,
      privateRootParent: activeCodingRuntime.privateRootParent,
      modelId: activeCodingRuntime.modelId,
      modelInvoker: activeCodingRuntime.modelInvoker,
      commands: activeCodingRuntime.commands,
      tests: activeCodingRuntime.tests,
    });
    codingJourneyBridgeService = new AionUiCodingJourneyBridgeService(codingJourneyService);
  }
  const journey = new AionUiGeneralWorkJourneyService({`,
);

replaceOnce(
  bridgePath,
  `  if (!generalWorkHandlersRegistered) {
    ipcMain.handle(ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL, submitGeneralWork);`,
  `  if (!codingAgentHandlersRegistered) {
    ipcMain.handle(ACTESTRA_CODING_AGENT_STATUS_CHANNEL, readCodingAgentStatus);
    ipcMain.handle(ACTESTRA_CODING_AGENT_PROBE_CHANNEL, probeCodingAgent);
    codingAgentHandlersRegistered = true;
  }
  if (!codingJourneyHandlersRegistered) {
    ipcMain.handle(ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL, submitCodingJourney);
    ipcMain.handle(ACTESTRA_CODING_JOURNEY_LIST_CHANNEL, listCodingJourney);
    ipcMain.handle(ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL, cancelCodingJourney);
    ipcMain.handle(
      ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL,
      decideCodingJourneyApproval,
    );
    ipcMain.handle(
      ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL,
      decideCodingJourneyPublish,
    );
    codingJourneyHandlersRegistered = true;
  }
  if (!generalWorkHandlersRegistered) {
    ipcMain.handle(ACTESTRA_GENERAL_WORK_SUBMIT_CHANNEL, submitGeneralWork);`,
);

replaceOnce(
  bridgePath,
  `  const activeIsolatedCoding = isolatedCodingMainService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;`,
  `  const activeCodingJourney = codingJourneyService;
  const activeIsolatedCoding = isolatedCodingMainService;
  const disposeScheduleBridge = disposeScheduleBridgeIpc;`,
);

replaceOnce(
  bridgePath,
  `  nativeToolPlatform = null;
  generalWorkJourneyService = null;`,
  `  nativeToolPlatform = null;
  codingAgentService = null;
  codingJourneyBridgeService = null;
  generalWorkJourneyService = null;`,
);

replaceOnce(
  bridgePath,
  `  let isolatedCodingCloseFailed = false;
  let isolatedCodingCloseError: unknown;
  try {
    await activeIsolatedCoding?.close();`,
  `  let codingJourneyCloseError: unknown;
  try {
    await activeCodingJourney?.close();
    codingJourneyService = null;
  } catch (error) {
    codingJourneyCloseError = error;
  }
  let isolatedCodingCloseFailed = false;
  let isolatedCodingCloseError: unknown;
  try {
    await activeIsolatedCoding?.close();`,
);

replaceOnce(
  bridgePath,
  `  if (isolatedCodingCloseFailed) {
    throw isolatedCodingCloseError;
  }
  persistence = null;`,
  `  if (codingJourneyCloseError !== undefined || isolatedCodingCloseFailed) {
    throw new AggregateError(
      [codingJourneyCloseError, isolatedCodingCloseError].filter(
        (error): error is unknown => error !== undefined,
      ),
      'Actestra coding journey shutdown failed',
    );
  }
  persistence = null;`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `import {
  ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL,`,
  `import {
  ACTESTRA_CODING_AGENT_PROBE_CHANNEL,
  ACTESTRA_CODING_AGENT_STATUS_CHANNEL,
  type AionUiCodingAgentRequest,
} from '../actestra/compatibility/aionui/codingAgent';
import {
  ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL,
  ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL,
  ACTESTRA_CODING_JOURNEY_LIST_CHANNEL,
  ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL,
  ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL,
  type AionUiCodingJourneyApprovalDecisionRequest,
  type AionUiCodingJourneyCancelRequest,
  type AionUiCodingJourneyListRequest,
  type AionUiCodingJourneyPublishDecisionRequest,
  type AionUiCodingJourneySubmitRequest,
} from '../actestra/compatibility/aionui/codingJourney';
import {
  ACTESTRA_GENERAL_WORK_CANCEL_CHANNEL,`,
);

replaceOnce(
  "packages/desktop/src/preload/main.ts",
  `contextBridge.exposeInMainWorld('actestraGeneralWork', {`,
  `contextBridge.exposeInMainWorld('actestraCodingAgent', {
  status: (request: AionUiCodingAgentRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_AGENT_STATUS_CHANNEL, request),
  probe: (request: AionUiCodingAgentRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_AGENT_PROBE_CHANNEL, request),
});

contextBridge.exposeInMainWorld('actestraCodingJourney', {
  submit: (request: AionUiCodingJourneySubmitRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL, request),
  list: (request: AionUiCodingJourneyListRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_JOURNEY_LIST_CHANNEL, request),
  cancel: (request: AionUiCodingJourneyCancelRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL, request),
  decideApproval: (request: AionUiCodingJourneyApprovalDecisionRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL, request),
  decidePublish: (request: AionUiCodingJourneyPublishDecisionRequest) =>
    ipcRenderer.invoke(ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL, request),
});

contextBridge.exposeInMainWorld('actestraGeneralWork', {`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraCodingAgentClient.ts",
  `import {
  ACTESTRA_GOOSE_MANAGED_AGENT_ID,
  AIONUI_CODING_AGENT_CONTRACT_VERSION,
  assertAionUiCodingAgentProjection,
  type AionUiCodingAgentProjection,
} from '@/actestra/compatibility/aionui/codingAgent';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

const request = Object.freeze({
  contractVersion: AIONUI_CODING_AGENT_CONTRACT_VERSION,
});

function unavailableProjection(): AionUiCodingAgentProjection {
  return {
    contractVersion: AIONUI_CODING_AGENT_CONTRACT_VERSION,
    agentId: ACTESTRA_GOOSE_MANAGED_AGENT_ID,
    displayName: 'Goose coding',
    status: 'unavailable',
    reason: 'main-unavailable',
  };
}

async function invoke(
  operation: (bridge: NonNullable<Window['actestraCodingAgent']>) => Promise<unknown>,
): Promise<AionUiCodingAgentProjection | null> {
  if (typeof window === 'undefined' || window.actestraCodingAgent === undefined) {
    return null;
  }
  try {
    const projection = await operation(window.actestraCodingAgent);
    assertAionUiCodingAgentProjection(projection);
    return projection;
  } catch {
    return unavailableProjection();
  }
}

export function readActestraCodingAgent(): Promise<AionUiCodingAgentProjection | null> {
  return invoke((bridge) => bridge.status(request));
}

export async function probeActestraCodingAgent(): Promise<AionUiCodingAgentProjection> {
  return (await invoke((bridge) => bridge.probe(request))) ?? unavailableProjection();
}

function diagnosticMessage(projection: AionUiCodingAgentProjection): string | undefined {
  if (projection.status === 'ready') return undefined;
  switch (projection.reason) {
    case 'runner-not-configured':
      return 'The admitted Actestra Goose runner is not configured for this desktop build.';
    case 'runner-missing':
      return 'The admitted Actestra Goose runner artifact is missing.';
    case 'runner-incompatible':
      return 'The Goose runner failed the pinned version, digest, SBOM, or audit contract.';
    case 'runner-admission-failed':
      return 'The Goose runner could not be admitted safely.';
    default:
      return 'Actestra Core coding authority is unavailable.';
  }
}

export function projectActestraCodingAgent(
  projection: AionUiCodingAgentProjection,
  checkKind: 'startup' | 'manual' = 'startup',
): ManagedAgent {
  const ready = projection.status === 'ready';
  const missing = projection.status === 'missing';
  const errorCode =
    projection.status === 'ready'
      ? undefined
      : projection.reason === 'main-unavailable'
        ? 'actestra_main_unavailable'
        : projection.reason === 'runner-not-configured' || projection.reason === 'runner-missing'
          ? 'actestra_runner_missing'
          : 'actestra_runner_incompatible';
  return {
    id: ACTESTRA_GOOSE_MANAGED_AGENT_ID,
    icon: '🪿',
    name: projection.displayName,
    description: 'Isolated coding worker managed by Actestra Core.',
    backend: ACTESTRA_GOOSE_MANAGED_AGENT_ID,
    agent_type: 'acp',
    agent_source: 'internal',
    agent_source_info: {
      binary_name: 'actestra-goose-runner',
      ...(ready ? { version: projection.runnerVersion } : {}),
    },
    enabled: true,
    installed: ready || projection.status === 'incompatible',
    team_capable: false,
    status: ready ? 'online' : missing ? 'missing' : 'offline',
    last_check_status: ready ? 'online' : 'offline',
    last_check_kind: checkKind,
    ...(errorCode === undefined ? {} : { last_check_error_code: errorCode }),
    ...(ready ? {} : { last_check_error_message: diagnosticMessage(projection) }),
  };
}

export function mergeActestraCodingAgent(
  agents: readonly ManagedAgent[],
  projection: AionUiCodingAgentProjection,
  checkKind: 'startup' | 'manual' = 'startup',
): ManagedAgent[] {
  return [
    ...agents.filter((agent) => agent.id !== ACTESTRA_GOOSE_MANAGED_AGENT_ID),
    projectActestraCodingAgent(projection, checkKind),
  ];
}

export async function probeActestraCodingManagedAgent(): Promise<ManagedAgent> {
  return projectActestraCodingAgent(await probeActestraCodingAgent(), 'manual');
}
`,
);

writeNew(
  "packages/desktop/src/common/adapter/actestraCodingJourneyClient.ts",
  `import {
  assertAionUiCodingJourneyBridgeResult,
  type AionUiCodingJourneyApprovalDecisionRequest,
  type AionUiCodingJourneyBridgeResult,
  type AionUiCodingJourneyCancelRequest,
  type AionUiCodingJourneyListRequest,
  type AionUiCodingJourneyPublishDecisionRequest,
  type AionUiCodingJourneySubmitRequest,
} from '@/actestra/compatibility/aionui/codingJourney';

const unavailable = (): AionUiCodingJourneyBridgeResult => ({
  status: 'rejected',
  code: 'agent-unavailable',
});

async function invoke(
  operation: (bridge: NonNullable<Window['actestraCodingJourney']>) => Promise<unknown>,
): Promise<AionUiCodingJourneyBridgeResult> {
  if (typeof window === 'undefined' || window.actestraCodingJourney === undefined) {
    return unavailable();
  }
  try {
    const result = await operation(window.actestraCodingJourney);
    assertAionUiCodingJourneyBridgeResult(result);
    return result;
  } catch {
    return { status: 'rejected', code: 'execution-failed' };
  }
}

export function submitActestraCodingJourney(
  request: AionUiCodingJourneySubmitRequest,
): Promise<AionUiCodingJourneyBridgeResult> {
  return invoke((bridge) => bridge.submit(request));
}

export function listActestraCodingJourney(
  request: AionUiCodingJourneyListRequest,
): Promise<AionUiCodingJourneyBridgeResult> {
  return invoke((bridge) => bridge.list(request));
}

export function cancelActestraCodingJourney(
  request: AionUiCodingJourneyCancelRequest,
): Promise<AionUiCodingJourneyBridgeResult> {
  return invoke((bridge) => bridge.cancel(request));
}

export function decideActestraCodingJourneyApproval(
  request: AionUiCodingJourneyApprovalDecisionRequest,
): Promise<AionUiCodingJourneyBridgeResult> {
  return invoke((bridge) => bridge.decideApproval(request));
}

export function decideActestraCodingJourneyPublish(
  request: AionUiCodingJourneyPublishDecisionRequest,
): Promise<AionUiCodingJourneyBridgeResult> {
  return invoke((bridge) => bridge.decidePublish(request));
}
`,
);

writeNew(
  "packages/desktop/src/renderer/hooks/chat/actestraCodingJourneyProjection.ts",
  `import type {
  AionUiCodingJourneyApprovalProjection,
  AionUiCodingJourneyProjection,
  AionUiCodingJourneyToolContent,
  AionUiCodingJourneyToolProjection,
} from '@/actestra/compatibility/aionui/codingJourney';
import type { TMessage } from '@/common/chat/chatLib';

export interface ActestraCodingPermissionMetadata {
  readonly contractVersion: 1;
  readonly taskId: AionUiCodingJourneyProjection['taskId'];
  readonly approvalId: AionUiCodingJourneyApprovalProjection['approvalId'];
  readonly kind: 'tool' | 'publish';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readActestraCodingPermissionMetadata(
  value: unknown,
): ActestraCodingPermissionMetadata | null {
  if (!isRecord(value)) return null;
  const metadata = value.actestraCodingJourney;
  if (
    !isRecord(metadata) ||
    Object.keys(metadata).length !== 4 ||
    metadata.contractVersion !== 1 ||
    typeof metadata.taskId !== 'string' ||
    !metadata.taskId.startsWith('task-aionui-coding-') ||
    typeof metadata.approvalId !== 'string' ||
    !metadata.approvalId.startsWith('approval-') ||
    (metadata.kind !== 'tool' && metadata.kind !== 'publish')
  ) {
    return null;
  }
  return metadata as unknown as ActestraCodingPermissionMetadata;
}

function toolTitle(tool: AionUiCodingJourneyToolProjection): string {
  if (tool.surface === 'terminal') return 'Terminal · ' + tool.title;
  if (tool.surface === 'test') return 'Test · ' + tool.title;
  if (tool.surface === 'diff') return 'Diff · ' + tool.title;
  return tool.title;
}

function projectToolContent(content: AionUiCodingJourneyToolContent) {
  if (content.type === 'diff') {
    return {
      type: 'diff' as const,
      path: content.path,
      old_text: content.oldText ?? null,
      new_text: content.newText,
    };
  }
  const text =
    content.type === 'terminal'
      ? 'Terminal evidence: ' + content.terminalId
      : content.text;
  return {
    type: 'content' as const,
    content: { type: 'text' as const, text },
  };
}

function projectToolMessage(
  conversationId: string,
  projection: AionUiCodingJourneyProjection,
  tool: AionUiCodingJourneyToolProjection,
): TMessage {
  const messageId = 'actestra-coding-tool-' + projection.taskId + '-' + tool.toolCallId;
  return {
    id: messageId,
    msg_id: messageId,
    conversation_id: conversationId,
    type: 'acp_tool_call',
    position: 'left',
    created_at: Date.parse(projection.updatedAt),
    content: {
      session_id: projection.taskId,
      update: {
        sessionUpdate: 'tool_call_update',
        tool_call_id: tool.toolCallId,
        status: tool.status,
        title: toolTitle(tool),
        kind: tool.kind,
        content: tool.content.map(projectToolContent),
      },
    },
  };
}

function projectApprovalMessage(
  conversationId: string,
  projection: AionUiCodingJourneyProjection,
  approval: AionUiCodingJourneyApprovalProjection,
): TMessage {
  const messageId = 'actestra-coding-approval-' + approval.approvalId;
  const detail =
    approval.kind === 'publish'
      ? approval.summary +
        '\\nBase ' +
        approval.snapshot.baseCommit.slice(0, 12) +
        ' · ' +
        String(approval.snapshot.patchByteLength) +
        ' bytes · SHA-256 ' +
        approval.snapshot.patchSha256.slice(0, 12)
      : approval.summary;
  return {
    id: messageId,
    msg_id: messageId,
    conversation_id: conversationId,
    type: 'acp_permission',
    position: 'left',
    created_at: Date.parse(projection.updatedAt),
    content: {
      session_id: projection.taskId,
      options: [
        { option_id: 'allow_once', name: 'Approve once', kind: 'allow_once' },
        { option_id: 'reject_once', name: 'Deny', kind: 'reject_once' },
      ],
      tool_call: {
        tool_call_id: approval.toolCallId,
        title: approval.title,
        kind: approval.operationKind,
        raw_input: { description: detail },
      },
      actestraCodingJourney: {
        contractVersion: 1,
        taskId: projection.taskId,
        approvalId: approval.approvalId,
        kind: approval.kind,
      },
    },
  } as unknown as TMessage;
}

function projectStatusMessage(
  conversationId: string,
  projection: AionUiCodingJourneyProjection,
): TMessage {
  const messageId = 'actestra-coding-status-' + projection.taskId;
  const artifacts = projection.artifacts.map(
    (artifact) => 'Artifact: ' + artifact.label + ' · ' + artifact.state,
  );
  const lines = [
    'Actestra Goose · ' + projection.stage,
    ...artifacts,
    ...(projection.incidentCode === undefined
      ? []
      : ['Incident: ' + projection.incidentCode]),
  ];
  const type =
    projection.status === 'completed'
      ? 'success'
      : projection.status === 'failed'
        ? 'error'
        : projection.status === 'cancelled' || projection.status === 'blocked'
          ? 'warning'
          : 'info';
  return {
    id: messageId,
    msg_id: messageId,
    conversation_id: conversationId,
    type: 'tips',
    position: 'center',
    status: projection.canCancel ? 'work' : projection.status === 'failed' ? 'error' : 'finish',
    created_at: Date.parse(projection.updatedAt),
    content: {
      content: lines.join('\\n'),
      type,
      code: 'ACTESTRA_CODING_' + projection.stage.toUpperCase().replaceAll('-', '_'),
      params: {
        actestraCodingJourney: {
          contractVersion: 1,
          taskId: projection.taskId,
          stage: projection.stage,
          artifacts: projection.artifacts,
        },
      },
    },
  };
}

export function projectActestraCodingJourneyMessages(
  conversationId: string,
  projection: AionUiCodingJourneyProjection,
): readonly TMessage[] {
  const userMessageId = 'actestra-coding-user-' + projection.taskId;
  const userMessage: TMessage = {
    id: userMessageId,
    msg_id: userMessageId,
    conversation_id: conversationId,
    type: 'text',
    position: 'right',
    created_at: Date.parse(projection.createdAt),
    content: { content: projection.title },
  };
  const assistantMessages = projection.messages.map((message) => ({
    id: 'actestra-coding-assistant-' + projection.taskId + '-' + message.messageId,
    msg_id: 'actestra-coding-assistant-' + projection.taskId + '-' + message.messageId,
    conversation_id: conversationId,
    type: 'text' as const,
    position: 'left' as const,
    created_at: Date.parse(projection.updatedAt),
    content: { content: message.text },
  }));
  return [
    userMessage,
    ...assistantMessages,
    ...projection.tools.map((tool) => projectToolMessage(conversationId, projection, tool)),
    ...(projection.approval === undefined
      ? []
      : [projectApprovalMessage(conversationId, projection, projection.approval)]),
    projectStatusMessage(conversationId, projection),
  ];
}
`,
);

writeNew(
  "packages/desktop/src/renderer/hooks/chat/useActestraCodingJourney.ts",
  `import type { AionUiCodingJourneyProjection } from '@/actestra/compatibility/aionui/codingJourney';
import {
  cancelActestraCodingJourney,
  listActestraCodingJourney,
  submitActestraCodingJourney,
} from '@/common/adapter/actestraCodingJourneyClient';
import {
  useAddOrUpdateMessage,
  useRemoveMessageByMsgId,
} from '@/renderer/pages/conversation/Messages/hooks';
import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectActestraCodingJourneyMessages } from './actestraCodingJourneyProjection';

const POLL_INTERVAL_MS = 250;
let fallbackSubmissionSequence = 0;

function nextSubmissionId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return 'submission-aionui-coding-' + globalThis.crypto.randomUUID();
  }
  fallbackSubmissionSequence += 1;
  return (
    'submission-aionui-coding-' +
    String(Date.now()) +
    '-' +
    String(fallbackSubmissionSequence)
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function useActestraCodingJourney(conversationId: string | undefined) {
  const addOrUpdateMessage = useAddOrUpdateMessage();
  const removeMessage = useRemoveMessageByMsgId();
  const mountedRef = useRef(true);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const pollGenerationRef = useRef(0);
  const readFailureNotifiedRef = useRef(false);
  const activeTaskIdRef = useRef<AionUiCodingJourneyProjection['taskId'] | null>(null);
  const submitPendingRef = useRef(false);
  const cancelPendingSubmitRef = useRef(false);
  const projectedMessageIdsRef = useRef(new Map<string, ReadonlySet<string>>());
  const [hasActive, setHasActive] = useState(false);

  const syncHasActive = useCallback(() => {
    setHasActive(activeTaskIdRef.current !== null || submitPendingRef.current);
  }, []);

  const setActiveTask = useCallback(
    (taskId: AionUiCodingJourneyProjection['taskId'] | null) => {
      activeTaskIdRef.current = taskId;
      syncHasActive();
    },
    [syncHasActive],
  );

  const setSubmitPending = useCallback(
    (pending: boolean) => {
      submitPendingRef.current = pending;
      syncHasActive();
    },
    [syncHasActive],
  );

  const upsert = useCallback(
    (projection: AionUiCodingJourneyProjection) => {
      if (!conversationId) return;
      const messages = projectActestraCodingJourneyMessages(conversationId, projection);
      const nextIds = new Set(messages.map(({ msg_id: messageId }) => messageId));
      const previousIds = projectedMessageIdsRef.current.get(projection.taskId);
      previousIds?.forEach((messageId) => {
        if (!nextIds.has(messageId)) removeMessage(messageId);
      });
      messages.forEach((message) => addOrUpdateMessage(message));
      projectedMessageIdsRef.current.set(projection.taskId, nextIds);
    },
    [addOrUpdateMessage, conversationId, removeMessage],
  );

  const read = useCallback(async () => {
    if (!conversationId) return null;
    const targetConversationId = conversationId;
    const result = await listActestraCodingJourney({
      contractVersion: 1,
      nativeConversationId: targetConversationId,
      limit: 50,
    });
    if (!mountedRef.current || conversationIdRef.current !== targetConversationId) {
      return null;
    }
    if (result.status === 'rejected' || !('projections' in result)) {
      if (!readFailureNotifiedRef.current) {
        readFailureNotifiedRef.current = true;
        Message.error(
          'Actestra coding unavailable (' +
            (result.status === 'rejected' ? result.code : 'invalid-response') +
            ')',
        );
      }
      return null;
    }
    readFailureNotifiedRef.current = false;
    result.projections.forEach(upsert);
    return result.projections;
  }, [conversationId, upsert]);

  const waitForTerminal = useCallback(
    async (
      taskId: AionUiCodingJourneyProjection['taskId'],
      generation: number,
    ): Promise<void> => {
      while (mountedRef.current && generation === pollGenerationRef.current) {
        await delay(POLL_INTERVAL_MS);
        if (!mountedRef.current || generation !== pollGenerationRef.current) return;
        const projections = await read();
        if (projections === null) continue;
        const current = projections.find((projection) => projection.taskId === taskId);
        if (current === undefined || !current.canCancel) {
          if (activeTaskIdRef.current === taskId) setActiveTask(null);
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
      const active = projections.find((projection) => projection.canCancel);
      setActiveTask(active?.taskId ?? null);
      if (active !== undefined) void waitForTerminal(active.taskId, generation);
    });
    return () => {
      mountedRef.current = false;
      pollGenerationRef.current += 1;
    };
  }, [conversationId, read, setActiveTask, setSubmitPending, waitForTerminal]);

  const cancelTask = useCallback(
    async (
      targetConversationId: string,
      taskId: AionUiCodingJourneyProjection['taskId'],
    ): Promise<void> => {
      const result = await cancelActestraCodingJourney({
        contractVersion: 1,
        nativeConversationId: targetConversationId,
        taskId,
        reason: 'User stopped the task from the retained AionUI ACP SendBox.',
      });
      if (!mountedRef.current || conversationIdRef.current !== targetConversationId) return;
      if (result.status === 'rejected' || !('projection' in result)) {
        Message.error(
          'Actestra coding cancellation failed (' +
            (result.status === 'rejected' ? result.code : 'invalid-response') +
            ')',
        );
        return;
      }
      upsert(result.projection);
      if (!result.projection.canCancel) setActiveTask(null);
    },
    [setActiveTask, upsert],
  );

  const run = useCallback(
    async (prompt: string): Promise<void> => {
      if (!conversationId) return;
      const targetConversationId = conversationId;
      if (activeTaskIdRef.current !== null || submitPendingRef.current) {
        Message.warning('An Actestra coding task is already active in this conversation.');
        return;
      }
      cancelPendingSubmitRef.current = false;
      setSubmitPending(true);
      const result = await submitActestraCodingJourney({
        contractVersion: 1,
        nativeConversationId: targetConversationId,
        submissionId: nextSubmissionId(),
        prompt,
      });
      if (!mountedRef.current || conversationIdRef.current !== targetConversationId) return;
      if (result.status === 'rejected' || !('projection' in result)) {
        setSubmitPending(false);
        cancelPendingSubmitRef.current = false;
        Message.error(
          'Actestra coding task rejected (' +
            (result.status === 'rejected' ? result.code : 'invalid-response') +
            ')',
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
    [cancelTask, conversationId, setActiveTask, setSubmitPending, upsert, waitForTerminal],
  );

  const cancel = useCallback(async (): Promise<void> => {
    if (!conversationId) return;
    const taskId = activeTaskIdRef.current;
    if (taskId === null) {
      if (submitPendingRef.current) cancelPendingSubmitRef.current = true;
      return;
    }
    await cancelTask(conversationId, taskId);
  }, [cancelTask, conversationId]);

  return { hasActive, run, cancel };
}
`,
);

replaceOnce(
  "packages/desktop/src/renderer/utils/model/agentTypes.ts",
  `import { ipcBridge } from '@/common';
import type { TFunction } from 'i18next';`,
  `import { ipcBridge } from '@/common';
import {
  mergeActestraCodingAgent,
  readActestraCodingAgent,
} from '@/common/adapter/actestraCodingAgentClient';
import type { TFunction } from 'i18next';`,
);

replaceOnce(
  "packages/desktop/src/renderer/utils/model/agentTypes.ts",
  `export async function fetchManagedAgents(): Promise<ManagedAgent[]> {
  try {
    const agents = await ipcBridge.acpConversation.getManagedAgents.invoke();
    if (Array.isArray(agents)) {
      return agents as ManagedAgent[];
    }
  } catch {
    // fallback to empty
  }
  return [];
}`,
  `export async function fetchManagedAgents(): Promise<ManagedAgent[]> {
  const [nativeAgents, codingAgent] = await Promise.all([
    ipcBridge.acpConversation.getManagedAgents.invoke().catch((): ManagedAgent[] => []),
    readActestraCodingAgent(),
  ]);
  const agents = Array.isArray(nativeAgents) ? (nativeAgents as ManagedAgent[]) : [];
  return codingAgent === null ? agents : mergeActestraCodingAgent(agents, codingAgent);
}`,
);

replaceOnce(
  "packages/desktop/src/renderer/hooks/agent/useManagedAgents.ts",
  `import { ipcBridge } from '@/common';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';`,
  `import { ipcBridge } from '@/common';
import { ACTESTRA_GOOSE_MANAGED_AGENT_ID } from '@/actestra/compatibility/aionui/codingAgent';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';`,
);

replaceOnce(
  "packages/desktop/src/renderer/hooks/agent/useManagedAgents.ts",
  `export const useManagedAgentRuntimeCatalog = (): ManagedAgent[] => {
  const { data } = useSWR<ManagedAgent[]>(MANAGED_AGENTS_SWR_KEY, fetchManagedAgents);
  return data ?? [];
};`,
  `export const useManagedAgentRuntimeCatalog = (): ManagedAgent[] => {
  const { data } = useSWR<ManagedAgent[]>(MANAGED_AGENTS_SWR_KEY, fetchManagedAgents);
  return (data ?? []).filter((agent) => agent.id !== ACTESTRA_GOOSE_MANAGED_AGENT_ID);
};`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx",
  `import { ipcBridge } from '@/common';
import { parseError } from '@/common/utils';`,
  `import { ipcBridge } from '@/common';
import { ACTESTRA_GOOSE_MANAGED_AGENT_ID } from '@/actestra/compatibility/aionui/codingAgent';
import { probeActestraCodingManagedAgent } from '@/common/adapter/actestraCodingAgentClient';
import { parseError } from '@/common/utils';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx",
  `        const leftIsKimi = left.backend === 'kimi';`,
  `        const leftIsActestraGoose = left.id === ACTESTRA_GOOSE_MANAGED_AGENT_ID;
        const rightIsActestraGoose = right.id === ACTESTRA_GOOSE_MANAGED_AGENT_ID;
        if (leftIsActestraGoose !== rightIsActestraGoose) {
          return leftIsActestraGoose ? -1 : 1;
        }
        const leftIsKimi = left.backend === 'kimi';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx",
  `        const result = await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agentId });
        await refreshCatalog();`,
  `        const result =
          agentId === ACTESTRA_GOOSE_MANAGED_AGENT_ID
            ? await probeActestraCodingManagedAgent()
            : await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agentId });
        await refreshCatalog();`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx",
  `import { ipcBridge } from '@/common';
import { useManagedAgents } from '@/renderer/hooks/agent/useManagedAgents';`,
  `import { ipcBridge } from '@/common';
import { ACTESTRA_GOOSE_MANAGED_AGENT_ID } from '@/actestra/compatibility/aionui/codingAgent';
import { probeActestraCodingManagedAgent } from '@/common/adapter/actestraCodingAgentClient';
import { useManagedAgents } from '@/renderer/hooks/agent/useManagedAgents';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx",
  `import AgentRepairPanel from './AgentRepairPanel';`,
  `import AgentRepairPanel from './AgentRepairPanel';
import ActestraCodingAgentRepairPanel from './ActestraCodingAgentRepairPanel';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx",
  `      const result = await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id });
      await refreshCatalog();`,
  `      const result =
        agent.id === ACTESTRA_GOOSE_MANAGED_AGENT_ID
          ? await probeActestraCodingManagedAgent()
          : await ipcBridge.acpConversation.checkManagedAgentHealthById.invoke({ id: agent.id });
      await refreshCatalog();`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx",
  `  const boundAssistants = getBoundAssistants(agent, assistants);

  return (`,
  `  const boundAssistants = getBoundAssistants(agent, assistants);
  const isActestraCodingAgent = agent.id === ACTESTRA_GOOSE_MANAGED_AGENT_ID;

  return (`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx",
  `          <AgentRepairPanel agent={agent} onSaved={handleSaved} />

          {/* Which assistants depend on this agent — clicking one jumps to its
              detail/editor so the user can see and adjust the binding. */}
          <div className='mt-18px'>`,
  `          {isActestraCodingAgent ? (
            <ActestraCodingAgentRepairPanel agent={agent} />
          ) : (
            <AgentRepairPanel agent={agent} onSaved={handleSaved} />
          )}

          {/* Which assistants depend on this agent — clicking one jumps to its
              detail/editor so the user can see and adjust the binding. */}
          {!isActestraCodingAgent ? <div className='mt-18px'>`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx",
  `            <BoundAssistantList assistants={boundAssistants} onOpenAssistant={handleOpenAssistant} />
          </div>
        </div>`,
  `            <BoundAssistantList assistants={boundAssistants} onOpenAssistant={handleOpenAssistant} />
          </div> : null}
        </div>`,
);

writeNew(
  "packages/desktop/src/renderer/pages/settings/AgentSettings/ActestraCodingAgentRepairPanel.tsx",
  `import React from 'react';
import { Alert, Typography } from '@arco-design/web-react';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { formatManagedAgentDiagnosticMessage } from '@/renderer/utils/model/agentTypes';
import { useTranslation } from 'react-i18next';

const ActestraCodingAgentRepairPanel: React.FC<{ agent: ManagedAgent }> = ({ agent }) => {
  const { t } = useTranslation();
  const ready = agent.status === 'online';
  const diagnostics = formatManagedAgentDiagnosticMessage(t, agent);
  return (
    <div
      data-testid='actestra-coding-agent-repair-panel'
      className='mt-10px flex flex-col gap-12px rounded-10px bg-aou-1 px-12px py-12px'
    >
      <Alert
        data-testid='actestra-coding-agent-repair-status'
        type={ready ? 'success' : agent.status === 'missing' ? 'error' : 'warning'}
        title={
          ready
            ? t('settings.repair.onlineTitle')
            : agent.status === 'missing'
              ? t('settings.repair.missingTitle')
              : t('settings.repair.offlineTitle')
        }
        content={
          ready
            ? 'The pinned Goose 1.45.0 runner is admitted behind Actestra Core.'
            : diagnostics || 'The isolated coding worker is unavailable.'
        }
      />
      <Typography.Text className='text-12px leading-18px text-t-secondary'>
        Actestra owns runner admission, isolated Git worktrees, approvals, tool policy, evidence, and cleanup.
        Runner paths, credentials, and private Worker state are not editable in the renderer.
      </Typography.Text>
      {ready ? (
        <Typography.Text data-testid='actestra-coding-agent-version' className='text-12px text-t-tertiary'>
          Goose 1.45.0 · ACP 1.0.1 · schema 1.1.0
        </Typography.Text>
      ) : null}
    </div>
  );
};

export default ActestraCodingAgentRepairPanel;
`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `import { ipcBridge } from '@/common';`,
  `import { ipcBridge } from '@/common';
import { readActestraCodingAgent } from '@/common/adapter/actestraCodingAgentClient';
import AionSelect from '@/renderer/components/base/AionSelect';
import { useActestraCodingJourney } from '@/renderer/hooks/chat/useActestraCodingJourney';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `  const teamPermission = useTeamPermission();
  // In team mode, all agents show the permission mode selector (members don't propagate)`,
  `  const teamPermission = useTeamPermission();
  const isTeamConversation = Boolean(teamPermission);
  const codingJourney = useActestraCodingJourney(
    isTeamConversation ? undefined : conversation_id,
  );
  const [codingTarget, setCodingTarget] = useState<'native' | 'actestra-goose'>('native');
  const [codingAgentAvailability, setCodingAgentAvailability] = useState<
    'checking' | 'ready' | 'unavailable' | 'absent'
  >('checking');
  const actestraCodingJourneySelector =
    !isTeamConversation && codingTarget === 'actestra-goose';
  useEffect(() => {
    if (isTeamConversation) {
      setCodingTarget('native');
      setCodingAgentAvailability('absent');
      return;
    }
    let current = true;
    void readActestraCodingAgent().then((projection) => {
      if (!current) return;
      setCodingAgentAvailability(
        projection === null
          ? 'absent'
          : projection.status === 'ready'
            ? 'ready'
            : 'unavailable',
      );
    });
    return () => {
      current = false;
    };
  }, [isTeamConversation]);
  useEffect(() => {
    if (codingJourney.hasActive && !isTeamConversation) {
      setCodingTarget('actestra-goose');
    }
  }, [codingJourney.hasActive, isTeamConversation]);
  // In team mode, all agents show the permission mode selector (members don't propagate)`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `  const isCancelling = runtimeView.state === 'cancelling';
  const isBusy = isCancelling || commandQueueRuntimeGate.isProcessing || !commandQueueRuntimeGate.canSendMessage;`,
  `  const isCancelling = runtimeView.state === 'cancelling';
  const isBusy =
    isCancelling ||
    commandQueueRuntimeGate.isProcessing ||
    !commandQueueRuntimeGate.canSendMessage ||
    codingJourney.hasActive;`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `  const onSendHandler = async (message: string) => {
    const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path));
    const allFiles = [...uploadFile, ...atPathFiles];

    clearFiles();
    emitter.emit('acp.selected.file.clear');`,
  `  const onSendHandler = async (message: string) => {
    const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path));
    const allFiles = [...uploadFile, ...atPathFiles];

    if (actestraCodingJourneySelector) {
      if (allFiles.length > 0) {
        Message.warning('Goose coding accepts text only; remove attachments before sending.');
        return;
      }
      void checkAndUpdateTitle(conversation_id, message);
      await codingJourney.run(message);
      return;
    }

    clearFiles();
    emitter.emit('acp.selected.file.clear');`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    // Cancelling is best-effort: swallow errors (e.g. backend WS not yet`,
  `  // Stop conversation handler
  const handleStop = async (): Promise<void> => {
    if (!isTeamConversation && codingJourney.hasActive) {
      await codingJourney.cancel();
      resetState();
      resetActiveExecution('stop');
      return;
    }
    // Cancelling is best-effort: swallow errors (e.g. backend WS not yet`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `      <ThoughtDisplay
        running={teamRuntime?.loading ?? (aiProcessing && !hasThinkingMessage)}`,
  `      <ThoughtDisplay
        running={
          teamRuntime?.loading ??
          (codingJourney.hasActive || (aiProcessing && !hasThinkingMessage))
        }`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `        placeholder={t('acp.sendbox.placeholder', {
          backend: agent_name || backend,
          defaultValue: \`Send message to {{backend}}...\`,
        })}`,
  `        placeholder={
          actestraCodingJourneySelector
            ? 'Describe an isolated coding task for Goose...'
            : t('acp.sendbox.placeholder', {
                backend: agent_name || backend,
                defaultValue: \`Send message to {{backend}}...\`,
              })
        }`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `        onFilesAdded={handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        enableBtw={isSideQuestionSupported({ type: 'acp', backend })}
        supportedExts={allSupportedExts}`,
  `        onFilesAdded={actestraCodingJourneySelector ? undefined : handleFilesAdded}
        hasPendingAttachments={uploadFile.length > 0 || atPath.length > 0}
        enableBtw={
          !actestraCodingJourneySelector && isSideQuestionSupported({ type: 'acp', backend })
        }
        supportedExts={actestraCodingJourneySelector ? [] : allSupportedExts}`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `        tools={
          <FileAttachButton
            openFileSelector={openFileSelector}
            onLocalFilesAdded={handleFilesAdded}
            loadedMcpStatuses={loadedMcpStatuses}
          />
        }
        rightTools={
          <div className='flex items-center gap-8px min-w-0'>
            {showModeSelector && (`,
  `        tools={
          actestraCodingJourneySelector ? undefined : (
            <FileAttachButton
              openFileSelector={openFileSelector}
              onLocalFilesAdded={handleFilesAdded}
              loadedMcpStatuses={loadedMcpStatuses}
            />
          )
        }
        rightTools={
          <div className='flex items-center gap-8px min-w-0'>
            {!isTeamConversation && codingAgentAvailability !== 'absent' ? (
              <AionSelect
                data-testid='actestra-coding-agent-selector'
                size='small'
                value={codingTarget}
                disabled={codingJourney.hasActive}
                style={{ width: 164 }}
                onChange={(value) => {
                  if (value === 'native' || value === 'actestra-goose') {
                    setCodingTarget(value);
                  }
                }}
              >
                <AionSelect.Option value='native'>
                  {'Native · ' + (agent_name || backend)}
                </AionSelect.Option>
                <AionSelect.Option
                  value='actestra-goose'
                  disabled={codingAgentAvailability !== 'ready'}
                >
                  {codingAgentAvailability === 'ready'
                    ? 'Goose coding'
                    : codingAgentAvailability === 'checking'
                      ? 'Goose coding · checking'
                      : 'Goose coding · unavailable'}
                </AionSelect.Option>
              </AionSelect>
            ) : null}
            {showModeSelector && !actestraCodingJourneySelector && (`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx",
  `        allowSendWhileLoading
        compactActions={false}`,
  `        allowSendWhileLoading={!actestraCodingJourneySelector}
        compactActions={false}`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx",
  `import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import { conversation } from '@/common/adapter/ipcBridge';`,
  `import type { IMessageAcpPermission } from '@/common/chat/chatLib';
import {
  decideActestraCodingJourneyApproval,
  decideActestraCodingJourneyPublish,
} from '@/common/adapter/actestraCodingJourneyClient';
import { conversation } from '@/common/adapter/ipcBridge';
import { readActestraCodingPermissionMetadata } from '@/renderer/hooks/chat/actestraCodingJourneyProjection';`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx",
  `  const { t } = useTranslation();
  const toolCallId = tool_call?.tool_call_id;`,
  `  const { t } = useTranslation();
  const toolCallId = tool_call?.tool_call_id;
  const actestraPermission = useMemo(
    () => readActestraCodingPermissionMetadata(content),
    [content],
  );`,
);

replaceOnce(
  "packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx",
  `  const handleConfirm = useCallback(
    async (selectedValue: string) => {
      await conversation.confirmMessage.invoke({
        confirm_key: selectedValue,
        msg_id: message.id,
        conversation_id: message.conversation_id,
        call_id: toolCallId || message.id,
      });
    },
    [message.conversation_id, message.id, toolCallId]
  );`,
  `  const handleConfirm = useCallback(
    async (selectedValue: string) => {
      if (actestraPermission !== null) {
        const decision =
          selectedValue === 'allow_once'
            ? 'approved'
            : selectedValue === 'reject_once'
              ? 'denied'
              : null;
        if (decision === null) {
          throw new Error('Actestra coding permission option is invalid');
        }
        const request = {
          contractVersion: 1 as const,
          nativeConversationId: message.conversation_id,
          taskId: actestraPermission.taskId,
          approvalId: actestraPermission.approvalId,
          decision,
        } as const;
        const result =
          actestraPermission.kind === 'publish'
            ? await decideActestraCodingJourneyPublish(request)
            : await decideActestraCodingJourneyApproval(request);
        if (result.status === 'rejected') {
          throw new Error('Actestra coding permission failed (' + result.code + ')');
        }
        return;
      }
      await conversation.confirmMessage.invoke({
        confirm_key: selectedValue,
        msg_id: message.id,
        conversation_id: message.conversation_id,
        call_id: toolCallId || message.id,
      });
    },
    [actestraPermission, message.conversation_id, message.id, toolCallId]
  );`,
);

writeNew(
  "tests/unit/actestra/codingAgentClient.dom.test.ts",
  `// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mergeActestraCodingAgent,
  probeActestraCodingManagedAgent,
  readActestraCodingAgent,
} from '@/common/adapter/actestraCodingAgentClient';

afterEach(() => {
  delete window.actestraCodingAgent;
});

describe('Actestra coding-agent renderer client', () => {
  it('merges one fixed ready row without retaining a conflicting native row', async () => {
    window.actestraCodingAgent = {
      status: vi.fn(async () => ({
        contractVersion: 1,
        agentId: 'actestra-goose',
        displayName: 'Goose coding',
        status: 'ready',
        runnerVersion: '1.45.0',
      })),
      probe: vi.fn(async () => ({
        contractVersion: 1,
        agentId: 'actestra-goose',
        displayName: 'Goose coding',
        status: 'ready',
        runnerVersion: '1.45.0',
      })),
    };

    const projection = await readActestraCodingAgent();
    expect(projection).not.toBeNull();
    const rows = mergeActestraCodingAgent(
      [
        {
          id: 'actestra-goose',
          name: 'foreign row',
          agent_type: 'acp',
          agent_source: 'custom',
          enabled: true,
          installed: true,
          status: 'online',
        },
      ],
      projection!,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'actestra-goose',
      name: 'Goose coding',
      agent_source: 'internal',
      status: 'online',
      installed: true,
    });
    expect(rows[0]).not.toHaveProperty('command');
    expect(rows[0]).not.toHaveProperty('env');
  });

  it('uses the fixed probe and returns a bounded unavailable row on bridge rejection', async () => {
    window.actestraCodingAgent = {
      status: vi.fn(async () => ({ status: 'expanded' } as never)),
      probe: vi.fn(async () => {
        throw new Error('private runner path');
      }),
    };
    await expect(readActestraCodingAgent()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'main-unavailable',
    });
    await expect(probeActestraCodingManagedAgent()).resolves.toMatchObject({
      id: 'actestra-goose',
      status: 'offline',
      last_check_error_code: 'actestra_main_unavailable',
    });
    expect(JSON.stringify(await probeActestraCodingManagedAgent())).not.toContain('private runner path');
  });

  it('preserves native browser behavior when the desktop preload bridge is absent', async () => {
    await expect(readActestraCodingAgent()).resolves.toBeNull();
  });
});
`,
);

writeNew(
  "tests/unit/actestra/codingAgentNativeWiring.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Actestra retained AionUI coding-agent wiring', () => {
  it('keeps status and probe behind main-owned IPC and the fixed preload API', () => {
    const main = read('packages/desktop/src/process/services/actestraShadowBridge.ts');
    const preload = read('packages/desktop/src/preload/main.ts');
    expect(main).toContain('AionUiCodingAgentService');
    expect(main).toContain('ACTESTRA_CODING_AGENT_STATUS_CHANNEL');
    expect(main).toContain('ACTESTRA_CODING_AGENT_PROBE_CHANNEL');
    expect(main).toContain('ownsMainFrame(event, extraArguments)');
    expect(preload).toContain("contextBridge.exposeInMainWorld('actestraCodingAgent'");
    expect(preload).not.toContain('ACTESTRA_GOOSE_RUNNER_ARTIFACT_DIRECTORY');
  });

  it('reuses native Agent Settings and Repair without exposing a renderer launch override', () => {
    const localAgents = read('packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx');
    const repairPage = read('packages/desktop/src/renderer/pages/settings/AgentSettings/AgentRepairPage.tsx');
    const repairPanel = read(
      'packages/desktop/src/renderer/pages/settings/AgentSettings/ActestraCodingAgentRepairPanel.tsx',
    );
    expect(localAgents).toContain('probeActestraCodingManagedAgent');
    expect(repairPage).toContain('ActestraCodingAgentRepairPanel');
    expect(repairPanel).toContain("data-testid='actestra-coding-agent-repair-panel'");
    expect(repairPanel).not.toContain('setAgentOverrides');
    expect(repairPanel).not.toContain('EnvVarEditor');
    expect('agent-row-actestra-goose').toBe('agent-row-actestra-goose');
  });
});
`,
);

writeNew(
  "tests/unit/actestra/codingJourneyClient.dom.test.ts",
  `// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvalId, instant, taskId } from '@/actestra/core';
import {
  cancelActestraCodingJourney,
  decideActestraCodingJourneyApproval,
  decideActestraCodingJourneyPublish,
  listActestraCodingJourney,
  submitActestraCodingJourney,
} from '@/common/adapter/actestraCodingJourneyClient';

const projection = Object.freeze({
  contractVersion: 1 as const,
  taskId: taskId('task-aionui-coding-' + 'a'.repeat(64)),
  status: 'completed' as const,
  stage: 'published' as const,
  title: 'Update the isolated fixture.',
  canCancel: false,
  createdAt: instant('2026-08-04T08:00:00.000Z'),
  updatedAt: instant('2026-08-04T08:00:01.000Z'),
  messages: Object.freeze([]),
  tools: Object.freeze([]),
  artifacts: Object.freeze([]),
});

afterEach(() => {
  delete window.actestraCodingJourney;
});

describe('Actestra coding-journey renderer client', () => {
  it('uses only the five fixed preload operations and validates every response', async () => {
    window.actestraCodingJourney = {
      submit: vi.fn(async () => ({ status: 'ok' as const, projection })),
      list: vi.fn(async () => ({ status: 'ok' as const, projections: [projection] })),
      cancel: vi.fn(async () => ({ status: 'ok' as const, projection })),
      decideApproval: vi.fn(async () => ({ status: 'ok' as const, projection })),
      decidePublish: vi.fn(async () => ({ status: 'ok' as const, projection })),
    };
    const nativeConversationId = 'native-coding-client';
    const stableApprovalId = approvalId('approval-coding-' + 'b'.repeat(64));

    await expect(
      submitActestraCodingJourney({
        contractVersion: 1,
        nativeConversationId,
        submissionId: 'submission-coding-client',
        prompt: 'Update the fixture.',
      }),
    ).resolves.toEqual({ status: 'ok', projection });
    await expect(
      listActestraCodingJourney({ contractVersion: 1, nativeConversationId, limit: 50 }),
    ).resolves.toEqual({ status: 'ok', projections: [projection] });
    await expect(
      cancelActestraCodingJourney({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
      }),
    ).resolves.toEqual({ status: 'ok', projection });
    await expect(
      decideActestraCodingJourneyApproval({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId: stableApprovalId,
        decision: 'approved',
      }),
    ).resolves.toEqual({ status: 'ok', projection });
    await expect(
      decideActestraCodingJourneyPublish({
        contractVersion: 1,
        nativeConversationId,
        taskId: projection.taskId,
        approvalId: stableApprovalId,
        decision: 'denied',
      }),
    ).resolves.toEqual({ status: 'ok', projection });
  });

  it('fails closed when the preload bridge is absent or returns an expanded shape', async () => {
    await expect(
      submitActestraCodingJourney({
        contractVersion: 1,
        nativeConversationId: 'native-coding-client-absent',
        submissionId: 'submission-coding-client-absent',
        prompt: 'Keep native ACP behavior.',
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'agent-unavailable' });

    window.actestraCodingJourney = {
      submit: vi.fn(async () => ({ status: 'ok', projection, privateRoot: '/private/root' }) as never),
      list: vi.fn(),
      cancel: vi.fn(),
      decideApproval: vi.fn(),
      decidePublish: vi.fn(),
    };
    await expect(
      submitActestraCodingJourney({
        contractVersion: 1,
        nativeConversationId: 'native-coding-client-expanded',
        submissionId: 'submission-coding-client-expanded',
        prompt: 'Reject expanded output.',
      }),
    ).resolves.toEqual({ status: 'rejected', code: 'execution-failed' });
  });
});
`,
);

writeNew(
  "tests/unit/actestra/codingJourneyHook.dom.test.tsx",
  `// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AionUiCodingJourneyProjection } from '@/actestra/compatibility/aionui/codingJourney';
import { approvalId, instant, taskId } from '@/actestra/core';

const mocks = vi.hoisted(() => ({
  addOrUpdateMessage: vi.fn(),
  removeMessage: vi.fn(),
  list: vi.fn(),
  submit: vi.fn(),
  cancel: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
}));

vi.mock('@/common/adapter/actestraCodingJourneyClient', () => ({
  listActestraCodingJourney: mocks.list,
  submitActestraCodingJourney: mocks.submit,
  cancelActestraCodingJourney: mocks.cancel,
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useAddOrUpdateMessage: () => mocks.addOrUpdateMessage,
  useRemoveMessageByMsgId: () => mocks.removeMessage,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    error: mocks.messageError,
    warning: mocks.messageWarning,
  },
}));

import {
  projectActestraCodingJourneyMessages,
  readActestraCodingPermissionMetadata,
} from '@/renderer/hooks/chat/actestraCodingJourneyProjection';
import { useActestraCodingJourney } from '@/renderer/hooks/chat/useActestraCodingJourney';

const stableTaskId = taskId('task-aionui-coding-' + 'c'.repeat(64));
const terminalProjection = Object.freeze({
  contractVersion: 1 as const,
  taskId: stableTaskId,
  status: 'completed' as const,
  stage: 'published' as const,
  title: 'Update the isolated fixture.',
  canCancel: false,
  createdAt: instant('2026-08-04T08:10:00.000Z'),
  updatedAt: instant('2026-08-04T08:10:01.000Z'),
  messages: Object.freeze([{ messageId: 'assistant-1', text: 'The focused test passed.' }]),
  tools: Object.freeze([]),
  artifacts: Object.freeze([]),
}) satisfies AionUiCodingJourneyProjection;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Actestra retained AionUI coding-journey hook', () => {
  it('projects assistant, tool, terminal, diff, test, approval, and status into native messages', () => {
    const approval = approvalId('approval-coding-' + 'd'.repeat(64));
    const projection: AionUiCodingJourneyProjection = {
      ...terminalProjection,
      status: 'blocked',
      stage: 'publish-approval-required',
      canCancel: true,
      tools: [
        {
          toolCallId: 'tool-terminal',
          title: 'Run command',
          kind: 'execute',
          status: 'completed',
          surface: 'terminal',
          content: [{ type: 'terminal', terminalId: 'terminal-evidence-1' }],
        },
        {
          toolCallId: 'tool-diff',
          title: 'Review patch',
          kind: 'edit',
          status: 'completed',
          surface: 'diff',
          content: [{ type: 'diff', path: 'answer.txt', oldText: 'before', newText: 'after' }],
        },
        {
          toolCallId: 'tool-test',
          title: 'Focused test',
          kind: 'execute',
          status: 'completed',
          surface: 'test',
          content: [{ type: 'content', text: '1 test passed' }],
        },
      ],
      approval: {
        kind: 'publish',
        approvalId: approval,
        toolCallId: 'tool-publish',
        title: 'Publish Actestra coding patch',
        operationKind: 'execute',
        summary: 'Publish the reviewed isolated patch',
        snapshot: {
          baseCommit: 'e'.repeat(40),
          patchByteLength: 128,
          patchSha256: 'f'.repeat(64),
        },
      },
    };
    const messages = projectActestraCodingJourneyMessages(
      'native-coding-projection',
      projection,
    );

    expect(messages.map(({ type }) => type)).toEqual([
      'text',
      'text',
      'acp_tool_call',
      'acp_tool_call',
      'acp_tool_call',
      'acp_permission',
      'tips',
    ]);
    const permission = messages.find(({ type }) => type === 'acp_permission');
    expect(readActestraCodingPermissionMetadata(permission?.content)).toEqual({
      contractVersion: 1,
      taskId: stableTaskId,
      approvalId: approval,
      kind: 'publish',
    });
    expect(
      readActestraCodingPermissionMetadata({
        ...permission?.content,
        actestraCodingJourney: {
          contractVersion: 1,
          taskId: stableTaskId,
          approvalId: approval,
          kind: 'publish',
          actorId: 'renderer-actor',
        },
      }),
    ).toBeNull();
  });

  it('submits only the fixed text intent and projects the returned native messages', async () => {
    mocks.list.mockResolvedValue({ status: 'ok', projections: [] });
    mocks.submit.mockResolvedValue({ status: 'ok', projection: terminalProjection });
    const hook = renderHook(() => useActestraCodingJourney('native-coding-submit'));
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());

    await act(async () => {
      await hook.result.current.run('Update the isolated fixture.');
    });

    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith({
      contractVersion: 1,
      nativeConversationId: 'native-coding-submit',
      submissionId: expect.stringMatching(/^submission-aionui-coding-/u),
      prompt: 'Update the isolated fixture.',
    });
    expect(mocks.addOrUpdateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'native-coding-submit',
        type: 'tips',
      }),
    );
    expect(hook.result.current.hasActive).toBe(false);
  });

  it('cancels the exact active task without entering native ACP stop authority', async () => {
    const activeProjection = { ...terminalProjection, status: 'blocked', stage: 'review', canCancel: true };
    mocks.list
      .mockResolvedValueOnce({ status: 'ok', projections: [activeProjection] })
      .mockResolvedValue({ status: 'ok', projections: [terminalProjection] });
    mocks.cancel.mockResolvedValue({
      status: 'ok',
      projection: { ...terminalProjection, status: 'cancelled', stage: 'cancelled' },
    });
    const hook = renderHook(() => useActestraCodingJourney('native-coding-cancel'));
    await waitFor(() => expect(hook.result.current.hasActive).toBe(true));

    await act(async () => {
      await hook.result.current.cancel();
    });

    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      contractVersion: 1,
      nativeConversationId: 'native-coding-cancel',
      taskId: stableTaskId,
      reason: 'User stopped the task from the retained AionUI ACP SendBox.',
    });
    expect(hook.result.current.hasActive).toBe(false);
  });
});
`,
);

writeNew(
  "tests/unit/actestra/codingJourneyNativeWiring.test.ts",
  `// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('Actestra retained AionUI coding-journey wiring', () => {
  it('keeps the five renderer intents main-frame-only behind the fixed preload API', () => {
    const main = read('packages/desktop/src/process/services/actestraShadowBridge.ts');
    const preload = read('packages/desktop/src/preload/main.ts');
    for (const channel of [
      'ACTESTRA_CODING_JOURNEY_SUBMIT_CHANNEL',
      'ACTESTRA_CODING_JOURNEY_LIST_CHANNEL',
      'ACTESTRA_CODING_JOURNEY_CANCEL_CHANNEL',
      'ACTESTRA_CODING_JOURNEY_APPROVAL_DECISION_CHANNEL',
      'ACTESTRA_CODING_JOURNEY_PUBLISH_DECISION_CHANNEL',
    ]) {
      expect(main).toContain(channel);
      expect(preload).toContain(channel);
    }
    expect(main).toContain('ownsMainFrame(event, extraArguments)');
    expect(preload).toContain("contextBridge.exposeInMainWorld('actestraCodingJourney'");
    for (const rendererAuthority of ['repositoryRoot', 'modelId', 'actorId']) {
      expect(preload).not.toContain(rendererAuthority + ': request');
    }
  });

  it('uses the non-Team selector while preserving native ACP send, stop, and permission paths', () => {
    const sendBox = read(
      'packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx',
    );
    const permission = read(
      'packages/desktop/src/renderer/pages/conversation/Messages/acp/MessageAcpPermission.tsx',
    );
    expect(sendBox).toContain('useActestraCodingJourney');
    expect(sendBox).toContain("data-testid='actestra-coding-agent-selector'");
    expect(sendBox).toContain('isTeamConversation ? undefined : conversation_id');
    expect(sendBox).toContain('Goose coding accepts text only');
    expect(sendBox).toContain('ipcBridge.acpConversation.sendMessage.invoke');
    expect(sendBox).toContain('ipcBridge.conversation.stop.invoke');
    expect(permission).toContain('decideActestraCodingJourneyApproval');
    expect(permission).toContain('decideActestraCodingJourneyPublish');
    expect(permission).toContain('conversation.confirmMessage.invoke');
    expect(permission).not.toContain('actorId:');
  });

  it('projects into the retained message, tool, permission, and evidence components', () => {
    const projection = read(
      'packages/desktop/src/renderer/hooks/chat/actestraCodingJourneyProjection.ts',
    );
    const messageIndex = read(
      'packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx',
    );
    expect(projection).toContain("type: 'text'");
    expect(projection).toContain("type: 'acp_tool_call'");
    expect(projection).toContain("type: 'acp_permission'");
    expect(projection).toContain("type: 'tips'");
    expect(messageIndex).toContain('MessageAcpToolCall');
    expect(messageIndex).toContain('MessageAcpPermission');
  });
});
`,
);
